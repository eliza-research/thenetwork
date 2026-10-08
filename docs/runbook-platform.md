# Runbook: the platform in local dev (one backend, four sites)

This runbook starts the whole platform on your machine: the dev database, one Network service for every app, and the four sites. It then checks the main member flows with `curl`. It also lists the variables per app, what is gated, and what is not built.

The platform is one backend, one admin panel and one database for four apps with different sites: The Network (`ntwrk`, ntwrk.love), slop (`slop`, slop.date, dating), peon (`peon`, peon.biz, hiring) and buddies (`buddies`, buddies.nyc, NYC friends). A person can join one app or several. The plan is `docs/research/2026-10-08-platform-architecture.md`. The scope is PRD Section 40 (founder decisions of 2026-10-08). The proposed PRD changes for what was built are in [prd-edits-2026-10-08-platform.md](prd-edits-2026-10-08-platform.md). The production runbook is [runbook-real.md](runbook-real.md).

**Caution: the code is behind two founder decisions.** PRD 40 and AGENTS.md rename buddies.nyc to friends.help (app id `friends`) and let people aged 13 and up join every app (matching stays 18+). The code in this worktree still uses `buddies` and an 18+ join age for slop, peon and buddies. This runbook describes the code as it is. Section 7 lists the work.

**Warning: nothing here sends a text.** The service uses the dry-run adapter. It stores each message with status `dry_run`. The dev OTP provider prints the code to the service log. Use only the fictional 555-01xx numbers. Do not set `BLOOIO_ALLOW_SEND`, `NTWRK_LIVE_APPROVED` or any `<APP>_LIVE_APPROVED` flag.

## 1. What runs

| Part | Where | What it does |
|---|---|---|
| Dev Postgres | `localhost:54339` | `bun run db:migrate` runs on the database first. Use a database of your own (step 2). |
| Network service | `127.0.0.1:4848` | One network per row of `platform.networks`: `ntwrk:nyc`, `buddies:nyc`, `peon:nyc`, `slop:nyc`. Each network ticks once a minute under its own lock. Webhooks: `POST /webhooks/blooio` (the shared line) and `POST /webhooks/blooio/<app>` (one app's line). Staff API: `?app=<app>` or `/apps/<app>/...`. |
| Public API | `127.0.0.1:8790` | `/api/*` for the sites. The app comes from the Host header (or the dev proxy's `X-Forwarded-Host`). |
| Sites | `127.0.0.1:5101`-`5104` | ntwrk.love, slop.date, peon.biz, buddies.nyc (`scripts/sites-dev.ts`). Each site proxies `/api/*` to `:8790`. |

Matching is off for slop and peon (`platform.networks.matching_enabled = false`) until the engine session ships their packs. The staff switch refuses to turn it on for them (`409 matching_not_allowed`). For ntwrk and buddies, a new stored state starts with matching off, and an admin turns it on.

## 2. Start it

1. Pick a database name of your own, so that you do not change the shared dev `network` database.
2. Start everything:

```bash
NETWORK_DATABASE_URL=postgres://$USER@localhost:54339/platform_dev bun run platform:dev
```

The script refuses a database that is not on `localhost:54339`. It refuses to run when `NODE_ENV` or `PLATFORM_ENV` is `production`, and it sets `PLATFORM_ENV=dev` (the dev shortcuts need it). It prints the dev staff tokens once (`admin:dev-admin,reviewer:dev-reviewer,safety:dev-safety,analyst:dev-analyst`). Set `NETWORK_SERVICE_TOKENS` to use your own, for example `reviewer@slop:<token>` for a reviewer of slop only.

Run `bun run platform:dev --no-sites` to start the database and the service only.

To run the parts one at a time (each command was checked on 2026-10-08):

```bash
psql "postgres://$USER@localhost:54339/postgres" -c "create database platform_dev"
bun run db:migrate -- --url postgres://$USER@localhost:54339/platform_dev     # 0001-0006; a second run applies nothing
PLATFORM_ENV=dev NETWORK_DATABASE_URL=postgres://$USER@localhost:54339/platform_dev \
  bun run packages/network/service/main.ts --once --dry-run                    # one tick of every network, then exit
bun run sites:dev                                                              # the four sites only, /api/* proxied to :8790
```

`bun run db:migrate` with no `--url` and no `NETWORK_DATABASE_URL` migrates the shared dev `network` database. It refuses a host that is not local. `main.ts --once --dry-run` prints one line per network, for example `network slop:nyc: sends dry-run, review "human", matching not allowed (platform.networks)`, then `slop:nyc: tick done`.

## 3. Check the flows with curl

Each site keeps its own cookie (`sid_<app>` in dev), so use one cookie jar per site. The code for each login is in the service log.

1. Ask for a code on slop.date (port 5102). Read the code in the service log.
2. Send the code. Join slop.
3. Do steps 1 and 2 again on buddies.nyc (port 5104) with the same phone.
4. Read `/api/me` on each site. Each one shows only its own app.
5. Stop messages on slop. buddies stays active.
6. Export the buddies data. Leave buddies (`scope: "app"`). slop stays.

### Transcript (2026-10-07, this worktree)

The commands below ran against `bun run platform:dev` on a scratch database (`platform_dev_check`, dropped afterwards). The cookie jar flags (`-c`, `-b`) are left out of the printed commands. The output is not edited.

```text
$ curl -s -X POST http://127.0.0.1:5102/api/auth/otp/start -H content-type: application/json -d {"phone":"+12125550123"}
{"ok":true}

service log: [otp dev] slop +1 •••-•••-0123 code 431634

$ curl -s -X POST http://127.0.0.1:5102/api/auth/otp/verify -H content-type: application/json -d {"phone":"+12125550123","code":"431634"}
{"ok":true}

$ curl -s -X POST http://127.0.0.1:5102/api/join -H content-type: application/json -d {"firstName":"Rae","age":30,"neighborhood":"Greenpoint","interests":["climbing"],"consent":{"sms":true,"wording":"I agree to get texts from this app about introductions I asked for. Message frequency varies. Reply STOP to opt out, HELP for help."}}
{"ok":true,"membership":{"state":"active","joinedAt":"2026-10-08T03:11:00.164Z","firstName":"Rae"}}

$ curl -s -X POST http://127.0.0.1:5104/api/auth/otp/start -H content-type: application/json -d {"phone":"+12125550123"}
{"ok":true}

service log: [otp dev] buddies +1 •••-•••-0123 code 376453

$ curl -s -X POST http://127.0.0.1:5104/api/auth/otp/verify -H content-type: application/json -d {"phone":"+12125550123","code":"376453"}
{"ok":true}

$ curl -s -X POST http://127.0.0.1:5104/api/join -H content-type: application/json -d {"firstName":"Rae","age":30,"neighborhood":"Greenpoint","interests":["climbing"],"consent":{"sms":true,"wording":"I agree to get texts from this app about introductions I asked for. Message frequency varies. Reply STOP to opt out, HELP for help."}}
{"ok":true,"membership":{"state":"active","joinedAt":"2026-10-08T03:11:01.518Z","firstName":"Rae"}}

$ curl -s http://127.0.0.1:5102/api/me
{"app":"slop","phoneMasked":"+1 •••-•••-0123","membership":{"state":"active","joinedAt":"2026-10-08T03:11:00.164Z","firstName":"Rae"},"canJoin":false}

$ curl -s http://127.0.0.1:5104/api/me
{"app":"buddies","phoneMasked":"+1 •••-•••-0123","membership":{"state":"active","joinedAt":"2026-10-08T03:11:01.518Z","firstName":"Rae"},"canJoin":false}

$ curl -s -X POST http://127.0.0.1:5102/api/me/stop -H content-type: application/json -d {}
{"ok":true}

$ curl -s http://127.0.0.1:5102/api/me
{"app":"slop","phoneMasked":"+1 •••-•••-0123","membership":{"state":"paused","joinedAt":"2026-10-08T03:11:00.164Z","firstName":"Rae"},"canJoin":false}

$ curl -s http://127.0.0.1:5104/api/me
{"app":"buddies","phoneMasked":"+1 •••-•••-0123","membership":{"state":"active","joinedAt":"2026-10-08T03:11:01.518Z","firstName":"Rae"},"canJoin":false}

$ curl -s http://127.0.0.1:5104/api/me/export
{"app":"buddies","exportedAt":"2026-10-08T03:11:01.601Z","phone":"+12125550123","membership":{"memberId":"buddies_c9937297-5511-4f55-a777-7ab0ba8ecd37","state":"active","firstName":"Rae","profile":{"interests":["climbing"],"neighborhood":"Greenpoint"},"joinedAt":"2026-10-08T03:11:01.518Z"},"consent":[{"state":"opted_in","source":"web_form","wording":"I agree to get texts from this app about introductions I asked for. Message frequency varies. Reply STOP to opt out, HELP for help.","at":"2026-10-08T03:11:01.518Z"}],"network":{"member":{"id":"buddies_c9937297-5511-4f55-a777-7ab0ba8ecd37","name":"Rae","home_city":"nyc","home_area":"Greenpoint","age":30,"account_status":"active","opted_out":false,"joined_at":"2026-10-08T03:11:01.524Z"},"facets":[{"kind":"interest","value":"climbing","tags":["climbing"],"provenance":"said","status":"confirmed","valid_from":"2026-10-08T03:11:01.524Z"}],"intents":[],"presence":[{"city":"nyc","type":"home","areas":["Greenpoint"]}],"messages":[{"direction":"outbound","body":"Hi Rae, I'm your buddies.nyc friend (an AI). Now and then I'll suggest a person or plan that seems worth your time, and you can always ask me for something. Reply STOP anytime to opt out. To start: what would you like more of in your life right now?","ts":"2026-10-08T03:11:01.528Z"}],"opportunities":[]}}

$ curl -s -X POST http://127.0.0.1:5104/api/me/delete -H content-type: application/json -d {"scope":"app"}
{"ok":true}

$ curl -s http://127.0.0.1:5104/api/me
{"app":"buddies","phoneMasked":"+1 •••-•••-0123","membership":null,"canJoin":true}

$ curl -s http://127.0.0.1:5102/api/me
{"app":"slop","phoneMasked":"+1 •••-•••-0123","membership":{"state":"paused","joinedAt":"2026-10-08T03:11:00.164Z","firstName":"Rae"},"canJoin":false}
```

What the transcript shows:

- One phone joined two apps. Each join created the network member for that app and sent the welcome through the normal send path. The buddies welcome uses the buddies brand words ("your buddies.nyc friend"), not "the Network".
- `/api/me` on each site names only its own app. Nothing says that the phone uses the other app.
- Stop on slop paused slop only. buddies stayed active.
- The export holds only buddies data: the member, the facts given at join, the welcome, and the buddies consent event. It does not hold the word "slop".
- Leave on buddies ran the forget path: the buddies membership is gone, slop stays.

The database after the run:

```text
 app_id  | account_status | opted_out | name | messages
---------+----------------+-----------+------+----------
 buddies | removed        | f         |      |        0
 slop    | active         | t         | Rae  |        1

 app_id  |  state  | first_name
---------+---------+------------
 buddies | removed |
 slop    | paused  | Rae

 app_id  |   state   |  source
---------+-----------+----------
 slop    | opted_in  | web_form
 buddies | opted_in  | web_form
 slop    | opted_out | web_form
 buddies | opted_out | leave
```

Staff health per app (the analyst token): `curl -s -H 'authorization: Bearer dev-analyst' 'http://127.0.0.1:4848/health?app=slop'` gave `"network":"slop:nyc"`, `"matchingAllowed":false`, `"matchingEnabled":false`, and a `networks` list with all four networks.

### Checked again (2026-10-08, the docs pass)

The same steps ran again on a scratch database (`docs_check_platform`, dropped afterwards) with the fictional number +1 212 555 0142. The results matched the transcript. These extra checks gave:

| Request | Answer |
|---|---|
| `GET /api/app` on 5102 and on 5101 | `{"id":"slop",...,"joinMode":"open","minJoinAge":18}`; `{"id":"ntwrk","name":"The Network",...,"joinMode":"invite","minJoinAge":13}` |
| `POST /api/auth/otp/verify` with a wrong code | `{"ok":false,"error":"invalid_code"}` |
| `POST /api/join` on slop with age 17 | `{"ok":false,"error":"under_age","message":"Thanks for your interest in slop. You need to be at least 18 to join, so we can't sign you up."}` |
| `GET /api/me` on ntwrk for a person who is not invited | `"membership":null,"canJoin":false,"reason":"invite_only"`; the join answers `invite_only` with the polite text |
| `GET /api/me` with no cookie | 401 |
| `POST :8790/api/auth/otp/start` with `Host: evil.example` | 404 `unknown_app` |
| `POST /api/me/delete {"scope":"all"}` | `{"ok":true}`. Then `/api/me` is 401, `platform.phone_identities` is empty, one suppression hash and one tombstone person (`deleted_at` set) stay, no membership stays. |
| `GET /api/demo` | 404 `not_found`: the demo replay is not served yet (section 7) |
| `POST /apps/slop/matching {"on":true}` (admin) | 409 `matching_not_allowed` |
| `POST /matching?app=buddies` with the reviewer token | 403 `needs role admin@buddies` |

A gap showed up in the first run: after the age-17 join was refused, the same session joined slop with age 30. It is fixed: a refusal writes the age to the phone's age floor (`platform.age_floor`, a keyed hash and an age, no app), and the retry is refused.

## 4. Rules the service keeps

| Rule | How |
|---|---|
| The app of a text | `/webhooks/blooio/<app>` is that app's line (secret `<APP>_BLOOIO_WEBHOOK_SECRET`). On `/webhooks/blooio` (the shared line, `BLOOIO_WEBHOOK_SECRET`) a row in `platform.app_lines` for the receiving line names the app. Without a row: a message that is only an app's word ("slop", "slop.date", "join slop") goes to that app; the answer to a join the person started goes to that join; a member's message goes to their app (several apps: the app that wrote to them last); anything else goes to The Network. An app's name inside a sentence ("my ex is on slop.date") never moves a member's message. The member lookup across apps is `platform.member_apps` (migration 0006). |
| Joining by text | On an open app, someone who is not a member gets "To join ..., reply with your first name and your age". Nothing is stored until a first name and an age that passes the app's join age arrive. A bare number is an age only in a short answer ("Sam, 29"), not in a sentence ("7 works for me"). Then the person (if new), the membership, the opt-in (with the words they answered) and the network member are created, and the Network welcomes them. Under the join age: the app's kind decline; for that app only the age is kept, on the phone's age floor, so a retry with an older age is refused. |
| Lowest age | The lowest age ever stated for a phone wins on every app: the person's `lowest_age` and `platform.age_floor` (a keyed phone hash and an age). Delete everything keeps the age floor. `/api/me` does not show it (`canJoin` is true until the join is refused), so it never shows another app's fact. |
| Invite-only (ntwrk) | Someone who is not a member gets one short invite-only reply a day. Nothing is stored. Staff invite a number with `POST /apps/ntwrk/invite {"phone": ...}` (admin): an `invited` membership and one invitation text. The reply with name and age (or a web join) is the join. A number that deleted everything is not invited. |
| Recycled numbers | A known number not seen for 12 months (no login, no message) is put on hold at its next login or message: it has no person, `/api/me` says `reason: "review"`, and export, leave, delete and join answer 403 or 400 `review`. STOP still works. Staff list holds with `GET /holds` and decide with `POST /holds {"phone", "decision": "same_owner"|"new_owner"}` (admin@*). `new_owner` deletes the old account and starts the number clean. |
| Several apps | A person who already uses another app gets the link notice after the welcome. It names no app. "SHARE" stores base-profile grants (first name, city, interests). A grant copies nothing. |
| STOP | On an app's own line: that app only (`PLATFORM_STOP_SCOPE=app`, the default), with the "Reply STOP ALL" option. `PLATFORM_STOP_SCOPE=global`: every app. On the shared line: every app (founder decision 2026-10-08). STOP ALL: every app. START: the app of the line. Each one writes `platform.consent_events`, opts out the members, and pauses the memberships. Every send reads the ledger: a number opted out of the app gets `refused_opted_out` (compliance texts still go). A global STOP from a site stops every app even when the person is not a member of that site's app. |
| Leave | "leave slop" or "leave slop.date" (any line), or the site's leave button: the forget path for that app only. |
| Blocks | A block on any app is person to person (`platform.person_blocks`). Each app's snapshot reads it as a "blocked" edge when both people are members there. |
| Person cap | At most 3 proactive messages a day for one person across all apps, counted when the message is handed to the adapter (`platform.person_cap_counts`, a SECURITY DEFINER function, so it also counts under the `network_service` role). Over the cap: status `refused_person_cap`, not sent. |
| Reviewer of record | With `NETWORK_SERVICE_CONSOLE_TOKEN` set, a request with that token may name the signed-in person in `X-Network-Staff-Id`; the audit and the review record that person. The header from any other token is ignored. |
| Live sends | Each app needs `BLOOIO_ALLOW_SEND=1`, `NTWRK_LIVE_APPROVED=1` and its own `<APP>_LIVE_APPROVED=1`. platform:dev never sends. |

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
| `BLOOIO_ALLOW_SEND`, `NTWRK_LIVE_APPROVED` | off | no | Both must be `1` for any live send. **[FOUNDER]** |
| `<APP>_LIVE_APPROVED` | off | yes | Also `1` for that app (`SLOP_LIVE_APPROVED`, `PEON_LIVE_APPROVED`, `BUDDIES_LIVE_APPROVED`; for ntwrk it is `NTWRK_LIVE_APPROVED`). **[FOUNDER]** |
| `PLATFORM_API_PORT` | 8790 | no | The public API (`/api/*`) |
| `PLATFORM_API_ORIGIN` | `http://127.0.0.1:8790` | no | Where `sites:dev` proxies `/api/*` |
| `NETWORK_SERVICE_HOST`, `NETWORK_SERVICE_PORT` | `127.0.0.1`, 4848 | no | Staff API and webhooks. `X-Forwarded-Host` from the dev proxy is trusted only with `PLATFORM_ENV=dev` on a local bind. |
| `PLATFORM_TRUSTED_IP_HEADER` | none | no | The one header that holds the client IP, set by the proxy in front of the API (for example `cf-connecting-ip` behind Cloudflare). Without it the socket address is used. A header the client sets never picks the OTP rate-limit bucket. |
| `PLATFORM_STOP_SCOPE` | `app` | no | STOP on one app's own line: `app` stops that app; `global` stops every app. On the shared line STOP always stops every app. |
| `PLATFORM_HASH_KEY` | a dev key (dev only) | no | The key for phone, IP and code hashes (rate limits, suppression, age floor). Required outside `PLATFORM_ENV=dev`. Changing it orphans old suppression hashes and age floors. **[CREDENTIALS]** |
| `OTP_PROVIDER` | the dev console (dev only) | no | `twilio` uses Twilio Verify with `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` **[CREDENTIALS]**. The dev console prints codes and runs only with `PLATFORM_ENV=dev`. |
| `TURNSTILE_SECRET_KEY` | none (dev bypass) | no | Cloudflare Turnstile check on `otp/start`. Required outside `PLATFORM_ENV=dev` (`main.ts` refuses to start without it). The sites send no Turnstile token yet, so a staging or production `otp/start` answers 400 `turnstile` until they do. |
| `PLATFORM_ENV` | none | no | Required by `main.ts`: `production`, `staging` or `dev`. Detection fails closed: only `dev` gets the dev shortcuts (console codes, Turnstile bypass, dev hash key, `X-Forwarded-Host`, cookies without `Secure`). It must match `platform.settings.environment` or the service refuses to start. `bun test` counts as dev (`NODE_ENV=test`). `NODE_ENV=production` also means production. |

The Observatory has its own per-app variables (`OBSERVATORY_DATABASE_URL_<APP>`, `OBSERVATORY_PLATFORM_DATABASE_URL`, `role@app` in `OBSERVATORY_TOKENS` and `OBSERVATORY_ROLES`): [runbook-real.md](runbook-real.md) section 4.

The app policy is data, not variables: `platform.apps` (join mode, join age, match age) and `platform.networks` (`matching_enabled`, run hour). The code defaults are in `packages/platform/src/apps.ts`. Change the rows for a running server, and the file for tests and the simulator.

## 6. What is gated

| Gate | Where | State in dev |
|---|---|---|
| Live sends | `BLOOIO_ALLOW_SEND=1`, `NTWRK_LIVE_APPROVED=1` and `<APP>_LIVE_APPROVED=1`, read on every delivery | Off. `platform:dev` uses the dry-run adapter and warns if a flag is set. |
| Human review | Every opportunity waits for a person. The service refuses any review mode but "human". | On |
| Matching per network | `platform.networks.matching_enabled` (slop and peon false), then the admin switch | slop and peon cannot be turned on (409). ntwrk and buddies start off; an admin turns them on. |
| Join age | `platform.apps.min_join_age` and the Network's `app` option | ntwrk 13, the others 18 (see the caution at the top) |
| Invite-only | `platform.apps.join_mode` (`invite` for ntwrk) | A web or text join needs an `invited` membership |
| OTP abuse limits | `OtpService`: +1 only, 3 sends per number per hour across every app, 10 per IP per hour (socket address or the trusted proxy header), 30 s gap, a global 500 sends an hour (an ALERT line in the log), 10-minute expiry, 5 tries per code, 10 code checks per number and 30 per IP an hour across apps, one use | On |
| Same answer for every phone | `otp/start` answers `{ok:true}` after at least 700 ms, known or not | On |
| Cross-site requests | POST must send JSON; a cross-site `Origin` gets 403; an app that does not match the Host gets 400 `app_mismatch` | On |
| Dev shortcuts | The dev OTP console, the Turnstile bypass, the dev hash key and the trusted `X-Forwarded-Host` run only with `PLATFORM_ENV=dev` | On |
| Site security headers | Each built site has `dist/_headers` (CSP `default-src 'self'`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `nosniff`); `sites:dev` sends the same | On |
| Fake numbers in production | A trigger refuses 555-01xx numbers when `platform.settings.environment = 'production'` | Off (dev) |
| Deploys | `scripts/wrangler.sh` refuses changing commands without `NTWRK_ALLOW_DEPLOY=1` **[FOUNDER]** | Nothing is deployed |

## 7. What is not built, and known gaps

Work to match the founder decisions (PRD 40, AGENTS.md):

- **The rename to `friends`.** `packages/platform/src/apps.ts`, migrations 0003 and 0005, `sites/buddies.nyc`, `APP_ORDER` in `packages/observatory/web/store.ts`, `PACK_READY` in `packages/observatory/src/apps.ts` and the tests still say `buddies`. A new migration must rename the rows and the role `network_observatory_buddies`.
- **13+ join on every app.** The registry and `platform.apps` say 18 for slop, peon and buddies. The sites say 18+.
- **The no-keyword join.** On the shared line, a stranger with no keyword gets The Network's invite-only reply. PRD 40.3 says they join The Network, and the agent asks what they want and enrolls them in those apps. This needs founder copy and an onboarding change.
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

## 8. Tests

```bash
bun test packages/platform                            # people, OTP, sessions, the public API (memory and Postgres), migrations, row-level security
bun test sites                                        # the four sites build, required pages and text, the dev proxy
bun test packages/network/test/service-apps.test.ts   # text joins, keywords per app, the person cap, live flags, staff roles, the public API
bun test packages/network/test/crossapp.test.ts       # cross_app_leak = 0, and a block on one app holds on the other
bun test packages/observatory/test/apps.test.ts       # the console: role@app, per-app worlds, review reasons, the cross-app view
```

The Postgres tests make a database of their own on the dev cluster and drop it afterwards. `bun run test` now also runs `sites`. Results after the safety fixes (no API keys): `bun test packages/platform` 48 pass; `bun test sites` 35 pass; `bun test packages/network/test/service-apps.test.ts` 14 pass; `bunx tsc --noEmit -p .` clean.

## 9. Stop it

Press Ctrl-C. Then drop your database if you do not need it again:

```bash
psql "postgres://$USER@localhost:54339/postgres" -c "drop database if exists platform_dev with (force)"
```

The sites build into `sites/<domain>/dist`. Delete those folders if you do not need them.
