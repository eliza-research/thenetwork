// GENERATED from spec/memberStanding.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type LaneShape as matchLane_LaneShape, type LaneSide as matchLane_LaneSide, type LaneWeights as matchLane_LaneWeights, type MatchLane as matchLane_MatchLane, type LaneLimits as matchLane_LaneLimits, standingCeiling as matchLane_standingCeiling, standingUncertaintyCeiling as matchLane_standingUncertaintyCeiling, laneWeights as matchLane_laneWeights, laneOffered as matchLane_laneOffered, lawEveryAppHasALane as matchLane_lawEveryAppHasALane, laneShape as matchLane_laneShape, laneSidesCompatible as matchLane_laneSidesCompatible, laneLimits as matchLane_laneLimits, lawLaneWeightsWellFormed as matchLane_lawLaneWeightsWellFormed, lawLaneSidesSymmetric as matchLane_lawLaneSidesSymmetric, laneOffset as matchLane_laneOffset, lawLaneLimitsWellFormed as matchLane_lawLaneLimitsWellFormed, lawLaneOffsetAntisymmetric as matchLane_lawLaneOffsetAntisymmetric, lanePairValue as matchLane_lanePairValue, lawLanePairValueSymmetric as matchLane_lawLanePairValueSymmetric } from "./matchLane.ts";
import { type PairSide as pairValue_PairSide, type PairRules as pairValue_PairRules, type UtilityTerm as pairValue_UtilityTerm } from "./pairValue.ts";

/** Story: Estimate standing from facts, never from popularity / Standing adds reviewed facts in full and unreviewed facts at half (spec/memberStanding.md:23) */
export interface StandingEvidence { points: number; reviewed: boolean }

/** Story: Estimate standing from facts, never from popularity / A private photo rating maps onto the standing scale for dating (spec/memberStanding.md:53) */
export const standingRatingScale: number = 1000;
/** Story: Estimate standing from facts, never from popularity / Standing adds reviewed facts in full and unreviewed facts at half (spec/memberStanding.md:23) */
export const standingUnreviewedPercent: number = 50;
/** Story: Treat a new member with wide uncertainty / A member with no reviewed facts gets the widest uncertainty (spec/memberStanding.md:77) */
export const standingUncertaintyFloor: number = 3;
/** Story: Treat a new member with wide uncertainty / A member with no reviewed facts gets the widest uncertainty (spec/memberStanding.md:77) */
export const standingUncertaintyStep: number = 2;
/** Story: Move standing slowly / Standing moves toward its target by at most five points a week (spec/memberStanding.md:111) */
export const standingWeeklyStep: number = 5;

/** Story: Estimate standing from facts, never from popularity / Standing exists only for an adult who consented to the lane (spec/memberStanding.md:13) */
//@ pure
export function standingReadable(adult: boolean, consented: boolean): boolean {
  return adult && consented;
}

/** Story: Estimate standing from facts, never from popularity / Standing adds reviewed facts in full and unreviewed facts at half (spec/memberStanding.md:23) */
//@ pure
export function standingClamp(value: number): number {
  return value < 0 ? 0 : (value > matchLane_standingCeiling ? matchLane_standingCeiling : value);
}

/** Story: Estimate standing from facts, never from popularity / Standing adds reviewed facts in full and unreviewed facts at half (spec/memberStanding.md:23) */
//@ pure
export function standingEvidencePoints(fact: StandingEvidence): number {
  const local_0 = standingClamp(fact.points);
  return fact.reviewed ? local_0 : quotient_memberStanding(exact_memberStanding(local_0 * standingUnreviewedPercent), 100);
}

/** Story: Estimate standing from facts, never from popularity / Standing adds reviewed facts in full and unreviewed facts at half (spec/memberStanding.md:23) */
//@ pure
export function standingFromEvidence(evidence: StandingEvidence[]): number {
  return standingClamp(evidence.reduce((total: number, fact: StandingEvidence) => exact_memberStanding(total + standingEvidencePoints(fact)), 0));
}

/** Story: Estimate standing from facts, never from popularity / Standing adds reviewed facts in full and unreviewed facts at half (spec/memberStanding.md:23) */
//@ pure
export function lawStandingMonotoneInEvidence(evidence: StandingEvidence[], extra: StandingEvidence): boolean {
  //@ ensures \result === true
  return standingFromEvidence(evidence.concat([extra])) >= standingFromEvidence(evidence);
}

/** Story: Estimate standing from facts, never from popularity / A private photo rating maps onto the standing scale for dating (spec/memberStanding.md:53) */
//@ pure
export function standingFromRating(ratingPermille: number): number {
  const local_1 = ratingPermille < 0 ? 0 : (ratingPermille > standingRatingScale ? standingRatingScale : ratingPermille);
  return standingRatingScale > 0 ? quotient_memberStanding(exact_memberStanding(local_1 * matchLane_standingCeiling), standingRatingScale) : 0;
}

/** Story: Estimate standing from facts, never from popularity / A private photo rating maps onto the standing scale for dating (spec/memberStanding.md:53) */
//@ pure
export function lawStandingBounded(evidence: StandingEvidence[], ratingPermille: number): boolean {
  //@ ensures \result === true
  const local_2 = standingFromEvidence(evidence);
  const local_3 = standingFromRating(ratingPermille);
  return local_2 >= 0 && local_2 <= matchLane_standingCeiling && local_3 >= 0 && local_3 <= matchLane_standingCeiling;
}

/** Story: Treat a new member with wide uncertainty / A member with no reviewed facts gets the widest uncertainty (spec/memberStanding.md:77) */
//@ pure
export function standingUncertainty(reviewedCount: number): number {
  const local_4 = reviewedCount <= 0 ? 0 : (reviewedCount >= matchLane_standingUncertaintyCeiling ? matchLane_standingUncertaintyCeiling : reviewedCount);
  const local_5 = exact_memberStanding(matchLane_standingUncertaintyCeiling - exact_memberStanding(standingUncertaintyStep * local_4));
  return local_5 < standingUncertaintyFloor ? standingUncertaintyFloor : local_5;
}

/** Story: Treat a new member with wide uncertainty / A member with no reviewed facts gets the widest uncertainty (spec/memberStanding.md:77) */
//@ pure
export function lawUncertaintyBounded(reviewedCount: number): boolean {
  //@ ensures \result === true
  const local_6 = standingUncertainty(reviewedCount);
  return local_6 >= standingUncertaintyFloor && local_6 <= matchLane_standingUncertaintyCeiling && (!(reviewedCount <= 0) || local_6 === matchLane_standingUncertaintyCeiling);
}

/** Story: Treat a new member with wide uncertainty / Another reviewed fact never widens the uncertainty (spec/memberStanding.md:100) */
//@ pure
export function lawUncertaintyShrinks(reviewedCount: number): boolean {
  //@ ensures \result === true
  return standingUncertainty(exact_memberStanding(reviewedCount + 1)) <= standingUncertainty(reviewedCount);
}

/** Story: Move standing slowly / Standing moves toward its target by at most five points a week (spec/memberStanding.md:111) */
//@ pure
export function nextStanding(standing: number, target: number): number {
  const local_7 = standingClamp(standing);
  const local_8 = standingClamp(target);
  return local_8 > exact_memberStanding(local_7 + standingWeeklyStep) ? exact_memberStanding(local_7 + standingWeeklyStep) : (local_8 < exact_memberStanding(local_7 - standingWeeklyStep) ? exact_memberStanding(local_7 - standingWeeklyStep) : local_8);
}

/** Story: Move standing slowly / Standing moves toward its target by at most five points a week (spec/memberStanding.md:111) */
//@ pure
export function lawStandingStepBounded(standing: number, target: number): boolean {
  //@ ensures \result === true
  const local_9 = nextStanding(standing, target);
  return local_9 >= 0 && local_9 <= matchLane_standingCeiling && (!(standing >= 0 && standing <= matchLane_standingCeiling) || (exact_memberStanding(local_9 - standing) <= standingWeeklyStep && exact_memberStanding(standing - local_9) <= standingWeeklyStep));
}

/** Story: Move standing slowly / Standing reaches a target that is within one step (spec/memberStanding.md:135) */
//@ pure
export function lawStandingStepConverges(standing: number, target: number): boolean {
  //@ ensures \result === true
  return !(standing >= 0 && standing <= matchLane_standingCeiling && target >= 0 && target <= matchLane_standingCeiling && exact_memberStanding(target - standing) <= standingWeeklyStep && exact_memberStanding(standing - target) <= standingWeeklyStep) || nextStanding(standing, target) === target;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_memberStanding(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}

/** Whole-number division as Quint does it: towards zero. */
//@ pure
export function quotient_memberStanding(a: number, b: number): number {
  //@ requires b !== 0
  if (b === 0) throw new RangeError(`${a} cannot be divided by zero`);
  return (a < 0 === b < 0 ? 1 : -1) * Math.floor(Math.abs(a) / Math.abs(b)) + 0;
}
