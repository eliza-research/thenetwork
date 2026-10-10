# packages/platform

One backend for four apps: ntwrk (ntwrk.love), slop (slop.date), peon (peon.biz) and friends (friends.help). The plan is `docs/research/2026-10-08-platform-architecture.md`. The scope is PRD Section 40. Local dev for everything: [docs/runbook-platform.md](../../docs/runbook-platform.md).

The founder decisions of 2026-10-08 (AGENTS.md) are in the code: app id `friends` (migration 0007 renames old rows), 13+ to join every app and 18+ to be matched, one line for every app with keyword routing, STOP stops every app and "leave <app>" leaves one.

This package holds what the apps share: people, verified phones, memberships per app, the consent ledger per app, share grants, blocks, web OTP login, sessions and the public API. The engine tables stay in the `network` schema. A member id belongs to one app.

## Parts

| File | What it does |
|---|---|
| `src/apps.ts` | The app list, policy defaults, brand texts (STOP, START, HELP), the canonical opt-in wording, the host maps (production; dev adds localhost), the shared-line keywords, "what are you looking for" |
| `src/age.ts` | `canJoinApp`, `canMatchInApp`, lowest age wins (built on `packages/core/src/policy.ts`) |
| `src/phone.ts` | E.164 for US and Canadian numbers only (no Caribbean, toll-free or premium codes), masking, keyed hashes |
| `src/consent.ts` | STOP (and opt-outs in the person's own words, English and Spanish) for every app, `leave <app>` for one, START for one app, `PLATFORM_STOP_SCOPE=app` for an app's own line |
| `src/proxy.ts` | The trusted proxy: the signer the site routers use (HMAC over method, path, host, client IP, time), the check the API runs, and a complete router (`routeSiteRequest`) |
| `src/store.ts`, `src/pg-store.ts` | `PeopleStore`: `MemoryPeopleStore` and `PgPeopleStore` (the `platform` schema) |
| `src/otp.ts` | `OtpService` (3 sends per number per hour, 10 per IP per hour, 30 s gap, 10 min expiry, 5 tries), `TwilioVerifyProvider`, `DevConsoleProvider` |
| `src/turnstile.ts` | Cloudflare Turnstile check; a dev bypass that refuses production |
| `src/sessions.ts` | Random 32-byte tokens, only a keyed hash is stored, one app each, 30 days, rotation after a day, 90 days at most from the login, step-up for delete everything |
| `src/accounts.ts` | Join, invite, stop, leave one app, delete everything, export one app, share grants |
| `src/api.ts` | `createPublicApi(...)`: the `/api/*` routes the sites call |
| `src/photos.ts` | Private member photos (slop.date only, adults only): upload with the photo consent, the metadata strip (an allowlist of the parts a decoder needs), private storage, 5-minute signed staff links, and the Clef photo rater (`photoRaterFromEnv`). Ratings are on by default; the score is agent_private and never shown to anyone. |

## Database

The schema is in `packages/observatory/db/migrations/` (0003 platform, 0004 app ids and row-level security on the network tables, 0005 the console per app). Apply it with `bun run db:migrate` (`-- --url <local url>` for another database). Tests make a database of their own on the dev cluster (port 54339). The roles and the order are in [docs/runbook-real.md](../../docs/runbook-real.md) sections 1 and 2.

Leaving an app, deleting everything and the join rollback call `notify.forget_data` (packages/notify/db/retention.sql, migration 9003) in the same transaction. Every database a `PgPeopleStore` uses must run the full migrate list, Notify included (9002 and 9003); on a database without them, leave and join rollback fail.

## Public API

`createPublicApi({ store, otp, turnstile, hostMap, onJoin, onStop, onForget, onExport, ... })` returns a fetch handler. It answers `undefined` for paths outside `/api`, so any `Bun.serve` can mount it. The Network service mounts it on `PLATFORM_API_PORT` (8790) and supplies the hooks.

| Route | Answer |
|---|---|
| `POST /api/auth/otp/start {phone, turnstileToken?}` | Always `{ok:true}` after at least 700 ms, known phone or not. `429 {ok:false, error:"rate_limited"}` over the limits. +1 numbers only. |
| `POST /api/auth/otp/verify {phone, code}` | `{ok:true}` and a session cookie, or `400 invalid_code` |
| `POST /api/auth/logout` | `{ok:true}`, cookie cleared |
| `GET /api/me` | 401, or `{app, phoneMasked, membership, smsOptedIn, canJoin, reason?}` |
| `POST /api/join {firstName, age, neighborhood?, zip?, interests?, about?, consent: {sms: true, wording? , version?}}` | `{ok:true, membership}` or `400 under_age \| invite_only \| invalid \| consent_wording`. The wording must be the app's canonical text (or its version) from `GET /api/app`. |
| `POST /api/me/share {fromApp, fields}` | Stores a base-profile grant (`first_name`, `city`, `age_band`, `interests`). No site shows it. |
| `GET /api/me/export` | This app's data only |
| `POST /api/me/share/revoke {fromApp}` | Revokes a grant. The same answer either way. |
| `POST /api/me/stop` | Opts out of every app on this number (PRD 40.3) |
| `POST /api/me/delete {scope: "app" \| "all"}` | Leave this app (the forget path), or delete every membership and the phone (a tombstone, the blocks, the age floor and a suppression hash stay). `all` needs a login in the last 10 minutes (403 `reauth`). |
| `GET /api/app` | `{id, name, domain, joinMode, minJoinAge, minMatchAge, keywords, poweredBy, consent: {version, text}}` |
| `GET /api/demo` | The replay from the `demo` option. The service supplies none yet, so it answers 404 `not_found`. |

`smsOptedIn` reads this app's current consent through `Accounts.optedIn`. A paused membership can still permit messages. Global STOP stops every app; a later app-scoped START resumes only that app. Older site clients may ignore the field.

The app comes from the host a site router signed (`src/proxy.ts`, `PLATFORM_PROXY_SECRET`, at most 60 s old), else the Host header (`DEFAULT_HOST_MAP`: the four domains and their `www` names; in dev also `localhost` / `127.0.0.1` ports 5101-5104). The dev proxy's `X-Forwarded-Host` is trusted only with `PLATFORM_ENV=dev` on a local bind. The client IP for the rate limits is the IP a site router signed, else the socket address; a header the client sets is never read. Bodies over 16 KB get 413. An explicit `app` that does not match the Host gets `400 app_mismatch`. The cookie is `sid_<app>` in dev (the localhost ports share cookies) and `__Host-sid` with `Secure` everywhere else; always `HttpOnly; SameSite=Lax`. A session is rotated after a day; the old token works for 60 more seconds.

## Environment

| Variable | What it does |
|---|---|
| `PLATFORM_HASH_KEY` | The HMAC key for phone, IP and code hashes. Required outside `PLATFORM_ENV=dev`. Changing it orphans old suppression hashes and age floors. |
| `PLATFORM_PROXY_SECRET` | The secret the site routers sign with. Required in production (32+ characters). |
| `PLATFORM_SESSION_SECRET` | The key for stored session hashes. Required in production (32+ characters). |
| `PLATFORM_STOP_SCOPE` | Unset: STOP stops every app. `app`: STOP on an app's own line stops that app only. |
| `OTP_PROVIDER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` | `twilio` uses Twilio Verify; anything else uses the dev console (codes in the log; `PLATFORM_ENV=dev` only) |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile; without it, the dev bypass (`PLATFORM_ENV=dev` only) |
| `CLEF_RATINGS` | The slop.date photo rater. Unset or `on`: on (founder, 2026-10-09). `off`: off; any other value also leaves it off. Off: photos still work, nothing is rated. |
| `CLOUDFLARE_AI_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLEF_MODEL` | Workers AI for the rater. Without the token and the account id nothing is rated (status `off_env`). |
| `CLEF_WEIGHTS_PATH` | Unset: the engine's placeholder Clef weights (status `on_placeholder`, logged at start with the weights version) until fitted weights pass the P2 decision rule. Set: a fitted weights file with a version and a provenance record, or it is refused (`refused_weights`, ratings off). |
| `PLATFORM_ENV` | `production`, `staging` or `dev`. Detection fails closed: an environment that is not declared dev gets no dev shortcut. `bun test` (`NODE_ENV=test`) counts as dev. Outside dev, `assertBootConfig` refuses to start without Twilio, Turnstile, the three secrets, a database and review mode human. |

## Rules the code keeps

- Nothing crosses apps by default. A share grant names base-profile fields only. Sensitive classes are never shareable.
- No enumeration: `/api/auth/otp/start` gives the same answer, after at least the same time, for a known and an unknown phone.
- An under-age join stores nothing for that app. The age goes to the phone's age floor (`platform.age_floor`: a keyed phone hash and an age), so a retry with an older age is refused, also after a delete of everything. `/api/me` does not show the age: `canJoin` stays true until the join is refused.
- A number not seen for 12 months is put on hold at its next login or message (`phone_identities.hold`). While it is held it has no person: `/api/me` says `reason: "review"`, and export, leave, delete and join are refused. Staff decide with `Accounts.clearHold` (the service's `/holds` route).
- A delete of everything leaves a suppression hash. A staff invite to that number is refused; a new join by the person lifts it.
- `/api/me/share` gives the same answer whether or not a grant was stored.
- OTP: 3 codes per number per hour across every app, 10 per IP, a 30 s gap, a global budget (500 an hour), and 10 code checks per number and 30 per IP an hour.
- The dev OTP console, the Turnstile bypass, the dev hash key and the trusted `X-Forwarded-Host` run only with `PLATFORM_ENV=dev`.
- A photo rating is checked before the rater runs, again when it returns and again after it is written: a person whose lowest age drops under 18, who is banned, who leaves, or whose rated photo is deleted meanwhile keeps no rating. Each rater try is a `photo_rating` row in the cost ledger.
- Nothing is sent in tests. The Twilio adapter runs only with `OTP_PROVIDER=twilio` and its credentials.

## Validation

The platform's unit tests were deleted on 2026-10-08 (founder decision: simulations only). Integration tests on Postgres are allowed (founder decision 4 of 2026-10-09): `test/photos.test.ts` covers the metadata strip corpus, the photo rules and the rating race. Kept, pending the founder's decision: the security suite (`test/db.test.ts`: composite foreign keys, per-app RLS, platform_service limits, append-only audit; `test/api-security.test.ts`: CSRF, no phone-number enumeration, OTP limits), run with `bun run security` against the dev Postgres and in CI as "security (pending)". The opt-out corpus is scored by `bun run sim` (evals/opt-out.jsonl).

## Known gaps

- Not built: the carrier lookup (VoIP, landline, recent port), Turnstile on the sites, the share UI, an engine view that reads share grants, the demo replay, and the app-specific tables (peon orgs, roles, applications; slop dating preferences; `facets.sensitive_class`).
- Code imports `@thenetwork/platform` by relative path.
