# R7: Attractiveness, Clef and the decision model

Research angle: what Clef gives us, how it reaches the Date lane today, what the literature says about a single attractiveness number, and what to change so that "attractive to me" is not one global number. Read-only research on worktree `/Users/nubs/thenetwork-matching` at commit 3f0f8586. No simulation, test, type check, Quint or Dafny was run. Hand-written; the few numbers I derived by arithmetic are marked "(derived)".

Source tags: **[opened]** = I fetched and read the page or file. **[search]** = the claim comes from a search-engine summary of the page, and I did not open the full text. **[unverified]** = recalled from memory, not opened in this session.

---

## 0. Summary

1. **Clef gives answer probabilities, not an embedding.** We ask 13 fixed questions per photo. That gives 18 features in 0..1: 3 gate answers, 3 zero-shot rating answers, 6 auxiliary answers and 6 body-type options. A linear head per dimension (face, body, overall) turns them into a calibrated z. The shipped head is **the placeholder**: `overall = 0.5 rate.overall + 0.25 rate.face + 0.25 rate.body`. Its calibration (mean 0.5, SD 0.2) is assumed, not measured. No fitted weights exist; P2 (labels from human raters) has not run.
2. **Standing for the Date lane is one global number.** `standingFromRating(ratingPermille(overall))` maps z in -3..3 linearly to 0..100, so one SD is about 16.7 points (derived). **Defect found:** `WorkersAIClefRater.rate` does not set `photos`, so `standingUncertainty(rating.photos ?? 1)` gives every Clef-rated member uncertainty 18, whatever the number of photos or their agreement. Rater confidence is only a gate (>= 0.3).
3. **For search, the Date standing window is close to the whole population.** The half-width is band 15 + own uncertainty (18) + ceiling (20) = 53 points, about 3.2 SD (derived). Standing therefore cannot make Date search cheap. The parity band refuses only pairs more than 15 + 18 + 18 = 51 points apart, which is a small share of random pairs. Most of the effect of standing comes from the penalty past the free gap (10 points per point past 10). The penalty ignores uncertainty.
4. **The literature says a consensus rating is about half the story at best.** Private taste is about as large as shared taste in face attractiveness: Hönekopp 2006; Germine et al. 2015 report about 50% agreement between two people. Relationship-specific variance exceeds target variance once people know each other (Eastwick and Hunt 2014). Pair-specific desire could not be predicted from more than 100 pre-meeting measures (Joel, Eastwick and Finkel 2017). Still, people do sort by desirability. They aim about 25% above their own level, and replies fall with the gap (Bruch and Newman 2018). They prefer partners moderately more attractive than themselves (Lee et al. 2008). So a coarse parity band is defensible; a fine one is not.
5. **Our own measurements agree.** Iteration 3: ratings did not raise the second-date rate and cost volume. Iteration 4: every rater-on arm tied rater-off within 1-2 SE. Turning the rater on moved the lowest quintile's dates from 0.86-0.89x to 0.74-0.76x. The Date lane's free gap of 10 traded second dates (1.811 to 1.541 vs random) for the lowest quintile (0.839 to 0.928).
6. **What to change, in order:**
   - set `photos` and derive an honest uncertainty;
   - use percentile standing per (market, pool) instead of the assumed z;
   - forgive the penalty for gaps inside the noise;
   - add a **private taste** term to `packValue`, learned per member from their own yes/no answers over a small, allowed set of presentational attributes, with integer shrinkage;
   - give the taste term exact search bounds through attribute postings or per-cluster boxes;
   - add live monitors that say when standing predicts nothing, and then switch it off.
7. **Simulator limit.** The simulator plants a rater that correlates about 0.87 with hidden desirability (derived from `RATER_DEFAULTS.noise = 0.5`). It has no private taste over appearance attributes. Every appearance experiment run in it today flatters a global rating. It cannot show the benefit of a private-taste term until we plant one.

---

## Part A. What exists in the code

### A.1 What Clef outputs (packages/engine/src/packs/slop/clef.ts) [opened]

- **The model.** `@cf/cloudflare/clef` (27B) or `clef-flash`, called through the Workers AI REST API (`clefRun`). Clef is a multimodal decision model. The request takes:
  - a `state`;
  - up to 4 images, as base64 data URLs only;
  - up to 64 typed questions: `noul` (yes/no probability), `choice` (one option, with a probability per option) and `score` (ordered levels, a probability-weighted level).

  The Cloudflare model page confirms these limits: 1-64 questions; up to 4 images of at most 4 MiB and 16 MP each; a 65,536-token context; each image capped at 1,024 tokens; $0.24 per million input tokens; output not billed. It does not mention embeddings [opened: https://developers.cloudflare.com/workers-ai/models/clef].
- **Our photo bank (`CLEF_QUESTIONS`).** One call per photo, at most 4 photos.
  - Gates: `gate.one_adult`, `gate.face_visible`, `gate.body_visible`.
  - Ratings: `rate.face`, `rate.body`, `rate.overall`. Each is "How attractive would *most dating-app users* find ..." on 7 levels.
  - Auxiliary: `aux.photo_quality`, `aux.grooming`, `aux.fitness`, `aux.style`, `aux.expression` (5 levels each) and `aux.smile` (noul).
  - Body type: `body.type`, a choice over slim, athletic, average, curvy, plus_size and unclear.
  - The bank asks nothing about race, ethnicity, age, gender or disability.
- **Features (`clefFeatureRow`).** Each noul answer gives its probability. Each score answer gives the expected level divided by (levels − 1). Each choice option gives its normalised probability. A missing answer reads as 0.5 (or 0 for a choice option). The confidence is the mean of Clef's `confidence` over the `rate.*` answers, and 0.7 when none is reported.
- **The member score (`WorkersAIClefRater.rate`).**
  - It drops photos with P(one adult) < `gate.oneAdult` (0.5).
  - It applies the head per photo and takes the mean of the per-photo z, weighted by the gate probability.
  - `confidence = clamp01(scale × (1 − 1/(1+n)) × 1/(1+spread) × (0.5+0.5·clefConf) × (0.5+0.5·faceVisible) × 2)`. With one photo, spread is assumed to be 0.6.
  - The body type is the argmax of the mean body-type probabilities over photos where the body is visible, if it is at least 0.45 and "unclear" is below 0.5.
  - **It returns `{face, body, overall, confidence, model, bodyType?}` and no `photos` field.** The CLIP and vision-LLM raters in appearance.ts do set `photos`.

### A.2 How the decision model turns answers into scores (clefWeights.ts, clef-fit/fit.ts) [opened]

- **The head.** `z_d = (b_d + Σ_f w_d[f]·x[f] − mean_d) / sd_d`, clamped to ±3.
- **What ships.** `DEFAULT_CLEF_WEIGHTS`, version `placeholder-0`, `placeholder: true`:
  - face reads `rate.face`;
  - body reads `rate.body`;
  - overall reads `0.5·rate.overall + 0.25·rate.face + 0.25·rate.body`;
  - the calibration is assumed: mean 0.5, SD 0.2 on the 0..1 feature scale ("SD of about 1.2 levels").

  It is not fitted on any label. `validateClefWeights` refuses a fitted file without provenance.
- **The fitter.** Bradley-Terry (pairwise logistic) per dimension: `P(a beats b) = σ(w·(x_a − x_b))`.
  - It solves Newton's method with L2, chosen by 4-fold cross-validation over unordered pairs.
  - Gate features are never used. Body-type one-hots are excluded by default, so that rater body-size preferences do not enter the score.
  - It reports held-out accuracy, log-loss, Brier, ECE, Krippendorff's alpha, per-rater flags and a label-side group residual.
- **Synthetic results only** (docs/results/2026-10-09-clef-fitting.md).
  - Overall Kendall tau on unseen photos: 0.737 fitted against 0.601 placeholder. Ranking saturates near 1,000 labels; ECE needs about 2,000.
  - The synthetic Clef answers are linear in the truth by construction. The report says so: "Only P2 can say whether Clef predicts our raters."
  - Key finding: **a linear head cannot remove a bias that is already in Clef's answers. Only the audit finds it.**
- **The proposed P2 decision rule** (not yet decided). Ship the fitted weights if:
  - held-out accuracy is at least 65% and at least 2 points above the base weights;
  - alpha is at least 0.3;
  - ECE is at most 0.05;
  - the audit has no flag.

  "Ratings do not help" if accuracy is under 60% or alpha is under 0.2.

### A.3 How standing is derived today (generators.ts `slopVectors.standing`; spec/memberStanding.md) [opened]

```ts
if (p && rating && rating.confidence >= o.appearance.minConfidence /*0.3*/ && standingReadable(p.adult, p.optedIn))
  return { standing: standingFromRating(ratingPermille(rating.overall)),
           uncertainty: standingUncertainty(rating.photos ?? 1), evidenceIds: p.appearanceEvidenceIds };
return { standing: standingFromRating(standingRatingScale / 2), uncertainty: standingUncertainty(0) };
```

- `ratingPermille(z) = round((clamp(z,±3)+3)·1000/6)`, and `standingFromRating(r) = r·100/1000`. So standing = 50 + 16.67·z (derived).
- `standingUncertainty(n) = max(3, 20 − 2·min(n,20))`. This is the reviewed-facts schedule, reused with the photo count in place of the number of reviewed facts.
- **Defect.** The production rater omits `photos`, and the service (`service.ts writeRating` → `appearanceFacet`) does not add it. So every Clef-rated member gets uncertainty **18**. An unrated member gets 20 at standing 50. A member with 4 consistent photos and one with 1 blurry photo carry the same uncertainty. Confidence (photo agreement, Clef confidence, face visibility) is used only as the 0.3 gate. With one photo and default inputs it is about 0.53 (derived), so nearly everyone passes.
- **Lane rules for Date** (spec/matchLane.md):
  - utility floor 350; band 15; free gap 10; penalty 10 per point; capacity 2 a week; search limit 10; budget 600;
  - utility weights: complement 3, affinity 2, closeness 2, pack 3.
- **Penalty and band.** `pairValue` subtracts `parityPenalty(gap, 10, 10)` from the harmonic mean, on the raw gap. The uncertainties enter only `parityAllowed` (the band) and the search window.
  - A gap of 1 SD (16.7 points) costs about 67 of 1,000 value points; 2 SD costs about 233 (derived).
  - With uncertainty 18 on each side, the band admits gaps up to 51 points (3.1 SD).
- **Search window.** The half-width is `band + own uncertainty + uncertaintyCeiling` = 15 + 18 + 20 = 53 points, about ±3.2 SD. That is essentially everyone (derived, assuming calibrated z). This matches the measured Date search cost: 31% exact, 438 checks at 100,000 members. Neither tags nor the standing window narrow the Date walk.
- **If the placeholder calibration is wrong** (likely; see B.4 on MLLMs compressing their range), the real standing SD is smaller than 16.7 points. Then the band and the penalty bind even less. Today, nobody knows how strongly the Clef standing acts in production.
- **The weekly step.** `observeStanding` moves standing at most 5 points a week. Popularity counts are banned as inputs ("A standing that reads popularity makes a feedback loop"). That rule is good and must constrain everything below.

### A.4 How packValue uses compatibility (score.ts) [opened]

`datePackValue(a,b) = round(1000 × clamp(directional(a,b) × logistics × bodyTypeFactor))`. Each part is directed:

- **`directional`** is the product of:
  - `compatEstimate`: goals, lifestyle clashes, inferred dealbreakers when none are stated, shared interests;
  - an activity-miss factor;
  - `exp(0.1 × typeMatch)`: stated "type" against the other's 5-dim self-description, weak by design (Eastwick and Finkel 2008);
  - `learnedFactor = exp(taste × revealedTaste)`. **revealedTaste is the only private-taste signal today.** It is the mean over a's post-date ratings of (rating − 0.5) × cos(self-description of the rated person, b's self-description), divided by (n+1). It uses post-DATE ratings only (few), over self-described personality dims, not over appearance.
- **`bodyTypeFactor`** is `exp(±0.3)` against a stated body-type preference. With no stated preference, it is `exp(0.5 × 2 × revealed preference)`, where the revealed preference is the mean rating deviation by the partner's body type, shrunk by 3. This already treats one appearance attribute as private taste, but only from post-date ratings.
- **Floats.** The pack value is floats (`Math.exp`) rounded to an integer 0..1000. The search bounds the pack term at its maximum (1000) because it is opaque (spec/candidateSearch.md: "custom pack value count at their maximum when present"). That is one reason Date searches rarely close exact.

### A.5 Bias monitor, audit, relay (biasMonitor.ts, clef-fit/audit.ts, spec/weeklyBias.md, relayClef.ts) [opened]

- **Weekly outcome monitor.**
  - Proposals, dates and second dates per member-month, by group and by rating quintile.
  - Alert when a ratio is strictly below 4/5; the production minimum group size is 8, the analysis minimum 15.
  - Groups are opt-in self-reports, never inferred.
- **The audit adds:**
  - SMD below −0.5;
  - top-two-quintile selection ratio below 0.8;
  - share reporting a group, by quintile;
  - a label-side residual (the model against human raters, by group).
- **What the audit does not check:**
  - calibration of standing against real mutual-yes rates;
  - whether the standing gap predicts anything;
  - drift when Cloudflare updates the Clef model.
- **The relay reuses Clef** as a text classifier, with a separate question bank. It includes a `rating_probe` category ("Does the message ask about ratings, scores ... of anyone's looks"). `appearanceLeak` patterns guard every member-facing text.

### A.6 Prior measurements that bear on the decision [opened: docs/results/2026-10-08-slop-pack.md, 2026-11-16-slop-low-quintile.md, 2026-11-17-matching-engine-migration.md]

- **Iteration 3 (held-out seeds 13-16).** Appearance ratings, in band or soft mode, "did not raise the second-date rate and cost volume". The recommendation was off; the founder reversed it.
- **Iteration 4 (tuning seeds 1-12).**
  - Every rater-on arm tied "photos 1, rater off" within 1-2 SE: soft second-date rate 21-23.7% against 24.0%.
  - Band mode cost volume (dates 0.70x).
  - Rater on, with no bias, moved the bottom quintile's dates from 0.86-0.89x to 0.74-0.76x and its second dates to 0.49-0.57x.
  - A rater with a 1-SD bias against a group cut that group's second dates to 0.73x / 0.89x (noise band 0.81-1.09).
- **After the migration** (standing = rating, band 15, free gap 10).
  - Lowest quintile: 0.928.
  - Second dates per seed against random fell from 1.811 to 1.541.
  - Dates per member-month against random: 0.834.
  - Pair-value AUC against the simulator's good pairs: 0.58 for slop.

### A.7 The simulator's truth (packages/sim/src/apps/slop/oracle.ts, snapshot.ts) [opened]

- **Perceived latent.** `L(a→b) = −1.25 + warmth_a + 0.9·D_b + 1.8·taste_a·traits_b − 0.3·ageOut − 0.4·D_a + gender gate + body term`. Then symmetric chemistry N(0, 0.9) and side noise N(0, 0.35) apply after meeting.
- **Truth and rater.** `trueAppearance = D + N(0,0.5)` for face and `D + N(0,0.7)` for body. The simulated rater adds N(0,0.5) per dimension, so corr(rating, D) is about 0.87 (derived).
- **No private appearance taste.** The only private taste is over 5 personality traits, observable through `self`. The planted desirability is the whole "looks" signal. A global rating is therefore close to the best appearance model **inside this simulator**, by construction.

---

## Part B. Literature

### B.1 The matching hypothesis and its modern tests

- **Walster, Aronson, Abrahams and Rottman (1966)**, *J. Personality and Social Psychology* 4(5): the "computer dance". 752 freshmen were paired at random. Liking for the date was driven mostly by the partner's physical attractiveness, and the level-of-aspiration (matching) hypotheses were **not** confirmed [search: https://typeset.io/pdf/importance-of-physical-attractiveness-in-dating-behavior-1xg3c7w6lr.pdf; textbook summaries]. Lesson: at a random first meeting, everyone wants the attractive partner. Matching appears when rejection is possible and anticipated.
- **Berscheid, Dion, Walster and Walster (1971)**, "Physical attractiveness and dating choice: a test of the matching hypothesis" (*JESP*). Matching appears when rejection is salient [unverified].
- **Shaw Taylor, Fiore, Mendelsohn and Cheshire (2011)**, "'Out of my league': a real-world test of the matching hypothesis", *PSPB* 37(7):942-954, doi 10.1177/0146167211409947.
  - Online daters contacted people more attractive than themselves, and the initiator's own attractiveness did not predict the target's.
  - Matching appeared in reciprocation and when desirability was measured as social value.

  [search: https://ischoolonline.berkeley.edu/blog/dating-matching-hypothesis/ (opened, qualitative only)].
- **Lee, Loewenstein, Ariely, Hong and Young (2008)**, "If I'm not hot, are you hot or not?", *Psychological Science* 19(7):669-677 (HOTorNOT data).
  - Less attractive people do not delude themselves about their dates' looks.
  - People prefer partners moderately more attractive than themselves.
  - Men are less affected by their own attractiveness when choosing.

  [search: https://people.duke.edu/~dandan/webfiles/PapersUpside/Hot%20or%20Not.pdf].
- **Hitsch, Hortaçsu and Ariely (2010)**, "Matching and sorting in online dating", *AER* 100(1):130-163. Preferences estimated from site behaviour, run through Gale-Shapley, reproduce the observed matches and marriage sorting without search frictions [search: https://econpapers.repec.org/RePEc:aea:aecrev:v:100:y:2010:i:1:p:130-63].
- **Bruch and Newman (2018)**, "Aspirational pursuit of mates in online dating markets", *Science Advances* 4:eaap9815, arXiv 1808.04840.
  - Heterosexual markets in 4 US cities; desirability measured by a PageRank over messages.
  - Users message partners about 25% more desirable than themselves.
  - Reply probability falls markedly with the desirability gap.
  - Strategy helps only modestly.

  [search: https://arxiv.org/abs/1808.04840; the PMC page was blocked by a CAPTCHA, which I did not attempt].

**For us:** sorting on desirability is real, and a parity band matches it. The band should be generous (people do aim higher, and a modest upward gap is accepted). Desirability in these studies is **revealed demand inside a pool**. That is close to "rank within (market, pool)", not to an absolute face score.

### B.2 Consensus against private taste

- **Hönekopp (2006)**, "Once more: is beauty in the eye of the beholder? Relative contributions of private and shared taste to judgments of facial attractiveness", *JEP: Human Perception and Performance* 32(2):199-209.
  - 31 raters rated 77 faces twice, a week apart.
  - Private taste was "about as powerful as shared taste".
  - Single-session designs with many raters inflate Cronbach's alpha.

  [search: https://www.gwern.net/doc/psychology/2006-honekopp.pdf].
- **Leder et al. (2016)**, *Frontiers in Human Neuroscience* 10:155. With the same method, private taste was about 40% for faces and 75% for abstract art [search: https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2016.00155/full].
- **Germine, Russell, Bronstad, ... Wilmer (2015)**, "Individual aesthetic preferences for faces are shaped mostly by environments, not genes", *Current Biology* 25(20), doi 10.1016/j.cub.2015.08.048.
  - 547 MZ and 214 DZ same-sex twin pairs rated 200 faces.
  - Individual preferences "agree about 50 percent, and disagree about 50 percent, with others". The individual part comes mostly from unique environment.

  [opened: https://www.sciencedaily.com/releases/2015/10/151001125637.htm; search: PDF https://www.ocf.berkeley.edu/~knakayama/wp-content/uploads/2019/03/185Germine2015.pdf].
- **Eastwick and Hunt (2014)**, "Relational mate value: consensus and uniqueness in romantic evaluations", *JPSP* 106(5):728-751.
  - Romantic evaluations hold more relationship (unique) variance than target (consensus) variance.
  - Consensus is strongest for attractiveness and vitality, and uniqueness grows with acquaintance.

  [search: https://pubmed.ncbi.nlm.nih.gov/24611897/].
- **Social Relations Model (Kenny).** Consensus (target variance) in interpersonal perception is typically about 0.20 of the total. Relationship (unique) variance is about 57% for liking and about 42% for trait ratings [search: https://davidakenny.net/ip/unique.htm].
- **Joel, Eastwick and Finkel (2017)**, "Is romantic desire predictable? Machine learning applied to initial romantic attraction", *Psychological Science*, doi 10.1177/0956797617714580.
  - Random forests on more than 100 pre-date self-reports predicted 4-18% of actor variance and 7-27% of partner variance.
  - They predicted **none** of the relationship (pair) variance.

  [search: https://www.psychologicalscience.org/news/releases/romantic-matches-are-hard-to-predict.html].
- **Eastwick, Luchies, Finkel and Hunt (2014)**, "The predictive validity of ideal partner preferences: a review and meta-analysis", *Psychological Bulletin* 140(3):623-665. Stated ideals predict initial attraction poorly; patterns predict better in established relationships [search: https://pubmed.ncbi.nlm.nih.gov/24588091/].

**For us:**
- A consensus rating can at best explain the shared half of facial preference, and the partner (target) part of desire.
- The private half is learnable only from a member's own choices: the Whitehill and Movellan and MetaFBP evidence below.
- The pair-specific "chemistry" part is not learnable before meeting. That is exactly the simulator's chemistry term.
- So the ceiling on pre-meeting ranking quality is low (slop AUC 0.58 today). Gains will come from private taste and from post-meeting learning, not from a better global score.

### B.3 Personalised attractiveness prediction (private taste from one person's ratings)

- **Whitehill and Movellan (2008)**, "Personalized facial attractiveness prediction", IEEE FG 2008, doi 10.1109/AFGR.2008.4813332. ε-SVR on image features, trained per user from dating-site photos, reached Pearson correlation up to about 0.45 with each user's own ratings [search: https://sciweavers.org/node/75403]. The same group filed patent US9104905B2 on analysing individual attractiveness preferences for matching [search: https://patents.google.com/patent/US9104905B2].
- **Lin et al. (2023)**, "MetaFBP: learning to learn high-order predictor for personalized facial beauty prediction", ACM MM 2023, arXiv 2311.13929. Each user is a meta-task: a universal extractor captures the shared part, and a fast-adapting predictor captures the individual part from "only a few images rated by each user" [opened abstract: https://arxiv.org/abs/2311.13929]. This is the exact decomposition we want: a shared part (consensus standing) plus a per-member part (taste vector) with shrinkage.
- **Industry precedent.** Tinder's help centre says it uses "anonymized cues from photos" to tailor recommendations, alongside Likes and Nopes [search: https://www.help.tinder.com/hc/en-us/articles/7606685697037]. Third-party sources describe this as "photos similar to ones you've liked" [search; not Tinder's wording].

### B.4 Reliability of human and machine ratings

- **Single human raters are noisy.** Alpha over many raters overstates agreement because raters act as items (Hönekopp 2006). Kramer, Mileva and Ritchie (2018, *PLoS ONE*, "Inter-rater agreement in trait judgements from faces") make the same point [search; the DOAJ page returned 403]. By Spearman-Brown, a single-rater ICC of 0.3 needs about 21 raters for an averaged reliability of 0.9; 0.5 needs about 9 (derived).
- **In-domain machine models.** On SCUT-FBP5500, 5,500 frontal lab faces (Asian and Caucasian only), CNN regressors reach Pearson about 0.90-0.92 against the mean rating [search: arXiv 1801.06345; https://github.com/HCIILAB/SCUT-FBP5500-Database-Release]. That is agreement with a *panel mean* on standardised photos, not with any one person, and not on dating photos.
- **Multimodal LLMs (closest to Clef).** Grandas, Cely-Acosta, Mendiratta, Hassan and Murphy, "Beauty is in the AI of the beholder: MLLMs systematically overrate facial attractiveness", arXiv 2609.02512 (Sept 2026). The study was preregistered: 2,513 human raters against Claude, Gemini, GPT and Grok.
  - The models rank-correlate strongly with humans but **rate higher and in a narrower range**.
  - Face age was the only predictor shared by humans and models.
  - Ethnicity and gender effects were inconsistent across models.

  [opened abstract: https://arxiv.org/abs/2609.02512; the PDF was too large and the HTML version returned 404, so I have no exact coefficients]. Clef was not tested. The likely consequence for our placeholder calibration (assumed SD 0.2) is compressed z and therefore weaker parity than intended.

### B.5 Bias in automated attractiveness scoring

- **Hamel and Busch (2025)**, "Analysis of bias in deep learning facial beauty regressors", arXiv 2509.24138 (preprint).
  - Models trained on SCUT-FBP5500 and MEBeauty show significant ethnic disparities (p < 0.001), even on the balanced FairFace set.
  - Only 4.8-9.5% of inter-group comparisons met distributional parity.
  - The authors report amplification of societal beauty bias.

  [opened abstract: https://arxiv.org/abs/2509.24138].
- **"Exploring racial bias in rating facial attractiveness among artificial intelligence platforms"** (Thieme, doi 10.1055/a-2945-2437). Commercial AI raters scored standardised White female faces 8.18, Asian 7.79, Latino 7.72 and Black 6.91 on a 10-point scale. The White-Black gap was +1.27 (p < 0.001), and platforms differed by up to 1.85 points [search: https://www.citedrive.com/en/discovery/exploring-racial-bias-in-rating-facial-attractiveness-among-artificial-intelligence-platforms/; journal not confirmed].
- **The question wording invites it.** Our question asks Clef what "most dating-app users" would find attractive. Dating-site data have documented racial preference patterns: OkCupid's "Race and attraction" posts (2009 and 2014) [unverified]. A model that reproduces "most users" reproduces those patterns. Age is a documented predictor in humans and MLLMs (B.4). Body size and visible disability are known bias axes [unverified for disability specifically].
- **Our own synthetic result** (A.2): Clef-side bias passes straight through a fitted head. The audit flags it at 0.7 SD (selection ratio 0.60). At 0.35 SD the ratio is 0.74, and with no bias 0.86. At about 200 members per group, the selection ratio is too noisy to flag smaller biases.

### B.6 Ethics and legal exposure (not legal advice; counsel must review)

- **EU AI Act**, Regulation (EU) 2024/1689, Art. 5(1)(g). It prohibits biometric categorisation systems that categorise people from biometric data to deduce or infer race, political opinions, trade-union membership, religious or philosophical beliefs, sex life or **sexual orientation**. The Commission guidelines give a photo-based sexual-orientation example as prohibited. Exclusions cover labelling or filtering lawfully acquired datasets, and ancillary, strictly necessary features [search: https://fpf.org/blog/red-lines-under-the-eu-ai-act-understanding-the-prohibition-of-biometric-categorization-for-certain-sensitive-characteristics/; https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-5].
  - Attractiveness and body type are not listed traits. Our bank asks none of the listed traits, **and must never be extended to orientation, ethnicity, religion or "is this person trans"**.
  - Other biometric categorisation is in Annex III as high-risk [unverified].
  - Art. 5(1)(f) bans emotion recognition in workplaces and education, which matters for peon.biz if anyone proposes photo or video signals there [search].
- **FTC Policy Statement on Biometric Information and Section 5** (18 May 2023).
  - Its definition of biometric information includes depictions and images of facial features, so ordinary face photos count.
  - Unsubstantiated claims about accuracy or bias may be deceptive.
  - Failing to assess foreseeable harms (including demographic performance differences) before use may be unfair.

  [search: https://www.wiley.law/wiley-connect/ftc-issues-policy-statement-on-biometric-information-signaling-a-new-enforcement-priority].
- **Illinois BIPA.** *Monroy v. Shutterfly* (N.D. Ill. 2017) refused to read the "photographs" exclusion as covering face-geometry scans made from photos [search: https://www.biometricupdate.com/201709/illinois-judge-refuses-to-dismiss-shutterfly-face-recognition-privacy-suit].
  - Clef does not produce an identifying template, which may keep us outside "biometric identifier", but this is unsettled.
  - The 2026-10-09 report already flags BIPA, Texas CUBI and Washington's law.
- **Rights of access to inferences.** California's CCPA treats inferences as personal information within the right to know [unverified]. GDPR Art. 15 grants access to personal data, including inferred data [unverified]. The service says the rating "is not in the member's export". That may conflict with a valid access request where those laws apply. **Open question for counsel.**
- **Sexual orientation from faces.** Wang and Kosinski (2018, *JPSP*) reported 81% and 74% single-image accuracy (91% and 83% with 5 images). Critics argued it captures grooming and presentation stereotypes, and raised consent problems [search: https://www.lse.ac.uk/dsi/news/archive/deep-neural-networks-and-the-rise-of-the-ai-gaydar]. **Policy:** orientation, gender identity and trans status must come only from the member's own words, never from photos.

### B.7 What dating products did

- **Tinder (Elo).** Tinder said in March 2019 that "Elo is old news". Its system now "matches you, using your recent activity, your preferences and your location" [opened: https://www.engadget.com/2019-03-18-tinder-dumps-desirability-scores.html]. The current help page lists Likes and Nopes, profile content and photo cues [search]. Lesson: a desirability score built from swipes is the popularity loop our spec bans; Tinder moved toward per-user engagement signals.
- **OkCupid.** "Your looks and your inbox" (Rudder, OkTrends, 17 Nov 2009): message volume concentrates on members rated most attractive; men's and women's rating distributions differ sharply [search: https://gwern.net/doc/psychology/okcupid/yourlooksandyourinbox.html]. OkCupid later merged its separate looks and personality ratings into one, and reported (2014, "We experiment on human beings") that the two ratings correlated almost perfectly [unverified]. Lessons: rater distributions differ by pool (so use per-pool percentiles), and halo effects make separate "dimensions" unreliable.
- **Hinge "Most Compatible"** (July 2018). One daily recommendation from a Gale-Shapley-style stable matching over inferred preferences. Hinge claimed phone-number exchanges were 8x more likely in early tests [search: https://techcrunch.com/?p=1668547; https://www.engadget.com/2018/07/12/hinge-most-compatible-suggestions/]. This is the closest product analogue to our weekly greedy stable assignment.
- **Reciprocal recommenders.** Kleinerman, Rosenfeld, Ricci and Kraus (RecSys 2018, doi 10.1145/3240323.3240349) balance, per receiver, P(receiver accepts) against P(recommended user responds). On a live dating site this gave significantly more successful interactions than the baseline [search: https://u.cs.biu.ac.il/~krauss/data/articles/recsys18a-sub1173.pdf]. Our harmonic mean of two directed utilities is a fixed version of that balance.

### B.8 Exact search over inner products (for P5)

- **Ram and Gray (2012)**, "Maximum inner-product search using cone trees", KDD 2012, doi 10.1145/2339530.2339677, arXiv 1202.6101. Exact branch-and-bound with ball- and cone-tree inner-product bounds, reported at up to 5 orders of magnitude over linear scan [search: https://arxiv.org/abs/1202.6101]. A box bound per cluster is the integer-friendly version.

### B.9 jevector (github.com/lalalune/jevector @ b49a696, Oct 2026) [opened: cloned, read only, not executed]

- **What it is.** Text profiles, not photos. Four channels per attribute (self, prefer, require, exclude) over a catalog of 16 or 64 attributes, giving 64 or 256 values.
  - Self answers decode three-valued: yes if choice=yes and p >= 0.7; no if choice=no and p(no) >= 0.7; otherwise unknown (0.5).
  - Mandatory conditions are checked in both directions. Unknown evidence is **not** eligible ("missing").
  - The rank is preference coverage `hits / count`, with uncertain preferences kept in the denominator. The reciprocal score is the mean of the two directions.
- **Cross-role projection** (`matching/ann.py`):

  ```text
  own    = self values × known
  wanted = prefer + require − exclude, L1-normalised
  document = [own, wanted, 0, 0]
  query    = [wanted, own, 0, 0]
  ```

  So `query_a · document_b = wanted_a·own_b + own_a·wanted_b`: the sum of both directions' coverage. HNSW with M=16 and ef=64 does the retrieval.
- **Its own benchmark.** 52 synthetic profiles and 8 validation queries; the authors warn it is "not evidence of real relationship outcomes". On 1,024 structured profiles, HNSW recall of the exact top-5 was 40.6% / 78.3% / 88.4% at 16 / 64 / 128 candidates (64 values), against an exact pass of 48 ms.
- **For us.** The cross-role projection *is* our complement term (seeks covered by offers, both directions). We already compute it exactly from posting lists with a proven bound. HNSW would lose 12-60% of the true top-5 at those sizes. The idea worth taking is the three-valued decoding with a confidence threshold, not the ANN index.

---

## Part C. Proposals

Our hard constraints shape every proposal: integer arithmetic; deterministic; an exact search or an honest reported bound; at most 600 pair checks per search; standing private; no popularity input to standing; adults only; no protected attribute or proxy.

### P1. Set the photo count and derive an honest Date uncertainty (fixes a defect) — area: quality, effort S

- **What it changes.**
  - `WorkersAIClefRater.rate` returns `photos: per.length`, the number of photos that passed the gate.
  - Add an integer `ratingUncertainty(photos, spreadPermille, residualPermille)` to spec/memberStanding.md, proved in Dafny, in place of reusing `standingUncertainty(reviewedCount)`:
    - `residualPermille` is the fitted head's held-out residual SD in z units, stored in the weights file (`calibration.residualSd`). The placeholder sets it to 1000, which forces the ceiling;
    - `spreadPermille` is the SD of the per-photo z;
    - `seSq = residual² + spread²/n`;
    - `u = min(20, max(3, ceilDiv(isqrt(seSq) × 100, 6000)))`. A z of 1 is 16.67 points, and `isqrt` is a proved integer square root;
    - the platform also stores `appearance:spread`.
- **Why it should help.**
  - Today every Clef member has u = 18, so neither the band nor the window reflects knowledge.
  - With the placeholder, u should be 20 (honest: no evidence it predicts anything).
  - With fitted weights at tau about 0.7, the residual is maybe 0.5 SD, which gives u of about 9 (derived). Spearman-Brown logic: more and agreeing photos shrink the error.
  - The search window narrows from ±53 to about ±44 points for fitted members. This is small for cost but right for meaning.
- **What could go wrong.**
  - A narrower uncertainty tightens the band for well-rated members, so the lowest quintile could lose dates. Watch the 0.85 gate.
  - The residual from P2 labels may not transfer to the live population.
- **How to measure.**
  - `sim --only slop`: the lowest-quintile ratio, second-date rate, and the parity-gate counter (must stay 0).
  - Unit-free check: the distribution of u across members in the Observatory.
  - A Dafny law: `ratingUncertainty` is in [3, 20] and non-increasing in n.
- **Exactness.** It survives: `lawWindowComplete` holds while u <= the ceiling.

### P2. Percentile standing per (market, pool) instead of the assumed z — area: quality, effort M

- **What it changes.**
  - Date standing becomes the member's percentile rank (0..100) of the calibrated overall rating among rated members of the same dating pool (the coarse `is` gender) in the same market.
  - Kept incrementally in a Fenwick tree over permille bins (1,001 counters per pool), at O(log 1000) per insert, update or delete.
  - `standing = (count below + count equal/2) × 100 / N`, in integers.
  - Fewer than 50 rated members in a pool keeps the unrated midpoint and u = 20.
- **Why it should help.**
  - It removes the dependence on the unmeasured placeholder calibration. MLLMs compress range and shift upward (Grandas et al. 2026), so z from an assumed SD of 0.2 is wrong by an unknown factor.
  - Desirability in the field evidence is rank within a pool (Bruch and Newman's PageRank is per gender).
  - Pools differ in rating distributions (OkCupid 2009).
  - "Band 15" becomes a stable, interpretable "15 percentile points" whatever Clef does. The window cost becomes predictable: a fraction of about (2 × (15 + u + 20))/100 of the pool.
  - A Clef model update no longer silently rescales everyone.
- **What could go wrong.**
  - Percentiles change as the pool changes. The 5-point weekly step (`observeStanding`) already damps that.
  - Small pools (queer markets) give coarse ranks. Hence the N >= 50 rule.
  - A rank removes information about the tails. Acceptable, because the tails are where rater error is largest.
- **How to measure.**
  - Sim: the lowest quintile, second dates and dates/member-month, on the same seeds.
  - Sim with rater noise and scale sweeps (noise 0.5 → 1.0; scale ×0.5): percentile standing should be invariant to scale, and z standing should not be.
- **Exactness.** It survives. Standing is still an integer 0..100 with the same proofs. The Fenwick tree is shell code, and its output is checked against a sort in an integration test.

### P3. Forgive the penalty inside the measurement noise — area: quality, effort S

- **What it changes.** In `parityPenalty`, the free gap becomes `parityFreeGap + (u_a + u_b) / 2` for lanes that opt in (Date). Today it is fixed at 10.
- **Why it should help.**
  - The measured trade-off between free gap 5 and 10 (lowest quintile 0.839 → 0.928; second dates/seed 1.811 → 1.541) came from charging pairs for gaps inside rating noise.
  - Scaling the free gap with uncertainty charges well-measured large gaps fully and leaves noise free.
  - Literature: people accept moderately higher partners (Lee et al. 2008; Bruch and Newman 2018), so small gaps should be free.
- **What could go wrong.** It weakens parity for uncertain members, which is by design. Monotonicity (`lawSmallerGapNeverWorse`) still holds for fixed uncertainties, but the value now depends on uncertainty, so the symmetry and bound proofs need updating.
- **How to measure.** `sim --only slop` on the same seeds: the lowest quintile (gate 0.85), second dates/seed against random, back-outs at reveal.
- **Exactness.** The search bound must use the smaller penalty (u at the ceiling for the unseen partner), which is still sound.

### P4. A private taste term in packValue (the main quality change) — area: quality, effort L

**What it changes.** Add a directed `taste(a,b)` term to `datePackValue`, learned only from a's own decisions.

1. **The taste bank (allowed attributes only).**
   - A second Clef question group per photo, about *presentation*, not protected traits.
   - Candidates: clothing style (casual, formal, sporty, alternative, outdoorsy), grooming level, visible tattoos, glasses, facial hair, photo setting (outdoors, travel, pets, nightlife, sport), expression and smile, fitness setting.
   - Existing `aux.*` answers can seed it.
   - **Excluded:** skin tone, hair texture, eye shape, apparent age, apparent ethnicity, apparent gender, disability cues, and anything about orientation. Excluded also: the `rate.*` answers, since taste must be orthogonal to consensus.
   - Each attribute decodes three-valued as in jevector (yes at p >= 0.7, no at p(no) >= 0.7, else unknown), giving `x_b,k ∈ {−1, 0, +1}`.
   - The attribute list lives in a spec table, and each entry carries a written justification and a bias-audit result.
2. **Observations.**
   - y = +1 for a "yes" to a probe that showed b's photo, −1 for a "no". Silence is not counted (silence is about the week, not the person; slop already treats it so for re-probes).
   - Post-date ratings count as ±2.
   - **A stated preference** ("I like tattoos", "no smokers" is already a dealbreaker) adds a prior of s = 3 pseudo-observations on that attribute.
3. **Integer estimator with shrinkage.**
   - Keep `S_a[k] = Σ y·x_b,k` (integer) and `n_a`.
   - `θ_a[k] = S_a[k] × 1000 / (n_a + λ)`, with λ = 8, so θ is in permille in [−1000, 1000].
   - `taste(a,b) = clamp(Σ_k θ_a[k]·x_b,k / K_eff, −1000, 1000)`, mapped to a 0..1000 term `500 + taste/2`.
   - One observation updates K counters in O(K), with no recomputation (incremental by construction). This is the existing `revealedTaste` pattern (mean of (rating − 0.5) × similarity / (n+1)), moved from post-date-only personality dims to probe-level appearance attributes.
4. **Cold start from similar members** (the user's "cache early processing" idea, done safely).
   - Members whose *stated* preferences fall in the same quantised key (pool sought, stated type bucket, stated body-type wants) share a cohort prior `θ_c = Σ S / (Σ n + λ_c)`.
   - The member's θ is shrunk toward θ_c instead of 0: `θ_a = (S_a + λ·θ_c/1000) × 1000 / (n_a + λ)`, all integer.
   - Cohort sums update in O(K) per observation.
   - **The cohort prior is over what people like, never over who is liked.** No member's received-yes count enters anything, so the popularity ban in spec/memberStanding.md holds.
   - The prior's mean direction must be projected off any consensus-like axis. In practice: exclude `rate.*`, and check monthly that the correlation between θ_c·x_b and the consensus rating stays < 0.3.
5. **Lane weights.** Fold the term into the Date `pack` term, so pack becomes compat × taste, or give it its own weight. Start small (equivalent to the old `soft 0.05`) and raise it only on evidence.

**Why it should help.**
- About half of facial-attractiveness variance is private (Hönekopp 2006; Germine et al. 2015).
- Personalised predictors reach r of about 0.45 per user (Whitehill and Movellan 2008).
- Few-shot personal adaptation works on top of a shared extractor (MetaFBP 2023).
- Tinder reports using photo cues of what a user liked.
- Our global rating, by construction, cannot represent "attractive to me". The current learned term uses only post-date ratings (rare) over personality dims.

**What could go wrong.**
- **(a) Feedback and selection bias.** We observe y only for people we chose to show. Count only probes from the exploration slice for θ, or weight by inverse propensity, which needs the stored proposal probability.
- **(b) Proxy discrimination.** An allowed attribute (style, setting) can correlate with race or income. Audit each attribute's correlation with the opt-in group, and drop any with |r| > 0.2.
- **(c) Leakage.** θ and x are agent_private. `appearanceLeak` must also block attribute words in explanations ("you both like tattoos" reveals photo analysis). Add the taste-bank vocabulary to the leak patterns.
- **(d) Small n.** Members see few probes a week (capacity 2), so θ stays near the prior for weeks. Shrinkage handles this, but the benefit appears late.
- **(e) Consent.** This is new photo processing, so it needs a consent line covering "photo features used to learn your taste".
- **(f) Legal.** It is still "biometric information" in the FTC's sense.

**How to measure.**
- **Offline, in the simulator,** after P6 plants appearance taste: AUC of the directed pack value against hidden attraction, per direction; second-date rate; lowest quintile; and the share of matches whose taste term exceeds the consensus term.
- **Live:** the probe yes-rate of photo probes in the treatment arm against control, at a fixed exploration share. Power: detecting 30% → 33% yes needs about 3,700 probes per arm (derived; α 0.05, power 0.8).
- **Stability:** θ test-retest correlation between halves of a member's observations.

**Exactness.** The term is a bounded integer, so pair values stay in 0..1000 with all proofs. Search exactness depends on P5. Without P5, the pack term is bounded at its maximum, which is today's behaviour.

### P5. Make taste and appearance terms boundable for the exact search — area: speed, effort M

- **What it changes.** Two compatible options.
  - **(a) Attribute postings.** Index `x_b,k = +1` as tag postings `look:k` inside the Date block (agent_private, never in member-facing tags).
    - For a searcher with weights θ_a, walk postings of the attributes with the largest positive θ first.
    - An untouched candidate's taste is bounded by `Σ_{k open} max(θ_k, 0) + Σ_{k closed} max(−θ_k, 0)·[x_k ≤ 0]`, the same structure as tag coverage.
    - It adds the jevector cross-role idea as tags: own presentational attributes → `offers`, a member's stated appearance preferences → `seeks`. Coverage in both directions is then exactly the existing complement term with its proven bound.
  - **(b) Cluster boxes.** Group the Date block into at most 64 clusters by quantised attribute vector (assignment by nearest centroid, done incrementally on join).
    - Each cluster keeps per-attribute min and max. Boxes only grow between rebuilds, so the bound is always sound.
    - The bound per cluster is `Σ_k max(θ_k·lo_k, θ_k·hi_k)`: exact branch-and-bound à la Ram and Gray 2012.
    - Visit clusters by bound, and stop when the k-th kept value beats every remaining cluster bound.
- **Why it should help.**
  - Date searches close exact 31% of the time at 100,000 members, with 438 checks. A large reason is that the Date pack term (weight 3 of 10) is bounded at 1000 for every unseen candidate, and Date has no required tag.
  - A boundable taste or compat term gives the stop rule something to bite on. For comparison, ntwrk Intro, whose terms are all tag-bounded, closes 100% exact with 0.9 checks per profile.
  - Option (b) also gives a cache that is "similar people → similar partners" at cluster granularity: a searcher's bound for a cluster is reused across the run.
- **What could go wrong.**
  - With few strong θ (new members), bounds stay loose, so little gain for cold members.
  - Clusters drift. A rebuild needs a deterministic order (by member ordinal) and must happen between runs.
  - Attribute postings add index memory: about K × N entries, which is small at K ≤ 24.
- **How to measure.**
  - The engine's planted-world scale benchmark (the same harness as the 100,000-member Date number): % exact, checks per profile, largest unseen bound, wall time.
  - The brute-force oracle must agree on planted worlds.
- **Exactness.** It survives. Both bounds are upper bounds proven like the tag bound, and the search stays "exact or reports a bound".

### P6. Plant appearance taste and realistic rater quality in the simulator — area: benchmark, effort M

- **What it changes.** Add to the slop world (hidden truth only):
  - K = 8-12 visible presentational attributes per persona;
  - a per-persona appearance taste vector, with variance set so that shared and private parts are about equal (Hönekopp; Germine);
  - a consensus part D;
  - a Clef simulator that reports the attributes with per-attribute flip noise and the consensus with configurable correlation r ∈ {0.5, 0.7, 0.87};
  - a range compression factor (MLLMs, B.4);
  - group bias in both Clef and raters.

  Keep chemistry as is: it is the unpredictable pair variance (Joel et al. 2017).
- **Why it should help.** Today the simulator's only appearance signal is D, with a rater at r ≈ 0.87. It cannot show the value of private taste or the cost of a noisy rater. Every appearance arm since iteration 3 measured "global rating against nothing" under a flattering rater.
- **What could go wrong.**
  - We test our own assumptions: the planted taste structure is a guess.
  - Results are only "the code can learn what we planted". Report them as mechanism checks, not as outcome predictions.
  - Sim noise is large: a neutral tie-break change moved pooled ntwrk meetings 174 → 132. Use more seeds (≥ 12 tuning, ≥ 8 held-out) and paired comparisons.
- **How to measure.**
  - New tracked gates: taste-term AUC against hidden private taste; second-date rate under r = 0.5 against 0.87; lowest quintile under a bias of 0.5 SD.
  - Report the AUC ceiling, the oracle without chemistry (0.35 soft second-date rate in iteration 4), to show the headroom.
- **Exactness.** Not applicable.

### P7. Monitor whether standing earns its place; switch it off when it does not — area: safety, effort M

**What it changes.** Extend the weekly bias job (spec/weeklyBias.md) with three aggregate, admin-only checks.

- **(a) Gap validity.**
  - The mutual-yes rate of photo probes, binned by standing gap (0-10, 10-20, 20-35, 35+), restricted to the exploration slice so that the band does not censor the data.
  - If, after ≥ 3,500 probes per bin (derived: 10% vs 8% at α 0.05, power 0.8), the slope is not negative, flag "standing predicts nothing". The decision table then sets the Date penalty to 0 and the band to full (Friend-like). This is the live version of the P2 rule "ratings do not help".
- **(b) Calibration.**
  - Predicted P(yes) from the rank gap against observed, as ECE by rating quintile and by opt-in group.
  - Tested by the same 4/5 threshold machinery, but on *quality* metrics (second dates) as well as volume. Iteration 3 showed bias hits quality first.
- **(c) Model drift.**
  - Store Clef's model id, the head version and the question-bank hash with every rating.
  - On any change, re-rate a fixed consented calibration set and alarm if the rank correlation with the previous ratings is < 0.9.
  - Re-rating members waits for the founder.

**Why it should help.**
- Every prior arm found ratings neutral within noise.
- The literature predicts a modest effect.
- The audit today can find bias but cannot find uselessness.

**What could go wrong.**
- The exploration slice may be too small for weeks (pilot scale). Report the CI; do not act on underpowered bins.
- Members must never learn bins or ratings. The report stays aggregate-only, with n >= 8 suppression.

**How to measure.** The job's own outputs. A sim gate: with rater correlation 0, the monitor must flag "predicts nothing"; with 0.87, it must not.

**Exactness.** Not affected.

### P8. Self-stated signifiers only; nothing about identity from photos — area: signifiers, effort S

- **What it changes.**
  - Orientation, gender identity, trans status and "open to dating trans people" come only from the member's own words. `slop:identity` is already agent_private and unused in matching.
  - Add an explicit, self-stated `slop:open_to:trans` (yes / no / unstated) as a hard pair rule in the segment and gate, symmetric with `is` / `seeks`.
  - Never add a Clef question that could infer any of these. Add a static gate: the bank must not contain the words orientation, gay, straight, trans, ethnicity, race, religion, age.
- **Why it should help.**
  - EU AI Act Art. 5(1)(g) prohibits photo-based orientation inference.
  - The Wang and Kosinski controversy shows such inference captures stereotypes.
  - Trans members are harmed by mismatched expectations at the reveal, so a stated preference is safer than an inference.
- **What could go wrong.** Small pools get smaller. The `widen` ask and the scarce-pool-first assignment already address this.
- **How to measure.** Conformance: a bank-word gate. Sim: the trans-unaware rejection rate at reveal, if planted.
- **Exactness.** It survives: a new segment rule, with the same blocking-completeness proof shape.

### P9. Reword the rating question away from "most dating-app users" — area: safety, effort S

- **What it changes.** Two arms decided by P2 labels:
  - (i) "How clear, well-lit and flattering is this photo of this person?", which separates presentation from looks;
  - (ii) a neutral "How physically attractive is this person?".

  Keep the question that wins on held-out accuracy *and* on the label-side bias residual.
- **Why it should help.** "Most dating-app users" asks Clef to reproduce aggregate dating-market preferences, which carry documented racial and age patterns (B.5).
- **What could go wrong.** It may lower accuracy against our raters if our raters share those patterns. That is the audit's job to expose, not hide.
- **How to measure.** P2 label-side residuals by opt-in group for each wording; selection ratio; tau.
- **Exactness.** Not affected.

---

## Part D. What will not work for us, and why

1. **A single global attractiveness score as the main Date signal.** About half of face preference is private, pair variance is unpredictable before meeting, and our sim and pack runs show no second-date gain from the rater. It can only be a coarse band.
2. **Elo or acceptance-derived desirability** (Tinder's old approach). It is the popularity loop the spec bans, Tinder retired it publicly, and it concentrates exposure (OkCupid 2009).
3. **An HNSW or ANN index over Clef/jevector vectors.** jevector's own 1,024-profile test recovers only 41-88% of the exact top-5. That breaks "exact or an honest bound", and HNSW is not deterministic across insert orders without care.
4. **Learning taste from received yeses or "people like you liked X" counts of who was liked.** That reintroduces popularity through the back door. Only pool what people like (attributes), never who is liked.
5. **Using Clef's zero-shot ratings without calibration on our population.** MLLMs compress and shift ratings, so the placeholder's assumed SD of 0.2 gives standing of unknown scale.
6. **Removing bias with a better head.** Bias already in Clef's answers passes straight through a group-blind linear head (our synthetic fit). Only the audit, a different question, or dropping the feature helps.
7. **Inferring orientation, trans status, ethnicity, age or disability from photos.** It is illegal in the EU (orientation, race), unethical, and inaccurate. Use stated facts only.
8. **Expecting the simulator to validate appearance changes as it stands.** Its rater is r ≈ 0.87 with the only appearance truth, and it has no private appearance taste.
9. **Tight parity bands for Date.** Band mode cost 30% of dates in iteration 4, and people accept moderately higher partners.
10. **Standing to cut Date search cost.** At band 15 plus uncertainties, the window is ±53 points: everyone. Speed must come from boundable pack, taste and compat terms (P5), not from standing.

---

## Part E. What is in place, what is weak, what to change first

| | State |
|---|---|
| In place | Adults-only gate before any photo read (`canRatePhotos`, `adultsOnly`, the photoRating state machine with three authority checks); never-shown rule with `appearanceLeak` and conformance tests; a bank with no protected-trait questions; a Bradley-Terry fitter with provenance, CV, ECE, alpha and rater flags; label-side and score-side bias audit; weekly outcome monitor by quintile and group; body-type preference (stated, then revealed); revealed personality taste from post-date ratings; the popularity ban on standing |
| Weak | Placeholder weights with assumed calibration; no P2 labels; `photos` missing, so u = 18 for all; uncertainty ignores rater confidence and spread; penalty ignores uncertainty; standing in z, not rank; no private appearance taste; Date pack term unboundable, so the search rarely closes exact; the sim rater is far better than any real one; no live check that standing predicts anything; open legal question on access rights to inferred ratings |
| Change first | 1. P1 (S): set `photos`, honest uncertainty. 2. P2 (M): percentile standing per pool. 3. P7 (M): validity, calibration and drift monitors with the switch-off rule. 4. P6 (M): plant appearance taste and realistic raters in the sim. 5. P4 + P5 (L, M): the private taste term with boundable search. 6. P3 (S) once P1 is in, re-tune the free gap. P8 and P9 (S) can go anytime. |

## Open questions

1. **Founder: is the Date consensus standing meant to *rank* or only to *band*?** If it only bands, set the penalty per point to 0 and keep a generous band. Prior measurements say ratings add no second dates.
2. **Counsel: inferred ratings and access requests.** Under CCPA and GDPR access rights, must the inferred rating be disclosed on request? The service currently excludes it from the export.
3. **Counsel: BIPA, CUBI and Washington.** Is per-photo Clef attribute extraction (no template) a "scan of face geometry"? Do we need written releases from members in those states, beyond the P2 rater study?
4. **Product: is a probe-level "no" to a photo probe acceptable as a taste observation?** It is more data, but it raises consent and selection-bias issues.
5. **Clef: which answer fields does the API return exactly?** In particular, is there a per-answer `confidence`? Do Cloudflare's model updates change answer distributions, and is a model version pin available?
6. **P2 data: who are the human raters?** Their own pool and orientation should match the pool being rated, because consensus differs by pool.
7. **Exploration share.** Is the current exploration slice large enough to power the P7 gap-validity check (about 3,500 photo probes per gap bin) within a pilot quarter?
