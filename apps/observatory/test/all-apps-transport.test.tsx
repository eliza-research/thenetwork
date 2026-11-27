import { act, createElement } from "react";
import { Window } from "happy-dom";
import { expect, test, vi } from "vitest";
import { DAY, HOUR } from "../../../packages/core/src/clock.ts";
import { installDom } from "./dom.ts";

vi.mock("../web/map.ts", () => ({
  MapView: class { destroy() {} },
}));

// spec/consoleNavigation.md, "The app switcher opens one app or the all-apps page"
test("simulation time controls only operate in the named app workspace", async () => {
  const window = new Window({ url: "http://localhost/" });
  const restore = installDom(window, {
    window, document: window.document, navigator: window.navigator, location: window.location,
    history: window.history, localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    CustomEvent: window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { createRoot } = await import("react-dom/client");
  const { store } = await import("../web/store.ts");
  const { App } = await import("../web/main.tsx");
  const control = vi.spyOn(store, "control").mockResolvedValue({ ok: true });
  const load = vi.spyOn(store, "load").mockResolvedValue();
  const connect = vi.spyOn(store, "connect").mockResolvedValue();
  const health = vi.spyOn(store, "appsHealth").mockResolvedValue({ status: 200, data: { apps: [], mode: "game" } });
  store.mode = "game";
  store.app = "slop";
  store.me = {
    id: "staff", roles: ["admin"], grants: [{ role: "admin", app: "*" }], via: "token",
    apps: ["ntwrk", "slop"], appInfo: [{ id: "ntwrk" }, { id: "slop" }],
  } as typeof store.me;
  store.env = { mode: "game", app: "slop", label: "SIM", dataset: "sim",
    capabilities: { canStep: true, canIntervene: true, hiddenTruth: false, readOnly: false } };
  store.clock = { now: 0, start: 0, end: DAY * 3, day: 1, playing: false, speed: HOUR * 6, waitingForPlayer: false };
  const box = window.document.createElement("div");
  window.document.body.appendChild(box);
  const root = createRoot(box as unknown as HTMLElement);
  const button = (label: string) => [...box.querySelectorAll("button")].find(b => b.textContent === label);
  const key = (k: string) => window.dispatchEvent(new window.KeyboardEvent("keydown", { key: k }));
  const click = async (label: string) => {
    await act(async () => { button(label)?.click(); await new Promise(resolve => setTimeout(resolve, 40)); });
  };
  try {
    await act(async () => root.render(createElement(App)));
    expect(button("+1d")).toBeDefined();
    await click("all");
    expect(store.page.kind).toBe("all");
    expect(button("+1d")).toBeUndefined();
    await act(async () => { key(" "); key("n"); key("d"); });
    expect(control).not.toHaveBeenCalled();
    await click("slop");
    expect(store.page.kind).toBe("app");
    await click("+1d");
    await act(async () => { key("n"); });
    expect(control.mock.calls.map(([cmd]) => cmd)).toEqual([{ type: "step", ms: DAY }, { type: "step", ms: HOUR }]);
  } finally {
    await act(async () => root.unmount());
    control.mockRestore(); load.mockRestore(); connect.mockRestore(); health.mockRestore();
    restore();
    await window.happyDOM.close();
  }
});
