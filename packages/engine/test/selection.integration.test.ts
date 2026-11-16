// Global selection (spec/selectionRun.md) through the real engine: every pass, exploration
// included, respects the pack's refusal (upstream PR #489), and greedy refusals leave no blocking pair.
import { expect, test } from "vitest";
import { DAY, type Facet } from "@thenetwork/core";
import { runEngine } from "../src/engine.ts";
import { PEON_ENGINE_CONFIG, peonPack } from "../src/packs/peon/index.ts";
import { JOB_INTENT, T } from "../src/packs/peon/schema.ts";
import { randomWorld } from "../src/testkit.ts";
import type { EngineInput } from "../src/types.ts";

function seatWorld(nJobs: number): EngineInput {
  const now = Date.UTC(2026, 9, 12, 12);
  const input: EngineInput = { now, members: [], facets: [], intents: [], presence: [], edges: [], recentProposals: [], interactions: [] };
  for (let k = 0; k < nJobs + 24; k++) {
    const job = k < nJobs, id = job ? `j${k}` : `c${k - nJobs}`;
    input.members.push({ id, name: `Synthetic ${id}`, age: 30, homeCity: "nyc", state: "open", joinedAt: now - 40 * DAY, unansweredProactive: 0,
      prefs: { categoriesOptIn: ["professional"], quietHours: [22, 8], romanceOptIn: false, formats: ["one_to_one"], maxTravelMinutes: 45, onlyWhenAsked: false } });
    input.presence.push({ memberId: id, city: "nyc", type: "home", areas: ["manhattan"] });
    const add = (tags: string[], value: string, kind: Facet["kind"] = "fact") => input.facets.push({ id: `${id}-f${input.facets.length}`, memberId: id, kind, value, tags, scope: "shareable", confidence: 1, provenance: "said" });
    add([`${T.entity}${job ? "job" : "candidate"}`], job ? "Hiring role" : "Looking for work");
    add([`${T.family}software_engineer`, `${T.seniority}2`, `${T.mode}remote`], "Remote software engineering");
    if (job) {
      add([`${T.company}${id}`, T.verified, `${T.pay}100-150`, `${T.openings}10`, `${T.seatCap}1`, `${T.urgency}1`, `${T.sponsors}yes`], "Verified company, salary 100-150k");
      add([`${T.must}python:2`], "Python required", "skill");
    } else {
      add([`${T.skill}python:5:demonstrated`], "Python developer", "skill");
      add([`${T.floor}60`, `${T.auth}yes`, `${T.needsSponsor}no`], "Authorized to work, minimum 60k");
    }
    input.intents.push({ id: `${id}-intent`, memberId: id, category: "professional", objective: job ? "Hire a software engineer" : "Find a software engineering role",
      details: job ? JOB_INTENT : "peon:search", status: "active", createdAt: now - DAY, horizonDays: 90 });
  }
  return input;
}

test("exploration respects the pack's cap: each job gets at most its one remaining opening", async () => {
  for (const seed of [1, 2, 3]) for (const rate of [0, 0.125]) {
    const result = await runEngine(seatWorld(40), { ...PEON_ENGINE_CONFIG, seed, exploration: { rate, maxShare: 0.15 } }, { pack: peonPack });
    const perJob = new Map<string, number>();
    for (const p of result.proposals) {
      const job = p.participants.find(id => id.startsWith("j"))!;
      perJob.set(job, (perJob.get(job) ?? 0) + 1);
    }
    expect(Math.max(...perJob.values())).toBe(1);
    expect(perJob.size).toBe(40);
    if (rate) expect(result.proposals.some(p => p.exploration)).toBe(true);
    expect(result.runLog.blockingPairs).toBe(0);
  }
});

test("greedy selection leaves no blocking pair and keeps exploration within its share", async () => {
  for (const seed of [1, 2]) {
    const result = await runEngine(randomWorld({ seed, members: 120, minors: false }), { seed });
    expect(result.proposals.length).toBeGreaterThan(0);
    expect(result.runLog.blockingPairs).toBe(0);
    expect(result.proposals.filter(p => p.exploration).length).toBeLessThanOrEqual(Math.floor(0.15 * result.proposals.length));
  }
});
