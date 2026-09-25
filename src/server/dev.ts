import { readFile } from "node:fs/promises";

import { parseEmail } from "../shared/domain";
import type { Auth } from "./auth";
import { mintActorForTest } from "./auth.testing";
import { composeApp } from "./compose";
import { type AccessPolicy, loadConfig } from "./config";
import { HttpError } from "./errors";
import { jsonLogger } from "./log";

export const DEV_ENV_DEFAULTS: Readonly<Record<string, string>> = {
  APP_URL: "http://localhost:5173",
  STORAGE_DRIVER: "local",
  DATA_DIR: "./data",
};

const FAKE_LOGIN_DEFAULTS: Readonly<Record<string, string>> = {
  AUTH_SECRET: "dev-only-secret-dev-only-secret-dev-only",
  GOOGLE_CLIENT_ID: "000000000000-dev.apps.googleusercontent.com",
};

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
