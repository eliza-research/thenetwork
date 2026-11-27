import { gini } from "@thenetwork/core";
import type { EngineRng as Rng, MemberId } from "@thenetwork/core";
import { countPublishedQuestions, initial as initialAskRun, questionSubjectAllowed, step as stepAskRun } from "../../core/src/generated/engineAsks.ts";
import {
  initial, selectionMemberFullAt, step,
  type Event as SelectionEvent, type SelectionChoice, type SelectionMember, type SelectionRun,
} from "../../core/src/generated/selectionRun.ts";
import { exposureFloorEligible, vampireWeeklyCap } from "../../core/src/generated/qualityAndLeague.ts";
export { gini };
import { isMinor, memberQualityBandOf, memberVampireTierOf } from "./filters.ts";
import { sha256 } from "./hash.ts";
import { ASK_QUESTIONS as NETWORK_ASK_QUESTIONS } from "./packs/network/copy.ts";
import { explorationBar, type Scored } from "./scoring.ts";
import { solveChooSiowIPFP, type MarketEquilibrium, type SparsePairEdge } from "./sinkhorn.ts";
import { directionalStatusMultiplier, explorationPairAllowed, VERTICAL_KERNELS, worldStatusBeliefs } from "./status.ts";
import type { AskReason, EngineAsk, EngineInput, FairnessMetrics } from "./types.ts";
import { pairKey, type World } from "./world.ts";

export interface Selected { s: Scored; exploration: boolean; rank: number; probability: number; value?: number }

export interface SelectionResult { selected: Selected[]; budgetSkips: number }

export interface SelectOptions {
  exclude?: ReadonlySet<MemberId>;
  extraProactive?: ReadonlyMap<MemberId, number>;
}

export const ASK_QUESTIONS: Record<AskReason, string> = NETWORK_ASK_QUESTIONS;

export interface AskPlan { asks: EngineAsk[]; exclude: Set<MemberId>; extraProactive: Map<MemberId, number> }

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

interface MarketContext {
  readonly world: World;
  readonly optsKey: string;
  readonly eq?: MarketEquilibrium;
  readonly values: Map<Scored, number>;
}

const marketCache = new WeakMap<readonly Scored[], MarketContext>();

function optionsFingerprint(opts: SelectOptions): string {
  const ex = opts.exclude && opts.exclude.size > 0 ? [...opts.exclude].sort().join(",") : "";
  const extra = opts.extraProactive && opts.extraProactive.size > 0
    ? [...opts.extraProactive.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}:${v}`).join(",")
    : "";
  return `${ex}|${extra}`;
}

function marketContextFor(w: World, scored: readonly Scored[], opts: SelectOptions): MarketContext {
  const optsKey = optionsFingerprint(opts);
  const cached = marketCache.get(scored);
  if (cached && cached.world === w && cached.optsKey === optsKey) return cached;

  const values = new Map<Scored, number>();
  const adultCount = w.ids.length - w.minors.size;
  let eq: MarketEquilibrium | undefined;

  if (adultCount >= 20) {
    const budget = new Map<MemberId, number>();
    for (const id of w.ids) {
      if (w.minors.has(id)) continue;
      const mi = w.get(id)!;
      const rem = mi.inOpenOpportunity || opts.exclude?.has(id)
        ? 0
        : Math.max(0, w.cfg.budgets[mi.m.state].limit - mi.recentProactive - (opts.extraProactive?.get(id) ?? 0));
      if (rem > 0) budget.set(id, rem);
    }

    const edges: SparsePairEdge[] = [];
    for (const x of scored) {
      if (!x.eligible || x.c.exploration || !Number.isFinite(x.score) || x.c.participants.length !== 2) continue;
      const [a, b] = x.c.participants as [MemberId, MemberId];
      if (w.minors.has(a) || w.minors.has(b)) continue;
      if (!(budget.get(a) ?? 0) || !(budget.get(b) ?? 0)) continue;
      edges.push({ a, b, surplus: x.score, uA: x.c.benefit[a] ?? x.score, uB: x.c.benefit[b] ?? x.score });
    }
    if (edges.length > 0) eq = solveChooSiowIPFP(edges, budget, 0.25, 25, 0.5);
  }

  for (const x of scored) {
    if (!x.eligible || x.c.exploration || !Number.isFinite(x.score)) continue;
    let v = valueOf(x);
    if (eq && x.c.participants.length >= 2 && x.c.participants.every(id => !w.minors.has(id))) {
      let excess = 0;
      for (const id of x.c.participants) excess += (eq.shadowPrice.get(id) ?? eq.medianShadowPrice) - eq.medianShadowPrice;
      excess /= x.c.participants.length;
      v += Math.max(-50, Math.min(50, Math.round(-35 * excess)));
    }
    values.set(x, v);
  }

  const ctx: MarketContext = { world: w, optsKey, eq, values };
  marketCache.set(scored, ctx);
  return ctx;
}

export function dhIntProbeOrder(w: World, x: Scored, eq?: MarketEquilibrium): readonly MemberId[] {
  const c = x.c;
  if (!eq || c.participants.length !== 2) return c.participants;
  if (c.anchor?.type === "intent" || c.anchor?.type === "member") return c.participants;
  const [a, b] = c.participants as [MemberId, MemberId];
  if (w.minors.has(a) || w.minors.has(b) || isMinor(w, a) || isMinor(w, b)) return c.participants;
  if (c.roles[a] === undefined || c.roles[a] !== c.roles[b]) return c.participants;
  const prio = (id: MemberId) => (eq.shadowPrice.get(id) ?? 0) - 0.5 * (w.get(id)?.acceptance ?? 0.5);
  return prio(b) > prio(a) + 0.05 ? [b, a] : c.participants;
}

interface Use {
  keys: Set<string>; pairs: Set<string>; cities: Map<string, number>;
  proactive: Map<MemberId, number>; contribution: Map<MemberId, number>; windows: Map<MemberId, readonly (readonly [number, number])[]>;
}
const emptyUse = (): Use => ({ keys: new Set(), pairs: new Set(), cities: new Map(), proactive: new Map(), contribution: new Map(), windows: new Map() });
const copyUse = (u: Use): Use => ({
  keys: new Set(u.keys), pairs: new Set(u.pairs), cities: new Map(u.cities),
  proactive: new Map(u.proactive), contribution: new Map(u.contribution), windows: new Map(u.windows),
});

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
      const baseLimit = cfg.budgets[mi.m.state].limit;
      const proactiveLimit = !w.minors.has(id) && !isMinor(w, id) && w.input.vampireByMember?.[id] !== undefined
        ? vampireWeeklyCap(memberVampireTierOf(w, id), baseLimit)
        : baseLimit;
      return {
        id, unavailable: Boolean(mi.inOpenOpportunity || opts.exclude?.has(id)),
        priorProactive: mi.recentProactive + (opts.extraProactive?.get(id) ?? 0),
        proactiveLimit,
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
  const full = (u: Use, m: SelectionMember) => selectionMemberFullAt(m, u.proactive.get(m.id) ?? 0, u.contribution.get(m.id) ?? 0);
  const limitsOpen = (u: Use, c: SelectionChoice) =>
    !u.keys.has(c.candidateKey) && (u.cities.get(c.city) ?? 0) < c.cityLimit && c.pairKeys.every(k => !u.pairs.has(k));
  const timeFree = (u: Use, x: Scored) => {
    const window = x.c.fixedWindow ? x.c.window : undefined;
    return !window || x.c.participants.every(id => !(u.windows.get(id) ?? []).some(([s, e]) => window.start < e && s < window.end));
  };
  const packAllows = (u: Use, x: Scored) => {
    const adjust = w.pack.selection.adjust;
    return !adjust || adjust(w, x.c, x.score, id => u.proactive.get(id) ?? 0) !== -Infinity;
  };
  const fits = (u: Use, x: Scored) => {
    const c = choiceFor(x);
    return limitsOpen(u, c) && c.members.every(m => !full(u, m));
  };
  const allows = (u: Use, x: Scored) => fits(u, x) && timeFree(u, x) && packAllows(u, x);
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

export function exposureFloor(w: World, rng: Rng, debt: Readonly<Record<MemberId, number>>): { members: MemberId[]; cap: number } {
  const cfg = w.cfg;
  const carried = (id: MemberId) => Math.min(cfg.selection.exposureDebtCap, Math.max(0, debt[id] ?? 0));
  const members = rng.fork("floor").shuffle(w.ids.filter(id => {
    const mi = w.get(id)!;
    if (w.input.qualityByMember?.[id] !== undefined || mi.tags.has("hv:hype:pitch")) {
      const band = memberQualityBandOf(w, id);
      const hasClearSignal = mi.match.length >= 2 || mi.intents.length > 0 || !mi.lowData;
      return exposureFloorEligible(band, mi.lowExposure, mi.newcomer, mi.recentExposure30, hasClearSignal);
    }
    return mi.lowExposure && (mi.newcomer || mi.lowData || mi.recentExposure30 === 0);
  })).sort((a, b) => carried(b) - carried(a));
  return { members, cap: Math.ceil(cfg.selection.exposureFloorShare * cfg.selection.maxProposalsPerCity * w.pack.geo.markets(cfg).length) };
}

export function selectProposals(w: World, scored: Scored[], rng: Rng, debt: Record<MemberId, number>, opts: SelectOptions = {}): SelectionResult {
  const assign = w.pack.selection.assign;
  if (assign) return assign(w, scored, { rng, debt, exclude: opts.exclude, extraProactive: opts.extraProactive });
  const cfg = w.cfg;
  const mkt = marketContextFor(w, scored, opts);
  const greedyVal = (x: Scored) => mkt.values.get(x) ?? valueOf(x);
  const shell = selectionShell(w, opts);
  let run: SelectionRun = initial;
  const use = emptyUse();
  const selected: Selected[] = [];
  const advance = (event: SelectionEvent) => {
    const next = step(run, event);
    if (next === run) throw new Error(`selectionRun refused ${event.type} that the shell allowed`);
    run = next;
  };
  const reservation = (x: Scored, exploring: boolean, value: number): ReserveEvent => ({
    type: "reserveSelection", choice: shell.choiceFor(x), timeFree: shell.timeFree(use, x), exploring, packAllows: shell.packAllows(use, x), value,
  });
  const tryReserve = (x: Scored, exploring: boolean, probability: number, value?: number): boolean => {
    const event = reservation(x, exploring, value ?? greedyVal(x));
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

  const greedy = scored.filter(x => x.eligible && !x.c.exploration && Number.isFinite(x.score))
    .map(x => ({ x, value: greedyVal(x) }))
    .sort((a, b) => (b.value - a.value) || byKey(a.x, b.x));
  const byMember = new Map<MemberId, Scored[]>();
  for (const { x } of greedy) for (const id of x.c.participants) {
    let list = byMember.get(id);
    if (!list) { list = []; byMember.set(id, list); }
    list.push(x);
  }

  const { members: floorMembers, cap: floorCap } = exposureFloor(w, rng, debt);
  let floorTaken = 0;
  for (const id of floorMembers) {
    if (floorTaken >= floorCap) break;
    if ((use.proactive.get(id) ?? 0) > 0) continue;
    if ((byMember.get(id) ?? []).some(x => shell.fits(use, x) && tryReserve(x, false, 1))) floorTaken++;
  }

  advance({ type: "beginExploration" });
  const sizing = copyUse(use);
  let greedyEstimate = 0;
  for (const { x } of greedy) if (shell.allows(sizing, x)) { shell.record(sizing, x); greedyEstimate++; }
  const runSize = floorTaken + greedyEstimate;
  const slots = Math.min(Math.floor((cfg.exploration.rate * runSize) / (1 - cfg.exploration.rate)), Math.floor(cfg.exploration.maxShare * runSize));
  if (slots > 0) {
    const explore = rng.fork("explore");
    const beliefs = worldStatusBeliefs(w);
    const tsSamples = new Map<MemberId, number[]>();
    if (beliefs.size >= 20 && mkt.eq) {
      const tsRng = explore.fork("ts");
      const nextNormal = () => {
        const u1 = Math.max(1e-12, tsRng.next());
        const u2 = tsRng.next();
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      };
      for (const id of [...beliefs.keys()].sort()) {
        const b = beliefs.get(id)!;
        tsSamples.set(id, b.mu.map((m, d) => Math.max(-3, Math.min(3, m + b.sigma[d]! * nextNormal()))));
      }
    }
    const K = VERTICAL_KERNELS[w.pack.id] ?? VERTICAL_KERNELS.ntwrk;
    const all = scored.filter(x => Number.isFinite(x.score) && !use.keys.has(x.c.key) && (!x.reason || x.reason === "below_threshold")
      && x.verdict?.verdict !== "no" && x.score >= explorationBar(w, x.c, x.threshold))
      .sort(byKey)
      .map(x => {
        const u = explore.next();
        let allowed = true;
        let tsMult = 1;
        if (mkt.eq && beliefs.size >= 20 && x.c.participants.length === 2) {
          const [a, b] = x.c.participants as [MemberId, MemberId];
          if (!w.minors.has(a) && !w.minors.has(b)) {
            const contribPair = Boolean(
              (x.c.roles[a] && w.pack.ontology.contributorRoles.has(x.c.roles[a]!))
              || (x.c.roles[b] && w.pack.ontology.contributorRoles.has(x.c.roles[b]!)),
            );
            if (!contribPair && !explorationPairAllowed(w, a, b, mkt.eq.shadowPrice, mkt.eq.p80ShadowPrice)) allowed = false;
            if (allowed && tsSamples.size > 0) {
              const bA = beliefs.get(a), bB = beliefs.get(b);
              const sA = tsSamples.get(a), sB = tsSamples.get(b);
              if (bA && bB && sA && sB) {
                const mAB = directionalStatusMultiplier(bA, bB, K, sA, sB);
                const mBA = directionalStatusMultiplier(bB, bA, K, sB, sA);
                tsMult = 0.8 + 0.2 * ((2 * mAB * mBA) / Math.max(1e-6, mAB + mBA));
              }
            }
          }
        }
        const weight = Math.max(0.01, x.components.novelty * x.score * tsMult) * (x.c.exploration ? 8 : 1);
        return { x, weight, draw: Math.log(1 - u) / weight, allowed };
      })
      .filter(d => d.allowed)
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
    const firstOpen = (queue: Draw[], at: number) => {
      let i = at;
      while (i < queue.length && (passed.has(queue[i]!.x) || !shell.allows(use, queue[i]!.x))) pass(queue[i++]!);
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

  advance({ type: "beginGreedy" });
  const refused = new Set<MemberId>();
  for (const { x, value } of greedy) {
    if (x.c.participants.some(id => refused.has(id))) continue;
    const choice = shell.choiceFor(x);
    if (!shell.limitsOpen(use, choice)) continue;
    const blocked = choice.members.find(m => shell.full(use, m));
    if (!blocked) { tryReserve(x, false, 1, value); continue; }
    if (!shell.timeFree(use, x) || !shell.packAllows(use, x)) continue;
    advance({ type: "refuseSelection", choice, value, blockedMember: blocked });
    refused.add(blocked.id);
  }
  advance({ type: "completeRun" });
  let budgetSkips = 0;
  for (const { x } of greedy) if (!use.keys.has(x.c.key)) budgetSkips++;
  return { selected, budgetSkips };
}

export function lorenz(xs: number[], points = 10): number[] {
  const s = [...xs].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0) || 1;
  const out: number[] = [];
  let whole = 0;
  let cumulative = 0;
  for (let p = 1; p <= points; p++) {
    const position = (p * s.length) / points;
    const complete = Math.floor(position);
    while (whole < complete) cumulative += s[whole++] ?? 0;
    const partial = (position - complete) * (s[complete] ?? 0);
    out.push(Number(((cumulative + partial) / sum).toFixed(4)));
  }
  return out;
}

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

export function blockingPairs(w: World, selected: readonly Selected[], scored: readonly Scored[], opts: SelectOptions = {}): number {
  if (w.pack.selection.assign) return 0;
  const mkt = marketContextFor(w, scored, opts);
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
    const value = mkt.values.get(x) ?? valueOf(x);
    if (choice.members.every(m => !shell.full(use, m) || (lowest.get(m.id) ?? Infinity) < value)) n++;
  }
  return n;
}

export function selectionDiagnostics(
  w: World,
  selected: readonly Selected[],
  scored: readonly Scored[],
  opts: SelectOptions = {},
): { reciprocalRankShare: number; p80ShadowPrice: number; equilibriumIterations: number } {
  const mkt = marketContextFor(w, scored, opts);
  const bestByMember = new Map<MemberId, number>();
  for (const x of scored) {
    if (!x.eligible || !Number.isFinite(x.score)) continue;
    for (const id of x.c.participants) bestByMember.set(id, Math.max(bestByMember.get(id) ?? 0, x.score));
  }
  let shareSum = 0, shareCount = 0;
  for (const sel of selected) {
    for (const id of sel.s.c.participants) {
      const top = bestByMember.get(id) ?? 0;
      if (top > 0) {
        shareSum += Math.min(1, Math.max(0, sel.s.score) / top);
        shareCount++;
      }
    }
  }
  return {
    reciprocalRankShare: shareCount ? shareSum / shareCount : 1,
    p80ShadowPrice: mkt.eq?.p80ShadowPrice ?? 0,
    equilibriumIterations: mkt.eq?.iterations ?? 0,
  };
}

export function updateExposureDebt(w: World, prior: Record<MemberId, number>, scored: Scored[], selected: Selected[]): Record<MemberId, number> {
  const bestRel = new Map<MemberId, number>();
  for (const x of scored) if (x.eligible) for (const id of x.c.participants) bestRel.set(id, Math.max(bestRel.get(id) ?? 0, Math.max(0, x.score)));
  const got = new Map<MemberId, number>();
  for (const s of selected) for (const id of s.s.c.participants) got.set(id, (got.get(id) ?? 0) + 1);
  const out: Record<MemberId, number> = {};
  for (const id of w.ids) {
    if (w.minors.has(id)) continue;
    const rel = Math.min(1, (bestRel.get(id) ?? 0) / Math.max(0.01, w.cfg.thresholds.byState.normal));
    const v = Math.max(0, (prior[id] ?? 0) + rel - (got.get(id) ?? 0));
    if (v > 0) out[id] = Number(Math.min(w.cfg.selection.exposureDebtCap * 2, v).toFixed(4));
  }
  return out;
}
