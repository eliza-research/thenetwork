# R1. Clustering for candidate generation, and e-means

Research report for The Network matching engine. Angle: clustering as a pruning index, e-means, exact cluster-level bounds for our pair value, and "cliques first" warm starts.

Scope and method. I read `/Users/nubs/thenetwork-matching` at commit 3f0f8586 (read-only): `AGENTS.md`, `spec/candidateSearch.md`, `spec/pairValue.md`, `spec/matchLane.md`, `spec/memberStanding.md` (uncertainty formula), `packages/engine/src/match/{index,search,pair,profile}.ts`, `packages/engine/src/packs/friends/vectors.ts`, `packages/engine/src/packs/slop/{generators,score}.ts`, `packages/sim/src/planted.ts`, `packages/sim/src/apps/friends/persona.ts`, `scripts/sim/matching.ts` (cost run), `packages/network/src/network.ts` (`searchFor`), and `docs/results/2026-11-17-matching-engine-migration.md`; plus the earlier research notes G-architecture.md and D-theory.md section 4. I ran no simulation, test, type check, Quint or Dafny, and no script. All numbers that are not from our measurements or a cited source are my own back-of-envelope estimates and are marked "estimate". Citations: "opened" means I fetched the page or a search result that showed its bibliographic record and abstract in this session; "[unverified]" means recalled from memory and not opened.

---

## 0. Summary (what matters most)

1. **e-means is a fast k-means for dense float vectors, not a search method.** It is a mini-batch k-means with exponential-moving-average centroid updates, scaling-law hyperparameters and split-the-largest dead-cluster revival (Bessa, Mazaré, Szilvasy, Touvron, Picard, Douze, Jégou, arXiv:2611.09501, 6 Nov 2026; code in Faiss `contrib/e_means`, Python/PyTorch/Triton, Faiss is MIT). It reaches Lloyd's 25-epoch loss in about 1.2 to 3 epochs and claims 10 to 45x GPU wall-clock speedups. It takes only dense `(n, d)` float tensors, has no sets or categorical support, no incremental insertion (training needs `n` up front; `assign` labels new points without moving centroids), and no guarantee. At our size (10^5 members, tens of features) Lloyd's k-means already runs in seconds, so e-means solves a problem we do not have. Its ideas worth keeping are small: split the largest cluster to revive an empty one (gives balanced buckets), and finish on exact cluster means.

2. **Clustering can be made exact for us, because exactness never depends on the quality of the clustering.** Any partition (k-means, k-modes, Leiden, a geo grid, a categorical signature) can be the bucket key, as long as each bucket's summary (tag-set unions, smallest set sizes, trait boxes, standing range, largest uncertainty, a pack bound) is computed exactly from its members. The per-term bounds are monotone, so the bucket bound is never below any member's pair value (`lawBucketBoundSound` already exists in `spec/candidateSearch.md` and is not used by `search.ts` today). Visiting buckets best-bound-first and stopping when the k-th kept value beats the best open bound gives the exact brute-force top k; a spent budget reports the open bound, exactly as today. The clustering algorithm itself stays outside the proof, as an untrusted oracle.

3. **Why Friend and Date fail at 100,000 today (diagnosis from the code).**
   - **Friend fails on touches, not checks.** The touch limit is `8 x 600 = 4,800`. One activity tag held by about 19% of members has a window range of about 0.19 x W entries; for a window of W = 30,000 (estimate) that is 5,700 entries, so the walk spends its touch limit inside the first posting, `walkSpent` becomes true with almost every tag still open, and the untouched bound stays near full value. The search cannot close exact. Friends supplies no pack value, so the bound of a touched friend candidate is already its exact value; the problem is only that the walk cannot reach or exclude the rest of the window.
   - **Date fails mostly on checks.** The touched-candidate bound counts the pack term at full value. Date weighs the pack term 3 of 8 (slop has no traits, so closeness weighs 0), so the bound is too high by `3/8 x (1000 - packValue)` in each direction; with typical `datePackValue` products around 300 to 600 (estimate from `score.ts`: every unknown field multiplies by `unknownField`, plus logistics and body-type factors), that is 150 to 260 points of slack. Every candidate within that slack of the top tag scores must be checked, which matches the measured 438 checks per profile. Date also needs no shared tag (pack alone gives `3/8 x 1000 = 375`, above the floor 350), so it walks the whole window, and the window is wide: the half-width is `15 + u_a + 20`, and Date uncertainties are 12 to 20 (`standingUncertainty(photos)`: 20 minus 2 per photo), so the window is plus or minus 47 to 55 points of a 0..100 scale.
   - **Ranking quality** (AUC Friend 0.60, Date 0.58, Intro 0.56) is a separate problem. Clustering for search does not change which pairs are best under the current pair value; it only finds them faster. Quality gains come from new signals (section 8) and from the member-request path, which produces 88% of ntwrk meetings and does a linear scan of all members per request (`searchFor`, network.ts:2731) with no lane vectors.

4. **The proposals that move the measured numbers, in order** (section 10 has the full list):
   1. A pack upper-bound hook for touched candidates (Date): the bound becomes the exact value except for the gate. S effort, exact.
   2. Bucket summaries on a small hierarchy (segment, then standing slice, then a categorical or tag-signature cluster), visited best-bound-first, using the unused least-penalty bound. M to L effort, exact.
   3. Combination postings ("c-subset postings": one posting per c-subset of a member's tags) for dense-tag lanes (Friend affinity, Hire seeks): by the pigeonhole principle, after walking a member's c-subset postings, every untouched partner shares at most c - 1 tags. Expected touches drop from about 0.19 W per tag to about W x 0.19^c per subset. M effort, exact.
   4. Geo-ordered segment walk for Friend (closeness bound per neighbourhood segment). S effort, exact, modest gain (at most about 111 utility points of geo closeness).
   5. Uncertainty classes in the index order (window per class ceiling instead of the global ceiling 20). S effort, exact, modest gain (about 15% narrower windows for Date, estimate).
   6. Warm start from cached kept lists, formed circles, crews and similar members. S effort; the exact result does not change; cost falls because the k-th kept value rises early.
   7. Incremental index: a main index plus a small delta index (LSM style), cached results with a re-validation certificate, and reverse insertion with a per-bucket "least k-th kept value". M effort, exact.

5. **Benchmarks** must report touches and bound evaluations, not only pair checks, because a flat bucket list moves the n^2 cost from pair checks into bound evaluations. Section 9 proposes a scale sweep, an adversarial dense-tag world, a slope gate on log(touches per profile) against log N, and many-seed paired comparisons (the measured noise is large: a neutral tie-break moved pooled meetings from 174 to 132).

---

## 1. e-means: what it is and whether we can use it

### 1.1 Sources opened

- Project page: https://e-means.github.io/ (opened).
- Paper: S. Bessa, P.-E. Mazaré, G. Szilvasy, H. Touvron, D. Picard, M. Douze, H. Jégou, "e-means: outperforming k-means (in one-tenth the epochs)", arXiv:2611.09501v1, submitted 6 November 2026, cs.LG and cs.AI, https://arxiv.org/abs/2611.09501 (abstract opened). No venue is given.
- Code: https://github.com/facebookresearch/faiss/tree/main/contrib/e_means (directory listing and README opened). Files include `e_means.py`, `e_means_torch.py`, `e_means_spherical.py`, `e_means_quantized.py`, `e_means_distributed.py`, `e_means_grouping.py`, Triton and CuTe assignment kernels, `ivf_flat.py`, `sharded_centroids_ivf.py`. Language: Python with PyTorch, Triton and CuTe GPU kernels; NumPy CPU path through `faiss.knn` in float32.
- Licence: the Faiss repository licence is MIT (https://github.com/facebookresearch/faiss/blob/main/LICENSE, opened). The `contrib/e_means` folder has no separate licence file in the listing I saw.
- Not opened: the page's playground, video and results-map pages, and the release post on X.

### 1.2 Objective and algorithm

- Objective: standard k-means mean squared error, `MSE(X, C) = (1/n) sum_i ||x_i - c_a(i)||^2` with `a(i) = argmin_j ||x_i - c_j||^2`, over dense real vectors.
- State: for each cluster j a running sum `S_j` and count `N_j`; the centroid is `S_j / N_j`.
- Mini-batch step: assign the batch to nearest centroids, then `S_j <- (1 - alpha) S_j + alpha s_j`, `N_j <- (1 - alpha) N_j + alpha n_j` (exponential moving average). With `B = n` and `alpha = 1` one step is one Lloyd iteration.
- Hyperparameters from fitted scaling laws (README): batch size `B = 0.035134 k^0.1347 n^0.8765 T^0.8133` ("throughput" law; the "quality" law uses batches about 8x smaller), `alpha0 = 0.8244 k^-0.4617 B^0.9003 n^-0.4498 T^-0.1057`, cosine decay of the step to `0.1 alpha0`. Default 5 epochs.
- Dead clusters: a cluster whose running count falls below 0.1 x mean is revived by splitting a busy cluster chosen with probability proportional to its size (the page reports 47 dead clusters with this rule against 2,343 for EnCodec-style resampling and 4,313 with revival off, on DEEP 1M with k = 16,384).
- Finalization: the last epoch's exact cluster means.
- Seed: `seed` (default 1234) seeds start centroids, shuffling and revivals. No broader determinism claim (GPU reductions are not bitwise deterministic in general [unverified for this code]).

### 1.3 Results, comparisons, limits

- Compared against Lloyd's k-means (Faiss), k-means++ initialisation, MacQueen's online k-means, staleness-reduction mini-batch k-means, gradient-descent centroid updates and Flash-KMeans (arXiv:2603.09229, not opened).
- Claims: Lloyd's 25-epoch loss within about 1.2 to 3 epochs (1.4 to 2.6 in the abstract; 1.6 to 2.4 on the 11 VIBE embedding datasets); 10 to 45x faster than Flash-KMeans on GPU, 8 to 15x faster than Faiss on CPU; DINO10B (10^10 vectors) into 16 million clusters in 2.5 epochs; fewer bad local minima on toy data (one five-blob case: Lloyd stuck on 46% of starts, e-means 0%), but still 4% stuck on one nine-blob case.
- Limits stated or visible: empirical only, no convergence proof; scaling laws fitted on specific embedding datasets; designed for static data (the page contrasts it with moving distributions); no balanced-cluster mode; no incremental update of centroids; dense float input only (FP32/FP16/BF16/FP8/INT8 codes; no sparse, no binary, no sets).

### 1.4 Does it apply to our data?

| Question | Answer for us |
|---|---|
| Sets and categorical features? | No. It needs dense vectors. Interest tag sets could be one-hot encoded (a 42-dimensional 0/1 vector for Friend), but squared Euclidean distance on 0/1 vectors is the Hamming distance, which ignores our directed coverage terms; k-modes (Huang 1998) is the natural categorical method. |
| Incremental insertion? | No. `assign` maps a new vector to the nearest existing centroid; centroids do not move. |
| Integer, deterministic, provable? | No. Floats, GPU kernels, random batches. It can only be an untrusted oracle that proposes a bucket id. |
| Speed need? | None. For n = 10^5 and d about 50, k = 1,000, one Lloyd epoch is about 5 x 10^9 multiply-adds (estimate), seconds on one CPU core in native code. e-means pays off when n x k is above about 10^10 (README: "recommended when n x k > 10^10" for GPU). |
| Ideas to reuse | (1) Split-the-largest revival keeps bucket sizes even, which helps block-max bounds (a bucket of 5,000 members has a useless union). (2) Finish on exact means. (3) An EMA centroid update is a cheap way to drift centroids weekly without a full retrain, if we ever use centroids. |

**Verdict.** Do not adopt e-means. If we want a learned partition of a dense embedding (for example a future text embedding of profiles), plain seeded k-means or k-modes on CPU is enough and simpler to reproduce. The partition is only a bucket key (section 4), so its loss does not affect exactness, only speed.

---

## 2. What the search does today, and why it stops

### 2.1 Mechanism (search.ts, index.ts)

- Blocks by `(lane, side, market)`; inside a block, members sorted by `(segment, standing, ordinal)`. Postings per tag for offers, seeks, interests hold block positions.
- Window: the standing range `standing - offset +/- (band + u_a + 20)` inside each segment the member reaches.
- Walk: the window range of each of the member's tags (affinity: a's interests in their interests; complement: a's seeks in their offers; returned: a's offers in their seeks), rarest first. Each visited entry costs one touch; the limit is `searchTouchesPerCheck x budget = 8 x 600 = 4,800`.
- Touched candidate bound: the full lane pair value with the pack term at 1000 (tags, closeness, standings, exchanges exact).
- Untouched bound: `open[g]` = number of not fully walked tag ranges in group g; a's affinity and complement bounds are coverage of `open` hits; b's direction counts full value when any relevant range is open; closeness and pack at full value; standing penalty 0 (`unseenValueBound(..., 0)`).
- When a range is at least as long as the window, it walks the whole window instead.
- Stop: `closeExact` when the kept list is full and every kept value is above `max(top touched bound, untouched bound)`; `closeBudgeted` at 600 checks, or when the walk is spent and nothing touched is left.

### 2.2 Why each lane behaves as measured

| Lane at N = 100,000 | Measured | Cause in the code |
|---|---|---|
| ntwrk Intro | 100% exact, 0.9 checks | Seeks and offers are specific; the complement weight 6 of 10 and the balance floor (each side must receive at least 200) make the untouched bound fall below the floor after a few short postings. |
| peon Hire | 70% exact, 265 checks | Complement weight 6 of 10, but some skills are common, so some postings are long; the untouched bound keeps "full coverage while a relevant range is open" for the other direction. |
| slop Date | 31% exact, 438 checks | Pack term at full value in the touched bound (slack up to 3/8 x (1000 - pack)); no shared tag needed, so the whole window is walked; the window is plus or minus 47 to 55 standing points because Date uncertainties are 12 to 20 and the window adds the global ceiling 20 for the partner. |
| friends Friend | 22% exact, 472 checks | Touch limit spent inside the first long posting (19% of the window per tag); untouched bound stays high; Friend has no standing dimension (band 100), so the window is the whole reachable segment set. |

Two more facts from the code:

- `bucketValueBound(utilityBound, otherUtilityBound, leastPenalty)` and `lawBucketBoundSound` exist in the spec and the generated code, but `search.ts` calls `unseenValueBound`, which passes a least penalty of 0. The standing-gap penalty is never used to prune. For Date (10 points per point of gap above 10) and Hire and Invest (15 per point above 5) this leaves a large, free, already-proved bound unused.
- The cost per touch is high: Friend at 100,000 took 1,474 s, about 15 ms per profile for at most 4,800 touches plus 472 checks, so about 2 to 3 microseconds per touch (estimate). Each touch builds `PairSide` objects and arrays through `pairSideOf` and `weightedTerms`. A struct-of-arrays layout (typed arrays of standings, bitsets of tags) would cut the constant 10x or more (estimate). This is not clustering, but it changes what "affordable" means; I note it so the benchmarks separate algorithmic work (touches, bound evaluations) from constant factors (ms).

---

## 3. Survey: clustering and related structures as a pruning index

For each family: what it is, data type, exact or not, incremental or not, and its fit for us. "Fit" assumes our constraints: integer, deterministic, an exact result or an honest bound, bounded pair checks.

| Family | Key sources | Data | Exact? | Incremental? | Fit for us |
|---|---|---|---|---|---|
| k-means, spherical k-means + IVF (inverted file) probing | Faiss: Douze et al., "The Faiss library", arXiv:2401.08281 (opened); Jégou, Douze, Schmid 2011 TPAMI [unverified] | dense vectors | No: a fixed `nprobe` loses recall (Faiss wiki 1M benchmark: R@1 0.41 at nprobe 1 to 0.98 at nprobe 256, opened) | assign only; retrain for drift | Only as a bucket key. Exactness needs per-list bounds, which turns IVF into our branch-and-bound. |
| e-means | arXiv:2611.09501 (opened) | dense vectors | No | No | See section 1: not needed. |
| Mini-batch k-means | Sculley, "Web-scale k-means clustering", WWW 2010 poster, pp. 1177-1178 (opened) | dense, sparse centres | No | Yes (online updates) | Same role as k-means; online drift is possible. |
| Balanced k-means | Malinen and Fränti, "Balanced k-means for clustering", S+SSPR 2014, LNCS 8621:32-41 (opened; assignment by Hungarian algorithm, O(n^3)) | dense | No | No | Balanced buckets matter for us; O(n^3) is too slow; size-capped splitting (e-means style, or recursive bisection) is enough. |
| Hierarchical k-means, ball trees, cone trees | Ram and Gray, "Maximum inner-product search using cone trees", KDD 2012 [unverified]; Elkan 2003 triangle-inequality k-means [unverified] | metric or inner product | Yes, with node bounds | rebuild or local split | The right shape: a tree of buckets with sound node bounds. Our score is not a metric, so we use per-term summaries instead of balls. |
| k-modes, k-prototypes | Huang, "Extensions to the k-means algorithm for clustering large data sets with categorical values", Data Mining and Knowledge Discovery 2:283-304, 1998 (opened) | categorical; mixed | No | assign | Good bucket key for Date lifestyle fields and tag signatures. Deterministic with a seeded start. |
| MinHash, LSH buckets | Broder 1997 (MinHash); Indyk and Motwani 1998 [both unverified] | sets (Jaccard) | No: probabilistic recall | Yes (hash on insert) | Visiting-order heuristic only. With dense tags and Jaccard 0.1 to 0.3 the band and row settings need many tables. |
| Exact set-similarity joins: prefix filter, PartEnum, PPJoin, top-k join | Arasu, Ganti, Kaushik, "Efficient exact set-similarity joins", VLDB 2006, pp. 918-929 (opened); Xiao, Wang, Lin, Yu, (Wang), "Efficient similarity joins for near duplicate detection", WWW 2008, TODS 2011 (opened); Xiao, Wang, Lin, Shang, "Top-k set similarity joins", ICDE 2009, pp. 916-927 (opened); Chaudhuri, Ganti, Kaushik 2006 ICDE prefix filter [unverified] | sets | Yes | postings append | Directly relevant: the principle "a pair with overlap at least t must share a token in a known small signature set" gives exact pruning. Prefix filtering needs rare tokens; with 42 tags at 19% each it is weak, so we use combination signatures (section 5.3). |
| Multi-index hashing | Norouzi, Punjani, Fleet, "Fast search in Hamming space with multi-index hashing", CVPR 2012, pp. 3108-3115; TPAMI 2014, arXiv:1307.2982 (opened) | binary codes | Yes (exact kNN in Hamming space by pigeonhole on substrings) | Yes | An alternative to combination postings for Friend's 42-bit interest vectors; our affinity is overlap over |I_a|, which equals (|I_a| + |I_b| - Hamming)/2 over |I_a|, so it needs a size filter as well. |
| Canopy clustering | McCallum, Nigam, Ungar, "Efficient clustering of high-dimensional data sets with application to reference matching", KDD 2000, pp. 169-178 (opened; 10x speedup on about 2,000 references) | any cheap distance | No (loose and tight thresholds) | Yes | Same role as blocking; exact only if the cheap distance bounds the real score, which is our bucket-bound approach. |
| Blocking for record linkage | Christen 2012 TKDE; Papadakis et al. 2020 CSUR [unverified] | any | Exact when the key is implied by the match predicate | Yes | We already do this with segments (geo, dating pools). Extend with more hard keys (section 7). |
| Overlapping and soft clusters | canopies; fuzzy c-means [unverified] | any | No | - | Useful for members on cluster borders: put a member in every bucket whose key it meets; the bound stays sound as long as each member is in at least one visited-or-bounded bucket. |
| Community detection: Louvain, Leiden | Traag, Waltman, van Eck, "From Louvain to Leiden: guaranteeing well-connected communities", Scientific Reports 9:5233, 2019, arXiv:1810.08473 (opened; Louvain up to 25% badly connected and up to 16% disconnected communities; Leiden guarantees connected communities) | graph | No | dynamic variants | For circles and for a warm-start order on the kept-edge graph or the meeting graph, not for exact search. |
| Incremental Leiden | Sahu, arXiv:2405.11658 (2024) and arXiv:2410.15451 (2024) (search results opened: naive-dynamic Leiden about 1.14x faster than static; plain dynamic-frontier Leiden fragments communities; the second paper adds selective refinement) | graph | No | Yes | Weekly circle refresh without a full recompute. |
| Co-clustering (bipartite) | Dhillon, "Co-clustering documents and words using bipartite spectral graph partitioning", KDD 2001, pp. 269-274 (opened) | bipartite matrix | No | No | Two-sided lanes (Hire seats and candidates, Date raters and ratees): cluster both sides at once. As a bucket key it is fine; as a quality signal see section 8. |
| Spectral clustering | Dhillon 2001; von Luxburg 2007 tutorial [unverified] | graph | No | No | Needs eigenvectors of a 10^5-node graph; no gain over Leiden for our use. |
| Streaming: BIRCH, CluStream | Zhang, Ramakrishnan, Livny, SIGMOD 1996; Aggarwal et al., VLDB 2003 [both unverified] | dense | No | Yes (CF-trees, micro-clusters) | The CF-tree idea (a tree of summaries that absorbs inserts) is exactly what our bucket tree needs for inserts; we keep integer summaries (unions, mins, ranges) instead of sums of squares. |
| Exact top-k with monotone aggregates | Fagin, Lotem, Naor, "Optimal aggregation algorithms for middleware", JCSS 66(4) 2003, PODS 2001, arXiv:cs/0204046 (opened; Threshold Algorithm is instance optimal for every monotone aggregate among algorithms without wild guesses) | sorted lists | Yes | lists append | The theory under our search: the posting walk is a TA variant. |
| Block-max indexes | Ding and Suel, "Faster top-k document retrieval using block-max indexes", SIGIR 2011, pp. 993-1002 (opened; per-block maximum scores let whole blocks be skipped, exact) | postings | Yes | blocks rebuilt on merge | The direct model for bucket summaries. |
| Reverse nearest neighbours | Korn and Muthukrishnan, "Influence sets based on reverse nearest neighbor queries", SIGMOD 2000, pp. 201-212 (opened) | metric | Yes | Yes | The "which existing members does a new member enter the top k of" question (section 6.3). |
| Graph ANN (HNSW, NN-Descent) | Malkov and Yashunin, TPAMI 2020, arXiv:1603.09320 [unverified]; Dong, Charikar, Li, WWW 2011 [unverified] | metric or similarity | No | Yes | Not for us: no bound, non-metric reciprocal score; jevector measured 37 to 88% top-5 recall at 1,024 profiles (D-theory.md). |

Two lessons from this survey:

1. **Every exact method in the list is a filter-and-verify with a sound bound** (TA, block-max WAND, PartEnum, multi-index hashing, cone trees, RNN with R-trees). The clustering only decides the shape of the blocks. So we keep our proof structure and add better summaries.
2. **Dense, uncorrelated tags are the hard case for all of them.** A bucket of 10 random Friend members already holds about 88% of the 42 tags in its union (1 - 0.81^10, estimate); a block-max bound on affinity is then about full value. The known fix is signatures that are rare even when single tokens are common: combinations of tokens (PartEnum, multi-index hashing). That is section 5.3.

---

## 4. Exact branch-and-bound over clusters, for our pair value

### 4.1 Bucket summaries (all integers)

For a bucket B (any set of members of one partner block; the key can be anything) store:

| Field | Definition | Used for |
|---|---|---|
| `count` | members in B | cost |
| `standingLow`, `standingHigh` | min and max standing | window test and least penalty |
| `uncertaintyHigh` | max uncertainty | window test per bucket |
| `offersUnion`, `seeksUnion`, `interestsUnion` | unions of tag sets (bitsets: tag ids are dense per run) | coverage bounds |
| `seeksLeast`, `interestsLeast` | least nonzero size of seeks and interests in B, and flags `seeksEmptyAny`, `interestsEmptyAny` | reverse-direction coverage bounds |
| `interestsMost` | largest interest set size | cap on overlap |
| `traitLow[d]`, `traitHigh[d]` | per trait dimension | closeness bound |
| `segment set` | segments present | reach test |
| pack summary | pack-defined (section 4.3) | pack bound |

### 4.2 Per-term bounds for a searching member a and bucket B

Notation: `cov(h, w) = coverageValue(h, w)` (0 when w <= 0; else 1000 x min(h, w) / w, floor). All bounds are maxima over b in B.

- **a's complement** (a receives): hits(b) = |S_a ∩ O_b| <= |S_a ∩ offersUnion_B| =: X. Bound `cov(X, |S_a|)`. Sound because coverage is monotone in hits for a fixed denominator.
- **a's affinity**: hits <= min(|I_a ∩ interestsUnion_B|, interestsMost_B) =: Y. Bound `cov(Y, |I_a|)`.
- **b's complement** (b receives from a): `cov(h_b, |S_b|)` with h_b <= min(|offers_a ∩ seeksUnion_B|, |S_b|). For a fixed cap X' = |O_a ∩ seeksUnion_B|, the function `s -> 1000 x min(X', s) / s` is 1000 for s <= X' and falls for s > X', so its maximum over the sizes present is at the least nonzero size: bound `cov(min(X', seeksLeast_B), seeksLeast_B)`; a member with empty seeks contributes 0, which is below that. When every member has empty seeks the bound is 0.
- **b's affinity**: same with `interestsUnion_B` and `interestsLeast_B`.
- **closeness** (symmetric): per dimension the distance from `trait_a[d]` to the interval `[traitLow[d], traitHigh[d]]` (0 inside); bound = `meanCloseness` of those distances. Sound because `closenessValue` does not increase with the distance, and the floor of a mean of larger terms is not smaller.
- **pack**: `packBound(a, B)` from the pack, default 1000 (section 4.3).
- **exchange** (balance lanes Cofounder and Intro): a's exchange bound = a's complement bound; b's exchange bound = b's complement bound. `unseenValueBound` already refuses when an exchange bound is below the floor.
- **standing**: `leastGap = distance from (standing_a - offset) to [standingLow, standingHigh]`. If `leastGap > band + u_a + uncertaintyHigh_B`, no member of B is admissible: the bucket bound is `noPairValue` and the bucket is skipped without a touch. Otherwise `leastPenalty = parityPenalty(leastGap, freeGap, perPoint)`.
- **segment**: if no segment of B is reached by a (and a has a segment), skip B.

Then:

```
mine   = directedUtility(weightedTerms(weights, hasTraits, hasPack, {complement: aCompl, affinity: aAff, closeness: clos, pack: packBound}))
theirs = directedUtility(weightedTerms(weights, hasTraits, hasPack, {complement: bCompl, affinity: bAff, closeness: clos, pack: packBoundReverse}))
U(a, B) = if mine < floor or theirs < floor or (balance and (aCompl < exchangeFloor or bCompl < exchangeFloor)) then noPairValue
          else bucketValueBound(mine, theirs, leastPenalty)
```

**Soundness** (`U(a, B) >= pairValue(a, b)` for every b in B) follows from facts we already prove: `directedUtility` is monotone in each term value for nonnegative weights (needs one new law, `lawDirectedUtilityMonotone`; it is a weighted mean with floor division and a fixed positive denominator, so it is a short Dafny proof), `harmonicValue` is monotone (`lawHarmonicMonotone`), the floors are the only admission conditions that read utilities, and `lawBucketBoundSound` covers the least penalty. The new spec function is a combination of `unseenValueBound` and `bucketValueBound` with a least penalty; I suggest adding `bucketPairBound(utilityBound, otherUtilityBound, exchangeBound, otherExchangeBound, leastPenalty, rules)` with a law `lawBucketPairBoundSound` that has the same shape as `lawUnseenBoundSound`, plus a pure per-term law for each summary rule (`lawUnionCoverageBound`, `lawLeastSizeCoverageBound`, `lawIntervalClosenessBound`, `lawLeastGapPenaltyBound`). Each is a small arithmetic lemma that fits LemmaScript and Dafny.

What stays outside the proof: the code that computes unions, minima and ranges from the members (a loop; covered by an integration or sim check that recomputes each summary from scratch and compares) and the clustering that chooses the buckets (needs no proof).

### 4.3 The pack bound hook

Add an optional `packBound?(w, a, summary)` and `packBoundPair?(w, a, b)` to `PackVectors`, each returning an integer that must be at least `packValue(w, a, b)` for every b it covers. Default 1000. Two uses:

1. **At touch time** (`packBoundPair`): for slop, compute the real `datePackValue` (it is arithmetic over the two profiles and `a.history`; no model call). Then the touched bound equals the pair value except for the gate (`pairReason`), and the number of checks falls toward `searchLimit + gate refusals`. Cost: one pack evaluation per touch instead of per check. `revealedTaste` loops over a's rated history, which is small.
2. **Per bucket** (`packBound`): for slop, `compatEstimate(a, b)` without the shared-interest factor depends on b only through `(goal, smoking, drinking, hasKids, wantsKids, religionImportance, politics)` and a's own fields. If a Date bucket key includes that lifestyle signature (exact categorical key, a degenerate k-modes with zero error), the compat factor per bucket is exact; the other factors take their maxima: shared interest `K.sharedInterest[min(2, |I_a ∩ interestsUnion_B|)]`, activity miss at most 1, `exp(typeWeight x min(2, typeBound))` where typeBound uses per-dimension ranges of b's `self` vector in the bucket, the learned factor at its maximum from a's history, logistics at most 1 (or `unknownSlots` when every member of B states no free slot), body type at its maximum over the body types present.

Soundness obligation: `packBound >= packValue`. Because `datePackValue` uses floating point (`Math.exp`, `Math.round`), prove it by construction where it is the same function, and add a blocking sim counter ("pack bound below pack value", must be 0) where it is a separate bound, with +1 of slack for rounding. The pack value itself is already outside the proof (shell).

**Expected effect on Date** (estimate from the code, to be measured): the touched bound slack falls from up to `3/8 x (1000 - pack)`, i.e. 150 to 260 points, to 0. The check count then depends on the gate refusal rate, not on the bound. Touches are unchanged by use 1; use 2 needs buckets (section 5.2) to cut touches.

### 4.4 Visiting order and stop rule

Keep the generated `candidateSearch` machine as it is. Replace "walk the next shortest posting" by a single priority queue over three kinds of items:

1. a bucket (key: its bound `U(a, B)`),
2. a posting range (key: the untouched bound that walking it would allow, as today),
3. a touched candidate (key: its candidate bound).

At each step: `unseen = max(top bucket bound, top touched bound, untouched-posting bound)`. If `closeExact(unseen)` is enabled, stop. Otherwise, if the top item is a bucket, open it (one touch per member, each touched member gets a candidate bound and enters the queue); if it is a touched candidate, check it. Ties: bucket keys by (bound desc, bucket index asc), candidates by (bound desc, ordinal asc), as now. The exact theorem is unchanged in form: every untouched member is in an unopened bucket whose bound is at most `unseen`.

### 4.5 The hierarchy (needed to avoid moving n^2 into bound evaluations)

A flat list of buckets costs one bound evaluation per bucket in the window per search. With N = 100,000 and buckets of 64, that is about 1,500 bound evaluations per search, so total work is still about N^2 / 64. Use a tree: block -> segment -> standing slice -> signature cluster -> leaf (at most 64 members). A node's summary is the union, minimum or range of its children's summaries, so node bounds are sound for the same reasons, and a node bound is at least each child's bound (monotone). Best-first search over the tree (the classic branch-and-bound of cone and ball trees) opens a node only when its bound beats the current k-th kept value. Cost per search is then the number of nodes whose bound exceeds the final k-th value, times the fan-out. That number is data-dependent; we must measure it (section 9) and keep the existing budget as the honest backstop: when the budget is spent, report the best open node bound.

### 4.6 Budget fallback

Add one counter `boundEvaluations` with its own limit (for example `4 x searchBudget`), counted like touches. When any limit is reached, close Budgeted with `unseenBound = max over open items`. This keeps the guarantee "cost per search is bounded by a constant" and "every missed candidate has a value at most `unseenBound`".

---

## 5. Lane by lane: what clustering key would separate members

The test for a useful key is simple: **a key helps pruning only if it enters a term of the pair value bound.** A key that is not in the pair value (age band and life stage are not Friend traits today) can make buckets homogeneous but cannot make a bound smaller.

How much each term can separate, in utility points (weights from `spec/matchLane.md`):

| Lane | weights (compl, aff, clos, pack), sum | Most a term can move one utility |
|---|---|---|
| Friend | 1, 6, 2, (pack 0: friends supplies none), sum 9 | affinity 667; closeness 222 (4 trait dimensions, each at most 55); complement 111 |
| Date | 3, 2, (closeness 0: slop has no traits), 3, sum 8 | complement 375; pack 375; affinity 250; plus the standing penalty, 10 per point above 10 |
| Hire | 6, 1, 2, 1, sum 10 | complement 600; plus penalty 15 per point above 5 |
| Intro | 6, 2, 1, 1, sum 10 | complement 600; balance floor 200 each way |

### 5.1 Friend at 100,000

Candidate keys and their worth:

- **Geo cell** (home neighbourhood): already the segment, so the reach test is exact. Geo is two of the four closeness dimensions (cost 50 per km, 0 at 20 km): at most 2 x 55 = 111 utility points. A geo-ordered walk (open segments in order of their closeness bound) prunes only far segments, and only when the kept values are within 111 points of the best possible. Useful but modest.
- **Schedule** (weekend lean, cost 1 per permille): one closeness dimension, at most 55 points.
- **Social energy** (cost 250 per step): one dimension, at most 55 points.
- **Age band, life stage**: not in the Friend pair value today, so no pruning value. If the product wants them, they enter as traits (closeness) or as hard segments (for example 18 to 20 only with 18 to 25), and then they become keys.
- **Activity-set signature**: affinity carries 667 points, so this is the only key that can separate strongly. But with about 42 tags held by about 19% of members each, and no strong correlation, buckets by signature have broad unions; the union bound is near full value above about 10 members per bucket.

Conclusion: clustering alone (any algorithm) will not make Friend exact at 100,000 if interests are close to independent. The tool that works is a signature that is rare even when single tags are common:

### 5.2 Combination postings (c-subset postings), exact

Index, for each member b and a fixed c, one posting entry for each c-subset of b's interest tags (key: the sorted c-tuple of tag ids; entries sorted by block position like every posting, so the existing `windowRanges` code applies). A search walks a's c-subset postings inside the window.

**Lemma (pigeonhole, `lawSubsetPostingComplete`).** If `|I_a ∩ I_b| >= c` then some c-subset T of `I_a ∩ I_b` exists, T is a c-subset of both I_a and I_b, so b is in posting(T). Therefore after all of a's c-subset postings in the window are walked, every untouched b has `|I_a ∩ I_b| <= c - 1`, and the untouched affinity bound becomes `cov(min(c - 1, ...), |I_a|)`. This plugs into the existing `open` accounting.

**Cost model** (estimate, assuming independent tags with density rho and window size W): posting size about `W x rho^c`; a member with m tags has `C(m, c)` postings. With rho = 0.19, W = 30,000, m = 8:

| c | entries per posting | a's postings | touches to walk all | index entries per member |
|---|---|---|---|---|
| 1 (today) | 5,700 | 8 | 45,600 | 8 |
| 2 | 1,083 | 28 | 30,300 | 28 |
| 3 | 206 | 56 | 11,500 | 56 |
| 4 | 39 | 70 | 2,740 (under 4,800) | 70 |

So c = 4 fits the touch limit at 100,000 under these assumptions. Memory: 7,000,000 entries for 100,000 members (28 MB as 32-bit positions). Members with many tags explode `C(m, c)`; cap it: a member with more than `m_max` tags (say 12, C(12,4) = 495) goes into one "overflow" posting that every search walks. Soundness holds because the overflow posting is always walked.

**Is the result exact?** Only if the stop rule fires: after the c-subset walk, the untouched affinity bound is `(c - 1)/|I_a|`. For a = 8 tags and c = 4 that is 375; the Friend utility bound of an untouched partner is about `(6 x 375 + 2 x 1000 + 1 x 1000)/9 = 583` (closeness and complement at full value). Under independence, a member has on average about 0.4 partners in a 30,000 window who share at least 5 of 8 tags, and about 1,200 who share exactly 4 (estimate: `C(8,4) rho^4 (1-rho)^4 W`). The 12th best of those 1,200 needs closeness above about 750 and some complement to beat 583. So in an independent-tag world the search will often still end Budgeted, but with a much smaller reported bound. In a world with correlated interests (the planted circles, and real people) overlaps concentrate and the stop fires far more often. Combine with the geo-ordered segment walk (5.1) so the closeness term of the untouched bound falls too. **Measure, do not assume.**

The same construction works for **Hire** on the candidate's seeks covered by the seat's offers (complement weight 6 of 10): walk the c-subsets of a's seeks in the offers postings.

Alternative with the same exactness: multi-index hashing on 42-bit interest vectors (Norouzi et al. 2012): split the 42 bits into s substrings; if the Hamming distance is at most r, some substring differs in at most floor(r / s) bits. Our affinity is an overlap ratio, so it needs a size filter too; c-subset postings fit our existing posting code better.

### 5.3 Date at 100,000

- **Uncertainty classes in the index order.** Sort each segment by (uncertainty class, standing). For a class with ceiling `u_c`, the window half-width is `band + u_a + u_c` instead of `band + u_a + 20`. The law is the same as `lawWindowComplete` with `u_c` in place of the global ceiling. Date uncertainties are `20 - 2 x photos`, floor 3: with classes {<= 12, <= 16, <= 20} a 4-photo partner class is searched with half-width `15 + u_a + 12` instead of `15 + u_a + 20`, about 15% narrower (estimate). Exact, S effort, modest.
- **Standing slices with the least penalty.** Date pays 10 per point of gap above 10, inside a window of plus or minus 47 to 55. A slice at gap 40 has a least penalty of 300. Once the pack bound is tight (4.3), the slice bound `H(bounds) - leastPenalty` prunes the outer slices. Exact (the law exists).
- **Lifestyle signature buckets inside a slice** (section 4.3, use 2): exact pack bound per bucket.
- **Pools and cells**: already segments.

Order of work for Date: pack bound at touch (S), then slices with least penalty (S, uses an existing law), then lifestyle-signature buckets (M).

### 5.4 Intro (ntwrk) and the request path

Intro is already exact with 0.9 checks per profile; clustering will not help it. Two things do matter:

- **The request path is a linear scan** (`searchFor` loops over `this.members` for each request and computes `askFit` for each), and it produces 88% of ntwrk meetings. At 100,000 members and one request per member per week this is 10^10 `askFit` calls a week (estimate), the n^2 problem the founder wants to avoid, and it ignores the lane values, the parity band and the balance rule. Route requests through the same index: a request is a temporary membership with `seeks = request tags`, searched in the Intro (or the relevant) lane block, and then `askFit` re-ranks only the kept list. That gives a bounded, exact or bounded-reported search, and it applies the same pair gate to requests and proactive proposals.
- Quality (AUC 0.56) is a signal and extraction question (the unmerged extraction change gave 0.69), not a search question.

### 5.5 Hire, Cofounder, Mentor, Invest

Hire (70% exact) gains from c-subset postings on seeks (5.2) and from standing slices with the least penalty (15 per point above 5: a slice at gap 15 has a least penalty of 150). Cofounder is a peer lane with the balance rule, so its exchange-floor pruning already works like Intro's. Mentor and Invest are two-sided with small budgets (400); the same tools apply.

---

## 6. Caching early work for later work

### 6.1 Warm start (the result does not change)

Before the normal walk, check a short list of likely partners and put them in the kept list. Sources:

- the member's own kept list from last week (still valid partners mostly);
- members of the member's formed circles and crews, and past good matches' kept lists;
- the kept list of a **similar member** (same bucket or same signature): "if two people are similar, their best partners overlap". In Date this is exactly the founder's example: two women with similar profiles and standing have overlapping top men.

Why it helps: the stop rule needs the k-th kept value to beat the best open bound. A good warm start raises the k-th value at the start, so more buckets and postings are pruned. Why it is safe: the search machine accepts checks in any order; exactness depends only on the untouched bound covering every candidate not yet touched, and warm-start candidates are marked touched. **The exact result is identical with or without the warm start.** Only Budgeted results change (they become better), and the budget includes the warm-start checks, so the cost bound still holds. Effort S.

### 6.2 Cached results with a certificate (weekly re-runs)

Keep, for each member x, the last kept list, its k-th value `kth(x)` and whether it was exact. Next week, x's result is still exact without a new search when all of these hold: x's own profile did not change; none of x's kept partners left, changed, or became gated (re-check the k kept pairs: k checks); and no new or changed member y has `pairValue(x, y) > kth(x)`. The last condition is the reverse question in 6.3. A member whose kept partner left falls back to a new search with a warm start. This turns the weekly run into "re-check k pairs per member plus searches for changed members", which is close to linear in the number of changes.

Capacity changes do not invalidate a search result (capacity applies in selection), and blocks are applied by the gate at check time, so a re-check of the kept pairs catches them.

### 6.3 Adding members without recomputing everything

- **Index.** Positions in the sorted block shift on insert. Use a main index rebuilt on a schedule plus a small delta index for new and changed members (log-structured merge, as Lucene segments do [unverified as a citation; standard practice]). A search runs on both and merges: the kept list is the best k of the union, and `unseenBound = max(main unseen, delta unseen)`. Removed or changed members are tombstones refused by the gate. Exactness holds because each part is exact or bounded and the merge keeps the best k. Effort M.
- **Reverse insertion** (which existing members' top k does the new member y enter?). Store for each leaf bucket of searchers `kthLeast(B) = min over x in B of kth(x)`. The pair value is symmetric, so `U(y, B)` bounds `pairValue(y, x)` for every x in B. Only buckets with `U(y, B) > kthLeast(B)` can contain a member whose list y changes; check those members. This is the reverse-nearest-neighbour idea (Korn and Muthukrishnan 2000) with our bucket bounds. Exact. Effort M (it needs the bucket tree of section 4.5).
- **Clusters.** New members are assigned to the nearest existing bucket key (k-modes `assign`, or the exact categorical signature), and leaves split when they pass the size cap. A full re-cluster can wait for the scheduled rebuild because a poor bucket only costs speed, never exactness.
- **Circles.** Incremental Leiden (Sahu 2024) can refresh communities on the meeting or kept-edge graph; note his report that naive dynamic-frontier Leiden fragments communities, so use the variant with selective refinement or recompute weekly (the graph is sparse: at most about 2k edges per member).

### 6.4 What can NOT be cached

- A similar member's result cannot be copied: the gate (blocks, holds, minors), segments, and directed utilities differ. Use it only as a warm start.
- There is no useful Lipschitz bound between two similar searchers' values in general: coverage is a ratio with each member's own denominator, so one extra seek tag changes a's complement for every partner. Do not build a proof on "similar members have similar values".

---

## 7. Cliques, circles and crews as clusters to search first

### 7.1 How to use them

- **Warm start** (6.1): check circle mates, crew mates and their good past matches first. Exactness is unchanged.
- **Circle growth.** Today circles grow from triangles. A Leiden run on the kept-edge graph with the Constant Potts Model (CPM) quality and the resolution set to the circle pair floor (in value units) maximises `sum over communities (internal edge value - floor x C(n_c, 2))`, i.e. it prefers groups whose average pair value is above the floor. This is a candidate generator only: every circle is still admitted by the proved `circleCoherent` (every pair at the floor, standing spread in the band). Traag et al. 2019 give connected communities, which avoids Louvain's disconnected ones (up to 16% in their tests). The CPM link to the floor is my suggestion, not from a paper.

### 7.2 Echo-chamber risk

- If "search only within cliques" were a hard restriction, members would see the same small world forever, exposure would concentrate, and exactness would be lost (a better partner outside the clique would never be checked). Do not restrict; only reorder.
- Even as a reorder, Budgeted searches would favour the member's existing neighbourhood. Keep the exploration phase and the exposure floor in selection as they are, and measure: the share of proposals to members with no previous connection to the member's circles, and the exposure Gini, before and after (section 9).
- Interaction-graph communities are built from meetings, which depend on past proposals; using them as a quality signal (not just an order) would feed popularity back into matching. The standing rule forbids acceptance and popularity counts as standing inputs; a community feature in the pack value would be close to that line. I recommend order-only use unless the founder decides otherwise.

---

## 8. Quality, not only speed

Clustering for search finds the same pairs faster. Clustering can also add signal:

1. **Collaborative taste (dating).** Xia, Liu, Sun, Chen, "Reciprocal recommendation system for online dating", ASONAM 2015, arXiv:1501.06247 (opened): similarity of users from who they message and who messages them; collaborative-filtering methods beat content-based ones in precision and recall on a large Chinese dating site. Our version within the rules: co-cluster raters and ratees on post-date ratings (Dhillon 2001 style), and add a smoothed cluster-pair taste term to the pack value. Risk: the ratee-cluster marginal is a popularity signal; `score.ts` states "No property of one member alone enters the pack value", and standing must never read acceptance counts. A cluster-pair term is not one member's property, but it is near the line. **Founder decision needed.** slop already has the per-member version (`revealedTaste`, from a's own ratings).
2. **Two-sided lanes.** Co-clustering seats and candidates on skills gives taste clusters ("this kind of seat hires this kind of candidate") from outcomes. Same caution.
3. **Friend and Date AUC is limited by visibility** ("the simulated chemistry is not visible before a meeting", migration report). No clustering fixes missing signal; better extraction (more specific tags; schedule overlap as a term, not only as a lean; life stage as a trait) does. That belongs to the data-quality agents.
4. **Circles**: Leiden-CPM candidates (7.1) can raise mean pair value in circles at the same floor; measure ARI on planted worlds (now 0.87 against 0.01 random) and attendance.
5. **Signifiers as hard keys.** Orientation and gender pools are already Date segments (own pool, partner pools). Trans and non-trans identity, and openness to trans partners, fit the same mutual-reach segment model (own `woman:trans`; partners lists the pools the member accepts): exact blocking, both sides consent. Friendship with men, women or both fits as a Friend segment component (home, tolerance class, gender, accepted genders); the segment count multiplies (neighbourhoods x tolerance classes x genders), which is fine for blocking. These keys are hard constraints, so they make buckets smaller at no cost to exactness. The product rules for them belong to the signifiers research; here I only note that the index supports them without new machinery.

---

## 9. Benchmarks so we never have n^2 problems

### 9.1 Worlds

- Planted worlds (existing `matching` block): N = 1,000; 10,000; 100,000; add 300,000 nightly; 1,000,000 as a one-off.
- **Adversarial dense-tag world** (new): 42 tags, each held independently with probability 0.19 to 0.3; all members in one segment; Friend standing constant; ties everywhere. This is the worst case for every bound and shows the honest Budgeted share.
- **Correlated world**: tags drawn from latent interest families (as the friends persona generator does with 2 to 3 favourite families).
- App persona worlds (friends, slop, peon) at their pinned seeds.

### 9.2 Metrics per lane and N

- exact share; checks, touches and bound evaluations per profile (means and p95); ms per profile;
- for Budgeted searches: `unseenBound - kth kept value` (the honest gap), p50 and p95, and the largest;
- recall at k against brute force on a fixed sample of 200 profiles per run (brute force on a sample is O(200 x N), linear);
- bound slack on checked candidates (bound minus value), which shows which term is loose;
- index build time and memory; insert cost per new member (delta index and reverse insertion);
- warm-start effect: checks before the first full kept list.

### 9.3 Gates

- Existing: kept equals brute force on exact searches (all N up to 400), `missed > bound` is 0, checks at most `N x budget`.
- **New scaling gate**: fit the slope of log(touches + bound evaluations per profile) against log N over N = 10,000 to 300,000; require a slope below 0.3 for every lane (a slope of 1 means quadratic total work). Tracked first, blocking after two weeks of data.
- **New soundness counters** (blocking, must be 0): pack bound below pack value; a bucket summary that differs from its recomputation; a member outside every bucket.
- **Quality**: AUC and precision at k against hidden good pairs; sim outcomes on at least 8 paired seeds with bootstrap confidence intervals, because the measured noise is large (a neutral tie-break moved pooled meetings from 174 to 132 on three seeds).

---

## 10. Proposals

Each with: what it changes, why, what could go wrong, how to measure, effort, exactness.

1. **Pack bound hook at touch time (Date first).** Change: `PackVectors.packBoundPair(w, a, b)`; search.ts uses it in place of 1000 for touched candidates; slop returns `datePackValue`. Why: removes up to `3/8 x (1000 - pack)` (150 to 260 points, estimate) of bound slack, the main cause of 438 checks. Risk: touch cost rises (pack arithmetic per touch); float rounding if a separate bound function is used. Measure: Date checks per profile and exact share at 10,000 and 100,000; ms per profile. Effort S. Exact: yes, given `packBound >= packValue` (by construction, plus a blocking counter).
2. **Use the least penalty: standing slices visited from the centre out.** Change: inside each segment window, treat standing ranges as buckets with `bucketValueBound(..., leastPenalty)`; open slices nearest first. Why: Date 10 per point above 10 and Hire 15 per point above 5 make outer slices worth up to 300 to 450 points less; the law exists and is unused. Risk: little gain until proposal 1 lands. Measure: touches per profile for Date and Hire. Effort S. Exact: yes (`lawBucketBoundSound`).
3. **Uncertainty classes in the index order.** Change: sort by (segment, uncertainty class, standing); window per class ceiling. Why: about 15% narrower Date windows (estimate); more for lanes with reviewed evidence (uncertainty falls to 3 after nine reviewed facts). Risk: more binary searches per search. Measure: window size per profile. Effort S. Exact: yes (a variant of `lawWindowComplete`).
4. **Combination (c-subset) postings for dense tags.** Change: optional postings keyed by c-tuples of interest tags (Friend) or seeks against offers (Hire); `open` accounting gains "untouched overlap at most c - 1"; overflow posting for members with more than `m_max` tags. Why: posting length falls from `W rho` to `W rho^c`; for rho = 0.19, W = 30,000, m = 8, c = 4 the full walk is about 2,740 touches against the 4,800 limit (estimate). Risk: index memory `sum C(m_b, c)`; in independent-tag worlds the stop still may not fire (the bound falls to about 583 for Friend); choosing c per lane needs data. Measure: Friend and Hire exact share, touches, honest gap; index size. Effort M. Exact: yes (`lawSubsetPostingComplete`, a pigeonhole lemma).
5. **Bucket tree with per-term summaries (block-max).** Change: index.ts builds segment -> slice -> signature cluster -> leaf (at most 64) with integer summaries; search.ts runs best-first over nodes, touched candidates and postings; a bound-evaluation limit. Bucket key for Date: lifestyle signature (exact categorical); for Friend: interest signature by seeded k-modes; for Hire: co-clustered skill groups. Why: skips whole groups without touching members; turns "search only within similar clusters" into exact branch-and-bound. Risk: loose unions for dense tags (bounds near 1000) unless keys are homogeneous; more code to keep in the proof map. Measure: bound evaluations and touches per profile, slope gate. Effort L. Exact: yes (new per-term laws; summaries checked by recomputation).
6. **Geo-ordered segment walk for Friend.** Change: open reachable segments in order of their closeness bound (distance from a's home to the neighbourhood). Why: up to about 111 utility points of geo closeness separate far segments. Risk: small gain alone. Measure: Friend touches and gap. Effort S. Exact: yes.
7. **Warm start from cached and related kept lists.** Change: check last week's kept list, circle and crew mates, and a similar member's kept list first. Why: raises the k-th value early, so the stop rule fires sooner; cheap. Risk: none for exact results; Budgeted results bias toward the existing neighbourhood (echo chamber) unless exploration stays. Measure: checks before the stop; exact share; share of proposals outside existing circles. Effort S. Exact: result identical when exact.
8. **Delta index, cached results with certificate, reverse insertion.** Change: main plus delta index; per-member cached kept lists with `kth`; per-bucket `kthLeast`; re-search only changed members and members whose lists a new member can enter. Why: weekly work close to linear in changes. Risk: cache invalidation bugs (a missed gate change); mitigated by re-checking the k kept pairs every run. Measure: weekly checks with 1% and 10% churn against a full run; equality of results on sampled members. Effort M. Exact: yes.
9. **Route member requests through the index.** Change: `searchFor` builds a temporary membership and asks the lane index; `askFit` re-ranks the kept list. Why: removes a per-request scan of all members (10^10 `askFit` calls a week at 100,000, estimate) and applies the parity and balance rules to the path that makes 88% of ntwrk meetings. Risk: request outcomes change (the migration report shows ranking changes can lower meetings: 174 to 150); needs many-seed measurement. Measure: meetings, everyone-yes rate, checks per request. Effort M. Exact: the index search is exact or bounded; `askFit` is a re-rank.
10. **Leiden-CPM circle candidates.** Change: seeded Leiden with CPM resolution = circle pair floor on the kept-edge graph, as an extra seed source for `circles.ts`; admission unchanged. Why: connected, dense groups; more circle candidates than triangles. Risk: nondeterminism unless seeded; more code. Measure: ARI, purity, mean and least pair value in circles, attendance. Effort M. Exactness: not a search; admission stays proved.
11. **Benchmark suite and scaling gate** (section 9). Effort M. Needed before any of the above can claim a gain.
12. **Struct-of-arrays layout for blocks** (typed arrays, tag bitsets). Change: constant factors only. Why: about 2 to 3 microseconds per touch now (estimate). Effort M. Exact: unchanged.

---

## 11. What will NOT work for us, and why

- **e-means (or any k-means) as the search.** Dense float vectors only; no sets; no incremental update; nondeterministic on GPU; no bound. As a bucket key it is unnecessary at our size.
- **IVF with a fixed nprobe, LSH or MinHash buckets, HNSW.** Recall is probabilistic or unmeasured; no stated bound; the reciprocal pair value is not a metric. They contradict "exact, or report a bound".
- **Hard "search only inside my cluster or clique".** Loses exactness (a better partner outside is never seen) and creates echo chambers.
- **Bucket unions over dense, uncorrelated tags.** With 19% density, the union of 10 random members holds about 88% of tags, so the affinity bound is near 1000 and nothing is pruned. Needs homogeneous keys or combination postings.
- **A flat list of many buckets.** Moves the n^2 cost from pair checks to bound evaluations (N / bucket size per search). Needs the tree.
- **Clustering on keys that are not in the pair value** (age band, life stage for Friend today). Makes buckets homogeneous but cannot lower a bound.
- **Copying a similar member's result.** Gates, segments and directed utilities differ; only a warm start is safe.
- **Louvain for circles.** Can produce disconnected communities (Traag et al. 2019: up to 16% disconnected); use Leiden.
- **Plain dynamic-frontier Leiden for weekly updates.** Fragments communities (Sahu 2024); use the refined variant or a weekly recompute.
- **Spectral clustering at 10^5.** Eigenvectors of a large graph for no gain over Leiden.
- **Popularity or acceptance counts as cluster features for standing.** Forbidden by `spec/memberStanding.md`.
- **Prefix filtering with single tags on Friend.** No rare tokens: every tag is about 19%, so the prefix walk is as long as today's walk.

---

## 12. Open questions

1. What is the real window size W per Friend and Date profile at 100,000 in the planted worlds? `scripts/sim/matching.ts` already records `budgeted.window` and `budgeted.shortest` for Budgeted searches; those numbers decide c for combination postings.
2. Are the planted and persona tags close to independent (worst case) or correlated? The friends persona generator lifts 2 to 3 activity families per member, so correlation exists; its strength decides how much signature clustering helps.
3. Is computing `datePackValue` per touch acceptable (cost and the privacy of `a.history` inside the index path)? It is arithmetic only, but it reads the member's own rating history.
4. Founder: may a cluster-pair taste term (from post-date ratings) enter the pack value, given the rule that no property of one member alone may enter it?
5. Founder: should Friend gain life stage, age band or schedule overlap as traits? Only terms in the pair value can prune or rank.
6. Should the touch limit become two limits (cheap bound evaluations and touches) with separate costs?
7. What size limit and rebuild schedule for the delta index fits the weekly run?

---

## 13. References

Opened in this session (bibliographic record and abstract or page seen):

- Bessa, Mazaré, Szilvasy, Touvron, Picard, Douze, Jégou. "e-means: outperforming k-means (in one-tenth the epochs)". arXiv:2611.09501, 2026. https://arxiv.org/abs/2611.09501 ; project page https://e-means.github.io/ ; code https://github.com/facebookresearch/faiss/tree/main/contrib/e_means ; licence https://github.com/facebookresearch/faiss/blob/main/LICENSE (MIT).
- Douze, Guzhva, Deng, Johnson, Szilvasy, Mazaré, Lomeli, Hosseini, Jégou. "The Faiss library". arXiv:2401.08281, 2024. https://arxiv.org/abs/2401.08281 ; IVF nprobe benchmark on the Faiss wiki https://github.com/facebookresearch/faiss/wiki/Indexing-1M-vectors
- Ding, Suel. "Faster top-k document retrieval using block-max indexes". SIGIR 2011, pp. 993-1002. https://research.engineering.nyu.edu/~suel/papers/bmw.pdf
- Fagin, Lotem, Naor. "Optimal aggregation algorithms for middleware". JCSS 66(4), 2003 (PODS 2001). https://arxiv.org/abs/cs/0204046
- Arasu, Ganti, Kaushik. "Efficient exact set-similarity joins". VLDB 2006, pp. 918-929. https://www.microsoft.com/en-us/research/publication/efficient-exact-set-similarity-joins/
- Xiao, Wang, Lin, Yu (and Wang in TODS). "Efficient similarity joins for near duplicate detection". WWW 2008; TODS 36(3), 2011. https://archives.iw3c2.org/www2008/papers/pdf/p131-xiaoA.pdf
- Xiao, Wang, Lin, Shang. "Top-k set similarity joins". ICDE 2009, pp. 916-927. https://pubs.dbs.uni-leipzig.de/dc/files/Top-k%20Set%20Similarity%20Joins.pdf
- Norouzi, Punjani, Fleet. "Fast search in Hamming space with multi-index hashing". CVPR 2012, pp. 3108-3115; TPAMI 2014, arXiv:1307.2982. https://arxiv.org/abs/1307.2982
- Huang. "Extensions to the k-means algorithm for clustering large data sets with categorical values". Data Mining and Knowledge Discovery 2:283-304, 1998. https://cse.hkust.edu.hk/~qyang/537/Papers/huang98extensions.pdf
- Sculley. "Web-scale k-means clustering". WWW 2010 (poster), pp. 1177-1178. https://ir.webis.de/anthology/2010.wwwconf_conference-2010.170/
- Malinen, Fränti. "Balanced k-means for clustering". S+SSPR 2014, LNCS 8621:32-41. https://researchr.org/publication/MalinenF14
- McCallum, Nigam, Ungar. "Efficient clustering of high-dimensional data sets with application to reference matching". KDD 2000, pp. 169-178. https://pubs.dbs.uni-leipzig.de/dc/files/McCallum2000Efficientclusteringofhighdimensionaldatasetswith.pdf
- Traag, Waltman, van Eck. "From Louvain to Leiden: guaranteeing well-connected communities". Scientific Reports 9:5233, 2019. https://arxiv.org/abs/1810.08473
- Sahu. "A starting point for dynamic community detection with Leiden algorithm". arXiv:2405.11658, 2024; "Heuristic-based dynamic Leiden algorithm for efficient tracking of communities on evolving graphs". arXiv:2410.15451, 2024. https://arxiv.org/abs/2405.11658 , https://arxiv.org/abs/2410.15451
- Dhillon. "Co-clustering documents and words using bipartite spectral graph partitioning". KDD 2001, pp. 269-274. https://bigdata.oden.utexas.edu/publication/co-clustering-documents-and-words-using-bipartite-spectral-graph-partitioning/
- Korn, Muthukrishnan. "Influence sets based on reverse nearest neighbor queries". SIGMOD 2000, pp. 201-212. https://dblp.org/rec/conf/sigmod/KornM00.html
- Xia, Liu, Sun, Chen. "Reciprocal recommendation system for online dating". ASONAM 2015. https://arxiv.org/abs/1501.06247

Recalled, not opened [unverified]: Jégou, Douze, Schmid 2011 TPAMI (product quantization); Ram and Gray 2012 KDD (cone trees); Elkan 2003 ICML (triangle inequality k-means); Broder 1997 (MinHash); Indyk and Motwani 1998 STOC (LSH); Chaudhuri, Ganti, Kaushik 2006 ICDE (prefix filter primitive); Christen 2012 TKDE and Papadakis et al. 2020 CSUR (blocking surveys); Zhang, Ramakrishnan, Livny 1996 SIGMOD (BIRCH); Aggarwal, Han, Wang, Yu 2003 VLDB (CluStream); Malkov and Yashunin 2020 TPAMI (HNSW); Dong, Charikar, Li 2011 WWW (NN-Descent); von Luxburg 2007 (spectral tutorial); Lucene segment merging as an LSM design.

Repository files read (commit 3f0f8586): `AGENTS.md`; `spec/candidateSearch.md`; `spec/pairValue.md`; `spec/matchLane.md`; `spec/memberStanding.md` (uncertainty); `packages/engine/src/match/index.ts`, `search.ts`, `pair.ts`, `profile.ts`; `packages/engine/src/packs/friends/vectors.ts`; `packages/engine/src/packs/slop/generators.ts`, `score.ts`; `packages/sim/src/planted.ts`; `packages/sim/src/apps/friends/persona.ts`; `scripts/sim/matching.ts`; `packages/network/src/network.ts` (`searchFor`); `docs/results/2026-11-17-matching-engine-migration.md`.
