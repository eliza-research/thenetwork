import {
  enabled, initial, searchMayTouch, searchStopsExact, searchUntouchedSharesNoTag, searchWindowHigh, searchWindowLow, step, unseenValueBound,
  type CandidateSearch, type Event as SearchEvent, type RankedCandidate,
} from "../../../core/src/generated/candidateSearch.ts";
import { laneLimits, laneOffset, laneWeights, standingUncertaintyCeiling } from "../../../core/src/generated/matchLane.ts";
import { coverageValue, directedUtility, noPairValue, pairValueScale } from "../../../core/src/generated/pairValue.ts";
import type { SearchTally } from "../types.ts";
import { pairKey, type World } from "../world.ts";
import { partnerBlock, type CandidateBlock, type CandidateIndex, type Postings, type Span } from "./index.ts";
import { gatePair, masksAdmit, packValueOf, pairArithmetic, pairValueOf, sharesTag, vectorsOf, weightedTerms, type PairCheck } from "./pair.ts";
import { compareText, wholeNumber, type EntityId, type MatchProfile, type TagSet } from "./profile.ts";

interface RankedProfile { readonly profile: MatchProfile; readonly value: number }
interface SearchCounters {
  bounds: number; checksAfterSettled: number; boundViolations: number; packBoundViolations: number; classCapViolations: number; memoHits: number;
  readonly refusals: Record<string, number>;
}
export interface SearchResult {
  readonly kept: readonly RankedProfile[];
  readonly checks: number;
  readonly touches: number;
  readonly exact: boolean;
  readonly unseenBound: number;
  readonly budgetedBy?: "checks" | "touches";
  readonly counters: SearchCounters;
}

const byRank = (x: RankedCandidate, y: RankedCandidate): number => y.value - x.value || x.ordinal - y.ordinal;

const noCounters = (): SearchCounters => ({ bounds: 0, checksAfterSettled: 0, boundViolations: 0, packBoundViolations: 0, classCapViolations: 0, memoHits: 0, refusals: {} });

function resultOf(block: CandidateBlock | undefined, search: CandidateSearch, touches: number, counters = noCounters()): SearchResult {
  const kept = [...search.kept].sort(byRank).flatMap(c => {
    const profile = block?.byOrdinal.get(c.ordinal);
    return profile ? [{ profile, value: c.value }] : [];
  });
  const budgetedBy = search.phase !== "Budgeted" ? undefined : search.checks >= search.budget ? "checks" : "touches";
  return { kept, checks: search.checks, touches, exact: search.phase === "Exact", unseenBound: search.unseenBound, ...(budgetedBy ? { budgetedBy } : {}), counters };
}

function lowerBound(lo: number, hi: number, at: (i: number) => number, x: number): number {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (at(mid) < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

interface SearchWindow { readonly spans: readonly Span[]; readonly packClasses: ReadonlySet<number> }

function windowOf(block: CandidateBlock, profile: MatchProfile, band: number): SearchWindow {
  const offset = laneOffset(profile.lane, profile.side);
  const low = searchWindowLow(profile.standing, offset, band, profile.uncertainty, standingUncertaintyCeiling);
  const high = searchWindowHigh(profile.standing, offset, band, profile.uncertainty, standingUncertaintyCeiling);
  const standingAt = (i: number) => block.profiles[i].standing;
  const spans: Span[] = [];
  const packClasses = new Set<number>();
  for (const segment of block.reachableSegments(profile.segment?.partners)) {
    const start = lowerBound(segment.start, segment.end, standingAt, low);
    const end = lowerBound(start, segment.end, standingAt, high + 1);
    if (end === start) continue;
    for (const packClass of segment.packClasses) packClasses.add(packClass);
    const last = spans[spans.length - 1];
    if (last?.end === start) spans[spans.length - 1] = { start: last.start, end };
    else spans.push({ start, end });
  }
  return { spans, packClasses };
}

type TagGroup = "affinity" | "complement" | "returned";
interface Range { readonly group: TagGroup; readonly posting: readonly number[]; readonly spans: readonly Span[]; readonly size: number }

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

function tagRanges(block: CandidateBlock, profile: MatchProfile, window: readonly Span[]): Range[] {
  return [
    ...windowRanges("affinity", block.interests, profile.interests, window),
    ...windowRanges("complement", block.offers, profile.seeks, window),
    ...windowRanges("returned", block.seeks, profile.offers, window),
  ];
}

const spanSize = (spans: readonly Span[]): number => spans.reduce((n, span) => n + span.end - span.start, 0);

export function searchWindowMetrics(block: CandidateBlock, profile: MatchProfile): { window: number; ranges: number; shortest: number } {
  const window = windowOf(block, profile, laneLimits(profile.lane).rules.parityBand).spans;
  let ranges = 0, shortest = Infinity;
  for (const range of tagRanges(block, profile, window)) {
    ranges += range.size;
    shortest = Math.min(shortest, range.size);
  }
  return { window: spanSize(window), ranges, shortest: ranges === 0 ? 0 : shortest };
}

export function searchCandidates(w: World, index: CandidateIndex, profile: MatchProfile, memo?: PairMemo): SearchResult {
  const limits = laneLimits(profile.lane), { rules } = limits;
  let search = step(initial, { type: "beginSearch", limit: limits.searchLimit, budget: limits.searchBudget });
  const block = partnerBlock(index, profile);
  const empty: SearchEvent = { type: "closeExact", unseenBound: noPairValue };
  if (!block) return resultOf(block, step(search, empty), 0);

  const { spans: window, packClasses } = windowOf(block, profile, rules.parityBand);
  if (window.length === 0) return resultOf(block, step(search, empty), 0);

  const vectors = vectorsOf(w);
  const traitCosts = vectors.traits?.costs ?? [];
  const hasTraits = traitCosts.length > 0;
  const hasPackValue = vectors.packValue !== undefined;
  const weights = laneWeights(profile.lane);

  const walk = tagRanges(block, profile, window).sort((x, y) => x.size - y.size);
  const windowSize = spanSize(window);
  const open: Record<TagGroup, number> = { affinity: 0, complement: 0, returned: 0 };
  for (const range of walk) open[range.group]++;
  let windowWalked = false;

  const classCaps = new Map<boolean, number>();
  const untouchedPack = (untouched: boolean): number => {
    const classes = vectors.packClasses;
    if (!hasPackValue || !classes) return pairValueScale;
    let cap = classCaps.get(untouched);
    if (cap === undefined) {
      cap = 0;
      for (const packClass of packClasses) cap = Math.max(cap, wholeNumber(classes.cap(w, profile, packClass, untouched), "pack class cap"));
      classCaps.set(untouched, cap);
    }
    return cap;
  };

  const untouchedBound = (): number => {
    if (windowWalked) return noPairValue;
    const complement = coverageValue(open.complement, profile.seeks.length);
    const returned = open.returned > 0 ? pairValueScale : 0;
    const untouched = searchUntouchedSharesNoTag(open.affinity, open.complement, open.returned);
    const mine = directedUtility(weightedTerms(weights, hasTraits, hasPackValue, {
      complement, affinity: coverageValue(open.affinity, profile.interests.length), closeness: pairValueScale, pack: untouchedPack(untouched),
    }));
    const theirs = directedUtility(weightedTerms(weights, hasTraits, hasPackValue, {
      complement: returned, affinity: open.affinity > 0 ? pairValueScale : 0, closeness: pairValueScale, pack: pairValueScale,
    }));
    return unseenValueBound(mine, theirs, complement, returned, rules);
  };

  const packBound = (a: MatchProfile, b: MatchProfile): number | undefined =>
    !hasPackValue ? undefined : vectors.packBound ? wholeNumber(vectors.packBound(w, a, b), "pack bound") : pairValueScale;
  const counters = noCounters();
  const refuse = (reason: string): void => { counters.refusals[reason] = (counters.refusals[reason] ?? 0) + 1; };
  const known = memo?.begin(profile);
  const pending = new CandidateHeap();
  const touched = new Set<number>();
  let untouched = untouchedBound();
  let touches = 0, walked = 0, walkSpent = false;
  const visit = (spans: readonly Span[], positionAt: (i: number) => number): boolean => {
    for (const { start, end } of spans) for (let i = start; i < end; i++) {
      if (!searchMayTouch(touches, limits.searchBudget)) return false;
      touches++;
      const position = positionAt(i);
      if (touched.has(position)) continue;
      touched.add(position);
      const other = block.profiles[position];
      if (other.memberId === profile.memberId) continue;
      if (!masksAdmit(profile, other)) { refuse("mask_refused"); continue; }
      counters.bounds++;
      const packAB = packBound(profile, other), packBA = packBound(other, profile);
      const bound = pairArithmetic(profile, other, traitCosts, packAB, packBA);
      if (bound >= 0) pending.push({ other, bound, packAB, packBA });
    }
    return true;
  };

  const check = (top: BoundedCandidate): void => {
    const other = top.other;
    const reused = known?.get(other);
    let checked: PairCheck;
    if (reused !== undefined) {
      counters.memoHits++;
      checked = typeof reused === "number" ? { value: reused, refusal: null } : { value: noPairValue, refusal: reused };
    } else if (!hasPackValue) {
      checked = gatePair(w, profile, other, top.bound);
    } else {
      const packAB = packValueOf(w, vectors, profile, other), packBA = packValueOf(w, vectors, other, profile);
      if (top.packAB !== undefined && packAB !== undefined && packAB > top.packAB) counters.packBoundViolations++;
      if (top.packBA !== undefined && packBA !== undefined && packBA > top.packBA) counters.packBoundViolations++;
      const classes = vectors.packClasses, packClass = other.packClass;
      if (classes && packClass !== undefined && packAB !== undefined) {
        const capOf = (untouched: boolean): number => wholeNumber(classes.cap(w, profile, packClass, untouched), "pack class cap");
        if (packAB > capOf(false)) counters.classCapViolations++;
        if (!sharesTag(profile, other) && packAB > capOf(true)) counters.classCapViolations++;
      }
      checked = gatePair(w, profile, other, pairArithmetic(profile, other, traitCosts, packAB, packBA));
    }
    if (reused === undefined) memo?.keep(profile, other, checked);
    if (checked.value > top.bound) counters.boundViolations++;
    if (checked.refusal !== null) refuse(checked.refusal);
    search = step(search, { type: "checkCandidate", value: checked.value, ordinal: other.ordinal });
  };

  for (;;) {
    const top = pending.peek();
    const topBound = top?.bound ?? noPairValue;
    const unseen = Math.max(topBound, untouched);
    const stop: SearchEvent = { type: "closeExact", unseenBound: unseen };
    if (enabled(search, stop)) return resultOf(block, step(search, stop), touches, counters);
    if (untouched > topBound && !walkSpent) {
      const range = walk[walked];
      if (range && range.size < windowSize) {
        if (visit(range.spans, i => range.posting[i])) { open[range.group]--; walked++; } else walkSpent = true;
      } else if (visit(window, i => i)) windowWalked = true;
      else walkSpent = true;
      if (!walkSpent) untouched = untouchedBound();
      continue;
    }
    const close: SearchEvent = { type: "closeBudgeted", unseenBound: unseen, walkSpent, touchedBound: topBound };
    if (!top || enabled(search, close)) return resultOf(block, step(search, close), touches, counters);
    if (searchStopsExact(search, topBound)) counters.checksAfterSettled++;
    pending.pop();
    check(top);
  }
}

interface BoundedCandidate { readonly other: MatchProfile; readonly bound: number; readonly packAB: number | undefined; readonly packBA: number | undefined }
const ranksAbove = (x: BoundedCandidate, y: BoundedCandidate): boolean =>
  x.bound > y.bound || (x.bound === y.bound && x.other.ordinal < y.other.ordinal);

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

export class PairMemo {
  private readonly waiting = new Map<MatchProfile, Map<MatchProfile, number | string>>();
  private readonly searched = new Set<MatchProfile>();

  begin(profile: MatchProfile): ReadonlyMap<MatchProfile, number | string> | undefined {
    this.searched.add(profile);
    const known = this.waiting.get(profile);
    this.waiting.delete(profile);
    return known;
  }

  keep(a: MatchProfile, b: MatchProfile, checked: PairCheck): void {
    if (this.searched.has(b)) return;
    let known = this.waiting.get(b);
    if (!known) { known = new Map(); this.waiting.set(b, known); }
    known.set(a, checked.refusal ?? checked.value);
  }
}

export function bruteForceCandidates(w: World, index: CandidateIndex, profile: MatchProfile): RankedProfile[] {
  const block = partnerBlock(index, profile);
  if (!block) return [];
  return block.profiles
    .map(other => ({ profile: other, value: pairValueOf(w, profile, other) }))
    .filter(c => c.value >= 0)
    .sort((x, y) => y.value - x.value || x.profile.ordinal - y.profile.ordinal)
    .slice(0, laneLimits(profile.lane).searchLimit);
}

export const emptySearchTally: SearchTally = {
  members: 0, checks: 0, touches: 0, exact: 0, budgeted: 0, empty: 0, largestUnseenBound: -1,
  bounds: 0, checksAfterSettled: 0, boundViolations: 0, packBoundViolations: 0, classCapViolations: 0, touchClosed: 0, checkClosed: 0, memoHits: 0, refusals: {},
};

export function tallySearch(tally: SearchTally, result: SearchResult): SearchTally {
  const { counters } = result;
  const refusals = { ...tally.refusals };
  for (const [reason, count] of Object.entries(counters.refusals)) refusals[reason] = (refusals[reason] ?? 0) + count;
  return {
    members: tally.members + 1,
    checks: tally.checks + result.checks,
    touches: tally.touches + result.touches,
    exact: tally.exact + (result.exact ? 1 : 0),
    budgeted: tally.budgeted + (result.exact ? 0 : 1),
    empty: tally.empty + (result.kept.length === 0 ? 1 : 0),
    largestUnseenBound: result.exact ? tally.largestUnseenBound : Math.max(tally.largestUnseenBound, result.unseenBound),
    bounds: tally.bounds + counters.bounds,
    checksAfterSettled: tally.checksAfterSettled + counters.checksAfterSettled,
    boundViolations: tally.boundViolations + counters.boundViolations,
    packBoundViolations: tally.packBoundViolations + counters.packBoundViolations,
    classCapViolations: tally.classCapViolations + counters.classCapViolations,
    touchClosed: tally.touchClosed + (result.budgetedBy === "touches" ? 1 : 0),
    checkClosed: tally.checkClosed + (result.budgetedBy === "checks" ? 1 : 0),
    memoHits: tally.memoHits + counters.memoHits,
    refusals,
  };
}

export interface MatchEdge { readonly a: EntityId; readonly b: EntityId; readonly value: number; readonly key: string }

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
