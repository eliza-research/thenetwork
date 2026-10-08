// peonPack-specific checks on top of the shared conformance suite (peon-conformance.test.ts):
// the protected-attribute firewall (proxies and adult ages never move the output), no unverified /
// scam-cued / no-pay-range employers, no minors, current-employer blocking, candidate-first consent,
// unranked slates, congestion caps and a redacted judge context. No LLM calls.
import { describe, expect, test } from "bun:test";
import { canBeMatched } from "@thenetwork/core";
import { startProbeFlowFor } from "../src/attention.ts";
import { resolveConfig } from "../src/config.ts";
import { localEmbed } from "../src/embed.ts";
import { runEngine, type EngineResult } from "../src/engine.ts";
import { validatePack } from "../src/pack.ts";
import { buildSlate } from "../src/packs/peon/copy.ts";
import { PEON_ENGINE_CONFIG, peonPack } from "../src/packs/peon/index.ts";
import { peonJudgeContext } from "../src/packs/peon/judge.ts";
import { candidateOf, jobOf, sides } from "../src/packs/peon/profile.ts";
import { T } from "../src/packs/peon/schema.ts";
import { CONGESTION, slateCap } from "../src/packs/peon/selection.ts";
import { peonTestWorld } from "../src/packs/peon/testkit.ts";
import { Rng } from "../src/rng.ts";
import type { EngineInput } from "../src/types.ts";
import { World } from "../src/world.ts";

const SEEDS = [1, 2, 3];
const worldOf = (seed: number) => peonTestWorld({ seed, candidates: 120, jobs: 24, minorShare: 0.12 });
const run = (input: EngineInput, seed: number) => runEngine(input, { ...PEON_ENGINE_CONFIG, seed }, { pack: peonPack });
const W = (input: EngineInput, seed: number) => new World(input, resolveConfig({ ...PEON_ENGINE_CONFIG, seed }), localEmbed, peonPack);
/** Everything a proposal carries that a member or the selector could act on. */
const projection = (r: EngineResult) => JSON.stringify(r.proposals.map(p => ({ id: p.id, participants: p.participants, score: p.score, components: p.components, explanations: p.explanations, objective: p.objective, rank: p.selectorRank })));

/** Rewrite every proxy facet (zip, graduation year, gaps) and every name; give adults random real ages. */
function perturbProxies(input: EngineInput, seed: number): EngineInput {
  const rng = new Rng(seed * 7919);
  return {
    ...input,
    members: input.members.map(m => ({ ...m, name: `Zed${rng.int(1e6)} Q${rng.int(1e6)}`, age: canBeMatched(m.age) ? 18 + rng.int(55) : m.age })),
    facets: input.facets.map(f => f.tags.some(t => t.startsWith(T.proxy))
      ? { ...f, value: `proxy ${rng.int(1e9)}`, tags: f.tags.map(t => (t.startsWith(T.proxy) ? `${t.split(":").slice(0, 3).join(":")}:${rng.int(1e5)}` : t)) }
      : f),
  };
}

describe("peonPack", () => {
  test("registers: valid pack, match age 18, 13-17 tier never matchable", () => {
    expect(() => validatePack(peonPack)).not.toThrow();
    expect(peonPack.eligibility.minMatchAge).toBe(18);
    expect(peonPack.eligibility.accountTiers.every(t => t.matchable === false && t.maxAge < 18)).toBe(true);
  });

  test("firewall: changing proxies (zip, graduation year, gaps), names and adults' ages changes nothing in the output", async () => {
    for (const seed of SEEDS) {
      const input = worldOf(seed);
      const a = await run(input, seed), b = await run(perturbProxies(input, seed), seed);
      expect(a.proposals.length).toBeGreaterThan(0);
      expect(projection(b)).toBe(projection(a));
      expect(JSON.stringify(b.runLog.scored)).toBe(JSON.stringify(a.runLog.scored));
    }
  });

  test("firewall: proxies never reach the profile reader, explanations or the judge context", async () => {
    const input = worldOf(1);
    const w = W(input, 1);
    const r = await run(input, 1);
    const proxyValues = input.facets.filter(f => f.tags.some(t => t.startsWith(T.proxy))).map(f => f.value);
    const names = input.members.map(m => m.name);
    for (const p of r.proposals) {
      const s = sides(w, p.participants)!;
      const ctx = JSON.stringify(peonJudgeContext(w, { participants: p.participants } as never).context);
      const text = JSON.stringify(p.explanations) + ctx;
      for (const v of [...proxyValues, ...names]) expect(text.includes(v)).toBe(false);
      expect(ctx).not.toMatch(/zip|grad|gap|"age"|name/i);
      expect(JSON.stringify([...s.cand.skills.keys(), s.cand.families, [...s.cand.areas]])).not.toMatch(/proxy|zip|grad_year|gap_months/);
    }
  });

  test("never proposes minors, unverified or scam-cued employers, jobs without a pay range, or an excluded company", async () => {
    for (const seed of SEEDS) {
      const input = worldOf(seed);
      const w = W(input, seed);
      const r = await run(input, seed);
      for (const p of r.proposals) {
        for (const id of [...p.participants, ...p.alternates]) expect(canBeMatched(w.get(id)!.m.age)).toBe(true);
        const s = sides(w, p.participants)!;
        expect(s).not.toBeNull();
        expect(s.job.verified).toBe(true);
        expect(s.job.scamCue).toBe(false);
        expect(s.job.payMax).toBeDefined();
        expect(s.cand.excluded.has(s.job.company!)).toBe(false);
        expect(s.cand.floor! <= s.job.payMax!).toBe(true);
      }
      // Positive control: the world has every kind of bad job and excluded company.
      const js = w.ids.map(id => jobOf(w, id)).filter(Boolean);
      expect(js.some(j => !j!.verified) && js.some(j => j!.payMax === undefined)).toBe(true);
      expect(w.ids.some(id => !canBeMatched(w.get(id)!.m.age) && candidateOf(w, id))).toBe(true);
    }
  });

  test("consent: candidate first (application flow); the employer is probed only after the candidate's yes", async () => {
    const r = await run(worldOf(2), 2);
    for (const p of r.proposals) {
      const f = startProbeFlowFor(p, peonPack);
      expect(p.roles[f.first]).toBe("seeker");
      expect(f.stage).toBe("probing_first");
    }
    expect(peonPack.consent.default.kind).toBe("application");
  });

  test("congestion: per-job intros within the slate cap, at most 3 roles per candidate per run", async () => {
    for (const seed of SEEDS) {
      const input = worldOf(seed);
      const w = W(input, seed);
      const r = await run(input, seed);
      const perJob = new Map<string, number>(), perCand = new Map<string, number>();
      for (const p of r.proposals) { const s = sides(w, p.participants)!; perJob.set(s.job.id, (perJob.get(s.job.id) ?? 0) + 1); perCand.set(s.cand.id, (perCand.get(s.cand.id) ?? 0) + 1); }
      for (const [j, n] of perJob) expect(n).toBeLessThanOrEqual(slateCap(w, jobOf(w, j)!));
      for (const n of perCand.values()) expect(n).toBeLessThanOrEqual(CONGESTION.candidateWeekly);
    }
  });

  test("the core exposure floor applies the pack's hook: slate caps hold with the floor on", async () => {
    for (const seed of SEEDS) {
      const input = worldOf(seed);
      const w = W(input, seed);
      const r = await runEngine(input, { ...PEON_ENGINE_CONFIG, seed, selection: { ...PEON_ENGINE_CONFIG.selection, exposureFloorShare: 0.25 } as never }, { pack: peonPack });
      expect(r.proposals.length).toBeGreaterThan(0);
      const perJob = new Map<string, number>();
      for (const p of r.proposals) { const s = sides(w, p.participants)!; perJob.set(s.job.id, (perJob.get(s.job.id) ?? 0) + 1); }
      for (const [j, n] of perJob) expect(n).toBeLessThanOrEqual(slateCap(w, jobOf(w, j)!));
    }
  });

  test("new employers are rate-limited: before any answer, a company gets at most ceil(probationProbes / seats) probes per seat", async () => {
    for (const seed of SEEDS) {
      const input = worldOf(seed); // no interaction history: every company is new
      const w = W(input, seed);
      const r = await run(input, seed);
      const perJob = new Map<string, number>();
      for (const p of r.proposals) { const s = sides(w, p.participants)!; perJob.set(s.job.id, (perJob.get(s.job.id) ?? 0) + 1); }
      const seats = new Map<string, number>();
      for (const id of w.ids) { const j = jobOf(w, id); if (j?.open && j.company) seats.set(j.company, (seats.get(j.company) ?? 0) + 1); }
      for (const [j, n] of perJob) expect(n).toBeLessThanOrEqual(Math.ceil(CONGESTION.probationProbes / seats.get(jobOf(w, j)!.company!)!));
    }
  });

  test("slates are unranked: seeded random order, must-have checkmarks, no names or scores", async () => {
    const input = worldOf(3);
    const w = W(input, 3);
    const r = await run(input, 3);
    const byJob = new Map<string, string[]>();
    for (const p of r.proposals) { const s = sides(w, p.participants)!; if (!byJob.has(s.job.id)) byJob.set(s.job.id, []); byJob.get(s.job.id)!.push(s.cand.id); }
    const [jobId, cands] = [...byJob.entries()].sort((a, b) => b[1].length - a[1].length)[0]!;
    const job = jobOf(w, jobId)!;
    const orders = new Set([1, 2, 3, 4, 5, 6].map(k => buildSlate(w, job, cands, new Rng(k)).map(e => e.candidate).join()));
    if (cands.length >= 3) expect(orders.size).toBeGreaterThan(1); // not ranked by any score
    expect(buildSlate(w, job, cands, new Rng(9)).map(e => e.candidate).join()).toBe(buildSlate(w, job, [...cands].reverse(), new Rng(9)).map(e => e.candidate).join());
    for (const e of buildSlate(w, job, cands, new Rng(1))) {
      expect(e.checks.length).toBe(job.must.length);
      expect(e.summary).not.toMatch(/score|rank|percent|%/i);
      for (const n of input.members.map(m => m.name)) expect(e.summary.includes(n)).toBe(false);
    }
  });
});
