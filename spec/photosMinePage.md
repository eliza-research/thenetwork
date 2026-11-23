# My photos page

The slop.date site keeps one page at `/photos/mine`. It does one step: it shows an adult member each of their photos and who has each one, and it lets the member take back one share at a time. The service sends the link `https://slop.date/photos/mine#<token>` in its answer to MY PHOTOS ("H1" in the backend's photo relay contract, `photoRelayFlow.ts`). The token is 43 characters of base64url. It is the only authority: the page has no sign-in. The link works for 15 minutes (`photoPageLinkTtlMs` in the backend's [photo relay item](photoRelayItem.md) spec) and only on the first phone that opens it. The offer rules, the sender view and the take-back rule are in [photo relay item](photoRelayItem.md). The review of each item is in [photo relay review](photoRelayReview.md). The adult rule and the photo limits are in [photo policy](photoPolicy.md), and the removal of a photo is in [photo retention](photoRetention.md). The shared rules of one-step pages are in [one-step pages](oneStepPage.md). This spec models only what the page shows and what the page lets the person do. The page is on slop.date only, and it has no navigation, no settings and no account view. Its only link is `mailto:help@ntwrk.party`.

Model header. The model does not hold the token, the photos or the first names. The list is two counts: the photos that the page shows, and the shares that still offer "Take back". A share is one first name on one photo. The shell keeps the list from the server, the token in memory, one mark for each share and one tile for each photo. The shell sends one event to this machine for each person action and for each server answer. It sets the mark of a share and the tile of a photo only with `grantMarkAfter` and `photoTileFor`, and it shows "Take back" only where `grantOffersTakeBack` lets it. The shell reads the fragment, removes it from the address, sends the requests, maps each status and error code to one answer kind, turns image bytes into object URLs, formats the day and writes the copy. These stay outside the model: the fetch calls and the status maps, the token regex, the JSON shape checks, the object URLs, `history.replaceState`, focus and the copy. The play tests of the view and `tests/e2e/photos-mine-page.e2e.test.ts` cover them.

Assumptions. The backend side of this page is written but not pushed or verified. These assumptions come from the contract (`photoRelay-CONTRACT.md`, sections 7.4 and 12) and from the unpushed `packages/platform/src/photo-pages.ts`:

- A1. `POST /api/photos/page/open {token}` answers `200 {purpose: "mine", photos: [{n, label, addedOn, access: [{firstName, state}]}], until}`. A `200` with another purpose is a link for another page. The page treats it as a link that does not work.
- A2. The access states on the wire are `asked`, `checking` and `ready`. Section 12 of the contract also names `opened`, but decision Q9 says that the sender gets no read receipt, and the backend `PhotoAccessState` has no `opened`. The page shows `opened` as `ready`, so that a server that sends it never makes a read receipt on this page.
- A3. Every share in the list can get "Take back". The server answers `nothing_open` when no open offer holds that photo for that first name. The page cannot tell an open share from a closed one before it asks, because the sender view shows a ready offer and a closed offer the same.
- A4. `answer {token, answer: "take_back", numbers: [n], firstName}` takes back photo `n` from every live match with that first name. Two matches with the same first name both lose the photo. The page marks only the share that the person tapped.
- A5. The image call needs the device cookie that the first `open` set. The page asks for each image only after the list opens.
- A6. The page does not use `until`. It learns that the link timed out only from a `410 link_expired` answer.

Photos are for adults (18+) only. The server refuses a minor, a held or banned member and a non-member when it issues the link and on each call (`photos.mayTake`), with `404 link_unavailable`. The page asks for no age. It shows no score, no rating and no photo id.

## Story: See which matches have my photos and take one back

> As an adult slop.date member, I want to open the link from my conversation and see each of my photos with the first name of each match who has it, so that I know who has what and can take back one share.

### The page reads the token from the fragment once and asks for the list only for a well-formed token

The page reads the fragment once, when it opens. Then it removes the fragment from the address with `history.replaceState`, before it sends any request. It keeps the token only in the memory of the page. It never puts the token in storage, in the address, in a log or in the page state. A token that does not have the correct shape shows "This link doesn't work" and the page sends nothing. A well-formed token asks the server for the list.

```quint
type HoldingsScreen = HoldingsOpening | HoldingsList | HoldingsEmpty | HoldingsTimedOut | HoldingsUnavailable |
  HoldingsOtherPhone | HoldingsOpenFailed
type HoldingsPending = HoldingsIdle | HoldingsReading | HoldingsTakingBack
type HoldingsNotice = HoldingsNoNotice | HoldingsUnreachable | HoldingsFailed
type PhotoHoldingsPage = {
  screen: HoldingsScreen,
  pending: HoldingsPending,
  notice: HoldingsNotice,
  linkHeld: bool,
  photos: int,
  grants: int,
  takenBack: int,
}
pure val initial: PhotoHoldingsPage = {
  screen: HoldingsOpening, pending: HoldingsIdle, notice: HoldingsNoNotice, linkHeld: false,
  photos: 0, grants: 0, takenBack: 0,
}

pure val holdingsPhotoMax: int = 6
pure val tokenWellFormedValues = Set(true, false)
pure val countValues = Set(-1, 0, 1, 6, 7)
pure val grantsValues = Set(-1, 0, 2)
pure val pageValues: Set[PhotoHoldingsPage] = Set(
  initial,
  { ...initial, pending: HoldingsReading, linkHeld: true },
  { ...initial, screen: HoldingsList, linkHeld: true, photos: 2, grants: 2 },
  { ...initial, screen: HoldingsList, linkHeld: true, photos: 1, grants: 0, takenBack: 1 },
  { ...initial, screen: HoldingsList, pending: HoldingsTakingBack, linkHeld: true, photos: 2, grants: 1 },
  { ...initial, screen: HoldingsList, notice: HoldingsFailed, linkHeld: true, photos: 1, grants: 1 },
  { ...initial, screen: HoldingsOpenFailed, notice: HoldingsUnreachable, linkHeld: true },
  { ...initial, screen: HoldingsTimedOut },
  { ...initial, screen: HoldingsEmpty },
)

pure def canOpenHoldingsPage(page: PhotoHoldingsPage): bool =
  page.screen == HoldingsOpening and page.pending == HoldingsIdle and not(page.linkHeld)

pure def openHoldingsPage(page: PhotoHoldingsPage, tokenWellFormed: bool): PhotoHoldingsPage =
  if (tokenWellFormed) { ...page, pending: HoldingsReading, linkHeld: true }
  else { ...page, screen: HoldingsUnavailable, linkHeld: false }

pure def holdingsClosed(screen: HoldingsScreen): bool =
  screen == HoldingsEmpty or screen == HoldingsTimedOut or screen == HoldingsUnavailable or screen == HoldingsOtherPhone

pure def alwaysClosedScreensDropTheLink(page: PhotoHoldingsPage): bool =
  holdingsClosed(page.screen) implies (not(page.linkHeld) and page.pending == HoldingsIdle)

pure def alwaysReadingHoldsTheLink(page: PhotoHoldingsPage): bool =
  page.pending == HoldingsReading implies (page.linkHeld and page.screen == HoldingsOpening)
```

### The open answer decides between the list, the empty list, a closed link and a retry

The page sends `open` with the token in the JSON body, never in the address. Each answer becomes one kind:

- `200` with purpose `mine` and a well-formed list is "listed". With at least one photo, the page shows the list. With no photo, the page shows the empty list and tells the person to text ADD PHOTOS. A list of more than 6 photos shows 6, because a member keeps 6 photos at most ([photo policy](photoPolicy.md)).
- `200` with another purpose, and `404 link_unavailable`, are "unavailable": the token is not known, the link is for another page or another site, or the holder may not use photos (under 18, banned, held, not a member). The page says that the link does not work.
- `410 link_expired` is "timed out": the 15 minutes passed.
- `403 other_device` is "other phone": another phone opened the link first.
- A request that does not reach the server, and `502` and `503` from the site router, are "unreachable". The page keeps the token and offers "Try again".
- `400 invalid`, a `200` with a list in the wrong shape, and every other answer are "failed": a page fault. The page keeps the token and offers "Try again".

The empty list and every closed link drop the token. Only the list and a retry keep it.

```quint
type OpenKind = OpenListed | OpenUnavailable | OpenTimedOut | OpenOtherPhone | OpenUnreachable | OpenFailed
type OpenAnswer = { kind: OpenKind, photos: int, grants: int }

pure val openedValues = Set(
  { kind: OpenListed, photos: 2, grants: 3 },
  { kind: OpenListed, photos: 1, grants: 0 },
  { kind: OpenListed, photos: 1, grants: 1 },
  { kind: OpenListed, photos: 0, grants: 0 },
  { kind: OpenListed, photos: 0, grants: 2 },
  { kind: OpenListed, photos: 9, grants: -1 },
  { kind: OpenUnavailable, photos: 0, grants: 0 },
  { kind: OpenTimedOut, photos: 0, grants: 0 },
  { kind: OpenOtherPhone, photos: 0, grants: 0 },
  { kind: OpenUnreachable, photos: 0, grants: 0 },
  { kind: OpenFailed, photos: 0, grants: 0 },
)

pure def photosShown(count: int): int =
  if (count < 0) 0 else if (count > holdingsPhotoMax) holdingsPhotoMax else count
pure def grantsShown(photos: int, grants: int): int =
  if (photosShown(photos) == 0 or grants < 0) 0 else grants

pure def closedScreenFor(kind: OpenKind): HoldingsScreen =
  if (kind == OpenTimedOut) HoldingsTimedOut
  else if (kind == OpenOtherPhone) HoldingsOtherPhone
  else HoldingsUnavailable

pure def canAnswerOpen(page: PhotoHoldingsPage): bool = page.pending == HoldingsReading

pure def answerOpen(page: PhotoHoldingsPage, opened: OpenAnswer): PhotoHoldingsPage =
  val idle = { ...page, pending: HoldingsIdle, notice: HoldingsNoNotice }
  val shown = photosShown(opened.photos)
  if (opened.kind == OpenListed and shown >= 1)
    { ...idle, screen: HoldingsList, photos: shown, grants: grantsShown(opened.photos, opened.grants), takenBack: 0 }
  else if (opened.kind == OpenListed)
    { ...idle, screen: HoldingsEmpty, linkHeld: false, photos: 0, grants: 0, takenBack: 0 }
  else if (opened.kind == OpenUnreachable)
    { ...idle, screen: HoldingsOpenFailed, notice: HoldingsUnreachable }
  else if (opened.kind == OpenFailed)
    { ...idle, screen: HoldingsOpenFailed, notice: HoldingsFailed }
  else { ...idle, screen: closedScreenFor(opened.kind), linkHeld: false, photos: 0, grants: 0, takenBack: 0 }

pure def canRetryOpen(page: PhotoHoldingsPage): bool =
  page.screen == HoldingsOpenFailed and page.pending == HoldingsIdle and page.linkHeld

pure def retryOpen(page: PhotoHoldingsPage): PhotoHoldingsPage =
  { ...page, screen: HoldingsOpening, pending: HoldingsReading, notice: HoldingsNoNotice }

pure def lawPhotosShownFitTheLimit(count: int): bool =
  photosShown(count) >= 0 and photosShown(count) <= holdingsPhotoMax
pure def lawNoPhotoMeansNoShare(grants: int): bool = grantsShown(0, grants) == 0
pure def lawOnlyAListOpensTheList(page: PhotoHoldingsPage, opened: OpenAnswer): bool =
  (canAnswerOpen(page) and answerOpen(page, opened).screen == HoldingsList) implies opened.kind == OpenListed
pure def lawRetryKindsKeepTheLink(page: PhotoHoldingsPage, opened: OpenAnswer): bool =
  (canAnswerOpen(page) and page.linkHeld and (opened.kind == OpenUnreachable or opened.kind == OpenFailed)) implies
    (answerOpen(page, opened).linkHeld == page.linkHeld and canRetryOpen(answerOpen(page, opened)))

pure def alwaysListHasAPhotoAndTheLink(page: PhotoHoldingsPage): bool =
  page.screen == HoldingsList implies (page.photos >= 1 and page.photos <= holdingsPhotoMax and page.linkHeld)
pure def alwaysOnlyTheListHasPhotos(page: PhotoHoldingsPage): bool =
  page.screen != HoldingsList implies (page.photos == 0 and page.grants == 0 and page.takenBack == 0)
pure def alwaysRetryHoldsTheLink(page: PhotoHoldingsPage): bool =
  page.screen == HoldingsOpenFailed implies (page.linkHeld and page.notice != HoldingsNoNotice)
```

### Each share shows who has the photo and how far the offer is, and never whether it was opened

Each photo shows its number, its name when it has one, and the day it was added. Below it, each share shows the first name of the match and one word: "asked" (the match has not answered yet), "checking" (a person on the safety team checks it) or "ready" (the photo is on its way). A photo with no share says that nobody has it. The page never says that a match opened a photo, because the sender gets no read receipt ([photo relay item](photoRelayItem.md), "The sender learns only sent, not taken, not approved or timed out"). A wire state that the page does not know shows "shared", and the share still offers "Take back".

```quint
type GrantWire = WireAsked | WireChecking | WireReady | WireOpened | WireUnknown
type GrantAccess = GrantAsked | GrantChecking | GrantReady | GrantShared

pure def grantAccessOf(wire: GrantWire): GrantAccess =
  if (wire == WireAsked) GrantAsked
  else if (wire == WireChecking) GrantChecking
  else if (wire == WireReady or wire == WireOpened) GrantReady
  else GrantShared

pure def lawOpenedLooksLikeReady(wire: GrantWire): bool =
  (wire == WireOpened or wire == WireReady) iff (grantAccessOf(wire) == GrantReady)
pure def lawEveryWireStateShowsAShare(wire: GrantWire): bool =
  grantAccessOf(wire) == GrantAsked or grantAccessOf(wire) == GrantChecking or
    grantAccessOf(wire) == GrantReady or grantAccessOf(wire) == GrantShared
```

### Each photo shows its image only from its own answer

After the list opens, the page asks for the image of each photo with the token and the number, in a JSON body. A `200` with an image type shows the photo from an object URL. The page offers no download. A `404 not_found` (the photo was deleted), a request that does not reach the server and every other answer show that the photo could not load, and the rest of the page stays. A `410 link_expired`, a `404 link_unavailable` and a `403 other_device` close the page as the open answer does.

```quint
type ImageKind = ImageShown | ImageMissing | ImageTimedOut | ImageUnavailable | ImageOtherPhone
type PhotoTile = TileLoading | TileShown | TileMissing

pure def photoTileFor(kind: ImageKind): PhotoTile = if (kind == ImageShown) TileShown else TileMissing

pure def imageClosesThePage(kind: ImageKind): bool =
  kind == ImageTimedOut or kind == ImageUnavailable or kind == ImageOtherPhone

pure def canAnswerImage(page: PhotoHoldingsPage): bool = page.screen == HoldingsList

pure def answerImage(page: PhotoHoldingsPage, imageAnswer: ImageKind): PhotoHoldingsPage =
  val closed = { ...page, pending: HoldingsIdle, notice: HoldingsNoNotice, linkHeld: false, photos: 0, grants: 0, takenBack: 0 }
  if (imageAnswer == ImageTimedOut) { ...closed, screen: HoldingsTimedOut }
  else if (imageAnswer == ImageUnavailable) { ...closed, screen: HoldingsUnavailable }
  else if (imageAnswer == ImageOtherPhone) { ...closed, screen: HoldingsOtherPhone }
  else page

pure def lawOnlyAnImageShowsATile(kind: ImageKind): bool = (photoTileFor(kind) == TileShown) iff (kind == ImageShown)
pure def lawAMissingImageKeepsThePage(page: PhotoHoldingsPage, imageAnswer: ImageKind): bool =
  not(imageClosesThePage(imageAnswer)) implies answerImage(page, imageAnswer) == page
```

### The person takes back one share at a time, and only the server's answer marks it taken back

A share offers "Take back" only on the list, while the page holds the token, while no other take-back runs, and while its mark is open. The page sends `answer` with `take_back`, the number of the photo and the first name of the share. While the request runs, that share shows that it is being taken back, and no other share offers "Take back". Each answer becomes one kind:

- `200 taken_back` is "done": the share shows "taken back". The match cannot open the photo again, but the page cannot undo a view that already happened.
- `200 nothing_open` is "nothing open": the share shows that there is nothing to take back, because the offer already ended.
- `410 link_expired`, `404 link_unavailable` and `403 other_device` close the page as the open answer does.
- A request that does not reach the server, and `502` and `503`, are "unreachable". The share offers "Take back" again and the page shows that it could not reach the server.
- `400 invalid`, a `200` with another state and every other answer are "failed". The share offers "Take back" again and the page shows that the take-back failed.

The receiver is not told: a take-back sends nothing to the match ([photo relay item](photoRelayItem.md)).

```quint
type TakeBackKind = TakeBackDone | TakeBackNothingOpen | TakeBackTimedOut | TakeBackUnavailable | TakeBackOtherPhone |
  TakeBackUnreachable | TakeBackFailed
type GrantMark = GrantOpen | GrantTakingBack | GrantTakenBack | GrantClosed

pure def grantMarkAfter(kind: TakeBackKind): GrantMark =
  if (kind == TakeBackDone) GrantTakenBack
  else if (kind == TakeBackNothingOpen) GrantClosed
  else GrantOpen

pure def grantOffersTakeBack(page: PhotoHoldingsPage, mark: GrantMark): bool =
  page.screen == HoldingsList and page.pending == HoldingsIdle and page.linkHeld and page.grants >= 1 and mark == GrantOpen

pure def canTakeBack(page: PhotoHoldingsPage): bool =
  page.screen == HoldingsList and page.pending == HoldingsIdle and page.linkHeld and page.grants >= 1

pure def takeBack(page: PhotoHoldingsPage): PhotoHoldingsPage =
  { ...page, pending: HoldingsTakingBack, notice: HoldingsNoNotice }

pure def canAnswerTakeBack(page: PhotoHoldingsPage): bool = page.pending == HoldingsTakingBack

pure def answerTakeBack(page: PhotoHoldingsPage, takeBackAnswer: TakeBackKind): PhotoHoldingsPage =
  val idle = { ...page, pending: HoldingsIdle, notice: HoldingsNoNotice }
  val closed = { ...idle, linkHeld: false, photos: 0, grants: 0, takenBack: 0 }
  val fewer = if (page.grants >= 1) page.grants - 1 else 0
  if (takeBackAnswer == TakeBackDone) { ...idle, grants: fewer, takenBack: page.takenBack + 1 }
  else if (takeBackAnswer == TakeBackNothingOpen) { ...idle, grants: fewer }
  else if (takeBackAnswer == TakeBackTimedOut) { ...closed, screen: HoldingsTimedOut }
  else if (takeBackAnswer == TakeBackUnavailable) { ...closed, screen: HoldingsUnavailable }
  else if (takeBackAnswer == TakeBackOtherPhone) { ...closed, screen: HoldingsOtherPhone }
  else if (takeBackAnswer == TakeBackUnreachable) { ...idle, notice: HoldingsUnreachable }
  else { ...idle, notice: HoldingsFailed }

pure def lawOnlyTheServerMarksTakenBack(kind: TakeBackKind): bool =
  (grantMarkAfter(kind) == GrantTakenBack) iff (kind == TakeBackDone)
pure def lawAFailedTakeBackOffersItAgain(kind: TakeBackKind): bool =
  (kind == TakeBackUnreachable or kind == TakeBackFailed) implies grantMarkAfter(kind) == GrantOpen
pure def lawNoTakeBackWhileOneRuns(page: PhotoHoldingsPage, mark: GrantMark): bool =
  page.pending == HoldingsTakingBack implies not(grantOffersTakeBack(page, mark))
pure def lawATakeBackNeedsAShare(page: PhotoHoldingsPage): bool =
  canTakeBack(page) implies page.grants >= 1

pure def alwaysTakeBackOnlyOnTheList(page: PhotoHoldingsPage): bool =
  page.pending == HoldingsTakingBack implies (page.screen == HoldingsList and page.linkHeld and page.grants >= 1)
pure def alwaysCountsNeverNegative(page: PhotoHoldingsPage): bool =
  page.photos >= 0 and page.grants >= 0 and page.takenBack >= 0
pure def alwaysNoticeOnlyWithTheLink(page: PhotoHoldingsPage): bool =
  page.notice != HoldingsNoNotice implies (page.linkHeld and (page.screen == HoldingsList or page.screen == HoldingsOpenFailed))

pure def stepOneTakeBackAtATime(before: PhotoHoldingsPage, via: str, after: PhotoHoldingsPage): bool =
  (after.pending == HoldingsTakingBack and before.pending != HoldingsTakingBack) implies
    (via == "takeBack" and before.pending == HoldingsIdle)
pure def stepTakenBackOnlyFromTheAnswer(before: PhotoHoldingsPage, via: str, after: PhotoHoldingsPage): bool =
  after.takenBack > before.takenBack implies
    (via == "answerTakeBack" and before.pending == HoldingsTakingBack and after.takenBack == before.takenBack + 1)
pure def stepSharesNeverGrow(before: PhotoHoldingsPage, via: str, after: PhotoHoldingsPage): bool =
  (before.screen == HoldingsList and after.screen == HoldingsList) implies after.grants <= before.grants
```

## Story: A timed-out or moved link shows nothing

> As a member, I want my photo list to open only on my phone and only for a short time, so that nobody who sees the link later can see my photos or take them back.

### A closed link never opens again on the page

A timed-out link, a link opened on another phone, a link that does not work and the empty list drop the token. After that, no event gives the page the token again, and the page offers no "Take back". The page tells the person to text MY PHOTOS for a new link. The link that does not work also names help@ntwrk.party.

```quint
pure def holdingsActionOffered(page: PhotoHoldingsPage): bool = canTakeBack(page) or canRetryOpen(page)

pure def stepClosedLinkNeverReopens(before: PhotoHoldingsPage, after: PhotoHoldingsPage): bool =
  holdingsClosed(before.screen) implies (after == before)

pure def lawClosedScreensOfferNothing(page: PhotoHoldingsPage): bool =
  holdingsClosed(page.screen) implies not(holdingsActionOffered(page))
```

## Story: Reach every outcome

> As a designer of the my photos page, I want each screen, each share mark and each error of the page to be reachable, so that the design system gives each one a view.

### A person can see the list, the empty list, each closed link and each retry, and take back a share or fail to

```quint
pure def sometimesList(page: PhotoHoldingsPage): bool = page.screen == HoldingsList and page.grants >= 1
pure def sometimesListNobodyHasThem(page: PhotoHoldingsPage): bool = page.screen == HoldingsList and page.grants == 0 and page.takenBack == 0
pure def sometimesEmpty(page: PhotoHoldingsPage): bool = page.screen == HoldingsEmpty
pure def sometimesTimedOut(page: PhotoHoldingsPage): bool = page.screen == HoldingsTimedOut
pure def sometimesUnavailable(page: PhotoHoldingsPage): bool = page.screen == HoldingsUnavailable
pure def sometimesOtherPhone(page: PhotoHoldingsPage): bool = page.screen == HoldingsOtherPhone
pure def sometimesOpenUnreachable(page: PhotoHoldingsPage): bool = page.screen == HoldingsOpenFailed and page.notice == HoldingsUnreachable
pure def sometimesOpenFailed(page: PhotoHoldingsPage): bool = page.screen == HoldingsOpenFailed and page.notice == HoldingsFailed
pure def sometimesTakingBack(page: PhotoHoldingsPage): bool = page.pending == HoldingsTakingBack
pure def sometimesTakenBack(page: PhotoHoldingsPage): bool = page.screen == HoldingsList and page.takenBack >= 1 and page.grants >= 1
pure def sometimesAllTakenBack(page: PhotoHoldingsPage): bool = page.screen == HoldingsList and page.takenBack >= 1 and page.grants == 0
pure def sometimesTakeBackUnreachable(page: PhotoHoldingsPage): bool = page.screen == HoldingsList and page.notice == HoldingsUnreachable
pure def sometimesTakeBackFailed(page: PhotoHoldingsPage): bool = page.screen == HoldingsList and page.notice == HoldingsFailed and canTakeBack(page)
```
