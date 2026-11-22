// Generated from spec/cloudSignIn.md via Vibestack and VibeLang. Run pnpm run spec:sync.
// GENERATED from spec/cloudSignIn.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { sessionDeadline as webSession_sessionDeadline } from "./webSession.js";
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
export const cloudClockSkewMs = exact_cloudSignIn(30 * 1000);
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
export const cloudProofLifeMs = exact_cloudSignIn(exact_cloudSignIn(60 * 60) * 1000);
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md) */
export const validHandoff = { bindingValid: true, pendingLive: true, codeWellFormed: true };
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md) */
export const initial = { phase: "AwaitingHandoff", handoffAccepted: false, exchangeAccepted: false, identityAccepted: false, phoneAllowed: false };
/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current) {
    return alwaysSessionRequiresAcceptedHandoff(current);
}
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md) */
//@ pure
export function liveBeforeDeadline(asOf, expiresAt) {
    return asOf < expiresAt;
}
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md) */
//@ pure
export function canCheckHandoff(signIn) {
    return signIn.phase === "AwaitingHandoff";
}
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md) */
//@ pure
export function checkHandoff(signIn, handoffFacts) {
    //@ ensures (inv(signIn) && canCheckHandoff(signIn)) ==> alwaysSessionRequiresAcceptedHandoff(\result)
    const local_0 = handoffFacts.bindingValid && handoffFacts.pendingLive && handoffFacts.codeWellFormed;
    return { ...signIn, handoffAccepted: local_0, phase: local_0 ? "AwaitingExchange" : "RejectCallback" };
}
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md) */
//@ pure
export function lawAnExpiredHandoffIsNeverLive(expiresAt) {
    //@ ensures \result === true
    return !liveBeforeDeadline(expiresAt, expiresAt);
}
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
//@ pure
export function cloudIssuedAtWithinSkew(issuedAtMs, asOf) {
    return issuedAtMs > 0 && issuedAtMs <= exact_cloudSignIn(asOf + cloudClockSkewMs);
}
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
//@ pure
export function cloudProofLifeValid(issuedAtMs, expiresAtMs) {
    return expiresAtMs <= exact_cloudSignIn(issuedAtMs + cloudProofLifeMs);
}
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
//@ pure
export function cloudSessionStartedAt(issuedAtMs, asOf) {
    return issuedAtMs <= asOf ? issuedAtMs : asOf;
}
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
//@ pure
export function cloudIdentityTimesValid(issuedAtMs, expiresAtMs, asOf) {
    return cloudIssuedAtWithinSkew(issuedAtMs, asOf) && liveBeforeDeadline(asOf, expiresAtMs) && cloudProofLifeValid(issuedAtMs, expiresAtMs);
}
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
//@ pure
export function lawSessionStartIsNeverFuture(issuedAtMs, asOf) {
    //@ ensures \result === true
    return cloudSessionStartedAt(issuedAtMs, asOf) <= asOf;
}
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
//@ pure
export function canRecordExchange(signIn) {
    return signIn.phase === "AwaitingExchange" && signIn.handoffAccepted;
}
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
//@ pure
export function recordExchange(signIn, exchangeAccepted) {
    //@ ensures (inv(signIn) && canRecordExchange(signIn)) ==> alwaysSessionRequiresAcceptedHandoff(\result)
    return { ...signIn, exchangeAccepted: exchangeAccepted, phase: exchangeAccepted ? "AwaitingIdentity" : "DenySignIn" };
}
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
//@ pure
export function canCheckIdentity(signIn) {
    return signIn.phase === "AwaitingIdentity" && signIn.exchangeAccepted && signIn.handoffAccepted;
}
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
//@ pure
export function checkIdentity(signIn, identityAvailable, identityValid) {
    //@ ensures (inv(signIn) && canCheckIdentity(signIn)) ==> alwaysSessionRequiresAcceptedHandoff(\result)
    const local_1 = identityAvailable && identityValid;
    return { ...signIn, identityAccepted: local_1, phase: !identityAvailable ? "CloudUnavailable" : (local_1 ? "AwaitingPhone" : "DenySignIn") };
}
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
//@ pure
export function lawCloudProofLivesAtMostOneHour(issuedAtMs, asOf) {
    //@ ensures \result === true
    return !cloudIdentityTimesValid(issuedAtMs, exact_cloudSignIn(exact_cloudSignIn(issuedAtMs + cloudProofLifeMs) + 1), asOf);
}
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
//@ pure
export function lawOneHourProofIsAcceptedWhenIssued(issuedAtMs) {
    //@ ensures \result === true
    return !(issuedAtMs > 0) || cloudIdentityTimesValid(issuedAtMs, exact_cloudSignIn(issuedAtMs + cloudProofLifeMs), issuedAtMs);
}
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
//@ pure
export function lawCloudIdentityNeedsFutureExpiry(issuedAtMs, asOf) {
    //@ ensures \result === true
    return !cloudIdentityTimesValid(issuedAtMs, asOf, asOf);
}
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
//@ pure
export function lawCloudIdentityNeedsPositiveIssueTime(expiresAtMs, asOf) {
    //@ ensures \result === true
    return !cloudIdentityTimesValid(0, expiresAtMs, asOf);
}
/** Story: Use my Cloud identity to sign in to this app / The site checks phone eligibility before issuing a session (spec/cloudSignIn.md) */
//@ pure
export function lawStoredSessionEndsByIdentityExpiry(createdAt, startedAt, ttl, maxAge, identityExpiry) {
    //@ ensures \result === true
    return webSession_sessionDeadline(createdAt, startedAt, ttl, maxAge, true, identityExpiry) <= identityExpiry;
}
/** Story: Use my Cloud identity to sign in to this app / The site checks phone eligibility before issuing a session (spec/cloudSignIn.md) */
//@ pure
export function canCheckPhone(signIn) {
    return signIn.phase === "AwaitingPhone" && signIn.identityAccepted && signIn.exchangeAccepted && signIn.handoffAccepted;
}
/** Story: Use my Cloud identity to sign in to this app / The site checks phone eligibility before issuing a session (spec/cloudSignIn.md) */
//@ pure
export function checkPhone(signIn, phoneAllowed) {
    //@ ensures (inv(signIn) && canCheckPhone(signIn)) ==> alwaysSessionRequiresAcceptedHandoff(\result)
    return { ...signIn, phoneAllowed: phoneAllowed, phase: phoneAllowed ? "AwaitingSession" : "DenySignIn" };
}
/** Story: Use my Cloud identity to sign in to this app / The site checks phone eligibility before issuing a session (spec/cloudSignIn.md) */
//@ pure
export function canRecordSession(signIn) {
    return signIn.phase === "AwaitingSession" && signIn.phoneAllowed && signIn.identityAccepted && signIn.exchangeAccepted && signIn.handoffAccepted;
}
/** Story: Use my Cloud identity to sign in to this app / The site checks phone eligibility before issuing a session (spec/cloudSignIn.md) */
//@ pure
export function recordSession(signIn) {
    //@ ensures (inv(signIn) && canRecordSession(signIn)) ==> alwaysSessionRequiresAcceptedHandoff(\result)
    return { ...signIn, phase: "SignedIn" };
}
/** Story: Use my Cloud identity to sign in to this app / A completed callback passed each issuance check (spec/cloudSignIn.md) */
//@ pure
export function alwaysSessionRequiresAcceptedHandoff(signIn) {
    return !(signIn.phase === "AwaitingSession" || signIn.phase === "SignedIn") || (signIn.handoffAccepted && signIn.exchangeAccepted && signIn.identityAccepted && signIn.phoneAllowed);
}
/** Story: Use my Cloud identity to sign in to this app / A completed callback passed each issuance check (spec/cloudSignIn.md) */
//@ pure
export function sometimesSignsIn(signIn) {
    return signIn.phase === "SignedIn";
}
/** Story: Use my Cloud identity to sign in to this app / A completed callback passed each issuance check (spec/cloudSignIn.md) */
//@ pure
export function sometimesRejectsCallback(signIn) {
    return signIn.phase === "RejectCallback";
}
/** Story: Use my Cloud identity to sign in to this app / A completed callback passed each issuance check (spec/cloudSignIn.md) */
//@ pure
export function sometimesDeniesSignIn(signIn) {
    return signIn.phase === "DenySignIn";
}
/** Story: Use my Cloud identity to sign in to this app / A completed callback passed each issuance check (spec/cloudSignIn.md) */
//@ pure
export function sometimesCloudUnavailable(signIn) {
    return signIn.phase === "CloudUnavailable";
}
/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current, event) {
    if (event.type === "checkHandoff")
        return canCheckHandoff(current);
    if (event.type === "recordExchange")
        return canRecordExchange(current);
    if (event.type === "checkIdentity")
        return canCheckIdentity(current);
    if (event.type === "checkPhone")
        return canCheckPhone(current);
    if (event.type === "recordSession")
        return canRecordSession(current);
    return false;
}
/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current, event) {
    //@ requires inv(current)
    //@ ensures inv(\result)
    if (event.type === "checkHandoff")
        return canCheckHandoff(current) ? checkHandoff(current, event.handoffFacts) : current;
    if (event.type === "recordExchange")
        return canRecordExchange(current) ? recordExchange(current, event.exchangeAccepted) : current;
    if (event.type === "checkIdentity")
        return canCheckIdentity(current) ? checkIdentity(current, event.identityAvailable, event.identityValid) : current;
    if (event.type === "checkPhone")
        return canCheckPhone(current) ? checkPhone(current, event.phoneAllowed) : current;
    if (event.type === "recordSession")
        return canRecordSession(current) ? recordSession(current) : current;
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
    const is_HandoffFacts = (v) => typeof v === "object" && v !== null && !Array.isArray(v) && typeof v.bindingValid === "boolean" && typeof v.pendingLive === "boolean" && typeof v.codeWellFormed === "boolean";
    if (typeof raw !== "object" || raw === null)
        return undefined;
    if (raw.type === "checkHandoff" && is_HandoffFacts(raw.handoffFacts))
        return { type: "checkHandoff", handoffFacts: ({ bindingValid: raw.handoffFacts.bindingValid, pendingLive: raw.handoffFacts.pendingLive, codeWellFormed: raw.handoffFacts.codeWellFormed }) };
    if (raw.type === "recordExchange" && typeof raw.exchangeAccepted === "boolean")
        return { type: "recordExchange", exchangeAccepted: raw.exchangeAccepted };
    if (raw.type === "checkIdentity" && typeof raw.identityAvailable === "boolean" && typeof raw.identityValid === "boolean")
        return { type: "checkIdentity", identityAvailable: raw.identityAvailable, identityValid: raw.identityValid };
    if (raw.type === "checkPhone" && typeof raw.phoneAllowed === "boolean")
        return { type: "checkPhone", phoneAllowed: raw.phoneAllowed };
    if (raw.type === "recordSession")
        return { type: "recordSession" };
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
    if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "AwaitingHandoff" || raw.phase === "AwaitingExchange" || raw.phase === "AwaitingIdentity" || raw.phase === "AwaitingPhone" || raw.phase === "AwaitingSession" || raw.phase === "SignedIn" || raw.phase === "RejectCallback" || raw.phase === "DenySignIn" || raw.phase === "CloudUnavailable") && typeof raw.handoffAccepted === "boolean" && typeof raw.exchangeAccepted === "boolean" && typeof raw.identityAccepted === "boolean" && typeof raw.phoneAllowed === "boolean" && Object.keys(raw).length === 5))
        return undefined;
    const parsed = ({ phase: raw.phase, handoffAccepted: raw.handoffAccepted, exchangeAccepted: raw.exchangeAccepted, identityAccepted: raw.identityAccepted, phoneAllowed: raw.phoneAllowed });
    return inv(parsed) ? parsed : undefined;
}
/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds() {
    //@ ensures inv(\result)
    return initial;
}
/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_cloudSignIn(n) {
    if (!Number.isSafeInteger(n))
        throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
    return n;
}
