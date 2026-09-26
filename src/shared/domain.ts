declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issue: InputIssue };

const INPUT_ISSUES = [
  "asset_id_malformed",
  "tag_empty",
  "tag_too_long",
  "tag_forbidden_char",
  "too_many_tags",
  "source_unknown",
  "body_malformed",
] as const;

export type InputIssue = (typeof INPUT_ISSUES)[number];

export function parseInputIssue(raw: unknown): InputIssue | null {
  return INPUT_ISSUES.find((issue) => issue === raw) ?? null;
}

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = <T>(issue: InputIssue): Parsed<T> => ({ ok: false, issue });

export const ASSET_ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
export const ASSET_ID_LENGTH = 16;
const ASSET_ID_PATTERN = /^[0-9a-hjkmnp-tv-z]{16}$/;

export type AssetId = Brand<string, "AssetId">;

export function parseAssetId(raw: string): Parsed<AssetId> {
  return ASSET_ID_PATTERN.test(raw) ? ok(raw as AssetId) : fail("asset_id_malformed");
}

export function parseImageFileName(raw: string): AssetId | null {
  if (!raw.endsWith(".webp")) return null;
  const id = parseAssetId(raw.slice(0, -".webp".length));
  return id.ok ? id.value : null;
}

export function newAssetId(): AssetId {
  const bytes = crypto.getRandomValues(new Uint8Array((ASSET_ID_LENGTH * 5) / 8));
  let id = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      id += ASSET_ID_ALPHABET.charAt((buffer >> bits) & 31);
    }
    buffer &= (1 << bits) - 1;
  }
  return id as AssetId;
}

export type Email = Brand<string, "Email">;

export const EMAIL_MAX_CHARS = 254;
const EMAIL_PATTERN = /^[^\s@\p{Cc}]+@[^\s@\p{Cc}]+$/u;

export function parseEmail(raw: string): Email | null {
  const email = raw.trim().toLowerCase();
  if (email.length > EMAIL_MAX_CHARS || !EMAIL_PATTERN.test(email)) return null;
  return email as Email;
}

export function emailDomain(email: Email): string {
  return email.slice(email.lastIndexOf("@") + 1);
}

export const DISPLAY_NAME_MAX_CHARS = 100;

export function cleanDisplayName(raw: string): string {
  return truncate(collapseWhitespace(cleanText(raw).normalize("NFC")), DISPLAY_NAME_MAX_CHARS).trim();
}

// Every free-text parser applies `cleanText` first. Besides hygiene, this bounds JSON size:
// JSON.stringify writes control characters and lone surrogates as 6-byte `\uXXXX` escapes, while a
// cleaned string costs at most 4 bytes per code point. "Chars" in every *_MAX_CHARS below means
// code points (`Array.from(s).length`), never UTF-16 units.

export function cleanText(raw: string): string {
  return raw.toWellFormed().replace(/[\p{Cc}\u2028\u2029]/gu, "");
}

function truncate(s: string, maxChars: number): string {
  const chars = Array.from(s);
  return chars.length <= maxChars ? s : chars.slice(0, maxChars).join("");
}

function collapseWhitespace(s: string): string {
  return s.trim().replace(/\s+/gu, " ");
}

export const FILE_NAME_MAX_CHARS = 120;
export const TAG_MAX_CHARS = 32;
export const TAGS_MAX = 20;

export type FileName = Brand<string, "FileName">;

export function parseFileName(raw: string): FileName {
  const base = cleanText(raw).normalize("NFC").split(/[\\/]/u).pop() ?? "";
  const name = truncate(base.trim(), FILE_NAME_MAX_CHARS).trim();
  return (name === "" ? "image" : name) as FileName;
}

export type Tag = Brand<string, "Tag">;

export function parseTag(raw: string): Parsed<Tag> {
  const tag = collapseWhitespace(cleanText(raw).normalize("NFKC"));
  if (tag === "") return fail("tag_empty");
  if (/[,#]/u.test(tag)) return fail("tag_forbidden_char");
  if (Array.from(tag).length > TAG_MAX_CHARS) return fail("tag_too_long");
  return ok(tag as Tag);
}

export function foldForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/gu, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

export function tagKey(tag: Tag): string {
  return foldForMatch(tag);
}

export function parseTags(raw: readonly string[]): Parsed<readonly Tag[]> {
  const tags: Tag[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const tag = parseTag(entry);
    if (!tag.ok) return fail(tag.issue);
    const key = tagKey(tag.value);
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag.value);
    if (tags.length > TAGS_MAX) return fail("too_many_tags");
  }
  return ok(tags);
}

export type AssetSource = "upload" | "drive";

export function parseSource(raw: unknown): Parsed<AssetSource> {
  return raw === "upload" || raw === "drive" ? ok(raw) : fail("source_unknown");
}

export type IsoTimestamp = Brand<string, "IsoTimestamp">;

export function isoTimestamp(date: Date): IsoTimestamp {
  return date.toISOString() as IsoTimestamp;
}

export function parseIsoTimestamp(raw: string): IsoTimestamp | null {
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) || date.toISOString() !== raw ? null : (raw as IsoTimestamp);
}

export interface PixelSize {
  readonly width: number;
  readonly height: number;
}

export interface AssetRecord {
  readonly v: 1;
  readonly id: AssetId;
  readonly tags: readonly Tag[];
  readonly originalName: FileName;
  readonly source: AssetSource;
  readonly width: number;
  readonly height: number;
  /** Null only for records stored before this field existed. */
  readonly originalSize: PixelSize | null;
  readonly frames: number;
  readonly originalBytes: number;
  readonly storedBytes: number;
  readonly uploadedBy: { readonly email: Email; readonly name: string };
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export interface AssetPatch {
  readonly tags: readonly Tag[];
}

export interface Viewer {
  readonly email: Email;
  readonly isAdmin: boolean;
}

export interface AssetView {
  readonly id: AssetId;
  readonly url: string;
  readonly tags: readonly Tag[];
  readonly originalName: FileName;
  readonly source: AssetSource;
  readonly width: number;
  readonly height: number;
  readonly originalSize: PixelSize | null;
  readonly animated: boolean;
  readonly originalBytes: number;
  readonly storedBytes: number;
  readonly uploadedBy: { readonly email: Email; readonly name: string };
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly canDelete: boolean;
}

export function canDelete(viewer: Viewer, record: AssetRecord): boolean {
  return viewer.isAdmin || viewer.email === record.uploadedBy.email;
}

export function toView(record: AssetRecord, ctx: { readonly publicBaseUrl: string; readonly viewer: Viewer }): AssetView {
  return {
    id: record.id,
    url: `${ctx.publicBaseUrl}/${record.id}.webp`,
    tags: record.tags,
    originalName: record.originalName,
    source: record.source,
    width: record.width,
    height: record.height,
    originalSize: record.originalSize,
    animated: record.frames > 1,
    originalBytes: record.originalBytes,
    storedBytes: record.storedBytes,
    uploadedBy: record.uploadedBy,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    canDelete: canDelete(ctx.viewer, record),
  };
}

export function applyPatch(record: AssetRecord, patch: AssetPatch, now: IsoTimestamp): AssetRecord {
  return { ...record, tags: patch.tags, updatedAt: now };
}
