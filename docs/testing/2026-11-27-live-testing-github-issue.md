# Master Live Testing Plan & User Manifest (All Systems)

This issue tracks end-to-end live testing across **all 7 systems** of The Network (**133 concrete live test cases**: 84 `AUTO-LIVE`, 38 `SEMI-AUTO`, 11 `MANUAL`) using real LLMs (`gpt-6-luna` on Surplus + OpenAI fallback), Workers AI (Clef), real Postgres, R2, Blooio/Twilio, Turnstile, real AI clients (Claude, ChatGPT, Codex, Cursor, OpenClaw), Luma/Meetup/Partiful, Google Places/Yelp, External Matchmakers, Observatory, Cloudflare deploy, and the Marketing Engine.

- **Full Master Plan & Complete Env Var Reference**: [`docs/testing/2026-11-27-live-testing-plan-and-manifest.md`](docs/testing/2026-11-27-live-testing-plan-and-manifest.md)
- **Idempotent Live-Test Runner**: `scripts/live-test/` (`pnpm run live-test`)

---

## 1. What We Need From You (Phased Rollout Manifest)

Provide credentials phase by phase. Every live send/billing/device switch is **fail-closed** behind allowlists (`LIVE_TEST_ALLOWLIST_*`) and `LIVE_TEST_CONFIRM_LIVE_SEND=ALLOWLIST_ONLY`.

### Phase 0 — Real-LLM Dual-Sided Simulation & Evals (~$2–$5 budget, 0 real user messaging)
- [ ] `SURPLUS_API_KEY` (primary `gpt-6-luna` for core, review judge, recommender, journey-eval, marketing)
- [ ] `OPENAI_API_KEY` (automatic fallback on Surplus 408/429/5xx/timeout)
- [ ] Cloudflare Workers AI: `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_AI_TOKEN` (for `relay-eval --live`, `clef features --live`, `WorkersAIClefRater`, `WorkersAiPhotoScreen`)
- [ ] *(Optional)* 3–5 consented local adult test portraits + 1 synthetic contact-overlay image for `LT-CORE-08` / `LT-CORE-10`

### Phase 1 — Staging Main App, Telephony, Verification, Photos & MCP (~$20/mo + test SIMs)
- [ ] Isolated staging Postgres 16+ DB + non-superuser roles (`MIGRATION_DATABASE_URL`, `NETWORK_DATABASE_URL`, `NETWORK_PUBLIC_EVENTS_DATABASE_URL`, `NETWORK_SERVICE_AUDIT_DATABASE_URL`, `OBSERVATORY_DATABASE_URL_{NTWRK,SLOP,PEON,FRIENDS}`, `OBSERVATORY_PLATFORM_DATABASE_URL`, `OBSERVATORY_AUDIT_DATABASE_URL`)
- [ ] Staging private R2 photo bucket (`R2_ACCOUNT_ID`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `PHOTO_STORAGE=r2`, `PHOTO_VIEW_BASE_URL`)
- [ ] Distinct >=32-byte signing secrets (`PLATFORM_SESSION_SECRET`, `PLATFORM_HASH_KEY`, `PLATFORM_PROXY_SECRET`, `PLATFORM_PROXY_SECRET_PREVIOUS`, `LEAK_LABEL_KEY`, `SERVICE_TURN_SECRET`, `NETWORK_CALENDAR_FREE_BUSY_SECRET`, `NETWORK_SERVICE_TOKENS`, `NETWORK_SERVICE_CONSOLE_TOKEN`)
- [ ] Blooio staging line (`BLOOIO_API_KEY`, `BLOOIO_WEBHOOK_SECRET`, `BLOOIO_FROM` — set `NETWORK_CHANNEL=blooio` ONLY in staging with allowlist; never locally!)
- [ ] Twilio Verify OTP (`OTP_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`)
- [ ] Cloudflare Turnstile staging widget (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`)
- [ ] **3–4 dedicated real test SIMs/phones** (all added to `LIVE_TEST_ALLOWLIST_PHONES`):
  - [ ] `TEST_PHONE_A` — Adult primary (iPhone w/ iMessage)
  - [ ] `TEST_PHONE_B` — Adult secondary (Android SMS / wrong-phone / `/phone` swap)
  - [ ] `TEST_PHONE_C` — Adult third participant (3+ groups, external prospect SMS handoff)
  - [ ] `TEST_PHONE_MINOR` — Teen test SIM (age 15–16 friend intro & `<13` refusal tests)
- [ ] Real AI client test accounts: **Claude Pro/Team Web + Claude Code CLI**, **ChatGPT Plus/Team Web + Codex CLI**, **Cursor IDE**, **OpenClaw**
- [ ] Real test browsers: **Chrome desktop**, **macOS Safari**, **iOS Mobile Safari**, **Android Chrome**
- [ ] *(If testing Eliza Cloud handoff)* `NETWORK_CLOUD_AUTH_MODE`, `NETWORK_CLOUD_AUTH_{LOGIN_ORIGIN,API_ORIGIN,SITE_ORIGIN,SERVER_TOKEN}`, `NETWORK_CLOUD_DELIVERY_ORIGIN`
- [ ] Observatory Cloudflare Access identities (1 MFA admin/safety/reviewer, 1 single-factor OTP user, 1 analyst) + staging `ALERT_WEBHOOK_URL`

### Phase 2 — Venues & External Event Platforms (Impromptu Friend Meetups)
- [ ] `GOOGLE_PLACES_API_KEY` (GCP project with **Places API (New)** + billing enabled)
- [ ] *(Optional)* `YELP_API_KEY` (Yelp Fusion v3)
- [ ] Luma Plus host calendar account + `LUMA_API_KEY` + `LUMA_WEBHOOK_SECRET` + staging webhook pointing to `POST /webhooks/luma`
- [ ] Meetup Pro organizer private test group (`groupUrlname`) + OAuth2 client/access token (`https://api.meetup.com/gql-ext`)
- [ ] Partiful host account (verified US mobile login for assisted Event Kit paste)
- [ ] Feature flags enabled in staging: `NETWORK_EXTERNAL_EVENTS=1`, `NETWORK_CALENDAR_REVEAL_LINKS=1`

### Phase 3 — Marketing Engine (5 Personas, VIP/Apollo, Email, Video, Crowdsourcing & Social)
- [ ] `APOLLO_API_KEY` (master key; cap test runs to 2 credits/day)
- [ ] Warm sending domain w/ **SPF, DKIM, DMARC** verified + `RESEND_API_KEY` (and/or `AGENTMAIL_API_KEY`+`AGENTMAIL_INBOX_ID` or `SMTP_*`) + `MARKETING_FROM_EMAIL`
- [ ] Allowlisted test email inboxes (`LIVE_TEST_ALLOWLIST_EMAILS`)
- [ ] Video / TTS / Avatar keys: `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID`, `HEDRA_API_KEY`, `KLING_API_KEY`
- [ ] QR / Voice / Crowdsourcing / Sandbox payout keys: `DUB_API_KEY` + `DUB_WORKSPACE_ID`, `TWILIO_FROM_NUMBER`, `RENTAHUMAN_API_KEY`, `PRINTFUL_API_KEY` + `PRINTFUL_DEFAULT_VARIANT_ID`, `FOUROVER_API_KEY` + `FOUROVER_ENDPOINT`, `LOB_API_KEY` (`test_...`) + `LOB_FROM_*`, `STRIPE_SECRET_KEY` (`sk_test_...`), `TREMENDOUS_API_KEY` + `TREMENDOUS_FUNDING_SOURCE_ID` (sandbox)
- [ ] Tier-2 USB test phones (1 Android `adb`/`scrcpy` + 1 iPhone `devicectl`/`pymobiledevice3` + loopback `MARKETING_WDA_URL=http://127.0.0.1:8100`, cellular SIMs) + allowlisted test handles (`LIVE_TEST_ALLOWLIST_HANDLES`) for X, LinkedIn, IG, TikTok, Reddit, YouTube
- [ ] *(Optional)* Small Craigslist gig posting budget (~$5–$15) for `LT-MKT-26`
- [ ] Marketing core/bridge auth (`MARKETING_TOKEN`, `MARKETING_OPS_BASE_URL`, matching `PLATFORM_HASH_KEY`, `LEAK_LABEL_KEY`; keep `MARKETING_SLOP_CASH_ENABLED=0`)

### Phase 4 — External Dating Matchmakers (Human-Operated Pilot — Founder Approval Required)
- [ ] Explicit written founder approval for live dating-app pilot
- [ ] Minimum pilot set (**2 personas = 1F + 1M in 1 city**, scaling to 10 personas across 5 cities):
  - [ ] 2 clean dedicated physical smartphones + 2 non-VoIP US carrier SIM/eSIMs + 2 local city residential/cellular IPs + 2 unique emails
  - [ ] 2 human operators able to pass selfie/liveness checks (start Hinge-first, then Bumble/Tinder)
  - [ ] 2 allowlisted internal test receiver profiles + allowlisted test prospect phone numbers for off-app SMS opt-in handoff
  - [ ] Anti-ban warmup compliance verified (bio passes `containsUrlOrBrandSpam === false`, 72h warmup, <=3 actions/day, zero cold outreach to strangers)

### Phase 5 — Staging Deploy & Production Read-Only Smoke
- [ ] Cloudflare staging origins (`STAGING_SITE_ORIGINS` — 4 unique non-prod HTTPS origins) + isolated `BACKEND_ORIGIN` + `network-observatory-staging`
- [ ] Ops & backup secrets: `OPS_METRICS_TOKEN`, `ALERT_WEBHOOK_URL`, `OPS_HEARTBEAT_URL`, `BACKUP_DATABASE_URL`, `BACKUP_R2_*`, `BACKUP_ENCRYPTION_KEY`, `BACKUP_HEARTBEAT_URL`, `RESTORE_DATABASE_URL`, `RESTORE_SOURCE_DATABASE_URL`
- [ ] **Deploy Safety Lock**: `NTWRK_ALLOW_DEPLOY=1` is NEVER automated without founder approval; production domains receive read-only `deploy/smoke.ts` ONLY

---

## 2. Pre-Live-Test Code Gaps to Track

- [x] **P0** Wire `GET /cal/:token.ics` in `deploy/router.ts` (`RUN_WORKER_FIRST`, `isBackendPath`) and `deploy/backend/backend.ts` (`publicFetch`) with security tests *(fixed in this PR — verify live in `LT-SITE-10`)*
- [ ] **P1** Reconcile Luma API base URL & payload drift (`packages/core/src/externalEvents.ts` `public-api.luma.com/v1/events/create` vs `apps/marketing/src/adapters/paid.ts` `api.lu.ma/public/v1/event/create`) during `LT-EXT-01`
- [ ] **P1** Populate `google_place_id` / `yelp_id` (`externalPlaceId`) on curated seed venues (0/75 currently set) and instantiate `CompositeVenueProvider` in `NetworkService`
- [ ] **P1** Wire automated outbound execution (or explicit job runner) for `buildLumaCreateEventRequest`, `buildLumaUpdateGuestStatusRequest`, `buildMeetupCreateEventRequest`, `buildMeetupPollRsvpsRequest`, plus Meetup OAuth2 env vars
- [ ] **P1** Resolve ChatGPT DCR doc/behavior discrepancy on `https://slop.date/mcp` vs `https://ntwrk.party/mcp/slop/openai` and verify 518-char `toolInstructions` on `/mcp/slop/openai` (`LT-MCP-01`, `LT-MCP-06`)
- [ ] **P1** Decide & implement Marketing -> Platform reverse STOP sync (currently one-way via `marketing.contact_fence`), inbound marketing webhooks (Resend/Twilio/Blooio/Stripe/Dub), `/api/*` rate limiter, and verify `ops.ntwrk.party` clickwrap routes (`LT-MKT-08`, `LT-MKT-26`)
- [ ] **P2** Add Observatory web UI controls for `c.llm` telemetry, `POST /api/staff/teen-intros`, and `POST /api/staff/review/:id/stop` (REST APIs work today)
- [ ] **P2** Replace placeholder `plugins/openai/assets/{icon,logo}.png` before ChatGPT plugin submission; align `docs/marketing/APOLLO-AND-OUTREACH-PLAYBOOK.md` cap numbers with `platform-playbooks.ts`

---

## 3. Master Live-Test Execution Checklist (133 Cases Across 7 Suites)

### Suite 1 (`core`) — Main App Core, Real LLM, Messaging, Safety & Postgres (34 Cases)
- [ ] `LT-CORE-01` `[AUTO-LIVE]` `[P0]` Surplus primary (`gpt-6-luna`) + OpenAI fallback + prompt caching + `cost_ledger`
- [ ] `LT-CORE-02` `[AUTO-LIVE]` `[P0]` Review Judge live qualification (`review-eval --live`, `must_flag` recall = 1.0, adult & minor rubrics, `packetSuspect`)
- [ ] `LT-CORE-03` `[AUTO-LIVE]` `[P0]` Review & Engine Judge daily budget/request caps + UTC midnight reset
- [ ] `LT-CORE-04` `[AUTO-LIVE]` `[P0]` Engine Judge (`recommenderLLM`) live candidate ranking + `vampire_extraction`/`league_mismatch`
- [ ] `LT-CORE-05` `[AUTO-LIVE]` `[P0]` `llmUnderstand` diverse personas (Spanish/ESL, Gen-Z, 60+, >1500-char rambler, prompt injection)
- [ ] `LT-CORE-06` `[AUTO-LIVE]` `[P0]` Venue Top-1 suggestion, `rerankTopVenuesWithLLM` & 3 red-line pivots (`sober`/`wheelchair`/`noise`)
- [ ] `LT-CORE-07` `[AUTO-LIVE]` `[P2]` External venue discovery (Google Places + Yelp) & pre-recommend open-status check
- [ ] `LT-CORE-08` `[AUTO-LIVE]` `[P0]` Workers AI `WorkersAIClefRater` photo rating (`adultsOnly` guard, group reject, >4 MiB reject)
- [ ] `LT-CORE-09` `[AUTO-LIVE]` `[P0]` Workers AI `clefRelayClassifierFromEnv` relay moderation (6 buckets, PII mask, severe auto-block, fail-closed timeout)
- [ ] `LT-CORE-10` `[AUTO-LIVE]` `[P0]` Workers AI `photo-screen.ts` NSFW & contact-info overlay gate + SHA-256 cache + fail-closed timeout
- [ ] `LT-CORE-11` `[AUTO-LIVE]` `[P0]` Age policy `<13` refusal, purge, numeric floor & youngest-reading-wins (no false trigger on quoted age)
- [ ] `LT-CORE-12` `[AUTO-LIVE]` `[P0]` Teen policy (`13-17`) guardrails across all 4 apps + `POST /teen-intros` kill switch & admin-only restore
- [ ] `LT-CORE-13` `[AUTO-LIVE]` `[P0]` All 4 apps & 5 cities routing, waitlist vs `nyc` active, TZ, transit barriers & RLS isolation
- [ ] `LT-CORE-14` `[AUTO-LIVE]` `[P0]` 1:1 matching: `parallel` vs `wanter_first` probe order + LeakGuard counter-proposal relay
- [ ] `LT-CORE-15` `[AUTO-LIVE]` `[P0]` `silentPartnerVenueSwap` pre-reveal & scheduling swap (zero private red-line leak)
- [ ] `LT-CORE-16` `[AUTO-LIVE]` `[P1]` Booked reveal & dual `.ics` calendar invite paths (`/cal/:token.ics` + `/api/calendar/invite`)
- [ ] `LT-CORE-17` `[AUTO-LIVE]` `[P0]` Group plans: `openTable: true`, 3→2 opt-in pivot & `friends` 1-slot bare-`"yes"` acceptance
- [ ] `LT-CORE-18` `[AUTO-LIVE]` `[P0]` Day-of coordination: `pre_brief`, arrival relay, 75s group digest & `sanitizeArrivalCue` PII scrub
- [ ] `LT-CORE-19` `[AUTO-LIVE]` `[P0]` Day-of `venue_full` / `venue_closed` backup pivot & quarantine (adult + teen all-ages check)
- [ ] `LT-CORE-20` `[AUTO-LIVE]` `[P0]` No-show ping/release, natural post-meetup feedback & `second_encounter` generation
- [ ] `LT-CORE-21` `[SEMI-AUTO]` `[P1]` `slop.date` R2 photo upload, naming, consent relay, device-bound view link, `PHOTO LINK` rotation & take-back
- [ ] `LT-CORE-22` `[AUTO-LIVE]` `[P0]` `peon.biz` employer verification, `POST /postings`, work intro & `POST /postings/:id/close`
- [ ] `LT-CORE-23` `[AUTO-LIVE]` `[P0]` Emergency panic (`statesImmediateDanger`), arrival halt & staff safety hold/ban/lift/close
- [ ] `LT-CORE-24` `[MANUAL]` `[P1]` Live Blooio iMessage/SMS ingress, HMAC signature, line caps & `unknown_acceptance` crash recovery
- [ ] `LT-CORE-25` `[SEMI-AUTO]` `[P1]` Live `eliza_cloud` seam (`/internal/turn`, Cloud delivery origin, webhook disabled)
- [ ] `LT-CORE-26` `[SEMI-AUTO]` `[P1]` Live OTP (`twilio` & `blooio`), Turnstile hostname verify & `otpLimits`
- [ ] `LT-CORE-27` `[SEMI-AUTO]` `[P1]` Phone number change (`/phone`) atomic swap & session/grant fencing
- [ ] `LT-CORE-28` `[MANUAL]` `[P1]` City-TZ quiet hours & `STOP` / `HELP` / `START` / `PAUSE` / `RESUME` compliance keywords
- [ ] `LT-CORE-29` `[AUTO-LIVE]` `[P1]` Multi-app shared line disambiguation (`route-authority` + `/inbound/resolve`)
- [ ] `LT-CORE-30` `[AUTO-LIVE]` `[P0]` Postgres migrations (`0003`–`0102` + `9001`/`9002`) idempotency, prefix check & RLS enforcement
- [ ] `LT-CORE-31` `[AUTO-LIVE]` `[P5]` Backup to encrypted R2 & `restore.ts --replay` (post-backup erasure/STOP/ban survival)
- [ ] `LT-CORE-32` `[AUTO-LIVE]` `[P1]` 60s tick loop multi-instance locking & graceful `SIGTERM` shutdown
- [ ] `LT-CORE-33` `[AUTO-LIVE]` `[P1]` Retention purge (`review_judgments` safety-case preservation) & full erasure cascade (DB + R2 + OAuth)
- [ ] `LT-CORE-34` `[SEMI-AUTO]` `[P1]` `packages/notify` single inbox, multi-surface routing (`deeplink`/`button_page`), `ignoredStreak >= 2` fallback & leak gate

### Suite 2 (`mcp`) — Personal AI Agents (MCP) & Real AI Clients (16 Cases)
- [ ] `LT-MCP-01` `[AUTO-LIVE]` `[P1]` Discovery (RFC 8414/9728), MCP `2026-07-28` + `2025-11-25`, cross-app isolation & zero dating words on `/mcp/openai`
- [ ] `LT-MCP-02` `[AUTO-LIVE]` `[P1]` OAuth 2.1 PKCE S256, code replay kill, refresh rotation replay kill & cross-app token `401`
- [ ] `LT-MCP-03` `[SEMI-AUTO]` `[P1]` **Claude Web** full OAuth -> `prepare_signup` -> `finish_signup_url` -> immediate `submit_profile` (no reconnect)
- [ ] `LT-MCP-04` `[SEMI-AUTO]` `[P1]` **Claude Code CLI** plugin validate/install + loopback `local_agent` + zero SMS double-ping
- [ ] `LT-MCP-05` `[SEMI-AUTO]` `[P1]` **Codex CLI** direct Streamable HTTP MCP loopback (`local_agent`) + `get_context`/`submit_profile`/`set_availability`
- [ ] `LT-MCP-06` `[MANUAL]` `[P1]` **ChatGPT Web** `/mcp/openai` & `/mcp/slop/openai` + `_meta["mcp/www_authenticate"]` scope step-up
- [ ] `LT-MCP-07` `[MANUAL]` `[P1]` **Cursor IDE** (`/mcp/peon`) & **OpenClaw** (`/mcp/friends` + `/SKILL.md`) live client runs
- [ ] `LT-MCP-08` `[AUTO-LIVE]` `[P1]` Scope gating matrix across all 15 MCP tools (`membership:read`, `profile:read`, `profile:write`, `photos:use`)
- [ ] `LT-MCP-09` `[AUTO-LIVE]` `[P1]` Daily caps (5 profile writes -> `429 -31029`; 3 standing-intent toggles -> `daily_limit`; job post refused)
- [ ] `LT-MCP-10` `[SEMI-AUTO]` `[P1]` Prompt injection & contact/OTP input/output gate (`contactOrCode`, `additionalProperties:false`, `passesOutputGate`)
- [ ] `LT-MCP-11` `[SEMI-AUTO]` `[P1]` Pass 4 `finish_signup_url` happy path (single-use prefill) & wrong-phone `403` attack
- [ ] `LT-MCP-12` `[SEMI-AUTO]` `[P1]` Minor (age 15) on `slop` & `friends` MCP (`MinorSlopNotice`, `adults_only`) + `<13` draft discard
- [ ] `LT-MCP-13` `[SEMI-AUTO]` `[P1]` `slop` adult `my_photos` metadata-only boundary & `photo_request` SMS-confirm gate
- [ ] `LT-MCP-14` `[AUTO-LIVE]` `[P1]` Forget / ban immediate OAuth grant revocation (`401 invalid_token`) & draft purge
- [ ] `LT-MCP-15` `[SEMI-AUTO]` `[P1]` Connected Assistants two-step revocation (`/oauth/consents` + `consentRemovalMac`)
- [ ] `LT-MCP-16` `[MANUAL]` `[P1]` Real LLM client social-engineering guardrails (OTP paste, friend lookup, cross-app attempts)

### Suite 3 (`site`) — Public Sites, OAuth Pages & `/cal/:token.ics` (14 Cases)
- [ ] `LT-SITE-01` `[AUTO-LIVE]` `[P1/P5]` `deploy/smoke.ts` across all 4 origins (headers, `/SKILL.md` sha256, `/terms`, `/join` 200 vs 302, retired 404s)
- [ ] `LT-SITE-02` `[MANUAL]` `[P1]` Landing page UX & 4-browser matrix (Chrome, macOS Safari, iOS Safari, Android Chrome, `sms:` fallback, no-JS)
- [ ] `LT-SITE-03` `[SEMI-AUTO]` `[P1]` Real Cloudflare Turnstile on `AuthPhoneView` & `peon.biz/join` (hostname verify + `>=700ms` pad)
- [ ] `LT-SITE-04` `[SEMI-AUTO]` `[P1]` `AuthCodeView` wrong code, resend SMS, rate limit (`429`) & change phone number
- [ ] `LT-SITE-05` `[SEMI-AUTO]` `[P1]` `AuthSignupView` validation, teen-friend copy, SMS consent checkbox & `ntwrk` invite-only enforcement
- [ ] `LT-SITE-06` `[MANUAL]` `[P1]` Safari ITP & iOS Mobile Safari `__Host-mcp_auth` cookie persistence across OAuth redirects
- [ ] `LT-SITE-07` `[SEMI-AUTO]` `[P1]` `peon.biz/join` full browser join flow + `<13` `BlockedStep`
- [ ] `LT-SITE-08` `[SEMI-AUTO]` `[P1]` `/phone` number change web flow (`reauth`, `PhoneSameNumber`, `409`, OTP swap)
- [ ] `LT-SITE-09` `[SEMI-AUTO]` `[P1]` Cloud OAuth handoff (`/api/auth/cloud/{start,callback}`, `svcSign`) + `pnpm run check:mirror`
- [ ] `LT-SITE-10` `[AUTO-LIVE]` `[P1/P5]` Calendar `.ics` downloads via `/api/calendar/invite` AND `/cal/:token.ics` behind Pages + `deploy/backend`
- [ ] `LT-SITE-11` `[SEMI-AUTO]` `[P1]` `slop.date` photo pages (`/photos/{add,check,mine,view}`), EXIF strip, private R2 & device-bound cookie
- [ ] `LT-SITE-12` `[SEMI-AUTO]` `[P1]` `/home-help` private address submit, reveal & revoke flow
- [ ] `LT-SITE-13` `[AUTO-LIVE]` `[P1/P5]` `/u/<T-XXXXXX>` update handoff edge route (`no-store`, `noindex`, `404` bad token, `405` POST)
- [ ] `LT-SITE-14` `[AUTO-LIVE]` `[P0/P1]` `plugins/build.ts --check` & zero `OPENAI_EXCLUDED` terms in `plugins/openai/**`

### Suite 4 (`obs`) — Observatory Staff Console (10 Cases)
- [ ] `LT-OBS-01` `[SEMI-AUTO]` `[P1/P5]` Cloudflare Access SSO, MFA gate (`403 second_factor_required` on single-factor) & static token refusal
- [ ] `LT-OBS-02` `[AUTO-LIVE]` `[P1]` RBAC, `analyst` masking, `reviewer` app isolation, `cross_app_safety` audit & `409 mode_changed`
- [ ] `LT-OBS-03` `[AUTO-LIVE]` `[P1]` WebSocket `/ws` 30s single-use ticket, role-shaped live deltas & `4401`/`4403` close on expiry/revocation
- [ ] `LT-OBS-04` `[SEMI-AUTO]` `[P1]` `/review` held-item approve/reject, stale revision reject, `POST /api/staff/review/:id/stop` & `/judged`
- [ ] `LT-OBS-05` `[AUTO-LIVE]` `[P1]` `POST /api/staff/teen-intros` kill switch (safety stops all apps, admin-only restore, audited)
- [ ] `LT-OBS-06` `[AUTO-LIVE]` `[P1]` Cost ledger & `c.llm` telemetry (`GET /api/ops/cost?days=14`, cacheHitRate, fallbacks, latency, `CostPanel`)
- [ ] `LT-OBS-07` `[SEMI-AUTO]` `[P1]` Held queues (`leak` + `relay` photo `409 photo_preview_required` gate & 5m preview token)
- [ ] `LT-OBS-08` `[AUTO-LIVE]` `[P1]` PII reveal lifecycle (<=15m, >=5-char reason) & fail-closed `503` when audit DB unwritable
- [ ] `LT-OBS-09` `[AUTO-LIVE]` `[P1]` Turn-watch counts (zero PII), `POST /api/staff/inbound/resolve` (admin-only) & `/api/audit` filters
- [ ] `LT-OBS-10` `[AUTO-LIVE]` `[P1/P5]` Read-only Observatory Postgres logins (`default_transaction_read_only=on`, RLS, no `channel_identities`)

### Suite 5 (`deploy`) — Cloudflare Router, Backend Deploy, Backups & Logging (9 Cases)
- [ ] `LT-DEPLOY-01` `[AUTO-LIVE]` `[P5]` Edge proxy signing (`verifyProxyHeaders`), forged-header stripping & direct-origin `421 edge_required`
- [ ] `LT-DEPLOY-02` `[AUTO-LIVE]` `[P5]` Zero-downtime `PLATFORM_PROXY_SECRET` rotation via `PLATFORM_PROXY_SECRET_PREVIOUS`
- [ ] `LT-DEPLOY-03` `[AUTO-LIVE]` `[P5]` VibeLang health shell (`GET /healthz` `200` healthy vs `503 database|tick_late`)
- [ ] `LT-DEPLOY-04` `[SEMI-AUTO]` `[P5]` VibeLang graceful shutdown shell (`SIGTERM` -> `503 draining`, in-flight drain, clean exit `0`)
- [ ] `LT-DEPLOY-05` `[AUTO-LIVE]` `[P5]` `GET /ops/metrics` (`401`/`200`), `ALERT_WEBHOOK_URL` firing/resolved notices & `OPS_HEARTBEAT_URL`
- [ ] `LT-DEPLOY-06` `[AUTO-LIVE]` `[P5]` Boot policy hardening (refuses superuser/owner DB, equal secrets, non-R2 photos, dev flags, `STAFF_PORT===PORT`)
- [ ] `LT-DEPLOY-07` `[AUTO-LIVE]` `[P5]` `scripts/wrangler.sh` deploy guard (exit `3` w/o `NTWRK_ALLOW_DEPLOY=1`, flag smuggling blocked, prod rejects staging origins)
- [ ] `LT-DEPLOY-08` `[AUTO-LIVE]` `[P5]` `deploy/backup/` encrypted R2 backup + heartbeat + `restore.ts --replay` privacy drill
- [ ] `LT-DEPLOY-09` `[AUTO-LIVE]` `[P5]` Redacted structured JSON logs (0 raw E.164 phones, OTPs, Bearer tokens, cookies, message bodies)

### Suite 6 (`ext`) — External Events, Venues & Live Meetup Coordination (24 Cases)
- [ ] `LT-EXT-01` `[AUTO-LIVE]` `[P2]` Luma Plus live API contract check (URL/schema drift), private event create & immediate delete
- [ ] `LT-EXT-02` `[SEMI-AUTO]` `[P2]` Luma live RSVP webhook HMAC verify, adult/ESL/minor/injection screening, cap waitlist & cancellation
- [ ] `LT-EXT-03` `[AUTO-LIVE]` `[P2]` External event staff review, publish gate DB constraint & T-24h quorum/anchor-failover sweep
- [ ] `LT-EXT-04` `[AUTO-LIVE]` `[P2]` Post-event positive-feedback-gated external attendee invite (`validateOutboundSms`, `STOP`, <=360 chars)
- [ ] `LT-EXT-05` `[AUTO-LIVE]` `[P2]` Meetup.com OAuth2 + GraphQL (`gql-ext`) private event create, RSVP question poll & immediate cancel
- [ ] `LT-EXT-06` `[MANUAL]` `[P2]` Partiful assisted Event Kit telecom/alcohol scrub + manual private event + `attachPartifulUrl` + delete
- [ ] `LT-EXT-07` `[AUTO-LIVE]` `[P2]` Live NYC Parks public event feed ingest (idempotent re-run) & `soloConciergeReply` (NYC adult/teen + non-NYC fallback)
- [ ] `LT-EXT-08` `[MANUAL]` `[P4]` Pilot matchmaker account provisioning (2 personas, 1 city, clean devices/SIMs, bio lint, 72h anti-ban warmup)
- [ ] `LT-EXT-09` `[SEMI-AUTO]` `[P4]` Transparent opener & multi-turn prospect chat (`standard`/`casual`, 0 URLs/brand spam) w/ allowlisted test profile
- [ ] `LT-EXT-10` `[AUTO-LIVE]` `[P4]` Matchmaker single-persona routing lock (`persona_lock_conflict`), daily cap (10 -> 5 degraded -> 0 suspended)
- [ ] `LT-EXT-11` `[SEMI-AUTO]` `[P4]` Underage detection, CTIA `STOP` & permanent HMAC tombstone across `external_prospect_suppressions` + `marketing.humans`
- [ ] `LT-EXT-12` `[SEMI-AUTO]` `[P4]` Off-app SMS opt-in handoff (`STOP` + rates wording), staging logistics SMS & `STOP` halt
- [ ] `LT-EXT-13` `[AUTO-LIVE]` `[P4]` Staff matchmaker kill-switch (`suspended`) preserving `off_app_sms_opted_in` tickets & closing on-app tickets
- [ ] `LT-EXT-14` `[AUTO-LIVE]` `[P4]` `peon.biz` cross-app firewall (`403`, `forbidden_app`, fail-closed `slop`-only RLS, observatory denied)
- [ ] `LT-EXT-15` `[AUTO-LIVE]` `[P4]` Prospect TTL expiry purge (14d/30d/60d -> 30d tombstone) & quality-gated post-date `warm_invite`
- [ ] `LT-EXT-16` `[AUTO-LIVE]` `[P2]` Live Google Places v1 & Yelp Fusion v3 search, 24h cache, weekday/weekend open check & closure quarantine
- [ ] `LT-EXT-17` `[AUTO-LIVE]` `[P2]` 5-city curated venue reality & full red-line audit (`sober`, `halal`, `kosher`, `gf`, `allergen`, `wheelchair`, `daytime`, `teen`, `peon`, `pokemon_tcg`)
- [ ] `LT-EXT-18` `[AUTO-LIVE]` `[P0]` Live `gpt-6-luna` Top-5 venue rerank (reasoning-first, zero leaks/invented IDs, LRU cache hit)
- [ ] `LT-EXT-19` `[SEMI-AUTO]` `[P2]` Top-1 suggestion flow, 3-pivot cap, `silentPartnerVenueSwap` & final-line booking link gate
- [ ] `LT-EXT-20` `[AUTO-LIVE]` `[P2]` Cross-app concurrent capacity holds (`platform.venue_concurrent_holds` advisory lock, release, expiry)
- [ ] `LT-EXT-21` `[SEMI-AUTO]` `[P2]` Live T-75m pre-brief, arrival relay (early late, PII strip, 75s group digest), panic halt & teen `minor_policy`
- [ ] `LT-EXT-22` `[SEMI-AUTO]` `[P2]` Day-of `venue_full` (0 quarantine) vs `venue_closed` (`suspect_closed` -> `closed_permanent`) backup pivot
- [ ] `LT-EXT-23` `[SEMI-AUTO]` `[P2]` No-show escalation (T+12m / T+18m / T+45m `member_reliability`) & natural rescheduling + DST guard
- [ ] `LT-EXT-24` `[AUTO-LIVE]` `[P2]` `PgMeetupStore` restart persistence (`0098`–`0102`), staff routes & `GET /ops/cities` readiness

### Suite 7 (`mkt`) — Marketing Engine (26 Cases)
- [ ] `LT-MKT-01` `[AUTO-LIVE]` `[P3]` Marketing server `/healthz`, Bearer auth (`401`/`200`), SSE `/api/events` & idempotent `/api/seed/nyc`
- [ ] `LT-MKT-02` `[AUTO-LIVE]` `[P3]` Live Surplus `gpt-6-luna` ticks across all 5 personas (`chadwick`, `sloane`, `peon`, `venn`, `operator`) + `cost_ledger`
- [ ] `LT-MKT-03` `[AUTO-LIVE]` `[P3]` Real-LLM objection handling (`are_you_ai`, `scam`, `free`, `how_it_works`, `go.<brand>` handoff)
- [ ] `LT-MKT-04` `[AUTO-LIVE]` `[P3]` Prompt injection, PII fencing (`<<<UNTRUSTED`) & `createMarketingLeakGuard` fail-closed block
- [ ] `LT-MKT-05` `[AUTO-LIVE]` `[P3]` Cross-contact `PromptCache` isolation & 0-token deterministic router (`CHECK_STOP`, `SCREEN_APPLICANT`, etc.)
- [ ] `LT-MKT-06` `[AUTO-LIVE]` `[P3]` Marketing LLM daily token/cost caps (`403 budget_blocked`) & provider failover (incl. Surplus -> OpenAI)
- [ ] `LT-MKT-07` `[AUTO-LIVE]` `[P3]` Platform -> Marketing STOP/ban/minor `contact_fence` blocking all 5 outbound/enrichment surfaces
- [ ] `LT-MKT-08` `[AUTO-LIVE]` `[P3]` Marketing STOP -> enrichment cache purge + verify one-way gap toward `platform.suppression`
- [ ] `LT-MKT-09` `[AUTO-LIVE]` `[P3]` Underage hard-stop across `/humans`, `/tasks`, applicant screening, Apollo (0 credits), intake & video lint
- [ ] `LT-MKT-10` `[AUTO-LIVE]` `[P3]` Queue backpressure (`supply_demand_k5`) pause & hysteresis resume in daemon + intake promote
- [ ] `LT-MKT-11` `[AUTO-LIVE]` `[P3]` Live Apollo 2-stage search (0 cr, cached) + enrich (work email only, 1 cr logged, `dailyCreditCap=2` enforced)
- [ ] `LT-MKT-12` `[AUTO-LIVE]` `[P3]` Real cold VIP email to allowlisted test inbox (<=75w, CAN-SPAM, SPF/DKIM/DMARC, 14d cooldown, quiet hours)
- [ ] `LT-MKT-13` `[AUTO-LIVE]` `[P3]` 10-platform playbooks lint (URL block, BFF romance block, Partiful SHAFT scrub) & rolling-20 circuit breaker
- [ ] `LT-MKT-14` `[AUTO-LIVE]` `[P3]` Quality intake anti-slop rubric (`>=70`) & `slop != peon` external prospect air-gap (`403`)
- [ ] `LT-MKT-15` `[AUTO-LIVE]` `[P3]` Live open-web discovery (`POST /api/discovery`) across public feeds (dedup, resilience, 0 PII leaks)
- [ ] `LT-MKT-16` `[SEMI-AUTO]` `[P3]` Video factory city localization, lint & 1 short live render per configured provider (ElevenLabs/Hedra/Kling)
- [ ] `LT-MKT-17` `[AUTO-LIVE]` `[P3]` BD venue flow: Twilio DTMF PIN callback, 6-yr clickwrap, Dub.co `go.<brand>` QR link & closure bridge sync
- [ ] `LT-MKT-18` `[AUTO-LIVE]` `[P3]` Twilio Lookup v2 (VoIP block, MVNO $2 cap) & anti-fraud gates (W-9 >$500, dup mediaHash, Sybil ring)
- [ ] `LT-MKT-19` `[SEMI-AUTO]` `[P3]` Crowdsourcing city compliance (NYC / SF AB5 / London), proof FTC/likeness gate & sandbox Stripe/Tremendous payout
- [ ] `LT-MKT-20` `[AUTO-LIVE]` `[P3]` `slop.cash` double-locked OFF (`403 SLOP_CASH_DISABLED`) & OSS-only wall (`SLOP_CASH_OSS_ONLY`)
- [ ] `LT-MKT-21` `[AUTO-LIVE]` `[P3]` Bandit rebalance auto-kill (>5% STOP / >2.5x CPA) & campaign STOP-spike `lockdown` breaker
- [ ] `LT-MKT-22` `[SEMI-AUTO]` `[P3]` Tier-2 USB `DeviceBridge` (Android `adb` + iOS `WDA`): telemetry, thermal/battery/warmup/lease/`needs_takeover` fail-closed
- [ ] `LT-MKT-23` `[SEMI-AUTO]` `[P3]` Marketing Luma private event create + Meetup GraphQL city discovery + immediate cleanup
- [ ] `LT-MKT-24` `[SEMI-AUTO]` `[P3]` Print / Postcard / RentAHuman sandbox adapters (Lob `test_`, Printful draft, spend-binding C-03)
- [ ] `LT-MKT-25` `[MANUAL]` `[P3]` Social accounts warmup, FTC `#Ad` video post, keyword reply & `go.<brand>` -> Turnstile handoff outside DMs
- [ ] `LT-MKT-26` `[MANUAL]` `[P3]` Craigslist relay inbox screening (`NYC 18+ CONFIRMED` vs underage/STOP) & `ops.ntwrk.party` clickwrap reachability

---

## 4. Commands to Run, Resume, Retry & Review Transcripts

```bash
# 1. Check readiness & missing credentials (zero network calls)
pnpm run live-test -- preflight
pnpm run live-test -- preflight --phase 0 --json

# 2. Run Phase 0 (real LLM + Workers AI evals & core probes; skips already-passed cases on resume)
pnpm run live-test -- run --phase 0 --budget-usd 2.00 --max-requests 150

# 3. Run a specific suite or case IDs
pnpm run live-test -- run --suite core
pnpm run live-test -- run --only LT-CORE-01,LT-CORE-02,LT-CORE-05

# 4. Check status & generate markdown report + Script-Review Queue (runs/live-test-report.md)
pnpm run live-test -- status
pnpm run live-test -- report

# 5. Record MANUAL / SEMI-AUTO human checks
pnpm run live-test -- mark-manual LT-MCP-06 --pass --notes "ChatGPT Web /mcp/openai + /mcp/slop/openai verified"

# 6. After fixing a bug, prompt, or copy script from transcript review: retry ONLY failed cases
pnpm run live-test -- run --retry-failed

# 7. Reset one case or all checkpoints for a fresh pass
pnpm run live-test -- reset LT-CORE-05
pnpm run live-test -- reset all
```

### Live Transcript Review Checklist (Inspect `runs/live-test-logs/<id>.json` Before Closing)
- [ ] Zero PII / partner-name / red-line / internal-score / Clef / prompt-fence leaks
- [ ] Warm, concise SMS-native cadence (1–3 short sentences, zero bot clichés)
- [ ] ESL, Gen-Z, 60+ formal, and >1200-char voice-to-text inputs handled cleanly
- [ ] Crisp probe choices, bare-`"yes"` on 1-slot `friends` plans, 1-turn red-line pivots
- [ ] Strict app tone separation (`slop`, `friends`, `peon`, `ntwrk`) & strict minor safety tone
- [ ] Zero repetition, zero re-suggested rejected/quarantined venues, 75s group digest active
- [ ] Latency within targets (`understand <2.5s`, `review_judge <6s`, `rerank <2.5s`, Clef `<1.5s`), `regrows === 0`, `cachedPromptTokens > 0`
