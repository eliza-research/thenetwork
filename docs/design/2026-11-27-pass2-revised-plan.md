# Pass 2 Red-Team Critique & Revised Swarm Implementation Plan

**Date:** 2026-11-27
**Target Branch:** `develop` @ `0239b70c3`
**Reviewed Draft:** `docs/design/2026-11-27-pass2-deep-audit.md`
**Author:** `@red-team-critic` (Principal Architect & Red-Team Reviewer)
**Principles Applied (`AGENTS.md`):** Laziness Protocol, Subtract Before You Add, One Path, Launch Scope, Teen Gates = 0, No Unapproved UI Style/Feature Changes, Vibestack Spec Discipline (`pnpm run accept` requires owner sign-off), Explain the Number, Sequence Work into Verifiable Units.

---

## 1. Executive Red-Team Verdict

The draft audit (`docs/design/2026-11-27-pass2-deep-audit.md`) accurately diagnoses why `develop` (`0239b70c3`) is red and surfaces genuine P0 safety, schema, budget, and performance defects. However, executing its draft Workstreams A–C as written would **break existing tests, weaken verified invariants, violate `AGENTS.md` launch-scope and UI rules, and create severe multi-file merge/regression hazards**.

Specifically, forensic spot-checks caught **9 critical flaws** in the draft plan:

1. **Changing `passCacheKey` (`JudgeCache`) to drop `request.messages` breaks `packages/engine/test/judge-cache.integration.test.ts:45-69` and violates `spec/judgmentAttempt.md`.** That test explicitly asserts that advancing `now` by `1 DAY` changes `requests[1].messages` and **must** cause a cache miss (`stats.calls === 1`). Coarsening timestamps inside `buildDeepContext` alters live `gpt-6-luna` judge prompts and belongs in a dedicated, live-eval-backed `judge-v4` PR — not an unverified hotfix.
2. **Editing `0099_five_cities_venues_followups.sql` in place violates append-only migration semantics (`packages/db/migrate.ts:14-15,70-75`).** Because `0099` is already merged to `origin/develop` (`repeatable: false`), any database that applied `0099` will never re-run an edited `0099`. All schema hardening must go into a new idempotent `packages/db/migrations/0100_venues_and_arrivals_hardening.sql`.
3. **Misdiagnosing `five-cities-venues-work-intro.test.ts:254` would break fail-closed teen safety.** `rankVenuesForMatch` (`packages/core/src/venues.ts:377`) defaults `teenFriendAllowed = false` **by design** (enforced by `packages/core/src/generated/venueSelection.ts:88` and asserted by `packages/network/test/meetup-external-matchmaking.integration.test.ts:360`). Changing the default to `true` would weaken teen safety and break `0098` tests. The bug is purely that `seedVenue()` omits `ageMin: 0` and `five-cities-venues-work-intro.test.ts:253` forgot `teenFriendAllowed: true`.
4. **Deleting `spec/meetupArrival.md`, `spec/cityTravel.md`, and `spec/encounterFollowup.md` triggers unnecessary `spec/lock.json` churn and owner `pnpm run accept` gating.** Fixing P0-6 (`MeetupCoordinator` panic halt + `venue_full` pivot) requires **zero spec edits** because `packages/core/src/generated/meetupCoordination.ts` is already generated, proved, and accepted in `spec/lock.json`. Deleting spec files touches `spec/product/stories.md`, `spec/product/README.md`, `spec/models/README.md`, `packages/core/src/index.ts`, and `spec/lock.json` — defer deletion to a dedicated owner-approved Spec-Consolidation PR.
5. **Blindly expanding `isWorkIntro` (`network.ts:4789-4791`), ripping out NYC legacy `VENUES`, or replacing `hood(area)` in `spatialIndex.ts:279` risks breaking pinned sim gates (`network` 123/123, `friends` 67/67, `matching` 112/112, `evals` 40/40).**
   - `isWorkIntro` strips `timeOptions` in `probeCopy` (`network.ts:4798`) and skips `meetingSpot`; expanding it blindly to `Intro`/`Mentor`/`Invest` alters every `ntwrk` sim run on NYC seeds 1–3.
   - `network.ts:5237` intentionally keeps legacy NYC `VENUES` (72 venues) for red-line-free NYC reveals so pinned NYC sim runs stay stable.
   - `spatialIndex.ts:279` replacing `hood(area)` with `findNeighborhood(p.city, area)` drops NYC neighborhoods present in `packs/friends/geo.ts` but absent from `CitySpec.neighborhoods` (e.g. Astoria, Harlem). It must try `findNeighborhood(p.city, area)` **first** and fall back to `p.city === "nyc" ? hood(area) : undefined` then `zipForArea`.
6. **`PgStore.save()` dirty-row tracking (`store.ts:270-318`) is a split-brain data-corruption hazard.** Multi-replica handoffs under advisory locks and out-of-band `/review` writes make in-memory diffing unsafe. Keep `PgStore.save()` transactional upserts intact; take the **zero-risk 98% payload win** via delta-only `VenueManager.exportState()` (95.6 KB → <1 KB) + caching the two static schema checks (`relaySchema`, `hasMembersTable`).
7. **`loadSnapshot()` SQL city pushdown (`snapshot.ts:175-217`) risks dropping visiting travelers, cross-city `person_blocks`, and `audit engine-pipeline-17` determinism.** `inCity` is `home_city = scope.city UNION active temporary presence in scope.city`. Defer P2 SQL pushdown until measured at multi-thousand-member scale.
8. **Skipping brute-force checks in `scripts/sim/scale.ts:93-94,158-170` defeats bound-soundness and mask-refusal verification.** `all` and `refusedBy` verify lines 157–170 (no missed candidate outside `window` above `unseenBound`, and every `segment_unreachable`/`mask_refused` candidate is genuinely refused by `pairReason`). Never weaken verification to chase speed; achieve **4x–5x lossless speedup (64 min → ~12–15 min)** via `--jobs N` parallel child-process execution in `scripts/sim.ts` (including splitting `matching` across its existing `--matching-pack` flags).
9. **New Observatory UI panels, non-launch city waitlists, cross-app sharing expansion, `NetworkService` hot-path `PgVenueStore`/`externalEvents`/`externalMatchmaker` wiring, and `apps/marketing` BD/event bridges violate `AGENTS.md` Launch Scope and No-Unapproved-UI-Change rules** (and carry massive blast radius). Cut/defer them to Pass 3 so Pass 2 is surgical, 100% green, and zero-regret.

### Additional Missed Bugs Discovered During Red-Team Spot-Checks
- **`network.ts:5265-5271` teen backup venue omission:** `reveal()` calls `this.venues.pickForMatch(...)` for backup venues without passing `teenFriendAllowed: o.teenRuleAt !== undefined`, leaving teen friend meetups with `backupVenueId = undefined` (and using `memberVenueRankPrefs`, which ignores all 13 red lines).
- **`network.ts:10576` hardcoded `tz = CITY_TZ.nyc` default on `venuePassesRedLines`:** Non-NYC callers omitting `tz` evaluate `isAfterDark` in Eastern Time (treating 4 PM LA as after-dark). Default to `this.cityTz()`.
- **`meetup-coord.ts:487` vs teen relay boundary:** `MeetupCoordinator` arrival relays (`:520-540`) must gate on `evaluateArrivalRelaySafe` (`anyMinorInEvent` + `panicTriggered`) from `generated/meetupCoordination.ts`, ensuring minors never participate in member-to-member arrival relays.
- **`VenueManager.importState()` backward compatibility:** Switching `exportState()` to delta-only must still cleanly import legacy 75-venue full snapshots persisted in existing `network_state` rows (hydrate `ALL_SEED_VENUES` first, then overlay `state.venues`).
- **`apps/observatory/db/seed.ts:67-112` raw venue INSERT duplication:** Duplicates `PgVenueStore.seedCuratedVenues` SQL and omitted all 12 `0098` columns + `ageMin ?? 0`; consolidate onto `PgVenueStore.seedCuratedVenues` (One Path) or shared column mapper.
- **`slop/extract.ts:1141` `selfAge` skip guard safety:** Skipping LLM when only `selfAge` is in `missing` must STILL invoke the LLM if the message contains digits or age-related words (`/\b(\d{2}|age|years?\s*old|turned|turning|birthday|born)\b/i`), preserving minor-age detection when a member later discloses a younger age.

---

## 2. Critique Table (Draft Proposal → Verdict → Revision)

| Draft Item | Draft Proposal | Red-Team Verdict | Concrete Pass 2 Revision |
|---|---|---|---|
| **P0-1** (`geo.ts:228,350`) | Enforce `v.allAges === true && !v.isAlcoholCentric` for teen spots/plans | **ACCEPT (P0)** | Ship in Wave 2A + regression test asserting breweries (`sf-biergarten-hayes`, `sf-cellarmaker-mission`, `nyc-threes-brewing`) are rejected for teens in all 5 cities. |
| **P0-2** (`network.ts:10531`) | Remove `"heavy_drinker"` from `nonDrinker` list | **ACCEPT (P0)** | Ship in Wave 2A + unit test proving `heavy_drinker` → `nonDrinker: false`. |
| **P0-3** (`cities.ts`, `venues.ts:377`, test `:254`) | Set `ageMin: v.ageMin ?? 0` in `seedVenue()`; fix test `:254` *or* change `venues.ts:377` default | **REVISE (P0)** | Set `ageMin: v.ageMin ?? 0` in `cities.ts:65-84`, coalesce `v.ageMin ?? 0` in `venue-store.ts` & `seed.ts`. **KEEP `venues.ts:377` fail-closed `teenFriendAllowed = false`**; fix `five-cities-venues-work-intro.test.ts:253` to pass `teenFriendAllowed: true`. |
| **P0-4** (`venue-store.ts`, `seed.ts`) | Wire all 12 `0098` red-line columns + `safetyScore`/`transitScore` | **ACCEPT (P0)** | Ship in Wave 2C (`PgVenueStore`) & Wave 2D (`seed.ts` reusing `PgVenueStore.seedCuratedVenues` where possible) + round-trip assertions in `venues-five-cities.pg.test.ts`. |
| **P0-5** (`0098`/`0099` SQL) | Edit `0099` in place OR add `0100`; update `meetup-venues-external.pg.test.ts:76` | **REVISE (P0)** | **Never edit merged `0098`/`0099`.** Add idempotent `0100_venues_and_arrivals_hardening.sql` (additive `ADD COLUMN IF NOT EXISTS` for upgrade safety, normalize `'New York City'`, dedupe + `UNIQUE (app_id, opportunity_id, member_id)` + `state CHECK` on `meetup_arrivals`). Update `meetup-venues-external.pg.test.ts:68,76` for 20 networks. |
| **P0-6** (`meetup-coord.ts`, `network.ts:10457-10514`) | Consolidate `MeetupCoordinator` onto `generated/meetupCoordination.ts` (panic + `venue_full`); lookup via `this.venues.getVenue` | **ACCEPT (P0)** | Ship in Wave 2A using **already-generated** `generated/meetupCoordination.ts` (**zero spec edits**). Enforce `evaluateArrivalRelaySafe` (`anyMinorInEvent` + `panicTriggered`) on relays, parse & pivot on `venue_full` without quarantine, delete dead `network.ts` duplicates. |
| **P0-7** (`isWorkIntro`, `workIntroChannel.md`) | Expand `isWorkIntro` to `Intro`/`Mentor`/`Invest`; wire `workIntroEmailOf`; extend `spec/workIntroChannel.md` to N-party | **REVISE (P1/SPLIT)** | **Do NOT blindly widen `isWorkIntro` across legacy `ntwrk` lanes without checking `network` 123/123!** Gate `ntwrk` digital work-intro routing on explicit `o.seat \|\| o.lane === "Cofounder" \|\| (app === "peon" && category === "professional") \|\| workOntologyTag(o)` (fixing `1974d9daa` ontology intros without perturbing legacy NYC `network` sim). Fix non-cofounder copy + wire `workIntroEmailOf` in `NetworkService`. **Defer** N-party `spec/workIntroChannel.md` edit + email-sender adapter to Pass 3. |
| **P0-8a** (`JudgeCache` key) | Replace `messages` hash with member `revision`s in `passCacheKey` | **REJECT / DEFER** | Breaks `judge-cache.integration.test.ts:68-69` and weakens `spec/judgmentAttempt.md` exact-prompt binding. Defer time-bucket coarsening inside `buildDeepContext` to a dedicated `judge-v4` PR with live `gpt-6-luna` eval evidence. |
| **P0-8b** (`LLMBudget` rollover) | Refresh `engineBudgets` before `rt.tick()` + seed request count from `cost_ledger` | **ACCEPT (P0)** | Ship in Wave 2A (`service.ts:927-953`, `serve.ts:174-188`) + unit test simulating Day D exhaustion → Day D+1 tick rollover. |
| **P0-9** (Observatory 3 files) | Fix `seed.ts`, `map.ts:104`, `five-cities.integration.test.ts:91,198` | **ACCEPT (P0)** | Ship in Wave 2D; fixes all 8 TS errors, broken red map pins, `RangeError: NaN`, and `afterAll` crash. |
| **P0-10** (4 invariants) | Fix `service.ts:3041` 5-city prompt, `slop/extract.ts:1072` 5 markets, `Date.now()` in `venue-store`/`venue-provider`, `llmJudges.ts` reasoning-first | **ACCEPT (P0/P1)** | Ship across Waves 2A, 2B, 2C, 3A. |
| **3.1** (Delete 3 spec files) | Delete `meetupArrival.md`, `cityTravel.md`, `encounterFollowup.md` and run `spec:sync` + `accept` | **DEFER (Scope/Policy)** | Violates Laziness Protocol & requires owner `pnpm run accept` sign-off while updating 4 doc indices + `spec/lock.json`. Runtime safety bugs (P0-6) are fixed without touching `spec/`. Keep optional Track S clearly separated for an owner-requested spec cleanup PR. |
| **3.2** (3 venue extractors + NYC legacy `VENUES`) | Collapse 3 preference extractors; route all NYC reveals through `VenueManager` | **REVISE (P1)** | **Collapse the 3 extractors** into one helper (all 13 red lines + `spend:*`/`hv:spend:*`/`budget:*` + visited/rejected history), fix `network.ts:5265` teen backup flag & `:10576` default `tz`, and route `pickVenueWithRedLines` through `this.venues`. **KEEP** the red-line-free NYC `geo.ts` fallback in `reveal()` (`network.ts:5237`) so pinned NYC `network` 123/123 & `friends` 67/67 gates do not regress. |
| **3.3** (`extract.ts`/`classify.ts` 17-type vocab + `classifyEmptyStateRemedy`) | Upgrade `extract.ts`/`classify.ts` to `ALL_DESIRES`/`hv:*`/red-line tags; wire `classifyEmptyStateRemedy` | **DEFER (High Sim Risk)** | `extract.ts` isn't even wired in prod `Service`; changing `classify.ts` regexes risks `evals` 40/40 & `network` 123/123 regressions. Keep ONLY the safe `understandPrompt` prefix-cache reorder + city-scoped areas + trivial-turn pre-filter in Wave 2A (verify `evals` + `extract` tests). Defer 17-type passive extraction & `classifyEmptyStateRemedy` wiring to Pass 3. |
| **3.4** (Wire `PgVenueStore`, `CompositeVenueProvider`, `externalEvents`, `externalMatchmaker`, `TopOneSuggestionFlow` into `NetworkService`) | Wire all 5 unwired subsystems into live `NetworkService` in Pass 2 | **REVISE (SPLIT)** | **Fix and harden** `PgVenueStore` & `CompositeVenueProvider` (columns, batch upserts, single query/rank, `maxVerifyCalls` cap, `Clock`) in Wave 2C so Postgres tests pass 100%. **DEFER** hot-path `NetworkService` integration (dual-write ownership, live API calls, `0098` orchestration) to Pass 3 after `architect` review. |
| **3.5** (`spatialIndex.ts`, `humanVector.ts`, `vocabulary.ts`, City #6 unions) | Replace `hood(area)` with `findNeighborhood`; fix `homeH3`/`transitMode`; unify `NEIGHBORHOODS` & City #6 unions | **REVISE (P1/SPLIT)** | Fix `spatialIndex.ts:279` as **`findNeighborhood(p.city, area)` → NYC `hood(area)` fallback → `zipForArea`** (preserves NYC coverage while fixing SF/LA/Chicago/Miami) + fix `humanVector.ts:722-724` (`latLonToHex`, `CitySpec.primaryMode`) in Wave 2B (verify `matching` 112/112 & `friends` 67/67). Defer City #6 union refactor & `vocabulary.ts` merge to Pass 3. |
| **3.6** (`apps/marketing` refactor + BD/event bridges) | Consume `CitySpec`, remove NYC hardcoding, bridge `bd-engine` → `PgVenueStore` & `discovery` → `externalEventBridge` | **REVISE (P1/SPLIT)** | Make `apps/marketing/src/cities.ts` derive base 5-city metadata (`tz`, `name`, `isPrimaryLaunch: true`) from `@thenetwork/core` `getCity(id)` and remove hardcoded `"nyc"` defaults in `bandit.ts`/`cli.ts` while keeping `apps/marketing/test/marketing.integration.test.ts` (1,815 lines) 100% green. **Defer** cross-schema `bd-engine`/`discovery` DB bridges to Pass 3. |
| **4.2** (LLM wins: `understandPrompt`, `slop/extract`, `clef.ts`, `relay-endpoint.ts`, `llmJudges.ts`) | Prefix reorder, 5-city + `selfAge` guard, `clef.ts` timeout + parallel + DB cache, `relayClef` LRU cache, `llmJudges.ts` reasoning-first | **REVISE (P1)** | Ship `understandPrompt` prefix/city-scope/pre-filter (Wave 2A), `slop/extract.ts` 5-city + guarded `selfAge` skip (Wave 2B), `clef.ts` `AbortSignal.timeout(10_000)` + `Promise.all` (Wave 2B — **defer** new DB photo-feature cache schema to avoid migration bloat), `relay-endpoint.ts` bounded hash-keyed LRU cache (Wave 2A), `llmJudges.ts` reasoning-first (Wave 3A). |
| **4.3a** (`VenueManager` delta export + clone removal) | Persist deltas only (95.6 KB → <1 KB); drop redundant inner `JSON.parse(JSON.stringify())` | **ACCEPT (P0 Perf)** | Ship in Wave 2A with backward-compatible `importState()` (hydrates `ALL_SEED_VENUES` first, overlays deltas, handles legacy full snapshots) + round-trip & size tests. |
| **4.3b** (`cities.ts`, `venues.ts`, `time.ts`, `copy.ts`) | Pre-index neighborhoods/barriers; pass `startParts` to `isVenueOpenAt`; cache `Intl`; loop `formatToParts` | **ACCEPT (P1 Perf)** | Ship in Wave 1 (`cities.ts`, `venues.ts`, `time.ts`) & Wave 2A (`copy.ts:336`). Zero behavioral change, 37.9x & 7.8x measured speedups. |
| **4.3c** (`PgStore.save()` dirty tracking + schema cache) | Cache schema checks AND add dirty-row diffing to skip upserts | **REVISE (P1)** | **ACCEPT** caching `relaySchema` & `hasMembersTable` per `PgStore` instance. **CUT** dirty-row diffing (split-brain corruption risk across replicas/staff edits). |
| **4.3d** (`loadSnapshot` SQL city pushdown + receipts) | Push city predicate into 11 queries in `snapshot.ts` | **DEFER (P2)** | High risk of dropping travelers (`presence`) or cross-city `person_blocks` or perturbing `audit engine-pipeline-17`. Defer to Pass 3 with dedicated multi-city traveler/block Postgres tests. |
| **4.3e** (Observatory poll scans + `review-judge.ts` deletes) | Incremental message watermark, CTE rewrites, batched `review-judge` deletes, remove unused `citiesList` fetch | **REVISE (P1/SPLIT)** | Ship trivial wins: batched `DELETE` in `review-judge.ts` (Wave 2A), remove dead `store.citiesList` fetch (Wave 2D), fix Observatory NYC hardcoding (`events.ts:173`, `game.ts:222`, `real.ts:1304`) (Wave 2D). **Defer** complex `real.ts` incremental watermark & CTE rewrite to Pass 3. |
| **4.3f** (`pnpm run sim` speedup) | `--jobs N` parallel runner + skip brute-force in `scale.ts` + reuse `World` in `matching.ts` | **REVISE (P0 DevEx)** | **ACCEPT** `--jobs N` parallel child-process runner in `scripts/sim.ts` (splitting `matching` via `--matching-pack`) + lossless `World` reuse in `matching.ts`. **REJECT** skipping `all`/`refusedBy` checks in `scale.ts` (weakens bound & refusal soundness invariants). |
| **5.1** (Waitlist, relocation, `deliveryMode`, cross-app sharing expansion) | Full global expansion + new sharing grants + NYC copy sweep | **CUT / DEFER (Pass 3)** | Out of launch scope without founder approval (`AGENTS.md`); touches privacy/consent specs and security tests. Fix only active broken 5-city copy (`service.ts:3041`, `apps.ts:75`, `events.ts:173`). |
| **5.2** (`fiveCitySuite` + 7 new scenarios) | Fix `fiveCitySuite` shortcuts + build 7 new scenarios including `0098` & full marketing E2E | **REVISE (P1/SPLIT)** | Fix `fiveCitySuite.ts` crash (`ageMin === 0`), non-vacuous S15 assertion (`soloVenues.length > 0`) + 5-city teen `teenStop` parity check, and add 2 high-signal unit/integration scenarios (mid-journey red-line/budget change + brewery teen rejection + `venue_full`/panic arrival relay). Defer full `0098` external-matchmaker sim block & marketing-to-match E2E to Pass 3 when those seams are wired. |
| **5.3** (Observatory new panels for 5-city / `0098` / `nextgen-matching`) | Build new Observatory UI panels & API endpoints | **CUT / DEFER (Policy)** | Unapproved UI feature scope (`AGENTS.md` No-UI-change rule). Fix broken Observatory bugs only. |

---

## 3. Scope Boundary: Must-Ship (Pass 2) vs Explicitly Deferred (Pass 3)

### Must-Ship Scope (Zero-Regret P0 + High-ROI P1)
1. **Unblock `develop` to 100% green:**
   - Fix all 8 Observatory TS errors (`seed.ts`, `map.ts:104`, `five-cities.integration.test.ts:91,198`).
   - Fix `seedVenue()` `ageMin: v.ageMin ?? 0` (`cities.ts`) + `five-cities-venues-work-intro.test.ts:253` (`teenFriendAllowed: true`) + `meetup-venues-external.pg.test.ts:68,76` (20 networks).
   - Add idempotent migration `0100_venues_and_arrivals_hardening.sql` (upgrade-safe 12 columns, `'New York City'`, `meetup_arrivals` `UNIQUE` + `state CHECK`).
2. **Close every live teen safety, red-line, coordination & budget bug:**
   - `geo.ts:228,350`: enforce `v.allAges === true && !v.isAlcoholCentric` (blocks breweries for minors).
   - `network.ts:10531`: remove `"heavy_drinker"` from `nonDrinker`; unify all 3 venue preference extractors into one helper; pass `teenFriendAllowed` on backup pick (`:5265`); fix `venuePassesRedLines` default `tz` (`:10576`); route `pickVenueWithRedLines` through `this.venues`; gate `isWorkIntro` safely for `1974d9daa` work-ontology intros + fix non-cofounder copy + wire `workIntroEmailOf` in `NetworkService`.
   - `meetup-coord.ts`: switch to already-generated `generated/meetupCoordination.ts` (panic halt, teen relay block, `venue_full` pivot without quarantine, `this.venues.getVenue` lookup); delete unused duplicate helpers on `network.ts`.
   - `service.ts:927-953` / `serve.ts:174-188`: fix `LLMBudget` UTC day-rollover refresh before `rt.tick()` + DB request count seeding; fix `service.ts:3041` 5-city prompt; batch `review-judge.ts` deletes.
   - `venue-store.ts` & `venue-provider.ts`: wire all 12 `0098` red-line columns + `safetyScore`/`transitScore`, remove `Date.now()` defaults (use `Clock`/`nowMs`), eliminate double query/rank, batch upserts, cap `maxVerifyCalls` with `"unknown"` cooldown.
3. **Zero-risk, high-ROI performance & LLM wins:**
   - `cities.ts`, `venues.ts`, `time.ts`, `copy.ts`: pre-indexed neighborhood/barrier `Map`s (**≥30x** midpoint speedup), hoisted `startParts` in `isVenueOpenAt` (**≥7x** speedup), cached `Intl.DateTimeFormat`, loop `formatToParts`.
   - `venue-manager.ts`, `network.ts`, `store.ts`: delta-only `VenueManager.exportState()` (**95.6 KB → <1 KB**), backward-compatible `importState()`, drop redundant inner `JSON.parse(JSON.stringify())`, cache `relaySchema`/`hasMembersTable` in `PgStore`.
   - `extract.ts`, `slop/extract.ts`, `clef.ts`, `relay-endpoint.ts`, `llmJudges.ts`: `understandPrompt` static prefix + city-scoped areas + trivial-turn pre-filter; `slop/extract.ts` 5 cities + guarded `selfAge` skip; `clef.ts` `AbortSignal.timeout(10_000)` + `Promise.all`; `relay-endpoint.ts` bounded hash-keyed LRU cache; `llmJudges.ts` reasoning-first.
   - `engine`: `spatialIndex.ts:279` (`findNeighborhood` → NYC `hood` fallback → `zipForArea`), `humanVector.ts:722-724` (`latLonToHex`, `CitySpec.primaryMode`), `judgeContext.ts` use `w.feedbackByPair` map (no prompt text change!).
   - `apps/marketing`: derive 5 launch cities from `@thenetwork/core` `CitySpec`, set `isPrimaryLaunch: true` for all 5, remove hardcoded `"nyc"` defaults in `bandit.ts`/`cli.ts`.
   - `apps/observatory`: fix `events.ts:173`, `game.ts:222`, `real.ts:1304`, remove unused `store.citiesList` fetch.
4. **Lossless sim speedup & fidelity hardening:**
   - `scripts/sim.ts`: `--jobs N` parallel block + `--matching-pack` child-process execution (**~64 min → ≤15 min**, byte-identical gates).
   - `scripts/sim/matching.ts`: lossless `World` reuse (zero weakening of `scale.ts`).
   - `packages/sim/src/fiveCitySuite.ts`: non-vacuous S15 + 5-city teen `teenStop` parity + live red-line/panic/`venue_full` verification.

### Explicitly Deferred Scope (Pass 3 — Dedicated PRs)
| Deferred Item | Rationale for Deferral |
|---|---|
| **`spec/` deletion (`meetupArrival.md`, `cityTravel.md`, `encounterFollowup.md`) + N-party `workIntroChannel.md`** | Requires `spec/lock.json` updates + explicit product-owner `pnpm run accept` sign-off (`AGENTS.md`); all P0 runtime bugs are already fixed via `generated/meetupCoordination.ts`. |
| **`JudgeCache` context time-bucketing (`judge-v4`)** | Must preserve exact-prompt binding (`judge-cache.integration.test.ts:68`); modifying `buildDeepContext` alters live `gpt-6-luna` judge prompts and requires a dedicated live-eval PR. |
| **Wiring `PgVenueStore`, `CompositeVenueProvider`, `externalEvents`, `externalMatchmaker`, `TopOneSuggestionFlow` into live `NetworkService`** | Requires `architect` design of single-source-of-truth (Postgres vs `network_state` JSONB) and external API failure/rate-limit drills; keep Pass 2 focused on making the underlying library 100% correct & tested. |
| **`PgStore.save()` dirty-row tracking & `loadSnapshot()` SQL city pushdown** | High split-brain / cross-city traveler / `person_blocks` regression risk; delta `VenueManager.exportState()` already removes 98% of JSONB bloat safely. |
| **Non-launch city waitlists, launch-city relocation, `deliveryMode` ontology schema, cross-app sharing expansion** | New product scope outside `spec/product/README.md` launch scope; requires written founder approval and privacy spec updates. |
| **17-type passive extraction in `classify.ts`/`extract.ts` & `classifyEmptyStateRemedy` wiring** | `extract.ts` is not wired in prod `Service`; modifying `classify.ts` risks `evals` 40/40 and `network` 123/123 regressions without live extraction evals. |
| **New Observatory UI panels (5-city / `0098` / `nextgen-matching`) & `real.ts` CTE/watermark rewrite** | Violates `AGENTS.md` No-Unapproved-UI-Change rule; defer until UI spec approval and screenshots/recordings workflow. |
| **`apps/marketing` `bd-engine` → `PgVenueStore` & `discovery` → `externalEventBridge` bridges + `clef.ts` DB photo-feature cache** | Cross-schema/migration coupling better handled once `PgVenueStore` owns production writes in Pass 3. |

---

## 4. Disjoint-File-Ownership Swarm Wave Plan

**Zero File Overlap Guarantee:** Every wave executes sequentially across waves and in parallel *within* waves. No two workers in the same wave ever touch the same package or file.

### Wave 1 — Foundation (`core` + `db`) [1 Worker, Serial First]
*Must complete and pass `typecheck` on `packages/core` + `db:migrate` before Wave 2 spawns.*

- **Worker `w1-core-db`**
  - **Owned Files (exclusive):**
    - `packages/db/migrations/0100_venues_and_arrivals_hardening.sql` *(new)*
    - `packages/core/src/cities.ts`
    - `packages/core/src/venues.ts`
    - `packages/core/src/time.ts`
    - `packages/core/test/venues-perf-and-seed.test.ts` *(new)*
  - **Exact Tasks:**
    1. Create idempotent `0100_venues_and_arrivals_hardening.sql`: upgrade-safe `ALTER TABLE platform.venues ADD COLUMN IF NOT EXISTS ...` for all 12 `0098` columns; `UPDATE platform.cities SET name = 'New York City' WHERE id = 'nyc' AND name = 'New York'`; deduplicate `network.meetup_arrivals` and add `UNIQUE (app_id, opportunity_id, member_id)` + `CHECK (state IN ('omw','delayed','arrived','seated','met','venue_closed','venue_full','cancelled','no_show'))` (matching all states emitted by `meetup-coord.ts` and `venue-store.ts`).
    2. `packages/core/src/cities.ts`: set `ageMin: v.ageMin ?? 0` in `seedVenue()` (`:65-84`); pre-index normalized neighborhood/alias `Map`s and symmetric barrier `Map`s on `registerCity()`; hoist `candidate -> travelTimes[]` before the `relax` loop in `chooseFairMidpoint()` (`:1169-1257`).
    3. `packages/core/src/venues.ts`: accept optional `parts?: LocalParts` in `isVenueOpenAt()` and pass hoisted `startParts` from `rankVenuesForMatch()` (`:370,434`). **DO NOT** change `teenFriendAllowed = request.teenFriendAllowed ?? false` (`:377`).
    4. `packages/core/src/time.ts`: replace `Object.fromEntries` in `localParts()` (`:27`) with a tight loop over `formatToParts`.
    5. Add `packages/core/test/venues-perf-and-seed.test.ts`: assert every `ALL_SEED_VENUES` entry has `typeof v.ageMin === "number"`, assert `chooseFairMidpoint` & `isVenueOpenAt` output parity before/after indexing, and assert `isAlcoholCentric` venues have `allAges === false`.
  - **Exit Check:** `vitest run packages/core/test/venues-perf-and-seed.test.ts` + `tsc --noEmit -p packages/core/tsconfig.json` (or root `tsc`).

---

### Wave 2 — Parallel Package Execution [4 Disjoint Workers]
*Spawns immediately after Wave 1 `[done]`. Package-level disjoint ownership = 0 file conflicts.*

#### Worker `w2-network` (`packages/network/**` ONLY)
- **Owned Files (exclusive):**
  - `packages/network/src/geo.ts`
  - `packages/network/src/venue-manager.ts`
  - `packages/network/src/meetup-coord.ts`
  - `packages/network/src/network.ts`
  - `packages/network/src/store.ts`
  - `packages/network/src/extract.ts`
  - `packages/network/src/copy.ts`
  - `packages/network/service/service.ts`
  - `packages/network/service/serve.ts`
  - `packages/network/service/relay-endpoint.ts`
  - `packages/network/service/review-judge.ts`
  - `packages/network/test/five-cities-venues-work-intro.test.ts`
  - `packages/network/test/pass2-safety-and-perf.test.ts` *(new)*
- **Exact Tasks:**
  1. **Teen brewery fix (`geo.ts:228,350`):** Require `v.allAges === true && !v.isAlcoholCentric` in both `meetingSpot` and `seedVenueToGeoVenue`.
  2. **Venue prefs & routing (`network.ts`):** Remove `"heavy_drinker"` from `nonDrinker` (`:10531`); unify `memberVenuePrefs`, `memberVenueRankPrefs`, and `memberVenuePrefsOf` into one helper supporting all 13 red lines + `spend:*`/`hv:spend:*`/`budget:*` + visited/rejected history; pass `teenFriendAllowed: o.teenRuleAt !== undefined` on backup venue pick (`:5265`); default `venuePassesRedLines` `tz` to `this.cityTz()` (`:10576`); route `pickVenueWithRedLines` through `this.venues` (keep red-line-free NYC `geo.ts` fallback at `:5237` intact for pinned sim gates!).
  3. **Work intro routing (`network.ts:4789-4791,5405-5423`, `service.ts`):** Expand `isWorkIntro` only for `1974d9daa` work-ontology tags (preserving legacy NYC `network` sim lanes); fix hardcoded cofounder copy for non-cofounder work intros; wire `workIntroEmailOf` in `NetworkService`.
  4. **MeetupCoordinator consolidation (`meetup-coord.ts`, `network.ts:10457-10514`):** Import `evaluateArrivalRelaySafe`, `evaluateBackupPivotV2`, `evaluateVenueQuarantine` from `generated/meetupCoordination.ts`; pass `panicTriggered` & `anyMinorInEvent` into arrival relay check; parse and pivot on `venue_full` (without quarantining); look up backups via `this.venues.getVenue`; remove redundant `new LeakGuard` per-recipient allocations; delete dead duplicate helpers on `ConsentNetwork`.
  5. **State bloat & PgStore (`venue-manager.ts`, `network.ts:10166-10212`, `store.ts:180-184,290`):** Delta-only `VenueManager.exportState()` (**95.6 KB → <1 KB**) with backward-compatible `importState()` (seeds `ALL_SEED_VENUES` first, overlays deltas); drop redundant inner `JSON.parse(JSON.stringify())` clones; cache `relaySchema` & `hasMembersTable` per `PgStore` instance (**NO dirty-row diffing**).
  6. **LLM & service fixes (`service.ts:927-953,3041`, `serve.ts:174-188`, `review-judge.ts:257-261`, `relay-endpoint.ts:55`, `extract.ts:49-84`, `copy.ts:336`):** Refresh `engineBudgets` before `rt.tick()` (and seed request counts from `cost_ledger` on rollover); fix 5-city prompt at `service.ts:3041`; batch `DELETE` in `review-judge.ts`; attach bounded hash-keyed LRU cache (2k entries, 1h TTL) in `relay-endpoint.ts`; reorder `understandPrompt` static taxonomy into `system` with city-scoped areas + pre-filter trivial turns; cache `Intl.DateTimeFormat` by `tz` in `copy.ts:336`.
  7. **Tests:** Fix `five-cities-venues-work-intro.test.ts:253` (`teenFriendAllowed: true`) and add `pass2-safety-and-perf.test.ts` covering brewery teen exclusion, `heavy_drinker` nonDrinker=false, `venue_full` pivot without quarantine, panic relay halt, delta `exportState()` < 2 KB + round-trip parity (both delta and legacy full state), and `LLMBudget` UTC rollover.
- **Exit Check:** `vitest run packages/network/test/five-cities-venues-work-intro.test.ts packages/network/test/meetup-external-matchmaking.integration.test.ts packages/network/test/pass2-safety-and-perf.test.ts` + `pnpm run sim --only evals,network,peon-seats`.

#### Worker `w2-engine` (`packages/engine/**` ONLY)
- **Owned Files (exclusive):**
  - `packages/engine/src/spatialIndex.ts`
  - `packages/engine/src/humanVector.ts`
  - `packages/engine/src/packs/slop/extract.ts`
  - `packages/engine/src/packs/slop/clef.ts`
  - `packages/engine/src/packs/network/judgeContext.ts`
  - `packages/engine/test/pass2-engine-fixes.test.ts` *(new)*
- **Exact Tasks:**
  1. `spatialIndex.ts:279`: resolve `findNeighborhood(p.city, area)` FIRST, falling back to `p.city === "nyc" ? hood(area) : undefined`, then `zipForArea(area, p.city)`.
  2. `humanVector.ts:722-724`: compute real `latLonToHex` for `homeH3` (via resolved neighborhood/city coords) and derive `transitMode` from `getCity(homeCity)?.primaryMode` instead of `maxTravelMinutes`.
  3. `packs/slop/extract.ts:1072,1138-1145`: derive market list from `CITY_IDS` (includes `chicago`/`miami`); skip LLM when only `selfAge` is in `missing`, `p.age.confidence >= LLM_FILL_BELOW`, AND the message contains no digits or age keywords (`/\b(\d{2}|age|years?\s*old|turned|turning|birthday|born)\b/i`).
  4. `packs/slop/clef.ts:146-161`: pass `AbortSignal.timeout(10_000)` to `clefRun` and parallelize photo rating with `Promise.all` (preserving deterministic result order and error handling).
  5. `packs/network/judgeContext.ts:347,363`: use `w.feedbackByPair` map (already indexed on `World`) instead of linear `w.feedback.filter(...)` scan — **zero change to output JSON/prompt text**, keeping `judge-cache.integration.test.ts` 100% green!
  6. Add `packages/engine/test/pass2-engine-fixes.test.ts` verifying non-NYC `spatialIndex` resolution + NYC `hood` fallback, `humanVector` H3/transitMode, `slop/extract` 5 markets + guarded `selfAge` skip (including minor age mention override!), and `clef.ts` parallel timeout behavior.
- **Exit Check:** `vitest run packages/engine/test/judge-cache.integration.test.ts packages/engine/test/pass2-engine-fixes.test.ts` + `pnpm run sim --only onboard,clef`.

#### Worker `w2-platform-marketing` (`packages/platform/**` & `apps/marketing/**` ONLY)
- **Owned Files (exclusive):**
  - `packages/platform/src/venue-store.ts`
  - `packages/platform/src/venue-provider.ts`
  - `packages/platform/src/apps.ts`
  - `packages/platform/test/venues-five-cities.pg.test.ts`
  - `packages/platform/test/meetup-venues-external.pg.test.ts`
  - `apps/marketing/src/cities.ts`
  - `apps/marketing/src/bandit.ts`
  - `apps/marketing/src/cli.ts`
  - `apps/marketing/test/cities-core-sync.test.ts` *(new)*
- **Exact Tasks:**
  1. `packages/platform/src/venue-store.ts`: wire all 12 `0098` columns (`all_ages`, `is_alcohol_centric`, `halal_friendly`, `kosher_friendly`, `gluten_free_friendly`, `severe_allergen_safe`, `is_smoke_free`, `open_event_eligible`, `hobbies`, `cuisine_tags`) plus real `r.safety_score` and `r.transit_score` in `rowToVenue`, `seedCuratedVenues`, and `upsertVenue`; coalesce `v.ageMin ?? 0`; batch multi-row INSERTs in `seedCuratedVenues` & `upsertVenues`; remove `Date.now()` defaults (accept required `nowMs` or `Clock`).
  2. `packages/platform/src/venue-provider.ts`: eliminate duplicate `listVenues` + `rankVenuesForMatch` pass in `findAndRankVenues` (merge discovered venues in memory + batch upsert); add `maxVerifyCalls` cap (default 5) + `"unknown"` cooldown in `pickVerifiedPrimaryAndBackup`; remove `Date.now()` defaults (use `Clock`/`nowMs`).
  3. `packages/platform/src/apps.ts:75`: remove `"in New York City"` hardcoding from `friends` brand description.
  4. Tests: update `meetup-venues-external.pg.test.ts:68,76` to assert all 20 `<app>:<city>` networks (5 cities × 4 apps); extend `venues-five-cities.pg.test.ts` to assert full 12-column + `safetyScore`/`transitScore` round-trip and `meetup_arrivals` uniqueness/state constraint from `0100`.
  5. `apps/marketing/src/{cities.ts,bandit.ts,cli.ts}`: import `getCity` / `LAUNCH_CITIES` from `@thenetwork/core` to derive canonical base metadata (`name`, `tz`, `isPrimaryLaunch: true` for all 5 launch cities); remove hardcoded `"nyc"` defaults in `bandit.ts`/`cli.ts` while preserving backward-compatible CLI aliases (`seed-nyc`) so `apps/marketing/test/marketing.integration.test.ts` stays 100% green; add `apps/marketing/test/cities-core-sync.test.ts`.
- **Exit Check:** `REQUIRE_PG=1 vitest run packages/platform/test/venues-five-cities.pg.test.ts packages/platform/test/meetup-venues-external.pg.test.ts apps/marketing/test/cities-core-sync.test.ts apps/marketing/test/marketing.integration.test.ts`.

#### Worker `w2-observatory` (`apps/observatory/**` ONLY)
- **Owned Files (exclusive):**
  - `apps/observatory/db/seed.ts`
  - `apps/observatory/web/map.ts`
  - `apps/observatory/web/store.ts`
  - `apps/observatory/src/events.ts`
  - `apps/observatory/src/sources/game.ts`
  - `apps/observatory/src/sources/real.ts`
  - `apps/observatory/test/five-cities.integration.test.ts`
- **Exact Tasks:**
  1. `apps/observatory/db/seed.ts`: update stale PascalCase enums (`"SuspectClosed"`, `"Conversational"`, etc.) to snake_case `VenueStatus`/`VenueNoiseLevel`; pass object-form `groupVenueRubricScore({...})`; replace raw venue INSERT with `v.ageMin ?? 0` + all 12 `0098` columns (or reuse `PgVenueStore.seedCuratedVenues` directly).
  2. `apps/observatory/web/map.ts:104`: fix `v.status === "Active"` → `v.status === "active"` (fixes TS error and broken destructive-red map pins).
  3. `apps/observatory/test/five-cities.integration.test.ts`: fix `:198` `"Active"` → `"active"` and guard `:91` `if (dir) await rm(dir, ...)`.
  4. Fix broken multi-city Observatory remnants (no new UI panels!): `events.ts:173` use `timeFormatterFor(p.city)` timezone label instead of `"(New York time)"`; `sources/game.ts:222` support multi-city config; `sources/real.ts:1304` fall back to `CITY_IDS` instead of `["sf", "nyc"]`; `web/store.ts:322,750` remove unused `citiesList` dead fetch.
- **Exit Check:** `tsc --noEmit -p apps/observatory/tsconfig.json` + `REQUIRE_PG=1 vitest run apps/observatory/test/five-cities.integration.test.ts apps/observatory/test/staff.test.ts`.

---

### Wave 3 — Sim Speed, Fidelity, Benchmarks & Full Verification [2 Workers]
*Spawns strictly after all 4 Wave 2 workers post `[done]`.*

#### Worker `w3-sim-and-benchmarks` (`scripts/sim*`, `packages/sim/**`, `docs/results/**` ONLY)
- **Owned Files (exclusive):**
  - `scripts/sim.ts`
  - `scripts/sim/matching.ts`
  - `packages/sim/src/judge/llmJudges.ts`
  - `packages/sim/src/fiveCitySuite.ts`
  - `docs/results/2026-11-27-pass2-benchmarks.md` *(new)*
- **Exact Tasks:**
  1. `scripts/sim.ts`: add `--jobs N` (default `1` to preserve existing serial behavior, or `min(4, cpus)` when `--jobs` is passed) spawning parallel child processes for independent sim blocks and automatically sharding `matching` across its 4 existing `--matching-pack <pack>` values, aggregating JSON gate results into identical stdout/exit-code output. **Keep `scripts/sim/scale.ts` checks at 100% full strength.**
  2. `scripts/sim/matching.ts:512-515`: reuse `World` cleanly when inputs are identical (byte-identical gate results).
  3. `packages/sim/src/judge/llmJudges.ts:78,86,92,98`: reorder `"reasoning"` before verdict in all 4 schemas (`AGENTS.md`).
  4. `packages/sim/src/fiveCitySuite.ts`: verify `:1784` passes with `ageMin === 0`; fix S15 (`:1879`) with non-vacuous `soloVenues.length > 0` + 5-city teen `teenStop=false` vs `true` parity check; add explicit checks for teen brewery exclusion, `heavy_drinker` nonDrinker=false, and `venue_full`/panic arrival handling.
  5. Run and record before/after benchmarks in `docs/results/2026-11-27-pass2-benchmarks.md` (with exact commands, seeds, sample sizes, and hand-written vs generated notes per `AGENTS.md`).
- **Exit Check:** `pnpm run sim --only five-city` (100% PASS) + benchmark script execution.

#### Worker `w3-final-verifier` (Read-Only — Runs After `w3-sim-and-benchmarks` `[done]`)
- **Owned Files:** NONE (read-only).
- Runs ALL acceptance gates in Section 5 below and reports exact pass/fail lines to `@coordinator`.

*(Note on Optional Track S — Spec Consolidation & `pnpm run accept`: Pass 2 requires **zero** `spec/*.md` edits, keeping `spec/lock.json` untouched and valid. Only if the product owner explicitly requests deleting `spec/meetupArrival.md`, `spec/cityTravel.md`, and `spec/encounterFollowup.md` should a follow-up spec-only worker run `pnpm run spec:sync`, `pnpm run check`, `pnpm run spec:check-generated`, and owner-approved `pnpm run accept`.)*

---

## 5. Exact Acceptance Gates & Before/After Metrics

### Mandatory CI & Verification Gates (All Must Pass 100%)
1. `corepack pnpm@10.24.0 run typecheck` → **0 errors** (down from 8).
2. `corepack pnpm@10.24.0 run spec:check-generated` → **PASS** (0 drift).
3. `corepack pnpm@10.24.0 run check` → **PASS** (all Vibestack compiler/proof stages green).
4. `corepack pnpm@10.24.0 run quint:check venue_lifecycle meetup_coordination work_intro` → **PASS** (0 failures).
5. `node --import tsx --env-file-if-exists=.env plugins/build.ts --check` → **PASS**.
6. `corepack pnpm@10.24.0 run design:check && corepack pnpm@10.24.0 run lint:ui && corepack pnpm@10.24.0 run ui:test && corepack pnpm@10.24.0 run sites:build` → **PASS** (0 warnings).
7. `REQUIRE_PG=1 corepack pnpm@10.24.0 run security` → **11/11 files, 100% PASS**.
8. `REQUIRE_PG=1 corepack pnpm@10.24.0 run test:integration` → **100% PASS** (including all 4 five-city suites, `meetup-venues-external.pg.test.ts`, `judge-cache.integration.test.ts`, `apps/marketing/test/marketing.integration.test.ts`, and all new Pass 2 regression tests).
9. `REQUIRE_PG=1 corepack pnpm@10.24.0 run test:e2e` → **100% PASS**.
10. `REQUIRE_PG=1 corepack pnpm@10.24.0 run sim --jobs 4` → **100% PASS** across all 16 blocks (`evals` 40/40, `onboard` 23/23, `network` 123/123, `matching` 112/112, `slop` 57/57, `relay` 73/73, `peon` 30/30, `peon-seats` 23/23, `friends` 67/67, `clef` 10/10, `five-city` 100%, `safety` 18/18, `ops` 12/12, `pipeline` 15/15, `pipeline-slop` 14/14, `audit` 18/18), **0 canary leaks, 0 invariant violations, and ALL 9 teen gates = 0**.
11. **Hygiene audit:** `cmp -s AGENTS.md CLAUDE.md`, zero `.env`/`runs/` tracked, zero new `Date.now()` / `new Date()` (no arg) / `Math.random()` in `packages/network/src`, `packages/engine/src`, `packages/platform/src/venue-{store,provider}.ts`.

### Measured Before / After Targets (`docs/results/2026-11-27-pass2-benchmarks.md`)

| Metric | Baseline (`0239b70c3`) | Pass 2 Target | Measurement Method |
|---|---|---|---|
| `typecheck` errors | 8 errors (3 Observatory files) | **0 errors** | `corepack pnpm@10.24.0 run typecheck` |
| Five-city + `0098` targeted test failures | 8 failing tests across 4 files | **0 failing tests** | Targeted `vitest run` + full `test:integration` |
| `VenueManager.exportState()` JSON size (fresh 5-city runtime) | 97,864 bytes (95.6 KB) | **< 1,024 bytes (< 1 KB, >98% cut)** | Node microbenchmark (`JSON.stringify(vm.exportState()).length`) |
| `chooseFairMidpoint()` (2,000 calls across 5 cities) | ~593.6 ms | **≤ 25 ms (≥ 24x speedup)** | Same-input deterministic benchmark, parity-asserted |
| `isVenueOpenAt()` inside `rankVenuesForMatch()` (15 venues × 2,000 calls) | ~206.6 ms | **≤ 35 ms (≥ 6x speedup)** | Same-input deterministic benchmark, parity-asserted |
| `understandPrompt()` static prefix ratio & neighborhood count | 0% static prefix (dynamic first), 80 areas | **≥ 80% static `system` prefix, 10 city-scoped areas** | Prompt token inspection test |
| `relayClef` cache hits on repeated arrival phrases (`"omw"`, `"here!"`) | 0% (uncached in prod) | **100% hit on repeat within 1 h TTL** | `relay-endpoint` unit test |
| `LLMBudget` Day D exhaustion → Day D+1 tick recovery | 0 calls allowed (silent day-long outage) | **Full Day D+1 budget restored before `rt.tick()`** | Simulated-clock rollover test |
| Full `pnpm run sim` wall-clock (`--jobs 4` vs serial) | ~3,833 s (~64 min) | **≤ 900 s (≤ 15 min, ≥ 4x speedup)** | Wall-clock timing with 100% identical blocking gate counts |
