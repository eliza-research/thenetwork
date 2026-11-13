import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { ClockInfo, ObsDelta } from "../src/types.ts";

const clock = (now: number): ClockInfo => ({ now, start: 0, day: 1, playing: false, speed: 0, waitingForPlayer: false });
const item = (seq: number) => ({ seq, t: seq, kind: "review", text: `review ${seq}` });

test("the console keeps the current app snapshot and applies each live feed event once", async () => {
  const waiting = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const api = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(req, server) {
      const url = new URL(req.url);
      const app = url.searchParams.get("app");
      if (url.pathname === "/ws") return server.upgrade(req) ? undefined : new Response(null, { status: 400 });
      if (url.pathname === "/api/ws-ticket") return Response.json({ ticket: "local" });
      if (url.pathname === "/api/me") return Response.json({ id: "staff", roles: ["admin"], grants: [], via: "token", apps: ["ntwrk", "slop"] });
      if (url.pathname === "/api/mode") return Response.json({ mode: "game" });
      if (url.pathname === "/api/reveal") return Response.json([]);
      if (url.pathname !== "/api/state") return new Response(null, { status: 404 });
      if (app === "ntwrk") { waiting.resolve(); await release.promise; }
      const version = app === "slop" ? 8 : 10;
      return Response.json({
        env: { mode: "game", app }, clock: clock(version), version,
        members: [], opportunities: [], edges: [], feed: [item(version)], engineRuns: [],
      });
    },
    websocket: { open(ws) { ws.subscribe("updates"); }, message() {} },
  });
  const window = new Window({ url: api.url.href });
  const nativeFetch = globalThis.fetch;
  const globals = { window, location: window.location, history: window.history, localStorage: window.localStorage, sessionStorage: window.sessionStorage };
  const saved = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    nativeFetch(typeof input === "string" ? new URL(input, api.url) : input, init)) as typeof fetch;
  const until = async (predicate: () => boolean) => {
    for (let attempt = 0; attempt < 250; attempt++) {
      if (predicate()) return;
      await Bun.sleep(4);
    }
    throw Error("Timed out waiting for the browser store");
  };
  const publish = (d: ObsDelta) => api.publish("updates", JSON.stringify({ type: "delta", app: "slop", mode: "game", delta: d }));

  try {
    const { store } = await import(`../web/store.ts?browser-sync=${api.port}`) as typeof import("../web/store.ts");
    const olderLoad = store.load();
    await waiting.promise;
    store.setApp("slop");
    await until(() => store.connected && !store.loading && store.version === 8);
    release.resolve();
    await olderLoad;
    // spec/observatorySync.md, "Only the current load can publish or fail a snapshot"
    expect([store.env?.app, store.version]).toEqual(["slop", 8]);

    publish({ version: 7, clock: clock(7), feed: [item(7)] });
    publish({ version: 8, clock: clock(80), feed: [item(8)] });
    await until(() => store.clock?.now === 80);
    // spec/observatorySync.md, "Only the next data version can change the view"
    expect([store.version, store.feed.map(entry => entry.seq)]).toEqual([8, [8]]);

    publish({ version: 9, clock: clock(9), feed: [item(8), item(9)] });
    await until(() => store.version === 9);
    // spec/observatorySync.md, "The activity feed adds each new sequence once"
    expect(store.feed.map(entry => entry.seq)).toEqual([8, 9]);
  } finally {
    release.resolve();
    globalThis.fetch = nativeFetch;
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    api.stop(true);
    await window.happyDOM.close();
  }
});
