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
| Observatory console (optional) | Railway service `observatory` | `packages/observatory`, `deploy/backend/observatory.railway.toml` | Only through Cloudflare Access |

The backend process has two listeners:

| Listener | Bind | Paths |
|---|---|---|
| Public, `PORT` (8790) | `0.0.0.0` when `PLATFORM_ENV` is `staging` or `production`; `127.0.0.1` otherwise | `/api/*` (the platform public API), `/webhooks/blooio[/<app>]` (Blooio, signature checked), `/mcp`, `/oauth/*`, `/.well-known/oauth-*` (the MCP server, packages/mcp, mounted by `server.ts`; 404 `mcp_not_enabled` when `TURNSTILE_SITE_KEY` is not set), `/healthz` |
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
   - Turn on backups for the Postgres volume (Railway Pro). Do this before the first real member joins.
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
| `BUILD_ID` | no | leave unset | Railway's `RAILWAY_GIT_COMMIT_SHA` is used. Every response carries it in `x-network-build`. |
| `PLATFORM_DB_ENVIRONMENT_INIT` | no | `1` on the first deploy only, then delete it | Section 2.4 |
| `BACKEND_EXTRA_HOSTS` | no | **unset in production** (refused there) | Staging only: `<host>=slop,...` for a staging site host. The Pages production names (`<project>.pages.dev`) are built in. |
| `SHUTDOWN_GRACE_MS` | no | `25000` | Keep it under `drainingSeconds` in railway.toml (30 s) |
| `PHOTO_STORAGE` | no | `r2` (unset: photos are off) | slop.date photos (adults only). `local` is for dev only. |
| `R2_ACCOUNT_ID` (or `R2_ENDPOINT`), `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | key: **yes** | A **private** bucket: no public access, no r2.dev URL | The R2 driver is not yet exercised in tests. |
| `PHOTO_VIEW_BASE_URL` | no | `https://slop.date` | Staff photo links (5 minutes, signed) go through the backend there. |
| `SURPLUS_API_KEY` | **yes** | Only when an LLM path is turned on | gpt-6-luna through core's `chatJson`. Without it, LLM paths fail closed. |
| `NETWORK_CHANNEL`, `BLOOIO_API_KEY`, `BLOOIO_FROM`, `BLOOIO_ALLOW_SEND`, `NTWRK_LIVE_APPROVED`, `<APP>_LIVE_APPROVED` | key: **yes** | **leave all unset** | Live sends. **[FOUNDER]** only. Section 6. |
| `MONITOR` | no | `1` | The alert monitor every 5 minutes ([runbook-dr.md](runbook-dr.md) section 6). |
| `ALERT_WEBHOOK_URL` | **yes** | An https incoming webhook **[FOUNDER]** | Where alerts go besides the log. Never SMS. `ALERT_FILE` (a path) and `ALERT_REALERT_MS` (default 6 hours) are optional. |
| `COST_BUDGET_DAILY_USD`, `COST_BUDGET_MONTHLY_USD`, `COST_TARGET_PER_MEMBER_USD` | no | **[FOUNDER]** numbers | Unset: no cost alert. 80% warns, 100% is bad ([runbook-dr.md](runbook-dr.md) section 7). |
| `BLOOIO_COST_PER_MESSAGE_USD`, `WORKERS_AI_COST_PER_CALL_USD` | no | Unit prices | Unset: that kind counts as $0 in the cost ledger. |

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
5. Optional hardening: a WAF rule on `api.ntwrk.love` that blocks paths other than `/api/*`, `/webhooks/blooio*`, `/mcp*`, `/oauth/*`, `/.well-known/oauth-*` and `/healthz`.

Every Pages project calls `https://api.ntwrk.love` like any other client. Only the proxy secret makes the backend trust it.

### 2.6 Observatory console (optional)

The console is the same image with another start command. Real data only, and staff sign in through Cloudflare Access.

1. **New → GitHub Repo →** the same repository. Name the service `observatory`.
2. Set Config-as-code to `/deploy/backend/observatory.railway.toml`. It starts `bun run packages/observatory/src/server.ts --mode real`.
3. Variables:

   | Variable | Secret? | Value |
   |---|---|---|
   | `OBSERVATORY_REAL_ONLY` | no | `1` |
   | `PLATFORM_ENV` | no | `production` |
   | `OBSERVATORY_HOST` | no | `0.0.0.0` |
   | `PORT` | no | `4747` |
   | `NETWORK_DATABASE_URL` | yes | A **read-only** login on the same database (create it once; the console writes only through the backend's staff API) |
   | `NETWORK_SERVICE_URL` | no | `http://backend.railway.internal:4848` |
   | `NETWORK_SERVICE_TOKEN` | yes | The `NETWORK_SERVICE_CONSOLE_TOKEN` value |
   | `OBSERVATORY_TRUST_CF_ACCESS` | no | `1` |
   | `OBSERVATORY_CF_ACCESS_TEAM`, `OBSERVATORY_CF_ACCESS_AUD` | no | From the Access application |
   | `OBSERVATORY_AUDIT_DATABASE_URL` | yes | A login that can write `network.staff_audit` |

4. Custom domain:
   - Add `console.ntwrk.love` with target port 4747, and a proxied CNAME in Cloudflare.
   - In Cloudflare Zero Trust, create an **Access → Applications → Self-hosted** app for `console.ntwrk.love`. The policy allows the staff emails only. Copy its AUD tag into `OBSERVATORY_CF_ACCESS_AUD`.
   - Do not generate a Railway domain for this service.
5. The console has no unauthenticated health route yet, so Railway only checks that the process stays up.

### 2.7 Roll back

- **Code.** Railway → service → **Deployments**. Pick the last good deployment, open its menu, and choose **Redeploy** (Railway calls it a rollback). The old image starts. Overlap and draining handle the switch.
- **Schema.** Migrations only go forward. Each numbered migration must be additive (add columns and tables; never drop or rename something the previous build reads in the same release). Then the previous image still runs on the newer schema. A migration that cannot meet this rule needs a two-step release, written down in its PR.
- **Data.** Restore from the Postgres volume backup (Railway → Postgres → Backups) into a **new** database first. Compare, then switch `NETWORK_DATABASE_URL` and `MIGRATION_DATABASE_URL`. Never restore over the live volume. The full steps, the RPO and RTO targets and the restore drill are in [runbook-dr.md](runbook-dr.md).
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
5. Optional: the observatory console behind Access (2.6).
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
- [ ] Matching is off by each network's stored switch until an admin turns it on (`POST /matching`) after shadow mode and the founder's approval. `GET /health` shows `"matchingEnabled": false` for every network.
- [ ] The Postgres backup ran at least once, and one restore was tested ([runbook-dr.md](runbook-dr.md) section 3).
- [ ] Twilio Verify is the only provider that can send anything (codes only). Blooio has no key on the service.

Turning sends on is a separate, written founder decision (runbook-real.md). It is not part of a deploy.
