// GENERATED from spec/oneStepPage.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type JoinMode as brandIdentity_JoinMode, type AccentTokens as brandIdentity_AccentTokens, type Accent as brandIdentity_Accent, type Surface as brandIdentity_Surface, type AppKey as brandIdentity_AppKey, type LogoMark as brandIdentity_LogoMark, type SharedPart as brandIdentity_SharedPart, type Brand as brandIdentity_Brand, supportEmail as brandIdentity_supportEmail, agentAccessPage as brandIdentity_agentAccessPage, joinModes as brandIdentity_joinModes, accents as brandIdentity_accents, logoMarks as brandIdentity_logoMarks, ntwrkBrand as brandIdentity_ntwrkBrand, slopBrand as brandIdentity_slopBrand, peonBrand as brandIdentity_peonBrand, friendsBrand as brandIdentity_friendsBrand, accentTokens as brandIdentity_accentTokens, connectorEndpoint as brandIdentity_connectorEndpoint, openaiConnectorEndpoint as brandIdentity_openaiConnectorEndpoint, mayName as brandIdentity_mayName, siteUsesPart as brandIdentity_siteUsesPart, appKeys as brandIdentity_appKeys, brandFor as brandIdentity_brandFor, hubTextsOnAppSurface as brandIdentity_hubTextsOnAppSurface, lawAppEndpointsAreDistinct as brandIdentity_lawAppEndpointsAreDistinct, lawAppSiteNeverNamesTheNetwork as brandIdentity_lawAppSiteNeverNamesTheNetwork, lawAppSiteNamesNoOtherApp as brandIdentity_lawAppSiteNamesNoOtherApp, lawHubLandingNamesNoApp as brandIdentity_lawHubLandingNamesNoApp, lawSitesShareParts as brandIdentity_lawSitesShareParts, lawBrandNamesItsApp as brandIdentity_lawBrandNamesItsApp, lawOnlyTheNetworkIsInviteOnly as brandIdentity_lawOnlyTheNetworkIsInviteOnly, lawAccentInkDiffersFromAccent as brandIdentity_lawAccentInkDiffersFromAccent, lawOnlyTheSkillNamesTheEndpoint as brandIdentity_lawOnlyTheSkillNamesTheEndpoint, partTokens as brandIdentity_partTokens, lawBrandsAreDistinct as brandIdentity_lawBrandsAreDistinct, lawPartsTakeTheBrandTokens as brandIdentity_lawPartsTakeTheBrandTokens } from "./brandIdentity.ts";

/** Story: Do one step from a link / Each step page is on the sites that can do the step (spec/oneStepPage.md) */
export type OneStepKind = "StepPhone" | "StepHomeHelp" | "StepPhotoUpload" | "StepPhotoCheck" | "StepPhotoMine" | "StepPhotoView";
/** Story: Do one step from a link / A step page shows one shared notice above the step (spec/oneStepPage.md) */
export type StepNotice = "NoStepNotice" | "StepUnreachable" | "StepSessionEnded" | "StepSignInAgain" | "StepSignInExpired" | "StepSignInRefused" | "StepSignInUnavailable";
/** Story: Do one step from a link / A step page shows one shared notice above the step (spec/oneStepPage.md) */
export type StepSession = "SessionSignedIn" | "SessionSignedOut" | "SessionUnreadable";
/** Story: Do one step from a link / A Cloud sign-in that fails comes back to the page with one error (spec/oneStepPage.md) */
export type CloudReturn = "CloudReturnNone" | "CloudReturnExpired" | "CloudReturnRefused" | "CloudReturnUnavailable";
/** Story: Sign in on the step page / The page asks the server which sign-in to use and uses text codes when it cannot tell (spec/oneStepPage.md) */
export type SignInAuth = "SignInModePending" | "SignInOtp" | "SignInCloud";
/** Story: Sign in on the step page / The page asks the server which sign-in to use and uses text codes when it cannot tell (spec/oneStepPage.md) */
export type SignInStage = "SignInNumber" | "SignInCode" | "SignInVerified" | "SignInLeftForCloud";
/** Story: Sign in on the step page / The page asks the server which sign-in to use and uses text codes when it cannot tell (spec/oneStepPage.md) */
export type SignInPending = "SignInIdle" | "SignInStarting" | "SignInVerifying" | "SignInResending" | "SignInOpeningCloud";
/** Story: Sign in on the step page / The page asks the server which sign-in to use and uses text codes when it cannot tell (spec/oneStepPage.md) */
export type SignInCheck = "NoCheck" | "CheckRunning" | "CheckPassed" | "CheckBroken";
/** Story: Sign in on the step page / The page asks the server which sign-in to use and uses text codes when it cannot tell (spec/oneStepPage.md) */
export type SignInError = "SignInNoError" | "SignInInvalidPhone" | "SignInCheckPending" | "SignInCheckFailed" | "SignInCheckRejected" | "SignInCheckAgain" | "SignInRateLimited" | "SignInCodeFormat" | "SignInWrongCode" | "SignInNewCodeSent" | "SignInCloudUnavailable" | "SignInRequestFailed";
/** Story: Sign in on the step page / The page asks the server which sign-in to use and uses text codes when it cannot tell (spec/oneStepPage.md) */
export type SignInLookup = "SignInLookupFailed" | "SignInLookupOtp" | "SignInLookupCloud";
/** Story: Sign in on the step page / The page asks the server which sign-in to use and uses text codes when it cannot tell (spec/oneStepPage.md) */
export type SignInAnswer = "SignInAnswerOk" | "SignInAnswerRateLimited" | "SignInAnswerCheckRejected" | "SignInAnswerWrongCode" | "SignInAnswerFailed";
/** Story: Sign in on the step page / The page asks the server which sign-in to use and uses text codes when it cannot tell (spec/oneStepPage.md) */
export type SignInAttemptKind = "AttemptReadMode" | "AttemptSubmitNumber" | "AttemptAnswerStart" | "AttemptSubmitCode" | "AttemptAnswerVerify" | "AttemptResend" | "AttemptAnswerResend" | "AttemptChangeNumber" | "AttemptContinueCloud" | "AttemptAnswerCloud" | "AttemptSettleCheck" | "AttemptExpireCheck";
/** Story: Sign in on the step page / The page asks the server which sign-in to use and uses text codes when it cannot tell (spec/oneStepPage.md) */
export interface StepSignIn { auth: SignInAuth; stage: SignInStage; pending: SignInPending; check: SignInCheck; checkOn: boolean; error: SignInError; retryKnown: boolean }
/** Story: Sign in on the step page / The page asks the server which sign-in to use and uses text codes when it cannot tell (spec/oneStepPage.md) */
export interface SignInAttempt { kind: SignInAttemptKind; lookup: SignInLookup; checkOn: boolean; valid: boolean; digits: number; answer: SignInAnswer; retryKnown: boolean; passed: boolean }

/** Story: Sign in on the step page / The page asks the server which sign-in to use and uses text codes when it cannot tell (spec/oneStepPage.md) */
export const signInStart: StepSignIn = { auth: "SignInModePending", stage: "SignInNumber", pending: "SignInIdle", check: "NoCheck", checkOn: false, error: "SignInNoError", retryKnown: false };
/** Story: Sign in on the step page / The page asks the server which sign-in to use and uses text codes when it cannot tell (spec/oneStepPage.md) */
export const signInAttemptNone: SignInAttempt = { kind: "AttemptReadMode", lookup: "SignInLookupFailed", checkOn: false, valid: false, digits: 0, answer: "SignInAnswerFailed", retryKnown: false, passed: false };

/** Story: Do one step from a link / Each step page is on the sites that can do the step (spec/oneStepPage.md) */
//@ pure
export function oneStepIsPhoto(kind: OneStepKind): boolean {
  return kind === "StepPhotoUpload" || kind === "StepPhotoCheck" || kind === "StepPhotoMine" || kind === "StepPhotoView";
}

/** Story: Do one step from a link / Each step page is on the sites that can do the step (spec/oneStepPage.md) */
//@ pure
export function oneStepOnSite(kind: OneStepKind, app: brandIdentity_AppKey): boolean {
  return kind === "StepHomeHelp" ? app === "Ntwrk" : (oneStepIsPhoto(kind) ? app === "Slop" : true);
}

/** Story: Do one step from a link / Each step page is on the sites that can do the step (spec/oneStepPage.md) */
//@ pure
export function lawPhotoStepsOnlyOnSlop(kind: OneStepKind, app: brandIdentity_AppKey): boolean {
  //@ ensures \result === true
  return !oneStepIsPhoto(kind) || oneStepOnSite(kind, app) === (app === "Slop");
}

/** Story: Do one step from a link / Each step page is on the sites that can do the step (spec/oneStepPage.md) */
//@ pure
export function lawHomeHelpOnlyOnHub(app: brandIdentity_AppKey): boolean {
  //@ ensures \result === true
  return oneStepOnSite("StepHomeHelp", app) === (app === "Ntwrk");
}

/** Story: Do one step from a link / Each step page is on the sites that can do the step (spec/oneStepPage.md) */
//@ pure
export function lawPhoneChangeOnEverySite(app: brandIdentity_AppKey): boolean {
  //@ ensures \result === true
  return oneStepOnSite("StepPhone", app);
}

/** Story: Do one step from a link / Each step page is on the sites that can do the step (spec/oneStepPage.md) */
//@ pure
export function lawPhotoUploadOnlyOnSlop(app: brandIdentity_AppKey): boolean {
  //@ ensures \result === true
  return oneStepOnSite("StepPhotoUpload", app) === (app === "Slop");
}

/** Story: Do one step from a link / The link stays in the fragment, and only the home-help link is kept across Cloud sign-in (spec/oneStepPage.md) */
//@ pure
export function oneStepLinkInFragment(kind: OneStepKind): boolean {
  return kind !== "StepPhone";
}

/** Story: Do one step from a link / The link stays in the fragment, and only the home-help link is kept across Cloud sign-in (spec/oneStepPage.md) */
//@ pure
export function oneStepLinkMayBeKept(kind: OneStepKind): boolean {
  return kind === "StepHomeHelp";
}

/** Story: Do one step from a link / The link stays in the fragment, and only the home-help link is kept across Cloud sign-in (spec/oneStepPage.md) */
//@ pure
export function oneStepNeedsSignIn(kind: OneStepKind): boolean {
  return !oneStepIsPhoto(kind);
}

/** Story: Do one step from a link / The link stays in the fragment, and only the home-help link is kept across Cloud sign-in (spec/oneStepPage.md) */
//@ pure
export function lawKeptLinkIsInTheFragment(kind: OneStepKind): boolean {
  //@ ensures \result === true
  return !oneStepLinkMayBeKept(kind) || oneStepLinkInFragment(kind);
}

/** Story: Do one step from a link / The link stays in the fragment, and only the home-help link is kept across Cloud sign-in (spec/oneStepPage.md) */
//@ pure
export function lawPhotoTokenIsNeverKept(kind: OneStepKind): boolean {
  //@ ensures \result === true
  return !oneStepLinkMayBeKept(kind) || oneStepNeedsSignIn(kind);
}

/** Story: Do one step from a link / A step page shows one shared notice above the step (spec/oneStepPage.md) */
//@ pure
export function oneStepNoticeShown(notice: StepNotice): boolean {
  return notice !== "NoStepNotice";
}

/** Story: Do one step from a link / A step page shows one shared notice above the step (spec/oneStepPage.md) */
//@ pure
export function noticeForSession(session: StepSession): StepNotice {
  return session === "SessionUnreadable" ? "StepUnreachable" : (session === "SessionSignedOut" ? "StepSessionEnded" : "NoStepNotice");
}

/** Story: Do one step from a link / A step page shows one shared notice above the step (spec/oneStepPage.md) */
//@ pure
export function lawSignedInHasNoNotice(session: StepSession): boolean {
  //@ ensures \result === true
  return (session === "SessionSignedIn") === !oneStepNoticeShown(noticeForSession(session));
}

/** Story: Do one step from a link / A Cloud sign-in that fails comes back to the page with one error (spec/oneStepPage.md) */
//@ pure
export function noticeForCloudReturn(cloudReturn: CloudReturn): StepNotice {
  return cloudReturn === "CloudReturnExpired" ? "StepSignInExpired" : (cloudReturn === "CloudReturnRefused" ? "StepSignInRefused" : (cloudReturn === "CloudReturnUnavailable" ? "StepSignInUnavailable" : "NoStepNotice"));
}

/** Story: Do one step from a link / A Cloud sign-in that fails comes back to the page with one error (spec/oneStepPage.md) */
//@ pure
export function noticeOnOpen(session: StepSession, cloudReturn: CloudReturn): StepNotice {
  return session === "SessionSignedIn" ? "NoStepNotice" : (session === "SessionUnreadable" ? "StepUnreachable" : noticeForCloudReturn(cloudReturn));
}

/** Story: Do one step from a link / A Cloud sign-in that fails comes back to the page with one error (spec/oneStepPage.md) */
//@ pure
export function lawEveryCloudErrorShowsANotice(cloudReturn: CloudReturn): boolean {
  //@ ensures \result === true
  return (cloudReturn !== "CloudReturnNone") === oneStepNoticeShown(noticeForCloudReturn(cloudReturn));
}

/** Story: Do one step from a link / A Cloud sign-in that fails comes back to the page with one error (spec/oneStepPage.md) */
//@ pure
export function lawSessionHidesTheCloudError(cloudReturn: CloudReturn): boolean {
  //@ ensures \result === true
  return noticeOnOpen("SessionSignedIn", cloudReturn) === "NoStepNotice";
}

/** Story: Do one step from a link / A refused request says when to try again (spec/oneStepPage.md) */
//@ pure
export function retryMinutesShown(seconds: number): number {
  return seconds <= 60 ? 1 : quotient_oneStepPage(exact_oneStepPage(seconds + 59), 60);
}

/** Story: Do one step from a link / A refused request says when to try again (spec/oneStepPage.md) */
//@ pure
export function lawRetryIsAtLeastOneMinute(seconds: number): boolean {
  //@ ensures \result === true
  return retryMinutesShown(seconds) >= 1;
}

/** Story: Do one step from a link / A refused request says when to try again (spec/oneStepPage.md) */
//@ pure
export function lawRetryIsNeverShorterThanTheWait(seconds: number): boolean {
  //@ ensures \result === true
  return exact_oneStepPage(retryMinutesShown(seconds) * 60) >= seconds;
}

/** Story: Sign in on the step page / The page asks the server which sign-in to use and uses text codes when it cannot tell (spec/oneStepPage.md) */
//@ pure
export function signInAuthFor(lookup: SignInLookup): SignInAuth {
  return lookup === "SignInLookupCloud" ? "SignInCloud" : "SignInOtp";
}

/** Story: Sign in on the step page / The page asks the server which sign-in to use and uses text codes when it cannot tell (spec/oneStepPage.md) */
//@ pure
export function signInCheckFor(auth: SignInAuth, checkOn: boolean): SignInCheck {
  return auth === "SignInOtp" && checkOn ? "CheckRunning" : "NoCheck";
}

/** Story: Sign in on the step page / The page asks the server which sign-in to use and uses text codes when it cannot tell (spec/oneStepPage.md) */
//@ pure
export function signInShowsNumberForm(s: StepSignIn): boolean {
  return s.stage === "SignInNumber" && s.auth === "SignInOtp";
}

/** Story: Sign in on the step page / The page asks the server which sign-in to use and uses text codes when it cannot tell (spec/oneStepPage.md) */
//@ pure
export function signInShowsCloudButton(s: StepSignIn): boolean {
  return s.stage === "SignInNumber" && s.auth === "SignInCloud";
}

/** Story: Sign in on the step page / The page asks the server which sign-in to use and uses text codes when it cannot tell (spec/oneStepPage.md) */
//@ pure
export function signInWaiting(s: StepSignIn): boolean {
  return s.auth === "SignInModePending" || s.stage === "SignInVerified" || s.stage === "SignInLeftForCloud";
}

/** Story: Sign in on the step page / The page asks the server which sign-in to use and uses text codes when it cannot tell (spec/oneStepPage.md) */
//@ pure
export function lawOnlyCloudLookupUsesCloud(lookup: SignInLookup): boolean {
  //@ ensures \result === true
  return (signInAuthFor(lookup) === "SignInCloud") === (lookup === "SignInLookupCloud");
}

/** Story: Sign in on the step page / The page asks the server which sign-in to use and uses text codes when it cannot tell (spec/oneStepPage.md) */
//@ pure
export function lawCheckOnlyWithTextCodes(auth: SignInAuth, checkOn: boolean): boolean {
  //@ ensures \result === true
  return !(signInCheckFor(auth, checkOn) !== "NoCheck") || (auth === "SignInOtp" && checkOn);
}

/** Story: Sign in on the step page / Each sign-in event is allowed only in the stage that offers it (spec/oneStepPage.md) */
//@ pure
export function signInAttemptAllowed(s: StepSignIn, attempt: SignInAttempt): boolean {
  return attempt.kind === "AttemptReadMode" ? s.auth === "SignInModePending" : (attempt.kind === "AttemptSubmitNumber" ? s.stage === "SignInNumber" && s.auth === "SignInOtp" && s.pending === "SignInIdle" : (attempt.kind === "AttemptAnswerStart" ? s.pending === "SignInStarting" : (attempt.kind === "AttemptSubmitCode" || attempt.kind === "AttemptResend" || attempt.kind === "AttemptChangeNumber" ? s.stage === "SignInCode" && s.pending === "SignInIdle" : (attempt.kind === "AttemptAnswerVerify" ? s.pending === "SignInVerifying" : (attempt.kind === "AttemptAnswerResend" ? s.pending === "SignInResending" : (attempt.kind === "AttemptContinueCloud" ? s.stage === "SignInNumber" && s.auth === "SignInCloud" && s.pending === "SignInIdle" : (attempt.kind === "AttemptAnswerCloud" ? s.pending === "SignInOpeningCloud" : (attempt.kind === "AttemptSettleCheck" ? s.check === "CheckRunning" : s.check === "CheckPassed"))))))));
}

/** Story: Sign in on the step page / Each sign-in event is allowed only in the stage that offers it (spec/oneStepPage.md) */
//@ pure
export function signInBusy(s: StepSignIn): boolean {
  return s.pending !== "SignInIdle";
}

/** Story: Sign in on the step page / The sign-in moves as the browser join sign-in does (spec/oneStepPage.md) */
//@ pure
export function signInCodeAccepted(digits: number): boolean {
  return digits >= 4 && digits <= 8;
}

/** Story: Sign in on the step page / The sign-in moves as the browser join sign-in does (spec/oneStepPage.md) */
//@ pure
export function signInSpent(check: SignInCheck): SignInCheck {
  return check === "NoCheck" ? "NoCheck" : "CheckRunning";
}

/** Story: Sign in on the step page / The sign-in moves as the browser join sign-in does (spec/oneStepPage.md) */
//@ pure
export function signInStartError(answer: SignInAnswer): SignInError {
  return answer === "SignInAnswerRateLimited" ? "SignInRateLimited" : (answer === "SignInAnswerCheckRejected" ? "SignInCheckRejected" : "SignInRequestFailed");
}

/** Story: Sign in on the step page / The sign-in moves as the browser join sign-in does (spec/oneStepPage.md) */
//@ pure
export function lawCodeNeedsFourToEightDigits(digits: number): boolean {
  //@ ensures \result === true
  return !(digits < 4 || digits > 8) || !signInCodeAccepted(digits);
}

/** Story: Sign in on the step page / The sign-in moves as the browser join sign-in does (spec/oneStepPage.md) */
//@ pure
export function signInSettledError(stage: SignInStage, error: SignInError, passed: boolean): SignInError {
  const local_0 = error === "SignInCheckPending" || error === "SignInCheckFailed";
  return stage !== "SignInNumber" ? error : (!passed && (error === "SignInNoError" || local_0) ? "SignInCheckFailed" : (passed && local_0 ? "SignInNoError" : error));
}

/** Story: Sign in on the step page / The sign-in moves as the browser join sign-in does (spec/oneStepPage.md) */
//@ pure
export function signInMove(s: StepSignIn, attempt: SignInAttempt): StepSignIn {
  const local_1: StepSignIn = { ...s, pending: "SignInIdle" };
  const local_2: SignInAuth = signInAuthFor(attempt.lookup);
  const local_3: SignInCheck = signInSpent(s.check);
  const local_4: SignInError = signInStartError(attempt.answer);
  const local_5 = local_4 === "SignInRateLimited" && attempt.retryKnown;
  const local_6: SignInError = signInSettledError(s.stage, s.error, attempt.passed);
  return attempt.kind === "AttemptReadMode" ? ({ ...s, auth: local_2, checkOn: attempt.checkOn, check: signInCheckFor(local_2, attempt.checkOn) } as StepSignIn) : (attempt.kind === "AttemptSubmitNumber" ? (!attempt.valid ? ({ ...s, error: "SignInInvalidPhone", retryKnown: false } as StepSignIn) : (s.check === "CheckRunning" ? ({ ...s, error: "SignInCheckPending", retryKnown: false } as StepSignIn) : (s.check === "CheckBroken" ? ({ ...s, error: "SignInCheckFailed", retryKnown: false } as StepSignIn) : ({ ...s, pending: "SignInStarting", error: "SignInNoError", retryKnown: false } as StepSignIn)))) : (attempt.kind === "AttemptAnswerStart" ? (attempt.answer === "SignInAnswerOk" ? ({ ...local_1, check: local_3, stage: "SignInCode", error: "SignInNoError", retryKnown: false } as StepSignIn) : ({ ...local_1, check: local_3, error: local_4, retryKnown: local_5 } as StepSignIn)) : (attempt.kind === "AttemptSubmitCode" ? (signInCodeAccepted(attempt.digits) ? ({ ...s, pending: "SignInVerifying", error: "SignInNoError", retryKnown: false } as StepSignIn) : ({ ...s, error: "SignInCodeFormat", retryKnown: false } as StepSignIn)) : (attempt.kind === "AttemptAnswerVerify" ? (attempt.answer === "SignInAnswerOk" ? ({ ...local_1, stage: "SignInVerified", error: "SignInNoError", retryKnown: false } as StepSignIn) : (attempt.answer === "SignInAnswerWrongCode" ? ({ ...local_1, error: "SignInWrongCode", retryKnown: false } as StepSignIn) : (attempt.answer === "SignInAnswerRateLimited" ? ({ ...local_1, error: "SignInRateLimited", retryKnown: attempt.retryKnown } as StepSignIn) : ({ ...local_1, error: "SignInRequestFailed", retryKnown: false } as StepSignIn)))) : (attempt.kind === "AttemptResend" ? (s.check !== "NoCheck" ? ({ ...s, stage: "SignInNumber", error: "SignInCheckAgain", retryKnown: false } as StepSignIn) : ({ ...s, pending: "SignInResending", error: "SignInNoError", retryKnown: false } as StepSignIn)) : (attempt.kind === "AttemptAnswerResend" ? (attempt.answer === "SignInAnswerOk" ? ({ ...local_1, check: local_3, error: "SignInNewCodeSent", retryKnown: false } as StepSignIn) : ({ ...local_1, check: local_3, error: local_4, retryKnown: local_5 } as StepSignIn)) : (attempt.kind === "AttemptChangeNumber" ? ({ ...s, stage: "SignInNumber", error: "SignInNoError", retryKnown: false } as StepSignIn) : (attempt.kind === "AttemptContinueCloud" ? ({ ...s, pending: "SignInOpeningCloud", error: "SignInNoError", retryKnown: false } as StepSignIn) : (attempt.kind === "AttemptAnswerCloud" ? (attempt.answer === "SignInAnswerOk" ? ({ ...local_1, stage: "SignInLeftForCloud", error: "SignInNoError", retryKnown: false } as StepSignIn) : ({ ...local_1, error: "SignInCloudUnavailable", retryKnown: false } as StepSignIn)) : (attempt.kind === "AttemptSettleCheck" ? ({ ...s, check: attempt.passed ? "CheckPassed" : "CheckBroken", error: local_6, retryKnown: s.retryKnown && local_6 === "SignInRateLimited" } as StepSignIn) : ({ ...s, check: "CheckRunning" } as StepSignIn)))))))))));
}

/** Story: Sign in on the step page / The sign-in moves as the browser join sign-in does (spec/oneStepPage.md) */
//@ pure
export function lawInvalidNumberIsNeverSent(s: StepSignIn): boolean {
  //@ ensures \result === true
  return signInMove(s, ({ ...signInAttemptNone, kind: "AttemptSubmitNumber", valid: false } as SignInAttempt)).pending === s.pending;
}

/** Story: Sign in on the step page / The sign-in moves as the browser join sign-in does (spec/oneStepPage.md) */
//@ pure
export function lawEveryStartAnswerSpendsTheCheck(s: StepSignIn, answer: SignInAnswer): boolean {
  //@ ensures \result === true
  return signInMove(s, ({ ...signInAttemptNone, kind: "AttemptAnswerStart", answer: answer } as SignInAttempt)).check !== "CheckPassed" && signInMove(s, ({ ...signInAttemptNone, kind: "AttemptAnswerResend", answer: answer } as SignInAttempt)).check !== "CheckPassed";
}

/** Story: Sign in on the step page / The sign-in moves as the browser join sign-in does (spec/oneStepPage.md) */
//@ pure
export function lawShortCodeIsNeverSent(s: StepSignIn, digits: number): boolean {
  //@ ensures \result === true
  return !(!signInCodeAccepted(digits)) || signInMove(s, ({ ...signInAttemptNone, kind: "AttemptSubmitCode", digits: digits } as SignInAttempt)).pending === s.pending;
}

/** Story: Sign in on the step page / A page that loses its session starts the sign-in again with the same mode (spec/oneStepPage.md) */
//@ pure
export function signInAgain(s: StepSignIn): StepSignIn {
  return { ...s, stage: "SignInNumber", pending: "SignInIdle", error: "SignInNoError", retryKnown: false, check: signInCheckFor(s.auth, s.checkOn) };
}

/** Story: Sign in on the step page / A page that loses its session starts the sign-in again with the same mode (spec/oneStepPage.md) */
//@ pure
export function lawSignInAgainKeepsTheMode(s: StepSignIn): boolean {
  //@ ensures \result === true
  return signInAgain(s).auth === s.auth && signInAgain(s).stage === "SignInNumber" && !signInBusy(signInAgain(s));
}

/** Story: Sign in on the step page / Each sign-in request belongs to its stage, and the check belongs to text codes (spec/oneStepPage.md) */
//@ pure
export function signInConsistent(s: StepSignIn): boolean {
  return (!(s.check !== "NoCheck") || (s.auth === "SignInOtp" && s.checkOn)) && (!s.retryKnown || s.error === "SignInRateLimited") && (!(s.pending === "SignInStarting") || (s.stage === "SignInNumber" && s.auth === "SignInOtp")) && (!(s.pending === "SignInOpeningCloud") || (s.stage === "SignInNumber" && s.auth === "SignInCloud")) && (!(s.pending === "SignInVerifying" || s.pending === "SignInResending") || s.stage === "SignInCode") && (!(s.pending === "SignInResending") || s.check === "NoCheck") && (!(s.stage === "SignInCode") || s.auth === "SignInOtp");
}

/** Story: Sign in on the step page / Each sign-in request belongs to its stage, and the check belongs to text codes (spec/oneStepPage.md) */
//@ pure
export function lawSignInAgainIsConsistent(s: StepSignIn): boolean {
  //@ ensures \result === true
  return !signInConsistent(s) || signInConsistent(signInAgain(s));
}

/** Story: Sign in on the step page / Each sign-in request belongs to its stage, and the check belongs to text codes (spec/oneStepPage.md) */
//@ pure
export function lawEveryAllowedMoveStaysConsistent(s: StepSignIn, attempt: SignInAttempt): boolean {
  //@ ensures \result === true
  return !(signInConsistent(s) && signInAttemptAllowed(s, attempt)) || signInConsistent(signInMove(s, attempt));
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_oneStepPage(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}

/** Whole-number division as Quint does it: towards zero. */
//@ pure
export function quotient_oneStepPage(a: number, b: number): number {
  //@ requires b !== 0
  if (b === 0) throw new RangeError(`${a} cannot be divided by zero`);
  return (a < 0 === b < 0 ? 1 : -1) * Math.floor(Math.abs(a) / Math.abs(b)) + 0;
}
