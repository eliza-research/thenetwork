# Matching optimization and quality: research synthesis (2026-11-17)

Eleven research agents covered ten angles and a completeness check. Each report is in [2026-11-17-matching-optimization/](2026-11-17-matching-optimization/). This page is a hand-written synthesis. A claim marked "estimate" comes from code reading or from runs at 5,000 members or fewer on a loaded machine. It is not a measured result at 100,000 members.

| Report | Angle |
|---|---|
| [R1](2026-11-17-matching-optimization/R1-clustering-emeans.md) | Clustering and e-means |
| [R2](2026-11-17-matching-optimization/R2-graph-smallworld.md) | Graph traversal and small worlds |
| [R3](2026-11-17-matching-optimization/R3-prefilter-topk.md) | Pre-filters and exact top-k |
| [R4](2026-11-17-matching-optimization/R4-reciprocal-quality.md) | Reciprocal recommenders and learning from outcomes |
| [R5](2026-11-17-matching-optimization/R5-market-groups.md) | Markets, groups and the three relationship shapes |
| [R6](2026-11-17-matching-optimization/R6-signifiers-audit.md) | Signifiers: audit and data model |
| [R7](2026-11-17-matching-optimization/R7-clef-attractiveness.md) | Attractiveness and the Clef decision model |
| [R8](2026-11-17-matching-optimization/R8-incremental-benchmarks.md) | Incremental matching and benchmarks |
| [R9](2026-11-17-matching-optimization/R9-test-data-quality.md) | Test data quality |
| [R10](2026-11-17-matching-optimization/R10-engine-profile.md) | Code-level profile of the engine and the request path |
| [R11](2026-11-17-matching-optimization/R11-critic-gaps.md) | Gaps from other fields |
| [R12](2026-11-17-matching-optimization/R12-ranked-plan.md) | One ranked plan of 15 items |

## Answers to the questions

**Clustering and e-means.** e-means (arXiv:2611.09501) is a fast mini-batch k-means for dense float vectors. It has no support for sets or categories, no incremental insert, and no guarantee. At 100,000 members plain k-means already runs in seconds. Do not adopt it. The useful result is different: any partition can be a bucket key and the search stays exact, because exactness comes from the bound of each bucket and not from the quality of the clusters. A cluster key helps only if it is a term of the pair value.

**Search only inside similar clusters or cliques.** As a hard restriction it loses exactness and makes echo chambers. As an order of the walk (best bound first) it is exact. Circles, crews and cached kept lists are good seeds.

**Graph traversal and small worlds.** Graph indexes (HNSW, DiskANN, filtered variants) give recall, not a bound. Our value is reciprocal, gated and not a metric. Two published results rule them out as the decision path: worst-case linear query time for these graphs (Indyk and Xu, 2023) and failure under selective filters. A graph can seed the walk. Seeding cannot cut pair checks in an exact search, because the checked set is every candidate whose bound beats the final k-th value.

**"Similar people match similar others."** This is a three-hop walk (member, partner, the member's twin, the twin's partner). It is safe as a seed and as a cached term from mutual positive outcomes inside the parity window. It must not use likes received, because that spreads a popularity order.

**Pre-filtering by dealbreakers.** This is the largest speed gain for dating. Today 80% of Date pair checks return no value: 40% fail segment reach, 12% fail the age window, 28% fail the floor because the bound assumed a full pack value. Mutual acceptance masks tested when a candidate is touched, and a segment that includes who the member seeks, remove most of these checks and keep exactness.

**Why Friend and Date miss exactness at 100,000.** Friend: 42 activity tags, each held by about 19% of members; 70% of random pairs share a tag; the closeness term is bounded at full value; the touch limit ends the walk. Each search computes about 525 bounds to keep 12. Date: no shared tag is needed and the pack term is bounded at 1,000, so an untagged partner bounds at 375, above the floor of 350.

**Adding a member without a full recompute.** The rule follows from the pair value. A new member can enter a kept list only if its value beats that list's k-th value. So: run the new member's own search, then a reverse pass that skips each bucket whose bound is at or below the least stored k-th value. A removed member forces a new search only for the members who kept it. This needs stable identities (no positional ordinals), persisted kept lists with their k-th value, and a base, delta and tombstone index.

**Attractiveness and Clef.** The literature supports a coarse parity band only. About half of face preference is private taste, and pair-specific desire was not predictable before a meeting (Joel, Eastwick and Finkel, 2017). A defect was found: the rater never sets the photo count, so each rated member gets the same wide uncertainty and the Date window covers almost the whole pool. Next: honest uncertainty, percentile standing per market and pool, a validity monitor with a switch-off rule, and a private taste term from the member's own answers.

**Quality limits.** In the friends simulator, pair chemistry is 91% of the pair latent variance, so pair AUC is the wrong target there. In the dating simulator, the oracle's own pre-meeting quantities rank good dates at AUC 0.963 against 0.59 for stated data; the missing signal is a hidden taste term that only behaviour reveals. The largest gains in the literature come from a model of the receiver's acceptance, not from more similarity.

**Test data.** Pinned seeds are not paired samples today: two arms on one seed share 7% to 16% of their meetings, because coin flips are keyed by proposal index. A three-seed test detects a change of about 35% only. The planted worlds are circular: their truth is built from the same overlap and coverage terms that the engine scores. The truth lacks the signifiers below.

## The three shapes

| Shape | Lanes | Selection | Notes |
|---|---|---|---|
| 1:1 peers | Date, Cofounder, Intro | Greedy pass on one symmetric value (stable for globally ranked pairs) | Pools are a general graph, not two sides: bi and pan members join pools |
| 1:many peers | Friend | Circles of 3 to 6, crews, repeats | Group of about four is best for conversation; repeated time together builds the bond |
| Two sides | Hire, Mentor, Invest | Capacities on the offering side | Interview congestion needs caps; protected attributes never enter |

## Signifiers

The audit found what exists and what is missing.

- **Present.** Dating has a correct mutual-openness rule on one dimension: each member's gender is in the other's seeking set. Bi and pan members work through a seeking set of several genders.
- **Defect.** The seek parser drops the words "trans" and "cis". A stated exclusion is ignored.
- **Defect.** A member who stated bi, pan or queer can get the straight default after two unclear answers.
- **Missing.** Openness to trans partners; friendship with men, women or anyone; cofounder role, commitment and idea state; politics and faith dealbreakers in production.
- **Rules to keep.** A sensitive attribute is stated by the member and is not inferred. An unanswered openness question is not read as open. Nothing of this kind enters Hire, Mentor or Invest.

## Plan in build order

1. Scale ladder and counters, with gates on counts that fail on quadratic growth.
2. Paired evaluation: coin flips keyed by member, counterpart and week; expected-value metrics; an A/A arm.
3. Remove the quadratic scans in the request path (behaviour unchanged).
4. Stop checks that cannot change the kept list; count each bound violation (must be 0).
5. Date: symmetric segment and mutual acceptance masks at touch.
6. Signifiers, stated and not inferred, with gates of zero violations.
7. Integer Date pack value with a proved upper bound.
8. Friend: exact closeness per segment, block-max, a symmetric pair memo; filter the structural tags.
9. Clef honesty: photo count, uncertainty, percentile standing, monitors.
10. Route member requests through the lane index and the pair gate.
11. Stable identity; weekly capacity applied in selection.
12. Incremental add and remove with an "incremental equals full" gate.
13. Friends quality terms that match what builds a friendship: transit, slot overlap, repetition, age and life stage.
14. Learned private taste for Date, simulator first, with a calibration knob.
15. Circles and crews: wedge closing, size about four, swap improvement, an offline packing oracle.

## What will not work

- An approximate index (HNSW, LSH, k-means or e-means clusters) as the candidate source.
- A larger check budget. The touch limit binds first, and both limits together give cost N times the window.
- A single global attractiveness score, or any score from likes received.
- More questionnaire items to predict chemistry before a meeting.
- A tuned engine judged on the planted worlds. That fits the generator.
- A comparison of two engines on three pinned seeds of trajectory outcomes.

## Decisions for the product owner

1. Openness to trans partners: an openness filter that all members answer, or inclusion only.
2. How an unanswered openness question is handled.
3. Friendship gender openness in scope for friends.help.
4. Cofounder fields (role, commitment, idea state) as new scope.
5. The friends transit rule: least tolerance instead of the sum.
6. Whether parity and balance apply to a member's direct request.
