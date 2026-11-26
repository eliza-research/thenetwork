import { setTimeout as sleep } from "node:timers/promises";
import { act, createElement, Fragment } from "react";
import { Window } from "happy-dom";
import { expect, test } from "vitest";
import { installDom } from "./dom.ts";
import { closedLabel, requestKpiFixture, waitingLabel } from "./request-kpi-fixture.ts";

test("the Open requests KPI opens waiting requests with no opportunity and resets the outcome segment", async () => {
  const window = new Window({ url: "http://127.0.0.1/" });
  const restoreDom = installDom(window, {
    window, document: window.document, navigator: window.navigator, location: window.location, history: window.history,
    localStorage: window.localStorage, sessionStorage: window.sessionStorage, CustomEvent: window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true,
  });
  const box = window.document.createElement("div");
  window.document.body.append(box);
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(box as unknown as HTMLElement);
  const { store } = await import("../web/store.ts");
  const { Drawer } = await import("../web/drawer.tsx");
  const { Inspector } = await import("../web/panels.tsx");
  const state = requestKpiFixture();
  store.mode = "game"; store.app = "ntwrk"; store.env = state.env; store.clock = state.clock;
  store.me = { id: "staff", roles: ["admin"], grants: [{ role: "admin", app: "*" }], via: "token" };
  store.stats = state.stats; store.network = state.network; store.requests = state.requests!;
  for (const m of state.members) store.members.set(m.id, m);
  store.setUI({ drawer: "feed", drawerOpen: true, focus: null });
  const kpi = () => [...box.querySelectorAll("button")].find(x => x.textContent?.endsWith("Open requests"));
  try {
    await act(async () => { root.render(createElement(Fragment, null, createElement(Inspector), createElement(Drawer))); });
    expect(kpi()?.textContent).toContain("1");
    await act(async () => { kpi()!.click(); await sleep(50); });
    expect(store.ui.drawer).toBe("requests");
    expect(box.textContent).toContain(waitingLabel);
    const fulfilled = [...box.querySelectorAll("button")].find(x => x.textContent === "Fulfilled")!;
    await act(async () => { fulfilled.click(); await sleep(50); });
    expect(box.textContent).toContain(closedLabel);
    expect(box.textContent).not.toContain(waitingLabel);
    await act(async () => { kpi()!.click(); await sleep(50); });
    expect(box.textContent).toContain(waitingLabel);
    expect(box.textContent).not.toContain(closedLabel);
  } finally {
    await act(async () => { root.unmount(); await sleep(40); });
    await window.happyDOM.close();
    restoreDom();
  }
});

test("in borough scope the Open requests KPI keeps opening the opportunities it counts", async () => {
  const window = new Window({ url: "http://127.0.0.1/" });
  const restoreDom = installDom(window, {
    window, document: window.document, navigator: window.navigator, location: window.location, history: window.history,
    localStorage: window.localStorage, sessionStorage: window.sessionStorage, CustomEvent: window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true,
  });
  const box = window.document.createElement("div");
  window.document.body.append(box);
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(box as unknown as HTMLElement);
  const { store } = await import("../web/store.ts");
  const { Drawer } = await import("../web/drawer.tsx");
  const { Inspector } = await import("../web/panels.tsx");
  const state = requestKpiFixture();
  store.mode = "game"; store.app = "ntwrk"; store.env = state.env; store.clock = state.clock;
  store.me = { id: "staff", roles: ["admin"], grants: [{ role: "admin", app: "*" }], via: "token" };
  store.stats = state.stats; store.network = state.network; store.requests = state.requests!;
  store.members.clear(); store.opps.clear();
  for (const m of state.members) store.members.set(m.id, m);
  store.setFilters({ borough: "Manhattan", origin: "all" });
  store.setUI({ drawer: "feed", drawerOpen: true, focus: null });
  const kpi = () => [...box.querySelectorAll("button")].find(x => x.textContent?.endsWith("Open requests"));
  try {
    await act(async () => { root.render(createElement(Fragment, null, createElement(Inspector), createElement(Drawer))); await sleep(50); });
    expect(kpi()?.textContent).toContain("0");
    await act(async () => { kpi()!.click(); await sleep(50); });
    expect(store.ui.drawer).toBe("pipeline");
    expect(store.ui.filters.origin).toBe("request");
  } finally {
    store.setFilters({ borough: "all", origin: "all" });
    await act(async () => { root.unmount(); await sleep(40); });
    await window.happyDOM.close();
    restoreDom();
  }
});
