# Photo upload page

The slop.date site keeps one page at `/photos/add`. It does one step: it stores the photos of an adult member from a one-time link that the conversation sent. The service sends the link `https://slop.date/photos/add#<token>` after the member texts ADD PHOTOS with the photo consent on file, or after the member answers YES PHOTOS to the consent ask. The token is 43 characters of base64url. It is the only authority: the page has no sign-in, and the link binds the person and the app, not a browser session. The link works once, for 15 minutes. The server rules are in the backend's photo upload link spec (`spec/photoUploadLink.md` on the backend branch) and in [photo policy](photoPolicy.md). The shared rules of one-step pages, such as which site serves which step, are in [one-step pages](oneStepPage.md). This spec models only what the page shows and what the page lets the person do. The page is on slop.date only, and it has no navigation, no settings and no account view.

Model header. The model does not hold files or the token. A choice of files is a `PhotoBatch`: the number of files, the size of the largest file, the total size, and whether every file has an allowed type. The token is one fact: it has the correct shape or not. The server answer is one `PhotoAnswer` kind, with the number of photos that the server kept and whether it refused some. The browser shell reads the fragment, removes it from the address, keeps the token in memory, reads the file sizes and types, builds the multipart form, sends the request, maps the status code and the error code to an answer kind, and writes the copy. Each server answer goes to this machine as one event. The shell never decides what the machine decides.

Photos are for adults (18+) only. The server checks the age, the membership, the hold and the ban when it issues the link and again when the page uses it. A minor, an unverified or banned person, a held member and a non-member never get a link. The page asks for no age. It shows the refusal that the server gives.

## Story: Add my photos from the link in my conversation

> As an adult slop.date member, I want to open the link from my conversation, choose my photos and send them once, so that the matchmaker can use them privately and nobody else can use my link.

### The page reads the token from the fragment once and opens the picker only for a well-formed token

The page reads the fragment once, when it opens. Then it removes the fragment from the address with `history.replaceState`, before it sends any request. It keeps the token only in the memory of the page. It never puts the token in storage, in the address, in a log or in the page state. A one-step photo link is never kept across a sign-in, because the page has no sign-in ([one-step pages](oneStepPage.md), "The link stays in the fragment"). A token that does not have the correct shape shows the "link has expired" step and the page sends nothing. A well-formed token opens the picker.

The page cannot know if the link is still open before it uploads, because the server has no status call for a link (gap 3). The page learns that a link is used or expired only from the upload answer. When the server adds a status call, its answer plugs in at `openPhotoPage` as one more parameter.

```quint
import photoPolicy.* from "./photoPolicy"

type PhotoScreen = PhotoOpening | PhotoBadLink | PhotoPick | PhotoDone | PhotoAllRefused | PhotoLinkClosed
type PhotoPending = PhotoIdle | PhotoUploading
type PhotoError = PhotoNoError | PhotoPickCount | PhotoPickTooLarge | PhotoPickType | PhotoConsentNeeded |
  PhotoTooLarge | PhotoUnreachable | PhotoRequestFailed
type PhotoUploadPage = {
  screen: PhotoScreen,
  pending: PhotoPending,
  error: PhotoError,
  linkOpen: bool,
  consentTicked: bool,
  chosen: int,
  savedCount: int,
  someRefused: bool,
}
pure val initial: PhotoUploadPage = {
  screen: PhotoOpening, pending: PhotoIdle, error: PhotoNoError, linkOpen: false,
  consentTicked: false, chosen: 0, savedCount: 0, someRefused: false,
}

pure val tokenWellFormedValues = Set(true, false)

pure def canOpenPhotoPage(page: PhotoUploadPage): bool = page.screen == PhotoOpening

pure def openPhotoPage(page: PhotoUploadPage, tokenWellFormed: bool): PhotoUploadPage =
  if (tokenWellFormed) { ...page, screen: PhotoPick, linkOpen: true }
  else { ...page, screen: PhotoBadLink, linkOpen: false }

pure def alwaysClosedScreensCloseTheLink(page: PhotoUploadPage): bool =
  page.screen != PhotoPick implies not(page.linkOpen)

pure def alwaysPickHasAnOpenLink(page: PhotoUploadPage): bool =
  page.screen == PhotoPick implies page.linkOpen
```

### The page checks the chosen photos against the upload limits before it sends them

The person chooses 1 to 4 photos. Each photo is a JPEG, PNG or WebP file of at most 4 MiB, and all the photos together are at most 8 MiB ([photo policy](photoPolicy.md), "Photo intake and rating have separate limits"). The page checks the count first, then the types, then the sizes. A choice that does not agree with the limits shows its error at once, and the page does not send it. The shell reads the type from the file type that the browser gives. The server reads the type from the bytes again, so this check only saves a request. The file input has no `capture` attribute, because the site's `Permissions-Policy` has `camera=()` (gap 6). The page shows no preview.

```quint
type PhotoBatch = { count: int, largestBytes: int, totalBytes: int, typesOk: bool }
type PhotoBatchCheck = BatchOk | BatchCount | BatchTooLarge | BatchType

pure val batchValues = Set(
  { count: 0, largestBytes: 0, totalBytes: 0, typesOk: true },
  { count: 1, largestBytes: 1000, totalBytes: 1000, typesOk: true },
  { count: 4, largestBytes: 4194304, totalBytes: 8388608, typesOk: true },
  { count: 5, largestBytes: 1000, totalBytes: 5000, typesOk: true },
  { count: 1, largestBytes: 4194305, totalBytes: 4194305, typesOk: true },
  { count: 3, largestBytes: 4000000, totalBytes: 8388609, typesOk: true },
  { count: 2, largestBytes: 1000, totalBytes: 2000, typesOk: false },
)

pure def photoBatchCheck(batch: PhotoBatch): PhotoBatchCheck =
  if (batch.count < 1 or batch.count > ratingMaxPhotos) BatchCount
  else if (not(batch.typesOk)) BatchType
  else if (batch.largestBytes > ratingMaxBytes or batch.totalBytes > uploadMaxBytes) BatchTooLarge
  else BatchOk

pure def batchError(check: PhotoBatchCheck): PhotoError =
  if (check == BatchCount) PhotoPickCount
  else if (check == BatchType) PhotoPickType
  else if (check == BatchTooLarge) PhotoPickTooLarge
  else PhotoNoError

pure def canChoosePhotos(page: PhotoUploadPage): bool = page.screen == PhotoPick and page.pending == PhotoIdle

pure def choosePhotos(page: PhotoUploadPage, batch: PhotoBatch): PhotoUploadPage =
  val shown = batchError(photoBatchCheck(batch))
  { ...page, chosen: batch.count,
    error: if (shown == PhotoNoError and page.error == PhotoConsentNeeded) PhotoConsentNeeded else shown }

pure def lawFiveFilesAreRefused(largestBytes: int, totalBytes: int, typesOk: bool): bool =
  photoBatchCheck({ count: 5, largestBytes: largestBytes, totalBytes: totalBytes, typesOk: typesOk }) == BatchCount

pure def lawNoFileIsRefused(batch: PhotoBatch): bool =
  batch.count < 1 implies photoBatchCheck(batch) == BatchCount

pure def lawFileOverFourMiBIsRefused(batch: PhotoBatch): bool =
  batch.largestBytes > ratingMaxBytes implies photoBatchCheck(batch) != BatchOk

pure def lawTotalOverEightMiBIsRefused(batch: PhotoBatch): bool =
  batch.totalBytes > uploadMaxBytes implies photoBatchCheck(batch) != BatchOk

pure def lawAcceptedBatchFitsTheLimits(batch: PhotoBatch): bool =
  photoBatchCheck(batch) == BatchOk implies
    (batch.count >= 1 and batch.count <= ratingMaxPhotos and batch.typesOk and
      batch.largestBytes <= ratingMaxBytes and batch.totalBytes <= uploadMaxBytes)
```

### The photo consent goes with the upload only when the person ticks it

The page shows the photo consent text exactly, with a box that the person ticks. Only a ticked box sends the consent version in the `x-photo-consent` header. A member who agreed by text does not have to tick it. No API serves the photo consent text or version, so the site build gives them to the page from the platform's `PHOTO_CONSENT` (gap 2). When the server serves the consent, the build input is where it plugs in. When the server answers that the consent is missing, the page clears the box, marks it as refused and asks the person to tick it. The link stays open for this answer. While the consent is refused and not ticked, the page does not send the photos again. Ticking the box clears the refusal.

```quint
pure val tickedValues = Set(true, false)

pure def photoConsentHeaderSent(page: PhotoUploadPage): bool = page.consentTicked

pure def canTickConsent(page: PhotoUploadPage): bool = page.screen == PhotoPick and page.pending == PhotoIdle

pure def tickConsent(page: PhotoUploadPage, ticked: bool): PhotoUploadPage =
  { ...page, consentTicked: ticked,
    error: if (ticked and page.error == PhotoConsentNeeded) PhotoNoError else page.error }

pure def alwaysConsentNeededWhileUnticked(page: PhotoUploadPage): bool =
  page.error == PhotoConsentNeeded implies not(page.consentTicked)

pure def stepConsentOnlyByThePerson(before: PhotoUploadPage, via: str, after: PhotoUploadPage): bool =
  (after.consentTicked and not(before.consentTicked)) implies via == "tickConsent"
```

### The page sends one batch while the link is open and waits for the answer

The page sends the photos only on the picker, with an open link, when no request runs and the batch agrees with the limits. The form has only `photo` parts. The `x-photo-upload-link` header carries the token. While the request runs, the form is busy and refuses a second upload.

```quint
pure def canUploadPhotos(page: PhotoUploadPage): bool =
  page.screen == PhotoPick and page.pending == PhotoIdle and page.linkOpen

pure def uploadPhotos(page: PhotoUploadPage, batch: PhotoBatch): PhotoUploadPage =
  val check = photoBatchCheck(batch)
  if (check != BatchOk) { ...page, chosen: batch.count, error: batchError(check) }
  else if (page.error == PhotoConsentNeeded and not(page.consentTicked)) page
  else { ...page, chosen: batch.count, pending: PhotoUploading, error: PhotoNoError }

pure def lawRefusedBatchIsNeverSent(page: PhotoUploadPage, batch: PhotoBatch): bool =
  photoBatchCheck(batch) != BatchOk implies uploadPhotos(page, batch).pending == page.pending

pure def lawRefusedConsentIsNotSentAgainUnticked(page: PhotoUploadPage, batch: PhotoBatch): bool =
  (page.error == PhotoConsentNeeded and not(page.consentTicked)) implies uploadPhotos(page, batch).pending == page.pending

pure def alwaysUploadOnlyWhileLinkOpen(page: PhotoUploadPage): bool =
  page.pending == PhotoUploading implies page.linkOpen

pure def alwaysUploadBelongsToThePicker(page: PhotoUploadPage): bool =
  page.pending == PhotoUploading implies (page.screen == PhotoPick and page.chosen >= 1 and page.chosen <= ratingMaxPhotos)

pure def stepOneUploadAtATime(before: PhotoUploadPage, via: str, after: PhotoUploadPage): bool =
  (after.pending == PhotoUploading and before.pending != PhotoUploading) implies (via == "uploadPhotos" and before.pending == PhotoIdle)
```

### The server answer decides between saved, refused, closed and a retry

The server checks the link before it reads the photos. Each answer becomes one kind:

- 200 with at least one photo kept is "stored". The page shows how many it saved and a line for each refused photo. The link is used.
- 422, with no photo kept, is "all refused". The page shows a line for each refusal, for example "adults only", and asks the person to text ADD PHOTOS for a new link. The link is used. A 200 that keeps no photo counts as "all refused".
- 404 and 410 `link_unavailable` are "link closed": the token is not known, the link was used or has expired, the holder is no longer eligible (for example under 18, banned or held), or the link was used on another site. The server stores nothing.
- 413 `too_large` keeps the picker and the chosen files, and asks for smaller photos. The link stays open.
- 400 `photo_count` keeps the picker and asks for 1 to 4 photos.
- 400 `consent_required` keeps the picker and asks for the consent (rule above).
- 400 `invalid`, 403, 415 and every other answer are "invalid": a page fault. The page keeps the picker and shows a general error.
- A request that does not reach the server, and 502 and 503 from the site router, are "unreachable". The page keeps the picker and the person can upload again.

The page never shows more saved photos than it sent. It never shows a score. No text follows the upload: the server only logs it. The person texts DELETE PHOTOS to remove the photos.

```quint
type PhotoAnswerKind = UploadStored | UploadAllRefused | UploadLinkClosed | UploadTooLarge | UploadCount |
  UploadConsentRequired | UploadInvalid | UploadUnreachable
type PhotoAnswer = { kind: PhotoAnswerKind, savedCount: int, someRefused: bool }

pure val answerValues = Set(
  { kind: UploadStored, savedCount: 2, someRefused: false },
  { kind: UploadStored, savedCount: 1, someRefused: true },
  { kind: UploadStored, savedCount: 0, someRefused: false },
  { kind: UploadAllRefused, savedCount: 0, someRefused: true },
  { kind: UploadLinkClosed, savedCount: 0, someRefused: false },
  { kind: UploadTooLarge, savedCount: 0, someRefused: false },
  { kind: UploadCount, savedCount: 0, someRefused: false },
  { kind: UploadConsentRequired, savedCount: 0, someRefused: false },
  { kind: UploadInvalid, savedCount: 0, someRefused: false },
  { kind: UploadUnreachable, savedCount: 0, someRefused: false },
)

pure def savedShown(answer: PhotoAnswer, chosen: int): int =
  if (answer.savedCount > chosen) chosen else answer.savedCount

pure def retryError(kind: PhotoAnswerKind): PhotoError =
  if (kind == UploadTooLarge) PhotoTooLarge
  else if (kind == UploadCount) PhotoPickCount
  else if (kind == UploadConsentRequired) PhotoConsentNeeded
  else if (kind == UploadUnreachable) PhotoUnreachable
  else PhotoRequestFailed

pure def answerClosesTheLink(kind: PhotoAnswerKind): bool =
  kind == UploadStored or kind == UploadAllRefused or kind == UploadLinkClosed

pure def canAnswerUpload(page: PhotoUploadPage): bool = page.pending == PhotoUploading

pure def answerUpload(page: PhotoUploadPage, answer: PhotoAnswer): PhotoUploadPage =
  val idle = { ...page, pending: PhotoIdle }
  val saved = savedShown(answer, page.chosen)
  if (answer.kind == UploadStored and saved >= 1)
    { ...idle, screen: PhotoDone, linkOpen: false, savedCount: saved, someRefused: answer.someRefused, error: PhotoNoError }
  else if (answer.kind == UploadStored or answer.kind == UploadAllRefused)
    { ...idle, screen: PhotoAllRefused, linkOpen: false, savedCount: 0, someRefused: answer.someRefused, error: PhotoNoError }
  else if (answer.kind == UploadLinkClosed)
    { ...idle, screen: PhotoLinkClosed, linkOpen: false, savedCount: 0, someRefused: false, error: PhotoNoError }
  else if (answer.kind == UploadConsentRequired)
    { ...idle, consentTicked: false, error: PhotoConsentNeeded }
  else { ...idle, error: retryError(answer.kind) }

pure def lawRetryAnswersShowAnError(kind: PhotoAnswerKind): bool =
  not(answerClosesTheLink(kind)) implies retryError(kind) != PhotoNoError

pure def lawSavedNeverAboveSent(answer: PhotoAnswer, chosen: int): bool =
  (chosen >= 0 and answer.savedCount >= 0) implies savedShown(answer, chosen) <= chosen

pure def alwaysSavedOnlyWhenDone(page: PhotoUploadPage): bool =
  (page.savedCount > 0) iff (page.screen == PhotoDone)

pure def alwaysSavedNoMoreThanChosen(page: PhotoUploadPage): bool =
  page.screen == PhotoDone implies page.savedCount <= page.chosen

pure def alwaysRefusalsOnlyAfterUse(page: PhotoUploadPage): bool =
  page.someRefused implies (page.screen == PhotoDone or page.screen == PhotoAllRefused)

pure def stepSavedOnlyFromTheAnswer(before: PhotoUploadPage, via: str, after: PhotoUploadPage): bool =
  (after.screen == PhotoDone and before.screen != PhotoDone) implies (via == "answerUpload" and before.pending == PhotoUploading)
```

## Story: A used or expired link stores nothing

> As a member, I want a used or expired link to stop working, so that nobody can add photos with my link after I used it or after 15 minutes.

### A closed link never opens again on the page

A used link, an expired link, a malformed token and every answer that uses the link close the link on the page. After that, no event opens it again, and the page offers no upload. The page tells the person to text ADD PHOTOS for a new link. Staging links point to production slop.date, because the server builds the link from the app domain (gap 4, server side). No agent path issues a link: the skill tells the agent to have the person text ADD PHOTOS (gap 5).

```quint
pure def photoUploadOffered(page: PhotoUploadPage): bool = page.screen == PhotoPick and page.linkOpen

pure def stepLinkNeverReopens(before: PhotoUploadPage, after: PhotoUploadPage): bool =
  (not(before.linkOpen) and before.screen != PhotoOpening) implies not(after.linkOpen)

pure def lawClosingAnswerEndsTheUpload(page: PhotoUploadPage, answer: PhotoAnswer): bool =
  (canAnswerUpload(page) and answerClosesTheLink(answer.kind)) implies not(photoUploadOffered(answerUpload(page, answer)))
```

## Story: Reach every outcome

> As a designer of the photo upload page, I want each step, each refusal and each error of the page to be reachable, so that the design system gives each one a view.

### A person can save photos, see each refusal, find the link closed or see each error

The page can save photos with and without a refused photo. It can show "all refused", the closed link and the bad link. It can show each error of the picker, the consent refusal, a server "too large", a general failure and an unreachable server, and it can upload again after an unreachable server.

```quint
pure def sometimesDone(page: PhotoUploadPage): bool = page.screen == PhotoDone and not(page.someRefused)
pure def sometimesDonePartly(page: PhotoUploadPage): bool = page.screen == PhotoDone and page.someRefused
pure def sometimesDoneWithConsent(page: PhotoUploadPage): bool = page.screen == PhotoDone and page.consentTicked
pure def sometimesAllRefused(page: PhotoUploadPage): bool = page.screen == PhotoAllRefused
pure def sometimesLinkClosed(page: PhotoUploadPage): bool = page.screen == PhotoLinkClosed
pure def sometimesBadLink(page: PhotoUploadPage): bool = page.screen == PhotoBadLink
pure def sometimesUploading(page: PhotoUploadPage): bool = page.pending == PhotoUploading
pure def sometimesPickCount(page: PhotoUploadPage): bool = page.error == PhotoPickCount
pure def sometimesPickTooLarge(page: PhotoUploadPage): bool = page.error == PhotoPickTooLarge
pure def sometimesPickType(page: PhotoUploadPage): bool = page.error == PhotoPickType
pure def sometimesConsentNeeded(page: PhotoUploadPage): bool = page.error == PhotoConsentNeeded
pure def sometimesTooLarge(page: PhotoUploadPage): bool = page.error == PhotoTooLarge and page.linkOpen
pure def sometimesRequestFailed(page: PhotoUploadPage): bool = page.error == PhotoRequestFailed
pure def sometimesUnreachable(page: PhotoUploadPage): bool = page.error == PhotoUnreachable and photoUploadOffered(page)
pure def sometimesRetryAfterUnreachable(page: PhotoUploadPage): bool =
  page.screen == PhotoPick and page.error == PhotoUnreachable and canUploadPhotos(page)
```
