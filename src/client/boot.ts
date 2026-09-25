import { BOOT_ELEMENT_ID, type BootConfig } from "../shared/api";

export function readBoot(doc: Document = document): BootConfig {
  const text = doc.getElementById(BOOT_ELEMENT_ID)?.textContent;
  if (text == null) throw new Error("boot payload missing");
  return JSON.parse(text) as BootConfig;
}
