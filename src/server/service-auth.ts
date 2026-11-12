import { createHash, timingSafeEqual } from "node:crypto";

import { type ClientName, type Email, emailDomain } from "../shared/domain";
import type { AccessPolicy, ServiceToken } from "./config";
import { HttpError, HubError } from "./errors";

export interface ServiceAuth {
  /** False when SERVICE_TOKENS is empty: the service routes then answer 404. */
  readonly enabled: boolean;
  /** The client that owns the bearer token, or throws `unauthenticated`. Never reads cookies. */
  requireClient(req: Request): ClientName;
}

/**
 * Bearer-token auth for the server-to-server API.
 *
 * Every configured token is compared on every request, through SHA-256 digests so that the
 * comparison is constant-time and independent of the presented token's length. Tokens never reach
 * a log line.
 */
export function createServiceAuth(tokens: readonly ServiceToken[]): ServiceAuth {
  const known = tokens.map((t) => ({ client: t.client, digest: digest(t.token) }));
  return {
    enabled: known.length > 0,
    requireClient(req) {
      const presented = bearerToken(req.headers.get("Authorization"));
      if (presented === null) throw new HttpError("unauthenticated");
      const candidate = digest(presented);
      let match: ClientName | null = null;
      for (const entry of known) {
        if (timingSafeEqual(entry.digest, candidate)) match = entry.client;
      }
      if (match === null) throw new HttpError("unauthenticated");
      return match;
    },
  };
}

/**
 * A service names the member it uploads for, and the hub cannot verify that claim. It can refuse
 * an address the allow-list would never let sign in, so a service cannot attribute an image to an
 * outsider. Unlike sign-in there is no `hd` claim, so a domain rule matches on the address alone.
 */
export function requireAllowedUploader(email: Email, policy: AccessPolicy): void {
  if (policy.emails.has(email) || policy.domains.has(emailDomain(email))) return;
  throw new HubError("forbidden", { reason: "uploader_not_allowed" });
}

function bearerToken(header: string | null): string | null {
  const match = /^Bearer[ ]+(\S+)[ ]*$/iu.exec(header ?? "");
  return match?.[1] ?? null;
}

function digest(text: string): Buffer {
  return createHash("sha256").update(text, "utf8").digest();
}
