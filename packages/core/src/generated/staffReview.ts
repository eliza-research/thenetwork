// GENERATED from spec/staffReview.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Review the opportunity I selected / A changed card or revision starts a fresh draft (spec/staffReview.md:21) */
export type ReviewMode = "IdleReview" | "RejectReview" | "EditReview" | "RerollReview";
/** Story: Review the opportunity I selected / A changed card or revision starts a fresh draft (spec/staffReview.md:21) */
export interface ReviewCtl { cardKey: string; revision: number; mode: ReviewMode; noteNeeded: boolean }

/** One variant per transition in the spec. */
export type Event =
  | { type: "bindCard"; cardKey: string }
  | { type: "changeReviewMode"; requestedMode: ReviewMode; togglePanel: boolean }
  | { type: "requireReviewNote" }
  | { type: "settleReview"; cardKey: string; revision: number };

/** Story: Review the opportunity I selected / A changed card or revision starts a fresh draft (spec/staffReview.md:21) */
export const initial: ReviewCtl = { cardKey: "", revision: 0, mode: "IdleReview", noteNeeded: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: ReviewCtl): boolean {
  return alwaysRequiredNoteBelongsToRejection(current);
}

/** Story: Review the opportunity I selected / The visible card follows focus and queue order (spec/staffReview.md:9) */
//@ pure
export function selectedReviewCard(pendingCards: string[], focusedCard: string, heldCard: string): string {
  return pendingCards.includes(focusedCard) ? focusedCard : (pendingCards.includes(heldCard) ? heldCard : (pendingCards.length > 0 ? pendingCards[0] : ""));
}

/** Story: Review the opportunity I selected / A changed card or revision starts a fresh draft (spec/staffReview.md:21) */
//@ pure
export function bindCard(ctl: ReviewCtl, cardKey: string): ReviewCtl {
  //@ ensures (inv(ctl) && canBindCard(ctl, cardKey)) ==> alwaysRequiredNoteBelongsToRejection(\result)
  //@ ensures (inv(ctl) && canBindCard(ctl, cardKey)) ==> stepRevisionNeverFalls(ctl, \result)
  return { cardKey: cardKey, revision: ctl.revision + 1, mode: "IdleReview", noteNeeded: false };
}

/** Story: Review the opportunity I selected / A changed card or revision starts a fresh draft (spec/staffReview.md:21) */
//@ pure
export function canBindCard(ctl: ReviewCtl, cardKey: string): boolean {
  return cardKey !== ctl.cardKey;
}

/** Story: Review the opportunity I selected / A mode change applies only to a bound card (spec/staffReview.md:35) */
//@ pure
export function canChangeReviewMode(ctl: ReviewCtl): boolean {
  return ctl.cardKey !== "";
}

/** Story: Review the opportunity I selected / A mode change applies only to a bound card (spec/staffReview.md:35) */
//@ pure
export function changeReviewMode(ctl: ReviewCtl, requestedMode: ReviewMode, togglePanel: boolean): ReviewCtl {
  //@ ensures (inv(ctl) && canChangeReviewMode(ctl)) ==> alwaysRequiredNoteBelongsToRejection(\result)
  //@ ensures (inv(ctl) && canChangeReviewMode(ctl)) ==> stepRevisionNeverFalls(ctl, \result)
  return { ...ctl, mode: togglePanel && requestedMode === ctl.mode ? "IdleReview" : requestedMode, noteNeeded: false };
}

/** Story: Review the opportunity I selected / A mode change applies only to a bound card (spec/staffReview.md:35) */
//@ pure
export function canRequireReviewNote(ctl: ReviewCtl): boolean {
  return ctl.cardKey !== "" && ctl.mode === "RejectReview";
}

/** Story: Review the opportunity I selected / A mode change applies only to a bound card (spec/staffReview.md:35) */
//@ pure
export function requireReviewNote(ctl: ReviewCtl): ReviewCtl {
  //@ ensures (inv(ctl) && canRequireReviewNote(ctl)) ==> alwaysRequiredNoteBelongsToRejection(\result)
  //@ ensures (inv(ctl) && canRequireReviewNote(ctl)) ==> stepRevisionNeverFalls(ctl, \result)
  return { ...ctl, noteNeeded: true };
}

/** Story: Review the opportunity I selected / A mode change applies only to a bound card (spec/staffReview.md:35) */
//@ pure
export function alwaysRequiredNoteBelongsToRejection(ctl: ReviewCtl): boolean {
  return !ctl.noteNeeded || ctl.mode === "RejectReview";
}

/** Story: Review the opportunity I selected / An old response cannot clear or move a newer selection (spec/staffReview.md:51) */
//@ pure
export function ownsReviewResponse(ctl: ReviewCtl, cardKey: string, revision: number): boolean {
  return ctl.cardKey !== "" && ctl.cardKey === cardKey && ctl.revision === revision;
}

/** Story: Review the opportunity I selected / An old response cannot clear or move a newer selection (spec/staffReview.md:51) */
//@ pure
export function settleReview(ctl: ReviewCtl, cardKey: string, revision: number): ReviewCtl {
  //@ ensures (inv(ctl) && canSettleReview(ctl, cardKey, revision)) ==> alwaysRequiredNoteBelongsToRejection(\result)
  //@ ensures (inv(ctl) && canSettleReview(ctl, cardKey, revision)) ==> stepRevisionNeverFalls(ctl, \result)
  return { ...ctl, revision: ctl.revision + 1, mode: "IdleReview", noteNeeded: false };
}

/** Story: Review the opportunity I selected / An old response cannot clear or move a newer selection (spec/staffReview.md:51) */
//@ pure
export function stepRevisionNeverFalls(before: ReviewCtl, after: ReviewCtl): boolean {
  return after.revision >= before.revision;
}

/** Story: Review the opportunity I selected / An old response cannot clear or move a newer selection (spec/staffReview.md:51) */
//@ pure
export function sometimesReviewDraftOpens(ctl: ReviewCtl): boolean {
  return ctl.mode === "EditReview";
}

/** Story: Review the opportunity I selected / An old response cannot clear or move a newer selection (spec/staffReview.md:51) */
//@ pure
export function canSettleReview(ctl: ReviewCtl, cardKey: string, revision: number): boolean {
  return ownsReviewResponse(ctl, cardKey, revision);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: ReviewCtl, event: Event): boolean {
  if (event.type === "bindCard") return canBindCard(current, event.cardKey);
  if (event.type === "changeReviewMode") return canChangeReviewMode(current);
  if (event.type === "requireReviewNote") return canRequireReviewNote(current);
  if (event.type === "settleReview") return canSettleReview(current, event.cardKey, event.revision);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: ReviewCtl, event: Event): ReviewCtl {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "bindCard" && canBindCard(current, event.cardKey)) return bindCard(current, event.cardKey);
  if (event.type === "changeReviewMode" && canChangeReviewMode(current)) return changeReviewMode(current, event.requestedMode, event.togglePanel);
  if (event.type === "requireReviewNote" && canRequireReviewNote(current)) return requireReviewNote(current);
  if (event.type === "settleReview" && canSettleReview(current, event.cardKey, event.revision)) return settleReview(current, event.cardKey, event.revision);
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
  if (raw.type === "bindCard" && typeof raw.cardKey === "string") return { type: "bindCard", cardKey: raw.cardKey };
  if (raw.type === "changeReviewMode" && (raw.requestedMode === "IdleReview" || raw.requestedMode === "RejectReview" || raw.requestedMode === "EditReview" || raw.requestedMode === "RerollReview") && typeof raw.togglePanel === "boolean") return { type: "changeReviewMode", requestedMode: raw.requestedMode, togglePanel: raw.togglePanel };
  if (raw.type === "requireReviewNote") return { type: "requireReviewNote" };
  if (raw.type === "settleReview" && typeof raw.cardKey === "string" && Number.isSafeInteger(raw.revision)) return { type: "settleReview", cardKey: raw.cardKey, revision: raw.revision };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): ReviewCtl | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && typeof raw.cardKey === "string" && Number.isSafeInteger(raw.revision) && (raw.mode === "IdleReview" || raw.mode === "RejectReview" || raw.mode === "EditReview" || raw.mode === "RerollReview") && typeof raw.noteNeeded === "boolean" && Object.keys(raw).length === 4)) return undefined;
  const parsed: ReviewCtl = ({ cardKey: raw.cardKey, revision: raw.revision, mode: raw.mode, noteNeeded: raw.noteNeeded });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): ReviewCtl {
  //@ ensures inv(\result)
  return initial;
}
