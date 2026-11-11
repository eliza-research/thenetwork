# Quint findings: `quint/identity_sagas.qnt`

Module plan: [docs/research/2026-11-07-state-machines.md](../2026-11-07-state-machines.md) section 6.4 (P0).
Model: [quint/identity_sagas.qnt](../../../quint/identity_sagas.qnt).
This file is hand-written. The traces are cut from the simulator and Apalache output and from the `run`
tests of the model.

## 0. Final state (branch `wave2/identity_sagas`)

The model follows the code on branch `wave2/identity_sagas`: `ad67275` plus the fix commits below. The
first version of the model (commit `7dcc0b4`) followed `ad67275` and showed the defects. Sections 3 to 5
keep that analysis. Each one now also says how the fix changed the model.

`safety` passes. Every witness is reachable. The rules that the code still breaks, for defects that this
branch does not fix, are named values out of `safety` (section 2.2).

| Defect | Result | Fix commit | Integration test (`packages/network/test/identity-sagas.integration.test.ts`) | Model change |
|---|---|---|---|---|
| SD-005 | fixed | `e361184` | "SD-005: a ban that stops after its ban rows is finished by the retry, not refused as already_banned" | `banGuard` / `banUnfinishedIn`: the retry starts at pc 2 without new rows; the member status is the last write for each member (`marked`) |
| SD-016 | fixed | `2f0dbed` | "SD-016: a new_owner decision that stops after the delete still leaves the number clean; the next holder is a new person" | `storeDeleteAllNewOwner`: one action (delete, detach, unsuppress, floor) |
| SD-051 | fixed | `0dbb09e` | "SD-051: a new_owner decision keeps the STOP that the number's new holder sent" | `storeDeleteAllNewOwner` keeps consent events after `last_seen_at` |
| SD-029 | fixed | `a3d1797` | "SD-029: a text leave that stops after the forget unit is finished by the member's second leave text" | `leaveText` takes the person's live membership (`kept`); `leaveRetryOk` |
| SD-017 | fixed | `709be0b` | "SD-017: a YES PHOTOS that read the membership before a ban does not write it back as active" | `photoWrite` never changes the state (`updateMembership` from the state it read) |
| SD-026 | fixed | `a75f361` | "SD-026: after a number change, a legacy address row no longer routes the old number to the member" | `routesText`: a legacy row counts only for a member with no person |
| SD-055 | fixed | `154cc2e` | "SD-055: a STOP that comes in before a number change and is written after it stops the person on the new number" | `stopRecv` reads `personFor`; `stopCommit` also writes on the person's number now |
| SD-056 | fixed | `20f421e` | "SD-056: a phone ban and a number change that run at the same time leave the person's number banned" | ban rows also name the person's number now; `movePhone` refuses a banned person |
| SD-092 | fixed | `a0c33d8` | "SD-092: delete everything leaves no line counter that holds the number" | `storeDeleteAll` deletes `lineRows` of the numbers |
| SD-098 | fixed | `9d84e7d` | "SD-098: a number silent for over a year gets no proactive text before its holder writes" | `sendAllowed` refuses a stale number |
| SD-108 | fixed | `9ec3665` | "SD-108: a number change completes for a person with a Cloud grant; the Cloud grant ends, a site grant moves" | `movePhone` revokes the Cloud grant, never fails on it |
| SD-124 | fixed | `0c49218` | "SD-124: a member's leave removes their id from the stored matching-run summaries" | `forgetUnit` removes the member's run summaries |
| SD-275 | fixed | `8e96df9` | "SD-275, SD-256: a banned person's leave text keeps the photos for the safety team" (and "SD-275: a leave by a person who is not banned still deletes the photos") | onForget keeps a banned person's photos (leave, delete, new_owner) |
| SD-256 | fixed | `8e96df9` | same test as SD-275. Same root cause. Only the photo part changed: messages and the safety case still go on a leave (the existing forget design; reports and ban rows stay). A change there needs a founder decision on retention. | as SD-275 |
| SD-178 | fixed | `8e96df9` | "SD-178: a banned person's delete everything keeps the photos for the safety team". Delete everything stays open to a banned person (the privacy right). | as SD-275 |
| SD-378 | fixed | `decd288` | "SD-378: the export lists the member's photos (id, time, type and size; no bytes, no score)" | `exportReq` holds the photos |
| SD-294 | fixed (agent_private part) | `7b6413b` | "SD-294: the export holds the private facts the member stated or accepted, not ratings, staff checks or staff signals". Pending suggestion rows did not change: the second vote disputed that part, and the model does not cover it. | `exportReq` holds the stated facts |
| SD-379 | fixed | `c0f2317` | "SD-379: a number change moves the Eliza notice row to the new number" | `movePhone` moves `notices` |
| SD-381 | fixed | `a0536cc` | "SD-381: a text that comes in while staff lift a hold (same_owner) does not put the number on hold again" | same_owner is one action (hold lifted, number seen) |
| SD-385 | fixed | `9b127be` | "SD-385: delete everything removes the person's connection receipts and the relay items addressed to them" | receipts are per (person, app); the membership trigger (`dropReceipts`) removes them |
| Q-identity_sagas-1 | fixed | `c759b9a` | "Q-identity_sagas-1: a number change that stops after the move does not leave the new number suppressed" | `movePhone` lifts the suppression of the new number |
| Q-identity_sagas-2 | fixed | `5b6566a` | "Q-identity_sagas-2: delete everything that runs with a number change suppresses the new number and keeps no row with it" | `storeDeleteAll` also clears the person's number now |
| SD-255 | skipped | | The defect is a missing entry point (no staff path for a delete or export request by e-mail), not a wrong state. The model marks it "not reachable". A fix needs a new staff route and a check that the sender is the person: new scope, founder decision. The verdict is disputed. | none |
| SD-489 | skipped | | Needs a founder decision: a missing caller for `/api/me/phone/*` is not a state. The founder correction of 2026-10-19 removed the site account pages. | none (the model keeps the API number change) |
| SD-492 | skipped | | Needs a founder decision: the ban covers "every phone they have now" by design (service.ts ban doc comment). A ban of earlier numbers would also ban a number that the carrier can give to a stranger. | `banCoversOldNumbers` is out of `safety` (run test `banAfterMoveTest` still shows the trace) |

No defect of this module is "not reproduced".

## 1. What the model covers

Machines: `person-lifecycle`, `phone-identity-hold`, `phone-change`, `ban-saga`, `erasure-saga` (leave,
delete everything, staff `new_owner`, under-13 decline) and `suppression`.

| Saga or actor | Code | Model actions (one action for each transaction or `await`) |
|---|---|---|
| Ban | `service.ts` `ban`, `banUnfinished` | `banStart` (guards, hashes and members read; `finish` starts at pc 2), `banStep` pc 1 rows (with the person's number now), 2 suppress, 3 ratings, 4 memberships (`updateMembership`), 5 for each member: `markBanned`, then `account_status = 'restricted'`; done (audit result) |
| Leave by text | `service.ts` inbound leave, `accounts.ts` leave | `leaveText` (routing, `seen`, the live membership of the person), `leaveStep` pc 1 consent, 2 photos (kept when banned), 3 forget unit, 4 OAuth listeners (a failure is swallowed), 5 `forgetMembership` |
| Leave by API | `api.ts` leave | `leaveApi`, then the same `leaveStep` |
| Delete everything | `accounts.ts` deleteAll, `pg-store.ts` deleteAll | `delStart`, `delStep` pc 1 age floor, pc 2 `onForget` for each app, then `store.deleteAll` in one transaction (the session's number and the person's number now) |
| Staff hold decision | `accounts.ts` clearHold | `chStart`; `chStep` same_owner: one write (hold lifted, number seen); new_owner: `onForget` for each app, then `store.deleteAll(newOwner)` in one transaction |
| Number change | `accounts.ts` confirmNumberChange, `pg-store.ts` movePhone | `mvStart` (code verified), `mvStep` pc 1 checks in the join lock and `movePhone` in one transaction (consent, floor, notice, suppression of the new number, Cloud grant), pc 2 age floor and listeners |
| Under-13 decline | `service.ts` statedAge | `u13Start` (the unit forgets the member of this app), `u13Step` (recordAge, then forget, `forgetMembership` and consent for each app) |
| Other actors | | `tick`, carrier `reassign`, `inbound` text, STOP in two steps (`stopRecv` with the person read, `stopCommit` in one locked transaction), atomic `join`, `sendProactive` (`sendAllowed`), `photoRead`/`photoWrite`, `uploadPhoto`, `matchRun`, `connReceipt`, `exportReq`, `crash` |

Bounds: 3 persons, 2 humans, 2 numbers (A, B), 2 apps (slop, peon), 6 clock ticks, a stale period of 1
tick, 1 crash. The init chooses: a legacy `channel_identities` row for A or none, who holds B, a
Cloud-origin OAuth grant on A or none, and a suppression on B (an earlier owner deleted everything) or
none.

Oracles and assumptions (written in the model header):

- The carrier gives a number to another human only when it is nobody's verified number or was silent for
  the stale period. Only the holder of a number sends from it.
- A join is one atomic action here (its steps are `quint/join_age.qnt`).
- Staff decide a held number right: same_owner only when the person's own human holds it, new_owner only
  when another human holds it. The carrier does not give away a number while a staff decision on it runs
  or waits for its staff retry.
  (Added in this round. Without it the model let staff choose same_owner for a stranger, which no code can
  prevent.)
- The clock moves only while no saga runs: one tick is months, a request takes seconds. The site API
  (leave, delete everything) needs a session, which lives 30 days (`sessions.ts` `SESSION_TTL_MS`), and
  its login marked the number seen, so these requests never start on a stale number. (Added in this
  round, see section 6.)
- A STOP turn's first backend step reads the person (`stopRecv`). Section 6 names the window before it.

## 2. Check results

### 2.1 Commands and bounds

| Command | Bounds | Result |
|---|---|---|
| `bun run quint:check quint/identity_sagas.qnt` | seed `0x5eed`, max-steps 40, max-samples 10000 | typecheck ok, 27 run tests ok, `safety` ok, 11 witnesses reachable, 62 s |
| `quint run --invariant safety` (seeds `0x1`, `0x2`, `0x3`) | max-steps 40, max-samples 10000 | no violation |
| `quint run --invariant safety` (seeds `0x77` to `0x7b`, `0x90` to `0x94`) | max-steps 60 and 80, max-samples 10000 | no violation (after the model changes of section 6) |
| `quint run --invariant <name>` for each invariant of `safety` | seed `0x5eed`, max-steps 40, max-samples 10000 | no violation |
| `bun run quint:check --verify quint/identity_sagas.qnt` (Apalache) | verify-steps 5 | simulator part ok; `verify safety`: `Connection dropped` (section 2.3) |
| `apalache-mc check --length=5` on the compiled model | 4 complete steps | no violation in any state of 4 steps or fewer (section 2.3) |

### 2.2 Rules that the code still breaks (out of `safety`)

`val knownOpen` joins them. Each one except `pairAgrees` has a `run` test that shows the trace.

| Value | Defect | Why it is out of `safety` | Run test |
|---|---|---|---|
| `banCoversOldNumbers` | SD-492 | skipped: founder decision | `banAfterMoveTest` |
| `forgetRevokesGrants` | SD-089 | module `oauth_mcp`, outside this branch's defect list, not fixed here | `u13GrantsTest` |
| `pairAgrees` | SD-011 | module `join_age`, not fixed here. `pairAgreesHere` (in `safety`) is the same rule except for a person whose under-13 decline stopped half way (`g.u13Stopped`) | (simulation; the SD-011 trace is in `quint/join_age.qnt`) |
| `bannedNotMatchableFull` | Q-identity_sagas-3 (new) | not fixed; `bannedNotMatchable` (in `safety`) leaves out only `g.banJoinRace` | `banJoinRaceTest` |
| `retryCompletesFull` | Q-identity_sagas-4 (new) | not fixed; `retryCompletes` (in `safety`) leaves out only `g.delHitOther` | `deleteHitsOtherPersonTest` |

### 2.3 Apalache

`bun run quint:check --verify quint/identity_sagas.qnt` (verify-steps 5 at that time): every simulator check and
witness passed; the `verify safety` step failed with `error: Connection dropped` after about 2 minutes.
The Quint client loses its gRPC connection to the Apalache server on this shared machine (the first
round saw the same error); it is not a result of the model. Two more tries with `quint verify` (the
default server, and a server of its own on another port) ended the same way.

So Apalache 0.62.4 ran directly on the compiled model:

```
quint compile --target json --main identity_sagas --invariant safety quint/identity_sagas.qnt > identity_sagas.qnt.json
JVM_ARGS=-Xmx12g apalache-mc check --init=q::init --next=q::step --inv=q::inv --length=5 identity_sagas.qnt.json
```

Result: the invariant holds in every state that 0 to 4 steps reach (1, 21, 38, 51 and 56 symbolic
transitions at steps 0 to 4; every invariant conjunct checked after each one; 31 minutes). Step 5 checked
8 of its transitions in 21 more minutes with no violation, and was then stopped by hand: at about 2.6
minutes for each transition, the rest of step 5 would take about 2 hours on this shared machine. The
model header now says `verify-steps=4`, the bound that Apalache finished. The 4-step bound covers the
short traces of the first round (SD-005, SD-055, SD-056, SD-108, SD-379 and SD-378 at 1 to 4
steps); the longer traces are covered by the run tests and the simulator.

### 2.4 Run tests

Each fixed defect has a run test that replays its old trace on the fixed code and expects the rule to
hold: `banCrashRetryFinishesTest` and `banCrashAfterMarkTest` (SD-005), `photoAfterBanTest` (SD-017),
`leaveCrashTest` (SD-029), `newOwnerCrashTest` (SD-016), `sameOwnerNoReholdTest` (SD-381),
`stopDuringMoveTest` (SD-055), `phoneBanDuringMoveTest` and `banBeforeMoveTest` (SD-056, both orders),
`staleSendTest` (SD-098), `deleteClearsLineRowTest` (SD-092), `cloudGrantMoveTest` (SD-108),
`moveCleanTest` (SD-379), `moveCrashSuppressedTest` (Q-1), `deleteDuringMoveTest` (Q-2),
`legacyRouteTest` (SD-026), `bannedLeaveKeepsPhotosTest`, `leaveDeletesPhotosTest` and `bannedDeleteTest`
(SD-275, SD-256, SD-178), `newOwnerKeepsStopTest` (SD-051), `forgetRowsTest` (SD-124, SD-385),
`exportTest` (SD-378, SD-294). `banCompletesTest` is the control of a clean ban.

## 3. Counterexamples of the first model (code `ad67275`) and their fix

The traces give the actions in order. "crash" is the process stopping between two awaits. Line numbers
are those of `ad67275`.

### SD-005: a ban that stops half way cannot be finished (fixed in `e361184`)

`banStart(1, person)` -> `ban: rows inserted` -> `crash` -> `banStart(1, person)` answered
`already_banned`. The memberships stayed `active`. Code: service.ts:1745-1749 wrote the rows first; the
retry read `isBanned("", personId)` and refused. Now `banUnfinished` lets the retry run every step again
without new rows, and the member status is the last write for each member, so a stop between
`markBanned` and the status write is also finished (`banCrashAfterMarkTest`). Invariants:
`bannedNotMatchable`, `retryCompletes`.

### SD-017: whole-row `putMembership` undid a ban (fixed in `709be0b`)

`photoRead(1)` (reads `active`) -> the full ban -> `photoWrite(1)` wrote `active` back. Now the write is
`updateMembership(from: [the state it read])`: after the ban it changes nothing.

### SD-029: leave stopped half way; the text retry fell into the join flow (fixed in `a3d1797`)

`leaveText(A, slop)` -> consent -> photos -> forget unit -> `crash`. The second "leave slop.date" did not
route to a member. Now the text leave also takes the person's live membership, and the second text
finishes the leave (`leaveCrashTest`).

### SD-016: `clearHold(new_owner)` was not atomic and could not be resumed (fixed in `2f0dbed`)

A crash after `store.deleteAll` left the tombstone with its hash; the retry answered `not_held`; the new
holder's join revived the old owner's person. Now the delete, the detach, the unsuppress and the floor
are one transaction. A stop before it leaves the hold, so the staff retry runs (`newOwnerCrashTest`).

### SD-051: a `new_owner` decision erased the new holder's STOP (fixed in `0dbb09e`)

`store.deleteAll` deleted every consent row of the number. Now the newOwner delete keeps the events after
the phone's `last_seen_at` (`newOwnerKeepsStopTest`).

### SD-055: STOP in flight during a number change (fixed in `154cc2e`)

`stopRecv(A)` -> `mvStart(1, B)` -> `movePhone` -> `stopCommit` wrote the STOP on A only. Now the stop
path reads the person first and `addConsent(event, personId)` locks the phone row and also writes on the
person's current number; the pause uses the person read first (`stopDuringMoveTest`). Section 6 names the
window that is left.

### SD-056: phone-scope ban during a number change (fixed in `20f421e`)

`banStart(1, phone)` read `{A}` -> the move committed -> the ban row named A only. Now `ban()` also bans
the person's number now, and `movePhone` checks the ban again in its transaction (both orders:
`phoneBanDuringMoveTest`, `banBeforeMoveTest`).

### SD-492: a ban covers the current number only (skipped)

`mvStart(1, B)` and the move -> `banStart(1, person)` -> `join(A, peon)` creates person 2. The code is
unchanged. `banCoversOldNumbers` is out of `safety` (founder decision).

### SD-275, SD-256, SD-178: a banned person's leave or delete removed the safety photos (fixed in `8e96df9`)

The onForget hook now keeps the photos of a banned person on a leave by text or API, on delete
everything and on a staff new_owner decision. A person who is not banned still loses the photos. The
under-13 rule (photos are for adults only, `ageLowered`) comes first: an under-13 decline removes the
photos, and the model drops them from `photosAtBan` at that step.

### SD-381: `same_owner` re-hold (fixed in `a0536cc`)

The hold lift and the `last_seen_at` write were two statements; a text between them held the number
again. Now they are one write (`sameOwnerNoReholdTest`).

### SD-098: stale numbers were held only on inbound (fixed in `9d84e7d`)

`consentRefused` now refuses every send but a compliance text to a number on hold or silent for more
than 12 months (`sendAllowed`, `staleSendTest`).

### SD-026: legacy addresses survived a move (fixed in `a75f361`)

`identities()` and `member_apps` (migration 0044) now read a legacy phone row only for a member with no
person. Every member of the model has a person, so a legacy row never routes (`legacyRouteTest`).

### SD-092: line counters kept a deleted person's number (fixed in `a0c33d8`)

`store.deleteAll` now deletes the line rows of the number (not on a new_owner decision: they are the new
holder's).

### SD-124 and SD-385: ids outlived a forget (fixed in `0c49218` and `9b127be`)

The forget unit removes the member's pairs from the run summaries. The membership trigger
(`forget_profile_suggestions`, migration 0044) removes the connection receipts and the relay items of
the person and app when the membership goes to `removed` or is deleted (`forgetRowsTest`).

### SD-108: a number change failed on the Cloud grant trigger (fixed in `9ec3665`)

`movePhone` now revokes the Cloud grant of the old number and moves the other grants
(`cloudGrantMoveTest`). No step of the model fails after the code now, so `moveCompletes` stays as the
regression guard.

### SD-379: `eliza_notices` key mismatch (fixed in `c0f2317`)

`movePhone` now moves the row by the notice keys (`moveCleanTest`).

### SD-378 and SD-294: export left out photos and stated agent_private facts (fixed in `decd288`, `7b6413b`)

The export lists the photos (no bytes, no score) and the agent_private facts the member said or accepted
(`exportTest`).

### Other register ids reached by this model

- SD-089 (module `oauth_mcp`): the under-13 decline runs no `onForget` hook, so the MCP grants stay; a
  failed OAuth listener is swallowed. Not fixed here; `forgetRevokesGrants` is out of `safety`.
- SD-011 (module `join_age`): a crash after the under-13 unit commit leaves `memberships.state = active`
  with no Network member. Not fixed here; `pairAgrees` is out of `safety`, `pairAgreesHere` is in it.

## 4. New findings

### Q-identity_sagas-1: a crash after `movePhone` left the new number suppressed (fixed in `c759b9a`)

`movePhone` now deletes the suppression of the new number in its own transaction
(`moveCrashSuppressedTest`).

### Q-identity_sagas-2: delete everything that ran with a number change kept the new number (fixed in `5b6566a`)

`store.deleteAll` now reads the person's number under the person lock and suppresses and clears it too
(`deleteDuringMoveTest`).

### Q-identity_sagas-3: a join between the ban's member read and its ban rows keeps an active Network member (new, not fixed)

Trace (`banJoinRaceTest`): person 1 left peon -> staff `ban` reads the person's members (slop only,
`membersOfPerson` at the start of service.ts `ban`) -> the person joins peon again (no ban row yet, so
the join passes) -> the ban rows, the suppression, the memberships (both restricted: step 4 reads the
memberships again) -> the member loop restricts and holds slop only. The Network member of peon stays
`active` with a `restricted` membership. The outbound queue refuses sends (membership not active), but
the Network can still propose the member for matching, against founder decision 3.
Rule: `bannedNotMatchableFull`. Likelihood: very low (the person joins a second app in the window of one
audit write of a staff ban). Fix direction: read the members again after the ban rows (a join after the
rows is refused), for example `membersOfPerson` inside `audited` after `people.ban`.

### Q-identity_sagas-4: delete everything clears the session's number although another person now has it (new, not fixed)

Trace (`deleteHitsOtherPersonTest`): delete everything starts with a session on A -> the person moves to
B -> the same human joins peon on A as a new person (A is nobody's number after the move) and starts a
leave -> the leave stops -> the store delete runs with `e164 = A`. pg-store.ts `deleteAll` deletes the
phone row of A by its e164 and suppresses A, so the new person has no number, their number is
suppressed, and their leave cannot be retried. Rule: `retryCompletesFull`.
Likelihood: very low. Only the same human can hold A within the life of one request (the carrier gives
a number away only after months), and that human runs three requests at once.
Fix direction: in `deleteAll`, clear the session's number only while it still belongs to the person (or
has no phone row); the 5b6566a read of the person's number covers the moved case.

## 5. Observations (no rule broken)

- The ban's member loop writes `account_status = 'restricted'` with no status filter. A member that a
  leave or an under-13 decline removed during the ban gets `restricted` back (the facts stay forgotten).
  No rule of the model breaks; the leave counts as done when the membership is gone and the member is
  not `active`.
- A delete everything that runs with a join of another app can leave an active Network member for a
  deleted person (the delete reads its app list first). No invariant of this model checks a deleted
  person's Network members; a later wave can add one.

## 6. Model changes in this round, besides the fixes

- `tick` runs only while no saga runs, and the site API sagas (leave, delete everything) need a fresh
  number. Without this the model let a request stay in flight across the 12-month stale period, and
  found a race between a self delete and a new_owner decision that no session allows (a session lives
  30 days and its login marks the number seen).
- Staff decide a hold right, and the carrier does not reassign a number during a staff decision on it
  (header assumption). Without this the simulator chose same_owner for a stranger.
- `stopRecv` reads `personFor` (the stop path reads the person first since `154cc2e`). The window before
  that read is left: a number change that commits between the gateway receive and the person read
  leaves the STOP on the old number only. For the backend this is the same as a STOP sent after the
  change from a number that is no longer the person's. The code could close it by finding the person
  through `phone_changes.old_hash`; that is a design choice, so the model does not count it.
- Retry predicates: a stopped leave or delete can also be finished after staff decide a hold
  (`ownHeld`: same_owner, then the member's retry; `otherHeld`: new_owner, which deletes everything of the
  person). A pending leave whose membership another saga already ended counts as done. A ban whose last
  write ran counts as done. A finished delete everything or new_owner decision clears the person's
  pending leave and delete.
- `pairAgrees` also exempts a person whose stopped new_owner decision waits for the staff retry
  (`chWaits`), as it already did for a stopped leave or delete.
- Ghost rules: a carrier reassign drops the STOPs of earlier holdings of the number; a number change
  clears its human's STOP on the new number (they proved the number and their consent moved); the
  opt-out record of the person's own leave or under-13 statement ends "erased until it writes again"
  (as a STOP does); a number change to an erased number ends it too; a join that revives the person ends
  `selfDeleted` for all of the person's numbers; a delete of the person ends the notice ghost (`noticed`),
  so a stranger who revives the tombstone is not counted.
- `bannedNotMatchable` and the ban part of `retryCompletes` exempt a person with another saga that runs
  (`busy`) or a pending delete everything: each of these ends the memberships it touches, and
  `retryCompletes` checks their retry.
- `liveNumberNotSuppressed` exempts a banned number (a phone ban of an earlier person on the same number
  suppresses it by design).
- `connReceipt` is per (person, app) and needs a live membership of that app.

## 7. Model errors found and fixed during the first check (code `ad67275`)

- `movePhone` first missed its `no_phone` exit: a delete that committed first made the move look
  successful. Fixed.
- A carrier reassign of the number that a running number change had just proved made a false
  `holderStopRespected` trace. The reassign now waits for the move.
- `holderStopRespected` first counted a STOP of the member's own human on a number they later moved
  to. It now counts only humans with no live person (the new owner case).
- `pairAgrees` first counted a crashed delete everything, which the member's retry finishes. It now
  exempts a pending saga whose retry the code allows (`retryCompletes` checks that the retry exists).
- The inbound line row is now written only for a handled member text (service.ts:2088), as in a signed
  turn in production.
