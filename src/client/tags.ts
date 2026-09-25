/** Splits a tag box on ASCII, ideographic and full-width commas; the server's parser is the judge. */
export function splitTags(text: string): string[] {
  return text
    .split(/[,、，]/u)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}
