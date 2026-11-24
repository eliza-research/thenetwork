// R19-TA: the opportunity detail's Score headline must not be contradicted
// by the score parts under it (DOM level; the producers are pinned by
// opp-detail-score.test.ts).
//
// Journey: pipeline card click -> OpportunityPanel -> the Score disclosure
// ("Score {o.score.toFixed(2)}" + <ScoreParts c={o.components} />).
// Fixture: the plan-like opportunity carries the pair the real producers
// emit (planToProposal / StubNetwork.makeProposal: a nonzero score with
// all-zero components); the engine-like opportunity carries a real
// breakdown (fit 1, confidence 1, the rest 0; netValue 0.40).
// Correct: the plan detail shows "Score 0.73" and no part bars; the
// engine detail shows "Score 0.40" and its bars.
import { serveHttp } from "../../../packages/core/src/runtime/http.ts";
import { DAY } from "@thenetwork/core";
import { setTimeout as sleep } from "node:timers/promises";
import { expect, test } from "vitest";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import type { ObsMember, ObsOpportunity, OpportunityDetail } from "../src/types.ts";
import type { ScoreComponents } from "@thenetwork/core";
import { installDom } from "./dom.ts";

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const counters = () => ({ msgsIn: 0, msgsOut: 0, proactive: 0, proposals: 0, accepted: 0, meetings: 0, enjoymentSum: 0, enjoymentN: 0 });
const member = (id: string, name: string): ObsMember => ({
  id, name, city: "nyc", area: "East Village", state: "normal", joined: true, joinedAt: NOW - 30 * DAY,
  minor: false, age: 30, counters: counters(),
});
const ZERO: ScoreComponents = {
  fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0,
  activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0,
};
const opp = (id: string, participants: string[], objective: string, score: number, components: ScoreComponents): ObsOpportunity => ({
  id, kind: "intro", source: "network", generator: "plan", city: "nyc",
  objective, score, components, explanations: {}, exploration: false,
  participants, alternates: [], state: "INVITING", status: {}, enjoyment: {},
  createdAt: NOW - 3 * DAY, updatedAt: NOW - DAY,
});
const detail = (o: ObsOpportunity): OpportunityDetail => ({
  opportunity: o, members: [member("m1", "Maya Rao"), member("m2", "Jon Park"), member("m3", "Leo Diaz")],
  messages: [], events: [],
});

async function setup() {
  const planOpp = opp("oppPlan", ["m1", "m2"], "bouldering with Jon", 0.73, ZERO);
  const engineOpp = opp("oppEngine", ["m1", "m3"], "coffee with Leo", 0.4, { ...ZERO, fit: 1, confidence: 1 });
  const details: Record<string, OpportunityDetail> = { oppPlan: detail(planOpp), oppEngine: detail(engineOpp) };
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
  window.localStorage.setItem("obs.disclosure.score", "1");
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
    throw Error(`timed out waiting for: ${label}\nDRAWER: ${drawerBox.textContent ?? ""}\nINSPECTOR: ${inspectorBox.textContent ?? ""}`);
  };
  const { store } = await import("../web/store.ts");
  const { Drawer } = await import("../web/drawer.tsx");
  const { Inspector } = await import("../web/panels.tsx");
  store.mode = "game";
  store.app = "ntwrk";
  store.me = { id: "staff", roles: ["admin"], grants: [{ role: "admin", app: "*" }], via: "token" } as typeof store.me;
  (store as unknown as { clock: unknown }).clock = { now: NOW, start: 0, day: 1, playing: false, speed: 0, waitingForPlayer: false };
  store.members.clear(); store.opps.clear(); store.feed = [];
  for (const m of [member("m1", "Maya Rao"), member("m2", "Jon Park"), member("m3", "Leo Diaz")]) store.members.set(m.id, m);
  store.opps.set(planOpp.id, planOpp); store.opps.set(engineOpp.id, engineOpp);
  await act(async () => {
    store.setUI({ drawer: "pipeline", drawerOpen: true });
    drawerRoot.render(createElement(Drawer));
    inspectorRoot.render(createElement(Inspector));
  });
  const heading = () => inspectorBox.querySelector("h2")?.textContent?.trim() ?? "";
  const text = () => inspectorBox.textContent ?? "";
  const card = (title: string) =>
    [...drawerBox.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(title));
  const clickCard = async (title: string) => {
    const c = card(title);
    expect(c, `pipeline card ${title}`).toBeTruthy();
    await act(async () => { c!.click(); });
  };
  const cleanup = async () => {
    await act(async () => { drawerRoot.unmount(); inspectorRoot.unmount(); });
    globalThis.fetch = nativeFetch;
    await api.stop(true);
    await window.happyDOM.close();
    restoreDom();
  };
  return { store, wait, heading, text, card, clickCard, cleanup };
}

test("detail Score shows the headline without zero bars for a plan opportunity, and bars for an engine one", async () => {
  const t = await setup();
  try {
    await t.wait(() => !!t.card("Maya + Jon") && !!t.card("Maya + Leo"), "both pipeline cards");
    await t.clickCard("Maya + Jon");
    await t.wait(() => t.heading() === "Maya + Jon" && t.text().includes("Score 0.73"), "plan detail + Score headline");
    expect(t.text()).toContain("Score 0.73");
    expect(t.text()).not.toContain("mutual benefit");
    expect(t.text()).not.toContain("warm path");
    expect(t.text()).not.toContain("0.00");
    await t.clickCard("Maya + Leo");
    await t.wait(() => t.heading() === "Maya + Leo" && t.text().includes("Score 0.40"), "engine detail + Score headline");
    expect(t.text()).toContain("Score 0.40");
    expect(t.text()).toContain("mutual benefit");
    expect(t.text()).toContain("1.00");
  } finally {
    await t.cleanup();
  }
});
