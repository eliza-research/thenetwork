// Generated from spec/oauthGrantIssuance.md via Vibestack and VibeLang. Run pnpm run spec:sync.
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md) */
export type IssuancePhase = "StartApproval" | "AwaitingAuthority" | "RetryAuthority" | "DeniedAuthority" | "ExpiredApproval" | "AwaitingApproval" | "AwaitingCommit" | "RetryIssuance" | "GrantIssued";
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md) */
export type AuthorityResult = "AuthorityValid" | "AuthorityInvalid" | "AuthorityUnavailable";
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md) */
export interface Issuance {
    phase: IssuancePhase;
    authorityAccepted: boolean;
    sameOwner: boolean;
    requestLive: boolean;
    grantLive: boolean;
}
/** Story: Connect my agent after I approve access / Locked approval must still match the owner and both deadlines (spec/oauthGrantIssuance.md) */
export interface LockedApproval {
    ownerMatches: boolean;
    lockedRequestLive: boolean;
    pendingGrantLive: boolean;
}
/** One variant per transition in the spec. */
export type Event = {
    type: "beginApproval";
    requestLive: boolean;
} | {
    type: "checkGrantAuthority";
    authority: AuthorityResult;
} | {
    type: "checkLockedApproval";
    approval: LockedApproval;
} | {
    type: "recordCommit";
    committed: boolean;
} | {
    type: "recordStorageFailure";
};
/** Story: Connect my agent after I approve access / Locked approval must still match the owner and both deadlines (spec/oauthGrantIssuance.md) */
export declare const eligibleApproval: LockedApproval;
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md) */
export declare const initial: Issuance;
/** Every `always` rule at once. Holds initially and after every transition. */
export declare function inv(current: Issuance): boolean;
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md) */
export declare function requestIsLive(asOf: number, expiresAt: number): boolean;
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md) */
export declare function canBeginApproval(issuance: Issuance): boolean;
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md) */
export declare function beginApproval(issuance: Issuance, requestLive: boolean): Issuance;
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md) */
export declare function lawDeadlineExcludesExpiry(expiresAt: number): boolean;
/** Story: Connect my agent after I approve access / Authority is checked before the consent request is locked (spec/oauthGrantIssuance.md) */
export declare function canCheckGrantAuthority(issuance: Issuance): boolean;
/** Story: Connect my agent after I approve access / Authority is checked before the consent request is locked (spec/oauthGrantIssuance.md) */
export declare function checkGrantAuthority(issuance: Issuance, authority: AuthorityResult): Issuance;
/** Story: Connect my agent after I approve access / Locked approval must still match the owner and both deadlines (spec/oauthGrantIssuance.md) */
export declare function canCheckLockedApproval(issuance: Issuance): boolean;
/** Story: Connect my agent after I approve access / Locked approval must still match the owner and both deadlines (spec/oauthGrantIssuance.md) */
export declare function checkLockedApproval(issuance: Issuance, approval: LockedApproval): Issuance;
/** Story: Connect my agent after I approve access / A successful response follows one atomic commit (spec/oauthGrantIssuance.md) */
export declare function canRecordCommit(issuance: Issuance, committed: boolean): boolean;
/** Story: Connect my agent after I approve access / A successful response follows one atomic commit (spec/oauthGrantIssuance.md) */
export declare function recordCommit(issuance: Issuance, committed: boolean): Issuance;
/** Story: Connect my agent after I approve access / A successful response follows one atomic commit (spec/oauthGrantIssuance.md) */
export declare function canRecordStorageFailure(issuance: Issuance): boolean;
/** Story: Connect my agent after I approve access / A successful response follows one atomic commit (spec/oauthGrantIssuance.md) */
export declare function recordStorageFailure(issuance: Issuance): Issuance;
/** Story: Connect my agent after I approve access / A successful response follows one atomic commit (spec/oauthGrantIssuance.md) */
export declare function stepIssuanceFollowsCommit(before: Issuance, via: string, after: Issuance): boolean;
/** Story: Connect my agent after I approve access / A successful response follows one atomic commit (spec/oauthGrantIssuance.md) */
export declare function sometimesRetriesIssuance(issuance: Issuance): boolean;
/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md) */
export declare function alwaysIssuanceRequiresCurrentApproval(issuance: Issuance): boolean;
/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md) */
export declare function sometimesIssuesGrant(issuance: Issuance): boolean;
/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md) */
export declare function sometimesRetriesAuthority(issuance: Issuance): boolean;
/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md) */
export declare function sometimesDeniesAuthority(issuance: Issuance): boolean;
/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md) */
export declare function sometimesExpiresApproval(issuance: Issuance): boolean;
/** Do the rules allow this event in this state? */
export declare function enabled(current: Issuance, event: Event): boolean;
/** Apply an event. An event the rules do not allow leaves the state unchanged. */
export declare function step(current: Issuance, event: Event): Issuance;
/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
export declare function parseEvent(x: unknown): Event | undefined;
/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
export declare function parseState(x: unknown): Issuance | undefined;
/** Proof obligation: the initial state satisfies every `always` rule. */
export declare function initialHolds(): Issuance;
