// Shared harness for the offline match-failure and diversity experiments (2026-10-07).
//
// - tracedEngine: runEngine (src/engine.ts) without the LLM passes, rebuilt from the same
//   exported stages so every candidate's fate is visible (generated -> hard filters -> dedupe ->
//   floors -> threshold -> selection). With no hooks it reproduces runEngine's proposals exactly
//   (experiments/verify.ts checks this).
// - runSim: the simulator world (packages/sim) driven by tracedEngine with config overrides and
//   optional harness hooks (snapshot augmentation, re-ranking, selection levers).
// - oracle helpers: chemistry draw, systematic (chemistry-free) enjoyment, pair decomposition.
//
// HARNESS ONLY. The engine never reads hidden truth here; hidden truth is read only to score.
import type { Category, MemberId, Proposal, WorldSnapshot } from "@thenetwork/core";
import { DAY } from "@thenetwork/core";
import { resolveConfig, type EngineConfigInput } from "../src/config.ts";
import { localEmbed } from "../src/embed.ts";
import { explain } from "../src/explain.ts";
import { candidateReason, involvesMinor } from "../src/filters.ts";
import { GENERATORS, type GenCtx } from "../src/generators.ts";
import { planAsks, selectProposals, updateExposureDebt, gini, type SelectionResult } from "../src/policy.ts";
import { Rng, sha256 } from "../src/rng.ts";
import { scoreCandidate, type Scored } from "../src/scoring.ts";
import type { Candidate, EngineAsk, EngineInput, EngineProposal } from "../src/types.ts";
import { World, pairKey } from "../src/world.ts";
import { selectX, type SelectLevers } from "./select.ts";

import { generatePersonas } from "../../sim/src/generator.ts";
import { Oracle, PAIR_CHEMISTRY_SD } from "../../sim/src/oracle.ts";
import type { Persona } from "../../sim/src/persona.ts";
import { Rng as SimRng, hash32 } from "../../sim/src/rng.ts";
import { buildSnapshot, type SnapshotFeatures } from "../../sim/src/snapshot.ts";
import { StubNetwork } from "../../sim/src/stubNetwork.ts";
import { World as SimWorld, DEFAULT_START } from "../../sim/src/world.ts";
import type { RunRecord } from "../../judge/src/index.ts";

export { pairKey, gini };

// ------------------------------------------------------------------------------------------
// Traced engine

export interface TraceRow {
  key: string; generator: string; kind: string; category: Category; participants: MemberId[];
  exploration: boolean; channels: string[];
  /** First failing hard filter (candidateReason), or undefined if it passed. */
  filter?: string;
  /** Lost to a better-scoring candidate with the same participant set. */
  deduped?: boolean;
  score?: number; threshold?: number; eligible?: boolean; reason?: string; complementarity?: number;
  fit?: number; mutualBenefit?: number; confidence?: number;
  selected?: boolean; selExploration?: boolean;
}

export interface Hooks {
  /** Adjust scored candidates before selection (return a new array; keep reason/eligible coherent). */
  rescore?: (w: World, scored: Scored[]) => Scored[];
  /** Selection levers (experiments/select.ts). Undefined = the engine's own selectProposals. */
  levers?: SelectLevers | ((w: World) => SelectLevers);
  /** Drop selected candidates (e.g. "ask a question instead"); returns the kept list. */
  postSelect?: (w: World, sel: SelectionResult["selected"]) => SelectionResult["selected"];
}

export interface TracedResult {
  proposals: EngineProposal[]; asks: EngineAsk[]; trace: TraceRow[]; scored: Scored[]; world: World;
  exposureDebt: Record<MemberId, number>; selected: SelectionResult["selected"];
}

export function tracedEngine(input: EngineInput, cfgIn: EngineConfigInput = {}, hooks: Hooks = {}): TracedResult {
  const cfg = resolveConfig(cfgIn);
  const rng = new Rng(cfg.seed);
  const w = new World(input, cfg, localEmbed);
  const memberExclusions: Record<string, number> = {};
  const ctx: GenCtx = { w, memberExclusions, rng: rng.fork("gen"), unmatchedIntents: new Set() };
  const cands: Candidate[] = [];
  for (const g of GENERATORS) { if (!cfg.generators[g.name]) continue; cands.push(...g.run(ctx)); }
  const rows = new Map<Candidate, TraceRow>();
  const trace: TraceRow[] = [];
  const passed: Candidate[] = [];
  for (const c of cands) {
    const row: TraceRow = { key: c.key, generator: c.generator, kind: c.kind, category: c.category, participants: [...c.participants], exploration: c.exploration, channels: [...c.channels] };
    trace.push(row); rows.set(c, row);
    const r = candidateReason(w, c);
    if (r) { row.filter = r; continue; }
    if (!cfg.cities.includes(c.city!)) { row.filter = "city_not_in_run"; continue; }
    passed.push(c);
  }
  let scored: Scored[] = passed.map(c => scoreCandidate(w, c));
  const bySet = new Map<string, Scored>();
  for (const s of scored) {
    const k = [...s.c.participants].sort().join(",");
    const cur = bySet.get(k);
    if (!cur || s.score > cur.score || (s.score === cur.score && s.c.key < cur.c.key)) bySet.set(k, s);
  }
  const kept = new Set(bySet.values());
  for (const s of scored) {
    const row = rows.get(s.c)!;
    Object.assign(row, { score: s.score, threshold: s.threshold, eligible: s.eligible, reason: s.reason, complementarity: s.complementarity, fit: s.components.fit, mutualBenefit: s.components.mutualBenefit, confidence: s.components.confidence });
    if (!kept.has(s)) row.deduped = true;
  }
  scored = [...bySet.values()].sort((a, b) => (a.c.key < b.c.key ? -1 : 1));
  if (hooks.rescore) scored = hooks.rescore(w, scored);
  const priorDebt: Record<MemberId, number> = {};
  for (const [k, v] of Object.entries(input.exposureDebt ?? {})) priorDebt[w.canonical(k)] = (priorDebt[w.canonical(k)] ?? 0) + v;
  const levers = typeof hooks.levers === "function" ? hooks.levers(w) : hooks.levers;
  const askPlan = planAsks(w, input);
  const sopts = { exclude: askPlan.exclude, extraProactive: askPlan.extraProactive };
  const selection = levers ? selectX(w, scored, rng.fork("select"), priorDebt, levers, sopts) : selectProposals(w, scored, rng.fork("select"), priorDebt, sopts);
  let selected = selection.selected.filter(x => !involvesMinor(w, x.s.c));
  if (hooks.postSelect) selected = hooks.postSelect(w, selected);
  const byCand = new Map(scored.map(s => [s.c, s]));
  for (const s of selected) { const row = rows.get(s.s.c)!; row.selected = true; row.selExploration = s.exploration; }
  void byCand;
  const proposals: EngineProposal[] = selected.map(sel => {
    const { c, components, score, threshold, verdict } = sel.s;
    const { explanations, objective } = explain(w, c, verdict as any, sel.s.memberWhy);
    const sameDay = c.window ? c.window.start - w.now < 24 * 3_600_000 : false;
    return {
      id: `p_${sha256(`${c.key}|${w.now}`).slice(0, 16)}`,
      kind: c.kind, participants: [...c.participants], alternates: [...c.alternates], objective,
      city: c.city!, window: c.window ? { ...c.window } : undefined, score: round(score), components: roundAll(components),
      exploration: sel.exploration || c.exploration, explanations, generator: c.generator, createdAt: w.now,
      category: c.category, roles: { ...c.roles }, expiresAt: w.now + (sameDay ? cfg.sameDayInviteTtlMs : cfg.inviteTtlMs),
      anchor: c.anchor ? { ...c.anchor } : undefined, via: c.via, safetyClass: c.safetyClass, threshold,
      channels: [...c.channels].sort(), judged: !!verdict, selectorRank: sel.rank, selectionProbability: round(sel.probability),
    };
  });
  const exposureDebt = updateExposureDebt(w, priorDebt, scored, selected);
  return { proposals, asks: askPlan.asks, trace, scored, world: w, exposureDebt, selected };
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;
function roundAll<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v as number)])) as T;
}

// ------------------------------------------------------------------------------------------
// Simulator runs

export interface EngineRunLog { now: number; city: string; trace: TraceRow[]; snapshotMembers: number }

export interface SimOptions {
  seed: number; personas?: number; days?: number; cfg?: EngineConfigInput; hooks?: Hooks | ((ctx: SimHookCtx) => Hooks);
  /** Generator options passed through (e.g. richness: true, intentLapse). */
  gen?: Record<string, unknown>;
  /** Augment / modify the engine input each night (harness side: history, debt, events...). */
  augment?: (snap: EngineInput, ctx: SimHookCtx) => EngineInput;
  /** Keep traces (memory heavy on long runs). Default true. */
  keepTraces?: boolean;
  /** Called after every nightly engine run (per city). */
  onRun?: (res: TracedResult, ctx: SimHookCtx, input: EngineInput) => void;
  /**
   * Rebuild each night's snapshot with these sim snapshot features and, with `records`, the
   * Network's own records (interactions, feedback, open opportunities, unsent proposals) -- the
   * buildSnapshot call packages/sim world.ts would make with the 2026-10-07 proposal applied.
   * `asks`: feed the engine's earlier asks back as input.recentAsks (the Network sent them; the
   * simulated members never answer). Undefined = the world's own snapshot, unchanged.
   */
  snapshot?: { features?: Partial<SnapshotFeatures>; records?: boolean; asks?: boolean };
}

export interface SimHookCtx { world: SimWorld; personas: Persona[]; city: string; now: number; state: Record<string, any> }

export interface SimResult {
  seed: number; metrics: any; records: RunRecord[]; personas: Persona[]; runs: EngineRunLog[]; oracle: Oracle; start: number; end: number;
}

export async function runSim(o: SimOptions): Promise<SimResult> {
  const n = o.personas ?? 150, days = o.days ?? 30;
  const personas = generatePersonas({ n, seed: o.seed, joinSpreadDays: Math.min(7, days), ...(o.gen ?? {}) } as any);
  const runs: EngineRunLog[] = [];
  const state: Record<string, any> = {};
  let world!: SimWorld;
  const engine = {
    name: "engine-v1-traced",
    async propose(snapshot: WorldSnapshot, opts?: { city?: string; seed?: number | string }): Promise<Proposal[]> {
      const seed = typeof opts?.seed === "number" ? opts.seed : 1;
      const hctx: SimHookCtx = { world, personas, city: opts?.city ?? "", now: snapshot.now, state };
      let input = snapshot as EngineInput;
      if (o.snapshot) {
        const W = world as any; // the world's own snapshot inputs (private fields; harness only)
        input = buildSnapshot([...W.personas.values()], {
          now: snapshot.now, worldStart: W.start, joined: W.joined, optedOut: W.optedOut, blocks: W.blocks, unanswered: W.unanswered,
          recentProposals: [...W.proposals.values()], features: o.snapshot.features, records: o.snapshot.records ? world.records : undefined,
        }) as EngineInput;
        if (o.snapshot.asks) input = { ...input, recentAsks: state.asks ?? [] };
      }
      if (o.augment) input = o.augment(input, hctx);
      const hooks = typeof o.hooks === "function" ? o.hooks(hctx) : (o.hooks ?? {});
      const res = tracedEngine(input, { ...(o.cfg ?? {}), seed, ...(opts?.city ? { cities: [opts.city as any] } : {}) }, hooks);
      state.lastDebt = { ...(state.lastDebt ?? {}), ...res.exposureDebt };
      if (res.asks.length) state.asks = [...(state.asks ?? []), ...res.asks.map(a => ({ memberId: a.memberId, at: a.createdAt, reason: a.reason }))];
      o.onRun?.(res, hctx, input);
      if (o.keepTraces !== false) runs.push({ now: snapshot.now, city: opts?.city ?? "", trace: res.trace, snapshotMembers: snapshot.members.length });
      return opts?.city ? res.proposals.filter(p => p.city === opts.city) : res.proposals;
    },
  };
  world = new SimWorld({ seed: o.seed, personas, days, mode: "discrete", network: new StubNetwork({ seed: o.seed, randomIntros: false }), engine: engine as any, writeLog: false });
  const res = await world.run();
  return { seed: o.seed, metrics: res.metrics, records: res.records, personas, runs, oracle: world.oracle, start: DEFAULT_START, end: DEFAULT_START + days * DAY };
}

// ------------------------------------------------------------------------------------------
// Proposal outcomes from sim records

export interface PropOutcome {
  id: string; generator: string; category: string; kind: string; participants: MemberId[]; createdAt: number; city: string;
  exploration: boolean; compatible: boolean; quality: number; flags: string[];
  dispatched: boolean; invited: MemberId[]; accepted: MemberId[]; declined: MemberId[]; ignored: MemberId[];
  worthwhile: Record<MemberId, boolean>; acceptProb: Record<MemberId, number>;
  scheduled: boolean; held: boolean; showed: MemberId[]; enjoyment: Record<MemberId, number>;
}

export function outcomes(records: RunRecord[]): PropOutcome[] {
  const out = new Map<string, PropOutcome>();
  const msgToProp = new Map<string, string>();
  for (const r of records as any[]) {
    if (r.type === "proposal") {
      const p = r.proposal;
      out.set(p.id, {
        id: p.id, generator: p.generator, category: p.category ?? "none", kind: p.kind, participants: p.participants, createdAt: p.createdAt, city: p.city,
        exploration: !!p.exploration, compatible: r.oracle.compatible, quality: r.oracle.quality, flags: r.oracle.flags,
        dispatched: true, invited: [], accepted: [], declined: [], ignored: [], worthwhile: {},
        acceptProb: Object.fromEntries(Object.entries(r.oracle.participants ?? {}).map(([id, x]: [string, any]) => [id, x.acceptProb])),
        scheduled: false, held: false, showed: [], enjoyment: {},
      });
    } else if (r.type === "network_log" && r.kind === "proposal_skipped") {
      const o = out.get(r.detail.proposalId); if (o) o.dispatched = false;
    } else if (r.type === "message" && r.msg.meta?.type === "proposal" && r.msg.meta?.proposalId) {
      msgToProp.set(r.msg.id, r.msg.meta.proposalId);
      const o = out.get(r.msg.meta.proposalId); if (o && !o.invited.includes(r.msg.memberId)) o.invited.push(r.msg.memberId);
    } else if (r.type === "decision" && r.messageType === "proposal") {
      const pid = r.proposalId ?? msgToProp.get(r.messageId); const o = pid ? out.get(pid) : undefined; if (!o) continue;
      if (r.intent === "ignore") o.ignored.push(r.memberId);
      else if (r.decision === "accept" || r.decision === "counter") o.accepted.push(r.memberId);
      else if (r.decision === "decline") o.declined.push(r.memberId);
    } else if (r.type === "judgment") {
      const pid = msgToProp.get(r.messageId); const o = pid ? out.get(pid) : undefined; if (o) o.worthwhile[r.memberId] = r.worthwhile;
    } else if (r.type === "meeting_scheduled") {
      const o = out.get(r.proposalId); if (o) o.scheduled = true;
    } else if (r.type === "outcome") {
      const o = out.get(r.proposalId); if (!o) continue;
      const shows = Object.entries(r.attendance as Record<string, any>).filter(([, a]) => a.showed);
      if (shows.length >= 2) { o.held = true; o.showed = shows.map(([id]) => id); for (const [id, a] of shows) o.enjoyment[id] = a.enjoyment; }
    }
  }
  return [...out.values()];
}

// ------------------------------------------------------------------------------------------
// Oracle helpers

export function chem(seed: number | string, a: MemberId, b: MemberId): number {
  return new SimRng(hash32(seed, "chem", ...[a, b].sort())).normal(0, PAIR_CHEMISTRY_SD);
}

/** Pair verdict at `at` plus the chemistry draw and chemistry-free ("systematic") enjoyment. */
export function pairTruth(oracle: Oracle, seed: number | string, a: MemberId, b: MemberId, city: any, at: number, category?: Category) {
  const v = oracle.evaluate({ id: `x:${a}:${b}`, kind: "intro", participants: [a, b], city, window: { start: at, end: at }, ...(category ? { category } : {}) });
  const c = chem(seed, a, b);
  const sysA = v.participants[a]!.enjoyment - c, sysB = v.participants[b]!.enjoyment - c;
  return { v, chem: c, sysMin: Math.min(sysA, sysB), sysGood: !v.flags.some(f => ["minor_included", "romance_mismatch", "ex_partners", "adversarial_participant", "city_mismatch", "unknown_member"].includes(f)) && Math.min(sysA, sysB) >= 0.55 };
}

/** Why the oracle likes a pair: best desire-satisfaction kind from a to b (hidden truth). */
export function satisfactionKind(oracle: Oracle, a: MemberId, b: MemberId, desireById: Map<string, any>): "skill" | "pool" | "interest" | "romance" | "none" {
  const A = oracle.persona(a)!, B = oracle.persona(b)!;
  let best: [number, any] = [0, "none"];
  for (const d of A.hidden.desires) {
    const def = desireById.get(d.id); if (!def) continue;
    let s = 0, k: any = "none";
    if (def.category === "romance") { s = 0.9; k = "romance"; }
    else if (def.needsSkills.some((x: string) => B.hidden.skills.includes(x))) { s = 1; k = "skill"; }
    else if (def.pool && B.hidden.desires.some(o => desireById.get(o.id)?.pool === def.pool)) { s = 0.85; k = "pool"; }
    else if (def.needsInterests.some((t: string) => B.hidden.interests.includes(t))) { s = 0.45; k = "interest"; }
    if (s * d.strength > best[0]) best = [s * d.strength, k];
  }
  return best[1];
}

// ------------------------------------------------------------------------------------------
// Small stats helpers

export const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
export const pct = (x: number, d = 1) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : "n/a");
export const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : "n/a");
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (!n) return [NaN, NaN];
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), s = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - s) / d, (c + s) / d];
}
export function entropy(counts: number[]): number {
  const t = counts.reduce((s, x) => s + x, 0); if (!t) return 0;
  return -counts.filter(x => x > 0).reduce((s, x) => s + (x / t) * Math.log2(x / t), 0);
}
export function table(header: string[], rows: (string | number)[][]): string {
  const line = (cs: (string | number)[]) => `| ${cs.map(String).join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n");
}
export function countBy<T>(xs: T[], f: (x: T) => string): Record<string, number> {
  const m: Record<string, number> = {};
  for (const x of xs) { const k = f(x); m[k] = (m[k] ?? 0) + 1; }
  return m;
}
