// GENERATED from spec/gatheringRepeatDelivery.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



/** Story: Receive a reviewed second-encounter proposal safely / A probe or initial reveal must match the reviewed opportunity and current source (spec/gatheringRepeatDelivery.md) */
//@ pure
export function gatheringRepeatContactAllowed(matchingOn: boolean, exactPair: boolean, approved: boolean, expectedLifecycle: boolean, exactMessage: boolean, sourceCurrent: boolean): boolean {
  return matchingOn && exactPair && approved && expectedLifecycle && exactMessage && sourceCurrent;
}

/** Story: Receive a reviewed second-encounter proposal safely / A probe or initial reveal must match the reviewed opportunity and current source (spec/gatheringRepeatDelivery.md) */
//@ pure
export function lawGatheringRepeatContactNeedsReview(matchingOn: boolean, exactPair: boolean, expectedLifecycle: boolean, exactMessage: boolean, sourceCurrent: boolean): boolean {
  //@ ensures \result === true
  return !gatheringRepeatContactAllowed(matchingOn, exactPair, false, expectedLifecycle, exactMessage, sourceCurrent);
}

/** Story: Receive a reviewed second-encounter proposal safely / A probe or initial reveal must match the reviewed opportunity and current source (spec/gatheringRepeatDelivery.md) */
//@ pure
export function lawGatheringRepeatContactNeedsCurrentSource(matchingOn: boolean, exactPair: boolean, approved: boolean, expectedLifecycle: boolean, exactMessage: boolean): boolean {
  //@ ensures \result === true
  return !gatheringRepeatContactAllowed(matchingOn, exactPair, approved, expectedLifecycle, exactMessage, false);
}
