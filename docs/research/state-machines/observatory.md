# State machines in packages/observatory

Scope: staff auth, console actions, review UI backends, read paths, the simulator visualizer server, the seed and migrate runner, dev-pg, and everything in this package that writes state.

Method: I read the source files and tests of the package and followed each write across the process boundary into `packages/network/service`, `packages/network/src`, `packages/platform/src/photo-relay.ts` and `packages/sim/src/world.ts`. I did not run the code. Line references are `file:line` at branch `claude/quint-state-machines` (HEAD a0ed7bc). Relative paths under `src/`, `db/`, `web/` and `test/` are inside `packages/observatory/`.

Confidence words:

- CONFIRMED: I followed the whole path in the code. The failing path exists.
- PLAUSIBLE: the code path exists, but one step depends on data or deployment that I could not check by reading.

Priorities: P0 is safety-critical (minors, consent, STOP, review gate, leak guard, bans, auth). P1 is data integrity, delivery or audit. P2 is everything else.

Coverage limit: `web/graph.ts`, `web/map.ts`, `web/styles.css`, `web/safe.ts`, `web/network.tsx` and large parts of `web/drawer.tsx`, `web/panels.tsx`, `web/main.tsx`, `web/admin.tsx`, `web/review.tsx` and `web/ops.tsx` are rendering code. I searched those files for state and network calls, and read only those parts. Of the tests, I read `staff`, `migrations`, `real-service` and `server` in full, and only selected cases of the rest. The coverage list names only files read in full.

---

## 1. Inventory

| # | id | Kind | Priority | Where the state lives | Model with |
|---|----|------|----------|----------------------|-----------|
| 1 | staff-identity | implicit | P0 | per request: headers; `AccessVerifier` | alone |
| 2 | staff-grants | implicit | P0 | `PgStaffRoles.byEmail`, `platform.staff_roles`, `OBSERVATORY_ROLES` | with 4 |
| 3 | ws-ticket | implicit | P0 | `tickets` map, server.ts:299 | with 4 |
| 4 | ws-socket | implicit | P0 | `sockets` set, `WsData`, server.ts:134,199 | merged 2+3+4 |
| 5 | pii-reveal | implicit | P0 | `reveals` map, server.ts:295 | with 2 |
| 6 | truth-lens | implicit | P1 | `lensOn` set, server.ts:301 | with 4 |
| 7 | staff-audit | implicit | P0 | `network.staff_audit` or `audit.jsonl`, `lastRead` map | wraps 5, 8, 9 |
| 8 | staff-action-relay | implicit | P0 | an in-flight HTTP call; service state | merged with network review |
| 9 | held-text-decision | explicit | P0 | service queues; `photoPreviews`, server.ts:296 | with relay and leak models |
| 10 | real-source | implicit | P0 | `RealSource` fields, real.ts:140-163 | alone |
| 11 | console-age-view | implicit | P0 | `AgeInfo`, `ObsMember.minor` | alone |
| 12 | console-mode | explicit | P1 | `mode` var, `sources`, `starting`, server.ts:189-193 | with 4 |
| 13 | opp-projection | explicit | P1 | `ObsOpportunity.state`, `network.opportunities.state` | alone |
| 14 | participant-status | explicit | P2 | `ObsOpportunity.status[id]` | with 13 |
| 15 | review-info-projection | explicit | P1 | `ObsOpportunity.review`, `network.review_items` | with 13 |
| 16 | safety-case-report-view | explicit | P0 | `ObsSafetyCase.status`, `SafetyReport.status` | with network trust |
| 17 | game-world | implicit | P2 | `ClockInfo`, `GameSource.advancing`, strikes | alone |
| 18 | takeover-prompt | implicit | P2 | `TakeoverAgent.pending` | with 17 |
| 19 | game-counters | implicit | P2 | `sparksUsed`, `strikeIds`, `missions`, `peeks` | with 17 |
| 20 | shadow-run | implicit | P2 | `shadowing`, `shadowIds`, `shadowRuns` | alone |
| 21 | lab-run | explicit | P2 | `LabRun.status`, `runs/lab/*.json`, `queue`, `active` | alone |
| 22 | access-key-cache | implicit | P1 | `AccessVerifier.keys`, `fetchedAt`, `loading` | with 1 |
| 23 | migrate-ledger | implicit | P1 | `public.__migrations`, advisory lock | alone |
| 24 | seed-writer | implicit | P1 | truncate and insert transaction | with 23 |
| 25 | dev-pg | implicit | P2 | `runs/pg`, postmaster, database `network` | no model needed |
| 26 | client-sync | implicit | P2 | `ObsStore.version`, `buffered`, `loadingState`, `wsGen` | with 4 |
| 27 | client-decide-guard | implicit | P2 | `deciding`, `reviewOpened` | with 8 |
| 28 | delta-store | implicit | P2 | `Store` dirty sets, `version` | with 26 |
| 29 | schema-catalogue | explicit | P0-P2 | CHECK constraints in `db/` | owned by other reports |

---

## 2. Machine details

### 2.1 staff-identity (P0, implicit)

**State.** No stored session. Each request gets one result from `authenticateStaff` (staff.ts:145-161) and `identify` (server.ts:323-332).

**States of one request:** `unchecked`, `site_refused` (Host or Origin), `unauthenticated` (401), `no_role` (403 for SSO with no grant), `expired` (401), `authenticated(token)`, `authenticated(sso, exp)`.

| From | Event | Guard | To | Evidence |
|------|-------|-------|----|----------|
| unchecked | any `/api/*` | Host not allowed or foreign Origin | site_refused | server.ts:310-321 |
| unchecked | SSO on, no Access header | | unauthenticated | staff.ts:146 |
| unchecked | SSO on, email header only | no JWT | unauthenticated | staff.ts:150 |
| unchecked | SSO on, JWT present | verify fails | unauthenticated | staff.ts:152-153 |
| unchecked | SSO on | email header differs from JWT | unauthenticated | staff.ts:155 |
| unchecked | SSO on, verified | no grants | no_role | staff.ts:156-157 |
| unchecked | SSO on, verified | grants exist | authenticated(sso, exp) | staff.ts:158 |
| unchecked | SSO off | bearer matches a token (constant time) | authenticated(token) | staff.ts:164-174 |
| authenticated(sso) | `identify` | `expiresAt <= now` | expired | server.ts:328 |

After `identify`, `guard` applies: `rolesFor(u, app, mode)` not empty (server.ts:366), then `allowed(u, need, app, mode)` (server.ts:367), then the mode header (server.ts:369-370). `global` routes apply `allowed` with no app, which means `role@*` (staff.ts:195).

**Start guard.** `deployGuard` (server.ts:168-180) is a boot-time gate. It runs before any source starts. Real data needs `PLATFORM_ENV`. Staging and production need SSO. `dev` with a remote database needs SSO. The URL list is at server.ts:269-271.

**Invariants.**

- S1: no token authenticates while SSO is on (staff.ts:146, test staff.test.ts:415).
- S2: the email comes only from a verified JWT.
- S3: an engineer has no role in real mode (staff.ts:184).
- S4: `cross_app_safety` is never a per-app role (staff.ts:38,184).
- S5: `allowed` for an app passes only `admin` for that app or a listed role.

**Failure analysis.** No writes, no transaction. The skew in `verify` (60 s after `exp`, staff.ts:327) is dead at HTTP level, because `identify` refuses at `exp` (server.ts:328). This is harmless, but the two rules differ. A Quint model must use the stricter one for HTTP and note that a socket opened with a header uses the same `identify`.

**Quint notes.** Small pure model: variables `ssoOn`, `headers`, `tokenValid`, `grants`. Check S1-S5 as state invariants over a nondeterministic request action. Merge with 2.4 for time.

### 2.2 staff-grants (P0, implicit)

**State.** `grants(email) = OBSERVATORY_ROLES ∪ platform.staff_roles` (staff.ts:131-135). The table copy lives in `PgStaffRoles.byEmail`.

**States of the copy:** `empty` (start, or no table), `loaded(list)`, `stale(list)` (the last read failed; the last good list stays).

| From | Event | Trigger | Effect | To | Evidence |
|------|-------|---------|--------|----|----------|
| empty | `start()` | boot | load | loaded or empty | staff.ts:215 |
| loaded | timer, 60 s | clock | replace whole map | loaded | staff.ts:216-223 |
| loaded | read fails | clock | keep list, warn once | stale | staff.ts:224-226 |
| stale | read succeeds | clock | replace | loaded | staff.ts:223 |

`rolesUrl` is set only when SSO is on and the server starts real-only or in real mode (server.ts:284). A game server that switches to real mode never reads the table.

**Invariants.** G1: a revoked grant stops working within `reloadEvery + socketCheck` (60 s + 15 s) unless the read fails. G2: a row with an unknown role gives no grant (staff.ts:221). G3: a failed read never adds a grant.

**Concurrency.** `load` has no re-entry guard, but the pool is `max: 1`, so reads run in order. G1 is not a hard bound: while the database read fails, a revoked role stays active. This is a design choice (a read failure must not sign everyone out). Model it as an explicit `readFails` action and check the weaker form "revocation takes effect after the next successful read".

**Interactions.** 2.4 reads grants again on each check. 2.5 does not (defect D03).

### 2.3 ws-ticket (P0, implicit)

**State.** `tickets: Map<ticket, {user, app, until}>`, server.ts:299.

**States:** `none`, `issued`, `consumed`, `expired`.

| From | Event | Guard | To | Evidence |
|------|-------|-------|----|----------|
| none | POST `/api/ws-ticket` | `guard` passed | issued, until = now + 30 s | server.ts:471-476 |
| issued | GET `/ws?ticket=` | any outcome | consumed (deleted first) | server.ts:797-799 |
| issued | another POST to the route | `until <= now` | expired (swept) | server.ts:473 |

**Invariants.** T1: one ticket opens at most one socket. T2: a ticket opens only its own app. T3: no ticket opens a socket after `until`.

**Failure analysis.** A wrong-app use burns the ticket (safe). An upgrade failure after the delete burns it too (the client retries). The sweep runs only on issue, so expired tickets stay in memory until the next issue. No security effect, because line 799 checks `until`. The stored `user` is a snapshot: on open, `rolesFor` reads the stale grants, and the next recheck (15 s) corrects them.

### 2.4 ws-socket (P0, implicit)

**State.** `sockets: Set`, each with `WsData {app, user, cls, truth}`, server.ts:134,199.

**States:** `open(full)`, `open(counts)`, each with `truth` on or off, and `closed(4401)`, `closed(4403)`, `closed(normal)`.

| From | Event | Trigger | Guard | To | Evidence |
|------|-------|---------|-------|----|----------|
| none | upgrade | staff | role for app in this mode | open | server.ts:802-805 |
| open | timer 15 s | clock | `recheck` | open or closed | server.ts:824, 338-347 |
| open | one-shot at `expiresAt + 50 ms` | clock | `recheck` | closed(4401) | server.ts:814 |
| open | `setMode` | staff | `recheck` all | open or closed(4403) | server.ts:249 |
| open | lens or reset | staff | sets `truth` | open | server.ts:615 |
| open | client close | client | | closed(normal) | server.ts:817-820 |

`recheck` order: expiry, then re-read SSO grants, then `rolesFor`, then set `cls` and `truth`.

**Invariants.**

- W1: a socket with no role for its app receives no `delta` beyond the recheck bound.
- W2: `truth` is true only for a holder of safety or admin in game mode (`truthFor`, server.ts:302).
- W3: a socket gets deltas shaped for its own `cls` (server.ts:213-219).
- W4: only `broadcast(m)` with `m == mode` reaches sockets (server.ts:206).

**Failure analysis.** Bounds: 15 s from a socket check, plus 60 s from the role reload. The `clock` message (server.ts:208) goes to every socket of the topic with no shaping. It carries no member data. Duplicate delivery does not exist in this direction. The client must handle out-of-order by version (2.26).

**Quint notes.** Merge 2.2, 2.3, 2.4. Variables: `grantsDb`, `grantsCopy`, `sockets: Set[{user, app, cls}]`, `mode`, `now`. Actions: `revoke`, `reloadRoles`, `check`, `setMode`, `open`, `expire`. Temporal check: after `revoke` and a successful reload and a check, no socket of that user. Time steps of 15 s are enough.

### 2.5 pii-reveal (P0, implicit)

**State.** `reveals: Map<"staff|mode|app|member", {memberId, reason, at, until}>`, server.ts:295. In memory only.

**States:** `none`, `active(until)`, `expired`, `revoked`, `lost` (restart).

| From | Event | Trigger | Guard | Effect | To | Evidence |
|------|-------|---------|-------|--------|----|----------|
| none | POST `/api/reveal` | safety | reason ≥ 5, member known | audit first, then set | active | server.ts:561-578 |
| none | POST unknown member | safety | | audit `ok:false` | none | server.ts:566-571 |
| active | POST again | safety | same | new row, replace | active | server.ts:574-576 |
| active | any read | clock | `until <= now` | delete | expired | server.ts:406-410 |
| active | DELETE | safety | | delete, then audit | revoked | server.ts:583-584 |
| active | restart | ops | | | lost | in-memory |

Consumers: `/api/member/:id`, `/timeline`, `/app`. Each read uses `revealFor` and passes `reveal: !!grant`.

**Invariants.**

- R1: a reveal has at most 15 minutes (server.ts:572).
- R2: an audit row exists before the grant (server.ts:574-576).
- R3: a reveal covers one staff member, one mode, one app, one member (test staff-apps.test.ts:157).
- R4 (intended, not met): a reveal is usable only by a person who holds safety or admin now. See D03.

**Failure analysis.** Crash between audit and set: a row with no grant, safe. DELETE clears first, so an audit failure gives 503 but the reveal is over, safe. Expired entries are removed only when the same key is read, so the map grows with no bound, but `revealFor` and the GET filter both check `until`.

**Quint notes.** Variables: `reveals`, `now`, `roles`. Actions: `grant`, `read`, `revokeRole`, `tick`. Invariant: `read(revealed) implies hasRole(safety) and now < until`. This finds D03 at once.

### 2.6 truth-lens (P1, implicit)

**State.** `lensOn: Set<"staff|app">`, server.ts:301. Game flag `lensUsed` (game.ts:97).

Transitions: `lens on` adds, `lens off` deletes, only after `source.control` returns ok (server.ts:613). `reset` removes every key for the app (server.ts:614). `truthFor` also needs game mode and a current role (server.ts:302).

**Invariants.** L1: hidden truth appears only in responses to a holder with the lens on. L2: it is never in a shared delta (`shapeDelta` has no `truth` field; `stripOracle` keeps the oracle back). L3: the lens does not survive into real mode as data, because `truthFor` needs game mode.

Tests: staff.test.ts:189, staff-apps.test.ts:92. No defect found in the server path. See D32 for `community`, which reaches every view without the lens.

### 2.7 staff-audit (P0, implicit)

**State.** Append-only rows. `FileAudit` (staff.ts:347-371) or `PgAudit` (staff.ts:379-419). Triggers refuse update, delete and truncate (schema.sql:290-299). `lastRead` dedupe map, server.ts:384.

**One-phase operations** (row before data): `read_member`, `read_timeline`, `read_member_app`, `read_opportunity`, `search`, `read_audit`, `read_bias`, `read_held_texts`, `read_relay_photo`, `find_person`, `read_person`, `open_person_app`, `lab_run`, `mode`, `reveal`.

**Two-phase operations** (`requested`, then action, then `result`): `/api/control` non-quiet commands (server.ts:611-617), `/api/safety` (server.ts:630-633), `/api/held` POST (server.ts:679-683).

**States of a two-phase action:** `not_started`, `requested`, `acted`, `result_ok`, `result_fail`, `requested_only` (crash or result write failed).

| From | Event | Guard | To | Evidence |
|------|-------|-------|----|----------|
| not_started | write requested | fails | refused 503, no action | server.ts:611, 402-404 |
| not_started | write requested | ok | requested | server.ts:611 |
| requested | action runs | | acted | server.ts:612 |
| acted | write result | ok | result_ok or result_fail | server.ts:617 |
| acted | write result | fails | requested_only (ignored) | server.ts:617 |
| acted | crash | | requested_only | |

**Invariants.**

- A1: no action runs with no `requested` row (fail closed).
- A2: no data leaves with no row, except reads inside the dedupe window (D16).
- A3: rows are never updated or deleted, except migration 0007, which disables the triggers inside its transaction to rename an app (0007:52-64).
- A4: audit rows hold no free text from staff commands except reasons (`auditDetail`, server.ts:852-860).

**Interaction.** The service writes its own rows for the same action into the same table (`this.audit.write`). A console action can have 2 console rows and 2 service rows. The `roles` in a service row are the console token's roles, not the staff member's (2.8).

**Quint notes.** Model as a wrapper: `auditAvailable` boolean, `log: List[Row]`. Check A1 and A2 for each action. Crash is an action that drops the rest of the step.

### 2.8 staff-action-relay (P0, implicit)

**Scope.** The path of `review`, `matching` and safety actions in real mode: `/api/control` → `RealSource.control` → `ServiceClient.act` → service staff API → Network `decide()` under the lock → reload.

**States of one action in the console:** `sent`, `applied` (200 ok), `refused(reason)` (409), `auth_failed`, `no_route`, `error`, `unknown` (timeout or connection error).

| From | Event | To | Evidence |
|------|-------|----|----------|
| sent | 200 and `ok` | applied | service.ts:99 (console client) |
| sent | 409 | refused(reason) | service.ts:100 |
| sent | 401, 403 | auth_failed | service.ts:101 |
| sent | 404, no reason | no_route | service.ts:102 |
| sent | other | error | service.ts:103 |
| sent | throw, timeout 15 s | unknown, code `service_unavailable` | service.ts:95-97 |
| applied or `not_in_review` | | reload and push | real.ts:803 |

**Guards on the console side:** role check (server.ts:598), real-only filter (602), reason mapping (604-608), seconds clamp (609, service.ts:109), `matching_locked` (real.ts:864). Review mode cannot go to the service: `review_mode` is game-only, and the service answers 404 (service.ts:2232 in network service).

**Identity.** The console token holds admin. The staff member's id goes in `X-Network-Staff-Id`. The service accepts it only from `NETWORK_SERVICE_CONSOLE_TOKEN` and only in a valid form (network service.ts:2536-2544). Otherwise the actor is the token (D34). The roles the service checks are the token's, so the console's own role check is the only per-person check on this path.

**Invariants.**

- V1 (AGENTS review gate): no member is contacted unless a person approved. The console holds no bypass: its database login is read-only, and `review_mode` is not sent.
- V2: the reviewer of record is the signed-in person.
- V3: a timeout never reports success.
- V4: a second decision on one item is refused (`not_in_review`).

**Failure analysis.**

- Timeout after the service commits: console says `service_unavailable`, the result row says `ok:false`, the item moved on. No idempotency key exists on these routes (D14). A retry is safe only because `decide`, `close` and `ban` refuse a repeat.
- Two staff act at once: the service lock orders them. The second gets `not_in_review`.
- Mode switch during the call: D12.

**Quint notes.** Model with the network review machine, not alone. Console adds: `inFlight`, `timeoutFired`, `auditRows`. Check that V1 holds with any interleaving of `timeout` and `commit`, and that the console's "applied" implies the service committed.

### 2.9 held-text-decision (P0, explicit in the service, implicit in the console)

**Leak queue** (service): `parked_leak_review` → `released` or `dropped`. **Relay text** (network): `held` → `released` or `rejected`. **Relay photo** (platform): `pending` → `approved` → claimed, or `rejected`, `revoked`. Those machines belong to other reports.

**Console part.** `photoPreviews: Map<key, {token, until}>`, server.ts:296.

**States of a photo preview:** `none`, `loading`, `ready(token, until)`, `expired`, `consumed`.

| From | Event | Trigger | Guard | Effect | To | Evidence |
|------|-------|---------|-------|--------|----|----------|
| any | GET `/api/held/:id/photo` | safety | id regex, reason 5-500 | audit, delete old preview, fetch | loading | server.ts:639-645 |
| loading | service refuses | service | | return its error | none | server.ts:646 |
| loading | token missing or out of range | | `until` in (now, now + 5 min] | cancel body, 409 | none | server.ts:647 |
| loading | 1000 previews held | | | 429 | none | server.ts:649 |
| loading | ok | | | store, strip token from response | ready | server.ts:650-653 |
| ready | POST release | safety | `photoReviewed === true`, preview fresh | audit, send token | sent | server.ts:677-681 |
| sent | ok | service | | delete | consumed | server.ts:682 |
| ready | `until` passes | clock | | refused at next release | expired | server.ts:677 |

Reject needs no preview (server.ts:677 tests `decision === "release"`).

**Client part.** `HeldRow` (admin.tsx:131-178): `previewIdentity` binds the preview to mode, app, item, staff, grants and `authEpoch`. Release needs `currentPreview && loaded && reviewed`. Editing the reason clears `reviewed`. Test: held-photo-ui.test.tsx.

**Invariants.**

- H1: a photo is released only by the staff member who loaded it (service proof binds reviewer, item and until: network service.ts:2117-2125).
- H2: no text of a minor is shown (real.ts:777-783 on top of the service).
- H3: a decision needs a reason of 5 or more characters, in the console and the service.
- H4: reject stays possible when the preview fails.

**Failure analysis.** Audit is first in each path. The photo read has one phase, and its row says `ok:true` before the outcome is known (D31). A service ahead of the console clock breaks the preview (D13). I checked the minor case for photo items: the console sets `textHidden` only when `text` exists (real.ts:782), so a photo item has no console age check, but the service `held()` and `reviewBytes()` call `current()`, which calls `authorize` (adults, membership, STOP, blocks, holds; photo-relay.ts:93,103-110,164,174). That is not a defect.

**Quint notes.** One small machine for the console: `preview`, `now`, `serviceNow`, `skew`. Check H1 and a liveness property: with honest actors and `skew` within a bound, a release can succeed. That property fails when `skew` exceeds the network delay (D13). Merge with the relay model for H1.

### 2.10 real-source (P0, implicit)

**State.** `RealSource` fields `sql`, `refused`, `reveal`, `revealRefused`, `loading`, `netState`, `store.env.error`, timers (real.ts:140-163).

**States:** `unconfigured`, `refused`, `check_failed`, `loading_first`, `live`, `read_error`, `disposed`.

| From | Event | Guard | Effect | To | Evidence |
|------|-------|-------|--------|----|----------|
| new | `init` | no URL | error in env | unconfigured | real.ts:198 |
| new | `init` | check ok, `loginProblem` | close sql, no timers | refused | real.ts:205-206 |
| new | `init` | check throws | error in env, **continue** | check_failed | real.ts:207 |
| new, check_failed | continue | | maybe clear global reveal; first load | loading_first | real.ts:208-218 |
| loading_first | load ok | | timers start | live | real.ts:214-220 |
| loading_first | load fails | | timers still start | read_error | real.ts:216-220 |
| live | poll, 10 s | `loading` null | load | live | real.ts:219, 229-236 |
| live | load fails | | error in env | read_error | real.ts:233 |
| read_error | load ok | | **clear error** | live | real.ts:232 |
| any | `dispose` | | clear timers, close | disposed | real.ts:223-227 |

`refused` and `unconfigured` are terminal until restart. In `refused`, `control` still reaches the service for review and matching: there is no data, but the action works.

**Global reveal.** `reveal` is set only for a local URL (real.ts:177) and survives only if `platform.settings.environment = 'dev'` (real.ts:208-212). Any read error turns it off (fail closed).

**Invariants.**

- E1 (intended): a login that fails `loginProblem` serves no data. Broken on the `check_failed` path (D02).
- E2: the connection is read-only (`default_transaction_read_only`, checked as `ro`).
- E3: every query filters by `app_id`.
- E4: `channel_identities` is never read.

**Concurrency.** `load` uses `Promise.all` on a pool of 4. Each query has its own snapshot, so one load can mix states (an opportunity row before a review row). A view only, no write. `reload` skips while a load runs. `afterAction` awaits the running load, then runs one more (real.ts:803), so a staff member reads their own write.

**Store retention.** `load` only adds or updates members, edges and opportunities (real.ts:351-386). It never removes any (D07).

**Quint notes.** A small explicit machine. Variables: `phase`, `loginOk`, `checkFails`, `served`. Invariant: `served implies loginOk or not checked`, written to fail on `check_failed`. Bounds: two polls.

### 2.11 console-age-view (P0, implicit)

**State.** `AgeInfo {latest, changes, optIns}` (real.ts:66-70), `recordAges` (real.ts:163), `ObsMember.minor`, `ageUnknown`, `declined`.

**States of one member in the console:** `adult`, `minor`, `unknown_age` (minor true, unknown true), `declined`.

| Input | Rule | Evidence |
|-------|------|----------|
| events `age_unknown` | minor, unknown | real.ts:435 |
| events `age_resolved` | payload minor, known | real.ts:435 |
| events `minor_signal`, `age_conflict` | minor, keep unknown | real.ts:435 |
| stored state row | overrides `latest`; a missing flag is minor | real.ts:442-446 |
| `account_status = 'removed'` and name null | declined, minor | real.ts:335-336 |
| no entry, record age null | minor, unknown | real.ts:81 |
| no entry, record age valid | by record age | real.ts:81 |

`minorAt(id, t)` (real.ts:89-97) answers "was this member treated as under 18 at time t". Order: record age; last change at or before t; else, only if there are no changes at all, the stored view; else invalid age.

**Consumers.** `ObsMember.minor`, `held()` text filter, `/api/member/:id/photos`, `minors` safety view, `minorContacts` alert and scorecard.

**Invariants.**

- M1 (AGENTS "minor contacts are always 0"): the count is exact.
- M2: fail closed: missing data never turns a minor into an adult.
- M3: `ageView` and `minorAt` agree at `t = now`.

M2 fails on a view read error (D01). M1 fails in the false-positive direction (D04). M3 fails after a staff clear, because `ageView` reads the stored flag and `minorAt` reads the last event (D04).

**Quint notes.** Model `events: List[AgeEvent]`, `stored: Option[flags]`, `record: Option[age]`. Check `minorAt(now) == ageView.minor`, and check that a read failure of `stored` cannot turn `ageView.minor` from true to false.

### 2.12 console-mode and source-cache (P1, explicit)

**State.** `mode: "game" | "real"`, `sources`, `starting`, `unsub`, `known` (server.ts:189-201).

**States of a (mode, app) source:** `absent`, `starting`, `ready`, `poisoned` (failed; the rejected promise stays in `starting`).

| From | Event | Guard | Effect | To | Evidence |
|------|-------|-------|--------|----|----------|
| absent | `source(m, app)` | | build, init, subscribe | starting | server.ts:228-237 |
| starting | init ok | | put in `sources` | ready | server.ts:233-235 |
| starting | init throws | | promise stays | poisoned | server.ts:228,238 |

**States of the mode:** `game`, `real`, `switching(from, to)`.

| Step | Effect | Evidence |
|------|--------|----------|
| 1 | audit row `mode` | server.ts:459 |
| 2 | to real: pause each game world | server.ts:245 |
| 3 | `mode = m` | server.ts:246 |
| 4 | `await source(m, ntwrk)` | server.ts:247 |
| 5 | `recheck` each socket | server.ts:249 |
| 6 | publish mode message | server.ts:250 |

Steps 3 to 6 are not atomic (D11). The mode header check in `guard` is early, and the handler reads `mode` later (D12).

**Invariants.** C1: a command runs in the mode the sender saw. C2: `mode` and the running source agree. C3: real-only never reaches game. C3 holds: `source` and `setMode` both refuse (server.ts:224,243).

**Quint notes.** Merge with 2.4. Add `initFails` as a nondeterministic input to find the poison state.

### 2.13 opp-projection (P1, explicit)

**Two writers of one column.** `network.opportunities.state` has no CHECK (schema.sql:106). It gets values from two different functions:

- Production: `oppState()` in packages/network/src/store.ts:88-96. Only six values: `IN_REVIEW`, `PROPOSED`, `SCHEDULED`, `COMPLETED`, `CANCELLED`, `SKIPPED`.
- Game and seed: `Projector.apply` (projector.ts:73-266) writes `ObsOpportunity.state`, and `writer.ts:115` stores it.

The core type has 23 states (packages/core/src/types.ts:120-125). The client keeps columns for many that nothing writes (web/store.ts:71-78).

**Reachable states.**

| State | Consent world (game) | Stub world (game) | Real |
|-------|---------------------|-------------------|------|
| PROPOSED | yes | yes | yes |
| IN_REVIEW | yes | no | yes |
| INVITING | no | yes | no |
| PARTIALLY_ACCEPTED, MUTUALLY_ACCEPTED, QUORUM_MET | no | yes | no |
| SCHEDULED | yes | yes | yes |
| COMPLETED | yes | yes | yes |
| FEEDBACK_COLLECTED | yes | yes | no |
| ABANDONED | yes | yes | no |
| SKIPPED | yes | yes | yes |
| CANCELLED | no (D05) | yes | yes |
| DECLINED, EXPIRED | no | yes | no |
| QUORUM_FAILED | no | no | no |
| DRAFT, APPROVED, SCHEDULING, RESCHEDULE_REQUESTED, NEEDS_REPLACEMENT, IN_PROGRESS, REJECTED_IN_REVIEW, SAFETY_HOLD, DISPUTED | no | no | no |

The last two rows are unreachable (D21).

**Transitions (projector).** Trigger is the simulator clock through run records.

| From | Record | Guard | To | Evidence |
|------|--------|-------|----|----------|
| any or none | `proposal` | none | PROPOSED, statuses pending | projector.ts:112-124 |
| none, PROPOSED | `review_queued` | no review yet | IN_REVIEW | projector.ts:285-292 |
| IN_REVIEW | `review_queued` rerolled | | IN_REVIEW, new deadline, participants swapped | projector.ts:276-283 |
| IN_REVIEW | `review_decision` approve | | IN_REVIEW, decision set | projector.ts:313-320 |
| non-terminal | `review_decision` reject | | SKIPPED | projector.ts:318 |
| non-terminal | reroll with `next = engine` | | SKIPPED | projector.ts:308 |
| non-terminal | `review_invalidated` | | SKIPPED | projector.ts:330 |
| non-terminal | `review_expired` | | SKIPPED | projector.ts:359 |
| none, IN_REVIEW | `probe_started` | | PROPOSED | projector.ts:372-379 |
| non-terminal | `probe_closed` | | SKIPPED | projector.ts:416 |
| PROPOSED | message type proposal | | INVITING | projector.ts:103 |
| non-terminal | message type cancellation matching `/calling this one off/` | | CANCELLED | projector.ts:105-107 |
| non-terminal, not SCHEDULED | `decision` | pair declined | DECLINED | projector.ts:514 |
| non-terminal, not SCHEDULED | `decision` | yes ≥ quorum | MUTUALLY_ACCEPTED, QUORUM_MET | projector.ts:516-522 |
| non-terminal, not SCHEDULED | `decision` | some yes | PARTIALLY_ACCEPTED | projector.ts:523 |
| any | `meeting_scheduled` | none | SCHEDULED | projector.ts:163 |
| any | `outcome` | none | COMPLETED if 2 or more showed, else ABANDONED | projector.ts:198 |
| COMPLETED | `feedback` | | FEEDBACK_COLLECTED | projector.ts:212 |
| any | `proposal_skipped` | none | SKIPPED | projector.ts:247-249 |
| non-terminal, **not SCHEDULED** | `opportunity_closed` | | DECLINED, EXPIRED or CANCELLED | projector.ts:251-253 |

**Invariants.**

- O1: terminal states are absorbing (`isTerminal`, projector.ts:11-14). Not enforced on `proposal`, `meeting_scheduled`, `outcome`, `proposal_skipped` (D20).
- O2: an opportunity in IN_REVIEW has no contacted member (PRD 32.8).
- O3: a closed Network opportunity never reads as open in the console. Broken by D05.
- O4: game and real give the same state for the same run (docs/observatory.md 6). Broken by D05.

**Quint notes.** Model the network stage machine (`review`, `probing`, `scheduled`, `done`, `closed`) and a function `project(records)`. Check O1 over reorderings, and O3 and O4 as refinement: `oppState(stage) == project(records)` for the six shared states. This is the most useful check in this report for the game side.

### 2.14 participant-status (P2, explicit)

Type at types.ts:113-116. Values: `checking`, `available`, `unavailable`, `pending`, `invited`, `accepted`, `declined`, `countered`, `ignored`, `expired`, `dropped`, `confirmed`, `attended`, `no_show`, `cancelled_with_notice`.

Main paths: `pending → invited` (message), `checking → available or unavailable` (probe answer), `invited → accepted, declined, countered, ignored` (decision), `accepted → confirmed` and `pending, invited, ignored → dropped` (meeting scheduled), `confirmed → attended, no_show, cancelled_with_notice` (outcome), `invited, ignored → expired` (close).

Production writes only `checking`, `available`, `unavailable`, `dropped`, `attended`, `confirmed`, `accepted`, `declined`, `pending` (network store.ts:98-107). `attended` means "said yes and the opportunity is done", not "showed up" (D23). `no_show` and enjoyment never exist in real mode.

`network.participations.status` has no CHECK (schema.sql:130).

### 2.15 review-info-projection (P1, explicit)

`network.review_items`: `decision in (approve, reject, expired)`, null while waiting (schema.sql:144). The console never writes this table. Game reads the Network's logs, real reads the rows.

**States:** `waiting` (`decision` null), `approved`, `approved_invalidated`, `rejected`, `expired`, plus counters `rerolls`, `edits`, `secondsSpent`.

Decision `edit` becomes `approve` with `edits`. Decision `reroll` keeps `waiting`, increments `rerolls`, and moves `deadline`, but not `queuedAt` (projector.ts:281). The console's `review_app_sla` alert uses `queuedAt` (health.ts:57), so a rerolled item stays late even though it has a new deadline. That matches "how long it waited" and I do not count it as a defect.

**SLA.** Two clocks: the Network deadline expires items (`review_expired`). The app SLA (apps.ts:68) only raises an alert. Alert keys are `review_overdue`, `review_app_sla`, `review_near_sla`, `review_sla_missed` (health.ts:52-59). `appHealth` counts late plus expired (health.ts:327-333).

**Reviewer access.** `inOpenReview` (game.ts:547, real.ts:716) decides which members a reviewer may open. It reads the store, so in real mode it lags by one poll (10 s).

### 2.16 safety-case-report-view (P0, explicit)

**Case.** `ObsSafetyCase.status`: `open`, `held`, `lifted`, `closed` (types.ts). Owned by the Network. The console reads the stored view, or rebuilds cases from events when no stored view exists (real.ts:731-749).

**Report.** `SafetyReport.status`: `open`, `held`, `banned`, `dismissed`.

| From | Action | Who | Guard | To | Evidence |
|------|--------|-----|-------|----|----------|
| open | hold | safety | note ≥ 5 | held | network.ts:1321,1355 |
| open, held | ban | safety | note ≥ 5, real mode | banned | network.ts:1335,1355 |
| open | dismiss | safety | note ≥ 5 | dismissed | network.ts:1345-1346 |
| held | dismiss | | refused `already_held` | held | network.ts:1345 |
| held | lift hold | safety | | held (report unchanged) | network.ts:1244-1251 |

**Console actions.** `checkSafety` validates (server.ts:863-880). Game allows only `lift`, `close`, `clear_minor` (game.ts:569-578). Real sends everything to the service.

**Client buttons.** Hold, ban and dismiss exist only on a report row with status `open` (admin.tsx:259-264). Clear-minor exists only on an open `minor` report (admin.tsx:266-272). A case row has only lift and close (admin.tsx:220-221). See D10.

**Fallback.** With a service error on `GET /safety/reports`, the console builds reports from cases with synthetic ids (real.ts:753-754, health.ts:259-280). `holdMember` with such a `reportId` returns `unknown_report`. These rows show as `open` with buttons that the Network refuses. This only happens during a partial service failure.

**Invariants.**

- F1: a held person stays held until a person lifts it.
- F2: a banned report never reopens.
- F3: every open report has a staff exit.
- F4 (PRD 36.3): urgent items have a 1-hour target (health.ts:286,298).

### 2.17 game-world (P2, implicit)

**State.** `ClockInfo.playing`, `speed`, `waitingForPlayer`, `busy` (types.ts), `GameSource.advancing` (game.ts:93), `strikeIds` (game.ts:101), `pendingReset` (game.ts:103).

**States:** `paused`, `playing`, `stepping`, `waiting_for_player`, `ended` (`now >= end`), `over` (3 strikes), `resetting`.

| From | Event | Guard | To | Evidence |
|------|-------|-------|----|----------|
| paused | play | not over | playing | game.ts:628 |
| playing | tick 100 ms | not advancing, not over | advance | game.ts:359-364 |
| playing | now ≥ end | | paused | game.ts:362 |
| paused | step | not advancing, not over | stepping | game.ts:631-636 |
| stepping | persona prompt | controlled member | waiting_for_player | takeover.ts:29-36 |
| waiting_for_player | reply | | stepping | game.ts:660-665 |
| any | third strike | | over, `playing = false` | game.ts:228 |
| any | reset | admin | resetting, then paused | game.ts:680-692 |

`WAITS_FOR_WORLD` (game.ts:802): `review`, `review_mode`, `matching`, `propose`, `say`, `god`, `check_scenario` wait with `idle()`. `reset`, `takeover`, `reply`, `lens`, `peek` do not. `safetyAction` waits (game.ts:565). `idle()` stops waiting while a prompt is pending (game.ts:409), so a decision can land inside a tick in that one case. That is a documented trade-off.

**Invariants.** W1: a staff action never lands inside a tick (except while a prompt waits). W2: records of one world never reach another world's projector. Broken by D18. W3: `over` is left only by reset.

Determinism test: docs/observatory.md section 6.

### 2.18 takeover-prompt (P2, implicit)

`pending: Map<id, {prompt, ctx, msg, resolve}>` (takeover.ts:17).

**States:** `none`, `pending`, `answered`, `auto_answered`.

`respond` creates (takeover.ts:29-36), but only for a controlled persona and a type outside `NO_REPLY_NEEDED`. `answer` deletes first, then resolves (takeover.ts:41-46), so a double answer throws. `releaseAll` answers everything by policy (takeover.ts:50-53). `takeover off` answers that member's prompts (game.ts:652-653). No defect found.

**Liveness.** A prompt blocks the whole world until answered, by design. `dispose` releases it.

### 2.19 game-counters (P2, implicit)

- Sparks: `sparksUsed[day]`, 6 per sim day, taken before the proposal is sent, never refunded (game.ts:764-767).
- Strikes: `strikeIds`, idempotent per opportunity (projector callback, game.ts:225-229).
- Missions: done is sticky (scoring.ts:101).
- Peeks: each costs 25 points (game.ts:791).

Scoring is a pure function over opportunities. It does not need a model.

### 2.20 shadow-run (P2, implicit)

`shadowing: Promise | undefined` (real.ts:159). One at a time; a second caller shares the result (real.ts:860-861). `clock.busy` set and cleared in `finally` (real.ts:889,917). Old shadow rows are removed before the new run, so a failure leaves none or a partial set. Shadow opportunities have `source = "shadow"` and every counter skips them (store.ts:125, health.ts:115,263,312). Nothing is written (PRD 34.6). A shadow proposal uses the app's views for blocks and ages under an app login (`appSnapshotSql`, real.ts:942-951).

The precision metric includes `o.source === "shadow"` with `o.review` (health.ts:171), but a shadow row never has `review`. That branch is dead.

### 2.21 lab-run (P2, explicit)

`LabRun.status`: `queued`, `running`, `done`, `failed` (types.ts). Files `runs/lab/<id>.json`. In-memory `queue`, `active`, `children`.

| From | Event | Guard | Effect | To | Evidence |
|------|-------|-------|--------|----|----------|
| none | `start` | queue has room | save | queued | lab.ts:130-144 |
| queued | first seed starts | | save | running | lab.ts:160 |
| running | seed ends | `done == total`, no error | save | done | lab.ts:177-182 |
| running | seed ends | `done == total`, error | save | failed | lab.ts:177-182 |
| queued, running | restart | | in memory only | failed | lab.ts:106 |
| any | `dispose` | | kill children, drop queue | stays on disk | lab.ts:198 |

**Invariants.** LB1: at most `concurrency` children. LB2: every seed counted once, `done <= total`. LB3: `running` ends. LB3 fails if a save throws (D24). LB4: children get no secrets (`labEnv`, lab.ts:20-25).

Saves of one run are in order (`saving` chain, lab.ts:190-195). A file is written to `.tmp`, then renamed.

### 2.22 access-key-cache (P1, implicit)

`keys`, `fetchedAt`, `loading`, `staleWarned` (staff.ts:264-290).

**States:** `empty`, `fresh`, `refetching`, `stale_grace`, `dead`.

| From | Event | Guard | To | Evidence |
|------|-------|-------|----|----------|
| empty | verify | | refetching | staff.ts:280 |
| fresh | age > 1 h, or unknown kid and age > 30 s | | refetching | staff.ts:280 |
| refetching | ok | | fresh, keys replaced | staff.ts:306-307 |
| refetching | fails | keys exist, within 25 h | stale_grace | staff.ts:283-285 |
| refetching | fails | no keys, or past grace | dead (verify returns error) | staff.ts:284,318 |
| stale_grace | next verify | | refetching | staff.ts:280 |

A 200 with `keys: []` empties the map and sets `fetchedAt` (staff.ts:301-307). All sign-ins then fail for up to 30 s, until the unknown-kid path refetches. This fails closed, so I do not count it as a defect.

**Invariants.** K1: only a key from the certs endpoint verifies a token. K2: a key removed by Cloudflare stops working within 1 h, or 25 h if the endpoint is down. K3: at most one fetch at a time (`loading ??=`).

### 2.23 migrate-ledger (P1, implicit)

**State.** `public.__migrations (id, checksum, repeatable, applied_at)`, advisory transaction lock `thenetwork-migrate`.

**Run:** build list (migrate.ts:26-43); `checkNumbers` refuses duplicates and reserved numbers (migrate.ts:56-67); one transaction: `lock_timeout`, lock, optional reset, create ledger, apply pending, record.

**States of one migration:** `pending`, `applied(checksum)`, `drifted` (a non-repeatable file changed after it ran; skipped, warning only when `log` is passed).

| From | Event | Guard | To | Evidence |
|------|-------|-------|----|----------|
| pending | run | | applied | migrate.ts:97-100 |
| applied | run | same checksum | applied | migrate.ts:92 |
| applied, repeatable | run | checksum differs | applied again | migrate.ts:92,97 |
| applied, non-repeatable | run | checksum differs | drifted, skip | migrate.ts:92-95 |

**Callers.** `deploy/backend/server.ts:38` at boot with `lockTimeout: 60s`, tests, `scripts/sim`, the CLI. `migrate()` has no host guard: only the CLI has one (migrate.ts:114-117).

**Crash.** The whole run is one transaction, so a crash applies nothing. Two runners serialize on the lock. Long runs hold schema locks until commit.

**Repeatable re-run.** `schema.sql` runs before all numbered files. When it changes, it runs on a database that already has them. It re-grants `select on all tables` to `network_observatory` (schema.sql:318), then takes back only `channel_identities`, `network_state` and the console views (schema.sql:319-335). See D28.

**Invariants.** MG1: no migration runs twice, except repeatables. MG2: order equals the list. MG3: two numbered files never share a number. MG4: console read grants are the same after any re-run.

**Quint notes.** Small: `files: Map[id, checksum]`, `ledger`, two runners, a crash action. Check MG1 and MG2 with concurrent runners and a checksum change.

### 2.24 seed-writer (P1, implicit)

`writeRows` (writer.ts:165-191): one transaction, `set local app.app_id`, optional truncate of **every** app's network tables with `cascade`, then insert. The cascade also empties tables with foreign keys to `network.members`, such as `platform.profile_suggestion_batches` (0039).

Guards: `seed.ts:36` refuses non-local unless `--allow-remote`; `migrate.ts:117` refuses non-local. Neither reads `platform.settings.environment` (D06).

Declined members are written with the id only (writer.ts:85-94). Events that name them are dropped (writer.ts:149).

### 2.25 dev-pg (P2, implicit)

`up` is idempotent: `initdb` if no `PG_VERSION`; `pg_isready`; `pg_ctl start`; `create database` if missing (dev-pg.ts:34-50). `applySchema` is `migrate`. Two concurrent `up` calls can race on `initdb` or `create database`; the second fails with an error, and tests use per-process databases. Local only. No model needed.

### 2.26 client-sync (P2, implicit)

`version`, `loadingState`, `buffered`, `wsGen`, `connected`, `authNeeded`, `authEpoch` (web/store.ts:217-251).

**Socket states:** `disconnected`, `ticket_wait`, `open`, `backoff`, `stopped`.

| From | Event | To | Evidence |
|------|-------|----|----------|
| any | `connect` | ticket_wait, `wsGen++` | web/store.ts:399-402 |
| ticket_wait | ticket ok | open | web/store.ts:409-411 |
| ticket_wait | fail, not 401/403 | backoff 3 s | web/store.ts:405 |
| ticket_wait | 401, 403 | stopped | web/store.ts:405 |
| open | close, other code | backoff 1.5 s, then connect and load | web/store.ts:417 |
| open | close 4401, 4403 | load, **no connect** | web/store.ts:416 |

**Delta rule.** A delta with `version > local + 1` forces a full load (web/store.ts:372). While a load runs, deltas buffer, and those at or after the state's version are applied (web/store.ts:337).

**Invariants.** CS1: after any message loss the client reaches the server's state. CS2: one socket per `wsGen`. D26 and D27 touch these.

### 2.27 client-decide-guard (P2, implicit)

`deciding: Set` blocks a double press (web/store.ts:796-802). `reviewOpened` times a card. The set is released in `finally`. `REFUSED` keeps timing for codes that changed nothing (web/store.ts:169,804). A timeout is not in `REFUSED`, so timing stops (safe).

### 2.28 delta-store (P2, implicit)

`Store` (store.ts:43-177) keeps dirty sets, `version`, `newFeed`. `takeDelta` bumps `version` only when `hasChanges`. A `network`-only delta from a source has no version bump, which is fine for the client's gap check.

`broadcast` drops deltas of the other mode, and the dirty sets are already cleared by then (server.ts:202-206). The client does a full load on a mode message, so nothing is lost.

### 2.29 schema-catalogue (P0-P2, explicit)

State columns defined in `db/`. Other reports own the logic. They are listed so that nothing is missed.

| Table.column | States | File:line |
|-------------|--------|-----------|
| network.members.account_status | invited, onboarding, active, paused, restricted, removed | schema.sql:18-19 |
| network.members.participation_state | open, normal, quiet, receiving, paused | schema.sql:20-21 |
| network.members.opted_out | boolean | schema.sql:22 |
| network.members.participation_window | jsonb | 0023:3 |
| network.facets.status | proposed, confirmed, rejected | schema.sql:57 |
| network.intents.status | active, paused, closed | schema.sql:73 |
| network.opportunities.state | free text | schema.sql:106 |
| network.participations.status | free text | schema.sql:130 |
| network.review_items.decision | null, approve, reject, expired | schema.sql:144 |
| network.messages.status | free text | schema.sql:159 |
| network.messages.notification_recorded_at | null or time | 0024:2 |
| network.requests.outcome | free text | schema.sql:262 |
| network.relay_records.decision | pass, hold, block | 0026:33 |
| network.relay_records.review | held, released, rejected | 0026:39 |
| network.ops_alerts.open, level | boolean; warn, bad | 0020:33,36 |
| platform.apps.status | dev, staging, live, paused | 0003:26 |
| platform.apps.join_mode | invite, open, waitlist | 0003:25 |
| platform.networks.matching_enabled | boolean | 0003:49 |
| platform.memberships.state | same as account_status | 0003:88 |
| platform.memberships.review | recycled_number | 0003:89 |
| platform.consent_events.state | opted_in, opted_out | 0003:105 |
| platform.phone_identities.hold | recycled_number | 0006:23 |
| platform.otp_challenges | consumed_at, attempts, expires_at | 0003:180-189 |
| platform.sessions | revoked_at, rotated_from, expires_at | 0003:195-203 |
| platform.share_grants.revoked_at | null or time | 0003:119 |
| platform.pending_texts.kind | join, looking_for, share, photo_consent | 0014:12 |
| platform.person_sends | a row is a taken slot | 0007:156 |
| platform.bans | row presence, no update | 0011:13-27 |
| platform.photos.deleted_at | null or time | 0011:39 |
| platform.outbound.status | free text (see the index at 0015:56-58) | 0015:33 |
| platform.outbound.lease_owner, lease_until, in_doubt | lease | 0015:38-41 |
| platform.line_conversations.unanswered, reengagement_used | counters | 0015:65-66 |
| platform.inbound.status | pending, done, failed, processing, unresolved | 0021:3 |
| platform.phone_changes.confirmed_at | null or time | 0033:16 |
| platform.photo_relay_items.state | pending, approved, rejected, revoked | 0037:33 |
| platform.profile_suggestions.status | proposed, accepted, rejected, expired, withdrawn | 0039:35 |
| public.__migrations | row presence | migrate.ts:85 |

Note: migration 0037 and 0039 create tables with plain `create table`, so a renumbered copy cannot re-run. `migrate.ts:50-54` warns about this.

---

## 3. Suspected defects

Each entry lists where, a trigger sequence and the confidence. None is fixed here.

### P0 group

**D01. A read error on the console state view can turn a minor into an adult in the console.** real.ts:264-272, 420-449, 79-82; used at real.ts:781 and appProfile.ts:44-47.

Trigger:
1. Member M is adult on record. The Network holds `minor: true` from `minor_reported` or `minor_record`. Neither is in `AGE_EVENTS` (real.ts:71).
2. A poll runs. `select members from network_state_console_<app>` fails (timeout, restart).
3. `stateRow` catches it and tries `network.network_state_console`. Console roles have no access since migration 0010. That catch returns `[]`.
4. `ageInfo` gets no stored row, so `ages.latest` has no entry for M, and `this.ages = ages` replaces the good copy.
5. `ageView(30, undefined)` gives `minor: false`.

Effect until the next good poll (about 10 s): `held()` shows the text, `adultOf` passes. The service stays the authority for sends and photos, so nobody is contacted. The comment "A missing flag fails closed" (real.ts:444) does not cover a missing row. CONFIRMED, bounded impact.

**D02. The login check fails open on an error.** real.ts:201-207, 232.

Trigger: the `pg_roles` query throws at start (a transient error, a restart of the replica). The catch only sets an env error. `init` goes on, loads data and starts timers. The next good poll clears the error (real.ts:232). The login is never checked again. A superuser or BYPASSRLS login then serves an app with only the `app_id` filter, and the banner shows nothing. CONFIRMED.

**D03. A PII reveal survives a role change.** server.ts:406-410, 415-420, 482.

Trigger:
1. S holds `safety@slop` and `reviewer@slop`. S reveals member M for 15 minutes.
2. An admin removes `safety@slop` from `platform.staff_roles`.
3. After the next reload, S is a reviewer. M is in an open review item, so `canSeeMember` is true.
4. `revealFor` has no role check, so `member()` runs with `reveal: true` and S reads M's own words.
5. S cannot end the reveal, since DELETE needs safety.

Bound: 15 minutes. Admin-console 4.4 ties a reveal to the safety role. CONFIRMED.

**D04. `minorAt` does not follow the Network's age state over time.** real.ts:71, 89-97, 435, 457-470; network.ts:1553-1555, 1578, 4424.

Case A (staff clear): a member has a `minor_signal` event. Staff clear it with `clear_minor`. The Network logs `safety_action` only. `changes` still ends with `minor: true`. Every later opportunity message counts as a minor contact. `ageView` says adult, `minorAt` says minor, so M3 fails.

Case B (no age event): `minor_reported` and `minor_record` set `minor = true` with no event in `AGE_EVENTS`. `minorAt` then uses the current stored flag for every past time, so messages sent before the report count.

Effect: the `minor_contacts` alert is `bad`, and the scorecard target fails, with no real contact. "Must be 0" alarms lose meaning. CONFIRMED. Case B matches the test name in real-fixes.test.ts:20, but not the stated rule "at that moment" (real.ts:85).

**D34. The reviewer of record is lost if the console token is not set.** network service.ts:2536-2544; network main.ts:43; deploy/backend/server.ts:77.

`reviewerOfRecord` returns the token user when `consoleToken` is unset. `NETWORK_SERVICE_CONSOLE_TOKEN` is optional in the option list that I read, and I found no start check. Decisions then read `reviewer = token:admin#...`, and the photo proof binds to the token. PLAUSIBLE (depends on deploy variables).

**D35. Two guards for the peon matching switch.** apps.ts:21; real.ts:864; 0011:45; network service.ts:382, 1811.

The console refuses `matching on` for peon (`PACK_READY`). The service reads `platform.networks.matching_enabled`, which migration 0011 sets to true for `peon:nyc`. A direct service call with an admin token turns it on. AGENTS decision 4 says peon matching runs locally only. The console guard is the only one. CONFIRMED that the guards differ. The service API needs a service token.

### P1 group

**D05. A scheduled opportunity that the Network closes stays SCHEDULED in game mode.** projector.ts:105, 251; packages/network/src/copy.ts:108-110; network.ts:2518, 2526-2560.

Trigger:
1. A booked plan is in stage `scheduled`.
2. A member calls it off. The Network sends `copy.dropNotice`: "this one is off now". The Network logs `opportunity_closed`.
3. The projector regex wants "calling this one off". That text exists only in `packages/sim/src/stubNetwork.ts:319`.
4. Line 251 skips `opportunity_closed` when the state is SCHEDULED.

Result: the projection says SCHEDULED until the meeting time. No API cancels the world's meeting, so `outcome` then sets COMPLETED or ABANDONED. The Network says closed, and `consoleRows` would say CANCELLED. The same applies to `close()` with `minors policy`: `safetyInfo.minors.inOpportunities` ("must be empty") then shows a closed plan. `writer.ts` stores the wrong state, so O3 and O4 fail. CONFIRMED.

**D06. The seed and migrate guards trust the host name.** migrate.ts:84, 114-118; seed.ts:13-14, 36; writer.ts:173; contrast real.ts:209.

Trigger: an SSH tunnel to production on `localhost:5433`. `NETWORK_DATABASE_URL` points to it. `bun run db:migrate -- --reset` drops the `network`, `platform` and `notify` schemas. `seed.ts` truncates every app's tables. real.ts:209 states this risk ("a tunnel to production also looks local") and reads `platform.settings.environment`. These two tools do not. CONFIRMED that the guard is missing. The trigger needs an operator error.

**D07. The real-mode store never drops what the database dropped.** real.ts:351-386; store.ts:77-87.

Trigger: a member leaves or deletes everything. The forget path deletes `network.edges` rows (network runtime.ts:541) and events. `load()` only adds edges. The edge stays in `/api/state`, in deltas and in member detail until restart, and the graph keeps a link to the forgotten member. `addEdge` also only raises strength. Opportunities deleted by `PgStore.save` (network store.ts:273) stay too, and an opportunity that was `IN_REVIEW` at its last read would keep `inOpenReview` true. Feed lines keep the old name text. CONFIRMED for edges and opportunities.

**D08. A member who left is shown as declined at join.** real.ts:334-341; network runtime.ts:520, 543-545.

The forget path writes `name = null`, `account_status = 'removed'`. That is also how the under-13 decline is stored. The console sets `declined: true`, `minor: true`, name "Declined member". An adult who deleted everything then reads as an under-13 decline. CONFIRMED.

**D09. The console photo gate is stricter than founder decision 9.** appProfile.ts:48-54; server.ts:529-534; network service.ts:1572-1590.

The console needs the tag `verify:age:pass`. Decision 9 says no ID check, and `verifiedAdult` refuses only on `verify:age:fail`. The only writer of the tag is `POST /members/:id/verify` (network service.ts:1635-1643), and `ServiceClient` has no such call. So on production slop, safety staff with an open report get `needs_verification` for nearly every adult. A liveness failure in a safety flow: it fails closed. CONFIRMED.

**D10. Report and hold actions have dead ends in the console.** admin.tsx:220-221, 259-264; network.ts:1244-1251, 1345, 1355.

- A report in `held` has no action: dismiss is refused (`already_held`), and the buttons need `open`.
- The Network allows held to banned, but the console has no button for it.
- Lift hold leaves the report `held` forever, and `staffPhotos` keeps treating it as ground for a photo read (network service.ts:1793).
- A member with a case and no report cannot be held or banned from the console at all.

The API accepts these actions, so this is a client gap. CONFIRMED.

**D11. The mode switch is not atomic, and a failed source start stays failed.** server.ts:228-238, 245-250, 461.

Trigger: `POST /api/mode {game}` on a non-real-only image with no synthetic data. `mode = "game"` is set first. `source()` rejects. The handler returns 400, but `mode` stays `game`. Sockets are not rechecked until the next 15 s tick, no mode message goes out, and every route gets 500. `starting` keeps the rejected promise, so a retry fails with no new attempt until restart. Switching back to `real` works. CONFIRMED.

**D12. The mode header check runs before the awaits.** server.ts:369-371, 591, 611-612.

Trigger: a reviewer posts `review` with header `game`. The check passes. `await req.json()` and `await record()` yield. An admin's switch runs. `source(mode, app)` then reads `real`, and the decision goes to the real service. The oppId must also exist there, so the usual result is `not_in_review`. The audit row can show `requested` in one mode and the action in the other. PLAUSIBLE, small window, and only on a non-real-only server.

**D13. A service clock ahead of the console breaks photo review.** server.ts:647; network service.ts:2306-2307.

The service sets `until = serviceNow + 5 min`, unless the item expires first. The console refuses `until > consoleNow + 5 min`. So when the service clock leads by more than the time from token creation to the check, every preview fails with "This photo preview expired". The body is fully read before the check, which widens the margin, but a skew of a few hundred ms can pass it. The release path is then blocked, and reject still works. PLAUSIBLE.

**D14. A timeout after commit reads as failure.** sources/service.ts:95-97; server.ts:617, 633, 683.

Trigger: the service commits a hold, then the response takes more than 15 s. The console returns `service_unavailable`, and the audit result row says `ok:false`. `afterAction` does not reload (real.ts:803). The staff member sees an error for an action that took effect. Retries are refused by state, not by key. For `ban` a retry returns `already_banned`, which reads as a second problem. CONFIRMED as an ambiguity.

**D16. Audit dedupe skips the fail-closed rule.** server.ts:392-393; docs/observatory.md 9.3.

`read_member` and `read_timeline` inside 60 s skip the write, so they succeed while the audit sink is down. A reveal that ends and starts again within 60 s also gets no new read row, since the key has `revealed = 1` for both. An earlier row exists in each case. CONFIRMED, low impact.

**D17. Nothing stops a deployed console from using the file audit.** staff.ts:421-424; server.ts:168-180.

`createAudit` falls back to `runs/audit/audit.jsonl` with no error. `deployGuard` does not check `OBSERVATORY_AUDIT_DATABASE_URL`. docs/deploy.md:221 marks it required, but the code does not. On a container, a redeploy then loses the log that A3 calls append-only. CONFIRMED.

**D29. The total budget line is wrong under an app login.** ops.ts:65-69; 0020:71.

`everyApp` runs a query for every app's rows, but through the app's read login, and the row policy keeps it to `(app, 'shared')`. An `admin@*` then sees a total that leaves out the other apps. CONFIRMED for a deployment with `OBSERVATORY_DATABASE_URL_<APP>`.

**D31. The photo read audit says ok before the outcome.** server.ts:643-646.

`read_relay_photo` has one row with `ok:true`. A service refusal adds no console row. The service writes its own. CONFIRMED, low impact.

**D33. `deployGuard` does not look at the service URL.** server.ts:168-180, 269-271.

A local server with a token, a local database and `NETWORK_SERVICE_URL` for a remote service passes the guard. A person with the local token then acts on production through the console's admin token. PLAUSIBLE (needs that env mix).

### P2 group

**D18. Reset during an advance mixes two worlds.** game.ts:366-373, 626, 680-692, 802.

Trigger: an admin sends `reset` during a long step. `reset` is not in `WAITS_FOR_WORLD`. `dispose` does not wait for `advancing`. `init` replaces `records`, `projector` and `store`. The old world keeps running, and its `onRecord` closure calls `this.onRecord`, so its records enter the new projector. The old `finally` can also null a new `advancing`. W2 fails. CONFIRMED.

**D19. A re-reported meeting counts accepts again.** projector.ts:165-170; sim world.ts:213-216; network.ts:3099.

A late joiner causes `meeting_scheduled` with all participants. Each already `confirmed` member passes the test at line 168, so `c.accepts` and `k.accepted` go up again. The opt-in metric rises. CONFIRMED.

**D20. Terminal states are not absorbing.** projector.ts:67-71, 112-124, 163, 198, 248.

`proposal`, `meeting_scheduled`, `outcome` and `proposal_skipped` set state with no terminal guard. `outcome` after D05 is one real case. Others depend on record order that the Network may not produce. PLAUSIBLE.

**D21. Unreachable states.** core types.ts:120-125; web/store.ts:71-78; projector.ts:11-13.

Nine core states have no writer. `QUORUM_FAILED` is in `TERMINAL` with no writer. INVITING to QUORUM_MET, DECLINED and EXPIRED exist only with the stub network. Real mode has six states, so client columns stay empty. CONFIRMED.

**D22. Real `updated_at` moves on every save.** network store.ts (`updated_at: date(savedAt)`, upsert sets it); real.ts:379; store.ts:33; web/store.ts:689; web/drawer.tsx:202.

Each save rewrites `updated_at` for every opportunity in the state. So closed opportunities pass the range filter, `ageHours` keeps growing, "time in state" shows time since the last save, and `upsertIfChanged` resends each row. CONFIRMED.

**D23. Real attendance is not measured.** network store.ts:98-107; real.ts:400-406; health.ts:148-149.

`yes` plus `done` maps to `attended`. `COMPLETED` has no attendance test. So `no_show`, `ABANDONED` and enjoyment never occur in real mode, and the show rate and completion read near 100%. CONFIRMED that the mapping does this.

**D24. A lab run can stay `running`.** lab.ts:155, 160, 182.

`save` at line 160 is outside the `try`. If it throws, `exec` rejects, the seed is never counted, and LB3 fails. The promise from `exec(...).finally(...)` has no catch, so the rejection is unhandled. CONFIRMED (needs a disk error).

**D25. Two lab checks can give a 500 after the audit row.** server.ts:736-739; lab.ts:132.

Two requests pass the route check, then `record` yields. The second `start` throws, and the client gets a 500 with an `ok:true` audit row. PLAUSIBLE.

**D26. No socket after close 4401 or 4403.** web/store.ts:416.

The client calls `load()`, and `load` connects only when the app changes. If the person has a valid session and a role, the page stays disconnected until reload. The review queue then lags with a red dot only. CONFIRMED.

**D27. A delta at the state's version is applied again.** web/store.ts:337, 386.

`d.version >= state.version` includes a delta taken before the state was read. Feed lines duplicate. Maps are idempotent. PLAUSIBLE.

**D28. The alert tables are open to the shared console role.** schema.sql:318, 323; 0020:11, 31-50.

0020 says no console role reads them. Default privileges (schema.sql:323) grant select on new tables to `network_observatory`, and neither table has row-level security. The golden test in test/migrations.test.ts does not list them. A rerun of `schema.sql` grants them again in any case. PLAUSIBLE: I did not run the grant query.

**D30. Commands without a number run the whole world.** game.ts:630, 635; sim world.ts:289; sim scheduler.ts:72-77.

`{type:"step"}` gives `Math.max(MINUTE, undefined) = NaN`. `{type:"speed"}` sets `c.speed = NaN`. `Math.min(NaN, end)` is NaN, and `next.at > NaN` is false, so `runUntil` never breaks and drains the queue. Simulation roles only. CONFIRMED by reading.

**D32. Hidden truth reaches every view.** game.ts:155, 183; writer.ts:100.

`communities` comes from `hidden_truth.jsonl` and fills `ObsMember.community` with no lens. The writer stores it in `network.members.community`. AGENTS says only `packages/sim` and judges read that file. Game only. CONFIRMED that the read exists.

**D36. `mergeStateRows` order decides a member's age flag.** real.ts:119, 442-446.

Lists join newest row first, then `info.latest.set` runs in that order, so the oldest row wins for an id present in two cities. PLAUSIBLE: needs one member in two networks.

**D37. Stale text.** game.ts:36-38; lab.ts:72-76; docs/observatory.md:18 say slop runs with matching off. `PACK_READY` allows slop (apps.ts:21). CONFIRMED, no behavior effect.

**D15. An invalidated approval does not refresh.** real.ts:803.

`busy_elsewhere` and similar codes skip the reload, so the card stays until the next poll (10 s). CONFIRMED, cosmetic.

---

## 4. Checked and not defects

- A double review decision: refused by `not_in_review`, and blocked at the client by `deciding`.
- WebSocket ticket reuse: deleted on first use (server.ts:798). Test server.test.ts.
- An engineer's socket after a switch to real: closed by `recheck` (test staff.test.ts:387).
- The real connection cannot write: read-only setting plus test real-service.test.ts.
- `review_mode` in real: refused. `GAME_ONLY` on real-only, RealSource otherwise, and the service answers 404.
- A minor's photo in the held queue: blocked by the service (section 2.9).
- Prototype keys as commands: `Object.hasOwn` (server.ts:594).
- Search never reads inbound text: real.ts:832-834 and game.ts:608.
- A reveal in game does not carry to real: the key includes the mode (test staff-apps.test.ts:157).

---

## 5. Cross-machine properties for Quint

1. Review gate through the console: for all interleavings of `timeout`, `commit`, `modeSwitch`, `reveal`, `approve`, a contact implies a recorded human approval. Machines: 2.8, 2.15, network review.
2. Authorization freshness: after revocation and one good reload and one socket check, no socket and no reveal gives that person data. Machines: 2.2, 2.4, 2.5. Expect a counterexample from D03.
3. Audit first: every data release or state change has an earlier row. Machines: 2.7 wrapped around 2.5, 2.8, 2.9. Expect a counterexample from D16.
4. Age fail-closed: a read failure cannot lower a person's age state in any console output. Machines: 2.10, 2.11. Expect a counterexample from D01.
5. Projection refinement: `project(records) == oppState(stage)`. Machines: 2.13 and the network opportunity machine. Expect a counterexample from D05.
6. Forget closure: after a forget, nothing in console memory or output names that member. Machines: 2.10, the network forget path. Expect a counterexample from D07.

Suggested bounds: 2 staff, 2 apps, 2 members, 1 opportunity, 3 polls, time steps of 15 s for sockets and 60 s for reloads. Abstract tokens, JWT contents, SQL and message text. Keep `now` as an integer. Keep failures as nondeterministic booleans (`dbFails`, `serviceTimesOut`, `auditFails`, `crash`).

Modelling order by value: 2.5 and 2.2 (quick, finds D03); 2.10 and 2.11 (finds D01, D02, D04); 2.13 (finds D05, D19, D20); 2.8 with network review; 2.23; 2.21.
