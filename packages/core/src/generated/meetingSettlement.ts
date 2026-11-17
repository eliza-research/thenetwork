// GENERATED from spec/meetingSettlement.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Confirm a booked meeting after the details arrive / Confirmation needs an accepted invitation and a delivered booking (spec/meetingSettlement.md) */
export interface ConfirmationChanges { recordWords: boolean; emitConfirmation: boolean }
/** Story: Hear about a booked meeting the day before / Claim a reminder only after the member received the current booking notice (spec/meetingSettlement.md) */
export type ReminderClaim = "SendReminder" | "WaitForBookingNotice" | "RefuseReminder";
/** Story: Hear about a booked meeting the day before / Claim a cancellation only for a member who received booking details (spec/meetingSettlement.md) */
export type BookedCancellationClaim = "SendCancellation" | "WaitForCancellationReceipt" | "RefuseCancellation";
/** Story: Ask for feedback and close attendance once / A feedback request opens the attendance period (spec/meetingSettlement.md) */
export type SettlementPhase = "BeforeFeedback" | "AwaitingAttendance" | "SettlementComplete";
/** Story: Ask for feedback and close attendance once / A feedback request opens the attendance period (spec/meetingSettlement.md) */
export interface MeetingSettlement { phase: SettlementPhase }
/** Story: Ask for feedback and close attendance once / Classify each attendee from the available reports (spec/meetingSettlement.md) */
export type AttendanceMark = "Attended" | "Absent" | "Ghosted" | "NoFinding";
/** Story: Ask for feedback and close attendance once / Classify each attendee from the available reports (spec/meetingSettlement.md) */
export interface AttendanceEvidence { saidAttended: boolean; saidAbsent: boolean; hasFeedback: boolean; counterpartVerified: boolean; organizerVerified: boolean; pairMeeting: boolean; reportedMissing: boolean; explicitReply: boolean }
/** Story: Ask for feedback and close attendance once / Classify each attendee from the available reports (spec/meetingSettlement.md) */
export interface AttendanceFinding { mark: AttendanceMark; logFeedback: boolean; reliabilityNoShow: boolean }
/** Story: Ask for feedback and close attendance once / A host's check-in uses the host's response (spec/meetingSettlement.md) */
export type CheckInSource = "NoCheckIn" | "MissingNames" | "PresentNames" | "BookedParticipants";

/** One variant per transition in the spec. */
export type Event =
  | { type: "requestFeedback"; unsent: boolean; asOf: number; feedbackAt: number }
  | { type: "resolveAttendance"; timedOut: boolean; everyoneResponded: boolean };

/** Story: Hear about a booked meeting the day before / Claim a reminder only after the member received the current booking notice (spec/meetingSettlement.md) */
export const bookingNoticeRetryMs: number = exact_meetingSettlement(5 * 60000);
/** Story: Confirm a booked meeting after the details arrive / Confirmation needs an accepted invitation and a delivered booking (spec/meetingSettlement.md) */
export const confirmationWindowHours: number = 48;
/** Story: Ask for feedback and close attendance once / A feedback request opens the attendance period (spec/meetingSettlement.md) */
export const feedbackDelayHours: number = 3;
/** Story: Ask for feedback and close attendance once / A feedback request opens the attendance period (spec/meetingSettlement.md) */
export const settlementDelayDays: number = 4;
/** Story: Hear about a booked meeting the day before / A day-before reminder has its own send window (spec/meetingSettlement.md) */
export const dayBeforeReminderStartMs: number = exact_meetingSettlement(24 * 3600000);
/** Story: Hear about a booked meeting the day before / A day-before reminder has its own send window (spec/meetingSettlement.md) */
export const dayBeforeReminderEndMs: number = exact_meetingSettlement(12 * 3600000);
/** Story: Hear about a booked meeting the day before / A day-before reminder has its own send window (spec/meetingSettlement.md) */
export const nearMeetingReminderLeadMs: number = exact_meetingSettlement(3 * 3600000);
/** Story: Confirm a booked meeting after the details arrive / Confirmation needs an accepted invitation and a delivered booking (spec/meetingSettlement.md) */
export const confirmationWindowMs: number = exact_meetingSettlement(confirmationWindowHours * 3600000);
/** Story: Ask for feedback and close attendance once / A feedback request opens the attendance period (spec/meetingSettlement.md) */
export const initial: MeetingSettlement = { phase: "BeforeFeedback" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: MeetingSettlement): boolean {
  return true;
}

/** Story: Confirm a booked meeting after the details arrive / Confirmation needs an accepted invitation and a delivered booking (spec/meetingSettlement.md) */
//@ pure
export function confirmationChanges(accepted: boolean, bookingDelivered: boolean, wordsRecorded: boolean, confirmed: boolean, explicitReply: boolean): ConfirmationChanges {
  const local_0 = accepted && bookingDelivered;
  return { recordWords: local_0 && explicitReply && !wordsRecorded, emitConfirmation: local_0 && !confirmed };
}

/** Story: Confirm a booked meeting after the details arrive / Confirmation needs an accepted invitation and a delivered booking (spec/meetingSettlement.md) */
//@ pure
export function silentConfirmationDue(accepted: boolean, bookingDelivered: boolean, confirmed: boolean, elapsedMs: number, meetingStarted: boolean): boolean {
  return accepted && bookingDelivered && !confirmed && (elapsedMs >= confirmationWindowMs || meetingStarted);
}

/** Story: Confirm a booked meeting after the details arrive / Confirmation needs an accepted invitation and a delivered booking (spec/meetingSettlement.md) */
//@ pure
export function lawConfirmedDoesNotRepeat(accepted: boolean, bookingDelivered: boolean, wordsRecorded: boolean, explicitReply: boolean): boolean {
  //@ ensures \result === true
  return !confirmationChanges(accepted, bookingDelivered, wordsRecorded, true, explicitReply).emitConfirmation;
}

/** Story: Hear about a booked meeting the day before / A day-before reminder has its own send window (spec/meetingSettlement.md) */
//@ pure
export function dayBeforeReminderWindow(remainingMs: number): boolean {
  return remainingMs <= dayBeforeReminderStartMs && remainingMs > dayBeforeReminderEndMs;
}

/** Story: Hear about a booked meeting the day before / A day-before reminder has its own send window (spec/meetingSettlement.md) */
//@ pure
export function nearMeetingReminderWindow(remainingMs: number): boolean {
  return remainingMs > 0 && remainingMs <= dayBeforeReminderEndMs;
}

/** Story: Hear about a booked meeting the day before / A day-before reminder has its own send window (spec/meetingSettlement.md) */
//@ pure
export function dayBeforeReminderDue(accepted: boolean, bookingDelivered: boolean, earlySent: boolean, remainingMs: number): boolean {
  return accepted && bookingDelivered && !earlySent && dayBeforeReminderWindow(remainingMs);
}

/** Story: Hear about a booked meeting the day before / A day-before reminder has its own send window (spec/meetingSettlement.md) */
//@ pure
export function lawDayBeforeReminderFollowsBooking(accepted: boolean, earlySent: boolean, remainingMs: number): boolean {
  //@ ensures \result === true
  return !dayBeforeReminderDue(accepted, false, earlySent, remainingMs);
}

/** Story: Hear about a booked meeting the day before / A day-before reminder has its own send window (spec/meetingSettlement.md) */
//@ pure
export function lawDayBeforeReminderDoesNotRepeat(accepted: boolean, bookingDelivered: boolean, remainingMs: number): boolean {
  //@ ensures \result === true
  return !dayBeforeReminderDue(accepted, bookingDelivered, true, remainingMs);
}

/** Story: Hear about a booked meeting the day before / Claim a reminder only after the member received the current booking notice (spec/meetingSettlement.md) */
//@ pure
export function bookingNoticeReceived(receiptStatus: string, sentAt: number, checkedAt: number): boolean {
  return (receiptStatus === "accepted" || receiptStatus === "sent" || receiptStatus === "delivered" || receiptStatus === "read") && 0 <= sentAt && sentAt <= checkedAt;
}

/** Story: Hear about a booked meeting the day before / Claim a reminder only after the member received the current booking notice (spec/meetingSettlement.md) */
//@ pure
export function queuedReminderClaim(bookingCurrent: boolean, noticeAccepted: boolean, noticePending: boolean): ReminderClaim {
  return !bookingCurrent ? "RefuseReminder" : (noticeAccepted ? "SendReminder" : (noticePending ? "WaitForBookingNotice" : "RefuseReminder"));
}

/** Story: Hear about a booked meeting the day before / Claim a reminder only after the member received the current booking notice (spec/meetingSettlement.md) */
//@ pure
export function lawFutureBookingReceiptIsNotEvidence(receiptStatus: string, sentAt: number, checkedAt: number): boolean {
  //@ ensures \result === true
  return !(sentAt > checkedAt) || !bookingNoticeReceived(receiptStatus, sentAt, checkedAt);
}

/** Story: Hear about a booked meeting the day before / Claim a reminder only after the member received the current booking notice (spec/meetingSettlement.md) */
//@ pure
export function lawReminderClaimNeedsNotice(bookingCurrent: boolean, noticePending: boolean): boolean {
  //@ ensures \result === true
  return queuedReminderClaim(bookingCurrent, false, noticePending) !== "SendReminder";
}

/** Story: Hear about a booked meeting the day before / Claim a reminder only after the member received the current booking notice (spec/meetingSettlement.md) */
//@ pure
export function lawReminderCannotWaitOnExpiredBooking(noticeAccepted: boolean, noticePending: boolean): boolean {
  //@ ensures \result === true
  return queuedReminderClaim(false, noticeAccepted, noticePending) === "RefuseReminder";
}

/** Story: Hear about a booked meeting the day before / Claim a cancellation only for a member who received booking details (spec/meetingSettlement.md) */
//@ pure
export function bookingNoticeReceiptMayArrive(receiptStatus: string): boolean {
  return receiptStatus === "collected" || receiptStatus === "send_unknown" || receiptStatus === "sending" || receiptStatus === "unknown_acceptance";
}

/** Story: Hear about a booked meeting the day before / Claim a cancellation only for a member who received booking details (spec/meetingSettlement.md) */
//@ pure
export function queuedBookingCancellationClaim(cancellationCurrent: boolean, noticeAccepted: boolean, receiptMayArrive: boolean): BookedCancellationClaim {
  return !cancellationCurrent ? "RefuseCancellation" : (noticeAccepted ? "SendCancellation" : (receiptMayArrive ? "WaitForCancellationReceipt" : "RefuseCancellation"));
}

/** Story: Hear about a booked meeting the day before / Claim a cancellation only for a member who received booking details (spec/meetingSettlement.md) */
//@ pure
export function lawCancellationClaimNeedsReceipt(cancellationCurrent: boolean, receiptMayArrive: boolean): boolean {
  //@ ensures \result === true
  return queuedBookingCancellationClaim(cancellationCurrent, false, receiptMayArrive) !== "SendCancellation";
}

/** Story: Hear about a booked meeting the day before / Claim a cancellation only for a member who received booking details (spec/meetingSettlement.md) */
//@ pure
export function lawStaleCancellationCannotWait(noticeAccepted: boolean, receiptMayArrive: boolean): boolean {
  //@ ensures \result === true
  return queuedBookingCancellationClaim(false, noticeAccepted, receiptMayArrive) === "RefuseCancellation";
}

/** Story: Check whether a booked participant is still coming / The day-of check-in uses one near-meeting message (spec/meetingSettlement.md) */
//@ pure
export function dayOfCheckInAnswerCurrent(exactReceipt: boolean, acceptedAt: number, receivedAt: number, handledAt: number): boolean {
  return exactReceipt && 0 <= acceptedAt && acceptedAt <= receivedAt && receivedAt <= handledAt;
}

/** Story: Check whether a booked participant is still coming / The day-of check-in uses one near-meeting message (spec/meetingSettlement.md) */
//@ pure
export function dayOfCheckInWindow(sameLocalDay: boolean, remainingMs: number): boolean {
  return sameLocalDay && nearMeetingReminderWindow(remainingMs);
}

/** Story: Check whether a booked participant is still coming / The day-of check-in uses one near-meeting message (spec/meetingSettlement.md) */
//@ pure
export function lawPendingCheckInCannotAuthorizeAnswer(acceptedAt: number, receivedAt: number, handledAt: number): boolean {
  //@ ensures \result === true
  return !dayOfCheckInAnswerCurrent(false, acceptedAt, receivedAt, handledAt);
}

/** Story: Check whether a booked participant is still coming / The day-of check-in uses one near-meeting message (spec/meetingSettlement.md) */
//@ pure
export function lawEarlyCheckInAnswerCannotChangeBooking(acceptedAt: number, receivedAt: number, handledAt: number): boolean {
  //@ ensures \result === true
  return !(receivedAt < acceptedAt) || !dayOfCheckInAnswerCurrent(true, acceptedAt, receivedAt, handledAt);
}

/** Story: Check whether a booked participant is still coming / The day-of check-in uses one near-meeting message (spec/meetingSettlement.md) */
//@ pure
export function dayOfCheckInDue(sameLocalDay: boolean, replySlotAvailable: boolean, remainingMs: number): boolean {
  return replySlotAvailable && dayOfCheckInWindow(sameLocalDay, remainingMs);
}

/** Story: Check whether a booked participant is still coming / The day-of check-in uses one near-meeting message (spec/meetingSettlement.md) */
//@ pure
export function lawDayOfCheckInNeedsAFutureMeeting(sameLocalDay: boolean, replySlotAvailable: boolean, remainingMs: number): boolean {
  //@ ensures \result === true
  return !dayOfCheckInDue(sameLocalDay, replySlotAvailable, remainingMs) || (sameLocalDay && remainingMs > 0);
}

/** Story: Ask for feedback and close attendance once / A feedback request opens the attendance period (spec/meetingSettlement.md) */
//@ pure
export function restoreAttendance(resolved: boolean): MeetingSettlement {
  return { phase: resolved ? "SettlementComplete" : "AwaitingAttendance" };
}

/** Story: Ask for feedback and close attendance once / A feedback request opens the attendance period (spec/meetingSettlement.md) */
//@ pure
export function canRequestFeedback(s: MeetingSettlement, unsent: boolean, asOf: number, feedbackAt: number): boolean {
  return s.phase === "BeforeFeedback" && unsent && asOf >= feedbackAt;
}

/** Story: Ask for feedback and close attendance once / A feedback request opens the attendance period (spec/meetingSettlement.md) */
//@ pure
export function requestFeedback(s: MeetingSettlement, unsent: boolean, asOf: number, feedbackAt: number): MeetingSettlement {
  //@ ensures (inv(s) && canRequestFeedback(s, unsent, asOf, feedbackAt)) ==> stepSettlementStaysClosed(s, \result)
  return { phase: "AwaitingAttendance" };
}

/** Story: Ask for feedback and close attendance once / A feedback request opens the attendance period (spec/meetingSettlement.md) */
//@ pure
export function canResolveAttendance(s: MeetingSettlement, timedOut: boolean, everyoneResponded: boolean): boolean {
  return s.phase === "AwaitingAttendance" && (timedOut || everyoneResponded);
}

/** Story: Ask for feedback and close attendance once / A feedback request opens the attendance period (spec/meetingSettlement.md) */
//@ pure
export function resolveAttendance(s: MeetingSettlement, timedOut: boolean, everyoneResponded: boolean): MeetingSettlement {
  //@ ensures (inv(s) && canResolveAttendance(s, timedOut, everyoneResponded)) ==> stepSettlementStaysClosed(s, \result)
  return { phase: "SettlementComplete" };
}

/** Story: Ask for feedback and close attendance once / A feedback request opens the attendance period (spec/meetingSettlement.md) */
//@ pure
export function stepSettlementStaysClosed(before: MeetingSettlement, after: MeetingSettlement): boolean {
  return !(before.phase === "SettlementComplete") || after.phase === "SettlementComplete";
}

/** Story: Ask for feedback and close attendance once / A feedback request opens the attendance period (spec/meetingSettlement.md) */
//@ pure
export function sometimesResolvesAttendance(s: MeetingSettlement): boolean {
  return s.phase === "SettlementComplete";
}

/** Story: Ask for feedback and close attendance once / Classify each attendee from the available reports (spec/meetingSettlement.md) */
//@ pure
export function deliveredInvitee(accepted: boolean, bookingDelivered: boolean): boolean {
  return accepted && bookingDelivered;
}

/** Story: Ask for feedback and close attendance once / Classify each attendee from the available reports (spec/meetingSettlement.md) */
//@ pure
export function countAttendance(evidence: AttendanceEvidence): AttendanceFinding {
  const local_1: AttendanceMark = evidence.saidAttended || (!evidence.saidAbsent && (evidence.counterpartVerified || evidence.organizerVerified)) ? "Attended" : (evidence.saidAbsent ? "Absent" : (evidence.pairMeeting && evidence.reportedMissing ? (evidence.explicitReply ? "Absent" : "Ghosted") : "NoFinding"));
  return { mark: local_1, logFeedback: local_1 === "Attended" && evidence.hasFeedback, reliabilityNoShow: local_1 !== "Attended" && !evidence.hasFeedback && evidence.reportedMissing };
}

/** Story: Ask for feedback and close attendance once / A host's check-in uses the host's response (spec/meetingSettlement.md) */
//@ pure
export function organizerCanVerify(booked: boolean, came: boolean): boolean {
  return booked && came;
}

/** Story: Ask for feedback and close attendance once / A host's check-in uses the host's response (spec/meetingSettlement.md) */
//@ pure
export function counterpartConfirmsAttendance(came: boolean, reportsMissing: boolean): boolean {
  return came && !reportsMissing;
}

/** Story: Ask for feedback and close attendance once / A host's check-in uses the host's response (spec/meetingSettlement.md) */
//@ pure
export function requestAttendanceSatisfied(requesterAttended: boolean, anotherAttended: boolean): boolean {
  return requesterAttended && anotherAttended;
}

/** Story: Ask for feedback and close attendance once / A host's check-in uses the host's response (spec/meetingSettlement.md) */
//@ pure
export function chooseCheckIn(hostResponded: boolean, hostReportsMissing: boolean, hasNames: boolean): CheckInSource {
  return !hostResponded ? "NoCheckIn" : (hostReportsMissing ? "MissingNames" : (hasNames ? "PresentNames" : "BookedParticipants"));
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: MeetingSettlement, event: Event): boolean {
  if (event.type === "requestFeedback") return canRequestFeedback(current, event.unsent, event.asOf, event.feedbackAt);
  if (event.type === "resolveAttendance") return canResolveAttendance(current, event.timedOut, event.everyoneResponded);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: MeetingSettlement, event: Event): MeetingSettlement {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "requestFeedback") return canRequestFeedback(current, event.unsent, event.asOf, event.feedbackAt) ? requestFeedback(current, event.unsent, event.asOf, event.feedbackAt) : current;
  if (event.type === "resolveAttendance") return canResolveAttendance(current, event.timedOut, event.everyoneResponded) ? resolveAttendance(current, event.timedOut, event.everyoneResponded) : current;
  return current;
}

/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseEvent(x: unknown): Event | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "requestFeedback" && typeof raw.unsent === "boolean" && Number.isSafeInteger(raw.asOf) && Number.isSafeInteger(raw.feedbackAt)) return { type: "requestFeedback", unsent: raw.unsent, asOf: raw.asOf, feedbackAt: raw.feedbackAt };
  if (raw.type === "resolveAttendance" && typeof raw.timedOut === "boolean" && typeof raw.everyoneResponded === "boolean") return { type: "resolveAttendance", timedOut: raw.timedOut, everyoneResponded: raw.everyoneResponded };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): MeetingSettlement | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "BeforeFeedback" || raw.phase === "AwaitingAttendance" || raw.phase === "SettlementComplete") && Object.keys(raw).length === 1)) return undefined;
  const parsed: MeetingSettlement = ({ phase: raw.phase });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): MeetingSettlement {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_meetingSettlement(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
