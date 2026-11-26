import { createServer, STATUS_CODES, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { pipeline } from "node:stream/promises";
import { WebSocket, WebSocketServer } from "ws";
import { nodeReadable } from "./streams.ts";

export interface ServerWebSocket<Data> {
  readonly data: Data;
  send(message: string): void;
  close(code?: number, reason?: string): void;
  subscribe(topic: string): void;
  unsubscribe(topic: string): void;
}

export interface HttpServer<Data = unknown> {
  readonly port: number;
  readonly hostname: string;
  readonly url: URL;
  requestIP(request: Request): AddressInfo | null;
  upgrade(request: Request, options: { data: Data; headers?: HeadersInit }): boolean;
  publish(topic: string, message: string): void;
  stop(force?: boolean): Promise<void>;
}

type RouteRequest = Request & { readonly params: Record<string, string> };
type Result = Response | undefined | Promise<Response | undefined>;
type Handler<Data> = (request: RouteRequest, server: HttpServer<Data>) => Result;
type Route<Data> = Response | Handler<Data> | Partial<Record<string, Handler<Data>>>;
type Options<Data> = {
  hostname?: string;
  port: number;
  development?: boolean;
  idleTimeout?: number;
  maxRequestBodySize?: number;
  routes?: Record<string, Route<Data>>;
  fetch?: Handler<Data>;
  websocket?: {
    open?: (socket: ServerWebSocket<Data>) => void;
    message?: (socket: ServerWebSocket<Data>, message: string | Buffer) => void;
    close?: (socket: ServerWebSocket<Data>, code: number, reason: string) => void;
  };
};

const defaultBodyLimit = 128 * 1024 * 1024;
const literalHost = (host: string) => host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;

async function readBody(message: IncomingMessage, limit: number) {
  if (Number(message.headers["content-length"]) > limit) return null;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of message.iterator({ destroyOnReturn: false })) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.length;
    if (size > limit) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

async function writeResponse(response: Response, out: ServerResponse, head: boolean) {
  out.statusCode = response.status;
  for (const [key, value] of response.headers) {
    if (key !== "set-cookie") out.setHeader(key, value);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length) out.setHeader("set-cookie", cookies);
  if (head || !response.body) out.end();
  else await pipeline(nodeReadable(response.body), out);
}

function routeParams(parts: string[], path: string) {
  const segments = path.split("/");
  const params: Record<string, string> = Object.create(null);
  for (const [i, part] of parts.entries()) {
    if (part === "*") return params;
    if (segments[i] === undefined) return;
    if (part.startsWith(":")) {
      if (!segments[i]) return;
      params[part.slice(1)] = segments[i]!;
    } else if (part !== segments[i]) return;
  }
  return parts.length === segments.length ? params : undefined;
}

type Upgrade = { incoming: IncomingMessage; socket: Duplex; head: Buffer; accepted: boolean };

export async function serveHttp<Data = unknown>(options: Options<Data>): Promise<HttpServer<Data>> {
  const hostname = options.hostname ?? "0.0.0.0";
  const routes = Object.entries(options.routes ?? {})
    .map(([path, route]) => ({ parts: path.split("/"), route }))
    .sort((a, b) => routeRank(b.parts) - routeRank(a.parts));
  const peers = new WeakMap<Request, AddressInfo>();
  const upgrades = new WeakMap<Request, Upgrade>();
  const upgradeHeaders = new WeakMap<IncomingMessage, Headers>();
  const topics = new Map<WebSocket, Set<string>>();
  const sockets = options.websocket ? new WebSocketServer({ noServer: true }) : undefined;
  sockets?.on("headers", (headers, request) => {
    for (const [key, value] of upgradeHeaders.get(request) ?? []) headers.push(`${key}: ${value}`);
  });
  const http = createServer((incoming, out) => {
    void (async () => {
      const method = incoming.method ?? "GET";
      const hasBody = method !== "GET" && method !== "HEAD";
      const body = hasBody ? await readBody(incoming, options.maxRequestBodySize ?? defaultBodyLimit) : undefined;
      if (body === null) {
        out.setHeader("Connection", "close");
        incoming.resume();
        await writeResponse(new Response("Request body too large", { status: 413 }), out, false);
        return;
      }
      const request = makeRequest(incoming, body);
      const response = await dispatch(request);
      await writeResponse(response ?? new Response("not found", { status: 404 }), out, method === "HEAD");
    })().catch(error => {
      if (options.development) console.error(error);
      if (out.headersSent) out.destroy();
      else { out.statusCode = 500; out.end("Internal Server Error"); }
    });
  });
  const idleTimeoutMs = (options.idleTimeout ?? 10) * 1000;
  // Bound idle keep-alive sockets without killing active in-flight async handlers.
  http.setTimeout(0);
  http.keepAliveTimeout = idleTimeoutMs;
  if (http.headersTimeout <= idleTimeoutMs) http.headersTimeout = idleTimeoutMs + 1000;
  http.on("upgrade", (incoming, socket, head) => {
    if (!sockets) { socket.destroy(); return; }
    socket.on("error", () => socket.destroy());
    void (async () => {
      const request = makeRequest(incoming);
      const upgrade = { incoming, socket, head, accepted: false };
      upgrades.set(request, upgrade);
      const response = await dispatch(request, true);
      if (upgrade.accepted) return;
      const status = response?.status ?? 400;
      const text = response ? Buffer.from(await response.arrayBuffer()) : Buffer.alloc(0);
      const headers = [...(response?.headers ?? [])].filter(([key]) => key !== "content-length" && key !== "connection");
      socket.end(Buffer.concat([Buffer.from([
        `HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ""}`,
        "Connection: close", `Content-Length: ${text.length}`,
        ...headers.map(([key, value]) => `${key}: ${value}`), "", "",
      ].join("\r\n")), text]));
    })().catch(() => socket.destroy());
  });

  let closing: Promise<void> | undefined;
  const server: HttpServer<Data> = {
    get port() { return (http.address() as AddressInfo | null)?.port ?? options.port; },
    hostname,
    get url() {
      const host = hostname === "0.0.0.0" ? "127.0.0.1" : hostname === "::" ? "::1" : hostname;
      return new URL(`http://${literalHost(host)}:${server.port}/`);
    },
    requestIP: request => peers.get(request) ?? null,
    upgrade(request, { data, headers }) {
      const upgrade = upgrades.get(request);
      if (!sockets || !upgrade || upgrade.accepted || closing) return false;
      upgrade.accepted = true;
      if (headers) upgradeHeaders.set(upgrade.incoming, new Headers(headers));
      sockets.handleUpgrade(upgrade.incoming, upgrade.socket, upgrade.head, wire => {
        const subscribed = new Set<string>();
        topics.set(wire, subscribed);
        const socket: ServerWebSocket<Data> = {
          data,
          send: message => { if (wire.readyState === WebSocket.OPEN) wire.send(message); },
          close: (code, reason) => wire.close(code, reason),
          subscribe: topic => { subscribed.add(topic); },
          unsubscribe: topic => { subscribed.delete(topic); },
        };
        wire.on("error", () => wire.terminate());
        wire.on("message", (value, binary) => {
          const bytes = Array.isArray(value) ? Buffer.concat(value) : Buffer.from(value as Buffer);
          options.websocket?.message?.(socket, binary ? bytes : bytes.toString());
        });
        wire.once("close", (code, reason) => {
          topics.delete(wire);
          options.websocket?.close?.(socket, code, reason.toString());
        });
        options.websocket?.open?.(socket);
      });
      return true;
    },
    publish(topic, message) {
      for (const [socket, subscribed] of topics) {
        if (subscribed.has(topic) && socket.readyState === WebSocket.OPEN) socket.send(message);
      }
    },
    stop(force = false) {
      closing ??= Promise.all([
        new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve())),
        sockets ? new Promise<void>((resolve, reject) => sockets.close(error => error ? reject(error) : resolve())) : undefined,
      ]).then(() => undefined);
      void closing.catch(() => {});
      if (force) {
        for (const socket of topics.keys()) socket.terminate();
        http.closeAllConnections();
      }
      return closing;
    },
  };

  function makeRequest(incoming: IncomingMessage, body?: Buffer): RouteRequest {
    const path = incoming.url?.startsWith("/") ? incoming.url : "/";
    const host = incoming.headers.host ?? `${literalHost(hostname)}:${server.port}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) for (const item of value) headers.append(key, item);
      else if (value !== undefined) headers.set(key, value);
    }
    const request = new Request(`http://${host}${path}`, {
      method: incoming.method,
      headers,
      ...(body?.length ? { body: new Uint8Array(body) } : {}),
    }) as RouteRequest;
    Object.defineProperty(request, "params", { value: {}, configurable: true });
    const { remoteAddress, remotePort, remoteFamily } = incoming.socket;
    if (remoteAddress && remotePort !== undefined) {
      peers.set(request, { address: remoteAddress, port: remotePort, family: remoteFamily ?? "IPv4" });
    }
    return request;
  }

  function dispatch(request: RouteRequest, upgrading = false): Result {
    if (!upgrading) {
      const path = new URL(request.url).pathname;
      for (const { parts, route } of routes) {
        const params = routeParams(parts, path);
        if (!params) continue;
        if (route instanceof Response) return route.clone();
        const handler = typeof route === "function" ? route : route[request.method];
        if (!handler) continue;
        Object.defineProperty(request, "params", { value: params, configurable: true });
        return handler(request, server);
      }
    }
    return options.fetch?.(request, server);
  }

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(options.port, hostname, () => {
      http.removeListener("error", reject);
      resolve();
    });
  });
  return server;
}

const routeRank = (parts: string[]) =>
  parts.reduce((rank, part) => rank * 4 + (part === "*" ? 0 : part.startsWith(":") ? 1 : 2), 0)
  / 4 ** parts.length;
