import { expect, test, vi } from "vitest";
import { Window } from "happy-dom";
import type { ObsMember, ObsOpportunity } from "../src/types.ts";
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

test("MapView merges meetings at one location but renders same-name locations separately", async () => {
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
  const venueA = { name: "Community Room", lat: 40.73, lng: -73.97 };
  const venueB = { name: "Community Room", lat: 40.79, lng: -73.90 };
  const meeting = (id: string, venue: NonNullable<ObsOpportunity["venue"]>, state: ObsOpportunity["state"]): ObsOpportunity => ({
    id, kind: "intro", source: "network", generator: "probe", city: "nyc", objective: "Meet someone", score: 1, explanations: {}, exploration: false,
    participants: [a.id, b.id], alternates: [], state, status: {}, enjoyment: {}, createdAt: 1, updatedAt: 2, venue,
  });
  const meetings = [meeting("fixture-a-1", venueA, "COMPLETED"), meeting("fixture-a-2", venueA, "SCHEDULED"), meeting("fixture-b-1", venueB, "COMPLETED")];
  try {
    for (const item of meetings) store.opps.set(item.id, item);
    map["sync"]();
    const pins = map["meetLayer"].getLayers() as import("leaflet").CircleMarker[];
    expect(pins).toHaveLength(2);
    expect(pins.map(pin => pin.getLatLng().lat)).toEqual([venueA.lat, venueB.lat]);
    expect(pins[0]!.getTooltip()!.getContent()).toHaveProperty("textContent", "Community Room: 2 meetings (1 upcoming)");
    expect(pins[1]!.getTooltip()!.getContent()).toHaveProperty("textContent", "Community Room: 1 meeting");
    const focus = vi.spyOn(store, "focus");
    pins[1]!.fire("click");
    expect(focus).toHaveBeenCalledWith({ kind: "opportunity", id: meetings[2]!.id });
  } finally {
    for (const item of meetings) store.opps.delete(item.id);
    store.ui = originalUI;
    store.members.delete(a.id);
    store.members.delete(b.id);
    map.destroy();
    await window.happyDOM.close();
    restoreDom();
  }
});
