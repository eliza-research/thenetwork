/**
 * Request bodies read with a hard cap (pure Web APIs: also used by the site Worker router).
 *
 * A Content-Length over the cap is refused unread. A body without one (chunked) is read chunk by chunk
 * and abandoned as soon as it passes the cap, so no caller ever holds more than `max` bytes plus one
 * chunk (audit: unbounded request bodies; Bun's own default limit is 128 MB).
 */
export async function readCapped(req: Pick<Request, "headers" | "body">, max: number): Promise<Uint8Array<ArrayBuffer> | "too_large"> {
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > max) return "too_large";
  if (!req.body) return new Uint8Array(new ArrayBuffer(0));
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return "too_large";
    }
    parts.push(value);
  }
  const out = new Uint8Array(new ArrayBuffer(size));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}

/** The body as UTF-8 text, at most `max` bytes. */
export async function readCappedText(req: Pick<Request, "headers" | "body">, max: number): Promise<string | "too_large"> {
  const b = await readCapped(req, max);
  return b === "too_large" ? b : new TextDecoder().decode(b);
}
