import {
  type AssetId,
  type AssetPatch,
  type AssetRecord,
  type AssetSource,
  type AssetView,
  applyPatch,
  canDelete,
  type ClientName,
  type Email,
  type FileName,
  isoTimestamp,
  newAssetId,
  type Tag,
  toPlainView,
  toView,
} from "../shared/domain";
import type { ServiceAssetView } from "../shared/api";
import type { Actor } from "./auth";
import { HubError } from "./errors";
import type { Transcoder } from "./image";
import type { Logger } from "./log";
import { type AssetStore, RecordNotFound, StoreConflict } from "./store/store";

export interface IngestInput {
  readonly bytes: Uint8Array;
  readonly originalName: FileName;
  readonly source: AssetSource;
  readonly tags: readonly Tag[];
}

export interface ServiceIngestInput {
  readonly bytes: Uint8Array;
  readonly originalName: FileName;
  readonly tags: readonly Tag[];
  /** Checked against the allow-list by the caller. */
  readonly uploadedBy: { readonly email: Email; readonly name: string };
}

export interface Hub {
  ingest(actor: Actor, input: IngestInput): Promise<AssetView>;
  list(actor: Actor): Promise<AssetView[]>;
  update(actor: Actor, id: AssetId, patch: AssetPatch): Promise<AssetView>;
  remove(actor: Actor, id: AssetId): Promise<void>;
  /** Upload on behalf of a member through the service API. The asset belongs to `client`. */
  ingestForClient(client: ClientName, input: ServiceIngestInput): Promise<ServiceAssetView>;
  /** Delete an asset `client` uploaded. Idempotent; another uploader's asset is `forbidden`. */
  removeForClient(client: ClientName, id: AssetId): Promise<void>;
}

export interface HubDeps {
  readonly store: AssetStore;
  readonly transcode: Transcoder;
  readonly publicBaseUrl: string;
  readonly log: Logger;
  readonly now?: () => Date;
  readonly newId?: () => AssetId;
}

const ID_ATTEMPTS = 3;

export function createHub(deps: HubDeps): Hub {
  const { store, transcode, publicBaseUrl, log } = deps;
  const now = () => isoTimestamp(deps.now?.() ?? new Date());
  const newId = deps.newId ?? newAssetId;
  const view = (record: AssetRecord, actor: Actor): AssetView =>
    toView(record, { publicBaseUrl, viewer: { email: actor.email, isAdmin: actor.isAdmin } });

  async function putUnderFreshId(webp: Uint8Array): Promise<AssetId> {
    for (let attempt = 1; ; attempt++) {
      const id = newId();
      try {
        await store.putImage(id, webp);
        return id;
      } catch (error) {
        if (!(error instanceof StoreConflict) || attempt >= ID_ATTEMPTS) throw error;
      }
    }
  }

  return {
    async ingest(actor, input) {
      const record = await ingestRecord({ ...input, uploadedBy: { email: actor.email, name: actor.name }, client: null });
      return view(record, actor);
    },

    async ingestForClient(client, input) {
      const record = await ingestRecord({ ...input, source: "upload", client });
      return toPlainView(record, publicBaseUrl);
    },

    async list(actor) {
      const records = await store.listRecords();
      records.sort((a, b) => (a.createdAt === b.createdAt ? compare(a.id, b.id) : compare(b.createdAt, a.createdAt)));
      return records.map((r) => view(r, actor));
    },

    async update(actor, id, patch) {
      try {
        const record = await store.updateRecord(id, (current) => applyPatch(current, patch, now()));
        return view(record, actor);
      } catch (error) {
        if (error instanceof RecordNotFound) throw new HubError("not_found");
        throw error;
      }
    },

    async remove(actor, id) {
      const record = await store.getRecord(id);
      if (record === null) return;
      if (!canDelete({ email: actor.email, isAdmin: actor.isAdmin }, record)) throw new HubError("forbidden");
      await store.deleteImage(id);
      await store.deleteRecord(id);
      log.log("INFO", "asset.removed", { id, by: actor.email });
    },

    async removeForClient(client, id) {
      const record = await store.getRecord(id);
      if (record === null) return;
      if (record.client !== client) throw new HubError("forbidden");
      await store.deleteImage(id);
      await store.deleteRecord(id);
      log.log("INFO", "asset.removed", { id, client });
    },
  };

  async function ingestRecord(input: {
    readonly bytes: Uint8Array;
    readonly originalName: FileName;
    readonly source: AssetSource;
    readonly tags: readonly Tag[];
    readonly uploadedBy: AssetRecord["uploadedBy"];
    readonly client: ClientName | null;
  }): Promise<AssetRecord> {
    const out = await transcode(input.bytes);
    const id = await putUnderFreshId(out.webp);
    const at = now();
    const record: AssetRecord = {
      v: 1,
      id,
      tags: input.tags,
      originalName: input.originalName,
      source: input.source,
      width: out.width,
      height: out.height,
      originalSize: out.originalSize,
      frames: out.frames,
      originalBytes: input.bytes.byteLength,
      storedBytes: out.webp.byteLength,
      uploadedBy: input.uploadedBy,
      client: input.client,
      createdAt: at,
      updatedAt: at,
    };
    await store.createRecord(record);
    log.log("INFO", "asset.ingested", {
      id,
      by: record.uploadedBy.email,
      ...(record.client === null ? {} : { client: record.client }),
      format: out.inputFormat,
      originalBytes: record.originalBytes,
      storedBytes: record.storedBytes,
      frames: record.frames,
    });
    return record;
  }
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
