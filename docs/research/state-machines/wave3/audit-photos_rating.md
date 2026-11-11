# Audit: quint/photos_rating.qnt coverage (wave 3)

Branch claude/quint-state-machines at f02196f. Model: quint/photos_rating.qnt (last change 5b22040). Findings:
docs/research/quint-findings/photos_rating.md. Code read in full: packages/platform/src/photos.ts,
packages/network/service/photoIntake.ts, the photo parts of packages/network/service/service.ts (hooks 811-861,
purge 595-606, verifiedAdult/dropRatings/writeRating/personBanned 1797-1850, verify 1860-1880, ban 1967-2010,
staffPhotos 2034-2054, inbound photo path 1202-1211), packages/platform/src/accounts.ts (recordAge, join, leave,
deleteAll, declineUnderAge), packages/network/service/packs.ts:245-258, engine plan.ts:60-87, profile.ts:194-198,
serve.ts:116-148, api.ts:305-370. Inputs: claude/formal-main docs/results/2026-11-09-quint-drift.md (photos_rating:
drift_open) and the reverted identity_sagas patch.

Probe run (scratch copy, not committed): leaveHide/delHide changed to skip the hide when `st.banned` (as
service.ts:819 does). `quint run --invariant noPhotoAfterForget --seed 0x5eed --max-steps 40` is violated in 195 ms
(trace: upload, show, banCommit, banDrop, banRestrict, leaveConsent, leaveNetForget, leaveHideBanned, leaveEnd,
leaveForgetMembership).

## 1. The model lags code that landed before it (model_error)

All three commits are ancestors of 5b22040 (the model commit) and of HEAD, but the model follows the older code.

1. **Ban exception in onForget (8e96df9).** service.ts:816-819 runs `photos.deleteFor` only when
   `personBanned` is false. The model's `leaveHide` (qnt:400) and `delHide` (qnt:423) always hide. With the code's
   rule, `noPhotoAfterForget`, `noPhotoForForgottenMember` and the "not deleted" half of `photoOnlyForAdult` fail
   (probe above). Same as the drift review's open item. Fix: add the `banned` guard to both actions and restate the
   three rules as "unless banned when the forget ran" (keep a `bannedAtForget` ghost); add `banKeepsPhotos`
   (the identity_sagas rule) to this model too, so that sections 4.2-4.4 below become reachable here.
2. **SD-017 is fixed (709be0b).** photoIntake.ts:124 now calls `updateMembership(person, slop, [who.m.state],
   {profile})` (compare-and-set, profile only). The model's `consentYesWrite` (qnt:468) still writes
   `membership: st.caSnap`, and `banSticks` (qnt:658) is kept out of `safety` for SD-017. The drift branch fixed
   this in its copy; on this branch it is still open. Fix: write only when `membership == caSnap`, never write the
   state; move `banSticks` into `safety`; rename `sd017ConsentWriteUndoesBanTest`.
3. **SD-005 has a staff retry (e361184).** service.ts:1975-1976 lets a repeated ban run when `banUnfinished`
   (a live membership or an unrestricted member). The model's `banCommit` (qnt:373) needs `not(st.banned)`, so a
   crash after the ban row and before `dropRatings` can never be finished in the model, and `ratingLeft` excludes
   that rating for good. Fix: add `banRetry` (enabled when banned and membership is LIVE) that re-runs
   banDrop/banRestrict; then scope `ratingLeft` for the ban to "until a staff retry", or drop the ban half of
   `ratingLeft` and state the rule as "eventually after a retry".

## 2. Other model errors

4. **Rules are checked only after one purge pass (`purged`, qnt:194).** That hides the window between a crash and
   the first purge. In the code the loop runs `rt.tick()` (matching) before `svc.purge()` (serve.ts:133-143;
   service.ts:526-530). So a Q-photos_rating-1 residue (lowest age 15, member age still 25 after a crash between
   `noteAge` and the member ages) is matched in one tick before `reconcileAges` runs (see 4.5). The model cannot
   see this because it checks only `purged(st)` and `matchRead` has no age guard.
5. **`matchRead` (qnt:506) is not the code's gate and no rule reads it.** The engine uses a rating only when
   `canRatePhotos({age: member age, ageVerified: fail?false:undefined})` (engine profile.ts:197); it reads the
   member age (network.members.age), not the platform membership or the ban. The model gates on LIVE membership,
   netMember and not banned, and `usedInMatching` is only a witness. Add the rule "a rating is used in matching only
   when netAge >= 18 and not ageFail", with the code's guard. This also bounds Q-photos_rating-2 (the residue
   rating of a minor is not used, because the member age is 15 there).
6. **The probe is passed `held` that the code does not pass, and the wrong age.** packs.ts:257 calls
   `probePhotoRefs({ age, photoConsent: SLOP_PROBE_PHOTOS, photoIds: [] }, ...)` with no `held`; `age` is the
   member age from the snapshot. The model (qnt:480-486) passes `held = banned or not LIVE` and the lowest age.
   Vacuous today (`photoIds: []`), but when ids are wired the model would accept a hook that leaves `held` out
   and reads a stale member age. Use `held = false` and `netAge`. Also `probe` needs `st.rating` (qnt:481), which
   the code does not; that only shapes the random walk.
7. **`ageCommit` (qnt:326) runs only on a drop from >= 18.** accounts.ts:290-295 runs `onAgeLowered` on every
   recordAge ("Reconcile on retry, even if the statement is unchanged"). A person who states an age again repairs a
   Q-1 or Q-2 residue (ageLowered with age < 18 calls `dropRatings`). Adding `ageRestate` only adds recovery and
   cannot break a rule, but it is a recovery path that the findings say does not exist.
8. **`staffLinks` (qnt:491) has no "open report" guard** (service.ts:2038-2046). It only feeds `shown`, so no rule
   changes, but the model shows staff links in states where the code refuses them.

## 3. Model gaps (left out of the model)

| # | Code | What is left out | Can it break a rule? |
|---|---|---|---|
| G1 | service.ts:819 | the `personBanned` read and the `deleteFor` are two awaits, not one step | yes: a ban that commits between them deletes the photos the ban keeps (4.4); needs `banKeepsPhotos` |
| G2 | photos.ts:625-631, 722-727 | member delete by a banned person (route has no ban check) | yes with `banKeepsPhotos` (4.3) |
| G3 | service.ts:1873-1876, 1809-1815 | staff `verify age pass` after a fail (the facet id is one row per member, so pass overwrites fail) | no rule fails (photos already gone); it ends `ageFail` |
| G4 | runtime.ts:581, accounts.ts:393-396 | leave + rejoin: new member id, the forget deletes every facet incl. `verify:age:fail` | yes: `photoNotKeptAfterFailedAgeCheck` is per member, a rule per person fails (4.1) |
| G5 | photos.ts:574-600 | two `rate()` runs at once (one slot in the model) | no safety rule; an older score can overwrite a newer one (lost update of the matching input) |
| G6 | photos.ts:652-657 | an error (not a crash) in one request: `storage.put`/`delete` throws, `deleteFor` stops mid-loop, a `forgetListener` throws | Q-3 residue without a crash: an error in `personBanned` (service.ts:819) after the forget leaves the same state, so the crash budget understates Q-3; the sweep covers hidden rows |
| G7 | photos.ts:653, 466-468 | a sweep row whose `end` always throws stops the sweep of every later row (ordered by deleted_at) on every purge | `bytesMatchRow` after the purge fails for the rows behind it; low (R2 delete of a missing key does not throw) |
| G8 | service.ts:1208-1210 | the per-message dedupe `hit("photo_msg:"+rowId)` before `photosIn`; a crash and inbox retry | no safety rule; the photo is lost and the turn answers nothing (4.6) |
| G9 | photoIntake.ts:117-124 | crash after `deletePending` and before the write | no safety rule; YES PHOTOS is lost and the retry passes the text to the Network |
| G10 | photos.ts:97, 653 | the 1-hour sweep timer vs a request that hangs past it | no: `show` answers `not_found` and the upload undoes its bytes (photos.ts:546); the model's assumption is safe |
| G11 | photos.ts:581 | photos > RATER_MAX_BYTES (4 MiB) are stored but never rated; only the newest 4 | no |
| G12 | service.ts:554-557 | the weekly bias monitor reads `appearance:%` tags of active, paused and restricted members | a Q-2 residue rating of a minor is counted in the report (not shown to anyone) |
| G13 | accounts.ts:208, 446-452 | the other forget callers: a recycled number and the under-13 decline | same shape as leave; no new rule |

## 4. Suspected new defects

### 4.1 A failed staff age check does not survive leave and rejoin (P1)
Code: service.ts:1866-1876 writes `verify:age:fail` as a facet on the member id; service.ts:1803-1815
(`verifiedAdult`) reads it on the current member id only; a leave runs `forget` (service.ts:905-914), whose unit
deletes every facet of the member (runtime.ts:581); a rejoin makes a new member id (accounts.ts:393-396).
`forget` keeps a hold only when `safetyHeld` (trust hold, held report or minor report; network.ts:4701-4703), and
`verify` writes no hold. The age floor survives delete everything (accounts.ts:458), but the failed check does not.
Trigger: adult member X (stated 22) on slop -> staff `POST /members/X/verify {age, fail}` (photos and rating
deleted) -> X texts "leave slop.date" -> X texts "slop", joins again with age 22 (lowest age stays 22) -> YES PHOTOS
-> sends a photo: `mayTake` passes (new member, no fail facet), the photo is stored and rated, and the member is
matched. Fix in scope: keep the failed check on the person (a platform row, or copy the facet in `createMember`
like the hold carryover), and read it in `verifiedAdult`. Test: integration case in photo-object.integration.test.ts.

### 4.2 The photos a ban keeps "for the safety team" cannot be read by staff (P1)
Code: ban sets every live membership to `restricted` (service.ts:1987). `staffPhotos` -> `staffLinks` -> `adult()`
-> `eligible` = `verifiedAdult`, which needs state active/paused/onboarding (service.ts:1806). `view` checks
`adult()` again (photos.ts:680). So after a ban every staff photo read answers `adults_only`. After 8e96df9 a banned
person who leaves or deletes everything keeps the photos with a removed membership (and, for delete everything,
`lowest_age` null), so no reader, no sweep and no `reconcileAges` query ever touches them again: bytes of a deleted
person kept with no way to view or delete them. Trigger: report on X -> staff view works -> ban X -> view again:
`adults_only`; X sends "delete everything" -> rows and R2 objects stay forever. Fix: a staff read path for banned
persons (ban as its own ground in `staffLinks`, still adults-only by lowest age), and a retention rule for kept
photos (founder decision). Model: add `banKeepsPhotos` and a "kept photo is readable by staff" witness.

### 4.3 A banned person with a live web session deletes the kept photos one by one (P1/P2)
Code: `PhotoService.remove` (photos.ts:625-631) and `POST /api/photos/delete` (photos.ts:722-727) have no ban
check; `auth()` (api.ts:313-321) does not read bans, and the ban path revokes no session. 8e96df9 closed leave and
delete everything only. Trigger: X has a session cookie from signup -> staff ban X -> X posts
`{id}` to /api/photos/delete for each id from GET /api/photos -> rows and bytes gone. Fix: refuse `remove` when
`banned` (as `mayTake` does), or revoke sessions on ban. Integration test next to the 8e96df9 tests.

### 4.4 The ban check in onForget is a check-then-act (P2)
Code: service.ts:819 reads `personBanned` and then runs `deleteFor` without a lock shared with the ban
(service.ts:1983 inserts bans; `hideAll` locks only platform.people). Trigger: X texts "leave slop.date"; the
forget unit commits; `personBanned` returns false; staff ban X (ban rows commit); `deleteFor` deletes the photos.
The safety team loses the evidence the ban means to keep. Fix: read the ban inside `hideAll`'s transaction under
the person lock (pass a `keep` predicate with the tx), and take the same lock in `ban` before its rows.

### 4.5 After a restart, matching runs before the age reconcile (P2)
Code: serve.ts:133-143 runs `rt.tick()` for every network, then `svc.purge()` (which runs `reconcileAges`).
Trigger: the process stops after `noteAge(15)` commits and before `ageLowered` lowers the member age
(accounts.ts:292-295, Q-photos_rating-1 window). On restart the first tick builds the snapshot with member age 25,
so the person can be proposed to adults (and with the rating, which `ageLowered` had not dropped yet). Human review
still stands before contact, so no message goes out unreviewed. Fix: run `reconcileAges` before the first tick
(at start, or at the head of the loop).

### 4.6 A crash between the photo dedupe hit and the upload drops the photo with no answer (P2)
Code: service.ts:1208 counts `photo_msg:<rowId>` before `photosIn`; the inbox re-runs the turn after a crash
(service.ts:587-590); the second run sees count 2 -> `duplicate` -> "handled" for an empty text, no reply.
Liveness only (the member thinks the photo was saved or is told nothing). Fix: count after `photosIn` returns, or
key the hit on the stored outcome.

## 5. Open carve-outs (kept out of `safety` or not fixed)

| Item | Status now | In scope? How |
|---|---|---|
| Q-photos_rating-2 (`noRatingForMinor_noRateWriteCrash`, part of `ratingOnlyForEligible_noResidueCrash`) | open | Yes (security, adults-only). Simplest fix: in `rate()`, run check 3 and `onRating` in one transaction under the person row lock (photos.ts:588-599 with `tx`, `writeRating` with the same tx): the platform and network schemas share one database (verifiedAdult already reads network.members inside a platform tx). Alternative: a purge step that drops `appearance` facets of persons whose `ratingRefusal` now refuses. Impact today: retention only, because matching ignores it (profile.ts:197) - but the bias monitor counts it (G12). |
| Q-photos_rating-3 (`noPhotoForForgottenMember_noSagaCrash`) | open; more likely than the findings say, since any error in `personBanned` after the forget also leaves it (G6) | Yes. A purge step: live photo rows whose (person, app) has no live network member and whose person is not banned -> `deleteFor(person, app)`. Must be written together with the ban exception (1.1). |
| `photoNotKeptAfterFailedAgeCheck_noSagaCrash` (`verifyLeft`, X8) | open | Yes. A purge step: live photo rows of a member whose newest verify:age facet is fail -> deleteFor + dropRatings (one query, like `reconcileAges`). Then the carve-out goes. |
| `ratingLeft` (SD-005 ban half, X8 verify half) | ban half: fixed in code by e361184 for a staff retry, not modelled (1.3); verify half open | Model the retry; the verify half closes with the purge step above. |
| `banSticks` (SD-017) | fixed in code by 709be0b; model stale (1.2) | Yes, model only. |
| SD-097 (photos by signed turn dropped) | skipped | No: needs a `TurnRequest` media field upstream first (AGENTS.md: wire changes land upstream first). |
| SD-177, SD-230, SD-231, SD-232 | refuted in the register | No action. SD-230 note: the model's guard for it is wrong once ids are wired (2.6). |
| Two concurrent `rate()` (findings 5) | not modelled | Model only; no safety rule, but a lost update (G5). |
| Ban exception rules (drift open item) | open | Needs the founder's rule for how long a banned person's photos stay and who may read them (4.2). |
