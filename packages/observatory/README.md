# Observatory (staff console server)

The staff console server (`src/server.ts`) serves the console page, a REST API under `/api/*` and a WebSocket at `/ws`. It has two modes: game mode (a simulated world, `src/sources/game.ts`) and real mode (the Network's Postgres, `src/sources/real.ts`). The browser code is in `web/` and belongs to the console UI work.

```bash
pnpm run observatory [--port 4747] [--mode game|real] [--seed 1] [--personas 0] [--engine engine-v1|random|off] [--db-url postgres://...] [--days 60] [--network consent|stub] [--city nyc|all] [--level <scenario>] [--time-aware]
```

## Staff sign-in

- The server binds to `127.0.0.1` unless `OBSERVATORY_HOST` names another interface.
- Every `/api/*` route and the `/ws` upgrade need a staff identity. The page `/` and `/healthz` are public.
- Static tokens: `OBSERVATORY_TOKENS="role@app:token,token:role@app,..."` and `OBSERVATORY_TOKEN` (an `admin@*` token). A token goes only in `Authorization: Bearer <token>`, never in a URL. A token has at least 32 characters. In production every entry names its app.
- Single sign-on: `OBSERVATORY_TRUST_CF_ACCESS=1`, with `OBSERVATORY_CF_ACCESS_TEAM` and `OBSERVATORY_CF_ACCESS_AUD`. The server verifies the `Cf-Access-Jwt-Assertion` (RS256 with the team keys, audience, issuer, expiry, issue time) before it trusts the email. Roles come from `OBSERVATORY_ROLES="email:role@app,..."` and, in real mode, `platform.staff_roles` (read again every minute). With single sign-on on, the server refuses every staff token (`tokensAccepted` in [spec/staffSignIn.md](../../spec/staffSignIn.md)).
- Second factor: the server reads the `amr` claim of the verified assertion. The assertion shows a second factor only when it names `mfa` or at least two distinct methods; one method alone, such as `otp` from an emailed PIN, is not a second factor (`staffSecondFactorShown` in [spec/staffSignIn.md](../../spec/staffSignIn.md)). `/api/me` answers every accepted identity and returns `secondFactor`. Every other route and `/ws` refuse a single sign-on identity without a second factor with 403 `second_factor_required` (`identityServed` in [spec/staffSignIn.md](../../spec/staffSignIn.md)).
- The start rule (`startRefused` in [spec/staffSignIn.md](../../spec/staffSignIn.md)): a server that can read real data (real-only, or a database that is not on this machine) needs `PLATFORM_ENV` (dev, staging or production), and staging, production and remote databases need Cloudflare Access.
- The browser WebSocket cannot send a header. It asks `POST /api/ws-ticket` for a one-use ticket (30 s). Each socket keeps who opened it, gets deltas shaped for that person's roles (`src/shape.ts`), and closes with 4401 when the sign-in expires or 4403 when a role goes.
- A request with a Host that is not this machine, or a foreign Origin, is refused unless `OBSERVATORY_ALLOWED_ORIGINS` lists it.
- `OBSERVATORY_REAL_ONLY=1` (the deployed image) turns off game mode, every game control and the simulation lab.

## Apps and roles

Every route and the socket take `?app=ntwrk|slop|peon|friends` (default ntwrk). Roles are per app (`role@app` or `role@*`): admin, reviewer, safety, analyst, engineer (simulated worlds only) and cross_app_safety (`@*` only). The route and command checks come from [spec/staffPermissions.md](../../spec/staffPermissions.md). An analyst gets counts only: members carry no name, age, minor flag, under-13 decline, weekly or calendar opt-in, community, trust level or occupation.

The app list, the names, the domains and the ages come from the platform registry (`packages/platform/src/apps.ts`). A change there also changes the console. `src/apps.ts` adds only the review reason codes and the review SLA of each app.

## Commands and the mode

- A mutating request sends `x-observatory-mode`. A request for a mode that is no longer on gets 409 `mode_changed`.
- A command keeps the mode in which the server admitted it. When the mode changes while the command waits for its body or its audit row, the server writes the result row with `mode_changed` and does not run the command.
- A mode switch starts the new mode's source first. When the start fails, the server stays in its mode, and the next switch starts the source again.

## Audit

Every PII reveal, staff read of a member, timeline or opportunity, and staff action writes an audit row before the data or the action. A row that cannot be written refuses the request (503). Staff actions write a `requested` row before they run and a `result` row after. The sink is a JSONL file under `runs/audit/` by default, or the append-only table `network.staff_audit` through `OBSERVATORY_AUDIT_DATABASE_URL` (a separate writable login).

## Real mode

- The database connection is read-only (`default_transaction_read_only=on`) and issues only SELECTs. It never reads `channel_identities`.
- The server checks the login before it reads anything: read-only, a member of `network_observatory_<app>` for an app login, and never a superuser or a login that bypasses row-level security away from this machine (`loginProblem`). When the check fails with an error, nothing is read, and each poll checks the login again first.
- The console reads the app's own state view (`network.network_state_console_<app>`). A failed read of it fails the whole poll, so the last good age view and members stay. A failed read of the review items fails the poll in the same way.
- Each poll replaces the console's edges with the database's edges. A removed edge makes the next delta a `reset`, so every viewer reads the state again.
- Unless `OBSERVATORY_REVEAL_PII=1` on a local development database: names are "First L.", inbound member text never leaves the database (only its length), the agent's texts are PII-scrubbed and agent-private facets are withheld.
- Conversation search reads only the Network's own outbound messages and system events. It never returns inbound text, feedback or a relayed message (`type = 'relay'`), whose words are another member's.
- Staff actions go to the Network service's staff API (`src/sources/service.ts`) when `NETWORK_SERVICE_URL` and `NETWORK_SERVICE_TOKEN` are set, and are refused otherwise. The console sends the signed-in staff id in `X-Network-Staff-Id` and the app in `?app=` and `X-Network-App`.
- A service answer that does not come within the timeout (15 s) is `service_timeout` with status 504: the action may have run. The result audit row says `ok: false` with `outcome: "unknown"`, and the console reads the state again.
- The review card reads `GET /api/review/:id/plan?revision=` and `GET /api/review/:id/probes?revision=` (the probe, fallback and reveal copy of the open revision). Both need reviewer or safety for the app and write their audit row before the service read.
- The held items panel has two queues: `leak` (texts that the leak guard parked) and `relay` (photos that the automatic image check flagged). The relay queue has no text and accepts only a held photo id (`pri_` and 32 hex characters). A role refusal on a held item writes an audit row with ok false before the 403.
- A held relay photo preview is kept for at most five minutes on the console clock, whatever time the service token names. It is refused as expired only when its time has passed.
- Minor contacts: a teen friendship item is not counted while the teen age rule held at the message time, until the meeting end (`teenMeetingEndOf`), and teen introductions were not stopped (the `teen_intros_switch` events). The readings at the message time are this app's age events with the current birth date and bar. A minor signal recorded only in another app is not seen here. The opportunity row has no format, roles, place or meeting hours, so this count does not check the teen shape, the all-ages place or the hours; the matcher and the send-time checks enforce them, and the simulation judge counts the place and the hours. When the teen evidence cannot be read, no item is exempt and the health strip shows `teen_evidence_unreadable`.
- Matching reads as locked unless the service's last `/health` answer says `matchingAllowed: true`. No service, or a failed `/health`, is locked. The matching switch reads from the Network's stored state only.
- The hold and minor-clear answers carry `reach`: `app` when the action stayed on this app, `all` when it reached every app of the person (`staffSafetyActionReach` in [spec/staffSafetyService.md](../../spec/staffSafetyService.md)).

## Migrations

`db/migrate.ts` runs `db/migrations` in number order. The migration files have no comments. The rule of each table is in its spec story:

- 0069 photo upload links: [spec/photoUploadLink.md](../../spec/photoUploadLink.md). Only a keyed hash of the token is kept.
- 0070 privacy requests and the privacy replay: [spec/accountPrivacy.md](../../spec/accountPrivacy.md) and [spec/databaseRestore.md](../../spec/databaseRestore.md). The rows keep the keyed phone hash, never the number.
- 0072 replay of a STOP after the backup and the runner claim, and 0073 the erasure ledger: [spec/databaseRestore.md](../../spec/databaseRestore.md).
- 0074 the commit order of capital events: [spec/capitalLedger.md](../../spec/capitalLedger.md). Two events of one unit can have the same time, and their ids do not sort in emit order.
- 0075 the photo reservation: [spec/photoRetention.md](../../spec/photoRetention.md). Rows from before 0075 are stored photos.

The runner gives only a warning for a migration whose text changed after it ran. Rebuild a local database from the start after you pull migration changes.

## Staff steps

`src/staffSteps.ts` proxies the console staff steps (`/api/staff/*`) to the service's staff API with the signed-in person in `X-Network-Staff-Id`. Each step needs the role in [spec/staffPermissions.md](../../spec/staffPermissions.md) (`staffStepAdmitted`); a refusal writes an audit row with ok false before the 403. With no service configured a step answers 503 `read_only` and writes no audit row. A write writes a `requested` row before it is sent and a `result` row after. An id of `.` or `..` is refused. The steps include `POST /api/staff/inbound/resolve` (release the sender of a signed turn that did not finish) and `GET /api/staff/turn-watch` (the shared-line turn watch counts, no ids or texts), both admin for all apps. `POST /api/staff/teen-intros` (stop or resume teen friendship introductions) and `POST /api/staff/safety/older-than-stated` are safety-case steps: the service also needs admin to resume.

## Simulation lab and report

- A lab run (`src/lab.ts`) is a local simulation of The Network's NYC world, where every app may match ([spec/runtimeUnit.md](../../spec/runtimeUnit.md)). The world has no per-app join age.
- `src/report.ts` takes `--network consent|stub` and `--judge stand-in|hold-every-item`. The review judge is the simulated stand-in (no model call). With `--judge hold-every-item` the judge holds every item and nobody decides the held items, so every queued opportunity expires unsent (a check of the gate).

## Game mode projection

`src/projector.ts` turns the simulator's run records (`packages/core/src/runlog.ts`) into console state. Opportunities follow the PRD 32.10 state machine as far as the records show it, and learned edges follow PRD 32.13 (introduced, met, enjoyed, would interact again, avoid).

- A terminal opportunity stays terminal. A close of a booked plan (`opportunity_closed` on SCHEDULED) reads CANCELLED. The world can still write an outcome for that meeting: the console adds a feed line and changes no state, count or edge.
- In an outcome, a member who said no to a booked plan is not a no-show.
