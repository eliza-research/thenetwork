# State machines: packages/blooio and packages/notify

Key: `blooio-notify`. Research only. Hand-written from a full read of the two packages, plus the call sites they depend on. No code was changed and nothing was run.

Abbreviations used for paths:

- `Q` = `packages/blooio/src/outbound-queue.ts`
- `CH` = `packages/network/service/channel.ts`
- `CC` = `packages/network/service/cloud-channel.ts`
- `RT` = `packages/network/service/runtime.ts`
- `SV` = `packages/network/service/service.ts`
- `SCH` = `packages/notify/src/scheduler.ts`
- `ST` = `packages/notify/src/store.ts`
- `PG` = `packages/notify/src/pg-store.ts`
- `RET` = `packages/notify/db/retention.sql`

Confidence words: **high** means the code path was read end to end. **medium** means the path was read but the trigger depends on timing or on a deploy fact. **low** means the path is real but the effect is small or the trigger is unlikely.

## 1. Summary

| Id | Name | Kind | Priority | Where the state lives |
|---|---|---|---|---|
| outbound-row | Outbound row lifecycle | explicit | P0 | `platform.outbound.status` |
| line-drain-lease | Line lock, row claim, lease | implicit | P0 | advisory lock, `lease_owner`, `lease_until`, `lineChains` |
| unknown-acceptance | Provider acceptance in doubt | explicit | P1 | `status='unknown_acceptance'`, `in_doubt` |
| provider-idempotency | Provider send handshake | implicit | P1 | key `tn:<id>`, `fingerprint` |
| delivery-receipts | Provider status ladder | explicit | P1 | `status`, `delivered_at`, `read_at` |
| collected-reply | Replies another transport sends | explicit | P0 | `status` in collected, send_unknown, sent, refused_gateway |
| leak-review | Leak parking and staff decision | explicit | P0 | `parked_leak_review`, `leak_released_by` |
| line-conversation | Apple streak and re-engagement | implicit | P1 | `platform.line_conversations` |
| line-safety | Blooio safety state of the line | explicit | P1 | `platform.line_safety` |
| person-cap-slot | Daily proactive slot per message | implicit | P0 | `platform.person_sends`, `outbound.person_cap` |
| quiet-hours | Deferral by local time | implicit | P0 | `deferred_quiet_hours`, `next_attempt_at`, `time_zone` |
| webhook-intake | Signature window and event parse | implicit | P0 | header timestamp, no store for non-message events |
| message-status-mirror | Queue status copied to messages | implicit | P1 | `network.messages.status`, `notification_recorded_at` |
| notify-item | Inbox item lifecycle | implicit | P1 | `notify.inbox_items` timestamps |
| notify-delivery | Delivery outcome | explicit | P2 | `notify.deliveries.outcome` |
| notify-dispatch | Plan, record, enqueue handshake | implicit | P1 | `deliveries` row, queue row, `notifyTargets` map |
| notify-weekly-cap | Rolling 7-day interruption cap | implicit | P1 | `deliveries.counts_toward_cap`, `sent_at` |
| notify-token | Task token | implicit | P2 | `notify.task_tokens` |
| notify-surface | Surface signal and ignored streak | implicit | P2 | `notify.surface_signals` |
| notify-projection | Accepted send to inbox item | implicit | P1 | `recordSent`, `notification_recorded_at` |
| notify-erasure | Erasure fences | implicit | P0 | triggers and `notify.forget_data` |

Not machines: `fmtCache` in `quiet-hours.ts` is a pure memo. `DryRunAdapter` in `packages/blooio/src/adapters/blooio-adapter.ts` has a counter with no lifecycle. `resolveSenderLine` is pure.

Three deploy facts shape this document:

1. In production the gateway owns the Blooio webhook (AGENTS.md, founder decisions 2026-10-09, item 2). `/webhooks/blooio` is the only route that yields `status`, `safety` and `reaction` events (`SV:1007-1023`, `SV:2517-2518`). A signed turn needs non-empty text (`SV` turn validation), so it cannot carry them.
2. In production the provider is `CloudChannelAdapter`. It has `receipt`, and it always returns `status: "queued"` (`CC:54`).
3. No production code calls `Notifier.add` with new work. Only `recordSent` writes items (`SV:625`). The other callers are tests. `packages/notify/README.md:41` says the same.

## 2. outbound-row (P0)

### Where

`platform.outbound` (migration 0015, then 0022, 0032, 0037). `status` is free text. There is no CHECK constraint on it (`0015_outbound_queue.sql:33`). `kind` has one (`:26`).

Other lifecycle columns: `attempts`, `next_attempt_at`, `lease_owner`, `lease_until`, `in_doubt`, `person_cap`, `new_conversation`, `reengagement`, `sent_at`, `delivered_at`, `read_at`, `ended_at`, `last_error`, `note`, `leak_released_by`.

### States

| Group | States |
|---|---|
| Entry | `pending`, `parked_invalid_timezone`, `collected` (see section 7) |
| Due (`DUE`, Q:192) | `pending`, `retry_scheduled`, `deferred_quiet_hours` |
| Waiting, not due | `held_awaiting_reply` |
| Claimed | `sending` |
| In doubt | `unknown_acceptance` |
| In flight (`IN_FLIGHT`, Q:191) | `accepted`, `sent` |
| Delivered | `delivered`, `read` |
| Parked with an exit | `parked_leak_review` |
| Parked with no exit | `parked_error`, `parked_invalid_timezone` |
| Terminal, not sent | `expired`, `refused_not_approved`, `refused_opted_out`, `refused_person_cap`, `suppressed_ineligible`, `dropped_forgotten`, `dropped_leak_review`, `blocked`, `failed`, `failed_unknown` |
| Implied | no row (enqueue never ran), ended row with null body and address |

`queued` from a provider is mapped to `accepted` (Q:539). It is never stored on a row.

`WAITING` (Q:189) is the set that erasure ends. It holds `pending`, `retry_scheduled`, `deferred_quiet_hours`, `held_awaiting_reply`, `sending`, `unknown_acceptance`. `OUTBOUND_WAITING` in `packages/platform/src/pg-store.ts:33` is smaller: no `sending`, no `unknown_acceptance`.

### Transitions

Triggers: W = queue worker (cron tick or a unit's delivery), P = provider response, M = member inbound, S = staff, C = clock inside a check, E = erasure or number change.

| From | Event and guard | Effects | To | Evidence | Who |
|---|---|---|---|---|---|
| none | `enqueue`, agent kind, no zone | row written, alert, `ended_at=now` | `parked_invalid_timezone` | Q:234-246 | W caller |
| none | `enqueue`, otherwise | row written in the caller's tx | `pending` | Q:237-243 | W caller |
| none | `enqueue`, same id, same fingerprint | no-op | unchanged | Q:249-250 | W caller |
| none | `enqueue`, same id, other fingerprint | `IdempotencyConflictError` | unchanged | Q:250 | W caller |
| DUE | `tooOld` or `stale` | `end` | `expired` | Q:371 | C |
| DUE | `live()` false | `end` | `refused_not_approved` | Q:373 | W |
| DUE | not compliance, `optedOut` true or throws | `end` | `refused_opted_out` | Q:376 | W |
| DUE | not compliance, `recipient` not ok or throws | `end` | `suppressed_ineligible` | Q:378-379 | W |
| DUE | `reply`, no inbound in the window | alert, `end` | `suppressed_ineligible` | Q:383-388 | W |
| DUE | agent kind, zone invalid | `end` | `parked_invalid_timezone` | Q:392 | W |
| DUE | agent kind, quiet now | `wait` to next allowed time | `deferred_quiet_hours` | Q:394 | C |
| DUE | not compliance, `unanswered>=3`, no re-engagement | `wait` | `held_awaiting_reply` | Q:398-401 | W |
| DUE | line safety holds it | alert, `wait` +1 h | `retry_scheduled` | Q:407-409 | W |
| DUE | a line or recipient cap is full | `wait` +5 min or +1 h | `retry_scheduled` | Q:418-420 | W |
| DUE | proactive, `capTake` false or throws | `end` | `refused_person_cap` | Q:424 | W |
| DUE | leak reasons found, not released | alert, `end` (keeps text) | `parked_leak_review` | Q:429-433 | W |
| DUE | admission: member gone or removed or invited, or no binding | `end` | `dropped_forgotten` | Q:474, 486 | W |
| DUE | admission: proactive and account not active | `end` | `suppressed_ineligible` | Q:477 | W |
| DUE | admission: opted out | `end` | `refused_opted_out` | Q:488 | W |
| DUE | admission: `admit` not ok | `end` | `suppressed_ineligible` | Q:491 | W |
| DUE | admission: claim matches | `attempts+1`, lease set | `sending` | Q:492-496 | W |
| DUE | admission: row changed or leased | nothing written | other worker's status | Q:498-499, 502 | W |
| DUE | admission: row content differs, same status | `end` | `dropped_forgotten` | Q:500 | W |
| any in dispatch | hook or DB throw | alert, `end` | `parked_error` | Q:295-298 | W |
| `sending` | receipt ok, CAS on `sending` or `unknown_acceptance` | `sent_at`, conversation update | `accepted`, `sent` | Q:543-568, 572 | P |
| `sending` | receipt `delivered` or `read` | as above, then `end` | `delivered`, `read` | Q:571 | P |
| `sending` | receipt `failed` | as above, then `end` | `failed` | Q:570 | P |
| `sending` | receipt commit finds no row | nothing | reports `dropped_forgotten` | Q:569 | P |
| `sending` | failure `unknown` | `wait` | `unknown_acceptance` | Q:513-514 | P |
| `sending` | failure `retryable`, attempts left | backoff `wait` | `retry_scheduled` | Q:515-518 | P |
| `sending` | failure `retryable`, attempts used | alert, `end` | `failed` | Q:516 | P |
| `sending` | failure `await_recipient` | `wait` | `held_awaiting_reply` | Q:520-521 | P |
| `sending` | failure `blocked` | alert, `end` | `blocked` | Q:522-524 | P |
| `sending` | failure `invalid`, `auth` | alert, `end` | `failed` | Q:525-527 | P |
| `sending` | lease ran out, provider has `receipt` | `in_doubt=true` | `unknown_acceptance` | Q:273-276 | C |
| `sending` | lease ran out, no `receipt` | `in_doubt=true` | `retry_scheduled` | Q:273-276 | C |
| `held_awaiting_reply` | person wrote | `next_attempt_at=now` | `pending` | Q:642-643 | M |
| `held_awaiting_reply` | past its TTL | `end` | `expired` | Q:319-328 | C |
| `accepted`, `sent` | receipts | see section 6 | `sent`, `delivered`, `read`, `failed` | Q:612-632 | P |
| `parked_leak_review` | staff release, body and address present | `leak_released_by` set | `pending` | Q:726-730 | S |
| `parked_leak_review` | staff drop | `end` | `dropped_leak_review` | Q:724 | S |
| WAITING | member forgotten | body and address null | `dropped_forgotten` | RT:548-550 | E |
| `pending`, `retry_scheduled`, `deferred_quiet_hours`, `held_awaiting_reply` | number change | address null | `suppressed_ineligible` | `pg-store.ts:365-367` | E |

Check order in `dispatch` (Q:364-435) is itself a sequence: expiry, live, consent, recipient, reply window, quiet hours, streak, line safety, caps, person cap, leak guard, admission, claim, send. Compliance rows skip consent, recipient, streak and caps. They do not skip expiry, live, line safety or the leak guard.

### Invariants

Safety:

- `INV-CONSENT`: no non-compliance row reaches `sending` while the ledger or the member flag says opted out at admission (AGENTS.md hard rules; PRD 40.3).
- `INV-BAN`: no non-compliance row reaches `sending` for a banned number (decision 3 of 2026-10-09). `consentRefused` covers it (`SV:709`).
- `INV-LEAK`: a row reaches `sending` only with empty leak reasons, or with `leak_released_by` set (AGENTS.md code invariants).
- `INV-MINOR`: a row about others is never sent to a minor. This rests on the `recipient` hook. See defect BL-16.
- `INV-LIVE`: no provider call unless `live()` was true in this dispatch.
- `INV-ONCE`: per row, the provider sees one key. At most one worker holds a row in `sending`.
- `INV-ERASE`: after a forget, the row has null body and address, and no later transition sets them again.
- `INV-MONO`: statuses do not go back (Q:31).
- `INV-NONMEMBER`: a row with null `member_id` keeps address and text only until it ends (Q:32).

Liveness:

- `LIVE-END`: every row reaches a terminal state in bounded time, given fair ticks. This fails today. See BL-4 and BL-5.
- `LIVE-WAKE`: a held row becomes due once the person writes, if the row is still inside its TTL. This fails today. See BL-2.

### Interactions

- Written in the same transaction as the Network state and `network.messages` (`RT` writeUnit, `RT:457-460`).
- Reads `platform.line_conversations`, `platform.line_safety`, `platform.person_sends`, the consent ledger, `network.members`, `platform.memberships`, `platform.phone_identities`, `notify.*` for `ntf_` rows.
- Row fences shared with erasure: person row lock, then member row lock (Q:471-473).

### Concurrency and failure

| Case | Result |
|---|---|
| Crash after enqueue commit, before drain | Row waits. Next tick drains it. Fine. |
| Crash after claim commit, before the provider call | `sending` until the lease ends, then recover. |
| Crash after the provider accepted, before `acceptReceipt` | Same. With `receipt`, a lookup recovers it. Without it, the same key is sent again. |
| Crash after `acceptReceipt` for `failed`, before `end` | Status is right. The cap slot is not released. Low. |
| Crash after capTake, before `person_cap=true` (Q:424-425) | Slot is held. A retry finds the msg id and does not count twice. If the row then ends before step 9, the slot stays until the window ends. Low. |
| `acceptReceipt` throws a DB error | It is inside the `try` at Q:505-507, so it maps to `retryable`. The provider replays the key. Fine. |
| Duplicate enqueue | No-op by id and fingerprint. |
| Clock skew | `lease_until` and all windows use the app clock. Two replicas with skew above `leaseMs` could recover a live lease. `acceptReceipt` still commits. Low. |

## 3. line-drain-lease (P0)

### Where

- In-process chain: `lineChains`, a WeakMap of pool to line to promise (Q:203, 256-268).
- Session advisory lock: `pg_advisory_lock(hashtext('blooio-line:<line>'))` on a reserved connection (Q:260-264).
- Row lease: `lease_owner`, `lease_until`.

### States

Lock: free, chained in process, waiting for the advisory lock, held. Lease: none, held and live, held and expired.

### Transitions

| From | Event | Guard | To | Evidence |
|---|---|---|---|---|
| free | `withLine` | previous chain settled | held | Q:259-263 |
| held | fn ends or throws | always | free | Q:264 |
| held | connection dies | server side | free | Postgres behavior |
| no lease | claim | status same, `lease_until is null`, address, body and fingerprint same | live | Q:492-495 |
| live | receipt, `wait`, or `end` | none | no lease | Q:342, 351, 549 |
| live | clock passes `lease_until` | none | expired | C |
| expired | `recover` | `status='sending'` | no lease | Q:274-276 |

`recover()` and `reconcileUnknown()` run outside the lock (Q:284-285). Everything else in `drain` runs inside it. `inbound`, `applyStatus`, `decideLeak`, `setLineSafety`, erasure and number change never take it.

### Invariants

- At most one drain per line across apps and processes.
- A claim happens only with no lease.
- Provider calls hold no row locks (the admission tx ends first, Q:467-503). They do hold the advisory lock, so one slow provider call delays every app on the line.

### Defects

See BL-3 and BL-6.

### Quint notes

Merge with outbound-row. Model the lock as a variable `drainer: Option[Worker]`. Do not model `lineChains`. Bound: 2 workers, 2 rows, 1 line.

## 4. unknown-acceptance (P1)

### States

`unknown_acceptance` plus `in_doubt`. Exits: `accepted` family, `retry_scheduled`, `failed_unknown`, `dropped_forgotten`.

### Transitions

| From | Event | Guard | Effects | To | Evidence |
|---|---|---|---|---|---|
| `sending` | `ChannelSendError` unknown | none | `wait` | `unknown_acceptance` | Q:513-514 |
| `sending` | lease ran out | provider has `receipt` | `in_doubt` | `unknown_acceptance` | Q:273-276 |
| `unknown_acceptance` | age from `created_at` above `unknownTtlMs` | runs first, limit 50 | alert, `end` | `failed_unknown` | Q:584-588 |
| `unknown_acceptance` | receipt returns | row present and unchanged | as acceptance | `accepted` etc | Q:596 |
| `unknown_acceptance` | receipt says `not_found` | CAS on status | same key later | `retry_scheduled` | Q:598-602 |
| `unknown_acceptance` | receipt ambiguous | none | mirror only | unchanged | Q:605 |
| `unknown_acceptance` | member forgotten | WAITING | null body and address | `dropped_forgotten` | RT:548-550 |

`CC:60-61` maps a Cloud receipt answer of `rejected` with `retryable` to `not_found`.

### Invariants

- A row in doubt is never sent again unless the provider says it never admitted the id.
- A row that went out must not be recorded as not sent.

The second one fails. See BL-1.

### Quint notes

Merge with outbound-row. Add a provider variable `admitted: Set[Id]`. A nondeterministic timeout branch lets `send` admit and still report unknown. Check: `failed_unknown` implies not `admitted`. Expect a counterexample until BL-1 is resolved.

## 5. provider-idempotency (P1)

The key is `tn:<id>` on every attempt (Q:533). `fingerprint` binds the address, text, media, kind and photos (Q:197-199). The claim and the receipt commit re-check them (Q:494-495, 552-553).

The Blooio window is 24 hours in the v2 docs (`docs/research/blooio.md:56-57`). A row that is sent, then lost, then held past 24 hours by a line-safety wait could send twice on the raw provider path. In production Cloud owns the key and the id is the same (`CC:34`). Treat the window as a constant in the model.

`BlooioClient.send` throws `retryable` for a transport error (`client.ts:215`), so the raw path never reaches `unknown_acceptance` through `send`. It reaches it only by the path in `acceptReceipt` (Q:541), and then waits for the TTL, as the raw adapter has no `receipt`.

Quint: model as a map from key to first accepted body. Check that replay returns the first result.

## 6. delivery-receipts (P1)

### States

`accepted` (rank 1), `sent` (2), `delivered` (3), `read` (4), `failed`. `PROVIDER_RANK` at Q:193.

### Transitions

| From | Event | Guard | To | Evidence |
|---|---|---|---|---|
| `accepted`, `sent` | `failed` receipt | in flight | `failed` | Q:617-620 |
| any ranked | status of higher rank | rank rises | that status | Q:622-631 |
| any | provider id unknown | no row | ignored | Q:613-614 |
| `delivered`, `read` | `failed` | not in flight | ignored | Q:618 |
| not ranked | any non-failed | no rank | ignored | Q:623 |

`applyStatus` is a read followed by an unconditional update, so `INV-MONO` holds only without a race. See BL-11.

In production nothing calls `applyStatus`. See BL-4.

Only `provider_message_id` is matched (Q:613). It is the first id of `provider_message_ids`. A receipt for a later id of a multi-part send is ignored.

Quint: small module alone, or an action inside outbound-row. Check rank monotonic per row with two concurrent webhook actions split into read and write steps.

## 7. collected-reply (P0)

### Where

Rows in `platform.outbound` with `status='collected'`. Used for signed turns, where Cloud sends the reply and the row only feeds the thread leak check.

### States

`collected`, `send_unknown`, `sent`, `refused_gateway`.

### Transitions

| From | Event | Guard | Effects | To | Evidence |
|---|---|---|---|---|---|
| none | `recordCollected` in the unit tx | member ok, has address, leak check passed | row | `collected` | RT:475-477, 490; Q:684-692 |
| `collected`, `send_unknown` | receipt accepted | status in set | `sent_at`, `ended_at` | `sent` | Q:696-702 |
| `collected`, `send_unknown` | receipt unknown | status in set | `ended_at=null` | `send_unknown` | Q:698-702 |
| `collected`, `send_unknown` | receipt rejected | status in set | `ended_at` | `refused_gateway` | Q:698-702 |
| any | member forgotten | not in WAITING | body and address null, status kept | same | RT:548-550 |

A reply that fails `collectedLeaks` leaves the collected set and goes through the queue (RT:474-478).

`SV:2015-2045` guards the receipt: exact reply ids, one receipt hash, an unknown receipt can advance to accepted or rejected.

### Invariants

- Each collected reply has passed the leak guard before Cloud sees it.
- Only accepted replies enter the thread history (`sent_at` not null). `threadOf` needs `sent_at` (Q:457-459).

### Failure

If the gateway never sends a receipt, the row stays `collected` for good, with body and address. No sweep exists. `collected` and `send_unknown` are not in `WAITING`, so the backlog count does not see them. See BL-5.

Quint: model with the turn and receipt machine of `platform.inbound`. That machine is owned by the network service scope. Merge there, not here.

## 8. leak-review (P0)

Entry: dispatch at Q:429-433 and `collectedLeaks` fallback. Exit: `decideLeak` (Q:720-731) through `SV:2310-2344`, safety role, reason of 5 or more characters, audited.

Guards:

- Release is refused for a member whose age is in doubt (`SV:2334`).
- Release needs body and address (Q:726).
- `end` with `parked_leak_review` keeps text for a non-member (Q:340).

After release the row passes every check but the leak guard (Q:429). So a text can pass with a thread that changed after the staff decision. This is a design choice, and a model must allow it.

No timeout exists on parked rows. `end` already released the cap slot when the row was parked (Q:345), and a release re-enters step 9, so `capTake` runs again.

`movePhone` ends only `OUTBOUND_WAITING` (`pg-store.ts:33, 365`). A row in `parked_leak_review` keeps the old number. On Cloud the binding check at Q:478-486 stops it with `dropped_forgotten`. On the raw provider that check does not run, so a release sends to the old number. Low, as raw is not the production path.

Quint: merge with outbound-row. Action `staffDecide(id, decision)`. Check `INV-LEAK`, and that a parked row never reaches `sending` without `leak_released_by`.

## 9. line-conversation (P1)

### Where

`platform.line_conversations (line, address, unanswered, reengagement_used, first_outbound_at, last_outbound_at, last_inbound_at)`.

### States

- No row (a new conversation).
- Open with `unanswered` from 0 up.
- Capped: `unanswered>=3` and re-engagement unused.
- Re-engaged: `unanswered>=3` and re-engagement used.

### Transitions

| From | Event | Guard | Effects | To | Evidence |
|---|---|---|---|---|---|
| no row | acceptance, not failed | first send | row, `unanswered` 1 or 0 for compliance | open | Q:555-560 |
| open | acceptance, not failed | inbound not after `at` | `unanswered+1` (compliance +0), `reengagement_used or` | open or capped | Q:561-565 |
| open | acceptance | inbound after `at` | counters kept, times moved | open | Q:562-565 |
| any | `inbound` | none | `unanswered=0`, `reengagement_used=false`, held rows released | open | Q:640-643 |
| capped | agent row, 14 days since last outbound | one time | `reengagement` flag on the row | re-engaged | Q:398-400 |
| open, zero, idle one day, not a phone identity | `purge` | none | delete | no row | Q:659-664 |

### Who calls `inbound`

- Webhook path: before the handler (`SV:1027`), for a tapback too (`SV:1021`).
- Signed turn: after the handler, only for an eligible member (`SV:2088`).

### Invariants

- At most 3 unanswered per conversation, then one re-engagement after 14 days (README, Apple line safety).
- Streak counts each app on the line together (key has no app).

### Defects

See BL-2, BL-8, BL-9, BL-10.

`last_outbound_at` also moves on a compliance text, so a STOP confirmation restarts the 14-day clock. Low.

The sim judge issue in AGENTS.md (a `two_unanswered` false count) is a network-level rule, not this counter.

### Quint notes

Merge with outbound-row. Bound `unanswered` to 5. Abstract 14 days as a boolean `quietLongEnough` set by a clock action. Split `inbound` into two actions, so the lost wakeup shows. Invariant: `unanswered(a) <= 3 + reengagementUsed(a)` for counted sends.

## 10. line-safety (P1)

### States

no row, `pause_new`, `reply_only`, `review`, any other string.

### Transitions

| From | Event | Guard | To | Evidence |
|---|---|---|---|---|
| any | `safety.number_banned` | none | `review` | SV:1017 |
| any | other `safety.*` with action | none | that action | SV:1017; Q:650-651 |
| any | `safety.*` with no action, or `none` | none | no row | Q:649 |

Read at Q:405-410. `review` holds every row. `reply_only` holds agent rows and new conversations. `pause_new` holds new conversations. An unknown action holds nothing (fails open). Ops reads it in `deploy/backend/ops.ts:139`.

### Failure

- `at` is the local clock, not the event time. No version check exists. A late event replaces a newer one.
- `dedupeKeysFor` has no caller outside its own file, and events other than messages skip the inbox (`SV:2517-2518`). A replayed safety event applies again.
- The event's `line` field is ignored (`SV:1017`). One line, so no effect today.

Defects: BL-4, BL-7, BL-12.

Quint: small module. Variables: `action`, provider truth. Check: provider `review` implies local `review`, under reordering. This fails by design today, and the model records it.

## 11. person-cap-slot (P0)

### States

no slot, slot held with `person_cap=false` (crash window), slot held with `person_cap=true`, slot released.

### Transitions

| From | Event | Guard | To | Evidence |
|---|---|---|---|---|
| no slot | `capTake` | under count `cap`, person known | held | Q:423-425; RT:195-198; migration 0007:168-189 |
| no slot | `capTake` | at cap | row `refused_person_cap` | Q:424 |
| held | `capTake` again | msg id present | no change | 0007:179 |
| held | `end` with a `NOT_SENT` status | `row.personCap` | released | Q:345 |
| held | older than the window plus one day | next take | deleted | 0007:177 |

`person_cap_take` runs under one transaction advisory lock. It is safe against two networks.

### Invariants

- PRD 40.3: at most 3 proactive messages a day per person across apps, checked at send time.
- A slot is held only for a send that may have gone out.

### Failure

- `failed_unknown` matches `NOT_SENT` (Q:195), so a message that did go out gives its slot back. See BL-1.
- `dropped_forgotten` by erasure and `suppressed_ineligible` by number change bypass `end`, so no release. Low: erasure means no more sends, and a number change waits one window.
- The kind is `proactive` for a notify delivery only when it counts toward the weekly cap (`SCH:196`). `rt.system` sets `proactive:false` on the message (`RT:450`). `capRefused` tests `b.proactive || b.kind === "proactive"`, so it holds.

Quint: merge with outbound-row. One person, 4 rows, cap 3. Invariant: count of slots at most 3, and count of rows sent in the window at most 3.

## 12. quiet-hours (P0)

Pure functions in `packages/blooio/src/quiet-hours.ts`, with state in `next_attempt_at` and `status`.

- `isQuietAt`: wrap-around window (`:32-37`).
- `nextAllowedAt`: jump, nudge for DST, pull back (`:40-50`).
- `resolveTimeZone`: member zone, then city, then null (`:70-74`). `CITY_TZ` holds only `sf` and `nyc`.

`CH:229` passes only `city`, no member zone. All four networks are `*:nyc` (`packages/network/service/README.md:3`). A network in any other city would park every agent-initiated send.

Replies and compliance are exempt. A `reply` must follow an inbound inside the hour (Q:383-388).

The zone is stored at enqueue. A member's move does not change a row that waits.

Notify has its own plan-time check, with the default window (`SCH:62`). The queue enforces again with `o.quiet`. The two windows match only if nobody sets `quiet`. `CH:208-212` does not set it.

Quint: do not model time zones. Model a boolean `quietNow(row)` chosen by the clock action. The DST logic suits a property test in TypeScript better. Merge with outbound-row.

## 13. webhook-intake (P0)

`verifyBlooioSignature`: states are missing, malformed, stale, mismatch, ok (`webhook.ts:24-55`). Window 300 s both ways. HMAC over `t.rawBody`.

`parseBlooioWebhook`: maps to message, status, reaction, typing, safety, ignored. It throws only on non-JSON.

Replay inside 300 s:

- Messages: the inbox dedupes by provider message id.
- Status: rank check absorbs it, except for the race in BL-11.
- Reaction: `inbound` runs again. It resets the streak again. Harmless.
- Safety: applies again. See section 10.

`toMs` guesses seconds or milliseconds by size (`webhook.ts:71-72`).

Quint: model signature as a boolean. The value is in the replay and reorder cases, so model delivery as an unordered bag with duplicates. Merge into delivery-receipts and line-safety.

## 14. message-status-mirror (P1)

`network.messages.status` copies the queue status, after commit, in a separate transaction.

| Event | Copy path | Evidence |
|---|---|---|
| Unit commits | stored as `queued`, or refused status | RT:484, 558 |
| Drain | `storeStatuses(ds)` | RT:613-617 |
| Webhook status | `rt.storeStatuses([d])` | SV:1011-1013 |
| Leak decision | `rt.storeStatuses` | SV:2338 |
| Turn receipt | same tx as queue receipt | SV:2037-2040 |
| Notify projection repair | `coalesce(outbound_status, status)` | RT:641-643 |

`outboundWaiting` is counted from this column (`RT:744, 760`), not from `platform.outbound`.

Defects: BL-13, BL-14, BL-6.

Quint: a second variable per row, copied by a separate action that may be lost. Check that a terminal queue status eventually appears in the mirror. Expect a counterexample.

## 15. notify-item (P1)

### Where

`notify.inbox_items`. `dedupe_key` is unique on `person|app|event|subject` (`ST:9-10`). Lifecycle is held in `created_at`, `expires_at`, `seen_at`, `seen_on`, `notified_at`, `delivery_id`.

### States

Product of seen and notified, with expiry on top:

- `pending`: not seen, not notified, not expired. Only this set is selected by `peopleWithPending`.
- `notified`: not seen, notified. Still shown by `unseen`.
- `seen`: seen, not notified. Never texted.
- `seen_notified`.
- `expired`: `expires_at <= now`. No write marks it. It is implied by each read.
- `erased`: row gone.

### Transitions

| From | Event | Guard | To | Evidence |
|---|---|---|---|---|
| none | `add` | unique key, trigger allows, summary not blank | pending | SCH:95-98; PG:55-65; RET:29-38 |
| exists | `add` same key | none | unchanged, first text kept | PG:62-64 |
| pending | `recordDelivery` | `notified_at is null` | notified | PG:112-114 |
| pending, notified | `markSeen` | same person, not seen | seen, seen_notified | PG:91-102 |
| any | clock passes `expires_at` | none | expired | PG:78, 86 |
| any | `forget_data` | canonical fence | erased | RET:103 |

### Invariants

- A notified item is not texted again by the scheduler.
- A seen item is not texted by the scheduler.
- An item never crosses app scope on a surface bound to one app (`SCH:238-239`).
- Every item has a live person and membership at insert (`RET:3-38`).

`notified_at` means "recorded for a send", not "sent". See NT-1.

### Quint notes

Model together with notify-dispatch. Variables: `seen`, `notified`, `expired` as sets of ids.

## 16. notify-delivery (P2)

States: `open` (null outcome), `acted`, `ignored`, erased. `outcome` has a CHECK (`schema.sql:36`).

| From | Event | Guard | To | Evidence |
|---|---|---|---|---|
| none | `recordDelivery` | new id, items owned | open | PG:104-117; RET:40-56 |
| open | token redeemed, or thread reply | outcome null | acted | SCH:217-219, 226-227, 266-269 |
| open | sweep, older than 72 h | outcome null | ignored | SCH:277-280 |
| any | erasure, no items left | none | erased | RET:104-109 |

Each close and its `recordOutcome` are two commits (`SCH:218`, `SCH:278-279`). A crash loses one signal count. Low.

`threadReply` closes every open delivery of the person, so one reply gives N acted counts on the channel (`SCH:268`). `net:` deliveries count too, as each Network send is a delivery.

## 17. notify-dispatch (P1)

### Sequence

`notifyTick` (`SV:683-688`): sweep, then `dispatch`.

`dispatch` (`SCH:176-203`): plan, re-read items, maybe rebuild, record, enqueue.

`notifySink.enqueue` (`SV:667-675`): looks up `notifyTargets`, then runs `rt.system` in a unit of work. Delivery drains after the unit.

Queue: row id = delivery id `ntf_<hash>`. `stale` calls `stillNeeded` (`CH:180`). `stale` true means `expired`.

### States of one planned send

planned, cancelled (all seen, or the id exists), recorded, enqueued, then the queue row states.

| From | Event | Guard | To | Evidence |
|---|---|---|---|---|
| planned | re-read finds no fresh item | none | cancelled | SCH:181-182 |
| planned | partial | rebuild | planned | SCH:183 |
| planned | `recordDelivery` false | id exists | cancelled | SCH:190 |
| planned | `recordDelivery` true | | recorded | SCH:186-189 |
| recorded | no target in the map | log | lost | SV:670 |
| recorded | crash | documented | lost | SCH:185 |
| recorded | unit commits | | enqueued | SV:672 |
| enqueued | `stillNeeded` false | all seen, item erased or expired | row `expired` | SCH:209-215; CH:180 |

Holds: `not_due`, `quiet_hours`, `weekly_cap`, `proactive_off`, `unknown_recipient` (`SCH:81`). `proactive_off` cannot occur, as `notifyRecipient` sets `proactiveAllowed: true` every time (`SV:657`).

`deliveryIdFor` hashes the person and the sorted item ids (`SCH:84-85`). A trimmed row after erasure no longer matches its id, so `stillNeeded` cancels (`SCH:211`). That is a neat fence, and the model should keep it.

### Invariants

- One message per person per send (README).
- A delivery id is recorded once.
- "A crash loses one text, never sends two" (`SCH:185`).

### Quint notes

Model `plan` and `record` as separate actions on 2 replicas. 1 person, 2 items. Check that each item is in at most one delivery. Expect a counterexample (NT-2).

## 18. notify-weekly-cap (P1)

Window `(now - 7d, now]` over `deliveries.counts_toward_cap` (`SCH:135`, `PG:124-130`). Cap 2. A set of only `requested` items is exempt. Over cap, `requested` items go alone (`SCH:136-143`).

`net:` deliveries count when the send was proactive (`SV:627`). `recordSent` writes no delivery if the item already has `notifiedAt` (`SCH:108`), so a repeated event does not count. See NT-5.

App erasure deletes deliveries with no items left (`RET:109`), so a person who left one app loses those counts for the other apps. This follows from privacy. Note it in the model.

## 19. notify-token (P2)

States: issued, redeemed (first surface kept), expired (implied), erased, unknown.

| From | Event | Guard | To | Evidence |
|---|---|---|---|---|
| none | `issueToken` | unused, up to 20 draws | issued | SCH:149-155 |
| issued | `markTokenRedeemed` | `redeemed_at is null` | redeemed | PG:167-169 |
| redeemed | read again | not expired, owner | redeemed, same answer minus seen items | SCH:222-229 |
| any | `expires_at <= now`, foreign, unknown | none | answer null | SCH:224 |

A token is a reference, not a credential (`tokens.ts:1-5`). It is not one-time. The caller comes from the grant. Tokens are not bound to a delivery row, so a token drawn in `plan` for a delivery that loses `recordDelivery` stays in the table with no text. `plan` says it writes "nothing except task tokens" (`SCH:119`).

`redeem` picks the delivery by the first item that has one (`SCH:227`). With an orphan token that is another delivery. Low.

`redeemSubjects` has no app filter (`SCH:251-255`). It has no production caller, so there is no leak today. If it gets a caller, an MCP grant for one app could see another app's subject ids.

Quint: small, low value. Check only that the caller gets items of the token's owner and nobody else.

## 20. notify-surface (P2)

Per person and surface: `active`, `last_used_at`, `acted`, `ignored`, `ignored_streak`.

States that matter: inactive, usable (`active` and streak below 2), dropped (`active` and streak 2 or more).

| From | Event | To | Evidence |
|---|---|---|---|
| any | grant on or off | active flag | SCH:272-274; SV:645 |
| any | `touch` | last used only | PG:186-190 |
| usable | ignored outcome | streak +1, maybe dropped | PG:199-202 |
| any | acted outcome on that surface | streak 0 | PG:193-197 |

`resolveDelivery` (`surface.ts:49-77`) is a pure choice: explicit, then score, then thread.

Defect: NT-3.

Quint: alone, with 1 assistant, 3 deliveries. Liveness check: from dropped, a use of the surface returns to usable.

## 21. notify-projection (P1)

`projectNotifications` (`RT:621-647`) selects messages that are accepted and have no `notification_recorded_at`, calls `delivered`, which calls `recordSent`, then sets the marker. It runs under the store lock, in batches of 50.

`recordSent` (`SCH:105-111`) is two commits: `add`, then `recordDelivery`.

| Step | Crash result |
|---|---|
| After `add`, before `recordDelivery` | Item is pending. The projection repeats on the next drain. In the gap the scheduler can text it. See NT-4. |
| After `recordDelivery`, before the marker | Repeat finds `notifiedAt`, no second delivery. Fine. |

## 22. notify-erasure (P0)

`lock_live_scope` (`RET:3-25`): one lock order: person, member, Notify records. Returns false for a removed scope.

Triggers:

- `notify_inbox_live_member`: raises on a dead scope (`RET:37-38`).
- `notify_delivery_live_items`, `notify_token_live_items`: trim to owned, surviving ids, skip the insert if none (`RET:40-56`).
- `notify_surface_live_member`: skip the insert after erasure (`RET:58-76`).

`forget_data` (`RET:78-128`):

- Full erasure needs `people.deleted_at` set.
- App erasure needs the canonical app scope, a membership row, and a removed state on one side.
- It deletes items, trims deliveries and tokens, then decides on signals.

Called from `deleteAll` and `forgetMembership` (`pg-store.ts:300, 320`) and from `writeUnit` (RT:546).

Mismatch: the trigger counts an `invited` membership as live (`RET:62-65`). The signal keep rule excludes it (`RET:119-120`), although its comment says "live or pending". See NT-8.

Open question, not verified: `forget_data` raises when no membership row exists (`RET:97`). `writeUnit` calls it for any member with a `person_id`. I did not find a path with a member and no membership, so I do not report a defect. A model can check it.

Quint: merge person and app scope into one module with insert racing erasure. Invariant: after erasure no row names the person in this app.

## 23. Suspected defects

All were checked against the code. Nothing was run. Ids are stable for cross-reference.

### Blooio

**BL-1. `failed_unknown` fires from row age, with no receipt lookup.** Confidence: high. P1.
`Q:584-588`. The TTL compares `created_at`, and this loop runs before the lookup at `Q:591`. Trigger: a transactional row is enqueued at 22:00. It waits for quiet hours until 09:00, or it holds in a line-safety wait. At 09:00 it is sent. Cloud accepts it, but the 10 s timeout fires (`CC:41`, `CC:46`). The row is `unknown_acceptance`. The next drain sees age above 6 h and ends it `failed_unknown` with no lookup. Effects: the text reached the person, yet `sent_at` stays null (no thread leak check, no caps), the conversation counter does not move, the person cap slot goes back (`Q:195`, `Q:345`), and for a proactive row the person can get more than the cap. The option comment (`Q:167-170`) says "after it was created", so the code does what it says, but the rule breaks the guarantee for any row that waited.

**BL-2. Lost wakeup on `held_awaiting_reply`.** Confidence: high. P1.
`Q:381`, `Q:401`, `Q:521`, `Q:640-643`. `inbound` takes no line lock. Trigger: dispatch reads `conv` with `unanswered=3`. The person's message commits `unanswered=0` and releases held rows. This row is still `pending`, so it is not released. Dispatch then writes `held_awaiting_reply`. No timer exists, as the status is not in `DUE`. The row sits until the next inbound or until its TTL expires it. The same happens when the provider answers `429 conversation_*` while an inbound commits (`Q:521`). `inbound` is also two statements with no transaction (`Q:640-643`), so a crash between them gives the same stuck row.

**BL-3. `end` and `wait` have no compare-and-set.** Confidence: high. P1. Safety holds, the state model does not.
`Q:341`, `Q:351`. Both write by id alone. Trigger: dispatch has a row in memory, a forget commits (`RT:548-550`, status `dropped_forgotten`, body and address null), then dispatch runs `wait(row,"deferred_quiet_hours",...)`. The row is now due again with null body and address, and `ended_at` set. The same follows a provider error after the forget (`Q:518`). The next dispatch cannot send, because the claim needs `to_address=row.to` and a null never matches (`Q:495`), and then it ends the row again. So no message leaves. But `INV-MONO` fails, and a terminal status can change: `reconcileUnknown` calls `end` outside the line lock (`Q:285`, `Q:588`), so it can overwrite an `accepted` row with `failed_unknown` while another drain commits it, and then release a slot.

**BL-4. In production, receipts, safety events and tapbacks do not arrive.** Confidence: high for this repo. It depends on the gateway deploy. P1.
`SV:1007-1023` are reached only from `/webhooks/blooio`. AGENTS.md says the backend never gets that webhook in production. No `/internal/*` path carries these events. Effects:
- Rows stay `accepted` for good. `ended_at` stays null.
- `platform.line_safety` is never written, so step 7 (`Q:405-410`) is dead and the ops alert (`deploy/backend/ops.ts:139`, `:303`) never fires. Provider safety refusals map to `failed` or unknown, row by row.
- A tapback does not reset the streak here, while Blooio does reset it.
- A `message.failed` after acceptance is not seen, so a failed text counts as sent.
The upstream gateway may enforce some of this. I did not read it.

**BL-5. Rows with no end, and no retention for `platform.outbound`.** Confidence: high. P1, privacy.
No code deletes from `platform.outbound` or from `notify.*`, except erasure in `RET`. Three parts:
- `accepted` to a non-member never ends on Cloud (BL-4), so `Q:32` fails: address and text stay. `end` runs only for delivered, read and failed (`Q:570-572`).
- `collected` and `send_unknown` stay when no receipt comes (section 7).
- `parked_leak_review` with no staff decision keeps a non-member's text (`Q:340`).
`parked_error` and `parked_invalid_timezone` are terminal with no staff route (`parkedLeaks` lists only leak rows, `Q:707-708`).

**BL-6. A lost race reports `dropped_forgotten` for a sent message.** Confidence: medium. P2.
`Q:569`. `reconcileUnknown` runs outside `withLine` (`Q:285`). Trigger: `direct` (`CH:240-241`) and a tick drain both select one `unknown_acceptance` row. The first commits `accepted`. The second CAS finds nothing and returns status `dropped_forgotten`. `drainQueue` stores it in `network.messages` (`RT:616`). If the projection has already set its marker, the repair at `RT:641-643` no longer runs, so the mirror stays wrong for good.

**BL-7. Line safety holds compliance texts.** Confidence: high. P1.
`Q:407`. `review` has no compliance exemption, and `reply_only` or `pause_new` hold a compliance text to a new address. `deploy/backend/ops.ts:129` says "compliance texts still go" and `:303` says "STOP and HELP still go". `Q:411` says "compliance texts always go", about step 8 only. The README row says `review` holds everything, so the docs disagree with each other. A queued STOP confirmation waits an hour at a time, up to 3 days. On production paths STOP is a collected reply, so the exposure is the legacy path. A hold may be right, since Blooio refuses all sends in `review`. The ops text is then wrong.

**BL-8. A collected reply is not counted in the streak.** Confidence: high. P1.
`Q:555-566` updates the conversation only in `acceptReceipt`. `collectedReceipt` (`Q:696-703`) does not. So `reply` adds 1 on the queue path and 0 on the Cloud path. Trigger on Cloud: a member writes, gets a reply, then three proactive sends go. That is 4 messages unanswered, and the line rule is 3. `last_outbound_at` also does not move, so the 14-day clock is wrong.

**BL-9. An erased person's phone stays in `line_conversations` with an open streak.** Confidence: high. P1, privacy.
`Q:659-664` deletes only when `unanswered=0`. `deleteAll`, `forgetMembership` and the forget path do not touch this table (`pg-store.ts` has no reference). Trigger: three unanswered sends, then the person deletes everything. The E.164 stays in clear text, with no time limit. The comment at `Q:655-657` states the `unanswered=0` rule on purpose, but gives no bound.

**BL-10. In a signed turn the drain runs before `engaged`.** Confidence: medium. P2.
`SV:2068` runs the handler. The unit's delivery drains inside it (`RT:671-675`). `engaged` comes after, at `SV:2088`. Trigger: a member writes after 2 hours of silence. The reply fails `collectedLeaks`, so it goes to the queue as `reply` (`RT:474-477`, comment: the guard "parks it for staff"). Step 4 sees no inbound in the hour and ends it `suppressed_ineligible` (`Q:384-387`), before the leak guard. Staff never see it, and the member gets no answer. Held rows also wait for the next tick, a smaller effect.

**BL-11. `applyStatus` is a read and then an unconditional write.** Confidence: high for the race, low impact. P2.
`Q:613`, `Q:625`. Two webhooks in parallel: `read` commits, then `delivered` from a stale read overwrites it. A failed receipt uses `end`, with the same issue. A receipt that beats the `acceptReceipt` commit finds no row and is dropped for good (`Q:614`), with no retry, as the webhook answers 200.

**BL-12. A `safety.*` event with no action clears the state.** Confidence: medium. P1.
`SV:1017` passes `ev.action`. `webhook.ts:163-170` accepts any `safety.` type, and `action` may be missing. `Q:649` treats undefined as "clear". Trigger: the line is in `review`, then a safety event of another type with no `action` lands. New and agent texts flow again. A late `none` also clears a newer state (section 10). Unknown action strings hold nothing. All fail open. `docs/research/blooio.md:64` lists two safety event types, and only `number_banned` is special-cased, so the trigger needs a provider payload I could not confirm.

**BL-13. `parked_invalid_timezone` at enqueue leaves the mirror on `queued` for good.** Confidence: high. P2.
`Q:237`, `Q:243-247`. The row is never selected by drain and no `StatusChange` is returned, so `network.messages.status` stays `queued`. `outboundWaiting` counts it (`RT:760`) and the backlog alert sees a row that will never move. The same enqueue path skips `end`, so a non-member row keeps address and text (`Q:241`, contrary to `Q:32`).

**BL-14. Status changes are lost on a crash or an abort after the queue commit.** Confidence: high. P2.
`RT:613-617`. `drain` returns changes in memory, and the copy runs after. A crash, or a throw in the drain after some rows ended, loses them. The projection repairs only accepted rows. Refused or expired rows stay `queued` in the mirror.

**BL-15. A row that fails `rowOf` stops the drain, every time.** Confidence: medium. P1.
`Q:291` is outside the `try` at `Q:293`. `rowOf` throws on stored photos that no longer parse (`Q:307-309`). The whole drain rejects, so later rows, compliance included, wait for good, in this app. `expireHeld` and `reconcileUnknown` have the same exposure (`Q:325`, `Q:586`). Trigger: a stricter `parseApprovedRelayPhotos` in a deploy, with an old row waiting, or a manual write. Enqueue validates with the same parser, so a plain run does not reach it.

**BL-16. Some send-time checks read memory, not the database.** Confidence: medium. P0 if run with more than one replica.
`Q:14` says each check reads the database. `CH:174`, `CH:181` and `packages/network/src/network.ts:4845-4855` read `rt.net`. `drainQueue` does not reload it (`RT:613`), and `runTick` loads state only when it gets the lock (`packages/network/src/store.ts:66`). When the tick is skipped, `deliver` still runs (`RT:662-663`). Trigger: replica A holds an old `net`, replica B records a pause, a lower age or a closed opportunity. A drains and passes `recipient` and `stale`. The admission transaction rechecks opt-out, account status and binding, and the full relay rules, but not the minor rule for a non-relay row. With one replica this does not occur.

**BL-17. `stale` fails open.** Confidence: high. P2.
`Q:371` passes `false` as the failed value, so a throw means "not stale". `Q:111` says every hook fails closed. For `ntf_` rows, `stale` is the only `stillNeeded` check in production (`CH:180`). A DB error there lets a digest through. Admission still fences erasure of the member.

**BL-18. Provider-reported `failed` sets `sent_at`.** Confidence: high. P2.
`Q:549`. A receipt with status `failed` writes `sent_at` before `end`. The row then counts in the hourly and daily caps and in the thread history. Conservative, but wrong as data.

**BL-19. `in_doubt` is never read by the queue.** Confidence: high. P2.
Written at `Q:274`, loaded at `Q:313`. No branch uses it. Only the sim asserts it (`scripts/sim/pipeline.ts:362`).

**BL-20. Doc drift.** Confidence: high. P2.
- `packages/network/service/README.md:20` says collected replies are "outside `platform.outbound`". They are recorded in it (`Q:684-692`).
- The same README at `:38` says a receipt poll never resends. `Q:598-602` resends on `not_found`, on purpose.
- `Q:12-13` and `packages/blooio/README.md:33` say recover returns rows to the queue. On Cloud it moves them to `unknown_acceptance`.

### Notify

**NT-1. `notified_at` is set before the queue decides, with no way back.** Confidence: high. P1. Dormant while no producer uses `add`.
`SCH:186-199`. If the queue row ends unsent (`refused_person_cap`, `refused_opted_out`, `expired`, `suppressed_ineligible`, `parked_*`, `failed`), the items stay notified and are not sent again. The delivery counts toward the weekly cap, and the sweep records "ignored" against a surface that got nothing (`SCH:278-279`). The same holds for `SV:670`, "no network member", which returns without an error. Assistants still see the item, as it stays unseen.

**NT-2. Replica overlap sends two texts with shared items.** Confidence: high for the race, dormant today. P1.
`SCH:181-189`. `recordDelivery` dedupes only on the id, and the id depends on the item set. Trigger: replica 1 plans `{A}`. Item B arrives. Replica 2 plans `{A,B}`. Both re-reads see A unnotified. Both record, as the ids differ. `PG:112-114` updates only null `notified_at` but does not fail. Two texts go, A is in both, and the weekly cap can pass 2. `deploy/backend/backend.ts:410` guards only in one process. `packages/notify/README.md:31` says replicas overlap safely.

**NT-3. A dropped surface cannot come back.** Confidence: high. P2.
`surface.ts:4` says it drops out "until the member uses it again". Only `recordOutcome("acted")` resets the streak (`PG:193-197`), and that needs an open delivery on that surface (`SCH:218`). A dropped surface gets no new links (`surface.ts:47`, `:61`), and older deliveries closed at 72 h. `touch` from `get_updates` writes only `last_used_at`. Turning the grant off and on does not reset it. So `ignored_streak >= 2` is absorbing.

**NT-4. The only production route into `dispatch` is a duplicate text.** Confidence: medium. P1.
`SCH:107-109`. `add` and `recordDelivery` are two commits. In the gap the item is `pending` with urgency `requested` (`SV:626`), so it is due at once. Trigger: `recordDelivery` throws or the process stops, and a `notifyTick` runs before the next drain repairs it. The tick order on one replica runs drains first (`deploy/backend/backend.ts:397`), so the likely case needs a second replica or a failed repair. The scheduler then texts the summary of a message that was already delivered. As no producer uses `add`, every production dispatch is this case.

**NT-5. Repeated events are dropped by the dedupe key.** Confidence: high. P2.
`SV:626` uses `subjectId: oppId ?? id`, and `dedupeKey` omits the message. A second `reminder` or `scheduling` for one opportunity returns the first item (`PG:62-64`). If it has `notifiedAt`, no delivery is written (`SCH:108`). So the assistant never sees the second update, and a proactive repeat does not count toward the weekly cap. `packages/notify/README.md:6` says every event becomes one inbox item.

**NT-6. One bad person or one bad sink aborts the tick.** Confidence: high. P2.
`plan` and `dispatch` have no per-person guard (`SCH:123-145`, `SCH:180-201`). `peopleWithPending` is sorted, so the same person fails first on each tick. `SCH:183` uses `!` on a recipient that may now be undefined, after a member opts out between plan and dispatch. A `sink.enqueue` throw comes after the record, so that delivery is lost too.

**NT-7. The recipient ignores the item's app.** Confidence: medium. P1. Dormant.
`SV:649-660` picks the first live member, with ntwrk first, for all of a person's items. `proactiveAllowed` is always true, so `proactive_off` never holds. A slop item goes out on the ntwrk row. Consent, the live flag and `recipient` are then read for ntwrk, not slop. Leaving an app erases its items, so that case is covered. A paused or held slop member with a live ntwrk member is not. `SCH:29-30` documents a check that production does not fill.

**NT-8. Signals rule differs for `invited`.** Confidence: high. P2.
`RET:62-65` keeps signals for an invited membership. `RET:119-120` does not count it, and the comment at `:116-117` says "live or pending". A person with one removed app and one invited app loses signals, then new ones are allowed.

**NT-9. No retention for inbox, deliveries, tokens.** Confidence: high. P2.
Expired items and tokens are hidden, not deleted. Items hold up to 500 characters of the sent text (`SV:219`). A person with `unknown_recipient` holds forever, and `peopleWithPending` returns them on each tick.

**NT-10. API with no production caller.** Confidence: high. P2.
`shownSubjects`, `redeemSubjects`, `threadHooks`, `queuePolicy`, `queueSink` (tests only), `findToken`, `buttonPageButtons`, `dedupeKeysFor`. `packages/notify/test/wiring.test.ts` proves `queuePolicy`, so production's `stale` path ends rows as `expired` while the test expects `suppressed_ineligible`. `service-platform.test.ts` calls `dispatch` with `queueSink`.

## 24. Quint modelling plan

Module 1, `OutboundQueue` (P0). Merge outbound-row, line-drain-lease, unknown-acceptance, leak-review, line-conversation, person-cap-slot and quiet-hours.

Variables:

- `row: Id -> {status, attempts, lease, personCap, created, body, addr}`
- `conv: Addr -> {unanswered, reUsed}`
- `slots: Set[Id]`
- `consent: Addr -> bool`, `erased: Set[Id]`
- `admitted: Set[Id]` (provider truth)
- `drainer: Option[Worker]`, `inFlight: Worker -> Id`
- `clock`: small integer with steps for quiet, TTL 6 h, TTL 24 h

Actions: `enqueue`, `lockLine`, `checkAndHold`, `admit`, `providerCall` (split into `admit` and `respond`, with timeout), `acceptCommit`, `waitWrite`, `endWrite`, `recover`, `reconcileExpire`, `reconcileLookup`, `memberInbound1`, `memberInbound2`, `stop`, `forget`, `staffRelease`, `crash`, `tick`.

The key is to split dispatch into its read and write steps. Read the row and the conversation in one action, and write the result in a later one. Most defects here are TOCTOU, and an atomic `dispatch` action hides them.

Bounds: 2 workers, 3 rows, 2 addresses, 1 line, attempts up to 3.

Invariants to check:

- `INV-CONSENT`, `INV-LEAK`, `INV-ERASE`, `INV-ONCE`.
- `failed_unknown` or any `NOT_SENT` status implies `id` not in `admitted` (finds BL-1).
- Terminal status stays terminal (finds BL-3).
- Held row and `unanswered=0` and no inbound pending is not stuck (finds BL-2).
- Slots per person at most 3, counted on `admitted`.

Abstractions: drop text, media and photos. Fingerprint is a boolean "same content". Time zones become a nondeterministic `quietNow`. `recipient`, `stale` and `admit` become oracles over `erased`, `consent`, `paused`.

Module 2, `LineSignals` (P1). delivery-receipts, line-safety, webhook-intake. Model provider events as a bag with duplicates and reordering. Include a flag `gatewayForwards` so the production case (BL-4) is explicit.

Module 3, `NotifyDispatch` (P1). notify-item, notify-dispatch, notify-weekly-cap, notify-projection, with a stub of the queue that can end a row unsent. 2 replicas, 1 person, 3 items. Checks: each item in one delivery (NT-2), recorded implies queued or cancelled (NT-1), no item delivered both by `net:` and `ntf_` (NT-4).

Module 4, `NotifyErasure` (P0). notify-erasure with `add` and `recordDelivery` racing. Two apps, one person. Model locks as explicit holders.

Module 5, `SurfaceSignal` (P2). Small. Liveness only (NT-3).

The collected-reply machine belongs with the `platform.inbound` turn model of the network service, and should share the row type with Module 1.
