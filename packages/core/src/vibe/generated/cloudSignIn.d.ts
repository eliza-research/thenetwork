// Generated from spec/cloudSignIn.md via Vibestack and VibeLang. Run pnpm run spec:sync.
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md) */
export type SignInPhase = "AwaitingHandoff" | "AwaitingExchange" | "AwaitingIdentity" | "AwaitingPhone" | "AwaitingSession" | "SignedIn" | "RejectCallback" | "DenySignIn" | "CloudUnavailable";
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md) */
export interface HandoffFacts {
    bindingValid: boolean;
    pendingLive: boolean;
    codeWellFormed: boolean;
}
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md) */
export interface SignIn {
    phase: SignInPhase;
    handoffAccepted: boolean;
    exchangeAccepted: boolean;
    identityAccepted: boolean;
    phoneAllowed: boolean;
}
/** One variant per transition in the spec. */
export type Event = {
    type: "checkHandoff";
    handoffFacts: HandoffFacts;
} | {
    type: "recordExchange";
    exchangeAccepted: boolean;
} | {
    type: "checkIdentity";
    identityAvailable: boolean;
    identityValid: boolean;
} | {
    type: "checkPhone";
    phoneAllowed: boolean;
} | {
    type: "recordSession";
};
/** Story: Use my Cloud identity to sign in to this app / The Home Help callback returns to the same Network site (spec/cloudSignIn.md) */
export declare const homeHelpCloudPath: string;
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
export declare const cloudClockSkewMs: number;
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
export declare const cloudProofLifeMs: number;
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md) */
export declare const validHandoff: HandoffFacts;
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md) */
export declare const initial: SignIn;
/** Every `always` rule at once. Holds initially and after every transition. */
export declare function inv(current: SignIn): boolean;
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md) */
export declare function liveBeforeDeadline(asOf: number, expiresAt: number): boolean;
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md) */
export declare function canCheckHandoff(signIn: SignIn): boolean;
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md) */
export declare function checkHandoff(signIn: SignIn, handoffFacts: HandoffFacts): SignIn;
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md) */
export declare function lawAnExpiredHandoffIsNeverLive(expiresAt: number): boolean;
/** Story: Use my Cloud identity to sign in to this app / The Home Help callback returns to the same Network site (spec/cloudSignIn.md) */
export declare function homeHelpCloudReturnAllowed(app: string, path: string): boolean;
/** Story: Use my Cloud identity to sign in to this app / The Home Help callback returns to the same Network site (spec/cloudSignIn.md) */
export declare function homeHelpCloudFailurePath(callbackApp: string, pendingApp: string, path: string, status: number): string;
/** Story: Use my Cloud identity to sign in to this app / The Home Help callback returns to the same Network site (spec/cloudSignIn.md) */
export declare function lawHomeHelpCloudReturnIsExact(app: string, path: string): boolean;
/** Story: Use my Cloud identity to sign in to this app / The Home Help callback returns to the same Network site (spec/cloudSignIn.md) */
export declare function lawHomeHelpCloudFailureRequiresSameApp(callbackApp: string, pendingApp: string, path: string, status: number): boolean;
/** Story: Use my Cloud identity to sign in to this app / The Home Help callback returns to the same Network site (spec/cloudSignIn.md) */
export declare function lawHomeHelpCloudFailureIsFixed(callbackApp: string, pendingApp: string, path: string, status: number): boolean;
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
export declare function cloudIssuedAtWithinSkew(issuedAtMs: number, asOf: number): boolean;
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
export declare function cloudProofLifeValid(issuedAtMs: number, expiresAtMs: number): boolean;
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
export declare function cloudSessionStartedAt(issuedAtMs: number, asOf: number): number;
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
export declare function cloudIdentityTimesValid(issuedAtMs: number, expiresAtMs: number, asOf: number): boolean;
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
export declare function lawSessionStartIsNeverFuture(issuedAtMs: number, asOf: number): boolean;
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
export declare function canRecordExchange(signIn: SignIn): boolean;
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
export declare function recordExchange(signIn: SignIn, exchangeAccepted: boolean): SignIn;
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
export declare function canCheckIdentity(signIn: SignIn): boolean;
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
export declare function checkIdentity(signIn: SignIn, identityAvailable: boolean, identityValid: boolean): SignIn;
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
export declare function lawCloudProofLivesAtMostOneHour(issuedAtMs: number, asOf: number): boolean;
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
export declare function lawOneHourProofIsAcceptedWhenIssued(issuedAtMs: number): boolean;
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
export declare function lawCloudIdentityNeedsFutureExpiry(issuedAtMs: number, asOf: number): boolean;
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) */
export declare function lawCloudIdentityNeedsPositiveIssueTime(expiresAtMs: number, asOf: number): boolean;
/** Story: Use my Cloud identity to sign in to this app / The site checks phone eligibility before issuing a session (spec/cloudSignIn.md) */
export declare function lawStoredSessionEndsByIdentityExpiry(createdAt: number, startedAt: number, ttl: number, maxAge: number, identityExpiry: number): boolean;
/** Story: Use my Cloud identity to sign in to this app / The site checks phone eligibility before issuing a session (spec/cloudSignIn.md) */
export declare function canCheckPhone(signIn: SignIn): boolean;
/** Story: Use my Cloud identity to sign in to this app / The site checks phone eligibility before issuing a session (spec/cloudSignIn.md) */
export declare function checkPhone(signIn: SignIn, phoneAllowed: boolean): SignIn;
/** Story: Use my Cloud identity to sign in to this app / The site checks phone eligibility before issuing a session (spec/cloudSignIn.md) */
export declare function canRecordSession(signIn: SignIn): boolean;
/** Story: Use my Cloud identity to sign in to this app / The site checks phone eligibility before issuing a session (spec/cloudSignIn.md) */
export declare function recordSession(signIn: SignIn): SignIn;
/** Story: Use my Cloud identity to sign in to this app / A completed callback passed each issuance check (spec/cloudSignIn.md) */
export declare function alwaysSessionRequiresAcceptedHandoff(signIn: SignIn): boolean;
/** Story: Use my Cloud identity to sign in to this app / A completed callback passed each issuance check (spec/cloudSignIn.md) */
export declare function sometimesSignsIn(signIn: SignIn): boolean;
/** Story: Use my Cloud identity to sign in to this app / A completed callback passed each issuance check (spec/cloudSignIn.md) */
export declare function sometimesRejectsCallback(signIn: SignIn): boolean;
/** Story: Use my Cloud identity to sign in to this app / A completed callback passed each issuance check (spec/cloudSignIn.md) */
export declare function sometimesDeniesSignIn(signIn: SignIn): boolean;
/** Story: Use my Cloud identity to sign in to this app / A completed callback passed each issuance check (spec/cloudSignIn.md) */
export declare function sometimesCloudUnavailable(signIn: SignIn): boolean;
/** Do the rules allow this event in this state? */
export declare function enabled(current: SignIn, event: Event): boolean;
/** Apply an event. An event the rules do not allow leaves the state unchanged. */
export declare function step(current: SignIn, event: Event): SignIn;
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
export declare function parseState(x: unknown): SignIn | undefined;
/** Proof obligation: the initial state satisfies every `always` rule. */
export declare function initialHolds(): SignIn;
/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export declare function exact_cloudSignIn(n: number): number;
