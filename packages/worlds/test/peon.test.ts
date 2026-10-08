// peon.biz world: determinism, no sealed attribute or hidden truth in snapshots, sealed-attribute
// invariance end to end, minors, oracle sanity, the pack's safety in the harness, the four-fifths
// check (it must catch a proxy screen), and the shared conformance suite on a simulated snapshot.
import { describe, expect, test } from "bun:test";
import { canBeMatched } from "@thenetwork/core";
import { PEON_ENGINE_CONFIG, peonPack } from "@thenetwork/engine/src/packs/peon/index.ts";
import { runConformance } from "../../engine/test/conformance.ts";
import {
  ARMS, PEON_WORLD_START, REALISM_V1, historicalGates, officialGates, buildPeonSnapshot, createPeonWorld, generatePeonPopulation, keywordMatcher, packMatcher, peonMetrics, runPeonWorld,
  type PeonNetworkState, type PeonPopulation,
} from "../src/peon/index.ts";

const emptyState = (pop: PeonPopulation, week = 0): PeonNetworkState => ({
  now: PEON_WORLD_START + week * 7 * 86_400_000, week, interactions: [], recentProposals: [], safetyHolds: [], edges: [], feedbackFacets: [],
  hired: new Set(), exited: new Set(), openings: new Map(pop.jobs.map(j => [j.id, j.openings])), feedback: [],
});
const clone = <T>(x: T): T => structuredClone(x);

describe("peon population", () => {
  test("deterministic by seed; 400 candidates and 80 jobs per city", () => {
    const a = generatePeonPopulation({ seed: 3 }), b = generatePeonPopulation({ seed: 3 });
    expect(JSON.stringify(a.candidates)).toBe(JSON.stringify(b.candidates));
    expect(JSON.stringify(a.jobs)).toBe(JSON.stringify(b.jobs));
    expect(JSON.stringify(generatePeonPopulation({ seed: 4 }).candidates)).not.toBe(JSON.stringify(a.candidates));
    expect(a.candidates.length).toBe(800);
    expect(a.jobs.length).toBe(160);
    expect(a.jobs.some(j => j.mode === "remote")).toBe(true);
  });

  test("adversaries, minors and the proxy correlation exist (positive controls)", () => {
    const p = generatePeonPopulation({ seed: 1 });
    expect(p.candidates.filter(c => c.truth.isMinor).length).toBeGreaterThan(10);
    expect(p.candidates.filter(c => c.truth.fake).length).toBeGreaterThan(10);
    expect(p.companies.some(c => c.adversary === "scam")).toBe(true);
    // Scams that pass verification (impersonating a real brand) are rare: about one per seed.
    expect([1, 2, 3, 4, 5, 6, 7, 8].some(s => generatePeonPopulation({ seed: s }).companies.some(c => c.adversary === "scam" && c.verified))).toBe(true);
    expect(p.companies.some(c => c.adversary === "discriminatory")).toBe(true);
    // Residential segregation: home area depends on the sealed race group (a proxy a matcher must not use).
    const share = (race: string, area: string) => { const xs = p.candidates.filter(c => p.sealed.get(c.id)!.race === race && c.market === "nyc"); return xs.filter(c => c.homeArea === area).length / xs.length; };
    expect(share("b", "bronx")).toBeGreaterThan(2 * share("a", "bronx"));
    // Graduation year tracks age.
    const older = p.candidates.filter(c => p.sealed.get(c.id)!.age >= 40 && c.proxies.gradYear);
    expect(older.every(c => c.proxies.gradYear! <= 2026 - 40 + 24)).toBe(true);
  });
});

describe("snapshot: no sealed attribute, no hidden truth", () => {
  const pop = generatePeonPopulation({ seed: 5 });
  const snap = buildPeonSnapshot(pop, emptyState(pop, 6));
  const json = JSON.stringify(snap);

  test("no sealed attribute, true age, adversary label or hidden field; canaries only agent_private", () => {
    for (const k of ["\"sex\"", "race", "disability", "caregiver", "trueAge", "isMinor", "intensity", "replyProb", "retention", "barShift", "appeal", "reviewCap", "\"fake\"", "\"truth\"", "\"hidden\"", "discriminatory\"", "\"scam\""]) expect(json).not.toContain(k);
    for (const c of pop.candidates) {
      const facets = snap.facets.filter(f => f.memberId === c.id && f.value.includes(c.truth.canary));
      expect(facets.every(f => f.scope === "agent_private")).toBe(true);
    }
    // Adults carry an 18+ confirmation, never their age.
    for (const m of snap.members) if (canBeMatched(m.age)) expect(m.age).toBe(18);
    // Proxies are agent_private only.
    for (const f of snap.facets) if (f.tags.some(t => t.startsWith("peon:proxy:"))) expect(f.scope).toBe("agent_private");
  });

  test("changing sealed attributes and hidden truth leaves the snapshot byte-identical", () => {
    const p2 = clone(pop);
    for (const [id, s] of p2.sealed) p2.sealed.set(id, { sex: s.sex === "f" ? "m" : "f", race: "d", age: 70 - (s.age % 40), disability: !s.disability, caregiver: !s.caregiver });
    for (const c of p2.candidates) { c.truth.payFloor *= 1.3; c.truth.intensity = 0.5; c.truth.retention = 2; for (const k of Object.keys(c.truth.skills)) c.truth.skills[k] = 5; }
    for (const j of p2.jobs) { j.hidden.appeal = -j.hidden.appeal; j.hidden.barShift = 1; }
    for (const co of p2.companies) if (co.adversary === "discriminatory") co.target = { attr: "sex", value: "m" };
    expect(JSON.stringify(buildPeonSnapshot(p2, emptyState(p2, 6)))).toBe(json);
  });
});

describe("harness", () => {
  test("sealed-attribute invariance end to end: the pack's intros do not move when sealed attributes change (no discriminatory employers)", async () => {
    const pop = generatePeonPopulation({ seed: 2 });
    for (const co of pop.companies) if (co.adversary === "discriminatory") { co.adversary = undefined; co.target = undefined; co.discriminatoryRequest = false; }
    const p2 = clone(pop);
    for (const [id, s] of p2.sealed) p2.sealed.set(id, { ...s, sex: s.sex === "f" ? "m" : s.sex === "m" ? "x" : "f", race: (["b", "c", "d", "a"] as const)[["a", "b", "c", "d"].indexOf(s.race)]!, age: s.age < 18 ? s.age : 18 + ((s.age + 25) % 50), disability: !s.disability });
    const m = packMatcher({ audit: "off" });
    const a = await runPeonWorld({ seed: 2, weeks: 3, pop, matcher: m }), b = await runPeonWorld({ seed: 2, weeks: 3, pop: p2, matcher: m });
    expect(a.flows.length).toBeGreaterThan(100);
    expect(JSON.stringify(b.flows.map(f => [f.key, f.yes, f.employerYes, f.interviewed]))).toBe(JSON.stringify(a.flows.map(f => [f.key, f.yes, f.employerYes, f.interviewed])));
  }, 60_000);

  test("the pack: 0 minors, 0 unverified, 0 no-range, 0 scam intros; keyword baseline reaches all of them (positive control)", async () => {
    const p = peonMetrics(await runPeonWorld({ seed: 1, weeks: 4, matcher: packMatcher() }));
    const k = peonMetrics(await runPeonWorld({ seed: 1, weeks: 4, matcher: keywordMatcher }));
    expect(p.safety.minorsMatched).toBe(0);
    expect(p.safety.unverifiedIntros).toBe(0);
    expect(p.safety.noRangeIntros).toBe(0);
    expect(p.safety.scamIntros).toBe(0);
    expect(p.hires).toBeGreaterThan(0);
    expect(k.safety.unverifiedIntros).toBeGreaterThan(0);
    expect(k.safety.noRangeIntros).toBeGreaterThan(0);
    expect(k.safety.scamIntros).toBeGreaterThan(0);
  }, 60_000);

  test("the four-fifths check catches a proxy screen (graduation year) that the pack itself never applies", async () => {
    const leak = ARMS["proxy-leak"]!;
    const a = peonMetrics(await runPeonWorld({ seed: 1, matcher: leak.matcher }));
    const p = peonMetrics(await runPeonWorld({ seed: 1, matcher: packMatcher() }));
    expect(a.impact.ratio["offered|assessed"]!.age40!).toBeLessThan(0.8);
    expect(p.impact.ratio["offered|assessed"]!.age40!).toBeGreaterThanOrEqual(0.8);
  }, 60_000);

  test("iteration-2 realism: fatigue lowers replies to a 10-a-week channel, recruiter hours are spent, roles close; v1 has none of it", async () => {
    const k10 = await runPeonWorld({ seed: 3, weeks: 4, matcher: keywordMatcher });
    const k3 = await runPeonWorld({ seed: 3, weeks: 4, matcher: ARMS.keyword3!.matcher });
    const v1 = await runPeonWorld({ seed: 3, weeks: 4, matcher: keywordMatcher, realism: REALISM_V1 });
    const m10 = peonMetrics(k10), m3 = peonMetrics(k3), m1 = peonMetrics(v1);
    expect(m10.replyRate).toBeLessThan(m3.replyRate - 0.05);
    expect(k10.recruiterHours).toBeGreaterThan(0);
    expect(m10.closedDeadline + m10.closedExternal).toBeGreaterThan(0);
    expect(v1.recruiterHours).toBe(0);
    expect(m1.closedDeadline + m1.closedExternal).toBe(0);
    expect(m1.replyRate).toBeGreaterThan(m10.replyRate);
  }, 60_000);

  test("official gates: the adopted replacement set is evaluated against keyword and the oracle; historical gates are kept", async () => {
    const run = async (m: Parameters<typeof runPeonWorld>[0]["matcher"]) => peonMetrics(await runPeonWorld({ seed: 2, weeks: 4, matcher: m }));
    const p = [await run(packMatcher())], k = [await run(keywordMatcher)], o = [await run(ARMS.oracle!.matcher)];
    const off = officialGates(p, k, o), hist = historicalGates(p, k);
    expect(off.map(g => g.id)).toEqual(["hires_vs_keyword", "hires_vs_oracle", "interviews_per_hire", "retention_90d", "under_applied", "impact_ratio", "scam_reach", "minors", "unverified", "pay_range"]);
    expect(hist.map(g => g.id)).toContain("h_hires_2x");
    for (const id of ["minors", "unverified", "pay_range"]) expect(off.find(g => g.id === id)!.pass).toBe(true);
  }, 60_000);

  test("oracle sanity: qualified pairs pass more often; scam jobs never hire; fake candidates rarely pass", () => {
    const w = createPeonWorld({ seed: 4 });
    const o = w.oracle;
    let q = 0, qn = 0, u = 0, un = 0, fake = 0, fn = 0;
    for (const c of w.pop.candidates.slice(0, 300)) for (const j of w.pop.jobs) {
      if (c.market !== j.market && j.mode !== "remote") continue;
      const p = o.pPass(c, j);
      if (c.truth.fake) { fake += p; fn++; } else if (o.qualified(c, j)) { q += p; qn++; } else { u += p; un++; }
      if (!j.hidden.real) expect(p).toBe(0);
    }
    expect(q / qn).toBeGreaterThan(4 * (u / un));
    expect(fake / fn).toBeLessThan(0.05);
  });
});

// The shared conformance suite on simulated snapshots (minors 13-17, blocks added by the suite, canaries).
runConformance(peonPack, {
  seeds: [1, 2],
  world: seed => { const pop = generatePeonPopulation({ seed, perCity: 120, jobsPerCity: 30, minorShare: 0.08 }); return buildPeonSnapshot(pop, emptyState(pop, 6)); },
  cfg: PEON_ENGINE_CONFIG,
});
