import { setTimeout as sleep } from "node:timers/promises";
import { act, createElement } from "react";
import { Window } from "happy-dom";
import { expect, test } from "vitest";
import { DAY } from "@thenetwork/core";
import { serveHttp } from "../../../packages/core/src/runtime/http.ts";
import type { EngineRunSummary, RunDiff } from "../src/types.ts";
import { installDom } from "./dom.ts";

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const makeRun = (id: string, at: number, proposals: number): EngineRunSummary => ({
  id, at, engineVersion: "engine-v1", city: "nyc", proposals, wallMs: 12,
  funnel: { generated: 10, passedHardFilters: 10, deduped: 10, eligible: 10, belowThreshold: 0, budgetSkips: 0, selected: proposals, exploration: 0, dealbreakers: 0 },
  byGenerator: {}, proposalsByGenerator: {}, rejectedBy: {}, memberFunnel: {},
  fairness: { gini: 0, top10Share: 0, zeroExposureShare: 0, newcomerCoverage: 1, viableCoverage: 1, lorenz: [], membersWithProposal: 20, eligibleMembers: 20 },
  emptyStates: 0, emptyStatesByReason: {},
  search: { members: 0, checks: 0, touches: 0, exact: 0, budgeted: 0, empty: 0, largestUnseenBound: -1, bounds: 0, checksAfterSettled: 0, boundViolations: 0, packBoundViolations: 0, classCapViolations: 0, touchClosed: 0, checkClosed: 0, memoHits: 0, refusals: {} },
  searchOutcomes: [],
  timingsMs: {}, top: [], proposalIds: [],
});
const makeDiff = (a: EngineRunSummary, b: EngineRunSummary): RunDiff => ({
  a: { id: a.id, at: a.at, engineVersion: a.engineVersion, proposals: a.proposals, city: a.city },
  b: { id: b.id, at: b.at, engineVersion: b.engineVersion, proposals: b.proposals, city: b.city },
  funnel: {}, fairness: {}, byGenerator: {}, proposalsByGenerator: {}, rejectedBy: {},
  top: { added: [], removed: [], kept: 0 },
});

test("Runs compare drops hidden picks on a same-count filter swap and closes with fewer than two visible runs", async () => {
  const runOldA = makeRun("old-a", NOW - 3 * DAY, 4);
  const runShared = { ...makeRun("shared", runOldA.at, runOldA.proposals), city: "sf" as const };
  const runNewA = makeRun("new-a", NOW - 1 * DAY, 6);
  const runNewB = makeRun("new-b", NOW - 6 * 3_600_000, 7);
  const byId = new Map([runOldA, runShared, runNewA, runNewB].map(r => [r.id, r]));
  const api = await serveHttp({
    hostname: "127.0.0.1", port: 0,
    fetch: async req => {
      const u = new URL(req.url);
      if (u.pathname === "/api/runs/diff") {
        const a = byId.get(u.searchParams.get("a") ?? "");
        const b = byId.get(u.searchParams.get("b") ?? "");
        if (a && b) return Response.json(makeDiff(a, b));
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
  const window = new Window({ url: api.url.href });
  const nativeFetch = globalThis.fetch;
  const restoreDom = installDom(window, {
    window, document: window.document, navigator: window.navigator,
    location: window.location, history: window.history,
    localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    CustomEvent: window.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    nativeFetch(typeof input === "string" ? new URL(input, api.url) : input, init)) as typeof fetch;
  const box = window.document.createElement("div");
  window.document.body.append(box);
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(box as unknown as HTMLElement);
  const wait = async (check: () => boolean, label: string) => {
    for (let i = 0; i < 400; i++) { if (check()) return; await act(async () => { await sleep(5); }); }
    throw Error(`timed out waiting for ${label}\nBOX: ${box.textContent ?? ""}`);
  };
  const { store } = await import("../web/store.ts");
  const { Drawer } = await import("../web/drawer.tsx");
  store.mode = "game";
  store.app = "ntwrk";
  store.env = {
    mode: "game", app: "ntwrk", label: "SIM", dataset: "sim",
    capabilities: { canStep: true, canIntervene: true, hiddenTruth: false, readOnly: false },
  };
  store.me = { id: "staff", roles: ["admin"], grants: [{ role: "admin", app: "*" }], via: "token" } as typeof store.me;
  (store as unknown as { clock: unknown }).clock = { now: NOW, start: NOW - 10 * DAY, day: 10, playing: false, speed: 0, waitingForPlayer: false };
  store.runs = [runOldA, runShared, runNewA];
  store.setFilters({ range: "7d", borough: "all", members: "all", origin: "all", stateGroup: "all" });
  store.setUI({ drawer: "engine", drawerOpen: true, focus: null });
  const btn = (label: string) => [...box.querySelectorAll("button")].find(b => (b.textContent ?? "").includes(label));
  const checkbox = (city: string) =>
    [...box.querySelectorAll("label")].find(l => (l.textContent ?? "").includes(`· ${city} · 4 proposals`))?.querySelector('button[role="checkbox"]') as HTMLButtonElement | null;
  try {
    await act(async () => { root.render(createElement(Drawer)); });
    await wait(() => !!btn("Compare two"), "Compare two button");
    expect(btn("· NYC · 4 proposals")).toBeDefined();
    expect(btn("· SF · 4 proposals")).toBeDefined();
    await act(async () => { btn("Compare two")!.click(); });
    await wait(() => (box.textContent ?? "").includes("Pick two runs."), "Pick two prompt");
    await act(async () => { checkbox("NYC")!.click(); });
    await act(async () => { checkbox("SF")!.click(); });
    await wait(() => (box.textContent ?? "").includes("4 proposals") && (box.textContent ?? "").includes("A:"), "diff shown");

    await act(async () => {
      store.runs = [runNewA, runShared, runNewB];
      store.setUI({ drawer: "engine", drawerOpen: true });
    });
    await wait(() => (box.textContent ?? "").includes("Pick two runs.") && !(box.textContent ?? "").includes("A:"), "hidden pick dropped on same-count swap");

    await act(async () => {
      store.setFilters({ range: "today" });
    });
    await act(async () => {
      store.runs = [runNewB];
      store.setUI({ drawer: "engine", drawerOpen: true });
    });
    await wait(() => !(box.textContent ?? "").includes("Close compare") && !(box.textContent ?? "").includes("Pick two runs."), "compare closed with one run");
  } finally {
    await act(async () => { root.unmount(); await sleep(40); });
    globalThis.fetch = nativeFetch;
    await api.stop(true);
    await window.happyDOM.close();
    restoreDom();
  }
});
