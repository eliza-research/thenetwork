import { setTimeout as sleep } from "node:timers/promises";
import { act, createElement } from "react";
import { Window } from "happy-dom";
import { expect, test } from "vitest";
import type { ScoreComponents } from "@thenetwork/core";
import type { ObsMember, ObsOpportunity } from "../src/types.ts";
import { installDom } from "./dom.ts";

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

test("FeedLine opens on Space release and Enter press, stops Space propagation, and ignores nested Enter", async () => {
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
  (store as unknown as { clock: unknown }).clock = { now: NOW, start: NOW - 86_400_000, day: 1, playing: false, speed: 0, waitingForPlayer: false };
  store.members.clear();
  store.opps.clear();
  store.members.set("m1", member("m1", "Maya Rao"));
  store.members.set("m2", member("m2", "Jon Park"));
  store.opps.set(opp.id, opp);
  store.feed = [
    { seq: 1, t: NOW - 60_000, kind: "proposal", text: "Proposed intro for Maya Rao and Jon Park", members: ["m1", "m2"], opportunityId: opp.id },
    { seq: 2, t: NOW - 30_000, kind: "engine", text: "Engine finished its pass" },
  ];
  store.setUI({ drawer: "feed", drawerOpen: true, focus: null });

  let windowSpaceCount = 0;
  const onWindowKey = (e: unknown) => { if ((e as { key?: string }).key === " ") windowSpaceCount++; };
  window.addEventListener("keydown", onWindowKey);
  try {
    await act(async () => { root.render(createElement(Drawer)); });
    expect(box.textContent).toContain("Engine finished its pass");
    const rows = [...box.querySelectorAll('div[role="button"]')];
    expect(rows.some(r => r.textContent?.includes("Engine finished its pass"))).toBe(false);
    const row = rows.find(r => r.textContent?.includes("Proposed intro"));
    expect(row).toBeTruthy();
    const innerButton = row!.querySelector("button");
    expect(innerButton?.textContent).toContain("Maya");

    await act(async () => {
      const down = new window.KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
      row!.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(true);
    });
    expect(windowSpaceCount).toBe(0);
    expect(store.ui.focus).toBeNull();

    await act(async () => {
      row!.dispatchEvent(new window.KeyboardEvent("keyup", { key: " ", bubbles: true, cancelable: true }));
    });
    expect(store.ui.focus).toEqual({ kind: "opportunity", id: opp.id });

    await act(async () => { store.focus(null); });
    await act(async () => {
      row!.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true, cancelable: true }));
    });
    expect(store.ui.focus).toBeNull();
    await act(async () => {
      row!.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(store.ui.focus).toEqual({ kind: "opportunity", id: opp.id });

    await act(async () => { store.focus(null); });
    await act(async () => {
      innerButton!.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(store.ui.focus).toBeNull();
  } finally {
    window.removeEventListener("keydown", onWindowKey);
    await act(async () => { root.unmount(); await sleep(40); });
    await window.happyDOM.close();
    restoreDom();
  }
});
