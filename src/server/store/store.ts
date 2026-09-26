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
  type PixelSize,
} from "../../shared/domain";

export interface AssetStore {
  putImage(id: AssetId, webp: Uint8Array): Promise<void>;
  openImage(id: AssetId): Promise<StoredImage | null>;
  deleteImage(id: AssetId): Promise<void>;

  createRecord(record: AssetRecord): Promise<void>;
  getRecord(id: AssetId): Promise<AssetRecord | null>;
  updateRecord(id: AssetId, mutate: (current: AssetRecord) => AssetRecord): Promise<AssetRecord>;
  deleteRecord(id: AssetId): Promise<void>;
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

export const CAS_ATTEMPTS = 3;

export function imageKey(id: AssetId): string {
  return `i/${id}.webp`;
}

export function recordKey(id: AssetId): string {
  return `r/${id}`;
}

export function encodeRecord(record: AssetRecord): string {
  const canonical: AssetRecord = {
    v: 1,
    id: record.id,
    tags: record.tags,
    originalName: record.originalName,
    source: record.source,
    width: record.width,
    height: record.height,
    originalSize: record.originalSize === null ? null : { width: record.originalSize.width, height: record.originalSize.height },
    frames: record.frames,
    originalBytes: record.originalBytes,
    storedBytes: record.storedBytes,
    uploadedBy: { email: record.uploadedBy.email, name: record.uploadedBy.name },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
  return JSON.stringify(canonical);
}

export function decodeRecord(raw: string): AssetRecord | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(json) || json["v"] !== 1) return null;
  const { id, tags, originalName, source, width, height, originalSize, frames, originalBytes, storedBytes, uploadedBy, createdAt, updatedAt } = json;

  const parsedId = typeof id === "string" ? parseAssetId(id) : null;
  const parsedTags = Array.isArray(tags) && tags.every((t) => typeof t === "string") ? parseTags(tags) : null;
  const parsedSource = parseSource(source);
  const by = isObject(uploadedBy) ? uploadedBy : {};
  const email = typeof by["email"] === "string" ? parseEmail(by["email"]) : null;
  const created = typeof createdAt === "string" ? parseIsoTimestamp(createdAt) : null;
  const updated = typeof updatedAt === "string" ? parseIsoTimestamp(updatedAt) : null;
  const parsedOriginalSize = decodeOriginalSize(originalSize);

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
    parsedOriginalSize === false ||
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
    originalSize: parsedOriginalSize,
    frames,
    originalBytes,
    storedBytes,
    uploadedBy: { email, name: cleanDisplayName(by["name"]) },
    createdAt: created,
    updatedAt: updated,
  };
}

/** `false` when present but invalid. Absent in records stored before the field existed; `null` once such a record is rewritten. */
function decodeOriginalSize(value: unknown): PixelSize | null | false {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) return false;
  const { width, height } = value;
  return isCount(width, 1) && isCount(height, 1) ? { width, height } : false;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown, min: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min;
}
