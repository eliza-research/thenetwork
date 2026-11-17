// Bounded candidate search: a window (the standing range inside each segment the member reaches),
// an exact threshold walk over the member's tag postings in that window, and the generated
// candidateSearch machine, which keeps the top `searchLimit` and certifies when nothing unchecked
// can beat them.
import {
  enabled, initial, searchTouchesPerCheck, searchWindowHigh, searchWindowLow, step, unseenValueBound,
  type CandidateSearch, type Event as SearchEvent, type RankedCandidate,
} from "../../../core/src/generated/candidateSearch.ts";
import { lanePairValue, laneLimits, laneOffset, laneWeights, standingUncertaintyCeiling } from "../../../core/src/generated/matchLane.ts";
import { coverageValue, directedUtility, noPairValue, pairValueScale } from "../../../core/src/generated/pairValue.ts";
import type { SearchTally } from "../types.ts";
import { pairKey, type World } from "../world.ts";
import { partnerBlock, type CandidateBlock, type CandidateIndex, type Postings, type Span } from "./index.ts";
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

/** First index in [lo, hi) whose value is >= `x` (hi when none) in an ascending run read through `at`. */
function lowerBound(lo: number, hi: number, at: (i: number) => number, x: number): number {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (at(mid) < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * The window of `profile` in its partner block: inside each segment the profile reaches, the
 * positions whose standing is in [low, high]. Ascending and disjoint; adjacent spans are merged.
 */
function windowSpans(block: CandidateBlock, profile: MatchProfile, low: number, high: number): Span[] {
  const standingAt = (i: number) => block.profiles[i].standing;
  const spans: Span[] = [];
  for (const segment of block.segments) {
    // spec/candidateSearch.md, "Segment blocking never drops a pair the pair gate admits": the same
    // test as segmentReaches(profile, other) for every other in the segment.
    if (profile.segment && segment.segment !== undefined && !profile.segment.partners.has(segment.segment)) continue;
    const start = lowerBound(segment.start, segment.end, standingAt, low);
    const end = lowerBound(start, segment.end, standingAt, high + 1);
    if (end === start) continue;
    const last = spans[spans.length - 1];
    if (last?.end === start) spans[spans.length - 1] = { start: last.start, end };
    else spans.push({ start, end });
  }
  return spans;
}

/** The three tag groups a search can walk, named from the searching member `a`. */
type TagGroup = "affinity" | "complement" | "returned";
/** One tag's posting inside the window: `spans` index the posting, `size` counts their entries. */
interface Range { readonly group: TagGroup; readonly posting: readonly number[]; readonly spans: readonly Span[]; readonly size: number }

/** The window range of each of `tags` in `postings`; empty ranges dropped. */
function windowRanges(group: TagGroup, postings: Postings, tags: TagSet, window: readonly Span[]): Range[] {
  return tags.flatMap(tag => {
    const posting = postings.get(tag);
    if (!posting) return [];
    const at = (i: number) => posting[i];
    const spans: Span[] = [];
    let size = 0, from = 0;
    for (const span of window) {
      const start = lowerBound(from, posting.length, at, span.start);
      const end = lowerBound(start, posting.length, at, span.end);
      if (end > start) { spans.push({ start, end }); size += end - start; }
      from = end;
    }
    return size > 0 ? [{ group, posting, spans, size }] : [];
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
  const window = windowSpans(block, profile,
    searchWindowLow(profile.standing, offset, band, profile.uncertainty, standingUncertaintyCeiling),
    searchWindowHigh(profile.standing, offset, band, profile.uncertainty, standingUncertaintyCeiling));
  if (window.length === 0) return resultOf(block, step(search, empty), 0);

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
    ...windowRanges("affinity", block.interests, profile.interests, window),
    ...windowRanges("complement", block.offers, profile.seeks, window),
    ...windowRanges("returned", block.seeks, profile.offers, window),
  ].sort((x, y) => x.size - y.size); // the sort is stable
  const windowSize = window.reduce((n, span) => n + span.end - span.start, 0);
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
  /** Touches the positions of `spans`; false when the touch limit stops it first. */
  const visit = (spans: readonly Span[], positionAt: (i: number) => number): boolean => {
    for (const { start, end } of spans) for (let i = start; i < end; i++) {
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
  // enabled terms still allow an untagged pair after the postings shorter than the window, walk the
  // whole window.
  for (;;) {
    const untouched = untouchedBound();
    const top = pending.peek();
    const topBound = top?.bound ?? noPairValue;
    const unseen = Math.max(topBound, untouched);
    const stop: SearchEvent = { type: "closeExact", unseenBound: unseen };
    if (enabled(search, stop)) return resultOf(block, step(search, stop), touches);
    if (untouched > topBound && !walkSpent) {
      // A range at least as long as the window costs no less than the window, which leaves no one untouched.
      const range = walk[walked];
      if (range && range.size < windowSize) {
        if (visit(range.spans, i => range.posting[i])) { open[range.group]--; walked++; } else walkSpent = true;
      } else if (visit(window, i => i)) windowWalked = true;
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

/**
 * Oracle for the simulator gate only: the same pair function over the whole partner block, no
 * pruning, no segment window (the pair gate refuses pairs whose segments do not reach each other).
 */
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
