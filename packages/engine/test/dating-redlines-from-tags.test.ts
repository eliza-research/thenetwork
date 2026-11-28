import { describe, expect, test } from "vitest";
import { extractMemberRedLines } from "@thenetwork/core";
import { datingProfiles } from "../src/index.ts";
import { dateActivity, slopRedLinesOf, statedDealbreaker } from "../src/packs/dating/score.ts";
import { baseMember, emptyInput, facet } from "../src/testkit.ts";

describe("dating red lines from saved tags", () => {
  function inputWith() {
    const input = emptyInput();
    const romance = { homeCity: "nyc" as const, prefs: { romanceOptIn: true, categoriesOptIn: ["romance"] } };
    input.members.push(baseMember("a", romance));
    input.members.push(baseMember("b", romance));
    input.members.push(baseMember("r", romance));
    input.members.push(baseMember("s", romance));
    input.members.push(baseMember("s2", romance));
    const ownerFacets = [
      facet("a", 0, "preference", "Drinking prefs", [
        "slop:drinking:social",
        "slop:dealbreaker:heavy_drinker",
        "slop:activity:drinks",
      ], "agent_private"),
    ];
    input.facets.push(
      ...ownerFacets,
      facet("b", 0, "preference", "Drinking prefs", ["slop:drinking:occasional", "slop:activity:drinks"], "agent_private"),
      facet("r", 0, "preference", "Drinking prefs", ["slop:drinking:regular", "slop:activity:drinks"], "agent_private"),
      facet("s", 0, "preference", "Drinking prefs", ["slop:drinking:never", "slop:activity:coffee"], "agent_private"),
      facet("s2", 0, "boundary", "Sober", ["strict_sober", "slop:activity:coffee"], "agent_private"),
    );
    return { input, ownerFacets };
  }

  test("a heavy_drinker dealbreaker is not the owner's own non-drinker red line", () => {
    const { input, ownerFacets } = inputWith();
    const profiles = datingProfiles(input);
    const owner = profiles.get("a")!;
    const partner = profiles.get("b")!;
    const regular = profiles.get("r")!;

    expect(owner.values.drinking).toBe("social");
    expect(owner.dealbreakers).toEqual(["heavy_drinker"]);

    expect(owner.redLines.nonDrinker).toBe(false);
    expect(owner.redLines.strictSober).toBe(false);
    expect(extractMemberRedLines(ownerFacets, owner.dealbreakers).nonDrinker).toBe(false);

    expect(slopRedLinesOf(owner, partner).anyNonDrinker).toBe(false);
    expect(dateActivity(owner, partner)).toBe("drinks");

    expect(statedDealbreaker(owner, regular)).toBe("heavy_drinker");
  });

  test("real non-drinkers stay non-drinkers", () => {
    const { input } = inputWith();
    const profiles = datingProfiles(input);
    const neverDrinker = profiles.get("s")!;
    expect(neverDrinker.redLines.nonDrinker).toBe(true);
    const strictSober = profiles.get("s2")!;
    expect(strictSober.redLines.strictSober).toBe(true);
    expect(strictSober.redLines.nonDrinker).toBe(true);
  });
});
