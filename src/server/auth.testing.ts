/**
 * Test-only door into `Actor`. The production bundle never contains it (esbuild follows imports
 * from main.ts, which never reaches this file), and ESLint forbids `*.testing` imports outside
 * tests and `dev.ts`, so "an Actor proves a checked session" is enforced by tooling, not by
 * reviewers remembering it.
 */

import { parseEmail } from "../shared/domain";
import type { Actor } from "./auth";

export function mintActorForTest(fields: {
  readonly email: string;
  readonly name?: string;
  readonly isAdmin?: boolean;
}): Actor {
  const email = parseEmail(fields.email);
  if (email === null) throw new Error(`not an email: ${fields.email}`);
  return {
    sub: `test:${email}`,
    email,
    name: fields.name ?? email,
    picture: null,
    isAdmin: fields.isAdmin ?? false,
  } as Actor;
}
