import { expect, test } from "vitest";
import { Window } from "happy-dom";
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

test("MapView draws a focused member's visible cross-borough connection", async () => {
  const window = new Window({ url: "http://127.0.0.1/" });
  const restoreDom = installDom(window, {
    window, document: window.document, navigator: window.navigator,
    location: window.location, history: window.history,
    localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  });
  installCanvasShim(window);
  const el = window.document.createElement("div");
  Object.defineProperty(el, "clientWidth", { value: 960, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: 660, configurable: true });
  window.document.body.append(el);
  const { store } = await import("../web/store.ts");
  const { MapView } = await import("../web/map.ts");
  const originalUI = store.ui;
  const a = makeMember("map-focus-manhattan", "Maya", "nyc", "East Village");
  const b = makeMember("map-focus-brooklyn", "Noah", "nyc", "Williamsburg");
  const edge = { id: "map-focus-met", from: a.id, to: b.id, type: "met", strength: 1, createdAt: 1, origin: "learned" } as const;
  store.members.set(a.id, a);
  store.members.set(b.id, b);
  store.edges.set(edge.id, edge);
  const mapView = new MapView(el as unknown as HTMLElement);
  try {
    store.ui = { ...originalUI, filters: { ...originalUI.filters, borough: "Downtown & Villages" }, focus: null };
    mapView["sync"]();
    expect(mapView["members"].has(a.id)).toBe(true);
    expect(mapView["members"].has(b.id)).toBe(false);
    expect(mapView["edgeLayer"].getLayers()).toHaveLength(0);

    store.ui = { ...store.ui, focus: { kind: "member", id: a.id } };
    mapView["sync"]();
    expect(mapView["members"].has(b.id)).toBe(true);
    expect(mapView["edgeLayer"].getLayers()).toHaveLength(1);

    store.ui = { ...store.ui, focus: null };
    mapView["sync"]();
    expect(mapView["members"].has(b.id)).toBe(false);
    expect(mapView["edgeLayer"].getLayers()).toHaveLength(0);
  } finally {
    store.edges.delete(edge.id);
    store.members.delete(a.id);
    store.members.delete(b.id);
    store.ui = originalUI;
    mapView.destroy();
    await window.happyDOM.close();
    restoreDom();
  }
});
