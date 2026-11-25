// Place detail "Meetings" KPI vs the pipeline Met column: a meeting held outside
// the range must not appear in the list the KPI opens.
//
// spec/meetingSettlement.md: "A late answer can enter private feedback within
// seven days of the meeting." So a meeting held 10 days ago can still collect
// feedback 2 days ago, which moves its updatedAt into the 7d range. The KPI
// counts meetings HELD in the range (panels.tsx KpiGrid: MET + meetingAt in
// range), but the pipeline filtered on updatedAt (store.ts matchOpp), so the
// list showed one meeting more than the number. The fix range-tests MET
// opportunities by meetingAt (falling back to updatedAt), the same time
// health.ts uses for a held meeting (meetingAt ?? updatedAt).
//
// User action: search "harlem", Enter to open the Harlem place detail, read
// "Meetings · 7d", click it, and read the Met column of the pipeline drawer.
// Fixture: o-new met 2 days ago (in range both ways), o-old met 10 days ago
// with feedback 2 days ago (in range by updatedAt only), o-ast met 2 days ago
// in Astoria (other place, must stay out of both), o-cancelled cancelled with
// a meeting 10 days ago and an update 2 days ago (a closed opportunity keeps
// its updatedAt for the range test, so it stays in the Closed column).
import { serveHttp } from "../../../packages/core/src/runtime/http.ts";
import { setTimeout as sleep } from "node:timers/promises";
import { expect, test } from "vitest";
import { Window, type HTMLInputElement as TestInput } from "happy-dom";
import { act } from "react";
import type { ClockInfo, ObsMember, ObsOpportunity, ObsState, ObsStats } from "../src/types.ts";
import { installDom } from "./dom.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const clock = (now: number): ClockInfo => ({ now, start: 0, day: 1, playing: false, speed: 0, waitingForPlayer: false });
const counters = () => ({ msgsIn: 0, msgsOut: 0, proactive: 0, proposals: 0, accepted: 0, meetings: 0, enjoymentSum: 0, enjoymentN: 0 });
const member = (id: string, name: string, area: string): ObsMember => ({
  id, name, city: "nyc", area, state: "normal", joined: true, joinedAt: NOW - 30 * DAY, minor: false, age: 30, counters: counters(),
});
const opp = (id: string, state: ObsOpportunity["state"], participants: string[], meetingAt: number, updatedAt: number): ObsOpportunity => ({
  id, kind: "intro", source: "engine", generator: "probe", city: "nyc",
  objective: "meet", score: 1, explanations: {}, exploration: false,
  participants, alternates: [], state, status: Object.fromEntries(participants.map(p => [p, "attended"])),
  enjoyment: {}, createdAt: meetingAt - DAY, updatedAt, meetingAt,
});
const stats = (): ObsStats => ({
  members: 4, joined: 4, byCity: { nyc: 4 }, byState: { joined: 4 }, messages: 0, inbound: 0, outbound: 0,
  proactive: 0, proposals: 0, proposalsBySource: {}, oppsByState: {}, invites: 0, accepts: 0, declines: 0,
  meetingsScheduled: 0, meetingsHeld: 0, attended: 0, noShows: 0, cancelledWithNotice: 0,
  enjoymentSum: 0, enjoymentN: 0, blocks: 0, optOuts: 0, adversarialAttempts: 0, invariantViolations: 0,
  errors: 0, compatible: 0, unsafe: 0, oracleJudged: 0, edgesByType: {},
});

test("Harlem place detail Meetings KPI and the pipeline Met column agree after late feedback", async () => {
  const state: ObsState = {
    env: {
      mode: "game", app: "ntwrk", label: "SIMULATION seed 1 · synthetic v1", dataset: "synthetic v1",
      capabilities: { canStep: false, canIntervene: false, hiddenTruth: false, readOnly: false },
    },
    clock: clock(NOW), version: 10,
    members: [member("m1", "Maya Rao", "Harlem"), member("m2", "Jon Park", "Harlem"),
      member("m3", "Ava Chen", "Astoria"), member("m4", "Leo Diaz", "Astoria")],
    edges: [],
    opportunities: [
      opp("o-new", "COMPLETED", ["m1", "m2"], NOW - 2 * DAY, NOW - 2 * DAY),
      opp("o-old", "FEEDBACK_COLLECTED", ["m1", "m2"], NOW - 10 * DAY, NOW - 2 * DAY),
      opp("o-ast", "COMPLETED", ["m3", "m4"], NOW - 2 * DAY, NOW - 2 * DAY),
      opp("o-cancelled", "CANCELLED", ["m1", "m2"], NOW - 10 * DAY, NOW - 2 * DAY),
    ],
    feed: [], stats: stats(), engineRuns: [],
  };
  const api = await serveHttp({
    hostname: "127.0.0.1", port: 0,
    async fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") return server.upgrade(req, { data: undefined }) ? undefined : new Response(null, { status: 400 });
      if (url.pathname === "/api/ws-ticket") return Response.json({ ticket: "local" });
      if (url.pathname === "/api/me") return Response.json({ id: "staff", roles: ["admin"], grants: [{ role: "admin", app: "*" }], via: "token", apps: ["ntwrk"] });
      if (url.pathname === "/api/mode") return Response.json({ mode: "game" });
      if (url.pathname === "/api/reveal") return Response.json([]);
      if (url.pathname === "/api/state") return Response.json(state);
      return Response.json({ error: "unexpected" }, { status: 404 });
    },
    websocket: { open(ws) { ws.subscribe("updates"); }, message() {} },
  });
  const window = new Window({ url: api.url.href });
  const nativeFetch = globalThis.fetch;
  const nativeSocket = globalThis.WebSocket;
  const sockets: WebSocket[] = [];
  const restoreDom = installDom(window, {
    window, document: window.document, navigator: window.navigator,
    location: window.location, history: window.history,
    localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
    CustomEvent: window.CustomEvent,
    WebSocket: class extends nativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        sockets.push(this);
      }
    },
  });
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    nativeFetch(typeof input === "string" ? new URL(input, api.url) : input, init)) as typeof fetch;
  const makeCtx = () => new Proxy(function () {}, {
    get: (_t, p) => {
      if (p === "canvas") return window.document.createElement("canvas");
      if (p === "measureText") return () => ({ width: 0 });
      if (p === "getImageData") return () => ({ data: [] });
      if (p === "createLinearGradient" || p === "createRadialGradient" || p === "createPattern") return () => ({ addColorStop() {} });
      return (..._a: unknown[]) => undefined;
    },
    set: () => true,
    apply: () => undefined,
  });
  window.HTMLCanvasElement.prototype.getContext = (function () { return makeCtx() as unknown as CanvasRenderingContext2D; }) as unknown as typeof window.HTMLCanvasElement.prototype.getContext;
  const root = window.document.createElement("div");
  root.id = "root";
  window.document.body.append(root);
  const wait = async (check: () => boolean, label: string) => {
    for (let i = 0; i < 250; i++) { if (check()) return; await act(async () => { await sleep(5); }); }
    throw Error(`timed out waiting for ${label}: ${window.document.body.textContent?.slice(0, 400)}`);
  };
  const text = (el: { textContent?: string | null } | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  try {
    const { store } = await import("../web/store.ts");
    await import("../web/main.tsx");
    await wait(() => !!window.document.getElementById("obs-search"), "the search box");
    const input = window.document.getElementById("obs-search") as unknown as TestInput;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, "harlem");
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await wait(() => window.document.querySelectorAll('[role="option"]').length >= 2, "place hits");
    // Click the exact place hit (not Enter: the base search order puts East
    // Harlem first, which is the #699 defect, not this test's subject).
    const hit = [...window.document.querySelectorAll('[role="option"]')]
      .find(el => text(el).startsWith("Harlem · Manhattan"))!;
    await act(async () => {
      hit.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await sleep(10);
    });
    expect(store.ui.focus).toEqual({ kind: "neighborhood", id: "Harlem" });
    // Gate on the place heading: the overview (no focus) has its own unscoped
    // Meetings KPI, so read the KPI only after the detail panel has mounted.
    await wait(() => [...window.document.querySelectorAll("h2")].some(h => text(h) === "Harlem"), "the Harlem heading");
    await wait(() => [...window.document.querySelectorAll("button")].some(b => text(b).includes("Meetings · 7d")), "the Meetings KPI");
    const kpi = [...window.document.querySelectorAll("button")].find(b => text(b).includes("Meetings · 7d"))!;
    expect(text(kpi).startsWith("1")).toBe(true);
    await act(async () => { kpi.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); await sleep(10); });
    expect(store.ui.filters.stateGroup).toBe("met");
    await wait(() => !!window.document.querySelector('section[aria-label="Met"]'), "the pipeline Met column");
    const met = window.document.querySelector('section[aria-label="Met"]')!;
    expect(text(met.querySelector("b"))).toBe("1");
    expect(text(met)).toContain("Maya + Jon");
    expect(text(met)).not.toContain("Ava + Leo");
    // Closed states keep updatedAt for the range test: the cancelled meeting
    // is 10 days old but updated 2 days ago, so it stays in Closed.
    await act(async () => { store.setFilters({ stateGroup: "closed" }); await sleep(10); });
    expect(store.ui.filters.stateGroup).toBe("closed");
    await wait(() => !!window.document.querySelector('section[aria-label="Closed"]'), "the pipeline Closed column");
    const closed = window.document.querySelector('section[aria-label="Closed"]')!;
    expect(text(closed.querySelector("b"))).toBe("1");
    expect(text(closed)).toContain("Maya + Jon");
  } finally {
    for (const s of sockets) { try { s.close(); } catch { /* already closed */ } }
    globalThis.fetch = nativeFetch;
    restoreDom();
    api.stop();
  }
});
