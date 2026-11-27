# Pass 2 Unification, Safety, and Performance Benchmarks

**Date:** 2026-11-27
**Branch:** `feat/pass2-unify-and-optimize` (baseline: `develop` @ `0239b70c3`)
**Runtime:** Node `v26.13.0`, `corepack pnpm@10.24.0`, macOS (Apple Silicon)
**Model / LLM calls:** None (all microbenchmarks and simulation checks run offline and deterministically with provider keys cleared; zero network or model calls).

## Summary of Measured Before / After Results

| Metric | Baseline (`0239b70c3`) | Pass 2 Measured | Delta / Speedup | Target (`revised-plan.md` §5) |
|---|---|---|---|---|
| Workspace `typecheck` errors (6 targets) | `8` errors | **`0` errors** | `-8` errors (100% clean) | `0` errors |
| `VenueManager.exportState()` JSON size (fresh 5-city runtime) | `97,864 B` (`98,579 B` full 75-venue snapshot with `ageMin: 0`) | **`82 B`** (`0` mutated venues) | **-99.92%** | `< 1,024 B` (`> 98%` cut) |
| `chooseFairMidpoint()` (2,000 calls across 5 cities, 5-trial median) | `~593.6 ms` (audit) / `265.56 ms` (same-host unindexed ref) | **`1.07 ms`** median (`[1.53, 3.62, 1.05, 1.07, 0.88] ms`) | **249x** vs same-host ref (**555x** vs audit) | `<= 25 ms` (`>= 24x`) |
| `isVenueOpenAt()` hoisted (15 SF venues x 2,000 calls, 5-trial median) | `~206.6 ms` (audit) / `92.49 ms` (same-host unhoisted) | **`5.18 ms`** hoisted `isVenueOpenAt` / **`33.55 ms`** full `rankVenuesForMatch` | **17.8x** open check (**6.2x** full rank vs audit) | `<= 35 ms` (`>= 6x`) |
| `understandPrompt()` static `system` prefix & city-scoped areas | `0%` static prefix, `80` areas | **`96.5%–96.6%`** static `system` prefix, **`9–10`** city-scoped areas | Byte-identical `system` prefix per city; **87.5%–88.8%** fewer areas | `>= 80%` static prefix, `~10` city-scoped areas |
| `relay-endpoint` LRU cache hit rate on repeated arrival phrases | `0%` (`10/10` upstream calls) | **`100.0%`** repeat hit rate (`3/10` upstream calls; expires cleanly past 1 h TTL -> `4` calls) | **+100.0 pp** repeat hit rate | `100%` repeat hit within 1 h TTL |
| `LLMBudget` Day D exhaustion -> Day D+1 recovery before `rt.tick()` | `0` calls allowed after UTC midnight (silent outage) | Day D `exhausted=true` (`2,000,000` micro, `1` req) -> Day D+1 **`exhausted=false`** (`0` micro, `0` req) | Full Day D+1 recovery | Full Day D+1 budget restored before `rt.tick()` |
| `pnpm run sim --only five-city` (seed `42`, `perCity=30`) | Failing (`ageMin` crash + vacuous S15) | **`29/29` blocking gates PASS** (`16/16` scenarios, `1` tracked fingerprint `2b229cc921f166a6`, `4.7 s`) | `0` leaks, `0` minor contacts, all `8` teen gates `0` | `100%` PASS |
| Parallel sim runner (`--jobs 4` vs `--jobs 1` on `evals,onboard,clef,peon-seats,five-city`) | `9.7 s` serial (`125/125` blocking, `134` total gates) | **`5.1 s`** parallel (`125/125` blocking, `134` total gates, **exact JSON parity**) | **1.90x** on 5 short blocks (bounded by `five-city` critical path) | Identical gate counts and exit code; full 16-block `sim --jobs 4` timed by `w3-final-verifier` |

## Detailed Per-Benchmark Measurements and Reproducible Commands

### 1. Workspace Typecheck

Command:
```bash
corepack pnpm@10.24.0 run typecheck
```
Result: `0` errors across all 6 targets (`tsconfig.json`, `sites/tsconfig.json`, `apps/observatory/tsconfig.json`, `apps/observatory/deploy`, `@thenetwork/site` & `@thenetwork/ui`, `apps/marketing/tsconfig.json`).

### 2. `VenueManager.exportState()` Delta Serialization Size

Sample size: 1 fresh `VenueManager` seeded with all `75` curated 5-city `ALL_SEED_VENUES` records.

Command:
```bash
node --import tsx --conditions eliza-source -e '
import { ALL_SEED_VENUES } from "./packages/core/src/index.ts";
import { VenueManager } from "./packages/network/src/venue-manager.ts";
const vm = new VenueManager();
const fresh = JSON.stringify(vm.exportState()).length;
const full = JSON.stringify({ venues: ALL_SEED_VENUES, visited: [], rejected: [], externalFetchCount: 0, openCheckCount: 0 }).length;
console.log({ fullBytes: full, freshBytes: fresh, reductionPct: +((100 * (full - fresh)) / full).toFixed(2) });
'
```
Measured output:
- Legacy full snapshot (`75` seed venues): `98,579 B` (`97,864 B` prior to explicit `ageMin: 0` on seed venues).
- Pass 2 delta snapshot (fresh): `82 B` (`venues: []`), **99.92% reduction**.

### 3. `chooseFairMidpoint()` Pre-Indexed Neighborhood and Barrier Maps

Sample size: `2,000` calls per trial (`10` deterministic date/group cases across all `5` launch cities x `200` repetitions), `200`-call warmup, `5` timed trials, strict JSON output parity asserted against the pre-Pass 2 unindexed reference implementation (`refChooseFairMidpoint`).

Measured trials (ms for 2,000 calls):
- Unindexed reference: `[238.51, 278.07, 239.22, 273.79, 265.56]` -> median **`265.56 ms`**
- Pass 2 indexed `chooseFairMidpoint`: `[1.53, 3.62, 1.05, 1.07, 0.88]` -> median **`1.07 ms`**
- Parity: `10/10` cases byte-identical JSON output.
- Speedup: **249x** on identical host/inputs (**555x** relative to `0239b70c3` audit baseline `593.6 ms`).

### 4. `isVenueOpenAt()` Hoisted Inside `rankVenuesForMatch()`

Sample size: `15` SF seed venues x `2,000` calls (`30,000` open-hour evaluations per trial), `startMs = fromLocal(2026, 11, 26, 18, "America/Los_Angeles")`, `bufferMin = 60`, `200`-call warmup, `5` timed trials, output parity asserted on all `15` venues (`open` and `remainingMinutes`).

Measured medians (ms for 15 venues x 2,000 calls):
- Unhoisted `isVenueOpenAt(v, tz, startMs, 60)` (recomputes `localParts` per venue): **`92.49 ms`**
- Hoisted `isVenueOpenAt(v, tz, startMs, 60, startParts)` (single `localParts` per match): **`5.18 ms`** (**17.8x speedup**)
- Full `rankVenuesForMatch()` (15 venues x 2,000 calls, including hoisted `isVenueOpenAt`, travel scoring, hard eligibility, and ranking): **`33.55 ms`** (audit baseline `~206.6 ms`, **6.2x faster**).

### 5. `understandPrompt()` Static System Prefix and City-Scoped Neighborhoods

Sample size: All `5` launch cities (`sf`, `nyc`, `la`, `chicago`, `miami`), comparing two distinct member turns per city (`"maybe later this week"` awaiting `"probe"` vs `"looking for a climbing partner"`).

| City | System Prefix Identical Across Turns | `system` Chars | `user` Chars | Static Prefix Ratio | Neighborhood Count |
|---|---|---|---|---|---|
| `sf` | `true` | `3,950` | `140` | `96.6%` | `10` |
| `nyc` | `true` | `3,957` | `140` | `96.6%` | `10` |
| `la` | `true` | `3,913` | `140` | `96.5%` | `10` |
| `chicago` | `true` | `3,885` | `140` | `96.5%` | `9` |
| `miami` | `true` | `3,901` | `140` | `96.5%` | `9` |

Command:
```bash
node --import tsx --conditions eliza-source -e '
import { CITY_IDS } from "./packages/core/src/index.ts";
import { understandPrompt } from "./packages/network/src/extract.ts";
for (const city of CITY_IDS) {
  const p = understandPrompt("maybe later this week", { city, awaiting: "probe" });
  const hood = p[0]!.content.split("\n").find(l => l.startsWith("Neighborhoods: "))!;
  const areas = hood.slice("Neighborhoods: ".length).replace(/\.$/, "").split("; ");
  console.log({ city, ratioPct: +((100 * p[0]!.content.length) / (p[0]!.content.length + p[1]!.content.length)).toFixed(1), areas: areas.length });
}
'
```

### 6. `relay-endpoint` Bounded LRU Cache Hit Rate

Sample size: `10` arrival-phrase checks (`"omw"`, `"here!"`, `"5 min out"` — `3` unique phrases, `7` repeats) through `relayClassifierFromEnv` with a counting mock `fetch` and simulated clock, followed by advancing `60 * 60 * 1000 + 1 ms` past the 1-hour TTL.

Measured output:
- Calls within 1 h TTL: `3` upstream calls for `10` requests (`7/7` repeats served from cache = **`100.0%`** repeat hit rate, up from `0%`).
- Call after 1 h TTL expiry (`+3,600,001 ms`): `4` total upstream calls (cache entry evicted cleanly on expiry).

### 7. `LLMBudget` Day D Exhaustion -> Day D+1 Recovery Before `rt.tick()`

Sample size: Simulated UTC rollover on `SimClock` from `2026-11-27T23:55:00Z` to `2026-11-28T00:05:00Z` (`+10 min`) backed by `llmUsageForDay` and `dayOf`.

Measured output:
- Day D (`2026-11-27`): `spentMicro = 2,000,000`, `requests = 1`, `exhausted = true`.
- Day D+1 (`2026-11-28`, refreshed before `rt.tick()`): `spentMicro = 0`, `requests = 0`, `exhausted = false`.

### 8. Five-City Suite & Parallel Runner (`--jobs 4` vs Serial)

Commands:
```bash
corepack pnpm@10.24.0 run sim --only five-city
corepack pnpm@10.24.0 run sim --only evals --only onboard --only clef --only peon-seats --only five-city --json /tmp/sim-serial.json
corepack pnpm@10.24.0 run sim --jobs 4 --only evals --only onboard --only clef --only peon-seats --only five-city --json /tmp/sim-par4.json
```

Measured output:
- `five-city` standalone (`seed=42`, `perCity=30`): **`29/29` blocking gates PASS**, `1` tracked (`fingerprint: 2b229cc921f166a6`), `4.7 s`. Verified S1–S16 (`16/16`), non-vacuous minor solo venue checks (`15/15` non-empty, `15/15` multi-person fail-closed, `0` bar/21+/brewery venues), named brewery exclusion (`sf-biergarten-hayes`, `sf-cellarmaker-mission`, `nyc-threes-brewing`), `heavy_drinker` non-drinker exclusion, `venue_full` backup pivot without quarantine, panic relay halt, and 5-city `teenStop=false` vs `teenStop=true` byte-for-byte pre-feature parity (`5/5` cities).
- 5-block serial (`--jobs 1`): **`125/125` blocking gates PASS**, `1` tracked off target, `134` total gates, **`9.7 s`** (`evals 1.8s, onboard 1.3s, clef 1.3s, peon-seats 1.7s, five-city 3.6s`).
- 5-block parallel (`--jobs 4`): **`125/125` blocking gates PASS**, `1` tracked off target, `134` total gates, **`5.1 s`** (`evals 2.1s, onboard 2.5s, clef 1.6s, peon-seats 2.3s, five-city 5.1s`) — **1.90x speedup**, **100% exact gate-by-gate JSON parity** (`exactParity: true`).
- Note: Full 16-block `REQUIRE_PG=1 corepack pnpm@10.24.0 run sim --jobs 4` (which adds 4-way `--matching-pack` sharding across `ntwrk`, `slop`, `peon`, `friends` alongside all remaining blocks while keeping `scripts/sim/scale.ts` checks at 100% strength) is executed and timed by `w3-final-verifier`.

## Hand-Written vs. Vibestack Generated Code

- **Vibestack generated code (unmodified in Pass 2; zero edits to `spec/*.md` or `spec/lock.json`):**
  - `packages/core/src/generated/venueSelection.ts` (`fairMidpointCostScaled`, `fairMidpointNetCostScaled`, `isValidMidpoint`, `isWithinTravelLimit`, `venueHardEligible`, `venueRedLinesEligible`, `canPivotSuggestion`, `nextSuggestionAction`)
  - `packages/core/src/generated/meetupCoordination.ts` (`meetupPhase`, `evaluateArrivalRelaySafe`, `evaluateBackupPivotV2`, `evaluateVenueQuarantine`)
  - `packages/core/src/generated/friendIntroAge.ts` (`groupAgeAllowed`, `teenPlaceAllowed`, `teenRosterSizeAllowed`)
  - `packages/core/src/generated/memberAge.ts`, `matchLane.ts`, `probeReply.ts`, `candidateSearch.ts`, `pairValue.ts`, `mutualOpenness.ts`, `cofounderIntent.ts`, `workIntroChannel.ts`
- **Hand-written code (Pass 2 runtime shells, indexing, caching, tests, and simulation runner):**
  - `packages/core/src/{cities,venues,time}.ts`, `packages/db/migrations/0100_venues_and_arrivals_hardening.sql`
  - `packages/network/src/{geo,venue-manager,meetup-coord,network,store,extract,copy}.ts`, `packages/network/service/{service,serve,relay-endpoint,review-judge}.ts`
  - `packages/engine/src/{spatialIndex,humanVector}.ts`, `packages/engine/src/packs/slop/{extract,clef}.ts`, `packages/engine/src/packs/network/judgeContext.ts`
  - `packages/platform/src/{venue-store,venue-provider,apps}.ts`, `apps/marketing/src/{cities,bandit,cli}.ts`, `apps/observatory/**`
  - `scripts/sim.ts`, `scripts/sim/matching.ts`, `packages/sim/src/judge/llmJudges.ts`, `packages/sim/src/fiveCitySuite.ts`
