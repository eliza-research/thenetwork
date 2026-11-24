# Runbook: the platform in local dev (one backend, four sites)

This runbook starts the whole platform on your machine: the dev database, one Network service for every app, and the four sites. It then checks the main member flows with `curl`. It also lists the variables per app, what is gated, and what is not built.

The platform is one backend, one admin panel and one database for four apps with different sites: The Network (`ntwrk`, ntwrk.party), slop (`slop`, slop.date, dating), peon (`peon`, peon.biz, hiring) and friends (`friends`, friends.help, NYC friends). A person can join one app or several. The plan is `docs/research/2026-10-08-platform-architecture.md`. The scope is PRD Section 40 (founder decisions of 2026-10-08). The proposed PRD changes for what was built are in [prd-pending-edits.md](prd-pending-edits.md) (section 2). The production runbook is [runbook-real.md](runbook-real.md).

The backend follows the founder decisions in [spec/product/source/founder-decisions.md](../spec/product/source/founder-decisions.md); the [product specification](../spec/product/README.md) owns launch scope. The app id is `friends` (friends.help; migration 0007 renames the old `buddies` rows), 13+ may join every app and matching stays 18+, one line serves every app, STOP stops every app and "leave <app>" leaves one. The sites have no account portal (founder correction 2026-10-19): stop and leave are text commands, and export and deletion requests go to help@ntwrk.party. Section 3 lists today's answers; `tests/e2e` checks the flows end to end (section 8).

**Warning: nothing here sends a text.** The service uses the dry-run adapter. It stores each message with status `dry_run`. The dev OTP provider prints the code to the service log. Use only the fictional 555-01xx numbers. Do not set `NETWORK_CHANNEL`: it alone makes sends real.

## 1. What runs

| Part | Where | What it does |
|---|---|---|
| Dev Postgres | `localhost:54339` | `pnpm run db:migrate` runs on the database first. Use a database of your own (step 2). |
| Staff API | `127.0.0.1:4848` | The backend's private port: the staff API (`?app=<app>` or `/apps/<app>/...`). One network per row of `platform.networks` (`ntwrk:nyc`, `friends:nyc`, `peon:nyc`, `slop:nyc`) ticks once a minute under its own lock. |
| Backend (public) | `127.0.0.1:8790` | The shared backend (`deploy/backend` createBackend, the same code as `pnpm run start:backend`): `/api/*`, `/webhooks/blooio[/<app>]`, `/mcp`, `/mcp/openai`, `/oauth/*`, `/.well-known/oauth-*`, `/healthz`. The app comes only from a request a site router signed (`packages/platform/src/proxy.ts`); an unsigned request to `:8790` names no app. |
| Sites | `127.0.0.1:5101`-`5104` | ntwrk.party, slop.date, peon.biz, friends.help (`scripts/sites-dev.ts`). Their backend paths run through the production router code (`deploy/router.ts`) and are signed with a dev `PLATFORM_PROXY_SECRET` (a fresh one per run). Each site is the MCP issuer of its app: an MCP client connects to `http://127.0.0.1:5102/mcp` for slop. Open the sites at `127.0.0.1`, not `localhost`: the MCP pages check the Origin. |

`platform.networks.matching_enabled` allows matching per network: true for all four (`ntwrk:nyc` in migration 0003, `friends:nyc` in 0007, `slop:nyc` and `peon:nyc` in 0011). Where it is false, the staff switch refuses to turn matching on (`matching_not_allowed`). A new stored state starts with matching off, and an admin turns it on.

## 2. Start it

1. Pick a database name of your own, so that you do not change the shared dev `network` database.
2. Start everything:

```bash
NETWORK_DATABASE_URL=postgres://$USER@localhost:54339/platform_dev pnpm run platform:dev
```

The script refuses a database that is not on `localhost:54339`. It refuses to run when `NODE_ENV` or `PLATFORM_ENV` is `production`, and it sets `PLATFORM_ENV=dev` (the dev shortcuts need it). It prints the dev staff tokens once (`admin:dev-admin,reviewer:dev-reviewer,safety:dev-safety,analyst:dev-analyst`). Set `NETWORK_SERVICE_TOKENS` to use your own, for example `reviewer@slop:<token>` for a reviewer of slop only.

Run `pnpm run platform:dev --no-sites` to start the database and the backend only, and `--verbose` to log every request.

The end-to-end tests (`tests/e2e`, `pnpm run test:e2e`) start this stack in one process; section 8 lists them.

To run the parts one at a time (each command was checked on 2026-10-08):

```bash
psql "postgres://$USER@localhost:54339/postgres" -c "create database platform_dev"
pnpm run db:migrate -- --url postgres://$USER@localhost:54339/platform_dev     # every migration under packages/observatory/db/migrations; a second run applies nothing
PLATFORM_ENV=dev NETWORK_DATABASE_URL=postgres://$USER@localhost:54339/platform_dev \
  node --import tsx --env-file-if-exists=.env packages/network/service/main.ts --once --dry-run                    # one tick of every network, then exit
pnpm run sites:dev                                                              # the four sites only, backend paths proxied to :8790 (unsigned X-Forwarded-Host unless PLATFORM_PROXY_SECRET is set)
```

`pnpm run db:migrate` with no `--url` and no `NETWORK_DATABASE_URL` migrates the shared dev `network` database. It refuses a host that is not local. `main.ts --once --dry-run` prints one line per network, for example `network slop:nyc: sends dry-run, review by the judge (staff decide held items), matching allowed (the admin switch decides)`, then `slop:nyc: tick done`.

## 3. Check the flows with curl

Each site keeps its own cookie (`sid_<app>` in dev), so use one cookie jar per site. The code for each login is in the service log.

1. Ask for a code on slop.date (port 5102). Read the code in the service log.
2. Send the code. Join slop.
3. Do steps 1 and 2 again on friends.help (port 5104) with the same phone.
4. Read `/api/me` on each site. Each one shows only its own app.
5. Stop messages on slop (`POST /api/me/stop`): **every app stops** (PRD 40.3), as STOP on the shared line does. The sites show no stop or leave button; members use the text commands. "leave slop.date" by text leaves slop only.
6. Export the friends data (`GET /api/me/export`). Leave friends (`POST /api/me/delete {"scope":"app"}`). slop stays. These API routes stay for the tests and the backend; members ask help@ntwrk.party for an export or a deletion.

### What you should see (2026-10-08)

`tests/e2e/platform.e2e.test.ts` runs these steps with the router, the backend, the MCP server and Postgres. The table lists what the service answers today; each row is checked by the e2e, platform or service tests.

| Request | Answer today |
|---|---|
| `GET /api/app` on any site | that site's app only; `minJoinAge` 13 and `minMatchAge` 18 for all four; ntwrk `joinMode` `invite` on the web |
| `POST /api/auth/otp/verify` with a wrong code | `{"ok":false,"error":"invalid_code"}` |
| `POST /api/join` with age 12 | refused `under_age`; the age goes to the phone's age floor, so a retry with another age is refused too |
| `POST /api/join` on slop with age 15 | joined; the member has no dating opt-in, is never matched, and cannot upload photos (`adults_only`) |
| `GET /api/me` on another site with the first site's cookie | 401: each site has its own cookie |
| `POST /api/me/stop` on one site (or STOP on the shared line) | every app stops for that number; "leave <app>" by text leaves one app |
| `POST /api/me/delete {"scope":"all"}` within 10 minutes of a login | `{"ok":true}`; later, 403 `reauth` |
| `POST /api/me/phone/start {"phone"}` within 10 minutes of a login, then `POST /api/me/phone/confirm {"code"}` with the code from the new number | `{"ok":true}`, then `{"ok":true,"phoneMasked"}` and a new session cookie on the new number (a Cloud sign-in site clears the session and Cloud identity instead); later than 10 minutes, 403 `reauth`; a number that belongs to someone, 409 `number_in_use` (only after its code); runbook-real.md 9.2 |
| Any request straight to the backend without the router's signature, in staging or production | 421 `edge_required` |

## 4. Rules the service keeps

| Rule | How |
|---|---|
| The app of a text | One line serves every app (`/webhooks/blooio`, `BLOOIO_WEBHOOK_SECRET`). A row in `platform.app_lines` for the receiving line names the app. Without a row: a message that is only an app's word ("slop", "slop.date", "friends.help", "join peon") goes to that app; the answer to a join the person started goes to that join; a member's message goes to the app with their newest open item (a probe or plan they have not answered), else the app that wrote to them last; anything else goes to The Network. An app's name inside a sentence ("my ex is on slop.date") never moves a member's message. The member lookup across apps is `platform.member_apps` (migration 0007). `/webhooks/blooio/<app>` stays for an app that ever gets its own line. |
| No keyword | A stranger with no keyword joins The Network by text (first name and birthday; owner decision 2026-11-22). Then The Network asks "What are you looking for: friends, dating, work, or all of these? ... All of these apps are powered by The Network." The answer enrolls them in the matching apps, each with its own join age check, opt-in and member, and The Network confirms in one text. The question waits in `platform.pending_texts`, so a restart keeps it. The web join for ntwrk stays invite-only. |
| Joining by text | On an open app (and on The Network from the shared line), someone who is not a member gets "To join ..., reply with your first name and your birthday (month, day and year)" (owner decision 2026-11-22; a typed age is still read). Nothing is stored until a first name and a birthday or an age that passes the app's join age (13) arrive; the join records the birth date (`recordBirthDate`) before the age. The question waits in `platform.pending_texts` (a keyed phone hash, never the phone). A bare number is an age only in a short answer ("Sam, 29"), not in a sentence ("7 works for me"). Then the person (if new), the membership, the opt-in (with the words they answered) and the network member are created, and the Network welcomes them. Under the join age: the app's kind decline; for that app only the age is kept, on the phone's age floor, so a retry with an older age is refused. |
| Lowest age | The lowest age ever stated for a phone wins on every app: the person's `lowest_age` and `platform.age_floor` (a keyed phone hash and an age). An age stated in chat (first person, present tense) lowers it, and every app's member follows, so a minor anywhere is single-player everywhere, except in a teen friendship introduction on friends.help or in the ntwrk `Friend` lane while staff have not stopped teen introductions ([network.md](network.md) 6.3). An attested adult who claims to be under 13 is held for staff by the Network and recorded as 13 here (a minor, nothing deleted). A join gets the lowest age, not the age typed. Delete everything keeps the age floor and the person (a tombstone revived by the same phone), so blocks still hold. `/api/me` does not show the age. Owner decision 2026-11-22: `POST /api/join` takes exactly one of `birthdate` (`yyyy-mm-dd`) or `age`; a malformed value (not `yyyy-mm-dd`, or both or neither field) is 400 `invalid`; a well-formed date that is not a real calendar date, is after today, is before 1900, or gives an age outside the usable range is 400 `invalid_birthdate` (`joinBirthDateUsable`). Each statement is a reading in `platform.people.birth_lower`, `birth_upper` and `birth_youngest` (migration 0081); `birth_date` is the latest stated birth date. The floor keeps only the coarse typed-age reading, never an exact date. A conflict with a youngest age of 18 or less writes `platform.teen_pool_bars` (`conflict`); bars are never erased. There is no staff confirm step (owner decision 2026-11-22, answer A3). `platform.teen_pool_holds` (one row for each phone hash and app while a teen-pool member has an open report, report hold or trust hold) and `platform.teen_pair_avoid` (an ordered pair of phone hashes after a teen probe, decline, rejection or report) carry teen-pool state across apps; erasure deletes the person's rows. The age at Clock time comes from the readings (`AccountService.lowestAge`, `ageRecord`); the integer columns decide only for rows without readings. |
| Invite-only (ntwrk, web and an app's own line) | On a site, a person who is not invited gets the invite-only answer. Nothing is stored. Staff invite a number with `POST /apps/ntwrk/invite {"phone": ...}` (admin): an `invited` membership and one invitation text. The reply with name and age (or a web join) is the join. A number that deleted everything is not invited. |
| Recycled numbers | A known number not seen for 12 months (no login, no message) is put on hold at its next login or message: it has no person, `/api/me` says `reason: "review"`, and export, leave, delete and join answer 403 or 400 `review`. STOP still works. Staff list holds with `GET /holds` and decide with `POST /holds {"phone", "decision": "same_owner"|"new_owner"}` (admin@*). `new_owner` deletes the old account and starts the number clean. |
| Several apps | A person who already uses another app gets the link notice after the welcome. It names no app. "SHARE" grants interests only. When the person joins another app, that app copies their confirmed interests that are not private and not sensitive, once (spec/baseProfileShare.md). Name and city stay as the joined app has them. |
| STOP | Every app on the number (founder decision 7): STOP, STOP ALL, the reasonable-means phrasings in English and Spanish ("please stop texting me", "no más mensajes"), and `POST /api/me/stop`. An app's own line is the same (owner decision 2026-11-22 removed `PLATFORM_STOP_SCOPE`); only "leave <app>" stops one app. START: the app of the line. Each one writes one `platform.consent_events` row per message (`ref`), opts out the members, and pauses the memberships. Every send reads the ledger, the member's `opted_out` and the suppression hash: such a send gets `refused_opted_out` (compliance texts still go). |
| Leave | "leave slop" or "leave slop.date" (any line), or `POST /api/me/delete {"scope":"app"}`: the forget path for that app only. |
| Blocks | A block on any app is person to person (`platform.person_blocks`). Each app's snapshot reads it as a "blocked" edge when both people are members there. |
| Person cap | At most 3 proactive messages a day for one person across all apps, taken when the message is handed to the adapter: `platform.person_cap_take` (SECURITY DEFINER, one lock for every app) counts and records in `platform.person_sends`, so two networks delivering at once cannot both pass, and it works under the `network_service` role. Over the cap: status `refused_person_cap`, not sent. |
| Reviewer of record | With `NETWORK_SERVICE_CONSOLE_TOKEN` set, a request with that token may name the signed-in person in `X-Network-Staff-Id`; the audit and the review record that person. The header from any other token is ignored. |
| Live sends | The configured channel alone decides (`NETWORK_CHANNEL` with its credentials; spec/bootPolicy.md, owner decision 2026-11-22); every app is approved. platform:dev never sends. |

## 5. Environment variables

The service reads these. **[FOUNDER]** marks a flag that only the founder may set. **[CREDENTIALS]** marks a secret. In dev, `platform:dev` sets safe defaults and never sends.

| Variable | Default | Per app | What it does |
|---|---|---|---|
| `NETWORK_DATABASE_URL` | `DATABASE_URL` | no | Postgres with the `network` and `platform` schemas (`pnpm run db:migrate`). `platform:dev` accepts only `localhost:54339`. |
| `NETWORK_SERVICE_TOKENS` | dev tokens in `platform:dev`; none in `main.ts` | yes | Staff tokens: `role@app:<t>` (one app) or `role@*:<t>` (every app). Outside production `role:<t>` still means every app; in production it is refused. **[CREDENTIALS]** |
| `NETWORK_SERVICE_CONSOLE_TOKEN` | none | no | The admin console's own token (also one of the tokens). Only it may name the reviewer of record (`X-Network-Staff-Id`). **[CREDENTIALS]** |
| `BLOOIO_WEBHOOK_SECRET` | `whsec_dev_shared` in `platform:dev` | no | The shared line's webhook (`/webhooks/blooio`). Without it, 503. **[CREDENTIALS]** |
| `<APP>_BLOOIO_WEBHOOK_SECRET` | `whsec_dev_<app>` in `platform:dev` | yes | One app's line (`/webhooks/blooio/<app>`), for example `SLOP_BLOOIO_WEBHOOK_SECRET`. **[CREDENTIALS]** |
| `NETWORK_CHANNEL` | dry-run | no | `blooio` uses the Blooio adapter (`BLOOIO_API_KEY`, `BLOOIO_FROM`). `eliza_cloud` sends through Eliza Cloud delivery (`NETWORK_CLOUD_DELIVERY_ORIGIN`, `BLOOIO_FROM`, `SERVICE_TURN_SECRET`). `--dry-run` always wins. |
| `PLATFORM_API_PORT` | 8790 | no | The public API (`/api/*`) |
| `PLATFORM_API_ORIGIN` | `http://127.0.0.1:8790` | no | Where `sites:dev` proxies `/api/*` |
| `NETWORK_SERVICE_HOST`, `NETWORK_SERVICE_PORT` | `127.0.0.1`, 4848 | no | Staff API and webhooks. `X-Forwarded-Host` from the dev proxy is trusted only with `PLATFORM_ENV=dev` on a local bind. |
| `PLATFORM_PROXY_SECRET` | none | no | The secret the site routers (Cloudflare Workers) sign the visitor IP and the site host with (`packages/platform/src/proxy.ts`: HMAC-SHA256 over method, path, host, IP and time; refused after 60 s). Without a valid signature the API uses the socket address and its own Host map; a header a client sets never picks the app or the rate-limit bucket. Required in production, at least 32 characters. **[CREDENTIALS]** |
| `PLATFORM_SESSION_SECRET` | a dev key (dev only) | no | The key for the stored session token hashes and the sealed Cloud sign-in cookies. Both entries, `main.ts` and the combined backend (`pnpm run start:backend`), require it outside dev: at least 32 characters, and different from `PLATFORM_HASH_KEY` (docs/deploy.md 2.3). **[CREDENTIALS]** |
| `PLATFORM_HASH_KEY` | a dev key (dev only) | no | The key for phone, IP and code hashes (rate limits, suppression, age floor). Required outside `PLATFORM_ENV=dev`. Changing it orphans old suppression hashes and age floors. **[CREDENTIALS]** |
| `OTP_PROVIDER` | the dev console (dev only) | no | `twilio` uses Twilio Verify with `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_VERIFY_SERVICE_SID`. `blooio` uses `BLOOIO_API_KEY` and the configured `BLOOIO_FROM` sender. **[CREDENTIALS]** The dev console prints codes and runs only with `PLATFORM_ENV=dev`. |
| `TURNSTILE_SECRET_KEY` | none (dev bypass) | no | Cloudflare Turnstile check on `otp/start`. Required outside `PLATFORM_ENV=dev` (`main.ts` and the combined backend refuse to start without it). The join page shows the widget (`TURNSTILE_SITE_KEY`). |
| `PLATFORM_ENV` | none | no | Declares `production`, `staging`, or `dev` for `main.ts`. Staging and production require a configured `twilio` or `blooio` OTP provider, `TURNSTILE_SECRET_KEY`, `PLATFORM_PROXY_SECRET`, `PLATFORM_HASH_KEY`, `PLATFORM_SESSION_SECRET`, a database URL, and an API key for the judge and recommender providers (`bootConfigProblems` in `packages/platform/src/env.ts`; owner decisions D15 to D17 of 2026-11-22). Only `dev` gets console codes, Turnstile bypass, the dev hash key, trusted `X-Forwarded-Host`, and cookies without `Secure`. The environment must match `platform.settings.environment`. `NODE_ENV=test` declares dev and `NODE_ENV=production` declares production when `PLATFORM_ENV` is unset. |

The Observatory has its own per-app variables (`OBSERVATORY_DATABASE_URL_<APP>`, `OBSERVATORY_PLATFORM_DATABASE_URL`, `role@app` in `OBSERVATORY_TOKENS` and `OBSERVATORY_ROLES`): [runbook-real.md](runbook-real.md) section 4.

The app policy is data, not variables: `platform.apps` (join mode, join age, match age) and `platform.networks` (`matching_enabled`, run hour). The code defaults are in `packages/platform/src/apps.ts`. Change the rows for a running server, and the file for tests and the simulator.

## 6. What is gated

| Gate | Where | State in dev |
|---|---|---|
| Live sends | `NETWORK_CHANNEL` (`blooio` or `eliza_cloud`) with its credentials, read at start | Off. `platform:dev` uses the dry-run adapter and warns if `NETWORK_CHANNEL` is set. |
| Automated review | The review judge decides every opportunity before contact; an item it flags, is unsure about or cannot run on waits for staff and expires unsent at its deadline (owner decisions D15 to D17 of 2026-11-22). There is no review mode. In `dev` without an injected judge no model is called and every item is held for staff. | On |
| Matching per network | `platform.networks.matching_enabled`, then the admin switch | Allowed on all four networks; a new stored state starts off and an admin turns it on. |
| Join age | `platform.apps.min_join_age` and the Network's `app` option | 13 on every app; matching 18+ |
| Invite-only | `platform.apps.join_mode` (`invite` for ntwrk) | A web or text join needs an `invited` membership |
| OTP abuse limits | `OtpService`: US and Canadian numbers only (no Caribbean, toll-free or premium codes), 3 sends per number per hour and 6 a day across every app, 10 per IP per hour (the socket address or the IP a site router signed), 30 s gap; a refused request is not counted; a global 500 sends an hour (an ALERT line in the log), 10-minute expiry, 5 tries per code, 10 code checks per number and 30 per IP an hour across apps, one use | On |
| Same answer for every phone | `otp/start` answers `{ok:true}` after at least 700 ms, known or not | On |
| Cross-site requests | POST must send JSON (16 KB at most); a cross-site `Origin` or `Sec-Fetch-Site: cross-site` gets 403; an app that does not match the Host gets 400 `app_mismatch`; production accepts only the four domains as hosts | On |
| Dev shortcuts | The dev OTP console, the Turnstile bypass, the dev hash key and the trusted `X-Forwarded-Host` run only with `PLATFORM_ENV=dev` | On |
| Site security headers | Each built site has `dist/_headers` (CSP `default-src 'self'`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `nosniff`); `sites:dev` sends the same | On |
| Fake numbers in production | A trigger refuses 555-01xx numbers when `platform.settings.environment = 'production'` | Off (dev) |
| Deploys | `scripts/wrangler.sh` refuses changing commands without `NTWRK_ALLOW_DEPLOY=1` **[FOUNDER]** | Nothing is deployed |

## 7. Open items and known gaps

The product specification ([spec/product/README.md](../spec/product/README.md)) owns launch scope and the open founder decisions. Items checked against the code on 2026-11-18:

- **Founder copy.** The no-keyword question (`LOOKING_FOR_ASK` and `LOOKING_FOR_ASK_MINOR` in `packages/network/service/service.ts`) and the STOP and HELP texts (`packages/platform/src/apps.ts`) change only with founder approval.
- **Sites.** A web join must send the canonical opt-in text (or its version) that `GET /api/app` returns (`consent`); any other wording gets 400 `consent_wording`.
- **Demo replay.** `GET /api/demo` answers 404: neither `deploy/backend/server.ts` nor `scripts/platform-dev.ts` supplies a demo.
- **Share.** The text SHARE reply is the only share path and copies interests (spec/baseProfileShare.md). The sites have no share route.
- **Carrier lookup.** The OTP path does not check VoIP, landline or recent port.
- **Invites inside the Network conversation.** The runtime gives the Network no `ctx.invite`, so a member who asks the Network for an invite link gets the "invites are not open" answer (`invitesNotOpen`). Staff invites by phone and the member invitation links (spec/memberInvitation.md) are separate paths.
- **Network capital.** The service records capital events (`network.capital_events`), but its levers do not read them yet (`packages/network/service/runtime.ts`).

Known gaps that this pass did not check against the code:

- The first-name parser for joins by text is a heuristic ("I'm 29 and in Brooklyn" may read "Brooklyn" as the name).
- Two networks can send to one person at the same moment; the cap counts committed rows, so it can refuse both rather than let both pass. A message held for quiet hours counts as sent.
- Some service reads (address book, health, export) may set no `app.app_id`; under the `network_service` role such a read sees nothing.
- `network.channel_identities` allows one member per phone, so platform members keep their phone in `platform.phone_identities` only. The console PII reveal reads `channel_identities` and may not see them.

## 8. Checks

Validation is simulations plus integration and e2e tests; unit and smoke tests are not kept ([tests-policy.md](tests-policy.md)). With the dev Postgres up:

```bash
pnpm run test:integration                              # the platform API on memory and Postgres, photos, the trusted proxy, the service, MCP, the console, and the security suite (RLS, CSRF, OTP limits, OAuth PKCE, the backend "two logins" check)
pnpm run test:e2e                                      # tests/e2e: the platform, notify, connector signup, Cloud join, invitations, phone change and photo links through the running service
pnpm run sim --only evals                              # the opt-out corpus, keywords and per-app leave, the leak guard
DEPLOY_TARGET=production node --import tsx --env-file-if-exists=.env sites/sites.ts       # the four sites build (refuses draft legal text)
pnpm run typecheck
```

The security tests make a database of their own on the dev cluster and drop it afterwards. [tests-policy.md](tests-policy.md) lists which deleted tests were restored and which were not.

## 9. Stop it

Press Ctrl-C. Then drop your database if you do not need it again:

```bash
psql "postgres://$USER@localhost:54339/postgres" -c "drop database if exists platform_dev with (force)"
```

The sites build into `sites/<domain>/dist`. Delete those folders if you do not need them.
