// Generated from spec/cloudSignIn.md via Vibestack and VibeLang. Run pnpm run spec:sync.
import type { HandoffFacts, SignIn, Event } from "./cloudSignIn.ts";
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) @throws {never} */
export declare const cloudClockSkewMs: number;
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md) @throws {never} */
export declare const validHandoff: HandoffFacts;
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md) @throws {never} */
export declare const initial: SignIn;
/** Every `always` rule at once. Holds initially and after every transition. @throws {never} */
export declare function inv(current: SignIn): boolean;
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md) @throws {never} */
export declare function liveBeforeDeadline(asOf: number, expiresAt: number): boolean;
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md) @throws {never} */
export declare function canCheckHandoff(signIn: SignIn): boolean;
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md) @throws {never} */
export declare function checkHandoff(signIn: SignIn, handoffFacts: HandoffFacts): SignIn;
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md) @throws {never} */
export declare function lawAnExpiredHandoffIsNeverLive(expiresAt: number): boolean;
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) @throws {never} */
export declare function cloudIssuedAtWithinSkew(issuedAtMs: number, asOf: number): boolean;
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) @throws {never} */
export declare function cloudSessionStartedAt(issuedAtMs: number, asOf: number): number;
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) @throws {never} */
export declare function cloudIdentityTimesValid(issuedAtMs: number, expiresAtMs: number, asOf: number): boolean;
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) @throws {never} */
export declare function lawSessionStartIsNeverFuture(issuedAtMs: number, asOf: number): boolean;
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) @throws {never} */
export declare function canRecordExchange(signIn: SignIn): boolean;
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) @throws {never} */
export declare function recordExchange(signIn: SignIn, exchangeAccepted: boolean): SignIn;
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) @throws {never} */
export declare function canCheckIdentity(signIn: SignIn): boolean;
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) @throws {never} */
export declare function checkIdentity(signIn: SignIn, identityAvailable: boolean, identityValid: boolean): SignIn;
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) @throws {never} */
export declare function lawCloudIdentityNeedsFutureExpiry(issuedAtMs: number, asOf: number): boolean;
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) @throws {never} */
export declare function lawCloudIdentityNeedsPositiveIssueTime(expiresAtMs: number, asOf: number): boolean;
/** Story: Use my Cloud identity to sign in to this app / The site checks phone eligibility before issuing a session (spec/cloudSignIn.md) @throws {never} */
export declare function lawStoredSessionEndsByIdentityExpiry(createdAt: number, startedAt: number, ttl: number, maxAge: number, identityExpiry: number): boolean;
/** Story: Use my Cloud identity to sign in to this app / The site checks phone eligibility before issuing a session (spec/cloudSignIn.md) @throws {never} */
export declare function canCheckPhone(signIn: SignIn): boolean;
/** Story: Use my Cloud identity to sign in to this app / The site checks phone eligibility before issuing a session (spec/cloudSignIn.md) @throws {never} */
export declare function checkPhone(signIn: SignIn, phoneAllowed: boolean): SignIn;
/** Story: Use my Cloud identity to sign in to this app / The site checks phone eligibility before issuing a session (spec/cloudSignIn.md) @throws {never} */
export declare function canRecordSession(signIn: SignIn): boolean;
/** Story: Use my Cloud identity to sign in to this app / The site checks phone eligibility before issuing a session (spec/cloudSignIn.md) @throws {never} */
export declare function recordSession(signIn: SignIn): SignIn;
/** Story: Use my Cloud identity to sign in to this app / A completed callback passed each issuance check (spec/cloudSignIn.md) @throws {never} */
export declare function alwaysSessionRequiresAcceptedHandoff(signIn: SignIn): boolean;
/** Story: Use my Cloud identity to sign in to this app / A completed callback passed each issuance check (spec/cloudSignIn.md) @throws {never} */
export declare function sometimesSignsIn(signIn: SignIn): boolean;
/** Story: Use my Cloud identity to sign in to this app / A completed callback passed each issuance check (spec/cloudSignIn.md) @throws {never} */
export declare function sometimesRejectsCallback(signIn: SignIn): boolean;
/** Story: Use my Cloud identity to sign in to this app / A completed callback passed each issuance check (spec/cloudSignIn.md) @throws {never} */
export declare function sometimesDeniesSignIn(signIn: SignIn): boolean;
/** Story: Use my Cloud identity to sign in to this app / A completed callback passed each issuance check (spec/cloudSignIn.md) @throws {never} */
export declare function sometimesCloudUnavailable(signIn: SignIn): boolean;
/** Do the rules allow this event in this state? @throws {never} */
export declare function enabled(current: SignIn, event: Event): boolean;
/** Apply an event. An event the rules do not allow leaves the state unchanged. @throws {never} */
export declare function step(current: SignIn, event: Event): SignIn;
/** Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program: the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy with exactly the fields the event has, so nothing the caller keeps can change it afterwards. @throws {never} */
export declare function parseEvent(x: unknown): Event | undefined;
/** Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The result is a fresh copy, so nothing the caller keeps can change it afterwards. @throws {never} */
export declare function parseState(x: unknown): SignIn | undefined;
/** A Machine never shares a state with its callers. @throws {never} */
export declare function snapshot_cloudSignIn<A>(value: A): A;
