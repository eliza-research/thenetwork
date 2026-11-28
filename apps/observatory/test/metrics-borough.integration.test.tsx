import { setTimeout as sleep } from "node:timers/promises";
import { act, createElement } from "react";
import { Window } from "happy-dom";
import { expect, test } from "vitest";
import type { ObsMember, ObsStats } from "../src/types.ts";
import { installDom } from "./dom.ts";

const member = (id: string, area: string, meetings: number): ObsMember => ({
  id, name: id, city: "nyc", area, state: "normal", joined: true, joinedAt: 1, age: 30, minor: false,
  counters: { msgsIn: 0, msgsOut: 0, proactive: 0, proposals: 0, accepted: 0, meetings, enjoymentSum: 0, enjoymentN: 0 },
});
const stats: ObsStats = {
  members: 4, joined: 4, byCity: { nyc: 4 }, byState: { normal: 4 }, messages: 0, inbound: 0, outbound: 0,
  proactive: 0, proposals: 0, proposalsBySource: {}, oppsByState: {}, invites: 0, accepts: 0, declines: 0,
  meetingsScheduled: 0, meetingsHeld: 2, attended: 3, noShows: 0, cancelledWithNotice: 0,
  enjoymentSum: 0, enjoymentN: 0, blocks: 0, optOuts: 0, adversarialAttempts: 0, invariantViolations: 0,
  errors: 0, compatible: 0, unsafe: 0, oracleJudged: 0, edgesByType: {},
};

test("Metrics counts members who met someone only in the selected borough", async () => {
  const window = new Window({ url: "http://127.0.0.1/" });
  const restore = installDom(window, {
    window, document: window.document, navigator: window.navigator,
    location: window.location, history: window.history, localStorage: window.localStorage,
    sessionStorage: window.sessionStorage, CustomEvent: window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true,
  });
  const box = window.document.createElement("div");
  window.document.body.append(box);
  const { createRoot } = await import("react-dom/client");
  const { store } = await import("../web/store.ts");
  const { Drawer } = await import("../web/drawer.tsx");
  const root = createRoot(box as unknown as HTMLElement);
  const count = () => [...box.querySelectorAll("span")]
    .find(el => el.textContent === "members who met someone")?.previousElementSibling?.textContent;
  try {
    store.stats = stats;
    for (const m of [
      member("Maya", "Harlem", 1),
      member("Jon", "Chelsea", 2),
      member("Ana", "Park Slope", 1),
      member("Lee", "Astoria", 0),
    ]) store.members.set(m.id, m);
    store.setFilters({ borough: "all" });
    store.setUI({ drawer: "metrics", drawerOpen: true });
    await act(async () => { root.render(createElement(Drawer)); });
    expect(count()).toBe("3");
    await act(async () => { store.setFilters({ borough: "Brownstone Brooklyn" }); await sleep(45); });
    expect(count()).toBe("1");
    await act(async () => { store.setFilters({ borough: "Queens" }); await sleep(45); });
    expect(count()).toBe("0");
    await act(async () => { store.resetFilters(); await sleep(45); });
    expect(count()).toBe("3");
  } finally {
    await act(async () => { root.unmount(); });
    await window.happyDOM.close();
    restore();
  }
});
