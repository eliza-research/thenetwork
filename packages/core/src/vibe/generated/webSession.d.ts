// Generated from spec/webSession.md via Vibestack and VibeLang. Run pnpm run spec:sync.
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
export type SessionPhase = "Beginning" | "LookingUp" | "Refused" | "Usable" | "RevokingOld" | "IssuingReplacement" | "Rotated";
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
export interface SessionFlow {
    phase: SessionPhase;
    revokeAt: number;
}
/** One variant per transition in the spec. */
export type Event = {
    type: "readToken";
    tokenPresent: boolean;
    tokenLength: number;
} | {
    type: "readRow";
    sameAppRow: boolean;
    expired: boolean;
    hasRevocation: boolean;
    revocationDue: boolean;
    banned: boolean;
    rotationRequested: boolean;
    oldEnough: boolean;
    at: number;
} | {
    type: "recordRevocation";
    rowLive: boolean;
    rotatedMeanwhile: boolean;
} | {
    type: "recordReplacement";
};
/** Story: Stay signed in to the app where I proved my phone / A session has an absolute limit from sign-in (spec/webSession.md) */
export declare const sessionTtlMs: number;
/** Story: Stay signed in to the app where I proved my phone / A session has an absolute limit from sign-in (spec/webSession.md) */
export declare const sessionRotateMs: number;
/** Story: Stay signed in to the app where I proved my phone / A session has an absolute limit from sign-in (spec/webSession.md) */
export declare const sessionMaxMs: number;
/** Story: Stay signed in to the app where I proved my phone / A session has an absolute limit from sign-in (spec/webSession.md) */
export declare const sessionGraceMs: number;
/** Story: Stay signed in to the app where I proved my phone / A session has an absolute limit from sign-in (spec/webSession.md) */
export declare const sessionStepUpMs: number;
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
export declare const initial: SessionFlow;
/** Every `always` rule at once. Holds initially and after every transition. */
export declare function inv(current: SessionFlow): boolean;
/** Story: Stay signed in to the app where I proved my phone / A session has an absolute limit from sign-in (spec/webSession.md) */
export declare function sessionDeadline(createdAt: number, startedAt: number, ttl: number, maxAge: number, limited: boolean, expiresBefore: number): number;
/** Story: Stay signed in to the app where I proved my phone / A session has an absolute limit from sign-in (spec/webSession.md) */
export declare function lawCloudDeadlineCapsSession(createdAt: number, startedAt: number, ttl: number, maxAge: number, expiresBefore: number): boolean;
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
export declare function canReadToken(flow: SessionFlow): boolean;
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
export declare function readToken(flow: SessionFlow, tokenPresent: boolean, tokenLength: number): SessionFlow;
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
export declare function canReadRow(flow: SessionFlow): boolean;
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
export declare function readRow(flow: SessionFlow, sameAppRow: boolean, expired: boolean, hasRevocation: boolean, revocationDue: boolean, banned: boolean, rotationRequested: boolean, oldEnough: boolean, at: number): SessionFlow;
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
export declare function sessionRowLive(sameApp: boolean, expiresAt: number, revoked: boolean, revokedAt: number, now: number): boolean;
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
export declare function canRecordRevocation(flow: SessionFlow): boolean;
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
export declare function recordRevocation(flow: SessionFlow, rowLive: boolean, rotatedMeanwhile: boolean): SessionFlow;
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
export declare function canRecordReplacement(flow: SessionFlow): boolean;
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
export declare function recordReplacement(flow: SessionFlow): SessionFlow;
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
export declare function stepRotationRequiresAReplacement(before: SessionFlow, via: string, after: SessionFlow): boolean;
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
export declare function sometimesRotates(flow: SessionFlow): boolean;
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
export declare function lawErasedRowIssuesNoReplacement(rotatedMeanwhile: boolean, revokeAt: number): boolean;
/** Story: Stay signed in to the app where I proved my phone / Only a live token on the requested app can authenticate (spec/webSession.md) */
export declare function lawBannedSessionIsRefused(sameAppRow: boolean, expired: boolean, hasRevocation: boolean, revocationDue: boolean, rotationRequested: boolean, oldEnough: boolean, at: number): boolean;
/** Story: Stay signed in to the app where I proved my phone / Sensitive account changes require a fresh sign-in (spec/webSession.md) */
export declare function freshSignIn(elapsed: number): boolean;
/** Story: Keep an earlier holder's sign-in away from my new account / A session without a person never outlives its number getting a person (spec/webSession.md) */
export declare function unboundSessionTakesNewPerson(numberHasPerson: boolean, provedSinceArrival: boolean): boolean;
/** Story: Keep an earlier holder's sign-in away from my new account / A session without a person never outlives its number getting a person (spec/webSession.md) */
export declare function unboundSessionEnds(numberHasPerson: boolean, provedSinceArrival: boolean): boolean;
/** Story: Keep an earlier holder's sign-in away from my new account / A session without a person never outlives its number getting a person (spec/webSession.md) */
export declare function lawNoUnboundSessionBesideAPerson(numberHasPerson: boolean, provedSinceArrival: boolean): boolean;
/** Do the rules allow this event in this state? */
export declare function enabled(current: SessionFlow, event: Event): boolean;
/** Apply an event. An event the rules do not allow leaves the state unchanged. */
export declare function step(current: SessionFlow, event: Event): SessionFlow;
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
export declare function parseState(x: unknown): SessionFlow | undefined;
/** Proof obligation: the initial state satisfies every `always` rule. */
export declare function initialHolds(): SessionFlow;
/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export declare function exact_webSession(n: number): number;
