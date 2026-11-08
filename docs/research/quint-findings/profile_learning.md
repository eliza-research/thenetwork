# Quint findings: profile_learning

Model: [quint/profile_learning.qnt](../../../quint/profile_learning.qnt). Plan: section 6.12 of
[2026-11-07-state-machines.md](../2026-11-07-state-machines.md). Source reports:
[gap-connector-journey.md](../state-machines/gap-connector-journey.md) and
[platform-consent.md](../state-machines/platform-consent.md) section 7.

Status: research only. No code was changed. This file is hand-written. The traces are short forms of the
ITF traces that the Quint simulator and Apalache generated.

## 1. What the model covers

- Machines: suggestion-item, suggestion-batch, collection-claim, connection-cleanup-v1,
  owner-withdrawal-v2, accepted-source-fact, journey-parent-turn, learning-context-proof (as the LC
  action), cloud-proof-chain (the source proof as a deadline with `min`), review-proofs (owner, revoked,
  withdrawal proofs as Cloud oracles), connector-profile-journey (the product of all of them).
- Bounds: 1 person, 1 app, 1 chat, 2 batches with 2 rows each, 2 Google connections, 2 V1 nonces.
  Two clocks: `nowN` (Network `Clock`) and `nowC` (Cloud), `|nowN - nowC| <= 2` ticks.
- `collect` (`PS.propose`) is split at its awaits on Cloud: `collectBegin` (locks and the eligibility
  read, `PS:136-149`), one `collectSourceCall` per suggestion (`PS:151-153`, `PF:75-95`), and
  `collectCommit` (`PS:154-190`, then the render after the commit, `EP:111-113`). While the collect runs,
  the person and member rows are locked: `stopProjection`, `ageDrop`, `consentContext`, decide, delete,
  V1, V2, `leaveForget`, `leaveMembership` and `deleteAll` wait. `ban` (`PG:170`), `hold` (`PG:78`), the
  STOP ledger insert and `expirePending` (`skip locked`) do not wait.
- Every other store call (decide, delete, V1, V2, expiry tick, delete everything) is one action.
  Leave is three actions (`AC:421-428`): consent event, forget, membership removed.
- Oracles: the Cloud source proof is true iff the connection is active and Cloud holds learning consent.
  Cloud revokes and reconnects, clears consent, and records the withdrawal event at any time. The gateway
  can lose a reply and send the same request again (`retryLast`).
- Not modelled: the chat binding moving (SD-171), two member rows (SD-174, the schema blocks it), the
  route `admitUntil`/`drainUntil` phases (SD-241), the 16-receipt cap (SD-461), the matcher (SD-459),
  the leak guard on `reviewText` (SD-460), the trigger owner (SD-465).

## 2. Check results

Command: `bun run quint:check quint/profile_learning.qnt` (seed `0x5eed`, rust backend, 32 steps,
4000 samples). Apalache 0.62.4 with `quint verify --max-steps N` on a private server (the shared server
on port 8822 ran out of heap).

| Check | Result |
|---|---|
| typecheck | ok |
| 10 run tests | ok (each replays a trace below) |
| `safety` (simulation) | FAIL, as expected: the model shows the defects below |
| 8 witnesses (batch committed, fact accepted, batch deleted, collect replayed, V1 applied, V2 applied, leave done, STOP projected) | all reachable |
| `safetyHolds` with Apalache, 3 steps | ok (no violation, 60 s); 4 steps take 308 s; 6 steps ran out of time |
| `safety` with Apalache, `verify-steps=4` | violation at depth 2 (SD-464) |
| Apalache, 3 steps: `inv_stopNotBlockedByCloud`, `inv_deleteAllErasesIdentity` | violations (SD-112, SD-170) |

Invariants by result (simulation, 4000 x 32 steps, seed `0x5eed`; `inv_retainFalseGone` also seeds
`0x1`-`0x8`):

| Invariant | Rule it comes from | Result | Register id |
|---|---|---|---|
| `inv_textOnlyWhenProposed` | SQL check `0039:39` | holds | - |
| `inv_factOnlyFromAccept` | AF-1, `PS:65` | holds | - |
| `inv_oneBatchPerTurn` | `PS:158-159` (replay never recreates) | holds | - |
| `inv_minorNeverAdds` | AGENTS.md age policy | holds | - |
| `inv_noAcceptAfterExpiry` | `PS:208`, review copy | holds | - |
| `inv_noConsentProofAfterStop` | `LC:70`, `LC:75-94` | holds | - |
| `inv_bannedOrHeldNeverAdds` | founder decision 3 (bans), `PS:82-86` | **fails** | **Q-profile_learning-1** |
| `inv_noAddAfterStop` | PRD 40.3, `LC:70` comment | fails | SD-175 |
| `inv_nothingSavedIsTrue` | `EP:113` reply text | fails | SD-240 |
| `inv_cutoffRespected` | `DE:24`, `WE:21` comments | fails | SD-172 |
| `inv_retainFalseGone` | `RV:23` copy, `DE:22` | fails (run test only) | SD-172 |
| `inv_deleteErases` | `DE:22-23`, `WE:19-20` | fails | SD-172 |
| `inv_v2NotDeniedBySkew` | `WE:13-14` | fails | SD-242 |
| `inv_leaveErases` | `0039:59` comment | fails | SD-463 |
| `inv_deleteAllErasesIdentity` | `AC:431` comment, PRD member deletion | fails | SD-170 |
| `inv_stopNotBlockedByCloud` | AGENTS.md 8 s turn budget, PRD 40.3 | fails | SD-112 |
| `inv_oneSourceCallPerScope` | 5 s source proof, `PF:92` | fails | SD-455 |
| `inv_retryKeepsResult` | AGENTS.md "idempotent on x-ntwrk-svc-id" | fails | SD-458 |
| `inv_consentNeedsReview` | `PF:99` comment | fails | SD-464 |
| `inv_terminalRowsPurged` | PRD data retention schedule | fails | SD-376 |

## 3. Counterexamples

Short form: `N` is the Network clock, `C` the Cloud clock. Only the steps that matter are shown.

### Q-profile_learning-1. A ban or hold during the Cloud source calls does not stop the batch (new)

Trace (simulation, `inv_bannedOrHeldNeverAdds`, 22 steps; the relevant tail):

```text
16 N=0 memberCollectCmd(b=1)                  open turn, member eligible
17 N=0 consentContext(b=2)                    Cloud holds learning consent
18 N=0 collectBegin(b=1)                      owned(): locks, eligible = true (PS:136-137)
19 N=0 ban                                    insert into platform.bans (PG:170), no lock waits
20 N=0 collectSourceCall                      Cloud source proof 1 (PS:151)
21 N=0 collectSourceCall                      Cloud source proof 2
22 N=0 collectCommit                          batch 1 inserted (PS:182): addedBannedOrHeld = true
```

Code: `PS:137` reads `member.eligible` once, at the start of the transaction. The loop at `PS:151-153`
then makes one Cloud round trip per suggestion (up to 10, each up to 3 s). `checkAuthority` at `PS:154`
checks only time and the proof fence. Nothing reads `platform.bans` or `phone_identities.hold` again
before the insert at `PS:182-187`. `owned()` locks the person, member and membership rows
(`PS:81`, `PS:90`), but a ban is a plain insert into `platform.bans` (`pg-store.ts:170`) and a hold is an
update of `platform.phone_identities` (`pg-store.ts:78`). Neither row is locked, so both commit at once,
and the batch commits after them. Accept has the same window: `decide` reads `b.eligible` in `batch()`
(`PS:207`) and then calls Cloud at `PS:220` before the facet insert at `PS:241`. The model keeps decide
atomic, so it shows only the collect case. V1 already rereads `owned()` before commit (`PS:356`); propose
and decide do not.

Why it is not an existing id: SD-175 is about the STOP ledger against the projection. SD-112 is about the
STOP projection waiting on the lock. Section 9 of gap-connector-journey.md names "ban during accept" as a
small window, with no id. With the Cloud calls under the lock, the window is the whole collect (about
10 s), not small.

Fix direction (not done here): reread eligibility (ban, suppression, hold, age, state, opted_out) in the
same transaction after the last Cloud call and before the insert, in `propose` and in `decide`.

### SD-175. Eligibility reads the projection, not the STOP ledger

Run test `stopLedgerWindowTest`, and simulation trace (`inv_noAddAfterStop`, 16 steps):

```text
10 N=0 memberCollectCmd(b=1)        open turn (ledger opted in)
12 N=1 leaveConsent                 ledger: opted_out (AC:426); forget not run yet
13 N=1 collectBegin(b=2)            eligible = true: n.opted_out and m.state not yet changed (PS:82-86)
14-15  collectSourceCall x2
16 N=1 collectCommit                batch inserted after the ledger said opted_out
```

`stopLedgerWindowTest` gives the same with `stopLedger` (STOP) in place of the leave event. `LC:75-94`
reads the ledger; `PS:82-86` does not.

### SD-112. STOP waits on the Cloud calls under the person and member locks

Run test `stopWaitsOnCloudTest`; Apalache at depth 3; simulation trace:

```text
10 N=3 stopLedger                   STOP consent event (no lock)
11 N=3 collectBegin(b=1)            owned(): for update of n, m (PS:90); Cloud calls follow
   stopProjection is disabled until the collect ends (stopped() writes the same rows, SV:801-813)
```

### SD-240. A future Calendar row commits a batch, and the reply says nothing was saved

Run test `futureCalendarTest`, and simulation (`inv_nothingSavedIsTrue`):

```text
28 N=4 collectBegin(b=2)            row 3: Calendar, observed N+2 (allowed, PS:127-128)
29-30  collectSourceCall x2
31 N=4 collectCommit                batch 2 exists; render needs observedAt <= now (RV:12) -> null
                                     reply "Nothing new was saved" (EP:113)
```

`renderable(2)` is false until the event time, so `decide` (via `RV:51-57`) cannot reject either.

### SD-172. V1 and V2 cutoffs compare Network `created_at` with Cloud time

Three forms, all from `created_at <= revokedAt` (`PS:322`, `PS:345`) and `created_at <= cutoffAt`
(`PS:413`, `PS:437`):

```text
inv_deleteErases (Network ahead):
15 N=3 C=2 collectCommit            batch 1 created_at = 3, row 1 conn 1, pending text
17 N=3 C=2 revoke(c=1)              revokedAt = 2 (Cloud clock); batch 1 existed before the revoke
24 N=3 C=2 v1(c=1, delete)          selects created_at <= 2: batch 1 skipped, nonce used, text stays

cutoffSkewTest (Network ahead, accepted fact, retain = false):
   collect at N=2, accept, revoke at C=0, v1(disconnect) -> fact stays (inv_retainFalseGone)

inv_cutoffRespected (V2, batch made after the event):
15 N=0 C=0 cloudWithdrawEvent       cutoffAt = 0
22 N=0 C=0 collectCommit            batch 1 created after the event, created_at = 0
23 N=0 C=0 v2(withdraw)             touches batch 1 (created_at <= cutoffAt)
```

The last trace has equal clock values. With Network behind Cloud inside the skew, the same happens with
strictly later real time (the `DE:24` and `WE:21` comments forbid it).

### SD-242. V2 is refused for good when the turn's `arrived_at` is later than Cloud's `cutoffAt`

```text
 9 N=1 C=0 withdrawCmd(c=1)         arrived_at = 1 (Network clock)
10 N=1 C=0 cloudWithdrawEvent       cutoffAt = 0 (Cloud clock), recorded after the turn
14 N=1 C=0 v2(delete)               PS:386 arrived_at > cutoffAt -> null; every retry the same
```

The register marks SD-242 refuted ("no harmful trigger shown"). The model reaches it with a skew of one
tick inside the 60 s bound. Whether the upstream event delay makes this real is an upstream question.

### SD-463. Leave is three transactions; between forget and membership removal batches stay

Run test `leaveCrashTest`; simulation (`inv_leaveErases`):

```text
12 leaveConsent                     consent event (AC:426)
16 collectCommit                    batch 2 exists
25 leaveForget                      onForget (AC:427): person_id null; owned() now finds nothing
   batch 2 and its pending text stay until forgetMembership (AC:428); a crash here keeps them
```

A retried text leave does not reach `accounts.leave` (`SV:1085-1086`), so the state can stay.

### SD-170. Delete everything keeps the V1 receipts

Run test `deleteAllReceiptTest`; Apalache depth 3:

```text
revoke(c=1); v1(c=1, readback, nonce 1)   receipt row with user, org, chat, connection (PS:348-353)
deleteAll                                  memberships deleted; person kept as tombstone (PG:304-325)
                                           receipts stay: the 0040 cascades never fire
```

### SD-455. One Cloud source call per suggestion

```text
6 collectBegin(b=2, both rows on connection 2)
7 collectSourceCall                 calls = 1, until = N+2
8 collectSourceCall                 calls = 2 for one distinct connection (PS:151-153, PF:92 min)
```

The model shows the repeated call. With `SRC_TTL` ticks per proof and the calls under the lock, a
batch of more rows than the proof window allows can never commit; the model has 2 rows per batch, so it
shows the call count, not that failure.

### SD-458. Decide and delete have no replay receipt

Run test `decideRetryTest`; simulation:

```text
27 deleteBatch(b=1), reply lost     committed (PS:261)
28 retryLast                        batch() finds no row (PS:258): denied after a commit
```

For `decide` the retry fails `b.revision !== input.revision` (`PS:212`), because `PS:250` bumped it.

### SD-464. The learning-consent endpoint signs proofs with profile review off

Apalache, depth 2, and run test `consentWithoutReviewTest`:

```text
init reviewEnabled = false
memberCollectCmd(b=1); consentContext(b=1)   SV:2165 dispatches LC with no flag check
```

### SD-376. Terminal rows have no retention

```text
14 N=2 expireTick                   rows 1, 2 -> expired, text cleared (PS:456)
21 N=5                              rows still present with source, kind, connection (no purge)
```

## 4. Register ids for this module

| Id | Reproduced? | How, or why not |
|---|---|---|
| SD-112 | yes | `inv_stopNotBlockedByCloud`, Apalache depth 3 |
| SD-170 | yes | `inv_deleteAllErasesIdentity`, Apalache depth 3 |
| SD-172 | yes | `inv_deleteErases`, `inv_cutoffRespected`, `inv_retainFalseGone` (run test) |
| SD-175 | yes | `inv_noAddAfterStop` |
| SD-240 | yes | `inv_nothingSavedIsTrue` |
| SD-376 | yes | `inv_terminalRowsPurged`. The retention window is a model choice; the code has none. |
| SD-455 | yes, as the call count | `inv_oneSourceCallPerScope`. The proof-expiry failure needs more than 2 rows per batch. |
| SD-458 | yes | `inv_retryKeepsResult` |
| SD-459 | no | The model has no matcher. The code excludes source facts from matcher input (`snapshot.ts:13-17`), which is the recorded deferral. The defect is the member copy, not a state. |
| SD-462 | no | `Date.now()` at `PS:291` and `PS:368` runs only without a fence. Production always passes one (`EP:96-100`, `SV:2189`, `SV:2214`), so no state reaches it. It is a code-rule breach, not a state property. |
| SD-463 | yes | `inv_leaveErases` |
| SD-464 | yes | `inv_consentNeedsReview`, Apalache depth 2 |

Other ids reached: SD-242 (`inv_v2NotDeniedBySkew`). New: Q-profile_learning-1.

## 5. Limits of this model

- Random simulation reaches `inv_retainFalseGone` only in the run test: the trace needs a commit, an
  accept, skew, a revoke and V1 in order. Apalache at depth 4 cannot reach it either.
- Apalache depth is 3 to 4. The random simulation covers the longer traces.
- `step` weights its branches (repeated groups) so that the simulator samples long journeys. This does
  not change the transition relation.
