// The real MapView over a fake Leaflet: the markers follow the store through an app switch.
// The filter bar table is checked here too, with the same browser globals.
import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

const removed: unknown[] = [];
const chain = (): any => new Proxy(function () {}, { get: (t: any, k: string) => k === "then" ? undefined : k === "getZoom" ? () => 12 : (t[k] ??= () => chain()), apply: () => chain() });
const marker = (ll: unknown) => { const m = chain(); return new Proxy(m, { get: (t, p: string) => p === "remove" ? () => { removed.push(ll); } : p === "on" || p === "bindTooltip" || p === "addTo" || p === "setStyle" || p === "setRadius" ? () => m : t[p] }); };
mock.module("leaflet", () => ({ default: new Proxy({}, { get: (_t, k: string) => k === "circleMarker" ? marker : () => chain() }) }));
mock.module("leaflet/dist/leaflet.css", () => ({}));

const member = (id: string) => ({ id, name: id, area: "Astoria", joined: true, state: "active", trust: "ok", minor: false, community: "c", counters: { meetings: 0, accepted: 0, proposals: 0 } });

function browser(window: Window) {
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({ window, document: window.document, location: window.location, history: window.history, localStorage: window.localStorage, sessionStorage: window.sessionStorage, requestAnimationFrame: (): number => 0, cancelAnimationFrame: (): void => {} })) {
    prior.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  }
  return prior;
}
async function restore(window: Window, prior: Map<string, PropertyDescriptor | undefined>) {
  // The test files share one process: the next file's first import must make its own store (it reads the token then).
  for (const k of Object.keys(require.cache)) if (k.includes("/observatory/web/")) delete require.cache[k];
  await window.happyDOM.close();
  for (const [name, d] of prior) { if (d) Object.defineProperty(globalThis, name, d); else delete (globalThis as Record<string, unknown>)[name]; }
}

test("the map drops the markers of the old app and rebuilds the opportunity layers on a switch", async () => {
  const window = new Window({ url: "http://obs.test/" }), prior = browser(window);
  try {
    const { store } = await import("../web/store.ts"), { MapView } = await import("../web/map.ts");
    const view = new MapView({} as HTMLElement) as any;
    store.members = new Map([["ntwrk-a", member("ntwrk-a")]]) as never;
    view.sync();
    expect([...view.members.keys()]).toEqual(["ntwrk-a"]);
    const key = view.oppVersion;
    store.members = new Map(); // a switch clears the maps; the next load fills them
    store.mode = store.mode === "real" ? "game" : "real";
    view.sync();
    expect(view.oppVersion).not.toBe(key);
    store.members = new Map([["slop-b", member("slop-b")]]) as never;
    view.sync();
    expect([...view.members.keys()]).toEqual(["slop-b"]);
    expect(removed.length).toBe(1);
  } finally { await restore(window, prior); }
});

test("the filter bar's table and the proved table are the same", async () => {
  const window = new Window({ url: "http://obs.test/" }), prior = browser(window);
  const { filterApplies } = await import("../web/drawer.tsx");
  const { tabKeys, APPLIES } = await import("../web/logic/filters.ts");
  for (const tab of Object.keys(APPLIES) as (keyof typeof APPLIES)[]) for (const k of ["range", "borough", "members", "origin", "stateGroup"] as const) expect(tabKeys(tab).includes(k)).toBe(filterApplies(tab, k));
  await restore(window, prior);
});
