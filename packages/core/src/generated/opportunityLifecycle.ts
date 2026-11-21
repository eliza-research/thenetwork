// GENERATED from spec/opportunityLifecycle.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Review a proposal before contacting anyone / An opportunity starts in review (spec/opportunityLifecycle.md) */
export type OpportunityPhase = "InReview" | "Probing" | "Scheduled" | "Done" | "Closed";
/** Story: Review a proposal before contacting anyone / An opportunity starts in review (spec/opportunityLifecycle.md) */
export interface OpportunityLifecycle { phase: OpportunityPhase; approved: boolean }
/** Story: Book and conclude a proposal that comes together / An explicit cancellation selects the named upcoming meeting (spec/opportunityLifecycle.md) */
export type UnlinkedCancellation = "NoCancellation" | "NoMatchingBooking" | "AskWhichBooking" | "CancelMatchingBooking";

/** One variant per transition in the spec. */
export type Event =
  | { type: "startProbing"; approvalRecorded: boolean; eligible: boolean }
  | { type: "reroll"; replacementFound: boolean }
  | { type: "book"; hasConsent: boolean }
  | { type: "complete"; feedbackDue: boolean }
  | { type: "close" };

/** Story: Review a proposal before contacting anyone / An opportunity starts in review (spec/opportunityLifecycle.md) */
export const initial: OpportunityLifecycle = { phase: "InReview", approved: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: OpportunityLifecycle): boolean {
  return alwaysContactStagesRequireApproval(current);
}

/** Story: Review a proposal before contacting anyone / An opportunity starts in review (spec/opportunityLifecycle.md) */
//@ pure
export function stepRerollRequiresNewApproval(before: OpportunityLifecycle, via: string, after: OpportunityLifecycle): boolean {
  return !(via === "reroll") || (before.phase === "InReview" && !after.approved);
}

/** Story: Review a proposal before contacting anyone / An opportunity starts in review (spec/opportunityLifecycle.md) */
//@ pure
export function alwaysContactStagesRequireApproval(proposal: OpportunityLifecycle): boolean {
  return !(proposal.phase === "Probing" || proposal.phase === "Scheduled" || proposal.phase === "Done") || proposal.approved;
}

/** Story: Review a proposal before contacting anyone / An opportunity starts in review (spec/opportunityLifecycle.md) */
//@ pure
export function canStartProbing(proposal: OpportunityLifecycle, approvalRecorded: boolean, eligible: boolean): boolean {
  return proposal.phase === "InReview" && approvalRecorded && eligible;
}

/** Story: Review a proposal before contacting anyone / An opportunity starts in review (spec/opportunityLifecycle.md) */
//@ pure
export function startProbing(proposal: OpportunityLifecycle, approvalRecorded: boolean, eligible: boolean): OpportunityLifecycle {
  //@ ensures (inv(proposal) && canStartProbing(proposal, approvalRecorded, eligible)) ==> alwaysContactStagesRequireApproval(\result)
  //@ ensures (inv(proposal) && canStartProbing(proposal, approvalRecorded, eligible)) ==> stepRerollRequiresNewApproval(proposal, "startProbing", \result)
  //@ ensures (inv(proposal) && canStartProbing(proposal, approvalRecorded, eligible)) ==> stepTerminalOpportunityCannotReopen(proposal, \result)
  return { phase: "Probing", approved: true };
}

/** Story: Review a proposal before contacting anyone / An opportunity starts in review (spec/opportunityLifecycle.md) */
//@ pure
export function canReroll(proposal: OpportunityLifecycle): boolean {
  return proposal.phase === "InReview";
}

/** Story: Review a proposal before contacting anyone / An opportunity starts in review (spec/opportunityLifecycle.md) */
//@ pure
export function reroll(proposal: OpportunityLifecycle, replacementFound: boolean): OpportunityLifecycle {
  //@ ensures (inv(proposal) && canReroll(proposal)) ==> alwaysContactStagesRequireApproval(\result)
  //@ ensures (inv(proposal) && canReroll(proposal)) ==> stepRerollRequiresNewApproval(proposal, "reroll", \result)
  //@ ensures (inv(proposal) && canReroll(proposal)) ==> stepTerminalOpportunityCannotReopen(proposal, \result)
  return { phase: replacementFound ? "InReview" : "Closed", approved: false };
}

/** Story: Book and conclude a proposal that comes together / Only an approved proposal with enough consent can book (spec/opportunityLifecycle.md) */
//@ pure
export function groupCanContinue(remaining: number): boolean {
  return remaining >= 3;
}

/** Story: Book and conclude a proposal that comes together / Only an approved proposal with enough consent can book (spec/opportunityLifecycle.md) */
//@ pure
export function canBook(proposal: OpportunityLifecycle, hasConsent: boolean): boolean {
  return proposal.phase === "Probing" && proposal.approved && hasConsent;
}

/** Story: Book and conclude a proposal that comes together / Only an approved proposal with enough consent can book (spec/opportunityLifecycle.md) */
//@ pure
export function book(proposal: OpportunityLifecycle, hasConsent: boolean): OpportunityLifecycle {
  //@ ensures (inv(proposal) && canBook(proposal, hasConsent)) ==> alwaysContactStagesRequireApproval(\result)
  //@ ensures (inv(proposal) && canBook(proposal, hasConsent)) ==> stepRerollRequiresNewApproval(proposal, "book", \result)
  //@ ensures (inv(proposal) && canBook(proposal, hasConsent)) ==> stepTerminalOpportunityCannotReopen(proposal, \result)
  return { ...proposal, phase: "Scheduled" };
}

/** Story: Book and conclude a proposal that comes together / Only an approved proposal with enough consent can book (spec/opportunityLifecycle.md) */
//@ pure
export function lawAGroupNeedsAtLeastThree(remaining: number): boolean {
  //@ ensures \result === true
  return !(remaining < 3) || !groupCanContinue(remaining);
}

/** Story: Book and conclude a proposal that comes together / Only an approved proposal with enough consent can book (spec/opportunityLifecycle.md) */
//@ pure
export function lawPairLeftFromGroupNeedsFreshConsent(proposal: OpportunityLifecycle, remaining: number): boolean {
  //@ ensures \result === true
  return !(proposal.phase === "Scheduled" && !groupCanContinue(remaining)) || (canClose(proposal) && !canBook(close(proposal), true));
}

/** Story: Book and conclude a proposal that comes together / A member can withdraw probe consent before the reveal (spec/opportunityLifecycle.md) */
//@ pure
export function acceptedProbeWithdrawalAllowed(ownText: boolean, directRefusal: boolean, otherReplyOpen: boolean, matches: number): boolean {
  return ownText && directRefusal && !otherReplyOpen && matches === 1;
}

/** Story: Book and conclude a proposal that comes together / A member can withdraw probe consent before the reveal (spec/opportunityLifecycle.md) */
//@ pure
export function acceptedProbeCanWithdraw(proposal: OpportunityLifecycle, accepted: boolean, contacted: boolean, lastProbe: boolean): boolean {
  return proposal.phase === "Probing" && proposal.approved && accepted && contacted && lastProbe;
}

/** Story: Book and conclude a proposal that comes together / A member can withdraw probe consent before the reveal (spec/opportunityLifecycle.md) */
//@ pure
export function lawAcceptedProbeWithdrawalNeedsExactMatch(ownText: boolean, directRefusal: boolean, otherReplyOpen: boolean, matches: number): boolean {
  //@ ensures \result === true
  return !acceptedProbeWithdrawalAllowed(ownText, directRefusal, otherReplyOpen, matches) || (matches === 1 && !otherReplyOpen);
}

/** Story: Book and conclude a proposal that comes together / A closed booking releases its pending replies (spec/opportunityLifecycle.md) */
//@ pure
export function bookedReplyCurrent(proposal: OpportunityLifecycle, accepted: boolean): boolean {
  return proposal.phase === "Scheduled" && proposal.approved && accepted;
}

/** Story: Book and conclude a proposal that comes together / A closed booking releases its pending replies (spec/opportunityLifecycle.md) */
//@ pure
export function lawBookedReplyRequiresCurrentConsent(proposal: OpportunityLifecycle, accepted: boolean): boolean {
  //@ ensures \result === true
  return !bookedReplyCurrent(proposal, accepted) || (proposal.phase === "Scheduled" && accepted);
}

/** Story: Book and conclude a proposal that comes together / An explicit cancellation selects the named upcoming meeting (spec/opportunityLifecycle.md) */
//@ pure
export function unlinkedCancellation(ownText: boolean, explicit: boolean, activeBookedSlot: boolean, namedStart: boolean, matching: number): UnlinkedCancellation {
  return !ownText || !explicit || (activeBookedSlot && !namedStart) ? "NoCancellation" : (matching === 1 ? "CancelMatchingBooking" : (matching > 1 ? "AskWhichBooking" : "NoMatchingBooking"));
}

/** Story: Book and conclude a proposal that comes together / An explicit cancellation selects the named upcoming meeting (spec/opportunityLifecycle.md) */
//@ pure
export function upcomingCancellationEligible(proposal: OpportunityLifecycle, onRoster: boolean, accepted: boolean, startKnown: boolean, startAt: number, now: number): boolean {
  return onRoster && bookedReplyCurrent(proposal, accepted) && startKnown && startAt > now;
}

/** Story: Book and conclude a proposal that comes together / An explicit cancellation selects the named upcoming meeting (spec/opportunityLifecycle.md) */
//@ pure
export function lawUnlinkedCancellationNeedsOneMatch(ownText: boolean, explicit: boolean, activeBookedSlot: boolean, namedStart: boolean, matching: number): boolean {
  //@ ensures \result === true
  return !(unlinkedCancellation(ownText, explicit, activeBookedSlot, namedStart, matching) === "CancelMatchingBooking") || (ownText && explicit && (namedStart || !activeBookedSlot) && matching === 1);
}

/** Story: Book and conclude a proposal that comes together / An explicit cancellation selects the named upcoming meeting (spec/opportunityLifecycle.md) */
//@ pure
export function lawNamedCancellationCanSelectWithPendingReply(activeBookedSlot: boolean): boolean {
  //@ ensures \result === true
  return unlinkedCancellation(true, true, activeBookedSlot, true, 1) === "CancelMatchingBooking";
}

/** Story: Book and conclude a proposal that comes together / An explicit cancellation selects the named upcoming meeting (spec/opportunityLifecycle.md) */
//@ pure
export function lawStartedBookingCannotBeSelected(proposal: OpportunityLifecycle, onRoster: boolean, accepted: boolean, startKnown: boolean, startAt: number, now: number): boolean {
  //@ ensures \result === true
  return !(startAt <= now) || !upcomingCancellationEligible(proposal, onRoster, accepted, startKnown, startAt, now);
}

/** Story: Book and conclude a proposal that comes together / A new minor signal closes an opportunity involving that person (spec/opportunityLifecycle.md) */
//@ pure
export function closesForMinor(proposal: OpportunityLifecycle, minorSignal: boolean, participant: boolean, alternate: boolean, contacted: boolean): boolean {
  return minorSignal && (((proposal.phase === "InReview" || proposal.phase === "Probing") && (participant || alternate || contacted)) || (proposal.phase === "Scheduled" && (participant || contacted)));
}

/** Story: Book and conclude a proposal that comes together / A new minor signal closes an opportunity involving that person (spec/opportunityLifecycle.md) */
//@ pure
export function bookedGroupCanContinue(remaining: number, minorSignal: boolean): boolean {
  return !minorSignal && groupCanContinue(remaining);
}

/** Story: Book and conclude a proposal that comes together / A new minor signal closes an opportunity involving that person (spec/opportunityLifecycle.md) */
//@ pure
export function minorCloseTellsAcceptor(before: OpportunityLifecycle, contacted: boolean, accepted: boolean, minor: boolean, requester: boolean): boolean {
  return before.phase === "Probing" && contacted && accepted && !minor && !requester;
}

/** Story: Book and conclude a proposal that comes together / A new minor signal closes an opportunity involving that person (spec/opportunityLifecycle.md) */
//@ pure
export function lawAskedMinorClosesABookedOpportunity(proposal: OpportunityLifecycle): boolean {
  //@ ensures \result === true
  return !(proposal.phase === "Scheduled") || closesForMinor(proposal, true, false, false, true);
}

/** Story: Book and conclude a proposal that comes together / A new minor signal closes an opportunity involving that person (spec/opportunityLifecycle.md) */
//@ pure
export function lawMinorOnTheRosterClosesABookedOpportunity(proposal: OpportunityLifecycle): boolean {
  //@ ensures \result === true
  return !(proposal.phase === "Scheduled") || closesForMinor(proposal, true, true, false, false);
}

/** Story: Book and conclude a proposal that comes together / A new minor signal closes an opportunity involving that person (spec/opportunityLifecycle.md) */
//@ pure
export function lawAMinorNeverLeavesABookedGroupRunning(proposal: OpportunityLifecycle, remaining: number): boolean {
  //@ ensures \result === true
  return !(proposal.phase === "Scheduled") || (closesForMinor(proposal, true, true, false, false) && !bookedGroupCanContinue(remaining, true) && canClose(proposal) && !canBook(close(proposal), true));
}

/** Story: Book and conclude a proposal that comes together / A new minor signal closes an opportunity involving that person (spec/opportunityLifecycle.md) */
//@ pure
export function lawOtherDropsKeepTheGroupRule(proposal: OpportunityLifecycle, remaining: number): boolean {
  //@ ensures \result === true
  return !(proposal.phase === "Scheduled" && !bookedGroupCanContinue(remaining, false)) || (remaining < 3 && canClose(proposal) && !canBook(close(proposal), true));
}

/** Story: Book and conclude a proposal that comes together / A new minor signal closes an opportunity involving that person (spec/opportunityLifecycle.md) */
//@ pure
export function lawNoMinorCloseWithoutAMinorSignal(proposal: OpportunityLifecycle, participant: boolean, alternate: boolean, contacted: boolean): boolean {
  //@ ensures \result === true
  return !closesForMinor(proposal, false, participant, alternate, contacted);
}

/** Story: Book and conclude a proposal that comes together / A new minor signal closes an opportunity involving that person (spec/opportunityLifecycle.md) */
//@ pure
export function lawMinorContactClosesAnUnbookedOpportunity(proposal: OpportunityLifecycle): boolean {
  //@ ensures \result === true
  return !(proposal.phase === "InReview" || proposal.phase === "Probing") || closesForMinor(proposal, true, false, false, true);
}

/** Story: Book and conclude a proposal that comes together / A new minor signal closes an opportunity involving that person (spec/opportunityLifecycle.md) */
//@ pure
export function lawMinorCloseNeverTellsTheMinor(before: OpportunityLifecycle, contacted: boolean, accepted: boolean, minor: boolean, requester: boolean): boolean {
  //@ ensures \result === true
  return !minorCloseTellsAcceptor(before, contacted, accepted, minor, requester) || (before.phase === "Probing" && closesForMinor(before, true, false, false, contacted) && !minor && !requester && canClose(before));
}

/** Story: Book and conclude a proposal that comes together / A minor signal ends the recurring plans that the minor knows (spec/opportunityLifecycle.md) */
//@ pure
export function recurrenceAllowed(roster: string[], knownMinors: string[], minorWasTold: boolean): boolean {
  return !minorWasTold && !roster.some((id: string) => !(!knownMinors.includes(id)));
}

/** Story: Book and conclude a proposal that comes together / A minor signal ends the recurring plans that the minor knows (spec/opportunityLifecycle.md) */
//@ pure
export function lawNoRecurrenceThatAMinorKnows(roster: string[], knownMinors: string[], minorWasTold: boolean, member: string): boolean {
  //@ ensures \result === true
  return !(minorWasTold || (roster.includes(member) && knownMinors.includes(member))) || !recurrenceAllowed(roster, knownMinors, minorWasTold);
}

/** Story: Book and conclude a proposal that comes together / A scheduled opportunity is done when feedback becomes due (spec/opportunityLifecycle.md) */
//@ pure
export function canComplete(proposal: OpportunityLifecycle, feedbackDue: boolean): boolean {
  return proposal.phase === "Scheduled" && feedbackDue;
}

/** Story: Book and conclude a proposal that comes together / A scheduled opportunity is done when feedback becomes due (spec/opportunityLifecycle.md) */
//@ pure
export function complete(proposal: OpportunityLifecycle, feedbackDue: boolean): OpportunityLifecycle {
  //@ ensures (inv(proposal) && canComplete(proposal, feedbackDue)) ==> alwaysContactStagesRequireApproval(\result)
  //@ ensures (inv(proposal) && canComplete(proposal, feedbackDue)) ==> stepRerollRequiresNewApproval(proposal, "complete", \result)
  //@ ensures (inv(proposal) && canComplete(proposal, feedbackDue)) ==> stepTerminalOpportunityCannotReopen(proposal, \result)
  return { ...proposal, phase: "Done" };
}

/** Story: Book and conclude a proposal that comes together / A scheduled opportunity is done when feedback becomes due (spec/opportunityLifecycle.md) */
//@ pure
export function canClose(proposal: OpportunityLifecycle): boolean {
  return proposal.phase === "InReview" || proposal.phase === "Probing" || proposal.phase === "Scheduled";
}

/** Story: Book and conclude a proposal that comes together / A scheduled opportunity is done when feedback becomes due (spec/opportunityLifecycle.md) */
//@ pure
export function close(proposal: OpportunityLifecycle): OpportunityLifecycle {
  //@ ensures (inv(proposal) && canClose(proposal)) ==> alwaysContactStagesRequireApproval(\result)
  //@ ensures (inv(proposal) && canClose(proposal)) ==> stepRerollRequiresNewApproval(proposal, "close", \result)
  //@ ensures (inv(proposal) && canClose(proposal)) ==> stepTerminalOpportunityCannotReopen(proposal, \result)
  return { ...proposal, phase: "Closed" };
}

/** Story: Book and conclude a proposal that comes together / A scheduled opportunity is done when feedback becomes due (spec/opportunityLifecycle.md) */
//@ pure
export function stepTerminalOpportunityCannotReopen(before: OpportunityLifecycle, after: OpportunityLifecycle): boolean {
  return !(before.phase === "Closed" || before.phase === "Done") || before.phase === after.phase;
}

/** Story: Book and conclude a proposal that comes together / A scheduled opportunity is done when feedback becomes due (spec/opportunityLifecycle.md) */
//@ pure
export function sometimesCanBook(proposal: OpportunityLifecycle): boolean {
  return proposal.phase === "Scheduled";
}

/** Story: Book and conclude a proposal that comes together / A scheduled opportunity is done when feedback becomes due (spec/opportunityLifecycle.md) */
//@ pure
export function sometimesCanComplete(proposal: OpportunityLifecycle): boolean {
  return proposal.phase === "Done";
}

/** Story: Book and conclude a proposal that comes together / A scheduled opportunity is done when feedback becomes due (spec/opportunityLifecycle.md) */
//@ pure
export function sometimesCanCloseBeforeContact(proposal: OpportunityLifecycle): boolean {
  return proposal.phase === "Closed" && !proposal.approved;
}

/** Story: Book and conclude a proposal that comes together / Closing an underfilled proposal releases the members who accepted (spec/opportunityLifecycle.md) */
//@ pure
export function releasesPartialAcceptance(before: OpportunityLifecycle, unresolved: boolean, systemProposal: boolean, contacted: boolean, accepted: boolean): boolean {
  return before.phase === "Probing" && before.approved && unresolved && systemProposal && contacted && accepted;
}

/** Story: Book and conclude a proposal that comes together / Closing an underfilled proposal releases the members who accepted (spec/opportunityLifecycle.md) */
//@ pure
export function lawReleaseNeedsAContactedAcceptor(before: OpportunityLifecycle, unresolved: boolean, systemProposal: boolean, contacted: boolean, accepted: boolean): boolean {
  //@ ensures \result === true
  return !releasesPartialAcceptance(before, unresolved, systemProposal, contacted, accepted) || (contacted && accepted);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: OpportunityLifecycle, event: Event): boolean {
  if (event.type === "startProbing") return canStartProbing(current, event.approvalRecorded, event.eligible);
  if (event.type === "reroll") return canReroll(current);
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
  if (event.type === "startProbing") return canStartProbing(current, event.approvalRecorded, event.eligible) ? startProbing(current, event.approvalRecorded, event.eligible) : current;
  if (event.type === "reroll") return canReroll(current) ? reroll(current, event.replacementFound) : current;
  if (event.type === "book") return canBook(current, event.hasConsent) ? book(current, event.hasConsent) : current;
  if (event.type === "complete") return canComplete(current, event.feedbackDue) ? complete(current, event.feedbackDue) : current;
  if (event.type === "close") return canClose(current) ? close(current) : current;
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
  if (raw.type === "reroll" && typeof raw.replacementFound === "boolean") return { type: "reroll", replacementFound: raw.replacementFound };
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
