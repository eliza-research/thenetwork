// GENERATED from spec/homeHelpPage.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type StepNotice as oneStepPage_StepNotice, type StepSession as oneStepPage_StepSession, type CloudReturn as oneStepPage_CloudReturn, type SignInAuth as oneStepPage_SignInAuth, type SignInStage as oneStepPage_SignInStage, type SignInPending as oneStepPage_SignInPending, type SignInCheck as oneStepPage_SignInCheck, type SignInError as oneStepPage_SignInError, type SignInLookup as oneStepPage_SignInLookup, type SignInAnswer as oneStepPage_SignInAnswer, type SignInAttemptKind as oneStepPage_SignInAttemptKind, type OneStepKind as oneStepPage_OneStepKind, type StepSignIn as oneStepPage_StepSignIn, type SignInAttempt as oneStepPage_SignInAttempt, photoPagePurposeHeader as oneStepPage_photoPagePurposeHeader, signInCodeAccepted as oneStepPage_signInCodeAccepted, retryMinutesShown as oneStepPage_retryMinutesShown, signInAttemptAllowed as oneStepPage_signInAttemptAllowed, signInBusy as oneStepPage_signInBusy, signInSpent as oneStepPage_signInSpent, signInStartError as oneStepPage_signInStartError, photoPagePurpose as oneStepPage_photoPagePurpose, lawCodeNeedsFourToEightDigits as oneStepPage_lawCodeNeedsFourToEightDigits, signInConsistent as oneStepPage_signInConsistent, oneStepLinkInFragment as oneStepPage_oneStepLinkInFragment, oneStepLinkMayBeKept as oneStepPage_oneStepLinkMayBeKept, oneStepNoticeShown as oneStepPage_oneStepNoticeShown, noticeForSession as oneStepPage_noticeForSession, noticeForCloudReturn as oneStepPage_noticeForCloudReturn, lawRetryIsAtLeastOneMinute as oneStepPage_lawRetryIsAtLeastOneMinute, lawRetryIsNeverShorterThanTheWait as oneStepPage_lawRetryIsNeverShorterThanTheWait, oneStepIsPhoto as oneStepPage_oneStepIsPhoto, signInStart as oneStepPage_signInStart, signInAttemptNone as oneStepPage_signInAttemptNone, signInAuthFor as oneStepPage_signInAuthFor, signInCheckFor as oneStepPage_signInCheckFor, signInShowsNumberForm as oneStepPage_signInShowsNumberForm, signInShowsCloudButton as oneStepPage_signInShowsCloudButton, signInWaiting as oneStepPage_signInWaiting, signInSettledError as oneStepPage_signInSettledError, signInAgain as oneStepPage_signInAgain, lawOnlyPhotoLinkPagesNameAPurpose as oneStepPage_lawOnlyPhotoLinkPagesNameAPurpose, oneStepNeedsSignIn as oneStepPage_oneStepNeedsSignIn, lawKeptLinkIsInTheFragment as oneStepPage_lawKeptLinkIsInTheFragment, lawSignedInHasNoNotice as oneStepPage_lawSignedInHasNoNotice, noticeOnOpen as oneStepPage_noticeOnOpen, lawEveryCloudErrorShowsANotice as oneStepPage_lawEveryCloudErrorShowsANotice, oneStepOnSite as oneStepPage_oneStepOnSite, lawOnlyCloudLookupUsesCloud as oneStepPage_lawOnlyCloudLookupUsesCloud, lawCheckOnlyWithTextCodes as oneStepPage_lawCheckOnlyWithTextCodes, lawPhotoStepsOnlyOnSlop as oneStepPage_lawPhotoStepsOnlyOnSlop, lawHomeHelpOnlyOnHub as oneStepPage_lawHomeHelpOnlyOnHub, lawPhoneChangeOnEverySite as oneStepPage_lawPhoneChangeOnEverySite, lawSignInAgainKeepsTheMode as oneStepPage_lawSignInAgainKeepsTheMode, lawPhotoTokenIsNeverKept as oneStepPage_lawPhotoTokenIsNeverKept, lawSignInAgainIsConsistent as oneStepPage_lawSignInAgainIsConsistent, lawSessionHidesTheCloudError as oneStepPage_lawSessionHidesTheCloudError, lawPhotoUploadOnlyOnSlop as oneStepPage_lawPhotoUploadOnlyOnSlop, signInMove as oneStepPage_signInMove, lawInvalidNumberIsNeverSent as oneStepPage_lawInvalidNumberIsNeverSent, lawEveryStartAnswerSpendsTheCheck as oneStepPage_lawEveryStartAnswerSpendsTheCheck, lawShortCodeIsNeverSent as oneStepPage_lawShortCodeIsNeverSent, lawEveryAllowedMoveStaysConsistent as oneStepPage_lawEveryAllowedMoveStaysConsistent } from "./oneStepPage.ts";
import { type JoinMode as brandIdentity_JoinMode, type AccentTokens as brandIdentity_AccentTokens, type Accent as brandIdentity_Accent, type Surface as brandIdentity_Surface, type AppKey as brandIdentity_AppKey, type LogoMark as brandIdentity_LogoMark, type SharedPart as brandIdentity_SharedPart, type Brand as brandIdentity_Brand } from "./brandIdentity.ts";

/** Story: Open the home-help step from my link / The page reads the plan code and the revision from the fragment, and a bad link stops the page (spec/homeHelpPage.md) */
export type HelpRole = "HelpRoleUnknown" | "HelpRoleRequester" | "HelpRoleHelper";
/** Story: Open the home-help step from my link / The page reads the plan code and the revision from the fragment, and a bad link stops the page (spec/homeHelpPage.md) */
export type HelpLinkSource = "LinkFromAddress" | "LinkFromKept" | "LinkMissing";
/** Story: Open the home-help step from my link / The page reads the plan code and the revision from the fragment, and a bad link stops the page (spec/homeHelpPage.md) */
export type HelpScreen = "HelpOpening" | "HelpBadLink" | "HelpLoading" | "HelpSignIn" | "HelpChecking" | "HelpChoose" | "HelpAddress" | "HelpSaved" | "HelpRevealed" | "HelpRemoved" | "HelpClosed" | "HelpUnavailable";
/** Story: Open the home-help step from my link / The page reads the plan code and the revision from the fragment, and a bad link stops the page (spec/homeHelpPage.md) */
export type HelpPlanCode = "PlanCodeShort" | "PlanCodeUuid" | "PlanCodeBad";
/** Story: Open the home-help step from my link / The page reads the plan code and the revision from the fragment, and a bad link stops the page (spec/homeHelpPage.md) */
export type HelpPending = "HelpIdle" | "HelpSubmitting" | "HelpRevealing" | "HelpRevoking";
/** Story: Open the home-help step from my link / The page reads the plan code and the revision from the fragment, and a bad link stops the page (spec/homeHelpPage.md) */
export type HelpError = "HelpNoError" | "HelpAddressEmpty" | "HelpAddressTooLong" | "HelpAddressBadChars" | "HelpTryLater" | "HelpRequestFailed";
/** Story: Open the home-help step from my link / The page reads the plan code and the revision from the fragment, and a bad link stops the page (spec/homeHelpPage.md) */
export interface HomeHelpPage { screen: HelpScreen; signIn: oneStepPage_StepSignIn; pending: HelpPending; error: HelpError; notice: oneStepPage_StepNotice; role: HelpRole; linkKept: boolean; addressHeld: boolean }
/** Story: Open the home-help step from my link / The page reads the session and shows the choice step or the sign-in step (spec/homeHelpPage.md) */
export type HelpStatus = "StatusRequester" | "StatusRequesterSaved" | "StatusHelper" | "StatusClosed" | "StatusUnknown";
/** Story: Add or remove my address as the requester / Only an address that passes the check goes to the server (spec/homeHelpPage.md) */
export type HelpAddressCheck = "AddressOk" | "AddressEmpty" | "AddressTooLong" | "AddressBadChars";
/** Story: See the result of each action / The server answer decides the result step (spec/homeHelpPage.md) */
export type HelpVenueAnswer = "VenueStored" | "VenueRevealed" | "VenueRemoved" | "VenueSignedOut" | "VenueClosed" | "VenueNotWired" | "VenueServerError" | "VenueFailed" | "VenueUnreachable";

/** One variant per transition in the spec. */
export type Event =
  | { type: "openHomeHelpPage"; source: HelpLinkSource; wellFormed: boolean }
  | { type: "homeHelpLoaded"; session: oneStepPage_StepSession; status: HelpStatus; cloudReturn: oneStepPage_CloudReturn }
  | { type: "moveSignIn"; attempt: oneStepPage_SignInAttempt }
  | { type: "homeHelpSessionRead"; session: oneStepPage_StepSession; status: HelpStatus }
  | { type: "chooseAdd" }
  | { type: "backToChoices" }
  | { type: "submitAddress"; addressCheck: HelpAddressCheck }
  | { type: "askRevoke" }
  | { type: "askReveal" }
  | { type: "answerVenue"; venueAnswer: HelpVenueAnswer };

/** Story: Open the home-help step from my link / The page reads the plan code and the revision from the fragment, and a bad link stops the page (spec/homeHelpPage.md) */
export const homeHelpRevisionMax: number = 2147483647;
/** Story: Open the home-help step from my link / The page reads the plan code and the revision from the fragment, and a bad link stops the page (spec/homeHelpPage.md) */
export const homeHelpRevisionDigitsMax: number = 10;
/** Story: Add or remove my address as the requester / Only an address that passes the check goes to the server (spec/homeHelpPage.md) */
export const homeHelpAddressMax: number = 300;
/** Story: Open the home-help step from my link / The page reads the plan code and the revision from the fragment, and a bad link stops the page (spec/homeHelpPage.md) */
export const initial: HomeHelpPage = { screen: "HelpOpening", signIn: oneStepPage_signInStart, pending: "HelpIdle", error: "HelpNoError", notice: "NoStepNotice", role: "HelpRoleUnknown", linkKept: false, addressHeld: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: HomeHelpPage): boolean {
  return alwaysNoRequestWithoutLink(current) && alwaysSignInConsistent(current) && alwaysKeptOnlyForCloud(current) && alwaysAddressFormOnlyForAdder(current) && alwaysAddressOnlyWhenRevealed(current) && alwaysRequestBelongsToItsScreen(current) && alwaysActionsFitTheRole(current);
}

/** Story: Open the home-help step from my link / The page reads the plan code and the revision from the fragment, and a bad link stops the page (spec/homeHelpPage.md) */
//@ pure
export function homeHelpRevisionAccepted(digitsOnly: boolean, digitCount: number, revision: number): boolean {
  return digitsOnly && digitCount >= 1 && digitCount <= homeHelpRevisionDigitsMax && revision >= 1 && revision <= homeHelpRevisionMax;
}

/** Story: Open the home-help step from my link / The page reads the plan code and the revision from the fragment, and a bad link stops the page (spec/homeHelpPage.md) */
//@ pure
export function homeHelpLinkWellFormed(code: HelpPlanCode, revisionOk: boolean): boolean {
  return code !== "PlanCodeBad" && revisionOk;
}

/** Story: Open the home-help step from my link / The page reads the plan code and the revision from the fragment, and a bad link stops the page (spec/homeHelpPage.md) */
//@ pure
export function lawRevisionWithinRange(digitsOnly: boolean, digitCount: number, revision: number): boolean {
  //@ ensures \result === true
  return !homeHelpRevisionAccepted(digitsOnly, digitCount, revision) || (revision >= 1 && revision <= homeHelpRevisionMax && digitCount <= homeHelpRevisionDigitsMax);
}

/** Story: Open the home-help step from my link / The page reads the plan code and the revision from the fragment, and a bad link stops the page (spec/homeHelpPage.md) */
//@ pure
export function canOpenHomeHelpPage(p: HomeHelpPage): boolean {
  return p.screen === "HelpOpening";
}

/** Story: Open the home-help step from my link / The page reads the plan code and the revision from the fragment, and a bad link stops the page (spec/homeHelpPage.md) */
//@ pure
export function openHomeHelpPage(p: HomeHelpPage, source: HelpLinkSource, wellFormed: boolean): HomeHelpPage {
  //@ ensures (inv(p) && canOpenHomeHelpPage(p)) ==> alwaysNoRequestWithoutLink(\result)
  //@ ensures (inv(p) && canOpenHomeHelpPage(p)) ==> alwaysSignInConsistent(\result)
  //@ ensures (inv(p) && canOpenHomeHelpPage(p)) ==> alwaysKeptOnlyForCloud(\result)
  //@ ensures (inv(p) && canOpenHomeHelpPage(p)) ==> alwaysAddressFormOnlyForAdder(\result)
  //@ ensures (inv(p) && canOpenHomeHelpPage(p)) ==> alwaysAddressOnlyWhenRevealed(\result)
  //@ ensures (inv(p) && canOpenHomeHelpPage(p)) ==> alwaysRequestBelongsToItsScreen(\result)
  //@ ensures (inv(p) && canOpenHomeHelpPage(p)) ==> alwaysActionsFitTheRole(\result)
  //@ ensures (inv(p) && canOpenHomeHelpPage(p)) ==> stepBadLinkIsFinal(p, \result)
  //@ ensures (inv(p) && canOpenHomeHelpPage(p)) ==> stepLinkKeptOnlyWhenLeavingForCloud(p, "openHomeHelpPage", \result)
  //@ ensures (inv(p) && canOpenHomeHelpPage(p)) ==> stepAddressRevealedOnlyByReveal(p, "openHomeHelpPage", \result)
  //@ ensures (inv(p) && canOpenHomeHelpPage(p)) ==> stepOneRequestAtATime(p, \result)
  return source === "LinkMissing" || !wellFormed ? ({ ...p, screen: "HelpBadLink" } as HomeHelpPage) : ({ ...p, screen: "HelpLoading" } as HomeHelpPage);
}

/** Story: Open the home-help step from my link / The page reads the plan code and the revision from the fragment, and a bad link stops the page (spec/homeHelpPage.md) */
//@ pure
export function lawBadPlanCodeIsNeverWellFormed(revisionOk: boolean): boolean {
  //@ ensures \result === true
  return !homeHelpLinkWellFormed("PlanCodeBad", revisionOk);
}

/** Story: Open the home-help step from my link / The page reads the plan code and the revision from the fragment, and a bad link stops the page (spec/homeHelpPage.md) */
//@ pure
export function lawBadLinkNeverLoads(source: HelpLinkSource, wellFormed: boolean): boolean {
  //@ ensures \result === true
  return !(source === "LinkMissing" || !wellFormed) || openHomeHelpPage(initial, source, wellFormed).screen === "HelpBadLink";
}

/** Story: Open the home-help step from my link / A page with a bad link sends no request and starts no sign-in (spec/homeHelpPage.md) */
//@ pure
export function alwaysNoRequestWithoutLink(p: HomeHelpPage): boolean {
  return !(p.screen === "HelpOpening" || p.screen === "HelpBadLink") || (p.pending === "HelpIdle" && equal_homeHelpPage(p.signIn, oneStepPage_signInStart) && p.role === "HelpRoleUnknown" && !p.linkKept);
}

/** Story: Open the home-help step from my link / A page with a bad link sends no request and starts no sign-in (spec/homeHelpPage.md) */
//@ pure
export function stepBadLinkIsFinal(before: HomeHelpPage, after: HomeHelpPage): boolean {
  return !(before.screen === "HelpBadLink") || equal_homeHelpPage(after, before);
}

/** Story: Open the home-help step from my link / The page reads the session and shows the choice step or the sign-in step (spec/homeHelpPage.md) */
//@ pure
export function helpRoleOf(status: HelpStatus): HelpRole {
  return status === "StatusRequester" || status === "StatusRequesterSaved" ? "HelpRoleRequester" : (status === "StatusHelper" ? "HelpRoleHelper" : "HelpRoleUnknown");
}

/** Story: Open the home-help step from my link / The page reads the session and shows the choice step or the sign-in step (spec/homeHelpPage.md) */
//@ pure
export function helpScreenOf(status: HelpStatus): HelpScreen {
  return status === "StatusRequester" ? "HelpAddress" : (status === "StatusRequesterSaved" ? "HelpSaved" : (status === "StatusClosed" ? "HelpClosed" : "HelpChoose"));
}

/** Story: Open the home-help step from my link / The page reads the session and shows the choice step or the sign-in step (spec/homeHelpPage.md) */
//@ pure
export function lawHelperNeverGetsTheForm(status: HelpStatus): boolean {
  //@ ensures \result === true
  return !(helpRoleOf(status) === "HelpRoleHelper") || helpScreenOf(status) !== "HelpAddress";
}

/** Story: Open the home-help step from my link / The page reads the session and shows the choice step or the sign-in step (spec/homeHelpPage.md) */
//@ pure
export function lawStatusGivesTheAddressToNobody(status: HelpStatus): boolean {
  //@ ensures \result === true
  return helpScreenOf(status) !== "HelpRevealed";
}

/** Story: Open the home-help step from my link / The page reads the session and shows the choice step or the sign-in step (spec/homeHelpPage.md) */
//@ pure
export function lawOnlyAClosedStatusCloses(status: HelpStatus): boolean {
  //@ ensures \result === true
  return (helpScreenOf(status) === "HelpClosed") === (status === "StatusClosed");
}

/** Story: Open the home-help step from my link / The page reads the session and shows the choice step or the sign-in step (spec/homeHelpPage.md) */
//@ pure
export function canHomeHelpLoaded(p: HomeHelpPage): boolean {
  return p.screen === "HelpLoading";
}

/** Story: Open the home-help step from my link / The page reads the session and shows the choice step or the sign-in step (spec/homeHelpPage.md) */
//@ pure
export function homeHelpLoaded(p: HomeHelpPage, session: oneStepPage_StepSession, status: HelpStatus, cloudReturn: oneStepPage_CloudReturn): HomeHelpPage {
  //@ ensures (inv(p) && canHomeHelpLoaded(p)) ==> alwaysNoRequestWithoutLink(\result)
  //@ ensures (inv(p) && canHomeHelpLoaded(p)) ==> alwaysSignInConsistent(\result)
  //@ ensures (inv(p) && canHomeHelpLoaded(p)) ==> alwaysKeptOnlyForCloud(\result)
  //@ ensures (inv(p) && canHomeHelpLoaded(p)) ==> alwaysAddressFormOnlyForAdder(\result)
  //@ ensures (inv(p) && canHomeHelpLoaded(p)) ==> alwaysAddressOnlyWhenRevealed(\result)
  //@ ensures (inv(p) && canHomeHelpLoaded(p)) ==> alwaysRequestBelongsToItsScreen(\result)
  //@ ensures (inv(p) && canHomeHelpLoaded(p)) ==> alwaysActionsFitTheRole(\result)
  //@ ensures (inv(p) && canHomeHelpLoaded(p)) ==> stepBadLinkIsFinal(p, \result)
  //@ ensures (inv(p) && canHomeHelpLoaded(p)) ==> stepLinkKeptOnlyWhenLeavingForCloud(p, "homeHelpLoaded", \result)
  //@ ensures (inv(p) && canHomeHelpLoaded(p)) ==> stepAddressRevealedOnlyByReveal(p, "homeHelpLoaded", \result)
  //@ ensures (inv(p) && canHomeHelpLoaded(p)) ==> stepOneRequestAtATime(p, \result)
  return session === "SessionSignedIn" ? ({ ...p, screen: helpScreenOf(status), role: helpRoleOf(status), notice: "NoStepNotice" } as HomeHelpPage) : ({ ...p, screen: "HelpSignIn", notice: oneStepPage_noticeOnOpen(session, cloudReturn) } as HomeHelpPage);
}

/** Story: Open the home-help step from my link / The page reads the session and shows the choice step or the sign-in step (spec/homeHelpPage.md) */
//@ pure
export function helpWaiting(p: HomeHelpPage): boolean {
  return p.screen === "HelpOpening" || p.screen === "HelpLoading" || p.screen === "HelpChecking";
}

/** Story: Confirm my number on the home-help page / The page signs the person in with the shared sign-in steps and keeps the link for Cloud sign-in (spec/homeHelpPage.md) */
//@ pure
export function canMoveSignIn(p: HomeHelpPage, attempt: oneStepPage_SignInAttempt): boolean {
  return oneStepPage_signInAttemptAllowed(p.signIn, attempt) && p.screen === "HelpSignIn";
}

/** Story: Confirm my number on the home-help page / The page signs the person in with the shared sign-in steps and keeps the link for Cloud sign-in (spec/homeHelpPage.md) */
//@ pure
export function moveSignIn(p: HomeHelpPage, attempt: oneStepPage_SignInAttempt): HomeHelpPage {
  //@ ensures (inv(p) && canMoveSignIn(p, attempt)) ==> alwaysNoRequestWithoutLink(\result)
  //@ ensures (inv(p) && canMoveSignIn(p, attempt)) ==> alwaysSignInConsistent(\result)
  //@ ensures (inv(p) && canMoveSignIn(p, attempt)) ==> alwaysKeptOnlyForCloud(\result)
  //@ ensures (inv(p) && canMoveSignIn(p, attempt)) ==> alwaysAddressFormOnlyForAdder(\result)
  //@ ensures (inv(p) && canMoveSignIn(p, attempt)) ==> alwaysAddressOnlyWhenRevealed(\result)
  //@ ensures (inv(p) && canMoveSignIn(p, attempt)) ==> alwaysRequestBelongsToItsScreen(\result)
  //@ ensures (inv(p) && canMoveSignIn(p, attempt)) ==> alwaysActionsFitTheRole(\result)
  //@ ensures (inv(p) && canMoveSignIn(p, attempt)) ==> stepBadLinkIsFinal(p, \result)
  //@ ensures (inv(p) && canMoveSignIn(p, attempt)) ==> stepLinkKeptOnlyWhenLeavingForCloud(p, "moveSignIn", \result)
  //@ ensures (inv(p) && canMoveSignIn(p, attempt)) ==> stepAddressRevealedOnlyByReveal(p, "moveSignIn", \result)
  //@ ensures (inv(p) && canMoveSignIn(p, attempt)) ==> stepOneRequestAtATime(p, \result)
  const local_0: oneStepPage_StepSignIn = oneStepPage_signInMove(p.signIn, attempt);
  return { ...p, signIn: local_0, screen: local_0.stage === "SignInVerified" ? "HelpChecking" : p.screen, linkKept: local_0.stage === "SignInLeftForCloud" };
}

/** Story: Confirm my number on the home-help page / The page signs the person in with the shared sign-in steps and keeps the link for Cloud sign-in (spec/homeHelpPage.md) */
//@ pure
export function alwaysSignInConsistent(p: HomeHelpPage): boolean {
  return oneStepPage_signInConsistent(p.signIn);
}

/** Story: Confirm my number on the home-help page / The page signs the person in with the shared sign-in steps and keeps the link for Cloud sign-in (spec/homeHelpPage.md) */
//@ pure
export function alwaysKeptOnlyForCloud(p: HomeHelpPage): boolean {
  return !p.linkKept || p.signIn.stage === "SignInLeftForCloud";
}

/** Story: Confirm my number on the home-help page / The page signs the person in with the shared sign-in steps and keeps the link for Cloud sign-in (spec/homeHelpPage.md) */
//@ pure
export function stepLinkKeptOnlyWhenLeavingForCloud(before: HomeHelpPage, via: string, after: HomeHelpPage): boolean {
  return !(after.linkKept && !before.linkKept) || via === "moveSignIn";
}

/** Story: Confirm my number on the home-help page / After sign-in the page reads the session again (spec/homeHelpPage.md) */
//@ pure
export function canHomeHelpSessionRead(p: HomeHelpPage): boolean {
  return p.screen === "HelpChecking";
}

/** Story: Confirm my number on the home-help page / After sign-in the page reads the session again (spec/homeHelpPage.md) */
//@ pure
export function homeHelpSessionRead(p: HomeHelpPage, session: oneStepPage_StepSession, status: HelpStatus): HomeHelpPage {
  //@ ensures (inv(p) && canHomeHelpSessionRead(p)) ==> alwaysNoRequestWithoutLink(\result)
  //@ ensures (inv(p) && canHomeHelpSessionRead(p)) ==> alwaysSignInConsistent(\result)
  //@ ensures (inv(p) && canHomeHelpSessionRead(p)) ==> alwaysKeptOnlyForCloud(\result)
  //@ ensures (inv(p) && canHomeHelpSessionRead(p)) ==> alwaysAddressFormOnlyForAdder(\result)
  //@ ensures (inv(p) && canHomeHelpSessionRead(p)) ==> alwaysAddressOnlyWhenRevealed(\result)
  //@ ensures (inv(p) && canHomeHelpSessionRead(p)) ==> alwaysRequestBelongsToItsScreen(\result)
  //@ ensures (inv(p) && canHomeHelpSessionRead(p)) ==> alwaysActionsFitTheRole(\result)
  //@ ensures (inv(p) && canHomeHelpSessionRead(p)) ==> stepBadLinkIsFinal(p, \result)
  //@ ensures (inv(p) && canHomeHelpSessionRead(p)) ==> stepLinkKeptOnlyWhenLeavingForCloud(p, "homeHelpSessionRead", \result)
  //@ ensures (inv(p) && canHomeHelpSessionRead(p)) ==> stepAddressRevealedOnlyByReveal(p, "homeHelpSessionRead", \result)
  //@ ensures (inv(p) && canHomeHelpSessionRead(p)) ==> stepOneRequestAtATime(p, \result)
  return session === "SessionSignedIn" ? ({ ...p, screen: helpScreenOf(status), role: helpRoleOf(status), notice: "NoStepNotice" } as HomeHelpPage) : ({ ...p, screen: "HelpSignIn", signIn: oneStepPage_signInAgain(p.signIn), linkKept: false, notice: session === "SessionUnreadable" ? "StepUnreachable" : "StepSessionEnded" } as HomeHelpPage);
}

/** Story: Add or remove my address as the requester / The choice step offers only the actions that the role allows (spec/homeHelpPage.md) */
//@ pure
export function mayAdd(role: HelpRole): boolean {
  return role !== "HelpRoleHelper";
}

/** Story: Add or remove my address as the requester / The choice step offers only the actions that the role allows (spec/homeHelpPage.md) */
//@ pure
export function mayShow(role: HelpRole): boolean {
  return role !== "HelpRoleRequester";
}

/** Story: Add or remove my address as the requester / The choice step offers only the actions that the role allows (spec/homeHelpPage.md) */
//@ pure
export function mayRemove(role: HelpRole): boolean {
  return role !== "HelpRoleHelper";
}

/** Story: Add or remove my address as the requester / The choice step offers only the actions that the role allows (spec/homeHelpPage.md) */
//@ pure
export function helpBusy(p: HomeHelpPage): boolean {
  return p.pending !== "HelpIdle";
}

/** Story: Add or remove my address as the requester / The choice step offers only the actions that the role allows (spec/homeHelpPage.md) */
//@ pure
export function helpOffersAdd(p: HomeHelpPage): boolean {
  return p.screen === "HelpChoose" && mayAdd(p.role);
}

/** Story: Add or remove my address as the requester / The choice step offers only the actions that the role allows (spec/homeHelpPage.md) */
//@ pure
export function helpOffersShow(p: HomeHelpPage): boolean {
  return p.screen === "HelpChoose" && mayShow(p.role);
}

/** Story: Add or remove my address as the requester / The choice step offers only the actions that the role allows (spec/homeHelpPage.md) */
//@ pure
export function helpOffersRemove(p: HomeHelpPage): boolean {
  return (p.screen === "HelpChoose" || p.screen === "HelpSaved") && mayRemove(p.role);
}

/** Story: Add or remove my address as the requester / The choice step offers only the actions that the role allows (spec/homeHelpPage.md) */
//@ pure
export function canChooseAdd(p: HomeHelpPage): boolean {
  return p.screen === "HelpChoose" && p.pending === "HelpIdle" && mayAdd(p.role);
}

/** Story: Add or remove my address as the requester / The choice step offers only the actions that the role allows (spec/homeHelpPage.md) */
//@ pure
export function chooseAdd(p: HomeHelpPage): HomeHelpPage {
  //@ ensures (inv(p) && canChooseAdd(p)) ==> alwaysNoRequestWithoutLink(\result)
  //@ ensures (inv(p) && canChooseAdd(p)) ==> alwaysSignInConsistent(\result)
  //@ ensures (inv(p) && canChooseAdd(p)) ==> alwaysKeptOnlyForCloud(\result)
  //@ ensures (inv(p) && canChooseAdd(p)) ==> alwaysAddressFormOnlyForAdder(\result)
  //@ ensures (inv(p) && canChooseAdd(p)) ==> alwaysAddressOnlyWhenRevealed(\result)
  //@ ensures (inv(p) && canChooseAdd(p)) ==> alwaysRequestBelongsToItsScreen(\result)
  //@ ensures (inv(p) && canChooseAdd(p)) ==> alwaysActionsFitTheRole(\result)
  //@ ensures (inv(p) && canChooseAdd(p)) ==> stepBadLinkIsFinal(p, \result)
  //@ ensures (inv(p) && canChooseAdd(p)) ==> stepLinkKeptOnlyWhenLeavingForCloud(p, "chooseAdd", \result)
  //@ ensures (inv(p) && canChooseAdd(p)) ==> stepAddressRevealedOnlyByReveal(p, "chooseAdd", \result)
  //@ ensures (inv(p) && canChooseAdd(p)) ==> stepOneRequestAtATime(p, \result)
  return { ...p, screen: "HelpAddress", error: "HelpNoError", notice: "NoStepNotice" };
}

/** Story: Add or remove my address as the requester / The choice step offers only the actions that the role allows (spec/homeHelpPage.md) */
//@ pure
export function canBackToChoices(p: HomeHelpPage): boolean {
  return p.screen === "HelpAddress" && p.pending === "HelpIdle";
}

/** Story: Add or remove my address as the requester / The choice step offers only the actions that the role allows (spec/homeHelpPage.md) */
//@ pure
export function backToChoices(p: HomeHelpPage): HomeHelpPage {
  //@ ensures (inv(p) && canBackToChoices(p)) ==> alwaysNoRequestWithoutLink(\result)
  //@ ensures (inv(p) && canBackToChoices(p)) ==> alwaysSignInConsistent(\result)
  //@ ensures (inv(p) && canBackToChoices(p)) ==> alwaysKeptOnlyForCloud(\result)
  //@ ensures (inv(p) && canBackToChoices(p)) ==> alwaysAddressFormOnlyForAdder(\result)
  //@ ensures (inv(p) && canBackToChoices(p)) ==> alwaysAddressOnlyWhenRevealed(\result)
  //@ ensures (inv(p) && canBackToChoices(p)) ==> alwaysRequestBelongsToItsScreen(\result)
  //@ ensures (inv(p) && canBackToChoices(p)) ==> alwaysActionsFitTheRole(\result)
  //@ ensures (inv(p) && canBackToChoices(p)) ==> stepBadLinkIsFinal(p, \result)
  //@ ensures (inv(p) && canBackToChoices(p)) ==> stepLinkKeptOnlyWhenLeavingForCloud(p, "backToChoices", \result)
  //@ ensures (inv(p) && canBackToChoices(p)) ==> stepAddressRevealedOnlyByReveal(p, "backToChoices", \result)
  //@ ensures (inv(p) && canBackToChoices(p)) ==> stepOneRequestAtATime(p, \result)
  return { ...p, screen: "HelpChoose", error: "HelpNoError", notice: "NoStepNotice" };
}

/** Story: Add or remove my address as the requester / The choice step offers only the actions that the role allows (spec/homeHelpPage.md) */
//@ pure
export function alwaysAddressFormOnlyForAdder(p: HomeHelpPage): boolean {
  return !(p.screen === "HelpAddress") || mayAdd(p.role);
}

/** Story: Add or remove my address as the requester / The choice step offers only the actions that the role allows (spec/homeHelpPage.md) */
//@ pure
export function lawHelperCannotAdd(p: HomeHelpPage): boolean {
  //@ ensures \result === true
  return !(p.role === "HelpRoleHelper") || !canChooseAdd(p);
}

/** Story: Add or remove my address as the requester / Only an address that passes the check goes to the server (spec/homeHelpPage.md) */
//@ pure
export function addressError(addressCheck: HelpAddressCheck): HelpError {
  return addressCheck === "AddressEmpty" ? "HelpAddressEmpty" : (addressCheck === "AddressTooLong" ? "HelpAddressTooLong" : (addressCheck === "AddressBadChars" ? "HelpAddressBadChars" : "HelpNoError"));
}

/** Story: Add or remove my address as the requester / Only an address that passes the check goes to the server (spec/homeHelpPage.md) */
//@ pure
export function homeHelpAddressCheck(trimmedEmpty: boolean, charCount: number, byteCount: number, badChars: boolean): HelpAddressCheck {
  return trimmedEmpty ? "AddressEmpty" : (badChars ? "AddressBadChars" : (charCount > homeHelpAddressMax || byteCount > homeHelpAddressMax ? "AddressTooLong" : "AddressOk"));
}

/** Story: Add or remove my address as the requester / Only an address that passes the check goes to the server (spec/homeHelpPage.md) */
//@ pure
export function canSubmitAddress(p: HomeHelpPage): boolean {
  return p.screen === "HelpAddress" && p.pending === "HelpIdle";
}

/** Story: Add or remove my address as the requester / Only an address that passes the check goes to the server (spec/homeHelpPage.md) */
//@ pure
export function submitAddress(p: HomeHelpPage, addressCheck: HelpAddressCheck): HomeHelpPage {
  //@ ensures (inv(p) && canSubmitAddress(p)) ==> alwaysNoRequestWithoutLink(\result)
  //@ ensures (inv(p) && canSubmitAddress(p)) ==> alwaysSignInConsistent(\result)
  //@ ensures (inv(p) && canSubmitAddress(p)) ==> alwaysKeptOnlyForCloud(\result)
  //@ ensures (inv(p) && canSubmitAddress(p)) ==> alwaysAddressFormOnlyForAdder(\result)
  //@ ensures (inv(p) && canSubmitAddress(p)) ==> alwaysAddressOnlyWhenRevealed(\result)
  //@ ensures (inv(p) && canSubmitAddress(p)) ==> alwaysRequestBelongsToItsScreen(\result)
  //@ ensures (inv(p) && canSubmitAddress(p)) ==> alwaysActionsFitTheRole(\result)
  //@ ensures (inv(p) && canSubmitAddress(p)) ==> stepBadLinkIsFinal(p, \result)
  //@ ensures (inv(p) && canSubmitAddress(p)) ==> stepLinkKeptOnlyWhenLeavingForCloud(p, "submitAddress", \result)
  //@ ensures (inv(p) && canSubmitAddress(p)) ==> stepAddressRevealedOnlyByReveal(p, "submitAddress", \result)
  //@ ensures (inv(p) && canSubmitAddress(p)) ==> stepOneRequestAtATime(p, \result)
  return addressCheck === "AddressOk" ? ({ ...p, pending: "HelpSubmitting", error: "HelpNoError", notice: "NoStepNotice" } as HomeHelpPage) : ({ ...p, error: addressError(addressCheck) } as HomeHelpPage);
}

/** Story: Add or remove my address as the requester / Only an address that passes the check goes to the server (spec/homeHelpPage.md) */
//@ pure
export function lawAddressOverLimitIsRefused(charCount: number, byteCount: number, badChars: boolean): boolean {
  //@ ensures \result === true
  return !(charCount > homeHelpAddressMax || byteCount > homeHelpAddressMax) || homeHelpAddressCheck(false, charCount, byteCount, badChars) !== "AddressOk";
}

/** Story: Add or remove my address as the requester / Only an address that passes the check goes to the server (spec/homeHelpPage.md) */
//@ pure
export function lawEmptyAddressIsRefused(charCount: number, byteCount: number, badChars: boolean): boolean {
  //@ ensures \result === true
  return homeHelpAddressCheck(true, charCount, byteCount, badChars) === "AddressEmpty";
}

/** Story: Add or remove my address as the requester / Only an address that passes the check goes to the server (spec/homeHelpPage.md) */
//@ pure
export function lawBadAddressIsNeverSent(p: HomeHelpPage, addressCheck: HelpAddressCheck): boolean {
  //@ ensures \result === true
  return !(addressCheck !== "AddressOk") || submitAddress(p, addressCheck).pending === p.pending;
}

/** Story: Add or remove my address as the requester / The requester can remove the address from the choice step or the saved step (spec/homeHelpPage.md) */
//@ pure
export function canAskRevoke(p: HomeHelpPage): boolean {
  return (p.screen === "HelpChoose" || p.screen === "HelpSaved") && p.pending === "HelpIdle" && mayRemove(p.role);
}

/** Story: Add or remove my address as the requester / The requester can remove the address from the choice step or the saved step (spec/homeHelpPage.md) */
//@ pure
export function askRevoke(p: HomeHelpPage): HomeHelpPage {
  //@ ensures (inv(p) && canAskRevoke(p)) ==> alwaysNoRequestWithoutLink(\result)
  //@ ensures (inv(p) && canAskRevoke(p)) ==> alwaysSignInConsistent(\result)
  //@ ensures (inv(p) && canAskRevoke(p)) ==> alwaysKeptOnlyForCloud(\result)
  //@ ensures (inv(p) && canAskRevoke(p)) ==> alwaysAddressFormOnlyForAdder(\result)
  //@ ensures (inv(p) && canAskRevoke(p)) ==> alwaysAddressOnlyWhenRevealed(\result)
  //@ ensures (inv(p) && canAskRevoke(p)) ==> alwaysRequestBelongsToItsScreen(\result)
  //@ ensures (inv(p) && canAskRevoke(p)) ==> alwaysActionsFitTheRole(\result)
  //@ ensures (inv(p) && canAskRevoke(p)) ==> stepBadLinkIsFinal(p, \result)
  //@ ensures (inv(p) && canAskRevoke(p)) ==> stepLinkKeptOnlyWhenLeavingForCloud(p, "askRevoke", \result)
  //@ ensures (inv(p) && canAskRevoke(p)) ==> stepAddressRevealedOnlyByReveal(p, "askRevoke", \result)
  //@ ensures (inv(p) && canAskRevoke(p)) ==> stepOneRequestAtATime(p, \result)
  return { ...p, pending: "HelpRevoking", error: "HelpNoError", notice: "NoStepNotice" };
}

/** Story: Read the address as a helper / The helper asks for the address, and only the answer to that request shows it (spec/homeHelpPage.md) */
//@ pure
export function canAskReveal(p: HomeHelpPage): boolean {
  return p.screen === "HelpChoose" && p.pending === "HelpIdle" && mayShow(p.role);
}

/** Story: Read the address as a helper / The helper asks for the address, and only the answer to that request shows it (spec/homeHelpPage.md) */
//@ pure
export function askReveal(p: HomeHelpPage): HomeHelpPage {
  //@ ensures (inv(p) && canAskReveal(p)) ==> alwaysNoRequestWithoutLink(\result)
  //@ ensures (inv(p) && canAskReveal(p)) ==> alwaysSignInConsistent(\result)
  //@ ensures (inv(p) && canAskReveal(p)) ==> alwaysKeptOnlyForCloud(\result)
  //@ ensures (inv(p) && canAskReveal(p)) ==> alwaysAddressFormOnlyForAdder(\result)
  //@ ensures (inv(p) && canAskReveal(p)) ==> alwaysAddressOnlyWhenRevealed(\result)
  //@ ensures (inv(p) && canAskReveal(p)) ==> alwaysRequestBelongsToItsScreen(\result)
  //@ ensures (inv(p) && canAskReveal(p)) ==> alwaysActionsFitTheRole(\result)
  //@ ensures (inv(p) && canAskReveal(p)) ==> stepBadLinkIsFinal(p, \result)
  //@ ensures (inv(p) && canAskReveal(p)) ==> stepLinkKeptOnlyWhenLeavingForCloud(p, "askReveal", \result)
  //@ ensures (inv(p) && canAskReveal(p)) ==> stepAddressRevealedOnlyByReveal(p, "askReveal", \result)
  //@ ensures (inv(p) && canAskReveal(p)) ==> stepOneRequestAtATime(p, \result)
  return { ...p, pending: "HelpRevealing", error: "HelpNoError", notice: "NoStepNotice" };
}

/** Story: Read the address as a helper / The helper asks for the address, and only the answer to that request shows it (spec/homeHelpPage.md) */
//@ pure
export function alwaysAddressOnlyWhenRevealed(p: HomeHelpPage): boolean {
  return p.addressHeld === (p.screen === "HelpRevealed");
}

/** Story: Read the address as a helper / The helper asks for the address, and only the answer to that request shows it (spec/homeHelpPage.md) */
//@ pure
export function stepAddressRevealedOnlyByReveal(before: HomeHelpPage, via: string, after: HomeHelpPage): boolean {
  return !(after.addressHeld && !before.addressHeld) || (via === "answerVenue" && before.pending === "HelpRevealing");
}

/** Story: Read the address as a helper / The helper asks for the address, and only the answer to that request shows it (spec/homeHelpPage.md) */
//@ pure
export function lawRequesterCannotShow(p: HomeHelpPage): boolean {
  //@ ensures \result === true
  return !(p.role === "HelpRoleRequester") || !canAskReveal(p);
}

/** Story: Read the address as a helper / The helper asks for the address, and only the answer to that request shows it (spec/homeHelpPage.md) */
//@ pure
export function lawEachOfferedActionIsEnabled(p: HomeHelpPage): boolean {
  //@ ensures \result === true
  return !(p.pending === "HelpIdle") || (helpOffersAdd(p) === canChooseAdd(p) && helpOffersShow(p) === canAskReveal(p) && helpOffersRemove(p) === canAskRevoke(p));
}

/** Story: See the result of each action / The server answer decides the result step (spec/homeHelpPage.md) */
//@ pure
export function venueAnswerFits(pending: HelpPending, venueAnswer: HelpVenueAnswer): boolean {
  return (venueAnswer === "VenueStored" && pending === "HelpSubmitting") || (venueAnswer === "VenueRevealed" && pending === "HelpRevealing") || (venueAnswer === "VenueRemoved" && pending === "HelpRevoking");
}

/** Story: See the result of each action / The server answer decides the result step (spec/homeHelpPage.md) */
//@ pure
export function canAnswerVenue(p: HomeHelpPage): boolean {
  return p.pending !== "HelpIdle";
}

/** Story: See the result of each action / The server answer decides the result step (spec/homeHelpPage.md) */
//@ pure
export function answerVenue(p: HomeHelpPage, venueAnswer: HelpVenueAnswer): HomeHelpPage {
  //@ ensures (inv(p) && canAnswerVenue(p)) ==> alwaysNoRequestWithoutLink(\result)
  //@ ensures (inv(p) && canAnswerVenue(p)) ==> alwaysSignInConsistent(\result)
  //@ ensures (inv(p) && canAnswerVenue(p)) ==> alwaysKeptOnlyForCloud(\result)
  //@ ensures (inv(p) && canAnswerVenue(p)) ==> alwaysAddressFormOnlyForAdder(\result)
  //@ ensures (inv(p) && canAnswerVenue(p)) ==> alwaysAddressOnlyWhenRevealed(\result)
  //@ ensures (inv(p) && canAnswerVenue(p)) ==> alwaysRequestBelongsToItsScreen(\result)
  //@ ensures (inv(p) && canAnswerVenue(p)) ==> alwaysActionsFitTheRole(\result)
  //@ ensures (inv(p) && canAnswerVenue(p)) ==> stepBadLinkIsFinal(p, \result)
  //@ ensures (inv(p) && canAnswerVenue(p)) ==> stepLinkKeptOnlyWhenLeavingForCloud(p, "answerVenue", \result)
  //@ ensures (inv(p) && canAnswerVenue(p)) ==> stepAddressRevealedOnlyByReveal(p, "answerVenue", \result)
  //@ ensures (inv(p) && canAnswerVenue(p)) ==> stepOneRequestAtATime(p, \result)
  const local_1: HomeHelpPage = { ...p, pending: "HelpIdle" };
  return venueAnswerFits(p.pending, venueAnswer) && venueAnswer === "VenueStored" ? ({ ...local_1, screen: "HelpSaved", error: "HelpNoError" } as HomeHelpPage) : (venueAnswerFits(p.pending, venueAnswer) && venueAnswer === "VenueRevealed" ? ({ ...local_1, screen: "HelpRevealed", addressHeld: true, error: "HelpNoError" } as HomeHelpPage) : (venueAnswerFits(p.pending, venueAnswer) && venueAnswer === "VenueRemoved" ? ({ ...local_1, screen: "HelpRemoved", error: "HelpNoError" } as HomeHelpPage) : (venueAnswer === "VenueSignedOut" ? ({ ...local_1, screen: "HelpSignIn", signIn: oneStepPage_signInAgain(p.signIn), linkKept: false, notice: "StepSessionEnded", error: "HelpNoError" } as HomeHelpPage) : (venueAnswer === "VenueClosed" ? ({ ...local_1, screen: "HelpClosed", error: "HelpNoError" } as HomeHelpPage) : (venueAnswer === "VenueNotWired" ? ({ ...local_1, screen: "HelpUnavailable", error: "HelpNoError" } as HomeHelpPage) : (venueAnswer === "VenueServerError" ? ({ ...local_1, error: "HelpTryLater" } as HomeHelpPage) : (venueAnswer === "VenueUnreachable" ? ({ ...local_1, notice: "StepUnreachable", error: "HelpNoError" } as HomeHelpPage) : ({ ...local_1, error: "HelpRequestFailed" } as HomeHelpPage))))))));
}

/** Story: See the result of each action / The server answer decides the result step (spec/homeHelpPage.md) */
//@ pure
export function lawMisfitAnswerIsAFailure(p: HomeHelpPage): boolean {
  //@ ensures \result === true
  return !(p.pending === "HelpRevealing") || answerVenue(p, "VenueStored").error === "HelpRequestFailed";
}

/** Story: Send each action only once / A request that waits for an answer refuses a second action (spec/homeHelpPage.md) */
//@ pure
export function stepOneRequestAtATime(before: HomeHelpPage, after: HomeHelpPage): boolean {
  return !(after.pending !== "HelpIdle" && after.pending !== before.pending) || before.pending === "HelpIdle";
}

/** Story: Send each action only once / A request that waits for an answer refuses a second action (spec/homeHelpPage.md) */
//@ pure
export function alwaysRequestBelongsToItsScreen(p: HomeHelpPage): boolean {
  return (!(p.pending === "HelpSubmitting") || p.screen === "HelpAddress") && (!(p.pending === "HelpRevealing") || p.screen === "HelpChoose") && (!(p.pending === "HelpRevoking") || (p.screen === "HelpChoose" || p.screen === "HelpSaved"));
}

/** Story: Send each action only once / A request that waits for an answer refuses a second action (spec/homeHelpPage.md) */
//@ pure
export function alwaysActionsFitTheRole(p: HomeHelpPage): boolean {
  return (!(p.pending === "HelpSubmitting") || mayAdd(p.role)) && (!(p.pending === "HelpRevealing") || mayShow(p.role)) && (!(p.pending === "HelpRevoking") || mayRemove(p.role));
}

/** Story: Reach every outcome / A person can save, read or remove the address, find the step closed, or see each error (spec/homeHelpPage.md) */
//@ pure
export function sometimesSaved(p: HomeHelpPage): boolean {
  return p.screen === "HelpSaved";
}

/** Story: Reach every outcome / A person can save, read or remove the address, find the step closed, or see each error (spec/homeHelpPage.md) */
//@ pure
export function sometimesRevealed(p: HomeHelpPage): boolean {
  return p.screen === "HelpRevealed" && p.addressHeld;
}

/** Story: Reach every outcome / A person can save, read or remove the address, find the step closed, or see each error (spec/homeHelpPage.md) */
//@ pure
export function sometimesRemoved(p: HomeHelpPage): boolean {
  return p.screen === "HelpRemoved";
}

/** Story: Reach every outcome / A person can save, read or remove the address, find the step closed, or see each error (spec/homeHelpPage.md) */
//@ pure
export function sometimesClosed(p: HomeHelpPage): boolean {
  return p.screen === "HelpClosed";
}

/** Story: Reach every outcome / A person can save, read or remove the address, find the step closed, or see each error (spec/homeHelpPage.md) */
//@ pure
export function sometimesUnavailable(p: HomeHelpPage): boolean {
  return p.screen === "HelpUnavailable";
}

/** Story: Reach every outcome / A person can save, read or remove the address, find the step closed, or see each error (spec/homeHelpPage.md) */
//@ pure
export function sometimesBadLink(p: HomeHelpPage): boolean {
  return p.screen === "HelpBadLink";
}

/** Story: Reach every outcome / A person can save, read or remove the address, find the step closed, or see each error (spec/homeHelpPage.md) */
//@ pure
export function sometimesLeftForCloud(p: HomeHelpPage): boolean {
  return p.signIn.stage === "SignInLeftForCloud" && p.linkKept;
}

/** Story: Reach every outcome / A person can save, read or remove the address, find the step closed, or see each error (spec/homeHelpPage.md) */
//@ pure
export function sometimesTryLater(p: HomeHelpPage): boolean {
  return p.error === "HelpTryLater";
}

/** Story: Reach every outcome / A person can save, read or remove the address, find the step closed, or see each error (spec/homeHelpPage.md) */
//@ pure
export function sometimesRequestFailed(p: HomeHelpPage): boolean {
  return p.error === "HelpRequestFailed";
}

/** Story: Reach every outcome / A person can save, read or remove the address, find the step closed, or see each error (spec/homeHelpPage.md) */
//@ pure
export function sometimesAddressTooLong(p: HomeHelpPage): boolean {
  return p.screen === "HelpAddress" && p.error === "HelpAddressTooLong";
}

/** Story: Reach every outcome / A person can save, read or remove the address, find the step closed, or see each error (spec/homeHelpPage.md) */
//@ pure
export function sometimesAddressEmpty(p: HomeHelpPage): boolean {
  return p.screen === "HelpAddress" && p.error === "HelpAddressEmpty";
}

/** Story: Reach every outcome / A person can save, read or remove the address, find the step closed, or see each error (spec/homeHelpPage.md) */
//@ pure
export function sometimesAddressBadChars(p: HomeHelpPage): boolean {
  return p.screen === "HelpAddress" && p.error === "HelpAddressBadChars";
}

/** Story: Reach every outcome / A person can save, read or remove the address, find the step closed, or see each error (spec/homeHelpPage.md) */
//@ pure
export function sometimesUnreachable(p: HomeHelpPage): boolean {
  return p.screen === "HelpChoose" && p.notice === "StepUnreachable";
}

/** Story: Reach every outcome / A person can save, read or remove the address, find the step closed, or see each error (spec/homeHelpPage.md) */
//@ pure
export function sometimesSessionEnded(p: HomeHelpPage): boolean {
  return p.screen === "HelpSignIn" && p.notice === "StepSessionEnded";
}

/** Story: Reach every outcome / A person can save, read or remove the address, find the step closed, or see each error (spec/homeHelpPage.md) */
//@ pure
export function sometimesSignedInAfterSignIn(p: HomeHelpPage): boolean {
  return p.screen === "HelpChoose" && p.signIn.stage === "SignInVerified";
}

/** Story: Reach every outcome / A person can save, read or remove the address, find the step closed, or see each error (spec/homeHelpPage.md) */
//@ pure
export function sometimesKnownRoleRequester(p: HomeHelpPage): boolean {
  return p.screen === "HelpChoose" && p.role === "HelpRoleRequester";
}

/** Story: Reach every outcome / A person can save, read or remove the address, find the step closed, or see each error (spec/homeHelpPage.md) */
//@ pure
export function sometimesKnownRoleHelper(p: HomeHelpPage): boolean {
  return p.screen === "HelpChoose" && p.role === "HelpRoleHelper";
}

/** Story: Reach every outcome / A person can save, read or remove the address, find the step closed, or see each error (spec/homeHelpPage.md) */
//@ pure
export function sometimesRemovedAsKnownRequester(p: HomeHelpPage): boolean {
  return p.screen === "HelpRemoved" && p.role === "HelpRoleRequester";
}

/** Story: Reach every outcome / A person can save, read or remove the address, find the step closed, or see each error (spec/homeHelpPage.md) */
//@ pure
export function sometimesSavedFromTheStatus(p: HomeHelpPage): boolean {
  return p.screen === "HelpSaved" && p.pending === "HelpIdle" && p.role === "HelpRoleRequester";
}

/** Story: Reach every outcome / A person can save, read or remove the address, find the step closed, or see each error (spec/homeHelpPage.md) */
//@ pure
export function sometimesClosedFromTheStatus(p: HomeHelpPage): boolean {
  return p.screen === "HelpClosed" && p.role === "HelpRoleUnknown";
}

/** Story: Reach every outcome / A person can save, read or remove the address, find the step closed, or see each error (spec/homeHelpPage.md) */
//@ pure
export function sometimesUnknownRole(p: HomeHelpPage): boolean {
  return p.screen === "HelpChoose" && p.role === "HelpRoleUnknown";
}

/** Story: Reach every outcome / A person can save, read or remove the address, find the step closed, or see each error (spec/homeHelpPage.md) */
//@ pure
export function sometimesCloudSignInRefused(p: HomeHelpPage): boolean {
  return p.screen === "HelpSignIn" && p.notice === "StepSignInRefused";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: HomeHelpPage, event: Event): boolean {
  if (event.type === "openHomeHelpPage") return canOpenHomeHelpPage(current);
  if (event.type === "homeHelpLoaded") return canHomeHelpLoaded(current);
  if (event.type === "moveSignIn") return canMoveSignIn(current, event.attempt);
  if (event.type === "homeHelpSessionRead") return canHomeHelpSessionRead(current);
  if (event.type === "chooseAdd") return canChooseAdd(current);
  if (event.type === "backToChoices") return canBackToChoices(current);
  if (event.type === "submitAddress") return canSubmitAddress(current);
  if (event.type === "askRevoke") return canAskRevoke(current);
  if (event.type === "askReveal") return canAskReveal(current);
  if (event.type === "answerVenue") return canAnswerVenue(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: HomeHelpPage, event: Event): HomeHelpPage {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "openHomeHelpPage") return canOpenHomeHelpPage(current) ? openHomeHelpPage(current, event.source, event.wellFormed) : current;
  if (event.type === "homeHelpLoaded") return canHomeHelpLoaded(current) ? homeHelpLoaded(current, event.session, event.status, event.cloudReturn) : current;
  if (event.type === "moveSignIn") return canMoveSignIn(current, event.attempt) ? moveSignIn(current, event.attempt) : current;
  if (event.type === "homeHelpSessionRead") return canHomeHelpSessionRead(current) ? homeHelpSessionRead(current, event.session, event.status) : current;
  if (event.type === "chooseAdd") return canChooseAdd(current) ? chooseAdd(current) : current;
  if (event.type === "backToChoices") return canBackToChoices(current) ? backToChoices(current) : current;
  if (event.type === "submitAddress") return canSubmitAddress(current) ? submitAddress(current, event.addressCheck) : current;
  if (event.type === "askRevoke") return canAskRevoke(current) ? askRevoke(current) : current;
  if (event.type === "askReveal") return canAskReveal(current) ? askReveal(current) : current;
  if (event.type === "answerVenue") return canAnswerVenue(current) ? answerVenue(current, event.venueAnswer) : current;
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
  if (raw.type === "openHomeHelpPage" && (raw.source === "LinkFromAddress" || raw.source === "LinkFromKept" || raw.source === "LinkMissing") && typeof raw.wellFormed === "boolean") return { type: "openHomeHelpPage", source: raw.source, wellFormed: raw.wellFormed };
  if (raw.type === "homeHelpLoaded" && (raw.session === "SessionSignedIn" || raw.session === "SessionSignedOut" || raw.session === "SessionUnreadable") && (raw.status === "StatusRequester" || raw.status === "StatusRequesterSaved" || raw.status === "StatusHelper" || raw.status === "StatusClosed" || raw.status === "StatusUnknown") && (raw.cloudReturn === "CloudReturnNone" || raw.cloudReturn === "CloudReturnExpired" || raw.cloudReturn === "CloudReturnRefused" || raw.cloudReturn === "CloudReturnUnavailable")) return { type: "homeHelpLoaded", session: raw.session, status: raw.status, cloudReturn: raw.cloudReturn };
  if (raw.type === "moveSignIn" && is_oneStepPage_SignInAttempt(raw.attempt)) return { type: "moveSignIn", attempt: ({ kind: raw.attempt.kind, lookup: raw.attempt.lookup, checkOn: raw.attempt.checkOn, valid: raw.attempt.valid, digits: raw.attempt.digits, answer: raw.attempt.answer, retryKnown: raw.attempt.retryKnown, passed: raw.attempt.passed }) };
  if (raw.type === "homeHelpSessionRead" && (raw.session === "SessionSignedIn" || raw.session === "SessionSignedOut" || raw.session === "SessionUnreadable") && (raw.status === "StatusRequester" || raw.status === "StatusRequesterSaved" || raw.status === "StatusHelper" || raw.status === "StatusClosed" || raw.status === "StatusUnknown")) return { type: "homeHelpSessionRead", session: raw.session, status: raw.status };
  if (raw.type === "chooseAdd") return { type: "chooseAdd" };
  if (raw.type === "backToChoices") return { type: "backToChoices" };
  if (raw.type === "submitAddress" && (raw.addressCheck === "AddressOk" || raw.addressCheck === "AddressEmpty" || raw.addressCheck === "AddressTooLong" || raw.addressCheck === "AddressBadChars")) return { type: "submitAddress", addressCheck: raw.addressCheck };
  if (raw.type === "askRevoke") return { type: "askRevoke" };
  if (raw.type === "askReveal") return { type: "askReveal" };
  if (raw.type === "answerVenue" && (raw.venueAnswer === "VenueStored" || raw.venueAnswer === "VenueRevealed" || raw.venueAnswer === "VenueRemoved" || raw.venueAnswer === "VenueSignedOut" || raw.venueAnswer === "VenueClosed" || raw.venueAnswer === "VenueNotWired" || raw.venueAnswer === "VenueServerError" || raw.venueAnswer === "VenueFailed" || raw.venueAnswer === "VenueUnreachable")) return { type: "answerVenue", venueAnswer: raw.venueAnswer };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): HomeHelpPage | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.screen === "HelpOpening" || raw.screen === "HelpBadLink" || raw.screen === "HelpLoading" || raw.screen === "HelpSignIn" || raw.screen === "HelpChecking" || raw.screen === "HelpChoose" || raw.screen === "HelpAddress" || raw.screen === "HelpSaved" || raw.screen === "HelpRevealed" || raw.screen === "HelpRemoved" || raw.screen === "HelpClosed" || raw.screen === "HelpUnavailable") && typeof raw.signIn === "object" && raw.signIn !== null && !Array.isArray(raw.signIn) && (raw.signIn.auth === "SignInModePending" || raw.signIn.auth === "SignInOtp" || raw.signIn.auth === "SignInCloud") && (raw.signIn.stage === "SignInNumber" || raw.signIn.stage === "SignInCode" || raw.signIn.stage === "SignInVerified" || raw.signIn.stage === "SignInLeftForCloud") && (raw.signIn.pending === "SignInIdle" || raw.signIn.pending === "SignInStarting" || raw.signIn.pending === "SignInVerifying" || raw.signIn.pending === "SignInResending" || raw.signIn.pending === "SignInOpeningCloud") && (raw.signIn.check === "NoCheck" || raw.signIn.check === "CheckRunning" || raw.signIn.check === "CheckPassed" || raw.signIn.check === "CheckBroken") && typeof raw.signIn.checkOn === "boolean" && (raw.signIn.error === "SignInNoError" || raw.signIn.error === "SignInInvalidPhone" || raw.signIn.error === "SignInCheckPending" || raw.signIn.error === "SignInCheckFailed" || raw.signIn.error === "SignInCheckRejected" || raw.signIn.error === "SignInCheckAgain" || raw.signIn.error === "SignInRateLimited" || raw.signIn.error === "SignInCodeFormat" || raw.signIn.error === "SignInWrongCode" || raw.signIn.error === "SignInNewCodeSent" || raw.signIn.error === "SignInCloudUnavailable" || raw.signIn.error === "SignInRequestFailed") && typeof raw.signIn.retryKnown === "boolean" && Object.keys(raw.signIn).length === 7 && (raw.pending === "HelpIdle" || raw.pending === "HelpSubmitting" || raw.pending === "HelpRevealing" || raw.pending === "HelpRevoking") && (raw.error === "HelpNoError" || raw.error === "HelpAddressEmpty" || raw.error === "HelpAddressTooLong" || raw.error === "HelpAddressBadChars" || raw.error === "HelpTryLater" || raw.error === "HelpRequestFailed") && (raw.notice === "NoStepNotice" || raw.notice === "StepUnreachable" || raw.notice === "StepSessionEnded" || raw.notice === "StepSignInAgain" || raw.notice === "StepSignInExpired" || raw.notice === "StepSignInRefused" || raw.notice === "StepSignInUnavailable") && (raw.role === "HelpRoleUnknown" || raw.role === "HelpRoleRequester" || raw.role === "HelpRoleHelper") && typeof raw.linkKept === "boolean" && typeof raw.addressHeld === "boolean" && Object.keys(raw).length === 8)) return undefined;
  const parsed: HomeHelpPage = ({ screen: raw.screen, signIn: ({ auth: raw.signIn.auth, stage: raw.signIn.stage, pending: raw.signIn.pending, check: raw.signIn.check, checkOn: raw.signIn.checkOn, error: raw.signIn.error, retryKnown: raw.signIn.retryKnown }), pending: raw.pending, error: raw.error, notice: raw.notice, role: raw.role, linkKept: raw.linkKept, addressHeld: raw.addressHeld });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): HomeHelpPage {
  //@ ensures inv(\result)
  return initial;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_homeHelpPage(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_homeHelpPage((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
