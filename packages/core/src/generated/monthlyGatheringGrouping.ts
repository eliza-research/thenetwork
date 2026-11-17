// GENERATED from spec/monthlyGatheringGrouping.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny


/** Story: Review suggested conversation groupings for the monthly gathering / Each suggested group has three to five current willing adults (spec/monthlyGatheringGrouping.md) */
export const gatheringGroupingMinimum: number = 3;
/** Story: Review suggested conversation groupings for the monthly gathering / Each suggested group has three to five current willing adults (spec/monthlyGatheringGrouping.md) */
export const gatheringGroupingMaximum: number = 5;

/** Story: Review suggested conversation groupings for the monthly gathering / Each suggested group has three to five current willing adults (spec/monthlyGatheringGrouping.md) */
//@ pure
export function gatheringGroupingSizeAllowed(seatCount: number): boolean {
  return gatheringGroupingMinimum <= seatCount && seatCount <= gatheringGroupingMaximum;
}

/** Story: Review suggested conversation groupings for the monthly gathering / Each suggested group has three to five current willing adults (spec/monthlyGatheringGrouping.md) */
//@ pure
export function gatheringGroupingCanSeat(eligible: boolean, compatible: boolean, assigned: boolean, seatCount: number): boolean {
  return eligible && compatible && !assigned && 0 <= seatCount && seatCount < gatheringGroupingMaximum;
}

/** Story: Review suggested conversation groupings for the monthly gathering / Each suggested group has three to five current willing adults (spec/monthlyGatheringGrouping.md) */
//@ pure
export function lawGatheringGroupingCannotSeatBlocked(eligible: boolean, assigned: boolean, seatCount: number): boolean {
  //@ ensures \result === true
  return !gatheringGroupingCanSeat(eligible, false, assigned, seatCount);
}

/** Story: Review suggested conversation groupings for the monthly gathering / Each suggested group has three to five current willing adults (spec/monthlyGatheringGrouping.md) */
//@ pure
export function lawGatheringGroupingCannotSeatTwice(eligible: boolean, compatible: boolean, seatCount: number): boolean {
  //@ ensures \result === true
  return !gatheringGroupingCanSeat(eligible, compatible, true, seatCount);
}

/** Story: Review suggested conversation groupings for the monthly gathering / Human approval binds the exact current nonempty suggestion for one gathering revision (spec/monthlyGatheringGrouping.md) */
//@ pure
export function gatheringGroupingApprovalCurrent(recorded: boolean, exactFingerprint: boolean, complete: boolean): boolean {
  return recorded && exactFingerprint && complete;
}

/** Story: Review suggested conversation groupings for the monthly gathering / Human approval binds the exact current nonempty suggestion for one gathering revision (spec/monthlyGatheringGrouping.md) */
//@ pure
export function gatheringGroupingReviewAllowed(currentGathering: boolean, beforeStart: boolean, exactFingerprint: boolean, nonempty: boolean): boolean {
  return currentGathering && beforeStart && exactFingerprint && nonempty;
}

/** Story: Review suggested conversation groupings for the monthly gathering / Human approval binds the exact current nonempty suggestion for one gathering revision (spec/monthlyGatheringGrouping.md) */
//@ pure
export function lawGatheringGroupingRejectsStaleFingerprint(currentGathering: boolean, beforeStart: boolean, nonempty: boolean): boolean {
  //@ ensures \result === true
  return !gatheringGroupingReviewAllowed(currentGathering, beforeStart, false, nonempty);
}
