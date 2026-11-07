# State machines: network service inbound path

Key: `network-service-inbound`. Branch `claude/quint-state-machines`, base commit a0ed7bc.
Hand-written research for Quint modelling. No code was changed.

Scope: `packages/network/service`: `/internal/turn` and the inbound path, the text join and onboarding
conversation, turn idempotency, the shared-agent actions, the Eliza notice, the consent echo to the gateway,
routing, and pending joins. The file reads `packages/platform/src` (accounts, consent, pg-store) and
`packages/network/src/network.ts` only where the inbound path calls them.

Abbreviations: `S` = `packages/network/service/service.ts`, `I` = `service/inbox.ts`, `R` = `service/runtime.ts`,
`A` = `packages/platform/src/accounts.ts`, `PS` = `packages/platform/src/pg-store.ts`,
`N` = `packages/network/src/network.ts`. `file:n` is a line number.

## 0. Method and evidence

- All of `service.ts`, `inbox.ts`, `runtime.ts`, `route-authority.ts`, `cloud-channel.ts`, `photoIntake.ts`,
  `profile-read.ts`, `relay-endpoint.ts`, `channel.ts`, `serve.ts`, `main.ts`, `learning-consent-context-endpoint.ts`
  were read, and the migrations for `platform.inbound`, `platform.pending_texts` and `platform.eliza_notices`.
  `packs.ts` (onboarding part), `snapshot.ts` (participation part), `README.md` (Eliza seam) and the
  `network.ts` inbound and onboarding parts were read in part. Other `service/` files (profile suggestions, cost,
  bias, postings) do not touch the turn path and are out of scope.
- The Eliza gateway is upstream and is not in this repository. Each statement about gateway behaviour is marked
  **unverified**. The wire contract (`packages/core/src/svc/contract.ts`) was read.
- Defects marked **probe** were reproduced with a scratch test against the real service, HTTP and Postgres:
  `/private/tmp/claude-501/-Users-nubs-thenetwork/fb3a81a2-1e7b-4e4d-a9fa-a85215213426/scratchpad/probe/inbound-probe.test.ts`.
  It used a throwaway database on :54339, which it dropped, the dry-run adapter, and no provider or LLM.
  The output is quoted in the defect. Defects marked **trace** were checked by reading only.
- One machine fact is central. In production the gateway owns the Blooio webhook, so `I.signed` is the live path.
  `I.receive` (legacy webhook) stays for tests and the simulator.

## 1. Summary of machines

| id | Priority | Kind | State lives in | Model |
|---|---|---|---|---|
| `signed-turn` | P0 | explicit + implicit lease | `platform.inbound` signed rows | with `consent-ledger` |
| `legacy-inbox-row` | P1 | explicit | `platform.inbound` rows with `request_hash` null | alone, small |
| `sender-serialization` | P0 | implicit lock | advisory lock, partial unique index | inside `signed-turn` |
| `turn-receipt` | P1 | implicit | `inbound.receipt*`, `messages.status`, `outbound.status` | alone |
| `action-receipt` | P1 | explicit in JSON | `inbound.action_receipts` | alone |
| `consent-ledger` | P0 | explicit, event-sourced | `platform.consent_events` | core model |
| `gateway-consent-mirror` | P0 | implicit, cross-service | `TurnResponse.consent`, gateway fence | with `consent-ledger` |
| `opt-out-projection` | P0 | implicit | `memberships.state`, `members.opted_out`, `MemberState.optedOut` | with `consent-ledger` |
| `leave-flow` | P0 | implicit ordered steps | ledger, photos, unit, membership | with `consent-ledger` |
| `text-join` | P0 | implicit | `platform.pending_texts` kind `join` + ordered writes | with `age-floor` |
| `age-floor` | P0 | implicit monotone | `people.lowest_age`, `age_floor`, `members.age`, `statedAges` | with `text-join` |
| `looking-for-enroll` | P0 | implicit | pending kind `looking_for` | with `text-join` |
| `share-offer` | P2 | implicit | pending kind `share` | alone or skip |
| `photo-consent-text` | P2 | implicit | pending kind `photo_consent`, membership profile | skip (unreachable in production) |
| `eliza-notice` | P1 | implicit, one-shot | `platform.eliza_notices` | with `signed-turn` |
| `recycled-hold` | P0 | explicit | `phone_identities.hold`, `last_seen_at` | with `consent-ledger` |
| `routing` | P1 | pure decision | none (reads) | as a pure function |
| `member-onboarding` | P1 | explicit | `MemberState.stage`, `awaiting`, `onboarding` | alone |
| `open-turn-binding` | P1 | implicit | `inbound.response` + live recheck | alone |
| `participation-window` | P2 | implicit | `members.participation_state/_window` | alone |
| `route-authority-window` | P1 | implicit clock | env policy, `inbound.network_authority` | alone |
| `text-rate-windows` | P2 | implicit | `platform.rate_limits` | abstract as nondeterministic |

## 2. Machine `signed-turn`

**Kind:** explicit status column plus implicit lease. **Where:** `platform.inbound` (migrations 0015, 0021, 0023, 0036).
`status` CHECK is `pending|done|failed|processing|unresolved`. Unique partial index
`inbound_signed_sender_processing (sender_hash) where status='processing'` (0021).

**States.** Row id `msg:<channel>:<messageId>`.

| State | Definition |
|---|---|
| `absent` | no row |
| `processing_live` | `status=processing`, lease fresh (`arrived_at` within 2 min) |
| `processing_stale` | `status=processing`, lease old. Implied: no column says it |
| `done_handled`, `done_open`, `done_ignored` | `status=done`, `response.outcome` |
| `unresolved_blocking` | `status=unresolved`, `sender_hash` set, `arrived_at` within 10 min |
| `unresolved_quiet` | same, older than 10 min |
| `released` | staff resolved: `unresolved`, `sender_hash` null |
| `sealed` | was done, payload erased (retention or forget): `unresolved`, all payload null |
| `tombstone_gone` | row deleted after 37 days. Same as `absent` |

**Transitions.**

| From | Event | Guard | Effect | To | Where | Actor |
|---|---|---|---|---|---|---|
| absent | signed turn | try-lock got; before `admitUntil`; no `processing` row of sender; if not keyword, no `pending` and no fresh `unresolved` | insert claim | processing_live | I:86-99 | gateway |
| absent | signed turn | any guard fails | none | absent, 409 `turn_busy` retryable | I:100-102 | gateway |
| processing_stale | any signed turn of sender | lease old | sweep; event, sender null | unresolved_blocking | I:92-93 | gateway (lazy) |
| processing_live | timer 30 s | row still processing | `arrived_at=now` | same | I:111-114 | worker |
| processing_* | run returns | row still processing | status done, response, handled_order | done_* | I:116-120 | worker |
| processing_* | run returns | row no longer processing | throw | catch path | I:119 | worker |
| processing_* | run throws, keyword, consent or replies committed | | response `compliance_partial` | done_handled | I:122-124, 144-163 | worker |
| processing_* | run throws, keyword, nothing committed | | delete row; undo | absent, 409 `turn_failed` retryable | I:148-152 | worker |
| processing_* | run throws, not keyword | | unresolved; undo | unresolved_blocking, 409 not retryable | I:126-128 | worker |
| done_* | replay, same hash | | return stored response, then live recheck | done_* | I:104, S:2098-2112 | gateway |
| any row | replay, other hash | | 409 `turn_conflict` | same | I:103 | gateway |
| processing_* | replay | | 409 `turn_busy` retryable | same | I:106 | gateway |
| unresolved_* | replay | | 409 `turn_unresolved` not retryable | same | I:107 | gateway |
| processing_*, unresolved_* | staff `/inbound/resolve` | admin@* | status unresolved, `sender_hash` null | released | I:211-215, S:2345-2354 | staff |
| done_* | purge, `handled_at` older than 7 d | | erase payload | sealed | I:198-200 | cron |
| any signed row but current | forget of member | in the save tx | erase payload | sealed | R:366-369 | staff/member |
| any signed row | delete everything | by `sender_hash` | erase payload | sealed | PS:304-309 | member |
| unresolved | purge, `arrived_at` older than 37 d | | delete | absent | I:203 | cron |

**Invariants.**
- INV-T1: at most one `processing` row per `sender_hash` (unique index).
- INV-T2: a `done` row is immutable except by sealing, receipt, action receipts.
- INV-T3 (idempotency): one messageId runs `inbound()` at most once, except after a `turn_failed` release, which
  needs a keyword and no committed effect. The test `a committed collection followed by a fault...` pins this.
- INV-T4 (safety, AGENTS "Consent path"): a STOP whose request reached the service ends with a ledger event, or
  the gateway gets a retryable error. **This fails, D1.**
- LIVE-T1: `unresolved_blocking` ends in 10 min with no actor.
- LIVE-T2: `processing_stale` ends only when the sender writes again. No cron sweeps it. `I.drain` reads only
  `pending`.
- LIVE-T3 (comment I:19, I:84): STOP, START and HELP are never held back. **This is false for `processing`, D14.**

**Interactions.** `collect()` writes replies in the same transaction as Network effects (I:166-171, R:320-323).
`writeUnit` seals rows (R:366). `sharedAction`, `relayEndpoint` and the receipt read `done` rows. The legacy path
checks signed rows (I:254-258).

**Failure analysis.**
- Claim is one committed transaction. Effects are many transactions after it. Nothing makes them atomic.
- Crash after the claim: the row is `processing`, then swept by a later turn of the same sender. The retry of the
  same messageId is what sweeps it, and then conflicts on the primary key, and then reads `unresolved`.
- Duplicate delivery: the primary key stops it.
- Two actors: the try-lock is `pg_try_advisory_xact_lock(hashtext('inbox-sender:'+addr))`, which also excludes
  the legacy session lock of the same key (I:87, I:222-225). A hashtext collision gives a false `turn_busy`.
- Clock skew: `now` is read before the lock. A worker that cannot reach Postgres for 2 min loses its lease while
  its effects continue; the final update then finds no row (I:119), and collection throws (I:170).
- Crash: `onFail` undo runs only on an exception, never on a crash (I:127, I:151).

**Quint notes.** `status: MsgId -> Status`, `lease: MsgId -> Time`, `effects: MsgId -> Set[Effect]`. Actions:
`claim`, `renew`, `step(effect)` one per commit point, `crash`, `complete`, `throw`, `sweep`, `replay`, `resolve`,
`purge`. Bounds: 2 senders, 3 messages, time in ticks of 30 s. Check INV-T1 to T4. Model each commit point of
`inbound()` as its own step, or D1 is invisible.

## 3. Machine `legacy-inbox-row`

**Where:** same table, `request_hash` null. **States:** `absent`, `pending(attempts 0..4)`, `done`,
`done(cancelled_by_stop)`, `failed`.

| From | Event | Guard | Effect | To | Where |
|---|---|---|---|---|---|
| absent | webhook | signature ok | insert | pending(0) | I:175-182 |
| absent or row | webhook retry | conflict | none | same, `duplicate` | I:182 |
| pending | handleWaiting picks row | first compliance row in the first 50, else oldest; ordinary row waits if a signed turn is live | `handle(ev)` | done | I:246-266 |
| pending | STOP handled | row ordinary, in the same scan, `received_at <= stop` | cancel | done(cancelled_by_stop) | I:234-241, 266 |
| pending(n) | handler throws | n+1 < 5 | attempts+1, loop stops until next tick | pending(n+1) | I:275-277 |
| pending(4) | handler throws | | event null | failed | I:269-273 |
| done/failed | purge 7 d | | delete | absent | I:201 |

**Invariants.** One handler per sender (promise chain plus `pg_advisory_lock`). Nothing written before a STOP is
acted on after it, for rows in the scan window. **Failure:** a crash between `handle` and the `done` update
re-runs the handler; the member unit dedupes on `network.messages` id and the ledger on `ref`, but `people.hit`
counters and a non-member join rerun. See D17. `isComplianceText` uses the default `APPS`, while the service
passes `this.apps` (I:38 vs S:1079). Only a database rename of an app shows the difference.

**Quint:** a small model. Priority is low while production uses signed turns.

## 4. Machine `sender-serialization`

`I:87` (signed, try-lock, transaction scope), `I:218-231` (legacy, process chain plus session lock),
`PS:250-262` (`withLock('join:<e164>')`, session lock, plus a **process-wide** promise tail), `store.withLock`
(network unit lock), `withPhoneAgeGuard` (separate tail). Lock order on the join path is
`join:<e164>` then `network-<id>`. `A.joinLocked` uses the same order. No path inverts it (trace).
`I:87` is held only for the claim transaction, so what keeps a sender single-threaded during the turn is the
`processing` row, not the lock. The STOP path is not under `join:<e164>`. In production the `processing` row
covers text against text. A web join against a text STOP is not covered, and both write the ledger.

## 5. Machine `consent-ledger`

**Kind:** event-sourced. **Where:** `platform.consent_events` (e164, app or null, state, source, ref, at); unique
`(e164, ref) where ref is not null`. Resolve: `resolveConsent` (`platform/src/consent.ts`).

**State per (phone, app):** two last events `appLast`, `globalLast`. Derived:

| appLast | globalLast | Result |
|---|---|---|
| none | not opted_out | undefined (not opted in) |
| none | opted_out | opted_out |
| s | none or opted_in | s |
| opted_in, at > global.at | opted_out | opted_in |
| other | opted_out | opted_out |

Order is by `at`, then `id`. In a turn, `at = min(receivedAt, now)` (S:1357-1360). `deleteAll` removes all events
(PS:315), so suppression carries the state.

**Writers on the inbound path.**

| Event | Scope | `at` | ref | Where |
|---|---|---|---|---|
| STOP, STOP ALL | global (shared or default), app (`PLATFORM_STOP_SCOPE=app` with forced app) | consentAt | rowId | S:1054-1056, 1322-1323 |
| START, member | app | consentAt | rowId | S:1105 |
| START, non-member | app | consentAt | rowId | S:1135 |
| leave, person | app | **now** | **none** | A:425 |
| leave, no person | app | consentAt | rowId | S:1089 |
| text join | app | consentAt | rowId | S:1447 |
| enroll | app | consentAt | `rowId:app` | S:1491 |
| under-13 decline | app | now | none | S:1308 |

**Invariants.**
- INV-C1: a send that is not compliance to a phone whose resolved state is `opted_out` never leaves through the
  queue (`consentRefused`, S:696-715). Collected replies do not pass this check (see D5).
- INV-C2: STOP has one answerer, the service (AGENTS 2026-10-09, item 2).
- INV-C3: a banned number is never opted in by START (S:1103, 1134).
- INV-C4: an older START never undoes a newer STOP. Ledger: true by ordering. Mirror: **false on the non-member
  path, D2.**
- INV-C5: `TurnResponse.consent` agrees with the ledger's resolved state after the turn. **False in D2 and D8.**

**Interactions.** `signed-turn` (commit point order), `opt-out-projection`, `gateway-consent-mirror`,
`activeMembership` (A:319-329), `admission` (S:2059-2066).

**Failure.** The event commits alone (`addConsent`, no transaction with anything). A crash after it leaves the
ledger ahead of every projection. That is the safe direction for sends, and the mirror stays behind.

**Quint.** Model events as a set with `at`, and `resolve` as a pure def. Actions: `stop(t)`, `start(t, app)`,
`leave(t, app)`, `join(t, app)` with `t` free so that out-of-order delivery is explored. Invariants above.

## 6. Machine `gateway-consent-mirror`

**Kind:** implicit, two-service. **State:** service side `turn.consent` (in memory) then `inbound.response.consent`;
gateway side a send-time fence (**unverified**).

Sequence for STOP: claim; route; ledger write (S:1323); `turn.consent` set (S:1325); confirmation set (S:1327);
pending deleted; member unit; other apps; response stored; gateway reads `consent`, sends reply, updates fence,
then posts receipt. If the response is lost, the retry reads it from the row, so the mirror is at-least-once for a
`done` row. It is zero for an `unresolved` row (D1).

START emits `scope:"app"` after STOP emitted `scope:"all"`. Whether an app-scoped opt-in clears an all-scoped fence
is **unverified**. Open question for upstream.

Quint: `fence` variable updated only from delivered responses, with `deliver` as a lossy action that replay can
repeat. Invariant to check: `fence(phone)=out` implies ledger out, or the reverse, and report which holds.

## 7. Machine `opt-out-projection`

Three projections of one fact, updated in separate transactions:
`memberships.state` (`active -> paused`, S:804; `paused -> active`, S:1110, only the routed app),
`network.members.opted_out` (`unit.optOut`, R:360), `MemberState.optedOut` (N:675-676, in the Network state JSON).

| Event | Ledger | Membership | members.opted_out | Network state |
|---|---|---|---|---|
| STOP, routed member | global out | paused, every app | true (routed unit, then `stopped`) | dropped from open items |
| STOP, not a member of routed app | global out | paused | true via `stopped` | same |
| STOP, held number | global out | **unchanged** | **unchanged** | **unchanged** (D21) |
| START, routed app | app in | active, one app | false, one app | false, welcome back |
| START older than STOP | event only | unchanged | unchanged | unchanged |

Order in `stop()`: ledger; pending delete; routed unit; then each other app one unit at a time (S:1329-1342).
`stopped` uses a time-based inbound id (S:808), so a rerun is a second STOP on the Network, which is harmless because
`dropMember` is idempotent (trace). Quint invariant: eventually (after `drain`) all three agree with the ledger.
It does not hold for D1 crash, D8, D21.

## 8. Machine `leave-flow`

Steps: (1) `addConsent` app out (A:425); (2) `photos.deleteFor`; (3) `forget` unit, which removes the member row
and seals turns; (4) listeners (OAuth); (5) `forgetMembership`; (6) in the service: set `turn.consent`,
`turn.confirmation`, `direct` compliance (S:1090-1091). Each is its own commit. `turn.consent` is set only after
all of them. See D9.

Guard: `leaving && e164 && lrt && lid`. With no `lid` the text falls through to the normal path (S:1081-1094): a
non-member gets the notice and a join prompt (D16).

## 9. Machine `text-join`

**Where:** `platform.pending_texts` (PK phone_hash, kind, app_id; kind in `join|looking_for|share|photo_consent`).
`putPending` deletes other rows of the same kind unless `share` (PS:271). TTL 1 day read-side (S:999), purge 2 days.

**States per phone.**

| State | Definition |
|---|---|
| `stranger` | no pending, not a member of the routed app |
| `asked(app, name?, home?)` | pending join with `age` null |
| `need_name(app, age, home?)` | pending join with age |
| `over_ask_cap` | `asked`, more than 3 asks in the day window: no text, row refreshed |
| `declined` | age check failed: floor written, pending deleted |
| `committing` | implied: between the `deletePending` at S:1435 and the end of `join()` |
| `member` | `network.members` row exists |
| `waitlist_onboarding` | membership `onboarding`, no member row (no app uses it now) |

**Transitions** (all in `people.withLock('join:e164')`, S:1140; actor member). Guards run in this order in `join()`:

| From | Event | Guard | Effect | To | Where |
|---|---|---|---|---|---|
| any | text | banned | none, `held` | same | S:1390 |
| any | text | invite-only and not invited and not (shared and ntwrk) | one reply a day | same | S:1393-1399 |
| any | text | no age, invalid home | ask home | same, pending not written | S:1407-1409 |
| stranger, asked | text | no age | pending; ask if count <= 3 | asked or over_ask_cap | S:1411-1414 |
| any | text with age | age check fails | floor, delete pending, decline | declined | S:1416-1425 |
| any | text with age | age ok, invalid home | ask home; **age not kept anywhere** | same | S:1426-1429 |
| any | text with age | age ok, no name | pending with age; **floor not written** | need_name | S:1430-1434 |
| need_name, any | text with name | age from text or pending | commit sequence | member | S:1435-1463 |
| member | STOP | | delete pending | | S:1328 |

**Commit sequence** (each line a separate commit): `deletePending(join)`; `createPerson`; `recordAge`; `unsuppress`;
`putMembership`; `recordConsent`; `createMember`; `memberMessage` (welcome); then either `link` system send and
`share` pending, or `ask` system send and `looking_for` pending.

**Invariants.**
- INV-J1 (AGENTS decision 1): the stored lowest age is <= every age the phone stated. **False, D3.**
- INV-J2: under 13 stores nothing but the floor. Pending may still be written for a floor under 13 (D19).
- INV-J3: one person, one membership, one member per (person, app). **False under D10.**
- INV-J4: `membership.active` implies a `network.members` row. **False in a crash window, D11.**
- LIVE-J1: `asked` ends in 1 day by TTL.

**Failure.** A crash in the sequence leaves a partial join, and the signed retry is refused. The next message from
the person enters `join()` again because `rt.memberOf` is undefined. Pending was deleted, so the person is asked
again. The second pass overwrites the membership with a new member id.

**Quint.** Variables: `pending: Phone -> Option[{app,name,age}]`, `floor: Phone -> Option[Age]`,
`lowest: Person -> Option[Age]`, `membership`, `memberRow`, `stated: Phone -> Set[Age]` (a history variable for
INV-J1). Action `say(age?, name?, homeOk)` nondeterministic. Ages abstracted to {12, 15, 25}. Each commit is a step.

## 10. Machine `age-floor`

Monotone minimum over several stores: `people.lowest_age`, `platform.age_floor`, `network.members.age` per app,
`MemberState.age/statedAge/minor` per network, and an in-memory queue `runtime.statedAges` (R:138-149).

Path of a chat-stated age: `N.handleInbound` calls `onAgeStated` (N:700, 901) -> `statedAges.push` -> unit commit
-> `S.statedAge` -> `takeAges` -> `recordAge` -> `noteAgeFloor`, `noteAge`, `onAgeLowered` -> `S.ageLowered` ->
SQL `least()` on each member row -> next tick `syncMember` (N:3267) sets `minor` and drops items.

`statedAge` filter: keep explicit, declined, or minor ages. A non-explicit adult age is dropped by design (S:1294).
Under 13 stated by an attested adult is recorded as 13 (S:1300).

**Invariants.** INV-AG1: `lowest_age` and the floor are monotone non-increasing (`least`, PS:97-115), except
`clearAgeFloor` on a new owner of a number (A:211). INV-AG2: a person with any age under 18 is never matched on any app (AGENTS
decision 1). The drop on another app waits for that app's next tick (one minute); no unit runs at `ageLowered`.
Matching is at most daily and proposals wait for review, so this window is small (trace).

**Paths that do not reach it:** text answered by `enroll` (D4), `share`, keyword turns, a crash after the unit
(D12). `join()` calls `memberMessage` without `statedAge` (S:1452), so the queue waits for the next message.

## 11. Machine `looking-for-enroll`

**States:** `none`, `asked` (pending, app ntwrk, 1 day), `done`.

| From | Event | Guard | Effect | To | Where |
|---|---|---|---|---|---|
| none | ntwrk join, shared, no other apps, not invited | | `ask:` system send (transactional, queued); then pending | asked | S:1457-1461 |
| asked | member text | not keyword, not profile read, app ntwrk, `lookingFor` non-empty | enroll | none | S:1115-1117 |
| asked | member text | no wants | normal message; pending stays | asked | S:1115-1124 |
| asked | STOP | | delete | none | S:1328 |
| asked | clock | 1 day | ignored by `pendingOf` | none | S:999 |

Enroll loop per wanted app, non-atomic: `putMembership`, `recordConsent`, `createMember`. `deletePending` comes
after the loop. Slop needs `lowest >= 18`, known. Then one unit stores the inbound and, if any app joined, the
reply (S:1497-1501). `existing` live memberships count as joined even if paused (S:1484).

**Invariants.** A minor is never enrolled in slop from this question (true). Each app gets its own opt-in with the
wording shown (true, S:1491). Every answer gets a reply (**false, D7**). The reply is collected (**false, D6**).
Age statements in the answer are read (**false, D4**).

The `ask` send is transactional and is not collected (R:289), so it reaches Cloud as `proactive` (`cloud-channel.ts:37`,
`kind` mapping). `putPending` runs after the unit, and `unitOfWork` delivers first, so an instant reply
can find no pending. A crash there leaves a question with no pending (trace).

## 12. Machines `share-offer`, `photo-consent-text`

**share-offer.** `none -> offered` after a join when other apps exist (S:1454-1456). `offered -> none` on exact
`share` in that app (S:1113, 1505-1516), or STOP, or TTL. Grants are per pair. The grant write and the reply are
separate commits. `route()` has no pending-share branch (D28). Priority P2.

**photo-consent-text.** `none -> asked` on an attachment (`photoIntake.ts:89-91`), `asked -> consented`
on `YES PHOTOS` (profile.photoConsent), `asked -> none` on `NO PHOTOS`, STOP, TTL. Attachments reach `inbound` only
from the legacy webhook. `sharedTurn` passes `mediaUrls: []` and `TurnRequest` has no media field (S:2069), so
in production this machine has no entry transition (D18). Do not model it now.

## 13. Machine `eliza-notice`

**States per phone:** `unsent`, `sent_row_collected` (row and collected reply in one transaction, S:1187-1191),
`sent_final`, `erased`.

| From | Event | Guard | Effect | To | Where |
|---|---|---|---|---|---|
| unsent | non-member turn, in the join lock | signed; no member anywhere; not banned; age not under join age; floor can join | insert, collect | sent_row_collected | S:1175-1191 |
| sent_row_collected | turn ends done | | none | sent_final | |
| sent_row_collected | turn throws | | `onFail` deletes row | unsent | S:1195, I:127,151 |
| sent_row_collected | process crash | | none: row stays, notice never sent | sent_final (false) | |
| sent_final | under_age later | signed | delete row | erased | S:1146 |
| sent_final | number change | | row moves to new hash | sent_final | PS:368-369 |

**Invariants.** At most one notice per number (PK). Guards missing compared with the send path: no consent check,
no suppression check (D5). `deleteAll` does not delete the row (PS:304-327), so the keyed hash outlives a delete
of everything; only `under_age` and a change of number remove it. Whether that is intended is a founder question.

## 14. Machine `recycled-hold`

`phone_identities.hold` null or `recycled_number`; `last_seen_at`. `new|ok -> held` when not seen for 12 months at
`A.seen` (A:176-184). `held -> ok` on staff `same_owner`; `held -> absent` on `new_owner` (A:194-213). `activeMembership`
treats stale as closed without writing a hold (A:321). In `inbound()`: STOP runs **before** `seen` (S:1054 vs 1061),
so it does not move `last_seen_at`. While held, `personFor` is undefined and `identities` and `member_apps` hide the
address. Effects: D21. `turn.memberId` keeps the value read before the hold is set (S:1045), so a `held` response
can carry a memberId in the turn where the hold starts. It carries `accountEligible:false`. Cosmetic.

## 15. Machine `routing`

Pure decision over reads; no stored state. Precedence (S:957-981): forced app; `app_lines` row; explicit profile read
naming an app; whole-message keyword; pending join (only if not a member of that app and either no memberships or
the text has an age); newest open item; last writer; ntwrk.

Model as a pure def. Properties: total (always returns an app); keyword never overrides a forced app; a member's
sentence naming an app does not route. Gaps: no branch for pending `share` (D28), none for `photo_consent` (D18), and
after a global STOP the routed app for START can differ from the app named in the STOP text (D29).

Then the runtime is chosen by `memberApps` or a scan (S:1030-1039). `identities()` filters by `conversationCities`, so
a member whose home is not served by the runtime has no address there.

## 16. Machine `turn-receipt`

**States per done handled turn:** `none`, `unknown`, `accepted`, `rejected`.

| From | Event | Guard | To | Where |
|---|---|---|---|---|
| none | receipt, no replies collected | all fields empty, history false | that outcome | S:2020-2024 |
| none | receipt | ids match in order; accepted needs provider ids and history, unless `accountFree` | outcome; messages and outbound updated | S:2025-2043 |
| unknown | accepted or rejected | | outcome | S:2017 |
| any | same values | | same, replayed | S:2016 |
| accepted, rejected | other values | | 409 conflict | S:2017 |

`messages.status`: `collected -> sent|send_unknown|refused_gateway`, `send_unknown -> sent|refused_gateway`.
`outbound.status` same (outbound-queue 696-703). `accountFree` needs a compliance-only reply set, or
`reason=onboarding_asked` with a null member (S:2028-2031). **Stuck:** a mixed or other non-member reply can never
be accepted without history (D22). **Stuck:** no sweeper for `collected` when no receipt comes (D23).

Effects after commit: `projectNotifications`, retried by later drains (R:462-488).

Quint: a small lattice model. Invariant: `accepted` is terminal; message status follows the receipt.

## 17. Machine `action-receipt`

**Where:** `inbound.action_receipts[key]` (0023). Key is SHA-256 of `[turnId, path, idemKey]`. Per-turn limit 16.

**States:** `absent`, `processing`, `completed(response)`, `unresolved`.

| From | Event | Guard | To | Where |
|---|---|---|---|---|
| absent | action | turn done and open; same app, member; `activeMembership` live; route ok; window not expired | processing | S:1892-1903 |
| processing | effect tx commits | under row locks; `complete()` | completed | S:1905-1965 |
| processing | error | | unresolved | S:1967-1971 |
| processing | route expired | | stays processing, 403 | S:1968 |
| processing | crash | | stays processing forever | |
| completed | replay same digest | | same, `replayed` for set-state | S:1897 |
| any | replay other digest | | 409 | S:1895 |
| processing, unresolved | replay | | 409 `action_unresolved` | S:1896 |

Claim and effect are two transactions, so a crash means at-most-once, and the action is lost. That is the stated
fail-closed design. Row locks order: people, memberships, members, inbound; relay uses the same without members
(relay-endpoint). Sealing erases `action_receipts`, and the `status='done'` check then stops new actions.
`relayEndpoint` shares this machine and the key space (`<messageId>:relay`).

Quint: alone. Invariants: an effect is applied at most once per key; no effect after STOP (authorized under lock).

## 18. Machine `open-turn-binding`

`done_open` response has `app`, `memberId`, `context`. A replay recomputes `sharedContext` and returns 409
`turn_context_changed` when it differs (S:2098-2104). This check also runs on the first response, right after the
stored one was computed (D13). Actions and relay bind to the stored response plus a live `activeMembership`.
`activeItems` is always null today (R:573), so `itemId` must be null for relay.

## 19. Machine `member-onboarding`

**Where:** `MemberState.stage` (`new|age|q1|q2|q3|active`), `awaiting`, `ageUnknown`, `onboarding` JSON, all in the
network state JSON.

| From | Event | Guard | To | Where |
|---|---|---|---|---|
| new | first message | age unknown | age | N:980-983 |
| new | first message | minor | active | N:985 |
| new | first message | else | q1 | N:986 |
| age | message | age resolved, minor | active, minor notice | N:1006-1009 |
| age | message | age resolved, adult | q1 | N:1010 |
| age | message | unresolved | active, single-player | N:1007 |
| q1 | answer | app has onboarding hook, not minor | active plus hook loop | N:1085-1088 |
| q1, q2 | answer | no hook | q2, q3 | N:1094-1095 |
| q3 | answer | | active | N:1096 |
| q* | a clear request, or text with no awaiting | | active | N:824-832 |

Slop loop after active: `read`, then `next`: read-back when hard fields are set and not confirmed, else
`nextQuestion`, each asked at most `MAX_ASKS_PER_QUESTION`. Confirmation lives inside `SlopOnboarding`. The Network
never reads it. `activate` happens before confirmation, so a slop member is `active` with an unconfirmed profile.
Whether matching waits for the hard fields is in the engine pack (another scope). Terminal for a minor: `next`
returns undefined (packs.ts `slopOnboarding.next`).

STOP in any stage drops out of items but does not change `stage`. Forget deletes the state. No stuck stage: every
message moves it on (N:831).

Quint: alone, small. Invariants: a minor never reaches a hook question; the stage never goes back.

## 20. Machine `participation-window`

`members.participation_state` (`normal|open|receiving|quiet|paused|...`), `participation_window` jsonb.
`effectiveParticipation` (snapshot.ts:20-33) derives the state from Clock. Writers: `/internal/set-state`
(S:1932-1950), `resumeMember` (S:869-880). Scheduled means traveling or any of from, until, note. `unchanged` writes no
event. Past windows stay in the row and read as none. Opted-out reads `paused`. Quint: pure def plus two writers. P2.

## 21. Machine `route-authority-window`

Staging only (`NETWORK_ROUTE_AUTHORITY_POLICY`). Clock-derived states: `admitting` (now < admitUntil), `draining`
(admitUntil <= now < drainUntil), `closed`. New turns only while admitting, rechecked after the lock (I:90). Durable
turns may complete their receipts and actions until drain, fenced by `assertLockedRoute` before and after lock waits
(S:1844-1847, 1906). Legacy production has `policy undefined` and accepts only an absent envelope
(route-authority.ts `routeEnvelopeAllowed`). Tests: `isolated route authority fences...`. Relay and photo
resolve refuse any policy. No defect found. Quint: small, with a clock variable. P1.

## 22. Machine `text-rate-windows`

`platform.rate_limits` buckets, fixed windows, locked per bucket: `invite_only:<app>:<key>` (1/day),
`join_ask:<app>:<key>` (3/day), `stop_hint:<app>:<key>` (min gap 30 d), `photo_msg:<rowId>` (dedupe),
`photo_not_adult`, `photo_consent_ask`. `hit` commits before the send. A failed turn burns the slot, and the hint or
ask is then not sent for that window. Abstract these as a nondeterministic boolean in Quint.

## 23. Suspected defects

Severity is the priority of the rule it breaks. Confidence: high = reproduced or a direct code path.

### D1. A claimed STOP that loses its worker is lost, and the retry is refused (P0, high, probe)
`I:92-93` sweeps to `unresolved`; `I:107` answers `turn_unresolved`, `retryable:false`. `I:122-125` covers an
exception only. Trigger: gateway posts STOP; claim commits; process dies before `S:1323`; gateway retries after 2
min. The retry sweeps the row, conflicts, and gets 409 not retryable. No ledger event exists, no confirmation is
sent, no fence update happens. The person believes they stopped, and proactive sends continue. The same result
comes from a database failure during `rescueCompliance`: I:123 swallows it, I:126 throws out of the catch, and the
row stays `processing`.
Probe E: a claimed STOP row with an old lease, then the same request: `409 {error:"turn_unresolved",retryable:false}`
and `lastConsent = {}`. Crash after `S:1323` is the milder form: ledger out, no projections, no mirror.

### D2. A late START from a non-member echoes opted_in while the ledger says opted_out (P0, high, probe)
`S:1132-1137`. The member path has the guard at S:1107; this path does not. Trigger: STOP at t, then a START
with `receivedAt` before t. Probe D: `consent:{state:"opted_in",scope:"app",app:"ntwrk"}` and
`optedIn("ntwrk") = false`. The gateway copies the consent into its fence. The effect on the fence depends on
upstream ordering by `at` (**unverified**). The same turn also runs the join flow and asks to join.

### D3. A stated minor age kept only in pending can be replaced by a higher age (P0, high, probe)
`S:1416-1434`. `recordAge` runs only in the failure branch and the commit branch. `need_name` stores the age in
pending only. `said.age ?? p.age` lets a new age replace it, and `joinAgeCheck` compares only to the floor. The
invalid-home branch (S:1426) drops the age too. Breaks AGENTS decision 1 ("the lowest age ever stated or recorded
wins"); `A:4-6` states the same rule. Probe A: `friends.help`, `15`, `Sam, 25` gives `joined`, `people.lowest_age=25`,
`members.age=25`, floor 25. On slop this person is an adult for photos and matching.

### D4. The looking-for answer bypasses age and safety reading (P0, high, probe)
`S:1115-1117` returns `enroll` before `memberMessage`. `enroll` stores the inbound row but never calls
`n.onInbound` or `statedAge`. Probe F: an adult record, text `friends and dating, I'm 16 actually`: enrolled in slop,
`lowestAge = 30`. Also a block, report or abuse in that text is not read.

### D5. After STOP, a signed turn sends the notice and the join question (P0, high for the service, probe)
`S:1140-1148`, `S:1367-1372`, `S:1175-1197`. `direct()` in a turn collects with no consent check. `elizaNotice` has no
consent or suppression check. The comment at S:1143 ("refused at send time") holds only for the legacy path. Probe
B: STOP, then `hi there` gives replies `[ELIZA_NOTICE, join ask, stopped hint]`, ids `[notice, sys, sys]` (the same
id twice), `replyKind:"reply"`, reason `join_asked`. The contract says "Send exactly these". Whether the gateway
fence filters them is **unverified**. The notice has kind `compliance`, which a fence is likely to pass. The join ask
repeats up to 3 times a day. Same path for a suppressed number.

### D6. The enroll confirmation is not collected, and the response names the wrong app (P1, high, probe)
`S:747-750` overwrites `turn.app` and `turn.memberId` for each `createMember`, also from `enroll`. `R:289` and
`R:263` then fail the causal check for the ntwrk member. Probe C: response `replies:[]`, `app:"slop"`, and the text
`Done: you're in friends.help and slop.date` goes to the queue as kind `reply`. It still sends, but later and
outside the turn's reply set, and `inbound.app_id/member_id`, `accountEligible` and the engagement call use the
last enrolled app. When every wanted app already exists, no `createMember` runs and the reply is collected, so
both behaviours exist.

### D7. An enroll that joins nothing is silent and consumes the question (P1, high, probe)
`S:1481`, `1496`, `1499`. Probe G: a 15-year-old answers `dating`: `replies:[]`, pending gone. The same for a
banned person. The person gets no answer and cannot answer again.

### D8. An older STOP after a newer START stops the person with no guard (P1, medium, trace)
`S:1317-1344` has no check like S:1107. Ledger: app opted_in newer than global. Result: `turn.consent` opted_out,
memberships paused on every app, `members.opted_out=true`, ledger resolved `opted_in`. Direction is safe for sends,
but the projections disagree and `resolveConsent` will not refuse a send the member flag refuses. Fix is a
product decision: STOP may be meant to win always.

### D9. Leave is not atomic, and its retry can fall into the join flow (P0, medium, trace)
`A:421-429`, `S:1081-1094`. If `forgetMembership` fails after the forget unit committed: `turn.consent` is unset
(S:1090 not reached), no reply, so `rescueCompliance` releases the row with `turn_failed`. The retry finds `lid`
undefined, skips the leave block, and goes to the join path. The ledger is out, but the gateway gets no consent, the
person gets a join prompt, and the membership stays `active` with no member. With a crash instead, the row is
unresolved, with the same leftovers.

### D10. A text join can replace a live membership with a new member id (P1, medium, trace)
`S:1391-1392`, `1441-1446`, `PS:124-129` (upsert on app and person). `A.joinLocked` guards this at A:357; `S.join` does
not. The non-member decision (S:1099) is outside the join lock. Trigger: web join in flight for phone P; text
turn passes S:1099; web join commits; the text takes the lock, sees `existing.state='active'`, and with age and name
writes a new `memberId`. Result: two `network.members` rows for one person, and `memberships.member_id` names the
empty one. Also breaks a `review` value, since it writes `review:null`.

### D11. A partial text join has no repair (P1, high, trace)
`S:1435-1452`. Separate commits. After a crash the signed retry is refused. Membership `active` without a member
makes `memberApps` empty while `activeMembership` passes. The person is asked again, and any data in pending is gone.

### D12. Stated ages live in process memory across a commit (P0, high, trace)
`R:138-149`, `S:1122-1123`. The unit commits, then `statedAge` runs. A crash between loses the person-level update
for good: a signed retry is refused, and a legacy retry returns `duplicate` before `statedAge` output changes
anything (the queue is gone). `m.statedAge` survives in that app's Network state, so that one app knows and the other
apps do not. Breaks "a minor anywhere is a minor everywhere" in a crash window. `S:1452` has no `statedAge` call at all.

### D13. A context change between two reads fails the first response (P2, medium, trace)
`S:2090` then `S:2102`. The turn is `done`, the 409 is not retryable, and the person gets no reply. A window edge
(`stateUntil`) or a concurrent facet write triggers it.

### D14. STOP is blocked by a running or dead turn (P0 liveness, high, trace)
`I:96`: `status='processing'` applies to keyword turns too. The comments at I:19 and I:84 claim otherwise. A dead
turn delays STOP up to 2 min and needs a gateway retry (409 `turn_busy`, retryable). A gateway that gives up loses
the STOP (**unverified**). The unique index forces this design: fixing it needs a second claim slot for compliance.

### D15. Leave does not use the turn's event time (P2, high, trace)
`A:425` uses now with no ref. `S:1090` reports `at: t`. The README ("Consent order") says leave uses `receivedAt`. A
late leave wins over a newer START. A failed then retried leave writes two events.

### D16. A non-member "leave <app>" starts a join (P2, high, probe)
`S:1081-1094` falls through. Probe H: `leave slop.date` from a stranger gives notice, join ask, and a pending row.
`isComplianceText` is true, so the turn also skips the sender hold.

### D17. A legacy STOP can be dropped after 5 failures (P1, high, trace; legacy path only)
`I:269-273` marks any row `failed`, a STOP too, within about 5 ticks of a database problem. Not live in production.

### D18. Photo-by-text is unreachable in production (P2, high, trace)
`S:2069` `mediaUrls: []`. `S:1071-1076`, `photoIntake.ts` run only from the legacy webhook. In the legacy path
`YES PHOTOS` needs `route.app==='slop'`, and `route()` has no such branch, so a multi-app member's answer can go to
another app. The ask is `direct`, so it is not in `last_out`.

### D19. A number with a floor under 13 still gets the join question (P2, high, trace)
`S:1406-1414`: with no age in the text, `join()` does not read the floor. `elizaNotice` checks it (S:1185), `join` does
not. Pending is written and the ask is collected. The test `an under-13 first contact...` asserts only the reason.

### D20. Text joins are serialized per process (P2, high, trace)
`PS:250-254` `lockTail` is one chain for all keys, and it holds through `memberMessage`. The contract budget is 8 s.
A slow unit delays every join in the process, also web joins. Not a state bug. Note it for capacity.

### D21. STOP from a held number reaches only the ledger (P1, high, trace)
`S:1320-1342`. `rt.memberOf` and `personFor` are undefined under hold. After staff `same_owner`, `memberships.state`
is still `active`, `opted_out` false, open items were not dropped. Sends stay refused by the ledger, and
`activeMembership` closes. Projections stay wrong until the next STOP.

### D22. Some non-member replies can never get an accepted receipt (P1, high, probe)
`S:2028-2033`. Only compliance-only sets or `onboarding_asked` are account-free. D5's reply set, D19's ask,
`invite_only` and `join_asked` with a known age fail. Probe B: accepted with `historyRecorded:false` gives
`400 invalid_receipt`, not retryable. The row stays with no receipt, so `collected` stays (D23).

### D23. No sweeper for collected rows with no receipt (P2, medium, trace)
A search of `outbound-queue.ts` finds `collected` written at 690 and read only by `collectedReceipt`. A gateway crash
before the receipt leaves `network.messages` and `platform.outbound` at `collected` for good, outside the leak guard's
accepted thread history.

### D24. Unresolved rows keep collected reply text (P2, high, trace)
`I:126` nulls `event` and `sender`, not `replies`. `I:198` seals only `done`. Text stays up to 37 days unless the
member is forgotten. The test `a committed collection...` asserts `row.replies.length > 0`, so it is known; the
retention is the question.

### D25. Collected replies skip the service's live flags (P2, high, trace)
`BlooioAdapter.enqueue` applies `live` (channel.ts:217-221), and `writeUnit` removes collected sends first (R:397).
`direct()` in a turn collects before `adapter.direct` can refuse (S:1369-1371). So `*_LIVE_APPROVED` does not gate a
turn's replies; only the gateway does. This is likely intended, because Cloud owns delivery. Record it in the model.

### D28. SHARE can go to the wrong app (P2, medium, trace)
`S:1113` needs `route.app` to be the offering app; `route()` has no pending-share branch. An open item on another app
takes the word.

### D29. START after a global STOP can resume a different app than the STOP text named (P2, medium, trace)
`apps.ts` `stop` copy names the routed app. STOP's inbound row clears only that app's `last_item`; the next START
routes to another app with an open item (S:974-975). `S:1105` is app-scoped. Other apps stay out, which is safe, but
the person is told a different app is back, or the one they meant stays stopped.

### Dead or unreachable, no defect
`unknown_sender` cannot occur on a signed turn: S:2052 requires a normalized phone. `ignored_group`, `status`,
`reaction`, `safety` are legacy only. `duplicate` in a signed turn occurs only on a compliance retry or after a legacy
delivery of the same id.

## 24. Suggested Quint plan

1. **`consent_turn.qnt` (P0).** Merge `signed-turn`, `consent-ledger`, `gateway-consent-mirror`,
   `opt-out-projection`, `leave-flow`, `recycled-hold`. One phone, two apps, 3 to 4 messages, free `receivedAt`.
   Step actions per commit point; `crash`; `retry`. Must find D1, D2, D8, D9, D14, D21.
2. **`join_age.qnt` (P0).** Merge `text-join`, `age-floor`, `looking-for-enroll`, `eliza-notice`. One phone, ages
   {12, 15, 25}, 2 apps. A history variable `everStated`. Must find D3, D4, D5, D7, D10, D11, D12, D19.
3. **`receipts.qnt` (P1).** `turn-receipt`, `action-receipt`. Must find D22, D23.
4. **Small models (P1, P2).** `routing` pure def, `member-onboarding`, `route-authority-window`,
   `participation-window`, `legacy-inbox-row`.

Keep the time domain as an integer tick of 30 s, with lease 4, block 20, pending TTL 2880. Use a coarse tick for the
join model. Abstract `people.hit` as a nondeterministic boolean. Treat the Network unit as an atomic step that sets
`optedOut` and drops items; the opportunity machines belong to another scope.

Open questions for upstream or the founder:
- Does the gateway fence filter collected replies by `replyKind`, or per reply? D5 depends on it.
- Does an `opted_in` with `scope:"app"` clear a `scope:"all"` fence, and does the fence order by `at`? D2.
- How many retries does the gateway make on 409 `turn_busy`? D14.
- May STOP always win over a newer START? D8.
- Should `eliza_notices` survive a delete of everything?
