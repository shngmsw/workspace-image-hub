/**
 * Reads the server-rendered BootConfig. Trusted: same-origin HTML the server just produced, so no
 * schema validation here (validation lives where untrusted data enters: the server).
 *
 * This is the browser's only source of configuration. ESLint bans `import.meta.env` and
 * `process.env` under src/client, because either would be inlined at build time and baked into the
 * one image every organisation shares.
 */

import { BOOT_ELEMENT_ID, type BootConfig } from "../shared/api";

export function readBoot(doc: Document = document): BootConfig {
  const text = doc.getElementById(BOOT_ELEMENT_ID)?.textContent;
  if (text == null) throw new Error("boot payload missing");
  return JSON.parse(text) as BootConfig;
}
