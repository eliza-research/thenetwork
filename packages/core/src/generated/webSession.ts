// GENERATED from spec/webSession.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md:31) */
export type SessionPhase = "Beginning" | "LookingUp" | "Refused" | "Usable" | "RevokingOld" | "IssuingReplacement" | "Rotated";
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md:31) */
export interface SessionFlow { phase: SessionPhase; revokeAt: number }

/** One variant per transition in the spec. */
export type Event =
  | { type: "readToken"; tokenPresent: boolean; tokenLength: number }
  | { type: "readRow"; sameAppRow: boolean; expired: boolean; hasRevocation: boolean; revocationDue: boolean; rotationRequested: boolean; oldEnough: boolean; at: number }
  | { type: "recordRevocation" }
  | { type: "recordReplacement" };

/** Story: Stay signed in to the app where I proved my phone / A session has an absolute limit from sign-in (spec/webSession.md:9) */
export const sessionRotateMs: number = 24 * 3600000;
/** Story: Stay signed in to the app where I proved my phone / A session has an absolute limit from sign-in (spec/webSession.md:9) */
export const sessionMaxMs: number = 90 * 24 * 3600000;
/** Story: Stay signed in to the app where I proved my phone / A session has an absolute limit from sign-in (spec/webSession.md:9) */
export const sessionGraceMs: number = 60000;
/** Story: Stay signed in to the app where I proved my phone / A session has an absolute limit from sign-in (spec/webSession.md:9) */
export const sessionStepUpMs: number = 10 * 60000;
/** Story: Stay signed in to the app where I proved my phone / A session has an absolute limit from sign-in (spec/webSession.md:9) */
export const sessionTtlMs: number = 30 * 24 * 3600000;
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md:31) */
export const initial: SessionFlow = { phase: "Beginning", revokeAt: 0 };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: SessionFlow): boolean {
  return true;
}

/** Story: Stay signed in to the app where I proved my phone / A session has an absolute limit from sign-in (spec/webSession.md:9) */
//@ pure
export function sessionDeadline(createdAt: number, startedAt: number, ttl: number, maxAge: number, limited: boolean, expiresBefore: number): number {
  const untilTtl: number = createdAt + ttl;
  const untilMax: number = startedAt + maxAge;
  const local: number = untilTtl < untilMax ? untilTtl : untilMax;
  return limited && expiresBefore < local ? expiresBefore : local;
}

/** Story: Stay signed in to the app where I proved my phone / A session has an absolute limit from sign-in (spec/webSession.md:9) */
//@ pure
export function lawCloudDeadlineCapsSession(createdAt: number, startedAt: number, ttl: number, maxAge: number, expiresBefore: number): boolean {
  //@ ensures \result === true
  return sessionDeadline(createdAt, startedAt, ttl, maxAge, true, expiresBefore) <= expiresBefore;
}

/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md:31) */
//@ pure
export function canReadToken(flow: SessionFlow): boolean {
  return flow.phase === "Beginning";
}

/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md:31) */
//@ pure
export function readToken(flow: SessionFlow, tokenPresent: boolean, tokenLength: number): SessionFlow {
  //@ ensures (inv(flow) && canReadToken(flow)) ==> stepRotationRequiresAReplacement(flow, "readToken", \result)
  return { ...flow, phase: tokenPresent && tokenLength <= 128 ? "LookingUp" : "Refused" };
}

/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md:31) */
//@ pure
export function canReadRow(flow: SessionFlow): boolean {
  return flow.phase === "LookingUp";
}

/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md:31) */
//@ pure
export function readRow(flow: SessionFlow, sameAppRow: boolean, expired: boolean, hasRevocation: boolean, revocationDue: boolean, rotationRequested: boolean, oldEnough: boolean, at: number): SessionFlow {
  //@ ensures (inv(flow) && canReadRow(flow)) ==> stepRotationRequiresAReplacement(flow, "readRow", \result)
  return !sameAppRow || expired || revocationDue ? ({ ...flow, phase: "Refused" } as SessionFlow) : (!rotationRequested || hasRevocation || !oldEnough ? ({ ...flow, phase: "Usable" } as SessionFlow) : ({ phase: "RevokingOld", revokeAt: at + sessionGraceMs } as SessionFlow));
}

/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md:31) */
//@ pure
export function canRecordRevocation(flow: SessionFlow): boolean {
  return flow.phase === "RevokingOld";
}

/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md:31) */
//@ pure
export function recordRevocation(flow: SessionFlow): SessionFlow {
  //@ ensures (inv(flow) && canRecordRevocation(flow)) ==> stepRotationRequiresAReplacement(flow, "recordRevocation", \result)
  return { ...flow, phase: "IssuingReplacement" };
}

/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md:31) */
//@ pure
export function canRecordReplacement(flow: SessionFlow): boolean {
  return flow.phase === "IssuingReplacement";
}

/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md:31) */
//@ pure
export function recordReplacement(flow: SessionFlow): SessionFlow {
  //@ ensures (inv(flow) && canRecordReplacement(flow)) ==> stepRotationRequiresAReplacement(flow, "recordReplacement", \result)
  return { ...flow, phase: "Rotated" };
}

/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md:31) */
//@ pure
export function stepRotationRequiresAReplacement(before: SessionFlow, via: string, after: SessionFlow): boolean {
  return !(after.phase === "Rotated") || (before.phase === "IssuingReplacement" && via === "recordReplacement");
}

/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md:31) */
//@ pure
export function sometimesRotates(flow: SessionFlow): boolean {
  return flow.phase === "Rotated";
}

/** Story: Stay signed in to the app where I proved my phone / Sensitive account changes require a fresh sign-in (spec/webSession.md:64) */
//@ pure
export function freshSignIn(elapsed: number): boolean {
  return elapsed <= sessionStepUpMs;
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: SessionFlow, event: Event): boolean {
  if (event.type === "readToken") return canReadToken(current);
  if (event.type === "readRow") return canReadRow(current);
  if (event.type === "recordRevocation") return canRecordRevocation(current);
  if (event.type === "recordReplacement") return canRecordReplacement(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: SessionFlow, event: Event): SessionFlow {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "readToken" && canReadToken(current)) return readToken(current, event.tokenPresent, event.tokenLength);
  if (event.type === "readRow" && canReadRow(current)) return readRow(current, event.sameAppRow, event.expired, event.hasRevocation, event.revocationDue, event.rotationRequested, event.oldEnough, event.at);
  if (event.type === "recordRevocation" && canRecordRevocation(current)) return recordRevocation(current);
  if (event.type === "recordReplacement" && canRecordReplacement(current)) return recordReplacement(current);
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
  if (raw.type === "readToken" && typeof raw.tokenPresent === "boolean" && Number.isSafeInteger(raw.tokenLength)) return { type: "readToken", tokenPresent: raw.tokenPresent, tokenLength: raw.tokenLength };
  if (raw.type === "readRow" && typeof raw.sameAppRow === "boolean" && typeof raw.expired === "boolean" && typeof raw.hasRevocation === "boolean" && typeof raw.revocationDue === "boolean" && typeof raw.rotationRequested === "boolean" && typeof raw.oldEnough === "boolean" && Number.isSafeInteger(raw.at)) return { type: "readRow", sameAppRow: raw.sameAppRow, expired: raw.expired, hasRevocation: raw.hasRevocation, revocationDue: raw.revocationDue, rotationRequested: raw.rotationRequested, oldEnough: raw.oldEnough, at: raw.at };
  if (raw.type === "recordRevocation") return { type: "recordRevocation" };
  if (raw.type === "recordReplacement") return { type: "recordReplacement" };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): SessionFlow | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Beginning" || raw.phase === "LookingUp" || raw.phase === "Refused" || raw.phase === "Usable" || raw.phase === "RevokingOld" || raw.phase === "IssuingReplacement" || raw.phase === "Rotated") && Number.isSafeInteger(raw.revokeAt) && Object.keys(raw).length === 2)) return undefined;
  const parsed: SessionFlow = ({ phase: raw.phase, revokeAt: raw.revokeAt });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): SessionFlow {
  //@ ensures inv(\result)
  return initial;
}
