/**
 * Domain vocabulary shared by the server and the browser bundle.
 * Pure: no I/O, no framework imports, no Node-only APIs.
 *
 * Every branded type is minted only by its `parse*` (or `new*`) function, so holding one proves the
 * value already passed validation. Parse at the edge, trust inside.
 */

declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issue: InputIssue };

/** Machine-readable reasons a user-supplied value was rejected. The client translates them. */
export type InputIssue =
  | "asset_id_malformed"
  | "tag_empty"
  | "tag_too_long"
  | "tag_forbidden_char"
  | "too_many_tags"
  | "source_unknown"
  | "body_malformed";

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = <T>(issue: InputIssue): Parsed<T> => ({ ok: false, issue });

// ── Asset id ────────────────────────────────────────────────────────────────────────────────

/** Crockford base32, lowercase (no i, l, o, u). */
export const ASSET_ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
/** 16 chars x 5 bits = 80 random bits. */
export const ASSET_ID_LENGTH = 16;
const ASSET_ID_PATTERN = /^[0-9a-hjkmnp-tv-z]{16}$/;

/**
 * The only name a stored image or record ever has.
 *
 * Invariants:
 * - Unguessable (80 CSPRNG bits). Every image is public by link, but the library as a whole must not
 *   be enumerable, so ids are never sequential or time-derived.
 * - Lowercase only, so it survives tools that case-fold URLs.
 * - Never reused and never rewritten: stores enforce create-only writes. That is what makes
 *   `Cache-Control: immutable` and `ETag: "<id>"` truthful.
 * - Matches ASSET_ID_PATTERN, so a storage key built from it cannot traverse paths.
 */
export type AssetId = Brand<string, "AssetId">;

export function parseAssetId(raw: string): Parsed<AssetId> {
  return ASSET_ID_PATTERN.test(raw) ? ok(raw as AssetId) : fail("asset_id_malformed");
}

/** `"<id>.webp"` -> id; anything else -> null. The public `/i/` route accepts nothing else. */
export function parseImageFileName(raw: string): AssetId | null {
  if (!raw.endsWith(".webp")) return null;
  const id = parseAssetId(raw.slice(0, -".webp".length));
  return id.ok ? id.value : null;
}

/** Fresh id from `crypto.getRandomValues` (Web Crypto: identical in Node 24 and browsers). */
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

// ── People ──────────────────────────────────────────────────────────────────────────────────

/** Trimmed, lowercased address. The comparison key for allow-lists and ownership. */
export type Email = Brand<string, "Email">;

export const EMAIL_MAX_CHARS = 254;
const EMAIL_PATTERN = /^[^\s@\p{Cc}]+@[^\s@\p{Cc}]+$/u;

export function parseEmail(raw: string): Email | null {
  const email = raw.trim().toLowerCase();
  if (email.length > EMAIL_MAX_CHARS || !EMAIL_PATTERN.test(email)) return null;
  return email as Email;
}

/** Domain part of an email, lowercased. Exact comparisons only; never `endsWith`. */
export function emailDomain(email: Email): string {
  return email.slice(email.lastIndexOf("@") + 1);
}

export const DISPLAY_NAME_MAX_CHARS = 100;

/** Total: a Google profile name made safe to store and display. */
export function cleanDisplayName(raw: string): string {
  return truncate(collapseWhitespace(cleanText(raw).normalize("NFC")), DISPLAY_NAME_MAX_CHARS).trim();
}

// ── Descriptive fields ──────────────────────────────────────────────────────────────────────
//
// Every free-text parser applies `cleanText` first. Besides hygiene, this bounds JSON size:
// JSON.stringify writes control characters and lone surrogates as 6-byte `\uXXXX` escapes, while a
// cleaned string costs at most 4 bytes per code point. "Chars" in every *_MAX_CHARS below means
// code points (`Array.from(s).length`), never UTF-16 units.

/** Lone surrogates -> U+FFFD; control characters (\p{Cc}) and U+2028/U+2029 removed. */
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

/**
 * The name the file had on the uploader's machine or in Drive. Display, search and Markdown alt
 * text only; never used to build a storage key.
 * Normalised: NFC, path components stripped (`C:\x\a.png` -> `a.png`), control chars removed,
 * truncated to FILE_NAME_MAX_CHARS. Empty -> `"image"`.
 */
export type FileName = Brand<string, "FileName">;

/** Total: any string becomes a FileName. */
export function parseFileName(raw: string): FileName {
  const base = cleanText(raw).normalize("NFC").split(/[\\/]/u).pop() ?? "";
  const name = truncate(base.trim(), FILE_NAME_MAX_CHARS).trim();
  return (name === "" ? "image" : name) as FileName;
}

/**
 * Display form of a tag: NFKC (full-width ASCII folds to half-width), trimmed, inner whitespace
 * collapsed, 1..TAG_MAX_CHARS chars, no `,` or `#` (the tag editor uses them as separators).
 */
export type Tag = Brand<string, "Tag">;

export function parseTag(raw: string): Parsed<Tag> {
  const tag = collapseWhitespace(cleanText(raw).normalize("NFKC"));
  if (tag === "") return fail("tag_empty");
  if (/[,#]/u.test(tag)) return fail("tag_forbidden_char");
  if (Array.from(tag).length > TAG_MAX_CHARS) return fail("tag_too_long");
  return ok(tag as Tag);
}

/**
 * Comparison key for search and tags: NFKC, lowercase, katakana folded to hiragana. So `ＬＯＧＯ`
 * finds `logo`, and `あいこん` finds `アイコン`.
 */
export function foldForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/gu, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/**
 * Identity of a tag: `tagKey("ChatIcon") === tagKey("chaticon")`, and `"アイコン"` and `"あいこん"` are
 * one tag. Filtering and de-duplication compare keys, never display forms.
 */
export function tagKey(tag: Tag): string {
  return foldForMatch(tag);
}

/** Parses each tag, de-duplicates by tagKey (first display form wins), enforces TAGS_MAX. */
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

/** `Date.prototype.toISOString()` output. Sorts lexicographically in time order. */
export type IsoTimestamp = Brand<string, "IsoTimestamp">;

export function isoTimestamp(date: Date): IsoTimestamp {
  return date.toISOString() as IsoTimestamp;
}

export function parseIsoTimestamp(raw: string): IsoTimestamp | null {
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) || date.toISOString() !== raw ? null : (raw as IsoTimestamp);
}

// ── Records and views ───────────────────────────────────────────────────────────────────────

/**
 * The persisted fact about one asset. Private: never served to anonymous readers, never attached
 * to the public image object.
 *
 * Deliberately absent:
 * - the public URL: derived from config at read time (`publicUrl`), so changing IMAGE_BASE_URL
 *   needs no migration;
 * - who may delete it: derived from the viewer (`canDelete`).
 *
 * Size invariant: with the *_MAX_CHARS limits above, the worst-case record encodes well under the
 * 8 KiB custom-metadata cap the GCS store relies on. `store/record-size.test.ts` builds that worst
 * case through the parsers, so raising a limit fails CI instead of failing uploads in production.
 */
export interface AssetRecord {
  readonly v: 1;
  readonly id: AssetId;
  readonly tags: readonly Tag[];
  readonly originalName: FileName;
  readonly source: AssetSource;
  readonly width: number;
  /** Per frame. */
  readonly height: number;
  /** 1 = still image; > 1 = animated WebP. */
  readonly frames: number;
  readonly originalBytes: number;
  readonly storedBytes: number;
  readonly uploadedBy: { readonly email: Email; readonly name: string };
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

/** The only edit a record accepts. Replace semantics. */
export interface AssetPatch {
  readonly tags: readonly Tag[];
}

/** Who is looking. `hub.ts` builds this from an authenticated Actor; the domain never sees HTTP. */
export interface Viewer {
  readonly email: Email;
  readonly isAdmin: boolean;
}

/**
 * Read model for signed-in viewers. JSON-safe by construction (strings, numbers, booleans), so the
 * same type crosses the wire to the browser without a parallel DTO.
 */
export interface AssetView {
  readonly id: AssetId;
  /** Immutable public direct link. */
  readonly url: string;
  readonly tags: readonly Tag[];
  readonly originalName: FileName;
  readonly source: AssetSource;
  readonly width: number;
  readonly height: number;
  readonly animated: boolean;
  readonly originalBytes: number;
  readonly storedBytes: number;
  readonly uploadedBy: { readonly email: Email; readonly name: string };
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  /** Pre-computed so the UI never re-implements the delete policy. */
  readonly canDelete: boolean;
}

/** `${publicBaseUrl}/${id}.webp`. The single place a public URL is spelled. */
export function publicUrl(publicBaseUrl: string, id: AssetId): string {
  return `${publicBaseUrl}/${id}.webp`;
}

/**
 * Delete policy: the uploader or an admin. Editing tags is open to every member (shared curation);
 * deleting breaks every webhook that embeds the link, so it is narrower.
 */
export function canDelete(viewer: Viewer, record: AssetRecord): boolean {
  return viewer.isAdmin || viewer.email === record.uploadedBy.email;
}

export function toView(record: AssetRecord, ctx: { readonly publicBaseUrl: string; readonly viewer: Viewer }): AssetView {
  return {
    id: record.id,
    url: publicUrl(ctx.publicBaseUrl, record.id),
    tags: record.tags,
    originalName: record.originalName,
    source: record.source,
    width: record.width,
    height: record.height,
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
