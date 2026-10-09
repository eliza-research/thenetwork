# Go-live handoff: Railway, GitHub, Cloudflare and Eliza

Instructions for an agent who takes over going live. Read this whole file first. Then read `docs/deploy.md` (the canonical deploy doc), `docs/design/eliza-conversation-layer.md`, `docs/mvp-plan.md` and the "Platform decisions" and "Founder decisions" sections of `AGENTS.md`.

Repo: <https://github.com/eliza-research/thenetwork> (public). Work from a fresh worktree of `origin/main`.

## 0. Founder decisions you are executing

- **The apps.** The Network is the product, and its agent is Eliza. The shared agent that used to be eliza.app's assistant is now The Network's agent, still named Eliza. It speaks for every app on the shared iMessage line:
  - ntwrk.love, the home page;
  - slop.date, dating, which launches first, in NYC;
  - friends.help, friends;
  - peon.biz, work.
- **eliza.app is just another entry into The Network**, like the four sites. Someone arriving through eliza.app joins The Network and is asked what they are looking for (friends, dating, work), or is routed by keyword. eliza.app is not a separate product with separate members.
- **Joining:** slop.date, friends.help and peon.biz are open to anyone. Members aged 13-17 can join but are never matched or connected. Matching is 18+, based on the lowest age the person has stated.
- **Bans:** a banned person cannot rejoin, because the ban is on the phone number. Every join, login and inbound path must refuse a banned number.
- **Ratings:** Clef photo ratings are on, and the scores are never shown to anyone. Clef is also the scam and harassment classifier for relayed messages.
- **STOP and HELP** on the shared line are handled by the Eliza gateway (`STOP_HELP_OWNER=gateway`). Only one system ever answers STOP.
- **Testing:** sims (`bun run sim`), integration tests and e2e tests. Do not add unit tests or smoke tests.

## 1. Hard rules for you

1. **Never type secrets.** That means passwords, API keys, tokens, auth tokens and webhook secrets. Do not type them into any web page, terminal prompt or file. The founder pastes them. You open the page, name the field and wait. You may create a token in a dashboard only if the founder copies it themselves; never read it back or store it.
2. **Never commit secrets** or personal data. The repo is public.
3. **Don't touch production DNS, a deploy, or the takeover flag without approval.** Changing production DNS, deploying, or flipping `NETWORK_TAKEOVER` for live eliza.app users needs the founder's explicit "yes" in chat for that step. Approval for one step does not carry to the next.
4. **Live sends stay off** until the go-live checklist (section 7) is green and the founder approves.
5. **Coordinate before acting.** Two other Claude sessions own parts of this. Message them before you act on their areas, and do not click through the same dashboards they are using:
   - **"Synthetic people simulator and visualizer"** owns the platform: backend service, Railway, Cloudflare Pages and sites, GitHub settings.
   - **"PRD review and technical planning"** owns the Eliza side: plugin-network, the Eliza Cloud gateway, the character and the takeover flag.
   - Use `ListAgents` and `SendMessage` to reach them.
6. Use `scripts/wrangler.sh`, never bare `wrangler`. It refuses changes unless `NTWRK_ALLOW_DEPLOY=1` is set; set that only for an approved step.

## 2. Accounts and where things live

| Thing | Where |
|---|---|
| Sites (4 Pages projects: `ntwrk-love`, `slop-date`, `peon-biz`, `friends-help`) | Cloudflare account **shawmakesmagic** (`CLOUDFLARE_ACCOUNT_ID` from env, not in the repo) |
| DNS for ntwrk.love and peon.biz | Same shawmakesmagic account |
| DNS for slop.date and friends.help | Cloudflare account **Eliza Labs** (developer login). Domains move to shawmakesmagic after the 10-day transfer lock. Apex CNAMEs to `<project>.pages.dev` already exist. |
| Backend and Postgres | Railway project **the-network** (id `02295109-b29e-4e2c-b0d2-a2f5e88bb9e9`): service `backend`, `Postgres`, environment `production`. The backend is **not** connected to GitHub: it is deployed with `railway up --service backend` from `~/thenetwork-deploy` (a worktree of `origin/main`, linked with `railway link`), built from `deploy/backend/Dockerfile` (`RAILWAY_DOCKERFILE_PATH`). Domains: `backend-production-4dac.up.railway.app` (generated) and `api.ntwrk.love` (custom). |
| Observatory console (optional) | Railway service `observatory`, only behind Cloudflare Access |
| Eliza Cloud (gateway, shared agent) | The `eliza/` submodule. The takeover branch is `spike/network-plugin`; ask the Eliza-side owner for its deploy path. |
| iMessage line | Blooio, one shared line. Its webhook must point at the **Eliza gateway**, and at nothing else. |
| CI and deploys | GitHub Actions `ci.yml` and `deploy-sites.yml`. Environment `production` requires the founder's review and deploys only from `main`. |

## 3. Secrets the founder must paste (you prepare, they paste)

Status on 2026-10-09: **none of the founder-pasted secrets below are set yet**. Already set by the platform owner (generated, never printed): `PLATFORM_HASH_KEY`, `PLATFORM_PROXY_SECRET`, `PLATFORM_SESSION_SECRET`, `NETWORK_SERVICE_TOKENS` (admin@*), `NETWORK_DATABASE_URL` (service login, created at first boot), `MIGRATION_DATABASE_URL` (reference to Postgres), `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` (widget "The Network sites", created through the Cloudflare API for all four domains and their pages.dev names).

**Railway → the-network → backend → Variables** (sealed):

| Variable | Why | How the founder gets it |
|---|---|---|
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` | Web login codes. The backend won't boot without them. | Twilio console |
| `CLOUDFLARE_AI_TOKEN` | Clef: photo ratings and relay scam checks | Cloudflare → API Tokens → custom token, Account → **Workers AI: Read** |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Photo storage | R2 → Manage API tokens → **Object Read & Write**, scoped to the photo bucket |
| `BLOOIO_WEBHOOK_SECRET` | Signed inbound, if the service receives any Blooio calls | Blooio dashboard |
| `SURPLUS_API_KEY` | gpt-6-luna for any service-side model calls | Surplus |
| `SERVICE_TURN_SECRET` | Signs every Eliza gateway ⇄ service call (`/internal/turn`, `/internal/set-state`, `/internal/signals`, `/internal/updates`, `/internal/relay`, `/internal/deliver`), HMAC per `@thenetwork/plugin-network/svc-auth` | 32+ random bytes, generated once; the same value goes in Railway `backend` and in Eliza Cloud. The platform owner can generate it into Railway; the founder copies it from Railway's Variables page into Eliza Cloud. |

**GitHub → eliza-research/thenetwork → Settings → Environments → production → Secrets:**
- `CLOUDFLARE_API_TOKEN`: an account-owned token for the shawmakesmagic account with **Account → Cloudflare Pages: Edit** only, and a 90-day TTL. The founder can run `gh secret set CLOUDFLARE_API_TOKEN -R eliza-research/thenetwork --env production` and paste it.
- `RAILWAY_TOKEN`: a project token for `production`, only if production deploys go through Actions (deploy.md 4, option b).

**Each Pages project** has `PLATFORM_PROXY_SECRET` already (done 2026-10-08, piped from the backend's value without printing it). Do not add a `BACKEND_ORIGIN` secret to a Pages project: the build bakes the origin in and a secret of that name breaks the Function upload.

**Eliza Cloud:** the takeover variables (`NETWORK_TAKEOVER`, the service URL, the signing secret) and the Blooio webhook secret. The Eliza-side owner lists the exact names.

## 4. Railway (non-secret steps you can do)

Follow `docs/deploy.md` section 2. Summary:

1. Non-secret variables, **already set**: `PLATFORM_ENV=production`, `OTP_PROVIDER=twilio`, `PORT=8790`, `STAFF_PORT=4848`, `SHUTDOWN_GRACE_MS=25000`, `CLOUDFLARE_ACCOUNT_ID`, `CLEF_RATINGS=on`, `STOP_HELP_OWNER=gateway`, `R2_BUCKET=ntwrk-photos`, `R2_ACCOUNT_ID`, `PHOTO_VIEW_BASE_URL=https://slop.date`, `PLATFORM_DB_ENVIRONMENT_INIT=1`, `RAILWAY_DOCKERFILE_PATH=deploy/backend/Dockerfile`. **Still to set:** `PHOTO_STORAGE=r2`, only after the founder pastes the R2 keys.
2. The private R2 photo bucket **exists**: `ntwrk-photos` in the shawmakesmagic account (no public access, no r2.dev URL).
3. **First boot** (approved step), once the founder has pasted the secrets:
   - Deploy `backend` from `main` (`railway up --service backend` in `~/thenetwork-deploy` after `git checkout --detach origin/main`). Watch the logs: a missing secret is named, and the service refuses to start. Current state: the image builds from main; boot stops at `PLATFORM_ENV=production needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID`.
   - The first healthy boot applies every migration as `MIGRATION_DATABASE_URL`, moves the database environment from dev to production, and creates the `network_backend` login from `NETWORK_DATABASE_URL` (`ensureServiceLogin`); the log shows `"msg":"service login","created":true`.
   - Check `https://backend-production-<id>.up.railway.app/healthz`, then `https://api.ntwrk.love/healthz`. Both must return 200 and the `x-network-build` header.
   - After the first healthy boot, delete `PLATFORM_DB_ENVIRONMENT_INIT`, then restart.
4. **Domain** (approved step):
   - The `api` record **exists**: CNAME `api` → `b6fzhfvu.up.railway.app`, DNS only (grey), and `api.ntwrk.love` is added as a custom domain on Railway `backend` (port 8790). After Railway shows the certificate active, switch it to **proxied**, with SSL **Full (strict)**.
   - Then remove the `*.up.railway.app` domain, so Cloudflare is the only way in.
5. **Backups:**
   - Turn on Railway Postgres backups.
   - Do one test restore into a scratch database and record the result in `docs/runbook-platform.md`.
6. Optional: the observatory service behind Cloudflare Access (deploy.md 2.6).

## 5. Cloudflare Pages and DNS

1. **Pages projects.** All four exist and are deployed on `*.pages.dev`. Custom domains:
   - **slop.date, friends.help, peon.biz:** attached and serving 200. `www.peon.biz` is active too (verified 2026-10-08).
   - **ntwrk.love** (approved step): cut over from the Worker `ntwrk-love-site` to the `ntwrk-love` Pages project once `api.ntwrk.love` is healthy. Remove the Worker's route or custom domain, attach `ntwrk.love` and `www` to the Pages project, and verify with `curl -I`.
2. **slop.date and friends.help after the transfer lock (10 days):**
   - Move the domains from Eliza Labs to shawmakesmagic: Domain Registration → Move domain to account `CLOUDFLARE_ACCOUNT_ID`, then accept it in the destination account.
   - Re-create the CNAMEs if the zone moves, and re-check the Pages custom domains.
3. Run `bun run sites/sites.ts` with `DEPLOY_TARGET=production` before any manual Pages deploy; it refuses draft legal text and placeholders. Deploys normally go through `deploy-sites.yml` after the founder approves the `production` environment run.

## 6. GitHub

1. Make sure CI is green on `main`. It runs typecheck, `bun run plugins/build.ts --check`, the sites production build, `bun run sim`, and the integration and e2e job with Postgres.
2. Branch protection on `main`: require CI, no force pushes. Any change to repo settings needs the founder's OK.
3. The `production` environment already exists, with the founder as required reviewer and `main` only. The repo variables are already set: `CLOUDFLARE_ACCOUNT_ID`, `BACKEND_ORIGIN=https://api.ntwrk.love`, `MCP_URL`, `TURNSTILE_SITE_KEY`.
4. After the founder adds `CLOUDFLARE_API_TOKEN`, trigger `deploy-sites.yml` (manual dispatch, or a push to `main`). The founder approves the environment run, then the post-deploy check `deploy/smoke.ts` runs against all four sites.

## 7. Eliza live: eliza.app becomes an entry into The Network

The design is in `docs/design/eliza-conversation-layer.md`. Here is the flow and the prerequisites.

```
iMessage (Blooio, shared line)
  → Eliza gateway (signed inbound, dedupe, STOP fence, consent ledger)
  → shared agent "Eliza" with plugin-network
      → POST service /internal/turn  {from, to, text, messageId, transport, app?}
          handled → reply as given (routing, join, STOP/leave, looking-for, slop onboarding)
          open    → Eliza's model answers with MEMBER_CONTEXT; actions call service /internal/*
                    (set-state, updates, relay → relayItem with the Clef classifier; only `rendered` is sent)
Network service proactive sends → Eliza gateway /internal/deliver → Blooio
```

**Prerequisites, all of which must be true before go-live:**

1. **Service.** `/internal/turn`, `/internal/set-state`, `/internal/updates`, `/internal/relay` and `/internal/signals` are deployed and signed. Platform owner.
2. **Gateway.** `/internal/deliver` is deployed. The takeover code (`NETWORK_TAKEOVER`) is merged into the Eliza Cloud deploy branch. Eliza-side owner.
3. **One STOP owner.** The Blooio webhook for the shared line points only at the Eliza gateway, and the service has `STOP_HELP_OWNER=gateway`.
4. **eliza.app as an entry:**
   - The eliza.app home page and its "text Eliza" button lead into The Network on the same shared line.
   - The page copy says Eliza is The Network's agent, and links to ntwrk.love and the three apps.
   - Ask the Eliza-side owner who changes the eliza.app site. Whoever it is, coordinate with them.
5. **Existing eliza.app users.** Decide with the founder how to tell current eliza.app users about the change. They must not be silently enrolled in matching:
   - On their next message they get a one-time notice that Eliza is now The Network's agent, with what that means and how to opt out.
   - Matching needs the normal Network join and consent.
   - Under-18s follow the minors rule.
6. **The character:** "Eliza", speaking as The Network's agent with an app-aware voice. It must pass the Eliza-side owner's live eval.
7. **Sims and integration green.** `bun run sim` passes, the `/internal/turn` integration tests pass against real Postgres, and the Workerd harness passes.

**The go-live sequence** needs the founder's explicit approval at each starred step:

1. Staging. Turn on `NETWORK_TAKEOVER=1` in the staging Eliza Cloud, pointed at the staging service. Run the scripted conversation checks:
   - keyword join for each app;
   - no keyword → "friends, dating or work?";
   - STOP, HELP and leave-one-app;
   - a banned number refused;
   - a minor joining but never matched;
   - slop onboarding to a confirmed read-back;
   - a relay that goes through, and a scam that is held.
2. ★ Production shadow. Turn on takeover for the founder's test numbers only, if the gateway supports an allowlist; ask the Eliza-side owner. Live sends from the matching engine stay off. Every proactive proposal goes to the review queue.
3. ★ Production takeover for all eliza.app traffic. Flip `NETWORK_TAKEOVER=1`. Watch for one hour:
   - error rate and latency on `/internal/turn`;
   - STOP handled once;
   - no unhandled turns;
   - Blooio delivery failures under 2%.
4. ★ Live sends for slop.date in NYC, behind the review gate, per `docs/mvp-plan.md` section 13 (shadow first, then live).

**Rollback:**
- Set `NETWORK_TAKEOVER=0` in Eliza Cloud. eliza.app traffic goes back to the old behavior and STOP stays in the gateway.
- Turn live sends off in the service.
- Roll back Pages or Railway deployments from their dashboards (deploy.md 2.7 and 3.2).

## 8. Go-live checklist (all must be true)

- [ ] All secrets in section 3 pasted by the founder. Nothing in the repo.
- [ ] `api.ntwrk.love/healthz` 200, proxied, Full (strict); no `*.up.railway.app` domain.
- [ ] Postgres backups on; one restore tested.
- [ ] Four sites serving 200 on their domains; ntwrk.love on Pages; `deploy/smoke.ts` passes.
- [ ] CI green on `main`; `production` environment approval works.
- [ ] Blooio webhook points only at the Eliza gateway; STOP handled once, HELP answered.
- [ ] Banned number refused on site join, OTP, inbound and eliza.app.
- [ ] Minors: join allowed, never matched, never rated, never relayed (sims plus one live check with a test number).
- [ ] Clef ratings on; scores never visible (check the console, probes, reveals and relay output).
- [ ] Relay: Clef classifier wired; a scam test message is held; an honest message passes.
- [ ] Monitoring and alerts on (uptime, heartbeat, send failures, review SLA, safety queue); cost alerts on.
- [ ] Existing eliza.app users get the one-time notice; nobody is enrolled in matching without consent.
- [ ] The founder has approved each starred step in section 7.

## 9. When you finish

- Update `docs/deploy.md` and `docs/runbook-platform.md` with what changed. Put a short status note in `docs/mvp-plan.md`.
- Tell both owners in one message what you changed. Report to the founder what is live, what is still off, and any secret you were waiting on.
