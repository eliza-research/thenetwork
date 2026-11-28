import { serveHttp } from "../../../packages/core/src/runtime/http.ts";
import { DAY } from "@thenetwork/core";
import { setTimeout as sleep } from "node:timers/promises";
import { expect, test } from "vitest";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import type { ObsMember, ObsOpportunity, OpportunityDetail } from "../src/types.ts";
import { installDom } from "./dom.ts";

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const counters = () => ({ msgsIn: 0, msgsOut: 0, proactive: 0, proposals: 0, accepted: 0, meetings: 0, enjoymentSum: 0, enjoymentN: 0 });
const member = (id: string, name: string): ObsMember => ({
  id, name, city: "nyc", area: "East Village", state: "normal", joined: true, joinedAt: NOW - 30 * DAY,
  minor: false, age: 30, counters: counters(),
});
const reviewOpp = (id: string, participants: string[], held: boolean): ObsOpportunity => ({
  id, kind: "intro", source: "network", origin: "engine", generator: "probe", city: "nyc",
  objective: "meet", score: 1, explanations: {}, exploration: false,
  participants, alternates: [], state: "IN_REVIEW", status: {}, enjoyment: {},
  createdAt: NOW - 3 * DAY, updatedAt: NOW - DAY,
  review: held
    ? { queuedAt: NOW - 3_600_000, deadline: NOW + 3_600_000, exceptionReason: "other_concern", judgeVerdict: "flag" }
    : { queuedAt: NOW - 3_600_000, deadline: NOW + 3_600_000 },
});

test("pending queue and detail actions cover only judge-held items; the pipeline still shows both", async () => {
  const awaiting = reviewOpp("oppAwaiting", ["m1", "m2"], false);
  const held = reviewOpp("oppHeld", ["m1", "m3"], true);
  const details: Record<string, OpportunityDetail> = {
    oppAwaiting: { opportunity: awaiting, members: [], messages: [], events: [] },
    oppHeld: { opportunity: held, members: [], messages: [], events: [] },
  };
  const api = await serveHttp({
    hostname: "127.0.0.1", port: 0,
    fetch: async (req) => {
      const u = new URL(req.url);
      const m = /^\/api\/opportunity\/([^/]+)$/.exec(u.pathname);
      if (m && details[m[1]]) return Response.json(details[m[1]]);
      return Response.json({ error: "unexpected" }, { status: 404 });
    },
  });
  const window = new Window({ url: api.url.href });
  const restoreDom = installDom(window, {
    window, document: window.document, navigator: window.navigator,
    location: window.location, history: window.history,
    localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    nativeFetch(typeof input === "string" ? new URL(input, api.url) : input, init)) as typeof fetch;
  const drawerBox = window.document.createElement("div");
  const inspectorBox = window.document.createElement("div");
  window.document.body.append(drawerBox, inspectorBox);
  const { createRoot } = await import("react-dom/client");
  const drawerRoot = createRoot(drawerBox as unknown as HTMLElement);
  const inspectorRoot = createRoot(inspectorBox as unknown as HTMLElement);
  const wait = async (check: () => boolean, label: string) => {
    for (let i = 0; i < 400; i++) { if (check()) return; await act(async () => { await sleep(5); }); }
    throw Error(`timed out: ${label}\nDRAWER: ${drawerBox.textContent}\nINSPECTOR: ${inspectorBox.textContent}`);
  };
  const { store } = await import("../web/store.ts");
  const { Drawer } = await import("../web/drawer.tsx");
  const { Inspector } = await import("../web/panels.tsx");
  store.mode = "game";
  store.app = "ntwrk";
  store.me = { id: "staff", roles: ["admin"], grants: [{ role: "admin", app: "*" }], via: "token" } as typeof store.me;
  (store as unknown as { clock: unknown }).clock = { now: NOW, start: 0, day: 1, playing: false, speed: 0, waitingForPlayer: false };
  (store as unknown as { env: unknown }).env = { mode: "game", app: "ntwrk", label: "SIMULATION", dataset: "synthetic", capabilities: { canStep: false, canIntervene: false, hiddenTruth: false, readOnly: false } };
  (store as unknown as { stats: unknown }).stats = {
    members: 3, joined: 3, byCity: { nyc: 3 }, byState: { joined: 3 }, messages: 0, inbound: 0, outbound: 0,
    proactive: 0, proposals: 0, proposalsBySource: {}, oppsByState: {}, invites: 0, accepts: 0, declines: 0,
    meetingsScheduled: 0, meetingsHeld: 0, attended: 0, noShows: 0, cancelledWithNotice: 0,
    enjoymentSum: 0, enjoymentN: 0, blocks: 0, optOuts: 0, adversarialAttempts: 0, invariantViolations: 0,
    errors: 0, compatible: 0, unsafe: 0, oracleJudged: 0, edgesByType: {},
  };
  store.members.clear(); store.opps.clear(); store.feed = [];
  for (const m of [member("m1", "Maya Rao"), member("m2", "Jon Park"), member("m3", "Leo Diaz")]) store.members.set(m.id, m);
  store.opps.set(awaiting.id, awaiting); store.opps.set(held.id, held);
  const drawerText = () => drawerBox.textContent ?? "";
  const inspectorText = () => inspectorBox.textContent ?? "";
  const approveButton = () => [...inspectorBox.querySelectorAll("button")].find(b => (b.textContent ?? "").trim() === "Approve");
  const buttonText = (label: string) => [...inspectorBox.querySelectorAll("button")].find(b => (b.textContent ?? "").trim() === label);
  const inReviewKpiText = () => [...inspectorBox.querySelectorAll("button")].find(b => (b.textContent ?? "").includes("In review"))?.textContent ?? "";
  try {
    await act(async () => {
      store.setUI({ drawer: "review", drawerOpen: true, reviewView: "pending", focus: null });
      drawerRoot.render(createElement(Drawer));
      inspectorRoot.render(createElement(Inspector));
    });
    await wait(() => drawerText().includes("Maya + Leo"), "held card in the pending queue");
    await act(async () => { await sleep(60); });
    expect(drawerText()).toContain("Maya + Leo");
    expect(drawerText()).not.toContain("Maya + Jon");
    expect(drawerText()).toContain("Review1 waiting");
    expect(drawerText()).not.toContain("Review2 waiting");
    expect(inReviewKpiText()).toContain("1In review");
    expect(inReviewKpiText()).not.toContain("2In review");
    expect(store.nav().queues.reviewItems).toBe(true);
    store.opps.delete(held.id);
    expect(store.nav().queues.reviewItems).toBe(false);
    store.opps.set(held.id, held);
    expect(store.nav().queues.reviewItems).toBe(true);
    await act(async () => { store.focus({ kind: "opportunity", id: "oppAwaiting" }); await sleep(20); });
    await wait(() => inspectorText().includes("In review"), "awaiting detail");
    await act(async () => { await sleep(60); });
    expect(approveButton()).toBeUndefined();
    expect(buttonText("Edit")).toBeUndefined();
    expect(buttonText("Re-roll")).toBeUndefined();
    expect([...inspectorBox.querySelectorAll("button")].some(b => (b.textContent ?? "").includes("Reject"))).toBe(true);
    await act(async () => { store.focus({ kind: "opportunity", id: "oppHeld" }); await sleep(20); });
    await wait(() => !!approveButton(), "held detail Approve");
    expect(approveButton()).toBeTruthy();
    await act(async () => { store.setUI({ drawer: "pipeline", drawerOpen: true }); await sleep(60); });
    await wait(() => drawerText().includes("Maya + Jon") && drawerText().includes("Maya + Leo"), "both pipeline cards");
    expect(drawerText()).toContain("Maya + Jon");
    expect(drawerText()).toContain("Maya + Leo");
  } finally {
    await act(async () => { drawerRoot.unmount(); inspectorRoot.unmount(); });
    globalThis.fetch = nativeFetch;
    await api.stop(true);
    await window.happyDOM.close();
    restoreDom();
  }
});
