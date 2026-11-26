# R2. Graphs, small worlds and neighbour-of-neighbour search for The Network's matching engine

Research agent R2, 2026-11-17. Read-only on the repository. Code read at `/Users/nubs/thenetwork-matching` (commit 3f0f8586): `packages/engine/src/match/{search,index,pair,profile,run,circles}.ts`, `packages/engine/src/packs/slop/{generators,score}.ts`, `packages/engine/src/packs/friends/vectors.ts`, `packages/network/src/network.ts` (`searchFor`), `spec/candidateSearch.md`, plus the G-architecture and D-theory notes and `docs/results/2026-11-17-matching-engine-migration.md`. No simulation, test, type check, Quint or Dafny was run.

Citation key: **[opened]** = I opened the abstract page or a primary page in this session. **[search]** = details come from a search-result summary of the primary source, not from the full text. **[unverified]** = recalled from memory and not opened in this session.

---

## 0. Summary (the short version)

1. **Graph ANN cannot give us an exactness proof or an honest bound.** Our score is a reciprocal, non-metric value with hard feasibility (segments, standing band, floors, balance). Greedy graph search on any sparse graph can miss the true top-k. This is proved in the worst case: HNSW, NSG and fast-build DiskANN need linear time on constructed instances (Indyk and Xu, NeurIPS 2023), and no sparse graph is navigable for arbitrary point sets in high dimension (degree lower bound about n^{1/2}; Diwan et al., NeurIPS 2024). Under filters, graph methods fail at low selectivity (SIGMOD 2026 experimental study). A graph can only **order** or **seed** our existing exact, bound-based walk. Then the existing proof is unchanged.
2. **A key negative result for seeding.** Our search already checks candidates in decreasing upper-bound order (a best-first, Threshold-Algorithm walk). When the search closes Exact, the set of candidates it checks is the set whose bound is above the final k-th value, whatever the seed order. So **seeding can reduce posting touches but cannot reduce pair checks in exact mode**. Seeds help in two places only: (a) budgeted searches, where they raise the quality of the kept list within the same budget, and (b) the touch walk, where an early high k-th value lets the stop rule fire before the window walk ends. The slow lanes (Date, Friend) stay budgeted because the **untouched bound** stays high (a Date partner with no shared tag still has a bound of 375, above the 350 floor), not because the walk visits candidates in a bad order. The lever for exactness is a **tighter bound on untouched members**, not a better order.
3. **Graph structure gives two sound, tighter bounds that we do not use yet.** (i) **Reverse kept caps**: the pair value is symmetric (`lawPairValueSymmetric`), so when b's search closed with a full kept list that does not contain a, then value(a,b) ≤ the worst value b kept (Exact), or ≤ max(worst kept, b's reported unseen bound) (Budgeted). This cap is a sound upper bound on a's untouched and pending candidates. (ii) **Block-max buckets on a locality order**: when the members inside a standing value are ordered by a cluster or graph order (Hilbert curve on home position, energy and schedule for friends; pool, cell and preference tags for dating), fixed-size buckets have narrow trait ranges and small tag unions. Then per-bucket bounds (Block-Max WAND, Ding and Suel 2011) close searches that the current posting walk cannot close. Clustering (k-means, e-means) is useful only to produce that order. It must never be a hard block, because that breaks window completeness.
4. **The user's idea ("if two people are similar they match similar others") is neighbourhood collaborative filtering on the reciprocal graph.** Stated formally, for a member a: candidates(a) = kept(twins(a)), where twins(a) = same-pool, same-side members that the same partners kept (a 3-hop walk a → b → a' → b'). In bipartite structures (straight dating, Hire, Mentor, Invest), plain NN-Descent local joins pair two members on the **same** side, so they produce only "no pair". The join must be the 3-hop bipartite join. As a **seed source** it is cheap (≤ k³ touches before deduplication, usually much less) and safe for exactness. As a **quality signal** (a pack term built on mutual positive OUTCOMES, not on likes), it is what the dating literature found strongest. Collaborative filtering beat global and content methods (Brožovský and Petříček 2007; Xia, Liu, Sun, Chen 2015). But it needs outcome data we do not have at launch, and it can spread the desirability hierarchy (Bruch and Newman 2018).
5. **Circles depend on triangles that the kept graph often does not contain.** `buildCircles` sees only kept edges (top 12 per Friend member). A wedge b–a–c in which b and c fit each other forms a circle only if b or c happened to keep the other. Triadic and focal closure (Kossinets and Watts 2006) say that wedges closed by a shared focus are the strongest predictor of a tie. A bounded **wedge-closing pass** (≤ k(k−1)/2 = 66 extra checks per Friend member, 66 per Intro member) adds the missing third edges before circles grow. This should raise circle formation without touching the search proof.
6. **The n² risk today is outside the engine.** `searchFor` in `packages/network/src/network.ts` (88% of ntwrk meetings) loops over every member for every request and uses float scores. That is O(N) per request and O(N²) when everyone asks. Route requests through the lane index as a one-sided posting query, and add a warm-path (two-hop) signal where the requester has history.
7. **Libraries.** hnswlib-node, usearch, faiss bindings, pgvector HNSW and Cloudflare Vectorize all use float distances, approximate search and (for multi-threaded builds) non-deterministic graphs. None takes our integer reciprocal score with an exactness certificate. Vectorize caps topK at 100 (50 with metadata). **Build the small structures ourselves in TypeScript.** These are a kept-graph store, seeded wedge and 3-hop joins, and bucket summaries. Do not adopt an external ANN index in the decision path.

---

## 1. Where the cost and the misses come from today (our measurements, re-read)

From `search.ts`:

- A search runs inside one partner block (lane, partner side, market). The block is sorted by (segment, standing, ordinal). The window is the set of spans of each reachable segment whose standing is in the parity window. The window is complete by `lawWindowComplete`.
- **Touches** visit posting entries (offers, seeks, interests) inside the window, rarest tag first. When a posting is at least as long as the window, the walk visits the whole window in **position order**. Position order is standing order, then ordinal, so it is arbitrary with respect to value. Each touch computes a near-exact bound (the exact pair arithmetic with the pack term at 1000). The touch limit is `searchTouchesPerCheck × budget = 8 × 600 = 4,800` entries.
- **Checks** pop the touched candidate with the highest bound and compute the exact `pairValueOf`. That call runs the pack value (for slop, `datePackValue`: an `exp`-heavy float model, rounded) and the pair gate.
- The **untouched bound** covers every window member that has not been touched. With no open tag group left, an untouched member still has full closeness and full pack. For **Date** (weights complement 3, affinity 2, closeness 0, pack 3, floor 350), an untouched member with no shared tag has bound 3·1000/8 = **375**. That is above the floor, so the search can close Exact only when the 10th kept value is above 375, **and** every pending candidate's bound is below it. Common Date tags (`drinking:*`, `goal:*`, `smoking:*`) have postings as long as the window, so the walk falls back to the whole window. Window: band 15 + own uncertainty + the uncertainty ceiling 20, so up to ±55 standing points of a 0..100 scale. A member without a usable photo rating sits at 50 with the widest uncertainty, so that window is most of the segment.
- **Friend** has standing fixed at the middle (window = whole reachable segment), closeness on home position (50 per km), weekend lean and energy, and about 42 activity tags each held by about 19% of members. The untouched bound keeps closeness at 1000, so the bound stays high until the window is walked.

So at 100,000 members, Date and Friend searches spend the touch limit walking the window in position order. Then they check the best of what they touched, and report a large unseen bound (31% and 22% exact). **Two different faults are mixed here:**

| Fault | Effect | What fixes it |
|---|---|---|
| A. The untouched bound is loose (closeness and pack at full, tag-free lanes) | The search can never certify without touching the whole window | Tighter bounds: per-bucket summaries on a locality order, reverse kept caps, a pack bound hook |
| B. The touch order inside the window is arbitrary | A budgeted search keeps the best of an arbitrary 4,800, not of the likely best | Seeding and ordering: graph seeds, cluster order |

Graph methods address B directly and help A only through the order they give to buckets (Section 4) and through kept caps (Section 3.3).

---

## 2. Survey: graph-based nearest-neighbour search

### 2.1 Navigable small-world graphs

- **NSW and HNSW.** Malkov and Yashunin, "Efficient and robust approximate nearest neighbor search using Hierarchical Navigable Small World graphs", arXiv:1603.09320 (2016, v4 2018) **[opened]**. The journal version is *IEEE TPAMI* 42(4), 2020 **[unverified]**. The graph is built incrementally by inserting points one at a time; the abstract claims logarithmic complexity scaling. Layers are assigned by an exponentially decaying random level, so the build depends on an RNG and on insertion order. Deletion is not in the paper. hnswlib implements it as "mark deleted" plus optional replacement **[unverified]**. In the original paper and on ann-benchmarks, HNSW reaches recall above 0.9 at high throughput on SIFT and GloVe **[unverified numbers; ann-benchmarks.com lists hnswlib, NGT, glass, pynndescent, vamana(diskann), pgvector, qdrant, weaviate among 38 algorithms on 10 datasets, opened, but the plots were not readable]**.
- **NSG.** Fu, Xiang, Wang, Cai, "Fast approximate nearest neighbor search with the Navigating Spreading-out Graph", arXiv:1707.00143 **[opened]**. VLDB 2019 **[unverified]**. NSG approximates the Monotonic Relative Neighbourhood Graph, which the authors say has "close to logarithmic" search complexity.
- **Vamana and DiskANN.** Subramanya et al., "DiskANN: Fast accurate billion-point nearest neighbor search on a single node", NeurIPS 2019 **[search]**. More than 5,000 QPS, under 3 ms mean latency and 95%+ 1-recall@1 on SIFT1B, on a 16-core machine with 64 GB RAM and an SSD. Vamana graphs have a smaller diameter than NSG and HNSW.
- **FreshDiskANN.** Singh, Subramanya, Krishnaswamy, Simhadri, arXiv:2105.09613 (2021) **[opened]**. Thousands of concurrent inserts, deletes and searches per second on one workstation, above 95% 5-recall@5 under updates, and a 5 to 10 times lower cost to keep the index fresh than periodic rebuilds.
- **k-NN graph construction by NN-Descent.** Dong, Charikar, Li, "Efficient k-nearest neighbor graph construction for generic similarity measures", WWW 2011, pp. 577–586 **[search]**. The principle: "a neighbour of a neighbour is likely a neighbour". The method works with any similarity function. Abstract-level claims: usually above 90% recall, each point compared with a few percent of the data set, and an empirical cost of about O(n^1.14) **[search; the exponent comes from a secondary source]**. Baron and Darling, "K-nearest neighbor approximation via the friend-of-a-friend principle", arXiv:1908.07645 **[opened]**: run times fit O(n K² log n) on a test case. They prove that cost for a range-query variant on a Poisson process. They also show that the basic algorithm "fails to achieve subquadratic complexity" when the similarity ranking is a generic order on a metric space. **EFANNA** (Fu and Cai 2016) and **KGraph** (Dong) are NN-Descent derivatives that use the graph also for search **[unverified]**.
- **Maximum inner product and non-metric graphs.** Morozov and Babenko, "Non-metric similarity graphs for maximum inner product search", NeurIPS 2018 (ip-NSW) **[search]**: similarity graphs work directly on inner product, without a reduction to a metric. **Asymmetric and cross-modal retrieval.** Chen, Zhang, He, Jing, Wang, "RoarGraph: a projected bipartite graph for efficient cross-modal ANN search", PVLDB 17 (2024) p. 2735, arXiv:2408.08933 **[search]**. Queries come from a different distribution than the base (text against images). RoarGraph builds a **bipartite query–base graph and projects it onto the base**: two base points become neighbours when the same queries want them. It is up to 3.56 times faster at 90% recall for out-of-distribution queries. This is the same construction as "two candidates are neighbours when the same employers keep them", which is collaborative filtering (Section 5).

### 2.2 Filtered (hybrid) graph search

- **Filtered-DiskANN.** Gollapudi et al., WWW 2023, pp. 3406–3416 **[search]**. Filtered-Vamana and Stitched-Vamana: label-aware edges, so each label's subgraph stays navigable. It supports one exact-match label per query.
- **ACORN.** Patel, Kraft, Guestrin, Zaharia, arXiv:2403.04871 **[opened]**. SIGMOD 2024 **[unverified]**. Predicate-agnostic "predicate subgraph traversal" on a denser HNSW with neighbour-of-neighbour expansion. 2 to 1,000 times higher throughput at fixed recall than earlier methods.
- **Weaviate's ACORN** (blog, opened): two-hop expansion only when a first-hop neighbour fails the filter, plus filter-matching entry points on the base layer. Below a `flatSearchCutoff` it uses brute force over the filtered set. At 50% selectivity plain "sweeping" is faster. At 20% sweeping drops to about half of ACORN's throughput. With very low filter–query correlation ACORN is about 10 times faster.
- **Lucene and Elasticsearch ACORN-1** (Elastic blog, search): it is used only when at least 40% of vectors are filtered out, and the extended exploration is bounded.
- **Qdrant** (docs, search): extra HNSW edges between points that share an indexed payload value. A query planner chooses graph, graph+ACORN, payload index or a full scan by estimated filter cardinality (`full_scan_threshold`).
- **pgvector** (README, opened): filtering is applied after the HNSW scan. "If a condition matches 10% of rows, with HNSW and the default hnsw.ef_search of 40, only 4 rows will match on average." Iterative index scans (0.8.0) continue up to `hnsw.max_scan_tuples` (default 20,000), in `strict_order` or `relaxed_order`. The README recommends partial indexes or partitioning for filters, and exact scans for perfect recall.
- **Experimental study.** Li, Yan, Lu, Zhang, Cheng, Ma, "Attribute filtering in approximate nearest neighbor search: an in-depth experimental study", arXiv:2508.16263, SIGMOD 2026 **[opened]**. Ten algorithms, four data sets up to 10M, selectivity 0.1% to 100%, at 90% recall@10:
  - HNSW-based methods (Faiss-HNSW, ACORN) fail at 0.1% selectivity because monotone greedy search limits exploration.
  - Label methods are unstable (NHQ degrades below 1%).
  - Segmented-edge methods collapse when construction finds no valid neighbours.
  - More entry points always reduce comparisons.
  - The guideline: below 1% selectivity, direct scans of partitioned subsets win (Milvus-HNSW).
  - UNG ("unified navigating graph", label-containment graph, Cai, Shi, Chen, Zheng) **[search]** is a further label-filter design.

**What this means for us.** Our hard filters (lane, side, market, segment, standing window) are exactly the kind of high-selectivity filter for which the literature recommends **partitioning plus a direct scan**, not filtered graph traversal. Our blocks are those partitions. Inside a block the remaining filters (pair gate: blocks, cooldowns, minors) fail rarely, so they cost little either way.

### 2.3 Worst-case theory: why there is no honest graph bound

- **Indyk and Xu**, "Worst-case performance of popular approximate nearest neighbor search implementations: guarantees and limitations", NeurIPS 2023, arXiv:2310.19126 **[search]**.
  - DiskANN with *slow* preprocessing provably answers constant-approximation queries in polylogarithmic time on data of bounded intrinsic (doubling) dimension.
  - For fast-preprocessing DiskANN, HNSW and NSG, they build instances on which the query needs time linear in n to reach reasonable accuracy. In one example DiskANN takes at least 0.1·n steps before it meets any of the 5 nearest neighbours.
- **Diwan, Gou, Musco, Musco, Suel**, "Navigable graphs for high-dimensional nearest neighbor search: constructions and limits", NeurIPS 2024, arXiv:2405.18680 **[search]**.
  - For any n points and **any distance function, even a non-metric one**, a graph of average degree O(√(n log n)) is navigable: greedy routing reaches every target. The construction is the union of a √(n log n)-NN graph and a random graph.
  - A matching lower bound: random points in O(log n) dimensions have no navigable graph of average degree O(n^α) for α < 1/2.
- **Kleinberg**, "Navigation in a small world", *Nature* 406:845 (2000) **[search]**. On a lattice with long-range links whose probability falls as distance^(−α), decentralized greedy search takes polylogarithmic time only at α equal to the dimension. Uniform random shortcuts (Watts–Strogatz style) give short paths that greedy search **cannot find**.

**Consequence.** Greedy or beam search on any sparse graph over our members, under our value, carries no certificate. It can stop in a local optimum. With feasibility filters, the feasible region (a segment pair, a standing window) can be disconnected in the graph. A member with no feasible neighbour in the graph gets nothing. What we can claim from a graph-only search is **measured recall against brute force on sampled queries**, with a confidence interval. That is weaker than what `candidateSearch` proves today. **Therefore graphs must never replace the bound-based stop rule. They can only feed it.**

---

## 3. Our score under a graph lens: what is allowed and what is proved

### 3.1 Properties our pair value has and lacks

| Property | Holds? | Consequence for graph methods |
|---|---|---|
| Symmetric: value(a,b) = value(b,a) | Yes (`lawPairValueSymmetric`, `lawLanePairValueSymmetric`) | NN-Descent's local join (update both lists from one computation) is valid. **Reverse caps** (3.3) are sound. One computation serves both sides. |
| Metric (triangle inequality on 1000 − value) | No | No metric-tree pruning. No navigability guarantee from geometry. |
| Bounded 0..1000 or no pair | Yes | Bounds compose. |
| Monotone in each term | Yes (harmonic mean monotone, `lawHarmonicMonotone`) | Per-bucket term bounds give a sound bucket bound (TA, Block-Max). |
| Hard feasibility | Segments, band, floors, balance, pair gate | Filtered regions. Graph edges between infeasible pairs are useless for routing in the feasible subgraph. |
| Opaque pack term | `packValue` is a pack function (slop: float model, `exp`, rounded) | Its bound is 1000 unless the pack exposes a bound. This is the main looseness for Date. |

### 3.2 Seeding with the proof unchanged (exactly how)

**Change.** In `searchCandidates`, before the main loop, touch a **seed list** S of block positions, deduplicated and in a canonical order (seed rank, then ordinal). For each seed, do exactly what `visit` does today: mark `touched`, compute the same bound (`lanePairValue` with the full pack), push it into `pending` when the bound is ≥ 0, and count one touch. Seeds count against `searchMayTouch`, so the touch limit is unchanged.

**Why the proof survives.** The proof relies on one invariant: every window position is either touched (then it is pending with a sound bound, checked, or bound < 0) or untouched (then it is covered by `untouchedBound()`). `untouchedBound()` reasons only about the tag groups still open: "an untouched b can have hits only in tags whose window range is not fully walked". That stays true when some members were touched out of order, because removing members from the untouched set only shrinks the set that the bound must cover. Postings that later reach a seed skip it (`touched.has`). So `lawUnseenBoundSound`, `alwaysKeptBeatDropped` and `alwaysExactBeatsUnseen` are untouched. **No spec law changes.** One prose sentence is needed in `spec/candidateSearch.md`: "the shell may touch any window position before the posting walk; a touched position is covered by its own bound".

**Where the seeds come from (all inside one run, deterministic):**

1. **Reverse kept** (who already kept me in this run). The value is known exactly (see 3.3), so it costs no pair computation.
2. **Previous run's kept list** of the same entity, when the profile still exists. The values may be stale, so these are seeds only, never bounds.
3. **3-hop twin transfer** (Section 5): kept lists of a's twins.
4. **Previous run's met or positive-outcome partners' kept lists** (warm paths), for Friend and Intro.

**What it buys (honest).**

- In a **budgeted** search, the kept list is the best of (seeds ∪ the first 4,800 window positions) instead of the best of an arbitrary 4,800. It is better whenever the seeds are better than random window members. Measure: recall@k and value regret against brute force on sampled members.
- In an **exact** search, the checked set is "touched candidates with bound > final k-th value". That does not depend on order. Seeds can only **save touches**: a high k-th value early lets `closeExact` fire before the remaining posting ranges are walked. They can **add** checks, when a seed is checked because its bound beat the untouched bound at that moment and later proves below the final k-th value. **Do not expect fewer checks from seeds in exact mode.** That is the instance-optimality of threshold algorithms (Fagin, Lotem, Naor 2003 **[unverified page details]**): no order beats the bound order on checks.

### 3.3 Reverse kept caps: a sound, tighter bound from the kept graph (new law)

**Statement.** Let b's search in the same run be closed, with kept list K_b, worst kept value w_b, kept count |K_b| = limit, and reported unseen bound u_b. For any a ∉ K_b:

- If b closed **Exact**: value(a,b) ≤ w_b. When the values are equal, b's tie order (ordinal) put a below.
- If b closed **Budgeted**: value(a,b) ≤ max(w_b, u_b). Every member was either checked and dropped (≤ w_b by `alwaysKeptBeatDropped`), pending (≤ its bound ≤ u_b) or untouched (≤ u_b).
- If b closed Exact with |K_b| < limit, a ∉ K_b means a has **no pair** with b.
- If a ∈ K_b, value(a,b) is known exactly: reuse it.

By symmetry this caps a's bound for b: `bound'(a,b) = min(bound(a,b), cap_b)`. **Proof obligation:** `lawKeptCapSound` in `spec/candidateSearch.md`. It follows from `lawPairValueSymmetric`, `alwaysKeptBeatDropped`, `alwaysExactBeatsUnseen` and the reported-bound law for Budgeted searches, all already proved. It needs one more fact: both searches use the same pair function on the same world. That holds inside one `MatchRun` (one memo of searches, one world). **Never carry caps across runs:** the world changes (capacity, cooldowns, standing steps, declines).

**Where it applies.**

1. **Pending candidates**: lower the bound at touch time. This prunes checks (pair computations with the expensive pack value) for candidates whose own lists are already full of better partners. That is common in Date, where the parity band clusters values.
2. **Untouched members**: keep a per-bucket maximum of `cap` (Section 4), initialised to 1000 for members not yet searched. The untouched bound of a bucket becomes min(term bound, bucket max cap). This is the part that can turn Budgeted into Exact: a's search can stop once a's k-th value is above every unvisited bucket's max cap.
3. **Value reuse**: when b's search kept a, a's search inserts value(a,b) without calling `pairValueOf`. The machine still sees a `checkCandidate` (the check count is unchanged), but the wall time drops. A kept-value memo costs O(N·k) entries (1.2M at 100k), unlike a memo of every check (N·600 = 60M).

**Order of searches.** Caps exist only for members searched earlier in the run. Process searches in a deterministic order. Then, as an option, run a **second pass** only over the members whose first search was Budgeted, with every cap known. The cost of the second pass is at most (#budgeted) × budget, so it keeps the global bound N × budget × 2. Expected effect: unknown, because it depends on how spread the k-th values are inside a window. That is why measurement comes first (proposal P1). For a member whose own k-th value is low (a "hard to match" member), most caps are above it, so the member gains little. For a member whose k-th value is high, caps prune most buckets.

### 3.4 When greedy graph search misses (to state in the spec prose, if a graph is ever used for anything but order)

1. **Local optimum:** every neighbour of the current best has a lower value, but a better member exists elsewhere (Indyk–Xu constructions).
2. **Disconnected feasible region:** the graph's edges were chosen by value. A member's feasible partners under a new filter (a new block, a new cooldown, a moved standing) may have no graph path from the entry points (the experimental study's 0.1% failure mode).
3. **Stale graph:** values changed since the build (standing steps, pack history, capacity), so the edges no longer point at the best.
4. **Hubs:** a few high-value members appear in many lists (popularity concentration). The desirability hierarchy makes this real (Bruch and Newman 2018).

Remedies used in the literature (extra entry points, two-hop expansion, a flat-scan fallback) make misses less likely but do not certify them. **Our remedy is the existing stop rule.**

---

## 4. Clustering and graph reordering for tight block-max bounds (the speed lever that keeps exactness)

**Background.** Block-Max WAND (Ding and Suel, SIGIR 2011 **[unverified]**) stores per-block maxima of each term. It skips whole blocks whose bound cannot beat the current k-th score, and stays exact. The bound is only as tight as the blocks are homogeneous. In inverted-index work, document **reordering** (clustering similar documents together) is the standard way to make block maxima tight. In ANN work, "graph reordering" serves cache locality (Coleman et al. 2022 **[unverified]**). The D-theory note already designed per-bucket bounds (`bucketValueBound`, section 4c). The shipped index uses per-tag postings instead.

**Proposal.** Keep the block sorted by (segment, standing). **Inside each (segment, standing value) run**, order members by a locality key. Then cut the run into fixed buckets of B = 32 or 64 positions. A bucket never crosses a standing value, so the window (a union of whole standing values per segment) is a union of whole buckets, and window completeness is unchanged. Per bucket, store:

- the trait range [low_d, high_d] per trait dimension (closeness bound = distance from a's trait to the range, 0 inside it);
- OR-unions of offers, seeks and interests as bitsets (tag ids are interned, so a bitset of ≤ a few hundred bits; 42 activity tags fit in one 64-bit word);
- the smallest |seeks| and |interests| (for the reverse coverage bound);
- the maximum reverse cap (Section 3.3), mutable during the run;
- an optional **pack bound summary** that the pack defines (below).

The bucket bound is `bucketValueBound(utilityBound, otherUtilityBound, leastPenalty)` (already in the spec, `lawBucketBoundSound`). The walk visits buckets in decreasing bound, and the stop rule is unchanged: close Exact when the k-th value beats the next bucket bound and every pending bound. The proof obligation is the existing `lawBucketBoundSound` plus soundness of each new per-term bound. Each one is a subset-monotonicity or interval-distance lemma, all integer.

**The locality key per pack (deterministic; any order is sound):**

- **friends (Friend):** a Hilbert or Morton (Z-order) code of the (km north, km east) home position, then energy, then weekend lean. Closeness costs 50 per km, so a bucket of 32 neighbours within about 1 km has a closeness range near the true value, not 1000. Home position dominates the Friend utility after affinity (weights affinity 6, closeness 2), so this alone should tighten the untouched bound sharply.
- **slop (Date):** segments are already (pool, coarse cell). Inside, order by the tags that drive `datePackValue` and the complement: goal, wants_kids, free slots, body type, activity. A k-means or **e-means** clustering of a small integer feature vector is one way to get an order. e-means (Bessa, Mazaré, Szilvasy, Touvron, Picard, Douze, Jégou, arXiv:2611.09501, in Faiss `contrib/e_means`) **[opened: project page]** reaches Lloyd's 25-epoch loss in 1.2 to 3 epochs and is 8 to 15 times faster on CPU than Faiss k-means. A lexicographic sort on the discrete tags works as well at our scale. The order affects only speed, so a cheap order is enough.
- **peon (Hire):** order seats and candidates by role family, then level, then skill-cluster id.
- **ntwrk (Intro):** already 100% exact; no change.

**Pack bound hook (needed for Date).** Add an optional `packValueBound(w, a, bucketSummary): number` to `PackVectors`. It must return a value ≥ `packValue(w, a, b)` for every b in the bucket. For slop, `datePackValue` = directional × logistics × bodyType, capped at 1. Each factor has a per-bucket upper bound:
- `logistics` = 1 if a's free slots meet the bucket's union of free slots, otherwise `noCommonSlot`;
- `bodyTypeFactor`: the maximum over the body types present in the bucket;
- `directional`: its maximum over the bucket's tag union.

The pack must state each of these as a **proved integer bound** (the float model must first be moved to integer permille), or they cannot enter the proof. If it cannot, the pack bound stays 1000 and Date gains only from the tag and cap bounds.

**Cost.** The build is still one sort per block, O(N log N) plus O(N) summaries. A search computes ≤ (#buckets in window) bucket bounds: with B = 64 and a 30,000-member window, that is 470 bound computations, each O(words of bitset). Use a heap of buckets by bound.

**Risk.** Buckets inside a single standing value can be small in sparse windows; then summaries cost more than they save. Use B adaptively, or merge adjacent standing values only when the window low and high are bucket-aligned (they are not in general, so prefer per-standing buckets). Rarely, a bound computation error is a soundness bug, so a sim gate must compare against brute force (already exists in the matching block).

---

## 5. "Similar people match similar others": candidate transfer through the graph

### 5.1 Formalization

Let G_L be the **kept graph** of lane L in a run: an edge a–b when b ∈ K_a or a ∈ K_b, weighted by value (this is `mutualEdges`). Let O_L be the **outcome graph**: an edge a–b when both said yes, met, rated the meeting well, or (dating) had a second date. Both graphs are symmetric.

- **Twins of a**: members a' on a's own side (same pool or segment for Date, same role for Hire) with a large overlap of partners: |N(a) ∩ N(a')| in G_L or O_L. These are a's 2-hop neighbours through partners.
- **Transfer candidates**: T(a) = ∪_{a' ∈ twins(a)} N(a') \ N(a). These are 3-hop paths a → b → a' → b'.
- **Score (for the collaborative pack term, Section 5.3)**: cf(a,b') = Σ_{a'} sim(a,a') · [a'–b' ∈ O_L] / Σ_{a'} sim(a,a'), as integer permille. The reciprocal form also requires the mirror direction cf(b',a) over b's twins, then a harmonic mean (Pizzato et al. RECON 2010 used harmonic **[unverified via D-theory]**; Neve and Palomares RecSys 2019 found the choice of aggregation operator significantly changes outcomes **[search]**).

**Why bipartite structure matters.** In a straight Date segment pair, a man's neighbours are women and their neighbours are men. NN-Descent's local join ("compare two neighbours of a with each other") pairs two women, a pair the segment rule refuses. So **plain NN-Descent wastes every local join on bipartite lanes**. The correct join is the 3-hop one above, or, equivalently, NN-Descent on the **projected** same-side graph (twins), as in RoarGraph's projection of a bipartite query–base graph. For **same-pool** dating (gay or lesbian pools seeking their own pool) and for Peers lanes without segments (Friend, Cofounder, Intro), the graph is not bipartite, and the plain local join is valid: b and c both kept by a can be compared directly. That is also the wedge-closing pass for circles (Section 6). **Bisexual members** sit in several pools' partner sets, so their 3-hop walk crosses pools. That is correct as long as the segment test (`segmentReaches` both ways) runs on every final candidate. The pair gate guarantees it, because seeds are just touches.

### 5.2 Cost and correctness

- **Seed use** (speed and budgeted quality): the transfer set per member is ≤ k_twins × k ≤ 10 × 10 = 100 touches when the twin list is precomputed, or ≤ k³ = 1,000 for the raw 3-hop walk before deduplication. A cap of 200 seeds keeps it under 5% of the 4,800 touch limit. Exactness is unchanged (3.2).
- **Twin lists** can be built incrementally by NN-Descent on the projected graph with a cheap similarity (shared kept partners, tag Jaccard, standing distance). Cost per round ≈ N · K² similarity computations (Baron and Darling's O(n K² log n) fit), so 100,000 × 100 = 10⁷ cheap integer set intersections per round. Warm-start from the previous run's twin lists, so 1 or 2 rounds per run.
- **Determinism:** NN-Descent samples (ρ). Use the seeded RNG from `Clock`/the world seed and a canonical iteration order, single-threaded. Twins affect only seeds, so nondeterminism would change only budgeted results, but the simulator needs reproducibility anyway.

### 5.3 As a quality signal (a collaborative pack term)

Literature:

- **Brožovský and Petříček**, "Recommender system for online dating service", arXiv:cs/0703042 (Znalosti 2007) **[opened]**. On the Libimseti rating data, collaborative filtering recommenders were significantly better than the global algorithms dating sites commonly used, and users preferred them in a blind test.
- **Xia, Liu, Sun, Chen**, "Reciprocal recommendation system for online dating", ASONAM 2015, pp. 234–241, arXiv:1501.06247 **[search]**. Two similarity notions: *interest similarity* (they message the same people) and *attractiveness similarity* (they receive messages from the same people). A reciprocal score from both directions beat content-based methods by a wide margin in precision and recall on a large Chinese dating site. Journal extension 2016 with Zhai **[search]**.
- **Cai, Bain, Krzywicki, Wobcke, Kim, Compton, Mahidadia**, "Learning collaborative filtering and its application to people to people recommendation in social networks", ICDM 2010, pp. 743–748 **[search]**, and "Collaborative filtering for people to people recommendation in social networks", AI 2010, LNAI 6464 **[search]**: people are both "users" and "items", so one-sided CF does not fit; similarity is not symmetric.
- **Neve and Palomares**, RecSys 2019 **[search]**: latent-factor reciprocal CF, with a strong effect of the aggregation operator.
- **Pizzato et al.**, RECON (RecSys 2010) and "Recommending people to people" (UMUAI 2013): reciprocal content model with harmonic aggregation **[from the D-theory note; unverified by me]**.

**What fits our rules.**

- Use **mutual positive outcomes** (both yes, met, good rating, second date) as the O graph. **Do not use one-directional likes or messages.** Xia's "attractiveness similarity" (received messages from the same people) is a popularity signal. Bruch and Newman (arXiv:1808.04840, *Science Advances* 4(8) 2018 **[opened: abstract]**) show a consistent desirability hierarchy: people contact partners about 25% more desirable than themselves, and replies drop as the gap grows. A like-graph CF would push everyone toward the top of that hierarchy. That conflicts with the founder's parity goal and with the rule that standing reads no acceptance or popularity counts. An outcome-graph term is a **pack** input, not standing, but the same spirit applies.
- Keep it inside the parity window: twins must be in the same segment and standing window as a. Then "people like you" means peers, not people above you.
- **Integer, bounded, provable:** cf is a coverage-style ratio of counts → permille via `coverageValue`. It fits the four-term utility as part of the pack term, or as a fifth term later. Its bucket bound is the maximum cf in the bucket, or 1000 to start.
- **Cold start:** at launch (fewer than 1,000 members per app, and human review on every proposal), O is very sparse. CF needs a minimum support (for example ≥ 3 twins with outcomes) and falls back to 0 weight. It cannot fix the simulator's hidden chemistry (AUC 0.58 for slop) unless the simulator's outcomes carry a learnable structure. Testing that is the first measurement, and the planted world must contain a "taste cluster" structure for the test to mean anything (an item for the test-data agent).
- **Feedback loops:** CF learns from our own proposals (selection bias). Exploration in `selectionRun` is the mitigation; log the proposal propensity, so that an offline estimate can reweight by inverse propensity.

---

## 6. Small worlds and circles

### 6.1 What real networks look like

- **Small world:** Watts and Strogatz, *Nature* 393:440 (1998) **[unverified]**: high clustering plus short paths from a few random shortcuts. Ugander, Karrer, Backstrom, Marlow, "The anatomy of the Facebook social graph", arXiv:1111.4503 **[opened]**: 99.91% of users in one connected component, dense neighbourhoods in a sparse graph, clear degree assortativity, strong age homophily, community structure driven by nationality, no strong gender homophily.
- **Navigability:** Kleinberg 2000 (Section 2.3): short paths are findable only when long links follow distance in the right way.
- **Triadic and focal closure:** Kossinets and Watts, "Empirical analysis of an evolving social network", *Science* 311:88 (2006) **[search]**: 43,553 university members over one year. Tie probability falls fast with network distance. One shared class is roughly as strong as one mutual acquaintance, and further mutual acquaintances count more than further shared foci. Their 2009 *AJS* follow-up: similar pairs do tie more, but triadic and focal closure explain much of the apparent homophily **[search]**.
- **Weak ties at work:** Rajkumar, Saint-Jacques, Bojinov, Brynjolfsson, Aral, "A causal test of the strength of weak ties", *Science* 2022 **[search: press summaries of the LinkedIn experiment on about 20 million users; authors and venue unverified]**: moderately weak ties (about 10 mutual connections) helped job mobility most, in an inverted U. Backstrom and Leskovec, "Supervised random walks", WSDM 2011, arXiv:1011.4071 **[search]**: friend suggestion as a biased random walk; Facebook's suggestions caused a significant share of new links. LinkedIn's PYMK engineering page describes friends-of-friends (triangle closing) as a first signal, then scored by shared organisation, age gap and distance **[search]**.
- **Dating:** the desirability hierarchy (Bruch and Newman) is the vertical structure. Our parity band encodes the empirical finding that replies drop with the gap.

### 6.2 Implications for us

1. **Circles need closed triangles; the kept graph under-supplies them.** `buildCircles` takes only `mutualEdges` (top 12 per Friend member) and seeds from triangles in that edge set. With 12 kept partners out of thousands of feasible ones, two partners b and c that a kept are rarely in each other's top 12, even when value(b,c) ≥ the circle floor (350 Friend, 400 Intro). Kossinets–Watts say exactly these wedges (closed by shared foci: an activity plus a neighbourhood) are the most likely to become ties.
   **Proposal (wedge closing):** for each member a and each pair b, c ∈ K_a with b, c in a common segment reach, compute value(b,c) through the one pair gate, and add the edge to the circle builder's `links` when it reaches the circle floor. Cost ≤ N · k(k−1)/2 = 66N pair computations for Friend and Intro (k = 12), 28N for Mentor (k = 8). Count it in a separate circle budget, recorded in the run log. It does not touch search exactness. Circle admission still uses `circleCoherent` on real pair values.
2. **Hubs and the one-circle rule.** `used` allows each member in one circle per run. Hubs (high-degree members in the union edge set) seed many triangles and win early, which starves others. Order seeds by (lowest pair value, total), as today, but also measure per-member circle exposure (exposure floor covers pairs, not circles).
3. **Warm paths for ntwrk requests.** 88% of ntwrk meetings come from member requests, and `searchFor` ignores the graph. A two-hop "friend of a friend" signal (via O: met and rated well) is the PYMK and weak-tie mechanism. For Intro and Hire, moderate tie strength is the useful zone. Use it as a ranking term with a cap, never as an eligibility rule.
4. **Exploration as long-range links.** In Kleinberg's terms, a kept graph built only by value is lattice-like and clustered, so seeds from it stay local. A few deterministic, seeded random members per search (from the window) are the "long links" that keep twin transfer from collapsing into one taste cluster. This also matches `selectionRun`'s exploration phase.

---

## 7. Adding members without recomputing everything (incremental, exact)

Values in a run depend on the world (capacity, cooldowns, standing steps, pack history), so the **daily run** should stay a full recomputation, which is bounded by N × budget. Incremental updates matter **within a day** (a new member gets candidates now) and for keeping caps and twins warm.

- **Insert x** (new profile, world otherwise unchanged): run x's search. Then find every a whose list x enters: value(a,x) > w_a. That is a **reverse top-k** (reverse k-NN) query. Do it exactly with a threshold search from x: walk x's window in bound order with the stop rule "next bound ≤ min over unvisited buckets of w_a", where each bucket keeps its minimum worst-kept value (a range-min summary, updated when lists change). Every a with value(a,x) > w_a is found, by the same bound argument. For each such a, insert x and drop the old k-th entry. **Exact. Cost:** one search with a threshold, plus O(#affected · log k).
- **Delete x** (leaves, blocked, paused, minor detected): for every a with x ∈ K_a (keep a reverse-kept index: O(N·k) memory), a's list loses one entry and its (k+1)-th is unknown. Rerun those searches. Expected count ≈ k (each member is kept about k times on average; hubs more).
- **Pair change** (decline, block, cooldown): treat it as a delete of b from K_a and a from K_b.
- **Update x** (new tags, standing step) = delete + insert.

FreshDiskANN's figures (inserts, deletes and searches in thousands per second, recall above 95%, 5 to 10 times cheaper than rebuilds) show the value of incremental graphs. Our version keeps exactness because it is bound-driven, not graph-driven.

---

## 8. How work, friendship and dating differ in graph terms

| Lane | Graph shape | Selection problem | Graph tools that apply |
|---|---|---|---|
| Date | Bipartite between pools for straight members; non-bipartite for same-pool and bisexual members (several pools seek each other) | 1:1 matching with capacity 2 a week. A symmetric pair value with a total tie order makes greedy selection stable, also in non-bipartite graphs (no preference cycles with one global order) **[standard result, unverified citation]** | 3-hop twin transfer; outcome CF inside the parity window; pool graph as segments |
| Friend | General graph; groups of 3–6 | Clique packing with pair floors (hedonic games; NP-hard in general, D-theory 3.5) | Wedge closing, focal closure (activity × neighbourhood), warm paths |
| Hire | Bipartite seat ↔ candidate, seat capacity | b-matching | Projected bipartite graph (candidates kept by the same seats are twins; RoarGraph-style) for seeds |
| Cofounder | Peers, non-bipartite, equals | 1:1 with exchange balance | Plain NN-Descent local join is valid (same side) |
| Mentor, Invest | Bipartite, intended offset | b-matching | Same as Hire |
| Intro | Peers, asks ↔ offers | 1:1 and circles | Already exact; wedge closing for circles; warm paths for requests |

**More signifiers (orientation, trans status, interest in trans partners, friends with men, women or both).** In graph terms each is a **pool** plus a **seeks-pools set**. Compatibility is the mutual test "my pool ∈ your seeks and your pool ∈ my seeks". The engine already has it: `EntitySegment {own, partners}` with `segmentPairAllowed(segmentReaches(a,b), segmentReaches(b,a))`. slop builds `own = pool|cell` and partners = sought pools × reachable cells. Extending this means:

- a pool key that includes gender identity and, when the member chooses to state it, trans status;
- seeks sets that may include or exclude trans partners;
- the same for the Friend lane (seeks friends who are men, women or both).

The partner list size multiplies: about 100 neighbourhoods × 9 tolerance classes × 3 genders for friends. It is memoised per distinct list, so the cost is in index segments, not in search. Search cost falls, because segments are hard pre-filters. These are sensitive facts. Segment strings must never appear in member-facing text, the leak guard must cover them, and logs must hash them. "Unknown means ineligible" (jevector rule, D-theory 4b) must not apply to trans status. A member who does not state it must not be excluded from pools that do not ask about it. That is a founder decision.

---

## 9. Libraries (TypeScript on Node 26 and on Cloudflare)

| Library | What it offers | Fit for us |
|---|---|---|
| hnswlib-node (yoshoku) | Node binding of hnswlib: `HierarchicalNSW(space, dim)`, `initIndex`, `addPoint`, `searchKnn`, `BruteforceSearch`, a `FilterFunction` type **[opened docs index]**; mark-delete and the seed parameter **[unverified]** | Float l2/ip/cosine only, no custom score. Deterministic only single-threaded with a fixed seed and insertion order. As a seed source at most. |
| usearch | JS and WASM bindings, i8/u8 storage, exact scans in all bindings, `search_if` predicate (not in the JS binding), custom metrics only in C++ **[opened README]**; determinism not stated | Same limits. No predicate filter from JS. |
| faiss (Node bindings) | IVF, HNSW, PQ; e-means in `contrib` | Native build on Workers is not possible. Offline clustering for bucket order only. |
| pgvector HNSW | Iterative scans (`max_scan_tuples` 20,000), post-filtering, partial indexes or partitions recommended **[opened]** | Approximate, float, no reciprocal score. Useful only if Postgres storage of embeddings is wanted for something else. |
| Cloudflare Vectorize | ≤ 20M vectors, ≤ 1,536 dims float32, topK ≤ 100 (50 with values or metadata), 10 metadata indexes of ≤ 64 bytes each, 50,000 namespaces, upsert batches of 1,000 (Workers) **[opened limits page]**; consistency model not stated on that page | A 10–12 candidate list per member, from one direction, without our score. Not useful in the decision path. |

**Recommendation:** none in the decision path. Build in TypeScript (each piece is small, integer and deterministic):

1. a kept-graph store per run (forward and reverse kept, kept values);
2. bucket summaries with bitset unions;
3. a seeded wedge-closing pass;
4. a seeded 3-hop or projected-twin seeder;
5. a threshold reverse search for inserts.

Put the decision logic (cap soundness, bucket bounds) in the LemmaScript core. Keep the walkers as thin shells, as `search.ts` is today.

---

## 10. Benchmarks: so that we never have an n² problem and can see quality move

**Harness ("matching scale bench", offline, not part of `pnpm run sim`'s default blocks; nightly at most).**

- **Worlds:**
  - the planted generator (`packages/sim/src/planted.ts`) and each pack's world generator, at N = 1k, 10k, 100k (and 300k once, to fit an exponent);
  - one market per run plus a multi-market case;
  - adversarial worlds: everyone in one standing value, identical tags, all ties, every uncertainty at the ceiling, one dominant hub.
- **Sampled oracle:** for S = 200 members per lane per N, run `bruteForceCandidates` (cost S × N pair computations, 2·10⁷ at 100k). Report with a Wilson 95% interval:
  - exact share;
  - recall@k of budgeted searches against the oracle;
  - **value regret** Σ oracle values − Σ kept values;
  - median and p95 reported unseen bound minus the true k-th value.
- **Cost per profile:** checks, touches, bucket bounds computed, pack calls, wall time, peak memory; build time and memory of the index and of the kept graph.
- **Scaling gate:** fit log(total work) against log(N) over 1k → 100k. Require a slope ≤ 1.15 for touches + checks + bound computations, and build time O(N log N). Separately require exact share at 100k ≥ a target per lane, and regret ≤ a target.
- **Quality, end to end:** keep the existing sim gates (V14, repeat-meetup, second-date rate, AUC). Simulation outcomes are noisy (a neutral tie-break moved pooled meetings from 174 to 132), so compare arms on **paired seeds** with ≥ 8 seeds and a paired test. Never read a single-seed change.
- **Circles:** circles formed per eligible member, mean lowest pair value, ARI against planted circles, share of members in no circle, hub concentration (Gini of circle membership).
- **Incremental:** insert and delete throughput, and equality of the incrementally maintained lists with a fresh full run (must be 100% on exact searches).

---

## 11. Proposals (ranked)

Each item: what changes, why, risk, measure, effort, exactness.

**P1. Scale bench with a sampled brute-force oracle (Section 10).** What: an offline harness. Why: today we know exact share and checks, but not recall, value regret or a scaling exponent for budgeted searches. Without it, none of the following can be judged, and sim outcome noise (174 → 132 from a tie-break) hides effects. Risk: oracle cost at 100k (2·10⁷ pair computations per lane, about minutes). Measure: itself. Effort S–M. Exactness: not affected.

**P2. Kept-value reuse and reverse kept caps (Section 3.3).** What: a per-run kept graph (forward, reverse, values). Reuse value(a,b) when b kept a. Cap pending bounds by cap_b = worst kept of b (Exact) or max(worst kept, unseen bound) (Budgeted). Optionally run a second pass over budgeted members with all caps known. Why: a sound bound tighter than the term bounds; it uses symmetry, which we have proved and do not exploit. Pack calls (the expensive part of a check in slop) fall by the reuse rate. Risk: the gain depends on the spread of k-th values; caps help little for hard-to-match members; ordering effects (caps only for earlier searches) make results order-dependent within budgeted searches, so fix a canonical order. Measure: exact share, checks, pack calls and wall time per lane at 10k and 100k; regret. Effort M (a new law `lawKeptCapSound` in `spec/candidateSearch.md` with its Dafny proof, a Quint model update for the search state, the shell change). Exactness: kept. Stronger: more searches close Exact.

**P3. Block-max buckets on a locality order, with a pack bound hook (Section 4).** What: inside each (segment, standing) run, order by a locality key (Hilbert code of home for friends; the pack-value tags for slop); bucket summaries (trait ranges, tag bitsets, max cap, optional pack bound); walk buckets in bound order. Why: this is the fix for fault A, the loose untouched bound in tag-free lanes (Date and Friend at 31% and 22% exact). Block-Max WAND is exact and widely used. Risk: soundness of each new per-term bound (needs proofs); the slop pack must move its pack value to integer bounds to benefit; small buckets in sparse windows. Measure: P1 metrics, before and after on the same seeds; target Friend and Date exact share at 100k well above today's 22% and 31%, with checks per profile not above today's. Effort L (spec, proofs, index rewrite of the window walk; the posting walk stays for tag-heavy lanes). Exactness: kept (`lawBucketBoundSound` already exists).

**P4. Seeded touches from the graph (Section 3.2).** What: before the walk, touch reverse-kept, previous-run kept, and twin-transfer seeds (cap 200). Why: fault B. Budgeted searches keep the best of seeds ∪ window prefix, not of an arbitrary prefix. Risk: no check savings in exact mode (Section 3.2); seeds can add a few checks; stale previous-run seeds waste touches. Measure: recall@k and regret of budgeted searches; touches and checks of exact searches (expect equal or slightly higher checks). Effort S (shell change plus one spec prose sentence). Exactness: kept, proof unchanged.

**P5. Wedge closing for circles (Section 6.2).** What: compute value(b,c) for pairs of a's kept partners, bounded by k(k−1)/2 per member, and add edges at the circle floor to `buildCircles`' links. Why: triangles are the circle seeds. The kept graph rarely closes wedges that do fit, and triadic/focal closure is the strongest tie predictor in the literature. Risk: more circles for already well-connected members (hubs); 66N extra pair computations for Friend; must stay inside the circle budget. Measure: circles per eligible member, lowest pair value, ARI on planted worlds, friends V14 and repeat-meetup (paired seeds). Effort S–M. Exactness: search unaffected; circle admission still `circleCoherent`.

**P6. Index-backed member requests plus warm paths (`searchFor`).** What: replace the full member scan per request with a one-sided posting query on the request's tags in the Intro lane index (same pair gate); add a capped two-hop warm-path term from the outcome graph. Why: 88% of ntwrk meetings come from requests; the path is O(N) per request (O(N²) if everyone asks), reads no lane vectors, and uses floats. Risk: changes the ranking that drives most meetings (the Intro AUC experiment showed that raising AUC lowered meetings, 174 → 150), so it needs paired-seed evidence; float-to-integer behaviour changes. Measure: request latency and pair computations per request at 10k and 100k; meetings, everyone-yes rate, requester satisfaction on paired seeds. Effort M. Exactness: a new exact path where today there is none (the scan is exact but unbounded).

**P7. Outcome-graph collaborative term inside the parity window (Section 5.3).** What: a reciprocal CF pack term from mutual positive outcomes of same-segment, same-window twins, integer permille, with minimum support and zero weight otherwise. Why: dating literature finds CF stronger than content and global methods (Brožovský and Petříček; Xia et al.). The content score cannot see chemistry (slop AUC 0.58, friends 0.60). Risk: cold start, so no effect at launch; popularity and desirability propagation (must use mutual outcomes only, never likes); feedback loops from our own proposals; privacy (twins are private; never in reasons). The planted world must have a learnable taste structure, or the test proves nothing. Measure: AUC against hidden good pairs, second-date rate, lowest-quintile fairness gates, weekly bias monitor; paired seeds. Effort L. Exactness: kept if its bucket bound is 1000 or a proved per-bucket maximum.

**P8. Exact incremental insert and delete (Section 7).** What: threshold reverse search for inserts using per-bucket minimum worst-kept; reverse-kept re-search for deletes and pair changes. Why: intraday joins get candidates at once, without a full rerun; the work is bounded. Risk: complexity; world changes outside the delta invalidate lists, so the daily full run stays. Measure: equality with a fresh full run (100% on exact searches); latency per insert. Effort M–L. Exactness: kept.

**P9. Pool graph for new signifiers (Section 8).** What: extend the slop pool key (gender identity, optional trans status) and the seeks-pools sets (including or excluding trans partners); add a gender-of-friends segment to the friends pack. Why: dealbreakers become hard pre-filters, which is exact and cuts search cost. Risk: sensitive data handling; unknown-status rules (a founder decision); segment explosion (memoised). Measure: zero pairs that violate a stated preference (sim gate); search cost per profile. Effort M (per pack plus spec). Exactness: kept (`segmentPairAllowed` already proved).

---

## 12. What will NOT work for us, and why

1. **HNSW, NSG, Vamana or ACORN as the candidate source with a correctness claim.** There is no worst-case bound (Indyk and Xu: linear time on constructed instances). No sparse graph is navigable for arbitrary score functions (Diwan et al.: degree about √n is needed). Our score is reciprocal, non-metric and filtered. The stop rule and its proof would be lost, and we could report only sampled recall.
2. **Filtered-graph indexes to replace blocking.** Our hard filters are high-selectivity partitions. The SIGMOD 2026 study, pgvector, Milvus and Qdrant all recommend partitions and direct scans at that selectivity. Graph methods fail there (0.1% selectivity collapse).
3. **Cloudflare Vectorize, pgvector HNSW, hnswlib-node, usearch in the decision path.** They use float distances on one vector, not our two-sided integer value with floors, band and balance. They are approximate and give no certificate. Their builds are non-deterministic when multi-threaded. Vectorize returns topK ≤ 100 (50 with metadata). Per-request latency to an external index is added. Usable at most as an offline seed source, and even that is not needed at our scale.
4. **Expecting graph seeds to cut pair checks in exact searches.** A best-first walk by sound bounds already checks only the candidates whose bound beats the final k-th value. Seeds change the order, not that set. The gains are touches and budgeted quality.
5. **Plain NN-Descent on bipartite lanes** (straight Date pools, Hire, Mentor, Invest). Its local join pairs two members of the same side, which the lane or segment rule refuses. Every join is wasted. Use the 3-hop or projected-twin join.
6. **Clusters (k-means, e-means, Louvain) as hard search blocks** ("search only within my cluster"). That drops feasible partners at cluster borders, breaks `lawWindowComplete`, and is unbounded. Use clusters only to order buckets. Modularity methods also cannot see 3–6 person groups in large graphs (resolution limit, Fortunato and Barthélemy 2007, from D-theory).
7. **Like or message graphs as a CF signal** (Xia's attractiveness similarity). This spreads the desirability hierarchy and popularity (Bruch and Newman), against the parity goal and the no-popularity rule.
8. **Previous-run kept lists or caps as bounds.** Values change between runs (standing steps, capacity, cooldowns, history). They are only seeds.
9. **Uniform random "small-world shortcuts" for navigation.** Kleinberg: uniform links make short paths that greedy search cannot find. Exploration members are for selection fairness and seed diversity, not for routing.

---

## 13. Open questions

1. Will the founder allow a collaborative pack term built from mutual outcomes? It uses other members' outcomes to rank a pair, privately, never in reasons.
2. Must trans status and interest in trans partners be collected, and what happens when a member does not state it (no exclusion, or exclusion only from pools that require it)?
3. What market sizes do we expect in the first year? At ≤ 10k per market, exact shares are already 85–94% for Friend and Date. Is P3 worth its L effort before P2 and P4 are measured?
4. Is intraday incremental matching wanted, given human review on every proposal and a daily run?
5. Can the slop pack value be moved to integer arithmetic with per-factor bounds (needed for P3's pack hook to help Date)?
6. Should the wedge-closing budget be part of the lane's search budget or a separate circle budget in `matchLane`?
7. Does the planted or simulated world contain taste-cluster structure (twins with correlated outcomes)? Without it, P7 cannot show an effect in simulation. This is for the test-data review.
8. The Date window can be ±55 standing points because unrated members get the widest uncertainty. Should an unrated member's Date search be held until a rating exists, or limited to a narrower window with a stated bound?
