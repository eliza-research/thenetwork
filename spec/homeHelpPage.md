# Home-help address page

The ntwrk.party site keeps one page at `/home-help`. The service sends the link in the conversation, as the answer to the text `HOME HELP ADDRESS <code> <revision>`, when everyone on a reviewed home-help plan agreed ([private address release](privateHomeHelpVenue.md), [reviewed roster consent](homeHelpConsent.md)). The link is `https://ntwrk.party/home-help#hh_<32 letters>-<revision>`. On this page the requester adds or removes the street address, and an accepted helper reads it. The page does one step and has no navigation, no settings and no account view ([one-step pages](oneStepPage.md)). The page is only on ntwrk.party (`oneStepOnSite(StepHomeHelp, app)`).

This spec models only what the page shows and what the page lets the person do. The server owns the plan, the roster, the consents, the age rule (18 and older), the encryption and every refusal ([private address release](privateHomeHelpVenue.md)). The browser shell owns the fragment, the session storage, the fetch calls, the map from each server answer to one answer of this model, the character and byte counts of the address, the security check widget, the focus and the copy. The model has these abstractions: the role of the person is an input that the shell gives (now always "unknown"); the address is only the result of its check; each server answer is one `HelpVenueAnswer`; the sign-in steps are the shared sub-flow of [one-step pages](oneStepPage.md). The shell sends each server answer to this machine as one event, and it does not decide what the machine decides. The revealed address stays in the memory of the page only: the shell never logs it, never stores it and never puts it in the address.

Open gaps, with the place where each one plugs in:

- There is no read-only status call, so the page cannot know the role or whether an address is saved before it acts. The shell sends `HelpRoleUnknown` in `homeHelpLoaded` and `homeHelpSessionRead`, and the choice step offers every action. When the server adds a status field, the shell sends the known role there, and nothing else changes.
- The server gives the same `409` for every refusal: a wrong role, a plan that changed or closed, a person under 18, a second submit and a bad address. The page shows one closed step for all of them, and it checks the address before it sends it.
- Helpers get no notice when the address is saved. A helper texts `HOME HELP ADDRESS` again to get the link.
- The Cloud sign-in returns to `/home-help` with no fragment. The page keeps the link in session storage before it leaves for Cloud sign-in and reads it once when it comes back (`linkKept`).
- When the Cloud callback fails, the server shows its own JSON error page, outside this page.

## Story: Open the home-help step from my link

> As a person on a home-help plan, I want the link from my conversation to open the address step for my plan, so that I do not type the plan code.

### The page reads the plan code and the revision from the fragment, and a bad link stops the page

The page reads the fragment once, when it opens, and removes it from the address before any request. When the address has no fragment, the page takes the link that it kept before a Cloud sign-in. The page splits the link at its last `-`. The plan code is `hh_` and 32 letters from `a` to `p`, or a UUID. The revision has only digits, has 1 to 10 digits and is from 1 to 2147483647. A missing or bad link shows "This link does not work" and the page sends no request. A good link starts the loading step.

```quint
import oneStepPage.* from "./oneStepPage"

type HelpScreen = HelpOpening | HelpBadLink | HelpLoading | HelpSignIn | HelpChecking | HelpChoose | HelpAddress |
  HelpSaved | HelpRevealed | HelpRemoved | HelpClosed | HelpUnavailable
type HelpPending = HelpIdle | HelpSubmitting | HelpRevealing | HelpRevoking
type HelpError = HelpNoError | HelpAddressEmpty | HelpAddressTooLong | HelpAddressBadChars | HelpTryLater | HelpRequestFailed
type HelpRole = HelpRoleUnknown | HelpRoleRequester | HelpRoleHelper
type HelpLinkSource = LinkFromAddress | LinkFromKept | LinkMissing
type HelpPlanCode = PlanCodeShort | PlanCodeUuid | PlanCodeBad
type HomeHelpPage = { screen: HelpScreen, signIn: StepSignIn, pending: HelpPending, error: HelpError, notice: StepNotice,
  role: HelpRole, linkKept: bool, addressHeld: bool }
pure val initial: HomeHelpPage = { screen: HelpOpening, signIn: signInStart, pending: HelpIdle, error: HelpNoError,
  notice: NoStepNotice, role: HelpRoleUnknown, linkKept: false, addressHeld: false }

pure val homeHelpRevisionMax = 2147483647
pure val homeHelpRevisionDigitsMax = 10
pure val sourceValues = Set(LinkFromAddress, LinkFromKept, LinkMissing)
pure val wellFormedValues = Set(true, false)
pure val digitCountValues = Set(0, 1, 10, 11)
pure val revisionValues = Set(0, 1, 2147483647, 2147483648)

pure def homeHelpRevisionAccepted(digitsOnly: bool, digitCount: int, revision: int): bool =
  digitsOnly and digitCount >= 1 and digitCount <= homeHelpRevisionDigitsMax and revision >= 1 and revision <= homeHelpRevisionMax

pure def homeHelpLinkWellFormed(code: HelpPlanCode, revisionOk: bool): bool = code != PlanCodeBad and revisionOk

pure def canOpenHomeHelpPage(p: HomeHelpPage): bool = p.screen == HelpOpening

pure def openHomeHelpPage(p: HomeHelpPage, source: HelpLinkSource, wellFormed: bool): HomeHelpPage =
  if (source == LinkMissing or not(wellFormed)) { ...p, screen: HelpBadLink }
  else { ...p, screen: HelpLoading }

pure def lawRevisionWithinRange(digitsOnly: bool, digitCount: int, revision: int): bool =
  homeHelpRevisionAccepted(digitsOnly, digitCount, revision)
    implies (revision >= 1 and revision <= homeHelpRevisionMax and digitCount <= homeHelpRevisionDigitsMax)

pure def lawBadLinkNeverLoads(source: HelpLinkSource, wellFormed: bool): bool =
  (source == LinkMissing or not(wellFormed)) implies openHomeHelpPage(initial, source, wellFormed).screen == HelpBadLink

pure def lawBadPlanCodeIsNeverWellFormed(revisionOk: bool): bool = not(homeHelpLinkWellFormed(PlanCodeBad, revisionOk))
```

### A page with a bad link sends no request and starts no sign-in

The opening step and the bad-link step have no request, no sign-in progress and no role. The bad-link step is the end of the page: no event leaves it.

```quint
pure def alwaysNoRequestWithoutLink(p: HomeHelpPage): bool =
  (p.screen == HelpOpening or p.screen == HelpBadLink)
    implies (p.pending == HelpIdle and p.signIn == signInStart and p.role == HelpRoleUnknown and not(p.linkKept))

pure def stepBadLinkIsFinal(before: HomeHelpPage, after: HomeHelpPage): bool =
  before.screen == HelpBadLink implies after == before
```

### The page reads the session and shows the choice step or the sign-in step

While the page loads, it shows a loading step. It reads the session. A signed-in person gets the choice step with the role from the shell. A signed-out person gets the sign-in step. When the page cannot read the session, it shows the sign-in step with "cannot reach the server" above it.

```quint
pure val sessionValues = Set(SessionSignedIn, SessionSignedOut, SessionUnreadable)
pure val roleValues = Set(HelpRoleUnknown, HelpRoleRequester, HelpRoleHelper)

pure def canHomeHelpLoaded(p: HomeHelpPage): bool = p.screen == HelpLoading

pure def homeHelpLoaded(p: HomeHelpPage, session: StepSession, role: HelpRole): HomeHelpPage =
  if (session == SessionSignedIn) { ...p, screen: HelpChoose, role: role }
  else if (session == SessionSignedOut) { ...p, screen: HelpSignIn }
  else { ...p, screen: HelpSignIn, notice: StepUnreachable }

pure def helpWaiting(p: HomeHelpPage): bool =
  p.screen == HelpOpening or p.screen == HelpLoading or p.screen == HelpChecking
```

## Story: Confirm my number on the home-help page

> As a person on a home-help plan, I want to confirm my own number on the page, so that only I can add or read the address.

### The page signs the person in with the shared sign-in steps and keeps the link for Cloud sign-in

The sign-in step uses the shared sign-in sub-flow of [one-step pages](oneStepPage.md): a text code or Cloud sign-in, with the return path `/home-help`. The page reads the sign-in mode only on the sign-in step, so a page with a bad link sends no request. A verified code moves the page to the checking step. The simulator tries the sign-in attempts of the library (`attemptValues`). Just before the page leaves for Cloud sign-in, it keeps the link in session storage, because Cloud sign-in returns with no fragment. Only that step keeps the link.

```quint
pure val weight_moveSignIn = 4

pure def canMoveSignIn(p: HomeHelpPage, attempt: SignInAttempt): bool =
  signInAttemptAllowed(p.signIn, attempt) and p.screen == HelpSignIn

pure def moveSignIn(p: HomeHelpPage, attempt: SignInAttempt): HomeHelpPage =
  val s = signInMove(p.signIn, attempt)
  { ...p, signIn: s, screen: if (s.stage == SignInVerified) HelpChecking else p.screen,
    linkKept: s.stage == SignInLeftForCloud }

pure def alwaysSignInConsistent(p: HomeHelpPage): bool = signInConsistent(p.signIn)

pure def alwaysKeptOnlyForCloud(p: HomeHelpPage): bool = p.linkKept implies p.signIn.stage == SignInLeftForCloud

pure def stepLinkKeptOnlyWhenLeavingForCloud(before: HomeHelpPage, via: str, after: HomeHelpPage): bool =
  (after.linkKept and not(before.linkKept)) implies via == "moveSignIn"
```

### After sign-in the page reads the session again

The page reads the session after a verified code. A signed-in session shows the choice step and clears the notice. A session that is gone starts the sign-in again with "session ended". A session that the page cannot read starts the sign-in again with "cannot reach the server".

```quint
pure def canHomeHelpSessionRead(p: HomeHelpPage): bool = p.screen == HelpChecking

pure def homeHelpSessionRead(p: HomeHelpPage, session: StepSession, role: HelpRole): HomeHelpPage =
  if (session == SessionSignedIn) { ...p, screen: HelpChoose, role: role, notice: NoStepNotice }
  else { ...p, screen: HelpSignIn, signIn: signInAgain(p.signIn), linkKept: false,
    notice: if (session == SessionUnreadable) StepUnreachable else StepSessionEnded }
```

## Story: Add or remove my address as the requester

> As the person who asked for home help, I want to add my street address on a private page and remove it at any time, so that only the people who agreed can read it.

### The choice step offers only the actions that the role allows

The requester can add and remove the address. A helper can show the address. When the page does not know the role, it offers all three, and the server refuses the action that is not for the person. A helper never gets the address form. The choice step, the address step and the saved step do nothing while a request runs.

```quint
pure def mayAdd(role: HelpRole): bool = role != HelpRoleHelper
pure def mayShow(role: HelpRole): bool = role != HelpRoleRequester
pure def mayRemove(role: HelpRole): bool = role != HelpRoleHelper

pure def helpBusy(p: HomeHelpPage): bool = p.pending != HelpIdle
pure def helpOffersAdd(p: HomeHelpPage): bool = p.screen == HelpChoose and mayAdd(p.role)
pure def helpOffersShow(p: HomeHelpPage): bool = p.screen == HelpChoose and mayShow(p.role)
pure def helpOffersRemove(p: HomeHelpPage): bool = (p.screen == HelpChoose or p.screen == HelpSaved) and mayRemove(p.role)

pure def canChooseAdd(p: HomeHelpPage): bool = p.screen == HelpChoose and p.pending == HelpIdle and mayAdd(p.role)

pure def chooseAdd(p: HomeHelpPage): HomeHelpPage = { ...p, screen: HelpAddress, error: HelpNoError, notice: NoStepNotice }

pure def canBackToChoices(p: HomeHelpPage): bool = p.screen == HelpAddress and p.pending == HelpIdle

pure def backToChoices(p: HomeHelpPage): HomeHelpPage = { ...p, screen: HelpChoose, error: HelpNoError, notice: NoStepNotice }

pure def lawHelperCannotAdd(p: HomeHelpPage): bool = p.role == HelpRoleHelper implies not(canChooseAdd(p))

pure def alwaysAddressFormOnlyForAdder(p: HomeHelpPage): bool = p.screen == HelpAddress implies mayAdd(p.role)
```

### Only an address that passes the check goes to the server

The page trims the address. It refuses an empty address, an address with a control character, a format character, a lone surrogate or a line or paragraph separator, and an address with more than 300 characters or more than 300 UTF-8 bytes. The shell counts the characters and the bytes and finds the bad characters. This model keeps the order of the checks and the limit. An address that does not pass never goes to the server. The page checks the address first, because the server gives the same answer to a bad address as to a closed plan.

```quint
type HelpAddressCheck = AddressOk | AddressEmpty | AddressTooLong | AddressBadChars

pure val homeHelpAddressMax = 300
pure val addressCheckValues = Set(AddressOk, AddressEmpty, AddressTooLong, AddressBadChars)
pure val charCountValues = Set(0, 300, 301)
pure val byteCountValues = Set(0, 300, 301)

pure def homeHelpAddressCheck(trimmedEmpty: bool, charCount: int, byteCount: int, badChars: bool): HelpAddressCheck =
  if (trimmedEmpty) AddressEmpty
  else if (badChars) AddressBadChars
  else if (charCount > homeHelpAddressMax or byteCount > homeHelpAddressMax) AddressTooLong
  else AddressOk

pure def addressError(addressCheck: HelpAddressCheck): HelpError =
  if (addressCheck == AddressEmpty) HelpAddressEmpty
  else if (addressCheck == AddressTooLong) HelpAddressTooLong
  else if (addressCheck == AddressBadChars) HelpAddressBadChars
  else HelpNoError

pure def canSubmitAddress(p: HomeHelpPage): bool = p.screen == HelpAddress and p.pending == HelpIdle

pure def submitAddress(p: HomeHelpPage, addressCheck: HelpAddressCheck): HomeHelpPage =
  if (addressCheck == AddressOk) { ...p, pending: HelpSubmitting, error: HelpNoError, notice: NoStepNotice }
  else { ...p, error: addressError(addressCheck) }

pure def lawBadAddressIsNeverSent(p: HomeHelpPage, addressCheck: HelpAddressCheck): bool =
  addressCheck != AddressOk implies submitAddress(p, addressCheck).pending == p.pending

pure def lawAddressOverLimitIsRefused(charCount: int, byteCount: int, badChars: bool): bool =
  (charCount > homeHelpAddressMax or byteCount > homeHelpAddressMax)
    implies homeHelpAddressCheck(false, charCount, byteCount, badChars) != AddressOk

pure def lawEmptyAddressIsRefused(charCount: int, byteCount: int, badChars: bool): bool =
  homeHelpAddressCheck(true, charCount, byteCount, badChars) == AddressEmpty
```

### The requester can remove the address from the choice step or the saved step

The remove action goes to the server from the choice step or from the saved step. A removed address cannot be added again for this revision.

```quint
pure def canAskRevoke(p: HomeHelpPage): bool =
  (p.screen == HelpChoose or p.screen == HelpSaved) and p.pending == HelpIdle and mayRemove(p.role)

pure def askRevoke(p: HomeHelpPage): HomeHelpPage = { ...p, pending: HelpRevoking, error: HelpNoError, notice: NoStepNotice }
```

## Story: Read the address as a helper

> As a helper who accepted the plan, I want to read the address on a private page, so that I do not get it in a text.

### The helper asks for the address, and only the answer to that request shows it

The show action goes to the server from the choice step. Only a revealed answer to the show request holds the address, and only the revealed step shows it. No event leaves the revealed step.

```quint
pure def canAskReveal(p: HomeHelpPage): bool = p.screen == HelpChoose and p.pending == HelpIdle and mayShow(p.role)

pure def askReveal(p: HomeHelpPage): HomeHelpPage = { ...p, pending: HelpRevealing, error: HelpNoError, notice: NoStepNotice }

pure def alwaysAddressOnlyWhenRevealed(p: HomeHelpPage): bool = p.addressHeld iff p.screen == HelpRevealed

pure def stepAddressRevealedOnlyByReveal(before: HomeHelpPage, via: str, after: HomeHelpPage): bool =
  (after.addressHeld and not(before.addressHeld)) implies (via == "answerVenue" and before.pending == HelpRevealing)

pure def lawRequesterCannotShow(p: HomeHelpPage): bool = p.role == HelpRoleRequester implies not(canAskReveal(p))

pure def lawEachOfferedActionIsEnabled(p: HomeHelpPage): bool =
  p.pending == HelpIdle implies
    ((helpOffersAdd(p) iff canChooseAdd(p)) and (helpOffersShow(p) iff canAskReveal(p)) and (helpOffersRemove(p) iff canAskRevoke(p)))
```

## Story: See the result of each action

> As a person on the home-help page, I want to see what the server did with my action, so that I know if my address is saved, removed or shown.

### The server answer decides the result step

A stored answer to a submit shows the saved step. A revealed answer to a show request shows the revealed step. A removed answer to a remove request shows the removed step. "Signed out" starts the sign-in again with "session ended". "Closed" shows the closed step: the plan changed or ended, or the step is not for this person. "Not wired" shows "not available". A server error keeps the step and asks the person to try later. A general failure keeps the step and shows a general error. When the page cannot reach the server, it keeps the step and shows the notice. An answer that does not fit the request counts as a general failure.

```quint
type HelpVenueAnswer = VenueStored | VenueRevealed | VenueRemoved | VenueSignedOut | VenueClosed | VenueNotWired |
  VenueServerError | VenueFailed | VenueUnreachable

pure val venueAnswerValues = Set(VenueStored, VenueRevealed, VenueRemoved, VenueSignedOut, VenueClosed, VenueNotWired,
  VenueServerError, VenueFailed, VenueUnreachable)

pure def venueAnswerFits(pending: HelpPending, venueAnswer: HelpVenueAnswer): bool =
  (venueAnswer == VenueStored and pending == HelpSubmitting) or
  (venueAnswer == VenueRevealed and pending == HelpRevealing) or
  (venueAnswer == VenueRemoved and pending == HelpRevoking)

pure def canAnswerVenue(p: HomeHelpPage): bool = p.pending != HelpIdle

pure def answerVenue(p: HomeHelpPage, venueAnswer: HelpVenueAnswer): HomeHelpPage =
  val idle = { ...p, pending: HelpIdle }
  if (venueAnswerFits(p.pending, venueAnswer) and venueAnswer == VenueStored) { ...idle, screen: HelpSaved, error: HelpNoError }
  else if (venueAnswerFits(p.pending, venueAnswer) and venueAnswer == VenueRevealed) { ...idle, screen: HelpRevealed, addressHeld: true, error: HelpNoError }
  else if (venueAnswerFits(p.pending, venueAnswer) and venueAnswer == VenueRemoved) { ...idle, screen: HelpRemoved, error: HelpNoError }
  else if (venueAnswer == VenueSignedOut)
    { ...idle, screen: HelpSignIn, signIn: signInAgain(p.signIn), linkKept: false, notice: StepSessionEnded, error: HelpNoError }
  else if (venueAnswer == VenueClosed) { ...idle, screen: HelpClosed, error: HelpNoError }
  else if (venueAnswer == VenueNotWired) { ...idle, screen: HelpUnavailable, error: HelpNoError }
  else if (venueAnswer == VenueServerError) { ...idle, error: HelpTryLater }
  else if (venueAnswer == VenueUnreachable) { ...idle, notice: StepUnreachable, error: HelpNoError }
  else { ...idle, error: HelpRequestFailed }

pure def lawMisfitAnswerIsAFailure(p: HomeHelpPage): bool =
  (p.pending == HelpRevealing) implies answerVenue(p, VenueStored).error == HelpRequestFailed
```

## Story: Send each action only once

> As a person who presses a button, I want the page to wait for the answer before it takes another action, so that I do not send two addresses.

### A request that waits for an answer refuses a second action

While a request runs, its step is busy: its controls are off and its button shows the busy label. The page starts a new request only when no request runs. Each request belongs to the step that started it, and to an action that the role allows.

```quint
pure def stepOneRequestAtATime(before: HomeHelpPage, after: HomeHelpPage): bool =
  (after.pending != HelpIdle and after.pending != before.pending) implies before.pending == HelpIdle

pure def alwaysRequestBelongsToItsScreen(p: HomeHelpPage): bool =
  (p.pending == HelpSubmitting implies p.screen == HelpAddress) and
  (p.pending == HelpRevealing implies p.screen == HelpChoose) and
  (p.pending == HelpRevoking implies (p.screen == HelpChoose or p.screen == HelpSaved))

pure def alwaysActionsFitTheRole(p: HomeHelpPage): bool =
  (p.pending == HelpSubmitting implies mayAdd(p.role)) and
  (p.pending == HelpRevealing implies mayShow(p.role)) and
  (p.pending == HelpRevoking implies mayRemove(p.role))
```

## Story: Reach every outcome

> As a designer of the home-help page, I want each step, each refusal and each error of the page to be reachable, so that the design system gives each one a view.

### A person can save, read or remove the address, find the step closed, or see each error

The page can reach the saved, revealed, removed, closed and unavailable steps and the bad-link step. It can leave for Cloud sign-in with the link kept. It can show each address error, "try later", a general failure, "cannot reach the server" and "session ended". The choice step can show a known role, for the time when the server gives it.

```quint
pure def sometimesSaved(p: HomeHelpPage): bool = p.screen == HelpSaved
pure def sometimesRevealed(p: HomeHelpPage): bool = p.screen == HelpRevealed and p.addressHeld
pure def sometimesRemoved(p: HomeHelpPage): bool = p.screen == HelpRemoved
pure def sometimesClosed(p: HomeHelpPage): bool = p.screen == HelpClosed
pure def sometimesUnavailable(p: HomeHelpPage): bool = p.screen == HelpUnavailable
pure def sometimesBadLink(p: HomeHelpPage): bool = p.screen == HelpBadLink
pure def sometimesLeftForCloud(p: HomeHelpPage): bool = p.signIn.stage == SignInLeftForCloud and p.linkKept
pure def sometimesTryLater(p: HomeHelpPage): bool = p.error == HelpTryLater
pure def sometimesRequestFailed(p: HomeHelpPage): bool = p.error == HelpRequestFailed
pure def sometimesAddressTooLong(p: HomeHelpPage): bool = p.screen == HelpAddress and p.error == HelpAddressTooLong
pure def sometimesAddressEmpty(p: HomeHelpPage): bool = p.screen == HelpAddress and p.error == HelpAddressEmpty
pure def sometimesAddressBadChars(p: HomeHelpPage): bool = p.screen == HelpAddress and p.error == HelpAddressBadChars
pure def sometimesUnreachable(p: HomeHelpPage): bool = p.screen == HelpChoose and p.notice == StepUnreachable
pure def sometimesSessionEnded(p: HomeHelpPage): bool = p.screen == HelpSignIn and p.notice == StepSessionEnded
pure def sometimesSignedInAfterSignIn(p: HomeHelpPage): bool = p.screen == HelpChoose and p.signIn.stage == SignInVerified
pure def sometimesKnownRoleRequester(p: HomeHelpPage): bool = p.screen == HelpChoose and p.role == HelpRoleRequester
pure def sometimesKnownRoleHelper(p: HomeHelpPage): bool = p.screen == HelpChoose and p.role == HelpRoleHelper
pure def sometimesRemovedAsKnownRequester(p: HomeHelpPage): bool = p.screen == HelpRemoved and p.role == HelpRoleRequester
```
