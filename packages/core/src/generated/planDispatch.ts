// GENERATED from spec/planDispatch.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Ask me about one group plan during my send window / A missing seat or an absence rules out the invitation (spec/planDispatch.md) */
export type InvitePhase = "CheckingSeat" | "CheckingPresence" | "CheckingWindow" | "CheckingAllowance" | "RenderingInvite" | "SendingInvite" | "InviteSent" | "DeliveryNotConfirmed" | "Deferred" | "Unavailable";
/** Story: Ask me about one group plan during my send window / A missing seat or an absence rules out the invitation (spec/planDispatch.md) */
export interface PlanDispatch { phase: InvitePhase; reason: string }

/** One variant per transition in the spec. */
export type Event =
  | { type: "checkSeat"; eligible: boolean }
  | { type: "checkPresence"; present: boolean }
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
export function planTurnDue(pending: boolean, contacted: boolean): boolean {
  return pending && !contacted;
}

/** Story: Ask me about one group plan during my send window / Only an open plan can invite a pending member (spec/planDispatch.md) */
//@ pure
export function lawBookedLaneRespectsLateJoinCutoff(booked: boolean): boolean {
  //@ ensures \result === true
  return !planLaneOpen(false, booked, false);
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
  return present ? ({ ...invite, phase: "CheckingWindow" } as PlanDispatch) : ({ phase: "Unavailable", reason: "away" } as PlanDispatch);
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

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: PlanDispatch, event: Event): boolean {
  if (event.type === "checkSeat") return canCheckSeat(current);
  if (event.type === "checkPresence") return canCheckPresence(current);
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
  if (event.type === "checkSeat" && canCheckSeat(current)) return checkSeat(current, event.eligible);
  if (event.type === "checkPresence" && canCheckPresence(current)) return checkPresence(current, event.present);
  if (event.type === "checkWindow" && canCheckWindow(current)) return checkWindow(current, event.busy, event.windowOpen, event.awaitingAnswer, event.sentToday);
  if (event.type === "checkAllowance" && canCheckAllowance(current)) return checkAllowance(current, event.admitted);
  if (event.type === "renderInvite" && canRenderInvite(current)) return renderInvite(current, event.usable);
  if (event.type === "recordSend" && canRecordSend(current)) return recordSend(current, event.sent);
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
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "CheckingSeat" || raw.phase === "CheckingPresence" || raw.phase === "CheckingWindow" || raw.phase === "CheckingAllowance" || raw.phase === "RenderingInvite" || raw.phase === "SendingInvite" || raw.phase === "InviteSent" || raw.phase === "DeliveryNotConfirmed" || raw.phase === "Deferred" || raw.phase === "Unavailable") && typeof raw.reason === "string" && Object.keys(raw).length === 2)) return undefined;
  const parsed: PlanDispatch = ({ phase: raw.phase, reason: raw.reason });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): PlanDispatch {
  //@ ensures inv(\result)
  return initial;
}
