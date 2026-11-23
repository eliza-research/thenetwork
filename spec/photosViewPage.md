# Photo view page

The slop.date site keeps one page at `/photos/view`. It does one step: it shows a member the photos that a match chose to send, after the member said yes and a person on the safety team approved them. The service sends the link `https://slop.date/photos/view#<token>` in the "photo is ready" text (R5 in the backend photo relay contract). The token is 32 random bytes in base64url (43 characters). It is the only authority: the page has no sign-in. The first open binds the link to that browser, and the photos then open only on that phone, for 24 hours from the first open. The server rules are in [photo relay](photoRelayItem.md) ("The receiver answers, a person checks, and the photo opens on one phone" and "A page opens only from its own fresh link, and a view only on the bound phone") and in [photo relay review](photoRelayReview.md). Photos are for adults (18+) only ([photo policy](photoPolicy.md)): the server makes an offer only between two adult matches, and it ends the offer when a party is a minor or has no known age. The shared rules of one-step pages are in [one-step pages](oneStepPage.md). This spec models only what the page shows and what the page lets the person do. The page is on slop.date only. It has no navigation, no settings, no account view and no sign-in link. Its only outbound link is `mailto:help@ntwrk.party`.

**Model header.** The model does not hold the token, the photos, the sender's first name or the end time. The token is one fact: it has the correct shape or not. Each server answer is one answer kind; the open answer also carries the number of photos. The browser shell reads the fragment, removes it from the address, keeps the token in memory, sends the requests, maps each status code and error code to one answer kind, turns the image bytes into object URLs, releases them, runs the end-of-window timer and writes the copy. Each server answer and the timer go to this machine as one event. The shell never decides what the machine decides.

**Assumptions.** The server side is written but not merged and not verified, and the owner has not confirmed the `/photos/view` delivery. This spec follows the backend contract (`photoRelay-CONTRACT.md`, sections 7.4 and 12) and the unmerged `packages/platform/src/photo-pages.ts`:

1. A1. `POST /api/photos/page/open {token}` answers `200 {purpose: "view", fromFirstName, count, until}` on the first open of a ready offer and on a later open on the bound phone. `until` is the end of the view window in epoch milliseconds.
2. A2. `POST /api/photos/page/image {token, n}` answers the bytes of photo `n` (1 to `count`) with an image content type, or `404 not_found` when that photo is no longer in the offer.
3. A3. `POST /api/photos/page/answer {token, answer: "report"}` answers `200 {state: "reported"}`.
4. A4. The server gives one answer, `410 link_expired`, for an expired window, an offer that the sender took back, an offer that ended (STOP, leave, block, ban, hold, a closed chat, a deleted photo), a reported offer and a closed offer. `404 link_unavailable` is an unknown token or a token of another site. `403 other_device` is a bound link on another browser.
5. A5. An offer holds 1 to 3 photos (`photoSetMax` in [photo relay](photoRelayItem.md)). `photoViewMax` here must stay equal to it.
6. A6. The site's `Content-Security-Policy` allows `img-src 'self' data: blob:` (`SECURITY_HEADERS` in `sites/sites.ts`), so that the page can show the bytes from an object URL. The three photo pages need it.
7. A7. A good open answer always has a first name. An answer without one is a page fault.

## Story: See the photo my match chose to send me

> As an adult slop.date member who said yes to a photo, I want to open the link from my conversation and see the photo on my phone, so that I see what my match chose to share and nobody else can open it.

### The page opens the photos only when the person taps, and only from a well-formed token

The page reads the fragment once, when it opens. Then it removes the fragment from the address with `history.replaceState`, before it sends any request. It keeps the token only in the memory of the page, never in storage, in the address, in a log or in the page state. A token that does not have the correct shape shows the "no longer available" step, and the page sends nothing.

A well-formed token shows the tap step. The tap step does not name the sender and shows no photo. The page sends the open request only when the person taps. The first open binds the phone and starts the 24-hour window, so a link preview or a page that a messaging app loads in the background must not start it. While the open request runs, the page refuses a second tap.

The open answer goes to one of four steps. A good answer with 1 to 3 photos shows the photos and starts to load them. A bound link on another phone shows the "other phone" step. A gone link shows the "no longer available" step. A request that does not reach the server shows the tap step again with the "unreachable" error, and every other answer, also a good answer with a photo count outside 1 to 3, shows the tap step with the general error. From both errors the person can tap again.

```quint
type ViewScreen = ViewOpening | ViewTap | ViewShowing | ViewConfirmReport | ViewReported | ViewOtherDevice | ViewGone
type ViewPending = ViewIdle | ViewOpeningLink | ViewLoadingPhotos | ViewReporting
type ViewError = ViewNoError | ViewUnreachable | ViewRequestFailed
type PhotosViewPage = {
  screen: ViewScreen,
  pending: ViewPending,
  error: ViewError,
  linkHeld: bool,
  opened: bool,
  count: int,
  loaded: int,
  missing: int,
  reportLost: bool,
}
pure val initial: PhotosViewPage = {
  screen: ViewOpening, pending: ViewIdle, error: ViewNoError, linkHeld: false,
  opened: false, count: 0, loaded: 0, missing: 0, reportLost: false,
}

pure val photoViewMax: int = 3

type ViewOpenKind = OpenShown | OpenOtherDevice | OpenGone | OpenUnreachable | OpenFailed
type ViewOpenAnswer = { kind: ViewOpenKind, count: int }

pure val tokenWellFormedValues = Set(true, false)
pure val openAnswerValues = Set(
  { kind: OpenShown, count: 1 },
  { kind: OpenShown, count: 3 },
  { kind: OpenShown, count: 0 },
  { kind: OpenShown, count: 4 },
  { kind: OpenOtherDevice, count: 0 },
  { kind: OpenGone, count: 0 },
  { kind: OpenUnreachable, count: 0 },
  { kind: OpenFailed, count: 1 },
)

pure def viewClosed(screen: ViewScreen, opened: bool, reportLost: bool): PhotosViewPage =
  { ...initial, screen: screen, opened: opened, reportLost: reportLost }

pure def viewCountOk(count: int): bool = count >= 1 and count <= photoViewMax

pure def viewScreenAfterOpen(openAnswer: ViewOpenAnswer): ViewScreen =
  if (openAnswer.kind == OpenShown and viewCountOk(openAnswer.count)) ViewShowing
  else if (openAnswer.kind == OpenOtherDevice) ViewOtherDevice
  else if (openAnswer.kind == OpenGone) ViewGone
  else ViewTap

pure def viewOpenError(kind: ViewOpenKind): ViewError =
  if (kind == OpenUnreachable) ViewUnreachable else ViewRequestFailed

pure def canOpenViewPage(page: PhotosViewPage): bool = page.screen == ViewOpening

pure def openViewPage(page: PhotosViewPage, tokenWellFormed: bool): PhotosViewPage =
  if (tokenWellFormed) { ...page, screen: ViewTap, linkHeld: true }
  else viewClosed(ViewGone, false, false)

pure def canTapToView(page: PhotosViewPage): bool =
  page.screen == ViewTap and page.pending == ViewIdle and page.linkHeld

pure def tapToView(page: PhotosViewPage): PhotosViewPage =
  { ...page, pending: ViewOpeningLink, error: ViewNoError }

pure def canAnswerViewOpen(page: PhotosViewPage): bool = page.pending == ViewOpeningLink

pure def answerViewOpen(page: PhotosViewPage, openAnswer: ViewOpenAnswer): PhotosViewPage =
  val screen = viewScreenAfterOpen(openAnswer)
  if (screen == ViewShowing)
    { ...page, screen: ViewShowing, pending: ViewLoadingPhotos, error: ViewNoError, opened: true,
      count: openAnswer.count, loaded: 0, missing: 0 }
  else if (screen == ViewTap) { ...page, pending: ViewIdle, error: viewOpenError(openAnswer.kind) }
  else viewClosed(screen, page.opened, false)

pure def lawOnlyAGoodOpenShowsPhotos(openAnswer: ViewOpenAnswer): bool =
  (viewScreenAfterOpen(openAnswer) == ViewShowing) iff (openAnswer.kind == OpenShown and viewCountOk(openAnswer.count))

pure def lawOpenRetryShowsAnError(openAnswer: ViewOpenAnswer): bool =
  viewScreenAfterOpen(openAnswer) == ViewTap implies viewOpenError(openAnswer.kind) != ViewNoError

pure def stepOpenOnlyByTap(before: PhotosViewPage, via: str, after: PhotosViewPage): bool =
  (after.pending == ViewOpeningLink and before.pending != ViewOpeningLink) implies (via == "tapToView" and before.screen == ViewTap)

pure def alwaysNoPhotoBeforeTheOpen(page: PhotosViewPage): bool =
  (page.loaded > 0 or page.screen == ViewShowing or page.screen == ViewConfirmReport) implies page.opened

pure def alwaysRequestsNeedTheLink(page: PhotosViewPage): bool =
  page.pending != ViewIdle implies page.linkHeld
```

### The page loads each photo of the offer once and shows only what the server gives

After a good open answer, the page asks for photo 1, then photo 2, up to the count, one at a time. Each image answer is one event. A photo that the server gives shows on the page. A photo that the server no longer has (`404 not_found`, for example after the sender took back one photo of the offer) is left out, and the page does not say that a photo is missing, so that the receiver does not learn of a take-back. When the server has none of the photos, the page shows the "no longer available" step. A bound link on another phone shows the "other phone" step, and a gone link shows the "no longer available" step. A request that does not reach the server, and every other answer, releases the loaded photos and shows the tap step with its error, so the person can tap again. The page never shows more photos than the offer holds.

```quint
type ViewImageAnswer = ImageShown | ImageMissing | ImageOtherDevice | ImageGone | ImageUnreachable | ImageFailed

pure val imageValues = Set(ImageShown, ImageMissing, ImageOtherDevice, ImageGone, ImageUnreachable, ImageFailed)

pure def viewLoadSettles(loaded: int, missing: int, count: int): bool = loaded + missing + 1 >= count

pure def canAnswerViewImage(page: PhotosViewPage): bool =
  page.pending == ViewLoadingPhotos and page.loaded + page.missing < page.count

pure def answerViewImage(page: PhotosViewPage, image: ViewImageAnswer): PhotosViewPage =
  val settles = viewLoadSettles(page.loaded, page.missing, page.count)
  val afterwards = if (settles) ViewIdle else ViewLoadingPhotos
  if (image == ImageShown) { ...page, loaded: page.loaded + 1, pending: afterwards }
  else if (image == ImageMissing and settles and page.loaded == 0) viewClosed(ViewGone, true, false)
  else if (image == ImageMissing) { ...page, missing: page.missing + 1, pending: afterwards }
  else if (image == ImageOtherDevice) viewClosed(ViewOtherDevice, true, false)
  else if (image == ImageGone) viewClosed(ViewGone, true, false)
  else
    { ...page, screen: ViewTap, pending: ViewIdle, loaded: 0, missing: 0,
      error: if (image == ImageUnreachable) ViewUnreachable else ViewRequestFailed }

pure def alwaysPhotosWithinTheOffer(page: PhotosViewPage): bool =
  page.loaded >= 0 and page.missing >= 0 and page.loaded + page.missing <= page.count and page.count <= photoViewMax

pure def alwaysShowingHasAPhotoOrLoads(page: PhotosViewPage): bool =
  page.screen == ViewShowing implies (page.loaded > 0 or page.pending == ViewLoadingPhotos)
```

### The page offers no way to save the photo, and says what it cannot stop

The page shows each photo as an image from an object URL in memory. It has no download link, no file name, no share button and no link to the image. The image is not a link and cannot be dragged. The page turns off the context menu over the photo and the long-press callout on iOS Safari (`-webkit-touch-callout: none`), and the image takes no pointer events, so a long press on a phone does not offer "Save image" where the browser lets a page turn it off. The server sends the bytes with `cache-control: private, no-store` and `content-security-policy: default-src 'none'`. The page keeps the object URLs only while `viewPhotosHeld` is true, and releases each one when it becomes false: on a report, at the end of the window, on every closed step and on a failed load. It also releases them when the page closes. It shows them only while `viewPhotosShown` is true, so the confirm step hides the photos.

A web page cannot stop every copy. A person can take a screenshot or a screen recording, photograph the screen with another camera, or read the bytes with the browser's developer tools or an extension. Some browsers still offer to save an image in a way a page cannot turn off. The sender's notice says so before they send ("could take a screenshot"), and the page asks the receiver not to share the photo. These copies stay outside the model.

```quint
pure def viewPhotosHeld(page: PhotosViewPage): bool =
  page.loaded > 0 and (page.screen == ViewShowing or page.screen == ViewConfirmReport)

pure def viewPhotosShown(page: PhotosViewPage): bool = page.screen == ViewShowing and page.loaded > 0

pure def alwaysPhotosOnlyOnTheViewSteps(page: PhotosViewPage): bool =
  page.loaded > 0 implies (page.screen == ViewShowing or page.screen == ViewConfirmReport)

pure def alwaysConfirmHidesThePhotos(page: PhotosViewPage): bool =
  page.screen == ViewConfirmReport implies not(viewPhotosShown(page))
```

### The photos close at the end of the window

The open answer gives the end of the window. The shell starts a timer for it. When the timer fires, the page releases the photos and shows the "no longer available" step. The server also refuses every later call after the end (`410 link_expired`), so the timer only closes the photos sooner on a page that stays open. A report that runs when the window ends is not cut: its answer decides the step.

```quint
pure def canEndViewWindow(page: PhotosViewPage): bool =
  page.opened and page.linkHeld and page.pending != ViewReporting and
    (page.screen == ViewTap or page.screen == ViewShowing or page.screen == ViewConfirmReport)

pure def endViewWindow(page: PhotosViewPage): PhotosViewPage = viewClosed(ViewGone, true, false)
```

## Story: Report a photo that is not okay

> As a member who got a photo, I want to report it from the page, so that the photo closes at once and the safety team looks at it.

### A report needs a confirm, goes once, and only the server's answer says it is done

The photo step has one action: "Report". It is offered only when at least one photo shows and no request runs. A report closes the photo for good and the safety team reviews the sender, so the page asks once more. The confirm step hides the photos and has "Report" and "Back". "Back" shows the photos again. "Report" sends the report once. While it runs, the page refuses a second report.

Only `200 {state: "reported"}` shows the "reported" step. A gone link shows the "no longer available" step with the note that the report did not go, because the offer closed before it arrived (for example the window ended or the sender took the photo back). The note gives help@ntwrk.party. A bound link on another phone does the same on the "other phone" step. A request that does not reach the server, and every other answer, keep the confirm step with the error, so the person can send the report again.

```quint
type ViewReportAnswer = ReportDone | ReportGone | ReportOtherDevice | ReportUnreachable | ReportFailed

pure val reportValues = Set(ReportDone, ReportGone, ReportOtherDevice, ReportUnreachable, ReportFailed)

pure def viewScreenAfterReport(report: ViewReportAnswer): ViewScreen =
  if (report == ReportDone) ViewReported
  else if (report == ReportGone) ViewGone
  else if (report == ReportOtherDevice) ViewOtherDevice
  else ViewConfirmReport

pure def canAskToReport(page: PhotosViewPage): bool =
  page.screen == ViewShowing and page.pending == ViewIdle and page.loaded >= 1

pure def askToReport(page: PhotosViewPage): PhotosViewPage = { ...page, screen: ViewConfirmReport, error: ViewNoError }

pure def canKeepViewing(page: PhotosViewPage): bool = page.screen == ViewConfirmReport and page.pending == ViewIdle

pure def keepViewing(page: PhotosViewPage): PhotosViewPage = { ...page, screen: ViewShowing, error: ViewNoError }

pure def canSendReport(page: PhotosViewPage): bool =
  page.screen == ViewConfirmReport and page.pending == ViewIdle and page.linkHeld

pure def sendReport(page: PhotosViewPage): PhotosViewPage = { ...page, pending: ViewReporting, error: ViewNoError }

pure def canAnswerReport(page: PhotosViewPage): bool = page.pending == ViewReporting

pure def answerReport(page: PhotosViewPage, report: ViewReportAnswer): PhotosViewPage =
  val screen = viewScreenAfterReport(report)
  if (screen == ViewConfirmReport)
    { ...page, pending: ViewIdle, error: if (report == ReportUnreachable) ViewUnreachable else ViewRequestFailed }
  else viewClosed(screen, true, screen != ViewReported)

pure def lawOnlyTheServerConfirmsAReport(report: ViewReportAnswer): bool =
  (viewScreenAfterReport(report) == ViewReported) iff (report == ReportDone)

pure def lawAFailedReportCanBeSentAgain(report: ViewReportAnswer): bool =
  (report == ReportUnreachable or report == ReportFailed) implies viewScreenAfterReport(report) == ViewConfirmReport

pure def stepReportOnlyAfterTheConfirm(before: PhotosViewPage, via: str, after: PhotosViewPage): bool =
  (after.pending == ViewReporting and before.pending != ViewReporting) implies (via == "sendReport" and before.screen == ViewConfirmReport)

pure def stepReportedOnlyFromTheServer(before: PhotosViewPage, via: str, after: PhotosViewPage): bool =
  (after.screen == ViewReported and before.screen != ViewReported) implies (via == "answerReport" and before.pending == ViewReporting)

pure def alwaysConfirmHasAPhoto(page: PhotosViewPage): bool =
  page.screen == ViewConfirmReport implies (page.loaded >= 1 and page.opened)

pure def alwaysReportLostOnlyOnAClosedStep(page: PhotosViewPage): bool =
  page.reportLost implies (page.screen == ViewGone or page.screen == ViewOtherDevice)
```

## Story: A link on another phone, an ended offer or a report shows nothing

> As a member who got a photo, I want the link to show the photo only on my phone and only while the offer is open, so that a forwarded link shows nothing and a closed photo stays closed.

### A closed step never opens again, and a withdrawn photo looks like an expired one

The "other phone" step, the "no longer available" step and the "reported" step are final. The page drops the token and every photo, and no event changes the step again. To see the photos again, the person opens the link on the bound phone while the window is open.

The page shows one "no longer available" step for every ended offer: the window ended, the sender took the photo back, the offer ended, it was reported, or the token is not known. The server gives the same answer for all of them (A4), and the page has no other way to tell them apart. This is on purpose: the receiver never learns that the sender took a photo back ([photo relay](photoRelayItem.md): a take-back sends nothing to the receiver). The step says nothing about why.

```quint
pure def viewEnded(screen: ViewScreen): bool =
  screen == ViewReported or screen == ViewOtherDevice or screen == ViewGone

pure def alwaysEndedPagesHoldNothing(page: PhotosViewPage): bool =
  viewEnded(page.screen) implies (not(page.linkHeld) and page.loaded == 0 and page.pending == ViewIdle)

pure def stepEndsAreFinal(before: PhotosViewPage, after: PhotosViewPage): bool =
  viewEnded(before.screen) implies after == before

pure def lawEveryEndedOfferLooksTheSame(count: int): bool =
  viewScreenAfterOpen({ kind: OpenGone, count: count }) == ViewGone

pure val countValues = Set(-1, 0, 1, 3, 4)
```

## Story: Reach every outcome

> As a designer of the photo view page, I want each step, each answer and each error of the page to be reachable, so that the design system gives each one a view.

### A person can see one or three photos, see part of an offer, report, and find each closed step and error

```quint
pure def sometimesTap(page: PhotosViewPage): bool = page.screen == ViewTap and not(page.opened)
pure def sometimesOpening(page: PhotosViewPage): bool = page.pending == ViewOpeningLink
pure def sometimesLoading(page: PhotosViewPage): bool = page.pending == ViewLoadingPhotos and page.loaded >= 1
pure def sometimesShowingOne(page: PhotosViewPage): bool = viewPhotosShown(page) and page.pending == ViewIdle and page.count == 1
pure def sometimesShowingThree(page: PhotosViewPage): bool = viewPhotosShown(page) and page.pending == ViewIdle and page.loaded == 3
pure def sometimesShowingPart(page: PhotosViewPage): bool = viewPhotosShown(page) and page.pending == ViewIdle and page.missing > 0
pure def sometimesConfirmReport(page: PhotosViewPage): bool = page.screen == ViewConfirmReport and page.pending == ViewIdle
pure def sometimesReporting(page: PhotosViewPage): bool = page.pending == ViewReporting
pure def sometimesReportRetry(page: PhotosViewPage): bool = page.screen == ViewConfirmReport and page.error == ViewUnreachable and canSendReport(page)
pure def sometimesReported(page: PhotosViewPage): bool = page.screen == ViewReported
pure def sometimesOtherDevice(page: PhotosViewPage): bool = page.screen == ViewOtherDevice and not(page.reportLost)
pure def sometimesGone(page: PhotosViewPage): bool = page.screen == ViewGone and not(page.opened)
pure def sometimesWindowEnded(page: PhotosViewPage): bool = page.screen == ViewGone and page.opened and not(page.reportLost)
pure def sometimesReportLost(page: PhotosViewPage): bool = page.screen == ViewGone and page.reportLost
pure def sometimesUnreachable(page: PhotosViewPage): bool = page.screen == ViewTap and page.error == ViewUnreachable and canTapToView(page)
pure def sometimesRequestFailed(page: PhotosViewPage): bool = page.screen == ViewTap and page.error == ViewRequestFailed
pure def sometimesTapAgainAfterAPhotoFailed(page: PhotosViewPage): bool = page.screen == ViewTap and page.opened and page.error != ViewNoError
```

## What stays outside the model

The fetch calls and the status-to-answer maps (`packages/ui/src/api/photosView.ts`), the token regex, `history.replaceState`, the object URLs and their release, the end-of-window timer and `Date.now`, the context-menu and callout styles, focus and the copy. The play tests of `PhotosViewPageView` and `tests/e2e/photos-view-page.e2e.test.ts` cover them. Screenshots and the other copies in "The page offers no way to save the photo" are outside every test.
