// Generated from spec/oauthGrantIssuance.md via Vibestack and VibeLang. Run pnpm run spec:sync.
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md:9) */
export type IssuancePhase = "StartApproval" | "AwaitingAuthority" | "RetryAuthority" | "DeniedAuthority" | "ExpiredApproval" | "AwaitingConsumption" | "AwaitingPersistence" | "AwaitingCode" | "AwaitingAudit" | "GrantIssued";
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md:9) */
export type AuthorityResult = "AuthorityValid" | "AuthorityInvalid" | "AuthorityUnavailable";
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md:9) */
export interface Issuance {
    phase: IssuancePhase;
    authorityAccepted: boolean;
    sameOwner: boolean;
    requestLive: boolean;
    grantLive: boolean;
}
/** Story: Connect my agent after I approve access / Consumed approval must still match the owner and both deadlines (spec/oauthGrantIssuance.md:47) */
export interface ConsumedApproval {
    ownerMatches: boolean;
    consumedRequestLive: boolean;
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
    type: "checkConsumption";
    consumption: ConsumedApproval;
} | {
    type: "recordGrant";
} | {
    type: "recordCode";
} | {
    type: "recordIssuance";
};
/** Story: Connect my agent after I approve access / Consumed approval must still match the owner and both deadlines (spec/oauthGrantIssuance.md:47) */
export declare const validConsumption: ConsumedApproval;
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md:9) */
export declare const initial: Issuance;
/** Every `always` rule at once. Holds initially and after every transition. */
export declare function inv(current: Issuance): boolean;
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md:9) */
export declare function requestIsLive(asOf: number, expiresAt: number): boolean;
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md:9) */
export declare function canBeginApproval(issuance: Issuance): boolean;
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md:9) */
export declare function beginApproval(issuance: Issuance, requestLive: boolean): Issuance;
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md:9) */
export declare function lawDeadlineExcludesExpiry(expiresAt: number): boolean;
/** Story: Connect my agent after I approve access / Authority is checked before the consent request is consumed (spec/oauthGrantIssuance.md:32) */
export declare function canCheckGrantAuthority(issuance: Issuance): boolean;
/** Story: Connect my agent after I approve access / Authority is checked before the consent request is consumed (spec/oauthGrantIssuance.md:32) */
export declare function checkGrantAuthority(issuance: Issuance, authority: AuthorityResult): Issuance;
/** Story: Connect my agent after I approve access / Consumed approval must still match the owner and both deadlines (spec/oauthGrantIssuance.md:47) */
export declare function canCheckConsumption(issuance: Issuance): boolean;
/** Story: Connect my agent after I approve access / Consumed approval must still match the owner and both deadlines (spec/oauthGrantIssuance.md:47) */
export declare function checkConsumption(issuance: Issuance, consumption: ConsumedApproval): Issuance;
/** Story: Connect my agent after I approve access / A successful response follows the grant, code and audit writes (spec/oauthGrantIssuance.md:68) */
export declare function canRecordGrant(issuance: Issuance): boolean;
/** Story: Connect my agent after I approve access / A successful response follows the grant, code and audit writes (spec/oauthGrantIssuance.md:68) */
export declare function recordGrant(issuance: Issuance): Issuance;
/** Story: Connect my agent after I approve access / A successful response follows the grant, code and audit writes (spec/oauthGrantIssuance.md:68) */
export declare function canRecordCode(issuance: Issuance): boolean;
/** Story: Connect my agent after I approve access / A successful response follows the grant, code and audit writes (spec/oauthGrantIssuance.md:68) */
export declare function recordCode(issuance: Issuance): Issuance;
/** Story: Connect my agent after I approve access / A successful response follows the grant, code and audit writes (spec/oauthGrantIssuance.md:68) */
export declare function canRecordIssuance(issuance: Issuance): boolean;
/** Story: Connect my agent after I approve access / A successful response follows the grant, code and audit writes (spec/oauthGrantIssuance.md:68) */
export declare function recordIssuance(issuance: Issuance): Issuance;
/** Story: Connect my agent after I approve access / A successful response follows the grant, code and audit writes (spec/oauthGrantIssuance.md:68) */
export declare function stepIssuanceFollowsAudit(before: Issuance, via: string, after: Issuance): boolean;
/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md:89) */
export declare function alwaysIssuanceRequiresCurrentApproval(issuance: Issuance): boolean;
/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md:89) */
export declare function sometimesIssuesGrant(issuance: Issuance): boolean;
/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md:89) */
export declare function sometimesRetriesAuthority(issuance: Issuance): boolean;
/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md:89) */
export declare function sometimesDeniesAuthority(issuance: Issuance): boolean;
/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md:89) */
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
