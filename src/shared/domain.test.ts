import { describe, expect, it } from "vitest";

import {
  cleanDisplayName,
  emailDomain,
  newAssetId,
  parseAssetId,
  parseEmail,
  parseFileName,
  parseImageFileName,
  parseTags,
  tagKey,
  type Tag,
} from "./domain";

describe("asset ids", () => {
  it("mints 16-char Crockford ids that the parser accepts, and never repeats in practice", () => {
    const ids = new Set(Array.from({ length: 2000 }, newAssetId));
    expect(ids.size).toBe(2000);
    for (const id of ids) expect(parseAssetId(id).ok).toBe(true);
  });

  it("rejects anything that could escape a storage key", () => {
    for (const raw of ["../../etc/passwd", "0000000000000000/", "000000000000000", "000000000000000i", "ABCDEFGHJKMNPQRS"]) {
      expect(parseAssetId(raw).ok).toBe(false);
    }
    expect(parseImageFileName("0123456789abcdef.webp")).toBe("0123456789abcdef");
    expect(parseImageFileName("0123456789abcdef.png")).toBeNull();
    expect(parseImageFileName("0123456789abcdef")).toBeNull();
  });
});

describe("emails", () => {
  it("normalises case and whitespace and splits the domain exactly", () => {
    const email = parseEmail("  Alice@Example.COM ");
    expect(email).toBe("alice@example.com");
    expect(email && emailDomain(email)).toBe("example.com");
    expect(parseEmail("not an email")).toBeNull();
    expect(parseEmail("a@b@c")).toBeNull();
  });
});

describe("file names and display names", () => {
  it("strips paths and control characters, and never returns empty", () => {
    expect(parseFileName("C:\\Users\\alice\\logo final.png")).toBe("logo final.png");
    expect(parseFileName("/tmp/a\u0000b.png")).toBe("ab.png");
    expect(parseFileName("   ")).toBe("image");
    expect(Array.from(parseFileName("𠮷".repeat(500)))).toHaveLength(120);
  });

  it("repairs lone surrogates and caps display names", () => {
    expect(cleanDisplayName("Al\ud800ice\n  Smith")).toBe("Al\ufffdice Smith");
    expect(Array.from(cleanDisplayName("x".repeat(500)))).toHaveLength(100);
  });
});

describe("tags", () => {
  it("folds full-width, dedupes by key (katakana = hiragana, case-insensitive), keeps first display form", () => {
    const parsed = parseTags(["ＣｈａｔＩｃｏｎ", "chaticon", " アイコン ", "あいこん", "営業部"]);
    expect(parsed).toEqual({ ok: true, value: ["ChatIcon", "アイコン", "営業部"] });
    expect(tagKey("アイコン" as Tag)).toBe(tagKey("あいこん" as Tag));
  });

  it("rejects separators, empties, over-long tags and too many tags", () => {
    expect(parseTags(["a,b"])).toEqual({ ok: false, issue: "tag_forbidden_char" });
    expect(parseTags(["＃tag"])).toEqual({ ok: false, issue: "tag_forbidden_char" });
    expect(parseTags(["  "])).toEqual({ ok: false, issue: "tag_empty" });
    expect(parseTags(["x".repeat(33)])).toEqual({ ok: false, issue: "tag_too_long" });
    expect(parseTags(Array.from({ length: 21 }, (_, i) => `t${i}`))).toEqual({ ok: false, issue: "too_many_tags" });
    expect(parseTags(Array.from({ length: 30 }, () => "same")).ok).toBe(true);
  });
});
