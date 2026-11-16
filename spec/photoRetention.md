# Private photo storage and removal

The [standalone photo model](models/photos_rating.md) covers concurrent account changes and photo requests. This module directs one upload or removal. The shell owns member and app lookups, image parsing and metadata stripping, private object storage, and database writes. A member replaces a photo through the existing add and remove operations.

## Story: Add and remove photos for private matching

> As an adult Slop member, I want to store a permitted photo privately, remove it when I choose, and have the current selection drive my private rating.

### Consent, adult eligibility, and a valid image precede storage

With storage configured, Slop first checks that the app accepts photos and the member gave the current consent. It then checks the member's ban and adult status with the app's own eligibility rule. The service checks the size and type, checks that there is an available slot, and removes metadata before allowing a storage write. Refuse an invalid image without writing it.

```quint
type PhotoPhase = ChoosingChange | CheckingUploader | ScreeningFile | CheckingSlots | CleaningImage |
  WritingBytes | WritingRow | RemovingBytes | RemovingRow | ClearingRating | Rerating |
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
  { ...c, phase: if (cleaned) WritingBytes else ChangeRefused }
```

### Store private bytes before the photo row

The shell writes stripped bytes under a random private key, then records the photo row. Once the row is stored, the shell requests a private rating of the current photos. A failed rating attempt does not change the result of the upload.

```quint
pure def canRecordUploadBytes(c: PhotoChange): bool = c.phase == WritingBytes
pure def recordUploadBytes(c: PhotoChange): PhotoChange = { ...c, phase: WritingRow }

pure def canRecordUploadRow(c: PhotoChange): bool = c.phase == WritingRow
pure def recordUploadRow(c: PhotoChange): PhotoChange = { ...c, phase: Rerating }

pure def canFinishRerate(c: PhotoChange): bool = c.phase == Rerating
pure def finishRerate(c: PhotoChange): PhotoChange = { ...c, phase: ChangeFinished }

pure def stepRowWriteRequiresBytes(before: PhotoChange, via: str, after: PhotoChange): bool =
  after.phase == WritingRow implies (before.phase == WritingBytes and via == "recordUploadBytes")
```

### Erase bytes and metadata before dropping the old rating

An individual removal requires a photo belonging to the member and requested app. A privacy erasure processes the listed photos for the member and, when supplied, the requested app. For each selected photo, the shell deletes its stored bytes, deletes the row, and then runs the rating-removal hook. An individual removal requests a new rating from the remaining photos. Bulk erasure completes each removal without requesting another rating.

```quint
pure def canBeginRemoval(c: PhotoChange): bool = c.phase == ChoosingChange
pure def beginRemoval(c: PhotoChange, owned: bool, rerate: bool): PhotoChange =
  { phase: if (owned) RemovingBytes else ChangeRefused, rerateAfterRemoval: rerate }

pure def canRecordRemovedBytes(c: PhotoChange): bool = c.phase == RemovingBytes
pure def recordRemovedBytes(c: PhotoChange): PhotoChange = { ...c, phase: RemovingRow }

pure def canRecordRemovedRow(c: PhotoChange): bool = c.phase == RemovingRow
pure def recordRemovedRow(c: PhotoChange): PhotoChange = { ...c, phase: ClearingRating }

pure def canRecordRatingClear(c: PhotoChange): bool = c.phase == ClearingRating
pure def recordRatingClear(c: PhotoChange): PhotoChange =
  { ...c, phase: if (c.rerateAfterRemoval) Rerating else ChangeFinished }

pure def stepRatingClearRequiresRowRemoval(before: PhotoChange, via: str, after: PhotoChange): bool =
  after.phase == ClearingRating implies (before.phase == RemovingRow and via == "recordRemovedRow")

pure def sometimesCompletesChange(c: PhotoChange): bool = c.phase == ChangeFinished
pure def sometimesWritesPhoto(c: PhotoChange): bool = c.phase == WritingRow
pure def sometimesRemovesPhoto(c: PhotoChange): bool = c.phase == RemovingRow
```
