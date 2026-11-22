// The matching block: the generic match core (packages/engine/src/match) and runEngine on planted
// worlds (packages/sim/src/planted.ts), engine only, offline and deterministic, for each pack and
// each lane the pack offers. Every proposal is checked in its own lane. Quality metrics grade
// the planted lane, including when a mixed Network fixture produces its other lane's proposals.
// PINNED (CI): seeds 1-10; exactness at N 100, 200 and 400; the engine gates at N 200 (the shipped
// config, plus a greedy-only arm for stability); cost at N 1,000 (every lane), 10,000 and 100,000
// (each pack's primary lane, seed 1). --quick: seeds 1-3, exactness at N 100 and 200, cost at N
// 1,000 and 10,000. The hidden truth (planted circles and standing) is read here only.
import { hash32, Rng, type MemberId } from "../../packages/core/src/index.ts";
import { searchTouchesPerCheck } from "../../packages/core/src/generated/candidateSearch.ts";
import { laneLimits, laneOffered, laneOffset, type MatchLane } from "../../packages/core/src/generated/matchLane.ts";
import { pairValueScale, parityAllowed, standingGap } from "../../packages/core/src/generated/pairValue.ts";
import { resolveConfig, type EngineConfigInput } from "../../packages/engine/src/config.ts";
import { localEmbed } from "../../packages/engine/src/embed.ts";
import { canonicalInput, runEngine } from "../../packages/engine/src/engine.ts";
import { pairReason } from "../../packages/engine/src/filters.ts";
import { bruteForceCandidates, laneCategory, pairSideOf, partnerBlock, type MatchProfile, type SearchResult } from "../../packages/engine/src/match/mod.ts";
import { eligiblePair, segmentReaches, vectorsOf } from "../../packages/engine/src/match/pair.ts";
import { searchWindowMetrics } from "../../packages/engine/src/match/search.ts";
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

export const MATCHING_PACKS = ["ntwrk", "slop", "peon", "friends"] as const;
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
/**
 * What a budgeted search faced, summed over the budgeted profiles: the window (partners in reached
 * segments and in the standing window), the summed and the shortest tag range inside it, and the
 * partner segments the profile lists (for friends the homes in transit tolerance, for slop the
 * pools sought times the cells in the radius).
 */
interface Budgeted { profiles: number; window: number; ranges: number; shortest: number; partnerSegments: number }
/** `segmentShare`: summed over profiles, the share of the partner block in segments the profile reaches. */
interface CostRow { profiles: number; exact: number; checks: number; touches: number; ms: number; segmentShare: number; budgeted: Budgeted }
interface LaneStats {
  readonly lane: MatchLane;
  searches: number; exact: number; certificates: number; runs: number; laneProfiles: number; noKept: number;
  pairs: number; groups: number; otherLane: number; circles: number; blockingPairs: number;
  readonly empty: Faults; readonly minors: Faults; readonly mismatch: Faults; readonly missed: Faults;
  readonly parity: Faults; readonly reciprocity: Faults; readonly unprofiled: Faults; readonly groupFaults: Faults;
  readonly searchCost: Faults; readonly segmentSuperset: Faults;
  segmentRefused: number;
  readonly logged: { members: number; exact: number };
  readonly rho: number[]; readonly rhoRandom: number[]; readonly worse: number[]; readonly worseRandom: number[];
  readonly ari: number[]; readonly ariRandom: number[]; readonly purity: number[]; readonly purityRandom: number[];
  readonly precision: number[]; readonly precisionRandom: number[];
  readonly low: { members: number; proposed: number }; readonly all: { members: number; proposed: number };
  readonly cost: Map<number, CostRow>;
}

const noFaults = (): Faults => ({ count: 0 });
const laneStats = (lane: MatchLane): LaneStats => ({
  lane, searches: 0, exact: 0, certificates: 0, runs: 0, laneProfiles: 0, noKept: 0, pairs: 0, groups: 0, otherLane: 0, circles: 0, blockingPairs: 0,
  empty: noFaults(), minors: noFaults(), mismatch: noFaults(), missed: noFaults(),
  parity: noFaults(), reciprocity: noFaults(), unprofiled: noFaults(), groupFaults: noFaults(),
  searchCost: noFaults(), segmentSuperset: noFaults(), segmentRefused: 0,
  logged: { members: 0, exact: 0 },
  rho: [], rhoRandom: [], worse: [], worseRandom: [], ari: [], ariRandom: [], purity: [], purityRandom: [], precision: [], precisionRandom: [],
  low: { members: 0, proposed: 0 }, all: { members: 0, proposed: 0 }, cost: new Map(),
});
const fault = (f: Faults, what: string): void => { f.count++; f.first ??= what; };

const ids = (rows: readonly { readonly profile: MatchProfile; readonly value: number }[]) => rows.map(r => `${r.profile.id}:${r.value}`).join(",");

function checkSearchCost(s: LaneStats, p: MatchProfile, result: SearchResult, at: string): void {
  const budget = laneLimits(p.lane).searchBudget;
  const touchLimit = searchTouchesPerCheck * budget;
  const { checks, touches, exact } = result;
  if (!Number.isSafeInteger(checks) || checks < 0 || checks > budget) fault(s.searchCost, `${at} ${p.id}: ${checks} pair checks outside 0..${budget}`);
  if (!Number.isSafeInteger(touches) || touches < checks || touches > touchLimit) fault(s.searchCost, `${at} ${p.id}: ${touches} touches outside ${checks}..${touchLimit}`);
  if (!exact && checks < budget && touches < touchLimit) fault(s.searchCost, `${at} ${p.id}: search closed before either budget was exhausted`);
}

// A Budgeted search with a full kept list has worst-kept value at most unseenBound, or it would
// close Exact. Every checked and dropped pair is at or below that value. A non-full list drops
// no feasible pair, so the certificate can be checked against every omitted partner.
function checkCertificate(w: World, s: LaneStats, p: MatchProfile, result: SearchResult, at: string): void {
  s.certificates++;
  const { unseenBound } = result;
  if (!Number.isSafeInteger(unseenBound) || unseenBound < 0 || unseenBound > pairValueScale) {
    fault(s.missed, `${at} ${p.id}: budgeted unseen bound ${unseenBound} is outside 0..${pairValueScale}`);
    return;
  }
  const kept = new Set(result.kept.map(candidate => candidate.profile.id));
  for (const other of partnerBlock(w.match.index, p)?.profiles ?? []) {
    if (kept.has(other.id)) continue;
    const value = w.match.value(p, other);
    if (value <= unseenBound) continue;
    fault(s.missed, `${at} ${p.id}: missed ${other.id} (${value}) above the unseen bound ${unseenBound}`);
    break;
  }
}

// spec/candidateSearch.md, "Story: Keep the best candidates within a fixed number of pair checks":
// an exact search keeps exactly the brute-force top list; a budgeted one misses nothing above its bound.
function exactness(w: World, s: LaneStats, at: string): void {
  for (const p of w.match.profiles) {
    const result = w.match.candidates(p);
    checkSearchCost(s, p, result, at);
    s.searches++;
    if (result.exact) {
      const brute = bruteForceCandidates(w, w.match.index, p);
      s.exact++;
      const same = result.kept.length === brute.length
        && result.kept.every((k, i) => k.profile.id === brute[i]!.profile.id && k.value === brute[i]!.value);
      if (!same) fault(s.mismatch, `${at} ${p.id}: kept [${ids(result.kept)}], brute force [${ids(brute)}]`);
    } else {
      checkCertificate(w, s, p, result, at);
    }
    segmentSuperset(w, s, p, at);
  }
}

// spec/candidateSearch.md, "Segment blocking never drops a pair the pair gate admits": a pack gives
// segments only as a superset of its pair rules, so no pair the segment check refuses is one that
// the pack rules and geo rule (pairReason) admit. The oracle uses the same gate, so only this catches it.
function segmentSuperset(w: World, s: LaneStats, p: MatchProfile, at: string): void {
  const block = partnerBlock(w.match.index, p);
  if (!block) return;
  const expected = block.segments.filter(span => segmentReaches(p, block.profiles[span.start]!));
  const indexed = block.reachableSegments(p.segment?.partners);
  if (indexed.length !== expected.length || indexed.some((span, i) => span !== expected[i])) {
    fault(s.segmentSuperset, `${at} ${p.id}: segment index differs from the ordered scan`);
  }
  for (const other of block.profiles) {
    if (eligiblePair(w, p, other) !== "segment_unreachable") continue;
    s.segmentRefused++;
    if (pairReason(w, p.memberId, other.memberId, laneCategory(p.lane), p.lane) === null) {
      fault(s.segmentSuperset, `${at} ${p.id}: segment refuses ${other.id}, which the pack rules admit`);
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

  const pairs: Pair[] = [];
  const proposed = new Set<MemberId>();
  for (const p of shipped.proposals) {
    if (p.participants.some(id => minors.has(id))) { fault(s.minors, `${at}: proposal ${p.id} includes a minor`); continue; }
    if (p.participants.length < 2) continue;
    const proposalLane = p.lane;
    if (!proposalLane) { fault(s.unprofiled, `${at}: multi-member proposal ${p.id} has no lane`); continue; }
    const graded = proposalLane === lane;
    if (!graded) s.otherLane++;
    // The proposal names each participant's matched entity when it differs from the member.
    const group = p.participants.flatMap(id => {
      const entity = p.entities?.[id];
      const q = entity ? w.match.profile(entity) : w.match.profileIn(id, proposalLane);
      return q?.lane === proposalLane && q.memberId === id ? [q] : [];
    });
    if (group.length !== p.participants.length) { fault(s.unprofiled, `${at}: proposal ${p.id} (${p.generator}) has a participant without a ${proposalLane} profile`); continue; }
    if (graded) for (const id of p.participants) proposed.add(id);
    if (group.length > 2) {
      if (graded) s.groups++;
      const f = groupFault(w, proposalLane, group);
      if (f) fault(s.groupFaults, `${at}: proposal ${p.id}: ${f}`);
      continue;
    }
    const [a, b] = group as [MatchProfile, MatchProfile];
    if (w.match.value(a, b) < 0) { fault(s.reciprocity, `${at}: ${p.id} (${p.generator}) has no eligible ${proposalLane} pair`); continue; }
    if (graded) { s.pairs++; pairs.push([a.memberId, b.memberId]); }
    const { parityBand, utilityFloor } = laneLimits(proposalLane).rules;
    // spec/pairValue.md, "A pair is refused when the gap is wider than the band and both uncertainties"
    const gap = standingGap(a.standing, b.standing, laneOffset(proposalLane, a.side));
    if (!parityAllowed(gap, parityBand, a.uncertainty, b.uncertainty)) {
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
  const results = profiles.map(p => w.match.candidates(p));
  const ms = Math.round(performance.now() - t);
  const at = `N ${n} seed ${seed}`;
  let exact = 0, checks = 0, touches = 0, sampled = 0, segmentShare = 0;
  const budgeted: Budgeted = { profiles: 0, window: 0, ranges: 0, shortest: 0, partnerSegments: 0 };
  for (const [i, profile] of profiles.entries()) {
    const result = results[i]!;
    checkSearchCost(s, profile, result, at);
    if (result.exact) exact++;
    checks += result.checks;
    touches += result.touches;
    // spec/candidateSearch.md, "Segment blocking never drops a pair the pair gate admits": the search
    // reads only the segments the profile reaches (reach depends only on the other's segment).
    const block = partnerBlock(w.match.index, profile);
    if (block) {
      const reached = block.reachableSegments(profile.segment?.partners);
      segmentShare += reached.reduce((total, span) => total + span.end - span.start, 0) / block.profiles.length;
    }
    // Keep the cost run subquadratic while exercising real budgeted results in large worlds.
    if (!result.exact && sampled < 3) {
      checkCertificate(w, s, profile, result, at);
      sampled++;
    }
    if (!result.exact && block) {
      const counts = searchWindowMetrics(block, profile);
      budgeted.profiles++;
      budgeted.window += counts.window;
      budgeted.ranges += counts.ranges;
      budgeted.shortest += counts.shortest;
      budgeted.partnerSegments += profile.segment?.partners.size ?? 0;
    }
  }
  if (!profiles.length) fault(s.searchCost, `${at}: no ${s.lane} world profiles`);
  const tally = w.match.tally();
  if (tally.checks !== checks || tally.touches !== touches) {
    fault(s.searchCost, `${at}: tally ${tally.checks} checks / ${tally.touches} touches differs from ${checks} / ${touches}`);
  }
  s.cost.set(n, { profiles: profiles.length, exact, checks, touches, ms, segmentShare, budgeted });
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
    ["budgeted certificates checked", s => String(s.certificates)],
    ["budgeted, missed > bound", s => String(s.missed.count)],
    ["no kept candidate", s => pct(s.noKept, s.laneProfiles)],
    ["runLog.search exact", s => pct(s.logged.exact, s.logged.members)],
    ["proposed pairs / groups", s => `${s.pairs} / ${s.groups}`],
    ["other-lane proposals checked", s => String(s.otherLane)],
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
    ...costRow("exact searches", c => pct(c.exact, c.profiles)),
    ...costRow("checks/profile", c => fixed(c.checks / Math.max(1, c.profiles), 1)),
    ...costRow("touches/profile", c => fixed(c.touches / Math.max(1, c.profiles), 1)),
    ...costRow("search ms", c => String(c.ms)),
    ...costRow("segment window share", c => pct(c.segmentShare, c.profiles)),
    ...costRow("budgeted: window size", c => fixed(c.budgeted.window / c.budgeted.profiles, 1)),
    ...costRow("budgeted: tag range entries", c => fixed(c.budgeted.ranges / c.budgeted.profiles, 1)),
    ...costRow("budgeted: shortest tag range", c => fixed(c.budgeted.shortest / c.budgeted.profiles, 1)),
    ...costRow("budgeted: partner segments", c => fixed(c.budgeted.partnerSegments / c.budgeted.profiles, 1)),
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
  b.gate(`${id}: exact searches equal brute force and checked budgeted certificates bound every omitted candidate`, exact.count === 0,
    `exact share ${perLane(s => pct(s.exact, s.searches))}; certificates ${perLane(s => String(s.certificates))}; ${show(exact)}`);

  const superset = merged(s => s.segmentSuperset);
  b.gate(`${id}: segments never refuse a pair the pack rules admit (exactness worlds)`, superset.count === 0,
    `segment refusals checked ${perLane(s => String(s.segmentRefused))}; ${show(superset)}`);

  const cost = merged(s => s.searchCost);
  b.gate(`${id}: each search stays within searchBudget checks and ${searchTouchesPerCheck} × searchBudget touches (N ${plan.costN.join("/")})`, cost.count === 0,
    `${perLane(s => [...s.cost].map(([n, c]) => `N ${n} ${fixed(c.checks / Math.max(1, c.profiles), 1)} checks, ${fixed(c.touches / Math.max(1, c.profiles), 1)} touches per profile, ${c.ms}ms`).join(", "))}; ${show(cost)}`);

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

export async function matchingBlock(b: Block, o: { quick: boolean; matchingPack?: string }): Promise<void> {
  const plan = o.quick ? MATCHING_QUICK : MATCHING_PINNED;
  const packs = MATCHING_PACKS.filter(app => o.matchingPack === undefined || app === o.matchingPack);
  if (!packs.length) throw new RangeError(`Unknown matching pack: ${o.matchingPack}`);
  for (const app of packs) {
    const pack = appWiring(app).pack ?? networkPack;
    const lanes = lanesOf(pack).map(laneStats);
    for (const n of plan.exactN) {
      console.log(`  ${pack.id}: exactness N ${n}, ${plan.seeds.length} seeds${n === plan.engineN ? " and engine gates" : ""}`);
      for (const seed of plan.seeds) for (const s of lanes) {
        const mixed = n === plan.engineN && seed === plan.seeds[0] && pack.id === "ntwrk" && s.lane === "Intro";
        const { input, truth } = plantedEngineInput({ seed: `matching-${seed}`, n, lanes: mixed ? ["Intro", "Friend"] : [s.lane], app: pack.id });
        // runEngine canonicalizes its input the same way, so this World holds the run's profiles.
        const w = new World(canonicalInput(input), resolveConfig(shippedConfig(pack, seed)), localEmbed, pack);
        exactness(w, s, `N ${n} seed ${seed}`);
        if (n === plan.engineN) await engineGates(pack, seed, input, truth, w, s);
      }
    }
    for (const n of plan.costN) for (const s of lanes) {
      if (n > plan.everyLaneUpTo && s.lane !== PRIMARY_LANE[pack.id]) continue;
      console.log(`  ${pack.id}: ${s.lane} search cost N ${n}, seed ${plan.costSeed}`);
      costRun(pack, n, plan.costSeed, s);
    }
    printTable(pack, lanes, plan);
    packGates(b, pack, lanes, plan);
  }
}
