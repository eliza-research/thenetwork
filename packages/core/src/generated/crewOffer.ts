// GENERATED from spec/crewOffer.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Opt in to a recurring crew / An open offer records who was invited (spec/crewOffer.md:9) */
export type CrewOfferPhase = "Unopened" | "Open" | "Resolved";
/** Story: Opt in to a recurring crew / An open offer records who was invited (spec/crewOffer.md:9) */
export interface CrewOfferState { phase: CrewOfferPhase; offered: string[]; yes: string[]; no: string[] }

/** One variant per transition in the spec. */
export type Event =
  | { type: "extendOffer"; memberId: string; enjoyedPlan: boolean }
  | { type: "openOffer"; invitees: string[] }
  | { type: "recordCrewAnswer"; memberId: string; accepted: boolean }
  | { type: "finishCrewAnswers" }
  | { type: "expireCrewOffer"; elapsedMs: number }
  | { type: "forgetCrewInvitee"; memberId: string };

/** Story: Opt in to a recurring crew / An offer resolves after every reply or once more than three days pass (spec/crewOffer.md:47) */
export const crewOfferWindowMs: number = 259200000;
/** Story: Opt in to a recurring crew / An open offer records who was invited (spec/crewOffer.md:9) */
export const initial: CrewOfferState = { phase: "Unopened", offered: ([] as string[]), yes: ([] as string[]), no: ([] as string[]) };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: CrewOfferState): boolean {
  return alwaysAnswersComeFromInvitees(current);
}

/** Story: Opt in to a recurring crew / An open offer records who was invited (spec/crewOffer.md:9) */
//@ pure
export function extendOffer(offer: CrewOfferState, memberId: string, enjoyedPlan: boolean): CrewOfferState {
  //@ ensures (inv(offer) && canExtendOffer(offer, memberId, enjoyedPlan)) ==> alwaysAnswersComeFromInvitees(\result)
  //@ ensures (inv(offer) && canExtendOffer(offer, memberId, enjoyedPlan)) ==> stepResolvedOfferStaysClosed(offer, \result)
  return { ...offer, offered: [...offer.offered, memberId] };
}

/** Story: Opt in to a recurring crew / An open offer records who was invited (spec/crewOffer.md:9) */
//@ pure
export function canOpenOffer(offer: CrewOfferState): boolean {
  return offer.phase === "Unopened";
}

/** Story: Opt in to a recurring crew / An open offer records who was invited (spec/crewOffer.md:9) */
//@ pure
export function openOffer(offer: CrewOfferState, invitees: string[]): CrewOfferState {
  //@ ensures (inv(offer) && canOpenOffer(offer)) ==> alwaysAnswersComeFromInvitees(\result)
  //@ ensures (inv(offer) && canOpenOffer(offer)) ==> stepResolvedOfferStaysClosed(offer, \result)
  return { phase: "Open", offered: invitees, yes: ([] as string[]), no: ([] as string[]) };
}

/** Story: Opt in to a recurring crew / An open offer records who was invited (spec/crewOffer.md:9) */
//@ pure
export function canExtendOffer(offer: CrewOfferState, memberId: string, enjoyedPlan: boolean): boolean {
  return offer.phase === "Open" && enjoyedPlan && !offer.offered.includes(memberId);
}

/** Story: Opt in to a recurring crew / Each invited member can reply once (spec/crewOffer.md:30) */
//@ pure
export function canRecordCrewAnswer(offer: CrewOfferState, memberId: string): boolean {
  return offer.phase === "Open" && offer.offered.includes(memberId) && !offer.yes.includes(memberId) && !offer.no.includes(memberId);
}

/** Story: Opt in to a recurring crew / Each invited member can reply once (spec/crewOffer.md:30) */
//@ pure
export function recordCrewAnswer(offer: CrewOfferState, memberId: string, accepted: boolean): CrewOfferState {
  //@ ensures (inv(offer) && canRecordCrewAnswer(offer, memberId)) ==> alwaysAnswersComeFromInvitees(\result)
  //@ ensures (inv(offer) && canRecordCrewAnswer(offer, memberId)) ==> stepResolvedOfferStaysClosed(offer, \result)
  return accepted ? ({ ...offer, yes: [...offer.yes, memberId] } as CrewOfferState) : ({ ...offer, no: [...offer.no, memberId] } as CrewOfferState);
}

/** Story: Opt in to a recurring crew / Each invited member can reply once (spec/crewOffer.md:30) */
//@ pure
export function alwaysAnswersComeFromInvitees(offer: CrewOfferState): boolean {
  return offer.yes.every((id: string) => offer.offered.includes(id)) && offer.no.every((id: string) => offer.offered.includes(id));
}

/** Story: Opt in to a recurring crew / An offer resolves after every reply or once more than three days pass (spec/crewOffer.md:47) */
//@ pure
export function canFinishCrewAnswers(offer: CrewOfferState): boolean {
  return offer.phase === "Open" && offer.yes.length + offer.no.length >= offer.offered.length;
}

/** Story: Opt in to a recurring crew / An offer resolves after every reply or once more than three days pass (spec/crewOffer.md:47) */
//@ pure
export function finishCrewAnswers(offer: CrewOfferState): CrewOfferState {
  //@ ensures (inv(offer) && canFinishCrewAnswers(offer)) ==> alwaysAnswersComeFromInvitees(\result)
  //@ ensures (inv(offer) && canFinishCrewAnswers(offer)) ==> stepResolvedOfferStaysClosed(offer, \result)
  return { ...offer, phase: "Resolved" };
}

/** Story: Opt in to a recurring crew / An offer resolves after every reply or once more than three days pass (spec/crewOffer.md:47) */
//@ pure
export function canExpireCrewOffer(offer: CrewOfferState, elapsedMs: number): boolean {
  return offer.phase === "Open" && elapsedMs > crewOfferWindowMs;
}

/** Story: Opt in to a recurring crew / An offer resolves after every reply or once more than three days pass (spec/crewOffer.md:47) */
//@ pure
export function expireCrewOffer(offer: CrewOfferState, elapsedMs: number): CrewOfferState {
  //@ ensures (inv(offer) && canExpireCrewOffer(offer, elapsedMs)) ==> alwaysAnswersComeFromInvitees(\result)
  //@ ensures (inv(offer) && canExpireCrewOffer(offer, elapsedMs)) ==> stepResolvedOfferStaysClosed(offer, \result)
  return { ...offer, phase: "Resolved" };
}

/** Story: Opt in to a recurring crew / An offer resolves after every reply or once more than three days pass (spec/crewOffer.md:47) */
//@ pure
export function stepResolvedOfferStaysClosed(before: CrewOfferState, after: CrewOfferState): boolean {
  return !(before.phase === "Resolved") || after.phase === "Resolved";
}

/** Story: Opt in to a recurring crew / An offer resolves after every reply or once more than three days pass (spec/crewOffer.md:47) */
//@ pure
export function sometimesResolvedWithAllAnswers(offer: CrewOfferState): boolean {
  return offer.phase === "Resolved" && offer.offered.length > 0 && offer.yes.length + offer.no.length === offer.offered.length;
}

/** Story: Opt in to a recurring crew / An offer resolves after every reply or once more than three days pass (spec/crewOffer.md:47) */
//@ pure
export function sometimesCrewOfferClosesWithRepliesMissing(offer: CrewOfferState): boolean {
  return offer.phase === "Resolved" && offer.yes.length + offer.no.length < offer.offered.length;
}

/** Story: Opt in to a recurring crew / Erasing a member removes their invitation and answer (spec/crewOffer.md:76) */
//@ pure
export function canForgetCrewInvitee(offer: CrewOfferState): boolean {
  return offer.phase !== "Unopened";
}

/** Story: Opt in to a recurring crew / Erasing a member removes their invitation and answer (spec/crewOffer.md:76) */
//@ pure
export function forgetCrewInvitee(offer: CrewOfferState, memberId: string): CrewOfferState {
  //@ ensures (inv(offer) && canForgetCrewInvitee(offer)) ==> alwaysAnswersComeFromInvitees(\result)
  //@ ensures (inv(offer) && canForgetCrewInvitee(offer)) ==> stepResolvedOfferStaysClosed(offer, \result)
  return { ...offer, offered: offer.offered.filter((id: string) => id !== memberId), yes: offer.yes.filter((id: string) => id !== memberId), no: offer.no.filter((id: string) => id !== memberId) };
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: CrewOfferState, event: Event): boolean {
  if (event.type === "extendOffer") return canExtendOffer(current, event.memberId, event.enjoyedPlan);
  if (event.type === "openOffer") return canOpenOffer(current);
  if (event.type === "recordCrewAnswer") return canRecordCrewAnswer(current, event.memberId);
  if (event.type === "finishCrewAnswers") return canFinishCrewAnswers(current);
  if (event.type === "expireCrewOffer") return canExpireCrewOffer(current, event.elapsedMs);
  if (event.type === "forgetCrewInvitee") return canForgetCrewInvitee(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: CrewOfferState, event: Event): CrewOfferState {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "extendOffer" && canExtendOffer(current, event.memberId, event.enjoyedPlan)) return extendOffer(current, event.memberId, event.enjoyedPlan);
  if (event.type === "openOffer" && canOpenOffer(current)) return openOffer(current, event.invitees);
  if (event.type === "recordCrewAnswer" && canRecordCrewAnswer(current, event.memberId)) return recordCrewAnswer(current, event.memberId, event.accepted);
  if (event.type === "finishCrewAnswers" && canFinishCrewAnswers(current)) return finishCrewAnswers(current);
  if (event.type === "expireCrewOffer" && canExpireCrewOffer(current, event.elapsedMs)) return expireCrewOffer(current, event.elapsedMs);
  if (event.type === "forgetCrewInvitee" && canForgetCrewInvitee(current)) return forgetCrewInvitee(current, event.memberId);
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
  if (raw.type === "extendOffer" && typeof raw.memberId === "string" && typeof raw.enjoyedPlan === "boolean") return { type: "extendOffer", memberId: raw.memberId, enjoyedPlan: raw.enjoyedPlan };
  if (raw.type === "openOffer" && Array.isArray(raw.invitees) && raw.invitees.every((x0: any) => typeof x0 === "string")) return { type: "openOffer", invitees: raw.invitees.map((x0: any) => x0) };
  if (raw.type === "recordCrewAnswer" && typeof raw.memberId === "string" && typeof raw.accepted === "boolean") return { type: "recordCrewAnswer", memberId: raw.memberId, accepted: raw.accepted };
  if (raw.type === "finishCrewAnswers") return { type: "finishCrewAnswers" };
  if (raw.type === "expireCrewOffer" && Number.isSafeInteger(raw.elapsedMs)) return { type: "expireCrewOffer", elapsedMs: raw.elapsedMs };
  if (raw.type === "forgetCrewInvitee" && typeof raw.memberId === "string") return { type: "forgetCrewInvitee", memberId: raw.memberId };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): CrewOfferState | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Unopened" || raw.phase === "Open" || raw.phase === "Resolved") && Array.isArray(raw.offered) && raw.offered.every((x1: any) => typeof x1 === "string") && Array.isArray(raw.yes) && raw.yes.every((x1: any) => typeof x1 === "string") && Array.isArray(raw.no) && raw.no.every((x1: any) => typeof x1 === "string") && Object.keys(raw).length === 4)) return undefined;
  const parsed: CrewOfferState = ({ phase: raw.phase, offered: raw.offered.map((x1: any) => x1), yes: raw.yes.map((x1: any) => x1), no: raw.no.map((x1: any) => x1) });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): CrewOfferState {
  //@ ensures inv(\result)
  return initial;
}
