/**
 * Google Cloud Storage store for Cloud Run (or anywhere with Application Default Credentials).
 * Safe with many instances: every guarantee in the AssetStore contract comes from GCS preconditions,
 * not from in-process locks.
 *
 * Records are zero-byte objects whose AssetRecord lives in custom metadata (`wih-record`, base64url
 * JSON), in the PRIVATE bucket:
 * - `objects.list` returns custom metadata, so a full catalog scan is one paginated call per 1,000
 *   assets instead of one GET per asset.
 * - base64url because metadata values are HTTP headers on the XML API; encoding keeps Japanese
 *   tags byte-exact. Domain limits keep the worst case under the 8 KiB cap (record-size.test.ts).
 * - Updates are metadata patches guarded by `ifMetagenerationMatch`, which is CAS, and a patch on a
 *   deleted object 404s, which is "never resurrect" for free.
 *
 * Image objects carry NO custom metadata. On a public bucket, GCS returns custom metadata to anonymous
 * readers as `x-goog-meta-*` headers, so anything put there (uploader email, original file name,
 * tags) would be public. This is the reason records never ride on image objects.
 *
 * IAM the operator grants:
 * - service account: roles/storage.objectUser on GCS_BUCKET (and GCS_PUBLIC_BUCKET if set).
 * - GCS_BUCKET: public access prevention enforced.
 * - GCS_PUBLIC_BUCKET (optional): allUsers gets a custom role with only `storage.objects.get`.
 *   Not roles/storage.objectViewer: it includes `storage.objects.list`, which would let anyone
 *   enumerate every image id.
 */

import { Readable } from "node:stream";

import { type File, Storage } from "@google-cloud/storage";

import type { AssetId, AssetRecord } from "../../shared/domain";
import { HubError } from "../errors";
import type { Logger } from "../log";
import {
  type AssetStore,
  CAS_ATTEMPTS,
  decodeRecord,
  encodeRecord,
  IMAGE_CACHE_CONTROL,
  imageKey,
  RecordNotFound,
  recordKey,
  StoreConflict,
} from "./store";

export interface GcsStoreOptions {
  readonly bucket: string;
  readonly publicBucket: string | null;
  readonly log: Logger;
  readonly storage?: Storage;
}

export const RECORD_METADATA_KEY = "wih-record";

/**
 * Checks at startup that the service account can reach both buckets, so a typo in GCS_BUCKET fails
 * the deploy's first health check, not the first upload. The probe is a one-item list:
 * roles/storage.objectUser grants `objects.list` but not `buckets.get`.
 */
export async function createGcsStore(options: GcsStoreOptions): Promise<AssetStore> {
  const storage = options.storage ?? new Storage();
  const records = storage.bucket(options.bucket);
  const images = options.publicBucket === null ? records : storage.bucket(options.publicBucket);
  for (const bucket of new Set([records, images])) {
    try {
      await bucket.getFiles({ maxResults: 1, autoPaginate: false });
    } catch (error) {
      throw new Error(`GCS bucket ${bucket.name} is not reachable with the current credentials: ${String(error)}`, {
        cause: error,
      });
    }
  }

  const imageFile = (id: AssetId) => images.file(imageKey(id));
  const recordFile = (id: AssetId) => records.file(recordKey(id));

  async function readRecord(file: File): Promise<{ record: AssetRecord; metageneration: string | number } | null> {
    const [meta] = await file.getMetadata();
    const record = decodeMetadataRecord(meta.metadata?.[RECORD_METADATA_KEY]);
    if (record === null) {
      options.log.log("WARNING", "store.record_undecodable", { key: file.name });
      return null;
    }
    return { record, metageneration: meta.metageneration ?? 0 };
  }

  return {
    putImage: (id, webp) =>
      guard(async () => {
        try {
          // A single-request upload is atomic: the object appears complete or not at all.
          await imageFile(id).save(Buffer.from(webp), {
            resumable: false,
            validation: "crc32c",
            contentType: "image/webp",
            metadata: { cacheControl: IMAGE_CACHE_CONTROL },
            preconditionOpts: { ifGenerationMatch: 0 },
          });
        } catch (error) {
          if (statusOf(error) === 412) throw new StoreConflict(imageKey(id));
          throw error;
        }
      }),

    openImage: (id) =>
      guard(async () => {
        let size: number;
        let generation: string | number | undefined;
        try {
          const [meta] = await imageFile(id).getMetadata();
          size = Number(meta.size);
          generation = meta.generation;
        } catch (error) {
          if (statusOf(error) === 404) return null;
          throw error;
        }
        // Pin the generation we measured, so the bytes always match the Content-Length we send.
        const file = generation === undefined ? imageFile(id) : images.file(imageKey(id), { generation });
        const body = Readable.toWeb(file.createReadStream({ validation: false })) as ReadableStream<Uint8Array>;
        return { body, size };
      }),

    deleteImage: (id) => guard(() => imageFile(id).delete({ ignoreNotFound: true }).then(() => undefined)),

    createRecord: (record) =>
      guard(async () => {
        try {
          await recordFile(record.id).save(Buffer.alloc(0), {
            resumable: false,
            contentType: "application/octet-stream",
            metadata: { metadata: { [RECORD_METADATA_KEY]: encodeMetadataRecord(record) } },
            preconditionOpts: { ifGenerationMatch: 0 },
          });
        } catch (error) {
          if (statusOf(error) === 412) throw new StoreConflict(recordKey(record.id));
          throw error;
        }
      }),

    getRecord: (id) =>
      guard(async () => {
        try {
          return (await readRecord(recordFile(id)))?.record ?? null;
        } catch (error) {
          if (statusOf(error) === 404) return null;
          throw error;
        }
      }),

    updateRecord: (id, mutate) =>
      guard(async () => {
        const file = recordFile(id);
        for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
          try {
            const current = await readRecord(file);
            if (current === null) throw new RecordNotFound(id);
            const next = mutate(current.record);
            await file.setMetadata(
              { metadata: { [RECORD_METADATA_KEY]: encodeMetadataRecord(next) } },
              { ifMetagenerationMatch: current.metageneration },
            );
            return next;
          } catch (error) {
            const status = statusOf(error);
            if (status === 404) throw new RecordNotFound(id);
            if (status !== 412) throw error;
          }
        }
        throw new HubError("storage_unavailable", { reason: "cas_exhausted" });
      }),

    deleteRecord: (id) => guard(() => recordFile(id).delete({ ignoreNotFound: true }).then(() => undefined)),

    listRecords: () =>
      guard(async () => {
        const [files] = await records.getFiles({
          prefix: "r/",
          autoPaginate: true,
          fields: "items(name,metadata),nextPageToken",
        });
        const list: AssetRecord[] = [];
        for (const file of files) {
          const record = decodeMetadataRecord(file.metadata.metadata?.[RECORD_METADATA_KEY]);
          if (record === null) options.log.log("WARNING", "store.record_undecodable", { key: file.name });
          else list.push(record);
        }
        return list;
      }),
  };
}

function encodeMetadataRecord(record: AssetRecord): string {
  return Buffer.from(encodeRecord(record), "utf8").toString("base64url");
}

function decodeMetadataRecord(value: unknown): AssetRecord | null {
  if (typeof value !== "string") return null;
  return decodeRecord(Buffer.from(value, "base64url").toString("utf8"));
}

function statusOf(error: unknown): number | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "number" ? error.code : undefined;
}

async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof HubError || error instanceof StoreConflict || error instanceof RecordNotFound) throw error;
    throw new HubError("storage_unavailable", undefined, { cause: error });
  }
}
