/**
 * Google sign-in with a Workspace allow-list, and the stateless session that follows.
 *
 * Flow: GET / (no session) issues a nonce as an HttpOnly cookie and hands the same nonce to the
 * page, which initialises the Google Identity Services button with it. GIS returns an ID token to
 * the page, which POSTs it to /auth/google. The server verifies it with google-auth-library
 * (signature, issuer, audience = GOOGLE_CLIENT_ID, expiry), requires its `nonce` claim to equal the
 * cookie, runs `decideAccess`, and sets a session cookie (HS256 JWT via jose). No client secret,
 * no redirect URI, no server-side session table.
 *
 * Speaks Web-standard Request/Response only, so it does not care which router mounts it.
 */

import { hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

import { OAuth2Client } from "google-auth-library";
import { jwtVerify, SignJWT } from "jose";

import type { AuthErrorCode, SignInFailure } from "../shared/api";
import { parseSignInRequest } from "../shared/api";
import { cleanDisplayName, type Email, emailDomain, parseEmail } from "../shared/domain";
import { readJsonCapped } from "./body";
import type { AccessPolicy, Config } from "./config";
import { HttpError } from "./errors";
import type { Logger } from "./log";

/** Lifetime of the sign-in nonce between rendering the button and posting its credential. */
export const NONCE_TTL_SECONDS = 15 * 60;
const SIGN_IN_BODY_MAX_BYTES = 16 * 1024;
const SESSION_AUDIENCE = "wih/session";

declare const actorBrand: unique symbol;

/**
 * A signed-in member who passes the *current* allow-list. Minted only inside this module, after the
 * session signature, expiry, and allow-list checks. Every Hub method takes one, so reaching the core
 * without authentication does not type-check; a cast would be visible in review.
 */
export interface Actor {
  readonly [actorBrand]: true;
  readonly sub: string;
  readonly email: Email;
  readonly name: string;
  readonly picture: string | null;
  /** Derived per request from ADMIN_EMAILS; never stored in the cookie. */
  readonly isAdmin: boolean;
}

/** What we keep from a validated Google ID token. */
export interface GoogleIdentity {
  readonly sub: string;
  readonly email: string;
  readonly emailVerified: boolean;
  /** Hosted domain. Present only for Workspace / Cloud Identity managed accounts. */
  readonly hd: string | null;
  readonly name: string;
  readonly picture: string | null;
}

export type AccessDecision =
  | { readonly allowed: true; readonly email: Email }
  | { readonly allowed: false; readonly reason: Extract<AuthErrorCode, "not_allowed" | "email_unverified"> };

/**
 * The whole authorization rule. Pure; exhaustively unit-tested.
 *
 * 1. `emailVerified !== true` -> email_unverified.
 * 2. email in `policy.emails` (exact, lowercased) -> allowed. Any Google account, e.g. a contractor.
 * 3. `hd` present, and `hd` OR the email's domain is in `policy.domains` (exact) -> allowed.
 *    - `hd` must be present: it proves a Workspace / Cloud Identity *managed* account. A consumer
 *      Google account registered with alice@example.com carries no `hd` and never passes a
 *      domain rule, whatever its email says.
 *    - Either may match: `hd` is the organisation's domain, which can differ from the user's
 *      address on a secondary domain. Accepting the email domain is safe only because `hd` is
 *      present: a domain can be verified by one Google organisation at a time.
 *    - Exact set membership, so `evil-example.com` and `example.com.evil` never match `example.com`.
 * 4. Otherwise not_allowed.
 *
 * The `hd` hint given to the GIS button is UI only; this function is the check.
 */
export function decideAccess(identity: GoogleIdentity, policy: AccessPolicy): AccessDecision {
  if (!identity.emailVerified) return { allowed: false, reason: "email_unverified" };
  const email = parseEmail(identity.email);
  if (email === null) return { allowed: false, reason: "not_allowed" };
  if (policy.emails.has(email)) return { allowed: true, email };
  const hd = identity.hd?.trim().toLowerCase() ?? "";
  if (hd !== "" && (policy.domains.has(hd) || policy.domains.has(emailDomain(email)))) return { allowed: true, email };
  return { allowed: false, reason: "not_allowed" };
}

/**
 * Cookie names and flags, derived from APP_URL so operators never configure them.
 * https -> `__Host-` names with Secure (Path=/, no Domain). http (local dev / LAN) -> plain names
 * without Secure. HttpOnly and SameSite=Lax always.
 */
export interface CookiePolicy {
  readonly session: string;
  readonly nonce: string;
  readonly secure: boolean;
}

export function cookiePolicy(appUrl: URL): CookiePolicy {
  const secure = appUrl.protocol === "https:";
  const prefix = secure ? "__Host-" : "";
  return { session: `${prefix}wih_session`, nonce: `${prefix}wih_nonce`, secure };
}

/** The claims we read from a verified Google ID token. */
export interface IdTokenClaims {
  readonly sub: string;
  readonly email?: string | undefined;
  readonly email_verified?: boolean | undefined;
  readonly hd?: string | undefined;
  readonly name?: string | undefined;
  readonly picture?: string | undefined;
  readonly nonce?: string | undefined;
}

/** Verifies signature, issuer, audience and expiry of a Google ID token, or throws. */
export type IdTokenVerifier = (idToken: string) => Promise<IdTokenClaims>;

export function googleIdTokenVerifier(clientId: string): IdTokenVerifier {
  const client = new OAuth2Client();
  return async (idToken) => {
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    const payload = ticket.getPayload();
    if (payload === undefined) throw new Error("ID token has no payload");
    return payload;
  };
}

export interface Auth {
  /**
   * For GET / without a session: a fresh single-use nonce for the GIS button, and the Set-Cookie
   * value that pins it to this browser.
   */
  issueNonce(): { readonly nonce: string; readonly setCookie: string };

  /**
   * POST /auth/google with `{ credential }`. 204 + session cookie, or 401 (`login_failed`: bad
   * token or nonce) / 403 (`not_allowed`, `email_unverified`) with a `SignInFailure` body. Always
   * clears the nonce cookie. (The Origin check happens in app.ts.)
   */
  handleSignIn(req: Request): Promise<Response>;

  /** POST /auth/logout. Clears the session cookie; 204. Works with an expired session. */
  handleLogout(req: Request): Response;

  /**
   * Session cookie -> Actor, or null if missing, malformed, badly signed, expired, or no longer
   * allowed by the current AccessPolicy (removing a domain from env and restarting locks existing
   * sessions out immediately).
   */
  actorFrom(req: Request): Promise<Actor | null>;

  /** `actorFrom` or throw `HttpError("unauthenticated")`. What every /api route calls first. */
  requireActor(req: Request): Promise<Actor>;
}

export interface AuthDeps {
  /** Injected for tests; defaults to Google's verifier for `config.auth.clientId`. */
  readonly verifyIdToken?: IdTokenVerifier;
}

export function createAuth(config: Pick<Config, "appUrl" | "auth" | "access">, log: Logger, deps: AuthDeps = {}): Auth {
  const cookies = cookiePolicy(config.appUrl);
  const verifyIdToken = deps.verifyIdToken ?? googleIdTokenVerifier(config.auth.clientId);
  // A derived key, so AUTH_SECRET itself never signs anything and can seed other keys later.
  const sessionKey = new Uint8Array(hkdfSync("sha256", config.auth.secret, "", "wih/session/v1", 32));
  const issuer = config.appUrl.origin;

  const cookie = (name: string, value: string, maxAge: number): string =>
    [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`, ...(cookies.secure ? ["Secure"] : [])].join("; ");

  const refuse = (status: 401 | 403, authError: AuthErrorCode, headers: Headers): Response => {
    headers.set("Content-Type", "application/json");
    return new Response(JSON.stringify({ authError } satisfies SignInFailure), { status, headers });
  };

  function mintActor(identity: GoogleIdentity, email: Email): Actor {
    return {
      sub: identity.sub,
      email,
      name: cleanDisplayName(identity.name) || email,
      picture: identity.picture,
      isAdmin: config.access.admins.has(email),
    } as Actor;
  }

  async function actorFrom(req: Request): Promise<Actor | null> {
    const token = readCookie(req, cookies.session);
    if (token === undefined) return null;
    try {
      const { payload } = await jwtVerify(token, sessionKey, { algorithms: ["HS256"], issuer, audience: SESSION_AUDIENCE });
      const identity: GoogleIdentity = {
        sub: typeof payload.sub === "string" ? payload.sub : "",
        email: typeof payload["email"] === "string" ? payload["email"] : "",
        emailVerified: true,
        hd: typeof payload["hd"] === "string" ? payload["hd"] : null,
        name: typeof payload["name"] === "string" ? payload["name"] : "",
        picture: typeof payload["picture"] === "string" ? payload["picture"] : null,
      };
      const decision = decideAccess(identity, config.access);
      return decision.allowed ? mintActor(identity, decision.email) : null;
    } catch {
      return null;
    }
  }

  return {
    issueNonce() {
      const nonce = randomBytes(18).toString("base64url");
      return { nonce, setCookie: cookie(cookies.nonce, nonce, NONCE_TTL_SECONDS) };
    },

    async handleSignIn(req) {
      const headers = new Headers({ "Cache-Control": "no-store" });
      headers.append("Set-Cookie", cookie(cookies.nonce, "", 0));
      const expectedNonce = readCookie(req, cookies.nonce);
      const credential = parseSignInRequest(await readJsonCapped(req, SIGN_IN_BODY_MAX_BYTES));
      if (credential === null || expectedNonce === undefined) {
        log.log("WARNING", "auth.sign_in_rejected", { reason: credential === null ? "malformed_body" : "missing_nonce" });
        return refuse(401, "login_failed", headers);
      }

      let claims: IdTokenClaims;
      try {
        claims = await verifyIdToken(credential);
      } catch (error) {
        log.log("WARNING", "auth.sign_in_rejected", { reason: "invalid_id_token", error: String(error) });
        return refuse(401, "login_failed", headers);
      }
      if (claims.nonce === undefined || !sameText(claims.nonce, expectedNonce)) {
        log.log("WARNING", "auth.sign_in_rejected", { reason: "nonce_mismatch" });
        return refuse(401, "login_failed", headers);
      }

      const identity: GoogleIdentity = {
        sub: claims.sub,
        email: claims.email ?? "",
        emailVerified: claims.email_verified === true,
        hd: claims.hd ?? null,
        name: claims.name ?? "",
        picture: claims.picture?.startsWith("https://") === true ? claims.picture : null,
      };
      const decision = decideAccess(identity, config.access);
      if (!decision.allowed) {
        log.log("INFO", "auth.sign_in_refused", { email: identity.email, hd: identity.hd, reason: decision.reason });
        return refuse(403, decision.reason, headers);
      }

      const now = Math.floor(Date.now() / 1000);
      const session = await new SignJWT({ email: decision.email, hd: identity.hd, name: identity.name, picture: identity.picture })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(identity.sub)
        .setIssuer(issuer)
        .setAudience(SESSION_AUDIENCE)
        .setIssuedAt(now)
        .setExpirationTime(now + config.auth.sessionTtlSeconds)
        .sign(sessionKey);
      headers.append("Set-Cookie", cookie(cookies.session, session, config.auth.sessionTtlSeconds));
      log.log("INFO", "auth.signed_in", { email: decision.email });
      return new Response(null, { status: 204, headers });
    },

    handleLogout() {
      const headers = new Headers({ "Cache-Control": "no-store", "Set-Cookie": cookie(cookies.session, "", 0) });
      return new Response(null, { status: 204, headers });
    },

    actorFrom,

    async requireActor(req) {
      const actor = await actorFrom(req);
      if (actor === null) throw new HttpError("unauthenticated");
      return actor;
    },
  };
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim();
      return value === "" ? undefined : value;
    }
  }
  return undefined;
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
