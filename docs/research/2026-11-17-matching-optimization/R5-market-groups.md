# R5. Matching markets, groups and the three relationship shapes

Angle: market design and group formation for The Network's one generic matching engine.
Worktree read: `/Users/nubs/thenetwork-matching` at `3f0f8586` (read only). Files read: `AGENTS.md`, `docs/results/2026-11-17-matching-engine-migration.md`, `spec/matchLane.md`, `spec/selectionRun.md`, `spec/groupFormation.md`, `spec/peonCapacity.md`, `spec/peonCofounder.md`, `packages/engine/src/match/{run,circles,pair,profile}.ts`, `packages/engine/src/packs/slop/{generators,profile}.ts` (and `extract.ts` by grep), `packages/engine/src/packs/friends/vectors.ts`, `packages/engine/src/packs/peon/selection.ts`, `packages/sim/src/apps/slop/{persona,packEval}.ts` (by grep), `packages/network/src/network.ts` (`searchFor`), plus the earlier research notes `G-architecture.md` and `D-theory.md` section 4.

Citation rule used here: "[opened]" means I opened the page or abstract in this session; "[search summary]" means I saw it only through search-result text; "[recalled, unverified]" means I did not open it.

---

## 0. The short answer

1. **Our score is a "globally ranked pairs" market, and that is the most important structural fact.** A single symmetric integer value per pair, with a total tie-break order, is the SR-GRP model of Abraham, Levavi, Manlove and O'Malley (2008). In that model a stable matching (and a stable b-matching with capacities) always exists *whether or not the compatibility graph is bipartite*, and the greedy pass in value order finds it. With a strict total order it is also the only one (proof sketch in section 1.2). So orientation pools that are not bipartite (gay, lesbian, bi, pan, nonbinary, trans and the partners open to them) do **not** endanger stability for us, and we should not move to Irving's roommates algorithm or Gale-Shapley on individual lists: random roommates instances typically have no stable matching (Chin and Michelen 2026 prove P(exists) <= n^(-1/17)).
2. **Where greedy is right:** dating (1:1 peers), cofounders (peers), Intro (peers), Hire *as long as both sides' rankings are close to the symmetric value*. **Where it is not enough:** (a) groups (friend circles and crews), where the problem is weighted set packing and greedy only guarantees 1/k of the optimum for groups of size k; (b) thin pools, where the unique stable outcome leaves members of small pools with nothing (our slop "lowest group" ratio is 0.324 against a 0.7 target); (c) member requests (88% of ntwrk meetings), which bypass the engine and its reciprocity and parity rules entirely; (d) Hire when employer and candidate rankings differ (measure first).
3. **Most new signifiers are admissibility, not utility.** Orientation, trans identity with "open to trans partners", "friends with men, women or both", cofounder commitment and equity expectations, work location and salary bands are mutual hard rules. They belong in the pair gate and in the segment key (so search partitioning stays exact), not in weights. The engine already models orientation this way (`dateSegmentOf`: own pool and cell, partners = sought pools on reachable cells). It does not model trans openness (the simulator draws 3% trans men and women but nobody's preference reads it) or friendship gender preference (friends pack has no gender field at all).
4. **Do not pay for precision the data does not have.** Joel, Eastwick and Finkel (2017) found that pre-meeting traits predict 4-18% of "actor" and 7-27% of "partner" variance in romantic desire but *no* relationship-specific (dyadic) variance. Our measured dating AUC of 0.58 against the simulator's hidden chemistry is consistent with that. An exact top-10 among 50,000 feasible Date partners ranks mostly noise. An epsilon-exact stop rule (stop when the k-th kept value is within epsilon of every unseen bound; Fagin, Lotem and Naor's theta-approximation of the Threshold Algorithm) keeps an honest, provable bound and should cut Date and Friend checks heavily. Measure first that outcomes do not change.
5. **Congestion is handled by restriction, and our weekly batch plus capacity is the right shape.** Arnosti, Johari and Kanoria (2021), Kanoria and Saban (2021), Ashlagi, Braverman, Kanoria and Shi (2020) and Halaburda et al. (2018) all point the same way: cap what people can send, recommend only partners with a real chance of *mutual* interest, let the short side initiate, and give scarce signals (Lee and Niederle 2015: a "rose" raised acceptance by 7 to 10 percentage points). We have the cap and mutual feasibility; we lack per-pool short-side awareness and a scarce signal.

---

## 1. Dating (slop.date): 1:1 peers, with pools

### 1.1 The market model we actually run

- Lane `Date`, shape Peers, side Peer. Hard rules (pack): adults only, mutual gender and orientation inclusion (`orientation_mismatch`: each `is` is in the other's `seeks`), mutual age ranges, mutual radius, dealbreakers. These are encoded as **segments**: own = `pool|cell`, partners = every sought pool on every cell within the member's own limit (`packages/engine/src/packs/slop/generators.ts`, `dateSegmentOf`). The segment rule is a proved superset of the pair rule (`segmentPairAllowed`), so search partitioning stays exact.
- Value: harmonic mean of the two directed utilities (weights complement 3, affinity 2, closeness 2, pack 3; pack = Clef-informed directed compatibility), utility floor 350, standing = Clef overall mapped to 0..100, band 15 + both uncertainties, free gap 10, penalty 10 per point.
- Selection: exposure floor, exploration, then greedy in (value desc, key asc) under weekly capacity 2 (`spec/selectionRun.md`). Proved: a greedy refusal names a member with no room who holds only reservations of value at least the refused one, i.e. no blocking pair inside the greedy phase for the shared value.

### 1.2 Stability with a symmetric score: what we can prove and what it costs

**Literature.**
- Abraham, Levavi, Manlove, O'Malley, "The stable roommates problem with globally ranked pairs", WINE 2007 and *Internet Mathematics* 5(4), 2008. [search summary of abstract: "a restriction of the stable roommates problem in which roommate pairs are ranked globally"; preferences derived from rank: E -> N; the paper names the many-to-many variant stable b-matching; and states that SR-GRP does not have the two undesirable properties of SR with ties: possible non-existence of weakly stable matchings and NP-hardness of finding one] URLs: https://projecteuclid.org/journals/internet-mathematics/volume-5/issue-4/The-Stable-Roommates-Problem-with-Globally-Ranked-Pairs/im/1265033177.full , https://core.ac.uk/download/111558099.pdf (both blocked from fetching here). The detailed theorems on maximum-cardinality weakly stable, popular and Pareto-optimal matchings in SR-GRP are [recalled, unverified]: I recall that maximum-size weakly stable is NP-hard under ties, and that Pareto-optimal and popular results differ; check before citing.
- Chin and Michelen, "The random stable roommates problem typically has no solution", arXiv:2601.07612 (Jan 2026). [opened abstract] Proves the Gusfield-Irving conjecture: for uniformly random preferences, P(stable matching exists) <= n^(-1/17) for large n. https://arxiv.org/abs/2601.07612
- Irving (1985), O(n^2) roommates algorithm; Tan (1991) stable partitions always exist. [search summary]
- Popular matchings in the roommates setting are NP-hard: Gupta, Misra, Saurabh, Zehavi; Faenza, Kavitha, Powers, Zhang, "Popular matchings and limits to tractability", arXiv:1805.11473 (dominant matchings NP-hard in non-bipartite graphs; max-weight popular NP-hard, Kavitha). [search summary] https://arxiv.org/abs/1805.11473
- Greedy b-matching is a 1/2-approximation of maximum weight (Mestre 2006: b-matching is 2-extendible), and the b-Suitor algorithm (Khan, Pothen et al., SISC 2016; SC16) computes *the same* b-matching as greedy, in parallel, via locally dominant edges (Preis 1999). [search summary] https://www.cs.purdue.edu/homes/apothen/Papers/bMatching-SISC-2016.pdf , https://www.cs.purdue.edu/homes/apothen/Papers/bSuitor-SC16.pdf

**What this means for us (our own derivation; check it in a proof):**
- With values unique under (value, key), the greedy b-matching is the **unique** stable b-matching for the shared value. Sketch: the top remaining edge e = (a, b) must be in every stable b-matching of the residual instance, since otherwise a and b each hold only worse edges or have room, so e blocks; remove e, lower both capacities, induct. The proved `selectionRun` refusal rule is exactly the "no blocking pair" half of this; uniqueness is the other half and is cheap to state as a Quint `sometimes`/oracle check on small worlds (enumerate all b-matchings for n <= 8).
- Consequences: (1) bipartite or not, the outcome is well defined; orientation graphs need no special algorithm. (2) Candidate-proposing or member-proposing deferred acceptance on preferences *induced by the shared value* returns the same matching, so "fairer to one side" variants do not exist in our model. (3) **Any** change to who gets matched (exposure floors, thin-pool priority, fairness) must break stability for the shared value. That is a price we should count, not hide: report the number of greedy-blocking pairs created by the exposure and exploration phases ("price of the floor"; D-theory 4d already proposes it).
- Uniqueness also gives an incremental property: a new edge changes the matching only along a cascade of displaced edges (each displacement strictly lowers value), the same local-dominance structure b-Suitor uses. That is useful only for a mid-week partial run; weekly selection over E <= N x searchLimit edges is O(E log E) and does not need to be incremental.

**Where individual preferences matter.** A member's own ranking is u(a->b), not the harmonic value. A pair that the shared value ranks low can still be a *directed* blocking pair (both members prefer each other by their own utilities to what they got). We cannot guarantee zero directed blocking pairs (roommates may have no stable matching), but we can **count** them over the edge set at cost O(E). Proposal P6.

### 1.3 Pools as a general admissibility graph (orientation, trans identity and openness, nonbinary)

**Model.** Let a *cell* be (matchGender in {woman, man, nonbinary}) x (transFlag in {cis, trans, undisclosed}). Each member has `own: cell` and `accepts: set of cells`. A pair is admissible iff `own(b) in accepts(a)` and `own(a) in accepts(b)`. The cell graph has a self-loop for gay and lesbian members and edges across genders for straight, bi and pan members, so it is not bipartite. Because our stability argument does not need bipartiteness (1.2), nothing about selection changes; only the segment key and the pair rule change.

**What the data says about the cells.**
- Blair and Hoskin, "Transgender exclusion from the world of dating", *J. Social and Personal Relationships* 36(7):2074-2095, 2019, DOI 10.1177/0265407518779139 [search summary]: of N = 958, 87.5% would not consider dating a trans person; 3.1% of cisgender heterosexual respondents would; about 55% of queer or bisexual respondents would; willingness was higher toward trans men than trans women. https://cambridgeblog.org/2019/06/who-will-date-a-trans-person/
- Rosenfeld and Thomas, "Searching for a mate", *American Sociological Review* 77(4):523-547, 2012 [search summary]: people in thin markets (gay men, lesbians, middle-aged heterosexuals) are especially likely to meet online; 61% of recent same-sex couples met online against 21.5% of heterosexual couples. https://journals.sagepub.com/doi/10.1177/0003122412448050

**Implications.**
1. Trans openness is the strongest single admissibility filter in dating. Our simulator draws trans identity (3% of men and women, `packages/sim/src/apps/slop/persona.ts` lines 160-175) but no persona's `seeks` reads it, and the fairness groups are `matchGender:orientation` (`groupOf`, line 379), so trans members are both easier to match in the sim than in reality and invisible to the fairness gate. The engine extracts `identity` (trans_woman, cis_man, ...) as agent_private and never reads it in matching (`extract.ts` lines 9 and 56).
2. Thin pools are where the platform adds most value (Rosenfeld and Thomas), and where our greedy outcome is worst: our "lowest group vs overall" dates ratio fell from 0.506 to 0.324 with the migration (target 0.7). In a thin cell, members' feasible sets are small, values to the few feasible partners are often not the partners' best, and capacity contests are lost.
3. **Privacy design is a founder decision, not an engine decision.** Options: (a) trans members choose whether identity is used for matching (undisclosed = treated as the stated gender, with the safety risk that implies); (b) every member states "open to dating trans people: yes / no / ask me"; a refusal is a silent pair-gate reason, never text. The pair gate refusing silently does not leak identity to the excluding member, because they never see the excluded member. It can leak to the agent-side explanation and to counts; the leak guard (`appearanceLeak`-style check) must cover "identity" words in relay and explanations.

**Proposals (dating).** P2 (trans and gender-scope admissibility), P3 (thin-pool aware exposure), P4 (epsilon-exact stop), P6 (directed blocking count), P10 (signals). Details in section 6.

### 1.4 Attractiveness (Clef) as standing: what the market literature says

- Burdett and Coles, "Marriage and class", *QJE* 112(1):141-168, 1997 [search summary]: NTU search with heterogeneous agents; equilibrium sorting into classes. (The class-band reading is from D-theory and [recalled]: with a common ranking, people match within intervals.) https://ideas.repec.org/a/oup/qjecon/v112y1997i1p141-168..html
- Hitsch, Hortacsu and Ariely (2010, *AER*) and Bruch and Newman (2018, *Science Advances*) [recalled in D-theory, unverified here]: people aim about 25% above their own desirability; replies fall with the gap; Gale-Shapley on estimated preferences reproduces observed sorting.
- Joel, Eastwick and Finkel, "Is romantic desire predictable?", *Psychological Science* 2017, DOI 10.1177/0956797617714580 [search summary]: random forests on 100+ pre-date measures predicted 4-18% of actor variance and 7-27% of partner variance and no relationship variance. https://www.psychologicalscience.org/news/releases/romantic-matches-are-hard-to-predict.html

So for Date: Clef standing models the *partner effect* (how much people in general want this person), and a parity band on it is exactly the Burdett-Coles class structure that mutual acceptance produces. The *dyadic* term (who likes whom in particular) is not predictable before meeting; it becomes predictable only from revealed taste after dates (`History.rated`, `ratedSelf`, `ratedBody` already exist in `SlopProfile`). Consequences:
- Keep the parity band as a gate. Do not sharpen the dyadic ranking with more search effort; spend effort on admissibility completeness (no feasible partner missed) and on parity.
- The pack term should move toward revealed taste as dates accumulate (the member's own ratings of people they met, shrunk toward zero with few ratings). This is a pack-value change with an integer shrinkage formula, measurable as AUC on the second date in the slop world.
- "Cache early processing: similar people match similar others": in this model, members with the same (cell, Clef band, coarse location) are near-exchangeable from the market's point of view; the useful cached object is a *class-to-class bound matrix* (section 5.2), not per-person lists.

---

## 2. Friendship (friends.help): 1:1 and 1:many peers, groups of 3-6, recurring crews

### 2.1 Literature that bears on our circle builder

- **Group size.** Dunbar, Duncan and Nettle, "Size and structure of freely forming conversational groups", *Human Nature* 6:67-78, 1995 [search summary]: spontaneous conversation has an upper limit of about four people; most cliques were pairs or triads. https://link.springer.com/doi/10.1007/bf02912493 . Fay, Garrod and Carletta (2000, *Psychological Science*) [recalled in D-theory]: groups of 5 behave as dialogue, 10 as serial monologue.
- **Time to friendship.** Hall, "How many hours does it take to make a friend?", *J. Social and Personal Relationships*, 2018, DOI 10.1177/0265407518761225 [search summary]: roughly 40-60 hours for a casual friend, 80-100 for a friend, 200+ for a close friend; time socializing counts, time working together much less. https://news.ku.edu/news/article/2018/03/06/study-reveals-number-hours-it-takes-make-friend . At two hours a meetup, a casual friendship needs about 20-30 meetups with the same person. **A new random circle every week cannot make friends; repeated crews can.**
- **Triadic and focal closure.** Kossinets and Watts, *Science* 311:88-90, 2006, and "Origins of homophily in an evolving social network", *AJS* 2009 [search summary]: one shared class had about the same effect on a new tie as one mutual friend; more mutual friends counted more than more shared classes; tie formation is strongly biased by triadic and focal closure. https://research.google/pubs/origins-of-homophily-in-an-evolving-social-network/
- **Fractional hedonic games.** Aziz, Brandl, Brandt, Harrenstein, Olsen, Peters, "Fractional hedonic games", arXiv:1705.10116 (2017), *ACM TEAC* 7(2), 2019 [opened abstract]: utility = average value of coalition members; the core can be empty and deciding non-emptiness is hard in general; non-empty for some classes. https://arxiv.org/abs/1705.10116 . Bogomolnaia and Jackson (2002, *GEB* 38(2)) [search summary]: Nash, individual and core stability; individually stable partitions may not exist without extra conditions.
- **Group activity selection (GASP).** Darmann, Elkind, Kurz, Lang, Schauer, Woeginger, arXiv:1401.8151 [search summary]: agents have preferences over (activity, group size); hard in general. Igarashi, Bredereck, Peters, Elkind, "Group activity selection on social networks" (arXiv:1611.04524, 1712.02712) [search summary]: stable outcomes intractable even on simple networks when each activity has one group; W[1]-hard parameterizations. Our planner (activity x time x circle) is a GASP instance, so we should not claim stability of the plan, only coherence and counted diagnostics.
- **Dinner seating.** Berriaud, Constantinescu, Wattenhofer, "Stable dinner party seating arrangements", arXiv:2305.09549 (WINE 2023) [search summary]: deciding envy-free seatings is NP-complete even with binary preferences; polynomial for a bounded number of agent classes; swap dynamics may not converge. Do not optimize seats.
- **Weighted set packing.** Choosing disjoint circles of size <= k to maximize total weight is weighted k-set packing. Greedy gives a 1/k guarantee; local search with bounded swaps gives about 2/(k+1) (Berman 2000; Neuwohner 2023 on its limits; Hurkens and Schrijver 1989 for the unweighted k/2 + epsilon). [search summary] https://link.springer.com/article/10.1007/s10107-023-02026-3 . Partition into triangles is NP-complete [recalled, Garey and Johnson].
- **Team formation.** Lappas, Liu, Terzi, "Finding a team of experts in social networks", KDD 2009, DOI 10.1145/1557019.1557074 [search summary]: cover required skills with low communication cost; NP-hard for both cost functions. Relevant only to work teams.
- **Community detection** (modularity, Louvain, Leiden, clique percolation): the modularity resolution limit (Fortunato and Barthelemy 2007, [recalled in D-theory]) means it cannot find 3-6 person groups in large graphs; use only as coarse blocking, never to form circles.

### 2.2 What our circle builder does, and where it loses quality

`packages/engine/src/match/circles.ts`: links = mutual edges with value >= circle pair floor (150 for Friend); seeds = every triangle of the link graph, sorted by (lowest pair, total, key); grow greedily by best lowest-pair value among neighbours of `group[0]` whose values to *every* member are already links; admit with `circleCoherent`; each member in one circle per run.

Issues seen in the code and the numbers:
1. **Pair values come only from the edge list.** A pair is a link only if one side kept the other in its top `searchLimit` (12) list. At 100,000 members only 21.8% of Friend searches close exact; the kept lists are budget-truncated. A six-member clique needs all 15 pairs to appear in someone's top-12 list. Many coherent circles are refused because a pair value was never *computed*, not because it is low. Fix (P7): when growing, compute missing pair values directly through `pairValueOf` (the one pair gate). Bound: at most (size - 1) checks per candidate and at most (circleMaximum - 1) x (sum of the group's link degrees) candidates, so at most 5 x 6 x 24 = 720 checks per seed; cap with a per-run circle budget and report it.
2. **Greedy seed order is a 1/k packing.** Seeds are taken in strength order and members are used once per run. A strong triangle can block two other circles. One improvement round of 1-for-2 swaps (replace one admitted circle by two disjoint coherent circles of larger total) moves the guarantee from 1/k toward 2/(k+1) and is cheap on the sparse link graph.
3. **No size preference.** The builder grows to the maximum (6) whenever any admissible candidate exists. Conversation research says four. Proposal P8: grow to 4 by default and to 5-6 only when a planned activity needs it, or rank completed circles by (lowest pair value, then |size - 4| ascending).
4. **No repeat structure in the matcher.** Repeat-meetup rate is 30.5% against a 30% gate (margin 0.5 points). Hall's numbers say the crew is the product. Proposal P9: an incumbent circle (met, both-sides positive feedback, `repeatEncounter`) keeps priority in the next run if every pair still has a value at the floor; new circles fill around incumbents. This is the hedonic-games "individual stability" check, restricted to the incumbents, and it is a deterministic rule we can state in Quint.
5. **No friendship gender scope.** `friendsVectors` has no gender field. "Friends with women", "men", "both" or "anyone" is a per-member mutual admissibility rule. As a pair rule plus a segment component it automatically holds inside every circle, because circles require every pair to be a link. Gender *balance* wishes ("not the only woman") are group-level count constraints: a separate predicate `circleCompositionAllowed(counts, wishes)` called in `complete()`. Keep it optional and opt-in.
6. **Triadic closure is free signal.** After circles meet, positive feedback edges exist. Add an integer pack term: mutual liked-friends count (capped), so friends of friends rank higher. The bucket bound for the pack term is already 1000 (sound).

### 2.3 Which selection to run for friendship

- Pairs (1:1 activity partners): greedy b-matching on the shared value, as now (stable for the shared value).
- Circles: greedy seed-and-grow with direct pair checks (P7), one swap-improvement round, incumbents first (P9). Claim only: every admitted circle is coherent (proved); counted diagnostics: individually stable violations (a member who would rather join another circle that would accept them), planted-circle ARI, minimum pairwise value. Do not claim core stability (hard to decide, may not exist).
- Circles against pairs in the same run (open decision 1 in the migration report): with a member used once per run, a circle and the pairs it would cover compete in a set packing. Use one comparable weight: a circle's weight = sum over members of their circle share (`circleMemberShare`) times the lowest pair value; a pair's weight = its value. Or keep a fixed policy order (stored intents first) and state it in `selectionRun`. The order is a product decision; the arithmetic is easy either way.

---

## 3. Work (peon.biz and ntwrk): employer and candidate, cofounders, mentors and investors

### 3.1 Employer and employee: two-sided, many-to-one

**Model.** Seats (Offering side, owned by a manager) with capacity = slate cap (`selection.ts`: base 2 + 1 per opening, max 5, scaled by an expected yes share of 45%, deadline pacing, probation for unproven employers, `capSlate` by remaining openings). Candidates (Seeking side) with weekly capacity 3. Pair value: Hire weights complement 6, affinity 1, closeness 2, pack 1; utility floor 400; band 15 on role level against candidate level; penalty 15 per point.

**Literature.**
- Hospitals/residents and college admissions with responsive preferences always have stable matchings; couples make existence and computation hard: Ronn (1990), "NP-complete stable matching problems", *J. Algorithms* [search summary]; Kojima, Pathak and Roth (2013, *QJE*) show stable matchings exist with high probability in large markets with few couples [recalled, unverified]. A "team hire" (two people who must be hired together) is a couple: do not attempt it with stability claims.
- Arnosti, Johari, Kanoria, "Managing congestion in matching markets", *MSOM* 23(3):620-636, 2021 [search summary]: markets are screening-limited or application-limited; limiting applications, raising application cost, or a market wage can improve welfare on one or both sides. https://pubsonline.informs.org/doi/suppl/10.1287/msom.2020.0927
- Kanoria and Saban, "Facilitating the search for partners on matching platforms", *Management Science* 67(10):5990-6029, 2021 [search summary]: restricting what agents see or do mitigates wasteful search; in unbalanced markets let only the short side initiate; Pareto improvement possible. https://econpapers.repec.org/RePEc:inm:ormnsc:v:67:y:2021:i:10:p:5990-6029
- Ashlagi, Braverman, Kanoria, Shi, "Clearing matching markets efficiently: informative signals and match recommendations", *Management Science* 66(5):2163-2193, 2020 [search summary]: recommend only partners with non-negligible chance of mutual liking, using observable preference components plus signals from the other side; a stable matching is reached with low communication. https://par.nsf.gov/servlets/purl/10200022
- Lee and Niederle, "Propose with a rose? Signaling in internet dating markets", *Experimental Economics* 18(4):731-755, 2015 [search summary]: a limited "rose" signal raised acceptance (about 10.2 pp for male recipients and 7.0 pp for female recipients in the working version) and raised the total number of dates. https://www.nber.org/papers/w17340
- Horton, "The effects of algorithmic labor market recommendations: evidence from a field experiment", *J. Labor Economics* 35(2):345-385, 2017 [search summary]: algorithmic recommendations of workers to employers raised hiring for technical vacancies; the exact effect size I did not verify. https://john-joseph-horton.com/papers/the-effects-of-algorithmic-labor-market-recommendations-evidence-from-a-field-experiment/
- Mashayekhi, Kang, Lijffijt, De Bie, "ReCon: reducing congestion in job recommendation using optimal transport", RecSys 2023, arXiv:2308.09516 [search summary]: spread vacancies across seekers to cut congestion at small NDCG cost. https://arxiv.org/abs/2308.09516 (The peon code comment cites "ReCon, RecSys 2023" for the slate cap; that is this paper.)
- Tomita, Togashi, Hashizume, Ohsaka, "Fast and examination-agnostic reciprocal recommendation in matching markets", RecSys 2023 [search summary]: reciprocal recommendation from a transferable-utility matching model. An alternative to our harmonic score worth reading if Hire quality stalls.

**Assessment.**
- The symmetric greedy is right for Hire **if** employer and candidate rankings agree with the shared value. Our peon AUC is 0.92 and interviews per hire sits exactly at its gate (0.75x of keyword search), so ranking is not the bottleneck; congestion and capacity are.
- When rankings differ (the employer ranks by skill fit; the candidate by pay, remote, brand), the shared value can produce directed blocking pairs. Measure them (P6). Only if they are frequent, run candidate-proposing deferred acceptance on *directed* utilities over the already-found edge set (lists are truncated to searchLimit, so DA is O(E)). DA in many-to-one with responsive preferences always terminates with a stable matching for the directed preferences and is candidate-strategy-proof; its loop invariants are standard and provable in Dafny, but it is a second selection algorithm, so do it only on evidence.
- Level parity: 142 of 4,767 proposed Hire pairs with backed levels have a role-level gap above 1, because the band plus two uncertainties admits it. A seat's level is a *stated* fact by the employer; candidates with no reviewed fact have the widest uncertainty. Market view: the employer is the short side for senior roles and the long side for junior roles; a too-wide band wastes the short side's slate. Option: cap the uncertainty allowance for Hire at the band (gap <= band + min(u_a + u_b, band)), a one-line change to the lane rules with a proof update. Decision for the product owner (open decision 2).
- Signals: allow each candidate one or two "priority" marks a week on seats (and each seat a small number on candidates), carried as a pack-term bonus or as the first tie-break. Lee and Niederle measured 7-10 pp acceptance gains from scarce signals. Must be integer, bounded, and private.
- Legal limits: no protected characteristic as a feature, a standing, or a segment (D-theory 4f, 4g). The founder ruled that compliance gating is not a launch blocker; this report does not propose a gate, only that no new signifier for Hire touches a protected class.

### 3.2 Cofounders: equals

- Shape: Peers in the `Cofounder` lane; balance required (exchange floor 200, tolerance 50%); weights complement 5, affinity 2, closeness 2, pack 1; standing = track record; band 20.
- YC co-founder matching [opened blog via search summary]: founders pick responsibility among Product, Design, Engineering, Sales and Marketing, Operations; 74% of engineering founders prefer a co-founder who does sales and marketing; 130,000 invites with a 25% acceptance rate and 33,000 matches in 2021; profiles reviewed by staff before matching. https://www.ycombinator.com/blog/what-do-people-want-in-a-co-founder , https://www.ycombinator.com/blog/co-founder-matching/
- Hellmann and Wasserman, "The first deal: the division of founder equity in new ventures", *Management Science* 63(8):2647-2666, 2017 (NBER w16922) [search summary]: 1,476 founders in 511 ventures; about one third split equally; heterogeneity in idea generation, prior experience and capital contributions predicts unequal splits; equal splits associate with lower first-round valuations. https://www.nber.org/papers/w16922 . Wasserman, *The Founder's Dilemmas* (Princeton UP, 2012) [recalled, unverified].
- Note on the brief: "Hellmann and Thiele" turned out to be "Friends or foes? The interrelationship between angel and venture capital markets", *J. Financial Economics* 115(3), 2015 [search summary]; it is about investors, not team formation. Do not cite it for cofounders.
- Agarwal, Campbell, Franco, Ganco (2016) on complementary human capital in spin-out teams [search summary, details unverified]; Choi, Goldschlag, Haltiwanger, Kim (NBER 2021) on founding teams and performance [search summary].

**Design consequences.** Complement on skill roles (YC's five areas as offers and seeks), **parity** on track record (standing), and **closeness as near-hard rules** on: commitment (full time now / later, months of runway), equity expectation (equal / proportional), location or remote, risk tolerance, and stage of idea. Large differences in these are the documented source of unequal splits and founder conflict; make the extreme cases a pair rule (for example, "full time now" against "not before next year" is refused) and the rest a closeness trait. Selection: symmetric greedy (stable for the shared value; no bipartite structure needed). Reference rate: 25% invite acceptance at YC.

### 3.3 Mentors and investors: asymmetric with consent on the senior side

- Mentor: offset 25 (mentor intentionally above), no balance rule, the mentor consents; Invest: band 15 on fund tier against traction tier.
- The senior side is the short side and has the scarcest capacity (2 per week). Kanoria and Saban: the short side should initiate. So for Mentor and Invest, the senior member should *pull* from a reviewed shortlist (opt in) instead of receiving pushed proposals, and a junior member's request should count as a scarce signal. This also matches founder intent ("do not set up Marc Andreessen with a first-time founder"): the offset band refuses large gaps, and senior consent covers the deliberate asymmetry.

### 3.4 Member requests (ntwrk): 88% of meetings bypass the engine

`NetworkService.searchFor` (`packages/network/src/network.ts` line 2731) scans every member (O(N) per request), uses a float one-directional `askFit` (requester side only) plus travel and a load penalty, a fit cut of 0.45, and returns the best plus a research-depth number of alternates. It reads no lane vectors, no standing, no parity, no reciprocal floor, and no exchange balance. Market view: a request is a one-sided proposal from the long side, exactly the case where unchecked asks congest the most-wanted members (the load penalty is a hand-made congestion control). Proposal P5: express a request as a *request-scoped Seeking profile* in the Intro lane (its seeks = the request tags), run it through `MatchRun` with the same pair gate and bounded search (or the reverse direction when the requester asks *for* help), keep the load penalty as a capacity, and keep the concierge depth as `searchLimit`. Risk: the unmerged pair-value change raised Intro AUC from 0.56 to 0.73 but lowered meetings from 174 to 150, and a neutral tie-break moved meetings from 174 to 132; so evaluation must be paired across at least 10 seeds with bootstrap intervals, and AUC alone is not an acceptance criterion.

---

## 4. Per shape: selection algorithm, provable guarantee, congestion control

| Shape | Selection | What we can prove with a symmetric integer score and capacities | Where greedy is right | Where it is not | Congestion controls |
|---|---|---|---|---|---|
| Dating 1:1 peers (any orientation graph) | Exposure (thin-pool aware), exploration, greedy b-matching | Greedy phase: no blocking pair for the shared value (proved); with strict order the greedy b-matching is the unique stable one (prove or oracle-check); 1/2 of max total weight (cite Mestre; oracle-check) | Stability and determinism; non-bipartite pools | Thin pools (lowest group 0.324); directed blocking pairs unmeasured | Weekly cap 2 (protects the short side); mutual feasibility before contact; scarce signal (P10); per-pool short side monitoring |
| Friendship pairs | Greedy b-matching | Same as dating | Yes | Pair against circle competition (open decision 1) | Weekly cap 3 |
| Friendship circles 3-6, crews | Incumbents first, then seed-and-grow with direct pair checks, one swap round | Every admitted circle coherent (proved); no member in two circles; checks bounded by a circle budget (to add); greedy is a 1/k packing, local swaps toward 2/(k+1) (cite) | Coherence | Truncated edge list; size; no repeats; no gender scope | One circle per member per run; circle budget |
| Hire many-to-one | Greedy with seat slate caps (as now); DA on directed utilities only if P6 shows many directed blocking pairs | Greedy: stable for shared value with seat capacity; DA: stable for directed preferences, candidate-optimal, strategy-proof for candidates | Peon AUC 0.92; capacity binding | Rankings that differ by side; level gap admits 2 levels | Slate cap (ReCon-style), probation, expected yes share, deadline pacing; candidate priority marks |
| Cofounder peers | Greedy | As dating | Yes | Commitment and equity mismatch not modeled as rules | Cap 2 |
| Mentor, Invest (senior short side) | Senior-side pull from reviewed shortlist; greedy for proactive | Offset band holds (proved); senior capacity | Parity with offset | Pushing proposals to the short side | Senior consent; junior signal budget |
| Requests (ntwrk) | Request profile through MatchRun (P5) | Same pair gate guarantees (no one-sided pair, parity, balance) | n/a today | Today none of the guarantees apply | Load penalty as capacity |

---

## 5. Cost, incrementality and reuse (market-angle notes; other reports cover search in depth)

### 5.1 An honest relaxation of exactness: epsilon-exact closing (P4)

Fagin, Lotem and Naor, "Optimal aggregation algorithms for middleware", *JCSS* 66(4), 2003 (PODS 2001) [recalled, unverified for the exact form] define a theta-approximation of the Threshold Algorithm: stop when the k-th kept grade times theta is at least the threshold. Our integer version: `closeNearExact(s, unseenBound, epsilon)` guard: kept is full and worst kept value + epsilon > unseenBound. Proved consequence (same proof as `alwaysExactBeatsUnseen`): every missed candidate has value < worst kept + epsilon, so the kept list is within epsilon of the brute-force list position by position. With epsilon = 0 this is today's exact close. For Date and Friend, where pre-meeting ranking signal is weak (AUC 0.58 and 0.60; Joel et al. 2017), epsilon = 20-50 permille should close most searches far below the 600-check budget. Measure: share of searches closed exact or near-exact, checks per profile at 10k and 100k, and the same outcome gates (second-date rate, V14, repeat rate) on the same seeds.

### 5.2 Reuse across similar members (the "similar people match similar others" question)

In market terms this is the class structure of Burdett and Coles: members in the same (segment, standing band, tag signature) are near-exchangeable. Two exact reuse devices fit our bound machinery:
1. **Bucket-to-bucket bounds.** The index already keeps per-bucket summaries. Compute U(B, B') once per bucket pair inside a block (unions of the query bucket's seeks and interests against B''s offers and interests, with the least-set-size denominators on both sides). Each query in B starts from B''s order by U(B, B'). This removes repeated bound arithmetic but not pair checks.
2. **Dual pruning.** If U(B, B') <= min over a in B of kth(a) and <= min over b in B' of kth(b), no pair across B x B' can enter either side's list; skip it for both. This is the dual-tree all-k-nearest-neighbour idea (Gray and Moore 2001, "N-body problems in statistical learning" [recalled, unverified]) applied to our upper bounds; it stays exact under the same bound lemma.

### 5.3 Adding new members without recomputing everything

- **Keep top-(k + r) with a stored threshold.** Store each profile's kept list of length k + r and its (k + r)-th value theta. Removing up to r kept partners keeps the top-k exact; more triggers a re-search. (Materialized top-k view maintenance with a buffer; Yi et al., ICDE 2003 [recalled, unverified].)
- **Reverse insertion for a new member n.** n's own search is the usual bounded search. To find every existing b whose list n should enter, walk n's window with the same bucket bounds but stop by the bucket's *minimum stored threshold*: skip bucket B when U(n, B) <= min over b in B of theta(b). The skip is exact by the bound lemma, so n enters every list it belongs in. Cost is bounded by the touched buckets; budget and report it like a search.
- **Selection is recomputed weekly** (O(E log E), E <= N x searchLimit); it does not need incrementality. Uniqueness of the greedy stable b-matching (1.2) means a recomputation never "flips" without a value change, so the result is stable across reruns.
- **Standing changes** (Clef re-rating) move a profile across windows: treat as delete plus insert.

---

## 6. Proposals

Each: what it changes, why, risk, measure, effort, whether exactness or a stated bound survives.

**P1. State and check uniqueness of the greedy stable b-matching (GRP).** Add a law to `selectionRun` (or an oracle gate in the `matching` sim block): on worlds with n <= 8, enumerate every b-matching under capacities and check that the greedy result is the only one with no blocking pair for the shared value. Why: it settles the orientation question (non-bipartite pools are fine) and documents that every fairness change trades stability. Risk: tie handling (equal values) breaks uniqueness unless the key order is part of the ranking; state it with (value, key). Measure: oracle agreement 100% over seeds. Effort S. Exactness: not affected; adds a proof.

**P2. Trans identity and openness, and gender scope in friendship, as mutual admissibility and segment keys.** Dating: cell = (matchGender, transFlag) with `accepts` a set of cells; extend `dateSegment` own and partners; pair rule mirrors it. Friends: `friendsWith` set over genders as a pair rule and a segment component; optional group composition predicate. Simulator: draw openness from Blair and Hoskin rates (for example 3% of cis straight, about 55% of bi or queer, higher toward trans men than trans women), add `identity` to the fairness groups. Why: the strongest dating filter is missing; thin-pool members are invisible to the fairness gate; friendship gender preference is not modeled. Risk: privacy (identity is agent_private; refusals must never become text; counts in staff views could re-identify small groups); a policy decision on undisclosed identity. Measure: zero pairs violating mutual acceptance (blocking gate); dates per member-month by identity group; zero-proposal share by cell. Effort M (pack, sim, specs, proofs of the segment superset). Exactness: kept (segment remains a proved superset of the pair rule).

**P3. Thin-pool aware exposure.** Compute each member's feasible count d(m) during search (count of admissible values seen; exact when the search closed exact, else a lower bound). In the exposure phase, members with d(m) below a threshold and no proposal in the last w weeks get their best feasible edge first if both sides have room (Akbarpour, Li, Oveis Gharan, "Thickness and information in dynamic matching markets", *JPE* 128(3):783-815, 2020 [search summary]: in thin dynamic markets, waiting and using information about who is about to leave matches far more agents than greedy; https://ideas.repec.org/a/ucp/jpolec/doi10.1086-704761.html). Why: the slop "lowest group" ratio is 0.324 against 0.7. Risk: breaks shared-value stability (count it); can push lower-value pairs. Measure: lowest group ratio, zero-proposal share by cell, second-date rate overall, blocking pairs created by the exposure phase. Effort S-M. Exactness: search unchanged; selection stability claim remains limited to the greedy phase, as it already is.

**P4. Epsilon-exact closing for low-signal lanes.** As in 5.1. Why: precision beyond the noise floor buys nothing (Joel et al.; AUC 0.58 and 0.60) and Date and Friend spend the 600-check budget at 100k. Risk: epsilon too large lets weak partners in when values are tightly spread; outcomes could drop. Measure: checks per profile, close-state shares, and unchanged outcome gates on the same seeds; also the brute-force oracle at 100-400 members: kept list within epsilon position by position. Effort S (one transition and its proof). Exactness: replaced by a proved epsilon bound, reported per search.

**P5. Requests through the engine.** As in 3.4. Why: 88% of ntwrk meetings carry none of the reciprocity, parity or balance guarantees and cost O(N) each. Risk: meetings could drop (as the AUC experiment showed); requests may name a person or a need that tags do not capture. Measure: paired 10+ seeds with bootstrap CI on meetings, everyone-yes rate, unsafe proposals, request fill rate; AUC as a secondary measure. Effort M. Exactness: gains the bounded-search guarantees.

**P6. Directed blocking pair count.** After selection, count pairs (a, b) in the edge set with both u(a->b) and u(b->a) above what each received (by their own utilities) and both admissible. O(E). Why: tells us whether the shared value hides real instability, per lane (most likely in Hire). Risk: none (diagnostic). Measure: rate per lane; trigger for DA in Hire if, say, above 5% of selected pairs. Effort S. Exactness: n/a.

**P7. Circles: compute missing pair values directly, with a circle budget.** As in 2.2 item 1. Why: circles are now limited by truncated top-12 lists at scale (21.8% exact at 100k). Risk: more circles of lower minimum value if the floor is low (Friend floor 150). Measure: planted-circle ARI (0.87 now), min pairwise value, circles formed per 100 members, repeat rate, V14; checks used by circles. Effort S. Exactness: coherence still proved; checks bounded by the new circle budget.

**P8. Size preference toward four.** Rank completed circles by (lowest pair value, then distance from size 4), grow beyond four only when the plan needs it. Why: conversational group research. Risk: more, smaller circles use more venues and reviewer time. Measure: attendance, V14, repeat rate by circle size. Effort S. Exactness: n/a.

**P9. Incumbent crews first.** A circle that met and got positive feedback from every member keeps priority in the next run when every pair still clears the floor. Why: Hall 2018 (40-60 hours to casual friendship); repeat gate margin 0.5 points. Risk: closed groups, reduced exposure for newcomers; need an exit path. Measure: repeat-meetup rate, crew survival after 4 meetings, friendship forming against random, newcomer V14. Effort M (spec `repeatEncounter`/`crewOffer` integration). Exactness: n/a.

**P10. Scarce signals.** One or two "priority" marks per member per week (dating, Hire candidates, junior side of Mentor and Invest). Integer pack-term bonus capped at a small value, or a first tie-break. Why: Lee and Niederle (+7 to +10 pp acceptance, more total dates), Ashlagi et al. (signals plus recommendations clear markets). Risk: privacy (a signal must not be revealed unless both sides agree), gaming, strategic overuse; bound applies only if the bonus is bounded (the pack term bound is already 1000). Measure: acceptance rate of signalled versus unsignalled proposals; total meetings. Effort M. Exactness: kept (bounded pack term).

**P11. Swap improvement for circle packing.** After greedy, try replacing one circle by two disjoint coherent circles from its members' neighbourhoods with larger total weight; one bounded round. Why: greedy is 1/k for k-set packing; local search approaches 2/(k+1). Risk: churn of plans already reviewed (run before review only). Measure: total circle weight and number of members seated against greedy, same seeds. Effort M. Exactness: coherence preserved; improvement is not guaranteed optimal.

**P12. Cofounder commitment and equity rules.** Add commitment (now or later), runway, equity expectation, remote or location as closeness traits with near-hard extremes as pair rules; skill offers and seeks on YC's five areas. Why: Hellmann and Wasserman (heterogeneity drives unequal splits), YC data on wanted complements. Risk: extraction quality from conversation. Measure: cofounder mutual-yes rate (benchmark 25% invite acceptance at YC), second meeting rate in the peon world. Effort M. Exactness: kept (traits have interval bounds).

**P13. Reverse insertion and buffered top-(k + r) for new members.** As in 5.3. Why: avoid a full rebuild when one member joins; exact by the existing bound lemma. Risk: stored thresholds go stale when lane tables or pack values change (then rebuild). Measure: checks for one insertion against a full rebuild; oracle agreement after 100 random inserts and deletes. Effort M. Exactness: kept.

---

## 7. What will NOT work for us, and why

1. **Irving's stable roommates or Gale-Shapley on individual preference lists as the guarantee.** Random roommates instances have a stable matching with probability at most n^(-1/17) (Chin and Michelen 2026); a feature that sometimes returns "no stable matching" is not a product. Our shared value already gives existence and uniqueness.
2. **Splitting dating into a bipartite men/women market.** Wrong for gay, lesbian, bi, pan and nonbinary members, and unnecessary under GRP.
3. **Popular matchings.** NP-hard in the roommates setting (Gupta et al.; Faenza et al. 2018); max-weight popular is NP-hard (Kavitha).
4. **Exact maximum-weight b-matching (blossom) in production.** Not stable (a heavier edge can block), hard to explain to reviewers and hard to prove; use only as an offline oracle for the 1/2 bound.
5. **Core-stable or optimal friend circles.** FHG cores may be empty and are hard to decide (Aziz et al. 2017); group activity selection stability is intractable (Igarashi et al.); partition into triangles is NP-complete. Claim coherence and counted diagnostics only.
6. **Modularity or Louvain/Leiden to form circles.** The resolution limit hides 3-6 person groups in big graphs; fine only as a coarse block.
7. **Seat-level dinner optimization.** Envy-free seating is NP-complete even with binary preferences (Berriaud et al. 2023) and swap dynamics may not converge.
8. **Stable team hiring (couples-like joint hires).** NP-complete (Ronn 1990).
9. **Ranking dates more finely before a meeting.** No dyadic signal is predictable pre-meeting (Joel et al. 2017); spend effort on admissibility and parity, then on revealed taste.
10. **Standing from acceptances, likes or popularity (Elo-style).** Already banned in `memberStanding`; it creates feedback loops and encodes rater bias.
11. **Protected characteristics in Hire, race anywhere.** Excluded by design (`NEVER_USED` in slop); keep it so for every new signifier.
12. **More options per member.** Halaburda, Piskorski, Yildirim (2018, *Management Science*) [recalled in D-theory]: more choice raises reservation values and lowers acceptance; keep caps small.

---

## 8. Quality metrics and acceptance thresholds per shape

Every threshold below is a proposal to calibrate on the first runs, then make blocking at "measured minus margin". Report paired differences over at least 10 seeds with bootstrap 95% intervals, because a neutral tie-break moved pooled ntwrk meetings from 174 to 132 on three seeds.

**All shapes (blocking, already 0 today where they exist).** Minor contacts 0; mutual-admissibility violations 0; parity gap beyond band + both uncertainties 0; one-sided pairs (a utility below floor) 0; review before contact; leak guard.

**Dating (sim, slop world).**
- Shared-value blocking pairs in greedy phase: 0 (proved). Blocking pairs created by exposure and exploration: tracked (report the count).
- Directed blocking pairs (P6): tracked, target below 5% of selected pairs.
- Second-date rate against random: target 2.5x (1.92x now).
- Dates per member-month against random: >= 0.9x (0.834x now).
- Lowest group (by gender, orientation and identity) against overall: >= 0.7x (0.324 now); zero-proposal share over 4 weeks per cell: tracked.
- Assortative standing correlation of proposed pairs: positive and inside the band (sanity); exposure Gini by Clef quintile: tracked; lowest Clef quintile dates against overall >= 0.85 (0.928 now).
- Real outcomes: mutual-yes rate per probe, date held rate, second date rate, report and block rate after a date; by cell.

**Friendship.**
- Circle coherence violations 0 (proved). Planted-circle ARI >= 0.6 (0.87 now on planted worlds). Minimum pairwise value and FHG share per member >= 666 (triangle) for every circle.
- Individually stable violations: <= 1% of circles (tracked).
- V14 >= 0.75x oracle and >= 1.75x random; repeat-meetup >= 30% (30.5% now: raise the target once P9 lands); lowest borough >= 0.7 (0.80); harm <= 0.5x random (0.48x).
- Crew survival: share of crews meeting 4+ times in 8 weeks (new; Hall's hours make this the leading indicator).
- Real outcomes: attendance per invite, repeat attendance with the same people, "would meet again" both ways.

**Work.**
- Hire: interviews per hire <= 0.75x keyword (at the gate now); fill rate and time to fill; slate yes share about 45%; congestion: Gini of probes per seat and per candidate; level gap above 1 for reviewed members: 0 (142 of 4,767 overall now); directed blocking pairs tracked.
- Cofounder: mutual-yes rate (benchmark 25%), second meeting rate; balance violations 0 (proved).
- Mentor and Invest: senior opt-in rate, offset gap within band 0 violations, junior requests answered within a week.
- Requests (ntwrk): fill rate, everyone-yes rate, meetings (paired seeds), unsafe proposals 0.

**Cost (every lane, every run).** Pair checks per profile, share of searches closed exact, near-exact (P4) and budgeted, largest unseen bound, circle checks (P7), insertion checks (P13). Gate: checks per profile do not grow with N at fixed lane tables (compare 10k against 100k).

---

## 9. Open questions for the founder and product owner

1. Trans identity in matching: opt-in disclosure, "open to trans partners" question for everyone, or neither? What is done with "undisclosed"?
2. Friendship gender scope: ask everyone (women / men / anyone) or only when the member raises it? Are gender-balance wishes for circles in scope (MVP)?
3. Circles against pairs in the same run: fixed order or one weight (open decision 1)?
4. Hire level gap: cap the uncertainty allowance (open decision 2)?
5. Mentor and Invest: may senior members pull from a reviewed shortlist instead of receiving proposals?
6. Signals ("priority" marks): in scope for MVP, and on which apps?
7. Incumbent crews: how long does a crew keep priority, and how does a member leave quietly?
8. Requests through the engine: acceptable to change the ntwrk request path given the meetings risk, if a paired 10-seed run shows no loss?

## 10. Source list (opened or seen in this session)

- Abraham, Levavi, Manlove, O'Malley 2008, SR-GRP: https://projecteuclid.org/journals/internet-mathematics/volume-5/issue-4/The-Stable-Roommates-Problem-with-Globally-Ranked-Pairs/im/1265033177.full [search summary; PDF blocked]
- Chin, Michelen 2026, arXiv:2601.07612: https://arxiv.org/abs/2601.07612 [opened]
- Aziz et al. 2017, arXiv:1705.10116: https://arxiv.org/abs/1705.10116 [opened]
- Faenza, Kavitha, Powers, Zhang, arXiv:1805.11473: https://arxiv.org/abs/1805.11473 [search summary]
- Aziz, Csaji, Cseh 2023, k-stable matchings, arXiv:2307.03794: https://arxiv.org/html/2307.03794v1 [opened; does not discuss SR-GRP]
- Khan, Pothen et al., b-Suitor: https://www.cs.purdue.edu/homes/apothen/Papers/bMatching-SISC-2016.pdf [search summary]
- Neuwohner 2023, weighted k-set packing local search limits: https://link.springer.com/article/10.1007/s10107-023-02026-3 [search summary]
- Darmann et al., GASP, arXiv:1401.8151; Igarashi et al., arXiv:1712.02712 [search summary]
- Berriaud, Constantinescu, Wattenhofer, arXiv:2305.09549 [search summary]
- Dunbar, Duncan, Nettle 1995: https://link.springer.com/doi/10.1007/bf02912493 [search summary]
- Hall 2018: https://news.ku.edu/news/article/2018/03/06/study-reveals-number-hours-it-takes-make-friend [search summary]
- Kossinets, Watts 2006/2009: https://research.google/pubs/origins-of-homophily-in-an-evolving-social-network/ [search summary]
- Lappas, Liu, Terzi 2009: https://dblp.org/rec/conf/kdd/LappasLT09.html [search summary]
- Lee, Niederle 2015: https://www.nber.org/papers/w17340 [search summary]
- Arnosti, Johari, Kanoria 2021: https://pubsonline.informs.org/doi/suppl/10.1287/msom.2020.0927 [search summary]
- Kanoria, Saban 2021: https://econpapers.repec.org/RePEc:inm:ormnsc:v:67:y:2021:i:10:p:5990-6029 [search summary]
- Ashlagi, Braverman, Kanoria, Shi 2020: https://par.nsf.gov/servlets/purl/10200022 [search summary]
- Akbarpour, Li, Oveis Gharan 2020: https://ideas.repec.org/a/ucp/jpolec/doi10.1086-704761.html [search summary]
- Horton 2017: https://john-joseph-horton.com/papers/the-effects-of-algorithmic-labor-market-recommendations-evidence-from-a-field-experiment/ [search summary]
- Mashayekhi et al. 2023, ReCon, arXiv:2308.09516 [search summary]
- Ronn 1990 (couples NP-complete) [search summary]
- Blair, Hoskin 2019: https://cambridgeblog.org/2019/06/who-will-date-a-trans-person/ [search summary]
- Rosenfeld, Thomas 2012: https://journals.sagepub.com/doi/10.1177/0003122412448050 [search summary]
- Joel, Eastwick, Finkel 2017: https://www.psychologicalscience.org/news/releases/romantic-matches-are-hard-to-predict.html [search summary]
- Burdett, Coles 1997: https://ideas.repec.org/a/oup/qjecon/v112y1997i1p141-168..html [search summary]
- Hellmann, Wasserman 2017: https://www.nber.org/papers/w16922 [search summary]
- Hellmann, Thiele 2015 (angels and VCs, not cofounders): https://ideas.repec.org/a/eee/jfinec/v115y2015i3p639-653.html [search summary]
- YC co-founder matching: https://www.ycombinator.com/blog/what-do-people-want-in-a-co-founder , https://www.ycombinator.com/blog/co-founder-matching/ [search summary]
- Hinge Most Compatible (single-pool Gale-Shapley variant, company claim "8x"): https://techcrunch.com/?p=1668547 [search summary]
- e-means (Meta FAIR), arXiv:2611.09501: https://e-means.github.io/ [opened]. Market note: a clustering method; useful only as a coarse block or class key, never as an exactness-bearing partition.
- Recalled, not opened: Fagin, Lotem, Naor 2003 (TA theta-approximation); Mestre 2006; Preis 1999; Kojima, Pathak, Roth 2013; Gray, Moore 2001; Yi et al. 2003; Halaburda, Piskorski, Yildirim 2018; Wasserman 2012; Fay, Garrod, Carletta 2000; Garey and Johnson (partition into triangles).
