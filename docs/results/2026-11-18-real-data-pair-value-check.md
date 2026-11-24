# Offline check of the pair-value form on real speed-dating decisions

Hand-written. The numbers come from three scripts (`extract.py`, `analysis.py`, `simsrm.py`; Python standard library) run on a public data set outside the repository. A fourth script, `pdftext.py`, extracted the text of the Joel et al. manuscript; the figures quoted from it were checked by hand against the PDF. The tables copy their output files. No engine code changed. No simulation and no model call ran. This is the "offline real-data check" of R9 (item 10), R4 and R7 in [the matching research](../research/2026-11-17-matching-optimization.md).

Every earlier quality number for the matching engine comes from our own simulators, whose hidden truth we wrote. This check uses real two-sided decisions that our generator did not make.

## Source, licence and ethics

| Data set | Where | Terms | Identifiable? | Used? |
|---|---|---|---|---|
| Columbia speed dating (Fisman, Iyengar, Kamenica and Simonson, QJE 121:673, 2006), 21 events 2002-2004, 8,378 date rows, 551 participants | OpenML 40536 (licence field "Public"); the original-format file mirrored on GitHub (`cottrell/notebooks`, `data.world/Speed Dating Data.csv`, a third-party copy from Kaggle and data.world) | OpenML 40536 is the only copy with a stated licence ("Public"). The licence of the GitHub mirror is not verified: the authors' Columbia page could not be opened (bot challenge), so the statement that the authors published it for research use is not checked at the source. | No names, but **quasi-identifiers**: the original file holds zip code, home town, undergraduate school, income, race, field and age for a small, known cohort (Columbia graduate students, 2002-2004). Re-identification of some people is possible. The extraction script keeps only the 47 columns the analysis needs (none of zip code, home town, school, income, race, religion, career or field text), and the raw downloads were deleted after extraction. | Yes, offline only |
| Joel, Eastwick and Finkel 2017 (Psych. Sci. 28:1478), two samples, 350 participants | UK Data Service ReShare 852716 | Data.zip is "safeguarded": a registered account and the End User Licence are necessary. Codebooks are CC BY 4.0. | Not stated | No (needs an account); the paper is cited |
| LibimSeTi (Brozovsky and Petricek 2007), 17.4 M profile ratings | Netzschleuder `libimseti` | "Research use only; no redistribution without separate permission"; no commercial use without permission | Pseudonymous ids | No: ratings are one-sided, and the terms do not fit a product team |
| OkCupid 2016 scrape | various | Collected without consent | Yes | No (do not use) |
| OkCupid profiles of Kim and Escobedo-Land (JSE 2015) | JSE | Released with OkCupid's permission | Profiles only | No: no decisions |
| XING RecSys 2017, CareerBuilder Kaggle 2012 (job matching) | challenge sites | Non-redistribution or competition terms | | No |

Download (2026-11-18), kept in the worker's scratch directory (`<run dir>/w1-real/`), never in the repository:

- Original-format file: `https://media.githubusercontent.com/media/cottrell/notebooks/master/data.world/Speed%20Dating%20Data.csv`, SHA-256 `16fce38047d94ab9f1b8dd3417e3d2071d92160675c96cad8914fd6a0d101e8e` (equal to the git LFS object id). 8,378 rows, 195 columns.
- Cross-check: `https://openml.org/data/v1/download/13153954/SpeedDating.arff`, MD5 `0c5590a0c81750687ee1b0ee68168a5d` (equal to the MD5 that OpenML publishes). All 8,378 rows agree with the original-format file on wave, decision, partner decision and match (0 disagreements, `out/extract.txt`). The OpenML copy has no participant ids, so the analysis uses the original-format file.
- Column extract used by the analysis: `data/speed_dating_cols.csv`, 47 columns, SHA-256 `ce49b2185d338d779b0bcdae247d2128f71e418d492b836450c9d1c3d128ba9f`. The two raw downloads were deleted after the extract was made.
- The Columbia page (`stat.columbia.edu/~gelman/arm/examples/speed.dating/`) is behind a bot challenge. It was not bypassed.
- Joel, Eastwick and Finkel (2017), in-press manuscript from the first author's web site (`static1.squarespace.com/.../JoelEastwickFinkelInPress.pdf`, 34 pages, SHA-256 `e88a5b2aaacdbd2d1545ffca580b6df1810171de74d21ceb31b44ac0b98435f7`). The figures in section (c) are taken from its abstract and its Table 1.

## Command and settings

The scripts are **not in the repository**, by decision. They are in the worker's scratch directory with the data. Reasons: the task put the analysis scripts outside the repository; they cannot run without the data, and the data must not be committed (quasi-identifiers, see above); they are one-off Python analysis in a TypeScript repository, and a source file in the repository needs a row in the formal coverage ledger. The SHA-256 of each script and of each output file below identifies the exact run.

```
python3 -I scripts/extract.py <original.csv> <SpeedDating.arff> data/speed_dating_cols.csv   # 195 -> 47 columns, out/extract.txt
python3 -I scripts/analysis.py data/speed_dating_cols.csv 300 engine      # standing on today's scale: out/analysis-engine-300-fix2.txt
python3 -I scripts/simsrm.py scripts/analysis.py 300                      # the slop oracle through the same SRM code: out/simsrm-300-fix2.txt
python3 -I scripts/analysis.py data/speed_dating_cols.csv 300 pct         # standing as a percentile per gender pool: out/analysis-pct-300-fix2.txt
```

- Python 3.12.14, standard library only. Script SHA-256: `analysis.py` `2d2acc15d2e17178ffc8a87578553306a8ca812dac73f5700016a1f39c4ae370`, `simsrm.py` `b774edc43d5bc6a200422334b96d58c9896b83de3f25068bbf2581616ea59803`, `extract.py` `a31ea409ecd07e44ad2d4c8e952c0efe60eaddfe98b3471dc683999c9d0d1d8f`. Output SHA-256: `analysis-engine-300-fix2.txt` `e1b08987d4899c1fc5712e916d75d104a209e2170b85caa1d868f4d3d9386615`, `simsrm-300-fix2.txt` `80a3435460427b874a9037143a6f4666d04d89483cf871376e840efaed190b25`, `analysis-pct-300-fix2.txt` `e9c604f03d56af4cf898235f7d0145eedc3746379dd0e43cf313ad9d0f97a794`. Deterministic: the seed is 20261118. The current `analysis.py` differs from the one of the previous outputs (`62da3d3e...`, `analysis-*-300-fix1.txt`) only in what it prints: the consensus rater counts, the block count and size of each SRM, an ECE noise floor, and the held-out Brier and log-loss gains. Against those outputs, the new outputs differ only in these lines (the ECE values are equal). The current `simsrm.py` adds the body-type term. No model, no network access during the runs.
- Sample: 8,078 directed decisions (rows with every pre-meeting term, with a standing from at least 4 other raters for both people, and with the reverse decision present), 4,039 pairs, 539 participants, 21 events. Base rates: yes 41.8%, mutual yes (match) 16.2%.
- Intervals: 95% percentile intervals from 300 resamples of whole events (wave-cluster bootstrap; 21 clusters, 10 in the held-out half). These are wide, by design: the event is the unit that repeats. (A run with 1,000 resamples stopped before it finished: `out/analysis-engine-1000.txt`, from an earlier version of `analysis.py`, ends in section (b). Up to there its point estimates are equal to those of the 300-resample run of that version (`out/analysis-engine-300.txt`); only the intervals differ. The runs are too slow on the shared machine to repeat at 1,000.)
- Held out: anything fitted (regression weights, calibration maps, penalty settings, personal taste weights, the shrinkage value) is fitted on the odd events (2,570 pairs) and reported on the even events (1,469 pairs).

### How the data map to the pair value (spec/pairValue.md)

Only information from before the date enters a directed utility. Each term is an integer from 0 to 1000, and the utility is the integer weighted mean with the Date weights of spec/matchLane.md (complement 3, affinity 2, closeness 2, pack 3). The Date utility floor (350) is applied: a pair with a utility below it has no value (5 pairs of 4,039, none of them a match; the point AUCs with and without the floor are equal to three decimals, and the interval ends differ by at most 0.001).

| Engine term | Data (pre-event questionnaire) |
|---|---|
| complement a to b | a's stated weights over five attributes (attractive, sincere, intelligent, fun, ambitious; normalised, because events 6-9 used a different scale) against b's self-ratings on them |
| affinity a to b | `coverageValue`: share of a's strong interests (rated 8 or more of 10, 17 activities) that b also rates 8 or more |
| closeness | `closenessValue(age difference, 100)` |
| pack (stand-in) | goal agreement: 1000 when both came to find a date or both came for a social night, else 500. There is no real analogue of the slop pack value. |
| standing | a consensus attractiveness rating: the mean of the attractiveness ratings that **other** people gave this person on **other** dates, each rater's own mean removed. The pair under test is never used (leave-one-out). Mapped to today's scale, `50 + 16.67 z` (`standingFromRating(ratingPermille(z))`), z within gender. |

The consensus rating is a stand-in for the Clef photo rating. It comes from 4 to 21 other raters who met the person (median 15; fewer than 9 for 99 of the 539 people), so on average it is much more reliable than one model's view of a photo. Every standing number below is therefore an upper bound on what Clef can give.

## Results

All numbers in sections (a) to (e) are from `out/analysis-engine-300-fix2.txt`, except the simulator rows of (c) (`out/simsrm-300-fix2.txt`).

### (a) Terms and combiners against mutual yes

Match AUC over all 4,039 pairs (no fitting):

| Score | Match AUC [95%] |
|---|---|
| complement, both directions | 0.533 [0.491, 0.588] |
| affinity, strong-interest coverage | 0.532 [0.502, 0.556] |
| affinity, pre-event interest correlation | 0.531 [0.491, 0.564] |
| closeness, age | 0.552 [0.525, 0.577] |
| pack stand-in, goal agreement | 0.499 [0.474, 0.520] |
| harmonic mean H(u_ab, u_ba) (ours) | 0.552 [0.520, 0.581] |
| product | 0.552 [0.519, 0.581] |
| minimum | 0.555 [0.521, 0.586] |
| arithmetic mean | 0.551 [0.518, 0.580] |
| geometric mean | 0.552 [0.519, 0.581] |
| cross-ratio uninorm | 0.550 [0.516, 0.578] |
| Date pair value as shipped: floor 350, band 15 (refused = -1) | 0.572 [0.530, 0.607] |
| Date pair value, floor 350, band 51 (15 + 18 + 18: today's effective band for two one-photo members) | 0.605 [0.556, 0.647] |
| closeness in standing only, -\|gap\| | 0.580 [0.534, 0.622] |
| standing level, sA + sB (a partner effect; not allowed in the engine) | 0.672 [0.638, 0.703] |
| min(sA, sB) (not allowed) | 0.685 [0.657, 0.708] |

- A member's own yes: u_ab gives AUC 0.535 [0.507, 0.560], and 0.550 [0.521, 0.578] inside one person's dates (within-actor AUC, which removes how choosy the person is). The partner's standing gives 0.697 [0.677, 0.712] and 0.755 [0.733, 0.780].
- Held out (fit odd, report even): a logistic regression on the directed terms reaches 0.568 [0.518, 0.599]; on sA, sB and \|gap\| 0.680 [0.645, 0.711]; the directed terms plus the standings 0.677 [0.642, 0.707], no better than the standings alone. Closeness (age) and the pack stand-in (goal agreement) are symmetric (equal in both directions in 4,039 of 4,039 pairs), so each enters the regression once: six distinct terms (complement and affinity in each direction, closeness, pack). The largest fitted coefficient is 2.89 for the six terms and 3.97 for the six terms plus the standings. On the percentile scale the result is the same: 0.673 [0.638, 0.704] against 0.675 [0.640, 0.706] for the standings alone (`analysis-pct-300-fix2.txt`). (An earlier draft entered all eight directed columns; the duplicated columns made the fit singular, its coefficients diverged, and it reported 0.634 as an overfit. That number was wrong.) The unfitted harmonic mean scores 0.540 [0.500, 0.569] on the same events.
- Calibration (a 10-bin map fitted on odd events, scored on even events). Binned ECE: constant predictor 0.015 (from the base-rate shift, 16.8% to 15.2%), harmonic 0.026, product 0.029, minimum 0.024, arithmetic mean 0.034, Date value band 15 0.022, band 51 0.034, sA + sB 0.038. **At this sample size (1,469 held-out pairs) these ECE values cannot rank the forms.** A score that is calibrated by construction, put through the same procedure (2,570 fitting and 1,469 test pairs, base rate 0.168, 200 draws), gets a 10-bin ECE of 0.030 [0.017, 0.043], and it is below the constant predictor in 0 of 200 draws. Every measured ECE (0.022 to 0.038) is inside that range. A test that does not bin the test half, the held-out Brier score and log loss of each map against the constant (the odd base rate), gain = constant minus map (above 0: the map is better), with an even-event bootstrap:

| Score | Brier gain [95%] | Log-loss gain [95%] |
|---|---|---|
| harmonic mean (ours) | 0.0006 [-0.0005, 0.0014] | 0.0022 [-0.0016, 0.0058] |
| product | 0.0005 [-0.0005, 0.0012] | 0.0018 [-0.0023, 0.0053] |
| minimum | 0.0002 [-0.0012, 0.0010] | 0.0008 [-0.0045, 0.0043] |
| arithmetic mean | 0.0001 [-0.0009, 0.0008] | 0.0004 [-0.0038, 0.0036] |
| Date pair value, band 15 | 0.0007 [-0.0017, 0.0030] | 0.0032 [-0.0050, 0.0106] |
| Date pair value, band 51 | 0.0012 [-0.0026, 0.0041] | 0.0061 [-0.0080, 0.0175] |
| sA + sB (not allowed) | 0.0047 [-0.0006, 0.0111] | 0.0174 [0.0024, 0.0357] |

No form of our pair value gives held-out probabilities that are measurably better than the constant base rate: every interval includes 0. Only the standing level (sA + sB) has a log-loss gain whose interval excludes 0. These tests measure how useful the binned probabilities are (discrimination and calibration together), not calibration alone. Over the deciles of H the match rate rises only from 12.7% to 21.8%.

### (b) Parity: the standing gap

Match rate by decile of \|gap\| (today's scale; 16.7 points = 1 SD of consensus):

| \|gap\| | 0-3 | 3-6 | 6-9 | 9-13 | 13-16 | 16-20 | 20-25 | 25-30 | 30-39 | 39-77 |
|---|---|---|---|---|---|---|---|---|---|---|
| pairs | 288 | 416 | 386 | 497 | 330 | 419 | 463 | 375 | 443 | 422 |
| match | 0.205 | 0.180 | 0.194 | 0.187 | 0.206 | 0.186 | 0.173 | 0.136 | 0.108 | 0.066 |
| independent-yes prediction (cross-fitted) | 0.167 | 0.170 | 0.165 | 0.165 | 0.166 | 0.164 | 0.150 | 0.140 | 0.126 | 0.094 |

- The rate is flat up to about 20-25 points and then falls to a third. Inside the middle tercile of level: gap 0-10: 0.139 (366 pairs), 10-20: 0.171 (374), 20-35: 0.118 (357), 35-50: 0.098 (173), 50+: 0.036 (55).
- **Mechanism.** A person's yes rises steeply with the partner's standing and falls only a little with their own: log-odds +0.471 [0.431, 0.526] per 10 partner points, -0.172 [-0.228, -0.122] per 10 own points, so own standing counts 0.37 [0.25, 0.48] as much as the partner's (men 0.35, women 0.38). People say yes upward, as Bruch and Newman found: yes is 8.6% to a partner 40+ points below and 70.1% to one 40+ points above (374 decisions each). A mutual yes needs both, so the yes of the higher person limits the pair. From the first to the last gap decile the observed match rate falls by 0.139; the product of two independent yes models predicts a fall of 0.073, **about half** of it.
- **Beyond that product** the residual gap effect is not clearly different from 0: -0.100 log-odds per 10 points [-0.231, 0.047] (linear, cross-fitted over all events); with a hinge at 25, -0.276 per 10 points past it [-0.534, 0.015]. The point estimates say the other half of the fall comes after about 25 points, but 21 events cannot separate it from 0.
- **Band against penalty.** A refusal band of 15 keeps 47.5% of pairs and 56.5% of mutual yeses; the refused pairs still match at 13.4%, close to the 16.2% average. A band of 25 keeps 83.5% of mutual yeses, 33 keeps 92.4%, 39 (two members with 4 photos) keeps 96.3%, 40 keeps 96.8%, 51 keeps 99.5%. On match AUC, a penalty beats a band: band 15 alone 0.573 [0.531, 0.607]; free gap 10 with 10 per point and no band 0.605 [0.556, 0.646]; band 33 without a penalty 0.591 [0.548, 0.625].
- **Held-out choice of the penalty.** The best grid setting on the odd events was free gap 20, 40 per point, band 51 (odd AUC 0.610; no tie). On the even events it scores 0.618 against 0.604 for today's effective setting (free gap 10, 10 per point, band 51): a paired gain of **0.014 [0.002, 0.024]**. Against the shipped band 15 (free gap 10, 10 per point) it is 0.618 against 0.566, a paired gain of 0.052 [0.014, 0.076].

### (c) How much of a yes is actor, partner and pair

Social relations model, method of moments on the complete crossed block of each event and direction (`srm_block` in `analysis.py`). The real rows and the simulator rows use the **same code on the same kind of outcome** (0/1 decisions in a crossed block), so they are on one scale.

| Outcome | Actor | Partner | Relationship + error | Source |
|---|---|---|---|---|
| real yes decision (0/1), 42 blocks, 8,368 cells (mean 199.2 cells per block, 5 x 5 to 22 x 22) | 0.192 | 0.156 | 0.652 | `analysis-engine-300-fix2.txt` |
| real overall liking (1-10) | 0.296 | 0.149 | 0.555 | same |
| real rated attractiveness (1-10) | 0.271 | 0.294 | 0.434 | same |
| slop oracle, shipped `ORACLE_PARAMS` with the body-type term, 0/1 by the oracle's own rule (yes when the post-date logit reaches 0, that is `wantSecond` 0.5 with compat 1) | 0.057 | 0.096 | 0.847 | `simsrm-300-fix2.txt` |
| slop oracle, shipped parameters, 0/1 drawn as Bernoulli(sigmoid(logit)) | 0.039 | 0.060 | 0.901 | same |
| slop oracle, shipped parameters, latent logit (not comparable with the rows above: no decision step) | 0.092 | 0.143 | 0.767 (taste x traits 0.571, body type 0.031, chemistry 0.143, side noise 0.022) | same |

Simulator rows: 300 blocks of 14 x 14 (the real blocks average 199.2 cells), parameters from `packages/sim/src/apps/slop/oracle.ts` (`ORACLE_PARAMS`: c0 -1.25, dateLift 1.6, wDesire 0.9, wSelect 0.4, wTaste 1.8, chemSd 0.9, sideSd 0.35) and `persona.ts` (desirability N(0,1), warmth N(0, 0.6), five taste dimensions). The body-type term is in, because the slop block runs with `bodyTypes: true` (`scripts/sim/slop.ts` POPULATION): `bodyTerm` (bodyType.ts, `BODY_TYPE_DEFAULTS`) gives +0.6 or -0.6 for the half of members who like two of five body types, with types drawn from bodyType.ts `MIX` (a share of 0.031 of the latent variance). The age term of desirability and of the latent is left out. An earlier version of `simsrm.py` also left out the body-type term (`simsrm-300.txt`: threshold actor 0.062, partner 0.096; Bernoulli 0.041, 0.057); adding it changes the binary shares by at most 0.005. The simulator's yes rate is 0.55 against 0.42 in the real data; binary shares depend a little on the base rate.

**On one scale, the simulator's actor and partner shares are about a third and two thirds of the real ones** (0.057 against 0.192; 0.096 against 0.156), and its relationship-plus-error share is larger (0.85 against 0.65). An earlier draft of this report compared the latent shares with the real binary shares and said that the partner shares were equal; that comparison was wrong.

Which knob values give the real binary shares? `simsrm.py` searched warmth SD (0.6 to 1.8) and wDesire (0.9 to 1.8) with the relationship latent variance (wTaste² + chemSd²) kept at the shipped 4.05, for two taste arms:

| Arm | Decision rule | Closest grid point | Binary actor / partner / relationship + error | Latent taste share |
|---|---|---|---|---|
| shipped taste (wTaste 1.8, chemSd 0.9) | oracle threshold | warmth SD 1.8, wDesire 1.5 | 0.222 / 0.147 / 0.631 | 0.324 |
| low taste (wTaste 0.6, chemSd 1.92) | oracle threshold | warmth SD 1.5, wDesire 1.5 | 0.175 / 0.159 / 0.666 | 0.040 |
| shipped taste | Bernoulli | warmth SD 1.8, wDesire 1.8 (grid edge) | 0.150 / 0.146 / 0.705 | 0.295 |
| low taste | Bernoulli | warmth SD 1.8, wDesire 1.8 (grid edge) | 0.148 / 0.148 / 0.704 | 0.033 |

The grid is coarse (steps of 0.3), the Bernoulli fits sit on the grid edge, and the search was fitted to the real point estimates only (their uncertainty was not propagated). Read the knob values as a starting point for a calibration run, not as fitted values.

The binary SRM cannot say how much of the relationship share is predictable taste and how much is chemistry or noise: both arms reach the real shares. That needs a prediction test. Joel, Eastwick and Finkel (2017) did one: random forests on 100+ pre-date measures predicted 4-18% of actor and 7-27% of partner variance and **none** of the relationship variance (abstract). Their own SRM (Table 1, continuous desire ratings, so on the scale of our "liking" row) gives actor 12.2%, partner 25.9%, relationship 34.7% in sample A and 13.6%, 22.5%, 36.0% in sample B, the rest error. Section (d) adds only a weak, low-power result to this.

### (d) Private taste learned from a person's own earlier decisions

Even events, the second half of each person's dates (by date order) as test: 1,479 decisions by 213 people. Each person has on average 6.7 training decisions (the first half) for a model with 10 parameters. Within-actor AUC:

| Score | Within-actor AUC [95%] |
|---|---|
| partner's consensus attractiveness | 0.754 [0.692, 0.831] |
| pooled weights over six consensus attributes, interest correlation, same field, age gap (fit on odd events) | 0.766 [0.702, 0.826] |
| pooled + personal weights from the person's first-half decisions (ridge toward the pooled weights, lambda 10 chosen on odd events) | 0.770 [0.704, 0.836] |
| personal minus pooled (paired) | **0.004 [-0.002, 0.012]** |
| agreement-weighted yes of similar raters (collaborative) | 0.779 [0.719, 0.831] |
| collaborative, unweighted | 0.769 [0.704, 0.832] |
| agreement-weighted minus unweighted (paired) | 0.010 [-0.002, 0.020] |
| upper reference, confounded: the person's own attractiveness rating of the partner, written on the same scorecard as the decision | 0.845 [0.832, 0.859] |
| upper reference, confounded: the person's own liking of the partner, same scorecard | 0.889 [0.868, 0.908] |

- The shrinkage values tried on the odd events (1, 3, 10, 30, 100) give within-actor AUC 0.736, 0.753, 0.769, 0.768, 0.769: strong shrinkage toward the pooled weights is best. A person's weight on attractiveness learned from odd-numbered dates correlates 0.14 with the one learned from even-numbered dates (203 people).
- **What this shows.** With about 7 pre-meeting decisions per person and consensus features only, a personal taste term is **not detectable**: the gain over pooled weights is +0.004, and its upper bound is +0.012. The test has low power, so this does not show that private taste is absent or unpredictable.
- **What it does not show.** The two post-date ratings were written at the same moment and on the same scorecard as the yes decision. Part of their AUC is the decision restated (common-method and consistency bias). They are an upper reference, not a measure of private taste, and they are not evidence that taste "appears after the meeting".
- Limit: the only partner features here are consensus ratings, interests, field and age. The data have no photo attributes, so they cannot test R7 P4 (taste over presentational photo attributes).

### (e) Stated preferences and shared interests

All events, own yes, AUC and within-actor AUC [95%]:

| Score | Yes AUC | Within-actor AUC |
|---|---|---|
| stated weights x partner's consensus ratings | 0.690 [0.674, 0.703] | 0.744 [0.731, 0.762] |
| equal weights x partner's consensus ratings | 0.685 [0.669, 0.700] | 0.738 [0.725, 0.753] |
| partner's consensus attractiveness alone | 0.696 [0.677, 0.712] | 0.755 [0.733, 0.780] |
| complement: stated weights x partner's self-description | 0.537 [0.502, 0.571] | 0.526 [0.488, 0.567] |
| affinity: strong-interest coverage | 0.527 [0.504, 0.548] | 0.523 [0.491, 0.549] |
| interest correlation | 0.512 [0.495, 0.527] | 0.531 [0.508, 0.545] |

- Stated weights add little over equal weights (+0.005 to +0.006, intervals overlap), and less than attractiveness alone.
- Our complement term (stated weights against the partner's self-description) is at chance inside a person's dates (0.526, interval includes 0.5). Shared interests are near chance.

## Conclusions for the engine

1. **The harmonic mean is fine, and the choice of combiner does not matter on these data.** Harmonic, product, minimum, arithmetic, geometric and cross-ratio all give a match AUC of 0.550 to 0.555 with overlapping intervals, because the directed utilities built from stated data carry little signal. Keep the proved harmonic form. A product of calibrated acceptance probabilities (R4 P2, P6) is worth testing only when the inputs carry signal. At this sample size (1,469 held-out pairs) a 10-bin ECE has a noise floor of about 0.03 (a calibrated score gets 0.017 to 0.043), so these data cannot rank the forms on calibration. On held-out Brier score and log loss, no form of our pair value is measurably better than the constant base rate (all intervals include 0).
2. **The directed-utility terms are weak on real data; stated preferences are the weakest.** Complement (stated weights x self-description) is at chance inside a person's dates (0.526 [0.488, 0.567], all events), and stated weights add little over equal weights. Age closeness is the strongest stated term (0.552). This supports R4 and R7: stated type stays a weak term or a filter.
3. **The data support parity as a penalty past a generous free gap, not a tight band.** Mutual yes is flat up to about 20-25 points (1.2-1.5 SD) and falls after that. About half of the fall comes from people saying yes upward (the higher person refuses); the rest is not clearly different from 0 on 21 events (hinge at 25: -0.276 [-0.534, 0.015] per 10 points). The shipped Date band of 15 refuses 43.5% of the mutual yeses, at a match rate (13.4%) close to the average; today's effective band of 51 (15 plus the uncertainty of 18 of each one-photo Clef member) is harmless. Members with more photos get a narrower band: the uncertainty narrows by 2 for each photo (`standingUncertainty(rating.photos ?? 1)` in packages/engine/src/packs/slop/generators.ts, spec/memberStanding.md), so two members with 4 photos have 15 + 12 + 12 = 39, which keeps 96.3% of the mutual yeses (band 40: 96.8%), so the conclusion holds for them too. A held-out choice gives a free gap of 20 and a steep penalty after it: +0.014 AUC [0.002, 0.024] over today's free gap 10. Change to test in the slop block: Date free gap 20 to 25 points and band at least 40 points (excluding uncertainty), measured with the lowest-quintile gate. Clef is noisier than the consensus, so the relation between gap and outcome is weaker and is spread over larger observed gaps (Clef's rating is mapped as a z-score, `ratingPermille` in packages/engine/src/packs/slop/appearance.ts, so noise does not narrow the gaps); the free gap in Clef points should be at least as wide as these. If standing becomes a percentile per pool (R7 P2), the band and the free gap must be set again in percentile points: there a band of 15 keeps only 32.7% of the mutual yeses, and the held-out choice was a free gap of 25 and no band (paired gain over today's effective setting 0.007 [-0.011, 0.023]).
4. **A private taste term learned from a few pre-meeting decisions is not detectable here:** +0.004 [-0.002, 0.012] within-actor AUC over pooled weights, with about 7 decisions per person and consensus features only (test-retest r 0.14). This test has low power; it does not show that private taste is absent. The post-date ratings (0.85-0.89) are confounded with the decision and are not evidence for learning from post-date ratings. For R7 P4: start with very strong shrinkage toward the pooled weights (strongest shrinkage won here), and judge it on simulator worlds whose planted learnable share is small. Photo-attribute taste cannot be tested with these data.
5. **Calibrate the simulator's actor and partner spread up (R9 item 6).** On one scale (the same SRM code on 0/1 decisions), the shipped slop oracle (body-type term in) gives actor 0.057 and partner 0.096 against 0.192 and 0.156 in the real data. With the oracle's own decision rule, warmth SD about 1.5 to 1.8 (shipped 0.6) and wDesire about 1.5 (shipped 0.9) reach the real shares, with either the shipped taste weight or a low one (wTaste 0.6, chemSd 1.92, latent taste share 0.040). The real data cannot choose between those two taste arms; Joel et al. (2017) found no predictable relationship variance before the meeting, which argues for a low-taste arm. Proposal: a calibrated arm (warmth SD 1.5, wDesire 1.5, wTaste 0.6, chemSd 1.92) beside today's, and engine changes should win on both. These values come from a coarse grid and need a calibration run before use.

Also measured, for the product owner: the strongest pre-meeting predictor of a mutual yes is how desirable both people are (min or sum of standings, AUC 0.672-0.685 against 0.552-0.605 for our form). The engine refuses this by policy (standing feeds only parity; no popularity input). On these data that policy costs about 0.07 to 0.13 AUC. It is a policy choice, not a defect, and it should be reported as such.

## What speed dating can and cannot tell us

- Can: real two-sided yes and no decisions; pre-event stated preferences, self-descriptions and interests; consensus ratings from other people; the shape of parity and of the actor, partner and relationship split.
- Cannot: the setting is a four-minute face-to-face date, so every decision has seen the person (a photo or a text probe gives less). Participants were Columbia graduate students in New York, 2002-2004, in a heterosexual design with two genders. A mutual "yes" is an intent to meet again, not a good date. The standing proxy is far more reliable than Clef. Events 6-9 used a different preference scale (normalised here). There are no photo attributes, no friendship, no work matching and no agent in the loop. The held-out half has only 10 events, so its intervals are wide.

## Percentile standing (R7 P2)

The same analysis with the standing as a percentile rank (0 to 100) of the consensus rating inside each gender pool, as R7 P2 proposes. All numbers in this section are from `out/analysis-pct-300-fix2.txt`. Sections (c) to (e) do not use the standing scale and are equal in the two runs.

| Measure | Today's scale (`analysis-engine-300-fix2.txt`) | Percentile (`analysis-pct-300-fix2.txt`) |
|---|---|---|
| Date pair value as shipped, band 15: match AUC | 0.572 [0.530, 0.607] | 0.538 [0.505, 0.567] |
| Date pair value, band 51: match AUC | 0.605 [0.556, 0.647] | 0.602 [0.562, 0.637] |
| band 15: share of mutual yeses kept | 0.565 | 0.327 |
| band 15: match rate of refused pairs | 0.134 | 0.151 |
| band 40: share of mutual yeses kept | 0.968 | 0.754 |
| band 51: share of mutual yeses kept | 0.995 | 0.872 |
| gap decile range | 0-77 | 0-98 |
| fall in match rate, first to last gap decile: observed / independent-yes product | 0.139 / 0.073 | 0.130 / 0.063 |
| residual gap effect past 25 points (hinge), log-odds per 10 points | -0.276 [-0.534, 0.015] | -0.102 [-0.191, -0.003] |
| held-out best grid setting (fitted on odd events) | free gap 20, 40 per point, band 51 | free gap 25, 10 per point, band 100 (no band) |
| even events: best against today's effective setting (free 10, 10 per point, band 51), paired gain | 0.014 [0.002, 0.024] | 0.007 [-0.011, 0.023] |
| even events: best against shipped band 15, paired gain | 0.052 [0.014, 0.076] | 0.079 [0.018, 0.125] |
| ECE on even events: Date value band 15 / constant predictor (noise floor of a calibrated score 0.017 to 0.043) | 0.022 / 0.015 | 0.013 / 0.015 |
| held-out Brier gain over the constant: Date value band 15 | 0.0007 [-0.0017, 0.0030] | 0.0003 [-0.0013, 0.0019] |
| held-out log-loss gain over the constant: Date value band 15 / band 51 / sA + sB | 0.0032 [-0.0050, 0.0106] / 0.0061 [-0.0080, 0.0175] / 0.0174 [0.0024, 0.0357] | 0.0014 [-0.0038, 0.0063] / 0.0080 [-0.0036, 0.0161] / 0.0209 [0.0045, 0.0384] |

- A percentile point is narrower than a point on today's scale near the middle of the pool (if the consensus is about normal, the first SD above the median covers about 34 percentile points; on today's scale 1 SD is 16.7 points). So a band of 15 percentile points refuses about two thirds of the mutual yeses (67.3%), and the refused pairs still match at 15.1%, close to the 16.2% average. **If standing becomes a percentile, a band of 15 must not stay at 15.** On these data no band at all was the best held-out choice, with a free gap of 25 percentile points and 10 per point after it.
- The best held-out settings on the two scales score about the same on the even events (0.608 and 0.618; not a paired comparison). Percentile standing does not by itself make the pair value better or worse; it changes what a given band and free gap mean.
- The band-15 Date value on the percentile scale has a lower ECE (0.013) than the constant predictor (0.015). This is not evidence of better calibration. That band keeps only 27.5% of the pairs, so most pairs are refused and tied at -1, the map has fewer distinct bins, and the binned ECE has less noise. On the held-out Brier score and log loss its gain over the constant is 0.0003 [-0.0013, 0.0019] and 0.0014 [-0.0038, 0.0063]: not different from 0. As on today's scale, only sA + sB has a log-loss gain whose interval excludes 0.
- What percentile standing is for (R7 P2) is invariance to the rater's scale. These data have one consensus scale only, so they cannot test that.

## Not done

- Joel et al. data (needs a UK Data Service account), LibimSeTi and job-matching data were not used.
- No engine, spec or simulator change. The changes proposed in conclusions 3 and 5 need their own runs of `sim --only slop` with paired seeds.
- The analysis scripts and the data are not in the repository (decision in "Command and settings"), so a reader cannot re-run this from the repository alone.
