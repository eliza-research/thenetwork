import { act, createElement } from "react";
import { Window } from "happy-dom";
import { expect, test } from "vitest";
import { DAY } from "../../../packages/core/src/clock.ts";
import { Store } from "../src/store.ts";
import type { ScoreMetric } from "../src/types.ts";
import { installDom } from "./dom.ts";

test("the Metrics proactive headline uses authoritative member time and leaves unknown rates blank", async () => {
  const window = new Window({ url: "http://localhost/" });
  const restore = installDom(window, {
    window, document: window.document, navigator: window.navigator, location: window.location,
    history: window.history, localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    CustomEvent: window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { createRoot } = await import("react-dom/client");
  const { store } = await import("../web/store.ts");
  const { Drawer } = await import("../web/drawer.tsx");
  const box = window.document.createElement("div");
  window.document.body.appendChild(box);
  const root = createRoot(box as unknown as HTMLElement);
  store.mode = "game";
  store.app = "ntwrk";
  store.me = { id: "staff", roles: ["admin"], grants: [{ role: "admin", app: "*" }], via: "token" } as typeof store.me;
  store.env = { mode: "game", app: "ntwrk", label: "SIM", dataset: "sim",
    capabilities: { canStep: true, canIntervene: true, hiddenTruth: false, readOnly: false } };
  store.clock = { now: 7 * DAY, start: 0, day: 8, playing: false, speed: 0, waitingForPlayer: false };
  store.ui = { ...store.ui, drawer: "metrics", drawerOpen: true };
  const raw = { ...new Store(store.env, store.clock).snapshot().stats, proactive: 10, joined: 40 };
  const metric = (value: number | null): ScoreMetric => ({
    key: "attention_burden", label: "Proactive messages per member per week", unit: "per_member_week",
    how: "Delivered proactive messages per observed member week", n: 10, value,
  });
  const update = async (rate?: ScoreMetric) => {
    store.stats = { ...raw, scorecard: rate ? [rate] : undefined };
    await act(async () => { store.notify(); await new Promise(resolve => setTimeout(resolve, 40)); });
  };
  const headline = () => [...box.querySelectorAll("span")].find(s => s.textContent === "proactive / member / week")!.parentElement!.firstElementChild!;
  try {
    store.stats = { ...raw, scorecard: [metric(0.397)] };
    await act(async () => root.render(createElement(Drawer)));
    expect(headline().textContent).toBe("0.40");
    await update(metric(2.001));
    expect(headline().textContent).toBe("2.01");
    expect(headline().classList.contains("text-warn")).toBe(true);
    await update(metric(0));
    expect(headline().textContent).toBe("0.00");
    expect(headline().classList.contains("text-warn")).toBe(false);
    await update(metric(null));
    expect(headline().textContent).toBe("–");
    await update();
    expect(headline().textContent).toBe("–");
  } finally {
    await act(async () => root.unmount());
    restore();
    await window.happyDOM.close();
  }
});
