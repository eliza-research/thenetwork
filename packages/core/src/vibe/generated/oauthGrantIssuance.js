// Generated from spec/oauthGrantIssuance.md via Vibestack and VibeLang. Run pnpm run spec:sync.
// GENERATED from spec/oauthGrantIssuance.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
/** Story: Connect my agent after I approve access / Locked approval must still match the owner and both deadlines (spec/oauthGrantIssuance.md:47) */
export const eligibleApproval = { ownerMatches: true, lockedRequestLive: true, pendingGrantLive: true };
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
    //@ ensures (inv(issuance) && canBeginApproval(issuance)) ==> stepIssuanceFollowsCommit(issuance, "beginApproval", \result)
    return { ...issuance, phase: requestLive ? "AwaitingAuthority" : "ExpiredApproval", requestLive: requestLive };
}
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md:9) */
//@ pure
export function lawDeadlineExcludesExpiry(expiresAt) {
    //@ ensures \result === true
    return !requestIsLive(expiresAt, expiresAt);
}
/** Story: Connect my agent after I approve access / Authority is checked before the consent request is locked (spec/oauthGrantIssuance.md:32) */
//@ pure
export function canCheckGrantAuthority(issuance) {
    return issuance.phase === "AwaitingAuthority" && issuance.requestLive;
}
/** Story: Connect my agent after I approve access / Authority is checked before the consent request is locked (spec/oauthGrantIssuance.md:32) */
//@ pure
export function checkGrantAuthority(issuance, authority) {
    //@ ensures (inv(issuance) && canCheckGrantAuthority(issuance)) ==> alwaysIssuanceRequiresCurrentApproval(\result)
    //@ ensures (inv(issuance) && canCheckGrantAuthority(issuance)) ==> stepIssuanceFollowsCommit(issuance, "checkGrantAuthority", \result)
    return { ...issuance, authorityAccepted: authority === "AuthorityValid", phase: authority === "AuthorityValid" ? "AwaitingApproval" : (authority === "AuthorityUnavailable" ? "RetryAuthority" : "DeniedAuthority") };
}
/** Story: Connect my agent after I approve access / Locked approval must still match the owner and both deadlines (spec/oauthGrantIssuance.md:47) */
//@ pure
export function canCheckLockedApproval(issuance) {
    return issuance.phase === "AwaitingApproval" && issuance.authorityAccepted && issuance.requestLive;
}
/** Story: Connect my agent after I approve access / Locked approval must still match the owner and both deadlines (spec/oauthGrantIssuance.md:47) */
//@ pure
export function checkLockedApproval(issuance, approval) {
    //@ ensures (inv(issuance) && canCheckLockedApproval(issuance)) ==> alwaysIssuanceRequiresCurrentApproval(\result)
    //@ ensures (inv(issuance) && canCheckLockedApproval(issuance)) ==> stepIssuanceFollowsCommit(issuance, "checkLockedApproval", \result)
    const local_0 = approval.ownerMatches && approval.lockedRequestLive && approval.pendingGrantLive;
    return { ...issuance, sameOwner: approval.ownerMatches, requestLive: approval.lockedRequestLive, grantLive: approval.pendingGrantLive, phase: local_0 ? "AwaitingCommit" : "ExpiredApproval" };
}
/** Story: Connect my agent after I approve access / A successful response follows one atomic commit (spec/oauthGrantIssuance.md:68) */
//@ pure
export function canRecordCommit(issuance, committed) {
    return issuance.phase === "AwaitingCommit" || (!committed && (issuance.phase === "AwaitingApproval" || issuance.phase === "ExpiredApproval"));
}
/** Story: Connect my agent after I approve access / A successful response follows one atomic commit (spec/oauthGrantIssuance.md:68) */
//@ pure
export function recordCommit(issuance, committed) {
    //@ ensures (inv(issuance) && canRecordCommit(issuance, committed)) ==> alwaysIssuanceRequiresCurrentApproval(\result)
    //@ ensures (inv(issuance) && canRecordCommit(issuance, committed)) ==> stepIssuanceFollowsCommit(issuance, "recordCommit", \result)
    return { ...issuance, phase: committed ? "GrantIssued" : "ExpiredApproval" };
}
/** Story: Connect my agent after I approve access / A successful response follows one atomic commit (spec/oauthGrantIssuance.md:68) */
//@ pure
export function canRecordStorageFailure(issuance) {
    return issuance.phase === "AwaitingApproval" || issuance.phase === "AwaitingCommit" || issuance.phase === "ExpiredApproval";
}
/** Story: Connect my agent after I approve access / A successful response follows one atomic commit (spec/oauthGrantIssuance.md:68) */
//@ pure
export function recordStorageFailure(issuance) {
    //@ ensures (inv(issuance) && canRecordStorageFailure(issuance)) ==> alwaysIssuanceRequiresCurrentApproval(\result)
    //@ ensures (inv(issuance) && canRecordStorageFailure(issuance)) ==> stepIssuanceFollowsCommit(issuance, "recordStorageFailure", \result)
    return { ...issuance, phase: "RetryIssuance" };
}
/** Story: Connect my agent after I approve access / A successful response follows one atomic commit (spec/oauthGrantIssuance.md:68) */
//@ pure
export function stepIssuanceFollowsCommit(before, via, after) {
    return !(after.phase === "GrantIssued") || (before.phase === "AwaitingCommit" && via === "recordCommit");
}
/** Story: Connect my agent after I approve access / A successful response follows one atomic commit (spec/oauthGrantIssuance.md:68) */
//@ pure
export function sometimesRetriesIssuance(issuance) {
    return issuance.phase === "RetryIssuance";
}
/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md:91) */
//@ pure
export function alwaysIssuanceRequiresCurrentApproval(issuance) {
    return !(issuance.phase === "AwaitingCommit" || issuance.phase === "GrantIssued") || (issuance.authorityAccepted && issuance.sameOwner && issuance.requestLive && issuance.grantLive);
}
/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md:91) */
//@ pure
export function sometimesIssuesGrant(issuance) {
    return issuance.phase === "GrantIssued";
}
/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md:91) */
//@ pure
export function sometimesRetriesAuthority(issuance) {
    return issuance.phase === "RetryAuthority";
}
/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md:91) */
//@ pure
export function sometimesDeniesAuthority(issuance) {
    return issuance.phase === "DeniedAuthority";
}
/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md:91) */
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
    if (event.type === "checkLockedApproval")
        return canCheckLockedApproval(current);
    if (event.type === "recordCommit")
        return canRecordCommit(current, event.committed);
    if (event.type === "recordStorageFailure")
        return canRecordStorageFailure(current);
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
    if (event.type === "checkLockedApproval" && canCheckLockedApproval(current))
        return checkLockedApproval(current, event.approval);
    if (event.type === "recordCommit" && canRecordCommit(current, event.committed))
        return recordCommit(current, event.committed);
    if (event.type === "recordStorageFailure" && canRecordStorageFailure(current))
        return recordStorageFailure(current);
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
    const is_LockedApproval = (v) => typeof v === "object" && v !== null && !Array.isArray(v) && typeof v.ownerMatches === "boolean" && typeof v.lockedRequestLive === "boolean" && typeof v.pendingGrantLive === "boolean";
    if (typeof raw !== "object" || raw === null)
        return undefined;
    if (raw.type === "beginApproval" && typeof raw.requestLive === "boolean")
        return { type: "beginApproval", requestLive: raw.requestLive };
    if (raw.type === "checkGrantAuthority" && (raw.authority === "AuthorityValid" || raw.authority === "AuthorityInvalid" || raw.authority === "AuthorityUnavailable"))
        return { type: "checkGrantAuthority", authority: raw.authority };
    if (raw.type === "checkLockedApproval" && is_LockedApproval(raw.approval))
        return { type: "checkLockedApproval", approval: ({ ownerMatches: raw.approval.ownerMatches, lockedRequestLive: raw.approval.lockedRequestLive, pendingGrantLive: raw.approval.pendingGrantLive }) };
    if (raw.type === "recordCommit" && typeof raw.committed === "boolean")
        return { type: "recordCommit", committed: raw.committed };
    if (raw.type === "recordStorageFailure")
        return { type: "recordStorageFailure" };
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
    if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "StartApproval" || raw.phase === "AwaitingAuthority" || raw.phase === "RetryAuthority" || raw.phase === "DeniedAuthority" || raw.phase === "ExpiredApproval" || raw.phase === "AwaitingApproval" || raw.phase === "AwaitingCommit" || raw.phase === "RetryIssuance" || raw.phase === "GrantIssued") && typeof raw.authorityAccepted === "boolean" && typeof raw.sameOwner === "boolean" && typeof raw.requestLive === "boolean" && typeof raw.grantLive === "boolean" && Object.keys(raw).length === 5))
        return undefined;
    const parsed = ({ phase: raw.phase, authorityAccepted: raw.authorityAccepted, sameOwner: raw.sameOwner, requestLive: raw.requestLive, grantLive: raw.grantLive });
    return inv(parsed) ? parsed : undefined;
}
/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds() {
    //@ ensures inv(\result)
    return initial;
}
