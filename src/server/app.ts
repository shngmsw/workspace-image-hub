/**
 * The HTTP shell (Hono). Thin: each route authenticates, parses its input into domain types, calls one
 * Hub or Auth method, and maps the result. No business rule lives here.
 *
 * Route -> hub.ts -> store/<driver>.ts is the deepest call chain in the server (three files).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { Hono } from "hono";

import {
  BOOT_ELEMENT_ID,
  type BootConfig,
  type ErrorBody,
  parseAuthErrorCode,
  parseUpdateAssetBody,
  parseUploadMeta,
  type SignedInBoot,
  type SignedOutBoot,
  UPLOAD_META_HEADER,
} from "../shared/api";
import { parseAssetId, parseImageFileName } from "../shared/domain";
import { LOCALE_COOKIE, negotiateLocale } from "../shared/i18n";
import type { Auth } from "./auth";
import { readBodyCapped, readCookie, readJsonCapped } from "./request";
import type { Config } from "./config";
import { HttpError, HubError, httpStatusOf } from "./errors";
import type { Hub } from "./hub";
import { ACCEPTED_MIME_TYPES } from "./image";
import type { Logger } from "./log";
import { type AssetStore, IMAGE_CACHE_CONTROL } from "./store/store";

export interface AppDeps {
  readonly config: Config;
  readonly auth: Auth;
  readonly hub: Hub;
  /** Only `openImage` is used here, for the public `/i/` route; everything else goes through the hub. */
  readonly store: Pick<AssetStore, "openImage">;
  readonly log: Logger;
  /** Built `index.html` with a `<!--wih-boot-->` placeholder, read once at startup. */
  readonly shellTemplate: string;
  /** Directory of the built client (`dist/client`). */
  readonly clientDir: string;
  /** Vite dev server only: its HMR client injects inline styles, so the shell gets no CSP. */
  readonly devMode?: boolean;
}

const PATCH_BODY_MAX_BYTES = 64 * 1024;
/** Characters that could end a `<script>` block or a JS line if left raw in inline JSON. */
const SCRIPT_UNSAFE = new RegExp(`[<>&${String.fromCharCode(0x2028, 0x2029)}]`, "gu");
const NO_STORE = { "Cache-Control": "no-store" } as const;

const STATIC_TYPES: Readonly<Record<string, string>> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

export function createApp(deps: AppDeps): Hono {
  const { config, auth, hub, store, log } = deps;
  const app = new Hono();

  // ── Cross-cutting ──
  app.onError((error) => errorResponse(error, log));
  app.notFound(() => Response.json({ error: { code: "not_found" } } satisfies ErrorBody, { status: 404, headers: NO_STORE }));
  app.use("*", async (c, next) => {
    // Compared to APP_URL, not the Host header, so the answer is the same behind any proxy.
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.header("Origin") !== config.appUrl.origin) {
      throw new HttpError("cross_origin");
    }
    await next();
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    // Not no-referrer: the Picker API key is restricted by HTTP referrer.
    c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  });

  // ── Public ──
  app.get("/healthz", (c) => c.text("ok", 200, NO_STORE));

  // Hono answers HEAD from GET handlers (body dropped), so link checkers get headers only.
  app.get("/i/:file", async (c) => {
    const id = parseImageFileName(c.req.param("file"));
    // Misses are cheap to answer and must never be pinned by a CDN in front of IMAGE_BASE_URL.
    if (id === null) return c.body(null, 404, NO_STORE);
    const etag = `"${id}"`; // ids are never rewritten, so the id is a perfect validator
    if (c.req.header("If-None-Match") === etag) {
      return c.body(null, 304, { ETag: etag, "Cache-Control": IMAGE_CACHE_CONTROL });
    }
    const image = await store.openImage(id);
    if (image === null) return c.body(null, 404, NO_STORE);
    const headers = {
      "Content-Type": "image/webp",
      "Content-Length": String(image.size),
      "Cache-Control": IMAGE_CACHE_CONTROL,
      ETag: etag,
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
    };
    if (c.req.method === "HEAD") {
      await image.body.cancel(); // release the file handle / GCS socket; Hono would only drop it
      return new Response(null, { headers });
    }
    return new Response(image.body, { headers });
  });

  app.post("/auth/google", (c) => auth.handleSignIn(c.req.raw));
  app.post("/auth/logout", (c) => auth.handleLogout(c.req.raw));

  // ── Members ──
  app.get("/api/assets", async (c) => {
    const actor = await auth.requireActor(c.req.raw);
    return c.json({ assets: await hub.list(actor) }, 200, NO_STORE);
  });

  app.post("/api/assets", async (c) => {
    const actor = await auth.requireActor(c.req.raw); // before reading 20 MB from a stranger
    const meta = parseUploadMeta(c.req.header(UPLOAD_META_HEADER));
    if (!meta.ok) throw new HttpError("invalid_input", { issue: meta.issue });
    const bytes = await readBodyCapped(c.req.raw, config.image.maxUploadBytes);
    return c.json(await hub.ingest(actor, { ...meta.value, bytes }), 201, NO_STORE);
  });

  app.patch("/api/assets/:id", async (c) => {
    const actor = await auth.requireActor(c.req.raw);
    const id = parseAssetId(c.req.param("id"));
    if (!id.ok) throw new HubError("not_found");
    const patch = parseUpdateAssetBody(await readJsonCapped(c.req.raw, PATCH_BODY_MAX_BYTES));
    if (!patch.ok) throw new HttpError("invalid_input", { issue: patch.issue });
    return c.json(await hub.update(actor, id.value, patch.value), 200, NO_STORE);
  });

  app.delete("/api/assets/:id", async (c) => {
    const actor = await auth.requireActor(c.req.raw);
    const id = parseAssetId(c.req.param("id"));
    if (id.ok) await hub.remove(actor, id.value); // malformed id: nothing to delete, still 204
    return c.body(null, 204, NO_STORE);
  });

  // ── SPA ──
  app.get("/static/:file", async (c) => {
    const file = c.req.param("file");
    const type = STATIC_TYPES[file.slice(file.lastIndexOf("."))];
    if (!/^[\w-]+(\.[\w-]+)*$/u.test(file) || type === undefined) return c.notFound();
    const bytes = await readFile(join(deps.clientDir, "static", file)).catch(() => null);
    if (bytes === null) return c.notFound();
    // Vite content-hashes every name in static/, so a name never changes meaning.
    return c.body(new Uint8Array(bytes), 200, { "Content-Type": type, "Cache-Control": IMAGE_CACHE_CONTROL });
  });

  app.get("/", async (c) => {
    const actor = await auth.actorFrom(c.req.raw);
    const headers = new Headers({ "Content-Type": "text/html; charset=utf-8", ...NO_STORE });
    if (deps.devMode !== true) headers.set("Content-Security-Policy", contentSecurityPolicy(config));

    let session: SignedInBoot | SignedOutBoot;
    if (actor !== null) {
      const assets = await hub.list(actor).catch((error: unknown) => {
        log.log("WARNING", "shell.catalog_unavailable", { error: String(error) });
        return null;
      });
      session = {
        state: "signed-in",
        user: { email: actor.email, name: actor.name, picture: actor.picture, isAdmin: actor.isAdmin },
        assets,
      };
    } else {
      const { nonce, setCookie } = auth.issueNonce();
      headers.append("Set-Cookie", setCookie);
      const domains = [...config.access.domains];
      session = {
        state: "signed-out",
        authError: parseAuthErrorCode(c.req.query("auth_error")),
        signIn: {
          clientId: config.auth.clientId,
          nonce,
          hostedDomain: domains.length === 1 && config.access.emails.size === 0 ? (domains[0] ?? null) : null,
          allowedDomains: domains,
        },
      };
    }
    return new Response(renderShell(deps.shellTemplate, buildBoot(config, c.req.raw, session)), { headers });
  });

  return app;
}

/** BootConfig for this request. Locale: APP_LOCALE if pinned, else the toggle cookie, else Accept-Language. */
export function buildBoot(config: Config, req: Request, session: SignedInBoot | SignedOutBoot): BootConfig {
  return {
    appName: config.appName,
    locale: negotiateLocale({
      pinned: config.pinnedLocale,
      cookie: readCookie(req, LOCALE_COOKIE),
      acceptLanguage: req.headers.get("accept-language") ?? undefined,
    }),
    localeFixed: config.pinnedLocale !== null,
    session,
    upload: {
      maxBytes: config.image.maxUploadBytes,
      maxDimension: config.image.maxDimension,
      quality: config.image.quality,
      accept: ACCEPTED_MIME_TYPES,
    },
    drive: config.drive,
  };
}

/**
 * Replaces `<!--wih-boot-->` with `<script id="wih-boot" type="application/json">…</script>` and sets
 * `<html lang>` and `<title>`. JSON is escaped for `<`, `>`, `&`, U+2028 and U+2029 so no value can
 * close the script tag. A JSON script block is data, not script, so CSP needs no nonce for it.
 */
export function renderShell(template: string, boot: BootConfig): string {
  const json = JSON.stringify(boot).replace(SCRIPT_UNSAFE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return template
    .replace("<!--wih-boot-->", () => `<script id="${BOOT_ELEMENT_ID}" type="application/json">${json}</script>`)
    .replace(/<html lang="[^"]*"/u, `<html lang="${boot.locale}"`)
    .replace(/<title>[^<]*<\/title>/u, () => `<title>${escapeHtml(boot.appName)}</title>`);
}

/**
 * Derived from config, so the Drive origins appear only when Drive import is enabled and the image
 * origin follows IMAGE_BASE_URL. The Google Identity Services origins are always present because
 * the sign-in button needs them.
 */
export function contentSecurityPolicy(config: Config): string {
  const drive = config.drive !== null;
  const imageOrigin = new URL(config.publicBaseUrl).origin;
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "base-uri": ["'none'"],
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    "form-action": ["'self'"],
    "img-src": ["'self'", "data:", "blob:", imageOrigin, "https://*.googleusercontent.com"],
    "script-src": ["'self'", "https://accounts.google.com/gsi/client", ...(drive ? ["https://apis.google.com"] : [])],
    // The GIS button and the Picker inject inline <style> elements and style attributes into the
    // page (verified with a CSP report). Scripts stay strict; React escapes all markup.
    "style-src": ["'self'", "'unsafe-inline'", "https://accounts.google.com/gsi/style"],
    "frame-src": [
      "https://accounts.google.com/gsi/",
      ...(drive ? ["https://accounts.google.com", "https://docs.google.com", "https://drive.google.com"] : []),
    ],
    "connect-src": [
      "'self'",
      "https://accounts.google.com/gsi/",
      ...(drive ? ["https://www.googleapis.com", "https://content.googleapis.com"] : []),
    ],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${[...new Set(values)].join(" ")}`)
    .join("; ");
}

/** Maps anything thrown to a response (used by app.onError). Exported for tests. */
export function errorResponse(error: unknown, log: Logger): Response {
  if (error instanceof HubError || error instanceof HttpError) {
    if (error.code === "storage_unavailable") log.log("WARNING", "storage.unavailable", { error: String(error.cause) });
    const body: ErrorBody = { error: { code: error.code, ...(error.detail === undefined ? {} : { detail: error.detail }) } };
    // An oversized upload was not read; closing the connection stops the client from sending the rest.
    const headers = { ...NO_STORE, ...(error.code === "too_large" ? { Connection: "close" } : {}) };
    return Response.json(body, { status: httpStatusOf(error.code), headers });
  }
  log.log("ERROR", "request.failed", { error: String(error), stack: error instanceof Error ? error.stack : undefined });
  return Response.json({ error: { code: "internal" } } satisfies ErrorBody, { status: 500, headers: NO_STORE });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/gu, (c) => `&#${c.charCodeAt(0)};`);
}
