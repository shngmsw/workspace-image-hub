import { describe, expect, it } from "vitest";

import { ConfigError, derivePublicBaseUrl, loadConfig, parseDomainList, projectNumberFromClientId } from "./config";

const base = {
  APP_URL: "https://img.example.com",
  AUTH_SECRET: "x".repeat(32),
  GOOGLE_CLIENT_ID: "123456789012-abc.apps.googleusercontent.com",
  ALLOWED_DOMAINS: "example.com",
};

function issuesOf(env: Record<string, string>): readonly string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
  return [];
}

describe("loadConfig", () => {
  it("applies defaults", () => {
    const config = loadConfig(base);
    expect(config.appUrl.origin).toBe("https://img.example.com");
    expect(config.appName).toBe("Image Hub");
    expect(config.pinnedLocale).toBeNull();
    expect(config.port).toBe(3000);
    expect(config.auth.sessionTtlSeconds).toBe(12 * 3600);
    expect(config.storage).toEqual({ driver: "local", dataDir: "./data" });
    expect(config.publicBaseUrl).toBe("https://img.example.com/i");
    expect(config.image).toEqual({ maxDimension: 1024, quality: 80, maxInputPixels: 100_000_000, maxUploadBytes: 20 * 1024 * 1024 });
    expect(config.drive).toBeNull();
    expect(config.warnings).toEqual([]);
  });

  it("refuses to start with empty allow-lists, and treats FOO= as unset", () => {
    expect(issuesOf({ ...base, ALLOWED_DOMAINS: "" })).toEqual([
      "Set ALLOWED_DOMAINS or ALLOWED_EMAILS (or both). An empty allow-list would let nobody in.",
    ]);
    expect(issuesOf({ ...base, ALLOWED_DOMAINS: " , " })).toHaveLength(1);
  });

  it("starts with ALLOWED_EMAILS alone", () => {
    const config = loadConfig({ ...base, ALLOWED_DOMAINS: "", ALLOWED_EMAILS: "Contractor@Example.net" });
    expect([...config.access.emails]).toEqual(["contractor@example.net"]);
    expect(config.access.domains.size).toBe(0);
  });

  it("lists every problem at once", () => {
    const issues = issuesOf({ APP_URL: "https://img.example.com/app", AUTH_SECRET: "short", WEBP_QUALITY: "0", APP_LOCALE: "fr" });
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("APP_URL must be an origin only"),
        expect.stringContaining("AUTH_SECRET must be at least 32"),
        "GOOGLE_CLIENT_ID is required.",
        expect.stringContaining("Set ALLOWED_DOMAINS or ALLOWED_EMAILS"),
        expect.stringContaining("WEBP_QUALITY must be an integer from 1 to 100"),
        expect.stringContaining("APP_LOCALE must be auto, ja or en"),
      ]),
    );
  });

  it("guards storage: gcs needs a bucket, records never share the public bucket, local is refused on Cloud Run", () => {
    expect(issuesOf({ ...base, STORAGE_DRIVER: "gcs" })).toEqual(["GCS_BUCKET is required when STORAGE_DRIVER=gcs."]);
    expect(issuesOf({ ...base, STORAGE_DRIVER: "gcs", GCS_BUCKET: "hub", GCS_PUBLIC_BUCKET: "hub" })).toEqual([
      "GCS_PUBLIC_BUCKET must differ from GCS_BUCKET: records must never sit in a public bucket.",
    ]);
    expect(issuesOf({ ...base, K_SERVICE: "image-hub" })[0]).toContain("STORAGE_DRIVER=local on Cloud Run");
    expect(issuesOf({ ...base, K_SERVICE: "image-hub", STORAGE_DRIVER: "gcs", GCS_BUCKET: "hub", MAX_UPLOAD_MB: "32" })).toEqual([
      "MAX_UPLOAD_MB must be at most 31 on Cloud Run (32 MiB request limit).",
    ]);
    const gcs = loadConfig({ ...base, STORAGE_DRIVER: "gcs", GCS_BUCKET: "hub", GCS_PUBLIC_BUCKET: "hub-public" });
    expect(gcs.storage).toEqual({ driver: "gcs", bucket: "hub", publicBucket: "hub-public" });
    expect(gcs.publicBaseUrl).toBe("https://storage.googleapis.com/hub-public/i");
  });

  it("enables Drive import only with a picker key, deriving or overriding the project number", () => {
    expect(loadConfig({ ...base, GOOGLE_PICKER_API_KEY: "key" }).drive).toEqual({
      clientId: base.GOOGLE_CLIENT_ID,
      apiKey: "key",
      appId: "123456789012",
    });
    expect(loadConfig({ ...base, GOOGLE_PICKER_API_KEY: "key", GOOGLE_PROJECT_NUMBER: "999" }).drive?.appId).toBe("999");
    expect(issuesOf({ ...base, GOOGLE_CLIENT_ID: "custom.apps.googleusercontent.com", GOOGLE_PICKER_API_KEY: "key" })).toEqual([
      "GOOGLE_PICKER_API_KEY is set, but no project number: set GOOGLE_PROJECT_NUMBER.",
    ]);
  });

  it("warns about plain-http public origins and admins the allow-list rejects", () => {
    const config = loadConfig({ ...base, APP_URL: "http://hub.example.com", ADMIN_EMAILS: "root@example.org" });
    expect(config.warnings).toHaveLength(2);
    expect(loadConfig({ ...base, APP_URL: "http://localhost:3000" }).warnings).toEqual([]);
  });
});

describe("helpers", () => {
  it("parses domain lists exactly", () => {
    const { domains, invalid } = parseDomainList(" Example.com, @sub.example.com ,, *.example.org, exa mple.com");
    expect([...domains]).toEqual(["example.com", "sub.example.com"]);
    expect(invalid).toEqual(["*.example.org", "exa mple.com"]);
  });

  it("derives the project number from the client id", () => {
    expect(projectNumberFromClientId("123456789012-abc.apps.googleusercontent.com")).toBe("123456789012");
    expect(projectNumberFromClientId("abc.apps.googleusercontent.com")).toBeNull();
  });

  it("derives the public base URL, preferring an override without its trailing slash", () => {
    const appUrl = new URL("https://img.example.com");
    const local = { driver: "local", dataDir: "/data" } as const;
    expect(derivePublicBaseUrl({ appUrl, storage: local, override: null })).toBe("https://img.example.com/i");
    expect(derivePublicBaseUrl({ appUrl, storage: local, override: "https://cdn.example.com/img/" })).toBe("https://cdn.example.com/img");
  });
});
