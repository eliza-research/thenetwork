// GENERATED from spec/oauthBrowserAuthorization.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Approve access in the browser after proving my phone / A live authorization request is bound to one browser in one app (spec/oauthBrowserAuthorization.md:9) */
export type BrowserPhase = "BrowserStarting" | "BrowserExpired" | "CheckingClient" | "BrowserBound" | "ShowingPhone" | "HandingOffToCloud" | "StartingOtp" | "ShowingCode" | "VerifyingOtp" | "RetryingOtp" | "CheckingIdentity" | "ShowingConsent" | "IdentityDenied" | "CheckingConsentOwner" | "CheckingCloudGrant" | "ConsentReady" | "ConsentDeclined" | "OwnerChanged" | "CloudDenied" | "SessionRetry" | "AlreadyVerified";
/** Story: Approve access in the browser after proving my phone / A live authorization request is bound to one browser in one app (spec/oauthBrowserAuthorization.md:9) */
export interface BrowserFlow { phase: BrowserPhase; explicitlyApproved: boolean }
/** Story: Approve access in the browser after proving my phone / An existing session leads to consent or a new sign-in starts (spec/oauthBrowserAuthorization.md:35) */
export type EntrySession = "SignedIn" | "SignedOut" | "SessionUnavailable";
/** Story: Approve access in the browser after proving my phone / The stored page determines what a form can do (spec/oauthBrowserAuthorization.md:49) */
export type StoredPage = "PhonePage" | "CodePage" | "ConsentPage";
/** Story: Approve access in the browser after proving my phone / The stored page determines what a form can do (spec/oauthBrowserAuthorization.md:49) */
export type BrowserForm = "PhoneForm" | "CodeForm" | "ConsentForm" | "CancelForm" | "CloudReturn";
/** Story: Approve access in the browser after proving my phone / Only a successful challenge advances phone verification (spec/oauthBrowserAuthorization.md:68) */
export type IdentityStatus = "IdentityPermitted" | "IdentityRejected" | "IdentityUnavailable";
/** Story: Approve access in the browser after proving my phone / Explicit approval rechecks the owner and the app's required Cloud authority (spec/oauthBrowserAuthorization.md:88) */
export type ConsentCheck = "CheckAccepted" | "CheckRejected" | "CheckUnavailable";

/** One variant per transition in the spec. */
export type Event =
  | { type: "bindBrowser"; matchesDigest: boolean }
  | { type: "readBrowserClient"; clientExists: boolean }
  | { type: "chooseEntry"; session: EntrySession; cloudRequired: boolean }
  | { type: "readBrowserForm"; page: StoredPage; hasPhone: boolean; form: BrowserForm; approve: boolean }
  | { type: "recordOtpSend"; sent: boolean }
  | { type: "recordOtpVerification"; verified: boolean }
  | { type: "recordBrowserIdentity"; identity: IdentityStatus }
  | { type: "readConsentOwner"; verdict: ConsentCheck }
  | { type: "readConsentAuthority"; verdict: ConsentCheck };

/** Story: Approve access in the browser after proving my phone / A live authorization request is bound to one browser in one app (spec/oauthBrowserAuthorization.md:9) */
export const initial: BrowserFlow = { phase: "BrowserStarting", explicitlyApproved: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: BrowserFlow): boolean {
  return alwaysIssuanceNeedsExplicitConsent(current);
}

/** Story: Approve access in the browser after proving my phone / A live authorization request is bound to one browser in one app (spec/oauthBrowserAuthorization.md:9) */
//@ pure
export function mayCompareBrowserDigest(sameApp: boolean, liveRequest: boolean, cookiePresent: boolean): boolean {
  return sameApp && liveRequest && cookiePresent;
}

/** Story: Approve access in the browser after proving my phone / A live authorization request is bound to one browser in one app (spec/oauthBrowserAuthorization.md:9) */
//@ pure
export function canBindBrowser(flow: BrowserFlow): boolean {
  return flow.phase === "BrowserStarting";
}

/** Story: Approve access in the browser after proving my phone / A live authorization request is bound to one browser in one app (spec/oauthBrowserAuthorization.md:9) */
//@ pure
export function bindBrowser(flow: BrowserFlow, matchesDigest: boolean): BrowserFlow {
  //@ ensures (inv(flow) && canBindBrowser(flow)) ==> alwaysIssuanceNeedsExplicitConsent(\result)
  //@ ensures (inv(flow) && canBindBrowser(flow)) ==> stepReadyFollowsAuthority(flow, "bindBrowser", \result)
  return { ...flow, phase: matchesDigest ? "CheckingClient" : "BrowserExpired" };
}

/** Story: Approve access in the browser after proving my phone / A live authorization request is bound to one browser in one app (spec/oauthBrowserAuthorization.md:9) */
//@ pure
export function canReadBrowserClient(flow: BrowserFlow): boolean {
  return flow.phase === "CheckingClient";
}

/** Story: Approve access in the browser after proving my phone / A live authorization request is bound to one browser in one app (spec/oauthBrowserAuthorization.md:9) */
//@ pure
export function readBrowserClient(flow: BrowserFlow, clientExists: boolean): BrowserFlow {
  //@ ensures (inv(flow) && canReadBrowserClient(flow)) ==> alwaysIssuanceNeedsExplicitConsent(\result)
  //@ ensures (inv(flow) && canReadBrowserClient(flow)) ==> stepReadyFollowsAuthority(flow, "readBrowserClient", \result)
  return { ...flow, phase: clientExists ? "BrowserBound" : "BrowserExpired" };
}

/** Story: Approve access in the browser after proving my phone / An existing session leads to consent or a new sign-in starts (spec/oauthBrowserAuthorization.md:35) */
//@ pure
export function canChooseEntry(flow: BrowserFlow): boolean {
  return flow.phase === "BrowserStarting";
}

/** Story: Approve access in the browser after proving my phone / An existing session leads to consent or a new sign-in starts (spec/oauthBrowserAuthorization.md:35) */
//@ pure
export function chooseEntry(flow: BrowserFlow, session: EntrySession, cloudRequired: boolean): BrowserFlow {
  //@ ensures (inv(flow) && canChooseEntry(flow)) ==> alwaysIssuanceNeedsExplicitConsent(\result)
  //@ ensures (inv(flow) && canChooseEntry(flow)) ==> stepReadyFollowsAuthority(flow, "chooseEntry", \result)
  return { ...flow, phase: session === "SessionUnavailable" ? "SessionRetry" : (session === "SignedIn" ? "CheckingIdentity" : (cloudRequired ? "HandingOffToCloud" : "ShowingPhone")) };
}

/** Story: Approve access in the browser after proving my phone / The stored page determines what a form can do (spec/oauthBrowserAuthorization.md:49) */
//@ pure
export function canReadBrowserForm(flow: BrowserFlow): boolean {
  return flow.phase === "BrowserBound";
}

/** Story: Approve access in the browser after proving my phone / The stored page determines what a form can do (spec/oauthBrowserAuthorization.md:49) */
//@ pure
export function readBrowserForm(flow: BrowserFlow, page: StoredPage, hasPhone: boolean, form: BrowserForm, approve: boolean): BrowserFlow {
  //@ ensures (inv(flow) && canReadBrowserForm(flow)) ==> alwaysIssuanceNeedsExplicitConsent(\result)
  //@ ensures (inv(flow) && canReadBrowserForm(flow)) ==> stepReadyFollowsAuthority(flow, "readBrowserForm", \result)
  return form === "PhoneForm" ? ({ ...flow, phase: page === "ConsentPage" ? "AlreadyVerified" : "StartingOtp" } as BrowserFlow) : (form === "CodeForm" ? ({ ...flow, phase: page === "CodePage" && hasPhone ? "VerifyingOtp" : "BrowserExpired" } as BrowserFlow) : (form === "CloudReturn" ? ({ ...flow, phase: page === "PhonePage" ? "CheckingIdentity" : "BrowserExpired" } as BrowserFlow) : (form === "CancelForm" ? ({ ...flow, phase: "ConsentDeclined" } as BrowserFlow) : (page !== "ConsentPage" || !hasPhone ? ({ ...flow, phase: "BrowserExpired" } as BrowserFlow) : (approve ? ({ phase: "CheckingConsentOwner", explicitlyApproved: true } as BrowserFlow) : ({ ...flow, phase: "ConsentDeclined" } as BrowserFlow))))));
}

/** Story: Approve access in the browser after proving my phone / Only a successful challenge advances phone verification (spec/oauthBrowserAuthorization.md:68) */
//@ pure
export function canRecordOtpSend(flow: BrowserFlow): boolean {
  return flow.phase === "StartingOtp";
}

/** Story: Approve access in the browser after proving my phone / Only a successful challenge advances phone verification (spec/oauthBrowserAuthorization.md:68) */
//@ pure
export function recordOtpSend(flow: BrowserFlow, sent: boolean): BrowserFlow {
  //@ ensures (inv(flow) && canRecordOtpSend(flow)) ==> alwaysIssuanceNeedsExplicitConsent(\result)
  //@ ensures (inv(flow) && canRecordOtpSend(flow)) ==> stepReadyFollowsAuthority(flow, "recordOtpSend", \result)
  return { ...flow, phase: sent ? "ShowingCode" : "ShowingPhone" };
}

/** Story: Approve access in the browser after proving my phone / Only a successful challenge advances phone verification (spec/oauthBrowserAuthorization.md:68) */
//@ pure
export function canRecordOtpVerification(flow: BrowserFlow): boolean {
  return flow.phase === "VerifyingOtp";
}

/** Story: Approve access in the browser after proving my phone / Only a successful challenge advances phone verification (spec/oauthBrowserAuthorization.md:68) */
//@ pure
export function recordOtpVerification(flow: BrowserFlow, verified: boolean): BrowserFlow {
  //@ ensures (inv(flow) && canRecordOtpVerification(flow)) ==> alwaysIssuanceNeedsExplicitConsent(\result)
  //@ ensures (inv(flow) && canRecordOtpVerification(flow)) ==> stepReadyFollowsAuthority(flow, "recordOtpVerification", \result)
  return { ...flow, phase: verified ? "CheckingIdentity" : "RetryingOtp" };
}

/** Story: Approve access in the browser after proving my phone / Only a successful challenge advances phone verification (spec/oauthBrowserAuthorization.md:68) */
//@ pure
export function canRecordBrowserIdentity(flow: BrowserFlow): boolean {
  return flow.phase === "CheckingIdentity";
}

/** Story: Approve access in the browser after proving my phone / Only a successful challenge advances phone verification (spec/oauthBrowserAuthorization.md:68) */
//@ pure
export function recordBrowserIdentity(flow: BrowserFlow, identity: IdentityStatus): BrowserFlow {
  //@ ensures (inv(flow) && canRecordBrowserIdentity(flow)) ==> alwaysIssuanceNeedsExplicitConsent(\result)
  //@ ensures (inv(flow) && canRecordBrowserIdentity(flow)) ==> stepReadyFollowsAuthority(flow, "recordBrowserIdentity", \result)
  return { ...flow, phase: identity === "IdentityPermitted" ? "ShowingConsent" : (identity === "IdentityUnavailable" ? "SessionRetry" : "IdentityDenied") };
}

/** Story: Approve access in the browser after proving my phone / Explicit approval rechecks the owner and the app's required Cloud authority (spec/oauthBrowserAuthorization.md:88) */
//@ pure
export function sessionMatchesConsent(sessionRequired: boolean, samePerson: boolean, samePhone: boolean): boolean {
  return !sessionRequired || (samePerson && samePhone);
}

/** Story: Approve access in the browser after proving my phone / Explicit approval rechecks the owner and the app's required Cloud authority (spec/oauthBrowserAuthorization.md:88) */
//@ pure
export function canReadConsentOwner(flow: BrowserFlow): boolean {
  return flow.phase === "CheckingConsentOwner" && flow.explicitlyApproved;
}

/** Story: Approve access in the browser after proving my phone / Explicit approval rechecks the owner and the app's required Cloud authority (spec/oauthBrowserAuthorization.md:88) */
//@ pure
export function readConsentOwner(flow: BrowserFlow, verdict: ConsentCheck): BrowserFlow {
  //@ ensures (inv(flow) && canReadConsentOwner(flow)) ==> alwaysIssuanceNeedsExplicitConsent(\result)
  //@ ensures (inv(flow) && canReadConsentOwner(flow)) ==> stepReadyFollowsAuthority(flow, "readConsentOwner", \result)
  return { ...flow, phase: verdict === "CheckAccepted" ? "CheckingCloudGrant" : (verdict === "CheckUnavailable" ? "SessionRetry" : "OwnerChanged") };
}

/** Story: Approve access in the browser after proving my phone / Explicit approval rechecks the owner and the app's required Cloud authority (spec/oauthBrowserAuthorization.md:88) */
//@ pure
export function canReadConsentAuthority(flow: BrowserFlow): boolean {
  return flow.phase === "CheckingCloudGrant" && flow.explicitlyApproved;
}

/** Story: Approve access in the browser after proving my phone / Explicit approval rechecks the owner and the app's required Cloud authority (spec/oauthBrowserAuthorization.md:88) */
//@ pure
export function readConsentAuthority(flow: BrowserFlow, verdict: ConsentCheck): BrowserFlow {
  //@ ensures (inv(flow) && canReadConsentAuthority(flow)) ==> alwaysIssuanceNeedsExplicitConsent(\result)
  //@ ensures (inv(flow) && canReadConsentAuthority(flow)) ==> stepReadyFollowsAuthority(flow, "readConsentAuthority", \result)
  return { ...flow, phase: verdict === "CheckAccepted" ? "ConsentReady" : (verdict === "CheckUnavailable" ? "SessionRetry" : "CloudDenied") };
}

/** Story: Approve access in the browser after proving my phone / Explicit approval rechecks the owner and the app's required Cloud authority (spec/oauthBrowserAuthorization.md:88) */
//@ pure
export function alwaysIssuanceNeedsExplicitConsent(flow: BrowserFlow): boolean {
  return !(flow.phase === "CheckingConsentOwner" || flow.phase === "CheckingCloudGrant" || flow.phase === "ConsentReady") || flow.explicitlyApproved;
}

/** Story: Approve access in the browser after proving my phone / Explicit approval rechecks the owner and the app's required Cloud authority (spec/oauthBrowserAuthorization.md:88) */
//@ pure
export function stepReadyFollowsAuthority(before: BrowserFlow, via: string, after: BrowserFlow): boolean {
  return !(after.phase === "ConsentReady") || (before.phase === "CheckingCloudGrant" && via === "readConsentAuthority");
}

/** Story: Approve access in the browser after proving my phone / Explicit approval rechecks the owner and the app's required Cloud authority (spec/oauthBrowserAuthorization.md:88) */
//@ pure
export function sometimesReachesConsent(flow: BrowserFlow): boolean {
  return flow.phase === "ShowingConsent";
}

/** Story: Approve access in the browser after proving my phone / Explicit approval rechecks the owner and the app's required Cloud authority (spec/oauthBrowserAuthorization.md:88) */
//@ pure
export function sometimesApprovesConsent(flow: BrowserFlow): boolean {
  return flow.phase === "ConsentReady";
}

/** Story: Approve access in the browser after proving my phone / Explicit approval rechecks the owner and the app's required Cloud authority (spec/oauthBrowserAuthorization.md:88) */
//@ pure
export function sometimesDeclinesConsent(flow: BrowserFlow): boolean {
  return flow.phase === "ConsentDeclined";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: BrowserFlow, event: Event): boolean {
  if (event.type === "bindBrowser") return canBindBrowser(current);
  if (event.type === "readBrowserClient") return canReadBrowserClient(current);
  if (event.type === "chooseEntry") return canChooseEntry(current);
  if (event.type === "readBrowserForm") return canReadBrowserForm(current);
  if (event.type === "recordOtpSend") return canRecordOtpSend(current);
  if (event.type === "recordOtpVerification") return canRecordOtpVerification(current);
  if (event.type === "recordBrowserIdentity") return canRecordBrowserIdentity(current);
  if (event.type === "readConsentOwner") return canReadConsentOwner(current);
  if (event.type === "readConsentAuthority") return canReadConsentAuthority(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: BrowserFlow, event: Event): BrowserFlow {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "bindBrowser" && canBindBrowser(current)) return bindBrowser(current, event.matchesDigest);
  if (event.type === "readBrowserClient" && canReadBrowserClient(current)) return readBrowserClient(current, event.clientExists);
  if (event.type === "chooseEntry" && canChooseEntry(current)) return chooseEntry(current, event.session, event.cloudRequired);
  if (event.type === "readBrowserForm" && canReadBrowserForm(current)) return readBrowserForm(current, event.page, event.hasPhone, event.form, event.approve);
  if (event.type === "recordOtpSend" && canRecordOtpSend(current)) return recordOtpSend(current, event.sent);
  if (event.type === "recordOtpVerification" && canRecordOtpVerification(current)) return recordOtpVerification(current, event.verified);
  if (event.type === "recordBrowserIdentity" && canRecordBrowserIdentity(current)) return recordBrowserIdentity(current, event.identity);
  if (event.type === "readConsentOwner" && canReadConsentOwner(current)) return readConsentOwner(current, event.verdict);
  if (event.type === "readConsentAuthority" && canReadConsentAuthority(current)) return readConsentAuthority(current, event.verdict);
  return current;
}

/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseEvent(x: unknown): Event | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "bindBrowser" && typeof raw.matchesDigest === "boolean") return { type: "bindBrowser", matchesDigest: raw.matchesDigest };
  if (raw.type === "readBrowserClient" && typeof raw.clientExists === "boolean") return { type: "readBrowserClient", clientExists: raw.clientExists };
  if (raw.type === "chooseEntry" && (raw.session === "SignedIn" || raw.session === "SignedOut" || raw.session === "SessionUnavailable") && typeof raw.cloudRequired === "boolean") return { type: "chooseEntry", session: raw.session, cloudRequired: raw.cloudRequired };
  if (raw.type === "readBrowserForm" && (raw.page === "PhonePage" || raw.page === "CodePage" || raw.page === "ConsentPage") && typeof raw.hasPhone === "boolean" && (raw.form === "PhoneForm" || raw.form === "CodeForm" || raw.form === "ConsentForm" || raw.form === "CancelForm" || raw.form === "CloudReturn") && typeof raw.approve === "boolean") return { type: "readBrowserForm", page: raw.page, hasPhone: raw.hasPhone, form: raw.form, approve: raw.approve };
  if (raw.type === "recordOtpSend" && typeof raw.sent === "boolean") return { type: "recordOtpSend", sent: raw.sent };
  if (raw.type === "recordOtpVerification" && typeof raw.verified === "boolean") return { type: "recordOtpVerification", verified: raw.verified };
  if (raw.type === "recordBrowserIdentity" && (raw.identity === "IdentityPermitted" || raw.identity === "IdentityRejected" || raw.identity === "IdentityUnavailable")) return { type: "recordBrowserIdentity", identity: raw.identity };
  if (raw.type === "readConsentOwner" && (raw.verdict === "CheckAccepted" || raw.verdict === "CheckRejected" || raw.verdict === "CheckUnavailable")) return { type: "readConsentOwner", verdict: raw.verdict };
  if (raw.type === "readConsentAuthority" && (raw.verdict === "CheckAccepted" || raw.verdict === "CheckRejected" || raw.verdict === "CheckUnavailable")) return { type: "readConsentAuthority", verdict: raw.verdict };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): BrowserFlow | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "BrowserStarting" || raw.phase === "BrowserExpired" || raw.phase === "CheckingClient" || raw.phase === "BrowserBound" || raw.phase === "ShowingPhone" || raw.phase === "HandingOffToCloud" || raw.phase === "StartingOtp" || raw.phase === "ShowingCode" || raw.phase === "VerifyingOtp" || raw.phase === "RetryingOtp" || raw.phase === "CheckingIdentity" || raw.phase === "ShowingConsent" || raw.phase === "IdentityDenied" || raw.phase === "CheckingConsentOwner" || raw.phase === "CheckingCloudGrant" || raw.phase === "ConsentReady" || raw.phase === "ConsentDeclined" || raw.phase === "OwnerChanged" || raw.phase === "CloudDenied" || raw.phase === "SessionRetry" || raw.phase === "AlreadyVerified") && typeof raw.explicitlyApproved === "boolean" && Object.keys(raw).length === 2)) return undefined;
  const parsed: BrowserFlow = ({ phase: raw.phase, explicitlyApproved: raw.explicitlyApproved });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): BrowserFlow {
  //@ ensures inv(\result)
  return initial;
}
