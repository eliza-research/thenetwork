// Per-pack conformance suite (docs/research/2026-10-08-engine-generalization.md 5.2). Any AppPack
// runs it: `runConformance(pack)` inside a bun test file registers the checks. They test the CORE
// INVARIANTS a pack cannot loosen, through the pack's own rules, generators, geo, judge, attention
// and plans:
//   1. minors (13-17 and unknown ages) never in any role;   5. determinism (rerun and shuffled input);
//   2. blocks win;                                         6. the judge cannot undo hard filters;
//   3. consent before reveal;                              7. attention caps, quiet hours, ships-alone;
//   4. the leak gate on every member-facing string;        8. the geo filter contract.
// Plus registration (unique ids, adults-only lanes, match age >= 18). No LLM calls: the judge
// checks use a fake model that says yes to everything with top scores.
import { describe, expect, test } from "bun:test";
import type { ChatMessage, LLM, MemberId } from "@thenetwork/core";
import { canBeMatched, DAY, HOUR } from "@thenetwork/core";
import * as A from "../src/attention.ts";
import { resolveConfig, type EngineConfigInput } from "../src/config.ts";
import { localEmbed } from "../src/embed.ts";
import { runEngine, type EngineResult } from "../src/engine.ts";
import { privateVocabulary } from "../src/explain.ts";
import { candidateReason, involvedMembers, memberReason, pairReason } from "../src/filters.ts";
import type { GenCtx } from "../src/genkit.ts";
import { checkMemberFacing } from "../src/judgeCommon.ts";
import { hardGate } from "../src/judgeDeep.ts";
import { validatePack, type AppPack } from "../src/pack.ts";
import { Rng } from "../src/rng.ts";
import { randomWorld } from "../src/testkit.ts";
import type { AttentionItem, Candidate, EngineInput, EngineProposal } from "../src/types.ts";
import { pairKey, World } from "../src/world.ts";

export interface ConformanceOptions {
  /** World factory (default: the engine testkit's random world with minors, blocks, holds, canaries, aliases). */
  world?: (seed: number) => EngineInput;
  seeds?: number[];
  cfg?: EngineConfigInput;
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

/** Canonical JSON of a result minus wall-clock timings. */
const canon = (r: EngineResult) => JSON.stringify({ ...r, runLog: { ...r.runLog, timingsMs: undefined } });

function shuffled<T>(xs: T[], rng: Rng): T[] { const a = [...xs]; rng.shuffle(a); return a; }

export function runConformance(pack: AppPack, o: ConformanceOptions = {}): void {
  const seeds = o.seeds ?? [1, 2, 3, 4];
  // Worlds: the testkit default carries 15% minors (13-17, with the same facets, intents, edges and host tags as adults).
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

  describe(`conformance: ${pack.id} (${pack.version})`, () => {
    test("registration: valid pack (match age >= 18, adults-only lanes, non-matchable tiers, unique ids)", () => {
      expect(() => validatePack(pack)).not.toThrow();
      expect(pack.eligibility.minMatchAge).toBeGreaterThanOrEqual(18);
      for (const t of pack.eligibility.accountTiers) { expect(t.matchable).toBe(false); expect(t.maxAge).toBeLessThan(18); }
      // A pack that lowers the match age is rejected.
      expect(() => validatePack({ ...pack, eligibility: { ...pack.eligibility, minMatchAge: 16 } })).toThrow();
    });

    test("worlds are non-trivial (positive control: every world yields proposals and contains minors)", async () => {
      for (const { seed, input } of worlds) {
        const r = await run(seed);
        expect(r.proposals.length).toBeGreaterThan(0);
        expect(minorsOf(input, world(input, seed)).size).toBeGreaterThan(0);
      }
    });

    // ---- 1. minors ---------------------------------------------------------------------------------
    test("1. minors are never in any role: raw generator candidates, proposals, alternates, via, asks, scored log, debt", async () => {
      for (const { seed, input } of worlds) {
        const w = world(input, seed);
        const minors = minorsOf(input, w);
        const ctx: GenCtx = { w, memberExclusions: {}, rng: new Rng(seed).fork("gen"), unmatchedIntents: new Set() };
        for (const g of pack.generators) for (const c of g.run(ctx)) {
          const bad = involvedMembers(c).filter(id => minors.has(id));
          if (bad.length) expect(candidateReason(w, { ...c, channels: new Set(c.channels) })).not.toBeNull();
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
          expect(w.positive.has(id)).toBe(false); // never in the warm graph
        }
      }
    });

    test("1b. minors in attention and plans: no member-involving item, no probe, no plan seat", () => {
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

    // ---- 2. blocks ---------------------------------------------------------------------------------
    test("2. blocks win: a blocked pair is never proposed together, never warm, never a via", async () => {
      for (const { seed, input } of worlds) {
        const r0 = await run(seed);
        // Block every pair the unblocked run proposed, then rerun.
        const pairs = new Set<string>();
        for (const p of r0.proposals) for (let i = 0; i < p.participants.length; i++) for (let j = i + 1; j < p.participants.length; j++) pairs.add(pairKey(p.participants[i]!, p.participants[j]!));
        const blocked: EngineInput = { ...input, edges: [...input.edges, ...[...pairs].map(k => { const [a, b] = k.split("|"); return { from: a!, to: b!, type: "blocked" as const, strength: 1, explicit: true, createdAt: input.now - DAY }; })] };
        const r = await runEngine(blocked, cfgIn(seed), { pack });
        const w = world(blocked, seed);
        for (const p of r.proposals) {
          const ids = [...p.participants, ...(p.via ? [p.via] : [])];
          for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) expect(w.blocked.has(pairKey(ids[i]!, ids[j]!))).toBe(false);
        }
        for (const k of pairs) { const [a, b] = k.split("|") as [MemberId, MemberId]; expect(w.isWarm(a, b)).toBe(false); expect(pairReason(w, a, b, pack.ontology.funnelProbe.lane)).toBe("blocked"); }
      }
    });

    // ---- 3. consent before reveal -------------------------------------------------------------------
    test("3. consent before reveal: no names before the pack's flow reaches 'revealed', under random answer orders", async () => {
      const r = await run(seeds[0]!);
      const w = world(worlds[0]!.input, seeds[0]!);
      const rng = new Rng(99);
      for (const p of r.proposals) {
        const P = p as EngineProposal;
        for (let trial = 0; trial < 4; trial++) {
          let f = A.startProbeFlowFor(P, pack);
          const order = shuffled([...P.participants], rng);
          for (const id of order) {
            const before = f;
            for (const x of P.participants) if (!A.canReveal(before)) expect(A.revealFor(before, x, y => y)).toBeNull();
            f = A.recordProbeAnswer(f, id, rng.next() < 0.8);
            if (A.canReveal(f)) for (const x of P.participants) { const rv = A.revealFor(f, x, y => y); if (rv) for (const n of rv.names) expect(f.answers[n]).toBe("yes"); }
          }
          if (!f.group && Object.values(f.answers).some(a => a === "no")) expect(A.canReveal(f)).toBe(false);
        }
        // The anonymous probe never names the other people.
        for (const me of P.participants) {
          const others = P.participants.filter(x => x !== me);
          const probe = A.buildProbe(w, { proposalId: P.id, kind: P.kind, category: P.category, objective: P.objective, window: P.window, tz: "America/New_York", role: P.roles[me] }, me, others, w.now);
          if (!probe) continue;
          for (const o of others) for (const t of w.get(o)!.m.name.toLowerCase().split(/\s+/).filter(t => t.length > 2)) expect(probe.text.toLowerCase().split(/\W+/)).not.toContain(t);
        }
      }
    });

    // ---- 4. leak gate --------------------------------------------------------------------------------
    test("4. leak gate: explanations, objectives and probes pass LeakGuard; canaries never appear in any output", async () => {
      for (const { seed, input } of worlds) {
        const r = await run(seed);
        const w = world(input, seed);
        const out = JSON.stringify({ p: r.proposals, a: r.asks, l: { ...r.runLog, timingsMs: undefined } });
        expect(/canary/i.test(out)).toBe(false);
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

    // ---- 5. determinism ------------------------------------------------------------------------------
    test("5. determinism: same input, config, seed and pack give the same bytes; shuffled input gives the same proposals", async () => {
      for (const { seed, input } of worlds.slice(0, 2)) {
        const a = await run(seed);
        const b = await runEngine(input, cfgIn(seed), { pack });
        expect(canon(b)).toBe(canon(a));
        const rng = new Rng(seed + 7);
        const shuf: EngineInput = { ...input, members: shuffled(input.members, rng), facets: shuffled(input.facets, rng), intents: shuffled(input.intents, rng), presence: shuffled(input.presence, rng), edges: shuffled(input.edges, rng) };
        const c = await runEngine(shuf, cfgIn(seed), { pack });
        expect(JSON.stringify(c.proposals)).toBe(JSON.stringify(a.proposals));
      }
    });

    // ---- 6. judge cannot undo filters -----------------------------------------------------------------
    test("6. the judge cannot undo hard filters: an always-yes model adds nothing that failed a filter", async () => {
      if (!pack.judge) return;
      for (const { seed, input } of worlds.slice(0, 2)) {
        const base = await run(seed);
        const llm = YES_ALL();
        const r = await runEngine(input, { ...cfgIn(seed), judge: { screen: { enabled: true }, deep: { enabled: true } } }, { pack, llm, judgeModel: "fake-yes" });
        expect(llm.calls).toBeGreaterThan(0);
        // The hard-filter survivors are identical with and without the model, and every proposal is one of them.
        const keys = (x: EngineResult) => x.runLog.scored.map(s => s.key).sort();
        expect(keys(r)).toEqual(keys(base));
        expect(r.runLog.funnel.rejectedBy).toEqual(base.runLog.funnel.rejectedBy);
        const survivors = new Set(base.runLog.scored.map(s => `${s.generator}|${s.participants.join()}`));
        const w = world(input, seed);
        const minors = minorsOf(input, w);
        for (const p of r.proposals) {
          expect(survivors.has(`${p.generator}|${p.participants.join()}`)).toBe(true);
          for (const id of [...p.participants, ...p.alternates]) expect(minors.has(id)).toBe(false);
        }
      }
    });

    // ---- 7. attention -----------------------------------------------------------------------------------
    test("7. attention: caps bind invites, at most 3 items, quiet hours, paused, ships-alone lane alone", () => {
      const cfg = pack.attention.config;
      const T = Date.UTC(2026, 9, 8, 19, 30); // 12:30 in Los Angeles
      const mk = (over: Partial<A.MemberAttention> = {}): A.MemberAttention => ({ memberId: "a", state: "normal", age: 30, tz: "America/Los_Angeles", quietHours: [21, 9], onlyWhenAsked: false, prefs: { ...A.defaultCadence("normal", cfg), romanceInDigest: false }, categoriesOptIn: pack.ontology.lanes.map(l => l.id as never), ...over });
      const lane = pack.ontology.funnelProbe.lane;
      const items = (n: number, cat = lane): AttentionItem[] => Array.from({ length: n }, (_, i) => ({ id: `i${cat}${i}`, memberId: "a", kind: "intro_probe", category: cat, others: [`x${cat}${i}`], involvesMember: i % 2 === 0, effort: "glance", enjoy: 0.95, accept: 0.9, urgency: { expiresAt: T + 10 * DAY }, createdAt: T, reviewState: "approved", key: `k${cat}${i}` }));
      const compose = (m: A.MemberAttention, its: AttentionItem[], ledger: A.ComposeInput["ledger"] = [], now = T) => A.composeMessage({ member: m, items: its, ledger, conversation: { outboundSinceInbound: 0 }, now, mode: "digest", cfg, pack });
      const sent = compose(mk(), items(6));
      expect(sent.send).toBe(true);
      expect(sent.items.length).toBeLessThanOrEqual(3);
      expect(sent.items.filter(i => i.involvesMember).length).toBeLessThanOrEqual(cfg.maxMemberItems);
      // Cap: the state's limit of initial invites already used in the period => no invite goes out.
      const cap = A.capFor(mk(), cfg);
      const ledger = Array.from({ length: cap.limit }, (_, i) => ({ messageId: `m${i}`, memberId: "a", at: T - (i + 1) * HOUR, kind: "digest" as const, itemIds: [], countsAgainstCap: true, repliedAt: T - HOUR / 2, replyKind: "pick" as const }));
      expect(compose(mk(), items(3), ledger).send).toBe(false);
      expect(compose(mk({ state: "paused" }), items(3)).send).toBe(false);
      expect(compose(mk(), items(3), [], Date.UTC(2026, 9, 8, 6)).send).toBe(false); // 23:00 local
      const alone = pack.attention.shipsAloneLane;
      if (alone) {
        const r = compose(mk(), [...items(2), ...items(2, alone)]);
        if (r.send && r.items.some(i => i.category === alone)) expect(r.items.length).toBe(1);
      }
    });

    // ---- 8. geo -----------------------------------------------------------------------------------------
    test("8. geo filter contract: every proposal's members can meet in its market; overlap is order-independent; pair geo rule symmetric", async () => {
      for (const { seed, input } of worlds) {
        const r = await run(seed);
        const w = world(input, seed);
        const markets = pack.geo.markets(w.cfg);
        for (const p of r.proposals) {
          expect(markets).toContain(p.city);
          const win = p.window!;
          for (const id of p.participants) {
            const ivs = w.location(id, win.start, win.end).get(p.city) ?? [];
            expect(ivs.some(([s, e]) => s <= win.start + 1 && e >= Math.min(win.end, win.start + 1))).toBe(true);
          }
          const start = w.now, end = w.now + w.cfg.windowDays * DAY;
          const a = pack.geo.overlap(w, [...p.participants], start, end), b = pack.geo.overlap(w, [...p.participants].reverse(), start, end);
          expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        }
        if (pack.geo.pairReason) for (let i = 0; i + 1 < w.ids.length; i += 2) expect(pack.geo.pairReason(w, w.ids[i]!, w.ids[i + 1]!)).toBe(pack.geo.pairReason(w, w.ids[i + 1]!, w.ids[i]!));
        // Members with no presence in common never pass the configuration filter.
        const far = w.ids.find(id => w.get(id)!.m.homeCity !== w.get(w.ids[0]!)!.m.homeCity && !w.get(id)!.presence.some(x => x.city === w.get(w.ids[0]!)!.m.homeCity));
        if (far) {
          const c = { key: "geo", kind: "intro", generator: "geo", category: pack.ontology.funnelProbe.lane, participants: [w.ids[0]!, far], roles: {}, format: "one_to_one", objective: "x", channels: new Set<string>(), evidence: {}, fit: 1, benefit: {}, warm: 0, alternates: [], exploration: false, safetyClass: "low", timeSensitive: false, riskText: "" } as unknown as Candidate;
          const reason = candidateReason(w, c);
          if (!reason) expect(pack.geo.overlap(w, c.participants, w.now, w.now + w.cfg.windowDays * DAY)).not.toBeNull();
        }
      }
    });
  });
}
