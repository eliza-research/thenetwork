import { hash32, Rng, type MemberId } from "../../packages/core/src/index.ts";
import { searchTouchesPerCheck } from "../../packages/core/src/generated/candidateSearch.ts";
import { laneLimits, laneOffset, type MatchLane } from "../../packages/core/src/generated/matchLane.ts";
import { pairValueScale, parityAllowed, standingGap } from "../../packages/core/src/generated/pairValue.ts";
import { friendsMutuallyOpen, mutuallyOpen } from "../../packages/core/src/generated/mutualOpenness.ts";
import { cofounderFactsFit } from "../../packages/core/src/generated/cofounderIntent.ts";
import { resolveConfig, type EngineConfigInput } from "../../packages/engine/src/config.ts";
import { localEmbed } from "../../packages/engine/src/embed.ts";
import { canonicalInput, runEngine } from "../../packages/engine/src/engine.ts";
import { pairReason } from "../../packages/engine/src/filters.ts";
import { bruteForceCandidates, laneCategory, pairSideOf, partnerBlock, type MatchProfile, type SearchResult } from "../../packages/engine/src/match/mod.ts";
import { eligiblePair, segmentReaches, vectorsOf } from "../../packages/engine/src/match/pair.ts";
import type { AppPack } from "../../packages/engine/src/pack.ts";
import type { EngineInput } from "../../packages/engine/src/types.ts";
import { World } from "../../packages/engine/src/world.ts";
import {
  adjustedRandIndex, groupPurity, matchedStandingCorrelation, pairPrecision, PLANTED_LANES, plantedEngineInput, plantedLabels,
  plantedPairTruth, randomGroups, statedIdentityGroup, statedOpenness, type PlantedTruth,
} from "../../packages/sim/src/planted.ts";
import { bestPacking, packingValue } from "./circleOracle.ts";
import { Block } from "./gate.ts";
import {
  checkSearchCost, fault, hardWorlds, LADDER_FULL, LADDER_QUICK, ladderGates, lanesOf, noFaults, packOf, PRIMARY_LANE, printLadder,
  runLadder, shippedConfig, type Faults, type Rung,
} from "./scale.ts";

interface Plan {
  readonly seeds: readonly number[];
  readonly exactN: readonly number[];
  readonly engineN: number;
  readonly ladder: readonly number[];
  readonly oracleN: number;
}
const ORACLE_N = 30;
const ORACLE_NODES = 60_000_000;
const ORACLE_SHARE = 0.8;
export const MATCHING_PINNED: Plan = { seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], exactN: [100, 200, 400], engineN: 200, ladder: LADDER_FULL, oracleN: ORACLE_N };
const MATCHING_QUICK: Plan = { seeds: [1, 2, 3], exactN: [100, 200], engineN: 200, ladder: LADDER_QUICK, oracleN: ORACLE_N };

export const MATCHING_PACKS = ["ntwrk", "slop", "peon", "friends"] as const;
/** The slop block's low-tier exposure rule: no quintile under 0.85x the overall rate (packEval.ts gates3). */
const LOW_QUINTILE_RATIO = 0.85;
// No exploration slice and no exposure-floor pass, so blockingPairs measures the greedy phase alone.
const greedyConfig = (pack: AppPack, seed: number): EngineConfigInput => {
  const config = shippedConfig(pack, seed);
  return { ...config, exploration: { ...config.exploration, rate: 0 }, selection: { ...config.selection, exposureFloorShare: 0 } };
};
type Pair = readonly [MemberId, MemberId];
interface LaneStats {
  readonly lane: MatchLane;
  searches: number; exact: number; certificates: number; runs: number; laneProfiles: number; noKept: number;
  pairs: number; groups: number; otherLane: number; circles: number; blockingPairs: number;
  readonly empty: Faults; readonly minors: Faults; readonly mismatch: Faults; readonly missed: Faults;
  readonly parity: Faults; readonly reciprocity: Faults; readonly unprofiled: Faults; readonly groupFaults: Faults;
  readonly searchCost: Faults; readonly segmentSuperset: Faults;
  readonly openness: Faults;
  readonly byGroup: Map<string, { searches: number; exact: number; kept: number; members: number; proposed: number }>;
  segmentRefused: number;
  readonly logged: { members: number; exact: number };
  readonly rho: number[]; readonly rhoRandom: number[]; readonly worse: number[]; readonly worseRandom: number[];
  readonly ari: number[]; readonly ariRandom: number[]; readonly purity: number[]; readonly purityRandom: number[];
  readonly precision: number[]; readonly precisionRandom: number[];
  readonly valueAuc: number[]; readonly keptRecall: number[];
  readonly runPairs: number[];
  readonly circleSizes: number[]; readonly circleLow: number[]; readonly circleMean: number[];
  readonly placed: { members: number; inCircle: number };
  readonly oracle: { greedy: number[]; best: number[]; exact: number; runs: number };
  readonly low: { members: number; proposed: number }; readonly all: { members: number; proposed: number };
}

const laneStats = (lane: MatchLane): LaneStats => ({
  lane, searches: 0, exact: 0, certificates: 0, runs: 0, laneProfiles: 0, noKept: 0, pairs: 0, groups: 0, otherLane: 0, circles: 0, blockingPairs: 0,
  empty: noFaults(), minors: noFaults(), mismatch: noFaults(), missed: noFaults(),
  parity: noFaults(), reciprocity: noFaults(), unprofiled: noFaults(), groupFaults: noFaults(),
  searchCost: noFaults(), segmentSuperset: noFaults(), openness: noFaults(), byGroup: new Map(), segmentRefused: 0,
  logged: { members: 0, exact: 0 },
  rho: [], rhoRandom: [], worse: [], worseRandom: [], ari: [], ariRandom: [], purity: [], purityRandom: [], precision: [], precisionRandom: [],
  valueAuc: [], keptRecall: [], runPairs: [],
  circleSizes: [], circleLow: [], circleMean: [], placed: { members: 0, inCircle: 0 },
  oracle: { greedy: [], best: [], exact: 0, runs: 0 },
  low: { members: 0, proposed: 0 }, all: { members: 0, proposed: 0 },
});

interface Stated { readonly open: ReturnType<typeof statedOpenness>; readonly group: (id: MemberId) => string }
function statedOf(input: EngineInput, lane: MatchLane): Stated {
  const open = statedOpenness(input);
  return { open, group: id => statedIdentityGroup(lane as (typeof PLANTED_LANES)[number], open.dating.get(id), open.friend.get(id)) };
}
const groupRow = (s: LaneStats, g: string) => {
  let row = s.byGroup.get(g);
  if (!row) { row = { searches: 0, exact: 0, kept: 0, members: 0, proposed: 0 }; s.byGroup.set(g, row); }
  return row;
};
function opennessFault(lane: MatchLane | undefined, members: readonly MemberId[], st: Stated): string | null {
  if (lane !== "Date" && lane !== "Friend" && lane !== "Cofounder") return null;
  for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
    const a = members[i]!, b = members[j]!;
    const ok = lane === "Date" ? mutuallyOpen(st.open.dating.get(a)!, st.open.dating.get(b)!)
      : lane === "Cofounder" ? cofounderFactsFit(st.open.cofounder.get(a)!, st.open.cofounder.get(b)!)
      : friendsMutuallyOpen(st.open.friend.get(a) ?? { friendGender: "GenderUnstated", friendOpenness: "FriendsWithAnyone" }, st.open.friend.get(b) ?? { friendGender: "GenderUnstated", friendOpenness: "FriendsWithAnyone" });
    if (!ok) return `${a} and ${b} are not open to each other`;
  }
  return null;
}

const ids = (rows: readonly { readonly profile: MatchProfile; readonly value: number }[]) => rows.map(r => `${r.profile.id}:${r.value}`).join(",");

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
function exactness(w: World, s: LaneStats, at: string, st: Stated): void {
  for (const p of w.match.profiles) {
    const result = w.match.candidates(p);
    checkSearchCost(s.searchCost, p, result, at);
    s.searches++;
    if (p.lane === s.lane) {
      const row = groupRow(s, st.group(p.memberId));
      row.searches++; row.kept += result.kept.length; if (result.exact) row.exact++;
    }
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

async function engineGates(pack: AppPack, seed: number, input: EngineInput, truth: PlantedTruth, w: World, s: LaneStats, st: Stated): Promise<void> {
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
    const closed = opennessFault(proposalLane, p.participants, st);
    if (closed) fault(s.openness, `${at}: proposal ${p.id}: ${closed}`);
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
    s.runPairs.push(pairs.length);
    s.rhoRandom.push(matchedStandingCorrelation(truth, lane, random));
    s.worse.push(mean(pairs.map(([a, b]) => plantedPairTruth(truth, lane, a, b))));
    s.worseRandom.push(mean(random.map(([a, b]) => plantedPairTruth(truth, lane, a, b))));
  }

  valueQuality(w, truth, s);

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
      const closed = opennessFault(lane, members.map(q => q.memberId), st);
      if (closed) fault(s.openness, `${at}: circle ${circle.members.join(",")}: ${closed}`);
      groups.push(members.map(q => q.memberId));
      s.circleSizes.push(size);
      s.circleLow.push(circle.evidence.lowestPairValue);
      s.circleMean.push(circle.evidence.pairValueTotal / Math.max(1, circle.evidence.pairCount));
    }
    const laneMembers = new Set(own.map(q => q.memberId));
    s.placed.members += laneMembers.size;
    s.placed.inCircle += groups.flat().filter(id => laneMembers.has(id)).length;
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
  for (const id of members) { const row = groupRow(s, st.group(id)); row.members++; if (proposed.has(id)) row.proposed++; }
}

function oracleRun(pack: AppPack, seed: number, n: number, s: LaneStats): void {
  const { input } = plantedEngineInput({ seed: `matching-oracle-${seed}`, n, lanes: [s.lane], app: pack.id });
  const w = new World(canonicalInput(input), resolveConfig(shippedConfig(pack, seed)), localEmbed, pack);
  const greedy = packingValue(w.match.circles(s.lane));
  const own = w.match.profiles.filter(p => p.lane === s.lane && p.capacity > 0);
  const best = bestPacking(own, laneLimits(s.lane), (a, b) => w.match.value(a, b), greedy, ORACLE_NODES);
  s.oracle.runs++;
  if (best.exact) s.oracle.exact++;
  s.oracle.greedy.push(greedy); s.oracle.best.push(best.value);
}

function rankAuc(scored: readonly { readonly score: number; readonly good: boolean }[]): number {
  const sorted = [...scored].sort((x, y) => x.score - y.score);
  let goodRanks = 0, good = 0;
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j < sorted.length && sorted[j]!.score === sorted[i]!.score) j++;
    for (let k = i; k < j; k++) if (sorted[k]!.good) { goodRanks += (i + j + 1) / 2; good++; }
    i = j;
  }
  const other = sorted.length - good;
  return good && other ? (goodRanks - (good * (good + 1)) / 2) / (good * other) : NaN;
}

function valueQuality(w: World, truth: PlantedTruth, s: LaneStats): void {
  const { utilityFloor } = laneLimits(s.lane).rules;
  const kept = new Set<string>();
  const scored: { score: number; good: boolean }[] = [];
  let good = 0, goodKept = 0;
  const own = w.match.profiles.filter(p => p.lane === s.lane);
  for (const p of own) for (const c of w.match.candidates(p).kept) kept.add(`${p.id}\u0000${c.profile.id}`);
  for (const a of own) for (const b of partnerBlock(w.match.index, a)?.profiles ?? []) {
    if (a.side === "Seeking" || (a.side === "Peer" && a.id >= b.id) || eligiblePair(w, a, b) !== null) continue;
    const isGood = plantedPairTruth(truth, s.lane, a.memberId, b.memberId) >= utilityFloor;
    scored.push({ score: w.match.value(a, b), good: isGood });
    if (!isGood) continue;
    good++;
    if (kept.has(`${a.id}\u0000${b.id}`) || kept.has(`${b.id}\u0000${a.id}`)) goodKept++;
  }
  if (good > 0 && good < scored.length) { s.valueAuc.push(rankAuc(scored)); s.keptRecall.push(goodKept / good); }
}

const pct = (x: number, n: number): string => (n ? `${((100 * x) / n).toFixed(1)}%` : "-");
const fixed = (x: number, digits = 3): string => (Number.isFinite(x) ? x.toFixed(digits) : "-");
const versus = (a: readonly number[], b: readonly number[]): string => `${fixed(mean(a))} / ${fixed(mean(b))}`;
const oracleShare = (s: LaneStats): number => {
  const best = s.oracle.best.reduce((t, x) => t + x, 0);
  return best > 0 ? s.oracle.greedy.reduce((t, x) => t + x, 0) / best : NaN;
};
const lowRatio = (s: LaneStats): number => (s.low.members && s.all.proposed ? (s.low.proposed / s.low.members) / (s.all.proposed / s.all.members) : NaN);

type Row = readonly [string, (s: LaneStats) => string];
function printTable(pack: AppPack, lanes: readonly LaneStats[], plan: Plan): void {
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
    ["standing rho per seed (pairs)", s => s.rho.map((x, k) => `${fixed(x, 3)} (${s.runPairs[k]})`).join("/")],
    ["worse-side truth match / random", s => versus(s.worse, s.worseRandom)],
    ["circles / group faults", s => `${s.circles} / ${s.groupFaults.count}`],
    ["ARI circles / random", s => versus(s.ari, s.ariRandom)],
    ["purity circles / random", s => versus(s.purity, s.purityRandom)],
    ["pair precision circles / random", s => versus(s.precision, s.precisionRandom)],
    ["circle size mean (3/4/5/6)", s => `${fixed(mean(s.circleSizes), 2)} (${[3, 4, 5, 6].map(k => s.circleSizes.filter(x => x === k).length).join("/")})`],
    ["circle lowest / mean pair value", s => `${fixed(mean(s.circleLow), 1)} / ${fixed(mean(s.circleMean), 1)}`],
    ["members placed in a circle", s => pct(s.placed.inCircle, s.placed.members)],
    ["greedy / oracle packing (exact runs)", s => `${fixed(oracleShare(s), 3)} (${s.oracle.exact}/${s.oracle.runs})`],
    ["low quintile / overall rate", s => fixed(lowRatio(s), 2)],
    ["pair value AUC (hidden good pairs)", s => fixed(mean(s.valueAuc), 3)],
    ["good pairs kept (recall)", s => fixed(mean(s.keptRecall), 3)],
    ["pair value AUC per seed", s => s.valueAuc.map(x => fixed(x, 3)).join("/")],
    ["good pairs kept per seed", s => s.keptRecall.map(x => fixed(x, 3)).join("/")],
  ];
  const table = [["", ...lanes.map(s => s.lane)], ...rows.map(([label, f]) => [label, ...lanes.map(f)])];
  const widths = table[0]!.map((_, k) => Math.max(...table.map(r => r[k]!.length)));
  console.log(`  ${pack.id} (${plan.seeds.length} seeds; exactness N ${plan.exactN.join("/")}; engine N ${plan.engineN})`);
  for (const r of table) console.log(`    ${r.map((c, k) => (k ? c.padStart(widths[k]!) : c.padEnd(widths[k]!))).join("  ")}`);
}

function packGates(b: Block, pack: AppPack, lanes: readonly LaneStats[], plan: Plan, ladder: readonly Rung[]): void {
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
  for (const r of ladder) if (r.faults.cost.count) { cost.count += r.faults.cost.count; cost.first ??= r.faults.cost.first; }
  b.gate(`${id}: each search stays within searchBudget checks and ${searchTouchesPerCheck} × searchBudget touches (N ${plan.exactN.join("/")} and the ladder N ${[...new Set(ladder.map(r => r.n))].join("/")})`, cost.count === 0,
    `${perLane(s => ladder.filter(r => r.lane === s.lane).map(r => `N ${r.n} ${fixed(r.checks / Math.max(1, r.profiles), 1)} checks, ${fixed(r.touches / Math.max(1, r.profiles), 1)} touches per profile, ${r.ms}ms`).join(", "))}; ${show(cost)}`);

  const parity = merged(s => s.parity);
  b.gate(`${id}: no proposed pair has a standing gap beyond band + both uncertainties (${runs})`, parity.count === 0,
    `${perLane(s => `${s.pairs} pairs`)}; ${show(parity)}`);

  const reciprocity = merged(s => s.reciprocity);
  b.gate(`${id}: both directed utilities of every proposed pair reach the lane floor (${runs})`, reciprocity.count === 0, show(reciprocity));

  const blocking = lanes.reduce((t, s) => t + s.blockingPairs, 0);
  b.gate(`${id}: no blocking pair in the greedy phase (${runs})`, blocking === 0, perLane(s => `${s.blockingPairs}`));

  const openness = merged(s => s.openness);
  b.gate(`${id}: no proposal, group or circle pairs members outside each other's stated openness (Date gender and trans, Friend gender, Cofounder must-haves; ${runs})`, openness.count === 0,
    `${perLane(s => `${s.pairs} pairs, ${s.groups} groups, ${s.circles} circles`)}; ${show(openness)}`);
  const thin = lanes.filter(s => s.lane === "Date" || s.lane === "Friend");
  if (thin.length) {
    const rate = (r: { members: number; proposed: number }) => (r.members ? r.proposed / r.members : NaN);
    const lowest = (s: LaneStats) => {
      const overall = rate(s.all);
      const ratios = [...s.byGroup.values()].filter(r => r.members >= 10).map(r => rate(r) / overall);
      return ratios.length ? Math.min(...ratios) : NaN;
    };
    b.track(`${id}: by stated identity group, exact-search share, kept candidates per search and proposal rate; lowest group >= 0.7x overall (${runs})`,
      thin.every(s => lowest(s) >= 0.7),
      thin.map(s => `${s.lane}: ${[...s.byGroup].sort(([x], [y]) => (x < y ? -1 : 1)).map(([g, r]) => `${g} n ${r.members} exact ${pct(r.exact, r.searches)}, kept ${fixed(r.kept / Math.max(1, r.searches), 1)}, proposed ${pct(r.proposed, r.members)}`).join("; ")}; lowest ratio ${fixed(lowest(s), 2)}`).join(" | "));
  }

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

  const ranked = lanes.filter(s => s.valueAuc.length);
  b.track(`${id}: the pair value ranks hidden good pairs (worse-side truth at the utility floor) above chance (${runs})`,
    ranked.length > 0 && ranked.every(s => mean(s.valueAuc) > 0.5),
    perLane(s => `AUC ${fixed(mean(s.valueAuc), 3)}, recall in kept lists ${fixed(mean(s.keptRecall), 3)}`));

  if (circled.length) {
    b.track(`${id}: greedy circles reach at least ${ORACLE_SHARE} of the best packing's member-weighted least pair value (N ${plan.oracleN}, ${runs})`,
      circled.every(s => oracleShare(s) >= ORACLE_SHARE),
      circled.map(s => `${s.lane} ${fixed(oracleShare(s), 3)}${s.oracle.exact < s.oracle.runs ? " (an upper bound: a run not proved optimal gives a lower bound on the best packing)" : ""}, ${s.oracle.exact}/${s.oracle.runs} proved optimal`).join("; "));
  }

  b.track(`${id}: lowest standing quintile proposal rate >= ${LOW_QUINTILE_RATIO}x overall (${runs})`,
    lanes.every(s => lowRatio(s) >= LOW_QUINTILE_RATIO),
    perLane(s => `ratio ${fixed(lowRatio(s), 2)}, no kept candidate ${pct(s.noKept, s.laneProfiles)}`));

  const primary = ladder.filter(r => r.lane === PRIMARY_LANE[pack.id]);
  if (primary.length) {
    const shares = primary.map(r => ({ n: r.n, share: r.profiles > 1 ? r.checks / ((r.profiles * (r.profiles - 1)) / 2) : NaN }));
    b.track(`${id}: ${primary[0]!.lane} pair checks as a share of all pairs fall with N`,
      shares.length > 1 && shares.every((x, k) => k === 0 || x.share < shares[k - 1]!.share),
      shares.map(x => `N ${x.n} ${x.share.toExponential(2)}`).join(", "));
  }
}

export async function matchingBlock(b: Block, o: { quick: boolean; matchingPack?: string }): Promise<void> {
  const plan = o.quick ? MATCHING_QUICK : MATCHING_PINNED;
  const packs = MATCHING_PACKS.filter(app => o.matchingPack === undefined || app === o.matchingPack);
  if (!packs.length) throw new RangeError(`Unknown matching pack: ${o.matchingPack}`);
  for (const app of packs) {
    const pack = packOf(app);
    const lanes = lanesOf(pack).map(laneStats);
    for (const n of plan.exactN) {
      console.log(`  ${pack.id}: exactness N ${n}, ${plan.seeds.length} seeds${n === plan.engineN ? " and engine gates" : ""}`);
      for (const seed of plan.seeds) for (const s of lanes) {
        const mixed = n === plan.engineN && seed === plan.seeds[0] && pack.id === "ntwrk" && s.lane === "Intro";
        const { input, truth } = plantedEngineInput({ seed: `matching-${seed}`, n, lanes: mixed ? ["Intro", "Friend"] : [s.lane], app: pack.id });
        // runEngine canonicalizes its input the same way, so this World holds the run's profiles.
        const w = new World(canonicalInput(input), resolveConfig(shippedConfig(pack, seed)), localEmbed, pack);
        const st = statedOf(input, s.lane);
        exactness(w, s, `N ${n} seed ${seed}`, st);
        if (n === plan.engineN) await engineGates(pack, seed, input, truth, w, s, st);
      }
    }
    for (const seed of plan.seeds) for (const s of lanes) {
      if (laneLimits(s.lane).circleMaximum >= 3) oracleRun(pack, seed, plan.oracleN, s);
    }
    const ladder = runLadder(app, "planted", plan.ladder);
    printTable(pack, lanes, plan);
    printLadder(ladder);
    packGates(b, pack, lanes, plan, ladder);
    ladderGates(b, `matching ${pack.id}`, ladder);
  }
  hardWorlds(b, packs);
}
