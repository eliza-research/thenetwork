import { openAsBlob, statSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname } from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { nodeReadable } from "./streams.ts";
import { fileURLToPath } from "node:url";

type Path = string | URL;
const mime = new Map([
  [".css", "text/css"], [".html", "text/html"], [".js", "text/javascript"],
  [".json", "application/json"], [".md", "text/markdown"], [".png", "image/png"],
  [".svg", "image/svg+xml"], [".txt", "text/plain"], [".woff2", "font/woff2"],
]);

export function fileAt(path: Path) {
  const local = path instanceof URL ? fileURLToPath(path) : path;
  const type = mime.get(extname(local).toLowerCase()) ?? "application/octet-stream";
  return {
    get size() {
      try { return statSync(local).size; } catch { return 0; }
    },
    type,
    text: () => readFile(local, "utf8"),
    bytes: () => readFile(local),
    async arrayBuffer() {
      const bytes = await readFile(local);
      return Uint8Array.from(bytes).buffer;
    },
    async json() { return JSON.parse(await readFile(local, "utf8")); },
    async exists() { return access(local).then(() => true, () => false); },
    blob: () => openAsBlob(local, { type }),
  };
}

type Data = string | ArrayBuffer | ArrayBufferView | Blob | Response | ReturnType<typeof fileAt> | ReadableStream<Uint8Array>;

export async function writePath(path: Path, value: Data): Promise<void> {
  const local = path instanceof URL ? fileURLToPath(path) : path;
  await mkdir(dirname(local), { recursive: true });
  if (typeof value === "string") return writeFile(local, value);
  if (value instanceof ArrayBuffer) return writeFile(local, new Uint8Array(value));
  if (ArrayBuffer.isView(value)) return writeFile(local, new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  const stream = value instanceof Response ? value.body
    : value instanceof Blob ? value.stream()
      : "blob" in value ? (await value.blob()).stream() : value;
  if (stream) await pipeline(nodeReadable(stream), createWriteStream(local));
  else await writeFile(local, "");
}
