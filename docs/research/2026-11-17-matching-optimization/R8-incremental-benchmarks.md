# R8. Incremental matching, caching, and benchmarks against N^2

Angle: incremental maintenance of candidate lists, what can be cached and reused, and the benchmarks that stop quadratic work from coming back.
Code base: worktree `/Users/nubs/thenetwork-matching`, commit `3f0f8586`. I only read the code. I ran nothing except a small text extractor for one downloaded PDF.
Citation rule: **[opened]** means I opened the source or its abstract page during this research. **[unverified]** means I recall it from memory and did not open it.

---

## 0. Summary

1. **Today every run starts from nothing.** `World.match` builds a new `MatchRun` per engine run (`packages/engine/src/world.ts:82`, `match/run.ts:42-52`). It rebuilds every profile (the pack's extraction runs per member), the interner, the index, and one search per profile. `dailyRun` and `recheckStandingIntents` (`packages/network/src/network.ts:5378-5398`) can run it twice a day. At 100,000 members the measured search phase alone is 284 s (peon), 515 s (slop) and 1,474 s (friends) (docs/results/2026-11-17-matching-engine-migration.md). With 1% churn a day, about 99% of that work repeats yesterday's answers.

2. **There is an exact invalidation rule, and it is small.** The pair value `v(a,b)` depends only on the two profiles and the pair-gate state of that pair. So a cached kept list `K(a)` can change for only four reasons:
   - a new or changed member `x` ranks above `a`'s worst kept entry (or `K(a)` is not full);
   - a kept member leaves or changes;
   - the gate of one kept pair closes;
   - the gate of one pair opens.

   On average a new member enters only about `k` other lists (the average in-degree equals the average out-degree). Expected cost per insert is then one forward search (≤ 600 checks) plus a reverse pass. The reverse pass skips a bucket when the bucket bound is below the bucket's smallest stored k-th value. Exactness survives. If the reverse pass hits a budget, the skipped buckets carry a **pending bound**, so the certificate (`unseenBound`) stays sound.

3. **Three things in today's code block incremental work and must change first:**
   - The profile `ordinal` is a position in entity-id order (`profile.ts:185-186`). Inserting one member shifts every later ordinal, and the ordinal breaks ties.
   - The tag interner numbers tags in sorted order (`profile.ts:115-121`), so a new tag renumbers every tag.
   - Weekly capacity decides whether a profile exists at all (`profile.ts:161-162`, `planProfileCapacityAllows`). Every member who uses up their week therefore leaves the index, and comes back at the reset.

4. **The budget hides quadratic work rather than removing it.** The cost gate (`scripts/sim/matching.ts:406`) caps checks at 600 per profile. The tracked gate "share of all pairs falls with N" (`matching.ts:444-447`) passes by construction. The measured growth in checks per profile from 10k to 100k is:

   | Lane | Checks per profile, 10k to 100k | Implied slope of total work, at least |
   |---|---|---|
   | Date | 129.7 to 438, capped at 600 (a lower bound) | ~1.53 |
   | Friend | 103.5 to 472 | ~1.66 |
   | Hire | 52.8 to 265 | ~1.70 |
   | Intro | 1.0 to 0.9 (truly linear) | ~1.0 |

   The quadratic work shows up as **lost exactness**: Date falls from 93.9% exact to 31.4%. The benchmark must gate on *work-to-exactness* (measured with no budget, offline) and on exactness itself, not on capped checks.

5. **The largest quadratic costs in production are outside the engine.**
   - Every member request runs `searchFor`, which scans every member and, for each one, scans every interaction (`network.ts:2738-2779` through `pairHistory`/`metRecently`). That is O(N·I) per request, and 88% of ntwrk meetings come from requests.
   - `engineInput` filters all facets once per member (`network.ts:5857`): O(M·F).
   - `PgStore.save` diffs opportunity ids with `filter(... some(...))` (`store.ts:275-276`): O(O²) per save. It also writes the whole JSON state document per unit of work, which is O(state) per message and therefore O(N²) per day.
   - Each of these is a small change that keeps results identical (maps and sets in place of scans). The JSON-document store is the large one.

6. **Seeding a search from "members like me" does not cut checks in today's algorithm.** The search checks candidates in descending bound order. The number of checks equals the number of candidates whose bound beats the *final* k-th value, whatever order the candidates come in. So candidate transfer helps three things only:
   - the quality of budgeted results;
   - the reverse pass after an insertion;
   - pair-value sharing between the two sides of a pair (a symmetric memo, up to 2x fewer distinct checks).

   Exact reuse between two members needs identical value-relevant profiles. Tighter bounds (bucket summaries) are what cut checks.

7. **Proposed order of work:**
   1. Fix the quadratic production scans (S).
   2. Build the scaling and worst-case benchmark harness, gated on counts (S/M).
   3. Make ordinals, tag ids and index membership stable (M).
   4. Persist kept lists with versions, and repair them from a per-day diff, proved by a small `candidateCache` machine (M/L).
   5. Use a base+delta index (LSM / Bentley-Saxe) with a weekly full rebuild at the capacity reset, which also serves as the equality check (M).

---

## 1. How the system computes today (facts from the code)

| Step | Where | Cost per run | Notes for incremental work |
|---|---|---|---|
| Engine input assembly | `network.ts:5848-5893` `engineInput`, `5906-5935` `packInput` | O(M·F) because of line 5857 | Snapshot of the whole network each run |
| World construction | `engine/src/world.ts` constructor | O(N + I + P), except inviter roots O(N·depth) (`world.ts:341-353`) | Rebuilt per run |
| Profiles | `match/profile.ts:137-196` `buildProfiles` | O(N · pack extraction) + O(T log T) interning | Runs the pack's `memberships`, `tags`, `standing`, `traits`, `segment` for every member, every run |
| Ordinal | `profile.ts:185-186` | position in (block key, entity id) order | **Not stable under insertion.** Used as the tie-break in `RankedCandidate` and in the heap |
| Tag ids | `profile.ts:115-121` `internTags` | sorted distinct tags | **Not stable when a tag is added** |
| Index | `match/index.ts:59-79` | O(P log P) sort per block, postings O(total tags) | Postings hold *positions*, so one insertion shifts every later position |
| Search | `match/search.ts:120-212` | ≤ 600 checks and ≤ 8×600 touches per profile. A touch computes a full bound (`pairSideOf` twice, `search.ts:180-181`) | Memoized per run only (`run.ts:66-72`) |
| Edges | `search.ts:283-293` `mutualEdges` | O(E log E), E ≤ P·L | Either side kept |
| Circles | `match/circles.ts:53-134` | O(Σ deg²) triangles | Degree is unbounded (see section 6) |
| Selection | `engine/src/policy.ts` `selectProposals` | O(scored log scored) | Needs edges and capacities only |
| Standing history | `standing.ts`, passed through `input.memberStanding` and back (`network.ts:5443-5448`) | O(P) | **Precedent:** a private per-member engine cache already round-trips between runs |
| Persistence | `network/src/store.ts` `PgStore` | whole JSON document `network.network_state` per unit of work | No match state is persisted |

Measured cost per pair check, from the migration report (search time ÷ (profiles × checks per profile), on a loaded machine, so upper bounds):

| Lane | Per check |
|---|---|
| friends | 1,474 s / 47.2M ≈ **31 µs** |
| slop | 515 s / 43.8M ≈ **12 µs** |
| peon | 284 s / 26.5M ≈ **11 µs** |

Each figure includes the bound computed on every touch. The ntwrk Intro lane spends about 80 µs per profile with 0.9 checks, so most of its time goes to window and tag-range setup and touches, not to checks. **The benchmark must count bound evaluations (touches) separately from checks.**

---

## 2. Literature and systems: what each one gives us

### 2.1 Reverse nearest neighbour and reverse top-k

- **Korn and Muthukrishnan, "Influence sets based on reverse nearest neighbor queries", SIGMOD 2000, pp. 201-212, doi 10.1145/342009.335415** [opened: bibliographic record and abstract; https://dblp.uni-trier.de/rec/conf/sigmod/KornM00.html].
  - Idea: precompute, for each point, the radius of its nearest-neighbour ball. Then the points that would take `q` as a new nearest neighbour are exactly the points whose ball contains `q`.
  - **This is our invalidation rule.** Store each searcher's k-th value θ(a). A new `x` enters `K(a)` iff `v(a,x)` ranks above θ(a). The "reverse" query is "every `a` with `v(a,x) > θ(a)`".
  - Our "balls" are not geometric, so in place of their R-tree we use bucket bounds: a bucket summary U(x, B) ≥ v(x, b) for all b in B, together with the bucket's minimum θ.
- **Vlachou, Doulkeridis, Kotidis, Nørvåg, "Reverse top-k queries", ICDE 2010** [opened: listing and summary; PDF https://www.ds.unipi.gr/prof/cdoulk/papers/icde10.pdf]; extended version in IEEE TKDE 23(8), 2011.
  - Defines monochromatic and bichromatic reverse top-k.
  - Gives a **threshold-based algorithm** (RTA) for the bichromatic case. It prunes user preference vectors whose current top-k threshold the product cannot beat.
  - Proposes materialized reverse top-k views.
  - Our insertion step is the bichromatic case: our members are the "preference vectors", and their stored θ(a) are the thresholds.
- **Tao, Papadias, Lian, "Reverse kNN search in arbitrary dimensionality", VLDB 2004** [unverified]: the TPL pruning with bisectors. It does not transfer, because our value is not a metric.

### 2.2 Continuous kNN monitoring

- **Mouratidis, Hadjieleftheriou, Papadias, "Conceptual partitioning: an efficient method for continuous nearest neighbor monitoring", SIGMOD 2005, pp. 634-645, doi 10.1145/1066157.1066230** [opened: abstract and record; https://ink.library.smu.edu.sg/sis_research/875].
  - Lesson: *process an update only for the queries whose influence region contains it*, and organize the space so that region is cheap to find.
  - For us, the influence region of a new member `x` is (partner block) ∩ (standing window of `x`) ∩ (segments that reach `x`). That is already the window the forward search computes (`search.ts:52-70`), because the parity condition is symmetric and the window uses the uncertainty ceiling for the other side (`lawWindowComplete`).

### 2.3 Materialized top-k view maintenance

- **Yi, Yu, Yang, Xia, Chen, "Efficient maintenance of materialized top-k views", ICDE 2003, pp. 189-200** [opened: full text extracted from the authors' PDF, https://home.cse.ust.hk/~yike/topk/icde03.pdf].
  - Key facts from the paper: a top-k view is *not self-maintainable* under deletions. Deletions force an expensive "refill" query. The paper keeps a top-k′ view with k ≤ k′ ≤ k_max:
    - an insertion that enters the top-k′ raises k′ by one, up to k_max;
    - a deletion or update that leaves it lowers k′ by one;
    - a refill runs only when k′ < k.
  - The authors show that "in most practical cases" this brings the expected amortized refill cost to **O(1)** with a reasonably small k_max.
  - **We adopt this directly:** store the top `k_max = searchLimit + r` (for example r = 4 to 8). Refill (re-search) only when the stored list holds fewer than `searchLimit` entries.

### 2.4 Incremental inverted indexes: LSM and Lucene segments

- **O'Neil, Cheng, Gawlick, O'Neil, "The log-structured merge-tree (LSM-tree)", Acta Informatica 33:351-385, 1996** [opened: abstract; https://link.springer.com/article/10.1007/s002360050048]: defer and batch index changes from an in-memory component into larger sorted components.
- **Bentley and Saxe, "Decomposable searching problems I: static-to-dynamic transformation", J. Algorithms 1980** [opened: record; text https://www.ime.usp.br/~cris/aulas/19_1_6957/BentleyS1980-DSP.pdf, theorems not read]: the logarithmic method. Keep about log N static structures whose sizes double, and answer a decomposable query by combining the answers of each structure.
  - **Our exact top-k search is decomposable.** Run the bounded search on each sub-index, merge the kept lists, and take the max of the unseen bounds. The result is exact iff the merged k-th value beats every sub-index's unseen bound.
- **Lucene TieredMergePolicy**: segments of roughly equal size merge per tier; deletions are tombstones until a merge (McCandless, "Visualizing Lucene's segment merges", blog, 2011-02-11) [opened: search summary; https://blog.mikemccandless.com/2011/02/visualizing-lucenes-segment-merges.html]. The reported write amplification is about 13.6.
- **FreshDiskANN**: Singh, Subramanya, Krishnaswamy, Simhadri, arXiv:2105.09613 (2021) [opened: abstract].
  - Claims real-time inserts and deletes with >95% 5-recall@5 and a 5-10x lower cost of keeping the index fresh than periodic rebuilds.
  - The design (from memory, [unverified]): an in-memory temporary index plus lazy deletes, merged into the large index in the background.
  - The *pattern* (base + delta + tombstones + periodic merge) transfers. The approximate graph search does not (section 7).

### 2.5 Dynamic and online matching

- **Roth and Vande Vate, "Random paths to stability in two-sided matching", Econometrica 58(6):1475-1480, 1990** [opened: record; https://stanford.edu/~alroth/papers/1990_E_Random_Paths.pdf]. From any unstable matching, a finite sequence of blocking-pair resolutions reaches a stable one, and random resolution converges with probability one. Incremental entry of new agents is handled this way.
  - For us: the greedy b-matching on one symmetric value has a unique stable outcome (D-theory 4d). Selection costs only O(E log E) on the edges, so **we recompute selection from edges each run and do not maintain it incrementally.**
- **Bredereck, Chen, Knop, Luo, Niedermeier, "Adapting stable matchings to evolving preferences", AAAI 2020** [opened: search summary; https://ojs.aaai.org/index.php/AAAI/article/download/20413/20172]. Incremental stable marriage or roommates with a closeness-to-previous constraint is NP-hard in several variants. This is a reason *not* to require that a new matching stay close to the old one.
- **Akbarpour, Li, Oveis Gharan, "Thickness and information in dynamic matching markets", JPE 128(3):783-815, 2020, doi 10.1086/704761** [opened: record only; results not verified]. Agents arrive and leave at random, and the timing of matching interacts with market thickness. This supports keeping candidate edges fresh every day while running selection on a batch cadence. I did not verify the paper's specific results.

### 2.6 Incremental computation and event sourcing

- **McSherry, Murray, Isaacs, Isard, "Differential dataflow", CIDR 2013** [opened: record; https://www.microsoft.com/en-us/research/publication/differential-dataflow/]: incremental computation with nested iteration, through differences.
- **Hammer, Khoo, Hicks, Foster, "Adapton: composable, demand-driven incremental computation", PLDI 2014, pp. 156-166** [opened: record; https://cs.umd.edu/~hammer/adapton]: demand-driven recomputation over a dependency graph.
- We should **not** adopt either runtime. It would not be provable in Dafny, and it would add a dependency. We borrow two ideas:
  - **Explicit dependencies plus dirty sets.** Each cached result names the versions it read.
  - **Demand-driven repair.** A stale searcher is re-searched only when someone needs its list: it has capacity this week, it is in a request, or the weekly epoch arrives.
- **Event sourcing** [unverified as a citation, Fowler 2005; the pattern is standard]: an append-only `match_event` log of member and pair changes is the dirty set between runs.

### 2.7 Incremental kNN graphs and community detection

- **Dong, Charikar, Li, "Efficient k-nearest neighbor graph construction for generic similarity measures" (NN-Descent), WWW 2011, pp. 577-586** [opened: record; https://www.cs.princeton.edu/cass/papers/www11.pdf]. Rests on the heuristic "a neighbour of a neighbour is likely a neighbour". It typically reaches >90% recall while comparing each point to a few percent of the data. Secondary sources cite about O(n^1.14) comparisons [unverified].
  - It is approximate, so it is useful to us only for seeding and ordering (section 4.6), never as the source of truth.
- **Sahu, "A starting point for dynamic community detection with Leiden algorithm", arXiv:2405.11658 (2024)** [opened: search summary]: dynamic-frontier Leiden processes only the vertices that a batch of edge changes affects. The reported speedups over static Leiden are small (sources disagree, about 1.2x to 2x).
  - Our circles are rebuilt from a sparse edge set. Once degree is capped (section 6) that costs O(Σ deg²), so incremental community detection is not needed.
- **e-means**: Bessa, Mazaré, Szilvasy, Touvron, Picard, Douze, Jégou (Meta FAIR), arXiv:2611.09501, code in `faiss/contrib/e_means` [opened: https://e-means.github.io/].
  - Mini-batch k-means with exponential-moving-average sums and counts. Reported loss below Lloyd's 25-epoch result in 1.2 to 3 epochs.
  - The page frames it as clustering a static dataset. Assigning a new point to its nearest centroid is cheap.
  - Relevance to incremental work: cluster ids can serve as **bucket keys** for bound summaries (not as hard filters). Section 4.4 shows that unions and min/max summaries stay *sound* under insertion and deletion without re-clustering.

### 2.8 Benchmark methodology

- **ANN-Benchmarks**: Aumüller, Bernhardsson, Faithfull, Information Systems 2019/2020, doi 10.1016/j.is.2019.02.006, arXiv:1807.05614 [opened]. Standard datasets, many quality measures, and quality-against-throughput Pareto fronts across parameter settings.
  - We adopt the Pareto view: **exact share and unseen gap against checks**, as the budget varies.
- **Big-ANN NeurIPS'23 streaming track**: Simhadri, Aumüller, Ingber, Douze, et al., arXiv:2409.17424 [opened].
  - The index starts empty and runs a **runbook** of 1,280 batches in 5 rounds on 10M MS Turing vectors, with inserts, deletes and searches in a ratio of about 4:4:1. Limits were 8 GB of memory and 1 hour.
  - Recall is averaged over checkpoints, against ground truth = (inserted − deleted) at each checkpoint.
  - The paper records a **scoring error**: recall had been measured at the first snapshot only, because of a caching error. After the fix, Puck fell from 0.985 to 0.0921 and PyANNS won with 0.8865.
  - **Lesson for us:** the incremental equality test must recompute ground truth at every checkpoint and must never reuse a cached oracle.
- **Kalibera and Jones, "Rigorous benchmarking in reasonable time", ISMM 2013, doi 10.1145/2464157.2464160** [opened: record]: plan repetitions at the level where variance is, and report effect-size confidence intervals.
- **Instruction counts over wall time for regression gates**: rustc-perf uses `instructions:u` by default because it varies much less than wall time [opened: https://internals.rust-lang.org/t/what-is-perf-rust-lang-org-measuring-and-why-is-instructions-u-the-default/9815]. Our deterministic counters (checks, touches, bound evaluations) are better still: they do not vary at all for a seed.

---

## 3. The exact invalidation rule

### 3.1 What the pair value depends on

From `match/pair.ts:92-100` and `filters.ts:88-103`:

`v(a,b) = F(profile(a), profile(b), packDigest(a), packDigest(b), gate(a,b))`, where:

- `profile(·)` is the `MatchProfile`: tags, traits, standing, uncertainty, segment, lane, side and market.
- `packDigest(·)` is whatever `packValue` reads. For slop, `datePackValue` reads `SlopProfile` (`packs/slop/generators.ts:157-160`).
- `gate(a,b)` is everything `pairReason` reads:
  - member-level: minor status, known member;
  - pair-level: block, `recentPairs`, `activePairs`, declines, `pairInteractions`;
  - pack rules, including cooldowns and dealbreakers (`networkPack` rules);
  - the geo pair rule.

Precondition for any cache: **no pair rule may read global or time state other than through pair-level timestamps.** A cooldown reads `now`. That is allowed only if every rule exposes its next change time for the pair (an expiry), so the change can be scheduled as an event. Today no such contract exists. A pack rule that reads anything else must force a full rebuild for its lane. Section 4.7 gives the gate that enforces this.

### 3.2 Cached state per searcher profile `a` (one lane membership)

```
CachedSearch(a) = {
  version: int,          // a's profile + pack digest version that the search read
  kept: [(entity, value, tie)]  // best first, length k' with 0 <= k' <= kmax
  limit: int,            // laneLimits.searchLimit (L)
  kmax: int,             // L + r reserve (Yi et al. 2003)
  exact: bool,           // closeExact at search time
  unseenBound: int,      // certificate: anything not in kept has value <= unseenBound (exact: < worst kept)
  pendingBound: int,     // max bound of insertions that a budgeted reverse pass did not examine (starts -1)
  epoch: int             // index epoch (weekly full rebuild id)
}
θ(a) = value of the worst kept entry if k' >= kmax, else -1 (anything admissible enters)
```

Each kept entry also stores the candidate's version, so a stored edge is tied to both profile versions: `(a, va, b, vb, value, gateEpoch(a,b))`.

### 3.3 Events and their exact effect

Notation: `rank(v, t)` orders pairs by value descending, then by tie key (see 4.1); "beats" means "ranks above".

1. **Insert x** (join, resume from pause, hold lifted, capacity back, or the new version of an updated member):
   - Forward: `K(x) = search(x)` (≤ budget checks).
   - Reverse: for each `a` in `window(x) ∩ segmentReach(x)` (in the partner block), `x` enters `K(a)` iff `v(a,x) ≥ 0` and `rank(v(a,x), tie)` beats the worst kept entry, or `k'(a) < kmax`. The entry that falls off when `k' = kmax` is dropped.
   - Soundness: every other `b` keeps its rank relation to the members of `K(a)`, because values of other pairs did not change. The new top-k′ is therefore the old top-k′ plus `x` where it fits.
   - Reverse pruning: walk buckets `B` of the window, in descending order of the bucket bound `U(x,B)`. Skip `B` when `U(x,B) < θmin(B)`, where `θmin(B) = min over a in B of θ(a)` (rank-wise with ties). Skipping is sound because `U(x,B) ≥ v(a,x)` for every `a` in `B` (`lawBucketBoundSound`, D-theory 4c, G-architecture Addendum 1).
2. **Delete x** (leave, pause, hold, minor signal, ban, capacity exhausted — see 4.3), or the old version of an updated member:
   - For each `a` in `keptBy(x)` (the reverse edge index), remove `x` from `K(a)`, so `k'` falls by one. If `k'(a) < L`, mark `a` for refill (a full re-search).
   - Nobody else changes: deletion never makes another candidate better.
3. **Update x** = delete the old version, then insert the new version. The reverse pass and `keptBy` handle it.
   - Optimization (later): if only `x`'s standing moved by δ and nothing else, Lipschitz bounds on the parity penalty could limit the reverse pass. Not needed first.
4. **Pair gate closes for (a,b)** (block, decline, a meeting starts a cooldown): remove `b` from `K(a)` and `a` from `K(b)` if present, as in 2. Cost O(1) plus at most two refills.
5. **Pair gate opens for (a,b)** (cooldown expiry, block lifted): compute `v(a,b)` once (1 check). Offer it to `K(a)` and `K(b)` as in 1. These events are scheduled from the expiry time that each rule reports.
6. **Global change** (lane table, weights, floors, pack version, engine version, interner epoch, market list): new epoch, full rebuild.

### 3.4 Budgeted searches and the pending bound

If `a`'s last search was budgeted, `K(a)` is "best found" and anything missed is ≤ `unseenBound(a)`. The insertion and deletion rules above keep that statement true.

If the reverse pass for `x` is cut off by its own budget, it does **not** go through each remaining bucket's members. It raises a lazy bucket-level `pendingBound(B) := max(pendingBound(B), U(x,B))`. The certificate of `a` becomes `max(unseenBound(a), pendingBound(bucket(a)))`, so it is still sound. Repair is deferred:

- `a` is re-searched when its effective bound beats θ(a) and `a` needs a list (it has capacity, is in a request, or the weekly epoch arrives);
- or at the weekly rebuild.

This is the "honest reported bound" when the incremental path is not exact, in the same terms the search already uses.

### 3.5 Expected cost

Counting fact (not a citation): Σ_a |K(a)| = P·L. The average number of lists that hold a given member is L. So an insertion changes about L lists on average. Skew (hub members that many people rank highly) makes some insertions and deletions costly, which is why the per-event cost must be measured as a distribution.

Estimate, which **must be measured** before it is believed, for ntwrk-like lanes at 100k profiles with 1% daily churn (1,000 inserts or updates and 1,000 deletions a day):

- **Forward searches:** 1,000 × ≤ 600 checks.
- **Reverse passes:** 1,000 × (bucket bounds over the window plus checks in buckets that pass). With buckets of 64 and a Date window of about 50k members, that is about 800 bucket bounds plus maybe 50 to 200 checks.
- **Deletions:** 1,000 × L list edits. Refills are rare with r ≥ 4 (Yi et al.).
- **Total:** roughly 1 to 2 million pair checks plus about 1 million bucket bounds, against 26 to 47 million checks plus about 8× as many touch bounds for a full rebuild. That is **25 to 50x fewer**.
- A weekly epoch rebuild at the capacity reset keeps drift and summary looseness bounded, and doubles as the equality check (4.5).

### 3.6 A provable core: the proposed spec `candidateCache`

A small state machine, with the same invariant names in Quint and Dafny. It reuses `RankedCandidate` and `candidateRanksAbove` from `candidateSearch`.

```
state: { kept: List[RankedCandidate], limit: int, kmax: int, exact: bool, unseenBound: int, pendingBound: int, needsRefill: bool }
ghost (Quint only): feasible: Set[RankedCandidate]   // the current admissible partners with their values
events:
  restore(result)            // from a SearchResult; guard: result.kept.length <= kmax
  offerCandidate(c)          // insertion or a gate opening; ghost feasible += c
  withdrawCandidate(id)      // deletion or a gate closing; ghost feasible -= id
  raisePending(bound)        // a bucket that the reverse pass did not examine; ghost feasible may gain c with c.value <= bound
  markRefill                 // guard: kept.length < limit
rules:
  alwaysCacheWithinReserve       kept.length <= kmax, sorted, distinct
  alwaysCacheMatchesFeasibleTop  exact && pendingBound < worst kept ==> kept == top_{|kept|}(feasible)
  alwaysCacheBoundSound          every f in feasible \ kept: f ranks below worst kept, or f.value <= max(unseenBound, pendingBound)
  alwaysRefillWhenShort          kept.length < limit ==> needsRefill  (unless feasible is exhausted: unseenBound < 0)
  stepOfferNeverDropsBetter      an offer never removes an entry that ranks above the offered one
laws (library):
  lawReverseSkipSound   U >= v(a,x) for all a in B and U ranks below θmin(B)  ==>  offerCandidate(v(a,x)) leaves kept unchanged for every a in B
```

What stays outside the proof: the bucket summary arithmetic (already covered by `lawBucketBoundSound`), and the claim that `v` depends only on the declared inputs (a sim differential gate, 4.7).

---

## 4. Concrete design for our data structures

### 4.1 Stable identity: tie keys, ordinals and tag ids

- **Tie key.** Replace the positional `ordinal` as the *tie-break* with a stable integer.
  - Option A: an entity sequence number assigned once at first insertion and persisted. Simple, but early joiners win every tie.
  - Option B (recommended): `tie(a,b) = h(seed, pairKey(a,b))`, a 31-bit integer hash of the pair. It is the same for both sides, stable under insertion, and favours no one member. `network.ts` already uses `seededTie` for requests.
  - The `candidateSearch` machine keeps `ordinal` as the *identity* (distinct kept entries). It ranks by `(value desc, tie asc, ordinal asc)`.
- **Ordinal as identity.** Use a persisted integer surrogate per entity (a `bigint` sequence in Postgres). Positions in the sorted block become private to the index and are never stored in results.
- **Tag ids.** Use an append-only interner persisted per app (`match_tag(app, tag text, id int)`). A new tag gets the next id. Tag sets stay sorted by id, and nothing renumbers.
  - For lanes with a small fixed vocabulary (friends has about 42 activity tags), store a **bitset** (two 32-bit integers). `intersectCount` becomes popcount (`pair.ts:12-19`).
  - Equivalence with the sorted merge is a one-line Dafny lemma. Speedup: unmeasured; expect several times on the friends checks, which cost 31 µs today.

### 4.2 An index that accepts insertions: base + delta + tombstones

Per block (lane, side, market):

- **Base:** today's structure, immutable: sorted `(segment, standing, entityKey)`, postings of positions, plus **bucket summaries** every 64 positions. A summary holds the standing range, OR-masks or unions of offers, seeks and interests, the least `|seeks|` and `|interests|`, the trait ranges, and `θmin` with `pendingBound`.
- **Delta:** members inserted or updated since the last merge, at most D (for example ≤ 1,024 or ≤ √B). Kept sorted by standing in a small array with its own postings.
- **Tombstones:** a bitset over base positions for deleted or old versions.
- **Search** = the exact search on base (a tombstoned position counts as touched and is never checked) **plus** the exact search on delta, merged by the Bentley-Saxe rule. The search is exact iff the merged k-th value beats both unseen bounds.
- **Merge** when the delta exceeds D or tombstones exceed 10% of the block: rebuild the block in O(B log B). This is the LSM and Lucene pattern, and the FreshDiskANN pattern made exact.
- **Weekly epoch:** a full rebuild at the weekly capacity reset.
- Sortedness by standing: a standing change is a delete plus an insert. `nextStanding` moves at most 5 points a week (`memberStanding`), and only toward a changed target, so such events are few.

**Alternatives** (for the PR's "two other implementations"):

1. **B-tree or skip list per block** keyed `(segment, standing, entityKey)`, with posting lists as per-tag sorted sets keyed the same way. Every insertion is O(log B), but every posting becomes a pointer structure, and integer arrays and binary search are lost. More code to prove.
2. **Gapped sorted arrays** (packed memory arrays). Amortized O(log² B) insertion with positions kept dense. Clever, but brittle to prove.

The base+delta design keeps today's proved search unchanged and adds only a merge rule.

### 4.3 Capacity must not decide index membership

`buildProfiles` drops a membership whose capacity is ≤ 0 (`profile.ts:161-162`). Slop membership capacity is `weeklyCapacity - recentProactive` (`packs/slop/generators.ts:133-135`). So every member who uses up their week leaves every list that held them. Under incremental work, every selection then turns into L deletions, and the weekly reset into mass reinsertion.

Options:

- **(A) Keep every eligible profile in the index, and apply capacity only at selection.** Kept lists then contain members with no room. Raising `kmax` gives selection reserves to walk. Measure the share of kept slots that members with zero capacity hold.
- **(B) Treat "capacity used up" as a deletion during the week**, served by the `kmax` reserve, and run the weekly epoch rebuild at the reset.

I recommend (B) at first, because it keeps today's results identical, with (A) measured as an experiment. Either way, **searchers** with no capacity need no fresh list (demand-driven).

### 4.4 Bucket summaries stay sound under updates

- **Insertion into a summarized bucket:** union the OR-masks, take min/max, take min of θ. The summary stays a sound over-approximation.
- **Deletion:** leave the summary unchanged. It is still sound (looser, never tighter than the truth). Tighten it at merge or epoch.
- **θ(a) rises** (a better candidate entered `K(a)`): θmin(B) may stay stale-low. That is sound: a reverse pass checks more, never less. Recompute it lazily.
- **θ(a) falls** (deletion): θmin(B) must be lowered at once, in O(1) per deletion.

So the reverse-pass soundness proof needs only monotone summaries: a valuable property for a Dafny proof. Clustering such as e-means can choose the bucket *grouping* (members with similar tags in one bucket give tighter unions) without any effect on soundness.

### 4.5 Persistence in Postgres

Today the network state is one JSON document per network (`store.ts`, `network.network_state`). Kept lists at 100k members (about 2.1M entries) do not belong in that document: roughly 80 MB of JSON per save. New tables, keyed by integer surrogates:

| Table | Key | Columns | Rows at 100k members (130k–300k profiles) | Size (data + indexes, estimate) |
|---|---|---|---|---|
| `match_entity` | `(app, entity_key int8)` | entity text id, member id, lane, side, market, `version int4`, `digest bytea(8)` | 130k–300k | 15–40 MB |
| `match_profile` | `(app, entity_key)` | standing int2, uncertainty int2, segment int4, offers/seeks/interests int4[] or int8 bitsets, traits int4[], epoch int4 | same | 45–105 MB |
| `match_kept` | `(app, lane, searcher int8)` | `cand int8[]`, `value int2[]` (0..1000 fits int2), `cand_version int4[]`, `k_prime int2`, `exact bool`, `unseen int2`, `pending int2`, `searcher_version int4`, `epoch int4` | 130k–300k | 40–100 MB |
| `match_edge` (reverse index, `keptBy`) | `(app, lane, cand int8, searcher int8)` | `value int2` | P × kmax ≈ 2.1M–4.8M | 150–350 MB including the btree |
| `match_tag` | `(app, tag text)` | `id int4` | ~10^3–10^4 | < 1 MB |
| `match_event` | `seq bigserial` | app, kind int2, entity int8, pair (int8, int8) or null, version int4, `due_at` (gate expiries), at | 10^3–10^4 per day; truncated at the weekly epoch | small |

Notes:

- **Versioning.** A stored edge is valid iff `searcher_version` and `cand_version[i]` equal the current versions, and no `match_event` for the pair is newer than the row. The weekly epoch id ties everything to one engine version and config hash (`runLog.configHash`). Edges from an older epoch are ignored.
- **Process memory.** The service is long-lived, so it can keep the index in memory and write only the changed rows each run. On restart it rebuilds the index from `match_profile` (130k rows sorted in well under a second; unmeasured) and loads `match_kept`. The in-memory index is never persisted; only profiles, kept lists and events are.
- **Privacy.** Standing and values are private. These tables need the same row-level policies as `memberStanding` and `app.app_id`. A Clef-derived standing must never appear in an edge row that staff tools show.
- **What the weekly selection needs:** only `match_edge` (or `match_kept`) plus capacities and exposure debt. That is O(E log E) per run.

### 4.6 Caches that later stages reuse

| Cache | Key | Reused by | Exactness |
|---|---|---|---|
| Profile memo (the pack's extraction) | member id + digest of the member's input slice (facets, member record, presence, ratings) | every run; today `buildProfiles` calls the pack for every member every run | identical, provided the pack reads only that slice (gate 4.7) |
| Interned tag ids, bitsets | app | every check | identical |
| Per-member term constants (`|seeks|`, `|interests|`, window ends) | profile version | search and reverse pass | identical |
| Per-segment and per-bucket summaries | block, bucket | forward bounds (Date and Friend walk whole windows, so this is where checks fall) and reverse pruning | sound bounds |
| **Symmetric pair memo inside a run** | pairKey | when `a` computes `v(a,b)`, offer it to `b`'s cached list or pre-check set; `b`'s search then takes `a` without a new check | identical; up to 2x fewer distinct checks in Peers lanes (unmeasured) |
| Kept lists across runs | searcher version | daily repair (3.3) | exact or bounded |
| "Members like me" (same block, same own segment, near standing, high tag overlap) | profile | seeds for a new member's reverse pass; ordering for budgeted searches | heuristic only; never changes the certificate |

**Why candidate transfer ("similar people get similar matches") does not reduce checks by itself.** `searchCandidates` checks touched candidates in descending *bound* order and stops when the k-th kept value beats the highest remaining bound. So the set of checked candidates is exactly {bound > final θ} (plus ties). That set does not depend on the order, and seeding adds checks for seeds below θ.

Seeding helps in three cases:

- **(a)** When the *budget* binds: better candidates are found inside 600 checks, so budgeted lists improve and the unseen gap shrinks.
- **(b)** In the reverse pass: the `a`'s that kept people similar to `x` are the likely acceptors of `x`. Visit their buckets first, so an early-terminated reverse pass leaves smaller pending bounds.
- **(c)** Exact reuse when two profiles are identical in every value-relevant field (`profileDigest` equal, except identity and pair gate). Then one search serves both, with gate and tie keys applied per searcher. Measure how often this happens. In friends, with 42 tags and neighbourhood segments, I expect it to be rare.

The real lever on checks is tighter bounds (bucket summaries, bitsets), which other agents cover.

### 4.7 Gates that keep the cache honest (simulation, not unit tests)

1. **Differential runbook gate.** Planted world at N = 2k and 10k. A seeded runbook of R batches mixing joins, leaves, pauses, facet edits, standing steps, blocks, declines, cooldown expiries and capacity exhaustion. After each batch, compute the full rebuild **from scratch** (never cached; see the Big-ANN scoring error). Gate on all of these:
   - every exact incremental list equals the rebuild list;
   - every budgeted or pending certificate bounds every rebuild entry it misses;
   - the edge sets are equal where both are exact.
2. **Purity gate.** For a random sample of pairs, change the World *outside* the two members' input slices and the pair's gate state. Gate: `v(a,b)` is unchanged. This catches a pack rule that reads global or time state, which would make the cache silently wrong.
3. **Tie gate.** Count searches that close budgeted with θ == unseenBound. The guard `searchStopsExact` is strict (`c.value > unseenBound`, `core/src/generated/candidateSearch.ts:259-261`). Integer values tie often, and a tie at the bound can force a search to spend its budget even though no unseen candidate can *beat* the kept list.
   - If this count is material, consider "exact up to ties" (non-strict closing, with the oracle comparing value multisets plus the tie key rule). This is a spec change and needs product-owner acceptance.

---

## 5. Benchmarks so quadratic work never returns

### 5.1 Scaling harness (extend `scripts/sim/matching.ts` cost rows)

- **Sizes:** N ∈ {1k, 2k, 5k, 10k, 20k, 50k, 100k} for each pack's primary lane, plus every lane up to 10k. Planted worlds with pinned seeds (`plantedEngineInput`).
- **Per run, record:**
  - checks and touches;
  - bound evaluations (new counter);
  - posting entries visited;
  - exact share;
  - unseen gap (unseenBound − θ) at the median and p99 for budgeted searches;
  - budgeted with θ == unseen (tie count);
  - profile-build time and index-build time separate from search time;
  - heap bytes after a forced GC, per profile;
  - wall time.
- **Two arms:**
  1. **Shipped budget.** Gives cost and quality as shipped.
  2. **Unbounded budget at N ≤ 20k, sampled to 1,000 searchers at 50k and 100k.** Gives *work-to-exactness*, the honest quadratic detector.
- **Slope gate:** least-squares slope of log(total work-to-exactness) against log(N) over the sizes.
  - Gate total slope ≤ 1.2 per lane. Target: per-profile slope near 0, total near 1.
  - Track the shipped-budget exact share at 100k with a floor that only ratchets upward.
  - Today Intro is about 1.0; Date, Friend and Hire are about 1.5 to 1.7 (section 0). So the gate starts as *tracked* with today's values, and becomes blocking at each lane's measured value minus a margin as work lands.
- Replace the tracked "share of all pairs falls with N" (`matching.ts:444-447`). It is satisfied by the budget alone.

### 5.2 Incremental-insert benchmark

- Base index at 100k. Add 1, 10, 100 and 1,000 members; delete the same counts; then a mixed batch.
- **Report:** checks, touches, bucket bounds and wall time per event (median, p99, max), against a full rebuild. Also the in-degree distribution (`keptBy` sizes) and refill count, with r ∈ {0, 2, 4, 8}.
- **Gates:**
  - equality with a from-scratch rebuild at 10k, all searchers;
  - equality at 100k on a sample of 1,000 searchers plus every searcher the events touched;
  - mean cost per insert ≤ 2 × the forward search budget (counts).
- Runbook style follows the Big-ANN streaming track.

### 5.3 Memory benchmark

- Bytes per profile for the index (base, delta, summaries), kept lists and the pair memo, at each N.
- Gate on slope ≤ 1.05 (linear) and on bytes per profile below a ratcheted ceiling.

### 5.4 Worst-case worlds (planted, adversarial)

| ID | World | Stresses |
|---|---|---|
| W1 | One segment, one standing, maximum uncertainty | Window = whole block |
| W2 | One tag held by everyone, identical tag sets | Postings do not narrow; every value ties |
| W3 | Values engineered to tie at the k-th place | The strict `closeExact` |
| W4 | One hub member that everyone ranks first | `keptBy` size N; circles Σdeg²; deletion of the hub |
| W5 | Standings packed at the window edges, uncertainty at the ceiling | Window arithmetic |
| W6 | Many segments, every partner list all-to-all | `windowSpans` loops over all block segments, O(S) per search (`search.ts:58`) |
| W7 | Massive churn | 10% of members change in one batch: incremental must fall back to a rebuild when it is cheaper |

Gates for each world: every safety invariant 0, the certificate sound, and checks and touches within budget. Each world reports its own cost row and has no quality gate.

### 5.5 Noise control and CI placement

- **Gate on counts only:** checks, touches, bound evaluations, refills and bytes. They are deterministic for a seed. Wall time is *tracked*, with repetitions and a confidence interval (Kalibera and Jones).
- On a Linux CI runner, optional instruction counts under cachegrind (the rustc-perf practice). Never gate on wall time on the shared machine.
- Simulation *outcome* noise is large: a neutral tie-break moved pooled meetings from 174 to 132 over three seeds. Cost gates must never be mixed with outcome gates. Outcome comparisons need paired seeds and a significance test.
- **Placement:**
  - Per PR, `--quick`: N ≤ 10k, counts only, the differential runbook at 2k. A few seconds to a minute.
  - Nightly: up to 100k, both arms, worst-case worlds, the 100k incremental benchmark.
  - Weekly: memory slopes and the full runbook.
- The repository rule allows only one full `bun run sim` per agent, so the 100k rows belong in the nightly job, not in `bun run sim`.

---

## 6. Places where work can be quadratic in members (production code, not the simulator)

| # | File:line | What | Bound today | Fix (result identical unless noted) |
|---|---|---|---|---|
| 1 | `packages/network/src/network.ts:2738-2779` (`searchFor` → `pairHistory` → `metRecently`) | For each request: loop over all members; for each one, `this.interactions.some(...)` over all interactions | **O(N·I) per request**; requests per day grow with N, so O(N²·I/N) per day or worse. This path makes 88% of ntwrk meetings | Keep `Map<pairKey, lastMetAt>` updated when an interaction is written (the World already has `pairInteractions`). Index candidates by tag; a request should use the lane index (quality work elsewhere) |
| 2 | `network.ts:2736` | Load map over all opportunities per request | O(O) per request | Keep a per-member weekly request load counter |
| 3 | `network.ts:5857` (`engineInput`) | `facets.filter(f => f.memberId === m.id)` inside a loop over members | **O(M·F) per run** | Group facets by member once |
| 4 | `network.ts:3415-3417` (`evidence`) | Facets filter, all opportunities filter and presence filter per call; called per participant per opportunity (`1452`, `3366`, `3666`, `4271`) | O(F+O+P) per call, so O(O·(F+O)) per tick when many opportunities are evaluated | Per-tick indexes by member |
| 5 | `network.ts:2197-2199` (`metBefore`), `2307` (`counterparts`), `4276` (`bookedNear`), `4286` (`lastParticipation`), `1413`, `2012` | Scan all opportunities or interactions per call | O(O) or O(I) per call; quadratic per day when called per member or per message | Per-member opportunity index |
| 6 | `network.ts:1655-1680`, `3812` (member removal and `dropMember`) | Scan all members, cases, deferred messages, declines, interactions | O(state) per removal; quadratic per day under churn that grows with N | Per-member reverse indexes; batch removals |
| 7 | `packages/network/src/store.ts:275-276` | `ids(prev).filter(x => !state.opps.some(o => o.id === x))`, and the same for requests | **O(O_prev · O) per save** | `Set` of current ids |
| 8 | `store.ts:267-300` and the whole-document design | Load and save the whole JSON state, rewrite every participation of every opportunity, per unit of work | **O(state) per message, so O(N²) per day** | Move hot collections (opportunities, participations, interactions, match tables) to row tables with per-row writes. Effort L |
| 9 | `packages/engine/src/world.ts:341-353` | Walk to the inviter root per member, with no memo across members | O(N·depth); quadratic for a long invite chain | Memoize roots (path compression), keeping the minor and cycle stops |
| 10 | `packages/engine/src/match/circles.ts:69-77` | Triangle seeds: for each x, each pair of x's links | O(Σ deg²). Degree = out (L) + in (unbounded: `mutualEdges` keeps an edge when *either* side kept it); a hub with in-degree D costs D² | Cap in-edges per member to the top kmax by (value, tie) before building circles. Changes results only for hubs; measure the effect on planted ARI |
| 11 | `circles.ts:98-127` | Growth: each seed scans the links of `group[0]` and sorts options | O(#seeds · deg · size) | Bounded by the cap in 10 |
| 12 | `match/search.ts:58-69` (`windowSpans`) | Loop over every segment of the block per search | O(S) per search, so O(P·S) per run; S = slop pools × cells | Map from segment to span; iterate the searcher's partner list when it is shorter |
| 13 | `match/search.ts:171-185` (`visit`) | One full bound (two `pairSideOf` with tag merges) per touch, up to 8 × 600 per search | Linear, with a large constant (≈ 8× checks) | Bucket summaries; bitsets; count bound evaluations |
| 14 | `match/run.ts:42-52` plus `network.ts:5378-5398` | Full rebuild of profiles, index and all searches per run, up to twice a day | O(P · budget) per run (linear, about 600 × P worst case) | Sections 3 and 4 |
| 15 | `packages/network/service/monthly-gathering-grouping.ts:61-80` | Per seed: filter over the whole roster, then all pairs of peers | O(R² + R·d²) per gathering | Bounded by the roster; fine at gathering sizes; note it if rosters grow |
| 16 | `packages/engine/src/group.ts:61-71` (`scorePoolPairs`) | All pairs in a pool | O(pool²), pool ≤ `pcfg.poolSize` (`plans.ts:354`) | Bounded |
| 17 | `packs/network/generators.ts:170`, `filters.ts:238,284`, `policy.ts:122`, `scoring.ts:68`, `world.ts:175,208`, `judgeDeep.ts:96`, `judgeContext.ts:168,342`, `friends/generators.ts:42`, `friends/planner.ts:477` | Pairs inside one candidate, group, event pool (≤ 6) or interaction | O(group²), with group ≤ 6 | Bounded |
| 18 | `plans.ts:782` (`detectCrews`) | i < j over plan outcomes per activity | O(H²) per activity; H is windowed (`friends/planner.ts:374`, `network.ts:4931`) | Bounded by the window |
| 19 | `policy.ts:162` | Copy each member's window array on every reservation | O(k²) per member, k ≤ capacity | Bounded |
| 20 | `packs/slop/clef-fit/fit.ts:435` | All pairs of training ids | O(n²); an offline fitting tool | Offline only; keep it out of the service |

---

## 7. What will NOT work for us, and why

1. **Approximate streaming ANN indexes (FreshDiskANN, HNSW, NN-Descent) as the source of candidates.**
   - They report recall below 100% with no per-query certificate: FreshDiskANN >95% 5-recall@5; the corrected Big-ANN streaming winner averaged 0.8865 recall; jevector measured 37-88% top-5 recall at 1,024 profiles (D-theory 4c).
   - Our proofs need exact results or a sound bound.
   - Our value is not a metric: a harmonic mean, floors, a parity band, an exchange balance, and gates.
   - Use them only for ordering and seeding.
2. **Adopting differential dataflow or Adapton as a runtime.** Not provable in Dafny. Adds a large dependency for a dirty set that the rule in 3.3 already describes in about 50 lines.
3. **Incremental selection (keeping last week's matching stable or close).** Selection on the edges is cheap (O(E log E)). Closeness-constrained incremental stable matching is NP-hard in several variants (Bredereck et al. 2020). The greedy outcome on one symmetric value is unique, so recomputing it is the stable answer.
4. **Incremental community detection for circles.** The circle builder runs on a sparse, capped edge set. Dynamic Leiden reports only about 1.2-2x over static on large graphs.
5. **Reusing a neighbour's kept list as a shortcut to exactness** ("similar people get similar matches"). This holds only for identical value-relevant profiles. Otherwise it gives no certificate, and in the bound-ordered search it does not reduce checks (section 4.6).
6. **Positional ordinals and sorted interner ids under incremental updates.** One insertion renumbers everything, and ties change winners without any value change. These must go before any cache.
7. **Gating on wall time on the shared machine,** or on capped check counts. The first is noise. The second hides quadratic growth as lost exactness.
8. **Keeping match state inside the single JSON network document.** About 80 MB per save at 100k members, written on every unit of work.
9. **A k_max reserve alone, with no refill path.** Yi et al. show that a top-k view is not self-maintainable under deletions; some refills are unavoidable. The reserve only makes them rare.

---

## 8. Open questions

1. Does every pack pair rule depend only on the two members and pair-level timestamps, and can each one report the next time its answer changes for a pair? (Precondition for 3.1; check with the purity gate.)
2. Which capacity semantics do we want: a profile disappears when its week is used up (B, today), or capacity is applied only at selection (A)? (A) changes results.
3. Is "exact up to ties" (non-strict close) acceptable to the product owner? It would let many budgeted Date and Friend searches close exact if ties at the bound are common. First measure the θ == unseen count.
4. Tie key: a seeded pair hash (fair) or an entity sequence (simple, but early joiners win ties)?
5. Can the service keep the match index in process memory between ticks (long-lived process), or must every tick reload it from Postgres?
6. What is the real daily churn (joins, leaves, facet edits, standing steps) per app? It decides whether daily incremental repair or a nightly rebuild with a cheaper search is the better trade at our size.
7. How skewed is in-degree (`keptBy`) in the slop and friends planted worlds? Hubs decide the p99 cost of a deletion and the size of the circle triangle set.

---

## Sources

- Korn and Muthukrishnan, SIGMOD 2000: https://dblp.uni-trier.de/rec/conf/sigmod/KornM00.html
- Vlachou, Doulkeridis, Kotidis, Nørvåg, ICDE 2010: https://www.ds.unipi.gr/prof/cdoulk/papers/icde10.pdf
- Yi, Yu, Yang, Xia, Chen, ICDE 2003: https://home.cse.ust.hk/~yike/topk/icde03.pdf
- Mouratidis, Hadjieleftheriou, Papadias, SIGMOD 2005: https://ink.library.smu.edu.sg/sis_research/875
- O'Neil et al., Acta Informatica 1996: https://link.springer.com/article/10.1007/s002360050048
- Bentley and Saxe, J. Algorithms 1980: https://www.ime.usp.br/~cris/aulas/19_1_6957/BentleyS1980-DSP.pdf
- McCandless, Lucene segment merges, 2011: https://blog.mikemccandless.com/2011/02/visualizing-lucenes-segment-merges.html
- Singh et al., FreshDiskANN, arXiv:2105.09613: https://arxiv.org/abs/2105.09613
- Simhadri et al., Big-ANN NeurIPS'23, arXiv:2409.17424: https://arxiv.org/html/2409.17424v1
- Aumüller, Bernhardsson, Faithfull, ANN-Benchmarks, arXiv:1807.05614: https://arxiv.org/abs/1807.05614
- Roth and Vande Vate, Econometrica 1990: https://stanford.edu/~alroth/papers/1990_E_Random_Paths.pdf
- Bredereck et al., AAAI 2020: https://ojs.aaai.org/index.php/AAAI/article/download/20413/20172
- Akbarpour, Li, Oveis Gharan, JPE 2020: https://ideas.repec.org/a/ucp/jpolec/doi10.1086-704761.html
- McSherry et al., Differential dataflow, CIDR 2013: https://www.microsoft.com/en-us/research/publication/differential-dataflow/
- Hammer et al., Adapton, PLDI 2014: https://cs.umd.edu/~hammer/adapton
- Dong, Charikar, Li, NN-Descent, WWW 2011: https://www.cs.princeton.edu/cass/papers/www11.pdf
- Sahu, dynamic Leiden, arXiv:2405.11658: https://arxiv.org/html/2405.11658v1
- e-means: https://e-means.github.io/
- Kalibera and Jones, ISMM 2013: https://kar.kent.ac.uk/id/document/3127886
- rustc-perf instruction counts: https://internals.rust-lang.org/t/what-is-perf-rust-lang-org-measuring-and-why-is-instructions-u-the-default/9815
