import { APP_IDS, hash32, Rng, type AppId } from "../../packages/core/src/index.ts";
import { inSearchWindow, searchTouchesPerCheck, unseenValueBound } from "../../packages/core/src/generated/candidateSearch.ts";
import {
  laneLimits, laneOffered, laneOffset, lanePairValue, laneWeights, standingUncertaintyCeiling, type MatchLane,
} from "../../packages/core/src/generated/matchLane.ts";
import { coverageValue, directedUtility, noPairValue, pairValueScale } from "../../packages/core/src/generated/pairValue.ts";
import { resolveConfig, type EngineConfigInput } from "../../packages/engine/src/config.ts";
import { pairReason } from "../../packages/engine/src/filters.ts";
import { bruteForceCandidates, laneCategory, pairSideOf, partnerBlock, type MatchProfile, type SearchResult } from "../../packages/engine/src/match/mod.ts";
import { eligiblePair, segmentReaches, vectorsOf, weightedTerms } from "../../packages/engine/src/match/pair.ts";
import { searchWindowMetrics } from "../../packages/engine/src/match/search.ts";
import type { AppPack } from "../../packages/engine/src/pack.ts";
import { networkPack } from "../../packages/engine/src/packs/network/index.ts";
import type { SearchTally } from "../../packages/engine/src/types.ts";
import { World } from "../../packages/engine/src/world.ts";
import { appWiring } from "../../packages/network/service/packs.ts";
import { PLANTED_LANES, PLANTED_WORLDS, plantedEngineInput, type PlantedWorld } from "../../packages/sim/src/planted.ts";
import { Block } from "./gate.ts";

export const LADDER_QUICK = [1_000, 2_000, 5_000, 10_000, 20_000] as const;
export const LADDER_FULL = [...LADDER_QUICK, 50_000, 100_000] as const;
const EVERY_LANE_UP_TO = 20_000;
const SAMPLE = 200;
const ORACLE_UP_TO = 20_000;
const CHECK_SLOPE = 0.3, TOUCH_SLOPE = 0.6;
const HARD_WORLDS: readonly PlantedWorld[] = ["zipf", "dense", "graded"];
const WORST_WORLDS: readonly PlantedWorld[] = ["one-segment", "one-tag", "ties"];
const HARD_PACKS = ["friends", "slop"] as const;

export const shippedConfig = (pack: AppPack, seed: number): EngineConfigInput => ({ ...appWiring(pack.id).engine, seed });
export const PRIMARY_LANE: Readonly<Record<string, MatchLane>> = { ntwrk: "Intro", slop: "Date", peon: "Hire", friends: "Friend" };
export const lanesOf = (pack: AppPack): MatchLane[] => PLANTED_LANES.filter(lane => laneOffered(pack.id, lane));
export const packOf = (app: AppId): AppPack => appWiring(app).pack ?? networkPack;
const flatEmbed = (): number[] => [1];

export interface Faults { count: number; first?: string }
export const noFaults = (): Faults => ({ count: 0 });
export const fault = (f: Faults, what: string): void => { f.count++; f.first ??= what; };
const show = (f: Faults): string => (f.count ? `${f.count} faults; first: ${f.first}` : "0 faults");

export function checkSearchCost(f: Faults, p: MatchProfile, result: SearchResult, at: string): void {
  const budget = laneLimits(p.lane).searchBudget;
  const touchLimit = searchTouchesPerCheck * budget;
  const { checks, touches, exact } = result;
  if (!Number.isSafeInteger(checks) || checks < 0 || checks > budget) fault(f, `${at} ${p.id}: ${checks} pair checks outside 0..${budget}`);
  if (!Number.isSafeInteger(touches) || touches < checks || touches > touchLimit) fault(f, `${at} ${p.id}: ${touches} touches outside ${checks}..${touchLimit}`);
  if (!exact && checks < budget && touches < touchLimit) fault(f, `${at} ${p.id}: search closed before either budget was exhausted`);
}

type CoreCounters = Partial<Record<"bounds" | "checksAfterSettled" | "boundViolations" | "packBoundViolations" | "memoHits", number>>
  & { refusals?: Readonly<Record<string, number>> };

interface Oracle { searches: number; hits: number; wanted: number; regret: number }
const noOracle = (): Oracle => ({ searches: 0, hits: 0, wanted: 0, regret: 0 });
export interface Rung {
  readonly world: PlantedWorld; readonly app: AppId; readonly lane: MatchLane; readonly n: number;
  profiles: number; exact: number; checkClosed: number; touchClosed: number; checks: number; touches: number; ms: number;
  readonly core: SearchTally & CoreCounters;
  readonly gaps: number[]; notFull: number;
  readonly budgeted: { window: number; ranges: number; shortest: number; partnerSegments: number };
  readonly sample: {
    profiles: number; window: number; feasible: number; touches: number; bounds: number; checks: number;
    capped: number; cappedChecks: number; cappedNeed: number;
    maskRefused: number;
    readonly refusals: Map<string, number>; readonly exact: Oracle; readonly budgeted: Oracle;
  };
  readonly faults: { cost: Faults; oracle: Faults; bound: Faults; segment: Faults; mask: Faults; replica: Faults };
}

type TagGroup = "affinity" | "complement" | "returned";
interface Range { readonly group: TagGroup; readonly positions: readonly number[] }

function windowRanges(block: readonly MatchProfile[], p: MatchProfile, window: readonly number[]): Range[] {
  const groups: [TagGroup, readonly number[], (o: MatchProfile) => readonly number[]][] = [
    ["affinity", p.interests, o => o.interests], ["complement", p.seeks, o => o.offers], ["returned", p.offers, o => o.seeks],
  ];
  return groups.flatMap(([group, mine, theirs]) => {
    const wanted = new Set(mine), holders = new Map<number, number[]>();
    for (const position of window) for (const tag of theirs(block[position]!)) {
      if (!wanted.has(tag)) continue;
      const list = holders.get(tag);
      if (list) list.push(position); else holders.set(tag, [position]);
    }
    return mine.flatMap(tag => { const positions = holders.get(tag); return positions ? [{ group, positions }] : []; });
  });
}

function sampleProfile(w: World, r: Rung, p: MatchProfile, result: SearchResult): void {
  const at = `${r.world} N ${r.n} ${r.lane}`, s = r.sample;
  s.profiles++;
  const block = partnerBlock(w.match.index, p);
  const limits = laneLimits(p.lane), { rules } = limits;
  const others = block?.profiles ?? [];
  const offset = laneOffset(p.lane, p.side);
  const all = others.map(o => w.match.value(p, o));
  const refusedBy = all.map((value, position) => (value >= 0 ? null : eligiblePair(w, p, others[position]!)));
  const window: number[] = [];
  others.forEach((o, position) => {
    if (segmentReaches(p, o) && inSearchWindow(o.standing, p.standing, offset, rules.parityBand, p.uncertainty, standingUncertaintyCeiling)) window.push(position);
  });
  const values = new Map<number, number>();
  for (const position of window) {
    const o = others[position]!;
    const value = all[position]!;
    values.set(position, value);
    if (value >= 0) { s.feasible++; continue; }
    if (o.memberId === p.memberId) continue;
    const reason = refusedBy[position] ?? "pair_value";
    s.refusals.set(reason, (s.refusals.get(reason) ?? 0) + 1);
  }
  s.window += window.length;
  const feasible = [...values.values()].filter(v => v >= 0).sort((x, y) => y - x);
  const threshold = feasible.length >= limits.searchLimit ? feasible[limits.searchLimit - 1]! : 0;

  const vectors = vectorsOf(w), costs = vectors.traits?.costs ?? [];
  const hasTraits = costs.length > 0, hasPackValue = vectors.packValue !== undefined;
  const fullPack = hasPackValue ? pairValueScale : undefined, weights = laneWeights(p.lane);
  const walk = windowRanges(others, p, window).sort((x, y) => x.positions.length - y.positions.length);
  const open: Record<TagGroup, number> = { affinity: 0, complement: 0, returned: 0 };
  for (const range of walk) open[range.group]++;
  let windowWalked = false, walked = 0, touches = 0;
  const untouchedBound = (): number => {
    if (windowWalked) return noPairValue;
    const complement = coverageValue(open.complement, p.seeks.length), returned = open.returned > 0 ? pairValueScale : 0;
    const mine = directedUtility(weightedTerms(weights, hasTraits, hasPackValue, {
      complement, affinity: coverageValue(open.affinity, p.interests.length), closeness: pairValueScale, pack: pairValueScale,
    }));
    const theirs = directedUtility(weightedTerms(weights, hasTraits, hasPackValue, {
      complement: returned, affinity: open.affinity > 0 ? pairValueScale : 0, closeness: pairValueScale, pack: pairValueScale,
    }));
    return unseenValueBound(mine, theirs, complement, returned, rules);
  };
  const bounds = new Map<number, number>();
  const visit = (positions: readonly number[]): void => {
    touches += positions.length;
    for (const position of positions) {
      const o = others[position]!;
      if (bounds.has(position) || o.memberId === p.memberId) continue;
      bounds.set(position, lanePairValue(p.lane, pairSideOf(p, o, costs, fullPack), p.side, pairSideOf(o, p, costs, fullPack), o.side));
    }
  };
  while (untouchedBound() >= threshold) {
    const range = walk[walked];
    if (range && range.positions.length < window.length) { visit(range.positions); open[range.group]--; walked++; }
    else { visit(window); windowWalked = true; }
  }
  let checks = 0;
  for (const bound of bounds.values()) if (bound >= threshold) checks++;
  s.touches += touches; s.bounds += bounds.size; s.checks += checks;
  if (!result.exact) { s.capped++; s.cappedChecks += result.checks; s.cappedNeed += checks; }
  if (result.exact && (checks !== result.checks || touches !== result.touches)) {
    fault(r.faults.replica, `${at} ${p.id}: uncapped count ${checks} checks / ${touches} touches, exact search ${result.checks} / ${result.touches}`);
  }

  const rest = untouchedBound(), kept = new Set(result.kept.map(c => c.profile.id));
  for (const [position, value] of values) {
    if (value > (bounds.get(position) ?? rest)) fault(r.faults.bound, `${at} ${p.id}: ${others[position]!.id} value ${value} above its bound ${bounds.get(position) ?? rest}`);
  }
  if (!result.exact) {
    for (const [position, o] of others.entries()) {
      const value = all[position]!;
      if (!kept.has(o.id) && value > result.unseenBound) fault(r.faults.bound, `${at} ${p.id}: missed ${o.id} (${value}) above the unseen bound ${result.unseenBound}`);
    }
  }

  for (const [position, o] of others.entries()) {
    const reason = refusedBy[position];
    const faults = reason === "segment_unreachable" ? r.faults.segment : reason === "mask_refused" ? r.faults.mask : undefined;
    if (!faults) continue;
    if (faults === r.faults.mask) s.maskRefused++;
    if (pairReason(w, p.memberId, o.memberId, laneCategory(p.lane), p.lane) === null) fault(faults, `${at} ${p.id}: ${reason} for ${o.id}, which the pack rules admit`);
  }

  if (r.n > ORACLE_UP_TO || !block) return;
  const brute = bruteForceCandidates(w, w.match.index, p);
  const oracle = result.exact ? s.exact : s.budgeted;
  const keptValue = result.kept.reduce((t, c) => t + c.value, 0);
  oracle.searches++;
  oracle.wanted += brute.length;
  oracle.hits += brute.filter(c => kept.has(c.profile.id)).length;
  oracle.regret += brute.reduce((t, c) => t + c.value, 0) - keptValue;
  const same = result.kept.length === brute.length && result.kept.every((c, i) => c.profile.id === brute[i]!.profile.id && c.value === brute[i]!.value);
  if (result.exact && !same) fault(r.faults.oracle, `${at} ${p.id}: exact search differs from brute force`);
}

function measureRung(app: AppId, lane: MatchLane, n: number, world: PlantedWorld, seed = 1): Rung {
  const pack = packOf(app);
  const { input } = plantedEngineInput({ seed: `matching-${seed}`, n, lanes: [lane], app, world });
  const w = new World(input, resolveConfig(shippedConfig(pack, seed)), flatEmbed, pack);
  const profiles = w.match.profiles;
  const t = performance.now();
  const results = profiles.map(p => w.match.candidates(p));
  const ms = Math.round(performance.now() - t);
  const r: Rung = {
    world, app, lane, n, profiles: profiles.length, exact: 0, checkClosed: 0, touchClosed: 0, checks: 0, touches: 0, ms,
    core: w.match.tally(), gaps: [], notFull: 0, budgeted: { window: 0, ranges: 0, shortest: 0, partnerSegments: 0 },
    sample: { profiles: 0, window: 0, feasible: 0, touches: 0, bounds: 0, checks: 0, capped: 0, cappedChecks: 0, cappedNeed: 0, maskRefused: 0, refusals: new Map(), exact: noOracle(), budgeted: noOracle() },
    faults: { cost: noFaults(), oracle: noFaults(), bound: noFaults(), segment: noFaults(), mask: noFaults(), replica: noFaults() },
  };
  const at = `${world} N ${n} ${lane}`;
  if (!profiles.length) fault(r.faults.cost, `${at}: no ${lane} profiles`);
  const { searchBudget, searchLimit } = laneLimits(lane);
  for (const [i, p] of profiles.entries()) {
    const result = results[i]!;
    checkSearchCost(r.faults.cost, p, result, at);
    r.checks += result.checks; r.touches += result.touches;
    if (result.exact) { r.exact++; continue; }
    if (result.checks >= searchBudget) r.checkClosed++; else r.touchClosed++;
    const block = partnerBlock(w.match.index, p);
    if (block) {
      const counts = searchWindowMetrics(block, p);
      r.budgeted.window += counts.window; r.budgeted.ranges += counts.ranges; r.budgeted.shortest += counts.shortest;
      r.budgeted.partnerSegments += p.segment?.partners.size ?? 0;
    }
    if (result.kept.length === searchLimit) r.gaps.push(result.unseenBound - result.kept[searchLimit - 1]!.value);
    else r.notFull++;
  }
  if (r.core.checks !== r.checks || r.core.touches !== r.touches) {
    fault(r.faults.cost, `${at}: tally ${r.core.checks} checks / ${r.core.touches} touches differs from ${r.checks} / ${r.touches}`);
  }
  const order = new Rng(hash32("scale-sample", world, app, lane, n)).shuffle(profiles.map((_, i) => i));
  for (const i of order.slice(0, SAMPLE)) sampleProfile(w, r, profiles[i]!, results[i]!);
  return r;
}

export function runLadder(app: AppId, world: PlantedWorld, sizes: readonly number[], lanes = lanesOf(packOf(app))): Rung[] {
  const rungs: Rung[] = [];
  for (const n of sizes) for (const lane of lanes) {
    if (n > EVERY_LANE_UP_TO && lane !== PRIMARY_LANE[app] && lanes.length > 1) continue;
    console.log(`  ${app}: ${world} ${lane} ladder N ${n}`);
    rungs.push(measureRung(app, lane, n, world));
  }
  return rungs;
}

interface Slope { slope: number; residual: number }
function logSlope(points: readonly (readonly [number, number])[]): Slope {
  const xs = points.map(([x]) => Math.log(x)), ys = points.map(([, y]) => Math.log1p(y));
  const n = xs.length;
  if (n < 2) return { slope: NaN, residual: NaN };
  const mx = xs.reduce((t, x) => t + x, 0) / n, my = ys.reduce((t, y) => t + y, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i]! - mx) * (ys[i]! - my); sxx += (xs[i]! - mx) ** 2; }
  const slope = sxx > 0 ? sxy / sxx : NaN;
  const residual = Math.sqrt(xs.reduce((t, x, i) => t + (ys[i]! - (my + slope * (x - mx))) ** 2, 0) / n);
  return { slope, residual };
}

type Work = "touches" | "bounds" | "checks";
const perSample = (r: Rung, work: Work): number => (r.sample.profiles ? r.sample[work] / r.sample.profiles : NaN);
const laneSlopes = (rungs: readonly Rung[]): Record<Work, Slope> => {
  const points = (work: Work) => rungs.filter(r => r.sample.profiles).map((r): [number, number] => [r.n, perSample(r, work)]);
  return { touches: logSlope(points("touches")), bounds: logSlope(points("bounds")), checks: logSlope(points("checks")) };
};

const fixed = (x: number | undefined, digits = 1): string => (x !== undefined && Number.isFinite(x) ? x.toFixed(digits) : "-");
const pct = (x: number, n: number): string => (n ? `${((100 * x) / n).toFixed(1)}%` : "-");
const per = (x: number | undefined, n: number): string => (x === undefined ? "-" : fixed(x / Math.max(1, n)));
const quantile = (xs: readonly number[], q: number): number => {
  if (!xs.length) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
};
const reasons = (m: ReadonlyMap<string, number> | Readonly<Record<string, number>> | undefined): string => {
  if (!m) return "-";
  const entries = (m instanceof Map ? [...m] : Object.entries(m)).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
  return entries.length ? entries.slice(0, 3).map(([k, v]) => `${k} ${v}`).join(", ") : "none";
};
const recall = (o: Oracle): string => (o.searches ? `${((100 * o.hits) / Math.max(1, o.wanted)).toFixed(1)}%` : "-");
const regret = (o: Oracle): string => (o.searches ? fixed(o.regret / o.searches) : "-");

function markdown(header: readonly string[], rows: readonly (readonly string[])[]): void {
  console.log(`| ${header.join(" | ")} |`);
  console.log(`|${header.map(() => "---").join("|")}|`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}

export function printLadder(rungs: readonly Rung[]): void {
  if (!rungs.length) return;
  console.log(`\n  ${rungs[0]!.app}, world ${rungs[0]!.world}: per profile unless named; sample = ${SAMPLE} profiles; uncapped = work to exactness with no budget`);
  markdown(
    ["lane", "N", "profiles", "exact", "budgeted by checks / by walk", "checks", "touches", "bounds", "after settled", "bound viol.", "memo hits",
      "core refusals", "gap p50 / p90 / max", "window", "feasible", "window refusals", "uncapped touches / bounds / checks",
      "recall exact / budgeted", "regret exact / budgeted", "budgeted checks / uncapped need", "budgeted: window / tag-range entries / shortest / partner segments", "search ms"],
    rungs.map(r => {
      const s = r.sample, budgeted = r.profiles - r.exact;
      return [
        r.lane, String(r.n), String(r.profiles), pct(r.exact, r.profiles), `${pct(r.checkClosed, r.profiles)} / ${pct(r.touchClosed, r.profiles)}`,
        per(r.checks, r.profiles), per(r.touches, r.profiles), per(r.core.bounds, r.profiles), r.core.checksAfterSettled === undefined ? "-" : String(r.core.checksAfterSettled),
        r.core.boundViolations === undefined ? "-" : String(r.core.boundViolations), per(r.core.memoHits, r.profiles), reasons(r.core.refusals),
        budgeted ? `${fixed(quantile(r.gaps, 0.5), 0)} / ${fixed(quantile(r.gaps, 0.9), 0)} / ${fixed(quantile(r.gaps, 1), 0)}${r.notFull ? ` (${r.notFull} not full)` : ""}` : "-",
        per(s.window, s.profiles), pct(s.feasible, s.window), reasons(s.refusals),
        `${fixed(perSample(r, "touches"))} / ${fixed(perSample(r, "bounds"))} / ${fixed(perSample(r, "checks"))}`,
        `${recall(s.exact)} / ${recall(s.budgeted)}`, `${regret(s.exact)} / ${regret(s.budgeted)}`,
        s.capped ? `${per(s.cappedChecks, s.capped)} / ${per(s.cappedNeed, s.capped)}` : "-",
        budgeted ? [r.budgeted.window, r.budgeted.ranges, r.budgeted.shortest, r.budgeted.partnerSegments].map(x => per(x, budgeted)).join(" / ") : "-",
        String(r.ms),
      ];
    }));
  const lanes = [...new Set(rungs.map(r => r.lane))];
  console.log("");
  markdown(["lane", "sizes", "slope touches (resid.)", "slope bounds (resid.)", "slope checks (resid.)", `checks < ${CHECK_SLOPE} and touches < ${TOUCH_SLOPE}`],
    lanes.map(lane => {
      const own = rungs.filter(r => r.lane === lane), sl = laneSlopes(own);
      const cell = (x: Slope) => `${fixed(x.slope, 2)} (${fixed(x.residual, 2)})`;
      return [lane, own.map(r => r.n).join(", "), cell(sl.touches), cell(sl.bounds), cell(sl.checks), own.length < 2 ? "-" : slopePass(sl) ? "pass" : "fail"];
    }));
}

const slopePass = (sl: Record<Work, Slope>): boolean => sl.checks.slope < CHECK_SLOPE && sl.touches.slope < TOUCH_SLOPE;
const merged = (rungs: readonly Rung[], pick: (r: Rung) => Faults): Faults => {
  const all = rungs.map(pick);
  return { count: all.reduce((t, f) => t + f.count, 0), first: all.find(f => f.first)?.first };
};

export function ladderGates(b: Block, id: string, rungs: readonly Rung[]): void {
  if (!rungs.length) return;
  const sizes = [...new Set(rungs.map(r => r.n))].join("/");
  const oracle = merged(rungs, r => r.faults.oracle);
  const sampled = rungs.filter(r => r.n <= ORACLE_UP_TO).reduce((t, r) => t + r.sample.exact.searches, 0);
  b.gate(`${id}: exact searches equal brute force (${SAMPLE} sampled profiles per lane, N ${sizes} up to ${ORACLE_UP_TO})`, oracle.count === 0,
    `${sampled} exact searches compared; ${show(oracle)}`);
  const bound = merged(rungs, r => r.faults.bound);
  const coreCount = (k: "boundViolations" | "packBoundViolations"): string => {
    const total = rungs.reduce((t, r) => t + (r.core[k] ?? 0), 0);
    if (total) fault(bound, `core ${k} ${total}`);
    return rungs.some(r => r.core[k] !== undefined) ? String(total) : "-";
  };
  const counts = `core boundViolations ${coreCount("boundViolations")}, packBoundViolations ${coreCount("packBoundViolations")}`;
  b.gate(`${id}: no pair value above its bound, and no budgeted search omits a partner above its reported bound (sampled profiles; core counts)`,
    bound.count === 0, `${counts}; ${show(bound)}`);
  const segment = merged(rungs, r => r.faults.segment);
  b.gate(`${id}: segments never refuse a pair the pack rules admit (sampled profiles)`, segment.count === 0, show(segment));
  const mask = merged(rungs, r => r.faults.mask);
  b.gate(`${id}: acceptance masks never refuse a pair the pack rules admit (sampled profiles)`, mask.count === 0,
    `${rungs.reduce((t, r) => t + r.sample.maskRefused, 0)} mask refusals checked; ${show(mask)}`);
  const settled = rungs.map(r => r.core.checksAfterSettled);
  b.track(`${id}: no pair check after no touched candidate can still enter the kept list (core checksAfterSettled)`,
    settled.every(x => x === 0), settled.some(x => x !== undefined) ? `${settled.reduce<number>((t, x) => t + (x ?? 0), 0)} checks` : "- (not reported by the core)");
  const replica = merged(rungs, r => r.faults.replica);
  b.track(`${id}: the uncapped count equals the search's checks and touches on every sampled exact search`, replica.count === 0, show(replica));
  for (const lane of [...new Set(rungs.map(r => r.lane))]) {
    const own = rungs.filter(r => r.lane === lane);
    if (own.length < 2) continue;
    const sl = laneSlopes(own);
    b.track(`${id} ${lane}: uncapped work per profile grows slower than N^${CHECK_SLOPE} checks and N^${TOUCH_SLOPE} touches (N ${own.map(r => r.n).join("/")})`,
      slopePass(sl), `slopes: checks ${fixed(sl.checks.slope, 2)} ± ${fixed(sl.checks.residual, 2)}, touches ${fixed(sl.touches.slope, 2)} ± ${fixed(sl.touches.residual, 2)}, bounds ${fixed(sl.bounds.slope, 2)} ± ${fixed(sl.bounds.residual, 2)}`);
  }
}

export function hardWorlds(b: Block, apps: readonly AppId[]): void {
  const ladder = LADDER_QUICK.filter(n => n <= 5_000);
  for (const app of HARD_PACKS.filter(x => apps.includes(x))) {
    for (const world of [...HARD_WORLDS, ...WORST_WORLDS]) {
      const rungs = runLadder(app, world, HARD_WORLDS.includes(world) ? ladder : [1_000, 2_000]);
      printLadder(rungs);
      ladderGates(b, `matching ${app} ${world}`, rungs);
      const cost = merged(rungs, r => r.faults.cost);
      b.track(`matching ${app} ${world}: each search stays within searchBudget checks and ${searchTouchesPerCheck} × searchBudget touches`, cost.count === 0, show(cost));
    }
  }
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const list = (k: string): string[] => argv.flatMap((x, i) => (x === `--${k}` ? (argv[i + 1] ?? "").split(",") : [])).filter(Boolean);
  const packs = list("packs"), worlds = list("worlds"), sizes = list("sizes").map(Number), lanes = list("lanes");
  const apps = APP_IDS.filter(app => packs.includes(app));
  const unknownWorld = worlds.find(x => !PLANTED_WORLDS.some(known => known === x));
  const unknownLane = lanes.find(x => !PLANTED_LANES.some(known => known === x));
  if (unknownWorld || unknownLane || apps.length !== packs.length || sizes.some(n => !Number.isSafeInteger(n) || n < 2)) {
    console.error(`usage: scale.ts --packs ntwrk,slop,peon,friends --worlds ${PLANTED_WORLDS.join(",")} --sizes 1000,2000 [--lanes Friend]`);
    process.exit(2);
  }
  const b = new Block("scale");
  for (const app of apps.length ? apps : APP_IDS) {
    const offered = lanesOf(packOf(app)).filter(lane => !lanes.length || lanes.includes(lane));
    for (const world of worlds.length ? worlds.filter((x): x is PlantedWorld => PLANTED_WORLDS.some(known => known === x)) : ["planted" as const]) {
      const rungs = runLadder(app, world, sizes.length ? sizes : LADDER_QUICK, offered);
      printLadder(rungs);
      ladderGates(b, `scale ${app} ${world}`, rungs);
    }
  }
  const failed = b.gates.filter(g => g.blocking && !g.pass).length;
  console.log(`\n${failed ? "FAIL" : "PASS"}: ${b.gates.filter(g => g.blocking).length - failed}/${b.gates.filter(g => g.blocking).length} blocking gates`);
  process.exit(failed ? 1 : 0);
}
