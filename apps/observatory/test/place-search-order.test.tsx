// Place search by name: typing the exact place name must offer that place
// first. spec/consoleNavigation.md, "Search offers names and places from two
// characters and ids from three": the box offers members and neighborhoods,
// and the SearchBox takes its hits "best first" while Enter opens the first
// one — so an exact-name match that sorts behind a longer name sends staff
// to the wrong place.
//
// "harlem" is the discriminator: NEIGHBORHOODS lists "East Harlem" before
// "Harlem", so the substring match outranks the exact match and Enter opens
// East Harlem instead of Harlem.
import { serveHttp } from "../../../packages/core/src/runtime/http.ts";
import { setTimeout as sleep } from "node:timers/promises";
import { expect, test } from "vitest";
import { Window, type HTMLInputElement as TestInput } from "happy-dom";
import { act } from "react";
import type { ClockInfo, ObsMember, ObsState, ObsStats } from "../src/types.ts";
import { installDom } from "./dom.ts";

const clock = (now: number): ClockInfo => ({ now, start: 0, day: 1, playing: false, speed: 0, waitingForPlayer: false });
const counters = () => ({ msgsIn: 0, msgsOut: 0, proactive: 0, proposals: 0, accepted: 0, meetings: 0, enjoymentSum: 0, enjoymentN: 0 });
const member = (id: string, name: string, area: string): ObsMember => ({
  id, name, city: "nyc", area, state: "normal", joined: true, joinedAt: 1, minor: false, age: 30, counters: counters(),
});
const stats = (): ObsStats => ({
  members: 4, joined: 4, byCity: { nyc: 4 }, byState: { joined: 4 }, messages: 0, inbound: 0, outbound: 0,
  proactive: 0, proposals: 0, proposalsBySource: {}, oppsByState: {}, invites: 0, accepts: 0, declines: 0,
  meetingsScheduled: 0, meetingsHeld: 0, attended: 0, noShows: 0, cancelledWithNotice: 0,
  enjoymentSum: 0, enjoymentN: 0, blocks: 0, optOuts: 0, adversarialAttempts: 0, invariantViolations: 0,
  errors: 0, compatible: 0, unsafe: 0, oracleJudged: 0, edgesByType: {},
});

test("typing the exact place name Harlem offers Harlem first and Enter opens it", async () => {
  const state: ObsState = {
    env: {
      mode: "game", app: "ntwrk", label: "SIMULATION seed 1 · synthetic v1", dataset: "synthetic v1",
      capabilities: { canStep: false, canIntervene: false, hiddenTruth: false, readOnly: false },
    },
    clock: clock(10), version: 10,
    members: [member("m1", "Maya Rao", "East Village"), member("m2", "Ava Chen", "Chelsea"), member("m3", "Maya", "Greenwich Village"), member("m4", "Ana Mayer", "Chelsea")],
    edges: [], opportunities: [], feed: [], stats: stats(), engineRuns: [],
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
    // Node already has CustomEvent, so installDom would keep the Node one
    // and Radix would dispatch a Node event onto a happy-dom target. Force
    // the window's CustomEvent instead. Plain Event stays Node's: the
    // undici WebSocket dispatches Node events and breaks if it is swapped.
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
  // Leaflet's canvas renderer needs a 2d context; happy-dom returns null, so
  // the map stage crashes on mount. A no-op context lets the real console
  // mount; the map itself is not under test here.
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
    const options = [...window.document.querySelectorAll('[role="option"]')]
      .map(el => (el.textContent ?? "").replace(/\s+/g, " ").trim());
    // The exact place name comes first; the longer name that merely contains it comes after.
    expect(options.slice(0, 2)).toEqual(["Harlem · Manhattan", "East Harlem · Manhattan"]);
    await act(async () => {
      input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await sleep(10);
    });
    expect(store.ui.focus).toEqual({ kind: "neighborhood", id: "Harlem" });
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, "maya");
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await wait(() => [...window.document.querySelectorAll('[role="option"]')].some(el => (el.textContent ?? "").includes("Maya")), "member hits");
    const memberOptions = [...window.document.querySelectorAll('[role="option"]')]
      .map(el => (el.textContent ?? "").replace(/\s+/g, " ").trim());
    expect(memberOptions[0]).toEqual("Maya · Greenwich Village");
  } finally {
    for (const socket of sockets) { socket.onclose = null; socket.close(); }
    globalThis.fetch = nativeFetch;
    await act(async () => { await sleep(40); });
    restoreDom();
    await api.stop(true);
    await window.happyDOM.close();
  }
});
