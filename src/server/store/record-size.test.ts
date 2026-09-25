import { describe, expect, it } from "vitest";

import {
  type AssetRecord,
  cleanDisplayName,
  DISPLAY_NAME_MAX_CHARS,
  EMAIL_MAX_CHARS,
  FILE_NAME_MAX_CHARS,
  isoTimestamp,
  newAssetId,
  parseEmail,
  parseFileName,
  parseTags,
  TAG_MAX_CHARS,
  TAGS_MAX,
} from "../../shared/domain";
import { RECORD_METADATA_KEY } from "./gcs";
import { encodeRecord } from "./store";

const GCS_CUSTOM_METADATA_LIMIT = 8 * 1024;

const HOSTILE_CHARS = {
  astralFourByteUtf8: "𠮷",
  controlCharSixByteEscape: "\u0001",
  loneSurrogate: "\ud800",
  quote: '"',
  backslash: "\\",
};

function worstCaseRecord(char: string): AssetRecord {
  const tags = parseTags(
    Array.from({ length: TAGS_MAX }, (_, i) => {
      const prefix = String(i).padStart(2, "0");
      return prefix + char.repeat(TAG_MAX_CHARS - prefix.length);
    }),
  );
  if (!tags.ok) throw new Error(tags.issue);
  const local = "a".repeat(64);
  const email = parseEmail(`${local}@${"b".repeat(EMAIL_MAX_CHARS - local.length - 1)}`);
  if (email === null) throw new Error("email");
  const extreme = isoTimestamp(new Date(8.64e15));
  return {
    v: 1,
    id: newAssetId(),
    tags: tags.value,
    originalName: parseFileName(char.repeat(FILE_NAME_MAX_CHARS * 2)),
    source: "upload",
    width: Number.MAX_SAFE_INTEGER,
    height: Number.MAX_SAFE_INTEGER,
    frames: Number.MAX_SAFE_INTEGER,
    originalBytes: Number.MAX_SAFE_INTEGER,
    storedBytes: Number.MAX_SAFE_INTEGER,
    uploadedBy: { email, name: cleanDisplayName(char.repeat(DISPLAY_NAME_MAX_CHARS * 2)) },
    createdAt: extreme,
    updatedAt: extreme,
  };
}

describe("worst-case record size", () => {
  it.each(Object.entries(HOSTILE_CHARS))("fits GCS custom metadata after base64url (%s)", (_case, char) => {
    const record = worstCaseRecord(char);
    expect(record.tags).toHaveLength(TAGS_MAX);
    const encoded = Buffer.from(encodeRecord(record)).toString("base64url");
    expect(RECORD_METADATA_KEY.length + encoded.length).toBeLessThanOrEqual(GCS_CUSTOM_METADATA_LIMIT);
  });
});
