import type { AssetView, Tag } from "./domain";
import { foldForMatch, tagKey } from "./domain";

export interface AssetQuery {
  readonly text: string;
  readonly tagKeys: readonly string[];
}

function haystack(asset: AssetView): string {
  return [asset.originalName, ...asset.tags, asset.uploadedBy.name, asset.uploadedBy.email, asset.id]
    .map(foldForMatch)
    .join("\n");
}

export function filterAssets(assets: readonly AssetView[], query: AssetQuery): AssetView[] {
  const terms = foldForMatch(query.text).split(/\s+/u).filter((t) => t !== "");
  if (terms.length === 0 && query.tagKeys.length === 0) return [...assets];
  return assets.filter((asset) => {
    if (query.tagKeys.length > 0) {
      const keys = new Set(asset.tags.map(tagKey));
      if (!query.tagKeys.every((k) => keys.has(k))) return false;
    }
    if (terms.length === 0) return true;
    const text = haystack(asset);
    return terms.every((t) => text.includes(t));
  });
}

export interface TagCount {
  readonly key: string;
  readonly tag: Tag;
  readonly count: number;
}

export function tagCounts(assets: readonly AssetView[]): TagCount[] {
  const counts = new Map<string, { tag: Tag; count: number }>();
  for (const asset of assets) {
    for (const tag of asset.tags) {
      const key = tagKey(tag);
      const entry = counts.get(key);
      if (entry === undefined) counts.set(key, { tag, count: 1 });
      else entry.count += 1;
    }
  }
  return [...counts]
    .map(([key, { tag, count }]) => ({ key, tag, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function queryFromSearch(search: URLSearchParams): AssetQuery {
  return {
    text: search.get("q") ?? "",
    tagKeys: [...new Set(search.getAll("tag").map(foldForMatch).filter((k) => k !== ""))],
  };
}

export function queryToSearch(query: AssetQuery): URLSearchParams {
  const search = new URLSearchParams();
  if (query.text.trim() !== "") search.set("q", query.text);
  for (const key of query.tagKeys) search.append("tag", key);
  return search;
}
