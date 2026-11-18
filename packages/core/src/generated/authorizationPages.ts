// GENERATED from spec/authorizationPages.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: See one clear page at each step of connecting my assistant / The server reply selects the page view (spec/authorizationPages.md) */
export type Reply = "ReplyPhone" | "ReplyCode" | "ReplyConsent" | "ReplyConsentRetry" | "ReplyCloud" | "ReplyApproved" | "ReplyDeclined" | "ReplyCheckFailed" | "ReplyPhoneInvalid" | "ReplyTooManyCodes" | "ReplySendUnavailable" | "ReplyCodeRejected" | "ReplyLinkInvalid" | "ReplyTooManyTries" | "ReplyNotAvailable" | "ReplyExpired" | "ReplyAlreadySignedIn" | "ReplyCheckNumber" | "ReplyConnectAgain" | "ReplyRetryLater" | "ReplySignInUnavailable" | "ReplyNotAllowed";
/** Story: See one clear page at each step of connecting my assistant / The server reply selects the page view (spec/authorizationPages.md) */
export type AuthView = "Opening" | "PhoneView" | "CodeView" | "ConsentView" | "ConsentRetryView" | "CloudView" | "ApprovedView" | "DeclinedView" | "LinkInvalidView" | "TooManyTriesView" | "NotAvailableView" | "PageExpiredView" | "AlreadySignedInView" | "CheckNumberView" | "ConnectAgainView" | "PleaseRetryView" | "SignInUnavailableView" | "NotAllowedView";
/** Story: See one clear page at each step of connecting my assistant / The server reply selects the page view (spec/authorizationPages.md) */
export type FieldError = "NoFieldError" | "CheckNotPassed" | "PhoneNotValid" | "CodesRateLimited" | "CodeSendFailed" | "CodeNotAccepted";
/** Story: See one clear page at each step of connecting my assistant / The server reply selects the page view (spec/authorizationPages.md) */
export type SecurityCheck = "CheckOff" | "CheckWaiting" | "CheckSolved" | "CheckExpired";
/** Story: See one clear page at each step of connecting my assistant / The server reply selects the page view (spec/authorizationPages.md) */
export interface Offers { sendCode: boolean; continueCode: boolean; allow: boolean; retryAllow: boolean; dontAllow: boolean; cancel: boolean; retryLink: boolean }
/** Story: See one clear page at each step of connecting my assistant / The server reply selects the page view (spec/authorizationPages.md) */
export interface AuthPage { view: AuthView; fieldError: FieldError; securityCheck: SecurityCheck; turnstileOn: boolean; codeSent: boolean; consentSeen: boolean; approved: boolean }
/** Story: Decide what my assistant can do / The consent page names the client as its claim and lists every scope (spec/authorizationPages.md) */
export type ClientLabel = "ProvidedName" | "UnnamedAssistant" | "NoClientShown";
/** Story: Decide what my assistant can do / The consent page names the client as its claim and lists every scope (spec/authorizationPages.md) */
export interface ConsentParts { client: ClientLabel; claimNote: boolean; returnHost: boolean; scopeList: boolean; unavailableNotice: boolean }
/** Story: Decide what my assistant can do / A new person sees Finish signup as the main action on the consent page (spec/authorizationPages.md) */
export type ConsentPrimary = "PrimaryFinishSignup" | "PrimaryAllow" | "PrimaryTryAgain" | "NoConsentPrimary";
/** Story: Decide what my assistant can do / The signup form shows the draft that the person approved in the agent (spec/authorizationPages.md) */
export interface SignupDraftBinding { client: string; app: string; phone: string; used: boolean; expiresAt: number }
/** Story: Decide what my assistant can do / The signup form shows the draft that the person approved in the agent (spec/authorizationPages.md) */
export interface SignupPrefillRequest { client: string; app: string; phone: string; asOf: number; ageAllowed: boolean }
/** Story: Decide what my assistant can do / Each scope shows as one short sentence, never as its scope name (spec/authorizationPages.md) */
export type Scope = "AppsRead" | "MembershipRead" | "ProfileWrite" | "ProfileRead";
/** Story: Understand a page that stops the connection / Every page shows the brand mark and the legal links (spec/authorizationPages.md) */
export interface PageChrome { brandMark: boolean; legalLinks: boolean }

/** One variant per transition in the spec. */
export type Event =
  | { type: "openPage"; reply: Reply; turnstileOn: boolean }
  | { type: "returnFromCloud"; reply: Reply }
  | { type: "retryConnection"; reply: Reply }
  | { type: "solveCheck" }
  | { type: "expireCheck" }
  | { type: "submitPhone"; reply: Reply }
  | { type: "submitCode"; reply: Reply }
  | { type: "approve"; reply: Reply }
  | { type: "cancelRequest"; reply: Reply };

/** Story: See one clear page at each step of connecting my assistant / The server reply selects the page view (spec/authorizationPages.md) */
export const noOffers: Offers = { sendCode: false, continueCode: false, allow: false, retryAllow: false, dontAllow: false, cancel: false, retryLink: false };
/** Story: Decide what my assistant can do / Each scope shows as one short sentence, never as its scope name (spec/authorizationPages.md) */
export const defaultScopes: Scope[] = ["AppsRead", "MembershipRead", "ProfileWrite"];
/** Story: Decide what my assistant can do / Each scope shows as one short sentence, never as its scope name (spec/authorizationPages.md) */
export const scopes: Scope[] = ["AppsRead", "MembershipRead", "ProfileWrite", "ProfileRead"];
/** Story: See one clear page at each step of connecting my assistant / The server reply selects the page view (spec/authorizationPages.md) */
export const initial: AuthPage = { view: "Opening", fieldError: "NoFieldError", securityCheck: "CheckOff", turnstileOn: false, codeSent: false, consentSeen: false, approved: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: AuthPage): boolean {
  return alwaysSecurityCheckOnlyOnPhonePage(current) && alwaysFieldErrorStaysOnItsPage(current) && alwaysCodePageFollowsSentCode(current) && alwaysApprovalFollowsConsent(current) && alwaysConsentPageIsRecorded(current);
}

/** Story: See one clear page at each step of connecting my assistant / The server reply selects the page view (spec/authorizationPages.md) */
//@ pure
export function viewFor(reply: Reply): AuthView {
  return reply === "ReplyPhone" || reply === "ReplyCheckFailed" || reply === "ReplyPhoneInvalid" || reply === "ReplyTooManyCodes" || reply === "ReplySendUnavailable" ? "PhoneView" : (reply === "ReplyCode" || reply === "ReplyCodeRejected" ? "CodeView" : (reply === "ReplyConsent" ? "ConsentView" : (reply === "ReplyConsentRetry" ? "ConsentRetryView" : (reply === "ReplyCloud" ? "CloudView" : (reply === "ReplyApproved" ? "ApprovedView" : (reply === "ReplyDeclined" ? "DeclinedView" : (reply === "ReplyLinkInvalid" ? "LinkInvalidView" : (reply === "ReplyTooManyTries" ? "TooManyTriesView" : (reply === "ReplyNotAvailable" ? "NotAvailableView" : (reply === "ReplyExpired" ? "PageExpiredView" : (reply === "ReplyAlreadySignedIn" ? "AlreadySignedInView" : (reply === "ReplyCheckNumber" ? "CheckNumberView" : (reply === "ReplyConnectAgain" ? "ConnectAgainView" : (reply === "ReplyRetryLater" ? "PleaseRetryView" : (reply === "ReplySignInUnavailable" ? "SignInUnavailableView" : "NotAllowedView")))))))))))))));
}

/** Story: See one clear page at each step of connecting my assistant / The server reply selects the page view (spec/authorizationPages.md) */
//@ pure
export function errorFor(reply: Reply): FieldError {
  return reply === "ReplyCheckFailed" ? "CheckNotPassed" : (reply === "ReplyPhoneInvalid" ? "PhoneNotValid" : (reply === "ReplyTooManyCodes" ? "CodesRateLimited" : (reply === "ReplySendUnavailable" ? "CodeSendFailed" : (reply === "ReplyCodeRejected" ? "CodeNotAccepted" : "NoFieldError"))));
}

/** Story: See one clear page at each step of connecting my assistant / The server reply selects the page view (spec/authorizationPages.md) */
//@ pure
export function checkFor(view: AuthView, turnstileOn: boolean): SecurityCheck {
  return view === "PhoneView" && turnstileOn ? "CheckWaiting" : "CheckOff";
}

/** Story: See one clear page at each step of connecting my assistant / The server reply selects the page view (spec/authorizationPages.md) */
//@ pure
export function isConsentView(view: AuthView): boolean {
  return view === "ConsentView" || view === "ConsentRetryView";
}

/** Story: See one clear page at each step of connecting my assistant / The server reply selects the page view (spec/authorizationPages.md) */
//@ pure
export function isMessageView(view: AuthView): boolean {
  return view === "LinkInvalidView" || view === "TooManyTriesView" || view === "NotAvailableView" || view === "PageExpiredView" || view === "AlreadySignedInView" || view === "CheckNumberView" || view === "ConnectAgainView" || view === "PleaseRetryView" || view === "SignInUnavailableView" || view === "NotAllowedView";
}

/** Story: See one clear page at each step of connecting my assistant / The server reply selects the page view (spec/authorizationPages.md) */
//@ pure
export function rendersPage(view: AuthView): boolean {
  return !(view === "Opening" || view === "CloudView" || view === "ApprovedView" || view === "DeclinedView");
}

/** Story: See one clear page at each step of connecting my assistant / The server reply selects the page view (spec/authorizationPages.md) */
//@ pure
export function showsPhoneField(view: AuthView): boolean {
  return view === "PhoneView";
}

/** Story: See one clear page at each step of connecting my assistant / The server reply selects the page view (spec/authorizationPages.md) */
//@ pure
export function showsCodeField(view: AuthView): boolean {
  return view === "CodeView";
}

/** Story: See one clear page at each step of connecting my assistant / The server reply selects the page view (spec/authorizationPages.md) */
//@ pure
export function isFinal(view: AuthView): boolean {
  return view === "ApprovedView" || view === "DeclinedView" || (isMessageView(view) && view !== "PleaseRetryView");
}

/** Story: See one clear page at each step of connecting my assistant / The server reply selects the page view (spec/authorizationPages.md) */
//@ pure
export function offersFor(view: AuthView): Offers {
  return { sendCode: view === "PhoneView", continueCode: view === "CodeView", allow: view === "ConsentView", retryAllow: view === "ConsentRetryView", dontAllow: isConsentView(view), cancel: view === "PhoneView" || view === "CodeView", retryLink: view === "PleaseRetryView" };
}

/** Story: See one clear page at each step of connecting my assistant / The server reply selects the page view (spec/authorizationPages.md) */
//@ pure
export function showReply(reply: Reply, page: AuthPage): AuthPage {
  const local_0: AuthView = viewFor(reply);
  return { view: local_0, fieldError: errorFor(reply), securityCheck: checkFor(local_0, page.turnstileOn), turnstileOn: page.turnstileOn, codeSent: page.codeSent || reply === "ReplyCode", consentSeen: page.consentSeen || isConsentView(local_0), approved: page.approved || reply === "ReplyApproved" };
}

/** Story: See one clear page at each step of connecting my assistant / Opening the connection link shows sign-in, consent, Cloud sign-in or a message (spec/authorizationPages.md) */
//@ pure
export function isOpenReply(reply: Reply): boolean {
  return reply === "ReplyPhone" || reply === "ReplyConsent" || reply === "ReplyCloud" || reply === "ReplyRetryLater" || reply === "ReplyLinkInvalid" || reply === "ReplyTooManyTries" || reply === "ReplyNotAvailable" || reply === "ReplySignInUnavailable";
}

/** Story: See one clear page at each step of connecting my assistant / Opening the connection link shows sign-in, consent, Cloud sign-in or a message (spec/authorizationPages.md) */
//@ pure
export function canOpenPage(page: AuthPage, reply: Reply): boolean {
  return page.view === "Opening" && isOpenReply(reply);
}

/** Story: See one clear page at each step of connecting my assistant / Opening the connection link shows sign-in, consent, Cloud sign-in or a message (spec/authorizationPages.md) */
//@ pure
export function openPage(page: AuthPage, reply: Reply, turnstileOn: boolean): AuthPage {
  //@ ensures (inv(page) && canOpenPage(page, reply)) ==> alwaysSecurityCheckOnlyOnPhonePage(\result)
  //@ ensures (inv(page) && canOpenPage(page, reply)) ==> alwaysFieldErrorStaysOnItsPage(\result)
  //@ ensures (inv(page) && canOpenPage(page, reply)) ==> alwaysCodePageFollowsSentCode(\result)
  //@ ensures (inv(page) && canOpenPage(page, reply)) ==> alwaysApprovalFollowsConsent(\result)
  //@ ensures (inv(page) && canOpenPage(page, reply)) ==> alwaysConsentPageIsRecorded(\result)
  //@ ensures (inv(page) && canOpenPage(page, reply)) ==> stepPhoneSubmitNeedsSolvedCheck(page, "openPage", \result)
  //@ ensures (inv(page) && canOpenPage(page, reply)) ==> stepCodePageOnlyAfterPhoneSubmit(page, "openPage", \result)
  //@ ensures (inv(page) && canOpenPage(page, reply)) ==> stepApprovalOnlyByAllow(page, "openPage", \result)
  //@ ensures (inv(page) && canOpenPage(page, reply)) ==> stepConsentNeedsKnownPerson(page, "openPage", \result)
  //@ ensures (inv(page) && canOpenPage(page, reply)) ==> stepFinalViewsStay(page, \result)
  return showReply(reply, ({ ...page, turnstileOn: turnstileOn } as AuthPage));
}

/** Story: See one clear page at each step of connecting my assistant / The return from Cloud sign-in and the retry link resume the same request (spec/authorizationPages.md) */
//@ pure
export function isCloudReturnReply(reply: Reply): boolean {
  return reply === "ReplyConsent" || reply === "ReplyRetryLater" || reply === "ReplyExpired" || reply === "ReplyLinkInvalid" || reply === "ReplyConnectAgain";
}

/** Story: See one clear page at each step of connecting my assistant / The return from Cloud sign-in and the retry link resume the same request (spec/authorizationPages.md) */
//@ pure
export function canReturnFromCloud(page: AuthPage, reply: Reply): boolean {
  return page.view === "CloudView" && isCloudReturnReply(reply);
}

/** Story: See one clear page at each step of connecting my assistant / The return from Cloud sign-in and the retry link resume the same request (spec/authorizationPages.md) */
//@ pure
export function canRetryConnection(page: AuthPage, reply: Reply): boolean {
  return page.view === "PleaseRetryView" && (isOpenReply(reply) || isCloudReturnReply(reply));
}

/** Story: See one clear page at each step of connecting my assistant / The return from Cloud sign-in and the retry link resume the same request (spec/authorizationPages.md) */
//@ pure
export function returnFromCloud(page: AuthPage, reply: Reply): AuthPage {
  //@ ensures (inv(page) && canReturnFromCloud(page, reply)) ==> alwaysSecurityCheckOnlyOnPhonePage(\result)
  //@ ensures (inv(page) && canReturnFromCloud(page, reply)) ==> alwaysFieldErrorStaysOnItsPage(\result)
  //@ ensures (inv(page) && canReturnFromCloud(page, reply)) ==> alwaysCodePageFollowsSentCode(\result)
  //@ ensures (inv(page) && canReturnFromCloud(page, reply)) ==> alwaysApprovalFollowsConsent(\result)
  //@ ensures (inv(page) && canReturnFromCloud(page, reply)) ==> alwaysConsentPageIsRecorded(\result)
  //@ ensures (inv(page) && canReturnFromCloud(page, reply)) ==> stepPhoneSubmitNeedsSolvedCheck(page, "returnFromCloud", \result)
  //@ ensures (inv(page) && canReturnFromCloud(page, reply)) ==> stepCodePageOnlyAfterPhoneSubmit(page, "returnFromCloud", \result)
  //@ ensures (inv(page) && canReturnFromCloud(page, reply)) ==> stepApprovalOnlyByAllow(page, "returnFromCloud", \result)
  //@ ensures (inv(page) && canReturnFromCloud(page, reply)) ==> stepConsentNeedsKnownPerson(page, "returnFromCloud", \result)
  //@ ensures (inv(page) && canReturnFromCloud(page, reply)) ==> stepFinalViewsStay(page, \result)
  return showReply(reply, page);
}

/** Story: See one clear page at each step of connecting my assistant / The return from Cloud sign-in and the retry link resume the same request (spec/authorizationPages.md) */
//@ pure
export function retryConnection(page: AuthPage, reply: Reply): AuthPage {
  //@ ensures (inv(page) && canRetryConnection(page, reply)) ==> alwaysSecurityCheckOnlyOnPhonePage(\result)
  //@ ensures (inv(page) && canRetryConnection(page, reply)) ==> alwaysFieldErrorStaysOnItsPage(\result)
  //@ ensures (inv(page) && canRetryConnection(page, reply)) ==> alwaysCodePageFollowsSentCode(\result)
  //@ ensures (inv(page) && canRetryConnection(page, reply)) ==> alwaysApprovalFollowsConsent(\result)
  //@ ensures (inv(page) && canRetryConnection(page, reply)) ==> alwaysConsentPageIsRecorded(\result)
  //@ ensures (inv(page) && canRetryConnection(page, reply)) ==> stepPhoneSubmitNeedsSolvedCheck(page, "retryConnection", \result)
  //@ ensures (inv(page) && canRetryConnection(page, reply)) ==> stepCodePageOnlyAfterPhoneSubmit(page, "retryConnection", \result)
  //@ ensures (inv(page) && canRetryConnection(page, reply)) ==> stepApprovalOnlyByAllow(page, "retryConnection", \result)
  //@ ensures (inv(page) && canRetryConnection(page, reply)) ==> stepConsentNeedsKnownPerson(page, "retryConnection", \result)
  //@ ensures (inv(page) && canRetryConnection(page, reply)) ==> stepFinalViewsStay(page, \result)
  return showReply(reply, page);
}

/** Story: Prove my phone on this page / The phone page shows a security check only when the site has one (spec/authorizationPages.md) */
//@ pure
export function canSolveCheck(page: AuthPage): boolean {
  return page.view === "PhoneView" && (page.securityCheck === "CheckWaiting" || page.securityCheck === "CheckExpired");
}

/** Story: Prove my phone on this page / The phone page shows a security check only when the site has one (spec/authorizationPages.md) */
//@ pure
export function solveCheck(page: AuthPage): AuthPage {
  //@ ensures (inv(page) && canSolveCheck(page)) ==> alwaysSecurityCheckOnlyOnPhonePage(\result)
  //@ ensures (inv(page) && canSolveCheck(page)) ==> alwaysFieldErrorStaysOnItsPage(\result)
  //@ ensures (inv(page) && canSolveCheck(page)) ==> alwaysCodePageFollowsSentCode(\result)
  //@ ensures (inv(page) && canSolveCheck(page)) ==> alwaysApprovalFollowsConsent(\result)
  //@ ensures (inv(page) && canSolveCheck(page)) ==> alwaysConsentPageIsRecorded(\result)
  //@ ensures (inv(page) && canSolveCheck(page)) ==> stepPhoneSubmitNeedsSolvedCheck(page, "solveCheck", \result)
  //@ ensures (inv(page) && canSolveCheck(page)) ==> stepCodePageOnlyAfterPhoneSubmit(page, "solveCheck", \result)
  //@ ensures (inv(page) && canSolveCheck(page)) ==> stepApprovalOnlyByAllow(page, "solveCheck", \result)
  //@ ensures (inv(page) && canSolveCheck(page)) ==> stepConsentNeedsKnownPerson(page, "solveCheck", \result)
  //@ ensures (inv(page) && canSolveCheck(page)) ==> stepFinalViewsStay(page, \result)
  return { ...page, securityCheck: "CheckSolved" };
}

/** Story: Prove my phone on this page / The phone page shows a security check only when the site has one (spec/authorizationPages.md) */
//@ pure
export function canExpireCheck(page: AuthPage): boolean {
  return page.view === "PhoneView" && page.securityCheck === "CheckSolved";
}

/** Story: Prove my phone on this page / The phone page shows a security check only when the site has one (spec/authorizationPages.md) */
//@ pure
export function expireCheck(page: AuthPage): AuthPage {
  //@ ensures (inv(page) && canExpireCheck(page)) ==> alwaysSecurityCheckOnlyOnPhonePage(\result)
  //@ ensures (inv(page) && canExpireCheck(page)) ==> alwaysFieldErrorStaysOnItsPage(\result)
  //@ ensures (inv(page) && canExpireCheck(page)) ==> alwaysCodePageFollowsSentCode(\result)
  //@ ensures (inv(page) && canExpireCheck(page)) ==> alwaysApprovalFollowsConsent(\result)
  //@ ensures (inv(page) && canExpireCheck(page)) ==> alwaysConsentPageIsRecorded(\result)
  //@ ensures (inv(page) && canExpireCheck(page)) ==> stepPhoneSubmitNeedsSolvedCheck(page, "expireCheck", \result)
  //@ ensures (inv(page) && canExpireCheck(page)) ==> stepCodePageOnlyAfterPhoneSubmit(page, "expireCheck", \result)
  //@ ensures (inv(page) && canExpireCheck(page)) ==> stepApprovalOnlyByAllow(page, "expireCheck", \result)
  //@ ensures (inv(page) && canExpireCheck(page)) ==> stepConsentNeedsKnownPerson(page, "expireCheck", \result)
  //@ ensures (inv(page) && canExpireCheck(page)) ==> stepFinalViewsStay(page, \result)
  return { ...page, securityCheck: "CheckExpired" };
}

/** Story: Prove my phone on this page / The phone page shows a security check only when the site has one (spec/authorizationPages.md) */
//@ pure
export function alwaysSecurityCheckOnlyOnPhonePage(page: AuthPage): boolean {
  return (page.securityCheck !== "CheckOff") === (page.view === "PhoneView" && page.turnstileOn);
}

/** Story: Prove my phone on this page / The phone page sends a code or tells why it did not (spec/authorizationPages.md) */
//@ pure
export function alwaysFieldErrorStaysOnItsPage(page: AuthPage): boolean {
  return (!(page.fieldError === "CodeNotAccepted") || page.view === "CodeView") && (!(page.fieldError === "CheckNotPassed" || page.fieldError === "PhoneNotValid" || page.fieldError === "CodesRateLimited" || page.fieldError === "CodeSendFailed") || page.view === "PhoneView") && (!(page.fieldError === "CheckNotPassed") || page.turnstileOn);
}

/** Story: Prove my phone on this page / The phone page sends a code or tells why it did not (spec/authorizationPages.md) */
//@ pure
export function isPhoneReply(reply: Reply): boolean {
  return reply === "ReplyCode" || reply === "ReplyCheckFailed" || reply === "ReplyPhoneInvalid" || reply === "ReplyTooManyCodes" || reply === "ReplySendUnavailable" || reply === "ReplyExpired" || reply === "ReplyAlreadySignedIn" || reply === "ReplyNotAllowed" || reply === "ReplyNotAvailable";
}

/** Story: Prove my phone on this page / The phone page sends a code or tells why it did not (spec/authorizationPages.md) */
//@ pure
export function stepPhoneSubmitNeedsSolvedCheck(before: AuthPage, via: string, after: AuthPage): boolean {
  return !(via === "submitPhone") || (before.securityCheck === "CheckOff" || before.securityCheck === "CheckSolved");
}

/** Story: Prove my phone on this page / The phone page sends a code or tells why it did not (spec/authorizationPages.md) */
//@ pure
export function canSubmitPhone(page: AuthPage, reply: Reply): boolean {
  return page.view === "PhoneView" && (page.securityCheck === "CheckOff" || page.securityCheck === "CheckSolved") && isPhoneReply(reply) && (!(reply === "ReplyCheckFailed") || page.turnstileOn);
}

/** Story: Prove my phone on this page / The phone page sends a code or tells why it did not (spec/authorizationPages.md) */
//@ pure
export function submitPhone(page: AuthPage, reply: Reply): AuthPage {
  //@ ensures (inv(page) && canSubmitPhone(page, reply)) ==> alwaysSecurityCheckOnlyOnPhonePage(\result)
  //@ ensures (inv(page) && canSubmitPhone(page, reply)) ==> alwaysFieldErrorStaysOnItsPage(\result)
  //@ ensures (inv(page) && canSubmitPhone(page, reply)) ==> alwaysCodePageFollowsSentCode(\result)
  //@ ensures (inv(page) && canSubmitPhone(page, reply)) ==> alwaysApprovalFollowsConsent(\result)
  //@ ensures (inv(page) && canSubmitPhone(page, reply)) ==> alwaysConsentPageIsRecorded(\result)
  //@ ensures (inv(page) && canSubmitPhone(page, reply)) ==> stepPhoneSubmitNeedsSolvedCheck(page, "submitPhone", \result)
  //@ ensures (inv(page) && canSubmitPhone(page, reply)) ==> stepCodePageOnlyAfterPhoneSubmit(page, "submitPhone", \result)
  //@ ensures (inv(page) && canSubmitPhone(page, reply)) ==> stepApprovalOnlyByAllow(page, "submitPhone", \result)
  //@ ensures (inv(page) && canSubmitPhone(page, reply)) ==> stepConsentNeedsKnownPerson(page, "submitPhone", \result)
  //@ ensures (inv(page) && canSubmitPhone(page, reply)) ==> stepFinalViewsStay(page, \result)
  return showReply(reply, page);
}

/** Story: Prove my phone on this page / The code page appears only after this request sent a code (spec/authorizationPages.md) */
//@ pure
export function isCodeReply(reply: Reply): boolean {
  return reply === "ReplyConsent" || reply === "ReplyCodeRejected" || reply === "ReplyCheckNumber" || reply === "ReplyExpired" || reply === "ReplyNotAllowed" || reply === "ReplyNotAvailable";
}

/** Story: Prove my phone on this page / The code page appears only after this request sent a code (spec/authorizationPages.md) */
//@ pure
export function stepCodePageOnlyAfterPhoneSubmit(before: AuthPage, via: string, after: AuthPage): boolean {
  return !(after.view === "CodeView" && before.view !== "CodeView") || (via === "submitPhone" && before.view === "PhoneView");
}

/** Story: Prove my phone on this page / The code page appears only after this request sent a code (spec/authorizationPages.md) */
//@ pure
export function canSubmitCode(page: AuthPage, reply: Reply): boolean {
  return page.view === "CodeView" && page.codeSent && isCodeReply(reply);
}

/** Story: Prove my phone on this page / The code page appears only after this request sent a code (spec/authorizationPages.md) */
//@ pure
export function alwaysCodePageFollowsSentCode(page: AuthPage): boolean {
  return !showsCodeField(page.view) || page.codeSent;
}

/** Story: Prove my phone on this page / The code page appears only after this request sent a code (spec/authorizationPages.md) */
//@ pure
export function submitCode(page: AuthPage, reply: Reply): AuthPage {
  //@ ensures (inv(page) && canSubmitCode(page, reply)) ==> alwaysSecurityCheckOnlyOnPhonePage(\result)
  //@ ensures (inv(page) && canSubmitCode(page, reply)) ==> alwaysFieldErrorStaysOnItsPage(\result)
  //@ ensures (inv(page) && canSubmitCode(page, reply)) ==> alwaysCodePageFollowsSentCode(\result)
  //@ ensures (inv(page) && canSubmitCode(page, reply)) ==> alwaysApprovalFollowsConsent(\result)
  //@ ensures (inv(page) && canSubmitCode(page, reply)) ==> alwaysConsentPageIsRecorded(\result)
  //@ ensures (inv(page) && canSubmitCode(page, reply)) ==> stepPhoneSubmitNeedsSolvedCheck(page, "submitCode", \result)
  //@ ensures (inv(page) && canSubmitCode(page, reply)) ==> stepCodePageOnlyAfterPhoneSubmit(page, "submitCode", \result)
  //@ ensures (inv(page) && canSubmitCode(page, reply)) ==> stepApprovalOnlyByAllow(page, "submitCode", \result)
  //@ ensures (inv(page) && canSubmitCode(page, reply)) ==> stepConsentNeedsKnownPerson(page, "submitCode", \result)
  //@ ensures (inv(page) && canSubmitCode(page, reply)) ==> stepFinalViewsStay(page, \result)
  return showReply(reply, page);
}

/** Story: Decide what my assistant can do / The consent page names the client as its claim and lists every scope (spec/authorizationPages.md) */
//@ pure
export function consentParts(view: AuthView, clientNamed: boolean): ConsentParts {
  return isConsentView(view) ? ({ client: clientNamed ? "ProvidedName" : "UnnamedAssistant", claimNote: true, returnHost: true, scopeList: true, unavailableNotice: view === "ConsentRetryView" } as ConsentParts) : ({ client: "NoClientShown", claimNote: false, returnHost: false, scopeList: false, unavailableNotice: false } as ConsentParts);
}

/** Story: Decide what my assistant can do / The consent page names the client as its claim and lists every scope (spec/authorizationPages.md) */
//@ pure
export function lawOnlyConsentPagesNameAClient(view: AuthView, clientNamed: boolean): boolean {
  //@ ensures \result === true
  return !(!isConsentView(view)) || consentParts(view, clientNamed).client === "NoClientShown";
}

/** Story: Decide what my assistant can do / The consent page names the client as its claim and lists every scope (spec/authorizationPages.md) */
//@ pure
export function lawConsentNamesClientAndScopes(view: AuthView, clientNamed: boolean): boolean {
  //@ ensures \result === true
  const local_1: ConsentParts = consentParts(view, clientNamed);
  return !isConsentView(view) || (local_1.client !== "NoClientShown" && local_1.claimNote && local_1.returnHost && local_1.scopeList);
}

/** Story: Decide what my assistant can do / A verified person can choose a separate signup step during connector authorization (spec/authorizationPages.md) */
//@ pure
export function offersSignupConfirmation(view: AuthView, signupAvailable: boolean): boolean {
  return view === "ConsentView" && signupAvailable;
}

/** Story: Decide what my assistant can do / A verified person can choose a separate signup step during connector authorization (spec/authorizationPages.md) */
//@ pure
export function showsSignupConfirmation(view: AuthView, signupSaved: boolean): boolean {
  return view === "ConsentView" && signupSaved;
}

/** Story: Decide what my assistant can do / A verified person can choose a separate signup step during connector authorization (spec/authorizationPages.md) */
//@ pure
export function lawConsentRetryHasNoSignup(signupAvailable: boolean): boolean {
  //@ ensures \result === true
  return !offersSignupConfirmation("ConsentRetryView", signupAvailable);
}

/** Story: Decide what my assistant can do / A verified person can choose a separate signup step during connector authorization (spec/authorizationPages.md) */
//@ pure
export function lawSignupNoticeRequiresSave(view: AuthView): boolean {
  //@ ensures \result === true
  return !showsSignupConfirmation(view, false);
}

/** Story: Decide what my assistant can do / A new person sees Finish signup as the main action on the consent page (spec/authorizationPages.md) */
//@ pure
export function consentPrimaryAction(view: AuthView, signupAvailable: boolean): ConsentPrimary {
  return offersSignupConfirmation(view, signupAvailable) ? "PrimaryFinishSignup" : (view === "ConsentView" ? "PrimaryAllow" : (view === "ConsentRetryView" ? "PrimaryTryAgain" : "NoConsentPrimary"));
}

/** Story: Decide what my assistant can do / A new person sees Finish signup as the main action on the consent page (spec/authorizationPages.md) */
//@ pure
export function lawNewPersonSeesFinishSignupFirst(view: AuthView, signupAvailable: boolean): boolean {
  //@ ensures \result === true
  return !offersSignupConfirmation(view, signupAvailable) || consentPrimaryAction(view, signupAvailable) === "PrimaryFinishSignup";
}

/** Story: Decide what my assistant can do / A new person sees Finish signup as the main action on the consent page (spec/authorizationPages.md) */
//@ pure
export function lawMemberConsentKeepsAllowFirst(view: AuthView): boolean {
  //@ ensures \result === true
  return !(view === "ConsentView") || consentPrimaryAction(view, false) === "PrimaryAllow";
}

/** Story: Decide what my assistant can do / A new person sees Finish signup as the main action on the consent page (spec/authorizationPages.md) */
//@ pure
export function lawRetryConsentKeepsTryAgainFirst(signupAvailable: boolean): boolean {
  //@ ensures \result === true
  return consentPrimaryAction("ConsentRetryView", signupAvailable) === "PrimaryTryAgain";
}

/** Story: Decide what my assistant can do / A new person sees Finish signup as the main action on the consent page (spec/authorizationPages.md) */
//@ pure
export function lawOnlyConsentPagesHaveAPrimaryAction(view: AuthView, signupAvailable: boolean): boolean {
  //@ ensures \result === true
  return !(!isConsentView(view)) || consentPrimaryAction(view, signupAvailable) === "NoConsentPrimary";
}

/** Story: Decide what my assistant can do / The signup form shows the draft that the person approved in the agent (spec/authorizationPages.md) */
//@ pure
export function signupConsentStartsTicked(prefilled: boolean): boolean {
  return false;
}

/** Story: Decide what my assistant can do / The signup form shows the draft that the person approved in the agent (spec/authorizationPages.md) */
//@ pure
export function signupPrefillAllowed(d: SignupDraftBinding, r: SignupPrefillRequest): boolean {
  return !d.used && d.client === r.client && d.app === r.app && d.phone === r.phone && r.asOf < d.expiresAt && r.ageAllowed;
}

/** Story: Decide what my assistant can do / The signup form shows the draft that the person approved in the agent (spec/authorizationPages.md) */
//@ pure
export function lawConsentNeverPreTicked(prefilled: boolean): boolean {
  //@ ensures \result === true
  return !signupConsentStartsTicked(prefilled);
}

/** Story: Decide what my assistant can do / The signup form shows the draft that the person approved in the agent (spec/authorizationPages.md) */
//@ pure
export function useSignupPrefill(d: SignupDraftBinding, r: SignupPrefillRequest): SignupDraftBinding {
  return signupPrefillAllowed(d, r) ? ({ ...d, used: true } as SignupDraftBinding) : d;
}

/** Story: Decide what my assistant can do / The signup form shows the draft that the person approved in the agent (spec/authorizationPages.md) */
//@ pure
export function lawPrefillOnlyForItsClientAppAndPhone(d: SignupDraftBinding, r: SignupPrefillRequest): boolean {
  //@ ensures \result === true
  return !signupPrefillAllowed(d, r) || (d.client === r.client && d.app === r.app && d.phone === r.phone);
}

/** Story: Decide what my assistant can do / The signup form shows the draft that the person approved in the agent (spec/authorizationPages.md) */
//@ pure
export function lawExpiredPrefillIsEmpty(d: SignupDraftBinding, r: SignupPrefillRequest): boolean {
  //@ ensures \result === true
  return !(r.asOf >= d.expiresAt) || !signupPrefillAllowed(d, r);
}

/** Story: Decide what my assistant can do / The signup form shows the draft that the person approved in the agent (spec/authorizationPages.md) */
//@ pure
export function lawAgeGuardRefusesPrefill(d: SignupDraftBinding, r: SignupPrefillRequest): boolean {
  //@ ensures \result === true
  return !(!r.ageAllowed) || !signupPrefillAllowed(d, r);
}

/** Story: Decide what my assistant can do / The signup form shows the draft that the person approved in the agent (spec/authorizationPages.md) */
//@ pure
export function lawPrefillAtMostOnce(d: SignupDraftBinding, r: SignupPrefillRequest, later: SignupPrefillRequest): boolean {
  //@ ensures \result === true
  return !signupPrefillAllowed(d, r) || !signupPrefillAllowed(useSignupPrefill(d, r), later);
}

/** Story: Decide what my assistant can do / Each scope shows as one short sentence, never as its scope name (spec/authorizationPages.md) */
//@ pure
export function scopeName(scope: Scope): string {
  return scope === "AppsRead" ? "apps:read" : (scope === "MembershipRead" ? "membership:read" : (scope === "ProfileRead" ? "profile:read" : "profile:write"));
}

/** Story: Decide what my assistant can do / Each scope shows as one short sentence, never as its scope name (spec/authorizationPages.md) */
//@ pure
export function scopeText(scope: Scope): string {
  return scope === "AppsRead" ? "See which Network apps are available" : (scope === "MembershipRead" ? "Read your membership status and new updates" : (scope === "ProfileRead" ? "Read the profile you saved for this app" : "Save your profile and prepare signup details"));
}

/** Story: Decide what my assistant can do / Each scope shows as one short sentence, never as its scope name (spec/authorizationPages.md) */
//@ pure
export function lawScopeTextIsNotTheScopeName(scope: Scope): boolean {
  //@ ensures \result === true
  return scopeText(scope) !== scopeName(scope);
}

/** Story: Decide what my assistant can do / Only Allow on a consent page returns a code to the assistant (spec/authorizationPages.md) */
//@ pure
export function isApproveReply(reply: Reply): boolean {
  return reply === "ReplyApproved" || reply === "ReplyConsentRetry" || reply === "ReplyConnectAgain" || reply === "ReplyExpired" || reply === "ReplyNotAllowed" || reply === "ReplyNotAvailable";
}

/** Story: Decide what my assistant can do / Only Allow on a consent page returns a code to the assistant (spec/authorizationPages.md) */
//@ pure
export function alwaysApprovalFollowsConsent(page: AuthPage): boolean {
  return page.approved === (page.view === "ApprovedView") && (!page.approved || page.consentSeen);
}

/** Story: Decide what my assistant can do / Only Allow on a consent page returns a code to the assistant (spec/authorizationPages.md) */
//@ pure
export function canApprove(page: AuthPage, reply: Reply): boolean {
  return isConsentView(page.view) && isApproveReply(reply);
}

/** Story: Decide what my assistant can do / Only Allow on a consent page returns a code to the assistant (spec/authorizationPages.md) */
//@ pure
export function alwaysConsentPageIsRecorded(page: AuthPage): boolean {
  return !isConsentView(page.view) || page.consentSeen;
}

/** Story: Decide what my assistant can do / Only Allow on a consent page returns a code to the assistant (spec/authorizationPages.md) */
//@ pure
export function stepApprovalOnlyByAllow(before: AuthPage, via: string, after: AuthPage): boolean {
  return !(after.view === "ApprovedView" && before.view !== "ApprovedView") || (via === "approve" && isConsentView(before.view));
}

/** Story: Decide what my assistant can do / Only Allow on a consent page returns a code to the assistant (spec/authorizationPages.md) */
//@ pure
export function stepConsentNeedsKnownPerson(before: AuthPage, via: string, after: AuthPage): boolean {
  return !(isConsentView(after.view) && !isConsentView(before.view)) || ((via === "openPage" && before.view === "Opening") || (via === "returnFromCloud" && before.view === "CloudView") || (via === "retryConnection" && before.view === "PleaseRetryView") || (via === "submitCode" && before.view === "CodeView"));
}

/** Story: Decide what my assistant can do / Only Allow on a consent page returns a code to the assistant (spec/authorizationPages.md) */
//@ pure
export function approve(page: AuthPage, reply: Reply): AuthPage {
  //@ ensures (inv(page) && canApprove(page, reply)) ==> alwaysSecurityCheckOnlyOnPhonePage(\result)
  //@ ensures (inv(page) && canApprove(page, reply)) ==> alwaysFieldErrorStaysOnItsPage(\result)
  //@ ensures (inv(page) && canApprove(page, reply)) ==> alwaysCodePageFollowsSentCode(\result)
  //@ ensures (inv(page) && canApprove(page, reply)) ==> alwaysApprovalFollowsConsent(\result)
  //@ ensures (inv(page) && canApprove(page, reply)) ==> alwaysConsentPageIsRecorded(\result)
  //@ ensures (inv(page) && canApprove(page, reply)) ==> stepPhoneSubmitNeedsSolvedCheck(page, "approve", \result)
  //@ ensures (inv(page) && canApprove(page, reply)) ==> stepCodePageOnlyAfterPhoneSubmit(page, "approve", \result)
  //@ ensures (inv(page) && canApprove(page, reply)) ==> stepApprovalOnlyByAllow(page, "approve", \result)
  //@ ensures (inv(page) && canApprove(page, reply)) ==> stepConsentNeedsKnownPerson(page, "approve", \result)
  //@ ensures (inv(page) && canApprove(page, reply)) ==> stepFinalViewsStay(page, \result)
  return showReply(reply, page);
}

/** Story: Decide what my assistant can do / Cancel or Don't allow returns to the assistant with a refusal (spec/authorizationPages.md) */
//@ pure
export function isCancelReply(reply: Reply): boolean {
  return reply === "ReplyDeclined" || reply === "ReplyExpired" || reply === "ReplyNotAllowed" || reply === "ReplyNotAvailable";
}

/** Story: Decide what my assistant can do / Cancel or Don't allow returns to the assistant with a refusal (spec/authorizationPages.md) */
//@ pure
export function canCancelRequest(page: AuthPage, reply: Reply): boolean {
  return (offersFor(page.view).cancel || offersFor(page.view).dontAllow) && isCancelReply(reply);
}

/** Story: Decide what my assistant can do / Cancel or Don't allow returns to the assistant with a refusal (spec/authorizationPages.md) */
//@ pure
export function cancelRequest(page: AuthPage, reply: Reply): AuthPage {
  //@ ensures (inv(page) && canCancelRequest(page, reply)) ==> alwaysSecurityCheckOnlyOnPhonePage(\result)
  //@ ensures (inv(page) && canCancelRequest(page, reply)) ==> alwaysFieldErrorStaysOnItsPage(\result)
  //@ ensures (inv(page) && canCancelRequest(page, reply)) ==> alwaysCodePageFollowsSentCode(\result)
  //@ ensures (inv(page) && canCancelRequest(page, reply)) ==> alwaysApprovalFollowsConsent(\result)
  //@ ensures (inv(page) && canCancelRequest(page, reply)) ==> alwaysConsentPageIsRecorded(\result)
  //@ ensures (inv(page) && canCancelRequest(page, reply)) ==> stepPhoneSubmitNeedsSolvedCheck(page, "cancelRequest", \result)
  //@ ensures (inv(page) && canCancelRequest(page, reply)) ==> stepCodePageOnlyAfterPhoneSubmit(page, "cancelRequest", \result)
  //@ ensures (inv(page) && canCancelRequest(page, reply)) ==> stepApprovalOnlyByAllow(page, "cancelRequest", \result)
  //@ ensures (inv(page) && canCancelRequest(page, reply)) ==> stepConsentNeedsKnownPerson(page, "cancelRequest", \result)
  //@ ensures (inv(page) && canCancelRequest(page, reply)) ==> stepFinalViewsStay(page, \result)
  return showReply(reply, page);
}

/** Story: Understand a page that stops the connection / A message page shows no credential field and at most a retry link (spec/authorizationPages.md) */
//@ pure
export function lawMessagePagesShowNoCredentialField(view: AuthView): boolean {
  //@ ensures \result === true
  return !isMessageView(view) || (!showsPhoneField(view) && !showsCodeField(view) && equal_authorizationPages(offersFor(view), ({ ...noOffers, retryLink: view === "PleaseRetryView" } as Offers)));
}

/** Story: Understand a page that stops the connection / A message page shows no credential field and at most a retry link (spec/authorizationPages.md) */
//@ pure
export function stepFinalViewsStay(before: AuthPage, after: AuthPage): boolean {
  return !isFinal(before.view) || after.view === before.view;
}

/** Story: Understand a page that stops the connection / Every page shows the brand mark and the legal links (spec/authorizationPages.md) */
//@ pure
export function chromeFor(view: AuthView): PageChrome {
  return { brandMark: rendersPage(view), legalLinks: rendersPage(view) };
}

/** Story: Understand a page that stops the connection / Every page shows the brand mark and the legal links (spec/authorizationPages.md) */
//@ pure
export function lawEveryPageShowsBrandAndLegalLinks(view: AuthView): boolean {
  //@ ensures \result === true
  return !rendersPage(view) || (chromeFor(view).brandMark && chromeFor(view).legalLinks);
}

/** Story: Understand a page that stops the connection / Each page and each outcome can occur (spec/authorizationPages.md) */
//@ pure
export function sometimesApproved(page: AuthPage): boolean {
  return page.view === "ApprovedView";
}

/** Story: Understand a page that stops the connection / Each page and each outcome can occur (spec/authorizationPages.md) */
//@ pure
export function sometimesDeclined(page: AuthPage): boolean {
  return page.view === "DeclinedView";
}

/** Story: Understand a page that stops the connection / Each page and each outcome can occur (spec/authorizationPages.md) */
//@ pure
export function sometimesConsentRetry(page: AuthPage): boolean {
  return page.view === "ConsentRetryView";
}

/** Story: Understand a page that stops the connection / Each page and each outcome can occur (spec/authorizationPages.md) */
//@ pure
export function sometimesCloudSignIn(page: AuthPage): boolean {
  return page.view === "CloudView";
}

/** Story: Understand a page that stops the connection / Each page and each outcome can occur (spec/authorizationPages.md) */
//@ pure
export function sometimesCodeRejected(page: AuthPage): boolean {
  return page.view === "CodeView" && page.fieldError === "CodeNotAccepted";
}

/** Story: Understand a page that stops the connection / Each page and each outcome can occur (spec/authorizationPages.md) */
//@ pure
export function sometimesCheckRejected(page: AuthPage): boolean {
  return page.view === "PhoneView" && page.fieldError === "CheckNotPassed";
}

/** Story: Understand a page that stops the connection / Each page and each outcome can occur (spec/authorizationPages.md) */
//@ pure
export function sometimesCheckExpired(page: AuthPage): boolean {
  return page.securityCheck === "CheckExpired";
}

/** Story: Understand a page that stops the connection / Each page and each outcome can occur (spec/authorizationPages.md) */
//@ pure
export function sometimesTooManyCodes(page: AuthPage): boolean {
  return page.fieldError === "CodesRateLimited";
}

/** Story: Understand a page that stops the connection / Each page and each outcome can occur (spec/authorizationPages.md) */
//@ pure
export function sometimesPhoneRejected(page: AuthPage): boolean {
  return page.fieldError === "PhoneNotValid";
}

/** Story: Understand a page that stops the connection / Each page and each outcome can occur (spec/authorizationPages.md) */
//@ pure
export function sometimesSendFailed(page: AuthPage): boolean {
  return page.fieldError === "CodeSendFailed";
}

/** Story: Understand a page that stops the connection / Each page and each outcome can occur (spec/authorizationPages.md) */
//@ pure
export function sometimesConsentAfterCode(page: AuthPage): boolean {
  return page.view === "ConsentView" && page.codeSent;
}

/** Story: Understand a page that stops the connection / Each page and each outcome can occur (spec/authorizationPages.md) */
//@ pure
export function sometimesLinkInvalid(page: AuthPage): boolean {
  return page.view === "LinkInvalidView";
}

/** Story: Understand a page that stops the connection / Each page and each outcome can occur (spec/authorizationPages.md) */
//@ pure
export function sometimesTooManyTries(page: AuthPage): boolean {
  return page.view === "TooManyTriesView";
}

/** Story: Understand a page that stops the connection / Each page and each outcome can occur (spec/authorizationPages.md) */
//@ pure
export function sometimesNotAvailable(page: AuthPage): boolean {
  return page.view === "NotAvailableView";
}

/** Story: Understand a page that stops the connection / Each page and each outcome can occur (spec/authorizationPages.md) */
//@ pure
export function sometimesPageExpired(page: AuthPage): boolean {
  return page.view === "PageExpiredView";
}

/** Story: Understand a page that stops the connection / Each page and each outcome can occur (spec/authorizationPages.md) */
//@ pure
export function sometimesAlreadySignedIn(page: AuthPage): boolean {
  return page.view === "AlreadySignedInView";
}

/** Story: Understand a page that stops the connection / Each page and each outcome can occur (spec/authorizationPages.md) */
//@ pure
export function sometimesCheckNumber(page: AuthPage): boolean {
  return page.view === "CheckNumberView";
}

/** Story: Understand a page that stops the connection / Each page and each outcome can occur (spec/authorizationPages.md) */
//@ pure
export function sometimesConnectAgain(page: AuthPage): boolean {
  return page.view === "ConnectAgainView";
}

/** Story: Understand a page that stops the connection / Each page and each outcome can occur (spec/authorizationPages.md) */
//@ pure
export function sometimesPleaseRetry(page: AuthPage): boolean {
  return page.view === "PleaseRetryView";
}

/** Story: Understand a page that stops the connection / Each page and each outcome can occur (spec/authorizationPages.md) */
//@ pure
export function sometimesSignInUnavailable(page: AuthPage): boolean {
  return page.view === "SignInUnavailableView";
}

/** Story: Understand a page that stops the connection / Each page and each outcome can occur (spec/authorizationPages.md) */
//@ pure
export function sometimesNotAllowed(page: AuthPage): boolean {
  return page.view === "NotAllowedView";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: AuthPage, event: Event): boolean {
  if (event.type === "openPage") return canOpenPage(current, event.reply);
  if (event.type === "returnFromCloud") return canReturnFromCloud(current, event.reply);
  if (event.type === "retryConnection") return canRetryConnection(current, event.reply);
  if (event.type === "solveCheck") return canSolveCheck(current);
  if (event.type === "expireCheck") return canExpireCheck(current);
  if (event.type === "submitPhone") return canSubmitPhone(current, event.reply);
  if (event.type === "submitCode") return canSubmitCode(current, event.reply);
  if (event.type === "approve") return canApprove(current, event.reply);
  if (event.type === "cancelRequest") return canCancelRequest(current, event.reply);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: AuthPage, event: Event): AuthPage {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "openPage") return canOpenPage(current, event.reply) ? openPage(current, event.reply, event.turnstileOn) : current;
  if (event.type === "returnFromCloud") return canReturnFromCloud(current, event.reply) ? returnFromCloud(current, event.reply) : current;
  if (event.type === "retryConnection") return canRetryConnection(current, event.reply) ? retryConnection(current, event.reply) : current;
  if (event.type === "solveCheck") return canSolveCheck(current) ? solveCheck(current) : current;
  if (event.type === "expireCheck") return canExpireCheck(current) ? expireCheck(current) : current;
  if (event.type === "submitPhone") return canSubmitPhone(current, event.reply) ? submitPhone(current, event.reply) : current;
  if (event.type === "submitCode") return canSubmitCode(current, event.reply) ? submitCode(current, event.reply) : current;
  if (event.type === "approve") return canApprove(current, event.reply) ? approve(current, event.reply) : current;
  if (event.type === "cancelRequest") return canCancelRequest(current, event.reply) ? cancelRequest(current, event.reply) : current;
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
  if (raw.type === "openPage" && (raw.reply === "ReplyPhone" || raw.reply === "ReplyCode" || raw.reply === "ReplyConsent" || raw.reply === "ReplyConsentRetry" || raw.reply === "ReplyCloud" || raw.reply === "ReplyApproved" || raw.reply === "ReplyDeclined" || raw.reply === "ReplyCheckFailed" || raw.reply === "ReplyPhoneInvalid" || raw.reply === "ReplyTooManyCodes" || raw.reply === "ReplySendUnavailable" || raw.reply === "ReplyCodeRejected" || raw.reply === "ReplyLinkInvalid" || raw.reply === "ReplyTooManyTries" || raw.reply === "ReplyNotAvailable" || raw.reply === "ReplyExpired" || raw.reply === "ReplyAlreadySignedIn" || raw.reply === "ReplyCheckNumber" || raw.reply === "ReplyConnectAgain" || raw.reply === "ReplyRetryLater" || raw.reply === "ReplySignInUnavailable" || raw.reply === "ReplyNotAllowed") && typeof raw.turnstileOn === "boolean") return { type: "openPage", reply: raw.reply, turnstileOn: raw.turnstileOn };
  if (raw.type === "returnFromCloud" && (raw.reply === "ReplyPhone" || raw.reply === "ReplyCode" || raw.reply === "ReplyConsent" || raw.reply === "ReplyConsentRetry" || raw.reply === "ReplyCloud" || raw.reply === "ReplyApproved" || raw.reply === "ReplyDeclined" || raw.reply === "ReplyCheckFailed" || raw.reply === "ReplyPhoneInvalid" || raw.reply === "ReplyTooManyCodes" || raw.reply === "ReplySendUnavailable" || raw.reply === "ReplyCodeRejected" || raw.reply === "ReplyLinkInvalid" || raw.reply === "ReplyTooManyTries" || raw.reply === "ReplyNotAvailable" || raw.reply === "ReplyExpired" || raw.reply === "ReplyAlreadySignedIn" || raw.reply === "ReplyCheckNumber" || raw.reply === "ReplyConnectAgain" || raw.reply === "ReplyRetryLater" || raw.reply === "ReplySignInUnavailable" || raw.reply === "ReplyNotAllowed")) return { type: "returnFromCloud", reply: raw.reply };
  if (raw.type === "retryConnection" && (raw.reply === "ReplyPhone" || raw.reply === "ReplyCode" || raw.reply === "ReplyConsent" || raw.reply === "ReplyConsentRetry" || raw.reply === "ReplyCloud" || raw.reply === "ReplyApproved" || raw.reply === "ReplyDeclined" || raw.reply === "ReplyCheckFailed" || raw.reply === "ReplyPhoneInvalid" || raw.reply === "ReplyTooManyCodes" || raw.reply === "ReplySendUnavailable" || raw.reply === "ReplyCodeRejected" || raw.reply === "ReplyLinkInvalid" || raw.reply === "ReplyTooManyTries" || raw.reply === "ReplyNotAvailable" || raw.reply === "ReplyExpired" || raw.reply === "ReplyAlreadySignedIn" || raw.reply === "ReplyCheckNumber" || raw.reply === "ReplyConnectAgain" || raw.reply === "ReplyRetryLater" || raw.reply === "ReplySignInUnavailable" || raw.reply === "ReplyNotAllowed")) return { type: "retryConnection", reply: raw.reply };
  if (raw.type === "solveCheck") return { type: "solveCheck" };
  if (raw.type === "expireCheck") return { type: "expireCheck" };
  if (raw.type === "submitPhone" && (raw.reply === "ReplyPhone" || raw.reply === "ReplyCode" || raw.reply === "ReplyConsent" || raw.reply === "ReplyConsentRetry" || raw.reply === "ReplyCloud" || raw.reply === "ReplyApproved" || raw.reply === "ReplyDeclined" || raw.reply === "ReplyCheckFailed" || raw.reply === "ReplyPhoneInvalid" || raw.reply === "ReplyTooManyCodes" || raw.reply === "ReplySendUnavailable" || raw.reply === "ReplyCodeRejected" || raw.reply === "ReplyLinkInvalid" || raw.reply === "ReplyTooManyTries" || raw.reply === "ReplyNotAvailable" || raw.reply === "ReplyExpired" || raw.reply === "ReplyAlreadySignedIn" || raw.reply === "ReplyCheckNumber" || raw.reply === "ReplyConnectAgain" || raw.reply === "ReplyRetryLater" || raw.reply === "ReplySignInUnavailable" || raw.reply === "ReplyNotAllowed")) return { type: "submitPhone", reply: raw.reply };
  if (raw.type === "submitCode" && (raw.reply === "ReplyPhone" || raw.reply === "ReplyCode" || raw.reply === "ReplyConsent" || raw.reply === "ReplyConsentRetry" || raw.reply === "ReplyCloud" || raw.reply === "ReplyApproved" || raw.reply === "ReplyDeclined" || raw.reply === "ReplyCheckFailed" || raw.reply === "ReplyPhoneInvalid" || raw.reply === "ReplyTooManyCodes" || raw.reply === "ReplySendUnavailable" || raw.reply === "ReplyCodeRejected" || raw.reply === "ReplyLinkInvalid" || raw.reply === "ReplyTooManyTries" || raw.reply === "ReplyNotAvailable" || raw.reply === "ReplyExpired" || raw.reply === "ReplyAlreadySignedIn" || raw.reply === "ReplyCheckNumber" || raw.reply === "ReplyConnectAgain" || raw.reply === "ReplyRetryLater" || raw.reply === "ReplySignInUnavailable" || raw.reply === "ReplyNotAllowed")) return { type: "submitCode", reply: raw.reply };
  if (raw.type === "approve" && (raw.reply === "ReplyPhone" || raw.reply === "ReplyCode" || raw.reply === "ReplyConsent" || raw.reply === "ReplyConsentRetry" || raw.reply === "ReplyCloud" || raw.reply === "ReplyApproved" || raw.reply === "ReplyDeclined" || raw.reply === "ReplyCheckFailed" || raw.reply === "ReplyPhoneInvalid" || raw.reply === "ReplyTooManyCodes" || raw.reply === "ReplySendUnavailable" || raw.reply === "ReplyCodeRejected" || raw.reply === "ReplyLinkInvalid" || raw.reply === "ReplyTooManyTries" || raw.reply === "ReplyNotAvailable" || raw.reply === "ReplyExpired" || raw.reply === "ReplyAlreadySignedIn" || raw.reply === "ReplyCheckNumber" || raw.reply === "ReplyConnectAgain" || raw.reply === "ReplyRetryLater" || raw.reply === "ReplySignInUnavailable" || raw.reply === "ReplyNotAllowed")) return { type: "approve", reply: raw.reply };
  if (raw.type === "cancelRequest" && (raw.reply === "ReplyPhone" || raw.reply === "ReplyCode" || raw.reply === "ReplyConsent" || raw.reply === "ReplyConsentRetry" || raw.reply === "ReplyCloud" || raw.reply === "ReplyApproved" || raw.reply === "ReplyDeclined" || raw.reply === "ReplyCheckFailed" || raw.reply === "ReplyPhoneInvalid" || raw.reply === "ReplyTooManyCodes" || raw.reply === "ReplySendUnavailable" || raw.reply === "ReplyCodeRejected" || raw.reply === "ReplyLinkInvalid" || raw.reply === "ReplyTooManyTries" || raw.reply === "ReplyNotAvailable" || raw.reply === "ReplyExpired" || raw.reply === "ReplyAlreadySignedIn" || raw.reply === "ReplyCheckNumber" || raw.reply === "ReplyConnectAgain" || raw.reply === "ReplyRetryLater" || raw.reply === "ReplySignInUnavailable" || raw.reply === "ReplyNotAllowed")) return { type: "cancelRequest", reply: raw.reply };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): AuthPage | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.view === "Opening" || raw.view === "PhoneView" || raw.view === "CodeView" || raw.view === "ConsentView" || raw.view === "ConsentRetryView" || raw.view === "CloudView" || raw.view === "ApprovedView" || raw.view === "DeclinedView" || raw.view === "LinkInvalidView" || raw.view === "TooManyTriesView" || raw.view === "NotAvailableView" || raw.view === "PageExpiredView" || raw.view === "AlreadySignedInView" || raw.view === "CheckNumberView" || raw.view === "ConnectAgainView" || raw.view === "PleaseRetryView" || raw.view === "SignInUnavailableView" || raw.view === "NotAllowedView") && (raw.fieldError === "NoFieldError" || raw.fieldError === "CheckNotPassed" || raw.fieldError === "PhoneNotValid" || raw.fieldError === "CodesRateLimited" || raw.fieldError === "CodeSendFailed" || raw.fieldError === "CodeNotAccepted") && (raw.securityCheck === "CheckOff" || raw.securityCheck === "CheckWaiting" || raw.securityCheck === "CheckSolved" || raw.securityCheck === "CheckExpired") && typeof raw.turnstileOn === "boolean" && typeof raw.codeSent === "boolean" && typeof raw.consentSeen === "boolean" && typeof raw.approved === "boolean" && Object.keys(raw).length === 7)) return undefined;
  const parsed: AuthPage = ({ view: raw.view, fieldError: raw.fieldError, securityCheck: raw.securityCheck, turnstileOn: raw.turnstileOn, codeSent: raw.codeSent, consentSeen: raw.consentSeen, approved: raw.approved });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): AuthPage {
  //@ ensures inv(\result)
  return initial;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_authorizationPages(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_authorizationPages((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
