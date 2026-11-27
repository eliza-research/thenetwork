import { expect, test } from "vitest";
import type { ObsMember } from "../src/types.ts";
import { store, zonesForCity } from "../web/store.ts";

const NYC = "Downtown & Villages";
const SF = "Mission, Castro & Potrero";
const member = (id: string, city: "nyc" | "sf", area: string): ObsMember => ({
  id, city, area, name: id, joined: true, state: "normal", minor: false,
  counters: { msgsIn: 0, msgsOut: 0, proactive: 0, proposals: 0, accepted: 0, meetings: 0, enjoymentSum: 0, enjoymentN: 0 },
});

test("returning to All cities drops only a Zone that is no longer offered", () => {
  const restore = { members: store.members, selectedCity: store.selectedCity, ui: store.ui };
  const ny = member("ny", "nyc", "West Village");
  const sf = member("sf", "sf", "Potrero Hill");
  try {
    store.members = new Map([[ny.id, ny]]);
    store.setCity("sf");
    store.setFilters({ borough: SF });
    expect(store.zones()).toContain(SF);
    store.setCity("all");
    expect(store.zones()).toEqual(zonesForCity("nyc"));
    expect(store.ui.filters.borough).toBe("all");
    expect(store.inBorough(ny)).toBe(true);

    store.setCity("nyc");
    store.setFilters({ borough: NYC });
    store.setCity("all");
    expect(store.ui.filters.borough).toBe(NYC);

    store.members.set(sf.id, sf);
    store.setCity("sf");
    store.setFilters({ borough: SF });
    store.setCity("all");
    expect(store.zones()).toContain(SF);
    expect(store.ui.filters.borough).toBe(SF);
    expect(store.inBorough(sf)).toBe(true);
    expect(store.inBorough(ny)).toBe(false);
  } finally {
    Object.assign(store, restore);
  }
});
