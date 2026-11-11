# Sweep: packages/observatory (wave 3)

Branch read: claude/quint-state-machines (read-only). Inputs: catalog section 2 and 6.18 of
docs/research/2026-11-07-state-machines.md, docs/research/state-machines/observatory.md and
gap-console-client.md, quint/staff_console.qnt (+ quint/runtime_ops.qnt for M-144), the findings file
docs/research/quint-findings/staff_console.md, and the drift review on claude/formal-main
(docs/results/2026-11-09-quint-drift.md, quint/drift.json).

Coverage note. claude/formal-main has four more console models that are NOT on this branch:
`observatory_sync` (client-sync, delta-store, filters, reveal badge), `console_views` (useLive, photo gate,
drawer tab, Search, propose tray), `review_desk` (review queue selection, keys, decide in flight, the
two-press matching switch) and `console_privacy` (viewClass, shapeDelta, cross-app person view). They model
LemmaScript cores (web/logic/*.ts, src/privacy-core.ts) that this branch does not have. On this branch those
machines are uncovered; after the merge they count as covered. I do not report them as new machines.

Hand-written: this file. No model was changed. No quint run was needed: each gap below is a missing
state variable or action in staff_console.qnt or runtime_ops.qnt, found by reading (grep of the model for
lens, seed, AccessVerifier, cert, lastRead, migration ledger states returns nothing).

## 1. New machines (no model has their states)

### N1. access-key-cache: Cloudflare Access signing-key cache (P1)
Where: packages/observatory/src/staff.ts:261-333 (AccessVerifier.key 278-289, load 292-309, verify 311-333).
Catalog: merged into M-090 staff-identity -> staff_console, but the model has no identity or key state
(`grantsCopy` only).
States: `empty` (fetchedAt = -inf), `fresh` (age <= cacheMs 1 h), `refetching` (shared `loading` promise),
`stale-grace` (refetch failed, keys kept, age <= cacheMs + staleMs 24 h, `staleWarned`), `dead` (refetch failed
past grace, or no keys: every verify fails). Transitions: unknown kid and age > 30 s -> refetch; age > 1 h ->
refetch; refetch ok -> fresh (keys replaced whole, an empty set too); refetch fail -> stale-grace or dead.
Rules: only a verified RS256 JWT gives an identity (staff.ts:10-14, docs/deploy.md 2.6); fail closed.
Properties to check: (a) a token is accepted only with a key the certs endpoint served within
cacheMs + staleMs; (b) a refetch that returns no RSA key ends every sign-in until the next refetch
(fail closed, acceptable); (c) liveness: during an outage every request after the window awaits a new
5 s fetch, because `fetchedAt` is not moved on failure (staff.ts:280-286): availability, not safety.
Proposal: extend staff_console with an `ak` record (keys, fetchedAt, loading, outcome oracle) and the
identity step (verify -> user with expiresAt); join it with the existing socket/expiry actions. Value in
Quint: medium. The time arithmetic is small and the interleaving of a shared refetch with concurrent
verifies is what a sampler finds; the crypto is an oracle.

### N2. read-audit-dedupe (P2)
Where: server.ts:114-116, 397-419 (`lastRead` map, 60 s window, prune at 5000 entries).
States per key (staff, action, app, member, revealed, mode): `none` -> `logged(at)` -> after 60 s `none`.
Rule: every staff read of a member is audited before data returns (staff.ts:15-16, admin-console 3.12);
the dedupe is a documented carve-out (one row per minute per key; a reveal starts a new key).
Proposal: extend staff_console (`inv_readAudited`: each data read has a row with the same key within the
last 60 s). Value: low; it is a one-key timer. Include only if staff_console grows a read-audit invariant.

### N3. migration ledger, full (P1) — the runtime_ops model has only a counter
Where: packages/observatory/db/migrate.ts:26-108. runtime_ops.qnt:537-545 models `migrate` as
"applied + 1 once" and checks `migrationOnce` (runtime_ops.qnt:724). That is the advisory lock only.
Uncovered states per migration id: `absent`, `applied(checksum)`, `changed-skipped` (non-repeatable, text
changed: warning only, migrate.ts:92-95), `rerun` (repeatable, text changed). Order: 0001, 0002, 0003+,
9001, 9002, 9003 (migrate.ts:32-42). A fresh database and an upgraded database run the same files in a
different effective order: on an upgraded database a numbered file runs after 9001-9003 already ran; on a
fresh one it runs before them. Migration 0057 says so and works around it by hand
(0057_notify_capital_state_machines.sql:12-21: "9003 runs after this file there").
Rules: migrate.ts:13-15 ("New changes go in a new numbered file, never in a baseline"); AGENTS.md
(migration runner refuses two NNNN prefixes). Implied rule: a fresh database and an upgraded database
reach the same schema and the same grants (convergence).
Proposal: new module `schema_ledger` (or a sub-record of runtime_ops): objects = {function F, grant G on
table T, view V}; each file is a pure def that sets some objects; repeatable baselines rerun on change;
invariant `converges`: fresh-install state == upgrade state for every reachable edit sequence. Value in
Quint: good. It is a small finite machine and the order bug class (see D2, D5) is exactly what a sampler
finds; SQL text is abstracted to "which objects a file sets".

### N4. seed-writer (P2; catalog M-158 assigns it to staff_console, the model has none of it)
Where: packages/observatory/db/seed.ts:17-50, writer.ts:164-191.
States: `migrated` -> `truncated` (all 15 network tables, every app, restart identity cascade,
writer.ts:173) -> `inserted(app)` -> committed, one transaction. Outside the transaction: platform.*,
notify.*, oauth.*, relay_threads/relay_records, capital_events, staff_audit are not touched.
Rules: runbook-real 3 ("refuses a host that is not local"; `--allow-remote` only when a human asks);
seed.ts:36.
Proposal: no Quint module (dev and staging tool). Record it in 6.18 as P2 with defect D7. Value: low.

### N5. dev-pg cluster lifecycle (P2; in 6.18 as left out)
Where: dev-pg.ts:34-50 (`uninitialised` -> `initdb` -> `stopped` -> `started` -> `db created`),
dev-pg.ts:61-63 (`down`), migrate.ts:84 (`reset`).
Not worth Quint: two shell steps and a check. Defects D8, D9 below instead.

### N6. lab-run queue (P2; in 6.18 as left out)
Where: lab.ts:86-208. Run states `queued -> running -> done|failed`; seeds queue, `active` counter,
per-run save chain, `load()` marks queued/running as failed after a restart (lab.ts:110), `dispose()` empties
the queue but leaves in-memory runs queued (lab.ts:207). Game/dev only (refused with
OBSERVATORY_REAL_ONLY=1, server.ts:749). Keep out of Quint. One small inconsistency: `start()` puts seeds in
the queue (lab.ts:143-144) before `save(run)` (lab.ts:145); a failed save throws to the route (500) after the
"requested" audit row, but `pump()` never runs, so the seeds wait until the next start pumps them, and the
client was told the run failed.

### N7. staff_audit lifecycle / retention (P1 decision, open carve-out)
Where: schema.sql:272-298 (append-only: update, delete and truncate raise), server.ts:404-419, 645
(`reason: v.note` up to 2000 chars), 697 (held decision reason up to 500 chars), 589 (reveal reason),
803 (cross-app open reason); the network service writes the same table (service README line 152).
States of a row: `written` only (no end). No erasure path touches it: `git grep staff_audit` in
packages/platform, packages/notify finds no delete, and the trigger refuses one.
Rules in tension: the founder correction (AGENTS.md) routes deletion requests to help@ntwrk.party and
keeps backend privacy controls; the console keeps only the length of search text "never the text (a name,
a phone, a phrase)" (server.ts:734), so staff free text is known to carry PII; but safety notes and reveal
reasons are stored as written, keyed by member id, forever.
Proposal: not a Quint model until a retention rule exists. Register as an open carve-out next to SD-282
(the same "privacy and data-retention decision" is needed). If a rule is set, extend identity_sagas
(forget fan-out) with a `staffAudit` scope and an invariant "after forget, no row carries the member's
free text".

## 2. Model gaps (covered machines, parts missing)

### G1. staff_console: truth lens (catalog M-157 assigns it to staff_console; not in the model)
Where: server.ts:312-314 (`lensOn` "<staff>|<app>"), 628-630 (on/off, reset clears an app, sockets
re-flagged), 357 (recheck sets `w.truth`), 221 (delta per `cls|truth`), 482, 500, 560.
States: per (staff, app): off | on; the effective view is on only in game mode and while `allowed(safety)`.
Missing invariant: hidden truth reaches only a socket whose owner holds safety/admin for the app now
(rule: CONTROL_ROLES comment server.ts:137-141; AGENTS.md "Network code never reads hidden persona truth" is
satisfied because the lens is game-only). The socket copy `w.truth` is refreshed only by recheck (15 s) or
a lens/reset command; a role taken away between rechecks still gets truth deltas for up to 15 s. The model
already has `Socket.fresh` for this pattern; add `truth` to Socket and `lensOn` to the state.

### G2. staff_console: SSO grants staleness (staff-grants, M-090/M-091)
Where: staff.ts:210-230. A failed `load()` keeps the last good list with no age limit and warns once for
the life of the process (`warned`, staff.ts:213, 225). The model has `reloadRoles(ok)` (staff_console.qnt:169)
but every invariant is over `grantsCopy`, so a revoked grant that keeps working while reads fail is not a
violation in the model. Rule: admin-console 4.4 "a role taken away ends it"; server.ts:15-16 comment.
Missing invariant: `grantsCopy` differs from `grantsDb` for at most K ticks, or the console fails closed
after K failed loads. Also missing: `rolesUrl` is set only when the server starts in real mode
(server.ts:296); a game-mode start that switches to real never reads platform.staff_roles (fail closed for
added grants; harmless), while a real-mode start keeps stored grants in game mode.

### G3. staff_console: reveal is not keyed to the mode of its checks
`inv_commandRunsInSeenMode` (staff_console.qnt:712) covers /api/control, /api/safety, /api/held. The reveal
routes use the live `mode`, not `seen` (server.ts:575, 580, 589-591, 598). See D1. Add `revealPost` to the
`md` interleaving (modeSwitch between the check and the grant).

### G4. staff_console: projector terminal guard is in the model's guards, not in the code
`netBook` is enabled only from stage "review" (staff_console.qnt:500), so `inv_terminalAbsorbing` cannot
fail. The code has no terminal check on three writes: `meeting_scheduled` -> SCHEDULED (projector.ts:163),
`proposal_skipped` -> SKIPPED (projector.ts:249-250), and `review_queued` re-roll replaces participants and
statuses with no state check beyond IN_REVIEW (fine). SD-499 searched seeds 1-6 and did not find the order,
so this is a model fidelity gap (game mode only, P2): let netBook/netSkip fire from any stage and let the
code's own guard decide.

### G5. staff_console: participant-status and review-info projections (M-039 view, catalog 2.14/2.15)
projector.ts:102, 147-151, 169-172, 182-185, 256, 282, 389, 410. The model's `pj` has only opportunity
state. Not modelled: the participant status lattice (pending -> invited -> accepted/declined/countered/
ignored -> confirmed/dropped/expired -> attended/no_show/cancelled_with_notice) and counter updates
(`c.accepts++/--`, `count(o, -1)`). One counter defect seen: `review_invalidated` always does
`count(o, -1)` (projector.ts:331), with no check that the item had been counted or that the record is not a
repeat; two invalidations, or an invalidation of an item that was never approved, push proposal counts below
the truth (game counters, P2, 6.18 left-out family).

### G6. runtime_ops: migration runner (see N3)
`migrationOnce` is the only property. Missing: changed non-repeatable files (warning, skip), repeatable
baseline reruns after numbered files, the reserved 9xxx files that run after the numbered ones, and `reset`
(drops network, platform, notify and the ledger, not oauth; migrate.ts:84).

### G7. Console client machines on this branch (covered on claude/formal-main only)
review queue (web/review.tsx:186-244, web/store.ts:234, 805-822), useLive and Search (panels.tsx, main.tsx),
client sync (web/store.ts), drawer tab. Covered by review_desk, console_views and observatory_sync on
formal-main. Until the merge they are uncovered here. One item for review_desk to confirm: D6.

## 3. Suspected defects

### D1. A PII reveal made in one mode becomes a live reveal in the other mode (P2, CONFIRMED by reading)
Rule: docs/admin-console.md 4.4 line 305: "The reveal covers that member's detail ... in the mode it was
made in." server.ts:369-373: `seen` "is the mode of these checks: an action runs in it".
Code: POST /api/reveal reads `source(mode, app)` (server.ts:580), audits with the default `m = mode` at call
time (server.ts:589, record signature 404), awaits the audit write, then stores the grant under
`revealKey(u, app, memberId)`, which reads `mode` again (server.ts:309, 591).
Trigger: dev or staging console, not real-only, database seeded with `seed.ts --from-sim` (member ids in the
database are the game world's ids, writer.ts rowsFromGame). (1) Safety staff S in game mode posts
/api/reveal for game member m12. (2) While the audit insert is in flight, an admin posts /api/mode {real}
(server.ts:469-477; setMode does not wait for other requests). (3) The grant is stored as `S|real|ntwrk|m12`.
(4) S opens /api/member/m12 in real mode: revealFor finds the grant (server.ts:497), the real member's
facets and timeline go out unscrubbed, and the audit row of the reveal says mode game. Production
(OBSERVATORY_REAL_ONLY=1) cannot switch mode, so it is not reachable there.
Fix direction: use `seen` in revealKey and record for the three reveal routes. Regression: an integration case
in packages/observatory/test (mode-switch.test.ts style) with a slow audit sink.

### D2. A rerun of the baseline schema.sql gives network_observatory SELECT on every network table again (P2, latent)
Code: schema.sql:318 `grant select on all tables in schema network to network_observatory`, then it takes back
only channel_identities, network_state and the console views (schema.sql:319-335). Migration 0007:270
`revoke select on network.capital_events from network_observatory` runs once (numbered). migrate.ts:92 reruns
0001 (schema.sql) whenever its text changes, and the numbered revoke does not run again.
Trigger: any later edit to schema.sql (it is a "repeatable" baseline; migrate.ts:13-15 asks for new numbered
files, but the runner allows it). `bun run db:migrate` on a database that ran 0007 -> network_observatory has
SELECT on capital_events again. Today forced RLS on capital_events has no policy for network_observatory
(0007:264-268), so the grant reads zero rows: mitigated, not exploitable. The class is real: any future
numbered revoke on a table without forced RLS is undone silently by a baseline edit. ops_alerts and
ops_alert_posts (0020) have no RLS and get SELECT through `alter default privileges` (schema.sql:323).
Fix direction: N3 model; or move the take-back list into one numbered "grants" file that reruns, or make
schema.sql never grant on "all tables".

### D3. 9003_notify_retention is non-repeatable and lives outside migrations/: an edit is skipped with a warning only (P2, CONFIRMED by reading)
Code: migrate.ts:41 (`repeatable: false`), migrate.ts:92-95 (changed text -> warning, skip). History:
packages/notify/db/retention.sql changed in 3657c40 (guard_surface_member: invited memberships keep
signals) with no numbered migration; a database that ran 9003 from 492c4b3 (same day) keeps the old trigger.
SD-341 needed a hand-written copy in 0057 with a `to_regprocedure` branch. Trigger: edit retention.sql
(the file a developer naturally edits), run db:migrate on staging: log line "warning: 9003_notify_retention
changed after it ran", schema unchanged, CI green. Low likelihood of harm today (both changes were caught),
but the runner gives no failure. Fix direction: refuse (exit 1) on a changed non-repeatable file, as the
NNNN duplicate check does.

### D4. dev-pg `reset` leaves the oauth schema (P2, dev only)
migrate.ts:84 drops network, platform, notify and the ledger, not oauth; 9001 then reruns on the old oauth
tables (create if not exists). Old grants and tokens survive a reset and point at person ids that no longer
exist. Harmless for ids (new UUIDs), but a test or a developer that counts oauth rows after `reset` sees
stale rows. Fix: add `drop schema if exists oauth cascade` to reset.

### D5. Fresh install and upgrade run files in a different order (P2, design hazard)
Covered by N3. 0057's comment shows the authors handle it by hand per file; nothing checks it.

### D6. Review queue: the move after a decision uses the render from the key press (P2, PLAUSIBLE)
web/review.tsx:203-218: `afterDecision` and `pending`/`sel` are read from `live.current` at key time; the
`.then(ok => afterDecision())` runs after the decision returns. Trigger: reviewer presses "a" on item A
(index i), then "k" to read item Z (index i-1) before the answer lands; the answer lands and afterDecision
selects pending[i+1] (from the old list), so the card on screen jumps from Z to B. A next "a" approves B, a
card the reviewer did not read. Every approval still passes server review rules, so no member is contacted
without a human approval, but the human approval is of the wrong card. review_desk on formal-main models
`moveOnAfter`; check that its trace covers a selection change while a decision is in flight.

### D7. seed.ts truncates every app's network rows but keeps platform and relay rows (P2, staging only)
writer.ts:173 truncates the 15 network tables for all apps; platform.memberships, notify.*, oauth.*,
relay_threads, relay_records, capital_events stay. With `--allow-remote` on staging, memberships then point at
member ids that either no longer exist or (after `--from-sim`) name a different, synthetic member with the
same id. A running platform:dev service holding the old network_state in memory can also write it back after
the truncate. Fix direction: refuse when platform.memberships has rows, or truncate by app.

### D8. Concurrent devPgUp calls race (P2, dev only)
dev-pg.ts:40-47: two processes (AGENTS.md: several sessions share this machine; sim blocks and
deploy/backend/*.integration.test.ts call devPgUp) both see "not ready" and both run `pg_ctl start` (the second
fails: "pg_ctl start failed"), or both see no `network` database and the second `create database` fails with
"already exists". Fix: retry pg_isready after a failed start; catch duplicate_database (42P04).

### D9. AccessVerifier refetches on every request during a certs outage (P2, availability)
staff.ts:280-286: `fetchedAt` stays old after a failed refetch, so each verify after the window starts a new
fetch (deduped only while one is in flight) and waits up to 5 s. During a Cloudflare certs outage every staff
request is 5 s slower; with an unknown kid it fails after the wait. Safety is not affected (fail closed past
grace). Fix: keep a `lastAttempt` and back off.

## 4. Checked, not defects
- ws-ticket: one use, app-bound, 30 s (server.ts:484-492, 819-825): modelled (`issueTicket`, `openSocket`).
- Two-phase staff audit (requested row first, result best effort): modelled (`inv_consoleAuditFirst`).
- PgAudit app column cache resets on error and falls back to detail.app (staff.ts:385-399); list coalesces.
- FileAudit append chain is serial; a bad line is skipped on read (staff.ts:353-369).
- held photo preview: modelled (`pv`), SD-287 fixed.
- RealSource login check runs once per connection; a later role change on the login is not re-checked
  (real.ts:221-245). Not a defect against a stated rule; note for real-source if the model grows.
- deployGuard leaves OBSERVATORY_AUDIT_DATABASE_URL out of `databaseUrls` (server.ts:280-283): a remote audit
  sink alone does not require PLATFORM_ENV. The audit login only inserts; no data is read from it. Not a defect.
- Expired reveal grants and unused tickets stay in memory until the next lookup or ticket issue
  (server.ts:423, 488): bounded by staff activity, no rule broken.
- SKILL.md conversation protocols: none in packages/observatory.
