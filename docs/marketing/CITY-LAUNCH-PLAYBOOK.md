# City-by-City Global Launch Playbook (`@thenetwork/marketing`)

This playbook explains how `apps/marketing` launches The Network city by city, connects people to what they want in life across universal desire lanes, stays synced with the core platform, and proves every safety invariant before live spend.

---

## 1. Architecture Overview

The Network scales one metro at a time. New York City (`nyc`) is the first active `CityPack`, not a hard-coded special case. Every other city (`sf`, `la`, `chicago`, `miami`, `austin`, `london`, or any custom city registered at runtime) uses the same declarative engine:

| Layer | Module | Responsibility |
| :--- | :--- | :--- |
| **City Registry** | `apps/marketing/src/city-registry.ts` | Declarative `CityPack` definitions, `registerCityPack()`, `requireCityPack()` (throws `UnknownCityError` on unknown codes), and `platformActive` sync with `packages/core/src/cities.ts`. |
| **City Launch Engine** | `apps/marketing/src/city-launch-engine.ts` | `buildCityLaunchSeed(city)` and `seedCityLaunch(store, city)` generate labor-law-adapted tasks, desire-tagged bandit arms, corridor BD deals, VIP slots, and city-localized video scripts. |
| **Universal Desire Graph** | `apps/marketing/src/desire-lanes.ts` | 4 core launch lanes + 8 extensible life-desire lanes layered above `AppId`, enforcing the `slop != peon` data air-gap and 18+ paid floor. |
| **Multi-City Discovery** | `apps/marketing/src/discovery.ts` | `discoverCityLeads()` executes per-city Socrata open-data connectors (`OpenDataConnectorSpec`), Luma, Eventbrite, HN, GitHub, arXiv, Reddit, SEC Form D, OpenAlex, IRS 990, and ClinicalTrials.gov. |
| **Core Ecosystem Bridge** | `apps/marketing/src/network-bridge.ts` | Read-only Postgres RPCs (`marketing.contact_fence`, `marketing.supply_demand_k5`) enforcing global opt-out/minor fences, core queue backpressure (`queuePressurePaused`), and venue closure sync. |
| **LLM Cost & Cache Layer** | `apps/marketing/src/llm-cache.ts` | Bounded SHA-256 `PromptCache`, deterministic zero-token pre-router, trajectory ledger (`marketing.llm_trajectories`), and Dafny-proved daily token/cost caps (`llmBudgetWithinCaps`). |
| **Offline Simulator Gate** | `apps/marketing/src/sim.ts` & `scripts/sim/marketing.ts` | Deterministic 30-day multi-city (`nyc` + `sf`) offline simulation with 7 adversarial storms and 12 blocking safety/ROI gates (`pnpm run sim --only marketing`). |

---

## 2. Launching Any New City (Zero Code Forks)

To add a new metro (for example `denver`, `boston`, or `tokyo`):

1. **Define a `CityPack`** via `registerCityPack(pack)` or persist an override in `marketing.city_packs` (`upsertCityPack`). Required fields:
   - Identity & routing: `code`, `label`, `country`, `stateCode`, `currency`, `locale`, `timezone`, `e164DialPrefixes`, `opsEmail`.
   - Stage & platform status: `stage` (`researching` -> `waitlist_kindling` -> `liquidity_seeding` -> `live_matching` -> `scaling`) and `platformActive` (derived automatically from `packages/core/src/cities.ts` `getCity(code)`).
   - Activation corridors (`corridors`) and neighborhood matchers (`neighborhoodPatterns`).
   - Open-web discovery (`discovery`): Luma URL, Eventbrite URL, local subreddits, GitHub/HN/OpenAlex/ClinicalTrials queries, and zero or more `openDataConnectors` (`socrata_json` field mappings).
   - Statutory compliance (`legal`): labor classification, W-2 requirement, flier licence requirement, freelance payout SLA, anti-posting rule, transit exclusion rule, likeness release statute, and quiet hours.
   - Local vendors (`vendors`): vetted W-2 agencies, self-service gig platforms, and local gang-run/rush printers.
2. **Seed the city** via `POST /api/seed/:city` or `pnpm run marketing:cli -- seed --city <code >`.
3. **Run `$0` open-web discovery** via `POST /api/discovery` with `{ "city": "<code>" }`.
4. **Promote through readiness stages** using `evaluateCityStageReadiness(pack, metrics)`:
   - `researching -> waitlist_kindling`: requires at least one corridor and complete legal rules.
   - `waitlist_kindling -> liquidity_seeding`: requires verified 18+ waitlist adults and signed local venues to meet `pack.readinessGates`.
   - `liquidity_seeding -> live_matching`: requires `platformActive === true` in `packages/core/src/cities.ts`, active adult density, balanced parity (`45%–55%`), and healthy review SLAs.
   - `live_matching -> scaling`: requires trailing 30-day CPA within target, STOP rate below `3%`, and zero safety violations.

---

## 3. Statutory Labor & Fliering Compliance Matrix

`checkCityHiringCompliance()` and `buildCityLaunchSeed()` enforce local law automatically:

| City | Labor Classification | Direct 1099 Street Fliering | Special Statutory Gate | Payout SLA |
| :--- | :--- | :--- | :--- | ---: |
| **New York (`nyc`)** | `1099_allowed` | Allowed (18+, clickwrap NYLL § 191-d) | No posting on poles/trees (`NYC Admin Code § 10-119`); no MTA subway entry (`21 NYCRR § 1050.6`); NY Civ. Rights §§ 50–51 filming releases | 15 days |
| **San Francisco (`sf`)** | `w2_required_ab5` | **Blocked (`403`)** — auto-routes to W-2 `agency_booking` | California AB5 W-2 mandate; `CA Civ Code § 3344` likeness release; CA Bot Disclosure (`SB 1001`) | 15 days |
| **Los Angeles (`la`)** | `w2_required_ab5` | **Blocked (`403`)** — auto-routes to W-2 `agency_booking` | California AB5 W-2 mandate; `CA Civ Code § 3344` likeness release; CA Bot Disclosure (`SB 1001`) | 15 days |
| **London (`london`)** | `uk_paye_or_agency` | **Blocked (`403`)** without `boroughLicenceRef` | UK EPA 1990 Schedule 3A borough Free Printed Matter Distribution Licence + UK PAYE/agency staffing + CAP/ASA `#Ad` | 14 days |
| **Chicago (`chicago`)** | `1099_allowed` | Allowed (18+, IL FWPA) | Illinois Freelance Worker Protection Act; `765 ILCS 1075` publicity release; IL BIPA strict no-biometrics | 15 days |
| **Miami (`miami`)** | `1099_allowed` | Allowed outside restricted zones | Miami Beach Ch. 46 commercial handbill restrictions; `FL Stat. § 540.08` release | 15 days |
| **Austin (`austin`)** | `1099_allowed` | Allowed (18+) | Austin right-of-way clearance; TX CUBI strict no-biometrics | 15 days |

---

## 4. Universal Desire & Experience Graph (`DesireLane`)

The founder's goal is to connect everyone to what they want in life — starting with work, friends, and dating, and expanding without code rewrites into every high-value human connection:

### Core Launch Lanes (`launch_core`)

| Lane ID | Default App | Air-Gap Group | What It Connects |
| :--- | :--- | :--- | :--- |
| `money_work` | `peon` | `economic_work` | Roles, contracts, clients, and high-trust employer introductions |
| `ideal_friends` | `friends` | `social_platonic` | Platonic 3–6 person tables, run/supper clubs, and real local friends |
| `soulmate_dating` | `slop` | `romance` | 18+ double-opt-in romantic introductions (zero swipe feeds) |
| `elite_serendipity` | `ntwrk` | `general_network` | Curated cross-discipline 6-seat salons and high-trust serendipity |

### Extensible Life-Desire Lanes (`extensible`)

- `cofounder_venture` (`ntwrk`, `economic_work`)
- `investors_patrons` (`ntwrk`, `economic_work`)
- `mentorship_mastery` (`ntwrk`, `general_network`)
- `creative_collab` (`ntwrk`, `general_network`)
- `sport_wellness_crew` (`friends`, `social_platonic`)
- `shared_living_home` (`friends`, `social_platonic`)
- `travel_expedition` (`friends`, `social_platonic`)
- `bespoke_irl_experience` (`ntwrk`, `general_network`)

**Hard Air-Gap Rule (`canShareDesireData`):** `romance` lanes (`soulmate_dating`) and `economic_work` lanes (`money_work`, `cofounder_venture`, `investors_patrons`) never share signals or profile data. All paid marketing recruitment remains strictly 18+.

---

## 5. Core Ecosystem Sync & People Hygiene

1. **Zero Portals on Public Landing Sites (2026-10-19 rule):** All contractor clickwrap agreements, mobile filming release forms, and proof uploads resolve under `MARKETING_OPS_BASE_URL` (default `https://ops.ntwrk.party`), never on `ntwrk.party`, `slop.date`, `peon.biz`, or `friends.help`.
2. **Cross-Schema Contact Fence (`marketing.contact_fence`):** Before any outreach, invite, or hiring message leaves `apps/marketing`, `NetworkCoreBridge.checkContactFence()` queries the read-only `SECURITY DEFINER` RPC using the exact same keyed HMAC (`keyedContactHash`) as `packages/platform`. It fails closed on:
   - Core opted-out / banned / blocked members
   - Known or suspected minors (`< 18`)
   - Marketing global suppression rows (`marketing.contact_suppression`)
   - Cross-surface frequency & cooldown limits proved in `spec/marketingPolicy.md` (`coldCooldownDays = 14`, `maxColdTouches30d = 2`, `maxUnansweredCold = 2`, `maxOpTouchesPerDay = 3`).
3. **Supply/Demand Backpressure (`marketing.supply_demand_k5`):** `NetworkCoreBridge.getDemandAndPressure()` reads `k >= 5` anonymized city/app queue metrics. When `queuePressurePaused(...)` is true (restricted Blooio line, overdue reviews, or open review/outbound queue backlog above limits), `apps/marketing` pauses cold acquisition automatically while letting existing ops/proofs finish cleanly.

---

## 6. LLM Efficiency, Verification & Offline Simulation

- **Deterministic Pre-Router + Prompt Cache (`llm-cache.ts`):** Opt-out detection, video script linting, applicant scoring, and VIP archetype classification resolve at **0 tokens** before any LLM call. Repeated prompts hit the bounded SHA-256 `PromptCache`.
- **Proved Daily LLM Caps (`llmBudgetWithinCaps`):** Every LLM dispatch checks `marketing.llm_trajectories` daily token and cost micro-dollar totals against proved ceilings before calling a provider.
- **Deterministic Offline Simulator Gate:**
  ```bash
  pnpm run sim --only marketing
  pnpm run sim --only marketing --quick
  ```
  Runs a 30-day multi-city (`nyc` + `sf`) offline simulation with `SimClock` + seeded `Rng`, executing 7 adversarial storms (Sybil ring, underage wave, STOP-rate spike, device thermal/battery fault, budget/reserve overrun, disabled `slop.cash` settle, and LLM token + core backpressure storm) and verifying **12 blocking gates** in under `1.5s` with zero external calls.
