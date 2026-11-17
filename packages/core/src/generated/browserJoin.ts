// GENERATED from spec/browserJoin.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Open the join page from my agent's link / The page takes the approved name and age from the fragment and then removes the fragment (spec/browserJoin.md) */
export type JoinScreen = "Opening" | "Loading" | "Phone" | "Code" | "Checking" | "Profile" | "Member" | "Blocked" | "Done" | "LeftForCloud";
/** Story: Open the join page from my agent's link / The page takes the approved name and age from the fragment and then removes the fragment (spec/browserJoin.md) */
export type BlockReason = "NoBlock" | "UnderAge" | "InviteOnly" | "InReview" | "NotValid" | "OtherReason";
/** Story: Open the join page from my agent's link / The page takes the approved name and age from the fragment and then removes the fragment (spec/browserJoin.md) */
export type FlowNotice = "NoNotice" | "ApiUnreachable" | "SessionEnded" | "AccountChanged";
/** Story: Open the join page from my agent's link / The page takes the approved name and age from the fragment and then removes the fragment (spec/browserJoin.md) */
export type InlineError = "NoError" | "InvalidPhone" | "CheckPending" | "CheckFailed" | "CheckRejected" | "CheckAgain" | "RateLimited" | "CodeFormat" | "InvalidCode" | "NewCodeSent" | "ProfileIncomplete" | "CloudUnavailable" | "RequestFailed";
/** Story: Open the join page from my agent's link / The page takes the approved name and age from the fragment and then removes the fragment (spec/browserJoin.md) */
export type AuthMode = "AuthPending" | "OtpMode" | "CloudMode";
/** Story: Open the join page from my agent's link / The page takes the approved name and age from the fragment and then removes the fragment (spec/browserJoin.md) */
export type CheckState = "NoCheck" | "CheckRunning" | "CheckPassed" | "CheckBroken";
/** Story: Open the join page from my agent's link / The page takes the approved name and age from the fragment and then removes the fragment (spec/browserJoin.md) */
export type Pending = "Idle" | "StartingCode" | "VerifyingCode" | "ResendingCode" | "SavingProfile" | "OpeningCloud";
/** Story: Open the join page from my agent's link / The page takes the approved name and age from the fragment and then removes the fragment (spec/browserJoin.md) */
export interface JoinPage { screen: JoinScreen; auth: AuthMode; check: CheckState; pending: Pending; reason: BlockReason; notice: FlowNotice; formError: InlineError; account: number; inviteOnly: boolean; viaAgent: boolean; addressClean: boolean; formHasValues: boolean; consented: boolean }
/** Story: See where I stand before I do anything / The page shows the step that the current session allows (spec/browserJoin.md) */
export type SessionResult = "SignedOut" | "ReadFailed" | "MayJoin" | "AlreadyIn" | "MayNotJoin";
/** Story: See where I stand before I do anything / The page shows the step that the current session allows (spec/browserJoin.md) */
export interface SessionView { result: SessionResult; account: number; reason: BlockReason }
/** Story: Confirm my own phone / The page asks the server which sign-in to use and uses text codes when it cannot tell (spec/browserJoin.md) */
export type AuthLookup = "LookupFailed" | "ModeOtp" | "ModeCloud";
/** Story: Confirm my own phone / A sent code opens the code step, and each answer uses up the security check (spec/browserJoin.md) */
export type StartResult = "CodeSent" | "StartRateLimited" | "StartCheckRejected" | "StartFailed";
/** Story: Confirm my own phone / Only a well-formed code goes to the server, and only a verified code signs the person in (spec/browserJoin.md) */
export type VerifyResult = "Verified" | "WrongCode" | "VerifyRateLimited" | "VerifyFailed";
/** Story: Confirm my details and join / The page sends the profile only with a name, an age from 1 to 120 and the text consent ticked (spec/browserJoin.md) */
export interface ProfileForm { nameGiven: boolean; age: number; consentTicked: boolean }
/** Story: Confirm my details and join / The server answer decides between done, blocked and a new sign-in (spec/browserJoin.md) */
export type JoinOutcome = "JoinedOk" | "JoinUnderAge" | "JoinInviteOnly" | "JoinReview" | "JoinAccountChanged" | "JoinUnauthorized" | "JoinInvalidInvitation" | "JoinFailed";

/** One variant per transition in the spec. */
export type Event =
  | { type: "openPage"; viaAgent: boolean; fragmentName: boolean; ageDigitsOnly: boolean; ageDigitCount: number; fragmentAge: number }
  | { type: "loaded"; view: SessionView; appUnreachable: boolean; inviteOnly: boolean }
  | { type: "readAuthMode"; lookup: AuthLookup; checkOn: boolean }
  | { type: "expireCheck" }
  | { type: "submitPhone"; phoneValid: boolean }
  | { type: "settleCheck"; passed: boolean }
  | { type: "answerCodeStart"; started: StartResult }
  | { type: "submitCode"; codeDigitCount: number }
  | { type: "answerVerify"; verifyAnswer: VerifyResult }
  | { type: "resendCode" }
  | { type: "changeNumber" }
  | { type: "answerResend"; resent: StartResult }
  | { type: "continueWithPhone" }
  | { type: "answerCloudStart"; opened: boolean }
  | { type: "recheck"; view: SessionView }
  | { type: "editProfile" }
  | { type: "submitProfile"; form: ProfileForm }
  | { type: "answerJoin"; joinAnswer: JoinOutcome }
  | { type: "restoreCloudPrefill"; view: SessionView; fromAgent: boolean; hasFields: boolean };

/** Story: Confirm my own phone / Only a well-formed code goes to the server, and only a verified code signs the person in (spec/browserJoin.md) */
export const codeDigitsMin: number = 4;
/** Story: Confirm my own phone / Only a well-formed code goes to the server, and only a verified code signs the person in (spec/browserJoin.md) */
export const codeDigitsMax: number = 8;
/** Story: Open the join page from my agent's link / The page takes the approved name and age from the fragment and then removes the fragment (spec/browserJoin.md) */
export const fragmentNameMax: number = 50;
/** Story: Open the join page from my agent's link / The page takes the approved name and age from the fragment and then removes the fragment (spec/browserJoin.md) */
export const initial: JoinPage = { screen: "Opening", auth: "AuthPending", check: "NoCheck", pending: "Idle", reason: "NoBlock", notice: "NoNotice", formError: "NoError", account: 0, inviteOnly: false, viaAgent: false, addressClean: false, formHasValues: false, consented: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: JoinPage): boolean {
  return alwaysAddressCleanAfterOpening(current) && alwaysBlockedHasReason(current) && alwaysPhoneStepsHaveNoAccount(current) && alwaysAccountStepsHaveAccount(current) && alwaysCheckOnlyWithTextCodes(current) && alwaysCodeStepUsesTextCodes(current) && alwaysResendWithoutCheckOnly(current) && alwaysDoneNeedsConsent(current) && alwaysRequestBelongsToItsStep(current);
}

/** Story: Open the join page from my agent's link / The page takes the approved name and age from the fragment and then removes the fragment (spec/browserJoin.md) */
//@ pure
export function fragmentAgeAccepted(ageDigitsOnly: boolean, ageDigitCount: number, fragmentAge: number): boolean {
  return ageDigitsOnly && ageDigitCount >= 1 && ageDigitCount <= 3 && fragmentAge <= 120;
}

/** Story: Open the join page from my agent's link / The page takes the approved name and age from the fragment and then removes the fragment (spec/browserJoin.md) */
//@ pure
export function canOpenPage(page: JoinPage): boolean {
  return page.screen === "Opening";
}

/** Story: Open the join page from my agent's link / The page takes the approved name and age from the fragment and then removes the fragment (spec/browserJoin.md) */
//@ pure
export function openPage(page: JoinPage, viaAgent: boolean, fragmentName: boolean, ageDigitsOnly: boolean, ageDigitCount: number, fragmentAge: number): JoinPage {
  //@ ensures (inv(page) && canOpenPage(page)) ==> alwaysAddressCleanAfterOpening(\result)
  //@ ensures (inv(page) && canOpenPage(page)) ==> alwaysBlockedHasReason(\result)
  //@ ensures (inv(page) && canOpenPage(page)) ==> alwaysPhoneStepsHaveNoAccount(\result)
  //@ ensures (inv(page) && canOpenPage(page)) ==> alwaysAccountStepsHaveAccount(\result)
  //@ ensures (inv(page) && canOpenPage(page)) ==> alwaysCheckOnlyWithTextCodes(\result)
  //@ ensures (inv(page) && canOpenPage(page)) ==> alwaysCodeStepUsesTextCodes(\result)
  //@ ensures (inv(page) && canOpenPage(page)) ==> alwaysResendWithoutCheckOnly(\result)
  //@ ensures (inv(page) && canOpenPage(page)) ==> alwaysDoneNeedsConsent(\result)
  //@ ensures (inv(page) && canOpenPage(page)) ==> alwaysRequestBelongsToItsStep(\result)
  //@ ensures (inv(page) && canOpenPage(page)) ==> stepCodeRequestNeedsPassedCheck(page, "openPage", \result)
  //@ ensures (inv(page) && canOpenPage(page)) ==> stepCheckSpentAfterCodeStart(page, "openPage", \result)
  //@ ensures (inv(page) && canOpenPage(page)) ==> stepFormClearedWhenAccountLeaves(page, \result)
  //@ ensures (inv(page) && canOpenPage(page)) ==> stepSignInKeepsFormValues(page, "openPage", \result)
  //@ ensures (inv(page) && canOpenPage(page)) ==> stepDoneFollowsSavedProfile(page, "openPage", \result)
  //@ ensures (inv(page) && canOpenPage(page)) ==> stepOneRequestAtATime(page, \result)
  return { ...page, screen: "Loading", viaAgent: viaAgent, addressClean: true, formHasValues: fragmentName || fragmentAgeAccepted(ageDigitsOnly, ageDigitCount, fragmentAge) };
}

/** Story: Open the join page from my agent's link / The page takes the approved name and age from the fragment and then removes the fragment (spec/browserJoin.md) */
//@ pure
export function alwaysAddressCleanAfterOpening(page: JoinPage): boolean {
  return !(page.screen !== "Opening") || page.addressClean;
}

/** Story: Open the join page from my agent's link / The page takes the approved name and age from the fragment and then removes the fragment (spec/browserJoin.md) */
//@ pure
export function lawFragmentAgeNeverAboveLimit(ageDigitsOnly: boolean, ageDigitCount: number, fragmentAge: number): boolean {
  //@ ensures \result === true
  return !(!ageDigitsOnly || ageDigitCount < 1 || ageDigitCount > 3 || fragmentAge > 120) || !fragmentAgeAccepted(ageDigitsOnly, ageDigitCount, fragmentAge);
}

/** Story: See where I stand before I do anything / The page shows the step that the current session allows (spec/browserJoin.md) */
//@ pure
export function minJoinAgeShown(appRead: boolean, appMinAge: number, pageMinAge: number): number {
  return appRead ? appMinAge : pageMinAge;
}

/** Story: See where I stand before I do anything / The page shows the step that the current session allows (spec/browserJoin.md) */
//@ pure
export function signedInResult(result: SessionResult): boolean {
  return result === "MayJoin" || result === "AlreadyIn" || result === "MayNotJoin";
}

/** Story: See where I stand before I do anything / The page shows the step that the current session allows (spec/browserJoin.md) */
//@ pure
export function screenFor(view: SessionView): JoinScreen {
  return view.result === "MayJoin" ? "Profile" : (view.result === "AlreadyIn" ? "Member" : (view.result === "MayNotJoin" ? "Blocked" : "Phone"));
}

/** Story: See where I stand before I do anything / The page shows the step that the current session allows (spec/browserJoin.md) */
//@ pure
export function blockReasonFor(reason: BlockReason, inviteOnly: boolean): BlockReason {
  return reason === "NoBlock" ? (inviteOnly ? "InviteOnly" : "OtherReason") : reason;
}

/** Story: See where I stand before I do anything / The page shows the step that the current session allows (spec/browserJoin.md) */
//@ pure
export function sessionConsistent(view: SessionView): boolean {
  return signedInResult(view.result) ? view.account > 0 : view.account === 0;
}

/** Story: See where I stand before I do anything / The page shows the step that the current session allows (spec/browserJoin.md) */
//@ pure
export function reasonFor(view: SessionView, inviteOnly: boolean): BlockReason {
  return view.result === "MayNotJoin" ? blockReasonFor(view.reason, inviteOnly) : "NoBlock";
}

/** Story: See where I stand before I do anything / The page shows the step that the current session allows (spec/browserJoin.md) */
//@ pure
export function lawSignedOutSeesPhone(view: SessionView): boolean {
  //@ ensures \result === true
  return !(!signedInResult(view.result)) || screenFor(view) === "Phone";
}

/** Story: See where I stand before I do anything / The page shows the step that the current session allows (spec/browserJoin.md) */
//@ pure
export function lawBlockedAlwaysHasReason(reason: BlockReason, inviteOnly: boolean): boolean {
  //@ ensures \result === true
  return blockReasonFor(reason, inviteOnly) !== "NoBlock";
}

/** Story: See where I stand before I do anything / The page shows the step that the current session allows (spec/browserJoin.md) */
//@ pure
export function routed(view: SessionView, page: JoinPage, inviteOnly: boolean): JoinPage {
  return { ...page, screen: screenFor(view), reason: reasonFor(view, inviteOnly), account: view.account, inviteOnly: inviteOnly, pending: "Idle", formError: "NoError" };
}

/** Story: See where I stand before I do anything / The page shows the step that the current session allows (spec/browserJoin.md) */
//@ pure
export function canLoaded(page: JoinPage, view: SessionView): boolean {
  return page.screen === "Loading" && sessionConsistent(view);
}

/** Story: See where I stand before I do anything / The page shows the step that the current session allows (spec/browserJoin.md) */
//@ pure
export function loaded(page: JoinPage, view: SessionView, appUnreachable: boolean, inviteOnly: boolean): JoinPage {
  //@ ensures (inv(page) && canLoaded(page, view)) ==> alwaysAddressCleanAfterOpening(\result)
  //@ ensures (inv(page) && canLoaded(page, view)) ==> alwaysBlockedHasReason(\result)
  //@ ensures (inv(page) && canLoaded(page, view)) ==> alwaysPhoneStepsHaveNoAccount(\result)
  //@ ensures (inv(page) && canLoaded(page, view)) ==> alwaysAccountStepsHaveAccount(\result)
  //@ ensures (inv(page) && canLoaded(page, view)) ==> alwaysCheckOnlyWithTextCodes(\result)
  //@ ensures (inv(page) && canLoaded(page, view)) ==> alwaysCodeStepUsesTextCodes(\result)
  //@ ensures (inv(page) && canLoaded(page, view)) ==> alwaysResendWithoutCheckOnly(\result)
  //@ ensures (inv(page) && canLoaded(page, view)) ==> alwaysDoneNeedsConsent(\result)
  //@ ensures (inv(page) && canLoaded(page, view)) ==> alwaysRequestBelongsToItsStep(\result)
  //@ ensures (inv(page) && canLoaded(page, view)) ==> stepCodeRequestNeedsPassedCheck(page, "loaded", \result)
  //@ ensures (inv(page) && canLoaded(page, view)) ==> stepCheckSpentAfterCodeStart(page, "loaded", \result)
  //@ ensures (inv(page) && canLoaded(page, view)) ==> stepFormClearedWhenAccountLeaves(page, \result)
  //@ ensures (inv(page) && canLoaded(page, view)) ==> stepSignInKeepsFormValues(page, "loaded", \result)
  //@ ensures (inv(page) && canLoaded(page, view)) ==> stepDoneFollowsSavedProfile(page, "loaded", \result)
  //@ ensures (inv(page) && canLoaded(page, view)) ==> stepOneRequestAtATime(page, \result)
  const local_0: JoinPage = routed(view, page, inviteOnly);
  return { ...local_0, notice: appUnreachable ? "ApiUnreachable" : "NoNotice" };
}

/** Story: See where I stand before I do anything / Only a signed-out page asks for a phone, and only a signed-in page shows a profile (spec/browserJoin.md) */
//@ pure
export function screenHasNoAccount(screen: JoinScreen): boolean {
  return screen === "Opening" || screen === "Loading" || screen === "Phone" || screen === "Code" || screen === "Checking" || screen === "LeftForCloud";
}

/** Story: See where I stand before I do anything / Only a signed-out page asks for a phone, and only a signed-in page shows a profile (spec/browserJoin.md) */
//@ pure
export function alwaysBlockedHasReason(page: JoinPage): boolean {
  return (page.screen === "Blocked") === (page.reason !== "NoBlock");
}

/** Story: See where I stand before I do anything / Only a signed-out page asks for a phone, and only a signed-in page shows a profile (spec/browserJoin.md) */
//@ pure
export function alwaysPhoneStepsHaveNoAccount(page: JoinPage): boolean {
  return !screenHasNoAccount(page.screen) || page.account === 0;
}

/** Story: See where I stand before I do anything / Only a signed-out page asks for a phone, and only a signed-in page shows a profile (spec/browserJoin.md) */
//@ pure
export function alwaysAccountStepsHaveAccount(page: JoinPage): boolean {
  return !(!screenHasNoAccount(page.screen)) || page.account > 0;
}

/** Story: Confirm my own phone / The page asks the server which sign-in to use and uses text codes when it cannot tell (spec/browserJoin.md) */
//@ pure
export function authModeFor(lookup: AuthLookup): AuthMode {
  return lookup === "ModeCloud" ? "CloudMode" : "OtpMode";
}

/** Story: Confirm my own phone / The page asks the server which sign-in to use and uses text codes when it cannot tell (spec/browserJoin.md) */
//@ pure
export function canReadAuthMode(page: JoinPage): boolean {
  return page.auth === "AuthPending" && page.screen !== "Opening" && page.screen !== "Loading";
}

/** Story: Confirm my own phone / The page asks the server which sign-in to use and uses text codes when it cannot tell (spec/browserJoin.md) */
//@ pure
export function phoneFormWaiting(page: JoinPage): boolean {
  return page.screen === "Phone" && page.auth === "AuthPending";
}

/** Story: Confirm my own phone / The page asks the server which sign-in to use and uses text codes when it cannot tell (spec/browserJoin.md) */
//@ pure
export function showsNumberForm(page: JoinPage): boolean {
  return page.screen === "Phone" && page.auth === "OtpMode";
}

/** Story: Confirm my own phone / The page asks the server which sign-in to use and uses text codes when it cannot tell (spec/browserJoin.md) */
//@ pure
export function showsCloudButton(page: JoinPage): boolean {
  return page.screen === "Phone" && page.auth === "CloudMode";
}

/** Story: Confirm my own phone / The page asks the server which sign-in to use and uses text codes when it cannot tell (spec/browserJoin.md) */
//@ pure
export function alwaysCheckOnlyWithTextCodes(page: JoinPage): boolean {
  return !(page.check !== "NoCheck") || page.auth === "OtpMode";
}

/** Story: Confirm my own phone / The page asks the server which sign-in to use and uses text codes when it cannot tell (spec/browserJoin.md) */
//@ pure
export function readAuthMode(page: JoinPage, lookup: AuthLookup, checkOn: boolean): JoinPage {
  //@ ensures (inv(page) && canReadAuthMode(page)) ==> alwaysAddressCleanAfterOpening(\result)
  //@ ensures (inv(page) && canReadAuthMode(page)) ==> alwaysBlockedHasReason(\result)
  //@ ensures (inv(page) && canReadAuthMode(page)) ==> alwaysPhoneStepsHaveNoAccount(\result)
  //@ ensures (inv(page) && canReadAuthMode(page)) ==> alwaysAccountStepsHaveAccount(\result)
  //@ ensures (inv(page) && canReadAuthMode(page)) ==> alwaysCheckOnlyWithTextCodes(\result)
  //@ ensures (inv(page) && canReadAuthMode(page)) ==> alwaysCodeStepUsesTextCodes(\result)
  //@ ensures (inv(page) && canReadAuthMode(page)) ==> alwaysResendWithoutCheckOnly(\result)
  //@ ensures (inv(page) && canReadAuthMode(page)) ==> alwaysDoneNeedsConsent(\result)
  //@ ensures (inv(page) && canReadAuthMode(page)) ==> alwaysRequestBelongsToItsStep(\result)
  //@ ensures (inv(page) && canReadAuthMode(page)) ==> stepCodeRequestNeedsPassedCheck(page, "readAuthMode", \result)
  //@ ensures (inv(page) && canReadAuthMode(page)) ==> stepCheckSpentAfterCodeStart(page, "readAuthMode", \result)
  //@ ensures (inv(page) && canReadAuthMode(page)) ==> stepFormClearedWhenAccountLeaves(page, \result)
  //@ ensures (inv(page) && canReadAuthMode(page)) ==> stepSignInKeepsFormValues(page, "readAuthMode", \result)
  //@ ensures (inv(page) && canReadAuthMode(page)) ==> stepDoneFollowsSavedProfile(page, "readAuthMode", \result)
  //@ ensures (inv(page) && canReadAuthMode(page)) ==> stepOneRequestAtATime(page, \result)
  return { ...page, auth: authModeFor(lookup), check: authModeFor(lookup) === "OtpMode" && checkOn ? "CheckRunning" : "NoCheck" };
}

/** Story: Confirm my own phone / The page asks the server which sign-in to use and uses text codes when it cannot tell (spec/browserJoin.md) */
//@ pure
export function lawOnlyCloudAnswerUsesCloud(lookup: AuthLookup): boolean {
  //@ ensures \result === true
  return (authModeFor(lookup) === "CloudMode") === (lookup === "ModeCloud");
}

/** Story: Confirm my own phone / The page sends a number only when it is valid and the security check passed (spec/browserJoin.md) */
//@ pure
export function canExpireCheck(page: JoinPage): boolean {
  return page.check === "CheckPassed";
}

/** Story: Confirm my own phone / The page sends a number only when it is valid and the security check passed (spec/browserJoin.md) */
//@ pure
export function expireCheck(page: JoinPage): JoinPage {
  //@ ensures (inv(page) && canExpireCheck(page)) ==> alwaysAddressCleanAfterOpening(\result)
  //@ ensures (inv(page) && canExpireCheck(page)) ==> alwaysBlockedHasReason(\result)
  //@ ensures (inv(page) && canExpireCheck(page)) ==> alwaysPhoneStepsHaveNoAccount(\result)
  //@ ensures (inv(page) && canExpireCheck(page)) ==> alwaysAccountStepsHaveAccount(\result)
  //@ ensures (inv(page) && canExpireCheck(page)) ==> alwaysCheckOnlyWithTextCodes(\result)
  //@ ensures (inv(page) && canExpireCheck(page)) ==> alwaysCodeStepUsesTextCodes(\result)
  //@ ensures (inv(page) && canExpireCheck(page)) ==> alwaysResendWithoutCheckOnly(\result)
  //@ ensures (inv(page) && canExpireCheck(page)) ==> alwaysDoneNeedsConsent(\result)
  //@ ensures (inv(page) && canExpireCheck(page)) ==> alwaysRequestBelongsToItsStep(\result)
  //@ ensures (inv(page) && canExpireCheck(page)) ==> stepCodeRequestNeedsPassedCheck(page, "expireCheck", \result)
  //@ ensures (inv(page) && canExpireCheck(page)) ==> stepCheckSpentAfterCodeStart(page, "expireCheck", \result)
  //@ ensures (inv(page) && canExpireCheck(page)) ==> stepFormClearedWhenAccountLeaves(page, \result)
  //@ ensures (inv(page) && canExpireCheck(page)) ==> stepSignInKeepsFormValues(page, "expireCheck", \result)
  //@ ensures (inv(page) && canExpireCheck(page)) ==> stepDoneFollowsSavedProfile(page, "expireCheck", \result)
  //@ ensures (inv(page) && canExpireCheck(page)) ==> stepOneRequestAtATime(page, \result)
  return { ...page, check: "CheckRunning" };
}

/** Story: Confirm my own phone / The page sends a number only when it is valid and the security check passed (spec/browserJoin.md) */
//@ pure
export function canSubmitPhone(page: JoinPage): boolean {
  return page.screen === "Phone" && page.auth === "OtpMode" && page.pending === "Idle";
}

/** Story: Confirm my own phone / The page sends a number only when it is valid and the security check passed (spec/browserJoin.md) */
//@ pure
export function submitPhone(page: JoinPage, phoneValid: boolean): JoinPage {
  //@ ensures (inv(page) && canSubmitPhone(page)) ==> alwaysAddressCleanAfterOpening(\result)
  //@ ensures (inv(page) && canSubmitPhone(page)) ==> alwaysBlockedHasReason(\result)
  //@ ensures (inv(page) && canSubmitPhone(page)) ==> alwaysPhoneStepsHaveNoAccount(\result)
  //@ ensures (inv(page) && canSubmitPhone(page)) ==> alwaysAccountStepsHaveAccount(\result)
  //@ ensures (inv(page) && canSubmitPhone(page)) ==> alwaysCheckOnlyWithTextCodes(\result)
  //@ ensures (inv(page) && canSubmitPhone(page)) ==> alwaysCodeStepUsesTextCodes(\result)
  //@ ensures (inv(page) && canSubmitPhone(page)) ==> alwaysResendWithoutCheckOnly(\result)
  //@ ensures (inv(page) && canSubmitPhone(page)) ==> alwaysDoneNeedsConsent(\result)
  //@ ensures (inv(page) && canSubmitPhone(page)) ==> alwaysRequestBelongsToItsStep(\result)
  //@ ensures (inv(page) && canSubmitPhone(page)) ==> stepCodeRequestNeedsPassedCheck(page, "submitPhone", \result)
  //@ ensures (inv(page) && canSubmitPhone(page)) ==> stepCheckSpentAfterCodeStart(page, "submitPhone", \result)
  //@ ensures (inv(page) && canSubmitPhone(page)) ==> stepFormClearedWhenAccountLeaves(page, \result)
  //@ ensures (inv(page) && canSubmitPhone(page)) ==> stepSignInKeepsFormValues(page, "submitPhone", \result)
  //@ ensures (inv(page) && canSubmitPhone(page)) ==> stepDoneFollowsSavedProfile(page, "submitPhone", \result)
  //@ ensures (inv(page) && canSubmitPhone(page)) ==> stepOneRequestAtATime(page, \result)
  return !phoneValid ? ({ ...page, formError: "InvalidPhone" } as JoinPage) : (page.check === "CheckRunning" ? ({ ...page, formError: "CheckPending" } as JoinPage) : (page.check === "CheckBroken" ? ({ ...page, formError: "CheckFailed" } as JoinPage) : ({ ...page, pending: "StartingCode", formError: "NoError" } as JoinPage)));
}

/** Story: Confirm my own phone / The page sends a number only when it is valid and the security check passed (spec/browserJoin.md) */
//@ pure
export function stepCodeRequestNeedsPassedCheck(before: JoinPage, via: string, after: JoinPage): boolean {
  return !(via === "submitPhone" && after.pending === "StartingCode") || (before.check === "CheckPassed" || before.check === "NoCheck");
}

/** Story: Confirm my own phone / The page sends a number only when it is valid and the security check passed (spec/browserJoin.md) */
//@ pure
export function canSettleCheck(page: JoinPage): boolean {
  return page.check === "CheckRunning";
}

/** Story: Confirm my own phone / The page sends a number only when it is valid and the security check passed (spec/browserJoin.md) */
//@ pure
export function settleCheck(page: JoinPage, passed: boolean): JoinPage {
  //@ ensures (inv(page) && canSettleCheck(page)) ==> alwaysAddressCleanAfterOpening(\result)
  //@ ensures (inv(page) && canSettleCheck(page)) ==> alwaysBlockedHasReason(\result)
  //@ ensures (inv(page) && canSettleCheck(page)) ==> alwaysPhoneStepsHaveNoAccount(\result)
  //@ ensures (inv(page) && canSettleCheck(page)) ==> alwaysAccountStepsHaveAccount(\result)
  //@ ensures (inv(page) && canSettleCheck(page)) ==> alwaysCheckOnlyWithTextCodes(\result)
  //@ ensures (inv(page) && canSettleCheck(page)) ==> alwaysCodeStepUsesTextCodes(\result)
  //@ ensures (inv(page) && canSettleCheck(page)) ==> alwaysResendWithoutCheckOnly(\result)
  //@ ensures (inv(page) && canSettleCheck(page)) ==> alwaysDoneNeedsConsent(\result)
  //@ ensures (inv(page) && canSettleCheck(page)) ==> alwaysRequestBelongsToItsStep(\result)
  //@ ensures (inv(page) && canSettleCheck(page)) ==> stepCodeRequestNeedsPassedCheck(page, "settleCheck", \result)
  //@ ensures (inv(page) && canSettleCheck(page)) ==> stepCheckSpentAfterCodeStart(page, "settleCheck", \result)
  //@ ensures (inv(page) && canSettleCheck(page)) ==> stepFormClearedWhenAccountLeaves(page, \result)
  //@ ensures (inv(page) && canSettleCheck(page)) ==> stepSignInKeepsFormValues(page, "settleCheck", \result)
  //@ ensures (inv(page) && canSettleCheck(page)) ==> stepDoneFollowsSavedProfile(page, "settleCheck", \result)
  //@ ensures (inv(page) && canSettleCheck(page)) ==> stepOneRequestAtATime(page, \result)
  const local_1 = page.formError === "CheckPending" || page.formError === "CheckFailed";
  const local_2: InlineError = page.screen !== "Phone" ? page.formError : (!passed && (page.formError === "NoError" || local_1) ? "CheckFailed" : (passed && local_1 ? "NoError" : page.formError));
  return { ...page, check: passed ? "CheckPassed" : "CheckBroken", formError: local_2 };
}

/** Story: Confirm my own phone / A sent code opens the code step, and each answer uses up the security check (spec/browserJoin.md) */
//@ pure
export function startError(started: StartResult): InlineError {
  return started === "CodeSent" ? "NewCodeSent" : (started === "StartRateLimited" ? "RateLimited" : (started === "StartCheckRejected" ? "CheckRejected" : "RequestFailed"));
}

/** Story: Confirm my own phone / A sent code opens the code step, and each answer uses up the security check (spec/browserJoin.md) */
//@ pure
export function canAnswerCodeStart(page: JoinPage): boolean {
  return page.pending === "StartingCode";
}

/** Story: Confirm my own phone / A sent code opens the code step, and each answer uses up the security check (spec/browserJoin.md) */
//@ pure
export function stepCheckSpentAfterCodeStart(before: JoinPage, via: string, after: JoinPage): boolean {
  return !(via === "answerCodeStart") || after.check !== "CheckPassed";
}

/** Story: Confirm my own phone / A sent code opens the code step, and each answer uses up the security check (spec/browserJoin.md) */
//@ pure
export function alwaysCodeStepUsesTextCodes(page: JoinPage): boolean {
  return !(page.screen === "Code") || page.auth === "OtpMode";
}

/** Story: Confirm my own phone / A sent code opens the code step, and each answer uses up the security check (spec/browserJoin.md) */
//@ pure
export function answerCodeStart(page: JoinPage, started: StartResult): JoinPage {
  //@ ensures (inv(page) && canAnswerCodeStart(page)) ==> alwaysAddressCleanAfterOpening(\result)
  //@ ensures (inv(page) && canAnswerCodeStart(page)) ==> alwaysBlockedHasReason(\result)
  //@ ensures (inv(page) && canAnswerCodeStart(page)) ==> alwaysPhoneStepsHaveNoAccount(\result)
  //@ ensures (inv(page) && canAnswerCodeStart(page)) ==> alwaysAccountStepsHaveAccount(\result)
  //@ ensures (inv(page) && canAnswerCodeStart(page)) ==> alwaysCheckOnlyWithTextCodes(\result)
  //@ ensures (inv(page) && canAnswerCodeStart(page)) ==> alwaysCodeStepUsesTextCodes(\result)
  //@ ensures (inv(page) && canAnswerCodeStart(page)) ==> alwaysResendWithoutCheckOnly(\result)
  //@ ensures (inv(page) && canAnswerCodeStart(page)) ==> alwaysDoneNeedsConsent(\result)
  //@ ensures (inv(page) && canAnswerCodeStart(page)) ==> alwaysRequestBelongsToItsStep(\result)
  //@ ensures (inv(page) && canAnswerCodeStart(page)) ==> stepCodeRequestNeedsPassedCheck(page, "answerCodeStart", \result)
  //@ ensures (inv(page) && canAnswerCodeStart(page)) ==> stepCheckSpentAfterCodeStart(page, "answerCodeStart", \result)
  //@ ensures (inv(page) && canAnswerCodeStart(page)) ==> stepFormClearedWhenAccountLeaves(page, \result)
  //@ ensures (inv(page) && canAnswerCodeStart(page)) ==> stepSignInKeepsFormValues(page, "answerCodeStart", \result)
  //@ ensures (inv(page) && canAnswerCodeStart(page)) ==> stepDoneFollowsSavedProfile(page, "answerCodeStart", \result)
  //@ ensures (inv(page) && canAnswerCodeStart(page)) ==> stepOneRequestAtATime(page, \result)
  const local_3: CheckState = page.check === "NoCheck" ? "NoCheck" : "CheckRunning";
  return started === "CodeSent" ? ({ ...page, pending: "Idle", check: local_3, screen: "Code", formError: "NoError" } as JoinPage) : ({ ...page, pending: "Idle", check: local_3, formError: startError(started) } as JoinPage);
}

/** Story: Confirm my own phone / Only a well-formed code goes to the server, and only a verified code signs the person in (spec/browserJoin.md) */
//@ pure
export function codeLengthAccepted(codeDigitCount: number): boolean {
  return codeDigitCount >= codeDigitsMin && codeDigitCount <= codeDigitsMax;
}

/** Story: Confirm my own phone / Only a well-formed code goes to the server, and only a verified code signs the person in (spec/browserJoin.md) */
//@ pure
export function canSubmitCode(page: JoinPage): boolean {
  return page.screen === "Code" && page.pending === "Idle";
}

/** Story: Confirm my own phone / Only a well-formed code goes to the server, and only a verified code signs the person in (spec/browserJoin.md) */
//@ pure
export function submitCode(page: JoinPage, codeDigitCount: number): JoinPage {
  //@ ensures (inv(page) && canSubmitCode(page)) ==> alwaysAddressCleanAfterOpening(\result)
  //@ ensures (inv(page) && canSubmitCode(page)) ==> alwaysBlockedHasReason(\result)
  //@ ensures (inv(page) && canSubmitCode(page)) ==> alwaysPhoneStepsHaveNoAccount(\result)
  //@ ensures (inv(page) && canSubmitCode(page)) ==> alwaysAccountStepsHaveAccount(\result)
  //@ ensures (inv(page) && canSubmitCode(page)) ==> alwaysCheckOnlyWithTextCodes(\result)
  //@ ensures (inv(page) && canSubmitCode(page)) ==> alwaysCodeStepUsesTextCodes(\result)
  //@ ensures (inv(page) && canSubmitCode(page)) ==> alwaysResendWithoutCheckOnly(\result)
  //@ ensures (inv(page) && canSubmitCode(page)) ==> alwaysDoneNeedsConsent(\result)
  //@ ensures (inv(page) && canSubmitCode(page)) ==> alwaysRequestBelongsToItsStep(\result)
  //@ ensures (inv(page) && canSubmitCode(page)) ==> stepCodeRequestNeedsPassedCheck(page, "submitCode", \result)
  //@ ensures (inv(page) && canSubmitCode(page)) ==> stepCheckSpentAfterCodeStart(page, "submitCode", \result)
  //@ ensures (inv(page) && canSubmitCode(page)) ==> stepFormClearedWhenAccountLeaves(page, \result)
  //@ ensures (inv(page) && canSubmitCode(page)) ==> stepSignInKeepsFormValues(page, "submitCode", \result)
  //@ ensures (inv(page) && canSubmitCode(page)) ==> stepDoneFollowsSavedProfile(page, "submitCode", \result)
  //@ ensures (inv(page) && canSubmitCode(page)) ==> stepOneRequestAtATime(page, \result)
  return codeLengthAccepted(codeDigitCount) ? ({ ...page, pending: "VerifyingCode" } as JoinPage) : ({ ...page, formError: "CodeFormat" } as JoinPage);
}

/** Story: Confirm my own phone / Only a well-formed code goes to the server, and only a verified code signs the person in (spec/browserJoin.md) */
//@ pure
export function canAnswerVerify(page: JoinPage): boolean {
  return page.pending === "VerifyingCode";
}

/** Story: Confirm my own phone / Only a well-formed code goes to the server, and only a verified code signs the person in (spec/browserJoin.md) */
//@ pure
export function answerVerify(page: JoinPage, verifyAnswer: VerifyResult): JoinPage {
  //@ ensures (inv(page) && canAnswerVerify(page)) ==> alwaysAddressCleanAfterOpening(\result)
  //@ ensures (inv(page) && canAnswerVerify(page)) ==> alwaysBlockedHasReason(\result)
  //@ ensures (inv(page) && canAnswerVerify(page)) ==> alwaysPhoneStepsHaveNoAccount(\result)
  //@ ensures (inv(page) && canAnswerVerify(page)) ==> alwaysAccountStepsHaveAccount(\result)
  //@ ensures (inv(page) && canAnswerVerify(page)) ==> alwaysCheckOnlyWithTextCodes(\result)
  //@ ensures (inv(page) && canAnswerVerify(page)) ==> alwaysCodeStepUsesTextCodes(\result)
  //@ ensures (inv(page) && canAnswerVerify(page)) ==> alwaysResendWithoutCheckOnly(\result)
  //@ ensures (inv(page) && canAnswerVerify(page)) ==> alwaysDoneNeedsConsent(\result)
  //@ ensures (inv(page) && canAnswerVerify(page)) ==> alwaysRequestBelongsToItsStep(\result)
  //@ ensures (inv(page) && canAnswerVerify(page)) ==> stepCodeRequestNeedsPassedCheck(page, "answerVerify", \result)
  //@ ensures (inv(page) && canAnswerVerify(page)) ==> stepCheckSpentAfterCodeStart(page, "answerVerify", \result)
  //@ ensures (inv(page) && canAnswerVerify(page)) ==> stepFormClearedWhenAccountLeaves(page, \result)
  //@ ensures (inv(page) && canAnswerVerify(page)) ==> stepSignInKeepsFormValues(page, "answerVerify", \result)
  //@ ensures (inv(page) && canAnswerVerify(page)) ==> stepDoneFollowsSavedProfile(page, "answerVerify", \result)
  //@ ensures (inv(page) && canAnswerVerify(page)) ==> stepOneRequestAtATime(page, \result)
  return verifyAnswer === "Verified" ? ({ ...page, pending: "Idle", screen: "Checking", notice: "NoNotice", formError: "NoError" } as JoinPage) : (verifyAnswer === "WrongCode" ? ({ ...page, pending: "Idle", formError: "InvalidCode" } as JoinPage) : (verifyAnswer === "VerifyRateLimited" ? ({ ...page, pending: "Idle", formError: "RateLimited" } as JoinPage) : ({ ...page, pending: "Idle", formError: "RequestFailed" } as JoinPage)));
}

/** Story: Confirm my own phone / Only a well-formed code goes to the server, and only a verified code signs the person in (spec/browserJoin.md) */
//@ pure
export function lawCodeOutsideLimitsNeverVerified(page: JoinPage, codeDigitCount: number): boolean {
  //@ ensures \result === true
  return !(codeDigitCount < codeDigitsMin || codeDigitCount > codeDigitsMax) || submitCode(page, codeDigitCount).pending === page.pending;
}

/** Story: Confirm my own phone / A new code needs a new security check when the check is on (spec/browserJoin.md) */
//@ pure
export function canResendCode(page: JoinPage): boolean {
  return page.screen === "Code" && page.pending === "Idle";
}

/** Story: Confirm my own phone / A new code needs a new security check when the check is on (spec/browserJoin.md) */
//@ pure
export function resendCode(page: JoinPage): JoinPage {
  //@ ensures (inv(page) && canResendCode(page)) ==> alwaysAddressCleanAfterOpening(\result)
  //@ ensures (inv(page) && canResendCode(page)) ==> alwaysBlockedHasReason(\result)
  //@ ensures (inv(page) && canResendCode(page)) ==> alwaysPhoneStepsHaveNoAccount(\result)
  //@ ensures (inv(page) && canResendCode(page)) ==> alwaysAccountStepsHaveAccount(\result)
  //@ ensures (inv(page) && canResendCode(page)) ==> alwaysCheckOnlyWithTextCodes(\result)
  //@ ensures (inv(page) && canResendCode(page)) ==> alwaysCodeStepUsesTextCodes(\result)
  //@ ensures (inv(page) && canResendCode(page)) ==> alwaysResendWithoutCheckOnly(\result)
  //@ ensures (inv(page) && canResendCode(page)) ==> alwaysDoneNeedsConsent(\result)
  //@ ensures (inv(page) && canResendCode(page)) ==> alwaysRequestBelongsToItsStep(\result)
  //@ ensures (inv(page) && canResendCode(page)) ==> stepCodeRequestNeedsPassedCheck(page, "resendCode", \result)
  //@ ensures (inv(page) && canResendCode(page)) ==> stepCheckSpentAfterCodeStart(page, "resendCode", \result)
  //@ ensures (inv(page) && canResendCode(page)) ==> stepFormClearedWhenAccountLeaves(page, \result)
  //@ ensures (inv(page) && canResendCode(page)) ==> stepSignInKeepsFormValues(page, "resendCode", \result)
  //@ ensures (inv(page) && canResendCode(page)) ==> stepDoneFollowsSavedProfile(page, "resendCode", \result)
  //@ ensures (inv(page) && canResendCode(page)) ==> stepOneRequestAtATime(page, \result)
  return page.check !== "NoCheck" ? ({ ...page, screen: "Phone", formError: "CheckAgain" } as JoinPage) : ({ ...page, pending: "ResendingCode" } as JoinPage);
}

/** Story: Confirm my own phone / A new code needs a new security check when the check is on (spec/browserJoin.md) */
//@ pure
export function canAnswerResend(page: JoinPage): boolean {
  return page.pending === "ResendingCode";
}

/** Story: Confirm my own phone / A new code needs a new security check when the check is on (spec/browserJoin.md) */
//@ pure
export function canChangeNumber(page: JoinPage): boolean {
  return page.screen === "Code" && page.pending === "Idle";
}

/** Story: Confirm my own phone / A new code needs a new security check when the check is on (spec/browserJoin.md) */
//@ pure
export function changeNumber(page: JoinPage): JoinPage {
  //@ ensures (inv(page) && canChangeNumber(page)) ==> alwaysAddressCleanAfterOpening(\result)
  //@ ensures (inv(page) && canChangeNumber(page)) ==> alwaysBlockedHasReason(\result)
  //@ ensures (inv(page) && canChangeNumber(page)) ==> alwaysPhoneStepsHaveNoAccount(\result)
  //@ ensures (inv(page) && canChangeNumber(page)) ==> alwaysAccountStepsHaveAccount(\result)
  //@ ensures (inv(page) && canChangeNumber(page)) ==> alwaysCheckOnlyWithTextCodes(\result)
  //@ ensures (inv(page) && canChangeNumber(page)) ==> alwaysCodeStepUsesTextCodes(\result)
  //@ ensures (inv(page) && canChangeNumber(page)) ==> alwaysResendWithoutCheckOnly(\result)
  //@ ensures (inv(page) && canChangeNumber(page)) ==> alwaysDoneNeedsConsent(\result)
  //@ ensures (inv(page) && canChangeNumber(page)) ==> alwaysRequestBelongsToItsStep(\result)
  //@ ensures (inv(page) && canChangeNumber(page)) ==> stepCodeRequestNeedsPassedCheck(page, "changeNumber", \result)
  //@ ensures (inv(page) && canChangeNumber(page)) ==> stepCheckSpentAfterCodeStart(page, "changeNumber", \result)
  //@ ensures (inv(page) && canChangeNumber(page)) ==> stepFormClearedWhenAccountLeaves(page, \result)
  //@ ensures (inv(page) && canChangeNumber(page)) ==> stepSignInKeepsFormValues(page, "changeNumber", \result)
  //@ ensures (inv(page) && canChangeNumber(page)) ==> stepDoneFollowsSavedProfile(page, "changeNumber", \result)
  //@ ensures (inv(page) && canChangeNumber(page)) ==> stepOneRequestAtATime(page, \result)
  return { ...page, screen: "Phone", formError: "NoError" };
}

/** Story: Confirm my own phone / A new code needs a new security check when the check is on (spec/browserJoin.md) */
//@ pure
export function alwaysResendWithoutCheckOnly(page: JoinPage): boolean {
  return !(page.pending === "ResendingCode") || page.check === "NoCheck";
}

/** Story: Confirm my own phone / A new code needs a new security check when the check is on (spec/browserJoin.md) */
//@ pure
export function answerResend(page: JoinPage, resent: StartResult): JoinPage {
  //@ ensures (inv(page) && canAnswerResend(page)) ==> alwaysAddressCleanAfterOpening(\result)
  //@ ensures (inv(page) && canAnswerResend(page)) ==> alwaysBlockedHasReason(\result)
  //@ ensures (inv(page) && canAnswerResend(page)) ==> alwaysPhoneStepsHaveNoAccount(\result)
  //@ ensures (inv(page) && canAnswerResend(page)) ==> alwaysAccountStepsHaveAccount(\result)
  //@ ensures (inv(page) && canAnswerResend(page)) ==> alwaysCheckOnlyWithTextCodes(\result)
  //@ ensures (inv(page) && canAnswerResend(page)) ==> alwaysCodeStepUsesTextCodes(\result)
  //@ ensures (inv(page) && canAnswerResend(page)) ==> alwaysResendWithoutCheckOnly(\result)
  //@ ensures (inv(page) && canAnswerResend(page)) ==> alwaysDoneNeedsConsent(\result)
  //@ ensures (inv(page) && canAnswerResend(page)) ==> alwaysRequestBelongsToItsStep(\result)
  //@ ensures (inv(page) && canAnswerResend(page)) ==> stepCodeRequestNeedsPassedCheck(page, "answerResend", \result)
  //@ ensures (inv(page) && canAnswerResend(page)) ==> stepCheckSpentAfterCodeStart(page, "answerResend", \result)
  //@ ensures (inv(page) && canAnswerResend(page)) ==> stepFormClearedWhenAccountLeaves(page, \result)
  //@ ensures (inv(page) && canAnswerResend(page)) ==> stepSignInKeepsFormValues(page, "answerResend", \result)
  //@ ensures (inv(page) && canAnswerResend(page)) ==> stepDoneFollowsSavedProfile(page, "answerResend", \result)
  //@ ensures (inv(page) && canAnswerResend(page)) ==> stepOneRequestAtATime(page, \result)
  return { ...page, pending: "Idle", formError: startError(resent) };
}

/** Story: Confirm my own phone / Cloud sign-in leaves the page to confirm the phone (spec/browserJoin.md) */
//@ pure
export function canContinueWithPhone(page: JoinPage): boolean {
  return page.screen === "Phone" && page.auth === "CloudMode" && page.pending === "Idle";
}

/** Story: Confirm my own phone / Cloud sign-in leaves the page to confirm the phone (spec/browserJoin.md) */
//@ pure
export function continueWithPhone(page: JoinPage): JoinPage {
  //@ ensures (inv(page) && canContinueWithPhone(page)) ==> alwaysAddressCleanAfterOpening(\result)
  //@ ensures (inv(page) && canContinueWithPhone(page)) ==> alwaysBlockedHasReason(\result)
  //@ ensures (inv(page) && canContinueWithPhone(page)) ==> alwaysPhoneStepsHaveNoAccount(\result)
  //@ ensures (inv(page) && canContinueWithPhone(page)) ==> alwaysAccountStepsHaveAccount(\result)
  //@ ensures (inv(page) && canContinueWithPhone(page)) ==> alwaysCheckOnlyWithTextCodes(\result)
  //@ ensures (inv(page) && canContinueWithPhone(page)) ==> alwaysCodeStepUsesTextCodes(\result)
  //@ ensures (inv(page) && canContinueWithPhone(page)) ==> alwaysResendWithoutCheckOnly(\result)
  //@ ensures (inv(page) && canContinueWithPhone(page)) ==> alwaysDoneNeedsConsent(\result)
  //@ ensures (inv(page) && canContinueWithPhone(page)) ==> alwaysRequestBelongsToItsStep(\result)
  //@ ensures (inv(page) && canContinueWithPhone(page)) ==> stepCodeRequestNeedsPassedCheck(page, "continueWithPhone", \result)
  //@ ensures (inv(page) && canContinueWithPhone(page)) ==> stepCheckSpentAfterCodeStart(page, "continueWithPhone", \result)
  //@ ensures (inv(page) && canContinueWithPhone(page)) ==> stepFormClearedWhenAccountLeaves(page, \result)
  //@ ensures (inv(page) && canContinueWithPhone(page)) ==> stepSignInKeepsFormValues(page, "continueWithPhone", \result)
  //@ ensures (inv(page) && canContinueWithPhone(page)) ==> stepDoneFollowsSavedProfile(page, "continueWithPhone", \result)
  //@ ensures (inv(page) && canContinueWithPhone(page)) ==> stepOneRequestAtATime(page, \result)
  return { ...page, pending: "OpeningCloud" };
}

/** Story: Confirm my own phone / Cloud sign-in leaves the page to confirm the phone (spec/browserJoin.md) */
//@ pure
export function canAnswerCloudStart(page: JoinPage): boolean {
  return page.pending === "OpeningCloud";
}

/** Story: Confirm my own phone / Cloud sign-in leaves the page to confirm the phone (spec/browserJoin.md) */
//@ pure
export function answerCloudStart(page: JoinPage, opened: boolean): JoinPage {
  //@ ensures (inv(page) && canAnswerCloudStart(page)) ==> alwaysAddressCleanAfterOpening(\result)
  //@ ensures (inv(page) && canAnswerCloudStart(page)) ==> alwaysBlockedHasReason(\result)
  //@ ensures (inv(page) && canAnswerCloudStart(page)) ==> alwaysPhoneStepsHaveNoAccount(\result)
  //@ ensures (inv(page) && canAnswerCloudStart(page)) ==> alwaysAccountStepsHaveAccount(\result)
  //@ ensures (inv(page) && canAnswerCloudStart(page)) ==> alwaysCheckOnlyWithTextCodes(\result)
  //@ ensures (inv(page) && canAnswerCloudStart(page)) ==> alwaysCodeStepUsesTextCodes(\result)
  //@ ensures (inv(page) && canAnswerCloudStart(page)) ==> alwaysResendWithoutCheckOnly(\result)
  //@ ensures (inv(page) && canAnswerCloudStart(page)) ==> alwaysDoneNeedsConsent(\result)
  //@ ensures (inv(page) && canAnswerCloudStart(page)) ==> alwaysRequestBelongsToItsStep(\result)
  //@ ensures (inv(page) && canAnswerCloudStart(page)) ==> stepCodeRequestNeedsPassedCheck(page, "answerCloudStart", \result)
  //@ ensures (inv(page) && canAnswerCloudStart(page)) ==> stepCheckSpentAfterCodeStart(page, "answerCloudStart", \result)
  //@ ensures (inv(page) && canAnswerCloudStart(page)) ==> stepFormClearedWhenAccountLeaves(page, \result)
  //@ ensures (inv(page) && canAnswerCloudStart(page)) ==> stepSignInKeepsFormValues(page, "answerCloudStart", \result)
  //@ ensures (inv(page) && canAnswerCloudStart(page)) ==> stepDoneFollowsSavedProfile(page, "answerCloudStart", \result)
  //@ ensures (inv(page) && canAnswerCloudStart(page)) ==> stepOneRequestAtATime(page, \result)
  return opened ? ({ ...page, pending: "Idle", screen: "LeftForCloud" } as JoinPage) : ({ ...page, pending: "Idle", formError: "CloudUnavailable" } as JoinPage);
}

/** Story: Confirm my own phone / After sign-in the page reads the session again and shows its step (spec/browserJoin.md) */
//@ pure
export function canRecheck(page: JoinPage, view: SessionView): boolean {
  return page.screen === "Checking" && sessionConsistent(view);
}

/** Story: Confirm my own phone / After sign-in the page reads the session again and shows its step (spec/browserJoin.md) */
//@ pure
export function recheck(page: JoinPage, view: SessionView): JoinPage {
  //@ ensures (inv(page) && canRecheck(page, view)) ==> alwaysAddressCleanAfterOpening(\result)
  //@ ensures (inv(page) && canRecheck(page, view)) ==> alwaysBlockedHasReason(\result)
  //@ ensures (inv(page) && canRecheck(page, view)) ==> alwaysPhoneStepsHaveNoAccount(\result)
  //@ ensures (inv(page) && canRecheck(page, view)) ==> alwaysAccountStepsHaveAccount(\result)
  //@ ensures (inv(page) && canRecheck(page, view)) ==> alwaysCheckOnlyWithTextCodes(\result)
  //@ ensures (inv(page) && canRecheck(page, view)) ==> alwaysCodeStepUsesTextCodes(\result)
  //@ ensures (inv(page) && canRecheck(page, view)) ==> alwaysResendWithoutCheckOnly(\result)
  //@ ensures (inv(page) && canRecheck(page, view)) ==> alwaysDoneNeedsConsent(\result)
  //@ ensures (inv(page) && canRecheck(page, view)) ==> alwaysRequestBelongsToItsStep(\result)
  //@ ensures (inv(page) && canRecheck(page, view)) ==> stepCodeRequestNeedsPassedCheck(page, "recheck", \result)
  //@ ensures (inv(page) && canRecheck(page, view)) ==> stepCheckSpentAfterCodeStart(page, "recheck", \result)
  //@ ensures (inv(page) && canRecheck(page, view)) ==> stepFormClearedWhenAccountLeaves(page, \result)
  //@ ensures (inv(page) && canRecheck(page, view)) ==> stepSignInKeepsFormValues(page, "recheck", \result)
  //@ ensures (inv(page) && canRecheck(page, view)) ==> stepDoneFollowsSavedProfile(page, "recheck", \result)
  //@ ensures (inv(page) && canRecheck(page, view)) ==> stepOneRequestAtATime(page, \result)
  const local_4: JoinPage = routed(view, page, page.inviteOnly);
  return { ...local_4, notice: signedInResult(view.result) || page.notice === "AccountChanged" ? page.notice : (view.result === "SignedOut" ? "SessionEnded" : "ApiUnreachable") };
}

/** Story: Confirm my details and join / The page sends the profile only with a name, an age from 1 to 120 and the text consent ticked (spec/browserJoin.md) */
//@ pure
export function profileComplete(form: ProfileForm): boolean {
  return form.nameGiven && form.age >= 1 && form.age <= 120 && form.consentTicked;
}

/** Story: Confirm my details and join / The page sends the profile only with a name, an age from 1 to 120 and the text consent ticked (spec/browserJoin.md) */
//@ pure
export function canEditProfile(page: JoinPage): boolean {
  return page.screen === "Profile" && page.pending === "Idle";
}

/** Story: Confirm my details and join / The page sends the profile only with a name, an age from 1 to 120 and the text consent ticked (spec/browserJoin.md) */
//@ pure
export function editProfile(page: JoinPage): JoinPage {
  //@ ensures (inv(page) && canEditProfile(page)) ==> alwaysAddressCleanAfterOpening(\result)
  //@ ensures (inv(page) && canEditProfile(page)) ==> alwaysBlockedHasReason(\result)
  //@ ensures (inv(page) && canEditProfile(page)) ==> alwaysPhoneStepsHaveNoAccount(\result)
  //@ ensures (inv(page) && canEditProfile(page)) ==> alwaysAccountStepsHaveAccount(\result)
  //@ ensures (inv(page) && canEditProfile(page)) ==> alwaysCheckOnlyWithTextCodes(\result)
  //@ ensures (inv(page) && canEditProfile(page)) ==> alwaysCodeStepUsesTextCodes(\result)
  //@ ensures (inv(page) && canEditProfile(page)) ==> alwaysResendWithoutCheckOnly(\result)
  //@ ensures (inv(page) && canEditProfile(page)) ==> alwaysDoneNeedsConsent(\result)
  //@ ensures (inv(page) && canEditProfile(page)) ==> alwaysRequestBelongsToItsStep(\result)
  //@ ensures (inv(page) && canEditProfile(page)) ==> stepCodeRequestNeedsPassedCheck(page, "editProfile", \result)
  //@ ensures (inv(page) && canEditProfile(page)) ==> stepCheckSpentAfterCodeStart(page, "editProfile", \result)
  //@ ensures (inv(page) && canEditProfile(page)) ==> stepFormClearedWhenAccountLeaves(page, \result)
  //@ ensures (inv(page) && canEditProfile(page)) ==> stepSignInKeepsFormValues(page, "editProfile", \result)
  //@ ensures (inv(page) && canEditProfile(page)) ==> stepDoneFollowsSavedProfile(page, "editProfile", \result)
  //@ ensures (inv(page) && canEditProfile(page)) ==> stepOneRequestAtATime(page, \result)
  return { ...page, formHasValues: true };
}

/** Story: Confirm my details and join / The page sends the profile only with a name, an age from 1 to 120 and the text consent ticked (spec/browserJoin.md) */
//@ pure
export function canSubmitProfile(page: JoinPage): boolean {
  return page.screen === "Profile" && page.pending === "Idle";
}

/** Story: Confirm my details and join / The page sends the profile only with a name, an age from 1 to 120 and the text consent ticked (spec/browserJoin.md) */
//@ pure
export function submitProfile(page: JoinPage, form: ProfileForm): JoinPage {
  //@ ensures (inv(page) && canSubmitProfile(page)) ==> alwaysAddressCleanAfterOpening(\result)
  //@ ensures (inv(page) && canSubmitProfile(page)) ==> alwaysBlockedHasReason(\result)
  //@ ensures (inv(page) && canSubmitProfile(page)) ==> alwaysPhoneStepsHaveNoAccount(\result)
  //@ ensures (inv(page) && canSubmitProfile(page)) ==> alwaysAccountStepsHaveAccount(\result)
  //@ ensures (inv(page) && canSubmitProfile(page)) ==> alwaysCheckOnlyWithTextCodes(\result)
  //@ ensures (inv(page) && canSubmitProfile(page)) ==> alwaysCodeStepUsesTextCodes(\result)
  //@ ensures (inv(page) && canSubmitProfile(page)) ==> alwaysResendWithoutCheckOnly(\result)
  //@ ensures (inv(page) && canSubmitProfile(page)) ==> alwaysDoneNeedsConsent(\result)
  //@ ensures (inv(page) && canSubmitProfile(page)) ==> alwaysRequestBelongsToItsStep(\result)
  //@ ensures (inv(page) && canSubmitProfile(page)) ==> stepCodeRequestNeedsPassedCheck(page, "submitProfile", \result)
  //@ ensures (inv(page) && canSubmitProfile(page)) ==> stepCheckSpentAfterCodeStart(page, "submitProfile", \result)
  //@ ensures (inv(page) && canSubmitProfile(page)) ==> stepFormClearedWhenAccountLeaves(page, \result)
  //@ ensures (inv(page) && canSubmitProfile(page)) ==> stepSignInKeepsFormValues(page, "submitProfile", \result)
  //@ ensures (inv(page) && canSubmitProfile(page)) ==> stepDoneFollowsSavedProfile(page, "submitProfile", \result)
  //@ ensures (inv(page) && canSubmitProfile(page)) ==> stepOneRequestAtATime(page, \result)
  return profileComplete(form) ? ({ ...page, pending: "SavingProfile", consented: true, formError: "NoError" } as JoinPage) : ({ ...page, formError: "ProfileIncomplete" } as JoinPage);
}

/** Story: Confirm my details and join / The page sends the profile only with a name, an age from 1 to 120 and the text consent ticked (spec/browserJoin.md) */
//@ pure
export function lawProfileNeedsConsent(form: ProfileForm): boolean {
  //@ ensures \result === true
  return !profileComplete(form) || form.consentTicked;
}

/** Story: Confirm my details and join / The server answer decides between done, blocked and a new sign-in (spec/browserJoin.md) */
//@ pure
export function joinRefusal(joinAnswer: JoinOutcome): BlockReason {
  return joinAnswer === "JoinUnderAge" ? "UnderAge" : (joinAnswer === "JoinInviteOnly" ? "InviteOnly" : (joinAnswer === "JoinReview" ? "InReview" : (joinAnswer === "JoinInvalidInvitation" ? "NotValid" : "NoBlock")));
}

/** Story: Confirm my details and join / The server answer decides between done, blocked and a new sign-in (spec/browserJoin.md) */
//@ pure
export function canAnswerJoin(page: JoinPage): boolean {
  return page.pending === "SavingProfile";
}

/** Story: Confirm my details and join / The server answer decides between done, blocked and a new sign-in (spec/browserJoin.md) */
//@ pure
export function answerJoin(page: JoinPage, joinAnswer: JoinOutcome): JoinPage {
  //@ ensures (inv(page) && canAnswerJoin(page)) ==> alwaysAddressCleanAfterOpening(\result)
  //@ ensures (inv(page) && canAnswerJoin(page)) ==> alwaysBlockedHasReason(\result)
  //@ ensures (inv(page) && canAnswerJoin(page)) ==> alwaysPhoneStepsHaveNoAccount(\result)
  //@ ensures (inv(page) && canAnswerJoin(page)) ==> alwaysAccountStepsHaveAccount(\result)
  //@ ensures (inv(page) && canAnswerJoin(page)) ==> alwaysCheckOnlyWithTextCodes(\result)
  //@ ensures (inv(page) && canAnswerJoin(page)) ==> alwaysCodeStepUsesTextCodes(\result)
  //@ ensures (inv(page) && canAnswerJoin(page)) ==> alwaysResendWithoutCheckOnly(\result)
  //@ ensures (inv(page) && canAnswerJoin(page)) ==> alwaysDoneNeedsConsent(\result)
  //@ ensures (inv(page) && canAnswerJoin(page)) ==> alwaysRequestBelongsToItsStep(\result)
  //@ ensures (inv(page) && canAnswerJoin(page)) ==> stepCodeRequestNeedsPassedCheck(page, "answerJoin", \result)
  //@ ensures (inv(page) && canAnswerJoin(page)) ==> stepCheckSpentAfterCodeStart(page, "answerJoin", \result)
  //@ ensures (inv(page) && canAnswerJoin(page)) ==> stepFormClearedWhenAccountLeaves(page, \result)
  //@ ensures (inv(page) && canAnswerJoin(page)) ==> stepSignInKeepsFormValues(page, "answerJoin", \result)
  //@ ensures (inv(page) && canAnswerJoin(page)) ==> stepDoneFollowsSavedProfile(page, "answerJoin", \result)
  //@ ensures (inv(page) && canAnswerJoin(page)) ==> stepOneRequestAtATime(page, \result)
  const local_5: JoinPage = { ...page, pending: "Idle" };
  const local_6: BlockReason = joinRefusal(joinAnswer);
  return joinAnswer === "JoinedOk" ? ({ ...local_5, screen: "Done", notice: "NoNotice" } as JoinPage) : (local_6 !== "NoBlock" ? ({ ...local_5, screen: "Blocked", reason: local_6 } as JoinPage) : (joinAnswer === "JoinAccountChanged" ? ({ ...local_5, screen: "Checking", account: 0, formHasValues: false, consented: false, notice: "AccountChanged", formError: "NoError" } as JoinPage) : (joinAnswer === "JoinUnauthorized" ? ({ ...local_5, screen: "Phone", account: 0, formHasValues: false, consented: false, notice: "SessionEnded", formError: "NoError" } as JoinPage) : ({ ...local_5, formError: "RequestFailed" } as JoinPage))));
}

/** Story: Confirm my details and join / The server answer decides between done, blocked and a new sign-in (spec/browserJoin.md) */
//@ pure
export function lawFailedSaveKeepsOwnedProfile(page: JoinPage): boolean {
  //@ ensures \result === true
  const local_7: JoinPage = answerJoin(page, "JoinFailed");
  return !(page.screen === "Profile" && canAnswerJoin(page)) || (canSubmitProfile(local_7) && local_7.account === page.account && local_7.formHasValues === page.formHasValues && local_7.consented === page.consented);
}

/** Story: Confirm my details and join / A Peon invitation stays in memory until the verified account agrees to join (spec/browserJoin.md) */
//@ pure
export function browserInvitationMayBind(peonApp: boolean, verifiedView: boolean): boolean {
  return peonApp && verifiedView;
}

/** Story: Confirm my details and join / A Peon invitation stays in memory until the verified account agrees to join (spec/browserJoin.md) */
//@ pure
export function browserInvitationMaySubmit(boundAccount: boolean, addressClean: boolean, consented: boolean): boolean {
  return boundAccount && addressClean && consented;
}

/** Story: Confirm my details and join / A Peon invitation stays in memory until the verified account agrees to join (spec/browserJoin.md) */
//@ pure
export function browserInvitationKeepsAccount(beforeAccount: number, afterAccount: number): boolean {
  return beforeAccount === 0 || beforeAccount === afterAccount;
}

/** Story: Confirm my details and join / A Peon invitation stays in memory until the verified account agrees to join (spec/browserJoin.md) */
//@ pure
export function browserInvitationMayRetry(joinAnswer: JoinOutcome): boolean {
  return joinAnswer === "JoinFailed";
}

/** Story: Confirm my details and join / A Peon invitation stays in memory until the verified account agrees to join (spec/browserJoin.md) */
//@ pure
export function lawBrowserInvitationNeedsCleanConsentedAccount(boundAccount: boolean, addressClean: boolean, consented: boolean): boolean {
  //@ ensures \result === true
  return !browserInvitationMaySubmit(boundAccount, addressClean, consented) || (boundAccount && addressClean && consented);
}

/** Story: Confirm my details and join / A Peon invitation stays in memory until the verified account agrees to join (spec/browserJoin.md) */
//@ pure
export function lawBrowserInvitationCannotRideAnotherAccount(beforeAccount: number, afterAccount: number): boolean {
  //@ ensures \result === true
  return !(beforeAccount > 0 && beforeAccount !== afterAccount) || !browserInvitationKeepsAccount(beforeAccount, afterAccount);
}

/** Story: Confirm my details and join / Profile values never pass from one account to another (spec/browserJoin.md) */
//@ pure
export function cloudJoinPrefillCanRead(eligible: boolean, receiptMatches: boolean, sessionMatches: boolean, asOf: number, expiresAt: number): boolean {
  return eligible && receiptMatches && sessionMatches && asOf < expiresAt;
}

/** Story: Confirm my details and join / Profile values never pass from one account to another (spec/browserJoin.md) */
//@ pure
export function stepFormClearedWhenAccountLeaves(before: JoinPage, after: JoinPage): boolean {
  return !(before.account > 0 && after.account !== before.account) || !after.formHasValues;
}

/** Story: Confirm my details and join / Profile values never pass from one account to another (spec/browserJoin.md) */
//@ pure
export function stepSignInKeepsFormValues(before: JoinPage, via: string, after: JoinPage): boolean {
  return !(before.account === 0 && (via === "changeNumber" || via === "resendCode" || via === "answerVerify" || via === "recheck")) || after.formHasValues === before.formHasValues;
}

/** Story: Confirm my details and join / Profile values never pass from one account to another (spec/browserJoin.md) */
//@ pure
export function lawCloudPrefillNeedsOwnLiveHandoff(eligible: boolean, receiptMatches: boolean, sessionMatches: boolean, asOf: number, expiresAt: number): boolean {
  //@ ensures \result === true
  return !(!receiptMatches || !sessionMatches || asOf >= expiresAt) || !cloudJoinPrefillCanRead(eligible, receiptMatches, sessionMatches, asOf, expiresAt);
}

/** Story: Confirm my details and join / Profile values never pass from one account to another (spec/browserJoin.md) */
//@ pure
export function restoreCloudPrefill(page: JoinPage, view: SessionView, fromAgent: boolean, hasFields: boolean): JoinPage {
  //@ ensures (inv(page) && canRestoreCloudPrefill(page, view)) ==> alwaysAddressCleanAfterOpening(\result)
  //@ ensures (inv(page) && canRestoreCloudPrefill(page, view)) ==> alwaysBlockedHasReason(\result)
  //@ ensures (inv(page) && canRestoreCloudPrefill(page, view)) ==> alwaysPhoneStepsHaveNoAccount(\result)
  //@ ensures (inv(page) && canRestoreCloudPrefill(page, view)) ==> alwaysAccountStepsHaveAccount(\result)
  //@ ensures (inv(page) && canRestoreCloudPrefill(page, view)) ==> alwaysCheckOnlyWithTextCodes(\result)
  //@ ensures (inv(page) && canRestoreCloudPrefill(page, view)) ==> alwaysCodeStepUsesTextCodes(\result)
  //@ ensures (inv(page) && canRestoreCloudPrefill(page, view)) ==> alwaysResendWithoutCheckOnly(\result)
  //@ ensures (inv(page) && canRestoreCloudPrefill(page, view)) ==> alwaysDoneNeedsConsent(\result)
  //@ ensures (inv(page) && canRestoreCloudPrefill(page, view)) ==> alwaysRequestBelongsToItsStep(\result)
  //@ ensures (inv(page) && canRestoreCloudPrefill(page, view)) ==> stepCodeRequestNeedsPassedCheck(page, "restoreCloudPrefill", \result)
  //@ ensures (inv(page) && canRestoreCloudPrefill(page, view)) ==> stepCheckSpentAfterCodeStart(page, "restoreCloudPrefill", \result)
  //@ ensures (inv(page) && canRestoreCloudPrefill(page, view)) ==> stepFormClearedWhenAccountLeaves(page, \result)
  //@ ensures (inv(page) && canRestoreCloudPrefill(page, view)) ==> stepSignInKeepsFormValues(page, "restoreCloudPrefill", \result)
  //@ ensures (inv(page) && canRestoreCloudPrefill(page, view)) ==> stepDoneFollowsSavedProfile(page, "restoreCloudPrefill", \result)
  //@ ensures (inv(page) && canRestoreCloudPrefill(page, view)) ==> stepOneRequestAtATime(page, \result)
  return { ...page, viaAgent: fromAgent, formHasValues: hasFields, consented: false };
}

/** Story: Confirm my details and join / Profile values never pass from one account to another (spec/browserJoin.md) */
//@ pure
export function canRestoreCloudPrefill(page: JoinPage, view: SessionView): boolean {
  return page.screen === "Loading" && view.result === "MayJoin" && sessionConsistent(view);
}

/** Story: Confirm my details and join / The done step comes only from a saved profile with consent (spec/browserJoin.md) */
//@ pure
export function agentReturnShown(page: JoinPage): boolean {
  return page.screen === "Done" && page.viaAgent;
}

/** Story: Confirm my details and join / The done step comes only from a saved profile with consent (spec/browserJoin.md) */
//@ pure
export function alwaysDoneNeedsConsent(page: JoinPage): boolean {
  return !(page.screen === "Done") || (page.consented && page.account > 0 && page.notice === "NoNotice");
}

/** Story: Confirm my details and join / The done step comes only from a saved profile with consent (spec/browserJoin.md) */
//@ pure
export function stepDoneFollowsSavedProfile(before: JoinPage, via: string, after: JoinPage): boolean {
  return !(after.screen === "Done" && before.screen !== "Done") || (via === "answerJoin" && before.pending === "SavingProfile");
}

/** Story: Send each form only once / A form that waits for an answer refuses a second submit (spec/browserJoin.md) */
//@ pure
export function formBusy(page: JoinPage): boolean {
  return page.pending !== "Idle";
}

/** Story: Send each form only once / A form that waits for an answer refuses a second submit (spec/browserJoin.md) */
//@ pure
export function stepOneRequestAtATime(before: JoinPage, after: JoinPage): boolean {
  return !(after.pending !== "Idle" && after.pending !== before.pending) || before.pending === "Idle";
}

/** Story: Send each form only once / A form that waits for an answer refuses a second submit (spec/browserJoin.md) */
//@ pure
export function alwaysRequestBelongsToItsStep(page: JoinPage): boolean {
  return (!(page.pending === "StartingCode") || (page.screen === "Phone" && page.auth === "OtpMode")) && (!(page.pending === "OpeningCloud") || (page.screen === "Phone" && page.auth === "CloudMode")) && (!(page.pending === "VerifyingCode" || page.pending === "ResendingCode") || (page.screen === "Code" && page.auth === "OtpMode")) && (!(page.pending === "SavingProfile") || (page.screen === "Profile" && page.consented));
}

/** Story: Send each form only once / A form that waits for an answer refuses a second submit (spec/browserJoin.md) */
//@ pure
export function lawSavingProfilePreventsEditsAndSubmissions(page: JoinPage): boolean {
  //@ ensures \result === true
  return !(page.pending === "SavingProfile") || (!canEditProfile(page) && !canSubmitProfile(page));
}

/** Story: Reach every outcome / A person can join, find they are in, be blocked, leave for cloud sign-in or see each error (spec/browserJoin.md) */
//@ pure
export function sometimesJoined(page: JoinPage): boolean {
  return page.screen === "Done";
}

/** Story: Reach every outcome / A person can join, find they are in, be blocked, leave for cloud sign-in or see each error (spec/browserJoin.md) */
//@ pure
export function sometimesJoinedWithoutAgentLine(page: JoinPage): boolean {
  return page.screen === "Done" && !page.viaAgent;
}

/** Story: Reach every outcome / A person can join, find they are in, be blocked, leave for cloud sign-in or see each error (spec/browserJoin.md) */
//@ pure
export function sometimesAlreadyMember(page: JoinPage): boolean {
  return page.screen === "Member";
}

/** Story: Reach every outcome / A person can join, find they are in, be blocked, leave for cloud sign-in or see each error (spec/browserJoin.md) */
//@ pure
export function sometimesUnderAge(page: JoinPage): boolean {
  return page.screen === "Blocked" && page.reason === "UnderAge";
}

/** Story: Reach every outcome / A person can join, find they are in, be blocked, leave for cloud sign-in or see each error (spec/browserJoin.md) */
//@ pure
export function sometimesInviteOnly(page: JoinPage): boolean {
  return page.screen === "Blocked" && page.reason === "InviteOnly";
}

/** Story: Reach every outcome / A person can join, find they are in, be blocked, leave for cloud sign-in or see each error (spec/browserJoin.md) */
//@ pure
export function sometimesInReview(page: JoinPage): boolean {
  return page.screen === "Blocked" && page.reason === "InReview";
}

/** Story: Reach every outcome / A person can join, find they are in, be blocked, leave for cloud sign-in or see each error (spec/browserJoin.md) */
//@ pure
export function sometimesNotValid(page: JoinPage): boolean {
  return page.screen === "Blocked" && page.reason === "NotValid";
}

/** Story: Reach every outcome / A person can join, find they are in, be blocked, leave for cloud sign-in or see each error (spec/browserJoin.md) */
//@ pure
export function sometimesOtherReason(page: JoinPage): boolean {
  return page.screen === "Blocked" && page.reason === "OtherReason";
}

/** Story: Reach every outcome / A person can join, find they are in, be blocked, leave for cloud sign-in or see each error (spec/browserJoin.md) */
//@ pure
export function sometimesCheckRejected(page: JoinPage): boolean {
  return page.screen === "Phone" && page.formError === "CheckRejected";
}

/** Story: Reach every outcome / A person can join, find they are in, be blocked, leave for cloud sign-in or see each error (spec/browserJoin.md) */
//@ pure
export function sometimesCodeFormat(page: JoinPage): boolean {
  return page.formError === "CodeFormat";
}

/** Story: Reach every outcome / A person can join, find they are in, be blocked, leave for cloud sign-in or see each error (spec/browserJoin.md) */
//@ pure
export function sometimesProfileIncomplete(page: JoinPage): boolean {
  return page.formError === "ProfileIncomplete";
}

/** Story: Reach every outcome / A person can join, find they are in, be blocked, leave for cloud sign-in or see each error (spec/browserJoin.md) */
//@ pure
export function sometimesRequestFailed(page: JoinPage): boolean {
  return page.formError === "RequestFailed";
}

/** Story: Reach every outcome / A person can join, find they are in, be blocked, leave for cloud sign-in or see each error (spec/browserJoin.md) */
//@ pure
export function sometimesLeftForCloud(page: JoinPage): boolean {
  return page.screen === "LeftForCloud";
}

/** Story: Reach every outcome / A person can join, find they are in, be blocked, leave for cloud sign-in or see each error (spec/browserJoin.md) */
//@ pure
export function sometimesCloudUnavailable(page: JoinPage): boolean {
  return page.formError === "CloudUnavailable";
}

/** Story: Reach every outcome / A person can join, find they are in, be blocked, leave for cloud sign-in or see each error (spec/browserJoin.md) */
//@ pure
export function sometimesApiUnreachable(page: JoinPage): boolean {
  return page.notice === "ApiUnreachable";
}

/** Story: Reach every outcome / A person can join, find they are in, be blocked, leave for cloud sign-in or see each error (spec/browserJoin.md) */
//@ pure
export function sometimesSessionEnded(page: JoinPage): boolean {
  return page.screen === "Phone" && page.notice === "SessionEnded";
}

/** Story: Reach every outcome / A person can join, find they are in, be blocked, leave for cloud sign-in or see each error (spec/browserJoin.md) */
//@ pure
export function sometimesAccountChanged(page: JoinPage): boolean {
  return page.screen !== "Checking" && page.notice === "AccountChanged";
}

/** Story: Reach every outcome / A person can join, find they are in, be blocked, leave for cloud sign-in or see each error (spec/browserJoin.md) */
//@ pure
export function sometimesInvalidPhone(page: JoinPage): boolean {
  return page.formError === "InvalidPhone";
}

/** Story: Reach every outcome / A person can join, find they are in, be blocked, leave for cloud sign-in or see each error (spec/browserJoin.md) */
//@ pure
export function sometimesCheckPending(page: JoinPage): boolean {
  return page.formError === "CheckPending";
}

/** Story: Reach every outcome / A person can join, find they are in, be blocked, leave for cloud sign-in or see each error (spec/browserJoin.md) */
//@ pure
export function sometimesCheckFailed(page: JoinPage): boolean {
  return page.formError === "CheckFailed";
}

/** Story: Reach every outcome / A person can join, find they are in, be blocked, leave for cloud sign-in or see each error (spec/browserJoin.md) */
//@ pure
export function sometimesCheckAgain(page: JoinPage): boolean {
  return page.screen === "Phone" && page.formError === "CheckAgain";
}

/** Story: Reach every outcome / A person can join, find they are in, be blocked, leave for cloud sign-in or see each error (spec/browserJoin.md) */
//@ pure
export function sometimesRateLimited(page: JoinPage): boolean {
  return page.formError === "RateLimited";
}

/** Story: Reach every outcome / A person can join, find they are in, be blocked, leave for cloud sign-in or see each error (spec/browserJoin.md) */
//@ pure
export function sometimesInvalidCode(page: JoinPage): boolean {
  return page.formError === "InvalidCode";
}

/** Story: Reach every outcome / A person can join, find they are in, be blocked, leave for cloud sign-in or see each error (spec/browserJoin.md) */
//@ pure
export function sometimesNewCodeSent(page: JoinPage): boolean {
  return page.formError === "NewCodeSent";
}

/** Story: Reach every outcome / A person can join, find they are in, be blocked, leave for cloud sign-in or see each error (spec/browserJoin.md) */
//@ pure
export function sometimesPrefilledProfile(page: JoinPage): boolean {
  return page.screen === "Profile" && page.formHasValues;
}

/** Story: Reach every outcome / A person can join, find they are in, be blocked, leave for cloud sign-in or see each error (spec/browserJoin.md) */
//@ pure
export function sometimesJoinedFromAgent(page: JoinPage): boolean {
  return agentReturnShown(page);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: JoinPage, event: Event): boolean {
  if (event.type === "openPage") return canOpenPage(current);
  if (event.type === "loaded") return canLoaded(current, event.view);
  if (event.type === "readAuthMode") return canReadAuthMode(current);
  if (event.type === "expireCheck") return canExpireCheck(current);
  if (event.type === "submitPhone") return canSubmitPhone(current);
  if (event.type === "settleCheck") return canSettleCheck(current);
  if (event.type === "answerCodeStart") return canAnswerCodeStart(current);
  if (event.type === "submitCode") return canSubmitCode(current);
  if (event.type === "answerVerify") return canAnswerVerify(current);
  if (event.type === "resendCode") return canResendCode(current);
  if (event.type === "changeNumber") return canChangeNumber(current);
  if (event.type === "answerResend") return canAnswerResend(current);
  if (event.type === "continueWithPhone") return canContinueWithPhone(current);
  if (event.type === "answerCloudStart") return canAnswerCloudStart(current);
  if (event.type === "recheck") return canRecheck(current, event.view);
  if (event.type === "editProfile") return canEditProfile(current);
  if (event.type === "submitProfile") return canSubmitProfile(current);
  if (event.type === "answerJoin") return canAnswerJoin(current);
  if (event.type === "restoreCloudPrefill") return canRestoreCloudPrefill(current, event.view);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: JoinPage, event: Event): JoinPage {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "openPage" && canOpenPage(current)) return openPage(current, event.viaAgent, event.fragmentName, event.ageDigitsOnly, event.ageDigitCount, event.fragmentAge);
  if (event.type === "loaded" && canLoaded(current, event.view)) return loaded(current, event.view, event.appUnreachable, event.inviteOnly);
  if (event.type === "readAuthMode" && canReadAuthMode(current)) return readAuthMode(current, event.lookup, event.checkOn);
  if (event.type === "expireCheck" && canExpireCheck(current)) return expireCheck(current);
  if (event.type === "submitPhone" && canSubmitPhone(current)) return submitPhone(current, event.phoneValid);
  if (event.type === "settleCheck" && canSettleCheck(current)) return settleCheck(current, event.passed);
  if (event.type === "answerCodeStart" && canAnswerCodeStart(current)) return answerCodeStart(current, event.started);
  if (event.type === "submitCode" && canSubmitCode(current)) return submitCode(current, event.codeDigitCount);
  if (event.type === "answerVerify" && canAnswerVerify(current)) return answerVerify(current, event.verifyAnswer);
  if (event.type === "resendCode" && canResendCode(current)) return resendCode(current);
  if (event.type === "changeNumber" && canChangeNumber(current)) return changeNumber(current);
  if (event.type === "answerResend" && canAnswerResend(current)) return answerResend(current, event.resent);
  if (event.type === "continueWithPhone" && canContinueWithPhone(current)) return continueWithPhone(current);
  if (event.type === "answerCloudStart" && canAnswerCloudStart(current)) return answerCloudStart(current, event.opened);
  if (event.type === "recheck" && canRecheck(current, event.view)) return recheck(current, event.view);
  if (event.type === "editProfile" && canEditProfile(current)) return editProfile(current);
  if (event.type === "submitProfile" && canSubmitProfile(current)) return submitProfile(current, event.form);
  if (event.type === "answerJoin" && canAnswerJoin(current)) return answerJoin(current, event.joinAnswer);
  if (event.type === "restoreCloudPrefill" && canRestoreCloudPrefill(current, event.view)) return restoreCloudPrefill(current, event.view, event.fromAgent, event.hasFields);
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
  const is_SessionView = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && (v.result === "SignedOut" || v.result === "ReadFailed" || v.result === "MayJoin" || v.result === "AlreadyIn" || v.result === "MayNotJoin") && Number.isSafeInteger(v.account) && (v.reason === "NoBlock" || v.reason === "UnderAge" || v.reason === "InviteOnly" || v.reason === "InReview" || v.reason === "NotValid" || v.reason === "OtherReason");
  const is_ProfileForm = (v: any): boolean => typeof v === "object" && v !== null && !Array.isArray(v) && typeof v.nameGiven === "boolean" && Number.isSafeInteger(v.age) && typeof v.consentTicked === "boolean";
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "openPage" && typeof raw.viaAgent === "boolean" && typeof raw.fragmentName === "boolean" && typeof raw.ageDigitsOnly === "boolean" && Number.isSafeInteger(raw.ageDigitCount) && Number.isSafeInteger(raw.fragmentAge)) return { type: "openPage", viaAgent: raw.viaAgent, fragmentName: raw.fragmentName, ageDigitsOnly: raw.ageDigitsOnly, ageDigitCount: raw.ageDigitCount, fragmentAge: raw.fragmentAge };
  if (raw.type === "loaded" && is_SessionView(raw.view) && typeof raw.appUnreachable === "boolean" && typeof raw.inviteOnly === "boolean") return { type: "loaded", view: ({ result: raw.view.result, account: raw.view.account, reason: raw.view.reason }), appUnreachable: raw.appUnreachable, inviteOnly: raw.inviteOnly };
  if (raw.type === "readAuthMode" && (raw.lookup === "LookupFailed" || raw.lookup === "ModeOtp" || raw.lookup === "ModeCloud") && typeof raw.checkOn === "boolean") return { type: "readAuthMode", lookup: raw.lookup, checkOn: raw.checkOn };
  if (raw.type === "expireCheck") return { type: "expireCheck" };
  if (raw.type === "submitPhone" && typeof raw.phoneValid === "boolean") return { type: "submitPhone", phoneValid: raw.phoneValid };
  if (raw.type === "settleCheck" && typeof raw.passed === "boolean") return { type: "settleCheck", passed: raw.passed };
  if (raw.type === "answerCodeStart" && (raw.started === "CodeSent" || raw.started === "StartRateLimited" || raw.started === "StartCheckRejected" || raw.started === "StartFailed")) return { type: "answerCodeStart", started: raw.started };
  if (raw.type === "submitCode" && Number.isSafeInteger(raw.codeDigitCount)) return { type: "submitCode", codeDigitCount: raw.codeDigitCount };
  if (raw.type === "answerVerify" && (raw.verifyAnswer === "Verified" || raw.verifyAnswer === "WrongCode" || raw.verifyAnswer === "VerifyRateLimited" || raw.verifyAnswer === "VerifyFailed")) return { type: "answerVerify", verifyAnswer: raw.verifyAnswer };
  if (raw.type === "resendCode") return { type: "resendCode" };
  if (raw.type === "changeNumber") return { type: "changeNumber" };
  if (raw.type === "answerResend" && (raw.resent === "CodeSent" || raw.resent === "StartRateLimited" || raw.resent === "StartCheckRejected" || raw.resent === "StartFailed")) return { type: "answerResend", resent: raw.resent };
  if (raw.type === "continueWithPhone") return { type: "continueWithPhone" };
  if (raw.type === "answerCloudStart" && typeof raw.opened === "boolean") return { type: "answerCloudStart", opened: raw.opened };
  if (raw.type === "recheck" && is_SessionView(raw.view)) return { type: "recheck", view: ({ result: raw.view.result, account: raw.view.account, reason: raw.view.reason }) };
  if (raw.type === "editProfile") return { type: "editProfile" };
  if (raw.type === "submitProfile" && is_ProfileForm(raw.form)) return { type: "submitProfile", form: ({ nameGiven: raw.form.nameGiven, age: raw.form.age, consentTicked: raw.form.consentTicked }) };
  if (raw.type === "answerJoin" && (raw.joinAnswer === "JoinedOk" || raw.joinAnswer === "JoinUnderAge" || raw.joinAnswer === "JoinInviteOnly" || raw.joinAnswer === "JoinReview" || raw.joinAnswer === "JoinAccountChanged" || raw.joinAnswer === "JoinUnauthorized" || raw.joinAnswer === "JoinInvalidInvitation" || raw.joinAnswer === "JoinFailed")) return { type: "answerJoin", joinAnswer: raw.joinAnswer };
  if (raw.type === "restoreCloudPrefill" && is_SessionView(raw.view) && typeof raw.fromAgent === "boolean" && typeof raw.hasFields === "boolean") return { type: "restoreCloudPrefill", view: ({ result: raw.view.result, account: raw.view.account, reason: raw.view.reason }), fromAgent: raw.fromAgent, hasFields: raw.hasFields };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): JoinPage | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.screen === "Opening" || raw.screen === "Loading" || raw.screen === "Phone" || raw.screen === "Code" || raw.screen === "Checking" || raw.screen === "Profile" || raw.screen === "Member" || raw.screen === "Blocked" || raw.screen === "Done" || raw.screen === "LeftForCloud") && (raw.auth === "AuthPending" || raw.auth === "OtpMode" || raw.auth === "CloudMode") && (raw.check === "NoCheck" || raw.check === "CheckRunning" || raw.check === "CheckPassed" || raw.check === "CheckBroken") && (raw.pending === "Idle" || raw.pending === "StartingCode" || raw.pending === "VerifyingCode" || raw.pending === "ResendingCode" || raw.pending === "SavingProfile" || raw.pending === "OpeningCloud") && (raw.reason === "NoBlock" || raw.reason === "UnderAge" || raw.reason === "InviteOnly" || raw.reason === "InReview" || raw.reason === "NotValid" || raw.reason === "OtherReason") && (raw.notice === "NoNotice" || raw.notice === "ApiUnreachable" || raw.notice === "SessionEnded" || raw.notice === "AccountChanged") && (raw.formError === "NoError" || raw.formError === "InvalidPhone" || raw.formError === "CheckPending" || raw.formError === "CheckFailed" || raw.formError === "CheckRejected" || raw.formError === "CheckAgain" || raw.formError === "RateLimited" || raw.formError === "CodeFormat" || raw.formError === "InvalidCode" || raw.formError === "NewCodeSent" || raw.formError === "ProfileIncomplete" || raw.formError === "CloudUnavailable" || raw.formError === "RequestFailed") && Number.isSafeInteger(raw.account) && typeof raw.inviteOnly === "boolean" && typeof raw.viaAgent === "boolean" && typeof raw.addressClean === "boolean" && typeof raw.formHasValues === "boolean" && typeof raw.consented === "boolean" && Object.keys(raw).length === 13)) return undefined;
  const parsed: JoinPage = ({ screen: raw.screen, auth: raw.auth, check: raw.check, pending: raw.pending, reason: raw.reason, notice: raw.notice, formError: raw.formError, account: raw.account, inviteOnly: raw.inviteOnly, viaAgent: raw.viaAgent, addressClean: raw.addressClean, formHasValues: raw.formHasValues, consented: raw.consented });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): JoinPage {
  //@ ensures inv(\result)
  return initial;
}
