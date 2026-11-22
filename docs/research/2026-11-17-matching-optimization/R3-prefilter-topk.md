# R3: Dealbreaker pre-filters and exact top-k search with bounds

Angle: pre-filtering by dealbreakers, and exact or honestly bounded top-k candidate search.
Code read at worktree `/Users/nubs/thenetwork-matching`, commit `3f0f8586`. This was a read-only study: no simulation, test, type check, Quint or Dafny run. Every effect size below is an estimate made from the code and the measured numbers in `docs/results/2026-11-17-matching-engine-migration.md`. Each estimate says how to measure it.

Citation key: **[opened]** means I read the abstract or the publisher or index page through search or fetch. **[summary]** means I saw only search-engine summaries of the source. **[unverified]** means I recall it from memory and did not open it.

---

## 0. Summary

1. **Most of the 438 to 472 checks per profile at 100k do no useful work.** In `search.ts` (lines 190 to 211), once the posting walk is spent (`walkSpent`), the loop keeps checking touched candidates in bound order until the heap is empty or the 600-check budget is used up. This continues after the highest remaining bound is already below the k-th kept value, when no further check can change the kept list. In the Friend lane the pack supplies no pack value, so a touched candidate's bound is its exact value except for the pair gate. So for Friend, almost every check after about the first `searchLimit` (12) checks is wasted. A stop rule ("no touched candidate can still enter") should cut Friend checks from 472 to about 15 to 40 per profile and Date checks by a large factor. The kept lists do not change. The fix is one condition in the spec plus shell code. It is the cheapest proposal here and should be done first.
2. **At 100k, the touch limit, not the check budget, is what blocks exactness.** The touch limit is `searchTouchesPerCheck x budget = 8 x 600 = 4,800` posting entries. The Friend window is most of the city (the segment partner list allows any neighborhood in which some tolerance class can reach the member). It holds tens of thousands of members. Each of the about 8 interest tags of a member has a posting range of about 0.19 x W. So the walk is spent before even one tag range closes, `open` never falls, and the untouched bound stays near full value. A larger check budget cannot make these searches exact. Only a smaller window, a different index for the affinity term, or a looser stop (epsilon-exact) can.
3. **The pair gate is not in the bound, so checks are spent on infeasible pairs.** A Date check runs `pairValueOf`, which runs `eligiblePair` (orientation both ways, age ranges both ways, stated dealbreakers both ways). The search orders candidates by a bound that ignores all of these. From the simulator's generator (`packages/sim/src/apps/slop/persona.ts`), mutual age feasibility is about 45 to 55% for a member at the age mode and about 10% for a 45-year-old. The Date segment encodes only the *partner's* gender (`own = is|cell`, partners = `seeks x cells`). So a gay man's window is every man in the market, and only about 15% of those men seek men (gay 9%, bisexual 5%, pansexual 1% of men). The figure is about 20% for a lesbian. About 80 to 86% of a minority-orientation member's window, and of the checks spent on it, can never become a pair.
4. **Proposal: compile dealbreakers into per-profile "mutual acceptance masks".** For each hard dimension d, a profile has an `own[d]` bit set (what I am) and an `accepts[d]` bit set (what I accept). A pair is feasible only when, for every d, `accepts_a[d] & own_b[d] != 0` and `accepts_b[d] & own_a[d] != 0`. This is one AND per dimension. It is easy to prove in Dafny and is checked at touch time, before any bound or check. Gender and orientation, trans status and openness, age year buckets, dealbreaker values, work mode, commute area, work authorization, credentials, pay bucket and friendship gender preference all fit. The obligation is the same as for segments today: the masks must be a superset of the pack's pair rules. The matching block counts any pair that the masks refuse and the pack rules admit, and requires none.
5. **The pack term at full value makes Date untagged partners always "possible".** Date weights are complement 3, affinity 2, closeness 0 (slop has no traits) and pack 3. A candidate with no shared tag has the bound 3 x 1000 / 8 = 375. That is at or above the 350 floor, so the untouched bound never drops below the floor and the walk must cover the whole window. A per-member pack ceiling (`packCap(a)`, partner-independent) of 933 or less removes this. In `score.ts`, every member with an unknown goal (factor 0.85) or a few unknown lifestyle fields (0.97 each) already has a ceiling below 934 when that member has no learned, type or body boost.
6. **Uniform, dense tags defeat WAND and MaxScore.** These methods prune because rare, high-weight terms decide the top-k, so common terms become "non-essential". The friends simulator has 42 activity tags, each held by about 19% of members, with equal weights in `coverageValue`. No term is non-essential. A top-12 member shares about 6 of their 8 tags (my estimate from a binomial(8, 0.19) tail over W of about 30,000). An unseen candidate must share at least 5 of 8 to compete, so 4 full posting ranges (about 0.76 x W touches) must be walked. That is above the touch limit. Three ways out:
   - (a) k-gram postings (tag pairs or triples), the set-similarity-join "prefix filter" idea. This is exact, costs about 7x the posting memory for triples, and needs about 4k touches at W = 30k.
   - (b) A 64-bit interest bitmask with a popcount scan. This is exact and linear in W with a tiny constant: brute force on the window, still O(N x W) overall.
   - (c) Rarity-weighted (IDF) coverage. This improves quality and makes MaxScore effective on real, Zipf-shaped tag data. The simulator's flat tag frequencies hide this, which is a data-quality finding.
7. **An honest "epsilon-exact" closing phase.** Close when every kept value is greater than `unseenBound - eps` (integers; eps of about 30 to 50 on the 0..1000 scale). This is Fagin's theta-approximation of TA in additive, integer form. Measured simulation noise (a neutral tie-break moved pooled meetings from 174 to 132) is far larger than a 3 to 5% value slack. So exact top-k beyond eps buys nothing measurable. The guarantee stays provable and is reported.
8. **For quality, not only speed.** Pre-filtering moves the check budget from infeasible to feasible partners. That matters most for small pools (minority orientations, older members, rare job families), the groups that a budgeted search serves worst. The tracked slop "lowest group against overall" fell from 0.506 to 0.324 in the migration. I did not confirm which group it is (`packEval.ts fairnessRatios` keys). Measure whether it is an orientation or age group before claiming a link.

---

## 1. How the current search works (from the code)

**Index** (`packages/engine/src/match/index.ts`). There is one block per `(lane, side, market)`. A block is sorted by `(segment, standing, ordinal)`. Postings per tag for offers, seeks and interests hold ascending block positions. A segment is one contiguous span, and the standing window inside it is one binary search. The index is rebuilt on every run (`MatchRun` constructor, `run.ts`).

**Window** (`search.ts windowSpans`). For each segment of the block (all of them: the loop is O(#segments) per query, even when the member reaches few), the span skips segments the member does not reach and binary-searches standing in `[s - offset - (band + u + 20), s - offset + (band + u + 20)]`. The `+20` is the uncertainty ceiling, because the partner's uncertainty is not known before the read.

**Bounds.**
- Touched candidate: `lanePairValue` with exact tags, closeness, standings and exchanges, and the pack term at 1000. The gate (orientation, age, dealbreakers, geo, blocks, history) is ignored.
- Untouched candidate: open-range counts give the searcher's coverage bounds. The other direction counts as full when any relevant range is open. Closeness and pack count at 1000.

**Loop.**
1. If exact (`kept` full and every kept value > max(top bound, untouched bound)), close Exact.
2. Else, if untouched > top and the walk is not spent, walk the next posting range (rarest first). When the next range is at least as long as the window, walk the window instead.
3. Else, if there is no top candidate or the budget is spent, close Budgeted.
4. Else, check the top candidate (`pairValueOf`, which includes `eligiblePair`).

**Limits** (`spec/matchLane.md`): Friend limit 12 and budget 600; Date limit 10 and budget 600. The touch limit is 8 x budget = 4,800.

### Lane facts that drive cost

| Lane | Weights c/a/cl/p | Traits | Pack value | Standing | Segment | Floor |
|---|---|---|---|---|---|---|
| Friend (friends) | 1/6/2/1 | lat km, lng km, weekend lean, energy (costs 50, 50, 1, 250) | none, so the pack weight is 0 and touched bounds are exact apart from the gate | constant 50, uncertainty 0, band 100, so the window is every reached segment | home neighborhood with tolerance class; partners = any (neighborhood, class) that the transit rule could admit | 150 |
| Date (slop) | 3/2/0/3 | none | `datePackValue`: a product of float factors, rounded | Clef appearance; band 15 + u + 20 | `own = is|cell`, partners = `seeks x reachable cells` | 350 |
| Hire (peon) | 6/1/0/1 | none | payFit and payHeadroom | role level; band 15 | **none** | 400 |

## 2. Diagnosis: why Friend and Date budget out at 100k

### D1. Checks after the result is settled (the largest, cheapest fix)
Once `walkSpent` holds, the untouched bound can no longer fall, so the search cannot close Exact. The loop then falls to the check branch and pops the heap until the budget or the heap runs out. `canCloseBudgeted` in `spec/candidateSearch.md` requires `checks >= budget or (walkSpent and not touchedLeft)`, and the shell passes `touchedLeft = (top !== undefined)`. So the spec *forces* these checks.

A touched candidate whose bound is below the worst kept value (by value, then ordinal) cannot enter the kept list, because the bounds are sound. Checking it changes nothing except `bestDropped`.

- **Friend:** the touched bound equals the value unless the gate refuses the pair, so checks after about the 12th are almost all wasted. The measured 472 checks per profile is consistent with "min(600, touched)" behaviour.
- **Date:** checks continue while there is pack slack and gate refusals, then are wasted.

### D2. The touch limit is smaller than one posting range
- **Friend.** Each member holds about 42 x 0.19 = 8 interests. The window is most of the market's 100k (the friends segment admits any neighborhood that some tolerance class can reach, because the rule is `minutes <= t_a + t_b` and the partner's class reaches "unbounded"). So one interest range is about 0.19 x W, which is above 4,800 once W is above 25k. The walk is spent partway through the rarest range, every range stays open, and the untouched bound stays at about `harmonic(778+, 778+)` or higher.
- **Date.** Seeks include `free:<slot>`, `activity:<x>` and `goal:<g>`, and offers include the lifestyle values. Many of these tags are held by 30 to 60% of members, so the ranges are long and the walk is spent in the same way.

### D3. Gate refusals cost a full check
The Date gate refuses on:
- **Orientation, both ways.** The segment checks only "b's gender is in a's seeks".
- **Age range, both ways.** The simulator draws ages as 0.7 x N(30, 5.5) plus 0.3 x U(18, 60). Men's ranges are about [age-8, age+3] and women's about [age-3, age+8].
- **Stated dealbreakers, both ways.**

None of these is in the bound. My estimates of the feasible share of a Date window, from the simulator's distributions:

| Searching member | Window (before gate) | Mutually feasible share of window (estimate) |
|---|---|---|
| straight woman, 30 | men in standing window (about 48% of block) | orientation 0.94 x age about 0.5 x dealbreakers about 0.85 = **about 0.40** |
| straight man, 45 | women | 0.94 x age about 0.10 x 0.85 = **about 0.08** |
| gay man, 30 | all men | orientation 0.15 x 0.5 x 0.85 = **about 0.06** |
| lesbian woman, 30 | all women | 0.20 x 0.5 x 0.85 = **about 0.09** |

So for 60 to 94% of the candidates that a Date search touches or checks, the gate is certain to refuse. The worst cases are older and minority-orientation members.

### D4. The pack term at full value
For Date, an untouched candidate with no open tag still gets `mine = 3 x 1000 / 8 = 375`, which is at or above the 350 floor. So the "untagged partners" bound never falls below the floor. The shell must eventually walk the whole window, which it cannot do at 100k.

For touched candidates, the slack is `3/8 x (1000 - P)` inside each utility. With a typical P of 500 to 700, that is 110 to 190 points, before the harmonic mean. Many touched bounds are above the k-th value, so many checks are needed.

### D5. Flat closeness and flat tags
- **Friend closeness.** The closeness weight is 2/9, and each of the 4 dimensions is a quarter of closeness. So one trait can tighten a bound by at most 2/9 x 1000/4 = 56 points, and geography (2 dimensions) by at most 111. The gap between a Friend k-th value (my estimate: 700 to 750) and the untouched bound with tags open (about 900 to 1000) is 200 to 300 points. **Sorting by a trait or by geography alone cannot close Friend searches.** It can only help together with tag information.
- **Tags.** All 42 tags are near the same frequency and carry the same weight, so prefix and MaxScore ordering (rarest first) buys almost nothing (section 3.1).

### D6. Small items
- `windowSpans` loops over every segment of the block. With composite segments (pool x cell, possibly x age band), the cost becomes O(#segments) per query. Use a `Map<segment, span>` and iterate over the member's partner list.
- **peon Hire has no segment.** Mode, area, pay, authorization and credentials are all checked at check time (D3 again), and the family tag posting acts as an implicit segment.

---

## 3. Literature and systems: what each offers us

### 3.1 Top-k over posting lists (dynamic pruning)
- **Fagin, Lotem and Naor**, "Optimal aggregation algorithms for middleware", PODS 2001 and JCSS 66 (2003) 614-656. https://arxiv.org/abs/cs/0204046 [opened]
  - The Threshold Algorithm (TA) reads sorted lists in parallel, does random access for the full score, and stops when the k-th score is at least the threshold of the frontier values. TA is *instance optimal* for monotone aggregates.
  - The paper also defines NRA (no random access), CA (combined) and a **theta-approximation**: stop when the k-th score is at least the threshold divided by theta.
  - Our search is already a TA/NRA hybrid: "touch" is sorted access and "check" is random access. Our pair value is monotone in each utility (`lawHarmonicMonotone`) and admission is monotone, which is exactly TA's precondition. The theta stop maps to proposal P7.
- **Turtle and Flood**, "Query evaluation: strategies and optimizations", IP&M 31(6) 1995. https://dblp.uni-trier.de/rec/journals/ipm/TurtleF95.html [summary] MaxScore splits terms into *essential* and *non-essential* by their max contributions against the current threshold. Only essential lists are traversed; non-essential terms are scored by random access.
- **Broder, Carmel, Herscovici, Soffer and Zien**, "Efficient query evaluation using a two-level retrieval process" (WAND), CIKM 2003. DOI 10.1145/956863.956944 [opened]
  - A pivot over the sum of upper bounds, then full evaluation. The authors report more than 90% fewer full evaluations on TREC with almost no loss.
  - WAND's "two-level" split (cheap approximate first, full evaluation second) is our touch/check split.
- **Ding and Suel**, "Faster top-k document retrieval using block-max indexes" (BMW), SIGIR 2011, DOI 10.1145/2009916.2010048. https://research.engineering.nyu.edu/~suel/papers/bmw.pdf [opened abstract]
  - Each block of a posting keeps its maximum score, so whole blocks can be skipped.
  - It gains more with **document ID reassignment** (clustering similar documents together), which is the formal link to the user's "search within similar clusters".
- **Chakrabarti, Chaudhuri and Ganti**, "Interval-based pruning for top-k processing over compressed lists", ICDE 2011, 709-720 [opened summary]. Finer bounds per interval of ids; the authors report 3-6x over term-level upper-bound skipping.
- **Dhulipala, Kabiljo, Karrer, Ottaviano, Pupyrev and Shalita**, "Compressing graphs and indexes with recursive graph bisection", KDD 2016, arXiv 1602.08820 [opened abstract]. Reorders ids so that similar items are adjacent (BP ordering). It is the standard way to make block-max bounds tight.
- PISA engine documentation lists MaxScore, WAND, BMW, BMM and their variants: https://pisa-engine.github.io/pisa/book/guide/algorithms.html [summary].

**What this means for us.** All of these methods gain when term weights are skewed: idf-like weights, where a few rare terms decide. With 42 equal-weight tags at 19% each, a MaxScore split has no non-essential terms until the threshold needs "5 of 8" hits. Block-max needs blocks whose members are similar. Our blocks are sorted by segment and standing, which is unrelated to interests, so the OR of a block's tag sets saturates.

### 3.2 Set-similarity joins (the closest match to our affinity and complement terms)
- **Bayardo, Ma and Srikant**, "Scaling up all pairs similarity search", WWW 2007, DOI 10.1145/1242572.1242591 [opened]. The AllPairs algorithm: prefix filter plus size filtering. The authors report 5-20x over earlier methods.
- **Xiao, Wang, Lin and Yu**, "Efficient similarity joins for near duplicate detection" (PPJoin), WWW 2008, and TODS 36(3) 2011 [opened]. Adds a positional filter. The authors report 2.6-5x over earlier methods.
- **Xiao, Wang, Lin and Shang**, "Top-k set similarity joins", ICDE 2009, 916-927 [opened]. Prefix filtering with **tight upper bounds on the similarity of unseen pairs** in place of a fixed threshold. This is exactly our "k-th value as threshold" setting.
- **Mann, Augsten and Bouros**, "An empirical evaluation of set similarity join techniques", PVLDB 9(9) 2016, 636-647 [opened]. Across 7 algorithms, the prefix filter is the key technique, and AllPairs is still competitive. Verification cost matters, which corresponds to our "check" cost.
- **The principle.** Fix a global token order (rarest first). For an overlap threshold t, any pair with overlap at least t shares a token within the first `|x| - t + 1` tokens of x. This is the same as our `open`-count bound. With near-uniform tokens it saves little (D5). **Generalising to k-gram tokens** (indexing pairs or triples of tags) turns "at least t shared" into "shares at least one indexed k-gram", with much shorter lists. This is proposal P6.

### 3.3 Filtered vector search (pre-filter, post-filter, single-stage)
- **pgvector 0.8.0** (Nov 2024) iterative index scans exist because post-filtering *over-filters* and returns fewer than k rows. `hnsw.iterative_scan = strict | relaxed`, capped by `hnsw.max_scan_tuples` (default 20,000). https://www.postgresql.org/about/news/pgvector-080-released-2952/ and https://docs.pgedge.com/pgvector/v0-8-0/iterative-index-scans/ [summary]
- **Gollapudi et al.**, "Filtered-DiskANN", WWW 2023, DOI 10.1145/3543507.3583552 [opened]. Builds labels into the graph. The authors report an order of magnitude or more over the prior state of the art on filtered queries.
- **Patel, Kraft, Guestrin and Zaharia**, "ACORN: performant and predicate-agnostic search over vector embeddings and structured data", arXiv 2403.04871 (2024) [opened]. Traverses the predicate subgraph of HNSW. The authors report 2-1,000x QPS at 0.9 recall.
- **What this means for us.** These systems show three ways of handling filters:
  - Post-filter (rank, then drop) has a *recall cliff* when the filter is selective. Our D3 is exactly this: checks are spent on gate-refused pairs.
  - Pre-filter (a bitmap of allowed ids, then search within it) is exact but costs O(N/word) per query to build the bitmap.
  - Single-stage (the filter built into the index structure) is best, which corresponds to our segments.
  - The graph methods are approximate (recall below 1). They give up the provable exactness or bound that our specs require, so we keep their *lesson* (put filters inside the index) and not their algorithms.

### 3.4 Bitmaps and composite keys
- **Chambi, Lemire, Kaser and Godin**, "Better bitmap performance with Roaring bitmaps", SPE 46(5) 2016, arXiv 1402.6407 [opened]. Packed-array and bitmap containers; the authors report intersections up to 900x faster than WAH and Concise.
- At our sizes (at most 1M per block), a plain `Uint32Array` bitmap of block positions is enough: 100k bits is 3,125 words. Roaring matters only for sparse sets or for production storage. A per-query feasibility bitmap built as AND over dimensions of OR over the accepted values costs about `dims x accepted_values x N/32` word operations. That is about 30k word operations at 100k, small next to one check.
- Composite keys (lexicographic sort on several hard attributes) are the "segment" idea with more fields. They work when the leading attributes are equality or small-set constraints. They do not work for two independent ranges (age and standing): only one of the two can be the sorted key, and the other must be a filter or a bucket in the key.

### 3.5 Geography
- **Tinder**, "Geosharded recommendations, part 1: sharding approach" (2019). https://medium.com/tinder/geosharded-recommendations-part-1-sharding-approach-d5d54e0ec77a [summary only; the page returned 403]
  - Users are sharded by S2 cells: level 7 is about 45 mi and level 8 about 22.5 mi, chosen because most distance preferences are within 50 mi.
  - Cells are grouped along the Hilbert curve for locality, and a query reads the shards that cover its radius.
  - Part 2 reports that the geosharded index handles about 20x more computations.
  - This is our cell segment plus a partner cover.
- H3 (hexagonal; `gridDisk(k)` gives k-ring covers) and S2 (`RegionCoverer`) [unverified, from memory]. Our slop cells (`CELL_DEG = 0.01`, about 0.7 mi) are finer than needed for a 5 to 25 mi radius. A two-level cover (coarse cells fully inside the radius need no distance test; edge cells need the test) would cut the length of the partner list.

### 3.6 Dating and job matching practice on hard filters
- **Bruch, Feinberg and Lee**, "Extracting multistage screening rules from online dating activity data", PNAS 113(38) 2016, 10530-10535, DOI 10.1073/pnas.1522494113 [opened abstract via search; the PMC full text was behind a CAPTCHA]. Users apply noncompensatory **screeners ("deal breakers") that encode acceptability cutoffs**, then a compensatory stage. The model was fit on 1.1M browsing and writing decisions. This supports our design: a hard pre-filter stage, then a value. It also implies that the filter stage should be modelled per member and **both ways**. I did not get the paper's numeric screening shares, so I cite none.
- **Pizzato, Rej, Chung, Koprinska and Kay**, "RECON: a reciprocal recommender for online dating", RecSys 2010, 207-214 [opened summary]. Reciprocity raised top-10 success from about 26% to about 45%. This supports the harmonic two-sided value and the both-ways filters.
- **Job matching.** I found no primary LinkedIn engineering source on Galene hard filters in this session. A recruiter-search study (pin.com, 2026; vendor data, low reliability) reports that titles are "required" in about 95% and location in about 91% of searches, and that requiring one skill doubles zero-result searches (7.7% to 14.8%). This is a caution: hard filters that members state loosely (skills, exact titles) cause empty results, so in peon they belong in the value, not the mask. [summary, vendor]
- **Orientation base rates.** Gallup 2024 (published Feb 2025) reports 9.3% of US adults identify as LGBTQ+: bisexual 5.2%, gay 2.0%, lesbian 1.4%, transgender 1.3%. Among Gen Z the rate is 23%. https://news.gallup.com/poll/656708/lgbtq-identification-rises.aspx [summary; subgroup numbers via secondary reports]. The simulator's shares (men: gay 9%, bi 5%; women: lesbian 6%, bi 11%; trans 3% of men and of women) are higher than the US base rate but plausible for a dating-app population in NYC, SF and LA. **The gap between pool sizes (about 15 to 20x) is what makes window pre-filtering a fairness issue, not only a speed issue.**

### 3.7 Postgres (production state)
- **B-tree composite index** on `(market, lane, side, segment, class, standing)`. This mirrors the in-memory block order, so a range scan returns one span.
- **GIN on `int[]`** (the `intarray` extension, `gin__int_ops`) for tag postings. **BRIN** fits only append-ordered columns (join time), not matching keys.
- **GiST on `int4range`** (`&&`, `@>`) serves age-range overlap and availability intervals. The `btree_gist` extension gives combined equality-plus-range keys.
- **Partial indexes** per lane (`WHERE lane = 'Date'`) keep the indexes small.
- Postgres combines several indexes with **BitmapAnd** in a bitmap heap scan, which is the database form of P2.
- [unverified, from general Postgres knowledge; not opened in this session]
- **Recommendation.** Keep searching in memory per run, as today: 100k profiles are tens of MB. Use Postgres only to persist profiles, masks and per-member thresholds, and to load deltas (P10). Per-search SQL would make the cost model and the proofs depend on planner choices.

---

## 4. Modelling dealbreakers: mutual acceptance masks

### 4.1 The structure
For each lane, the pack declares D hard dimensions. Each dimension d has at most 32 values (one `int32`), or 64 values as two words, and one of those values is `unknown`. A profile carries:
- `own[d]`: the bit set of what this member is. Usually one bit. It is `unknown` when the member has not stated it.
- `accepts[d]`: the bit set of partner values this member accepts. Whether a member who states no dealbreaker accepts `unknown` is a pack decision that must match the rule: slop's "unknown values never count as a hit" means that `unknown` is always accepted.

```
maskReaches(a, b)      = forall d: (a.accepts[d] & b.own[d]) != 0
maskPairAllowed(a, b)  = maskReaches(a, b) and maskReaches(b, a)
```

This is integer bitwise arithmetic only, so it is easy to state in Quint and prove in Dafny (as bit-vector or `% 2` arithmetic; Dafny has `bv32`).

**Obligation (same pattern as segments today).** `maskPairAllowed(a, b) = false` must imply that the pack rules refuse (a, b). The matching block counts, on sampled or all checked pairs, "masks refuse and pack rules admit", and requires 0.

### 4.2 Dimensions per app

| Dimension | own | accepts | Mutual? | Source rule today | Expected selectivity (simulator) |
|---|---|---|---|---|---|
| **Date: match gender** | one of woman, man, nonbinary | `seeks` | yes | `seekingMatches` | about 0.94 for straight members; 0.15 to 0.2 for gay and lesbian members |
| **Date: trans status (new)** | trans, cis, unstated | open-to-trans yes, no or unstated | yes (each side's preference) | none today (the simulator has `identity`, but the profile does not) | product decision; see 4.4 |
| **Date: age year bucket** | 1-year bucket 18..81 (64 bits) | the range mask `[lo, hi]` | yes | `ageRangeReason` | about 0.5 at the mode, about 0.1 at 45 |
| **Date: dealbreaker values** | one dimension per value family (smoking, drinking, has kids, wants kids, religion importance, politics) | complement of the hit values when a dealbreaker is stated, else all | yes | `statedDealbreaker` | about 0.85 (the simulator states 85% of real dealbreakers) |
| **Date: goal (optional, soft today)** | casual, long_term, unsure | all | not hard | `compatEstimate` (factor 0.6) | none as a mask; use it as a pack class (P5) |
| **Friend: gender preference (new)** | woman, man, nonbinary | the "friends with" set | yes | none today | depends on the product |
| **Friend: age band (optional)** | 5-year band | the member's comfort range | yes | none (minors are already excluded) | |
| **Hire: role family** | candidate's sought family / job family | | yes | candidate membership per family | strong; better as a **segment** |
| **Hire: work mode** | the job's mode | the candidate's modes | one-sided (the candidate accepts the job) | `locationOk` | about 1/3 to 2/3 |
| **Hire: commute area** | the job's area id | the candidate's areas | one-sided | `locationOk` | strong for onsite jobs |
| **Hire: authorization** | job sponsors (y/n) | the candidate needs a sponsor (accept y) or not (accept both) | one-sided | `workAuthOk` | |
| **Hire: credential** | the candidate's credentials | the job requires credential c (`accepts = {has c}`) | one-sided | `credential_required` | |
| **Hire: pay** | the job's payMax bucket | buckets at or above the candidate's floor bucket | one-sided, superset | `pay_below_floor` | the bucket test is a superset of `payMax >= floor` |
| **Cofounder (new)** | commitment (full-time now, later), stage, location | accepted set | yes | `peonCofounderPair` | |

A one-sided dimension is the case where the other side accepts everything.

Rules that stay in the gate and not in masks: blocks, history (`already_introduced`, cooldowns), excluded company (a set per candidate that is large and rarely hit), holds, and the exact geo distance (the mask or segment is the cell cover; the exact miles test stays).

### 4.3 Where masks sit in the search
1. **Filter at touch (P2).** When an entry is visited, test `maskPairAllowed` before computing a bound. A refused candidate is never pushed to the heap and costs no check. Its value is `noPairValue` by the obligation, so skipping it cannot change an exact result.
2. **Lead with the most selective mutual dimension in the segment (P3).** This shrinks the window, which is what saves *touches*. Masks at touch save *checks*, not touches.
3. **Per-query feasibility bitmap (P4, optional).** Build the bitmap of window positions that pass the masks, then intersect each tag posting range with it, so touches land only on feasible entries.

### 4.4 The new signifiers and privacy
- **Orientation as stated.** `seeks` already exists as a set over `{woman, man, nonbinary}`. Bisexual and pan members are `seeks` with several bits. The fix (P3) is to put the *member's own seeks set* into the segment key, so that the partner list can require mutuality.
- **Trans status and openness.** These are special-category data (gender identity, sex life; GDPR Article 9 class [unverified legal reading]).
  - Only a member's own statement may set them. They must never be inferred (the Clef rater must not produce them), must never be shown, logged or relayed, and must stay inside masks only.
  - The difficult question is `unstated`. Two options:
    - If "not open" members exclude only `trans`, a trans member who does not state is matched with them, which risks harm at the date.
    - If they exclude `trans or unstated`, every member who does not state loses that pool. That may push disclosure.
  - This is a founder or safety decision (open question 3). The engine supports either option.
- **Friendship with men, women or both.** This is the same mechanism as dating `seeks` on the Friend lane. For crews (groups of 3 to 6), a circle requires `maskPairAllowed` for every pair, which the circle rule already does through the pair gate.
- **Cofounders are equals.** The Cofounder lane is already Peers with a balance rule. Its masks are mutual (both commit), unlike Hire, where most dimensions are one-sided.

---

## 5. Proposals

Each proposal states what changes, why, what can go wrong, how to measure it, effort, and what happens to exactness. "Exactness preserved" means that for any search that closes Exact, the kept list still equals the brute-force oracle.

### P1. Close when no touched candidate can enter (stop wasted checks). Priority 1. Effort S.
- **What changes.**
  - Spec: in `canCloseBudgeted`, `touchedLeft` means "a touched candidate whose bound can still enter the kept list". That is: the kept list is not full, or the top bound ranks above the worst kept candidate (value, then ordinal).
  - Shell: pass `touchedLeft = top !== undefined && (kept.length < limit || top.bound > worstKept.value || (top.bound === worstKept.value && top.ordinal < worstKept.ordinal))`.
  - When `walkSpent` holds and no touched candidate can enter, close Budgeted with `unseenBound = untouched`.
  - Also, while the walk is not spent, prefer walking over checking a top whose bound cannot enter. The current code already walks when `untouched > topBound`.
- **Why.** Section 2 D1.
  - Friend: touched bounds are exact except for the gate, so checks fall from 472 to about `limit + gate refusals among the top`, which I estimate at **15 to 40 per profile**.
  - Date: checks continue only while bounds with pack slack are above the k-th value. I estimate **438 down to 100 to 250** with P1 alone, and lower with P2 and P5.
  - Hire: some reduction.
  - Time: Friend at 100k spends 1,474 s. If checks dominate the cost (`eligiblePair` with pack rules and geo), expect a several-fold drop. Measure it.
- **What could go wrong.** A bound that is not sound would now silently drop a candidate. Before, the extra checks might have caught it. Add P11, a runtime "bound below value" counter on every check (required to be 0). `bestDropped` changes, but it is diagnostic only.
- **Measure.** Checks per profile and wall time at 10k and 100k for all four packs. A new counter: checks after the top bound fell below the k-th value (it must be 0 after the fix; measure it before the fix to confirm the diagnosis). Kept lists must be identical before and after on the same seeds, since kept is a pure function of the checked set ordered by bound. Diff the edges.
- **Exactness.** Preserved. The Exact phase is unchanged, the kept lists are unchanged, and the Budgeted bound is still sound (`max(topBound, untouched)` is still an upper bound, and the top bound is at most the kept values).

### P2. Mutual acceptance masks, tested at touch. Priority 2. Effort M.
- **What changes.**
  - `PackVectors.masks?(w, entity): { own: number[]; accepts: number[] }`, stored on `MatchProfile`.
  - In `visit`: `if (!maskPairAllowed(profile, other)) continue;` before computing the bound.
  - `eligiblePair` also runs `maskPairAllowed` first, so the gate is unchanged in meaning because the masks are a superset.
  - Packs: slop (gender, trans, age, dealbreakers), peon (mode, area, auth, cred, pay bucket), friends (gender preference).
- **Why.** Section 2 D3: 60 to 94% of Date checks, and most minority-orientation checks, are gate refusals. Post-filtering on a selective predicate is the recall cliff that pgvector's iterative scan and ACORN address (3.3). Bruch et al. (2016) show that real dating behaviour starts with exactly this screening stage.
  - Date checks: on top of P1, I estimate a further cut of 2 to 5x.
  - Quality: the budget goes to feasible partners, so budgeted searches keep better lists. The effect is largest for small pools.
- **What could go wrong.**
  - A mask stricter than the rule silently refuses valid pairs. Mitigate with the "masks refuse, rules admit" counter, required to be 0, as with segments.
  - Masks go stale when a member edits preferences. Rebuild masks when profiles are rebuilt; today that is every run.
  - Sensitive dimensions leak through logs. Masks are private fields; exclude them from `MatchingRunLog` and from any member-facing reason.
- **Measure.**
  - Share of checks that return `noPairValue`: before about 60%+ for Date (estimate), target below 10%.
  - Checks per profile; exact share.
  - Per-group (orientation, age band) kept-list fill and dates per member-month in the slop block. Find which group "lowest group" is first.
  - The oracle agreement gate.
- **Exactness.** Preserved. A refused pair has no value, so dropping it does not change the oracle list. The proof is the new law `lawMaskBoundSound`: `not maskPairAllowed implies pairValueOf = noPairValue`, which follows from the obligation and the gate order.

### P3. Fix the Date segment to encode mutual orientation, and index segments by map. Priority 3. Effort S.
- **What changes.**
  - In `dateSegmentOf`: `own = is|seeksSet|cell`. The partners are `{ g|S|c : g in a.seeks, a.is in S, c reachable }`. With 3 genders, there are 7 seek sets.
  - In `windowSpans`: iterate over the member's partner list through a `Map<segment, SegmentSpan>`, not over every block segment.
- **Why.** Window size for a gay man falls from all men to men who seek men: about 0.15x (85% fewer window entries and touches). For a lesbian it is 0.20x. For straight members it is 0.94x, so little changes. Cost per query becomes O(|partners|), not O(#segments).
- **What could go wrong.**
  - More segments means more binary searches. Partner lists grow by up to 7x (seek sets) times the cells. Keep the memo, and consider a coarser cell (3.5).
  - Multi-market members carry no segment today and stay unsegmented. Masks (P2) cover them.
- **Measure.** Window size and touches per profile by orientation group; exact share by group at 10k and 100k.
- **Exactness.** Preserved. This is still a superset of `seekingMatches`: b is in a's partners only when `b.is in a.seeks` and `a.is in b.seeks`. The existing law `lawSegmentBlockingComplete` covers it.

### P4. Per-query feasibility bitmap over the window, intersected with postings. Priority 6. Effort M.
- **What changes.**
  - The block keeps, per mask dimension and value, a bitmap (`Uint32Array`) of the positions with that `own` value.
  - A query builds `F = AND over d of (OR over v in accepts_a[d] of bitmap[d][v])`, restricted to the window spans.
  - The walk skips posting entries whose bit in F is 0 *without counting a touch*. This needs a separate, cheaper "skip" counter with its own limit (for example 64 x budget).
- **Why.** Touches are what block exactness at 100k (D2). For a 45-year-old Date member, F keeps about 8% of the window, so posting ranges shrink by about 12x and may close within the touch limit. Building F costs `dims x values x |window|/32` word operations: about 10 x 4 x 40k/32, or about 50k operations, which is less than one or two pack-value computations per query.
- **What could go wrong.**
  - Memory: dims x values x N bits, about 10 x 20 x 100k = 20 Mbit = 2.5 MB per block. That is fine.
  - The cost is still linear in N/32 per query, so O(N^2/32) in total. That is fine to about 1M per market, then it needs Roaring or sharding.
  - The touch-cost model changes, so the spec must count skipped entries separately to keep a stated bound.
- **Measure.** Touches per profile, the share of posting entries skipped by F, exact share by age band and orientation, and per-search wall time.
- **Exactness.** Preserved. A skipped entry fails the masks, so its value is `noPairValue`. The untouched-bound logic applies to F-feasible entries only, and the "range closed" counting uses F-filtered range sizes. This needs one new law: the walk half of blocking completeness extended to F.

### P5. Pack ceilings: per member and per partner class. Priority 4. Effort M.
- **What changes.** Two optional pack hooks.
  - `packCap(w, a): int`, an upper bound on `packValue(w, a, b)` over all b.
  - `packClass(w, b): small int` (at most 16) and `packClassCap(w, a, class): int`, an upper bound on `packValue(w, a, b)` for all b in that class.
  - The block sorts by `(segment, class, standing)`. Each `(segment, class)` span is a sub-block. The untouched bound becomes the maximum over open sub-blocks of the sub-block bound (block-max over a categorical key). The touched bound uses `packClassCap(a, class(b))` in place of 1000.
  - **slop:** `class(b)` = goal (4 values) x whether the lifestyle fields are known (2 bits).
  - `cap(a, class)` is `1000 x (goal factor) x (unknown-field factors) x boostCap(a)`. Here `boostCap(a) = exp(0.1 x 2) x exp(maxLearned(a)) x bodyCap(a)`, computed from a's own history, clamped to 1000 and rounded *up*.
  - **peon:** class = the payMax bucket gives an exact upper bound on `payHeadroom`. For seats, the candidate's floor bucket bounds `payFit`.
- **Why.** Section 2 D4.
  - A member with cap(a) of 933 or less makes untagged partners impossible: the untouched bound with no open tag becomes at most 349, below the 350 floor. So the walk never needs the whole window.
  - Per class: for a long-term seeker, casual partners have pack value at most about 600 x boostCap and lose the `goal:long_term` complement hit. The whole casual sub-block bound falls by about 3/8 x 400 + 3/8 x 1000/|seeks|, about 150 to 200 points, which is often below the k-th value. So whole sub-blocks are skipped (the Ding and Suel block-max effect).
  - Expected touched-bound slack: from 110-190 to about 40-80 points. I estimate Date checks after P1 and P2 fall by a further 2 to 3x. Measure the bound-slack histogram.
- **What could go wrong.**
  - **Float factors.** `datePackValue` uses `Math.exp` and `cos`, so the cap must be computed with directed rounding (round up) and a margin. Otherwise floating-point error can make it unsound.
  - **Better:** make the slop pack value integer (factors as permille tables), so that the cap is exact and provable. That is a larger change.
  - **Sorting by class splits standing ranges**, so the window becomes `#classes x #segments` spans. Keep the class count small.
  - A pack can lie. The runtime counter (P11) catches it.
- **Measure.** The distribution of bound minus value on checked pairs (slack), checks per profile, exact share, and the count of sub-blocks skipped.
- **Exactness.** Preserved when the caps are sound. The existing `lawCandidateBoundSound` and `lawBucketBoundSound` already accept any utility upper bound. Add a pack obligation, `packValue(a, b) <= packClassCap(a, class(b))`, checked at runtime on every check (P11) and by property tests in the matching block.

### P6. k-gram (tag-pair or tag-triple) postings for dense affinity terms. Priority 7. Effort L.
- **What changes.** For lanes with dense interest tags (Friend), add postings keyed by sorted tag pairs or triples, inside each segment.
  - Given the current k-th value θ, compute the least overlap `t_min` that an unseen candidate needs to reach θ (from the weights, with closeness and the other terms at their caps).
  - Choose a subset S of the member's tags of size `|S| = T - t_min + k` (with T the member's tag count). Every candidate with overlap of at least `t_min` shares at least k tags within S, so it appears in some k-gram posting of S.
  - Walk those k-gram ranges. After all of them are walked, untouched candidates have overlap below `t_min`, so their bound is below θ.
- **Why.** Section 2 D5. For Friend: T is about 8, θ is about 700, and `t_min` is about 5.
  - Single postings: walk 4 ranges, 4 x 0.19 W, about 0.76 W. At W = 30k that is 22.8k touches (over the limit).
  - Pairs: |S| = 5, 10 pair lists x 0.036 W, about 0.36 W, or 10.8k.
  - Triples: |S| = 6, 20 triple lists x 0.0069 W, about 0.14 W, or **4.1k (inside the 4,800 limit)**.
  - This is prefix filtering (Bayardo 2007; Xiao 2008, 2009) generalised to k-gram tokens.
- **What could go wrong.**
  - Memory: C(8,3) = 56 triples per member, about 7x the single-tag postings.
  - It only works when θ is high. When a member's k-th value is low (sparse tags, a new member), `t_min` is small and the method falls back to single postings.
  - With real Zipf-shaped tags, plain MaxScore may already be enough (P8). Build P6 only if the Zipf benchmark still budgets out.
  - It requires the order of operations "fill the kept list first, then derive θ".
- **Measure.** Touches per profile and exact share for Friend at 10k, 100k and 1M, on uniform and Zipf tag worlds; memory per block.
- **Exactness.** Preserved. The untouched bound after the k-gram walk is the value with overlap at most `t_min - 1` and the other terms at their caps. This needs a new law: "k-gram cover completeness", meaning overlap of at least t implies a shared k-subset within S when `|S| >= T - t + k`. That is a small combinatorial lemma.

### P7. Epsilon-exact closing (an additive theta-approximation). Priority 5. Effort S.
- **What changes.**
  - A lane constant `searchSlack` (integer; for example 40 for Friend and Date, 0 for Hire and Invest).
  - A new phase `Within` (or a Budgeted reason): `kept` is full and every kept value is greater than `unseenBound - searchSlack`. The result records `unseenBound`, and the guarantee is "no missed candidate is more than `searchSlack` above the k-th kept value".
- **Why.**
  - It is Fagin's theta-approximation of TA (3.1) in additive integer form.
  - The value scale is 0..1000. The ranking AUC against hidden good pairs is 0.58 to 0.60 for Date and Friend, and pooled outcomes move by about 25% under a neutral tie-break. So differences of at most 40 points cannot be resolved as quality.
  - It turns many Budgeted searches into searches with a *stated, small* gap, and it stops searches earlier.
  - I estimate that the Date share of searches that are exact or within 40 at 100k rises from 31% to well above half after P1 to P3. This needs measuring.
- **What could go wrong.**
  - Product drift: "exact" must not be claimed for a search that closed Within. Keep the phases distinct in logs and reports.
  - A slack too large lets the exposure or exploration logic see different lists. Tune it against the simulator's quality gates.
- **Measure.** The distribution of `unseenBound - kth` for Budgeted searches (today's data). The share closing Exact, Within or Budgeted. Quality gates with slack 0, 20, 40 and 80 on pinned seeds; expect no gate change at 40 or below.
- **Exactness.** Replaced by a proved bound: `alwaysWithinBeatsUnseenLessSlack`. Exact remains a special case (slack 0).

### P8. Rarity-weighted coverage (integer IDF tiers). Priority 8 (quality plus speed). Effort M.
- **What changes.** `coverageValue(hits, wanted)` becomes a weighted coverage, `sum of w_t over shared tags / sum of w_t over wanted tags`. The weights are integer tiers from document frequency per block, for example `w = 1 + floor(log2(N/df))`, capped at 8. They are frozen per run.
- **Why.**
  - **Quality.** A shared rare interest (birding, chess) carries more information than a shared common one (coffee). This is standard in IR and in set-similarity joins, where weighted Jaccard is common. I expect AUC to rise on Zipf-shaped data, not on the current uniform simulator.
  - **Speed.** MaxScore and WAND gain only when weights are skewed, because common tags become non-essential once θ is set.
- **What could go wrong.**
  - Gaming: claiming rare tags. Mitigate with a cap per member.
  - Weights move as the population changes, so values drift between runs. Freeze them per week.
  - The simulator's flat tags will show no gain. **The test data must change first** (open question 1).
- **Measure.** AUC against hidden good pairs on Zipf worlds; touches per profile; friends V14 and repeat gates.
- **Exactness.** Preserved. The bound uses the weighted coverage of open tags, which is monotone, so the same law applies with weights.

### P9. Peon: family segment plus masks plus pay-ordered sub-blocks. Priority 4 (with P2). Effort S to M.
- **What changes.** The peon segment is `family:<f>` with partners `{family:f}`. Masks for mode, area, auth, cred and pay bucket. Pack class = payMax bucket (P5).
- **Why.** Hire is 70% exact with 265 checks per profile at 100k. The family posting is an implicit segment, but all hard rules run at check time. Expect Hire to become nearly all exact with checks near `limit + small`.
- **What could go wrong.** A candidate with several families already has one membership per family, which is consistent. A remote job is in several markets, which is consistent.
- **Measure.** Hire exact share, checks per profile, and the interviews-per-hire gate.
- **Exactness.** Preserved (superset segments and masks).

### P10. Incremental: a delta index and reverse threshold queries for new members. Priority 9. Effort L.
- **What changes.**
  - Keep the per-run index as a frozen main index plus a small delta block of profiles that joined or changed since the build, as in an LSM tree.
  - A search walks both, with one bound logic, because the bound sums over sub-blocks.
  - Persist, per profile, its k-th kept value θ_a and its kept list.
  - When b joins, run b's search. Then run a **reverse threshold query**: walk b's postings and partner segments, and check a only when `bound(b, a) > θ_a`, the per-member threshold. The untouched bound per segment is compared with `min θ` in that segment, so that it is exact.
  - Rebuild the main index nightly.
- **Why.** This avoids recomputing all searches when a few members join. The cost is one search plus one reverse search per new member, each within the budget. This is the incremental half of the user's question, within this angle. (Caching similar-member results belongs to other reports.)
- **What could go wrong.**
  - Ordinals are positions in canonical order today. A delta needs stable ordinals, so use entity-id rank in a global, append-only order.
  - Kept lists can go stale when a member *leaves* or changes. Handle it with invalidation.
  - Weekly capacity and exposure are global and still run in the selection pass.
- **Measure.** Time to absorb 1% new members against a full rebuild. The share of kept lists that equal those of a full rebuild (must be 100% for exact searches).
- **Exactness.** Preserved when the reverse query is exact. That needs a law: "a kept list updated by reverse threshold equals the rebuilt list".

### P11. Bound monitors and benchmark harness. Priority 1 (with P1). Effort S.
- **What changes.**
  - On every check, assert `value <= bound` and count violations (required to be 0).
  - Count checks that return `noPairValue` and their reason (from the gate), checks after the result was settled (D1), the window size, the feasible size (masks), touches, skipped entries and bound slack.
  - Add a scale ladder (1k, 10k, 100k, 1M) and two tag worlds (uniform and Zipf with exponent about 1) to the `matching` block, run as tracked gates.
  - Fit log-log slopes of touches and checks per profile against N. The **"no n^2" gate** is that the slope of checks per profile is at most 0.2 and the slope of touches per profile is at most 0.5 (both bounded above by the budget), and time per profile grows sublinearly.
- **Why.** This makes the claims in this report measurable. The bound monitor makes P1 and P5 safe.
- **Measure.** These counters are the measure.
- **Exactness.** They only observe.

---

## 6. Expected effect on checks per profile at 100k (estimates)

| Lane | Today | +P1 | +P2/P3/P9 | +P5 | +P7 (slack 40) | Exact share (estimate) |
|---|---|---|---|---|---|---|
| Friend | 472 | 15-40 | 15-40 (masks matter only with a gender preference) | n/a (no pack) | n/a | stays low (about 20-30%) until P6 or P8, or a geography change; **Within** share rises a little |
| Date | 438 | 100-250 | 40-100 | 20-60 | same | exact 31% to perhaps 40-50%; exact or Within well above 50% |
| Hire | 265 | 80-150 | 15-40 | 12-30 | n/a (slack 0) | 70% to about 90%+ |
| Intro | 0.9 | 0.9 | 0.9 | 0.9 | 0.9 | 100% |

Reasoning for each cell is in section 5. Every cell needs measurement, and the first measurement to take is the D1 counter.

---

## 7. Spec changes (minimal)

All in `spec/candidateSearch.md` unless noted.

1. **P1.** Redefine `touchedLeft` in prose: "a touched candidate is left whose bound ranks above the worst kept candidate, or the kept list is not full". No Quint change to `canCloseBudgeted`: the meaning moves into the shell's argument. Add a law that the reported `unseenBound` is still at least every unchecked value: `lawSettledBoundSound`.
2. **P2.** Add a story "Mutual acceptance masks never drop a pair the pair gate admits":
   - `maskReaches(own, accepts)` and `maskPairAllowed(a, b)`.
   - `lawMaskBlockingComplete`: masks allow, given that the gate admits.
   - `lawMaskBoundSound`: a refused pair has `noPairValue`.
   - The pack obligation is the same text as for segments. The `pairValue` spec is unchanged.
3. **P3.** No spec change (segments are opaque).
4. **P4.** Change the touch accounting: "an entry outside the feasibility set costs one skip, not one touch; skips are limited to `searchSkipsPerCheck x budget`". Add `lawSearchSkipsStayWithinLimit`, and extend the walk half of blocking completeness to the feasibility set.
5. **P5.** Add "Sub-block bounds": the bound of a sub-block is `bucketValueBound` with the pack term at the class cap. `lawBucketBoundSound` already covers the arithmetic. Add the obligation `packValue <= packClassCap` in prose, and a runtime counter.
6. **P6.** Add the "k-gram cover" lemma as a pure law.
7. **P7.** Add the phase `Within` and `searchSlack` to `matchLane.md` limits, with `alwaysWithinBeatsUnseenLessSlack` and `canCloseWithin`. Keep `alwaysExactBeatsUnseen` unchanged.
8. **P8.** In `pairValue.md`, `coverageValue` becomes `weightedCoverage(hitWeight, wantedWeight)`. The bounded law is unchanged in form.

Quint models to compare and stamp: `candidateSearch`, `matchLane`, `pairValue`, and `matching_engine` / `candidate_pool` where the phase list appears.

---

## 8. What will not work for us, and why

- **Approximate graph ANN (HNSW, DiskANN, ACORN) as the primary search.** Recall is below 1 with no per-query bound, so we lose `alwaysExactBeatsUnseen` and the reported bound. Our score is also not a metric: it is a two-sided harmonic mean with floors and a parity gate, so graph navigability assumptions do not hold. Their filter lessons are useful (put filters in the index); their algorithms are not.
- **Post-filtering by dealbreakers after ranking.** This is today's failure (D3): selective filters make the budget run out on refused pairs. pgvector added iterative scans because of exactly this.
- **Raising the check budget.** At 100k the touch limit binds first (D2). Raising both makes the cost O(N x W).
- **Sorting a Friend segment by one trait in place of standing.** Each trait can tighten the bound by at most 56 points (geography by 111), against a gap of 200 to 300. Useful only together with tag bounds.
- **Standing-window tightening alone for Date.** The window half-width is 15 + u + 20, which covers most of a Clef standing distribution. Splitting by uncertainty class (`ub` instead of the ceiling) narrows it by at most `(20 - ub)/(35 + ua)`, about 25% at best.
- **Block-max on the current order.** Blocks sorted by segment and standing have unrelated interests, so the block OR of 8-of-42 tag sets saturates after about 10 members. Block-max needs clustered order (BP or interest-cluster sort) to help, and even then dense flat tags give weak block bounds.
- **Putting every hard dimension into the segment string.** For Date, gender x 7 seek sets x 64 ages x hundreds of cells gives hundreds of thousands of segments, and the window becomes O(#segments). Put one or two selective dimensions in the segment and the rest in masks.
- **Per-search SQL in Postgres.** Planner variance breaks the deterministic cost model and makes the bound unprovable. Keep in-memory search and persist only.
- **Treating soft preferences as masks** (goal, stated "type", skills as must-haves). Bruch et al. support hard screens only for real dealbreakers. The recruiter study shows that over-strict filters create empty results. Soft preferences belong in the value or the pack class.
- **Inferring trans status or orientation** (from photos, Clef or text). This is unsafe, a privacy violation and very likely unlawful. Use only the member's own statement.

---

## 9. Benchmarks so that we never have n^2 problems

1. A **scale ladder** per pack: N = 1k, 10k, 100k and 1M (1M quick mode, a sample of 2,000 searches). Record checks per profile, touches per profile, skips per profile, exact, Within and Budgeted shares, `unseenBound - kth` percentiles, bound slack percentiles, refused-check share by reason, window size, feasible size and time per search.
2. **Gates.**
   - Bound violations = 0.
   - "Masks refuse, rules admit" = 0.
   - Oracle agreement on exact searches = 100% (existing).
   - Log-log slope of checks per profile against N of at most 0.2.
   - Touches and skips per profile bounded by their limits. The share of searches that are exact or Within must not fall as N grows from 10k to 100k by more than an agreed margin.
3. **Two tag worlds.** The current flat 19% tags, and Zipf-shaped tags (exponent about 1, 200 tags, 8 per member), because real interests are heavy-tailed. Without this, P8 and MaxScore cannot be judged.
4. **Fairness of search work by group.** The exact or Within share and the kept-list fill by orientation, age band and borough. This is the test of the hypothesis that budgeted searches underserve small pools.
5. Run the same seeds before and after each change (the repository rule). Report confidence intervals over at least 8 seeds for the outcome gates, because neutral changes move pooled meetings by about 25%.

---

## 10. Open questions

1. The friends simulator's interest frequencies are flat (42 tags at about 19%). Should the simulator draw Zipf-shaped interests so that quality and pruning results carry over to real data?
2. Which group is the slop "lowest group" (0.506 to 0.324)? If it is an orientation or age group, P2 and P3 are a fairness fix, not only a speed fix.
3. Trans status and openness: should `unstated` be accepted by members who are not open? This is a founder and safety decision with disclosure risk on both sides.
4. Friend: should geography count more in the value, or be a hard lane rule (for example, transit minutes at most the minimum of the two tolerances), so that Friend searches become local and bounded? The literature and the repository's own Hall (2018) reference say that friendship forms nearby. Today closeness has weight 2/9, and the segment rule is the permissive sum of tolerances.
5. Is an additive slack of about 40 acceptable as the product meaning of "best candidates"? It needs a decision in `matchLane.md`.
6. Should `datePackValue` move to integer permille factor tables, so that pack caps (P5) are provable and not float-margined?
7. Friendship gender preference and age comfort range on friends.help, and cofounder commitment and stage on peon: are these in MVP scope (PRD 28.3 and 40)? The repository rules forbid inventing scope.
