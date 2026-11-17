# R10. Code-level profile of the match core and the request path

Angle: where the time goes, why the bounds are loose, what the request path does, and every other super-linear step. Worktree `/Users/nubs/thenetwork-matching` at `3f0f8586`. Read-only on the repository.

What is measured and what is not:

- Everything marked **measured** comes from throwaway scripts in `scratchpad/research2/bench/` (`profile-search.mts`, `micro.mts`, `edges.mts`, raw JSON next to them). They run the real match core on the planted world (`plantedEngineInput`, seed `matching-1`, the shipped app wiring). `profile-search.mts instrument` is a line-for-line copy of `searchCandidates` with counters added. At N 2,000 it gives the same checks and touches per profile as the real function: friends 12.1 checks and 574.6 touches, in both runs.
- The machine was very overloaded while I ran these (load average 137 to 284 on 18 cores; my processes got 5% to 8% of one core). So:
  - Phase times are **CPU time** (`process.cpuUsage`).
  - The in-search splits are wall-clock **shares**.
  - Per-call costs come from `micro.mts`, which measures CPU over 40,000 calls.
  - I kept N at 5,000 or below. At N 5,000 the instrumented runs sample every fifth profile. The 100,000 figures are extrapolations, and so is the cost model. The 100,000 search times in the migration report were also taken under load.
- Literature items I opened are cited with URL. Items I recall but did not open are marked [unverified].

---

## 0. Summary of findings (numbers first)

| | friends Friend | slop Date |
|---|---|---|
| Profiles at N 5,000 | 4,902 | 4,902 |
| Window (partners in reachable segments, standing band) per search | 677 (13.8% of block) | 279 (5.7% of block) |
| Posting and window entries touched per search | 1,327 (2.0× the window) | 1,012 (3.6× the window) |
| Distinct candidates bounded (full pair arithmetic) per search | 525 | 274 |
| Pair checks per search | 12.1 | 93.1 |
| Checks that return no pair value | 0% | **79.7%** |
|  of which: gate `segment_unreachable` | 0 | **39.6% of all checks** |
|  of which: gate `age_range` | 0 | **12.0%** |
|  of which: arithmetic refusal (true pack value below the floor, or parity) | 0 | **28.1%** |
| Mean bound minus value on a checked, valued pair | 0 (bound = value) | 98 points |
| Mean k-th kept value / mean untouched bound at close | 512 / 433 | 413 / 26 |
| Whole window walked | 0% | 96% |
| Checks of a pair already checked from the other side | 37% at full sample (N 2,000) | 19% at full sample (N 2,000) |
| CPU per profile, all searches, N 3,000 | 0.57 ms | 0.81 ms |

Per-call CPU cost, measured on N 2,000 (ns): friends / slop

| Piece | friends | slop |
|---|---|---|
| Whole `pairValueOf` check | 3,151 | 5,067 |
| Bound = 2× `pairSideOf` + `lanePairValue` | 940 | 586 |
| `packValueOf` ×2 (both directions) | 35 (no pack value) | **2,011** |
| `eligiblePair` (gate) | 666 | 327 |
| Generated `step(checkCandidate)` with a full kept list | 391 | 453 |
| `intersectCount` merge (interests) | 172 | 92 |
| Bitset popcount via a `Map` lookup | 189 (2 words) | 131 (16 words) |

### Why each lane is slow

**Friends: the bounds, not the checks.** The work is computing a full arithmetic pair value for every touched candidate (525 per search) in order to keep 12. Bounds take about 92% of search CPU. Friends supplies no pack value, so the "bound" of a touched candidate is exactly its arithmetic value. The check then repeats that arithmetic and adds the gate.

At 100,000 members two things break:

- The window grows to about 13,500.
- The posting walk touches about 2× the window, because 7.6 interest tags each sit in 19% of postings, plus the offers and seeks postings.

So the 4,800-touch cap (8 × 600) runs out first, and the search closes budgeted. This matches the 21.8% exact share in the migration report.

**Slop: wasted checks.** Four of five checks are refused:

- **40% by `segment_unreachable`.** The Date segment key does not hold who the member seeks, so the window cannot test the reverse direction.
- **12% by age range.** No index dimension holds it.
- **28% by the arithmetic.** The bound assumes a full pack value of 1,000. The real pack value is lower and fails the 350 floor.

The pack term also makes the untouched bound at least 375, which is above the floor. So almost every search walks its whole window (96%). At 100,000 members the window is about 5,700, which is over the 4,800-touch cap. Searches then close budgeted on touches or on the 600 checks that refusals mostly burn.

**The request path is the largest super-linear cost in the system, and it is not in the engine.** `ConsentNetwork.searchFor` (`packages/network/src/network.ts:2731`) scans every member. For each one it calls `eligible()` → `inNyc()` → `presentInNyc()`, which runs `snapshot.members.find` (O(N)) and loops over every presence row (O(P)). It also calls `busy()` → `openOpps()`, which allocates a filtered copy of every opportunity (O(opps)), and `metRecently()`, which scans every interaction (O(I)). One request therefore costs O(N · (N + P + opps + I)), and `retryRequests` repeats it daily for every open request. This is the path behind 88% of ntwrk meetings. It uses no lane vector, no pair gate and no exchange balance.

**The service has further quadratic steps** that will hurt before the engine does:

- `engineInput` (`network.ts:5857`) filters every facet once per member: O(N·F).
- `evidence()` (`network.ts:3415`) does the same per member.
- `learnedLive` scans every intent per learned want.
- Every unit of work (each inbound message) loads and saves the whole `NetworkState` JSON and re-inserts every participation row.

---

## 1. Where time goes: friends Friend and slop Date

### 1.1 Phases of one engine run, CPU ms (measured)

| Phase (file) | friends N 2,000 | friends N 5,000 | slop N 2,000 | slop N 5,000 |
|---|---|---|---|---|
| Planted input | 440* | 185 | 90 | 290 |
| `new World` (`world.ts:97`) | 1,636* | 354 | 329 | 620 |
| `buildProfiles` (`match/profile.ts:137`) | 1,427* | 278 | 647 | **1,554** |
| `buildCandidateIndex` (`match/index.ts:59`) | 281* | 21 | 8 | 26 |
| All searches, per profile (N 3,000, `edges.mts`) | 0.57 ms | | 0.81 ms | |
| `buildCircles` on the edges (N 3,000) | 175 | | n/a | |

\* The first friends run was JIT-cold and taken in the worst load. Read the N 5,000 column.

Notes on the phases:

- **The index is negligible.** It is O(T log T) as documented.
- **Slop profile building is the second-largest cost after search: about 0.3 ms per member, so about 30 s CPU at 100,000.** The cause is `standingObservations` (`match/standing.ts:46`), which computes a SHA-256 for every evidence id of every membership on every run (`standingEvidenceKey`). On top of that come the pack's `memberships` (it re-runs `memberReason` with every slop member rule) and `tags` (it re-derives `dateTags` strings). All of it is recomputed from scratch on every run, even for members who did not change. `World` already has a per-member `revision` hash (`world.ts:306`), which could serve as a cache key (proposal C3).
- **`World` is linear but heavy.** It embeds every facet, computes a SHA-256 revision per member and builds three centroids per member, even though the match core reads no embedding. The cost run passes a flat embedding for this reason (`scripts/sim/matching.ts:57`). Production does not.

### 1.2 Inside the searches

Wall-clock shares of the instrumented search loop:

| Piece | friends N 2,000 | friends N 5,000 | slop N 2,000 | slop N 5,000 |
|---|---|---|---|---|
| Bounds (touched candidates) | 77% | **78%** | 24% | 24% |
| Pack values (in checks) | 1% | 0% | **42%** | **42%** |
| Arithmetic (in checks) | 3% | 1% | 13% | 16% |
| Gate `eligiblePair` (in checks) | 14% | 20% | 12% | 13% |
| Generated machine `step` | 5% | 1% | 9% | 4% |

**Counts per search, N 5,000:**

| | friends | slop |
|---|---|---|
| Touches | 1,327 | 1,012 |
| Distinct touched | 526 | 274 |
| Bounds computed | 525 | 274 |
| Bounds admissible | 525 | 264 |
| Checks | 12.1 | 93 |

**Cost model** (per-call CPU × counts):

- Friends at N 5,000: 525 × 0.94 µs (bounds) ≈ 0.49 ms, against 12 × 3.5 µs ≈ 0.04 ms for checks. Bounds are about 92%.
- Slop at N 5,000: 274 × 0.59 µs ≈ 0.16 ms for bounds, against 93 × 5.5 µs ≈ 0.51 ms for checks. Checks are about 76%, and about 80% of those checks are refusals.

At 100,000 members, with the 4,800-touch cap and the 600-check cap both reached:

- **Friends:** about 4,800 × 0.94 µs + 472 × 3.5 µs ≈ 6.2 ms per profile, about 620 s CPU for 100,000 profiles.
- **Slop:** about 4,800 × 0.59 µs + 438 × 5.5 µs ≈ 5.2 ms per profile, about 520 s.

Both agree in order of magnitude with the 1,474 s and 515 s in the migration report.

### 1.3 Constant factors found in the code

1. **The value of a pair is computed twice from each side, and twice again for the bound.**
   - `pairValueOf` (`match/pair.ts:92`) calls `pairSideOf` for both directions. Each call computes `complementOf` twice: once in `utilityTerms` and once more for `exchange` (`pair.ts:42,52,59`). That is four tag merges for one complement term.
   - `meanCloseness` allocates `a.traits.map(...)` on every call (`pair.ts:50`).
   - `weightedTerms` allocates a four-element array of objects twice per bound.
   - `lanePairValue` → `laneLimits(lane)` builds a new nested object literal on every call through a chain of ternaries (`generated/matchLane.ts:43`). `laneOffset` calls `laneLimits` again.
   - In `visit()` (`search.ts:180`), the same arithmetic runs once per touched candidate as the bound.
2. **Symmetry is not used.**
   - `lanePairValue` is proved symmetric (`lawLanePairValueSymmetric`), but each side's search recomputes it.
   - Measured at full sample on N 2,000: 37% (friends) and 19% (slop) of checks were of a pair the other side had already checked.
   - For bounds the duplication is near 50% in friends. Standing is constant there, so nearly every pair inside each other's segment window is bounded from both sides.
   - The bound with a full pack value is symmetric too: the pack term is replaced by 1,000 in both directions.
3. **The generated machine copies its kept list on every check.** In `checkCandidate` (`generated/candidateSearch.ts:237-255`):
   - `worstKeptScan` reduces over `kept`, allocating a record per element.
   - `canCheckCandidate` scans `kept`.
   - `concat` or `slice().concat()` copies `kept`.
   - `{...s}` copies the state.
   - In the search loop (`search.ts:195`), `enabled(search, closeExact)` scans `kept` again on every iteration.

   Measured cost: 0.39 to 0.45 µs per check with a full kept list, plus 0.1 to 0.17 µs per stop test. That is 8% to 13% of a slop check and small next to the pack value. It matters only after the other fixes.
4. **The gate allocates strings.** `pairReason` (`filters.ts:88`):
   - builds `pairKey(a,b)` for `blocked`;
   - builds it again in each pack rule (`negative_feedback_cooldown`, `pair_cooldown`, `active_duplicate`, slop `already_introduced`);
   - in slop, calls `slopProfiles(w.input, w.canonical)` (a WeakMap lookup) in each of three rules, then runs the geo rule `mutualMarkets`, which allocates arrays and sorts.

   Cost: 0.33 µs (slop) to 0.67 µs (friends) per gate. In slop, `segmentPairAllowed` is the first gate test after lane and market, and it refuses 40% of all checks, but only after the full arithmetic and both pack values were computed (`pair.ts:98`: "The gate runs after the arithmetic only because it is the slower part"). For slop that ordering is wrong: the segment test and the age test are cheaper than one pack value.
5. **The slop pack value is the most expensive term (2.0 µs for both directions).** `datePackValue` (`packs/slop/score.ts:173`):
   - runs `compatEstimate`, with an `Array.filter` plus `includes` for shared interests and up to two `Math.pow`;
   - calls `dateActivity` twice, each time doing `filter` + `sort` with `indexOf` inside the comparator;
   - calls `Math.exp` twice;
   - runs `revealedTaste` over the rating history;
   - calls `bodyTypeFactor`, which may run `revealedBodyPref` (it filters the history).

   All of this is floating point, rounded at the end, and recomputed for each direction on each check.
6. **Bitsets alone do not help.** Measured: a popcount over interned interest tags is not faster than the existing merge when the bitset is fetched through a `Map` (189 ns against 172 ns in friends; 131 against 92 in slop, where the vocabulary is 484 tags, i.e. 16 words). Bitsets pay only in a struct-of-arrays layout: one `Uint32Array` per tag group, indexed by block position, no `Map`, no object per profile. Even then they help only where the vocabulary is small (friends: 42 activity tags fit in two 32-bit words). The gain is in the bound loop, which runs 40× more often than checks. See C4.

### 1.4 Data quality found while profiling (it changes both cost and quality)

- **friends `tags` keeps structural tags** (`packs/friends/vectors.ts:78-87`). Unlike `networkPack.memberTags`, which drops every `key:value` tag through `plainTags` (`packs/network/vectors.ts:52`), friends takes every tag of `desire`/`goal` facets as seeks and every tag of `offer` facets as offers. In the planted world:
  - Every member's seeks contain `lane:friend` and `side:peer`. The posting size equals the block size: 1,967 of 1,967.
  - Seeks and offers both contain `level:N`.

  Effects:

  - Complement coverage can never exceed 3 of 5 (600).
  - A shared `level:N` counts as a "complement hit".
  - The "returned" walk touches huge postings.

  If real onboarding facets carry `lane:`/`side:` tags (the network pack comments say the onboarding agent writes them), this is a production defect, not only a planted-world one. Check real facet tags before relying on this.
- **The slop planted world is homogeneous on lifestyle.** Every member is `goal:long_term`, `smoking:never`, `drinking:sometimes`, `religion_importance:1`, `politics:moderate` (`packages/sim/src/planted.ts`, the slop block near line 423). Interests are close to empty: the median interest posting holds 3 members, and the mean interest count is 1. The pack value therefore varies mainly through plans, free slots and wants_kids, and five offers tags are held by everyone (posting size = block). AUC and bound measurements on this world understate how the dating lane behaves on real, heterogeneous profiles.
- **Planted friends members all have 7 to 8 interests.** The edge graph therefore has no hubs: maximum degree 39 with k = 12, and a correlation of 0.11 between tag count and degree. Real data has heavy-tailed tag counts. `coverageValue(|Ia ∩ Ib|, |Ia|)` uses the searcher's own denominator, so a member who lists many tags covers almost everyone's interests and becomes a hub (an "interest-stuffing" effect). Planted worlds need a heavy-tailed tag-count arm before hub control can be measured.

---

## 2. Why the bound is loose in each lane

### 2.1 Friend

There is no pack value, so for a touched candidate the bound equals the arithmetic value: bound minus value = 0 on every check (measured). Ties at the k-th value are not the issue either: pending candidates with bound equal to the k-th value at close averaged 0.0 (measured). **The only slack is the untouched bound**, set by `untouchedBound()` (`search.ts:150`). An untouched candidate is bounded with:

- `closeness` = 1,000 (weight 2 of 9);
- `affinity` = coverage(open interest tags) for the searcher and full for the other side whenever any interest tag is still open;
- `complement`/`returned` from the open counts.

After every interest posting is walked, the searcher's affinity bound falls to 0. The closeness term alone still gives (2·1000 + 1·cov)/9 ≥ 222 on the searcher's side and more on the other side. Measured at N 5,000: the mean untouched bound at close was 433 and the mean k-th value 512. The search closes exact only after walking enough interest postings to push the untouched bound below the k-th value. Those postings together are about twice the window (7.6 tags × 19% + offers and seeks postings), so the walk costs more than a plain window scan would.

**The slack is the closeness term.** Friends closeness is dominated by home position: 50 per km north or east, 0 at 20 km (`packs/friends/vectors.ts:97`). It is bounded at 1,000 for every untouched candidate, although the segment (home neighborhood × tolerance class) fixes the home of every member in it. A per-segment closeness bound is exact and cheap. `bucketValueBound` and `lawBucketBoundSound` are already generated (`generated/candidateSearch.ts:79-91`) but **not used by `search.ts`**. The architecture (G-architecture, "index.ts: fixed-size buckets with summaries") specified block-max summaries; the implementation kept only per-tag postings and one global untouched bound.

### 2.2 Date

- **Pack slack.** Weights are complement 3, affinity 2, closeness 2 (no traits in slop, so weight 0) and pack 3. The bound sets the pack term to 1,000. The measured mean of bound minus arithmetic value on admissible checks was 102 points (98 after the gate). As a result, 28% of checks fail the 350 floor on the true pack value.
- **Untouched bound is at least 375 from the pack term alone** (3·1000/8), which is above the floor. The posting walk therefore can never close the search before the window is walked: the whole window was walked in 96% of searches. At close, the mean untouched bound was 26 (only because the window walk completed) and the mean top pending bound was 352, against a mean k-th value of 413.
- **Gate refusals are not in any bound.**
  - Orientation and the partner's own radius are refused as `segment_unreachable` after full arithmetic. The cause: `dateSegmentOf` (`packs/slop/generators.ts:109`) keys a segment by `is|cell` only, and `windowSpans` tests only "my partners include that segment", never "that segment's members reach me".
  - The age range is refused at the pack rule `age_range`.

  These are 52% of all checks. Each one costs the full 5 µs.
- **Ties:** pending candidates with bound equal to the k-th value at close averaged 0. Not a factor.

---

## 3. The request path (`searchFor`), the source of 88% of ntwrk meetings

### 3.1 What it does today (`packages/network/src/network.ts`)

The path is `openRequest` (2572) → `tryRequest` (2677) → `searchFor` (2731). The daily `retryRequests` (2708) repeats `tryRequest` for every open request up to a week old.

`searchFor`:

1. Builds `load` by scanning every opportunity (2736).
2. Loops over **every member** `x` (2738). For each one:
   - `eligible(x)` (6859):
     - `syncRecord`;
     - `inNyc` → `presentInNyc` (797), with `snapshot.members.find` (O(N)) and a loop over every presence row (O(P));
     - `busy` (6870) → `openOpps()` (6881), which builds `[...this.opps.values()].filter(...)` for every call (O(opps));
     - `overBudget` (filters the member's proactive times).
   - `blocked`, `avoid`, first-name test.
   - `pairHistory` → `metRecently` (2777), a scan of **every interaction** (O(I)).
   - `askFit` (2786): set lookups in `knownProfiles()`, which is cached per snapshot. It scores the request's want against the candidate's skills, pool wants and interests.
   - Travel minutes.
3. Sorts every survivor and keeps `1 + conciergeResearchDepth`.

**Cost:** O(N · (N + P + opps + I)) per request. At N 100,000 with P ≈ N and I and opps in the tens of thousands, that is about 2·10^10 elementary steps per request: minutes per request in JavaScript, times every open request every day. At N 1,000 it is about 2·10^6 steps, which is why the simulator does not notice.

**What it scores:**

- A one-directional fit of the candidate to the requester's want: a strong skill gives 1, a shared pool want 0.85, a skill 0.6, interests 0.4+.
- A travel bonus and a load penalty.
- No benefit to the candidate (`whyBack` is text only).
- No standing, so no parity: a first-time founder can be sent a famous investor.
- No lane, no exchange balance.
- None of the pack pair rules beyond blocks, avoid and recent history.

Romance is forced to 0 (2807). The minors check happens through `eligible()` (`m.minor`).

It does not use the match core because it predates the migration and works on the Network's own `knownProfiles` (snapshot facets plus learned tags) at message time, with no `World` built. The core lives inside a per-run `World`, built only in `dailyRun`/`planWorld`.

### 3.2 How to route it through the same gate and bounded search

**Step 1 (S, no behaviour change): remove the quadratic.** Inside `searchFor`, build once per call:

- a `Set` of members present in NYC for the window, from a presence index `Map<MemberId, Presence[]>` cached with the snapshot (as `snapshotBlocks` already does for blocks);
- a `Set` of busy members, from one pass over open opportunities;
- a `Map<pairKey, lastMetAt>` from interactions;
- the `load` map.

Then the loop is O(N + P + opps + I) per request. Make `presentInNyc` use the presence index everywhere (it is called from `eligible`, which many paths call per member). The behaviour is identical, so a replay of the simulator's `network` block must give byte-identical logs: the same seeds and the same `request_result` lines.

**Step 2 (M): one pair gate.** For each survivor, check the pair through the engine's pair gate in the request's lane:

- The route exists: `networkIntentLane` / `wantRoles` (`packs/network/vectors.ts:72`).
- Keep one `MatchRun` per day (from `planWorld`/`dailyRun`, `network.ts:4257`) and expose `w.match.value(profileOf(requester, lane), profileOf(x, lane))`.
- Use it as a filter: a requester and helper with no pair value in the lane are refused. This brings in minors, blocks, pack rules, parity and balance. Keep `askFit` as the requester's directed utility input (the pack term).
- Risk: requests that today produce meetings may be refused by parity, balance or floor. The unmerged Intro experiment already lowered meetings from 174 to 150. Measure: `request_result` outcome counts, meetings, everyone-yes rate, and the share of request candidates refused by each gate reason.

**Step 3 (M to L): bounded search.**

- Replace the scan with `searchCandidates` against the day's `CandidateIndex`, with the requester's want projected as a query profile: seeks = the want's needs, interests = the want's interests, in the routed lane.
- Then apply the request-time filters (eligible now, busy, first name, history) to the kept list. Take a larger `searchLimit` for requests, e.g. 3× the research depth, so the post-filter rarely empties it.
- Cost: at most 600 checks per request, instead of a member scan.
- Exactness: the search is exact or reports `unseenBound`. The post-filters only remove, so log both the result and the bound.
- Staleness: the index is from the last daily run. A member who joined since then is not in it. Add an "append-only delta" list scanned linearly (see C3), or rebuild the index on `dirty` when it is older than X hours.

The request then gets the same guarantees as proactive matching: minors, blocks, pack rules, parity, balance where the lane requires it, and a reported bound. A one-directional "help" ask (a skill helper) should use a lane without balance (Mentor-like, or a new `Help` lane with `balanceRequired: false` and a low floor on the helper side), not Intro. Otherwise balance refuses most honest help asks.

---

## 4. Other super-linear steps (file:line, bound, estimate at N = 100,000)

Notation: N members, F facets (≈ 10 N), P presence rows (≈ N), I interactions, O opportunities kept in memory, Q intents. "Per message" means each inbound unit of work.

| # | Step | Where | Cost | At N 100k (rough) | Fix |
|---|---|---|---|---|---|
| 1 | Request search | `network.ts:2731` (`searchFor`), 797, 6859-6881, 2777 | O(N·(N+P+O+I)) per request, × open requests daily | ~10^10 per request | §3.2 step 1 (S) |
| 2 | Learned facets in `engineInput` | `network.ts:5857` `facets.filter(f => f.memberId === m.id)` inside a loop over members | O(N·F) per daily run (and per `planWorld`, `recheckStandingIntents`) | ~10^11 | Group facets by member once (S) |
| 3 | `learnedLive` | `network.ts:5938` `stored.some(...)` per learned want | O(L·Q) | ~10^9 | Index intents by (member, objective) (S) |
| 4 | Availability evidence | `network.ts:3415` `snap.facets.filter(member)`, `opps` scan, `presence.filter` per member | O(N·(F+O+P)) when planning | ~10^11 | Per-snapshot indexes (S) |
| 5 | `busy()` / `openOpps()` | `network.ts:6870-6881` | O(O) per call, called per member in many loops | O(N·O) | Maintain participant → open-opp set (S) |
| 6 | State load and save | `store.ts:80,292` (`runStored`; insert `network_state` jsonb; delete and re-insert every participation in batches of 500; upsert every opportunity), `runtime.ts:786` | O(state) per **message** | ~100 MB jsonb per message (members, interactions, opps, asks, feedback, memberStanding) | Row-per-entity tables with dirty tracking (L) |
| 7 | Snapshot reload | `network.ts:6841` (rebuilt when `dirty`, which any learning sets); service `snapshot.ts:95` (whole-app SELECTs) | O(N+F+P+E) per dirtying message | One full reload per message that learns | Incremental snapshot deltas (M) |
| 8 | Standing-intent fingerprint | `network.ts:5399` `stableStringify` of every member, facet, presence and event, sorted, then SHA-256 | O(F log F) daily and per recheck | Seconds | Hash per-member revisions instead (S) |
| 9 | Engine input canonicalisation and hashing | `engine.ts:69` (`canonicalInput` sorts every list and `stableStringify`s rows without id), `engine.ts:58` (`hashInput` stringifies the whole input twice) | O(size log size) | Seconds, memory | Hash per-entity revisions (M) |
| 10 | `World` build | `world.ts:97-355`: embeds every facet (`localEmbed`), SHA-256 revision per member, centroids | O(F·dim) | Tens of seconds | Lazy embeddings: the match core reads none (S) |
| 11 | Profiles | `match/profile.ts:137`, `match/standing.ts:46` (SHA-256 per evidence id) | O(N·e) | ~30 s CPU for slop | Cache profiles by member revision (C3) |
| 12 | Searches | `match/search.ts:120` | ≤ N·600 checks, ≤ N·4,800 bound computations | 520 to 620 s CPU | §5 |
| 13 | Circles | `match/circles.ts:69-78` (triangles over edge rows: Σ deg² / 2), growth loop 103-127 (copies `[...group, candidate]` per option) | O(Σ deg²) | Fine while degree ≈ k (measured max 39); unbounded if hubs appear (either-side keep in `mutualEdges`) | Cap degree per member at 2k when building circles (S) |
| 14 | Selection machine | `policy.ts:189-319`; `generated/selectionRun.ts` copies maps and the refusal list per step | O((sel+ref)²) | Bounded by `maxProposalsPerCity` 120 per city; refusals stop once the city cap fills | Low priority |
| 15 | Slop assignment | `packs/slop/assign.ts:20-72`: rounds × edges; `pairKey` strings | O(R·E) | Fine | - |
| 16 | Network planner | `plans.ts:289-296` (carry loop per person: O(N·|carry|)); `plans.ts:344` availability over all people per distinct slot end, then a sort per activity (O(W·A·N log N)); `poolGraph` on a top-24 pool (bounded) | O(W·A·N log N) + O(N·|carry|) | W·A ≈ 400 → ~10^8 | Index carry by member; partial select instead of sort (S) |
| 17 | Friends weekly planner | `packs/friends/planner.ts:489-558`: `tables()` per (zone × radius × policy) filters `ids` (O(N)) and filters the pool per activity; the inner `growTable` is bounded by `FRIENDS_TABLE_POOL` = 36 | O(Z·R·A·N) | ~10^8 | Precompute per-zone lists (S) |
| 18 | `lastAsk` | `network.ts:5541`: scans all asks per member asked | O(A·asks) | Fine at today's ask rate | Index (S) |
| 19 | Judge | `engine.ts:195-264`: top K = 10 rubric, 30 screen, 6 deep | Bounded | - | - |
| 20 | `retainMemberStanding` | `network.ts:5495`: one pass with `record()` map lookups | O(rows) | Fine | - |

Items 1 to 7 are the ones that will hurt first. They are in the service, not in the engine, and none of them is covered by the matching block's cost gate.

---

## 5. Ranked proposals

Effort: S = under a day, M = days, L = a week or more. "Exactness" says what survives.

### Algorithmic

**A1. Slop: make the segment test symmetric (put who the member seeks into the segment key).**

- **Change.** `dateSegmentOf` (`packs/slop/generators.ts:109`): own = `${is}|${sorted seeks}|${cell}`. Partners = for each pool `p` in my seeks and each reachable cell `c`, every own key `p|S|c` where `S` contains my `is`. The orientation half of the reverse test is then decided per segment.

  Add the radius-class half: a class index of the member's limit, as friends does with tolerance classes (`packs/friends/vectors.ts:37`).

  `windowSpans` gains a per-segment "reaches me" test from a precomputed `reachers: Set<segment>` for my own segment.
- **Why.** 40% of slop checks (measured, N 5,000; 33% at N 2,000) are `segment_unreachable` refusals that cost the full arithmetic and both pack values. Removing them from the window also shrinks the window, so fewer bounds and fewer touches. That pushes the 100,000 case under the 4,800-touch cap more often.
- **Risk.** Segment count grows: about (pools × seek-sets × cells × radius classes). Segments stay a superset only if `S` and the classes are encoded exactly. A bi member who seeks two pools is in its own seeks-set segment, which is fine. Under today's onboarding, members whose seeks are unset ("bi", "pan", "queer", see `network/service/packs.ts` onboarding comment) are never matched. That is a separate quality gap: let them state several pools.
- **Measure.** Matching block cost rows (checks per profile, exact share, touches) at N 10,000 and 100,000 for slop. Oracle exactness at 100/200/400 must stay equal. Add a gate "no `segment_unreachable` refusal inside a search window" (it must be 0).
- **Effort.** S to M.
- **Exactness.** Kept. `lawSegmentBlockingComplete` holds per segment; the reverse test is the same predicate evaluated per segment.

**A2. Run cheap hard rules before the arithmetic ("dealbreaker pre-filter").**

- **Change.** In `visit()`, before computing the bound, run a pack-supplied cheap pre-gate:
  - slop: age range both ways, orientation, stated dealbreakers;
  - friends: transit tolerance;
  - all packs: blocks and minors already hold by construction.

  A refused candidate gets bound `noPairValue` and never enters the heap. In `pairValueOf`, run the gate first for slop: reverse the comment at `pair.ts:98`. Optionally add an age class to the slop segment: a 5-year bin, with partners = bins intersecting my range, kept as a superset.
- **Why.** Age range alone is 12% of slop checks. Today every gate refusal costs 5 µs plus a check from the 600 budget. The pre-gate costs about 0.33 µs per touched candidate. At N 5,000 that is 274 × 0.33 ≈ 90 µs to save about 48 refused checks × 5.5 µs ≈ 264 µs per search. More important, the check budget is no longer spent on refusals. That is what makes slop budgeted at 100,000.
- **Risk.** The pre-gate must be a **subset** of `eligiblePair`'s refusals: it may never refuse a pair the gate admits. Encode it as a pack hook with a law `preGateImpliesGateRefuses`. A pre-gate that reads mutable state (cooldowns) must read the same `World`.
- **Measure.** Checks per profile; share of checks that are refusals (gate it below 10%); exact share at 100,000.
- **Effort.** S.
- **Exactness.** Kept: bound = −1 only when the value is −1 (bound soundness).

**A3. Block-max per segment and accumulator walk for Friend (and any lane whose closeness or tags dominate).**

- **Change.**
  - (a) Per segment, store summaries: union bitset of interests, offers and seeks; minimum interest, seeks and offers counts; trait ranges. Friends' home lat/lng is constant in a segment, so closeness has an exact segment value. Compute `U(a, segment)` with the generated `bucketValueBound` (already proved: `lawBucketBoundSound`). Visit segments in descending U. Stop when the k-th value beats the next U. This is Block-Max WAND applied to member segments (Ding and Suel 2011; Fagin, Lotem and Naor 2003 for the threshold algorithm [unverified, from D-theory]).
  - (b) Inside a segment, replace "full arithmetic per touched candidate" with a score accumulator. While walking a posting, count hits per candidate position in an `Int16Array` indexed by block position. Compute the bound from the hit counts plus the open-tag counts and the segment's closeness, all integer and monotone. Only candidates whose accumulated bound beats the k-th value get the exact arithmetic. This is the MaxScore/WAND accumulator pattern (Turtle and Flood 1995 [unverified]; Broder et al. 2003 [unverified]).
- **Why.** Friends spends about 92% of search CPU computing 525 exact values to keep 12. The untouched-bound slack comes from closeness being bounded at 1,000 everywhere, and segments already pin home location. Expected: bounded candidates fall from about 525 to the high tens per search, and touches stop scaling with 2× the window. Inference: about 5 to 10× less search CPU for friends, plus most 100,000 searches exact instead of 22%. To be measured.
- **Risk.**
  - Summaries add O(segments × vocabulary/32) memory, which is small.
  - The accumulator needs a per-search reset. Use a generation counter, not a clear.
  - The segment order must be deterministic: ties by segment key.
  - Proofs: a per-segment bound law ("every member of a segment has value ≤ U(segment)") is new shell logic. Keep it in a generated function with a law and keep `bruteForceCandidates` as the oracle.
- **Measure.** Bounds per search (new counter: `bounds` in `SearchTally`), touches, checks, exact share, CPU. Oracle agreement at 100/200/400. A new planted arm with heavy-tailed tag counts.
- **Effort.** M.
- **Exactness.** Kept when the segment bound is proved; the stop rule is unchanged.

**A4. Use symmetry: per-run pair memo, or a symmetric self-join per segment pair.**

- **Change (a).** A per-run open-addressing table keyed by (blockId, min ordinal, max ordinal) → value, in an `Int32Array`. `MatchRun.value` and `searchCandidates` read it before computing.
- **Change (b), better for Friend.** Because bound = value there, compute each unordered pair once in a segment-pair join and push it into both members' top-k heaps: an all-pairs similarity join with a prefix filter (Bayardo, Ma and Srikant 2007, "Scaling up all pairs similarity search", WWW [unverified]).
- **Why.** Measured at full sample on N 2,000: 37% (friends) and 19% (slop) of checks were already done from the other side, and about half of friends bounds are duplicates.
- **Risk.**
  - Memory. At 100,000 profiles × ~100 checks the table holds up to 10^7 entries (~80 to 120 MB as typed arrays). Cap it, or memo only checks, not bounds.
  - The join changes the order of evaluation. The kept lists must not change: values are deterministic and the ranking uses (value, ordinal).
  - The generated machine still sees one `checkCandidate` per candidate per search, so the counts stay honest. Add a `reused` counter so reports do not claim checks that were reads.
- **Measure.** Checks computed against checks reused; CPU.
- **Effort.** S for (a), M for (b).
- **Exactness.** Kept: same values. `lawLanePairValueSymmetric` justifies the reuse.

**A5. A tighter pack bound for slop.**

- **Change.** Add `packBound(a, b)` to `PackVectors`: a cheap upper bound on `packValue(a, b)`, proved ≥ by construction. For slop: the product of the factors that are known and ≤ 1 (goal clash, kids clash, politics clash, logistics), with every factor that can exceed 1 (type, learned taste, body type) set to its clamp maximum. The bound uses `packBound` in place of 1,000. The untouched bound keeps 1,000 unless a per-segment maximum is stored.
- **Why.**
  - The mean slack is about 100 points, and 28% of checks fail the floor on the real pack value.
  - The untouched bound of at least 375 forces whole-window walks.
  - `datePackValue` is 2.0 µs for both directions, 40% of a slop check.
- **Risk.** The bound must be monotone and sound under float rounding. Compute it in integers: the factor tables are constants that can be stored as permille. It also leaves more of the pack logic duplicated. The cleaner route is to move `datePackValue` to an integer, generated function with a proved upper-bound helper.
- **Measure.** Arithmetic refusals per search; checks; exact share.
- **Effort.** M.
- **Exactness.** Kept if `packBound ≥ packValue` is a law.

**A6. Request path (§3.2).**

- Step 1 is the most important performance fix in the system: S, no behaviour change.
- Steps 2 and 3 (M to L) bring the 88% path under the pair gate, parity and a bounded search, with a reported bound.
- Risk: fewer request matches. Measure as in §3.2.

**A7. Incremental matching: adding members without recomputing everything.**

- **Change.**
  1. Cache `MatchProfile`, keyed by entity id plus the member's `World.revision`, plus the standing row. Rebuild only changed members. Today slop spends 0.3 ms per member per run here.
  2. Keep the `CandidateIndex` between runs. Insert and remove positions in sorted segment arrays and postings: O(log n + tags) per change. Rebuild it fully weekly, so the ordinals stay canonical. Ordinals must stay "canonical entity id order", so either rebuild ordinals at batch time or switch the tie order to the entity id string (deterministic, no rebuild).
  3. Keep each member's kept list and k-th value from the last run. For a new or changed member b, run b's own search, then a **reverse** pass: for each a in b's window with bound(a, b) > kth(a), check (a, b) and update a's list. The update is exact by the same argument as `alwaysKeptBeatDropped`.
  4. For a removed or blocked member, re-search only the members whose lists held it (keep reverse lists).
- **Why.** Most members do not change between daily runs. The founder asks for "add new elements without recalculating everything". Expected cost per day ≈ (changed members) × one search + reverse checks, instead of N searches.
- **Risk.** Kept lists go stale when standing moves weekly by up to 5 points, or when a cooldown or block changes a gate answer. Gate answers must be re-read at send time anyway (`sendTimeReason`, the selection guard). Run the full rebuild weekly and diff it against the incremental result in the sim (new gate: incremental = full).
- **Measure.** Profiles rebuilt per run; searches per run; the diff gate.
- **Effort.** L.
- **Exactness.** Kept for the incremental result, if the reverse pass uses sound bounds. Staleness is bounded by the rebuild period.

**A8. Touch cap tied to the window, reported as a cost.**

- **Change.** Today `searchTouchesPerCheck × budget` = 4,800 is the limit that closes friends and slop searches at 100,000, before the check budget. After A1 to A3 the touch count per search falls. Keep the cap, but report a separate "touch-budgeted" count, so a run can tell a check-budget close from a touch-budget close (`walkSpent` already exists in the event).
- **Risk.** None.
- **Effort.** S.
- **Exactness.** Unchanged.

### Constant factor

**C1. A pair-side kernel without allocation.**

- **Change.** Compute both directions' terms in one function over raw arrays:
  - one merge for `seeks ∩ offers` per direction, used for both `complement` and `exchange`;
  - one merge for interests;
  - closeness without `map`;
  - weights read once per lane from a frozen table, not a new `laneLimits` object per call.

  Keep the generated `directedUtility`, `pairValue` and `lanePairValue` as the decision. Only the inputs are computed faster.
- **Why.** Bound 0.6 to 0.94 µs, check 3 to 5 µs. A 2 to 3× gain on the bound loop is plausible: it removes four `intersectCount` calls of which two are duplicates, two array allocations, and two `laneLimits` object builds.
- **Risk.** A wrong refactor. Guard it with the brute-force oracle and an equality fuzz against `pairSideOf` in the matching block.
- **Effort.** S.
- **Exactness.** Unchanged.

**C2. Struct-of-arrays block.**

- **Change.** Per block, store standing, uncertainty and segment index in `Int32Array`s; tag sets as flat `Int32Array` offsets plus values (CSR); for vocabularies of 64 tags or fewer, a `Uint32Array` bitset per profile and group, so overlap is a popcount. Postings become `Int32Array`. `touched` becomes a generation-stamped `Int32Array` instead of a `Set<number>`.
- **Why.**
  - The `Set` and `Map` traffic per touch (`touched.has/add`, `postings.get`) and object-per-profile access dominate the 1,327 touches per friends search.
  - A measured popcount through a `Map` lookup was no faster than the merge, so the gain needs the array layout.
  - Roaring-style bitmaps are the general form for large vocabularies (Chambi, Lemire, Kaser and Godin 2016, arXiv:1402.6407, https://arxiv.org/abs/1402.6407).
- **Effort.** M.
- **Exactness.** Unchanged.

**C3. Profile and standing caching across runs.** This is the first half of A7: SHA-256 per evidence id only when the evidence set changes. S to M.

**C4. Batch the machine's check steps.**

- **Change.** The generated `checkCandidate` copies `kept` and scans it three times (~0.4 µs). Option (a) keeps the generated step as the decision but skips the per-iteration `enabled(closeExact)` scan, by caching the worst kept value in the shell and calling `enabled` only when `unseen < worst kept`. The machine still decides. The shell test only skips calls whose answer is known false, as the selection shell already does with `fits` (`policy.ts:144`).
- **Option (b), a spec change.** A `checkCandidates(values)` transition that applies a sorted batch with one copy.
- **Effort.** S for (a), M for (b).
- **Exactness.** Unchanged. State in the spec prose that the shell mirror only skips refusals the guard would make.

**C5. Gate without strings.**

- Use integer pair keys (member index pairs) for `blocked`, `negativeFeedback`, `pairInteractions` and `activePairs`.
- Fetch `slopProfiles` once per gate, not once per rule.
- Make `mutualMarkets` allocation-free for the one-market case.
- **Effort.** S. **Exactness:** unchanged.

**C6. Cheaper slop pack value.**

- Precompute per profile: interest sets as bitsets, the activity order index, `exp` of the type terms as integer tables.
- Compute both directions in one call.
- Then move it into an integer generated function (also needed for A5).
- **Effort.** M. **Exactness:** unchanged if bit-identical. Otherwise it is a value change; measure AUC and the slop block.

### Quality items that fell out of the profile

- **Q1. Friends structural tags.** Filter `key:value` tags in `friendsVectors.tags`, as the network pack does. Complement coverage is capped at 600 today, and `level:N` creates false complement hits. Measure the friends block and the planted AUC (0.60 today). S.
- **Q2. Hub control.** `coverageValue(|Ia ∩ Ib|, |Ia|)` rewards a partner who lists many tags. Planted worlds cannot show this effect: every member has 7 to 8 interests. Add a heavy-tailed tag-count arm to `planted.ts`. Measure degree p99 and max, and Gini of proposals per member. Consider a per-member in-degree cap in `mutualEdges`/selection, or the overlap coefficient with `max(|Ia|, |Ib|)`. S to M.
- **Q3. Signifiers for dating.** Onboarding leaves "bi/pan/queer/both" unset, and such members are asked again rather than matched (`network/service/packs.ts`, onboarding comment). With A1, a multi-pool seeks set costs nothing in the index. Gender identity (`is`), trans status and "open to trans partners" fit the same mechanism: segment key and mutual inclusion. They must be stated by the member, never inferred, and stay private.
- **Q4. Planted-world realism.** Slop lifestyle is constant and interests are near empty. Add variance, or the dating lane's measured bound and AUC stay unrepresentative.

### Priority order (do first → last)

1. A6 step 1 (request path O(N²) → O(N)) and §4 items 2 to 5 (service quadratics). S each; no behaviour change.
2. A1 (slop symmetric segments) and A2 (pre-gate). S to M; −50% of slop checks.
3. C1 (allocation-free pair kernel) and C5. S.
4. A3 (block-max per segment, accumulator walk). M; the friends fix.
5. A4 (symmetry). S to M.
6. Q1 (friends structural tags). S; quality.
7. A5 + C6 (pack bound, integer pack value). M.
8. A6 steps 2 and 3 (request path through the gate and the bounded search). M to L; a quality decision for the founder (balance and parity on requests).
9. A7 (incremental index and lists). L.
10. C2, C4, A8, item 6 (state storage). M to L.

### How to keep the proofs and the oracle meaningful

- Every pruning change (A1, A2, A3, A5) adds one generated law: a segment or pre-gate implication, a segment bound soundness, or a pack-bound soundness. The search shell calls only the generated predicate.
- `bruteForceCandidates` must stay the plain, unpruned pair function. Never route it through the memo or the pre-gate.
- Extend the oracle gate to the new planted arms (heavy-tailed tags, heterogeneous slop lifestyle) and to N 1,000, sampled.
- Add `bounds` and `reusedChecks` to `SearchTally`. Report the cost gate on CPU per profile as well as on checks, because friends' cost is in bounds, which no current gate counts.
- For A7, add the incremental = full diff gate.

---

## 6. What will NOT work, or will not help, here

- **Raising the check budget for Friend.** Checks are not the friends bottleneck: 12 checks against 525 bounds, and the touch cap closes searches first.
- **Bitsets without a layout change.** Measured: a `Map`-fetched popcount is no faster than the sorted merge. Bitsets need C2.
- **Breaking ties better.** Measured: pending candidates tied at the k-th value at close average 0 in both lanes. Ties are not why searches budget.
- **"Search only the lower-ordinal side."** Each member needs its own top-k. Halving the work needs a join that feeds both heaps (A4b), not skipping one side.
- **Approximate ANN (HNSW, LSH, k-means or e-means clusters) as the candidate generator for the gate.**
  - These give recall, not the exact or bounded guarantee the spec proves.
  - The score is a gated, harmonic, two-sided integer function, not a metric or an inner product.
  - e-means (Bessa, Mazaré, Szilvasy, Touvron, Picard, Douze, Jégou 2026, arXiv:2611.09501, https://e-means.github.io/) is an empirical k-means speed-up. Its page states no convergence or optimality guarantee.
  - Clusters could at most order the segment visit (a heuristic that changes cost, not the result), the same role A3's segment bounds play exactly.
- **Caching pair values across runs without revisions.** Pack values in slop read rating history (`revealedTaste`, `revealedBodyPref`), and standing moves weekly. A cross-run cache must key on both members' revisions and standing rows, or it serves stale values.
- **Fixing engine search speed while the request path and state storage stay quadratic.** At 10,000+ members the service (§4 items 1 to 7) dominates any engine gain.

## Sources opened

- e-means project page: https://e-means.github.io/ (arXiv:2611.09501; Meta FAIR; code in `faiss/contrib/e_means`).
- Ding and Suel (2011), "Faster top-k document retrieval using block-max indexes", SIGIR, pp. 993-1002, DOI 10.1145/2009916.2010048: https://research.engineering.nyu.edu/~suel/papers/bmw.pdf, https://dblp.org/rec/conf/sigir/DingS11.html (search-result record; the PDF itself was not read).
- Chambi, Lemire, Kaser and Godin (2016), "Better bitmap performance with Roaring bitmaps", Software: Practice and Experience 46(5), arXiv:1402.6407: https://arxiv.org/abs/1402.6407 (search-result record).
- Repository: `/Users/nubs/thenetwork-matching` at `3f0f8586`, the files and lines cited above; `docs/results/2026-11-17-matching-engine-migration.md`; prior notes G-architecture.md and D-theory.md §3.6, §4c.

Recalled, not opened [unverified]:

- Fagin, Lotem and Naor (2003), threshold algorithm, JCSS 66(4).
- Turtle and Flood (1995), MaxScore, Information Processing and Management.
- Broder et al. (2003), WAND, CIKM.
- Bayardo, Ma and Srikant (2007), all-pairs similarity search, WWW.

Scripts and raw outputs: `(scratchpad)/research2/bench/` (`profile-search.mts`, `micro.mts`, `edges.mts`, `run.sh`, `*.json`).
