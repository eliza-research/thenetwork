# Runbook: the real (non-simulated) side

This runbook covers the parts that will touch real member data: the `network` and `platform` Postgres schemas and their migrations, the read-only and audit roles, the local development database, the Network's stored state and tick lock, the production service, the Observatory's real-world mode, staff roles and the audit log, shadow engine runs, the review queue in production, and a deployment plan for later.

**Nothing is deployed.** No production database has the `network` schema yet. No real member data exists in this repository, and none may be committed.

Steps marked **[FOUNDER]** need the founder's approval before anyone does them. Steps marked **[CREDENTIALS]** need an account, a key or a password that only the founder or an admin holds. Do not do a marked step on your own.

Related: [runbook-simulation.md](runbook-simulation.md), [runbook-platform.md](runbook-platform.md) (the four apps in local dev), [observatory.md](observatory.md), [network.md](network.md), [admin-console.md](admin-console.md). PRD anchors: 31 (architecture and environments), 32.8 (review), 34.6 (shadow mode), 35 (admin console), 40 (the multi-app platform).

**Four apps, one backend.** Since 2026-10-08 the same database, service and console serve four apps: `ntwrk` (The Network), `slop`, `peon` and `friends` (friends.help; migration 0007 renamed the old `buddies` rows, PRD 40.2). Anyone 13 or older may join any app; matching is 18+ everywhere. A network id is `<app>:<city>` (`ntwrk:nyc`). Every app-scoped table has `app_id`. A person (one verified phone) can hold a membership in several apps; a member id belongs to one app.

Every command below was run on 2026-10-07 against the local development database, unless the step is marked. The migration runner, the per-app roles and the service with several networks were checked on 2026-10-08 on scratch databases.

## 1. The `network` and `platform` schemas

Five migrations define them. `bun run db:migrate` applies them in this order:

| Migration | File | What it holds |
|---|---|---|
| 0001 (baseline, repeatable) | `packages/observatory/db/schema.sql` | The `network` schema (below) |
| 0002 (baseline, repeatable) | `packages/network/db/network-state.sql` | What `PgStore` needs (below) |
| 0003 | `packages/observatory/db/migrations/0003_platform.sql` | The `platform` schema: settings, apps (the four rows), cities, networks (`<app>:<city>`, `matching_enabled`), people, phone identities (the only place a phone lives for platform members), memberships, consent events, share grants, person blocks, staff roles, audit (append-only), app lines, OTP challenges, sessions (hashed tokens), rate limits, suppression. The role `platform_service`. A trigger that refuses 555-01xx numbers in production. |
| 0004 | `packages/observatory/db/migrations/0004_network_apps.sql` | `app_id` on 13 network tables (backfilled to `ntwrk`), composite `(app_id, id)` keys, `members.person_id`, `home_city` as a foreign key to `platform.cities`, the state row `nyc` renamed to `ntwrk:nyc`, row-level security (forced) with the roles `network_observatory_<app>` and `network_service` |
| 0005 | `packages/observatory/db/migrations/0005_console_apps.sql` | `staff_audit.app_id`, one console view of the Network state per app (`network.network_state_console_<app>`), the role `network_observatory_cross_app` |
| 0006 | `packages/observatory/db/migrations/0006_platform_safety.sql` | `platform.age_floor` (the lowest age per keyed phone hash), `phone_identities.hold` (a number that may have a new owner), the SECURITY DEFINER functions `platform.person_cap_counts` and `platform.member_apps` (the two reads that span apps; the function owner must bypass row-level security, so run the migrations as a superuser or a BYPASSRLS role), and a backfill that gives The Network's members from before the platform a person, a phone and an ntwrk membership |

The two baseline files:

| File | What it holds |
|---|---|
| `packages/observatory/db/schema.sql` | The proposed canonical schema from PRD 32: members, channel identities, facets, intents, presence, edges, opportunities, participations, review items, messages, feedback, events, matching runs, requests, the Network state, the staff audit table, and the roles. Field names follow `packages/core/src/types.ts`. |
| `packages/network/db/network-state.sql` | What the Network's `PgStore` needs: `network.network_state`, `network.opportunities`, `network.participations`, `network.review_items` (with the new columns) and `network.requests`. It works before or after `schema.sql`. |

- Phones and emails live only in `network.channel_identities`.
- `network.review_items` holds one human-review record per opportunity (PRD 32.8): queued time, deadline, decision (`approve`, `reject`, `expired`), reason code, note, reviewer, and `origin`, `seconds_spent`, `edits`, `rerolls`, `invalidated`.
- `network.network_state` holds the whole Network state as one JSON document per network (section 6.2). The view `network.network_state_console` holds only the JSON paths the console reads.
- `network.requests` holds member requests: kind, category, want id, outcome, tries, opportunity. Never the member's words.
- `network.staff_audit` is append-only. Triggers refuse update, delete and truncate.
- Both files are idempotent. You can run them again on a database that has the schema.

### 1.1 Apply it

```bash
bun run db:migrate                                                   # the local dev database (starts the dev cluster)
bun run db:migrate -- --url postgres://$USER@localhost:54339/<db>    # another local database
```

The runner (`packages/observatory/db/migrate.ts`) keeps a ledger in `public.__migrations` with a checksum per migration. It runs every pending migration in one transaction, under the advisory lock `hashtext('thenetwork-migrate')`. A numbered migration runs once. A baseline (0001, 0002) runs again only when its text changes; both only create what is missing. The runner refuses a host that is not local.

Checked on 2026-10-08 on a scratch database: the first run printed `applied 0001_network_schema` to `applied 0005_console_apps`; the second run printed `"applied":[]`. `platform.networks` held `buddies:nyc`, `ntwrk:nyc`, `peon:nyc` and `slop:nyc`, with `matching_enabled` false for slop and peon. `platform.apps` held ntwrk `invite`, 13; the others `open`, 18. (History: since migration 0007 the ids are `friends` and every join age is 13; migration 0011 lets an admin turn slop and peon matching on.)

The old way still works for the two baselines (code and tests that apply them directly):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/observatory/db/schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/network/db/network-state.sql
```

A second run prints "already exists, skipping" notices and changes nothing. `PgStore.migrate()` applies `network-state.sql` only. `dev-pg.ts up` and `reset` run the migration runner (`reset` also drops the `network` and `platform` schemas and the ledger).

Checked on 2026-10-07 on a scratch local database: `network-state.sql` first, then `schema.sql`, then `network-state.sql` again. All three runs passed, and `review_items` had all 13 columns.

### 1.2 Change it (migrations)

**Caution:** `create table if not exists` does not change a table that exists. A new column, a changed check constraint or a dropped column in `schema.sql` does not reach an existing database.

Write every change as a new numbered file in `packages/observatory/db/migrations/` (`0006_<name>.sql`). Never change a numbered file after it ran anywhere: the runner records its checksum. Make each step safe to run again (`if not exists`, `do $$ ... $$` guards).

| Environment | How to change the schema |
|---|---|
| Local dev | Add the migration. Run `bun run db:migrate`. To start again, `bun run packages/observatory/db/dev-pg.ts reset`, then seed again (section 3). |
| Tests | Each Postgres test creates its own database and runs the migrations (or the baseline files) on it, then drops it. Update `packages/platform/test/db.test.ts`, which lists the expected migrations (it fails today: it stops at 0004). |
| Staging, production | **[FOUNDER]** Run `migrate.ts` as a superuser or a `BYPASSRLS` role (forced row-level security applies to the table owner). The runner refuses non-local hosts today; a deploy needs a reviewed way to run it against Railway. |

## 2. The read-only role

`schema.sql` creates `network_observatory`, a role with no login:

- `usage` on schema `network` and `select` on every table in it, now and in the future;
- no access to `network.channel_identities` (phones and emails);
- no access to `network.network_state` (full names, what members told the Network, message texts). It reads the view `network.network_state_console` instead. The view names each JSON path it passes on: the matching switch, deferred sends (member, kind, message type and opportunity, never the text), trust levels, safety cases (ids, member, level, status, times, staff id, and per event its time, kind, points and reporter), counters and gate reasons (numbers only), and per member the age state (`minor`, `ageUnknown`) and the availability opt-ins (`calendar`, `weekly`, `offerMade`). A new field in the Network state does not reach the console until someone adds it to the view.

The Observatory also sets `default_transaction_read_only = on` for each session, and only issues `select`.

**Caution:** the role still reads member data (names in `network.members`, message bodies in `network.messages`). Treat any login in this role as access to member data.

**Roles per app (migrations 0004 and 0005).** Row-level security is on and forced on every app-scoped table.

| Role | Reads or writes |
|---|---|
| `network_observatory_<app>` (`_ntwrk`, `_slop`, `_peon`, `_friends`) | Reads that app's rows only, and its own state view `network.network_state_console_<app>`. Give each app's console login this role (`OBSERVATORY_DATABASE_URL_<APP>`). |
| `network_observatory` | The original console role. Its row policies allow ntwrk only, but it can still read the shared view `network.network_state_console` for every app. Do not use it in production. |
| `network_observatory_cross_app` | The cross-app person view: memberships, blocks and the per-member facts the view shows, never a phone (`OBSERVATORY_PLATFORM_DATABASE_URL`). |
| `network_service` | The Network service: reads and writes only the app named in `set local app.app_id` for the unit of work. |
| `platform_service` | The public API: the `platform` schema. |

Superusers and `BYPASSRLS` roles skip row-level security. Never make a console login the table owner.

Until every writer sets `app.app_id`, a new row with no app gets the app in `platform.settings` `legacy_default_app` (`ntwrk`). Delete that row when every writer sets it; a write with no app then fails.

`schema.sql` also creates `network_observatory_audit`, a role with no login, for the audit log: `insert` and `select` on `network.staff_audit` only. Give it to the login in `OBSERVATORY_AUDIT_DATABASE_URL` (section 4.2) **[CREDENTIALS]**:

```sql
create role observatory_audit_writer login password '<from the secret store>' in role network_observatory_audit;
```

To give the Observatory a login **[CREDENTIALS]**:

```sql
create role observatory_reader login password '<from the secret store>' in role network_observatory;
```

Checked on a scratch local database: that login can read `network.members`, gets "permission denied" on `network.channel_identities`, and gets "permission denied" on any insert. The test `packages/observatory/test/real-console.test.ts` checks, as `network_observatory`, that `network.network_state` is refused and that the view holds only the paths above (no full name, no message text).

## 3. Local development Postgres

The local cluster runs on port **54339**. Do not use port 54329; another tool uses it.

```bash
bun run packages/observatory/db/dev-pg.ts up      # first time: initdb; then start and run the migrations on the `network` database
bun run packages/observatory/db/dev-pg.ts url     # prints postgres://$USER@localhost:54339/network
bun run packages/observatory/db/dev-pg.ts reset   # drop and recreate the network and platform schemas
bun run packages/observatory/db/dev-pg.ts down    # stop
```

- Data lives in `runs/pg` (`OBSERVATORY_PG_DIR` changes it; `OBSERVATORY_PG_PORT` changes the port).
- Code that only starts the cluster (`devPgUp()`, for example tests and `platform:dev`) no longer migrates the shared `network` database. Only `dev-pg.ts up`, `reset`, `seed.ts` and `bun run db:migrate` change it. For the platform, use a database of your own ([runbook-platform.md](runbook-platform.md)).
- It needs Postgres 16-18 (`brew install postgresql@16`). The pgvector extension is available in that install, but the schema does not use it yet.

Load data:

```bash
bun run packages/observatory/db/seed.ts --from-dataset                 # the 500 synthetic members (public files only)
bun run packages/observatory/db/seed.ts --from-sim --days 14 --seed 1  # a whole simulated run: messages, opportunities, review items, outcomes
bun run observatory:db                                                  # dev-pg up + seed --from-sim --days 14
```

**Caution:** `seed.ts` writes to the database. It refuses a host that is not local. Do not pass `--allow-remote` unless a human asks for it.

## 4. Real-world mode in the Observatory

```bash
NETWORK_DATABASE_URL=postgres://$USER@localhost:54339/network bun run observatory --mode real
```

The page shows "LOCAL DATABASE · read-only · PII scrubbed". There are no game controls. An admin can switch to game mode from the top bar, unless the server is real-only (4.3).

| Variable | Default | What it does |
|---|---|---|
| `NETWORK_DATABASE_URL` | falls back to `DATABASE_URL` | The database with the `network` schema. In production: the `network_observatory` login on a read replica. |
| `OBSERVATORY_TOKENS` | none | Role tokens: `admin:<t>,reviewer:<t>,safety:<t>,analyst:<t>`, or per app `reviewer@slop:<t>` (also `<t>:reviewer@slop`). A role with no app holds for every app (4.1). |
| `OBSERVATORY_TOKEN` | a random admin token printed at startup, when no other sign-in is set | An admin token. Set it to keep the same token across restarts. |
| `OBSERVATORY_TRUST_CF_ACCESS` | off | `1` trusts the Cloudflare Access headers (4.1). Read the warning there first. |
| `OBSERVATORY_ROLES` | none | SSO roles: `email:role@app,...` or `email:role@*` (`email:role` means `@*`). In real mode with SSO the server also reads `platform.staff_roles` every minute. |
| `OBSERVATORY_DATABASE_URL_<APP>` | none | One app's read login (a member of `network_observatory_<app>`), for example `OBSERVATORY_DATABASE_URL_SLOP`. Without it, the shared login reads that app with an `app_id` filter on every query. |
| `OBSERVATORY_PLATFORM_DATABASE_URL` | the real-mode URL | The cross-app person view's login (`network_observatory_cross_app`) |
| `OBSERVATORY_REVIEW_SLA_HOURS` | slop 6, peon 24, others 12 | The review SLA per app for the health alert, for example `slop:6,peon:24` |
| `OBSERVATORY_CF_ACCESS_TEAM` | none | The Cloudflare Access team (`<team>` or `<team>.cloudflareaccess.com`). Required with `OBSERVATORY_TRUST_CF_ACCESS=1` (4.1). |
| `OBSERVATORY_CF_ACCESS_AUD` | none | The Access application's audience tag (AUD). Required with `OBSERVATORY_TRUST_CF_ACCESS=1`. |
| `NETWORK_SERVICE_URL` | none | The Network service (6.5). With `NETWORK_SERVICE_TOKEN`, real mode sends review, safety and matching-switch actions to its staff API (4.4). Without both, real mode is read-only. |
| `NETWORK_SERVICE_TOKEN` | none | A token the service lists with the admin role in `NETWORK_SERVICE_TOKENS` **[CREDENTIALS]** |
| `OBSERVATORY_AUDIT_DATABASE_URL` | none | A writable login in role `network_observatory_audit`. Audit rows go to `network.staff_audit` (4.2). |
| `OBSERVATORY_AUDIT_DIR` | `runs/audit` | The folder of the JSONL audit file, when there is no audit database |
| `OBSERVATORY_REAL_ONLY` | off | `1` turns game mode, game commands and the lab off (4.3) |
| `OBSERVATORY_HOST` | `127.0.0.1` | The bind address. Another value prints a warning. Use it only behind an access proxy (section 7). |
| `OBSERVATORY_ALLOWED_ORIGINS` | none | Comma-separated origins allowed besides the server's own (for example the public hostname behind the proxy) |
| `OBSERVATORY_REVEAL_PII` | off | `1` shows full names, member message bodies and feedback text for everyone. **Local use only.** The server refuses it for a database that is not local, and the banner says so. |
| `OBSERVATORY_ENV_LABEL` | `LOCAL DATABASE` or `PRODUCTION DATA` | The environment banner (for example `STAGING`) |
| `PORT` | 4747 | Port (same as `--port`) |

What real mode never shows without a reveal: phones and emails (never read at all), full names (shown as "First L."), what members wrote (shown as "[member message hidden]" with length and time), feedback text, agent-private facets. Agent texts have phones, emails and canary references masked.

Real mode also reads `network.requests` and, when the Network state exists, the view `network.network_state_console` (trust levels, counters, gate reasons, safety cases, the matching switch, pending deferred sends, each member's age state and opt-ins). "Under 18" follows the Network's age state (its stored state and the `age_unknown`, `age_resolved`, `minor_signal` and `age_conflict` events), with the record age as a fallback. Minor contacts count messages about an opportunity while anyone in it was treated as under 18 at that moment.

Checked locally: without the token `/api/state` returns 401; with it, real mode lists the seeded members and opportunities.

### 4.1 Staff roles and sign-in

Roles: `admin` (everything for its app), `reviewer`, `safety`, `analyst`, `engineer` (simulated worlds only) and `cross_app_safety` (the cross-app person view only). Each role holds for one app (`reviewer@slop`) or for every app (`reviewer@*`). What each role can do: [observatory.md](observatory.md) section 9 and [admin-console.md](admin-console.md) sections 4.1 and 4.6.

1. **[CREDENTIALS]** Make one random token per role and app. Keep them in the secret store.
2. Start the server with `OBSERVATORY_TOKENS="admin@*:<t>,reviewer@slop:<t>,reviewer@friends:<t>,safety@*:<t>,analyst@*:<t>"`.
3. Give each person only the token of their role and app. A hiring reviewer never gets a slop token.

A token is a shared secret, not a personal account. The audit log shows `token:<role>#<hash>`, not a person. For named staff, use Cloudflare Access:

- Set `OBSERVATORY_TRUST_CF_ACCESS=1`, `OBSERVATORY_CF_ACCESS_TEAM=<team>`, `OBSERVATORY_CF_ACCESS_AUD=<the application's AUD tag>` **[CREDENTIALS]** and `OBSERVATORY_ROLES="ana@example.org:reviewer@slop,sam@example.org:safety@*"`. In real mode, rows in `platform.staff_roles` add roles (read every minute).
- The server verifies `Cf-Access-Jwt-Assertion` on every request: the RS256 signature with a key from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` (cached for an hour; an unknown key id fetches the keys again, at most every 30 seconds), the audience, the issuer, `exp`, `nbf` and `iat` (60 seconds of clock skew). Then it takes the email from the token. A request without a valid token gets 401. An email header that differs from the token gets 401. A token without an email (an Access service token) gets 401.
- Without the team and the audience, the server refuses to start.

Missing: a fresh sign-in before a PII reveal. A session lasts as long as the Access token: set the Access application's session duration to 12 hours or less **[FOUNDER]**.

### 4.2 Audit log

The server writes an audit row before it returns member data or does a staff action. If the write fails, the request is refused (503).

| Environment | Sink |
|---|---|
| Local | `runs/audit/audit.jsonl` (the default). Never commit `runs/`. |
| Staging, production | `network.staff_audit`, through `OBSERVATORY_AUDIT_DATABASE_URL` with a login in role `network_observatory_audit` (section 2). Use a different login from the read-only one. |

- An admin reads the log in the Config tab, or with `GET /api/audit?limit=50`.
- Staff reveal one member at a time: `POST /api/reveal {memberId, reason, minutes}` (safety role, at most 15 minutes). The reveal ends at a restart.
- Admins review the reveal log weekly (PRD 35.1).

Checked on 2026-10-07: a safety token read a member, then revealed them. `GET /api/audit` as admin returned both rows (`read_member`, then `reveal` with the reason). A reviewer token got 403 on the reveal.

### 4.3 Real-only server

Set `OBSERVATORY_REAL_ONLY=1` on every staging and production server.

- The server starts in real mode and refuses game mode (`real_only`), the game commands and the lab. It lists no levels.
- The UI hides the mode switch, the game controls and the Lab tab.
- The server never loads game mode or the scenario list: both are imported only when game mode is asked for. The deployed image has no simulator package at all (`deploy/backend/Dockerfile`; `bun run sim`, block `ops`, checks it).
- Under `PLATFORM_ENV=staging` or `production`, a real-only server refuses to start without Cloudflare Access sign-in ([deploy.md](deploy.md) 2.6). The token example below is for a local database only.

```bash
OBSERVATORY_REAL_ONLY=1 OBSERVATORY_TOKENS="admin:<t>,reviewer:<t>,safety:<t>,analyst:<t>" \
  NETWORK_DATABASE_URL=postgres://$USER@localhost:54339/network bun run observatory --port 4795
```

Checked on 2026-10-07 against the local database: the server printed "(mode: real, real only)"; `POST /api/mode` to game returned `real_only`; `GET /api/lab` returned `enabled: false`; an analyst got 403 on a member.

### 4.4 Staff actions through the Network service

Real mode never writes to the database. Review decisions, safety actions (lift a hold, close a case) and the matching switch go to the Network service's staff API (6.5).

1. Start the service (6.5) on the same database. List a console token with the admin role in `NETWORK_SERVICE_TOKENS` **[CREDENTIALS]**.
2. Start the Observatory with `NETWORK_SERVICE_URL=http://127.0.0.1:4848` and `NETWORK_SERVICE_TOKEN=<that token>`.
3. The Review tab, the Safety tab and the Config tab's matching switch now act. Each action checks the staff member's own role in the Observatory and writes the Observatory's audit rows first. The service checks its token, runs the Network's own checks under its lock, and writes `network.staff_audit` and the Network's logs.
4. A refusal shows the Network's reason (for example `not_in_review`, `matching_paused`, `already_closed`). After each action, real mode reads the database again.
5. The alerts strip shows the service's health: unreachable (bad), the last tick late (warn after 5 minutes, bad after 15), messages the channel refused or holds, and one line when all is well.

**Caution:** the service records its own token as the reviewer of record, not the person. The Observatory sends the person in the `X-Network-Staff-Id` header, the app in `?app=` and `X-Network-App`, and its own audit row names them ([admin-console.md](admin-console.md) 4.6). The service does not read the staff header yet.

Checked on 2026-10-07 (`packages/observatory/test/real-service.test.ts`): a two-day simulated run written to a test database; the real service on it; a reject from real mode reached the service with the staff id and was read back from `network.review_items`; a second decision on the same item came back `not_in_review`; a case closed and the matching switch went off through the service; with the service stopped, the strip showed `service_down` and actions answered `service_unavailable`.

## 5. Shadow engine runs

PRD 34.6: before proactive matching starts in a city, the engine runs in shadow mode on real seed data for at least two weeks, and reviewers label its proposals.

In real mode, the **Run engine (shadow)** button (or `POST /api/control` with `{"type":"shadow_run","city":"nyc"}`) does this:

1. Builds a `WorldSnapshot` from the database (read-only).
2. Runs engine-v1 with the same code as the simulator.
3. Shows the proposals as ghost arcs and in the run inspector.

It writes nothing. Checked locally: the call returned `{"ok":true,"data":{"proposals":12}}`.

Today shadow proposals are not sent to a review queue. To label them, a reviewer needs a review-queue write path (section 6).

## 6. The review queue in production

### 6.1 What exists

- The ConsentNetwork review gate: `reviewQueue()`, `decide()` (approve, reject, edit, re-roll), the re-check on approval, the matching switch, and safety `liftHold()` and `closeCase()` ([network.md](network.md) sections 2 and 6.2.1). The mode defaults to `"human"`, and the member count never changes it.
- The stored state: `PgStore`, `runTick()` and `runStored()` (6.2).
- The Observatory review screen with edit, re-roll and time spent, in game mode, and in real mode through the service (4.4).
- `network.review_items` and `network.requests`. Real mode reads them and never writes them.
- Staff roles, Cloudflare Access sign-in and the audit log (section 4).
- The production service (`packages/network/service`, 6.5): the tick loop, the inbound webhook and the staff API for review, safety and the matching switch.

### 6.2 The Network's stored state and the tick lock

`packages/network/src/store.ts`:

- `new PgStore(url, "ntwrk:nyc")` connects with Bun SQL (the default id is `ntwrk:nyc`; a legacy id `"nyc"` belongs to ntwrk). `await store.migrate()` applies `network-state.sql`. Each save sets `app.app_id` for its transaction.
- `await runTick(net, store, now)` takes `pg_try_advisory_lock(hashtext('network-tick-ntwrk:nyc'))` on one connection (one lock per network id). If another process holds it, the call returns false and does nothing. Otherwise it loads the newest `network.network_state` (on every call), runs `tick(now)`, saves, and releases the lock in `finally`.
- `await runStored(net, store, fn)` takes the same lock with `pg_advisory_lock`: it waits instead of skipping. Then it loads, runs `fn(net)` and saves. Use it for every inbound message (`n => n.onInbound(msg)`) and every staff action.
- `save()` writes the JSON and upserts `network.opportunities`, `network.participations`, `network.review_items` and `network.requests` in one transaction. It rewrites the participations of each opportunity (a re-roll changes them) and deletes rows the state no longer holds (an under-13 decline).
- The stored state never holds the review mode. A stored state cannot turn on the simulated reviewer.

**Caution:** do not call `onInbound()`, `tick()` or a staff action on the Network directly in production. Use `runTick()` or `runStored()`. A change made outside them is not saved, and the next stored unit of work loads over it.

Tested (until 2026-10-08, when the unit tests were deleted; git history at 16cde70): `packages/network/test/store.test.ts` ran save, load, row counts, row deletion, participations after a re-roll and after an under-13 decline, the lock (a second holder gets nothing), `runTick`, and two Networks on one store (a STOP survives the other's tick) against a per-process database on the :54339 cluster. Run it with `cd packages/network && bun test test/store.test.ts --timeout 300000` (it needs the local Postgres install).

### 6.3 How a reviewer works in production

**A reviewer acts on real members through the service's staff API** (6.5), from the Observatory's real mode (4.4) or directly. Nothing is deployed. A reviewer can do these things:

1. Train in game mode: `bun run observatory --review human`. Use the Review tab (Approve, Edit, Re-roll, Reject; keys in [observatory.md](observatory.md) section 7).
2. Watch real data in real mode: the review items, their decisions, edits, re-rolls, time spent and invalidations.
3. Decide in real mode with `NETWORK_SERVICE_URL` set (4.4), or directly: `GET /review`, then `POST /review/:oppId` with a reviewer token (6.5).

The flow:

1. The reviewer signs in to the Observatory through Cloudflare Access with the reviewer role (4.1).
2. The Review tab lists the items that wait, oldest first, with the SLA countdown. Real mode reads them from `network.review_items`.
3. The reviewer approves, edits, re-rolls or rejects. The Observatory checks the reviewer role and writes its own audit row, which names the person. Then it calls `POST /review/:oppId` on the service with the console token, the seconds spent, and the person in `X-Network-Staff-Id`.
4. The service checks the token's role. Under the lock, it loads the newest state and calls `decide()`. The Network runs the checks again. A refusal or an invalidated approval comes back with its reason code (HTTP 409).
5. The service writes a "requested" row and a "result" row to `network.staff_audit` and logs `review_decision`. The reviewer of record is the service token's id (`token:admin#...`), not the person (6.4 item 2).
6. The next tick (at most one minute later) sends the first probe in that member's send window ([network.md](network.md) 4.1 and 6.4). Real mode shows it after its next poll.

An item that nobody decides expires at its SLA (12 hours, or 1 hour for a same-day item). Nobody is contacted.

### 6.4 What is missing before review can work on real members

1. Built: the production matcher process and the Network admin API (6.5).
2. Built: the Observatory calls the admin API (4.4). Missing: the service must record the signed-in person, not its token, as the reviewer of record (it can take `X-Network-Staff-Id` from the console's token only).
3. Built: JWT verification for Cloudflare Access (4.1). Missing: a fresh sign-in before a PII reveal.
4. **One owner for STOP, START and HELP** on the Blooio line **[FOUNDER]** (6.5, and the warning in `packages/blooio/README.md`). With one shared line for every app (PRD 40.3), the owner must also route the first message by keyword.

Until these exist, do not connect the ConsentNetwork to a real channel.

### 6.5 The production service

`packages/network/service/` ([README](../packages/network/service/README.md)). Nothing is deployed. One process runs one network per row of `platform.networks` (`ntwrk:nyc`, `slop:nyc`, `peon:nyc`, `friends:nyc`) and serves the public API for the four sites. The deployable entry point is `deploy/backend/server.ts` ([deploy.md](deploy.md)). Local dev for everything at once: [runbook-platform.md](runbook-platform.md).

**Caution:** run it only against a database you may write to. It writes `network.network_state`, the console tables, `network.messages`, `network.events`, `network.staff_audit` and the `platform` tables (people, memberships, consent events, sessions). Do not point it at the shared dev database `network` while other work uses it. Use a database of your own on the :54339 cluster.

```bash
# One tick of every network against a scratch database (migrated as in 1.1), then exit.
PLATFORM_ENV=dev NETWORK_DATABASE_URL=postgres://$USER@localhost:54339/<your db> bun run packages/network/service/main.ts --once --dry-run

# The service: each network ticks every minute; webhooks and the staff API on 127.0.0.1:4848; the public API on 127.0.0.1:8790.
PLATFORM_ENV=dev NETWORK_DATABASE_URL=... NETWORK_SERVICE_TOKENS="admin:<t>,reviewer:<t>,reviewer@slop:<t>,safety:<t>,analyst:<t>" BLOOIO_WEBHOOK_SECRET=whsec_... \
  bun run packages/network/service/main.ts
curl -H "Authorization: Bearer <reviewer token>" http://127.0.0.1:4848/review                       # The Network
curl -H "Authorization: Bearer <reviewer@slop token>" 'http://127.0.0.1:4848/review?app=slop'      # or /apps/slop/review
curl -X POST -H "Authorization: Bearer <reviewer token>" -d '{"decision":"approve","secondsSpent":40}' http://127.0.0.1:4848/review/<oppId>
curl -H "Authorization: Bearer <any token>" 'http://127.0.0.1:4848/health?app=slop'
```

The service checks that the schemas exist at start. It does not migrate. It reads `platform.networks` and `platform.apps` at start. Options: `--once` (one tick of every network, deliver, exit), `--dry-run` (always the dry-run adapter), `--port N`, `--host H`, `--api-port N`. Without `--once` each network ticks every minute (fixed) and the service serves HTTP.

Checked on 2026-10-08 on a migrated scratch database: `--once --dry-run` printed one line per network (`network slop:nyc: sends dry-run, review "human", matching not allowed (platform.networks)`; ntwrk and friends (then `buddies`) `matching allowed (the admin switch decides)`), warned that `NETWORK_SERVICE_TOKENS` and `BLOOIO_WEBHOOK_SECRET` were not set, and printed `tick done` for all four networks.

| Variable | Default | What it does |
|---|---|---|
| `NETWORK_DATABASE_URL` | `DATABASE_URL` | Postgres with the `network` and `platform` schemas. A login that can read and write them (`network_rw`, 7.2). Required. |
| `NETWORK_SERVICE_TOKENS` | none | Staff role tokens, `admin:<t>,reviewer:<t>,safety:<t>,analyst:<t>` (the Observatory's scheme), or per app `reviewer@slop:<t>`. Without them, every staff route answers 401. **[CREDENTIALS]** |
| `NETWORK_SERVICE_AUDIT_DATABASE_URL` | the database URL | The login that writes `network.staff_audit` |
| `NETWORK_SERVICE_HOST`, `NETWORK_SERVICE_PORT` | `127.0.0.1`, `4848` | The bind address. Another host prints a warning. |
| `NETWORK_SERVICE_INSTANCE` | the process id | The instance name, shown as the lock holder in `/health` |
| `NETWORK_SEED` | 1 | The seed of the Network's own random choices |
| `BLOOIO_WEBHOOK_SECRET` | none | Checks the `X-Blooio-Signature` of the shared line's webhook (`/webhooks/blooio`). Without it, that webhook answers 503. **[CREDENTIALS]** |
| `<APP>_BLOOIO_WEBHOOK_SECRET` | none | One app's line (`/webhooks/blooio/<app>`), for example `SLOP_BLOOIO_WEBHOOK_SECRET`. Without it, that path answers 503. **[CREDENTIALS]** |
| `NETWORK_CHANNEL` | dry-run | `blooio` uses the Blooio adapter. `--dry-run` always wins. |
| `BLOOIO_API_KEY`, `BLOOIO_FROM` | none | The Blooio key and the sending line (E.164; `BLOOIO_FROM_NUMBER` is an alias). Needed with `NETWORK_CHANNEL=blooio`. **[CREDENTIALS]** |
| `BLOOIO_ALLOW_SEND`, `NTWRK_LIVE_APPROVED`, `<APP>_LIVE_APPROVED` | off | The live-send gate (below) **[FOUNDER]** |
| `PLATFORM_API_PORT` | 8790 | The public API for the sites (`--api-port`) |
| `PLATFORM_STOP_SCOPE`, `PLATFORM_HASH_KEY`, `OTP_PROVIDER`, `TWILIO_*`, `TURNSTILE_SECRET_KEY`, `NODE_ENV`, `PLATFORM_ENV` | see [runbook-platform.md](runbook-platform.md) section 5 | STOP scope, the hash key (required in production), web login codes, bot check, production mode **[CREDENTIALS]** for the keys |

**Live sends.** **Warning:** a live send texts a real phone. Do not set both flags without the founder's approval for that exact launch.

- The default adapter is dry-run: each message is stored in `network.messages` with status `dry_run`. Nothing leaves the machine.
- `NETWORK_CHANNEL=blooio` uses the Blooio adapter: the prototype's `OutboundQueue` with `blooioRecipientPolicy` and `forbiddenProvider` ([network.md](network.md) 6.5).
- The Blooio adapter reads the flags on every delivery. It refuses every send (`refused_not_approved`, no provider call) unless `BLOOIO_ALLOW_SEND=1` and `NTWRK_LIVE_APPROVED=1` are both set, and, for an app other than ntwrk, its own `<APP>_LIVE_APPROVED=1` (`SLOP_LIVE_APPROVED`, `PEON_LIVE_APPROVED`, `BUDDIES_LIVE_APPROVED`). One flag alone, or any value but `1`, refuses.
- A person cap holds across apps: at most 3 proactive messages a day for one person. A send over it gets `refused_person_cap`.
- At start the service prints the send mode: `dry-run`, `blooio (refusing: ...)` or `blooio LIVE`.

Staff API (send `Authorization: Bearer <token>`; admin for an app passes every role check for it). Name the network with `?app=<app>` (and `&city=`) or `/apps/<app>/<route>`; without it, the route is The Network's. A token holds a role for one app (`reviewer@slop`) or every app (`reviewer`):

| Route | Role | What it does |
|---|---|---|
| `GET /health` | any | Last tick, lock holder, matching switch, backlog (review, overdue, deferred, waiting sends), refusals |
| `GET /review` | reviewer, safety | The review queue, oldest first |
| `POST /review/:oppId` | reviewer | `{decision: "approve" \| "reject" \| "edit" \| "reroll", reason?, note?, secondsSpent?, explanations?, objective?, swapOut?}` |
| `POST /safety/lift` | safety | `{memberId, note?}` |
| `POST /safety/close` | safety | `{caseId, note?}` |
| `POST /matching` | admin | `{on: true \| false}`. 409 `matching_not_allowed` for a network that `platform.networks` keeps off (slop, peon). |
| `POST /webhooks/blooio` | Blooio signature | The shared line: routed by `platform.app_lines`, then a keyword, then the member's app, then The Network. Bad signature 401, bad JSON 400, no secret 503. |
| `POST /webhooks/blooio/<app>` | that app's signature | One app's line |
| `/review-mode` | none | Always 404 |

- A refused action answers 409 with the Network's reason (for example `not_in_review`, `matching_paused`, `participant_minor`).
- Every staff action writes a "requested" row and a "result" row to `network.staff_audit`, and the Network logs it (`review_decision`, `safety_action`, `matching_switch`).
- A new stored state starts with matching off. An admin turns it on with `POST /matching {"on": true}` **[FOUNDER]** (7.4 check 8).
- The review mode is not exposed. The service refuses to start with any mode but "human".
- `/health` is for the heartbeat alert (PRD 35.2). Use the analyst token for the monitor.
- STOP, STOP ALL, START and HELP: the service answers them through the platform consent ledger (`platform.consent_events`) with the app's own texts. STOP on one app's line stops that app (`PLATFORM_STOP_SCOPE=app`, the default); STOP on the shared line and STOP ALL stop every app. Each one also sets `network.members.opted_out` and pauses the membership. "leave <app>" leaves one app. The one word "cancel" is a STOP keyword. The founder must decide which system owns keywords on the Blooio line (6.4 item 4).

Checked on 2026-10-07 on a scratch local database: `--once --dry-run` ticked and saved the state. In service mode, a signed webhook from a seeded member got a `dry_run` welcome row, `/review-mode` answered 404, and `GET /review` wrote a `read_review_queue` row to `network.staff_audit`.

Checked again on 2026-10-07, later, on a new scratch database (both schema files, then dropped): `--once --dry-run` printed `sends dry-run, review "human"` and `tick done`. In service mode on port 4861: `/health` with no token gave 401 and with the analyst token gave `matchingEnabled: false` and the backlog; `GET /review` with the analyst token gave 403 and with the reviewer token `{"ok":true,"items":[]}`; `/review-mode` gave 404; `POST /matching {"on":true}` as admin gave `{"ok":true}`; an unsigned webhook gave 401.

## 7. Deployment plan (for later)

**Do not deploy anything now.** This is the plan for when the founder approves a deploy.

Decision first **[FOUNDER]**: PRD 31 says the Network is built inside Eliza Cloud (Cloudflare Workers, Railway Postgres through Hyperdrive). The plan below is a standalone stack on Railway and Cloudflare under `ntwrk.love`. It uses the same pieces (Railway Postgres, a Railway matcher worker, a Cloudflare Worker with Hyperdrive), so most steps carry over if the founder picks the Eliza Cloud path.

### 7.1 Before any deploy (code work)

| # | Work | Owner area | Status |
|---|---|---|---|
| 1 | Persist all ConsentNetwork state in the `network` schema; make the tick resumable | `packages/network`, schema | Built: `PgStore`, `runTick()` (6.2) |
| 2 | A production entry point for the matcher: `runTick()` on a schedule, and `runStored()` for inbound messages and staff actions | `packages/network` | Built: `packages/network/service/main.ts` (6.5). Not deployed. |
| 3 | A migration runner and a ledger (section 1.2). The service checks the tables at start and does not migrate. | schema | Built: `bun run db:migrate` (local hosts only). A reviewed way to run it against staging and production is missing. |
| 4 | The Network admin API for review decisions, the matching switch and safety actions, with staff auth and an audit row (section 6.4) | `packages/network/service` | Built (6.5), with the Observatory's role tokens and `network.staff_audit`. The Observatory's real mode calls it (4.4). |
| 5 | Leak check on the Blooio send path. The queue runs the leak guard; pass `forbiddenProvider(net, memberOf)` from `@thenetwork/network` as its `forbiddenProvider` and `blooioRecipientPolicy(net, memberOf)` as its `recipientPolicy` ([network.md](network.md) 6.5). | `packages/blooio`, the entry point | Wired in the service's `BlooioAdapter` (6.5). Tested with a fake provider only. |
| 6 | A server flag that turns off game mode in the Observatory | `packages/observatory` | Built: `OBSERVATORY_REAL_ONLY=1` (4.3) |
| 7 | Age at join. A member with no age is no longer declined: the Network asks once and treats them as a minor until they answer ([network.md](network.md) section 6.3). An age at join still avoids that. | onboarding | Open |
| 8 | JWT verification for Cloudflare Access (4.1) | `packages/observatory` | Built |
| 9 | The service records the signed-in person as the reviewer of record (it reads `X-Network-Staff-Id` from the console's token only) | `packages/network/service` | Missing (6.4 item 2) |
| 10 | One owner for STOP, START and HELP on the Blooio line (6.4 item 4) | service, Eliza Cloud | **[FOUNDER]** Open |
| 11 | The four apps: the `platform` schema, `app_id` and row-level security, one service for every network, the public API, the four sites ([runbook-platform.md](runbook-platform.md)) | platform, service, sites, schema | Built, local only. Not deployed. |
| 12 | Rename `buddies` to `friends` and allow 13+ to join every app (PRD 40.2, 40.3) | platform, schema, sites, obs | Done (migration 0007, 2026-10-08) |
| 13 | Route `/api/*` on each app domain to the shared API (a zone route, or a service binding with `run_worker_first`) | sites, ops | **[FOUNDER]** Missing |
| 14 | Logins for the per-app roles (`network_observatory_<app>`, `network_observatory_cross_app`, `network_service`, `platform_service`) | ops | **[CREDENTIALS]** The SQL is in [deploy.md](deploy.md) 2.1 (service) and 2.6 (console). Not created yet. |
| 15 | Monitoring, alerts and a cost ledger with budgets | `deploy/backend/ops.ts`, `packages/network/service/cost.ts` | Built ([deploy.md](deploy.md) section 7). The webhook and the uptime monitor need an account **[CREDENTIALS]**. |
| 16 | Daily dump to R2 and a restore drill | `deploy/backup/` | Built ([deploy.md](deploy.md) section 8, section 8 below). The bucket and the cron service are not created yet **[CREDENTIALS]**. |

### 7.2 Railway

1. **[FOUNDER] [CREDENTIALS]** Create (or choose) the Railway project. Create a `staging` environment and a `production` environment. Do every step in staging first.
2. Add a Postgres service.
3. Enable pgvector: `create extension if not exists vector;` (PRD 32.4 uses pgvector HNSW for embeddings).
4. Apply the schema (section 1.1, both files), then run the migrations.
5. **[CREDENTIALS]** Create the logins and keep the passwords in Railway variables only:
   - `network_rw` for the matcher worker, in roles `network_service` and `platform_service` (section 2);
   - one console login per app, in role `network_observatory_<app>`, and one in `network_observatory_cross_app` (section 2);
   - an admin login (superuser or `BYPASSRLS`) for migrations only.
6. Turn on daily backups: the Railway volume backups and the R2 dump ([deploy.md](deploy.md) section 8). **[FOUNDER]** Run the restore drill (section 8 below) before launch (PRD 28.5 gate: "backup restore tested").
7. Add a read replica if the plan allows it. Point the Observatory at the replica (PRD 31.4: analytics never read the primary at peak).
8. **Matcher worker service (`network-matcher`).**
   - Build from this repository with Bun.
   - Start command: `bun run packages/network/service/main.ts` (6.5), with `NETWORK_SERVICE_HOST=0.0.0.0` only behind the access proxy.
   - Each tick, for each network: `runTick(net, new PgStore(DATABASE_URL, "<app>:<city>"), now)`. It takes `pg_try_advisory_lock(hashtext('network-tick-<app>:<city>'))`. If the lock is held, the tick is skipped. Each inbound message and staff action: `runStored(net, store, fn)`, which waits for the same lock. Every call loads the newest stored state before it runs and saves after, so two instances run one unit of work at a time and never overwrite each other's saves.
   - The service ticks every minute (fixed in `main.ts`). The engine runs once a day inside the tick (09:00 New York). Initial invites and asks go in each member's send window (12:00 New York plus up to 2 hours of spread, open for 6 hours, or a time learned from their replies), so the one-minute tick keeps sends close to the slot ([network.md](network.md) 6.4).
   - Run one replica first. A second replica is safe (the lock), but each replica has its own in-memory Blooio queue.
   - Sends stay dry-run. Live Blooio sends need `NETWORK_CHANNEL=blooio`, `BLOOIO_ALLOW_SEND=1`, `NTWRK_LIVE_APPROVED=1` and the app's `<APP>_LIVE_APPROVED=1`, and the founder's approval **[FOUNDER]** (6.5).
   - The platform variables: `PLATFORM_HASH_KEY` (required with `NODE_ENV=production`), `OTP_PROVIDER=twilio` with the Twilio Verify credentials, `TURNSTILE_SECRET_KEY`, `PLATFORM_STOP_SCOPE` **[CREDENTIALS]** ([runbook-platform.md](runbook-platform.md) section 5).
   - Variables (6.5): `NETWORK_DATABASE_URL` (the `network_rw` login), `NETWORK_SERVICE_TOKENS` (one token per role, plus the console token with the admin role) **[CREDENTIALS]**, `NETWORK_SERVICE_AUDIT_DATABASE_URL` (optional), `BLOOIO_WEBHOOK_SECRET`, `BLOOIO_API_KEY` and `BLOOIO_FROM` **[CREDENTIALS]**, `SURPLUS_API_KEY` and `OPENAI_API_KEY` **[CREDENTIALS]** (gpt-6-luna for every LLM use; the Network calls the engine without an LLM today).
   - Review mode stays `"human"` (the default). Never set `"auto"` outside the simulator.
   - `/health` reports the last tick, the lock holder, the backlog and the refusals, for the heartbeat alert (PRD 35.2). It needs a staff token.
9. **Observatory service.**
   - Start command: `bun run packages/observatory/src/server.ts --mode real`, with `OBSERVATORY_REAL_ONLY=1` (4.3).
   - Variables: `NETWORK_DATABASE_URL` (a read login on the replica), `OBSERVATORY_DATABASE_URL_<APP>` (each app's read login) and `OBSERVATORY_PLATFORM_DATABASE_URL` (the cross-app login), `NETWORK_SERVICE_URL` (the matcher service's private address) and `NETWORK_SERVICE_TOKEN` (4.4) **[CREDENTIALS]**, `OBSERVATORY_TOKENS` with one token per role **[CREDENTIALS]**, `OBSERVATORY_AUDIT_DATABASE_URL` (the `observatory_audit_writer` login on the primary, section 2) **[CREDENTIALS]**, `OBSERVATORY_HOST=0.0.0.0` (the container must listen on all interfaces; it is safe only behind Access, step 7.3.3), `OBSERVATORY_ALLOWED_ORIGINS=https://observatory.ntwrk.love`, `OBSERVATORY_ENV_LABEL=STAGING` in staging, `NODE_ENV=production`.
   - Never set `OBSERVATORY_REVEAL_PII`. For named staff, set `OBSERVATORY_TRUST_CF_ACCESS=1` with `OBSERVATORY_CF_ACCESS_TEAM` and `OBSERVATORY_CF_ACCESS_AUD` (4.1): a request without a valid Access token is refused.
   - Do not give the service a public Railway domain. Reach it only through Cloudflare (7.3).

### 7.3 Cloudflare

Use `scripts/wrangler.sh` for every Wrangler command. It runs as the ntwrk.love account and refuses commands that change Cloudflare resources unless `NTWRK_ALLOW_DEPLOY=1` is set.

**Caution:** Do not set `NTWRK_ALLOW_DEPLOY=1` without the founder's approval for that exact deploy. Checked: `bash scripts/wrangler.sh deploy` without it exits with code 3 and deploys nothing.

1. **[CREDENTIALS]** Log in once: `XDG_CONFIG_HOME=$HOME/.config/wrangler-ntwrk npx wrangler login`.
2. **The public webhook path.** The service already takes the Blooio webhook (`POST /webhooks/blooio`, signature checked) and serves the staff API (6.5). Only the webhook may be public.
   - **[FOUNDER]** Pick one: a Cloudflare route (or a Worker) that forwards only `POST /webhooks/blooio` on `api.ntwrk.love` to the matcher service, or a Worker that verifies the signature, answers STOP and HELP, and writes through Hyperdrive. The first reuses the tested service code. The second needs new code.
   - The staff API stays private: the Observatory reaches it on the Railway private network (`NETWORK_SERVICE_URL`). Never route `/review`, `/safety/*`, `/matching` or `/health` through a public hostname.
   - Only for the Worker option: database access through Hyperdrive to the Railway Postgres. **[FOUNDER] [CREDENTIALS]** `scripts/wrangler.sh hyperdrive create ...` with the `network_rw` connection string.
   - Check the build: `scripts/wrangler.sh deploy --dry-run`.
   - **[FOUNDER]** Deploy: `NTWRK_ALLOW_DEPLOY=1 scripts/wrangler.sh deploy`, staging first.
   - Secrets (Blooio keys, webhook secret): **[FOUNDER] [CREDENTIALS]** `NTWRK_ALLOW_DEPLOY=1 scripts/wrangler.sh secret put <NAME>`.
3. **Cloudflare Access in front of the Observatory.** **[FOUNDER] [CREDENTIALS]**
   - Create an Access application for `observatory.ntwrk.love` (and `observatory-staging.ntwrk.love`).
   - Policy: named staff emails only, with a second factor. No bypass rules. No service tokens.
   - Access is the first sign-in. On Railway, the Observatory role tokens are the second check (4.1).
   - Named staff sign-in (`OBSERVATORY_TRUST_CF_ACCESS=1`) verifies the Access JWT against the team's keys and the application's AUD (4.1). With it on, the server takes the email from the verified token and does not ask for a role token.
4. **DNS on ntwrk.love.** **[FOUNDER]**
   - `observatory.ntwrk.love`: a proxied CNAME to the Observatory service's Railway target (Railway custom domain). Proxied, so Access applies.
   - `api.ntwrk.love`: a Worker custom domain or route, through `scripts/wrangler.sh` (the guard refuses it without `NTWRK_ALLOW_DEPLOY=1`).
   - Do not touch `mcp.ntwrk.love`. Connectors are not in the MVP (PRD 28.4).
5. **The app sites.** **[FOUNDER]** Each site (`sites/<domain>`) is a Cloudflare Pages project (founder decision 8: `ntwrk-love`, `slop-date`, `peon-biz`, `friends-help`). Check a build with `bun run sites/sites.ts` (it writes `sites/<domain>/dist` with `_worker.js` and `_routes.json`). slop.date deploys first; all four are deployed this round by the coordinator ([deploy.md](deploy.md) section 3). `/api/*` on each site reaches the shared API through the signed router.

### 7.4 Go-live checks

Do these in staging, then in production. Each one is a PRD 28.5 launch gate or follows from one.

1. Shadow mode for at least two weeks on real seed data (PRD 34.6). Reviewers label shadow proposals. No member is contacted.
2. The review queue is enforced: a test opportunity waits as queued, and nobody is contacted before approval. An item past its SLA expires unsent.
3. Every outbound path runs the leak check.
4. STOP, HELP, block and report work on every channel.
5. At least 40 committed NYC seed members before proactive matching is turned on **[FOUNDER]**.
6. Simulated traffic is forbidden in production (PRD 31.5). The production service refuses `review: "auto"` at start and does not expose the review mode (6.5). The Observatory runs with `OBSERVATORY_REAL_ONLY=1`.
7. The audit log is on Postgres (`network.staff_audit`), and an admin can read it.
8. For check 5, start the Network with matching off (the service's default for a new stored state). Turn matching on only after the founder approves **[FOUNDER]**.
9. Per app: the app's `<APP>_LIVE_APPROVED` stays unset until the founder approves that app's launch. slop and peon matching stays off (`platform.networks`) until their engine packs pass their gates (PRD 40.8).
10. A test phone joins two apps; STOP on the shared line stops both; leaving one app keeps the other; export and delete work per app ([runbook-platform.md](runbook-platform.md) section 3).

### 7.5 Roll back

- Matcher: stop the Railway service. Nothing is sent while it is stopped. Queued items expire at their SLA instead of being sent late.
- Worker: **[FOUNDER]** `NTWRK_ALLOW_DEPLOY=1 scripts/wrangler.sh rollback`.
- Database: restore the last backup into a new database (section 8.3), then repoint the services. Never restore over the primary.

## 8. Backups, the restore drill and alerts

The jobs and their variables are in [deploy.md](deploy.md) sections 7 and 8. This section says what a person does.

### 8.1 What is backed up

| Backup | Where | How often | Kept |
|---|---|---|---|
| Railway volume backup | Railway → Postgres → Backups | Daily (Railway's schedule) | Railway's retention |
| Logical dump (`deploy/backup/backup.ts`) | The private R2 bucket `ntwrk-backups`, `postgres/<env>/<UTC time>/` | Daily at 07:15 UTC (cron service `backup`) | 35 days (bucket lifecycle rule) |

Each dump has `manifest.json`: the exact row count of every table, taken in the same snapshot as the dump.

### 8.2 The restore drill (monthly, and before launch) **[CREDENTIALS]**

Do this once before the first real member joins, then on the first working day of each month. Write the result in the incident log.

**Caution:** the dump holds member data. Restore it only into a new scratch database on the Railway Postgres service (or a local cluster that only you can reach). Never into the live database. Never on a laptop that is not encrypted.

1. Pick the newest backup. Railway → service `backup` → the last run's log shows `"msg":"backup uploaded"` with its `prefix`.
   - The restore needs to reach the Postgres server. Either run it inside Railway (`railway ssh` into the `backup` service, which has the client tools), or turn on the Postgres TCP proxy for the drill and turn it off again after step 6 ([deploy.md](deploy.md) 2.1). Locally you need the Postgres client of the server's major version.
2. Restore it into a new database with a dated name, and check the row counts:

   ```bash
   RESTORE_DATABASE_URL=<the owner URL, from Railway> BACKUP_R2_ACCOUNT_ID=... BACKUP_R2_BUCKET=ntwrk-backups \
   BACKUP_R2_ACCESS_KEY_ID=... BACKUP_R2_SECRET_ACCESS_KEY=... BACKUP_PREFIX=postgres/production \
     bun run deploy/backup/restore.ts --r2 latest --db restore_drill_$(date -u +%Y%m%d)
   ```

3. Pass: the last line is `"msg":"restore checked"` with `"mismatches":0`, and the exit code is 0. Write down the backup time, the tables, the rows and the time the restore took.
4. Spot check in the scratch database: `select count(*) from platform.people;`, `select max(saved_at) from network.network_state;` (close to the backup time), `select id, applied_at from public.__migrations order by applied_at desc limit 3;` (the current migrations).
5. Also restore the newest Railway volume backup once a quarter (Railway → Postgres → Backups → Restore, into a new service), and run the same spot checks.
6. Drop the scratch database: `drop database restore_drill_<date>;`. Delete any downloaded file.
7. Fail: open an incident. Until a drill passes, a new member wave waits **[FOUNDER]**.

`bun run sim` (block `ops`) runs the same backup and restore against a seeded database on the dev Postgres (`:54339`) as a tracked gate, so a change that breaks the scripts shows up before a drill.

### 8.3 Restore for real (data loss or corruption) **[FOUNDER]**

1. Stop the backend's ticks: set the `backend` service's replicas to 0. Nothing is sent while it is stopped.
2. Restore into a new database, as in 8.2 step 2, with `--db network_restored_<date>`. Pick the backup from before the problem (`--r2 postgres/production/<UTC time>`).
3. Check: `"mismatches":0`, and the spot checks of 8.2 step 4.
4. In the restored database, create the service and console logins again only if they do not exist on that server (the dump keeps the roles without passwords). Set new passwords and update the variables.
5. Point `NETWORK_DATABASE_URL`, `MIGRATION_DATABASE_URL` and the console's URLs at the restored database. Start the backend (replicas 1). The boot log must show `applied: 0` (or only the migrations newer than the backup).
6. Write down what was lost: everything after the backup time. Members who wrote in that window may need a reply by hand.

### 8.4 When an alert arrives

| Alert | First step |
|---|---|
| Uptime monitor down, or heartbeat missing | Railway → `backend` → Deployments and logs. A crash loop: roll back (deploy.md 2.7). A database error: Railway → Postgres. |
| `tick_late:<network>` | The deploy log: `tick failed` lines, or `tick skipped: another instance holds the lock` with no tick stored (a stuck replica holds the lock: restart that replica). |
| `send_failures:<network>` | `/ops/metrics` shows the outcomes. Check Blooio's status and the line's health. Over 2% for a day is a pause condition in the pilot (mvp-plan). |
| `review_sla:<network>` | Open the console's Review tab for that app. Items past the SLA expire unsent; nobody was contacted. |
| `safety_minor:<network>` or an urgent `safety_report` | The safety on-call opens the console's Safety tab now. Hold first, then decide (admin-console.md 3.7.1). |
| `queue_outbound` or `queue_review` | Check the review staffing, and Blooio for held or deferred messages. |
| Backup heartbeat missing (`BACKUP_HEARTBEAT_URL`) | Railway → `backup` → the last run's log: `"msg":"backup failed"` gives the step. Run the job again by hand (Railway → `backup` → Deploy). Two days without a backup: tell the founder. |
| `budget:*` | The console's Metrics → Cost panel shows which kind grew. Tell the founder at 100%. |

