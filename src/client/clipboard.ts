/**
 * The async Clipboard API needs a secure context (LAN installs on plain http:// are not one) and a
 * focused document, and some browsers deny it by policy. Any of those falls back to a hidden
 * textarea and execCommand, which still works from a click.
 */
export async function copyText(text: string): Promise<void> {
  if (window.isSecureContext && "clipboard" in navigator) {
    const written = await navigator.clipboard.writeText(text).then(
      () => true,
      () => false,
    );
    if (written) return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- the only clipboard API outside secure contexts
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) throw new Error("copy failed");
}
