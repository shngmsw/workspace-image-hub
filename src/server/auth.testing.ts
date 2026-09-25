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
