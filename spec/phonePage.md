# Change my number page

The `/phone` page changes the number of a member on one site. The link is `https://<domain>/phone`, with no token, no query and no fragment: the authority is a fresh site session on the current number. The page is on every site ([one-step pages](oneStepPage.md)). First the person confirms the current number on the page, by a text code or by the Cloud sign-in. Then the person types the new number and the code that the server texts to it. The server owns the change ([phone change](phoneChange.md)): the fresh sign-in, the code limits, the pending change, the bans, the move of the person and the end of the old sessions. This spec models only what the page shows and what the page lets the person do. The shell sends each server answer to this machine as one event. The page has no sign-in link in any navigation, no settings and no account view.

**Model header.** The state is the screen, one embedded sign-in sub-flow (`StepSignIn` from the library), the change request that runs, the inline error, the shared notice and three facts: a code was sent for the change, the number moved, and the browser has no session after the move. The model abstracts the new number to a validity flag and the change code to its count of digits. Each server answer is one variant of `PhoneStartAnswer` or `PhoneConfirmAnswer`; the shell maps each status and error code of the contract to exactly one variant. These stay outside the model: the fetch calls and those maps, the number format, the masked number, the security check widget, the Cloud redirect, focus and the copy. The `PhonePageView` play tests cover the views, and `tests/e2e/phone-page.e2e.test.ts` covers the maps against the API.

Open gaps (the backend closes them; the page does not work around them):

- The text command CHANGE NUMBER sends the `/phone` link (backend). It ships in the same release as this page.
- A person who no longer holds the current number cannot sign in, so has no route on the page. The held step and the sign-in step give help@ntwrk.party (gap 3).

The server closed two earlier gaps (page contracts addendum of 2026-11-22): a refused change start for too many tries carries `retry-after`, and a failed Cloud callback comes back to `/phone` with `?error=`.

## Story: Change my number from the link in my conversation

> As a member who has a new number, I want to open the link from my conversation, confirm my current number and then my new number, so that I keep my account and my history.

### The page reads the session when it opens

The page opens and shows a loading step while it reads the session. The first session answer starts with no phone change in progress. A signed-in session goes to the new-number step. A signed-out session goes to the sign-in step. When the page cannot read the session, it goes to the sign-in step and shows that the server cannot be reached. When a Cloud sign-in came back with an error, the sign-in step shows the notice of that error (`noticeOnOpen`). After the session read, the page asks for the sign-in mode, also when it is signed in, because the result of the change depends on the mode.

```quint
import oneStepPage.* from "./oneStepPage"

type PhoneScreen = PhoneOpening | PhoneLoading | PhoneSignIn | PhoneChecking | PhoneNewNumber | PhoneCode | PhoneDone | PhoneHeld
type PhonePending = PhoneIdle | PhoneStarting | PhoneConfirming | PhoneResending
type PhoneError = PhoneNoError | PhoneInvalidNumber | PhoneSameNumber | PhoneRateLimited | PhoneCodeFormat |
  PhoneWrongCode | PhoneStartAgain | PhoneNumberInUse | PhoneNewCodeSent | PhoneRequestFailed
type PhonePage = { screen: PhoneScreen, signIn: StepSignIn, pending: PhonePending, error: PhoneError,
  notice: StepNotice, changeStarted: bool, moved: bool, doneSignedOut: bool, retryKnown: bool }
pure val initial: PhonePage = { screen: PhoneOpening, signIn: signInStart, pending: PhoneIdle, error: PhoneNoError,
  notice: NoStepNotice, changeStarted: false, moved: false, doneSignedOut: false, retryKnown: false }

pure val sessionValues = Set(SessionSignedIn, SessionSignedOut, SessionUnreadable)

pure def canOpenPhonePage(p: PhonePage): bool = p.screen == PhoneOpening
pure def openPhonePage(p: PhonePage): PhonePage = { ...p, screen: PhoneLoading }

pure def canPhoneLoaded(p: PhonePage): bool = p.screen == PhoneLoading
pure def phoneLoaded(p: PhonePage, session: StepSession, cloudReturn: CloudReturn): PhonePage =
  { ...p, screen: if (session == SessionSignedIn) PhoneNewNumber else PhoneSignIn, notice: noticeOnOpen(session, cloudReturn),
    changeStarted: false }

pure def phoneScreenWaiting(p: PhonePage): bool =
  p.screen == PhoneOpening or p.screen == PhoneLoading or p.screen == PhoneChecking
```

### The sign-in step confirms the current number and then reads the session again

The sign-in step embeds the shared sign-in. The page reads the sign-in mode on any screen after loading and stays on that screen. The other sign-in events come only on the sign-in step. A successful code verification answer shows a checking step, and the page reads the session again. A signed-in session goes to the new-number step and clears the notice. A signed-out session starts the sign-in again and says that the session ended. A session that the page cannot read starts the sign-in again and says that the server cannot be reached. The Cloud sign-in leaves the page and comes back to `/phone`, where the page opens again and reads the new session. The simulator tries the sign-in attempts of the library (`attemptValues`).

```quint
pure def canMoveSignIn(p: PhonePage, attempt: SignInAttempt): bool =
  signInAttemptAllowed(p.signIn, attempt) and
  (if (attempt.kind == AttemptReadMode) (p.screen != PhoneOpening and p.screen != PhoneLoading) else p.screen == PhoneSignIn)

pure def moveSignIn(p: PhonePage, attempt: SignInAttempt): PhonePage =
  val s = signInMove(p.signIn, attempt)
  { ...p, signIn: s, screen: if (attempt.kind == AttemptAnswerVerify and s.stage == SignInVerified) PhoneChecking else p.screen }

pure def phoneSignInAgain(notice: StepNotice, p: PhonePage): PhonePage =
  { ...p, screen: PhoneSignIn, signIn: signInAgain(p.signIn), pending: PhoneIdle, error: PhoneNoError,
    notice: notice, changeStarted: false, retryKnown: false }

pure def canPhoneSessionRead(p: PhonePage): bool = p.screen == PhoneChecking
pure def phoneSessionRead(p: PhonePage, session: StepSession): PhonePage =
  if (session == SessionSignedIn) { ...p, screen: PhoneNewNumber, notice: NoStepNotice, error: PhoneNoError, retryKnown: false }
  else phoneSignInAgain(noticeForSession(session), p)

pure def alwaysSignInConsistent(p: PhonePage): bool = signInConsistent(p.signIn)

pure def alwaysSignInBusyOnlyOnSignIn(p: PhonePage): bool =
  signInBusy(p.signIn) implies p.screen == PhoneSignIn
```

### The new number goes to the server only when it is valid and the mode is known

On the new-number step the page waits for the sign-in mode, then lets the person send the new number. The page refuses a number that is not a 10-digit US mobile number. A sent code opens the code step and clears the notice. "Same number", "invalid phone", "too many tries" and a general failure keep the new-number step and show why. With "too many tries" the server gives the wait in `retry-after`, and the page shows it in minutes (`retryMinutesShown`). When the answer has no usable wait, the page says "Try later". A sign-in that is too old starts the sign-in again and asks the person to sign in again for safety. A session that ended, or a session with no person, starts the sign-in again and says that the session ended. A held current number shows the held step. When the page cannot reach the server, it keeps the step and shows the notice.

```quint
type PhoneStartAnswer = PhoneStartSent | PhoneStartInvalidPhone | PhoneStartSameNumber | PhoneStartNoPerson |
  PhoneStartReauth | PhoneStartReview | PhoneStartRateLimited | PhoneStartSignedOut | PhoneStartFailed | PhoneStartUnreachable

pure val startAnswerValues = Set(PhoneStartSent, PhoneStartInvalidPhone, PhoneStartSameNumber, PhoneStartNoPerson,
  PhoneStartReauth, PhoneStartReview, PhoneStartRateLimited, PhoneStartSignedOut, PhoneStartFailed, PhoneStartUnreachable)
pure val numberValidValues = Set(true, false)
pure val retryKnownValues = Set(true, false)

pure def phoneNumberFormWaiting(p: PhonePage): bool = p.screen == PhoneNewNumber and p.signIn.auth == SignInModePending

pure def canSubmitNewNumber(p: PhonePage): bool =
  p.screen == PhoneNewNumber and p.pending == PhoneIdle and p.signIn.auth != SignInModePending
pure def submitNewNumber(p: PhonePage, numberValid: bool): PhonePage =
  if (numberValid) { ...p, pending: PhoneStarting, error: PhoneNoError, retryKnown: false }
  else { ...p, error: PhoneInvalidNumber, retryKnown: false }

pure def phoneAfterStart(startAnswer: PhoneStartAnswer, retryKnown: bool, resend: bool, p: PhonePage): PhonePage =
  val idle = { ...p, pending: PhoneIdle, retryKnown: false }
  if (startAnswer == PhoneStartSent)
    (if (resend) { ...idle, error: PhoneNewCodeSent, notice: NoStepNotice }
    else { ...idle, screen: PhoneCode, error: PhoneNoError, notice: NoStepNotice, changeStarted: true })
  else if (startAnswer == PhoneStartInvalidPhone) { ...idle, error: PhoneInvalidNumber, notice: NoStepNotice }
  else if (startAnswer == PhoneStartSameNumber) { ...idle, error: PhoneSameNumber, notice: NoStepNotice }
  else if (startAnswer == PhoneStartRateLimited) { ...idle, error: PhoneRateLimited, notice: NoStepNotice, retryKnown: retryKnown }
  else if (startAnswer == PhoneStartFailed) { ...idle, error: PhoneRequestFailed, notice: NoStepNotice }
  else if (startAnswer == PhoneStartReauth) phoneSignInAgain(StepSignInAgain, idle)
  else if (startAnswer == PhoneStartNoPerson or startAnswer == PhoneStartSignedOut) phoneSignInAgain(StepSessionEnded, idle)
  else if (startAnswer == PhoneStartReview) { ...idle, screen: PhoneHeld, error: PhoneNoError, notice: NoStepNotice, changeStarted: false }
  else { ...idle, notice: StepUnreachable }

pure def canAnswerNumberStart(p: PhonePage): bool = p.pending == PhoneStarting
pure def answerNumberStart(p: PhonePage, startAnswer: PhoneStartAnswer, retryKnown: bool): PhonePage =
  phoneAfterStart(startAnswer, retryKnown, false, p)

pure def lawWaitShowsOnlyWithTooManyTries(p: PhonePage, startAnswer: PhoneStartAnswer, retryKnown: bool): bool =
  answerNumberStart(p, startAnswer, retryKnown).retryKnown implies (startAnswer == PhoneStartRateLimited and retryKnown)

pure def alwaysWaitOnlyWithTooManyTries(p: PhonePage): bool = p.retryKnown implies p.error == PhoneRateLimited

pure def lawReauthAsksForSignIn(p: PhonePage): bool =
  val after = answerNumberStart(p, PhoneStartReauth, false)
  after.screen == PhoneSignIn and after.notice == StepSignInAgain and after.signIn.stage == SignInNumber
```

### Only a well-formed change code goes to the server, and only a moved number shows the result

The code step shows the masked new number. The page refuses a code with fewer than 4 or more than 10 digits; the server takes the same limits. The shell sends only the count of the digits. A moved number shows the result step. On a site with the Cloud sign-in, the move ends the browser's session, so the result step also says to use the new number the next time the person signs in. It shows no sign-in button. A wrong or expired code keeps the code step. A change that expired, or that a newer start replaced, goes back to the new-number step and asks to start again. A new number that another person already uses goes back to the new-number step and says so. A held number shows the held step. A session that ended starts the sign-in again. When the page cannot reach the server, it keeps the step and shows the notice.

```quint
type PhoneConfirmAnswer = PhoneConfirmMoved | PhoneConfirmInvalidCode | PhoneConfirmNoPerson | PhoneConfirmReview |
  PhoneConfirmNoPending | PhoneConfirmNumberInUse | PhoneConfirmSignedOut | PhoneConfirmFailed | PhoneConfirmUnreachable

pure val confirmAnswerValues = Set(PhoneConfirmMoved, PhoneConfirmInvalidCode, PhoneConfirmNoPerson, PhoneConfirmReview,
  PhoneConfirmNoPending, PhoneConfirmNumberInUse, PhoneConfirmSignedOut, PhoneConfirmFailed, PhoneConfirmUnreachable)
pure val codeDigitsValues = Set(3, 4, 6, 10, 11)

pure def phoneChangeCodeAccepted(codeDigits: int): bool = codeDigits >= 4 and codeDigits <= 10

pure def canSubmitChangeCode(p: PhonePage): bool = p.screen == PhoneCode and p.pending == PhoneIdle
pure def submitChangeCode(p: PhonePage, codeDigits: int): PhonePage =
  if (phoneChangeCodeAccepted(codeDigits)) { ...p, pending: PhoneConfirming, error: PhoneNoError, retryKnown: false }
  else { ...p, error: PhoneCodeFormat, retryKnown: false }

pure def canAnswerNumberConfirm(p: PhonePage): bool = p.pending == PhoneConfirming
pure def answerNumberConfirm(p: PhonePage, confirmAnswer: PhoneConfirmAnswer): PhonePage =
  val idle = { ...p, pending: PhoneIdle, retryKnown: false }
  if (confirmAnswer == PhoneConfirmMoved)
    { ...idle, screen: PhoneDone, moved: true, doneSignedOut: p.signIn.auth == SignInCloud,
      error: PhoneNoError, notice: NoStepNotice, changeStarted: false }
  else if (confirmAnswer == PhoneConfirmInvalidCode) { ...idle, error: PhoneWrongCode, notice: NoStepNotice }
  else if (confirmAnswer == PhoneConfirmNoPending)
    { ...idle, screen: PhoneNewNumber, error: PhoneStartAgain, notice: NoStepNotice, changeStarted: false }
  else if (confirmAnswer == PhoneConfirmNumberInUse)
    { ...idle, screen: PhoneNewNumber, error: PhoneNumberInUse, notice: NoStepNotice, changeStarted: false }
  else if (confirmAnswer == PhoneConfirmReview) { ...idle, screen: PhoneHeld, error: PhoneNoError, notice: NoStepNotice, changeStarted: false }
  else if (confirmAnswer == PhoneConfirmNoPerson or confirmAnswer == PhoneConfirmSignedOut) phoneSignInAgain(StepSessionEnded, idle)
  else if (confirmAnswer == PhoneConfirmFailed) { ...idle, error: PhoneRequestFailed, notice: NoStepNotice }
  else { ...idle, notice: StepUnreachable }

pure def lawChangeCodeNeedsFourToTenDigits(p: PhonePage, codeDigits: int): bool =
  (codeDigits < 4 or codeDigits > 10) implies submitChangeCode(p, codeDigits).pending == p.pending

pure def alwaysDoneOnlyAfterMove(p: PhonePage): bool = (p.screen == PhoneDone) iff p.moved

pure def alwaysSignedOutDoneOnlyWithCloud(p: PhonePage): bool =
  p.doneSignedOut implies (p.screen == PhoneDone and p.signIn.auth == SignInCloud)

pure def alwaysChangeNeedsKnownMode(p: PhonePage): bool =
  (p.pending != PhoneIdle or p.screen == PhoneCode or p.screen == PhoneDone) implies p.signIn.auth != SignInModePending

pure def stepMoveOnlyFromConfirm(before: PhonePage, via: str, after: PhonePage): bool =
  (after.moved and not(before.moved)) implies (via == "answerNumberConfirm" and before.pending == PhoneConfirming)
```

### The code step can send a new code or go back to the new number

On the code step, the person can ask for a new code to the same new number, or go back and type a different number. A new code uses one of the daily change starts. A sent code says "new code sent". The other answers act as the answers to the first start, but an error keeps the code step.

```quint
pure def canResendChangeCode(p: PhonePage): bool = p.screen == PhoneCode and p.pending == PhoneIdle
pure def resendChangeCode(p: PhonePage): PhonePage = { ...p, pending: PhoneResending, error: PhoneNoError, retryKnown: false }

pure def canAnswerChangeResend(p: PhonePage): bool = p.pending == PhoneResending
pure def answerChangeResend(p: PhonePage, startAnswer: PhoneStartAnswer, retryKnown: bool): PhonePage =
  phoneAfterStart(startAnswer, retryKnown, true, p)

pure def canChangeNewNumber(p: PhonePage): bool = p.screen == PhoneCode and p.pending == PhoneIdle
pure def changeNewNumber(p: PhonePage): PhonePage = { ...p, screen: PhoneNewNumber, error: PhoneNoError, changeStarted: false, retryKnown: false }

pure def alwaysCodeNeedsChange(p: PhonePage): bool =
  (p.screen == PhoneCode or p.pending == PhoneConfirming or p.pending == PhoneResending) implies p.changeStarted
```

## Story: Sign in again when my sign-in is old

> As a member whose sign-in is older than ten minutes, I want the page to ask me to confirm my current number again, so that nobody can change my number from a browser that I left open.

### A sign-in that is too old starts the sign-in again on the same page

The server refuses a change start when the sign-in is older than ten minutes. The page then shows the sign-in step with "For your safety, sign in again with your current number." It keeps the sign-in mode. It forgets the change that it started. After the new sign-in, the page shows the new-number step again.

```quint
pure def alwaysSignInAgainHasNoChange(p: PhonePage): bool =
  (p.screen == PhoneSignIn or p.screen == PhoneChecking) implies (not(p.changeStarted) and p.pending == PhoneIdle)

pure def lawSignInAgainKeepsMode(p: PhonePage): bool =
  answerNumberStart(p, PhoneStartReauth, false).signIn.auth == p.signIn.auth
```

## Story: Send each request only once

> As a member who presses a button, I want the page to wait for the answer before it accepts the form again, so that I do not use two of my daily changes or send two codes.

### A form that waits for an answer refuses a second submit

While a change request runs, its form is busy. The page starts a new request only when no request runs. Each request belongs to the step that started it.

```quint
pure def phoneBusy(p: PhonePage): bool = p.pending != PhoneIdle

pure def stepOneRequestAtATime(before: PhonePage, after: PhonePage): bool =
  (after.pending != PhoneIdle and after.pending != before.pending) implies before.pending == PhoneIdle

pure def alwaysRequestBelongsToItsScreen(p: PhonePage): bool =
  (p.pending == PhoneStarting implies p.screen == PhoneNewNumber) and
  ((p.pending == PhoneConfirming or p.pending == PhoneResending) implies p.screen == PhoneCode)
```

## Story: Reach every outcome

> As a designer of the phone page, I want each step, each refusal and each error of the page to be reachable, so that the design system gives each one a view.

### A person can change the number, be held, sign in again or see each error

The page can reach the result step with and without the Cloud line, the held step and each error and notice.

```quint
pure def sometimesMoved(p: PhonePage): bool = p.screen == PhoneDone
pure def sometimesMovedOnCloud(p: PhonePage): bool = p.screen == PhoneDone and p.doneSignedOut
pure def sometimesMovedWithTextCodes(p: PhonePage): bool = p.screen == PhoneDone and not(p.doneSignedOut)
pure def sometimesHeld(p: PhonePage): bool = p.screen == PhoneHeld
pure def sometimesSameNumber(p: PhonePage): bool = p.screen == PhoneNewNumber and p.error == PhoneSameNumber
pure def sometimesInvalidNumber(p: PhonePage): bool = p.error == PhoneInvalidNumber
pure def sometimesNumberInUse(p: PhonePage): bool = p.screen == PhoneNewNumber and p.error == PhoneNumberInUse
pure def sometimesStartAgain(p: PhonePage): bool = p.screen == PhoneNewNumber and p.error == PhoneStartAgain
pure def sometimesReauth(p: PhonePage): bool = p.screen == PhoneSignIn and p.notice == StepSignInAgain
pure def sometimesSessionEnded(p: PhonePage): bool = p.screen == PhoneSignIn and p.notice == StepSessionEnded
pure def sometimesRateLimited(p: PhonePage): bool = p.error == PhoneRateLimited and not(p.retryKnown)
pure def sometimesRateLimitedWithTime(p: PhonePage): bool = p.error == PhoneRateLimited and p.retryKnown
pure def sometimesCloudSignInRefused(p: PhonePage): bool = p.screen == PhoneSignIn and p.notice == StepSignInRefused
pure def sometimesCloudSignInExpired(p: PhonePage): bool = p.screen == PhoneSignIn and p.notice == StepSignInExpired
pure def sometimesCloudSignInUnavailable(p: PhonePage): bool = p.screen == PhoneSignIn and p.notice == StepSignInUnavailable
pure def sometimesUnreachable(p: PhonePage): bool = p.notice == StepUnreachable
pure def sometimesNewCodeSent(p: PhonePage): bool = p.screen == PhoneCode and p.error == PhoneNewCodeSent
pure def sometimesWrongCode(p: PhonePage): bool = p.screen == PhoneCode and p.error == PhoneWrongCode
pure def sometimesCodeFormat(p: PhonePage): bool = p.error == PhoneCodeFormat
pure def sometimesRequestFailed(p: PhonePage): bool = p.error == PhoneRequestFailed
pure def sometimesSignInRateLimitedWithTime(p: PhonePage): bool =
  p.screen == PhoneSignIn and p.signIn.error == SignInRateLimited and p.signIn.retryKnown
pure def sometimesLeftForCloud(p: PhonePage): bool = p.screen == PhoneSignIn and p.signIn.stage == SignInLeftForCloud
```
