// GENERATED from spec/phonePage.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type StepNotice as oneStepPage_StepNotice, type StepSession as oneStepPage_StepSession, type CloudReturn as oneStepPage_CloudReturn, type SignInAuth as oneStepPage_SignInAuth, type SignInStage as oneStepPage_SignInStage, type SignInPending as oneStepPage_SignInPending, type SignInCheck as oneStepPage_SignInCheck, type SignInError as oneStepPage_SignInError, type SignInLookup as oneStepPage_SignInLookup, type SignInAnswer as oneStepPage_SignInAnswer, type SignInAttemptKind as oneStepPage_SignInAttemptKind, type OneStepKind as oneStepPage_OneStepKind, type StepSignIn as oneStepPage_StepSignIn, type SignInAttempt as oneStepPage_SignInAttempt, photoPagePurposeHeader as oneStepPage_photoPagePurposeHeader, signInCodeAccepted as oneStepPage_signInCodeAccepted, retryMinutesShown as oneStepPage_retryMinutesShown, signInAttemptAllowed as oneStepPage_signInAttemptAllowed, signInBusy as oneStepPage_signInBusy, signInSpent as oneStepPage_signInSpent, signInStartError as oneStepPage_signInStartError, photoPagePurpose as oneStepPage_photoPagePurpose, lawCodeNeedsFourToEightDigits as oneStepPage_lawCodeNeedsFourToEightDigits, signInConsistent as oneStepPage_signInConsistent, oneStepLinkInFragment as oneStepPage_oneStepLinkInFragment, oneStepLinkMayBeKept as oneStepPage_oneStepLinkMayBeKept, oneStepNoticeShown as oneStepPage_oneStepNoticeShown, noticeForSession as oneStepPage_noticeForSession, noticeForCloudReturn as oneStepPage_noticeForCloudReturn, lawRetryIsAtLeastOneMinute as oneStepPage_lawRetryIsAtLeastOneMinute, lawRetryIsNeverShorterThanTheWait as oneStepPage_lawRetryIsNeverShorterThanTheWait, oneStepIsPhoto as oneStepPage_oneStepIsPhoto, signInStart as oneStepPage_signInStart, signInAttemptNone as oneStepPage_signInAttemptNone, signInAuthFor as oneStepPage_signInAuthFor, signInCheckFor as oneStepPage_signInCheckFor, signInShowsNumberForm as oneStepPage_signInShowsNumberForm, signInShowsCloudButton as oneStepPage_signInShowsCloudButton, signInWaiting as oneStepPage_signInWaiting, signInSettledError as oneStepPage_signInSettledError, signInAgain as oneStepPage_signInAgain, lawOnlyPhotoLinkPagesNameAPurpose as oneStepPage_lawOnlyPhotoLinkPagesNameAPurpose, oneStepNeedsSignIn as oneStepPage_oneStepNeedsSignIn, lawKeptLinkIsInTheFragment as oneStepPage_lawKeptLinkIsInTheFragment, lawSignedInHasNoNotice as oneStepPage_lawSignedInHasNoNotice, noticeOnOpen as oneStepPage_noticeOnOpen, lawEveryCloudErrorShowsANotice as oneStepPage_lawEveryCloudErrorShowsANotice, oneStepOnSite as oneStepPage_oneStepOnSite, lawOnlyCloudLookupUsesCloud as oneStepPage_lawOnlyCloudLookupUsesCloud, lawCheckOnlyWithTextCodes as oneStepPage_lawCheckOnlyWithTextCodes, lawPhotoStepsOnlyOnSlop as oneStepPage_lawPhotoStepsOnlyOnSlop, lawHomeHelpOnlyOnHub as oneStepPage_lawHomeHelpOnlyOnHub, lawPhoneChangeOnEverySite as oneStepPage_lawPhoneChangeOnEverySite, lawSignInAgainKeepsTheMode as oneStepPage_lawSignInAgainKeepsTheMode, lawPhotoTokenIsNeverKept as oneStepPage_lawPhotoTokenIsNeverKept, lawSignInAgainIsConsistent as oneStepPage_lawSignInAgainIsConsistent, lawSessionHidesTheCloudError as oneStepPage_lawSessionHidesTheCloudError, lawPhotoUploadOnlyOnSlop as oneStepPage_lawPhotoUploadOnlyOnSlop, signInMove as oneStepPage_signInMove, lawInvalidNumberIsNeverSent as oneStepPage_lawInvalidNumberIsNeverSent, lawEveryStartAnswerSpendsTheCheck as oneStepPage_lawEveryStartAnswerSpendsTheCheck, lawShortCodeIsNeverSent as oneStepPage_lawShortCodeIsNeverSent, lawEveryAllowedMoveStaysConsistent as oneStepPage_lawEveryAllowedMoveStaysConsistent } from "./oneStepPage.ts";
import { type JoinMode as brandIdentity_JoinMode, type AccentTokens as brandIdentity_AccentTokens, type Accent as brandIdentity_Accent, type Surface as brandIdentity_Surface, type AppKey as brandIdentity_AppKey, type LogoMark as brandIdentity_LogoMark, type SharedPart as brandIdentity_SharedPart, type StateColor as brandIdentity_StateColor, type MarkFill as brandIdentity_MarkFill, type ColorScheme as brandIdentity_ColorScheme, type Brand as brandIdentity_Brand } from "./brandIdentity.ts";

/** Story: Change my number from the link in my conversation / The page reads the session when it opens (spec/phonePage.md) */
export type PhoneScreen = "PhoneOpening" | "PhoneLoading" | "PhoneSignIn" | "PhoneChecking" | "PhoneNewNumber" | "PhoneCode" | "PhoneDone" | "PhoneHeld";
/** Story: Change my number from the link in my conversation / The page reads the session when it opens (spec/phonePage.md) */
export type PhonePending = "PhoneIdle" | "PhoneStarting" | "PhoneConfirming" | "PhoneResending";
/** Story: Change my number from the link in my conversation / The page reads the session when it opens (spec/phonePage.md) */
export type PhoneError = "PhoneNoError" | "PhoneInvalidNumber" | "PhoneSameNumber" | "PhoneRateLimited" | "PhoneCodeFormat" | "PhoneWrongCode" | "PhoneStartAgain" | "PhoneNumberInUse" | "PhoneNewCodeSent" | "PhoneRequestFailed";
/** Story: Change my number from the link in my conversation / The page reads the session when it opens (spec/phonePage.md) */
export interface PhonePage { screen: PhoneScreen; signIn: oneStepPage_StepSignIn; pending: PhonePending; error: PhoneError; notice: oneStepPage_StepNotice; changeStarted: boolean; moved: boolean; doneSignedOut: boolean; retryKnown: boolean }
/** Story: Change my number from the link in my conversation / The new number goes to the server only when it is valid and the mode is known (spec/phonePage.md) */
export type PhoneStartAnswer = "PhoneStartSent" | "PhoneStartInvalidPhone" | "PhoneStartSameNumber" | "PhoneStartNoPerson" | "PhoneStartReauth" | "PhoneStartReview" | "PhoneStartRateLimited" | "PhoneStartSignedOut" | "PhoneStartFailed" | "PhoneStartUnreachable";
/** Story: Change my number from the link in my conversation / Only a well-formed change code goes to the server, and only a moved number shows the result (spec/phonePage.md) */
export type PhoneConfirmAnswer = "PhoneConfirmMoved" | "PhoneConfirmInvalidCode" | "PhoneConfirmNoPerson" | "PhoneConfirmReview" | "PhoneConfirmNoPending" | "PhoneConfirmNumberInUse" | "PhoneConfirmSignedOut" | "PhoneConfirmFailed" | "PhoneConfirmUnreachable";

/** One variant per transition in the spec. */
export type Event =
  | { type: "openPhonePage" }
  | { type: "phoneLoaded"; session: oneStepPage_StepSession; cloudReturn: oneStepPage_CloudReturn }
  | { type: "moveSignIn"; attempt: oneStepPage_SignInAttempt }
  | { type: "phoneSessionRead"; session: oneStepPage_StepSession }
  | { type: "submitNewNumber"; numberValid: boolean }
  | { type: "answerNumberStart"; startAnswer: PhoneStartAnswer; retryKnown: boolean }
  | { type: "submitChangeCode"; codeDigits: number }
  | { type: "answerNumberConfirm"; confirmAnswer: PhoneConfirmAnswer }
  | { type: "resendChangeCode" }
  | { type: "changeNewNumber" }
  | { type: "answerChangeResend"; startAnswer: PhoneStartAnswer; retryKnown: boolean };

/** Story: Change my number from the link in my conversation / The page reads the session when it opens (spec/phonePage.md) */
export const initial: PhonePage = { screen: "PhoneOpening", signIn: oneStepPage_signInStart, pending: "PhoneIdle", error: "PhoneNoError", notice: "NoStepNotice", changeStarted: false, moved: false, doneSignedOut: false, retryKnown: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: PhonePage): boolean {
  return alwaysSignInConsistent(current) && alwaysSignInBusyOnlyOnSignIn(current) && alwaysWaitOnlyWithTooManyTries(current) && alwaysDoneOnlyAfterMove(current) && alwaysSignedOutDoneOnlyWithCloud(current) && alwaysChangeNeedsKnownMode(current) && alwaysCodeNeedsChange(current) && alwaysSignInAgainHasNoChange(current) && alwaysRequestBelongsToItsScreen(current);
}

/** Story: Change my number from the link in my conversation / The page reads the session when it opens (spec/phonePage.md) */
//@ pure
export function canOpenPhonePage(p: PhonePage): boolean {
  return p.screen === "PhoneOpening";
}

/** Story: Change my number from the link in my conversation / The page reads the session when it opens (spec/phonePage.md) */
//@ pure
export function openPhonePage(p: PhonePage): PhonePage {
  //@ ensures (inv(p) && canOpenPhonePage(p)) ==> alwaysSignInConsistent(\result)
  //@ ensures (inv(p) && canOpenPhonePage(p)) ==> alwaysSignInBusyOnlyOnSignIn(\result)
  //@ ensures (inv(p) && canOpenPhonePage(p)) ==> alwaysWaitOnlyWithTooManyTries(\result)
  //@ ensures (inv(p) && canOpenPhonePage(p)) ==> alwaysDoneOnlyAfterMove(\result)
  //@ ensures (inv(p) && canOpenPhonePage(p)) ==> alwaysSignedOutDoneOnlyWithCloud(\result)
  //@ ensures (inv(p) && canOpenPhonePage(p)) ==> alwaysChangeNeedsKnownMode(\result)
  //@ ensures (inv(p) && canOpenPhonePage(p)) ==> alwaysCodeNeedsChange(\result)
  //@ ensures (inv(p) && canOpenPhonePage(p)) ==> alwaysSignInAgainHasNoChange(\result)
  //@ ensures (inv(p) && canOpenPhonePage(p)) ==> alwaysRequestBelongsToItsScreen(\result)
  //@ ensures (inv(p) && canOpenPhonePage(p)) ==> stepMoveOnlyFromConfirm(p, "openPhonePage", \result)
  //@ ensures (inv(p) && canOpenPhonePage(p)) ==> stepOneRequestAtATime(p, \result)
  return { ...p, screen: "PhoneLoading" };
}

/** Story: Change my number from the link in my conversation / The page reads the session when it opens (spec/phonePage.md) */
//@ pure
export function canPhoneLoaded(p: PhonePage): boolean {
  return p.screen === "PhoneLoading";
}

/** Story: Change my number from the link in my conversation / The page reads the session when it opens (spec/phonePage.md) */
//@ pure
export function phoneLoaded(p: PhonePage, session: oneStepPage_StepSession, cloudReturn: oneStepPage_CloudReturn): PhonePage {
  //@ ensures (inv(p) && canPhoneLoaded(p)) ==> alwaysSignInConsistent(\result)
  //@ ensures (inv(p) && canPhoneLoaded(p)) ==> alwaysSignInBusyOnlyOnSignIn(\result)
  //@ ensures (inv(p) && canPhoneLoaded(p)) ==> alwaysWaitOnlyWithTooManyTries(\result)
  //@ ensures (inv(p) && canPhoneLoaded(p)) ==> alwaysDoneOnlyAfterMove(\result)
  //@ ensures (inv(p) && canPhoneLoaded(p)) ==> alwaysSignedOutDoneOnlyWithCloud(\result)
  //@ ensures (inv(p) && canPhoneLoaded(p)) ==> alwaysChangeNeedsKnownMode(\result)
  //@ ensures (inv(p) && canPhoneLoaded(p)) ==> alwaysCodeNeedsChange(\result)
  //@ ensures (inv(p) && canPhoneLoaded(p)) ==> alwaysSignInAgainHasNoChange(\result)
  //@ ensures (inv(p) && canPhoneLoaded(p)) ==> alwaysRequestBelongsToItsScreen(\result)
  //@ ensures (inv(p) && canPhoneLoaded(p)) ==> stepMoveOnlyFromConfirm(p, "phoneLoaded", \result)
  //@ ensures (inv(p) && canPhoneLoaded(p)) ==> stepOneRequestAtATime(p, \result)
  return { ...p, screen: session === "SessionSignedIn" ? "PhoneNewNumber" : "PhoneSignIn", notice: oneStepPage_noticeOnOpen(session, cloudReturn), changeStarted: false };
}

/** Story: Change my number from the link in my conversation / The page reads the session when it opens (spec/phonePage.md) */
//@ pure
export function phoneScreenWaiting(p: PhonePage): boolean {
  return p.screen === "PhoneOpening" || p.screen === "PhoneLoading" || p.screen === "PhoneChecking";
}

/** Story: Change my number from the link in my conversation / The sign-in step confirms the current number and then reads the session again (spec/phonePage.md) */
//@ pure
export function canMoveSignIn(p: PhonePage, attempt: oneStepPage_SignInAttempt): boolean {
  return oneStepPage_signInAttemptAllowed(p.signIn, attempt) && (attempt.kind === "AttemptReadMode" ? p.screen !== "PhoneOpening" && p.screen !== "PhoneLoading" : p.screen === "PhoneSignIn");
}

/** Story: Change my number from the link in my conversation / The sign-in step confirms the current number and then reads the session again (spec/phonePage.md) */
//@ pure
export function moveSignIn(p: PhonePage, attempt: oneStepPage_SignInAttempt): PhonePage {
  //@ ensures (inv(p) && canMoveSignIn(p, attempt)) ==> alwaysSignInConsistent(\result)
  //@ ensures (inv(p) && canMoveSignIn(p, attempt)) ==> alwaysSignInBusyOnlyOnSignIn(\result)
  //@ ensures (inv(p) && canMoveSignIn(p, attempt)) ==> alwaysWaitOnlyWithTooManyTries(\result)
  //@ ensures (inv(p) && canMoveSignIn(p, attempt)) ==> alwaysDoneOnlyAfterMove(\result)
  //@ ensures (inv(p) && canMoveSignIn(p, attempt)) ==> alwaysSignedOutDoneOnlyWithCloud(\result)
  //@ ensures (inv(p) && canMoveSignIn(p, attempt)) ==> alwaysChangeNeedsKnownMode(\result)
  //@ ensures (inv(p) && canMoveSignIn(p, attempt)) ==> alwaysCodeNeedsChange(\result)
  //@ ensures (inv(p) && canMoveSignIn(p, attempt)) ==> alwaysSignInAgainHasNoChange(\result)
  //@ ensures (inv(p) && canMoveSignIn(p, attempt)) ==> alwaysRequestBelongsToItsScreen(\result)
  //@ ensures (inv(p) && canMoveSignIn(p, attempt)) ==> stepMoveOnlyFromConfirm(p, "moveSignIn", \result)
  //@ ensures (inv(p) && canMoveSignIn(p, attempt)) ==> stepOneRequestAtATime(p, \result)
  const local_0: oneStepPage_StepSignIn = oneStepPage_signInMove(p.signIn, attempt);
  return { ...p, signIn: local_0, screen: attempt.kind === "AttemptAnswerVerify" && local_0.stage === "SignInVerified" ? "PhoneChecking" : p.screen };
}

/** Story: Change my number from the link in my conversation / The sign-in step confirms the current number and then reads the session again (spec/phonePage.md) */
//@ pure
export function phoneSignInAgain(notice: oneStepPage_StepNotice, p: PhonePage): PhonePage {
  return { ...p, screen: "PhoneSignIn", signIn: oneStepPage_signInAgain(p.signIn), pending: "PhoneIdle", error: "PhoneNoError", notice: notice, changeStarted: false, retryKnown: false };
}

/** Story: Change my number from the link in my conversation / The sign-in step confirms the current number and then reads the session again (spec/phonePage.md) */
//@ pure
export function canPhoneSessionRead(p: PhonePage): boolean {
  return p.screen === "PhoneChecking";
}

/** Story: Change my number from the link in my conversation / The sign-in step confirms the current number and then reads the session again (spec/phonePage.md) */
//@ pure
export function alwaysSignInConsistent(p: PhonePage): boolean {
  return oneStepPage_signInConsistent(p.signIn);
}

/** Story: Change my number from the link in my conversation / The sign-in step confirms the current number and then reads the session again (spec/phonePage.md) */
//@ pure
export function alwaysSignInBusyOnlyOnSignIn(p: PhonePage): boolean {
  return !oneStepPage_signInBusy(p.signIn) || p.screen === "PhoneSignIn";
}

/** Story: Change my number from the link in my conversation / The sign-in step confirms the current number and then reads the session again (spec/phonePage.md) */
//@ pure
export function phoneSessionRead(p: PhonePage, session: oneStepPage_StepSession): PhonePage {
  //@ ensures (inv(p) && canPhoneSessionRead(p)) ==> alwaysSignInConsistent(\result)
  //@ ensures (inv(p) && canPhoneSessionRead(p)) ==> alwaysSignInBusyOnlyOnSignIn(\result)
  //@ ensures (inv(p) && canPhoneSessionRead(p)) ==> alwaysWaitOnlyWithTooManyTries(\result)
  //@ ensures (inv(p) && canPhoneSessionRead(p)) ==> alwaysDoneOnlyAfterMove(\result)
  //@ ensures (inv(p) && canPhoneSessionRead(p)) ==> alwaysSignedOutDoneOnlyWithCloud(\result)
  //@ ensures (inv(p) && canPhoneSessionRead(p)) ==> alwaysChangeNeedsKnownMode(\result)
  //@ ensures (inv(p) && canPhoneSessionRead(p)) ==> alwaysCodeNeedsChange(\result)
  //@ ensures (inv(p) && canPhoneSessionRead(p)) ==> alwaysSignInAgainHasNoChange(\result)
  //@ ensures (inv(p) && canPhoneSessionRead(p)) ==> alwaysRequestBelongsToItsScreen(\result)
  //@ ensures (inv(p) && canPhoneSessionRead(p)) ==> stepMoveOnlyFromConfirm(p, "phoneSessionRead", \result)
  //@ ensures (inv(p) && canPhoneSessionRead(p)) ==> stepOneRequestAtATime(p, \result)
  return session === "SessionSignedIn" ? ({ ...p, screen: "PhoneNewNumber", notice: "NoStepNotice", error: "PhoneNoError", retryKnown: false } as PhonePage) : phoneSignInAgain(oneStepPage_noticeForSession(session), p);
}

/** Story: Change my number from the link in my conversation / The new number goes to the server only when it is valid and the mode is known (spec/phonePage.md) */
//@ pure
export function phoneNumberFormWaiting(p: PhonePage): boolean {
  return p.screen === "PhoneNewNumber" && p.signIn.auth === "SignInModePending";
}

/** Story: Change my number from the link in my conversation / The new number goes to the server only when it is valid and the mode is known (spec/phonePage.md) */
//@ pure
export function canSubmitNewNumber(p: PhonePage): boolean {
  return p.screen === "PhoneNewNumber" && p.pending === "PhoneIdle" && p.signIn.auth !== "SignInModePending";
}

/** Story: Change my number from the link in my conversation / The new number goes to the server only when it is valid and the mode is known (spec/phonePage.md) */
//@ pure
export function submitNewNumber(p: PhonePage, numberValid: boolean): PhonePage {
  //@ ensures (inv(p) && canSubmitNewNumber(p)) ==> alwaysSignInConsistent(\result)
  //@ ensures (inv(p) && canSubmitNewNumber(p)) ==> alwaysSignInBusyOnlyOnSignIn(\result)
  //@ ensures (inv(p) && canSubmitNewNumber(p)) ==> alwaysWaitOnlyWithTooManyTries(\result)
  //@ ensures (inv(p) && canSubmitNewNumber(p)) ==> alwaysDoneOnlyAfterMove(\result)
  //@ ensures (inv(p) && canSubmitNewNumber(p)) ==> alwaysSignedOutDoneOnlyWithCloud(\result)
  //@ ensures (inv(p) && canSubmitNewNumber(p)) ==> alwaysChangeNeedsKnownMode(\result)
  //@ ensures (inv(p) && canSubmitNewNumber(p)) ==> alwaysCodeNeedsChange(\result)
  //@ ensures (inv(p) && canSubmitNewNumber(p)) ==> alwaysSignInAgainHasNoChange(\result)
  //@ ensures (inv(p) && canSubmitNewNumber(p)) ==> alwaysRequestBelongsToItsScreen(\result)
  //@ ensures (inv(p) && canSubmitNewNumber(p)) ==> stepMoveOnlyFromConfirm(p, "submitNewNumber", \result)
  //@ ensures (inv(p) && canSubmitNewNumber(p)) ==> stepOneRequestAtATime(p, \result)
  return numberValid ? ({ ...p, pending: "PhoneStarting", error: "PhoneNoError", retryKnown: false } as PhonePage) : ({ ...p, error: "PhoneInvalidNumber", retryKnown: false } as PhonePage);
}

/** Story: Change my number from the link in my conversation / The new number goes to the server only when it is valid and the mode is known (spec/phonePage.md) */
//@ pure
export function canAnswerNumberStart(p: PhonePage): boolean {
  return p.pending === "PhoneStarting";
}

/** Story: Change my number from the link in my conversation / The new number goes to the server only when it is valid and the mode is known (spec/phonePage.md) */
//@ pure
export function alwaysWaitOnlyWithTooManyTries(p: PhonePage): boolean {
  return !p.retryKnown || p.error === "PhoneRateLimited";
}

/** Story: Change my number from the link in my conversation / The new number goes to the server only when it is valid and the mode is known (spec/phonePage.md) */
//@ pure
export function phoneAfterStart(startAnswer: PhoneStartAnswer, retryKnown: boolean, resend: boolean, p: PhonePage): PhonePage {
  const local_1: PhonePage = { ...p, pending: "PhoneIdle", retryKnown: false };
  return startAnswer === "PhoneStartSent" ? (resend ? ({ ...local_1, error: "PhoneNewCodeSent", notice: "NoStepNotice" } as PhonePage) : ({ ...local_1, screen: "PhoneCode", error: "PhoneNoError", notice: "NoStepNotice", changeStarted: true } as PhonePage)) : (startAnswer === "PhoneStartInvalidPhone" ? ({ ...local_1, error: "PhoneInvalidNumber", notice: "NoStepNotice" } as PhonePage) : (startAnswer === "PhoneStartSameNumber" ? ({ ...local_1, error: "PhoneSameNumber", notice: "NoStepNotice" } as PhonePage) : (startAnswer === "PhoneStartRateLimited" ? ({ ...local_1, error: "PhoneRateLimited", notice: "NoStepNotice", retryKnown: retryKnown } as PhonePage) : (startAnswer === "PhoneStartFailed" ? ({ ...local_1, error: "PhoneRequestFailed", notice: "NoStepNotice" } as PhonePage) : (startAnswer === "PhoneStartReauth" ? phoneSignInAgain("StepSignInAgain", local_1) : (startAnswer === "PhoneStartNoPerson" || startAnswer === "PhoneStartSignedOut" ? phoneSignInAgain("StepSessionEnded", local_1) : (startAnswer === "PhoneStartReview" ? ({ ...local_1, screen: "PhoneHeld", error: "PhoneNoError", notice: "NoStepNotice", changeStarted: false } as PhonePage) : ({ ...local_1, notice: "StepUnreachable" } as PhonePage))))))));
}

/** Story: Change my number from the link in my conversation / The new number goes to the server only when it is valid and the mode is known (spec/phonePage.md) */
//@ pure
export function answerNumberStart(p: PhonePage, startAnswer: PhoneStartAnswer, retryKnown: boolean): PhonePage {
  //@ ensures (inv(p) && canAnswerNumberStart(p)) ==> alwaysSignInConsistent(\result)
  //@ ensures (inv(p) && canAnswerNumberStart(p)) ==> alwaysSignInBusyOnlyOnSignIn(\result)
  //@ ensures (inv(p) && canAnswerNumberStart(p)) ==> alwaysWaitOnlyWithTooManyTries(\result)
  //@ ensures (inv(p) && canAnswerNumberStart(p)) ==> alwaysDoneOnlyAfterMove(\result)
  //@ ensures (inv(p) && canAnswerNumberStart(p)) ==> alwaysSignedOutDoneOnlyWithCloud(\result)
  //@ ensures (inv(p) && canAnswerNumberStart(p)) ==> alwaysChangeNeedsKnownMode(\result)
  //@ ensures (inv(p) && canAnswerNumberStart(p)) ==> alwaysCodeNeedsChange(\result)
  //@ ensures (inv(p) && canAnswerNumberStart(p)) ==> alwaysSignInAgainHasNoChange(\result)
  //@ ensures (inv(p) && canAnswerNumberStart(p)) ==> alwaysRequestBelongsToItsScreen(\result)
  //@ ensures (inv(p) && canAnswerNumberStart(p)) ==> stepMoveOnlyFromConfirm(p, "answerNumberStart", \result)
  //@ ensures (inv(p) && canAnswerNumberStart(p)) ==> stepOneRequestAtATime(p, \result)
  return phoneAfterStart(startAnswer, retryKnown, false, p);
}

/** Story: Change my number from the link in my conversation / The new number goes to the server only when it is valid and the mode is known (spec/phonePage.md) */
//@ pure
export function lawWaitShowsOnlyWithTooManyTries(p: PhonePage, startAnswer: PhoneStartAnswer, retryKnown: boolean): boolean {
  //@ ensures \result === true
  return !answerNumberStart(p, startAnswer, retryKnown).retryKnown || (startAnswer === "PhoneStartRateLimited" && retryKnown);
}

/** Story: Change my number from the link in my conversation / The new number goes to the server only when it is valid and the mode is known (spec/phonePage.md) */
//@ pure
export function lawReauthAsksForSignIn(p: PhonePage): boolean {
  //@ ensures \result === true
  const local_2: PhonePage = answerNumberStart(p, "PhoneStartReauth", false);
  return local_2.screen === "PhoneSignIn" && local_2.notice === "StepSignInAgain" && local_2.signIn.stage === "SignInNumber";
}

/** Story: Change my number from the link in my conversation / Only a well-formed change code goes to the server, and only a moved number shows the result (spec/phonePage.md) */
//@ pure
export function phoneChangeCodeAccepted(codeDigits: number): boolean {
  return codeDigits >= 4 && codeDigits <= 10;
}

/** Story: Change my number from the link in my conversation / Only a well-formed change code goes to the server, and only a moved number shows the result (spec/phonePage.md) */
//@ pure
export function alwaysDoneOnlyAfterMove(p: PhonePage): boolean {
  return (p.screen === "PhoneDone") === p.moved;
}

/** Story: Change my number from the link in my conversation / Only a well-formed change code goes to the server, and only a moved number shows the result (spec/phonePage.md) */
//@ pure
export function alwaysSignedOutDoneOnlyWithCloud(p: PhonePage): boolean {
  return !p.doneSignedOut || (p.screen === "PhoneDone" && p.signIn.auth === "SignInCloud");
}

/** Story: Change my number from the link in my conversation / Only a well-formed change code goes to the server, and only a moved number shows the result (spec/phonePage.md) */
//@ pure
export function alwaysChangeNeedsKnownMode(p: PhonePage): boolean {
  return !(p.pending !== "PhoneIdle" || p.screen === "PhoneCode" || p.screen === "PhoneDone") || p.signIn.auth !== "SignInModePending";
}

/** Story: Change my number from the link in my conversation / Only a well-formed change code goes to the server, and only a moved number shows the result (spec/phonePage.md) */
//@ pure
export function stepMoveOnlyFromConfirm(before: PhonePage, via: string, after: PhonePage): boolean {
  return !(after.moved && !before.moved) || (via === "answerNumberConfirm" && before.pending === "PhoneConfirming");
}

/** Story: Change my number from the link in my conversation / Only a well-formed change code goes to the server, and only a moved number shows the result (spec/phonePage.md) */
//@ pure
export function canSubmitChangeCode(p: PhonePage): boolean {
  return p.screen === "PhoneCode" && p.pending === "PhoneIdle";
}

/** Story: Change my number from the link in my conversation / Only a well-formed change code goes to the server, and only a moved number shows the result (spec/phonePage.md) */
//@ pure
export function submitChangeCode(p: PhonePage, codeDigits: number): PhonePage {
  //@ ensures (inv(p) && canSubmitChangeCode(p)) ==> alwaysSignInConsistent(\result)
  //@ ensures (inv(p) && canSubmitChangeCode(p)) ==> alwaysSignInBusyOnlyOnSignIn(\result)
  //@ ensures (inv(p) && canSubmitChangeCode(p)) ==> alwaysWaitOnlyWithTooManyTries(\result)
  //@ ensures (inv(p) && canSubmitChangeCode(p)) ==> alwaysDoneOnlyAfterMove(\result)
  //@ ensures (inv(p) && canSubmitChangeCode(p)) ==> alwaysSignedOutDoneOnlyWithCloud(\result)
  //@ ensures (inv(p) && canSubmitChangeCode(p)) ==> alwaysChangeNeedsKnownMode(\result)
  //@ ensures (inv(p) && canSubmitChangeCode(p)) ==> alwaysCodeNeedsChange(\result)
  //@ ensures (inv(p) && canSubmitChangeCode(p)) ==> alwaysSignInAgainHasNoChange(\result)
  //@ ensures (inv(p) && canSubmitChangeCode(p)) ==> alwaysRequestBelongsToItsScreen(\result)
  //@ ensures (inv(p) && canSubmitChangeCode(p)) ==> stepMoveOnlyFromConfirm(p, "submitChangeCode", \result)
  //@ ensures (inv(p) && canSubmitChangeCode(p)) ==> stepOneRequestAtATime(p, \result)
  return phoneChangeCodeAccepted(codeDigits) ? ({ ...p, pending: "PhoneConfirming", error: "PhoneNoError", retryKnown: false } as PhonePage) : ({ ...p, error: "PhoneCodeFormat", retryKnown: false } as PhonePage);
}

/** Story: Change my number from the link in my conversation / Only a well-formed change code goes to the server, and only a moved number shows the result (spec/phonePage.md) */
//@ pure
export function canAnswerNumberConfirm(p: PhonePage): boolean {
  return p.pending === "PhoneConfirming";
}

/** Story: Change my number from the link in my conversation / Only a well-formed change code goes to the server, and only a moved number shows the result (spec/phonePage.md) */
//@ pure
export function answerNumberConfirm(p: PhonePage, confirmAnswer: PhoneConfirmAnswer): PhonePage {
  //@ ensures (inv(p) && canAnswerNumberConfirm(p)) ==> alwaysSignInConsistent(\result)
  //@ ensures (inv(p) && canAnswerNumberConfirm(p)) ==> alwaysSignInBusyOnlyOnSignIn(\result)
  //@ ensures (inv(p) && canAnswerNumberConfirm(p)) ==> alwaysWaitOnlyWithTooManyTries(\result)
  //@ ensures (inv(p) && canAnswerNumberConfirm(p)) ==> alwaysDoneOnlyAfterMove(\result)
  //@ ensures (inv(p) && canAnswerNumberConfirm(p)) ==> alwaysSignedOutDoneOnlyWithCloud(\result)
  //@ ensures (inv(p) && canAnswerNumberConfirm(p)) ==> alwaysChangeNeedsKnownMode(\result)
  //@ ensures (inv(p) && canAnswerNumberConfirm(p)) ==> alwaysCodeNeedsChange(\result)
  //@ ensures (inv(p) && canAnswerNumberConfirm(p)) ==> alwaysSignInAgainHasNoChange(\result)
  //@ ensures (inv(p) && canAnswerNumberConfirm(p)) ==> alwaysRequestBelongsToItsScreen(\result)
  //@ ensures (inv(p) && canAnswerNumberConfirm(p)) ==> stepMoveOnlyFromConfirm(p, "answerNumberConfirm", \result)
  //@ ensures (inv(p) && canAnswerNumberConfirm(p)) ==> stepOneRequestAtATime(p, \result)
  const local_3: PhonePage = { ...p, pending: "PhoneIdle", retryKnown: false };
  return confirmAnswer === "PhoneConfirmMoved" ? ({ ...local_3, screen: "PhoneDone", moved: true, doneSignedOut: p.signIn.auth === "SignInCloud", error: "PhoneNoError", notice: "NoStepNotice", changeStarted: false } as PhonePage) : (confirmAnswer === "PhoneConfirmInvalidCode" ? ({ ...local_3, error: "PhoneWrongCode", notice: "NoStepNotice" } as PhonePage) : (confirmAnswer === "PhoneConfirmNoPending" ? ({ ...local_3, screen: "PhoneNewNumber", error: "PhoneStartAgain", notice: "NoStepNotice", changeStarted: false } as PhonePage) : (confirmAnswer === "PhoneConfirmNumberInUse" ? ({ ...local_3, screen: "PhoneNewNumber", error: "PhoneNumberInUse", notice: "NoStepNotice", changeStarted: false } as PhonePage) : (confirmAnswer === "PhoneConfirmReview" ? ({ ...local_3, screen: "PhoneHeld", error: "PhoneNoError", notice: "NoStepNotice", changeStarted: false } as PhonePage) : (confirmAnswer === "PhoneConfirmNoPerson" || confirmAnswer === "PhoneConfirmSignedOut" ? phoneSignInAgain("StepSessionEnded", local_3) : (confirmAnswer === "PhoneConfirmFailed" ? ({ ...local_3, error: "PhoneRequestFailed", notice: "NoStepNotice" } as PhonePage) : ({ ...local_3, notice: "StepUnreachable" } as PhonePage)))))));
}

/** Story: Change my number from the link in my conversation / Only a well-formed change code goes to the server, and only a moved number shows the result (spec/phonePage.md) */
//@ pure
export function lawChangeCodeNeedsFourToTenDigits(p: PhonePage, codeDigits: number): boolean {
  //@ ensures \result === true
  return !(codeDigits < 4 || codeDigits > 10) || submitChangeCode(p, codeDigits).pending === p.pending;
}

/** Story: Change my number from the link in my conversation / The code step can send a new code or go back to the new number (spec/phonePage.md) */
//@ pure
export function canResendChangeCode(p: PhonePage): boolean {
  return p.screen === "PhoneCode" && p.pending === "PhoneIdle";
}

/** Story: Change my number from the link in my conversation / The code step can send a new code or go back to the new number (spec/phonePage.md) */
//@ pure
export function resendChangeCode(p: PhonePage): PhonePage {
  //@ ensures (inv(p) && canResendChangeCode(p)) ==> alwaysSignInConsistent(\result)
  //@ ensures (inv(p) && canResendChangeCode(p)) ==> alwaysSignInBusyOnlyOnSignIn(\result)
  //@ ensures (inv(p) && canResendChangeCode(p)) ==> alwaysWaitOnlyWithTooManyTries(\result)
  //@ ensures (inv(p) && canResendChangeCode(p)) ==> alwaysDoneOnlyAfterMove(\result)
  //@ ensures (inv(p) && canResendChangeCode(p)) ==> alwaysSignedOutDoneOnlyWithCloud(\result)
  //@ ensures (inv(p) && canResendChangeCode(p)) ==> alwaysChangeNeedsKnownMode(\result)
  //@ ensures (inv(p) && canResendChangeCode(p)) ==> alwaysCodeNeedsChange(\result)
  //@ ensures (inv(p) && canResendChangeCode(p)) ==> alwaysSignInAgainHasNoChange(\result)
  //@ ensures (inv(p) && canResendChangeCode(p)) ==> alwaysRequestBelongsToItsScreen(\result)
  //@ ensures (inv(p) && canResendChangeCode(p)) ==> stepMoveOnlyFromConfirm(p, "resendChangeCode", \result)
  //@ ensures (inv(p) && canResendChangeCode(p)) ==> stepOneRequestAtATime(p, \result)
  return { ...p, pending: "PhoneResending", error: "PhoneNoError", retryKnown: false };
}

/** Story: Change my number from the link in my conversation / The code step can send a new code or go back to the new number (spec/phonePage.md) */
//@ pure
export function canAnswerChangeResend(p: PhonePage): boolean {
  return p.pending === "PhoneResending";
}

/** Story: Change my number from the link in my conversation / The code step can send a new code or go back to the new number (spec/phonePage.md) */
//@ pure
export function canChangeNewNumber(p: PhonePage): boolean {
  return p.screen === "PhoneCode" && p.pending === "PhoneIdle";
}

/** Story: Change my number from the link in my conversation / The code step can send a new code or go back to the new number (spec/phonePage.md) */
//@ pure
export function changeNewNumber(p: PhonePage): PhonePage {
  //@ ensures (inv(p) && canChangeNewNumber(p)) ==> alwaysSignInConsistent(\result)
  //@ ensures (inv(p) && canChangeNewNumber(p)) ==> alwaysSignInBusyOnlyOnSignIn(\result)
  //@ ensures (inv(p) && canChangeNewNumber(p)) ==> alwaysWaitOnlyWithTooManyTries(\result)
  //@ ensures (inv(p) && canChangeNewNumber(p)) ==> alwaysDoneOnlyAfterMove(\result)
  //@ ensures (inv(p) && canChangeNewNumber(p)) ==> alwaysSignedOutDoneOnlyWithCloud(\result)
  //@ ensures (inv(p) && canChangeNewNumber(p)) ==> alwaysChangeNeedsKnownMode(\result)
  //@ ensures (inv(p) && canChangeNewNumber(p)) ==> alwaysCodeNeedsChange(\result)
  //@ ensures (inv(p) && canChangeNewNumber(p)) ==> alwaysSignInAgainHasNoChange(\result)
  //@ ensures (inv(p) && canChangeNewNumber(p)) ==> alwaysRequestBelongsToItsScreen(\result)
  //@ ensures (inv(p) && canChangeNewNumber(p)) ==> stepMoveOnlyFromConfirm(p, "changeNewNumber", \result)
  //@ ensures (inv(p) && canChangeNewNumber(p)) ==> stepOneRequestAtATime(p, \result)
  return { ...p, screen: "PhoneNewNumber", error: "PhoneNoError", changeStarted: false, retryKnown: false };
}

/** Story: Change my number from the link in my conversation / The code step can send a new code or go back to the new number (spec/phonePage.md) */
//@ pure
export function alwaysCodeNeedsChange(p: PhonePage): boolean {
  return !(p.screen === "PhoneCode" || p.pending === "PhoneConfirming" || p.pending === "PhoneResending") || p.changeStarted;
}

/** Story: Change my number from the link in my conversation / The code step can send a new code or go back to the new number (spec/phonePage.md) */
//@ pure
export function answerChangeResend(p: PhonePage, startAnswer: PhoneStartAnswer, retryKnown: boolean): PhonePage {
  //@ ensures (inv(p) && canAnswerChangeResend(p)) ==> alwaysSignInConsistent(\result)
  //@ ensures (inv(p) && canAnswerChangeResend(p)) ==> alwaysSignInBusyOnlyOnSignIn(\result)
  //@ ensures (inv(p) && canAnswerChangeResend(p)) ==> alwaysWaitOnlyWithTooManyTries(\result)
  //@ ensures (inv(p) && canAnswerChangeResend(p)) ==> alwaysDoneOnlyAfterMove(\result)
  //@ ensures (inv(p) && canAnswerChangeResend(p)) ==> alwaysSignedOutDoneOnlyWithCloud(\result)
  //@ ensures (inv(p) && canAnswerChangeResend(p)) ==> alwaysChangeNeedsKnownMode(\result)
  //@ ensures (inv(p) && canAnswerChangeResend(p)) ==> alwaysCodeNeedsChange(\result)
  //@ ensures (inv(p) && canAnswerChangeResend(p)) ==> alwaysSignInAgainHasNoChange(\result)
  //@ ensures (inv(p) && canAnswerChangeResend(p)) ==> alwaysRequestBelongsToItsScreen(\result)
  //@ ensures (inv(p) && canAnswerChangeResend(p)) ==> stepMoveOnlyFromConfirm(p, "answerChangeResend", \result)
  //@ ensures (inv(p) && canAnswerChangeResend(p)) ==> stepOneRequestAtATime(p, \result)
  return phoneAfterStart(startAnswer, retryKnown, true, p);
}

/** Story: Sign in again when my sign-in is old / A sign-in that is too old starts the sign-in again on the same page (spec/phonePage.md) */
//@ pure
export function alwaysSignInAgainHasNoChange(p: PhonePage): boolean {
  return !(p.screen === "PhoneSignIn" || p.screen === "PhoneChecking") || (!p.changeStarted && p.pending === "PhoneIdle");
}

/** Story: Sign in again when my sign-in is old / A sign-in that is too old starts the sign-in again on the same page (spec/phonePage.md) */
//@ pure
export function lawSignInAgainKeepsMode(p: PhonePage): boolean {
  //@ ensures \result === true
  return answerNumberStart(p, "PhoneStartReauth", false).signIn.auth === p.signIn.auth;
}

/** Story: Send each request only once / A form that waits for an answer refuses a second submit (spec/phonePage.md) */
//@ pure
export function phoneBusy(p: PhonePage): boolean {
  return p.pending !== "PhoneIdle";
}

/** Story: Send each request only once / A form that waits for an answer refuses a second submit (spec/phonePage.md) */
//@ pure
export function stepOneRequestAtATime(before: PhonePage, after: PhonePage): boolean {
  return !(after.pending !== "PhoneIdle" && after.pending !== before.pending) || before.pending === "PhoneIdle";
}

/** Story: Send each request only once / A form that waits for an answer refuses a second submit (spec/phonePage.md) */
//@ pure
export function alwaysRequestBelongsToItsScreen(p: PhonePage): boolean {
  return (!(p.pending === "PhoneStarting") || p.screen === "PhoneNewNumber") && (!(p.pending === "PhoneConfirming" || p.pending === "PhoneResending") || p.screen === "PhoneCode");
}

/** Story: Reach every outcome / A person can change the number, be held, sign in again or see each error (spec/phonePage.md) */
//@ pure
export function sometimesMoved(p: PhonePage): boolean {
  return p.screen === "PhoneDone";
}

/** Story: Reach every outcome / A person can change the number, be held, sign in again or see each error (spec/phonePage.md) */
//@ pure
export function sometimesMovedOnCloud(p: PhonePage): boolean {
  return p.screen === "PhoneDone" && p.doneSignedOut;
}

/** Story: Reach every outcome / A person can change the number, be held, sign in again or see each error (spec/phonePage.md) */
//@ pure
export function sometimesMovedWithTextCodes(p: PhonePage): boolean {
  return p.screen === "PhoneDone" && !p.doneSignedOut;
}

/** Story: Reach every outcome / A person can change the number, be held, sign in again or see each error (spec/phonePage.md) */
//@ pure
export function sometimesHeld(p: PhonePage): boolean {
  return p.screen === "PhoneHeld";
}

/** Story: Reach every outcome / A person can change the number, be held, sign in again or see each error (spec/phonePage.md) */
//@ pure
export function sometimesSameNumber(p: PhonePage): boolean {
  return p.screen === "PhoneNewNumber" && p.error === "PhoneSameNumber";
}

/** Story: Reach every outcome / A person can change the number, be held, sign in again or see each error (spec/phonePage.md) */
//@ pure
export function sometimesInvalidNumber(p: PhonePage): boolean {
  return p.error === "PhoneInvalidNumber";
}

/** Story: Reach every outcome / A person can change the number, be held, sign in again or see each error (spec/phonePage.md) */
//@ pure
export function sometimesNumberInUse(p: PhonePage): boolean {
  return p.screen === "PhoneNewNumber" && p.error === "PhoneNumberInUse";
}

/** Story: Reach every outcome / A person can change the number, be held, sign in again or see each error (spec/phonePage.md) */
//@ pure
export function sometimesStartAgain(p: PhonePage): boolean {
  return p.screen === "PhoneNewNumber" && p.error === "PhoneStartAgain";
}

/** Story: Reach every outcome / A person can change the number, be held, sign in again or see each error (spec/phonePage.md) */
//@ pure
export function sometimesReauth(p: PhonePage): boolean {
  return p.screen === "PhoneSignIn" && p.notice === "StepSignInAgain";
}

/** Story: Reach every outcome / A person can change the number, be held, sign in again or see each error (spec/phonePage.md) */
//@ pure
export function sometimesSessionEnded(p: PhonePage): boolean {
  return p.screen === "PhoneSignIn" && p.notice === "StepSessionEnded";
}

/** Story: Reach every outcome / A person can change the number, be held, sign in again or see each error (spec/phonePage.md) */
//@ pure
export function sometimesRateLimited(p: PhonePage): boolean {
  return p.error === "PhoneRateLimited" && !p.retryKnown;
}

/** Story: Reach every outcome / A person can change the number, be held, sign in again or see each error (spec/phonePage.md) */
//@ pure
export function sometimesRateLimitedWithTime(p: PhonePage): boolean {
  return p.error === "PhoneRateLimited" && p.retryKnown;
}

/** Story: Reach every outcome / A person can change the number, be held, sign in again or see each error (spec/phonePage.md) */
//@ pure
export function sometimesCloudSignInRefused(p: PhonePage): boolean {
  return p.screen === "PhoneSignIn" && p.notice === "StepSignInRefused";
}

/** Story: Reach every outcome / A person can change the number, be held, sign in again or see each error (spec/phonePage.md) */
//@ pure
export function sometimesCloudSignInExpired(p: PhonePage): boolean {
  return p.screen === "PhoneSignIn" && p.notice === "StepSignInExpired";
}

/** Story: Reach every outcome / A person can change the number, be held, sign in again or see each error (spec/phonePage.md) */
//@ pure
export function sometimesCloudSignInUnavailable(p: PhonePage): boolean {
  return p.screen === "PhoneSignIn" && p.notice === "StepSignInUnavailable";
}

/** Story: Reach every outcome / A person can change the number, be held, sign in again or see each error (spec/phonePage.md) */
//@ pure
export function sometimesUnreachable(p: PhonePage): boolean {
  return p.notice === "StepUnreachable";
}

/** Story: Reach every outcome / A person can change the number, be held, sign in again or see each error (spec/phonePage.md) */
//@ pure
export function sometimesNewCodeSent(p: PhonePage): boolean {
  return p.screen === "PhoneCode" && p.error === "PhoneNewCodeSent";
}

/** Story: Reach every outcome / A person can change the number, be held, sign in again or see each error (spec/phonePage.md) */
//@ pure
export function sometimesWrongCode(p: PhonePage): boolean {
  return p.screen === "PhoneCode" && p.error === "PhoneWrongCode";
}

/** Story: Reach every outcome / A person can change the number, be held, sign in again or see each error (spec/phonePage.md) */
//@ pure
export function sometimesCodeFormat(p: PhonePage): boolean {
  return p.error === "PhoneCodeFormat";
}

/** Story: Reach every outcome / A person can change the number, be held, sign in again or see each error (spec/phonePage.md) */
//@ pure
export function sometimesRequestFailed(p: PhonePage): boolean {
  return p.error === "PhoneRequestFailed";
}

/** Story: Reach every outcome / A person can change the number, be held, sign in again or see each error (spec/phonePage.md) */
//@ pure
export function sometimesSignInRateLimitedWithTime(p: PhonePage): boolean {
  return p.screen === "PhoneSignIn" && p.signIn.error === "SignInRateLimited" && p.signIn.retryKnown;
}

/** Story: Reach every outcome / A person can change the number, be held, sign in again or see each error (spec/phonePage.md) */
//@ pure
export function sometimesLeftForCloud(p: PhonePage): boolean {
  return p.screen === "PhoneSignIn" && p.signIn.stage === "SignInLeftForCloud";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: PhonePage, event: Event): boolean {
  if (event.type === "openPhonePage") return canOpenPhonePage(current);
  if (event.type === "phoneLoaded") return canPhoneLoaded(current);
  if (event.type === "moveSignIn") return canMoveSignIn(current, event.attempt);
  if (event.type === "phoneSessionRead") return canPhoneSessionRead(current);
  if (event.type === "submitNewNumber") return canSubmitNewNumber(current);
  if (event.type === "answerNumberStart") return canAnswerNumberStart(current);
  if (event.type === "submitChangeCode") return canSubmitChangeCode(current);
  if (event.type === "answerNumberConfirm") return canAnswerNumberConfirm(current);
  if (event.type === "resendChangeCode") return canResendChangeCode(current);
  if (event.type === "changeNewNumber") return canChangeNewNumber(current);
  if (event.type === "answerChangeResend") return canAnswerChangeResend(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: PhonePage, event: Event): PhonePage {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "openPhonePage") return canOpenPhonePage(current) ? openPhonePage(current) : current;
  if (event.type === "phoneLoaded") return canPhoneLoaded(current) ? phoneLoaded(current, event.session, event.cloudReturn) : current;
  if (event.type === "moveSignIn") return canMoveSignIn(current, event.attempt) ? moveSignIn(current, event.attempt) : current;
  if (event.type === "phoneSessionRead") return canPhoneSessionRead(current) ? phoneSessionRead(current, event.session) : current;
  if (event.type === "submitNewNumber") return canSubmitNewNumber(current) ? submitNewNumber(current, event.numberValid) : current;
  if (event.type === "answerNumberStart") return canAnswerNumberStart(current) ? answerNumberStart(current, event.startAnswer, event.retryKnown) : current;
  if (event.type === "submitChangeCode") return canSubmitChangeCode(current) ? submitChangeCode(current, event.codeDigits) : current;
  if (event.type === "answerNumberConfirm") return canAnswerNumberConfirm(current) ? answerNumberConfirm(current, event.confirmAnswer) : current;
  if (event.type === "resendChangeCode") return canResendChangeCode(current) ? resendChangeCode(current) : current;
  if (event.type === "changeNewNumber") return canChangeNewNumber(current) ? changeNewNumber(current) : current;
  if (event.type === "answerChangeResend") return canAnswerChangeResend(current) ? answerChangeResend(current, event.startAnswer, event.retryKnown) : current;
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
  const is_oneStepPage_SignInAttempt = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && (v.kind === "AttemptReadMode" || v.kind === "AttemptSubmitNumber" || v.kind === "AttemptAnswerStart" || v.kind === "AttemptSubmitCode" || v.kind === "AttemptAnswerVerify" || v.kind === "AttemptResend" || v.kind === "AttemptAnswerResend" || v.kind === "AttemptChangeNumber" || v.kind === "AttemptContinueCloud" || v.kind === "AttemptAnswerCloud" || v.kind === "AttemptSettleCheck" || v.kind === "AttemptExpireCheck") && (v.lookup === "SignInLookupFailed" || v.lookup === "SignInLookupOtp" || v.lookup === "SignInLookupCloud") && typeof v.checkOn === "boolean" && typeof v.valid === "boolean" && Number.isSafeInteger(v.digits) && (v.answer === "SignInAnswerOk" || v.answer === "SignInAnswerRateLimited" || v.answer === "SignInAnswerCheckRejected" || v.answer === "SignInAnswerWrongCode" || v.answer === "SignInAnswerFailed") && typeof v.retryKnown === "boolean" && typeof v.passed === "boolean";
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "openPhonePage") return { type: "openPhonePage" };
  if (raw.type === "phoneLoaded" && (raw.session === "SessionSignedIn" || raw.session === "SessionSignedOut" || raw.session === "SessionUnreadable") && (raw.cloudReturn === "CloudReturnNone" || raw.cloudReturn === "CloudReturnExpired" || raw.cloudReturn === "CloudReturnRefused" || raw.cloudReturn === "CloudReturnUnavailable")) return { type: "phoneLoaded", session: raw.session, cloudReturn: raw.cloudReturn };
  if (raw.type === "moveSignIn" && is_oneStepPage_SignInAttempt(raw.attempt)) return { type: "moveSignIn", attempt: ({ kind: raw.attempt.kind, lookup: raw.attempt.lookup, checkOn: raw.attempt.checkOn, valid: raw.attempt.valid, digits: raw.attempt.digits, answer: raw.attempt.answer, retryKnown: raw.attempt.retryKnown, passed: raw.attempt.passed }) };
  if (raw.type === "phoneSessionRead" && (raw.session === "SessionSignedIn" || raw.session === "SessionSignedOut" || raw.session === "SessionUnreadable")) return { type: "phoneSessionRead", session: raw.session };
  if (raw.type === "submitNewNumber" && typeof raw.numberValid === "boolean") return { type: "submitNewNumber", numberValid: raw.numberValid };
  if (raw.type === "answerNumberStart" && (raw.startAnswer === "PhoneStartSent" || raw.startAnswer === "PhoneStartInvalidPhone" || raw.startAnswer === "PhoneStartSameNumber" || raw.startAnswer === "PhoneStartNoPerson" || raw.startAnswer === "PhoneStartReauth" || raw.startAnswer === "PhoneStartReview" || raw.startAnswer === "PhoneStartRateLimited" || raw.startAnswer === "PhoneStartSignedOut" || raw.startAnswer === "PhoneStartFailed" || raw.startAnswer === "PhoneStartUnreachable") && typeof raw.retryKnown === "boolean") return { type: "answerNumberStart", startAnswer: raw.startAnswer, retryKnown: raw.retryKnown };
  if (raw.type === "submitChangeCode" && Number.isSafeInteger(raw.codeDigits)) return { type: "submitChangeCode", codeDigits: raw.codeDigits };
  if (raw.type === "answerNumberConfirm" && (raw.confirmAnswer === "PhoneConfirmMoved" || raw.confirmAnswer === "PhoneConfirmInvalidCode" || raw.confirmAnswer === "PhoneConfirmNoPerson" || raw.confirmAnswer === "PhoneConfirmReview" || raw.confirmAnswer === "PhoneConfirmNoPending" || raw.confirmAnswer === "PhoneConfirmNumberInUse" || raw.confirmAnswer === "PhoneConfirmSignedOut" || raw.confirmAnswer === "PhoneConfirmFailed" || raw.confirmAnswer === "PhoneConfirmUnreachable")) return { type: "answerNumberConfirm", confirmAnswer: raw.confirmAnswer };
  if (raw.type === "resendChangeCode") return { type: "resendChangeCode" };
  if (raw.type === "changeNewNumber") return { type: "changeNewNumber" };
  if (raw.type === "answerChangeResend" && (raw.startAnswer === "PhoneStartSent" || raw.startAnswer === "PhoneStartInvalidPhone" || raw.startAnswer === "PhoneStartSameNumber" || raw.startAnswer === "PhoneStartNoPerson" || raw.startAnswer === "PhoneStartReauth" || raw.startAnswer === "PhoneStartReview" || raw.startAnswer === "PhoneStartRateLimited" || raw.startAnswer === "PhoneStartSignedOut" || raw.startAnswer === "PhoneStartFailed" || raw.startAnswer === "PhoneStartUnreachable") && typeof raw.retryKnown === "boolean") return { type: "answerChangeResend", startAnswer: raw.startAnswer, retryKnown: raw.retryKnown };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): PhonePage | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.screen === "PhoneOpening" || raw.screen === "PhoneLoading" || raw.screen === "PhoneSignIn" || raw.screen === "PhoneChecking" || raw.screen === "PhoneNewNumber" || raw.screen === "PhoneCode" || raw.screen === "PhoneDone" || raw.screen === "PhoneHeld") && typeof raw.signIn === "object" && raw.signIn !== null && !Array.isArray(raw.signIn) && (raw.signIn.auth === "SignInModePending" || raw.signIn.auth === "SignInOtp" || raw.signIn.auth === "SignInCloud") && (raw.signIn.stage === "SignInNumber" || raw.signIn.stage === "SignInCode" || raw.signIn.stage === "SignInVerified" || raw.signIn.stage === "SignInLeftForCloud") && (raw.signIn.pending === "SignInIdle" || raw.signIn.pending === "SignInStarting" || raw.signIn.pending === "SignInVerifying" || raw.signIn.pending === "SignInResending" || raw.signIn.pending === "SignInOpeningCloud") && (raw.signIn.check === "NoCheck" || raw.signIn.check === "CheckRunning" || raw.signIn.check === "CheckPassed" || raw.signIn.check === "CheckBroken") && typeof raw.signIn.checkOn === "boolean" && (raw.signIn.error === "SignInNoError" || raw.signIn.error === "SignInInvalidPhone" || raw.signIn.error === "SignInCheckPending" || raw.signIn.error === "SignInCheckFailed" || raw.signIn.error === "SignInCheckRejected" || raw.signIn.error === "SignInCheckAgain" || raw.signIn.error === "SignInRateLimited" || raw.signIn.error === "SignInCodeFormat" || raw.signIn.error === "SignInWrongCode" || raw.signIn.error === "SignInNewCodeSent" || raw.signIn.error === "SignInCloudUnavailable" || raw.signIn.error === "SignInRequestFailed") && typeof raw.signIn.retryKnown === "boolean" && Object.keys(raw.signIn).length === 7 && (raw.pending === "PhoneIdle" || raw.pending === "PhoneStarting" || raw.pending === "PhoneConfirming" || raw.pending === "PhoneResending") && (raw.error === "PhoneNoError" || raw.error === "PhoneInvalidNumber" || raw.error === "PhoneSameNumber" || raw.error === "PhoneRateLimited" || raw.error === "PhoneCodeFormat" || raw.error === "PhoneWrongCode" || raw.error === "PhoneStartAgain" || raw.error === "PhoneNumberInUse" || raw.error === "PhoneNewCodeSent" || raw.error === "PhoneRequestFailed") && (raw.notice === "NoStepNotice" || raw.notice === "StepUnreachable" || raw.notice === "StepSessionEnded" || raw.notice === "StepSignInAgain" || raw.notice === "StepSignInExpired" || raw.notice === "StepSignInRefused" || raw.notice === "StepSignInUnavailable") && typeof raw.changeStarted === "boolean" && typeof raw.moved === "boolean" && typeof raw.doneSignedOut === "boolean" && typeof raw.retryKnown === "boolean" && Object.keys(raw).length === 9)) return undefined;
  const parsed: PhonePage = ({ screen: raw.screen, signIn: ({ auth: raw.signIn.auth, stage: raw.signIn.stage, pending: raw.signIn.pending, check: raw.signIn.check, checkOn: raw.signIn.checkOn, error: raw.signIn.error, retryKnown: raw.signIn.retryKnown }), pending: raw.pending, error: raw.error, notice: raw.notice, changeStarted: raw.changeStarted, moved: raw.moved, doneSignedOut: raw.doneSignedOut, retryKnown: raw.retryKnown });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): PhonePage {
  //@ ensures inv(\result)
  return initial;
}
