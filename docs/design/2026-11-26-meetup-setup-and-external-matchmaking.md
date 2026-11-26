# Meetup Setup, Suggestion Flows, Impromptu External Events, and External Matchmakers

Status: **Design specification (2026-11-26)** reconciled with `eliza-research/thenetwork` (`origin/main`, Node 26 / `pnpm` / `vitest` / Vibestack). Applies to `ntwrk`, `slop`, `friends`, and `peon` across five launch cities (`sf`, `nyc`, `la`, `chicago`, `miami`).

> **Hard safety boundaries (non-negotiable):**
> 1. **Age policy (`spec/friendIntroAge.md`, owner decision 2026-11-22).** Under-13 cannot join. Ages 13–17 may receive **in-network** friendship introductions on `friends.help` and the `ntwrk.party` `Friend` lane under `teenFriendAgeRule` (exact birth dates, partners aged 13–18 within 2 calendar years, small groups of 2–6 at all-ages public places, moderated text relay only, strict review-judge rubric, single-staff stop switch). Minors are **NEVER** eligible for `slop.date` dating, `peon.biz` work, `ntwrk` plans/gatherings, **external syndicated events (Luma/Meetup/Partiful)**, **external event co-attendance**, or **external dating matchmakers / prospect caches**. All external events and external matchmaking are strictly **18+ adult-only** (`noMinorInAnyEventOrCoattend`, `externalProspectAdultOnly`). Youngest stated or recorded age always wins.
> 2. **Public licensed third-party venues only.** Never suggest or host at a private home (`CHECK (is_public = true)`).
> 3. **Approval before contact (`spec/automatedReview.md`, owner decisions D15–D17).** Every in-network opportunity gets one recorded approval before any member is contacted: the automated review judge (`gpt-6-luna`, strict rubric when a roster has a minor) or a named staff member for an item the judge holds. Staff can stop an approved item before its reveal. External event publishing, external matchmaker outreach briefs, external pairings, and post-event invite batches additionally require explicit human/staff review (`humanReviewRequiredBeforeExternalOutreach`, `externalEventHasConfirmedAnchor`).
> 4. **Zero undisclosed bots, zero scraping, zero cold SMS.** No headless dating-app automation, no auth-wall scraping, no cold texting numbers from profiles (TCPA/FTSA), and zero URLs or brand spam on dating apps.
> 5. **Strict privacy and cross-app firewalls.** Red-line facets (`sobriety`, `allergies`, `budget`, `wheelchair`, `health`) stay `agent_private` and never appear in explanations to other people. `slop` Clef appearance ratings and external dating prospect data are strictly isolated from `peon.biz` (`crossAppScoreFirewall`).
> 6. **Carrier consent and caps.** Every proactive SMS respects `STOP` (all apps), per-app `leave`, quiet hours (`20:30–09:00` local), and the person-level cap of 3 proactive messages per day.

> **Founder scope decisions (`[DECIDE]`):** Five-city expansion beyond NYC, red-line Top-1 venue suggestions, density-aware external event syndication (Luma/Meetup/Partiful), per-city human-operated matchmaker personas, and privacy-bounded external prospect caching extend current launch scope in [spec/product/README.md](../../spec/product/README.md). Each new scope area is recorded as a **`[DECIDE]`** story (`F53`–`F56`) in [spec/product/stories.md](../../spec/product/stories.md) for founder sign-off before production rollout.

---

## 1. Consolidation and Deduplication Crosswalk (`origin/main`)

This specification consolidates five-city venue intelligence (60 base seed venues + 15 hobby-native venues = 75 verified seed venues across `sf`, `nyc`, `la`, `chicago`, `miami`, Google Places API New `>= 10` local sufficiency cutoff, pre-recommendation open checks, instant closure quarantine, and the 100-point group walk-in rubric) with Top-1 red-line-aware suggestions, impromptu external events, and per-city external matchmakers. User stories continue at **`US-23`–`US-40`** and failure modes continue at **`FM-19`–`FM-36`** (continuing cleanly from base five-city stories `US-1`–`US-22` and `FM-1`–`FM-18` without duplication).

### 1.1 Crosswalk Against Existing `origin/main` Product Stories (`F1`–`F52`) and Vibespecs

| Existing `origin/main` Artifact | Scope Covered Already | Consolidated / Extended Here |
|---|---|---|
| **`spec/product/stories.md` `F1`–`F9`, `F15`, `F20`, `F23`–`F26`, `F28`, `F30`–`F31`, `F34`–`F52`** | Vouch invites, enrollment, age/birth-date authority, profile facts, STOP/leave, blocks/reports/holds/bans, data export/deletion, travel presence, staff console, MCP connectors, design system | Reused unchanged. External events and external prospects cross-check `platform.banned_phones`, `person_holds`, `person_blocks`, and `lowest_age`. **W3-232 (`RelayRecord.ageSignal`) is already fixed on `origin/main`** in `packages/network/src/relay.ts` (`relayStartsMinorPolicy` -> `this.host.minorSignal`) and is preserved intact. |
| **`spec/friendIntroAge.md` (`F11`, `F12`, `F16`)** | `teenFriendAgeRule`: 13–17 friendship pairs & 2–6 groups on `friends.help`/`ntwrk` `Friend` lane with 13–18 teen-ready peers within 2 calendar years, at `allAges` public places, moderated text relay only, single-staff stop | Preserved strictly. `venueSelection.md` and `cities.ts` propagate `allAges` (`ageMin <= 13`, low risk, non-alcohol) for in-network teen friend venues while enforcing strict **18+ adult-only** boundaries on `slop`, `peon`, external syndicated events, and external matchmakers. |
| **`spec/automatedReview.md` (`F27`)** | `gpt-6-luna` automated review judge (strict rubric for rosters with a minor) + staff exception queue for held items + pre-reveal stop | Preserved for all in-network opportunities. External event publishing, external matchmaker outreach, and post-event invite batches integrate with `automatedReview.md` approval and enforce human-review gates where external ToS/non-member safety requires it. |
| **`spec/slopDatePlan.md` & `spec/venueBookingLink.md` (`F11`, `F17`)** | Adult/opt-in/paused/block/hold date plan checks (`slopDateProfilesAllowed`, `slopDatePairAllowed`) and official curated booking links on confirmed bookings | Extended by `spec/venueSelection.md` and `spec/suggestionFlow.md`: 3-level alcohol boundary (`strict_sober`), allergens/religious diets, after-dark safety floors, concrete primary + backup public venues, and bounded Top-1 suggestion pivots (`F53`, `US-23`–`US-28`, `FM-19`–`FM-21`). |
| **`spec/groupLateArrival.md` (`F18`, `F19`)** | Pair and group fixed late-arrival notice (`1h` lead to `30m` grace, booking-receipt check, `>= 3` group roster) | Extended by `spec/meetupCoordination.md`: `T-75m` pre-brief + backup venue, `T-30m..T+45m` arrival relay (self-described cues for adults via LeakGuard + Clef; teen threads keep `friendIntroAge.md` text-only guard), `T+12m`/`T+18m` no-show guard, `venue_full` vs `venue_closed` backup pivot, instant panic halt, `T-3h` anchor failover, and `20:30–09:00` quiet-hour follow-ups (`F54`, `US-29`–`US-30`, `US-34`, `FM-22`–`FM-25`). |
| **`spec/publicEventCatalog.md` & `spec/soloConcierge*.md` (`F10`, `F13`)** | NYC Parks public event feed ingest (`0042_public_event_catalog.sql`), 14-day freshness, solo concierge recommendations (`allAges` for minors), revision-bound event co-attendance | Preserved unchanged for public open-data feeds. `spec/externalEventBridge.md` adds sanctioned external event syndication (Luma Plus API, Meetup Pro GraphQL, human-assisted Partiful Event Kit) for **adult-only** sparse `friends` meetups (`F55`, `US-31`–`US-34`, `FM-25`–`FM-29`). |
| **`spec/monthlyGathering*.md` (`F22`)** | Staff-authored/reviewed monthly NYC Network gatherings (`0055..0059_monthly_gathering*.sql`) | Preserved unchanged for curated in-network monthly gatherings. Impromptu walk-in 6–15 `friends` meetups live in dedicated `platform.external_events` tables (`0098_meetup_venues_external_matchmaking.sql`) with zero schema collision. |
| **`spec/peonCandidateSearch.md` & `spec/peonHireDispatch.md` (`F33`)** | Candidate-first double opt-in, verified employers, unranked slates, human hiring decisions | Extended with explicit `crossAppScoreFirewall` (schema, RLS, and `externalMatchmaker.md`) guaranteeing `peon` never reads `slop` appearance ratings or external dating prospect tables (`US-40`, `FM-36`). |
| **New `[DECIDE]` Stories `F53`–`F56`** | Red-line Top-1 suggestions, arrival pivots & panic halt, density-aware impromptu external events, per-city dual-persona external matchmakers & quality-gated onboarding | Fully specified below across `spec/{venueSelection,suggestionFlow,meetupCoordination,externalEventBridge,externalMatchmaker}.md` and `spec/models/{venue_lifecycle,meetup_coordination,external_event_bridge,external_matchmaker}.md`. |

### 1.2 Stack, Migration, and Foundation Summary

- **Toolchain (`origin/main`):** Node 26 + `pnpm` + `vitest` + vendored Vibestack (`pnpm run spec:sync`, `pnpm run check`, `pnpm run spec:check-generated`, `pnpm run quint:check`, `pnpm run typecheck`, `pnpm run test:integration`, `pnpm run security`, `pnpm run test:e2e`, `pnpm run sim`). Do not use Bun or `bun:test`.
- **Database Migration (`packages/db/migrations/0098_meetup_venues_external_matchmaking.sql`):** Takes the next free prefix after `0097_participation_booked_told.sql`. Adds `platform.venues` (`CHECK (is_public = true)`, `all_ages`, red-line capability columns, status lifecycle), `platform.venue_api_cache`, `network.venue_visits`, `network.venue_rejections`, `network.meetup_arrivals`, `network.venue_concurrent_holds`, `platform.matchmaker_personas` (10 seeded launch personas), `platform.external_events`, `platform.external_event_rsvps`, `platform.external_prospects`, `platform.external_prospect_suppressions`, and `platform.external_sourcing_tickets`, preserving `network_service`/`platform_service` grants and `ENABLE + FORCE ROW LEVEL SECURITY` isolating `slop` external tables from `peon`.
- **Five-City Registry & Venue Catalog Foundation (`packages/core/src/cities.ts`, `packages/core/src/venues.ts`):** Supports `sf`, `nyc`, `la`, `chicago`, and `miami` (75 verified public seed venues including 15 hobby-native venues; `allAges` marked per `spec/friendIntroAge.md`), barrier-aware minimax midpoints (`6 * max + 4 * mean` integer scaled, `+5m/+10m` bounded relaxation), Google Places API (New) discovery halted once `>= 10` local qualified venues exist, `24h` weekday / `6h` weekend pre-recommendation open checks (`>= 90m` date / `>= 120m` group open buffer), immediate `suspect_closed` closure quarantine, and the 100-point group walk-in rubric.

---

## 2. Profile -> Ideas -> Research -> Top-1 Suggestion and Pivot Loop

### 2.1 Hard Red Lines vs. Soft Preferences

Profile extraction (`slop/extract.ts`, `friends` onboarding, open chat, and rejection replies) separates non-negotiable **Hard Red Lines** from ranking **Soft Preferences**. Every hard red line is stored as a structured `Facet` (`kind: "boundary"`, `scope: "agent_private"`). The agent enforces the **union of all attendees' hard red lines** before any ranking runs and **never discloses a member's private red line** to another attendee (for example, never say *"we picked a cafe because Alex is in recovery"*).

| Layer | Structured Attributes | Hard Gate Behavior (`spec/venueSelection.md` / `spec/suggestionFlow.md`) |
|---|---|---|
| **3-Level Alcohol Boundary** | `drinks_ok` \| `alcohol_optional` \| **`strict_sober`** | `alcohol_optional` excludes `isBarOnly` venues and requires NA options (`nonDrinkerNeverBar`). **`strict_sober`** (recovery/religious) HARD EXCLUDES all alcohol-centric venues (`isAlcoholCentric`: bars, breweries, wine bars, cocktail lounges, taprooms, beer gardens) even when they serve NA drinks (`strictSoberNeverAlcoholCentric`), and forbids `drinks` / `wine_bar` / `cocktail` activities in `dateActivityAllowed`. |
| **Dietary & Severe Allergens** | `vegetarian`, `vegan`, `halal`, `kosher`, `gluten_free`, `severe_allergen` (peanuts/tree nuts, shellfish, dairy, sesame) | Unknown venue dietary capability **fails closed** when any attendee carries that red line (`allergenAndReligiousDietRespected`). Severe allergens exclude single-cuisine high-cross-contact spots (e.g., seafood-only or peanut-heavy kitchens). |
| **Mobility & Accessibility** | `wheelchair_accessible` (step-free entry + accessible restroom), `low_walking` (<5 min from transit/drop-off; no hikes or long walks) | Hard-excludes non-accessible venues and forbids `hike` / long walk activities in `dateActivityAllowed`. |
| **Sensory & Environment** | `smoke_free` (no smoking patios, hookah, or cigar lounges), `low_noise_required` (`noiseTier <= 1`: quiet/conversational only, zero live music), `indoor_required` / `pet_allergy` | Hard-excludes violating venues regardless of vibe score. |
| **Age & All-Ages Safety** | `allAges` (in-network teen friend intros per `spec/friendIntroAge.md`), `ageMin` | Any in-network `friends.help` / `ntwrk` Friend roster containing a minor requires `allAges === true` (`ageMin <= 13`, low risk, not a bar/alcohol/private home/adult door policy). Dating, work, and external events strictly require all participants `>= 18`. |
| **Safety & Timing** | `public_only` (global, always `true`), `daytime_only` (start and end before local sunset), after-dark floor (`>= 19:00` or `< 07:00`) and first-meet floor | When `isAfterDark || isFirstMeet`, require `safetyScore >= 7 && transitScore >= 3` as a hard gate (not just soft rubric points). First encounters cap start time at `<= 21:00` local (`afterDarkSafetyAndTransitFloor`). |
| **Logistics & Activity Caps** | `maxBudgetTier` (`0..4`, ceiling = `min` across attendees), `maxTravelMinutes` (`min(cityLimit, memberLimit)`), `excludedCategories` (e.g., `no_coffee_dates`) | Never violated to force a match. If zero venues pass, relax *only* travel radius (`+5m` up to `+10m`) or shift time window; if still empty, ask one clarifying question. |
| **Soft Preferences (Ranking Only)** | Interests/hobbies (`casual \| core` affinity), favorite cuisines/drinks, atmosphere (`cozy`, `lively`, `outdoorsy`, `upscale`, `casual`, `creative`), preferred neighborhoods, format (`1:1`, `3-6`, `6-15`) | Applied strictly *after* 100% of hard red lines pass. |

### 2.2 Mode-Specific Idea & Venue Ranking (`friends` vs. `slop`)

`modeVenueScore` (`spec/suggestionFlow.md` -> `packages/core/src/generated/suggestionFlow.ts`) computes a deterministic integer score (`0..100`) with distinct objectives for friendships versus first dates:

1. **Friends (`friends` — Strong Interest Bias):**
   - Strangers making friends need a shared focal object ("shoulder-to-shoulder" activity lowers social anxiety compared to staring across a coffee table).
   - **Step 1 (Hobby Anchor):** Identify the strongest shared hobby cluster (`pokemon_tcg`, `board_games`, `bouldering`, `running`, `chess`, `books`, `film`, `photography`, `ceramics`, `pickleball`).
   - **Step 2 (Hobby-Native Venue Mapping First):** Prioritize specialized public categories before generic food halls or cafes:
     - `pokemon_tcg` / `mtg` / `board_games` -> `game_store` (LGS with open-play tables; check weekly store tournament calendar to avoid colliding with Friday Night Magic / Prereleases), `board_game_cafe`, large-table `food_hall`.
     - `bouldering` -> `climbing_gym` (independent day pass).
     - `books` / `writing` -> `bookstore_cafe`, `community_space` / public library + nearby `bakery_cafe`.
     - `running` / `photo_walk` / `chess` -> `park` / `waterfront_park` + adjacent indoor `coffee_shop` backup.
     - `vinyl` / `film` -> `listening_bar` (only for adults when alcohol is allowed), indie theater + nearby `diner` or `tea_house`.
   - **Formula (`friends`):**
     $$\text{score}_{\text{friends}} = 0.35 \cdot \text{activityFit} + 0.30 \cdot \text{groupRubric} + 0.15 \cdot \text{travel} + 0.10 \cdot \text{budget} + 0.10 \cdot \text{persona}$$
   - **Seed coverage:** Each of the five launch cities includes verified hobby-native public venues in `packages/core/src/cities.ts` (such as Gamescape SF, Hex & Co NYC, Geeky Teas & Games / Guildhall LA, Dice Dojo Chicago, Tate's / Pro-Play Miami, plus dedicated tea houses and board-game cafes, with explicit `allAges` metadata).

2. **Dates (`slop` — Balanced Classic Date-Vibe Bias):**
   - **Default First-Date Bias:** Low-commitment, conversation-first, easy-exit public venues (60–90 min natural duration): `coffee_shop` / `tea_house` (daytime), `wine_bar` / `cocktail_bar` / `casual_bistro` / `dessert_cafe` (evening, only when neither attendee is `strict_sober` or `alcohol_optional` bar-excluded), or `bakery_cafe` / `bookstore_cafe` / `museum_gallery` / `food_hall` (sober or daytime).
   - **Strict Niche-Hobby Rule for First Dates:** Never force a niche hobby (such as Pokemon TCG, pickup basketball, or a long hike) onto a first date unless **(a) both members hold high affinity for that exact hobby AND (b) both opted into activity first dates** — and even then keep the venue public, conversational, and easy to exit within 90 minutes.
   - **Formula (`slop`):**
     $$\text{score}_{\text{slop}} = 0.30 \cdot \text{dateVibeFit} + 0.25 \cdot \text{persona} + 0.20 \cdot \text{travel} + 0.15 \cdot \text{budget} + 0.10 \cdot \text{safetyAcoustics} + \text{slopNicheHobbyBonus}$$
     where `slopNicheHobbyBonus` (`+15` max, total clamped to `100`) applies **only** when both high-affinity and activity-date opt-in flags are true.

### 2.3 Location Balancing Strategy (Minimax Midpoint + Bounded Near-One Exceptions)

Build on `fairMidpointCostScaled` and `isValidMidpoint` (`spec/venueSelection.md`: `0.6 * max + 0.4 * mean - beta * log(1 + supply)`) with three pragmatic routing rules:

1. **Default — Fair Minimax Midpoint:** Protects the farthest attendee and snaps to high-supply transit hubs (Flatiron/LES in NYC, Hayes Valley/SoMa in SF, Fulton Market/Loop in Chicago, Culver City/Arts District in LA, Brickell/Wynwood in Miami).
2. **Bounded Near-One Exceptions (only while every attendee stays `<= cityLimit + maxRelax`):**
   - **Accessibility / tight-window exception:** When one attendee has `wheelchair_accessible`, `low_walking`, or a tight time window, anchor near their accessible transit hub while verifying the other person stays within `cityLimit`.
   - **Scarce hobby-venue exception:** When only 1–3 suitable hobby venues exist in the city (e.g., an LGS with open-play tables), select the venue minimizing `fairMidpointCostScaled` even if travel is asymmetric (e.g., 10 min vs. 28 min), provided `maxTravel <= groupMaxMinutes + maxRelax`.
3. **Transit & Parking Tie-Breaker:** In `nyc`, `sf`, and `chicago`, prefer zero-transfer subway/L/BART lines over shorter straight-line commutes requiring 2+ transfers. In `la` and `miami`, prefer venues with lot/validated parking or clean rideshare drop-off (`transitScore >= 4`).

### 2.4 Top-1 Suggestion and Low-Friction Rejection / Pivot Loop

Sending a 5-option menu stalls SMS threads and deadlocks groups. The agent always pre-computes **Top-3 ranked venues + 1 pre-verified nearby Backup** internally and presents **exactly Top-1** (`Venue + Neighborhood + Time + 1-line why`) with an explicit escape hatch.

**Bounded Pivot State Machine (`MAX_SUGGESTION_PIVOTS = 3`, proved in `spec/suggestionFlow.md`):**

```
[Offer #1: Top-1 Pick]
   |-- "yes" -------------------------------> [Locked + Pre-Brief Scheduled]
   |-- rejection #1 (classify reason) ------> persist venue_rejection + update red lines
   |                                          -> [Offer #2: Orthogonal Swap]
   |-- rejection #2 (classify reason) ------> persist venue_rejection + update red lines
   |                                          -> [Offer #3: Contrasting Pick + 1 Vibe Question]
   |-- rejection #3 (pivotsUsed == 3) ------> STOP pitching venues
                                              -> [ask_user_spot_or_pause]
                                                 (verify user's public spot OR retry next week)
```

- **Rejection reason classification:** Classify pushback into `too_far`, `wrong_vibe`, `price`, `already_been`, `red_line`, `bad_time`, or `bare_no`. Immediately write venue-specific rejections to `network.venue_rejections` and update any newly revealed hard red line (e.g., *"actually I don't drink"* immediately upgrades the member's alcohol boundary).
- **Zero-blame multi-party negotiation:**
  - **1:1 Date:** Lock overlapping time window first. If Person A rejects Venue 1, **never tell Person B that Person A rejected it**. If Person B has not been told yet, stay silent until Venue 2 is ready; if Person B already accepted Venue 1, send one neutral tweak (*"Quick tweak for Thu at 7pm: let's do [Venue 2, same area] instead. Still works for you?"*).
  - **3–6 Group:** Never run a group venue poll. Lock the venue using the union of all hard red lines + fair midpoint. Only swap the venue for the group if someone flags a **hard red line** or **venue closure**; soft personal preference allows that individual to skip without breaking quorum.

### 2.5 Format Tiers (`1:1`, `3–6`, `6–15`)

| Format | Headcount | Venue Profile (Zero Partnerships) | Hard Operational Caps |
|---|---|---|---|
| **1:1 (`slop` / `friends`)** | `2` | Verified active public venue passing all hard red lines (cafes, tea houses, bistros, wine/cocktail bars if allowed, bookstores, museums, parks in clear daytime, LGS). In-network teen friend pairs require `allAges = true`. | `90m` open buffer; pre-verified backup within 5–8 min walk (`<= 0.8 km`). |
| **Small Group (`friends`)** | `3–6` (quorum `>= 3`; `2–6` for teen circles per `teenRosterSizeAllowed`) | Tier S/A (`groupVenueRubricScore >= 70`): food halls, spacious taprooms (adults only & no `strict_sober`), large all-day cafes, board-game cafes, bookstore-cafes. Any group with a minor requires `allAges = true` activity and place. | `120m` open buffer, `separateChecks = true`, `reservationRequired = false`, `groupSize <= 6` for unreserved non-open venues (`unreservedGroupSizeCapped`). |
| **Open Impromptu Meetup (`friends` sparse/syndicated, 18+ adults only)** | **`6–15`** (hard ceiling `min(15, venue.walkInCapacity)`) | Large-footprint `openEventEligible = true` spaces ONLY: mega food halls, large beer halls/gardens (if alcohol ok), daytime parks + mandatory indoor backup, LGS open-play rooms, library community rooms, bowling/arcade lounges, climbing gyms. | Strictly 18+ adults only (`noMinorInAnyEventOrCoattend`); `groupSize <= 15` AND `concurrentHeadcount + groupSize <= walkInCapacity` across overlapping 2-hour windows (`venueConcurrentCapacityRespected`). |

---

## 3. Impromptu Events Without Venue Partnerships

The Network never signs venue contracts, books private rooms, collects door cover, serves alcohol, or presents itself as venue staff. Every attendee walks in as a regular customer and pays their own tab.

### 3.1 Anti-Disruption Protocol & Concurrent Capacity Lock

1. **Hard Walk-In Cap:** Unreserved small groups cap at `<= 6`; open impromptu meetups cap at `min(15, venue.walkInCapacity)`. Any gathering above `6` at a non-open-eligible venue requires a confirmed reservation (`unreservedGroupSizeCapped`).
2. **Concurrent Multi-Group Lock:** Before assigning a venue to any meetup, query `network.venue_concurrent_holds` for `(venue_id, [start - 2h, start + 2h])` inside a Postgres transaction and enforce `concurrentHeadcount + groupSize <= walkInCapacity` (`venueConcurrentCapacityRespected`). Two separate 6-person groups never ambush a 10-seat cafe simultaneously.
3. **Good-Guest Instructions:** Every pre-brief reminds attendees to order their own drink/food at the counter, keep tables clean, and never put up banners, flyers, or commercial signage.
4. **Mandatory Indoor Backup:** Every outdoor, park, or high-demand walk-in event MUST have a pre-verified open indoor `backup_venue_id` within a 10-minute walk (`<= 1.0 km`).

### 3.2 Anchor / Initiator Rule, T-24h Quorum Gate, and T-3h Check-In

We never publish an empty "ghost event" hoping strangers entertain each other (`externalEventHasConfirmedAnchor`).

- **Hard Minimum:** `>= 1` confirmed adult (`>= 18`) Network member explicitly opted into the **Anchor / Initiator** role.
- **Target Publish Gate:** `>= 2` confirmed Network members before syndicating externally, so a single emergency never leaves zero Network members on site.
- **1-Anchor Sparse Starter Exception:** Allowed ONLY when (a) the sole anchor explicitly consents to starter-host framing, AND (b) a **T-24h Go/No-Go Quorum Gate** (`evaluateExternalEventT24Quorum`) enforces `>= 3` approved external RSVPs (calibrated for ~55% free-event show rate -> expect `2+` externals + `1` anchor = `3+` people in the room). If `< 3` external RSVPs are approved at `T-24h` (and `confirmedNetworkTotal < 3`), auto-cancel cleanly (`cancel_low_quorum`) so the anchor never commutes to an empty venue (`externalEventT24QuorumGuard`).
- **T-3h Anchor Check-In & Failover (`anchorFailoverDecision` in `spec/meetupCoordination.md`):**
  - At `T-3h`, Eliza sends a 1-tap check-in to the Anchor(s).
  - If the active anchor drops out and a second confirmed Network member can step in (`backupNetworkMembers >= 1 && totalConfirmed >= 3`), promote the co-anchor (`promote_co_anchor`) and notify the group transparently.
  - If zero Network anchors remain or `totalConfirmed < 3`, auto-cancel cleanly (`cancel_cleanly`) across SMS and external event platforms before anyone travels (`anchorDropReassignedOrCancelled`, `quorumOrCleanCancelBeforeCutoff`).

### 3.3 Weather and Venue-Full Pivots

- **Weather Check (`T-24h` advisory, `T-6h` final lock):** If forecast temp `< 55°F` or `> 90°F`, rain probability `> 30%`, or AQI `> 150`:
  - Indoor-compatible activity (coffee, chess, Pokemon TCG, book club): auto-pivot at `T-6h` to the pre-verified indoor `backup_venue_id` and broadcast updated address via SMS and external event update.
  - Outdoor-only activity (park run, pickup tennis): postpone cleanly at `T-6h`.
- **Venue-Full vs. Venue-Closed Pivot (`shouldPivotToBackupV2` + `shouldQuarantineVenue` in `spec/meetupCoordination.md`):**
  - Extend `ArrivalState` with `"venue_full"` (long wait, packed room, no walk-in tables).
  - Both `venue_closed` and `venue_full` trigger an **immediate backup pivot broadcast** (bypassing the 60–90s group batch debounce) when a pre-verified backup exists (`venueFullTriggersBackupPivot`).
  - **Crucial distinction:** `shouldQuarantineVenue` returns `true` **ONLY** on `venue_closed` (setting `status = 'suspect_closed'`). On `venue_full`, the venue stays `active` and logs a `crowded` feedback signal for that daypart in `persona_stats`.

---

## 4. Density-Aware Routing (`dense` / `medium` / `sparse`)

`computeDensityTier` (`spec/suggestionFlow.md` -> `packages/core/src/generated/suggestionFlow.ts`) evaluates active, eligible, unblocked local supply for `(city, travel_radius, app, interest_cluster, window)`:

| Density Tier | Threshold (`qualifiedLocalCount`) | `friends` Routing | `slop` Routing | Honest Member Disclosure |
|---|---|---|---|---|
| **Dense** | `friends`: `>= 6` (`>= 3` for 1:1 request)<br>`slop`: `>= 3` compatible (and top reciprocal score `>= STRONG_MATCH_THRESHOLD`) | **100% In-Network Curated.** Run 1:1 or 3–6 curated small group (in-network teen friend intros obey `teenFriendAgeRule`). **0 external listings.** | **100% In-Network Curated.** Run standard `slopPack` `probe_first` flow. **0 external sourcing.** | *"This is a curated Network match — everyone coming is already vetted in The Network."* |
| **Medium** | `friends`: `2–5` compatible<br>`slop`: `1–2` compatible (or below strong threshold) | **Intimate In-Network First.** Offer 1:1 or 3–4 person in-network hangout. Only for **adult-only** groups needing 6+ (e.g., board-game draft), ask anchors whether to open 4–6 external seats. | Run in-network first (with optional `slop_widen`); trigger external matchmaker only if local match fails or score stays below threshold and adult member opted in. | *"I have 2 other people in The Network into [interest] — want to keep it just the 3 of you, or open a few spots publicly?"* |
| **Sparse** | `friends`: `0–1` compatible<br>`slop`: `0` eligible local pairs | **Adult-Only Impromptu Public Interest Meetup + External Syndication.** Recruit adult anchor (`>= 18`), publish to Luma/Meetup/(Partiful kit), screen 18+ RSVPs, invite standout guests post-event. *(Minors never enter external events; never syndicate `slop` 1:1 dates on public event platforms!)* | **Adult-Only External Matchmaker Sourcing** (if member is `>= 18`, Stage-2 ready, `trust == ok`, and opted into `externalScoutOptIn`) + Stage-1 solo concierge. | `friends`: Explicit external-crowd disclosure before confirm (`externalCrowdDisclosedBeforeConfirm`).<br>`slop`: Explicit external-scouting heads-up before scouting. |

---

## 5. External Event Platform Integrations (Luma, Meetup, Partiful)

**Sanctioned-Source Hard Rule (`externalEventIngestSanctionedOnly`):** Only three source codes may enter the catalog (`isSanctionedExternalEventSource` in `spec/externalEventBridge.md`): `0 = host_native` (our own staff-approved pages), `1 = official_api` (Luma Plus / Meetup Pro official APIs), and `2 = member_submitted_public` (public event link shared voluntarily by a member for co-attendance). Auth-wall scraping, unofficial session-token wrappers, bot RSVPs, and cold-DMing guest lists are **strictly forbidden**.

### 5.1 Platform Integration Matrix

| Platform | Integration Mechanism | Cost & Plan Gate | Audience Fit | Operational Workflow & Compliance Guardrails |
|---|---|---|---|---|
| **Luma (`lu.ma`)**<br>*(Primary programmable)* | Official REST API (`https://public-api.luma.com`, `x-luma-api-key`) + **HMAC-SHA256 Webhooks** (`guest.registered`, `guest.updated`, `event.created`, `event.cancellation`; 5s 2xx SLA). | **Luma Plus**: $59/mo annual ($69/mo monthly) per calendar. 0% fee. | Urban 20s–30s tech/creative in SF, NYC, LA, Miami; organic Luma Discover eligibility. | Draft in Observatory -> **Review Gate (`automatedReview.md` + Staff Publish Approval)** -> `POST /v1/events/create` with `require_approval = true` and `hide_guest_list = true` -> HMAC webhook syncs RSVPs -> Staff approves 18+ guests via `POST /v1/events/guests/update-status`. |
| **Meetup.com**<br>*(Best hobby cold-start)* | Official GraphQL API (`https://api.meetup.com/gql-ext`, OAuth 2.0 Bearer): `createEvent`, `rsvps`, `eventRegistrationAnswers`. **No reliable webhooks -> 10-min polling** (~500 pts/60s cap). | **Meetup Pro**: ~$47–$55/group/mo. Run **1–2 umbrella groups per city** (avoid per-hobby fee explosion). | Niche hobbies (Pokemon TCG, board games, chess, running, books) and Chicago/non-tech audiences. | Draft -> **Review Gate** -> `createEvent` -> 10-min RSVP poll -> approve screened 18+ guests. Zero scraping/harvesting of attendee emails outside Pro tools; Anchor rule satisfies Meetup's real-host requirement. |
| **Partiful**<br>*(Human-assisted social share)* | **NO official public API or webhooks.** Unofficial bots/scrapers violate ToS and cause account bans -> **100% Human-Assisted Event Kit**. | **Free** for standard events and SMS blasts. | Casual 20s–30s social hangouts in NYC, SF, LA; link-driven viral sharing + Explore. | Backend generates copy-paste **Event Kit** (scrubbed title, description, screening Qs, cover prompt) in Observatory -> Staff creates event in ~60s with Guest Approval + Hidden Guest List -> pastes `partiful.com/e/...` URL back -> updates approved headcount. **Mandatory `scrubPartifulTelecomCopy()`:** strips/rewrites alcohol, cannabis, gambling, and adult keywords that Partiful's carrier filter blocks on SMS blasts. |

### 5.2 Mandatory Screening, Hidden Guest List, and Overbooking Math

1. **Privacy & Safety Flags (`hostedEventGuestListHiddenAndGated`, `noMinorInAnyEventOrCoattend`):**
   - Every Network-hosted external page MUST enable **`hideGuestList = true`** and **`approvalRequired = true`**. Exact venue address releases only after approval.
   - Every RSVP must answer two mandatory screening questions:
     1. *"Confirming this is an 18+ adult meetup — are you 18 or older?"* (Any non-explicit-yes is declined immediately; phone/handle cross-checked against `platform.people.lowest_age`, `platform.banned_phones`, and `person_holds`).
     2. *"What's your favorite [deck/game/hobby detail] or what are you hoping to play/chat about?"* (Filters bots, promoters, and bad-faith signups).
2. **Overbooking Math (`computeApprovedExternalCap` in `spec/externalEventBridge.md`):**
   - Free external listings experience ~45% no-show (`55%` show rate) versus `85%` for confirmed Network members.
   - Given `N_net` confirmed Network members, `V_cap = min(15, venue.walkInCapacity)`, and `targetRoomSize`, compute integer-exact ceiling:
     $$\text{rawCap} = \left\lceil \frac{100 \cdot \text{targetRoomSize} - 85 \cdot N_{\text{net}}}{55} \right\rceil$$
     $$\text{approvedExternalCap} = \max\Big(0,\ \min\big(\text{rawCap},\ V_{\text{cap}} - N_{\text{net}}\big)\Big)$$
   - **Hard physical safety clamp:** `N_net + approvedExternalCap <= min(15, venue.walkInCapacity)` ALWAYS holds — even if 100% of approved guests show up, the venue is never overrun. Extra signups stay on waitlist and promote on cancellation until `T-3h`.
   - **T-24h Confirmation Scrub:** Send one platform reminder at `T-24h` inviting anyone who cannot attend to release their spot to the waitlist.

---

## 6. Per-City Dual-Persona Matchmakers

### 6.1 Registry, Dual-Vertical Mandate, and ToS-Safe Posture

`CityMatchmakerRegistry` (`packages/core/src/externalMatchmaker.ts`) registers **2 matchmaker personas per supported city (1 female, 1 male — 10 total across the 5 launch cities)** and extends cleanly via `registerCityMatchmakers(city, female, male)` when city #6+ launches.

| City | Female Persona | Male Persona | Local Time Zone | Primary Hubs |
|---|---|---|---|---|
| `sf` | `sf-f` | `sf-m` | `America/Los_Angeles` | Hayes Valley, Mission, SoMa, North Beach |
| `nyc` | `nyc-f` | `nyc-m` | `America/New_York` | Flatiron, West/East Village, Williamsburg |
| `la` | `la-f` | `la-m` | `America/Los_Angeles` | Arts District, Culver City, Silver Lake, WeHo |
| `chicago` | `chi-f` | `chi-m` | `America/Chicago` | West Loop/Fulton Market, The Loop, Wicker Park |
| `miami` | `mia-f` | `mia-m` | `America/New_York` | Brickell, Wynwood, Coral Gables |

- **Dual-vertical mandate:** Each city pair serves **both `slop` (1:1 adult dating)** and **`friends` (1:1 / 4–6 adult group hosting)**. When hosting `friends`, personas strictly obey `packages/engine/src/packs/friends/copy.ts` (zero romance/singles/flirt framing).
- **ToS-safe human-operated posture (existential legal guardrail):** Hinge, Bumble, and Tinder prohibit headless automation, bots, scrapers, and deceptive romantic personas, backed by Face Check 3D liveness biometrics, cross-app Match Group bans, FTC Act §5 (16 CFR 461/465), and CA SB 1001/243. Therefore:
  - **Tier 1 Sourcing (Zero-Ban Primary):** Open-web Date-Me Docs, Luma/Partiful/Meetup micro-events, IRL salons, and member friend nominations.
  - **Tier 2 Sourcing (Human-Operated Matchmaker Accounts):** Real human city operators using their own verified identity/liveness with an **explicit upfront matchmaker bio** (zero romantic deception), assisted by Eliza/Review Desk for drafting and tracking, **human-reviewed before outreach** (`humanReviewRequiredBeforeExternalOutreach`), **zero URLs or brand spam** (`personaDisclosureAndNoLinksEnforced`), and ultra-low human volume caps (`<= 8–12` new conversations/day spaced organically between `10:00–20:00` local; `<= 2` active prospects per Network member).

### 6.2 Deterministic Persona Routing and Cross-Persona Consistency Lock

`routeMatchmakerPersona` (`spec/externalMatchmaker.md` -> `packages/core/src/generated/externalMatchmaker.ts`) maps every sourcing request deterministically and enforces `singlePersonaPerProspect`:

| Context / Target Prospect | Assigned Persona | Rationale |
|---|---|---|
| `slop`: Member seeks **men** (woman/NB seeking men) | City Female (`<city>-f`) | Aligns with men-seeking-women discovery pool and warm connector framing. |
| `slop`: Member seeks **women** (man/NB seeking women) | City Male (`<city>-m`) | Aligns with women-seeking-men discovery pool. |
| `slop`: **Woman seeking women** (WLW) | City Female (`<city>-f`) | Operates in WLW discovery pool with peer orientation alignment. |
| `slop`: **Man seeking men** (MLM) | City Male (`<city>-m`) | Operates in MLM discovery pool with peer orientation alignment. |
| `slop`: **Nonbinary** or **multi-gender** prospects | Split per prospect gender (`-f` for men/WLW, `-m` for women/MLM; deterministic `hash % 2` for NB) | Guarantees every individual prospect interacts with exactly ONE persona. |
| `friends`: 1:1 or 4–6 adult hangout hosting | Deterministic per-event host (balances table ratio) | Single consistent platonic host per thread. |

- **Cross-Persona Consistency Lock (`singlePersonaPerProspect`):** Keyed by `(city, prospect_dedupe_hash)` (HMAC-SHA256 with server pepper). The first persona to contact or cache a prospect holds an exclusive lock at both the database unique constraint (`UNIQUE (city, dedupe_hash)`) and `spec/externalMatchmaker.md` level. The sibling persona in that city (across both `slop` and `friends`) is permanently blocked from contacting the same prospect.

### 6.3 Kill-Switch, Zero Evasion, and Failover Without Stranding Booked Setups

- **Ban / Shadowban Signals:** 0 replies/impressions over 48h, unmatch rate `> 30%` over rolling 15 chats (halves daily cap), or any verification challenge, Face Check lock, warning, or suspension.
- **Immediate Kill-Switch (`personaKillSwitchHaltsOnBanSignal`):** Any ban/challenge signal immediately transitions `personaStatus` to `degraded` or `suspended`, halts all queued outbound sourcing on that platform/city, and alerts staff.
- **Zero Ban Evasion (`noEvasionAfterPersonaSuspend`):** Never spin up burner accounts or re-contact prospects on a suspended platform using the sibling persona or alternate device/IP.
- **Zero Stranded Booked Dates:** Because every confirmed setup moves to logged off-app SMS logistics *before* entering `venue_verified_booked`, active booked dates and `meetupCoordination` arrival relays continue seamlessly with zero disruption. Unconfirmed on-app leads close honestly and Member A fails over to Tier-1 sourcing (Date-Me Docs, Luma/Partiful micro-events, friend vouching).

---

## 7. Dual-Side External Sourcing, Privacy Cache, and Quality-Gated Onboarding Funnel

### 7.1 Synchronized Dual-Side State Machine

```
[member_sparse] --> [brief_review (Review Gate 1)] --> [scouting]
  --> [prospect_qualifying (18+ & red lines)] --> [prospect_soft_yes]
  --> [pair_review_desk (Review Gate 2 / automatedReview.md)] --> [member_probed (Side A)]
  --> [member_yes (explicit answer:"yes")] --> [prospect_sms_optin (TCPA/FTSA)]
  --> [venue_verified_booked] --> [pre_brief (T-75m)] --> [active_arrival (T-30m..T+45m)]
  --> [completed] --> [member_followup (meetupCoordination)] --> [quality_gate]
  --> [warm_invite (max 1) | close_no_invite]
```

- **Strict Ordering Invariants:**
  1. Prospect qualifies (`18+`, hard red lines, soft yes) **before** Member A is probed (protects Member A's `OUTREACH` budget from dead leads).
  2. Approval gates (`automatedReview.md` + human review for external briefs/outreach) clear both the anonymized sourcing brief (Gate 1) and the candidate pairing (Gate 2) before Member A is contacted.
  3. Member A gives explicit `answer: "yes"` (`classifyYesNo` — a counter is not a yes) **before** booking or revealing any identity detail.
  4. Prospect provides explicit logged off-app SMS consent (or initiates inbound-first SMS on a dedicated A2P 10DLC number, **never** cold-texting on the shared Blooio line) **before** off-app logistics begin (`externalOutreachRequiresConsentAndNotSuppressed`).
  5. All relayed messages pass `fenceUntrusted()` -> `LeakGuard.checkThread` -> `appearanceLeak` -> `clefRelayClassifier` (`clef-flash`, fail-closed in production).

### 7.2 Privacy-Minimized Prospect Cache (`platform.external_prospects`)

Because GDPR Art. 14/17 and CCPA SB 923 / CA Delete Act cover non-member data, the prospect cache is geo-fenced strictly to the 5 U.S. launch cities and enforces hard minimization and TTL expiry (`prospectCacheBoundedAndPurgedOnOptOut`):

- **Allowed Fields Only:** `id` (UUID), `city`, `source_platform`, `assigned_persona_id`, `dedupe_hash` (HMAC-SHA256 of normalized handle/ID), `phone_hash` (only after SMS opt-in; cross-checked against `platform.banned_phones`, `person_holds`, `person_blocks`, `lowest_age`), `first_name` (active/consented only), `stated_age` (`CHECK (stated_age BETWEEN 18 AND 120)`), `gender`, `seeks`, coarse `neighborhood`, structured `facets` (strictly excluding `NEVER_USED` race/ethnicity/health/income tags), `consent_state` (`none | intro_single_only | intro_future_optin | sms_logistics_optin | declined | stopped | banned`), `consent_at`, `expires_at`, `recontact_count`, `converted_member_id`.
- **Never Stored:** Raw HTML/JSON profile scrapes, unconsented photo binaries/URLs, full external chat transcripts, raw social handles post-purge, or Clef appearance scores on non-members.
- **Retention & Immediate Purge (`prospectRetentionDecision`):**

| Prospect State | Max TTL | Action on Trigger / Expiry |
|---|---|---|
| Unconverted / uncontacted lead | **14 days** (hard cap `<= 30d`) | Hard-delete all PII and facets; remove row. |
| Declined / ghosted / setup failed (no future opt-in) | **Immediate** on explicit decline (max 7d post-close) | Hard-delete PII, first name, facets, and contact; retain ONLY keyed HMAC suppression tombstone in `platform.external_prospect_suppressions`. |
| Explicit `intro_future_optin` | **60 days** rolling | Optional single renewal check before expiry; otherwise hard-delete PII and facets. |
| **`STOP` / `STOP ALL` / block / deletion request (`help@ntwrk.party`) / underage (`< 18`) / safety red flag** | **0 seconds (Immediate)** | Atomic cascade purge of all PII, facets, and active setups; write permanent keyed HMAC suppression/ban tombstone enforced across all cities, personas, and apps. |

- **No Cold Reuse (`canReconsiderExternalProspect` -> `noColdReuseWithoutExplicitOptIn`):** Reusing a cached prospect for a second Network member is permitted **only** if `consentState == "intro_future_optin"`, `cacheAgeDays <= 60`, `daysSinceLastContact >= 30`, `recontactCount < 2`, `statedAge >= 18`, `!optedOut && !banned && !redFlagged`, `personaMatchesLock == true`, and `humanReviewApproved == true`.
- **Cross-App Firewall (`canReadExternalProspectInApp` -> `crossAppScoreFirewall`):** `platform.external_prospects`, `platform.external_sourcing_tickets`, `platform.external_prospect_suppressions`, and `slop` appearance ratings are isolated by schema, Postgres `FORCE ROW LEVEL SECURITY` (`0098_meetup_venues_external_matchmaking.sql`), and generated Vibespec guards so `peon.biz` can **never** read dating ratings or external dating prospect records (preventing EU AI Act Art. 5(1)(c), Title VII, and NYC LL144 exposure).

### 7.3 Post-Meetup Quality-Gated Network Onboarding Funnel

**Core Rule:** *Prove real-world quality first; invite to The Network second.*

1. **Meetup completes** through `venues.ts` + `meetupCoordination` (public venue, arrival relay, no-show guard).
2. **Side A (Network Member) gives feedback first**, scheduled via `computeFollowupLocalHour` / `canSendFollowup` (daytime `end + 2h`, evening next day `9:30 AM` local, `20:30–09:00` quiet hours, `< 3/day` cap).
3. **Hard Quality Gate (`canInviteExternalProspectToNetwork` / `canInviteExternalEventAttendee`):**
   Returns `true` **only when ALL hold**:
   - `meetupCompleted && memberAttended && prospectAttended` (zero flakes)
   - `!safetyOrRedFlag && !catfishOrAgeMismatch`
   - `memberQualityPositive || memberVouchedForOthers` (covers both romantic spark and respectful *"great person, wrong fit for me"* vouch)
   - `statedAge >= 18 && statedAge <= 120`
   - `!optedOut && !banned && !alreadyMember`
   - `inviteAttempts == 0` (at most **1 invite ever** — zero pestering)
   - `safeFollowupWindow == true` (`canSendFollowup` quiet hours + 3/day cap)
4. **On Pass:** Send one warm personal invite (through the opted-in SMS thread or originating Luma/Meetup platform after review). On explicit `yes`, run standard phone-confirmed onboarding with `readBack()` facet confirmation.
5. **On Fail (negative feedback, flake, red flag, or silence):** Send **0 invites**. Log safety cases/bans on red flags or age mismatches, and purge PII per TTL.

---

## 8. Verbatim-Ready SMS and Matchmaker Scripts

All SMS copy obeys `packages/network/src/copy.ts` `styleViolations`: **`<= 360` characters**, **at most 1 `?` per message**, never tells users to *"reply cancel"* (bare `CANCEL` triggers carrier `STOP`), never discloses who declined or any private red line, and includes **zero URLs or brand names** on dating apps.

### 8.1 Happy Paths — Dates (`slop`), Friend 1:1, and Impromptu Events (`friends`)

| Scenario | Channel | Verbatim Script |
|---|---|---|
| **Date 1:1 Probe** | SMS (Side A) | `Quick check, no names yet: found someone nearby who's also into indie film and quiet spots. Up for a low-key first date Thu 7pm or Sat 3pm near Hayes Valley?` |
| **Date 1:1 Top-1 Venue Pick** *(red lines respected silently)* | SMS (Side A/B) | `You're both in — meet Maya Thu at 7pm. I picked Sightglass on 7th St (cozy, great espresso & tea, easy 15 min trip for both of you). Works for you, or want me to swap the vibe or neighborhood?` |
| **Pre-Arrival Brief (`T-75m`)** | SMS (All) | `Heads up for 7pm with Maya at Sightglass Coffee (270 7th St). Easy spot to find each other: right inside by the main roaster counter. Text me here if you're running late, or anytime if anything feels off.` |
| **Arrival Relay (`T-5m`)** | SMS (Relay) | `Maya says: just got here, wearing a dark green jacket near the roaster counter.` |
| **Post-Date Follow-Up** *(next day 9:30 AM)* | SMS (Side A) | `Morning! How did it go with Maya at Sightglass — would you want to see her again, and was the spot a good vibe?` |
| **Friend 1:1 Probe** *(interest-biased)* | SMS (Side A) | `Quick check, no names yet: someone nearby is also into Pokemon TCG and wants to play a few casual games. Up for a 1:1 meetup at Hex & Co West Sat at 2pm?` |
| **Friend 1:1 Booked** | SMS (Both) | `You're both in: meet Alex Sat at 2pm at Hex & Co West (2911 Broadway) for Pokemon TCG — everyone pays their own table fee. Reply if plans change or if you'd prefer a different spot.` |
| **Friend Sparse Anchor Pitch** | SMS (Anchor) | `Not enough Pokemon TCG folks in The Network in SF yet for a private group, so I can spin up an impromptu casual TCG night Thu 6:30pm at Gamescape on Divisadero and list ~8 spots on Luma/Meetup. Would you be down to anchor it with me?` |
| **Anchor Confirmation** *(honest expectation)* | SMS (Anchor) | `Awesome — you're our anchor. I'll screen RSVPs (18+, real players) and aim for 5–8 people in the room, mixing Network folks and local Luma/Meetup signups. If fewer than 3 confirm by Wed 6:30pm, we'll call it early so you don't waste a trip.` |
| **T-24h Roster Update** | SMS (Anchor) | `Quick check for tomorrow's Pokemon night at Gamescape (6:30pm): we have 2 Network folks and 7 approved local RSVPs (usually ~5–6 make it). Still good to go?` |
| **T-3h Anchor Check-In** | SMS (Anchor) | `Quick check before tonight's Pokemon night at Gamescape (6:30pm): still good to make it on time as our anchor?` |
| **Post-Event Anchor Follow-Up** | SMS (Anchor) | `Morning! How was Pokemon night at Gamescape — good turnout and vibe, and was there anyone awesome who should get an invite to The Network?` |
| **Dense Curated Disclosure** | SMS (Member) | `This is a curated Network match — everyone coming is already vetted in The Network.` |
| **Mixed Impromptu Disclosure** | SMS (Member) | `Heads up so you know what to expect: this is an open interest meetup with 1–2 Network folks plus local Luma/Meetup guests we screened. Free public meetups can have a couple of last-minute flakes, so we invite a few extra.` |
| **Post-Event Quality-Gated Guest Invite** *(1 msg max)* | Luma/Meetup / Opted-In | `Hey [FirstName], thanks for coming to [Event] at [Venue]! [AnchorName] said you brought great energy. We run small local hangouts through The Network — if you'd like an invite for future ones, here's your link: [URL]. No pressure either way.` |

### 8.2 Suggestion Rejection & Pivot Loop Scripts

| Turn | Verbatim Script |
|---|---|
| **Rejection #1 (`wrong_vibe` / `too_loud`)** | `Fair call — I'll note you prefer quieter, non-brewery spots. How about Tartine Bakery in the Mission instead (same Thu 7pm, great pastry & tea, easy to talk)?` |
| **Rejection #2 (`too_far`)** | `Got it, let's keep it closer to you. What about Conwell Coffee Hall in FiDi (10 min from you, quiet booths), or is there a neighborhood you'd rather stick to?` |
| **Rejection #3 (`MAX_SUGGESTION_PIVOTS = 3`)** | `Looks like my picks aren't hitting the mark tonight. Want to name a public spot you like near you and I'll check if it works, or should we try again next week?` |
| **Silent Partner Venue Swap** *(never blames A)* | `Quick tweak for Thu at 7pm: let's do Conwell Coffee Hall (same area, quieter tables) instead. Still works for you?` |

### 8.3 Happy Paths — External Matchmaker Scripts (Side A & Side B)

| Step | Side / Channel | Verbatim Script *(zero URLs or brand names on dating apps)* |
|---|---|---|
| **Side A Sparse Heads-Up** | SMS (Member A) | `Quick heads up: our local [City] circle is light for your exact criteria, so our [City] matchmaker can scout outside the network for you. Same rules — I'll vet them against your dealbreakers first and only text you if I find someone solid. Cool if I look?` |
| **Side B Dating Opener / Transparent Pivot** | Dating App (Human Matchmaker) | `hey [Name] — quick heads up so i'm not wasting your time: i'm actually a local matchmaker here in [City] (not dating on here myself). saw your prompt about [detail] and i've got someone great i'd love to connect you with if you're interested, do you mind if i set it up?` |
| **Side B Friends Opener** *(zero romance words)* | Platform / Event | `hey [Name] — saw you're into [hobby/neighborhood]. i organize small 4-5 person [activity] hangs in [Neighborhood] for folks looking to expand their circle (totally platonic). doing one [Day] around [Time] — want me to save you a spot?` |
| **Side B Qualify 1 (18+ & Red Lines)** | Dating App | `awesome — quick sanity check so i don't waste your evening: confirming you're 18+, and are there any hard dealbreakers i should know (sober/alcohol, smoking, dietary, what you're looking for)?` |
| **Side B Qualify 2 (Anonymized Pitch)** | Dating App | `they're in their [ageBand], live near [general area], super into [1–2 shareable interests], and looking for [goal]. sound like someone you'd want to grab [activity] with?` |
| **Side A Vetted Candidate Probe** | SMS (Member A) | `Found someone great outside our current circle for a first date: [activity] in [Neighborhood], [2–3 time options]. They're [ageBand], [distance], and into [interest]. Want me to lock it in (first names and exact spot shared only if you're both a yes)?` |
| **Side B Off-App SMS Opt-In** *(TCPA/FTSA)* | Dating App | `great — if they're a yes too, i coordinate the spot and day-of check-in over text so neither of you has to share numbers until you meet. what's the best cell number to text logistics if you're cool getting setup texts from me (text STOP anytime)?` |
| **Quality-Gated Invite — Mutual Spark** | Opted-In SMS | `so glad you and [MemberFirstName] hit it off! by the way, i run a small curated circle in [City] (The Network) for vetted dates and small hangs without swiping. since you're clearly one of the good ones, want an invite to join?` |
| **Quality-Gated Invite — Respectful Vouch** | Opted-In SMS | `glad you two had a good convo even if it wasn't a romantic match — [MemberFirstName] had really nice things to say about you. i run a small vetted circle in [City] for curated dates & low-key friend hangs. want an invite so i can set up a better fit?` |

### 8.4 Unhappy Paths and Failure-Mode Scripts

| Unhappy Path | Verbatim Script & Action |
|---|---|
| **Bot / Scam / Spam Skepticism** | `totally fair to ask — nope, not a bot, not selling anything, no links, nothing to sign up for. i'm [PersonaFirstName], a real local matchmaker helping someone in [City] meet offline. if it sounds weird, no worries at all, i'll leave you be!` *(If still skeptical -> mark `declined`, purge facets, write suppression tombstone.)* |
| **Romantic Confusion ("Why not YOU?")** | `haha i appreciate that! i'm strictly playing matchmaker on here (just setting people up), not dating myself. totally cool if you're not into blind setups — just let me know.` *(Hard anti-flirt boundary; 2nd push -> polite close + purge.)* |
| **Demands IG / Photos / Full Name First** | `i keep everyone's name, socials, and contact private until you're both a yes and actually meet — same goes for your privacy too. you two can swap numbers or socials at the table if you click.` *(Never leak unconsented contact/photo.)* |
| **Mid-Setup Ghost (>24h Silence)** | *To Prospect (1 nudge):* `no rush — still down for [Day] or should i release the slot?`<br>*After 48h, to Member A:* `Scheduling didn't line up on their end — I'm already scouting the next person for you.` |
| **Member A Rejects Prospect** | *To Prospect (never blames A):* `hey [Name], quick update — timing didn't end up lining up on their end this week, so we'll hold off on this one. appreciate you being open to it! want me to keep you in mind if someone else great comes up, or rather i not reach out again?` |
| **Prospect Rejects Member A** | *To Prospect:* `totally get it, thanks for being upfront — have a great week!`<br>*To Member A (silent if not probed; else):* `Timing didn't work out on that one — keeping an eye out for the next fit.` |
| **Underage (`< 18`) Detected** | `Appreciate you saying that — I only set up intros for adults 18+, so I'll close this out. Take care!` *(Atomic purge + permanent suppression + cancel pending setups.)* |
| **Persona Account Suspended (Unconfirmed Lead)** | *To Member A:* `Lost touch with a lead before we locked a time — shifting to another channel to find someone solid for you.` *(Booked off-app setups continue unaffected via SMS.)* |
| **Initiator-Only-One-Shows (`T-24h` Early Cancel)** | `Quick heads up: signups for tomorrow's [Event] stayed light, so I'm pausing it rather than wasting your evening. Want me to retry for next weekend?` |
| **Initiator-Only-One-Shows (Day-Of Flake)** | `Ugh, looks like tonight's external RSVPs flaked — really sorry about that. Feel free to grab a snack or head out whenever you want; I'll prioritize a curated in-network match for you next.` |
| **Running Late / No-Show (`T+12m` / `T+18m`)** | *Late relay:* `Heads up: [FirstName] is running about 15 min behind on transit — feel free to grab a seat or coffee.`<br>*`T+12m` to late:* `[FirstName] is at [Venue] — still heading over?`<br>*`T+18m` to waiting:* `Haven't heard back from [FirstName] yet — feel free to grab something or head out whenever you want, no pressure at all.` |
| **Last-Minute Cancel (`< 2h`, never names decliner)** | *1:1:* `Quick update: this one is off now, sorry about the late change. I'll look for another time for you.`<br>*Group (quorum `>= 3`):* `Quick update: one person can't make it now, sorry. The rest of you are still on at [Venue].`<br>*Sole anchor drops:* `Host had an unexpected emergency, so tonight's meetup is postponed — sorry for the short notice!` |
| **Venue Closed or Full Pivot** | `Quick pivot: [Primary Venue] is [closed / totally packed], so we're moving 4 min away to [Backup Venue] ([Address]). Meet [Backup Landmark].` |
| **Weather Pivot (`T-6h`)** | *Indoor backup:* `Weather looks rough for [Park], so we're moving tonight's [Event] indoors to [Backup Venue] ([Address]) at the same time. Still in?`<br>*Outdoor-only:* `Rain is rolling in for [Activity], so let's postpone today's session rather than getting soaked. Want me to look for next weekend?` |
| **Mid-Date Safety / Panic Exit** | `Got it — head out whenever you feel ready, no explanation needed. Text me once you're somewhere safe; if you're ever in danger, call 911 first.` *(Immediately halts arrival relay, blocks pair cross-app, writes transactional `person_holds`, never tips off other party.)* |

---

## 9. User Stories (`US-23` to `US-40`)

*(Continues cleanly from base five-city venue/coordination stories `US-1`–`US-22` and maps to `F53`–`F56` in [spec/product/stories.md](../../spec/product/stories.md).)*

| ID | App | City | Actor & Scenario | Expected System Behavior & Acceptance Criteria |
|---|---|---|---|---|
| **US-23** | `slop` | `sf` | Adult in alcohol recovery (`strict_sober`) matches with a social drinker for a Thursday 7 PM first date. | `venueRedLinesEligible` excludes all bars, breweries, wine bars, cocktail lounges, and beer gardens (`strictSoberNeverAlcoholCentric`); `dateActivityAllowed` forbids `drinks`; Top-1 recommends a cozy `tea_house` or `coffee_shop` without ever mentioning recovery to the match. |
| **US-24** | `friends` | `chicago` | Group of 5 includes one member with severe peanut allergy (`severe_allergen`), one halal eater (`halal`), and one `low_noise_required` member. | Union of hard red lines excludes unknown-capability kitchens, peanut-heavy venues, non-halal spots, and lively/loud rooms (`allergenAndReligiousDietRespected`, `noiseTier <= 1`); fails closed if dietary metadata is missing. |
| **US-25** | `friends` | `nyc` | Two dense-zone members (including eligible 13–17 teen peers under `teenFriendAgeRule`) share core `pokemon_tcg` affinity and ask for a Saturday hangout. | Strong interest bias (`modeVenueScore`) maps `pokemon_tcg` -> hobby-native `game_store` / `board_game_cafe` (`Hex & Co West`) over generic coffee, verifies `allAges = true` when any minor is in the roster, confirms no store tournament collision, and stays within NYC travel cap. |
| **US-26** | `slop` | `la` | Two adults match on `slop`; Person A lists `pokemon_tcg` and `bouldering`, while Person B prefers classic quiet conversation dates (`activityDateOptIn = false`). | Classic date-vibe bias (`modeVenueScore`) blocks niche hobby venues and proposes a quiet conversational `coffee_shop` or `casual_bistro` with `safetyScore >= 7`, `transitScore >= 3`, and start `<= 21:00` local (`afterDarkSafetyAndTransitFloor`). |
| **US-27** | `slop` | `nyc` | Person A has `wheelchair_accessible` + `low_walking` in Flatiron; Person B lives in Williamsburg. | Bounded near-one exception anchors the venue at a step-free Flatiron transit hub while confirming Person B's commute stays `<= 25m` (`isValidMidpoint`), rather than forcing a walking transfer. |
| **US-28** | `slop` | `sf` | Member A rejects Offer #1 (*"too bar-y"*), Offer #2 (*"too far"*), and Offer #3 (*"not feeling tonight"*). | `canPivotSuggestion` persists rejections, updates red lines on rejection #1, pivots orthogonally on #2 and #3, and halts venue pitching at `MAX_SUGGESTION_PIVOTS = 3` (`suggestionPivotsBounded`), offering user-spot verification or next-week retry; Person B never learns A rejected. |
| **US-29** | `friends` | `miami` | First arrival at `1-800-Lucky` at `T-10m` texts *"super packed, 45 min wait for tables"*. | `shouldPivotToBackupV2` immediately broadcasts pre-verified indoor backup within 5 min walk (`venueFullTriggersBackupPivot`), bypassing 60–90s batch debounce, while `shouldQuarantineVenue` keeps `1-800-Lucky` `active` and logs a `crowded` daypart signal. |
| **US-30** | `slop` | `chicago` | During `active_arrival`, Member A feels unsafe and texts *"need an out, feel unsafe"*. | `canRelayArrivalSafe` immediately terminates arrival relay (`panicOrBlockImmediatelyHaltsRelay`), sends supportive exit script, blocks pair cross-app, and records transactional `person_holds` without alerting Member B. |
| **US-31** | `friends` | `sf` | Sparse local adult density (`qualifiedLocalCount = 1`) for Thursday evening `pokemon_tcg` in SF. | `computeDensityTier` returns `sparse`; Eliza honestly pitches an anchor-hosted 18+ impromptu night at `Gamescape`, sets `hideGuestList = true` & `approvalRequired = true`, publishes via Luma Plus API + Meetup Pro GraphQL after review, and enforces `N_net + approvedExternalCap <= min(15, walkInCapacity)`. |
| **US-32** | `friends` | `la` | Two separate 5-person `friends` groups target the same 8-seat cafe in overlapping 2-hour windows. | Postgres `network.venue_concurrent_holds` lock + `venueRedLinesEligible` enforces `concurrentHeadcount + groupSize <= walkInCapacity` (`venueConcurrentCapacityRespected`), routing the second group to the #2 verified venue. |
| **US-33** | `friends` | `nyc` | Staff generates a Partiful Event Kit for a casual Friday social hangout at a taproom-adjacent food hall. | `scrubPartifulTelecomCopy()` removes alcohol/bar terms so Partiful SMS blasts are not carrier-filtered; staff manually creates the page with Guest Approval + Hidden Guest List (zero unofficial Partiful automation), and pastes the link into Observatory. |
| **US-34** | `friends` | `chicago` | 1-anchor sparse external event has only 2 approved external RSVPs at `T-24h` (and in a second case, the sole anchor drops at `T-3h` with 1 backup Network member present). | At `T-24h` with `< 3` external RSVPs, `evaluateExternalEventT24Quorum` auto-cancels cleanly (`externalEventT24QuorumGuard`). At `T-3h` anchor drop, `anchorFailoverDecision` promotes the co-anchor if `totalConfirmed >= 3`, or cancels cleanly across all platforms if `< 3` (`anchorDropReassignedOrCancelled`). |
| **US-35** | `slop` | `nyc` | Sparse local adult dating pool for an opted-in woman seeking men (`eligibleLocalPairs = 0`). | `shouldTriggerExternalSourcing` passes after brief review; `routeMatchmakerPersona` deterministically assigns `nyc-f` and acquires `UNIQUE (city, dedupe_hash)` lock, blocking `nyc-m` from ever contacting that prospect (`singlePersonaPerProspect`). |
| **US-36** | `slop` | `la` | Human matchmaker `la-m` chats with an adult woman on Hinge who asks *"Are you a bot? Send me his IG first."* | Operator sends transparent matchmaker reply with zero links/brand spam (`personaDisclosureAndNoLinksEnforced`), declines premature IG share, confirms `18+` + red lines, gets review approval, probes Member A, and obtains logged SMS opt-in before booking (`externalOutreachRequiresConsentAndNotSuppressed`). |
| **US-37** | `slop` | `miami` | External prospect declines setup (or texts `STOP`, or reveals age `17`, or emails `help@ntwrk.party` to delete). | `prospectRetentionDecision` immediately executes `purge_with_suppression`, erasing all PII/facets and keeping only a keyed HMAC suppression tombstone checked across all cities, personas, and apps (`prospectCacheBoundedAndPurgedOnOptOut`, `externalProspectAdultOnly`). |
| **US-38** | `slop` | `sf` | Matchmaker account `sf-f` triggers a Hinge Face Check lock while 1 date is already booked on SMS and 1 lead is still unconfirmed on Hinge. | `personaKillSwitchHaltsOnBanSignal` suspends `sf-f` outreach immediately with zero burner evasion (`noEvasionAfterPersonaSuspend`); the booked SMS date proceeds uninterrupted via `meetupCoordination`, while the unconfirmed lead fails over honestly to Tier-1 sourcing. |
| **US-39** | `slop` | `nyc` | External prospect completes a verified date with Member A. Case A: Member A gives positive feedback (or *"nice person, wrong romantic fit — vouch"*). Case B: Prospect flaked or triggered a safety note. | `canInviteExternalProspectToNetwork` unlocks max 1 warm Network invite in Case A inside safe local hours (`networkInviteRequiresPositiveMeetupFeedback`); Case B sends 0 invites and logs safety/suppression state. |
| **US-40** | `peon` | `chicago` | `peon.biz` matching worker queries candidate features for an engineer who also has `slop` Clef appearance ratings and an `external_prospects` history. | `canReadExternalProspectInApp` returns `false` for `peon` and Postgres `FORCE ROW LEVEL SECURITY` blocks all reads of `slop` appearance and external prospect tables (`crossAppScoreFirewall`). |

---

## 10. Failure-Mode and Unhappy-Path Matrix (`FM-19` to `FM-36`)

*(Continues cleanly from base five-city failure modes `FM-1`–`FM-18`.)*

| ID | Failure Mode | Trigger | System Behavior & Recovery | Formal Invariant Name(s) | Simulation / Integration / E2E Coverage |
|---|---|---|---|---|---|
| **FM-19** | **Strict-sober, allergen, religious-diet, or after-dark safety breach** | `strict_sober` member sent to brewery (`alcoholOptional: true`), celiac/nut/halal member sent to unknown kitchen, or blind date scheduled late in low-safety area. | `venueRedLinesEligible` & `dateActivityAllowed` fail closed on alcohol-centric venues, missing dietary safety, and `< 7` safety / `< 3` transit / `> 21:00` first-meet floors. | `strictSoberNeverAlcoholCentric`, `allergenAndReligiousDietRespected`, `afterDarkSafetyAndTransitFloor` | `pnpm run check`; `pnpm run quint:check venue_lifecycle`; sim gate `slop_redline_zero_breach` |
| **FM-20** | **Private red-line explanation leak** | Agent explains venue choice using member's private sobriety, allergy, budget, or disability facet. | Red-line facets tagged `agent_private` and passed into `LeakGuard.checkThread` on all proposals, explanations, and relays. | `redLineFacetsNeverLeaked`, `noLeakOrPrivateContactInArrivalRelay` | `evals/` red-line leak corpus, `shared-agent.integration.test.ts` |
| **FM-21** | **Endless venue-suggestion ping-pong or blame leak** | Member rejects 3+ venues in a row, or partner is told *"Alex rejected your spot"*. | `canPivotSuggestion` enforces `MAX_SUGGESTION_PIVOTS = 3` and transitions to `ask_user_spot_or_pause`; rejected venues never re-proposed; partner copy stays neutral. | `suggestionPivotsBounded`, `noVisitedOrRejectedRecommended` | `spec/suggestionFlow.md`, `pnpm run quint:check venue_lifecycle`, vitest integration |
| **FM-22** | **Venue full at arrival mistakenly quarantines active venue** | First arrival texts *"packed / 45 min wait"*. | `shouldPivotToBackupV2` immediately broadcasts backup venue; `shouldQuarantineVenue` stays `false` (logs `crowded`, never marks `suspect_closed`). | `venueFullTriggersBackupPivot` | `spec/meetupCoordination.md`, `pnpm run quint:check meetup_coordination`, vitest integration |
| **FM-23** | **Mid-date safety panic or leave-vs-report race** | Member triggers safety/panic phrase on site, or reporter leaves app before hold writes. | Immediately kills arrival relay (`onPanicExit`), blocks pair cross-app, writes `person_holds` inside same DB transaction as report, routes by active meetup target. | `panicOrBlockImmediatelyHaltsRelay`, `onlyConfirmedUnblockedAdultsRelayed` | `spec/meetupCoordination.md`, `pnpm run quint:check meetup_coordination`, `pnpm run security` |
| **FM-24** | **Unannounced crowd / concurrent group venue ambush** | Unreserved 10-person group booked at small cafe, or two 6-person groups overlap in a 10-seat venue. | `venueRedLinesEligible` caps unreserved non-open groups at `<= 6`, open events at `<= 15`, and Postgres `venue_concurrent_holds` enforces `concurrentHeadcount + groupSize <= walkInCapacity`. | `unreservedGroupSizeCapped`, `venueConcurrentCapacityRespected` | `spec/venueSelection.md`, `pnpm run quint:check venue_lifecycle`, Postgres concurrency integration test |
| **FM-25** | **Ghost external event, anchor drop, or initiator-only-one-shows** | Sparse event published with 0 anchors, `< 3` RSVPs at `T-24h`, or sole anchor drops at `T-3h`. | Reject publish without confirmed anchor; auto-cancel at `T-24h` if `< 3` RSVPs; promote co-anchor or cancel cleanly before travel on anchor drop; day-of flake gives honest release + rematch priority. | `externalEventHasConfirmedAnchor`, `externalEventT24QuorumGuard`, `anchorDropReassignedOrCancelled`, `quorumOrCleanCancelBeforeCutoff` | `spec/externalEventBridge.md`, `spec/meetupCoordination.md`, `pnpm run quint:check external_event_bridge meetup_coordination` |
| **FM-26** | **Unsanctioned scraping or Partiful telecom filter block** | Adapter attempts to scrape Partiful/Meetup guest list, or Partiful event blast contains alcohol keywords. | `isSanctionedExternalEventSource` rejects non-sanctioned sources; Partiful remains human-assisted Event Kit with mandatory `scrubPartifulTelecomCopy()`. | `externalEventIngestSanctionedOnly` | `spec/externalEventBridge.md`, `pnpm run quint:check external_event_bridge`, vitest integration |
| **FM-27** | **External crowd mismatch or public RSVP guest-list leak** | Member expects curated Network dinner, lands in unvetted Meetup crowd, or has phone/name exposed on public RSVP page. | Require explicit `externalCrowdDisclosed` before confirm and enforce `hideGuestList = true && approvalRequired = true` on all hosted listings. | `externalCrowdDisclosedBeforeConfirm`, `hostedEventGuestListHiddenAndGated` | `spec/externalEventBridge.md`, `pnpm run quint:check external_event_bridge`, `pnpm run test:e2e` |
| **FM-28** | **Minor enters external event or external dating funnel** | Teen joins via Partiful/Luma link or dating chat, or discloses age `< 18` mid-relay (`relayStartsMinorPolicy`). | Fail-closed `18+` gate on RSVP approval and prospect intake; cross-check `platform.people.lowest_age`; existing `relay.ts` `minorSignal` + immediate cache purge. *(In-network teen friend intros remain governed strictly by `spec/friendIntroAge.md`.)* | `noMinorInAnyEventOrCoattend`, `externalProspectAdultOnly`, `relayAgeSignalReachesAgePolicy` | `spec/externalEventBridge.md`, `spec/externalMatchmaker.md`, `pnpm run quint:check external_event_bridge external_matchmaker`, `pnpm run sim` |
| **FM-29** | **Overbooking exceeds physical walk-in capacity** | 100% of overbooked free external RSVPs show up at a 10-seat venue. | `computeApprovedExternalCap` hard-clamps `N_net + cap <= min(15, venueWalkInCapacity)`; extras stay on waitlist. | `unreservedGroupSizeCapped`, `externalEventHasConfirmedAnchor` | `spec/externalEventBridge.md`, `pnpm run quint:check external_event_bridge` |
| **FM-30** | **Cross-persona double outreach in same city** | Both `nyc-f` and `nyc-m` contact the same external prospect (or across `slop` and `friends`). | `UNIQUE (city, dedupe_hash)` + `routeMatchmakerPersona` enforce exclusive lock per prospect. | `singlePersonaPerProspect` | `spec/externalMatchmaker.md`, `pnpm run quint:check external_matchmaker`, Postgres unique-lock test |
| **FM-31** | **Undisclosed bot, link spam, or unreviewed external outreach** | Draft omits matchmaker disclosure, includes URL/brand promo, or skips review. | `canContactExternalProspect` requires `humanReviewApproved && personaDisclosed && !containsUrlOrBrandSpam`; `LeakGuard` blocks URLs on dating-platform drafts. | `humanReviewRequiredBeforeExternalOutreach`, `personaDisclosureAndNoLinksEnforced` | `spec/externalMatchmaker.md`, `pnpm run quint:check external_matchmaker`, `evals/` corpus |
| **FM-32** | **Platform shadowban / Face Check lock strands booked setup or triggers burner evasion** | Hinge/Bumble suspends persona account or triggers liveness challenge. | Kill-switch halts all new outreach immediately; zero burner re-contact; already-booked off-app setups proceed seamlessly over SMS; unconfirmed leads fail over to Tier-1 sourcing. | `personaKillSwitchHaltsOnBanSignal`, `noEvasionAfterPersonaSuspend` | `spec/externalMatchmaker.md`, `pnpm run quint:check external_matchmaker`, vitest integration |
| **FM-33** | **Cold SMS (TCPA), shared Blooio SPOF, or cold prospect reuse** | System texts a scraped phone number, blasts over shared Blooio line, or re-pitches an `intro_single_only` prospect to a 2nd member. | Require inbound-first or logged off-app SMS consent on dedicated A2P 10DLC channel; `canReconsiderExternalProspect` requires explicit `intro_future_optin`, TTL `<= 60d`, and `>= 30d` cooldown. | `externalOutreachRequiresConsentAndNotSuppressed`, `noColdReuseWithoutExplicitOptIn` | `spec/externalMatchmaker.md`, `pnpm run quint:check external_matchmaker turn_consent`, `pnpm run security` |
| **FM-34** | **Stale prospect cache, failed erasure, or banned/held re-entry** | Prospect texts `STOP`/declines/requests deletion, or a banned/held phone re-enters via external matchmaker. | Immediate cascade purge leaving only keyed HMAC suppression tombstone; intake, SMS handoff, and booking all cross-check `banned_phones`, `person_holds`, `person_blocks`, and suppression table. | `prospectCacheBoundedAndPurgedOnOptOut`, `bannedOrHeldNeverExternallyMatched` | `spec/externalMatchmaker.md`, `pnpm run quint:check external_matchmaker safety_trust`, Postgres purge & cross-funnel ban tests |
| **FM-35** | **Premature Network invite spam after flake, bad meetup, or safety flag** | External event guest or dating prospect gets invited to join The Network before feedback or after negative/no-show/safety-flagged encounter. | Quality gate blocks invite unless meetup completed, positive/vouched member feedback received, zero safety flags, `18+`, not opted out, and `invitesSent == 0`. | `externalInviteQualityGated`, `networkInviteRequiresPositiveMeetupFeedback` | `spec/externalEventBridge.md`, `spec/externalMatchmaker.md`, sim & e2e funnel tests |
| **FM-36** | **Cross-app bleed of `slop` ratings or dating prospect data into `peon.biz`** | Employment matching query reads `slop` Clef scores or `external_prospects` facets. | Schema isolation + Postgres `FORCE ROW LEVEL SECURITY` (`0098`) + `canReadExternalProspectInApp` returns `false` for `peon`. | `crossAppScoreFirewall` | `spec/externalMatchmaker.md`, `pnpm run quint:check external_matchmaker`, `pnpm run security` RLS isolation test |

---

## 11. Comprehensive Risk Matrix (`D-1`–`D-6`, `E-1`–`E-6`, `X-1`–`X-9`)

Scale: **Severity** (`1–5`, `5 = catastrophic/existential`) × **Likelihood** (`1–5`, `5 = near-certain`).

### 11.1 Domain A: Dates and Friend Meetups (`D-1` to `D-6`)

| ID | Risk & Worst-Case Failure | Sev | Lik | Concrete Mitigation | Formal Invariant (Vibespec + Whole-Flow Quint) | Test / Sim Gate |
|---|---|---:|---:|---|---|---|
| **D-1** | **Alcohol/recovery red-line breach:** Recovering alcoholic sent to brewery/wine bar (`alcoholOptional: true`) or `slop/score.ts` picks `"drinks"`. | 5 | 4 | Add `strict_sober` & `isAlcoholCentric` to `venueRedLinesEligible`; wire `dateActivityAllowed` through generated red-line filter. | `strictSoberNeverAlcoholCentric` | `pnpm run check`; `pnpm run quint:check venue_lifecycle`; `pnpm run sim` |
| **D-2** | **Dietary / severe allergen / religious harm:** Peanut/shellfish/celiac/halal/kosher attendee sent to unsafe venue. | 5 | 3 | Add `severeAllergen`, `glutenFree`, `halal`, `kosher` hard checks in `venueRedLinesEligible`; unknown venue metadata fails closed. | `allergenAndReligiousDietRespected` | `pnpm run check`; `pnpm run test:integration` |
| **D-3** | **Unsafe/isolated venue or late-night transit risk:** Blind date scheduled late at night in low-safety/poor-transit zone or unlit park. | 5 | 3 | Hard-gate `safetyScore >= 7 && transitScore >= 3` when `isAfterDark || isFirstMeet`; cap first-meet start `<= 21:00` local; public venues only. | `afterDarkSafetyAndTransitFloor`, `noPrivateHomeRecommended` | `pnpm run check`; `pnpm run quint:check venue_lifecycle`; `pnpm run sim` |
| **D-4** | **Private red-line leakage in explanations:** Agent tells a match *"we picked a cafe because Alex is sober / broke"*. | 4 | 4 | Tag all red-line facets `agent_private`; pass into `LeakGuard.checkThread` on every proposal, venue explanation, and arrival relay. | `redLineFacetsNeverLeaked`, `noLeakOrPrivateContactInArrivalRelay` | Sim leak-guard gate + `evals/` corpus; `shared-agent.integration.test.ts` |
| **D-5** | **No-show stranding & wrong attribution:** Person sits alone 45m or innocent party gets penalized. | 4 | 4 | Enforce `noShowDecision` (`T+12m` ping late, `T+18m` release waiting + rematch priority), `noShowCountsAbsentOnly`, and local-TZ slot recording. | `noShowNotifiesWaiterBy18m`, `noShowCountsAbsentOnly` | `pnpm run quint:check meetup_coordination safety_trust`; `pnpm run sim` |
| **D-6** | **Mid-date harassment / unsafe escalation or dropped report:** Relay keeps forwarding after safety exit or leave-vs-report drops hold. | 5 | 3 | Mid-meetup panic/safety trigger immediately halts arrival relay (`onPanicExit`), blocks pair cross-app, writes transactional `person_holds`, and attributes explicit target. | `panicOrBlockImmediatelyHaltsRelay`, `onlyConfirmedUnblockedAdultsRelayed` | `pnpm run quint:check meetup_coordination safety_trust`; `pnpm run security` |

### 11.2 Domain B: Impromptu Events and External Event Platforms (`E-1` to `E-6`)

| ID | Risk & Worst-Case Failure | Sev | Lik | Concrete Mitigation | Formal Invariant (Vibespec + Whole-Flow Quint) | Test / Sim Gate |
|---|---|---:|---:|---|---|---|
| **E-1** | **Partiful/Luma/Meetup ToS breach & bans:** Scraping auth-walled guest lists, unofficial Partiful bots, or promotional SMS blasts. | 4 | 5 | Hard ban on scraping and bot RSVPs; allow only `host_native`, `official_api` (Luma Plus / Meetup Pro), and `member_submitted_public`; human-assisted Partiful Event Kit + telecom copy scrub. | `externalEventIngestSanctionedOnly` | Integration test rejecting non-sanctioned sources; `pnpm run quint:check external_event_bridge` |
| **E-2** | **Unannounced crowd / venue disruption:** 15 strangers ambush a small cafe or two Network groups collide. | 4 | 4 | Cap unreserved non-open groups at `<= 6`, open events at `min(15, walkInCapacity)`; Postgres transactional lock on `network.venue_concurrent_holds`. | `unreservedGroupSizeCapped`, `venueConcurrentCapacityRespected` | `pnpm run check`; `pnpm run quint:check venue_lifecycle`; Postgres concurrency test |
| **E-3** | **First-party organizer liability & Sec. 230 collapse:** Private home event or unscreened attendee assault/dram-shop claim. | 5 | 3 | Public licensed third-party venues only (`CHECK (is_public = true)`); venue owns alcohol/security; cross-app ban/hold/block screening; CGL insurance before scaling hosted events. | `noPrivateHomeRecommended`, `noHeldOrBannedInEvent` | `pnpm run check`; DB `CHECK (is_public = true)`; `pnpm run security` |
| **E-4** | **External crowd mismatch & public guest-list PII leak:** Member expects curated Network dinner or has identity exposed on public RSVP list. | 4 | 4 | Mandatory upfront `crowdType` disclosure before confirm; enforce `hideGuestList = true && approvalRequired = true` before releasing exact venue address. | `externalCrowdDisclosedBeforeConfirm`, `hostedEventGuestListHiddenAndGated` | `pnpm run quint:check external_event_bridge`; `pnpm run test:e2e` |
| **E-5** | **Anchor / initiator no-show strands strangers:** Sole host bails before meetup leaving external guests with no anchor. | 4 | 4 | Require `>= 1` confirmed anchor (target `>= 2`), `T-24h` quorum guard (`>= 3` external RSVPs), `T-3h` anchor check-in, and co-anchor promotion or clean cancellation before travel. | `externalEventHasConfirmedAnchor`, `externalEventT24QuorumGuard`, `quorumOrCleanCancelBeforeCutoff`, `anchorDropReassignedOrCancelled` | `pnpm run quint:check external_event_bridge meetup_coordination`; `pnpm run sim` |
| **E-6** | **Minors (13–17) sneaking into 18+ external events:** Teen joins via shared Partiful/Luma link or attempts external co-attendance. | 5 | 4 | Hard `18+` gate on ALL external syndicated events and external co-attendance (in-network teen friend intros stay strictly inside `spec/friendIntroAge.md`); mandatory `18+` screening Q; cross-check phone against `platform.people.lowest_age`. | `noMinorInAnyEventOrCoattend` | `pnpm run check`; `pnpm run quint:check external_event_bridge meetup_coordination`; `pnpm run sim --only safety` |

### 11.3 Domain C: External Matchmakers, Prospect Cache, and Repo Hard Invariants (`X-1` to `X-9`)

| ID | Risk & Worst-Case Failure | Sev | Lik | Concrete Mitigation | Formal Invariant (Vibespec + Whole-Flow Quint) | Test / Sim Gate |
|---|---|---:|---:|---|---|---|
| **X-1** | **Deceptive dating-app bots / impersonation (FTC §5, 16 CFR 461/465, CA SB 1001/243) & viral catfish PR blowup.** | 5 | 5 | Hard ban on deceptive suitor personas, AI faces, and auto-swipers. Require real human operator with own verified identity, upfront matchmaker bio, human review (`requireReview: true`), zero URLs/brand spam, and low daily human caps. | `humanReviewRequiredBeforeExternalOutreach`, `personaDisclosureAndNoLinksEnforced` | `pnpm run quint:check external_matchmaker`; `LeakGuard` blocks URLs on dating-app drafts |
| **X-2** | **Match Group / Bumble account bans, Face Check lock, shadowbans stranding active setups.** | 4 | 5 | Operational isolation; monitor unmatch spikes/0-reply streaks/warnings; automatic kill-switch halts sourcing on ban signal; zero burner evasion; booked setups continue via off-app SMS. | `personaKillSwitchHaltsOnBanSignal`, `noEvasionAfterPersonaSuspend` | `pnpm run quint:check external_matchmaker`; kill-switch failover integration test |
| **X-3** | **Unconsented third-party profile caching (GDPR Art. 14/17, CCPA SB 923, CA Delete Act).** | 5 | 4 | Zero raw scraping/photos; cache minimal conversation facets only; 5-U.S.-city geo-fence; hard TTL (`14d` uncontacted / `<= 30d` unopted / `60d` explicit `intro_future_optin`); immediate purge on opt-out/decline/delete keeping only keyed HMAC suppression tombstone; no cold reuse. | `prospectCacheBoundedAndPurgedOnOptOut`, `noColdReuseWithoutExplicitOptIn` | `pnpm run check`; `pnpm run quint:check external_matchmaker`; Postgres retention/purge test |
| **X-4** | **TCPA ($500–$1,500/msg) & A2P 10DLC violation + shared Blooio line ban killing all 4 apps.** | 5 | 5 | Hard ban on cold-texting numbers from bios; require inbound-first or logged prior express consent before SMS; dedicated A2P 10DLC channel (never shared Blooio line); enforce `20:30–09:00` quiet hours & `3/day` cap. | `externalOutreachRequiresConsentAndNotSuppressed`, `followupNeverDuringQuietHours`, `followupRespectsDailyCapAndOptOut` | `pnpm run check`; `pnpm run quint:check external_matchmaker turn_consent`; `pnpm run security` |
| **X-5** | **Underage (`< 18`) external prospect cached or matched.** | 5 | 4 | Fail-closed `18+` gate (`18..120`) before caching, matching, or handoff; cross-check `lowest_age`; preserve `origin/main`'s `relayStartsMinorPolicy` (`relay.ts`) to trigger minor hold and purge cache on any mid-flow minor disclosure. | `externalProspectAdultOnly`, `relayAgeSignalReachesAgePolicy`, `noRatingForMinor` | `pnpm run check`; `pnpm run quint:check external_matchmaker safety_trust`; `pnpm run sim --only safety` |
| **X-6** | **Catfish, romance scam, prompt injection, or member PII / Clef score leak to external prospect.** | 5 | 4 | Wrap all untrusted external text in `fenceUntrusted()`; run `clefRelayClassifier` (fail-closed in prod) + `LeakGuard.checkThread` + `appearanceLeak`; never share full name, phone, IG, workplace, or Clef scores without bilateral per-item consent. | `externalOutboundPassesLeakAndClefGuard`, `scoresNeverShown`, `numberMovesOnlyIfBothConsented` | `pnpm run quint:check external_matchmaker relay`; `evals/` injection & leak corpus; `pnpm run security` |
| **X-7** | **Banned phone / held / blocked person re-enters via external matchmaker funnel.** | 5 | 4 | Cross-check `platform.banned_phones`, `person_holds`, `person_blocks`, and keyed suppression table at intake, SMS handoff, and booking; propagate STOP/ban identically across both funnels. | `bannedOrHeldNeverExternallyMatched`, `bannedNeverMatchable` | `pnpm run quint:check external_matchmaker safety_trust`; `pnpm run security` cross-funnel ban test |
| **X-8** | **Premature Network invite spam to unvetted or bad external prospect.** | 3 | 4 | Gate join invite strictly behind completed IRL meetup + positive/vouched member feedback + zero safety flags + active consent + max 1 invite ever. | `networkInviteRequiresPositiveMeetupFeedback`, `externalInviteQualityGated` | `pnpm run quint:check external_matchmaker external_event_bridge`; `pnpm run sim` |
| **X-9** | **Cross-app bleed of `slop` Clef ratings or external dating signals into `peon.biz` (EU AI Act Art. 5(1)(c), Title VII, NYC LL144).** | 5 | 3 | Schema isolation + Postgres `FORCE ROW LEVEL SECURITY` (`0098`) + Vibespec invariant restricting external dating prospect and Clef rating reads strictly to `slop`. | `crossAppScoreFirewall` | `pnpm run check`; `pnpm run security` Postgres RLS isolation test |

---

## 12. Formal Verification Mapping (Vibespecs + Whole-Flow Quint Models)

Per `AGENTS.md` and [SPEC.md](../../SPEC.md), pure decision rules live in top-level Vibespecs (`spec/<name>.md`) published via `pnpm run spec:sync` into `packages/core/src/generated/<name>.ts`, and whole-flow state machines live in `spec/models/<name>.md` checked via `pnpm run quint:check` using **exact identical canonical invariant names**.

### 12.1 Canonical Invariant Registry & Module Mapping

| Flow / Domain | Whole-Flow Quint Model (`spec/models/<name>.md`) | Vibespec (`spec/<name>.md` -> `packages/core/src/generated/<name>.ts`) | Thin Shell / Shipping Callers | Exact Shared Canonical Invariant Names |
|---|---|---|---|---|
| **Venue Red Lines, Walk-In Caps & Suggestion Pivots** | `spec/models/venue_lifecycle.md` | `spec/venueSelection.md` (`isWithinTravelLimit`, `fairMidpointCostScaled`, `isValidMidpoint`, `venueHardEligible`, `venueRedLinesEligible`, `shouldFetchExternalVenues`, `needsPreRecommendOpenCheck`, `nextVenueStatusOnReport`, `groupVenueRubricScore`, `venueBudgetFitScore`) + `spec/suggestionFlow.md` (`canPivotSuggestion`, `nextSuggestionAction`, `computeDensityTier`, `dateActivityAllowed`, `slopNicheHobbyBonus`, `modeVenueScore`) | `packages/core/src/cities.ts`, `packages/core/src/venues.ts`, `packages/engine/src/packs/{slop,friends}/*`, `packages/network/src/*` | `strictSoberNeverAlcoholCentric`, `allergenAndReligiousDietRespected`, `afterDarkSafetyAndTransitFloor`, `unreservedGroupSizeCapped`, `venueConcurrentCapacityRespected`, `suggestionPivotsBounded` *(plus base: `noPrivateHomeRecommended`, `noClosedOrSuspectVenueRecommended`, `noVisitedOrRejectedRecommended`, `nonDrinkerNeverBar`, `budgetCeilingRespected`, `recommendedMustBeVerifiedOpen`, `closureQuarantinesImmediately`)* |
| **Arrival Relay, Venue-Full Pivot, Panic Exit & Anchor Failover** | `spec/models/meetup_coordination.md` | `spec/meetupCoordination.md` (`meetupPhase`, `canRelayArrivalSafe`, `canAttendEventOrCoattend`, `noShowDecision`, `shouldPivotToBackupV2`, `shouldQuarantineVenue`, `anchorFailoverDecision`, `computeFollowupLocalHour`, `canSendFollowup`) | `packages/core/src/venues.ts`, `packages/network/src/{relay,network,group-late-arrival}.ts`, `packages/network/service/relay-endpoint.ts` | `venueFullTriggersBackupPivot`, `panicOrBlockImmediatelyHaltsRelay`, `anchorDropReassignedOrCancelled`, `quorumOrCleanCancelBeforeCutoff`, `noMinorInAnyEventOrCoattend` *(plus base: `noMinorInArrivalRelay`, `onlyConfirmedUnblockedAdultsRelayed`, `noArrivalRelayOutsideWindow`, `noLeakOrPrivateContactInArrivalRelay`, `closureAlwaysPivotsWhenBackupExists`, `followupNeverDuringQuietHours`, `followupRespectsDailyCapAndOptOut`, `noShowCountsAbsentOnly`)* |
| **External Event Bridge (Luma / Meetup / Partiful)** | `spec/models/external_event_bridge.md` | `spec/externalEventBridge.md` (`isSanctionedExternalEventSource`, `canPublishExternalEvent`, `computeApprovedExternalCap`, `evaluateExternalEventT24Quorum`, `canApproveExternalEventRsvp`, `canInviteExternalEventAttendee`) | `packages/core/src/externalEvents.ts`, `packages/network/service/*`, `apps/observatory/*` | `externalEventIngestSanctionedOnly`, `externalEventHasConfirmedAnchor`, `externalEventT24QuorumGuard`, `hostedEventGuestListHiddenAndGated`, `externalCrowdDisclosedBeforeConfirm`, `noMinorInAnyEventOrCoattend`, `externalInviteQualityGated` |
| **External Matchmakers, Prospect Cache & Quality-Gated Invite** | `spec/models/external_matchmaker.md` | `spec/externalMatchmaker.md` (`routeMatchmakerPersona`, `shouldTriggerExternalSourcing`, `canContactExternalProspect`, `canReconsiderExternalProspect`, `prospectRetentionDecision`, `canInviteExternalProspectToNetwork`, `canReadExternalProspectInApp`) | `packages/core/src/externalMatchmaker.ts`, `packages/network/src/{network,relay}.ts`, `packages/platform/src/*` | `externalProspectAdultOnly`, `singlePersonaPerProspect`, `humanReviewRequiredBeforeExternalOutreach`, `personaDisclosureAndNoLinksEnforced`, `externalOutreachRequiresConsentAndNotSuppressed`, `prospectCacheBoundedAndPurgedOnOptOut`, `noColdReuseWithoutExplicitOptIn`, `personaKillSwitchHaltsOnBanSignal`, `noEvasionAfterPersonaSuspend`, `bannedOrHeldNeverExternallyMatched`, `networkInviteRequiresPositiveMeetupFeedback`, `crossAppScoreFirewall` |

### 12.2 Explicit Boundaries Outside the Formal Models (and Their Test Coverage)

In accordance with `docs/tests-policy.md` (**no busywork unit/smoke tests**), runtime seams that Quint and Vibestack cannot express are validated by `vitest` Postgres integration tests (`pnpm run test:integration`, `pnpm run security`), end-to-end tests (`pnpm run test:e2e`), and seeded simulation gates (`pnpm run sim`):

| Boundary Outside Formal Model | Why Unmodeled in Quint / Vibespecs | Validation Coverage (Integration / E2E / Sim) |
|---|---|---|
| **Postgres transactions, unique persona locks, concurrent capacity locks, and RLS isolation (`0098`)** | SQL execution, row-level locking, and `FORCE ROW LEVEL SECURITY` are outside Quint. | `pnpm run test:integration` & `pnpm run security`: `0098_meetup_venues_external_matchmaking.sql` idempotency test; concurrent 2h walk-in venue lock test; `UNIQUE (city, dedupe_hash)` lock test; cascading non-member purge leaving only keyed HMAC tombstone; `peon` RLS isolation test. |
| **HMAC-SHA256 webhook verification, suppression hashing, and external HTTP/GraphQL I/O (Luma, Meetup, Google Places)** | Cryptographic primitives, async HTTP (`await`), retries, and rate-limit responses are outside pure Quint. | Vitest integration tests with deterministic HTTP/HMAC fixtures covering valid/invalid Luma signatures, Meetup GraphQL polling pagination, 429/5xx graceful degradation, and `scrubPartifulTelecomCopy()` regression cases. |
| **LLM extraction, `fenceUntrusted()`, `LeakGuard`, `appearanceLeak`, `clefRelayClassifier`, and copy rules** | Natural-language classification, regex tables, and Workers AI / `gpt-6-luna` calls are nondeterministic oracles. | `evals/` corpora (red-line explanation leaks, external prompt injection/catfish/URL-solicitation), `pnpm run relay-eval`, `shared-agent.integration.test.ts`, and real-LLM (`gpt-6-luna`) validation runs. |
| **Wall-clock timers (`T-24h`, `T-6h`, `T-3h`, `T-75m`, `T+12m`, `T+18m`, 60–90s group batching, TTL sweeps)** | Timers are modeled as nondeterministic atomic transitions in Quint. | Clock-injected (`Clock`) Vitest integration tests, `pnpm run test:e2e`, and `pnpm run sim` (keeping all teen gates and canary leak gates at 0). |

### 12.3 Formal Verification Commands

Before merging implementation PRs in `eliza-research/thenetwork`:
1. `pnpm run spec:sync` — compile all 5 new Vibespecs into `packages/core/src/generated/*.ts` and commit generated copies cleanly without manual edits.
2. `pnpm run check` and `pnpm run spec:check-generated` — verify all Vibespec proofs and confirm published generated files match fresh output.
3. `pnpm run quint:check venue_lifecycle meetup_coordination external_event_bridge external_matchmaker` — verify all 4 whole-flow models in `spec/models/` pass all invariants, witnesses, and run tests (`0 failures`), with rows registered in `spec/models/README.md`.
4. `pnpm run typecheck && pnpm run security && pnpm run test:integration && pnpm run test:e2e && pnpm run sim` — verify full build, Postgres RLS/migration tests, e2e flows, and simulation gates.

---

## 13. Defend the Design (Alternatives Considered)

Per [CONTRIBUTING.md](../../CONTRIBUTING.md), we evaluated concrete alternative designs across each major subsystem before committing to this architecture:

1. **Multi-Option Poll / Menu Instead of Top-1 Suggestion + Bounded Pivot Loop**
   - *Alternative:* Send 3 to 5 venue options in every date or group SMS and let attendees vote.
   - *Why rejected:* Multi-option SMS menus create choice overload and split-vote deadlocks across 3–6 strangers, increasing turn count and burning the 3-proactive-messages/day cap. Pre-computing Top-3 + Backup internally while presenting a crisp Top-1 with an explicit escape hatch and `MAX_SUGGESTION_PIVOTS = 3` maximizes 1-tap `yes` conversion while capturing structured red-line feedback on any pushback.

2. **Automated Dating-App Bot Personas & Unofficial Partiful Scraping Instead of Human-Operated Matchmakers & Human-Assisted Partiful Kit**
   - *Alternative:* Run headless browser automation / unofficial APIs to auto-swipe as romantic personas on Hinge/Bumble/Tinder and scrape Partiful guest lists.
   - *Why rejected:* Existential legal and operational failure. Undisclosed romantic bots violate FTC Act §5 (16 CFR 461/465) and CA SB 1001/243, trigger Match Group / Bumble Face Check biometric cross-app bans within 24–72 hours, and poison brand trust permanently. Unofficial Partiful scraping breaks frequently and triggers account bans. Human-operated, upfront-disclosed matchmakers (with Tier-1 Date-Me Docs / Luma / Partiful micro-events as primary scale) and a 60-second human-assisted Partiful Event Kit eliminate legal/ToS existential risk while preserving high IRL quality.

3. **Immediate Cold Network Invite / Persistent Non-Member Shadow Graph Instead of Privacy-Bounded Cache & Post-Meetup Quality Gate**
   - *Alternative:* Save full scraped external profiles indefinitely in a shadow graph and text every external match or event RSVP a `slop.date` signup link immediately.
   - *Why rejected:* Violates GDPR Art. 14/17, CCPA SB 923, TCPA cold-SMS rules (risking a shared Blooio line ban across all four apps), and triggers Akerlof "market for lemons" degradation by inviting flakes and bad actors before anyone meets them. Minimized TTL-bounded caching (`14d` / `60d` explicit opt-in, immediate purge with HMAC suppression tombstone) paired with the strict post-meetup quality gate grows the member pool strictly with verified, respectful adults.

4. **Venue Partnerships / Prepaid Table Reservations Instead of Walk-In Anti-Disruption Protocol**
   - *Alternative:* Sign B2B agreements with local restaurants and collect deposits to book private tables for every meetup.
   - *Why rejected:* Out of launch scope (no payments or reservations in launch scope), slows five-city expansion to manual B2B sales speed, and creates first-party event organizer liability. Enforcing walk-in suitability scoring, `<= 6` / `<= 15` hard caps, concurrent-window Postgres capacity locks (`network.venue_concurrent_holds`), and mandatory indoor backups delivers reliable meetups across all five cities on day one with zero venue contracts.
