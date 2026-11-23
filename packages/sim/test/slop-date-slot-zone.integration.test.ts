import { CITY_TZ, localParts } from "@thenetwork/core";
import { expect, test } from "vitest";
import { BASELINES } from "../src/apps/slop/baselines.ts";
import { runSlopWorld } from "../src/apps/slop/world.ts";

test("a slop date and a no-show fall at the slot hour in the zone of the date's city, whatever the host zone", () => {
  const hostZone = process.env.TZ;
  process.env.TZ = "Pacific/Auckland";
  let result: ReturnType<typeof runSlopWorld>;
  try {
    result = runSlopWorld({ seed: 16, perCity: 120, weeks: 8, matcher: w => BASELINES.greedy(w) });
  } finally {
    if (hostZone === undefined) delete process.env.TZ; else process.env.TZ = hostZone;
  }
  const cityOf = new Map(result.flows.map(f => [f.key, f.city]));
  const met = result.world.state.interactions.filter(i => i.outcome === "completed" || i.outcome === "no_show");
  expect(met.length).toBeGreaterThan(0);
  const wrong = met.flatMap((i): { id: string; city: string | undefined; hour: number | undefined }[] => {
    const city = cityOf.get(i.id);
    if (!city) return [{ id: i.id, city: undefined, hour: undefined }];
    const hour = localParts(i.at, CITY_TZ[city]).hour;
    return hour === 14 || hour === 19 ? [] : [{ id: i.id, city, hour }];
  });
  expect(wrong).toEqual([]);
});
