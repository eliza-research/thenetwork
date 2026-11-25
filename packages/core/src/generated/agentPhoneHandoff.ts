// GENERATED from spec/agentPhoneHandoff.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Confirm my own phone during signup / Offer one app-bound confirmation after the person approves the draft (spec/agentPhoneHandoff.md) */
export type Approval = "ApproveExact" | "AskChanges" | "DeclineSignup";
/** Story: Confirm my own phone during signup / Offer one app-bound confirmation after the person approves the draft (spec/agentPhoneHandoff.md) */
export type HandoffPhase = "DraftingHandoff" | "AwaitingPhoneConfirmation" | "AwaitingSignupGrant" | "ReadyForSignupProfile" | "AwaitingSignupReadBack" | "SignupProfileSaved" | "SignupProfileUnconfirmed" | "HandoffRefused";
/** Story: Confirm my own phone during signup / Offer one app-bound confirmation after the person approves the draft (spec/agentPhoneHandoff.md) */
export interface PhoneHandoff { phase: HandoffPhase; approvedDraft: boolean; verifiedEnrollment: boolean; matchingGrant: boolean }

/** One variant per transition in the spec. */
export type Event =
  | { type: "decideApproval"; decision: Approval }
  | { type: "offerHandoff"; linkAvailable: boolean }
  | { type: "observeBrowser" }
  | { type: "checkSiteStatus"; siteApp: boolean }
  | { type: "submitProfile"; accepted: boolean }
  | { type: "confirmProfile"; stillLive: boolean };

/** Story: Confirm my own phone during signup / Offer one app-bound confirmation after the person approves the draft (spec/agentPhoneHandoff.md) */
export const initial: PhoneHandoff = { phase: "DraftingHandoff", approvedDraft: false, verifiedEnrollment: false, matchingGrant: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: PhoneHandoff): boolean {
  return alwaysHandoffNeedsPriorApproval(current) && alwaysSignupWriteNeedsVerifiedAuthority(current) && alwaysGrantFollowsVerifiedEnrollment(current);
}

/** Story: Confirm my own phone during signup / Offer one app-bound confirmation after the person approves the draft (spec/agentPhoneHandoff.md) */
//@ pure
export function decideApproval(handoff: PhoneHandoff, decision: Approval): PhoneHandoff {
  //@ ensures (inv(handoff) && canDecideApproval(handoff)) ==> alwaysHandoffNeedsPriorApproval(\result)
  //@ ensures (inv(handoff) && canDecideApproval(handoff)) ==> alwaysSignupWriteNeedsVerifiedAuthority(\result)
  //@ ensures (inv(handoff) && canDecideApproval(handoff)) ==> alwaysGrantFollowsVerifiedEnrollment(\result)
  //@ ensures (inv(handoff) && canDecideApproval(handoff)) ==> stepOfferFollowsApproval(handoff, "decideApproval", \result)
  //@ ensures (inv(handoff) && canDecideApproval(handoff)) ==> stepHandoffSaveRequiresReadBack(handoff, "decideApproval", \result)
  return { ...handoff, approvedDraft: decision === "ApproveExact" };
}

/** Story: Confirm my own phone during signup / Offer one app-bound confirmation after the person approves the draft (spec/agentPhoneHandoff.md) */
//@ pure
export function canOfferHandoff(handoff: PhoneHandoff): boolean {
  return handoff.phase === "DraftingHandoff" && handoff.approvedDraft;
}

/** Story: Confirm my own phone during signup / Offer one app-bound confirmation after the person approves the draft (spec/agentPhoneHandoff.md) */
//@ pure
export function offerHandoff(handoff: PhoneHandoff, linkAvailable: boolean): PhoneHandoff {
  //@ ensures (inv(handoff) && canOfferHandoff(handoff)) ==> alwaysHandoffNeedsPriorApproval(\result)
  //@ ensures (inv(handoff) && canOfferHandoff(handoff)) ==> alwaysSignupWriteNeedsVerifiedAuthority(\result)
  //@ ensures (inv(handoff) && canOfferHandoff(handoff)) ==> alwaysGrantFollowsVerifiedEnrollment(\result)
  //@ ensures (inv(handoff) && canOfferHandoff(handoff)) ==> stepOfferFollowsApproval(handoff, "offerHandoff", \result)
  //@ ensures (inv(handoff) && canOfferHandoff(handoff)) ==> stepHandoffSaveRequiresReadBack(handoff, "offerHandoff", \result)
  return { ...handoff, phase: linkAvailable ? "AwaitingPhoneConfirmation" : "HandoffRefused" };
}

/** Story: Confirm my own phone during signup / Offer one app-bound confirmation after the person approves the draft (spec/agentPhoneHandoff.md) */
//@ pure
export function alwaysHandoffNeedsPriorApproval(handoff: PhoneHandoff): boolean {
  return !(handoff.phase !== "DraftingHandoff" && handoff.phase !== "HandoffRefused") || handoff.approvedDraft;
}

/** Story: Confirm my own phone during signup / Offer one app-bound confirmation after the person approves the draft (spec/agentPhoneHandoff.md) */
//@ pure
export function stepOfferFollowsApproval(before: PhoneHandoff, via: string, after: PhoneHandoff): boolean {
  return !(after.phase === "AwaitingPhoneConfirmation" && before.phase !== "AwaitingPhoneConfirmation") || (via === "offerHandoff" && before.approvedDraft);
}

/** Story: Confirm my own phone during signup / Offer one app-bound confirmation after the person approves the draft (spec/agentPhoneHandoff.md) */
//@ pure
export function canDecideApproval(handoff: PhoneHandoff): boolean {
  return handoff.phase === "DraftingHandoff" && !handoff.approvedDraft;
}

/** Story: Confirm my own phone during signup / Only the browser and the authorized connector complete the handoff (spec/agentPhoneHandoff.md) */
//@ pure
export function canObserveBrowser(handoff: PhoneHandoff): boolean {
  return handoff.phase === "AwaitingPhoneConfirmation" && handoff.approvedDraft;
}

/** Story: Confirm my own phone during signup / Only the browser and the authorized connector complete the handoff (spec/agentPhoneHandoff.md) */
//@ pure
export function observeBrowser(handoff: PhoneHandoff): PhoneHandoff {
  //@ ensures (inv(handoff) && canObserveBrowser(handoff)) ==> alwaysHandoffNeedsPriorApproval(\result)
  //@ ensures (inv(handoff) && canObserveBrowser(handoff)) ==> alwaysSignupWriteNeedsVerifiedAuthority(\result)
  //@ ensures (inv(handoff) && canObserveBrowser(handoff)) ==> alwaysGrantFollowsVerifiedEnrollment(\result)
  //@ ensures (inv(handoff) && canObserveBrowser(handoff)) ==> stepOfferFollowsApproval(handoff, "observeBrowser", \result)
  //@ ensures (inv(handoff) && canObserveBrowser(handoff)) ==> stepHandoffSaveRequiresReadBack(handoff, "observeBrowser", \result)
  return { ...handoff, verifiedEnrollment: true, phase: "AwaitingSignupGrant" };
}

/** Story: Confirm my own phone during signup / Only the browser and the authorized connector complete the handoff (spec/agentPhoneHandoff.md) */
//@ pure
export function canCheckSiteStatus(handoff: PhoneHandoff): boolean {
  return handoff.phase === "AwaitingSignupGrant" && handoff.verifiedEnrollment;
}

/** Story: Confirm my own phone during signup / Only the browser and the authorized connector complete the handoff (spec/agentPhoneHandoff.md) */
//@ pure
export function checkSiteStatus(handoff: PhoneHandoff, siteApp: boolean): PhoneHandoff {
  //@ ensures (inv(handoff) && canCheckSiteStatus(handoff)) ==> alwaysHandoffNeedsPriorApproval(\result)
  //@ ensures (inv(handoff) && canCheckSiteStatus(handoff)) ==> alwaysSignupWriteNeedsVerifiedAuthority(\result)
  //@ ensures (inv(handoff) && canCheckSiteStatus(handoff)) ==> alwaysGrantFollowsVerifiedEnrollment(\result)
  //@ ensures (inv(handoff) && canCheckSiteStatus(handoff)) ==> stepOfferFollowsApproval(handoff, "checkSiteStatus", \result)
  //@ ensures (inv(handoff) && canCheckSiteStatus(handoff)) ==> stepHandoffSaveRequiresReadBack(handoff, "checkSiteStatus", \result)
  return { ...handoff, matchingGrant: siteApp, phase: siteApp ? "ReadyForSignupProfile" : "HandoffRefused" };
}

/** Story: Confirm my own phone during signup / Only the browser and the authorized connector complete the handoff (spec/agentPhoneHandoff.md) */
//@ pure
export function alwaysSignupWriteNeedsVerifiedAuthority(handoff: PhoneHandoff): boolean {
  return !(handoff.phase === "ReadyForSignupProfile" || handoff.phase === "AwaitingSignupReadBack" || handoff.phase === "SignupProfileSaved" || handoff.phase === "SignupProfileUnconfirmed") || (handoff.verifiedEnrollment && handoff.matchingGrant);
}

/** Story: Confirm my own phone during signup / Only the browser and the authorized connector complete the handoff (spec/agentPhoneHandoff.md) */
//@ pure
export function alwaysGrantFollowsVerifiedEnrollment(handoff: PhoneHandoff): boolean {
  return !handoff.matchingGrant || (handoff.verifiedEnrollment && handoff.approvedDraft);
}

/** Story: Confirm my own phone during signup / Submit the approved profile once and read back the result (spec/agentPhoneHandoff.md) */
//@ pure
export function canSubmitProfile(handoff: PhoneHandoff): boolean {
  return handoff.phase === "ReadyForSignupProfile" && handoff.matchingGrant;
}

/** Story: Confirm my own phone during signup / Submit the approved profile once and read back the result (spec/agentPhoneHandoff.md) */
//@ pure
export function submitProfile(handoff: PhoneHandoff, accepted: boolean): PhoneHandoff {
  //@ ensures (inv(handoff) && canSubmitProfile(handoff)) ==> alwaysHandoffNeedsPriorApproval(\result)
  //@ ensures (inv(handoff) && canSubmitProfile(handoff)) ==> alwaysSignupWriteNeedsVerifiedAuthority(\result)
  //@ ensures (inv(handoff) && canSubmitProfile(handoff)) ==> alwaysGrantFollowsVerifiedEnrollment(\result)
  //@ ensures (inv(handoff) && canSubmitProfile(handoff)) ==> stepOfferFollowsApproval(handoff, "submitProfile", \result)
  //@ ensures (inv(handoff) && canSubmitProfile(handoff)) ==> stepHandoffSaveRequiresReadBack(handoff, "submitProfile", \result)
  return { ...handoff, phase: accepted ? "AwaitingSignupReadBack" : "HandoffRefused" };
}

/** Story: Confirm my own phone during signup / Submit the approved profile once and read back the result (spec/agentPhoneHandoff.md) */
//@ pure
export function canConfirmProfile(handoff: PhoneHandoff): boolean {
  return handoff.phase === "AwaitingSignupReadBack";
}

/** Story: Confirm my own phone during signup / Submit the approved profile once and read back the result (spec/agentPhoneHandoff.md) */
//@ pure
export function confirmProfile(handoff: PhoneHandoff, stillLive: boolean): PhoneHandoff {
  //@ ensures (inv(handoff) && canConfirmProfile(handoff)) ==> alwaysHandoffNeedsPriorApproval(\result)
  //@ ensures (inv(handoff) && canConfirmProfile(handoff)) ==> alwaysSignupWriteNeedsVerifiedAuthority(\result)
  //@ ensures (inv(handoff) && canConfirmProfile(handoff)) ==> alwaysGrantFollowsVerifiedEnrollment(\result)
  //@ ensures (inv(handoff) && canConfirmProfile(handoff)) ==> stepOfferFollowsApproval(handoff, "confirmProfile", \result)
  //@ ensures (inv(handoff) && canConfirmProfile(handoff)) ==> stepHandoffSaveRequiresReadBack(handoff, "confirmProfile", \result)
  return { ...handoff, phase: stillLive ? "SignupProfileSaved" : "SignupProfileUnconfirmed" };
}

/** Story: Confirm my own phone during signup / Submit the approved profile once and read back the result (spec/agentPhoneHandoff.md) */
//@ pure
export function stepHandoffSaveRequiresReadBack(before: PhoneHandoff, via: string, after: PhoneHandoff): boolean {
  return !(after.phase === "SignupProfileSaved") || (before.phase === "AwaitingSignupReadBack" && via === "confirmProfile");
}

/** Story: Confirm my own phone during signup / Submit the approved profile once and read back the result (spec/agentPhoneHandoff.md) */
//@ pure
export function sometimesSignupProfileSaved(handoff: PhoneHandoff): boolean {
  return handoff.phase === "SignupProfileSaved";
}

/** Story: Confirm my own phone during signup / Submit the approved profile once and read back the result (spec/agentPhoneHandoff.md) */
//@ pure
export function sometimesSignupProfileUnconfirmed(handoff: PhoneHandoff): boolean {
  return handoff.phase === "SignupProfileUnconfirmed";
}

/** Story: Confirm my own phone during signup / Submit the approved profile once and read back the result (spec/agentPhoneHandoff.md) */
//@ pure
export function sometimesHandoffRefused(handoff: PhoneHandoff): boolean {
  return handoff.phase === "HandoffRefused";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: PhoneHandoff, event: Event): boolean {
  if (event.type === "decideApproval") return canDecideApproval(current);
  if (event.type === "offerHandoff") return canOfferHandoff(current);
  if (event.type === "observeBrowser") return canObserveBrowser(current);
  if (event.type === "checkSiteStatus") return canCheckSiteStatus(current);
  if (event.type === "submitProfile") return canSubmitProfile(current);
  if (event.type === "confirmProfile") return canConfirmProfile(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: PhoneHandoff, event: Event): PhoneHandoff {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "decideApproval") return canDecideApproval(current) ? decideApproval(current, event.decision) : current;
  if (event.type === "offerHandoff") return canOfferHandoff(current) ? offerHandoff(current, event.linkAvailable) : current;
  if (event.type === "observeBrowser") return canObserveBrowser(current) ? observeBrowser(current) : current;
  if (event.type === "checkSiteStatus") return canCheckSiteStatus(current) ? checkSiteStatus(current, event.siteApp) : current;
  if (event.type === "submitProfile") return canSubmitProfile(current) ? submitProfile(current, event.accepted) : current;
  if (event.type === "confirmProfile") return canConfirmProfile(current) ? confirmProfile(current, event.stillLive) : current;
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
  if (raw.type === "decideApproval" && (raw.decision === "ApproveExact" || raw.decision === "AskChanges" || raw.decision === "DeclineSignup")) return { type: "decideApproval", decision: raw.decision };
  if (raw.type === "offerHandoff" && typeof raw.linkAvailable === "boolean") return { type: "offerHandoff", linkAvailable: raw.linkAvailable };
  if (raw.type === "observeBrowser") return { type: "observeBrowser" };
  if (raw.type === "checkSiteStatus" && typeof raw.siteApp === "boolean") return { type: "checkSiteStatus", siteApp: raw.siteApp };
  if (raw.type === "submitProfile" && typeof raw.accepted === "boolean") return { type: "submitProfile", accepted: raw.accepted };
  if (raw.type === "confirmProfile" && typeof raw.stillLive === "boolean") return { type: "confirmProfile", stillLive: raw.stillLive };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): PhoneHandoff | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "DraftingHandoff" || raw.phase === "AwaitingPhoneConfirmation" || raw.phase === "AwaitingSignupGrant" || raw.phase === "ReadyForSignupProfile" || raw.phase === "AwaitingSignupReadBack" || raw.phase === "SignupProfileSaved" || raw.phase === "SignupProfileUnconfirmed" || raw.phase === "HandoffRefused") && typeof raw.approvedDraft === "boolean" && typeof raw.verifiedEnrollment === "boolean" && typeof raw.matchingGrant === "boolean" && Object.keys(raw).length === 4)) return undefined;
  const parsed: PhoneHandoff = ({ phase: raw.phase, approvedDraft: raw.approvedDraft, verifiedEnrollment: raw.verifiedEnrollment, matchingGrant: raw.matchingGrant });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): PhoneHandoff {
  //@ ensures inv(\result)
  return initial;
}
