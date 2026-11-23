# Photo check page

The slop.date site keeps one page at `/photos/check`. It does one step: an adult member sees exactly the photos that a photo proposal names, and sends them with one "Send" action. The service puts the link `https://slop.date/photos/check#<token>` in each photo proposal, choice and list that it texts to the sender ([photo relay item](photoRelayItem.md), the backend owner decision of 2026-11-22). The token is 43 characters of base64url. It is the only authority: the page has no sign-in. Consent to send is only YES to the proposal on the phone line, or "Send" on this page. The receiver is asked first, and a person on the safety team checks each photo before the receiver can open it ([photo relay review](photoRelayReview.md)). The page is on slop.date only, and it has no navigation, no settings and no account view ([one-step pages](oneStepPage.md)).

Photos are for adults (18+) only ([photo policy](photoPolicy.md)). The server checks the age, the membership, the hold and the ban when it issues the link and again on each call. A minor, an unverified or banned person and a held member never get a link, and the page asks for no age. The page never shows a score. The photos stay in the memory of the page as object URLs, and the page removes them when the step ends ([photo retention](photoRetention.md)).

**Model header.** The model does not hold the token, the photos, the numbers, the names or the revision. The token is one fact: it has the correct shape or not. A proposal is two counts: the number of photos that the member keeps (1 to 6) and the number of photos that the proposal names (1 to 3). A pick is the number of photos that the person marked. "The person saw the proposal" is one flag that the shell sets when every named photo shows on the screen. Each server answer is one `CheckOpenAnswer` or one `CheckAnswer`. The browser shell reads the fragment, removes it from the address, keeps the token, the revision, the photo list and the marked numbers in memory, loads the images, sends the requests, maps each status, error code and answer state to one answer kind, and writes the copy. The shell sends each server answer to this machine as one event, and it does not decide what the machine decides. These stay outside the model: the fetch calls and the status maps, the token shape, the image loads and object URLs, which numbers are marked (the shell marks only listed photos that the receiver does not have), `history.replaceState`, focus and the copy. The play tests of `PhotosCheckPageView` and `tests/e2e/photos-check-page.e2e.test.ts` cover them.

The limits 6 and 3 are `photoSlotsMax` and `photoSetMax` of the backend photo relay spec. This branch has the older photo relay spec, so this spec keeps its own copies (`checkSlotsMax`, `checkSetMax`).

Assumptions that the backend owner has not confirmed (backend branch `vibestack-matching`, unpushed and not run):

- A1. The calls are `POST /api/photos/page/open`, `/image` and `/answer` with a JSON body, as in the contract and in `packages/platform/src/photo-pages.ts`. `open` sets the `__Host-photo-page` cookie that binds the link to this browser, and the later calls need it.
- A2. `open` answers `{ purpose: "check", toFirstName, notice, revision, photos: [{ n, label, addedOn, shared }], proposed, until }`. `addedOn` is the day the photo was added, as `YYYY-MM-DD` in the member's time zone (`photoDay` in the unpushed `photo-relay.ts`). The page shows it as `Sat 21 Nov`, as the conversation does. `shared` is true when the receiver already has the photo. `notice` already names the receiver.
- A3. `answer` with `pick` answers `{ state: "proposed", proposed, revision }`, and the page sends the next "Send" with that revision. When the answer has no good revision, the page keeps the revision it has; the server then answers `changed` if it does not agree.
- A4. After a send, a cancel by text or a refusal of photos for the member, the server deletes the draft and its links, so the same link answers `404 link_unavailable`. The server cannot tell the page which one of these closed the link. The page shows one closed step for all of them. A distinct code becomes one more `CheckOpenAnswerKind` and one more screen.
- A5. A link that timed out, and a link whose proposal a newer proposal replaced, both answer `410 link_expired` on open. The page shows the timed-out step for both. On "Send" the server tells them apart (`lapsed`, `changed`).
- A6. An image answer that is not 200 shows that photo as "did not load" and does not change the page machine. The next "Send" or open answer tells the page if the link closed.

## Story: Check my photo before it goes to my match

> As an adult slop.date member, I want the link in my photo proposal to show me exactly the photos that will go, so that I send only what I chose and nobody else can send it for me.

### The page reads the token from the fragment once and opens the link only for a well-formed token

The page reads the fragment once, when it opens, and removes it from the address with `history.replaceState` before it sends any request. It keeps the token only in the memory of the page. It never puts the token in storage, in the address, in a query, in a log or in the page state ([one-step pages](oneStepPage.md), "The link stays in the fragment"). A token that does not have the correct shape shows "This link does not work" and the page sends nothing. A well-formed token starts the open request.

```quint
type ProposalScreen = ProposalOpening | ProposalBadLink | ProposalOpenFailed | ProposalShown | ProposalPicking |
  ProposalSent | ProposalClosed | ProposalLapsed | ProposalChanged | ProposalRefused | ProposalOtherDevice
type ProposalPending = ProposalIdle | ProposalLoading | ProposalSending | ProposalChoosing
type ProposalError = ProposalNoError | ProposalPickCount | ProposalUnreachable | ProposalRequestFailed
type PhotoCheck = {
  screen: ProposalScreen,
  pending: ProposalPending,
  error: ProposalError,
  linkOpen: bool,
  photoCount: int,
  proposedCount: int,
  picked: int,
  seen: bool,
}
pure val initial: PhotoCheck = {
  screen: ProposalOpening, pending: ProposalIdle, error: ProposalNoError, linkOpen: false,
  photoCount: 0, proposedCount: 0, picked: 0, seen: false,
}

pure val checkSlotsMax: int = 6
pure val checkSetMax: int = 3
pure val tokenWellFormedValues = Set(true, false)

pure def proposalEnded(screen: ProposalScreen): bool =
  screen == ProposalBadLink or screen == ProposalSent or screen == ProposalClosed or screen == ProposalLapsed or
  screen == ProposalChanged or screen == ProposalRefused or screen == ProposalOtherDevice

pure def canReadCheckLink(page: PhotoCheck): bool =
  page.screen == ProposalOpening and page.pending == ProposalIdle and not(page.linkOpen)

pure def readCheckLink(page: PhotoCheck, tokenWellFormed: bool): PhotoCheck =
  if (tokenWellFormed) { ...page, pending: ProposalLoading, linkOpen: true }
  else { ...page, screen: ProposalBadLink, linkOpen: false }

pure def alwaysEndedScreensCloseTheLink(page: PhotoCheck): bool =
  proposalEnded(page.screen) implies not(page.linkOpen)

pure def alwaysLoadingOnlyWhileOpening(page: PhotoCheck): bool =
  page.pending == ProposalLoading implies (page.screen == ProposalOpening and page.linkOpen)
```

### The open answer shows the proposal, the photos to choose from, or why the link does not work

The server checks the link, the browser and the member before it answers. Each answer becomes one kind:

- 200 with a good body is "shown". A proposal that names 1 to 3 of the member's 1 to 6 photos shows the proposal step. A choice or a list that names no photo shows the photos to choose from. Any other count is a page fault.
- 404 `link_unavailable` is "gone": the token is not known, the link belongs to another site, the proposal was sent or cancelled, or the member may not use photos (A4).
- 410 `link_expired` is "expired": the link is older than 15 minutes, or a newer proposal replaced it (A5).
- 403 `other_device` is "other device": another browser opened the link first.
- A request that does not reach the server, and 502 and 503 from the site router, are "unreachable".
- 400 `invalid`, 413, a 200 with a bad body and every other answer are "invalid": a page fault.

An unreachable or invalid open keeps the link and offers "Try again". The other closing answers end the step.

```quint
type CheckOpenAnswerKind = CheckOpenShown | CheckOpenGone | CheckOpenExpired | CheckOpenOtherDevice | CheckOpenInvalid | CheckOpenUnreachable
type CheckOpenAnswer = { kind: CheckOpenAnswerKind, photoCount: int, proposedCount: int }

pure val openedValues = Set(
  { kind: CheckOpenShown, photoCount: 6, proposedCount: 1 },
  { kind: CheckOpenShown, photoCount: 3, proposedCount: 2 },
  { kind: CheckOpenShown, photoCount: 2, proposedCount: 0 },
  { kind: CheckOpenShown, photoCount: 1, proposedCount: 2 },
  { kind: CheckOpenShown, photoCount: 0, proposedCount: 0 },
  { kind: CheckOpenShown, photoCount: 7, proposedCount: 1 },
  { kind: CheckOpenGone, photoCount: 0, proposedCount: 0 },
  { kind: CheckOpenExpired, photoCount: 0, proposedCount: 0 },
  { kind: CheckOpenOtherDevice, photoCount: 0, proposedCount: 0 },
  { kind: CheckOpenInvalid, photoCount: 0, proposedCount: 0 },
  { kind: CheckOpenUnreachable, photoCount: 0, proposedCount: 0 },
)
pure val kindValues = Set(CheckOpenShown, CheckOpenGone, CheckOpenExpired, CheckOpenOtherDevice, CheckOpenInvalid, CheckOpenUnreachable)
pure val photoCountValues = Set(-1, 0, 1, 2, 3, 6, 7)
pure val proposedCountValues = Set(-1, 0, 1, 2, 3, 4)

pure def photosFit(photoCount: int): bool = photoCount >= 1 and photoCount <= checkSlotsMax

pure def proposalFits(photoCount: int, proposedCount: int): bool =
  photosFit(photoCount) and proposedCount >= 1 and proposedCount <= checkSetMax and proposedCount <= photoCount

pure def screenForOpen(kind: CheckOpenAnswerKind, photoCount: int, proposedCount: int): ProposalScreen =
  if (kind == CheckOpenShown)
    (if (proposalFits(photoCount, proposedCount)) ProposalShown
    else if (photosFit(photoCount) and proposedCount == 0) ProposalPicking
    else ProposalOpenFailed)
  else if (kind == CheckOpenGone) ProposalClosed
  else if (kind == CheckOpenExpired) ProposalLapsed
  else if (kind == CheckOpenOtherDevice) ProposalOtherDevice
  else ProposalOpenFailed

pure def openErrorFor(kind: CheckOpenAnswerKind, photoCount: int, proposedCount: int): ProposalError =
  if (screenForOpen(kind, photoCount, proposedCount) != ProposalOpenFailed) ProposalNoError
  else if (kind == CheckOpenUnreachable) ProposalUnreachable
  else ProposalRequestFailed

pure def canAnswerOpen(page: PhotoCheck): bool = page.pending == ProposalLoading

pure def answerOpen(page: PhotoCheck, opened: CheckOpenAnswer): PhotoCheck =
  val screen = screenForOpen(opened.kind, opened.photoCount, opened.proposedCount)
  val photos = screen == ProposalShown or screen == ProposalPicking
  { ...page, screen: screen, pending: ProposalIdle, error: openErrorFor(opened.kind, opened.photoCount, opened.proposedCount),
    linkOpen: not(proposalEnded(screen)), photoCount: if (photos) opened.photoCount else 0,
    proposedCount: if (screen == ProposalShown) opened.proposedCount else 0, picked: 0, seen: false }

pure def canRetryOpen(page: PhotoCheck): bool =
  page.screen == ProposalOpenFailed and page.pending == ProposalIdle and page.linkOpen

pure def retryOpen(page: PhotoCheck): PhotoCheck =
  { ...page, screen: ProposalOpening, pending: ProposalLoading, error: ProposalNoError }

pure def lawEmptyProposalOpensThePicker(photoCount: int): bool =
  photosFit(photoCount) implies screenForOpen(CheckOpenShown, photoCount, 0) == ProposalPicking

pure def lawProposalNeverAboveThree(photoCount: int, proposedCount: int): bool =
  screenForOpen(CheckOpenShown, photoCount, proposedCount) == ProposalShown implies
    (proposedCount >= 1 and proposedCount <= checkSetMax and proposedCount <= photoCount)

pure def lawOnlyAShownAnswerShowsPhotos(kind: CheckOpenAnswerKind, photoCount: int, proposedCount: int): bool =
  (screenForOpen(kind, photoCount, proposedCount) == ProposalShown or screenForOpen(kind, photoCount, proposedCount) == ProposalPicking)
    implies kind == CheckOpenShown

pure def lawOpenFailureShowsAnError(kind: CheckOpenAnswerKind, photoCount: int, proposedCount: int): bool =
  (screenForOpen(kind, photoCount, proposedCount) == ProposalOpenFailed) iff
    (openErrorFor(kind, photoCount, proposedCount) != ProposalNoError)

pure def alwaysShownHoldsOneToThree(page: PhotoCheck): bool =
  page.screen == ProposalShown implies proposalFits(page.photoCount, page.proposedCount)

pure def alwaysPhotosOnlyOnTheStep(page: PhotoCheck): bool =
  page.photoCount > 0 implies (page.screen == ProposalShown or page.screen == ProposalPicking)
```

### The page sends only the proposal that the person saw, and only when the person taps "Send"

The proposal step shows only the photos that the proposal names, each with its number, its name, its day and "{Name} has it" when the receiver has it. It shows the notice from the server and the action "Send to {Name}". "Send" is on only after every named photo shows on the screen. When a photo does not load, the page offers to load the photos again in place of "Send". The page never sends a photo that the person did not see, and nothing but the "Send" tap starts a send. The request carries the revision of the proposal that the page shows, so the server refuses a send for an older proposal ("changed").

```quint
pure val loadedValues = Set(true, false)

pure def canSeeProposal(page: PhotoCheck): bool = page.screen == ProposalShown and page.pending == ProposalIdle

pure def seeProposal(page: PhotoCheck, loaded: bool): PhotoCheck = { ...page, seen: loaded }

pure def canSendProposal(page: PhotoCheck): bool =
  page.screen == ProposalShown and page.pending == ProposalIdle and page.linkOpen and page.seen and
    proposalFits(page.photoCount, page.proposedCount)

pure def sendProposal(page: PhotoCheck): PhotoCheck = { ...page, pending: ProposalSending, error: ProposalNoError }

pure def alwaysSeenOnlyOnTheProposal(page: PhotoCheck): bool = page.seen implies page.screen == ProposalShown

pure def alwaysSendingNeedsASeenProposal(page: PhotoCheck): bool =
  page.pending == ProposalSending implies
    (page.screen == ProposalShown and page.seen and page.linkOpen and proposalFits(page.photoCount, page.proposedCount))

pure def stepOnlyTheSendTapSends(before: PhotoCheck, via: str, after: PhotoCheck): bool =
  (after.pending == ProposalSending and before.pending != ProposalSending) implies (via == "sendProposal" and before.seen)

pure def stepANewProposalIsSeenAgain(before: PhotoCheck, after: PhotoCheck): bool =
  (after.screen == ProposalShown and before.screen != ProposalShown) implies not(after.seen)
```

### "Not this one" lets the person choose 1 to 3 other photos, and the page shows the new proposal before any send

"Not this one" shows every photo of the member. The person marks 1 to 3 photos. The shell does not let the person mark a photo that did not load, or a photo that the receiver already has. A pick of no photo or of more than 3 photos shows "Choose 1 to 3 photos." and the page does not send it. "Choose these" asks the server for a new proposal. It does not send a photo: the page shows the new proposal, and the person taps "Send" again after it shows.

```quint
pure val pickedValues = Set(-1, 0, 1, 2, 3, 4, 6)

pure def pickFits(photoCount: int, picked: int): bool = picked >= 1 and picked <= checkSetMax and picked <= photoCount

pure def canShowOthers(page: PhotoCheck): bool = page.screen == ProposalShown and page.pending == ProposalIdle

pure def showOthers(page: PhotoCheck): PhotoCheck =
  { ...page, screen: ProposalPicking, picked: 0, seen: false, error: ProposalNoError }

pure def canPickPhotos(page: PhotoCheck, picked: int): bool =
  page.screen == ProposalPicking and page.pending == ProposalIdle and picked >= 0 and picked <= page.photoCount

pure def pickPhotos(page: PhotoCheck, picked: int): PhotoCheck =
  { ...page, picked: picked, error: if (picked > checkSetMax) ProposalPickCount else ProposalNoError }

pure def canChoosePicked(page: PhotoCheck): bool =
  page.screen == ProposalPicking and page.pending == ProposalIdle and page.linkOpen

pure def choosePicked(page: PhotoCheck): PhotoCheck =
  if (pickFits(page.photoCount, page.picked)) { ...page, pending: ProposalChoosing, error: ProposalNoError }
  else { ...page, error: ProposalPickCount }

pure def lawPickOutsideOneToThreeIsNeverSent(photoCount: int, picked: int): bool =
  (picked < 1 or picked > checkSetMax) implies not(pickFits(photoCount, picked))

pure def alwaysChoosingNeedsAFittingPick(page: PhotoCheck): bool =
  page.pending == ProposalChoosing implies (page.screen == ProposalPicking and pickFits(page.photoCount, page.picked) and page.linkOpen)

pure def alwaysPickedWithinThePhotos(page: PhotoCheck): bool = page.picked >= 0 and page.picked <= page.photoCount

pure def stepOneRequestAtATime(before: PhotoCheck, after: PhotoCheck): bool =
  (after.pending != ProposalIdle and after.pending != before.pending) implies before.pending == ProposalIdle
```

### The answer to "Send" or "Choose these" decides between sent, a new proposal, changed, timed out, refused and closed

Each answer becomes one kind:

- 200 `offered` is "offered". After "Send", the page shows the text from the server, for example that the agent asks the receiver first. The proposal is sent, and the link closes. An `offered` answer to "Choose these" is a page fault, because a pick never sends.
- 200 `proposed` with 1 to 3 of the member's photos is "proposed". The page shows the new proposal, and the person must see it before "Send" is on. Any other count is a page fault.
- 200 `changed` is "changed": the photos or the proposal changed after the page opened. The link closes, and the page asks the person to text which photo again.
- 200 `lapsed` and 410 `link_expired` are "lapsed": the link timed out. The link closes.
- 200 `refused` is "refused": the server keeps the proposal, but it cannot offer it now (the receiver has no room, photos are off for the chat, or the daily limit). The page shows the text from the server when it has one. The link closes on the page.
- 200 `cancelled` and 404 `link_unavailable` are "closed": the proposal was withdrawn or already sent (A4). The link closes.
- 403 `other_device` is "other device". The link closes.
- A request that does not reach the server, and 502 and 503, are "unreachable". The step stays, and the person can try again.
- 400 `invalid`, 413, an unknown state and every other answer are "invalid". The step stays with a general error.

```quint
type CheckAnswerKind = CheckOffered | CheckProposed | CheckChanged | CheckLapsed | CheckRefused | CheckClosed |
  CheckOtherDevice | CheckInvalid | CheckUnreachable
type CheckAnswer = { kind: CheckAnswerKind, proposedCount: int }

pure val answerValues = Set(
  { kind: CheckOffered, proposedCount: 0 },
  { kind: CheckProposed, proposedCount: 1 },
  { kind: CheckProposed, proposedCount: 3 },
  { kind: CheckProposed, proposedCount: 4 },
  { kind: CheckChanged, proposedCount: 0 },
  { kind: CheckLapsed, proposedCount: 0 },
  { kind: CheckRefused, proposedCount: 0 },
  { kind: CheckClosed, proposedCount: 0 },
  { kind: CheckOtherDevice, proposedCount: 0 },
  { kind: CheckInvalid, proposedCount: 0 },
  { kind: CheckUnreachable, proposedCount: 0 },
)

pure def endedScreenFor(kind: CheckAnswerKind): ProposalScreen =
  if (kind == CheckChanged) ProposalChanged
  else if (kind == CheckLapsed) ProposalLapsed
  else if (kind == CheckRefused) ProposalRefused
  else if (kind == CheckClosed) ProposalClosed
  else if (kind == CheckOtherDevice) ProposalOtherDevice
  else ProposalOpening

pure def answerEndsTheStep(kind: CheckAnswerKind): bool = endedScreenFor(kind) != ProposalOpening

pure def canAnswerCheck(page: PhotoCheck): bool = page.pending == ProposalSending or page.pending == ProposalChoosing

pure def answerCheck(page: PhotoCheck, answer: CheckAnswer): PhotoCheck =
  val idle = { ...page, pending: ProposalIdle }
  val ended = { ...idle, linkOpen: false, photoCount: 0, proposedCount: 0, picked: 0, seen: false, error: ProposalNoError }
  if (answer.kind == CheckOffered and page.pending == ProposalSending) { ...ended, screen: ProposalSent }
  else if (answer.kind == CheckProposed and proposalFits(page.photoCount, answer.proposedCount))
    { ...idle, screen: ProposalShown, proposedCount: answer.proposedCount, picked: 0, seen: false, error: ProposalNoError }
  else if (answerEndsTheStep(answer.kind)) { ...ended, screen: endedScreenFor(answer.kind) }
  else if (answer.kind == CheckUnreachable) { ...idle, error: ProposalUnreachable }
  else { ...idle, error: ProposalRequestFailed }

pure val answerKindValues = Set(CheckOffered, CheckProposed, CheckChanged, CheckLapsed, CheckRefused, CheckClosed,
  CheckOtherDevice, CheckInvalid, CheckUnreachable)

pure def lawEveryEndingAnswerIsAnEndedScreen(answerKind: CheckAnswerKind): bool =
  answerEndsTheStep(answerKind) implies proposalEnded(endedScreenFor(answerKind))

pure def lawRetryAnswersKeepTheStep(answerKind: CheckAnswerKind): bool =
  (answerKind == CheckUnreachable or answerKind == CheckInvalid) implies not(answerEndsTheStep(answerKind))

pure def stepSentOnlyAfterTheSendTap(before: PhotoCheck, via: str, after: PhotoCheck): bool =
  (after.screen == ProposalSent and before.screen != ProposalSent) implies
    (via == "answerCheck" and before.pending == ProposalSending and before.seen)

pure def stepEndedStepNeverChanges(before: PhotoCheck, after: PhotoCheck): bool =
  proposalEnded(before.screen) implies after == before
```

## Story: A closed proposal sends nothing

> As a member, I want a used, withdrawn, replaced or timed-out link to stop working, so that nobody can send my photo with an old link.

### An ended step never opens again

A sent proposal, a closed link, a timed-out link, a changed proposal, a refusal, a link in use on another phone and a malformed token end the step. After that, no event opens the link again, and the page offers no action. The page tells the person to text which photo again. A link that another phone opened gives the help address, because only the person should have the link.

```quint
pure def photoCheckOffersSend(page: PhotoCheck): bool = canSendProposal(page)

pure def alwaysSendOnlyOnAnOpenLink(page: PhotoCheck): bool = photoCheckOffersSend(page) implies page.linkOpen

pure def stepLinkNeverReopens(before: PhotoCheck, after: PhotoCheck): bool =
  (not(before.linkOpen) and before.screen != ProposalOpening) implies not(after.linkOpen)
```

## Story: Reach every outcome

> As a designer of the photo check page, I want each step, each answer and each error of the page to be reachable, so that the design system gives each one a view.

### A person can send, choose other photos, and see each closed step and each error

The page can show a proposal before and after its photos show, send it, choose other photos and see the new proposal. It can show each ended step, the open failure with "Try again", an unreachable server on the proposal and the pick error.

```quint
pure def sometimesWaitingForThePhotos(page: PhotoCheck): bool = page.screen == ProposalShown and not(page.seen)
pure def sometimesReadyToSend(page: PhotoCheck): bool = canSendProposal(page)
pure def sometimesSending(page: PhotoCheck): bool = page.pending == ProposalSending
pure def sometimesSent(page: PhotoCheck): bool = page.screen == ProposalSent
pure def sometimesPicking(page: PhotoCheck): bool = page.screen == ProposalPicking and page.picked >= 1
pure def sometimesChoosing(page: PhotoCheck): bool = page.pending == ProposalChoosing
pure def sometimesPickCount(page: PhotoCheck): bool = page.error == ProposalPickCount
pure def sometimesNewProposalAfterAPick(page: PhotoCheck): bool =
  page.screen == ProposalShown and page.proposedCount == 3
pure def sometimesClosed(page: PhotoCheck): bool = page.screen == ProposalClosed
pure def sometimesLapsed(page: PhotoCheck): bool = page.screen == ProposalLapsed
pure def sometimesChanged(page: PhotoCheck): bool = page.screen == ProposalChanged
pure def sometimesRefused(page: PhotoCheck): bool = page.screen == ProposalRefused
pure def sometimesOtherDevice(page: PhotoCheck): bool = page.screen == ProposalOtherDevice
pure def sometimesBadLink(page: PhotoCheck): bool = page.screen == ProposalBadLink
pure def sometimesOpenFailed(page: PhotoCheck): bool = page.screen == ProposalOpenFailed and page.error == ProposalUnreachable
pure def sometimesUnreachableOnTheProposal(page: PhotoCheck): bool =
  page.screen == ProposalShown and page.error == ProposalUnreachable and page.seen
pure def sometimesRequestFailed(page: PhotoCheck): bool = page.error == ProposalRequestFailed and page.linkOpen
```
