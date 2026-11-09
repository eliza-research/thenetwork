# State machines: connector data to profile (end-to-end journey)

Key: `gap-connector-journey`. Status: research only. Nothing here was fixed.

Earlier reports describe parts of this flow one at a time: `platform-consent.md` section 7, `network-harness.md` sections 6.4 to 6.7, and `sql-schema.md` section 3.15. No report follows one Google fact from authorization to erasure. This report does that. It reuses earlier ids and adds only what they miss:

- the journey as one product machine,
- the accepted-fact lifecycle after the suggestion row stops being the owner,
- the guard matrix for STOP, ban, hold and minor at each step,
- new defects `CJ-01` to `CJ-17`.

**How this was checked.** All claims come from reading the code. CJ-01 was also reproduced on the pure functions `renderSuggestionReview` and `parseSuggestionReview` with a scratch script. No database run was made, no external service was called, and no real LLM or Google call was made.

**Abbreviations.**

| Short | File |
|---|---|
| `PS` | `packages/network/service/profile-suggestions.ts` |
| `EP` | `packages/network/service/profile-suggestion-endpoint.ts` |
| `RV` | `packages/network/service/profile-suggestion-review.ts` |
| `DE` | `packages/network/service/profile-suggestion-disconnect-endpoint.ts` |
| `WE` | `packages/network/service/profile-suggestion-withdrawal-endpoint.ts` |
| `LC` | `packages/network/service/learning-consent-context-endpoint.ts` |
| `CO` | `packages/network/service/cloud-profile-review-owner.ts` |
| `PF` | `packages/network/service/profile-review-factory.ts` |
| `PT` | `packages/network/service/profile-review-proof-transport.ts` |
| `SV` | `packages/network/service/service.ts` |
| `AC` | `packages/platform/src/accounts.ts` |
| `PG` | `packages/platform/src/pg-store.ts` |
| `0039`, `0040`, `0041` | `packages/observatory/db/migrations/` of that number |

---

## 1. Activation boundary

The journey is dormant in production today. A model must keep this in mind.

- `NETWORK_ROUTE_AUTHORITY_POLICY` is refused outside `PLATFORM_ENV=staging` (`route-authority.ts:13`).
- `NETWORK_PROFILE_REVIEW_ENABLED=1` needs that policy, the Cloud origin and the service key (`PF:100-109`).
- Without the flag there is no identity resolver, so `EP:58` answers 503.
- `LC:32` needs a policy. Without one it answers 403.
- V1 and V2 need a route policy and a resolver (`SV:2168-2169`, `SV:2196-2197`).
- `docs/results/2026-10-17-collection-http-retention.md` says Shared's live `collect` dispatcher is disabled and no extraction runs.
- The periodic `expirePending` runs in every environment (`SV:570`), and the 0039 triggers fire in every environment.

Upstream owns the following parts. None of this code is in this repository. Each is an assumption for the model:

1. Google OAuth and the connection row.
2. The explicit consent write.
3. The Google read and the extraction.
4. The durable origin of `revokedEventId` and `withdrawalId`.
5. Any retry of `/connection` and `/withdrawal`.
6. The delivery of `reviewText`.

---

## 2. The journey on one page

```text
 Member                Eliza gateway/Cloud                 Network service + Postgres
 ------                -------------------                 --------------------------
 connects Google  -->  OAuth row (upstream)
 "collect <uuid>"  ->  /internal/turn ------------------>  turn: done, outcome=open, stored body
 (help form)           POST consent-context (marker) --->  LC: identity proof, no write
 "collect <uuid> gmail,calendar from .. until .. timezone .. fields .. retain keep|delete"
                       /internal/turn ------------------>  second open turn, stored body
                       POST consent-context (selection)->  LC: proof, 30 s, collectionExpiresAt
                       writes learning consent (upstream)
                       reads Google, extracts (upstream, disabled)
                       POST collect {proposal} --------->  EP: resolve turn, owner proof (Cloud), source proof x N (Cloud)
                                                           PS.propose: batch rev 1, rows proposed, receipt
                       <---- reviewText / "Nothing new was saved"
 sees preview     <--  sends text (upstream)
 "preview <uuid>"      POST preview -------------------->  PS.getPendingBatch
 "accept <uuid>.<rev> <n> private|matching"
 "edit ..." "reject ..."
                       POST decide --------------------->  getPendingBatch, parse, PS.decide
                                                           edit or scope change: rev+1, new preview
                                                           accept: network.facets row, rows accepted, rev+1
                                                           reject: rejected, rev+1
 "delete <uuid>"       POST delete --------------------->  batch row deleted, trigger deletes linked facets
                                                           ... time passes, expiry tick each 60 s ...
 revokes Google        POST /connection (V1) ----------->  DE, Cloud proof, PS.applyRevokedConnection
 "stop learning"       POST /withdrawal (V2) ----------->  WE, Cloud proof, PS.applyOwnerWithdrawal
 STOP / ban / hold / age drop  -->  no direct effect on suggestions or facts; "eligible" turns false
 leave / delete all    --> forget path + membership trigger: all facts and batches gone
```

Three facts shape everything else:

1. **Every member command is a turn.** Each store action needs a stored inbound turn with `status='done'` and `outcome='open'`. Authority does not come from a session or from model arguments.
2. **The clocks differ.** Network uses `Clock`. Cloud uses its own clock, inside a 60 s signature skew (`SVC_MAX_SKEW_S`, `svc-auth.ts:17`).
3. **All data flows one way, from Cloud to Network.** Network never tells Cloud about STOP, ban, leave or age drop (CJ-07). Only the gateway consent fence on the handled turn crosses back.

---

## 3. Machine index

| Id | Kind | Priority | State lives in | First described |
|---|---|---|---|---|
| connector-profile-journey | implicit, composite | P0 | product of the rows below | here |
| accepted-source-fact | implicit | P0 | `network.facets` row with id `source-suggestion:<uuid>`, plus the `accepted` row and `retain_on_disconnect` | here |
| journey-parent-turn | implicit | P0 | `platform.inbound.response`, `.status`, `network.messages.body` | here, as used by this flow |
| learning-context-proof | implicit | P0 | wire proof, 30 s | network-harness 6.7, deepened here |
| cloud-proof-chain | implicit | P0 | `transactions` WeakMap in `PF:32`, closure in `EP:69-70` and `SV:2174`, `SV:2202` | here |
| suggestion-item | explicit | P0 here | `platform.profile_suggestions.status` | platform-consent 7.1 |
| suggestion-batch | implicit | P1 | `profile_suggestion_batches.revision`, `.expires_at` | platform-consent 7.2 |
| collection-claim | implicit | P1 | `inbound.action_receipts["profile-collect:<id>"]` | platform-consent 7.3 |
| connection-cleanup-v1 | implicit | P0 here | `profile_suggestion_connection_receipts` | platform-consent 7.4 |
| owner-withdrawal-v2 | implicit | P0 here | `inbound.action_receipts["profile-withdrawal-v2:<id>"]` | platform-consent 7.5 |
| sql-profile-suggestion | explicit | P0 | the same tables, as SQL checks and triggers | sql-schema 3.15 |

Priority goes up from P1 to P0 for several rows, because consent and privacy erasure run through them.

---

## 4. Step-by-step trace

Each step gives the guard, the effect, the atomic unit and the failure behavior.

### Step 0. Authorize the connector (upstream)

There is no state here. The Network sees only a `connectionId`, and only in proposals, source proofs and cleanup requests. `parseCollectionProposal` requires a UUID (`EP:149`).

Cloud can bind one Google connection to both source types. Connection ids need not differ (`docs/results/2026-10-20-scoped-collection-contract.md`).

### Step 1. Help turn and scoped command

`collect <uuid>` parses as `help`. `collect <uuid> <scope>` parses as `collect` (`learning-collection-command.ts:55-62`). Neither text is special to the Network. It is an ordinary open turn. The parser reads the stored bytes and does not trim them.

The turn gets `outcome='open'` only if `activeMembership` passes **at turn time** (`SV:2089-2091`, `AC:319-328`):

- phone exists, is not on hold, is not stale,
- not banned,
- `canJoinApp` holds, so a 13-17 member passes this gate,
- membership `state='active'`, `review is null`,
- not suppressed,
- `optedIn` is exactly `opted_in`.

If this fails, the turn is `handled` with reason `context_unavailable`.

**Result for the journey:** a member who is stopped, banned, held, suppressed or paused gets no new open parent. No later step can use a new command from that person. See CJ-05.

### Step 2. Consent context (`LC`, process boundary, read-only)

Trigger: Cloud. Signature id `<messageId>:learning-consent:<nonce>` (`LC:30`). One transaction with `for share` locks. No writes.

Checks in order:

1. Route current (`LC:32-34`).
2. Person from stored `sender_hash` (`LC:39`).
3. Adult, active or onboarding, no review, no ban, no suppression, no hold (`LC:44-52`).
4. Turn `done` and `open`, same app and member, parent age below 5 min, route, command hash (`LC:54-62`).
5. Command batch id (`LC:63-64`).
6. Selection joined to stored scope, or the exact entry marker (`LC:65-69`).
7. Exactly one phone identity (`LC:72-73`).
8. **The STOP ledger read** (`LC:75-81`), and again after signing (`LC:94`).

Proof life: `min(issued+30 s, arrived+5 min, arrived+24 h, admitUntil, pendingExpiresAt, selection.expiresAt)` (`LC:84`).

The endpoint is safe to repeat. A crash loses nothing. It proves a bounded observation, not a promise about the future. Comment at `LC:92-93` says so.

**The proof is not joined to step 3.** The Network stores no record of it. `selectionSha256` never reaches `PS`. The link from consent to collection exists only inside Cloud and in the per-suggestion source proof. A model must treat "Cloud checks source consent" as an assumption.

### Step 3. Collect (`EP` then `PS.propose`)

Trigger: Cloud. Signature id `<messageId>:suggestions:collect`. It is a member-origin action, but no member is on the wire at this moment.

| # | Check | Transaction | Where |
|---|---|---|---|
| 1 | HMAC, exact keys, proposal shape, command parse | none | `EP:51-67` |
| 2 | `resolve`: route, turn, person, stored body equals `text`, proposal equals stored scope | T1 | `EP:72-85` |
| 3 | owner proof: stored turn, parent below 5 min, Cloud round trip | T1 | `CO:21-63`, `PF:66-74` |
| 4 | `PS.propose` shape, `valueOK`, tags, claim format | none | `PS:118-134` |
| 5 | `owned`: person lock, then member and membership lock | T2 | `PS:78-90` |
| 6 | owner proof again, under the locks | T2 | `PS:91`, `EP:101-104` |
| 7 | `member.eligible` | T2 | `PS:137` |
| 8 | stored turn again, under `for update of i` | T2 | `PS:142-149` |
| 9 | source proof, **once per suggestion** | T2 | `PS:151-153`, `PF:75-95` |
| 10 | receipt lookup and replay branch | T2 | `PS:161-180` |
| 11 | insert batch, rows, receipt, then `view` | T2 | `PS:182-190` |
| 12 | render | none, **after commit** | `EP:111-113` |

Batch `created_at` is the `now` captured at `EP:109`, before the lock wait.

**Five-minute rule.** The turn stays valid for review for 24 h by `networkCollectionDeadline`, but the collect call itself must finish within 5 min of arrival (`CO:52`). Extraction therefore has a hard 5 min budget. The 24 h limit is only the pending lifetime. A batch is not replayable after 5 min.

**Crash windows.**

- Before T2 commit: nothing is stored.
- After T2 commit and before the response: the batch exists, and a replay returns the preview for up to 5 min.
- After that, `preview <uuid>` still works until expiry.

**Failure outcome that lies.** See CJ-01: when step 12 fails, the batch is committed and the reply says nothing was saved.

### Step 4. Preview

`getPendingBatch` runs `batch()` and `view()`. It does not read `eligible` (`PS:96-103`, `PS:194-202`). A past-expiry batch writes `expired` and returns null, and that write commits.

### Step 5. Decide

`reviewSuggestionMessage` runs two transactions (`RV:51-57`):

1. `getPendingBatch` and `parseSuggestionReview`.
2. `decide`.

The second transaction rechecks revision, expiry, row status and owner, so the gap between them is safe.

Costs per accept: 1 owner call in `resolve`, 1 in `getPendingBatch`, 1 in `decide`, 1 source call.

| Command | Row effect | Facet effect | Revision | Source proof | `eligible` |
|---|---|---|---|---|---|
| `accept tok n <same scope>` | `accepted`, value null, `fact_id` set | insert `source-suggestion:<id>`, `provenance='inferred'`, `status='confirmed'` | +1 | yes | yes |
| `accept tok n <other scope>` | scope changes, stays `proposed` | none | +1, new preview | yes | yes |
| `edit tok n: text` | value changes, tags cleared | none | +1, new preview | yes | yes |
| `reject tok n` | `rejected`, value null | none | +1 | no | no |

All writes for one command are in one transaction. `checkAuthority` runs after the writes, so a fence failure throws and rolls back (`PS:237`, `PS:251`).

The fence is checked before commit, not at commit. A proof can expire between the last check and the COMMIT. The gap is small and has no safety effect, because the source proof was true when read.

### Step 6. Accepted fact: who reads it

Only one production path writes it (`PS:241`). The readers:

| Reader | Sees it? | Where |
|---|---|---|
| `loadSnapshot` default: matcher, planner, embeddings, judges, shadow runs | no | `snapshot.ts:13-17`, `:89-92` |
| weekly bias aggregation, adult verification tags | no | `SV:544`, `SV:1582` |
| `purpose: 'profile_review'` snapshot | yes, but **no production caller**, tests only | `snapshot.ts:89`, `profile-suggestions.integration.test.ts:36` |
| `open.context` | no, it reads a snapshot and only shareable scope; these facts are private or matchable | `AGENTS.md`, `snapshot.ts` |
| `exportMember` | only `matchable`; `agent_private` is left out | `SV:834` |
| Observatory member detail | yes; `agent_private` masked unless revealed, others scrubbed | `real.ts:606`, `scrub.ts:54-58` |

So an accepted fact is effectively write-only in the product. The `matching` choice has no effect (CJ-10).

### Step 7. Time

`expirePending` runs each tick, every 60 s, at most 100 batches per app, per tick (`PS:449-459`, `serve.ts:107`, `serve.ts:134`). It uses `skip locked`. It erases values only. It does not bump the revision. Accepted rows and facets are not touched.

### Step 8. Disconnect, V1

Trigger: Cloud, after the OAuth revoke. Signature id `connection-cleanup:<nonce>`. No member and no open turn are needed.

1. `DE` verifies the HMAC, then calls `resolveRevokedOwner`, then parses the proof (`DE:46-59`).
2. `SV:2198-2216` builds a dedicated store whose source authorizer is always false.
3. `PS:287-361` runs one transaction:
   - `owned`, which refetches the proof,
   - read the receipt,
   - apply to batches with `created_at <= revokedAt`,
   - count,
   - insert the receipt with its result,
   - `owned` again.

`owned` returns a row for a stopped, banned, held or minor member, because cleanup reads only the row, not `eligible`. It returns nothing for a removed or deleted person, so V1 answers 403.

Limits (existing findings): one app, one chat per request (PC-14). Two clocks (PC-15, bounded by the 60 s skew).

### Step 9. Withdrawal, V2

Trigger: Cloud, after its canonical owner event. Signature id `learning-withdrawal:<nonce>`.

The same shape as V1, with these differences:

- The proof must name a stored `done`, `open` turn with the same command hash (`PS:378-387`).
- `arrived_at <= cutoffAt` (`PS:386`, see CJ-04).
- The route check is repeated on the turn (`SV:2178-2179`).
- `withdraw` changes `proposed` rows only (`PS:419`).
- `delete` removes rows and facts.
- `readback` writes no receipt (`PS:395`, `PS:439`).

### Step 10. Leave, delete everything, new owner

`AC.leave` (`AC:420-429`):

1. Writes the consent event.
2. Runs `hooks.onForget`. This calls `forget`, and the runtime unit deletes all member facets, seals turns, deletes messages and sets `person_id=null` (`runtime.ts:521-551`).
3. Calls `forgetMembership`, which sets `state='removed'`. The trigger then deletes batches (`0039:61-72`), and `remove_suggestion_facts` runs (`0039:51-58`).

These are two transactions. See CJ-14.

`deleteAll` is the same, with `delete from platform.memberships`. `clearHold(new_owner)` reuses it (`AC:194-221`).

---

## 5. Guard matrix: STOP, ban, hold, minor at each step

`yes` means this step reads the fact and refuses. `no` means it does not read it. "turn" means the parent turn read it, up to 5 min earlier.

| Step | STOP ledger | `opted_out` projection | ban | suppression | hold | minor | membership | other |
|---|---|---|---|---|---|---|---|---|
| parent open turn | yes (`optedIn`) | no | yes | yes | yes, plus stale phone | no, 13+ passes | `active` only, `review` null | `AC:319-328` |
| consent context | yes, twice | yes | yes | yes | yes | yes | `active` or `onboarding`, `review` null, `m.member_id` bound | single phone required |
| propose | **no** (PC-18) | yes | yes | yes | yes | yes | `active` or `onboarding`, `review` null | source proof |
| preview | no | no | no | no | no | no | not `removed` | owner proof |
| accept, edit, scope change | **no** (PC-18) | yes | yes | yes | yes | yes | as propose | source proof |
| reject | no | no | no | no | no | no | not `removed` | owner proof |
| delete batch | no | no | no | no | no | no | not `removed` | owner proof |
| V1 | no | no | no | no | no | no | not `removed` | revoked proof |
| V2 | no | no | no | no | no | no | not `removed` | open turn, withdrawal proof |
| expiry tick | no | no | no | no | no | no | none | none |

Design reading: **deny entry, permit exit**. Adding data needs full eligibility. Reading your own pending data, rejecting and deleting need only ownership. This is correct and is tested at store level: `a canonical ban blocks promotion but permits deleting owned suggestions` (`profile-suggestions.integration.test.ts:269`) and `absent learning permission denies saving but keeps private preview, rejection and deletion usable` (`:656`).

The gap is reachability. Exit by text needs a fresh open parent, and only the first row of this table creates one (CJ-05).

Differences between the three "eligibility" readers:

| Fact | parent turn | consent context | `owned` |
|---|---|---|---|
| ledger or projection | ledger | both | projection |
| `onboarding` allowed | no | yes | yes |
| two phone identities | checks the sender's phone | fails closed | not checked |
| `m.member_id=n.id` | yes (via membership) | yes | **no** (PC-17) |

Because the parent must be `active`, the `onboarding` branch in `LC:48` and `PS:83` cannot be reached by a new turn over HTTP. This is a harmless dead guard (CJ-13).

---

## 6. Machine: connector-profile-journey

**Kind:** implicit, composite. **Priority:** P0.

**Per-fact state.** Follow one extracted value, keyed by `(connection, batch, suggestion)`.

| State | Meaning | Text lives in |
|---|---|---|
| `J0_none` | no row | Google only |
| `J1_extracted` | upstream memory, proposal in flight | upstream, request body |
| `J2_pending` | `proposed`, not expired | `profile_suggestions.value` |
| `J2x_stranded` | committed but cannot render (CJ-01) | `profile_suggestions.value` |
| `J2e_pending_past_expiry` | `proposed`, expiry passed, tick not yet run | `profile_suggestions.value` |
| `J3_rejected`, `J3_expired`, `J3_withdrawn` | terminal, no text | nowhere |
| `J4_fact_linked` | `accepted`, facet exists | `network.facets.value` |
| `J4r_fact_retained` | as J4, with `retain_on_disconnect=true`, and connection revoked | `network.facets.value` |
| `J4o_fact_orphan_row` | `accepted`, `fact_id` null, facet gone (FK `on delete set null`, `0039:36`) | nowhere |
| `J5_erased` | row and facet gone | nowhere |

**Actor states, in parallel.**

- `connection`: `active`, `revoked`, `reconnected`.
- `learningConsent`: `absent`, `granted`, `cleared`. Upstream.
- `member`: `eligible`, `stopped`, `banned`, `held`, `minor`, `removed`, `deleted`.
- `route`: `admit`, `drain`, `closed`.

**Transitions.**

| From | Event | Actor | Guard | To | Where |
|---|---|---|---|---|---|
| J0 | collect | other service, from member turn | Step 3 guards | J2 | `PS:182-190` |
| J0 | collect, future calendar row | other service | as above, `observedAt > now` | J2x | `PS:128`, `RV:12` |
| J2 | clock | clock | `expires_at<=now` | J2e | none, implicit |
| J2e | tick, read, decide | cron or member | none | J3_expired | `PS:107`, `PS:209`, `PS:456` |
| J2 | accept | member | eligible, source proof, revision | J4 | `PS:239-243` |
| J2 | edit or scope change | member | eligible, source proof | J2, rev+1 | `PS:226-233` |
| J2 | reject | member | owner, revision | J3_rejected | `PS:246` |
| J2 | V1 disconnect | other service | cutoff, chat | J3_withdrawn | `PS:332` |
| J2 | V1 delete | other service | cutoff, chat | J5 | `PS:331` |
| J2 | V2 withdraw | other service | cutoff, chat, open parent | J3_withdrawn | `PS:424` |
| J2 | V2 delete | other service | same | J5 | `PS:422` |
| J2 | delete batch, leave, delete all | member | owner | J5 | `0039:51-72` |
| J4 | V1 disconnect, retain=false | other service | cutoff, chat | J3_withdrawn, facet deleted | `PS:330-333` |
| J4 | V1 disconnect, retain=true | other service | | J4r | `PS:329` |
| J4 | V2 withdraw | other service | | J4, no change | `PS:419` |
| J4, J4r | V1 delete, V2 delete | other service | | J5 | `PS:330-331`, `PS:421-422` |
| J4, J4r | delete batch, leave, delete all | member | | J5 | `0039:51-58`, `runtime.ts:538` |
| J4 | facet deleted by other path | service | | J4o | `0039:36` |
| any | STOP, ban, hold, age drop | member, staff | | same; guards close | none |

**Terminal states:** `J3_*`, `J4o`, `J5`. `J4` and `J4r` have no clock exit. A retained fact stays until the person acts (see CJ-05 for how they can act).

**Invariants.**

| Id | Statement | Rule | Status |
|---|---|---|---|
| J-1 | A facet from a source exists only after an exact human accept at the current revision, by an eligible adult, with a live source proof | PRD review; `RV:51` | holds, except PC-18 window |
| J-2 | Source text never enters matcher input, pending or accepted | SUG-4, `snapshot.ts:13` | holds |
| J-3 | Pending text does not outlive `expires_at` plus one tick cycle, unless backlog exceeds 100 batches per app per tick | retention | holds |
| J-4 | After V1 `disconnect` at cutoff C for (app, chat, connection): no `proposed` rows, and no accepted rows with `retain=false`, in batches created at or before C | INV-CC, `RV:23` copy | fails for other chats (PC-14) and near C (PC-15) |
| J-5 | After V1 or V2 `delete` at C: no rows and no facets in that scope | INV-SG6 | same limits |
| J-6 | After leave or delete everything: no batches, rows or linked facets | `0039:60` | holds on success, see CJ-14 |
| J-7 | A replay never recreates an erased suggestion | collection-claim | holds |
| J-8 | A mutation and its receipt commit together | INV-CC1 | holds |
| J-9 | A cleanup never needs an active source grant | INV-CC4, README | holds |
| J-10 | A reply saying nothing was saved means nothing was saved | `EP:113` | **fails**, CJ-01 |
| J-11 | Every committed batch can be reviewed and rejected by its owner until expiry | PRD review | **fails**, CJ-01 |
| J-12 | Privacy cleanup stays available while rows that need it exist | README, `SV` | **fails** past `admitUntil`, CJ-02 |
| J-13 | Minors (13-17) never add or accept source data | age policy | holds |
| J-14 | A person who says STOP adds no source data, by the ledger | PRD 40.3 | fails in the PC-18 window |

**Liveness.**

- L-1: every `proposed` row reaches a terminal state. Holds through the tick, while the tick runs.
- L-2: every cleanup request that Cloud retries completes. Fails: CJ-02, CJ-04, PC-16.
- L-3: a member who wants a retained fact gone can do it. Holds through `leave` and delete everything, partly through text (CJ-05).

---

## 7. Machine: accepted-source-fact

**Kind:** implicit. **Priority:** P0. **State:** the pair `(network.facets row, profile_suggestions row)`, read with `profile_suggestion_batches.retain_on_disconnect`.

This is the question earlier reports leave open. A suggestion row stops owning the text at accept, but it keeps the delete link through `fact_id`. So the facet is erased by three different owners.

### 7.1 What happens to a fact already accepted

| Event | `retain=true` fact | `retain=false` fact | Row after | Evidence |
|---|---|---|---|---|
| batch expiry | stays | stays | `accepted` | `PS:107` filters `proposed` |
| STOP, global or per line | stays | stays | `accepted` | no reader in `stopped`, `SV:801-813` |
| START | stays | stays | `accepted` | none |
| ban | stays. `dropRatings` removes ratings only | stays | `accepted` | `SV:1753` |
| hold, `same_owner` | stays | stays | `accepted` | `AC:199` |
| hold, `new_owner` | deleted | deleted | gone | `AC:204-209` |
| age drop below 18 | **stays**. Photos and ratings are deleted | **stays** | `accepted` | `SV:779`, CJ-06 |
| V1 `disconnect` | stays | deleted | `accepted` / `withdrawn` | `PS:329-333` |
| V1 `delete` | deleted | deleted | gone | `PS:330-331` |
| V1 `readback` | stays | stays | unchanged | `PS:328` |
| V2 `withdraw` | stays | **stays**, unlike V1 | `accepted` | `PS:419`, test `:319` |
| V2 `delete` | deleted | deleted | gone | `PS:420-422` |
| `delete <batch>` | deleted | deleted | gone | `0039:51-58` |
| `leave <app>` | deleted | deleted | gone | `runtime.ts:538`, `0039:66` |
| delete everything | deleted | deleted | gone | `0039:63`, `PG:304-325` |
| reconnect, then new batch | old facts unchanged | unchanged | new rows only | cutoff `PS:322` |
| chat binding moves | stays, no text path can reach it | stays | `accepted` | PC-14 |

V2 `withdraw` followed by V1 `disconnect` removes a `retain=false` fact, because V1 still sees the row as `accepted`. This matches the preview text. The order does not matter for the end state.

### 7.2 Invariants

- AF-1: `source-suggestion:<id>` facet exists only if a row with that id reached `accepted`. One row makes at most one facet, since the id is the primary key and `s.status` is locked.
- AF-2: while `accepted`, `fact_id` is non-null, unless the facet was removed elsewhere. Then `J4o` is harmless, because a later delete has nothing to do.
- AF-3: no other production code path selects these facets for automated use.
- AF-4: `retain_on_disconnect` is immutable after batch insert. Verified: only `PS:183` writes it. So the choice shown in the first preview is the choice at disconnect.

### 7.3 Concurrency

- Accept against V1: both take the person lock. If accept wins, V1 sees `accepted` and applies retention. If V1 wins, the row is not `proposed`, so accept denies. Safe.
- Accept against delete batch or leave: person lock first, safe. `deleteBatch` uses the row and the trigger in one transaction.
- Late V1 after reconnect with the same `connectionId`: a member can accept an old pending row during the gap between revoke and V1, because the source proof is true again. V1 then removes it when `retain=false`, or keeps it when `retain=true`. Low impact, and it matches a strict reading of the cutoff. Model it. Do not call it a defect.

---

## 8. Machine: cloud-proof-chain

**Kind:** implicit. **Priority:** P0.

| Proof | Life | Bound to | Issued for | Checked |
|---|---|---|---|---|
| consent context | at most 30 s, parent 5 min | request hash, nonce, selection hash, command hash, route | Cloud consent write | `LC`, then upstream |
| owner | at most 30 s | selector hash, nonce, batch, action, command hash, route | each store transaction | `CO:59-62` |
| source | at most 5 s | request hash, nonce, full consent scope | each accept or collect row | `PF:87-93` |
| revoked owner | at most 30 s | body hash, event, operation, `connectionState='revoked'` | V1 | `PF:38-50`, `SV:2204-2213` |
| withdrawal | at most 30 s | body hash, withdrawal id, message, command hash, cutoff | V2 | `PF:51-62`, `SV:2176-2188` |

**State per transaction.** `transactions: WeakMap<tx, {turn, owner, ownerUntil, sourceUntil}>` (`PF:32`). `sourceUntil` only falls (`PF:92`). `profileSuggestionIdentity` deletes the entry and sets a new one on each call (`PF:67-72`). So a second `resolve` in the same transaction resets `sourceUntil` to Infinity. The comment at `PS:165-166` explains why replay avoids that second call. Verified: the replay path does not call `owned` a second time.

**V1 and V2 keep the first proof as a hard limit.** The `valid` closures in `PS:290-296` and `PS:367-370` parse the original proof. A refreshed proof does not extend it. Refresh only shortens authority.

**Transport.** One attempt, 3 s, no redirect, signed reply with id `<id>:proof` (`PT:15-39`). A failed call returns null, and the caller denies. A 16 KiB cap applies. No cache. Fail closed everywhere.

**Assumptions to state in the model.** Cloud must answer repeated proof calls with the same `connection-cleanup:<nonce>` and `learning-withdrawal:<nonce>` ids, because the Network calls them up to three times per request (`SV:2206`, `SV:2180`). If Cloud treats a repeated signature id as a replay, V1 and V2 fail. Upstream is not in this repository, so this is not verified.

---

## 9. Concurrency and failure summary

| Scenario | Result |
|---|---|
| Two identical collects at once | Person lock serializes. Second sees the receipt and returns the preview. |
| Collect replay after a decision | Denied (`PS:170-172`). |
| Crash inside any store transaction | Full rollback. |
| Crash after commit, before the reply | Collect: replay works for 5 min. Decide and delete: retry is denied (CJ-08). V1, V2: exact retry returns the stored counts. |
| Duplicate V1 nonce, other owner | `on conflict do nothing`, throw, rollback (`PS:355`). |
| V1 and V2 at once | Person lock. Order changes nothing for `delete`. |
| STOP during collect | Ledger write does not wait. `stopped` waits on the row lock (CJ-15). If collect commits first, the batch exists and accept is denied later. |
| Ban during accept | `platform.bans` is not locked. Accept can read no ban and commit just after. Small window. Facts do not reach matching. |
| Leave during V1 | Person lock. If leave wins, V1 is denied. If V1 wins, leave removes the rest. |
| Expiry during decide | `PS:208` rechecks after the lock. Proof fence covers the rest. |
| Clock skew | Bounded by 60 s for signed calls. PC-15 and CJ-04 are inside this bound. |
| Tick against review | `skip locked`, so a locked batch waits for the next tick. |
| Inbox purge at 7 days | Receipts are sealed. V2 and collect then deny. Batches do not depend on the turn. |
| Forget seals turns | `action_receipts` cleared, `status='unresolved'`. No join matches. Replay stays impossible. |

**Lock order.** Person, then member and membership, then inbound, then batch, then rows. `PS` holds it. `LC` uses `for share` in the same order. `expirePending` skips locks, so it cannot deadlock on batches.

**Grants.** Checked and safe: `for update of i,msg` at `PS:382` needs UPDATE on `network.messages`. `0004:138` grants it. `for share` in `LC` needs the same on `people`, `memberships`, `phone_identities`, which `network_service` inherits through `platform_service` (`0007:241`). The receipt table has SELECT and INSERT only, and V1 does not lock it (`PS:303`).

---

## 10. Suspected defects

"New" defects have ids `CJ-*`. Earlier ids are listed in section 10.2 and are not repeated.

### 10.1 New

#### CJ-01. A future Calendar row strands a committed batch, and the reply says nothing was saved

**P1. Confidence: high. Reproduced on the pure functions.**

- `PS:128` rejects a future `observedAt` for Gmail only. A future Calendar start is valid by design. `docs/results/2026-10-20-scoped-collection-contract.md` says so, and the tests at `profile-suggestions.integration.test.ts:73` and `:168` store it.
- `RV:12` requires `s.observedAt <= now` for **every** row, with no source check.
- `currentBatch` false makes `renderSuggestionReview` return null (`RV:18`) and `parseSuggestionReview` return null (`RV:35`).

Sequence:

1. Member sends `collect <uuid> calendar from <now> until <now+7d> ... retain delete`.
2. Cloud posts a proposal with one event tomorrow, and possibly Gmail rows.
3. `PS.propose` commits the batch, the rows and the receipt.
4. `EP:111` renders null. `EP:113` returns 403 with `I couldn't collect those suggestions. Nothing new was saved.`
5. Replay: the same.
6. `preview <uuid>`: `EP:126-127` denied.
7. `accept`, `edit`, `reject`: `RV:54-55` return null, so denied. **Reject is blocked**, and so are the Gmail rows in the same batch.

The batch stays until expiry (24 h at most), or until the event time passes inside that window. Then it appears without warning. The only exit is `delete <uuid>` or a cleanup.

Script result in the scratchpad: past row `render ok`, future row `render NULL, reject parse NULL`, mixed batch `render NULL, reject parse NULL`.

Test gap: both future-Calendar tests stop at the store. HTTP vectors use windows that end on 2026-10-08, before the test `now` of 2026-10-17, so no HTTP test has a future row.

Breaks J-10 and J-11.

#### CJ-02. Privacy cleanup and owner delete stop at `admitUntil`, not `drainUntil`

**P1. Confidence: high on behavior. Staging only today.**

- `SV:2168` and `SV:2196`: `current` is `now < admitUntil`. Failing answers 503.
- `PF:42`, `PF:55`: the same check before the proof call.
- `CO:28`, `EP:107`: the same for preview, reject and delete.
- `disconnect test:242` pins the 503 as intended.

`core.md` and `network-service-inbound.md` describe `admitUntil <= now < drainUntil` as the phase that serves rows that already exist. Cleanup serves only rows that already exist. README line 120 says that review, reject, delete and revoke cleanup "remain independent of collection permission".

Sequence: route closes admission. Member revokes Google. Cloud posts V1. Answer: 503, always. `retain=false` facts stay in `network.facets`. Copy at `RV:23` said they would be removed.

Same problem on rotation: V2 and review need the stored turn's `network_authority` to equal the policy authority (`SV:2178`, `EP:76`). A new generation makes old turns unusable.

What still works: `expirePending`, `leave`, delete everything. Pending text is safe. The exposure is accepted `retain=false` facts.

Breaks J-12 and L-2.

#### CJ-03. One batch shares the earliest 5 s source proof, and each row makes its own Cloud call

**P2. Confidence: high.**

- `PS:151-153` loops over suggestions with no deduplication. Ten rows from one connection send ten identical scopes.
- `PF:92`: `entry.sourceUntil = min(...)`.
- `profile-review-source.ts:68`: a proof lives at most 5 s.
- `PF:86`: each call checks `current`, including `sourceUntil`.

Sequence: 10 suggestions, Cloud latency 600 ms. The first proof expires at about 5 s. The 9th call fails `current`. `propose` returns null. Reply: "couldn't collect". A retry has the same result. The Cloud budget is about 500 ms per row, for a full batch.

Each round trip also runs under the person lock (PC-19). One call per distinct `(connection, source)` removes both problems.

#### CJ-04. V2 compares `arrived_at` with `cutoffAt` across two clocks, and a denial is permanent

**P1. Confidence: medium.**

- `PS:386` returns null when `turn.arrived_at > proof.cutoffAt`.
- `arrived_at` is the Network clock, and it renews during a running turn (`inbox.ts:111`).
- `cutoffAt` is Cloud's event time, immutable (`SV:2182`).

Sequence: Cloud runs 2 s behind the Network, inside the 60 s skew. Member says "delete what you learned from Gmail" at Network time T. Cloud records the event 1 s later at Cloud time T-1. Cloud clears consent. V2 arrives. `T > T-1`, so denied. Every retry has the same two values.

Result: Cloud believes the withdrawal exists, and the Network never applies it. Pending rows expire on their own, but with `delete`, accepted facts stay.

Note the difference from PC-15: that is a skipped batch and a used nonce. This is a permanent denial with no nonce used.

Impact depends on real skew and on the delay between arrival and event, which includes an LLM read, so it needs a skew of several seconds.

#### CJ-05. A stopped, banned or held person has no text route to review delete or V2

**P2. Confidence: high on behavior. The impact is a policy question.**

- `EP:75` needs `outcome='open'`.
- `PS:383` needs `outcome='open'` for V2.
- `SV:2089-2091` gives `open` only with `activeMembership`.
- `AC:324-327` refuses ban, suppression, non-`active` state and anything but `opted_in`. STOP moves `active` to `paused` (`SV:804`).
- `CO:52` limits the parent to 5 min.

So the store-level promises cannot be reached by HTTP after 5 min:

- the test `a canonical ban blocks promotion but permits deleting owned suggestions` (`:269`),
- the status table entry "any | deleteBatch | owner, also when banned" in `network-harness.md` 6.4.

`RV:23` tells the member "keep accepted facts until you delete them".

What still works: `leave <app>` (a handled keyword path, removes the whole app), delete everything, V1 `delete` if the connection is revoked, and help@ntwrk.party. PC-31 notes delete everything stays open to a banned person. So a person is not trapped, but cannot remove one Google-derived fact without losing the whole app.

STOP then START restores the route, since START opts back in.

#### CJ-06. Age drop wipes photos and ratings, but keeps Google data

**P1. Confidence: high on behavior. Whether it is wrong is a founder question.**

- `SV:779`: below 18, `photos.deleteFor` and `dropRatings` run.
- `SV:776-785` has no suggestion or facet cleanup. `PS` has no age hook.

Sequence: adult accepts Gmail facts. Person states age 16 in any app. `n.age` and `lowest_age` drop. Pending rows stay until expiry, and preview still shows them. Accepted facts stay for as long as the membership lasts. Learning consent stays in Cloud (CJ-07).

The rule "adults only" is stated for collection through `eligible`, and AGENTS rule 8 says minors are never matched. Facts do not reach matching. But the same person has their photos and ratings removed "for adults only", and the source-derived facts of an adult-only flow are treated differently.

`PC-06` adds that a web statement under 13 keeps other memberships, so their batches stay as well.

#### CJ-07. No signal goes from the Network to Cloud on leave, delete, ban, STOP or age drop

**P2. Confidence: high about this repository. Upstream is not verified.**

- The transport allows only four proof paths (`PT:17`). All are Network-pull.
- `serve.ts:100-102`: `onForget` revokes MCP grants only.
- The consent field on a handled turn is a send fence. It does not carry learning state.

Sequence: member accepts facts, then leaves. Network erases them. Cloud keeps the connection and the learning consent. After a rejoin, Cloud still holds consent. A new collect needs a fresh explicit command, so no data enters without a human act. The exposure is a stale upstream consent record, and a connection the person may think is gone.

Related: PC-26 (OAuth grants outlive decline and delete).

#### CJ-08. Decide and delete have no replay receipt

**P2. Confidence: high on behavior. Impact depends on Cloud retries.**

Collect, V1 and V2 all return the original result on retry. `decide` does not. It bumps the revision (`PS:250`), so a retry fails `b.revision !== input.revision` (`PS:212`). `deleteBatch` removes the row, so a retry fails `batch()` (`PS:258`).

Sequence: `accept` commits. The reply is lost at the 3 s or 8 s limit. Gateway retries with the same signature id. Reply: "I couldn't apply that review." The fact is saved, and the member is told it is not.

Safe in data terms. Wrong in the message. A second member attempt with the old token fails as well.

#### CJ-09. Export leaves out private accepted facts and all pending rows

**P2. Confidence: high.**

`SV:834` filters `privacy_scope <> 'agent_private'`. That rule hides ratings. It also hides each accepted fact the member saved as `private`. `exportMember` never reads the suggestion tables. So a member's export does not show Gmail-derived facts that the member chose to keep private.

Extends PC-34.

#### CJ-10. The `matching` scope choice has no effect, and accepted facts have no product reader

**P2. Confidence: high. Intended today, but the member copy says otherwise.**

`snapshot.ts:13-17` excludes all Google facts from every automated input. `purpose: 'profile_review'` has no production caller. `RV:24-25` still offers "private — or matching", and an accept with `matching` saves `matchable`. Scope change costs a revision and a source proof, and changes nothing the product does.

`docs/results/2026-10-20-scoped-collection-contract.md` records the deferral on purpose. Keep this in the model as a guard that a later change could remove.

#### CJ-11. `reviewText` does not pass the leak guard in this repository

**P2. Confidence: medium. Upstream delivery was not read.**

`AGENTS.md` says that every outbound message must go through the leak check. `EP` builds text with source-derived values and returns it to Cloud. No file in scope calls `checkThread`, `guard` or `LEAK_LABEL_KEY`. Verified by search. `valueOK` removes URLs, emails, phone-like strings and sensitive terms (`PS:51-54`). It does not remove names. So "Dinner with Sarah from work" passes.

The text goes only to its owner's private chat, and only that owner's data appears, so a leak to another member is not the risk. Whether the gateway applies a guard is upstream.

#### CJ-12. V2 fails closed at 16 action receipts, while V1 has no such limit

**P2. Confidence: high on code. Low likelihood.**

`PS:406` returns null at 16 receipts on the parent turn. `SV:1899` and `relay-endpoint.ts:200` share this budget. A turn with 16 prior actions cannot carry a privacy withdrawal. A privacy exit should not depend on an action budget. V2 `readback` is exempt. V1 is not on the turn at all.

#### CJ-13. Dead and non-conforming branches

**P2. Confidence: high.**

- `PS:291`, `PS:368`: `this.fence?.now() ?? Date.now()`. AGENTS forbids `Date.now()` in network code. Unreachable in production, since `SV` passes a fence, but it is a breach of the stated invariant.
- `PS:268` `disconnect()`: no production caller. Its tests (`profile-suggestions.integration.test.ts:133`, `:210`) cover behavior that production V1 does not have, such as all chats. PC-14 already notes this.
- `propose` without `claim`: no production caller. `EP:109` always passes one.
- `m.state in ('active','onboarding')` (`PS:83`, `LC:48`): `onboarding` cannot be reached by a new open turn (`AC:326`).

#### CJ-14. Leave is two transactions, and a crash leaves batches unreachable

**P2. Confidence: medium.**

`AC:427-428` runs `onForget`, then `forgetMembership`. A crash between them gives:

- facets gone, `network.members.person_id` null,
- membership still `active`,
- batches and rows still present, with pending text.

Then `owned` joins through `p.id=n.person_id` and finds nothing, so review, V1 and V2 all deny. The tick still erases pending values. Rows remain without text.

Retry of text leave: `SV:1085` reads `lrt.memberOf(ev.from)`, and the forget path deleted that identity. If `lid` is undefined the `if (lrt && lid)` branch at `SV:1086` skips `accounts.leave`. So the membership may stay `active`. This was checked by reading, not by a run. Delete everything still clears it.

Data effect is small: no text after the tick and no facts. The main effect is an active membership that points at an erased member.

#### CJ-15. STOP waits on the suggestion row lock during Cloud calls

**P1. Confidence: medium. Extends PC-19 with the STOP path.**

`owned` holds `for update of n, m` (`PS:90`) across Cloud calls (`PS:91`, `PS:151`). `stopped` writes the membership and the member row (`SV:804`, unit at `SV:806-809`).

Worst case for collect: 3 s owner, then source calls until the 5 s proof limit, then commit. About 10 s. For V1: up to three 3 s calls. AGENTS gives `/internal/turn` 8 s.

The consent event is a separate insert and does not wait, so the ledger is safe. The reply and the projection can be late. Together with H-01 (STOP refused while a turn is processing), this widens the STOP path under load. PC-18 then applies to the same window.

#### CJ-16. `learning-consent` runs when the review flag is off

**P2. Confidence: high. No data effect.**

`SV:2165` dispatches `LC` with no check of `NETWORK_PROFILE_REVIEW_ENABLED`. With a route policy and no flag, `LC` signs proofs, and Cloud may record consent, while `collect` answers 503. Consent then exists with no possible collection. Harmless on data, but a state pair that a Quint model should allow.

#### CJ-17. Trigger cleanup depends on a superuser migration owner

**P2. Confidence: low. Conditional. Current docs avoid it.**

`remove_suggestion_facts` is `security definer` (`0039:51`). `network.facets` has FORCE RLS, with a policy for `network_service` only (`0004:131-138`). A definer that is a plain table owner would match no policy, and the delete in `0039:53` would remove 0 rows with no error. The batch delete would still succeed, and `EP:117` would report "Deleted these suggestions and their linked saved facts."

`docs/deploy.md:48` runs migrations as the `postgres` superuser, which bypasses RLS, so this does not occur today. But `backend.ts:54` says "the owner or a superuser". Tests run as a superuser, so they cannot detect it. Add a boot check, or an explicit policy, if the owner ever changes.

### 10.2 Earlier findings that apply on this journey

| Id | Effect on the journey | Step |
|---|---|---|
| PC-13 | Connection receipts keep Cloud identity after delete everything | 8, 10 |
| PC-14 | V1 and V2 touch one chat. `retain=false` facts stay in other chats | 8, 9 |
| PC-15 | V1 and V2 batch cutoff across clocks, bounded by 60 s skew | 8, 9 |
| PC-16 | Exact retry denied after leave | 8 |
| PC-17 | `owned` does not bind `m.member_id=n.id` | 3, 5 |
| PC-18 | `propose` and accept read the projection, not the ledger | 3, 5 |
| PC-19 | Cloud calls under the person lock | 3, 5, 8, 9 |
| PC-26 | OAuth grants outlive deletion | 10 |
| PC-31 | Delete everything is open to a banned person | 10 |
| PC-32 | Terminal rows and empty batches have no retention | all |
| H-01 | STOP refused while a turn processes | STOP |
| network-harness section 7, "arrival is also the lease" | `arrived_at` moves during a turn. Stable after `done`, so the collection deadline is stable once a parent can be used. | 2, 3 |

---

## 11. Quint modelling notes

**Recommendation.** One module, `connector_journey.qnt`, that replaces the planned `suggestions.qnt` (`network-harness.md` section 9) and Model E (`platform-consent.md` section 11). The separate machines share every variable, so modelling them alone would hide the defects above.

**Priority:** P0.

**State variables.**

```text
var item:   ItemId -> {status, batch, conn, source, observedAt, factId: Option}
var batch:  BatchId -> {rev, createdAt, expiresAt, retain, chat, deleted}
var fact:   Set[FactId]
var receiptV1, receiptV2, receiptCollect: Map
var turn:   TurnId -> {arrivedAt, open, text}
var member: {state: active|paused|restricted|removed|deleted,
             optedOutProjection: bool, ledgerStop: bool, age, hold, ban, suppressed}
var conn:   ConnId -> active|revoked
var consent: absent|granted|cleared        // upstream, nondeterministic
var nowN, nowC: int                         // two clocks, |nowN - nowC| <= SKEW
var routeAdmit, routeDrain: int
var replyLog: List[{turn, said}]            // to check what the member was told
```

**Actions.** Each transaction is one atomic action, unless a crash point is the subject.

- `openTurn(text)`, `consentContext`, `collect(turn, items)`, `render`.
- `preview`, `accept`, `edit`, `changeScope`, `reject`, `deleteBatch`.
- `tick(limit)`.
- `v1(op, nonce, cutoff)`, `v2(op, id, nonce, turn, cutoff)`, plus replays.
- `stopLedger`, `stopProjection` as two steps.
- `ban`, `hold`, `lowerAge`, `start`.
- `leaveForget`, `leaveMembership` as two steps, with a crash between.
- `advanceN`, `advanceC`, `rotateRoute`.
- `reconnect`, `moveChat`.

**Invariants.** J-1 to J-14, AF-1 to AF-4, and:

```text
saidNothingSaved(t) implies no batch created by t       // finds CJ-01
committedBatch(b) and now < b.expiresAt implies canReject(b)  // finds CJ-01
inDrain and rowsExist implies cleanupEnabled            // finds CJ-02
v2Applied(id) eventually, when cloud event exists       // finds CJ-04
minor implies no new fact
```

**Temporal properties.** `L-1`, `L-2`, `L-3`, with fairness on `tick` and on Cloud retry.

**Abstractions.**

- Text as a tag. Value and hash are not needed.
- Proofs as `{expiresAt}`, valid while `nowN < expiresAt`. Five proof kinds, one record.
- `source proof` reduces to `conn=active and consent=granted` at call time, with a duration step only for CJ-03.
- Row locks: atomic actions. To show PC-19 and CJ-15, split `collect` into `lockHeld`, `cloudCall*`, `commit`.
- `valueOK` as a pure choice at `collect`.

**Bounds.** 1 person, 2 apps, 2 chats, 2 connections, 2 batches, 2 items each, 3 turns, skew at most 3 units, 16-receipt cap reduced to 2. Time in steps: use 5 for 5 s, and treat 5 min and 24 h as symbolic constants, such as 10 and 40.

**Assume, do not model:** OAuth, the Google read, extraction, gateway delivery. Represent each as a nondeterministic Cloud action.

**Queries that should fail today:** CJ-01, CJ-02, CJ-04, PC-14, PC-15, PC-18. Each makes a useful witness. CJ-03 needs the split `collect`.

**Do not expect a witness for:** double accept, replay resurrection, cross-owner nonce, a minor accept, or matcher input. Those hold in the code, and tests cover them.

---

## 12. Not verified

- All upstream behavior: Cloud proofs, event ids, retries, consent writer, gateway delivery of `reviewText`, whether one person can hold two personal chats.
- No Postgres run. CJ-14 and CJ-17 come from reading the SQL and the Postgres rules.
- `packages/network/test/profile-cleanup-reconciliation.postgres.test.ts` runs only with `NETWORK_RETRY_RECONCILIATION_TEST=1` (`:29-32`), so a normal test run does not cover the runtime-role cases. This was read from the file, not measured in CI.
- Test names and the assertions listed here were read. For `profile-suggestions.integration.test.ts` and `profile-cleanup-reconciliation.postgres.test.ts`, all test titles and the cited bodies were read, but not every helper.
