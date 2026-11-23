// GENERATED from spec/gatheringRepeatDelivery.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



/** Story: Receive a reviewed second-encounter proposal safely / A probe or initial reveal must match the reviewed opportunity and current source (spec/gatheringRepeatDelivery.md) */
//@ pure
export function gatheringRepeatContactAllowed(rollout: boolean, exactPair: boolean, approved: boolean, expectedLifecycle: boolean, exactMessage: boolean, sourceCurrent: boolean): boolean {
  return rollout && exactPair && approved && expectedLifecycle && exactMessage && sourceCurrent;
}

/** Story: Receive a reviewed second-encounter proposal safely / A probe or initial reveal must match the reviewed opportunity and current source (spec/gatheringRepeatDelivery.md) */
//@ pure
export function lawGatheringRepeatContactNeedsReview(rollout: boolean, exactPair: boolean, expectedLifecycle: boolean, exactMessage: boolean, sourceCurrent: boolean): boolean {
  //@ ensures \result === true
  return !gatheringRepeatContactAllowed(rollout, exactPair, false, expectedLifecycle, exactMessage, sourceCurrent);
}

/** Story: Receive a reviewed second-encounter proposal safely / A probe or initial reveal must match the reviewed opportunity and current source (spec/gatheringRepeatDelivery.md) */
//@ pure
export function lawGatheringRepeatContactNeedsCurrentSource(rollout: boolean, exactPair: boolean, approved: boolean, expectedLifecycle: boolean, exactMessage: boolean): boolean {
  //@ ensures \result === true
  return !gatheringRepeatContactAllowed(rollout, exactPair, approved, expectedLifecycle, exactMessage, false);
}
