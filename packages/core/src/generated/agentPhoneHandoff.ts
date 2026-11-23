// GENERATED from spec/agentPhoneHandoff.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Confirm my own phone during signup / Offer one app-bound confirmation after the person approves the draft (spec/agentPhoneHandoff.md) */
export type HandoffPhase = "DraftingHandoff" | "AwaitingPhoneConfirmation" | "AwaitingSignupGrant" | "ReadyForSignupProfile" | "AwaitingSignupReadBack" | "SignupProfileSaved" | "SignupProfileUnconfirmed" | "HandoffRefused";
/** Story: Confirm my own phone during signup / Offer one app-bound confirmation after the person approves the draft (spec/agentPhoneHandoff.md) */
export interface PhoneHandoff { phase: HandoffPhase; approvedDraft: boolean; verifiedEnrollment: boolean; matchingGrant: boolean }
/** Story: Confirm my own phone during signup / Only the browser and the authorized connector complete the handoff (spec/agentPhoneHandoff.md) */
export interface SignupConfirmation { sameApp: boolean; ownerVerified: boolean; eligibleEnrollment: boolean; requestLive: boolean }

/** One variant per transition in the spec. */
export type Event =
  | { type: "offerSignupHandoff"; approved: boolean }
  | { type: "confirmSignupPhone"; confirmation: SignupConfirmation }
  | { type: "recordSignupGrant"; appMatches: boolean; ownerMatches: boolean; writeScopeLive: boolean }
  | { type: "submitHandoffProfile"; authorityLive: boolean; exactProfile: boolean }
  | { type: "readHandoffProfile"; exactSavedProfile: boolean };

/** Story: Confirm my own phone during signup / Only the browser and the authorized connector complete the handoff (spec/agentPhoneHandoff.md) */
export const validSignupConfirmation: SignupConfirmation = { sameApp: true, ownerVerified: true, eligibleEnrollment: true, requestLive: true };
/** Story: Confirm my own phone during signup / Offer one app-bound confirmation after the person approves the draft (spec/agentPhoneHandoff.md) */
export const initial: PhoneHandoff = { phase: "DraftingHandoff", approvedDraft: false, verifiedEnrollment: false, matchingGrant: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: PhoneHandoff): boolean {
  return alwaysHandoffNeedsPriorApproval(current) && alwaysSignupWriteNeedsVerifiedAuthority(current);
}

/** Story: Confirm my own phone during signup / Offer one app-bound confirmation after the person approves the draft (spec/agentPhoneHandoff.md) */
//@ pure
export function alwaysHandoffNeedsPriorApproval(handoff: PhoneHandoff): boolean {
  return !(handoff.phase !== "DraftingHandoff" && handoff.phase !== "HandoffRefused") || handoff.approvedDraft;
}

/** Story: Confirm my own phone during signup / Offer one app-bound confirmation after the person approves the draft (spec/agentPhoneHandoff.md) */
//@ pure
export function canOfferSignupHandoff(handoff: PhoneHandoff): boolean {
  return handoff.phase === "DraftingHandoff";
}

/** Story: Confirm my own phone during signup / Offer one app-bound confirmation after the person approves the draft (spec/agentPhoneHandoff.md) */
//@ pure
export function offerSignupHandoff(handoff: PhoneHandoff, approved: boolean): PhoneHandoff {
  //@ ensures (inv(handoff) && canOfferSignupHandoff(handoff)) ==> alwaysHandoffNeedsPriorApproval(\result)
  //@ ensures (inv(handoff) && canOfferSignupHandoff(handoff)) ==> alwaysSignupWriteNeedsVerifiedAuthority(\result)
  //@ ensures (inv(handoff) && canOfferSignupHandoff(handoff)) ==> stepHandoffSaveRequiresReadBack(handoff, "offerSignupHandoff", \result)
  return { ...handoff, approvedDraft: approved, phase: approved ? "AwaitingPhoneConfirmation" : "HandoffRefused" };
}

/** Story: Confirm my own phone during signup / Only the browser and the authorized connector complete the handoff (spec/agentPhoneHandoff.md) */
//@ pure
export function canConfirmSignupPhone(handoff: PhoneHandoff): boolean {
  return handoff.phase === "AwaitingPhoneConfirmation" && handoff.approvedDraft;
}

/** Story: Confirm my own phone during signup / Only the browser and the authorized connector complete the handoff (spec/agentPhoneHandoff.md) */
//@ pure
export function confirmSignupPhone(handoff: PhoneHandoff, confirmation: SignupConfirmation): PhoneHandoff {
  //@ ensures (inv(handoff) && canConfirmSignupPhone(handoff)) ==> alwaysHandoffNeedsPriorApproval(\result)
  //@ ensures (inv(handoff) && canConfirmSignupPhone(handoff)) ==> alwaysSignupWriteNeedsVerifiedAuthority(\result)
  //@ ensures (inv(handoff) && canConfirmSignupPhone(handoff)) ==> stepHandoffSaveRequiresReadBack(handoff, "confirmSignupPhone", \result)
  const local_0 = confirmation.sameApp && confirmation.ownerVerified && confirmation.eligibleEnrollment && confirmation.requestLive;
  return { ...handoff, verifiedEnrollment: local_0, phase: local_0 ? "AwaitingSignupGrant" : "HandoffRefused" };
}

/** Story: Confirm my own phone during signup / Only the browser and the authorized connector complete the handoff (spec/agentPhoneHandoff.md) */
//@ pure
export function canRecordSignupGrant(handoff: PhoneHandoff): boolean {
  return handoff.phase === "AwaitingSignupGrant" && handoff.verifiedEnrollment;
}

/** Story: Confirm my own phone during signup / Only the browser and the authorized connector complete the handoff (spec/agentPhoneHandoff.md) */
//@ pure
export function recordSignupGrant(handoff: PhoneHandoff, appMatches: boolean, ownerMatches: boolean, writeScopeLive: boolean): PhoneHandoff {
  //@ ensures (inv(handoff) && canRecordSignupGrant(handoff)) ==> alwaysHandoffNeedsPriorApproval(\result)
  //@ ensures (inv(handoff) && canRecordSignupGrant(handoff)) ==> alwaysSignupWriteNeedsVerifiedAuthority(\result)
  //@ ensures (inv(handoff) && canRecordSignupGrant(handoff)) ==> stepHandoffSaveRequiresReadBack(handoff, "recordSignupGrant", \result)
  const local_1 = appMatches && ownerMatches && writeScopeLive;
  return { ...handoff, matchingGrant: local_1, phase: local_1 ? "ReadyForSignupProfile" : "HandoffRefused" };
}

/** Story: Confirm my own phone during signup / Only the browser and the authorized connector complete the handoff (spec/agentPhoneHandoff.md) */
//@ pure
export function alwaysSignupWriteNeedsVerifiedAuthority(handoff: PhoneHandoff): boolean {
  return !(handoff.phase === "ReadyForSignupProfile" || handoff.phase === "AwaitingSignupReadBack" || handoff.phase === "SignupProfileSaved" || handoff.phase === "SignupProfileUnconfirmed") || (handoff.verifiedEnrollment && handoff.matchingGrant);
}

/** Story: Confirm my own phone during signup / Submit the approved profile once and read back the result (spec/agentPhoneHandoff.md) */
//@ pure
export function canSubmitHandoffProfile(handoff: PhoneHandoff): boolean {
  return handoff.phase === "ReadyForSignupProfile" && handoff.matchingGrant;
}

/** Story: Confirm my own phone during signup / Submit the approved profile once and read back the result (spec/agentPhoneHandoff.md) */
//@ pure
export function submitHandoffProfile(handoff: PhoneHandoff, authorityLive: boolean, exactProfile: boolean): PhoneHandoff {
  //@ ensures (inv(handoff) && canSubmitHandoffProfile(handoff)) ==> alwaysHandoffNeedsPriorApproval(\result)
  //@ ensures (inv(handoff) && canSubmitHandoffProfile(handoff)) ==> alwaysSignupWriteNeedsVerifiedAuthority(\result)
  //@ ensures (inv(handoff) && canSubmitHandoffProfile(handoff)) ==> stepHandoffSaveRequiresReadBack(handoff, "submitHandoffProfile", \result)
  return { ...handoff, phase: authorityLive && exactProfile ? "AwaitingSignupReadBack" : "HandoffRefused" };
}

/** Story: Confirm my own phone during signup / Submit the approved profile once and read back the result (spec/agentPhoneHandoff.md) */
//@ pure
export function canReadHandoffProfile(handoff: PhoneHandoff): boolean {
  return handoff.phase === "AwaitingSignupReadBack";
}

/** Story: Confirm my own phone during signup / Submit the approved profile once and read back the result (spec/agentPhoneHandoff.md) */
//@ pure
export function readHandoffProfile(handoff: PhoneHandoff, exactSavedProfile: boolean): PhoneHandoff {
  //@ ensures (inv(handoff) && canReadHandoffProfile(handoff)) ==> alwaysHandoffNeedsPriorApproval(\result)
  //@ ensures (inv(handoff) && canReadHandoffProfile(handoff)) ==> alwaysSignupWriteNeedsVerifiedAuthority(\result)
  //@ ensures (inv(handoff) && canReadHandoffProfile(handoff)) ==> stepHandoffSaveRequiresReadBack(handoff, "readHandoffProfile", \result)
  return { ...handoff, phase: exactSavedProfile ? "SignupProfileSaved" : "SignupProfileUnconfirmed" };
}

/** Story: Confirm my own phone during signup / Submit the approved profile once and read back the result (spec/agentPhoneHandoff.md) */
//@ pure
export function stepHandoffSaveRequiresReadBack(before: PhoneHandoff, via: string, after: PhoneHandoff): boolean {
  return !(after.phase === "SignupProfileSaved") || (before.phase === "AwaitingSignupReadBack" && via === "readHandoffProfile");
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

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: PhoneHandoff, event: Event): boolean {
  if (event.type === "offerSignupHandoff") return canOfferSignupHandoff(current);
  if (event.type === "confirmSignupPhone") return canConfirmSignupPhone(current);
  if (event.type === "recordSignupGrant") return canRecordSignupGrant(current);
  if (event.type === "submitHandoffProfile") return canSubmitHandoffProfile(current);
  if (event.type === "readHandoffProfile") return canReadHandoffProfile(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: PhoneHandoff, event: Event): PhoneHandoff {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "offerSignupHandoff") return canOfferSignupHandoff(current) ? offerSignupHandoff(current, event.approved) : current;
  if (event.type === "confirmSignupPhone") return canConfirmSignupPhone(current) ? confirmSignupPhone(current, event.confirmation) : current;
  if (event.type === "recordSignupGrant") return canRecordSignupGrant(current) ? recordSignupGrant(current, event.appMatches, event.ownerMatches, event.writeScopeLive) : current;
  if (event.type === "submitHandoffProfile") return canSubmitHandoffProfile(current) ? submitHandoffProfile(current, event.authorityLive, event.exactProfile) : current;
  if (event.type === "readHandoffProfile") return canReadHandoffProfile(current) ? readHandoffProfile(current, event.exactSavedProfile) : current;
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
  const is_SignupConfirmation = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && typeof v.sameApp === "boolean" && typeof v.ownerVerified === "boolean" && typeof v.eligibleEnrollment === "boolean" && typeof v.requestLive === "boolean";
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "offerSignupHandoff" && typeof raw.approved === "boolean") return { type: "offerSignupHandoff", approved: raw.approved };
  if (raw.type === "confirmSignupPhone" && is_SignupConfirmation(raw.confirmation)) return { type: "confirmSignupPhone", confirmation: ({ sameApp: raw.confirmation.sameApp, ownerVerified: raw.confirmation.ownerVerified, eligibleEnrollment: raw.confirmation.eligibleEnrollment, requestLive: raw.confirmation.requestLive }) };
  if (raw.type === "recordSignupGrant" && typeof raw.appMatches === "boolean" && typeof raw.ownerMatches === "boolean" && typeof raw.writeScopeLive === "boolean") return { type: "recordSignupGrant", appMatches: raw.appMatches, ownerMatches: raw.ownerMatches, writeScopeLive: raw.writeScopeLive };
  if (raw.type === "submitHandoffProfile" && typeof raw.authorityLive === "boolean" && typeof raw.exactProfile === "boolean") return { type: "submitHandoffProfile", authorityLive: raw.authorityLive, exactProfile: raw.exactProfile };
  if (raw.type === "readHandoffProfile" && typeof raw.exactSavedProfile === "boolean") return { type: "readHandoffProfile", exactSavedProfile: raw.exactSavedProfile };
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
