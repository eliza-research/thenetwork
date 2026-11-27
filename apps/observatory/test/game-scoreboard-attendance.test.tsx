import { act, createElement } from "react";
import { Window } from "happy-dom";
import { expect, test } from "vitest";
import { scoreboard } from "../src/scoring.ts";
import type { ObsOpportunity } from "../src/types.ts";
import { installDom } from "./dom.ts";

function opportunity(source: ObsOpportunity["source"], status: ObsOpportunity["status"]): ObsOpportunity {
  return {
    id: source, kind: "intro", source, generator: "probe", city: "nyc", objective: "meet",
    score: 1, explanations: {}, exploration: false, participants: Object.keys(status), alternates: [],
    state: "CANCELLED", status, enjoyment: {}, createdAt: 0, updatedAt: 1,
  };
}

test("Game scoreboard shows attendance rate including zero when outcomes exist", async () => {
  const window = new Window({ url: "http://localhost/" });
  const nativeFetch = globalThis.fetch;
  const restore = installDom(window, {
    window, document: window.document, navigator: window.navigator, location: window.location,
    history: window.history, localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    CustomEvent: window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true,
  });
  globalThis.fetch = async () => Response.json([]);
  const { createRoot } = await import("react-dom/client");
  const { store } = await import("../web/store.ts");
  const { Drawer } = await import("../web/drawer.tsx");
  const box = window.document.createElement("div");
  window.document.body.appendChild(box);
  const root = createRoot(box as unknown as HTMLElement);
  store.mode = "game";
  store.app = "ntwrk";
  store.ui = { ...store.ui, drawer: "game", drawerOpen: true };
  store.env = { mode: "game", app: "ntwrk", label: "SIM", dataset: "sim",
    capabilities: { canStep: true, canIntervene: true, hiddenTruth: false, readOnly: false } };
  store.me = { id: "staff", roles: ["admin"], grants: [{ role: "admin", app: "*" }], via: "token" } as typeof store.me;
  store.game = {
    strikes: 0, maxStrikes: 3, over: false, lensUsed: false, peeks: 0, sparksLeft: 1, sparksPerDay: 1,
    engine: "engine-v1", missions: [], prompts: [], controlled: [],
    scores: scoreboard([
      opportunity("player", { a: "confirmed", b: "accepted" }),
      opportunity("engine", { a: "attended", b: "no_show", c: "cancelled_with_notice", d: "confirmed" }),
      opportunity("network", { a: "no_show", b: "no_show" }),
    ]),
  };
  try {
    await act(async () => root.render(createElement(Drawer)));
    const table = box.querySelector("table")!;
    const headers = [...table.querySelectorAll("th")].map(h => h.textContent?.trim());
    const column = headers.indexOf("show rate");
    expect(column).toBeGreaterThan(-1);
    const rows = [...table.querySelectorAll("tbody tr")].map(row => [...row.querySelectorAll("td")].map(c => c.textContent?.trim()));
    expect(Object.fromEntries(rows.map(row => [row[0], row[column]]))).toEqual({
      You: "–", "engine-v1": "33%", "Random baseline": "0%",
    });
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = nativeFetch;
    restore();
    await window.happyDOM.close();
  }
});
