import { describe, expect, it } from "vitest";

import { decodeRecord, encodeRecord } from "./store";

const legacyRecord = {
  v: 1,
  id: "aaaaaaaaaaaaaaaa",
  tags: ["logo"],
  originalName: "logo.png",
  source: "upload",
  width: 1024,
  height: 683,
  frames: 1,
  originalBytes: 100,
  storedBytes: 10,
  uploadedBy: { email: "alice@example.com", name: "Alice" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("record codec", () => {
  it("decodes a record stored before originalSize existed as originalSize null, and keeps it null through a rewrite", () => {
    const decoded = decodeRecord(JSON.stringify(legacyRecord));
    expect(decoded).toMatchObject({ id: "aaaaaaaaaaaaaaaa", width: 1024, height: 683, originalSize: null });
    if (decoded === null) return;
    expect(JSON.parse(encodeRecord(decoded))).toHaveProperty("originalSize", null);
    expect(decodeRecord(encodeRecord(decoded))).toEqual(decoded);
  });

  it("round-trips originalSize", () => {
    const decoded = decodeRecord(JSON.stringify({ ...legacyRecord, originalSize: { width: 3000, height: 2000 } }));
    expect(decoded?.originalSize).toEqual({ width: 3000, height: 2000 });
    if (decoded === null) return;
    expect(JSON.parse(encodeRecord(decoded))).toMatchObject({ originalSize: { width: 3000, height: 2000 } });
    expect(decodeRecord(encodeRecord(decoded))).toEqual(decoded);
  });

  it.each([
    ["zero", { width: 0, height: 2000 }],
    ["fraction", { width: 3000, height: 1.5 }],
    ["string", { width: "3000", height: 2000 }],
    ["missing height", { width: 3000 }],
    ["not an object", 3000],
  ])("rejects a record whose originalSize is present but invalid (%s)", (_case, originalSize) => {
    expect(decodeRecord(JSON.stringify({ ...legacyRecord, originalSize }))).toBeNull();
  });
});
