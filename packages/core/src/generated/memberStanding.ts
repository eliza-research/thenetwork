// GENERATED from spec/memberStanding.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type LaneShape as matchLane_LaneShape, type LaneSide as matchLane_LaneSide, type LaneWeights as matchLane_LaneWeights, type MatchLane as matchLane_MatchLane, type LaneLimits as matchLane_LaneLimits, standingCeiling as matchLane_standingCeiling, standingUncertaintyCeiling as matchLane_standingUncertaintyCeiling, teenFriendApp as matchLane_teenFriendApp, teenFriendCategory as matchLane_teenFriendCategory, teenGroupPlanApp as matchLane_teenGroupPlanApp, teenGenerator as matchLane_teenGenerator, laneWeights as matchLane_laneWeights, laneOffered as matchLane_laneOffered, lawEveryAppHasALane as matchLane_lawEveryAppHasALane, laneShape as matchLane_laneShape, teenFriendLane as matchLane_teenFriendLane, lawNtwrkTeenCategoryIsSocial as matchLane_lawNtwrkTeenCategoryIsSocial, lawTeenPlansOnlyOnFriends as matchLane_lawTeenPlansOnlyOnFriends, lawTeenGeneratorOnlyInFriendApps as matchLane_lawTeenGeneratorOnlyInFriendApps, lawNtwrkHasNoTeenPlans as matchLane_lawNtwrkHasNoTeenPlans, lawRepeatsAndContributorsNeverTeen as matchLane_lawRepeatsAndContributorsNeverTeen, lawTeenLanesOnlyInFriendApps as matchLane_lawTeenLanesOnlyInFriendApps, lawNoTeenOnSlopOrPeon as matchLane_lawNoTeenOnSlopOrPeon, lawTeenFriendLaneSameOnBothApps as matchLane_lawTeenFriendLaneSameOnBothApps, lawTeenFriendLaneIsOffered as matchLane_lawTeenFriendLaneIsOffered, lawNoTeenDateOrWork as matchLane_lawNoTeenDateOrWork, laneSidesCompatible as matchLane_laneSidesCompatible, laneLimits as matchLane_laneLimits, lawLaneWeightsWellFormed as matchLane_lawLaneWeightsWellFormed, lawLaneSidesSymmetric as matchLane_lawLaneSidesSymmetric, laneOffset as matchLane_laneOffset, lawLaneLimitsWellFormed as matchLane_lawLaneLimitsWellFormed, lawLaneOffsetAntisymmetric as matchLane_lawLaneOffsetAntisymmetric, lanePairValue as matchLane_lanePairValue, lawLanePairValueSymmetric as matchLane_lawLanePairValueSymmetric } from "./matchLane.ts";
import { type PairSide as pairValue_PairSide, type PairRules as pairValue_PairRules, type UtilityTerm as pairValue_UtilityTerm } from "./pairValue.ts";

/** Story: Estimate standing from facts, never from popularity / Standing adds reviewed facts in full and unreviewed facts at half (spec/memberStanding.md) */
export interface StandingEvidence { points: number; reviewed: boolean }
/** Story: Move standing slowly / The first observation initializes standing and a due observation advances it once (spec/memberStanding.md) */
export interface StandingObservation { standing: number; updatedAt: number }

/** Story: Estimate standing from facts, never from popularity / Ordinary standing evidence uses the member's current matching scope (spec/memberStanding.md) */
export const standingFacetScopes: string[] = ["agent_private", "opportunity_specific", "matchable", "shareable"];
/** Story: Estimate standing from facts, never from popularity / Ordinary standing evidence uses the member's current matching scope (spec/memberStanding.md) */
export const standingFacetProvenances: string[] = ["said", "vouched", "connected_source", "inferred"];
/** Story: Estimate standing from facts, never from popularity / Standing adds reviewed facts in full and unreviewed facts at half (spec/memberStanding.md) */
export const standingUnreviewedPercent: number = 50;
/** Story: Estimate standing from facts, never from popularity / A private photo rating gives a percentile among rated adults of the same market and pool (spec/memberStanding.md) */
export const standingPoolMinimum: number = 20;
/** Story: Treat a new member with wide uncertainty / A member with no reviewed facts gets the widest uncertainty (spec/memberStanding.md) */
export const standingUncertaintyFloor: number = 3;
/** Story: Treat a new member with wide uncertainty / A member with no reviewed facts gets the widest uncertainty (spec/memberStanding.md) */
export const standingUncertaintyStep: number = 2;
/** Story: Move standing slowly / Standing moves toward its target by at most five points a week (spec/memberStanding.md) */
export const standingWeeklyStep: number = 5;
/** Story: Move standing slowly / The first observation initializes standing and a due observation advances it once (spec/memberStanding.md) */
export const standingObservationWeekMs: number = 604800000;
/** Story: Estimate standing from facts, never from popularity / A private photo rating gives a percentile among rated adults of the same market and pool (spec/memberStanding.md) */
export const standingMiddle: number = quotient_memberStanding(matchLane_standingCeiling, 2);

/** Story: Estimate standing from facts, never from popularity / Standing exists only for an adult who consented to the lane (spec/memberStanding.md) */
//@ pure
export function standingReadable(ageEligible: boolean, consented: boolean): boolean {
  return ageEligible && consented;
}

/** Story: Estimate standing from facts, never from popularity / Standing history requires current account and lane authority (spec/memberStanding.md) */
//@ pure
export function standingHistoryUsable(hasHistory: boolean, evidenceStillPermits: boolean): boolean {
  return hasHistory && evidenceStillPermits;
}

/** Story: Estimate standing from facts, never from popularity / Standing history requires current account and lane authority (spec/memberStanding.md) */
//@ pure
export function standingMayRetain(ageEligible: boolean, activeAccount: boolean, lanePermitted: boolean): boolean {
  return standingReadable(ageEligible, lanePermitted) && activeAccount;
}

/** Story: Estimate standing from facts, never from popularity / Standing history requires current account and lane authority (spec/memberStanding.md) */
//@ pure
export function lawWithdrawnEvidenceInvalidatesStanding(hasHistory: boolean): boolean {
  //@ ensures \result === true
  return !standingHistoryUsable(hasHistory, false);
}

/** Story: Estimate standing from facts, never from popularity / Standing history requires current account and lane authority (spec/memberStanding.md) */
//@ pure
export function lawStandingRetentionRequiresAuthority(ageEligible: boolean, activeAccount: boolean, lanePermitted: boolean): boolean {
  //@ ensures \result === true
  return !(!ageEligible || !activeAccount || !lanePermitted) || !standingMayRetain(ageEligible, activeAccount, lanePermitted);
}

/** Story: Estimate standing from facts, never from popularity / Ordinary standing evidence uses the member's current matching scope (spec/memberStanding.md) */
//@ pure
export function standingFacetReadable(scope: string, provenance: string, confirmed: boolean, sensitive: boolean, inferred: boolean): boolean {
  return (scope === "matchable" || scope === "shareable") && !sensitive && !inferred && (provenance === "said" || provenance === "vouched" || (provenance === "connected_source" && confirmed));
}

/** Story: Estimate standing from facts, never from popularity / Ordinary standing evidence uses the member's current matching scope (spec/memberStanding.md) */
//@ pure
export function lawStandingFacetNeedsMatchingPermission(scope: string, provenance: string, confirmed: boolean, sensitive: boolean, inferred: boolean): boolean {
  //@ ensures \result === true
  return !standingFacetReadable(scope, provenance, confirmed, sensitive, inferred) || ((scope === "matchable" || scope === "shareable") && !sensitive && !inferred && (provenance !== "connected_source" || confirmed));
}

/** Story: Estimate standing from facts, never from popularity / Standing adds reviewed facts in full and unreviewed facts at half (spec/memberStanding.md) */
//@ pure
export function standingClamp(value: number): number {
  return value < 0 ? 0 : (value > matchLane_standingCeiling ? matchLane_standingCeiling : value);
}

/** Story: Estimate standing from facts, never from popularity / Standing adds reviewed facts in full and unreviewed facts at half (spec/memberStanding.md) */
//@ pure
export function standingEvidencePoints(fact: StandingEvidence): number {
  const local_0 = standingClamp(fact.points);
  return fact.reviewed ? local_0 : quotient_memberStanding(exact_memberStanding(local_0 * standingUnreviewedPercent), 100);
}

/** Story: Estimate standing from facts, never from popularity / Standing adds reviewed facts in full and unreviewed facts at half (spec/memberStanding.md) */
//@ pure
export function standingFromEvidence(evidence: StandingEvidence[]): number {
  return standingClamp(evidence.reduce((total: number, fact: StandingEvidence) => exact_memberStanding(total + standingEvidencePoints(fact)), 0));
}

/** Story: Estimate standing from facts, never from popularity / Standing adds reviewed facts in full and unreviewed facts at half (spec/memberStanding.md) */
//@ pure
export function lawStandingMonotoneInEvidence(evidence: StandingEvidence[], extra: StandingEvidence): boolean {
  //@ ensures \result === true
  return standingFromEvidence(evidence.concat([extra])) >= standingFromEvidence(evidence);
}

/** Story: Estimate standing from facts, never from popularity / A private photo rating gives a percentile among rated adults of the same market and pool (spec/memberStanding.md) */
//@ pure
export function standingPoolReady(rated: number): boolean {
  return rated >= standingPoolMinimum;
}

/** Story: Estimate standing from facts, never from popularity / A private photo rating gives a percentile among rated adults of the same market and pool (spec/memberStanding.md) */
//@ pure
export function standingPercentile(below: number, equal: number, rated: number): number {
  return rated > 0 ? standingClamp(quotient_memberStanding(exact_memberStanding(exact_memberStanding(exact_memberStanding(2 * below) + equal) * matchLane_standingCeiling), exact_memberStanding(2 * rated))) : standingMiddle;
}

/** Story: Estimate standing from facts, never from popularity / A private photo rating gives a percentile among rated adults of the same market and pool (spec/memberStanding.md) */
//@ pure
export function lawStandingPercentileRisesWithRank(below: number, equal: number, rated: number): boolean {
  //@ ensures \result === true
  return !(below >= 0 && equal >= 0) || standingPercentile(exact_memberStanding(below + 1), equal, rated) >= standingPercentile(below, equal, rated);
}

/** Story: Estimate standing from facts, never from popularity / A private photo rating gives a percentile among rated adults of the same market and pool (spec/memberStanding.md) */
//@ pure
export function lawStandingBounded(evidence: StandingEvidence[], below: number, equal: number, rated: number): boolean {
  //@ ensures \result === true
  const local_1 = standingFromEvidence(evidence);
  const local_2 = standingPercentile(below, equal, rated);
  return local_1 >= 0 && local_1 <= matchLane_standingCeiling && local_2 >= 0 && local_2 <= matchLane_standingCeiling;
}

/** Story: Estimate standing from facts, never from popularity / One rated adult who joins a pool moves another member's percentile by at most the weekly step (spec/memberStanding.md) */
//@ pure
export function standingMovesWithinStep(before: number, after: number): boolean {
  return exact_memberStanding(after - before) <= standingWeeklyStep && exact_memberStanding(before - after) <= standingWeeklyStep;
}

/** Story: Estimate standing from facts, never from popularity / One rated adult who joins a pool moves another member's percentile by at most the weekly step (spec/memberStanding.md) */
//@ pure
export function lawStandingPercentileStableWhenOneJoins(below: number, equal: number, rated: number): boolean {
  //@ ensures \result === true
  const local_3 = standingPercentile(below, equal, rated);
  return !(below >= 0 && equal >= 1 && exact_memberStanding(below + equal) <= rated && standingPoolReady(rated)) || (standingMovesWithinStep(local_3, standingPercentile(below, equal, exact_memberStanding(rated + 1))) && standingMovesWithinStep(local_3, standingPercentile(exact_memberStanding(below + 1), equal, exact_memberStanding(rated + 1))) && standingMovesWithinStep(local_3, standingPercentile(below, exact_memberStanding(equal + 1), exact_memberStanding(rated + 1))));
}

/** Story: Treat a new member with wide uncertainty / A member with no reviewed facts gets the widest uncertainty (spec/memberStanding.md) */
//@ pure
export function standingUncertainty(reviewedCount: number): number {
  const local_4 = reviewedCount <= 0 ? 0 : (reviewedCount >= matchLane_standingUncertaintyCeiling ? matchLane_standingUncertaintyCeiling : reviewedCount);
  const local_5 = exact_memberStanding(matchLane_standingUncertaintyCeiling - exact_memberStanding(standingUncertaintyStep * local_4));
  return local_5 < standingUncertaintyFloor ? standingUncertaintyFloor : local_5;
}

/** Story: Treat a new member with wide uncertainty / A member with no reviewed facts gets the widest uncertainty (spec/memberStanding.md) */
//@ pure
export function lawUncertaintyBounded(reviewedCount: number): boolean {
  //@ ensures \result === true
  const local_6 = standingUncertainty(reviewedCount);
  return local_6 >= standingUncertaintyFloor && local_6 <= matchLane_standingUncertaintyCeiling && (!(reviewedCount <= 0) || local_6 === matchLane_standingUncertaintyCeiling);
}

/** Story: Treat a new member with wide uncertainty / Another reviewed fact never widens the uncertainty (spec/memberStanding.md) */
//@ pure
export function lawUncertaintyShrinks(reviewedCount: number): boolean {
  //@ ensures \result === true
  return standingUncertainty(exact_memberStanding(reviewedCount + 1)) <= standingUncertainty(reviewedCount);
}

/** Story: Treat a new member with wide uncertainty / A photo rating's uncertainty narrows with rated photos and widens with their disagreement (spec/memberStanding.md) */
//@ pure
export function ratingSpreadPoints(spreadLow: number, spreadHigh: number): number {
  return spreadHigh > spreadLow ? quotient_memberStanding(exact_memberStanding(exact_memberStanding(spreadHigh - spreadLow) + 1), 2) : 0;
}

/** Story: Treat a new member with wide uncertainty / A photo rating's uncertainty narrows with rated photos and widens with their disagreement (spec/memberStanding.md) */
//@ pure
export function ratingUncertainty(photos: number, spreadLow: number, spreadHigh: number): number {
  const local_7 = exact_memberStanding(standingUncertainty(photos) + ratingSpreadPoints(spreadLow, spreadHigh));
  return photos < 2 ? matchLane_standingUncertaintyCeiling : (local_7 > matchLane_standingUncertaintyCeiling ? matchLane_standingUncertaintyCeiling : local_7);
}

/** Story: Treat a new member with wide uncertainty / A photo rating's uncertainty narrows with rated photos and widens with their disagreement (spec/memberStanding.md) */
//@ pure
export function lawRatingUncertaintyShrinksWithPhotos(photos: number, spreadLow: number, spreadHigh: number): boolean {
  //@ ensures \result === true
  return ratingUncertainty(exact_memberStanding(photos + 1), spreadLow, spreadHigh) <= ratingUncertainty(photos, spreadLow, spreadHigh);
}

/** Story: Treat a new member with wide uncertainty / A photo rating's uncertainty narrows with rated photos and widens with their disagreement (spec/memberStanding.md) */
//@ pure
export function lawRatingUncertaintyGrowsWithSpread(photos: number, spreadLow: number, spreadHigh: number, wider: number, lower: number): boolean {
  //@ ensures \result === true
  return (!(wider >= spreadHigh) || ratingUncertainty(photos, spreadLow, wider) >= ratingUncertainty(photos, spreadLow, spreadHigh)) && (!(lower <= spreadLow) || ratingUncertainty(photos, lower, spreadHigh) >= ratingUncertainty(photos, spreadLow, spreadHigh));
}

/** Story: Treat a new member with wide uncertainty / A photo rating's uncertainty narrows with rated photos and widens with their disagreement (spec/memberStanding.md) */
//@ pure
export function lawRatingUncertaintyBounded(photos: number, spreadLow: number, spreadHigh: number): boolean {
  //@ ensures \result === true
  const local_8 = ratingUncertainty(photos, spreadLow, spreadHigh);
  return local_8 >= standingUncertaintyFloor && local_8 <= matchLane_standingUncertaintyCeiling && (!(photos < 2) || local_8 === matchLane_standingUncertaintyCeiling);
}

/** Story: Treat a new member with wide uncertainty / A standing that staff reviewed as a property of the offer has the floor uncertainty (spec/memberStanding.md) */
//@ pure
export function standingUncertaintyFor(reviewedCount: number, reviewedProperty: boolean): number {
  return reviewedProperty ? standingUncertaintyFloor : standingUncertainty(reviewedCount);
}

/** Story: Treat a new member with wide uncertainty / A standing that staff reviewed as a property of the offer has the floor uncertainty (spec/memberStanding.md) */
//@ pure
export function lawReviewedPropertyHasFloorUncertainty(reviewedCount: number, reviewedProperty: boolean): boolean {
  //@ ensures \result === true
  return standingUncertaintyFor(reviewedCount, true) === standingUncertaintyFloor && standingUncertaintyFor(reviewedCount, true) <= standingUncertaintyFor(reviewedCount, reviewedProperty);
}

/** Story: Move standing slowly / Standing moves toward its target by at most five points a week (spec/memberStanding.md) */
//@ pure
export function nextStanding(standing: number, target: number): number {
  const local_9 = standingClamp(standing);
  const local_10 = standingClamp(target);
  return local_10 > exact_memberStanding(local_9 + standingWeeklyStep) ? exact_memberStanding(local_9 + standingWeeklyStep) : (local_10 < exact_memberStanding(local_9 - standingWeeklyStep) ? exact_memberStanding(local_9 - standingWeeklyStep) : local_10);
}

/** Story: Move standing slowly / Standing moves toward its target by at most five points a week (spec/memberStanding.md) */
//@ pure
export function lawStandingStepBounded(standing: number, target: number): boolean {
  //@ ensures \result === true
  const local_11 = nextStanding(standing, target);
  return local_11 >= 0 && local_11 <= matchLane_standingCeiling && (!(standing >= 0 && standing <= matchLane_standingCeiling) || (exact_memberStanding(local_11 - standing) <= standingWeeklyStep && exact_memberStanding(standing - local_11) <= standingWeeklyStep));
}

/** Story: Move standing slowly / Standing reaches a target that is within one step (spec/memberStanding.md) */
//@ pure
export function lawStandingStepConverges(standing: number, target: number): boolean {
  //@ ensures \result === true
  return !(standing >= 0 && standing <= matchLane_standingCeiling && target >= 0 && target <= matchLane_standingCeiling && exact_memberStanding(target - standing) <= standingWeeklyStep && exact_memberStanding(standing - target) <= standingWeeklyStep) || nextStanding(standing, target) === target;
}

/** Story: Move standing slowly / The first observation initializes standing and a due observation advances it once (spec/memberStanding.md) */
//@ pure
export function observeStanding(value: number, observedAt: number, target: number, now: number, initialized: boolean): StandingObservation {
  return !initialized || observedAt < 0 ? (now < 0 ? ({ standing: standingClamp(value), updatedAt: -1 } as StandingObservation) : ({ standing: standingClamp(target), updatedAt: now } as StandingObservation)) : (now >= observedAt && exact_memberStanding(now - observedAt) >= standingObservationWeekMs ? ({ standing: nextStanding(value, target), updatedAt: now } as StandingObservation) : ({ standing: standingClamp(value), updatedAt: observedAt } as StandingObservation));
}

/** Story: Move standing slowly / The first observation initializes standing and a due observation advances it once (spec/memberStanding.md) */
//@ pure
export function lawFirstStandingObservationUsesTarget(value: number, observedAt: number, target: number, now: number, initialized: boolean): boolean {
  //@ ensures \result === true
  return !((!initialized || observedAt < 0) && now >= 0) || equal_memberStanding(observeStanding(value, observedAt, target, now, initialized), ({ standing: standingClamp(target), updatedAt: now } as StandingObservation));
}

/** Story: Move standing slowly / The first observation initializes standing and a due observation advances it once (spec/memberStanding.md) */
//@ pure
export function lawStandingInvalidClockCannotInitialize(value: number, observedAt: number, target: number, now: number, initialized: boolean): boolean {
  //@ ensures \result === true
  return !((!initialized || observedAt < 0) && now < 0) || observeStanding(value, observedAt, target, now, initialized).updatedAt === -1;
}

/** Story: Move standing slowly / The first observation initializes standing and a due observation advances it once (spec/memberStanding.md) */
//@ pure
export function lawStandingObservationHoldsUntilDue(value: number, observedAt: number, target: number, now: number): boolean {
  //@ ensures \result === true
  return !(observedAt >= 0 && (now < observedAt || exact_memberStanding(now - observedAt) < standingObservationWeekMs)) || equal_memberStanding(observeStanding(value, observedAt, target, now, true), ({ standing: standingClamp(value), updatedAt: observedAt } as StandingObservation));
}

/** Story: Move standing slowly / The first observation initializes standing and a due observation advances it once (spec/memberStanding.md) */
//@ pure
export function lawStandingObservationNeverMovesTimeBackward(value: number, observedAt: number, target: number, now: number): boolean {
  //@ ensures \result === true
  return !(observedAt >= 0) || observeStanding(value, observedAt, target, now, true).updatedAt >= observedAt;
}

/** Story: Move standing slowly / The first observation initializes standing and a due observation advances it once (spec/memberStanding.md) */
//@ pure
export function lawStandingObservationInRange(value: number, observedAt: number, target: number, now: number, initialized: boolean): boolean {
  //@ ensures \result === true
  const local_12: StandingObservation = observeStanding(value, observedAt, target, now, initialized);
  return 0 <= local_12.standing && local_12.standing <= matchLane_standingCeiling && local_12.updatedAt >= -1;
}

/** Story: Move standing slowly / The first observation initializes standing and a due observation advances it once (spec/memberStanding.md) */
//@ pure
export function lawStandingDueObservationStepsOnce(value: number, observedAt: number, target: number, now: number): boolean {
  //@ ensures \result === true
  const local_13: StandingObservation = observeStanding(value, observedAt, target, now, true);
  const local_14 = standingClamp(value);
  return !(observedAt >= 0 && now >= observedAt && exact_memberStanding(now - observedAt) >= standingObservationWeekMs) || (local_13.updatedAt === now && local_13.standing === nextStanding(value, target) && exact_memberStanding(local_13.standing - local_14) <= standingWeeklyStep && exact_memberStanding(local_14 - local_13.standing) <= standingWeeklyStep);
}

/** Story: Move standing slowly / The first observation initializes standing and a due observation advances it once (spec/memberStanding.md) */
//@ pure
export function lawStandingObservationCannotAdvanceTwiceAtSameTime(value: number, observedAt: number, target: number, now: number, initialized: boolean): boolean {
  //@ ensures \result === true
  const local_15: StandingObservation = observeStanding(value, observedAt, target, now, initialized);
  return !(local_15.updatedAt >= 0) || equal_memberStanding(observeStanding(local_15.standing, local_15.updatedAt, target, now, true), local_15);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_memberStanding(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_memberStanding(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_memberStanding((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Whole-number division as Quint does it: towards zero. */
//@ pure
export function quotient_memberStanding(a: number, b: number): number {
  //@ requires b !== 0
  if (b === 0) throw new RangeError(`${a} cannot be divided by zero`);
  return (a < 0 === b < 0 ? 1 : -1) * Math.floor(Math.abs(a) / Math.abs(b)) + 0;
}
