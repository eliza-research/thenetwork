# Runbook: the platform in local dev (one backend, four sites)

This runbook starts the whole platform on your machine: the dev database, one Network service for every app, and the four sites. It then checks the main member flows with `curl`. It also lists the variables per app, what is gated, and what is not built.

The platform is one backend, one admin panel and one database for four apps with different sites: The Network (`ntwrk`, ntwrk.love), slop (`slop`, slop.date, dating), peon (`peon`, peon.biz, hiring) and friends (`friends`, friends.help, NYC friends). A person can join one app or several. The plan is `docs/research/2026-10-08-platform-architecture.md`. The scope is PRD Section 40 (founder decisions of 2026-10-08). The proposed PRD changes for what was built are in [prd-pending-edits.md](prd-pending-edits.md) (section 2). The production runbook is [runbook-real.md](runbook-real.md).

The backend follows the founder decisions of 2026-10-08 (AGENTS.md): the app id is `friends` (friends.help; migration 0007 renames the old `buddies` rows), 13+ may join every app and matching stays 18+, one line serves every app, STOP stops every app and "leave <app>" leaves one. Section 3 lists today's answers; the flows were checked end to end by `tests/e2e` (deleted 2026-10-08; git history at 16cde70).

**Warning: nothing here sends a text.** The service uses the dry-run adapter. It stores each message with status `dry_run`. The dev OTP provider prints the code to the service log. Use only the fictional 555-01xx numbers. Do not set `BLOOIO_ALLOW_SEND`, `NTWRK_LIVE_APPROVED` or any `<APP>_LIVE_APPROVED` flag.

## 1. What runs

| Part | Where | What it does |
|---|---|---|
| Dev Postgres | `localhost:54339` | `bun run db:migrate` runs on the database first. Use a database of your own (step 2). |
| Staff API | `127.0.0.1:4848` | The backend's private port: the staff API (`?app=<app>` or `/apps/<app>/...`). One network per row of `platform.networks` (`ntwrk:nyc`, `friends:nyc`, `peon:nyc`, `slop:nyc`) ticks once a minute under its own lock. |
| Backend (public) | `127.0.0.1:8790` | The shared backend (`deploy/backend` createBackend, the same code as `bun run start:backend`): `/api/*`, `/webhooks/blooio[/<app>]`, `/mcp`, `/mcp/openai`, `/oauth/*`, `/.well-known/oauth-*`, `/healthz`. The app comes only from a request a site router signed (`packages/platform/src/proxy.ts`); an unsigned request to `:8790` names no app. |
| Sites | `127.0.0.1:5101`-`5104` | ntwrk.love, slop.date, peon.biz, friends.help (`scripts/sites-dev.ts`). Their backend paths run through the production router code (`deploy/router.ts`) and are signed with a dev `PLATFORM_PROXY_SECRET` (a fresh one per run). Each site is the MCP issuer of its app: an MCP client connects to `http://127.0.0.1:5102/mcp` for slop. Open the sites at `127.0.0.1`, not `localhost`: the MCP pages check the Origin. |

Matching is off for slop and peon (`platform.networks.matching_enabled = false`) until the engine session ships their packs. The staff switch refuses to turn it on for them (`409 matching_not_allowed`). For ntwrk and friends, a new stored state starts with matching off, and an admin turns it on.

## 2. Start it

1. Pick a database name of your own, so that you do not change the shared dev `network` database.
2. Start everything:

```bash
NETWORK_DATABASE_URL=postgres://$USER@localhost:54339/platform_dev bun run platform:dev
```

The script refuses a database that is not on `localhost:54339`. It refuses to run when `NODE_ENV` or `PLATFORM_ENV` is `production`, and it sets `PLATFORM_ENV=dev` (the dev shortcuts need it). It prints the dev staff tokens once (`admin:dev-admin,reviewer:dev-reviewer,safety:dev-safety,analyst:dev-analyst`). Set `NETWORK_SERVICE_TOKENS` to use your own, for example `reviewer@slop:<token>` for a reviewer of slop only.

Run `bun run platform:dev --no-sites` to start the database and the backend only, and `--verbose` to log every request.

The end-to-end tests that started this stack in one process (`tests/e2e`) were deleted on 2026-10-08; they are in git history at 16cde70.

To run the parts one at a time (each command was checked on 2026-10-08):

```bash
psql "postgres://$USER@localhost:54339/postgres" -c "create database platform_dev"
bun run db:migrate -- --url postgres://$USER@localhost:54339/platform_dev     # 0001-0006; a second run applies nothing
PLATFORM_ENV=dev NETWORK_DATABASE_URL=postgres://$USER@localhost:54339/platform_dev \
  bun run packages/network/service/main.ts --once --dry-run                    # one tick of every network, then exit
bun run sites:dev                                                              # the four sites only, backend paths proxied to :8790 (unsigned X-Forwarded-Host unless PLATFORM_PROXY_SECRET is set)
```

`bun run db:migrate` with no `--url` and no `NETWORK_DATABASE_URL` migrates the shared dev `network` database. It refuses a host that is not local. `main.ts --once --dry-run` prints one line per network, for example `network slop:nyc: sends dry-run, review "human", matching not allowed (platform.networks)`, then `slop:nyc: tick done`.

## 3. Check the flows with curl

Each site keeps its own cookie (`sid_<app>` in dev), so use one cookie jar per site. The code for each login is in the service log.

1. Ask for a code on slop.date (port 5102). Read the code in the service log.
2. Send the code. Join slop.
3. Do steps 1 and 2 again on friends.help (port 5104) with the same phone.
4. Read `/api/me` on each site. Each one shows only its own app.
5. Stop messages on slop: **every app stops** (PRD 40.3, STOP on the shared line or the site's stop button). "leave slop.date" or the leave button leaves slop only.
6. Export the friends data. Leave friends (`scope: "app"`). slop stays.

### What you should see (2026-10-08)

The transcript captured on 2026-10-07 is gone: it showed the old `buddies` id, an 18+ join age and a stop that paused one app, none of which is true now. `tests/e2e/platform.e2e.test.ts` (deleted 2026-10-08; git history at 16cde70) ran these steps on every change, with four built sites, the router, the backend, the MCP server and Postgres. The table lists what the service answers today; each row is checked by the e2e, platform or service tests.

| Request | Answer today |
|---|---|
| `GET /api/app` on any site | that site's app only; `minJoinAge` 13 and `minMatchAge` 18 for all four; ntwrk `joinMode` `invite` on the web |
| `POST /api/auth/otp/verify` with a wrong code | `{"ok":false,"error":"invalid_code"}` |
| `POST /api/join` with age 12 | refused `under_age`; the age goes to the phone's age floor, so a retry with another age is refused too |
| `POST /api/join` on slop with age 15 | joined; the member has no dating opt-in, is never matched, and cannot upload photos (`adults_only`) |
| `GET /api/me` on another site with the first site's cookie | 401: each site has its own cookie |
| Stop messages on one site (or STOP on the shared line) | every app stops for that number; "leave <app>" or the leave button leaves one app |
| `POST /api/me/delete {"scope":"all"}` within 10 minutes of a login | `{"ok":true}`; later, 403 `reauth` |
| Any request straight to the backend without the router's signature, in staging or production | 421 `edge_required` |

## 4. Rules the service keeps

| Rule | How |
|---|---|
| The app of a text | One line serves every app (`/webhooks/blooio`, `BLOOIO_WEBHOOK_SECRET`). A row in `platform.app_lines` for the receiving line names the app. Without a row: a message that is only an app's word ("slop", "slop.date", "friends.help", "join peon") goes to that app; the answer to a join the person started goes to that join; a member's message goes to the app with their newest open item (a probe or plan they have not answered), else the app that wrote to them last; anything else goes to The Network. An app's name inside a sentence ("my ex is on slop.date") never moves a member's message. The member lookup across apps is `platform.member_apps` (migration 0007). `/webhooks/blooio/<app>` stays for an app that ever gets its own line. |
| No keyword | A stranger with no keyword joins The Network by text (first name and age). Then The Network asks "What are you looking for: friends, dating, work, or all of these? ... All of these apps are powered by The Network." The answer enrolls them in the matching apps, each with its own join age check, opt-in and member, and The Network confirms in one text. The question waits in `platform.pending_texts`, so a restart keeps it. The web join for ntwrk stays invite-only. |
| Joining by text | On an open app (and on The Network from the shared line), someone who is not a member gets "To join ..., reply with your first name and your age". Nothing is stored until a first name and an age that passes the app's join age (13) arrive. The question waits in `platform.pending_texts` (a keyed phone hash, never the phone). A bare number is an age only in a short answer ("Sam, 29"), not in a sentence ("7 works for me"). Then the person (if new), the membership, the opt-in (with the words they answered) and the network member are created, and the Network welcomes them. Under the join age: the app's kind decline; for that app only the age is kept, on the phone's age floor, so a retry with an older age is refused. |
| Lowest age | The lowest age ever stated for a phone wins on every app: the person's `lowest_age` and `platform.age_floor` (a keyed phone hash and an age). An age stated in chat (first person, present tense) lowers it, and every app's member follows, so a minor anywhere is single-player everywhere. An attested adult who claims to be under 13 is held for staff by the Network and recorded as 13 here (a minor, nothing deleted). A join gets the lowest age, not the age typed. Delete everything keeps the age floor and the person (a tombstone revived by the same phone), so blocks still hold. `/api/me` does not show the age. |
| Invite-only (ntwrk, web and an app's own line) | On a site, a person who is not invited gets the invite-only answer. Nothing is stored. Staff invite a number with `POST /apps/ntwrk/invite {"phone": ...}` (admin): an `invited` membership and one invitation text. The reply with name and age (or a web join) is the join. A number that deleted everything is not invited. |
| Recycled numbers | A known number not seen for 12 months (no login, no message) is put on hold at its next login or message: it has no person, `/api/me` says `reason: "review"`, and export, leave, delete and join answer 403 or 400 `review`. STOP still works. Staff list holds with `GET /holds` and decide with `POST /holds {"phone", "decision": "same_owner"|"new_owner"}` (admin@*). `new_owner` deletes the old account and starts the number clean. |
| Several apps | A person who already uses another app gets the link notice after the welcome. It names no app. "SHARE" stores base-profile grants (first name, city, interests). A grant copies nothing. |
| STOP | Every app on the number (founder decision 7): STOP, STOP ALL, the reasonable-means phrasings in English and Spanish ("please stop texting me", "no más mensajes"), and the site's stop button. Only an app's own line with `PLATFORM_STOP_SCOPE=app` stops that app alone. START: the app of the line. Each one writes one `platform.consent_events` row per message (`ref`), opts out the members, and pauses the memberships. Every send reads the ledger, the member's `opted_out` and the suppression hash: such a send gets `refused_opted_out` (compliance texts still go). |
| Leave | "leave slop" or "leave slop.date" (any line), or the site's leave button: the forget path for that app only. |
| Blocks | A block on any app is person to person (`platform.person_blocks`). Each app's snapshot reads it as a "blocked" edge when both people are members there. |
| Person cap | At most 3 proactive messages a day for one person across all apps, taken when the message is handed to the adapter: `platform.person_cap_take` (SECURITY DEFINER, one lock for every app) counts and records in `platform.person_sends`, so two networks delivering at once cannot both pass, and it works under the `network_service` role. Over the cap: status `refused_person_cap`, not sent. |
| Reviewer of record | With `NETWORK_SERVICE_CONSOLE_TOKEN` set, a request with that token may name the signed-in person in `X-Network-Staff-Id`; the audit and the review record that person. The header from any other token is ignored. |
| Live sends | Each app needs `BLOOIO_ALLOW_SEND=1` and its own `<APP>_LIVE_APPROVED=1`; the line's HELP/STOP replies need `BLOOIO_ALLOW_SEND=1` and any app live. platform:dev never sends. |

## 5. Environment variables

The service reads these. **[FOUNDER]** marks a flag that only the founder may set. **[CREDENTIALS]** marks a secret. In dev, `platform:dev` sets safe defaults and never sends.

| Variable | Default | Per app | What it does |
|---|---|---|---|
| `NETWORK_DATABASE_URL` | `DATABASE_URL` | no | Postgres with the `network` and `platform` schemas (`bun run db:migrate`). `platform:dev` accepts only `localhost:54339`. |
| `NETWORK_SERVICE_TOKENS` | dev tokens in `platform:dev`; none in `main.ts` | yes | Staff tokens: `role@app:<t>` (one app) or `role@*:<t>` (every app). Outside production `role:<t>` still means every app; in production it is refused. **[CREDENTIALS]** |
| `NETWORK_SERVICE_CONSOLE_TOKEN` | none | no | The admin console's own token (also one of the tokens). Only it may name the reviewer of record (`X-Network-Staff-Id`). **[CREDENTIALS]** |
| `BLOOIO_WEBHOOK_SECRET` | `whsec_dev_shared` in `platform:dev` | no | The shared line's webhook (`/webhooks/blooio`). Without it, 503. **[CREDENTIALS]** |
| `<APP>_BLOOIO_WEBHOOK_SECRET` | `whsec_dev_<app>` in `platform:dev` | yes | One app's line (`/webhooks/blooio/<app>`), for example `SLOP_BLOOIO_WEBHOOK_SECRET`. **[CREDENTIALS]** |
| `NETWORK_CHANNEL` | dry-run | no | `blooio` uses the Blooio adapter (`BLOOIO_API_KEY`, `BLOOIO_FROM`). `--dry-run` always wins. |
| `BLOOIO_ALLOW_SEND` | off | no | Must be `1` for any live send. **[FOUNDER]** |
| `<APP>_LIVE_APPROVED` | off | yes | `1` for that app to send (`NTWRK_LIVE_APPROVED`, `SLOP_LIVE_APPROVED`, `PEON_LIVE_APPROVED`, `FRIENDS_LIVE_APPROVED`). No other app's flag is needed. **[FOUNDER]** |
| `PLATFORM_API_PORT` | 8790 | no | The public API (`/api/*`) |
| `PLATFORM_API_ORIGIN` | `http://127.0.0.1:8790` | no | Where `sites:dev` proxies `/api/*` |
| `NETWORK_SERVICE_HOST`, `NETWORK_SERVICE_PORT` | `127.0.0.1`, 4848 | no | Staff API and webhooks. `X-Forwarded-Host` from the dev proxy is trusted only with `PLATFORM_ENV=dev` on a local bind. |
| `PLATFORM_PROXY_SECRET` | none | no | The secret the site routers (Cloudflare Workers) sign the visitor IP and the site host with (`packages/platform/src/proxy.ts`: HMAC-SHA256 over method, path, host, IP and time; refused after 60 s). Without a valid signature the API uses the socket address and its own Host map; a header a client sets never picks the app or the rate-limit bucket. Required in production, at least 32 characters. **[CREDENTIALS]** |
| `PLATFORM_SESSION_SECRET` | a dev key (dev only) | no | The key for the stored session token hashes. Required in production, at least 32 characters. **[CREDENTIALS]** |
| `PLATFORM_STOP_SCOPE` | every app | no | `app` makes STOP on an app's own line stop that app only. On the shared line STOP always stops every app. |
| `PLATFORM_HASH_KEY` | a dev key (dev only) | no | The key for phone, IP and code hashes (rate limits, suppression, age floor). Required outside `PLATFORM_ENV=dev`. Changing it orphans old suppression hashes and age floors. **[CREDENTIALS]** |
| `OTP_PROVIDER` | the dev console (dev only) | no | `twilio` uses Twilio Verify with `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` **[CREDENTIALS]**. The dev console prints codes and runs only with `PLATFORM_ENV=dev`. |
| `TURNSTILE_SECRET_KEY` | none (dev bypass) | no | Cloudflare Turnstile check on `otp/start`. Required outside `PLATFORM_ENV=dev` (`main.ts` refuses to start without it). The sites send no Turnstile token yet, so a staging or production `otp/start` answers 400 `turnstile` until they do. |
| `PLATFORM_ENV` | none | no | Required by `main.ts`: `production`, `staging` or `dev`. Outside dev, `main.ts` refuses to start without `OTP_PROVIDER=twilio` and its three credentials, `TURNSTILE_SECRET_KEY`, `PLATFORM_PROXY_SECRET`, `PLATFORM_HASH_KEY`, `PLATFORM_SESSION_SECRET`, a database URL and review mode human (`bootConfigProblems` in `packages/platform/src/env.ts`). Detection fails closed: only `dev` gets the dev shortcuts (console codes, Turnstile bypass, dev hash key, `X-Forwarded-Host`, cookies without `Secure`). It must match `platform.settings.environment` or the service refuses to start. `bun test` counts as dev (`NODE_ENV=test`); `NODE_ENV=development` does not. `NODE_ENV=production` also means production. |

The Observatory has its own per-app variables (`OBSERVATORY_DATABASE_URL_<APP>`, `OBSERVATORY_PLATFORM_DATABASE_URL`, `role@app` in `OBSERVATORY_TOKENS` and `OBSERVATORY_ROLES`): [runbook-real.md](runbook-real.md) section 4.

The app policy is data, not variables: `platform.apps` (join mode, join age, match age) and `platform.networks` (`matching_enabled`, run hour). The code defaults are in `packages/platform/src/apps.ts`. Change the rows for a running server, and the file for tests and the simulator.

## 6. What is gated

| Gate | Where | State in dev |
|---|---|---|
| Live sends | `BLOOIO_ALLOW_SEND=1` and `<APP>_LIVE_APPROVED=1`, read on every delivery | Off. `platform:dev` uses the dry-run adapter and warns if a flag is set. |
| Human review | Every opportunity waits for a person. The service refuses any review mode but "human". | On |
| Matching per network | `platform.networks.matching_enabled` (slop and peon false), then the admin switch | slop and peon cannot be turned on (409). ntwrk and friends start off; an admin turns them on. |
| Join age | `platform.apps.min_join_age` and the Network's `app` option | 13 on every app; matching 18+ |
| Invite-only | `platform.apps.join_mode` (`invite` for ntwrk) | A web or text join needs an `invited` membership |
| OTP abuse limits | `OtpService`: US and Canadian numbers only (no Caribbean, toll-free or premium codes), 3 sends per number per hour and 6 a day across every app, 10 per IP per hour (the socket address or the IP a site router signed), 30 s gap; a refused request is not counted; a global 500 sends an hour (an ALERT line in the log), 10-minute expiry, 5 tries per code, 10 code checks per number and 30 per IP an hour across apps, one use | On |
| Same answer for every phone | `otp/start` answers `{ok:true}` after at least 700 ms, known or not | On |
| Cross-site requests | POST must send JSON (16 KB at most); a cross-site `Origin` or `Sec-Fetch-Site: cross-site` gets 403; an app that does not match the Host gets 400 `app_mismatch`; production accepts only the four domains as hosts | On |
| Dev shortcuts | The dev OTP console, the Turnstile bypass, the dev hash key and the trusted `X-Forwarded-Host` run only with `PLATFORM_ENV=dev` | On |
| Site security headers | Each built site has `dist/_headers` (CSP `default-src 'self'`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `nosniff`); `sites:dev` sends the same | On |
| Fake numbers in production | A trigger refuses 555-01xx numbers when `platform.settings.environment = 'production'` | Off (dev) |
| Deploys | `scripts/wrangler.sh` refuses changing commands without `NTWRK_ALLOW_DEPLOY=1` **[FOUNDER]** | Nothing is deployed |

## 7. What is not built, and known gaps

Work to match the founder decisions (PRD 40, AGENTS.md):

- **Founder copy.** The no-keyword question and confirmation (`LOOKING_FOR_ASK`, `enrolledText` in `packages/network/service/service.ts`) and the new STOP and HELP texts (`packages/platform/src/apps.ts`) are drafts. They need the CONTRIBUTING 3.5 videos.
- **Sites.** The sites must send the canonical opt-in text (or its version) that `GET /api/app` returns (`consent`); any other wording gets 400 `consent_wording`. Delete everything needs a login in the last 10 minutes (403 `reauth`).
- **Compliance text on the sites.** PRD 40.7 makes compliance a backlog, not a gate. The slop.date join still shows a safety notice step before the phone step, and peon.biz says that automated ranking is off for NYC roles until a bias audit. Founders should say whether to keep them as text.

Not built:

- The demo replay (`GET /api/demo` is 404; the sites hide the section).
- The share UI (`POST /api/me/share` stores grants; no site shows it; no engine view reads grants).
- Turnstile on the sites, and the carrier lookup (VoIP, landline, recent port).
- Member invites by first name in production: the Network's invite flow calls `ctx.invite`, which the service does not supply, so "here's an invite link" names no link. Staff invites by phone work.
- The `cross_app_leak` judge invariant in the simulator and the lab (`test/crossapp.test.ts` checks it in one test world).
- App packs for slop, peon and friends (the engine session owns them), and the app-specific tables (peon orgs, roles and applications; slop dating preferences; `facets.sensitive_class`).
- The NC ledger in the service. The service passes no `onLedger` or `capital` to its networks, so no capital events are stored and the levers use their floors ([network.md](network.md) 7.1). The planner and the plan lane are on (the default).
- Production routing of `/api/*` on each domain. The site `wrangler.toml` files are assets only.

Known gaps:

- Joins by text that wait for a name or an age, and SHARE offers, live in memory. A restart asks again.
- The first-name parser for joins by text is a heuristic ("I'm 29 and in Brooklyn" may read "Brooklyn" as the name).
- A stop from the web sends no text confirmation. The membership shows `paused`.
- The service's other reads (address book, health, export) set no `app.app_id`, so under the `network_service` role they see nothing. Run the service as a login that may read the network schema until each read runs in a unit with `app.app_id` set.
- Two networks can send to one person at the same moment; the cap counts committed rows, so it can refuse both rather than let both pass. A message held for quiet hours counts as sent.
- `network.channel_identities` allows one member per phone, so platform members keep their phone in `platform.phone_identities` only. The console PII reveal reads `channel_identities` and does not see them.

## 8. Checks

The unit and end-to-end tests were deleted on 2026-10-08 (founder decision: simulations only). What remains:

```bash
bun run security                                      # pending the founder's decision: platform RLS and composite keys, CSRF, enumeration and OTP limits, MCP OAuth PKCE, the backend "two logins" RLS check (dev Postgres)
bun run sim --only evals                              # the opt-out corpus, keywords and per-app leave, the leak guard
DEPLOY_TARGET=production bun run sites/sites.ts       # the four sites build (refuses draft legal text)
bun run typecheck
```

The security tests make a database of their own on the dev cluster and drop it afterwards. Coverage given up with the deleted tests: the full-stack e2e run, the site contract and 10DLC wording checks, the service and cross-app tests, and the console tests (git history at 16cde70).

## 9. Stop it

Press Ctrl-C. Then drop your database if you do not need it again:

```bash
psql "postgres://$USER@localhost:54339/postgres" -c "drop database if exists platform_dev with (force)"
```

The sites build into `sites/<domain>/dist`. Delete those folders if you do not need them.
