# R11. Completeness critic: gaps, unverified claims, contradictions

Scope: I read R1 to R10 in this folder: R1, R3 and R10 in full, R9 sections 0 to 6, and the summaries and proposal sections of R2, R4, R5, R6, R7 and R8. I checked four load-bearing claims against the code at `/Users/nubs/thenetwork-matching` (commit `3f0f8586`), read-only. I opened a small number of sources on the web. The web-search budget for this run was used up after two queries (a limit shared by all agents in the run). Only WebFetch on known URLs was available after that, so several gap topics rest on sources I recall. Each of those is marked **[unverified]**. I ran no simulation, test, type check, Quint or Dafny run, and no benchmark. Every number marked "estimate" is arithmetic from measured inputs.

Citation keys: **[opened]** means I fetched the page in this session. **[search summary]** means I saw only a search-engine summary. **[unverified]** means I recall the source and did not open it.

---

## 1. Claims I verified in the code (read-only)

| Claim (report) | Verdict | Evidence |
|---|---|---|
| Once the walk is spent, the search keeps checking candidates that can no longer enter the kept list (R3 D1). | **Confirmed.** | `search.ts` loop (lines ~190-211). The walk branch needs `untouched > topBound && !walkSpent`. After `walkSpent`, `closeExact` is never enabled while `untouched` stays high. The loop then pops the heap until `checks >= searchBudget` or the heap is empty. Nothing tests whether `top.bound` still beats the worst kept value. `closeBudgeted` gets `touchedLeft: top !== undefined`. |
| Clef never sets `photos`, so every rated member gets the uncertainty for one photo (R7). | **Confirmed.** | `packs/slop/clef.ts` `WorkersAIClefRater.rate` returns `{face, body, overall, confidence, model, bodyType?}` with no `photos`. `packs/slop/generators.ts:154` uses `standingUncertainty(rating.photos ?? 1)`. The older raters in `appearance.ts:111,138` do set `photos`. |
| Friends takes every tag of seek and offer facets, including structural `key:value` tags (R10 1.4). | **Confirmed in code. Production impact probable.** | `packs/friends/vectors.ts` `tags()`: `seeks = match.filter(SEEK_KINDS).flatMap(f => f.tags)` with no filter. `packs/network/vectors.ts:59` says that the onboarding agent writes `lane:<Lane>` tags. So this is probably a production defect, not only a planted-world one. Someone must check real facet rows before claiming it. |
| A Friend touched bound equals the value, apart from the gate (R3, R10). | **Confirmed.** | `fullPack = hasPackValue ? 1000 : undefined`. Friends supplies no pack value, so `pairSideOf(..., undefined)` is the exact arithmetic. |
| Random stable-roommates instances have a stable matching with probability at most n^(-1/17) (R5). | **Confirmed.** | Chin and Michelen, "The random stable roommates problem typically has no solution", arXiv:2601.07612 [opened]. |
| Blair and Hoskin (2019): 87.5% of people exclude trans people from their dating pool (R5, R6, R9). | **Secondary source only.** | R9 used a Psychology Today article. The journal page (doi 10.1177/0265407518779139) returned 403 to me. Check the journal text before the number goes into a spec. |

## 2. Modalities nobody ran, and measurements nobody took

1. **No run at 100,000 on an idle machine.** R10 measured at N ≤ 5,000 under a load of 137 to 284 on 18 cores and extrapolated. Every "100k" number in R1 to R10 is an estimate.
2. **The window size W at 100,000 was assumed, not measured.** R1 assumed W = 30,000. R3 assumed "tens of thousands". R10 measured that the Friend window is 13.8% of the block and the Date window 5.7% at N = 5,000. If the share holds, W is about 13,800 for Friend and about 5,700 for Date at 100k. This changes R1's c-subset table. For rho = 0.19, m = 8 and W = 13,800:
   - c = 3: 56 × 13,800 × 0.0069 ≈ 5,300 touches. That is just over the 4,800 limit.
   - c = 4: 70 × 13,800 × 0.0013 ≈ 1,260 touches.
   - Both are estimates. `scripts/sim/matching.ts` already records `budgeted.window`, so this is one cheap measurement.
3. **The D1 counter (checks after the result is settled) was never measured.** The mechanism is confirmed in code (section 1), but its share of the 472 and 438 checks is not known.
4. **Nobody found which group is the slop "lowest group" (0.506 to 0.324).** If it is an orientation group, the Date segment and mask work (plan item 5) is also a fairness fix. That must be shown, not assumed.
5. **Nobody ran an offline check on real data.** R9 lists the Columbia speed-dating data and the Joel et al. 2017 data (UK Data Service reshare 852716) as a check of the harmonic reciprocal value against mutual yes. Nobody did it. It is the only quality test not built on our own generator.
6. **Nobody measured the cost of a brute-force window scan** with an integer kernel. Section 3, G1 argues that this is the missing baseline.

---

## 3. Gaps: techniques nobody covered, or covered too lightly

### G1. The exact baseline nobody priced: a window scan with a compiled integer kernel, and a symmetric self-join (speed, benchmark)

**What is missing.** Every report compares clever indexes with today's search. None compares them with the plain exact method: scan the whole window with a cheap, allocation-free integer kernel. R3 mentions "a 64-bit interest bitmask with a popcount scan" and drops it as O(N × W). R10 A4b mentions a symmetric segment-pair join. Nobody put a number on it, so the plan has no baseline that any clever index has to beat.

**The arithmetic (estimate).** For friends at 100k, with W ≈ 13,800 (from R10's measured 13.8%):

- The unordered pairs inside windows number about N × W / 2 ≈ 6.9 × 10^8.
- The kernel per pair does:
  - interest overlap as popcount over two 32-bit words (the 42 activity tags fit, R10 1.3);
  - offers-seeks coverage over a small bitset (after structural tags are removed);
  - closeness from a per-(segment, segment) home-distance table plus two trait differences;
  - the integer `lanePairValue` arithmetic.
- In JavaScript with typed arrays (struct of arrays), 10 to 30 ns per pair is a plausible range [estimate; not measured on this machine]. That gives 7 to 21 s of CPU for the whole Friend run, exact, with no budget and no reported gap. Today the run takes 1,474 s (migration report; R10 puts it at about 620 s CPU).
- Each pair is evaluated once, and its value is pushed into both members' top-k heaps. The value is symmetric (`lawLanePairValueSymmetric`). R10 measured that 37% of checks and about half of the bounds today are duplicates from the other side.
- Only the gate and the exact `pairValueOf` run on the candidates that the kernel puts above the current k-th value. For Friend the kernel value is the exact arithmetic, so the gate runs only on the about k candidates kept.

**Why it matters.**
- It is exact by construction. Its proof obligation is small: "the kernel computes `lanePairValue` on the same integers", checked by an equality gate against `pairSideOf` on samples, as R10 C1 already proposes.
- The work is O(N × W), which is quadratic in the city size when W grows with N. So it is not the end state. It is (a) the baseline that the scale ladder must report next to every index method, and (b) a reasonable production choice up to the market size where it stays within budget.
- It turns R3 open question 4 (should Friend geography be a hard limit, such as transit minutes ≤ min of the two tolerances instead of the sum?) into a cost decision. That rule makes W roughly constant per member, so the scan becomes linear in N.

**Literature.** Mann, Augsten and Bouros, PVLDB 9(9) 2016 (opened by R3), found that in set-similarity joins the cost of verification matters and simple prefix-filter methods stay competitive. That is the same lesson: on dense, flat sets, filtering buys little and a cheap verifier wins. Self-join kNN ("kNN join") is a standard database operator [unverified as a specific citation].

**What could go wrong.**
- Memory: each member's heap of k = 12 entries, 100k × 12 × 8 bytes, which is small.
- The per-pair cost in JavaScript is a guess until measured.
- The O(N × W) growth must be gated (plan item 1). It must not be hidden.

**Measure.** Total kernel pair evaluations and CPU per run at 1k, 10k and 100k. Compare it with today's search and with the R10 A3 block-max design on the same worlds. Equality of kept lists against `bruteForceCandidates` on sampled members.

**Effort.** M. It needs the struct-of-arrays layout (R10 C2) for the bitsets to pay.

**Exactness.** Exact (no budget). If a budget is imposed, the result reports the scanned share.

### G2. Selection as optimization: min-cost flow and LP as offline oracles (quality, benchmark)

**What is missing.** R5 argues well that greedy on one symmetric score gives the stable b-matching ("globally ranked pairs"), and that exact max-weight b-matching (blossom) should be only an offline oracle. Nobody proposed the cheap oracle for the bipartite lanes: Hire (seats with capacity) and any lane whose two sides are disjoint. There, maximum-weight b-matching is a min-cost-flow problem, and min-cost flow has integral optimal solutions in polynomial time (classical network-flow theory, for example Ahuja, Magnanti and Orlin, *Network Flows*, 1993 [unverified]). A greedy b-matching is a 1/2-approximation of maximum weight [unverified textbook result].

**Relevant evidence from a deployed system.** Ahani, Andersson, Martinello, Teytelboym and Trapp, "Placement optimization in refugee resettlement", *Operations Research* 69(5):1468-1486, 2021 [search summary]. The system (Annie MOORE) combines per-pair outcome prediction (LASSO logistic regression on employment) with integer optimization under capacities. Backtesting suggested a 22 to 38% gain in short-run employment. The follow-up, Ahani, Gölz, Procaccia, Teytelboym and Trapp, "Dynamic placement in refugee resettlement", *Operations Research* 72(3), 2024 [search summary], reports more than 98% of the hindsight-optimal employment, against under 90% for "greedy-like" current practice. These numbers are not ours. They show where greedy can leave value on the table: tight capacities on the scarce side, which is our Hire seats and senior Mentor and Invest members.

**Proposal.** In the matching block, solve the max-weight b-matching for Hire (and for the Date and Friend pair graphs at sim sizes, using an LP relaxation or blossom) on the same kept-edge graph. Report:
- the welfare ratio greedy / optimum;
- the number of directed blocking pairs that the optimum would create (the price of stability);
- the per-group exposure under both.

Do not ship the optimizer. Stability and explainability favour greedy (R5).

**Measure.** The ratio per lane on pinned worlds. If greedy reaches 0.95 or more, close the question.

**Effort.** S to M (offline script, outside the proved path). Exactness is unaffected (diagnostic only).

### G3. Circles as weighted set packing: an ILP oracle over candidate circles (quality, benchmark)

**What is missing.** R5 notes that circle building is weighted set packing, where greedy guarantees only 1/k. R2 proposes wedge closing and R1 proposes Leiden-CPM. Nobody gives a way to measure how far the circle builder is from the best packing. Kidney-exchange programs solve the same kind of problem exactly with integer programs over enumerated cycles and chains, or with position-indexed formulations (Abraham, Blum and Sandholm, EC 2007; Dickerson, Manlove, Plaut, Sandholm and Trimble, EC 2016 [both unverified]). Our circles have 3 to 6 members and come from a sparse candidate set (triangles plus closed wedges), so the enumeration is small at sim sizes.

**Proposal.** An offline ILP that maximizes the sum of circle values, with each member in at most its capacity of circles, over the candidate circles that `circleCoherent` admits. Report greedy / ILP per seed. Use the HiGHS solver (open source) or a small branch-and-bound [unverified as a dependency choice]. The script stays outside the proved path.

**Measure.** The packing-gap ratio, circle size distribution, and least pair value inside circles.

**Effort.** M.

### G4. Comparison propagation from entity-resolution blocking (speed, exact)

**What is missing.** Members in several markets, remote jobs in several markets, and overlapping segments make the same pair appear in several blocks. Entity-resolution work calls the exact fix "comparison propagation": compare a pair only in its least common block. Papadakis, Skoutas, Thanos and Palpanas, "A survey of blocking and filtering techniques for entity resolution", arXiv:1905.06167 [opened abstract; the comparison-propagation details are from memory, unverified]. Meta-blocking, which prunes comparisons by weighting a blocking graph, is approximate and does not fit the decision path. Comparison propagation is exact, and it is the multi-block form of R10 A4's symmetric memo.

**Effort.** S, inside the symmetric memo. **Exactness.** Exact.

### G5. Friendship quality: what psychology says to score (quality)

R4 and R9 already show that the friends truth is 91% chemistry, and that activity, logistics and repetition carry the systematic part. The psychology I could check supports a sharper rule:

- Montoya, Horton and Kirchner, "Is actual similarity necessary for attraction? A meta-analysis of actual and perceived similarity", *JSPR* 25(6):889-922, 2008, with 313 studies [search summary]. Actual similarity predicted attraction in no-interaction and short-interaction studies, but **not in existing relationships**. Perceived similarity predicted attraction at every stage. One caveat: almost all of the included studies are from before 2000.
- So stated-tag overlap is a fair predictor of a "yes" to a first proposal (acceptance), and a poor predictor of a lasting friendship. Lasting friendship depends on proximity and repeated contact: Back, Schmukle and Egloff 2008 [unverified; the journal page returned 403] and Hall 2018 [unverified; cited by R4].
- Personality (Big Five) similarity is a weak predictor of friendship. Behaviour and activity similarity count for more [unverified; Bahns et al. 2017, not opened].

**Consequences.**
- **Do not add a Big Five questionnaire** to friends.help onboarding. This goes in the "will not work" list.
- Score Friend in two stages:
  - the affinity term predicts acceptance;
  - logistics (transit minutes, slot overlap) and incumbent-crew repetition predict outcomes.
- This supports R4 P6 and R6 P7, and the evaluation change in R9 P7.

### G6. Vocabulary mismatch: integer tag expansion (the useful part of learned sparse retrieval) (quality)

Learned sparse retrieval (for example SPLADE; Formal et al., SIGIR 2021 [unverified]) and late interaction (ColBERT; Khattab and Zaharia, SIGIR 2020 [unverified]) attack vocabulary mismatch with trained float encoders. Those encoders do not fit the proved, integer path. The idea transfers: expand each tag at extraction time to its parent tags in a curated taxonomy (for example `react` → `frontend` → `software`), and give parent hits a lower integer weight. This is exact and stays inside today's posting machinery.

It targets ntwrk Intro, where extraction alone moved AUC from 0.56 to 0.69 (migration report). For that reason it belongs with the extraction work, not with search.

**Risk.** Parent tags are dense, so their postings get long. Use the weighted-coverage tiers of R3 P8 so that dense parents are non-essential.

**Measure.** Intro AUC, using expected-value metrics on de-leaked planted worlds (R9 P4). Planted worlds at rung 0 are circular.

**Effort.** M.

### G7. Batching requests with proactive proposals (ride-hailing lesson) (quality)

Ride-hailing dispatch moved from first-come matching to batched matching over short windows, because a batch can trade one match against another (well documented in practice [unverified as a specific citation]). Our proactive run is already a weekly batch. The request path is not: `retryRequests` answers each open request on its own with a greedy one-way scan.

R5 P5 and R4 P2 propose putting requests into MatchRun. The point to add: requests should **compete in the same selection pass** as proactive proposals, under the same weekly capacity. Otherwise a popular member's capacity goes to whichever path runs first. This is an ordering decision for the founder, not a new algorithm.

### G8. Techniques I checked and rejected (see the "will not work" list)

- **kd-trees and range trees for trait boxes.** Friend has 4 trait dimensions. Home is fixed per segment, so the per-segment trait ranges of R1's summaries already give the exact closeness bound. A kd-tree adds code and no bound that the summaries lack.
- **Learned index structures** (Kraska et al., SIGMOD 2018 [unverified]). Our index build is 21 to 26 ms at N = 5,000 (R10). The cost is in search, not in index lookup.
- **Locality-sensitive orderings** (Chan, Har-Peled and Jones [unverified]). They need a metric with doubling dimension. Our value is not a metric.
- **Two-tower retrieval.** It is approximate float retrieval. At most it could give offline features behind a bias review (R4 already rejects end-to-end models).
- **Bioinformatics seed-and-extend and linear-time clustering** (BLAST; Linclust, Steinegger and Söding 2018 [unverified]). The exact part of seed-and-extend is the q-gram lemma, the same pigeonhole idea as R1's c-subset postings, so it adds support but nothing new. Linclust-style "compare only to a centre" is approximate.
- **School choice and deferred acceptance.** R5 and R4 already cover this. Deferred acceptance helps only with truly directional preferences.

---

## 4. Where the reports contradict each other, and which is right

### C1. Friend: are checks the problem (R3) or bounds (R10)?
- R3 D1: most of the 472 checks are wasted, and P1 cuts them to 15 to 40.
- R10: at N = 5,000 Friend makes only 12 checks, and bounds are 92% of CPU.

**Both are right, at different N.** At 5,000 the walk finishes and the search closes exact after about 12 checks. At 100k, the walk stops on the 4,800-touch limit first. In the confirmed code path, the shell then drains the heap up to 600 checks, which explains 472.

Using R10's per-call costs (estimate):
- the bound work at 100k is about 4,800 × 0.94 µs ≈ 4.5 ms per profile;
- the drain is about 472 × 3.5 µs ≈ 1.65 ms per profile.

So R3 P1 saves about 25% of Friend time and leaves exactness unchanged. Friend exactness needs a tighter untouched bound (R10 A3, R1 c-subsets) or the G1 scan. R3's "several-fold drop" for Friend is too optimistic. R3's "2x or more" for Date is plausible, because a Date check costs 5.5 µs and 80% of Date checks are refusals.

### C2. Friend closeness: the main slack (R10) or worth at most 111 to 222 points (R1, R3)?
- At N = 5,000 the measured gap is small: untouched bound 433 against a k-th value of 512. An exact per-segment closeness bound closes many searches there, so R10 is right at that size.
- At 100k the untouched bound is held up by open interest tags. Affinity is worth up to 667 points, so closeness alone cannot close the search. R1 and R3 are right at that size.

**Plan.** Do the per-segment closeness bound (exact and cheap), and then measure. Build c-subset postings only if the ladder still shows Budgeted Friend searches and G1's scan is too slow.

### C3. The Friend window size
R1 assumed W = 30,000 and R3 "most of the city". R10 measured 13.8% of the block. **Use R10's measurement** until the 100k ladder measures W directly. At 13.8k, c = 4 postings cost about 1,260 touches, not 2,740.

### C4. Warm starts: do they make the stop rule fire sooner (R1 6.1) or not cut checks at all (R2, R8)?
**R2 and R8 are right.** The final k-th value of an exact search does not depend on the order of checks. A bound-ordered search checks exactly the candidates whose bound exceeds that final value, plus any warm-start checks below it, which are wasted. The posting walk depends on the untouched bound, and a warm start does not change that.

So warm starts improve only Budgeted results, and they can add checks. R1's own text also says "only Budgeted results change", but its proposal list claims an earlier stop. Keep warm starts only for budgeted lanes, and count their checks inside the budget.

### C5. Epsilon-exact closing: unmeasurable, so free (R3, R5), or premature?
R3 and R5 argue that a 40-point slack cannot be seen, given noise of 174 against 132. R9 shows that noise is mostly an artifact of how the simulator keys its random draws (paired correlation about 0; 7 to 16% shared meetings). With common random numbers and expected-value metrics, small value differences may become visible.

**Do CRN and expected-value metrics first (plan item 2), then decide the slack per lane with data.**
- Keep `Within` as a phase separate from `Exact`.
- Keep slack 0 for Hire and Invest.

### C6. The slop quality ceiling: chemistry (migration report, R4) or learnable taste (R9)?
R9 measured that the simulator's own pre-meeting quantities rank good dates at AUC 0.963, against 0.59 for stated data. So in the simulator, the gap is the hidden taste × traits term, which behaviour can reveal. R4 and R7 cite Joel et al. 2017: in real speed dating, desire specific to the pair was not predictable from 100+ stated traits.

**Both are right about different things.**
- The simulator rewards taste learning.
- Reality may not reward it.

R9 P6's knob (the share of predictable taste, set by default to a Joel-calibrated low value) is the right resolution. A taste-learning change (R4 P4, R7 P5) counts as a gain only if it wins at the low setting.

### C7. Date standing: prune with the least penalty (R1 P2), or soften the penalty (R7 P7)?
These two proposals pull in opposite directions:
- R1 wants the standing-gap penalty to prune outer standing slices.
- R7 wants to forgive the penalty inside measurement noise, citing evidence that band mode cost 30% of dates and that ratings never raised second dates.

A penalty applied to `max(0, gap - ua - ub)` is still monotone in the gap. It still prunes, just less.

**Quality comes first here.** Date speed should come from segments, masks and the pack bound (plan items 5 and 7), not from standing. Whether the penalty ranks at all is a founder decision (R7 open question).

### C8. Where signifiers go: segments (R1 section 8) or masks (R3)?
**R3 and R6 are right.**
- Put one or two small, selective dimensions in the segment: gender × seek-set × trans × cell for Date, and gender × accepted genders for Friend.
- Put everything else in mutual acceptance masks.
- Putting every dimension into the segment multiplies segments, and windows become O(#segments) per search unless `windowSpans` iterates a map (R3 P3, R8 P8).

### C9. A member who did not state trans status or openness
- R3 leaves it open.
- R6 says an unanswered openness question must not count as "open", and that "only trans" should be limited to members who shared trans status (T4T).
- R5 proposes opt-in disclosure.

**R6's defaults are the safest. The founder must decide.** The engine should support both of R6's options (a mutual-openness filter, or Grindr-style inclusion only).

### C10. Leiden-CPM (R1 P10) against "the resolution limit hides small groups" (R5)
R5's objection applies to modularity. The Constant Potts Model is said to be free of the resolution limit (Traag, Van Dooren and Nesterov 2011 [unverified]). R5's wider point still holds: circles of 3 to 6 are a packing problem, and the cheap fixes come first. These are R5 P4 (compute missing pair values directly) and R2 P5 (wedge closing). Leiden-CPM is lower priority.

### C11. Bitsets: a 10x gain (R1, estimate) or none (R10, measured)?
R10 measured no gain from a bitset popcount fetched through a `Map`. **R10's measurement wins.** Bitsets pay only in a struct-of-arrays layout (R10 C2). R1's "10x" is unmeasured.

---

## 5. Will NOT work (additions from this critique)

- **A Big Five or long personality questionnaire for Friend.** Actual similarity does not predict attraction in existing relationships (Montoya et al. 2008). Personality similarity is a weak predictor of friendship [unverified]. It adds onboarding cost for a term the friends truth does not reward.
- **Shipping an optimal b-matching or circle ILP in production.** It is not stable for one shared score (R5), it is hard to prove and hard to explain. Use it only as an offline oracle (G2, G3).
- **Meta-blocking pruning in the decision path.** It is approximate. Only comparison propagation (exact) fits.
- **kd-trees, learned indexes and locality-sensitive orderings.** They give no bound beyond per-segment summaries, the cost is not in the index, or they need a metric.
- **Calling the window scan (G1) "not n²".** It is O(N × W). It is acceptable only while W is capped (by a geography rule) or the market is small, and the scale gate must show it.
- **Treating any R1 to R10 number at 100k as measured.** All are extrapolations from N ≤ 5,000 under heavy load.

## 6. Sources opened in this session

- Chin, B. and Michelen, M., "The random stable roommates problem typically has no solution", arXiv:2601.07612. https://arxiv.org/abs/2601.07612 [opened]
- Malkov, Yu. A. and Yashunin, D. A., "Efficient and robust approximate nearest neighbor search using Hierarchical Navigable Small World graphs", arXiv:1603.09320. https://arxiv.org/abs/1603.09320 [opened, title and authors only, to check R1's citation]
- Papadakis, G., Skoutas, D., Thanos, E. and Palpanas, T., "A survey of blocking and filtering techniques for entity resolution", arXiv:1905.06167. https://arxiv.org/abs/1905.06167 [opened abstract]
- Ahani, N., Andersson, T., Martinello, A., Teytelboym, A. and Trapp, A. C., "Placement optimization in refugee resettlement", *Operations Research* 69(5):1468-1486, 2021. https://econpapers.repec.org/RePEc:inm:oropre:v:69:y:2021:i:5:p:1468-1486 [search summary]
- Ahani, N., Gölz, P., Procaccia, A. D., Teytelboym, A. and Trapp, A. C., "Dynamic placement in refugee resettlement", *Operations Research* 72(3):1087-1104, 2024. https://econpapers.repec.org/RePEc:inm:oropre:v:72:y:2024:i:3:p:1087-1104 [search summary]
- Montoya, R. M., Horton, R. S. and Kirchner, J., "Is actual similarity necessary for attraction? A meta-analysis of actual and perceived similarity", *JSPR* 25(6):889-922, 2008. https://researchportal.murdoch.edu.au/esploro/outputs/journalArticle/Is-actual-similarity-necessary-for-attraction/991005635870107891 [search summary]
- Tried and blocked (HTTP 403): Blair and Hoskin 2019 (journals.sagepub.com/doi/10.1177/0265407518779139); Back, Schmukle and Egloff 2008 (journals.sagepub.com/doi/10.1111/j.1467-9280.2008.02113.x).
- Everything else in this report marked [unverified] is recalled and was not opened. The web-search budget for this run ran out after two queries.
