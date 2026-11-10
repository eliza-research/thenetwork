import { expect, test } from "bun:test";
import { keywordMatcher } from "../src/apps/peon/baselines.ts";
import { REALISM_V1, REALISM_V2, runPeonWorld } from "../src/apps/peon/world.ts";

test("Peon employer review stops the current batch when a report or relay screen holds the company", async () => {
  for (const realism of [REALISM_V1, REALISM_V2]) for (const relayScreen of [false, true]) {
    const result = await runPeonWorld({ seed: 1, weeks: 4, perCity: 80, jobsPerCity: 30,
      realism, matcher: { ...keywordMatcher, relayScreen } });
    expect(result.heldCompanies.size).toBe(1);
    for (const company of result.heldCompanies) {
      const jobs = new Set(result.world.pop.jobs.filter(j => j.company === company).map(j => j.id));
      const reports = result.world.state.edges.filter(e => e.type === "blocked" && jobs.has(e.to));
      const reviewed = result.flows.filter(f => f.reviewed && jobs.has(f.job));
      expect(reports.length, `${realism.name}, relay=${relayScreen}`).toBeLessThanOrEqual(1);
      if (relayScreen) expect({ reviewed: reviewed.length, contacts: reviewed.filter(f => f.scamContact).length })
        .toEqual({ reviewed: 1, contacts: 0 });
      else expect(reports.length).toBe(1);
    }
  }
}, 20000);
