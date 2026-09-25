import { describe, expect, it } from "vitest";

import type { AssetId, AssetView, Email, FileName, IsoTimestamp, Tag } from "./domain";
import { filterAssets, queryFromSearch, queryToSearch, tagCounts } from "./query";
import { escapeMarkdownAlt, snippet } from "./snippets";

function asset(id: string, name: string, tags: string[], by = "alice@example.com"): AssetView {
  return {
    id: id as AssetId,
    url: `https://img.example.com/i/${id}.webp`,
    tags: tags as Tag[],
    originalName: name as FileName,
    source: "upload",
    width: 10,
    height: 10,
    animated: false,
    originalBytes: 100,
    storedBytes: 10,
    uploadedBy: { email: by as Email, name: by.split("@")[0] ?? by },
    createdAt: "2026-01-01T00:00:00.000Z" as IsoTimestamp,
    updatedAt: "2026-01-01T00:00:00.000Z" as IsoTimestamp,
    canDelete: true,
  };
}

const catalog = [
  asset("aaaaaaaaaaaaaaaa", "Logo-Final.png", ["ChatIcon", "アイコン"]),
  asset("bbbbbbbbbbbbbbbb", "spinner.gif", ["通知用"], "bob@example.com"),
  asset("cccccccccccccccc", "banner.jpg", ["chaticon"]),
];

describe("filterAssets", () => {
  it("matches every term across name, tags and uploader, folding width, case and kana", () => {
    expect(filterAssets(catalog, { text: "ＬＯＧＯ", tagKeys: [] }).map((a) => a.id)).toEqual(["aaaaaaaaaaaaaaaa"]);
    expect(filterAssets(catalog, { text: "あいこん", tagKeys: [] }).map((a) => a.id)).toEqual(["aaaaaaaaaaaaaaaa"]);
    expect(filterAssets(catalog, { text: "bob gif", tagKeys: [] }).map((a) => a.id)).toEqual(["bbbbbbbbbbbbbbbb"]);
    expect(filterAssets(catalog, { text: "bob png", tagKeys: [] })).toEqual([]);
    expect(filterAssets(catalog, { text: "", tagKeys: ["chaticon"] }).map((a) => a.id)).toEqual(["aaaaaaaaaaaaaaaa", "cccccccccccccccc"]);
  });

  it("counts tags by key, most used first", () => {
    expect(tagCounts(catalog)).toEqual([
      { key: "chaticon", tag: "ChatIcon", count: 2 },
      { key: "あいこん", tag: "アイコン", count: 1 },
      { key: "通知用", tag: "通知用", count: 1 },
    ]);
  });

  it("keeps the query in the URL", () => {
    const query = { text: "logo", tagKeys: ["chaticon", "あいこん"] };
    expect(queryFromSearch(queryToSearch(query))).toEqual(query);
  });
});

describe("snippets", () => {
  it("formats URL, Google Chat JSON and Markdown with the file name as alt text", () => {
    const a = { url: "https://img.example.com/i/x.webp", originalName: "logo [v2].png" as FileName };
    expect(snippet("url", a)).toBe("https://img.example.com/i/x.webp");
    expect(snippet("chat", a)).toBe('{"avatarUrl":"https://img.example.com/i/x.webp"}');
    expect(snippet("markdown", a)).toBe("![logo \\[v2\\].png](https://img.example.com/i/x.webp)");
    expect(snippet("markdown", { ...a, url: "https://cdn.example.com/a (1)/x.webp" })).toBe(
      "![logo \\[v2\\].png](https://cdn.example.com/a%20%281%29/x.webp)",
    );
    expect(escapeMarkdownAlt("a\\b")).toBe("a\\\\b");
  });
});
