/**
 * The storage port. One store holds two kinds of object per asset:
 *
 *   image   `i/<id>.webp`   public bytes, written once, served with IMAGE_CACHE_CONTROL
 *   record  `r/<id>`        private AssetRecord
 *
 * Layout per driver:
 *
 *   local                 DATA_DIR/i/<id>.webp          DATA_DIR/r/<id>.json
 *   gcs                   gs://GCS_BUCKET/i/<id>.webp   gs://GCS_BUCKET/r/<id>
 *   gcs + public bucket   gs://GCS_PUBLIC_BUCKET/i/...  gs://GCS_BUCKET/r/<id>
 *
 * The image key is also the URL path, so one layout can be served by the app, by nginx, or by GCS
 * directly, and `derivePublicBaseUrl` only ever appends `/i`.
 *
 * One record per asset, not one index for all: each upload writes only its own keys, so concurrent
 * uploads from several Cloud Run instances never contend. The "index" is `listRecords()`, merged and
 * sorted at read time.
 *
 * Contract (contract.test.ts runs one suite against every driver):
 * - `putImage` / `createRecord` are create-only. An existing key -> `StoreConflict`, existing object
 *   untouched. Immutability of public bytes is a storage guarantee, not a probability argument.
 * - Writes are atomic: readers see the whole object or nothing. A half-written WebP must never be
 *   served under `immutable`.
 * - `deleteImage` / `deleteRecord` are idempotent: a missing key resolves.
 * - `updateRecord` is compare-and-swap and never resurrects: if the record vanished before commit it
 *   throws `RecordNotFound`, so a tag edit racing a delete cannot bring back a record whose image
 *   is gone.
 * - `listRecords` reflects every completed write and skips (and logs) undecodable records rather
 *   than failing the whole list.
 * - Transport failures surface as `HubError("storage_unavailable")`; SDK error types never leave the
 *   driver.
 */

import {
  type AssetId,
  type AssetRecord,
  cleanDisplayName,
  parseAssetId,
  parseEmail,
  parseFileName,
  parseIsoTimestamp,
  parseSource,
  parseTags,
} from "../../shared/domain";

export interface AssetStore {
  /** Create-only, atomic. Sets Content-Type image/webp and IMAGE_CACHE_CONTROL where the backend stores them. */
  putImage(id: AssetId, webp: Uint8Array): Promise<void>;
  /** For the `/i/` route. null when absent. */
  openImage(id: AssetId): Promise<StoredImage | null>;
  deleteImage(id: AssetId): Promise<void>;

  createRecord(record: AssetRecord): Promise<void>;
  getRecord(id: AssetId): Promise<AssetRecord | null>;
  /** Read-modify-write with CAS; retries internally on a lost race (max 3), then `storage_unavailable`. */
  updateRecord(id: AssetId, mutate: (current: AssetRecord) => AssetRecord): Promise<AssetRecord>;
  deleteRecord(id: AssetId): Promise<void>;
  /** Every decodable record, unordered. */
  listRecords(): Promise<AssetRecord[]>;
}

/**
 * An open image. `size` lets the public route send Content-Length instead of chunked encoding;
 * some image proxies refuse or truncate bodies of unknown length. The caller must consume or
 * cancel `body`.
 */
export interface StoredImage {
  readonly body: ReadableStream<Uint8Array>;
  readonly size: number;
}

export class StoreConflict extends Error {
  constructor(readonly key: string) {
    super(`object already exists: ${key}`);
    this.name = "StoreConflict";
  }
}

export class RecordNotFound extends Error {
  constructor(readonly id: AssetId) {
    super(`record not found: ${id}`);
    this.name = "RecordNotFound";
  }
}

export const IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** Attempts a driver makes at a compare-and-swap before giving up with `storage_unavailable`. */
export const CAS_ATTEMPTS = 3;

export function imageKey(id: AssetId): string {
  return `i/${id}.webp`;
}

export function recordKey(id: AssetId): string {
  return `r/${id}`;
}

// ── Record codec: the persisted schema, spelled once. Drivers only move the string. ──────────

/** Canonical JSON of an AssetRecord (`v` first, fixed key order). */
export function encodeRecord(record: AssetRecord): string {
  const canonical: AssetRecord = {
    v: 1,
    id: record.id,
    tags: record.tags,
    originalName: record.originalName,
    source: record.source,
    width: record.width,
    height: record.height,
    frames: record.frames,
    originalBytes: record.originalBytes,
    storedBytes: record.storedBytes,
    uploadedBy: { email: record.uploadedBy.email, name: record.uploadedBy.name },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
  return JSON.stringify(canonical);
}

/**
 * Stored data is a boundary too (files can be hand-edited, restored from old backups, or written by
 * a future version). Validates `v === 1` and every field through the domain parsers; returns null
 * instead of throwing so one bad record cannot blank the dashboard.
 */
export function decodeRecord(raw: string): AssetRecord | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(json) || json["v"] !== 1) return null;
  const { id, tags, originalName, source, width, height, frames, originalBytes, storedBytes, uploadedBy, createdAt, updatedAt } = json;

  const parsedId = typeof id === "string" ? parseAssetId(id) : null;
  const parsedTags = Array.isArray(tags) && tags.every((t) => typeof t === "string") ? parseTags(tags) : null;
  const parsedSource = parseSource(source);
  const by = isObject(uploadedBy) ? uploadedBy : {};
  const email = typeof by["email"] === "string" ? parseEmail(by["email"]) : null;
  const created = typeof createdAt === "string" ? parseIsoTimestamp(createdAt) : null;
  const updated = typeof updatedAt === "string" ? parseIsoTimestamp(updatedAt) : null;

  if (
    parsedId?.ok !== true ||
    parsedTags?.ok !== true ||
    !parsedSource.ok ||
    typeof originalName !== "string" ||
    typeof by["name"] !== "string" ||
    email === null ||
    created === null ||
    updated === null ||
    !isCount(width, 1) ||
    !isCount(height, 1) ||
    !isCount(frames, 1) ||
    !isCount(originalBytes, 0) ||
    !isCount(storedBytes, 0)
  ) {
    return null;
  }
  return {
    v: 1,
    id: parsedId.value,
    tags: parsedTags.value,
    originalName: parseFileName(originalName),
    source: parsedSource.value,
    width,
    height,
    frames,
    originalBytes,
    storedBytes,
    uploadedBy: { email, name: cleanDisplayName(by["name"]) },
    createdAt: created,
    updatedAt: updated,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown, min: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min;
}
