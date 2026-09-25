import type { DriveBootConfig } from "../shared/api";
import { type Email, emailDomain, parseEmail } from "../shared/domain";
import { type Locale, parseLocale } from "../shared/i18n";
import type { TranscodePolicy } from "./image";

export type EnvGroup = "Core" | "Auth" | "Google Drive import" | "Storage" | "Image policy";

export interface EnvVarSpec {
  readonly name: string;
  readonly group: EnvGroup;
  readonly required: boolean | "gcs";
  readonly default?: string;
  readonly secret?: true;
  readonly example?: string;
  readonly doc: string;
}

export const ENV_VARS = [
  { name: "APP_URL", group: "Core", required: true, example: "http://localhost:3000", doc: "Public origin of the app, e.g. https://img.example.com. No path. Add it to the OAuth client's Authorized JavaScript origins." },
  { name: "APP_NAME", group: "Core", required: false, default: "Image Hub", doc: "Product name shown in the UI and page title." },
  { name: "APP_LOCALE", group: "Core", required: false, default: "auto", doc: "auto | ja | en. auto = the user's language toggle, then Accept-Language." },
  { name: "PORT", group: "Core", required: false, default: "3000", doc: "Listen port. Cloud Run injects 8080." },
  { name: "AUTH_SECRET", group: "Auth", required: true, secret: true, doc: "At least 32 characters. Signs session cookies. Generate with `openssl rand -base64 32`." },
  { name: "GOOGLE_CLIENT_ID", group: "Auth", required: true, doc: "OAuth 2.0 Web client id (<project-number>-<hash>.apps.googleusercontent.com). Used by the Sign in with Google button and the Drive picker." },
  { name: "ALLOWED_DOMAINS", group: "Auth", required: false, default: "", doc: "Comma list of Google Workspace domains, e.g. example.com,example.co.jp. A managed account (ID token has `hd`) passes when `hd` or its email domain is listed, exactly. Consumer accounts never pass a domain rule." },
  { name: "ALLOWED_EMAILS", group: "Auth", required: false, default: "", doc: "Comma list of individual addresses (any Google account). At least one of ALLOWED_DOMAINS / ALLOWED_EMAILS must be set." },
  { name: "ADMIN_EMAILS", group: "Auth", required: false, default: "", doc: "Comma list of members who may delete any image. Everyone else may delete only their own." },
  { name: "SESSION_TTL_HOURS", group: "Auth", required: false, default: "12", doc: "Session lifetime in hours (1..720). A member removed in Google Workspace keeps access at most this long; removing them from the allow-list cuts access on the next request." },
  { name: "GOOGLE_PICKER_API_KEY", group: "Google Drive import", required: false, default: "", doc: "Browser API key restricted to the Picker API and the APP_URL referrer. Unset = the Drive button is hidden." },
  { name: "GOOGLE_PROJECT_NUMBER", group: "Google Drive import", required: false, default: "", doc: "Cloud project number for the Picker. Derived from GOOGLE_CLIENT_ID when unset." },
  { name: "STORAGE_DRIVER", group: "Storage", required: false, default: "local", doc: "local | gcs. local is refused on Cloud Run, whose disk is ephemeral." },
  { name: "DATA_DIR", group: "Storage", required: false, default: "./data", doc: "local driver root. Must support hard links. The Docker image sets /data (a volume)." },
  { name: "GCS_BUCKET", group: "Storage", required: "gcs", doc: "Private bucket for records, and for images unless GCS_PUBLIC_BUCKET is set." },
  { name: "GCS_PUBLIC_BUCKET", group: "Storage", required: false, default: "", doc: "Optional public-read bucket for images only. Links then point at storage.googleapis.com and keep working while the app is down." },
  { name: "IMAGE_BASE_URL", group: "Storage", required: false, default: "", doc: "Override the base of public links (CDN or custom domain). Default: APP_URL/i, or the public bucket URL." },
  { name: "IMAGE_MAX_DIMENSION", group: "Image policy", required: false, default: "1024", doc: "Long-edge cap in px (16..8192). Images are never upscaled." },
  { name: "WEBP_QUALITY", group: "Image policy", required: false, default: "80", doc: "WebP quality (1..100)." },
  { name: "MAX_UPLOAD_MB", group: "Image policy", required: false, default: "20", doc: "Per-file upload cap in MiB (1..100; at most 31 on Cloud Run, whose request limit is 32 MiB)." },
  { name: "IMAGE_MAX_INPUT_PIXELS", group: "Image policy", required: false, default: "100000000", doc: "Decoded pixels allowed per upload, all animation frames counted (1000000..1000000000). Guards memory against pixel bombs." },
] as const satisfies readonly EnvVarSpec[];

export type EnvName = (typeof ENV_VARS)[number]["name"];

export type StorageConfig =
  | { readonly driver: "local"; readonly dataDir: string }
  | {
      readonly driver: "gcs";
      readonly bucket: string;
      readonly publicBucket: string | null;
    };

export interface AccessPolicy {
  readonly domains: ReadonlySet<string>;
  readonly emails: ReadonlySet<Email>;
  readonly admins: ReadonlySet<Email>;
}

export interface ImagePolicy extends TranscodePolicy {
  readonly maxUploadBytes: number;
}

export interface Config {
  readonly port: number;
  readonly appUrl: URL;
  readonly appName: string;
  readonly pinnedLocale: Locale | null;
  readonly auth: {
    readonly secret: string;
    readonly clientId: string;
    readonly sessionTtlSeconds: number;
  };
  readonly access: AccessPolicy;
  readonly drive: DriveBootConfig | null;
  readonly storage: StorageConfig;
  readonly publicBaseUrl: string;
  readonly image: ImagePolicy;
  readonly warnings: readonly string[];
}

export class ConfigError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

export function loadConfig(rawEnv: Readonly<Record<string, string | undefined>>): Config {
  const issues: string[] = [];
  const warnings: string[] = [];
  const env = (name: EnvName): string => {
    const value = rawEnv[name]?.trim() ?? "";
    if (value !== "") return value;
    const spec: EnvVarSpec | undefined = ENV_VARS.find((v) => v.name === name);
    return spec?.default ?? "";
  };
  const required = (name: EnvName): string => {
    const value = env(name);
    if (value === "") issues.push(`${name} is required.`);
    return value;
  };
  const int = (name: EnvName, min: number, max: number): number => {
    const raw = env(name);
    const value = Number(raw);
    if (!/^\d+$/u.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
      issues.push(`${name} must be an integer from ${min} to ${max} (got "${raw}").`);
      return min;
    }
    return value;
  };
  const emailList = (name: EnvName): ReadonlySet<Email> => {
    const emails = new Set<Email>();
    for (const entry of splitList(env(name))) {
      const email = parseEmail(entry);
      if (email === null) issues.push(`${name} contains an invalid address: "${entry}".`);
      else emails.add(email);
    }
    return emails;
  };

  const onCloudRun = (rawEnv["K_SERVICE"] ?? "") !== "";

  const appUrl = parseAppUrl(required("APP_URL"), issues);
  if (appUrl !== null && appUrl.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(appUrl.hostname)) {
    warnings.push(`APP_URL ${appUrl.origin} is not https: session cookies are sent without the Secure flag.`);
  }
  const appName = env("APP_NAME");
  const localeRaw = env("APP_LOCALE");
  const pinnedLocale = localeRaw === "auto" ? null : parseLocale(localeRaw);
  if (localeRaw !== "auto" && pinnedLocale === null) issues.push(`APP_LOCALE must be auto, ja or en (got "${localeRaw}").`);
  const port = int("PORT", 1, 65535);

  const secret = required("AUTH_SECRET");
  if (secret !== "" && secret.length < 32) issues.push("AUTH_SECRET must be at least 32 characters (`openssl rand -base64 32`).");
  const clientId = required("GOOGLE_CLIENT_ID");
  if (clientId !== "" && !/^[\w-]+\.apps\.googleusercontent\.com$/u.test(clientId)) {
    issues.push(`GOOGLE_CLIENT_ID must look like <project-number>-<hash>.apps.googleusercontent.com (got "${clientId}").`);
  }
  const { domains, invalid } = parseDomainList(env("ALLOWED_DOMAINS"));
  for (const entry of invalid) issues.push(`ALLOWED_DOMAINS contains an invalid domain: "${entry}".`);
  const emails = emailList("ALLOWED_EMAILS");
  const admins = emailList("ADMIN_EMAILS");
  if (domains.size === 0 && emails.size === 0 && invalid.length === 0) {
    issues.push("Set ALLOWED_DOMAINS or ALLOWED_EMAILS (or both). An empty allow-list would let nobody in.");
  }
  for (const admin of admins) {
    if (!emails.has(admin) && !domains.has(emailDomain(admin))) {
      warnings.push(`ADMIN_EMAILS entry ${admin} is not covered by ALLOWED_DOMAINS or ALLOWED_EMAILS, so it cannot sign in.`);
    }
  }
  const sessionTtlSeconds = int("SESSION_TTL_HOURS", 1, 720) * 3600;

  const pickerKey = env("GOOGLE_PICKER_API_KEY");
  const projectOverride = env("GOOGLE_PROJECT_NUMBER");
  if (projectOverride !== "" && !/^\d+$/u.test(projectOverride)) {
    issues.push(`GOOGLE_PROJECT_NUMBER must be digits only (got "${projectOverride}").`);
  }
  let drive: DriveBootConfig | null = null;
  if (pickerKey !== "") {
    const appId = projectOverride !== "" ? projectOverride : projectNumberFromClientId(clientId);
    if (appId === null) issues.push("GOOGLE_PICKER_API_KEY is set, but no project number: set GOOGLE_PROJECT_NUMBER.");
    else drive = { clientId, apiKey: pickerKey, appId };
  }

  const driver = env("STORAGE_DRIVER");
  let storage: StorageConfig = { driver: "local", dataDir: env("DATA_DIR") };
  if (driver === "gcs") {
    const bucket = env("GCS_BUCKET");
    const publicBucket = env("GCS_PUBLIC_BUCKET");
    if (bucket === "") issues.push("GCS_BUCKET is required when STORAGE_DRIVER=gcs.");
    for (const [name, value] of [["GCS_BUCKET", bucket], ["GCS_PUBLIC_BUCKET", publicBucket]] as const) {
      if (value !== "" && !BUCKET_NAME.test(value)) issues.push(`${name} is not a valid bucket name: "${value}".`);
    }
    if (publicBucket !== "" && publicBucket === bucket) {
      issues.push("GCS_PUBLIC_BUCKET must differ from GCS_BUCKET: records must never sit in a public bucket.");
    }
    storage = { driver: "gcs", bucket, publicBucket: publicBucket === "" ? null : publicBucket };
  } else if (driver !== "local") {
    issues.push(`STORAGE_DRIVER must be local or gcs (got "${driver}").`);
  } else if (onCloudRun) {
    issues.push("STORAGE_DRIVER=local on Cloud Run would lose every image on the next instance. Use STORAGE_DRIVER=gcs.");
  }
  const override = env("IMAGE_BASE_URL");
  if (override !== "" && parseBaseUrl(override) === null) {
    issues.push(`IMAGE_BASE_URL must be an absolute http(s) URL without query or fragment (got "${override}").`);
  }

  const maxDimension = int("IMAGE_MAX_DIMENSION", 16, 8192);
  const quality = int("WEBP_QUALITY", 1, 100);
  const maxUploadMb = int("MAX_UPLOAD_MB", 1, 100);
  if (onCloudRun && maxUploadMb > 31) issues.push("MAX_UPLOAD_MB must be at most 31 on Cloud Run (32 MiB request limit).");
  const maxInputPixels = int("IMAGE_MAX_INPUT_PIXELS", 1_000_000, 1_000_000_000);

  if (issues.length > 0 || appUrl === null) throw new ConfigError(issues);

  return {
    port,
    appUrl,
    appName,
    pinnedLocale,
    auth: { secret, clientId, sessionTtlSeconds },
    access: { domains, emails, admins },
    drive,
    storage,
    publicBaseUrl: derivePublicBaseUrl({ appUrl, storage, override: override === "" ? null : override }),
    image: { maxDimension, quality, maxInputPixels, maxUploadBytes: maxUploadMb * 1024 * 1024 },
    warnings,
  };
}

const BUCKET_NAME = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/u;
const DOMAIN_NAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/u;

function splitList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function parseAppUrl(raw: string, issues: string[]): URL | null {
  if (raw === "") return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    issues.push(`APP_URL is not a URL: "${raw}".`);
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    issues.push(`APP_URL must be http or https (got "${raw}").`);
    return null;
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== "") {
    issues.push(`APP_URL must be an origin only, with no path, query or credentials (got "${raw}").`);
    return null;
  }
  return new URL(url.origin);
}

function parseBaseUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.search !== "" || url.hash !== "") return null;
    return url.href.replace(/\/+$/u, "");
  } catch {
    return null;
  }
}

export function derivePublicBaseUrl(input: {
  readonly appUrl: URL;
  readonly storage: StorageConfig;
  readonly override: string | null;
}): string {
  const override = input.override === null ? null : parseBaseUrl(input.override);
  if (override !== null) return override;
  if (input.storage.driver === "gcs" && input.storage.publicBucket !== null) {
    return `https://storage.googleapis.com/${input.storage.publicBucket}/i`;
  }
  return `${input.appUrl.origin}/i`;
}

/**
 * `123456789012-abc.apps.googleusercontent.com` -> `"123456789012"`. The Picker's `setAppId` needs
 * the Cloud project number so that `drive.file` grants cover picked files; the OAuth client id
 * usually encodes it, so GOOGLE_PROJECT_NUMBER is only a fallback.
 */
export function projectNumberFromClientId(clientId: string): string | null {
  return /^(\d+)-[\w-]+\.apps\.googleusercontent\.com$/u.exec(clientId)?.[1] ?? null;
}

export function parseDomainList(raw: string): { readonly domains: ReadonlySet<string>; readonly invalid: readonly string[] } {
  const domains = new Set<string>();
  const invalid: string[] = [];
  for (const entry of splitList(raw)) {
    const domain = entry.toLowerCase().replace(/^@/u, "");
    if (DOMAIN_NAME.test(domain)) domains.add(domain);
    else invalid.push(entry);
  }
  return { domains, invalid };
}
