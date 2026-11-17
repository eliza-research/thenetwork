# R9. Test data quality: the simulator, the oracles and the planted worlds

Worktree read: /Users/nubs/thenetwork-matching at 3f0f8586 (read-only). Nothing in the repository was run except one throwaway script that only generates populations and prints statistics:
`(scratchpad)/research2/popstats.ts` (output: `popstats.out` in the same folder; about 10 s, no simulation, no model call). The seed-variance numbers come from the previous agent's saved nine-seed arm files under `(scratchpad)/pv2/`.

Labels: "measured" = from my script or the saved arm files; "code" = read in the file and line given; "[unverified]" = recalled from memory, not opened in this session.

---

## 0. The ten findings that matter most

1. **Pinned seeds do not pair the arms.** On the same seed, two engine arms share almost no random draws after the first proposals. Measured on nine seeds of the network block: correlation of meetings between the base arm and a neutral arm is -0.32 (exp arm 0.37, v1 arm 0.10). Only 7% to 16% of the meetings in one arm are between the same people as in the other arm. The famous "174 to 132" is the neutral arm on seeds 1 to 3; on seeds 4 to 9 the same neutral change gained 27 meetings. Over nine seeds the neutral arm is -1.7 meetings per seed (t = -0.44). Cause: the worlds key their coin flips on trajectory-dependent identifiers (proposal index, message id), not on the people and the week. Peon is the exception: it already keys draws on (candidate, job).
2. **Minimum detectable effect today.** Paired SD of the per-seed difference is 11.5 meetings (mean 53). With 3 seeds the smallest effect a test can find (alpha 0.05, power 0.8) is about 18.5 meetings per seed (35%); 9 seeds 20%; 40 seeds 9.5%; 100 seeds 6%. Common random numbers (CRN) should cut the paired SD several-fold (Section 3).
3. **The network "meetings > 140" gate is a coin with a 6% to 10% chance of failing a change that does nothing.** The base arm's 3-seed pooled sum has mean 159 and SD about 12; the neutral arm scored 132 on the pinned seeds and would have failed it.
4. **The slop ranking ceiling is not chemistry.** On 1,500 stated-feasible NYC pairs (measured), the oracle's own pre-meeting quantities (everything but chemistry and night noise) rank realized good dates at AUC 0.963. A stated-profile proxy reaches 0.59, minimum desirability 0.555. The migration report's explanation ("the simulated chemistry is not visible before a meeting") is true for friends but wrong for slop. The missing slop signal is the hidden taste x traits term (coefficient 1.8, the largest in the latent) and hidden dealbreaker compatibility. Stated "type" is generated at r = 0.35 with revealed taste (persona.ts:313-315). In the simulator this is learnable from behaviour (revealed preference, collaborative filtering). Joel, Eastwick & Finkel (2017) found that in real speed dating the pair-specific part of desire was not predictable from 100+ self-reported traits. So the simulator may reward taste learning more than reality will. This needs a knob, not a belief.
5. **Friends: the partner hardly matters in the truth.** Measured: in the friends oracle, the variance of the systematic pair term (similarity plus likability) is 8.9% of the pair latent; symmetric chemistry is the other 91%. Most of the systematic enjoyment is member x activity (activity like, weight 2.0), travel, group size and energy balance, and the repetition bond (Hall hours), none of which is a pair feature. A higher friends pair-value AUC can only buy a little; the gains are in activity choice, logistics and repeats.
6. **Planted worlds are too easy, and circular.** Measured at n = 1,000: for Intro, Date and Hire the planted vocabulary has 432 tags with a median of 8 holders each, and half of a tag's holders sit in one circle (tags fingerprint circles). Observed standing correlates 0.981 with hidden standing. Pairs inside a circle reach truth >= 500 in 64% (Intro), 97% (Date), 36% (Hire) of cases; random pairs in 0.2%. The planted utility is literally interest overlap plus seek/offer coverage plus a same-circle bonus minus a standing gap (planted.ts:485-495): the same constructs the engine scores. ARI 0.87 and standing correlation 0.82-0.93 show the engine reads tags; they do not show it can find good pairs that tags do not announce.
7. **Signifiers that the user asked about are missing from the truth.** Friends personas have no gender at all, so no "friends with women, men or both". Slop has trans identities (1.7% of adults) but no preference about trans partners, and the oracle ignores trans status; real survey data (Blair & Hoskin 2019) says 87.5% of respondents excluded trans people from their hypothetical dating pool. No world has cofounders except the engine-only planted Cofounder lane. Peon has no candidate-side preference over employers beyond pay, mode, family and brand appeal.
8. **The friends tag vocabulary is flat, which explains the search cost.** Measured: 31 activities map to 42 tags; a member holds 7.6 tags on average; mean tag share 18% (max 53% for the dinner and coffee "universal" tags, which half the members add); 70% of random pairs share at least one tag. Real interest popularity is long-tailed; the simulator's is almost uniform (Gini 0.27 to 0.32). Posting lists cannot narrow a flat vocabulary.
9. **Small pools are real and matter.** Measured in slop: median stated-feasible degree is 20 to 39 for straight members but 2 to 6 for gay men, lesbians and nonbinary members (300 per city). This is realistic (pools are small) and it is exactly where exactness is cheap and fairness is fragile.
10. **Expected-value evaluation is available and underused.** The slop oracle already computes soft labels by Monte Carlo over chemistry (oracle.ts:161-171). Scoring proposal sets by their oracle-expected outcome (not one sampled trajectory) removes the chemistry and behaviour noise from engine comparisons and makes most quality comparisons deterministic.

---

## 1. Population realism, per world (measured unless stated)

### 1.1 slop.date (seed 13, 300 per city x 3 cities; packages/sim/src/apps/slop/persona.ts)

| Attribute | Simulator | Public reference | Effect on matching conclusions |
|---|---|---|---|
| Age (adults) | mean 33, median 32; 18-24 17%, 25-34 50%, 35-44 21%, 45-54 8%, 55+ 4.5%. Drawn 70% N(30, 5.5) and 30% uniform 18-60 (persona.ts:156-158) | Pew 2023: about 3 in 10 US adults have ever used a dating site or app; use is highest under 30 ([Pew 2023](https://www.pewresearch.org/internet/2023/02/02/the-who-where-and-why-of-online-dating-in-the-u-s/)) | Plausible for a young app. Age-gap preferences are asymmetric by gender (persona.ts:185-188, after Bruch & Newman), good. |
| Gender | man 48.4%, woman 48.4%, nonbinary 3.2% | | Real apps skew male (often reported 60%+ men on mainstream apps [unverified]). A balanced ratio hides the scarcity side of the market: the exposure and low-quintile gates would behave differently with 1.5 men per woman. |
| Identity | cis 95%, trans women 0.9%, trans men 0.8%, nonbinary/genderqueer/agender 3.3% | Gallup 2024-2025: 9.3% then about 9% of US adults LGBTQ+; transgender a little over 1% [Gallup via news reports, see sources] | Trans share is plausible. But nothing reads it: `seeks` is over coarse match gender only and the oracle ignores trans status. |
| Orientation | straight 80%, bisexual 6.8%, gay 5.7%, lesbian 3.9%, queer 1.9%, pansexual 1.7% | Gallup: bisexual is 58.6% of LGBTQ+ adults (5.3% of all adults); 23% of Gen Z adults LGBTQ+; 8% of Gen Z men bisexual ([Gallup 2025 summaries](https://www.advocate.com/news/lgbtq-population-9-percent-2025), [Axios](https://www.axios.com/2025/02/20/lgbtq-adults-percentage-grows-survey)). Pew: 51% of LGB adults have used dating apps vs 28% of straight adults ([Pew 2023](https://www.pewresearch.org/short-reads/2023/06/26/about-half-of-lesbian-gay-and-bisexual-adults-have-used-online-dating/)) | 20% non-straight is reasonable for an app population (LGB adults over-represented among users). Male bisexuality (5%) is low against Gen Z (8%), and bi members always seek both genders symmetrically; real bi members often weight genders unequally. |
| Seeks set | man 44%, woman 43%, all 6.3%, man+woman 4.2%, nonbinary+woman 1.7% | | No "open to trans partners" field; no "women only, cis only" vs "women including trans women". |
| Goal | long-term 43%, unsure 31%, casual 25% | | Fine. |
| Interests | 3-6 from the 38-tag network vocabulary | | Thin and uniform; interests barely move the oracle (compat x 0.88 to 1). |
| Dealbreakers | mean 1.29 stated; 85% of true ones stated plus 30% chance of one soft stated (persona.ts:321-323) | | Good honesty model. Hard filters vs soft costs is testable. |
| Desirability (hidden) | N(0,1) plus age curve plus 0.8 for scammers and catfish | Bruch & Newman 2018: a consistent desirability hierarchy; people message partners about 25% more desirable than themselves ([Sci. Adv. 4:eaap9815](https://pmc.ncbi.nlm.nih.gov/articles/PMC6082652)) | The hierarchy exists. But the photo ratings that the engine sees are desirability plus noise (snapshot.ts:125-139): appearance taste is entirely consensus in the simulator. Hönekopp (2006) found private taste about as large as shared taste in facial attractiveness ([JEP:HPP 32:199](https://researchportal.northumbria.ac.uk/en/publications/once-more-is-beauty-in-the-eye-of-the-beholder-relative-contribut/)). So the simulator overstates how much a single Clef score predicts a specific person's attraction. |
| Adversaries | not-single 3%, harasser 1.7%, catfish 1.7%, age liar 1.7%, scammer 1%, honest minor 2.3% | | Fine for safety gates; no strategic misreport by honest members. |
| Density | stated-mutual pairs 7% to 11% of all pairs per city; 1% to 2% of members have no feasible partner | | At 300 per city a member has 16-30 feasible partners; real cities have thousands. Scale results come only from planted worlds. |
| Feasible degree by group (NYC) | straight women 29, straight men 39, bi women 29, lesbians 6, gay men 4 | | Realistic shape. With 12 to 18 gay men per city, any per-group gate is noisy; metrics.ts:114 requires n >= 15 pooled. |

### 1.2 friends.help (seed 5, n = 400 and 4,000; apps/friends/persona.ts)

| Attribute | Simulator | Note |
|---|---|---|
| Gender | **absent** | No gender, no gender preference, no women-only crews. McPherson, Smith-Lovin & Cook (2001) review gender homophily in friendship as real but weaker than race and age ([Ann. Rev. Sociol. 27:415](https://sil.asc.upenn.edu/files/McPherson-2001-ARS.pdf)). A women-only preference is common in friend-finding products [unverified]; it is a hard filter the engine must honour. |
| Age | real adults mean 34, median 32 | Age closeness only enters `sim` at -0.012 per year (oracle.ts:90). No stated age preference. |
| Life stage | established 39%, early career 30%, parent 21%, student 7%, retired 3% | |
| Group preference | either 49%, group 28%, one-to-one 23% | 1:many is modelled in the oracle (size discomfort, energy balance). |
| Loves | 2-6 per member, mean 4.5; stated 4.5 activities | |
| Vocabulary | 31 activities, 42 tags, 1.68 tags per activity; 7.6 tags per member; tag share mean 18%, median 13%, max 53%, min 7%; Gini 0.32 (0.27 at n = 4,000) | Flat. 70% of random pairs share a tag; 61% share an activity. This, not the engine, makes tag postings useless for Friend. |
| Travel tolerance | 20-60 min stated | ACS mean one-way commute is about 27 min nationally, longer in NYC [unverified]. |
| Adversaries | romance seekers 3.8%, bots 1.5%, age liars 1.5%, harassers 0.8%, MLM 0.5% | |

### 1.3 peon.biz (seed 13, 400 candidates and 80 jobs per city; apps/peon/persona.ts)

| Attribute | Simulator | Note |
|---|---|---|
| Candidate seniority 1-5 | 25%, 29%, 29%, 13%, 5% | Jobs: 18%, 35%, 30%, 16%, 0.6%. Level-5 candidates have almost no jobs: a parity rule will starve them. |
| Stated - true seniority | 0: 83%, +1: 10%, +2: 4%, -1: 3% | |
| Claimed - true skill | 0: 59%, +1: 18%, +2: 10%, +3: 8%, -1: 4% | Resume inflation is modelled (code comment cites hiring research). |
| Candidates per job | 5.0 | Real postings draw far more applicants; the ratio sets how much the employer side is the scarce side. |
| Companies | 80: 54 normal, 17 ghosting, 7 discriminatory, 2 scam | |
| Sealed attributes | sex, race, age, disability, caregiver, with realistic proxies | Strong adverse-impact audit design. |
| Cofounders | **absent** | Peon has only employer seat and candidate. |

### 1.4 ntwrk core generator (seed 1, n = 250; packages/sim/src/generator.ts)

Gender woman 49%, man 44%, nonbinary 6%. Eight archetypes. Interests: 3-7 from 38 tags (holder share max 27%, median 12%, Gini 0.12: flat). Skills 0-3 (mean 1.2). Desires 1-3 from 20 ids: new friends 23%, dating 20%, moving help 16%, parent friends 8%; "meet founders" 1.6%, no cofounder desire. Romance: binary members seek the other binary gender 80%, own 12%, all 8%; no "both men and women" option for a binary member except "all".

### 1.5 Where unrealism changes a matching conclusion

- **Balanced gender ratios** hide the scarcity side; exposure-floor and parity results may flip in a 60/40 market.
- **Consensus-only appearance** makes a Clef consensus score look like a strong pair predictor in the simulator; in reality it predicts popularity (partner effect), not a specific pair (Hönekopp; Joel et al.).
- **Flat interest vocabularies** make every tag-index method look useless for Friend and Date, while real long-tail vocabularies would give rare tags with strong signal and very common tags with none. The engine should be tested on both.
- **No gender in friends, no trans openness in slop, no cofounders**: the engine cannot be shown to respect those constraints, and a regression would not be seen.
- **Small populations** (300-400 per market) mean exactness and per-group fairness are only tested where search is cheap.

---

## 2. The hidden truth: what each oracle rewards

### 2.1 Summary table

| World | Good outcome | Observable part | Unobservable part | Two-sided? | Value parity in truth? | Groups in truth? |
|---|---|---|---|---|---|---|
| slop (apps/slop/oracle.ts) | good date: min(e_a, e_b) >= 0.4; second date both >= 0.5 | stated filters, dealbreakers (85% stated), goal, coarse interests, Clef-like rating (desirability + noise) | taste x traits (wTaste 1.8; stated type r 0.35), warmth, selectivity, chemistry SD 0.9 logit, side noise 0.35 | yes, min over sides | implicit: everyone likes high D, high D is pickier (wSelect 0.4) | no |
| friends (apps/friends/oracle.ts) | meetup good when min real e >= 0.45; friendship by Hall hours (50/90/200) | stated activities (85% of loves), neighbourhood, slots, energy bucket, group pref, life stage | likes per activity, chemistry SD 0.55 (91% of the pair latent), likability, warmth, flakiness | per attendee (least misery) | weak: likability | yes: energy balance, size discomfort, bond with repetition, self-arranged hangouts |
| peon (apps/peon/oracle.ts) | hire, 90-day retention, quality of hire | claimed skills (inflated), stated seniority, pay floor (noisy), modes, areas, credentials | true skills, pair fit SD 0.45, interview noise, appeal, bar shift | yes: candidate interest, employer yes, offer, accept | yes: seniority gap -0.45 per level in quality, senStep in interest | no |
| ntwrk (packages/sim/src/oracle.ts) | pair min enjoyment >= 0.55; group mean >= 0.55 and min >= 0.4 | stated interests (honesty noise), desires, skills | complementarity strengths, actor effect, chemistry SD 0.13 | yes (min) | none | weak (mean/min) |
| planted (packages/sim/src/planted.ts) | min directed utility | the topic tags, offers, seeks and evidence facets themselves | only standing noise (SD 10/6/4/3 by reviewed count) | yes (min) | yes: 10 per point beyond 5 | circles only (disjoint) |

### 2.2 How much is observable (measured ceilings)

- **slop**: AUC against the realized good-date label on 1,500 feasible NYC pairs (base rate 12.1%): hidden pre-meeting pGood 0.963; hidden perceived attraction x compatibility (min over sides) 0.946; min desirability 0.555; a stated proxy (shared stated interests, same stated goal, stated type x self description both ways) 0.592. pGood is bimodal: median 0, 90th percentile 0.55. So the slop truth is mostly deterministic given hidden truth, and the hidden part is mostly the taste dot product. The engine's 0.58 is close to what stated data allows. The upside is behavioural: the agent learns revealed taste from who a member says yes to and how dates go.
- **friends**: on random real pairs, the systematic pair term explains 8.9% of the pair latent variance. For a synthetic label "pair latent > 0.25" (base 32%), the systematic part gives AUC 0.656, chemistry alone 0.969, a stated proxy 0.628. This agrees with the 0.79 chemistry-only ceiling quoted for the full meetup outcome (that number includes activity and logistics). Friends pair AUC of 0.60 is near its stated ceiling.
- **peon**: the truth is dominated by skill margin and seniority gap, both visible through (inflated) claims and evidence; pair fit is a small SD 0.45 logit term. AUC 0.92 is expected and partly circular (Section 2.3).
- **ntwrk Intro**: AUC 0.56 to 0.73 depending on extraction; and 88% of meetings come from member requests, which do not read the lane vectors. So ntwrk Intro AUC is a weak lever on the block outcome; that is why the 0.73 AUC experiment lost meetings (174 to 150, which is inside the noise measured in Section 3).

### 2.3 Circularity and overfitting risks

- **Planted worlds** (strongest): truth = overlap of topic tags + coverage of seeks by offers + same-circle bonus - standing gap; the engine's complement and affinity terms compute the same quantities from the same facets. Tuning engine weights on planted AUC or ARI tunes the engine to the generator. Use planted worlds for exactness, cost and invariants; never for weight tuning.
- **peon**: the employer-yes model reads claimed must-have coverage and stated seniority (oracle.ts:84-96), the same features the pack scores. "Interviews per hire" is partly the oracle agreeing with itself.
- **slop**: desirability enters the truth twice (attraction of the other side and selectivity of one's own side), and the simulated Clef rating is desirability plus noise. Any engine that sorts by the rating gets assortative structure "for free" in the simulator. In reality, Clef's consensus score is only half of attraction (Hönekopp) and the pair part is not predictable before meeting (Joel et al.).
- **friends**: least circular; the truth rewards activity fit and logistics that the pack also uses, but chemistry dominates.

### 2.4 Nuances absent from the truth

- Orientation and gender: slop and ntwrk honour seeks; nothing models bi members with unequal weights, trans openness, or "cis only" vs "including trans" seekers. Friends has no gender.
- Value parity: present in slop (implicit), peon (seniority), planted (explicit); absent in ntwrk and friends (likability only). "Famous investor with a first-time founder" exists nowhere except planted Mentor/Invest offsets.
- Value in both directions: present as min-over-sides everywhere. But no world models directed resentment (one side gets much less than they give) beyond the planted exchange term.
- Groups: friends only. No hub or connector effect on group success, no triadic closure, no "crew drift".
- Similar people like similar people: slop taste vectors are independent per member; there is no taste cluster. So the user's "if two people are similar they might be matched to similar others" cannot pay off in the simulator unless taste clusters are planted.

---

## 3. Statistical power and evaluation design

### 3.1 Measured variance (network block, nine seeds, saved arm files)

| Arm | Meetings per seed (mean, SD) | Mean paired diff vs base | SD of paired diff | t | corr(base, arm) on same seed | Same-participant meetings / base meetings |
|---|---|---|---|---|---|---|
| base | 53.1, 7.2 (CV 0.135) | | | | | |
| nul (neutral change) | 51.4, 6.9 | -1.7 | 11.5 | -0.44 | -0.32 | 15.7% |
| exp | 49.7, 5.8 | -3.4 | 7.4 | -1.40 | 0.37 | 7.3% |
| v1 | 52.9, 7.6 | -0.2 | 9.9 | -0.07 | 0.10 | 9.0% |

The paired SD (11.5) is larger than the unpaired SD x sqrt(2) (10.2): pairing on a seed currently gives no variance reduction at all.

Minimum detectable effect, paired, alpha 0.05 two-sided, power 0.8 (z approx 2.8), at today's SD of 11.5: 3 seeds 18.5 per seed (35%); 9 seeds 10.7 (20%); 20 seeds 7.2 (13.5%); 40 seeds 5.1 (9.5%); 100 seeds 3.2 (6%).

### 3.2 Why the arms decouple (code)

- friends world: flow key `w${week}:${idx}:${pr.kind}` (apps/friends/world.ts:141); every reply, attendance, back-out, enjoyment noise, see-again and report draw is keyed by it (oracle.ts `u(...)` calls with `key`). A changed proposal order changes every member's coin.
- slop world: flow key `w${week}:${i}:${first}:${partner}` (apps/slop/world.ts:191) contains the proposal index i; behaviour draws (behavior.ts:30) key on it.
- ntwrk oracle: `decisionKey` uses the proposal id unless `stableDecisions` is on (packages/sim/src/oracle.ts:234-238). No sim block or harness sets `stableDecisions` (grep found no caller in scripts/sim or packages/network/harness).
- ntwrk persona policy: the persona RNG is forked on the inbound message id (`personaCtx(p, msg.id)`, world.ts:240 and 411). Message ids depend on how many messages the network sent before.
- peon world: draws key on (candidate, job) or (candidate, week) (peon/world.ts:235-383). This is already CRN-correct, which is consistent with peon's stable gates.
- Pair chemistry is keyed by the sorted pair in all worlds (good).

### 3.3 Design recommendations

1. **Common random numbers by meaning.** Key every member decision on (seed, member, counterpart set sorted, activity or category, week, attempt number for that same tuple), never on a proposal index or message id. The same person asked about the same people in the same week answers the same way in both arms. This is the standard CRN technique of simulation output analysis (Law & Kelton, Simulation Modeling and Analysis [unverified]). Expected effect: corr(base, arm) from about 0 to well above 0.5 and a paired SD several times smaller; validate with an A/A test (the same engine twice with a shuffled tie-break must give a paired SD near 0 for outcome metrics that do not depend on order).
2. **Expected-value scoring (the strongest variance cut).** For each proposal set, compute the oracle-expected outcome (slop `softLabel` already exists, oracle.ts:161; add friends and ntwrk equivalents) with fixed Monte Carlo draws per pair. This removes chemistry, reply and show-up noise from engine comparisons. Keep full trajectories for safety and end-to-end gates.
3. **Two layers of gates.** Engine-layer metrics on a fixed snapshot (exactness, pair checks, AUC against soft labels, expected welfare, parity, reciprocity) are deterministic: one structural seed set, many populations. Outcome-layer metrics (meetings, V14, repeat rate) get CRN, paired tests and confidence intervals.
4. **Report intervals and gate on bounds.** In scripts/sim/gate.ts add a paired-difference helper that prints mean, SD and a t interval over seeds. Gate a change on non-inferiority: the lower 95% bound of (new - old) above -margin.
5. **Sequential seeds.** Start at 3 seeds; add seeds until the interval excludes the margin or a cap (for example 20) is reached. Group-sequential or always-valid tests (mSPRT, Johari et al. [unverified]) keep the error rate honest when peeking.
6. **Control variates.** Regress the outcome on pre-run covariates that the engine cannot change (number of stated-feasible pairs, count of adversaries, minors, members with any free slot) as in CUPED ([Deng, Xu, Kohavi & Walker, WSDM 2013](https://exp-platform.com/cuped/)). In a simulator the "pre-period" is the generated population, so the covariates are exact.
7. **Gates too close to their thresholds to inform:** network meetings > 140 (base pooled mean about 159, SD about 12 over 3 seeds; P(fail | no change) roughly 6%; the neutral arm scored 132); friends repeat-meetup 30.5% vs 30% gate (0.5 point margin); friends harm 0.48x vs 0.5x; peon interviews per hire 0.75x vs 0.75x (held-out failed by 0.0004, docs/results/2026-10-08-peon-pack.md as cited in F-validation). Each needs either CRN plus more seeds or a non-inferiority form.

---

## 4. Planted worlds: what they plant and how to grade difficulty

### 4.1 What they plant today (code and measured)

Disjoint circles of 3-6 in each market, 10% of eligible members outside every circle; 4 topics per circle; each interest from the circle's topics with p = 0.8; vocabulary size max(48, n x 4 / 9), so each topic belongs to about two circles; standing per circle uniform 0..100 with spread SD 4; observed standing with SD 10 (newcomer, 15%), 6, 4 or 3; offers and seeks rotate over a circle skill pool; Date circles share one ZIP, the age window covers every circle mate, and 70% of members live in the circle's area (planted.ts:355, 417-420). Measured at n = 1,000: tag-to-circle purity median 0.50 (Intro, Date, Hire), 0.07 (Friend, which uses the 42 real activity tags); corr(observed, hidden standing) 0.981; in-circle pairs >= 500 truth 64% / 97% / 36% vs 0.2% for random pairs; random-pair mean truth 1 to 31 of 1,000.

### 4.2 Why that is too easy

Tags, area, ZIP and age window all announce the circle; standing is almost observed; and nothing outside a circle is good, so finding the circle is the whole task. A real market has a continuous gradient of good pairs, popular hubs, overlapping groups, missing profiles and liars.

### 4.3 A graded-difficulty ladder (one `difficulty` option on PlantedWorldOptions)

| Knob | Today | Harder rungs | Literature |
|---|---|---|---|
| Tag specificity | about 2 circles per tag | vocabulary fixed (for example 60 tags) regardless of n; Zipf popularity exponent 0.8 to 1.2 | LFR benchmark: power-law degrees and community sizes, mixing parameter mu ([Lancichinetti, Fortunato & Radicchi 2008, arXiv:0805.4770](https://arxiv.org/abs/0805.4770)) |
| Purity (mixing) | 0.8 | 0.6, 0.4, 0.25 | LFR mu |
| Overlap | none | each member in 1-3 circles | LFR overlapping extension ([arXiv:0904.3940](https://arxiv.org/abs/0904.3940)) |
| Circle sizes | uniform 3-6 | power-law 3-30 plus crews of 3-6 inside them | LFR |
| Hubs | none | 2% connectors with 5x the circle memberships | |
| Gradient | same-circle bonus 200, nothing else | utility from hidden topic affinity (dot product of hidden topic weights), so cross-circle good pairs exist; bonus 0-100 | |
| Leaks | ZIP, area, age window tied to circle | turn each leak off | |
| Standing noise | SD 10/6/4/3 | SD 25/15/10/6; 30% newcomers | |
| Missing data | none | drop facets by richness tier (minimal 15% to very rich 10%, as the app worlds do) | |
| Liars | none | 5% inflate evidence by 20 points; 5% state tags they do not hold | |
| Hidden taste | none | taste clusters: members of a taste cluster rate the same hidden traits highly (tests "similar people like similar others") | |

Report every quality metric as a curve over the rungs, next to the brute-force reference and a random baseline. A good engine degrades smoothly; a generator-fitted engine falls off a cliff.

### 4.4 Planted worlds for the new signifiers

- **Orientation pools**: replace `datePools` (planted.ts:168-178) with a pool table: straight, gay, lesbian, bi with unequal weights (for example 70/30), pan, and nonbinary-seeking; trans status (about 1-2%) and a per-seeker `trans: open | not_open | only` (base rates: Blair & Hoskin 2019 report 87.5% of 958 respondents excluded trans and nonbinary people from their pool, [JSPR 36:2074](https://www.psychologytoday.com/us/blog/inclusive-insight/201906/are-trans-people-excluded-from-the-world-of-dating)). Gate: 0 pairs that violate either side's stated gender, orientation or trans setting, and per-pool exactness.
- **Friendship gender preference**: `friendsWith: women | men | any` and an optional "women-only crews" setting. Gate: 0 crew or pair violations; V14 per preference group within 0.7x of overall.
- **Cofounders**: a Peer lane with complementary roles (technical and business), equal standing band (no offset), and conflicting needs (both want to be CEO). Truth: exchange in both directions and small standing gap. Gate: both directed utilities at the floor, standing gap in the band, and no employer-employee pairing in the Cofounder lane.

---

## 5. Other data: real or public datasets, licences, ethics, LLM personas

| Dataset | What it gives | Size | Licence and ethics | Use for us |
|---|---|---|---|---|
| Columbia speed dating (Fisman, Iyengar, Kamenica & Simonson, QJE 121:673, 2006) | per-date yes/no both sides, pre-date preferences, partner ratings | 8,378 rows ([OpenML 40536](https://api.openml.org/d/40536/json); [Columbia page](https://business.columbia.edu/faculty/research/gender-differences-mate-selection-evidence-speed-dating-experiment)) | licence on the mirrors not stated; academic research use; 2002-2004 graduate students, not representative | offline reciprocal ranking test: does pairValue (both directions, harmonic) rank mutual matches above one-sided ones; actor vs partner vs pair effects |
| Joel, Eastwick & Finkel 2017 (Psych. Sci. 28:1478) data and R code | 100+ traits and preferences before speed dates; random forests predict actor and partner variance but not relationship variance | two samples | public on the UK Data Service ([reshare 852716](https://reshare.ukdataservice.ac.uk/852716)) and OSF | calibrate the simulator's dyadic-predictable share; a hard sanity check against over-claiming pair prediction |
| LibimSeTi (Brozovsky & Petricek 2007, [arXiv:cs/0703042](https://arxiv.org/abs/cs/0703042)) | 17,359,346 ratings of 168,791 profiles by 135,359 raters (April 2006 dump), user gender | large | research-only use restriction ([Netzschleuder](https://networks.skewed.de/net/libimseti)) | realistic heavy-tailed popularity for the scale benchmark; desirability hierarchy and exposure concentration; cold start. Ratings are one-sided, so only partner effects. |
| XING RecSys Challenge 2017 | job cold-start interactions, 1.5M users, 1.3M items | large | given to challenge participants under a non-redistribution clause; not openly available ([recsys.acm.org](https://recsys.acm.org/recsys17/challenge/)) | not usable unless we already hold it |
| CareerBuilder Kaggle job recommendation (2012) [unverified] | applications | | Kaggle competition terms [unverified] | possible two-sided job matching check |
| OkCupid 2016 scraped profiles [unverified] | profiles and answers | | scraped without consent and widely criticised [unverified] | do not use |

**LLM personas.** Useful for text realism (onboarding extraction, reply parsing, paraphrases: the repo already does this in evals/ and the paraphrase agent). Not useful as preference ground truth: silicon samples compress variance and homogenize, and their answers are weak signals of the latent traits they are told to have ([arXiv:2405.07248](https://arxiv.org/abs/2405.07248v1); [arXiv:2503.16527](https://arxiv.org/html/2503.16527v1)). The simulator already keeps decisions in a calibrated choice model and lets the LLM write words only (packages/sim/README.md), which is the right split. Keep it.

---

## 6. Prioritized improvements (file, change, measurement)

1. **CRN keys** (benchmark; M). apps/friends/world.ts:141 and every `key` use; apps/slop/world.ts:191 and behavior.ts; packages/sim/src/oracle.ts:234-238 (make the meaning-keyed form the default for comparisons); packages/sim/src/world.ts:240 and 411 (fork the persona RNG on the semantic content of the message, not its id). Measure: an A/A arm (tie-break shuffle) gives paired SD of meetings below 3 per seed (today 11.5) and corr(base, arm) above 0.8 (today -0.3 to 0.4).
2. **Expected-value engine metrics** (benchmark; M). New pure functions next to each oracle: expected outcome of a proposal set with fixed Monte Carlo draws per pair; AUC against soft labels. Wire into scripts/sim/matching.ts and the app blocks as tracked metrics. Measure: identical value across runs of the same engine; the null arm shows 0 difference.
3. **Interval reporting and non-inferiority gates** (benchmark; S). scripts/sim/gate.ts helper; restate network MEETINGS_MIN (scripts/sim/network.ts:36), friends repeat and harm, peon interviews per hire. Measure: P(false fail) under A/A below 2% by resampling saved arms.
4. **Planted difficulty ladder and de-leaking** (data; M). packages/sim/src/planted.ts: knobs in Section 4.3; keep today's settings as rung 0. Measure: rung 0 reproduces ARI 0.87; harder rungs give curves; exactness against brute force stays 100% on closed searches at every rung.
5. **Signifiers in the truth** (signifiers; M). slop persona.ts `drawGender`: trans openness and unequal bi weights; slop oracle.ts `latent`: penalty or hard 0 when a stated setting is violated; friends persona.ts: gender and `friendsWith`; friends oracle: optional same-gender comfort term; planted.ts: pool table and Cofounder roles. Measure: blocking 0-violation gates per stated setting; per-group V14 or date rates.
6. **Dyadic predictability knob for slop** (quality; M). ORACLE_PARAMS: split the taste term into a planted taste-cluster part (learnable from behaviour) and chemistry, with the share as a parameter calibrated against Joel et al. (default low). Add revealed-preference signals to the snapshot (yes/no on probes with photos, date feedback). Measure: engine AUC vs soft labels as a function of interaction history and of the knob; an engine change must win at the low (Joel-calibrated) setting, not only at the high one.
7. **Friends evaluation that matches its truth** (quality; S). Track expected meetup enjoyment from activity like, travel and size, and repeat formation, rather than pair AUC. Measure: correlation of the tracked metric with V14 across seeds.
8. **Realistic popularity at scale** (benchmark; M). planted.ts option: Zipf tag popularity and a LibimSeTi-shaped attention distribution for the 10k and 100k cost runs. Measure: pair checks per profile and exact share under realistic skew, next to today's flat numbers (Friend 472 checks, 22% exact at 100k).
9. **Gender ratio and market-size arms** (data; S). slop SlopGenOptions: gender ratio (for example 60/40) and perCity 1,000 to 3,000. Measure: low-quintile and per-group gates under skew.
10. **Offline real-data checks** (data; M). A script outside packages/network that loads the speed dating and Joel data (licence permitting) and scores reciprocal ranking with the pairValue formula. Measure: AUC of mutual yes, and actor/partner/pair variance explained, against published values.
11. **Honest-member strategic misreport** (safety; S). Planted liars and inflated evidence (Section 4.3). Measure: share of liars that win pairs above their true standing band.
12. **Cofounder world in peon or ntwrk** (signifiers; M). Equals with complementary skills, both-side exchange. Measure: lane invariants and planted recovery.

## 7. What will not work

- Tuning engine weights on planted AUC or ARI: the planted truth is built from the same features the engine scores.
- Comparing two engines on 3 pinned seeds of trajectory outcomes: MDE about 35%.
- Reading pinned seeds as paired samples: today they are not paired (corr about 0).
- Raising friends or slop pair AUC against realized outcomes as the main target: friends is chemistry-bound; slop's missing signal is hidden taste that stated data cannot carry.
- LLM personas as the source of preferences or decisions.
- Using scraped dating data collected without consent (the OkCupid scrape) or restricted challenge data (XING 2017).
- Treating the speed dating data as training data for production: small, old, one campus, unclear licence. Use it only as an offline check.

## Sources opened or searched in this session

- Pew Research Center, "The who, where and why of online dating", 2023: https://www.pewresearch.org/internet/2023/02/02/the-who-where-and-why-of-online-dating-in-the-u-s/ ; LGB short read: https://www.pewresearch.org/short-reads/2023/06/26/about-half-of-lesbian-gay-and-bisexual-adults-have-used-online-dating/
- Gallup LGBTQ+ identification, reported by Advocate and Axios, 2025: https://www.advocate.com/news/lgbtq-population-9-percent-2025 , https://www.axios.com/2025/02/20/lgbtq-adults-percentage-grows-survey
- Bruch & Newman 2018, Science Advances 4:eaap9815: https://pmc.ncbi.nlm.nih.gov/articles/PMC6082652
- Joel, Eastwick & Finkel 2017, Psychological Science 28:1478: https://www.psychologicalscience.org/news/releases/romantic-matches-are-hard-to-predict.html ; data https://reshare.ukdataservice.ac.uk/852716
- Fisman, Iyengar, Kamenica & Simonson 2006, QJE 121:673: https://business.columbia.edu/faculty/research/gender-differences-mate-selection-evidence-speed-dating-experiment ; OpenML 40536
- Hönekopp 2006, JEP:HPP 32:199: https://researchportal.northumbria.ac.uk/en/publications/once-more-is-beauty-in-the-eye-of-the-beholder-relative-contribut/
- Brozovsky & Petricek 2007, arXiv:cs/0703042; Netzschleuder LibimSeTi: https://networks.skewed.de/net/libimseti
- Blair & Hoskin 2019, JSPR 36:2074 (DOI 10.1177/0265407518779139), summary: https://www.psychologytoday.com/us/blog/inclusive-insight/201906/are-trans-people-excluded-from-the-world-of-dating
- McPherson, Smith-Lovin & Cook 2001, Annual Review of Sociology 27:415: https://sil.asc.upenn.edu/files/McPherson-2001-ARS.pdf
- Lancichinetti, Fortunato & Radicchi 2008, PRE 78:046110, arXiv:0805.4770; overlapping extension arXiv:0904.3940
- Deng, Xu, Kohavi & Walker 2013, WSDM (CUPED): https://exp-platform.com/cuped/
- RecSys Challenge 2017: https://recsys.acm.org/recsys17/challenge/
- LLM persona limits: arXiv:2405.07248; arXiv:2503.16527
