# packages/platform

One backend for four apps: ntwrk (ntwrk.love), slop (slop.date), peon (peon.biz) and buddies (buddies.nyc). The plan is `docs/research/2026-10-08-platform-architecture.md`. The scope is PRD Section 40. Local dev for everything: [docs/runbook-platform.md](../../docs/runbook-platform.md).

**Caution:** PRD 40 and AGENTS.md rename buddies to `friends` (friends.help) and allow 13+ to join every app. `src/apps.ts` and migration 0003 still say `buddies` and 18 for slop, peon and buddies. Change both together (a new migration renames the rows and the `network_observatory_buddies` role).

This package holds what the apps share: people, verified phones, memberships per app, the consent ledger per app, share grants, blocks, web OTP login, sessions and the public API. The engine tables stay in the `network` schema. A member id belongs to one app.

## Parts

| File | What it does |
|---|---|
| `src/apps.ts` | The app list, policy defaults, brand texts (STOP, STOP ALL, START, HELP), the host map |
| `src/age.ts` | `canJoinApp`, `canMatchInApp`, lowest age wins (built on `packages/core/src/policy.ts`) |
| `src/phone.ts` | E.164 for +1 numbers only, masking, keyed hashes |
| `src/consent.ts` | STOP for one app, STOP ALL for every app, START for one app, `PLATFORM_STOP_SCOPE=app\|global` |
| `src/store.ts`, `src/pg-store.ts` | `PeopleStore`: `MemoryPeopleStore` and `PgPeopleStore` (the `platform` schema) |
| `src/otp.ts` | `OtpService` (3 sends per number per hour, 10 per IP per hour, 30 s gap, 10 min expiry, 5 tries), `TwilioVerifyProvider`, `DevConsoleProvider` |
| `src/turnstile.ts` | Cloudflare Turnstile check; a dev bypass that refuses production |
| `src/sessions.ts` | Random 32-byte tokens, only the sha256 is stored, one app each, 30 days, rotation after a day |
| `src/accounts.ts` | Join, invite, stop, leave one app, delete everything, export one app, share grants |
| `src/api.ts` | `createPublicApi(...)`: the `/api/*` routes the sites call |

## Database

The schema is in `packages/observatory/db/migrations/` (0003 platform, 0004 app ids and row-level security on the network tables, 0005 the console per app). Apply it with `bun run db:migrate` (`-- --url <local url>` for another database). Tests make a database of their own on the dev cluster (port 54339). The roles and the order are in [docs/runbook-real.md](../../docs/runbook-real.md) sections 1 and 2.

## Public API

`createPublicApi({ store, otp, turnstile, hostMap, onJoin, onStop, onForget, onExport, ... })` returns a fetch handler. It answers `undefined` for paths outside `/api`, so any `Bun.serve` can mount it. The Network service mounts it on `PLATFORM_API_PORT` (8790) and supplies the hooks.

| Route | Answer |
|---|---|
| `POST /api/auth/otp/start {phone, turnstileToken?}` | Always `{ok:true}` after at least 700 ms, known phone or not. `429 {ok:false, error:"rate_limited"}` over the limits. +1 numbers only. |
| `POST /api/auth/otp/verify {phone, code}` | `{ok:true}` and a session cookie, or `400 invalid_code` |
| `POST /api/auth/logout` | `{ok:true}`, cookie cleared |
| `GET /api/me` | 401, or `{app, phoneMasked, membership, canJoin, reason?}` |
| `POST /api/join {firstName, age, neighborhood?, zip?, interests?, about?, consent: {sms: true, wording}}` | `{ok:true, membership}` or `400 under_age \| invite_only \| invalid` |
| `POST /api/me/share {fromApp, fields}` | Stores a base-profile grant (`first_name`, `city`, `age_band`, `interests`). No site shows it. |
| `GET /api/me/export` | This app's data only |
| `POST /api/me/stop` | Opts out of this app |
| `POST /api/me/delete {scope: "app" \| "all"}` | Leave this app (the forget path), or delete every membership and the phone (a tombstone and a suppression hash stay) |
| `GET /api/app` | `{id, name, domain, joinMode, minJoinAge}` |
| `GET /api/demo` | The replay from the `demo` option. The service supplies none yet, so it answers 404 `not_found`. |

The app comes from the Host header (`DEFAULT_HOST_MAP`: the four domains, their `www` names, and `localhost` / `127.0.0.1` ports 5101-5104). The dev proxy's `X-Forwarded-Host` is trusted only with `PLATFORM_ENV=dev` on a local bind. The client IP for the rate limits is the socket address, or the one header named in `PLATFORM_TRUSTED_IP_HEADER` (set by the proxy in front); a header the client sets is never read. An explicit `app` that does not match the Host gets `400 app_mismatch`. The cookie is `sid_<app>` in dev (the localhost ports share cookies) and `__Host-sid` with `Secure` everywhere else; always `HttpOnly; SameSite=Lax`. A session is rotated after a day; the old token works for 60 more seconds.

## Environment

| Variable | What it does |
|---|---|
| `PLATFORM_HASH_KEY` | The HMAC key for phone, IP and code hashes. Required outside `PLATFORM_ENV=dev`. Changing it orphans old suppression hashes and age floors. |
| `PLATFORM_TRUSTED_IP_HEADER` | The header the proxy in front sets with the client IP (for example `cf-connecting-ip`). Without it, the socket address. |
| `PLATFORM_STOP_SCOPE` | `app` (default) or `global`: what STOP on one app's own line stops |
| `OTP_PROVIDER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` | `twilio` uses Twilio Verify; anything else uses the dev console (codes in the log; `PLATFORM_ENV=dev` only) |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile; without it, the dev bypass (`PLATFORM_ENV=dev` only) |
| `PLATFORM_ENV` | `production`, `staging` or `dev`. Detection fails closed: an environment that is not declared dev gets no dev shortcut. `bun test` (`NODE_ENV=test`) counts as dev. |

## Rules the code keeps

- Nothing crosses apps by default. A share grant names base-profile fields only. Sensitive classes are never shareable.
- No enumeration: `/api/auth/otp/start` gives the same answer, after at least the same time, for a known and an unknown phone.
- An under-age join stores nothing for that app. The age goes to the phone's age floor (`platform.age_floor`: a keyed phone hash and an age), so a retry with an older age is refused, also after a delete of everything. `/api/me` does not show the age: `canJoin` stays true until the join is refused.
- A number not seen for 12 months is put on hold at its next login or message (`phone_identities.hold`). While it is held it has no person: `/api/me` says `reason: "review"`, and export, leave, delete and join are refused. Staff decide with `Accounts.clearHold` (the service's `/holds` route).
- A delete of everything leaves a suppression hash. A staff invite to that number is refused; a new join by the person lifts it.
- `/api/me/share` gives the same answer whether or not a grant was stored.
- OTP: 3 codes per number per hour across every app, 10 per IP, a 30 s gap, a global budget (500 an hour), and 10 code checks per number and 30 per IP an hour.
- The dev OTP console, the Turnstile bypass, the dev hash key and the trusted `X-Forwarded-Host` run only with `PLATFORM_ENV=dev`.
- Nothing is sent in tests. The Twilio adapter runs only with `OTP_PROVIDER=twilio` and its credentials.

## Tests

```bash
bun test packages/platform
```

After the safety fixes (2026-10-08): 48 pass, 0 fail.

## Known gaps

- Not built: the carrier lookup (VoIP, landline, recent port), Turnstile on the sites, the share UI, an engine view that reads share grants, the demo replay, and the app-specific tables (peon orgs, roles, applications; slop dating preferences; `facets.sensitive_class`).
- `@thenetwork/platform` is not in `bun.lock` yet (nobody ran `bun install` after the package was added). Code imports it by relative path.
