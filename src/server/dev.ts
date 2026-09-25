/**
 * Dev entry for `@hono/vite-dev-server` (`pnpm dev`): one port serves the SPA with HMR and the
 * real Hono app (API, auth, /i/, shell). Never bundled: esbuild's entry is main.ts, which does not
 * import this file.
 *
 * Differences from production, and only these:
 * - Env defaults for local work: APP_URL=http://localhost:5173, STORAGE_DRIVER=local, DATA_DIR=./data.
 * - The shell has no CSP, because Vite's HMR client injects inline styles.
 * - `DEV_FAKE_LOGIN=alice@example.com` swaps Auth for one that treats every request as that member,
 *   so a contributor can run the app without an OAuth client. A request may name another member
 *   in an `X-Dev-User` header (to try the delete policy with curl). ADMIN_EMAILS still decides who
 *   is an admin. Read here and nowhere else; it is not in ENV_VARS because operators never set it
 *   and the production bundle cannot see it.
 */

import { readFile } from "node:fs/promises";

import { parseEmail } from "../shared/domain";
import type { Auth } from "./auth";
import { mintActorForTest } from "./auth.testing";
import { composeApp } from "./compose";
import { type AccessPolicy, loadConfig } from "./config";
import { HttpError } from "./errors";
import { jsonLogger } from "./log";

/** Dev-only `process.env` defaults, applied under the real environment. */
export const DEV_ENV_DEFAULTS: Readonly<Record<string, string>> = {
  APP_URL: "http://localhost:5173",
  STORAGE_DRIVER: "local",
  DATA_DIR: "./data",
};

/** Placeholders so `loadConfig` accepts a fake-login setup with no Google project at all. */
const FAKE_LOGIN_DEFAULTS: Readonly<Record<string, string>> = {
  AUTH_SECRET: "dev-only-secret-dev-only-secret-dev-only",
  GOOGLE_CLIENT_ID: "000000000000-dev.apps.googleusercontent.com",
};

/** Auth that answers every request as `email` (or the `X-Dev-User` header), and whose sign-in/out just succeed. */
export function fakeAuth(email: string, access: AccessPolicy): Auth {
  const actorFor = (req: Request) => {
    const who = parseEmail(req.headers.get("x-dev-user") ?? email);
    if (who === null) throw new HttpError("unauthenticated");
    return mintActorForTest({ email: who, name: who.split("@")[0] ?? who, isAdmin: access.admins.has(who) });
  };
  return {
    issueNonce: () => ({ nonce: "dev", setCookie: "wih_nonce=dev; Path=/; HttpOnly; SameSite=Lax" }),
    handleSignIn: () => Promise.resolve(new Response(null, { status: 204 })),
    handleLogout: () => new Response(null, { status: 204 }),
    actorFrom: (req) => Promise.resolve(actorFor(req)),
    requireActor: (req) => Promise.resolve(actorFor(req)),
  };
}

const fakeLogin = process.env["DEV_FAKE_LOGIN"] ?? "";
const env: Record<string, string | undefined> = {
  ...DEV_ENV_DEFAULTS,
  ...(fakeLogin === "" ? {} : FAKE_LOGIN_DEFAULTS),
  ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== "")),
};
if (fakeLogin !== "" && (env["ALLOWED_DOMAINS"] ?? "") === "" && (env["ALLOWED_EMAILS"] ?? "") === "") {
  env["ALLOWED_EMAILS"] = fakeLogin;
}
const config = loadConfig(env);

export default await composeApp(
  config,
  jsonLogger,
  { shellTemplate: await readFile("index.html", "utf8"), clientDir: "dist/client" },
  { devMode: true, ...(fakeLogin === "" ? {} : { auth: fakeAuth(fakeLogin, config.access) }) },
);
