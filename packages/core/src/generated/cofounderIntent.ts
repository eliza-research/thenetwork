// GENERATED from spec/cofounderIntent.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type LaneShape as matchLane_LaneShape, type LaneSide as matchLane_LaneSide, type LaneWeights as matchLane_LaneWeights, type MatchLane as matchLane_MatchLane, type LaneLimits as matchLane_LaneLimits, standingCeiling as matchLane_standingCeiling, standingUncertaintyCeiling as matchLane_standingUncertaintyCeiling, laneWeights as matchLane_laneWeights, laneOffered as matchLane_laneOffered, lawEveryAppHasALane as matchLane_lawEveryAppHasALane, laneShape as matchLane_laneShape, laneSidesCompatible as matchLane_laneSidesCompatible, laneLimits as matchLane_laneLimits, lawLaneWeightsWellFormed as matchLane_lawLaneWeightsWellFormed, lawLaneSidesSymmetric as matchLane_lawLaneSidesSymmetric, laneOffset as matchLane_laneOffset, lawLaneLimitsWellFormed as matchLane_lawLaneLimitsWellFormed, lawLaneOffsetAntisymmetric as matchLane_lawLaneOffsetAntisymmetric, lanePairValue as matchLane_lanePairValue, lawLanePairValueSymmetric as matchLane_lawLanePairValueSymmetric } from "./matchLane.ts";
import { type StandingPresencePhase as standingIntent_StandingPresencePhase, type StandingIntentPhase as standingIntent_StandingIntentPhase, learnedIntentDays as standingIntent_learnedIntentDays, standingIntentFacetEvidence as standingIntent_standingIntentFacetEvidence, canQueueEngineOpportunity as standingIntent_canQueueEngineOpportunity, standingIntentCandidateInScope as standingIntent_standingIntentCandidateInScope, cachedStandingIntentsCurrent as standingIntent_cachedStandingIntentsCurrent, learnedIntentMayProject as standingIntent_learnedIntentMayProject, standingIntentBlocksLearnedCopy as standingIntent_standingIntentBlocksLearnedCopy, standingPresencePhase as standingIntent_standingPresencePhase, standingIntentRecheckDue as standingIntent_standingIntentRecheckDue, classifyStandingIntent as standingIntent_classifyStandingIntent, standingIntentSuppliesEvidence as standingIntent_standingIntentSuppliesEvidence, lawPausedOrClosedSuppliesNoEvidence as standingIntent_lawPausedOrClosedSuppliesNoEvidence, lawBlockingRecordPreventsLearnedProjection as standingIntent_lawBlockingRecordPreventsLearnedProjection, lawOnlyExpiredRecordLetsLearnedCopyThrough as standingIntent_lawOnlyExpiredRecordLetsLearnedCopyThrough, lawExpiredActiveRowStopsSuperseding as standingIntent_lawExpiredActiveRowStopsSuperseding, lawEndedPresenceDoesNotContribute as standingIntent_lawEndedPresenceDoesNotContribute, lawStartingTripChangesEvidence as standingIntent_lawStartingTripChangesEvidence, lawUnchangedEvidenceDoesNotRecheck as standingIntent_lawUnchangedEvidenceDoesNotRecheck, lawDeadlineEndsAnActiveIntent as standingIntent_lawDeadlineEndsAnActiveIntent } from "./standingIntent.ts";
import { type PairSide as pairValue_PairSide, type PairRules as pairValue_PairRules, type UtilityTerm as pairValue_UtilityTerm } from "./pairValue.ts";

/** Story: Meet a cofounder as an equal / A stated must-have is a hard rule for both cofounders (spec/cofounderIntent.md) */
export type CofounderCommitment = "FullTimeNow" | "PartTimeNow" | "FullTimeLater" | "CommitmentUnstated";
/** Story: Meet a cofounder as an equal / A stated must-have is a hard rule for both cofounders (spec/cofounderIntent.md) */
export type CofounderIdea = "HasIdea" | "OpenToIdea" | "IdeaEither" | "IdeaUnstated";
/** Story: Meet a cofounder as an equal / A stated must-have is a hard rule for both cofounders (spec/cofounderIntent.md) */
export type CofounderImportance = "MustHave" | "Preference" | "DoNotMind";
/** Story: Meet a cofounder as an equal / A stated must-have is a hard rule for both cofounders (spec/cofounderIntent.md) */
export type CofounderRole = "TechnicalCofounder" | "BusinessCofounder" | "BothRoles" | "RoleUnstated";
/** Story: Meet a cofounder as an equal / A stated must-have is a hard rule for both cofounders (spec/cofounderIntent.md) */
export interface CofounderFacts { role: CofounderRole; roleImportance: CofounderImportance; commitment: CofounderCommitment; commitmentImportance: CofounderImportance; idea: CofounderIdea; ideaImportance: CofounderImportance }

/** Story: Keep looking for a cofounder / Save only the current member's own affirmative goal (spec/cofounderIntent.md) */
export const cofounderIntentObjective: string = "find a cofounder";
/** Story: Keep looking for a cofounder / Save only the current member's own affirmative goal (spec/cofounderIntent.md) */
export const cofounderIntentDetails: string = "cofounder:member-confirmed";
/** Story: Meet a cofounder as an equal / A stated must-have is a hard rule for both cofounders (spec/cofounderIntent.md) */
export const unstatedCofounderFacts: CofounderFacts = { role: "RoleUnstated", roleImportance: "DoNotMind", commitment: "CommitmentUnstated", commitmentImportance: "DoNotMind", idea: "IdeaUnstated", ideaImportance: "DoNotMind" };

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

/** Story: Meet a cofounder as an equal / A stated must-have is a hard rule for both cofounders (spec/cofounderIntent.md) */
//@ pure
export function cofounderRoleWanted(mine: CofounderRole, theirs: CofounderRole): boolean {
  return theirs === "RoleUnstated" ? false : (mine === "TechnicalCofounder" ? theirs !== "TechnicalCofounder" : (mine === "BusinessCofounder" ? theirs !== "BusinessCofounder" : true));
}

/** Story: Meet a cofounder as an equal / A stated must-have is a hard rule for both cofounders (spec/cofounderIntent.md) */
//@ pure
export function cofounderCommitmentWanted(mine: CofounderCommitment, theirs: CofounderCommitment): boolean {
  return theirs !== "CommitmentUnstated" && (mine === "CommitmentUnstated" || theirs === mine);
}

/** Story: Meet a cofounder as an equal / A stated must-have is a hard rule for both cofounders (spec/cofounderIntent.md) */
//@ pure
export function cofounderIdeaWanted(mine: CofounderIdea, theirs: CofounderIdea): boolean {
  return theirs === "IdeaUnstated" ? false : (mine === "HasIdea" ? theirs !== "HasIdea" : (mine === "OpenToIdea" ? theirs !== "OpenToIdea" : true));
}

/** Story: Meet a cofounder as an equal / A stated must-have is a hard rule for both cofounders (spec/cofounderIntent.md) */
//@ pure
export function cofounderMustsMet(m: CofounderFacts, other: CofounderFacts): boolean {
  return (m.roleImportance !== "MustHave" || cofounderRoleWanted(m.role, other.role)) && (m.commitmentImportance !== "MustHave" || cofounderCommitmentWanted(m.commitment, other.commitment)) && (m.ideaImportance !== "MustHave" || cofounderIdeaWanted(m.idea, other.idea));
}

/** Story: Meet a cofounder as an equal / A stated must-have is a hard rule for both cofounders (spec/cofounderIntent.md) */
//@ pure
export function cofounderFactsFit(left: CofounderFacts, right: CofounderFacts): boolean {
  return cofounderMustsMet(left, right) && cofounderMustsMet(right, left);
}

/** Story: Meet a cofounder as an equal / A stated must-have is a hard rule for both cofounders (spec/cofounderIntent.md) */
//@ pure
export function lawCofounderFitIsSymmetric(left: CofounderFacts, right: CofounderFacts): boolean {
  //@ ensures \result === true
  return cofounderFactsFit(left, right) === cofounderFactsFit(right, left);
}

/** Story: Meet a cofounder as an equal / A stated must-have is a hard rule for both cofounders (spec/cofounderIntent.md) */
//@ pure
export function lawSameRoleFailsARoleMustHave(left: CofounderFacts, right: CofounderFacts): boolean {
  //@ ensures \result === true
  return !(left.roleImportance === "MustHave" && left.role === right.role && left.role !== "BothRoles") || !cofounderFactsFit(left, right);
}

/** Story: Meet a cofounder as an equal / A stated must-have is a hard rule for both cofounders (spec/cofounderIntent.md) */
//@ pure
export function lawUnstatedNeverMeetsAMustHave(left: CofounderFacts, right: CofounderFacts): boolean {
  //@ ensures \result === true
  return !((left.roleImportance === "MustHave" && right.role === "RoleUnstated") || (left.commitmentImportance === "MustHave" && right.commitment === "CommitmentUnstated") || (left.ideaImportance === "MustHave" && right.idea === "IdeaUnstated")) || !cofounderFactsFit(left, right);
}

/** Story: Meet a cofounder as an equal / A stated must-have is a hard rule for both cofounders (spec/cofounderIntent.md) */
//@ pure
export function lawPreferencesNeverRefuse(left: CofounderFacts, right: CofounderFacts): boolean {
  //@ ensures \result === true
  return !(left.roleImportance !== "MustHave" && left.commitmentImportance !== "MustHave" && left.ideaImportance !== "MustHave" && right.roleImportance !== "MustHave" && right.commitmentImportance !== "MustHave" && right.ideaImportance !== "MustHave") || cofounderFactsFit(left, right);
}
