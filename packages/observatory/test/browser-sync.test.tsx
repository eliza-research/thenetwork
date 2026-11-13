import { expect, test } from "bun:test";
import { Window, type HTMLInputElement as TestInput } from "happy-dom";
import { act, createElement } from "react";
import type { ClockInfo, ObsDelta, ObsFeedItem, ObsOpportunity } from "../src/types.ts";

const clock = (now: number): ClockInfo => ({ now, start: 0, day: 1, playing: false, speed: 0, waitingForPlayer: false });
const item = (seq: number): ObsFeedItem => ({ seq, t: seq, kind: "review", text: `review ${seq}` });

test("the console keeps the current view, live feed, and review draft", async () => {
  const waiting = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const decisionSent = Promise.withResolvers<{ oppId: string; note?: string }>();
  const decisionRelease = Promise.withResolvers<void>();
  const opportunity = (id: string, deadline: number): Partial<ObsOpportunity> => ({
    id, state: "IN_REVIEW", participants: [id], explanations: { [id]: `${id} draft` }, alternates: [],
    objective: `${id} objective`, kind: "intro", score: 0, source: "player", createdAt: 0, updatedAt: 0,
    review: { queuedAt: 0, deadline, rerolls: 0 },
  });
  const api = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(req, server) {
      const url = new URL(req.url);
      const app = url.searchParams.get("app");
      if (url.pathname === "/ws") return server.upgrade(req) ? undefined : new Response(null, { status: 400 });
      if (url.pathname === "/api/ws-ticket") return Response.json({ ticket: "local" });
      if (url.pathname === "/api/me") return Response.json({ id: "staff", roles: ["admin"], grants: [{ role: "admin", app: "*" }], via: "token", apps: ["ntwrk", "slop"] });
      if (url.pathname === "/api/mode") return Response.json({ mode: "game" });
      if (url.pathname === "/api/reveal") return Response.json([]);
      if (url.pathname === "/api/control") {
        decisionSent.resolve(await req.json() as { oppId: string; note?: string });
        await decisionRelease.promise;
        return Response.json({ ok: true });
      }
      if (url.pathname !== "/api/state") return new Response(null, { status: 404 });
      if (app === "ntwrk") { waiting.resolve(); await release.promise; }
      const version = app === "slop" ? 8 : 10;
      return Response.json({
        env: { mode: "game", app, capabilities: { canIntervene: false, readOnly: false } }, clock: clock(version), version,
        members: [], opportunities: app === "slop" ? [opportunity("a", 100), opportunity("b", 200)] : [], edges: [],
        feed: [item(version)], engineRuns: [],
      });
    },
    websocket: { open(ws) { ws.subscribe("updates"); }, message() {} },
  });
  const window = new Window({ url: api.url.href });
  const nativeFetch = globalThis.fetch;
  const nativeSocket = globalThis.WebSocket;
  const sockets: WebSocket[] = [];
  const globals = {
    window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement,
    location: window.location, history: window.history, localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
    WebSocket: class extends nativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        sockets.push(this);
      }
    },
  };
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

    const { createRoot } = await import("react-dom/client");
    // ReviewQueue and its descendants use the shared store. Save and restore the fields this
    // fixture changes so the other browser integration can use its own session in the same process.
    const { store: reviewStore } = await import("../web/store.ts");
    const before = { app: reviewStore.app, mode: reviewStore.mode, me: reviewStore.me, env: reviewStore.env, clock: reviewStore.clock, opps: reviewStore.opps, ui: reviewStore.ui };
    reviewStore.app = "slop";
    reviewStore.me = store.me;
    reviewStore.env = store.env;
    reviewStore.clock = store.clock;
    reviewStore.opps = store.opps;
    const { ReviewQueue } = await import("../web/review.tsx");
    const box = window.document.createElement("div");
    window.document.body.append(box);
    const root = createRoot(box as unknown as HTMLElement);
    const button = (text: string) => [...box.querySelectorAll("button")].find(b => b.textContent === text)!;
    const note = () => box.querySelector<TestInput>(".note")!;
    const writeNote = async (value: string) => {
      await act(async () => {
        const input = note();
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
    };
    try {
      await act(async () => { root.render(createElement(ReviewQueue)); });
      await writeNote("first card note");
      await act(async () => { reviewStore.focus({ kind: "opportunity", id: "b" }); await Bun.sleep(40); });
      // spec/staffReview.md, "A changed card or revision starts a fresh draft"
      expect(note().value).toBe("");
      await writeNote("second card note");
      await act(async () => { button("Approve").click(); });
      expect(await decisionSent.promise).toMatchObject({ oppId: "b", note: "second card note" });

      await act(async () => { reviewStore.focus({ kind: "opportunity", id: "a" }); await Bun.sleep(40); });
      await writeNote("new draft");
      await act(async () => { decisionRelease.resolve(); await Bun.sleep(50); });
      // spec/staffReview.md, "An old response cannot clear or move a newer selection"
      expect([reviewStore.ui.focus?.id, note().value]).toEqual(["a", "new draft"]);
    } finally {
      await act(async () => { root.unmount(); });
      Object.assign(reviewStore, before);
    }
  } finally {
    release.resolve();
    decisionRelease.resolve();
    for (const socket of sockets) { socket.onclose = null; socket.close(); }
    globalThis.fetch = nativeFetch;
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    api.stop(true);
    await window.happyDOM.close();
  }
});
