/**
 * The core. Four operations on the asset library, each taking the Actor that asked:
 *
 *   ingest  bytes -> WebP -> stored image + record -> AssetView
 *   list    every record -> AssetView[] (newest first)
 *   update  tags
 *   remove  image, then record
 *
 * Hidden behind these four: format sniffing and pixel limits (via the Transcoder), id generation
 * and collision retry, the commit order that keeps storage consistent across crashes, the delete
 * policy, record CAS (via the store), and public URL derivation. Inputs arrive already parsed into
 * domain types, so the hub never re-validates.
 *
 * Framework-free and I/O-free except through `AssetStore` and `Transcoder`, so tests run it against
 * an in-memory store and real sharp.
 */

import {
  type AssetId,
  type AssetPatch,
  type AssetRecord,
  type AssetSource,
  type AssetView,
  applyPatch,
  canDelete,
  type FileName,
  isoTimestamp,
  newAssetId,
  type Tag,
  toView,
} from "../shared/domain";
import type { Actor } from "./auth";
import { HubError } from "./errors";
import type { Transcoder } from "./image";
import type { Logger } from "./log";
import { type AssetStore, RecordNotFound, StoreConflict } from "./store/store";

/** Structurally `ParsedUploadMeta & { bytes }`, so the route spreads the parsed header straight in. */
export interface IngestInput {
  /** Already capped at MAX_UPLOAD_MB by the HTTP boundary (app.ts reads the body with a limit). */
  readonly bytes: Uint8Array;
  readonly originalName: FileName;
  readonly source: AssetSource;
  readonly tags: readonly Tag[];
}

export interface Hub {
  /**
   * Commit protocol (the record is the commit point):
   *   1. transcode                    (nothing written yet; bad input costs no storage)
   *   2. id = newAssetId()
   *   3. store.putImage(id, webp)     create-only; StoreConflict -> new id, retry (max 3)
   *   4. store.createRecord(record)   create-only
   *   5. return toView(record)
   * Crash after 3: an orphan image nobody knows the URL of (the response was never sent), and no
   * record, so it is not listed. A retried request makes a second asset: no dedup, because two
   * people may legitimately upload the same logo with different tags.
   */
  ingest(actor: Actor, input: IngestInput): Promise<AssetView>;

  /** Every asset, `createdAt` desc then id. The client filters (shared/query.ts). */
  list(actor: Actor): Promise<AssetView[]>;

  /**
   * Any member may edit. A missing record -> HubError("not_found").
   * Concurrent edits of one asset: CAS in the store prevents torn writes; with replace semantics
   * the last writer's tag list wins.
   */
  update(actor: Actor, id: AssetId, patch: AssetPatch): Promise<AssetView>;

  /**
   * Order (the public effect first):
   *   1. record = store.getRecord(id)        null -> resolve (already deleted: idempotent)
   *   2. canDelete(actor, record) or HubError("forbidden")
   *   3. store.deleteImage(id)               the origin stops serving it
   *   4. store.deleteRecord(id)
   * Crash after 3: record still listed, image gone; pressing delete again finishes the job. The
   * opposite order could leave a public image with no record, i.e. a link nobody can find to delete.
   *
   * Delete cannot reach copies already cached under IMAGE_CACHE_CONTROL (one year, immutable) by
   * browsers, Chat/GitHub/Notion image proxies, a CDN, or Google's edge cache for public buckets.
   * The confirm dialog says so. Delete means "unlisted and gone at origin", not "recalled".
   */
  remove(actor: Actor, id: AssetId): Promise<void>;
}

export interface HubDeps {
  readonly store: AssetStore;
  readonly transcode: Transcoder;
  /** From config.publicBaseUrl. */
  readonly publicBaseUrl: string;
  readonly log: Logger;
  /** Injected for tests. */
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
        frames: out.frames,
        originalBytes: input.bytes.byteLength,
        storedBytes: out.webp.byteLength,
        uploadedBy: { email: actor.email, name: actor.name },
        createdAt: at,
        updatedAt: at,
      };
      await store.createRecord(record);
      log.log("INFO", "asset.ingested", {
        id,
        by: actor.email,
        format: out.inputFormat,
        originalBytes: record.originalBytes,
        storedBytes: record.storedBytes,
        frames: record.frames,
      });
      return view(record, actor);
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
  };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
