// GENERATED from spec/gatheringRepeat.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny


/** Story: Offer a private reviewed follow-up after mutual gathering interest / A current exact mutual choice can enter review once per gathering pair (spec/gatheringRepeat.md) */
export const gatheringRepeatOppPrefix: string = "gathering-repeat:";

/** Story: Offer a private reviewed follow-up after mutual gathering interest / A current exact mutual choice can enter review once per gathering pair (spec/gatheringRepeat.md) */
//@ pure
export function gatheringRepeatSourceMatches(sameGathering: boolean, sameRevision: boolean, sameGroupReview: boolean, samePair: boolean, sameConsentVersion: boolean): boolean {
  return sameGathering && sameRevision && sameGroupReview && samePair && sameConsentVersion;
}

/** Story: Offer a private reviewed follow-up after mutual gathering interest / A current exact mutual choice can enter review once per gathering pair (spec/gatheringRepeat.md) */
//@ pure
export function gatheringRepeatMayStage(rolloutEnabled: boolean, currentSource: boolean, pairPermitted: boolean, alreadyOffered: boolean): boolean {
  return rolloutEnabled && currentSource && pairPermitted && !alreadyOffered;
}

/** Story: Offer a private reviewed follow-up after mutual gathering interest / A current exact mutual choice can enter review once per gathering pair (spec/gatheringRepeat.md) */
//@ pure
export function lawGatheringRepeatRejectsChangedConsent(sameGathering: boolean, sameRevision: boolean, sameGroupReview: boolean, samePair: boolean): boolean {
  //@ ensures \result === true
  return !gatheringRepeatSourceMatches(sameGathering, sameRevision, sameGroupReview, samePair, false);
}

/** Story: Offer a private reviewed follow-up after mutual gathering interest / A current exact mutual choice can enter review once per gathering pair (spec/gatheringRepeat.md) */
//@ pure
export function lawGatheringRepeatStagesOnce(rolloutEnabled: boolean, currentSource: boolean, pairPermitted: boolean): boolean {
  //@ ensures \result === true
  return !gatheringRepeatMayStage(rolloutEnabled, currentSource, pairPermitted, true);
}

/** Story: Offer a private reviewed follow-up after mutual gathering interest / Review and each new reply are separate from the earlier mutual choice (spec/gatheringRepeat.md) */
//@ pure
export function gatheringRepeatMayBook(currentSource: boolean, approved: boolean, firstNewYes: boolean, secondNewYes: boolean): boolean {
  return currentSource && approved && firstNewYes && secondNewYes;
}

/** Story: Offer a private reviewed follow-up after mutual gathering interest / Review and each new reply are separate from the earlier mutual choice (spec/gatheringRepeat.md) */
//@ pure
export function gatheringRepeatMayAnswer(currentSource: boolean, directMember: boolean, delivered: boolean, answerAt: number, deliveredAt: number): boolean {
  return currentSource && directMember && delivered && deliveredAt <= answerAt;
}

/** Story: Offer a private reviewed follow-up after mutual gathering interest / Review and each new reply are separate from the earlier mutual choice (spec/gatheringRepeat.md) */
//@ pure
export function lawGatheringRepeatNeedDeliveredProbe(currentSource: boolean, directMember: boolean, answerAt: number, deliveredAt: number): boolean {
  //@ ensures \result === true
  return !gatheringRepeatMayAnswer(currentSource, directMember, false, answerAt, deliveredAt);
}

/** Story: Offer a private reviewed follow-up after mutual gathering interest / Review and each new reply are separate from the earlier mutual choice (spec/gatheringRepeat.md) */
//@ pure
export function lawGatheringRepeatNeedsSeparateConsent(currentSource: boolean, approved: boolean, firstNewYes: boolean): boolean {
  //@ ensures \result === true
  return !gatheringRepeatMayBook(currentSource, approved, firstNewYes, false);
}
