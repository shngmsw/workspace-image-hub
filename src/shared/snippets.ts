/**
 * The three copy formats. Pure; the copy buttons call `snippet()` and write the result to the
 * clipboard. Adding a format means adding a case here and a label in i18n.ts; the compiler finds
 * both through `SnippetKind`.
 */

import type { AssetView } from "./domain";

export type SnippetKind = "url" | "chat" | "markdown";

export const SNIPPET_KINDS: readonly SnippetKind[] = ["url", "chat", "markdown"];

export function snippet(kind: SnippetKind, asset: Pick<AssetView, "url" | "originalName">): string {
  switch (kind) {
    case "url":
      return asset.url;
    case "chat":
      // Compact on purpose so it pastes into a single-line field.
      return JSON.stringify({ avatarUrl: asset.url });
    case "markdown":
      return `![${escapeMarkdownAlt(asset.originalName)}](${escapeMarkdownUrl(asset.url)})`;
  }
}

/** Escapes `\`, `[`, `]` so a file name cannot close the alt text early. */
export function escapeMarkdownAlt(text: string): string {
  return text.replace(/[\\[\]]/gu, (c) => `\\${c}`);
}

/** Percent-encodes `(`, `)`, and spaces; an operator's IMAGE_BASE_URL could contain them. */
export function escapeMarkdownUrl(url: string): string {
  return url.replace(/[() ]/gu, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
