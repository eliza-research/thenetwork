import { setTimeout as sleep } from "node:timers/promises";
import { act, createElement } from "react";
import { Window } from "happy-dom";
import { expect, test } from "vitest";
import type { ScoreComponents } from "@thenetwork/core";
import type { ObsMember, ObsOpportunity } from "../src/types.ts";
import { installDom } from "./dom.ts";
import { Projector } from "../src/projector.ts";
import { Store } from "../src/store.ts";

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const ZERO: ScoreComponents = {
  fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0,
  activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0,
};
const counters = () => ({ msgsIn: 0, msgsOut: 0, proactive: 0, proposals: 0, accepted: 0, meetings: 0, enjoymentSum: 0, enjoymentN: 0 });
const member = (id: string, name: string): ObsMember => ({
  id, name, city: "nyc", area: "East Village", state: "normal", joined: true, joinedAt: NOW - 86_400_000,
  minor: false, age: 30, counters: counters(),
});
const opp: ObsOpportunity = {
  id: "opp-feed-1", kind: "intro", source: "network", generator: "engine", city: "nyc",
  objective: "coffee", score: 0.5, components: ZERO, explanations: {}, exploration: false,
  participants: ["m1", "m2"], alternates: [], state: "INVITING", status: { m1: "pending", m2: "pending" },
  enjoyment: {}, createdAt: NOW - 3_600_000, updatedAt: NOW - 1_800_000,
};

test("meeting feed links distinct participants with a shared first name without guessing ambiguous links", async () => {
  const window = new Window({ url: "http://127.0.0.1/" });
  const restoreDom = installDom(window, {
    window, document: window.document, navigator: window.navigator,
    location: window.location, history: window.history,
    localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    CustomEvent: window.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const box = window.document.createElement("div");
  window.document.body.append(box);
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(box as unknown as HTMLElement);
  const { store } = await import("../web/store.ts");
  const { Drawer } = await import("../web/drawer.tsx");
  store.mode = "game";
  store.app = "ntwrk";
  store.env = {
    mode: "game", app: "ntwrk", label: "SIM", dataset: "sim",
    capabilities: { canStep: true, canIntervene: true, hiddenTruth: false, readOnly: false },
  };
  store.me = { id: "staff", roles: ["admin"], grants: [{ role: "admin", app: "*" }], via: "token" } as typeof store.me;
  const clock = { now: NOW, start: NOW - 86_400_000, day: 1, playing: false, speed: 0, waitingForPlayer: false };
  store.clock = clock;
  const projection = new Store(store.env, clock);
  const people = [member("m1", "Alex Kim"), member("m2", "Alex Park"), member("m3", "Alex Kim"), member("m4", "Maya Rao")];
  store.members.clear();
  store.opps.clear();
  for (const m of people) { projection.upsertMember(m); store.members.set(m.id, m); }
  const projector = new Projector(projection);
  const book = (id: string, members: string[], t: number) => {
    const opportunity = { ...opp, id, participants: members, status: Object.fromEntries(members.map(x => [x, "pending" as const])) };
    projection.upsertOpp(opportunity);
    projector.apply({ type: "meeting_scheduled", t, at: NOW + 3_600_000, meetingId: id, proposalId: id, participants: members, city: "nyc" });
    store.opps.set(id, projection.opps.get(id)!);
  };
  book("different-surnames", ["m1", "m2"], NOW - 10_000);
  book("same-full-name", ["m1", "m3"], NOW - 20_000);
  book("unique-first-name", ["m1", "m4"], NOW - 30_000);
  projection.pushFeed({ t: NOW - 60_000, kind: "meeting", text: "Meeting set: Alex & Alex (older entry)", members: ["m1", "m2"], opportunityId: "different-surnames" });
  store.feed = projection.feed;
  store.setUI({ drawer: "feed", drawerOpen: true, focus: null });

  try {
    await act(async () => { root.render(createElement(Drawer)); });
    const rows = [...box.querySelectorAll('div[role="button"]')];
    const exactRow = (suffix: string) => {
      const row = rows.find(r => r.textContent?.endsWith(suffix));
      expect(row).toBeDefined();
      return row!;
    };
    const legacy = exactRow("Alex & Alex (older entry)");
    expect(legacy.querySelectorAll("button")).toHaveLength(0);
    expect(exactRow("Alex Kim & Alex Kim").querySelectorAll("button")).toHaveLength(0);
    const unique = [...exactRow("Alex & Maya").querySelectorAll("button")];
    expect(unique.map(x => x.textContent)).toEqual(["Alex", "Maya"]);
    const row = exactRow("Alex Kim & Alex Park");
    const peopleLinks = [...row.querySelectorAll("button")];
    expect(peopleLinks.map(x => x.textContent)).toEqual(["Alex Kim", "Alex Park"]);
    await act(async () => { peopleLinks[1]!.click(); });
    expect(store.ui.focus).toEqual({ kind: "member", id: "m2" });
    await act(async () => { store.focus(null); });
    await act(async () => { row.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
    expect(store.ui.focus).toEqual({ kind: "opportunity", id: "different-surnames" });
  } finally {
    await act(async () => { root.unmount(); await sleep(40); });
    await window.happyDOM.close();
    restoreDom();
  }
});
