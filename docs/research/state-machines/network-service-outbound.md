# State machines: network service outbound, relay, staff and scheduled work

Scope key: `network-service-outbound`. This report covers `packages/network/service`: outbound sends, Cloud deliver and receipts, the relay endpoint and relay threads, photo relay, the staff API, the tick loop, the cost ledger, ops alerts and caps. It also reads the code those paths call: `packages/blooio/src/outbound-queue.ts`, `packages/network/src/relay.ts`, `packages/platform/src/photo-relay.ts`, parts of `packages/network/src/network.ts`, `packages/notify/src/scheduler.ts`, and `deploy/backend`.

Everything in this file is hand-written from reading the code. Nothing was run. No defect here was reproduced by execution; "confidence" means confidence from reading. Inbound turn claims (`platform.inbound` status) are in scope only where outbound depends on them.

Line references are from branch `claude/quint-state-machines` at commit a0ed7bc. Abbreviations: `oq` = `packages/blooio/src/outbound-queue.ts`, `rt` = `packages/network/service/runtime.ts`, `svc` = `packages/network/service/service.ts`, `re` = `packages/network/service/relay-endpoint.ts`, `desk` = `packages/network/src/relay.ts`, `net` = `packages/network/src/network.ts`, `pr` = `packages/platform/src/photo-relay.ts`, `cc` = `packages/network/service/cloud-channel.ts`, `ch` = `packages/network/service/channel.ts`, `ops` = `deploy/backend/ops.ts`, `be` = `deploy/backend/backend.ts`.

## 0. Summary

Machines found: 20. Priorities: P0 safety, P1 delivery and data integrity, P2 other.

| Id | Kind | Priority | State lives in |
|---|---|---|---|
| outbound-queue-row | explicit | P0 | `platform.outbound.status` plus lease, flags |
| cloud-deliver-handshake | implicit | P0 | `outbound.status`, Cloud's id, HTTP exchange |
| collected-reply | explicit | P0 | `network.messages.status`, `outbound.status`, `inbound.replies/receipt` |
| relay-action-receipt | implicit | P0 | `platform.inbound.action_receipts[hash]` |
| relay-item | explicit | P0 | `state.relay.log/held`, `network.relay_records`, outbound rows |
| relay-swap | implicit | P0 | `state.relay.swaps`, two outbound rows |
| photo-relay-item | explicit | P0 | `platform.photo_relay_items` |
| staff-review-gate | explicit | P0 | `Opp.stage`, `Opp.review`, `network.review_items` |
| staff-leak-review | explicit | P0 | `outbound.status='parked_leak_review'`, `leak_released_by` |
| staff-safety-saga | implicit | P0 | `platform.bans`, memberships, members, each network's trust |
| staff-audit-two-phase | implicit | P1 | `network.staff_audit` rows |
| person-cap-slot | implicit | P0 | `platform.person_sends`, `outbound.person_cap` |
| line-conversation | implicit | P1 | `platform.line_conversations`, `platform.line_safety` |
| message-status-mirror | implicit | P1 | `network.messages.status`, `notification_recorded_at` |
| notify-delivery | implicit | P1 | `notify.deliveries`, `notify.inbox_items`, in-memory `notifyTargets` |
| unit-of-work | implicit | P1 | `Unit`, `committed`, `retry`, advisory lock, save transaction |
| tick-loop | implicit | P1 | `busy` set, lock, `tickDone`, `lastTick`, intervals |
| photo-intake-consent | implicit | P1 | `platform.pending_texts`, `profile.photoConsent`, rate buckets |
| ops-alert-dispatcher | explicit | P2 | `network.ops_alerts`, `network.ops_alert_posts` |
| cost-ledger-accrual | implicit | P2 | `network.cost_ledger`, bias/SLA dedupe |

The ten strongest suspected defects are D1 to D10 in section 22. In short:

- D1. A member can withdraw "my number" after both shares are queued. The service says it will not share. The queued rows still go.
- D2. A number swap is two independent queue rows. One can go and the other can end unsent.
- D3. The deployed backend never calls `svc.purge()` or `svc.inboxTick()`. Retention and inbox recovery do not run.
- D4. A row older than 6 hours that gets an unknown acceptance ends `failed_unknown` with no receipt lookup, and its cap slot goes back.
- D5. A second city of one app breaks the queue: each runtime drains the other's rows with the wrong checks. A relay row can expire. This is latent; only nyc rows exist now.
- D6. A staff review can approve an item past its deadline.
- D7. A ban that fails half way cannot be run again ("already_banned").
- D8. Every `unitOfWork` in a signed turn, STOP included, waits on the line lock and on remote receipt lookups. The 8 s turn budget has no protection.
- D9. Line safety action "review" holds compliance texts, against the code comments and the alert text.
- D10. `wait()` and `end()` update by id with no status guard, so an erased row can come back.

## 1. outbound-queue-row (P0, explicit)

Evidence: `oq:1-32`, table in migration 0015, columns added by 0022, 0032, 0037. One row per outbound id. Primary key `id` is the idempotency key. One queue object per runtime; rows are shared by all queues of an app and line.

### States

Waiting (`WAITING`, `oq:189`, and `ch:44` adds `queued`): `pending`, `retry_scheduled`, `deferred_quiet_hours`, `held_awaiting_reply`, `sending`, `unknown_acceptance`.

Due (`DUE`, `oq:192`): `pending`, `retry_scheduled`, `deferred_quiet_hours`.

In flight (provider accepted): `accepted`, `sent`. Ended good: `delivered`, `read`.

Ended not sent (`NOT_SENT`, `oq:195`): `refused_not_approved`, `refused_opted_out`, `refused_person_cap`, `suppressed_ineligible`, `blocked`, `parked_leak_review`, `parked_error`, `parked_invalid_timezone`, `failed`, `failed_unknown`, `expired`, `dropped_forgotten`, `dropped_leak_review`.

Collected branch (section 3): `collected`, `send_unknown`, `refused_gateway`, `sent`.

`network.messages`-only statuses that never enter this table: `queued`, `dry_run`, `failed_no_address`, `refused_photo_transport`.

There is no SQL CHECK on status. Any string can be stored.

Implied row flags: `lease_owner`, `lease_until`, `attempts`, `in_doubt`, `person_cap`, `new_conversation`, `reengagement`, `leak_released_by`, `next_attempt_at`, `sent_at`, `delivered_at`, `read_at`, `ended_at`, `to_address` null, `body` null.

### Transitions

| # | From | Event, trigger | Guard | Effects | To | Where |
|---|---|---|---|---|---|---|
| 1 | none | enqueue in save tx (member, staff or tick unit) | agent kind and no zone | `ended_at=now`, alert | `parked_invalid_timezone` | `oq:237-246` |
| 2 | none | enqueue | otherwise | insert; same id with same fingerprint is a no-op; other fingerprint throws | `pending` | `oq:243-250` |
| 3 | DUE | drain: too old or stale | `tooOld` or `stale` | `end` | `expired` | `oq:371` |
| 4 | DUE | drain: live flags off | | `end` | `refused_not_approved` | `oq:373` |
| 5 | DUE | drain: opted out or banned | not compliance | `end` | `refused_opted_out` | `oq:376` |
| 6 | DUE | drain: recipient policy no | not compliance | `end` | `suppressed_ineligible` | `oq:378-379` |
| 7 | DUE | drain: reply with no inbound in 1 h | kind reply | alert, `end` | `suppressed_ineligible` | `oq:383-389` |
| 8 | DUE | drain: bad zone | agent kind | `end` | `parked_invalid_timezone` | `oq:392` |
| 9 | DUE | drain: quiet hours (clock) | agent kind | `wait` to next allowed | `deferred_quiet_hours` | `oq:394` |
| 10 | DUE | drain: unanswered cap | not compliance, `unanswered>=3`, not the one re-engagement | `wait` | `held_awaiting_reply` | `oq:398-402` |
| 11 | DUE | drain: line safety | action review, or reply_only and agent or new, or pause_new and new | alert, `wait` +1 h | `retry_scheduled` | `oq:407-410` |
| 12 | DUE | drain: caps | not compliance | `wait` +5 min or +1 h | `retry_scheduled` | `oq:418-420` |
| 13 | DUE | drain: person cap refuses | kind proactive | `end` | `refused_person_cap` | `oq:423-426` |
| 14 | DUE | drain: leak guard | not `leak_released_by` | alert, `end`, keeps text | `parked_leak_review` | `oq:429-433` |
| 15 | DUE | admission tx | member gone, or binding gone (receipt providers) | `end` | `dropped_forgotten` | `oq:474,486` |
| 16 | DUE | admission tx | proactive and account not active | `end` | `suppressed_ineligible` | `oq:477` |
| 17 | DUE | admission tx | not compliance and opted out | `end` | `refused_opted_out` | `oq:488` |
| 18 | DUE | admission tx | `admit` not ok | `end` | `suppressed_ineligible` | `oq:491` |
| 19 | DUE | admission claim | conditional update wins | `attempts+1`, lease 5 min | `sending` | `oq:492-496` |
| 20 | DUE | any throw in dispatch | | alert, `end` | `parked_error` | `oq:295-299` |
| 21 | `sending` | provider accepts | row still `sending` or `unknown_acceptance` with same content | ids, `sent_at`, line counters | `accepted`, `sent`, `delivered`, `read`, `failed` | `oq:538-573` |
| 22 | `sending` | provider accepts but row changed | no row matched | none | stays; reports `dropped_forgotten` | `oq:569` |
| 23 | `sending` | failure `unknown` | | `wait` | `unknown_acceptance` | `oq:513-514` |
| 24 | `sending` | failure `retryable` | attempts < 6 | backoff 30 s doubling, cap 30 min | `retry_scheduled` | `oq:515-519` |
| 25 | `sending` | failure `retryable` | attempts >= 6 | alert, `end` | `failed` | `oq:516` |
| 26 | `sending` | failure `await_recipient` | | `wait` | `held_awaiting_reply` | `oq:520-521` |
| 27 | `sending` | failure `blocked` | | alert, `end` | `blocked` | `oq:522-524` |
| 28 | `sending` | failure other | | alert, `end` | `failed` | `oq:525-527` |
| 29 | `sending` | lease expired (drain or start) | provider has receipt | `in_doubt`, alert | `unknown_acceptance` | `oq:272-279` |
| 30 | `sending` | lease expired | no receipt | `in_doubt`, alert | `retry_scheduled` | `oq:272-279` |
| 31 | `unknown_acceptance` | drain, `created_at` older than 6 h | | alert, `end` | `failed_unknown` | `oq:584-589` |
| 32 | `unknown_acceptance` | receipt lookup positive | body and address present | as 21 | `accepted` | `oq:593-596` |
| 33 | `unknown_acceptance` | lookup says never admitted | | | `retry_scheduled` | `oq:598-603` |
| 34 | `held_awaiting_reply` | person wrote (`engaged`) | any app on line | `next_attempt_at=now` | `pending` | `oq:638-645` |
| 35 | `held_awaiting_reply` | drain, too old | | `end` | `expired` | `oq:319-329` |
| 36 | `accepted`,`sent` | webhook receipt | rank up | | `sent`,`delivered`,`read` | `oq:622-631` |
| 37 | `accepted`,`sent` | webhook failed | | `end` | `failed` | `oq:617-621` |
| 38 | `parked_leak_review` | staff release | body and address kept | `ended_at=null`, `leak_released_by` | `pending` | `oq:720-731` |
| 39 | `parked_leak_review` | staff drop | | `end` | `dropped_leak_review` | `oq:724` |
| 40 | any WAITING | member forgotten in save tx | | body, address cleared | `dropped_forgotten` | `rt:548-550` |
| 41 | `pending`,`retry_scheduled`,`deferred_quiet_hours`,`held_awaiting_reply` | number changed | `to_address=old` | address cleared, no cap release | `suppressed_ineligible` | `packages/platform/src/pg-store.ts:365` |

Terminal states with no exit: every state in `NOT_SENT` except `parked_leak_review`, plus `delivered`, `read`. `accepted` is terminal under Cloud (D11).

### Invariants

- I1. A row reaches `sending` only after: live flags, consent ledger, opt-out, recipient, age, leak check, all read after the last wait. (AGENTS: every outbound message goes through the leak check.)
- I2. `body` and `to_address` of a row with `member_id is null` are null once the row ends, except while `parked_leak_review`. (`oq:32`)
- I3. At most one provider dispatch with a new key per row id. Same key on retry. (`oq:8-9`)
- I4. Under a receipt provider, no second `send` after an ambiguous answer. (`rt:345-347`, README "More than one replica" item 3)
- I5. Status never goes back. (`oq:31`) This is false for `wait`/`end`; see D10.
- I6. Compliance texts skip opt-out, recipient, quiet hours and caps, but never the canary and fact checks. (`oq:23`)
- I7. A row older than 24 h (proactive) or 3 days (any) is never sent. (`oq:172-174`)
- Liveness: every row in WAITING reaches an end. `held_awaiting_reply` by TTL, `unknown_acceptance` by 6 h, others by TTL at dispatch. Depends on ticks running.

### Interactions

Writes in the Network save transaction (`rt:555-559`). Reads `network.members`, `platform.memberships`, `phone_identities`, `network.network_state`, `relay_records`. Takes the person row lock and member row lock in admission; relay rows first take `network_state FOR SHARE` (`ch:198-200`). Erasure takes the same order (`rt:457-462`, `oq:469-473`).

### Concurrency and failure

- One drain per line by advisory lock on a reserved connection (`oq:255-269`), plus an in-process promise chain.
- `recover` and `reconcileUnknown` run before the lock (`oq:284-285`). Remote I/O there holds no database lock.
- Admission is one transaction with no remote I/O. Provider call is outside it. Accept commit is a second transaction. A crash between gives `sending` with a lease, then transition 29 or 30.
- Provider call is inside `withLine`, so the line lock is held for the whole call, for every due row in turn. See D8.
- `dispatch` reads `row` once per drain; `wait` and `end` do not recheck status. See D10.
- `in_doubt` is written and never read (D21). No code uses it to change behavior.
- `rowOf` at `oq:291` is outside the `try`. A row whose stored `approved_photos` no longer parses aborts the drain for the whole app on each tick (D29).

### Quint notes

Variables: `status: RowId -> Status`, `lease: RowId -> Option[Time]`, `attempts`, `capTaken`, `consent: Person -> Bool`, `erased`, `clock`. Actions: `enqueue`, `gateDecide` (non-deterministic outcome of each gate), `claim`, `providerAccept`, `providerFail(kind)`, `crash`, `recover`, `receiptLookup(result)`, `stop`, `erase`, `staffRelease`, `staffDrop`, `inboundEngaged`, `tick`. Model two workers. Bounds: 2 rows, 2 workers, 3 attempts, 3 clock buckets. Invariants: I1 to I7 as state predicates; `sentAfterStop` false; `noResendAfterUnknown`. Abstract the gate order into one step with a stale read, then a second admission step, so TOCTOU between gates and claim shows. Merge with cloud-deliver-handshake and person-cap-slot.

## 2. cloud-deliver-handshake (P0, implicit)

Evidence: `cc:24-69`. Two services: this backend and Eliza Cloud. Wire: `DELIVER_PATH`, `DELIVER_RECEIPT_PATH`, signed with `SERVICE_TURN_SECRET`, id = row id.

### States (service side view of one id)

`NotSent`, `Requested` (HTTP in flight), `AcceptedKnown`, `RefusedBeforeDispatch` (retryable), `RefusedFinal` (invalid), `OptedOutAtCloud`, `Unknown`, `NeverAdmitted` (receipt says not found), `ReceiptPending`. Cloud side view (implied): `NotAdmitted`, `Admitted`, `Sent`, `Replayed`.

### Transitions

| From | Event | Guard | To | Where |
|---|---|---|---|---|
| NotSent | post deliver | scope app matches, canonical phone, no media, no route policy, photos bound | Requested | `cc:26-33` |
| NotSent | post | a scope check fails | `invalid`, row `failed` | `cc:26-33`, `oq:525` |
| Requested | network error, oversize, bad JSON, timeout 10 s | | Unknown | `cc:40-46` |
| Requested | 200 ok, history boolean, replayed boolean, non-empty ids, acceptedAt valid or absent | | AcceptedKnown | `cc:51-56` |
| Requested | ok false `opted_out` | | `blocked` row | `cc:63` |
| Requested | ok false `rejected` retryable | | `retryable` | `cc:64` |
| Requested | ok false other with 400,401,403,404,409,422 | | `invalid` | `cc:65` |
| Requested | anything else, 5xx included | | Unknown | `cc:67` |
| Unknown | receipt lookup ok | | AcceptedKnown | `oq:593-596` |
| Unknown | receipt ok false `rejected` retryable | | NeverAdmitted, row `retry_scheduled` | `cc:60-61`, `oq:598-603` |
| Unknown | receipt other | | Unknown (row unchanged, `updated_at` moves) | `oq:604-605` |
| Unknown | row older than 6 h | | `failed_unknown` | `oq:584-589` |

`history` false is accepted (`cc:48-51`). The relay `delivered` flag still needs `history_recorded===true` (`re:133-134`).

The kind mapping: `reply` and `compliance` map to wire `reply`; `relay:` ids to `relay`; the rest to `proactive` (`cc:37`). `transactional` becomes `proactive` on the wire.

### Invariants

- Same id on every call; never a second id for one row (service README 33).
- An unknown never produces a second `send`. A `not_found` does, with the same id.
- A receipt lookup never sends.
- `acceptedAt` from Cloud is kept when valid.

### Failure

Lost response: Unknown. Crash after Cloud accepts, before commit: lease recovery to Unknown, then receipt. Duplicate: Cloud `replayed`. Out-of-order: a receipt lookup and an in-flight send cannot run on one row because the row is `sending`, unless the lease ran out (5 min against a 10 s timeout). Clock skew: `svcSign` uses `clock.now()`; skew past the signature window gives an auth failure, which is a 401 and maps to `invalid` and `failed`, not Unknown. A clock skew burst therefore ends rows as `failed`. (Depends on Cloud's status code; I did not read upstream.)

Under Cloud, the webhook does not reach this service. AGENTS: "it never receives the Blooio webhook itself in production". So `status`, `reaction` and `safety` events (`svc:1009-1022`) do not arrive. The contract has no status path. Effects: D11 (`accepted` never ends), D22 (line safety never set; tapbacks do not reset the streak).

### Quint notes

Two-party model with Cloud as a small state machine: `admitted: Set[Id]`, `sent: Set[Id]`. Network actions can drop the request or the response. Invariant: `count(sent, id) <= 1` and `row.status in Accepted implies id in admitted`. Include `reconcile` TTL. Model inside outbound-queue-row.

## 3. collected-reply (P0, explicit)

A reply to the sender of a signed turn does not pass `dispatch`. It goes back in the turn response and Cloud sends it.

### State

`network.messages.status`: `collected`, `sent`, `send_unknown`, `refused_gateway`. `platform.outbound.status`: same set, from `recordCollected` (`oq:684-693`). `platform.inbound.replies`, `receipt`, `receipt_hash`. In-memory `Unit.collected`.

Direct replies in a turn (`svc:1367-1372`) have no `network.messages` row and no outbound row. They live only in `inbound.replies`.

### Transitions

| From | Event | Guard | To | Where |
|---|---|---|---|---|
| none | `context.send` causal | same turn app, member, address, `o.reply` | in `Unit.collected` | `rt:421-424`, `rt:447-449` |
| in collected | save tx, leak guard fails | queue present | removed, goes to queue as a `reply` row | `rt:473-477` |
| in collected | save tx | | `collected` in both tables, appended to `inbound.replies` | `rt:478-490` |
| `collected`,`send_unknown` | signed receipt accepted | ids equal, provider ids present, history or accountFree | `sent`, `sent_at` | `svc:2032-2040`, `oq:696-703` |
| `collected`,`send_unknown` | receipt unknown | | `send_unknown`, `ended_at` stays null | same |
| `collected`,`send_unknown` | receipt rejected | | `refused_gateway` | same |
| receipt unknown | second receipt accepted or rejected | | moves on; receipt replaced | `svc:2017` |
| receipt accepted | different receipt | | 409 | `svc:2017` |

### Invariants

- Each reply the gateway sends was in the turn's stored list; ids and order bind (`svc:2025`).
- Accepted needs provider ids, and history unless the reply is a policy reply or the canonical join prompt (`svc:2028-2033`).
- Leak guard on every collected Network reply (`rt:473-477`). `direct()` replies skip it, but they are fixed copy.
- Replies with a failed guard never leave.

### Failure

Turn fails: collected replies were written in unit transactions that committed, and the inbox row goes `unresolved`. The gateway never gets them. They stay `collected` forever (D12). Gateway crash after send, before receipt: same. `send_unknown` has no exit but a later receipt. After `inbox.purge` seals the turn, receipts answer `turn_unavailable` (`svc:2011`), so no later fix exists. No sweep exists.

A collected reply that fails the guard enters the queue. The turn's `engaged` runs only after `inbound()` returns (`svc:1027`, `svc:2088`), but `unitOfWork` drains during `inbound()`. If the person's last inbound is older than an hour, step 4 of `dispatch` ends the row `suppressed_ineligible` before step 10 can park it (D13). The test at `cloud-outbound.integration.test.ts:209` calls `engaged` by hand first, so it does not cover this.

The consent checks of `dispatch` do not apply to collected replies. See D14: a stranger who sent STOP gets the join question in a signed turn.

### Quint notes

Model with outbound-queue-row. Actions: `collect`, `guardFail`, `receipt(outcome)`, `turnFail`, `purge`. Invariant: `status=sent implies receipt accepted`. Liveness candidate: `collected` eventually leaves (this will fail and shows D12).

## 4. relay-action-receipt (P0, implicit)

Evidence: `re:175-261`; the same shape in `svc:1879-1971` for set-state, signals and updates.

### State

`platform.inbound.action_receipts[receipt]` = absent, `{state:"processing", requestHash}`, `{state:"completed", requestHash, response}`, `{state:"unresolved", requestHash}`. Cap: 16 keys per turn.

Requires the turn row: `status='done'`, `response.outcome='open'`, same app and member, same sender hash, current membership.

### Transitions

| From | Event | Guard | To | Where |
|---|---|---|---|---|
| absent | signed POST, Cloud | turn authority, source text equal, item offered, fewer than 16 | `processing` (own tx) | `re:193-203` |
| `processing` | same request while running | | 409 `action_unresolved` | `re:197` |
| `processing` | unit commit | `completeAction` inside save tx | `completed` | `re:186-190`, `re:245-252` |
| `processing` | none path | own tx | `completed` | `re:224` |
| `processing` | throw | | `unresolved` | `re:257-260` |
| `processing` | crash | | stays `processing` | none |
| `completed` | replay | same hash | answer from outbound row, `replayed:true` | `re:198`, `re:207` |
| any | other hash | | 409 `action_conflict` | `re:196` |
| any | member erased | seal | key removed, turn `unresolved` | `rt:525-528` |

### Invariants

- One relay per open turn (`auth.id=<messageId>:relay`).
- The app and member come from the turn, never from the model.
- Text equals the turn's own inbound row.
- The receipt, the relay log, the messages and the queued rows commit together.
- `delivered=true` only when the row is accepted, has provider ids and `history_recorded=true`.

### Failure

Crash in `processing`: no effect committed (completion is in the effect transaction), but the key is stuck. Every retry gets 409 and `retryable:false`. The member's message is not relayed and Cloud has no retry path (D23). A Cloud timeout during a slow Clef call: retry gets the same 409 while the first call later succeeds, so Cloud reports failure for an item that goes out.

`deliver()` after commit can throw from `storeStatuses` or `projectNotifications` (`rt:616-617` are outside the try). Then `re:257-260` writes nothing (state is not `processing`) and returns 409 `action_unresolved`, though the row is committed and queued (D24).

Lock order inside `lock(tx)` at `re:177-185`: person row, then membership, then inbound row. In `completeAction` it runs after `network_state` is written, so state comes first. Admission uses the same order. Good.

### Quint notes

Small model; merge with relay-item. Actions: `claim`, `commit`, `throw`, `crash`, `replay`, `erase`. Invariant: `completed iff effects committed`. Note the invariant `processing and no worker implies stuck`.

## 5. relay-item (P0, explicit)

Evidence: `desk`, `net:4745-4817`, `net:4895-4930`, `rt:238-269`, migration 0026, 0031.

### States

For one item id, the record decision: `pass`, `hold`, `block` (engine `RelayDecision`). The held entry: `held`, `released`, `rejected`. The desk outcome on the wire: `sent`→`pass`, `held`→`hold`, `refused`→`block`, plus `none`. Implied: `deferred` (in `Network.deferred`), `queued` (row exists), `admitted`, `suppressed` (row ended at admission), `delivered`. Rate holds have a log row and no held row.

Thread: one `RelayThreadState` per match, opened on first delivery, cap 50 messages.

Match view (`net:4895-4902`): `mutual` while stage `scheduled` or `done`; `cancelled`, `closed`, `probing` otherwise. There is no time limit on the thread (founder P7).

### Transitions

| From | Event | Guard | To | Where |
|---|---|---|---|---|
| none | member request | prior log for key | replay outcome | `desk:179-180`, `desk:319-324` |
| none | member request | no open match | refused, no log | `desk:181-182` |
| none | decide | engine `block` | log block | `desk:234` |
| none | decide | every reason in family `rate` | log hold, no held row | `desk:238` |
| none | decide | hold | log hold, held row, text if no age signal | `desk:239-244` |
| none | decide | pass | log pass; Network send | `desk:246-248` |
| pass | Network send refused | | log block with `send:refused` | `desk:247`, `desk:252-254` |
| pass | Network send deferred | timing | answer `late`; thread already has the message | `desk:248`, `desk:256-266`, `net:3886-3891` |
| deferred | tick flush | | queued, or refused with log still `pass` | `net:3269-3275` |
| queued | admission fails | | row `suppressed_ineligible` | `rt:238-269`, `oq:491` |
| `held` | staff release | no match or no text | `released`, nothing goes | `desk:355` |
| `held` | staff release | engine now block | `released`, nothing goes | `desk:359-361` |
| `held` | staff release | pass, or hold on a text | `released`, wording goes | `desk:359-365` |
| `held` | staff reject | | `rejected`, text gone | `desk:369-376` |
| `held` | member forgotten | either party | `rejected` | `desk:398-402` |

`relayAdmission` (`rt:238-269`): item row must exist with `decision='pass'`, same recipient, not rejected. Then `relayDispatchCheck` on the stored state (FOR SHARE), block edges and person blocks, then `relayParties` for both.

### Invariants

- Only `rendered` text goes out. (AGENTS Relay #7)
- Both parties adult, not opted out, not held, no block, match open, at final dispatch.
- Text never kept for an age-signal sender (`desk:241-242`); hidden in listings if doubt arises later (`net:4797-4804`).
- A held item is released only by safety staff, audited.
- The classifier can only raise a decision. Production with no Clef holds every text the rules pass (`re:83-92`).

### Failure and concurrency

Classification runs inside the Network advisory lock, so a close waits and is then seen at admission. Good. `release` passes no `canonical` (`svc:2461`), so the desk uses state only; the queue's admission still applies.

`rec.review === "rejected"` at `rt:253` cannot be true for a row: a rejected item has decision `hold`, so `rec.decision !== "pass"` already refused it (D25).

Held items have no TTL, no SLA, no alert. `ops.ts` has no relay metric. A held text stays in `network_state` until staff act (D15).

`relay.prior` makes a rate-limit hold on a fixed id final; see D26 for photos.

### Quint notes

State: `log: Item -> Decision`, `held: Item -> HeldState`, `rows`, `match: stage`, `party flags`. Non-deterministic `engineDecide`. Actions: `request`, `tickFlush`, `close`, `stop`, `block`, `staffRelease`, `staffReject`, `admit`. Invariant: `rowSent(i) implies log(i)=pass and match open at admission`. Keep the engine as a non-deterministic oracle. Merge with relay-action-receipt and relay-swap. Include the deferred state; the invariant "thread contains only delivered wording" should fail for deferred then refused items.

## 6. relay-swap (P0, implicit)

Evidence: `desk:269-305`, `desk:308-312`, `re:212-220`.

### States

`NoSwap`, `Waiting(first)` (in `state.relay.swaps`), `Expired` (implied; removed lazily on next `swap()`), `BothAsked`, `Queued(a,b)` (two rows), `OneGone`, `BothGone`, `Withdrawn`, `Refused`.

### Transitions

| From | Event | Guard | To |
|---|---|---|---|
| NoSwap | A asks | no verified contact | refused |
| NoSwap | A asks | engine probe not pass | apply decision |
| NoSwap | A asks | probe pass | Waiting(A); ask text to B as `relay:<id>:ask` |
| Waiting(A) | A asks again | | held "already asked" |
| Waiting(A) | 15 min pass, next swap call | | Expired |
| Waiting(A) | A withdraws | | NoSwap, `cancelSwaps` |
| Waiting(A) | B asks | both decide pass, first share not refused | Queued |
| Waiting(A) | B asks | either not pass | swap removed, refused or held |
| Queued | row X goes, row Y ends unsent | | OneGone (D2) |
| Queued | A withdraws | | answer "won't share", rows stay (D1) |

The result of `host.send` for the ask at `desk:281` is ignored. A refused ask still leaves Waiting, and the sender hears "I'll share your number as soon as they say" (D27).

The ask text says "in the next 15 minutes" (`desk:154`). The row can wait in the Network's deferred list or in the queue for hours. It then promises a window that has already ended (D27).

### Invariants

- A number goes out only after both members asked, each within the 15 minute consent TTL. (Founder decision 9.)
- "Nobody's number goes one way" (`desk:285-286`).
- After a withdrawal, no number of that member goes out. (Decision 9: per-item consent.)
- The number is never in a thread, log or record.

Two of these fail: see D1, D2. The number is in plain text in the outbound body and in `network.messages.body` of the recipient. After the sender erases their account, those rows stay, because erasure touches only rows where `member_id` is the erased member (`rt:529`, `rt:548`). See D16.

### Quint notes

Model two members, `waitingSwap`, two rows, `withdrawn: Member -> Bool`, `consentAt`, `clock`. Invariants: `numberSent(a) implies consent(a) and not withdrawn(a) and clock - consentAt(a) bounded`, and `numberSent(a) implies eventually numberSent(b) or both ended`. High value; small state space. Model with relay-item.

## 7. photo-relay-item (P0, explicit)

Evidence: `pr`, migration 0037, `svc:2117-2158`, `svc:2293-2308`, `svc:2430-2469`, `re:231-252`. Production policy is absent (`svc:396`), so `enabled=false` and this machine is off by default.

### States

Column `state`: `pending`, `approved`, `rejected`, `revoked`. Implied: `expired` (`expiresAt<=now`, column unchanged), `claimed` (`action_id` set), `bound` (`delivery_intent` set), `capability expired` (`delivery_expires_at<=now`).

### Transitions

| From | Event, actor | Guard | To | Where |
|---|---|---|---|---|
| none | select, member | policy version, consent, current thread, own photo, idempotency key | `pending`, TTL 15 min | `pr:111-135` |
| any | revoke, sender | owner | `revoked` | `pr:136-141` |
| `pending` | review safe, staff | reviewer authorized, current, before expiry | `approved` | `pr:143-153` |
| `pending` | review unsafe | before expiry | `rejected` | same |
| `approved` | review unsafe | before expiry | `revoked` | same |
| `approved` no action | claim, in save tx | app, thread, sender match, current | `claimed` | `pr:187-194` |
| `claimed` | Cloud resolve | row `sending`, exact recipient, admission ok | `bound`, deadline min(+60 s, expiry) | `pr:196-213`, `svc:2128-2158` |
| `bound` | provider fetch | signature, exp equal, current | bytes | `pr:215-224` |

`current()` (`pr:103-110`) re-reads policy, expiry, state, canonical parties, and photo ownership and hash.

### Invariants

- One item, one thread, one recipient, one action, one delivery intent (unique columns).
- Bytes reach a provider only for `approved`, claimed, bound, unexpired.
- Staff read bytes only with an item scope; audit before bytes (test at `shared-relay.integration.test.ts:301` covers a failed audit).
- Revocation wins final admission.
- A release needs a preview token bound to this reviewer and item (`svc:2117-2125`).

### Failure

`review` commits in its own transaction before the unit (`svc:2442-2445`). A failed unit leaves `approved` with no action. The test confirms a retry works. Expired items keep `pending` or `approved` forever; no transition and no purge exist (D28). `issueDelivery` fixes one deadline; a retry after 60 s gets `photo_unavailable`, and that is by design.

A desk-held photo cannot be decided (D26): id `pri_...` makes the staff route take the `selected` branch; release gets `prior` "held" and answers not ok; reject changes the selected row and leaves the desk's held row in `held`.

### Quint notes

Standalone model with `state`, `actionId`, `intent`, `clock`, `TTL`. Invariant: `bytesServed implies state=approved and actionId set and clock<expiresAt`. Include `revoke` during `sending`. P0 when the policy is switched on.

## 8. staff-review-gate (P0, explicit)

Evidence: `net:1868-2060`, `net:3345-3351`, `svc:1520-1538`, `svc:2372-2387`. AGENTS: every proposal and member request passes human review; an item past its SLA expires unsent.

### States

`Opp.stage`: `review`, `probing`, `scheduled`, `done`, `closed`. `review.decision`: unset, `approve`, `reject`, `expired`. `review.invalidated` text. `rerolls` list. Console row `network.review_items`.

### Transitions

| From | Event, actor | Guard | To | Where |
|---|---|---|---|---|
| none | `submit` (tick, inbound) | category allowed | `review`, deadline +12 h or +1 h | `net:2047-2060` |
| none | `submit` | category not allowed | closed | `net:2050-2053` |
| `review` | approve, reviewer | `reviewBlock` none, `approvalCheck` ok | `probing` | `net:1918-1927` |
| `review` | approve | `approvalCheck` fails | `closed`, invalidated, `ok:false` | `net:1919-1925` |
| `review` | edit | leak-checked | as approve | `net:1907-1927` |
| `review` | reject | | `closed` | `net:1929-1932` |
| `review` | reroll with alternate | | `review`, new deadline | `net:2027-2037` |
| `review` | reroll no alternate | | `closed` | `net:2021-2026` |
| `review` | tick | `now>=deadline` | `closed`, `expired` | `net:3345-3351` |

### Invariants

- No member contacted while stage is `review`.
- No minor, declined or unknown member in an approved item.
- `matchingEnabled` true at approval.
- Reviewer of record is the signed-in person.
- Past deadline, unsent.

### Failure

Each decision runs under the Network lock as one unit. Two reviewers: the second gets `not_in_review`. `decide` has no check of `now>=deadline` (D6). Reroll on an overdue item gives a new deadline; `queuedAt` stays. No cap on rerolls.

The SLA alert `slaAlerts` (`svc:2550-2561`) compares `queuedAt` with `DEFAULT_SLA_HOURS`. Peon's is 24 h but `reviewSlaHours` is 12 for all apps (`net:578`), so a peon item leaves the queue before the alert can fire (D30). `ops` `review_sla` does still alert on overdue and expired.

### Quint notes

Merge with the opportunity model of the network core agent. Add `decide` with `clock`. Invariant: `stage=probing implies decidedAt<=deadline`, and this will fail, showing D6.

## 9. staff-leak-review (P0, explicit)

Evidence: `svc:2309-2344`, `oq:705-731`, migration 0032.

### States

`parked_leak_review` (body and address kept), released (`pending` with `leak_released_by`), `dropped_leak_review`.

### Transitions

As rows 14, 38, 39 of section 1. Guards at the API: safety role; reason of 5 or more characters; the row must be in the first 1000 parked; release refused when the member's age is in doubt (`svc:2334`). `change.memberId` updates `network.messages`; release then calls `rt.deliver()`.

### Invariants

- Canary leaks are 0. A released row skips the guard entirely (`oq:429`), canaries included. That is a staff override of AGENTS "Canary leaks ... are always 0". State this in the model as an allowed exception, or tighten it.
- Staff never read a minor's text (`svc:2319-2321`).
- A release re-runs every other gate.

### Failure

Release of a `reply` row after an hour: gate 4 ends it `suppressed_ineligible`. The API answers `ok:true` (D17). Release of a proactive row past 24 h: `expired`, same answer. The audit row is written after the action (D18). A cap slot is released on park and taken again after release; that works.

Parked rows of a forgotten member have null text and stay listed until staff drop them. `decideLeak` release refuses them with `not_parked`, and the list keeps showing them. A drop works.

### Quint notes

Merge into outbound-queue-row. Add `ageInDoubt` boolean.

## 10. staff-safety-saga (P0, implicit)

Evidence: `svc:1675-1764`, `svc:1697-1720`, `net:1311-1336`.

### States for a ban (implied saga steps)

`Requested` audit; `BanRows`; `Suppressed`; `RatingsDropped`; `MembershipsRestricted`; for each member `AccountRestricted`, `MarkedBanned(network)`; `Result` audit. Each step is its own transaction. Holds: `Requested`, `HeldHere`, `HeldElsewhere(i)`, `Result`.

### Transitions

Ban runs steps in order (`svc:1745-1762`). `already_banned` guard at `svc:1742-1743` runs before the saga. Hold runs `rt` first, then others, one unit at a time (`svc:1680-1685`).

### Invariants

- A banned number is refused at join, OTP and inbound on every app (founder 2026-10-09 item 3).
- A banned person gets only compliance texts (`svc:707-709`).
- Hold on every app needs safety@* or admin@*.
- The audit row never reveals how many apps a person uses.

Send-time consent reads bans from the database, so the send fence holds from the first step. A hold is only in the Network state (trust score); it does not touch `account_status`, so the `oq:477` fence does not see it. The recipient gate reads `rt.net` from memory (`ch:185-186`). On a second replica whose last unit is older, a held member can still get a non-relay row until that replica loads state (D19).

### Failure

A crash or throw in the middle leaves bans recorded and later steps undone. A retry gets `already_banned` and nothing resumes (D7). `audited` has no try/catch, so a throw leaves no result row. `clearMinor` loops networks and records per-app results; a throw there loses `apps`.

### Quint notes

Model as a saga with `step: Int`, `crash`, `retry`. Invariant: `retry eventually completes` will fail. Bound 2 networks. Standalone.

## 11. staff-audit-two-phase (P1, implicit)

Evidence: `svc:1520-1527`, `svc:1767-1774`, `svc:1777-1781`, `svc:2255`, `svc:2296-2304`, `svc:2341`, `svc:2352`, `svc:2433`, `svc:2466`, `svc:2267-2268`.

States per action: `Requested` row, `Done`, `ResultRow`. The rule at `svc:1519`: "an audit row first (no row, no action)".

| Path | Requested row before action | Result row |
|---|---|---|
| review, lift, close, dismiss, matching | yes | yes, write errors logged |
| hold, ban, clear minor | yes | yes unless a throw |
| verify, invite | yes | yes |
| read photos | yes | yes |
| photo relay release or reject | yes | yes |
| text relay release or reject | no | after action, a failure throws 503 after the commit |
| leak release or drop | no | after action, same |
| `/holds` POST | yes | no |
| `/inbound/resolve` | no | after action |

Invariant: an action committed implies an audit row. It fails for the "no" rows on a crash or audit outage (D18). Quint: too simple to model alone. Add one boolean to each staff action.

## 12. person-cap-slot (P0, implicit)

Evidence: `svc:592-607`, `rt:195-199`, `oq:423-426`, `oq:345`, migrations 0007, 0012. PRD 40.3: 3 proactive messages a day across all apps, at send time.

### States

For a message id: `NoSlot`, `Taken` (row in `person_sends`, 24 h rolling count), `Marked` (`outbound.person_cap=true`), `Released`.

### Transitions

| From | Event | Guard | To |
|---|---|---|---|
| NoSlot | `capTake` at gate 9 | count < 3 under global advisory lock | Taken |
| NoSlot | `capTake` | count >= 3 | `refused_person_cap` |
| Taken | update `person_cap` | second statement | Marked |
| Marked | `end` with NOT_SENT | | Released |
| Taken | id seen again | | no change (`continue`) |
| Taken | age | older than `since - 1 day` | row deleted |

`person_cap_take` skips members with no person.

### Invariants

- At most 3 sent proactive messages per person in any 24 h.
- A slot held only for a message that went or may still go.
- A redelivered id counts once.

### Failure

Crash between `capTake` and the `person_cap` update: Taken without Marked. If a later dispatch ends the row before gate 9, no release runs. A slot leaks for 24 h. Low.

`failed_unknown` matches `NOT_SENT`, so a message that Cloud may have sent gives its slot back (D4). `refused_gateway` is not on this path. Number change (`pg-store.ts:365`) ends rows with no release.

A `blocked` row with `opted_out` at Cloud releases its slot. Correct.

Cap and quiet hours: gate 9 is after gate 5, so a deferred row holds no slot. A row that waits at `held_awaiting_reply` after `await_recipient` holds a slot until TTL.

### Quint notes

Merge into outbound-queue-row with a `slots: Person -> Set[Id]`. Invariant over accepted plus maybe-accepted rows. Good bound: 1 person, 4 rows, 2 apps.

## 13. line-conversation (P1, implicit)

Evidence: `oq:359-362`, `oq:396-402`, `oq:559-565`, `oq:638-665`.

States: no row (`isNew`), `unanswered` 0..n, `reengagement_used`. Line safety: `none`, `review`, `reply_only`, `pause_new`, others.

Transitions: accept increments `unanswered` unless compliance or the person already wrote after that time. `queue.inbound` resets to 0 and clears `reengagement_used`, and moves held rows to `pending`. `purge` deletes idle rows for non-phones. `setLineSafety` upserts or deletes.

Invariants: at most 3 unanswered; one re-engagement after 14 days; compliance always goes. The last fails for `review` (D9).

Failure: `isNew` is read before the send; two rows to a new address counted separately, one at a time under the line lock. Under Cloud, tapbacks and safety webhooks do not reach this service (D22). `queue.purge()` does not run in the deployed backend (D3). `reengagement` in `conv` and the Network's own `unsol` streak are separate counters of one idea.

Quint: merge into outbound-queue-row as `unanswered: Addr -> Int`.

## 14. message-status-mirror (P1, implicit)

Evidence: `rt:483-487`, `rt:612-618`, `rt:621-647`, `rt:649-655`, `svc:1009-1014`.

`network.messages.status` copies the queue's status after the fact. States: same strings, plus `queued` and `dry_run`. `notification_recorded_at`: null or set.

Transitions: written at save; `storeStatuses` after each drain; receipt; repair in `projectNotifications`.

Invariants: message status equals queue status once quiet. `notification_recorded_at` set at most once; Notify item recorded for each accepted member-facing send.

Failure:
- A crash between the queue's commit and `storeStatuses` leaves the mirror old. Repair covers only accepted statuses that still lack a marker. Rows that ended not sent stay `queued`.
- `BlooioAdapter.direct` calls `queue.drain()` and discards the changes (`ch:241`, D20). Member rows moved by that drain never update their mirror.
- `storeStatuses` has no rank check. A late drain result can overwrite `delivered` with `accepted`.
- `health()` counts `queued` as waiting (`rt:744`, `rt:760`). A stale mirror inflates `outboundWaiting` and the ops backlog alert for ever.
- `drainQueue` calls `projectNotifications` under the Network lock each time. It takes at most 50 rows.

Quint: merge with outbound-queue-row. Invariant `eventually mirror = status` fails, which shows D20.

## 15. notify-delivery (P1, implicit)

Evidence: `svc:649-688`, `packages/notify/src/scheduler.ts`, `ch:180`.

States of a delivery: `Planned`, `Recorded` (`notify.deliveries`, items `notified_at`), `Enqueued` (unit with outbound `ntf_` row), `Sent`, outcome `acted` or `ignored`. In-memory `notifyTargets` maps address to runtime and member.

Transitions: `plan` then re-read, `recordDelivery` first, `sink.enqueue` by unit. `stillNeeded` at gate 0.

Invariants: one text per delivery id; a crash loses at most one text; a queued digest is dropped when items expire or are all seen.

Failure:
- Recorded and then refused at the queue (`refused_person_cap`, `suppressed_ineligible`, `refused_opted_out`, `expired`): items are notified and never re-sent. No feedback path (D31).
- `notifyRecipient` sets `proactiveAllowed: true` for every member (`svc:657`), though the interface says it means paused, held or no proactive. The queue then refuses, and D31 applies.
- `notifyTargets` empty on a replica that did not plan: `plan` and `dispatch` run together, so this is safe. `target` missing logs and loses the text.
- `stale` fails open: `guarded(..., false)` at `oq:371`, against the comment at `oq:111`. A database error in `stillNeeded` sends a digest that should have been cancelled (D32).

Quint: P1, small. Model `recorded`, `enqueued`, `refused`. Merge with the notify agent's model.

## 16. unit-of-work (P1, implicit)

Evidence: `rt:53-69`, `rt:354-374`, `rt:454-562`, `rt:569-603`, `rt:671-675`, `packages/network/src/store.ts`.

States: `Idle`, `Locked`, `Loaded` (`load` resets the unit), `Running`, `Saving` (one tx: state, console rows, relay rows, `writeUnit`), `Committed` (sends in `committed`), `Unlocked`, `Delivering`.

Transitions: `withLock` waits; `withTickLock` skips when busy in process or locked elsewhere; `load`; `fn`; `save`; release; `deliver`.

Invariants: state and sends commit together. Reads under lock see the newest state. `this.unit` belongs to the lock holder.

Failure:
- Throw in `fn`: nothing saved; memory is replaced at next load. Exception: no stored state yet means `importState` is skipped and memory stays dirty. Edge.
- Crash between commit and `deliver`: rows wait; the next drain sends. For the dry-run adapter, `committed` and `retry` are in memory only, so a crash skips the consent check; those rows stay `dry_run`, and nothing leaves.
- `deliver` runs outside the lock, and queue gates read `rt.net` without the lock. They may see a later state or an older one. On a second replica the memory may lag by a tick. `rt.memberOf` lags the same way. A new member's first row drained by a stale replica ends `suppressed_ineligible` with reason `unknown_recipient` (D19).
- `tick()` calls `deliver()` even when the tick was skipped, so a stale `rt.net` is used exactly when another instance holds the lock.

Quint: model as the frame around other machines; do not model alone. One abstract `networkLock` and `save`.

## 17. tick-loop (P1, implicit)

Evidence: `packages/network/service/serve.ts:107-142`, `be:385-416`, `rt:658-668`, `svc:519-578`.

Two loops exist.

`startTicks` in `serve.ts` (dev and `main.ts`): inbox tick; each network tick with `busy` guard; `svc.purge()`; `notifyTick`. `setInterval` starts a new `loop` every 60 s with no overlap guard for the inbox, purge and notify parts.

`createBackend.tickAll` in `be` (deployed): each network tick; `notifyTick`; `ops.tick`. `ServiceLike` has no `purge` or `inboxTick` (`be:263-270`), and nothing in `deploy/` calls them (D3).

| Work | `serve.ts` | deployed |
|---|---|---|
| `rt.tick` | yes | yes |
| `notifyTick` | yes | yes |
| `ops.tick` | no | yes |
| `inboxTick` | yes | no |
| `svc.purge` (OTP, sessions, pending, rate windows, inbox seal, line counters, profile suggestions expiry) | yes | no |

States per network: `Idle`, `Busy`, `TickRan`, `TickSkipped`, `TickFailed`. `afterTick` runs only when `ran` (`rt:666`). `be:393` sets `tickDone` even when the tick was skipped, so a stuck lock passes `/healthz` (D33). `ops` `lastTickAgoMs` uses `max(stored, savedAt)` (`ops:201`), and `saved_at` moves on every unit, so inbound traffic hides a dead tick from `tick_late` (D33).

Invariants: review expiry, probes and reminders advance at most a minute late. Retention runs. Liveness of every TTL in sections 1 to 8 depends on this loop.

Quint: abstract as a fairness assumption on `tick` in other models. Do not model alone. Add a separate small model of "which work runs in which loop" only if the team wants it; a code fix is simpler.

## 18. photo-intake-consent (P1, implicit)

Evidence: `packages/network/service/photoIntake.ts`, `svc:1070-1076`.

States: `NoConsent`, `Asked` (`pending_texts` kind `photo_consent`, 1 day), `Agreed` (`profile.photoConsent=version`), `Declined`, `AskExpired`. Per-day buckets `photo_not_adult`, `photo_consent_ask`. Per-message bucket `photo_msg:<rowId>`.

Transitions: attachment with no consent: Asked. `YES PHOTOS` inside a day: Agreed if `mayTake` passes. `NO PHOTOS`: Declined. Attachment with consent: fetch, upload, reply.

Invariants: no byte fetched before membership, adult and consent checks. A minor's photo is never stored. Only an explicit reply counts. Consent is per version.

Failure:
- `photo_msg` is taken before the work. A handler throw then a retry gives `duplicate`, and the photo is lost. Low.
- `deletePending` before `putMembership`: crash loses the answer; the person is asked again.
- Key collision: `once()` replies with `sys:<rowId>`; a message with both an attachment and a keyword also uses `sys:<rowId>`. With the queue this is `IdempotencyConflictError` (`oq:250`). Same class as D14.
- Under Cloud, `mediaUrls` is `[]` (`svc:2069`), so `photosIn` never runs on the signed path. Photos by text do not work under Cloud. That is a design note, not a state bug.

Quint: P2 small. Skip unless consent copy changes.

## 19. ops-alert-dispatcher (P2, explicit)

Evidence: `ops:381-451`, migration 0020.

States per key: `Closed` (or no row), `OpenUnsent`, `OpenSent(level,count,at)`, `Resolving` (open, not seen, sent before), closed quietly. Rate limit: posts in the last hour.

Transitions: `dispatch` with current alerts. New alert: open. Due when never sent, level raised, bump count raised, or repeat interval passed. Not seen and sent: resolved notice; closes after an ok post. Not seen and never sent: closes quietly. Post held by limit: state unchanged.

Invariants: every alert that lasts past the repeat interval is posted again; at most `maxPostsPerHour`; one replica per round (try lock).

Failure: the webhook call runs inside the database transaction. A crash after the post re-sends. Failed posts count toward the limit. A level drop then rise to the last-sent level does not post. All harmless.

`sendOutcomes` has no case for `unknown_acceptance`, `collected` or `send_unknown`; they count as `attempted` (`ops:181-190`). This lowers the failure rate. Low.

No metric for held relay items (D15) or for `collected` age (D12).

Quint: optional, P2. Simple and already well tested.

## 20. cost-ledger-accrual (P2, implicit)

Evidence: `packages/network/service/cost.ts`, `ops:494-513`, migration 0020.

States: per-event rows (random id, append only) and per-day rows (fixed id, replaced). Budget share: `under`, `warn` (>=0.8), `bad` (>=1).

Invariants: no member id, phone or text. A failed write never fails the call. Accrual ids make a replay safe.

Failure:
- `fell_back` is never written by any code. `DeliveryStatus` does not contain it (`packages/blooio/src/types.ts:33`) and `PROVIDER_RANK` drops unknown statuses. `sms_fallback` rows can never appear (D34).
- `void ledger.record` is not awaited; a shutdown may lose rows.
- A day with no ops round has no line accrual; the code accrues only "today".
- Budgets only alert. No gate stops spend. This matches the docs.

Bias and SLA dedupe live here too: `weeklyBias` reads max(at), then inserts in another transaction. Two replicas can both write in one week, with different ids. Harmless. `slaAlerted` is in memory per instance.

Quint: no model needed. Fix D34 by code.

## 21. Adapters and direct texts (reference, not a machine)

`ChannelAdapter` chooses one of three static modes per process: dry run, Blooio, Cloud (`packages/network/service/main.ts:33-54`). Route policy forces dry run. `liveSendAllowed` needs three flags, read at enqueue and again at dispatch (`ch:94-96`, `oq:373`). A row enqueued while live and dispatched when not live ends `refused_not_approved`. While not live, `enqueue` writes no row; Network state still moves as if sent (`ch:217-221`). That is by design for staging, but a model must treat it as a send with no effect.

`direct()` (`svc:1367-1374`): in a turn to the sender it collects; otherwise it uses `adapter.direct`, which enqueues and drains at once.

## 22. Suspected defects

Confidence: high = I traced each step in the code. Medium = the code path is clear, but impact depends on something I could not read (upstream Cloud, deployment). Low = plausible, narrow.

### D1. Withdrawal does not stop a queued number share (P0, consent)
Where: `re:212-220`, `desk:308-312`, `rt:238-269`, `net:3888`.
Trigger: A and B both ask at 20:58 and 21:02. Both shares pass. Kind `relay` is logistics, so at quiet hours each waits in `Network.deferred`, or a row waits in the queue (unanswered cap, line safety). A says "don't send my number". `parseRelayRequest` gives `none`, `withdrawsSwap` is true. `relayCancelSwap` removes nothing, because `swaps` is already empty. The service answers "Okay, I won't share your number." The result of `relayCancelSwap` is ignored. In the morning A's number goes to B. `relayDispatchCheck` and `relayAdmission` read no withdrawal and do not re-check the 15 minute consent TTL.
Confidence: high. The test `relay.test.ts:127` covers pending swaps only.

### D2. A swap can go one way (P0, privacy)
Where: `desk:284-300`, `oq:398-402`, `oq:429-433`.
Trigger: both shares are enqueued as `relay:X` to A and `relay:Y` to B. B has 3 unanswered messages. Row X goes. Row Y goes to `held_awaiting_reply` and expires after 3 days, or Y parks in leak review, or fails at the provider. A has B's number; B has nothing. The comment at `desk:285` claims this cannot happen, but it holds only up to the send path.
Confidence: high on the path; medium on how often.

### D3. Deployed backend never runs purge or the inbox tick (P1, privacy and liveness)
Where: `be:388-416`, `be:263-270`, `svc:568-578`, `serve.ts:124-136`.
Trigger: run the deployed backend. `tickAll` calls `rt.tick`, `notifyTick`, `ops.tick`. Nothing calls `svc.purge()`. So expired OTP challenges, sessions, rate windows and pending texts stay. `platform.inbound` signed turns are never sealed: replies, responses and action receipts stay for ever. Line counters stay. `profileSuggestions.expirePending` does not run. `inboxTick` is also missing, so a legacy-webhook row left `pending` by a crash waits for that sender's next message.
Confidence: high (grep of `deploy/` and `scripts/*.ts` finds no caller; only `serve.ts` and `svc.tick` call them). The README table describes the `serve.ts` loop.

### D4. Rows older than 6 h get no receipt lookup (P1, cap and delivery)
Where: `oq:583-589`, then `oq:345`.
Trigger: a row is created, waits 7 h at `held_awaiting_reply`, the person writes, the row goes to `pending`. Cloud times out at 10 s: `unknown_acceptance`. On the next drain `created_at < now - 6 h` is true, and the row ends `failed_unknown` before the lookup at `oq:591` runs. Cloud may have sent it. `end` releases the person cap slot because `failed` matches `NOT_SENT`, so a fourth proactive message can go that day. Line counters, Notify and `delivered` are not updated. The TTL should run from the time acceptance became unknown.
Confidence: high.

### D5. Two networks of one app corrupt each other's queue (P1, latent)
Where: `oq:288-289`, `ch:173-207`, `rt:169-170`, `ch:180-186`.
Trigger: add `slop:sf`. Both runtimes get a queue with `app='slop'` and the same line. `drain` selects all rows of that app and line. The sf queue picks an nyc member's row. Its `checks` use the sf `rt`: `memberOf` misses, `unknown_recipient`, `suppressed_ineligible`. For a relay row `opps.get(oppId)` misses, `?? "closed"` is `closed`, and the row ends `expired`. `relayAdmission` reads the wrong `network_state` too. Which runtime wins is a race.
Confidence: high on the code. Latent: only nyc rows exist in migrations, but the service, `runtimeForHome` and migration 0031 are built for a second city.

### D6. Staff can approve past the deadline (P0, review gate)
Where: `net:1889-1933`, `net:1941-1956`, `net:3345`.
Trigger: an item's deadline passes at 12:00:10. The next tick is at 12:00:50, or it is skipped because a unit holds the lock. A reviewer approves at 12:00:30. `decide` has no clock check, so the item goes to `probing`. AGENTS: "an item past its SLA expires unsent". `reroll` also gives an overdue item a new deadline.
Confidence: high. Window is about one tick, longer if ticks skip.

### D7. A failed ban cannot be resumed (P0)
Where: `svc:1742-1743`, `svc:1744-1763`.
Trigger: ban rows commit, `people.memberships` or a unit fails. Staff retry: `isBanned` is true, answer `already_banned`, nothing runs. Memberships stay active, Network state stays unheld, ratings may stay. Send-time consent still refuses sends, so the worst case is staff and matching state, not a text. `hold` has the same shape with no resume guard needed, since `holdMember` is idempotent.
Confidence: high on the path; impact medium.

### D8. A STOP turn waits on the line lock and remote lookups (P1)
Where: `svc:1056`, `svc:1329`, `rt:671-675`, `rt:614`, `oq:284-303`, `oq:593-596`, `oq:505-506`.
Trigger: Cloud is slow. 20 rows are due. A drain holds `blooio-line` for up to 20 x 10 s. A STOP turn commits its ledger event, then `unitOfWork` calls `deliver`, which waits for the line chain, after up to 4 x 10 s of receipt lookups of its own. The response carries `consent`, which the gateway copies to its fence. It arrives after the 8 s budget. The gateway retries and gets `turn_busy`. The ledger is correct, and the queue reads it, but Cloud's fence is late. Every signed turn has the same latency path. A collected turn has no need to drain.
Confidence: high on the path; medium on impact (upstream retry not read).

### D9. Line safety holds compliance texts (P1)
Where: `oq:407`, against `oq:23`, `ops:129`, `ops:303`.
Trigger: `safety.number_banned` sets `review`. A queued STOP confirmation reaches gate 7. `action === "review"` has no compliance exception. The row goes to `retry_scheduled` each hour and expires after 3 days. `reply_only` and `pause_new` also stop a compliance text to a new address. The ops alert says "STOP and HELP still go". On the signed path these are collected, so this affects the legacy path and non-causal rows.
Confidence: high.

### D10. `wait` and `end` have no status guard (P1)
Where: `oq:337-353`, `oq:505-528`, `rt:548-550`.
Trigger: erasure sets a `sending` row to `dropped_forgotten`, clears body and address. The provider then fails retryably. `wait` sets `retry_scheduled` by id. The row is back in the queue with null fields. Next drain: `policy(null)` fails, and it ends `suppressed_ineligible`, or stays `unknown_acceptance` for 6 h. Nothing leaks because the text is gone, but "statuses never go back" is false, and the same race applies between a stale `dispatch` read and `decideLeak`, number change, or `inbound`. `end` from a stale read can also overwrite `delivered`.
Confidence: high on the path; impact low.

### D11. `accepted` never ends under Cloud (P1, privacy)
Where: `cc:54`, `oq:539-551`, `svc:1009-1014`, AGENTS 2026-10-09 item 2.
Trigger: staff invite under Cloud. `direct` enqueues a row with no member. Cloud accepts. Status `accepted`. No webhook reaches the service, so `end` never runs. `to_address` and `body` of a non-member stay, against `oq:32`. No retention code deletes `platform.outbound` rows at all.
Confidence: high for the code; medium that no other process touches the table (I searched packages, deploy and scripts).

### D12. Collected replies have no timeout (P1)
Where: `rt:483-490`, `oq:696-703`, `svc:2009-2043`.
Trigger: the gateway dies after the turn, or the turn fails after a unit committed. `network.messages` and `outbound` stay `collected`, or `send_unknown` with `ended_at` null, for ever. Ops counts them as `attempted`.
Confidence: high.

### D13. A guard-failed reply can skip leak review (P1)
Where: `rt:473-477`, `oq:383-389`, `svc:1027`, `svc:2088`.
Trigger: a member's first message in 2 hours. The reply fails the guard, goes to the queue, and drains inside the turn. `engaged` has not run. Gate 4 ends it `suppressed_ineligible`. It is never parked, so staff see nothing. Nothing is sent, so safety holds, but the review path the comment promises is missed and the member gets no reply.
Confidence: high.

### D14. Same id for two direct texts; STOP stranger gets the join ask in a turn (P1, consent)
Where: `svc:1413`, `svc:1144`, `svc:1161`, `svc:1369-1371`, `oq:249-250`.
Trigger, queue path: a stranger who sent STOP texts again. `join` sends the ask with id `sys:<rowId>`. `stopHint` takes its `hit`, then sends with the same id and other text. `IdempotencyConflictError` throws. The inbox retries. The ask is a no-op, `hit` refuses the hint, and the turn ends with no hint at all.
Trigger, signed path: both go to `replies` with the same id, the ask is not refused, and `replyKind` is `reply`. The comment at `svc:1143` says the ask "is refused at send time", which is true only for the queue. Whether the gateway fence stops it, I could not read.
Confidence: high on this repo's side. The dry-run test at `service-platform.test.ts:442` cannot see this.

### D15. Held relay items have no SLA and no alert (P1)
Where: `desk:405-407`, `ops.ts` (no relay metric).
Trigger: an item is held. No staff act. It stays in `held`, with the sender's text in `network_state`, for ever. `prune` keeps `held`. The sender was told "a quick check".
Confidence: high.

### D16. An erased member's number stays in the recipient's rows (P0, privacy)
Where: `rt:529`, `rt:548-550`, `desk:262`, `desk:398-402`.
Trigger: a swap completes. A deletes everything. `network.messages` and `platform.outbound` rows with `member_id=B` still hold the rendered text with A's number. `desk.forget` clears thread messages, but those rows are not touched. A waiting row is refused at admission, but its body also stays.
Confidence: high on the data; medium on whether this counts as B's own history.

### D17. A staff release can be a silent no-op (P1)
Where: `svc:2336-2343`, `oq:371`, `oq:383-389`.
Trigger: a parked `reply` is released 2 hours later, or a proactive row at 25 hours. The API says `ok:true`. The row ends `suppressed_ineligible` or `expired`. Staff are not told.
Confidence: high.

### D18. Some staff actions audit only after the action (P1)
Where: `svc:2461-2468`, `svc:2336-2342`, `svc:2351-2352`, `svc:2267-2268`. See section 11.
Trigger: a crash or audit failure after commit leaves an action with no row, against `svc:1519`.
Confidence: high.

### D19. In-memory gates can be stale on a second replica (P0, multi-replica)
Where: `ch:180-186`, `rt:408-409`, `rt:663`, `net:4215-4238`, `net:1311-1324`.
Trigger: replica A holds a member (trust score in state only). Replica B's tick is skipped because A holds the lock, but `deliver` still runs, and `policy` reads B's old `rt.net`. A transactional row to the held member passes. Relay rows are safe (admission reads state). Other rows are not. Also: a new member's row drained by B ends `suppressed_ineligible` with `unknown_recipient`, losing the welcome. The README says every replica may drain.
Confidence: high on the code; depends on replica count, which I could not confirm from `deploy/`.

### D20. `BlooioAdapter.direct` drops drain results (P1)
Where: `ch:241`, `oq:282-303`.
Trigger: a legacy join reply calls `queue.drain()`, which ends other members' rows. The changes are discarded. Their `network.messages.status` stays `queued`. Repair covers only accepted rows. `health` backlog stays high.
Confidence: high.

### D21. `in_doubt` is never read (P2)
Where: `oq:274`, `oq:313`. Written and copied to `QueueRow`, then unused. Confidence: high.

### D22. Line safety and tapbacks do not reach the service under Cloud (P1)
Where: `svc:1016-1022`, AGENTS 2026-10-09 item 2. `platform.line_safety` can never be set, so gate 7 and the `line_safety` alert are dead under Cloud. Tapbacks do not reset the streak. Confidence: high here; Cloud may enforce its own.

### D23. A crashed relay action key stays `processing` (P1)
Where: `re:193-203`, `re:197`. A retry gets 409 `retryable:false`. No sweep. The member's item is lost. The same shape is in `svc:1896`. Confidence: high.

### D24. A post-commit delivery error returns failure (P1)
Where: `rt:616-617`, `re:256-260`. The row is committed and will go; Cloud gets 409 non-retryable. A replay would answer correctly, but the error says not to retry. Confidence: high.

### D25. `rec.review === "rejected"` is unreachable (P2)
Where: `rt:253`, `desk:369-376`. Confidence: high. Keep it as a defensive check, or drop it.

### D26. Desk-held photo items cannot be decided (P2, feature off)
Where: `desk:238-244`, `desk:319-321`, `svc:2430-2461`, `re:226-237`.
Trigger: a party is on a safety hold when the photo request runs. The desk logs a hold with id `pri_...`. Release: `selected` branch, `prior` says held, answer not ok. Reject: `photoRelay.review`, desk row stays `held` for ever. A rate hold on a fixed id also makes a later try replay "held", against `desk:236`.
Confidence: medium.

### D27. Swap ask result ignored, and the ask can arrive after its window (P1)
Where: `desk:281`, `desk:154`. Confidence: high.

### D28. Expired photo items never leave `pending` or `approved` (P2)
Where: `pr:104`, `pr:66-68`. `list` and `held` re-check each one for ever. Confidence: high.

### D29. One bad stored row stops the app's drain (P2)
Where: `oq:291`, `oq:306-309`. `rowOf` throws outside the `try`. Also at `oq:326`, `oq:586`, `oq:594`. Confidence: medium (needs a stored row that later fails the parser).

### D30. Peon review SLA alert cannot fire (P2)
Where: `svc:534`, `svc:2556`, `packages/observatory/src/apps.ts:68`, `net:578`. Peon 24 h, expiry 12 h. Same-day items expire at 1 h for every app. Confidence: high.

### D31. A Notify digest refused at the queue is lost; `proactiveAllowed` is constant (P1)
Where: `packages/notify/src/scheduler.ts:185-199`, `svc:657`. Confidence: high.

### D32. `stale` fails open (P2)
Where: `oq:371`, `oq:111`. Confidence: high.

### D33. Tick health can hide a dead tick (P2)
Where: `be:392-393`, `ops:201`, `rt:756`. A skipped tick counts as done. Any unit's save counts as a tick. Confidence: high.

### D34. `sms_fallback` cost is unreachable (P2)
Where: `cost.ts:13`, `ops:188`, `ops:242`, `packages/blooio/src/types.ts:33`. No writer of `fell_back`. Confidence: high.

## 23. Modelling plan

1. `OutboundQueue.qnt`: sections 1, 2, 3, 12, 13, 14. Two workers, Cloud as a second party, one line. This one spec catches D4, D5 (with two queues), D9, D10, D12, D13, D19.
2. `Relay.qnt`: sections 4, 5, 6, using the queue as an abstract `rowEnds(id, outcome)`. Catches D1, D2, D23, D24, D27.
3. `PhotoRelay.qnt`: section 7, standalone. Gate it behind the policy switch.
4. `StaffReview.qnt`: section 8 with the opportunity core, with a clock. Catches D6.
5. `SafetySaga.qnt`: section 10, standalone. Catches D7.
6. No Quint needed: D3, D15, D18, D20, D21, D25, D30, D34. These are wiring or dead code, and a review or a test finds them faster.

Fairness assumption for every liveness property: `tick` runs for each network, and `purge` runs. D3 shows the second is false in deployment today.
