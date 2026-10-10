# Deploy: the shared backend on Railway and the four sites on Cloudflare Pages

This is how The Network goes online. Read it with [runbook-platform.md](runbook-platform.md) (local dev) and [runbook-real.md](runbook-real.md) (the real network and its gates). The coordinator deploys. Nobody turns on live sends from this document: section 6 keeps them off.

**User decisions this round (2026-10-08).**

- All four sites are deployed: ntwrk.love, slop.date, peon.biz and friends.help.
- **Hosting (founder decision 8, AGENTS.md; it supersedes "Workers static assets").** Each site is a classic Cloudflare Pages project in the ntwrk.love Cloudflare account (`CLOUDFLARE_ACCOUNT_ID`): `ntwrk-love`, `slop-date`, `peon-biz`, `friends-help` (production branch `main`, served on `<project>.pages.dev`). The forwarding of `/api/*`, `/mcp`, `/oauth/*` and `/.well-known/oauth-*` to the shared backend is an advanced-mode `_worker.js` that the build makes from `deploy/router.ts`, with `_routes.json` so only those paths run it.
- The shared backend is one process on Railway: `https://api.ntwrk.love`.
- slop.date and friends.help stay in the Eliza Labs Cloudflare account for 10 days; their DNS points at the `slop-date.pages.dev` and `friends-help.pages.dev` projects. Every config takes the account id from the environment (`CLOUDFLARE_ACCOUNT_ID`), default the ntwrk.love account.
- The backend treats each project's production name (`<project>.pages.dev`) as a host of its app (packages/platform `siteHosts`): the Origin check and Turnstile accept it, so a site works there before its own domain points at it. Preview deployments (`<hash>.<project>.pages.dev`) are not hosts.

## 1. What runs where

| Part | Where | Code | Public? |
|---|---|---|---|
| Sites (4 Pages projects) | Cloudflare Pages, one project per site, advanced-mode `_worker.js` | `sites/<domain>/wrangler.toml`, `deploy/router.ts`, `sites/sites.ts` | Yes, on `<project>.pages.dev` and each site's domain |
| Shared backend | Railway service `backend` | `deploy/backend/` (`server.ts` wraps `packages/network/service`) | Port `PORT` on `api.ntwrk.love`. The staff port is private. |
| Postgres | Railway Postgres | migrations in `packages/observatory/db/` | No (private network only) |
| Observatory console | Railway service `observatory` | `packages/observatory`, `deploy/backend/observatory.railway.toml` | Only through Cloudflare Access |
| Backup job | Railway cron service `backup` (daily) | `deploy/backup/` | No. It writes to a private R2 bucket. |

The backend process has two listeners:

| Listener | Bind | Paths |
|---|---|---|
| Public, `PORT` (8790) | `0.0.0.0` when `PLATFORM_ENV` is `staging` or `production`; `127.0.0.1` otherwise | `/api/*` (the platform public API), `/webhooks/blooio[/<app>]` (Blooio, signature checked), `/consent/gateway` (the STOP/HELP gateway's signed consent reports; 409 unless `STOP_HELP_OWNER=gateway`), `/mcp`, `/oauth/*`, `/.well-known/oauth-*` (the MCP server, packages/mcp, mounted by `server.ts`; 404 `mcp_not_enabled` when `TURNSTILE_SITE_KEY` is not set), `/healthz` |
| Staff, `STAFF_PORT` (4848) | `::` when deployed (Railway's private network may be IPv6 only); `127.0.0.1` otherwise | The staff API: `/health`, `/review`, `/safety/*`, `/matching`, `/holds`, `/invite`, `/apps/<app>/...`. Never on the public port. |

How a site request reaches the backend:

1. The visitor calls `https://slop.date/api/app`.
2. The slop.date Pages Worker (`_worker.js`) removes any proxy headers the client sent and signs new ones with `PLATFORM_PROXY_SECRET`: the visitor IP, the site host, and a timestamp (`packages/platform/src/proxy.ts`).
3. It forwards the request to `https://api.ntwrk.love/api/app`.
4. The backend checks the signature and the timestamp (60 s window) with `verifyProxyHeaders`. If they are valid and the host is a known site, the request's `Host` becomes `slop.date`, and that picks the app. The signed IP is used for the rate limits.
5. Any other request loses every proxy and forwarding header. Deployed (`PLATFORM_ENV` staging or production), an unsigned request to `/api/*`, `/mcp` or `/oauth/*` gets **421 `edge_required`**: a client that calls the origin directly never picks the app or the rate-limit bucket, whatever `Host` it sends.

## 2. Railway: the backend

### 2.1 Project and database (once)

1. In Railway, create a project named `the-network`. Create two environments: `production`, and `staging` (optional, but needed for previews).
2. Add a database: **New → Database → PostgreSQL**. Railway names it `Postgres` and exposes `DATABASE_URL` on the private network.
   - The migrations create roles (`network_service`, `platform_service` and others), so they run as Railway's default `postgres` user (a superuser): `MIGRATION_DATABASE_URL`.
   - **The service never runs as that user** (audit: a superuser skips row-level security and every grant). Once, after the first migration, create the service login and give it the role:

     ```sql
     create role network_backend login password '<32+ random characters>' nosuperuser nobypassrls nocreaterole nocreatedb;
     grant network_service to network_backend;
     grant connect on database railway to network_backend;
     ```

     `NETWORK_DATABASE_URL` is that login. At boot, `server.ts` refuses to start when the service login is a superuser, has BYPASSRLS, or owns (or is a member of the owner of) a `platform` or `network` table.
   - Turn on backups for the Postgres volume (Railway Pro), and add the daily dump to R2 (section 8). Do both before the first real member joins, and run one restore drill (runbook-real.md section 8).
3. Do not enable Postgres's public TCP proxy. If someone needs it for a one-off task, turn it on, do the task, and turn it off again.

### 2.2 The backend service

1. **New → GitHub Repo →** this repository. Name the service `backend`.
2. Open **Settings → Config-as-code** and set the path to `/deploy/backend/railway.toml`. That file sets:
   - the Dockerfile builder (`deploy/backend/Dockerfile`);
   - the health check `/healthz` (120 s, so the first boot can apply every migration);
   - a restart on failure;
   - 30 s of draining after SIGTERM;
   - watch paths.
3. Deploys:
   - In **Settings → Source**, set the branch to `main`.
   - Turn on **Wait for CI**, so that `ci.yml` must pass first.
   - For production, see section 4: the founder approves each production deploy.
4. Leave the replica count at 1 for now. More replicas are safe: each network ticks under its own advisory lock, and migrations run under the migration lock. But one replica makes logs and incidents simpler.

**The image** (`deploy/backend/Dockerfile`):

- Base: `oven/bun:1.4.2-slim`, pinned by its index digest. The repo tests with Bun 1.4.2.
- `bun install --frozen-lockfile --production --ignore-scripts`. The runtime has no npm dependencies of its own; this only links the workspaces.
- Runs as the image's `bun` user (uid 1000), never root.
- `CMD ["bun", "run", "deploy/backend/server.ts"]` in exec form, so Bun is PID 1 and gets SIGTERM itself.
- `Dockerfile.dockerignore` sits next to the Dockerfile. BuildKit reads it, so the build context holds only `package.json`, `bun.lock`, `tsconfig.json`, `packages/`, `prototypes/` and `deploy/`, and never `.env`. **Verify:** on the first Railway build, check that the build log shows a context of a few MB, not the whole repo. If Railway ignores the file, add the same rules to a root `.dockerignore`.

**What `server.ts` does at boot:**

1. It checks the environment. A deployed environment without its secrets does not start; the log names what is missing.
2. It applies pending migrations in one transaction under the advisory lock (`packages/observatory/db/migrate.ts`). `MIGRATE_ON_BOOT=0` skips this step.
3. It starts every network in `platform.networks`.
4. It opens both listeners and ticks each network once a minute.

**On SIGTERM:**

1. `/healthz` answers 503, and new work is refused.
2. Both listeners stop accepting connections.
3. Every unit of work and tick in flight finishes: it commits, delivers, and releases its advisory lock.
4. The pool closes.
5. After `SHUTDOWN_GRACE_MS` (25 s) the pool closes anyway. That ends the database sessions, and with them any lock they still hold. The process then exits 1.

**Logs:**

- One JSON object per line: `t`, `level`, `msg` and fields.
- `console.*` from any library goes through the same logger.
- Phone numbers are masked, and the fields `text`, `body`, `phone`, `code`, `token`, `secret`, `cookie` and `authorization` are dropped.
- The access log keeps the method, a route label without the query string or ids, the status, the time and the app.

### 2.3 Environment variables (service `backend`)

Set these in **Variables**. Mark each **secret** row as a sealed variable. Never put a secret in a file in the repo.

| Variable | Secret? | Production value | Notes |
|---|---|---|---|
| `PLATFORM_ENV` | no | `production` (`staging` in staging) | Required. It must match `platform.settings.environment` (section 2.4). |
| `NETWORK_DATABASE_URL` | **yes** | `postgres://network_backend:<password>@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}` | The service login (2.1). Never the superuser: the boot check refuses it. |
| `MIGRATION_DATABASE_URL` | yes (reference) | `${{Postgres.DATABASE_URL}}` | The owner (superuser). Used only to apply migrations at boot, and once for `PLATFORM_DB_ENVIRONMENT_INIT`. With `MIGRATE_ON_BOOT=0` it may be unset. It must differ from `NETWORK_DATABASE_URL`. |
| `PORT` | no | `8790` | The public listener. Set it, so that Railway's domain targets this port. |
| `STAFF_PORT` | no | `4848` | Private only. `BACKEND_STAFF=off` turns the staff listener off. |
| `PLATFORM_HASH_KEY` | **yes** | 32+ random bytes, for example `openssl rand -base64 48` | Keys the phone and IP hashes. **Never rotate it after launch**: suppression and rate-limit rows are keyed by it. |
| `PLATFORM_PROXY_SECRET` | **yes** | 32+ random characters | The same value goes into each site Worker (section 3). |
| `TURNSTILE_SECRET_KEY` | **yes** | From Cloudflare Turnstile | One widget per site domain, or one widget listing all four |
| `TURNSTILE_SITE_KEY` | no (public) | The same Turnstile widget | The MCP sign-in page (`/oauth/authorize` on each site) shows the widget. Without it the MCP server stays off (404 `mcp_not_enabled`). The `oauth` schema is a migration (`9001_oauth_schema`, packages/mcp/db/oauth.sql); the service login only reads and writes it. The widget's hostnames: each domain, its `www` name and its `<project>.pages.dev`. |
| `OTP_PROVIDER` | no | `twilio` | Required when deployed |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` | **yes** (all three) | Twilio Verify | Codes only. These send verification codes, not network messages. |
| `NETWORK_SERVICE_TOKENS` | **yes** | `admin@*:<t>,reviewer@slop:<t>,...` | Staff tokens. Without them every staff route answers 401. |
| `NETWORK_SERVICE_CONSOLE_TOKEN` | **yes** | One of the tokens above | Only if the observatory console runs |
| `BLOOIO_WEBHOOK_SECRET` | **yes** | From Blooio | Without it `/webhooks/blooio` answers 503 |
| `<APP>_BLOOIO_WEBHOOK_SECRET` | **yes** | Per-app lines only | Not needed with one shared line |
| `PLATFORM_STOP_SCOPE` | no | leave unset | PRD 40.3: on the shared line STOP stops every app anyway |
| `STOP_HELP_OWNER` | no | leave unset (`service`) unless the founder picks `gateway` **[FOUNDER]** | One system answers STOP, HELP and START. `gateway`: the service answers no keyword and records what the gateway reports to `POST /consent/gateway`. Any other value stops the start. |
| `STOP_HELP_GATEWAY_SECRET` | **yes** | Shared with the gateway | Only with `STOP_HELP_OWNER=gateway`. Without it `/consent/gateway` answers 503. |
| `BLOOIO_LINE_DAILY_CAP`, `BLOOIO_LINE_NEW_CHATS_PER_DAY` | no | leave unset (200 and 20) until prototype P3 measures the line | The persisted queue's per-line caps on agent-started texts and new conversations in a rolling day. |
| `BUILD_ID` | no | leave unset | Railway's `RAILWAY_GIT_COMMIT_SHA` is used. Every response carries it in `x-network-build`. |
| `PLATFORM_DB_ENVIRONMENT_INIT` | no | `1` on the first deploy only, then delete it | Section 2.4 |
| `BACKEND_EXTRA_HOSTS` | no | **unset in production** (refused there) | Staging only: `<host>=slop,...` for a staging site host. The Pages production names (`<project>.pages.dev`) are built in. |
| `SHUTDOWN_GRACE_MS` | no | `25000` | Keep it under `drainingSeconds` in railway.toml (30 s) |
| `PHOTO_STORAGE` | no | `r2` (unset: photos are off) | slop.date photos (adults only). `local` is for dev only. |
| `R2_ACCOUNT_ID` (or `R2_ENDPOINT`), `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | key: **yes** | A **private** bucket: no public access, no r2.dev URL | The R2 driver is not yet exercised in tests. |
| `PHOTO_VIEW_BASE_URL` | no | `https://slop.date` | Staff photo links (5 minutes, signed) go through the backend there. |
| `CLEF_RATINGS` | no | `on` (default, founder 2026-10-09). `off` turns ratings off; any other value also leaves them off. | The slop.date photo rater (Clef). Off: photos work, unrated. `server.ts` logs `photo rater` with its status and weights version at start. |
| `CLEF_WEIGHTS_PATH` | no | Unset: the placeholder Clef weights (status `on_placeholder`) until fitted weights pass the rule in docs/results/2026-10-09-clef-fitting.md. Set: a fitted weights file with a version and provenance; a placeholder or a file without provenance is refused (ratings stay off). | |
| `CLOUDFLARE_AI_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | **yes** (token) | A Workers AI token and the account id. Without them nothing is rated (`off_env`). | Never set in CI or `bun run sim`. Each rater try is a `photo_rating` row in the cost ledger (7.3). |
| `CLEF_MODEL` | no | `clef` | `clef-flash` is cheaper. A refused weights file logs `photo rater` with `status: refused_weights`. |
| `SURPLUS_API_KEY` | **yes** | Only when an LLM path is turned on | gpt-6-luna through core's `chatJson`. Without it, LLM paths fail closed. |
| `NETWORK_CHANNEL`, `BLOOIO_API_KEY`, `BLOOIO_FROM`, `BLOOIO_ALLOW_SEND`, `NTWRK_LIVE_APPROVED`, `<APP>_LIVE_APPROVED` | key: **yes** | **leave all unset** | Live sends. **[FOUNDER]** only. Section 6. |
| `ALERT_WEBHOOK_URL` | **yes** | A Slack incoming webhook (or any HTTPS endpoint that takes a JSON POST) | Section 7.2. Unset: alerts are log lines only, and the boot log warns. |
| `ALERT_WEBHOOK_FORMAT` | no | `slack` for a Slack webhook, else leave unset (`json`) | `slack` sends `{ text }` only |
| `OPS_METRICS_TOKEN` | **yes** | 32+ random characters | `GET /ops/metrics` with `Authorization: Bearer <token>`. Unset: the route answers 404. |
| `OPS_HEARTBEAT_URL` | **yes** | The heartbeat URL of the uptime service (section 7.1) | A GET after each ops round (every minute) |
| `COST_BUDGET_DAILY_USD`, `COST_BUDGET_DAILY_USD_<APP>` | no | The founder's daily budget, in US dollars | Section 7.3. An alert at 80% and at 100%. |
| `COST_BLOOIO_LINE_MONTHLY_USD` | no | The line's monthly price from the Blooio contract | Unset: the line is not in the ledger. Other prices have defaults (7.3). |

Values used in local smoke runs (`ACfake`, `fake-turnstile`, `+1 555 01xx` numbers) must never reach Railway.

### 2.4 First deploy

1. Set the variables in 2.3 and add `PLATFORM_DB_ENVIRONMENT_INIT=1`. On the very first deploy the `network_service` role does not exist yet, so the service login cannot: the first boot applies every migration (as `MIGRATION_DATABASE_URL`), sets the database environment, and then stops at the login check. Create the login (2.1) in Railway's database console, then redeploy.
2. Deploy. A new database says `environment = 'dev'` (migration 0003), and the service refuses to start under another `PLATFORM_ENV`. The flag moves `'dev'` to `PLATFORM_ENV` once. It never changes a database that already says staging or production.
3. In the deploy log, check:
   - `"msg":"migrations"` with `applied` > 0;
   - `"msg":"database environment","set":"production"`;
   - one `"msg":"network"` line per network, each with `"sends":"dry-run"`.
4. Delete `PLATFORM_DB_ENVIRONMENT_INIT`. Railway redeploys. The second boot must show `applied: 0`.

### 2.5 Custom domain `api.ntwrk.love` (Cloudflare DNS)

1. Railway: open service `backend` → **Settings → Networking → Custom Domain**. Enter `api.ntwrk.love` with target port `8790`. Railway shows a CNAME target (`<something>.up.railway.app`), and it may also show a TXT verification record.
2. Cloudflare (the ntwrk.love account, zone ntwrk.love) → DNS:
   - `CNAME api → <target>.up.railway.app`;
   - the TXT record, if Railway asked for one.
3. Proxy status:
   - Start with **DNS only** (grey cloud) until Railway shows the domain as active with its certificate.
   - Then switch to **Proxied** (orange cloud) and keep the zone's SSL/TLS mode at **Full (strict)**. Never use Flexible: it loops redirects and sends plain HTTP to the origin.
   - **Verify** after the switch that `curl -sI https://api.ntwrk.love/healthz` answers 200.
4. Delete Railway's generated `*.up.railway.app` domain, or never generate one. Without it, Cloudflare is the only way in.
5. Optional hardening: a WAF rule on `api.ntwrk.love` that blocks paths other than `/api/*`, `/webhooks/blooio*`, `/consent/gateway`, `/mcp*`, `/oauth/*`, `/.well-known/oauth-*`, `/healthz` and `/ops/metrics`.

Every Pages project calls `https://api.ntwrk.love` like any other client. Only the proxy secret makes the backend trust it.

### 2.6 Observatory console (staff, behind Cloudflare Access)

The console is the same image with another start command (`deploy/backend/observatory.railway.toml`). It runs in real mode only (`OBSERVATORY_REAL_ONLY=1`): no game mode, no lab, and no simulator code. The image removes `packages/sim`, `judge`, `evals`, `worlds` and `plugin-network`, and the console imports game mode only on demand (`bun run sim` block `ops` checks both). Staff sign in through Cloudflare Access only. The console reads each app through that app's own read login. It changes nothing in the database: review, safety actions and the matching switch go to the backend's staff API over the private network.

**Caution:** under `PLATFORM_ENV=production` or `staging`, the console refuses to start without Access (`OBSERVATORY_TRUST_CF_ACCESS=1` with the team and the audience). Without Access it would make an admin token and write it into the Railway log.

1. **New → GitHub Repo →** the same repository. Name the service `observatory`.
2. Set Config-as-code to `/deploy/backend/observatory.railway.toml`. It starts `bun run packages/observatory/src/server.ts --mode real` and checks `/healthz` (no auth, no data).
3. Create the read logins once, as the owner (Railway's database console), after the first migration. Use a new random password (24+ characters) for each:

   ```sql
   -- One read login per app: row-level security shows it that app's rows only (migrations 0004, 0010, 0020).
   create role console_ntwrk   login password '<p1>' nosuperuser nobypassrls; grant network_observatory_ntwrk   to console_ntwrk;
   create role console_slop    login password '<p2>' nosuperuser nobypassrls; grant network_observatory_slop    to console_slop;
   create role console_peon    login password '<p3>' nosuperuser nobypassrls; grant network_observatory_peon    to console_peon;
   create role console_friends login password '<p4>' nosuperuser nobypassrls; grant network_observatory_friends to console_friends;
   -- The cross-app person view (counts and trust levels only), the staff roles and the audit log.
   create role console_cross   login password '<p5>' nosuperuser nobypassrls; grant network_observatory_cross_app to console_cross;
   create role console_shared  login password '<p6>' nosuperuser nobypassrls; grant network_observatory to console_shared;
   create role console_audit   login password '<p7>' nosuperuser nobypassrls; grant network_observatory_audit to console_audit;
   do $$ declare r text; begin
     foreach r in array array['console_ntwrk','console_slop','console_peon','console_friends','console_cross','console_shared','console_audit'] loop
       execute format('grant connect on database %I to %I', current_database(), r);
     end loop; end $$;
   ```

4. Variables (`<host>` is `${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}`):

   | Variable | Secret? | Value |
   |---|---|---|
   | `OBSERVATORY_REAL_ONLY` | no | `1` |
   | `PLATFORM_ENV` | no | `production` |
   | `NODE_ENV` | no | `production` (the page is bundled once, minified) |
   | `OBSERVATORY_HOST` | no | `::` (Railway's network may be IPv6 only) |
   | `PORT` | no | `4747` |
   | `OBSERVATORY_ALLOWED_ORIGINS` | no | `https://console.ntwrk.love` (the console refuses any other Host or Origin) |
   | `OBSERVATORY_DATABASE_URL_NTWRK`, `_SLOP`, `_PEON`, `_FRIENDS` | **yes** | `postgres://console_<app>:<p>@<host>`, one per app |
   | `NETWORK_DATABASE_URL` | **yes** | `postgres://console_shared:<p6>@<host>` (staff roles from `platform.staff_roles`; the fallback read login) |
   | `OBSERVATORY_PLATFORM_DATABASE_URL` | **yes** | `postgres://console_cross:<p5>@<host>` |
   | `OBSERVATORY_AUDIT_DATABASE_URL` | **yes** | `postgres://console_audit:<p7>@<host>` |
   | `NETWORK_SERVICE_URL` | no | `http://backend.railway.internal:4848` |
   | `NETWORK_SERVICE_TOKEN` | **yes** | The backend's `NETWORK_SERVICE_CONSOLE_TOKEN` value |
   | `OBSERVATORY_TRUST_CF_ACCESS` | no | `1` |
   | `OBSERVATORY_CF_ACCESS_TEAM`, `OBSERVATORY_CF_ACCESS_AUD` | no | The Zero Trust team name and the Access application's AUD tag |
   | `OBSERVATORY_ROLES` | no | Optional: `email:role@app,...`. Admins can also add rows to `platform.staff_roles`. |
   | `COST_BUDGET_DAILY_USD`, `COST_BUDGET_DAILY_USD_<APP>` | no | The same values as on the backend (section 7.3): the cost panel shows them |

   Never set `OBSERVATORY_TOKEN`, `OBSERVATORY_TOKENS` or `OBSERVATORY_REVEAL_PII` here.

5. Custom domain and Access:
   - Add `console.ntwrk.love` with target port 4747, and a proxied CNAME in Cloudflare.
   - In Cloudflare Zero Trust, create an **Access → Applications → Self-hosted** app for `console.ntwrk.love`. The policy allows the staff emails only. Session duration: 12 hours or less. Copy its AUD tag into `OBSERVATORY_CF_ACCESS_AUD`.
   - The console verifies the Access JWT (`Cf-Access-Jwt-Assertion`) on every request: signature against the team's keys, audience, issuer and expiry (`src/staff.ts`). A request that did not come through Access has no valid JWT and gets 401.
   - Do not generate a Railway domain for this service.
6. **Verify:**
   - `curl -s -o /dev/null -w '%{http_code}' https://console.ntwrk.love/api/me` from a shell without an Access session gives 302 or 403 (Access stops it).
   - Sign in through Access in a browser. The header shows `real only` and your roles. Each app's Overview loads, and the label says `PRODUCTION DATA · read-only · PII scrubbed`.
   - The start line in the deploy log (`The Network Observatory →`) has no `#token=`.
   - **Metrics** shows the **Bias monitor (weekly)** panel (aggregates from the backend) and the **Cost (estimated)** panel (section 7.3) for analysts and admins.

### 2.7 Roll back

- **Code.** Railway → service → **Deployments**. Pick the last good deployment, open its menu, and choose **Redeploy** (Railway calls it a rollback). The old image starts. Overlap and draining handle the switch.
- **Schema.** Migrations only go forward. Each numbered migration must be additive (add columns and tables; never drop or rename something the previous build reads in the same release). Then the previous image still runs on the newer schema. A migration that cannot meet this rule needs a two-step release, written down in its PR.
- **Data.** Restore into a **new** database first: from the Postgres volume backup (Railway → Postgres → Backups), or from the daily R2 dump with `deploy/backup/restore.ts` (section 8.2). Compare, then switch `NETWORK_DATABASE_URL` and `MIGRATION_DATABASE_URL`. Never restore over the live volume.
- **Sites.** In the Cloudflare dashboard, Pages → the project → Deployments → an earlier production deployment → **Rollback** (section 3.2), or redeploy the previous commit.
- Write each rollback down in the incident log, with the build ids (`x-network-build`) before and after.

### 2.8 Check it locally before a deploy

With Docker or Podman, from the repository root:

```bash
docker build -f deploy/backend/Dockerfile -t network-backend .
# podman: podman build --format docker -f deploy/backend/Dockerfile --ignorefile deploy/backend/Dockerfile.dockerignore -t network-backend .

createdb -h localhost -p 54339 backend_smoke            # a database of your own on the dev cluster
bun run db:migrate -- --url postgres://$USER@localhost:54339/backend_smoke
psql -h localhost -p 54339 backend_smoke -c "create role backend_smoke_svc login nosuperuser nobypassrls; grant network_service to backend_smoke_svc; grant connect on database backend_smoke to backend_smoke_svc"
S=$(openssl rand -hex 24)
docker run -d --name backend-smoke -p 127.0.0.1:18791:8790 \
  -e PLATFORM_ENV=staging -e PLATFORM_DB_ENVIRONMENT_INIT=1 \
  -e MIGRATION_DATABASE_URL=postgres://$USER@host.docker.internal:54339/backend_smoke \
  -e NETWORK_DATABASE_URL=postgres://backend_smoke_svc@host.docker.internal:54339/backend_smoke \
  -e PLATFORM_HASH_KEY=$S -e PLATFORM_PROXY_SECRET=$S \
  -e TURNSTILE_SECRET_KEY=fake -e OTP_PROVIDER=twilio \
  -e TWILIO_ACCOUNT_SID=ACfake -e TWILIO_AUTH_TOKEN=fake -e TWILIO_VERIFY_SERVICE_SID=VAfake \
  -e BUILD_ID=local-smoke network-backend
curl -s localhost:18791/healthz          # {"ok":true,"build":"local-smoke","env":"staging"}
curl -s localhost:18791/api/app -H 'host: slop.date'   # 421 edge_required: only a signed router request names a site
curl -s -o /dev/null -w '%{http_code}\n' localhost:18791/review     # 404: no staff API on the public port
docker stop -t 30 backend-smoke          # exit code 0, "shutdown complete","clean":true
docker rm backend-smoke && dropdb -h localhost -p 54339 backend_smoke
```

Notes for this smoke:

- With Podman on macOS, the host is `host.containers.internal`.
- To call `/api/app` as each site, sign the headers the way the Worker does: `signProxyHeaders(secret, { method: "GET", path: "/api/app", host: "slop.date", ip: "203.0.113.5" })` from `packages/platform/src/proxy.ts`, then fetch with them.
- `deploy/backend/backend.test.ts` does all of this against a real boot of `server.ts`.

Without a container runtime, run `bun run start:backend` with the same variables (`localhost` for the host). Locally, without `PLATFORM_ENV=staging`, it binds `127.0.0.1` only.

## 3. Cloudflare Pages: the sites

Each site is one Pages project (founder decision 8):

- `sites/<domain>/wrangler.toml`: `name = "<project>"`, `pages_build_output_dir = "./dist"`, and `[vars]` `APP_ID`, `SITE_HOST`, `BACKEND_ORIGIN = "https://api.ntwrk.love"`. No `account_id`, no routes: the account comes from `CLOUDFLARE_ACCOUNT_ID`.
- `bun run sites/sites.ts <app>` writes `sites/<domain>/dist`: the pages, `_headers`, the skill files, `_worker.js` (the router, `deploy/router.ts`, bundled through `deploy/pages-worker.ts`: the default export only, as workerd requires, with the site's `APP_ID`, `SITE_HOST` and `BACKEND_ORIGIN` built in; a project variable still wins) and `_routes.json` (the Worker runs on `/api`, `/api/*`, `/mcp`, `/mcp/*`, `/oauth/*`, `/.well-known/oauth-*` only; every other path is a static file).
- The router answers 413 for a body over 9 MB and 503 `proxy_not_configured` without `PLATFORM_PROXY_SECRET`. It never forwards unsigned.

| Site | Pages project | Served on | Its own domain |
|---|---|---|---|
| ntwrk.love | `ntwrk-love` | `ntwrk-love.pages.dev` | `ntwrk.love`, `www.ntwrk.love`: add them as Pages custom domains. They are on the `ntwrk-love-site` **Worker** today: remove the Worker's custom domains first, in the same quiet hour (10DLC pages). |
| slop.date | `slop-date` | `slop-date.pages.dev` | DNS in the Eliza Labs Cloudflare account points at `slop-date.pages.dev` (10 days) |
| peon.biz | `peon-biz` | `peon-biz.pages.dev` | Pages custom domain `peon.biz` |
| friends.help | `friends-help` | `friends-help.pages.dev` | DNS in the Eliza Labs Cloudflare account points at `friends-help.pages.dev` |

### 3.1 By hand (founder approval only)

```bash
bun run sites/sites.ts slop                                   # dist with _worker.js and _routes.json
# check it locally first (nothing is uploaded): scripts/wrangler.sh pages dev --port 8811 --binding PLATFORM_PROXY_SECRET=<test value> --binding BACKEND_ORIGIN=http://127.0.0.1:8790 (run in sites/slop.date)
# once per project: the same value as the backend
NTWRK_ALLOW_DEPLOY=1 scripts/wrangler.sh pages secret put PLATFORM_PROXY_SECRET --project-name slop-date
NTWRK_ALLOW_DEPLOY=1 scripts/wrangler.sh pages deploy sites/slop.date/dist --project-name slop-date --branch main
```

Notes:

- The projects exist: never pass `--force`, never create them again.
- `scripts/wrangler.sh` uses its own wrangler login (`XDG_CONFIG_HOME=$HOME/.config/wrangler-ntwrk`). Its account defaults to the ntwrk.love account (all four projects). It refuses `pages deploy`, `pages secret put` and every other change without `NTWRK_ALLOW_DEPLOY=1`, and `deploy --dry-run --no-dry-run` counts as a real deploy (the last value wins, as in wrangler).

### 3.2 Roll back a site

Pages → the project → **Deployments** → an earlier production deployment → **Rollback**. `scripts/wrangler.sh pages deployment list --project-name <project>` lists them (read-only).

### 3.3 After each site deploy

```bash
for S in https://ntwrk-love.pages.dev https://slop-date.pages.dev https://peon-biz.pages.dev https://friends-help.pages.dev; do
  bun run deploy/smoke.ts $S <app> --api                    # 13 checks, the same as CI
  curl -s $S/api/app; echo                                  # this site's app only
  curl -s -H 'x-network-proxy-host: ntwrk.love' $S/api/app; echo   # still this site's app (client copy removed)
done
curl -s https://api.ntwrk.love/api/app                      # 421 edge_required: the origin alone names no site
```

## 4. GitHub: secrets and the production environment

1. **Settings → Environments**:
   - Create `production`. Required reviewers: the founder. Deployment branches: `main` only.
   - Create `staging` (previews) with no reviewers.
2. Secrets per environment. Never use repository-level secrets for deploys, so that `ci.yml` stays secret-free:

   | Name | Environment | Value |
   |---|---|---|
   | `CLOUDFLARE_API_TOKEN` (secret) | production | Account-owned token for the ntwrk.love account: Account → Cloudflare Pages → Edit. TTL 90 days. The only Cloudflare secret `deploy-sites.yml` reads, and only in its deploy step. |
   | `CLOUDFLARE_ACCOUNT_ID` (variable) | production | Required: the ntwrk.love account id (all four projects). It is not in the repo. |
   | `BACKEND_ORIGIN`, `TURNSTILE_SITE_KEY`, `BACKEND_LIVE` (variables) | production | `https://api.ntwrk.love`, the public widget key, `true` once the API is live |

   There are no PR preview deployments: they ran pull-request code next to the deploy token and the production proxy secret (audit). `PLATFORM_PROXY_SECRET` is never a GitHub secret: it is set once per Pages project (3.1).
   | `RAILWAY_TOKEN` | production | A Railway **project token** for the `production` environment. Only if production deploys go through Actions (below). |

3. Railway production deploys. Pick one:
   - **(a)** Railway auto-deploys `main` with **Wait for CI**. This is simple, but it has no founder approval step.
   - **(b) Recommended.** Turn off auto-deploy for the production environment. A job in the sites' deploy workflow, `environment: production`, runs `railway up --service backend --environment production --ci` after CI passes. It then waits for `https://api.ntwrk.love/healthz` to report the new `build`.
   - Staging may auto-deploy.
4. Pin every action by full commit SHA. Never use `pull_request_target`. PRs from forks get no secrets.

## 5. Order of the first go-live

1. Railway: project, Postgres, the `backend` service, its variables (live-send variables unset), and the first deploy (2.4).
2. `api.ntwrk.love` (2.5). Check `/healthz` and the build id.
3. `PLATFORM_PROXY_SECRET` set in each Pages project. Deploy slop.date first (decision 4), then ntwrk.love, peon.biz and friends.help (3.1 or `deploy-sites.yml`). Each answers on `<project>.pages.dev` at once.
4. Run the checks in 3.3 on every host.
5. The observatory console behind Access (2.6), the uptime monitor and the alert webhook (7), and the backup job with one restore drill (8).
6. DNS: slop.date and friends.help (Eliza Labs Cloudflare account) point at their `pages.dev` names; ntwrk.love and peon.biz move to Pages custom domains (3). The MCP server is on once `TURNSTILE_SITE_KEY` is set on the backend.

## 6. Go-live checklist (live sends stay off)

Do every item on each deploy to production until the founder turns sends on in writing.

- [ ] `NETWORK_CHANNEL`, `BLOOIO_API_KEY`, `BLOOIO_FROM`, `BLOOIO_ALLOW_SEND`, `NTWRK_LIVE_APPROVED` and every `<APP>_LIVE_APPROVED` are **unset** on the backend service, in every Railway environment. Railway shows the variables; check them, do not assume.
- [ ] The boot log shows `"channel":"dry-run"` and `"sends":"dry-run"` for every network. With only some of the flags set, the log warns `sends stay dry-run`; treat that warning as a failed check.
- [ ] `select status, count(*) from network.messages where direction = 'outbound' group by 1;` shows only `dry_run` (and `refused_*`) rows.
- [ ] `PLATFORM_ENV=production` and `select value from platform.settings where key = 'environment'` says `production`. The 555-01xx trigger is then on.
- [ ] `PLATFORM_DB_ENVIRONMENT_INIT` is gone from the variables.
- [ ] `curl https://api.ntwrk.love/healthz` gives 200 with the expected `build`. Each site's `/api/app` names its own app and gives the same `x-network-build`.
- [ ] `curl https://api.ntwrk.love/review` gives 404. The staff API is reachable only on the private network.
- [ ] `curl -H 'x-network-proxy-host: slop.date' https://api.ntwrk.love/api/app` gives 421 `edge_required`.
- [ ] The boot log has no `refusing to start` line, and `select rolsuper, rolbypassrls from pg_roles where rolname = '<service login>'` is `f, f`.
- [ ] No `*.up.railway.app` domain on either service.
- [ ] The logs of the last hour contain no phone number, message text, code or token. Search Railway's log view for `+1`, `555` and `"text"`.
- [ ] Matching is off where `platform.networks.matching_enabled` is false (slop and peon until their packs land). The boot log shows `"matching":"off"` for them.
- [ ] The Postgres backup ran at least once: the Railway volume backup, and the `backup` cron service's last run logged `"msg":"backup uploaded"`. The last restore drill (runbook-real.md section 8) passed within 30 days.
- [ ] The uptime monitor on `/healthz` and the heartbeat are green (7.1). A test alert reached the on-call channel (7.2).
- [ ] `curl -s -o /dev/null -w '%{http_code}' https://api.ntwrk.love/ops/metrics` gives 401 (404 if `OPS_METRICS_TOKEN` is unset).
- [ ] Twilio Verify is the only provider that can send anything (codes only). Blooio has no key on the service.

Turning sends on is a separate, written founder decision (runbook-real.md). It is not part of a deploy.

## 7. Monitoring, alerts and cost

What watches the backend, and who hears about it. Nothing here sends a member message.

### 7.1 Uptime check (external monitor)

The backend cannot report its own death. Use an external uptime service (for example Better Stack, UptimeRobot or a Cloudflare health check).

1. **HTTP monitor:** `GET https://api.ntwrk.love/healthz` every 60 seconds. Expect status 200 and the body to contain `"ok":true`. Alert after 2 failures in a row.
   - 503 `"status":"database"`: the database does not answer.
   - 503 `"status":"tick_late"`: a network's tick has not finished in this process for `TICK_LATE_MS` (default 15 minutes, or 3 ticks if the tick is slower). The tick loop is stuck.
   - 503 `"status":"draining"`: a deploy or a restart. One failure is normal; two in a row are not.
2. **Heartbeat monitor:** make a heartbeat in the same service. Put its URL in `OPS_HEARTBEAT_URL`. The backend calls it after each ops round (every minute). Set the grace period to 5 minutes. A missing heartbeat means the process is down, or its tick loop or its alert dispatcher stopped.
3. Optional: a second HTTP monitor on `GET https://api.ntwrk.love/ops/metrics` with the header `Authorization: Bearer <OPS_METRICS_TOKEN>`. Expect 200.
4. Send these monitors to the same on-call channel as the alert webhook (7.2).

### 7.2 Alerts (`deploy/backend/ops.ts`)

Every minute, inside the backend's tick, the ops round reads each network and the cost ledger, and checks these rules:

| Alert key | Level | When |
|---|---|---|
| `tick_late:<network>` | bad | No tick stored for the network for `ALERT_TICK_LATE_MS` (15 min). Covers another replica that holds the lock and hangs. |
| `send_failures:<network>` | bad | In 24 h, at least `ALERT_SEND_FAILURE_MIN` (5) sends failed, and at least `ALERT_SEND_FAILURE_RATE` (2%) of the sends that reached the provider. Dry-run and refused sends do not count. |
| `review_sla:<network>` | bad | A review item is past its deadline, or one expired unsent in 24 h |
| `safety_minor:<network>` | bad | A minor signal after contact with an adult in 24 h |
| `safety_report:<network>` | bad (urgent kind) or warn | A member report in 24 h. Urgent kinds: harassment, unsafe, scam, minor. |
| `safety_action:<network>` | warn | A ban or a hold in 24 h |
| `queue_outbound:<network>` | warn | `ALERT_OUTBOUND_BACKLOG` (50) or more messages wait for delivery |
| `queue_review:<network>` | warn | `ALERT_REVIEW_BACKLOG` (30) or more items wait for review |
| `budget:total`, `budget:<app>` | warn at `COST_BUDGET_WARN_SHARE` (80%), bad at 100% | Today's estimated cost (7.3) against the daily budget |
| `ops_read:<network>`, `cost_read` | warn | The ops round could not read the network or the ledger |

Dedupe and rate limit (`network.ops_alerts`, `network.ops_alert_posts`, migration 0020):

- An alert is posted when it starts, when it goes from warn to bad, and when a safety alert's count goes up. While it lasts, it is posted again every `ALERT_REPEAT_MS` (6 hours). When it ends, one "resolved" notice is posted.
- The state is in the database, so a deploy, a restart or a second replica does not post an alert again. One replica at a time runs the round (an advisory lock).
- All notices of one round go in one POST. At most `ALERT_MAX_PER_HOUR` (12) posts an hour. Held notices go out in a later round. A failed POST is retried in the next round.
- The POST body is `{ "text": ..., "source": "the-network-backend", "env": ..., "build": ..., "alerts": [{ "key", "level", "count", "text", "state" }] }`. A Slack incoming webhook shows `text`. With `ALERT_WEBHOOK_FORMAT=slack` only `{ "text" }` is sent.
- Alerts hold network ids and counts only: never a member id, a name, a phone number or a message. The safety team opens the console for the details.
- Without `ALERT_WEBHOOK_URL`, each notice is a log line `"msg":"alert"` with `key`, `level`, `count` and `state`. A Railway log alert on that text is a fallback.

**Test the webhook** after each change of the URL. In staging, set `ALERT_REVIEW_BACKLOG=1` while one item waits for review. Wait one minute and check the channel. Then remove the variable: the "resolved" notice follows.

`GET /ops/metrics` (public port, `OPS_METRICS_TOKEN`) returns the same snapshot: per network the age of the last tick, the review and send queues, the sends of 24 h by outcome, SLA misses and safety counts; today's cost per app with each budget line; and the open alerts.

### 7.3 Cost ledger (`packages/network/service/cost.ts`)

Every costed event is a row in `network.cost_ledger` (migration 0020): the app, the UTC day, the kind, the provider, the quantity and the cost in US dollars. Rows hold codes and counts only.

| Kind | Recorded when | Price (USD) | Override |
|---|---|---|---|
| `otp_verify` | Twilio Verify sends a login code | 0.058 per code | `COST_TWILIO_VERIFY_USD` |
| `photo_rating` | The Clef rater is called for a member (not for a refusal) | 0.000425 per photo (0.0017 for 4 photos) | `COST_CLEF_PHOTO_USD` |
| `llm` | An LLM call is priced by the provider (`CostLedger.llmHooks(app, purpose)` on a core client) | The provider's own price (Surplus reports it) | none |
| `sms_fallback` | An outbound message is stored as `fell_back` (sent by SMS) | 0.0083 per message | `COST_SMS_USD` |
| `blooio_line` | Once a day, app `shared` | `COST_BLOOIO_LINE_MONTHLY_USD` / 30 per line | `COST_BLOOIO_LINES` (default 1) |

- Today no LLM path is wired into the service. When one is (for example `understand`), build its client as `defaultLLM(svc.cost.llmHooks("<app>", "understand"))` so each call is in the ledger.
- Budgets: `COST_BUDGET_DAILY_USD` for every app together, `COST_BUDGET_DAILY_USD_<APP>` per app (`_SHARED` for the line). The ops round alerts at 80% and 100% of a budget (7.2). The day is the UTC day.
- The console's **Metrics → Cost (estimated)** panel shows the app's cost per day and kind for 14 days, today's shared line, and each budget line (set the same budget variables on the console). Each app's read role reads its own rows and the shared ones.
- The prices are estimates. Compare the ledger with the Twilio, Cloudflare, Blooio and Surplus invoices each month, and change the overrides when they differ.

## 8. Backups and restore

Two backups, so that one failure does not lose the data:

1. **Railway volume backups** (Railway Pro): Railway → Postgres → **Backups**. Turn on the daily schedule. Railway keeps them with the volume.
2. **A daily dump to R2** (`deploy/backup/`): a logical dump outside Railway, with exact row counts to check a restore against.

### 8.1 The backup job

- **R2 bucket:** create `ntwrk-backups` in the ntwrk.love Cloudflare account. It must be private: no public access, no r2.dev URL, no custom domain. Add a lifecycle rule that deletes objects after 35 days. Make an R2 API token with **Object Read & Write** on this bucket only. Never use the photo bucket or its token.
- **Service:** in Railway, **New → GitHub Repo →** this repository, named `backup`. Set Config-as-code to `/deploy/backup/railway.toml`. It builds `deploy/backup/Dockerfile` (Postgres client tools and Bun) and runs `bun run deploy/backup/backup.ts` every day at 07:15 UTC (cron service).
- **Postgres version:** the image's `PG_MAJOR` build argument (default 16) must be the Railway server's major version or newer (`select version();`). `pg_dump` refuses a newer server.
- **Variables:**

  | Variable | Secret? | Value |
  |---|---|---|
  | `BACKUP_DATABASE_URL` | **yes** | `${{Postgres.DATABASE_URL}}` (the owner: it reads every table and dumps the roles) |
  | `BACKUP_R2_ACCOUNT_ID` (or `BACKUP_R2_ENDPOINT`) | no | The ntwrk.love account id |
  | `BACKUP_R2_BUCKET` | no | `ntwrk-backups` |
  | `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY` | **yes** | The bucket token |
  | `BACKUP_PREFIX` | no | `postgres/production` (default `postgres/<PLATFORM_ENV>`) |
  | `BACKUP_HEARTBEAT_URL` | **yes** | Optional: a heartbeat monitor (as in 7.1) with a period of 1 day and a grace of 2 hours. The job calls it only after a complete upload, so a missed or failed run raises an alert. |

- **What one run does:** it opens a read-only snapshot, counts the rows of every table in `network`, `platform`, `notify`, `oauth` and `public`, and runs `pg_dump --snapshot` on the same snapshot, so the counts and the dump agree. It dumps the roles without passwords. It uploads `db.dump`, `roles.sql` and `manifest.json` (last) to `<BACKUP_PREFIX>/<UTC time>/`. A prefix with a `manifest.json` is a complete backup.
- **Logs:** one JSON line per step: `"msg":"dump"` (bytes, tables, rows) and `"msg":"backup uploaded"`. A failure logs `"msg":"backup failed"` and exits 1. Set `BACKUP_HEARTBEAT_URL` so a failed or missed run is an alert in the same channel as 7.1.
- **Caution:** the dump holds member data (phone numbers, messages). Only the founder and the on-call engineer may download one, and only to restore it (runbook-real.md section 8). Delete local copies after the drill.

### 8.2 Restore

`deploy/backup/restore.ts` restores a backup into a **new** database and checks every table's row count against the manifest. It refuses a database that exists, and the live names (`railway`, `network`, `postgres`).

```bash
# RESTORE_DATABASE_URL: an owner login on the target server (any database; usually the maintenance one).
RESTORE_DATABASE_URL=... BACKUP_R2_ACCOUNT_ID=... BACKUP_R2_BUCKET=ntwrk-backups BACKUP_R2_ACCESS_KEY_ID=... BACKUP_R2_SECRET_ACCESS_KEY=... \
  bun run deploy/backup/restore.ts --r2 latest --db restore_drill_20261008
# or a backup on disk: --from <dir with manifest.json>
```

Exit 0 and `"msg":"restore checked","mismatches":0`: every table has the row count of the backup. The drill procedure, and how to switch the service to a restored database, are in runbook-real.md section 8. `bun run sim` (block `ops`, tracked) runs the same backup and restore on the dev Postgres each time.

