// GENERATED from spec/cofounderDispatch.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type CofounderCommitment as cofounderIntent_CofounderCommitment, type CofounderIdea as cofounderIntent_CofounderIdea, type CofounderImportance as cofounderIntent_CofounderImportance, type CofounderRole as cofounderIntent_CofounderRole, type CofounderFacts as cofounderIntent_CofounderFacts, cofounderIntentObjective as cofounderIntent_cofounderIntentObjective, cofounderIntentDetails as cofounderIntent_cofounderIntentDetails, cofounderRoleWanted as cofounderIntent_cofounderRoleWanted, cofounderCommitmentWanted as cofounderIntent_cofounderCommitmentWanted, cofounderIdeaWanted as cofounderIntent_cofounderIdeaWanted, canSaveCofounderIntent as cofounderIntent_canSaveCofounderIntent, unstatedCofounderFacts as cofounderIntent_unstatedCofounderFacts, cofounderIntentBlocksNew as cofounderIntent_cofounderIntentBlocksNew, cofounderMustsMet as cofounderIntent_cofounderMustsMet, lawUnsignedTurnCannotSetCofounderIntent as cofounderIntent_lawUnsignedTurnCannotSetCofounderIntent, lawCofounderIntentNeedsOwnAffirmation as cofounderIntent_lawCofounderIntentNeedsOwnAffirmation, lawClosedCofounderIntentCanBeReplaced as cofounderIntent_lawClosedCofounderIntentCanBeReplaced, cofounderFactsFit as cofounderIntent_cofounderFactsFit, lawCofounderFitIsSymmetric as cofounderIntent_lawCofounderFitIsSymmetric, lawSameRoleFailsARoleMustHave as cofounderIntent_lawSameRoleFailsARoleMustHave, lawUnstatedNeverMeetsAMustHave as cofounderIntent_lawUnstatedNeverMeetsAMustHave, lawPreferencesNeverRefuse as cofounderIntent_lawPreferencesNeverRefuse } from "./cofounderIntent.ts";
import { type LaneShape as matchLane_LaneShape, type LaneSide as matchLane_LaneSide, type LaneWeights as matchLane_LaneWeights, type MatchLane as matchLane_MatchLane, type LaneLimits as matchLane_LaneLimits } from "./matchLane.ts";
import { type PairSide as pairValue_PairSide, type PairRules as pairValue_PairRules, type UtilityTerm as pairValue_UtilityTerm } from "./pairValue.ts";
import { type StandingPresencePhase as standingIntent_StandingPresencePhase, type StandingIntentPhase as standingIntent_StandingIntentPhase } from "./standingIntent.ts";


/** Story: Both peers still want a cofounder / A review, probe and reveal require both exact intents (spec/cofounderDispatch.md) */
export const cofounderDeliveryIdPrefix: string = "cofounder-intro:";
/** Story: Both peers still want a cofounder / Exact current consent belongs to the same app (spec/cofounderDispatch.md) */
export const cofounderConsentMarker: string = cofounderIntent_cofounderIntentDetails;

/** Story: Both peers still want a cofounder / Exact current consent belongs to the same app (spec/cofounderDispatch.md) */
//@ pure
export function cofounderBoundIntentCurrent(sameIntentId: boolean, intentEligible: boolean): boolean {
  return sameIntentId && intentEligible;
}

/** Story: Both peers still want a cofounder / Exact current consent belongs to the same app (spec/cofounderDispatch.md) */
//@ pure
export function cofounderIntentEligible(app: string, expectedApp: string, category: string, details: string, intentLive: boolean): boolean {
  return (expectedApp === "ntwrk" || expectedApp === "peon") && app === expectedApp && category === "professional" && details === cofounderConsentMarker && intentLive;
}

/** Story: Both peers still want a cofounder / Exact current consent belongs to the same app (spec/cofounderDispatch.md) */
//@ pure
export function lawCofounderOtherIntentIdNeverCurrent(app: string, expectedApp: string, category: string, details: string, intentLive: boolean): boolean {
  //@ ensures \result === true
  return !cofounderBoundIntentCurrent(false, cofounderIntentEligible(app, expectedApp, category, details, intentLive));
}

/** Story: Both peers still want a cofounder / Exact current consent belongs to the same app (spec/cofounderDispatch.md) */
//@ pure
export function lawCofounderIntentRejectsAnotherApp(app: string, expectedApp: string, category: string, details: string, intentLive: boolean): boolean {
  //@ ensures \result === true
  return app === expectedApp || !cofounderIntentEligible(app, expectedApp, category, details, intentLive);
}

/** Story: Both peers still want a cofounder / Exact current consent belongs to the same app (spec/cofounderDispatch.md) */
//@ pure
export function lawCofounderIntentRejectsInactive(app: string, expectedApp: string, category: string, details: string): boolean {
  //@ ensures \result === true
  return !cofounderIntentEligible(app, expectedApp, category, details, false);
}

/** Story: Both peers still want a cofounder / A review, probe and reveal require both exact intents (spec/cofounderDispatch.md) */
//@ pure
export function cofounderPairCurrent(distinctPeers: boolean, firstIntent: boolean, secondIntent: boolean, peersEligible: boolean): boolean {
  return distinctPeers && firstIntent && secondIntent && peersEligible;
}

/** Story: Both peers still want a cofounder / A review, probe and reveal require both exact intents (spec/cofounderDispatch.md) */
//@ pure
export function cofounderDeliveryAllowed(pairCurrent: boolean, reviewed: boolean, revealing: boolean, bothAccepted: boolean): boolean {
  return pairCurrent && reviewed && (!revealing || bothAccepted);
}

/** Story: Both peers still want a cofounder / A review, probe and reveal require both exact intents (spec/cofounderDispatch.md) */
//@ pure
export function lawCofounderDeliveryNeedsReview(pairCurrent: boolean, revealing: boolean, bothAccepted: boolean): boolean {
  //@ ensures \result === true
  return !cofounderDeliveryAllowed(pairCurrent, false, revealing, bothAccepted);
}

/** Story: Both peers still want a cofounder / A review, probe and reveal require both exact intents (spec/cofounderDispatch.md) */
//@ pure
export function lawCofounderRevealNeedsBoth(pairCurrent: boolean, reviewed: boolean): boolean {
  //@ ensures \result === true
  return !cofounderDeliveryAllowed(pairCurrent, reviewed, true, false);
}
