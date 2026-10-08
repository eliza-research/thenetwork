import { describe, expect, test } from "bun:test";
import { readCapped, readCappedText } from "../src/body.ts";

// Audit (P3): request bodies were read in full before any size check when there was no Content-Length.
const stream = (chunks: number, size: number, onPull?: () => void) => {
  let n = 0;
  return new ReadableStream<Uint8Array>({ pull(c) { onPull?.(); if (n++ >= chunks) c.close(); else c.enqueue(new Uint8Array(size).fill(65)); } });
};
const post = (body: BodyInit, headers: Record<string, string> = {}) => new Request("https://slop.date/api/photos", { method: "POST", body, headers, duplex: "half" } as RequestInit);

describe("readCapped", () => {
  test("a declared length over the cap is refused unread", async () => {
    let pulled = 0;
    expect(await readCapped(post(stream(4, 10, () => pulled++), { "content-length": "999" }), 100)).toBe("too_large");
    expect(pulled).toBeLessThanOrEqual(1); // at most the stream's own first pull, never read on
  });

  test("a chunked body is abandoned as soon as it passes the cap", async () => {
    let pulled = 0;
    expect(await readCapped(post(stream(1000, 1024, () => pulled++)), 8 * 1024)).toBe("too_large");
    expect(pulled).toBeLessThanOrEqual(10);
  });

  test("a body within the cap comes back whole, bytes and text", async () => {
    const b = await readCapped(post(stream(3, 10)), 30);
    expect(b).not.toBe("too_large");
    expect((b as Uint8Array).byteLength).toBe(30);
    expect(await readCappedText(post('{"ok":true}'), 64)).toBe('{"ok":true}');
    expect(await readCappedText(new Request("https://slop.date/x"), 64)).toBe("");
  });
});
