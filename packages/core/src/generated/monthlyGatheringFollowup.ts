// GENERATED from spec/monthlyGatheringFollowup.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny


/** Story: Confirm attendance and choose whom to meet again / Attendance comes from an exact signed reply after the gathering (spec/monthlyGatheringFollowup.md) */
export const gatheringFollowupWindowMs: number = 604800000;

/** Story: Confirm attendance and choose whom to meet again / Attendance comes from an exact signed reply after the gathering (spec/monthlyGatheringFollowup.md) */
//@ pure
export function gatheringFollowupOpen(approved: boolean, exactRevision: boolean, forReference: boolean, startsAt: number, endsAt: number, receivedAt: number, now: number): boolean {
  return approved && exactRevision && startsAt < endsAt && (forReference ? startsAt : endsAt) <= receivedAt && receivedAt <= now && now < exact_monthlyGatheringFollowup(endsAt + gatheringFollowupWindowMs);
}

/** Story: Confirm attendance and choose whom to meet again / Attendance comes from an exact signed reply after the gathering (spec/monthlyGatheringFollowup.md) */
//@ pure
export function gatheringFollowupMayReplace(savedChoice: boolean, sameTurn: boolean, storedAt: number, receivedAt: number, savedYes: boolean, nextYes: boolean): boolean {
  return !savedChoice || (!sameTurn && (storedAt < receivedAt || (storedAt === receivedAt && savedYes && !nextYes)));
}

/** Story: Confirm attendance and choose whom to meet again / Attendance comes from an exact signed reply after the gathering (spec/monthlyGatheringFollowup.md) */
//@ pure
export function lawGatheringAttendanceWaitsForEnd(exactRevision: boolean, startsAt: number, endsAt: number, receivedAt: number, now: number): boolean {
  //@ ensures \result === true
  return !(receivedAt < endsAt) || !gatheringFollowupOpen(true, exactRevision, false, startsAt, endsAt, receivedAt, now);
}

/** Story: Confirm attendance and choose whom to meet again / Attendance comes from an exact signed reply after the gathering (spec/monthlyGatheringFollowup.md) */
//@ pure
export function lawGatheringFollowupCannotReplayMutation(storedAt: number, receivedAt: number, savedYes: boolean, nextYes: boolean): boolean {
  //@ ensures \result === true
  return !gatheringFollowupMayReplace(true, true, storedAt, receivedAt, savedYes, nextYes);
}

/** Story: Confirm attendance and choose whom to meet again / Only the member can obtain and choose to share their own reference (spec/monthlyGatheringFollowup.md) */
//@ pure
export function gatheringFollowupReferenceAllowed(currentOwner: boolean, groupingOptIn: boolean, approvedGroup: boolean): boolean {
  return currentOwner && groupingOptIn && approvedGroup;
}

/** Story: Confirm attendance and choose whom to meet again / Only the member can obtain and choose to share their own reference (spec/monthlyGatheringFollowup.md) */
//@ pure
export function lawGatheringReferenceIsOwned(groupingOptIn: boolean, approvedGroup: boolean): boolean {
  //@ ensures \result === true
  return !gatheringFollowupReferenceAllowed(false, groupingOptIn, approvedGroup);
}

/** Story: Confirm attendance and choose whom to meet again / A private follow-up choice requires two current affirmative attendance records (spec/monthlyGatheringFollowup.md) */
//@ pure
export function gatheringFollowupPairCurrent(sameGroup: boolean, distinct: boolean, pairEligible: boolean, unblocked: boolean, firstAttended: boolean, secondAttended: boolean): boolean {
  return sameGroup && distinct && pairEligible && unblocked && firstAttended && secondAttended;
}

/** Story: Confirm attendance and choose whom to meet again / A private follow-up choice requires two current affirmative attendance records (spec/monthlyGatheringFollowup.md) */
//@ pure
export function gatheringFollowupCanChoose(currentPair: boolean, ownAt: number, peerAt: number, receivedAt: number): boolean {
  return currentPair && ownAt <= receivedAt && peerAt <= receivedAt;
}

/** Story: Confirm attendance and choose whom to meet again / A private follow-up choice requires two current affirmative attendance records (spec/monthlyGatheringFollowup.md) */
//@ pure
export function gatheringFollowupMutual(currentPair: boolean, firstYes: boolean, secondYes: boolean, exactAttendance: boolean): boolean {
  return currentPair && firstYes && secondYes && exactAttendance;
}

/** Story: Confirm attendance and choose whom to meet again / A private follow-up choice requires two current affirmative attendance records (spec/monthlyGatheringFollowup.md) */
//@ pure
export function lawGatheringMutualNeedsBothChoices(currentPair: boolean, exactAttendance: boolean): boolean {
  //@ ensures \result === true
  return !gatheringFollowupMutual(currentPair, true, false, exactAttendance);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_monthlyGatheringFollowup(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
