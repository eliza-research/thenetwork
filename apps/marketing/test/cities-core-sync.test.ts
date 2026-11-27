import { describe, expect, test } from "vitest";
import { getCity, LAUNCH_CITIES } from "@thenetwork/core";
import {
  canActivateCityExpansion,
  CITY_CONFIGS,
  getCityConfig,
} from "../src/cities.ts";
import {
  createDefaultBanditArms,
  createDefaultNycBanditArms,
} from "../src/bandit.ts";

describe("apps/marketing cities sync with @thenetwork/core CitySpec", () => {
  test("all 5 launch cities match @thenetwork/core getCity(id) for name, tz, and isPrimaryLaunch", () => {
    expect(LAUNCH_CITIES).toHaveLength(5);

    for (const id of LAUNCH_CITIES) {
      const core = getCity(id);
      expect(core).toBeDefined();

      const mkt = CITY_CONFIGS[id];
      expect(mkt).toBeDefined();
      expect(getCityConfig(id)).toBe(mkt);
      expect(mkt.code).toBe(core!.id);
      expect(mkt.label).toBe(core!.name);
      expect(mkt.timezone).toBe(core!.tz);
      expect(mkt.isPrimaryLaunch).toBe(true);

      const readiness = canActivateCityExpansion(id, 0, 0);
      expect(readiness.isPrimaryLaunch).toBe(true);
      expect(readiness.ready).toBe(true);
      expect(readiness.blockers).toEqual([]);
    }
  });

  test("non-launch expansion cities remain non-primary with activation gates", () => {
    for (const id of ["austin", "london"] as const) {
      const mkt = getCityConfig(id);
      expect(mkt.isPrimaryLaunch).toBe(false);
      const readiness = canActivateCityExpansion(id, 0, 0);
      expect(readiness.ready).toBe(false);
      expect(readiness.blockers.length).toBeGreaterThan(0);
    }
  });

  test("createDefaultBanditArms parameterizes all 5 launch cities cleanly while keeping NYC alias parity", () => {
    const nowIso = "2026-11-27T08:00:00.000Z";
    for (const id of LAUNCH_CITIES) {
      const arms = createDefaultBanditArms(`${id}-launch-m1`, id, nowIso);
      expect(arms).toHaveLength(5);
      for (const arm of arms) {
        expect(arm.city).toBe(id);
        expect(arm.playCode?.startsWith(`${id.toUpperCase()}-TRACK-`)).toBe(true);
      }
      const totalAllocated = arms.reduce((sum, a) => sum + a.allocatedCents, 0);
      expect(totalAllocated).toBe(getCityConfig(id).defaultMonthlyBudgetCents);
    }

    expect(createDefaultNycBanditArms("nyc-launch-m1", nowIso)).toEqual(
      createDefaultBanditArms("nyc-launch-m1", "nyc", nowIso),
    );
  });
});
