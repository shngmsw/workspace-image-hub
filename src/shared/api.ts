/**
 * The HTTP contract between the browser bundle and the server: routes, request encodings, error
 * codes, and the boot payload. Both sides import this file, so the wire format is spelled once.
 *
 * Responses reuse `AssetView` from domain.ts: it is already JSON-safe, and a structurally
 * identical DTO would be a pass-through type.
 */

import type { DomainErrorCode } from "../server/errors";
import type { AssetPatch, AssetSource, AssetView, Email, FileName, Parsed, Tag } from "./domain";
import { parseFileName, parseSource, parseTags } from "./domain";
import type { Locale } from "./i18n";

// ── Routes ──────────────────────────────────────────────────────────────────────────────────

/**
 * Every route the server answers. `auth` says who may call it.
 * - public: anyone, no cookie needed.
 * - member: valid session whose identity still passes the *current* allow-list.
 * Every non-GET route additionally requires `Origin` === APP_URL origin (CSRF), checked once in
 * app.ts middleware, so no handler can forget it.
 *
 * There is deliberately no token-authenticated API: the SPA is the only client.
 */
export const ROUTES = {
  shell: { method: "GET", path: "/", auth: "public", note: "SPA shell + BootConfig; sign-in screen when no session" },
  static: { method: "GET", path: "/static/*", auth: "public", note: "content-hashed build assets, immutable" },
  health: { method: "GET", path: "/healthz", auth: "public", note: "liveness; touches no storage" },
  image: { method: "GET", path: "/i/:id.webp", auth: "public", note: "public direct link; immutable; HEAD too" },
  signIn: { method: "POST", path: "/auth/google", auth: "public", note: "JSON {credential} from Google Identity Services; 204 + session cookie" },
  logout: { method: "POST", path: "/auth/logout", auth: "public", note: "clears the cookie; works with an expired session" },
  listAssets: { method: "GET", path: "/api/assets", auth: "member", note: "every asset, newest first" },
  uploadAsset: { method: "POST", path: "/api/assets", auth: "member", note: "raw file body + X-Upload-Meta header; 201 AssetView" },
  updateAsset: { method: "PATCH", path: "/api/assets/:id", auth: "member", note: "JSON {tags}; 200 AssetView" },
  deleteAsset: { method: "DELETE", path: "/api/assets/:id", auth: "member", note: "204; idempotent" },
} as const;

// ── Errors ──────────────────────────────────────────────────────────────────────────────────

/**
 * Codes only the HTTP shell produces (auth, CSRF, request parsing, body cap, unexpected throw).
 * The core throws `DomainErrorCode`s (server/errors.ts) and can never raise one of these.
 */
export type TransportErrorCode = "unauthenticated" | "cross_origin" | "invalid_input" | "too_large" | "internal";

/** Stable codes on the wire. The server never sends user-facing prose; the client maps codes via i18n. */
export type ErrorCode = DomainErrorCode | TransportErrorCode;

export interface ErrorBody {
  readonly error: { readonly code: ErrorCode; readonly detail?: Readonly<Record<string, string | number>> };
}

/** Failures the browser detects without a server answer. Translated alongside ErrorCode. */
export type ClientErrorCode = "network" | "drive_download";

// ── Sign-in ─────────────────────────────────────────────────────────────────────────────────

/** Reasons `POST /auth/google` refused to create a session; shown on the sign-in screen. */
export type AuthErrorCode = "not_allowed" | "email_unverified" | "login_failed";

const AUTH_ERROR_CODES: readonly AuthErrorCode[] = ["not_allowed", "email_unverified", "login_failed"];

export function parseAuthErrorCode(raw: string | null | undefined): AuthErrorCode | null {
  return AUTH_ERROR_CODES.find((code) => code === raw) ?? null;
}

/** Body of `POST /auth/google`: the ID token Google Identity Services handed to the page. */
export interface SignInRequest {
  readonly credential: string;
}

/** Body of a refused `POST /auth/google` (401 or 403). Success is 204 with the session cookie. */
export interface SignInFailure {
  readonly authError: AuthErrorCode;
}

/** An ID token is three base64url segments; Google's are ~1-2 KB. */
export function parseSignInRequest(json: unknown): string | null {
  if (!isPlainObject(json) || Object.keys(json).length !== 1) return null;
  const credential = json["credential"];
  return typeof credential === "string" && credential.length <= 8192 && /^[\w-]+\.[\w-]+\.[\w-]+$/u.test(credential)
    ? credential
    : null;
}

// ── Assets ──────────────────────────────────────────────────────────────────────────────────

export interface ListAssetsResponse {
  readonly assets: readonly AssetView[];
}

/**
 * Upload = one file per request. The body is the raw file (`application/octet-stream`), so the
 * server can stop reading the moment MAX_UPLOAD_MB is exceeded and each file gets its own result.
 * Metadata rides in one `X-Upload-Meta` header (base64url JSON), not the query string, which
 * reverse proxies and Cloud Run write to request logs.
 */
export const UPLOAD_META_HEADER = "X-Upload-Meta";

export interface UploadMeta {
  readonly filename: string;
  readonly source: AssetSource;
  readonly tags: readonly string[];
}

export interface ParsedUploadMeta {
  readonly originalName: FileName;
  readonly source: AssetSource;
  readonly tags: readonly Tag[];
}

/** The client sends the name already cleaned and truncated, which keeps the header small. */
export function encodeUploadMeta(meta: UploadMeta): string {
  const json: UploadMeta = { filename: parseFileName(meta.filename), source: meta.source, tags: meta.tags };
  return toBase64Url(new TextEncoder().encode(JSON.stringify(json)));
}

export function parseUploadMeta(header: string | null | undefined): Parsed<ParsedUploadMeta> {
  const malformed = { ok: false, issue: "body_malformed" } as const;
  if (header == null || header.length > 12_288) return malformed;
  const bytes = fromBase64Url(header);
  if (bytes === null) return malformed;
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return malformed;
  }
  if (!isPlainObject(json) || !hasOnlyKeys(json, ["filename", "source", "tags"])) return malformed;
  const { filename, source: rawSource, tags: rawTags } = json;
  if (typeof filename !== "string" || !isStringArray(rawTags)) return malformed;
  const source = parseSource(rawSource);
  if (!source.ok) return source;
  const tags = parseTags(rawTags);
  if (!tags.ok) return tags;
  return { ok: true, value: { originalName: parseFileName(filename), source: source.value, tags: tags.value } };
}

export interface UpdateAssetBody {
  readonly tags: readonly string[];
}

/** `unknown` in, domain patch out. Rejects unknown keys and a missing `tags`. */
export function parseUpdateAssetBody(json: unknown): Parsed<AssetPatch> {
  if (!isPlainObject(json) || !hasOnlyKeys(json, ["tags"]) || !isStringArray(json["tags"])) {
    return { ok: false, issue: "body_malformed" };
  }
  const tags = parseTags(json["tags"]);
  return tags.ok ? { ok: true, value: { tags: tags.value } } : tags;
}

// ── Boot payload ────────────────────────────────────────────────────────────────────────────

export const BOOT_ELEMENT_ID = "wih-boot";

/**
 * Runtime configuration the server embeds in the HTML shell as
 * `<script id="wih-boot" type="application/json">`. This replaces build-time inlining: one prebuilt
 * bundle, every value decided per request from env + session.
 *
 * Contains no secrets. `drive.apiKey` is a browser API key by design (Google requires it in the
 * page for the Picker); operators restrict it by HTTP referrer and to the Picker API.
 */
export interface BootConfig {
  readonly appName: string;
  readonly locale: Locale;
  /** true when APP_LOCALE pins the language; the UI hides the language toggle. */
  readonly localeFixed: boolean;
  readonly session: SignedInBoot | SignedOutBoot;
  readonly upload: {
    readonly maxBytes: number;
    readonly maxDimension: number;
    readonly quality: number;
    /** Value for `<input accept>`; the server still sniffs the real format. */
    readonly accept: string;
  };
  /** null when GOOGLE_PICKER_API_KEY is unset: the Drive button is not rendered at all. */
  readonly drive: DriveBootConfig | null;
}

export interface SignedInBoot {
  readonly state: "signed-in";
  readonly user: BootUser;
  /** The catalog, saving the first round trip. null when storage failed; the client then fetches. */
  readonly assets: readonly AssetView[] | null;
}

export interface SignedOutBoot {
  readonly state: "signed-out";
  readonly authError: AuthErrorCode | null;
  readonly signIn: GoogleSignInBoot;
}

/** What the Google Identity Services button needs. */
export interface GoogleSignInBoot {
  readonly clientId: string;
  /** Also set as an HttpOnly cookie; the server accepts only an ID token carrying this nonce. */
  readonly nonce: string;
  /** GIS `hd` hint: set only when exactly one domain and no individual emails are allowed. */
  readonly hostedDomain: string | null;
  /** Shown as a hint on the sign-in screen. Individual allowed emails are never disclosed. */
  readonly allowedDomains: readonly string[];
}

export interface BootUser {
  readonly email: Email;
  readonly name: string;
  readonly picture: string | null;
  readonly isAdmin: boolean;
}

export interface DriveBootConfig {
  readonly clientId: string;
  readonly apiKey: string;
  /** Cloud project number: GOOGLE_PROJECT_NUMBER, or derived from the OAuth client id prefix. */
  readonly appId: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((k) => keys.includes(k));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[\w-]*$/u.test(text) || text.length % 4 === 1) return null;
  const base64 = text.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
