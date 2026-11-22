import { Readable } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";

export function nodeReadable(stream: ReadableStream<Uint8Array>): Readable {
  return Readable.fromWeb(stream as unknown as NodeWebStream<Uint8Array>);
}
