import { describe, expect, it } from "vitest";
import {
  CITY_TZ,
  extractMemberRedLines,
  LAUNCH_CITIES,
  registerCity,
  timeZoneOf,
  VENUE_RED_LINE_TAGS,
} from "../src/index.ts";

describe("core foundation: timeZoneOf and canonical red lines", () => {
  it("resolves all launch cities and dynamically registered cities safely", () => {
    for (const c of LAUNCH_CITIES) {
      expect(timeZoneOf(c)).toBe(CITY_TZ[c]);
    }
    expect(timeZoneOf("chicago")).toBe("America/Chicago");
    expect(timeZoneOf("miami")).toBe("America/New_York");
    expect(timeZoneOf("unknown_city")).toBe("America/New_York");

    registerCity({
      id: "london" as never,
      name: "London",
      shortName: "LDN",
      tz: "Europe/London",
      primaryMode: "transit",
      anchorZip: "EC1A",
      aliases: ["london"],
      center: { lat: 51.5074, lng: -0.1278 },
      dateMaxMinutes: 30,
      groupMaxMinutes: 40,
      kmPerMinute: 0.28,
      baseMinutes: 8,
      zones: [{ id: "central", name: "Central" }],
      barriers: [],
      neighborhoods: [],
      seedVenues: [],
    });
    expect(timeZoneOf("london")).toBe("Europe/London");
  });

  it("distinguishes strictSober vs nonDrinker vs alcoholOptional and covers all 13 red-line tags", () => {
    expect(VENUE_RED_LINE_TAGS).toHaveLength(13);

    const sober = extractMemberRedLines([{ tags: ["strict_sober"], value: "" }]);
    expect(sober.strictSober).toBe(true);
    expect(sober.nonDrinker).toBe(true);
    expect(sober.alcoholOptional).toBe(true);
    expect(sober.hasVenueRedLines).toBe(true);

    const nonDrinker = extractMemberRedLines([{ tags: ["slop:drinking:never"], value: "" }]);
    expect(nonDrinker.strictSober).toBe(false);
    expect(nonDrinker.nonDrinker).toBe(true);
    expect(nonDrinker.alcoholOptional).toBe(true);

    const opt = extractMemberRedLines([{ tags: ["alcohol_optional"], value: "" }]);
    expect(opt.strictSober).toBe(false);
    expect(opt.nonDrinker).toBe(false);
    expect(opt.alcoholOptional).toBe(true);

    const dietary = extractMemberRedLines([
      { tags: ["pref:halal", "kosher", "celiac", "nut_allergy", "wheelchair", "low_noise", "daytime_only", "women_only", "all_ages"], value: "" },
    ]);
    expect(dietary.halal).toBe(true);
    expect(dietary.kosher).toBe(true);
    expect(dietary.glutenFree).toBe(true);
    expect(dietary.severeAllergen).toBe(true);
    expect(dietary.wheelchairNeeded).toBe(true);
    expect(dietary.lowWalking).toBe(true);
    expect(dietary.lowNoiseRequired).toBe(true);
    expect(dietary.daytimeOnly).toBe(true);
    expect(dietary.womenOnly).toBe(true);
    expect(dietary.allAgesOnly).toBe(true);

    const clean = extractMemberRedLines([{ tags: ["coffee", "books"], value: "likes cafes" }]);
    expect(clean.hasVenueRedLines).toBe(false);
  });
});
