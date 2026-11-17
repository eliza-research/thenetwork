// Generated from spec/webSession.md via Vibestack and VibeLang. Run pnpm run spec:sync.
// GENERATED from spec/webSession.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
/** Story: Stay signed in to the app where I proved my phone / A session has an absolute limit from sign-in (spec/webSession.md) */
export const sessionRotateMs = exact_webSession(24 * 3600000);
/** Story: Stay signed in to the app where I proved my phone / A session has an absolute limit from sign-in (spec/webSession.md) */
export const sessionMaxMs = exact_webSession(exact_webSession(90 * 24) * 3600000);
/** Story: Stay signed in to the app where I proved my phone / A session has an absolute limit from sign-in (spec/webSession.md) */
export const sessionGraceMs = 60000;
/** Story: Stay signed in to the app where I proved my phone / A session has an absolute limit from sign-in (spec/webSession.md) */
export const sessionStepUpMs = exact_webSession(10 * 60000);
/** Story: Stay signed in to the app where I proved my phone / A session has an absolute limit from sign-in (spec/webSession.md) */
export const sessionTtlMs = exact_webSession(exact_webSession(30 * 24) * 3600000);
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
export const initial = { phase: "Beginning", revokeAt: 0 };
/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current) {
    return true;
}
/** Story: Stay signed in to the app where I proved my phone / A session has an absolute limit from sign-in (spec/webSession.md) */
//@ pure
export function sessionDeadline(createdAt, startedAt, ttl, maxAge, limited, expiresBefore) {
    const local_0 = exact_webSession(createdAt + ttl);
    const local_1 = exact_webSession(startedAt + maxAge);
    const local_2 = local_0 < local_1 ? local_0 : local_1;
    return limited && expiresBefore < local_2 ? expiresBefore : local_2;
}
/** Story: Stay signed in to the app where I proved my phone / A session has an absolute limit from sign-in (spec/webSession.md) */
//@ pure
export function lawCloudDeadlineCapsSession(createdAt, startedAt, ttl, maxAge, expiresBefore) {
    //@ ensures \result === true
    return sessionDeadline(createdAt, startedAt, ttl, maxAge, true, expiresBefore) <= expiresBefore;
}
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
//@ pure
export function canReadToken(flow) {
    return flow.phase === "Beginning";
}
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
//@ pure
export function readToken(flow, tokenPresent, tokenLength) {
    //@ ensures (inv(flow) && canReadToken(flow)) ==> stepRotationRequiresAReplacement(flow, "readToken", \result)
    return { ...flow, phase: tokenPresent && tokenLength <= 128 ? "LookingUp" : "Refused" };
}
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
//@ pure
export function canReadRow(flow) {
    return flow.phase === "LookingUp";
}
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
//@ pure
export function readRow(flow, sameAppRow, expired, hasRevocation, revocationDue, banned, rotationRequested, oldEnough, at) {
    //@ ensures (inv(flow) && canReadRow(flow)) ==> stepRotationRequiresAReplacement(flow, "readRow", \result)
    return !sameAppRow || expired || revocationDue || banned ? { ...flow, phase: "Refused" } : (!rotationRequested || hasRevocation || !oldEnough ? { ...flow, phase: "Usable" } : { phase: "RevokingOld", revokeAt: exact_webSession(at + sessionGraceMs) });
}
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
//@ pure
export function canRecordRevocation(flow) {
    return flow.phase === "RevokingOld";
}
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
//@ pure
export function recordRevocation(flow) {
    //@ ensures (inv(flow) && canRecordRevocation(flow)) ==> stepRotationRequiresAReplacement(flow, "recordRevocation", \result)
    return { ...flow, phase: "IssuingReplacement" };
}
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
//@ pure
export function canRecordReplacement(flow) {
    return flow.phase === "IssuingReplacement";
}
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
//@ pure
export function recordReplacement(flow) {
    //@ ensures (inv(flow) && canRecordReplacement(flow)) ==> stepRotationRequiresAReplacement(flow, "recordReplacement", \result)
    return { ...flow, phase: "Rotated" };
}
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
//@ pure
export function stepRotationRequiresAReplacement(before, via, after) {
    return !(after.phase === "Rotated") || (before.phase === "IssuingReplacement" && via === "recordReplacement");
}
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
//@ pure
export function sometimesRotates(flow) {
    return flow.phase === "Rotated";
}
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
//@ pure
export function lawBannedSessionIsRefused(sameAppRow, expired, hasRevocation, revocationDue, rotationRequested, oldEnough, at) {
    //@ ensures \result === true
    return readRow({ phase: "LookingUp", revokeAt: 0 }, sameAppRow, expired, hasRevocation, revocationDue, true, rotationRequested, oldEnough, at).phase === "Refused";
}
/** Story: Stay signed in to the app where I proved my phone / Sensitive account changes require a fresh sign-in (spec/webSession.md) */
//@ pure
export function freshSignIn(elapsed) {
    return elapsed <= sessionStepUpMs;
}
/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current, event) {
    if (event.type === "readToken")
        return canReadToken(current);
    if (event.type === "readRow")
        return canReadRow(current);
    if (event.type === "recordRevocation")
        return canRecordRevocation(current);
    if (event.type === "recordReplacement")
        return canRecordReplacement(current);
    return false;
}
/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current, event) {
    //@ requires inv(current)
    //@ ensures inv(\result)
    if (event.type === "readToken")
        return canReadToken(current) ? readToken(current, event.tokenPresent, event.tokenLength) : current;
    if (event.type === "readRow")
        return canReadRow(current) ? readRow(current, event.sameAppRow, event.expired, event.hasRevocation, event.revocationDue, event.banned, event.rotationRequested, event.oldEnough, event.at) : current;
    if (event.type === "recordRevocation")
        return canRecordRevocation(current) ? recordRevocation(current) : current;
    if (event.type === "recordReplacement")
        return canRecordReplacement(current) ? recordReplacement(current) : current;
    return current;
}
/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseEvent(x) {
    let raw;
    try {
        raw = JSON.parse(JSON.stringify(x));
    }
    catch {
        return undefined;
    }
    if (typeof raw !== "object" || raw === null)
        return undefined;
    if (raw.type === "readToken" && typeof raw.tokenPresent === "boolean" && Number.isSafeInteger(raw.tokenLength))
        return { type: "readToken", tokenPresent: raw.tokenPresent, tokenLength: raw.tokenLength };
    if (raw.type === "readRow" && typeof raw.sameAppRow === "boolean" && typeof raw.expired === "boolean" && typeof raw.hasRevocation === "boolean" && typeof raw.revocationDue === "boolean" && typeof raw.banned === "boolean" && typeof raw.rotationRequested === "boolean" && typeof raw.oldEnough === "boolean" && Number.isSafeInteger(raw.at))
        return { type: "readRow", sameAppRow: raw.sameAppRow, expired: raw.expired, hasRevocation: raw.hasRevocation, revocationDue: raw.revocationDue, banned: raw.banned, rotationRequested: raw.rotationRequested, oldEnough: raw.oldEnough, at: raw.at };
    if (raw.type === "recordRevocation")
        return { type: "recordRevocation" };
    if (raw.type === "recordReplacement")
        return { type: "recordReplacement" };
    return undefined;
}
/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x) {
    let raw;
    try {
        raw = JSON.parse(JSON.stringify(x));
    }
    catch {
        return undefined;
    }
    if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Beginning" || raw.phase === "LookingUp" || raw.phase === "Refused" || raw.phase === "Usable" || raw.phase === "RevokingOld" || raw.phase === "IssuingReplacement" || raw.phase === "Rotated") && Number.isSafeInteger(raw.revokeAt) && Object.keys(raw).length === 2))
        return undefined;
    const parsed = ({ phase: raw.phase, revokeAt: raw.revokeAt });
    return inv(parsed) ? parsed : undefined;
}
/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds() {
    //@ ensures inv(\result)
    return initial;
}
/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_webSession(n) {
    if (!Number.isSafeInteger(n))
        throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
    return n;
}
