# R4. Quality: reciprocal recommenders and learning from outcomes

Research report for The Network's matching engine (worktree `/Users/nubs/thenetwork-matching`, commit 3f0f8586). Read-only research: no code, simulation or test was run. Citations marked **[opened]** were opened (abstract page, listing or full text through search or fetch) during this research; the details given for them come from what was opened. Citations marked **[unverified]** are recalled from memory and were not opened. Numbers from our own system come from `docs/results/2026-11-17-matching-engine-migration.md` and from reading the code at the paths given.

---

## 0. Summary of findings

1. **Our score aggregates the two directions with the harmonic mean. That is the most common operator in the reciprocal-recommender literature**, and it is defensible. There is no strong evidence that another operator is generally better. Neve and Palomares (RecSys 2019) found that the choice of operator "significantly" changes results, and the best one depends on the data. The one principled exception: when each directed utility is a *calibrated probability of saying yes*, the quantity we want for "both say yes" is the **product**. OkCupid's geometric mean ranks pairs in the same order as the product. A product is easy to state in integers and to prove.
2. **The ceiling for prediction before a meeting is low, and our simulators are built that way on purpose.** Joel, Eastwick and Finkel (2017): pre-date self-reports predicted 4-18% of actor variance and 7-27% of partner variance, but none of the *relationship* (dyadic) variance. Our slop oracle adds a symmetric "chemistry" term (SD 0.9 on the logit scale) that is unknowable before the date. The friends oracle adds one with SD 0.55. So an AUC of 0.58 for slop and 0.60 for friends must be read against the **oracle's own pre-meeting ceiling**, which we do not report today. Proposal P1 adds that ceiling as the denominator.
3. **What before-meeting data can predict is mostly NOT similarity of interests.** It is (a) *partner effects*: how desirable or likable a person is to most people (attractiveness has high consensus), (b) *actor effects*: how selective or warm a person is, which drives P(yes), (c) dealbreakers, goals and logistics, and (d) for friendship, proximity, schedule overlap and repeated contact (Back et al. 2008; Hall 2018). Our friends weights put 6 of 10 on interest affinity, while the friends oracle rewards likability, similarity, "bond" from repeated time together, and travel. The slop oracle's largest *learnable* term is a per-member hidden taste vector (`wTaste = 1.8` times taste·traits). The engine can learn that term only from the member's own feedback.
4. **The biggest quality levers are two-sided acceptance and per-member learning, not more similarity terms.** The reciprocal literature consistently gains by modelling the *receiver's* likely reply: RECON raised top-10 success from 26% to 45%; Tu et al. reported a median relative reply gain of about 47% for men; Kleinerman et al. tuned the receiver/recommended balance per user. Our ntwrk experiment shows the trap: AUC against hidden "good pairs" went from 0.56 to 0.73, but meetings fell from 174 to 150. Ranking by quality alone ignores whether both people say yes and whether the meeting can be held.
5. **Off-policy evaluation is not possible today for most choices.** `packages/engine/src/policy.ts` logs `probability: 1` for every exposure-floor and greedy pick. For exploration picks it logs a weight ratio that it documents as a lower bound on the true propensity. Inverse propensity scoring needs non-zero, exact propensities for the actions a new policy would take. Our logs have them only on the exploration slice (rate 0.125, at most 15%). Proposal P4 makes the propensities exact and gives each logged pair support.
6. **"People similar to you were matched well with people like X" is a cached signal we can build cheaply and safely** as a small integer table: K taste clusters x K appeal clusters per lane and market, with Beta-smoothed counts. If we **double-centre** the table (remove row and column means), it holds only *interaction* and no popularity, which keeps the founder rule "standing never reads acceptance or popularity". A new member gets a cluster from profile features (as in Tu et al.'s LDA cold start) without any recomputation.
7. **Feedback loops are real and measurable.** Chaney, Stewart and Engelhardt (RecSys 2018) show in simulation that a recommender trained on its own outputs makes behaviour more uniform without a matching gain in utility. Our rules (private standing, no popularity input, an exposure floor) are the right defence. Any learned term must be per-member (actor) or per-interaction (centred), never a per-partner marginal.
8. **Simulation noise hides real effects.** A neutral tie-break moved pooled meetings from 174 to 132. Proposal P1 replaces realized meetings with the oracle's **expected** outcome of each proposed pair (the soft label that already exists: `pGood` and `pSecond` with 32 chemistry draws) and uses paired seeds. This removes the chemistry and behaviour noise from the comparison.

The order I recommend: P1 (ceiling-normalized, low-variance benchmark) → P2 (two-sided acceptance in the greedy order, including the ntwrk request path) → P4 (exact propensities) → P3 (per-member taste learning) → P5 (centred cluster table) → P7 (friends terms: proximity, schedule, IDF) → P6 (product aggregator, measured) → P8 (signifiers) → P9 (Thompson exploration).

---

## 1. What the engine and the simulators do today (quality-relevant facts)

**Pair value** (`spec/pairValue.md`). Each directed utility is a weighted mean of four terms: complement, affinity, closeness, pack. Both must reach the lane floor. The value is `harmonicValue(u_ab, u_ba)` less a parity penalty, and the exchange must be balanced in the lanes that require it. Lane weights (G-architecture addendum): Friend 1/6/2/1, Date 3/2/2/3, Cofounder 5/2/2/1, Intro 6/2/1/1, Hire 6/1/2/1, Mentor 5/3/1/1, Invest 6/2/1/1 (complement/affinity/closeness/pack).

**Dating pack value** (`packages/engine/src/packs/slop/score.ts`). `datePackValue = directional x logistics x bodyTypeFactor`, scaled to 0..1000. `directional` multiplies a compatibility estimate (goals, lifestyle clashes, likely unstated dealbreakers, shared interests), an activity fit, `exp(typeWeight x typeMatch)` (stated type against the other's self-description, weak by design), and `learnedFactor = exp(taste x revealedTaste(a,b))`. `revealedTaste` is the mean of (rating − 0.5) x cosine(rated partner's self-description, b's self-description) over **post-date ratings only**, shrunk by n+1. A `responsiveness` function (a Beta-smoothed P(yes to a probe) from the member's own history) exists but is not part of the pack value. The file states the rule "No property of one member alone enters the pack value: standing is the only global quality signal."

**Standing for Date** comes from the private Clef rating. It feeds only the parity band, so it does not reward a desirable partner. It only keeps pairs at similar levels.

**Selection logging** (`packages/engine/src/policy.ts`). Exposure-floor picks and greedy picks call `tryReserve(x, false, 1, ...)`, so their logged probability is 1. Exploration picks log `weight / remaining weight`, which the code documents as "a lower bound on the true propensity among the feasible draws". Pairs that were not selected have no logged propensity. Exploration: `rate 0.125`, `maxShare 0.15` (`packages/engine/src/config.ts`).

**slop oracle** (`packages/sim/src/apps/slop/oracle.ts`):
`L(a→b) = c0 + warmth_a + 0.9·D_b + 1.8·taste_a·traits_b − ageOut − 0.4·D_a`. After the meeting it adds `chem(a,b) ~ N(0, 0.9)` (symmetric, unknowable) plus side noise of SD 0.35. Enjoyment is `sigmoid(L') x compat x activityFit`. A date is good when `min(e_a, e_b) ≥ 0.4`.
These are actor (warmth, selectivity), partner (desirability D), a per-member taste interaction, and pair chemistry: the social relations model decomposition (Kenny [unverified]) that Joel et al. use.

**friends oracle** (`packages/sim/src/apps/friends/oracle.ts`): enjoyment is a sigmoid of activity liking, `mean_j [chem_ij + sim_ij + 0.4·likability_j]`, warmth, group balance, **bond from hours already spent together**, travel cost, size discomfort and noise. `chem ~ N(0, 0.55)`. Friendship forms when pair hours cross Hall's thresholds (50, 90, 200 hours).

**Consequences.**
- The largest learnable dating term (`1.8·taste_a·traits_b`) is invisible before feedback. The engine's stated `wants`/`self` proxy is weak by design (Eastwick and Finkel 2008 [unverified]).
- The partner effects (D_b, likability_j) are deliberately not used as a reward by our engine, because of the private-standing and anti-popularity rules. That costs AUC in the simulator. It is a policy choice, not a defect, and it must be reported as such.
- Friends quality in the simulator depends heavily on repetition (bond) and travel, which are closeness and group-continuity matters, not interest overlap.
- 88% of ntwrk meetings come from member requests through `searchFor` (`packages/network/src/network.ts`), which does not read the lane vectors. Quality work on the lane value does not reach most ntwrk meetings until that path uses it.

---

## 2. Survey: reciprocal recommender systems

### 2.1 Academic reciprocal recommenders

| Work | What it does | How it combines the two directions | Evidence |
|---|---|---|---|
| Pizzato, Rej, Chung, Koprinska, Kay. *RECON: a reciprocal recommender for online dating.* RecSys 2010, pp. 207-214, doi 10.1145/1864708.1864747 [opened: dblp and bibtex listing, summary] | Content-based. Each user's implicit preference is a distribution over attribute values of the people they messaged. | Harmonic mean of the two compatibility scores. | Top-10 success rate rose from 26% to 45% when reciprocity was used, on an Australian dating site. Reciprocity also helped cold start. |
| Pizzato, Rej, Akehurst, Koprinska, Yacef, Kay. *Recommending people to people: the nature of reciprocal recommenders with a case study in online dating.* UMUAI 23, 2013 [unverified] | Defines the field: both sides are users, success needs both, users are limited resources, and a popular user cannot take all the attention. | Harmonic mean (RECON). | Survey and case study. |
| Xia, Liu, Sun, Chen. *Reciprocal Recommendation System for Online Dating.* ASONAM 2015, pp. 234-241, doi 10.1145/2808797.2809282; journal version SNAM 2016 [opened: abstract] | Collaborative filtering from message graphs: **interest similarity** (two users message the same people) and **attractiveness similarity** (two users get messages from the same people). | Harmonic mean of the two directed scores. | CF beat content-based methods in precision and recall on a large Chinese site. Men tend to message on their own interest. Women weigh their chance of a reply more. |
| Tu, Ribeiro, Jensen, Towsley, Liu, Jiang, Wang. *Online Dating Recommendations: Matching Markets and Learning Preferences.* WWW 2014 Companion, pp. 787-792, arXiv 1401.8042 [opened: full text on ar5iv] | LDA over latent "types" learned from messages and profile features. Cold start: a new user's type mixture is predicted from profile features. Recommendation is an LP that maximizes expected reciprocated messages under per-user daily capacities. | Score = P(suitor sends) x P(receiver replies): a **product**. | On Baihe (about 2M pairs), adding the receiver side gave a median relative reply-rate gain of about 46.8% for men and 16.5% for women. **Learned preferences predicted replies better than stated preferences.** |
| Neve, Palomares. *Latent factor models and aggregation operators for collaborative filtering in reciprocal recommender systems* (LFRR). RecSys 2019, pp. 219-227 [opened: dblp and slides] | Matrix factorization of each direction (on Pairs, a Japanese app with about 10M users). | Compares arithmetic, geometric, **harmonic**, and the **cross-ratio uninorm**. | Similar precision and recall to kNN at much lower cost. "Aggregation functions significantly impact the results." Earlier work used only the harmonic mean. The slide text did not give the ranking of operators. |
| Neve, McConville. *ImRec: Learning Reciprocal Preferences Using Images.* RecSys 2020, pp. 170-179 [opened: listing]; follow-up TIRR, arXiv 2108.11714 [opened: listing] | Siamese network on photos from each user's like/dislike history, then a reciprocal aggregation. | Separate aggregation step. | Image-based beat categorical-profile methods. TIRR beat ImRec. |
| Kleinerman, Rosenfeld, Ricci, Kraus. *Optimally balancing receiver and recommended users' importance in reciprocal recommender systems.* RecSys 2018, pp. 131-139 [opened: listing and abstract] | Picks, **per receiving user**, the weight between "will I accept" and "will they reply". | A per-user weighted combination. | Field test on an operating dating site: more successful interactions than a state-of-the-art baseline. |
| Palomares, Porcel, Pizzato, Guy, Herrera-Viedma. *Reciprocal Recommender Systems: Analysis of state-of-art literature, challenges and opportunities towards social recommendation.* Information Fusion 69:103-127, 2021, arXiv 2007.16120 [opened: abstract; the arXiv v3 was withdrawn after an author dispute, and the journal version stands] | Survey. | Names **fusion of the two unilateral preferences** as "a crucial and distinctive, yet barely investigated aspect". | No new experiments. |

### 2.2 Economics and operations research on dating and matching markets

- **Hitsch, Hortaçsu, Ariely.** *Matching and Sorting in Online Dating.* AER 100(1):130-163, 2010, doi 10.1257/aer.100.1.130 [opened: abstract]. They estimate preferences from an online dating site and run Gale-Shapley on them. The predicted stable matches resemble the site's actual matches, which are "approximately efficient". Preferences alone reproduce the assortative sorting seen in marriages. *For us:* sorting by similar standing (our parity band) is what markets produce anyway. A stable matching on estimated preferences is a sound target, and our greedy is stable for a symmetric score.
- **Bruch, Newman.** *Aspirational pursuit of mates in online dating markets.* Science Advances 4(8):eaap9815, 2018 [opened: abstract and press summaries; the PMC full text was blocked by a captcha]. Desirability (a PageRank-like score from who messages whom) is a consistent hierarchy across four US cities. Users message people more desirable than themselves, and reply rates fall as the gap grows. *For us:* this is the evidence behind the parity band. Their desirability is a **popularity** score. We deliberately use Clef appearance plus reviewed facts instead, and keep it private.
- **Rios, Saban, Zheng.** *Improving Match Rates in Dating Markets Through Assortment Optimization.* MSOM 25(4):1304-1323, 2023 [opened: abstract and INFORMS release]. The number of a user's recent matches *lowers* their probability of liking. A dynamic assortment that takes this into account gave **at least 27% more matches** in two field experiments with a dating company. *For us:* this is "receptivity", which our slop oracle models (`receptivityAfterLikedDate`, `fatigue`). It supports a per-member acceptance estimate that uses recent history (P2).
- **Kanoria, Saban.** *Facilitating the Search for Partners on Matching Platforms.* Management Science 67(10):5990-6029, 2021 [opened: abstract]. In unbalanced markets, the platform should let only the short side propose. Hiding quality information can raise welfare. *For us:* this supports private standing and agent-mediated proposals.
- **Halaburda, Piskorski, Yildirim.** *Competing by Restricting Choice: The Case of Search Platforms.* Management Science 64(8):3574-3594, 2018 [opened: abstract]. Restricted choice raises reply probability. *For us:* this supports small `searchLimit` and weekly capacity.

### 2.3 Industry practice (only what was found; engineering detail is sparse)

- **Tinder.** "Personalized User Recommendations at Tinder: The TinVec Approach", Steve Liu, MLconf SF 2017 [opened: listing]. Embeddings learned from swipes, where users whom the same people swipe right on sit close together (item-item CF in vector form). Tinder publicly said it moved away from its Elo desirability score [opened: secondary sources only; no Tinder primary source found]. *For us:* TinVec is the "co-acceptance" idea of P5. Elo is the popularity score our rules forbid.
- **Hinge "Most Compatible"** (2018) [opened: TechCrunch and summaries]. ML-estimated preferences plus Gale-Shapley, in the stable-roommates variant over one pool. Hinge reported that users were 8x more likely to go on dates (measured by exchanging phone numbers) with these matches than with other recommendations. This is a company claim without published method.
- **OkCupid match percentage** [opened: Rudder talk transcript and secondary descriptions]. Each side's satisfaction is the points the other's answers earn over the points that side allotted (importance 0/1/10/50/250). The two are combined with the **geometric mean**, explained as "the probability of a match for each person". A margin of error lowers the score when few questions are shared. Sociologist Kevin Lewis is reported to have found the match percentage not predictive of success [secondary claim, not opened].
- **Coffee Meets Bagel** [opened: AWS blog, Fifth Elephant talk listing, CIO Dive]. Stated preferences are hard filters. A nightly batch job trains models and extracts features. Real-time scoring of eligible pairs uses a blend of nine models (CIO Dive). A former engineer describes item-based CF and PageRank for a match "in both directions". No public reciprocal-aggregation detail.
- **Bumble:** I found no engineering post on reciprocal ranking. Not used.
- **LinkedIn jobs.** Kenthapadi, Le, Venkataraman. *Personalized Job Recommendation System at LinkedIn: Practical Challenges and Lessons Learned.* RecSys 2017, pp. 346-347 [opened: listing and slides]. They redistribute applications so that a job gets neither too many nor too few (LiJAR, KDD 2017 [unverified detail]). This is the work analogue of an exposure floor plus capacity. Su, Bayoumi, Joachims (below) is the academic version.
- **Person-job fit models.** Zhu, Zhu, Xiong, Ma, Xie, Ding, Li. *Person-Job Fit: Adapting the Right Talent for the Right Job with Joint Representation Learning* (PJFNN), arXiv 1810.04040, 2018 [opened: abstract]. They learn job-requirement and candidate-skill representations from application history. *For us:* peon's AUC of 0.92 shows that structured complement terms already capture most of the predictable fit in the simulator. Learned skill similarity matters more with real free-text data.

### 2.4 Fairness, exposure and two-sided welfare

- **Singh, Joachims.** *Fairness of Exposure in Rankings.* KDD 2018, arXiv 1802.07281 [opened]. Exposure should follow merit. A small relevance gap can produce a large exposure gap (their example: 0.03 relevance difference, about 30% less exposure). They solve the problem with an LP over doubly stochastic matrices and sample rankings with a Birkhoff-von Neumann decomposition.
- **Do, Corbett-Davies, Atif, Usunier.** *Two-sided fairness in rankings via Lorenz dominance.* NeurIPS 2021, arXiv 2110.15781 [opened: abstract]. They maximize concave welfare functions of both sides' utilities, which gives Lorenz-efficient rankings, and cover reciprocal recommendation (dating) explicitly. They solve it with Frank-Wolfe.
- **Su, Bayoumi, Joachims.** *Optimizing Rankings for Recommendation in Matching Markets.* WWW 2022, pp. 328-338, arXiv 2106.01941 [opened: abstract]. Joint rankings for all users that maximize expected matches (social welfare) under both sides' preferences and capacity. Field test: a networking recommender at a large CS conference. This is the closest published analogue of ntwrk.party.
- **Chaney, Stewart, Engelhardt.** *How Algorithmic Confounding in Recommendation Systems Increases Homogeneity and Decreases Utility.* RecSys 2018, arXiv 1710.11214 [opened: abstract]. A feedback loop makes behaviour more uniform without a gain in utility, and confounded held-out data favours models like the confounding one.

### 2.5 Learning and evaluation from logged feedback

- **Dudík, Langford, Li.** *Doubly Robust Policy Evaluation and Learning.* ICML 2011, arXiv 1103.4601 [opened]; journal version Statistical Science 29(4), 2014, arXiv 1503.02834 [opened: listing]. The DR estimator combines a reward model and the logging propensities. It is accurate if either is good and has lower variance than IPS.
- **Li, Chu, Langford, Wang.** *Unbiased offline evaluation of contextual-bandit-based news article recommendation algorithms.* WSDM 2011 [unverified]. A replay estimator over uniformly random logs.
- **Swaminathan, Joachims.** *Counterfactual risk minimization / self-normalized estimator (SNIPS).* ICML 2015 and NeurIPS 2015 [unverified].
- **Chapelle, Li.** *An Empirical Evaluation of Thompson Sampling.* NeurIPS 2011 [opened: abstract]. Thompson sampling is competitive with UCB or better on display ads and news recommendation.
- **Bradley-Terry / pairwise logistic preference models** [standard; not opened]. Each yes or no to a shown partner is a binary label. A per-member logistic regression over partner features is the simplest preference learner, and Bradley-Terry handles explicit "A over B" choices.

---

## 3. How to combine the two directions (aggregation)

Let x, y ∈ [0, 1000] be the two directed utilities.

| Operator | Integer form | Properties | When it is right |
|---|---|---|---|
| Arithmetic mean | (x+y)/2 | Full compensation: a 1000/0 pair gets 500. | Never alone for reciprocal matching. With our lane floor it is less harmful, but still rewards one-sided pairs above the floor. |
| Geometric mean (OkCupid) | isqrt(x·y) | Same *order* as the product. Between H and A. | When x, y are probabilities and we want P(both), up to a monotone transform. |
| **Product** (Tu et al.) | x·y/1000 | ≤ min(x, y). Monotone, symmetric. Zero if either is zero. | **When x, y are calibrated P(yes)**: P(both yes) = x·y under independence. |
| **Harmonic** (RECON, Xia, ours) | 2xy/(x+y) | H = G²/A, so it punishes imbalance more than G does. min ≤ H ≤ 2·min. | When x, y are *quality* scores and we want "good for both" with imbalance penalized. |
| Min (least misery) | min(x, y) | Ignores the better side. | Group admission (our circle floor is a min over pairs), the friends oracle's "good meetup". |
| Cross-ratio uninorm | xy / (xy + (1−x)(1−y)) on [0, 1] | Strengthens agreement: both high → higher than either; both low → lower; mixed → averaging. | Neve and Palomares tested it. Integer form is possible with cross-multiplication. It is not monotone-bounded by min, so the "no one-sided pair" law must come from the floor. |
| Per-user weighted (Kleinerman) | (α_a·x + (1−α_a)·y) | α tuned per receiver. | When users differ in how much the other side's interest matters to them. |

**Evidence.** No study shows one operator dominating across datasets. Neve and Palomares report that the operator choice changes results significantly. RECON and Xia used the harmonic mean and reported large gains over one-sided ranking, but against one-sided baselines, not against the product. Tu et al. used the product of probabilities and reported large gains, also against a one-sided baseline. **The large, consistent gain in the literature comes from using both directions at all, not from the choice among symmetric operators.**

**For us:** keep the harmonic mean as the *pair value*. It is proved (symmetric, bounded, between the two sides, monotone) and it fits "value for both". Then add a separately named *acceptance product* only where we have calibrated probabilities (P2, P6). Under the proved lane floor, H and the product also differ in another way: H is at most 2·min, while the product is at most min. The product therefore prefers balanced pairs at the high end even more strongly.

---

## 4. What can be predicted before a meeting, and the honest ceiling

### 4.1 Dating

- **Joel, Eastwick, Finkel.** *Is Romantic Desire Predictable? Machine Learning Applied to Initial Romantic Attraction.* Psychological Science 28(10):1478-1489, 2017, doi 10.1177/0956797617714580 [opened: abstract, press]. Two speed-dating studies with more than 100 pre-date self-report measures. Random forests predicted 4-18% of **actor** variance (how much a person desires others in general) and 7-27% of **partner** variance (how much a person is desired in general), and **no** relationship (dyadic) variance.
- **Eastwick, Hunt.** *Relational mate value: consensus and uniqueness in romantic evaluations.* JPSP 106(5):728-751, 2014 [opened: PubMed abstract]. Romantic evaluations have more relationship (unique) variance than target (consensus) variance. Consensus is higher for attractiveness and vitality. Uniqueness grows with acquaintance.
- **Eastwick, Luchies, Finkel, Hunt.** *The Predictive Validity of Ideal Partner Preferences: A Review and Meta-Analysis.* Psychological Bulletin 140(3):623-665, 2014 [opened: listing; findings via secondary summaries]. 97 samples, about 30,000 participants. Stated ideals predict little about who people are drawn to at initiation. They are more predictive of satisfaction in existing relationships.
- **Montoya, Horton, Kirchner.** *Is actual similarity necessary for attraction?* JSPR 25(6):889-922, 2008 [opened: abstract]. 313 studies. Actual similarity r = .47 and perceived similarity r = .39 overall. Actual similarity was not significant in existing relationships. Perceived similarity mattered in all designs. (I did not get the figure for no-interaction designs specifically.)
- **Joel et al.** *Machine learning uncovers the most robust self-report predictors of relationship quality across 43 longitudinal couples datasets.* PNAS 117(32):19061-19071, 2020 [opened: abstract and summaries]. 11,196 couples. Relationship-specific perceptions (perceived partner commitment, appreciation, sexual satisfaction, perceived partner satisfaction, conflict) explain much more than individual traits. A partner's traits explain about 5% of the other's satisfaction. Change over time was largely unpredictable.
- **Huang, Yeomans, Brooks, Minson, Gino.** *It Doesn't Hurt to Ask: Question-Asking Increases Liking.* JPSP 113(3):430-452, 2017 [opened: abstract]. In speed dating, people who ask more follow-up questions get more second-date yeses. The mechanism is perceived responsiveness. This is a **during-meeting** behaviour, so it is signal for *post-meeting* learning and for coaching, not for pre-meeting matching.

**Implications for slop.date.**
1. Pre-meeting signals that work: partner effects (Clef attractiveness, which has high consensus), actor effects (selectivity and warmth, which drive P(yes)), goals and dealbreakers (filters and multiplicative clashes, as `compatEstimate` already does), logistics, and age fit.
2. Unique chemistry is unpredictable before the date. Quality must come from (a) **more first dates that both accept and attend**, (b) **learning each member's revealed taste** from their own yes/no and post-date ratings, and (c) **second-date and post-date ratings** as the outcome to learn from.
3. Stated type (`typeMatch`) should stay weak (already "weak by design"). Stated ideals should be filters (already so in `rules.ts`).

### 4.2 Friendship

- **Back, Schmukle, Egloff.** *Becoming Friends by Chance.* Psychological Science 19(5), 2008 [opened: press release only; result from memory: random seat assignment at a first session predicted friendship a year later, **unverified** in detail]. Proximity and chance assignment produce friendships.
- **Hall.** *How many hours does it take to make a friend?* JSPR 2018 [opened: press coverage; the year is 2018, not 2019]. About 50 hours from acquaintance to casual friend, about 90 to friend, and more than 200 to close friend. Leisure time counts more than work time.
- **Festinger, Schachter, Back.** *Social Pressures in Informal Groups* (1950) [unverified]: friendships in a student housing complex followed physical distance and "functional distance" (paths that cross).

**Implications for friends.help.** Interest overlap is a weak predictor and expensive to search (tags held by about 19% of members). Travel time, schedule overlap, life stage and **repeat meetings with the same people** carry the signal. The friends oracle encodes exactly these (travel cost, bond from hours together, Hall thresholds). Friend weights (affinity 6 of 10) point the wrong way. P7 moves weight to closeness terms that are cheap to bound.

### 4.3 Work: hiring and cofounders

- **Kristof-Brown, Zimmerman, Johnson.** *Consequences of individuals' fit at work: a meta-analysis of person-job, person-organization, person-group, and person-supervisor fit.* Personnel Psychology 58(2):281-342, 2005 [opened: abstract]. 172 studies. Fit predicts attitudes, intent to quit and some performance. The fit types are moderately correlated with each other. Person-job fit is most strongly related to job satisfaction (secondary summary).
- **Ruef, Aldrich, Carter.** *The Structure of Founding Teams: Homophily, Strong Ties, and Isolation among U.S. Entrepreneurs.* ASR 68(2):195-222, 2003 [opened: abstract]. Homophily and strong-tie network constraint have the strongest effect on team composition. Exclusion is mainly ecological (no similar others nearby).
- Schmidt and Hunter (1998) and Sackett et al. (2022) on the validity of selection methods [unverified]: work samples, structured interviews and job knowledge predict performance. For a matching engine this means complement terms over *verified* skills and levels are the strongest pre-meeting signal for Hire.

**Implications.** Hire is the most predictable lane. Complement coverage is the main term, and our measured AUC of 0.92 agrees. The risks are level mismatch (142 of 4,767 Hire pairs had a role-level gap above 1) and congestion on popular seats (LinkedIn redistribution). Cofounders are **equals**: the Cofounder lane is Peer/Peer with balance required, which is right. Its signal is homophily on domain and values, complementary skills, **parity on commitment and track record**, and existing ties. The ntwrk request path (88% of meetings) should carry a "warm tie" signal (shared connections), consistent with Ruef et al.

### 4.4 A ceiling we can compute in our own simulator

The slop oracle already computes soft labels `pGood` and `pSecond` by integrating over 32 chemistry draws. That number is the **Bayes-optimal pre-meeting prediction under hidden truth**. Its AUC against the realized good-date labels is the ceiling for any pre-meeting matcher with perfect knowledge. Our engine sees less (no hidden taste, no hidden desirability), so the honest ceiling for it is lower still. Report:

`quality ratio = (AUC_engine − 0.5) / (AUC_oracle_soft − 0.5)`

and a decomposition of the oracle's logit variance into actor, partner, taste-interaction and chemistry parts, computed from the oracle parameters and the persona draws. That tells us how much of the remaining gap is (a) the partner effect that we refuse to use by policy, (b) taste that only feedback can reveal, and (c) chemistry that nothing can reveal. The friends oracle permits the same calculation with `chemSd = 0.55`.

---

## 5. Proposals

Each proposal states: what it changes, why, risks, measurement, effort, and whether exactness and the proved forms survive. "Pair value form unchanged" means `pairValue`, its laws, the window, and the bucket bounds keep their statements. A term with bound 1000 (as the pack term has today) keeps the search sound, but it does not prune.

### P1. Ceiling-normalized, low-variance quality benchmark (area: benchmark; effort S; priority 1)

**What.** Add to the `matching` block, and to the slop, friends and ntwrk worlds, three tracked measures:
1. `AUC_engine / AUC_ceiling` as in section 4.4, per lane, with the ceiling from the oracle's chemistry-integrated soft label.
2. **Expected-outcome evaluation**: for every proposed pair, sum the oracle's soft label (P(both yes) x P(attend) x P(good | meet)) rather than counting realized meetings. Compare arms with the **same seeds and common random numbers**, and report paired differences with a bootstrap CI over seeds.
3. Separate AUCs for **P(a says yes)**, **P(b says yes)** and **P(good | met)**, so that ranking quality and acceptance prediction are not mixed.

**Why.** A neutral tie-break moved pooled meetings from 174 to 132. That is about ±25% noise from chemistry, side noise and probe draws. The ntwrk experiment raised AUC from 0.56 to 0.73 and still lost meetings, because AUC against hidden "good pairs" omits acceptance and logistics. The expected-outcome sum removes the outcome noise. Only the selection still varies. Paired seeds remove most of the rest.

**Risk.** The soft label reads hidden truth. It must stay in `packages/sim` and the judges (a code invariant). It measures the simulator's model of people, not real people.

**Measure.** Variance of the arm difference across seeds, before and after: expect a large reduction. The paired CI should exclude 0 for the ntwrk AUC experiment's real effect (or show it is noise).

**Exactness.** Not touched (evaluation only).

### P2. Two-sided acceptance in the greedy order and in the request path (area: quality; effort M; priority 2)

**What.**
1. Per member and lane, an integer **actor acceptance estimate** `acc_a ∈ [0, 1000]`: a Beta-smoothed rate of the member's own yes answers to probes, discounted by recent matches (Rios, Saban, Zheng). `responsiveness()` in `slop/score.ts` is a starting point. Use only the member's **own** responses, never responses others gave *to* them.
2. The greedy order key becomes `orderValue = pairValue x acc_a x acc_b / 10^6` (integer). Admission (`pairAdmissible`) stays unchanged.
3. Route `searchFor` (ntwrk requests) through the same `pairValueOf` plus this order, so that 88% of ntwrk meetings use the reciprocal value.

**Why.** Every reciprocal study that modelled the receiver's reply gained a lot: RECON 26% → 45% top-10 success, Tu et al. a median relative gain of about 47% for men, Kleinerman et al. significant gains with per-user balance, Rios et al. ≥27% more matches from acceptance-aware assortment. Our ntwrk result (AUC up, meetings down) is the failure that this fixes.

**Risk.**
- **Popularity loop.** Actor acceptance is a property of one member. The slop file says "No property of one member alone enters the pack value". That is why this goes into the *order key*, not the pair value. It does not change *whom* a member is matched with among equally accepting people. It does change *which pairs go first* across the market, so it favours members who say yes often. Members who say no a lot get fewer proposals. That is arguably right (respecting their choosiness) but it must be measured: the lowest-quintile ratio and the exposure floor must still hold.
- **Partner effects must not leak in.** Never use "how often others said yes to b". That is the Elo and Bruch-Newman popularity score. For Date, partner desirability enters only as the parity band.

**Measure.** P1's expected outcome. Everyone-yes rate (network: 0.880 now). Meetings. Lowest-quintile dates (gate 0.85). Gini of proposals. The proportion of greedy refusals.

**Exactness.** The pair value, window and bounds are unchanged. The greedy stability theorem holds for any **symmetric** total order on pairs. `acc_a x acc_b` is symmetric, so "no blocking pair in the greedy phase" holds with respect to `orderValue`. The `selectionRun` guard `value <= greedyBound` takes `orderValue`. **Search-level top-k is still by pair value.** If we want top-k by `orderValue`, then `acc_b` must be bounded per bucket (store the max `acc` in the bucket summary: a sound bound, since the product is monotone).

### P3. Per-member revealed taste from yes/no and post-meeting ratings (area: quality; effort M; priority 4)

**What.** Generalize `revealedTaste`:
1. Labels: **probe yes/no** (abundant, pre-meeting attraction) and **post-date ratings** (rare, the real outcome), with different weights.
2. Features of the partner b: the 5-dim self-description, body type (already), activity tags, goal, lifestyle categories, and (Date only, private) the Clef standing **relative to a's own** (`standing_b − standing_a`, which captures each member's own reach without a global popularity term).
3. Model: per-member L2-regularized logistic regression (Bradley-Terry when the member chose between two). It is **shrunk toward the member's taste-cluster prior** (P5) and toward the stated `wants`. With n labels the prior weight is k/(k+n).
4. **Export**: weights rounded to integers in [−64, 64] (scale 16). The pack term is `clamp(500 + Σ_k w_ak · x_bk, 0, 1000)` with integer features `x_bk ∈ {−1, 0, 1}` or small integers. A monotone integer calibration table (isotonic regression into about 20 bins, as permille) turns the score into a probability for P2 and P6.

**Why.** The slop oracle's biggest learnable term is `1.8·taste_a·traits_b`. Tu et al. found learned preferences beat stated ones. TinVec, ImRec and LFRR all learn from each user's own likes. Eastwick et al. (2014) show stated ideals are weak at initiation.

**Risk.**
- Few labels per member (hundreds to low thousands of members per city, about 2 proposals a week each): 10-20 labels need 5-10 weeks. Shrinkage is required.
- Learning only from shown partners (selection bias). Use P4's propensities as weights.
- A member's revealed taste may encode race or other protected preferences by proxy. We have no race field, but features such as photos could carry it. Do not include image embeddings in the taste model without a bias review. `biasMonitor` exists for Clef and must be extended to the taste term.
- Privacy: taste weights are private. They never appear in member-facing text.

**Measure.** Per-member learning curve (AUC of P(yes) as a function of label count). Calibration error (ECE) on held-out weeks. P1's expected outcome. The oracle check: correlation of learned w with the hidden taste vector (sim only).

**Exactness.** Form unchanged: the pack term stays one directed integer in [0, 1000]. To prune, add per-bucket min/max per feature to the summary. The bound `500 + Σ_k max(w_k·min_k, w_k·max_k)` is sound by linearity.

### P4. Exact propensities and doubly robust off-policy evaluation (area: data; effort S/M; priority 3)

**What.**
1. Log, for each proposal, an exact integer propensity (per 10^6) under a declared randomized policy. The simplest exact scheme: for each member slot, with probability ε choose uniformly among the member's top-K admissible kept candidates. Otherwise take the greedy choice. Then `π(pair) = ε/K + (1−ε)·1[pair is greedy]` for the pair as seen from that slot. Record the K candidates shown to the randomizer. (Today exploration logs a documented lower bound, and greedy logs 1.)
2. Evaluate a new weight vector or order with **SNIPS** and **doubly robust** estimators (Dudík et al. 2011), with clipped weights. Use acceptance (yes/no) as the main reward because it is frequent. Use post-meeting outcomes when enough exist.
3. Use the same weights in P3 to remove selection bias in taste learning.

**Why.** Deterministic logs give no support for alternative policies. IPS divides by 0 or by a lower bound, so the estimate is biased. Exact propensities let us test weight changes on real data before shipping, which matters once real members exist.

**Risk.** Small samples: 500 members x 2 proposals a week x ε = 0.125 ≈ 125 exploratory proposals a week per city. DR estimates of a moderate effect need months. Randomness must come from the seeded RNG (code invariant). Random picks are still inside the admissible set and still go through human review, so safety is unchanged.

**Measure.** In the simulator: OPE estimate against the true value of the new policy (run both). Coverage of the CI over seeds.

**Exactness.** Admission unchanged. `selectionRun`'s exploration phase is outside the greedy theorem today, and it stays so.

### P5. Cached collaborative transfer: a centred taste-by-appeal cluster table (area: incremental; effort M; priority 5)

**What.**
1. Per lane and market, K taste clusters (actors) and K appeal clusters (partners), with K ≈ 8-16. Assign clusters from profile features with a deterministic k-medoids, or by a hash of a few coarse features. Recluster weekly. A **new member** gets clusters from features in O(K): no recomputation.
2. Table `T[i][j]` = Beta-smoothed yes rate (and, separately, good-meeting rate) of taste-cluster i members toward appeal-cluster j members, as integers.
3. **Double-centre** it: `C[i][j] = T[i][j] − rowMean_i − colMean_j + grandMean`. The column mean is the popularity of appeal cluster j, so removing it keeps only "who likes whom beyond general appeal". The row mean is selectivity (an actor effect, used in P2). Shrink C toward 0 by counts.
4. Use `C[taste(a)][appeal(b)]` as the **prior** of P3's taste model, and/or as one capped part of the pack term.

**Why.** This is the user's "if two people are similar then they might be matched to similar others" made precise and cheap. Xia et al.: interest similarity (same targets) and attractiveness similarity (same senders) beat content-based methods. Tu et al.: latent types with feature-based cold start. TinVec: co-swipe embeddings. A table is auditable and tiny (K² integers), and it updates incrementally: one count per outcome.

**Risk.**
- Clusters can encode protected attributes. Exclude them from clustering features and monitor the outputs.
- Sparse cells at small K x city size. Use shrinkage and pool across markets.
- Centring removes popularity only at the cluster level. Within-cluster popularity is not in the table at all, so it cannot leak.

**Measure.** AUC of P(yes) with and without the prior, at low label counts (cold start). Row and column sums of C are 0 (provable). P1's expected outcome.

**Exactness.** If buckets are keyed by appeal cluster (an extra segment-like key), `max_j C[i][j]` over the bucket's clusters is a sound bound. Otherwise the pack bound stays 1000. A proof obligation: "centred table rows and columns sum to 0 within rounding" is stateable in integers if centring is done on scaled counts.

### P6. Aggregation operator experiment: harmonic against product of calibrated acceptance (area: quality; effort S; priority 7)

**What.** On planted worlds and the three app worlds, compare: (a) today's harmonic value, (b) harmonic value as admission plus **product of calibrated P(yes)** as order (P2 with P3 calibration), (c) geometric, and (d) a per-member balance in the Kleinerman style. Hold everything else fixed and use P1.

**Why.** The literature says the operator matters and the best one is data-dependent. The product is the principled one for "both say yes".

**Risk.** Overfitting to the simulator's parametric form. The slop oracle uses `sqrt(e_a·e_b)` for quality and `min` for good, so a geometric or min aggregator may win in simulation for that reason alone. Report this.

**Measure.** P1 expected outcome, everyone-yes rate, lowest-quintile ratio.

**Exactness.** The product is symmetric, monotone, bounded by min, and integer. The laws `lawPairValueSymmetric`, `lawHarmonicMonotone` (as a product variant) and `lawNoOneSidedPair` carry over. The bucket bound stays sound by monotonicity.

### P7. Fix the weak friends and dating terms: proximity, schedule, repetition, and IDF-weighted affinity (area: quality; effort M; priority 6)

**What.**
1. **Friend lane.** Move weight from affinity to closeness: travel minutes between home cells, the count of shared free slots (coverage), life stage, age band and social energy as closeness dimensions. Suggested start: complement 1, affinity 3, closeness 5, pack 1 (to tune with P1).
2. **IDF-weighted affinity** for Friend and Date: tag weight `⌊log2(N/df_t)⌋` (integer, recomputed weekly per market). Coverage becomes `Σ_{t ∈ I_a ∩ I_b} idf_t / Σ_{t ∈ I_a} idf_t`. A tag held by 19% of members has weight about 2, while a niche tag held by 1% has weight about 6.
3. **Repetition**: a pack value for pairs who met and **both** rated the meeting well (the bond in the friends oracle; Hall 2018). It feeds circles and crews. It must be pair data, never a member-level "popularity".

**Why.** The friends oracle and the literature (Back 2008, Hall 2018, Festinger 1950) say proximity, schedule and repeated time drive friendships. IDF also **helps search**: rare-tag postings are short, so a high-IDF overlap gives tight bounds (the WAND principle). Our Friend searches are 22% exact at 100,000 members because common tags do not narrow.

**Risk.** Closeness on travel needs geo cells, which are private-adjacent data. Over-weighting proximity reduces diversity. Monitor the borough ratio gate (0.80 now, gate 0.7).

**Measure.** Friends AUC against the ceiling. V14 (37.3%). Repeat-meetup rate (30.5%, gate 30%). Friendship formation against random (4.0x). Exact-search rate and checks per profile at 10,000 and 100,000.

**Exactness.** The coverage term with integer weights keeps the subset-monotone bound (the weighted union bound is still sound). Closeness keeps its range bound. The form is unchanged.

### P8. Identity, orientation and partner-gender signifiers as mutual hard filters (area: signifiers; effort S/M; priority 8)

**What.** For Date: `identity = {gender: woman|man|nonbinary|self-described, trans: yes|no|undisclosed}` and `seeks = set of (gender, transOk: yes|no|either)`. Admission requires mutual inclusion, as the `orientation_mismatch` rule and the Date segment do today. Orientation (gay, bi, straight, pan, queer) is the member's own word for display and is derived for matching from gender and seeks, never inferred. An undisclosed trans status matches only partners whose seeks say "either". For Friend: an optional "friends with women / men / everyone" as a mutual filter, and an optional women-only or men-only circle. For Cofounder: Peer/Peer with the balance rule (already). For Hire: never use gender or other protected traits.

**Why.** The user asked for these. Blair and Hoskin (JSPR 36(7), 2019 [opened: listing and author summary]) found 87.5% of 958 participants excluded trans people from their hypothetical dating pool. Without an explicit, mutual filter, trans members would get many rejections: harm and wasted capacity. Explicit consent-based filters avoid outing and avoid inference.

**Risk.** Trans status is sensitive. Store it agent-private, never show it in relay or explanations without the member's consent, and never infer it from photos or text. Segment keys must not expose it in logs.

**Measure.** Rejection and block rates by group in simulation (needs persona support). Zero cross-filter proposals (a blocking gate).

**Exactness.** The filters are segments, so the window-completeness and segment proofs apply unchanged.

### P9. Uncertainty-directed exploration: Thompson sampling over taste posteriors (area: quality; effort M; priority 9)

**What.** Inside the exploration slice, instead of a novelty-weighted draw, sample each member's taste weights from the posterior of P3 (seeded RNG), rescore their admissible kept candidates, and pick the best. The propensities are computable by Monte Carlo (store them as integers) or approximated with P4's ε-uniform scheme.

**Why.** Thompson sampling is a strong exploration rule (Chapelle and Li 2011). It explores where the member's taste is uncertain, which is where learning pays.

**Risk.** It adds RNG draws, so it must stay deterministic under the seed. Propensities for Thompson sampling are not closed form.

**Measure.** Learning speed (labels needed for a target per-member AUC), regret in simulation, the exposure floor.

**Exactness.** Exploration picks are admissible pairs. The greedy theorem is untouched (exploration is outside it today).

### P10. Diversity and exposure: a concave welfare check (area: quality; effort S; priority 10)

**What.** Keep the exposure floor. Add a tracked measure of two-sided Lorenz efficiency: per-member expected outcome sorted ascending, cumulative curves per side (Do et al. 2021), and the "price of the floor" (blocking pairs across phases, D-theory 4d).

**Why.** Single-score greedy ranking concentrates exposure (Singh and Joachims 2018). Feedback loops make behaviour uniform (Chaney et al. 2018).

**Measure.** Lorenz curves, Gini (already in `policy.ts`), the lowest-quintile gate.

**Exactness.** Measurement only.

---

## 6. How the four apps differ (for weights, aggregation and outcome labels)

| App and lane | Shape | Predictable before meeting | Outcome label to learn from | Aggregation | Notes |
|---|---|---|---|---|---|
| slop Date | 1:1 peers, symmetric | Partner effect (Clef, private, band only), actor selectivity, goals, dealbreakers, logistics, age | Probe yes/no, attendance, both rate well, second date | Harmonic value; product of calibrated P(yes) as order | Chemistry dominates. Learn per-member taste. Do not predict chemistry. |
| friends Friend / circles | 1:1 and 1:many, groups 3-6 | Travel, schedule, life stage, repeated contact | Attendance, "see again", repeat meetups, hours | Harmonic for pairs; **min over pairs** for circles (least misery, as the oracle) | Repetition is the main driver (Hall). Circles should prefer people who already met well. |
| peon Hire | Two-sided, asymmetric (seat and candidate) | Skills and level coverage (verified), location, salary | Interview, offer, hire, tenure | Both must accept: product of P(yes); harmonic value is fine | Most predictable (AUC 0.92). Watch level gaps and seat congestion. |
| Cofounder (peon, ntwrk) | Peers, equals, balance required | Domain homophily, complementary skills, commitment parity, ties | Second meeting, continued work | Harmonic with balance | Ruef et al.: homophily and strong ties dominate. |
| ntwrk Intro / Mentor / Invest | Peers or two-sided with offset | Asks against offers, track record, warm ties | Meeting held, both rate useful | Harmonic; mentor offset | 88% of meetings come from requests: put the reciprocal value on `searchFor` first. |

---

## 7. What will NOT work for us, and why

1. **A global desirability score (Elo or PageRank from received likes) as a ranking reward.** It is a popularity loop (Chaney et al. 2018), Tinder publicly moved away from Elo, and it breaks our rule that standing never reads acceptance or popularity. Partner effects stay in the private parity band.
2. **Predicting dyadic chemistry from questionnaires before a meeting.** Joel et al. (2017) found zero predictable relationship variance. More questions will not fix the slop and friends AUC.
3. **Stated ideal-partner preferences as soft scoring weights.** They predict initiation poorly (Eastwick et al. 2014). Keep them as filters and weak terms.
4. **End-to-end deep models (TinVec-style embeddings, siamese image models, PJFNN) inside the proved path.** Our cities have hundreds to low thousands of members, so there is too little data. They cannot be stated in Quint or Dafny, and they are hard to audit. At most they produce offline integer features, behind a bias review.
5. **Matrix factorization (LFRR) per city at launch.** The interaction matrix is far too sparse. Cluster-level tables (P5) give most of the transfer with few parameters.
6. **IPS or DR on today's logs.** Greedy and floor picks log probability 1. Exploration logs a lower bound. Alternatives have no support. P4 must come first.
7. **Tuning weights to maximize AUC against the simulator's hidden "good pairs".** The ntwrk experiment (AUC up, meetings down) shows that this objective is wrong. It also overfits the oracle's parametric form.
8. **Replacing greedy with Gale-Shapley on individual lists.** With a symmetric score, greedy already gives the unique stable matching (D-theory 4d). DA adds value only once we learn genuinely directional preferences, and even then it costs proofs.
9. **Long OkCupid-style questionnaires to raise match quality.** The match percentage is reported not to predict outcomes (Lewis, secondary source), and it adds onboarding cost.
10. **Inferring orientation or trans status from photos or text.** Unethical, unsafe (outing), and against the agent-private data rules. Only explicit, consented self-description.
11. **Realized meeting counts on three seeds as the decision metric.** The noise (174 against 132 for a neutral change) is larger than most effects we look for. Use P1.

---

## 8. What to implement first at our scale (hundreds to low thousands per city, human review)

1. **Week 1: P1.** Ceiling AUC, expected-outcome evaluation with paired seeds, separate acceptance AUCs. Without it, no later change can be judged.
2. **Weeks 1-2: P2 plus routing `searchFor` through the pair value.** It is the largest expected gain by volume (ntwrk requests) and by the literature (receiver modelling). Keep the admission proofs unchanged and put acceptance in the symmetric order key.
3. **Week 2: P4 exact propensities.** It is cheap now and costly to add after real data exists, since data logged without propensities cannot be reused.
4. **Weeks 3-6: P3, then P5.** Per-member taste learning with cluster priors. In simulation, this attacks the `1.8·taste` term directly.
5. **In parallel: P7.** Friend weights, IDF and repetition. This improves both quality and search exactness.
6. **Later: P6, P8, P9, P10.**

With real members, the first measurements are: everyone-yes rate, attendance, both-rated-well rate, second-date rate (Date), repeat meetups (Friend), interview-to-hire (Hire). Report each per city and per lane with Wilson CIs, and the lowest-quintile and group ratios already gated.

---

## 9. Open questions for the founder and maintainers

1. May an **actor** acceptance estimate (a member's own yes rate) affect the greedy order (P2)? It is not popularity, but it is a property of one member, and the slop pack comment forbids that inside the pack value.
2. Should the simulator's partner effects (desirability, likability) be reported as "gap we accept by policy"? This decides whether a slop AUC of 0.58 is acceptable.
3. What exploration rate and propensity scheme is acceptable with human review: every exploratory pick still costs a reviewer's time?
4. Which outcome is primary per app: a held first date, both rating it well, or a second date (Date); repeat meetups or hours (Friend)?
5. Is trans status in scope for slop.date launch, with the privacy rules of P8?
6. May the taste model use image features from Clef (beyond the overall rating), given the bias risk?

---

## Sources opened during this research

- Pizzato et al., RECON, RecSys 2010: https://dblp.org/rec/conf/recsys/PizzatoRCKK10 ; https://bibtex.github.io/RecSys-2010-PizzatoRCKK.html
- Palomares et al., Information Fusion 2021, arXiv 2007.16120: https://arxiv.org/abs/2007.16120
- Neve, Palomares, RecSys 2019: https://dblp1.uni-trier.de/rec/conf/recsys/NeveP19.html ; slides https://speakerdeck.com/yuya4/latent-factor-models-and-aggregation-operators-for-collaborative-filtering-in-reciprocal-recommender-systems
- Neve, McConville, ImRec, RecSys 2020: https://research-information.bris.ac.uk/en/publications/imrec-learning-reciprocal-preferences-using-images/ ; TIRR https://arxiv.org/abs/2108.11714
- Xia et al., ASONAM 2015: https://www.aminer.cn/pub/5550415145ce0a409eb3a336/reciprocal-recommendation-system-for-online-dating ; arXiv 1501.06247
- Tu et al., WWW 2014: https://arxiv.org/abs/1401.8042 ; https://ar5iv.labs.arxiv.org/html/1401.8042
- Kleinerman et al., RecSys 2018: https://u.cs.biu.ac.il/~krauss/data/articles/recsys18a-sub1173.pdf (listing)
- Hitsch, Hortaçsu, Ariely, AER 2010: https://econpapers.repec.org/RePEc:aea:aecrev:v:100:y:2010:i:1:p:130-63
- Bruch, Newman, Science Advances 2018: https://ui.adsabs.harvard.edu/abs/2018SciA....4.9815B
- Rios, Saban, Zheng, MSOM 2023: https://ideas.repec.org/a/inm/ormsom/v25y2023i4p1304-1323.html ; https://www.informs.org/News-Room/INFORMS-Releases/News-Releases/Swipe-Left-or-Swipe-Right-New-Algorithm-Increases-Successful-Dating-Site-Matches-by-More-Than-252
- Kanoria, Saban, Management Science 2021: https://econpapers.repec.org/RePEc:inm:ormnsc:v:67:y:2021:i:10:p:5990-6029
- Halaburda, Piskorski, Yildirim, Management Science 2018: https://papers.ssrn.com/abstract=1610187
- Tinder TinVec, MLconf 2017: https://mlconf.com/?p=8768
- Hinge Most Compatible: https://techcrunch.com/?p=1668547
- OkCupid (Rudder talk): https://amara.org/en/videos/8bxZQsHqDDm0/en/66656/
- Coffee Meets Bagel: https://aws.amazon.com/blogs/database/powering-recommendation-models-using-amazon-elasticache-for-redis-at-coffee-meets-bagel ; https://hasgeek.com/fifthelephant/2017/sub/a-recommender-for-match-making-item-based-cf-pager-953Tgm82MVEC11kp88YGA
- Kenthapadi et al., RecSys 2017: https://dblp.uni-trier.de/rec/conf/recsys/KenthapadiLV17.html
- Zhu et al., PJFNN: https://arxiv.org/abs/1810.04040
- Singh, Joachims, KDD 2018: https://arxiv.org/abs/1802.07281
- Do et al., NeurIPS 2021: https://arxiv.org/abs/2110.15781
- Su, Bayoumi, Joachims, WWW 2022: https://arxiv.org/abs/2106.01941
- Chaney, Stewart, Engelhardt, RecSys 2018: https://arxiv.org/abs/1710.11214
- Dudík, Langford, Li, ICML 2011: https://arxiv.org/abs/1103.4601 ; Statistical Science 2014: https://arxiv.org/abs/1503.02834
- Chapelle, Li, NeurIPS 2011: https://papers.nips.cc/paper/2011/hash/e53a0a2978c28872a4505bdb51db06dc-Abstract.html
- Joel, Eastwick, Finkel, Psychological Science 2017: https://www.psychologicalscience.org/journals/psychological-science/0956797617714580/
- Eastwick, Hunt, JPSP 2014: https://pubmed.ncbi.nlm.nih.gov/24611897/
- Eastwick, Luchies, Finkel, Hunt, Psychological Bulletin 2014: https://pubmed.ncbi.nlm.nih.gov/24588091/
- Montoya, Horton, Kirchner, JSPR 2008: https://researchportal.murdoch.edu.au/esploro/outputs/journalArticle/Is-actual-similarity-necessary-for-attraction/991005635870107891
- Joel et al., PNAS 2020: https://socialinteractionlab.psych.umn.edu/sites/socialinteractionlab.psych.umn.edu/files/2020-12/joel_et_al._pnas_2020.pdf
- Huang et al., JPSP 2017: https://dash.harvard.edu/handle/1/35647952
- Back, Schmukle, Egloff, Psychological Science 2008 (press release only): https://www.sciencedaily.com/releases/2008/06/080602163842.htm
- Hall, JSPR 2018 (press coverage): https://news.ku.edu/news/article/2018/03/06/study-reveals-number-hours-it-takes-make-friend
- Kristof-Brown, Zimmerman, Johnson, Personnel Psychology 2005: https://iro.uiowa.edu/esploro/outputs/journalArticle/CONSEQUENCES-OF-INDIVIDUALS-FIT-AT-WORK/9984380518202771
- Ruef, Aldrich, Carter, ASR 2003: https://scholars.duke.edu/publication/1619740
- Blair, Hoskin, JSPR 2019: https://cambridgeblog.org/2019/06/who-will-date-a-trans-person/

Code read (our repository): `spec/pairValue.md`; `docs/results/2026-11-17-matching-engine-migration.md`; `packages/engine/src/packs/slop/score.ts`; `packages/engine/src/packs/slop/generators.ts`; `packages/engine/src/policy.ts`; `packages/engine/src/config.ts`; `packages/sim/src/apps/slop/oracle.ts`; `packages/sim/src/apps/slop/baselines.ts`; `packages/sim/src/apps/friends/oracle.ts`.
