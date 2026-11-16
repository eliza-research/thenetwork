// Bounded candidate search: a standing window, an exact threshold walk over the member's tag
// postings, and the generated candidateSearch machine, which keeps the top `searchLimit` and
// certifies when nothing unchecked can beat them.
import {
  enabled, initial, searchTouchesPerCheck, searchWindowHigh, searchWindowLow, step, unseenValueBound,
  type CandidateSearch, type Event as SearchEvent, type RankedCandidate,
} from "../../../core/src/generated/candidateSearch.ts";
import { lanePairValue, laneLimits, laneOffset, laneWeights, standingUncertaintyCeiling } from "../../../core/src/generated/matchLane.ts";
import { coverageValue, directedUtility, noPairValue, pairValueScale } from "../../../core/src/generated/pairValue.ts";
import type { SearchTally } from "../types.ts";
import { pairKey, type World } from "../world.ts";
import { partnerBlock, type CandidateBlock, type CandidateIndex, type Postings } from "./index.ts";
import { pairSideOf, pairValueOf, vectorsOf, weightedTerms } from "./pair.ts";
import { compareText, type EntityId, type MatchProfile, type TagSet } from "./profile.ts";

export interface RankedProfile { readonly profile: MatchProfile; readonly value: number }
export interface SearchResult {
  /** Best first: value desc, then ordinal asc. */
  readonly kept: readonly RankedProfile[];
  readonly checks: number;
  /** Posting entries (and window entries) the walk visited. */
  readonly touches: number;
  /** True: `kept` equals bruteForceCandidates. False: anything missed has a value <= unseenBound. */
  readonly exact: boolean;
  readonly unseenBound: number;
}

const byRank = (x: RankedCandidate, y: RankedCandidate): number => y.value - x.value || x.ordinal - y.ordinal;

function resultOf(block: CandidateBlock | undefined, search: CandidateSearch, touches: number): SearchResult {
  const kept = [...search.kept].sort(byRank).flatMap(c => {
    const profile = block?.byOrdinal.get(c.ordinal);
    return profile ? [{ profile, value: c.value }] : [];
  });
  return { kept, checks: search.checks, touches, exact: search.phase === "Exact", unseenBound: search.unseenBound };
}

/** First index whose value is >= `x` in an ascending list read through `at`. */
function lowerBound(length: number, at: (i: number) => number, x: number): number {
  let lo = 0, hi = length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (at(mid) < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** The three tag groups a search can walk, named from the searching member `a`. */
type TagGroup = "affinity" | "complement" | "returned";
interface Range { readonly group: TagGroup; readonly posting: readonly number[]; readonly start: number; readonly end: number }

/** The window range of each of `tags` in `postings` (positions in [from, to)); empty ranges dropped. */
function windowRanges(group: TagGroup, postings: Postings, tags: TagSet, from: number, to: number): Range[] {
  return tags.flatMap(tag => {
    const posting = postings.get(tag);
    if (!posting) return [];
    const start = lowerBound(posting.length, i => posting[i], from), end = lowerBound(posting.length, i => posting[i], to);
    return end > start ? [{ group, posting, start, end }] : [];
  });
}

/**
 * The best `searchLimit` partners of `profile`, with at most `searchBudget` pair checks and at most
 * `searchTouchesPerCheck x searchBudget` posting entries visited.
 */
export function searchCandidates(w: World, index: CandidateIndex, profile: MatchProfile): SearchResult {
  const limits = laneLimits(profile.lane), { rules } = limits;
  let search = step(initial, { type: "beginSearch", limit: limits.searchLimit, budget: limits.searchBudget });
  const block = partnerBlock(index, profile);
  const empty: SearchEvent = { type: "closeExact", unseenBound: noPairValue };
  if (!block) return resultOf(block, step(search, empty), 0);

  // spec/candidateSearch.md, "The standing window contains every partner that the parity rule allows"
  const offset = laneOffset(profile.lane, profile.side), band = rules.parityBand;
  const standingAt = (i: number) => block.profiles[i].standing;
  const from = lowerBound(block.profiles.length, standingAt, searchWindowLow(profile.standing, offset, band, profile.uncertainty, standingUncertaintyCeiling));
  const to = lowerBound(block.profiles.length, standingAt, searchWindowHigh(profile.standing, offset, band, profile.uncertainty, standingUncertaintyCeiling) + 1);
  if (from === to) return resultOf(block, step(search, empty), 0);

  const vectors = vectorsOf(w);
  const traitCosts = vectors.traits?.costs ?? [];
  const hasTraits = traitCosts.length > 0;
  const hasPackValue = vectors.packValue !== undefined;
  const weights = laneWeights(profile.lane);

  // spec/candidateSearch.md, "The posting walk covers or bounds every partner in the window":
  // a's interests in the partners' interests, a's seeks in their offers, a's offers in their seeks,
  // walked rarest first. `open` counts the tags of each group whose window range is not fully walked:
  // a candidate that was not touched can have a hit only in those.
  const walk = [
    ...windowRanges("affinity", block.interests, profile.interests, from, to),
    ...windowRanges("complement", block.offers, profile.seeks, from, to),
    ...windowRanges("returned", block.seeks, profile.offers, from, to),
  ].sort((x, y) => x.end - x.start - (y.end - y.start)); // the sort is stable
  const open: Record<TagGroup, number> = { affinity: 0, complement: 0, returned: 0 };
  for (const range of walk) open[range.group]++;
  let windowWalked = false;

  // spec/candidateSearch.md, "A bound is never below the value of the pair it covers" (lawUnseenBoundSound):
  // an untouched b has at most open[g] hits in group g; a's terms are the coverage of those hits, b's
  // terms are full when b can have a hit and 0 when it cannot; closeness and pack at full value.
  const untouchedBound = (): number => {
    if (windowWalked) return noPairValue;
    const complement = coverageValue(open.complement, profile.seeks.length);
    const returned = open.returned > 0 ? pairValueScale : 0;
    const mine = directedUtility(weightedTerms(weights, hasTraits, hasPackValue, {
      complement, affinity: coverageValue(open.affinity, profile.interests.length), closeness: pairValueScale, pack: pairValueScale,
    }));
    const theirs = directedUtility(weightedTerms(weights, hasTraits, hasPackValue, {
      complement: returned, affinity: open.affinity > 0 ? pairValueScale : 0, closeness: pairValueScale, pack: pairValueScale,
    }));
    return unseenValueBound(mine, theirs, complement, returned, rules);
  };

  // spec/candidateSearch.md, "lawCandidateBoundSound": the pair value with the pack term at full
  // value. Tags, closeness, standings and exchanges are exact, a higher utility never lowers the pair
  // value, and the pair gate only turns a value into noPairValue, so the bound is never below it.
  const fullPack = hasPackValue ? pairValueScale : undefined;
  const pending = new CandidateHeap();
  const touched = new Set<number>();
  const touchLimit = searchTouchesPerCheck * limits.searchBudget;
  let touches = 0, walked = 0, walkSpent = false;
  /** Touches positions [start, end) of a range; false when the touch limit stops it first. */
  const visit = (start: number, end: number, positionAt: (i: number) => number): boolean => {
    for (let i = start; i < end; i++) {
      if (touches >= touchLimit) return false;
      touches++;
      const position = positionAt(i);
      if (touched.has(position)) continue;
      touched.add(position);
      const other = block.profiles[position];
      if (other.memberId === profile.memberId) continue;
      const bound = lanePairValue(profile.lane, pairSideOf(profile, other, traitCosts, fullPack), profile.side,
        pairSideOf(other, profile, traitCosts, fullPack), other.side);
      if (bound >= 0) pending.push({ other, bound });
    }
    return true;
  };

  // Check the best touched candidate while no untouched one can beat its bound. If the pack's
  // enabled terms still allow an untagged pair after all postings, walk the standing window too.
  for (;;) {
    const untouched = untouchedBound();
    const top = pending.peek();
    const topBound = top?.bound ?? noPairValue;
    const unseen = Math.max(topBound, untouched);
    const stop: SearchEvent = { type: "closeExact", unseenBound: unseen };
    if (enabled(search, stop)) return resultOf(block, step(search, stop), touches);
    if (untouched > topBound && !walkSpent) {
      const range = walk[walked];
      if (range) {
        if (visit(range.start, range.end, i => range.posting[i])) { open[range.group]--; walked++; } else walkSpent = true;
      } else if (visit(from, to, i => i)) windowWalked = true;
      else walkSpent = true;
      continue;
    }
    if (!top || search.checks >= limits.searchBudget) {
      return resultOf(block, step(search, { type: "closeBudgeted", unseenBound: unseen, walkSpent }), touches);
    }
    pending.pop();
    search = step(search, { type: "checkCandidate", value: pairValueOf(w, profile, top.other), ordinal: top.other.ordinal });
  }
}

interface BoundedCandidate { readonly other: MatchProfile; readonly bound: number }
const ranksAbove = (x: BoundedCandidate, y: BoundedCandidate): boolean =>
  x.bound > y.bound || (x.bound === y.bound && x.other.ordinal < y.other.ordinal);

/** A binary heap of touched candidates: the highest bound first, then the lowest ordinal. */
class CandidateHeap {
  private readonly items: BoundedCandidate[] = [];
  peek(): BoundedCandidate | undefined { return this.items[0]; }
  push(item: BoundedCandidate): void {
    const items = this.items;
    let at = items.push(item) - 1;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (!ranksAbove(items[at], items[parent])) break;
      [items[at], items[parent]] = [items[parent], items[at]];
      at = parent;
    }
  }
  pop(): void {
    const items = this.items, last = items.pop();
    if (last === undefined || items.length === 0) return;
    items[0] = last;
    for (let at = 0; ;) {
      const left = 2 * at + 1, right = left + 1;
      let best = at;
      if (left < items.length && ranksAbove(items[left], items[best])) best = left;
      if (right < items.length && ranksAbove(items[right], items[best])) best = right;
      if (best === at) return;
      [items[at], items[best]] = [items[best], items[at]];
      at = best;
    }
  }
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

export const emptySearchTally: SearchTally = { members: 0, checks: 0, touches: 0, exact: 0, budgeted: 0, empty: 0, largestUnseenBound: -1 };

export function tallySearch(tally: SearchTally, result: SearchResult): SearchTally {
  return {
    members: tally.members + 1,
    checks: tally.checks + result.checks,
    touches: tally.touches + result.touches,
    exact: tally.exact + (result.exact ? 1 : 0),
    budgeted: tally.budgeted + (result.exact ? 0 : 1),
    empty: tally.empty + (result.kept.length === 0 ? 1 : 0),
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
