# Wave 3 sweep: SQL state columns, constraints, triggers and indexes against the Quint models

Branch claude/quint-state-machines (HEAD f02196f). Read-only. Hand-written. No test was run and no database was queried.
Inputs: catalog section 2 and 6.18 of docs/research/2026-11-07-state-machines.md, docs/research/state-machines/sql-schema.md
(the wave-1 catalogue of every CHECK, partial index and trigger up to 0041), gap-status-columns.md, the 17 models in quint/,
docs/research/quint-findings/*.md, and the drift review on claude/formal-main (docs/results/2026-11-09-quint-drift.md,
quint/drift.json). Not re-reported: the auth_edge rotation race and the invite_only under-13 exit (fixed on formal-main).

## 1. Method

1. Listed every table, index and trigger in packages/observatory/db/schema.sql, the 37 migrations, packages/notify/db/{schema,retention}.sql,
   packages/mcp/db/oauth.sql and packages/network/db/network-state.sql (60 tables).
2. The wave-1 catalogue (sql-schema.md sections 1.1-1.5) covers everything to 0041. I read 0042-0057 in full (the wave-2 fix
   migrations) and checked each new column against the model that the migration names.
3. For each state column, flag or timestamp lifecycle, unique/partial index and trigger, I grepped the 17 models for its
   table, column and concept names, then read the model or the findings file when a hit was ambiguous.
4. For each column with no model, I read its writers and its send-time readers.

## 2. Coverage result per table (only rows that are not plainly covered)

| Table.column / object | Owner in catalog | In a model? | Result |
|---|---|---|---|
| network.members.participation_state + participation_window (0023:3) | M-111 participation-window -> turn_consent | NO (turn_consent.md:78 "SD-217 not modelled (participation window)") | new module or turn_consent extension (section 3.1); a send-time defect (section 4.1) |
| platform.inbound.action_receipts for /internal/set-state, /signals, /updates | M-125 action-receipt -> relay | Only the /internal/relay copy (relay.qnt:13,81) | model gap (3.2) |
| platform.inbound.network_authority (0036) + NETWORK_ROUTE_AUTHORITY_POLICY | M-106 route-authority -> turn_consent | NO (turn_consent.qnt has no authority/admit/drain); profile_learning.qnt only has `checkAuthority` as an abort | model gap (3.3) |
| platform.pending_texts kind='share' + platform.share_grants | M-213 share-offer, M-224 share-grant (6.18: P2, left out) | NO | still left out; a behaviour defect (4.3) |
| platform.rate_limits (hitAll: fixed window, minGap, keep_until) as 9 buckets | split over M-057, M-007, M-014 | partly: auth_edge (OTP start, verify "not modelled"), turn_consent (stop_hint keep_until), join_age (join_ask) | new small module optional (3.4); one defect on the legacy path (4.2) |
| oauth.rate_limits, oauth.audit, notify.task_tokens | M-210, M-209, M-185 (P2 left out) | NO | unchanged, still P2 |
| platform.outbound.kind 'safety' (0049:43) | M-028 | NO: outbound_queue.qnt KINDS has no safety (open drift on formal-main) | model gap (3.5) |
| platform.person_holds (0049) | M-051 | yes, safety_trust.qnt; liftHold row deletes are open drift on formal-main | model gap (3.6) |
| platform.outbound.network_id (0045) | M-028 | yes (outbound_queue.qnt:113 twoNets, SD-132) | covered |
| network.messages_outbound_status repair (0045) | M-119 | partly (open drift Q-outbound_queue-4) | see 3.5 |
| platform.inbound.compliance, lease_at; rate_limits.keep_until; consent_events.named_app (0042) | M-001/M-007/M-003 | yes, turn_consent.qnt | covered |
| platform.eliza_notices.turn_id; age CHECK >= 0 (0043) | M-112, M-016 | yes, join_age.qnt | covered |
| member_apps() legacy filter; forget_profile_suggestions() (0044, 0052) | M-108, M-076 | yes, identity_sagas.qnt, profile_learning.qnt | covered |
| network.ops_alerts.last_failed_at (0054) | M-150 | yes (runtime_ops.qnt lastFailed) | covered |
| network.capital_events.seq; notify.forget_data keep rule (0057) | M-181, M-171 | yes, notify_capital.qnt | covered |
| network.relay_threads, relay_records.review | M-047 | yes, relay.qnt (thread, held) | covered |
| platform.photo_relay_requests/items | M-050 | relay.qnt Photo; photo_relay_item.qnt on formal-main | covered |
| network.cost_ledger (0020) | none | no | not a machine: append-only telemetry, `record` ids are random (cost.ts:130), budgets only alert (cost.ts:246-258). No transition to check. |
| platform.settings.environment + *_synthetic triggers (0003:222-240, 0015:100-111) | none | outbound_queue.qnt models 555 numbers; boot_config.qnt (formal-main) models PLATFORM_ENV | static guard; not a machine |
| service.ts:296 notifyTargets (in-memory address -> member map, never evicted) | none | no | low value: the enqueue runs a unit of work whose send checks re-read consent and opt-out (service.ts:714-722) |

## 3. Uncovered machines and model gaps

### 3.1 NEW MACHINE `participation-window` (P1) - extend turn_consent.qnt or new `participation.qnt`

State: network.members.participation_state (CHECK open|normal|quiet|receiving|paused, schema.sql:20-21) and
participation_window jsonb {state: open|busy|traveling|paused, from, until, note} (0023:3). The effective state is a
function of both, the opt-out flag and the clock: packages/network/service/snapshot.ts:20-33 `effectiveParticipation`
(opted_out -> paused; an active window: open -> normal, paused -> paused, busy|traveling -> quiet; else the stored state).

States (abstract): base in {normal, quiet, paused} (open and receiving have no production writer) x window in
{none, future, active, ended} x windowState in {open, busy, traveling, paused} x optedOut.

Transitions (all file:line in packages/network/service/service.ts unless named):
- setState (agent, POST /internal/set-state; 2178-2195): an unscheduled request (no from/until/note, not traveling)
  rewrites the base and clears the window; a scheduled one keeps the base and stores the window. `unchanged` writes
  no row and no event (AGENTS.md contract: "unchanged=true writes no event"). Refused when until <= now (2145).
- endPause (START by text; 975-987): clears a paused window and a paused base; a busy or traveling window stays.
- resumeMember (site settings; 960-973): clears any window and a paused base (route has no caller after the founder
  correction of 2026-10-19).
- forget (leave/delete; runtime.ts:590): window null.
- clock: a window becomes active at from and ends at until; nothing deletes the ended window.
- STOP: opted_out=true makes the effective state paused (snapshot.ts:32).

Readers: snapshot member state (snapshot.ts:117) -> engine budgets (packages/network/src/outreach.ts:19,97: paused
n=0; engine attention.ts:114,477,587); Network send gates `overBudget` and `unsolicitedRefusal`
(packages/network/src/network.ts:4273-4278, 4455-4459); the open-turn context (runtime.ts:788-815).

Rules that should hold:
- R1 (PRD 7.2, outreach.ts:97-104): a member whose effective state is paused gets no proactive or unsolicited text.
  This must hold at the send, not only at the decision (see defect 4.1).
- R2: START ends an agent pause, never a busy or traveling window (comment at 975-978).
- R3: setState unchanged=true writes no member row and no event; every change writes exactly one
  `member_state_requested` event.
- R4: effective state is paused whenever opted_out (snapshot.ts:32), whatever the window says.
- R5: a forgotten member keeps no window (runtime.ts:590).
- Liveness: an ended window reads as no window (memberParticipation comment, 940-941).

Why Quint has value: four writers (agent, text START, site, forget) plus the clock plus the opt-out interleave with the
outbound queue, which holds rows across those changes. A model with `setState(req)`, `start`, `forget`, `tick`, and
the queue's `enqueue`/`drain` (reuse outbound_queue's row abstraction with a recipient check) finds 4.1 in a few steps.
The JSON validation (snapshot.ts:25-29) is an oracle, not a state. Best home: a new small `participation.qnt` that
imports the outbound row shape, or an extension of turn_consent.qnt (which already owns STOP/START and the catalog row).

### 3.2 MODEL GAP `shared-action-receipt` (P2) - extend relay.qnt (it owns M-125)

relay.qnt models the per-request receipt (absent -> processing -> completed | unresolved) only for /internal/relay
(relay-endpoint.ts:175-261). The same JSON receipt in platform.inbound.action_receipts serves /internal/set-state,
/internal/signals and /internal/updates: service.ts:2095-2216.
- claim tx (2137-2150): reject a different request hash (action_conflict), replay completed, refuse processing or
  unresolved (action_unresolved, not retryable), cap 16 receipts per turn, set processing.
- effect tx: the effect and `complete` (2152-2158) commit together, guarded by state='processing' and the hash.
- error: mark unresolved (2213-2216). A RouteAuthorityExpiredError returns before that and leaves `processing`.
Gaps: (a) a crash between the claim commit and the effect transaction leaves `processing` with no sweep: the request
can never complete and the member's pause or signal is lost (fail-closed, liveness only); (b) the receipt is bound to a
`done` open turn whose sender and membership are re-checked under row locks (2126-2135): this authority re-check is
not in any model. Rules: at most one effect per (turn, path, key); a replay returns the first response; an effect
never lands after the membership ended (`authorized()` inside the lock). Quint value: moderate; the relay receipt
code is already modelled, so a parameter `path` on the existing actions is enough.

### 3.3 MODEL GAP `route-authority` window (P2, staging only) - extend turn_consent.qnt or profile_learning.qnt

packages/network/service/route-authority.ts:10-34, inbox.ts:84-110 (claims refused at or after admitUntil),
service.ts:2239-2245 (only /internal/turn after admitUntil), 2415, 2443, profile-review-factory.ts:36-60,
learning-consent-context-endpoint.ts:32,84, 0036 (network_authority column). States: no policy (production: any
envelope is refused, `routeEnvelopeAllowed` returns value===undefined) | admitting (now < admitUntil) | draining
(admitUntil <= now < drainUntil) | closed. Rules: an envelope of another authority is never processed; no new claim
or proof after admitUntil; every proof expires by admitUntil; production never accepts an envelope.
Observation: inbox.ts:93 refuses a STOP claim after admitUntil as well, so on an isolated staging route a STOP sent
in the drain phase gets no consent change from this backend (staging only, no production effect). The catalog puts
M-106 in turn_consent but the model has no state for it. Quint value: low to moderate (time guards; one interleaving
with the STOP claim).

### 3.4 NEW MACHINE (optional) `rate-window` (P2) - new `rate_window.qnt`, or fold the verify limits into auth_edge

platform.rate_limits (bucket, window_start, count, last_at, keep_until) through PeopleStore.hitAll
(packages/platform/src/pg-store.ts:264-292) and purge (pg-store.ts:336). One primitive, nine live buckets:
otp ip/phone/phone_day/global (otp.ts:172-179), otp verify ip/phone (otp.ts:205-206), phone-change
(accounts.ts:238), stop_hint (service.ts:1322), invite_only (service.ts:1582), join_ask (service.ts:1606),
photo_msg (service.ts:1208), and the photo "once a day" texts (photoIntake.ts:136-141). oauth.rate_limits
(packages/mcp/src/pg-store.ts:222-238) is a second copy with a sliding reset (M-210, left out).
Rules: a refused hitAll counts in no bucket (otp.ts:171 comment; pg-store.ts:279 returns before the writes); a
minimum gap outlives the purge (keep_until, SD-004); parallel hits serialize by an advisory lock in name order.
Models today: auth_edge (start only; verify limits documented as not modelled), turn_consent (stop_hint), join_age
(join_ask). Value: low as a module; the useful part is the photo_msg misuse (4.2), which is a use of the table as an
idempotency marker, not a rate limit.

### 3.5 MODEL GAP outbound_queue.qnt: kind 'safety' and admission branches (P1, input from formal-main drift)

0049:41-43 widened the CHECK to kind 'safety' (a hold notice: consent and the leak guard apply; quiet hours, the
unanswered streak and line caps do not; it may go to a held member: network.ts:4478-4479 `kind !== "safety"`).
outbound_queue.qnt has no such kind, and the drift review lists it plus the admission branches
(packages/blooio/src/outbound-queue.ts:538-554) and Q-outbound_queue-3/-4 as open. The participation rule R1 (3.1)
belongs in the same `recipient` check of the model.

### 3.6 MODEL GAP safety_trust.qnt: person_holds lift and the '*' row (P1, input from formal-main drift)

platform.person_holds (0049:10-16; only a staff lift deletes a row). liftHold (service.ts:1736-1760) needs
cross-app safety for an '*' row and writes per-app rows for the other live apps before it deletes '*'. The drift
review lists "service liftHold deletes this app's ..." as stale model. No new finding here beyond the drift item.

## 4. Suspected defects

### 4.1 A paused member still receives a proactive row that was queued before the pause (P1 by PRD 7.2)

The Network refuses a proactive or unsolicited send to a paused member when it decides the send (network.ts:4129
overBudget with OUTREACH.budget.paused n=0; 4277 PRD_BUDGETS). A row that is already in platform.outbound is checked
again at drain only by the queue's recipient check: channel.ts:189-190 -> network.ts:4471-4494 `checkRecipient`.
That check reads optedOut, account, trust hold, onlyWhenAsked, minors and blocks, but not the participation state.
`syncRecord` (network.ts:4667-4685) copies a paused state into memory but returns true only for a minor or an
account status, so `syncMember` does not drop a paused member from open opportunities either.
`stale` (channel.ts:184-185) checks only a closed opportunity. set-state writes network.members only
(service.ts:2192), not network_state, so the queue fence `stateCurrent` (runtime.ts:683-687) does not see it.
Trigger:
1. A proactive row for member M is enqueued at 20:55 local and the queue defers it (deferred_quiet_hours,
   outbound-queue.ts:455), or it waits as held_awaiting_reply (provider conversation limit).
2. M tells the agent "pause me for a week": POST /internal/set-state {state:"paused", until:+7d} commits
   (service.ts:2178-2195); effective state is paused.
3. Next morning the drain runs: optedOut false (no STOP), recipient check ok (no participation test), the row is sent.
Expected: refused (suppressed_ineligible "paused"). Fix direction: `checkRecipient` refuses proactive and
unsolicited kinds when the synced state is paused (keep replies, compliance and safety). Test: an integration case in
packages/network/test/ that queues a deferred proactive row, posts set-state paused, then drains.

### 4.2 The photo retry marker is committed before the photo work (P2; legacy webhook path)

service.ts:1206-1210: `people.hit("photo_msg:<rowId>")` commits in its own transaction (pg-store.ts:267-292) before
`photosIn`. A legacy inbound row is retried by the drain up to 5 times on a throw (inbox.ts:320-336).
Trigger: a photo-only message on the legacy webhook path; `photos.upload` throws (R2 error) on attempt 1; attempt 2
reads count 2, takes outcome "duplicate", and returns "handled" because the text is empty (service.ts:1210). The photo
is never stored and the member gets no answer. On the signed path a throw makes the turn unresolved (not retryable),
so the marker does not change the outcome there. turn_consent.qnt:731 says the legacy path is not live in
production, so P2. Fix direction: write the marker in the same transaction as the stored photo, or key it by the
photo object.

### 4.3 SHARE says the basics are reused, but no code reads a share grant (P2, behaviour; founder or maintainer)

Copy (packages/network/src/copy.ts:163-164): "Reply SHARE to reuse your first name, city and interests here" and
"Done. I'll reuse those basics here." The SHARE answer (service.ts:1709-1722) writes platform.share_grants through
Accounts.share (accounts.ts:526-535). The only reader of share_grants is Accounts.revokeShare (accounts.ts:516-523);
the function comment says "a grant copies nothing". Leave revokes grants (pg-store.ts:348) and delete removes them
(pg-store.ts:381), so the lifecycle is consistent, but the grant never changes what the new app knows.
Trigger: a slop member joins friends by text -> link notice + pending share (service.ts:1660-1663) -> "SHARE" ->
grant row, "Done. I'll reuse those basics here." -> the friends member still has no city or interests from slop.
This is not a safety defect (nothing leaks). The choice (implement the copy, or drop SHARE) is a scope decision.

## 5. Not new (checked and already in the register or the drift list)

- facets.status 'proposed' with no exit (GS-1), intents 'paused' unwritten, apps.status dead, memberships.review dead
  (SS-12, SD-373), suppression.reason ignored, photos.deleted_at no writer, opportunities.source 'reviewer' unwritten:
  wave-1 register.
- Queue status writes with no guard (SS-17 / Q-outbound_queue-3), message status repair reads waiting statuses only
  (Q-outbound_queue-4), START opt-in before the membership resumes (turn_consent drift), ban grant revocation without
  an oauth.audit row (oauth_mcp drift), banned person's photos after leave (photos_rating drift): formal-main drift list.
