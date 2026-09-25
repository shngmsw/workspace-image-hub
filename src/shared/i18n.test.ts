import { describe, expect, it } from "vitest";

import { formatBytes, formatSizeChange, negotiateLocale } from "./i18n";

describe("negotiateLocale", () => {
  it("prefers the pinned locale, then the cookie, then q-weighted Accept-Language", () => {
    expect(negotiateLocale({ pinned: "ja", cookie: "en", acceptLanguage: "en" })).toBe("ja");
    expect(negotiateLocale({ pinned: null, cookie: "ja", acceptLanguage: "en" })).toBe("ja");
    expect(negotiateLocale({ pinned: null, cookie: "fr", acceptLanguage: "fr-FR, ja;q=0.8, en;q=0.9" })).toBe("en");
    expect(negotiateLocale({ pinned: null, cookie: undefined, acceptLanguage: "ja-JP,ja;q=0.9" })).toBe("ja");
    expect(negotiateLocale({ pinned: null, cookie: undefined, acceptLanguage: "de" })).toBe("en");
    expect(negotiateLocale({ pinned: null, cookie: undefined, acceptLanguage: undefined })).toBe("en");
  });
});

describe("sizes", () => {
  it("formats decimal units and the reduction line from the spec", () => {
    expect(formatBytes(999, "en")).toBe("999 B");
    expect(formatBytes(3_500_000, "en")).toBe("3.5 MB");
    expect(formatBytes(210_000, "en")).toBe("210 KB");
    expect(formatSizeChange(3_500_000, 210_000, "en")).toBe("3.5 MB → 210 KB (94% smaller)");
    expect(formatSizeChange(3_500_000, 210_000, "ja")).toBe("3.5 MB → 210 KB（94% 削減）");
    expect(formatSizeChange(1_000, 1_500, "en")).toBe("1 KB → 1.5 KB (50% larger)");
  });
});
