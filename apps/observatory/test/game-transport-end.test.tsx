import { act, createElement } from "react";
import { Window } from "happy-dom";
import { expect, test, vi } from "vitest";
import { HOUR, DAY } from "../../../packages/core/src/clock.ts";
import type { ClockInfo } from "../src/types.ts";
import { installDom } from "./dom.ts";

vi.mock("../web/map.ts", () => ({
  MapView: class { destroy() {} },
}));

// The simulated world clock stops at its period end (docs/runbook-simulation.md, "Scenarios").
test("the console stops sending time controls at the period end and re-enables them in a fresh world", async () => {
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
  const clock = (now: number, playing = false): ClockInfo => ({ now, start: 0, end: 3 * DAY, day: 1, playing, speed: 6 * HOUR, waitingForPlayer: false });
  store.mode = "game";
  store.app = "ntwrk";
  store.me = { id: "staff", roles: ["admin"], grants: [{ role: "admin", app: "*" }], via: "token" } as typeof store.me;
  store.env = { mode: "game", app: "ntwrk", label: "SIM", dataset: "sim",
    capabilities: { canStep: true, canIntervene: true, hiddenTruth: false, readOnly: false } };
  store.clock = clock(2 * DAY);
  const box = window.document.createElement("div");
  window.document.body.appendChild(box);
  const root = createRoot(box as unknown as HTMLElement);
  const day = () => [...box.querySelectorAll("button")].find(b => b.textContent === "+1d")!;
  const hour = () => [...box.querySelectorAll("button")].find(b => b.textContent === "+1h")!;
  const play = () => box.querySelector('button[aria-label="Play"], button[aria-label="Pause"]')!;
  const render = async () => { await act(async () => root.render(createElement(App))); };
  const setClock = async (next: ClockInfo) => {
    store.clock = next;
    await act(async () => { store.notify(); await new Promise(resolve => setTimeout(resolve, 40)); });
  };
  const key = (k: string) => window.dispatchEvent(new window.KeyboardEvent("keydown", { key: k }));
  try {
    await render();
    await act(async () => { day().click(); key("n"); });
    expect(control.mock.calls.map(([cmd]) => cmd)).toEqual([{ type: "step", ms: DAY }, { type: "step", ms: HOUR }]);
    await setClock(clock(3 * DAY));
    expect([play().hasAttribute("disabled"), hour().disabled, day().disabled]).toEqual([true, true, true]);
    await act(async () => { day().click(); key("d"); key("n"); key(" "); });
    expect(control).toHaveBeenCalledTimes(2);
    await setClock(clock(3 * DAY, true));
    expect([play().hasAttribute("disabled"), day().disabled]).toEqual([true, true]);
    await setClock(clock(0));
    expect([play().hasAttribute("disabled"), hour().disabled, day().disabled]).toEqual([false, false, false]);
    await act(async () => { day().click(); });
    expect(control).toHaveBeenLastCalledWith({ type: "step", ms: DAY });
  } finally {
    await act(async () => root.unmount());
    control.mockRestore(); load.mockRestore(); connect.mockRestore();
    restore();
    await window.happyDOM.close();
  }
});
