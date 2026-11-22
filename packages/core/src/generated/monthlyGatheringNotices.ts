// GENERATED from spec/monthlyGatheringNotices.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Hear about a gathering I reserved and say whether I attended / Each notice needs the exact current RSVP and its own send window (spec/monthlyGatheringNotices.md) */
export type GatheringNoticeKind = "GatheringDayBefore" | "GatheringNearStart" | "GatheringAttendancePrompt";

/** Story: Hear about a gathering I reserved and say whether I attended / Each notice needs the exact current RSVP and its own send window (spec/monthlyGatheringNotices.md) */
export const monthlyGatheringNoticePrefix: string = "monthly-gathering-notice:";
/** Story: Hear about a gathering I reserved and say whether I attended / Each notice needs the exact current RSVP and its own send window (spec/monthlyGatheringNotices.md) */
export const gatheringAttendancePromptDelayMs: number = 3600000;
/** Story: Hear about a gathering I reserved and say whether I attended / Each notice needs the exact current RSVP and its own send window (spec/monthlyGatheringNotices.md) */
export const gatheringAttendancePromptLimitMs: number = exact_monthlyGatheringNotices(24 * 3600000);

/** Story: Hear about a gathering I reserved and say whether I attended / Each notice needs the exact current RSVP and its own send window (spec/monthlyGatheringNotices.md) */
//@ pure
export function gatheringNoticeWindow(kind: GatheringNoticeKind, reminderWindow: boolean, sinceEnd: number): boolean {
  return kind === "GatheringAttendancePrompt" ? gatheringAttendancePromptDelayMs <= sinceEnd && sinceEnd < gatheringAttendancePromptLimitMs : reminderWindow;
}

/** Story: Hear about a gathering I reserved and say whether I attended / Each notice needs the exact current RSVP and its own send window (spec/monthlyGatheringNotices.md) */
//@ pure
export function gatheringNoticeAllowed(rollout: boolean, exactApproval: boolean, currentRsvp: boolean, currentRecipient: boolean, insideWindow: boolean, currentVenue: boolean, hasAttendanceAnswer: boolean, kind: GatheringNoticeKind): boolean {
  return rollout && exactApproval && currentRsvp && currentRecipient && insideWindow && (kind === "GatheringAttendancePrompt" ? !hasAttendanceAnswer : currentVenue);
}

/** Story: Hear about a gathering I reserved and say whether I attended / Each notice needs the exact current RSVP and its own send window (spec/monthlyGatheringNotices.md) */
//@ pure
export function lawGatheringNoticeNeverFollowsWithdrawal(rollout: boolean, exactApproval: boolean, currentRecipient: boolean, insideWindow: boolean, currentVenue: boolean, hasAttendanceAnswer: boolean, kind: GatheringNoticeKind): boolean {
  //@ ensures \result === true
  return !gatheringNoticeAllowed(rollout, exactApproval, false, currentRecipient, insideWindow, currentVenue, hasAttendanceAnswer, kind);
}

/** Story: Hear about a gathering I reserved and say whether I attended / The queue always verifies the exact notice and its current authority (spec/monthlyGatheringNotices.md) */
//@ pure
export function gatheringNoticeMayClaim(authorityCurrent: boolean, exactPayload: boolean, matchingMessage: boolean): boolean {
  return authorityCurrent && exactPayload && matchingMessage;
}

/** Story: Hear about a gathering I reserved and say whether I attended / The queue always verifies the exact notice and its current authority (spec/monthlyGatheringNotices.md) */
//@ pure
export function lawGatheringNoticeCannotClaimChangedPayload(authorityCurrent: boolean, matchingMessage: boolean): boolean {
  //@ ensures \result === true
  return !gatheringNoticeMayClaim(authorityCurrent, false, matchingMessage);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_monthlyGatheringNotices(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
