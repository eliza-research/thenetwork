// GENERATED from spec/cloudSignIn.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md:9) */
export interface HandoffFacts { bindingValid: boolean; pendingLive: boolean; codeWellFormed: boolean }
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md:9) */
export type SignInPhase = "AwaitingHandoff" | "AwaitingExchange" | "AwaitingIdentity" | "AwaitingPhone" | "AwaitingSession" | "SignedIn" | "RejectCallback" | "DenySignIn";
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md:9) */
export interface SignIn { phase: SignInPhase; handoffAccepted: boolean; exchangeAccepted: boolean; identityAccepted: boolean; phoneAllowed: boolean }

/** One variant per transition in the spec. */
export type Event =
  | { type: "checkHandoff"; handoffFacts: HandoffFacts }
  | { type: "recordExchange"; exchangeAccepted: boolean }
  | { type: "checkIdentity"; identityValid: boolean }
  | { type: "checkPhone"; phoneAllowed: boolean }
  | { type: "recordSession" };

/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md:37) */
export const cloudClockSkewMs: number = 30 * 1000;
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md:9) */
export const validHandoff: HandoffFacts = { bindingValid: true, pendingLive: true, codeWellFormed: true };
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md:9) */
export const initial: SignIn = { phase: "AwaitingHandoff", handoffAccepted: false, exchangeAccepted: false, identityAccepted: false, phoneAllowed: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: SignIn): boolean {
  return alwaysSessionRequiresAcceptedHandoff(current);
}

/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md:9) */
//@ pure
export function liveBeforeDeadline(asOf: number, expiresAt: number): boolean {
  return asOf < expiresAt;
}

/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md:9) */
//@ pure
export function canCheckHandoff(signIn: SignIn): boolean {
  return signIn.phase === "AwaitingHandoff";
}

/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md:9) */
//@ pure
export function checkHandoff(signIn: SignIn, handoffFacts: HandoffFacts): SignIn {
  //@ ensures (inv(signIn) && canCheckHandoff(signIn)) ==> alwaysSessionRequiresAcceptedHandoff(\result)
  const accepted: boolean = handoffFacts.bindingValid && handoffFacts.pendingLive && handoffFacts.codeWellFormed;
  return { ...signIn, handoffAccepted: accepted, phase: accepted ? "AwaitingExchange" : "RejectCallback" };
}

/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md:9) */
//@ pure
export function lawAnExpiredHandoffIsNeverLive(expiresAt: number): boolean {
  //@ ensures \result === true
  return !liveBeforeDeadline(expiresAt, expiresAt);
}

/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md:37) */
//@ pure
export function cloudIssuedAtWithinSkew(issuedAtMs: number, asOf: number): boolean {
  return issuedAtMs <= asOf + cloudClockSkewMs;
}

/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md:37) */
//@ pure
export function cloudSessionStartedAt(issuedAtMs: number, asOf: number): number {
  return issuedAtMs <= asOf ? issuedAtMs : asOf;
}

/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md:37) */
//@ pure
export function lawSessionStartIsNeverFuture(issuedAtMs: number, asOf: number): boolean {
  //@ ensures \result === true
  return cloudSessionStartedAt(issuedAtMs, asOf) <= asOf;
}

/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md:37) */
//@ pure
export function canRecordExchange(signIn: SignIn): boolean {
  return signIn.phase === "AwaitingExchange" && signIn.handoffAccepted;
}

/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md:37) */
//@ pure
export function recordExchange(signIn: SignIn, exchangeAccepted: boolean): SignIn {
  //@ ensures (inv(signIn) && canRecordExchange(signIn)) ==> alwaysSessionRequiresAcceptedHandoff(\result)
  return { ...signIn, exchangeAccepted: exchangeAccepted, phase: exchangeAccepted ? "AwaitingIdentity" : "DenySignIn" };
}

/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md:37) */
//@ pure
export function canCheckIdentity(signIn: SignIn): boolean {
  return signIn.phase === "AwaitingIdentity" && signIn.exchangeAccepted && signIn.handoffAccepted;
}

/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md:37) */
//@ pure
export function checkIdentity(signIn: SignIn, identityValid: boolean): SignIn {
  //@ ensures (inv(signIn) && canCheckIdentity(signIn)) ==> alwaysSessionRequiresAcceptedHandoff(\result)
  return { ...signIn, identityAccepted: identityValid, phase: identityValid ? "AwaitingPhone" : "DenySignIn" };
}

/** Story: Use my Cloud identity to sign in to this app / The site checks phone eligibility before issuing a session (spec/cloudSignIn.md:64) */
//@ pure
export function canCheckPhone(signIn: SignIn): boolean {
  return signIn.phase === "AwaitingPhone" && signIn.identityAccepted && signIn.exchangeAccepted && signIn.handoffAccepted;
}

/** Story: Use my Cloud identity to sign in to this app / The site checks phone eligibility before issuing a session (spec/cloudSignIn.md:64) */
//@ pure
export function checkPhone(signIn: SignIn, phoneAllowed: boolean): SignIn {
  //@ ensures (inv(signIn) && canCheckPhone(signIn)) ==> alwaysSessionRequiresAcceptedHandoff(\result)
  return { ...signIn, phoneAllowed: phoneAllowed, phase: phoneAllowed ? "AwaitingSession" : "DenySignIn" };
}

/** Story: Use my Cloud identity to sign in to this app / The site checks phone eligibility before issuing a session (spec/cloudSignIn.md:64) */
//@ pure
export function canRecordSession(signIn: SignIn): boolean {
  return signIn.phase === "AwaitingSession" && signIn.phoneAllowed && signIn.identityAccepted && signIn.exchangeAccepted && signIn.handoffAccepted;
}

/** Story: Use my Cloud identity to sign in to this app / The site checks phone eligibility before issuing a session (spec/cloudSignIn.md:64) */
//@ pure
export function recordSession(signIn: SignIn): SignIn {
  //@ ensures (inv(signIn) && canRecordSession(signIn)) ==> alwaysSessionRequiresAcceptedHandoff(\result)
  return { ...signIn, phase: "SignedIn" };
}

/** Story: Use my Cloud identity to sign in to this app / A completed callback passed each issuance check (spec/cloudSignIn.md:80) */
//@ pure
export function alwaysSessionRequiresAcceptedHandoff(signIn: SignIn): boolean {
  return !(signIn.phase === "AwaitingSession" || signIn.phase === "SignedIn") || (signIn.handoffAccepted && signIn.exchangeAccepted && signIn.identityAccepted && signIn.phoneAllowed);
}

/** Story: Use my Cloud identity to sign in to this app / A completed callback passed each issuance check (spec/cloudSignIn.md:80) */
//@ pure
export function sometimesSignsIn(signIn: SignIn): boolean {
  return signIn.phase === "SignedIn";
}

/** Story: Use my Cloud identity to sign in to this app / A completed callback passed each issuance check (spec/cloudSignIn.md:80) */
//@ pure
export function sometimesRejectsCallback(signIn: SignIn): boolean {
  return signIn.phase === "RejectCallback";
}

/** Story: Use my Cloud identity to sign in to this app / A completed callback passed each issuance check (spec/cloudSignIn.md:80) */
//@ pure
export function sometimesDeniesSignIn(signIn: SignIn): boolean {
  return signIn.phase === "DenySignIn";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: SignIn, event: Event): boolean {
  if (event.type === "checkHandoff") return canCheckHandoff(current);
  if (event.type === "recordExchange") return canRecordExchange(current);
  if (event.type === "checkIdentity") return canCheckIdentity(current);
  if (event.type === "checkPhone") return canCheckPhone(current);
  if (event.type === "recordSession") return canRecordSession(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: SignIn, event: Event): SignIn {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "checkHandoff" && canCheckHandoff(current)) return checkHandoff(current, event.handoffFacts);
  if (event.type === "recordExchange" && canRecordExchange(current)) return recordExchange(current, event.exchangeAccepted);
  if (event.type === "checkIdentity" && canCheckIdentity(current)) return checkIdentity(current, event.identityValid);
  if (event.type === "checkPhone" && canCheckPhone(current)) return checkPhone(current, event.phoneAllowed);
  if (event.type === "recordSession" && canRecordSession(current)) return recordSession(current);
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
  if (raw.type === "checkHandoff" && typeof raw.handoffFacts === "object" && raw.handoffFacts !== null && !Array.isArray(raw.handoffFacts) && typeof raw.handoffFacts.bindingValid === "boolean" && typeof raw.handoffFacts.pendingLive === "boolean" && typeof raw.handoffFacts.codeWellFormed === "boolean") return { type: "checkHandoff", handoffFacts: ({ bindingValid: raw.handoffFacts.bindingValid, pendingLive: raw.handoffFacts.pendingLive, codeWellFormed: raw.handoffFacts.codeWellFormed }) };
  if (raw.type === "recordExchange" && typeof raw.exchangeAccepted === "boolean") return { type: "recordExchange", exchangeAccepted: raw.exchangeAccepted };
  if (raw.type === "checkIdentity" && typeof raw.identityValid === "boolean") return { type: "checkIdentity", identityValid: raw.identityValid };
  if (raw.type === "checkPhone" && typeof raw.phoneAllowed === "boolean") return { type: "checkPhone", phoneAllowed: raw.phoneAllowed };
  if (raw.type === "recordSession") return { type: "recordSession" };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): SignIn | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "AwaitingHandoff" || raw.phase === "AwaitingExchange" || raw.phase === "AwaitingIdentity" || raw.phase === "AwaitingPhone" || raw.phase === "AwaitingSession" || raw.phase === "SignedIn" || raw.phase === "RejectCallback" || raw.phase === "DenySignIn") && typeof raw.handoffAccepted === "boolean" && typeof raw.exchangeAccepted === "boolean" && typeof raw.identityAccepted === "boolean" && typeof raw.phoneAllowed === "boolean" && Object.keys(raw).length === 5)) return undefined;
  const parsed: SignIn = ({ phase: raw.phase, handoffAccepted: raw.handoffAccepted, exchangeAccepted: raw.exchangeAccepted, identityAccepted: raw.identityAccepted, phoneAllowed: raw.phoneAllowed });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): SignIn {
  //@ ensures inv(\result)
  return initial;
}
