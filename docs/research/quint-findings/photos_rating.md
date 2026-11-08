# Quint findings: photos_rating

Model: [quint/photos_rating.qnt](../../../quint/photos_rating.qnt). Plan: section 6.13 of
[2026-11-07-state-machines.md](../2026-11-07-state-machines.md). Machines: `photo-object`, `photo-consent`,
`clef-rating`, `slop-probe-photo`. This file is hand-written. The traces are copied from the simulator and
Apalache output, cut to the action names.

## 0. Final state

The model follows the code on branch `wave2/photos_rating` after the fixes 4d3258d (SD-052, SD-372),
fb126c6 (SD-053), 1a48ff7 (SD-176) and 4fe59a5 (Q-photos_rating-1). `bun run quint:check` passes: the run
tests, the `safety` simulation and all 11 witnesses. Bounded Apalache verification of `safety` passes (the
bounds are in section 2).

| Defect | Status | Commit | Proof |
|---|---|---|---|
| SD-052 | fixed | 4d3258d | integration: `photo-object.integration.test.ts` "SD-052: an upload in flight does not survive an age drop to 15 on another app", "SD-052: an upload in flight does not survive leaving the app"; run tests `sd052UploadRefusedAfterAgeDropTest`, `sd052UploadRefusedAfterLeaveTest`, `sd052ShowBeforeLeaveHideTest` |
| SD-372 | fixed | 4d3258d | integration: "SD-372: parallel uploads never pass the photo limit"; run test `sd372CountRaceRefusedTest` |
| SD-053 | fixed | fb126c6 | integration: "SD-053: a failed staff age check deletes the photos and the rating"; run test `sd053FailedAgeCheckDeletesPhotosTest` |
| SD-176 | fixed (the register windows: PH put/meta.put and the delete steps) | 1a48ff7 | integration: the two "SD-176: ..." tests; run tests `sd176OrphanBytesSweptTest`, `sd176StaleRatingSweptTest` |
| Q-photos_rating-1 | fixed | 4fe59a5 | integration: "Q-photos_rating-1: a crash after the age commit ..."; run tests `q1CrashAfterAgeCommitReconciledTest`, `q1CrashBeforeMemberAgesReconciledTest` |
| SD-097 | skipped: needs upstream contract change | - | `TurnRequest` in `packages/core/src/svc/contract.ts` has no media field; `service.ts:2090` passes `mediaUrls: []`. Run test `sd097TurnPhotoDroppedTest`, witness `witness_turnPhotoDropped`. No invariant fails (a missing path, not a safety rule). |
| SD-017 | not fixed on this branch (identity_sagas module) | - | `banSticks` is out of `safety`; run test `sd017ConsentWriteUndoesBanTest` |
| SD-005 | not fixed on this branch (identity_sagas module) | - | the ban part of `ratingOnlyForEligible`; run test `sd005BanCrashKeepsRatingTest` |
| Q-photos_rating-2 | new, not fixed | - | run test `q2RateWriteCrashTest` (section 4) |
| Q-photos_rating-3 | new, not fixed (made by the 4d3258d reorder) | - | run test `q3LeaveCrashAfterForgetTest` (section 4) |
| SD-177, SD-230, SD-231, SD-232 | not reproduced (refuted in the register) | - | section 5 |

## 1. What the model contains

- One person, one app (slop), 3 upload request ids, a photo limit of 2 (the code has 6 at `photos.ts:93`;
  the race does not depend on the value), 1 crash, time in half-day ticks.
- A row with `deleted_at` set is "hidden": no read sees it (`photos.ts:372-376`). The model keeps `rows`
  (live), `hidden` and `objects` (the bytes).
- One action for each `await` between two writes:
  - Upload (`photos.ts:526-549`): `uploadStart` (consent header and `mayTake`), `uploadCount` (the early
    count), `uploadPut` (the hidden row, `:542`), `uploadBytes` (`storage.put`, `:543`), `uploadShow`
    (`meta.show`, `:545`: one transaction that locks the person row, runs `mayTake` again, counts the live
    rows and shows the row; `PgPhotoStore.show` `:435-445`), `uploadUndo` (a refused upload removes its
    bytes and its row, `:546`).
  - Member delete (`photos.ts:625-631`, `end` `:642-646`): `removeStart` (hide), `removeDrop` (onRemoved),
    `removeBytes`, `removeRow` (then `rate()`).
  - Rating (`photos.ts:574-600`): `rateStart`, `rateRead`, `rateReturn(score)` (Clef oracle), `rateCheck2`,
    `rateWrite` (`onRating`, `service.ts:1632`), `rateCheck3`, `rateDrop`.
  - `deleteFor` (`photos.ts:634-639`) is two steps in each saga: hide every live row under the person lock
    (`hideAll`, `:457-466`), then end them (rating, bytes, row).
  - Age under 18 (`accounts.ts:282-296`, `service.ts:780-789`): `ageCommit`, `ageHide`, `ageEnd`,
    `ageDropRatings`, `ageMembers` (the member ages, which `reconcileAges` reads).
  - Failed staff age check (`service.ts:1656-1674`): `verifyFail`, `verifyHide`, `verifyEnd`, `verifyDrop`.
    A staff retry writes the facet again (`on conflict do update`), so `verifyFail` can run again.
  - Ban (`service.ts:1755-1783`): `banCommit`, `banDrop`, `banRestrict` (unchanged).
  - Leave (`accounts.ts:421-429`, onForget `service.ts:761-765`, the forget now first): `leaveConsent`,
    `leaveNetForget`, `leaveHide`, `leaveEnd`, `leaveForgetMembership`.
  - Delete everything (`accounts.ts:432-443`): `delFloor`, `delNetForget`, `delHide`, `delEnd`, `delStore`.
  - The service purge (`service.ts:567-581`): `purgeSweep` (`PhotoService.sweep`, `photos.ts:652-657`) and
    `purgeAges` (`reconcileAges`, `service.ts:796-806`, which starts the age hook again).
  - Photos by text, the YES PHOTOS answer, the probe and the reads: unchanged from the first model.
- A crash ends every request in memory. Committed rows, hidden rows and objects stay. The purge is the
  only recovery.
- Assumption: a request in flight ends within `PHOTO_PENDING_MS` (1 hour), so the sweep takes only hidden
  rows that no request owns (`abandoned`).
- Assumption (unchanged): the network forget deletes the member's facets (the rating) and sets `age = null`.

### How the rules are checked

Each state rule is checked when no request is in flight, on the state after one pass of the purge:
`quiescent(st) implies rule(purged(st))`. `purged` is the sweep of every hidden row, then the full age hook
when `reconcileDue` is true (the same condition as the two queries in `reconcileAges`). So a crash residue
that the purge does not cover makes a rule fail. A check of the plain `quiescent` state would fail on every
crash before the purge ran; a check of "nothing left for the purge" would pass when the purge is broken
(section 3, item 1).

`countLimit` is checked in every state. `scoresNeverShown`, `rowHasConsent`, `textPhotoNeedsConsent`,
`probeClaimMatches` and `leaveSticks` are checked in every state.

### Rules kept out of `safety`

No rule was weakened. Three full rules have a crash residue that this branch does not fix. Each stays as
its own named value, and `safety` holds the same rule for traces without that residue. Two ghost flags
mark the residue at the crash:

- `rateWriteCrash` (Q-photos_rating-2): the crash hits `rate()` after `onRating` and before check 3 ends,
  and check 3 would refuse.
- `sagaCrash` (SD-005 class X8 and Q-photos_rating-3): the crash hits a failed age check after its facet
  commit and before `deleteFor` hides the rows, a ban after its commit, or a leave or delete everything
  after the forget and before `deleteFor` hides the rows.

| Full rule (not in `safety`) | In `safety` | Why |
|---|---|---|
| `photoNotKeptAfterFailedAgeCheck` | `..._noSagaCrash` | X8: a crash between the facet and `deleteFor` (`service.ts:1667-1671`). Staff can record the check again. |
| `noPhotoForForgottenMember` (new rule) | `..._noSagaCrash` | Q-photos_rating-3 |
| `noRatingForMinor` | `..._noRateWriteCrash` | Q-photos_rating-2 |
| `ratingOnlyForEligible` | `..._noResidueCrash` | SD-005, X8, Q-photos_rating-2 |
| `banSticks` (was half of `leaveAndBanStick`) | `leaveSticks` only | SD-017 (identity_sagas) |

## 2. Check results

`bun run quint:check quint/photos_rating.qnt` (seed 0x5eed, max-steps 40, max-samples 10000):

```
ok   typecheck
ok   test                       (17 run tests)
ok   safety
ok   witness_ratedAndMatched, witness_ageDropClears, witness_leaveClears, witness_textPhotoStored,
     witness_turnPhotoDropped, witness_banKeepsPhotos, witness_probeSent, witness_crash,
     witness_showRefused, witness_swept, witness_reconciled (all reachable)
1 models, 0 failures
```

Apalache (`quint verify --invariant safety`):

| Steps | Time | Result |
|---|---|---|
| 4 | 28 s | no violation |
| 6 | 88 s (131 s for the whole `bun run quint:check --verify`) | no violation |
| 8 | 729 s | no violation (too slow for the default run) |

The model sets `verify-steps=6` (the first line of the file), so `bun run quint:check --verify` runs 6
steps. Six steps reach the shortest crash residue of an upload (`uploadStart, uploadCount, uploadPut,
uploadBytes, crash`). The first model had `verify-steps=10`, but there `safety` failed in 4 steps, so
Apalache stopped early. A proof that `safety` holds is slower: `bun run quint:check --verify` with 10 steps lost
the Apalache server connection after about 2 minutes, and a direct run with 6 steps ran out of the 4 GiB
heap while `owned` and `purged` used a `fold` over the sagas. With the fold removed, 6 steps take 88 s.

Each full rule alone, simulator (seed 0x5eed, 40 steps, 20000 samples):

| Rule | Result | Trace (cut) |
|---|---|---|
| `photoNotKeptAfterFailedAgeCheck` | violated | `... uploadShow, verifyFail, crash` |
| `noPhotoForForgottenMember` | violated | `... uploadShow, delFloor, delNetForget, crash` |
| `noRatingForMinor` | not found by the simulator (needs 15 exact steps) | run test `q2RateWriteCrashTest` |
| `ratingOnlyForEligible` | not found by the simulator | run tests `q2RateWriteCrashTest`, `sd005BanCrashKeepsRatingTest` |
| `banSticks` | violated | SD-017 trace |

## 3. The model fails without each fix

Each fix was taken out of a copy of the model (in the scratchpad, not committed), and the `safety`
simulation (seed 0x5eed, 40 steps, 10000 samples) was run again:

| Change to the copy | `safety` |
|---|---|
| `sweepOnce` does nothing (no sweep: SD-176) | violated |
| `reconcileDue` is false (no reconcile: Q-photos_rating-1) | violated |
| `uploadShow` without `mayTake` (SD-052) | violated |
| `verifyHide` hides nothing (SD-053) | violated |
| `uploadShow` without the count (SD-372) | not found by the simulator (needs three uploads in flight); `sd372CountRaceRefusedTest` fails |

1. Model error found and fixed: the first version of this update checked the rules on a "settled" state
   (no request in flight and nothing left for the purge). With the sweep taken out, no state was settled
   after a crash, and every rule passed. The rules now check the state after one purge pass.
2. Model errors from the first model (kept): the YES PHOTOS consent flag (`yesGiven`), the serial turns
   of one sender (`senderFree`) and the grouped `step`.

## 4. Defects

### SD-052 (fixed, 4d3258d): an upload in flight survived an age drop, leave and delete everything

Before: the upload checked `mayTake` once and wrote the row with no check. Now `uploadShow` checks again
under the person row lock, and `deleteFor` hides the rows under the same lock, so either the row is shown
before the hide (and the hide takes it, `sd052ShowBeforeLeaveHideTest`) or the check refuses it
(`sd052UploadRefusedAfterAgeDropTest`, `sd052UploadRefusedAfterLeaveTest`). The leave hook forgets the
member first, so `mayTake` refuses after the forget (no member age).

### SD-372 (fixed, 4d3258d): the photo count was check-then-act

`uploadShow` counts the live rows in the locked transaction. Run test: upload 1 stored; uploads 2 and 3
both pass the early count; show 2 passes, show 3 is refused and undone. End: `rows = {1, 2}`.

### SD-053 (fixed, fb126c6): a failed staff age check kept the photos

`verifyHide` and `verifyEnd` delete the photos on that app, then `verifyDrop` drops any rating that is left.

### SD-176 (fixed, 1a48ff7): crash windows left orphan bytes or a stale rating

- Orphan bytes: the row is inserted hidden before the bytes. `uploadStart, uploadCount, uploadPut,
  uploadBytes, crash, purgeSweep` ends with no bytes, no row.
- Stale rating: a delete hides the row first and drops the rating before the bytes. `removeStart, crash,
  purgeSweep` ends with no rating, no bytes, no row.
- A crash in the undo of a refused upload, or inside `end`, leaves a hidden row; the sweep ends it.

### Q-photos_rating-1 (fixed, 4fe59a5): a crash after the age commit kept the photos and rating of a minor

`reconcileAges` in the purge finds a person under 18 with a live photo, or with a live member whose age is
above the lowest age, and runs the age hook again. Run tests: a crash right after `ageCommit` (photos and
rating go, the member age becomes 15), and a crash after the photos went but before the member ages (the
member age makes the purge run the hook again).

### Q-photos_rating-2 (new, not fixed): a crash in the rating write window keeps a score the checks refuse

Trace (`q2RateWriteCrashTest`): adult upload stored -> `rateStart, rateRead, rateScore, rateCheck2` -> the
age drop runs to its end (`ageCommit, ageHide, ageEnd, ageDropRatings, ageMembers`) -> `rateWrite`
(`onRating`, `photos.ts:593`) -> `crash` before check 3 (`photos.ts:594`). End: age 15, no photo, the
member age is 15, and the appearance rating stays. `reconcileAges` reads only photos and member ages, so
it does not see the rating. The same window keeps a rating after a failed age check, a leave or a member
delete that ends between check 2 and `onRating`. The first model named this window as part of SD-176; the
SD-176 register row names only `PH:471-472`, `PH:554-556` and `PH:564`, and 1a48ff7 does not change
`rate()`. A fix needs its own failing test (for example a purge step that drops a rating when
`ratingRefusal` refuses it). It needs two `await` windows and a crash, so the risk is low.

### Q-photos_rating-3 (new, not fixed): the onForget reorder opens a crash window that keeps the photos

4d3258d forgets the Network member before `deleteFor` (`service.ts:764-765`), so that an upload in flight
is refused. A crash between the two steps now keeps the photos: the Network member is gone, the platform
membership stays live (`accounts.ts:428` did not run), and `adult()` refuses, so nobody can see or delete
the photos until the person sends "leave" or "delete everything" again. Trace
(`q3LeaveCrashAfterForgetTest`): photo stored -> `leaveConsent, leaveNetForget, crash`. The old order had
the opposite window (photos gone, member live), which kept no data. The same holds for delete everything.
`reconcileAges` does not look at it. A fix needs its own failing test (for example a purge step that runs
`deleteFor` for a live photo whose app member is removed).

### SD-017 and SD-005 (identity_sagas module, not fixed on this branch)

- SD-017: the YES PHOTOS whole-row `putMembership` (`photoIntake.ts:124`) restores `active` after a ban
  (`sd017ConsentWriteUndoesBanTest`). `banSticks` is out of `safety`.
- SD-005: a crash between the ban commit and `dropRatings` (`service.ts:1774`) keeps the rating of a
  banned person; the retry answers `already_banned` (`sd005BanCrashKeepsRatingTest`).

### SD-097 (skipped: needs upstream contract change)

The action `textPhoto(u, "turn")` drops the photo before `photosIn` (`service.ts:2090` passes
`mediaUrls: []`; `TurnRequest` in `packages/core/src/svc/contract.ts` has no media field). The fix needs a
wire field that lands upstream first (elizaOS/eliza `plugins/plugin-network`). `witness_turnPhotoDropped`
and `sd097TurnPhotoDroppedTest` show it.

## 5. Register defects the model cannot reach, and why

- **SD-177** (no re-consent on a new consent version; NO PHOTOS does not withdraw). `PHOTO_CONSENT.version`
  is a build constant (`photos.ts:100`); `rowHasConsent` holds. NO PHOTOS without a pending row is not an
  answer (`photoIntake.ts:117-118`). Register: refuted.
- **SD-230** (the probe says a photo is attached when none is). `SLOP_PROBE_PHOTOS = false` and
  `photoIds: []` (`packs.ts:47`, `:257`), so `probeClaimMatches` holds. Register: refuted.
- **SD-231** (`photoConsent` has two meanings). A naming issue with no state change. Register: refuted.
- **SD-232** (Clef refuses a photo that is not one adult). Clef is an oracle; a null score ends the rating
  with no state change. Register: refuted.
- Two concurrent `rate()` runs are not modelled (one rate slot). Checks 2 and 3 read the rows each score
  used, so no rule depends on the order.

## 6. Bounds and limits

- Photo limit 2 and 3 request ids: enough for the count race and one delete. The real limit is 6.
- One crash. The purge runs any number of times.
- The sweep takes only rows that no request owns (the 1-hour assumption in section 1). A request that
  hangs for more than an hour between `uploadBytes` and `uploadShow` and then crashes is not modelled.
- `reconcileAges` runs in one slot with the age hook; the hook is idempotent, so a second run in parallel
  adds no new state.
