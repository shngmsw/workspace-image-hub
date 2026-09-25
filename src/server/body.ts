import { HttpError } from "./errors";

/**
 * Reads a request body into memory, refusing past `maxBytes`. Checks Content-Length first (cheap
 * reject, nothing read), then counts streamed bytes anyway because Content-Length can be absent
 * (chunked) or lie.
 */
export async function readBodyCapped(req: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new HttpError("too_large", { maxBytes });
  if (req.body === null) return new Uint8Array(0);

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError("too_large", { maxBytes });
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** A capped body parsed as JSON; undefined when it is too large or not JSON. */
export async function readJsonCapped(req: Request, maxBytes: number): Promise<unknown> {
  try {
    return JSON.parse(new TextDecoder().decode(await readBodyCapped(req, maxBytes))) as unknown;
  } catch {
    return undefined;
  }
}
