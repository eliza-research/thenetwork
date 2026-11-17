// GENERATED from spec/cofounderIntent.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type LaneShape as matchLane_LaneShape, type LaneSide as matchLane_LaneSide, type LaneWeights as matchLane_LaneWeights, type MatchLane as matchLane_MatchLane, type LaneLimits as matchLane_LaneLimits, standingCeiling as matchLane_standingCeiling, standingUncertaintyCeiling as matchLane_standingUncertaintyCeiling, laneWeights as matchLane_laneWeights, laneOffered as matchLane_laneOffered, lawEveryAppHasALane as matchLane_lawEveryAppHasALane, laneShape as matchLane_laneShape, laneSidesCompatible as matchLane_laneSidesCompatible, laneLimits as matchLane_laneLimits, lawLaneWeightsWellFormed as matchLane_lawLaneWeightsWellFormed, lawLaneSidesSymmetric as matchLane_lawLaneSidesSymmetric, laneOffset as matchLane_laneOffset, lawLaneLimitsWellFormed as matchLane_lawLaneLimitsWellFormed, lawLaneOffsetAntisymmetric as matchLane_lawLaneOffsetAntisymmetric, lanePairValue as matchLane_lanePairValue, lawLanePairValueSymmetric as matchLane_lawLanePairValueSymmetric } from "./matchLane.ts";
import { type StandingPresencePhase as standingIntent_StandingPresencePhase, type StandingIntentPhase as standingIntent_StandingIntentPhase, learnedIntentDays as standingIntent_learnedIntentDays, standingIntentFacetEvidence as standingIntent_standingIntentFacetEvidence, canQueueEngineOpportunity as standingIntent_canQueueEngineOpportunity, standingIntentCandidateInScope as standingIntent_standingIntentCandidateInScope, cachedStandingIntentsCurrent as standingIntent_cachedStandingIntentsCurrent, standingIntentBlocksLearnedCopy as standingIntent_standingIntentBlocksLearnedCopy, standingPresencePhase as standingIntent_standingPresencePhase, standingIntentRecheckDue as standingIntent_standingIntentRecheckDue, classifyStandingIntent as standingIntent_classifyStandingIntent, learnedIntentMayProject as standingIntent_learnedIntentMayProject, lawBlockingRecordPreventsLearnedProjection as standingIntent_lawBlockingRecordPreventsLearnedProjection, lawEndedPresenceDoesNotContribute as standingIntent_lawEndedPresenceDoesNotContribute, lawStartingTripChangesEvidence as standingIntent_lawStartingTripChangesEvidence, lawUnchangedEvidenceDoesNotRecheck as standingIntent_lawUnchangedEvidenceDoesNotRecheck, lawDeadlineEndsAnActiveIntent as standingIntent_lawDeadlineEndsAnActiveIntent } from "./standingIntent.ts";
import { type PairSide as pairValue_PairSide, type PairRules as pairValue_PairRules, type UtilityTerm as pairValue_UtilityTerm } from "./pairValue.ts";


/** Story: Keep looking for a cofounder / Save only the current member's own affirmative goal (spec/cofounderIntent.md) */
export const cofounderIntentObjective: string = "find a cofounder";
/** Story: Keep looking for a cofounder / Save only the current member's own affirmative goal (spec/cofounderIntent.md) */
export const cofounderIntentDetails: string = "cofounder:member-confirmed";

/** Story: Keep looking for a cofounder / Save only the current member's own affirmative goal (spec/cofounderIntent.md) */
//@ pure
export function canSaveCofounderIntent(app: string, signedDirect: boolean, affirmative: boolean, currentAdultMember: boolean): boolean {
  return matchLane_laneOffered(app, "Cofounder") && signedDirect && affirmative && currentAdultMember;
}

/** Story: Keep looking for a cofounder / Save only the current member's own affirmative goal (spec/cofounderIntent.md) */
//@ pure
export function lawUnsignedTurnCannotSetCofounderIntent(app: string, affirmative: boolean, currentAdultMember: boolean): boolean {
  //@ ensures \result === true
  return !canSaveCofounderIntent(app, false, affirmative, currentAdultMember);
}

/** Story: Keep looking for a cofounder / Save only the current member's own affirmative goal (spec/cofounderIntent.md) */
//@ pure
export function lawCofounderIntentNeedsOwnAffirmation(app: string, signedDirect: boolean, currentAdultMember: boolean): boolean {
  //@ ensures \result === true
  return !canSaveCofounderIntent(app, signedDirect, false, currentAdultMember);
}

/** Story: Keep looking for a cofounder / A repeated statement preserves a live or paused goal (spec/cofounderIntent.md) */
//@ pure
export function cofounderIntentBlocksNew(phase: standingIntent_StandingIntentPhase): boolean {
  return phase === "IntentLive" || phase === "IntentPaused";
}

/** Story: Keep looking for a cofounder / A repeated statement preserves a live or paused goal (spec/cofounderIntent.md) */
//@ pure
export function lawClosedCofounderIntentCanBeReplaced(phase: standingIntent_StandingIntentPhase): boolean {
  //@ ensures \result === true
  return phase !== "IntentClosed" || !cofounderIntentBlocksNew(phase);
}
