// Policy, fairness and exploration (Sections 15.4, 33.8). One global selection per run under
// constraints (per-member interruption + contribution budgets, no repeated pairs, no
// time-overlapping fixed-time commitments, per-city caps, the pack's refusals), driven by the
// generated selectionRun machine: an exposure-floor pass ordered by exposure debt, a seeded
// exploration slice sized before it reserves and logged with selection probabilities for
// off-policy evaluation, then one greedy walk over the eligible configurations sorted once by value.
import { gini } from "@thenetwork/core";
import { countPublishedQuestions, initial as initialAskRun, questionSubjectAllowed, step as stepAskRun } from "../../core/src/generated/engineAsks.ts";
import {
  canReserveSelection, initial, selectionMemberFullAt, step,
  type Event as SelectionEvent, type SelectionChoice, type SelectionMember, type SelectionRun,
} from "../../core/src/generated/selectionRun.ts";
export { gini };
import type { MemberId } from "@thenetwork/core";
import { isMinor } from "./filters.ts";
import { sha256 } from "./hash.ts";
import type { EngineRng as Rng } from "@thenetwork/core";
import { explorationBar, type Scored } from "./scoring.ts";
import type { AskReason, EngineAsk, EngineInput, FairnessMetrics } from "./types.ts";
import { ASK_QUESTIONS as NETWORK_ASK_QUESTIONS } from "./packs/network/copy.ts";
import { pairKey, type World } from "./world.ts";

/**
 * A selected configuration. `value` is its greedy order value; absent for exposure-floor,
 * exploration and pack-assigned picks. An exploration pick's `probability` is its weight over the
 * draws not yet passed, which still include draws found infeasible only later: a lower bound on the
 * true propensity among the feasible draws.
 */
export interface Selected { s: Scored; exploration: boolean; rank: number; probability: number; value?: number }

export interface SelectionResult { selected: Selected[]; budgetSkips: number }

export interface SelectOptions {
  /** Members that must not be proposed this run (v1.2: members the engine asks a question first). */
  exclude?: ReadonlySet<MemberId>;
  /** Proactive messages already planned this run outside selection (v1.2: asks), per member. */
  extraProactive?: ReadonlyMap<MemberId, number>;
}

/** The Network's ask texts (moved verbatim to packs/network/copy.ts; the engine reads the pack's selection.askQuestions). */
export const ASK_QUESTIONS: Record<AskReason, string> = NETWORK_ASK_QUESTIONS;

export interface AskPlan { asks: EngineAsk[]; exclude: Set<MemberId>; extraProactive: Map<MemberId, number> }

/**
 * Pack asks (selection.extraAsks): networkPack asks members with a live romance intent but no
 * stated preferences for them (config.romance.requireStatedPrefs); romance proposals wait for the
 * answer (generators.ts romanceIntros). slopPack asks for missing matching information.
 * Proposal selection includes planned questions in its proactive capacity.
 */
export function planAsks(w: World, input: EngineInput): AskPlan {
  const cfg = w.cfg;
  const plan: AskPlan = { asks: [], exclude: new Set(), extraProactive: new Map() };
  const S = w.pack.selection;
  let askRun = stepAskRun(initialAskRun, { type: "setAvailability", configured: !!S.extraAsksEnabled?.(cfg) });
  if (askRun.phase !== "PlanningQuestions") return plan;
  const lastAsk = new Map<string, number>();
  for (const a of input.recentAsks ?? []) {
    const k = `${w.canonical(a.memberId)}|${a.reason}`;
    lastAsk.set(k, Math.max(lastAsk.get(k) ?? -Infinity, a.at));
  }
  const anyAsk = (id: MemberId, reasons: AskReason[]) => Math.max(-Infinity, ...reasons.map(r => lastAsk.get(`${id}|${r}`) ?? -Infinity));
  const add = (id: MemberId, reason: AskReason, intentId: string | undefined, adult: boolean, supportedMarket: boolean) => {
    const reserved = stepAskRun(askRun, { type: "reserveQuestion", memberId: id, adult, supportedMarket });
    if (reserved === askRun) return;
    askRun = reserved;
    plan.asks.push({ kind: "ask", id: `a_${sha256(`${id}|${reason}|${w.now}`).slice(0, 16)}`, memberId: id, reason, question: S.askQuestions[reason]!, createdAt: w.now, ...(intentId ? { intentId } : {}) });
  };
  for (const id of w.ids) {
    const mi = w.get(id)!;
    const adult = !isMinor(w, id);
    const supportedMarket = adult && w.pack.geo.markets(cfg).includes(mi.m.homeCity);
    if (!questionSubjectAllowed(askRun, adult, supportedMarket)) continue;
    S.extraAsks?.(w, id, mi, reasons => anyAsk(id, reasons as AskReason[]), (reason, intentId) => add(id, reason as AskReason, intentId, adult, supportedMarket));
  }
  askRun = stepAskRun(askRun, { type: "publishQuestions" });
  for (const { memberId } of plan.asks) plan.extraProactive.set(memberId, countPublishedQuestions(askRun, memberId));
  return plan;
}

type ReserveEvent = Extract<SelectionEvent, { type: "reserveSelection" }>;

const byKey = (a: Scored, b: Scored) => (a.c.key < b.c.key ? -1 : a.c.key > b.c.key ? 1 : 0);
const valueOf = (x: Scored) => Math.round(x.score * 1000);
const bump = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);

/** What a run has used: O(1) mirrors of the machine's counts, plus the fixed windows it holds. */
interface Use {
  keys: Set<string>; pairs: Set<string>; cities: Map<string, number>;
  proactive: Map<MemberId, number>; contribution: Map<MemberId, number>; windows: Map<MemberId, readonly (readonly [number, number])[]>;
}
const emptyUse = (): Use => ({ keys: new Set(), pairs: new Set(), cities: new Map(), proactive: new Map(), contribution: new Map(), windows: new Map() });
const copyUse = (u: Use): Use => ({
  keys: new Set(u.keys), pairs: new Set(u.pairs), cities: new Map(u.cities),
  proactive: new Map(u.proactive), contribution: new Map(u.contribution), windows: new Map(u.windows),
});

/**
 * The shell's checks, each O(1) per member or pair (fixed windows: per window held). A pack's hard
 * refusal (peonPack: a job's slate cap and a candidate's weekly cap) is its selection hook returning
 * -Infinity; a refusal must stay a refusal as use grows. Its other lifts do not enter the value.
 */
function selectionShell(w: World, opts: SelectOptions) {
  const cfg = w.cfg;
  const cache = new Map<Scored, SelectionChoice>();
  const choiceFor = (x: Scored): SelectionChoice => {
    const known = cache.get(x);
    if (known) return known;
    const c = x.c;
    const members: SelectionMember[] = c.participants.map(id => {
      const mi = w.get(id)!;
      const role = c.roles[id];
      return {
        id, unavailable: Boolean(mi.inOpenOpportunity || opts.exclude?.has(id)),
        priorProactive: mi.recentProactive + (opts.extraProactive?.get(id) ?? 0),
        proactiveLimit: cfg.budgets[mi.m.state].limit,
        contributor: !!role && w.pack.ontology.contributorRoles.has(role),
        priorContribution: mi.recentContribution, contributionLimit: cfg.contribution.limit,
      };
    });
    const pairKeys: string[] = [];
    for (let i = 0; i < c.participants.length; i++) for (let j = i + 1; j < c.participants.length; j++) {
      pairKeys.push(pairKey(c.participants[i]!, c.participants[j]!));
    }
    const choice = { candidateKey: c.key, city: c.city!, cityLimit: cfg.selection.maxProposalsPerCity, members, pairKeys };
    cache.set(x, choice);
    return choice;
  };
  // spec/selectionRun.md, "A greedy refusal names a member who stays without room"
  const full = (u: Use, m: SelectionMember) => selectionMemberFullAt(m, u.proactive.get(m.id) ?? 0, u.contribution.get(m.id) ?? 0);
  // spec/selectionRun.md, "Each reservation checks the city, pair, and member limits"
  const limitsOpen = (u: Use, c: SelectionChoice) =>
    !u.keys.has(c.candidateKey) && (u.cities.get(c.city) ?? 0) < c.cityLimit && c.pairKeys.every(k => !u.pairs.has(k));
  // The two inputs of the reservation guard that only the shell can compute: no participant holds an
  // overlapping fixed window, and the pack does not refuse the choice.
  const timeFree = (u: Use, x: Scored) => {
    const window = x.c.fixedWindow ? x.c.window : undefined;
    return !window || x.c.participants.every(id => !(u.windows.get(id) ?? []).some(([s, e]) => window.start < e && s < window.end));
  };
  const packAllows = (u: Use, x: Scored) => {
    const adjust = w.pack.selection.adjust;
    return !adjust || adjust(w, x.c, x.score, id => u.proactive.get(id) ?? 0) !== -Infinity;
  };
  /** The O(1) mirrors of the machine's room checks: they only skip choices the guard would refuse. */
  const fits = (u: Use, x: Scored) => {
    const c = choiceFor(x);
    return limitsOpen(u, c) && c.members.every(m => !full(u, m));
  };
  /** The whole guard on a copy of the use, without the machine (the exploration size estimate and the diagnostic). */
  const allows = (u: Use, x: Scored) => fits(u, x) && timeFree(u, x) && packAllows(u, x);
  // spec/selectionRun.md, "Reserving a proposal consumes its slots together"
  const record = (u: Use, x: Scored) => {
    const c = choiceFor(x);
    u.keys.add(c.candidateKey);
    for (const k of c.pairKeys) u.pairs.add(k);
    bump(u.cities, c.city);
    for (const m of c.members) {
      bump(u.proactive, m.id);
      if (m.contributor) bump(u.contribution, m.id);
    }
    const window = x.c.fixedWindow ? x.c.window : undefined;
    if (window) for (const id of x.c.participants) u.windows.set(id, [...(u.windows.get(id) ?? []), [window.start, window.end]]);
  };
  return { choiceFor, full, limitsOpen, timeFree, packAllows, fits, allows, record };
}

/**
 * spec/selectionRun.md, "Exposure selection precedes exploration and greedy selection": the members
 * the exposure floor serves before any other pick, and how many it serves this run. A member
 * qualifies with low recent exposure and either no proposal in 30 days, little profile data, or a
 * recent join. The highest carried exposure debt goes first, in a seeded order among equal debt.
 * Every selector runs it, a pack's own assignment (slopPack) included. It never reads a rating or a
 * standing.
 */
export function exposureFloor(w: World, rng: Rng, debt: Readonly<Record<MemberId, number>>): { members: MemberId[]; cap: number } {
  const cfg = w.cfg;
  const carried = (id: MemberId) => Math.min(cfg.selection.exposureDebtCap, Math.max(0, debt[id] ?? 0));
  const members = rng.fork("floor").shuffle(w.ids.filter(id => {
    const mi = w.get(id)!;
    return mi.lowExposure && (mi.newcomer || mi.lowData || mi.recentExposure30 === 0);
  })).sort((a, b) => carried(b) - carried(a));
  return { members, cap: Math.ceil(cfg.selection.exposureFloorShare * cfg.selection.maxProposalsPerCity * w.pack.geo.markets(cfg).length) };
}

/**
 * One selection run. The shell decides each choice once with O(1) checks and steps the generated
 * machine only to reserve or refuse, so the shell work is O(S log S + S k) for S scored
 * configurations of up to k members. Each machine step still copies its maps and scans its
 * refusals (spec/selectionRun.md), O(selected + refused) per reservation or refusal.
 */
export function selectProposals(w: World, scored: Scored[], rng: Rng, debt: Record<MemberId, number>, opts: SelectOptions = {}): SelectionResult {
  // A pack's own global assignment (slopPack: the exposure floor, then a greedy walk per round). Absent for networkPack.
  const assign = w.pack.selection.assign;
  if (assign) return assign(w, scored, { rng, debt, exclude: opts.exclude, extraProactive: opts.extraProactive });
  const cfg = w.cfg;
  const shell = selectionShell(w, opts);
  let run: SelectionRun = initial;
  const use = emptyUse();
  const selected: Selected[] = [];
  const advance = (event: SelectionEvent) => {
    const next = step(run, event);
    if (next === run) throw new Error(`selectionRun refused ${event.type} that the shell allowed`);
    run = next;
  };
  // spec/selectionRun.md, "Each reservation checks the city, pair, and member limits": the generated
  // guard decides every reservation, in every pass, with the fixed windows and the pack's refusal as
  // its inputs. The shell's mirrors (fits) only skip choices early and must agree with the guard.
  const reservation = (x: Scored, exploring: boolean, value: number): ReserveEvent => ({
    type: "reserveSelection", choice: shell.choiceFor(x), timeFree: shell.timeFree(use, x), exploring, packAllows: shell.packAllows(use, x), value,
  });
  const admits = (x: Scored, exploring: boolean) => {
    if (!shell.fits(use, x)) return false;
    const e = reservation(x, exploring, valueOf(x));
    return canReserveSelection(run, e.choice, e.timeFree, e.exploring, e.packAllows, e.value);
  };
  /** Step the machine for a choice the mirrors let through; false when its guard refuses the window or the pack's refusal. */
  const tryReserve = (x: Scored, exploring: boolean, probability: number, value?: number): boolean => {
    const event = reservation(x, exploring, value ?? valueOf(x));
    const next = step(run, event);
    if (next === run) {
      if (event.timeFree && event.packAllows) throw new Error("selectionRun refused reserveSelection that the shell allowed");
      return false;
    }
    run = next;
    shell.record(use, x);
    selected.push({ s: x, exploration: exploring, rank: selected.length, probability, ...(value === undefined ? {} : { value }) });
    return true;
  };

  // spec/selectionRun.md, "Greedy decisions never rise in value": one order, value descending, key ascending.
  const greedy = scored.filter(x => x.eligible && !x.c.exploration && Number.isFinite(x.score))
    .map(x => ({ x, value: valueOf(x) }))
    .sort((a, b) => (b.value - a.value) || byKey(a.x, b.x));
  const byMember = new Map<MemberId, Scored[]>();
  for (const { x } of greedy) for (const id of x.c.participants) {
    if (!byMember.has(id)) byMember.set(id, []);
    byMember.get(id)!.push(x);
  }

  // 1. Exposure floor: each floor member gets their best option that fits.
  const { members: floorMembers, cap: floorCap } = exposureFloor(w, rng, debt);
  let floorTaken = 0;
  for (const id of floorMembers) {
    if (floorTaken >= floorCap) break;
    if ((use.proactive.get(id) ?? 0) > 0) continue;
    if ((byMember.get(id) ?? []).some(x => shell.fits(use, x) && tryReserve(x, false, 1))) floorTaken++;
  }

  // spec/selectionRun.md, "Exposure selection precedes exploration and greedy selection"
  advance({ type: "beginExploration" });
  // 2. Exploration slice: `rate` of the run, at most `maxShare` of it. The run's size is estimated by
  // one walk of the greedy order on a copy of the use (no machine steps): the greedy picks that
  // would follow the floor without exploration.
  const sizing = copyUse(use);
  let greedyEstimate = 0;
  for (const { x } of greedy) if (shell.allows(sizing, x)) { shell.record(sizing, x); greedyEstimate++; }
  const runSize = floorTaken + greedyEstimate;
  const slots = Math.min(Math.floor((cfg.exploration.rate * runSize) / (1 - cfg.exploration.rate)), Math.floor(cfg.exploration.maxShare * runSize));
  if (slots > 0) {
    const explore = rng.fork("explore");
    // Allow-list: only eligible or merely below-threshold configurations; anything a judge pass, a
    // floor, a dealbreaker or a hard gate rejected never enters, nor does a pass-2 "no".
    // Weighted draws without replacement as one seeded order (key log(u) / weight, highest first);
    // expansion picks (33.4) are weighted x8 and every other draw prefers them.
    const all = scored.filter(x => Number.isFinite(x.score) && !use.keys.has(x.c.key) && (!x.reason || x.reason === "below_threshold")
      && x.verdict?.verdict !== "no" && x.score >= explorationBar(w, x.c, x.threshold))
      .sort(byKey)
      .map(x => {
        const weight = Math.max(0.01, x.components.novelty * x.score) * (x.c.exploration ? 8 : 1);
        return { x, weight, draw: Math.log(1 - explore.next()) / weight };
      })
      .sort((a, b) => (b.draw - a.draw) || byKey(a.x, b.x));
    const expansion = all.filter(d => d.x.c.exploration);
    type Draw = (typeof all)[number];
    const passed = new Set<Scored>();
    let restAll = 0, restExpansion = 0;
    for (const d of all) restAll += d.weight;
    for (const d of expansion) restExpansion += d.weight;
    const pass = (d: Draw) => {
      if (passed.has(d.x)) return;
      passed.add(d.x);
      restAll -= d.weight;
      if (d.x.c.exploration) restExpansion -= d.weight;
    };
    // A draw that does not fit now never fits later: every use in the run only grows.
    const firstOpen = (queue: Draw[], at: number) => {
      let i = at;
      while (i < queue.length && (passed.has(queue[i]!.x) || !admits(queue[i]!.x, true))) pass(queue[i++]!);
      return i;
    };
    let atAll = 0, atExpansion = 0;
    for (let k = 0; k < slots; k++) {
      atAll = firstOpen(all, atAll);
      atExpansion = firstOpen(expansion, atExpansion);
      const fromExpansion = k % 2 === 0 && atExpansion < expansion.length;
      const d = fromExpansion ? expansion[atExpansion] : all[atAll];
      if (!d) break;
      tryReserve(d.x, true, d.weight / (fromExpansion ? restExpansion : restAll));
      pass(d);
    }
  }

  // 3. Greedy: walk the order once; reserve, or refuse with the member that has no room.
  advance({ type: "beginGreedy" });
  const refused = new Set<MemberId>();
  for (const { x, value } of greedy) {
    if (x.c.participants.some(id => refused.has(id))) continue;
    const choice = shell.choiceFor(x);
    if (!shell.limitsOpen(use, choice)) continue;
    const blocked = choice.members.find(m => shell.full(use, m));
    if (!blocked) { tryReserve(x, false, 1, value); continue; }
    // spec/selectionRun.md, "A greedy refusal names a member who stays without room": a fixed window or
    // a pack refusal is outside the refusal claim, so such a choice is skipped, not refused.
    if (!shell.timeFree(use, x) || !shell.packAllows(use, x)) continue;
    advance({ type: "refuseSelection", choice, value, blockedMember: blocked });
    refused.add(blocked.id);
  }
  advance({ type: "completeRun" });
  return { selected, budgetSkips: greedy.filter(({ x }) => !use.keys.has(x.c.key)).length };
}


export function lorenz(xs: number[], points = 10): number[] {
  const s = [...xs].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0) || 1;
  const out: number[] = [];
  for (let p = 1; p <= points; p++) {
    const k = Math.round((p / points) * s.length);
    out.push(Number((s.slice(0, k).reduce((a, b) => a + b, 0) / sum).toFixed(4)));
  }
  return out;
}

/** Exposure-concentration and fairness metrics for a run (ME-012). */
export function fairnessMetrics(w: World, selected: Selected[], scored: Scored[]): FairnessMetrics {
  const eligible = w.ids.filter(id => { const m = w.get(id)!.m; return m.age >= w.cfg.ageMin && m.state !== "paused" && !w.holds.has(id); });
  const exp = new Map<MemberId, number>(eligible.map(id => [id, 0]));
  for (const s of selected) for (const id of s.s.c.participants) if (exp.has(id)) exp.set(id, exp.get(id)! + 1);
  const counts = [...exp.values()];
  const total = counts.reduce((a, b) => a + b, 0);
  const sorted = [...counts].sort((a, b) => b - a);
  const topN = Math.max(1, Math.ceil(eligible.length * 0.1));
  const newcomers = eligible.filter(id => w.get(id)!.newcomer);
  const lowExp = eligible.filter(id => w.get(id)!.lowExposure);
  const byCity: Record<string, number> = {}, byInviter: Record<string, number> = {};
  for (const s of selected) {
    byCity[s.s.c.city!] = (byCity[s.s.c.city!] ?? 0) + 1;
    for (const id of s.s.c.participants) { const r = w.get(id)!.inviterRoot; byInviter[r] = (byInviter[r] ?? 0) + 1; }
  }
  const viable = new Set<MemberId>();
  for (const x of scored) if (x.eligible) for (const id of x.c.participants) viable.add(id);
  return {
    eligibleMembers: eligible.length,
    membersWithProposal: counts.filter(c => c > 0).length,
    zeroExposureShare: eligible.length ? counts.filter(c => c === 0).length / eligible.length : 0,
    gini: gini(counts),
    top10Share: total ? sorted.slice(0, topN).reduce((a, b) => a + b, 0) / total : 0,
    newcomerShare: total ? newcomers.reduce((s, id) => s + exp.get(id)!, 0) / total : 0,
    newcomerCoverage: newcomers.length ? newcomers.filter(id => exp.get(id)! > 0).length / newcomers.length : 1,
    lowExposureCoverage: lowExp.length ? lowExp.filter(id => exp.get(id)! > 0).length / lowExp.length : 1,
    byCity, byInviterCluster: byInviter, maxPerMember: Math.max(0, ...counts),
    lorenz: lorenz(counts), viableCoverage: eligible.length ? eligible.filter(id => viable.has(id)).length / eligible.length : 0,
  };
}

/**
 * Diagnostic only, recomputed from the selected list alone: eligible non-expansion configurations
 * left out that the city cap, a used pair, a fixed window and the pack still allow, where every
 * member without room holds a greedy pick of lower value ("blocking pairs"). A correct greedy walk
 * makes this 0 (spec/selectionRun.md, "A greedy refusal names a member who stays without room");
 * room taken by exposure-floor and exploration picks is outside it. A pack's own assignment has no
 * greedy phase. `opts` must be the options the selection ran with. O(S k).
 */
export function blockingPairs(w: World, selected: readonly Selected[], scored: readonly Scored[], opts: SelectOptions = {}): number {
  if (w.pack.selection.assign) return 0;
  const shell = selectionShell(w, opts);
  const use = emptyUse();
  const lowest = new Map<MemberId, number>();
  for (const s of selected) {
    shell.record(use, s.s);
    if (s.value === undefined) continue;
    for (const id of s.s.c.participants) lowest.set(id, Math.min(lowest.get(id) ?? Infinity, s.value));
  }
  let n = 0;
  for (const x of scored) {
    if (!x.eligible || x.c.exploration || !Number.isFinite(x.score)) continue;
    const choice = shell.choiceFor(x);
    if (!shell.limitsOpen(use, choice) || !shell.timeFree(use, x) || !shell.packAllows(use, x)) continue;
    const value = valueOf(x);
    if (choice.members.every(m => !shell.full(use, m) || (lowest.get(m.id) ?? Infinity) < value)) n++;
  }
  return n;
}

/** Amortized exposure debt: carried debt + best viable relevance this run - proposals received. */
export function updateExposureDebt(w: World, prior: Record<MemberId, number>, scored: Scored[], selected: Selected[]): Record<MemberId, number> {
  const bestRel = new Map<MemberId, number>();
  for (const x of scored) if (x.eligible) for (const id of x.c.participants) bestRel.set(id, Math.max(bestRel.get(id) ?? 0, Math.max(0, x.score)));
  const got = new Map<MemberId, number>();
  for (const s of selected) for (const id of s.s.c.participants) got.set(id, (got.get(id) ?? 0) + 1);
  const out: Record<MemberId, number> = {};
  for (const id of w.ids) {
    if (w.minors.has(id)) continue;
    // Relevance is normalised so that a member at the typical threshold accrues ~1 per run.
    const rel = Math.min(1, (bestRel.get(id) ?? 0) / Math.max(0.01, w.cfg.thresholds.byState.normal));
    const v = Math.max(0, (prior[id] ?? 0) + rel - (got.get(id) ?? 0));
    if (v > 0) out[id] = Number(Math.min(w.cfg.selection.exposureDebtCap * 2, v).toFixed(4));
  }
  return out;
}
