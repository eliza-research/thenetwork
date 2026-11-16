// Generated from spec/oauthGrantIssuance.md via Vibestack and VibeLang. Run pnpm run spec:sync.
// GENERATED from spec/oauthGrantIssuance.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
/** Story: Connect my agent after I approve access / Consumed approval must still match the owner and both deadlines (spec/oauthGrantIssuance.md:47) */
export const validConsumption = { ownerMatches: true, consumedRequestLive: true, pendingGrantLive: true };
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md:9) */
export const initial = { phase: "StartApproval", authorityAccepted: false, sameOwner: false, requestLive: false, grantLive: false };
/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current) {
    return alwaysIssuanceRequiresCurrentApproval(current);
}
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md:9) */
//@ pure
export function requestIsLive(asOf, expiresAt) {
    return asOf < expiresAt;
}
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md:9) */
//@ pure
export function canBeginApproval(issuance) {
    return issuance.phase === "StartApproval";
}
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md:9) */
//@ pure
export function beginApproval(issuance, requestLive) {
    //@ ensures (inv(issuance) && canBeginApproval(issuance)) ==> alwaysIssuanceRequiresCurrentApproval(\result)
    //@ ensures (inv(issuance) && canBeginApproval(issuance)) ==> stepIssuanceFollowsAudit(issuance, "beginApproval", \result)
    return { ...issuance, phase: requestLive ? "AwaitingAuthority" : "ExpiredApproval", requestLive: requestLive };
}
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md:9) */
//@ pure
export function lawDeadlineExcludesExpiry(expiresAt) {
    //@ ensures \result === true
    return !requestIsLive(expiresAt, expiresAt);
}
/** Story: Connect my agent after I approve access / Authority is checked before the consent request is consumed (spec/oauthGrantIssuance.md:32) */
//@ pure
export function canCheckGrantAuthority(issuance) {
    return issuance.phase === "AwaitingAuthority" && issuance.requestLive;
}
/** Story: Connect my agent after I approve access / Authority is checked before the consent request is consumed (spec/oauthGrantIssuance.md:32) */
//@ pure
export function checkGrantAuthority(issuance, authority) {
    //@ ensures (inv(issuance) && canCheckGrantAuthority(issuance)) ==> alwaysIssuanceRequiresCurrentApproval(\result)
    //@ ensures (inv(issuance) && canCheckGrantAuthority(issuance)) ==> stepIssuanceFollowsAudit(issuance, "checkGrantAuthority", \result)
    return { ...issuance, authorityAccepted: authority === "AuthorityValid", phase: authority === "AuthorityValid" ? "AwaitingConsumption" : (authority === "AuthorityUnavailable" ? "RetryAuthority" : "DeniedAuthority") };
}
/** Story: Connect my agent after I approve access / Consumed approval must still match the owner and both deadlines (spec/oauthGrantIssuance.md:47) */
//@ pure
export function canCheckConsumption(issuance) {
    return issuance.phase === "AwaitingConsumption" && issuance.authorityAccepted && issuance.requestLive;
}
/** Story: Connect my agent after I approve access / Consumed approval must still match the owner and both deadlines (spec/oauthGrantIssuance.md:47) */
//@ pure
export function checkConsumption(issuance, consumption) {
    //@ ensures (inv(issuance) && canCheckConsumption(issuance)) ==> alwaysIssuanceRequiresCurrentApproval(\result)
    //@ ensures (inv(issuance) && canCheckConsumption(issuance)) ==> stepIssuanceFollowsAudit(issuance, "checkConsumption", \result)
    const local_0 = consumption.ownerMatches && consumption.consumedRequestLive && consumption.pendingGrantLive;
    return { ...issuance, sameOwner: consumption.ownerMatches, requestLive: consumption.consumedRequestLive, grantLive: consumption.pendingGrantLive, phase: local_0 ? "AwaitingPersistence" : "ExpiredApproval" };
}
/** Story: Connect my agent after I approve access / A successful response follows the grant, code and audit writes (spec/oauthGrantIssuance.md:68) */
//@ pure
export function canRecordGrant(issuance) {
    return issuance.phase === "AwaitingPersistence" && issuance.authorityAccepted && issuance.sameOwner && issuance.requestLive && issuance.grantLive;
}
/** Story: Connect my agent after I approve access / A successful response follows the grant, code and audit writes (spec/oauthGrantIssuance.md:68) */
//@ pure
export function recordGrant(issuance) {
    //@ ensures (inv(issuance) && canRecordGrant(issuance)) ==> alwaysIssuanceRequiresCurrentApproval(\result)
    //@ ensures (inv(issuance) && canRecordGrant(issuance)) ==> stepIssuanceFollowsAudit(issuance, "recordGrant", \result)
    return { ...issuance, phase: "AwaitingCode" };
}
/** Story: Connect my agent after I approve access / A successful response follows the grant, code and audit writes (spec/oauthGrantIssuance.md:68) */
//@ pure
export function canRecordCode(issuance) {
    return issuance.phase === "AwaitingCode";
}
/** Story: Connect my agent after I approve access / A successful response follows the grant, code and audit writes (spec/oauthGrantIssuance.md:68) */
//@ pure
export function recordCode(issuance) {
    //@ ensures (inv(issuance) && canRecordCode(issuance)) ==> alwaysIssuanceRequiresCurrentApproval(\result)
    //@ ensures (inv(issuance) && canRecordCode(issuance)) ==> stepIssuanceFollowsAudit(issuance, "recordCode", \result)
    return { ...issuance, phase: "AwaitingAudit" };
}
/** Story: Connect my agent after I approve access / A successful response follows the grant, code and audit writes (spec/oauthGrantIssuance.md:68) */
//@ pure
export function canRecordIssuance(issuance) {
    return issuance.phase === "AwaitingAudit";
}
/** Story: Connect my agent after I approve access / A successful response follows the grant, code and audit writes (spec/oauthGrantIssuance.md:68) */
//@ pure
export function recordIssuance(issuance) {
    //@ ensures (inv(issuance) && canRecordIssuance(issuance)) ==> alwaysIssuanceRequiresCurrentApproval(\result)
    //@ ensures (inv(issuance) && canRecordIssuance(issuance)) ==> stepIssuanceFollowsAudit(issuance, "recordIssuance", \result)
    return { ...issuance, phase: "GrantIssued" };
}
/** Story: Connect my agent after I approve access / A successful response follows the grant, code and audit writes (spec/oauthGrantIssuance.md:68) */
//@ pure
export function stepIssuanceFollowsAudit(before, via, after) {
    return !(after.phase === "GrantIssued") || (before.phase === "AwaitingAudit" && via === "recordIssuance");
}
/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md:89) */
//@ pure
export function alwaysIssuanceRequiresCurrentApproval(issuance) {
    return !(issuance.phase === "AwaitingPersistence" || issuance.phase === "AwaitingCode" || issuance.phase === "AwaitingAudit" || issuance.phase === "GrantIssued") || (issuance.authorityAccepted && issuance.sameOwner && issuance.requestLive && issuance.grantLive);
}
/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md:89) */
//@ pure
export function sometimesIssuesGrant(issuance) {
    return issuance.phase === "GrantIssued";
}
/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md:89) */
//@ pure
export function sometimesRetriesAuthority(issuance) {
    return issuance.phase === "RetryAuthority";
}
/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md:89) */
//@ pure
export function sometimesDeniesAuthority(issuance) {
    return issuance.phase === "DeniedAuthority";
}
/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md:89) */
//@ pure
export function sometimesExpiresApproval(issuance) {
    return issuance.phase === "ExpiredApproval";
}
/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current, event) {
    if (event.type === "beginApproval")
        return canBeginApproval(current);
    if (event.type === "checkGrantAuthority")
        return canCheckGrantAuthority(current);
    if (event.type === "checkConsumption")
        return canCheckConsumption(current);
    if (event.type === "recordGrant")
        return canRecordGrant(current);
    if (event.type === "recordCode")
        return canRecordCode(current);
    if (event.type === "recordIssuance")
        return canRecordIssuance(current);
    return false;
}
/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current, event) {
    //@ requires inv(current)
    //@ ensures inv(\result)
    if (event.type === "beginApproval" && canBeginApproval(current))
        return beginApproval(current, event.requestLive);
    if (event.type === "checkGrantAuthority" && canCheckGrantAuthority(current))
        return checkGrantAuthority(current, event.authority);
    if (event.type === "checkConsumption" && canCheckConsumption(current))
        return checkConsumption(current, event.consumption);
    if (event.type === "recordGrant" && canRecordGrant(current))
        return recordGrant(current);
    if (event.type === "recordCode" && canRecordCode(current))
        return recordCode(current);
    if (event.type === "recordIssuance" && canRecordIssuance(current))
        return recordIssuance(current);
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
    const is_ConsumedApproval = (v) => typeof v === "object" && v !== null && !Array.isArray(v) && typeof v.ownerMatches === "boolean" && typeof v.consumedRequestLive === "boolean" && typeof v.pendingGrantLive === "boolean";
    if (typeof raw !== "object" || raw === null)
        return undefined;
    if (raw.type === "beginApproval" && typeof raw.requestLive === "boolean")
        return { type: "beginApproval", requestLive: raw.requestLive };
    if (raw.type === "checkGrantAuthority" && (raw.authority === "AuthorityValid" || raw.authority === "AuthorityInvalid" || raw.authority === "AuthorityUnavailable"))
        return { type: "checkGrantAuthority", authority: raw.authority };
    if (raw.type === "checkConsumption" && is_ConsumedApproval(raw.consumption))
        return { type: "checkConsumption", consumption: ({ ownerMatches: raw.consumption.ownerMatches, consumedRequestLive: raw.consumption.consumedRequestLive, pendingGrantLive: raw.consumption.pendingGrantLive }) };
    if (raw.type === "recordGrant")
        return { type: "recordGrant" };
    if (raw.type === "recordCode")
        return { type: "recordCode" };
    if (raw.type === "recordIssuance")
        return { type: "recordIssuance" };
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
    if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "StartApproval" || raw.phase === "AwaitingAuthority" || raw.phase === "RetryAuthority" || raw.phase === "DeniedAuthority" || raw.phase === "ExpiredApproval" || raw.phase === "AwaitingConsumption" || raw.phase === "AwaitingPersistence" || raw.phase === "AwaitingCode" || raw.phase === "AwaitingAudit" || raw.phase === "GrantIssued") && typeof raw.authorityAccepted === "boolean" && typeof raw.sameOwner === "boolean" && typeof raw.requestLive === "boolean" && typeof raw.grantLive === "boolean" && Object.keys(raw).length === 5))
        return undefined;
    const parsed = ({ phase: raw.phase, authorityAccepted: raw.authorityAccepted, sameOwner: raw.sameOwner, requestLive: raw.requestLive, grantLive: raw.grantLive });
    return inv(parsed) ? parsed : undefined;
}
/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds() {
    //@ ensures inv(\result)
    return initial;
}
