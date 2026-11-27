# Five-City Architecture, Venue Intelligence, Meetup Coordination, Follow-Ups, and Work Introductions

Status: **Design specification (2026-11-26)**. Applies to `ntwrk`, `slop`, `friends`, and `peon` across five launch cities (`sf`, `nyc`, `la`, `chicago`, `miami`) on `eliza-research/thenetwork` (`Node 26 / pnpm`, Vibestack, PostgreSQL 16).

## Purpose and Scope

This document defines the architecture, data model, user stories, failure modes, and formal verification mapping for five linked platform upgrades:

1. **Modular five-city support**: Move from hardcoded New York City (`nyc`) and San Francisco (`sf`) logic to one city registry covering `sf`, `nyc`, `la`, `chicago`, and `miami`.
2. **Venue catalog and external API strategy ("Our Own Yelp")**: Combine curated seed venues, Google Places API (New), strict caching limits, local sufficiency cutoffs (`>= 10`), pre-recommendation open checks, closure quarantine, and online taste learning.
3. **Impromptu group events (`friends`)**: Score walk-in public venues for 4 to 6 strangers with no reservation and no venue partnership, while keeping minor friendship groups on all-ages public venues within the 2 to 6 roster limit.
4. **On-site arrival coordination ("finding each other")**: Guide confirmed adult attendees to meet safely inside a timed window through the existing leak-checked relay pipeline, with backup venue pivot and no-show escalation.
5. **Proactive post-encounter follow-ups and work introductions (`peon`)**: Send quiet-hours-compliant post-encounter follow-ups in each city's local time zone, and deliver double-opt-in non-in-person work introductions (`warm_email`, slot-locked `scheduled_video`, or `relay_share`) instead of physical venues.

> **Hard safety boundaries (unchanged, owner decisions 2026-11-22):**
> - **Under 13** cannot join.
> - **Minors (ages 13 to 17)** stay single-player on `slop.date` and `peon.biz` (zero dating introductions, zero work introductions, zero photos or looks ratings). Minors can receive friendship introductions only on `friends.help` and in the `ntwrk` `Friend` lane under [`teenFriendAgeRule`](../../spec/friendIntroAge.md) (teen-ready roster aged 13 to 18, birth dates at most 2 calendar years apart, 2 to 6 people for groups, approved by the `gpt-6-luna` review judge with the strict rubric or by staff on a held item, and stopped across every app by one-staff [`teenStop`](../../spec/teenIntroSwitch.md)).
> - **Minor venue and relay boundaries**: Every venue suggested or booked for a roster with a minor must be an all-ages public place (`ageMin <= 13`, `!isBarOnly`, `alcoholOptional`, `!isAlcoholCentric`). Minors never enter number relay, photo relay, or on-site arrival relay. All nine teen simulation gates (`teen_adult_contact`, `teen_gap_contact`, `teen_lane_contact`, `teen_unready_contact`, `teen_switch_off_contact`, `teen_relay_contact`, `teen_group_contact`, `teen_place_contact`, `teen_stop_equals_pre_feature`) must remain `0`.
> - **Public places only**: Every venue in the catalog is a public place (`is_public = true`), never a private home. (Approved bounded home-help plans keep their separate encrypted escrow in `packages/network/src/bounded-home-help-venue.ts`.)
> - **Review, leak guard, and caps**: Every opportunity gets one recorded approval (`gpt-6-luna` review judge or staff for held items; [automated review](../../spec/automatedReview.md)). Every outbound message passes the leak guard (`packages/core/src/guard.ts`, `packages/mcp/src/leaks.ts`). Appearance ratings stay private to `slop`. Proactive outreach obeys person-level daily caps (`spec/outreachPolicy.md`), local quiet hours (`spec/quietHours.md`), `STOP`, and per-app `leave`.

---

## 1. Modular Five-City Architecture

### 1.1 Launch Cities and Codebase Migration

The five launch cities are San Francisco (`sf`), New York City (`nyc`), Los Angeles (`la`), Chicago (`chicago`), and Miami (`miami`).

| City ID | Display Name | IANA Time Zone | Primary Mode | Anchor ZIP | Launch Networks |
|---|---|---|---|---|---|
| `sf` | San Francisco | `America/Los_Angeles` | Muni, BART, walk, rideshare | `94103` | `ntwrk:sf`, `slop:sf`, `peon:sf`, `friends:sf` |
| `nyc` | New York | `America/New_York` | Subway, walk | `10003` | `ntwrk:nyc`, `slop:nyc`, `peon:nyc`, `friends:nyc` |
| `la` | Los Angeles | `America/Los_Angeles` | Car, rideshare, Metro | `90013` | `ntwrk:la`, `slop:la`, `peon:la`, `friends:la` |
| `chicago` | Chicago | `America/Chicago` | CTA L, bus, walk | `60602` | `ntwrk:chicago`, `slop:chicago`, `peon:chicago`, `friends:chicago` |
| `miami` | Miami | `America/New_York` | Car, rideshare, Metrorail | `33131` | `ntwrk:miami`, `slop:miami`, `peon:miami`, `friends:miami` |

Previously, city assumptions were scattered across packages:
- `packages/core/src/types.ts` restricted `City` to `sf | nyc | la` and `NetworkCity` to `sf | nyc`.
- `packages/core/src/time.ts` lacked `chicago` and `miami` in `CITY_TZ`.
- `packages/engine/src/packs/friends/*`, `packages/network/src/{geo,outreach,copy,plans,jobs,rescheduling,standing-intents,network}.ts`, and `packages/network/service/packs.ts` hardcoded `nyc`, NYC boroughs, NYC venues, and `America/New_York`.
- `packages/platform/src/accounts.ts`, `packages/mcp/src/{store,tools,handler}.ts`, and `platform.cities` only allowed `sf` and `nyc`.
- `apps/observatory/web/{map,store,ui}.ts`, `apps/observatory/src/sources/game.ts`, and `apps/observatory/db/writer.ts` hardcoded NYC map centers, boroughs, and `America/New_York`.

This design replaces those hardcoded paths with one shared registry in `packages/core/src/cities.ts`, generated pure travel rules from `spec/cityTravel.md`, and database migration `packages/db/migrations/0098_five_cities_venues_followups.sql`. Matching activation per `<app>:<city>` remains controlled by the `platform.networks` registry row and the admin switch.

### 1.2 Single-Source `CitySpec` Registry

`packages/core/src/cities.ts` is the single source of truth for city metadata, zones, neighborhoods, travel limits, barrier penalties, and curated seed venues.

Core exports:
- Types: `City = "sf" | "nyc" | "la" | "chicago" | "miami"`, `NetworkCity = City`, `CitySpec`, `CityZone`, `CityNeighborhood`.
- Registry data and functions: `CITIES`, `CITY_IDS`, `getCity(id)`, `resolveCity(text)`, `listCities()`, `registerCity(spec)`.
- Travel and midpoint helpers: `estimateTravelMinutes(city, fromArea, toArea)` and `chooseFairMidpoint(city, areas, mode)`, which call the generated Vibestack rules in `packages/core/src/generated/cityTravel.ts` (from [`spec/cityTravel.md`](../../spec/cityTravel.md)).

Each `CitySpec` defines:
1. `id`, `name`, `aliases`, `tz`, and `anchorZip`.
2. `travelLimits`: maximum one-way travel minutes for `date` (`slop`, 1-on-1) and `group` (`friends`, 2 to 6 people), plus `relaxStepMin = 5` and `maxRelaxMin = 10`.
3. `zones`: logical transit or geography buckets (for example, Manhattan vs Brooklyn, Westside vs Eastside, Mainland vs Miami Beach) and a `barrierPenalties` matrix in minutes.
4. `neighborhoods`: 9 to 10 anchor neighborhoods per city with exact `lat`, `lon`, `zone`, and text `aliases`.
5. `seedVenues`: 12 verified public venues per city (60 total) with structured weekly hours, attributes, age minimums, price tiers, arrival landmarks, and persona priors.

### 1.3 Adding City #6 (Zero Engine Rewrites)

To add a sixth city (for example, Austin or Seattle), an engineer performs only two steps:

1. Add one city spec module and register it in `packages/core/src/cities.ts` (zones, neighborhoods, barrier penalties, travel limits, time zone, anchor ZIP, and curated seed venues), and add the city ID to `City` in `packages/core/src/types.ts`.
2. Add the next numbered migration in `packages/db/migrations/` inserting the city row into `platform.cities` and its `<app>:<city>` rows into `platform.networks`.

Matching, venue ranking, midpoint selection, arrival relay, quiet-hours calculation, and post-encounter follow-ups read from `CitySpec` and `CITY_TZ`. No pack logic, planner loop, or generated rule module requires city-specific branches.

### 1.4 Per-City Travel Limits and Barrier Penalties

Raw straight-line distance fails in real cities because rivers, freeways, hills, causeways, and radial train lines distort travel time. Each city applies realistic travel caps and barrier penalties:

| City | 1-on-1 Date Max (`slop`) | Group Max (`friends`) | Geographic Friction and Barrier Penalties |
|---|---|---|---|
| **NYC (`nyc`)** | 25 min (~2.5–3.5 mi) | 35 min (~4–5 mi) | East/Hudson river crossings (+10 to +15m), 2+ subway transfers (+12m), Staten Island ferry (+25m), outer-borough diagonals. |
| **San Francisco (`sf`)** | 25 min (~3–4 mi) | 35 min (~5 mi) | Steep hills, slow East–West Muni, evening fog/wind, Bay Bridge to East Bay (+25m penalty; separate bucket on weeknights). |
| **Chicago (`chicago`)** | 30 min (~4–6 mi) | 40 min (~6–8 mi) | Radial CTA L lines (fast N/S on Red/Brown/Blue; slow diagonal E/W without transfer +15m); winter weather cuts walking radius in half. |
| **Los Angeles (`la`)** | 35 min (~6–10 mi) | 45 min (~10–14 mi) | The 405 / Sepulveda Pass (+20m), Westside–Eastside rush-hour divide (Santa Monica to Silver Lake acts as long distance), parking scarcity. |
| **Miami (`miami`)** | 35 min (~6–12 mi) | 45 min (~12–15 mi) | Causeways to Miami Beach (MacArthur, Venetian, Julia Tuttle +15 to +25m at peak), I-95 congestion, sudden tropical downpours, Beach parking. |

### 1.5 Fair-Midpoint Minimax Algorithm

Do not compute a raw latitude/longitude geometric centroid. A raw centroid often lands in a river, freeway, hill, or low-supply residential zone. Instead, use **Discrete Neighborhood Minimax + Efficiency Scoring**:

1. **Graph lookup**: Represent each city by its neighborhood centroids and estimated travel time $t(a, b)$ using mode speed plus zone barrier penalties.
2. **Hard equity filter (minimax)**: Keep only candidate neighborhoods $n$ where every attendee's travel time is within the city limit:
   $$\max_{m \in G} t(m, n) \le T_{\max}(\text{city}, \text{app})$$
   If no neighborhood passes, relax $T_{\max}$ in `+5 min` steps up to `+10 min` maximum. If still empty, do not form the match or group.
3. **Objective score**: Select the candidate neighborhood $n$ that minimizes:
   $$\text{cost}(n) = 0.6 \cdot \max_{m \in G} t(m, n) + 0.4 \cdot \frac{1}{|G|} \sum_{m \in G} t(m, n) - \beta \cdot \log(1 + \text{supply}(n))$$
   - The `0.6` weight on worst-case travel protects the farthest attendee from an unfair commute.
   - The `0.4` weight on mean travel keeps total group travel low (geometric median behavior).
   - The $-\beta \cdot \log(1 + \text{supply}(n))$ term snaps choices toward high-density transit and venue hubs (Flatiron/Union Square in NYC, Hayes Valley in SF, Fulton Market in Chicago, Culver City/Arts District in LA, Brickell/Wynwood in Miami) rather than venue deserts.
4. **Proved integer core**: [`spec/cityTravel.md`](../../spec/cityTravel.md) (generated to `packages/core/src/generated/cityTravel.ts`) proves `isWithinTravelLimit`, `fairMidpointCostScaled` (`6 * maxTravelMin + 4 * meanTravelMin`), `fairMidpointNetCostScaled`, and `isValidMidpoint` in Quint and Dafny 4.11. The thin shell in `packages/core/src/cities.ts` computes the floating-point supply bonus and passes integer values to the generated decision.

### 1.6 Launch City Neighborhoods and Seed Venue Summary (60 Venues)

All 60 curated seed venues are verified open public venues spanning `$` (`1`) to `$$$$` (`4`), plus free (`0`) parks and waterfronts. Every city includes all-ages public venues (`ageMin = 13`, `!isBarOnly`, `alcoholOptional`, `!isAlcoholCentric`) so teen friendship introductions on `friends.help` and `ntwrk` Friend always have safe options. Permanently closed landmarks (such as Cafe Lalo in NYC, Time Out Market Miami, and J. Wakefield Wynwood) are excluded.

| City | Neighborhoods (48 total) | 12 Curated Seed Venues (Category, Price Tier) |
|---|---|---|
| **San Francisco (`sf`)** | Mission, Hayes Valley, SoMa/Yerba Buena, Embarcadero/FiDi, North Beach, Marina/Cow Hollow, Russian Hill/Polk, Lower Haight/Duboce, Castro/Noe Valley, Potrero Hill/Dogpatch (10) | Ferry Building Marketplace (`food_hall`, `$$`), Sightglass Coffee 7th St (`coffee_shop`, `$`), Tartine Bakery (`bakery_cafe`, `$$`), Saint Frank Coffee (`coffee_shop`, `$`), Reveille Coffee North Beach (`coffee_shop`, `$`), Biergarten Hayes Valley (`brewery_garden`, `$$`), Cellarmaker Brewing Mission (`brewery`, `$$`), Mission Dolores Park (`park`, free), Crissy Field / Tunnel Tops (`waterfront_park`, free), Arlequin Wine Merchant (`wine_bar`, `$$$`), Elixir (`cocktail_bar`, `$$`), The View Lounge (`cocktail_lounge`, `$$$$`). |
| **New York (`nyc`)** | Flatiron/Union Sq, West Village, East Village, Lower East Side, SoHo/Nolita, Chelsea/Meatpacking, Midtown West/Hudson Yards, FiDi/Seaport, Williamsburg, Gowanus/Park Slope (10) | Moynihan Train Hall Food Hall (`food_hall`, `$$`), Eataly Flatiron (`food_hall`, `$$$`), Le District (`food_hall`, `$$$`), Conwell Coffee Hall (`coffee_shop`, `$$`), Devocion (`coffee_shop`, `$$`), Threes Brewing (`brewery`, `$$`), Other Half Brewing (`brewery`, `$$`), Domino Park (`waterfront_park`, free), High Line / Little Island (`park`, free), McNally Jackson Seaport (`bookstore_cafe`, `$$`), Veselka (`diner`, `$$`), Overstory (`cocktail_lounge`, `$$$$`). |
| **Los Angeles (`la`)** | Arts District/DTLA, Silver Lake, Echo Park, Los Feliz, Koreatown, West Hollywood/Fairfax, Culver City, Santa Monica, Venice/Abbot Kinney, Highland Park (10) | Grand Central Market (`food_hall`, `$`), Citizens Public Market (`food_hall`, `$$`), Verve Coffee Mateo St (`coffee_shop`, `$$`), Steep LA (`cafe_tea_bar`, `$$`), Arts District Brewing Co. (`brewery`, `$$`), Homage Brewing (`brewery`, `$$`), Stories Books & Cafe (`bookstore_cafe`, `$`), Village Well Books & Coffee (`bookstore_cafe`, `$`), Silver Lake Meadow (`park`, free), The Original Pantry Cafe (`diner`, `$$`), Block Party (`wine_beer_patio`, `$$`), Mirate (`cocktail_lounge`, `$$$$`). |
| **Chicago (`chicago`)** | The Loop, West Loop/Fulton Market, River North, Wicker Park/Bucktown, Logan Square, Lincoln Park, Lakeview, Uptown, Hyde Park (9) | Time Out Market Chicago (`food_hall`, `$$`), Chicago French Market (`food_hall`, `$$`), Starbucks Reserve Roastery (`coffee_shop`, `$$`), Wormhole Coffee (`coffee_shop`, `$`), Dark Matter Star Lounge (`coffee_shop`, `$`), Pilot Project Brewing (`brewery`, `$$`), Half Acre Beer Co. Balmoral (`brewery`, `$$`), Chicago Riverwalk (`waterfront_park`, free), Millennium Park / The 606 (`park`, free), Good Funk (`wine_bar`, `$$$`), Valois Restaurant (`diner`, `$`), Kumiko (`cocktail_lounge`, `$$$$`). |
| **Miami (`miami`)** | Brickell, Downtown/Arts District, Wynwood, Design District/Midtown, Coconut Grove, Coral Gables, Little Havana, South Beach, Mid-Beach (9) | 1-800-Lucky (`food_hall`, `$$`), South Beach Food Hall (`food_hall`, `$$`), All Day (`coffee_shop`, `$$`), Versailles Bakery / Ventanita (`coffee_casual`, `$`), Veza Sur Brewing Co. (`brewery`, `$$`), Books & Books Coral Gables (`bookstore_cafe`, `$$`), Maurice A. Ferre Park (`waterfront_park`, free), The Underline Brickell (`park`, free), Barcelona Wine Bar (`wine_bar`, `$$$`), Big Pink (`diner`, `$$`), The Broken Shaker (`cocktail_lounge`, `$$$`), ViceVersa (`cocktail_lounge`, `$$$$`). |

### 1.7 Legal Guardrails Across Five Cities

- **Third-party public venues only (Section 230 and premises liability)**: The Network suggests independent public third-party venues. It does not book private spaces, collect cover charges, serve alcohol, or act as a first-party event host.
- **Illinois BIPA (Chicago `slop` photos)**: Launching in Chicago puts `slop` photo ratings under Illinois Biometric Information Privacy Act (BIPA) scrutiny. Photo analysis uses transient image calls and stores only abstract non-biometric scalar ratings (`agent_private`), never facial geometry templates or faceprints. Keep explicit Illinois photo consent disclosure in `slop` onboarding before enabling photo uploads for `chicago`.
- **Florida FTSA (Miami SMS quiet hours)**: Florida Telephone Solicitation Act (FTSA) enforces strict quiet hours. The platform enforces a safe `20:30 – 09:00` local quiet window in each city's `CITY_TZ` (stricter than federal TCPA `21:00 – 08:00`).

---

## 2. Venue Catalog, External APIs, Caching, and Sufficiency ("Our Own Yelp")

### 2.1 External Provider Comparison (Google Places API New vs Yelp Fusion vs Overture)

| Dimension | Google Places API (New) | Yelp Fusion API | Overture Maps / Foursquare OS |
|---|---|---|---|
| **Pricing and Quotas** | Pay-as-you-go with free monthly caps: Essentials IDs-Only **$0 unlimited**; Pro **5k free/mo** ($32/1k Search, $17/1k Details); Enterprise **1k free/mo** ($35/1k Search, $20/1k Details); Enterprise+Atmosphere **1k free/mo** ($40/1k Search, $25/1k Details). | Free production tier retired. Paid plans start at **~$229/mo** (Base, 30k calls, ~15 attributes), ~$299/mo Enhanced, **~$643/mo** Premium (66 attributes). | **$0** data license (CDLA Permissive 2.0 / Apache 2.0). Self-hosted in Postgres. |
| **Caching and ToS** | GMP ToS §3.2.3 prohibits caching names, addresses, hours, ratings, or reviews. **Allowed:** `place_id` cached indefinitely; `lat`/`lng` cached max **30 consecutive days** (`geo_expires_at`). | **24-hour max cache** on API payloads. Business `id` kept only for backend join. Prohibits building a persistent local mirror. | **Permanent local caching**, indexing, and modification allowed. |
| **Closure and Hours** | `businessStatus` (`OPERATIONAL`, `CLOSED_TEMPORARILY`, `CLOSED_PERMANENTLY` — Pro); `currentOpeningHours` (holiday-aware next 7 days — Enterprise). | `is_closed` boolean (permanent only; lags temporary closures); weekly `hours[].open` and `is_open_now`. | Static monthly snapshots; no live hours or temporary closure data. |
| **Price Tiers** | `priceLevel` (`FREE` to `VERY_EXPENSIVE` — Enterprise) plus `priceRange`. | `price` (`$`–`$$$$`). | Sparse price metadata. |
| **Categories and Attributes** | Strong park/plaza coverage; Atmosphere booleans (`outdoorSeating`, `goodForGroups`, `servesCoffee`, `servesVegetarianFood`, `reservable`, `liveMusic`, `restroom`). No `noise_level`. | Good dining attributes (`noise_level`, `ambience`) only on $643/mo Premium tier. Weak on parks and plazas. | Broad POI categories; weak atmosphere booleans. |

### 2.2 Hybrid Curated + External Architecture

**Primary external provider: Google Places API (New).** It has zero monthly minimum cost, generous free tiers at MVP scale, holiday-aware `currentOpeningHours`, `CLOSED_TEMPORARILY` detection, and full coverage of public parks, plazas, and bookstores.

**Optional secondary provider: Yelp Fusion.** Used only as an optional adapter when `YELP_API_KEY` is configured for initial rating priors or cross-checking, respecting its 24-hour cache TTL (`platform.venue_api_cache`).

**ToS-compliant storage split ("Our Own Yelp"):**
1. **Persistent first-party catalog (`platform.venues`)**: Stores curated seed venues, Overture/open POI bases, member-contributed spots, our own normalized suitability scores (`group_score`, `date_score`), arrival landmarks, `google_place_id` (indefinite), optional `yelp_id` (relational key only), and first-party Bayesian taste statistics (`persona_priors`, `persona_stats`, `overall_likes`, `overall_dislikes`, `visit_count`).
2. **Expiring Google fields**: Any Google-sourced `lat`/`lng` records `geo_expires_at = clock.now() + 30 days`. Never persist Google reviews, review text, or Google photo binaries.
3. **Short-lived response cache (`platform.venue_api_cache`)**: Caches normalized search responses keyed by `(provider, city, neighborhood, category, price_tier)` with TTL `<= 24 hours` for Yelp and session/ephemeral hydration for Google.

### 2.3 Sufficiency Cutoff (`>= 10` Local Matches = Zero External Search Calls)

External venue discovery stops as soon as the local catalog is sufficient for the requested slot.

1. Query `platform.venues` for the target `(city, candidate_neighborhoods, category, price_tier, status = 'active')` and run `venueHardEligible` (from `packages/core/src/generated/venueSelection.ts`, spec [`spec/venueSelection.md`](../../spec/venueSelection.md)) across all attendees.
2. Count the qualified local matches (`localQualifiedCount`).
3. Call `shouldFetchExternalVenues(localQualifiedCount, 10, apiBudgetRemaining)`:
   - If `localQualifiedCount >= 10`: return `false`. Make **0 external search API calls**.
   - If `localQualifiedCount < 10` and `apiBudgetRemaining > 0`: run two-stage discovery:
     - **Stage A (Discovery)**: Call Google `Nearby Search (New)` or `Text Search (New)` with Essentials IDs-Only (`places.id`, $0) or Pro FieldMask (`places.id,places.displayName,places.location,places.primaryType,places.businessStatus`) to find unseen `place_id` values.
     - **Stage B (Selective Hydration)**: Call `Place Details (New)` (`Enterprise + Atmosphere`) once for top unseen candidates only, compute normalized suitability attributes, and store first-party records.

As members visit venues and report feedback, the local pool crosses 10 qualified venues per neighborhood-category cell, driving external search cost toward zero.

### 2.4 Pre-Recommendation Open Verification

Never recommend a venue that is closed or about to close.

1. Before proposing a primary or backup venue, call `needsPreRecommendOpenCheck(ageMinutes, isWeekendOrHoliday)` (`packages/core/src/generated/venueSelection.ts`):
   - **Weekday TTL**: `24 hours` (`1440` minutes) since `verified_open_at`.
   - **Weekend or holiday TTL**: `6 hours` (`360` minutes) since `verified_open_at`.
2. If stale (or `ageMinutes < 0`), run one lightweight `Place Details (New)` call with FieldMask `businessStatus,currentOpeningHours` (Enterprise SKU).
3. Verify both conditions:
   - `businessStatus === "OPERATIONAL"`.
   - Scheduled opening hours cover the full required buffer past proposed start time:
     - **1-on-1 meeting**: `>= 90 minutes` open buffer.
     - **Group meetup (`groupSize >= 3`)**: `>= 120 minutes` open buffer.
4. If the venue fails either check, update its status, remove it from the candidate set, and select the next ranked venue.

### 2.5 Immediate Closure Quarantine

A venue reported closed by a member must never be recommended to another member ten minutes later.

`nextVenueStatusOnReport` (`packages/core/src/generated/venueSelection.ts`) enforces this state machine:

```
              user closure report
  [active] ─────────────────────────► [suspect_closed]  (excluded immediately)
                                            │
       ┌────────────────────────────────────┼──────────────────────────────────┐
       │ provider CLOSED_PERMANENTLY        │ provider CLOSED_TEMPORARILY      │ provider OPERATIONAL
       │ OR >= 2 independent user reports   │                                  │ (1 report only)
       ▼                                    ▼                                  ▼
[closed_permanent]                  [closed_temporary]                [suspect_closed]
(tombstone; never recommend)        (quarantine 30 days;              (hold 7 days +
                                     set recheck_after)                staff review)
```

- **Zero lag**: The status switches to `suspect_closed` in the same transaction that records the user's feedback or arrival report.
- **No accidental resurrection**: Only an explicit provider re-verification after `recheck_after` or a staff clear action can move `closed_temporary` or held `suspect_closed` back to `active`. `closed_permanent` is a terminal tombstone.

### 2.6 Hard Member Exclusions, Price Tiers, Taste Learning, and Organic Growth

#### Hard Exclusions (`venueHardEligible` in `spec/venueSelection.md`)

Every candidate venue must pass all hard gates before ranking:
- **Public and active**: `isPublic === true` and `status === Active`.
- **Age and teen safety**: `venueAgeMin <= minMemberAge`. When any attendee is a minor (`minMemberAge < 18`), require `venueAgeMin <= 13`, `!isBarOnly`, `alcoholOptional`, and `!isAlcoholCentric`, and cap teen groups at `<= 6` on `friends.help` / `ntwrk` Friend only while `!teenStopped` (enforcing `teen_place_contact = 0` and `teen_group_contact = 0`).
- **Non-drinker safety**: If any attendee is a non-drinker, require `!isBarOnly && alcoholOptional`. Strict sober members also exclude alcohol-centric venues (breweries, wine bars, cocktail lounges).
- **Dietary and accessibility constraints**: Enforce `servesVegetarian`, `servesVegan`, and `wheelchairAccessible` when required by any attendee.
- **Price ceiling**: Require `priceTier <= maxBudgetTier` across all attendees (`0 = free`, `1 = $`, `2 = $$`, `3 = $$$`, `4 = $$$$`).
- **Travel limit**: `maxTravelMin <= travelLimitMin`.
- **Open verification**: Freshly verified open with `>= 90m` (pair) or `>= 120m` (group `>= 3`) buffer.
- **No repeats or rejects**: Exclude every venue in any attendee's `network.venue_visits` (within repeat cooldown or permanently for first dates) and `network.venue_rejections`.
- **Group logistics (`groupSize >= 3`)**: Require `!reservationRequired && separateChecks && walkInCapacity >= groupSize` and block outdoor-only venues in bad weather or after sunset.

#### Price Tier Matching (`venueBudgetFitScore`)

Within the hard ceiling `priceTier <= maxBudgetTier`, score budget comfort by matching the pair's or group's target spend tier (`min` comfort tier prevents awkwardness for the most budget-conscious member).

#### Persona Priors and Online Bayesian Taste Updates

Each venue starts with a cold-start prior combining its curated `persona_priors` (per archetype, such as `coffee_creative`, `foodie`, `outdoorsy`, `night_owl`, `quiet_reader`) and external `yelp_rating` prior:
- Store Beta distribution parameters $(\alpha_k, \beta_k)$ per archetype $k$ in `platform.venues.persona_stats`, initialized from `persona_priors` (pseudo-count weight `4`) plus global `(overall_likes, overall_dislikes)`.
- Posterior mean score for archetype $k$:
  $$\hat{p}_k = \frac{\alpha_k}{\alpha_k + \beta_k}$$
- After each visit feedback (`applyVenueFeedback` in `packages/core/src/venues.ts`):
  - Positive vibe (`great` / `ok`): increment `overall_likes` and $\alpha_k$ for the reporting member's archetypes.
  - Negative vibe (`too_loud`, `crowded`, `bad_seating`, `price_mismatch`): increment `overall_dislikes` and $\beta_k$, and adjust suitability penalties (for example, demote `group_score` if two groups report `too_loud` or `no_seating`).
  - Closure report: immediately quarantine via `nextVenueStatusOnReport`.

#### Organic Catalog Growth from Member Activity

When a member mentions a spot they love or visited during normal conversation (for example, *"I love going to Maru Coffee in Los Feliz"*):
1. Extract the venue mention as a candidate POI in the member's city.
2. Verify via one `Place Details (New)` lookup that the place is `OPERATIONAL`, public, and not a private residence.
3. Upsert into `platform.venues` with `source = 'member_organic'`, seed its `persona_priors` from the mentioning member's archetypes, and record the visit in `network.venue_visits` so the member is not immediately sent back there on a first date while other similar members benefit from the discovery.

### 2.7 Database Schema Summary (`0098_five_cities_venues_followups.sql`)

Migration `packages/db/migrations/0098_five_cities_venues_followups.sql` (following `0097_participation_booked_told.sql`) adds:
- **Seed rows**: All 5 rows in `platform.cities` (`sf`, `nyc`, `la`, `chicago`, `miami`) and all 20 `<app>:<city>` rows in `platform.networks` (`ON CONFLICT (id) DO NOTHING`, preserving existing `*:nyc` rows).
- **`platform.venues`**: Canonical public venue catalog with `CHECK (is_public = true)`, `CHECK (price_tier BETWEEN 0 AND 4)`, `age_min smallint not null default 18`, `CHECK (status IN ('active','suspect_closed','closed_temporary','closed_permanent'))`, indexes on `(city, status, price_tier)` and `(city, neighborhood, status)`, and partial unique indexes on `google_place_id` and `yelp_id`.
- **`platform.venue_api_cache`**: TTL-bounded external API response cache.
- **`network.venue_visits`** and **`network.venue_rejections`**: Per-app, per-member visit and rejection memory with `ENABLE/FORCE ROW LEVEL SECURITY` and app-scoped policies matching `0004`–`0097`.
- **`network.meetup_arrivals`**: Active arrival coordination state per `(opportunity_id, member_id)` with backup venue reference and RLS.
- **`network.work_intros`**: Work introduction channel, slot confirmation, video URL, follow-up timestamps, and hiring stage with RLS.
- **Additive columns (`ADD COLUMN IF NOT EXISTS`)**: `venue_id`, `backup_venue_id`, `work_intro_channel`, `followup_scheduled_at`, `followup_sent_at` on `network.opportunities`; `venue_id`, `venue_sentiment`, `venue_closed_report`, `venue_issues` on `network.feedback`.

---

## 3. Impromptu Group Events (`friends`)

Impromptu group meetups bring together 4 to 6 strangers who have no reservation and no venue partnership. Standard sit-down restaurants fail for this format because host stands refuse incomplete walk-in groups and single-check bills create social friction.

### 3.1 Eight Evaluation Dimensions and 100-Point Scoring Rubric

`groupVenueRubricScore` in `spec/venueSelection.md` (`packages/core/src/generated/venueSelection.ts`) computes a deterministic score from `0` to `100` across eight weighted dimensions:

| # | Dimension | Max Pts | Great (Full Points) | Terrible (0 Points / Disqualified) |
|---|---|---|---|---|
| 1 | **Separate checks / counter ordering** | **20** | Food hall, counter cafe, order-at-bar taproom. Each person buys what they want. | Sit-down restaurant refusing split checks or requiring host-stand commitment. |
| 2 | **Walk-in seating & spatial flexibility** | **20** | Communal picnic tables, large multi-table lounge, open patio (`walkInCapacity >= 6`). | Tiny 2-top wine bar or reservation-only dining room. |
| 3 | **Conversational acoustics (55–72 dBA)** | **15** | Lively ambient hum that masks silence without shouting across 6 seats. | Live band/DJ (`>80 dBA`), loud sports bar on game night, or library-quiet study cafe (`<45 dBA`). |
| 4 | **Alcohol-optional & dietary inclusivity** | **15** | Espresso, tea, mocktails, NA beer, plus food stalls/vegetarian options. | 21+ dive bar with no food or non-alcoholic options. |
| 5 | **Safety, visibility & easy solo exit** | **10** | Well-lit, active foot traffic, clean restrooms, clear street frontage. | Secluded park after dusk, unmarked basement or speakeasy. |
| 6 | **Weather resilience** | **10** | Reliable indoor or covered heated/AC seating for rain, Miami heat, Chicago winter, SF wind. | Uncovered outdoor-only space during bad weather or after sunset. |
| 7 | **Clear arrival landmark ("findability")** | **5** | One unambiguous physical anchor (e.g., *"inside by the main espresso bar"*). | Sprawling multi-floor maze or unmarked park lawn. |
| 8 | **City transit / parking access** | **5** | Near major subway/L/BART lines in transit cities; clear parking/rideshare in LA/Miami. | Dead zone requiring 2+ transfers or impossible parking. |

### 3.2 Hard Disqualifiers (Instant Reject for Impromptu Groups)

A venue is immediately disqualified for an impromptu group regardless of score if any condition holds:
- `status !== Active` or `!isPublic`.
- `reservationRequired === true` or `separateChecks === false` or `walkInCapacity < groupSize`.
- Closing `< 120 minutes` after scheduled start time.
- Uncovered outdoor-only when forecast temperature `< 55°F` or `> 90°F`, rain probability `> 30%`, or start time is after sunset.
- `liveMusicAtNight === true` for slots starting at or after `19:00` local time.
- Roster includes a minor (`13..17`): venue has `ageMin > 13`, `isBarOnly`, `!alcoholOptional`, or `isAlcoholCentric`, or `groupSize > 6`, or `teenStopped === true`.

### 3.3 Venue Taxonomy Tiers

| Tier | Score Range | Typical Venue Types | Assignment Rule |
|---|---|---|---|
| **Tier S** | 85–100 | Food halls, spacious craft breweries/taprooms (adults only; with NA + food), large all-day bakery-cafes | **Default** for `friends` 4–6 meetups (all-ages subset only when a minor is in the roster). |
| **Tier A** | 70–84 | Indoor/outdoor beer gardens (adults), bookstore-cafes, museum/hotel lobby cafes, spacious casual diners | **Strong backup** and primary when Tier S is exhausted or visited. |
| **Tier B** | 55–69 | Public parks/waterfront plazas (daytime clear weather only), casual wine bars (adults), cocktail lounges (adults) | **Conditional**; preferred for `slop` 1-on-1 adult dates rather than 6-person groups. |
| **Tier F** | < 55 | Reservation-only restaurants, loud clubs/music venues, `<12`-seat espresso bars, unmarked speakeasies | **Never** selected for impromptu groups. |

---

## 4. On-Site Arrival Coordination ("Finding Each Other")

Members who meet through an agent do not have each other's phone numbers. The repository already includes the fixed anonymous late-arrival notice (`spec/groupLateArrival.md`, `packages/network/src/group-late-arrival.ts`). On-site arrival coordination extends this for **confirmed adult (`>= 18`) meetups** with structured arrival cues, backup venue pivot, and active no-show escalation.

### 4.1 Timeline and Phases (`meetupPhase` in `spec/meetupArrival.md`)

| Phase | Time Window (Relative to `meetingAt`) | System Behavior |
|---|---|---|
| `Before` | `< T-75 min` | Normal pre-meeting state. No arrival relay active. |
| `PreBrief` | `T-75 min` to `T-30 min` | Send **1 Pre-Arrival Brief** with venue name, street address, map link, explicit arrival landmark, attendee first names, check-in cue, and quiet 1-on-1 safety line (*"Text me anytime if you need an out or anything feels off"*). Pre-select and verify one **Backup Venue** within a 5-minute walk and store `backup_venue_id` on the opportunity. |
| `ActiveArrival` | `T-30 min` to `T+45 min` | Arrival relay mode is open for confirmed adult (`>= 18`) attendees. Natural arrival texts parse into safe logistics events and relay to confirmed adult attendees. |
| `Closed` | `> T+45 min` or all confirmed `met` | Arrival relay automatically closes. Later messages never fan out without explicit relay or `SHARE` consent. |

### 4.2 Safe Relay Pipeline (Zero Privacy Regression, Zero Teen Arrival Relay)

> **Warning:** Arrival coordination must never include a minor (`< 18`), never bypass the existing relay safety stack, and never expose phone numbers, emails, last names, home addresses, or agent-generated appearance descriptions.

Every inbound arrival message passes through all existing and new guards:
1. **Eligibility gate (`canRelayArrival` in `spec/meetupArrival.md`)**: Verify sender and every recipient are adults (`>= 18`), confirmed `yes` attendees of this scheduled opportunity, not blocked, not opted out, inside `ActiveArrival`, not already marked `met`, and `leakClean && safetyClean`. Minors never send or receive arrival relays (`teen_relay_contact = 0`).
2. **Structured logistics parsing**: Parse natural messages (*"running 10m late"*, *"here in a green jacket at the back patio table"*, *"this place is closed"*, *"packed with a 40m wait"*) into:
   ```ts
   type ArrivalState = "en_route" | "late" | "arrived" | "seated" | "met" | "venue_closed" | "venue_full" | "cannot_find";
   ```
   with optional `etaMins`, `safeOutfitCue`, and `spotLandmark`.
3. **Safety and leak filters**:
   - Strip phone numbers, emails, social handles, and last names.
   - Run `packages/core/src/guard.ts` (`LeakGuard`), `RELAY_RULES` (scam, off-platform contact fishing, location fishing, harassment), appearance leak guard, and Clef relay classifier (`clef-flash`, fail-closed in production).
   - **Self-described cues only**: Allow a member's own clothing or landmark cue (*"wearing a blue jacket near the espresso bar"*). Never generate or relay agent commentary about a member's body or looks.
4. **Delivery channel and cap handling**: Send through the ConsentNetwork / Blooio outbound queue with leak checking enabled. Arrival updates inside an active `T-30m..T+45m` window bypass proactive quiet-hour deferral and do not consume the proactive outreach cap (because attendees opted into the active meeting). `STOP`, blocks, and panic exits halt delivery immediately.

### 4.3 Relay Cadence: 1-on-1 Immediate vs 4–6 Group Batched Digests

- **1-on-1 (`slop`)**: Relay immediately as one concise message:
  `"[FirstName] says: just got here, wearing a blue denim jacket near the coffee bar."`
- **4–6 Group (`friends`, adult rosters)**: Debounce and batch updates every **60 to 90 seconds** into one digest per attendee so 5 people texting at once do not trigger 25 message blasts:
  `"Arrival update: Sam is here (blue jacket, back patio table) and Maya is 5 min out."`
  *Exception:* A `venue_closed` or `venue_full` backup pivot broadcasts immediately without waiting for the batch window.

### 4.4 Failure Handling During Arrival

1. **Surprise closure and venue-full auto-pivot (`shouldPivotToBackup`)**:
   - If any confirmed attendee reports `venue_closed` during `PreBrief` or `ActiveArrival`, immediately quarantine the primary venue (`status = 'suspect_closed'`), activate the pre-verified `backup_venue_id`, and broadcast the backup venue's name, address, map URL, and arrival landmark to all confirmed attendees.
   - If an attendee reports `venue_full` (packed with no walk-in seating), pivot to the pre-verified `backup_venue_id` and log a crowded venue taste signal **without** quarantining the primary venue as closed.
   - If no pre-verified backup exists, query the local catalog for the nearest open public venue within a 5-minute walk and verify it before broadcasting; if none exists, notify attendees cleanly and offer to reschedule.
2. **Panic safety exit and anchor failover**:
   - A mid-meetup panic exit immediately closes the arrival window, halts all relays, cancels the meetup, and blocks remaining attendees for the reporting member without alerting them.
   - If a `friends` group anchor drops before start, promote a confirmed adult co-anchor if `>= 3` remain, or cancel cleanly before anyone travels if quorum is lost.
3. **No-show guard (`noShowDecision` in `spec/meetupArrival.md`)**:
   - If Attendee A marks `arrived` and Attendee B has not checked in by **`T+12 min`**, ping B (`"[FirstName] is at [Venue] — still heading over?"`).
   - If B still has not responded or confirmed by **`T+18 min`**, update A (`"Haven't heard back from [FirstName] yet — feel free to grab a coffee or head out whenever you want, no pressure."`) so nobody sits stranded.

---

## 5. Proactive Post-Encounter Follow-Up

### 5.1 Timing Strategy and Compliance

Delayed check-ins suffer from faded memory and low response rates. Fixed `meetingAt + 3h` messages violate quiet hours after evening dates.

`computeFollowupLocalHour`, `followupIsNextDay`, and `canSendFollowup` in [`spec/encounterFollowup.md`](../../spec/encounterFollowup.md) (`packages/core/src/generated/encounterFollowup.ts`) enforce one deterministic schedule in the recipient's city local time (`CITY_TZ`, driven by `Clock`):

| Encounter End Time (Local) | First Follow-Up Dispatch | Rationale |
|---|---|---|
| **Daytime (`endLocalHour <= 16`)** | Same day at `endLocalHour + 2` (clamped `< 20:00` local) | Captures peak recency after the commute home while staying inside safe hours. |
| **Evening (`endLocalHour > 16`)** | Next morning at **9:00–9:30 AM local** (`followupIsNextDay === true`) | High completion rate, zero nighttime intrusion, zero TCPA/FTSA violation. |
| **Work intro (`peon`)** | Local hour **10:00 AM** at `T+7d` (optional `T+72h` bounce nudge) | Matches professional inbox hours without nagging. |

Compliance and budget gates proved in `spec/encounterFollowup.md`:
- **Safe quiet hours**: Never send proactive follow-ups between **`20:30` and `09:00`** recipient local time (satisfies federal TCPA/CTIA and Florida FTSA for Miami).
- **Daily cap**: Require `dailyProactiveCount < dailyCap` (`dailyCap <= 3`) across all apps for that person.
- **Opt-out**: Require `!optedOut` (`STOP` or `leave <app>`).
- **Backoff limit**: Require `remindersSent < maxReminders` (`maxReminders <= 2`: 1 initial prompt + at most 1 gentle nudge at `T+36h`), then stop.
- **No mid-date survey**: Never interrupt an encounter while it is happening; keep safety check-out instructions as one quiet line in the `T-75m` pre-arrival brief.

### 5.2 Single-Turn Combined Prompt and Signal Extraction

One short message captures both match quality and venue quality without survey fatigue:
- **1-on-1 (`slop`)**: `"Hey! How did it go with [FirstName] at [Venue]? Would you want to see them again — and was [Venue] open with a good vibe?"`
- **Group (`friends`)**: `"Morning! How was the hangout at [Venue] — anyone you'd want to connect with again? Also quick check: was [Venue] open & easy to talk?"`

The reply extractor writes four structured fields to `network.feedback` and `network.venue_visits`:
1. `attended`: `yes | no | no_show` (feeds reliability scoring and `otherNoShow` safety tracking).
2. `match_interest`: `yes | no | subset` (triggers mutual repeat encounter or crew check).
3. `venue_vibe`: `great | ok | too_loud | crowded | bad_seating | price_mismatch` (updates Bayesian `persona_stats` in `platform.venues`).
4. `venue_closed`: `boolean` (if `true`, triggers immediate quarantine via `nextVenueStatusOnReport`).

---

## 6. Work Introductions (`peon`) — Boardy Analysis

### 6.1 Why Professional Introductions Follow Different Rules

In professional networking (as shown by Boardy.ai and founder/hiring norms), the communication medium signals professionalism and protects personal boundaries.

| Channel | Professional Etiquette | Expected Conversion | Privacy / Boundary Risk | Friction |
|---|---|---|---|---|
| **Warm Double-Opt-In Email (`WarmEmail`)** | Gold standard | **60–80%+** (near 100% after double opt-in) | Low (work email expected; personal cell stays private) | Low (async, searchable thread, easy resume/LinkedIn/calendar attach) |
| **Unsolicited Group SMS** | Poor / faux pas for strangers | Low; high ghosting | **High** (exposes personal cell number immediately) | Medium (no subject or context trail) |
| **Cold 3-Way Phone Call** | Awkward / intrusive | Very low | High (real-time interruption + phone exposure) | Very high |
| **Unsolicited Calendar / Meet Invite** | Aggressive ("calendar-jacking") | `<10%` unsolicited; high if slot pre-agreed | Medium | High if cold; strong once slot is locked |
| **In-Person Physical Venue** | Unnecessary barrier for remote/hybrid work | Low | High overhead (commute, venue risk) | High |

### 6.2 Existing Codebase Defect Fixed

Previously, `ConsentNetwork.reveal()` in `packages/network/src/network.ts` called `meetingTime()` and `meetingSpot()` even for `peon` job seats (`o.seat`), attaching a physical NYC park or plaza and logging a physical meeting, and `peon` cofounder matches fell back to physical venues too. This design eliminates physical venue assignment for `peon` work introductions completely and proves `workIntroNeverInPersonVenue` in `spec/workIntroChannel.md` and `spec/models/work_intro.md`.

### 6.3 `peon` Introduction Flow and Channel Priority

The flow preserves strict **candidate-first double opt-in** (a hiring manager is never probed until the candidate answers explicit `yes`; a question or counter-offer is not a yes) and is strictly **adult-only (`>= 18`)**:

1. **Candidate probe**: Send role title, posted pay range, work mode/market, and anti-scam notice. Never expose manager identity.
2. **Manager probe (only after candidate `yes`)**: Send blind requirement checklist (`yes`/`no` match on must-haves, optional start timeline). Never expose candidate name, score, rank, or protected attributes.
3. **Channel selection (`chooseWorkIntroChannel` in [`spec/workIntroChannel.md`](../../spec/workIntroChannel.md))**:
   - **Default — `WarmEmail`**: Selected when both adults opted in, both have a work email on file, and they have not both requested a slot-locked video intro. The service sends one double-opt-in intro email (`To: candidate, manager`, `Reply-To: both`, `BCC: intro@peon.biz`) with 2-sentence context per person, why they matched, and an explicit "who takes the ball" cue, plus one text confirmation to each side.
   - **Fallback 1 — `ScheduledVideo`**: Selected when both adults opted in and explicitly confirmed an overlapping slot (`mutualSlotConfirmed === true`), either because email is unavailable or because they requested a scheduled video call. Never sends an unsolicited calendar or Meet invite.
   - **Fallback 2 — `RelayShare`**: Selected when both adults opted in, email is missing, and no mutual video slot is confirmed. Both communicate through the leak-checked relay and may swap contact details only via explicit bilateral `SHARE` consent (15-minute TTL).
   - **Structurally excluded channels**: The `WorkIntroChannel` variant (`NoChannel | WarmEmail | ScheduledVideo | RelayShare`) structurally excludes `in_person_venue`, `group_sms`, and `cold_three_way_call`.
4. **Work follow-up cadence** (stored in `network.work_intros`):
   - **T+72h**: Lightweight bounce or unacknowledged nudge only if the intro email bounced or neither side replied.
   - **T+7d**: One outcome check-in feeding `peon` hiring stages (`introduced` -> `interview` -> `offer` -> `hire` -> `check_in_90d`).

---

## 7. Complete User Stories (US-1 to US-22 -> Product Stories F53–F57)

Product stories [`F53`–`F57`](../../spec/product/stories.md#story-f53--match-and-travel-fairly-across-five-launch-cities) own the canonical acceptance rules. The table below maps concrete five-city scenarios to those stories.

| ID | Story | App | City | Actor & Scenario | Expected System Behavior & Acceptance Criteria |
|---|---|---|---|---|---|
| **US-1** | F53 | `slop` | `sf` | Two adults in Mission and Russian Hill match for a weekday coffee date (`$`–`$$`). | `chooseFairMidpoint` selects Hayes Valley or SoMa within 25m max travel; avoids Bay Bridge (+25m); proposes a verified open `coffee_shop` with `>= 90m` buffer and backup within 5m walk. |
| **US-2** | F53 | `slop` | `nyc` | Two adults in West Village and Williamsburg match for an evening drink (`$$$`). | Minimax midpoint penalizes East River crossing (+10–15m) and picks a transit-direct hub (East Village/LES/Flatiron) `<= 25m` max; verifies open hours with `>= 90m` buffer; excludes permanently closed spots. |
| **US-3** | F53 | `slop` | `la` | Two adults in Santa Monica (Westside) and Silver Lake (Eastside) are evaluated at rush hour. | 405 / Sepulveda barrier penalty (+20m) pushes beyond the 35m date cap (even after +10m relaxation); system declines to force an unfair cross-city date or snaps to Culver City/Mid-City only if both stay within cap. |
| **US-4** | F53, F55 | `friends` | `chicago` | Five adults along Red and Blue L lines join an impromptu Thursday evening hangout. | Minimax midpoint penalizes diagonal E/W transfers (+15m) and picks West Loop/Fulton Market or The Loop (`<= 40m` max); selects a Tier S indoor winter-proof venue (`Time Out Market Chicago` or `Starbucks Reserve Roastery`) with separate checks and `>= 120m` open buffer. |
| **US-5** | F53, F55 | `friends` | `miami` | Four adults in Brickell, Coconut Grove, and Wynwood join a Saturday afternoon hangout; tropical rain forecast > 30%. | Causeway penalty (+20m) keeps meetup on mainland (Wynwood/Brickell); rain forecast disqualifies uncovered outdoor parks (`Maurice A. Ferre Park`); selects indoor/covered Tier S venue (`1-800-Lucky` or `Books & Books Coral Gables`). |
| **US-6** | F54 | `slop` | `nyc` | Local catalog already has 12 active qualified `$$` cafes in Flatiron/West Village. | `shouldFetchExternalVenues` returns `false` (`localQualifiedCount >= 10`); **0** external search API calls fire. |
| **US-7** | F54 | `friends` | `chicago` | New neighborhood-category query has only 4 local qualified venues in Hyde Park. | `shouldFetchExternalVenues` returns `true` (`< 10`); runs Stage A IDs-only/Pro search and selective Stage B hydration; persists first-party record with `geo_expires_at = +30d` and never caches Google reviews/photos. |
| **US-8** | F54 | `slop` | `la` | Top-ranked venue (`verified_open_at` 30h ago) returns `CLOSED_TEMPORARILY` during pre-recommendation open check. | System marks venue `closed_temporary` with 30-day `recheck_after`, removes it from the proposal, and proposes the #2 verified open venue. |
| **US-9** | F54 | `slop` | `miami` | Attendee reports *"All Day is closed for a private event"* in post-date follow-up. | `nextVenueStatusOnReport` immediately moves venue to `suspect_closed`; no other member receives it; async Place Details check runs; if provider still says `OPERATIONAL`, holds 7 days for staff review. |
| **US-10** | F54, F55 | `friends` | `sf` | A group of 5 adults includes one non-drinker, one vegan, and one wheelchair user with max budget `$$`. | `venueHardEligible` rejects bar-only spots, non-vegan venues, non-accessible venues, and `$$$`/`$$$$` spots; selects an accessible, alcohol-optional, vegan-friendly `$$` food hall (`Ferry Building Marketplace`). |
| **US-11** | F54 | `slop` | `nyc` | Member A previously visited `Devocion` on an earlier date and previously rejected `Veselka`. | `network.venue_visits` and `network.venue_rejections` exclude both venues; system recommends an unvisited, unrejected venue (`Conwell Coffee Hall` or `McNally Jackson Seaport`). |
| **US-12** | F54 | `slop` | `la` | Member tells the agent in chat: *"I went to Maru Coffee in Los Feliz yesterday, loved the quiet vibe."* | Organic capture verifies `Maru Coffee` is public and `OPERATIONAL`, upserts it into `platform.venues` (`source = 'member_organic'`), seeds priors for the member's archetypes, and logs it as visited for that member. |
| **US-13** | F55 | `slop` | `sf` | 1-on-1 adult date at `Sightglass Coffee` enters `PreBrief` (`T-75m`) then `ActiveArrival` (`T-30m`); both send arrival updates. | At `T-75m`, both receive pre-arrival brief with landmark, backup venue, and quiet safety line. At `T-10m`, *"here in a red beanie by the window"* relays immediately after `LeakGuard` + `RELAY_RULES` + Clef pass. |
| **US-14** | F55 | `friends` | `nyc` | Five confirmed adults arrive at `Moynihan Train Hall` within 90 seconds of each other. | System debounces updates into 1–2 concise 60–90s status digests; arrival relays do not exhaust the 3-proactive/day cap; relay auto-closes once `met` or at `T+45m`. |
| **US-15** | F55 | `friends` | `miami` | First attendee arrives at `Veza Sur Brewing` at `T-10m` and texts *"gates are locked, closed today"*. | `shouldPivotToBackup` immediately quarantines `Veza Sur` (`suspect_closed`) and broadcasts the pre-verified backup venue (`1-800-Lucky`, address + landmark) to all confirmed attendees without waiting for batch debounce. |
| **US-16** | F55 | `slop` | `chicago` | Member A marks `arrived` at `Good Funk`; Member B is silent past `T+12m` and `T+18m`. | At `T+12m`, system pings B (`"[FirstName] is at Good Funk — still heading over?"`). At `T+18m`, system updates A so A is not left stranded. |
| **US-17** | F56 | `slop` | `la` | Afternoon coffee date ends at `14:00` local vs evening drinks ending at `21:00` local. | Daytime date triggers combined person+venue follow-up at `16:00` local same day; evening date defers follow-up to next morning `09:00–09:30` local (respecting `20:30–09:00` quiet hours). |
| **US-18** | F56 | `friends` | `miami` | Evening hangout ends at `21:30` ET; attendee ignores morning follow-up at `09:30` ET. | Initial follow-up waits until next morning `09:30` ET (FTSA-compliant); 1 gentle nudge fires at `T+36h` inside allowed hours; after 2 total attempts (`remindersSent = 2`), system stops permanently. |
| **US-19** | F57 | `peon` | `sf` + `nyc` | Remote staff engineer in SF matches with a verified hiring manager in NYC; both have work emails. | Candidate receives blind role + pay range first and replies `yes`; only then is manager probed and replies `yes`; `chooseWorkIntroChannel` picks `WarmEmail`; zero physical venue assigned; 1 intro email + 1 confirmation fire; `T+7d` check-in follows. |
| **US-20** | F57 | `peon` | `chicago` | Candidate opts in without providing an email and asks for a 15-minute video chat. | Agent collects 2–3 availability windows from both, locks explicit mutual confirmation on one slot, then sends `ScheduledVideo` link (never an unsolicited calendar invite). |
| **US-21** | F57 | `peon` | `miami` | Manager declines to share email and declines scheduling a call, preferring mediated relay. | `chooseWorkIntroChannel` falls back to `RelayShare`; both communicate via leak-checked relay and may swap contact info only via bilateral `SHARE` within 15m TTL; never drops them into group SMS or cold 3-way call. |
| **US-22** | F54–F57 | `friends`, `ntwrk`, `slop`, `peon` | `chicago` | A teen-ready 16-year-old joins `friends.help` and `slop.date`; an adult sends `leave slop.date` or `STOP`. | On `slop.date` and `peon.biz`, the minor stays strictly single-player (zero dates, zero work intros). On `friends.help` / `ntwrk` Friend (while `!teenStopped`), the minor can receive strict-rubric reviewed friendship intros with 13–18 peers within 2 calendar years only at all-ages public venues (`<= 6` people) with **zero** number/photo/arrival relay; `teenStop` makes minors single-player across every app. Adult `leave slop.date` stops only `slop`; `STOP` halts every app immediately including arrival relays and follow-ups. |

---

## 8. Failure-Mode and Unhappy-Path Matrix (FM-1 to FM-18)

| ID | Failure Mode | Trigger | System Behavior & Recovery | Formal Invariant Name(s) | Simulation / Integration / E2E Coverage |
|---|---|---|---|---|---|
| **FM-1** | **Pre-proposal permanent closure** | Pre-recommendation open check returns `CLOSED_PERMANENTLY` or hours end `< 90m`/`< 120m` after start. | Tombstone venue (`closed_permanent`) or reject slot; pick next ranked verified venue; never propose closed spot. | `noClosedOrSuspectVenueRecommended`, `recommendedMustBeVerifiedOpen` | `spec/models/venue_lifecycle.md` (`preRecClosureFallbackTest`), `spec/venueSelection.md`, `venues` integration tests |
| **FM-2** | **Surprise closure on arrival** | Confirmed attendee texts *"venue is closed"* during `PreBrief` or `ActiveArrival`. | Immediately set primary venue `suspect_closed`; broadcast pre-verified `backup_venue_id` (address + landmark) to all confirmed attendees; enqueue provider check. | `closureQuarantinesImmediately`, `closureAlwaysPivotsWhenBackupExists` | `spec/models/meetup_coordination.md` (`groupArrivalBackupPivotTest`), `spec/meetupArrival.md`, `meetup` integration tests |
| **FM-3** | **Temporary closure, buyout, or venue full** | Provider returns `CLOSED_TEMPORARILY`; 1 user reports closure while provider says `OPERATIONAL`; or attendee reports `venue_full`. | `CLOSED_TEMPORARILY` -> `closed_temporary` + 30d `recheck_after`; 1 closure report -> `suspect_closed` (7d hold); `>= 2` reports -> `closed_permanent`; `venue_full` pivots to verified backup without quarantining primary as closed. | `closureQuarantinesImmediately`, `venueFullTriggersBackupPivot` | `spec/venueSelection.md` (`nextVenueStatusOnReport`), `spec/models/{venue_lifecycle,meetup_coordination}.md` |
| **FM-4** | **External API outage / quota exhaustion** | Google Places or Yelp returns 429/5xx, times out, or API key is unset. | Degrade gracefully to local `platform.venues` catalog; skip external discovery; require recently verified or curated active venues and never crash turn handling. | `noExternalSearchWhenSufficient`, `noClosedOrSuspectVenueRecommended` | Deterministic HTTP stub tests (200/429/500), `pnpm run sim` |
| **FM-5** | **Non-drinker or strict sober sent to bar** | Non-drinker or strict sober member matches in `slop` or joins `friends` group where top venue is `isBarOnly` or alcohol-centric. | Hard filter rejects venue before ranking; falls back to `alcoholOptional === true` cafe, food hall, or bookstore-cafe. | `nonDrinkerNeverBar`, `strictSoberNeverAlcoholCentric` | `spec/venueSelection.md` (`venueHardEligible`), `spec/models/venue_lifecycle.md` (`strictSoberBreweryRejectedTest`) |
| **FM-6** | **Dietary, accessibility, or budget violation** | Vegan/vegetarian/halal/kosher/allergen/wheelchair attendee or `$` budget attendee paired with incompatible or `$$$` venue. | Hard filter enforces dietary, accessibility, and `priceTier <= maxBudgetTier`; aborts or relaxes neighborhood before violating constraints. | `budgetCeilingRespected`, `allergenAndReligiousDietRespected` | `spec/venueSelection.md`, `spec/models/venue_lifecycle.md` (`halalRedLineRejectedTest`) |
| **FM-7** | **Repeat or rejected venue proposed** | Candidate venue exists in any attendee's `network.venue_visits` or `network.venue_rejections`. | Hard filter excludes venue for that match/group and advances to next unvisited, unrejected option. | `noVisitedOrRejectedRecommended` | `spec/venueSelection.md`, `spec/models/venue_lifecycle.md` (`visitedVenueRejectedTest`, `rejectedVenueExcludedTest`) |
| **FM-8** | **Private home injected as venue** | Malformed external payload, prompt injection, or member mention supplies a residential address (`is_public = false`). | Rejected at `spec/venueSelection.md`, rejected by Postgres `CHECK (is_public = true)` in `0098`, and blocked in `spec/models/venue_lifecycle.md`. | `noPrivateHomeRecommended` | `spec/venueSelection.md`, `spec/models/venue_lifecycle.md` (`privateHomeRejectedTest`), migration `0098` DB constraint test |
| **FM-9** | **Minor safety violation (venue, lane, stop, arrival relay, or work intro)** | Minor (`13..17`) paired with 18+/21+/bar venue, `> 6` group, `teenStopped`, `slop`/`peon` intro, or arrival relay. | `venueHardEligible` restricts minors to all-ages public venues (`ageMin <= 13`, `!isBarOnly`, `alcoholOptional`) and `<= 6` while `!teenStopped`; `canRelayArrival` and `chooseWorkIntroChannel` require adults `>= 18`. All 9 teen sim gates remain `0`. | `teenAllAgesPublicVenueOnly`, `teenSwitchOffNoMinor`, `noMinorInArrivalRelay`, `noMinorInWorkIntro` | `spec/{venueSelection,meetupArrival,workIntroChannel}.md`, `spec/models/{venue_lifecycle,meetup_coordination,work_intro}.md`, `pnpm run sim --only safety` |
| **FM-10** | **Unfair midpoint across city barrier** | Attendees separated by 405, Bay Bridge, Miami causeway, NYC river + transfers, or Chicago diagonal exceed `T_max + 10m`. | `isValidMidpoint` returns `false`; system declines to book an unfair meetup rather than forcing an excessive commute. | `isWithinTravelLimit`, `isValidMidpoint` | `spec/cityTravel.md`, multi-city tests, 5-city sim scenario |
| **FM-11** | **Severe weather hits outdoor venue** | Uncovered park/patio venue selected when temp `< 55°F` or `> 90°F`, rain `> 30%`, or slot is after sunset. | Weather disqualifier rejects outdoor-only venue and selects indoor/covered Tier S/A alternative (or pivots to indoor backup). | `venueHardEligible` (weather + indoor gate) | `spec/venueSelection.md`, Chicago winter & Miami rain test cases |
| **FM-12** | **Arrival relay leak, harassment, panic, or contact smuggling** | Attendee sends phone number, email, last name, harassment, or triggers panic exit during `ActiveArrival`. | `LeakGuard` + `RELAY_RULES` + Clef (`clef-flash`, fail-closed in prod) block unsafe cues; panic immediately closes window and halts all relays. | `noLeakOrPrivateContactInArrivalRelay`, `panicOrBlockImmediatelyHaltsRelay` | `spec/meetupArrival.md`, `spec/models/meetup_coordination.md` (`leakBlockedArrivalCueTest`, `panicHaltsRelayImmediatelyTest`), `pnpm run relay-eval` |
| **FM-13** | **Group arrival SMS storm** | 5 confirmed adult attendees send 12 arrival texts in 60 seconds. | Group relay batches updates into 60–90s concise digests; `relay` delivery does not burn the proactive outreach cap; per-sender rate limits still apply. | `onlyConfirmedUnblockedAdultsRelayed` | Arrival batching tests, `pnpm run sim --only friends` |
| **FM-14** | **Late arrival, silent no-show, or anchor drop** | Attendee B is silent at `T+12m`/`T+18m`, or group anchor drops before cutoff. | `noShowDecision` pings B at `T+12m` and notifies A at `T+18m`; anchor drop promotes adult co-anchor if `>= 3` remain, else cancels cleanly before travel. | `anchorDropReassignedOrCancelled`, `quorumOrCleanCancelBeforeCutoff` | `spec/meetupArrival.md`, `spec/models/meetup_coordination.md` (`noShowPingAndNotifyTest`, `anchorDropReassignThenCancelTest`) |
| **FM-15** | **Post-event message fans out to group** | Attendee texts at `T+60m` or after everyone confirmed `met`. | Phase is `Closed`; `canRelayArrival` returns `false`; message routes as normal private turn, never broadcast to the meetup group. | `noArrivalRelayOutsideWindow` | `spec/meetupArrival.md`, `spec/models/meetup_coordination.md` (`relayOutsideWindowRefusedTest`) |
| **FM-16** | **Follow-up during quiet hours, after STOP, or over daily cap** | Evening date ends at `21:30` local, member hit 3 proactive messages today, or member texted `STOP` / `leave`. | `computeFollowupLocalHour` defers evening to next morning `09:00–09:30`; `canSendFollowup` blocks on `optedOut`, quiet hours, `dailyProactiveCount >= dailyCap`, or `remindersSent >= maxReminders`. | `followupNeverDuringQuietHours`, `followupRespectsDailyCapAndOptOut` | `spec/encounterFollowup.md`, `spec/models/meetup_coordination.md` (`optOutStopsFollowupTest`, `dailyCapBlocksFollowupTest`), `pnpm run sim --only safety` |
| **FM-17** | **`peon` assigns venue, probes manager early, calendar-jacks, or group-texts** | Candidate declines/counters, email is missing, or caller tries to assign physical venue / unsolicited Meet link / group SMS. | Candidate decline stops flow before manager probe; `chooseWorkIntroChannel` requires adult double opt-in, locks video slot before Meet link, and structurally excludes `in_person_venue`, `group_sms`, and `cold_three_way_call`. | `workIntroNeverInPersonVenue`, `noUnsolicitedGroupSmsOrColdCall`, `workIntroDoubleOptInRequired`, `managerNeverProbedBeforeCandidateYes`, `videoIntroRequiresMutualSlotConfirmation` | `spec/workIntroChannel.md`, `spec/models/work_intro.md` (all run tests), `pnpm run sim --only peon-seats` |
| **FM-18** | **Stale Google geo cache or cross-app PII bleed** | Google-sourced `lat`/`lng` exceeds 30 days (`geo_expires_at < now`), or `slop` rating leaks across apps, or RLS context missing. | Scheduled purge clears expired Google coordinates; Postgres `FORCE ROW LEVEL SECURITY` isolates `network.*` rows by `app_id`; leak guard keeps `slop` appearance ratings private. | `noLeakOrPrivateContactInArrivalRelay` + `packages/core/src/policy.ts` / `spec/accountPrivacy.md` | `pnpm run security`, `0098` RLS test, `packages/platform/test/db.test.ts` |

---

## 9. Formal Verification Mapping

Per `AGENTS.md` and `SPEC.md`, pure business decisions live in top-level Vibestack specs (`spec/<name>.md`), are verified by Quint + Dafny 4.11 (`pnpm run check`), and are published to `packages/core/src/generated/<name>.ts` (`pnpm run spec:sync`). End-to-end stateful flows with concurrency, clock progression, and external events live in `spec/models/<name>.md` (`pnpm run quint:check`).

### 9.1 Whole-Flow Quint Models and Vibestack Spec Matrix

| Flow / Domain | Whole-Flow Model (`spec/models/<name>.md`) | Vibestack Spec (`spec/<name>.md`) -> Generated TS (`packages/core/src/generated/`) | Production Shell / Callers | Shared Invariant Names |
|---|---|---|---|---|
| **City Travel & Midpoint** | `spec/models/venue_lifecycle.md` (travel bound check) | [`spec/cityTravel.md`](../../spec/cityTravel.md) -> `cityTravel.ts` (`isWithinTravelLimit`, `fairMidpointCostScaled`, `fairMidpointNetCostScaled`, `isValidMidpoint`) | `packages/core/src/cities.ts`, `packages/network/src/geo.ts`, `packages/engine/src/packs/*` | `isWithinTravelLimit`, `isValidMidpoint` |
| **Venue Catalog, Sufficiency, Open Check & Quarantine** | [`spec/models/venue_lifecycle.md`](../../spec/models/venue_lifecycle.md) | [`spec/venueSelection.md`](../../spec/venueSelection.md) -> `venueSelection.ts` (`venueHardEligible`, `shouldFetchExternalVenues`, `needsPreRecommendOpenCheck`, `nextVenueStatusOnReport`, `groupVenueRubricScore`, `venueBudgetFitScore`) | `packages/core/src/venues.ts`, `packages/network/src/*`, `packages/platform/src/*` | `noPrivateHomeRecommended`, `noClosedOrSuspectVenueRecommended`, `noVisitedOrRejectedRecommended`, `nonDrinkerNeverBar`, `teenAllAgesPublicVenueOnly`, `teenSwitchOffNoMinor`, `budgetCeilingRespected`, `noExternalSearchWhenSufficient`, `closureQuarantinesImmediately`, `recommendedMustBeVerifiedOpen` |
| **On-Site Arrival Coordination** | [`spec/models/meetup_coordination.md`](../../spec/models/meetup_coordination.md) | [`spec/meetupArrival.md`](../../spec/meetupArrival.md) -> `meetupArrival.ts` (`meetupPhase`, `canRelayArrival`, `noShowDecision`, `shouldPivotToBackup`) | `packages/network/src/relay.ts`, `packages/network/src/network.ts`, `packages/network/service/*` | `noMinorInArrivalRelay`, `onlyConfirmedUnblockedAdultsRelayed`, `panicOrBlockImmediatelyHaltsRelay`, `noArrivalRelayOutsideWindow`, `noLeakOrPrivateContactInArrivalRelay`, `closureAlwaysPivotsWhenBackupExists`, `venueFullTriggersBackupPivot` |
| **Post-Encounter Follow-Up** | [`spec/models/meetup_coordination.md`](../../spec/models/meetup_coordination.md) | [`spec/encounterFollowup.md`](../../spec/encounterFollowup.md) -> `encounterFollowup.ts` (`computeFollowupLocalHour`, `followupIsNextDay`, `canSendFollowup`) | `packages/network/src/outreach.ts`, `packages/network/src/network.ts` | `followupNeverDuringQuietHours`, `followupRespectsDailyCapAndOptOut` |
| **Work Introductions (`peon`)** | [`spec/models/work_intro.md`](../../spec/models/work_intro.md) | [`spec/workIntroChannel.md`](../../spec/workIntroChannel.md) -> `workIntroChannel.ts` (`chooseWorkIntroChannel`) | `packages/network/src/jobs.ts`, `packages/network/src/network.ts`, `packages/network/service/packs.ts` | `workIntroNeverInPersonVenue`, `noUnsolicitedGroupSmsOrColdCall`, `workIntroDoubleOptInRequired`, `managerNeverProbedBeforeCandidateYes`, `videoIntroRequiresMutualSlotConfirmation`, `noMinorInWorkIntro` |

### 9.2 Boundaries Outside the Formal Model (and Their Tests)

The formal models prove pure state transitions and decision logic. Runtime seams outside Quint and Dafny are validated by Postgres integration tests, e2e tests, security tests, and `pnpm run sim`:

| Unmodeled Seam | Why Outside Model | Validation Coverage |
|---|---|---|
| **Postgres transactions, CHECK constraints, and RLS (`0098`)** | SQL execution and concurrency are outside Dafny. | Idempotent migration test against Postgres 16 (`:54339`), `packages/platform/test/db.test.ts`, `pnpm run security`. |
| **Google Places & Yelp HTTP adapters** | Async network I/O (`await`), JSON parsing, retries, and rate-limit errors. | Integration tests with deterministic HTTP stubs (200/429/500, `CLOSED_TEMPORARILY`, `geo_expires_at`). |
| **Natural-language extraction, `LeakGuard`, `RELAY_RULES`, and Clef** | Regex tables and LLM/Workers AI calls are nondeterministic oracles in Quint. | `evals/` corpora, `pnpm run relay-eval`, `packages/network/test/shared-agent.integration.test.ts`, real-LLM eval runs. |
| **Floating-point Haversine `km()`, `log(1 + supply)`, and `Intl` time zones** | Vibestack pure Quint proves integer-scaled minimax and local-hour rules; shells hold `Clock` and `Intl`. | Deterministic multi-city travel/midpoint tests and `CITY_TZ` timezone conversion tests across DST boundaries. |
| **Wall-clock schedulers and 60–90s group batch timers** | Timers are external triggers mapped to atomic Quint actions; production reads time only from `Clock`. | Clock-injected integration tests and `pnpm run sim` world runs. |

### 9.3 Verification Rules and Commands

Every PR implementing this design must keep generated code free of manual edits (`pnpm run spec:sync`) and pass the full validation suite:
1. `pnpm run spec:sync && pnpm run spec:check-generated`
2. `pnpm run check` (Quint simulation + Dafny 4.11 proofs for `cityTravel`, `venueSelection`, `encounterFollowup`, `meetupArrival`, `workIntroChannel`; do not run `pnpm run accept` without product-owner review)
3. `pnpm run quint:check venue_lifecycle && pnpm run quint:check meetup_coordination && pnpm run quint:check work_intro`
4. `pnpm run typecheck && pnpm run security && pnpm run test:integration && pnpm run test:e2e && pnpm run sim`

---

## 10. Alternatives Considered

1. **Yelp-only live search on every match (no local catalog)**:
   - *Why rejected*: Yelp's free production tier is retired ($229–$643/mo fixed floor), its 24-hour cache cap prevents building a first-party taste graph, and its park/plaza coverage is weak for daytime, budget-friendly, and all-ages meetups.
2. **Continuous lat/lon geometric centroid + direct phone swap for arrival and work intros**:
   - *Why rejected*: Raw centroids ignore rivers, the 405, Bay Bridge, and Miami causeways, producing unfair commutes. Direct phone swaps before arrival or in `peon` violate member privacy, break the leak-checked relay boundary, expose minors to unsafe contact, and create unwanted group SMS blasts.
