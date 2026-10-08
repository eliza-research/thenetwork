// The peon block: peon.biz in the hiring world (400 candidates and 80 jobs per city, NYC and SF,
// world realism v2), the official launch gates (adopted 2026-10-08, all blocking) against the keyword
// job board and the hidden-truth oracle on the same seeds, the world's own invariants (no sealed
// attribute or hidden truth in the snapshot, sealed-attribute invariance, the four-fifths check has
// teeth), and the conformance rules for peonPack on peon worlds.
// PINNED (CI): seeds 13-16, 8 weeks (docs/results/2026-10-08-peon-pack.md, iteration 3 held-out).
// --quick: seed 13, 4 weeks; only the safety gates block.
import { canBeMatched } from "../../packages/core/src/index.ts";
import { PEON_ENGINE_CONFIG, peonPack } from "../../packages/engine/src/packs/peon/index.ts";
import { peonTestWorld } from "../../packages/engine/src/packs/peon/testkit.ts";
import { ARMS } from "../../packages/sim/src/apps/peon/arms.ts";
import { keywordMatcher, packMatcher } from "../../packages/sim/src/apps/peon/baselines.ts";
import { officialGates } from "../../packages/sim/src/apps/peon/gates.ts";
import { peonMetrics, type PeonMetrics } from "../../packages/sim/src/apps/peon/metrics.ts";
import { generatePeonPopulation, type PeonPopulation } from "../../packages/sim/src/apps/peon/persona.ts";
import { buildPeonSnapshot, PEON_WORLD_START, type PeonNetworkState } from "../../packages/sim/src/apps/peon/snapshot.ts";
import { REALISM_V2, runPeonWorld } from "../../packages/sim/src/apps/peon/world.ts";
import { conformance } from "./conformance.ts";
import { Block, digest, expect } from "./gate.ts";

export const PEON_PINNED = { seeds: [13, 14, 15, 16], weeks: 8 };
const SAFETY = new Set(["scam_reach", "minors", "unverified", "pay_range"]);

const emptyState = (pop: PeonPopulation, week = 0): PeonNetworkState => ({
  now: PEON_WORLD_START + week * 7 * 86_400_000, week, interactions: [], recentProposals: [], safetyHolds: [], edges: [], feedbackFacets: [],
  hired: new Set(), exited: new Set(), openings: new Map(pop.jobs.map(j => [j.id, j.openings])), feedback: [],
});

export async function peonBlock(b: Block, o: { quick: boolean }): Promise<void> {
  const spec = o.quick ? { seeds: [13], weeks: 4 } : PEON_PINNED;
  const all: Record<"pack" | "keyword" | "oracle", PeonMetrics[]> = { pack: [], keyword: [], oracle: [] };
  for (const arm of ["pack", "keyword", "oracle"] as const) for (const seed of spec.seeds) {
    all[arm].push(peonMetrics(await runPeonWorld({ seed, perCity: 400, jobsPerCity: 80, weeks: spec.weeks, matcher: ARMS[arm]!.matcher, realism: REALISM_V2 })));
  }
  b.track("fingerprint: pack, keyword and oracle arms", true, digest(all));
  for (const g of officialGates(all.pack, all.keyword, all.oracle)) b.gate(`gate ${g.gate}`, g.pass, g.value, SAFETY.has(g.id) || !o.quick);
  b.gate("positive control: the keyword board reaches unverified, no-range and scam jobs", all.keyword.some(m => m.safety.unverifiedIntros > 0) && all.keyword.some(m => m.safety.noRangeIntros > 0) && all.keyword.some(m => m.safety.scamIntros > 0));

  await b.run("world: the snapshot carries no sealed attribute or hidden truth; canaries and proxies only agent_private", () => {
    const pop = generatePeonPopulation({ seed: 5 });
    const snap = buildPeonSnapshot(pop, emptyState(pop, 6));
    const json = JSON.stringify(snap);
    for (const k of ["\"sex\"", "race", "disability", "caregiver", "trueAge", "isMinor", "intensity", "replyProb", "retention", "barShift", "appeal", "reviewCap", "\"fake\"", "\"truth\"", "\"hidden\"", "discriminatory\"", "\"scam\""]) expect(json).not.toContain(k);
    for (const c of pop.candidates) expect(snap.facets.filter(f => f.memberId === c.id && f.value.includes(c.truth.canary)).every(f => f.scope === "agent_private")).toBe(true);
    for (const m of snap.members) if (canBeMatched(m.age)) expect(m.age).toBe(18);
    for (const f of snap.facets) if (f.tags.some(t => t.startsWith("peon:proxy:"))) expect(f.scope).toBe("agent_private");
    const p2 = structuredClone(pop);
    for (const [id, s] of p2.sealed) p2.sealed.set(id, { sex: s.sex === "f" ? "m" : "f", race: "d", age: 70 - (s.age % 40), disability: !s.disability, caregiver: !s.caregiver });
    for (const c of p2.candidates) { c.truth.payFloor *= 1.3; c.truth.intensity = 0.5; c.truth.retention = 2; for (const k of Object.keys(c.truth.skills)) c.truth.skills[k] = 5; }
    for (const j of p2.jobs) { j.hidden.appeal = -j.hidden.appeal; j.hidden.barShift = 1; }
    expect(JSON.stringify(buildPeonSnapshot(p2, emptyState(p2, 6)))).toBe(json);
  });

  await b.run("world: sealed-attribute invariance end to end (the pack's intros do not move when sealed attributes change)", async () => {
    const pop = generatePeonPopulation({ seed: 2 });
    for (const co of pop.companies) if (co.adversary === "discriminatory") { co.adversary = undefined; co.target = undefined; co.discriminatoryRequest = false; }
    const p2 = structuredClone(pop);
    for (const [id, s] of p2.sealed) p2.sealed.set(id, { ...s, sex: s.sex === "f" ? "m" : s.sex === "m" ? "x" : "f", race: (["b", "c", "d", "a"] as const)[["a", "b", "c", "d"].indexOf(s.race)]!, age: s.age < 18 ? s.age : 18 + ((s.age + 25) % 50), disability: !s.disability });
    const m = packMatcher({ audit: "off" });
    const a = await runPeonWorld({ seed: 2, weeks: 3, pop, matcher: m }), c = await runPeonWorld({ seed: 2, weeks: 3, pop: p2, matcher: m });
    expect(a.flows.length).toBeGreaterThan(100);
    expect(JSON.stringify(c.flows.map(f => [f.key, f.yes, f.employerYes, f.interviewed]))).toBe(JSON.stringify(a.flows.map(f => [f.key, f.yes, f.employerYes, f.interviewed])));
  });

  if (!o.quick) await b.run("negative control: the four-fifths check catches a proxy screen (graduation year) the pack never applies", async () => {
    const leak = peonMetrics(await runPeonWorld({ seed: 1, matcher: ARMS["proxy-leak"]!.matcher }));
    const pack = peonMetrics(await runPeonWorld({ seed: 1, matcher: packMatcher() }));
    expect(leak.impact.ratio["offered|assessed"]!.age40!).toBeLessThan(0.8);
    expect(pack.impact.ratio["offered|assessed"]!.age40!).toBeGreaterThanOrEqual(0.8);
    void keywordMatcher;
  });

  // Conformance on two kinds of peon world: the engine's hiring world, and the simulated snapshot (minors 13-17, canaries).
  await conformance(b, peonPack, { world: seed => peonTestWorld({ seed, candidates: 90, jobs: 20, minorShare: 0.15 }), cfg: PEON_ENGINE_CONFIG, seeds: o.quick ? [1, 2] : [1, 2, 3, 4], label: "hiring world" });
  await conformance(b, peonPack, {
    seeds: [1, 2], cfg: PEON_ENGINE_CONFIG, label: "simulated snapshot",
    world: seed => { const pop = generatePeonPopulation({ seed, perCity: 120, jobsPerCity: 30, minorShare: 0.08 }); return buildPeonSnapshot(pop, emptyState(pop, 6)); },
  });
}
