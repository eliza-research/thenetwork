// slopPack zip table (packs/slop/zips.ts): coverage of the three launch metros (US Census 2020 ZCTA
// gazetteer), the slop world reading the same table, and the graceful fallback for a zip we do not
// know (a neighborhood the member named, else ask for a nearby zip or neighborhood; never a failure).
import { describe, expect, test } from "bun:test";
import type { Facet, MemberId } from "@thenetwork/core";
import { DAY } from "@thenetwork/core";
import { runEngine } from "../src/engine.ts";
import { makeSlopPack, SLOP_ENGINE_CONFIG, slopProfiles } from "../src/packs/slop/index.ts";
import { cellIn } from "../src/packs/slop/profile.ts";
import { missingFields } from "../src/packs/slop/rules.ts";
import { SLOP_ASK_QUESTIONS } from "../src/packs/slop/copy.ts";
import { cellOfZip, isKnownZip, MARKET_ANCHOR_ZIP, normalizeZip, SIM_HOME_ZIPS, zipCentroid, zipForArea, ZIPS } from "../src/packs/slop/zips.ts";
import { zipsIn } from "../../worlds/src/slop/geo.ts";
import type { EngineInput } from "../src/types.ts";
import { slopWorld } from "./slopkit.ts";

const of = (m: string) => ZIPS.filter(z => z.market === m);
const borough = (zip: string) =>
  /^10[0-2]/.test(zip) ? "manhattan" : /^104/.test(zip) ? "bronx" : /^112/.test(zip) ? "brooklyn" : /^103/.test(zip) ? "staten_island"
  : /^1(10|1[13456])/.test(zip) ? "queens" : "other";

describe("zip table coverage", () => {
  test("NYC's five boroughs, SF and LA are covered; no duplicates; every centroid is inside its metro", () => {
    expect(new Set(ZIPS.map(z => z.zip)).size).toBe(ZIPS.length);
    const nyc = of("nyc");
    expect(nyc.length).toBeGreaterThanOrEqual(150);
    const by = (b: string) => nyc.filter(z => borough(z.zip) === b).length;
    expect(by("manhattan")).toBeGreaterThanOrEqual(40);
    expect(by("brooklyn")).toBeGreaterThanOrEqual(35);
    expect(by("queens")).toBeGreaterThanOrEqual(50);
    expect(by("bronx")).toBeGreaterThanOrEqual(20);
    expect(by("staten_island")).toBeGreaterThanOrEqual(10);
    expect(of("sf").filter(z => z.zip.startsWith("941")).length).toBeGreaterThanOrEqual(25);
    expect(of("sf").length).toBeGreaterThanOrEqual(30);
    expect(of("la").length).toBeGreaterThanOrEqual(100);
    const box = { nyc: [40.49, 40.92, -74.26, -73.69], sf: [37.3, 37.95, -122.55, -122.0], la: [33.7, 34.3, -118.7, -118.05] } as const;
    for (const z of ZIPS) {
      const [la0, la1, lo0, lo1] = box[z.market as keyof typeof box];
      expect(z.lat > la0 && z.lat < la1 && z.lon > lo0 && z.lon < lo1).toBe(true);
      expect(z.area.length).toBeGreaterThan(0);
    }
  });

  test("the slop world still draws home zips from the original 53 (seeded worlds unchanged)", () => {
    expect(SIM_HOME_ZIPS.length).toBe(53);
    for (const z of SIM_HOME_ZIPS) expect(isKnownZip(z)).toBe(true);
    expect(zipsIn("nyc").map(z => z.zip)).toEqual(["10001", "10002", "10003", "10011", "10014", "10016", "10023", "10025", "10027", "10028", "11201", "11211", "11215", "11216", "11222", "11238", "11101", "11375", "07302"]);
  });

  test("zip text is normalised; neighborhoods resolve to a zip in the member's market", () => {
    expect(normalizeZip("10025-1234")).toBe("10025");
    expect(normalizeZip("my zip is 11102")).toBe("11102");
    expect(normalizeZip("123456")).toBeUndefined();
    expect(zipCentroid("11102-0001")?.area).toBe("Astoria");
    expect(zipForArea("Astoria", "nyc")?.zip).toBe("11102");
    expect(zipForArea("i'm in park slope", "nyc")?.zip).toBe("11215");
    expect(zipForArea("Venice", "la")?.zip).toBe("90291");
    expect(zipForArea("Astoria", "la")).toBeUndefined();
    expect(zipForArea("xy")).toBeUndefined();
  });
});

describe("unknown zips fall back gracefully", () => {
  const cfg = { ...SLOP_ENGINE_CONFIG, seed: 1 };
  const withTags = (input: EngineInput, id: MemberId, zipTag: string, extra: string[] = []): EngineInput => {
    const facets: Facet[] = input.facets.map(f => (f.memberId === id && f.tags.some(t => t.startsWith("slop:zip:")) ? { ...f, tags: [`slop:zip:${zipTag}`] } : f));
    for (const t of extra) facets.push({ id: `${id}:t:${t}`, memberId: id, kind: "fact", value: "x", tags: [t], scope: "agent_private", provenance: "inferred", confidence: 0.9 });
    return { ...input, facets };
  };

  test("an unknown zip: ask for a nearby zip or neighborhood, hold back meanwhile; a named neighborhood places them; a week of silence uses the market anchor", async () => {
    const input = slopWorld(1, { perCity: 60, extras: false });
    const pack = makeSlopPack();
    const r0 = await runEngine(input, cfg, { pack });
    const x = r0.proposals[0]!.participants[0]!;
    const market = slopProfiles(input).get(x)!.homeMarket;

    const unknown = withTags(input, x, "99999");
    const p = slopProfiles(unknown).get(x)!;
    expect(p.zipUnknown).toBe(true);
    expect(p.cell).toBeUndefined();
    expect(missingFields(p, pack.options)).toContain("zip");
    const r1 = await runEngine(unknown, cfg, { pack });
    expect(r1.asks.some(a => a.memberId === x && a.reason === "slop_zip")).toBe(true);
    expect(r1.proposals.some(pr => pr.participants.includes(x))).toBe(false);
    expect(SLOP_ASK_QUESTIONS.slop_zip).toMatch(/nearby zip/);
    expect(SLOP_ASK_QUESTIONS.slop_zip).toMatch(/neighborhood/);

    // A neighborhood they named in their market: placed on that neighborhood's cell, no ask.
    const hood = of(market).find(z => z.zip !== MARKET_ANCHOR_ZIP[market])!;
    const named = withTags(input, x, "99999", [`slop:area:${hood.area.split(" / ")[0]!.toLowerCase().replace(/ /g, "_")}`]);
    const pn = slopProfiles(named).get(x)!;
    expect(pn.zipUnknown).toBe(false);
    expect(pn.cell).toBeDefined();
    expect(missingFields(pn, pack.options)).not.toContain("zip");
    expect((await runEngine(named, cfg, { pack })).asks.some(a => a.memberId === x && a.reason === "slop_zip")).toBe(false);

    // A corrected zip wins over the unknown one.
    const fixed = withTags(input, x, "99999", ["slop:zip:11102"]);
    expect(slopProfiles(fixed).get(x)!.cell).toEqual(cellOfZip("11102"));

    // Asked a week ago, no answer: not a lockout; the market's anchor cell stands in.
    const silent = { ...unknown, recentAsks: [{ memberId: x, reason: "slop_zip", at: input.now - 8 * DAY }] };
    const ps = slopProfiles(silent).get(x)!;
    expect(missingFields(ps, pack.options)).not.toContain("zip");
    expect(cellIn(ps, market)).toEqual(cellOfZip(MARKET_ANCHOR_ZIP[market]));
  });
});
