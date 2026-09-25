/**
 * Search and tag filtering over the catalog. Pure; runs in the browser.
 *
 * Client-side because the catalog is small by design (target <= 10k assets), `GET /api/assets`
 * returns all of it, and filtering in memory makes search keystroke-instant with no server index to
 * build or keep in sync.
 */

import type { AssetView, Tag } from "./domain";
import { foldForMatch, tagKey } from "./domain";

export interface AssetQuery {
  /** Free text; whitespace-separated terms, all must match (AND). */
  readonly text: string;
  /** tagKey values; an asset must carry every one (AND). */
  readonly tagKeys: readonly string[];
}

export const EMPTY_QUERY: AssetQuery = { text: "", tagKeys: [] };

export const normalizeForSearch = foldForMatch;

function haystack(asset: AssetView): string {
  return [asset.originalName, ...asset.tags, asset.uploadedBy.name, asset.uploadedBy.email, asset.id]
    .map(normalizeForSearch)
    .join("\n");
}

/**
 * Terms match against the file name, tags, uploader name and email, and the id (so a pasted link
 * finds its asset). Keeps the input order (the server already sorted newest first).
 */
export function filterAssets(assets: readonly AssetView[], query: AssetQuery): AssetView[] {
  const terms = normalizeForSearch(query.text).split(/\s+/u).filter((t) => t !== "");
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
  /** Display form of the first occurrence (newest asset). */
  readonly tag: Tag;
  readonly count: number;
}

/** Tag cloud for the filter bar, most used first, then alphabetical; groups by `tagKey`. */
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

/** URL state (`?q=logo&tag=chaticon`) so a filtered view is linkable and survives reload. */
export function queryFromSearch(search: URLSearchParams): AssetQuery {
  return {
    text: search.get("q") ?? "",
    tagKeys: [...new Set(search.getAll("tag").map(normalizeForSearch).filter((k) => k !== ""))],
  };
}

export function queryToSearch(query: AssetQuery): URLSearchParams {
  const search = new URLSearchParams();
  if (query.text.trim() !== "") search.set("q", query.text);
  for (const key of query.tagKeys) search.append("tag", key);
  return search;
}
