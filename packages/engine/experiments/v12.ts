// Engine v1.2 before/after (docs/results/2026-10-07-engine-v1.2.md). Each recommendation of
// docs/research/2026-10-07-match-failures-and-diversity.md is a config flag in src/config.ts (or a
// sim snapshot feature in packages/sim/src/snapshot.ts); this script measures each one against the
// corrected baseline: engine-v1.1.0 behaviour, the legacy snapshot, and the Network's own records
// fed back (no re-asking a declined pair for 30 days).
//
//   bun packages/engine/experiments/v12.ts                               # every sim variant, seeds 1-8, + synthetic
//   bun packages/engine/experiments/v12.ts --only "baseline|dispatch"    # variants whose name matches
//   bun packages/engine/experiments/v12.ts --sim-only --seeds 1,2,3 --json /tmp/out.json
//   bun packages/engine/experiments/v12.ts --synthetic-only
//   bun packages/engine/experiments/v12.ts --richness --only "v1.1|v1.2"  # sim with richness tiers
//
// No LLM calls. The engine reads only the snapshot; hidden truth is read only to score.
import { parseArgs } from "node:util";
import type { MemberId } from "@thenetwork/core";
import { DEFAULT_CONFIG, PRESETS, type EngineConfigInput } from "../src/config.ts";
import { profileOf } from "../src/complementarity.ts";
import type { EngineInput, EngineProposal } from "../src/types.ts";
import type { World } from "../src/world.ts";
import { Oracle } from "../../sim/src/oracle.ts";
import { desireLive } from "../../sim/src/persona.ts";
import { Rng as SimRng, hash32 } from "../../sim/src/rng.ts";
import { LEGACY_SNAPSHOT_FEATURES, SNAPSHOT_FEATURES, publicEvents, type SnapshotFeatures } from "../../sim/src/snapshot.ts";
import { VAGUE_INTENT } from "../../sim/src/sources.ts";
import { desireById } from "../../sim/src/taxonomy.ts";
import { loadPersonas, loadSnapshot } from "../../../scripts/synthetic/load.ts";
import { mean, outcomes, pairKey, pct, runSim, table, tracedEngine } from "./lib.ts";

const args = parseArgs({ options: {
  only: { type: "string" }, seeds: { type: "string", default: "1,2,3,4,5,6,7,8" }, json: { type: "string" },
  "sim-only": { type: "boolean", default: false }, "synthetic-only": { type: "boolean", default: false }, richness: { type: "boolean", default: false },
} }).values;
const SEEDS = args.seeds!.split(",").map(Number);

// ------------------------------------------------------------------ configurations
/** engine-v1.1.0 behaviour: every v1.2 flag off, Normal budget 2/week. */
export const V11: EngineConfigInput = { ...PRESETS.v1_1, budgets: { normal: { limit: 2, periodDays: 7 } } };
const on = (...xs: EngineConfigInput[]): EngineConfigInput => xs.reduce((a, b) => merge(a, b), V11);
function merge(a: any, b: any): any {
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return b ?? a;
  const out = { ...a };
  for (const k of Object.keys(b)) out[k] = merge(a[k], b[k]);
  return out;
}
const DISPATCH: EngineConfigInput = { dispatch: { skipOpenOpportunities: true, billOnlySent: true } };
const GROWTH: EngineConfigInput = { personalGrowthAsHobby: true };
const CATTHR: EngineConfigInput = { thresholds: { useCategoryOverride: true } };
const ACCEPT: EngineConfigInput = { acceptance: { exponent: 0.5, signals: false } };
const ACCEPT_SIG: EngineConfigInput = { acceptance: { exponent: 0.5, signals: true } };
const BUDGET3: EngineConfigInput = { budgets: { normal: { limit: 3, periodDays: 7 } } };
const GENTHR: EngineConfigInput = { thresholds: { useByGenerator: true } };
const ASK: EngineConfigInput = { ask: { enabled: true } };
const ROMANCE: EngineConfigInput = { romance: { requireStatedPrefs: true } };
/** The engine-v1.2.0 defaults (src/config.ts DEFAULT_CONFIG), whatever they are now. */
const V12: EngineConfigInput = {};

const LEGACY = LEGACY_SNAPSHOT_FEATURES;
const EVENTS_GROUPS: SnapshotFeatures = { ...LEGACY, eventsPerWeek: 6, shareInterests: true, hostTags: true };
const PREFS: SnapshotFeatures = { ...LEGACY, romancePrefs: true };
const NEW = SNAPSHOT_FEATURES;

export interface Variant { name: string; cfg: EngineConfigInput; features: SnapshotFeatures; asks?: boolean }
export const VARIANTS: Variant[] = [
  { name: "baseline: engine-v1.1.0, legacy snapshot, history fed", cfg: V11, features: LEGACY },
  { name: "#1 dispatch-aware (skip open opportunities + bill only sent)", cfg: on(DISPATCH), features: LEGACY },
  { name: "#1a skip open opportunities only", cfg: on({ dispatch: { skipOpenOpportunities: true } }), features: LEGACY },
  { name: "#1b bill only sent only", cfg: on({ dispatch: { billOnlySent: true } }), features: LEGACY },
  { name: "#2 personal growth -> hobby", cfg: on(GROWTH), features: LEGACY },
  { name: "#3 category thresholds (prof 0.38, romance 0.45, hobby 0.26; can lower)", cfg: on(CATTHR), features: LEGACY },
  { name: "#4 acceptance order (Beta history only) + #1", cfg: on(DISPATCH, ACCEPT), features: LEGACY },
  { name: "#4 acceptance order (history + state/capacity/freshness signals) + #1", cfg: on(DISPATCH, ACCEPT_SIG), features: LEGACY },
  { name: "#4 acceptance order (signals) alone", cfg: on(ACCEPT_SIG), features: LEGACY },
  { name: "#5 budget Normal 3/week", cfg: on(BUDGET3), features: LEGACY },
  { name: "#6 snapshot: events + shareable interests + host tags (engine v1.1)", cfg: V11, features: EVENTS_GROUPS },
  { name: "#6 snapshot events/groups + event/group threshold 0.40", cfg: on(GENTHR), features: EVENTS_GROUPS },
  { name: "#7a ask before proposing (low-data members; asks never answered)", cfg: on(ASK), features: LEGACY, asks: true },
  { name: "#7b romance needs stated prefs (legacy snapshot: no prefs)", cfg: on(ROMANCE), features: LEGACY, asks: true },
  { name: "#7c snapshot romance prefs (engine v1.1)", cfg: V11, features: PREFS },
  { name: "#7d snapshot romance prefs + romance needs stated prefs", cfg: on(ROMANCE), features: PREFS, asks: true },
  { name: "#8 COMBO D: #1 + #5 + #3 + #2 + romance gate (legacy snapshot)", cfg: on(DISPATCH, BUDGET3, CATTHR, GROWTH, ROMANCE), features: LEGACY, asks: true },
  { name: "#8 COMBO D + #4 (signals)", cfg: on(DISPATCH, BUDGET3, CATTHR, GROWTH, ROMANCE, ACCEPT_SIG), features: LEGACY, asks: true },
  // Building the v1.2 default on the v1.2 snapshot (events, shareable interests, host tags, romance prefs).
  { name: "S0 v1.2 snapshot + event/group threshold 0.40 (engine otherwise v1.1)", cfg: on(GENTHR), features: NEW },
  { name: "S1 S0 + #1 dispatch-aware", cfg: on(GENTHR, DISPATCH), features: NEW },
  { name: "S2 S1 + #2 growth -> hobby", cfg: on(GENTHR, DISPATCH, GROWTH), features: NEW },
  { name: "S3 S2 + romance needs stated prefs", cfg: on(GENTHR, DISPATCH, GROWTH, ROMANCE), features: NEW, asks: true },
  { name: "S4 S3 + #4 acceptance order (Beta)", cfg: on(GENTHR, DISPATCH, GROWTH, ROMANCE, ACCEPT), features: NEW, asks: true },
  { name: "S5 S3 + #3 category thresholds", cfg: on(GENTHR, DISPATCH, GROWTH, ROMANCE, CATTHR), features: NEW, asks: true },
  { name: "S6 S3 + #7a ask before proposing", cfg: on(GENTHR, DISPATCH, GROWTH, ROMANCE, ASK), features: NEW, asks: true },
  { name: "S7 S3 + #5 budget 3/week", cfg: on(GENTHR, DISPATCH, GROWTH, ROMANCE, BUDGET3), features: NEW, asks: true },
  { name: "S8 S3 + #4 + #3", cfg: on(GENTHR, DISPATCH, GROWTH, ROMANCE, ACCEPT, CATTHR), features: NEW, asks: true },
  { name: "v1.1 engine on the v1.2 snapshot", cfg: V11, features: NEW },
  { name: "v1.2 defaults on the v1.2 snapshot", cfg: V12, features: NEW, asks: true },
  { name: "v1.2 defaults on the legacy snapshot", cfg: V12, features: LEGACY, asks: true },
  { name: "COMBO D preset on the v1.2 snapshot", cfg: on(PRESETS.comboD), features: NEW, asks: true },
  { name: "v1.2 defaults + ask before proposing", cfg: ASK, features: NEW, asks: true },
];

// ------------------------------------------------------------------ simulator
export interface SimRow {
  name: string; seeds: number[]; proposals: number; precision: number; perSeedPrecision: number[]; worthwhile: number; recall: number; zero: number; gini: number;
  allAccepted: number; metWorth: number; metWorthPerSeed: number[]; repeatPairs: number; proactive: number; asks: number;
  /** minorContacts must be 0. unsafeMinor: proposals touching an age-lying adversary (claims 18+, is not); the engine cannot see it. */
  minors: number; unsafeMinor: number; leaks: number; invariants: number; byGenerator: Record<string, number>; genPrecision: Record<string, number>;
}

export async function runVariant(v: Variant, seeds = SEEDS, gen?: Record<string, unknown>): Promise<SimRow> {
  const per: any[] = [];
  for (const seed of seeds) {
    let asks = 0;
    const res = await runSim({
      seed, cfg: v.cfg, gen, keepTraces: false, snapshot: { features: v.features, records: true, asks: v.asks },
      onRun: r => { asks += r.asks.length; },
    });
    const m = res.metrics;
    const outs = outcomes(res.records);
    const all = outs.filter(o => o.accepted.length >= (o.participants.length > 2 ? 3 : 2));
    const metWorth = outs.filter(o => o.held && o.showed.every(id => (o.enjoyment[id] ?? 0) >= 0.5));
    const pairCount = new Map<string, number>();
    for (const o of outs.filter(o => o.participants.length === 2 && o.dispatched).sort((a, b) => a.createdAt - b.createdAt)) {
      const k = pairKey(o.participants[0]!, o.participants[1]!); pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
    }
    const byGen: Record<string, number> = {}, genOk: Record<string, number> = {};
    for (const o of outs) { byGen[o.generator] = (byGen[o.generator] ?? 0) + 1; genOk[o.generator] = (genOk[o.generator] ?? 0) + (o.compatible ? 1 : 0); }
    per.push({
      proposals: m.proposals.total, precision: m.proposals.precision, worthwhile: m.experience.worthwhileRate, recall: m.proposals.recallPairs,
      zero: m.fairness.zeroProposalShare, gini: m.fairness.gini, allAccepted: all.length / Math.max(1, outs.length), metWorth: metWorth.length,
      repeatPairs: [...pairCount.values()].filter(c => c > 1).length, proactive: m.experience.proactivePerMemberPerWeek, asks,
      minors: m.safety.minorContacts, unsafeMinor: m.safety.undisclosedMinorProposals, leaks: m.privacy.canaryLeaks, invariants: m.invariants.total, byGen, genOk,
    });
  }
  const avg = (k: string) => mean(per.map(p => p[k]));
  const sum = (k: string) => per.reduce((s, p) => s + p[k], 0);
  const byGenerator: Record<string, number> = {}, genPrecision: Record<string, number> = {};
  for (const p of per) for (const [g, n] of Object.entries(p.byGen as Record<string, number>)) byGenerator[g] = (byGenerator[g] ?? 0) + n / per.length;
  for (const g of Object.keys(byGenerator)) genPrecision[g] = per.reduce((s, p) => s + (p.genOk[g] ?? 0), 0) / per.reduce((s, p) => s + (p.byGen[g] ?? 0), 0);
  return {
    name: v.name, seeds, proposals: avg("proposals"), precision: avg("precision"), perSeedPrecision: per.map(p => p.precision), worthwhile: avg("worthwhile"),
    recall: avg("recall"), zero: avg("zero"), gini: avg("gini"), allAccepted: avg("allAccepted"), metWorth: avg("metWorth"), metWorthPerSeed: per.map(p => p.metWorth),
    repeatPairs: avg("repeatPairs"), proactive: avg("proactive"), asks: avg("asks"),
    minors: sum("minors"), unsafeMinor: sum("unsafeMinor"), leaks: sum("leaks"), invariants: sum("invariants"), byGenerator, genPrecision,
  };
}

export const SIM_HEADER = ["variant", "proposals /seed", "precision", "persona worthwhile", "met + worthwhile /seed", "pair recall", "no proposal", "Gini", "repeat pairs /seed", "proactive /member/wk", "asks /seed", "minor contacts / leaks / violations"];
export function simRow(r: SimRow, base?: SimRow): (string | number)[] {
  const d = (x: number, b: number | undefined, scale = 100, dp = 1) => (b === undefined ? "" : ` (${x - b >= 0 ? "+" : ""}${((x - b) * scale).toFixed(dp)})`);
  return [r.name, r.proposals.toFixed(0), pct(r.precision) + d(r.precision, base?.precision), pct(r.worthwhile) + d(r.worthwhile, base?.worthwhile),
    r.metWorth.toFixed(1) + d(r.metWorth, base?.metWorth, 1), pct(r.recall) + d(r.recall, base?.recall), pct(r.zero) + d(r.zero, base?.zero),
    r.gini.toFixed(3), r.repeatPairs.toFixed(1), r.proactive.toFixed(2), r.asks.toFixed(0), `${r.minors} / ${r.leaks} / ${r.invariants}`];
}

// ------------------------------------------------------------------ synthetic snapshot (one tick, by richness tier)
const TIERS = ["minimal", "light", "medium", "rich", "very_rich"] as const;
const askable = (w: World, id: MemberId) => profileOf(w, id).wants.length === 0 || w.get(id)!.match.length < w.cfg.ask.minFacets;

/** Tick 2 of "ask": each asked member who answers (1 - ignoreProb) states their strongest live want with details. */
function answerQuestions(s: EngineInput, personas: Awaited<ReturnType<typeof loadPersonas>>, asked: Set<MemberId>): EngineInput & { answered: Set<MemberId> } {
  const answered = new Set<MemberId>();
  const byId = new Map(personas.map(p => [p.id, p]));
  const vague = new Set(Object.values(VAGUE_INTENT));
  const intents = [...s.intents];
  const facets = [...s.facets];
  for (const id of asked) {
    const p = byId.get(id); if (!p) continue;
    if (new SimRng(hash32("ask", id)).next() >= 1 - p.hidden.responsiveness.ignoreProb) continue;
    answered.add(id);
    const live = p.hidden.desires.filter(d => desireLive(d, s.now)).sort((a, b) => b.strength - a.strength)[0];
    if (!live) continue;
    const def: any = desireById.get(live.id);
    const details = def ? `format: ${def.format}; tags: ${[...def.needsInterests, ...def.needsSkills, def.pool ?? ""].filter(Boolean).join(",")}` : undefined;
    const existing = intents.findIndex(i => i.memberId === id && i.status === "active" && vague.has(i.objective));
    const rec = { id: `${id}:ask0`, memberId: id, objective: live.text, category: live.category, details, horizonDays: live.category === "romance" ? 90 : 60, status: "active" as const, createdAt: s.now - 3_600_000 };
    if (existing >= 0) intents[existing] = { ...intents[existing]!, objective: live.text, details, createdAt: rec.createdAt, status: "active" };
    else intents.push(rec);
    for (const t of p.public.statedInterests.slice(0, 2)) facets.push({ id: `${id}:askf:${t}`, memberId: id, kind: "interest", value: t.replace(/_/g, " "), tags: [t], scope: "matchable", provenance: "said", confidence: 0.8, validFrom: s.now - 3_600_000 } as any);
  }
  return { ...s, intents, facets, answered };
}

interface SynthVariant { name: string; cfg: EngineConfigInput; events?: boolean; twoTick?: boolean }
const SYNTH: SynthVariant[] = [
  { name: "baseline: engine-v1.1.0", cfg: V11 },
  { name: "#2 personal growth -> hobby", cfg: on(GROWTH) },
  { name: "#3 category thresholds", cfg: on(CATTHR) },
  { name: "#5 budget Normal 3/week", cfg: on(BUDGET3) },
  { name: "#6 events 6/city/week (engine v1.1)", cfg: V11, events: true },
  { name: "#6 events + event/group threshold 0.40", cfg: on(GENTHR), events: true },
  { name: "#7a ask, tick 1 (askable members held back)", cfg: on(ASK) },
  { name: "#7a ask, tick 2 (answers arrive)", cfg: on(ASK), twoTick: true },
  { name: "#7a' ask, hold thin profiles only (no-want members stay matchable), tick 1", cfg: on(ASK, { ask: { holdNoWant: false } }) },
  { name: "#7a' ask, hold thin profiles only, tick 2", cfg: on(ASK, { ask: { holdNoWant: false } }), twoTick: true },
  { name: "#7b romance needs stated prefs", cfg: on(ROMANCE) },
  { name: "#8 COMBO D (one tick)", cfg: on(DISPATCH, BUDGET3, CATTHR, GROWTH, ROMANCE) },
  { name: "v1.2 defaults (+ events in the snapshot)", cfg: V12, events: true },
  { name: "v1.2 defaults + ask, tick 1", cfg: ASK, events: true },
  { name: "v1.2 defaults + ask, tick 2 (answers arrive)", cfg: ASK, events: true, twoTick: true },
  { name: "COMBO D preset (+ events)", cfg: on(PRESETS.comboD), events: true },
];

export async function synthetic(only?: RegExp) {
  const base = await loadSnapshot() as EngineInput;
  const personas = await loadPersonas();
  const oracle = new Oracle(personas, 1, base.now);
  const latent = (["sf", "nyc"] as const).flatMap(c => oracle.latentPairs(personas.filter(p => p.homeCity === c).map(p => p.id), base.now));
  const latentSet = new Set(latent.map(l => pairKey(l.a, l.b)));
  const tier = new Map(personas.map(p => [p.id, p.hidden.richness ?? "none"]));
  const adults = base.members.filter(m => m.age >= 18).map(m => m.id);
  const minorIds = new Set(base.members.filter(m => !(m.age >= 18)).map(m => m.id));
  const evalRun = (props: EngineProposal[]) => {
    const vs = props.map(p => ({ p, v: oracle.evaluate({ id: p.id, kind: p.kind, participants: p.participants, city: p.city, window: p.window, category: p.category, objective: p.objective }) }));
    const pairs = new Set(props.flatMap(p => p.participants.flatMap((x, i) => p.participants.slice(i + 1).map(y => pairKey(x, y)))));
    const touched = new Set(props.flatMap(p => p.participants));
    const expMet = (sel: typeof vs) => sel.reduce((s, { v }) => s + Object.values(v.participants).reduce((q, x) => q * x.acceptProb * x.showProb, 1), 0);
    const byTier = Object.fromEntries(TIERS.map(t => {
      const ids = adults.filter(id => tier.get(id) === t);
      const tv = vs.filter(({ p }) => p.participants.some(x => tier.get(x) === t));
      return [t, { n: ids.length, cov: ids.filter(id => touched.has(id)).length / ids.length, prec: mean(tv.map(({ v }) => (v.compatible ? 1 : 0))), props: tv.length }];
    }));
    return {
      n: props.length, precision: mean(vs.map(({ v }) => (v.compatible ? 1 : 0))), recall: [...pairs].filter(k => latentSet.has(k)).length / latent.length,
      coverage: adults.filter(id => touched.has(id)).length / adults.length, expMet: expMet(vs), byTier,
      minors: props.filter(p => [...p.participants, ...p.alternates].some(x => minorIds.has(x))).length,
    };
  };
  const rows: (string | number)[][] = [];
  const tierRows: (string | number)[][] = [];
  const withEvents = (s: EngineInput) => ({ ...s, events: publicEvents(s, 6) }) as EngineInput;
  for (const v of SYNTH) {
    if (only && !only.test(v.name)) continue;
    let snap = v.events ? withEvents(base) : base;
    let res = tracedEngine(snap, { ...v.cfg, seed: 1 });
    let name = v.name;
    if (v.twoTick) {
      // Tick 2: everyone the engine held back with a question answers (or not), then the engine runs again.
      const asked = new Set(res.asks.filter(a => a.reason !== "romance_prefs").map(a => a.memberId));
      const fallback = new Set(res.world.ids.filter(id => res.world.get(id)!.m.age >= 18 && askable(res.world, id)));
      const who = asked.size ? asked : fallback;
      const ans = answerQuestions(snap, personas, who);
      snap = ans;
      const at = snap.now - 3_600_000;
      res = tracedEngine({ ...snap, recentAsks: res.asks.map(a => ({ memberId: a.memberId, at, reason: a.reason, ...(ans.answered.has(a.memberId) ? { answeredAt: snap.now - 1_800_000 } : {}) })) }, { ...v.cfg, seed: 1 });
      name = `${v.name} (asked ${who.size})`;
    }
    const e = evalRun(res.proposals);
    rows.push([name, e.n, pct(e.precision), pct(e.recall, 2), pct(e.coverage), e.expMet.toFixed(1), res.asks.length, e.minors]);
    tierRows.push([name, ...TIERS.map(t => { const x = e.byTier[t]!; return `${pct(x.cov, 0)} / ${pct(x.prec, 0)} (${x.props})`; })]);
  }
  return "## Synthetic snapshot (data/synthetic/v1, one tick, seed 1)\n\n"
    + table(["variant", "proposals", "precision", "pair recall", "adults with a proposal", "expected meetings", "asks", "minors in proposals"], rows)
    + "\n\n### By richness tier: adults with a proposal / precision (proposals touching the tier)\n\n"
    + table(["variant", ...TIERS.map(t => `${t} (${adults.filter(id => tier.get(id) === t).length})`)], tierRows);
}

if (import.meta.main) {
  const only = args.only ? new RegExp(args.only, "i") : undefined;
  const out: SimRow[] = [];
  if (!args["synthetic-only"]) {
    let base: SimRow | undefined;
    const rows: (string | number)[][] = [];
    for (const v of VARIANTS) {
      if (only && !only.test(v.name) && !v.name.startsWith("baseline")) continue;
      const t0 = performance.now();
      const r = await runVariant(v, SEEDS, args.richness ? { richness: true } : undefined);
      if (v.name.startsWith("baseline")) base = r;
      out.push(r);
      rows.push(simRow(r, v.name.startsWith("baseline") ? undefined : base));
      process.stderr.write(`${v.name}: ${Math.round(performance.now() - t0)}ms\n`);
    }
    console.log(`## Simulator (seeds ${SEEDS.join(",")}, 150 personas, 30 days, stub network, history fed${args.richness ? ", richness tiers" : ""})\n\n` + table(SIM_HEADER, rows));
    if (args.json) await Bun.write(args.json, JSON.stringify(out, null, 1));
  }
  if (!args["sim-only"] && !args.richness) console.log("\n" + await synthetic(only));
  void DEFAULT_CONFIG;
}
