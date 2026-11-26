// GENERATED from spec/webSession.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
export type SessionPhase = "Beginning" | "LookingUp" | "Refused" | "Usable" | "RevokingOld" | "IssuingReplacement" | "Rotated";
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
export interface SessionFlow { phase: SessionPhase; revokeAt: number }

/** One variant per transition in the spec. */
export type Event =
  | { type: "readToken"; tokenPresent: boolean; tokenLength: number }
  | { type: "readRow"; sameAppRow: boolean; expired: boolean; hasRevocation: boolean; revocationDue: boolean; banned: boolean; rotationRequested: boolean; oldEnough: boolean; at: number }
  | { type: "recordRevocation"; rowLive: boolean; rotatedMeanwhile: boolean }
  | { type: "recordReplacement" };

/** Story: Stay signed in to the app where I proved my phone / A session has an absolute limit from sign-in (spec/webSession.md) */
export const sessionTtlMs: number = exact_webSession(exact_webSession(30 * 24) * 3600000);
/** Story: Stay signed in to the app where I proved my phone / A session has an absolute limit from sign-in (spec/webSession.md) */
export const sessionRotateMs: number = exact_webSession(24 * 3600000);
/** Story: Stay signed in to the app where I proved my phone / A session has an absolute limit from sign-in (spec/webSession.md) */
export const sessionMaxMs: number = exact_webSession(exact_webSession(90 * 24) * 3600000);
/** Story: Stay signed in to the app where I proved my phone / A session has an absolute limit from sign-in (spec/webSession.md) */
export const sessionGraceMs: number = 60000;
/** Story: Stay signed in to the app where I proved my phone / A session has an absolute limit from sign-in (spec/webSession.md) */
export const sessionStepUpMs: number = exact_webSession(10 * 60000);
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
export const initial: SessionFlow = { phase: "Beginning", revokeAt: 0 };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: SessionFlow): boolean {
  return true;
}

/** Story: Stay signed in to the app where I proved my phone / A session has an absolute limit from sign-in (spec/webSession.md) */
//@ pure
export function sessionDeadline(createdAt: number, startedAt: number, ttl: number, maxAge: number, limited: boolean, expiresBefore: number): number {
  const local_0 = exact_webSession(createdAt + ttl);
  const local_1 = exact_webSession(startedAt + maxAge);
  const local_2 = local_0 < local_1 ? local_0 : local_1;
  return limited && expiresBefore < local_2 ? expiresBefore : local_2;
}

/** Story: Stay signed in to the app where I proved my phone / A session has an absolute limit from sign-in (spec/webSession.md) */
//@ pure
export function lawCloudDeadlineCapsSession(createdAt: number, startedAt: number, ttl: number, maxAge: number, expiresBefore: number): boolean {
  //@ ensures \result === true
  return sessionDeadline(createdAt, startedAt, ttl, maxAge, true, expiresBefore) <= expiresBefore;
}

/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
//@ pure
export function canReadToken(flow: SessionFlow): boolean {
  return flow.phase === "Beginning";
}

/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
//@ pure
export function readToken(flow: SessionFlow, tokenPresent: boolean, tokenLength: number): SessionFlow {
  //@ ensures (inv(flow) && canReadToken(flow)) ==> stepRotationRequiresAReplacement(flow, "readToken", \result)
  return { ...flow, phase: tokenPresent && tokenLength <= 128 ? "LookingUp" : "Refused" };
}

/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
//@ pure
export function canReadRow(flow: SessionFlow): boolean {
  return flow.phase === "LookingUp";
}

/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
//@ pure
export function readRow(flow: SessionFlow, sameAppRow: boolean, expired: boolean, hasRevocation: boolean, revocationDue: boolean, banned: boolean, rotationRequested: boolean, oldEnough: boolean, at: number): SessionFlow {
  //@ ensures (inv(flow) && canReadRow(flow)) ==> stepRotationRequiresAReplacement(flow, "readRow", \result)
  return !sameAppRow || expired || revocationDue || banned ? ({ ...flow, phase: "Refused" } as SessionFlow) : (!rotationRequested || hasRevocation || !oldEnough ? ({ ...flow, phase: "Usable" } as SessionFlow) : ({ phase: "RevokingOld", revokeAt: exact_webSession(at + sessionGraceMs) } as SessionFlow));
}

/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
//@ pure
export function sessionRowLive(sameApp: boolean, expiresAt: number, revoked: boolean, revokedAt: number, now: number): boolean {
  return sameApp && expiresAt > now && !(revoked && revokedAt <= now);
}

/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
//@ pure
export function canRecordRevocation(flow: SessionFlow): boolean {
  return flow.phase === "RevokingOld";
}

/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
//@ pure
export function recordRevocation(flow: SessionFlow, rowLive: boolean, rotatedMeanwhile: boolean): SessionFlow {
  //@ ensures (inv(flow) && canRecordRevocation(flow)) ==> stepRotationRequiresAReplacement(flow, "recordRevocation", \result)
  return !rowLive ? ({ ...flow, phase: "Refused" } as SessionFlow) : (rotatedMeanwhile ? ({ ...flow, phase: "Usable" } as SessionFlow) : ({ ...flow, phase: "IssuingReplacement" } as SessionFlow));
}

/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
//@ pure
export function canRecordReplacement(flow: SessionFlow): boolean {
  return flow.phase === "IssuingReplacement";
}

/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
//@ pure
export function recordReplacement(flow: SessionFlow): SessionFlow {
  //@ ensures (inv(flow) && canRecordReplacement(flow)) ==> stepRotationRequiresAReplacement(flow, "recordReplacement", \result)
  return { ...flow, phase: "Rotated" };
}

/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
//@ pure
export function stepRotationRequiresAReplacement(before: SessionFlow, via: string, after: SessionFlow): boolean {
  return !(after.phase === "Rotated") || (before.phase === "IssuingReplacement" && via === "recordReplacement");
}

/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
//@ pure
export function sometimesRotates(flow: SessionFlow): boolean {
  return flow.phase === "Rotated";
}

/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
//@ pure
export function lawErasedRowIssuesNoReplacement(rotatedMeanwhile: boolean, revokeAt: number): boolean {
  //@ ensures \result === true
  return recordRevocation(({ phase: "RevokingOld", revokeAt: revokeAt } as SessionFlow), false, rotatedMeanwhile).phase === "Refused";
}

/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
//@ pure
export function lawBannedSessionIsRefused(sameAppRow: boolean, expired: boolean, hasRevocation: boolean, revocationDue: boolean, rotationRequested: boolean, oldEnough: boolean, at: number): boolean {
  //@ ensures \result === true
  return readRow(({ phase: "LookingUp", revokeAt: 0 } as SessionFlow), sameAppRow, expired, hasRevocation, revocationDue, true, rotationRequested, oldEnough, at).phase === "Refused";
}

/** Story: Stay signed in to the app where I proved my phone / Sensitive account changes require a fresh sign-in (spec/webSession.md) */
//@ pure
export function freshSignIn(elapsed: number): boolean {
  return elapsed <= sessionStepUpMs;
}

/** Story: Keep an earlier holder's sign-in away from my new account / A session without a person never outlives its number getting a person (spec/webSession.md) */
//@ pure
export function unboundSessionTakesNewPerson(numberHasPerson: boolean, provedSinceArrival: boolean): boolean {
  return numberHasPerson && provedSinceArrival;
}

/** Story: Keep an earlier holder's sign-in away from my new account / A session without a person never outlives its number getting a person (spec/webSession.md) */
//@ pure
export function unboundSessionEnds(numberHasPerson: boolean, provedSinceArrival: boolean): boolean {
  return numberHasPerson && !provedSinceArrival;
}

/** Story: Keep an earlier holder's sign-in away from my new account / A session without a person never outlives its number getting a person (spec/webSession.md) */
//@ pure
export function lawNoUnboundSessionBesideAPerson(numberHasPerson: boolean, provedSinceArrival: boolean): boolean {
  //@ ensures \result === true
  return (!numberHasPerson || unboundSessionTakesNewPerson(numberHasPerson, provedSinceArrival) !== unboundSessionEnds(numberHasPerson, provedSinceArrival)) && (!(!numberHasPerson) || !(unboundSessionTakesNewPerson(numberHasPerson, provedSinceArrival) || unboundSessionEnds(numberHasPerson, provedSinceArrival)));
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
  if (event.type === "readToken") return canReadToken(current) ? readToken(current, event.tokenPresent, event.tokenLength) : current;
  if (event.type === "readRow") return canReadRow(current) ? readRow(current, event.sameAppRow, event.expired, event.hasRevocation, event.revocationDue, event.banned, event.rotationRequested, event.oldEnough, event.at) : current;
  if (event.type === "recordRevocation") return canRecordRevocation(current) ? recordRevocation(current, event.rowLive, event.rotatedMeanwhile) : current;
  if (event.type === "recordReplacement") return canRecordReplacement(current) ? recordReplacement(current) : current;
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
  if (raw.type === "readRow" && typeof raw.sameAppRow === "boolean" && typeof raw.expired === "boolean" && typeof raw.hasRevocation === "boolean" && typeof raw.revocationDue === "boolean" && typeof raw.banned === "boolean" && typeof raw.rotationRequested === "boolean" && typeof raw.oldEnough === "boolean" && Number.isSafeInteger(raw.at)) return { type: "readRow", sameAppRow: raw.sameAppRow, expired: raw.expired, hasRevocation: raw.hasRevocation, revocationDue: raw.revocationDue, banned: raw.banned, rotationRequested: raw.rotationRequested, oldEnough: raw.oldEnough, at: raw.at };
  if (raw.type === "recordRevocation" && typeof raw.rowLive === "boolean" && typeof raw.rotatedMeanwhile === "boolean") return { type: "recordRevocation", rowLive: raw.rowLive, rotatedMeanwhile: raw.rotatedMeanwhile };
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

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_webSession(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
