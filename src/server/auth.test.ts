import { describe, expect, it } from "vitest";

import type { Email } from "../shared/domain";
import { type AccessPolicy, type Config } from "./config";
import { cookiePolicy, createAuth, decideAccess, type GoogleIdentity, type IdTokenClaims } from "./auth";
import type { Logger } from "./log";

const quiet: Logger = { log() {} };

function policy(domains: string[], emails: string[] = [], admins: string[] = []): AccessPolicy {
  return { domains: new Set(domains), emails: new Set(emails as Email[]), admins: new Set(admins as Email[]) };
}

function identity(fields: Partial<GoogleIdentity>): GoogleIdentity {
  return { sub: "1", email: "alice@example.com", emailVerified: true, hd: "example.com", name: "Alice", picture: null, ...fields };
}

describe("decideAccess", () => {
  const org = policy(["example.com", "example.co.jp"]);

  it("admits a managed account whose hd is listed", () => {
    expect(decideAccess(identity({}), org)).toEqual({ allowed: true, email: "alice@example.com" });
  });

  it("rejects an unverified email before anything else, even an allow-listed one", () => {
    const listed = policy([], ["alice@example.com"]);
    expect(decideAccess(identity({ emailVerified: false }), listed)).toEqual({ allowed: false, reason: "email_unverified" });
  });

  it("never lets a consumer account through a domain rule, whatever its address says", () => {
    expect(decideAccess(identity({ hd: null }), org)).toEqual({ allowed: false, reason: "not_allowed" });
    expect(decideAccess(identity({ hd: "" }), org)).toEqual({ allowed: false, reason: "not_allowed" });
  });

  it("admits a secondary-domain address in a listed organisation (hd listed, email domain not)", () => {
    expect(decideAccess(identity({ email: "bob@example.net", hd: "example.com" }), org)).toEqual({ allowed: true, email: "bob@example.net" });
  });

  it("admits a managed account whose email domain is listed though its hd is another domain", () => {
    expect(decideAccess(identity({ email: "carol@example.co.jp", hd: "parent.example" }), org).allowed).toBe(true);
  });

  it("matches domains exactly: look-alikes are rejected", () => {
    for (const domain of ["example.com.evil", "evil-example.com", "sub.example.com", "xexample.com"]) {
      expect(decideAccess(identity({ email: `mallory@${domain}`, hd: domain }), org)).toEqual({ allowed: false, reason: "not_allowed" });
    }
  });

  it("works with ALLOWED_EMAILS alone, for any Google account", () => {
    const only = policy([], ["contractor@gmail.example"]);
    expect(decideAccess(identity({ email: "Contractor@Gmail.Example", hd: null }), only)).toEqual({
      allowed: true,
      email: "contractor@gmail.example",
    });
    expect(decideAccess(identity({ email: "other@gmail.example", hd: null }), only).allowed).toBe(false);
    expect(decideAccess(identity({}), only).allowed).toBe(false);
  });
});

describe("cookiePolicy", () => {
  it("uses __Host- names and Secure only on https", () => {
    expect(cookiePolicy(new URL("https://img.example.com"))).toEqual({ session: "__Host-wih_session", nonce: "__Host-wih_nonce", secure: true });
    expect(cookiePolicy(new URL("http://localhost:3000"))).toEqual({ session: "wih_session", nonce: "wih_nonce", secure: false });
  });
});

describe("sign-in flow", () => {
  const config = (access: AccessPolicy, sessionTtlSeconds = 3600): Pick<Config, "appUrl" | "auth" | "access"> => ({
    appUrl: new URL("https://img.example.com"),
    auth: { secret: "s".repeat(32), clientId: "123-abc.apps.googleusercontent.com", sessionTtlSeconds },
    access,
  });
  const claims = (fields: Partial<IdTokenClaims>): IdTokenClaims => ({
    sub: "42",
    email: "alice@example.com",
    email_verified: true,
    hd: "example.com",
    name: "Alice Example",
    ...fields,
  });

  function setup(tokenClaims: IdTokenClaims | Error, access = policy(["example.com"], [], ["alice@example.com"]), ttl?: number) {
    const auth = createAuth(config(access, ttl), quiet, {
      verifyIdToken: (token) => (tokenClaims instanceof Error || token !== "h.p.s" ? Promise.reject(new Error("bad")) : Promise.resolve(tokenClaims)),
    });
    const { nonce, setCookie } = auth.issueNonce();
    const signIn = (cookieNonce: string | null, credential = "h.p.s") =>
      auth.handleSignIn(
        new Request("https://img.example.com/auth/google", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(cookieNonce === null ? {} : { Cookie: `__Host-wih_nonce=${cookieNonce}` }) },
          body: JSON.stringify({ credential }),
        }),
      );
    return { auth, nonce, setCookie, signIn };
  }

  const sessionCookieOf = (res: Response) =>
    res.headers
      .getSetCookie()
      .find((c) => c.startsWith("__Host-wih_session=") && !c.startsWith("__Host-wih_session=;"))
      ?.split(";")[0];

  it("pins the nonce in an HttpOnly cookie", () => {
    const { nonce, setCookie } = setup(claims({}));
    expect(nonce).toMatch(/^[\w-]{24}$/u);
    expect(setCookie).toBe(`__Host-wih_nonce=${nonce}; Path=/; HttpOnly; SameSite=Lax; Max-Age=900; Secure`);
  });

  it("creates a session for a verified token carrying the cookie's nonce, and clears the nonce", async () => {
    const nonce = "n".repeat(24);
    const res = await setup(claims({ nonce })).signIn(nonce);
    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie()).toContain("__Host-wih_nonce=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure");
    const session = sessionCookieOf(res);
    expect(session).toBeDefined();
  });

  it("round-trips the session into an Actor, with isAdmin derived from ADMIN_EMAILS", async () => {
    const nonce = "n".repeat(24);
    const { auth, signIn } = setup(claims({ nonce }));
    const session = sessionCookieOf(await signIn(nonce));
    const actor = await auth.actorFrom(new Request("https://img.example.com/", { headers: { Cookie: session ?? "" } }));
    expect(actor).toMatchObject({ sub: "42", email: "alice@example.com", name: "Alice Example", isAdmin: true });
  });

  it("refuses a token whose nonce differs from the cookie, or when the cookie is missing", async () => {
    const { signIn } = setup(claims({ nonce: "token-nonce-aaaaaaaaaaaa" }));
    const mismatch = await signIn("cookie-nonce-bbbbbbbbbbb");
    expect(mismatch.status).toBe(401);
    expect(await mismatch.json()).toEqual({ authError: "login_failed" });
    expect((await signIn(null)).status).toBe(401);
    expect(sessionCookieOf(mismatch)).toBeUndefined();
  });

  it("refuses a token Google's verifier rejects", async () => {
    const { signIn } = setup(new Error("expired"));
    const res = await signIn("x".repeat(24));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ authError: "login_failed" });
  });

  it("answers 403 with the reason when decideAccess refuses", async () => {
    const nonce = "n".repeat(24);
    const outsider = await setup(claims({ nonce, email: "eve@example.net", hd: undefined })).signIn(nonce);
    expect(outsider.status).toBe(403);
    expect(await outsider.json()).toEqual({ authError: "not_allowed" });
    const unverified = await setup(claims({ nonce, email_verified: false })).signIn(nonce);
    expect(await unverified.json()).toEqual({ authError: "email_unverified" });
  });

  it("re-checks the current allow-list on every request", async () => {
    const nonce = "n".repeat(24);
    const session = sessionCookieOf(await setup(claims({ nonce })).signIn(nonce)) ?? "";
    const narrowed = createAuth(config(policy(["example.org"])), quiet, { verifyIdToken: () => Promise.reject(new Error()) });
    expect(await narrowed.actorFrom(new Request("https://img.example.com/", { headers: { Cookie: session } }))).toBeNull();
  });

  it("rejects expired and tampered sessions", async () => {
    const nonce = "n".repeat(24);
    const expired = setup(claims({ nonce }), undefined, 0);
    const expiredCookie = sessionCookieOf(await expired.signIn(nonce)) ?? "";
    expect(await expired.auth.actorFrom(new Request("https://img.example.com/", { headers: { Cookie: expiredCookie } }))).toBeNull();

    const live = setup(claims({ nonce }));
    const cookie = sessionCookieOf(await live.signIn(nonce)) ?? "";
    const tampered = cookie.slice(0, -2) + (cookie.endsWith("A") ? "BB" : "AA");
    expect(await live.auth.actorFrom(new Request("https://img.example.com/", { headers: { Cookie: tampered } }))).toBeNull();
    await expect(live.auth.requireActor(new Request("https://img.example.com/"))).rejects.toMatchObject({ code: "unauthenticated" });
  });
});
