// R22-TA: the member panel's joined-opportunity list must count only the
// opportunities the member is still in (DOM level).
//
// Journey: focus a member -> MemberPanel -> the header FactLine
// ("in N open opportunities"), the "Open items" section and the
// "Past opportunities (N)" disclosure.
//
// Fixture: Maya is pending in oppA (open) and declined in oppB, a group
// opportunity that stays open after her decline (the real Projector
// leaves a group open on a decline; only a pair closes --
// projector.ts:594, proven by R21-TA's source test). Correct: the header
// says "in 1 open opportunity", "Open items" shows only oppA, and oppB
// sits under "Past opportunities (1)" with "you: declined". Wrong (base):
// the header says "in 2 open opportunities" and oppB is listed under
// "Open items" as if Maya still had something open there -- while its own
// row says "you: declined".
import { serveHttp } from "../../../packages/core/src/runtime/http.ts";
import { DAY } from "@thenetwork/core";
import { setTimeout as sleep } from "node:timers/promises";
import { expect, test } from "vitest";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import type { MemberDetail, MemberTimeline, ObsMember, ObsOpportunity } from "../src/types.ts";
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
const opp = (id: string, participants: string[], state: ObsOpportunity["state"], status: ObsOpportunity["status"]): ObsOpportunity => ({
  id, kind: participants.length > 2 ? "group" : "intro", source: "network", generator: "engine", city: "nyc",
  objective: "coffee", score: 0.4, components: ZERO, explanations: {}, exploration: false,
  participants, alternates: [], state, status, enjoyment: {},
  createdAt: NOW - 3 * DAY, updatedAt: NOW - DAY,
});

async function setup() {
  const oppA = opp("oppA", ["m1", "m2"], "INVITING", { m1: "pending", m2: "pending" });
  const oppB = opp("oppB", ["m1", "m3", "m4"], "INVITING", { m1: "declined", m3: "pending", m4: "pending" });
  const detail: MemberDetail = {
    member: member("m1", "Maya Rao"), facets: [], intents: [], presence: [], edges: [],
    opportunities: [oppA, oppB], messages: [],
  };
  const timeline: MemberTimeline = { memberId: "m1", entries: [], pending: [] };
  const api = await serveHttp({
    hostname: "127.0.0.1", port: 0,
    fetch: async (req) => {
      const u = new URL(req.url);
      if (u.pathname === "/api/member/m1") return Response.json(detail);
      if (u.pathname === "/api/member/m1/timeline") return Response.json(timeline);
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
  const inspectorBox = window.document.createElement("div");
  window.document.body.append(inspectorBox);
  const { createRoot } = await import("react-dom/client");
  const inspectorRoot = createRoot(inspectorBox as unknown as HTMLElement);
  const wait = async (check: () => boolean, label: string) => {
    for (let i = 0; i < 400; i++) { if (check()) return; await act(async () => { await sleep(5); }); }
    throw Error(`timed out waiting for: ${label}\nINSPECTOR: ${inspectorBox.textContent ?? ""}`);
  };
  const { store } = await import("../web/store.ts");
  const { Inspector } = await import("../web/panels.tsx");
  store.mode = "game";
  store.app = "ntwrk";
  store.me = { id: "staff", roles: ["admin"], grants: [{ role: "admin", app: "*" }], via: "token" } as typeof store.me;
  (store as unknown as { clock: unknown }).clock = { now: NOW, start: 0, day: 1, playing: false, speed: 0, waitingForPlayer: false };
  store.members.clear(); store.opps.clear(); store.feed = [];
  for (const m of [member("m1", "Maya Rao"), member("m2", "Jon Park"), member("m3", "Leo Diaz"), member("m4", "Nina Chen")]) store.members.set(m.id, m);
  store.opps.set(oppA.id, oppA); store.opps.set(oppB.id, oppB);
  await act(async () => {
    inspectorRoot.render(createElement(Inspector));
  });
  await act(async () => {
    store.focus({ kind: "member", id: "m1" });
  });
  const heading = () => inspectorBox.querySelector("h2")?.textContent?.trim() ?? "";
  const text = () => inspectorBox.textContent ?? "";
  const cleanup = async () => {
    await act(async () => { inspectorRoot.unmount(); });
    globalThis.fetch = nativeFetch;
    await api.stop(true);
    await window.happyDOM.close();
    restoreDom();
  };
  return { wait, heading, text, cleanup };
}

test("member panel counts only the open opportunities the member is still in", async () => {
  const t = await setup();
  try {
    await t.wait(() => t.heading() === "Maya Rao", "member panel");
    await t.wait(() => t.text().includes("Timeline"), "member detail loaded");
    expect(t.text()).toContain("in 1 open opportunity");
    expect(t.text()).not.toContain("in 2 open opportunities");
    expect(t.text()).toContain("Past opportunities (1)");
    expect(t.text()).toContain("Jon");
    // oppB's other people must not be in the always-rendered "Open items"
    // section: the declined opportunity belongs under Past, whose rows
    // render only when the disclosure opens.
    expect(t.text()).not.toContain("Leo");
    expect(t.text()).not.toContain("Nina");
  } finally {
    await t.cleanup();
  }
});
