export function splitTags(text: string): string[] {
  return text
    .split(/[,、，]/u)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}
