import { serveHttp } from "../../../packages/core/src/runtime/http.ts";
import { DAY, HOUR } from "@thenetwork/core";
import { setTimeout as sleep } from "node:timers/promises";
import { expect, test } from "vitest";
import { Window, type HTMLInputElement as TestInput } from "happy-dom";
import { act, createElement } from "react";
import type { ClockInfo, ObsDelta, ObsFeedItem, ObsOpportunity, StaffPlanPreview } from "../src/types.ts";
import { byRole, installDom } from "./dom.ts";

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
    review: { queuedAt: 0, deadline, rerolls: 0, exceptionReason: "other_concern" },
  });
  const api = await serveHttp({
    hostname: "127.0.0.1", port: 0,
    async fetch(req, server) {
      const url = new URL(req.url);
      const app = url.searchParams.get("app");
      if (url.pathname === "/ws") return server.upgrade(req, { data: undefined }) ? undefined : new Response(null, { status: 400 });
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
    window, document: window.document, navigator: window.navigator,
    location: window.location, history: window.history, localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
    WebSocket: class extends nativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        sockets.push(this);
      }
    },
  };
  const restoreDom = installDom(window, globals);
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    nativeFetch(typeof input === "string" ? new URL(input, api.url) : input, init)) as typeof fetch;
  const until = async (predicate: () => boolean) => {
    for (let attempt = 0; attempt < 250; attempt++) {
      if (predicate()) return;
      await sleep(4);
    }
    throw Error("Timed out waiting for the browser store");
  };
  const publish = (d: ObsDelta) => api.publish("updates", JSON.stringify({ type: "delta", app: "slop", mode: "game", delta: d }));

  let isolatedStore: (typeof import("../web/store.ts"))["store"] | undefined;
  try {
    const isolatedStorePath = "../web/store.ts?browser-sync";
    const { store } = await import(/* @vite-ignore */ isolatedStorePath) as typeof import("../web/store.ts");
    isolatedStore = store;
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
    const note = () => byRole<TestInput>(box, "textbox", "Note")!;
    const writeNote = async (value: string) => {
      await act(async () => {
        const input = note();
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
    };
    try {
      await act(async () => { root.render(createElement(ReviewQueue)); });
      const enter = () => new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      const transportTarget = window.document.createElement("button");
      window.document.body.append(transportTarget);
      const buttonEnter = enter();
      await act(async () => { transportTarget.dispatchEvent(buttonEnter); });
      expect(buttonEnter.defaultPrevented).toBe(false);
      expect(reviewStore.ui.focus).toBeNull();
      transportTarget.remove();
      const shortcutEnter = enter();
      await act(async () => { box.dispatchEvent(shortcutEnter); await sleep(40); });
      expect(shortcutEnter.defaultPrevented).toBe(true);
      expect(reviewStore.ui.focus).toEqual({ kind: "opportunity", id: "a" });
      await writeNote("first card note");
      await act(async () => { reviewStore.focus({ kind: "opportunity", id: "b" }); await sleep(40); });
      // spec/staffReview.md, "A changed card or revision starts a fresh draft"
      expect(note().value).toBe("");
      await writeNote("second card note");
      await act(async () => { button("Approve").click(); });
      expect(await decisionSent.promise).toMatchObject({ oppId: "b", note: "second card note" });

      await act(async () => { reviewStore.focus({ kind: "opportunity", id: "a" }); await sleep(40); });
      await writeNote("new draft");
      await act(async () => { decisionRelease.resolve(); await sleep(50); });
      // spec/staffReview.md, "An old response cannot clear or move a newer selection"
      expect([reviewStore.ui.focus?.id, note().value]).toEqual(["a", "new draft"]);
    } finally {
      await act(async () => { root.unmount(); });
      Object.assign(reviewStore, before);
    }
  } finally {
    release.resolve();
    decisionRelease.resolve();
    isolatedStore?.disconnect();
    for (const socket of sockets) { socket.onclose = null; socket.close(); }
    globalThis.fetch = nativeFetch;
    await api.stop(true);
    await window.happyDOM.close();
    restoreDom();
  }
});

test("real plan approval waits for the visible revision on click and keyboard", async () => {
  // spec/staffReview.md, "Plan approval in the console waits for the selected preview"
  const window = new Window({ url: "http://127.0.0.1" });
  const restore = installDom(window, { window, document: window.document, navigator: window.navigator,
    location: window.location, history: window.history, localStorage: window.localStorage, sessionStorage: window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import("react-dom/client");
  const { store } = await import("../web/store.ts");
  const { ReviewQueue } = await import("../web/review.tsx");
  const before = { app: store.app, mode: store.mode, me: store.me, env: store.env, clock: store.clock, opps: store.opps, ui: store.ui,
    reviewPlanPreview: store.reviewPlanPreview, decide: store.decide };
  const box = window.document.createElement("div");
  window.document.body.append(box);
  const root = createRoot(box as unknown as HTMLElement);
  const now = Date.UTC(2026, 10, 19, 17);
  const id = "exact-plan-preview";
  const opportunity = (revision: number): ObsOpportunity => ({
    id, kind: "group", source: "network", origin: "planner", generator: "plan", category: "social", city: "nyc",
    objective: "A hike", score: 0.5, explanations: {}, exploration: false, participants: ["a", "b", "c"], alternates: ["d", "e"],
    state: "IN_REVIEW", status: {}, enjoyment: {}, createdAt: now, updatedAt: now,
    review: { queuedAt: now, deadline: now + 10_000 + revision, rerolls: revision, exceptionReason: "other_concern" },
  });
  const times = [{ start: now + DAY, end: now + DAY + HOUR }, { start: now + 3 * DAY, end: now + 3 * DAY + HOUR }];
  const reply = (revision: number, name: string): StaffPlanPreview => ({
    app: "friends", opportunityId: id, revision, deadline: opportunity(revision).review!.deadline,
    activity: "Day hike", place: { name }, ...times[1]!, probeDeadline: now + 50_000, quorum: 3, maxSeats: 4,
    ...(revision === 1 ? { options: times } : {}), alternates: ["e", "d"],
  });
  const first = Promise.withResolvers<StaffPlanPreview>(), second = Promise.withResolvers<StaffPlanPreview>();
  const decisions: number[] = [];
  const button = () => [...box.querySelectorAll("button")].find(b => b.textContent === "Approve")!;
  const key = () => window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "a", bubbles: true }));
  store.app = "friends";
  store.mode = "real";
  store.me = { id: "reviewer", roles: ["reviewer"], grants: [{ role: "reviewer", app: "friends" }], via: "token" };
  store.env = { mode: "real", app: "friends", dataset: "local", label: "Real", capabilities: { canStep: false, canIntervene: false, hiddenTruth: false, readOnly: true, staffActions: true } };
  store.clock = clock(now);
  store.ui = { ...store.ui, focus: null, reviewView: "pending" };
  store.opps = new Map([[id, opportunity(0)]]);
  store.reviewPlanPreview = async (_id, revision) => ({ status: 200, data: { ok: true, preview: await (revision === 0 ? first.promise : second.promise) } });
  store.decide = async o => { decisions.push(o.review!.rerolls!); return { ok: true }; };
  try {
    await act(async () => { root.render(createElement(ReviewQueue)); });
    expect(button().disabled).toBe(true);
    await act(async () => { button().click(); key(); });
    expect(decisions).toEqual([]);
    await act(async () => {
      store.opps.set(id, opportunity(1));
      root.render(createElement(ReviewQueue));
    });
    await act(async () => { first.resolve(reply(0, "Old park")); });
    expect(button().disabled).toBe(true);
    expect(box.textContent).not.toContain("Old park");
    await act(async () => { second.resolve(reply(1, "Inwood Hill Park")); });
    const facts = box.querySelector("section[aria-label='Plan under review']")!;
    expect(facts.textContent).toMatch(/Inwood Hill Park.*Quorum 3.*1\. e, 2\. d/s);
    expect([...facts.querySelectorAll("ol[aria-label='Time options'] li")].map(li => li.textContent)).toEqual([
      "A. Nov 20, 12:00 PM – Nov 20, 1:00 PM ET", "B. Nov 22, 12:00 PM – Nov 22, 1:00 PM ET",
    ]);
    expect(button().disabled).toBe(false);
    await act(async () => { key(); });
    expect(decisions).toEqual([1]);
  } finally {
    await act(async () => { root.unmount(); });
    Object.assign(store, before);
    restore();
    await window.happyDOM.close();
  }
});
