// The conformance sim: the core rules no app pack can loosen, run on each pack's own simulated worlds
// (minors 13-17 and unknown ages, blocks, holds, canaries, id aliases). No LLM: the judge rule uses a
// fake model that says yes to everything with top scores.
//   1. minors are never in any role (generators, proposals, alternates, via, asks, logs, attention, probes);
//   2. blocks win;
//   3. consent before reveal (no names before every participant said yes, under random answer orders);
//   4. the member-facing leak gate (canaries and other members' private facts);
//   5. filters are respected, and the judge cannot undo a hard filter.
// Plus registration (match age >= 18, adults-only lanes) and a positive control (worlds are non-trivial).
import type { ChatMessage, LLM, MemberId } from "../../packages/core/src/index.ts";
import { canBeMatched, DAY } from "../../packages/core/src/index.ts";
import * as A from "../../packages/engine/src/attention.ts";
import { resolveConfig, type EngineConfigInput } from "../../packages/engine/src/config.ts";
import { localEmbed } from "../../packages/engine/src/embed.ts";
import { runEngine, type EngineResult } from "../../packages/engine/src/engine.ts";
import { privateVocabulary } from "../../packages/engine/src/explain.ts";
import { candidateReason, involvedMembers, memberReason, pairReason } from "../../packages/engine/src/filters.ts";
import type { GenCtx } from "../../packages/engine/src/genkit.ts";
import { checkMemberFacing } from "../../packages/engine/src/judgeCommon.ts";
import { hardGate } from "../../packages/engine/src/judgeDeep.ts";
import { validatePack, type AppPack } from "../../packages/engine/src/pack.ts";
import { Rng } from "../../packages/engine/src/rng.ts";
import { randomWorld } from "../../packages/engine/src/testkit.ts";
import type { AttentionItem, EngineInput, EngineProposal } from "../../packages/engine/src/types.ts";
import { pairKey, World } from "../../packages/engine/src/world.ts";
import { Block, expect } from "./gate.ts";

export interface ConformanceOptions {
  /** World factory (default: the engine's random world with 15% minors, blocks, holds, canaries, aliases). */
  world?: (seed: number) => EngineInput;
  seeds?: number[];
  cfg?: EngineConfigInput;
  /** Names the world in the gate names when a pack runs on more than one kind of world. */
  label?: string;
}

const YES_ALL = (refs = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"]) => {
  const by = <T>(v: T) => Object.fromEntries(refs.map(r => [r, v]));
  return new (class implements LLM {
    calls = 0;
    async chat(m: ChatMessage[]) {
      this.calls++;
      const sys = m[0]?.content ?? "";
      if (/screen/i.test(sys) && /accept_probability/.test(sys)) return JSON.stringify({ reasoning: "P1.intents[0] fits.", cited_facts: [], dealbreaker: false, dealbreaker_reason: "", verdict: "yes", match_probability: 0.99, accept_probability: by(0.99), member_why: "" });
      if (/steelman/i.test(sys)) return JSON.stringify({ evidence_review: "x", steelman_for: "x", steelman_against: "x", rubric: { mutual_benefit: 5, reciprocity: 5, intent_timing: 5, logistics: 5, stage_fit: 5, values_energy: 5, novelty: 5, evidence_quality: 5, risk_safety: 5 }, would_thank_us: by("yes"), reasoning: "x", cited_facts: [], verdict: "yes", question_to_ask: null, match_probability: 0.99, member_why: by("") });
      return JSON.stringify({ reasoning: "P1 fits P2.", cited_facts: [], fit: 5, mutual_value: 5, capacity_realism: 5, timing: 5, social_comfort: 5, red_flags: 1, certainty: 5, dealbreaker: false, dealbreaker_reason: "", verdict: "yes", match_probability: 0.99, why: by("") });
    }
  })();
};

function shuffled<T>(xs: T[], rng: Rng): T[] { const a = [...xs]; rng.shuffle(a); return a; }

/** Run the conformance rules for `pack`; each rule is one blocking gate named "conformance <pack>: ...". */
export async function conformance(b: Block, pack: AppPack, o: ConformanceOptions = {}): Promise<void> {
  const seeds = o.seeds ?? [1, 2, 3, 4];
  const makeWorld = o.world ?? ((seed: number) => randomWorld({ members: 90, seed, minorShare: 0.15 }));
  const cfgIn = (seed: number): EngineConfigInput => ({ ...(o.cfg ?? {}), seed });
  const worlds = seeds.map(s => ({ seed: s, input: makeWorld(s) }));
  const world = (input: EngineInput, seed: number) => new World(input, resolveConfig(cfgIn(seed)), localEmbed, pack);
  const runs = new Map<number, Promise<EngineResult>>();
  const run = (seed: number) => {
    if (!runs.has(seed)) runs.set(seed, runEngine(worlds.find(x => x.seed === seed)!.input, cfgIn(seed), { pack }));
    return runs.get(seed)!;
  };
  const minorsOf = (input: EngineInput, w: World) => new Set(input.members.filter(m => !canBeMatched(m.age)).map(m => w.canonical(m.id)));
  const name = (rule: string) => `conformance ${pack.id}${o.label ? ` (${o.label})` : ""}: ${rule}`;

  await b.run(name("registration (match age >= 18, adults-only lanes, non-matchable minor tiers); worlds non-trivial"), async () => {
    expect(() => validatePack(pack)).not.toThrow();
    expect(pack.eligibility.minMatchAge).toBeGreaterThanOrEqual(18);
    for (const t of pack.eligibility.accountTiers) { expect(t.matchable).toBe(false); expect(t.maxAge).toBeLessThan(18); }
    expect(() => validatePack({ ...pack, eligibility: { ...pack.eligibility, minMatchAge: 16 } })).toThrow();
    for (const { seed, input } of worlds) {
      expect((await run(seed)).proposals.length).toBeGreaterThan(0);
      expect(minorsOf(input, world(input, seed)).size).toBeGreaterThan(0);
    }
  });

  await b.run(name("minors never in any role (generators, proposals, alternates, via, asks, scored log, debt, attention, probes)"), async () => {
    for (const { seed, input } of worlds) {
      const w = world(input, seed);
      const minors = minorsOf(input, w);
      const ctx: GenCtx = { w, memberExclusions: {}, rng: new Rng(seed).fork("gen"), unmatchedIntents: new Set() };
      for (const g of pack.generators) for (const c of g.run(ctx)) {
        if (involvedMembers(c).some(id => minors.has(id))) expect(candidateReason(w, { ...c, channels: new Set(c.channels) })).not.toBeNull();
      }
      const r = await run(seed);
      for (const p of r.proposals) for (const id of [...p.participants, ...p.alternates, ...(p.via ? [p.via] : [])]) expect(minors.has(id)).toBe(false);
      for (const a of r.asks) expect(minors.has(a.memberId)).toBe(false);
      for (const s of r.runLog.scored) for (const id of s.participants) expect(minors.has(id)).toBe(false);
      for (const id of Object.keys(r.runLog.exposureDebt)) expect(minors.has(id)).toBe(false);
      expect(r.runLog.funnel.rejectedAfterSelection).toBeUndefined();
      for (const id of minors) {
        expect(memberReason(w, id, { category: pack.ontology.funnelProbe.lane, role: pack.ontology.funnelProbe.role, format: "one_to_one", timeSensitive: false })).toBe("underage");
        const adult = w.ids.find(x => !minors.has(x))!;
        expect(pairReason(w, id, adult, pack.ontology.funnelProbe.lane)).toBe("underage");
        expect(hardGate(w, { participants: [adult, id], category: pack.ontology.funnelProbe.lane })).toBe("underage");
        expect(w.positive.has(id)).toBe(false);
      }
    }
    const { seed, input } = worlds[0]!;
    const w = world(input, seed);
    const minor = [...minorsOf(input, w)][0]!;
    const adult = w.ids.find(x => canBeMatched(w.get(x)!.m.age))!;
    const m: A.MemberAttention = { memberId: minor, state: "normal", age: w.get(minor)!.m.age, tz: "America/New_York", quietHours: [21, 9], onlyWhenAsked: false, prefs: A.defaultCadence("normal") };
    const it: AttentionItem = { id: "i", memberId: minor, kind: "intro_probe", category: pack.ontology.funnelProbe.lane, others: [adult], involvesMember: true, effort: "meet_short", enjoy: 0.9, accept: 0.9, urgency: { expiresAt: w.now + 5 * DAY }, createdAt: w.now, reviewState: "approved", key: "k" };
    expect(A.itemGate(m, it, w.now, pack.attention.config, pack)).not.toBeNull();
    const spec: A.ProbeSpec = { proposalId: "p", kind: "intro", category: pack.ontology.funnelProbe.lane, objective: "Intro: running", tz: "America/New_York" };
    expect(A.buildProbe(w, spec, adult, [minor], w.now)).toBeNull();
    expect(A.buildProbe(w, spec, minor, [adult], w.now)).toBeNull();
  });

  await b.run(name("blocks win (a blocked pair is never proposed together, never warm, never a via)"), async () => {
    for (const { seed, input } of worlds) {
      const r0 = await run(seed);
      const pairs = new Set<string>();
      for (const p of r0.proposals) for (let i = 0; i < p.participants.length; i++) for (let j = i + 1; j < p.participants.length; j++) pairs.add(pairKey(p.participants[i]!, p.participants[j]!));
      const blocked: EngineInput = { ...input, edges: [...input.edges, ...[...pairs].map(k => { const [a, c] = k.split("|"); return { from: a!, to: c!, type: "blocked" as const, strength: 1, explicit: true, createdAt: input.now - DAY }; })] };
      const r = await runEngine(blocked, cfgIn(seed), { pack });
      const w = world(blocked, seed);
      for (const p of r.proposals) {
        const ids = [...p.participants, ...(p.via ? [p.via] : [])];
        for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) expect(w.blocked.has(pairKey(ids[i]!, ids[j]!))).toBe(false);
      }
      for (const k of pairs) { const [a, c] = k.split("|") as [MemberId, MemberId]; expect(w.isWarm(a, c)).toBe(false); expect(pairReason(w, a, c, pack.ontology.funnelProbe.lane)).toBe("blocked"); }
    }
  });

  await b.run(name("consent before reveal (no names before every yes, random answer orders; anonymous probes)"), async () => {
    const r = await run(seeds[0]!);
    const w = world(worlds[0]!.input, seeds[0]!);
    const rng = new Rng(99);
    for (const p of r.proposals) {
      const P = p as EngineProposal;
      for (let trial = 0; trial < 4; trial++) {
        let f = A.startProbeFlowFor(P, pack);
        for (const id of shuffled([...P.participants], rng)) {
          const before = f;
          for (const x of P.participants) if (!A.canReveal(before)) expect(A.revealFor(before, x, y => y)).toBeNull();
          f = A.recordProbeAnswer(f, id, rng.next() < 0.8);
          if (A.canReveal(f)) for (const x of P.participants) { const rv = A.revealFor(f, x, y => y); if (rv) for (const n of rv.names) expect(f.answers[n]).toBe("yes"); }
        }
        if (!f.group && Object.values(f.answers).some(a => a === "no")) expect(A.canReveal(f)).toBe(false);
      }
      for (const me of P.participants) {
        const others = P.participants.filter(x => x !== me);
        const probe = A.buildProbe(w, { proposalId: P.id, kind: P.kind, category: P.category, objective: P.objective, window: P.window, tz: "America/New_York", role: P.roles[me] }, me, others, w.now);
        if (!probe) continue;
        for (const x of others) for (const t of w.get(x)!.m.name.toLowerCase().split(/\s+/).filter(t => t.length > 2)) expect(probe.text.toLowerCase().split(/\W+/)).not.toContain(t);
      }
    }
  });

  await b.run(name("member-facing leak gate (explanations, objectives, probes pass LeakGuard; no canary in any output)"), async () => {
    for (const { seed, input } of worlds) {
      const r = await run(seed);
      const w = world(input, seed);
      expect(/canary/i.test(JSON.stringify({ p: r.proposals, a: r.asks, l: { ...r.runLog, timingsMs: undefined } }))).toBe(false);
      for (const p of r.proposals) {
        const vocab = privateVocabulary(w, p.participants);
        for (const text of Object.values(p.explanations)) expect(checkMemberFacing(text, vocab).ok).toBe(true);
        for (const me of p.participants) {
          const others = p.participants.filter(x => x !== me);
          const probe = A.buildProbe(w, { proposalId: p.id, kind: p.kind, category: (p as EngineProposal).category, objective: p.objective, window: p.window, tz: "America/New_York" }, me, others, w.now);
          if (probe) expect(checkMemberFacing(probe.text, privateVocabulary(w, others)).ok).toBe(true);
        }
      }
    }
  });

  if (pack.judge) await b.run(name("filters respected: the judge cannot undo a hard filter (an always-yes model adds nothing)"), async () => {
    for (const { seed, input } of worlds.slice(0, 2)) {
      const base = await run(seed);
      const llm = YES_ALL();
      const r = await runEngine(input, { ...cfgIn(seed), judge: { screen: { enabled: true }, deep: { enabled: true } } }, { pack, llm, judgeModel: "fake-yes" });
      expect(llm.calls).toBeGreaterThan(0);
      const keys = (x: EngineResult) => x.runLog.scored.map(s => s.key).sort();
      expect(keys(r)).toEqual(keys(base));
      expect(r.runLog.funnel.rejectedBy).toEqual(base.runLog.funnel.rejectedBy);
      const survivors = new Set(base.runLog.scored.map(s => `${s.generator}|${s.participants.join()}`));
      const minors = minorsOf(input, world(input, seed));
      for (const p of r.proposals) {
        expect(survivors.has(`${p.generator}|${p.participants.join()}`)).toBe(true);
        for (const id of [...p.participants, ...p.alternates]) expect(minors.has(id)).toBe(false);
      }
    }
  });
}
