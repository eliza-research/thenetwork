// GENERATED from spec/opportunityLifecycle.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Review a proposal before contacting anyone / An opportunity starts in review (spec/opportunityLifecycle.md:9) */
export type OpportunityPhase = "InReview" | "Probing" | "Scheduled" | "Done" | "Closed";
/** Story: Review a proposal before contacting anyone / An opportunity starts in review (spec/opportunityLifecycle.md:9) */
export interface OpportunityLifecycle { phase: OpportunityPhase; approved: boolean }

/** One variant per transition in the spec. */
export type Event =
  | { type: "startProbing"; approvalRecorded: boolean; eligible: boolean }
  | { type: "book"; hasConsent: boolean }
  | { type: "complete"; feedbackDue: boolean }
  | { type: "close" };

/** Story: Review a proposal before contacting anyone / An opportunity starts in review (spec/opportunityLifecycle.md:9) */
export const initial: OpportunityLifecycle = { phase: "InReview", approved: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: OpportunityLifecycle): boolean {
  return alwaysContactStagesRequireApproval(current);
}

/** Story: Review a proposal before contacting anyone / An opportunity starts in review (spec/opportunityLifecycle.md:9) */
//@ pure
export function canStartProbing(proposal: OpportunityLifecycle, approvalRecorded: boolean, eligible: boolean): boolean {
  return proposal.phase === "InReview" && approvalRecorded && eligible;
}

/** Story: Review a proposal before contacting anyone / An opportunity starts in review (spec/opportunityLifecycle.md:9) */
//@ pure
export function startProbing(proposal: OpportunityLifecycle, approvalRecorded: boolean, eligible: boolean): OpportunityLifecycle {
  //@ ensures (inv(proposal) && canStartProbing(proposal, approvalRecorded, eligible)) ==> alwaysContactStagesRequireApproval(\result)
  //@ ensures (inv(proposal) && canStartProbing(proposal, approvalRecorded, eligible)) ==> stepTerminalOpportunityCannotReopen(proposal, \result)
  return { phase: "Probing", approved: true };
}

/** Story: Review a proposal before contacting anyone / An opportunity starts in review (spec/opportunityLifecycle.md:9) */
//@ pure
export function alwaysContactStagesRequireApproval(proposal: OpportunityLifecycle): boolean {
  return !(proposal.phase === "Probing" || proposal.phase === "Scheduled" || proposal.phase === "Done") || proposal.approved;
}

/** Story: Book and conclude a proposal that comes together / Only an approved proposal with enough consent can book (spec/opportunityLifecycle.md:33) */
//@ pure
export function groupCanContinue(remaining: number): boolean {
  return remaining >= 3;
}

/** Story: Book and conclude a proposal that comes together / Only an approved proposal with enough consent can book (spec/opportunityLifecycle.md:33) */
//@ pure
export function canBook(proposal: OpportunityLifecycle, hasConsent: boolean): boolean {
  return proposal.phase === "Probing" && proposal.approved && hasConsent;
}

/** Story: Book and conclude a proposal that comes together / Only an approved proposal with enough consent can book (spec/opportunityLifecycle.md:33) */
//@ pure
export function book(proposal: OpportunityLifecycle, hasConsent: boolean): OpportunityLifecycle {
  //@ ensures (inv(proposal) && canBook(proposal, hasConsent)) ==> alwaysContactStagesRequireApproval(\result)
  //@ ensures (inv(proposal) && canBook(proposal, hasConsent)) ==> stepTerminalOpportunityCannotReopen(proposal, \result)
  return { ...proposal, phase: "Scheduled" };
}

/** Story: Book and conclude a proposal that comes together / Only an approved proposal with enough consent can book (spec/opportunityLifecycle.md:33) */
//@ pure
export function lawAGroupNeedsAtLeastThree(remaining: number): boolean {
  //@ ensures \result === true
  return !groupCanContinue(remaining) || remaining >= 3;
}

/** Story: Book and conclude a proposal that comes together / A scheduled opportunity is done when feedback becomes due (spec/opportunityLifecycle.md:50) */
//@ pure
export function canComplete(proposal: OpportunityLifecycle, feedbackDue: boolean): boolean {
  return proposal.phase === "Scheduled" && feedbackDue;
}

/** Story: Book and conclude a proposal that comes together / A scheduled opportunity is done when feedback becomes due (spec/opportunityLifecycle.md:50) */
//@ pure
export function complete(proposal: OpportunityLifecycle, feedbackDue: boolean): OpportunityLifecycle {
  //@ ensures (inv(proposal) && canComplete(proposal, feedbackDue)) ==> alwaysContactStagesRequireApproval(\result)
  //@ ensures (inv(proposal) && canComplete(proposal, feedbackDue)) ==> stepTerminalOpportunityCannotReopen(proposal, \result)
  return { ...proposal, phase: "Done" };
}

/** Story: Book and conclude a proposal that comes together / A scheduled opportunity is done when feedback becomes due (spec/opportunityLifecycle.md:50) */
//@ pure
export function canClose(proposal: OpportunityLifecycle): boolean {
  return proposal.phase === "InReview" || proposal.phase === "Probing" || proposal.phase === "Scheduled";
}

/** Story: Book and conclude a proposal that comes together / A scheduled opportunity is done when feedback becomes due (spec/opportunityLifecycle.md:50) */
//@ pure
export function close(proposal: OpportunityLifecycle): OpportunityLifecycle {
  //@ ensures (inv(proposal) && canClose(proposal)) ==> alwaysContactStagesRequireApproval(\result)
  //@ ensures (inv(proposal) && canClose(proposal)) ==> stepTerminalOpportunityCannotReopen(proposal, \result)
  return { ...proposal, phase: "Closed" };
}

/** Story: Book and conclude a proposal that comes together / A scheduled opportunity is done when feedback becomes due (spec/opportunityLifecycle.md:50) */
//@ pure
export function stepTerminalOpportunityCannotReopen(before: OpportunityLifecycle, after: OpportunityLifecycle): boolean {
  return !(before.phase === "Closed" || before.phase === "Done") || before.phase === after.phase;
}

/** Story: Book and conclude a proposal that comes together / A scheduled opportunity is done when feedback becomes due (spec/opportunityLifecycle.md:50) */
//@ pure
export function sometimesCanBook(proposal: OpportunityLifecycle): boolean {
  return proposal.phase === "Scheduled";
}

/** Story: Book and conclude a proposal that comes together / A scheduled opportunity is done when feedback becomes due (spec/opportunityLifecycle.md:50) */
//@ pure
export function sometimesCanComplete(proposal: OpportunityLifecycle): boolean {
  return proposal.phase === "Done";
}

/** Story: Book and conclude a proposal that comes together / A scheduled opportunity is done when feedback becomes due (spec/opportunityLifecycle.md:50) */
//@ pure
export function sometimesCanCloseBeforeContact(proposal: OpportunityLifecycle): boolean {
  return proposal.phase === "Closed" && !proposal.approved;
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: OpportunityLifecycle, event: Event): boolean {
  if (event.type === "startProbing") return canStartProbing(current, event.approvalRecorded, event.eligible);
  if (event.type === "book") return canBook(current, event.hasConsent);
  if (event.type === "complete") return canComplete(current, event.feedbackDue);
  if (event.type === "close") return canClose(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: OpportunityLifecycle, event: Event): OpportunityLifecycle {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "startProbing" && canStartProbing(current, event.approvalRecorded, event.eligible)) return startProbing(current, event.approvalRecorded, event.eligible);
  if (event.type === "book" && canBook(current, event.hasConsent)) return book(current, event.hasConsent);
  if (event.type === "complete" && canComplete(current, event.feedbackDue)) return complete(current, event.feedbackDue);
  if (event.type === "close" && canClose(current)) return close(current);
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
  if (raw.type === "startProbing" && typeof raw.approvalRecorded === "boolean" && typeof raw.eligible === "boolean") return { type: "startProbing", approvalRecorded: raw.approvalRecorded, eligible: raw.eligible };
  if (raw.type === "book" && typeof raw.hasConsent === "boolean") return { type: "book", hasConsent: raw.hasConsent };
  if (raw.type === "complete" && typeof raw.feedbackDue === "boolean") return { type: "complete", feedbackDue: raw.feedbackDue };
  if (raw.type === "close") return { type: "close" };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): OpportunityLifecycle | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "InReview" || raw.phase === "Probing" || raw.phase === "Scheduled" || raw.phase === "Done" || raw.phase === "Closed") && typeof raw.approved === "boolean" && Object.keys(raw).length === 2)) return undefined;
  const parsed: OpportunityLifecycle = ({ phase: raw.phase, approved: raw.approved });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): OpportunityLifecycle {
  //@ ensures inv(\result)
  return initial;
}
