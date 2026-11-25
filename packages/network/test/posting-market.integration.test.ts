// A job posting's market tag decides which city's members the engine may match it with.
// The service accepts an arbitrary area, so a posting can be outside the launch city.
import { describe, expect, test } from "vitest";
import { postingFacts, postingFromFacts, postingProblem, postingRevision, type JobPosting } from "../src/jobs.ts";

const base = (over: Partial<JobPosting> = {}): JobPosting => ({
  id: "post-1", managerId: "mgr", title: "Cook", family: "cook",
  openings: 1, payMin: 25, payMax: 35, mode: "onsite", area: "mission_district",
  must: [], nice: [], status: "active", createdAt: 1, updatedAt: 2,
  ...over,
});

describe("posting market tag", () => {
  test("a posting outside the launch city carries its own market, not a hardcoded nyc", () => {
    const { facets } = postingFacts(base({ area: "mission_district", market: "sf" }));
    const tags = facets.flatMap(f => f.tags);
    expect(tags).toContain("peon:market:sf");
    expect(tags).not.toContain("peon:market:nyc");
  });

  test("a posting with no explicit market keeps the nyc default", () => {
    const tags = postingFacts(base({ area: "greenpoint" })).facets.flatMap(f => f.tags);
    expect(tags).toContain("peon:market:nyc");
  });

  test("the market survives a facts round trip", () => {
    const p = base({ market: "sf" });
    const { intent, facets } = postingFacts(p);
    expect(intent.objective).toBe("Hire: Cook");
    expect(postingFromFacts(intent, facets).market).toBe("sf");
  });

  test("a stale yes cannot reuse a revision after the market changes", () => {
    expect(postingRevision(base())).not.toBe(postingRevision(base({ market: "sf" })));
  });

  test("an invalid market is rejected at the staff boundary", () => {
    expect(postingProblem(base({ market: "sf" }))).toBeUndefined();
    expect(postingProblem(base({ market: "moon" } as unknown as JobPosting))).toBe("invalid_market");
  });
});
