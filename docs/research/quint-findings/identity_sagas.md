# Quint findings: `quint/identity_sagas.qnt`

Module plan: [docs/research/2026-11-07-state-machines.md](../2026-11-07-state-machines.md) section 6.4 (P0).
Model: [quint/identity_sagas.qnt](../../../quint/identity_sagas.qnt). Code base: commit `ad67275`.
This file is hand-written. The traces are cut from the simulator and Apalache output and from the `run`
tests of the model.

## 1. What the model covers

Machines: `person-lifecycle`, `phone-identity-hold`, `phone-change`, `ban-saga`, `erasure-saga` (leave,
delete everything, staff `new_owner`, under-13 decline) and `suppression`.

| Saga or actor | Code | Model actions (one action for each transaction or `await`) |
|---|---|---|
| Ban | `packages/network/service/service.ts:1734-1764` | `banStart` (guards and hash read, 1735-1743), `banStep` pc 1 rows (1745-1749), 2 suppress (1750), 3 ratings (1753), 4 memberships (1754), 5 one step for each Network member (1757-1759), done (audit result) |
| Leave by text | `service.ts:1078-1092`, `packages/platform/src/accounts.ts:421-429` | `leaveText` (routing and `seen`, 1043 and 1061), `leaveStep` pc 1 consent, 2 photos (service.ts:760), 3 forget unit (runtime.ts:521-551), 4 OAuth listeners (service.ts:763-765, a failure is swallowed), 5 `forgetMembership` (pg-store.ts:293-302) |
| Leave by API | `packages/platform/src/api.ts:626-629` | `leaveApi`, then the same `leaveStep` |
| Delete everything | `accounts.ts:432-444`, `pg-store.ts:304-326` | `delStart`, `delStep` pc 1 age floor, pc 2 `onForget` for each app, then `store.deleteAll` in one transaction |
| Staff hold decision | `accounts.ts:194-213`, `service.ts:2262-2270` | `chStart` (guard 196-197), `chStep`: same_owner 199, 200; new_owner `onForget` for each app, `store.deleteAll`, `detachPhoneHash`, `unsuppress`, `clearAgeFloor` |
| Number change | `accounts.ts:249-274`, `pg-store.ts:341-379` | `mvStart` (code verified), `mvStep` pc 1 checks in the join lock and `movePhone` in one transaction, pc 2 `unsuppress` (265), pc 3 age floor and listeners (270-272) |
| Under-13 decline | `service.ts:1292-1310` | `u13Start` (the unit forgets the member of this app), `u13Step` (recordAge, then forget, `forgetMembership` and consent for each app) |
| Other actors | | `tick`, carrier `reassign`, `inbound` text (routing runtime.ts:387-404, `seen` accounts.ts:176-184, line row service.ts:2088), STOP in two steps (`stopRecv`, `stopCommit`), atomic `join`, `sendProactive` (outbound-queue.ts:470-485 and service.ts:696-716), `photoRead`/`photoWrite` (photoIntake.ts:112-134), `uploadPhoto`, `matchRun`, `connReceipt`, `exportReq`, `crash` |

Bounds: 3 persons, 2 humans, 2 numbers (A, B), 2 apps (slop, peon), 6 clock ticks, a stale period of 1
tick, 1 crash. The init chooses: a legacy `channel_identities` row for A or none, who holds B, a
Cloud-origin OAuth grant on A or none, and a suppression on B (an earlier owner deleted everything) or
none.

Oracles and assumptions (written in the model header): the carrier gives a number to another human only
when it is nobody's verified number or was silent for the stale period; only the holder of a number
sends from it; a join is one atomic action here (its steps are `quint/join_age.qnt`).

## 2. Check results

Command: `bun run quint:check quint/identity_sagas.qnt` (seed `0x5eed`, max-steps 40, max-samples 10000).

```
ok   quint/identity_sagas.qnt typecheck
ok   quint/identity_sagas.qnt test                      (20 run tests)
FAIL quint/identity_sagas.qnt safety                    (expected: the model shows the defects)
ok   witness_banDone, witness_banRetryRefused, witness_leaveDone, witness_deleteDone,
     witness_newOwnerDone, witness_sameOwnerDone, witness_moveDone, witness_u13Done,
     witness_stopCommitted, witness_rejoin, witness_held  (all reachable)
1 models, 1 failures
```

Each invariant alone (`quint run --invariant <name>`, same seed and bounds):

| Invariant | Random simulation | Run test that shows it |
|---|---|---|
| `bannedNotMatchable` | violated | `banCrashRetryRefusedTest`, `photoOverwritesBanTest` |
| `retryCompletes` | violated | `banCrashRetryRefusedTest`, `leaveCrashTest`, `newOwnerCrashTest` |
| `pairAgrees` | violated | `leaveCrashTest` |
| `banCoversPerson` | violated | `phoneBanDuringMoveTest` |
| `banCoversOldNumbers` | violated | `banAfterMoveTest` |
| `banKeepsPhotos` | violated | `bannedLeaveDeletesPhotosTest`, `bannedDeleteTest` |
| `newOwnerNotRevived` | violated | `newOwnerCrashTest` |
| `stopFollowsPerson` | violated | `stopDuringMoveTest` |
| `holderStopRespected` | not found in 10000 samples | `newOwnerErasesStopTest` |
| `holdMeansSilent` | violated | `sameOwnerReholdTest` |
| `noSendToOtherHuman` | violated | `staleSendTest` |
| `noRouteToOtherHuman` | violated | `legacyRouteTest` |
| `noPlainPhoneAfterDelete` | violated | `deleteKeepsLineRowTest`, `deleteDuringMoveTest` |
| `forgetLeavesNoRows` | violated | (simulation trace in section 3) |
| `forgetRevokesGrants` | violated | `u13GrantsTest` |
| `moveCompletes` | violated | `cloudGrantMoveTest` |
| `noticeFollowsMove` | violated | `moveCleanTest` |
| `exportComplete` | violated | (one step: export) |
| `liveNumberNotSuppressed` | violated | `moveCrashSuppressedTest` |
| `deleteKeepsSafety` | violated | `deleteDuringMoveTest` |
| `heldHasNoPerson` (control) | holds | |

Apalache (`quint verify --invariant safety --max-steps 5`): counterexample in 26 s, one step (`export
slop`: `exportComplete`, SD-378).

Apalache for each invariant alone (`quint verify --invariant <name> --max-steps 6`). Apalache gives the
shortest counterexample:

| Invariant | Result | Shortest trace |
|---|---|---|
| `retryCompletes` | counterexample, 59 s | ban start (person) -> ban rows inserted -> crash (SD-005) |
| `pairAgrees` | counterexample, 35 s | under-13 unit forgets the member -> crash (SD-011) |
| `stopFollowsPerson` | counterexample, 107 s | STOP received from A -> code verified A->B -> movePhone -> STOP committed on A (SD-055) |
| `banCoversPerson` | counterexample, 180 s | ban start (phone, reads A) -> code verified A->B -> movePhone -> ban rows (A) (SD-056) |
| `noSendToOtherHuman` | counterexample, 86 s | tick -> tick -> carrier gives A to h2 -> proactive send to A (SD-098) |
| `moveCompletes` | counterexample, 36 s | code verified A->B -> Cloud grant trigger raises (SD-108) |
| `noticeFollowsMove` | counterexample, 32 s | code verified A->B -> movePhone (SD-379) |
| `holdMeansSilent`, `liveNumberNotSuppressed`, `deleteKeepsSafety` | Apalache ran out of Java heap (61-160 s) | the simulator and the run tests show them |
| `heldHasNoPerson` (control) | not finished: the shared Apalache server dropped the connection after 75 s (other sessions share the machine) | holds in the simulator (10000 samples) |

The full `--verify` of `safety` at higher bounds was not run further: `safety` already fails at step 1.

## 3. Counterexamples and their mapping to the code

The traces give the actions in order. "crash" is the process stopping between two awaits.

### SD-005: a ban that stops half way cannot be finished (reproduced)

`banStart(1, person)` -> `ban: rows inserted` -> `crash` -> `banStart(1, person)` answers
`already_banned`. The memberships stay `active` and the Network members stay `active` and not held.
Code: service.ts:1745-1749 writes the rows first; the retry reads `isBanned("", personId)` at
service.ts:1742 and refuses at 1743. Invariants: `bannedNotMatchable`, `retryCompletes`.

### SD-017: whole-row `putMembership` undoes a ban (reproduced)

`photoRead(1)` (YES PHOTOS: reads `active`, `mayTake` passes) -> the full ban (rows, suppress, ratings,
memberships `restricted`, both Network members held) -> `photoWrite(1)` writes `active` back.
Code: photoIntake.ts:121-124 reads `who.m`, checks `mayTake`, then `putMembership({...who.m, ...})`;
pg-store.ts:124-129 replaces every column. The random simulation also wrote a stale `active` row on a
tombstone after delete everything (an insert, because the row was gone). Invariants:
`bannedNotMatchable`, `pairAgrees`.

### SD-029: leave stops half way; the text retry falls into the join flow (reproduced)

`leaveText(A, slop)` -> consent `opted_out` -> photos deleted -> forget unit commits -> `crash`.
State: `memberships.state = active`, `network.members.account_status = removed`. A second
"leave slop.date" text does not route to a member (runtime.ts:389-397 needs a live Network member), so
service.ts:1083 is false and the text goes to the join flow. Code: accounts.ts:425-428 (three separate
writes). Invariants: `retryCompletes`, `pairAgrees`. The API leave (api.ts:626-629) can still finish it,
but the founder correction of 2026-10-19 removed the site account pages, so the text is the member's path.

### SD-016: `clearHold(new_owner)` is not atomic and cannot be resumed (reproduced)

Crash form: 3 ticks -> `reassign(A, h2)` -> `inbound(A)` (A goes on hold) -> `POST /holds new_owner`
-> forget slop, forget peon -> `store.deleteAll` -> `crash` -> `POST /holds new_owner` answers
`not_held` -> `join(A, slop)` by h2 revives person 1 (the old owner's tombstone, with their blocks).
Race form (simulation, no crash): the new owner's join runs between `store.deleteAll` and
`detachPhoneHash`; `clearHold` takes no join lock. Code: accounts.ts:197 (guard reads the deleted phone
row), 207-211 (four separate writes), pg-store.ts:67-68 (revive by `phone_hash`). Invariants:
`retryCompletes`, `newOwnerNotRevived`.

### SD-051: a `new_owner` decision erases the new holder's STOP (reproduced)

3 ticks -> `reassign(A, h2)` -> h2 sends STOP from A (global `opted_out` on A) -> h2 texts (A goes on
hold) -> `POST /holds new_owner` runs to the end. `store.deleteAll` deletes every consent row of A
(pg-store.ts:313) and `unsuppress` (accounts.ts:210) removes the suppression, so A reads "no event":
not opted out, not suppressed. Invariant: `holderStopRespected`. The random simulation did not reach
this trace (it needs 13 ordered steps); the run test `newOwnerErasesStopTest` shows it.

### SD-055: STOP in flight during a number change (reproduced)

`stopRecv(A)` -> `mvStart(1, B)` -> `movePhone` commits (consent copied to B, A's rows deleted) ->
`stopCommit` writes the STOP on A. B has no STOP; `personFor(A)` is undefined, so `stopped()` does not
pause anything. Code: accounts.ts:398-407 and service.ts stop path write on the message number;
pg-store.ts:351-354 copies only rows that exist at commit time. Invariant: `stopFollowsPerson`.

### SD-056: phone-scope ban during a number change (reproduced)

`banStart(1, phone)` reads hashes `{A}` -> `mvStart(1, B)` -> `movePhone` commits (the lock check at
accounts.ts:260-261 finds no ban row yet) -> `ban: rows inserted` with hash A. The person is on B;
`isBanned(B, 1)` is false for a phone-scope row (pg-store.ts:173-176). Invariant: `banCoversPerson`.

### SD-492: a ban covers the current number only (reproduced)

`mvStart(1, B)` and the move complete (h1 still holds A) -> `banStart(1, person)` -> rows with hash B
and person 1 -> `join(A, peon)` creates person 2, `active`. Code: pg-store.ts:177-181 reads one
`phone_hash`; `phone_changes.old_hash` is not read. Invariant: `banCoversOldNumbers`. The register marks
this as disputed (documented design); the model keeps the PRD 40.5 / line 1817 rule.

### SD-275, SD-256, SD-178: a banned person's leave or delete removes the safety photos (reproduced)

Full ban -> `leaveText(A, slop)` -> consent -> photos deleted (service.ts:760). The text leave path
has no ban check (service.ts:1078-1092). Same with `leaveApi` (api.ts:626-629) and with delete
everything (`bannedDeleteTest`, api.ts:630-636). Rule: service.ts:1752 "The photos stay for the safety
team". Invariant: `banKeepsPhotos`.

### SD-381: `same_owner` re-hold (reproduced)

3 ticks -> `inbound(A)` (hold) -> `POST /holds same_owner` -> `setPhoneHold(null)` -> `inbound(A)`:
`seen` finds no hold and a stale `last_seen_at`, so it holds A again -> `touchPhone`. The number is held
with a fresh `last_seen_at`. Code: accounts.ts:199-200 and 176-184. Invariant: `holdMeansSilent`.

### SD-098: stale numbers are held only on inbound (reproduced)

3 ticks -> `reassign(A, h2)` -> `sendProactive(1, slop)` goes to A. Queue admission checks
`phone.hold is null` (outbound-queue.ts:481), `consentRefused` checks suppression, ban and ledger
(service.ts:696-716); nothing checks staleness, and only `seen` (inbound, login, join) writes a hold.
Invariant: `noSendToOtherHuman`.

### SD-026: legacy addresses survive a move (reproduced, needs a legacy row)

Init with a `channel_identities` row (A, member of person 1, slop) -> move A -> B -> `reassign(A, h2)`
-> `inbound(A, slop)`: `seen(A)` is "new" (no phone row), the legacy row routes the text to person 1's
member. Code: runtime.ts:389-391 (no hold filter, later row wins), pg-store.ts:341-379 (no
`channel_identities` update). Invariant: `noRouteToOtherHuman`. The register vote says nothing in
production writes such rows; the model reaches it only when the init chooses one.

### SD-092: line counters keep a deleted person's number (reproduced)

`sendProactive(1, slop)` (a `line_conversations` row for A) -> delete everything runs to the end. The
row with the plain E.164 stays (pg-store.ts:304-326 does not touch the table; production does not call
`purge`, and `purge` keeps rows with `unanswered > 0`, outbound-queue.ts:659-664). The simulation also
found the same with a member text (service.ts:2088 `engaged`). Invariant: `noPlainPhoneAfterDelete`.

### SD-124 and SD-385: ids outlive a forget (reproduced by the absence of a delete)

Simulation: `matchRun(1, slop)` -> leave by API -> crash -> delete everything -> forget path for slop.
`network.matching_runs` still names the member (runtime.ts:521-551 deletes no summary). A
`connReceipt(1)` row stays after delete everything. Invariant: `forgetLeavesNoRows`. Both rows hold ids,
not text; the register votes dispute the harm.

### SD-108: a number change fails on the Cloud grant trigger (reproduced, needs a Cloud grant)

Init with a Cloud-origin grant on A -> `mvStart(1, B)` (code used) -> `movePhone` raises at
pg-store.ts:373 (oauth.sql:66-71 `keep_cloud_grant_authority`), rollback, 500. Every retry fails the
same way. Invariant: `moveCompletes`.

### SD-379: `eliza_notices` key mismatch (reproduced)

`mvStart(1, B)` -> `movePhone` commits. pg-store.ts:368-369 moves rows keyed by the `phone:` hash;
service.ts:1164 keys them by the `eliza_notice:` hash, so nothing moves. Invariant: `noticeFollowsMove`.

### SD-378 and SD-294: export leaves out photos and stated agent_private facts (reproduced)

One step: `exportReq(A, slop)`. accounts.ts:447-463 exports profile, consent and the network blob; no
photo rows; service.ts:834 filters `privacy_scope <> 'agent_private'` (the join zip). Invariant:
`exportComplete`. The founder correction moves export requests to help@ntwrk.party (SD-255), so the API
export is the only code path today.

### Other register ids reached by this model

- SD-089 (module `oauth_mcp`): `u13Start(A, slop)` -> the decline removes both memberships; no
  `onForget` hook runs, so the MCP grants stay (service.ts:1300-1309). Also a leave whose OAuth listener
  throws (service.ts:763-765). Invariant: `forgetRevokesGrants`.
- SD-011 (module `join_age`): a crash after the under-13 unit commit leaves `memberships.state = active`
  with no Network member (`pairAgrees`).

## 4. New findings

### Q-identity_sagas-1: a crash after `movePhone` leaves the member's new number suppressed

Trace (`moveCrashSuppressedTest`; also found by the simulation): init with B suppressed (an earlier
owner of B deleted everything) -> `mvStart(1, B)` -> `movePhone` commits -> `crash` before
`unsuppress(B)`. The live member is now on B and B stays in `platform.suppression`.
`consentRefused` (service.ts:705-712) refuses every send to B except compliance texts, so the member's
replies are refused too. A join on B returns the existing membership before `unsuppress`
(accounts.ts:357-362), so no member path lifts it.
Code: accounts.ts:263-265 (`movePhone` and `unsuppress` are two transactions in the join lock).
Rule: accounts.ts:246 and 373 (a new opt-in lifts the suppression of an earlier delete).
Invariant: `liveNumberNotSuppressed`.
Likelihood: low (a process stop in a window of one statement, after an earlier owner of the new number
deleted everything). The number change route has no caller in the sites today (SD-489).
Fix direction: delete the suppression row in the `movePhone` transaction.

### Q-identity_sagas-2: delete everything that runs with a number change keeps the new number

Trace (`deleteDuringMoveTest`; also found by the simulation): `mvStart(1, B)` (code verified) ->
`delStart(A)` (delete everything with a session on A) -> `movePhone` commits (person on B, consent
rows copied to B) -> the forget paths -> `store.deleteAll(1, A)` commits. It suppresses A and deletes
A's consent rows (pg-store.ts:307, 313), and deletes B's phone row by person id (318). B is not
suppressed and B keeps the copied consent rows with the plain number. A later staff invite to B is
allowed (accounts.ts:336 checks suppression).
Code: accounts.ts:432-444 uses `who.e164` from the session; pg-store.ts:304-326 locks the person row,
`movePhone` locks the phone row (343) and the join lock of the new number (accounts.ts:259). No lock is
common to both.
Rule: README "Rules the code keeps" and accounts.ts:431 (a delete leaves the suppression hash), the
implicit-sweep 3.5 invariant (no row holds the number in plain form after a delete).
Invariants: `deleteKeepsSafety`, `noPlainPhoneAfterDelete`.
Likelihood: very low (the same member sends both requests at the same time; SD-489: no caller).
Fix direction: inside the `deleteAll` transaction, read the person's current phone rows and use them
for the suppression, the consent delete and the session delete.

## 5. Register ids of this module: reproduced or not

| Id | Result | Invariant or reason |
|---|---|---|
| SD-005 | reproduced | `bannedNotMatchable`, `retryCompletes` |
| SD-016 | reproduced (crash and race) | `retryCompletes`, `newOwnerNotRevived` |
| SD-017 | reproduced | `bannedNotMatchable`, `pairAgrees` |
| SD-026 | reproduced with a legacy row | `noRouteToOtherHuman` |
| SD-029 | reproduced | `retryCompletes`, `pairAgrees` |
| SD-051 | reproduced (run test only) | `holderStopRespected` |
| SD-055 | reproduced | `stopFollowsPerson` |
| SD-056 | reproduced | `banCoversPerson` |
| SD-092 | reproduced | `noPlainPhoneAfterDelete` |
| SD-098 | reproduced | `noSendToOtherHuman` |
| SD-108 | reproduced with a Cloud grant | `moveCompletes` |
| SD-124 | reproduced | `forgetLeavesNoRows` |
| SD-178 | reproduced | `banKeepsPhotos` |
| SD-255 | not reachable | A missing entry point (no operator route for an e-mail request) is not a state. The model has only the API delete and the text leave, which agrees with the claim. |
| SD-256 | reproduced | `banKeepsPhotos` (text leave) |
| SD-275 | reproduced | `banKeepsPhotos` |
| SD-294 | reproduced in part | `exportComplete` (agent_private facts). "Pending rows" are not modelled. |
| SD-378 | reproduced | `exportComplete` |
| SD-379 | reproduced | `noticeFollowsMove` |
| SD-381 | reproduced | `holdMeansSilent` |
| SD-385 | reproduced | `forgetLeavesNoRows` |
| SD-489 | not reachable | A missing caller is not a state. The model keeps the API number change, so Q-1, Q-2, SD-055, SD-056, SD-108 and SD-379 depend on a caller that the sites do not have today. |
| SD-492 | reproduced | `banCoversOldNumbers` |

Other ids of the plan list that are outside this task's list: SD-018 and SD-109 are refuted in the
register and not modelled (no `phone_hash`-less legacy person; the move merges consent by time by
design); SD-274 is refuted (the floor moves with the number by design), so `deleteKeepsSafety` accepts
the floor on any of the person's numbers.

## 6. Model errors found and fixed during the check

- `movePhone` first missed its `no_phone` exit (pg-store.ts:343-344): a delete that committed first
  made the move look successful. Fixed.
- A carrier reassign of the number that a running number change had just proved made a false
  `holderStopRespected` trace. The reassign now waits for the move.
- `holderStopRespected` first counted a STOP of the member's own human on a number they later moved
  to. It now counts only humans with no live person (the new owner case).
- `pairAgrees` first counted a crashed delete everything, which the member's retry finishes. It now
  exempts a pending saga whose retry the code allows (`retryCompletes` checks that the retry exists).
- The inbound line row is now written only for a handled member text (service.ts:2088), as in a signed
  turn in production.
