import { CITY_TZ, fromLocal, type City } from "@thenetwork/core";
import { expect, test } from "vitest";
import { SLOTS, slopProfiles, type Slot } from "../src/packs/slop/profile.ts";
import { baseMember, emptyInput, facet } from "../src/testkit.ts";

test.each<[City, number, number, number, Slot]>([
  ["nyc", 28, 9, 20, "mon_eve"],
  ["nyc", 3, 10, 14, "sat_day"],
  ["nyc", 4, 10, 19, "sun_eve"],
  ["la", 2, 10, 19, "fri_eve"],
])("a completed date in %s on day %i of month %i at %i:00 local time counts for the %s slot", (city, day, month, hour, slot) => {
  const input = emptyInput();
  for (const [id, is, seeks] of [["ana", "woman", "man"], ["ben", "man", "woman"]] as const) {
    input.members.push(baseMember(id, { homeCity: city, prefs: { romanceOptIn: true, categoriesOptIn: ["romance"] } }));
    input.facets.push(facet(id, 0, "preference", "Private dating preferences", [
      `romance:is:${is}`, `romance:seeks:${seeks}`, "romance:age:18-65", "slop:max_miles:10",
    ], "agent_private"));
  }
  const at = fromLocal(2026, month, day, hour, CITY_TZ[city]);
  expect(at).toBeLessThanOrEqual(input.now);
  input.interactions = [{ id: "date-1", kind: "intro", category: "romance", participants: ["ana", "ben"], outcome: "completed", at, acceptedBy: ["ana", "ben"] }];
  const profiles = slopProfiles(input);
  for (const id of ["ana", "ben"]) expect(profiles.get(id)?.history.attendedSlots).toEqual([SLOTS.indexOf(slot)]);
});
