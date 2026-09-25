import type { AssetView } from "./domain";

export type SnippetKind = "url" | "markdown";

export const SNIPPET_KINDS: readonly SnippetKind[] = ["url", "markdown"];

export function snippet(kind: SnippetKind, asset: Pick<AssetView, "url" | "originalName">): string {
  switch (kind) {
    case "url":
      return asset.url;
    case "markdown":
      return `![${escapeMarkdownAlt(asset.originalName)}](${escapeMarkdownUrl(asset.url)})`;
  }
}

export function escapeMarkdownAlt(text: string): string {
  return text.replace(/[\\[\]]/gu, (c) => `\\${c}`);
}

export function escapeMarkdownUrl(url: string): string {
  return url.replace(/[() ]/gu, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
