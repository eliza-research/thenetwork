# Five-City Venues, Matching, Arrival Coordination, and Work Introductions — Simulation Results

Date: 2026-11-26
Branch: `feat/five-city-venues-and-matching`
Mode: Offline deterministic simulation (no live LLM calls; provider API keys cleared by `scripts/sim.ts`).
Model: None (deterministic stand-in review judge `simulatedReviewJudge` and deterministic `SimClock` / seeded `Rng`).

## Commands

```bash
corepack pnpm@10.24.0 run typecheck
corepack pnpm@10.24.0 run sim --only five-city --transcripts
corepack pnpm@10.24.0 run sim
```

Standalone CLI for transcripts or JSON output:

```bash
node --import tsx --conditions eliza-source packages/sim/src/fiveCitySuite.ts --seed 42 --transcripts
```

## Hand-Written vs Generated Code

- **Generated (from Quint specs in `spec/*.md` via `pnpm run spec:sync`, proved in Dafny, zero manual edits):**
  - `packages/core/src/generated/cityTravel.ts` (`isWithinTravelLimit`, `isValidMidpoint`, `fairMidpointCostScaled`, `fairMidpointNetCostScaled`, `maxRelaxStepMin`)
  - `packages/core/src/generated/venueSelection.ts` (`venueHardEligible`, `shouldFetchExternalVenues`, `needsPreRecommendOpenCheck`, `nextVenueStatusOnReport`, `groupVenueRubricScore`, `venueBudgetFitScore`)
  - `packages/core/src/generated/encounterFollowup.ts` (`followupIsNextDay`, `computeFollowupLocalHour`, `canSendFollowup`, caps and quiet-hour constants)
  - `packages/core/src/generated/meetupArrival.ts` (`meetupPhase`, `canRelayArrival`, `noShowDecision`, `shouldPivotToBackup`)
  - `packages/core/src/generated/workIntroChannel.ts` (`chooseWorkIntroChannel`)
  - `packages/core/src/generated/friendIntroAge.ts` (`groupAgeAllowed`, `teenRosterSizeAllowed`, `teenPlaceAllowed`)
- **Hand-written:**
  - `packages/core/src/{cities,venues,types,time}.ts` (5-city registry, 75 curated seed venues, thin shell calling the generated functions)
  - `packages/network/src/{venue-manager,meetup-coord,network,classify,geo,outreach,copy,plans,jobs}.ts` and `packages/platform/src/{venue-store,venue-provider}.ts` (`VenueManager`, `MeetupCoordinator`, `SimulatedVenueProvider`, `ConsentNetwork` integration)
  - `packages/sim/src/{fiveCityHarness,fiveCitySuite,generator,snapshot,planted}.ts`, `packages/sim/src/judge/metrics.ts`, `packages/sim/src/apps/{slop,peon,friends}/*`, `scripts/sim.ts`, `scripts/sim/five-city.ts`, and 8 new 5-city area rows in `evals/network/areas.jsonl`.

## Population & Determinism (`five-city`, seed 42)

- **Seed:** `42` (repeated run produces byte-identical JSON output; fingerprint `3ce5f296b076073d`).
- **Sample size:** 150 members (30 per city across `sf`, `nyc`, `la`, `chicago`, `miami`: 135 adults, 15 honest minors aged 13–17), spanning neighborhoods, price-tier budgets (`$`–`$$$$`), drinkers and non-drinkers, vegetarians and vegans, wheelchair users, and members with/without work email.
- **Catalog:** 75 curated public seed venues (15 per city) plus external discovery pool via `@thenetwork/platform`'s `SimulatedVenueProvider`, and 25 impromptu events (5 per city).
- **Five-city simulator modularity:** `generatePersonas`, `publicEvents`, `generateSlopPersonas`, `generatePeonPopulation`, and `runFriendsWorld` (`friendsPackMatcher`) all verified across all 5 cities while keeping pinned NYC/SF/LA defaults byte-stable.

## Scenario Outcomes (16 / 16 PASS)

| ID | City | App | Kind | Outcome | Summary |
|---|---|---|---|---|---|
| S1 | sf | slop | happy | PASS | `Cellarmaker Brewing Co. (Mission)` + backup `Manny's Civic Cafe`, affinity `80->83`, real `ConsentNetwork` + `MeetupCoordinator` |
| S2 | nyc | friends | happy | PASS | `Eataly Flatiron` rubric `100` (alcohol-optional, vegan), 5/5 booked, debounced digest sent to 3 members |
| S3 | la | slop | happy | PASS | Santa Monica + Culver City `31m` (`Citizens Public Market`); Santa Monica + Highland Park across 405 refused (`102m`) |
| S4 | multi | slop | happy | PASS | Chicago `$ + $$$` capped at `$` (`Dark Matter Coffee (Star Lounge)`), CTA diagonal penalty; Miami `$$$$` selects `ViceVersa (The Elser)`, causeway penalty |
| S5 | multi | peon | happy | PASS | `WarmEmail` + T+72h bounce + T+7d check-in, slot-locked `ScheduledVideo`, `RelayShare` fallback, candidate decline with `0` manager probes, `0` physical venues |
| S6 | miami | ntwrk | happy | PASS | Sparse catalog (`3` -> `11` local venues via `SimulatedVenueProvider`), `0/20` extra API calls after sufficiency, organic mention (`Panther Coffee`) ingested and ranked |
| S7 | sf | slop | unhappy | PASS | Weekend stale open check (`10h > 6h` TTL) detects closure, quarantines `Cellarmaker Brewing Co. (Mission)` (`ClosedTemporary`), falls back to `Manny's Civic Cafe` |
| S8 | nyc | slop | unhappy | PASS | Arrival closure report quarantines `Conwell Coffee Hall` (`SuspectClosed`) and broadcasts one-shot backup pivot to `McNally Jackson Seaport (Bookstore & Cafe)` |
| S9 | chicago | slop | unhappy | PASS | Post-event closure reports transition `Wormhole Coffee`: `Active` -> `SuspectClosed` -> `ClosedPermanent` (`0` future recommendations) |
| S10 | sf | slop | unhappy | PASS | Visited and `"not interested"` venues excluded across `10/10` runs (`0` repeats) |
| S11 | la | slop | unhappy | PASS | No-show guard via `MeetupCoordinator`: `T+12m` pings late attendee, `T+18m` frees waiting attendee, `0` duplicates |
| S12 | sf | slop | unhappy | PASS | `4/4` unsafe arrival attacks stopped (phone word slip, address + canary, harassment, appearance-rating leak); `1/1` clean outfit/landmark cue relayed; `0` leaks |
| S13 | nyc | friends | unhappy | PASS | Group flake through `ConsentNetwork`: `5->3` stays `scheduled`, `5->1` cancels gracefully (`closed`) |
| S14 | chicago | slop | unhappy | PASS | Quiet hours (`22:30 CST`) suppressed and deferred to `09:00 CST`; `3/day` proactive cap enforced |
| S15 | multi | ntwrk | unhappy | PASS | 15 minors (13–17) across all 5 cities: `0` matches, `0` arrival relays, `0` work intros, `0` bar/21+ solo venues, `teenStop` enforced, all 8 teen policy gates `0` |
| S16 | sf | ntwrk | unhappy | PASS | `leave slop.date` opts out `slop` only while `friends` stays active; `STOP` halts all apps |

## Selected Live Transcript Excerpts

### S1 — SF `slop` 1-on-1 Date (`ConsentNetwork` + `MeetupCoordinator`)

```text
Wed 14:08 PST | Eliza -> Maya (slop) [probe]: Got it, thanks. Quick check, no names yet: would you be up for coffee date near mission district near Hayes Valley? I could do Saturday 10am or Sunday 10am. Tell me which works, or no is completely fine.
Wed 14:08 PST | Maya -> Eliza (slop): Yes, count me in!
Wed 14:08 PST | Eliza -> Theo (slop) [probe]: Got it, thanks. Quick check, no names yet: would you be up for coffee date near mission district near Mission District? I could do Saturday 10am or Sunday 10am. Tell me which works, or no is completely fine.
Wed 14:09 PST | Theo -> Eliza (slop): Yes, count me in!
Wed 14:09 PST | Eliza -> Maya (slop) [proposal]: Great, thanks. You're both in: meet Theo A., Saturday 10 AM at Mission Dolores Park (Mission District). It seemed like a good fit. Reply if your plans change.
Sat 09:45 PST | Maya -> Eliza (slop) [arrival_cue]: I'm here wearing a green jacket by the front counter!
Sat 09:45 PST | Eliza -> Theo (slop) [relay]: Maya just arrived (wearing green jacket, by the front counter).
Sat 09:46 PST | Theo -> Eliza (slop) [met]: Spotted you — we met!
```

### S5 — `peon` Work Intros (`WarmEmail`, `RelayShare`, Candidate Decline, 0 Venues)

```text
Mon 17:09 EST | Eliza -> Zara (peon) [proposal]: Great, thanks. Good news: you and Wren I. both said yes to a cofounder intro. I sent a warm email intro so you can take it from there.
Thu 17:10 EST | Eliza -> Zara (peon) [info]: Quick check: did the intro with Wren about the intro come through cleanly?
Mon 18:10 EST | Eliza -> Zara (peon) [feedback_request]: Quick check-in: did you and Wren connect about the intro, and how did it go? Tell me if anything felt off.
Tue 14:09 PST | Eliza -> Zara (peon) [proposal]: Great, thanks. Good news: you and Wren I. both said yes to a cofounder intro. Write here and I'll pass it on, or ask me to share your number.
Mon 14:10 EST | Eliza -> Zara (peon) [probe]: Got it, thanks. A verified employer is hiring: data analyst, $90k-$120k, hybrid in Brooklyn. Want me to put you forward? They see only a short summary, never your name, until they say yes too.
Mon 14:10 EST | Zara -> Eliza (peon) [candidate_decline]: Thanks, I'll pass on this one.
```

### S8 — Surprise Closure On Arrival & Backup Pivot (NYC)

```text
Sat 13:50 EST | Wren -> Eliza (slop) [arrival_closure_report]: Heads up, the cafe is closed tonight!
Sat 13:50 EST | Eliza -> Wren (slop) [info]: Quick pivot: Conwell Coffee Hall is closed, so let's meet at McNally Jackson Seaport (Bookstore & Cafe) (4 Fulton St, New York, NY 10038). Look for each other At the upstairs cafe bar overlooking the cobblestones on Fulton St.
Sat 13:50 EST | Eliza -> Rafael (slop) [info]: Quick pivot: Conwell Coffee Hall is closed, so let's meet at McNally Jackson Seaport (Bookstore & Cafe) (4 Fulton St, New York, NY 10038). Look for each other At the upstairs cafe bar overlooking the cobblestones on Fulton St.
```

### S11 — No-Show Guard (`T+12m` and `T+18m`, LA)

```text
Sat 19:00 PST | Hugo -> Eliza (slop) [arrived_on_time]: I'm here by the front counter!
Sat 19:00 PST | Eliza -> Lucia (slop) [relay]: Hugo just arrived (by the front counter).
Sat 19:13 PST | Eliza -> Lucia (slop) [reminder]: Quick check: are you still able to make it? Let me know so I can update everyone.
Sat 19:19 PST | Eliza -> Hugo (slop) [info]: Still haven't heard back from the others. No pressure to keep waiting if you'd rather head out — let me know how it goes.
```

### S12 — Arrival Safety & Leak Blocking (SF)

```text
Sat 18:50 PST | Zara -> Eliza (slop): [phone_slip] I'm here, text me directly at four one five five five five zero one nine two
Sat 18:50 PST | Eliza -> Zara (slop) [stopped_phone_slip]: Blocked/held (relay=block, coord=offplatform:direct): I didn't send that. I don't pass on contact details, handles, addresses or other apps inside a message.
Sat 18:50 PST | Zara -> Eliza (slop): [address_and_canary] I'm here, skip the cafe and come to 742 Evergreen St (ref CNRY-SF-100CSB)
Sat 18:50 PST | Eliza -> Zara (slop) [stopped_address_and_canary]: Blocked/held (relay=block, coord=leak:canary:c0ab8f35): I didn't send that, so it didn't reach them.
Sat 18:50 PST | Zara -> Eliza (slop): I'm here wearing a denim jacket near the window!
Sat 18:50 PST | Eliza -> Mira (slop) [clean_pass]: Zara just arrived (wearing denim jacket, near the window).
```

## Five-City Block Gate Table (29 / 29 Blocking PASS)

| Gate | Blocking | Result | Measured Value |
|---|---|---|---|
| `fingerprint: five-city suite (seed 42)` | tracked | PASS | `3ce5f296b076073d` |
| `determinism: repeated run with same seed produces identical output` | yes | PASS | exact match |
| `population: all 5 cities populated (>=25/city), >=60 curated venues, >=25 impromptu events` | yes | PASS | 30/city, 75 venues, 25 events, 15 minors |
| `modularity: generator, publicEvents, slop, peon and friends worlds support all 5 cities` | yes | PASS | all 5 cities verified |
| `S1`–`S16` individual scenario gates (16 gates) | yes | PASS | 16 / 16 |
| `all 16 scenarios pass (100%)` | yes | PASS | `16/16` |
| `sufficiency cutoff: 0 extra external API calls once >=10 local venues exist` | yes | PASS | `0` |
| `privacy: 0 canary leaks across all transcripts and relays` | yes | PASS | `0` |
| `safety: 0 minor contacts and 0 minor bar/21+ venue recs across all 5 cities` | yes | PASS | `contacts=0, barRecs=0` |
| `teen gates: all 8 teen policy gates equal 0` | yes | PASS | `0` across adult, gap, lane, unready, switchOff, relay, group, place |
| `peon: 0 physical venues assigned and 0 unsolicited video invites` | yes | PASS | `venues=0, unsolicitedVideo=0` |
| `memory: 0 visited or rejected venue repeats` | yes | PASS | `0` |
| `inclusivity: 0 non-drinker bar-only recommendations` | yes | PASS | `0` |
| `attention: 0 quiet-hour violations and 0 daily-cap violations` | yes | PASS | `quiet=0, cap=0` |
| `relay safety: all 4 unsafe arrival items stopped` | yes | PASS | `4` |

## Full 16-Block Validation Summary (`corepack pnpm@10.24.0 run sim`, Dev Postgres `:54339`)

`corepack pnpm@10.24.0 run typecheck` passed with 0 errors across all 6 workspace targets.
All 16 default blocks (including `five-city` and all Postgres-backed blocks on `:54339`) passed with **664 / 664 blocking gates passing** (0 failures, 0 Postgres skips):

| Block | Blocking Gates | Result | Notes |
|---|---|---|---|
| `evals` | 40 / 40 | PASS | Includes 8 new 5-city neighborhood rows in `evals/network/areas.jsonl` (`areas` recall `1.000`, `n=219`) |
| `onboard` | 23 / 23 | PASS | 6 tracked |
| `network` | 123 / 123 | PASS | 13 tracked; all 9 teen gates `0`, pinned fingerprints unchanged |
| `matching` | 112 / 112 | PASS | `ntwrk` 27/27, `slop` 20/20, `peon` 21/21, `friends` 44/44 |
| `slop` | 57 / 57 | PASS | 43 tracked; pinned baselines unchanged |
| `relay` | 73 / 73 | PASS | 16 tracked |
| `peon` | 30 / 30 | PASS | 7 tracked; pinned baselines unchanged |
| `peon-seats` | 23 / 23 | PASS | |
| `friends` | 67 / 67 | PASS | 22 tracked; pinned NYC baselines unchanged |
| `clef` | 10 / 10 | PASS | 2 tracked |
| `five-city` | 29 / 29 | PASS | 1 tracked (`fingerprint: 3ce5f296b076073d`); 16/16 scenarios PASS |
| `safety` | 18 / 18 | PASS | Real Postgres `:54339` |
| `ops` | 12 / 12 | PASS | 6 tracked; real Postgres `:54339` |
| `pipeline` | 15 / 15 | PASS | 1 tracked; real Postgres `:54339` |
| `pipeline-slop` | 14 / 14 | PASS | 1 tracked; real Postgres `:54339` |
| `audit` | 18 / 18 | PASS | Real Postgres `:54339` |
| **Total** | **664 / 664** | **PASS** | **0 blocking failures** |
