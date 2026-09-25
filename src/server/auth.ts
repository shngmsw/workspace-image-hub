import type { Email } from "../shared/domain";

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
