import type { DomainErrorCode } from "../server/errors";
import type { AssetPatch, AssetSource, AssetView, Email, FileName, Parsed, Tag } from "./domain";
import { cleanDisplayName, parseEmail, parseFileName, parseSource, parseTags } from "./domain";
import type { Locale } from "./i18n";

export const ROUTES = {
  shell: { method: "GET", path: "/", auth: "public", note: "SPA shell + BootConfig; sign-in screen when no session" },
  static: { method: "GET", path: "/static/*", auth: "public", note: "content-hashed build assets, immutable" },
  health: { method: "GET", path: "/health", auth: "public", note: "liveness; touches no storage" },
  image: { method: "GET", path: "/i/:id.webp", auth: "public", note: "public direct link; immutable; HEAD too" },
  signIn: { method: "POST", path: "/auth/google", auth: "public", note: "JSON {credential} from Google Identity Services; 204 + session cookie" },
  logout: { method: "POST", path: "/auth/logout", auth: "public", note: "clears the cookie; works with an expired session" },
  listAssets: { method: "GET", path: "/api/assets", auth: "member", note: "every asset, newest first" },
  uploadAsset: { method: "POST", path: "/api/assets", auth: "member", note: "raw file body + X-Upload-Meta header; 201 AssetView" },
  updateAsset: { method: "PATCH", path: "/api/assets/:id", auth: "member", note: "JSON {tags}; 200 AssetView" },
  deleteAsset: { method: "DELETE", path: "/api/assets/:id", auth: "member", note: "204; idempotent" },
  serviceUpload: { method: "POST", path: "/api/service/v1/assets", auth: "service", note: "Bearer token; raw file body + X-Upload-Meta {filename, tags, uploadedBy}; 201 ServiceAssetView" },
  serviceDelete: { method: "DELETE", path: "/api/service/v1/assets/:id", auth: "service", note: "Bearer token; only the client's own assets; 204; idempotent" },
} as const;

/** Server-to-server routes live under this prefix. They take a bearer token, never a cookie, and skip the Origin check. */
export const SERVICE_API_PREFIX = "/api/service/";

export type TransportErrorCode = "unauthenticated" | "cross_origin" | "invalid_input" | "too_large" | "internal";

export type ErrorCode = DomainErrorCode | TransportErrorCode;

export interface ErrorBody {
  readonly error: { readonly code: ErrorCode; readonly detail?: Readonly<Record<string, string | number>> };
}

export type ClientErrorCode = "network" | "drive_download";

export type AuthErrorCode = "not_allowed" | "email_unverified" | "login_failed";

const AUTH_ERROR_CODES: readonly AuthErrorCode[] = ["not_allowed", "email_unverified", "login_failed"];

export function parseAuthErrorCode(raw: string | null | undefined): AuthErrorCode | null {
  return AUTH_ERROR_CODES.find((code) => code === raw) ?? null;
}

export interface SignInRequest {
  readonly credential: string;
}

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

export const TRANSCODE_CONCURRENCY = 2;

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

export function encodeUploadMeta(meta: UploadMeta): string {
  const json: UploadMeta = { filename: parseFileName(meta.filename), source: meta.source, tags: meta.tags };
  return toBase64Url(new TextEncoder().encode(JSON.stringify(json)));
}

export function parseUploadMeta(header: string | null | undefined): Parsed<ParsedUploadMeta> {
  const malformed = { ok: false, issue: "body_malformed" } as const;
  const json = decodeMetaHeader(header);
  if (!isPlainObject(json) || !hasOnlyKeys(json, ["filename", "source", "tags"])) return malformed;
  const { filename, source: rawSource, tags: rawTags } = json;
  if (typeof filename !== "string" || !isStringArray(rawTags)) return malformed;
  const source = parseSource(rawSource);
  if (!source.ok) return source;
  const tags = parseTags(rawTags);
  if (!tags.ok) return tags;
  return { ok: true, value: { originalName: parseFileName(filename), source: source.value, tags: tags.value } };
}

/** `X-Upload-Meta` for `POST /api/service/v1/assets`. The service names the member it uploads for. */
export interface ServiceUploadMeta {
  readonly filename: string;
  readonly tags: readonly string[];
  readonly uploadedBy: { readonly email: string; readonly name?: string };
}

export interface ParsedServiceUploadMeta {
  readonly originalName: FileName;
  readonly tags: readonly Tag[];
  readonly uploadedBy: { readonly email: Email; readonly name: string };
}

export function encodeServiceUploadMeta(meta: ServiceUploadMeta): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(meta)));
}

export function parseServiceUploadMeta(header: string | null | undefined): Parsed<ParsedServiceUploadMeta> {
  const malformed = { ok: false, issue: "body_malformed" } as const;
  const json = decodeMetaHeader(header);
  if (!isPlainObject(json) || !hasOnlyKeys(json, ["filename", "tags", "uploadedBy"])) return malformed;
  const { filename, tags: rawTags, uploadedBy } = json;
  if (typeof filename !== "string" || !isStringArray(rawTags) || !isPlainObject(uploadedBy) || !hasOnlyKeys(uploadedBy, ["email", "name"])) {
    return malformed;
  }
  const { email: rawEmail, name: rawName } = uploadedBy;
  const email = typeof rawEmail === "string" ? parseEmail(rawEmail) : null;
  if (email === null || (rawName !== undefined && typeof rawName !== "string")) return malformed;
  const tags = parseTags(rawTags);
  if (!tags.ok) return tags;
  const name = cleanDisplayName(rawName ?? "") || email;
  return { ok: true, value: { originalName: parseFileName(filename), tags: tags.value, uploadedBy: { email, name } } };
}

/** What the service API returns for an asset: the browser view without the viewer-specific `canDelete`. */
export type ServiceAssetView = Omit<AssetView, "canDelete">;

export interface UpdateAssetBody {
  readonly tags: readonly string[];
}

export function parseUpdateAssetBody(json: unknown): Parsed<AssetPatch> {
  if (!isPlainObject(json) || !hasOnlyKeys(json, ["tags"]) || !isStringArray(json["tags"])) {
    return { ok: false, issue: "body_malformed" };
  }
  const tags = parseTags(json["tags"]);
  return tags.ok ? { ok: true, value: { tags: tags.value } } : tags;
}

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
  readonly localeFixed: boolean;
  readonly session: SignedInBoot | SignedOutBoot;
  readonly upload: {
    readonly maxBytes: number;
    readonly maxDimension: number;
    readonly quality: number;
    readonly accept: string;
  };
  readonly drive: DriveBootConfig | null;
}

export interface SignedInBoot {
  readonly state: "signed-in";
  readonly user: BootUser;
  readonly assets: readonly AssetView[] | null;
}

export interface SignedOutBoot {
  readonly state: "signed-out";
  readonly authError: AuthErrorCode | null;
  readonly signIn: GoogleSignInBoot;
}

export interface GoogleSignInBoot {
  readonly clientId: string;
  readonly nonce: string;
  readonly hostedDomain: string | null;
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
  readonly appId: string;
}

/** base64url JSON from an upload header; `undefined` when absent, oversized or malformed. */
function decodeMetaHeader(header: string | null | undefined): unknown {
  if (header == null || header.length > 12_288) return undefined;
  const bytes = fromBase64Url(header);
  if (bytes === null) return undefined;
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

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
