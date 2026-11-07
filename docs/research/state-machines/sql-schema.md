# SQL schema state machines

Key: `sql-schema`. Date: 2026-11-07. Branch: `claude/quint-state-machines` at a0ed7bc.

## 0. Scope and method

Scope: `packages/observatory/db/schema.sql`, every file in `packages/observatory/db/migrations/`,
`packages/network/db/network-state.sql`, `packages/mcp/db/oauth.sql`, `packages/notify/db/schema.sql` and
`packages/notify/db/retention.sql`, and the TypeScript that writes those tables.

Applied order (`packages/observatory/db/migrate.ts:26-44`): 0001 `schema.sql`, 0002 `network-state.sql`, 0003 to 0041,
9001 `oauth.sql`, 9002 notify `schema.sql`, 9003 `retention.sql`. All of it runs in one transaction under one advisory lock.

Method:

- I read every SQL file in full.
- I read these writers in full: `packages/platform/src/pg-store.ts`, `packages/platform/src/accounts.ts`,
  `packages/platform/src/photo-relay.ts`, `packages/mcp/src/pg-store.ts`, `packages/notify/src/pg-store.ts`,
  `packages/network/src/store.ts`, `packages/blooio/src/outbound-queue.ts`, `packages/network/service/inbox.ts`,
  `packages/network/service/runtime.ts`, `packages/network/service/channel.ts`.
- I read these in part (the SQL and the state-changing lines): `packages/network/service/service.ts`,
  `packages/network/service/profile-suggestions.ts`, `packages/network/service/relay-endpoint.ts`,
  `packages/network/service/cost.ts`, `packages/network/service/postings.ts`, `packages/platform/src/photos.ts`,
  `packages/network/src/network.ts`, `packages/network/src/relay.ts`, `packages/mcp/src/handler.ts`, `packages/mcp/src/tools.ts`,
  `deploy/backend/ops.ts`, `packages/observatory/db/writer.ts`.
- The per-module logic of OTP, sessions, OAuth flows and the Notify scheduler belongs to other research keys. This file
  covers their storage contract only.
- I ran the real migrations on a throwaway Postgres 16 cluster (port 54397, in the session scratchpad, removed after use) and
  tested some claims with SQL. These claims are marked **[SQL-tested]**. I did not use the shared dev Postgres (54339).
  No external service was called. No file was changed except this report.

The migrated database has 86 CHECK constraints in the four schemas (count from `pg_constraint` on the scratch database).

Severity words: P0 is safety-critical (minors, consent, STOP, review gate, leak guard, bans, auth). P1 is money, data integrity
or delivery. P2 is everything else.

## 1. Catalogue

### 1.1 CHECK constraints on state columns

| Table.column | Allowed values | Defined at | Writers | Result of the cross-check |
|---|---|---|---|---|
| `network.members.account_status` | invited, onboarding, active, paused, restricted, removed | schema.sql:18-19 | service.ts:730-733 (active), :1757 (restricted), runtime.ts:544 (removed), writer.ts:43,90,98 (seed only) | invited, onboarding and paused are never written in production. Readers still test them. |
| `network.members.participation_state` | open, normal, quiet, receiving, paused | schema.sql:20-21 | service.ts:876, :1946 | Matches `ParticipationState` (core/types.ts:7). |
| `network.channel_identities.channel` | imessage, sms, voice, web, email | schema.sql:39 | writer.ts seed only; runtime.ts:542 deletes | Production never inserts. See SS-03. |
| `network.facets.privacy_scope` | agent_private, matchable, shareable, opportunity_specific | schema.sql:53 | service.ts, postings.ts, profile-suggestions.ts | Matches `PrivacyScope`. |
| `network.facets.provenance` | said, connected_source, inferred, vouched | schema.sql:54 | same | Matches `Provenance`. |
| `network.facets.status` | proposed, confirmed, rejected | schema.sql:57 | proposed and confirmed only | `rejected` has no writer. Readers filter it (snapshot.ts:90-91, service.ts:544,1582). |
| `network.intents.status` | active, paused, closed | schema.sql:73 | postings.ts:29 | `paused` has no writer that I found. |
| `network.presence.type` | home, routine, temporary | schema.sql:82 | service.ts:734 (home) | OK. |
| `network.opportunities.source` | engine, reviewer, member, network, player, scenario | schema.sql:107, network-state.sql:21 | store.ts:95,117 (`SOURCE` map), writer.ts:115 | `reviewer` has no writer. |
| `network.participations.role` | participant, alternate | schema.sql:129, network-state.sql:45 | store.ts:114-115 | OK. |
| `network.review_items.decision` | approve, reject, expired, null | schema.sql:144, network-state.sql:59 | store.ts:124 from network.ts:342,1915-1916,3347 | OK. |
| `network.review_items.reason` | 8 values | schema.sql:145, network-state.sql:60 | store.ts:125 | store.ts drops an unknown reason to null (`REVIEW_REASONS`), so the CHECK cannot fail. The reason is lost without a log line. |
| `network.messages.direction` | inbound, outbound | schema.sql:156 | runtime.ts | OK. `status` has no CHECK (1.2). |
| `network.feedback.sentiment` | positive, neutral, negative | schema.sql:175 | runtime.ts | OK. |
| `network.events.actor_type` | member, agent, engine, reviewer, admin, sim | schema.sql:185 | events.ts:15, service.ts:877,1947,1955 | OK. |
| `network.requests.kind` | people, plans | schema.sql:259, network-state.sql:79 | store.ts:130 | OK. `outcome` has no CHECK. |
| `network.relay_records.kind` | text, contact_share, photo | 0026:29 | store.ts:156 | OK. |
| `network.relay_records.decision` | pass, hold, block | 0026:33 | store.ts:157 | OK. |
| `network.relay_records.review` | held, released, rejected, null | 0026:39 | store.ts:158 | OK. |
| `network.cost_ledger.kind` | llm, photo_rating, otp_verify, blooio_line, sms_fallback, other | 0020:21 | cost.ts:33 | OK. cost.ts:19-20 records the limit. |
| `network.ops_alerts.level` | warn, bad | 0020:33 | ops.ts:260 | OK. `last_sent_level` has no CHECK. |
| `platform.apps.join_mode` | invite, open, waitlist | 0003:25 | no TS writer | `waitlist` is read (accounts.ts:378, service.ts:1444,1488). See SS-12. |
| `platform.apps.status` | dev, staging, live, paused | 0003:26 | no writer | No reader either (service.ts:455 does not select it). `paused` has no effect. |
| `platform.apps.id` | ntwrk, slop, peon, friends | 0007:77 | migration only | OK. |
| `platform.phone_identities.method` | otp_sms, otp_whatsapp, inbound_message, staff | 0003:76 | pg-store.ts:70,348 | `otp_whatsapp` has no writer. |
| `platform.phone_identities.hold` | recycled_number, null | 0006:23 | pg-store.ts:78 | OK. |
| `platform.memberships.state` | invited, onboarding, active, paused, restricted, removed | 0003:88 | pg-store.ts:125,296; accounts.ts:340,378; service.ts:804,1110,1444,1488,1754 | OK. See machine `sql-membership`. |
| `platform.memberships.review` | recycled_number, null | 0003:89 | always null | No writer sets a value (SS-12). Readers test it. |
| `platform.consent_events.state` | opted_in, opted_out | 0003:106 | pg-store.ts:132,351 | OK. |
| `platform.staff_roles.role` | admin, reviewer, safety, analyst, engineer, cross_app_safety | 0003:136 | admin SQL only | Matches `StaffRole` (observatory types.ts:431). |
| `platform.app_lines.provider` / `env` | blooio, twilio / dev, staging, production | 0003:173-174 | no TS writer | Data only. |
| `platform.bans.scope` | phone, person | 0011:15 | pg-store.ts:170 | OK. Also `check (phone_hash is not null or person_id is not null)` (0011:22). |
| `platform.photos.content_type` | jpeg, png, webp | 0011:34 | photos.ts:390 | OK. |
| `platform.pending_texts.kind` | join, looking_for, share, photo_consent | 0014:12 | pg-store.ts:272 | Matches `PendingKind`. |
| `platform.pending_texts.age` | null or 1..129 | 0007:149 | pg-store.ts:272 | `validAge` allows 0. See SS-08. |
| `platform.age_floor.lowest_age` | 1..129 | 0006:19 | pg-store.ts:99 | `validAge` allows 0. See SS-08. **[SQL-tested]** |
| `platform.outbound.kind` | reply, compliance, proactive, transactional | 0015:26 | outbound-queue.ts | OK. `status` has no CHECK. |
| `platform.inbound.status` | pending, done, failed, processing, unresolved | 0021:3 | inbox.ts, runtime.ts:525, pg-store.ts:308 | OK. |
| `platform.phone_changes.new_e164` | NANP regex, stricter than `phone_identities.e164` | 0033:13 | pg-store.ts:333 | `normalizePhone` (phone.ts:14) is the same rule, so no mismatch. |
| `platform.phone_changes` row check | confirmed means new_e164 null and both hashes set | 0033:19 | pg-store.ts:374 | OK. |
| `platform.photo_relay_items.state` | pending, approved, rejected, revoked | 0037:33 | photo-relay.ts:76 | OK. There is no `expired` state. Expiry is a function of `expires_at`. |
| `platform.photo_relay_items` row checks | see machine `sql-photo-relay` | 0037:40-45 | photo-relay.ts:76 | `reviewed_at < expires_at` is a CHECK. A review at the last millisecond fails the transaction, safely. |
| `platform.profile_suggestions.status` | proposed, accepted, rejected, expired, withdrawn | 0039:35 | profile-suggestions.ts | OK. |
| `platform.profile_suggestions` value rule | proposed has a value, all other states have null | 0039:38 | profile-suggestions.ts | All writers set `value=null` with the status. OK. |
| `platform.profile_suggestion_connection_receipts.operation` | disconnect, delete, readback | 0040:6 | profile-suggestions.ts:348 | Matches the parser (profile-review-disconnect.ts:5,23). |
| `oauth.clients.auth_method` / `surface` / `kind` | none, client_secret_basic, client_secret_post / full, openai / dcr, cimd | oauth.sql:11-14 | pg-store.ts:86 | OK. |
| `oauth.auth_requests.step` | phone, code, consent | oauth.sql:30 | pg-store.ts:96,107 | OK. |
| `oauth.tokens.kind` | access, refresh | oauth.sql:94 | pg-store.ts:154 | OK. |
| `oauth.signup_drafts.app_id` | ntwrk, friends | oauth.sql:129 | pg-store.ts:53 | The CHECK refuses slop and peon **[SQL-tested]**, but `prepare_signup` is listed only on those two hosts (tools.ts:67) and handler.ts:892 has the same limit. Consistent. |
| `notify.inbox_items.urgency` | urgent, normal, requested | notify schema.sql:16 | pg-store.ts:58 | Matches `Urgency`. |
| `notify.inbox_items.summary` | not blank | notify schema.sql:18 | pg-store.ts:58 | OK. |
| `notify.deliveries.outcome` | acted, ignored, null | notify schema.sql:36 | pg-store.ts:134,146 | OK. |
| `notify.task_tokens.token` | `T-` plus 6 of the alphabet | notify schema.sql:44 | tokens.ts:11-14 | Same alphabet. OK. |

### 1.2 Status-like columns with no CHECK

| Column | Values the code writes | Readers that depend on the words |
|---|---|---|
| `network.opportunities.state` | IN_REVIEW, PROPOSED, SCHEDULED, COMPLETED, CANCELLED, SKIPPED (store.ts:86-94). writer.ts writes observatory states in simulated mode. | real.ts:55-56 (`HELD`), health.ts, projector.ts. 17 of the 23 `OpportunityState` values never reach this column in production. |
| `network.participations.status` | checking, available, unavailable, dropped, attended, confirmed, pending, accepted, declined, alternate (store.ts:98-107,115) | real.ts:287-290. `invited`, `countered`, `ignored`, `expired`, `no_show`, `cancelled_with_notice` are never written by PgStore, so `no_show` cannot show in production: every "yes" of a done opportunity reads `attended`. |
| `network.messages.status` | default `delivered`; plus `collected`, `queued`, `dry_run`, every outbound status, `refused_photo_transport`, `failed_no_address`, `send_unknown`, `refused_gateway` | runtime.ts:630-631,744-751; 0024 partial index |
| `network.requests.outcome` | probing, none, answered, booked, fulfilled | console |
| `platform.outbound.status` | See machine `sql-outbound`: 26 values | outbound-queue.ts:189-195, pg-store.ts:33, 0015:55-58, 0022:4, ops.ts:141 |
| `platform.line_safety.action` | provider text; code tests review, reply_only, pause_new (outbound-queue.ts:407) | An unknown action reads as "no limit". |
| `platform.otp_challenges.provider` | provider name | otp.ts |
| `platform.suppression.reason` | deleted, banned | none: `isSuppressed` ignores it. `on conflict do nothing` keeps the first reason. |
| `oauth.audit.kind` | `AuditKind` | console |
| `notify.task_tokens.redeemed_on`, `notify.inbox_items.seen_on`, `surface_signals.surface` | `Surface` | scheduler |
| `platform.inbound.action_receipts` | JSON map id to `{requestHash, state: processing, completed, unresolved}` | relay-endpoint.ts:187-201,258; service.ts:1901-1969 |

### 1.3 Nullable timestamp and row-presence lifecycles

| Table | Encoding | Meaning |
|---|---|---|
| `platform.people` | `deleted_at` | tombstone; cleared on revive (pg-store.ts:67) |
| `platform.memberships` | `joined_at`, `left_at` | left_at set by forget; a later join overwrites it with null |
| `platform.phone_identities` | `hold`, `hold_at`, row presence | held; a delete of the row ends the identity |
| `platform.share_grants` | `revoked_at` | active while null |
| `platform.otp_challenges` | `consumed_at`, `expires_at`, `attempts` | one-time code |
| `platform.sessions` | `revoked_at`, `expires_at`, `rotated_from` | session |
| `platform.phone_changes` | `confirmed_at`, `new_e164`, hashes | pending or confirmed |
| `platform.photos` | `deleted_at`, row presence | `deleted_at` has no writer: a delete removes the row (photos.ts:400) |
| `platform.outbound` | `lease_owner`, `lease_until`, `sent_at`, `delivered_at`, `read_at`, `ended_at`, `in_doubt` | queue row |
| `platform.inbound` | `handled_at`, `handled_order`, `sender`, `event`, `sender_hash`, `response`, `receipt` | scrub on completion |
| `network.review_items` | `decision`, `decided_at` | waiting while null |
| `oauth.grants` | `revoked_at`, `expires_at` | |
| `oauth.codes` | `used_at`, `expires_at` | |
| `oauth.tokens` | `revoked_at`, `rotated_at`, `expires_at` | |
| `oauth.signup_drafts` | `consumed_at`, `expires_at`, `fields = '{}'` | |
| `notify.inbox_items` | `seen_at`, `notified_at`, `expires_at` | |
| `notify.deliveries` | `outcome`, `outcome_at` | |
| `notify.task_tokens` | `redeemed_at`, `expires_at` | |
| `network.ops_alerts` | `open`, `last_sent_at` | |

### 1.4 Partial and unique indexes that encode a state rule

| Index | Rule | Used by |
|---|---|---|
| `inbound_signed_sender_processing` on `platform.inbound(sender_hash) where status='processing'` (0021:12) | At most one running signed turn per sender. Applies to STOP too. See SS-04. | inbox.ts:94-98 (`on conflict do nothing` with no target) **[SQL-tested]** |
| `consent_events_ref` on `(e164, ref) where ref is not null` (0007:246) | One consent event per message per number | pg-store.ts:134,353 |
| `members_app_person` on `network.members(app_id, person_id) where person_id is not null` (0004:67) | One live member per person per app. Forget clears `person_id`. | service.ts:730 |
| `staff_roles_unique` on `(email, role, coalesce(app_id,'*'))` (0003:141) | One grant per role and scope | admin SQL |
| `platform.memberships` PK `(app_id, person_id)`, `member_id` unique (0003:87,94) | One membership per person per app | pg-store.ts:125 |
| `platform.outbound.provider_message_id` unique (0015:42) | One row per provider id | outbound-queue.ts:547 |
| `platform.photo_relay_items`: `consent_id`, `action_id`, `delivery_intent` unique (0037:27,37,38) | One action and one delivery per selection | photo-relay.ts |
| `notify.inbox_items.dedupe_key` unique (notify schema.sql:11) | One item per person, app, event and subject, forever. See SS-19. | pg-store.ts:60 |
| `review_items_open`, `relay_records_held`, `outbound_due`, `outbound_sending`, `outbound_held`, `outbound_unknown_receipt`, `messages_notification_pending`, `inbox_unseen_idx`, `inbox_pending_idx`, `deliveries_cap_idx`, `deliveries_pending_idx`, `grants_by_phone_key`, `photos_person`, `people_phone_hash` | Index only; no uniqueness | scan helpers. Each predicate lists the words of a status set, so a new status must also change the index. |

### 1.5 Triggers

| Trigger | Table | Effect |
|---|---|---|
| `staff_audit_no_change`, `staff_audit_no_truncate` (schema.sql:295-299) | `network.staff_audit` | Append-only. 0007:52-53 disabled it once for the rename. |
| `audit_no_change`, `audit_no_truncate` (0003:161-166) | `platform.audit` | Append-only. |
| `phone_identities_synthetic`, `consent_events_synthetic`, `app_lines_synthetic` (0003:232-240), `outbound_synthetic` (0015:109-111) | | Refuse 555-01xx numbers when `platform.settings.environment='production'`. Insert only on consent and outbound. |
| `keep_cloud_grant_authority` (oauth.sql:65-75) | `oauth.grants` before update | Cloud grants are immutable except `revoked_at` and a lower `expires_at`. See SS-01. |
| `notify_inbox_live_member` (retention.sql:37) | `notify.inbox_items` before insert | Raises when the person is gone or the app scope is removed. |
| `notify_delivery_live_items`, `notify_token_live_items` (retention.sql:53-56) | before insert | Keeps only the person's existing items, in order. Returns null (no row) when none is left. `recordDelivery` then reads false, the same as a duplicate. |
| `notify_surface_live_member` (retention.sql:75) | `notify.surface_signals` before insert | Silent no-op after erasure. |
| `remove_suggestion_facts` (0039:57) | `profile_suggestion_batches` before delete | Deletes linked facets. |
| `forget_profile_suggestions` (0039:71) | `platform.memberships` after update of state or delete | Deletes the app's batches when the state becomes `removed` or the row goes. |

### 1.6 Foreign keys: cascade and no cascade

Cascade from `network.members (app_id, id)`: facets, intents, presence, edges (both ends), messages, feedback, participations,
channel_identities, profile_suggestion_batches, receipts (0004:80-97, 0007:205, 0039:20, 0040:16). No production code deletes a
`network.members` row: forget is an update to `removed` (runtime.ts:544), and the child rows are deleted by hand first
(runtime.ts:529-542). So these cascades are dead in production.

Cascade from `network.opportunities (app_id, id)`: participations, review_items (0004:96-99). This is live: PgStore deletes gone
opportunities (store.ts:273).

Cascade from `platform.people(id)`: profile_suggestion_batches, receipts (0039:5, 0040:8). Dead: people are tombstoned, never deleted.

No cascade from `platform.people(id)`: phone_identities, memberships, share_grants, person_blocks, sessions, bans, photos,
phone_changes, photo_relay_requests, photo_relay_items, `network.members.person_id`. This is correct for a tombstone model.

`platform.photo_relay_items.photo_id` cascades from `platform.photos` (0037:20): a photo delete removes its relay items.
`platform.profile_suggestions.fact_id` is `on delete set null` (0039:36): an accepted suggestion can lose its fact and stay `accepted`.

Cascade in `oauth`: grants from clients; codes, tokens and signup_drafts from grants (oauth.sql:38,81,95,128).

No foreign key on purpose: `network.relay_threads`, `network.relay_records`, `network.requests.member_id`, `network.bias_reports`,
`network.cost_ledger`, all of `notify.*`, `platform.person_sends.person_id`, `platform.outbound.member_id`.

### 1.7 Row-level security summary **[SQL-tested]**

FORCE RLS: bias_reports, capital_events, channel_identities, cost_ledger, edges, events, facets, feedback, intents, matching_runs,
members, messages, network_state, opportunities, participations, presence, relay_records, relay_threads, requests, review_items.

ENABLE without FORCE: the three `platform.profile_suggestion*` tables (see SS-16).

No RLS: every other `platform` table, `network.staff_audit`, `network.ops_alerts`, `network.ops_alert_posts`, and all of `oauth` and `notify`.

## 2. Writer cross-check: results

**Code writes a state the schema refuses.** One case: stated age 0 (SS-08). I found no other.

**Schema allows a state and no code handles it.**

- `platform.apps.status` (all values; no reader).
- `platform.apps.join_mode = 'waitlist'` gives `platform.memberships.state = 'onboarding'`, which has no exit (SS-12).
- `platform.memberships.review = 'recycled_number'`: no writer (SS-12).
- `network.members.account_status` in invited, onboarding, paused: no production writer.
- `network.facets.status = 'rejected'`, `network.intents.status = 'paused'`, `network.opportunities.source = 'reviewer'`,
  `platform.phone_identities.method = 'otp_whatsapp'`.
- Columns with no writer or no reader: `platform.people.age_verified_at` (only cleared), `platform.phone_identities.line_type`,
  `platform.photos.deleted_at` (read, never set), `platform.networks.run_hour`, `platform.networks.pack_version`,
  `network.participations.enjoyment`, `invited_at`, `responded_at` (PgStore writes null), `network.opportunities.window_start`, `window_end`
  (PgStore writes null), `oauth.signup_drafts.consumed_at` on a successful join (only a discard sets it).

## 3. Machines

Each machine lists: where it lives, states, transitions, invariants, interactions, failure analysis and Quint notes. Actors: M member,
S staff, C cron or tick, W webhook or gateway, P another service, K clock.

### 3.1 `sql-membership`: membership and member pair (explicit, P0)

Lives in two tables that no transaction joins: `platform.memberships.state` (0003:88) and `network.members.account_status`
plus `opted_out` and `person_id` (schema.sql:18-23, 0004:61). There is also a JSON twin in `network.network_state` (`m.optedOut`, `m.account`).

States of the pair (membership / member):

| Name | membership.state | member.account_status | member.person_id |
|---|---|---|---|
| none | no row | no row | - |
| invited | invited | no row | - |
| onboarding | onboarding | no row (service.ts:791 returns early) | - |
| active | active | active | set |
| paused (stopped) | paused | active, opted_out=true | set |
| restricted (banned) | restricted | restricted | set |
| removed | removed | removed | null |
| ZOMBIE (implied, crash) | active | removed | null |
| ORPHAN (implied, crash) | removed | active | set |

Transitions:

| From | Event | Guard | Effects | To | Where | Actor |
|---|---|---|---|---|---|---|
| none, removed | staff or member invite | not held, suppressed or banned | new member id | invited | accounts.ts:335-343 | S, M |
| none, invited, removed | web join | consent wording, not held, not banned, age, invite gate | membership, consent opted_in, `onJoin` | active or onboarding | accounts.ts:351-395 | M |
| none, removed | text join | same, in service | membership, consent, createMember | active or onboarding | service.ts:1437-1447,1488 | M |
| active | STOP | ledger write first | state paused; network unit sets opted_out | paused | service.ts:804,809,1275 | M |
| paused | START | not banned, ledger says opted in | state active; opted_out false | active | service.ts:1110,1276 | M |
| active, paused | ban | staff, not already banned | bans, suppress, drop ratings, both tables restricted | restricted | service.ts:1741-1762 | S |
| any live | leave | | consent opted_out, `onForget` tx, then `forgetMembership` tx | removed | accounts.ts:421-429 | M, W |
| any live | delete everything | | floor, `onForget` per app, then `deleteAll` tx (row deleted) | none | accounts.ts:432-444 | M |
| any live | hold decided new_owner | staff | same as delete, hash detached | none | accounts.ts:194-213 | S |
| any | join hook throws | | `forgetMembership`, consent opted_out `join_failed` | removed | accounts.ts:389-392 | - |

Invariants:

- INV-M1 (AGENTS "Age"): a member under 18 is never matched. `network.members.age` follows `people.lowest_age` by `onAgeLowered`, in a later transaction. `platform.matching_ages` (0038) closes the gap at read time.
- INV-M2 (founder 2026-10-09.3): a banned number or person has no live membership, and `restricted` has no exit except leave or delete.
- INV-M3: membership.state = removed if and only if member.account_status = removed, outside a running unit. **This is not atomic. See SS-05.**
- INV-M4: at most one member per (app, person) with person_id set (`members_app_person`).
- INV-M5: `opted_out` and the ledger agree at send time. The queue reads both (outbound-queue.ts:376,488).

Interactions: consent ledger, phone hold, Notify `forget_data`, profile suggestions trigger, OAuth forget listeners, outbound `dropped_forgotten`, relay.

Concurrency and failure:

- `join` runs under a session advisory lock per phone (`withLock`), plus a process-wide promise chain (pg-store.ts:249-254).
- `leave`: the consent event, the network forget and `forgetMembership` are three transactions. A crash between the second and the third gives ZOMBIE (SS-05).
- `deleteAll`: the same, with the floor note first.
- A STOP has the same split: the ledger write, then `putMembership` per app, then a unit per app. The ledger commits first, and the queue reads the ledger, so a crash is safe for sends.
- Ban: nine non-atomic steps, audited after. `network.members.restricted` is written after the membership. The send path reads the ledger (suppression) so it is fail-safe.

Quint: model with `sql-consent` and `sql-phone-hold` as one module. Variables: `membership: (Person, App) -> State`, `member: (Person, App) -> Status`, `crashAfterStep`. Bound 2 people, 2 apps. Check INV-M3 with crash steps as separate actions. Expect a counterexample today.

### 3.2 `sql-consent`: consent ledger (explicit, append-only, P0)

Lives in `platform.consent_events` (0003:100, 0007:244-246), `platform.suppression`, `network.members.opted_out`.

State per (e164, app): the pair of last app event and last global event, reduced by `resolveConsent` (consent.ts:37-43) to `opted_in`, `opted_out` or undefined.

Transitions: STOP (global, app null) consent.ts:95-98; STOP ALL; `leave` (app scope) accounts.ts:425; START (app scope) consent.ts:101; join (app scope, `web_form` or `inbound_message`); `join_failed` (app scope, opted_out); deleteAll (rows deleted, suppression added) pg-store.ts:307,313; movePhone (rows copied, then deleted) pg-store.ts:351-354; clearHold new_owner (suppression removed).

Invariants:

- INV-C1 (PRD 40.3, founder 7): on the shared line STOP stops every app.
- INV-C2: a newer app opt-in beats an older global opt-out; an older one does not.
- INV-C3: a retried message writes one event (`consent_events_ref`).
- INV-C4: `lastConsent` orders by `at`, not by insert order, so a late START does not undo a newer STOP (service.ts:1107).
- INV-C5: after a delete of everything the number is suppressed until a new opt-in.

Failure: `addConsent` is one statement. `unsuppress` during a join runs before the opt-in and in another transaction (accounts.ts:374-384). A crash between them leaves no suppression and no opt-in, which reads as "not opted in": safe. `movePhone` is atomic. `unsuppress(newHash)` runs after it, outside the transaction (accounts.ts:265). See SS-22 for the merge of two ledgers.

Quint: small pure model. Variables: `events: Set[(App|None, State, Time, Ref)]`. Check that `resolveConsent` is monotonic in time and that duplicate delivery and reordering do not change the result.

### 3.3 `sql-phone-hold`: phone identity and recycled-number hold (explicit plus row presence, P0)

Lives in `platform.phone_identities` (`hold`, `hold_at`, `last_seen_at`).

States: absent, live, held. Transitions: absent to live (createPerson pg-store.ts:70, movePhone :348); live to held on a stale `seen` (accounts.ts:181); held to live (same_owner, :199); held to absent (new_owner, :207); live to absent (deleteAll, movePhone :349).

Invariants (accounts.ts:9-10): a held number is nobody's address (`identities()` filter runtime.ts:395, `member_apps` 0007:229, queue binding outbound-queue.ts:481). But `channel_identities` has no hold: a legacy row still maps (SS-03).

Note: `activeMembership` treats a stale number as blocked without writing the hold (accounts.ts:321). Only `seen` writes it. A number that never writes in stays live in the table; every send path that uses `activeMembership` fails closed for it.

Quint: merge with `sql-membership`.

### 3.4 `sql-phone-change`: number change (explicit, P0 via consent and bans)

Lives in `platform.phone_changes` (0033). States: none, pending (`new_e164` set), confirmed (hashes), purged. Pending has a 15 minute logical expiry (accounts.ts:255) and a physical purge after 2 days (pg-store.ts:288, service.ts:572). A newer start replaces the older pending row (pg-store.ts:331).

Transitions:

| From | Event | Guard | Effects | To |
|---|---|---|---|---|
| none | start | fresh login, not held, not banned, rate limit, code sent | row | pending |
| pending | confirm | code ok, new number free, neither number banned | movePhone tx | confirmed |
| pending | K, purge | | delete | none |
| any | deleteAll | | delete (audit row too) | none |

`movePhone` (pg-store.ts:341-379) is one transaction: phone row, consent, `phone_hash`, age floor, sessions, OTP, pending texts, waiting outbound rows, eliza notice, OAuth grants, change row.

It does not touch: `network.channel_identities` (SS-03), `oauth.signup_drafts.phone_key` (SS-13), `oauth.auth_requests.e164`, `platform.line_conversations` (the new number starts a new conversation), `platform.inbound.sender_hash`.

Failure: OTP is consumed at accounts.ts:257 before the transaction. An abort after that needs a new code (SS-01). The in-memory address book is refreshed after the commit by a listener (server.ts:93-95); a throw there is only logged. A send in that gap is caught by the queue binding check (Cloud only).

Quint: action-level model inside `sql-membership`. Invariants: one phone maps to one person; a pending change never moves a banned person; every waiting row to the old number ends or stays fenced.

### 3.5 `sql-person-tombstone`: person, age floor, suppression (implicit, P0)

Lives in `platform.people` (`deleted_at`, `lowest_age`, `phone_hash`), `platform.age_floor`, `platform.suppression`.

States of a person: live, tombstone, tombstone-detached (`phone_hash` null after new_owner). Transitions: createPerson (new, or revive by hash pg-store.ts:67), deleteAll (:319), detachPhoneHash (:53).

Invariants:

- INV-P1 (AGENTS "Age"): the lowest age ever stated wins. `noteAge` and `noteAgeFloor` take `least`. A revive sets `lowest_age = p.lowestAge`, which the caller computed with the floor (accounts.ts:365-371). The floor survives delete. The floor goes only on clearHold new_owner and moves on movePhone.
- INV-P2: blocks survive delete (the tombstone keeps them; a rejoin by the same hash revives the id).
- INV-P3: a ban holds across delete. This needs `phone_hash` or a phone-scoped ban row. Legacy people have neither (SS-07).

Quint: merge with `sql-membership`; add `ageFloor: PhoneHash -> Int`.

### 3.6 `sql-ban`: bans (implicit, append-only, P0)

`platform.bans` (0011). The service login has select and insert only (0011:26-27). There is no un-ban path. States: not banned, banned. `isBanned` reads phone hash, or person scope by id (pg-store.ts:173-176). A phone-scope row with a person id does not ban the person by id; it bans the hash. The ban flow writes a row per hash (service.ts:1743-1752).

Invariant (founder 2026-10-09.3): a banned number is refused at join (web, text, MCP), OTP and inbound.

Quint: part of `sql-membership`. One variable.

### 3.7 `sql-outbound`: outbound queue row (implicit, status has no CHECK, P0 and P1)

Lives in `platform.outbound` (0015, 0022, 0032, 0037). Twin status in `network.messages.status`. The lifecycle also uses `lease_until`, `in_doubt`, `sent_at`, `ended_at`, `person_cap`.

States (26): waiting: `pending`, `retry_scheduled`, `deferred_quiet_hours`, `held_awaiting_reply`. In call: `sending`. Unknown: `unknown_acceptance`. Accepted: `accepted`, `sent`. Final delivered: `delivered`, `read`. Refused: `refused_not_approved`, `refused_opted_out`, `refused_person_cap`, `refused_gateway`. Suppressed: `suppressed_ineligible`. Parked: `parked_leak_review`, `parked_invalid_timezone`, `parked_error`. Ended: `expired`, `failed`, `failed_unknown`, `blocked`, `dropped_forgotten`, `dropped_leak_review`. Collected path: `collected`, `send_unknown`.

Transitions:

| From | Event | Guard | To | Where | Actor |
|---|---|---|---|---|---|
| - | enqueue in the unit transaction | valid zone | pending | outbound-queue.ts:237-243 | system |
| - | enqueue | agent-initiated, no zone | parked_invalid_timezone | :237 | system |
| - | collected reply | Cloud sends it | collected | :684-692 | W |
| collected, send_unknown | turn receipt | accepted / unknown / rejected | sent / send_unknown / refused_gateway | :696-703 | P |
| due | too old or stale | | expired | :371 | C |
| due | live flags off | | refused_not_approved | :373 | C |
| due | opted out | not compliance | refused_opted_out | :376 | C |
| due | recipient refused | not compliance | suppressed_ineligible | :379 | C |
| due | reply without inbound in the last hour | | suppressed_ineligible | :387 | C |
| due | quiet hours | agent-initiated | deferred_quiet_hours | :394 | C |
| due | streak at cap | | held_awaiting_reply | :401 | C |
| due | line safety or caps | | retry_scheduled | :409,418-420 | C |
| due | person cap refuses | proactive | refused_person_cap | :424 | C |
| due | leak guard | not released | parked_leak_review | :432 | C |
| due | admission fails | | dropped_forgotten, suppressed_ineligible, refused_opted_out | :467-503 | C |
| due | claimed | status unchanged, no lease, immutable payload | sending | :492-495 | C |
| sending | provider accepted | row still sending | accepted, sent, delivered, read, failed | :538-573 | P |
| sending | unknown | | unknown_acceptance | :514 | P |
| sending | retryable, attempts left | | retry_scheduled | :518 | P |
| sending | retryable, attempts used | | failed | :516 | P |
| sending | await recipient | | held_awaiting_reply | :521 | P |
| sending | blocked | | blocked | :524 | P |
| sending | other | | failed | :527 | P |
| sending | lease over | | unknown_acceptance (receipt) or retry_scheduled | :272-279 | C |
| unknown_acceptance | receipt found | | accepted etc. | :596 | C |
| unknown_acceptance | not_found | | retry_scheduled | :598-602 | C |
| unknown_acceptance | older than 6 h | | failed_unknown | :584-589 | K |
| held_awaiting_reply | member wrote | | pending | :642 | W |
| held_awaiting_reply | too old | | expired | :319-329 | K |
| accepted, sent | receipt | rank goes up | sent, delivered, read | :622-631 | W |
| accepted, sent | receipt failed | | failed | :617-620 | W |
| parked_leak_review | staff release | body and address kept | pending | :728 | S |
| parked_leak_review | staff drop | | dropped_leak_review | :724 | S |
| waiting | number moved | | suppressed_ineligible | pg-store.ts:365 | M |
| WAITING_STATUSES | member forgotten | | dropped_forgotten | runtime.ts:548 | M |

Terminal with no exit: all of refused, suppressed, expired, failed, failed_unknown, blocked, dropped, delivered, read. `parked_invalid_timezone` and `parked_error` have no exit path in code: `parkedLeaks` and `decideLeak` handle only `parked_leak_review`. They are alert-only ends.

Invariants:

- INV-O1 (AGENTS): every outbound passes the leak guard. A released row skips it for that text (`leak_released_by`). Collected replies pass `collectedLeaks` (runtime.ts:473-477).
- INV-O2: a provider call only runs from `sending` with a lease.
- INV-O3: STOP while waiting wins: the ledger is read at dispatch and again in the admission transaction.
- INV-O4: statuses never go back. **`end()` and `wait()` update by id with no status guard** (SS-17).
- INV-O5: a row to a non-member keeps its address and text only until it ends. **`accepted` does not end on the Cloud path** (SS-10).
- INV-O6: the person cap slot is released if the row did not go out (`NOT_SENT`, :195). `failed_unknown` may have gone out (SS-18).

Interactions: `person_sends` (slot), `line_conversations` (streak; updated in the `acceptReceipt` transaction), `line_safety`, `network.messages` (mirror, later transaction), Notify projection, relay admission, photo relay.

Concurrency and failure:

- Enqueue is in the unit transaction.
- Drain holds a session advisory lock per line. Claim is a conditional update, so two workers cannot both claim.
- The provider call is outside any transaction. A crash leaves `sending` with a lease. Recovery gives `unknown_acceptance` (Cloud) or `retry_scheduled` (Blooio, same key).
- `capTake` then `update person_cap=true` are two statements. A crash between them leaks a slot until the window ends.
- `network.messages.status` is written after the drain by `storeStatuses`. A crash leaves it behind; `projectNotifications` repairs accepted rows only.
- Clock skew: `lease_until < now` uses the app clock on each worker. A worker with a fast clock can recover a live lease. The Cloud path then enters receipt lookup; the Blooio path resends with the same key.

Quint: its own module. Variables: `status`, `lease`, `attempts`, `personCapHeld`, `providerSeen`, `optedOut`, `addressBound`. Actions as listed. Bounds: 1 row or 2, 2 workers, 6 attempts reduced to 2. Invariants: provider sees at most one logical send per id; no send after a committed STOP that the admission transaction saw; no resurrection from a terminal state (expect a counterexample from SS-17).

### 3.8 `sql-inbound`: inbound row and signed turn (explicit CHECK, P0)

Lives in `platform.inbound` (0015, 0021, 0023, 0036).

States: pending, processing, done, failed, unresolved, unresolved-sealed (`sender_hash` null), deleted.

Transitions:

| From | Event | Guard | To | Where |
|---|---|---|---|---|
| - | webhook | new id | pending | inbox.ts:179 |
| pending | handled | | done | :263 |
| pending | handler fails | attempts below 5 | pending | :275 |
| pending | handler fails | attempts 5 | failed | :270 |
| pending | STOP handled | received before STOP, not compliance | done, `cancelled_by_stop` | :236 |
| - | signed turn | lock taken, no running turn, no pending or recent unresolved unless keyword | processing | :86-98 |
| processing | completed | row still processing | done | :117 |
| processing | throw, keyword, consent or reply committed | | done, `compliance_partial` | :144-163 |
| processing | throw, keyword, nothing committed | | deleted (retry allowed) | :149 |
| processing | throw | | unresolved | :126 |
| processing | lease over, seen by a later turn | | unresolved | :92 |
| processing, unresolved | staff resolve | | unresolved-sealed | :212 |
| done (signed) | K, 7 days | | unresolved-sealed | :198 |
| done, unresolved (signed) | member forgotten or deleted | | unresolved-sealed | runtime.ts:525, pg-store.ts:308 |
| done, failed (unsigned) | K, 7 days | | deleted | :201 |
| unresolved (signed) | K, 37 days | | deleted | :203 |

Lease: `arrived_at` is overloaded. It is the arrival time, and a running turn renews it (`:112`). All time rules use it.

The stale sweep is lazy: it runs only inside the next signed turn of the same sender (:92). `handleWaiting` treats a stale processing row as not blocking (:255-257), but does not write the status. A crashed turn with no later message stays `processing` forever. Nothing purges it: `purge` never selects `processing`.

Invariants:

- INV-I1: at most one running turn per sender (partial unique index).
- INV-I2: replay of a done turn returns the same response.
- INV-I3 (inbox.ts:19): STOP, START and HELP are never held back. **Not true while a turn is `processing`** (SS-04).
- INV-I4: a handled row keeps no sender or event.
- INV-I5: only one system answers STOP (AGENTS consent path).

Concurrency: the claim runs in one transaction with `pg_try_advisory_xact_lock`. Effects commit in later transactions, and the completion is a conditional update. A staff resolve or a sweep during a run makes the worker log an alert and return `turn_unresolved` after its effects committed (:119). `deleteAll` in `pg-store.ts:308` seals every signed row of the sender, without the `id<>turn` guard that runtime.ts:528 has. It only runs from the API (api.ts:634), so this is a race, not a flow.

Quint: merge with `sql-consent` for STOP. Variables: `row: Id -> {status, leaseAt, hash}`, `workerAlive`. Check INV-I1, and a liveness property "a STOP from a sender is answered within lease + retry" under gateway retries.

### 3.9 `sql-person-cap`: person cap (implicit, P0 by PRD 40.3)

Lives in `platform.person_sends` (0007:156), `platform.person_cap_take` (0007:168), `person_cap_release` (0012), `platform.outbound.person_cap`.

States per message id: no slot, slot held, slot released. Take runs under one global advisory transaction lock. Rolling window `since = now - DAY`, cap 3 (service.ts:597). A redelivered id is never counted twice (0007:179).

Invariant (AGENTS decision 7): at most 3 proactive messages a day across apps per person, checked at send time. **A member with no `person_id` is not capped** (SS-06).

Quint: small. Merge with `sql-outbound`.

### 3.10 `sql-message-projection`: message status and Notify projection (implicit, P1)

`network.messages.status` plus `notification_recorded_at` (0024). Marker states: null, set. `projectNotifications` (runtime.ts:621-647) selects rows with an accepted outbound or a confirmed collected reply, calls `delivered`, then sets the marker. The two steps are not atomic, but Notify's dedupe key makes a repeat safe. A permanent error from the Notify trigger (`Notify membership is unavailable`) repeats on every drain, because the row stays selected and only a log line records it. The join filter `account_status<>'removed'` removes the common case.

Quint: not needed alone.

### 3.11 `sql-opportunity-projection`: console rows from the state JSON (explicit, P1)

`network.opportunities.state`, `network.participations.status`, `network.review_items`, `network.requests`. The owner is the JSON in `network.network_state`. `Opp.stage`: review, probing, scheduled, done, closed (network.ts:338). The SQL is a one-way projection, written in the same transaction as the JSON (store.ts:263-304). The review gate state machine is the JSON one; a separate key covers it.

Invariants: `review_items.decision is null` while `state='IN_REVIEW'`. Every row the JSON drops is deleted. `on conflict (id)` on a global primary key (SS-11).

`on conflict` for opportunities updates only state, objective, explanations, meeting_at, reason, updated_at. `score`, `category`, `generator`, `exploration`, `run_id`, `kind`, `source` stay from the first insert, by design.

Concurrency: session advisory lock per network on a reserved connection, and the work runs on other connections. `save` has no version check (SS-20).

Quint: model the JSON machine, not this projection. Add one invariant that the projection is a function of the JSON.

### 3.12 `sql-relay-record`: relay log and staff review (explicit, P0)

`network.relay_records` (0026, 0031), `network.relay_threads`. Owner: `state.relay` JSON. Decision: pass, hold, block. Review: null, held, released, rejected.

Transitions (relay.ts): item gets pass, hold or block (:233). A hold that is only the rate limit keeps review null (:238). Other holds: review held (:239). Release: held to released, and the record becomes pass if an item was delivered (:361-364). Reject: rejected (:372). Forget: rejected by `system:forget` (:399). A refused send: pass to block (:253). A decided held entry is pruned after 30 days (:406).

Relation to the queue: `relayAdmission` requires `decision='pass'` and `review<>'rejected'` for this recipient (runtime.ts:252-253). Rows are written in the same transaction as the queued row.

`relayRows` writes log entries from the last 2 days or with a held entry. A staff decision on a held item whose log entry rotated out (5000 entries, relay.ts:43,329) does not reach the row (SS-21).

Primary key `(app_id, item_id)` has no `network_id`; `on conflict ... where network_id = ...` skips a row of another network without an error.

Quint: merge with the relay key's JSON machine.

### 3.13 `sql-photo-relay`: selected photo item (explicit, P0)

`platform.photo_relay_items`, `platform.photo_relay_requests` (0037).

States: pending, approved, rejected, revoked, plus implied expired (`expires_at <= now`, TTL 15 minutes). Sub-state: `action_id` (claimed), `delivery_intent` plus `delivery_expires_at` (issued).

Transitions (photo-relay.ts): select gives pending (:125-128, idempotent by request id). Review safe: pending to approved (:147-150). Review unsafe: pending to rejected, approved to revoked (:150). Revoke by the owner: any to revoked (:139; a rejected item becomes revoked too). `claimForAction` sets `action_id` once (:190-191). `issueDelivery` sets the intent once (:207).

Row checks: approved needs a review id, time and reviewer (0037:42). `reviewed_at` is in [consented_at, expires_at) (0037:43). Delivery expiry is at most the item expiry (0037:41). Sender and recipient differ (0037:44-45).

Invariants (AGENTS decision 9): per-item consent; adults only; no bytes or URL stored. Every read re-runs `current()`. Row lock `for update` on every transition.

Expired rows stay forever in `pending` or `approved` (no purge) until the photo is deleted (cascade). SS-15.

Quint: own small module, bound 1 item, 2 reviewers. Check that delivery is impossible unless state = approved, now < expires, and action and intent are bound.

### 3.14 `sql-photo`: stored photo (implicit, P0 by age)

`platform.photos` (0011). States: absent, stored. `deleted_at` is unused. A delete removes the bytes first, then the row (photos.ts:386-400). `deleteFor` runs on forget and when a person becomes a minor (service.ts:760,779).

Quint: not needed alone.

### 3.15 `sql-profile-suggestion`: source suggestions (explicit, P0 consent)

`platform.profile_suggestion_batches` (revision counter, `expires_at`), `platform.profile_suggestions` (status), `platform.profile_suggestion_connection_receipts`, `platform.inbound.action_receipts`.

States: proposed, accepted, rejected, expired, withdrawn, deleted.

Transitions (profile-suggestions.ts line numbers): propose to proposed (:182-184). Accept: accepted plus a facet (:241-243). Reject: rejected (:246). Expire: on read (:107), on decide (:209), by tick (:453-457). Disconnect or withdraw: withdrawn, unless accepted and `retain_on_disconnect` (:277-279, :329-332, :421-425). Delete operation: row deleted with its fact (:331, :422). Batch delete: `remove_suggestion_facts` removes linked facts (0039:51-58). Leave or delete: `forget_profile_suggestions` (0039:61-72).

Invariants: pending suggestions are never matching inputs (only `network.facets` is read). `value` is null outside proposed. Decisions use a revision check: stale previews are refused. All transitions hold `for update` on the person first (:81).

Interactions: the trigger fires only on `platform.memberships`, so the member-side forget (runtime.ts:538) deletes the facets first, and `fact_id` becomes null by the FK; a batch then remains until `forgetMembership`.

Quint: own module with `revision`; merge with the review key if one exists.

### 3.16 `sql-oauth`: auth request, code, token, grant, draft (explicit and implicit, P0 auth)

`oauth.auth_requests.step`: phone to code to consent to deleted (`takeConsentRequest` is a delete with a guard, pg-store.ts:110). `updateAuthRequest` is read then write with no guard on the previous step (:103-108). Handler order is the guard.

`oauth.codes`: unused to used by `takeCode`; the caller gets the previous row, so a second use is detected (:145-151).

`oauth.tokens`: live, rotated (`rotated_at`), revoked, expired, swept. `rotateRefresh` runs under a `for update` on the grant (:164-182).

`oauth.grants`: live, revoked, expired, swept after `GRANT_KEEP_MS`. The trigger freezes Cloud grants (oauth.sql:65-75); the CHECK requires authority for the `grant_cloud_` prefix (oauth.sql:61-62). The prefix rule is one way: a plain id with `cloud_authority` set is frozen too, and it has no CHECK.

`oauth.signup_drafts`: absent, live, expired (fields empty after sweep), revoked (fields empty, `consumed_at` null), discarded (`consumed_at` set). One draft per grant for the grant's life: `on conflict do nothing`, and the tool says so (tools.ts:291). `claimSignupDraft` reads and does not consume.

`oauth.audit` is called append-only in a comment (oauth.sql:108) but has no trigger, and the service role has delete (SS-13).

Quint: one module for grant, token, code. Another key owns the flows.

### 3.17 `sql-otp-session-rate`: OTP, session, rate limit (implicit, P0 auth)

`platform.otp_challenges`: attempts counted by a conditional update (pg-store.ts:204-208), consumed once (:209-212). `platform.sessions`: `revokeSession` keeps the earliest time (:222-224), `attachPerson` fills a null person (:225-227). `platform.rate_limits`: fixed window under a per-bucket advisory transaction lock; a refused hit is not counted (:236). `oauth.rate_limits`: one row per bucket, reset by window start (mcp pg-store.ts:192-200). Purge: 2 days (service.ts:572).

Another key owns the logic. Storage notes: all guards are single conditional statements, so they are safe under concurrency.

### 3.18 `sql-notify`: inbox item, delivery, token, surface signal (implicit, P1)

Item: unseen, notified, seen, expired (logical). Delivery: pending, acted, ignored. Token: live, redeemed, expired (logical). `recordDelivery` is one transaction (notify pg-store.ts:104-117).

Invariants: `forget_data` removes items, then rewrites `item_ids`, then removes empty deliveries and tokens (retention.sql:103-115). Triggers stop late producers. Lock order: person, member, Notify records (retention.sql:11-12). `forget_data(person, app)` raises when there is no membership row **[SQL-tested]**; callers guard by state (accounts.ts:426).

No retention job exists for any Notify table (SS-19).

Quint: not a priority. One invariant: no item for an erased scope after `forget_data` commits, with concurrent `addItem`.

### 3.19 `sql-pending-text`: pending text flows (implicit, P1)

`platform.pending_texts` keyed by (phone_hash, kind, app). Non-`share` kinds keep one row per phone and kind (pg-store.ts:271). Purge after 2 days. Cleared on delete and on move.

Quint: not needed.

### 3.20 `sql-ops-alert`, `sql-cost`, `sql-migrations`

`network.ops_alerts`: one row per key, `open` flag, dedupe under an advisory transaction lock (ops.ts:347-370). `network.cost_ledger`: append with `on conflict` for daily accruals. `public.__migrations`: one transaction, one lock; a changed repeatable file runs again, so `schema.sql` regrants `select on all tables` to `network_observatory` on every change. Its end block takes back only the console views. Tables `capital_events` (revoked in 0007:270) get the grant back, but FORCE RLS with no policy for that role hides the rows.

Deploy order note: `oauth.sql` runs at boot only when not deployed (`migrate: !c.deployed`, server.ts:103), and always in the migration list.

## 4. Suspected defects

Each item was checked by reading the code. **[SQL-tested]** means I also ran the statement on a scratch database. Nothing was fixed.

### SS-01. A number change fails for a person with a Cloud grant (P1; confidence high) **[SQL-tested]**

- Where: `packages/platform/src/pg-store.ts:373`, `packages/mcp/db/oauth.sql:65-75`, `packages/platform/src/accounts.ts:257-263`.
- `movePhone` runs `update oauth.grants set phone_key = new where phone_key = old`. The trigger `keep_cloud_grant_authority` raises "Cloud grant authority is immutable" when `phone_key` changes on a `grant_cloud_` row. It also raises for a revoked Cloud grant, until the sweep deletes it.
- Trigger: a member has one Cloud-authorized OAuth grant. They call `POST /api/me/phone/start`, then `/confirm` with a good code. `verify` consumes the OTP (accounts.ts:257). `movePhone` aborts as a whole. The API errors. The change row stays pending. A retry reads `invalid_code` until a new start.
- Safe direction: nothing moves, so nothing leaks. The member cannot change their number. `packages/platform/test/number-change.pg.test.ts` has no OAuth or Cloud case (grep).
- Quint: an action `movePhone` with a precondition `no cloud grant`, and a liveness property "a confirmed change completes".

### SS-02. Delete everything can keep the raw phone number (P1; confidence high)

- Where: `packages/platform/src/pg-store.ts:304-326`, `packages/network/service/runtime.ts:521-551`, `packages/blooio/src/outbound-queue.ts:659-665`.
- `platform.line_conversations.address` holds the E.164. Neither `deleteAll`, `movePhone` nor the forget path touches this table. Only `purge()` deletes, and it requires `unanswered = 0`.
- Trigger: the Network sends a member 2 messages with no reply (`unanswered = 2`). The member deletes everything. The row stays, with no end, because `unanswered` is only reset by an inbound message.
- 0003:71 says the phone lives only in `phone_identities`, `consent_events` and `sessions`. AGENTS keeps the backend privacy controls.

### SS-03. A legacy channel identity keeps the old number bound after a number change (P0; confidence medium; needs legacy rows)

- Where: `packages/platform/src/pg-store.ts:341-379` (no `network.channel_identities`), `packages/network/service/runtime.ts:388-405`, `packages/observatory/db/migrations/0007_friends_platform_safety.sql:229-230`.
- 0006 backfill gives legacy members a person, but keeps their `channel_identities` rows. `identities()` reads both and writes both into `addrToMember` (runtime.ts:399-403). `member_apps` also matches on `channel_identities`, and that branch has no hold filter.
- Trigger: a legacy member with a `channel_identities` row for number A moves to B. `addrToMember[A]` still gives the member. The next owner of A writes in: the message is routed as that member. The same gap applies to a held number: `hold` only filters the platform branch.
- Reach: production inserts no `channel_identities` rows; only data from before the platform has them (writer.ts is the seed). If production has none, this is dead code to remove.

### SS-04. STOP is refused while a signed turn is running or was lost (P0; confidence medium)

- Where: `packages/network/service/inbox.ts:96-98`, `packages/observatory/db/migrations/0021_shared_agent_turns.sql:12`, compare `inbox.ts:19,84`.
- `not exists(... status='processing' or (not keyword and ...))`: the keyword exception does not cover `processing`. The partial unique index also makes a second `processing` row impossible **[SQL-tested]**.
- Trigger A: a slow turn runs (an LLM read, up to its lease), the member texts STOP, and the gateway gets `turn_busy` (409, retryable).
- Trigger B: a worker dies mid-turn. For up to `PROCESSING_LEASE_MS` (2 minutes) every STOP gets `turn_busy`.
- The header says "STOP, START and HELP are never held back (on either path)". The consent change waits for the gateway's retry. I cannot see the gateway's retry policy in this repository. A proactive send can pass in that window.
- Quint: `sql-inbound` with a fairness assumption on gateway retry. State the bound as a property.

### SS-05. Leave and delete are not atomic across the two member tables (P1; confidence high as a crash window)

- Where: `packages/platform/src/accounts.ts:425-428,439-443`.
- Three separate transactions: consent, network forget (`writeUnit`), platform forget.
- Trigger: a crash after `onForget` commits and before `forgetMembership` commits. Result: `network.members` is `removed` with `person_id` null, and `platform.memberships.state` is `active` with the profile and first name kept.
- Then: `joinLocked` sees an existing live membership and returns ok (accounts.ts:357-362), so the person cannot rejoin; no member row exists. `activeMembership` passes. On delete-all the phone, the sessions and the ledger stay too. The person's request looks done to the network and is not. A second `leave` repairs it; nothing does so by itself.

### SS-06. The person cap does not count a member with no person (P0 by PRD 40.3; confidence high; needs legacy rows) **[SQL-tested]**

- Where: `packages/observatory/db/migrations/0007_friends_platform_safety.sql:180-181`.
- `if pid is null then continue`: no row, no refusal. On the scratch database four sends for such a member returned no refused id and wrote no slot.
- Trigger: a legacy member with an Apple ID address (0006 skips those; the comment at 0006:67-68 says so) or the second legacy member of one phone (0006:91). Every proactive send passes the cap.
- The per-recipient and per-line caps still apply.

### SS-07. People from the 0006 backfill have no `phone_hash` (P0 by bans; confidence medium; needs legacy rows)

- Where: `0006_platform_safety.sql:84` (insert with no hash), `0007:250` (the column, with no backfill; SQL cannot compute the keyed hash), `packages/platform/src/pg-store.ts:64-72`. No code sets it later: `createPerson` inserts, the revive path keeps the old value, `movePhone` sets it for a change only.
- Effects: (a) `phoneHashesOf` is empty, so a ban by phone is refused (`no_phone`, service.ts:1741), and a ban by person writes a row with a null `phone_hash`. (b) After that person deletes everything, the phone row goes and `isBanned(hash, null)` finds nothing: the banned number can rejoin. (c) A delete does not revive the tombstone (no hash), so blocks do not carry. (d) `platform.matching_ages` cannot join the age floor; `lowest_age` still applies. (e) `findPhoneByHash` finds nothing, so OAuth reads and `profile-suggestions` joins fail closed.

### SS-08. A stated age of 0 is valid in code and refused by the schema (P2; confidence high) **[SQL-tested]**

- Where: `packages/core/src/policy.ts:15` (`age >= 0`), `0006:19` (`lowest_age > 0`), `0007:149`, `packages/platform/src/accounts.ts:282-286,368`.
- Trigger: `POST /api/join` with `age: 0`. `parseJoin` accepts it. `joinAgeCheck` fails. `recordAge` calls `noteAgeFloor`, and the insert raises a check violation. The API gives a server error, not `under_age`. The floor is not stored, so the same phone can retry with 25.
- This is the one case I found where code writes a value the schema refuses.

### SS-09. `collected` and `send_unknown` have no exit without a gateway receipt (P1; confidence medium)

- Where: `packages/blooio/src/outbound-queue.ts:684-703`, `packages/network/service/service.ts:2037`.
- Only `collectedReceipt` moves these rows. No sweep exists, and neither word is in `WAITING`.
- Trigger: Cloud sends a reply and the receipt to `/internal/turn-receipt` is lost. The row stays `collected`, `sent_at` null, forever. `threadOf` needs `sent_at` (:458), so this text is not in the leak guard's thread history, and a value split across messages is not caught (core-14). The body stays in the row.

### SS-10. A row to a non-member keeps its address and text after a Cloud send (P1 privacy; confidence medium)

- Where: `packages/blooio/src/outbound-queue.ts:32,539-572,629`, `packages/network/service/cloud-channel.ts:54`, `packages/network/service/service.ts:1011`.
- Cloud returns status `queued`, stored as `accepted`. `acceptReceipt` clears nothing. Only `end()` or a final delivery receipt clears `to_address` and `body` of a member-null row. Those receipts come through the Blooio webhook, which the gateway owns in production. `platform.outbound` has no retention at all.
- Trigger: a staff invite or other `direct()` text through Cloud. The number and the text stay in the row. The header promises they stay only until the row ends. Member rows also keep bodies until the member is forgotten.

### SS-11. Opportunity and request ids collide between two networks of one app (P1; confidence medium; latent)

- Where: `packages/network/src/network.ts:891,2100,1607` (`sid` prefixes the app, not the city; `seed` defaults to 1, :575), `packages/network/src/store.ts:290-300`, `schema.sql:103-104,256-257` (global primary keys).
- Trigger: add `ntwrk:sf`. Both networks mint `nw-1-1`. The second save runs `on conflict (id) do update` on the first network's row, and `delete from network.participations where opportunity_id in (...)` removes its participants. A `goneOpps` delete can remove the other network's row.
- Today every app has one city (seed rows in 0003 and 0007), so this cannot fire yet. 0031 says the ids are unique per app; that holds only for one network per app.

### SS-12. `onboarding` has no exit, and several schema states are unreachable (P2; confidence high)

- `platform.memberships.state = 'onboarding'`: reached if a row in `platform.apps` says `waitlist` (service.ts:455-457 reads it). `joined` returns early (service.ts:791), so no member row exists. No code moves it to `active`. The comment says "staff first", but there is no staff path.
- `platform.memberships.review`: every writer sets null. Readers test it in six places.
- The full list is in section 2.

### SS-13. Small OAuth mismatches (P2; confidence high)

- `movePhone` updates `oauth.grants.phone_key` but not `oauth.signup_drafts.phone_key` (pg-store.ts:373). A live draft cannot be claimed after the move (`d.phone_key=` and `g.phone_key=` differ) and a discard misses it. Bounded by the 10 minute draft expiry.
- `oauth.audit` is "Append-only" (oauth.sql:108), but it has no trigger and the service role has delete (oauth.sql:144). `platform.audit` and `network.staff_audit` both enforce it.

### SS-14. The shared console role can read the alert tables (P2; confidence high) **[SQL-tested]**

- Where: `schema.sql:323` (`alter default privileges ... grant select on tables to network_observatory`), `0020:11-14`.
- 0020 says "No console role reads the alert tables". The default privilege gives `network_observatory` select on `network.ops_alerts` and `network.ops_alert_posts`, and they have no RLS. Tested: `has_table_privilege` is true. Per-app roles have no access. 0007:270 revokes the same grant for `capital_events`, so the pattern is known.
- Content: alert text with network ids and counts, not member data.

### SS-15. Ids and a first name outlive a delete (P2; confidence medium)

- `platform.profile_suggestion_connection_receipts`: keeps `person_id`, `user_id`, `organization_id`, `chat_id`, `connection_id`. Insert is the only write. The `on delete cascade` from `platform.people` never fires, because people are tombstoned.
- `platform.photo_relay_items.notice` holds the recipient's first name (`thread.label`, service.ts:443-444, photo-relay.ts:121). Items cascade from the sender's photo only. If the recipient deletes everything, the row stays until the sender deletes that photo. Expired items are never purged.

### SS-16. The suggestion tables have weaker RLS than the others (P2; confidence high)

- Where: `0039:42-47`, `0040:18-20`, compare `0004:135-137`.
- ENABLE, not FORCE. The policies use `network.current_app_id()`, which falls back to `platform.settings.legacy_default_app` ('ntwrk'). Every other table uses `current_setting('app.app_id', true)`, which gives no rows when it is unset.
- Trigger: a `network_service` transaction with no `app.app_id` reads and writes ntwrk suggestions. Code paths I read set the app first, so this is defense in depth only. Deleting the settings row as 0004:9-11 suggests makes these policies raise.

### SS-17. Queue status writes have no guard (P2; confidence medium)

- Where: `packages/blooio/src/outbound-queue.ts:341-344,351`.
- `end()` and `wait()` update by id alone. `drain` reads a snapshot, and `dispatch` then awaits several hooks.
- Trigger: during those awaits a forget sets `dropped_forgotten` with a null address (runtime.ts:548), or `movePhone` sets `suppressed_ineligible`. `dispatch` then hits quiet hours and `wait` writes `deferred_quiet_hours`. The row is back in the due set, with `ended_at` set. The next drain cannot send it: the address is null, and the claim compares `to_address` (:495), so it ends as `dropped_forgotten` or refused.
- No wrong send. This does break "statuses never go back" (:31), and the mirror in `network.messages` flips. It will show up in a Quint model unless the model is told to allow it.

### SS-18. `failed_unknown` gives the cap slot back (P2; confidence high)

- Where: `packages/blooio/src/outbound-queue.ts:195,345,588`.
- `NOT_SENT` matches `failed`, so `failed_unknown` matches. The provider may have accepted the message. A person can get one message above the cap per such row.

### SS-19. Notify tables grow without end, and a dedupe key is permanent (P2; confidence medium)

- Where: `packages/notify/src/pg-store.ts:55-65`, `packages/notify/db/schema.sql:11`.
- No delete exists outside `forget_data`. Expired items, old deliveries and redeemed tokens stay.
- `dedupe_key` is person, app, event, subject. An item that expired unseen blocks a new item for the same subject: `addItem` returns the old row with `created: false`. Whether a re-raise is wanted is a product question.

### SS-20. The network lock has no fencing (P1; confidence low to medium)

- Where: `packages/network/src/store.ts:320-333,288`.
- The advisory lock lives on a reserved connection; `fn`, `load` and `save` use other connections. If the reserved connection drops, Postgres frees the lock and `fn` goes on. A second process can load the same state. `save` overwrites with no version check. Both units' queued rows commit.
- `network_state.version` is the format version, not a revision. I did not reproduce this.

### SS-21. A held relay row can stay `held` (P2; confidence low)

- Where: `packages/network/src/store.ts:153`, `packages/network/src/relay.ts:329,372`.
- `relayRows` maps from `log`. After 5000 newer entries, a held item's log entry is gone. A later staff decision has no record to write, so `network.relay_records.review` stays `held`.

### SS-22. A merged ledger can beat the new number's own STOP (P1 consent; confidence low to medium)

- Where: `packages/platform/src/pg-store.ts:351-354`, `packages/platform/src/consent.ts:37-43`.
- Trigger: number N texts STOP at t1 (global opted_out on N). A member joined on number A at t2 > t1. They move to N. The copied app opt-in has `at = t2`, newer than the STOP, so `resolveConsent` reads opted_in for N.
- The person proved they hold N and asked for the move, so this may be acceptable. The result is that the STOP on N has no effect, and nobody decided that.

### SS-23. A lost turn with no later message stays `processing` forever (P2; confidence high)

- Where: `packages/network/service/inbox.ts:92,198-203`.
- The sweep runs only in the next signed turn of the same sender. `purge` skips `processing`. The row keeps `sender_hash` and collected `replies` text. A later turn repairs it; a member who never writes again leaves it. Delete and forget do seal it (pg-store.ts:308) if `sender_hash` matches.

### Checked and not a defect

- `oauth.signup_drafts.app_id` CHECK versus slop and peon: the tool is host-limited (section 1.1).
- `phone_changes.new_e164` regex versus `phone_identities`: `normalizePhone` applies the stricter rule everywhere.
- Relay log duplicates: `log()` replaces by item id (relay.ts:326-328), so the bulk `on conflict` cannot hit one row twice.
- Grants versus writers: `bias_reports` insert has no `on conflict` (service.ts:548); `photo_relay_requests` and the receipts table use insert only; `capital_events` delete is granted; `platform.bans` uses `do nothing`, which needs no update right.
- `platform_service` cannot update `consent_events`; `movePhone` inserts and deletes, so it works under that rule.

## 5. Quint plan

| Module | Merges | Priority | Why |
|---|---|---|---|
| `membership_lifecycle` | `sql-membership`, `sql-phone-hold`, `sql-phone-change`, `sql-person-tombstone`, `sql-ban` | P0 | Crash steps between the two member tables are the main risk. Should reproduce SS-05 and, with a Cloud grant flag, SS-01. |
| `consent_ledger` | `sql-consent` | P0 | Pure and small. Should reproduce SS-22. |
| `inbound_turn` | `sql-inbound`, a STOP action | P0 | Should reproduce SS-04 and SS-23. |
| `outbound_row` | `sql-outbound`, `sql-person-cap`, a stub of consent and erasure | P0, P1 | The largest machine. Should reproduce SS-17, SS-18, SS-09, SS-06. |
| `photo_relay_item` | `sql-photo-relay` | P0 | Small, with strong row checks. Expect no bug. |
| `profile_suggestion` | `sql-profile-suggestion` | P1 | Revision check and trigger cleanup. |
| `oauth_grant_token` | `sql-oauth` | P0 | Rotation and revocation under a grant lock. |
| `network_lock` | SS-20 | P1 | Two processes, one lock, one lost connection. |

Abstractions for all modules: replace time with a bounded integer and a `tick` action. Replace text with ids. Treat the keyed hash as an injective function. Model each SQL transaction as one atomic action, and each gap between transactions as a point where `crash` may fire. Use 2 people, 2 apps, 2 phones.

Cross-checks for a test harness: the SQL CHECK lists in section 1.1 can be read from `pg_constraint` and compared with the Quint enums, so that the models and the schema do not drift.
