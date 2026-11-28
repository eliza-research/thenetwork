import { act, createElement } from "react";
import { Window } from "happy-dom";
import { expect, test, vi } from "vitest";
import { installDom } from "./dom.ts";

vi.mock("../web/map.ts", () => ({ MapView: class { destroy() {} } }));

test("the filter bar resets City along with the other active filters", async () => {
  const window = new Window({ url: "http://localhost/" });
  const restore = installDom(window, {
    window, document: window.document, navigator: window.navigator, location: window.location,
    history: window.history, localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    CustomEvent: window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { createRoot } = await import("react-dom/client");
  const { store, DEFAULT_FILTERS } = await import("../web/store.ts");
  const { App } = await import("../web/main.tsx");
  const load = vi.spyOn(store, "load").mockResolvedValue();
  const connect = vi.spyOn(store, "connect").mockResolvedValue();
  const control = vi.spyOn(store, "control").mockResolvedValue({ ok: true });
  store.mode = "game";
  store.app = "ntwrk";
  store.me = { id: "staff", roles: ["admin"], grants: [{ role: "admin", app: "*" }], via: "token" } as typeof store.me;
  store.env = { mode: "game", app: "ntwrk", label: "SIM", dataset: "sim",
    capabilities: { canStep: true, canIntervene: true, hiddenTruth: false, readOnly: false } };
  store.clock = { now: 2, start: 0, day: 1, playing: false, speed: 3600000, waitingForPlayer: false };
  const box = window.document.createElement("div");
  window.document.body.appendChild(box);
  const root = createRoot(box as unknown as HTMLElement);
  const reset = () => [...box.querySelectorAll("button")].find(b => b.textContent?.trim() === "Reset");
  const settle = () => new Promise(resolve => setTimeout(resolve, 40));
  try {
    await act(async () => root.render(createElement(App)));
    expect(reset()).toBeUndefined();
    await act(async () => { store.setCity("sf"); await settle(); });
    expect(reset()).toBeDefined();
    await act(async () => { reset()?.click(); await settle(); });
    expect(store.selectedCity).toBe("all");
    expect(reset()).toBeUndefined();
    await act(async () => { store.setCity("chicago"); store.setFilters({ range: "30d" }); store.focus({ kind: "neighborhood", id: "Dogpatch" }); await settle(); });
    const focusBefore = store.ui.focus;
    expect(focusBefore).toEqual({ kind: "neighborhood", id: "Dogpatch" });
    const clockBefore = store.clock;
    await act(async () => { reset()?.click(); await settle(); });
    expect(store.selectedCity).toBe("all");
    expect(store.ui.filters).toEqual(DEFAULT_FILTERS);
    expect(store.ui.focus).toBe(focusBefore);
    expect(store.clock).toBe(clockBefore);
    expect(control).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    load.mockRestore(); connect.mockRestore(); control.mockRestore();
    restore();
    await window.happyDOM.close();
  }
});
