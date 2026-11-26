import { Window } from "happy-dom";
import { expect, test, vi } from "vitest";
import type { ObsOpportunity, ObsState } from "../src/types.ts";
import { installDom } from "./dom.ts";

test("console Back skips a browser history entry whose opportunity the latest snapshot removed", async () => {
  const window = new Window({ url: "http://localhost/" });
  const restore = installDom(window, {
    window, document: window.document, navigator: window.navigator, location: window.location,
    history: window.history, localStorage: window.localStorage, sessionStorage: window.sessionStorage,
  });
  const { store: singleton } = await import("../web/store.ts");
  const Store = singleton.constructor as new () => typeof singleton;
  const store = new Store();
  const fixture = (id: string): ObsOpportunity => ({
    id, kind: "intro", source: "engine", generator: "probe", city: "nyc", objective: "Meet someone",
    score: 1, explanations: {}, exploration: false, participants: [], alternates: [],
    state: "COMPLETED", status: {}, enjoyment: {}, createdAt: 1, updatedAt: 2, meetingAt: 2,
  });
  const snapshot = (ids: string[]) => ({
    env: { mode: "game", app: "ntwrk", capabilities: { canStep: false, canIntervene: false } },
    members: [], opportunities: ids.map(fixture), edges: [], feed: [], engineRuns: [],
  }) as unknown as ObsState;
  const arrived = (id: string, depth: number) => {
    history.replaceState({ obsDepth: depth }, "", "#o=" + id);
    window.dispatchEvent(new window.PopStateEvent("popstate", { state: { obsDepth: depth } }));
  };
  const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
  try {
    store.mode = "game";
    store.me = { id: "fixture", roles: ["admin"], grants: [{ role: "admin", app: "*" }], via: "token" } as typeof store.me;
    store["applyFull"](snapshot(["first", "removed", "current"]));
    for (const id of ["first", "removed", "current"]) store.focus({ kind: "opportunity", id });
    expect(store.ui.focus?.id).toBe("current");
    store["applyFull"](snapshot(["first", "current"]));
    expect(store.focusHistory.map(x => x?.id)).toEqual(["first"]);

    store.back();
    expect(back).toHaveBeenCalledTimes(1);
    arrived("removed", 2);
    expect(store.ui.focus?.id).toBe("current");
    expect(back).toHaveBeenCalledTimes(2);
    arrived("first", 1);
    expect(store.ui.focus?.id).toBe("first");
    expect(store.focusHistory).toEqual([]);

    // The same button still takes one step when the preceding entry survives.
    store.focus({ kind: "opportunity", id: "current" });
    store.back();
    arrived("first", 1);
    expect(back).toHaveBeenCalledTimes(3);
    expect(store.ui.focus?.id).toBe("first");

    // A new navigation before popstate clears the pending back target so Back never locks out.
    store.focus({ kind: "opportunity", id: "current" });
    store.back();
    expect(back).toHaveBeenCalledTimes(4);
    store.focus({ kind: "opportunity", id: "first" });
    store.back();
    expect(back).toHaveBeenCalledTimes(5);
    arrived("current", 2);
    expect(store.ui.focus?.id).toBe("current");

    // A failing history.back() clears appBackTarget instead of locking out later Back clicks.
    back.mockImplementationOnce(() => { throw new Error("history unavailable"); });
    store.focus({ kind: "opportunity", id: "first" });
    store.back();
    expect(back).toHaveBeenCalledTimes(6);
    store.back();
    expect(back).toHaveBeenCalledTimes(7);
    arrived("current", 2);
    expect(store.ui.focus?.id).toBe("current");
  } finally {
    back.mockRestore();
    store.disconnect();
    singleton.disconnect();
    await window.happyDOM.close();
    restore();
  }
});
