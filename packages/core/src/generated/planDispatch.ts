// GENERATED from spec/planDispatch.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Ask me about one group plan during my send window / A missing seat or an absence rules out the invitation (spec/planDispatch.md) */
export type InvitePhase = "CheckingSeat" | "CheckingPresence" | "CheckingAvailability" | "CheckingWindow" | "CheckingAllowance" | "RenderingInvite" | "SendingInvite" | "InviteSent" | "DeliveryNotConfirmed" | "Deferred" | "Unavailable";
/** Story: Ask me about one group plan during my send window / A missing seat or an absence rules out the invitation (spec/planDispatch.md) */
export interface PlanDispatch { phase: InvitePhase; reason: string }
/** Story: Ask me about one group plan during my send window / A terminal unsent invitation releases the exact pending seat (spec/planDispatch.md) */
export type PendingPlanInviteDecision = "WaitForPlanAnswer" | "PlanInviteUnsent" | "PlanAnswerExpired";

/** One variant per transition in the spec. */
export type Event =
  | { type: "checkSeat"; eligible: boolean }
  | { type: "checkPresence"; present: boolean }
  | { type: "checkAvailability"; statedAllows: boolean; calendarAllows: boolean }
  | { type: "checkWindow"; busy: boolean; windowOpen: boolean; awaitingAnswer: boolean; sentToday: boolean }
  | { type: "checkAllowance"; admitted: boolean }
  | { type: "renderInvite"; usable: boolean }
  | { type: "recordSend"; sent: boolean };

/** Story: Ask me about one group plan during my send window / A missing seat or an absence rules out the invitation (spec/planDispatch.md) */
export const initial: PlanDispatch = { phase: "CheckingSeat", reason: "" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: PlanDispatch): boolean {
  return true;
}

/** Story: Ask me about one group plan during my send window / Only an open plan can invite a pending member (spec/planDispatch.md) */
//@ pure
export function planLaneOpen(probing: boolean, booked: boolean, lateJoinOpen: boolean): boolean {
  return probing || (booked && lateJoinOpen);
}

/** Story: Ask me about one group plan during my send window / Only an open plan can invite a pending member (spec/planDispatch.md) */
//@ pure
export function queuedPlanProbeAllowed(approvalCurrent: boolean, pendingSeat: boolean, laneOpen: boolean): boolean {
  return approvalCurrent && pendingSeat && laneOpen;
}

/** Story: Ask me about one group plan during my send window / Only an open plan can invite a pending member (spec/planDispatch.md) */
//@ pure
export function planTurnDue(pending: boolean, contacted: boolean): boolean {
  return pending && !contacted;
}

/** Story: Ask me about one group plan during my send window / Only an open plan can invite a pending member (spec/planDispatch.md) */
//@ pure
export function planInvitationOpen(probing: boolean, booked: boolean, now: number, probeDeadline: number, lateJoinAt: number): boolean {
  return planLaneOpen(probing && now < probeDeadline, booked, now <= lateJoinAt);
}

/** Story: Ask me about one group plan during my send window / Only an open plan can invite a pending member (spec/planDispatch.md) */
//@ pure
export function lawBookedLaneRespectsLateJoinCutoff(booked: boolean): boolean {
  //@ ensures \result === true
  return !planLaneOpen(false, booked, false);
}

/** Story: Ask me about one group plan during my send window / Only an open plan can invite a pending member (spec/planDispatch.md) */
//@ pure
export function lawProbingLaneClosesAtDeadline(deadline: number, lateJoinAt: number): boolean {
  //@ ensures \result === true
  return !planInvitationOpen(true, false, deadline, deadline, lateJoinAt);
}

/** Story: Ask me about one group plan during my send window / A missing seat or an absence rules out the invitation (spec/planDispatch.md) */
//@ pure
export function canCheckSeat(invite: PlanDispatch): boolean {
  return invite.phase === "CheckingSeat";
}

/** Story: Ask me about one group plan during my send window / A missing seat or an absence rules out the invitation (spec/planDispatch.md) */
//@ pure
export function checkSeat(invite: PlanDispatch, eligible: boolean): PlanDispatch {
  //@ ensures (inv(invite) && canCheckSeat(invite)) ==> stepAnInviteNeedsAConfirmedSend(invite, "checkSeat", \result)
  return eligible ? ({ ...invite, phase: "CheckingPresence" } as PlanDispatch) : ({ phase: "Unavailable", reason: "seat" } as PlanDispatch);
}

/** Story: Ask me about one group plan during my send window / A missing seat or an absence rules out the invitation (spec/planDispatch.md) */
//@ pure
export function canCheckPresence(invite: PlanDispatch): boolean {
  return invite.phase === "CheckingPresence";
}

/** Story: Ask me about one group plan during my send window / A missing seat or an absence rules out the invitation (spec/planDispatch.md) */
//@ pure
export function checkPresence(invite: PlanDispatch, present: boolean): PlanDispatch {
  //@ ensures (inv(invite) && canCheckPresence(invite)) ==> stepAnInviteNeedsAConfirmedSend(invite, "checkPresence", \result)
  return present ? ({ ...invite, phase: "CheckingAvailability" } as PlanDispatch) : ({ phase: "Unavailable", reason: "away" } as PlanDispatch);
}

/** Story: Ask me about one group plan during my send window / Recheck the member's current availability before contacting them (spec/planDispatch.md) */
//@ pure
export function statedPlanWindowAllows(statedAt: number, statedUntil: number, now: number, slotStart: number, coversSlot: boolean): boolean {
  return statedAt > now || statedUntil <= slotStart || coversSlot;
}

/** Story: Ask me about one group plan during my send window / Recheck the member's current availability before contacting them (spec/planDispatch.md) */
//@ pure
export function lawCurrentExcludedWindowStopsPlan(statedAt: number, statedUntil: number, now: number, slotStart: number): boolean {
  //@ ensures \result === true
  return !(statedAt <= now && statedUntil > slotStart) || !statedPlanWindowAllows(statedAt, statedUntil, now, slotStart, false);
}

/** Story: Ask me about one group plan during my send window / Recheck the member's current availability before contacting them (spec/planDispatch.md) */
//@ pure
export function canCheckAvailability(invite: PlanDispatch): boolean {
  return invite.phase === "CheckingAvailability";
}

/** Story: Ask me about one group plan during my send window / Recheck the member's current availability before contacting them (spec/planDispatch.md) */
//@ pure
export function checkAvailability(invite: PlanDispatch, statedAllows: boolean, calendarAllows: boolean): PlanDispatch {
  //@ ensures (inv(invite) && canCheckAvailability(invite)) ==> stepAnInviteNeedsAConfirmedSend(invite, "checkAvailability", \result)
  return statedAllows && calendarAllows ? ({ ...invite, phase: "CheckingWindow" } as PlanDispatch) : ({ phase: "Unavailable", reason: "plan_availability_changed" } as PlanDispatch);
}

/** Story: Ask me about one group plan during my send window / Wait for the send window, earlier questions, and the right allowance (spec/planDispatch.md) */
//@ pure
export function canCheckWindow(invite: PlanDispatch): boolean {
  return invite.phase === "CheckingWindow";
}

/** Story: Ask me about one group plan during my send window / Wait for the send window, earlier questions, and the right allowance (spec/planDispatch.md) */
//@ pure
export function checkWindow(invite: PlanDispatch, busy: boolean, windowOpen: boolean, awaitingAnswer: boolean, sentToday: boolean): PlanDispatch {
  //@ ensures (inv(invite) && canCheckWindow(invite)) ==> stepAnInviteNeedsAConfirmedSend(invite, "checkWindow", \result)
  return busy ? ({ phase: "Deferred", reason: "busy" } as PlanDispatch) : (!windowOpen ? ({ phase: "Deferred", reason: "send_window" } as PlanDispatch) : (awaitingAnswer ? ({ phase: "Deferred", reason: "one_question" } as PlanDispatch) : (sentToday ? ({ phase: "Deferred", reason: "one_a_day" } as PlanDispatch) : ({ ...invite, phase: "CheckingAllowance" } as PlanDispatch))));
}

/** Story: Ask me about one group plan during my send window / Wait for the send window, earlier questions, and the right allowance (spec/planDispatch.md) */
//@ pure
export function canCheckAllowance(invite: PlanDispatch): boolean {
  return invite.phase === "CheckingAllowance";
}

/** Story: Ask me about one group plan during my send window / Wait for the send window, earlier questions, and the right allowance (spec/planDispatch.md) */
//@ pure
export function checkAllowance(invite: PlanDispatch, admitted: boolean): PlanDispatch {
  //@ ensures (inv(invite) && canCheckAllowance(invite)) ==> stepAnInviteNeedsAConfirmedSend(invite, "checkAllowance", \result)
  return admitted ? ({ ...invite, phase: "RenderingInvite" } as PlanDispatch) : ({ phase: "Deferred", reason: "cap" } as PlanDispatch);
}

/** Story: Ask me about one group plan during my send window / A usable message must be sent before the daily record changes (spec/planDispatch.md) */
//@ pure
export function canRenderInvite(invite: PlanDispatch): boolean {
  return invite.phase === "RenderingInvite";
}

/** Story: Ask me about one group plan during my send window / A usable message must be sent before the daily record changes (spec/planDispatch.md) */
//@ pure
export function renderInvite(invite: PlanDispatch, usable: boolean): PlanDispatch {
  //@ ensures (inv(invite) && canRenderInvite(invite)) ==> stepAnInviteNeedsAConfirmedSend(invite, "renderInvite", \result)
  return usable ? ({ ...invite, phase: "SendingInvite" } as PlanDispatch) : ({ phase: "Unavailable", reason: "plan_copy" } as PlanDispatch);
}

/** Story: Ask me about one group plan during my send window / A usable message must be sent before the daily record changes (spec/planDispatch.md) */
//@ pure
export function canRecordSend(invite: PlanDispatch): boolean {
  return invite.phase === "SendingInvite";
}

/** Story: Ask me about one group plan during my send window / A usable message must be sent before the daily record changes (spec/planDispatch.md) */
//@ pure
export function recordSend(invite: PlanDispatch, sent: boolean): PlanDispatch {
  //@ ensures (inv(invite) && canRecordSend(invite)) ==> stepAnInviteNeedsAConfirmedSend(invite, "recordSend", \result)
  return { ...invite, phase: sent ? "InviteSent" : "DeliveryNotConfirmed" };
}

/** Story: Ask me about one group plan during my send window / A usable message must be sent before the daily record changes (spec/planDispatch.md) */
//@ pure
export function stepAnInviteNeedsAConfirmedSend(before: PlanDispatch, via: string, after: PlanDispatch): boolean {
  return !(after.phase === "InviteSent") || (via === "recordSend" && before.phase === "SendingInvite");
}

/** Story: Ask me about one group plan during my send window / A usable message must be sent before the daily record changes (spec/planDispatch.md) */
//@ pure
export function sometimesCanSendPlanInvite(invite: PlanDispatch): boolean {
  return invite.phase === "InviteSent";
}

/** Story: Ask me about one group plan during my send window / A reply requires acceptance of the exact plan invitation (spec/planDispatch.md) */
//@ pure
export function planProbeReplyCurrent(memberReply: boolean, accepted: boolean, receivedAt: number, acceptedAt: number, now: number): boolean {
  return memberReply && accepted && receivedAt >= acceptedAt && receivedAt <= now;
}

/** Story: Ask me about one group plan during my send window / A reply requires acceptance of the exact plan invitation (spec/planDispatch.md) */
//@ pure
export function lawPlanReplyNeedsAcceptance(memberReply: boolean, receivedAt: number, acceptedAt: number, now: number): boolean {
  //@ ensures \result === true
  return !planProbeReplyCurrent(memberReply, false, receivedAt, acceptedAt, now);
}

/** Story: Ask me about one group plan during my send window / A terminal unsent invitation releases the exact pending seat (spec/planDispatch.md) */
//@ pure
export function pendingPlanInviteDecision(staged: boolean, knownUnsent: boolean, responseExpired: boolean): PendingPlanInviteDecision {
  return !staged ? "WaitForPlanAnswer" : (knownUnsent ? "PlanInviteUnsent" : (responseExpired ? "PlanAnswerExpired" : "WaitForPlanAnswer"));
}

/** Story: Ask me about one group plan during my send window / A terminal unsent invitation releases the exact pending seat (spec/planDispatch.md) */
//@ pure
export function lawUnsentIsDifferentFromAnExpiredReply(responseExpired: boolean): boolean {
  //@ ensures \result === true
  return pendingPlanInviteDecision(true, true, responseExpired) === "PlanInviteUnsent";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: PlanDispatch, event: Event): boolean {
  if (event.type === "checkSeat") return canCheckSeat(current);
  if (event.type === "checkPresence") return canCheckPresence(current);
  if (event.type === "checkAvailability") return canCheckAvailability(current);
  if (event.type === "checkWindow") return canCheckWindow(current);
  if (event.type === "checkAllowance") return canCheckAllowance(current);
  if (event.type === "renderInvite") return canRenderInvite(current);
  if (event.type === "recordSend") return canRecordSend(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: PlanDispatch, event: Event): PlanDispatch {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "checkSeat") return canCheckSeat(current) ? checkSeat(current, event.eligible) : current;
  if (event.type === "checkPresence") return canCheckPresence(current) ? checkPresence(current, event.present) : current;
  if (event.type === "checkAvailability") return canCheckAvailability(current) ? checkAvailability(current, event.statedAllows, event.calendarAllows) : current;
  if (event.type === "checkWindow") return canCheckWindow(current) ? checkWindow(current, event.busy, event.windowOpen, event.awaitingAnswer, event.sentToday) : current;
  if (event.type === "checkAllowance") return canCheckAllowance(current) ? checkAllowance(current, event.admitted) : current;
  if (event.type === "renderInvite") return canRenderInvite(current) ? renderInvite(current, event.usable) : current;
  if (event.type === "recordSend") return canRecordSend(current) ? recordSend(current, event.sent) : current;
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
  if (raw.type === "checkSeat" && typeof raw.eligible === "boolean") return { type: "checkSeat", eligible: raw.eligible };
  if (raw.type === "checkPresence" && typeof raw.present === "boolean") return { type: "checkPresence", present: raw.present };
  if (raw.type === "checkAvailability" && typeof raw.statedAllows === "boolean" && typeof raw.calendarAllows === "boolean") return { type: "checkAvailability", statedAllows: raw.statedAllows, calendarAllows: raw.calendarAllows };
  if (raw.type === "checkWindow" && typeof raw.busy === "boolean" && typeof raw.windowOpen === "boolean" && typeof raw.awaitingAnswer === "boolean" && typeof raw.sentToday === "boolean") return { type: "checkWindow", busy: raw.busy, windowOpen: raw.windowOpen, awaitingAnswer: raw.awaitingAnswer, sentToday: raw.sentToday };
  if (raw.type === "checkAllowance" && typeof raw.admitted === "boolean") return { type: "checkAllowance", admitted: raw.admitted };
  if (raw.type === "renderInvite" && typeof raw.usable === "boolean") return { type: "renderInvite", usable: raw.usable };
  if (raw.type === "recordSend" && typeof raw.sent === "boolean") return { type: "recordSend", sent: raw.sent };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): PlanDispatch | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "CheckingSeat" || raw.phase === "CheckingPresence" || raw.phase === "CheckingAvailability" || raw.phase === "CheckingWindow" || raw.phase === "CheckingAllowance" || raw.phase === "RenderingInvite" || raw.phase === "SendingInvite" || raw.phase === "InviteSent" || raw.phase === "DeliveryNotConfirmed" || raw.phase === "Deferred" || raw.phase === "Unavailable") && typeof raw.reason === "string" && Object.keys(raw).length === 2)) return undefined;
  const parsed: PlanDispatch = ({ phase: raw.phase, reason: raw.reason });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): PlanDispatch {
  //@ ensures inv(\result)
  return initial;
}
