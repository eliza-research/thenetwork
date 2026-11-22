import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { nodeReadable } from "./streams.ts";

/** Exercise a named virtual host on the HTTP server listening at the given URL. */
export function fetchWithHost(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new TypeError(`Unsupported protocol ${url.protocol}`);
  if (!request.headers.has("accept-encoding")) request.headers.set("accept-encoding", "identity");

  return new Promise((resolve, reject) => {
    const outgoing = send(url, {
      method: request.method,
      signal: request.signal,
      headers: Object.fromEntries(request.headers),
    }, incoming => {
      const headers = new Headers();
      const raw = incoming.rawHeaders;
      for (let i = 0; i < raw.length; i += 2) headers.append(raw[i]!, raw[i + 1]!);
      const status = incoming.statusCode!;
      const noBody = request.method === "HEAD" || status === 204 || status === 205 || status === 304;
      const body = noBody ? null : Readable.toWeb(incoming) as ReadableStream<Uint8Array<ArrayBuffer>>;
      if (noBody) incoming.resume();
      resolve(new Response(body, { status, headers }));
    });
    outgoing.once("error", reject);
    if (request.body) void pipeline(nodeReadable(request.body), outgoing).catch(reject);
    else outgoing.end();
  });
}
