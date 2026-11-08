# Quint findings: photos_rating

Model: [quint/photos_rating.qnt](../../../quint/photos_rating.qnt). Plan: section 6.13 of
[2026-11-07-state-machines.md](../2026-11-07-state-machines.md). Machines: `photo-object`, `photo-consent`,
`clef-rating`, `slop-probe-photo`. The model follows the code at ad67275. This file is hand-written. The
traces are copied from the simulator and Apalache output, cut to the action names.

## 1. What the model contains

- One person, one app (slop), 3 upload request ids, a photo limit of 2 (the code has 6 at
  `photos.ts:91`; the race does not depend on the value), 1 crash, time in half-day ticks.
- One action for each `await` between two writes:
  - Upload (`photos.ts:457-475`): `uploadStart` (consent header and `mayTake`, `:460-462`), `uploadCount`
    (`:466`), `uploadBytes` (`storage.put`, `:471`), `uploadRow` (`meta.put`, `:472`; then `rate()`).
  - Member delete (`photos.ts:551-557`): `removeStart`, `removeBytes`, `removeRow`, `removeDrop` (`onRemoved`, then `rate()`).
  - Rating (`photos.ts:500-527`): `rateStart` (check 1), `rateRead` (rows and bytes), `rateReturn(score)`
    (Clef oracle: score, null or error), `rateCheck2`, `rateWrite` (`service.ts:1611` writeRating),
    `rateCheck3`, `rateDrop`.
  - Age under 18 (`accounts.ts:282-294`, `service.ts:776-779`): `ageCommit` (noteAge), `ageDeleteFor`, `ageDropRatings`.
  - Failed staff age check (`service.ts:1635-1650`): `verifyFail`, `verifyDrop`.
  - Ban (`service.ts:1734-1762`): `banCommit`, `banDrop` (`:1753`), `banRestrict` (`:1754`).
  - Leave (`accounts.ts:421-429`, onForget `service.ts:757-761`): `leaveConsent`, `leaveDeleteFor`,
    `leaveNetForget` (`runtime.ts:521-543`), `leaveForgetMembership` (`pg-store.ts:293-302`).
  - Delete everything (`accounts.ts:432-443`): `delFloor`, `delDeleteFor`, `delNetForget`, `delStore`.
  - Photos by text (`photoIntake.ts`, `service.ts:1067-1076`): `textPhoto(u, path)` with path `turn`
    (the signed turn passes `mediaUrls: []`, `service.ts:2069`) or `webhook` (`service.ts:1071-1074`);
    `consentYesRead` (`photoIntake.ts:117-120`), `consentYesCheck` (`:122`), `consentYesWrite` (`:124`), `consentNo` (`:130`).
  - Probe photo (`packs.ts:245-258`): `probe`.
  - Reads: `memberList`, `staffLinks`, `exportMember`, `matchRead`. Environment: `tick`, `crash`.
- A crash ends every request in memory (upload, rate, delete, every saga, the consent turn). Committed
  rows and objects stay. Nothing retries a request: the code has no sweep and no job for these paths.
- One sender's turns run one at a time (`inbox.ts`): a text leave or delete everything never overlaps a
  YES PHOTOS turn. Web uploads and staff actions (ban, failed age check) overlap anything.
- Assumption: the network forget (`runtime.ts:537-543`) deletes the member's facets (the rating) and sets
  `age = null`, so `verifiedAdult` (`service.ts:1577-1590`) is false after it.

## 2. Check results

`bun run quint:check quint/photos_rating.qnt` (seed 0x5eed, max-steps 40, max-samples 10000):

```
ok   typecheck
ok   test                       (12 run tests)
FAIL safety                     (expected: the model shows the defects below)
ok   witness_ratedAndMatched, witness_ageDropClears, witness_leaveClears, witness_textPhotoStored,
     witness_turnPhotoDropped, witness_banKeepsPhotos, witness_probeSent, witness_crash (all reachable)
```

Each invariant alone, simulator (seed 0x5eed, 40 steps, 20000 to 30000 samples) and Apalache
(`quint verify`, section 5 has the step bounds and traces):

| Invariant | Simulator | Apalache (12 steps) | Defect |
|---|---|---|---|
| `photoOnlyForAdult` | violated | violated: uploadStart, ageCommit, uploadCount, uploadBytes, uploadRow, crash | SD-052, Q-photos_rating-1 |
| `photoNotKeptAfterFailedAgeCheck` | violated | violated: uploadStart, uploadCount, verifyFail, uploadBytes, uploadRow, verifyDrop | SD-053 (and SD-052) |
| `noPhotoAfterForget` | violated | violated (8 steps) | SD-052, SD-176 |
| `countLimit` | violated | timeout | SD-372 |
| `bytesMatchRow` | violated | violated (safety): uploadStart, uploadCount, uploadBytes, crash | SD-176 |
| `noRatingForMinor` | violated | violated | Q-photos_rating-1 |
| `ratingOnlyForEligible` | violated | violated | SD-176, SD-005 |
| `scoresNeverShown` | holds | holds (8 steps) | - |
| `rowHasConsent` | holds | holds (8 steps) | - |
| `textPhotoNeedsConsent` | holds | holds (8 steps) | - |
| `probeClaimMatches` | holds | holds (8 steps) | SD-230 (not reachable) |
| `leaveAndBanStick` | violated | violated (8 steps) | SD-017 |

`quint verify --invariant safety --max-steps 10` finds the shortest counterexample in 5 s:
`init, uploadStart, uploadCount, uploadBytes, crash` (SD-176, orphan bytes).

## 3. Model errors found and fixed

1. `textPhotoNeedsConsent` was first written as `textStored implies profileConsent`. A later leave clears
   `profileConsent` (`pg-store.ts:296`), so the sticky flag failed with no defect. Now it reads "a YES
   PHOTOS was written" (`yesGiven`).
2. `leaveAndBanStick` first failed with a YES PHOTOS turn that overlapped a text leave of the same
   sender. Turns of one sender are serial (`inbox.ts`), so the consent actions now wait for the leave and
   delete-everything sagas (`senderFree`). The ban race stays (staff are not serialized with the sender).
3. Random simulation did not reach the rating witness: the life events (age, ban, leave, delete, failed
   check) ended most paths. The `step` groups them into one low-weight branch. Refused requests no longer
   spend a request id.

## 4. Defects the model reproduces

### SD-052 (reproduced): an upload in flight survives an age drop, leave and delete everything

Trace (run test `sd052UploadSurvivesAgeDropTest`):
`uploadStart(1)` passes mayTake (age 25) -> `ageCommit` (age 15) -> `ageDeleteFor` (no row yet) ->
`ageDropRatings` -> `uploadCount(1)` -> `uploadBytes(1)` -> `uploadRow(1)` -> `rateStart` refused.
End: quiescent, age 15, `rows = {1}`. `photoOnlyForAdult` is false.

Leave (run test `sd052UploadSurvivesLeaveTest`): `uploadStart, uploadCount, leaveConsent, leaveDeleteFor,
leaveNetForget, leaveForgetMembership, uploadBytes, uploadRow` -> membership removed, `rows = {1}`.
Delete everything: the simulator trace `uploadStart, delFloor, delDeleteFor, delNetForget, delStore,
uploadCount, uploadBytes, ...` ends with bytes or a row on a tombstone.

Code: `photos.ts:461` is the only adult check; `photos.ts:466-472` write with no check after it;
`photos.ts:562-566` lists rows once; `service.ts:779` and `service.ts:760` call it before the write lands.
Also, during leave the membership stays live from `service.ts:760` until `accounts.ts:428`, so an upload
that starts in that gap passes `mayTake` until the network forget commits.

### SD-053 (reproduced): a failed staff age check keeps the photos

Trace (run test `sd053FailedAgeCheckKeepsPhotosTest`): upload stored -> `verifyFail` -> `verifyDrop`.
End: `ageFail`, `rows = {1}`. Code: `service.ts:1650` drops ratings only. `photos.ts:442` then answers
`not_verified`, so `staffLinks` (`photos.ts:575`) and `view` (`photos.ts:590`) refuse; nothing deletes them.
The invariant uses the code's own definition of an adult (`photos.ts:9-10`, `photos.ts:438`). The register
verdict is disputed; the model shows the trigger is reachable in one staff action.

### SD-372 (reproduced): the photo count limit is check-then-act

Trace (run test `sd372CountRaceTest`, limit 2): upload 1 stored -> `uploadStart(2)`, `uploadStart(3)`,
`uploadCount(2)`, `uploadCount(3)` (both read 1 row) -> both write. End: 3 rows. Code: `photos.ts:466`
reads, `photos.ts:471-472` write, with no lock or constraint.

### SD-176 (reproduced): crash windows leave orphan bytes or a stale rating

- Orphan bytes (run test `sd176OrphanBytesTest`, Apalache shortest trace): `uploadStart, uploadCount,
  uploadBytes, crash` -> `objects = {1}`, `rows = {}`. Code: `photos.ts:471` then `:472`; the key is random
  and only in memory (`photos.ts:470`). No sweep exists.
- Stale rating (run test `sd176StaleRatingTest`): rated -> `removeStart, removeBytes, removeRow, crash` ->
  rating from a deleted photo. Code: `photos.ts:555` then `:556`.
- An extra window inside the same family: a crash between `rateWrite` (`photos.ts:519`) and `rateCheck3`
  (`photos.ts:520`) after a ban, age drop or failed check that landed during the write keeps the score
  (simulator trace for `ratingOnlyForEligible`: `... rateCheck2, rateWrite, banCommit, crash`).

### SD-017 (reproduced; register module identity_sagas): whole-row putMembership undoes a ban

Trace (run test `sd017ConsentWriteUndoesBanTest`): `textPhoto(webhook)` asks -> `consentYesRead` reads
membership `active` -> `consentYesCheck` passes -> `banCommit, banDrop, banRestrict` (restricted) ->
`consentYesWrite` writes `{...m}` with `active`. Code: `photoIntake.ts:120`, `:124`;
`pg-store.ts:124-129`; `service.ts:1754`.

### SD-005 (reproduced in this model's scope; register module identity_sagas)

A crash between `banCommit` (`service.ts:1747-1750`) and `banDrop` (`service.ts:1753`) keeps the rating
and the live membership of a banned person. The simulator reaches it (`ratingOnlyForEligible`). The
retry answers `already_banned` (`service.ts:1742-1743`), as SD-005 says.

### Q-photos_rating-1 (new): a crash after the age commit keeps the photos and rating of a minor

Trace (run test `q1CrashAfterAgeCommitTest`): adult upload rated -> `ageCommit` (noteAge commits age 15,
`accounts.ts:292`) -> `crash` before `onAgeLowered` (`accounts.ts:293`). End: quiescent, age 15,
`rows = {1}`, `rating = true`. `photoOnlyForAdult` and `noRatingForMinor` are false.

Code: `recordAge` (`accounts.ts:282-296`) commits `noteAge` and then runs the hook in a separate step.
`ageLowered` (`service.ts:776-785`) deletes photos and ratings and lowers each `network.members.age`. The
comment at `accounts.ts:290-291` says the hook reconciles "on retry", but nothing retries: a web join
returns an error, and a signed turn whose worker dies is not re-run (SD-001). The hook runs again only
when the person states an age again. Until then the photos and the score of a person under 18 stay, and
`rate()` and the staff route refuse them, so nobody can see or remove them. The member age in the
network stays 18+ as well (join_age scope; related to SD-011, which is the window before `noteAge`).

This is not SD-052 (no upload in flight) and not SD-176 (that row names the photo-service windows only).

## 5. Apalache

`quint verify` per invariant (shortest counterexample; this machine is shared with other agents, and
two runs lost the Apalache server connection and were run again):

| Invariant | Steps | Time | Result |
|---|---|---|---|
| `photoOnlyForAdult` | 12 | 11 s | violated: uploadStart, ageCommit, uploadCount, uploadBytes, uploadRow, crash |
| `photoNotKeptAfterFailedAgeCheck` | 12 | 14 s | violated: uploadStart, uploadCount, verifyFail, uploadBytes, uploadRow, verifyDrop |
| `noPhotoAfterForget` | 8 | 30 s | violated: uploadStart, leaveConsent, leaveDeleteFor, uploadCount, leaveNetForget, uploadBytes, uploadRow, leaveForgetMembership |
| `countLimit` | 12 | over 715 s | no result (timeout); the shortest trace needs 12 steps with limit 2; the simulator and the run test show it |
| `bytesMatchRow` | 12 | 8 s | violated: uploadStart, uploadCount, uploadBytes, crash |
| `noRatingForMinor` | 12 | 66 s | violated: upload stored, rateStart, rateRead, rateScore, rateCheck2, ageCommit, rateWrite, crash |
| `ratingOnlyForEligible` | 12 | 74 s | violated: upload stored, rateStart, rateRead, rateScore, rateCheck2, verifyFail, rateWrite, crash |
| `leaveAndBanStick` | 8 | 12 s | violated: textPhotoAsk, consentYesRead, consentYesCheck, banCommit, banDrop, banRestrict, consentYesWrite |
| `scoresNeverShown` | 8 | 109 s | holds (12 steps: over 900 s, no result) |
| `rowHasConsent` | 8 | 30 s | holds |
| `textPhotoNeedsConsent` | 8 | 18 s | holds |
| `probeClaimMatches` | 8 | 14 s | holds |
| `safety` | 10 | 5 s | violated: uploadStart, uploadCount, uploadBytes, crash |

The `noRatingForMinor` and `ratingOnlyForEligible` traces combine two windows: the change lands between
`rateCheck2` and `rateWrite`, and the crash lands before `rateCheck3` (`photos.ts:519-520`) and before the
saga's own drop step. With no crash, check 3 drops the score (run test `lateRatingDroppedTest`).

## 6. Register defects the model cannot reach, and why

- **SD-097** (photos by text cannot reach PhotoIntake through a signed turn). Reachable as written: the
  action `textPhoto(u, "turn")` drops the photo before `photosIn` (`service.ts:2069` passes
  `mediaUrls: []`; `contract.ts` `TurnRequest` has no media field). The witness `witness_turnPhotoDropped`
  and the run test `sd097TurnPhotoDroppedTest` show it. It is a missing path, not a safety invariant, so
  no invariant fails. The fix needs a wire field in `packages/core/src/svc/contract.ts`: skip, "needs
  upstream contract change".
- **SD-177** (no re-consent on a new consent version; NO PHOTOS does not withdraw). `PHOTO_CONSENT.version`
  is a build constant (`photos.ts:96`): it cannot change while a request runs, and no rule asks that stored
  photos get a new consent. `rowHasConsent` holds. NO PHOTOS without a pending row is not an answer
  (`photoIntake.ts:117-118`), as the code comment says. Not reachable as a safety failure (register: refuted).
- **SD-230** (the probe says a photo is attached when none is). `SLOP_PROBE_PHOTOS = false` and
  `photoIds: []` (`packs.ts:47`, `:257`), so `probeClaimMatches` holds. It fails only if a later change sets
  `PROBE_IDS_WIRED` and `PROBE_PHOTOS` in the model without passing the ids out (register: refuted).
- **SD-231** (`photoConsent` has two meanings). A naming issue with no state change in the current code;
  the model has no action that reads `profile.photoConsent` for the probe (register: refuted).
- **SD-232** (Clef refuses a photo that is not one adult; no state change). Clef is an oracle; a null score
  ends the rating with no state change (`rateReturn(false)`), which the model allows. No rule asks for a
  case or an age review (register: refuted).
- Two concurrent `rate()` runs (older score lands last) are not modelled: one rate slot. The rows each
  score reads still exist (checks 2 and 3), so no safety rule depends on the order.

## 7. Bounds and limits

- Photo limit 2 and 3 request ids: enough for the count race and one delete. The real limit is 6.
- One crash. A second crash adds no new class of trace in the sagas above.
- The text upload overlaps a text leave in the model (the upload slot does not record its source). Web
  uploads overlap a leave in the code, so no trace depends on this.
