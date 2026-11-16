// Generated from spec/cloudSignIn.md via Vibestack and VibeLang. Run pnpm run spec:sync.
import * as M from "./cloudSignIn.js";
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) @throws {never} */
export const cloudClockSkewMs = M.cloudClockSkewMs;
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md) @throws {never} */
export const validHandoff = M.validHandoff;
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md) @throws {never} */
export const initial = M.initial;
/** Every `always` rule at once. Holds initially and after every transition. @throws {never} */
export function inv(current) { return M.inv(current); }
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md) @throws {never} */
export function liveBeforeDeadline(asOf, expiresAt) { return M.liveBeforeDeadline(asOf, expiresAt); }
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md) @throws {never} */
export function canCheckHandoff(signIn) { return M.canCheckHandoff(signIn); }
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md) @throws {never} */
export function checkHandoff(signIn, handoffFacts) { return M.checkHandoff(signIn, handoffFacts); }
/** Story: Use my Cloud identity to sign in to this app / The callback requires a live handoff for this app (spec/cloudSignIn.md) @throws {never} */
export function lawAnExpiredHandoffIsNeverLive(expiresAt) { return M.lawAnExpiredHandoffIsNeverLive(expiresAt); }
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) @throws {never} */
export function cloudIssuedAtWithinSkew(issuedAtMs, asOf) { return M.cloudIssuedAtWithinSkew(issuedAtMs, asOf); }
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) @throws {never} */
export function cloudSessionStartedAt(issuedAtMs, asOf) { return M.cloudSessionStartedAt(issuedAtMs, asOf); }
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) @throws {never} */
export function lawSessionStartIsNeverFuture(issuedAtMs, asOf) { return M.lawSessionStartIsNeverFuture(issuedAtMs, asOf); }
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) @throws {never} */
export function canRecordExchange(signIn) { return M.canRecordExchange(signIn); }
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) @throws {never} */
export function recordExchange(signIn, exchangeAccepted) { return M.recordExchange(signIn, exchangeAccepted); }
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) @throws {never} */
export function canCheckIdentity(signIn) { return M.canCheckIdentity(signIn); }
/** Story: Use my Cloud identity to sign in to this app / Cloud must accept the exchange and return a live identity (spec/cloudSignIn.md) @throws {never} */
export function checkIdentity(signIn, identityAvailable, identityValid) { return M.checkIdentity(signIn, identityAvailable, identityValid); }
/** Story: Use my Cloud identity to sign in to this app / The site checks phone eligibility before issuing a session (spec/cloudSignIn.md) @throws {never} */
export function canCheckPhone(signIn) { return M.canCheckPhone(signIn); }
/** Story: Use my Cloud identity to sign in to this app / The site checks phone eligibility before issuing a session (spec/cloudSignIn.md) @throws {never} */
export function checkPhone(signIn, phoneAllowed) { return M.checkPhone(signIn, phoneAllowed); }
/** Story: Use my Cloud identity to sign in to this app / The site checks phone eligibility before issuing a session (spec/cloudSignIn.md) @throws {never} */
export function canRecordSession(signIn) { return M.canRecordSession(signIn); }
/** Story: Use my Cloud identity to sign in to this app / The site checks phone eligibility before issuing a session (spec/cloudSignIn.md) @throws {never} */
export function recordSession(signIn) { return M.recordSession(signIn); }
/** Story: Use my Cloud identity to sign in to this app / A completed callback passed each issuance check (spec/cloudSignIn.md) @throws {never} */
export function alwaysSessionRequiresAcceptedHandoff(signIn) { return M.alwaysSessionRequiresAcceptedHandoff(signIn); }
/** Story: Use my Cloud identity to sign in to this app / A completed callback passed each issuance check (spec/cloudSignIn.md) @throws {never} */
export function sometimesSignsIn(signIn) { return M.sometimesSignsIn(signIn); }
/** Story: Use my Cloud identity to sign in to this app / A completed callback passed each issuance check (spec/cloudSignIn.md) @throws {never} */
export function sometimesRejectsCallback(signIn) { return M.sometimesRejectsCallback(signIn); }
/** Story: Use my Cloud identity to sign in to this app / A completed callback passed each issuance check (spec/cloudSignIn.md) @throws {never} */
export function sometimesDeniesSignIn(signIn) { return M.sometimesDeniesSignIn(signIn); }
/** Story: Use my Cloud identity to sign in to this app / A completed callback passed each issuance check (spec/cloudSignIn.md) @throws {never} */
export function sometimesCloudUnavailable(signIn) { return M.sometimesCloudUnavailable(signIn); }
/** Do the rules allow this event in this state? @throws {never} */
export function enabled(current, event) { return M.enabled(current, event); }
/** Apply an event. An event the rules do not allow leaves the state unchanged. @throws {never} */
export function step(current, event) { return M.step(current, event); }
/** Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program: the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy with exactly the fields the event has, so nothing the caller keeps can change it afterwards. @throws {never} */
export function parseEvent(x) { return M.parseEvent(x); }
/** Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The result is a fresh copy, so nothing the caller keeps can change it afterwards. @throws {never} */
export function parseState(x) { return M.parseState(x); }
/** A Machine never shares a state with its callers. @throws {never} */
export function snapshot_cloudSignIn(value) { return structuredClone(value); }
