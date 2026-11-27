# Pass 2 Deep Audit Report — `develop` (`0239b70c3`)

**Date:** 2026-11-27
**Target Branch & Commit:** `develop` @ `0239b70c3` (post-merge of `feat/five-city-venues-and-matching` over `1974d9daa` `feat/nextgen-matching-eliza`, `0a65071f4` `feat/meetup-setup-external-matchmaking`, and `966ae647a` `feat/marketing-pass3`)
**Scope:** Read-only forensic audit of correctness, teen safety, database schema, Vibestack specs, cross-system integration, LLM/Workers AI efficiency, runtime performance, global human experience, simulation fidelity, and Observatory observability.
**Product Vision Anchor:** Build a global network that expands city by city and connects every member to exactly what they want in life — money, jobs, and deals; ideal friends; a soulmate; and the full range of local and cross-city experiences — without breaking launch scope, privacy walls, or teen safety invariants.

---

## Executive Verdict

`develop` at `0239b70c3` is **red on main**. Merging three large parallel feature streams (`nextgen-matching`, `meetup-setup-external-matchmaking`, and `five-city-venues-and-matching`) onto the existing platform produced a repository that fails `typecheck`, fails 3 of 4 five-city integration suites, crashes `pnpm run sim --only five-city`, and fails `meetup-venues-external.pg.test.ts`.

Beyond immediate merge breakages, the audit exposes a deeper architectural truth: **the three merged systems are mostly disconnected from one another and from real-human production entry points**:

- **Live safety and correctness bugs:** Non-NYC breweries can pass as `allAges: true` for minors (`geo.ts:228,350`); `heavy_drinker` tags mark members as `nonDrinker` (`network.ts:10531`); `seedVenue()` omits `ageMin: 0`, crashing Postgres seeding and sim (`cities.ts:65-84`); `PgVenueStore` drops all 12 `0098` venue red-line columns (`venue-store.ts:236-281`); `MeetupCoordinator` bypasses the panic and `venue_full` guards in `meetupCoordination.ts`; and `isWorkIntro` sends `ntwrk` deal, investor, and mentor intros to public parks (`network.ts:4789-4791`).
- **Disconnected subsystems:** `1974d9daa`'s 17-type ontology, `HumanVector`, and `classifyEmptyStateRemedy` receive near-zero signal from real human messages (`extract.ts`/`classify.ts` still use the legacy 20/38/22 vocabulary). `PgVenueStore`, `CompositeVenueProvider`, `externalEvents`, `externalMatchmaker`, and `TopOneSuggestionFlow` have **zero production callers**. `apps/marketing` ignores `@thenetwork/core` `CitySpec` and hardcodes NYC across seeds, bandits, discovery, and legal copy.
- **Severe LLM and runtime waste:** `JudgeCache` achieves **0% cross-day hit rate** because `buildDeepContext` embeds continuously drifting timestamps (`judgeContext.ts:43,283-385`); `LLMBudget` silently disables the engine judge for an entire day on UTC day rollover (`service.ts:927-953`); `VenueManager.exportState()` serializes **95.6 KB** of static seed venues through **3x–4x redundant `JSON.parse(JSON.stringify())` clones** on every inbound message and tick; and `chooseFairMidpoint` / `isVenueOpenAt` run **37.9x** and **7.8x** slower than indexed equivalents.
- **Sim fidelity and speed gaps:** `fiveCitySuite` runs with the matching engine disabled (`maxNewPerDay: 0`) and bypasses real orchestration; `0098` systems have zero `pnpm run sim` coverage; and full `pnpm run sim` takes **~64 min (3,833 s)** because blocks run serially and `scripts/sim/scale.ts` executes 20M brute-force pair evaluations per high-N rung.

---

## 1. Executive Health Snapshot on `develop` (`0239b70c3`)

Live probe commands executed directly against `develop` (`0239b70c3`):

| Check | Command | Result | Exact Failure Details |
|---|---|---|---|
| **Typecheck** | `corepack pnpm@10.24.0 run typecheck` | **FAIL (exit 2)** | **8 TypeScript errors** across 3 Observatory files (`apps/observatory/db/seed.ts`, `apps/observatory/web/map.ts`, `apps/observatory/test/five-cities.integration.test.ts`). Root `tsc -p .` and `apps/observatory/tsconfig.json` fail. (`sites`, `apps/observatory/deploy`, `@thenetwork/ui`, `@thenetwork/site`, `apps/marketing` pass `EC=0`.) |
| **Security Suite** | `REQUIRE_PG=1 corepack pnpm@10.24.0 run security` | **PASS (exit 0)** | 11/11 files, 291/291 tests passed (33.05 s). |
| **Five-City Vitest Suites** | Targeted run across 4 five-city test files | **FAIL (3/4 files failed)** | `7 failed \| 23 passed \| 3 skipped`:<br>• `tests/e2e/five-cities.e2e.test.ts`: **PASS (4/4)**.<br>• `packages/platform/test/venues-five-cities.pg.test.ts`: **FAIL (2/8 pass, 6/8 fail)** — `UNDEFINED_VALUE: Undefined values are not allowed` at `venue-store.ts:345` (`v.ageMin` is `undefined`).<br>• `packages/network/test/five-cities-venues-work-intro.test.ts`: **FAIL (14/15 pass, 1/15 fail)** at `:254` — `expect(teen.primary).toBeDefined()` is `undefined` because harmonized `rankVenuesForMatch` (`venues.ts:377`) defaults `teenFriendAllowed = false`.<br>• `apps/observatory/test/five-cities.integration.test.ts`: **FAIL (3/6 pass, 3 skipped)** — `beforeAll` throws `RangeError: an integer result is NaN` in `groupVenueRubricScore` via `seed.ts:36`; `afterAll` throws `TypeError` at `:91` (`rm(dir)` when `dir` is `undefined`). |
| **External-Matchmaking / `0098` Suites** | Targeted run across 2 `0098` test files | **FAIL (1/2 files failed)** | • `packages/network/test/meetup-external-matchmaking.integration.test.ts`: **PASS (3/3)**.<br>• `packages/platform/test/meetup-venues-external.pg.test.ts`: **FAIL (4/5 pass, 1/5 fail)** at `:76` — test asserts only 4 NYC rows in `platform.networks`, broken by migration `0099` seeding all 20 `<app>:<city>` networks. |
| **Five-City Sim Gate** | `corepack pnpm@10.24.0 run sim --only five-city` | **FAIL (0/1 blocking, 1.2 s)** | Crashes at `packages/sim/src/fiveCitySuite.ts:1784`: `TypeError: Cannot read properties of undefined (reading 'id')` because `vm.listVenues(city).find(v => v.ageMin === 0 && !v.isBarOnly)!` returns `undefined` when `seedVenue()` omits `ageMin: 0`. |

---

## 2. P0 Correctness, Safety & Schema Bugs

Every item below is a live bug, safety defect, schema hazard, or production outage vector verified in `develop` (`0239b70c3`).

### P0-1. Teen Safety Bug: Breweries Admitted as `allAges: true` in `geo.ts` / `plans.ts`
- **Locations:** `packages/network/src/geo.ts:228` (`meetingSpot`), `packages/network/src/geo.ts:350` (`seedVenueToGeoVenue`, called by `packages/network/src/plans.ts:52` `planVenuesForCity` and `nearbyVenues`).
- **Root Cause:** `packages/core/src/cities.ts:78` sets `allAges: false` for alcohol-centric venues (`isAlcoholCentric: true`), including `sf-biergarten-hayes` (`cities.ts:181-189`), `sf-cellarmaker-mission` (`cities.ts:191-199`), and `nyc-threes-brewing` (`cities.ts:388-396`), which have `isBarOnly: false`, `alcoholOptional: true`, and `ageMin: undefined`. Both `geo.ts:228` and `geo.ts:350` ignore `v.allAges` and `v.isAlcoholCentric`, checking only `(v.ageMin ?? 0) <= teenFriendMinAge && !v.isBarOnly && v.alcoholOptional`. As a result, breweries and wine patios pass as `allAges: true` for minors.
- **Required Fix:** Enforce `v.allAges === true && !v.isAlcoholCentric` in both `geo.ts:228` and `geo.ts:350`. Add a regression test asserting that breweries/beer gardens are excluded from teen plans and teen spots in every city.

### P0-2. `heavy_drinker` Tag Misclassified as `nonDrinker`
- **Location:** `packages/network/src/network.ts:10525-10531` (`memberVenuePrefsOf`).
- **Root Cause:** Line `10531` computes `nonDrinker = strictSober || hasTag([..., "heavy_drinker"])`, and `hasTag` (`10525-10529`) matches `t.endsWith(":heavy_drinker") || t === "heavy_drinker"`. Members tagged `heavy_drinker` are falsely flagged as non-drinkers and excluded from alcohol-serving venues.
- **Required Fix:** Remove `"heavy_drinker"` from the `nonDrinker` tag list (match only sober/non-drinking tags) and add a unit test verifying `heavy_drinker` produces `nonDrinker: false`.

### P0-3. `seedVenue()` Omits `ageMin: 0`, Crashing `PgVenueStore`, Observatory Seed, and `fiveCitySuite`
- **Locations:** `packages/core/src/cities.ts:65-84`, `packages/platform/src/venue-store.ts:345,446`, `apps/observatory/db/seed.ts:74`, `packages/sim/src/fiveCitySuite.ts:1784`, and `packages/core/src/venues.ts:377` (affecting `packages/network/test/five-cities-venues-work-intro.test.ts:254`).
- **Root Cause:** `seedVenue()` in `cities.ts:65-84` leaves `ageMin` as `undefined` for all-ages venues across `ALL_SEED_VENUES`.
  1. `PgVenueStore.seedCuratedVenues` (`venue-store.ts:345`) and `upsertVenue` (`venue-store.ts:446`) pass `${v.ageMin}` directly to Postgres, throwing `UNDEFINED_VALUE` and failing 6/8 tests in `venues-five-cities.pg.test.ts`.
  2. `fiveCitySuite.ts:1784` runs `vm.listVenues(city).find(v => v.ageMin === 0 && !v.isBarOnly)!`, returning `undefined` and crashing `sim --only five-city`.
  3. Separately, harmonized `rankVenuesForMatch` (`venues.ts:377`) defaults `teenFriendAllowed = false`, causing 2-teen `mode: "group"` requests in `five-cities-venues-work-intro.test.ts:254` to return `primary === undefined`.
- **Required Fix:** Set `ageMin: v.ageMin ?? 0` inside `seedVenue()` (`cities.ts:65-84`), defensively coalesce `v.ageMin ?? 0` in `venue-store.ts:345,446` and `apps/observatory/db/seed.ts:74`, and fix `five-cities-venues-work-intro.test.ts:254` (or align `rankVenuesForMatch` teen-group admission with `spec/friendIntroAge.md`).

### P0-4. `PgVenueStore` Silently Drops All 12 `0098` Red-Line Columns & Hardcodes Safety/Transit Scores
- **Locations:** `packages/platform/src/venue-store.ts:236-281` (`rowToVenue`), `:345-392` (`seedCuratedVenues`), `:433-498` (`upsertVenue`), and `apps/observatory/db/seed.ts:67-112`.
- **Root Cause:**
  - `rowToVenue` (`venue-store.ts:236-281`) never reads `all_ages`, `is_alcohol_centric`, `halal_friendly`, `kosher_friendly`, `gluten_free_friendly`, `severe_allergen_safe`, `is_smoke_free`, `open_event_eligible`, `hobbies`, or `cuisine_tags`, and hardcodes `safetyScore: 9, transitScore: 4` (`:277-278`) instead of reading `r.safety_score` and `r.transit_score`.
  - `seedCuratedVenues`, `upsertVenue`, and `apps/observatory/db/seed.ts` never write any of those 12 columns. Postgres defaults leave every venue with `all_ages = true, is_alcohol_centric = false` (even 21+ bars) and all dietary/allergen/open-event flags `false`, corrupting teen safety and red-line filtering against Postgres.
- **Required Fix:** Wire all 12 columns through `rowToVenue`, `seedCuratedVenues`, `upsertVenue`, and `apps/observatory/db/seed.ts`, and round-trip verify them in `venues-five-cities.pg.test.ts`.

### P0-5. Migration `0098` vs `0099` Duplicate DDL & Missing `meetup_arrivals` Integrity Constraints
- **Locations:** `packages/db/migrations/0098_meetup_venues_external_matchmaking.sql` vs `packages/db/migrations/0099_five_cities_venues_followups.sql`, `packages/platform/src/venue-store.ts:628`, and `packages/platform/test/meetup-venues-external.pg.test.ts:76`.
- **Root Cause:**
  1. `0099` (still carrying header `-- 0098:`) duplicates `CREATE TABLE IF NOT EXISTS` for 5 tables already created by `0098`: `platform.venues`, `platform.venue_api_cache`, `network.venue_visits`, `network.venue_rejections`, and `network.meetup_arrivals`.
  2. `0098:19-88` defines 12 extra columns and 9 stricter `CHECK` constraints on `platform.venues` that `0099:23-79` omits. On fresh DBs `0099` is a silent no-op for those tables, but any DB that ran the pre-renumber `0098` (now `0099`) lacks the 12 columns and checks.
  3. City name conflict: `0098:12` inserts `'nyc'` as `'New York City'` (matching `0003_platform.sql:40`), while `0099:9` inserts `'New York'`.
  4. Duplicate RLS policy drop/recreate (`0098:439-472` hardcodes 4 apps; `0099:197-222` loops `platform.apps`), while Observatory `SELECT` grants on `platform.venues` exist only in `0099:186-195`.
  5. Unique-to-`0099` objects that must be preserved: 20 `platform.networks` rows (`0099:16-20`, which also broke `meetup-venues-external.pg.test.ts:76` expecting 4 NYC rows), `network.work_intros` (`0099:144-161`), and `ALTER TABLE network.opportunities` / `network.feedback` columns (`0099:164-173`).
  6. Both `0098:136-151` and `0099:127-142` omit `UNIQUE (app_id, opportunity_id, member_id)` and a `CHECK` constraint on `state` for `network.meetup_arrivals` (relying solely on an app-constructed string `id` at `venue-store.ts:628`).
- **Required Fix:** Reconcile `0099` (or add a clean follow-up migration if `0099` has already been applied to shared DBs — red-team to decide `0099` edit vs `0100` additive migration) so there is zero duplicate DDL, upgrade-safe `ALTER TABLE platform.venues ADD COLUMN IF NOT EXISTS ...`, `UNIQUE (app_id, opportunity_id, member_id)` + `state` `CHECK` on `meetup_arrivals`, consistent `'New York City'` label, and updated expectation in `meetup-venues-external.pg.test.ts:76`.

### P0-6. `MeetupCoordinator` Bypasses `meetupCoordination.ts` (Missing Panic Halt & `venue_full` Pivot)
- **Locations:** `packages/network/src/meetup-coord.ts:13-20,190-241,474-502` and `packages/network/src/network.ts:1633-1648,7678,10457-10514`.
- **Root Cause:**
  - `MeetupCoordinator` imports `generated/meetupArrival.ts` (PascalCase `"ActiveArrival"`, no `panicTriggered`, no `venue_full` handling). `parseArrivalText` (`:190-241`) never parses `venue_full`, and `:474-502` handles only `venue_closed`.
  - Meanwhile `ConsentNetwork` defines `canRelayArrivalForMeetup` and `checkBackupPivot` (`network.ts:10457-10514`) calling `generated/meetupCoordination.ts` (`evaluateArrivalRelaySafe` with `panicTriggered`, `evaluateBackupPivotV2` with `full`, `evaluateVenueQuarantine`), **but neither method is ever called by `handleInbound` (`network.ts:1633-1648`) or `tick` (`:7678`)**.
  - In addition, `checkBackupPivot` (`network.ts:10502`) looks up the backup venue in static `ALL_SEED_VENUES.find(...)` instead of `this.venues.getVenue(opp.backupVenueId)`, missing dynamically discovered or quarantined venues.
- **Required Fix:** Consolidate `MeetupCoordinator` onto `generated/meetupCoordination.ts`, check `relayDesk.isPanicTriggered` before every arrival relay, parse and pivot on `venue_full` (without quarantining the venue), look up backup venues via `this.venues.getVenue(...)`, and remove the dead duplicate helpers on `ConsentNetwork`.

### P0-7. `isWorkIntro` Excludes `ntwrk` `Intro`, `Mentor`, and `Invest` — Dumping Deals & Investors Into Parks
- **Locations:** `packages/network/src/network.ts:530,4789-4791,5204,5405-5423`, `packages/engine/src/packs/network/vectors.ts:84-98`, and `spec/workIntroChannel.md:18-31`.
- **Root Cause:**
  - `isWorkIntro` (`network.ts:4789-4791`) returns `true` only for `!!o.seat || o.lane === "Cofounder" || (this.app.id === "peon" && o.category === "professional")`.
  - `1974d9daa` routes `work_hiring`, `step_ahead_mentorship`, `patronage_sponsorship`, and `executive_peer_council` to `Intro`, `Mentor`, and `Invest` lanes on `ntwrk` (`vectors.ts:84-98`). Because `isWorkIntro` excludes those lanes, `reveal()` (`network.ts:5204`) schedules investors, mentors, patrons, and deal intros at physical parks/food halls (`meetingSpot`) instead of Boardy-style `WarmEmail`, `ScheduledVideo`, or `RelayShare`.
  - Even for routed work intros: `workIntroEmailOf` (`network.ts:530,5423`) is never passed by `NetworkService` (only tests and `fiveCitySuite.ts:800`), no actual email-send adapter executes when `channel === "WarmEmail"`, `workIntroReveal` (`network.ts:5405-5412`) hardcodes `SEAT_COPY.cofounder*` for all non-seat work intros, and `spec/workIntroChannel.md:18-31` is strictly 2-party (`candAge`/`mgrAge`), unable to represent 3–6 person `executive_peer_council` or 2–3 person `patronage_sponsorship`.
- **Required Fix:** Expand `isWorkIntro` to include `Intro`, `Mentor`, and `Invest` (or drive routing from an explicit `deliveryMode` field on the ontology/lane); add appropriate non-cofounder reveal copy; wire `workIntroEmailOf` into `NetworkService`; and extend `spec/workIntroChannel.md` for N-party adult work rosters.

### P0-8. `JudgeCache` 0% Cross-Day Hit Rate & `LLMBudget` UTC Day-Rollover Silent Outage
- **Locations:**
  - Cache bug: `packages/engine/src/packs/network/judgeContext.ts:43,283,297,315,330,358,385`, `packages/engine/src/judgeCommon.ts:73-80`, `packages/engine/src/config.ts:171`.
  - Budget bug: `packages/network/service/service.ts:530-533,927-953`, `packages/network/service/serve.ts:174-188`.
- **Root Cause:**
  1. `JudgeCache` has a 7-day TTL (`config.ts:171`), and `passCacheKey` hashes `request.messages`. Because `buildDeepContext` embeds continuously drifting relative-time fields (`created_days_ago: r1((now-t)/DAY)`, `expires_in_days`, `proposed_together_days_ago`, `from_day`/`to_day` at 0.1-day = 2.4 h precision, plus `joined_days_ago` and `age_days`), every daily run invalidates 100% of cached verdicts even for unchanged candidates — wasting **~70–85% of daily `engine_judge` tokens** (~2.5k–4k tokens/candidate × 13 candidates/city/day × 20 networks).
  2. `engineBudgets` is refreshed in `reviewJudgeTick()` (`service.ts:937`), which runs **after** `rt.tick()` (`service.ts:930-931`, `serve.ts:178-187`). If Day D exhausts the `engine_judge` USD or request cap, Day D+1's first tick — when daily matching runs — executes against Day D's exhausted `LLMBudget`, throws `LLMError("budget")` on every candidate, and silently degrades matching to heuristics for the entire day. Moreover, `budget.requests` is per-replica in-memory only.
- **Required Fix:** Key `JudgeCache` on canonical member `revision`s (`world.ts:528`), `candidate.key`, `pack.version`, `pass`, `promptVersion`, `model`, and a coarse window bucket (or quantize relative ages in the cache key). Refresh `engineBudgets` **before** `rt.tick()` (or lazily on `dayOf(clock.now()) !== entry.day`) and seed request counts from `network.cost_ledger` on refresh.

### P0-9. Observatory Post-Merge TypeScript & Runtime Bugs (3 Files)
- **Locations:** `apps/observatory/db/seed.ts:17-24,36-52,74`, `apps/observatory/web/map.ts:104`, `apps/observatory/test/five-cities.integration.test.ts:91,198`.
- **Root Cause:**
  1. `apps/observatory/db/seed.ts:19-21,51` still uses stale PascalCase `"SuspectClosed"|"ClosedTemporary"|"ClosedPermanent"` and `"Conversational"|"Quiet"` instead of snake_case `VenueStatus`/`VenueNoiseLevel`; lines `:36-49` pass 12 positional arguments to `groupVenueRubricScore` instead of one `GroupVenueRubricInput` object (producing `RangeError: an integer result is NaN` at runtime); line `:74` inserts raw `v.ageMin` (`undefined`).
  2. `apps/observatory/web/map.ts:104` checks `v.status === "Active"` instead of `"active"`, which both fails `typecheck` and renders **every map venue pin destructive-red** at runtime.
  3. `apps/observatory/test/five-cities.integration.test.ts:198` checks `"Active"` instead of `"active"`, and `:91` calls `rm(dir, ...)` in `afterAll` without guarding `if (dir)`.
- **Required Fix:** Update all 3 files to snake_case `VenueStatus`/`VenueNoiseLevel`, object-form `groupVenueRubricScore({...})`, `v.ageMin ?? 0` + all 12 `0098` columns in `seed.ts`, and `if (dir)` guard in `afterAll`.

### P0-10. Additional Live P0/P1 Correctness & Invariant Defects Surfaced Across Audits
- **Broken 5-city onboarding copy:** `packages/network/service/service.ts:3041` still prompts joiners: `"Tell me your home city: New York or San Francisco / Bay Area."` — omitting LA, Chicago, and Miami.
- **5-city slop extractor prompt bug:** `packages/engine/src/packs/slop/extract.ts:1072` tells the LLM `multi needs at least two distinct markets from nyc/sf/la` while validator line `:1102` accepts all 5 (`nyc/sf/la/chicago/miami`).
- **Clock invariant violations (`AGENTS.md`):** `packages/platform/src/venue-store.ts:502,588,670` and `packages/platform/src/venue-provider.ts:141,208,317,394,466,477` default `nowMs = Date.now()` instead of requiring `Clock`.
- **Reasoning-last judge violation (`AGENTS.md`):** `packages/sim/src/judge/llmJudges.ts:78,86,92,98` places `"reasoning"` last in the output schema instead of before the verdict.

---

## 3. Deduplication & Cross-System Integration Gaps

Four streams landed on `develop` (`0098` meetup-setup/external-matchmaking, `1974d9daa` nextgen-matching, `966ae647a` marketing, and `0239b70c3` five-city venues/work-intros) with heavy duplication and missing seams.

### 3.1 Three Duplicated Vibestack Spec Pairs & Enum/Model Drift

| Spec Pair | Conflict / Duplication | Runtime Impact & Fix |
|---|---|---|
| `spec/meetupArrival.md` ↔ `spec/meetupCoordination.md` | Duplicates `meetupPhase` (ADT with `allMet` vs `str` without `allMet`), `noShowDecision` (`minutesSinceArrival` ADT vs `minutesAfterStart` `str`), arrival relay, and backup pivot. Also `meetupCoordination.md:67-74` `canAttendEventOrCoattend` forbids *all* minors from multi-person co-attendance, conflicting with `spec/friendIntroAge.md` and `spec/venueSelection.md:118` (which allow 13–17 teen friend groups ≤ 6 at all-ages venues). | `MeetupCoordinator` uses `meetupArrival.ts` (missing panic + `venue_full`); `ConsentNetwork` defines unused helpers on `meetupCoordination.ts`. **Unify onto `meetupCoordination.md`** (preserve `allMet` state) and scope `canAttendEventOrCoattend` explicitly to adult/external events. |
| `spec/encounterFollowup.md` ↔ `spec/meetupCoordination.md:218-273` | Duplicates `computeFollowupLocalHour` and `canSendFollowup` with **different next-morning times**: `encounterFollowup.md:24` = **09:00**, `meetupCoordination.md:240` = **09:30**, `spec/models/meetup_coordination.md:603` = **09:00**. | `packages/core/src/venues.ts:793-820,882-906` stitches both specs (`computeFollowupLocalHourLegacy` for work intros; `meetupCoordination` for non-work). `network.ts:7929,7992` takes the legacy branch with `isQuietHours: false`. **Unify to one follow-up spec and one next-morning hour (09:00 or 09:30)**, preserving `isWorkIntro`. |
| `spec/cityTravel.md` ↔ `spec/venueSelection.md:14-65` | Duplicates `isWithinTravelLimit` (3-arg vs 2-arg), `isValidMidpoint`, `fairMidpointCostScaled`, and `fairMidpointNetCostScaled` (`cityTravel.md:49-50` clamps `>= 0`; `venueSelection.md:35-36` can return negative values). | `generated/cityTravel.ts` is dead except re-exporting `maxRelaxStepMin` (`packages/core/src/index.ts:34`). **Merge `cityTravel` into `venueSelection.md`**, keeping the `>= 0` clamp. |

**Additional Spec/Model/Enum Drifts (P1–P2):**
- `spec/groupLateArrival.md` vs `MeetupCoordinator` (`network.ts:1630-1635`): overlapping late-arrival windows (`[-60m, +30m]` anonymous fixed notice vs `[-30m, +45m]` personalized relay) with no documented handoff boundary.
- `packages/core/src/types.ts:322`: `NoShowAction = "wait" | "ping_late" | "notify_waiting" | "done"` matches neither `meetupArrival.md` nor `meetupCoordination.md`.
- `0098:186` `matchmaker_personas.status` includes `'throttled'`, absent from `spec/externalMatchmaker.md:27-29` and `PersonaHealthStatus` (`externalMatchmaker.ts:41`).
- `0098:243` `external_events.status` omits `'confirmed_go'` used in `spec/models/external_event_bridge.md:98`.
- `externalMatchmaker.ts:661-662` uses a 14-day TTL for `consentState === "none"`, while `spec/externalMatchmaker.md:184` and `evaluateRetention` (`:716`) use 30 days.
- `spec/models/work_intro.md:353-354` gates `relay_share` on `candShareConsent && mgrShareConsent`, whereas `spec/workIntroChannel.md:31` falls back to `RelayShare` without a share-consent parameter.
- `spec/models/venue_lifecycle.md:245` uses `<= 24h` weekday-only verification vs `spec/venueSelection.md:325-327` (`< 24h` weekday / `< 6h` weekend).
- `VenueManager.recordOrganicMention` (`venue-manager.ts:352-388`) omits `allAges`, `isAlcoholCentric`, and `isSmokeFree`.
- Orthogonal specs confirmed clean: `monthlyGatheringFollowup.md`, `emptyIntentFollowup.md`, `venueBookingLink.md`, `privateHomeHelpVenue.md`.

### 3.2 Three Parallel Venue Catalogs & Three Conflicting Member-Preference Extractors

1. **Three venue catalogs:**
   - `ALL_SEED_VENUES` (`packages/core/src/cities.ts`, 75 venues across 5 cities).
   - Legacy `VENUES` (`packages/network/src/geo.ts:97-169`, 72 NYC-only venues with `bookingUrl` and `TEEN_PLANS_ONLY`).
   - `PLAN_VENUES` (`packages/network/src/plans.ts:38-69`, pulls `geo.ts` for NYC and `cities.ts` for the other 4 cities).
2. **Three diverging member-preference extractors in `packages/network/src/network.ts`:**
   - `memberVenuePrefs()` (`network.ts:9418`): reads only `nonDrinker` and `maxBudgetTier` (`budget|price_tier|venue_budget:1-4`, missing tier `0`/free and `hv:spend:*`, filtering out `agent_private` at `:9403`).
   - `memberVenueRankPrefs()` (`network.ts:9431`, called for backup venues at `:5270` and plans at `:7310`): hardcodes `vegetarian: false, vegan: false, wheelchairNeeded: false, rejectedVenueIds: []`, defaults `maxBudgetTier ?? 4`, and omits `strictSober`, `halal`, `kosher`, `glutenFree`, `severeAllergen`, `smokeFree`, `lowNoiseRequired`, and `daytimeOnly` — **backup venues ignore member red lines**.
   - `memberVenuePrefsOf()` (`network.ts:10516`, called by `pickVenueWithRedLines` at `:10614`): reads all 13 red lines (with the `heavy_drinker` bug at `:10531`), but hardcodes `maxBudgetTier: 2` (ignoring `spend:*`/`hv:spend:*`/`budget:*`), passes empty `visitedVenueIds: []` and `rejectedVenueIds: []` (`:10565-10566`), and `pickVenueWithRedLines` (`:10638-10639`) calls `pickPrimaryAndBackupVenue(seedVenuesForCity(city), ...)` directly — **bypassing `this.venues` (`VenueManager`) completely** (dropping closures, quarantine, Bayesian priors, discovered venues, and visit/rejection history).
3. **Spend-tier mismatch:** `humanVector.ts:90-96` (`venueCostFitsTier`) maps `"moderate" -> <= 3`, `friends/planner.ts:325` applies `venueCostFitsTier` only to `"free"`/`"low"`, while `memberVenuePrefsOf` hardcodes `2`.
4. **NYC legacy park bypass & dead persona priors:** `reveal()` (`network.ts:5214,5233-5238`) still sends red-line-free NYC intros through legacy park/plaza `VENUES` (`meetingSpot`), ignoring open hours, `modeVenueScore`, and persona priors. `MemberVenuePrefs.archetype` is never populated anywhere in `network.ts`, so `computeVenuePersonaScore` (`venues.ts:339-354`) always falls back to `"default"`.

**Fix:** Collapse all three extractors into one `memberVenuePrefs` helper (bridging `spend:*`/`hv:spend:*`/`budget:*`, all 13 red lines, and visited/rejected history) and route primary, backup, and red-line picks through one `this.venues` (`VenueManager`) path.

### 3.3 Real-Human Extraction Is Blind to `1974d9daa` (`nextgen-matching`)

- `packages/network/src/extract.ts:15,34-36,74-76,111` and `packages/network/src/classify.ts:20,211,603-632,827-832` import only legacy `DESIRES` (20), `INTERESTS` (38), and `SKILLS` (22) — **not** `ALL_DESIRES` (+14 `EXTENDED_DESIRES`), `ALL_INTERESTS` (+12), or `ALL_SKILLS` (+23) from `packages/engine/src/packs/network/vocabulary.ts:299-421`. `validateUnderstood` (`extract.ts:97,111`) throws `out_of_vocab` on any extended desire, interest, or skill.
- Neither `extract.ts` nor `classify.ts` emits any `hv:*`, `spend:*`, `stage:*`, `transition:*`, `humor:*`, `guild:*`, `rung:*`, `lang_native:*`, `lang_learn:*`, or dietary/accessibility/alcohol/noise red-line tags. Only `packages/sim/src/persona.ts:837-885` emits `hv:*` tags, so `parseOntologyTags` (`packages/engine/src/packs/network/ontology.ts:153-282`) gets near-zero explicit signal from real people.
- `classifyEmptyStateRemedy` (`packages/engine/src/humanVector.ts:960-1083`) has **zero production callers**; `network.ts:8210-8226,9219-9223` (`empty_intent`) ignores it.

### 3.4 Unwired Production Seams (Zero Callers Outside Tests)

| Module / Table | File:Line | Current Production Status |
|---|---|---|
| `PgVenueStore` | `packages/platform/src/venue-store.ts:711` | **0 production callers** in `packages/network/service/` or `packages/platform/src/api.ts`; runtime still persists venues inside `network_state` JSONB (`network.ts:10196`). |
| `CompositeVenueProvider` & `VenueManager.pickForMatchAsync` | `packages/platform/src/venue-provider.ts`, `venue-manager.ts:208` | **0 production callers**. |
| `externalEvents.ts` | `packages/core/src/externalEvents.ts` | **0 production callers** (3 unused pass-throughs at `network.ts:10663-10703`); hardcodes `"Friends / The Network"` (`:297,504,650`); never projects approved events into `World.events` or `VenueManager`. |
| `externalMatchmaker.ts` | `packages/core/src/externalMatchmaker.ts` | **0 production callers**; `defaultLaunchCityPairs()` (`:274-350`) hardcodes 5 cities/TZs/hubs instead of `CitySpec`; `verticals` locked to `["slop", "friends"]` (`:86,155,263,403`); `ALLOWED_FACET_PREFIXES` (`:500`) allows only `slop:*`. |
| `TopOneSuggestionFlow`, `evaluateAnchorFailover`, `evaluateEventAttendance` | `packages/core/src/venues.ts:591-714` | **0 production callers**. |
| 7 new `0098` Postgres tables | `venue_concurrent_holds`, `matchmaker_personas`, `external_events`, `external_event_rsvps`, `external_prospects`, `external_prospect_suppressions`, `external_sourcing_tickets` | **0 production readers/writers**. |

### 3.5 `CitySpec` Registry Disconnects & City #6 Blockers

- **NYC-only spatial lookup:** `packages/engine/src/spatialIndex.ts:279` (`resolveMemberCoords`) calls NYC-only `hood(area)` (`packs/friends/geo.ts:102`) instead of `findNeighborhood(p.city, area)` from `@thenetwork/core`, degrading non-NYC neighborhoods to zip fallback or single-point `MARKET_ANCHOR_ZIP` collapse.
- **`HumanVector` H3 & transit bugs:** `packages/engine/src/humanVector.ts:722-724` sets `homeH3` to a string label (`"${homeCity}:${homeArea}"`) instead of `latLonToHex`, and guesses `transitMode` from `maxTravelMinutes` instead of `CitySpec.primaryMode` (misclassifying LA car drivers as `"transit"`).
- **Vocabulary neighborhood drift:** `packages/engine/src/packs/network/vocabulary.ts:423-429` maintains a separate hand-coded `NEIGHBORHOODS` map per city that drifts from `CitySpec.neighborhoods` (`cities.ts:108-119,313-324` — e.g. `"Mission"` vs `"Mission District"`, plus `"Sunset"`, `"Harlem"`, `"Astoria"` missing from `CitySpec`).
- **Hardcoded 5-city unions blocking City #6:** Although `registerCity(spec)` exists (`cities.ts:1120`), 5 modules still hardcode the 5-city union: `LAUNCH_CITIES`/`isCity` (`core/types.ts:6-11`), `CITY_IDS` (`cities.ts:1117`), `MARKET_ANCHOR_ZIP` (`zips.ts:460`), `HOME_CITY_ALIASES` (`accounts.ts:61-78`), and `travel-presence.ts:10-16,29`.

### 3.6 `apps/marketing` Completely Bypasses `@thenetwork/core` `CitySpec` & Hardcodes NYC

- **Zero `CitySpec` usage:** `apps/marketing/package.json:13` declares `@thenetwork/core`, yet `apps/marketing/src/cities.ts` never imports it and maintains its own `SUPPORTED_CITIES = ["nyc","sf","la","chicago","miami","austin","london"]` (`:3-11`) and `CITY_CONFIGS` (`:113-817`).
- **Launch-city contradiction:** `apps/marketing/src/cities.ts:120,271,371,468,559` sets `isPrimaryLaunch: true` **only** for `nyc`, gating `sf`, `la`, `chicago`, and `miami` behind `150` Stage-2 adults + `10` signed venues (`canActivateCityExpansion`, `:907-940`).
- **3-way neighborhood drift:** `apps/marketing/src/cities.ts:279,297` (`"Mission / Dolores"`, `"SoMa / Jackson Square"`) vs `apps/marketing/src/discovery.ts:171-174` (`"Mission"`, `"SoMa / Hayes Valley"`) vs `packages/core/src/cities.ts:109-112` (`"Mission District"`, `"SoMa / Yerba Buena"`, `"Hayes Valley"`).
- **Extensive NYC hardcoding:**
  - `apps/marketing/src/nyc-seed.ts:102,129,166,180`: `city: "nyc"` hardcoded in interfaces (`SeedCampaignConfig`, `SeedStarterTask`, `SeedBdDeal`, `SeedVipProspect`).
  - `apps/marketing/src/bandit.ts:350,375,400,425,450`: `city: "nyc"` hardcoded; `apps/marketing/src/cli.ts:79,107,112,250` defaults to `seed-nyc` / `nyc`.
  - `apps/marketing/src/constants.ts:196,284,316,335,389,439`, `agent-lifecycle.ts:166`, `crowdsourcing.ts:29,210`, `adapters/paid.ts:1210,1302`: hardcode `ops-nyc@ntwrk.party`, `"New York"`, NY Civil Rights Law §§ 50-51, and `VETTED_NYC_AGENCIES`.
  - `apps/marketing/src/discovery.ts:78-104,269,273,343,359,540`: defaults fallbacks to `nyc` and implements city open-data venue feeds only for NYC (`nyc_open_data`, `nys_sla`).
- **Required modular contract:** Make `@thenetwork/core` `CitySpec` the canonical base; key `apps/marketing`'s `CityMarketingOverlay` (legal/labor rules, corridors referencing canonical `CitySpec.neighborhoods`, agencies, open-data feeds) off `getCity(id)`; bridge `bd-engine.ts` contracted partner venues into `PgVenueStore` (`source: "partner"` with red-line fields); and route `discovery.ts` Luma/Eventbrite/Partiful leads into `externalEventBridge` / `World.events`.

---

## 4. LLM Calls, Trajectories, Token Efficiency & Runtime Performance

### 4.1 Complete LLM & Workers AI Call Inventory

| Call Site | Client / Model | Fires When | Prompt Size (~tok) | Pre-filter / Cache | Budget / Timeout Guards |
|---|---|---|---|---|---|
| `packages/network/src/extract.ts:120-125` (`llmUnderstand`) | `defaultLLM()` (`gpt-6-luna`), `tryChatJson` (2 att, 400 maxTok) | Every inbound msg when `opts.understand` set (`network.ts:1319,1429`); **not wired in prod `Service`** (`cost.ts:22`) | sys ~307 + usr **~963** = ~1,270 tok (`20` desires, `38` interests, `22` skills, `80` areas across 5 cities) | **Weak:** skips only `keyword`, `reportChoice`, `privateInviteTurn`, `currentDanger`, `interruptionFeedback`. No cache | Core `LLM_TIMEOUT_MS`/`LLM_DEADLINE_MS`; no dedicated cap |
| `packages/engine/src/packs/slop/extract.ts:1117-1145` (`llmSlopReader`) | `defaultLLM()`, `tryChatJson` (2 att, 500 maxTok) | Per slop onboarding msg when `o.llm?.enabled` | sys ~435 + usr ~66 = ~501 tok | Rules first, skips `declined`/`minor`, **never skips when filled** (`selfAge` always in `missing`). No cache | Core timeout/deadline |
| `packages/engine/src/reviewJudge.ts:371-378` + `packages/network/service/review-judge.ts:96-200` | `judgeLLM()` (`gpt-6-luna`), 900 maxTok, `json:true` | Per `review_judge` tick, up to `judgeCallsPerRun` per runtime (`service.ts:936`) | sys ~550–700 + serialized `ReviewPacket` | `packetSuspect` & `priorFlag` pre-filter; DB-cached by `(oppId, revision, packetHash)` in `network.review_judgments` | **Strong:** DB `review_judge_requests` cap (400/d) + `cost_ledger` USD cap ($5/d) + `judgeCallDeadlineMs` |
| `packages/engine/src/engine.ts:148-208` + `judge{,Screen,Deep,Common}.ts` + `packs/{network,slop,peon}/judge.ts` | `recommenderLLM()` (`gpt-6-luna`), `chatJson` (2 att; Pass1 2500 / Pass2 2500 / Pass3 6000 maxTok) | Daily matching run per `<app>:<city>` (Pass 2 default: top 10 pairs + 3 groups; Pass 1 & 3 off by default) | Pass1 sys ~735; Pass2 v2.1 ~923 / **v3 ~1,675**; Pass3 ~1,481; Slop ~517; Peon ~549 + JSON context (~600–2,000 tok) | Hard filters + heuristic top-K; `JudgeCache` (7d TTL) **broken by time-varying context** (P0-8) | `LLMBudget` ($2/d, 200 req/d) — **day-rollover stale-budget bug** (P0-8) |
| `packages/engine/src/relayClef.ts:237-281` + `packages/network/service/relay-endpoint.ts:42-63` (`clefRelayClassifier`) | Workers AI `@cf/cloudflare/clef-flash` (20 questions) | Every relayed text that passes deterministic `relayItem()` rules (`relay.ts:425-433`) | ~983 input tok (3,930 chars; 20-Q bank dominates) | `RELAY_RULES` first; **no prod `answers`/`record` cache wired** (`relay-endpoint.ts:55`) | 2,500 ms `AbortController` timeout; metered (`cost.ts:206`), no hard daily cap |
| `packages/platform/src/photo-screen.ts:47-81` (`WorkersAiPhotoScreen`) | Workers AI `clef-flash` (5 Qs + base64 image ≤ 4 MiB) | On photo relay consent + retry ticks (up to 5 tries) | 5 Qs + image | Size check (`ratingMaxBytes`), DB result stored on photo offer | 4,000 ms timeout; metered (`service.ts:575`) |
| `packages/engine/src/packs/slop/clef.ts:132-192` (`WorkersAIClefRater`) + `platform/src/photos.ts:47` | Workers AI `clef` (13 Qs + base64 image), `withRetry` (3 att) | On slop photo upload/delete (up to 4 photos, **sequentially** `for..of` line 154) | ~632 text tok + image/photo | `adultsOnly` + `canRatePhotos`; **re-rates all 4 photos on every single add/delete** | **No `AbortSignal` timeout passed to `clefRun`** (`clef.ts:148`); metered (`cost.ts:180`) |
| `packages/sim/src/agent/llmAgent.ts:119-180` + `llmGenerator.ts:11-35` + `judge/llmJudges.ts:46-109` | `defaultLLM()` / `judgeLLM()`, `chatJson` (3000–4000 maxTok, grow 1.5x–2x to 8000) | Sim `--llm`, `--llm-personas`, `--judge N` only (`pnpm run sim` clears keys) | Persona card + 10-msg history (~400–900 tok); rubrics ~200–400 tok | `TEMPLATE_ONLY` skips exact intents; `llmJudges.ts` has **reasoning LAST** | Core timeout/deadline; no `LLMBudget` |
| `apps/marketing/` | **None** | Verified read-only: only tracks provider labels/counters (`chatgpt`/`claude`/`gemini`/`surplus`) | 0 | N/A | N/A |

### 4.2 Quantified LLM / Token Waste & Trajectory Bugs

1. **P0 — `JudgeCache` 0% cross-day hit rate (`judgeContext.ts:43,283-385`, `judgeCommon.ts:73-80`):** Wastes **~70–85%** of daily `engine_judge` tokens. Fix: key cache on canonical member `revision`s + candidate key + pack/pass/promptVersion/model + coarse time bucket.
2. **P0 — `LLMBudget` UTC day-rollover silent outage (`service.ts:530-533,927-953`, `serve.ts:174-188`):** Refresh before `rt.tick()` and seed request count from `network.cost_ledger`.
3. **P0 — `understandPrompt` prefix-cache destruction + 80-area bloat + weak pre-filter (`extract.ts:49-84`, `network.ts:1319,1429-1436`):**
   - Places dynamic `Last question: ... Offered times: ...` (`extract.ts:73`) **before** ~930 static taxonomy tokens (`DESIRES`/`INTERESTS`/`SKILLS`/`80 AREAS` across 5 cities), destroying 10x cheaper cached input (`$0.01` vs `$0.10/M`, `llm.ts:155`).
   - Fires on `msg.reaction` tapbacks, opted-out/held/paused accounts, `stage === "new"`, already-parsed `stage === "age"` replies, and trivial `"yes"/"no"/"ok"/"1"/"2"/"block X"` replies where `classify()`/`consentOf()` already succeeded (`why !== "none"`).
   - **Fix:** Move static taxonomy + city-scoped neighborhoods (**80 → 10 areas**, saving ~180 tok) into `system` before dynamic fields (**~85% cached-input hit rate**, ~9x cheaper input) and pre-filter trivial turns (**~50–70% fewer calls**).
4. **P1 — `slop/extract.ts:1072,1138-1145` missing `chicago`/`miami` + always-on `selfAge` call:** Line `1141` unconditionally adds `"selfAge"` to `missing` even when `p.age` is already high-confidence and all other fields are complete, forcing an LLM call on 100% of turns. **Fix:** Derive markets from `CITY_IDS`; skip LLM when only `selfAge` is in `missing`, `p.age.confidence >= LLM_FILL_BELOW`, and message has no digits/age keywords (**~60–80% fewer post-onboarding slop LLM calls**).
5. **P1 — `WorkersAIClefRater` missing timeout + serial 4-photo re-rating (`clef.ts:146-161`):** No `AbortSignal` timeout passed to `clefRun`; up to 4 photos × 3 retries = 12 sequential HTTP calls; adding/deleting 1 photo re-rates all 4. **Fix:** Pass `AbortSignal.timeout(10_000)`, run `Promise.all`, and cache per-photo features in DB by `(photo_id, model)` (**50–75% fewer rating calls, up to 4x lower latency**).
6. **P1 — `relayClef` uncached in production (`relay-endpoint.ts:55`):** `clefRelayClassifier` already supports hash-keyed `answers`/`record` (`relayClef.ts:253,266`), yet `relay-endpoint.ts:55` passes no cache, hitting Workers AI (~983 input tok/call) on every `"omw"`, `"here!"`, `"running 5 min late"`. **Fix:** Attach a bounded in-memory LRU cache (e.g., 2k entries, 1 h TTL, hash-keyed with no plaintext stored).
7. **P2 — Engine `JUDGE_SYSTEM_V3` & Sim prompt hygiene (`prompts.ts:93-113`, `judgeContext.ts:386`, `llmJudges.ts:78-98`, `llmAgent.ts:141,175`):**
   - Reorder `"reasoning"` first in `packages/sim/src/judge/llmJudges.ts:78,86,92,98`.
   - Strip duplicate `configuration.hard_filters` prose (+40 tok/call) and code-enforced fields (~120–180 tok/candidate) in the next `judge-v4` bump.
   - Lower `llmAgent.ts` default `maxTokens` (`initiative` → 600, `respond` → 1000) while keeping `SIM_JSON_GROW` fallback.

### 4.3 Runtime, SQL, API & Sim Performance Bottlenecks

| Sev | Bottleneck | Exact File:Line | Measured / Quantified Impact | Concrete Fix |
|---|---|---|---|---|
| **P0** | **`VenueManager` 95.6 KB state bloat + 3x–4x `JSON.parse(JSON.stringify())` per turn** | `venue-manager.ts:398-422`, `network.ts:10166-10212`, `relay.ts:116-123`, `meetup-coord.ts:717-727`, `store.ts:255-318` | Serializes all 75 static seed venues (**97,864 bytes / 95.6 KB**) into every `<app>:<city>` `network_state` JSONB row (**1.9 MB** across 20 networks). Each sub-manager clones via `JSON.parse(JSON.stringify())`, then `ConsentNetwork.exportState()` clones the whole object again, then `PgStore.save()` serializes to JSONB, then `importState()` clones fresh DB JSON again. (`VenueManager.exportState()` alone = `0.22 ms/call`.) | Persist **deltas only** in `VenueManager.exportState()` (non-seed venues + mutated seed venues): **95.6 KB → <1 KB (>98% reduction)**. Drop redundant inner deep clones when outer serialization/DB parse already isolates memory. |
| **P1** | **Hot-path CPU: `chooseFairMidpoint`, `isVenueOpenAt`, `Intl`** | `cities.ts:1169-1257`, `venues.ts:314-336,370,423-435`, `time.ts:21-30`, `copy.ts:336` | • `chooseFairMidpoint` runs ~1,600 `normText()` regexes + barrier scans per call inside the `relax` loop. **Measured: 37.9x faster** (`593.6 ms → 15.6 ms` / 2k calls) with pre-indexed `Map`s + hoisted travel matrix.<br>• `rankVenuesForMatch` computes `startParts` (`:370`), then `isVenueOpenAt` (`:434`) recomputes `Intl.DateTimeFormat.formatToParts` + `Object.fromEntries` for every venue. **Measured: 7.8x faster** (`206.6 ms → 26.6 ms` / 15 venues × 2k; `195.9 ms → 25.1 ms` / 100 venues × 500).<br>• `copy.ts:336` allocates uncached `new Intl.DateTimeFormat(...)` every call; `time.ts:27` allocates 3 temp objects/arrays per call. | Pre-index neighborhood/alias & symmetric barrier `Map`s on `registerCity()`; compute `candidate → times[]` before `relax` loop; accept optional `parts?: LocalParts` in `isVenueOpenAt`; cache `Intl.DateTimeFormat` by `tz` in `copy.ts:336`; loop `formatToParts` in `time.ts:27`. |
| **P1** | **`PgStore.save()` full table rewrite + catalog queries on every turn** | `packages/network/src/store.ts:181-182,270-318` | Runs `DELETE FROM network.participations WHERE opportunity_id IN (ALL stateOppIds)` (`:287`) and re-inserts/upserts **every** participation, opportunity, review_item, request, and relay thread on every inbound message/tick — plus `to_regclass` (`:181,290`) and `information_schema.columns` (`:182`) on every save. | Cache `relaySchema` and `hasMembersTable` once per `PgStore` instance; persist only dirty opportunity/request/relay rows (or diff against last saved state). |
| **P1** | **`CompositeVenueProvider` & `PgVenueStore` SQL/API amplification** | `venue-provider.ts:565-659,742-796`, `venue-store.ts:340`, `network.ts:5220-5274`, `venue-manager.ts:144,204` | • `findAndRankVenues` runs `listVenues` + `rankVenuesForMatch` **twice** (`:566-567`, `:650-651`) with 20–40 serial `upsertVenue` round-trips in between (`:633`).<br>• `pickVerifiedPrimaryAndBackup` (`:742-796`) has **no `maxVerifyCalls` cap** and no `"unknown"` cooldown.<br>• `seedCuratedVenues` (`:340`) runs 75 sequential INSERTs.<br>• `network.ts:5220-5274` scans `snapshotCached().facets` O(P·F) twice and deep-clones every city venue via `listVenues`. | Batch multi-row upserts in `findAndRankVenues` and `seedCuratedVenues`; merge discovered venues in memory; cap `externalVerifyCalls` (e.g., max 5) with `"unknown"` cooldown; index `facetsByMember` on `snapshotCached()`; avoid deep-cloning read-only venues inside `VenueManager.pickForMatch()`. |
| **P2** | **Per-unit SQL fan-out in `NetworkService` runtime** | `runtime.ts:421-431,873-889,970-1006,1069-1116`, `snapshot.ts:175-261` | Every inbound SMS reloads 11 full-app tables via `loadSnapshot()` and 2 via `identities()` with **no SQL city filter** (5x excess rows in 5-city deployments), plus N+1 sequential `bookingNoticeReceipts` queries (`:425,1003`). | Push city predicate into SQL in `loadSnapshot()` and `identities()` (**~80% fewer rows transferred** — carefully preserving cross-city edges/travel presence); batch receipts via `currentBookingReceipts` (`runtime.ts:984`). |
| **P2** | **Observatory 10 s poll query amplification + `review-judge.ts` serial deletes** | `apps/observatory/src/sources/real.ts:401-468,657-658,688-715,743-764`, `review-judge.ts:257-261` | Every 10 s poll scans `network.messages` **4 times** (including unbounded `body` reads at `:757`), queries `network.events` **7 times**, queries `stateRow()` **2 times**, re-queries `platform.venues`, runs correlated subqueries on `parts`/`reviews`, and issues 2 SQL queries per teen opp + full `loadSnapshot()` in `minorContacts()`. `review-judge.ts:257-261` runs up to 500 sequential `DELETE`s. | Incremental `ts > lastSeenTs` watermark for messages; convert correlated subqueries to `LEFT JOIN LATERAL`/CTEs; cache/batch teen roster checks; single batched `DELETE` in `review-judge.ts`. |
| **P2** | **Engine `judgeContext` / `scoring` & `MeetupCoordinator` micro-allocations** | `judgeContext.ts:109-124,347,363`, `scoring.ts:131`, `meetup-coord.ts:392-406,523,586` | `judgeContext` linearly scans `snap.members`/`facets`/`edges`/`w.feedback` instead of `World` maps (`w.feedbackByPair` exists at `world.ts:108`). `MeetupCoordinator.passesSafety()` allocates **2 fresh `new LeakGuard(...)` instances per recipient** inside loops. | Use `World` maps + `facetById`; instantiate `rawGuard`/`outGuard` once per `handleInbound`/`flushGroupDigest`. |
| **P0 (DevEx / CI)** | **`pnpm run sim` ~64 min (3,833 s) serial runtime** | `scripts/sim.ts:99`, `scripts/sim/matching.ts:503,512-515`, `scripts/sim/scale.ts:93-94,158-170` | `matching` = **2,926.5 s (76%)**, `network` = **536.4 s (14%)**, `friends` = **176.0 s (5%)**, `slop` = **95.8 s (2.5%)**, other 12 blocks = ~99 s. All 16 blocks and 4 matching packs run serially. `scale.ts` `sampleProfile` evaluates **20M brute-force pairs per N=100k rung** even though `ORACLE_UP_TO = 20_000`. `matching.ts:512-515` constructs 3 `World` instances for the same input. | Add `--jobs N` parallel block/pack execution in `scripts/sim.ts` (3.5x–5x lossless speedup); compute `w.match.value` lazily in `scale.ts` after cheap `inSearchWindow` + `segmentReaches` pruning; parallelize independent seed loops; reuse `World` in `matching.ts`. Target: **~64 min → ~10–15 min** with byte-identical gates/fingerprints. |

---

## 5. Global Human Experience, Generalization & Sim/Test Fidelity

### 5.1 Global City-by-City Experience Gaps

1. **NYC Copy Leaks Across Active Flows:**
   - `packages/network/service/service.ts:3041`: asks for only `"New York or San Francisco / Bay Area"`.
   - `packages/platform/src/apps.ts:75`: `friends` brand description says `"in New York City"`.
   - `packages/network/src/copy.ts:96,97,100,105,106`, `calendar-invite.ts:12`, `monthly-gathering-delivery.ts:53`: hardcode `"New York time"`.
   - `packages/network/src/classify.ts:679`: asks `"Which NYC neighborhood..."`.
   - `solo-concierge.ts:109` & `import-public-events.ts:78`: serve only NYC Parks listings.
2. **Non-Launch Cities Are a Dead End:**
   - `accounts.ts:81-86,162-163` rejects non-launch `homeCity` (Austin, Seattle, London, etc.) with HTTP 400; `service.ts:373-374,3040-3043` traps text joiners in an `AskForHome` loop.
   - **Target Experience:** Accept any valid city into a `waitlist` / `single_player` state that records local demand (feeding `canActivateCityExpansion`), unlocks single-player concierge + cross-city digital intros (`WarmEmail`/`ScheduledVideo` for jobs, deals, mentorship, investors), and automatically enables in-person matching when the member logs `travelPresence` in an active city.
3. **Relocation & Travel Presence Friction:**
   - `service.ts:1873` rejects changing `homeCity` between launch cities with `"runtime_change_unsupported"`.
   - `packages/network/service/travel-presence.ts:10-39,53-70` requires exact `"I will be in <5 hardcoded cities> from YYYY-MM-DD until YYYY-MM-DD"`, rejects natural dates, breaks on City #6+, and writes `network.presence` for only **one** `app_id`.
4. **Extracting Wants & Red Lines Without Interrogating Members:**
   - Upgrade `extract.ts` and `classify.ts` to `ALL_DESIRES`/`ALL_INTERESTS`/`ALL_SKILLS` plus passive extraction of `spend:*`, dietary/alcohol/accessibility/noise red lines, `maxTravelMinutes`, `lang_native:`/`lang_learn:`, `stage:*`, and `transition:*`.
   - Wire `classifyEmptyStateRemedy` (`humanVector.ts:960-1083`) into `network.ts:8210-8226` so sparse profiles receive immediate single-player value (public events, free guilds, one crisp clarifying question) instead of dead ends.
   - Use **just-in-time lazy asks**: infer passively first; ask dietary/budget only on first venue booking or pivot reason (`rejectAndPivot`); ask work email lazily on first double-opt-in work intro.
5. **Generalizing Toward "Anything People Want" While Protecting Launch Scope & Teens:**
   - Keep `MatchLane` (`spec/matchLane.md`) as the proved formal authority for pair utility/parity/offset, app-lane eligibility (`laneOffered`), and teen admission (`teenFriendLane`/`teenFriendCategory`/`teenGenerator`).
   - Add explicit `deliveryMode: "in_person_venue" | "digital_intro" | "hybrid_choice" | "event_anchor"` + `crossCityAllowed` to `ConnectionOntologySpec` (`vocabulary.ts:52-151`):
     - `work_hiring`, `step_ahead_mentorship`, `patronage_sponsorship`, `executive_peer_council` → default `"digital_intro"` (`chooseWorkIntroChannel`, `crossCityAllowed: true`), optional `"in_person_venue"` locally.
     - `dating`, `friendship`, `intellectual_salon`, `craft_maker_guild`, `habit_accountability`, `creative_cocreation`, `language_tandem`, `parent_support_adult`, `life_transition_peer`, `civic_action_coalition` → `"in_person_venue"` via one unified `VenueManager` + `PgVenueStore` pipeline, or `"event_anchor"` via `externalEventBridge`.
     - `local_mutual_aid` → bounded-help rules (`spec/privateHomeHelpVenue.md`).
   - Keep every extended `ConnectionOntologyType` fail-closed `adultOnly: true` (`vocabulary.ts:62`) so generalizing adult wants never touches `teenFriendAgeRule`, `teenStop`, or `peonCapitalAllowed`.
6. **Safe Cross-App Transfer vs Strict Isolation Walls:**
   - **Current gap:** `SHAREABLE_FIELDS` (`accounts.ts:59`) lists `["first_name", "city", "age_band", "interests"]`, yet `service.ts:3158` requests only `["interests"]`, and `applyBaseProfileGrants` (`base-profile-share.ts:32-46`) copies only `kind='interest'` facets while stripping all `:` tags (`:42`).
   - **Safe to transfer (under explicit person-level grant):** `homeCity` + `neighborhood` + `maxTravelMinutes`, `travel_presence`, `venue_logistics` (visited/rejected venue IDs, dietary/accessibility/alcohol/noise red lines, `spendComfortTier`), `interests`, `languages`, and `work_email` (between `peon` and `ntwrk` work lanes).
   - **Strict non-negotiable isolation walls (preserve and test):**
     1. `slop` appearance ratings (`appearance:*`, `aestheticReadAllowed` `humanVector.ts:29-32`, `physDimensionWeight` in `status.ts`).
     2. `peon` NYC LL 144 firewall (`peonCapitalAllowed` `humanVector.ts:34-36`, `PEON_TAG.proxy` strip `:448`, zeroed econ/cultural/publicity `:810-823`, RLS blocking `external_prospects`/`external_sourcing_tickets`/`external_prospect_suppressions`).
     3. Minor/teen walls (ages 13–17 strictly confined to `friends` and `ntwrk:Friend`, zero dating/work/external-sourcing/relay, `teenStop` exact parity).
     4. `agent_private` and `SensitiveCategory` facets (`core/types.ts:39,55`), per-app opt-outs (`leave <domain>`), and `cross_app_leak` non-disclosure.

### 5.2 Simulation & Test Fidelity Gaps

1. **`fiveCitySuite.ts` shortcuts diverge from live production orchestration:**
   - **S1–S4, S8, S11, S15** run with `maxNewPerDay: 0` (matching engine OFF) and manually call `h.net.venues.pickForMatch` + `h.net.meetups.registerMeetup`. In `docs/results/2026-11-26-five-city-venues.md:47,73`, S1's manual call picked `Cellarmaker Brewing Co.` while `ConsentNetwork` booked `Mission Dolores Park` — proving the test bypassed the live path.
   - **S6, S7, S9, S10, S12** instantiate standalone `new VenueManager()` / `new MeetupCoordinator(mockHost)` with synthetic `ConversationTurn[]` arrays; zero coverage of `PgVenueStore`, `CompositeVenueProvider`, or `ConsentNetwork` inbound routing.
   - **S15 (`fiveCitySuite.ts:1879`)** loops `for (const c of soloVenues)` without asserting `soloVenues.length > 0` (vacuous pass if empty) and tests teen helpers in isolation rather than running a 5-city teen `friends` world with `teenStop=false` vs `true`.
   - **S16 (`fiveCitySuite.ts:1972-1991`)** manually pushes `m.leftApps.push("slop")` and injects `keyword: "STOP"` directly into `hSlop`, bypassing `packages/platform/src/consent.ts`.
2. **Zero `pnpm run sim` coverage of `0098` systems:** Zero references across `scripts/sim/` and `packages/sim/` to `externalEvents`, `externalMatchmaker`, `TopOneSuggestionFlow`, `venue_concurrent_holds`, or `matchmaker_personas`.
3. **Multi-strata quality metrics disconnected from sim gates:** `packages/sim/src/{persona,oracle,judge/metrics}.ts` compute `qualityBreakdown` (`statusMismatchRate`, `griftExposureCount`, `topDecileOverloadShare`, `groupLeastMiseryMean`), but no `scripts/sim/` block tracks or gates them.
4. **7 Prioritized Missing Real-World Unhappy-Path Scenarios:**
   1. **Cross-city traveler with venue + timezone switch** through `ConsentNetwork` + `VenueManager` (existing `nyc-to-sf-traveler.json` uses `StubNetwork` with no venues/TZ/budget).
   2. **Mid-journey red-line / budget mutation** (member becomes sober, drops budget `$$$` → `$`, or adds severe allergen mid-conversation → live re-ranking + `venueRedLinesEligible` check).
   3. **Two-way Top-1 venue rejection / pivot exhaustion loop** (`0 → 1 → 2 → 3` pivots via `TopOneSuggestionFlow` inside `ConsentNetwork` → `ask_user_spot_or_pause`).
   4. **External event + dual-persona matchmaker + anchor failover sim block** (18+ RSVP gating, anchor no-show failover `promote_co_anchor`/`cancel_cleanly`, persona kill-switch failover, and `peon` firewall).
   5. **Concurrent venue capacity & active-arrival partial flake** (`venue_concurrent_holds` walk-in cap + 1-of-4 flake at `T-15m` during active arrival digest).
   6. **LLM malformed-output & fallback resilience** (hallucinated private address or unknown venue ID, canary echo in draft, invalid JSON, Surplus 429/timeout → OpenAI fallback telemetry).
   7. **Full 5-city `apps/marketing` → `prepare_signup` → join → first-match E2E** (current `five-cities.e2e.test.ts` stops at signup form prefill for Chicago/Miami only).

### 5.3 Observatory Visibility Gaps & Hardcoded NYC Remnants

- **Seeded 5-city tables never read by Observatory:** `network.meetup_arrivals`, `network.venue_visits`, `network.venue_rejections`, and `network.work_intros` are seeded and granted to `network_observatory_*`, yet `RealSource`, `server.ts`, and `web/` never query or display them.
- **Zero `0098` visibility:** `platform.external_events`, `platform.external_event_rsvps`, `platform.matchmaker_personas`, and `network.venue_concurrent_holds` have no Observatory queries, endpoints, or grants (`external_prospects`, `external_sourcing_tickets`, and `external_prospect_suppressions` must remain strictly blocked from `network_observatory_peon` per `crossAppScoreFirewall`).
- **Zero `nextgen-matching` (`1974d9daa`) telemetry:** `apps/observatory/src/engineCapture.ts` and `types.ts:206-229` omit Leiden communities/brokerage, Sinkhorn `p80ShadowPrice`, 6D `StatusBelief`, and 17-type `HumanVector` ontology diagnostics.
- **Unused fetched state:** `store.citiesList` (`apps/observatory/web/store.ts:322,750`) is fetched via `GET /api/cities` on every load and app-switch and **never read anywhere in `web/`** (`main.tsx:339` uses static `LAUNCH_CITY_IDS`).
- **Hardcoded NYC remnants:**
  - `apps/observatory/src/events.ts:173`: hardcodes `"(New York time)"` despite `timeFormatterFor(p.city)` at `:127`.
  - `apps/observatory/src/sources/game.ts:222`: `city: "all"` pins `ConsentNetwork` to `engine: { cities: ["nyc"] }`.
  - `apps/observatory/src/sources/real.ts:1304`: `shadowRun` falls back to `["sf", "nyc"]` instead of `CITY_IDS`.
  - `apps/observatory/src/gatherings.ts:29` & `web/gatherings.tsx:15,26`: hardcode `row.city !== "nyc"`, `CITY_TZ.nyc`, and `"New York window"`.
  - `apps/observatory/src/server.ts:1095`, `src/types.ts:352,678`, `web/map.ts:242`, `web/review.tsx:485`: NYC defaults and `LEGACY_NYC_VENUES` fallback.

---

## 6. Draft Pass 2 Implementation Plan (For Red-Team Critique)

This draft prioritizes unblocking `develop`, fixing every safety/correctness bug, removing duplication, reclaiming LLM/runtime performance, and closing critical integration and sim gaps. It is structured into three tiers for `@red-team-critic` to challenge, trim, and sequence into disjoint-ownership swarm waves.

### Workstream A (P0 — Immediate Unblock, Safety, Schema & Core Correctness)
1. **Fix Observatory TS & runtime breakage:** `apps/observatory/db/seed.ts` (object `groupVenueRubricScore`, snake_case enums, `ageMin ?? 0`, all 12 `0098` columns), `apps/observatory/web/map.ts:104` (`"active"`), `apps/observatory/test/five-cities.integration.test.ts:91,198`.
2. **Fix teen brewery safety bug & `seedVenue()` `ageMin` bug:** `packages/network/src/geo.ts:228,350` (`v.allAges === true && !v.isAlcoholCentric`), `packages/core/src/cities.ts:65-84` (`ageMin: v.ageMin ?? 0`), plus resolve `five-cities-venues-work-intro.test.ts:254` teen group ranking default.
3. **Fix `PgVenueStore` & reconcile migrations `0098`/`0099`:** Wire all 12 `0098` venue columns + `safetyScore`/`transitScore` in `packages/platform/src/venue-store.ts`; eliminate duplicate DDL in `0099` (or add `0100` upgrade-safe delta — red-team decision); add `UNIQUE (app_id, opportunity_id, member_id)` + `state` `CHECK` on `meetup_arrivals`; update `meetup-venues-external.pg.test.ts:76`.
4. **Fix live `ConsentNetwork` routing & preference bugs:**
   - Fix `heavy_drinker` → `nonDrinker` (`network.ts:10531`).
   - Collapse all 3 venue-pref extractors into one helper bridging `spend:*`/`hv:spend:*`/`budget:*` + all 13 red lines + visited/rejected history, and route `pickVenueWithRedLines` and `checkBackupPivot` through `this.venues` (`VenueManager`).
   - Consolidate `MeetupCoordinator` onto `generated/meetupCoordination.ts` (add `panicTriggered` check + `venue_full` pivot without quarantine; remove dead helpers on `ConsentNetwork`).
   - Expand `isWorkIntro` (`network.ts:4789-4791`) to `Intro`/`Mentor`/`Invest` with proper non-cofounder copy and wire `workIntroEmailOf` in `NetworkService`.
   - Fix `service.ts:3041` 5-city onboarding prompt and `Clock` `Date.now()` violations in `venue-store.ts`/`venue-provider.ts`.
5. **Fix P0 LLM bugs:**
   - Fix `JudgeCache` cross-day key drift (`judgeContext.ts` / `judgeCommon.ts`).
   - Fix `LLMBudget` UTC day-rollover refresh order (`service.ts:927-953` / `serve.ts:174-188`) + DB request count seeding.

### Workstream B (P1 — Spec Unification, LLM/Runtime Performance & Cross-System Wiring)
1. **Deduplicate 3 Vibestack spec pairs & resync:** Merge `meetupArrival` → `meetupCoordination` (keeping `allMet`, scoping `canAttendEventOrCoattend` to adult/external events), `cityTravel` → `venueSelection` (keeping `>= 0` clamp), and `encounterFollowup` ↔ `meetupCoordination` (pick one next-morning hour, preserve `isWorkIntro`). Clean `NoShowAction` and `0098`/model enum/TTL drifts. Run `pnpm run spec:sync`, `pnpm run check`, and `pnpm run spec:check-generated`.
2. **State bloat, hot-path CPU, and SQL/API performance:**
   - Delta-only `VenueManager.exportState()` (95.6 KB → <1 KB) + remove redundant `JSON.parse(JSON.stringify())` layers across `network.ts`, `relay.ts`, `meetup-coord.ts`, `store.ts`.
   - Pre-index `cities.ts` neighborhoods & barriers + hoist `startParts` into `isVenueOpenAt` (`venues.ts`) + cache `Intl.DateTimeFormat` (`copy.ts:336`) + loop `formatToParts` (`time.ts:27`).
   - Cache schema checks + dirty-row persistence in `PgStore.save()` (`store.ts`).
   - SQL city pushdown in `loadSnapshot()` / `identities()` + batched receipts in `runtime.ts` (preserving cross-city edges/travel presence).
   - Batch upserts + single query/rank + `maxVerifyCalls` cap in `CompositeVenueProvider` / `PgVenueStore`.
3. **LLM prompt/cache/reliability wins:**
   - Reorder `understandPrompt` static taxonomy into `system` with city-scoped neighborhoods (80 → 10) + pre-filter trivial turns (`extract.ts`, `network.ts:1429`).
   - Fix `slop/extract.ts:1072` (all 5 cities) and `:1141` (stop calling LLM on `selfAge` alone when filled).
   - Add `AbortSignal.timeout(10_000)` + `Promise.all` + per-photo feature caching in `clef.ts`; attach bounded LRU cache to `relay-endpoint.ts`; reorder `"reasoning"` first in `packages/sim/src/judge/llmJudges.ts`.
4. **Wire `nextgen-matching`, `CitySpec`, and `0098` seams:**
   - Upgrade `extract.ts`/`classify.ts` to `ALL_DESIRES`/`ALL_INTERESTS`/`ALL_SKILLS` + passive `spend:*`/red-line/ontology tags; wire `classifyEmptyStateRemedy` into `network.ts:8210-8226`.
   - Fix `spatialIndex.ts:279` (`findNeighborhood(p.city, area)`), `humanVector.ts:722-724` (`latLonToHex`, `CitySpec.primaryMode`), and unify `vocabulary.ts:423-429` with `CitySpec.neighborhoods`.
   - Wire `PgVenueStore` + `CompositeVenueProvider` (or clean adapter flag) and `externalEvents`/`externalMatchmaker`/`TopOneSuggestionFlow` into `NetworkService`.
   - Refactor `apps/marketing` to consume `@thenetwork/core` `CitySpec`, remove NYC-only hardcoding, align 5 launch cities, and bridge partner venues/events.

### Workstream C (P2 — Global Experience, Sim Fidelity/Speed & Observatory Hardening)
1. **Lossless `pnpm run sim` speedup (64 min → ~10–15 min):** Add `--jobs N` parallel execution in `scripts/sim.ts`, eliminate O(N) brute-force inside `scripts/sim/scale.ts:93-94,158-170`, reuse `World` in `matching.ts:512-515`.
2. **Raise sim & E2E fidelity:**
   - Fix `fiveCitySuite.ts` shortcuts (enable real engine/routing where bypassed, non-vacuous S15 + 5-city teen `teenStop` parity, route S16 through `consent.ts`).
   - Add missing scenarios: cross-city traveler with venue+TZ, mid-journey red-line/budget change, Top-1 pivot exhaustion, `0098` external event + matchmaker failover + `peon` firewall block, concurrent holds + partial flake, LLM malformed-output/fallback resilience, and 5-city marketing-to-match E2E.
   - Surface `qualityBreakdown` metrics from multi-strata worlds as tracked sim metrics.
3. **Global experience & cross-app sharing:**
   - Non-launch city waitlist + single-player + cross-city digital intro support; allow launch-city relocation; generalize `travel-presence.ts` to natural dates, City #6+, and cross-app presence; expand safe cross-app share grants (`venue_logistics`, `travel_presence`, `work_email`) while proving zero leakage across `slop`, `peon`, minor, and `agent_private` walls; add `deliveryMode` to `ConnectionOntologySpec`.
   - Clean remaining NYC copy leaks (`apps.ts:75`, `copy.ts`, `calendar-invite.ts`, `monthly-gathering-delivery.ts`, `classify.ts:679`, Observatory NYC remnants).
4. **Observatory query optimization & telemetry:**
   - Cut 4x `messages` / 7x `events` poll scans in `apps/observatory/src/sources/real.ts`, batch `review-judge.ts:257-261` deletes, remove unused `store.citiesList` fetch (or wire it into city picker), and expose read-only panels/endpoints for 5-city tables (`meetup_arrivals`, `venue_visits`, `venue_rejections`, `work_intros`), `0098` tables (strictly respecting `peon` firewall), and `nextgen-matching` telemetry (keeping within approved Observatory scope).

### Validation & Acceptance Targets Before Merge
- `pnpm run typecheck` = **0 errors** (down from 8).
- `pnpm run spec:check-generated`, `pnpm run check`, `pnpm run quint:check` = **100% PASS**.
- `REQUIRE_PG=1 pnpm run security` = **11/11 files, 100% PASS**.
- `pnpm run test:integration` & `pnpm run test:e2e` = **100% PASS** (including all 4 five-city suites and `meetup-venues-external.pg.test.ts`).
- `pnpm run sim` (including `five-city`, `network` 123/123, `friends` 67/67, `slop` 57/57, `peon` 30/30, `matching` 112/112, and all 9 teen gates = **0**) = **100% PASS** with zero regressions.
- Measured benchmarks committed in `docs/results/`: `VenueManager.exportState()` size (**95.6 KB → <1 KB**), `chooseFairMidpoint` (**≥30x** speedup), `isVenueOpenAt` (**≥7x** speedup), `JudgeCache` cross-day hit rate (**0% → >70%**), and `pnpm run sim` wall time (**~64 min → ≤15 min**).
