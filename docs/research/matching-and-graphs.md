# Matching, Graphs, and Evaluation: Research Survey for The Network Engine

Status: research note, 2026-10-05. Scope: everything relevant to building and evaluating the asynchronous matching and opportunity engine described in PRD sections 6, 13, 14, 15, and 28-34 (`docs/prd-snapshot.md`).

Every source below was checked to exist (web search hit on the paper/page, or `gh api` for repositories). GitHub stats are as of 2026-10-05. Where a claim about a commercial product comes only from press or third-party write-ups, it is marked as such.

## How to read this

Each item has: link, a 1-3 sentence summary, and a **Use for The Network** note naming the subsystem it informs. Subsystem names used throughout:

| Tag | Subsystem (PRD ref) |
|---|---|
| `RETRIEVAL` | Candidate retrieval: SQL hard filters, vector kNN, tag match, 2-hop graph (33.5) |
| `SCORER` | Component scoring and NetValue combination (33.6) |
| `JUDGE` | LLM judge for finalists, explanations (33.6, 34.5) |
| `GROUP` | Group composer, beam search, alternates (33.7) |
| `WARM-PATH` | Warm-path / second-encounter / network-growth generators (33.4) |
| `POLICY` | Load balancing, budgets, exposure floors, fairness reports (33.8, 15.4) |
| `EXPLORE` | Exploration budget and serendipity (14.5, 33.8) |
| `LEARN` | Post-MVP learning-to-rank, embeddings, calibration (33.11) |
| `SIM` | Network World Simulator, personas, outcome model (34.3-34.4) |
| `EVAL` | Offline metrics, judge golden sets, shadow mode, pilot (34.5-34.6, 21) |
| `PRIVACY` | Scopes, inference privacy, explanation shareability, canaries (17, ME-003) |
| `STORE` | Postgres schema, pgvector, edges, recursive CTEs (13, 22, 31) |

## Executive summary (the five things that matter most)

1. **Score pairs by the weaker side, not the sum.** Every reciprocal-recommendation result since RECON (2010) says the same thing: combine directional interest with a harmonic or geometric mean, or a min. Our `MutualBenefit` term should be `harmonic_mean(P(i values it), P(j values it))`, and groups should carry a least-misery floor.
2. **Don't use Gale-Shapley as the engine.** Stable matching needs dense, complete preference lists. Our setting is sparse, asynchronous, non-bipartite, has small capacities, and includes groups, and the non-bipartite case often has no stable solution at all. Use it as a *diagnostic* (count blocking pairs). Use capacity-constrained max-weight selection (b-matching) per run instead, and enforce per-member budgets. The market-design literature (Kanoria-Saban, Rios-Saban-Zheng) shows congestion control is where the value is.
3. **Graph features beat embeddings at our scale.** At 150-1,000 members, Adamic-Adar and common neighbors, tie strength, Burt constraint (bridging), and a nightly community partition are cheap, explainable, and strong. Postgres recursive CTEs over 2 hops are fine, and we do not need Apache AGE or Neo4j in v1. Defer node2vec and GNNs until there are tens of thousands of edges.
4. **Log everything a future learner needs: propensities, exposures, reviewer actions, and outcomes.** Exploration picks must record the probability they had of being chosen. Without that, the post-MVP learning-to-rank and off-policy evaluation plan (33.11) is biased by our own heuristics and by reviewer selection.
5. **LLM judges and LLM persona simulators are useful but systematically biased.** Judges have position, verbosity, and self-preference bias. Simulated users are too agreeable and accept too often. Pair-specific chemistry is largely unpredictable before people meet (Joel et al. 2017). So calibrate judges against reviewer labels, swap orderings, and keep the judge as one bounded input. Drive simulated acceptance from hidden ground-truth utilities plus a calibrated choice model, not from LLM free choice.

---

## 1. Reciprocal / two-sided (people-to-people) recommender systems

**1.1 Palomares, Porcel, Pizzato, Guy, Herrera-Viedma (2021). "Reciprocal Recommender Systems: Analysis of state-of-art literature, challenges and opportunities towards social recommendation." Information Fusion 69.**
https://arxiv.org/abs/2007.16120
The canonical survey of people-to-people recommendation (dating, recruitment, mentoring, social). It covers how mutual preference is modeled, how directional scores are aggregated, and the open problems: cold start, fairness, and explanations.
**Use for The Network:** `SCORER`, `EVAL`. Read first. It frames every pair generator (intent-to-capability, complementary intents, warm path) as an RRS problem, where success needs a yes from both sides.

**1.2 Pizzato, Rej, Chung, Koprinska, Kay (2010). "RECON: A reciprocal recommender for online dating." RecSys 2010.**
https://www.researchgate.net/publication/221140972_RECON_A_reciprocal_recommender_for_online_dating
A content-based reciprocal recommender that learns each user's implicit preferences from whom they contact, scores both directions, and combines them with a harmonic mean. Accounting for reciprocity substantially improved success over one-sided ranking.
**Use for The Network:** `SCORER`. Directly adopt the harmonic-mean combination of directional fit, which punishes lopsided matches.

**1.3 Pizzato et al. "Recommending people to people: the nature of reciprocal recommenders with a case study in online dating."**
https://www.researchgate.net/publication/257671598_Recommending_people_to_people_The_nature_of_reciprocal_recommenders_with_a_case_study_in_online_dating
Lays out the properties that distinguish reciprocal recommenders. Users are both subject and object. Popular users get overloaded. Proactive vs. reactive users behave differently. Failure has a cost for the recipient.
**Use for The Network:** `POLICY`. This is the theoretical basis for the per-member inbound budget (ME-002) and for penalizing over-asked popular members.

**1.4 Yang, Dai, Hou, Zhao, Xu, Song, Zhu (2024). "Revisiting Reciprocal Recommender Systems: Metrics, Formulation, and Method." KDD 2024.**
https://arxiv.org/abs/2408.09748
Proposes five RRS metrics in three families: overall coverage, bilateral stability, and balanced ranking. It also reframes recommendations as bilateral causal interventions.
**Use for The Network:** `EVAL`. Adopt coverage (share of members receiving at least one viable proposal), bilateral stability (blocking-pair rate), and balanced ranking (rank asymmetry between the two parties) in the nightly report (ME-012).

**1.5 Su, Bayoumi, Joachims (2022). "Optimizing Rankings for Recommendation in Matching Markets." WWW 2022.**
https://arxiv.org/abs/2106.01941
Shows that naive one-sided recommenders are suboptimal in matching markets. Jointly optimizing everyone's rankings for social welfare, while accounting for the evaluating side's capacity, increases total matches and fairness.
**Use for The Network:** `POLICY`, `SCORER`. Justifies a *global* per-run selection step (choose the set of proposals across all members) instead of a greedy per-member top-k.

**1.6 Tomita, Togashi, Hashizume, Ohsaka (2023). "Fast and Examination-agnostic Reciprocal Recommendation in Matching Markets." RecSys 2023.**
https://arxiv.org/abs/2306.09060
A scalable welfare-maximizing reciprocal ranking method that does not require a known position-examination model. It uses transferable-utility matching theory.
**Use for The Network:** `POLICY`. A candidate algorithm for the global selection step once candidate pools grow.

**1.7 Tomita et al. (2024). "Fair Reciprocal Recommendation in Matching Markets." RecSys 2024.** Code: https://github.com/CyberAgentAILab/FairReciprocalRecommendation (6 stars, MIT, updated 2025-09).
https://arxiv.org/abs/2409.00720
Defines envy-freeness for reciprocal recommendation and uses Nash social welfare to trade off match count against fairness of match opportunities. The repo includes synthetic market generators.
**Use for The Network:** `POLICY`, `SIM`. The synthetic data generator is a good starting point for unit-testing global selection. Nash welfare (product of utilities) is a principled objective for the run-level allocator.

**1.8 Rios, Saban, Zheng (2023). "Improving Match Rates in Dating Markets Through Assortment Optimization." MSOM.**
https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3698751
A dating platform piloted a dynamic assortment algorithm and gained more than 25% in matches. A key empirical finding: users' recent match count *lowers* their propensity to like, so users with many recent matches are less responsive.
**Use for The Network:** `POLICY`, `SCORER`. Model acceptance probability as decreasing in recent proposals and matches. This is the empirical justification for cooldowns and for preferring under-served members.

**1.9 Kanoria, Saban (2021). "Facilitating the Search for Partners on Matching Platforms." Management Science.**
https://pubsonline.informs.org/doi/10.1287/mnsc.2020.3794
In a two-sided search model, platforms improve welfare by *restricting* actions. Examples: let only the short side initiate, and hide quality information to reduce wasted screening.
**Use for The Network:** `POLICY`. It supports our design where the Network, not members, initiates, and where no universal member score is ever shown (anti-caste rule, 33.8).

**1.10 "Managing Congestion in a Matching Market via Demand Information Disclosure." Information Systems Research (2022).**
https://pubsonline.informs.org/doi/10.1287/isre.2022.1148
Studies dating-market congestion, where attention concentrates on popular users, and tests disclosing peers' recent demand as an intervention.
**Use for The Network:** `POLICY`. Popular members are a congestion risk. Load penalties belong in the score, not just in post-hoc filters.

**1.11 "The Dating Heuristic: A Provably Strong Matching Algorithm for Dating Platforms." MSOM (2024).**
https://arxiv.org/abs/2308.02584
A simple, provably near-optimal policy for which profiles to show whom when matches require sequential mutual likes.
**Use for The Network:** `POLICY`. A simple baseline for the sequencing problem: whom to ask first in an intro, given that the first party's acceptance gates the second ask.

**1.12 Backstrom, Leskovec (2011). "Supervised Random Walks: Predicting and Recommending Links in Social Networks." WSDM 2011 (Facebook data).**
https://cs.stanford.edu/people/jure/pubs/linkpred-wsdm11.pdf
Learns edge weights from node and edge features so a personalized PageRank random walk lands on future friends. It beat hand-engineered feature classifiers on Facebook data.
**Use for The Network:** `WARM-PATH`, `LEARN`. A post-MVP way to learn which edge types (worked together, vouched, hosted) predict successful intros.

**1.13 LinkedIn PYMK.** "Reinventing People You May Know at LinkedIn" (https://www.linkedin.com/pulse/reinventing-people-you-may-know-linkedin-mitul-tiwari) and "Organizational Overlap on Social Networks and its Applications" (WWW 2013; https://engineering.linkedin.com/social-network-analysis/organizational-overlap-social-networks-and-its-applications)
PYMK is framed as link prediction over the professional graph and drove a majority of LinkedIn's connection growth. Organizational overlap (shared employer and time windows) is a strong feature.
**Use for The Network:** `WARM-PATH`. "Overlap in a shared context during the same time window" maps directly to our Presence and Event co-attendance. Two members at the same event or neighborhood in the same week is a strong, explainable feature.

**1.14 Borisyuk et al. (2024). "LiGNN: Graph Neural Networks at LinkedIn."**
https://arxiv.org/abs/2402.11139
A production GNN framework over a 100B-node graph, with temporal architectures and cold-start "graph densification." It reports modest gains, including about 0.1% WAU from people recommendation.
**Use for The Network:** `LEARN`. Context only. GNN gains are incremental even at LinkedIn scale. This confirms we should not invest in GNNs at 1k members.

**1.15 Tinder TinVec (Steve Liu, MLconf 2017).**
https://mlconf.com/sessions/personalized-user-recommendations-at-tinder-the-t/
Tinder embedded users with a word2vec-style model over swipe sequences: users co-liked by the same swipers end up near each other. Reproduction: https://github.com/CharlesGaydon/Dater-to-Vec (24 stars, MIT, archived).
**Use for The Network:** `LEARN`. Not applicable until we have dense implicit feedback. Noted as the canonical "behavioral embedding" pattern to avoid prematurely.

**1.16 Hinge "Most Compatible" (TechCrunch, 2018).**
https://techcrunch.com/2018/07/11/hinge-employs-new-algorithm-to-find-your-most-compatible-match-for-you/
Press reports that Hinge learns each user's likely preferences from behavior and then runs Gale-Shapley (and stable roommates for non-binary pools) to produce one mutual daily recommendation. In tests, these were reportedly 8x more likely to lead to dates.
**Use for The Network:** `SCORER`, `POLICY`. The transferable lessons are scarcity and the single high-conviction daily pick, not the stable-matching step specifically. This is exactly our "few high-conviction proposals" goal.

**1.17 OkCupid match percentage (explainers).**
https://www.hackerearth.com/practice/notes/okcupids-matching-algorithm-1/
Each user answers questions, states acceptable answers, and weights importance on a steep scale (0/1/10/50/250). The two directional satisfaction scores are combined by geometric mean.
**Use for The Network:** `SCORER`, `JUDGE`. Two takeaways. First, a steep importance scale makes dealbreakers dominate, which is the same as our hard-floor and dealbreaker flag. Second, geometric-mean combination. Also a model for progressive-profiling questions with an "importance" slot.

**1.18 Joel, Eastwick, Finkel (2017). "Is Romantic Desire Predictable? Machine Learning Applied to Initial Romantic Attraction." Psychological Science.**
https://journals.sagepub.com/doi/abs/10.1177/0956797617714580
On rich pre-date self-report data, models predicted how desirable a person is overall and how selective they are, but not *unique* pair-level desire.
**Use for The Network:** `JUDGE`, `SCORER`, `EVAL`. This is a crucial humility check. Pair "chemistry" is largely unknowable before people meet, so actor/partner effects (reliability, openness, availability) and logistics (timing, place, format) are where predictive signal lives. Weight those heavily and don't let the judge claim chemistry.

**1.19 Machine-learning baselines and code for reciprocal recommendation.** https://github.com/BinFuPKU/ReciprocalRecommender (4 stars, no license, 2020) and https://github.com/RManLuo/MotifGNN (9 stars)
Small academic implementations of several RRS models.
**Use for The Network:** `LEARN`. Reference only. Neither is production-grade, and the first has no license.

---

## 2. Group formation, team formation, hypergraph matching, seating

**2.1 Lappas, Liu, Terzi (2009). "Finding a Team of Experts in Social Networks." KDD 2009.**
https://dl.acm.org/doi/10.1145/1557019.1557074
Defines team formation: cover a required skill set while minimizing communication cost (graph diameter or MST weight among members). It is NP-hard and solved with Steiner-tree-style approximations.
**Use for The Network:** `GROUP`. For help requests and band or cofounder formation, "role coverage + low coordination cost" maps directly. Coordination cost corresponds to our "existing warm ties" and travel friction.

**2.2 Anagnostopoulos, Becchetti, Castillo, Gionis, Leonardi (2012). "Online Team Formation in Social Networks." WWW 2012.**
https://archives.iw3c2.org/www2012/proceedings/proceedings/p839.pdf
Tasks arrive online, and teams must cover skills, keep coordination cost low, and *balance workload* across people. The algorithms are competitive on load balance.
**Use for The Network:** `GROUP`, `POLICY`. This is the closest formal analogue to our help-request generator with contribution-load penalties (15.4). Adopt its framing: treat load as a first-class objective, not a filter.

**2.3 Juárez, Brizuela (2021). "A Comprehensive Review and a Taxonomy Proposal of Team Formation Problems." ACM Computing Surveys 54(7).**
https://dl.acm.org/doi/abs/10.1145/3465399
Taxonomy of team formation problems (objectives, constraints, solution methods: ILP, heuristics, metaheuristics).
**Use for The Network:** `GROUP`. A reference when choosing between ILP and heuristics for each group generator.

**2.4 Masthoff, "Group Recommender Systems: Combining Individual Models" / aggregation strategies.**
https://www.researchgate.net/publication/227132202_Group_Recommender_Systems_Combining_Individual_Models (tutorial slides: https://pro.unibz.it/projects/schoolrecsys17/JudithMasthoff.pdf)
Social-choice aggregation for groups: Average, Least Misery (min), Average-without-Misery, Borda, Multiplicative. Users judge group outcomes partly by fairness and by the worst-off member.
**Use for The Network:** `GROUP`. Our 33.7 objective (average pairwise compatibility + minimum pairwise floor) is "Average without Misery." Make it explicit and also apply it to *activity/venue* choice for the group.

**2.5 Felfernig et al. "Designing Explanations for Group Recommender Systems."**
https://arxiv.org/abs/2102.12413
How to explain group decisions so each member understands why the group and choice fit them.
**Use for The Network:** `JUDGE`. Informs the per-participant "why you" explanation for group invites.

**2.6 Aziz, Savani (2016). "Hedonic Games." Handbook of Computational Social Choice.**
https://www.semanticscholar.org/paper/Hedonic-Games-Aziz-Savani/286dbcbedc1772ddb7f5b11b5d7afe439c60893e
In coalition formation where each player cares only about who is in their coalition, stability (core, Nash, individual) is often NP-hard or nonexistent.
**Use for The Network:** `GROUP`. Do not aim for "stable" groups. Aim for a good welfare objective plus a floor, and let opt-in act as the individual-rationality check.

**2.7 Li, Lu, Bhagat, Lakshmanan, Yu (2014). "On Social Event Organization." KDD 2014.**
https://www.researchgate.net/publication/266660377_On_social_event_organization
Assigns users to events to maximize innate interest plus social affinity among co-assigned users, subject to min and max event capacities.
**Use for The Network:** `GROUP`. This is exactly the monthly all-member gathering's table and activity assignment problem, and the event-anchor generator when several events compete for the same members.

**2.8 "Conflict-aware event-participant arrangement" (ICDE 2015) and "Social Event Scheduling" (arXiv 1801.09973).**
https://ieeexplore.ieee.org/abstract/document/7113329/ ; https://arxiv.org/abs/1801.09973
These extend event assignment with time conflicts between events and with choosing *when* to schedule events to maximize attendance.
**Use for The Network:** `GROUP`, `SCORER`. Covers availability-window intersection and the Wednesday pre-weekend run (33.3), which must avoid double-booking a member across proposals.

**2.9 Bellows, Peterson (2012). "Finding an optimal seating chart." Annals of Improbable Research.**
https://improbable.com/news/2012/Optimal-seating-chart.pdf
A MILP that maximizes "knows each other" connections at each table with a minimum-connections constraint. It is small, readable, and solvable with off-the-shelf solvers.
**Use for The Network:** `GROUP`. A template for an ILP formulation of the monthly gathering's tables. We want the *opposite* sign on familiarity beyond 1-2 warm ties.

**2.10 Lewis, Carroll. "Creating Seating Plans: A Practical Application." J. Operational Research Society.**
https://rhydlewis.eu/papers/LewisCarroll.pdf
A practical heuristic (graph partitioning + local search) for large seating problems with must/can't-sit-together constraints. Deployed as a real wedding-planning tool.
**Use for The Network:** `GROUP`. Use the local-search "swap and improve" step after beam search to polish group compositions and to backfill alternates.

**2.11 Benson, Abebe, Schaub, Jadbabaie, Kleinberg (2018). "Simplicial closure and higher-order link prediction." PNAS.**
https://www.cs.cornell.edu/~arb/papers/ScHoLP-PNAS-2018.pdf (data: https://github.com/arbenson/ScHoLP-Data)
Studies how groups (simplices) form across 19 datasets. A triple is far more likely to "close" into a group when its pairs already have strong pairwise ties. Local information dominates higher-order prediction.
**Use for The Network:** `GROUP`, `WARM-PATH`. This is evidence for our "1-2 existing warm ties" rule. Groups seeded on an existing open triangle are more likely to gel. Also a feature: count of pre-existing edges among candidate group members.

**2.12 Hypergraph tooling: HyperNetX and XGI.**
https://github.com/pnnl/HyperNetX (717 stars, BSD-style, active) ; https://github.com/xgi-org/xgi (256 stars, BSD-3, active)
Python libraries for hypergraph and higher-order network analysis.
**Use for The Network:** `EVAL`, `SIM`. Represent completed groups as hyperedges for offline analysis: group repeat rates, which members co-occur, cluster bridging by groups. Not needed in production code.

**2.13 Lunch Roulette (Fred Benenson).**
https://github.com/fredbenenson/lunch-roulette (167 stars, 2018)
A CLI that forms *diverse* lunch groups. It maps attributes to numbers, scores variance per group, takes the best of N random partitions, and remembers past groupings to avoid repeats.
**Use for The Network:** `GROUP`. A trivially simple baseline (random restarts + score + memory of past co-assignments) to benchmark our beam search against in the simulator. If beam search can't beat it, something is wrong.

---

## 3. Stable matching and variants: when it is and isn't appropriate

**3.1 Roth and the NRMP redesign (Roth, Peranson).**
https://web.stanford.edu/~niederle/nrmpdesign.pdf ; Nobel popular summary: https://www.nobelprize.org/uploads/2018/06/popular-economicsciences2012.pdf
Deferred acceptance in a centralized clearinghouse with capacities (many-to-one), plus engineering for couples. Stability matters when participants can otherwise "go around" the mechanism and contract privately.
**Use for The Network:** `POLICY`. Stability is a *market-unraveling* defense. Our members can't go around us to find opportunities they don't know exist, so stability is not the binding concern. Opt-in is the binding concern.

**3.2 Hospitals/Residents with Couples: "Couples can be tractable" (IJCAI 2024 / Algorithmica 2026) and Biró et al., "The HR problem with Couples: Complexity and IP models."**
https://arxiv.org/abs/2311.00405 ; https://arxiv.org/html/1308.4534v1
Once joint preferences exist (couples, which are like groups), stable matchings may not exist and finding them is NP-hard. Practical systems use ILP and capacity relaxations.
**Use for The Network:** `GROUP`. Joint or group preferences break stable-matching guarantees. More reason to use welfare + floors instead.

**3.3 Stable roommates (non-bipartite): Irving (1985) and random-instance results.**
Mertens, "Stable Roommates Problem with Random Preferences": https://arxiv.org/abs/1401.5269 ; "The random stable roommates problem typically has no solution" (2026): https://arxiv.org/abs/2601.07612 ; JS implementation: https://github.com/gfornari/stable-roommates-problem
Friend matching is non-bipartite. Irving's O(n^2) algorithm finds a stable matching if one exists, but for random preferences the probability of existence goes to 0 as n grows.
**Use for The Network:** `SCORER`, `EVAL`. Friendship and peer intros are roommates problems, so do not promise stability. Use blocking-pair counts as a *quality diagnostic*: if A and B both prefer each other to what they were proposed, the run left value on the table.

**3.4 Many-to-one capacity variation: "Capacity Variation in the Many-to-one Stable Matching."**
https://arxiv.org/abs/2205.01302
Small capacity tweaks can make stable matchings exist, or improve outcomes.
**Use for The Network:** `POLICY`. Our capacities are soft (interruption budgets, quotas). Treat budget as a tunable capacity, not a hard truth, when the network is thin.

**3.5 `matching` Python library (Wilde, Knight, Gillard; JOSS).**
https://github.com/daffidwilde/matching (168 stars, MIT, updated 2025-10) ; paper: https://www.theoj.org/joss-papers/joss.02169/10.21105.joss.02169.pdf
Solves stable marriage, hospital-resident, student-allocation, and stable roommates.
**Use for The Network:** `EVAL`, `SIM`. Use offline to compute the stable or blocking-pair benchmark against each run's proposals. Not for production selection.

**3.6 "Do Matching Mechanisms Work with LLM Agents?" (2026 preprint).**
https://arxiv.org/pdf/2606.03030
Studies "LLM-agent markets" where delegated agents act and negotiate for users, and whether classical mechanisms keep their properties.
**Use for The Network:** `POLICY`. Gateway (section 11) work will eventually face other people's assistants acting for members. Read before exposing any agent-to-agent intent negotiation.

**Verdict for The Network:** Use **max-weight b-matching / ILP selection** per run. The objective is the sum (or Nash product) of pair and group NetValue. Constraints: per-member proactive budget (ME-002), no member in two time-overlapping proposals, a per-pair cooldown, and a minimum exposure floor for newcomers. At 300 members and a few thousand candidate pairs, Google OR-Tools CP-SAT solves this in well under a second. Report blocking-pair counts as a diagnostic. Use deferred acceptance only for the monthly gathering's table and activity assignment, if members rank activities.

**3.7 Google OR-Tools.** https://github.com/google/or-tools (14.1k stars, Apache-2.0, active)
CP-SAT, MIP, assignment, and min-cost flow solvers with Python bindings.
**Use for The Network:** `POLICY`, `GROUP`. The run-level selector (b-matching with budgets and conflicts) and the gathering seating ILP. Lighter alternative: PuLP (https://github.com/coin-or/pulp, 2.5k stars).

---

## 4. Graph methods and graph storage

### 4a. Social theory the engine should encode

**4.1 Granovetter (1973). "The Strength of Weak Ties." AJS 78(6).**
https://www.journals.uchicago.edu/doi/10.1086/225469
Weak ties (acquaintances, friends-of-friends) carry novel information and opportunities better than strong ties, which are redundant.
**Use for The Network:** `WARM-PATH`, `EXPLORE`. Professional and help asks should prefer moderately weak warm paths over best friends. The "life expansion" value is mostly a weak-tie value.

**4.2 Rajkumar, Saint-Jacques, Bojinov, Brynjolfsson, Aral (2022). "A causal test of the strength of weak ties." Science.**
https://www.science.org/doi/10.1126/science.abl4476
Randomized PYMK experiments on 20M+ LinkedIn users over 5 years. Weak ties causally increased job mobility, but with an **inverted U**: moderately weak ties beat both the strongest and the weakest.
**Use for The Network:** `SCORER`, `WARM-PATH`. Encode tie-strength value as an inverted U, peaking at "friend of a friend with some shared context," not monotone in either direction. Strong empirical support for a shaped `WarmPath` term.

**4.3 Burt (2004). "Structural Holes and Good Ideas." AJS 110(2).**
https://www.jstor.org/stable/10.1086/421787
People who broker between otherwise disconnected groups have better ideas and outcomes, because brokerage exposes them to non-redundant information.
**Use for The Network:** `POLICY`, `GROUP`, `EVAL`. This defines "bridge value" and "cluster diversity" (33.7) and the network-health generator. Compute Burt's constraint (NetworkX has `constraint` and `effective_size`) per member nightly. Use it to (a) find natural connectors to ask for intros, and (b) measure whether the Network increases brokerage over time.

**4.4 McPherson, Smith-Lovin, Cook (2001). "Birds of a Feather: Homophily in Social Networks." Annual Review of Sociology.**
https://www.annualreviews.org/content/journals/10.1146/annurev.soc.27.1.415
Similarity breeds connection across almost every dimension. The strongest divides are race and ethnicity, then age, religion, education, occupation, and gender.
**Use for The Network:** `SCORER`, `POLICY`, `EVAL`. Pure similarity scoring will reproduce homophily and segregate the network. Track cross-group exposure as a health metric, and do not use protected attributes as positive similarity features.

**4.5 Kossinets, Watts (2006). "Empirical Analysis of an Evolving Social Network." Science 311.**
https://www.science.org/doi/10.1126/science.1116869
In a university email network, new ties form mostly through triadic closure (shared contacts) and focal closure (shared classes and affiliations). Individual properties are unstable even when aggregates look stable.
**Use for The Network:** `WARM-PATH`, `SIM`. The two strongest generators of real friendships are shared friends and shared foci. The simulator's background tie-formation process should include both, or the engine will be graded against an unrealistic world.

**4.6 Feld (1981). "The Focused Organization of Social Ties." AJS 86.**
https://www.semanticscholar.org/paper/The-Focused-Organization-of-Social-Ties-Feld/4e5a1ed4a89434346eec51a0e8154c7cbeb74c49
Ties form around "foci": places, activities, and organizations that structure repeated interaction.
**Use for The Network:** `GROUP`, `WARM-PATH`. Theoretical basis for event anchors, recurring groups, and "second encounter" generators. Relationships need a recurring focus, not a single meeting.

**4.7 Hall (2019). "How many hours does it take to make a friend?" J. Social and Personal Relationships.**
https://journals.sagepub.com/doi/full/10.1177/0265407518761225
Roughly 40-60 hours of shared time to become casual friends, 80-100 to friends, and 200+ to close friends.
**Use for The Network:** `WARM-PATH`, `EVAL`. One intro cannot make a friendship. Optimize for *repeat* encounters (second-encounter generator, recurring groups) and measure "hours together" or repeat interactions, not single meetings.

**4.8 Chetty et al. (2022). "Social capital I: measurement and associations with economic mobility." Nature 608.**
https://www.nature.com/articles/s41586-022-04996-4
Using 21B Facebook friendships, cross-class friendship ("economic connectedness") was among the strongest predictors of upward mobility. Other social-capital measures were weaker.
**Use for The Network:** `EVAL`, `POLICY`. If The Network claims to build "capital," the analogous measurable is *cross-cluster connectedness*: the share of a member's new ties outside their home cluster. Track it as a north-star network-health metric.

### 4b. Link prediction and embeddings

**4.9 Liben-Nowell, Kleinberg (2007). "The Link-Prediction Problem for Social Networks." JASIST.**
https://www.cs.cornell.edu/home/kleinber/link-pred.pdf
Compares proximity measures for predicting future edges. Simple neighborhood measures (Adamic-Adar, Jaccard, common neighbors, Katz) beat chance by roughly 40x, and Adamic-Adar was among the best.
**Use for The Network:** `RETRIEVAL`, `WARM-PATH`. Compute Adamic-Adar and common-neighbor counts in SQL over the edges table as the v1 graph features. They are explainable ("you both know Maya and Theo") and cheap. NetworkX reference: https://networkx.org/documentation/networkx-2.4/reference/algorithms/generated/networkx.algorithms.link_prediction.adamic_adar_index.html

**4.10 Grover, Leskovec (2016). "node2vec: Scalable Feature Learning for Networks." KDD.**
https://dl.acm.org/doi/10.1145/2939672.2939754 ; code: https://github.com/aditya-grover/node2vec (2.7k stars, MIT, 2022)
Biased random walks with p and q parameters interpolate between homophily (community) and structural-role similarity.
**Use for The Network:** `LEARN`. Post-MVP only. The "structural equivalence" mode could find members who play similar *roles* (connectors, hosts) across clusters. That is useful for the network-growth generator once the graph has thousands of edges.

**4.11 Hamilton, Ying, Leskovec (2017). "Inductive Representation Learning on Large Graphs" (GraphSAGE). NeurIPS.**
https://cs.stanford.edu/people/jure/pubs/graphsage-nips17.pdf ; code: https://github.com/williamleif/GraphSAGE (3.7k stars)
Learns an aggregation function over sampled neighbors plus node features, so embeddings generalize to unseen nodes, which matters for newcomers.
**Use for The Network:** `LEARN`. If we ever learn graph embeddings, it should be an *inductive* method like this, because of constant newcomers. Use PyTorch Geometric (https://github.com/pyg-team/pytorch_geometric, 24k stars, MIT).

**4.12 Ying et al. (2018). "Graph Convolutional Neural Networks for Web-Scale Recommender Systems" (PinSage). KDD.**
https://cs.stanford.edu/people/jure/pubs/pinsage-kdd18.pdf
Random-walk-based neighborhood sampling plus graph convolutions over 3B nodes, with hard-negative curriculum training.
**Use for The Network:** `LEARN`. Context. Its random-walk "importance pooling" idea is reusable at small scale for warm-path ranking.

**4.13 Traag, Waltman, van Eck (2019). "From Louvain to Leiden: guaranteeing well-connected communities." Scientific Reports.**
https://www.nature.com/articles/s41598-019-41695-z ; code: https://github.com/vtraag/leidenalg (801 stars, **GPL-3.0**)
Louvain can yield badly connected or even disconnected communities. Leiden guarantees connected communities and is faster.
**Use for The Network:** `POLICY`, `GROUP`, `EVAL`. Run community detection nightly to label clusters for "repetition," "cluster diversity," and concentration metrics. Licensing: leidenalg and python-igraph are GPL. Run them in a separate offline analytics worker, or use NetworkX's `louvain_communities` (BSD) to keep the core service license-clean.

### 4c. Storage: Postgres vs. graph databases

**4.14 PostgreSQL recursive CTEs vs. Neo4j (practitioner comparisons).**
https://evokoa.com/blog/postgres-as-a-graph-database/ ; https://www.puppygraph.com/learn/postgres-vs-neo4j
Bounded, shallow traversals (1-3 hops, indexed) in Postgres are competitive or faster than Neo4j. Deep, unbounded traversals and point-to-point shortest paths favor native graph stores.
**Use for The Network:** `STORE`. Our queries are 2-hop warm paths over at most about 10^4 edges. Recursive CTEs with `(src, type)` and `(dst, type)` indexes are more than sufficient. Keep a single store and a single ID space (ME-006).

**4.15 Apache AGE.**
https://github.com/apache/age (4.9k stars, Apache-2.0, active) ; docs: https://age.apache.org/age-manual/master/intro/overview.html
A Postgres extension that adds openCypher property-graph queries alongside SQL, with ACID guarantees, in the same database.
**Use for The Network:** `STORE`. Not needed in v1. Revisit if warm-path queries need variable-length pattern matching that becomes unreadable in SQL. Check managed-Postgres support (Azure supports it, and others vary) before adopting.

**4.16 pgvector.**
https://github.com/pgvector/pgvector (23k stars, PostgreSQL license, active)
Vector similarity in Postgres (HNSW and IVFFlat). Since 0.8.0, **iterative index scans** fix the "filtered ANN returns too few rows" problem (`hnsw.iterative_scan = strict_order|relaxed_order`). Background: https://www.thenile.dev/blog/pgvector-080
**Use for The Network:** `RETRIEVAL`, `STORE`. Important: at 150-1,000 members, with tens of thousands of facet vectors, **exact (sequential) kNN is fast and has perfect recall**. Our hard filters (city, state, blocks, budgets) are highly selective, which is exactly where HNSW plus post-filtering loses recall. Use exact search with SQL filters first. Add HNSW with iterative scans only when latency requires it, and test recall against the exact baseline.

**4.17 Graph and analytics libraries.** NetworkX (https://github.com/networkx/networkx, 17k stars, BSD); python-igraph (GPL-2.0); Neo4j GDS (https://github.com/neo4j/graph-data-science); pgRouting (GPL-2.0, for travel graphs).
**Use for The Network:** `EVAL`, `POLICY`. NetworkX in the nightly analytics job covers Adamic-Adar, Burt constraint, Louvain, betweenness, and k-core at our scale.

**4.18 getzep/graphiti (temporal knowledge graph for agent memory).**
https://github.com/getzep/graphiti (31k stars, Apache-2.0, very active)
Builds time-aware knowledge graphs from agent conversations, with bi-temporal edges (valid_from/valid_to) and provenance.
**Use for The Network:** `STORE`. Its edge-invalidation and bi-temporal model matches our facet `valid_from/valid_to` and "said beats inferred" merge rules. Study it for the extraction-to-facet pipeline. Adopting it wholesale would add a graph store we don't need.

---

## 5. Fairness, exposure, popularity bias, cold start, exploration

**5.1 Singh, Joachims (2018). "Fairness of Exposure in Rankings." KDD.**
https://arxiv.org/abs/1802.07281
Formalizes fairness as allocating exposure (position-weighted attention) in proportion to merit or relevance, solved as an LP over doubly stochastic ranking matrices.
**Use for The Network:** `POLICY`, `EVAL`. Define "exposure" for us as *being included in a sent proposal*. Track exposure relative to estimated relevance per member, not raw counts.

**5.2 Biega, Gummadi, Weikum (2018). "Equity of Attention: Amortizing Individual Fairness in Rankings." SIGIR.**
https://arxiv.org/abs/1805.01788
Individual fairness is achieved *amortized over time*: cumulative attention should track cumulative relevance, and each round corrects past deficits with an ILP.
**Use for The Network:** `POLICY`. This is the right formalism for our exposure floor. Each nightly run adds a per-member "exposure debt" term (cumulative relevance minus cumulative proposals) to the selector objective. Members who keep scoring well but never get chosen rise automatically.

**5.3 Patro, Biswas, Ganguly, Gummadi, Chakraborty (2020). "FairRec: Two-Sided Fairness for Personalized Recommendations in Two-Sided Platforms." WWW.**
https://arxiv.org/abs/2002.10764 ; code: https://github.com/gourabkumarpatro/FairRec_www_2020 (32 stars, no license)
Maps fair recommendation to fair allocation of indivisible goods. It guarantees most producers a maximin share of exposure and every customer envy-freeness up to one item.
**Use for The Network:** `POLICY`. In a reciprocal network, every member is both "producer" and "customer." The MMS-of-exposure idea gives a principled floor size. Reimplement rather than reuse (no license).

**5.4 Do, Corbett-Davies, Atif, Usunier (2021). "Two-sided fairness in rankings via Lorenz dominance." NeurIPS.**
https://arxiv.org/abs/2110.15781
Uses Lorenz efficiency to trade off fairness to both sides without a single arbitrary metric.
**Use for The Network:** `EVAL`. Report Lorenz curves of proposals, acceptances, and completions per member in the weekly concentration report (15.4, 33.8), alongside the top-10% share and the Gini.

**5.5 Abdollahpouri et al. on popularity bias and calibrated popularity; survey: Klimashevskaia et al. (2024), "A survey on popularity bias in recommender systems." UMUAI.**
https://link.springer.com/article/10.1007/s11257-024-09406-0 ; https://arxiv.org/abs/2008.09273
Recommenders over-recommend popular items, which harms niche users and items. "Calibrated popularity" matches each user's recommendations to their own historical popularity mix.
**Use for The Network:** `POLICY`, `EVAL`. Popular, well-profiled members will dominate kNN retrieval because they have more and richer facets. Normalize per-member facet counts in retrieval and monitor "rich-profile bias."

**5.6 Volkovs, Yu, Poutanen (2017). "DropoutNet: Addressing Cold Start in Recommender Systems." NeurIPS.**
https://proceedings.neurips.cc/paper/2017/hash/dbd22ba3bd0df8f385bdac3e9f8be207-Abstract.html
Trains models with input dropout on preference features so they fall back gracefully to content features for cold users.
**Use for The Network:** `LEARN`. When we train a learned scorer, apply the same idea: randomly drop behavioral and graph features in training so newcomers (onboarding facets only) still get calibrated scores.

**5.7 Li, Chu, Langford, Schapire (2010). "A Contextual-Bandit Approach to Personalized News Article Recommendation" (LinUCB). WWW.**
https://www.semanticscholar.org/paper/A-contextual-bandit-approach-to-personalized-news-Li-Chu/ec0072bc37f83f1a81459df43289613e04cc61e1
Linear UCB contextual bandit, plus the replay method for unbiased offline evaluation from randomized logs. It gave a 12.5% CTR lift, largest in data-scarce regimes.
**Use for The Network:** `EXPLORE`, `EVAL`. Pattern for exploration. The replay estimator requires logged *randomized* choices, so design exploration to be randomized and logged from day one.

**5.8 Chapelle, Li (2011). "An Empirical Evaluation of Thompson Sampling." NeurIPS.**
https://papers.nips.cc/paper/4321-an-empirical-evaluation-of-thompson-sampling
Thompson sampling is simple and highly competitive, and robust to delayed feedback.
**Use for The Network:** `EXPLORE`. Our feedback is delayed by days to weeks (opt-in, meeting, rating). Use Beta-Bernoulli Thompson sampling over *arms = generator × category × format* (e.g., "complementary-intents / music / group") for the 10-15% exploration budget. It is easy to explain and to log propensities for.

**5.9 Dudík, Langford, Li, "Doubly Robust Policy Evaluation and Learning" (via Vowpal Wabbit docs).** VW: https://github.com/VowpalWabbit/vowpal_wabbit (8.7k stars) ; CB wiki: https://github.com/VowpalWabbit/vowpal_wabbit/wiki/Contextual-Bandit-algorithms ; bake-off: https://arxiv.org/abs/1802.04064
IPS, direct method, and doubly-robust estimators for evaluating a new policy from logs of an old one.
**Use for The Network:** `EVAL`, `LEARN`. Off-policy evaluation of scorer variants from production logs is the realistic substitute for A/B tests at 300 members.

**5.10 Open Bandit Pipeline (Saito et al.).**
https://github.com/st-tech/zr-obp (712 stars, Apache-2.0, last push 2024-06) ; docs: https://zr-obp.readthedocs.io/en/latest/
A Python library for bandit policies and OPE estimators (IPS, DR, switch-DR, etc.) with a real logged dataset.
**Use for The Network:** `EVAL`. Use it offline over our proposal logs once we have propensities. It is the easiest path to "would scorer v2 have done better?" without a live test.

**5.11 Saito, Joachims. RecSys 2021 tutorial "Counterfactual Learning and Evaluation for Recommender Systems."**
https://dl.acm.org/doi/fullHtml/10.1145/3460231.3473320 ; materials: https://github.com/usaito/recsys2021-tutorial
Practical primer on OPE and OPL for recommenders.
**Use for The Network:** `EVAL`, `LEARN`. Onboarding reading for whoever owns 33.11.

**5.12 Chen et al. (2021). "Values of User Exploration in Recommender Systems." RecSys (Google).**
https://dl.acm.org/doi/10.1145/3460231.3474236
Exploration improves diversity, novelty, and serendipity, and can improve long-term user experience even at a small short-term cost.
**Use for The Network:** `EXPLORE`, `EVAL`. Measure exploration arms on *long-horizon* outcomes (second encounter within 60 days, satisfaction), not only immediate opt-in rate. Otherwise exploration always looks bad.

**5.13 Kotkov, Wang, Veijalainen (2016). "A survey of serendipity in recommender systems." Knowledge-Based Systems 111.**
https://doi.org/10.1016/j.knosys.2016.08.014
Defines serendipity as relevance + novelty + unexpectedness, and catalogues how to measure it.
**Use for The Network:** `EXPLORE`, `JUDGE`. Give the judge a separate "unexpected but fitting" dimension for expansion-generator proposals, and ask in feedback "was this something you wouldn't have found yourself?"

**5.14 Diversity via determinantal point processes. Chen, Zhang, Zhou (2018), "Fast Greedy MAP Inference for DPP," NeurIPS (https://arxiv.org/abs/1709.05135); Wilhelm et al. (2018), "Practical Diversified Recommendations on YouTube with DPPs," CIKM (https://www.semanticscholar.org/paper/Practical-Diversified-Recommendations-on-YouTube-Wilhelm-Ramanathan/c09b090a664674ba528957a28330ba07d1004dcc).**
DPP re-ranking picks a set that is jointly relevant and mutually dissimilar, with fast greedy inference, and showed long-term engagement gains in production.
**Use for The Network:** `GROUP`, `POLICY`. Two uses: (a) diversify a member's week of proposals so they aren't three near-identical tech intros; (b) as the "cluster diversity" term in group composition, with a log-det of the member-embedding kernel.

**5.15 Fairlearn.** https://github.com/fairlearn/fairlearn (2.3k stars, MIT)
Metrics and dashboards for group fairness (disaggregated metrics by cohort).
**Use for The Network:** `EVAL`. Use `MetricFrame` to disaggregate acceptance and completion rates by cohort (newcomers, city, inviter cluster) in the weekly report.

---

## 6. LLM-based matching, LLM judges, LLM user simulators, simulation-based recsys evaluation

### 6a. LLMs as matchers and judges

**6.1 Zheng et al. (2023). "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena." NeurIPS D&B.**
https://arxiv.org/abs/2306.05685
Strong LLM judges reach roughly human-level agreement but show position bias, verbosity bias, and self-enhancement bias. Mitigations include swapping order and using reference answers.
**Use for The Network:** `JUDGE`, `EVAL`. Use a judge from a different model family than the agent (already in 34.5). For pairwise or group comparisons, always evaluate both orderings and treat disagreement as low confidence.

**6.2 Wang et al. (2024). "Large Language Models are not Fair Evaluators." ACL.**
https://arxiv.org/abs/2305.17926
Swapping candidate order can flip GPT-4 verdicts. Proposes multiple-evidence calibration, balanced position calibration, and human-in-the-loop calibration.
**Use for The Network:** `JUDGE`. For group-configuration review (33.7: "LLM judge reviews top 2-3 group configurations"), present configurations in all orders, aggregate, and ask for evidence before scores.

**6.3 Liu et al. (2023). "G-Eval: NLG Evaluation using GPT-4 with Better Human Alignment." EMNLP.**
https://arxiv.org/abs/2303.16634
Rubric, then model-generated evaluation steps, then form-filling. The final score is the *probability-weighted* expectation over score tokens, which reduces ties and improves correlation with humans.
**Use for The Network:** `JUDGE`. Where the provider exposes logprobs, compute expected scores per dimension instead of argmax integers. This gives finer-grained, better-calibrated components for the weighted sum.

**6.4 Shankar et al. (2024). "Who Validates the Validators? Aligning LLM-Assisted Evaluation of LLM Outputs with Human Preferences" (EvalGen). UIST.**
https://arxiv.org/abs/2404.12272
Introduces "criteria drift": people refine their rubric as they grade. Judges must be iteratively aligned to a small human-graded set.
**Use for The Network:** `JUDGE`, `EVAL`. The review queue *is* the human-graded set. Version the judge rubric, re-measure judge-reviewer agreement weekly, and expect the rubric to change during shadow mode.

**6.5 Confidence calibration of LLMs. Geng et al. (2024), "A Survey of Confidence Estimation and Calibration in LLMs," NAACL (https://aclanthology.org/2024.naacl-long.366.pdf); "Calibrating LLM Judges: Linear Probes..." (https://arxiv.org/abs/2512.22245).**
Verbalized confidence is elicitable but prompt-sensitive and often miscalibrated. Calibration should be measured with proper scoring rules (Brier, ECE) and corrected post hoc.
**Use for The Network:** `JUDGE`, `LEARN`. Never use raw judge scores as probabilities. Fit isotonic or Platt calibration from judge scores to reviewer-approve and member-accept outcomes, and report reliability diagrams per generator.

**6.6 Hou et al. (2024). "Large Language Models are Zero-Shot Rankers for Recommender Systems." ECIR.**
https://arxiv.org/abs/2305.08845
LLMs can rank candidates zero-shot but show strong position and popularity bias. Bootstrapping over shuffled candidate orders helps.
**Use for The Network:** `JUDGE`. If the judge ever ranks a list of candidates (e.g., "pick the best 3 of 10 for this dinner"), shuffle and aggregate over several orderings.

**6.7 "Large language models can detect verbal indicators of romantic attraction" (Sci. Reports 2026; preprint arXiv 2407.10989).**
https://arxiv.org/abs/2407.10989
On 964 speed dates, LLMs predicted dating success from conversation transcripts at modest levels (r ≈ 0.12-0.23), comparable to human observers and incremental to daters' own predictions.
**Use for The Network:** `JUDGE`, `LEARN`. LLM signal is real but weak, and it comes from *interaction* text, not profiles. Better uses: judging post-meeting feedback text ("did this go well?"), and judging relay-thread engagement as an early outcome signal.

**6.8 "On the Influence of Gender and Race in Romantic Relationship Prediction from Large Language Models" (2024).**
https://arxiv.org/abs/2410.03996
LLM relationship predictions vary with names signaling gender and race, revealing heteronormative and racial biases.
**Use for The Network:** `JUDGE`, `PRIVACY`, `EVAL`. Scrub names and demographic proxies before judging (already in 33.6). Add a counterfactual-swap audit to the judge golden set: same profile, different name or pronouns, so verdicts should not change.

**6.9 "Love First, Know Later: Persona-Based Romantic Compatibility Through LLM Text World Engines" (2025).**
https://arxiv.org/abs/2512.11844
Rather than comparing profiles, it simulates interactions between persona agents and scores the emergent dynamics, treating compatibility as reward modeling.
**Use for The Network:** `JUDGE`, `SIM`. An expensive research direction: "simulate a 5-minute conversation between two persona cards, then judge." Given Joel et al., expect limited gains. If tried, test only as an A/B arm in the simulator.

### 6b. LLM agents as simulated people and populations

**6.10 Park et al. (2023). "Generative Agents: Interactive Simulacra of Human Behavior." UIST.**
https://arxiv.org/abs/2304.03442 ; code: https://github.com/joonspk-research/generative_agents (22k stars, Apache-2.0)
Twenty-five LLM agents with a memory stream, reflection, and planning live in a sandbox town. They produce believable emergent social behavior, such as spreading a party invitation and coordinating attendance.
**Use for The Network:** `SIM`. The memory, reflection, and planning architecture fits persona agents that must remember Network messages and their own routines. Note that the original was tiny (25 agents) and expensive. We need the cheaper hybrid in 6.13.

**6.11 Park et al. (2024). "Generative Agent Simulations of 1,000 People."**
https://arxiv.org/abs/2411.10109
Agents built from 2-hour interviews with 1,052 real people replicated their General Social Survey answers 85% as well as people replicate themselves two weeks later. Interview-based agents were less biased than demographic-prompted agents.
**Use for The Network:** `SIM`. Seed personas from *rich, interview-like* backstories, which is what our voice onboarding produces, not from demographic one-liners. With consent, anonymized onboarding transcripts from early members could seed higher-fidelity personas.

**6.12 Argyle et al. (2023). "Out of One, Many: Using Language Models to Simulate Human Samples." Political Analysis.**
https://arxiv.org/abs/2209.06899
Conditioned on real backstories, LLMs reproduce subgroup response *distributions* ("algorithmic fidelity").
**Use for The Network:** `SIM`. Validate the persona population at the distribution level against real cohorts: reply rates, acceptance rates, flake rates, message lengths. Don't validate on anecdotes.

**6.13 OASIS (CAMEL-AI, 2024). "Open Agent Social Interaction Simulations with One Million Agents."**
https://arxiv.org/abs/2411.11581 ; code: https://github.com/camel-ai/oasis (5.2k stars, Apache-2.0, very active)
A social-media simulator mixing LLM agents and rule-based agents, with a dynamic follow graph and an in-loop recommender. It scales to 1M agents.
**Use for The Network:** `SIM`. Its architecture (recommender-in-the-loop, mixed LLM and rule agents, dynamic graph) is the closest open-source template to our World Simulator. Borrow the hybrid idea. Most persona decisions (reply or not, accept or not) come from cheap calibrated stochastic policies over hidden utilities. The LLM only writes the text and handles ambiguous turns.

**6.14 AgentSociety (Tsinghua FIB lab, 2025).**
https://arxiv.org/abs/2502.08691 ; code: https://github.com/tsinghua-fib-lab/AgentSociety (1.3k stars, Apache-2.0, active)
10k+ LLM agents with needs, emotions, mobility, and social ties in a realistic urban environment. It uses an async, Ray-parallel engine and supports social experiments (UBI, polarization, shocks).
**Use for The Network:** `SIM`. Reference for the discrete-event virtual clock, mobility and routines (our Presence model), and running "shocks" (rainy weekend, popular member goes quiet). Its agent "needs" model is a good template for hidden desires.

**6.15 SOTOPIA (Zhou et al., ICLR 2024).**
https://arxiv.org/abs/2310.11667 ; code: https://github.com/sotopia-lab/sotopia (335 stars, MIT, active)
Role-play social scenarios with private goals, evaluated on 7 dimensions including goal completion, relationship, believability, **secret-keeping**, and social rules.
**Use for The Network:** `EVAL`, `PRIVACY`. Borrow SOTOPIA-EVAL dimensions for multi-member scenario tests (34.1). The "secret" dimension maps directly to our canary-fact privacy test. Scenarios where a persona holds a private fact and another tries to extract it via the agent are SOTOPIA-hard-style.

**6.16 τ-bench (Sierra, 2024) and τ²-bench.**
https://arxiv.org/abs/2406.12045 ; code: https://github.com/sierra-research/tau-bench (1.5k stars, MIT) and https://github.com/sierra-research/tau2-bench (2.2k stars, MIT, active)
LLM-simulated users talk to a tool-using agent bound by domain policy, and success is graded by comparing final database state to a goal state. It introduces **pass^k** (all k trials must succeed) to measure reliability.
**Use for The Network:** `EVAL`. Grade agent scenario tests by *database end-state* (opportunity status, consent records, no leaked fields), not by transcript vibes. Report pass^k (e.g., k=4) for critical flows: STOP, block, decline without leakage, reschedule.

**6.17 LLM user simulators for recommenders: RecAgent / YuLan-Rec and Agent4Rec.**
Agent4Rec, "On Generative Agents in Recommendation" (SIGIR 2024): https://arxiv.org/abs/2310.10108 ; code: https://github.com/LehengTHU/Agent4Rec (503 stars, MIT) ; RecAgent: https://github.com/RUC-GSAI/YuLan-Rec (418 stars, MIT)
1,000 LLM agents with profile, memory, and action modules, initialized from MovieLens. They browse recommendations page by page, rate, exit, and can be "interviewed" about why.
**Use for The Network:** `SIM`. Two patterns to copy: an "interview the persona after the run" step for qualitative failure analysis, and per-persona memory of what the system recommended.

**6.18 Known failure modes of LLM user simulators.**
Zhu, Huang, Sang (2024), "How Reliable is Your Simulator? An Analysis on the Limitations of Current LLM-based User Simulators for Conversational Recommendation," WWW Companion (arXiv 2403.16416; https://www.mendeley.com/catalogue/26bac5f6-5b9c-3156-8418-3e37bc6f11e9/). "LLM-Powered User Simulator for Recommender System" (AAAI 2025): https://arxiv.org/abs/2412.16984. RecUserSim: https://arxiv.org/abs/2507.22897
LLM simulators leak ground truth, are over-agreeable (unrealistically high acceptance), skew toward popular items, lack behavioral diversity, and don't explicitly model preferences. Fixes include explicit preference models, controllable profiles, and fidelity metrics against real logs.
**Use for The Network:** `SIM`. This is the most important design constraint for 34.3. (1) Persona accept/decline is decided by a **hidden-utility choice model** (logistic in true compatibility, capacity, timing, and fatigue), with base rates calibrated to targets (e.g., 40% opt-in). The LLM only verbalizes. (2) Never put the persona's hidden ground truth into the same prompt the Network sees. Enforce this by process separation. (3) Track simulator fidelity: compare reply-latency, acceptance, and flake distributions with pilot data once available, and re-tune.

**6.19 Survey and reading list: "LLM Simulating Humanity" (ICLR 2025) and curated lists.**
https://github.com/Persdre/awesome-llm-human-simulation (166 stars, active) ; https://github.com/Wanying-He/awesome-llm-social-simulation
**Use for The Network:** `SIM`. A rolling reading list for whoever owns the simulator.

### 6c. Classical recommender simulators

**6.20 RecSim (Ie et al., 2019) and RecSim NG (2021), Google.**
https://arxiv.org/abs/1909.04847 ; code: https://github.com/google-research/recsim (784 stars, Apache-2.0, **archived**) ; NG: https://github.com/google-research/recsim_ng (archived) ; blog: https://research.google/blog/flexible-scalable-differentiable-simulation-of-recommender-systems-with-recsim-ng/
Configurable simulation with explicit **user latent state, latent-state dynamics (e.g., fatigue, interest drift), choice models, and document models**. Designed for testing sequential recommendation policies before live experiments.
**Use for The Network:** `SIM`. Archived, so don't depend on it. Copy its *factorization*: `UserState` (hidden), `UserTransition` (fatigue from asks, interest drift), `ChoiceModel` (accept/decline), and `ResponseModel` (outcome). Our persona "decision policy" should be exactly this, with the LLM layered on top for language.

**6.21 KuaiSim (Zhao et al., NeurIPS 2023 D&B).**
https://openreview.net/forum?id=dJEjgQcbOt ; code: https://github.com/ksRecoTech/Kuai-RL (46 stars, MIT)
A data-driven user simulator (transformer trained on real logs) with request-, session-, and cross-session-level tasks, including retention.
**Use for The Network:** `SIM`, `EVAL`. Later, once we have pilot logs, train a small learned response model on real accept/decline/complete data and use it as a *second* simulator to cross-check the LLM-persona simulator. Disagreement between them flags sim artifacts.

---

## 7. Learning-to-rank from sparse feedback, two-tower retrieval, JEPA-style embeddings

**7.1 Burges (2010). "From RankNet to LambdaRank to LambdaMART: An Overview." MSR-TR-2010-82.**
Overview of the lineage and practical LambdaMART usage: https://xgboost.readthedocs.io/en/latest/tutorials/learning_to_rank.html ; related ensemble paper: http://proceedings.mlr.press/v14/burges11a/burges11a.pdf
Pairwise and listwise gradient-boosted ranking (LambdaMART) remains a strong default for tabular ranking features.
**Use for The Network:** `LEARN`. The first learned model should be LambdaMART (LightGBM `lambdarank`, https://github.com/lightgbm-org/LightGBM, 18.8k stars, MIT) over our *logged score components* plus graph features. Train it on reviewer actions (approve > edit > reject) and outcomes (completed > accepted > declined), grouped per run and per member. It stays interpretable via feature importance and works with about 10^3 labels.

**7.2 Rendle et al. (2009). "BPR: Bayesian Personalized Ranking from Implicit Feedback." UAI.**
https://arxiv.org/abs/1205.2618
A pairwise objective: observed positives should outrank unobserved items. It is the standard loss for implicit feedback.
**Use for The Network:** `LEARN`. Use BPR-style pairwise loss when training embeddings from accept/decline. Caveat: in our setting "unobserved" means "never proposed," which is heavily confounded by the engine. Combine it with propensity weighting (7.4).

**7.3 Yi et al. (2019). "Sampling-Bias-Corrected Neural Modeling for Large Corpus Item Recommendations" (two-tower, YouTube). RecSys.**
https://research.google/pubs/sampling-bias-corrected-neural-modeling-for-large-corpus-item-recommendations/
Two-tower retrieval with in-batch negatives, corrected for item-frequency sampling bias using streaming frequency estimates.
**Use for The Network:** `LEARN`, `RETRIEVAL`. A post-MVP replacement for generic text-embedding kNN: a member tower and an intent/opportunity tower trained on outcomes. The frequency correction matters doubly for us. Popular members appear in many batches and would otherwise be under-scored as negatives or over-retrieved. Needs thousands of positives, so this is a year-2 item.

**7.4 Joachims, Swaminathan, Schnabel (2017). "Unbiased Learning-to-Rank with Biased Feedback." WSDM.**
https://arxiv.org/abs/1608.04468
Inverse-propensity weighting lets you learn rankers from biased implicit feedback as if from randomized data.
**Use for The Network:** `LEARN`, `EVAL`. Our labels have *two* selection stages: the engine's ranking, then the human reviewer's approval. Members only ever respond to proposals that survived both. Log P(proposed) for exploration picks and keep a small randomized slice so IPS correction is possible.

**7.5 Saito et al. (2020). "Unbiased Recommender Learning from Missing-Not-At-Random Implicit Feedback." WSDM.**
https://www.researchgate.net/publication/338759706_Unbiased_Recommender_Learning_from_Missing-Not-At-Random_Implicit_Feedback
Treats implicit feedback as positive-unlabeled under MNAR exposure and debiases with propensity and doubly-robust estimators.
**Use for The Network:** `LEARN`. Same concern as 7.4, applied to pair-level labels.

**7.6 LeCun (2022). "A Path Towards Autonomous Machine Intelligence" (introduces JEPA).**
https://openreview.net/pdf?id=BZ5a1r-kVsf ; I-JEPA code: https://github.com/facebookresearch/ijepa (3.5k stars, archived)
Joint-embedding predictive architectures predict the *representation* of a target from a context in latent space, rather than reconstructing inputs. Non-generative self-supervised learning.
**Use for The Network:** `LEARN`. The PRD's "JEPA-like model trained to predict good outcomes from member representations" (33.11) maps to: encoder(member A context, opportunity context) → predictor → embedding of B's realized-outcome representation. Requires far more interaction data than we will have in year 1.

**7.7 JEPA4Rec (COLM 2025). "Learning Effective Language Representations for Sequential Recommendation via Joint Embedding Predictive Architecture."**
https://arxiv.org/abs/2504.10512
Applies JEPA-style masked latent prediction to text-described items for sequential recommendation, with gains especially in low-resource and cross-domain settings.
**Use for The Network:** `LEARN`. The most relevant existing evidence that JEPA-style training helps *text-heavy, low-data* recommendation, which describes our facets and intents. A reasonable research prototype once we have more than 5k labeled outcomes. Pretrain on facet text with masking, then fine-tune a pair-outcome predictor.

**7.8 General recsys toolkits.** Microsoft Recommenders (https://github.com/recommenders-team/recommenders, 21.9k stars, MIT, active); RecBole (https://github.com/RUCAIBox/RecBole, 4.6k stars, MIT); LightFM hybrid (https://github.com/lyst/lightfm, 5.1k stars, Apache-2.0; supports cold start via side features); TF-Ranking (archived).
**Use for The Network:** `LEARN`, `EVAL`. Use Recommenders' evaluation utilities (precision@k, NDCG, coverage, diversity, novelty) for offline metrics. LightFM is a good small-data hybrid baseline because it handles content features for cold start.

---

## 8. Existing projects and commercial analogues

### 8a. Open source worth studying

| Repo | Stars | License | Last push | What's reusable for The Network |
|---|---|---|---|---|
| [pgvector/pgvector](https://github.com/pgvector/pgvector) | 23.2k | PostgreSQL | 2026-10 | Production vector store. Use exact kNN at our scale and iterative HNSW later (`STORE`). |
| [apache/age](https://github.com/apache/age) | 4.9k | Apache-2.0 | 2026-09 | openCypher in Postgres. Defer (`STORE`). |
| [google/or-tools](https://github.com/google/or-tools) | 14.1k | Apache-2.0 | 2026-10 | CP-SAT for the run-level b-matching selector and gathering seating ILP (`POLICY`, `GROUP`). |
| [daffidwilde/matching](https://github.com/daffidwilde/matching) | 168 | MIT | 2025-10 | Stable marriage/HR/roommates for blocking-pair diagnostics (`EVAL`). |
| [fredbenenson/lunch-roulette](https://github.com/fredbenenson/lunch-roulette) | 167 | custom | 2018 | Diverse group formation with memory of past groups. Baseline (`GROUP`). |
| [networkx/networkx](https://github.com/networkx/networkx) | 17.3k | BSD | 2026-10 | Adamic-Adar, Burt constraint, Louvain, k-core (`WARM-PATH`, `EVAL`). |
| [vtraag/leidenalg](https://github.com/vtraag/leidenalg) | 801 | GPL-3.0 | 2026-09 | Leiden communities. Keep in an isolated analytics worker (`EVAL`). |
| [pyg-team/pytorch_geometric](https://github.com/pyg-team/pytorch_geometric) | 24.1k | MIT | 2026-09 | GraphSAGE/link prediction, post-MVP (`LEARN`). |
| [pnnl/HyperNetX](https://github.com/pnnl/HyperNetX) / [xgi-org/xgi](https://github.com/xgi-org/xgi) | 717 / 256 | BSD-style | 2026 | Groups-as-hyperedges analytics (`EVAL`). |
| [getzep/graphiti](https://github.com/getzep/graphiti) | 31.5k | Apache-2.0 | 2026-10 | Bi-temporal facts and edge invalidation for agent memory. Pattern for facets (`STORE`). |
| [lightgbm-org/LightGBM](https://github.com/lightgbm-org/LightGBM) | 18.8k | MIT | 2026-10 | LambdaMART for learning-to-rank on logged components (`LEARN`). |
| [lyst/lightfm](https://github.com/lyst/lightfm) | 5.1k | Apache-2.0 | 2024-07 | Hybrid CF with side features for cold start (`LEARN`). |
| [recommenders-team/recommenders](https://github.com/recommenders-team/recommenders) | 21.9k | MIT | 2026-10 | Offline metric implementations (`EVAL`). |
| [st-tech/zr-obp](https://github.com/st-tech/zr-obp) | 712 | Apache-2.0 | 2024-06 | Off-policy evaluation estimators (`EVAL`). |
| [VowpalWabbit/vowpal_wabbit](https://github.com/VowpalWabbit/vowpal_wabbit) | 8.7k | BSD-3 | 2026-09 | Contextual bandits + OPE. Heavier than we need in v1 (`EXPLORE`). |
| [CyberAgentAILab/FairReciprocalRecommendation](https://github.com/CyberAgentAILab/FairReciprocalRecommendation) | 6 | MIT | 2025-09 | Synthetic reciprocal markets + fair-allocation algorithms (`POLICY`, `SIM`). |
| [fairlearn/fairlearn](https://github.com/fairlearn/fairlearn) | 2.3k | MIT | 2026-10 | Cohort-disaggregated fairness metrics (`EVAL`). |
| [camel-ai/oasis](https://github.com/camel-ai/oasis) | 5.2k | Apache-2.0 | 2026-10 | Hybrid LLM/rule agents with a recommender in the loop. Simulator template (`SIM`). |
| [tsinghua-fib-lab/AgentSociety](https://github.com/tsinghua-fib-lab/AgentSociety) | 1.3k | Apache-2.0 | 2026-10 | Urban routines, needs, shocks, async engine (`SIM`). |
| [joonspk-research/generative_agents](https://github.com/joonspk-research/generative_agents) | 22.2k | Apache-2.0 | 2024-08 | Memory/reflection/planning persona architecture (`SIM`). |
| [sotopia-lab/sotopia](https://github.com/sotopia-lab/sotopia) | 335 | MIT | 2026-06 | Multi-agent social scenarios + 7-dim eval incl. secret keeping (`EVAL`, `PRIVACY`). |
| [sierra-research/tau2-bench](https://github.com/sierra-research/tau2-bench) | 2.2k | MIT | 2026-09 | Simulated-user + DB-state grading + pass^k (`EVAL`). |
| [LehengTHU/Agent4Rec](https://github.com/LehengTHU/Agent4Rec) / [RUC-GSAI/YuLan-Rec](https://github.com/RUC-GSAI/YuLan-Rec) | 503 / 418 | MIT | 2024-25 | LLM user simulators for recsys, with post-hoc interviews (`SIM`). |
| [google-research/recsim](https://github.com/google-research/recsim) | 784 | Apache-2.0 | archived | Latent-state / choice-model factorization to copy (`SIM`). |
| [ksRecoTech/Kuai-RL](https://github.com/ksRecoTech/Kuai-RL) (KuaiSim) | 46 | MIT | 2025-09 | Learned user-response simulator pattern (`SIM`). |
| [skywalker023/confaide](https://github.com/skywalker023/confaide) / [SALT-NLP/PrivacyLens](https://github.com/salt-nlp/privacylens) | 57 / n/a | MIT | 2023 / 2024 | Contextual-integrity privacy test sets for LLM outputs and agent actions (`PRIVACY`, `EVAL`). |
| [eth-sri/llmprivacy](https://github.com/eth-sri/llmprivacy) | 81 | MIT | 2025-02 | Attribute-inference attack harness (`PRIVACY`). |
| [googleforgames/open-match](https://github.com/googleforgames/open-match) | 3.4k | Apache-2.0 | 2026-07 | Game matchmaking architecture: ticket pool, pluggable match functions, evaluator that resolves overlapping proposals. Architecturally close to our generators → selector design (`POLICY`). |
| [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo) / [confident-ai/deepeval](https://github.com/confident-ai/deepeval) | 25.7k / 18.6k | MIT / Apache-2.0 | 2026-10 | LLM eval/regression harnesses for judge golden sets and red-teaming in CI (`EVAL`). |

Observation: there is **no** maintained open-source "people matching engine" for friendship or professional intros worth adopting. The GitHub hits for coffee-roulette and random-coffee bots (e.g., https://github.com/tjansson60/pyslackrandomcoffee, https://github.com/dehorsley/colette) are random pairers with "don't repeat" memory, and mentor-matching apps are form-based. The reusable assets are solvers, graph and OPE libraries, simulators, and eval harnesses. The engine itself must be built. Open Match is the most instructive *architecture*: independent match functions emit overlapping candidate matches, and a separate evaluator deduplicates and chooses. This is exactly our generators → selector split.

### 8b. Commercial analogues

| Product | What it does | What's publicly known about matching | Lesson for The Network |
|---|---|---|---|
| **Boardy** ([site](https://www.boardy.ai/); [profile](https://www.altis.vc/research/companies/boardy)) | Voice-AI "superconnector." Calls you, learns goals, brokers double-opt-in professional intros by email. | Third-party write-ups: ~10-min voice interview, then structured extraction of goals, expertise, and wants; semantic need/offer matching; double opt-in, then the intro and calendar scheduling. Reported scale (third-party): 100k+ intros. | Closest analogue to our professional-intro generator and voice onboarding. They chose professional/investor intros, a domain where need/offer semantics carry most of the signal. Our differentiation is groups, events, local presence, and non-professional desires. |
| **Timeleft** ([how it works](https://timeleft.com/blog/dinner-with-strangers/); [Seattle Times](https://www.seattletimes.com/life/culture/friend-making-platform-matches-seattleites-with-strangers-for-dinner/)) | Weekly dinners with ~6 strangers. | Personality quiz, then the algorithm groups 4-6. Reported to keep some answers similar (e.g., appetite for politics talk), deliberately *mix* introvert/extrovert balance, and keep age within ~10 years. Restaurant revealed the day before. | Direct evidence for *mixed objectives* in group composition: similarity on conversational norms, complementarity on social energy. Add an "energy balance" term and a "dominance risk" check (33.7). Fixed weekly cadence creates habit. |
| **222** ([TechCrunch 2022](https://techcrunch.com/2022/11/14/2440702/); [Fast Company](https://www.fastcompany.com/91356813/222-aims-to-end-loneliness-by-engineering-chance)) | Curated small-group outings with strangers. | Started as a university research project predicting who'd enjoy time together from identity/values/beliefs data. ~30-question quiz maps to personality categories. Invites to venue activities, vetting, day-of reveal. | Vetting plus a curation fee signals seriousness. Mystery and anticipation are product features ("I have a strange idea," 6.3). |
| **Pie** ([Fox Business](https://www.foxbusiness.com/lifestyle/new-social-media-app-uses-ai-help-users-make-real-world-friends); [Origin Ventures](https://www.originventures.com/blog/make-plans-like-magic-why-we-invested-in-pie)) | Free local events; attendees are grouped into pods of ~6 with a pre-event group chat. | AI quiz predicts compatibility; RSVPs are grouped into sixes; group chat before the event lowers anxiety. | "Event anchor + pre-assigned pod + pre-event chat" is a proven pattern for our event-anchor generator and the relay group thread. The pod makes attending alone feel safe. |
| **Lex** ([Wikipedia](https://en.wikipedia.org/wiki/Lex_(app)); [TechCrunch 2023](https://techcrunch.com/2023/10/02/queer-social-app-lex-gets-a-new-ceo-and-5-6m-to-grow/)) | Text-first, personals-style queer social app. | Not algorithmic matching. Members post written personals and others respond. | Text-first "standing intents" ("I want to start a band...") are a native social format. Our Intent object is a private, agent-mediated personal. |
| **Hinge** ([TechCrunch 2018](https://techcrunch.com/2018/07/11/hinge-employs-new-algorithm-to-find-your-most-compatible-match-for-you/)) | Dating app. "Most Compatible" daily pick. | Behavior-learned preferences + Gale-Shapley / stable roommates. Reported 8x more likely to lead to dates. | One daily high-conviction mutual pick beats a feed. Supports our scarcity design. |
| **Bumble BFF** ([TechCrunch 2025](https://techcrunch.com/2025/09/18/bumble-bffs-revamped-app-is-here-focusing-on-friend-groups-and-community-building)) | Friendship app, rebuilt in 2025 on Geneva (groups/community). | Pivoted from 1:1 friend swiping to groups, shared-interest circles, and a "Plan" tool. | Market signal: 1:1 friend-swiping underperformed, and groups plus plans won. Validates our group and event emphasis. |
| **Meetup** (research on its data: [Macedo et al., RecSys 2015](https://www.semanticscholar.org/paper/Context-Aware-Event-Recommendation-in-Event-based-Macedo-Marinho/252c5715c84224a90d7ffcc1823a3f063072b3f0)) | Interest groups and events. | Academic work on Meetup crawls shows learning-to-rank events over contextual signals (social: group members attending; content; location; time) works well. | Feature set for the event-anchor generator: who else is going, distance, time-of-week preference, topical match. |
| **Partiful** ([CNBC 2025](https://www.cnbc.com/2025/04/19/meet-partiful-the-gen-z-party-planning-staple-thats-taking-on-apple.html)) / **Luma** ([Social Discovery Insights](https://www.socialdiscoveryinsights.com/2024/05/16/luma-event-planning-app-sees-impressive-user-growth/)) | Event invites/RSVP (Partiful: social; Luma: tech/professional). | No people-matching. Growth comes from visible guest lists ("who's going") as social proof. | They are external event *sources* for our world-knowledge ingestion. "Who's going" is the strongest attendance signal, and our event-anchor proposals reproduce it privately ("two people you'd like are going"). |
| **Lunchclub** ([status write-up](https://www.articuler.ai/resources/compare/lunchclub-alternatives/)) | AI 1:1 professional intros (2018-2022). | Reported plateau in 2022, team pivoted; the app is unmaintained. Users complained about lack of control over matches. | Cautionary: weekly auto-matched 1:1s without strong intent decay into low-value meetings. Our intent-driven and review-gated design addresses this. Give members control (stated intents, quotas). |
| **Clubhouse** ([growth teardown](https://www.slideshare.net/slideshow/clubhouse-viral-growth-lessons/241809847)) | Live audio rooms; invite-only launch. | Room/people recommendations from follows, contacts, and clubs. Discovery was widely criticized as weak. | Invite scarcity + "welcome the person you invited" drove growth. Our vouch-based invites and newcomer-welcome generator are the durable version of that. |

---

## 9. Privacy: inference privacy, differential privacy on graphs, contextual integrity

**9.1 Nissenbaum (2004). "Privacy as Contextual Integrity." Washington Law Review 79.**
https://nyuscholars.nyu.edu/en/publications/privacy-as-contextual-integrity
Privacy is the appropriate *flow* of information according to context-specific norms, described by five parameters: subject, sender, recipient, attribute, and transmission principle. It is not secrecy or control.
**Use for The Network:** `PRIVACY`, `JUDGE`. This is the right formal model for our privacy scopes and the "shareable reasons only" rule (ME-003). Store each facet with a flow policy ("member said this to the agent; may be used for matching; may be shown to an intro counterparty only as a paraphrase; never to a reviewer outside ops"). The explanation generator then checks the flow against the policy, not just a private/public bit.

**9.2 Mireshghallah et al. (2024). "Can LLMs Keep a Secret? Testing Privacy Implications of Language Models via Contextual Integrity Theory" (ConfAIde). ICLR spotlight.**
https://confaide.github.io/ ; code: https://github.com/skywalker023/confaide
A tiered benchmark. Even GPT-4 revealed private information in contexts humans would not about 39% of the time, and ChatGPT about 57%.
**Use for The Network:** `PRIVACY`, `EVAL`. Hard evidence that prompt instructions alone ("only use shareable facts") are insufficient. Enforce privacy *structurally*: the explainer and judge only ever receive facets whose scope allows the destination. Canaries test that the structure holds.

**9.3 Shao et al. (2024). "PrivacyLens: Evaluating Privacy Norm Awareness of Language Models in Action." NeurIPS D&B.**
https://arxiv.org/abs/2409.00138 ; code: https://github.com/salt-nlp/privacylens
LMs answer privacy-probing questions correctly but still leak in agentic trajectories (GPT-4 about 26%, Llama-3-70B about 39%), even with privacy prompts.
**Use for The Network:** `PRIVACY`, `EVAL`. Test privacy on *agent trajectories* (relay messages, scheduling, explanations), not on Q&A. Adapt their seed → vignette → trajectory pipeline to generate canary scenarios for the simulator.

**9.4 Staab, Vero, Balunović, Vechev (2024). "Beyond Memorization: Violating Privacy Via Inference with Large Language Models." ICLR.**
https://arxiv.org/abs/2310.07298 ; code: https://github.com/eth-sri/llmprivacy
LLMs infer location, income, sex, and other attributes from innocuous text with up to 85% top-1 accuracy, about 100x cheaper than humans.
**Use for The Network:** `PRIVACY`. Two implications. (1) Our *own* extractors can easily infer sensitive attributes members never stated. Extraction must be restricted to allowed facet kinds, and inferred sensitive attributes (health, religion, orientation, finances) must be dropped, never stored as "inferred" facets. (2) An explanation like "you're both in the Mission and into recovery-friendly events" can let the counterparty infer private facts. Run an LLM "inference auditor" over outbound explanations (34.4 already lists it).

**9.5 Kosinski, Stillwell, Graepel (2013). "Private traits and attributes are predictable from digital records of human behavior." PNAS.**
https://www.pnas.org/doi/pdf/10.1073/pnas.1218772110
Facebook Likes alone predicted sexual orientation, ethnicity, religion, politics, personality, and substance use with high accuracy.
**Use for The Network:** `PRIVACY`. Behavioral data (which proposals someone accepts) is itself sensitive. Members' accept/decline histories and inferred clusters must get the same protection as stated facets. Never expose "people like you accepted X."

**9.6 Machanavajjhala, Korolova, Das Sarma (2011). "Personalized Social Recommendations: Accurate or Private?" VLDB.**
https://arxiv.org/abs/1105.4254
Proves that for graph-link-based social recommendations, good accuracy and differential privacy of edges are fundamentally in tension, especially for low-degree nodes.
**Use for The Network:** `PRIVACY`, `WARM-PATH`. In a 300-person network, *any* warm-path recommendation reveals edges ("you both know Maya"). Treat edges as private by default. Disclose a connector only with that connector's consent (13.2), and prefer "a member you both know offered to introduce you" over naming them until the connector opts in.

**9.7 Hay, Li, Miklau, Jensen (2009). "Accurate Estimation of the Degree Distribution of Private Networks." ICDM.**
https://cs.colgate.edu/~mhay/assets/publications/hay2009accurate.pdf ; node-DP: Kasiviswanathan et al., https://cs-people.bu.edu/sofya/pubs/nodeprivacy-TCC.pdf
Foundational edge- and node-differential-privacy techniques for releasing graph statistics.
**Use for The Network:** `PRIVACY`, `EVAL`. Relevant if we ever publish network statistics (city reports, a "Network Commons" dashboard, member-facing "N people nearby are into this"). With small counts, add DP noise or thresholding (no counts below k=5). Not needed for internal admin analytics behind access control.

**9.8 Private set intersection for mutual-interest reveals (e.g., EdalatNejad et al., "Private Collection Matching Protocols," PoPETs 2023).**
https://petsymposium.org/popets/2023/popets-2023-0091.pdf ; Meta Private-ID: https://engineering.fb.com/2020/07/10/open-source/private-matching/
Cryptographic protocols reveal only the intersection of two parties' sets.
**Use for The Network:** `PRIVACY`. Not needed in v1, because the Network is a trusted intermediary. The *product* principle still applies: a decline or a non-mutual romantic interest must be informationally indistinguishable from "never proposed." Independent invitations and no decline leakage (34.2 consent tests) are the operational equivalent. Revisit PSI if Gateway-connected third-party assistants hold intents.

---

## Top 15 things to apply in v1 (ranked)

1. **Harmonic/geometric-mean reciprocity in `MutualBenefit`; least-misery floor for groups.** Score every configuration by its least-served participant. (RECON 1.2, OkCupid 1.17, Masthoff 2.4) → `SCORER`, `GROUP`.
2. **A global run-level selector (max-weight b-matching via CP-SAT) instead of per-member greedy top-k.** Encode budgets (ME-002), time conflicts, cooldowns, and the exposure-debt term as constraints and objective terms. Generators emit overlapping candidates and the selector resolves them, the Open Match pattern. (1.5, 1.8, 3.7, 8a) → `POLICY`.
3. **Amortized exposure fairness.** Keep a per-member exposure-debt (cumulative estimated relevance minus cumulative proposals) and add it to the selector objective. Report Gini, the top-10% share, and Lorenz curves nightly. (Biega 5.2, Singh-Joachims 5.1, Lorenz 5.4) → `POLICY`, `EVAL`, ME-012.
4. **Congestion-aware acceptance.** Model P(accept) as decreasing in recent asks and matches, and penalize popular members' inbound load in the score itself. (Rios-Saban-Zheng 1.8, Kanoria-Saban 1.9, Anagnostopoulos 2.2) → `SCORER`, `POLICY`.
5. **Propensity logging from day one.** Every proposal records generator, score components, selector rank, whether it was an exploration pick and its selection probability, reviewer action, and every downstream outcome with timestamps. Keep a small randomized slice. (5.7, 5.9, 7.4) → `LEARN`, `EVAL`.
6. **Thompson-sampling exploration over generator × category × format arms**, measured on 60-day outcomes rather than immediate opt-in. (5.8, 5.12) → `EXPLORE`.
7. **Cheap, explainable graph features in SQL:** common neighbors, Adamic-Adar, edge-type-weighted tie strength, and co-presence overlap. Shape the warm-path value as an **inverted U in tie strength**. (4.9, 4.2, 1.13) → `WARM-PATH`, `RETRIEVAL`.
8. **Nightly analytics job (NetworkX):** community labels, Burt constraint/effective size, newcomer isolation, and cross-cluster tie share as the network-health north star. (4.3, 4.13, 4.8) → `POLICY`, `EVAL`.
9. **Exact vector search with SQL hard filters** at MVP scale. Add HNSW with iterative scans only when needed, and test recall against exact. (4.16) → `RETRIEVAL`, `STORE`.
10. **Group composer = beam search + local-search swaps**, with an objective of mean pairwise fit, a min-pair floor, role coverage, 1-2 pre-existing ties (open-triangle seeding), social-energy balance, and DPP-style cluster diversity. Lunch Roulette as the baseline in sim. (2.4, 2.10, 2.11, 5.14, Timeleft) → `GROUP`.
11. **Judge hygiene:** cross-family judge, order-swapped pairwise and group evaluation, probability-weighted scores where available, name/pronoun counterfactual audits, and post-hoc calibration (isotonic) to reviewer and outcome labels. The judge stays a bounded input. (6.1-6.5, 6.8) → `JUDGE`.
12. **Don't let the engine claim chemistry.** Weight logistics, availability, reliability, and stated intent fit. Explanations cite concrete shared intents and context, not "you'll click." (Joel et al. 1.18, 6.7) → `SCORER`, `JUDGE`.
13. **Simulator decisions from a hidden-utility choice model (RecSim factorization); LLM only verbalizes.** Calibrate base rates (opt-in, flake, reply latency) to targets. Isolate persona ground truth in a separate process. Include triadic and focal closure in background tie formation. (6.18, 6.20, 6.13, 4.5) → `SIM`.
14. **Structural contextual integrity.** Every facet and edge carries a flow policy. The explainer and judge receive only flow-permitted facets. No inferred sensitive attributes are ever stored. An inference auditor runs on outbound explanations. Connectors are named only with consent. (9.1-9.6) → `PRIVACY`, ME-003.
15. **Agent and flow tests graded on DB end-state with pass^k**, plus SOTOPIA-style secret-keeping and PrivacyLens-style trajectory canaries. (6.16, 6.15, 9.3) → `EVAL`.

Explicitly **not** in v1: Gale-Shapley as the engine; graph databases or Apache AGE; node2vec/GNN/two-tower/JEPA training; LLM "date simulation" compatibility scoring; Vowpal Wabbit in production.

---

## Recommended evaluation methodology

The Network's evaluation problem has three hard properties. **(a) Tiny N:** 150-300 members per city, so classical A/B tests are underpowered. **(b) Interference:** proposals consume shared capacity, so treating member A changes B's outcomes. **(c) Long, delayed outcomes:** opt-in, then meeting, then second encounter at 60 days. So evaluation is layered: offline replay and metrics, simulation with ground truth, shadow mode with reviewers, then a pilot with randomized arms and off-policy estimators.

### Layer 1: Offline metrics (every nightly run, on real or simulated logs)

**Hard invariants (must be zero; fail the run):** constraint violations (ME-001), budget breaches (ME-002), canary leaks (ME-003), non-reproducible runs (ME-004), cooldown/block violations (ME-006).

**Quality (per generator, per category, per city):**
- *Reviewer precision*: share approved without edits; approved-with-edit rate; reject reasons distribution. During shadow mode this is the primary metric.
- *Mutual opt-in rate*: P(all accept | sent); *completion rate*: P(happened | all accepted); *positive-outcome rate*: P(both rate ≥4 or "would meet again").
- *Second-encounter rate within 60 days* (PRD 28.2 target: ≥20% of positive first meetings).
- *Calibration*: Brier score and reliability diagram for predicted P(accept) and P(complete), and for judge-score → approval. Calibration matters more than ranking because thresholds drive the interruption decision (14.4).
- *Ranking quality on reviewer labels*: NDCG@k / precision@k of the engine's ordering against approve/reject, computed per run.

**Reciprocal-market metrics (from Yang et al., KDD 2024, 1.4):**
- *Coverage*: share of active members with ≥1 viable proposal in the last 14 days; share with an open intent and nothing for more than 10 days (feeds 33.10 "nothing yet").
- *Bilateral stability*: blocking-pair rate, the share of member pairs who both scored each other higher than what each was proposed (computed with `matching`, 3.5).
- *Balanced ranking*: mean absolute difference in each party's predicted benefit within a proposal. High values mean lopsided "favors."

**Fairness and network health:**
- Exposure Gini and Lorenz curve; top-10% share of proposals, acceptances, completions, and *help given* (15.4).
- Exposure-to-relevance ratio per member (Biega). Flag members with high relevance and low exposure for more than 2 weeks.
- Cohort disaggregation with fairlearn: newcomers (<30 days), city, neighborhood, inviter cluster, and quiet vs. chatty members.
- Time-to-first-proposal and time-to-first-completed-interaction for newcomers.
- Graph health: cross-cluster share of new edges, mean Burt effective size, number of isolated or near-isolated members, and the share of edges formed directly outside the Network (6.4).

**Diversity and exploration:** intra-member proposal diversity (category entropy over 4 weeks), exploration-arm outcomes vs. exploit-arm outcomes on 60-day metrics.

**Judge metrics (judge golden set, 34.1):** agreement with reviewers (Cohen's κ on approve/reject; Spearman on dimension scores), position-swap consistency rate (target ≥90%), counterfactual name/pronoun swap invariance (target: no significant verdict shift), and rubric version drift.

### Layer 2: Simulation-based evaluation with ground truth (Network World Simulator)

**Ground truth design.** Each persona has hidden latent utilities: true interests, hidden desires, social energy, availability, flakiness, and a *pairwise affinity* function built from (i) intent complementarity, (ii) shared foci, (iii) an actor effect (how much this person enjoys meetings generally), and (iv) an **irreducible random pair term**. Joel et al. (1.18) imply the random term should be large; a starting point is about 50% of pairwise variance. The engine never sees these. Personas *say* a noisy, partial, sometimes dishonest subset during onboarding, through the real agent.

**Decision model.** Accept, decline, flake, and reply latency come from a calibrated stochastic choice model over hidden utilities, fatigue (recent asks), and logistics (RecSim-style). The LLM writes the messages. Base rates are tuned to PRD targets so the engine is not graded against over-agreeable simulated people (6.18).

**What to measure (ties to 34.4):**
- *Precision vs. ground truth*: share of sent proposals whose hidden mutual utility exceeds threshold τ.
- *Recall vs. ground truth*: share of the top-M latent opportunities (computed by an oracle with full hidden information, solved by the same ILP selector) that the engine found within the horizon. The **oracle gap** (oracle welfare minus engine welfare) is the single best number for comparing engine versions.
- *Constraint and privacy*: canary leaks (including indirect inference leaks found by an auditor), invariant violations, pass^k on scripted scenarios (6.16).
- *Fairness and health*: the same metrics as Layer 1, computed on simulated logs.
- *Robustness*: rerun with ≥5 seeds per config and report means with 95% intervals; run shock scenarios (popular member goes quiet, invite burst, rainy weekend).

**Ablations to run before pilot:** reciprocity aggregation (sum vs. harmonic vs. min); with vs. without the global selector; exposure-debt on vs. off; judge on vs. off (is the LLM judge worth its cost?); warm-path shaping (monotone vs. inverted U); exploration rate 0/10/20%; beam-search group composer vs. Lunch-Roulette random-restart baseline.

**Simulator validity checks:** (1) *Sim-to-real calibration*. Once shadow and pilot data exist, compare simulated and real distributions of reply latency, opt-in, flake rate, and message length, and refit. (2) *Two-simulator agreement*. After the pilot, train a small learned response model on real logs (KuaiSim-style, 6.21) and confirm engine-version rankings agree between the LLM-persona sim and the learned sim. (3) *Model-family separation*. The persona model is not the agent's or judge's model family (34.3). (4) *No ground-truth leakage*. Personas' hidden cards live in a separate process, and a test asserts that no hidden field string appears in any Network-side table.

### Layer 3: Shadow mode on real seed data (≥2 weeks before proactive sends; 34.6)

- Engine runs nightly on real data and writes proposals only to the review queue.
- Reviewers label every proposal (approve/edit/reject + reason). About 20% are double-reviewed to measure inter-reviewer κ. **Judge-vs-reviewer κ should approach inter-reviewer κ before the judge's weight increases.**
- **Blind reviewer interleaving** for comparing engine variants with few members: for the same member and intent, show reviewers proposals from variant A and B in random order without labels. The preference rate is a low-variance comparison that does not need any sends.
- Exit criteria: reviewer precision at or above the category threshold (20.3), zero invariant violations, and coverage and fairness metrics within bounds.

### Layer 4: Pilot evaluation (live sends, human-reviewed)

- **Randomize at the proposal-decision level, not the member level.** For each candidate slot, the policy picks among exploit/explore arms or scorer variants with known logged probabilities. That allows (a) direct comparison of arms on outcomes and (b) **off-policy evaluation** (IPS / doubly-robust via Open Bandit Pipeline, 5.10) of policies never deployed, such as "scorer v2 with different weights."
- **Handle interference.** Capacity is shared, so for policy changes that affect global allocation (selector, fairness term, budgets), use **city-level or time-based switchback designs**: alternate the policy by week within a city and compare across periods. Accept that these are low-power and analyze with Bayesian hierarchical models across cities and weeks rather than p-values.
- **Primary pilot metrics** (PRD 28.2): worthwhile-interruption rate ≥70%, mute/complaint <5%, opt-in ≥40%, completion ≥70%, second interaction within 60 days ≥20% of positive meetings. **Guardrails:** exposure concentration (top-10% share), newcomer time-to-first-value, no-show rate, privacy incidents (zero).
- **Long-horizon readout.** Exploration and network-health interventions are judged on 60- and 90-day outcomes (second encounters, direct ties formed, cross-cluster ties), never on 7-day opt-in alone (5.12).
- **Learning loop.** Once there are about 1-2k labeled proposals with outcomes, train LambdaMART on logged components with IPS-weighted labels (7.1, 7.4). Evaluate it offline with OPE and in simulation, then ship it as a new arm with a small traffic share. Do not replace the hand-tuned scorer wholesale.

---

## Appendix: verification notes

- Papers were verified via search results pointing to arXiv, ACM DL, publisher pages, or author PDFs. Repository stats came from `gh api repos/<owner>/<repo>` on 2026-10-05.
- Commercial-product matching details are taken from press and third-party sources and are labeled that way. None of these companies has published a technical description of its matching, except Hinge's 2018 press statements about Gale-Shapley.
- Items found but deliberately excluded as low-value or unverifiable: generic "dating app algorithm hack" blogs, Clubhouse algorithm claims beyond press teardowns, and Meetup's internal recommender (no public technical source found; Macedo et al. is used as a proxy).
