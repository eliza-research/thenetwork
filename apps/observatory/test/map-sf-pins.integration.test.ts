import { expect, test, vi } from "vitest";
import { Window } from "happy-dom";
import { ZIPS } from "../../../packages/engine/src/packs/slop/zips.ts";
import { CITY_CENTER, km, memberPoint } from "@thenetwork/network/geo";
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

test("MapView focuses SF members in San Francisco, Bay Area zips near their centroids, and keeps NYC unchanged", async () => {
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
  const L = (await import("leaflet")).default;
  const flySpy = vi.spyOn(L.Map.prototype, "flyTo").mockImplementation(function (this: L.Map) { return this; });
  const { store } = await import("../web/store.ts");
  const { MapView } = await import("../web/map.ts");
  store.members.clear();
  store.opps.clear();
  const cases = [
    makeMember("sf-0001", "SF Dogpatch", "sf", "Dogpatch"),
    makeMember("sf-0044", "SF FiDi", "sf", "Financial District"),
    makeMember("sf-0018", "SF Chinatown", "sf", "Chinatown"),
    makeMember("sf-0107", "SF Combined", "sf", "Potrero Hill / Dogpatch"),
    makeMember("sf-0201", "SF Oakland", "sf", "Downtown Oakland"),
    makeMember("sf-0202", "SF Palo Alto", "sf", "Palo Alto"),
    makeMember("sf-0203", "SF Presidio", "sf", "Presidio"),
    makeMember("sf-9999", "SF Unknown", "sf", "No Such Place"),
    makeMember("la-0001", "LA Unknown", "la", undefined),
    makeMember("ny-0005", "NYC FiDi", "nyc", "Financial District"),
  ];
  for (const m of cases) store.members.set(m.id, m);
  const mapView = new MapView(el as unknown as HTMLElement);
  try {
    const focusedPoint = (id: string) => {
      flySpy.mockClear();
      mapView.focus(id);
      expect(flySpy).toHaveBeenCalledOnce();
      const [lat, lng] = flySpy.mock.calls[0]![0] as [number, number];
      return { lat, lng };
    };
    expect(km(focusedPoint("sf-0001"), { lat: 37.7621, lng: -122.3971 })).toBeLessThan(1.5);
    expect(km(focusedPoint("sf-0044"), { lat: 37.7914, lng: -122.4021 })).toBeLessThan(1.5);
    expect(km(focusedPoint("sf-0018"), { lat: 37.792, lng: -122.4086 })).toBeLessThan(1.5);
    expect(km(focusedPoint("sf-0107"), { lat: 37.7621, lng: -122.3971 })).toBeLessThan(1.5);
    expect(km(focusedPoint("sf-0201"), { lat: 37.8102, lng: -122.2697 })).toBeLessThan(1.5);
    expect(km(focusedPoint("sf-0202"), { lat: 37.4442, lng: -122.15 })).toBeLessThan(1.5);
    expect(km(focusedPoint("sf-0203"), { lat: 37.7973, lng: -122.4645 })).toBeLessThan(1.5);
    expect(km(focusedPoint("sf-9999"), CITY_CENTER.sf)).toBeLessThan(1.5);
    expect(km(focusedPoint("la-0001"), CITY_CENTER.la)).toBeLessThan(1.5);
    expect(focusedPoint("ny-0005")).toEqual({ lat: 40.701008203523806, lng: -74.00525802926815 });

    const sfZips = ZIPS.filter(z => z.market === "sf");
    expect(sfZips.length).toBeGreaterThanOrEqual(44);
    for (const z of sfZips) {
      const id = `sf-zip-${z.zip}`;
      store.members.set(id, makeMember(id, z.area, "sf", z.area));
      expect(km(focusedPoint(id), { lat: z.lat, lng: z.lon }), `${z.zip} (${z.area})`).toBeLessThan(1.5);
    }
    expect(memberPoint("ny-0001", "Mott Haven", "nyc")).toEqual({ lat: 40.80566646388137, lng: -73.92623919714757 });
    expect(memberPoint("ny-0001", "Mott Haven")).toEqual({ lat: 40.80566646388137, lng: -73.92623919714757 });
    // Keep the same map mounted while a member's home area changes in a newer snapshot.
    const moving = makeMember("moving-member", "Maya Rao", "nyc", "Harlem");
    store.members.set(moving.id, moving);
    store.edges.set("moving-edge", { id: "moving-edge", from: moving.id, to: "ny-0005", type: "met", strength: 1, createdAt: 1, origin: "learned" });
    const edgeStart = () => (mapView["edgeLayer"].getLayers()[0] as L.Polyline).getLatLngs()[0];
    mapView["sync"]();
    const marker = mapView["members"].get(moving.id)!;
    expect(marker.getLatLng()).toMatchObject(memberPoint(moving.id, "Harlem", "nyc"));
    expect(edgeStart()).toMatchObject(marker.getLatLng());

    store.members.set(moving.id, { ...moving, area: "Astoria" });
    mapView["sync"]();
    expect(mapView["members"].get(moving.id)).toBe(marker);
    expect(marker.getLatLng()).toMatchObject(memberPoint(moving.id, "Astoria", "nyc"));
    expect(edgeStart()).toMatchObject(marker.getLatLng());

    // A full snapshot can remove a member while the same map stays mounted.
    store.members.delete(moving.id);
    store.edges.delete("moving-edge");
    store.graphTick++;
    mapView["sync"]();
    expect(mapView["map"].hasLayer(marker)).toBe(false);
    expect(mapView["members"].has(moving.id)).toBe(false);
    expect(mapView["edgeLayer"].getLayers()).toHaveLength(0);
    expect(mapView["members"].has("ny-0005")).toBe(true);

  } finally {
    store.edges.delete("moving-edge");
    mapView.destroy();
    flySpy.mockRestore();
    await window.happyDOM.close();
    restoreDom();
  }
});
