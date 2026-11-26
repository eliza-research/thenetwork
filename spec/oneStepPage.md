# One-step pages

A one-step page does one step from a link that the conversation sent. It has no navigation, no settings and no account view. The person comes to it from a text or an agent reply, does the step and goes back to the conversation. This library owns the decisions that the one-step pages share: which site serves which step, where the link lives, the sign-in sub-flow for the steps that need a session, the shared notices and the retry time. The server keeps the code limits ([phone verification limits](otpLimits.md)). The sign-in rules come from the "Confirm my own phone" story of the [browser join](browserJoin.md), and the Cloud return comes from [Cloud sign-in](cloudSignIn.md).

**Model header.** This spec is a library: it has no `initial` and no machine of its own. Each page spec imports it, keeps one `StepSignIn` in its state and moves it with `signInMove` when `signInAttemptAllowed` lets it. One `SignInAttempt` record stands for each event of the sub-flow; its `kind` selects the case, and the other fields carry the facts of that event. The model abstracts the number to a validity flag and the code to its count of digits. These stay outside the model: the fetch calls and the status-to-answer maps, `retry-after` parsing, the number format, `history.replaceState`, session storage, the security check widget, `window.location.assign`, focus and the copy. The play tests of the views and the page e2e tests cover them.

## Story: Do one step from a link

> As a person who got a link in my conversation, I want the link to open a page that does only that step, so that I finish it and go back to the conversation.

### Each step page is on the sites that can do the step

The phone change step is on every site, because each app has its own session. The home-help step is on ntwrk.party only, because only The Network has home help. The four photo steps are on slop.date only, because only slop.date keeps photos: the photo upload step, the photo check step (the sender sees the photos of one proposal and sends them), the my photos step (the sender sees each photo and who has it) and the photo view step (the receiver sees the photos that a match sent). No page links to a step page: the link comes only from the conversation.

```quint
import brandIdentity.* from "./brandIdentity"

type OneStepKind = StepPhone | StepHomeHelp | StepPhotoUpload | StepPhotoCheck | StepPhotoMine | StepPhotoView

pure def oneStepIsPhoto(kind: OneStepKind): bool =
  kind == StepPhotoUpload or kind == StepPhotoCheck or kind == StepPhotoMine or kind == StepPhotoView

pure def oneStepOnSite(kind: OneStepKind, app: AppKey): bool =
  if (kind == StepHomeHelp) app == Ntwrk
  else if (oneStepIsPhoto(kind)) app == Slop
  else true

pure def lawPhotoUploadOnlyOnSlop(app: AppKey): bool = oneStepOnSite(StepPhotoUpload, app) iff app == Slop
pure def lawPhotoStepsOnlyOnSlop(kind: OneStepKind, app: AppKey): bool =
  oneStepIsPhoto(kind) implies (oneStepOnSite(kind, app) iff app == Slop)
pure def lawHomeHelpOnlyOnHub(app: AppKey): bool = oneStepOnSite(StepHomeHelp, app) iff app == Ntwrk
pure def lawPhoneChangeOnEverySite(app: AppKey): bool = oneStepOnSite(StepPhone, app)
```

### A photo link page names its own purpose in each call

The photo check page, the my photos page and the photo view page send each call with the `X-Photo-Page-Purpose` header. The value is the purpose of the page: `check`, `mine` or `view`. The server refuses a call whose purpose does not agree with the link ([photo check page](photosCheckPage.md) A1, [my photos page](photosMinePage.md) A1, [photo view page](photosViewPage.md) A1). The other steps send no purpose.

```quint
pure val photoPagePurposeHeader: str = "x-photo-page-purpose"

pure def photoPagePurpose(kind: OneStepKind): str =
  if (kind == StepPhotoCheck) "check"
  else if (kind == StepPhotoMine) "mine"
  else if (kind == StepPhotoView) "view"
  else ""

pure def lawOnlyPhotoLinkPagesNameAPurpose(kind: OneStepKind): bool =
  photoPagePurpose(kind) != "" iff (kind == StepPhotoCheck or kind == StepPhotoMine or kind == StepPhotoView)
```

### The link stays in the fragment, and only the home-help link is kept across Cloud sign-in

A link that names a plan or holds a token puts it after `#`, so that no server log and no `Referer` header gets it. The phone change link has no fragment: its authority is the session on the current number. The page reads the fragment once, when it opens, and removes it from the address with `history.replaceState` before it sends any request. The Cloud sign-in leaves the page and comes back without the fragment. Thus only the home-help page keeps its link in session storage, just before it leaves for Cloud sign-in, and takes it back once when it opens again. The photo steps have no sign-in, so their tokens never leave the page's memory.

```quint
pure def oneStepNeedsSignIn(kind: OneStepKind): bool = not(oneStepIsPhoto(kind))
pure def oneStepLinkInFragment(kind: OneStepKind): bool = kind != StepPhone
pure def oneStepLinkMayBeKept(kind: OneStepKind): bool = kind == StepHomeHelp

pure def lawPhotoTokenIsNeverKept(kind: OneStepKind): bool = oneStepLinkMayBeKept(kind) implies oneStepNeedsSignIn(kind)
pure def lawKeptLinkIsInTheFragment(kind: OneStepKind): bool = oneStepLinkMayBeKept(kind) implies oneStepLinkInFragment(kind)
```

### A step page shows one shared notice above the step

A step page can show one notice above its step: the server cannot be reached, the session ended, the person must sign in again for safety, or a Cloud sign-in came back with an error. A page with no notice shows nothing above the step.

```quint
type StepNotice = NoStepNotice | StepUnreachable | StepSessionEnded | StepSignInAgain |
  StepSignInExpired | StepSignInRefused | StepSignInUnavailable
type StepSession = SessionSignedIn | SessionSignedOut | SessionUnreadable

pure def oneStepNoticeShown(notice: StepNotice): bool = notice != NoStepNotice
pure def noticeForSession(session: StepSession): StepNotice =
  if (session == SessionUnreadable) StepUnreachable
  else if (session == SessionSignedOut) StepSessionEnded
  else NoStepNotice

pure def lawSignedInHasNoNotice(session: StepSession): bool =
  (session == SessionSignedIn) iff not(oneStepNoticeShown(noticeForSession(session)))
```

### A Cloud sign-in that fails comes back to the page with one error

When a Cloud sign-in that started on `/phone` or `/home-help` fails, the server sends the browser back to the same page with one query value: `?error=sign_in_expired` (the handoff is missing, expired or does not match), `?error=sign_in_refused` (Cloud refused the person, or the phone is held, banned or suppressed) or `?error=sign_in_unavailable` (Cloud or the storage cannot be reached). The page reads the value once when it opens, and removes it from the address with `history.replaceState`. It shows the sign-in step with the notice of that error. Any other value counts as no error. A page that has a session shows no Cloud error.

```quint
type CloudReturn = CloudReturnNone | CloudReturnExpired | CloudReturnRefused | CloudReturnUnavailable

pure val cloudReturnValues = Set(CloudReturnNone, CloudReturnExpired, CloudReturnRefused, CloudReturnUnavailable)

pure def noticeForCloudReturn(cloudReturn: CloudReturn): StepNotice =
  if (cloudReturn == CloudReturnExpired) StepSignInExpired
  else if (cloudReturn == CloudReturnRefused) StepSignInRefused
  else if (cloudReturn == CloudReturnUnavailable) StepSignInUnavailable
  else NoStepNotice

pure def noticeOnOpen(session: StepSession, cloudReturn: CloudReturn): StepNotice =
  if (session == SessionSignedIn) NoStepNotice
  else if (session == SessionUnreadable) StepUnreachable
  else noticeForCloudReturn(cloudReturn)

pure def lawEveryCloudErrorShowsANotice(cloudReturn: CloudReturn): bool =
  (cloudReturn != CloudReturnNone) iff oneStepNoticeShown(noticeForCloudReturn(cloudReturn))
pure def lawSessionHidesTheCloudError(cloudReturn: CloudReturn): bool =
  noticeOnOpen(SessionSignedIn, cloudReturn) == NoStepNotice
```

### A refused request says when to try again

When the server refuses a request for too many tries and says how many seconds to wait, the page shows the wait in whole minutes, rounded up, and never less than one minute. When the server does not say, the page shows the general text.

```quint
pure val secondsValues = Set(-5, 0, 1, 59, 60, 61, 119, 3600)

pure def retryMinutesShown(seconds: int): int = if (seconds <= 60) 1 else (seconds + 59) / 60

pure def lawRetryIsAtLeastOneMinute(seconds: int): bool = retryMinutesShown(seconds) >= 1
pure def lawRetryIsNeverShorterThanTheWait(seconds: int): bool = retryMinutesShown(seconds) * 60 >= seconds
```

## Story: Sign in on the step page

> As a person who opens a step page without a session, I want to confirm my own phone on the same page, so that I do the step without a second link and nobody else can do it for me.

### The page asks the server which sign-in to use and uses text codes when it cannot tell

After the page opens, it asks the server for the sign-in mode. The number step is busy until the answer arrives. Only a "cloud" answer gives the Cloud sign-in. Any other answer, and a lookup that fails after its retries, gives the text-code sign-in. The security check runs only with the text-code sign-in, and only when the site has a check key. A page can read the mode once; the mode does not change after that.

```quint
type SignInAuth = SignInModePending | SignInOtp | SignInCloud
type SignInStage = SignInNumber | SignInCode | SignInVerified | SignInLeftForCloud
type SignInPending = SignInIdle | SignInStarting | SignInVerifying | SignInResending | SignInOpeningCloud
type SignInCheck = NoCheck | CheckRunning | CheckPassed | CheckBroken
type SignInError = SignInNoError | SignInInvalidPhone | SignInCheckPending | SignInCheckFailed | SignInCheckRejected |
  SignInCheckAgain | SignInRateLimited | SignInCodeFormat | SignInWrongCode | SignInNewCodeSent |
  SignInCloudUnavailable | SignInRequestFailed
type StepSignIn = { auth: SignInAuth, stage: SignInStage, pending: SignInPending, check: SignInCheck,
  checkOn: bool, error: SignInError, retryKnown: bool }
pure val signInStart: StepSignIn = { auth: SignInModePending, stage: SignInNumber, pending: SignInIdle,
  check: NoCheck, checkOn: false, error: SignInNoError, retryKnown: false }

type SignInLookup = SignInLookupFailed | SignInLookupOtp | SignInLookupCloud
type SignInAnswer = SignInAnswerOk | SignInAnswerRateLimited | SignInAnswerCheckRejected | SignInAnswerWrongCode | SignInAnswerFailed
type SignInAttemptKind = AttemptReadMode | AttemptSubmitNumber | AttemptAnswerStart | AttemptSubmitCode | AttemptAnswerVerify |
  AttemptResend | AttemptAnswerResend | AttemptChangeNumber | AttemptContinueCloud | AttemptAnswerCloud |
  AttemptSettleCheck | AttemptExpireCheck
type SignInAttempt = { kind: SignInAttemptKind, lookup: SignInLookup, checkOn: bool, valid: bool, digits: int,
  answer: SignInAnswer, retryKnown: bool, passed: bool }
pure val signInAttemptNone: SignInAttempt = { kind: AttemptReadMode, lookup: SignInLookupFailed, checkOn: false,
  valid: false, digits: 0, answer: SignInAnswerFailed, retryKnown: false, passed: false }

pure def signInAuthFor(lookup: SignInLookup): SignInAuth = if (lookup == SignInLookupCloud) SignInCloud else SignInOtp
pure def signInCheckFor(auth: SignInAuth, checkOn: bool): SignInCheck = if (auth == SignInOtp and checkOn) CheckRunning else NoCheck

pure def signInShowsNumberForm(s: StepSignIn): bool = s.stage == SignInNumber and s.auth == SignInOtp
pure def signInShowsCloudButton(s: StepSignIn): bool = s.stage == SignInNumber and s.auth == SignInCloud
pure def signInWaiting(s: StepSignIn): bool =
  s.auth == SignInModePending or s.stage == SignInVerified or s.stage == SignInLeftForCloud

pure def lawOnlyCloudLookupUsesCloud(lookup: SignInLookup): bool =
  (signInAuthFor(lookup) == SignInCloud) iff (lookup == SignInLookupCloud)
pure def lawCheckOnlyWithTextCodes(auth: SignInAuth, checkOn: bool): bool =
  signInCheckFor(auth, checkOn) != NoCheck implies (auth == SignInOtp and checkOn)
```

### Each sign-in event is allowed only in the stage that offers it

The page reads the mode only while the mode is pending. It sends a number only on the number step of the text-code sign-in, and a code, a resend or a change of number only on the code step. It opens the Cloud sign-in only on the number step of the Cloud sign-in. Each answer comes only while its request runs. A running check can settle, and a passed check can expire. While a request runs, the page refuses a second one.

```quint
pure def signInAttemptAllowed(s: StepSignIn, attempt: SignInAttempt): bool =
  if (attempt.kind == AttemptReadMode) s.auth == SignInModePending
  else if (attempt.kind == AttemptSubmitNumber) (s.stage == SignInNumber and s.auth == SignInOtp and s.pending == SignInIdle)
  else if (attempt.kind == AttemptAnswerStart) s.pending == SignInStarting
  else if (attempt.kind == AttemptSubmitCode or attempt.kind == AttemptResend or attempt.kind == AttemptChangeNumber)
    (s.stage == SignInCode and s.pending == SignInIdle)
  else if (attempt.kind == AttemptAnswerVerify) s.pending == SignInVerifying
  else if (attempt.kind == AttemptAnswerResend) s.pending == SignInResending
  else if (attempt.kind == AttemptContinueCloud) (s.stage == SignInNumber and s.auth == SignInCloud and s.pending == SignInIdle)
  else if (attempt.kind == AttemptAnswerCloud) s.pending == SignInOpeningCloud
  else if (attempt.kind == AttemptSettleCheck) s.check == CheckRunning
  else s.check == CheckPassed

pure def signInBusy(s: StepSignIn): bool = s.pending != SignInIdle
```

### The sign-in moves as the browser join sign-in does

A number that is not a 10-digit US mobile number gets "invalid phone" and never goes to the server. A running check asks the person to wait, and a failed check asks the person to refresh. A sent code opens the code step. Each answer to a code request uses up the security check, because one check passes one request only. A refused request for too many tries keeps the wait from the server when the server gave one. A code with fewer than 4 or more than 8 digits never goes to the server. A verified code ends the sub-flow, and the page then reads the session. With the check on, "resend" goes back to the number step and asks the person to confirm the check, because the code step has no check. With the Cloud sign-in, the page asks for the Cloud address and leaves for it, or says that sign-in is unavailable. A check that fails on the number step replaces an empty error, "wait for the check" or "check failed". A check that passes clears "wait for the check" and "check failed".

```quint
pure val digitsValues = Set(0, 3, 4, 6, 8, 9)

pure def signInCodeAccepted(digits: int): bool = digits >= 4 and digits <= 8
pure def signInSpent(check: SignInCheck): SignInCheck = if (check == NoCheck) NoCheck else CheckRunning
pure def signInStartError(answer: SignInAnswer): SignInError =
  if (answer == SignInAnswerRateLimited) SignInRateLimited
  else if (answer == SignInAnswerCheckRejected) SignInCheckRejected
  else SignInRequestFailed
pure def signInSettledError(stage: SignInStage, error: SignInError, passed: bool): SignInError =
  val checkError = error == SignInCheckPending or error == SignInCheckFailed
  if (stage != SignInNumber) error
  else if (not(passed) and (error == SignInNoError or checkError)) SignInCheckFailed
  else if (passed and checkError) SignInNoError
  else error

pure def signInMove(s: StepSignIn, attempt: SignInAttempt): StepSignIn =
  val idle = { ...s, pending: SignInIdle }
  val modeAuth = signInAuthFor(attempt.lookup)
  val spent = signInSpent(s.check)
  val startError = signInStartError(attempt.answer)
  val startRetry = startError == SignInRateLimited and attempt.retryKnown
  val settledError = signInSettledError(s.stage, s.error, attempt.passed)
  if (attempt.kind == AttemptReadMode)
    { ...s, auth: modeAuth, checkOn: attempt.checkOn, check: signInCheckFor(modeAuth, attempt.checkOn) }
  else if (attempt.kind == AttemptSubmitNumber)
    (if (not(attempt.valid)) { ...s, error: SignInInvalidPhone, retryKnown: false }
    else if (s.check == CheckRunning) { ...s, error: SignInCheckPending, retryKnown: false }
    else if (s.check == CheckBroken) { ...s, error: SignInCheckFailed, retryKnown: false }
    else { ...s, pending: SignInStarting, error: SignInNoError, retryKnown: false })
  else if (attempt.kind == AttemptAnswerStart)
    (if (attempt.answer == SignInAnswerOk) { ...idle, check: spent, stage: SignInCode, error: SignInNoError, retryKnown: false }
    else { ...idle, check: spent, error: startError, retryKnown: startRetry })
  else if (attempt.kind == AttemptSubmitCode)
    (if (signInCodeAccepted(attempt.digits)) { ...s, pending: SignInVerifying, error: SignInNoError, retryKnown: false }
    else { ...s, error: SignInCodeFormat, retryKnown: false })
  else if (attempt.kind == AttemptAnswerVerify)
    (if (attempt.answer == SignInAnswerOk) { ...idle, stage: SignInVerified, error: SignInNoError, retryKnown: false }
    else if (attempt.answer == SignInAnswerWrongCode) { ...idle, error: SignInWrongCode, retryKnown: false }
    else if (attempt.answer == SignInAnswerRateLimited) { ...idle, error: SignInRateLimited, retryKnown: attempt.retryKnown }
    else { ...idle, error: SignInRequestFailed, retryKnown: false })
  else if (attempt.kind == AttemptResend)
    (if (s.check != NoCheck) { ...s, stage: SignInNumber, error: SignInCheckAgain, retryKnown: false }
    else { ...s, pending: SignInResending, error: SignInNoError, retryKnown: false })
  else if (attempt.kind == AttemptAnswerResend)
    (if (attempt.answer == SignInAnswerOk) { ...idle, check: spent, error: SignInNewCodeSent, retryKnown: false }
    else { ...idle, check: spent, error: startError, retryKnown: startRetry })
  else if (attempt.kind == AttemptChangeNumber) { ...s, stage: SignInNumber, error: SignInNoError, retryKnown: false }
  else if (attempt.kind == AttemptContinueCloud) { ...s, pending: SignInOpeningCloud, error: SignInNoError, retryKnown: false }
  else if (attempt.kind == AttemptAnswerCloud)
    (if (attempt.answer == SignInAnswerOk) { ...idle, stage: SignInLeftForCloud, error: SignInNoError, retryKnown: false }
    else { ...idle, error: SignInCloudUnavailable, retryKnown: false })
  else if (attempt.kind == AttemptSettleCheck)
    { ...s, check: if (attempt.passed) CheckPassed else CheckBroken, error: settledError,
      retryKnown: s.retryKnown and settledError == SignInRateLimited }
  else { ...s, check: CheckRunning }

pure def lawCodeNeedsFourToEightDigits(digits: int): bool =
  (digits < 4 or digits > 8) implies not(signInCodeAccepted(digits))
pure def lawInvalidNumberIsNeverSent(s: StepSignIn): bool =
  signInMove(s, { ...signInAttemptNone, kind: AttemptSubmitNumber, valid: false }).pending == s.pending
pure def lawEveryStartAnswerSpendsTheCheck(s: StepSignIn, answer: SignInAnswer): bool =
  signInMove(s, { ...signInAttemptNone, kind: AttemptAnswerStart, answer: answer }).check != CheckPassed and
  signInMove(s, { ...signInAttemptNone, kind: AttemptAnswerResend, answer: answer }).check != CheckPassed
pure def lawShortCodeIsNeverSent(s: StepSignIn, digits: int): bool =
  not(signInCodeAccepted(digits)) implies
    signInMove(s, { ...signInAttemptNone, kind: AttemptSubmitCode, digits: digits }).pending == s.pending
```

### A page that loses its session starts the sign-in again with the same mode

When the server says that the session ended, that the sign-in is too old, or that the session has no person, the page starts the sign-in again. It keeps the mode and the check setting. It shows the number step with no error, and the check runs again with the text-code sign-in when the check is on.

```quint
pure def signInAgain(s: StepSignIn): StepSignIn =
  { ...s, stage: SignInNumber, pending: SignInIdle, error: SignInNoError, retryKnown: false,
    check: signInCheckFor(s.auth, s.checkOn) }

pure def lawSignInAgainKeepsTheMode(s: StepSignIn): bool =
  signInAgain(s).auth == s.auth and signInAgain(s).stage == SignInNumber and not(signInBusy(signInAgain(s)))
```

### Each sign-in request belongs to its stage, and the check belongs to text codes

A code request runs only on the number step of the text-code sign-in. A Cloud request runs only on the number step of the Cloud sign-in. A code check and a resend run only on the code step, and a resend runs only without a check. The code step uses text codes. The security check is on only with text codes and a check key. The wait from the server shows only with "too many tries". A page that embeds the sub-flow requires this of its `signIn` in every state.

```quint
pure def signInConsistent(s: StepSignIn): bool =
  (s.check != NoCheck implies (s.auth == SignInOtp and s.checkOn)) and
  (s.retryKnown implies s.error == SignInRateLimited) and
  (s.pending == SignInStarting implies (s.stage == SignInNumber and s.auth == SignInOtp)) and
  (s.pending == SignInOpeningCloud implies (s.stage == SignInNumber and s.auth == SignInCloud)) and
  ((s.pending == SignInVerifying or s.pending == SignInResending) implies s.stage == SignInCode) and
  (s.pending == SignInResending implies s.check == NoCheck) and
  (s.stage == SignInCode implies s.auth == SignInOtp)

pure val attemptValues: Set[SignInAttempt] = Set(
  { ...signInAttemptNone, kind: AttemptReadMode, lookup: SignInLookupOtp, checkOn: true },
  { ...signInAttemptNone, kind: AttemptReadMode, lookup: SignInLookupOtp, checkOn: false },
  { ...signInAttemptNone, kind: AttemptReadMode, lookup: SignInLookupFailed, checkOn: true },
  { ...signInAttemptNone, kind: AttemptReadMode, lookup: SignInLookupCloud, checkOn: true },
  { ...signInAttemptNone, kind: AttemptSubmitNumber, valid: true },
  { ...signInAttemptNone, kind: AttemptSubmitNumber, valid: false },
  { ...signInAttemptNone, kind: AttemptAnswerStart, answer: SignInAnswerOk },
  { ...signInAttemptNone, kind: AttemptAnswerStart, answer: SignInAnswerRateLimited, retryKnown: true },
  { ...signInAttemptNone, kind: AttemptAnswerStart, answer: SignInAnswerRateLimited },
  { ...signInAttemptNone, kind: AttemptAnswerStart, answer: SignInAnswerCheckRejected },
  { ...signInAttemptNone, kind: AttemptAnswerStart, answer: SignInAnswerFailed },
  { ...signInAttemptNone, kind: AttemptSubmitCode, digits: 6 },
  { ...signInAttemptNone, kind: AttemptSubmitCode, digits: 3 },
  { ...signInAttemptNone, kind: AttemptSubmitCode, digits: 9 },
  { ...signInAttemptNone, kind: AttemptAnswerVerify, answer: SignInAnswerOk },
  { ...signInAttemptNone, kind: AttemptAnswerVerify, answer: SignInAnswerWrongCode },
  { ...signInAttemptNone, kind: AttemptAnswerVerify, answer: SignInAnswerRateLimited },
  { ...signInAttemptNone, kind: AttemptAnswerVerify, answer: SignInAnswerFailed },
  { ...signInAttemptNone, kind: AttemptResend },
  { ...signInAttemptNone, kind: AttemptAnswerResend, answer: SignInAnswerOk },
  { ...signInAttemptNone, kind: AttemptAnswerResend, answer: SignInAnswerRateLimited, retryKnown: true },
  { ...signInAttemptNone, kind: AttemptAnswerResend, answer: SignInAnswerFailed },
  { ...signInAttemptNone, kind: AttemptChangeNumber },
  { ...signInAttemptNone, kind: AttemptContinueCloud },
  { ...signInAttemptNone, kind: AttemptAnswerCloud, answer: SignInAnswerOk },
  { ...signInAttemptNone, kind: AttemptAnswerCloud, answer: SignInAnswerFailed },
  { ...signInAttemptNone, kind: AttemptSettleCheck, passed: true },
  { ...signInAttemptNone, kind: AttemptSettleCheck, passed: false },
  { ...signInAttemptNone, kind: AttemptExpireCheck },
)
pure val sValues: Set[StepSignIn] = Set(
  signInStart,
  { ...signInStart, auth: SignInOtp, checkOn: true, check: CheckRunning },
  { ...signInStart, auth: SignInOtp, checkOn: true, check: CheckPassed, pending: SignInStarting },
  { ...signInStart, auth: SignInOtp, checkOn: true, check: CheckBroken, error: SignInCheckFailed },
  { ...signInStart, auth: SignInOtp, checkOn: true, check: CheckRunning, error: SignInRateLimited, retryKnown: true },
  { ...signInStart, auth: SignInOtp, stage: SignInCode },
  { ...signInStart, auth: SignInOtp, stage: SignInCode, pending: SignInVerifying },
  { ...signInStart, auth: SignInOtp, stage: SignInCode, pending: SignInResending },
  { ...signInStart, auth: SignInCloud },
  { ...signInStart, auth: SignInCloud, pending: SignInOpeningCloud },
)

pure def lawEveryAllowedMoveStaysConsistent(s: StepSignIn, attempt: SignInAttempt): bool =
  (signInConsistent(s) and signInAttemptAllowed(s, attempt)) implies signInConsistent(signInMove(s, attempt))
pure def lawSignInAgainIsConsistent(s: StepSignIn): bool =
  signInConsistent(s) implies signInConsistent(signInAgain(s))
```
