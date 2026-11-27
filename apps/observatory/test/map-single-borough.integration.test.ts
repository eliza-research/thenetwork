import { expect, test, vi } from "vitest";
import { Window } from "happy-dom";
import { memberPoint } from "@thenetwork/network/geo";
import type { ObsMember } from "../src/types.ts";
import { installDom } from "./dom.ts";

const counters = () => ({ msgsIn: 0, msgsOut: 0, proactive: 0, proposals: 0, accepted: 0, meetings: 0, enjoymentSum: 0, enjoymentN: 0 });
const makeMember = (id: string, name: string, city: ObsMember["city"], area: string | undefined): ObsMember => ({
  id, name, city, area, state: "normal", joined: true, joinedAt: 1, minor: false, age: 30, counters: counters(),
});

function installCanvasShim(window: Window) {
  const makeCtx = () => new Proxy(function () {}, {
    get: (_t, p) => {
      if (p === "canvas") return window.document.createElement("canvas");
      if (p === "measureText") return () => ({ width: 0 });
      if (p === "getImageData") return () => ({ data: [] });
      if (p === "createLinearGradient" || p === "createRadialGradient" || p === "createPattern") return () => ({ addColorStop() {} });
      return (..._a: unknown[]) => undefined;
    },
    set: () => true,
    apply: () => undefined,
  });
  window.HTMLCanvasElement.prototype.getContext = (function () {
    return makeCtx() as unknown as CanvasRenderingContext2D;
  }) as unknown as typeof window.HTMLCanvasElement.prototype.getContext;
}

test("MapView flies to the sole pin when a borough selection narrows to one member", async () => {
  const window = new Window({ url: "http://127.0.0.1/" });
  const restoreDom = installDom(window, {
    window, document: window.document, navigator: window.navigator,
    location: window.location, history: window.history,
    localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
  });
  installCanvasShim(window);
  const el = window.document.createElement("div");
  Object.defineProperty(el, "clientWidth", { value: 960, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: 660, configurable: true });
  window.document.body.append(el);
  const { store } = await import("../web/store.ts");
  const { MapView } = await import("../web/map.ts");
  const originalUI = store.ui;
  const a = makeMember("fixture-a", "A", "nyc", "East Village");
  const b = makeMember("fixture-b", "B", "nyc", "Riverdale");
  store.members.set(a.id, a);
  store.members.set(b.id, b);
  const map = new MapView(el as unknown as HTMLElement);
  try {
    const native = map["map"];
    const initial = native.getCenter();
    const fly = vi.spyOn(native, "flyTo").mockReturnValue(native);
    store.ui = { ...originalUI, filters: { ...originalUI.filters, borough: "Bronx" }, focus: null };
    map["sync"]();
    expect(map["members"].has(a.id)).toBe(false);
    expect(map["members"].has(b.id)).toBe(true);
    expect(fly).toHaveBeenCalledOnce();
    const point = memberPoint(b.id, b.area, b.city);
    expect(fly).toHaveBeenCalledWith([point.lat, point.lng], 14, { duration: 0.6 });
    expect(initial.lat).not.toBeCloseTo(point.lat, 2);
    map["sync"]();
    expect(fly).toHaveBeenCalledOnce();
    store.ui = { ...store.ui, filters: { ...store.ui.filters, borough: "Queens" } };
    map["sync"]();
    expect(fly).toHaveBeenCalledOnce();
  } finally {
    store.ui = originalUI;
    store.members.delete(a.id);
    store.members.delete(b.id);
    map.destroy();
    await window.happyDOM.close();
    restoreDom();
  }
});
