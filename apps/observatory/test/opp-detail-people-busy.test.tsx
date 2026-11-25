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
const opp = (id: string, participants: string[], state: ObsOpportunity["state"], status: ObsOpportunity["status"], booked?: ObsOpportunity["booked"]): ObsOpportunity => ({
  id, kind: participants.length > 2 ? "group" : "intro", source: "network", generator: "engine", city: "nyc",
  objective: "coffee", score: 0.4, components: ZERO, explanations: {}, exploration: false,
  participants, alternates: [], state, status, enjoyment: {}, booked,
  createdAt: NOW - 3 * DAY, updatedAt: NOW - DAY,
});
const detail = (o: ObsOpportunity): OpportunityDetail => ({
  opportunity: o, members: [member("m1", "Maya Rao"), member("m2", "Jon Park"), member("m3", "Leo Diaz"), member("m4", "Nina Chen")],
  messages: [], events: [],
});

async function setup(oppBOverride?: ObsOpportunity) {
  const oppA = opp("oppA", ["m1", "m2"], "INVITING", { m1: "pending", m2: "pending" });
  const oppB = oppBOverride ?? opp("oppB", ["m1", "m3", "m4"], "INVITING", { m1: "declined", m3: "pending", m4: "pending" });
  const details: Record<string, OpportunityDetail> = { oppA: detail(oppA) };
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
  for (const m of [member("m1", "Maya Rao"), member("m2", "Jon Park"), member("m3", "Leo Diaz"), member("m4", "Nina Chen")]) store.members.set(m.id, m);
  store.opps.set(oppA.id, oppA); store.opps.set(oppB.id, oppB);
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

test("detail People shows Maya without a busy mark when she declined the other open opportunity", async () => {
  const t = await setup();
  try {
    await t.wait(() => !!t.card("Maya + Jon") && !!t.card("Maya, Leo"), "both pipeline cards");
    await t.clickCard("Maya + Jon");
    await t.wait(() => t.heading() === "Maya + Jon", "oppA detail");
    expect(t.text()).toContain("Maya Rao");
    expect(t.text()).not.toContain("busy");
  } finally {
    await t.cleanup();
  }
});

test("detail People shows Maya without a busy mark when she dropped out of its booked meeting with no notice", async () => {
  const oppB = opp("oppB", ["m1", "m3", "m4"], "SCHEDULED", { m1: "confirmed", m3: "confirmed", m4: "confirmed" },
    { at: NOW, optOutHours: 24, told: {}, cancelled: { m1: { at: NOW, told: false } } });
  const t = await setup(oppB);
  try {
    await t.wait(() => !!t.card("Maya + Jon") && !!t.card("Maya, Leo"), "both pipeline cards");
    await t.clickCard("Maya + Jon");
    await t.wait(() => t.heading() === "Maya + Jon", "oppA detail");
    expect(t.text()).toContain("Maya Rao");
    expect(t.text()).not.toContain("busy");
  } finally {
    await t.cleanup();
  }
});
