import { expect, test } from "vitest";
import { auditCompanies } from "../src/apps/peon/audit.ts";
import { packMatcher } from "../src/apps/peon/baselines.ts";
import { generatePeonPopulation } from "../src/apps/peon/persona.ts";
import { REALISM_V1, REALISM_V2, runPeonWorld } from "../src/apps/peon/world.ts";

test.each([["v1", REALISM_V1], ["v2", REALISM_V2]] as const)("Peon audits late arrivals in %s and honors flag, hold and off modes", async (_label, realism) => {
  for (const audit of ["flag", "hold", "off"] as const) {
    const pop = generatePeonPopulation({ seed: 7, perCity: 200, jobsPerCity: 40 });
    for (const c of pop.candidates) c.joinWeek += 8;
    for (const j of pop.jobs) j.postedWeek += 8;
    // Positive control: an identity-visible review can expose enough actual decisions to flag.
    // The weekly matching, employer decisions, audit schedule, and holds still run normally.
    for (const company of pop.companies) {
      if (!company.verified || company.adversary === "scam") continue;
      company.adversary = "discriminatory";
      company.target = { attr: "sex", value: "f" };
      company.discriminatoryRequest = false;
    }
    const matcher = { ...packMatcher({ audit }), blindReview: false };
    const r = await runPeonWorld({ seed: 7, weeks: 16, pop, realism, matcher });
    const auditHolds = r.world.state.safetyHolds.filter(h => h.reason?.startsWith("audit:"));
    if (audit === "off") {
      expect(r.audits).toEqual([]);
      expect(auditHolds).toEqual([]);
      continue;
    }
    // Months one and two precede all arrivals. Months three and four contain real employer decisions.
    expect(r.audits).toHaveLength(4);
    expect(r.audits.slice(0, 2)).toEqual([[], []]);
    expect(r.audits[2]!.length, audit).toBeGreaterThan(0);
    expect(r.audits.at(-1)).toEqual(auditCompanies(r.flows, r.world));
    const flagged = new Set(r.audits.flat().map(f => f.company));
    if (audit === "flag") expect(auditHolds).toEqual([]);
    else for (const job of pop.jobs.filter(j => flagged.has(j.company))) {
      expect(r.heldCompanies.has(job.company)).toBe(true);
      expect(auditHolds.some(h => h.memberId === job.id)).toBe(true);
    }
  }
});
