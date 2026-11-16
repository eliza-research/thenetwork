# Private photo rating attempts

Slop runs this phase after consented photo storage changes when the rating and storage providers are configured. The [standalone photo model](models/photos_rating.md) covers storage and identity changes across concurrent operations. This attempt reads only results of checks and effects. The shell owns photo bytes, the provider call and its retries, eligibility lookups, and the private score write and removal hooks.

## Story: Keep a private rating only while its photos and authority are current

> As an adult Slop member, I want my photos to contribute to private matching while I am eligible and the photos I supplied still exist.

### Only an eligible member with available photo bytes reaches the rater

The shell checks the app, ban, adult age, app eligibility, and live membership before reading photo bytes. It uses only its bounded selection of existing bytes. Missing inputs end the attempt. A provider that returns without a score ends the attempt without a write. Provider exceptions follow the shell's retry and logging rules.

```quint
type RatingPhase = CheckingSubject | ReadingPhotos | AwaitingScore | CheckingReturnedScore |
  WritingScore | CheckingWrittenScore | RemovingScore | RatingKept | RatingEnded
type RatingAttempt = { phase: RatingPhase }
pure val initial: RatingAttempt = { phase: CheckingSubject }

pure def canScreenSubject(a: RatingAttempt): bool = a.phase == CheckingSubject
pure def screenSubject(a: RatingAttempt, eligible: bool): RatingAttempt =
  { phase: if (eligible) ReadingPhotos else RatingEnded }

pure def canSupplyPhotos(a: RatingAttempt): bool = a.phase == ReadingPhotos
pure def supplyPhotos(a: RatingAttempt, hasPhotos: bool): RatingAttempt =
  { phase: if (hasPhotos) AwaitingScore else RatingEnded }

pure def canReceiveScore(a: RatingAttempt): bool = a.phase == AwaitingScore
pure def receiveScore(a: RatingAttempt, hasScore: bool): RatingAttempt =
  { phase: if (hasScore) CheckingReturnedScore else RatingEnded }
```

### Write only after the returned score passes a fresh authority check

When a score arrives, the shell checks the same authority again and confirms that each rated photo still belongs to the member and app. A failed check ends the attempt before the private score write. The successful write path leads to a further authority check.

```quint
pure def canCheckReturnedScore(a: RatingAttempt): bool = a.phase == CheckingReturnedScore
pure def checkReturnedScore(a: RatingAttempt, eligible: bool): RatingAttempt =
  { phase: if (eligible) WritingScore else RatingEnded }

pure def canRecordScoreWrite(a: RatingAttempt): bool = a.phase == WritingScore
pure def recordScoreWrite(a: RatingAttempt): RatingAttempt = { phase: CheckingWrittenScore }

pure def stepWritingRequiresReturnedScoreCheck(before: RatingAttempt, via: str, after: RatingAttempt): bool =
  after.phase == WritingScore implies (before.phase == CheckingReturnedScore and via == "checkReturnedScore")
```

### Keep or remove the private rating after the write

After the write hook, the shell checks current authority and rated photo ownership once more. A score kept after this check completes the attempt. If an input or authority changed, the shell removes the written score before it reports the refusal.

```quint
pure def canCheckWrittenScore(a: RatingAttempt): bool = a.phase == CheckingWrittenScore
pure def checkWrittenScore(a: RatingAttempt, eligible: bool): RatingAttempt =
  { phase: if (eligible) RatingKept else RemovingScore }

pure def canRecordScoreRemoval(a: RatingAttempt): bool = a.phase == RemovingScore
pure def recordScoreRemoval(a: RatingAttempt): RatingAttempt = { phase: RatingEnded }

pure def stepOnlyTheWriteCheckCanKeepScore(before: RatingAttempt, via: str, after: RatingAttempt): bool =
  after.phase == RatingKept implies (before.phase == CheckingWrittenScore and via == "checkWrittenScore")

pure def sometimesRetainsScore(a: RatingAttempt): bool = a.phase == RatingKept
pure def sometimesNeedsRemoval(a: RatingAttempt): bool = a.phase == RemovingScore
```
