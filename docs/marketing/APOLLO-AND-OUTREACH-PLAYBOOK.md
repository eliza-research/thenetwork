# Apollo Enrichment, 28 VIP Archetypes, 10-Platform Playbooks, and Quality Intake Bridge

This document defines the Pass-4 outreach, enrichment, and intake architecture in `apps/marketing`.
Every rule below maps directly to generated Dafny-proved policy code in `packages/core/src/generated/marketingPolicy.ts` (from [spec/marketingPolicy.md](../../spec/marketingPolicy.md)) and persistent Postgres tables in `apps/marketing/db/schema.sql`.

---

## 1. Non-Negotiable Safety Boundaries

1. **18+ adult floor:** Marketing enrichment, platform outreach, and out-of-network intake never target or enroll minors. Any cue under age 18 writes a permanent `is_minor = true` row to `marketing.contact_suppression` and purges cached enrichment data.
2. **Global contact fence:** Every enrichment and outbound send checks `marketing.contact_suppression` and `NetworkCoreBridge.checkContactFence()` (including `platform.bans`, `platform.suppression`, `platform.consent_events`, `platform.age_floor`, and `platform.external_prospect_suppressions`).
3. **Cross-brand air-gap:** Dating external prospects (`tinder`, `bumble`, `hinge`) never enter `peon.biz`. `IntakeBridge.promoteCandidate()` enforces `isAppAllowedToReadExternalProspects(targetAppId)`.
4. **Landing-site portal boundary:** All invite handoffs use the four brand entry domains and their `SKILL.md` endpoints (`https://<brand>/SKILL.md`). Operator links stay under `MARKETING_OPS_BASE_URL` (`https://ops.ntwrk.party`).
5. **LeakGuard on every outbound draft:** Every VIP draft, platform reply, and intake invite passes `LeakGuard` before return or dispatch. Internal ranking terms, Clef scores, private phone numbers, and unsanctioned URLs fail closed.
6. **Zero-strings value rule:** Outbound agents never pitch, spam, or beg for signups. Every touch delivers concrete value first (an exact local answer, a bilateral peer introduction, or a verified event recommendation) and asks nothing in return.

---

## 2. Apollo.io Dual-Mode Enrichment Engine

Implementation: `apps/marketing/src/adapters/apollo.ts` and `ENRICHMENT_DEF` (`"enrichment"`) in `apps/marketing/src/adapters/paid.ts`.

### Two-Stage Search-to-Match Flow

1. **Stage 1 — Free Discovery (`POST /mixed_people/api_search`, 0 credits):**
   - Queries Apollo with city location labels (`CityPack.label`), archetype job titles, and keywords.
   - Filters out minor and high-school cues before scoring.
   - Classifies each candidate into one of the 28 VIP archetypes (`classifyVipArchetypeOrNull`) and scores prestige (`scoreVipProspect`).
   - Caches results for **24 hours** (`APOLLO_SEARCH_CACHE_TTL_MS`) in a bounded 512-entry in-memory LRU and `marketing.enrichment_cache`.
2. **Stage 2 — Gated Work-Email Match (`POST /people/match` & `GET /organizations/enrich`, 1 credit/match):**
   - Authenticates strictly with the `x-api-key` HTTP header (`APOLLO_API_KEY`).
   - Hard-codes `reveal_personal_emails: false` and `reveal_phone_number: false` on every live payload.
   - Accepts only verified business addresses (`email_status === "verified"`). Free consumer domains (`gmail.com`, `yahoo.com`, `icloud.com`, `outlook.com`, `proton.me`) and role addresses (`info@`, `sales@`, `support@`, `noreply@`) are rejected.
   - Caches match and organization payloads for **30 days** (`APOLLO_ENRICH_CACHE_TTL_MS`). Cache hits consume **0 credits**.

### Credit Governance, Caching, and Suppression Purge

- **Formal credit gate:** Every credit request calls `evaluateApolloCredits()` -> Dafny-proved `canAuthorizeApolloCredits()`. Default caps are `50` credits/day (`DEFAULT_APOLLO_DAILY_CREDIT_CAP`), `1,000` credits/month (`DEFAULT_APOLLO_MONTHLY_CREDIT_CAP`), and `100` searches/day (`DEFAULT_APOLLO_DAILY_SEARCH_CAP`).
- **Pre-credit and post-enrichment checks:** Minor cues, existing suppressions, and `contact_fence` blocks stop before any credit is spent. After Apollo returns an email, the adapter hashes it (`keyedContactHash("email", ...)`), re-checks `contact_suppression` and `contact_fence`, and immediately calls `purgeEnrichmentCacheByContactHash()` if blocked.
- **Automatic cache purge on STOP:** `store.recordContactSuppression()` deletes all matching rows in `marketing.enrichment_cache`.
- **Resilience and dry-run safety:** Live HTTP calls execute only when both `APOLLO_API_KEY` is set and `MARKETING_LIVE_BILLING === "1"`. Otherwise the adapter returns deterministic synthetic fixtures with `dryRun: true` and `0` credits spent. Live responses enforce a 2 MiB size limit (`APOLLO_MAX_RESPONSE_BYTES`) and bounded `429 Retry-After` retries. Every operation logs to `marketing.apollo_credit_ledger` and live costs write to the core cost ledger via `bridge.recordOperationalCost()`.

### Endpoints and CLI

- `POST /api/apollo/search` — Run 0-credit search and archetype pre-scoring.
- `POST /api/apollo/enrich` — Enrich one contact with verified work email and optional organization data.
- `GET /api/apollo/credits` — Return daily/monthly credit usage, search count, and cache hit rate.
- `POST /api/vips/pipeline/run` — Run `search -> pre-score (>= 65) -> enrich (capped) -> draft bilateral invite` without sending unsolicited email.
- CLI: `pnpm run marketing:cli -- apollo-search --city nyc --archetype startup_founder` and `apollo-enrich --name "..." --domain ...`.

---

## 3. 28 High-Status & High-Agency User Archetypes

Implementation: `apps/marketing/src/vip-engine.ts` (`VIP_ARCHETYPES`, single-source `VIP_ARCHETYPE_KEYWORDS` shared with `llm-cache.ts`).

| # | Slug | Cohort | Primary Desire Lane | Zero-Strings Value Offer |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `startup_founder` | Seed / Series A+ Founder | `money_work` | Intro to one peer founder solving the same technical or hiring bottleneck |
| 2 | `vc_lp` | General Partner / Angel / LP | `money_work` | Quiet intro to one pre-launch technical founder with public proof of work |
| 3 | `patent_inventor` | Patent Inventor / Hardware Builder | `elite_serendipity` | Intro to an industrial designer or manufacturing lead in the same city |
| 4 | `scientist_academic` | Professor / Principal Investigator | `elite_serendipity` | Intro to a founder translating adjacent research into practice |
| 5 | `ai_biotech_researcher` | AI / Biotech Research Scientist | `money_work` | Peer intro to a lab lead or systems builder working on the same problem |
| 6 | `quant_finance` | Quant / Portfolio Manager | `elite_serendipity` | Off-the-record peer dinner with non-sales technical builders |
| 7 | `author_journalist` | Author / Journalist / Essayist | `elite_serendipity` | Direct intro to a primary domain source in their beat |
| 8 | `filmmaker_artist` | Filmmaker / Visual Artist | `ideal_friends` | Intro to a local producer, curator, or composer for an active project |
| 9 | `elite_athlete` | Competitive Athlete | `ideal_friends` | Intro to a reliable local training partner at matching pace |
| 10 | `michelin_chef_hospitality` | Chef / Sommelier / Restaurateur | `elite_serendipity` | Curated small off-peak dinner table of respectful local regulars |
| 11 | `architect_designer` | Architect / Industrial Designer | `elite_serendipity` | Intro to a venue founder or hardware builder needing spatial craft |
| 12 | `oss_maintainer` | Open-Source Maintainer | `money_work` | Intro to one production team or peer maintainer in the same stack |
| 13 | `policymaker_diplomat` | Policy / Public Leader | `elite_serendipity` | Off-record conversation with one domain operator or researcher |
| 14 | `podcaster_curator` | Podcaster / Editor / Curator | `elite_serendipity` | High-signal guest intro backed by primary public work |
| 15 | `leading_physician` | Attending Physician / Specialist | `elite_serendipity` | Intro to a clinical researcher or non-medical local peer outside hospital circles |
| 16 | `philanthropist_foundation` | Foundation Director / Patron | `elite_serendipity` | Direct intro to a verified local civic or cultural builder |
| 17 | `legal_rainmaker` | Partner / General Counsel | `money_work` | Peer intro to a founder or policy lead facing an exact regulatory question |
| 18 | `defense_space_energy` | Aerospace / Energy / Deep-Tech Lead | `money_work` | Intro to a hardware specialist or systems engineer in the same corridor |
| 19 | `creative_director_tastemaker` | Creative / Editorial Director | `ideal_friends` | Intro to an independent filmmaker, photographer, or venue curator |
| 20 | `super_connector_host` | Salon Host / Community Organizer | `ideal_friends` | Two vetted high-reliability guests who elevate their next gathering |
| 21 | `senior_staff_engineer` | Staff / Principal Software Engineer | `money_work` | Intro to one peer staff engineer solving an exact scaling problem |
| 22 | `indie_maker_shipper` | Independent Maker / Shipper | `money_work` | Intro to a fellow solo builder or design partner in the same neighborhood |
| 23 | `executive_operator` | COO / VP Ops / Chief of Staff | `money_work` | Confidential peer intro to another operator at the same company stage |
| 24 | `music_producer_programmer` | Music Producer / Venue Programmer | `ideal_friends` | Intro to a local composer, sound designer, or independent show host |
| 25 | `gallery_collector` | Gallery Director / Art Advisor | `elite_serendipity` | Intro to a local artist, architect, or cultural patron |
| 26 | `civic_urbanist_leader` | Urbanist / Transit / Civic Leader | `elite_serendipity` | Intro to a local housing, mobility, or open-data researcher |
| 27 | `performance_coach_captain` | Run Club Captain / Head Coach | `ideal_friends` | Reliable local athletes and neighborhood hosts for group runs |
| 28 | `family_office_patron` | Family Office CIO / Cultural Patron | `elite_serendipity` | Quiet, zero-pitch intro to a verified scientist, artist, or founder |

### Bilateral Offer Rules & Sending Controls

- **Two valid offer modes:**
  - `bilateral_intro` (Mode A): Offers one concrete 1:1 peer introduction around a named shared problem.
  - `curated_table` (Mode B): Lists only `confirmedCoSeatedRoles` provided by the caller. Fabricated table-mates are never generated.
- **Draft constraints:** Maximum `75` words (`MAX_VIP_INVITE_WORDS`), zero raw URLs, specific public proof-of-work hook (`>= 14` chars, rejects raw DB slugs), and `evaluateReportRisk` score `<= 24`.
- **Single follow-up rule:** `buildVipFollowUp()` blocks any follow-up before `14` days (`MIN_VIP_FOLLOWUP_DAYS = 14`) and allows at most one closing note.
- **Gated send (`POST /api/vips/:id/send`):** Runs `gateVipOutreach()` (`contact_fence`, `contact_suppression`, `isLocalQuietHours`, `14d` cooldown), checks report risk (`<= 24`), dispatches email (dry-run unless `MARKETING_LIVE_SEND=1` and `MARKETING_LIVE_BILLING=1`), and records `surface = "vip"` in `marketing.contact_touchpoints`.

---

## 4. Ten-Platform Zero-Annoyance, Zero-Report Playbooks

Implementation: `apps/marketing/src/platform-playbooks.ts`.

| Platform | Category | Execution Mode | Daily Cap | Cold DM | Link-Free First Touch | Max Words | Special Hard Guard |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| `reddit` | Social | `agent_draft_human_approve` | 5 | No | Yes | 90 | Public value reply first; DM only if invited |
| `x` | Social | `agent_draft_human_approve` | 6 | No | Yes | 55 | Contextual reply only; zero quote-dunks |
| `linkedin` | Social | `agent_draft_human_approve` | 5 | No | Yes | 45 | Connection note `<= 280` chars; zero pitch-slap |
| `tinder` | Dating | `human_assisted` | 8 | No | Yes | 50 | Upfront matchmaker disclosure; reuse `buildDatingOpenerScript` |
| `bumble` | Dating | `human_assisted` | 8 | No | Yes | 50 | Upfront disclosure; strict platonic rule on BFF mode |
| `hinge` | Dating | `human_assisted` | 6 | No | Yes | 50 | Specific prompt reference required; upfront disclosure |
| `meetup` | Events | `official_api` | 6 | No | Yes | 80 | Official GraphQL API (`MEETUP_GRAPHQL_ENDPOINT`) only; zero scraping |
| `eventbrite` | Events | `agent_draft_human_approve` | 6 | No | Yes | 80 | Public organizer contact or attendee value note |
| `luma` | Events | `official_api` | 8 | No | Yes | 80 | Host collaboration note or curated RSVP table |
| `partiful` | Events | `agent_draft_human_approve` | 6 | No | Yes | 70 | Mandatory carrier copy scrub (`scrubPartifulTelecomCopy`) |

### Deterministic Report-Risk Gate (`evaluateReportRisk`)

Every draft receives a `0..100` risk score. Any score above `24` (`MAX_PLATFORM_REPORT_RISK`) is blocked by Dafny-proved `canDispatchPlatformTouch()`:

- Unsolicited URL or brand spam on a link-free first touch: `+40`
- Prompt injection detected (`detectExternalPromptInjection`): `+40`
- Minor or underage cue: `+35`
- Platonic BFF romance framing bleed: `+35`
- Internal ranking or Clef score leak: `+30`
- `LeakGuard` match: `+30`
- Pitch-slap or hype copy (`"book a demo"`, `"limited spots"`, `"check out our app"`): `+25`
- Missing upfront matchmaker disclosure on dating apps: `+20`
- Generic opener without recipient-specific reference: `+20`
- Word-limit breach, LinkedIn `> 280` chars, or self-centered pronoun ratio: `+15` each

### City-Local Quiet Hours & Rolling-20 Circuit Breaker

- **Local quiet hours:** `isLocalQuietHours(city, nowMs)` computes the recipient city's current hour using `CityPack.timezone` and `legal.quietHoursLocal` (default 21:00–09:00 local) and blocks cold sends overnight.
- **Rolling-20 circuit breaker (`evaluatePlatformHealth`):** Inspects the last 20 `marketing.platform_interactions` rows per platform/account.
  - `active`: Normal operation.
  - `degraded`: Halves daily cap when negative/decline rate reaches the platform degrade threshold.
  - `suspended`: Halts all sends immediately on `>= 2` reports or when negative rate hits the suspend threshold (`canDispatchPlatformTouch` returns `false`).

Endpoints: `POST /api/playbooks/:platform/draft`, `POST /api/playbooks/lint`, `GET /api/playbooks/health`.
CLI: `pnpm run marketing:cli -- playbook-lint --platform reddit --text "..."`.

---

## 5. Out-of-Network to In-Network Quality Intake Bridge

Implementation: `apps/marketing/src/intake-bridge.ts`.

### Deterministic 4x25 Anti-Slop Rubric (`scoreIntakeCandidate`)

Every candidate discovered outside the network is scored from `0` to `100` across four 25-point dimensions:

1. **Specificity and effort (`0..25`):** Concrete local details, `>= 40` characters, `>= 12` words, active questions.
2. **Proof of work and anchoring (`0..25`):** Verified work email, Tier-1 public proof, attended IRL event, or concrete shipped artifact.
3. **Reliability and follow-through (`0..25`):** Confirmed time within 24 hours, prior IRL attendance, minus heavy penalties for prior no-shows (`-20`) or drops.
4. **Bilateral value fit (`0..25`):** Member/anchor vouch, prior value delivered, explicit positive reply.

**Immediate zero-score disqualifiers:**
- `opt_out_signal` or `underage_or_minor_signal` -> status `"suppressed"` + persisted `marketing.contact_suppression` row.
- `prompt_injection`, `cold_seller_or_spam`, `low_effort_slop` (`<= 3` words or generic `"hey"` / `"interested"`), or `ai_slop_phrasing` -> status `"rejected_slop"`.

### Once-Only Warm Promotion Gate (`IntakeBridge.promoteCandidate`)

Promotion to a warm Network invite must pass Dafny-proved `canPromoteOutOfNetworkCandidate()` plus cross-brand and core checks:

1. **Cross-brand air-gap:** Dating sources (`tinder`, `bumble`, `hinge`) cannot promote to `peon.biz`.
2. **Verified adult floor:** `statedAge` must be `18..120` (`adultParticipantAge`).
3. **Quality floor:** `qualityScore >= 70` (`MIN_INTAKE_QUALITY_SCORE`).
4. **Value-first consent:** Both `valueDelivered === true` and `explicitPositiveSignal === true`.
5. **Clean safety & backpressure:** Not suppressed, not fenced by `contact_fence`, campaign not in lockdown, and `bridge.shouldThrottleIntake(city, targetAppId).paused === false`.
6. **Once-only invite:** `inviteAttempts === 0`. On success, the candidate receives one `LeakGuard`-checked message linking strictly to `https://<brand>` and `https://<brand>/SKILL.md`, `inviteAttempts` increments to `1`, and a `surface = "intake"` row is recorded in `marketing.contact_touchpoints`.

Endpoints: `POST /api/intake/score`, `POST /api/intake/:id/promote`.
CLI: `pnpm run marketing:cli -- intake-audit --city nyc`.

---

## 6. Verification & Simulation Gates

- **Dafny formal proofs:** `spec/marketingPolicy.md` proves all **26** obligations (including `lawApolloCreditsRespectCapsAndSafety`, `lawHighReportRiskOrSuspendedBlocked`, and `lawIntakeRequiresAdultQualityValueAndOnceOnly`).
- **Offline multi-city simulation (`pnpm run sim --only marketing`):** Runs 4 seeds x 30 days in `< 1s` with **15 blocking gates**, including Storms 8 (Apollo credit caps/cache/safety), 9 (10-platform risk/quiet hours/circuit breaker), and 10 (intake anti-slop/air-gap/queue-pause/once-only invite).
- **Real Postgres + HTTP integration suite (`pnpm run marketing:test`):** Verifies all 10 new HTTP endpoints, `platform.external_prospect_suppressions` in `marketing.contact_fence`, cache purge on suppression, and all Pass-4 defect regressions against real Postgres `:54339`.
