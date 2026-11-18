import { expect, test } from "bun:test";
import { auditCompanies } from "../src/apps/peon/audit.ts";
import { packMatcher } from "../src/apps/peon/baselines.ts";
import { generatePeonPopulation } from "../src/apps/peon/persona.ts";
import { REALISM_V1, REALISM_V2, runPeonWorld } from "../src/apps/peon/world.ts";

test("Peon audits late arrivals in both realism profiles and honors flag, hold and off modes", async () => {
  for (const realism of [REALISM_V1, REALISM_V2]) for (const audit of ["flag", "hold", "off"] as const) {
    const pop = generatePeonPopulation({ seed: 7, perCity: 200, jobsPerCity: 40 });
    for (const c of pop.candidates) c.joinWeek += 8;
    for (const j of pop.jobs) j.postedWeek += 8;
    const r = await runPeonWorld({ seed: 7, weeks: 16, pop, realism, matcher: packMatcher({ audit }) });
    const auditHolds = r.world.state.safetyHolds.filter(h => h.reason?.startsWith("audit:"));
    if (audit === "off") {
      expect(r.audits).toEqual([]);
      expect(auditHolds).toEqual([]);
      continue;
    }
    // Months one and two precede all arrivals. Months three and four contain real employer decisions.
    expect(r.audits).toHaveLength(4);
    expect(r.audits.slice(0, 2)).toEqual([[], []]);
    expect(r.audits.at(-1)).toEqual(auditCompanies(r.flows, r.world));
    const flagged = new Set(r.audits.flat().map(f => f.company));
    expect(flagged.has("co-sf-19")).toBe(true);
    if (audit === "flag") expect(auditHolds).toEqual([]);
    else for (const job of pop.jobs.filter(j => flagged.has(j.company))) {
      expect(r.heldCompanies.has(job.company)).toBe(true);
      expect(auditHolds.some(h => h.memberId === job.id)).toBe(true);
    }
  }
});
