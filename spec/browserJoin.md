# Join in the browser

The peon.biz site keeps one browser page at `/join`. A person's agent sends the person to `https://peon.biz/join?via=agent#firstName=..&age=..`. On this page the person confirms their own phone, reviews their first name and age, agrees to the texts and joins. This spec models only what the page shows and what the page lets the person do. The server owns the join rules ([site enrollment](siteEnrollment.md)) and the code limits ([phone verification limits](otpLimits.md)). The browser shell owns the address, the fetch calls, the security check widget, the focus and the copy. The shell keeps a Peon invitation token only in the page's memory: the token survives direct phone verification in the same page, the Cloud phone sign-in provider receives no token, and the page puts no invitation in persistent storage. After Cloud returns, the person reopens the original invitation link in the verified session. For a first Cloud sign-in, the site can seal the allowed name, age and agent-return flag with the pending Peon handoff, and the Cloud service receives none of these fields. If the callback issues a session, the site makes the draft available until the handoff expires. The site clears the draft cookie when the returning tab presents its one-use receipt. The page stores only the receipt across navigation and clears it on return. The shell sends each server answer to this machine as one event. The public sites have no sign-in link, no settings page and no member dashboard: this page is only for joining.

## Story: Open the join page from my agent's link

> As a person who approved a profile with my agent, I want the join page to show the first name and age that I approved, so that I only check them and do not type them again.

### The page takes the approved name and age from the fragment and then removes the fragment

The agent puts only the first name and the age in the fragment, after `#`. The page reads them once, when it opens. It keeps at most 50 characters of the name. It keeps the age only when the age has only digits, has one to three digits and is not more than 120. A name or an accepted age fills the profile form. Then the page removes the fragment from the address, before it loads anything. The page also records if the link came from an agent (`via=agent`).

```quint
type JoinScreen = Opening | Loading | Phone | Code | Checking | Profile | Member | Blocked | Done | LeftForCloud
type AuthMode = AuthPending | OtpMode | CloudMode
type CheckState = NoCheck | CheckRunning | CheckPassed | CheckBroken
type Pending = Idle | StartingCode | VerifyingCode | ResendingCode | SavingProfile | OpeningCloud
type BlockReason = NoBlock | UnderAge | InviteOnly | InReview | NotValid | OtherReason
type FlowNotice = NoNotice | ApiUnreachable | SessionEnded | AccountChanged
type InlineError = NoError | InvalidPhone | CheckPending | CheckFailed | CheckRejected | CheckAgain |
  RateLimited | CodeFormat | InvalidCode | NewCodeSent | ProfileIncomplete | CloudUnavailable | RequestFailed
type JoinPage = {
  screen: JoinScreen,
  auth: AuthMode,
  check: CheckState,
  pending: Pending,
  reason: BlockReason,
  notice: FlowNotice,
  formError: InlineError,
  account: int,
  inviteOnly: bool,
  viaAgent: bool,
  addressClean: bool,
  formHasValues: bool,
  consented: bool,
}
pure val initial: JoinPage = {
  screen: Opening, auth: AuthPending, check: NoCheck, pending: Idle, reason: NoBlock, notice: NoNotice,
  formError: NoError, account: 0, inviteOnly: false, viaAgent: false, addressClean: false,
  formHasValues: false, consented: false,
}

pure val fragmentNameMax = 50
pure val fragmentAgeValues = Set(0, 7, 120, 121)
pure val ageDigitCountValues = Set(0, 1, 3, 4)

pure def fragmentNameKept(nameLength: int): int =
  if (nameLength > fragmentNameMax) fragmentNameMax else nameLength

pure def lawFragmentNameKeptWithinLimit(nameLength: int): bool =
  fragmentNameKept(nameLength) <= fragmentNameMax

pure def fragmentAgeAccepted(ageDigitsOnly: bool, ageDigitCount: int, fragmentAge: int): bool =
  ageDigitsOnly and ageDigitCount >= 1 and ageDigitCount <= 3 and fragmentAge <= 120

pure def canOpenPage(page: JoinPage): bool = page.screen == Opening

pure def openPage(page: JoinPage, viaAgent: bool, fragmentName: bool, ageDigitsOnly: bool, ageDigitCount: int, fragmentAge: int): JoinPage =
  { ...page, screen: Loading, viaAgent: viaAgent, addressClean: true,
    formHasValues: fragmentName or fragmentAgeAccepted(ageDigitsOnly, ageDigitCount, fragmentAge) }

pure def alwaysAddressCleanAfterOpening(page: JoinPage): bool =
  page.screen != Opening implies page.addressClean

pure def lawFragmentAgeNeverAboveLimit(ageDigitsOnly: bool, ageDigitCount: int, fragmentAge: int): bool =
  (not(ageDigitsOnly) or ageDigitCount < 1 or ageDigitCount > 3 or fragmentAge > 120)
    implies not(fragmentAgeAccepted(ageDigitsOnly, ageDigitCount, fragmentAge))
```

## Story: See where I stand before I do anything

> As a person who opens the join page, I want the page to show the step that applies to me, so that I do not confirm my phone again when I am already signed in or already a member.

### The page shows the step that the current session allows

While the page loads, it shows a loading step. It reads the app and the session together. A signed-out person, or a session that the page cannot read, gets the phone step. A person who can join gets the profile step. A member gets the "already in" step. A person who cannot join gets the blocked step with the reason from the server. When the server gives no reason, the reason is "invite only" for an invite-only app, and a general reason for other apps. When the page cannot reach the app API, it shows a notice above the steps. The age hint shows the app's minimum join age, or the page's own default when the page cannot read the app.

```quint
type SessionResult = SignedOut | ReadFailed | MayJoin | AlreadyIn | MayNotJoin
type SessionView = { result: SessionResult, account: int, reason: BlockReason }
pure val viewValues = Set(
  { result: SignedOut, account: 0, reason: NoBlock },
  { result: ReadFailed, account: 0, reason: NoBlock },
  { result: MayJoin, account: 1, reason: NoBlock },
  { result: MayJoin, account: 2, reason: NoBlock },
  { result: AlreadyIn, account: 1, reason: NoBlock },
  { result: MayNotJoin, account: 1, reason: UnderAge },
  { result: MayNotJoin, account: 2, reason: NoBlock },
  { result: MayNotJoin, account: 1, reason: InReview },
  { result: MayNotJoin, account: 2, reason: NotValid },
)

pure def signedInResult(result: SessionResult): bool =
  result == MayJoin or result == AlreadyIn or result == MayNotJoin

pure def sessionConsistent(view: SessionView): bool =
  if (signedInResult(view.result)) view.account > 0 else view.account == 0

pure def screenFor(view: SessionView): JoinScreen =
  if (view.result == MayJoin) Profile
  else if (view.result == AlreadyIn) Member
  else if (view.result == MayNotJoin) Blocked
  else Phone

pure def blockReasonFor(reason: BlockReason, inviteOnly: bool): BlockReason =
  if (reason == NoBlock) (if (inviteOnly) InviteOnly else OtherReason) else reason

pure def reasonFor(view: SessionView, inviteOnly: bool): BlockReason =
  if (view.result == MayNotJoin) blockReasonFor(view.reason, inviteOnly) else NoBlock

pure def routed(view: SessionView, page: JoinPage, inviteOnly: bool): JoinPage =
  { ...page, screen: screenFor(view), reason: reasonFor(view, inviteOnly), account: view.account,
    inviteOnly: inviteOnly, pending: Idle, formError: NoError }

pure def minJoinAgeShown(appRead: bool, appMinAge: int, pageMinAge: int): int =
  if (appRead) appMinAge else pageMinAge

pure def canLoaded(page: JoinPage, view: SessionView): bool =
  page.screen == Loading and sessionConsistent(view)

pure def loaded(page: JoinPage, view: SessionView, appUnreachable: bool, inviteOnly: bool): JoinPage =
  val routedPage = routed(view, page, inviteOnly)
  { ...routedPage, notice: if (appUnreachable) ApiUnreachable else NoNotice }

pure def lawSignedOutSeesPhone(view: SessionView): bool =
  not(signedInResult(view.result)) implies screenFor(view) == Phone

pure def lawBlockedAlwaysHasReason(reason: BlockReason, inviteOnly: bool): bool =
  blockReasonFor(reason, inviteOnly) != NoBlock
```

### Only a signed-out page asks for a phone, and only a signed-in page shows a profile

The opening, loading, phone, code, checking and cloud steps belong to a page with no account. The checking step has no account because the page has not read the new session yet. The profile, member, blocked and done steps belong to a page with an account. The blocked step always shows a reason, and no other step has one.

```quint
pure def screenHasNoAccount(screen: JoinScreen): bool =
  screen == Opening or screen == Loading or screen == Phone or screen == Code or screen == Checking or screen == LeftForCloud

pure def alwaysPhoneStepsHaveNoAccount(page: JoinPage): bool =
  screenHasNoAccount(page.screen) implies page.account == 0

pure def alwaysAccountStepsHaveAccount(page: JoinPage): bool =
  not(screenHasNoAccount(page.screen)) implies page.account > 0

pure def alwaysBlockedHasReason(page: JoinPage): bool =
  (page.screen == Blocked) iff (page.reason != NoBlock)
```

## Story: Confirm my own phone

> As a person who joins, I want to type my own number and the code that you text me, so that nobody else, and no agent, can confirm my phone for me.

### The page asks the server which sign-in to use and uses text codes when it cannot tell

After the page loads, it asks the server for the sign-in mode. The phone form is busy until the answer arrives. Only a "cloud" answer gives the cloud sign-in. Any other answer, and a lookup that fails after its retries, gives the text-code sign-in. The security check runs only with the text-code sign-in, and only when the site has a check key.

```quint
type AuthLookup = LookupFailed | ModeOtp | ModeCloud

pure def authModeFor(lookup: AuthLookup): AuthMode = if (lookup == ModeCloud) CloudMode else OtpMode

pure def canReadAuthMode(page: JoinPage): bool =
  page.auth == AuthPending and page.screen != Opening and page.screen != Loading

pure def readAuthMode(page: JoinPage, lookup: AuthLookup, checkOn: bool): JoinPage =
  { ...page, auth: authModeFor(lookup),
    check: if (authModeFor(lookup) == OtpMode and checkOn) CheckRunning else NoCheck }

pure def phoneFormWaiting(page: JoinPage): bool = page.screen == Phone and page.auth == AuthPending
pure def showsNumberForm(page: JoinPage): bool = page.screen == Phone and page.auth == OtpMode
pure def showsCloudButton(page: JoinPage): bool = page.screen == Phone and page.auth == CloudMode

pure def alwaysCheckOnlyWithTextCodes(page: JoinPage): bool =
  page.check != NoCheck implies page.auth == OtpMode

pure def lawOnlyCloudAnswerUsesCloud(lookup: AuthLookup): bool =
  (authModeFor(lookup) == CloudMode) iff (lookup == ModeCloud)
```

### The page sends a number only when it is valid and the security check passed

The page refuses a number that is not a 10-digit US mobile number, and shows "invalid phone". While the security check runs, the page refuses to send and asks the person to wait. When the check failed, the page refuses to send and asks the person to refresh. A check that fails while the phone step shows replaces an empty error, "wait for the check" or "check failed". A check that passes clears "wait for the check" and "check failed". It keeps other errors, including a refused check or "confirm the check" after a resend. A passed check can expire, and then it runs again. A code request starts only when the check passed, or when the site has no check.

```quint
pure def canSettleCheck(page: JoinPage): bool = page.check == CheckRunning

pure def settleCheck(page: JoinPage, passed: bool): JoinPage =
  val checkError = page.formError == CheckPending or page.formError == CheckFailed
  val shown =
    if (page.screen != Phone) page.formError
    else if (not(passed) and (page.formError == NoError or checkError)) CheckFailed
    else if (passed and checkError) NoError
    else page.formError
  { ...page, check: if (passed) CheckPassed else CheckBroken, formError: shown }

pure def canExpireCheck(page: JoinPage): bool = page.check == CheckPassed

pure def expireCheck(page: JoinPage): JoinPage = { ...page, check: CheckRunning }

pure def canSubmitPhone(page: JoinPage): bool =
  page.screen == Phone and page.auth == OtpMode and page.pending == Idle

pure def submitPhone(page: JoinPage, phoneValid: bool): JoinPage =
  if (not(phoneValid)) { ...page, formError: InvalidPhone }
  else if (page.check == CheckRunning) { ...page, formError: CheckPending }
  else if (page.check == CheckBroken) { ...page, formError: CheckFailed }
  else { ...page, pending: StartingCode, formError: NoError }

pure def stepCodeRequestNeedsPassedCheck(before: JoinPage, via: str, after: JoinPage): bool =
  (via == "submitPhone" and after.pending == StartingCode)
    implies (before.check == CheckPassed or before.check == NoCheck)
```

### A sent code opens the code step, and each answer uses up the security check

When the server sends the code, the page shows the code step with the masked number and an empty code field. When the server refuses, the page stays on the phone step and shows why: too many tries, a refused security check, or a general failure. After every answer, the security check runs again, because one check passes one request only.

```quint
type StartResult = CodeSent | StartRateLimited | StartCheckRejected | StartFailed

pure def startError(started: StartResult): InlineError =
  if (started == CodeSent) NewCodeSent
  else if (started == StartRateLimited) RateLimited
  else if (started == StartCheckRejected) CheckRejected
  else RequestFailed

pure def canAnswerCodeStart(page: JoinPage): bool = page.pending == StartingCode

pure def answerCodeStart(page: JoinPage, started: StartResult): JoinPage =
  val spent = if (page.check == NoCheck) NoCheck else CheckRunning
  if (started == CodeSent) { ...page, pending: Idle, check: spent, screen: Code, formError: NoError }
  else { ...page, pending: Idle, check: spent, formError: startError(started) }

pure def stepCheckSpentAfterCodeStart(before: JoinPage, via: str, after: JoinPage): bool =
  via == "answerCodeStart" implies after.check != CheckPassed

pure def alwaysCodeStepUsesTextCodes(page: JoinPage): bool =
  page.screen == Code implies page.auth == OtpMode
```

### Only a well-formed code goes to the server, and only a verified code signs the person in

The page refuses a code with fewer than 4 or more than 8 digits. The shell removes all characters that are not digits and sends only the count of the digits. This model keeps the two limits, and the shell does not compare the count itself. A code with a count out of the limits never goes to the server. A wrong or expired code, too many tries, or a general failure keeps the code step and shows why. A verified code clears the notice and the page reads the session again.

```quint
type VerifyResult = Verified | WrongCode | VerifyRateLimited | VerifyFailed

pure val codeDigitsMin = 4
pure val codeDigitsMax = 8
pure val codeDigitCountValues = Set(0, 3, 4, 8, 9)

pure def codeLengthAccepted(codeDigitCount: int): bool =
  codeDigitCount >= codeDigitsMin and codeDigitCount <= codeDigitsMax

pure def canSubmitCode(page: JoinPage): bool = page.screen == Code and page.pending == Idle

pure def submitCode(page: JoinPage, codeDigitCount: int): JoinPage =
  if (codeLengthAccepted(codeDigitCount)) { ...page, pending: VerifyingCode } else { ...page, formError: CodeFormat }

pure def lawCodeOutsideLimitsNeverVerified(page: JoinPage, codeDigitCount: int): bool =
  (codeDigitCount < codeDigitsMin or codeDigitCount > codeDigitsMax)
    implies submitCode(page, codeDigitCount).pending == page.pending

pure def canAnswerVerify(page: JoinPage): bool = page.pending == VerifyingCode

pure def answerVerify(page: JoinPage, verifyAnswer: VerifyResult): JoinPage =
  if (verifyAnswer == Verified) { ...page, pending: Idle, screen: Checking, notice: NoNotice, formError: NoError }
  else if (verifyAnswer == WrongCode) { ...page, pending: Idle, formError: InvalidCode }
  else if (verifyAnswer == VerifyRateLimited) { ...page, pending: Idle, formError: RateLimited }
  else { ...page, pending: Idle, formError: RequestFailed }
```

### A new code needs a new security check when the check is on

On the code step the person can ask for a new code or change the number. With the security check on, "resend" goes back to the phone step, keeps the number, and asks the person to confirm the check. Without the check, the page asks the server again and shows "new code sent" or why it failed. Thus a code request without a check token goes to the server only when the site has no check. "Change number" goes back to the phone step with no error and keeps the profile values.

```quint
pure def canResendCode(page: JoinPage): bool = page.screen == Code and page.pending == Idle

pure def resendCode(page: JoinPage): JoinPage =
  if (page.check != NoCheck) { ...page, screen: Phone, formError: CheckAgain }
  else { ...page, pending: ResendingCode }

pure def canAnswerResend(page: JoinPage): bool = page.pending == ResendingCode

pure def answerResend(page: JoinPage, resent: StartResult): JoinPage =
  { ...page, pending: Idle, formError: startError(resent) }

pure def canChangeNumber(page: JoinPage): bool = page.screen == Code and page.pending == Idle

pure def changeNumber(page: JoinPage): JoinPage = { ...page, screen: Phone, formError: NoError }

pure def alwaysResendWithoutCheckOnly(page: JoinPage): bool =
  page.pending == ResendingCode implies page.check == NoCheck
```

### Cloud sign-in leaves the page to confirm the phone

With the cloud sign-in, the phone step shows one "Continue with your phone" button and no number field. The page asks the server for the cloud address. When it gets the address, the page goes there. When it does not, the page stays and says that sign-in is unavailable.

```quint
pure def canContinueWithPhone(page: JoinPage): bool =
  page.screen == Phone and page.auth == CloudMode and page.pending == Idle

pure def continueWithPhone(page: JoinPage): JoinPage = { ...page, pending: OpeningCloud }

pure def canAnswerCloudStart(page: JoinPage): bool = page.pending == OpeningCloud

pure def answerCloudStart(page: JoinPage, opened: bool): JoinPage =
  if (opened) { ...page, pending: Idle, screen: LeftForCloud }
  else { ...page, pending: Idle, formError: CloudUnavailable }
```

### After sign-in the page reads the session again and shows its step

The page routes the new session as it does when it loads. When the session is gone, the page shows the phone step with "session ended". When the page cannot read the session, it shows the phone step with "cannot reach the server". An "account changed" notice stays through the session read, until a verified code or a saved profile clears it.

```quint
pure def canRecheck(page: JoinPage, view: SessionView): bool =
  page.screen == Checking and sessionConsistent(view)

pure def recheck(page: JoinPage, view: SessionView): JoinPage =
  val routedPage = routed(view, page, page.inviteOnly)
  { ...routedPage, notice:
    if (signedInResult(view.result) or page.notice == AccountChanged) page.notice
    else if (view.result == SignedOut) SessionEnded
    else ApiUnreachable }
```

## Story: Confirm my details and join

> As a person who confirmed my phone, I want to check my first name and age and agree to the texts myself, so that I join with details I approved.

### The page sends the profile only with a name, an age from 1 to 120 and the text consent ticked

The person can change the fields while no request runs. The page refuses a profile with no first name, an age that is not a whole number from 1 to 120, or the consent box not ticked. The page does not decide the minimum join age: the server does.

```quint
type ProfileForm = { nameGiven: bool, age: int, consentTicked: bool }
pure val formValues = Set(
  { nameGiven: true, age: 30, consentTicked: true },
  { nameGiven: true, age: 12, consentTicked: true },
  { nameGiven: true, age: 30, consentTicked: false },
  { nameGiven: false, age: 30, consentTicked: true },
  { nameGiven: true, age: 0, consentTicked: true },
  { nameGiven: true, age: 121, consentTicked: true },
)

pure def profileComplete(form: ProfileForm): bool =
  form.nameGiven and form.age >= 1 and form.age <= 120 and form.consentTicked

pure def canEditProfile(page: JoinPage): bool = page.screen == Profile and page.pending == Idle

pure def editProfile(page: JoinPage): JoinPage = { ...page, formHasValues: true }

pure def canSubmitProfile(page: JoinPage): bool = page.screen == Profile and page.pending == Idle

pure def submitProfile(page: JoinPage, form: ProfileForm): JoinPage =
  if (profileComplete(form)) { ...page, pending: SavingProfile, consented: true, formError: NoError }
  else { ...page, formError: ProfileIncomplete }

pure def lawProfileNeedsConsent(form: ProfileForm): bool =
  profileComplete(form) implies form.consentTicked
```

### The server answer decides between done, blocked and a new sign-in

A saved profile shows the done step and clears the notice. "Under age", "invite only", "review" and an unavailable invitation show the blocked step. "Account changed" clears the form, reads the session again and shows a notice. "Session ended" clears the form and shows the phone step with a notice. A temporary failure keeps the same account, profile values and consent on the profile step and shows the server's message. The person can retry the form when the failed request ends.

```quint
type JoinOutcome = JoinedOk | JoinUnderAge | JoinInviteOnly | JoinReview | JoinAccountChanged | JoinUnauthorized | JoinInvalidInvitation | JoinFailed

pure def joinRefusal(joinAnswer: JoinOutcome): BlockReason =
  if (joinAnswer == JoinUnderAge) UnderAge
  else if (joinAnswer == JoinInviteOnly) InviteOnly
  else if (joinAnswer == JoinReview) InReview
  else if (joinAnswer == JoinInvalidInvitation) NotValid
  else NoBlock

pure def canAnswerJoin(page: JoinPage): bool = page.pending == SavingProfile

pure def answerJoin(page: JoinPage, joinAnswer: JoinOutcome): JoinPage =
  val idle = { ...page, pending: Idle }
  val refusal = joinRefusal(joinAnswer)
  if (joinAnswer == JoinedOk) { ...idle, screen: Done, notice: NoNotice }
  else if (refusal != NoBlock) { ...idle, screen: Blocked, reason: refusal }
  else if (joinAnswer == JoinAccountChanged)
    { ...idle, screen: Checking, account: 0, formHasValues: false, consented: false, notice: AccountChanged, formError: NoError }
  else if (joinAnswer == JoinUnauthorized)
    { ...idle, screen: Phone, account: 0, formHasValues: false, consented: false, notice: SessionEnded, formError: NoError }
  else { ...idle, formError: RequestFailed }

pure def lawFailedSaveKeepsOwnedProfile(page: JoinPage): bool =
  val failed = answerJoin(page, JoinFailed)
  (page.screen == Profile and canAnswerJoin(page)) implies
    (canSubmitProfile(failed) and failed.account == page.account and
      failed.formHasValues == page.formHasValues and failed.consented == page.consented)
```

### A Peon invitation stays in memory until the verified account agrees to join

Read one valid token from Peon's issued `/join#invite=` link. Remove the fragment before any API request. Keep the token in the memory of this page. Only the same-origin Peon session can bind the token to its verified account marker. A new owner of the same verified phone has a different marker. The page sends the token, with its account marker, in the same-origin Join JSON request only when the bound account sends a complete profile with text consent and the address is clean. The server decides whether the invitation is current and can be accepted by that account. If it refuses the invitation, the page cannot join without it on that attempt. The page clears the token after a definite answer, and when it loses or replaces the verified account. A temporary request failure can retry with the same verified account.

An invitation stays through direct phone verification in the same page. The Cloud phone sign-in provider receives no invitation token. After Cloud returns, open the original invitation link again in the verified session. The page puts no invitation in persistent storage.

```quint
pure def browserInvitationMayBind(peonApp: bool, verifiedView: bool): bool =
  peonApp and verifiedView

pure def browserInvitationMaySubmit(boundAccount: bool, addressClean: bool, consented: bool): bool =
  boundAccount and addressClean and consented

pure def browserInvitationKeepsAccount(beforeAccount: int, afterAccount: int): bool =
  beforeAccount == 0 or beforeAccount == afterAccount

pure def browserInvitationMayRetry(joinAnswer: JoinOutcome): bool =
  joinAnswer == JoinFailed

pure def lawBrowserInvitationNeedsCleanConsentedAccount(page: JoinPage, form: ProfileForm, boundAccount: bool): bool =
  val submitted = submitProfile(page, form)
  (canSubmitProfile(page) and canAnswerJoin(submitted) and browserInvitationMaySubmit(boundAccount, submitted.addressClean, submitted.consented))
    implies (boundAccount and page.addressClean and profileComplete(form) and submitted.consented)

pure def lawBrowserInvitationKeptOnlyForRetry(joinAnswer: JoinOutcome): bool =
  browserInvitationMayRetry(joinAnswer) implies (joinRefusal(joinAnswer) == NoBlock and answerJoin(initial, joinAnswer).screen == initial.screen)

pure def lawBrowserInvitationCannotRideAnotherAccount(beforeAccount: int, afterAccount: int): bool =
  (beforeAccount > 0 and beforeAccount != afterAccount) implies
    not(browserInvitationKeepsAccount(beforeAccount, afterAccount))
```

### Profile values never pass from one account to another

The approved name and age from the agent's link stay in the form through the first sign-in. A changed number, a new code, a verified code and the session read after it do not clear the form. When the page loses or replaces the account that it shows, it clears the form.

For a first Cloud sign-in, the site can seal the allowed name, age and agent-return flag with the pending Peon handoff. The Cloud service receives none of these fields. If the callback issues a session, the site makes the draft available until the handoff expires. The returning tab presents its one-use receipt to the same-origin session read. Only the exact callback session on Peon, while it can join, receives the draft. A link with an agent flag, name, age or invitation takes precedence over a draft from a prior handoff. The page withholds the saved receipt for such a link. Only a loading page with an empty form and no agent flag can restore a draft. The page restores the fields without text consent. The site clears the draft cookie when the returning tab presents its receipt. The page stores only the receipt across navigation and clears it on return. An invitation stays in the original page's memory.

```quint
pure def stepFormClearedWhenAccountLeaves(before: JoinPage, after: JoinPage): bool =
  (before.account > 0 and after.account != before.account) implies not(after.formHasValues)

pure def stepSignInKeepsFormValues(before: JoinPage, via: str, after: JoinPage): bool =
  (before.account == 0 and
    (via == "changeNumber" or via == "resendCode" or via == "answerVerify" or via == "recheck"))
    implies after.formHasValues == before.formHasValues

pure def cloudJoinPrefillCanRead(eligible: bool, receiptMatches: bool, sessionMatches: bool, asOf: int, expiresAt: int): bool =
  eligible and receiptMatches and sessionMatches and asOf < expiresAt

pure def lawCloudPrefillNeedsOwnLiveHandoff(eligible: bool, receiptMatches: bool, sessionMatches: bool, asOf: int, expiresAt: int): bool =
  (not(receiptMatches) or not(sessionMatches) or asOf >= expiresAt) implies
    not(cloudJoinPrefillCanRead(eligible, receiptMatches, sessionMatches, asOf, expiresAt))

pure def browserPrefillMayPresentReceipt(fromAgent: bool, linkName: bool, linkAge: bool, linkInvitation: bool): bool =
  not(fromAgent or linkName or linkAge or linkInvitation)

pure def lawInvitationLinkDoesNotPresentPriorPrefillReceipt(fromAgent: bool, linkName: bool, linkAge: bool): bool =
  not(browserPrefillMayPresentReceipt(fromAgent, linkName, linkAge, true))

pure def canRestoreCloudPrefill(page: JoinPage, view: SessionView): bool =
  page.screen == Loading and view.result == MayJoin and sessionConsistent(view) and not(page.formHasValues) and not(page.viaAgent)

pure def lawCloudPrefillKeepsFreshFields(page: JoinPage, view: SessionView): bool =
  (page.formHasValues or page.viaAgent) implies not(canRestoreCloudPrefill(page, view))

pure def restoreCloudPrefill(page: JoinPage, view: SessionView, fromAgent: bool, hasFields: bool): JoinPage =
  { ...page, viaAgent: fromAgent, formHasValues: hasFields, consented: false }
```

### The done step comes only from a saved profile with consent

The done step needs a saved profile, a ticked consent box and an account. It shows no notice. When the person came from an agent's link, the done step also tells the person to go back to the same chat to finish the profile.

```quint
pure def agentReturnShown(page: JoinPage): bool = page.screen == Done and page.viaAgent

pure def alwaysDoneNeedsConsent(page: JoinPage): bool =
  page.screen == Done implies (page.consented and page.account > 0 and page.notice == NoNotice)

pure def stepDoneFollowsSavedProfile(before: JoinPage, via: str, after: JoinPage): bool =
  (after.screen == Done and before.screen != Done) implies (via == "answerJoin" and before.pending == SavingProfile)
```

## Story: Send each form only once

> As a person who presses a button, I want the page to wait for the answer before it accepts the form again, so that I do not send two codes or two profiles.

### A form that waits for an answer refuses a second submit

While a request runs, its form is busy: its controls are off and its button shows the busy label. The page starts a new request only when no request runs. Each request belongs to the step that started it.

```quint
pure def formBusy(page: JoinPage): bool = page.pending != Idle

pure def lawSavingProfilePreventsEditsAndSubmissions(page: JoinPage): bool =
  page.pending == SavingProfile implies (not(canEditProfile(page)) and not(canSubmitProfile(page)))

pure def stepOneRequestAtATime(before: JoinPage, after: JoinPage): bool =
  (after.pending != Idle and after.pending != before.pending) implies before.pending == Idle

pure def alwaysRequestBelongsToItsStep(page: JoinPage): bool =
  (page.pending == StartingCode implies (page.screen == Phone and page.auth == OtpMode)) and
  (page.pending == OpeningCloud implies (page.screen == Phone and page.auth == CloudMode)) and
  ((page.pending == VerifyingCode or page.pending == ResendingCode) implies (page.screen == Code and page.auth == OtpMode)) and
  (page.pending == SavingProfile implies (page.screen == Profile and page.consented))
```

## Story: Reach every outcome

> As a designer of the join page, I want each step, each refusal and each error of the page to be reachable, so that the design system gives each one a view.

### A person can join, find they are in, be blocked, leave for cloud sign-in or see each error

The page can reach the done step, with and without the agent line, the member step and each blocked reason. It can leave for cloud sign-in. It can show each notice and each inline error.

```quint
pure def sometimesJoined(page: JoinPage): bool = page.screen == Done
pure def sometimesJoinedFromAgent(page: JoinPage): bool = agentReturnShown(page)
pure def sometimesJoinedWithoutAgentLine(page: JoinPage): bool = page.screen == Done and not(page.viaAgent)
pure def sometimesAlreadyMember(page: JoinPage): bool = page.screen == Member
pure def sometimesUnderAge(page: JoinPage): bool = page.screen == Blocked and page.reason == UnderAge
pure def sometimesInviteOnly(page: JoinPage): bool = page.screen == Blocked and page.reason == InviteOnly
pure def sometimesInReview(page: JoinPage): bool = page.screen == Blocked and page.reason == InReview
pure def sometimesNotValid(page: JoinPage): bool = page.screen == Blocked and page.reason == NotValid
pure def sometimesOtherReason(page: JoinPage): bool = page.screen == Blocked and page.reason == OtherReason
pure def sometimesCheckRejected(page: JoinPage): bool = page.screen == Phone and page.formError == CheckRejected
pure def sometimesCodeFormat(page: JoinPage): bool = page.formError == CodeFormat
pure def sometimesProfileIncomplete(page: JoinPage): bool = page.formError == ProfileIncomplete
pure def sometimesRequestFailed(page: JoinPage): bool = page.formError == RequestFailed
pure def sometimesLeftForCloud(page: JoinPage): bool = page.screen == LeftForCloud
pure def sometimesCloudUnavailable(page: JoinPage): bool = page.formError == CloudUnavailable
pure def sometimesApiUnreachable(page: JoinPage): bool = page.notice == ApiUnreachable
pure def sometimesSessionEnded(page: JoinPage): bool = page.screen == Phone and page.notice == SessionEnded
pure def sometimesAccountChanged(page: JoinPage): bool = page.screen != Checking and page.notice == AccountChanged
pure def sometimesInvalidPhone(page: JoinPage): bool = page.formError == InvalidPhone
pure def sometimesCheckPending(page: JoinPage): bool = page.formError == CheckPending
pure def sometimesCheckFailed(page: JoinPage): bool = page.formError == CheckFailed
pure def sometimesCheckAgain(page: JoinPage): bool = page.screen == Phone and page.formError == CheckAgain
pure def sometimesRateLimited(page: JoinPage): bool = page.formError == RateLimited
pure def sometimesInvalidCode(page: JoinPage): bool = page.formError == InvalidCode
pure def sometimesNewCodeSent(page: JoinPage): bool = page.formError == NewCodeSent
pure def sometimesPrefilledProfile(page: JoinPage): bool = page.screen == Profile and page.formHasValues

pure val eval_witness_sometimesCodeFormat = (
  ("openPage", false, false, false, 0, 0),
  ("loaded", { result: SignedOut, account: 0, reason: NoBlock }, false, false),
  ("readAuthMode", ModeOtp, false),
  ("submitPhone", true),
  ("answerCodeStart", CodeSent),
  ("submitCode", 3)
)

pure val eval_witness_sometimesCheckAgain = (
  ("openPage", false, false, false, 0, 0),
  ("loaded", { result: SignedOut, account: 0, reason: NoBlock }, false, false),
  ("readAuthMode", ModeOtp, true),
  ("settleCheck", true),
  ("submitPhone", true),
  ("answerCodeStart", CodeSent),
  "resendCode"
)

pure val eval_witness_sometimesInvalidCode = (
  ("openPage", false, false, false, 0, 0),
  ("loaded", { result: SignedOut, account: 0, reason: NoBlock }, false, false),
  ("readAuthMode", ModeOtp, false),
  ("submitPhone", true),
  ("answerCodeStart", CodeSent),
  ("submitCode", 4),
  ("answerVerify", WrongCode)
)

pure val eval_witness_sometimesNewCodeSent = (
  ("openPage", false, false, false, 0, 0),
  ("loaded", { result: SignedOut, account: 0, reason: NoBlock }, false, false),
  ("readAuthMode", ModeOtp, false),
  ("submitPhone", true),
  ("answerCodeStart", CodeSent),
  "resendCode",
  ("answerResend", CodeSent)
)
```
