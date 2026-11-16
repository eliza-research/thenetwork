// GENERATED from spec/candidateSearch.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type PairSide as pairValue_PairSide, type PairRules as pairValue_PairRules, type UtilityTerm as pairValue_UtilityTerm, pairValueScale as pairValue_pairValueScale, noPairValue as pairValue_noPairValue, utilityTermWeight as pairValue_utilityTermWeight, boundedValue as pairValue_boundedValue, harmonicValue as pairValue_harmonicValue, parityAllowed as pairValue_parityAllowed, lawHarmonicMonotone as pairValue_lawHarmonicMonotone, coverageValue as pairValue_coverageValue, standingGap as pairValue_standingGap, parityPenalty as pairValue_parityPenalty, exchangeBalanced as pairValue_exchangeBalanced, directedUtility as pairValue_directedUtility, lawHarmonicBetweenSides as pairValue_lawHarmonicBetweenSides, closenessValue as pairValue_closenessValue, pairAdmissible as pairValue_pairAdmissible, lawUtilityTermsBounded as pairValue_lawUtilityTermsBounded, lawDirectedUtilityBounded as pairValue_lawDirectedUtilityBounded, pairValue as pairValue_pairValue, lawNoOneSidedPair as pairValue_lawNoOneSidedPair, lawPairValueSymmetric as pairValue_lawPairValueSymmetric, lawParityHolds as pairValue_lawParityHolds, lawSmallerGapNeverWorse as pairValue_lawSmallerGapNeverWorse, lawBalancedExchange as pairValue_lawBalancedExchange, lawPairValueBounded as pairValue_lawPairValueBounded } from "./pairValue.ts";

/** Story: Keep the best candidates within a fixed number of pair checks / A search starts once with a positive limit and a budget no smaller than the limit (spec/candidateSearch.md) */
export type SearchPhase = "Idle" | "Scanning" | "Exact" | "Budgeted";
/** Story: Keep the best candidates within a fixed number of pair checks / A search starts once with a positive limit and a budget no smaller than the limit (spec/candidateSearch.md) */
export interface RankedCandidate { value: number; ordinal: number }
/** Story: Keep the best candidates within a fixed number of pair checks / A search starts once with a positive limit and a budget no smaller than the limit (spec/candidateSearch.md) */
export interface CandidateSearch { phase: SearchPhase; limit: number; budget: number; checks: number; kept: RankedCandidate[]; bestDropped: number; bestDroppedOrdinal: number; unseenBound: number }
/** Story: Keep the best candidates within a fixed number of pair checks / Each check counts once and keeps the candidate only when it ranks among the best (spec/candidateSearch.md) */
export interface WorstKeptScan { position: number; worstPosition: number; worst: RankedCandidate }

/** One variant per transition in the spec. */
export type Event =
  | { type: "beginSearch"; limit: number; budget: number }
  | { type: "checkCandidate"; value: number; ordinal: number }
  | { type: "closeExact"; unseenBound: number }
  | { type: "closeBudgeted"; unseenBound: number };

/** Story: Keep the best candidates within a fixed number of pair checks / A search starts once with a positive limit and a budget no smaller than the limit (spec/candidateSearch.md) */
export const initial: CandidateSearch = { phase: "Idle", limit: 0, budget: 0, checks: 0, kept: ([] as RankedCandidate[]), bestDropped: pairValue_noPairValue, bestDroppedOrdinal: 0, unseenBound: pairValue_noPairValue };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: CandidateSearch): boolean {
  return alwaysIdleSearchIsEmpty(current) && alwaysChecksWithinBudget(current) && alwaysKeptWithinLimit(current) && alwaysKeptValuesAreRealPairs(current) && alwaysDroppedOnlyWhenFull(current) && alwaysKeptOrdinalsDistinct(current) && alwaysKeptBeatDropped(current) && alwaysKeptRankAboveDropped(current) && alwaysExactBeatsUnseen(current);
}

/** Story: Search only where a pair can have a value / The standing window contains every partner that the parity rule allows (spec/candidateSearch.md) */
//@ pure
export function searchWindowLow(standing: number, offset: number, band: number, uncertainty: number, uncertaintyCeiling: number): number {
  return exact_candidateSearch(exact_candidateSearch(standing - offset) - exact_candidateSearch(exact_candidateSearch(band + uncertainty) + uncertaintyCeiling));
}

/** Story: Search only where a pair can have a value / The standing window contains every partner that the parity rule allows (spec/candidateSearch.md) */
//@ pure
export function searchWindowHigh(standing: number, offset: number, band: number, uncertainty: number, uncertaintyCeiling: number): number {
  return exact_candidateSearch(exact_candidateSearch(standing - offset) + exact_candidateSearch(exact_candidateSearch(band + uncertainty) + uncertaintyCeiling));
}

/** Story: Search only where a pair can have a value / The standing window contains every partner that the parity rule allows (spec/candidateSearch.md) */
//@ pure
export function inSearchWindow(otherStanding: number, standing: number, offset: number, band: number, uncertainty: number, uncertaintyCeiling: number): boolean {
  return searchWindowLow(standing, offset, band, uncertainty, uncertaintyCeiling) <= otherStanding && otherStanding <= searchWindowHigh(standing, offset, band, uncertainty, uncertaintyCeiling);
}

/** Story: Search only where a pair can have a value / The standing window contains every partner that the parity rule allows (spec/candidateSearch.md) */
//@ pure
export function lawWindowComplete(standing: number, otherStanding: number, offset: number, band: number, uncertainty: number, otherUncertainty: number, uncertaintyCeiling: number): boolean {
  //@ ensures \result === true
  return !(otherUncertainty <= uncertaintyCeiling && pairValue_parityAllowed(pairValue_standingGap(standing, otherStanding, offset), band, uncertainty, otherUncertainty)) || inSearchWindow(otherStanding, standing, offset, band, uncertainty, uncertaintyCeiling);
}

/** Story: Search only where a pair can have a value / A bucket bound is never below the value of a pair inside the bucket (spec/candidateSearch.md) */
//@ pure
export function bucketValueBound(utilityBound: number, otherUtilityBound: number, leastPenalty: number): number {
  const local_0 = exact_candidateSearch(pairValue_harmonicValue(utilityBound, otherUtilityBound) - leastPenalty);
  return local_0 > 0 ? local_0 : 0;
}

/** Story: Search only where a pair can have a value / A bucket bound is never below the value of a pair inside the bucket (spec/candidateSearch.md) */
//@ pure
export function lawBucketBoundSound(utility: number, otherUtility: number, penalty: number, utilityBound: number, otherUtilityBound: number, leastPenalty: number): boolean {
  //@ ensures \result === true
  const local_1 = exact_candidateSearch(pairValue_harmonicValue(utility, otherUtility) - penalty);
  const local_2 = local_1 > 0 ? local_1 : 0;
  return !(utility <= utilityBound && otherUtility <= otherUtilityBound && penalty >= leastPenalty && leastPenalty >= 0) || local_2 <= bucketValueBound(utilityBound, otherUtilityBound, leastPenalty);
}

/** Story: Keep the best candidates within a fixed number of pair checks / A search starts once with a positive limit and a budget no smaller than the limit (spec/candidateSearch.md) */
//@ pure
export function canBeginSearch(s: CandidateSearch, limit: number, budget: number): boolean {
  return s.phase === "Idle" && limit > 0 && budget >= limit;
}

/** Story: Keep the best candidates within a fixed number of pair checks / A search starts once with a positive limit and a budget no smaller than the limit (spec/candidateSearch.md) */
//@ pure
export function beginSearch(s: CandidateSearch, limit: number, budget: number): CandidateSearch {
  //@ ensures (inv(s) && canBeginSearch(s, limit, budget)) ==> alwaysIdleSearchIsEmpty(\result)
  //@ ensures (inv(s) && canBeginSearch(s, limit, budget)) ==> alwaysChecksWithinBudget(\result)
  //@ ensures (inv(s) && canBeginSearch(s, limit, budget)) ==> alwaysKeptWithinLimit(\result)
  //@ ensures (inv(s) && canBeginSearch(s, limit, budget)) ==> alwaysKeptValuesAreRealPairs(\result)
  //@ ensures (inv(s) && canBeginSearch(s, limit, budget)) ==> alwaysDroppedOnlyWhenFull(\result)
  //@ ensures (inv(s) && canBeginSearch(s, limit, budget)) ==> alwaysKeptOrdinalsDistinct(\result)
  //@ ensures (inv(s) && canBeginSearch(s, limit, budget)) ==> alwaysKeptBeatDropped(\result)
  //@ ensures (inv(s) && canBeginSearch(s, limit, budget)) ==> alwaysKeptRankAboveDropped(\result)
  //@ ensures (inv(s) && canBeginSearch(s, limit, budget)) ==> alwaysExactBeatsUnseen(\result)
  //@ ensures (inv(s) && canBeginSearch(s, limit, budget)) ==> stepEachCheckCountsOnce(s, "beginSearch", \result)
  //@ ensures (inv(s) && canBeginSearch(s, limit, budget)) ==> stepClosedSearchStaysClosed(s, \result)
  return { ...s, phase: "Scanning", limit: limit, budget: budget };
}

/** Story: Keep the best candidates within a fixed number of pair checks / A search starts once with a positive limit and a budget no smaller than the limit (spec/candidateSearch.md) */
//@ pure
export function alwaysIdleSearchIsEmpty(s: CandidateSearch): boolean {
  return !(s.phase === "Idle") || (s.checks === 0 && s.kept.length === 0 && s.bestDropped === pairValue_noPairValue);
}

/** Story: Keep the best candidates within a fixed number of pair checks / A search starts once with a positive limit and a budget no smaller than the limit (spec/candidateSearch.md) */
//@ pure
export function alwaysChecksWithinBudget(s: CandidateSearch): boolean {
  return s.checks <= s.budget;
}

/** Story: Keep the best candidates within a fixed number of pair checks / Each check counts once and keeps the candidate only when it ranks among the best (spec/candidateSearch.md) */
//@ pure
export function candidateRanksAbove(candidate: RankedCandidate, other: RankedCandidate): boolean {
  return candidate.value > other.value || (candidate.value === other.value && candidate.ordinal < other.ordinal);
}

/** Story: Keep the best candidates within a fixed number of pair checks / Each check counts once and keeps the candidate only when it ranks among the best (spec/candidateSearch.md) */
//@ pure
export function searchHigherRanked(left: RankedCandidate, right: RankedCandidate): RankedCandidate {
  return candidateRanksAbove(right, left) ? right : left;
}

/** Story: Keep the best candidates within a fixed number of pair checks / Each check counts once and keeps the candidate only when it ranks among the best (spec/candidateSearch.md) */
//@ pure
export function searchDroppedRank(s: CandidateSearch): RankedCandidate {
  return { value: s.bestDropped, ordinal: s.bestDroppedOrdinal };
}

/** Story: Keep the best candidates within a fixed number of pair checks / Each check counts once and keeps the candidate only when it ranks among the best (spec/candidateSearch.md) */
//@ pure
export function worstKeptScan(kept: RankedCandidate[]): WorstKeptScan {
  return kept.reduce((scan: WorstKeptScan, candidate: RankedCandidate) => scan.worstPosition < 0 || candidateRanksAbove(scan.worst, candidate) ? ({ position: exact_candidateSearch(scan.position + 1), worstPosition: scan.position, worst: candidate } as WorstKeptScan) : ({ ...scan, position: exact_candidateSearch(scan.position + 1) } as WorstKeptScan), ({ position: 0, worstPosition: -1, worst: ({ value: 0, ordinal: 0 } as RankedCandidate) } as WorstKeptScan));
}

/** Story: Keep the best candidates within a fixed number of pair checks / Each check counts once and keeps the candidate only when it ranks among the best (spec/candidateSearch.md) */
//@ pure
export function canCheckCandidate(s: CandidateSearch, ordinal: number): boolean {
  return s.phase === "Scanning" && s.checks < s.budget && !s.kept.some((c: RankedCandidate) => c.ordinal === ordinal);
}

/** Story: Keep the best candidates within a fixed number of pair checks / Each check counts once and keeps the candidate only when it ranks among the best (spec/candidateSearch.md) */
//@ pure
export function alwaysKeptWithinLimit(s: CandidateSearch): boolean {
  return s.kept.length <= s.limit;
}

/** Story: Keep the best candidates within a fixed number of pair checks / Each check counts once and keeps the candidate only when it ranks among the best (spec/candidateSearch.md) */
//@ pure
export function alwaysKeptValuesAreRealPairs(s: CandidateSearch): boolean {
  return !s.kept.some((c: RankedCandidate) => !(c.value >= 0));
}

/** Story: Keep the best candidates within a fixed number of pair checks / Each check counts once and keeps the candidate only when it ranks among the best (spec/candidateSearch.md) */
//@ pure
export function alwaysDroppedOnlyWhenFull(s: CandidateSearch): boolean {
  return !(s.bestDropped > pairValue_noPairValue) || s.kept.length === s.limit;
}

/** Story: Keep the best candidates within a fixed number of pair checks / Each check counts once and keeps the candidate only when it ranks among the best (spec/candidateSearch.md) */
//@ pure
export function alwaysKeptOrdinalsDistinct(s: CandidateSearch): boolean {
  return !s.kept.some((c: RankedCandidate) => !(s.kept.filter((d: RankedCandidate) => d.ordinal === c.ordinal).length === 1));
}

/** Story: Keep the best candidates within a fixed number of pair checks / Each check counts once and keeps the candidate only when it ranks among the best (spec/candidateSearch.md) */
//@ pure
export function alwaysKeptBeatDropped(s: CandidateSearch): boolean {
  return !s.kept.some((c: RankedCandidate) => !(c.value >= s.bestDropped));
}

/** Story: Keep the best candidates within a fixed number of pair checks / Each check counts once and keeps the candidate only when it ranks among the best (spec/candidateSearch.md) */
//@ pure
export function stepEachCheckCountsOnce(before: CandidateSearch, via: string, after: CandidateSearch): boolean {
  return via === "checkCandidate" ? after.checks === exact_candidateSearch(before.checks + 1) : after.checks === before.checks;
}

/** Story: Keep the best candidates within a fixed number of pair checks / Each check counts once and keeps the candidate only when it ranks among the best (spec/candidateSearch.md) */
//@ pure
export function sometimesDroppedCandidate(s: CandidateSearch): boolean {
  return s.bestDropped >= 0;
}

/** Story: Keep the best candidates within a fixed number of pair checks / Each check counts once and keeps the candidate only when it ranks among the best (spec/candidateSearch.md) */
//@ pure
export function alwaysKeptRankAboveDropped(s: CandidateSearch): boolean {
  const local_3: RankedCandidate = searchDroppedRank(s);
  return !(s.bestDropped > pairValue_noPairValue) || !s.kept.some((c: RankedCandidate) => !candidateRanksAbove(c, local_3));
}

/** Story: Keep the best candidates within a fixed number of pair checks / Each check counts once and keeps the candidate only when it ranks among the best (spec/candidateSearch.md) */
//@ pure
export function checkCandidate(s: CandidateSearch, value: number, ordinal: number): CandidateSearch {
  //@ ensures (inv(s) && canCheckCandidate(s, ordinal)) ==> alwaysIdleSearchIsEmpty(\result)
  //@ ensures (inv(s) && canCheckCandidate(s, ordinal)) ==> alwaysChecksWithinBudget(\result)
  //@ ensures (inv(s) && canCheckCandidate(s, ordinal)) ==> alwaysKeptWithinLimit(\result)
  //@ ensures (inv(s) && canCheckCandidate(s, ordinal)) ==> alwaysKeptValuesAreRealPairs(\result)
  //@ ensures (inv(s) && canCheckCandidate(s, ordinal)) ==> alwaysDroppedOnlyWhenFull(\result)
  //@ ensures (inv(s) && canCheckCandidate(s, ordinal)) ==> alwaysKeptOrdinalsDistinct(\result)
  //@ ensures (inv(s) && canCheckCandidate(s, ordinal)) ==> alwaysKeptBeatDropped(\result)
  //@ ensures (inv(s) && canCheckCandidate(s, ordinal)) ==> alwaysKeptRankAboveDropped(\result)
  //@ ensures (inv(s) && canCheckCandidate(s, ordinal)) ==> alwaysExactBeatsUnseen(\result)
  //@ ensures (inv(s) && canCheckCandidate(s, ordinal)) ==> stepEachCheckCountsOnce(s, "checkCandidate", \result)
  //@ ensures (inv(s) && canCheckCandidate(s, ordinal)) ==> stepClosedSearchStaysClosed(s, \result)
  const local_4: RankedCandidate = { value: value, ordinal: ordinal };
  const local_5: WorstKeptScan = worstKeptScan(s.kept);
  const local_6: RankedCandidate = searchHigherRanked(searchDroppedRank(s), local_5.worst);
  const local_7: RankedCandidate = searchHigherRanked(searchDroppedRank(s), local_4);
  const local_8: CandidateSearch = { ...s, checks: exact_candidateSearch(s.checks + 1) };
  return value < 0 ? local_8 : (s.kept.length < s.limit ? ({ ...local_8, kept: s.kept.concat([local_4]) } as CandidateSearch) : (local_5.worstPosition >= 0 && local_5.worstPosition < s.kept.length && candidateRanksAbove(local_4, local_5.worst) ? ({ ...local_8, kept: (0 <= local_5.worstPosition && local_5.worstPosition < s.kept.length ? s.kept.slice(0, local_5.worstPosition).concat(s.kept.slice(local_5.worstPosition + 1)) : s.kept).concat([local_4]), bestDropped: local_6.value, bestDroppedOrdinal: local_6.ordinal } as CandidateSearch) : ({ ...local_8, bestDropped: local_7.value, bestDroppedOrdinal: local_7.ordinal } as CandidateSearch)));
}

/** Story: Keep the best candidates within a fixed number of pair checks / An exact search stops only when no unseen candidate can enter the kept list (spec/candidateSearch.md) */
//@ pure
export function searchStopsExact(s: CandidateSearch, unseenBound: number): boolean {
  return unseenBound < 0 || (s.kept.length === s.limit && !s.kept.some((c: RankedCandidate) => !(c.value > unseenBound)));
}

/** Story: Keep the best candidates within a fixed number of pair checks / An exact search stops only when no unseen candidate can enter the kept list (spec/candidateSearch.md) */
//@ pure
export function closeExact(s: CandidateSearch, unseenBound: number): CandidateSearch {
  //@ ensures (inv(s) && canCloseExact(s, unseenBound)) ==> alwaysIdleSearchIsEmpty(\result)
  //@ ensures (inv(s) && canCloseExact(s, unseenBound)) ==> alwaysChecksWithinBudget(\result)
  //@ ensures (inv(s) && canCloseExact(s, unseenBound)) ==> alwaysKeptWithinLimit(\result)
  //@ ensures (inv(s) && canCloseExact(s, unseenBound)) ==> alwaysKeptValuesAreRealPairs(\result)
  //@ ensures (inv(s) && canCloseExact(s, unseenBound)) ==> alwaysDroppedOnlyWhenFull(\result)
  //@ ensures (inv(s) && canCloseExact(s, unseenBound)) ==> alwaysKeptOrdinalsDistinct(\result)
  //@ ensures (inv(s) && canCloseExact(s, unseenBound)) ==> alwaysKeptBeatDropped(\result)
  //@ ensures (inv(s) && canCloseExact(s, unseenBound)) ==> alwaysKeptRankAboveDropped(\result)
  //@ ensures (inv(s) && canCloseExact(s, unseenBound)) ==> alwaysExactBeatsUnseen(\result)
  //@ ensures (inv(s) && canCloseExact(s, unseenBound)) ==> stepEachCheckCountsOnce(s, "closeExact", \result)
  //@ ensures (inv(s) && canCloseExact(s, unseenBound)) ==> stepClosedSearchStaysClosed(s, \result)
  return { ...s, phase: "Exact", unseenBound: unseenBound };
}

/** Story: Keep the best candidates within a fixed number of pair checks / An exact search stops only when no unseen candidate can enter the kept list (spec/candidateSearch.md) */
//@ pure
export function sometimesExact(s: CandidateSearch): boolean {
  return s.phase === "Exact" && s.unseenBound >= 0;
}

/** Story: Keep the best candidates within a fixed number of pair checks / An exact search stops only when no unseen candidate can enter the kept list (spec/candidateSearch.md) */
//@ pure
export function canCloseExact(s: CandidateSearch, unseenBound: number): boolean {
  return s.phase === "Scanning" && searchStopsExact(s, unseenBound);
}

/** Story: Keep the best candidates within a fixed number of pair checks / An exact search stops only when no unseen candidate can enter the kept list (spec/candidateSearch.md) */
//@ pure
export function alwaysExactBeatsUnseen(s: CandidateSearch): boolean {
  return !(s.phase === "Exact") || searchStopsExact(s, s.unseenBound);
}

/** Story: Keep the best candidates within a fixed number of pair checks / A search that spends its budget before it is exact reports the value it may have missed (spec/candidateSearch.md) */
//@ pure
export function closeBudgeted(s: CandidateSearch, unseenBound: number): CandidateSearch {
  //@ ensures (inv(s) && canCloseBudgeted(s, unseenBound)) ==> alwaysIdleSearchIsEmpty(\result)
  //@ ensures (inv(s) && canCloseBudgeted(s, unseenBound)) ==> alwaysChecksWithinBudget(\result)
  //@ ensures (inv(s) && canCloseBudgeted(s, unseenBound)) ==> alwaysKeptWithinLimit(\result)
  //@ ensures (inv(s) && canCloseBudgeted(s, unseenBound)) ==> alwaysKeptValuesAreRealPairs(\result)
  //@ ensures (inv(s) && canCloseBudgeted(s, unseenBound)) ==> alwaysDroppedOnlyWhenFull(\result)
  //@ ensures (inv(s) && canCloseBudgeted(s, unseenBound)) ==> alwaysKeptOrdinalsDistinct(\result)
  //@ ensures (inv(s) && canCloseBudgeted(s, unseenBound)) ==> alwaysKeptBeatDropped(\result)
  //@ ensures (inv(s) && canCloseBudgeted(s, unseenBound)) ==> alwaysKeptRankAboveDropped(\result)
  //@ ensures (inv(s) && canCloseBudgeted(s, unseenBound)) ==> alwaysExactBeatsUnseen(\result)
  //@ ensures (inv(s) && canCloseBudgeted(s, unseenBound)) ==> stepEachCheckCountsOnce(s, "closeBudgeted", \result)
  //@ ensures (inv(s) && canCloseBudgeted(s, unseenBound)) ==> stepClosedSearchStaysClosed(s, \result)
  return { ...s, phase: "Budgeted", unseenBound: unseenBound };
}

/** Story: Keep the best candidates within a fixed number of pair checks / A search that spends its budget before it is exact reports the value it may have missed (spec/candidateSearch.md) */
//@ pure
export function stepClosedSearchStaysClosed(before: CandidateSearch, after: CandidateSearch): boolean {
  return !(before.phase === "Exact" || before.phase === "Budgeted") || equal_candidateSearch(after, before);
}

/** Story: Keep the best candidates within a fixed number of pair checks / A search that spends its budget before it is exact reports the value it may have missed (spec/candidateSearch.md) */
//@ pure
export function sometimesBudgeted(s: CandidateSearch): boolean {
  return s.phase === "Budgeted";
}

/** Story: Keep the best candidates within a fixed number of pair checks / A search that spends its budget before it is exact reports the value it may have missed (spec/candidateSearch.md) */
//@ pure
export function canCloseBudgeted(s: CandidateSearch, unseenBound: number): boolean {
  return s.phase === "Scanning" && s.checks >= s.budget && !searchStopsExact(s, unseenBound);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: CandidateSearch, event: Event): boolean {
  if (event.type === "beginSearch") return canBeginSearch(current, event.limit, event.budget);
  if (event.type === "checkCandidate") return canCheckCandidate(current, event.ordinal);
  if (event.type === "closeExact") return canCloseExact(current, event.unseenBound);
  if (event.type === "closeBudgeted") return canCloseBudgeted(current, event.unseenBound);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: CandidateSearch, event: Event): CandidateSearch {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "beginSearch" && canBeginSearch(current, event.limit, event.budget)) return beginSearch(current, event.limit, event.budget);
  if (event.type === "checkCandidate" && canCheckCandidate(current, event.ordinal)) return checkCandidate(current, event.value, event.ordinal);
  if (event.type === "closeExact" && canCloseExact(current, event.unseenBound)) return closeExact(current, event.unseenBound);
  if (event.type === "closeBudgeted" && canCloseBudgeted(current, event.unseenBound)) return closeBudgeted(current, event.unseenBound);
  return current;
}

/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseEvent(x: unknown): Event | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "beginSearch" && Number.isSafeInteger(raw.limit) && Number.isSafeInteger(raw.budget)) return { type: "beginSearch", limit: raw.limit, budget: raw.budget };
  if (raw.type === "checkCandidate" && Number.isSafeInteger(raw.value) && Number.isSafeInteger(raw.ordinal)) return { type: "checkCandidate", value: raw.value, ordinal: raw.ordinal };
  if (raw.type === "closeExact" && Number.isSafeInteger(raw.unseenBound)) return { type: "closeExact", unseenBound: raw.unseenBound };
  if (raw.type === "closeBudgeted" && Number.isSafeInteger(raw.unseenBound)) return { type: "closeBudgeted", unseenBound: raw.unseenBound };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): CandidateSearch | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  const is_RankedCandidate = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && Number.isSafeInteger(v.value) && Number.isSafeInteger(v.ordinal) && Object.keys(v).length === 2;
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Idle" || raw.phase === "Scanning" || raw.phase === "Exact" || raw.phase === "Budgeted") && Number.isSafeInteger(raw.limit) && Number.isSafeInteger(raw.budget) && Number.isSafeInteger(raw.checks) && Array.isArray(raw.kept) && raw.kept.every((x1: any) => is_RankedCandidate(x1)) && Number.isSafeInteger(raw.bestDropped) && Number.isSafeInteger(raw.bestDroppedOrdinal) && Number.isSafeInteger(raw.unseenBound) && Object.keys(raw).length === 8)) return undefined;
  const parsed: CandidateSearch = ({ phase: raw.phase, limit: raw.limit, budget: raw.budget, checks: raw.checks, kept: raw.kept.map((x1: any) => ({ value: x1.value, ordinal: x1.ordinal })), bestDropped: raw.bestDropped, bestDroppedOrdinal: raw.bestDroppedOrdinal, unseenBound: raw.unseenBound });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): CandidateSearch {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_candidateSearch(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_candidateSearch(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_candidateSearch((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
