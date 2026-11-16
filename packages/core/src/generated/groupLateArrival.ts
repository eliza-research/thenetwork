// GENERATED from spec/groupLateArrival.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny


/** Story: Tell my group I am running late / Relay one direct report for one current booked group (spec/groupLateArrival.md) */
export const lateArrivalMinimumRoster: number = 3;
/** Story: Tell my group I am running late / Relay one direct report for one current booked group (spec/groupLateArrival.md) */
export const lateArrivalDeliveryPrefix: string = "group-late:";
/** Story: Tell my group I am running late / Relay one direct report for one current booked group (spec/groupLateArrival.md) */
export const lateArrivalNotice: string = "Someone in your group is running late.";
/** Story: Tell my group I am running late / Relay one direct report for one current booked group (spec/groupLateArrival.md) */
export const lateArrivalLeadMs: number = exact_groupLateArrival(60 * 60000);
/** Story: Tell my group I am running late / Relay one direct report for one current booked group (spec/groupLateArrival.md) */
export const lateArrivalGraceMs: number = exact_groupLateArrival(30 * 60000);

/** Story: Tell my group I am running late / Relay one direct report for one current booked group (spec/groupLateArrival.md) */
//@ pure
export function lateArrivalWindow(untilStart: number): boolean {
  return untilStart <= lateArrivalLeadMs && untilStart > exact_groupLateArrival(0 - lateArrivalGraceMs);
}

/** Story: Tell my group I am running late / Relay one direct report for one current booked group (spec/groupLateArrival.md) */
//@ pure
export function lateArrivalMayReport(signedDirect: boolean, exactReport: boolean, eligibleFrom: boolean, matchingGroups: number, alreadyReported: boolean): boolean {
  return signedDirect && exactReport && eligibleFrom && matchingGroups === 1 && !alreadyReported;
}

/** Story: Tell my group I am running late / Relay one direct report for one current booked group (spec/groupLateArrival.md) */
//@ pure
export function lawLateArrivalNeedsOneGroup(signedDirect: boolean, exactReport: boolean, eligibleFrom: boolean, matchingGroups: number): boolean {
  //@ ensures \result === true
  return !lateArrivalMayReport(signedDirect, exactReport, eligibleFrom, matchingGroups, false) || matchingGroups === 1;
}

/** Story: Tell my group I am running late / Relay one direct report for one current booked group (spec/groupLateArrival.md) */
//@ pure
export function lateArrivalGroupCurrent(scheduled: boolean, reviewed: boolean, logistics: boolean, bookedFrom: boolean, bookedCount: number, untilStart: number): boolean {
  return scheduled && reviewed && logistics && bookedFrom && bookedCount >= lateArrivalMinimumRoster && lateArrivalWindow(untilStart);
}

/** Story: Tell my group I am running late / Send only the fixed notice to each eligible booked recipient (spec/groupLateArrival.md) */
//@ pure
export function lateArrivalMayDispatch(currentGroup: boolean, exactReport: boolean, exactMessage: boolean, bookedRecipient: boolean, differentRecipient: boolean, pairAllowed: boolean): boolean {
  return currentGroup && exactReport && exactMessage && bookedRecipient && differentRecipient && pairAllowed;
}

/** Story: Tell my group I am running late / Send only the fixed notice to each eligible booked recipient (spec/groupLateArrival.md) */
//@ pure
export function lawLateArrivalNeverEchoes(currentGroup: boolean, exactReport: boolean, exactMessage: boolean, bookedRecipient: boolean, pairAllowed: boolean): boolean {
  //@ ensures \result === true
  return !lateArrivalMayDispatch(currentGroup, exactReport, exactMessage, bookedRecipient, false, pairAllowed);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_groupLateArrival(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
