// Q2: how can matching improve? Ablations and parameter sweeps on sim seeds 1-3 (150 personas,
// 30 days, stub network, policy personas, no LLM) and on the synthetic snapshot (one tick).
//
//   bun packages/engine/experiments/sweeps.ts                 # every sim variant + synthetic variants
//   bun packages/engine/experiments/sweeps.ts --only <regex>  # variants whose name matches
//   bun packages/engine/experiments/sweeps.ts --synthetic-only
//
// Every variant keeps the hard rules: filters run unchanged (minors, blocks, opt-ins, romance
// compatibility), and the harness checks minor contacts / unsafe minors and canary leaks.
import { parseArgs } from "node:util";
import type { MemberId } from "@thenetwork/core";
import type { EngineConfigInput } from "../src/config.ts";
import { profileOf } from "../src/complementarity.ts";
import type { Scored } from "../src/scoring.ts";
import type { EngineInput } from "../src/types.ts";
import type { World } from "../src/world.ts";
import { desireById } from "../../sim/src/taxonomy.ts";
import { Oracle } from "../../sim/src/oracle.ts";
import { VAGUE_INTENT } from "../../sim/src/sources.ts";
import { Rng as SimRng, hash32 } from "../../sim/src/rng.ts";
import { desireLive } from "../../sim/src/persona.ts";
import { loadPersonas, loadSnapshot } from "../../../scripts/synthetic/load.ts";
import { augment, historyFromRecords, type AugmentOpts } from "./augment.ts";
import { mean, outcomes, pairKey, pct, runSim, table, tracedEngine, type Hooks, type SimHookCtx } from "./lib.ts";
import type { SelectLevers } from "./select.ts";

const args = parseArgs({ options: { only: { type: "string" }, "synthetic-only": { type: "boolean", default: false }, "sim-only": { type: "boolean", default: false }, seeds: { type: "string", default: "1,2,3" }, history: { type: "boolean", default: false } } }).values;
const SEEDS = args.seeds!.split(",").map(Number);

export interface Variant {
  name: string; group: string; cfg?: EngineConfigInput; aug?: AugmentOpts;
  hooks?: (ctx: SimHookCtx) => Hooks; gen?: Record<string, unknown>; days?: number;
}

// ---------------------------------------------------------------- engine-visible acceptance model
/** Beta-smoothed share of invites a member said yes to (only what the Network observed). */
function acceptEst(ctx: SimHookCtx, id: MemberId, prior = 0.45, k = 2): number {
  const a = (ctx.state.history?.accept as Map<MemberId, { yes: number; n: number }> | undefined)?.get(id);
  return ((a?.yes ?? 0) + prior * k) / ((a?.n ?? 0) + k);
}
const mutualAccept = (ctx: SimHookCtx, x: Scored) => x.c.participants.reduce((s, id) => s * acceptEst(ctx, id), 1);

/** Oracle-informed upper bound (NOT deployable): order by the true P(all accept). */
function oracleAccept(ctx: SimHookCtx, x: Scored): number {
  const o: Oracle = ctx.world.oracle;
  const v = o.evaluate({ id: `ub:${x.c.key}`, kind: x.c.kind, participants: x.c.participants, city: x.c.city as any, window: x.c.window, category: x.c.category });
  return Object.values(v.participants).reduce((s, p) => s * p.acceptProb, 1);
}

/** Re-threshold candidates matching `pred` (can lower as well as raise; floors still apply). */
export const retune = (pred: (s: Scored) => boolean, thr: number) => (_w: World, scored: Scored[]): Scored[] => scored.map(s => {
  if (!pred(s) || s.c.exploration) return s;
  if (s.reason && s.reason !== "below_threshold") return { ...s, threshold: thr };
  const ok = s.score >= thr;
  return { ...s, threshold: thr, eligible: ok, reason: ok ? undefined : "below_threshold" };
});
/** Romance only when both members stated romance preferences (gender sought / age range). */
export const romanceNeedsPrefs = (w: World, scored: Scored[]): Scored[] => scored.map(s =>
  s.c.category === "romance" && s.c.participants.some(id => !w.get(id)!.romance?.seeks.length) ? { ...s, eligible: false, reason: "romance_no_prefs" } : s);
const chain = (...fs: ((w: World, s: Scored[]) => Scored[])[]) => (w: World, s: Scored[]) => fs.reduce((acc, f) => f(w, acc), s);
const CAT_THR = chain(retune(s => s.c.category === "professional", 0.38), retune(s => s.c.category === "romance", 0.45), retune(s => s.c.category === "hobby" && s.threshold <= 0.3, 0.26));

function busyNow(ctx: SimHookCtx): Set<MemberId> {
  return historyFromRecords(ctx.world.records, ctx.now).busy;
}
const busyLevers = (ctx: SimHookCtx, extra: SelectLevers = {}): SelectLevers => ({ ...extra, exclude: ctx.state.history?.busy ?? new Set() });

export const SIM_VARIANTS: Variant[] = [
  { name: "baseline (engine-v1.1.0)", group: "base" },
  // --- retrieval
  { name: "retrieval: need channel on (channelMin 0.85)", group: "retrieval", cfg: { complementarity: { retrievalChannel: true } } },
  { name: "retrieval: need channel on (channelMin 0.45)", group: "retrieval", cfg: { complementarity: { retrievalChannel: true, channelMin: 0.45 } } },
  { name: "retrieval: maxPerIntent 8", group: "retrieval", cfg: { maxPerIntent: 8 } },
  { name: "retrieval: minSim 0.15", group: "retrieval", cfg: { retrieval: { minSim: 0.15 } } },
  { name: "retrieval: minSim 0.25", group: "retrieval", cfg: { retrieval: { minSim: 0.25 } } },
  // --- generator quotas
  { name: "quota: pooling <= 35%", group: "quota", hooks: () => ({ levers: { generatorShare: { shared_intent_pooling: 0.35 } } }) },
  { name: "quota: warm_path <= 5%", group: "quota", hooks: () => ({ levers: { generatorShare: { warm_path: 0.05 } } }) },
  { name: "generators: warm_path off", group: "quota", cfg: { generators: { warm_path: false } } },
  { name: "generators: intent_to_capability off", group: "quota", cfg: { generators: { intent_to_capability: false } } },
  // --- thresholds
  { name: "threshold: normal 0.25", group: "threshold", cfg: { thresholds: { byState: { normal: 0.25, receiving: 0.25 } } } },
  { name: "threshold: normal 0.35", group: "threshold", cfg: { thresholds: { byState: { normal: 0.35, receiving: 0.35 } } } },
  { name: "threshold: normal 0.40", group: "threshold", cfg: { thresholds: { byState: { normal: 0.4, receiving: 0.4 } } } },
  { name: "threshold: romance 0.45, professional 0.38", group: "threshold", cfg: { thresholds: { byCategory: { romance: 0.45, professional: 0.38 } } } },
  { name: "threshold: romance 0.45, professional 0.38, hobby 0.27", group: "threshold", cfg: { thresholds: { byCategory: { romance: 0.45, professional: 0.38, hobby: 0.27 } } } },
  // --- budgets / pacing
  { name: "budget: normal 1/week", group: "budget", cfg: { budgets: { normal: { limit: 1, periodDays: 7 } } } },
  { name: "budget: normal 3/week", group: "budget", cfg: { budgets: { normal: { limit: 3, periodDays: 7 } } } },
  { name: "budget: normal 4/week", group: "budget", cfg: { budgets: { normal: { limit: 4, periodDays: 7 } } } },
  { name: "pacing: 1 proposal per member per night", group: "budget", hooks: () => ({ levers: { perRunCap: 1 } }) },
  { name: "dispatch-aware (a): skip members in an open opportunity only", group: "budget", aug: { history: false }, hooks: ctx => ({ levers: { exclude: (ctx.state.history = (ctx.state.history ?? undefined), busyNow(ctx)) } }) },
  { name: "dispatch-aware (b): don't bill skipped proposals only", group: "budget", aug: { dropSkipped: true } },
  { name: "dispatch-aware: skip busy members + don't bill skipped", group: "budget", aug: { history: false, dropSkipped: true }, hooks: ctx => ({ levers: busyLevers(ctx) }) },
  // --- history / second encounter
  { name: "history fed (cooldowns + second_encounter)", group: "history", aug: { history: true } },
  { name: "history + dispatch-aware", group: "history", aug: { history: true, dropSkipped: true }, hooks: ctx => ({ levers: busyLevers(ctx) }) },
  // --- acceptance modelling (separate from enjoyment)
  { name: "accept model: order by score x P(mutual accept)^0.5", group: "accept", aug: { history: true, dropSkipped: true }, hooks: ctx => ({ levers: busyLevers(ctx, { orderKey: (x, v) => v * Math.sqrt(mutualAccept(ctx, x)) }) }) },
  { name: "accept model: order by score x P(mutual accept)", group: "accept", aug: { history: true, dropSkipped: true }, hooks: ctx => ({ levers: busyLevers(ctx, { orderKey: (x, v) => v * mutualAccept(ctx, x) }) }) },
  { name: "UPPER BOUND (oracle accept, not deployable)", group: "accept", aug: { history: true, dropSkipped: true }, hooks: ctx => ({ levers: busyLevers(ctx, { orderKey: (x, v) => v * oracleAccept(ctx, x) }) }) },
  // --- events / groups
  { name: "events: 6 public events/city/week", group: "events", aug: { events: 6 } },
  { name: "groups: interests shareable (theme groups on)", group: "events", aug: { shareInterests: true } },
  { name: "groups + events", group: "events", aug: { shareInterests: true, events: 6 } },
  // --- category semantics, romance gating, per-category thresholds that can also lower
  { name: "growth wants routed as hobby", group: "category", aug: { growthAsHobby: true } },
  { name: "romance only with stated prefs on both sides", group: "category", hooks: () => ({ rescore: romanceNeedsPrefs }) },
  { name: "threshold: hobby 0.26 (lowered via override)", group: "threshold", hooks: () => ({ rescore: retune(s => s.c.category === "hobby" && s.threshold <= 0.3, 0.26) }) },
  { name: "threshold: professional 0.38, romance 0.45, hobby 0.26 (override)", group: "threshold", hooks: () => ({ rescore: CAT_THR }) },
  { name: "threshold: normal 0.20", group: "threshold", cfg: { thresholds: { byState: { normal: 0.2, receiving: 0.2 } } } },
  { name: "threshold: normal 0.45", group: "threshold", cfg: { thresholds: { byState: { normal: 0.45, receiving: 0.45 } } } },
  { name: "events 6/wk, event_anchor threshold 0.40", group: "events", aug: { events: 6 }, hooks: () => ({ rescore: retune(s => s.c.generator === "event_anchor", 0.4) }) },
  { name: "theme groups, group threshold 0.40", group: "events", aug: { shareInterests: true }, hooks: () => ({ rescore: retune(s => s.c.generator === "group_composer", 0.4) }) },
  // --- combos
  { name: "COMBO A: history + dispatch-aware + accept^0.5 + romance/prof thresholds", group: "combo", cfg: { thresholds: { byCategory: { romance: 0.45, professional: 0.38 } } }, aug: { history: true, dropSkipped: true }, hooks: ctx => ({ levers: busyLevers(ctx, { orderKey: (x, v) => v * Math.sqrt(mutualAccept(ctx, x)) }) }) },
  { name: "COMBO B: A + need channel 0.45 + maxPerIntent 8", group: "combo", cfg: { thresholds: { byCategory: { romance: 0.45, professional: 0.38 } }, complementarity: { retrievalChannel: true, channelMin: 0.45 }, maxPerIntent: 8 }, aug: { history: true, dropSkipped: true }, hooks: ctx => ({ levers: busyLevers(ctx, { orderKey: (x, v) => v * Math.sqrt(mutualAccept(ctx, x)) }) }) },
  { name: "COMBO C: B + pacing 1/night", group: "combo", cfg: { thresholds: { byCategory: { romance: 0.45, professional: 0.38 } }, complementarity: { retrievalChannel: true, channelMin: 0.45 }, maxPerIntent: 8 }, aug: { history: true, dropSkipped: true }, hooks: ctx => ({ levers: busyLevers(ctx, { perRunCap: 1, orderKey: (x, v) => v * Math.sqrt(mutualAccept(ctx, x)) }) }) },
  { name: "COMBO D: dispatch-aware + budget 3/wk + category thresholds + growth->hobby + romance prefs gate", group: "combo", cfg: { budgets: { normal: { limit: 3, periodDays: 7 } } }, aug: { dropSkipped: true, growthAsHobby: true }, hooks: ctx => ({ rescore: chain(CAT_THR, romanceNeedsPrefs), levers: busyLevers(ctx) }) },
  { name: "COMBO G: D + history (no re-asking a declined pair for 30 days)", group: "combo", cfg: { budgets: { normal: { limit: 3, periodDays: 7 } } }, aug: { history: true, dropSkipped: true, growthAsHobby: true }, hooks: ctx => ({ rescore: chain(CAT_THR, romanceNeedsPrefs), levers: busyLevers(ctx) }) },
  { name: "COMBO H: G + theme groups & events at threshold 0.40", group: "combo", cfg: { budgets: { normal: { limit: 3, periodDays: 7 } } }, aug: { history: true, dropSkipped: true, growthAsHobby: true, shareInterests: true, events: 6 }, hooks: ctx => ({ rescore: chain(CAT_THR, romanceNeedsPrefs, retune(s => s.c.generator === "event_anchor" || s.c.generator === "group_composer", 0.4)), levers: busyLevers(ctx) }) },
  { name: "COMBO E: D + accept^0.5 + need 0.45 + maxPerIntent 8", group: "combo", cfg: { budgets: { normal: { limit: 3, periodDays: 7 } }, complementarity: { retrievalChannel: true, channelMin: 0.45 }, maxPerIntent: 8 }, aug: { history: true, dropSkipped: true, growthAsHobby: true }, hooks: ctx => ({ rescore: chain(CAT_THR, romanceNeedsPrefs), levers: busyLevers(ctx, { orderKey: (x, v) => v * Math.sqrt(mutualAccept(ctx, x)) }) }) },
  { name: "COMBO F: D + theme groups & events at threshold 0.40", group: "combo", cfg: { budgets: { normal: { limit: 3, periodDays: 7 } } }, aug: { dropSkipped: true, growthAsHobby: true, shareInterests: true, events: 6 }, hooks: ctx => ({ rescore: chain(CAT_THR, romanceNeedsPrefs, retune(s => s.c.generator === "event_anchor" || s.c.generator === "group_composer", 0.4)), levers: busyLevers(ctx) }) },
];

export interface SimSummary {
  name: string; proposals: number; precision: number; worthwhile: number; recall: number; zero: number; gini: number;
  allAccepted: number; met: number; metWorth: number; metWorthN: number; proactive: number; minor: number; leaks: number; perSeedPrecision: number[];
  bySeed: any[];
}

export async function runVariant(v: Variant, seeds = SEEDS, extraHooks?: (ctx: SimHookCtx) => Hooks): Promise<SimSummary> {
  const per: any[] = [];
  for (const seed of seeds) {
    const res = await runSim({
      seed, cfg: v.cfg, gen: v.gen, days: v.days, keepTraces: false,
      augment: v.aug ? (snap: EngineInput, ctx) => augment(snap, ctx, v.aug!) : undefined,
      hooks: ctx => ({ ...(v.hooks?.(ctx) ?? {}), ...(extraHooks?.(ctx) ?? {}) }),
    });
    const m = res.metrics;
    const outs = outcomes(res.records);
    const both = outs.filter(o => o.accepted.length >= Math.min(o.participants.length, 3) && o.accepted.length >= (o.participants.length > 2 ? 3 : 2));
    const met = outs.filter(o => o.held);
    const metWorth = met.filter(o => o.showed.every(id => (o.enjoyment[id] ?? 0) >= 0.5));
    per.push({
      seed, proposals: m.proposals.total, precision: m.proposals.precision, worthwhile: m.experience.worthwhileRate, recall: m.proposals.recallPairs,
      zero: m.fairness.zeroProposalShare, gini: m.fairness.gini, allAccepted: both.length / Math.max(1, outs.length), met: met.length / Math.max(1, outs.length),
      metWorth: metWorth.length / Math.max(1, outs.length), metWorthN: metWorth.length, proactive: m.experience.proactivePerMemberPerWeek,
      minor: m.safety.minorContacts, leaks: m.privacy.canaryLeaks, unsafeMinor: m.proposals.unsafe.minor, inv: m.invariants.total,
    });
  }
  const avg = (k: string) => mean(per.map(p => p[k]));
  return {
    name: v.name, proposals: avg("proposals"), precision: avg("precision"), worthwhile: avg("worthwhile"), recall: avg("recall"), zero: avg("zero"), gini: avg("gini"),
    allAccepted: avg("allAccepted"), met: avg("met"), metWorth: avg("metWorth"), metWorthN: avg("metWorthN"), proactive: avg("proactive"),
    minor: per.reduce((s, p) => s + p.minor, 0), leaks: per.reduce((s, p) => s + p.leaks, 0), perSeedPrecision: per.map(p => p.precision), bySeed: per,
  };
}

export function simRow(s: SimSummary): (string | number)[] {
  return [s.name, s.proposals.toFixed(0), `${pct(s.precision)} (${s.perSeedPrecision.map(x => (x * 100).toFixed(0)).join("/")})`, pct(s.worthwhile), pct(s.recall), pct(s.zero), s.gini.toFixed(3),
    pct(s.allAccepted), pct(s.met), s.metWorthN.toFixed(1), s.proactive.toFixed(2), `${s.minor}/${s.leaks}`];
}
export const SIM_HEADER = ["variant", "proposals/seed", "precision (s1/s2/s3)", "persona worthwhile", "pair recall", "no proposal", "Gini", "all accepted", "met", "met+worthwhile /seed", "proactive/member/wk", "minor contacts / leaks"];

// ---------------------------------------------------------------- synthetic snapshot variants
interface SynthVariant { name: string; cfg?: EngineConfigInput; hooks?: Hooks; snap?: (s: EngineInput, ctx: SynthCtx) => EngineInput; twoTick?: boolean }
interface SynthCtx { personas: Awaited<ReturnType<typeof loadPersonas>>; oracle: Oracle }

/** Re-confirmation sweep: expired-but-held and lapsed-but-live records get a check-in now. */
function reconfirm(s: EngineInput, ctx: SynthCtx): EngineInput {
  const byId = new Map(ctx.personas.map(p => [p.id, p]));
  const intents = s.intents.map(i => {
    const p = byId.get(i.memberId); if (!p) return i;
    const idx = Number(i.id.split(":i").pop());
    const st = p.public.statedIntents[idx];
    const d = st ? p.hidden.desires.find(x => x.id === st.desireId) : undefined;
    const expired = i.status === "active" && i.createdAt + i.horizonDays * 86_400_000 <= s.now;
    const live = i.status === "active" && !expired;
    const answers = new SimRng(hash32("recheck", p.id, i.id)).next() < 1 - p.hidden.responsiveness.ignoreProb;
    if (!answers) return i;
    const held = d ? desireLive(d, s.now) : true;
    if (expired && held) return { ...i, createdAt: s.now - 86_400_000 };
    if (live && d && !held) return { ...i, status: "closed" as const };
    return i;
  });
  return { ...s, intents };
}

/** Engine-visible "ask a question instead": members with no structured want or < 3 matchable facets. */
const askable = (w: World, id: MemberId) => { const mi = w.get(id)!; return profileOf(w, id).wants.length === 0 || mi.lowData; };

/** Tick 2 of "ask": answered askable members state their real (first) want with details. */
function answerQuestions(s: EngineInput, ctx: SynthCtx, asked: Set<MemberId>): EngineInput {
  const byId = new Map(ctx.personas.map(p => [p.id, p]));
  const vague = new Set(Object.values(VAGUE_INTENT));
  const intents = [...s.intents];
  const facets = [...s.facets];
  for (const id of asked) {
    const p = byId.get(id); if (!p) continue;
    if (new SimRng(hash32("ask", id)).next() >= 1 - p.hidden.responsiveness.ignoreProb) continue;
    const live = p.hidden.desires.filter(d => desireLive(d, s.now)).sort((a, b) => b.strength - a.strength)[0];
    if (!live) continue;
    const def: any = desireById.get(live.id);
    const details = def ? `format: ${def.format}; tags: ${[...def.needsInterests, ...def.needsSkills, def.pool ?? ""].filter(Boolean).join(",")}` : undefined;
    const existing = intents.findIndex(i => i.memberId === id && i.status === "active" && vague.has(i.objective));
    const rec = { id: `${id}:ask0`, memberId: id, objective: live.text, category: live.category, details, horizonDays: live.category === "romance" ? 90 : 60, status: "active" as const, createdAt: s.now - 3_600_000 };
    if (existing >= 0) intents[existing] = { ...intents[existing]!, objective: live.text, details, createdAt: rec.createdAt, status: "active" };
    else intents.push(rec);
    // The answer also names one or two interests (as a light-tier member would).
    for (const t of p.public.statedInterests.slice(0, 2)) facets.push({ id: `${id}:askf:${t}`, memberId: id, kind: "interest", value: t.replace(/_/g, " "), tags: [t], scope: "matchable", provenance: "said", confidence: 0.8, validFrom: s.now - 3_600_000 } as any);
  }
  return { ...s, intents, facets };
}

async function synthetic(only?: RegExp) {
  const base = await loadSnapshot() as EngineInput;
  const personas = await loadPersonas();
  const oracle = new Oracle(personas, 1, base.now);
  const ctx: SynthCtx = { personas, oracle };
  const latent = (["sf", "nyc"] as const).flatMap(c => oracle.latentPairs(personas.filter(p => p.homeCity === c).map(p => p.id), base.now));
  const latentSet = new Set(latent.map(l => pairKey(l.a, l.b)));
  const tier = new Map(personas.map(p => [p.id, p.hidden.richness ?? "none"]));
  const adults = base.members.filter(m => m.age >= 18).map(m => m.id);
  const evalRun = (props: any[]) => {
    const vs = props.map(p => ({ p, v: oracle.evaluate({ id: p.id, kind: p.kind, participants: p.participants, city: p.city, window: p.window, category: p.category, objective: p.objective }) }));
    const pairs = new Set(props.flatMap(p => p.participants.flatMap((x: string, i: number) => p.participants.slice(i + 1).map((y: string) => pairKey(x, y)))));
    const touched = new Set(props.flatMap(p => p.participants));
    const expMet = vs.reduce((s, { v }) => s + Object.values(v.participants).reduce((q, x) => q * x.acceptProb * x.showProb, 1), 0);
    const minIds = adults.filter(id => tier.get(id) === "minimal");
    const minProps = vs.filter(({ p }) => p.participants.some((x: string) => tier.get(x) === "minimal"));
    return {
      n: props.length, precision: mean(vs.map(({ v }) => (v.compatible ? 1 : 0))), recall: [...pairs].filter(k => latentSet.has(k)).length / latent.length,
      coverage: adults.filter(id => touched.has(id)).length / adults.length, expMet,
      minCov: minIds.filter(id => touched.has(id)).length / minIds.length, minPrec: mean(minProps.map(({ v }) => (v.compatible ? 1 : 0))), minN: minProps.length,
      minors: props.filter(p => p.participants.some((x: string) => (base.members.find(m => m.id === x)?.age ?? 0) < 18)).length,
    };
  };
  const variants: SynthVariant[] = [
    { name: "baseline" },
    { name: "need channel on (0.85)", cfg: { complementarity: { retrievalChannel: true } } },
    { name: "need channel on (0.45)", cfg: { complementarity: { retrievalChannel: true, channelMin: 0.45 } } },
    { name: "maxPerIntent 8", cfg: { maxPerIntent: 8 } },
    { name: "maxPerIntent 8 + need 0.45", cfg: { maxPerIntent: 8, complementarity: { retrievalChannel: true, channelMin: 0.45 } } },
    { name: "minSim 0.15", cfg: { retrieval: { minSim: 0.15 } } },
    { name: "threshold normal 0.25", cfg: { thresholds: { byState: { normal: 0.25, receiving: 0.25 } } } },
    { name: "threshold normal 0.35", cfg: { thresholds: { byState: { normal: 0.35, receiving: 0.35 } } } },
    { name: "threshold romance 0.45 / professional 0.38", cfg: { thresholds: { byCategory: { romance: 0.45, professional: 0.38 } } } },
    { name: "maxProposalsPerCity 240", cfg: { selection: { maxProposalsPerCity: 240 } } },
    { name: "re-confirm stale intents (one check-in sweep)", snap: reconfirm },
    { name: "events 6/city/week", snap: s => augment(s, { world: null, state: {}, now: s.now, city: "" }, { events: 6 }) },
    { name: "interests shareable (theme groups)", snap: s => augment(s, { world: null, state: {}, now: s.now, city: "" }, { shareInterests: true }) },
    { name: "growth wants routed as hobby", snap: s => augment(s, { world: null, state: {}, now: s.now, city: "" }, { growthAsHobby: true }) },
    { name: "category thresholds (prof 0.38, romance 0.45, hobby 0.26)", hooks: { rescore: CAT_THR } },
    { name: "romance only with stated prefs on both sides", hooks: { rescore: romanceNeedsPrefs } },
    { name: "COMBO D (one tick): budget 3 + category thresholds + growth->hobby + romance gate", cfg: { budgets: { normal: { limit: 3, periodDays: 7 } } }, snap: s => augment(s, { world: null, state: {}, now: s.now, city: "" }, { growthAsHobby: true }), hooks: { rescore: chain(CAT_THR, romanceNeedsPrefs) } },
    { name: "COMBO D + re-confirm + theme groups/events at 0.40", cfg: { budgets: { normal: { limit: 3, periodDays: 7 } } }, snap: (s, c) => augment(reconfirm(s, c), { world: null, state: {}, now: s.now, city: "" }, { growthAsHobby: true, shareInterests: true, events: 6 }), hooks: { rescore: chain(CAT_THR, romanceNeedsPrefs, retune(x => x.c.generator === "event_anchor" || x.c.generator === "group_composer", 0.4)) } },
    { name: "ASK: no proposals for askable members (tick 1)", hooks: { postSelect: (w, sel) => sel.filter(x => !x.s.c.participants.some(id => askable(w, id))) } },
    { name: "ASK: tick 2 after answers", twoTick: true },
    { name: "ASK: tick 2 after answers + need 0.45 + maxPerIntent 8", twoTick: true, cfg: { maxPerIntent: 8, complementarity: { retrievalChannel: true, channelMin: 0.45 } } },
  ];
  const rows: (string | number)[][] = [];
  for (const v of variants) {
    if (only && !only.test(v.name)) continue;
    let snap = v.snap ? v.snap(base, ctx) : base;
    let res = tracedEngine(snap, { ...(v.cfg ?? {}), seed: 1 }, v.hooks ?? {});
    if (v.twoTick) {
      const asked = new Set(res.world.ids.filter(id => res.world.get(id)!.m.age >= 18 && askable(res.world, id)));
      snap = answerQuestions(base, ctx, asked);
      res = tracedEngine(snap, { ...(v.cfg ?? {}), seed: 1 }, v.hooks ?? {});
      rows.push([`${v.name} (asked ${asked.size})`, ...fmt(evalRun(res.proposals))]);
      continue;
    }
    rows.push([v.name, ...fmt(evalRun(res.proposals))]);
  }
  function fmt(e: ReturnType<typeof evalRun>) {
    return [e.n, pct(e.precision), pct(e.recall, 2), pct(e.coverage), e.expMet.toFixed(1), `${pct(e.minCov)} / ${pct(e.minPrec)} (n=${e.minN})`, e.minors];
  }
  return "## Synthetic snapshot variants (one tick, seed 1)\n\n" + table(["variant", "proposals", "precision", "pair recall", "adults with a proposal", "expected meetings", "minimal tier: coverage / precision", "minors"], rows);
}

if (import.meta.main) {
  const only = args.only ? new RegExp(args.only, "i") : undefined;
  if (!args["synthetic-only"]) {
    const rows: (string | number)[][] = [];
    for (const v of SIM_VARIANTS) {
      if (only && !only.test(v.name)) continue;
      const t0 = performance.now();
      // --history: every variant also gets the realistic no-re-ask rule (interactions + feedback fed).
      const s = await runVariant(args.history ? { ...v, name: `${v.name} [+history]`, aug: { ...(v.aug ?? {}), history: true } } : v);
      rows.push(simRow(s));
      process.stderr.write(`${v.name}: ${Math.round(performance.now() - t0)}ms\n`);
    }
    console.log("## Simulator variants (seeds " + SEEDS.join(",") + ", 150 personas, 30 days" + (args.history ? ", every variant with history fed: no re-asking a declined pair for 30 days" : "") + ")\n\n" + table(SIM_HEADER, rows));
  }
  if (!args["sim-only"]) console.log("\n" + await synthetic(only));
}
