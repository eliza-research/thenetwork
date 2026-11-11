# Implicit state machines: pattern sweep (whole repository)

Scope: machines that per-package readers can miss, mainly machines that cross packages or cross a process boundary.

Method: pattern search over all non-test TypeScript and SQL outside `packages/sim`, then a read of each hit in context. Patterns: `FOR UPDATE`, `SKIP LOCKED`, advisory locks, `setTimeout`, `setInterval`, `sql.begin`, `new Map`, `new Set`, `void` promises, `.catch(() => ...)`, `on conflict`, `attempts`, `retry`, `lease`, `expires`, `ttl`, `cursor`, `idempot`, `dedupe`, `*_at` columns, SQL `check (... in (...))`.

Limits of this report:

- Nothing was run. No test, no database, no external service.
- The upstream Eliza gateway and Eliza Cloud are not in this repository. Statements about them come from `AGENTS.md`, `packages/core/src/svc/contract.ts` and comments. Any defect that depends on gateway retry behavior says so.
- `packages/network/src/network.ts`, `packages/network/service/service.ts` lines 1-240 and 2159-2574, `packages/mcp/src/handler.ts` and `packages/platform/src/photos.ts` were read by search hit, not line by line. The per-package reports cover them in depth.
- Machines already fully inside one package (OAuth codes and tokens, OTP challenges, session rotation, opportunity stages, relay held items) are named here only where they touch another machine.

## 1. Machine index

| id | Kind | Priority | State lives in | Crosses |
|---|---|---|---|---|
| signed-turn | implicit | P0 | `platform.inbound` (`status`, `arrived_at`, `request_hash`, `response`) | gateway, service, inbox, network |
| consent-fences | implicit | P0 | `platform.consent_events`, `network.members.opted_out`, `platform.memberships.state`, gateway send fence | gateway, platform, network, queue |
| send-belief | implicit | P0 | Network state (`bookedTold`, `bookedAt`, `confirmed`) versus `platform.outbound.status` | network, queue, Cloud |
| ban-saga | implicit | P0 | `platform.bans`, `platform.suppression`, `platform.memberships`, `network.members`, Network state | staff, platform, every runtime |
| erasure-saga | implicit | P0 | `platform.memberships`, `network.*`, `oauth.grants`, photos, notify, `platform.line_conversations` | platform, network, mcp, notify, storage |
| age-propagation | implicit | P0 | `platform.age_floor`, `platform.people.lowest_age`, `network.members.age`, `runtime.statedAges` | network, platform, every app |
| network-unit | implicit | P0 | advisory lock, `network_state`, in-memory `ConsentNetwork`, `runtime.unit`, `runtime.committed` | network, runtime, queue |
| phone-hold | implicit | P0 | `phone_identities.hold`, `last_seen_at`, `phone_changes` | platform, queue, oauth |
| retention-loop | implicit | P1 | tick wiring (`serve.ts` versus `backend.ts`) | every retained table |
| webhook-inbox | implicit | P1 | `platform.inbound` (`pending`, `attempts`) | Blooio webhook mode only |
| action-receipt | implicit | P1 | `platform.inbound.action_receipts` jsonb | gateway, service, relay, profile suggestions |
| turn-receipt | implicit | P1 | `platform.inbound.receipt`, `network.messages.status`, `platform.outbound` `collected` | gateway, service |
| outbound-cross | implicit | P1 | `platform.outbound` terminal rows, `provider_message_id` | queue, Cloud, retention, ops |
| line-streak | implicit | P1 | `platform.line_conversations`, `platform.line_safety` | queue, inbound, gateway |
| person-cap-slot | implicit | P1 | `platform.person_sends`, `outbound.person_cap` | queue, platform SQL functions |
| notify-delivery | implicit | P1 | `notify.inbox_items`, `notify.deliveries`, `notifyTargets` map | notify, runtime, queue |
| rate-buckets | implicit | P1 | `platform.rate_limits` | OTP, join, STOP hint, purge |
| lock-latency | implicit | P1 | `pg_advisory_*`, `PgPeopleStore.lockTail`, `lineChains` | every inbound path |
| text-join-saga | implicit | P1 | `platform.pending_texts`, person, membership, consent, member | service, platform, network |
| route-authority | implicit | P1 | env policy, `inbound.network_authority`, clock | staging cutover |
| shutdown-drain | implicit | P1 | `draining`, `inFlight`, `busy` | backend, turns, ticks |
| photo-text-consent | implicit | P2 | `pending_texts` kind `photo_consent`, `memberships.profile.photoConsent` | service, intake |
| ops-alerts | implicit | P2 | `network.ops_alerts`, `ops_alert_posts` | ops, webhook |
| deploy-migrate-backup | implicit | P2 | `public.__migrations`, bucket prefix, Pages bindings | CI, Railway, Cloudflare |
| memory-registries | implicit | P2 | in-process maps and sets | each replica |

## 2. Facts that hold across machines

### 2.1 Who runs what

| Loop | `serve.ts:124-136` (`main.ts`) | `deploy/backend/backend.ts:388-416` (production) |
|---|---|---|
| `svc.inboxTick()` | yes | **no** |
| `rt.tick()` per network | yes | yes |
| `svc.purge()` | yes | **no** |
| `svc.notifyTick()` | yes | yes |
| `ops.tick()` | no | yes |

Production `/internal/*` traffic and sends use `CloudChannelAdapter` (`deploy/backend/server.ts:84`). `INTERNAL_PATHS` (`backend.ts:40`) has no delivery status route. So in Cloud mode these paths have no caller: `OutboundQueue.applyStatus`, `setLineSafety`, and the `reaction` branch of `inbound()`.

### 2.2 Lock map

| Lock | Scope | Held across | File |
|---|---|---|---|
| `network-tick-<id>` session advisory | one network | full unit: load, LLM, save | `network/src/store.ts:320-333` |
| `blooio-line:<line>` session advisory | one line, all apps | every provider call of a drain | `outbound-queue.ts:255-269` |
| `inbox-sender:<addr>` xact try | claim of a signed turn | claim only | `inbox.ts:87` |
| `inbox-sender:<addr>` session | webhook rows | handler | `inbox.ts:218-231` |
| `platform:join:<e164>` session, plus one global in-process chain | **all** joins in a process | join, member creation, a network unit, a queue drain | `platform/src/pg-store.ts:249-261` |
| `phone-age:<hash>` session, global in-process chain | age floor write | short | `pg-store.ts:90-96` |
| `rate:<bucket>` xact | one bucket | short | `pg-store.ts:233` |
| `platform.person_cap` xact | one global lock | short | migrations 0007, 0012 |
| `thenetwork-ops-alerts` xact try | ops round | includes webhook POST (5 s) | `deploy/backend/ops.ts:351-352` |
| `thenetwork-migrate` xact | migrations | one transaction | `observatory/db/migrate.ts:83` |

Row lock order in the code: `network_state` (share, relay only), then `platform.people`, then `platform.memberships`, then `network.members`, then `platform.inbound`. The comment at `runtime.ts:296-297` records the rule. A Quint model does not need row locks if each transaction is one atomic action, but the order is worth an audit when a new path is added.

### 2.3 Non-atomic boundaries

There is no transaction across any of these steps:

1. The consent ledger write and the `opted_out` flag and the membership state (`service.ts:1323-1333`).
2. A Network unit commit and `statedAge()` (`service.ts:1122-1123`).
3. `onForget` and `forgetMembership` (`accounts.ts:427-428`).
4. Ban rows, suppression, memberships, members, Network state (`service.ts:1750-1761`).
5. `recordDelivery` and the sink enqueue (`scheduler.ts:186-199`).
6. The provider call and `acceptReceipt` (`outbound-queue.ts:506-507`). The idempotency key covers this one.
7. Each step of `join()` (`service.ts:1435-1461`).

## 3. Machines

### 3.1 signed-turn (P0)

State: one row in `platform.inbound` per `msg:<channel>:<messageId>`.

States: `absent`, `processing`, `done`, `unresolved`, `unresolved_detached` (`sender_hash` null, set by staff or by a seal), `released` (row deleted, same as `absent`), `tombstone_deleted`.

Evidence: `inbox.ts:81-132`, migration `0021_shared_agent_turns.sql`.

| From | Event | Guard | Effect | To | Line | Actor |
|---|---|---|---|---|---|---|
| absent | claim | try lock, admit time, no `processing` row of sender; if not keyword also no `pending`, no recent `unresolved` | insert row | processing | inbox.ts:94-98 | gateway |
| absent | claim refused | guard false, no row | 409 `turn_busy` retryable | absent | inbox.ts:100-102 | gateway |
| processing | lease renew | every 30 s, errors ignored | `arrived_at=now` | processing | inbox.ts:111-113 | clock |
| processing | run returns | row still `processing` | store response, clear sender | done | inbox.ts:117-118 | service |
| processing | run throws, keyword, consent or reply committed | | store synthetic response | done | inbox.ts:144-163 | service |
| processing | run throws, keyword, nothing committed | | delete row, undo | absent | inbox.ts:148-152 | service |
| processing | run throws, otherwise | | seal | unresolved | inbox.ts:126 | service |
| processing | another attempt for this sender and lease older than 2 min | any turn, keyword or not | seal | unresolved | inbox.ts:92-93 | gateway |
| processing | staff resolve | | detach | unresolved_detached | inbox.ts:211-215 | staff |
| done | replay same hash | | return stored response | done | inbox.ts:104 | gateway |
| done | purge after 7 days | **purge is not wired in production** | scrub | unresolved | inbox.ts:198-200 | clock |
| done | forget of the member | | scrub | unresolved | runtime.ts:525-528, pg-store.ts:308-310 | member |
| unresolved | purge after 37 days | **not wired** | delete | absent | inbox.ts:203 | clock |

Invariants:

- I1: at most one `processing` row per `sender_hash` (partial unique index).
- I2: a reply is collected only while the row is `processing` (`inbox.ts:169`).
- I3 (AGENTS, consent path): every STOP that reached the backend ends with its ledger event, or the gateway is told to retry. **This does not hold after a process crash. See D1.**
- L1: every `processing` row leaves that state. **This does not hold. See D2.**

Concurrency and failure:

- The claim commits before any effect. Effects commit in their own transactions.
- An effect that collects a reply takes the row in the same transaction, so a swept turn cannot add a reply.
- A consent ledger write does not check the claim. It is idempotent by `ref`.
- Duplicate delivery returns the stored response, or `turn_busy`, or `turn_unresolved`.
- A second turn of the same sender while one runs gets `turn_busy`. This includes STOP. The comment at `inbox.ts:19-20` says STOP is never held back. The code holds it back while a row is `processing` (`inbox.ts:96`: `status='processing'` is outside the `not keyword` group).

Quint notes: variables `turn: id -> {status, senderHash, leaseAt, committedConsent, repliesCollected}`, `ledger`, `workerAlive`. Actions: `claim`, `renew`, `commitConsent`, `collect`, `complete`, `throw`, `crash`, `retry`, `tick(clock)`. Invariant `stopNeverLost`: if a STOP message was accepted by `claim`, then eventually ledger has it or the gateway holds a retryable answer. Model with `consent-fences`. Bound: 2 senders, 3 messages, 1 crash.

### 3.2 consent-fences (P0)

Four stores answer one question: may we text this person?

| Store | Writer | Reader |
|---|---|---|
| `platform.consent_events` | `recordConsent`, `addConsent` | `consentRefused`, `activeMembership`, `admission`, `stopHint` |
| `network.members.opted_out` | `writeUnit` from `unit.optOut` | queue `send()`, `rt.optedOut` |
| `platform.memberships.state` (`paused`) | `stopped()`, START | `activeMembership`, queue binding |
| Gateway fence | response field `consent` | Eliza send path (upstream) |

Derived state per (phone, app): `undefined`, `opted_in`, `opted_out`, from `resolveConsent` (`consent.ts:37-43`). A global opt-out wins unless a later app opt-in exists. Ties go to opted out.

Transitions: STOP (`service.ts:1054-1057`, `1317-1344`), START member (`1100-1111`), START non-member (`1132-1137`), leave (`1081-1093`), join (`1447`, `accounts.ts:384`), enroll (`1491`), web stop (`accounts.ts:398-407`), `join_failed` (`accounts.ts:391`), `join_declined` (`service.ts:1308`), delete all (`pg-store.ts:313`, then suppression).

Invariants:

- I1 (AGENTS 7): after STOP on the shared line every app resolves to `opted_out`.
- I2: a banned number never resolves through START (`service.ts:1103`, `1134`).
- I3: an older START never undoes a newer STOP (`service.ts:1107`). The check runs after the insert. It does not stop the event row. `resolveConsent` handles it.
- I4: send-time checks read the ledger, never a cache.

Failure: the ledger write comes first, so a crash after it leaves the send path safe. `opted_out` and `paused` lag. A web join uses server time. A signed turn uses gateway receipt time capped at now (`consentAt`, `service.ts:1357-1360`). So order across these two sources depends on clock skew.

Interactions: `turn.consent` is set only after the ledger write (`service.ts:1325`), and for leave only after `accounts.leave` returns (`service.ts:1090`). A throw inside `accounts.leave` after its ledger write leaves `turn.consent` unset, so the turn is released as "nothing committed".

Quint notes: model the ledger as a list of `(at, scope, state, ref)`. Add a nondeterministic clock skew between gateway and server. Invariants: `resolve(stop_global) = opted_out for all apps`; `gatewayFence` is eventually equal to `resolve`. Merge with `signed-turn`.

### 3.3 send-belief (P0)

This machine pairs two state machines that nothing joins.

Network belief: `ConsentNetwork.send()` calls `ctx.send` then `fns.onSent()` (`network.ts:3948-3952`). In production `ctx.send` only adds to the unit. So `onSent` means "written to the queue".

Queue truth: the row can end `expired`, `refused_*`, `suppressed_ineligible`, `parked_*`, `dropped_*`, `failed*`, or wait in `held_awaiting_reply`.

Feedback: `storeStatuses` writes `network.messages.status` only (`runtime.ts:649-655`). No code in `packages/network/src` reads that status. So no queue outcome reaches the Network.

Effects driven by the belief:

- `reveal` `onSent` sets `bookedTold` and `bookedAt` (`network.ts:4075-4085`).
- The tick confirms by silence after 48 hours from `bookedAt` (`network.ts:3389-3393`, `confirmPlan` 2356-2366).
- `reveal` is normally not proactive (`network.ts:2456`), so its row is `transactional`, with a 3-day TTL.

Invariant (from the comments at `network.ts:378` and `store.ts:102`: silence counts "once it reached them"): `confirmed(id)` by silence implies the reveal row reached an accepted provider state at least 48 hours ago. **This does not hold. See D3.**

Quint notes: variables `rowStatus: msg -> Status`, `belief: (opp, member) -> {told, toldAt, confirmed}`. Actions: `networkSend`, `queueHold`, `queueExpire`, `queueDeliver`, `tick`. Invariant `confirmedImpliesDelivered`. Abstract time to hours. Model with a two-member opportunity.

### 3.4 ban-saga (P0)

Steps in `service.ts:1744-1763`: (1) audit, (2) insert bans, (3) suppress hashes, (4) drop ratings, (5) memberships to `restricted`, (6) for each member: `account_status='restricted'`, then `markBanned` in a unit, (7) audit result.

States (per target): `none`, `ban_rows`, `suppressed`, `ratings_dropped`, `memberships_restricted`, `members_marked(k of n)`, `done`.

Guard at entry: `already` banned returns `already_banned` (`service.ts:1742-1743`). So a partial ban cannot be run again. See D5.

Invariants (AGENTS 2026-10-09 item 3): a banned number is refused at join, OTP and inbound on every app. Send path: `consentRefused` reads `isBanned` at send time (`service.ts:708`). Matching path: depends on steps 5 and 6.

Concurrency: `putMembership` writes the whole row (`pg-store.ts:124-129`). `stopped()`, START and `photoIntake` read then write. So a late writer can replace `restricted` with its older state (D13).

Quint notes: one action per step, plus `crash` between steps. Invariant `bannedNotMatchable`: bans contains person implies no live opportunity and no matching eligibility. Merge with `erasure-saga` only if the state space stays small.

### 3.5 erasure-saga (P0)

Entry paths and what each runs:

| Path | Photos | Network forget | `forgetListeners` (OAuth) | `forgetMembership` | Ledger |
|---|---|---|---|---|---|
| `accounts.leave` | yes, `hooks.onForget` | yes | yes, errors logged only (`service.ts:763-765`) | yes | opted_out |
| `accounts.deleteAll` | yes | yes | yes | no, `store.deleteAll` deletes rows | deleted, suppression |
| `clearHold(new_owner)` | yes | yes | yes | no, `store.deleteAll` | deleted |
| under-13 decline in chat (`memberUnit`, `statedAge`) | through `ageLowered` | yes | **no** | yes | `join_declined` |

States per (person, app): `live`, `consent_out`, `photos_gone`, `network_removed`, `listeners_done`, `membership_removed`, `person_tombstone`.

Rows not reached by erasure:

- `platform.line_conversations`: only `OutboundQueue.purge` deletes it, and only when `unanswered = 0` (`outbound-queue.ts:659-664`). Production does not call it. See D7.
- `platform.outbound` rows with `member_id` null: address and body stay until the row ends. In Cloud mode a row that reaches `accepted` never ends. See D6.

Invariants (AGENTS age policy, founder correction): after leave, no row names the member in that app. After delete, no row holds the phone in plain form.

Failure: order `photos`, `forget`, `listeners`, `forgetMembership`. A crash after `forget` leaves `memberships.state='active'` with `network.members.account_status='removed'`. `accounts.canJoin` then says "member". A text join recovers (it writes a new member id). A web join returns the old membership (`accounts.ts:357-362`) with no network member.

`clearHold(new_owner)` is not repeatable: after `store.deleteAll`, `findPhone` returns nothing, so a crash before `detachPhoneHash`, `unsuppress`, `clearAgeFloor` leaves the old owner's tombstone, suppression and age floor on the number (`accounts.ts:194-213`).

Quint notes: a set of `residue` items per person. Invariant at `done`: `residue = {}`. Each path is a sequence with crash points. Good first target for a `pure def` table of paths.

### 3.6 age-propagation (P0)

States per person: `unknown`, `adult_recorded`, `minor_recorded`, plus per-app `member.age`, plus per-store floors.

Path of a chat statement: `n.onInbound` calls `onAgeStated`, which adds to `runtime.statedAges` (memory, `runtime.ts:164`). The unit commits. Then `statedAge()` takes the entries (`takeAges`, which removes them) and calls `recordAge` (`service.ts:1293-1301`).

Protection: `platform.matching_ages` reads the lowest of the member age, person age and floor (migration 0038), so matching in any app follows once the floor is written. `activeMembership` uses `lowestAge`.

Invariants: the lowest age wins. Minors are never matched in any app. A photo and a rating exist only for adults.

Failure: a crash between unit commit and `recordAge` loses the statement for other apps. The current app has it in Network state. `takeAges` removes the entry before `recordAge` runs, so a failed `recordAge` also loses it (D8). The hook is retried on a later statement only (`accounts.ts:291-293`).

Quint notes: model `statedAges` as volatile (cleared by `crash`). Invariant `floorFollowsStatement`: a committed statement of a minor implies a floor at or below that age. The model should find the crash trace. Merge with `network-unit`.

### 3.7 network-unit (P0)

States of one runtime: `idle`, `waiting_lock`, `in_unit(loaded)`, `saving`, `committed_undelivered`, `draining`.

Transitions: `runStored` and `runTick` (`store.ts:66-79`), `load` (`runtime.ts:356-363`), `save` (`364-370`), `deliver` (`569-603`), `drainQueue` (`612-618`).

Facts:

- `save` has no version check. Exclusion depends only on the advisory lock on a reserved connection.
- A lost connection releases a session lock while `fn` runs. A second holder can then load old state. The last save wins. This window needs a broken connection, so it is a model case and not a reported defect.
- After a failed save the in-memory state stays dirty until the next `load`.
- The queue reads `rt.net` outside the lock: `stale`, `recipient`, `leaks` (`channel.ts:180-195`), and `afterTick` reads `rt.net` too (`service.ts:534`, `547`). So these checks read the state of the last unit on this replica. It can be uncommitted, or old if another replica ran later. The admission transaction rechecks account status, opt-out and binding. For a relay row it rechecks everything. For other rows the age and hold logic in `net.recipientPolicy` is not rechecked (D14).

Invariant: each committed state derives from the previous committed state. No send exists without its state change (enqueue is in the save transaction).

Quint notes: model `committed` and per-replica `memory`. Action `queueCheck` reads `memory`. Two replicas. Invariant `checksSeeCommitted`.

### 3.8 phone-hold (P0)

States of a phone: `live`, `stale` (implied: `now - last_seen_at > 12 months`), `held`, `moved`, `deleted`.

- `seen()` moves `stale` to `held` (`accounts.ts:176-184`). It runs only on inbound, login and join. No sweep exists.
- `activeMembership` refuses `stale` (`accounts.ts:321`). The queue binding checks `phone.hold is null` only (`outbound-queue.ts:479-485`). So a proactive send can go to a number that reads as stale (D15).
- `movePhone` is one transaction and ends waiting rows (`pg-store.ts:341-379`). The in-memory address book refreshes only on the replica that ran the listener (`server.ts:93-95`).

Quint notes: abstract time into `fresh` and `stale`. Invariant `noProactiveToStale`.

### 3.9 retention-loop (P1)

States of a retained row: `live`, `due`, `purged`. In production `due` has no exit for the items below (D4).

| Item | Purge step | Effect when not run |
|---|---|---|
| `platform.inbound` `done` | seal after 7 days | `response` and `replies` (reply text) stay; `sender_hash` stays |
| `platform.inbound` tombstones | delete after 37 days | table grows |
| `platform.otp_challenges`, `sessions`, `rate_limits`, `pending_texts`, `phone_changes` | `people.purge` | rows stay; expiry is still checked on read |
| `profile_suggestions` past expiry | `expirePending` | `value` and `tags` stay until someone opens the batch (`profile-suggestions.ts:449-459`) |
| `line_conversations` | `queue.purge` | addresses stay |

`handler.ts:969` sweeps OAuth on request, so that one runs. `notify.sweep` runs in `notifyTick`.

### 3.10 webhook-inbox (P1)

Only for `/webhooks/blooio` (dev, `NETWORK_CHANNEL=blooio`). States: `pending(attempts)`, `done(outcome)`, `failed`, `cancelled_by_stop` (outcome of `done`).

Transitions: `receive` (`inbox.ts:175-186`), `handleWaiting` (`243-280`), `cancelBefore` (`234-241`), `purge`.

- A compliance row jumps ahead, but only among the first 50 rows (`KEYWORD_SCAN`, `inbox.ts:34`).
- `leave` jumps ahead too but does not cancel earlier ordinary rows (`isStopText`, `inbox.ts:40`, `266`). So an earlier join answer runs after the leave.
- A failed row returns and waits for the next tick. In the deployed backend no tick drains it (2.1). It waits until the same sender writes again.

### 3.11 action-receipt (P1)

State: `inbound.action_receipts[key]`. States: `absent`, `processing`, `completed`, `unresolved`. Evidence: `service.ts:1892-1971`, `relay-endpoint.ts:193-260`, and `profile-suggestions.ts:186`, `439`.

| From | Event | To | Line |
|---|---|---|---|
| absent | claim (under lock, limit 16) | processing | service.ts:1901, relay-endpoint.ts:201 |
| processing | work commits with `complete` | completed | service.ts:1907, relay-endpoint.ts:187 |
| processing | exception | unresolved | service.ts:1969, relay-endpoint.ts:258 |
| processing | **process crash** | processing (stuck) | none |
| any | seal | absent, with row `unresolved` | not wired in production |

Replay of `processing` answers `action_unresolved`, not retryable. So at-most-once holds, but a crash loses a pause request or a relay with no alert (D10). `signals` and `set-state` are in the same class.

Note: in `relay-endpoint.ts:256`, `answer()` runs after commit. A read failure there goes to the `catch`, which returns 409 `action_unresolved` although the relay is committed and queued.

### 3.12 turn-receipt (P1)

States of a collected reply: `collected`, `sent`, `send_unknown`, `refused_gateway`. Stored on both `network.messages.status` and `platform.outbound.status`. Upgrade `send_unknown` to `sent` or `refused_gateway` is allowed once (`service.ts:2017`).

- No sweep moves `collected`. If the gateway never posts a receipt, the rows stay `collected` with `ended_at` null.
- `WAITING` does not contain `collected` (`outbound-queue.ts:189`). Forget clears body and address, status stays.
- Notify projection needs `inbound.receipt->>'outcome'='accepted'` or an accepted queue row (`runtime.ts:629-631`).

### 3.13 outbound-cross (P1)

The per-package report owns the row machine. Cross-package additions:

- Implied state: `accepted_forever`. In Cloud mode `send()` returns status `queued`, stored as `accepted` (`cloud-channel.ts:54`, `outbound-queue.ts:539`). No later receipt arrives. `ended_at` stays null. `end()` is never called.
- `applyStatus` reads then writes with no status guard in the update (`outbound-queue.ts:613-631`). Two receipts can reorder, and `read` can go back to `delivered`. It also matches only `provider_message_id`, not `provider_message_ids`.
- A receipt that arrives before `acceptReceipt` commits finds no row and is dropped (`outbound-queue.ts:613-614`). In Blooio webhook mode the row then stays `accepted`.
- `parked_error` and `parked_invalid_timezone` have no exit. `decideLeak` handles only `parked_leak_review` (`outbound-queue.ts:720-731`). A transient database error in `dispatch` (a deadlock, a reset connection) parks the row for good (`outbound-queue.ts:295-299`, D11).
- `reconcileUnknown` ends rows by `created_at`, not by time in `unknown_acceptance` (`outbound-queue.ts:584-589`), and does this before any receipt lookup (D12).
- A released leak row skips the guard for good (`outbound-queue.ts:429`), and `tooOld` still applies from `created_at`, so a release after 24 hours of a proactive row ends it `expired`.
- `decideLeak("drop")` uses `end()`, which has no status guard, so it can race a concurrent release.

### 3.14 line-streak (P1)

State per (line, address): `unanswered`, `reengagement_used`, `first_outbound_at`, `last_outbound_at`, `last_inbound_at`. Per line: `line_safety.action`.

Transitions: accept (`outbound-queue.ts:555-566`), inbound (`638-645`), purge (`659-665`), safety (`648-652`).

- In a signed turn `engaged` runs only when the member is account eligible and bound (`service.ts:2088`), after the unit and its drain.
- The accept path takes `acceptedAt` from Cloud. It compares that with `last_inbound_at`, which uses the service clock. So skew changes the streak.
- Two rows can each pass as the one re-engagement while the first sits in `unknown_acceptance`, because the streak updates only on acceptance (`outbound-queue.ts:400`, `555`).
- `line_safety` has no writer in Cloud mode.
- Line safety `review` waits every kind, also `compliance` (`outbound-queue.ts:407`). The ops text says STOP and HELP still go (`ops.ts:303`). In Cloud mode compliance replies are collected, so this affects queued compliance rows only (D16).

### 3.15 person-cap-slot (P1)

State per message id: `free`, `taken`. `person_cap_take` is idempotent per id. `person_cap_release` deletes.

- Taken at dispatch step 9, recorded on the row just after (`outbound-queue.ts:423-426`). A crash between them leaves `taken` with `person_cap=false`. A later end does not release it, but a retry reuses it.
- `end()` releases when the status matches `NOT_SENT` (`195`, `345`). `failed_unknown` matches, so a message that may have gone out gives back its slot.
- `capRelease` errors are swallowed (`345`, `service.ts:606`).
- A member with no `person_id` is not capped (`0007`: `if pid is null then continue`).
- The window is rolling 24 hours (`service.ts:597`). `platform.person_sends` rows older than `since - 1 day` are removed on each take.

Invariant (AGENTS 7): at most 3 proactive sends per person in the window.

### 3.16 notify-delivery (P1)

States of an item: `unseen_unnotified`, `notified`, `seen`, `expired`, `erased`. States of a delivery: `open`, `acted`, `ignored`.

- `dispatch` records first, then enqueues (`scheduler.ts:185-199`). A crash loses one text, as the comment says.
- Nothing connects the queue outcome back. If the row ends refused, suppressed or expired, the item stays `notified` and the weekly cap slot stays used (D17).
- `notifySink.enqueue` returns without a throw when no target exists (`service.ts:669-672`). The delivery stays recorded.
- `Recipient.proactiveAllowed` is always `true` (`service.ts:657`). So the `proactive_off` hold in `scheduler.ts:127-130` is unreachable in the service. A paused or held member's normal items are planned, recorded, then suppressed at the queue.
- `recordSent` writes the item, then the delivery (`scheduler.ts:105-110`). In between, the scheduler can see an unnotified item that was already delivered. `requested` items are due at once, so a duplicate text is possible (narrow window).
- `sweep` and `threadReply`: outcome and counter writes are separate, so a crash loses a count.
- Items with no `expires_at` for a person with no recipient stay in `peopleWithPending` for good.

### 3.17 rate-buckets (P1)

State per bucket and window: `count`, `last_at`. `hit` is atomic under the bucket lock.

`people.purge` deletes every row with `last_at` older than 2 days (`pg-store.ts:286`). The STOP hint bucket needs 30 days (`service.ts:1160`). So where purge runs, the cooldown is 2 days. Production does not run purge today, so the defect is latent, and wiring purge will activate it (D9). `docs/results/2026-10-22-stop-hint-cooldown.md` fixed the window boundary and did not consider purge.

Other buckets are at most one day, so purge is safe for them.

### 3.18 lock-latency (P1)

Liveness property: `/internal/turn` answers within 8 seconds (AGENTS).

- `rt.unitOfWork` awaits `deliver()` (`runtime.ts:671-675`). With the queue, that is a full drain: up to 4 receipt lookups at 10 s each outside the lock, then the line lock, then each due row at up to 10 s (`cloud-channel.ts:41`). One turn can therefore wait for all outbound work of the app and for other apps' drains.
- `PgPeopleStore.withLock` has one chain for all keys in a process (`pg-store.ts:249-254`). A text join holds it across member creation, a network unit and a drain (`service.ts:1140-1148`). So all joins in a process run one at a time.
- A tick holds the network lock during engine runs. A turn waits for that lock with no timeout (`store.ts:324`).

The STOP ledger write comes before these waits, so consent is safe, but the gateway fence and the confirmation wait (D18).

### 3.19 text-join-saga (P1)

Pending state: `platform.pending_texts` keys `(phone_hash, kind, app)`, kinds `join`, `looking_for`, `share`, `photo_consent`. Valid for 1 day on read (`service.ts:997-1000`).

Join steps: `deletePending`, `createPerson`, `recordAge`, `unsuppress`, `putMembership`, `recordConsent`, `createMember`, `memberMessage`, link or ask, `putPending`.

A failed turn does not undo these. `unsuppress` precedes the consent event, so a crash between them leaves a number that deleted everything neither suppressed nor opted in. Nothing proactive goes to a non-member, so the effect is small.

`enroll` skips under-18 for slop, and uses `lowest` for each app (`service.ts:1481-1485`).

### 3.20 route-authority (P1)

Phases by clock, from `NETWORK_ROUTE_AUTHORITY_POLICY` (staging only): `admit` (`now < admitUntil`), `drain` (`admitUntil <= now < drainUntil`), `closed`.

Evidence: `route-authority.ts`, `service.ts:1844-1847`, `1991-1999`, `inbox.ts:90`, `96`. `sharedAction` rechecks inside its transaction, and `complete` rechecks at commit.

Effect: a receipt after `drainUntil` is refused (`service.ts:2012`), so collected replies stay `collected`.

### 3.21 shutdown-drain (P1)

States: `running`, `draining`, `grace_expired`, `closed`. `backend.ts:425-437`.

While draining, `/internal/turn` answers 503. Work past `shutdownGraceMs` is cut when the pool closes. A cut turn is the crash case of 3.1. `railway.toml` notes that old and new deployments may overlap.

### 3.22 photo-text-consent (P2)

`photo_consent` pending is written only in `photosIn` (`photoIntake.ts:90`). `photosIn` needs `ev.mediaUrls`. A signed turn always passes `mediaUrls: []` (`service.ts:2069`), and the turn contract has no media field (`service.ts:2051`). So in Cloud mode this machine is unreachable (D19).

### 3.23 ops-alerts (P2)

States per key: `closed`, `open_unsent`, `open_sent`, `resolving`. `ops.ts:395-441`. The webhook call runs inside the transaction under the try lock. A commit failure after a successful post repeats the post. `sendOutcomes` treats `unknown_acceptance`, `collected`, `send_unknown` as attempted (`ops.ts:179`, `181-191`).

### 3.24 deploy-migrate-backup (P2)

- Migration: one transaction, advisory lock, ledger keyed by id and checksum.
- Backup: a prefix with `manifest.json` is complete; the manifest goes last (`deploy/backup/backup.ts:87-88`).
- Pages cutover: `.github/workflows/deploy-sites.yml` patches `BACKEND_ORIGIN` and `PLATFORM_PROXY_SECRET` per project, one after another. Between two patches sites differ. The backend secret must change in the same window. The workflow does not touch the backend.

### 3.25 memory-registries (P2)

| Field | Lifecycle problem |
|---|---|
| `NetworkService.slaAlerted` | per replica, lost on restart, so repeat alerts |
| `NetworkService.notifyTargets` | no delete; a stale entry after a member leaves |
| `NetworkRuntime.statedAges` | volatile safety data (3.6) |
| `NetworkRuntime.retry`, `committed` | dry-run path only; lost on crash |
| `runtime.capital` | rebuilt from rows at start; each replica has its own |
| `JudgeCache` | TTL, keyed by revision |
| `LLMBudget` for the engine judge | process-wide, resets on restart |
| `lineChains` | WeakMap by pool; fine |

## 4. Suspected defects

All were checked by reading the code. None was run. Confidence is about the backend code path. Severity reflects the rule it touches.

| id | Title | Where | Confidence |
|---|---|---|---|
| D1 | A STOP turn lost in a process crash cannot be retried | inbox.ts:92, 96, 104-107 | high (backend), gateway behavior unverified |
| D2 | Orphan `processing` rows never leave that state unless the sender writes again | inbox.ts:92, 198-203 | high |
| D3 | Silence confirms a booked plan that never reached the member | network.ts:4075-4085, 3389-3393; runtime.ts:649-655 | high |
| D4 | The deployed backend never runs `purge` or `inboxTick` | backend.ts:388-416; serve.ts:124-136 | high |
| D5 | A partial ban cannot be completed | service.ts:1742-1743, 1750-1761 | high |
| D6 | `platform.outbound` keeps non-member address and text forever in Cloud mode | outbound-queue.ts:336-345; cloud-channel.ts:54 | high |
| D7 | `line_conversations` keeps a deleted person's number when `unanswered > 0` | outbound-queue.ts:659-664; pg-store.ts:304-326 | high |
| D8 | A chat-stated minor age can be lost before it reaches the person | runtime.ts:133-137; service.ts:1122-1123, 1293-1301 | medium |
| D9 | `purge` cuts the 30-day STOP hint cooldown to 2 days | pg-store.ts:286; service.ts:1160 | high, latent in production |
| D10 | A claimed action stays `processing` after a crash | service.ts:1901; relay-endpoint.ts:201 | high |
| D11 | A transient database error parks an outbound row for good | outbound-queue.ts:295-299 | high |
| D12 | `failed_unknown` fires with no receipt lookup for a row deferred overnight | outbound-queue.ts:584-589 | high |
| D13 | Whole-row `putMembership` can overwrite a concurrent state change | pg-store.ts:124-129; service.ts:804, 1110, 1754; photoIntake.ts:124 | medium |
| D14 | Queue checks read in-memory Network state outside the lock | channel.ts:180-195; network.ts:4845-4857 | medium |
| D15 | Queue admission does not treat a stale number as held | outbound-queue.ts:479-485; accounts.ts:321 | medium |
| D16 | Line safety `review` holds compliance rows, ops text says it does not | outbound-queue.ts:407; ops.ts:303 | high, low impact |
| D17 | Notify marks items notified when the queue refuses the text | scheduler.ts:186-199; runtime.ts:649 | high |
| D18 | Turn latency includes the whole queue drain and the global join chain | runtime.ts:671-675; pg-store.ts:249-254 | high (code), impact depends on load |
| D19 | Photos by text cannot reach `PhotoIntake` through a signed turn | service.ts:2051, 2069 | high |
| D20 | An under-13 decline in chat does not revoke OAuth grants | service.ts:758-766, 1277-1280, 1293-1309 | high |
| D21 | After a global STOP, START resumes one app only, and no text can name another | service.ts:1100-1110; consent.ts:37-43, 101-102 | medium (PRD wording is open) |
| D22 | `applyStatus` can move a status back | outbound-queue.ts:613-631 | high, low impact |
| D23 | `leave` runs ahead of earlier rows and does not cancel them | inbox.ts:40, 251, 266 | high, webhook mode only |
| D24 | Staff `clearHold(new_owner)` cannot be resumed after a crash | accounts.ts:194-213 | high, low frequency |

### D1. A STOP turn lost in a process crash cannot be retried

Trigger:

1. `/internal/turn` with text `STOP` commits a claim. Row is `processing`.
2. The process dies before `recordConsent` (OOM, kill after the shutdown grace, host failure).
3. The gateway retries the same `messageId`. Lines 92-98: the lease is young, so the insert writes nothing. Line 106 answers `turn_busy`, retryable.
4. Two minutes later a retry sweeps the row to `unresolved` (line 92). This sweep does not look at `keyword`. The insert conflicts on `id`. Line 107 answers `turn_unresolved`, `retryable:false`.

Result: no ledger event, no `consent` field to the gateway, no confirmation, no alert. Only a new STOP message with a new id works, and the person has no reason to send one.

If the crash came after the ledger write, consent is safe in the backend, but the gateway fence never learns it and the confirmation is lost.

`rescueCompliance` runs only on a JavaScript exception. The test at `inbox-order.integration.test.ts:101` covers the exception, not a crash.

Rule: AGENTS consent path, comments at `inbox.ts:19-23` ("A compliance turn that fails is never sealed").

### D2. Orphan `processing` rows

The sweep at line 92 runs only for the same `sender_hash`, inside a later claim. `purge` handles `done` and `unresolved` only. So a crashed turn of a person who never writes again stays `processing`. `sender_hash` stays. Also, `purge` is not wired (D4). Staff can see it only through `POST /inbound/resolve`, and no ops metric counts these rows.

### D3. Silence confirms an undelivered plan

Trigger (held case):

1. A member has `unanswered >= 3` on the shared line. The streak is per line, across apps.
2. A pair reaches the booked stage. `reveal` runs, `onSent` sets `bookedAt = now`. The row is `transactional`.
3. `dispatch` step 6 waits it in `held_awaiting_reply` (`outbound-queue.ts:398-401`).
4. 48 hours pass. `confirmPlan(o, id, false)` records `plan_confirmed` by silence.
5. The other member holds a confirmed plan. The first member has seen nothing. At 3 days the row ends `expired`.

Other triggers with the same result: `parked_leak_review` waiting for staff, `refused_opted_out` at send time, `suppressed_ineligible` from a stale address book, `failed`, `blocked`.

Also `refused_not_approved` at enqueue (`channel.ts:217-220`).

Effect: a member is "in" for a date or plan without notice. Capital and scorecard events (`plan_accepted`, `plan_confirmed`) are false too.

### D4. Purge and inbox tick are not wired in production

`tickAll` (`backend.ts:406`) is `networksThenNotify` plus `opsTick`. Neither calls `svc.purge()` or `svc.inboxTick()`. `rt.tick()` does not either (`runtime.ts:658-668`), and `afterTick` runs only SLA alerts and bias (`service.ts:533-536`). No file under `deploy/` contains a `.purge(` call.

Effects are in table 3.9. The comment at `service.ts:573` ("The inbox keeps handled ids a week") does not describe production.

In webhook mode a failed inbound row, also a STOP, waits until the same sender writes again.

### D5. A partial ban cannot be completed

Trigger: `ban()` inserts ban rows, then a step fails (a runtime unit throws, the process stops). Staff retry. Line 1742 reads `already = true`, line 1743 refuses `already_banned`. So memberships stay `active`, members stay `active`, `markBanned` never runs.

Send-time checks still refuse texts to the banned person. But matching does not know, so the other side of a match can be probed about a banned person. `hold` is a partial workaround on one app.

### D6. Outbound rows of non-members stay

The header at `outbound-queue.ts:32` says a non-member row keeps the address and text only until it ends. `end()` clears them. `applyStatus` clears them on a final status. In Cloud mode a row stops at `accepted` and neither runs. No statement deletes from `platform.outbound`. Direct texts outside a turn (`service.ts:1373`, staff invite at `1559`) create such rows. Member rows also keep body text forever, until forget.

### D7. Line counters keep a deleted number

Trigger: a member gets one proactive text (`unanswered = 1`), then deletes everything. `purge` skips the row because of `c.unanswered = 0`. `store.deleteAll` does not touch the table. The plain E.164 stays. Production does not call `purge` at all (D4), so today every row stays.

### D8. A stated minor age can be lost

Trigger: the member texts "I'm 15". The unit commits. The process dies before `statedAge()`, or `recordAge` fails after `takeAges` removed the entry. The current app knows (Network state, `m.minor`). `platform.people.lowest_age` and the age floor do not. Other apps still read the old age through `matching_ages`, so the person stays matchable there. A signed turn then ends `unresolved`, so no retry repeats the statement.

### D9. Purge cuts the STOP hint cooldown

`hit()` reads `max(last_at)` for the bucket. A row older than 2 days is gone after purge, so `prevAt` is null and `ok` is true. PRD 40.3 says one hint in 30 days. Wiring `purge` for D4 activates this unless the purge excludes such buckets.

### D10. Claimed action stays `processing`

Trigger: `/internal/set-state` claims, then the process dies before the second transaction. Replays get 409 `action_unresolved`, not retryable. The pause never applies. `relay-endpoint.ts` has the same shape. At-most-once is kept. The loss is silent.

### D11. Transient error parks a row for good

`send()` runs an admission transaction. A throw (deadlock detected, reset connection) reaches the catch at line 295, and `end(row, "parked_error", ...)` runs. `parked_error` has no release path. The row is lost with an alert line only. If the database is fully down, `end()` throws too and the row survives, so a partial failure is treated worse than a full one.

### D12. `failed_unknown` with no lookup

Trigger: a proactive row is created at 21:30, waits for quiet hours until 09:00, then the deliver call times out. Status `unknown_acceptance`. The next drain runs `reconcileUnknown`. `created_at` is 11.5 hours old, past the 6-hour TTL, so the row ends `failed_unknown` before any receipt lookup. The text may have gone out. The cap slot is released (`NOT_SENT`).

### D13. Lost update on membership

`putMembership` replaces all fields. Example: `consentAnswer` reads `m` with state `active`. A concurrent `ban` sets `restricted`. `consentAnswer` writes `{...m}` and restores `active`. One sender's turns are serial, but staff and web paths are not. `correctHome` shows the safe form (`service.ts:915`, targeted update under row locks).

### D14. Queue checks read memory

`stale`, `recipient` and `leaks` read `rt.net` and `rt.memberOf` outside the lock. With two replicas (the deploy docs say this is allowed, and overlap happens on deploy), replica A can run a check on state older than a hold, a minor flag or a closed opportunity written by replica B. Inside one replica a check can see state of a unit that later rolled back. Admission rechecks member status, opt-out and binding for all rows, and everything for relay rows. It does not recheck the Network's own hold or age view for other rows. Confidence medium because `load` refreshes often and the docs keep one replica by default.

### D15. Stale number in queue admission

`activeMembership` treats 12 months of silence as not active. The queue binding does not. `seen()` runs only when the number writes. So a proactive row to a number silent for 12 months passes admission. The unanswered cap limits this to a few messages. PRD intent: a recycled number may have a new owner.

### D17. Notify marks items notified on refusal

See 3.16. The item is `notified`, so the scheduler never retries, and the delivery counts toward `weeklyCap`, although the text ended `refused_*`, `suppressed_*` or `expired`. An assistant can still show the item.

### D19. Photos by text unreachable

See 3.22. Also the copy at `photoIntake.ts:35` asks members to send a photo again. In Cloud mode that photo never arrives.

### D20. Under-13 decline keeps OAuth grants

`rt.unit.forget` and `statedAge` call `forget()` and `forgetMembership()` directly. `forgetListeners` run only inside `hooks.onForget`. So `mcp.revokeAllFor` is not called. A grant row with `phone_key` stays, for a person the policy says we keep nothing about. Listener failure on the normal path is also only logged, with no retry (`service.ts:763-765`).

### D21. START after a global STOP

STOP writes a global event. START writes an app event for the routed app (`keywordEvent`). `resolveConsent` keeps every other app `opted_out`. Their memberships stay `paused`. Routing picks one app (`route`). "start slop" is not a keyword. The founder correction removed site account controls. So the person has no text path back to the other apps short of leaving and joining again. PRD line "START resumes consent" does not say per app or global, so a founder reading is needed.

## 5. Quint plan

Order by value:

1. `turn_consent.qnt`: `signed-turn` plus `consent-fences`. Finds D1, D2 and the fence lag. Crash is an action. Bound: 2 senders, 3 messages, 2 apps, clock in steps of 30 s around the 2-minute lease.
2. `send_belief.qnt`: `send-belief` with a reduced outbound machine (`pending`, `held`, `sent`, `ended`). Finds D3.
3. `sagas.qnt`: one parameterized saga with steps and crash points. Instances: ban, leave, delete all, clear hold, under-13 decline. Invariant: at terminal state the residue set is empty. Add `retryAllowed` to find D5 and D24.
4. `unit_replicas.qnt`: `network-unit` with two replicas, `committed` and `memory`. Covers D8, D14. Include a volatile `statedAges`.
5. `retention.qnt`: small model with `tickSet` as a parameter. Check that every status with a `due` rule has a caller in the production `tickSet`. D4, D7, D9 follow.
6. Merge `person-cap-slot` and `line-streak` into the per-package outbound model. Do not model them alone.

Abstractions:

- One transaction is one atomic action.
- Row locks are implicit. Advisory locks are explicit only where a gap exists between steps.
- Time is a discrete counter with named thresholds: `LEASE`, `UNRESOLVED_BLOCK`, `OPT_OUT_48H`, `TTL_3D`, `UNKNOWN_TTL`.
- The gateway is a nondeterministic retrier, with a bound on attempts as a parameter, because its real policy is upstream.

Questions for a maintainer before modelling:

- Does the gateway keep its own STOP record when the backend answers `turn_unresolved`?
- Is START meant to resume one app or all apps after a global STOP?
- Is one replica a firm rule, or does the model need two?
