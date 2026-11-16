// Bounded candidate search: a standing window, buckets in decreasing value bound, and the generated
// candidateSearch machine, which keeps the top `searchLimit` and certifies when nothing unseen can beat them.
import {
  bucketValueBound, enabled, initial, searchWindowHigh, searchWindowLow, step,
  type CandidateSearch, type Event as SearchEvent, type RankedCandidate,
} from "../../../core/src/generated/candidateSearch.ts";
import { laneLimits, laneOffset, laneWeights, standingUncertaintyCeiling } from "../../../core/src/generated/matchLane.ts";
import { coverageValue, directedUtility, pairValueScale, parityPenalty } from "../../../core/src/generated/pairValue.ts";
import type { SearchTally } from "../types.ts";
import { pairKey, type World } from "../world.ts";
import { candidateBucketSize, partnerBlock, type BucketSummary, type CandidateBlock, type CandidateIndex } from "./index.ts";
import { intersectCount, meanCloseness, pairValueOf, vectorsOf, weightedTerms } from "./pair.ts";
import { compareText, type EntityId, type MatchProfile } from "./profile.ts";

export interface RankedProfile { readonly profile: MatchProfile; readonly value: number }
export interface SearchResult {
  /** Best first: value desc, then ordinal asc. */
  readonly kept: readonly RankedProfile[];
  readonly checks: number;
  /** True: `kept` equals bruteForceCandidates. False: anything missed has a value <= unseenBound. */
  readonly exact: boolean;
  readonly unseenBound: number;
}

const byRank = (x: RankedCandidate, y: RankedCandidate): number => y.value - x.value || x.ordinal - y.ordinal;

function resultOf(block: CandidateBlock | undefined, search: CandidateSearch): SearchResult {
  const kept = [...search.kept].sort(byRank).flatMap(c => {
    const profile = block?.byOrdinal.get(c.ordinal);
    return profile ? [{ profile, value: c.value }] : [];
  });
  return { kept, checks: search.checks, exact: search.phase === "Exact", unseenBound: search.unseenBound };
}

function close(search: CandidateSearch, unseenBound: number): CandidateSearch {
  const exact: SearchEvent = { type: "closeExact", unseenBound };
  return enabled(search, exact) ? step(search, exact) : step(search, { type: "closeBudgeted", unseenBound });
}

/** First position whose standing is >= `standing` in a block sorted by standing. */
function firstAtLeast(profiles: readonly MatchProfile[], standing: number): number {
  let lo = 0, hi = profiles.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (profiles[mid].standing < standing) lo = mid + 1; else hi = mid;
  }
  return lo;
}

const distanceTo = (x: number, low: number, high: number): number => (x < low ? low - x : x > high ? x - high : 0);

// spec/candidateSearch.md, "lawBucketBoundSound": each term bound is >= the term for every profile of
// the bucket (subset counts, smallest non-empty denominator, nearest point of the range), and
// directedUtility, harmonicValue and the penalty are monotone in the right direction.
function bucketBound(profile: MatchProfile, bucket: BucketSummary, traitCosts: readonly number[], hasPackValue: boolean): number {
  const weights = laneWeights(profile.lane);
  const { rules } = laneLimits(profile.lane);
  const closeness = meanCloseness(profile.traits.map((x, d) => distanceTo(x, bucket.traitLow[d], bucket.traitHigh[d])), traitCosts);
  const hasTraits = traitCosts.length > 0;
  const mine = directedUtility(weightedTerms(weights, hasTraits, hasPackValue, {
    complement: coverageValue(intersectCount(profile.seeks, bucket.unionOffers), profile.seeks.length),
    affinity: coverageValue(intersectCount(profile.interests, bucket.unionInterests), profile.interests.length),
    closeness, pack: pairValueScale,
  }));
  const theirs = directedUtility(weightedTerms(weights, hasTraits, hasPackValue, {
    complement: coverageValue(intersectCount(bucket.unionSeeks, profile.offers), Math.max(1, bucket.leastSeeks)),
    affinity: coverageValue(intersectCount(bucket.unionInterests, profile.interests), Math.max(1, bucket.leastInterests)),
    closeness, pack: pairValueScale,
  }));
  const target = profile.standing - laneOffset(profile.lane, profile.side);
  const leastGap = distanceTo(target, bucket.standingLow, bucket.standingHigh);
  return bucketValueBound(mine, theirs, parityPenalty(leastGap, rules.parityFreeGap, rules.parityPenaltyPerPoint));
}

/** The best `searchLimit` partners of `profile`, with at most `searchBudget` pair checks. */
export function searchCandidates(w: World, index: CandidateIndex, profile: MatchProfile): SearchResult {
  const limits = laneLimits(profile.lane);
  let search = step(initial, { type: "beginSearch", limit: limits.searchLimit, budget: limits.searchBudget });
  const block = partnerBlock(index, profile);
  if (!block) return resultOf(block, close(search, -1));
  const vectors = vectorsOf(w);
  const traitCosts = vectors.traits?.costs ?? [];
  // spec/candidateSearch.md, "lawWindowComplete": no profile outside the window has a pair value.
  const offset = laneOffset(profile.lane, profile.side), band = limits.rules.parityBand;
  const from = firstAtLeast(block.profiles, searchWindowLow(profile.standing, offset, band, profile.uncertainty, standingUncertaintyCeiling));
  const to = firstAtLeast(block.profiles, searchWindowHigh(profile.standing, offset, band, profile.uncertainty, standingUncertaintyCeiling) + 1);
  const visits: { position: number; bound: number }[] = [];
  for (let position = Math.floor(from / candidateBucketSize); from < to && position * candidateBucketSize < to; position++) {
    visits.push({ position, bound: bucketBound(profile, block.buckets[position], traitCosts, vectors.packValue !== undefined) });
  }
  visits.sort((x, y) => y.bound - x.bound || x.position - y.position);
  for (const visit of visits) {
    const stop: SearchEvent = { type: "closeExact", unseenBound: visit.bound };
    if (enabled(search, stop)) return resultOf(block, step(search, stop));
    const end = Math.min(to, (visit.position + 1) * candidateBucketSize);
    for (let at = Math.max(from, visit.position * candidateBucketSize); at < end; at++) {
      const other = block.profiles[at];
      if (other.id === profile.id || other.memberId === profile.memberId) continue;
      if (search.checks >= limits.searchBudget) return resultOf(block, close(search, visit.bound));
      search = step(search, { type: "checkCandidate", value: pairValueOf(w, profile, other), ordinal: other.ordinal });
    }
  }
  return resultOf(block, close(search, -1));
}

/** Oracle for the simulator gate only: the same pair function over the whole partner block, no pruning. */
export function bruteForceCandidates(w: World, index: CandidateIndex, profile: MatchProfile): RankedProfile[] {
  const block = partnerBlock(index, profile);
  if (!block) return [];
  return block.profiles
    .map(other => ({ profile: other, value: pairValueOf(w, profile, other) }))
    .filter(c => c.value >= 0)
    .sort((x, y) => y.value - x.value || x.profile.ordinal - y.profile.ordinal)
    .slice(0, laneLimits(profile.lane).searchLimit);
}

export const emptySearchTally: SearchTally = { members: 0, checks: 0, exact: 0, budgeted: 0, largestUnseenBound: -1 };

export function tallySearch(tally: SearchTally, result: SearchResult): SearchTally {
  return {
    members: tally.members + 1,
    checks: tally.checks + result.checks,
    exact: tally.exact + (result.exact ? 1 : 0),
    budgeted: tally.budgeted + (result.exact ? 0 : 1),
    largestUnseenBound: result.exact ? tally.largestUnseenBound : Math.max(tally.largestUnseenBound, result.unseenBound),
  };
}

export interface MatchEdge { readonly a: EntityId; readonly b: EntityId; readonly value: number; readonly key: string }

/**
 * One edge per pair where either side kept the other. "Either" and not "both": the pair value is
 * symmetric, so a one-sided keep is still a pair both sides value; it only lost a top-k slot on
 * one side to better partners. Sorted by value desc, then key.
 */
export function mutualEdges(results: readonly { readonly profile: MatchProfile; readonly result: SearchResult }[]): MatchEdge[] {
  const edges = new Map<string, MatchEdge>();
  for (const { profile, result } of results) {
    for (const { profile: other, value } of result.kept) {
      const [a, b] = compareText(profile.id, other.id) < 0 ? [profile.id, other.id] : [other.id, profile.id];
      const key = pairKey(a, b);
      if (!edges.has(key)) edges.set(key, { a, b, value, key });
    }
  }
  return [...edges.values()].sort((x, y) => y.value - x.value || compareText(x.key, y.key));
}
