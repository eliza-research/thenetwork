import { expect, test } from "vitest";
import { NEIGHBORHOOD, VENUES } from "../src/geo.ts";
import { slopVenue } from "../service/packs.ts";
import { Mini } from "./mini.ts";

async function ideas(request: string, area = "Upper West Side") {
  const world = new Mini([{ id: "a", name: "Anna Reed", age: 30, area }], { matchingEnabled: false });
  await world.onboard("a");
  const mark = world.mark();
  await world.say("a", request);
  return world.to("a", mark);
}

test("the curated venue list covers the P6 range of 50 to 100 public places", () => {
  expect(VENUES.length).toBeGreaterThanOrEqual(50);
  expect(VENUES.length).toBeLessThanOrEqual(100);
  const ids = new Set<string>();
  for (const v of VENUES) {
    expect(v.id.length).toBeGreaterThan(0);
    expect(ids.has(v.id)).toBe(false);
    ids.add(v.id);
    expect(v.lat).toBeGreaterThanOrEqual(40.5);
    expect(v.lat).toBeLessThanOrEqual(40.92);
    expect(v.lng).toBeGreaterThanOrEqual(-74.26);
    expect(v.lng).toBeLessThanOrEqual(-73.7);
    expect(["park", "library", "plaza", "market", "museum", "waterfront", "courts", "cafe_district"]).toContain(v.kind);
    expect(NEIGHBORHOOD.has(v.neighborhood)).toBe(true);
    expect(v.tags.length).toBeGreaterThan(0);
  }
});

test.each([
  ["Ridgewood", "Grover Cleveland Park"],
  ["Sunnyside", "Lou Lodati Park"],
  ["Bed-Stuy", "Herbert Von King Park"],
  ["Carroll Gardens", "Carroll Park"],
  ["Tribeca", "Washington Market Park"],
  ["East Harlem", "Thomas Jefferson Park"],
])("the concierge names the new public place near %s", async (place, expected) => {
  expect((await ideas(`Any plans near ${place} this weekend?`)).find(reply => reply.meta.type === "concierge")?.body).toContain(expected);
});

test("after dark the date place is a busy lit place near the members", () => {
  const at = Date.UTC(2026, 9, 10, 23);
  expect(slopVenue([{ lat: 40.7495, lon: -73.988 }], "coffee", at)?.id).toBe("herald-square");
});
