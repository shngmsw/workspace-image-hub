import { describe, expect, it } from "vitest";

import { photoPng } from "../../test/fixtures";
import { BOOT_ELEMENT_ID, type BootConfig, encodeUploadMeta, UPLOAD_META_HEADER } from "../shared/api";
import type { AssetView } from "../shared/domain";
import { createApp } from "./app";
import type { Auth } from "./auth";
import { mintActorForTest } from "./auth.testing";
import { loadConfig } from "./config";
import { HttpError } from "./errors";
import { createHub } from "./hub";
import { createTranscoder } from "./image";
import type { Logger } from "./log";
import { createMemoryStore } from "./store/memory";

const quiet: Logger = { log() {} };
const ORIGIN = "https://img.example.com";
const SHELL = '<!doctype html><html lang="en"><head><title>x</title><!--wih-boot--></head><body></body></html>';

const stubAuth: Auth = {
  issueNonce: () => ({ nonce: "test-nonce", setCookie: "__Host-wih_nonce=test-nonce; Path=/; HttpOnly; SameSite=Lax; Secure" }),
  handleSignIn: () => Promise.resolve(new Response(null, { status: 204 })),
  handleLogout: () => new Response(null, { status: 204 }),
  actorFrom: (req) => {
    const email = req.headers.get("x-test-user");
    return Promise.resolve(email === null ? null : mintActorForTest({ email, isAdmin: email.startsWith("admin@") }));
  },
  requireActor: (req) => {
    const email = req.headers.get("x-test-user");
    if (email === null) return Promise.reject(new HttpError("unauthenticated"));
    return Promise.resolve(mintActorForTest({ email }));
  },
};

function setup(env: Record<string, string> = {}) {
  const config = loadConfig({
    APP_URL: ORIGIN,
    APP_NAME: "Hub </script><b>",
    AUTH_SECRET: "x".repeat(32),
    GOOGLE_CLIENT_ID: "123-abc.apps.googleusercontent.com",
    ALLOWED_DOMAINS: "example.com",
    MAX_UPLOAD_MB: "5",
    ...env,
  });
  const store = createMemoryStore();
  const hub = createHub({ store, transcode: createTranscoder(config.image), publicBaseUrl: config.publicBaseUrl, log: quiet });
  const app = createApp({ config, auth: stubAuth, hub, store, log: quiet, shellTemplate: SHELL, clientDir: "dist/client" });
  const as = (user: string | null, init: RequestInit = {}): RequestInit => ({
    ...init,
    headers: { Origin: ORIGIN, ...(user === null ? {} : { "X-Test-User": user }), ...(init.headers as Record<string, string>) },
  });
  const upload = async (user: string, bytes: Uint8Array<ArrayBuffer>, name = "photo.png") =>
    app.request("/api/assets", as(user, { method: "POST", body: bytes, headers: { [UPLOAD_META_HEADER]: encodeUploadMeta({ filename: name, source: "upload", tags: ["ChatIcon"] }) } }));
  return { app, as, upload };
}

function bootOf(html: string): BootConfig {
  const match = new RegExp(`<script id="${BOOT_ELEMENT_ID}" type="application/json">(.*?)</script>`, "u").exec(html);
  return JSON.parse(match?.[1] ?? "null") as BootConfig;
}

describe("HTTP shell", () => {
  it("uploads, serves the public link with immutable caching, edits tags and enforces the delete policy", async () => {
    const { app, as, upload } = setup();
    const res = await upload("alice@example.com", await photoPng(1500, 1000));
    expect(res.status).toBe(201);
    const asset = (await res.json()) as AssetView;
    expect([asset.width, asset.height]).toEqual([1024, 683]);
    expect(asset.storedBytes).toBeLessThan(asset.originalBytes);
    expect(asset.url).toBe(`${ORIGIN}/i/${asset.id}.webp`);

    for (const method of ["GET", "HEAD"]) {
      const image = await app.request(`/i/${asset.id}.webp`, { method });
      expect(image.status).toBe(200);
      expect(image.headers.get("content-type")).toBe("image/webp");
      expect(image.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(image.headers.get("content-length")).toBe(String(asset.storedBytes));
      expect(image.headers.get("etag")).toBe(`"${asset.id}"`);
      expect(image.headers.get("access-control-allow-origin")).toBe("*");
      if (method === "GET") expect((await image.arrayBuffer()).byteLength).toBe(asset.storedBytes);
    }
    expect((await app.request(`/i/${asset.id}.webp`, { headers: { "If-None-Match": `"${asset.id}"` } })).status).toBe(304);

    const listed = await app.request("/api/assets", as("bob@example.com"));
    expect(((await listed.json()) as { assets: AssetView[] }).assets.map((a) => [a.id, a.canDelete])).toEqual([[asset.id, false]]);

    const patched = await app.request(`/api/assets/${asset.id}`, as("bob@example.com", { method: "PATCH", body: JSON.stringify({ tags: ["営業部"] }) }));
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as AssetView).tags).toEqual(["営業部"]);

    const forbidden = await app.request(`/api/assets/${asset.id}`, as("bob@example.com", { method: "DELETE" }));
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: { code: "forbidden" } });
    expect((await app.request(`/api/assets/${asset.id}`, as("alice@example.com", { method: "DELETE" }))).status).toBe(204);
    expect((await app.request(`/api/assets/${asset.id}`, as("alice@example.com", { method: "DELETE" }))).status).toBe(204);
    const gone = await app.request(`/i/${asset.id}.webp`);
    expect(gone.status).toBe(404);
    expect(gone.headers.get("cache-control")).toBe("no-store");
  });

  it("requires a session for the API but not for image links", async () => {
    const { app, as } = setup();
    const res = await app.request("/api/assets", as(null));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "unauthenticated" } });
    expect((await app.request("/i/not-an-id.webp")).status).toBe(404);
    expect((await app.request("/health")).status).toBe(200);
  });

  it("refuses cross-origin writes before anything else", async () => {
    const { app } = setup();
    const res = await app.request("/api/assets/0123456789abcdef", { method: "DELETE", headers: { "X-Test-User": "alice@example.com", Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: "cross_origin" } });
    expect((await app.request("/auth/logout", { method: "POST" })).status).toBe(403);
  });

  it("rejects a missing upload header, an oversized body, a non-image and a bad PATCH", async () => {
    const { app, as, upload } = setup();
    const noMeta = await app.request("/api/assets", as("alice@example.com", { method: "POST", body: new Uint8Array([1]) }));
    expect(await noMeta.json()).toEqual({ error: { code: "invalid_input", detail: { issue: "body_malformed" } } });

    const big = await upload("alice@example.com", new Uint8Array(5 * 1024 * 1024 + 1));
    expect(big.status).toBe(413);
    expect(await big.json()).toEqual({ error: { code: "too_large", detail: { maxBytes: 5 * 1024 * 1024 } } });

    const text = await upload("alice@example.com", new TextEncoder().encode("hello"), "hello.png");
    expect(text.status).toBe(415);

    const badPatch = await app.request("/api/assets/0123456789abcdef", as("alice@example.com", { method: "PATCH", body: '{"tags":["a,b"]}' }));
    expect(await badPatch.json()).toEqual({ error: { code: "invalid_input", detail: { issue: "tag_forbidden_char" } } });
    const missing = await app.request("/api/assets/0123456789abcdef", as("alice@example.com", { method: "PATCH", body: '{"tags":[]}' }));
    expect(missing.status).toBe(404);
  });

  it("renders the sign-in shell with a nonce cookie, escaped boot JSON and a CSP", async () => {
    const { app } = setup();
    const res = await app.request("/?auth_error=not_allowed", { headers: { "Accept-Language": "ja,en;q=0.5" } });
    const html = await res.text();
    expect(res.headers.get("set-cookie")).toContain("__Host-wih_nonce=test-nonce");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toContain("script-src 'self' https://accounts.google.com/gsi/client");
    expect(html).not.toContain("</script><b>");
    expect(html).toContain('<html lang="ja"');
    expect(html).toContain("<title>Hub &#60;/script&#62;&#60;b&#62;</title>");
    expect(bootOf(html)).toMatchObject({
      appName: "Hub </script><b>",
      locale: "ja",
      session: {
        state: "signed-out",
        authError: "not_allowed",
        signIn: { clientId: "123-abc.apps.googleusercontent.com", nonce: "test-nonce", hostedDomain: "example.com", allowedDomains: ["example.com"] },
      },
      drive: null,
    });
  });

  it("embeds the catalog for a signed-in viewer and omits the hd hint when individual emails are allowed", async () => {
    const { app, upload } = setup({ ALLOWED_EMAILS: "contractor@example.net" });
    await upload("alice@example.com", await photoPng(200, 100));
    const res = await app.request("/", { headers: { "X-Test-User": "alice@example.com" } });
    const boot = bootOf(await res.text());
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(boot.session.state).toBe("signed-in");
    if (boot.session.state === "signed-in") expect(boot.session.assets).toHaveLength(1);
    const signedOut = bootOf(await (await app.request("/")).text());
    expect(signedOut.session.state === "signed-out" && signedOut.session.signIn.hostedDomain).toBeNull();
  });
});
