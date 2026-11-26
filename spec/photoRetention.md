# Private photo storage and removal

The [standalone photo model](models/photos_rating.md) covers concurrent account changes and photo requests. This module directs one upload or removal. The shell owns member and app lookups, image parsing and metadata stripping, private object storage, and database writes. A member replaces a photo through the existing add and remove operations.

## Story: Add and remove photos for private matching

> As an adult Slop member, I want to store a permitted photo privately, remove it when I choose, and have the current selection drive my private rating.

### Consent, adult eligibility, and a valid image precede storage

With storage configured, Slop first checks that the app accepts photos and the member gave the current consent. It then checks the member's ban and adult status with the app's own eligibility rule. The service checks the size and type, checks that there is an available slot, and removes metadata before it reserves the photo row. The slot check here is an early answer; the reservation checks it again under the lock. Refuse an invalid image without writing it.

```quint
type PhotoPhase = ChoosingChange | CheckingUploader | ScreeningFile | CheckingSlots | CleaningImage |
  ReservingRow | WritingBytes | WritingRow | DiscardingUpload | RemovingBytes | ClearingRating | RemovingRow | Rerating |
  ChangeFinished | UnsupportedApp | ConsentMissing | SizeExceeded | ChangeRefused
type PhotoChange = { phase: PhotoPhase, rerateAfterRemoval: bool }

pure val initial: PhotoChange = { phase: ChoosingChange, rerateAfterRemoval: false }

pure def canBeginUpload(c: PhotoChange): bool = c.phase == ChoosingChange
pure def beginUpload(c: PhotoChange, appAllowed: bool, consentCurrent: bool): PhotoChange =
  { ...c, phase: if (not(appAllowed)) UnsupportedApp else if (not(consentCurrent)) ConsentMissing else CheckingUploader }

pure def canCheckUploader(c: PhotoChange): bool = c.phase == CheckingUploader
pure def checkUploader(c: PhotoChange, eligible: bool): PhotoChange =
  { ...c, phase: if (eligible) ScreeningFile else ChangeRefused }

pure def canScreenFile(c: PhotoChange): bool = c.phase == ScreeningFile
pure def screenFile(c: PhotoChange, tooLarge: bool, typeKnown: bool): PhotoChange =
  { ...c, phase: if (tooLarge) SizeExceeded else if (typeKnown) CheckingSlots else ChangeRefused }

pure def canCheckSlots(c: PhotoChange): bool = c.phase == CheckingSlots
pure def checkSlots(c: PhotoChange, available: bool): PhotoChange =
  { ...c, phase: if (available) CleaningImage else ChangeRefused }

pure def canCleanImage(c: PhotoChange): bool = c.phase == CleaningImage
pure def cleanImage(c: PhotoChange, cleaned: bool): PhotoChange =
  { ...c, phase: if (cleaned) ReservingRow else ChangeRefused }
```

### Reserve the photo row under the person lock before the bytes

The shell reserves the photo row before it writes any byte. In one transaction that holds the person row lock, it checks again that the member may give the photo (not banned, an adult with the app's own check, a live membership) and that a slot is available, counting the rows that are reserved or stored, and then inserts the row as reserved. A reserved row is not a photo yet: no listing, rating, relay or staff link reads it. The shell then writes the stripped bytes under the row's random private key and confirms the row only while the row is still reserved and not hidden by a removal. A confirmed row is a stored photo, and the shell then requests a private rating of the current photos. A failed rating attempt does not change the result of the upload. When the confirmation finds the row hidden, the upload erases its own bytes and its row and is refused. Changed (audits PR-D1 to PR-D3): the bytes came first and the row followed with no second eligibility check, no lock and no ordering against a removal -> the row is reserved first under the person lock, because an upload during a leave, an erasure or an age drop kept the photo, parallel uploads passed the maximum, and a crash left bytes that no row named.

```quint
pure def canReserveRow(c: PhotoChange): bool = c.phase == ReservingRow
pure def reserveRow(c: PhotoChange, admitted: bool): PhotoChange =
  { ...c, phase: if (admitted) WritingBytes else ChangeRefused }

pure def canRecordUploadBytes(c: PhotoChange): bool = c.phase == WritingBytes
pure def recordUploadBytes(c: PhotoChange): PhotoChange = { ...c, phase: WritingRow }

pure def canRecordUploadRow(c: PhotoChange): bool = c.phase == WritingRow
pure def recordUploadRow(c: PhotoChange, confirmed: bool): PhotoChange =
  { ...c, phase: if (confirmed) Rerating else DiscardingUpload }

pure def canRecordUploadDiscard(c: PhotoChange): bool = c.phase == DiscardingUpload
pure def recordUploadDiscard(c: PhotoChange): PhotoChange = { ...c, phase: ChangeRefused }

pure def canFinishRerate(c: PhotoChange): bool = c.phase == Rerating
pure def finishRerate(c: PhotoChange): PhotoChange = { ...c, phase: ChangeFinished }

pure def stepBytesRequireReservedRow(before: PhotoChange, via: str, after: PhotoChange): bool =
  after.phase == WritingBytes implies (before.phase == ReservingRow and via == "reserveRow")

pure def stepRowWriteRequiresBytes(before: PhotoChange, via: str, after: PhotoChange): bool =
  after.phase == WritingRow implies (before.phase == WritingBytes and via == "recordUploadBytes")

pure def sometimesDiscardsUpload(c: PhotoChange): bool = c.phase == DiscardingUpload
```

### Drop the old rating before erasing bytes and metadata

An individual removal requires a photo belonging to the member and requested app. A privacy erasure processes the photos of the member and, when supplied, the requested app; the text command DELETE PHOTOS is a privacy erasure of the person's photos on every app, whatever app the shared line routes the message to, and it is not taken from a banned person, whose photos stay for the safety team. The shell first hides each selected row in one transaction that holds the person row lock, so that no listing, rating or relay reads it again and a reserved upload of the same person cannot confirm. For each row this request hid, the shell runs the rating-removal hook, deletes its stored bytes, and then deletes the row, so that a failed byte deletion never leaves a rating of a deleted photo. The hidden row is the durable record of the removal until the last step. An individual removal requests a new rating from the remaining photos. Bulk erasure completes each removal without requesting another rating. A reserved row that an erasure hides stays for its upload, which erases its own bytes and row. Changed (audits PR-D1 and PR-D3): the bytes went first with no hidden row, the row was deleted before the rating, and DELETE PHOTOS worked only on a Slop route -> a hidden row records the removal until its last step, the rating goes first, and the command works on every route, because a crash or a failed byte deletion left a rating of a deleted photo or unnamed bytes, a concurrent upload could write after the erasure, and a member of two apps could not use the command.

```quint
pure def canBeginRemoval(c: PhotoChange): bool = c.phase == ChoosingChange
pure def beginRemoval(c: PhotoChange, owned: bool, rerate: bool): PhotoChange =
  { phase: if (owned) ClearingRating else ChangeRefused, rerateAfterRemoval: rerate }

pure def canRecordRatingClear(c: PhotoChange): bool = c.phase == ClearingRating
pure def recordRatingClear(c: PhotoChange): PhotoChange = { ...c, phase: RemovingBytes }

pure def canRecordRemovedBytes(c: PhotoChange): bool = c.phase == RemovingBytes
pure def recordRemovedBytes(c: PhotoChange): PhotoChange = { ...c, phase: RemovingRow }

pure def canRecordRemovedRow(c: PhotoChange): bool = c.phase == RemovingRow
pure def recordRemovedRow(c: PhotoChange): PhotoChange =
  { ...c, phase: if (c.rerateAfterRemoval) Rerating else ChangeFinished }

pure def stepBytesRemovalRequiresRatingClear(before: PhotoChange, via: str, after: PhotoChange): bool =
  after.phase == RemovingBytes implies (before.phase == ClearingRating and via == "recordRatingClear")

pure def stepRowRemovalRequiresBytesRemoval(before: PhotoChange, via: str, after: PhotoChange): bool =
  after.phase == RemovingRow implies (before.phase == RemovingBytes and via == "recordRemovedBytes")

pure def sometimesCompletesChange(c: PhotoChange): bool = c.phase == ChangeFinished
pure def sometimesWritesPhoto(c: PhotoChange): bool = c.phase == WritingRow
pure def sometimesRemovesPhoto(c: PhotoChange): bool = c.phase == RemovingRow
```

### The retention tick finishes unfinished photo changes

Every retention tick, the shell finishes each photo change that a crash or an error left behind. A hidden row is due once fifteen minutes have passed since it was hidden, and a reserved row once fifteen minutes have passed since it was reserved; the wait lets the request in flight finish its own change first. For a due row the shell runs the rating-removal hook when the row was a stored photo, deletes the stored bytes, deletes the row, and requests a new rating of what is left. Every step repeats safely. A row or a holder whose step fails is logged with its error and left for the next tick, and the sweep goes on with the others. Changed (audit PR-D3): nothing swept -> each tick finishes the left changes row by row, because a crash kept bytes that no row named, a row without bytes, or a rating of a deleted photo.

```quint
pure val photoChangeStaleMs: int = 900000

pure def unfinishedPhotoDue(reserved: bool, hidden: bool, changedAt: int, at: int): bool =
  (reserved or hidden) and at >= changedAt and at - changedAt >= photoChangeStaleMs

pure def lawStoredPhotoIsNeverSwept(changedAt: int, at: int): bool =
  not(unfinishedPhotoDue(false, false, changedAt, at))

pure def lawFreshChangeIsLeftToItsRequest(reserved: bool, hidden: bool, changedAt: int): bool =
  not(unfinishedPhotoDue(reserved, hidden, changedAt, changedAt + photoChangeStaleMs - 1))
```

### Only a live adult member keeps photos and a rating

A person keeps a stored or reserved photo on an app only while the person record is live, the lowest age is 18 or more, the app's own adult check passes (on Slop: the age stated on the membership is 18 or more and no staff age check failed), and the membership of the app is live. A rating of looks stays only while the person may keep photos on the app and at least one stored photo is there. Every retention tick, the shell erases the photos and drops the ratings that this rule no longer allows, so a crash in the middle of a leave, an erasure, an age drop or a failed staff age check is finished later. A failed staff age check and a lowered age under 18 also erase the photos at once. A ban keeps the photos for the safety team and drops the rating at the ban. The shell may find the holders and ratings to check with a query that is wider than this rule; the decision for each one is this rule. Changed (audits PR-D1, PR-D4 and PR-D5): a failed staff age check dropped the rating and kept the photos, and a crash after a lower age was saved kept a minor's photos and rating -> each tick erases what this rule no longer allows, because a minor's photos must not stay.

```quint
pure def photoHoldAllowed(personLive: bool, adult: bool, appAdultCheckPassed: bool, liveMembership: bool): bool =
  personLive and adult and appAdultCheckPassed and liveMembership

pure def ratingHoldAllowed(photosAllowed: bool, storedPhotos: int): bool =
  photosAllowed and storedPhotos > 0

pure def lawMinorKeepsNoPhoto(personLive: bool, appAdultCheckPassed: bool, liveMembership: bool): bool =
  not(photoHoldAllowed(personLive, false, appAdultCheckPassed, liveMembership))

pure def lawFailedAgeCheckKeepsNoPhoto(personLive: bool, adult: bool, liveMembership: bool): bool =
  not(photoHoldAllowed(personLive, adult, false, liveMembership))

pure def lawRatingNeedsAPhoto(photosAllowed: bool): bool =
  not(ratingHoldAllowed(photosAllowed, 0))
```
