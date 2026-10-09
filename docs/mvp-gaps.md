# MVP gaps: what is left before the slop.date pilot in NYC

Status: 2026-10-08, checked against `origin/main` b2bb4d6 (after the cleanup in [CLEANUP-REPORT.md](CLEANUP-REPORT.md)). This is the detailed companion to [mvp-plan.md](mvp-plan.md). It started as a read-only gap analysis of c60db0a; paths and test references were updated for the cleaned repo (`packages/blooio`, `packages/sim/src/apps`, `bun run sim`, no unit or e2e tests). Gate numbers are quoted from `bun run sim` and the results docs. The PRD Google Doc (Sections 28, 37, 40) is canonical.

The frame (founder decisions):

- slop.date launches first, in New York, with ntwrk.love as the home page.
- One shared Blooio iMessage line, routed by keyword.
- All four sites are on Cloudflare Pages; the shared backend goes to Railway at `api.ntwrk.love`.
- Onboarding is agent-first: the person's own AI reads the site's `SKILL.md` and submits the profile through MCP.
- Minors (13-17) may join but are never matched. Adult means the lowest stated age is 18 or more; unknown fails closed.
- Photos are rated by Clef, the scores feed matching and are never shared.
- Exchange between matched members goes through the agent, with consent per item.
- No ID check; compliance is a deferred backlog (PRD 40.7).
- Only simulations are kept as tests (`bun run sim`).

## 0. Summary

- **The backend is built and deployable, but never deployed.** `deploy/backend/server.ts` brings up the migrations, the four networks (`ntwrk:nyc`, `slop:nyc`, `peon:nyc`, `friends:nyc`), the platform API, the signed Blooio webhook, keyword routing, STOP/HELP/leave, the person cap, the staff review and safety API, notify and MCP. No live send has been made; the Blooio path has only run against a fake provider.
- **The slop engine is mature in simulation** (`slop-pack-1.4.0`): every blocking gate passes, and five tracked gates fail on the pinned seeds (Section 4).
- **Five founder decisions are not yet on the live path:** the Clef rater is not passed to the service (`server.ts` sets no `photoRater`); the probe copy still says "no photo" (`packages/engine/src/packs/slop/copy.ts`); exchange through the agent (relay) does not exist; photos sent by text are dropped and no site page calls `/api/photos`; the onboarding conversation is deterministic (no `understand` or engine LLM wired, and `packages/plugin-network` is not on the line).
- **Operations gaps:** no external alerting, heartbeat or cost tracking; backups are a manual Railway step; the reviewer of record is the service token, not the person; nobody owns STOP/HELP if Eliza Cloud also receives the line's webhook.
- **Size:** about 35 engineer-days of build plus two weeks of shadow, for a reviewed, concierge-heavy NYC pilot of about 40-75 adults.

## 1. MVP status matrix

Status values: **Done** (in code, on the live path), **Partial**, **Missing**, **Deferred** (decided out of the first pilot), **Sim-only** (built and measured in a simulated world but not on the live path).

### 1.1 PRD 28.3 in-scope items

| Area | Status | Evidence | What "done" means for the slop pilot |
|---|---|---|---|
| Membership (invite, vouch, soft approval, 13+, phone verification, home city) | Partial | Text join with age then name (`packages/network/service/service.ts` `join()`). Web join and OTP: `packages/platform/src/api.ts`, `otp.ts`. Age floor: migrations `0006`, `0007`. slop is `joinMode: "open"` (`packages/platform/src/apps.ts`). Invites are not built: `ctx.invite` is unset (service README, Limits). | A slop join (by text keyword, the web or an agent through MCP) creates the person, the membership and the member; age is stated and fails closed. Vouch and invites are not needed for slop (open join) but are needed for ntwrk. |
| Channels (iMessage via Blooio, SMS via Twilio, voice, web chat, STOP/HELP) | Partial | Blooio in and out: `service.ts` `webhook()` and `packages/network/service/channel.ts`. Twilio is used only for Verify OTP. There is no SMS fallback, no voice and no web chat. The outbound queue is persisted (`platform.outbound`, migration 0015): written in the unit's transaction, delivered after the commit with leases, retries and crash recovery; the line counters (unanswered streak, daily caps, safety state) are in Postgres; inbound messages go through a deduplicated inbox handled in order per sender (`packages/network/service/inbox.ts`). STOP/HELP has one owner (`STOP_HELP_OWNER`). `bun run sim --only pipeline` drives it end to end with a fake provider. | One Blooio line, live, with a persisted queue, measured deliverability (prototype P3), and STOP/HELP owned by one system. SMS fallback and voice are deferred. |
| Agent (Eliza shared agent, persona per app, profiling, concierge) | Partial | Persona copy per app: `apps.ts` `brand()` and `packages/engine/src/packs/slop/copy.ts`. The slop hard-field asks are deterministic (`packages/network/service/packs.ts` `askText`, `learn`). The LLM reader exists in `packages/network/src/extract.ts` but is not wired. `packages/plugin-network` is the Cloud side, has no README, and is not connected to the line. | Free text on the line is understood well enough to fill slop's hard fields and answer questions, measured by prototype P4. Either `llmUnderstand` is wired with `gpt-6-luna` or the Eliza agent owns the conversation, but not both (PRD 32.3 boundary). |
| Profile model | Done | `packages/observatory/db/schema.sql`, `packages/network/db/network-state.sql`, migration `0004` (`app_id`), the slop profile in `packages/engine/src/packs/slop/profile.ts` | (met) |
| Enrichment (vouch notes, calendar, LinkedIn/X paste, AI memory paste) | Partial | The agent-first sites send a profile through the MCP tool `submit_profile` (`packages/mcp/src/tools.ts`; `sites/skills/slop-date/SKILL.md`). There is no calendar and no LinkedIn or X parser on the live path. | For slop: the profile from the person's own AI through MCP, plus the text conversation. The other sources are deferred. |
| World knowledge (event ingestion, concierge) | Partial | A hand-coded list of NYC venues (`packages/network/src/geo.ts` `VENUES`, `packs.ts` `EVENING_VENUES`). Event ingestion existed only in a prototype that the cleanup deleted (history at 16cde70). | For slop: a curated list of public date venues, about 50-100 and checked by hand (prototype P6). Event ingestion is deferred. |
| Matching engine | Sim-only on slop, Partial live | `slopPack` is wired in `packs.ts` (`makeSlopPack({ verification: { required: false } })`). Matching is off until `POST /matching` (`service.ts`). The judge LLM is not wired, and there is no dating judge rubric (slop-pack I3.8). | slop gates pass over held-out seeds (Section 4), then shadow mode on real members with every intro reviewed. |
| Human review | Done (backend and UI), Partial (operations) | `GET /review` and `POST /review/:oppId` (`service.ts`). The UI is `packages/observatory/web/review.tsx`. Reviewer of record: runbook-real 6.4 item 2 is still missing. | Reviewers trained on a slop rubric; the reviewer of record is the person; SLA alerts reach a human. |
| Outreach control (budget, quiet hours, two-unanswered, states) | Done | `packages/engine/src/attention.ts` (`attention-v1.2.0`), the person cap in migration `0012`, quiet hours and the unanswered cap in the queue | (met; the persisted queue is tracked under Channels) |
| Consent workflow | Done | `packages/network/src/network.ts`: `startProbes`, `onProbeAnswer`, `maybeReveal` and `reveal`, `expireReveals` | (met) |
| Relay and contact swap | **Missing** | No relay in `packages/network/src`. `copy.noContactDetails` refuses contact sharing. `share_grants` (`/api/me/share`) is cross-app profile sharing, not exchange between matched members. | After a mutual yes: "tell Sam I'm running late", "send them my number" and "send this photo" each go through the agent with a consent check per item, the leak guard and `appearanceLeak`, and a scam classifier on relayed text. There is a relay log for ban notices. |
| Scheduling | Partial | slop's booked first date: `packages/engine/src/packs/slop/plan.ts` (2-3 slots, a public venue type) plus `slopVenue` (`packs.ts`). There is no reschedule chain specific to slop and no booking. | 2-3 options, the confirmation, cancellation, and one reschedule. The venue is a public place from the curated list (no reservation; PRD 32.12). |
| Feedback | Done | `feedbackDue` and `onFeedback` (`network.ts`); the slop check-in after a date files reports (`packages/network/src/reports.ts`) | (met) |
| Safety and privacy | Partial | Leak guard on send (`packages/core/src/guard.ts`, the queue). Holds and bans by phone or person (`service.ts`, `platform.bans` in migration `0011`). There is no scam classifier on relay because there is no relay, and no same-face ban-evasion check anywhere. | Report, hold, ban and suppression work on the live line. A scam check runs on any relayed text. Same-face ban evasion is decided (build it or drop the gate). |
| Events (monthly gathering) | Deferred for slop | Not in slop's scope (PRD 40.5) | n/a for the slop pilot |
| Member web | Partial | `sites/slop.date/public/settings.html` and `sites/shared/settings.ts`: login, stop, leave, export, delete. `sites/slop.date/public/join.html`. There is no photo upload UI, and no "what the Network knows" editor. | A slop settings page with photo upload (`/api/photos`) and photo consent. The facet editor is deferred. |
| Admin and analytics | Partial | `packages/observatory` has a real mode (`src/sources/real.ts`), the app switcher (`web/apps.tsx`), Member 360 per app (`src/appProfile.ts`), the review and safety screens, and the audit log (`src/staff.ts`). Stale: `src/apps.ts` `PACK_READY` leaves out slop. Shadow runs use networkPack (`src/engineCapture.ts`). There is no bias-monitor panel and no cost panel. | The console deployed behind Cloudflare Access, with a slop shadow run, a bias-monitor panel and a cost panel. |
| Testing | Partial | Simulations only (founder decision): `bun run sim` runs 152 blocking gates in CI (`scripts/sim/`), and the unit, golden and e2e tests were deleted in the cleanup (docs/CLEANUP-REPORT.md). The slop world is `packages/sim/src/apps/slop/`. The network harness is `packages/network/harness/experiment.ts`. The security suite (`bun run security`) is pending a founder decision. | Section 4: the end-to-end message-pipeline world and the adversarial scenarios are still missing. |
| Network capital (internal) | Partial (not needed for slop) | `packages/capital`. Events are recorded into `network.capital_events`, but the levers are not read (service README). | Deferred for slop; levers stay off. |
| App memberships and keyword routing | Done | `service.ts` `route()`, `apps.ts` `keywordApp`, `consent.ts` `leaveTarget`, migration `0003` | (met; deliverability is checked in prototype P3) |
| App packs | Done | `packages/engine/src/pack.ts` and the conformance rules in `scripts/sim/conformance.ts` (the goldens were replaced by run fingerprints in the cleanup) | (met) |
| slop.date pack and sim | Sim-only, Partial | `packages/engine/src/packs/slop/*`, `packages/sim/src/apps/slop/*`, `scripts/sim/slop.ts`. Gates: Section 4. | Section 4 gates pass; photo-in-probe and rater in the same state in the sim and live. |
| Admin app switcher | Done | `packages/observatory/web/apps.tsx`, `src/people.ts`, tokens per app role (service README, Staff API) | (met) |
| Home page and app sites | Done (code), deploy pending | `sites/*/wrangler.toml`, `deploy/router.ts`, `.github/workflows/deploy-sites.yml`, `sites/skills/*/SKILL.md` | Pages projects live, with `/api/*` reaching `api.ntwrk.love` through the signed router (runbook-real 7.1 #13). |

### 1.2 Flows F1-F29 (PRD 29), read for slop

| Flow | Status | Evidence | "Done" for the slop pilot |
|---|---|---|---|
| F1 Member invites and vouches | Missing (deferred for slop) | `ctx.invite` is unset | slop is open join; for growth, "invite a friend" can be a link only |
| F2 Founding team seeds invites | Partial | Staff `POST /invite` (`service.ts`) | Bulk seed list for 40-75 NYC adults |
| F3 Invite acceptance and identity | Done | Text join, OTP (`otp.ts`), consent ledger (`platform.consent_events`) | (met) |
| F4 Onboarding conversation | Partial | Deterministic asks (`packs.ts` `askText`, `learn`); the MCP `submit_profile` path | Hard fields filled for more than 80% of joiners within 24 h (prototype P4); photo ask for adults |
| F5 Review and edit what it knows | Missing | No facet editor on the sites | Deferred: "what do you know about me" by text is enough |
| F6 Progressive profiling | Partial | The pack asks each hard field at most twice (`packs.ts`) | (met for hard fields) |
| F7 Connect a source | Partial | MCP `submit_profile` from the person's own AI | (met for slop) |
| F8 Ask the Network | Partial | `classify.ts`; the concierge for minors (`network.ts`) | Off-topic questions get a short, honest reply |
| F9 Standing intent | Done (generic) | Intents in `network.ts` | n/a for slop |
| F10 Concierge | Partial | Venue suggestions (`network.ts`) | Deferred for slop |
| F11 Proactive one-to-one intro | Done in code, never live | Probe, review, reveal (`network.ts`); `slopProbeText` | Reviewed probe, then mutual yes, then a booked date, live on test phones and then real members |
| F12 Small group | n/a for slop | friends only | Deferred |
| F13 Event co-attendance | n/a for slop | | Deferred |
| F14 Help request | n/a for slop | | Deferred |
| F15 Member-initiated intro | Partial | Requests in `network.ts` | Deferred for slop |
| F16 Relay and contact swap | **Missing** | Section 1.1 | Critical path item 7 |
| F17 Scheduling | Partial | `plan.ts`, `slopVenue` | Confirm, cancel and one reschedule |
| F18 Reminders, check-ins, flakes | Partial | Reminders and check-ins in `network.ts` (`weeklyCheckins`); the slop check-in after a date (`packs.ts`) | Day-of reminder, a "running late" relay (needs F16), a no-show record |
| F19 Feedback and second encounter | Done | `onFeedback`, reports | (met) |
| F20 States, preferences, STOP | Done | `consent.ts detectKeyword`, `parseOptOut`, leave per app | (met; the STOP owner is decided) |
| F21 Nothing fits yet | Partial | Empty-state copy in the engine (33.10) | 8.5-10% of sim members get no proposal (slop-pack I3.8); an honest message after 10 days |
| F22 Monthly gathering | Deferred for slop | | |
| F23 Block, report, safety hold | Done | `handleBlock` (`network.ts`), `reports.ts`, `/safety/*` | (met; safety on-call staffed) |
| F24 Export or delete | Done | `/api/me/export`, `/api/me/delete` (scope `app` or `all`) | (met) |
| F25 Phone change or new channel | Missing | Only the staff `clearHold` `same_owner` and `new_owner` (`packages/platform/src/accounts.ts`) | Deferred: handled by support by hand |
| F26 Travel and multi-city | Partial (sim) | slop travel windows in the world; the service is NYC only | Deferred: NYC only |
| F27 Review queue decision | Done | `POST /review/:oppId`, `review.tsx` | Reviewer of record is the person |
| F28 Unresponsive auto-pause | Done | Attention and outreach | (met) |
| F29 Expiry and quorum failure | Done | `expireReveals`, review SLA expiry | (met) |

### 1.3 PRD Section 40 (slop.date first)

| Item | Status | Evidence | "Done" |
|---|---|---|---|
| 40.3 Identity by phone, person-level lowest age | Done | `people.lowest_age`, `onAgeStated` (service README, Ages) | (met) |
| 40.3 Memberships per app, nothing crosses apps | Done | `app_id` plus RLS (`0004`, `NetworkRuntime.scoped`), `share_grants` | `cross_app_leak = 0` in a live two-app test |
| 40.3 One line, keyword routing, no-keyword joins The Network | Done | `service.ts` `route()`, `lookingFor`, `enroll` | (met) |
| 40.3 STOP stops every app; "leave slop.date" stops one | Done | `consent.ts`, `PLATFORM_STOP_SCOPE` | (met) |
| 40.3 Person cap of 3 a day | Done | migration `0012`, `person_cap_take` | (met) |
| 40.3 Admin app switcher, audited cross-app view | Done | `web/apps.tsx`, `staff_audit.app_id` | (met) |
| 40.4 Core invariants and conformance | Done | `scripts/sim/conformance.ts`; slop adds its stated filters and the never-shared rating checks | (met) |
| 40.5 Preferences as hard filters, gender and seeking, no race filters | Done | `packages/engine/src/packs/slop/rules.ts`, `geo.ts` | (met) |
| 40.5 Photos uploaded | Partial | `/api/photos` (`packages/platform/src/photos.ts`) has no UI and no MMS intake | Upload from the site and by text, R2 private bucket |
| 40.5 Clef rating, scores never shared | Partial | `clef.ts` `WorkersAIClefRater` was tested only with a fake fetch. `DEFAULT_CLEF_WEIGHTS` is `placeholder: true`. Not wired in `server.ts`. | `makeClefRaterFromEnv()` passed as `photoRater`; weights fitted (prototype P2); `appearanceLeak` on relay |
| 40.5 Bias monitor weekly | Sim-only | `packages/engine/src/packs/slop/biasMonitor.ts`, used only in the slop sim | Weekly job plus console panel, alert under 0.85x |
| 40.5 Reciprocal scoring, congestion, exposure | Done | `score.ts`, `assign.ts`, `options.ts` | (met) |
| 40.5 Probe can include a photo | **Missing** | `copy.ts` ("no photo") | A probe with one photo from adults only; the copy and the leak guard are updated |
| 40.5 Mutual yes, then a booked first date at a public venue | Done (no real booking) | `plan.ts`, `slopVenue` | A curated venue list (prototype P6) |
| 40.5 Exchange through the agent only, consent per item | **Missing** | Section 1.1 Relay | Critical path item 7 |
| 40.5 Geo by zip and radius, distance bands | Done (51 zips) | `packages/engine/src/packs/slop/zips.ts` | Every NYC zip (about 180) |
| 40.5 Safety: feedback, report, ban by phone and person, share-my-date, check-in | Done (no relay log) | `reports.ts`, `/safety/ban`, the share-my-date tip in `packs.ts` | Relay log for ban notices (needs F16) |
| 40.5 Scam classifier on relay | **Missing** | Only assumed in the world (`packages/sim/src/apps/slop/world.ts`); the engine reads the `safety:scam_pattern` tag | A classifier on relayed text, with recall measured on a corpus |
| 40.5 No ID check | Done | `packs.ts` (`required: false`) | (met) |
| 40.6 peon and friends: sites on Pages, matching and sends local | Partial | All four sites are on Pages (`docs/deploy.md`; PRD 40.1, 40.6 updated 2026-10-08); `apps.ts` has `joinMode: "open"` for both | The founder decides the join mode for peon and friends on production (Section 5) |
| 40.7 Compliance deferred | Deferred | | |
| 40.8 slop sim gates | Partial | `bun run sim --only slop`: blocking gates pass; five tracked gates fail (Section 4) | Section 4 |

## 2. Critical path to a slop.date pilot in NYC

The order is by dependency. Owner **P** is the platform session (`packages/network/service`, `packages/platform`, `deploy`, `sites`, `packages/observatory`). Owner **E** is the engine and packs session (`packages/engine`, `packages/worlds`, `packages/sim`, `packages/judge`). The estimates are in engineer-days for one agent-assisted engineer.

| # | Piece | Owner | Est. | Depends on | What is missing |
|---|---|---|---|---|---|
| 0 | **Founder decisions** | Founder | 1 | none | (a) Who owns STOP/HELP if Eliza Cloud also receives the line's webhook (runbook-real 7.1 #10). (b) Whether the conversation is the service's own LLM reader or the Eliza agent. (c) Join mode for peon and friends on production. (d) Whether to build same-face ban evasion or drop that gate. (e) Whether to keep the security suite. (f) How to fit the Clef weights (the fitter was deleted in the cleanup). Photos in the probe are decided (yes, adults only); the code still says "no photo" (item 7). |
| 1 | **Backend deploy (staging, then production)** | P | 2 | 0a | Railway project, Postgres, and the `network_backend` login (`docs/deploy.md` 2.1). Secrets. `api.ntwrk.love` DNS. Staff port private. Observatory behind Access. Logins per app role (runbook-real 7.1 #14). |
| 2 | **DB migrations against Railway** | P | 1 | 1 | `migrate.ts` refuses non-local hosts (runbook-real 1.2): needs a reviewed path (`MIGRATE_ON_BOOT` in `server.ts` with `MIGRATION_DATABASE_URL`). `PLATFORM_DB_ENVIRONMENT_INIT=1` once. pgvector. Backups on, and one restore tested. |
| 3 | **Blooio inbound and outbound with keyword routing** | P | 3 | 1, 2, 0a | Point the line's webhook at `/webhooks/blooio`. The queue and its counters are persisted (done, migration 0015; `bun run sim --only pipeline`). Fence the saves (audit network-service-8). Test phones with `BLOOIO_ALLOW_SEND=1`, `NTWRK_LIVE_APPROVED=1` and `SLOP_LIVE_APPROVED=1` **[FOUNDER]**. The routing code is done. |
| 4 | **The slop onboarding conversation** | P (wiring), E (copy and rubric) | 4 | 3, 0b | Wire `understand` (`llmUnderstand`, gpt-6-luna via Surplus) and `onAgeStated` into the runtime. Handle free text that is not a hard field. Read back the profile. Ask for photos for adults only. The MCP `submit_profile` path writes the same fields. A dating persona style guide (PRD 36.6). |
| 5 | **Photo upload and Clef rating** | P (upload, MMS, wiring), E (weights) | 4 | 2, 4 | Upload UI on `slop.date/settings` calling `/api/photos`. Store MMS and iMessage attachments (`mediaUrls`) to R2 after the adult and consent checks. Pass `makeClefRaterFromEnv()` as `photoRater` in `server.ts`. Workers AI token. Retry on `ClefError`. Fitted weights (prototype P2; until then `DEFAULT_CLEF_WEIGHTS` is a placeholder). Weekly `biasMonitor` job. |
| 6 | **Review queue UI for slop** | P | 2 | 1 | Observatory `PACK_READY` includes slop (`packages/observatory/src/apps.ts`). The reviewer of record is the person, not the token (runbook-real 6.4 item 2). A slop reviewer rubric. Scores never shown. SLA alert to a human. Shadow runs use `slopPack`, not networkPack (`engineCapture.ts`). |
| 7 | **Probe, booked-plan reveal, relay** | E (photo probe), P (relay) | 6 | 3, 5, 6 | Photo in the probe (`slopProbeText`, the leak guard, the adults-only check). A relay thread after a mutual yes: forward text with a prefix, "send them my number" and photos with consent per item, `appearanceLeak` plus the leak guard on agent text, a scam check on relayed text, a relay log. Running-late relay. Probe and reveal code is already done. |
| 8 | **Post-date feedback, report, ban** | P | 1 | 7 | Mostly done (`reports.ts`, `/safety/ban`). Add: the relay log to tell past contacts about a ban (40.5), and a ban check on MMS and photo intake. |
| 9 | **STOP/HELP on the live line** | P | 1 | 3, 0a | The code is done: one owner (`STOP_HELP_OWNER`, default `service`; the gateway reports to `POST /consent/gateway`), and the queue checks the consent ledger, bans and suppression at send time. Remaining work: live checks on iMessage (STOP, STOP ALL, START, HELP, "leave slop.date"). |
| 10 | **Admin console deploy** | P | 2 | 1, 6 | Railway `observatory` service behind Cloudflare Access (`deploy/backend/observatory.railway.toml`), `OBSERVATORY_REAL_ONLY=1`, a fresh sign-in before a PII reveal (runbook-real 6.4 item 3), a bias-monitor panel, a cost panel. |
| 11 | **Monitoring** | P | 2 | 1 | Nothing in code sends alerts. Needed: an uptime check on `/healthz`, a heartbeat on the staff `/health` (last tick, backlog, refusals), alerts on send failures, review SLA misses, invariant violations and urgent safety reports. Use Railway alerts or a small cron that posts to Slack or email. |
| 12 | **Cost alerts** | P | 1.5 | 4, 5, 11 | No cost tracking anywhere. Needed: LLM tokens and dollars per call (Surplus), Workers AI calls, Blooio messages per day, a daily and monthly budget, and an alert at 80%. PRD 36.4 asks for a numeric target per active member. |
| 12b | **Close the network and platform audit findings** | P | 4 | none (can start now) | `docs/audit/2026-10-08-weaknesses.md` lists 321 findings (6 P0, 55 P1). `fixes-core.md` covers only core, engine, judge, sim and capital. The network, platform, observatory and sites findings have no fix report. Check each P0 and slop-relevant P1 against the code and record the result. The P0s: consent-1 (a refusal that names a day read as yes), consent-3, consent-4 (a reporter held as the abuser), matching-e2e-1 (template-only parsing; an unknown area becomes Midtown), and matching-e2e-2 (romance want gate; appears fixed at `network.ts`). The P1s: platform-1 (retry with age 25 after an under-age refusal), platform-2 (delete resets the lowest age and blocks), platform-3 (a recycled number), platform-5 (Turnstile), observatory-1 (XSS), and the 37 hand-offs at `fixes-core.md` 267-316. |
| 13 | **Shadow mode, then live** | Founder, reviewers | 14 (calendar) | 1-12 | At least 2 weeks of shadow with every proposal reviewed (PRD 34.6). At least 40 committed NYC adults before `POST /matching {"on":true}` **[FOUNDER]**. |

**Join entry points also need a check.** No site page has an `sms:` link or a keyword call to action; joins are by web OTP or by the person's own AI through MCP. A slop flier must say "text slop", not "text HI": `docs/design/2026-10-07-nyc-college-gtm.md` uses "HI", which routes to ntwrk. The landing pages use `chatgpt.com/?q=`, which `docs/runbook-deeplink-test.md` row A2 marks "Do not use" (it auto-sends) in favour of `?prompt=`.

**Total:** about 35 engineer-days of build, plus the shadow period. Items 1-3 and 6 can run in parallel with items 4-5 (after 0) and with the engine work in item 7.

## 3. Prototypes still needed

Build each small, learn from it, then commit.

| # | Prototype | Question | Method | Pass to commit | Owner, time |
|---|---|---|---|---|---|
| P1 | **Real-human concierge pilot** | Do real NYC adults answer probes, say yes, show up, and want a second date? | 20-30 founder-network adults. A human matchmaker composes probes and plans in the console (human-composed proposals, PRD 35.2) on the real line. The engine runs in shadow alongside. | Mutual yes at least 25% of probes. At least 60% of booked dates happen. At least 20% want a second date. The engine's shadow picks overlap the human picks. | Founder plus 1 reviewer, 2-3 weeks |
| P2 | **Clef weight fitting from labelled pairs** | Does Clef plus the decision model predict real mutual interest better than nothing, and without group bias? | Consented photos of adults (lowest stated age 18+). Several raters per pair. A rebuilt fitter (`fitClef.ts` and the experiments CLI were deleted in the cleanup; `clefWeights.ts` documents the format). Audit outcomes by group. | Held-out AUC above the placeholder. `biasMonitor` at least 0.85x by quintile and group. The weights fitted only on synthetic labels are replaced. | E, 1 week plus labelling |
| P3 | **Real Blooio deliverability and rate behaviour** | Per-line throughput, new-conversation limits, delivery and read receipts, attachments in and out, ban risk on a shared line (40.7) | 10-20 test phones, 3 days, run with `packages/blooio` against the live adapter. Includes MMS and group, and STOP. | A measured daily cap with a safety margin. Attachments arrive. No account flag. | P, 3 days |
| P4 | **Onboarding conversation quality** | Can the line fill the slop hard fields from natural text, without confusion? | 30 scripted plus 20 real adults. Measure fields filled, turns, drop-off, misparses. Compare rules only with rules plus `llmUnderstand`. | At least 80% complete in 24 h, at most 12 turns, 0 wrong gender or seeking parses | P plus E, 1 week |
| P5 | **Photo-in-probe acceptance rate** | Does a photo raise mutual yes and second dates (as the sim assumes), or cut dates per member (as the sim also shows, 0.79-0.90x random)? | A/B within P1: half the probes with a photo, half without. | Choose the arm. Update `copy.ts` and the sim default so they agree. | E, inside P1 |
| P6 | **Venue and booking for date plans** | Are the suggested places good for a first date (open, lit, not loud)? Do people want a reservation? | Curate 50-100 NYC venues by neighbourhood and time of day. Ask P1 couples to rate the place. Try booking links by hand. | At least 80% "good place". Decide whether to use booking links only (PRD 32.12) or partner reservations. | Founder or ops, 1 week |
| P7 | **Relay UX** | Is relaying through the agent acceptable, or do people leave the line for direct texting at once? | Concierge relay by hand during P1, before item 7 is built | Choose the relay scope: one-shot number swap or a persistent thread | P, inside P1 |
| P8 | **Age-liar and catfish detection without ID** | The sim fails the age-liar gate (81-88% cut against 90%). What cheap signals help? | Language signals, photo age estimate (adults only, never stored as a score), reports | Decide whether the gate is accepted as a known risk | E, 3 days |

## 4. Simulation coverage still needed

All validation is `bun run sim` (simulations only). This is what the simulations must still cover.

### 4.1 What each app's simulation must cover before launch

**slop.date** (blocking for the pilot):

| Must cover | Today | Missing |
|---|---|---|
| Engine gates over held-out seeds | `bun run sim --only slop` (pinned seeds 13-16, 4 weeks) | Tracked, failing on the pinned seeds: dates per member-month at least 0.9x random (0.823); age-liar contacts cut at least 90% (82.4%); adversary contacts cut at least 90% (47.4%); harm cut at least 90% (86.9%); smallest gender or orientation group at least 0.7x (0.329; the oracle also fails it). Fix, waive in writing, or carry as a known risk. |
| One gate list | Resolved 2026-10-08: PRD 40.8 and `docs/mvp-plan.md` now quote the `scripts/sim/slop.ts` list | Mutual yes per probe and the probes-received Gini become live pilot gates (PRD 37.3). Same-face ban evasion is a founder decision (build it or drop it). |
| **The real message pipeline end to end in sim** | Partly done: `bun run sim --only pipeline` (`scripts/sim/pipeline.ts`) goes in through a signed `/webhooks/blooio` and out through the Blooio adapter and the persisted queue to a fake provider, on Postgres and a simulated clock, over about five simulated days: joins by keyword, review, probe and booking, duplicates, outage, crash and restart, STOP, leave, the person's streak and line safety. | A slop world run that goes in through a signed `/webhooks/blooio` and out through `BlooioAdapter` with a fake Blooio provider and the persisted queue, on Postgres, with `RealClock` swapped for `SimClock`, for 30 simulated days. It checks the person cap, quiet hours, STOP during a probe, leave mid-match, ban mid-relay, and restart recovery. |
| **LLM persona agents sending real texts through the platform** | `packages/sim/src/agent/llmAgent.ts` writes words only for the sim CLI | slop personas (a different model family from the agent) send free text into the webhook: onboarding, probe replies ("maybe, who is it?"), relay messages, feedback. Measure parse accuracy, consent errors (a "no" read as a yes must be 0) and style violations. |
| **Adversarial scenarios against the live agent** | `packages/network/harness/scenarios.ts` (prompt injection), the regex classifier, the abuse fixture | In the end-to-end world: a romance scammer moving off-platform in relay, a harasser after the reveal, an age liar who later says "I'm 16", a catfish with someone else's photos, prompt injection to extract the other person's number or rating, a ban evader on a new number, a bot farm joining by keyword, a member asking "how hot did you rate me?". Gates: 0 rating or score leaks, 0 contact leaks without consent, scammer reach at most 1. |
| Photos and rating | Simulated rater; conformance "scores never shared" | The real `photoRater` interface with a fake Workers AI in the e2e world. A minor never rated. Deletion drops the ratings. |
| Cross-app | The `cross_app_leak` invariant | A two-app persona (ntwrk and slop) through the real routing: canaries never cross |

**friends.help and peon.biz** (local only; not blocking slop): their official gate sets pass in `bun run sim` (friends seeds 5-8; peon seeds 13-16). Before any production join is open: the same end-to-end message-pipeline world, and for peon, the protected-attribute invariance through the real path.

**ntwrk** (home page joins with no keyword): an e2e world where a stranger texts with no keyword, is enrolled in slop by "dating", and gets nothing proactive from ntwrk while it stays invite-only.

The live pilot go/no-go list and the weekly gates with rollback triggers are in [mvp-plan.md](mvp-plan.md) and PRD 37.3.

## 5. Open platform questions

The six founder decisions on the critical path are in [mvp-plan.md](mvp-plan.md). These platform questions came from the platform PRD edits of 2026-10-08 (now folded into the PRD) and are still open. The state or default is what the code does today.

| # | Question | State or default in the code |
|---|---|---|
| 1 | A separate legal entity per app (10DLC brand, FCC sender, liability)? | Open. PRD 40.7 records the 10DLC risk for slop. |
| 2 | A second Blooio line as a fallback? | One line for every app (40.3), so a ban affects every app. |
| 3 | How does Twilio classify a non-adult dating service (SHAFT, error 30953)? | Open, in the 40.7 backlog. |
| 4 | Should a safety removal on one app apply to hiring? | 40.3 says a removal holds the person everywhere. Confirm for peon. |
| 5 | Is peon an employment agency for record keeping? | Open, in the 40.7 backlog. |
| 6 | Store the lowest stated age when a join is refused for age? | Nothing is stored, so a retry with an older age can pass (audit platform-1). |
| 7 | After "delete everything", keep a hash of a person whom others blocked? | Blocks stay on the tombstone; a new join with the same phone is a new person. |
| 8 | How long must the opt-in record be kept after deletion (10DLC)? | Consent events are deleted; only the suppression hash stays. Counsel. |
| 9 | The base-profile fields that can be shared, and the share copy | First name, city, age band, interests. The share choice is hidden on the sites. No engine reads grants yet. |
| 10 | The link notice to a known number ("You've used this number with us before...") | Sent after a join by a known person; on a recycled number it reveals something about the old owner. |
| 11 | The per-app brand texts (agent names, STOP/HELP, invite-only and under-age replies) | Drafts in `packages/platform/src/apps.ts`; counsel should check the STOP wording. |
| 12 | The invite-only reply on The Network | At most one a day per number; nothing stored. |
| 13 | Review reasons and deadlines per app | slop 6 h, peon 24 h, the others 12 h. |
| 14 | Does a hold from one app show to each app's own staff? | Only the cross-app view shows it. |
| 15 | Does the person cap count a message that waits for quiet hours? | Yes, when it is handed to the sender. |
| 16 | Turnstile on the sites (a script from challenges.cloudflare.com) | Needs a content-security and privacy wording decision; the build takes a site key. |
| 17 | The landing-page demo replay | Shown only if the API serves one; it serves none. |
| 18 | Rotation of the hash key (`PLATFORM_HASH_KEY`) | No plan; a new key orphans old suppression entries. |
| 19 | Cloudflare zones and support mailboxes (help@<domain>) | slop.date and friends.help zones stay in the Eliza Labs account for 10 days; mailboxes not checked. |
| 20 | The weekly check-in: offer it at onboarding too? | First booked plan only. |
| 21 | Network capital per app or shared | Open (PRD 37, Phase 5). |
| 22 | When The Network's own NYC matching opens | After slop.date; San Francisco only after the expansion gates (PRD 25.6). |

## 6. Doc inconsistencies and how they were resolved

The gap analysis found 28 places where the PRD, the docs and the code disagreed. Resolved on 2026-10-08 in branch `docs/mvp-update` unless marked otherwise.

| # | Where | Resolution |
|---|---|---|
| 1 | mvp-plan: "the PRD text still needs the edit" for photos in the probe | Rewritten. The code gap (`copy.ts` says "no photo") is critical path item 7. |
| 2 | mvp-plan: "changes PRD 40.5 'never used: photo attractiveness scores'" | Rewritten; PRD 40.5 is the reference. |
| 3 | mvp-plan and PRD 40.8: a gate list the sim does not measure | PRD 40.8 and mvp-plan now quote `scripts/sim/slop.ts`. Mutual yes and the probes-received Gini are live pilot gates (PRD 37.3). Same-face ban evasion is a founder decision. |
| 4 | PRD 40.1, 40.2, 40.6, 28.4, 37, 38; mvp-plan: peon and friends "no deploys" | All four sites are on Pages; peon and friends matching and sends stay local; join mode is a founder decision. AGENTS.md decision 4 updated to match. |
| 5 | PRD 28.4: connectors are post-MVP | Agent-first onboarding through MCP and the skills moved into 28.3; 28.4 keeps only the hosted-assistant connectors beyond onboarding. |
| 6 | PRD 1.3, 28.1, 25, 36.5, 37 M6: an SF and NYC pilot on Eliza Cloud with Twilio | 1.3 and 28.1 rewritten for slop.date first in NYC on the shared platform; 25.1, 27, 36.5 and 37 point to NYC first. |
| 7 | PRD 22, 31: built inside Eliza Cloud | Status notes in 22 and 31: Railway backend plus Pages sites. runbook-real section 7 still asks the question until the deploy. |
| 8 | PRD 28.5: 30 simulated days of all flows, unit and load tests, terms, 10DLC | Rewritten for the slop pilot and simulations only; compliance items point to 40.7. |
| 9 | PRD 34.1-34.2; `docs/audit/2026-10-08-test-plan.md`; AGENTS.md | PRD 34 rewritten ("simulations only"). The audit test plan carries a superseded note. |
| 10 | Service README: slop runs `required: true`; photos need `verify:age:pass` | Fixed: `required: false`, a stated adult age is enough. |
| 11 | Service README: "slop and peon need their engine packs" | Fixed: the packs are wired; matching is off only by the stored switch. |
| 12 | Code: `packages/observatory/src/apps.ts` `PACK_READY` leaves out slop and peon | Open (code): critical path item 6. |
| 13 | `docs/prd-edits-2026-10-08-platform.md` | Folded into `prd-pending-edits.md` by the cleanup, then applied to the PRD; the pending file is now empty. |
| 14 | experience-design D5 and F2: "never a photo until both say yes" | A note at the top gives the slop.date exception. |
| 15 | The friends-first college GTM docs | Deleted in the cleanup. A slop NYC go-to-market (who the first 40-75 adults are) is still to write (prototype P1). |
| 16 | PRD 36.1, 32.2, 37 M0: per-city numbers, 10DLC filed, vCard | 32.2 and the M0 row updated; 36.1 already points to 40.3 and 40.7. |
| 17 | PRD 32.3, 36.10: the Eliza plugin speaks on the line | 32.3 says the service owns every member message today; where the conversation runs is a founder decision. |
| 18 | PRD 40.5 "share-my-date with a trusted contact" | Now "a share-my-date tip"; building it is not on the critical path. |
| 19 | runbook-real 6.5 and 7: "Nothing is deployed" | Kept until the deploy, then updated with the real hosts. |
| 20 | Code: `copy.ts` says "no photo" while the sim runs with a photo | Open (code): critical path item 7 and prototype P5. |
| 21 | mvp-plan, PRD 40.5 and 40.8, admin-console.md: "verified adults" | Now "adult by lowest stated age (18+), unknown fails closed". |
| 22 | deploy.md against admin-console, runbook-real and the service README: what is live | deploy.md is the one place; the sites are on Pages and the backend is pending. |
| 23 | `docs/compliance/a2p-10dlc.md`, the deleted prototypes and test-plan docs | a2p-10dlc carries a superseded note (PRD 40.7); the others were deleted in the cleanup. |
| 24 | GTM docs: ID verification before any date; minors revealed to each other | Deleted in the cleanup. |
| 25 | runbook-simulation: slop and peon lab runs use `--max-new 0` "because their matching is off" | Fixed: the packs are wired; switching the lab to `slopPack` is still code work (item 6). |
| 26 | Audit test plan SITE-10: only ntwrk and slop deploy | Superseded note: all four sites are on Pages. |
| 27 | observatory.md: `buddies` | Fixed: `friends`. |
| 28 | sites/PRODUCT.md: "and San Francisco for The Network" | Fixed: NYC only. |
