// R16-TA: clicking an opportunity in the pipeline list opens that
// opportunity's detail (the console's list -> detail journey).
//
// Journey: Drawer pipeline tab -> OppCard ("Maya + Jon") -> store.focus
// ({kind:"opportunity"}) -> Inspector OpportunityPanel -> GET
// /api/opportunity/:id. Spec basis: docs/admin-console.md 3.5 ("board
// and list by state, source, category; drill into one opportunity with
// its messages and the run that made it") + spec/consoleNavigation.md
// ("Focus on a new subject keeps the last one in a short history").
// The detail must show the clicked opportunity's own messages, not
// the previously opened one.
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
const opp = (id: string, participants: string[], objective: string): ObsOpportunity => ({
  id, kind: "intro", source: "engine", generator: "probe", city: "nyc",
  objective, score: 1, explanations: {}, exploration: false,
  participants, alternates: [], state: "INVITING", status: {}, enjoyment: {},
  createdAt: NOW - 3 * DAY, updatedAt: NOW - DAY,
});
const detail = (o: ObsOpportunity, body: string, mid: string): OpportunityDetail => ({
  opportunity: o, members: [member("m1", "Maya Rao"), member("m2", "Jon Park"), member("m3", "Leo Diaz")],
  messages: [{ id: `msg-${o.id}`, ts: NOW - DAY, direction: "outbound", body, status: "delivered", memberId: mid }],
  events: [],
});

async function setup(delayMs = 0) {
  const oppA = opp("oppA", ["m1", "m2"], "coffee with Jon");
  const oppB = opp("oppB", ["m1", "m3"], "climb with Leo");
  const details: Record<string, OpportunityDetail> = {
    oppA: detail(oppA, "msg-A-111", "m1"),
    oppB: detail(oppB, "msg-B-222", "m1"),
  };
  const api = await serveHttp({
    hostname: "127.0.0.1", port: 0,
    fetch: async (req) => {
      const u = new URL(req.url);
      const m = /^\/api\/opportunity\/([^/]+)$/.exec(u.pathname);
      if (m && details[m[1]]) {
        if (delayMs && m[1] === "oppA") await sleep(delayMs);
        return Response.json(details[m[1]]);
      }
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
  for (const m of [member("m1", "Maya Rao"), member("m2", "Jon Park"), member("m3", "Leo Diaz")]) store.members.set(m.id, m);
  store.opps.set(oppA.id, oppA); store.opps.set(oppB.id, oppB);
  await act(async () => {
    store.setUI({ drawer: "pipeline", drawerOpen: true });
    drawerRoot.render(createElement(Drawer));
    inspectorRoot.render(createElement(Inspector));
  });
  const heading = () => inspectorBox.querySelector("h2")?.textContent?.trim() ?? "";
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
  return { store, wait, heading, card, clickCard, cleanup, inspectorBox, drawerBox };
}

test("clicking a pipeline card opens that opportunity's detail with its own messages", async () => {
  const t = await setup();
  try {
    await t.wait(() => !!t.card("Maya + Jon") && !!t.card("Maya + Leo"), "both pipeline cards");
    await t.clickCard("Maya + Jon");
    await t.wait(() => t.heading() === "Maya + Jon" && (t.inspectorBox.textContent ?? "").includes("msg-A-111"), "oppA detail + messages");
    expect(t.inspectorBox.textContent ?? "").not.toContain("msg-B-222");
    expect(t.store.ui.focus).toEqual({ kind: "opportunity", id: "oppA" });
    expect(t.store.focusHistory.map((f) => f?.id)).toEqual([]);

    await t.clickCard("Maya + Leo");
    await t.wait(() => t.heading() === "Maya + Leo" && (t.inspectorBox.textContent ?? "").includes("msg-B-222"), "oppB detail + messages");
    expect(t.inspectorBox.textContent ?? "").not.toContain("msg-A-111");
    expect(t.store.ui.focus).toEqual({ kind: "opportunity", id: "oppB" });
    expect(t.store.focusHistory.map((f) => f?.id)).toContain("oppA");
  } finally {
    await t.cleanup();
  }
});

test("rapid pipeline clicks never show the earlier opportunity's messages", async () => {
  const t = await setup(250);
  try {
    await t.wait(() => !!t.card("Maya + Jon") && !!t.card("Maya + Leo"), "both pipeline cards");
    await t.clickCard("Maya + Jon");
    await t.wait(() => t.heading() === "Maya + Jon", "oppA panel before its detail lands");
    expect(t.inspectorBox.textContent ?? "").not.toContain("msg-A-111");
    await t.clickCard("Maya + Leo");
    await t.wait(() => t.heading() === "Maya + Leo" && (t.inspectorBox.textContent ?? "").includes("msg-B-222"), "oppB detail + messages");
    await act(async () => { await sleep(600); });
    expect(t.inspectorBox.textContent ?? "").toContain("msg-B-222");
    expect(t.inspectorBox.textContent ?? "").not.toContain("msg-A-111");
  } finally {
    await t.cleanup();
  }
});
