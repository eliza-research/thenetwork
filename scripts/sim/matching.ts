// The matching block: the generic match core (packages/engine/src/match) and runEngine on planted
// worlds (packages/sim/src/planted.ts), engine only, offline and deterministic, for each pack and
// each lane the pack offers (one lane per world, so every proposal belongs to that lane).
// PINNED (CI): seeds 1-10; exactness at N 100, 200 and 400; the engine gates at N 200 (the shipped
// config, plus a greedy-only arm for stability); cost at N 1,000 (every lane), 10,000 and 100,000
// (each pack's primary lane, seed 1). --quick: seeds 1-3, exactness at N 100 and 200, cost at N
// 1,000 and 10,000. The hidden truth (planted circles and standing) is read here only.
import { hash32, Rng, type MemberId } from "../../packages/core/src/index.ts";
import { laneLimits, laneOffered, laneOffset, type MatchLane } from "../../packages/core/src/generated/matchLane.ts";
import { parityAllowed, standingGap } from "../../packages/core/src/generated/pairValue.ts";
import { resolveConfig, type EngineConfigInput } from "../../packages/engine/src/config.ts";
import { localEmbed } from "../../packages/engine/src/embed.ts";
import { canonicalInput, runEngine } from "../../packages/engine/src/engine.ts";
import { bruteForceCandidates, pairSideOf, partnerBlock, type MatchProfile } from "../../packages/engine/src/match/mod.ts";
import { vectorsOf } from "../../packages/engine/src/match/pair.ts";
import type { AppPack } from "../../packages/engine/src/pack.ts";
import { networkPack } from "../../packages/engine/src/packs/network/index.ts";
import type { EngineInput } from "../../packages/engine/src/types.ts";
import { World } from "../../packages/engine/src/world.ts";
import { appWiring } from "../../packages/network/service/packs.ts";
import {
  adjustedRandIndex, groupPurity, matchedStandingCorrelation, pairPrecision, PLANTED_LANES, plantedEngineInput, plantedLabels,
  plantedPairTruth, randomGroups, type PlantedTruth,
} from "../../packages/sim/src/planted.ts";
import { Block } from "./gate.ts";

interface Plan {
  readonly seeds: readonly number[];
  readonly exactN: readonly number[];
  readonly engineN: number;
  readonly costN: readonly number[];
  readonly everyLaneUpTo: number;
  readonly costSeed: number;
}
export const MATCHING_PINNED: Plan = {
  seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], exactN: [100, 200, 400], engineN: 200,
  costN: [1_000, 10_000, 100_000], everyLaneUpTo: 1_000, costSeed: 1,
};
const MATCHING_QUICK: Plan = { seeds: [1, 2, 3], exactN: [100, 200], engineN: 200, costN: [1_000, 10_000], everyLaneUpTo: 1_000, costSeed: 1 };

const PACKS: readonly AppPack[] = (["ntwrk", "slop", "peon", "friends"] as const).map(app => appWiring(app).pack ?? networkPack);
const shippedConfig = (pack: AppPack, seed: number): EngineConfigInput => ({ ...appWiring(pack.id).engine, seed });
const PRIMARY_LANE: Readonly<Record<string, MatchLane>> = { ntwrk: "Intro", slop: "Date", peon: "Hire", friends: "Friend" };
const lanesOf = (pack: AppPack): MatchLane[] => PLANTED_LANES.filter(lane => laneOffered(pack.id, lane));
/** The slop block's low-tier exposure rule: no quintile under 0.85x the overall rate (packEval.ts gates3). */
const LOW_QUINTILE_RATIO = 0.85;
// No exploration slice and no exposure-floor pass, so blockingPairs measures the greedy phase alone.
const greedyConfig = (pack: AppPack, seed: number): EngineConfigInput => {
  const config = shippedConfig(pack, seed);
  return { ...config, exploration: { ...config.exploration, rate: 0 }, selection: { ...config.selection, exposureFloorShare: 0 } };
};
// The match core reads no embedding; a flat one keeps a 100,000-member World cheap to build.
const flatEmbed = (): number[] => [1];

type Pair = readonly [MemberId, MemberId];
interface Faults { count: number; first?: string }
interface CostRow { profiles: number; checks: number; bound: number; tally: number; ms: number }
interface LaneStats {
  readonly lane: MatchLane;
  searches: number; exact: number; runs: number; laneProfiles: number; noKept: number;
  pairs: number; groups: number; circles: number; blockingPairs: number;
  readonly empty: Faults; readonly minors: Faults; readonly mismatch: Faults; readonly missed: Faults;
  readonly parity: Faults; readonly reciprocity: Faults; readonly unprofiled: Faults; readonly groupFaults: Faults;
  readonly logged: { members: number; exact: number };
  readonly rho: number[]; readonly rhoRandom: number[]; readonly worse: number[]; readonly worseRandom: number[];
  readonly ari: number[]; readonly ariRandom: number[]; readonly purity: number[]; readonly purityRandom: number[];
  readonly precision: number[]; readonly precisionRandom: number[];
  readonly low: { members: number; proposed: number }; readonly all: { members: number; proposed: number };
  readonly cost: Map<number, CostRow>;
}

const noFaults = (): Faults => ({ count: 0 });
const laneStats = (lane: MatchLane): LaneStats => ({
  lane, searches: 0, exact: 0, runs: 0, laneProfiles: 0, noKept: 0, pairs: 0, groups: 0, circles: 0, blockingPairs: 0,
  empty: noFaults(), minors: noFaults(), mismatch: noFaults(), missed: noFaults(),
  parity: noFaults(), reciprocity: noFaults(), unprofiled: noFaults(), groupFaults: noFaults(),
  logged: { members: 0, exact: 0 },
  rho: [], rhoRandom: [], worse: [], worseRandom: [], ari: [], ariRandom: [], purity: [], purityRandom: [], precision: [], precisionRandom: [],
  low: { members: 0, proposed: 0 }, all: { members: 0, proposed: 0 }, cost: new Map(),
});
const fault = (f: Faults, what: string): void => { f.count++; f.first ??= what; };

const ids = (rows: readonly { readonly profile: MatchProfile; readonly value: number }[]) => rows.map(r => `${r.profile.id}:${r.value}`).join(",");

// spec/candidateSearch.md, "Story: Keep the best candidates within a fixed number of pair checks":
// an exact search keeps exactly the brute-force top list; a budgeted one misses nothing above its bound.
function exactness(w: World, s: LaneStats, at: string): void {
  for (const p of w.match.profiles) {
    const result = w.match.candidates(p);
    const brute = bruteForceCandidates(w, w.match.index, p);
    s.searches++;
    if (result.exact) {
      s.exact++;
      const same = result.kept.length === brute.length
        && result.kept.every((k, i) => k.profile.id === brute[i]!.profile.id && k.value === brute[i]!.value);
      if (!same) fault(s.mismatch, `${at} ${p.id}: kept [${ids(result.kept)}], brute force [${ids(brute)}]`);
    } else {
      const kept = new Set(result.kept.map(k => k.profile.id));
      const missed = brute.find(c => !kept.has(c.profile.id) && c.value > result.unseenBound);
      if (missed) fault(s.missed, `${at} ${p.id}: missed ${missed.profile.id} (${missed.value}) above the unseen bound ${result.unseenBound}`);
    }
  }
}

function directed(w: World, a: MatchProfile, b: MatchProfile): number {
  const vectors = vectorsOf(w);
  return pairSideOf(a, b, vectors.traits?.costs ?? [], vectors.packValue?.(w, a, b)).utility;
}

// spec/groupFormation.md, "A primary circle values every pair and keeps a narrow standing spread"
function groupFault(w: World, lane: MatchLane, group: readonly MatchProfile[]): string | null {
  const { circlePairFloor, rules } = laneLimits(lane);
  for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
    // circlePairFloor >= 0, so a pair without a value (noPairValue) always fails here.
    const value = w.match.value(group[i]!, group[j]!);
    if (value < circlePairFloor) return `pair ${group[i]!.id}-${group[j]!.id} value ${value} below ${circlePairFloor}`;
  }
  const byStanding = [...group].sort((x, y) => x.standing - y.standing || x.ordinal - y.ordinal);
  const low = byStanding[0]!, high = byStanding[byStanding.length - 1]!;
  const allowed = rules.parityBand + low.uncertainty + high.uncertainty;
  return high.standing - low.standing > allowed ? `standing spread ${high.standing - low.standing} above ${allowed}` : null;
}

function randomPairs(w: World, lane: MatchLane, count: number, seed: number): Pair[] {
  const r = new Rng(hash32("matching-random-pairs", seed, lane));
  const pool = w.match.profiles.filter(p => p.lane === lane);
  const out: Pair[] = [];
  for (let tries = 0; pool.length && out.length < count && tries < 8 * count; tries++) {
    const a = r.pick(pool);
    const partners = partnerBlock(w.match.index, a)?.profiles ?? [];
    if (!partners.length) continue;
    const b = r.pick(partners);
    if (b.memberId !== a.memberId) out.push([a.memberId, b.memberId]);
  }
  return out;
}

const mean = (xs: readonly number[]): number => {
  const finite = xs.filter(Number.isFinite);
  return finite.length ? finite.reduce((t, x) => t + x, 0) / finite.length : NaN;
};

async function engineGates(pack: AppPack, seed: number, input: EngineInput, truth: PlantedTruth, w: World, s: LaneStats): Promise<void> {
  const lane = s.lane, at = `seed ${seed}`;
  const shipped = await runEngine(input, shippedConfig(pack, seed), { pack });
  const greedy = await runEngine(input, greedyConfig(pack, seed), { pack });
  s.runs++;
  s.blockingPairs += greedy.runLog.blockingPairs;
  const logged = shipped.runLog.search;
  if (logged) { s.logged.members += logged.members; s.logged.exact += logged.exact; }

  const minors = new Set(truth.members.filter(m => !m.adult).map(m => m.id));
  for (const id of minors) if (w.match.profilesOf(id).length) fault(s.minors, `${at}: minor ${id} has a profile`);
  const own = w.match.profiles.filter(p => p.lane === lane);
  if (!own.length) fault(s.empty, `${at}: no ${lane} profiles`);
  s.laneProfiles += own.length;
  for (const p of own) if (!w.match.candidates(p).kept.length) s.noKept++;

  const { utilityFloor } = laneLimits(lane).rules;
  const pairs: Pair[] = [];
  const proposed = new Set<MemberId>();
  for (const p of shipped.proposals) {
    if (p.participants.some(id => minors.has(id))) { fault(s.minors, `${at}: proposal ${p.id} includes a minor`); continue; }
    if (p.participants.length < 2 || p.lane !== lane) continue;
    for (const id of p.participants) proposed.add(id);
    const group = p.participants.flatMap(id => {
      const entity = p.entities?.[id];
      const q = entity ? w.match.profile(entity) : w.match.profileIn(id, lane);
      return q?.lane === lane && q.memberId === id ? [q] : [];
    });
    if (group.length !== p.participants.length) { fault(s.unprofiled, `${at}: proposal ${p.id} (${p.generator}) has a participant without a ${lane} profile`); continue; }
    if (group.length > 2) {
      s.groups++;
      const f = groupFault(w, lane, group);
      if (f) fault(s.groupFaults, `${at}: proposal ${p.id}: ${f}`);
      continue;
    }
    const [a, b] = group as [MatchProfile, MatchProfile];
    if (w.match.value(a, b) < 0) { fault(s.reciprocity, `${at}: ${p.id} (${p.generator}) has no eligible ${lane} pair`); continue; }
    s.pairs++;
    pairs.push([a.memberId, b.memberId]);
    // spec/pairValue.md, "A pair is refused when the gap is wider than the band and both uncertainties"
    const gap = standingGap(a.standing, b.standing, laneOffset(lane, a.side));
    if (!parityAllowed(gap, laneLimits(lane).rules.parityBand, a.uncertainty, b.uncertainty)) {
      fault(s.parity, `${at}: ${a.id} (${a.standing}±${a.uncertainty}) and ${b.id} (${b.standing}±${b.uncertainty}) gap ${gap}`);
    }
    // spec/pairValue.md, "A pair has a value only when both utilities reach the lane floor"
    const ua = directed(w, a, b), ub = directed(w, b, a);
    if (ua < utilityFloor || ub < utilityFloor) fault(s.reciprocity, `${at}: ${a.id}->${b.id} ${ua}, ${b.id}->${a.id} ${ub}, floor ${utilityFloor}`);
  }

  if (pairs.length) {
    const random = randomPairs(w, lane, pairs.length, seed);
    s.rho.push(matchedStandingCorrelation(truth, lane, pairs));
    s.rhoRandom.push(matchedStandingCorrelation(truth, lane, random));
    s.worse.push(mean(pairs.map(([a, b]) => plantedPairTruth(truth, lane, a, b))));
    s.worseRandom.push(mean(random.map(([a, b]) => plantedPairTruth(truth, lane, a, b))));
  }

  if (laneLimits(lane).circleMaximum >= 3) {
    const circles = w.match.circles(lane);
    s.circles += circles.length;
    const groups: MemberId[][] = [];
    const { circleMinimum, circleMaximum } = laneLimits(lane);
    for (const circle of circles) {
      const members = circle.members.flatMap(id => { const q = w.match.profile(id); return q ? [q] : []; });
      const size = circle.members.length;
      const f = members.length !== size ? "a member without a profile"
        : size < circleMinimum || size > circleMaximum ? `size ${size} outside ${circleMinimum}..${circleMaximum}`
        : groupFault(w, lane, members);
      if (f) fault(s.groupFaults, `${at}: circle ${circle.members.join(",")}: ${f}`);
      groups.push(members.map(q => q.memberId));
    }
    if (groups.length) {
      const labels = plantedLabels(truth);
      const random = randomGroups(groups.map(g => g.length), [...new Set(own.map(q => q.memberId))], `matching-${seed}-${lane}`);
      s.ari.push(adjustedRandIndex(groups, labels)); s.ariRandom.push(adjustedRandIndex(random, labels));
      s.purity.push(groupPurity(groups, labels)); s.purityRandom.push(groupPurity(random, labels));
      s.precision.push(pairPrecision(groups, labels)); s.precisionRandom.push(pairPrecision(random, labels));
    }
  }

  const standingOf = (id: MemberId): number => truth.members[truth.ordinalOf.get(id)!]!.lanes[lane]?.standing ?? 0;
  const members = [...new Set(own.map(q => q.memberId))].sort((x, y) => standingOf(x) - standingOf(y) || (x < y ? -1 : x > y ? 1 : 0));
  const low = members.slice(0, Math.ceil(members.length / 5));
  s.low.members += low.length; s.low.proposed += low.filter(id => proposed.has(id)).length;
  s.all.members += members.length; s.all.proposed += members.filter(id => proposed.has(id)).length;
}

function costRun(pack: AppPack, n: number, seed: number, s: LaneStats): void {
  const { input } = plantedEngineInput({ seed: `matching-${seed}`, n, lanes: [s.lane], app: pack.id });
  const w = new World(input, resolveConfig(shippedConfig(pack, seed)), flatEmbed, pack);
  const profiles = w.match.profiles;
  const t = performance.now();
  let checks = 0, bound = 0;
  for (const p of profiles) { checks += w.match.candidates(p).checks; bound += laneLimits(p.lane).searchBudget; }
  s.cost.set(n, { profiles: profiles.length, checks, bound, tally: w.match.tally().checks, ms: Math.round(performance.now() - t) });
}

const pct = (x: number, n: number): string => (n ? `${((100 * x) / n).toFixed(1)}%` : "-");
const fixed = (x: number, digits = 3): string => (Number.isFinite(x) ? x.toFixed(digits) : "-");
const versus = (a: readonly number[], b: readonly number[]): string => `${fixed(mean(a))} / ${fixed(mean(b))}`;
const lowRatio = (s: LaneStats): number => (s.low.members && s.all.proposed ? (s.low.proposed / s.low.members) / (s.all.proposed / s.all.members) : NaN);

type Row = readonly [string, (s: LaneStats) => string];
function printTable(pack: AppPack, lanes: readonly LaneStats[], plan: Plan): void {
  const costRow = (label: string, f: (c: CostRow) => string) => plan.costN.map((n): Row => [`${label} N ${n}`, s => { const c = s.cost.get(n); return c ? f(c) : "-"; }]);
  const rows: Row[] = [
    [`profiles per run (N ${plan.engineN})`, s => fixed(s.laneProfiles / Math.max(1, s.runs), 1)],
    ["exact searches", s => pct(s.exact, s.searches)],
    ["exact != brute force", s => String(s.mismatch.count)],
    ["budgeted, missed > bound", s => String(s.missed.count)],
    ["no kept candidate", s => pct(s.noKept, s.laneProfiles)],
    ["runLog.search exact", s => pct(s.logged.exact, s.logged.members)],
    ["proposed pairs / groups", s => `${s.pairs} / ${s.groups}`],
    ["parity faults", s => String(s.parity.count)],
    ["reciprocity faults", s => String(s.reciprocity.count)],
    ["unprofiled proposals", s => String(s.unprofiled.count)],
    ["blocking pairs (greedy)", s => String(s.blockingPairs)],
    ["standing rho match / random", s => versus(s.rho, s.rhoRandom)],
    ["worse-side truth match / random", s => versus(s.worse, s.worseRandom)],
    ["circles / group faults", s => `${s.circles} / ${s.groupFaults.count}`],
    ["ARI circles / random", s => versus(s.ari, s.ariRandom)],
    ["purity circles / random", s => versus(s.purity, s.purityRandom)],
    ["pair precision circles / random", s => versus(s.precision, s.precisionRandom)],
    ["low quintile / overall rate", s => fixed(lowRatio(s), 2)],
    ...costRow("checks/profile", c => fixed(c.checks / Math.max(1, c.profiles), 1)),
    ...costRow("search ms", c => String(c.ms)),
  ];
  const table = [["", ...lanes.map(s => s.lane)], ...rows.map(([label, f]) => [label, ...lanes.map(f)])];
  const widths = table[0]!.map((_, k) => Math.max(...table.map(r => r[k]!.length)));
  console.log(`  ${pack.id} (${plan.seeds.length} seeds; exactness N ${plan.exactN.join("/")}; engine N ${plan.engineN})`);
  for (const r of table) console.log(`    ${r.map((c, k) => (k ? c.padStart(widths[k]!) : c.padEnd(widths[k]!))).join("  ")}`);
}

function packGates(b: Block, pack: AppPack, lanes: readonly LaneStats[], plan: Plan): void {
  const id = `matching ${pack.id}`;
  const runs = `${plan.seeds.length} seeds`;
  const merged = (...picks: ((s: LaneStats) => Faults)[]): Faults => {
    const all = lanes.flatMap(s => picks.map(pick => pick(s)));
    return { count: all.reduce((t, f) => t + f.count, 0), first: all.find(f => f.first)?.first };
  };
  const show = (f: Faults): string => (f.count ? `${f.count} faults; first: ${f.first}` : "0 faults");
  const perLane = (f: (s: LaneStats) => string): string => lanes.map(s => `${s.lane} ${f(s)}`).join("; ");

  const setup = merged(s => s.empty, s => s.minors, s => s.unprofiled);
  for (const s of lanes) {
    if (s.noKept >= s.laneProfiles) fault(setup, `${s.lane}: no search kept a candidate`);
    if (s.pairs + s.groups === 0) fault(setup, `${s.lane}: no pair or group proposed`);
  }
  b.gate(`${id}: every lane builds profiles, keeps candidates and proposes at N ${plan.engineN}; every proposal resolves to lane profiles; no minor has a profile or a proposal (${runs})`,
    setup.count === 0,
    `${perLane(s => `${fixed(s.laneProfiles / Math.max(1, s.runs), 1)} profiles/run, ${s.pairs + s.groups} proposals`)}; ${show(setup)}`);

  const exact = merged(s => s.mismatch, s => s.missed);
  b.gate(`${id}: exact searches equal brute force, budgeted ones miss nothing above their bound (N ${plan.exactN.join("/")}, ${runs})`, exact.count === 0,
    `exact share ${perLane(s => pct(s.exact, s.searches))}; ${show(exact)}`);

  const cost: Faults = { count: 0 };
  for (const s of lanes) for (const [n, c] of s.cost) {
    if (c.profiles === 0) fault(cost, `${s.lane} N ${n}: no profiles`);
    else if (c.checks > c.bound) fault(cost, `${s.lane} N ${n}: ${c.checks} checks > ${c.bound}`);
    else if (c.tally !== c.checks) fault(cost, `${s.lane} N ${n}: tally ${c.tally} != ${c.checks} checks`);
  }
  b.gate(`${id}: pair checks <= profiles x searchBudget (N ${plan.costN.join("/")})`, cost.count === 0,
    `${perLane(s => [...s.cost].map(([n, c]) => `N ${n} ${fixed(c.checks / Math.max(1, c.profiles), 1)}/profile ${c.ms}ms`).join(", "))}; ${show(cost)}`);

  const parity = merged(s => s.parity);
  b.gate(`${id}: no proposed pair has a standing gap beyond band + both uncertainties (${runs})`, parity.count === 0,
    `${perLane(s => `${s.pairs} pairs`)}; ${show(parity)}`);

  const reciprocity = merged(s => s.reciprocity);
  b.gate(`${id}: both directed utilities of every proposed pair reach the lane floor (${runs})`, reciprocity.count === 0, show(reciprocity));

  const blocking = lanes.reduce((t, s) => t + s.blockingPairs, 0);
  b.gate(`${id}: no blocking pair in the greedy phase (${runs})`, blocking === 0, perLane(s => `${s.blockingPairs}`));

  const groups = merged(s => s.groupFaults);
  b.gate(`${id}: every circle within circleMinimum..circleMaximum; every pair of every circle and proposed group reaches circlePairFloor, spread within the band (${runs})`, groups.count === 0,
    `${perLane(s => `${s.circles} circles, ${s.groups} groups`)}; ${show(groups)}`);

  const above = (xs: readonly number[], ys: readonly number[]) => mean(xs) > mean(ys);
  const paired = lanes.filter(s => s.rho.length);
  b.track(`${id}: matched standing correlation above a random pairing (${runs})`,
    paired.length > 0 && paired.every(s => above(s.rho, s.rhoRandom)), perLane(s => versus(s.rho, s.rhoRandom)));
  b.track(`${id}: hidden worse-side utility above a random pairing (${runs})`,
    paired.length > 0 && paired.every(s => above(s.worse, s.worseRandom)), perLane(s => versus(s.worse, s.worseRandom)));

  const circled = lanes.filter(s => laneLimits(s.lane).circleMaximum >= 3);
  if (circled.length) {
    const recovered = circled.filter(s => s.ari.length);
    b.track(`${id}: circles recover planted circles better than random groups of the same sizes (ARI, purity, pair precision; ${runs})`,
      recovered.length === circled.length && recovered.every(s => above(s.ari, s.ariRandom) && above(s.purity, s.purityRandom) && above(s.precision, s.precisionRandom)),
      circled.map(s => `${s.lane} ARI ${versus(s.ari, s.ariRandom)}, purity ${versus(s.purity, s.purityRandom)}, precision ${versus(s.precision, s.precisionRandom)}`).join("; "));
  }

  b.track(`${id}: lowest standing quintile proposal rate >= ${LOW_QUINTILE_RATIO}x overall (${runs})`,
    lanes.every(s => lowRatio(s) >= LOW_QUINTILE_RATIO),
    perLane(s => `ratio ${fixed(lowRatio(s), 2)}, no kept candidate ${pct(s.noKept, s.laneProfiles)}`));

  const primary = lanes.find(s => s.lane === PRIMARY_LANE[pack.id]);
  if (primary) {
    const shares = [...primary.cost].sort(([x], [y]) => x - y).map(([n, c]) => ({ n, share: c.profiles > 1 ? c.checks / ((c.profiles * (c.profiles - 1)) / 2) : NaN }));
    b.track(`${id}: ${primary.lane} pair checks as a share of all pairs fall with N`,
      shares.length > 1 && shares.every((x, k) => k === 0 || x.share < shares[k - 1]!.share),
      shares.map(x => `N ${x.n} ${x.share.toExponential(2)}`).join(", "));
  }
}

export async function matchingBlock(b: Block, o: { quick: boolean }): Promise<void> {
  const plan = o.quick ? MATCHING_QUICK : MATCHING_PINNED;
  const stats = PACKS.map(pack => ({ pack, lanes: lanesOf(pack).map(laneStats) }));
  for (const n of plan.exactN) for (const seed of plan.seeds) for (const { pack, lanes } of stats) for (const s of lanes) {
    const { input, truth } = plantedEngineInput({ seed: `matching-${seed}`, n, lanes: [s.lane], app: pack.id });
    // runEngine canonicalizes its input the same way, so this World holds the run's profiles.
    const w = new World(canonicalInput(input), resolveConfig(shippedConfig(pack, seed)), localEmbed, pack);
    exactness(w, s, `N ${n} seed ${seed}`);
    if (n === plan.engineN) await engineGates(pack, seed, input, truth, w, s);
  }
  for (const n of plan.costN) for (const { pack, lanes } of stats) for (const s of lanes) {
    if (n <= plan.everyLaneUpTo || s.lane === PRIMARY_LANE[pack.id]) costRun(pack, n, plan.costSeed, s);
  }
  for (const { pack, lanes } of stats) {
    printTable(pack, lanes, plan);
    packGates(b, pack, lanes, plan);
  }
}
