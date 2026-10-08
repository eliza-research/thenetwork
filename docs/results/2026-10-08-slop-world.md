# slop.date simulated world: personas, oracle, harness and baselines (2026-10-08)

slop.date is dating, the first app on The Network's shared matching engine. This report describes the simulated world in the new package `packages/sim/src/apps` (`src/slop/`): the persona model with hidden truth, the snapshot the matcher sees, the oracle, the persona behaviour in the probe-first harness, the metrics, and three baselines. It gives the calibration and the baseline numbers that the slop AppPack must be compared against.

- Code: `packages/sim/src/apps/slop/*.ts`, tests in `packages/sim/src/apps/test/slop.test.ts` (12 tests, offline, keys empty).
- Hand-written: this report and the model. Generated: every number in the tables (commands below).
- LLM use: none for any number here. The optional prose pass (`prose.ts`, `defaultLLM()`, gpt-6-luna) was run once as a smoke test on 6 personas: 6 calls, $0.000084, cached in `runs/worlds/slop-prose-cache/` (a rerun had 6 cache hits and $0). Bios do not enter the oracle or the harness.
- Not touched: `packages/engine`, `packages/sim`, `packages/network`, `packages/observatory`. The world imports read-only types from `packages/core` and `packages/engine/src/types.ts`, and reuses `Rng`, `hash32`, the interest taxonomy and the richness tiers from `packages/sim`.

## Result in brief

- **Calibration hits both targets.** Over 8 seeds (300 personas per city, 3 cities, 4 weeks), random matching within the stated filters gives an **8.2% ± 0.6** second-date rate per first date (soft label on random honest pairs: 8.6%). The oracle-optimal upper bound gives **36.6% ± 1.1**. The targets were about 5-10% and about 35-45%.
- **The desirability hierarchy reproduces Bruch & Newman (2018).** P(reply) to a like that goes "up" is **21.6%** (their 21%). 66% of likes go to someone more desirable.
- **Stated preferences predict little.** The stated "type" explains **5.2%** of the pair-specific attraction (taste plus chemistry); the hidden taste explains 81%; chemistry is unknowable by design (Joel, Eastwick & Finkel 2017).
- **Greedy by desirability shows the congestion failure.** The top 10% of members get **41.5%** of proposals (random 11.9%), 847 proposals per seed die at the attention cap, the mutual-yes rate falls from 16.6% to 6.7%, and it makes fewer dates than random (104 vs 119 per seed).
- **Safety is the gap the slop pack must close.** Random and greedy use only stated data and safety holds. They reach **55 and 47 adversary contacts per seed**, about **38 and 34 harm events**, and **6.5 and 7.3 contacts with hidden minors** (age liars who claim 18+). Declared-minor contacts are 0 in every arm, as the policy requires.

## Commands

```bash
# Baselines (table below), no LLM, keys empty
OPENAI_API_KEY= SURPLUS_API_KEY= CEREBRAS_API_KEY= bun run packages/sim/src/apps/slop/cli.ts --seeds 1-8 --per-city 300 --weeks 4
# Calibration diagnostics (and a parameter grid with --grid '{"dateLift":[1.3,1.6]}')
OPENAI_API_KEY= SURPLUS_API_KEY= bun run packages/sim/src/apps/slop/calibrate.ts --seeds 1-8 --diag
# Tests
OPENAI_API_KEY= SURPLUS_API_KEY= CEREBRAS_API_KEY= bun test --conditions eliza-source ./packages/sim/src/apps
```

Seeds 1-8. One run is 900 personas over 4 weekly rounds and takes about 0.3-0.5 s.

## 1. Persona model (`persona.ts`)

Each persona has **hidden truth** (only the oracle reads it) and a **stated profile** (what the member would tell the agent over iMessage). The snapshot shows a richness-filtered subset of the stated profile.

| Part | Hidden truth | Stated (what the agent can learn) |
|---|---|---|
| Age | `trueAge`: 18-60 (70% N(30, 5.5), 30% uniform); 4% of personas are 13-17. `isMinor` is set only here | `claimedAge`. 40% of minors claim 18-20 (adversary `age_liar`); the others give their real age |
| Gender | Coarse `matchGender` (woman / man / nonbinary, 48/48/4%), separate from `identity` (cis/trans woman/man, nonbinary, genderqueer, agender) and `orientation` | Same values. Matching uses `matchGender` and `seeks` only |
| Who they want | Revealed `seeks`, revealed age range (the stated one, 2 years wider for less desirable people) | `seeks`, stated age range (men about [age-8, age+3], women [age-3, age+8], nonbinary +-6, with noise) |
| Location | Home zip with a real centroid in the SF, NYC or LA metro (51 zips); `scope`: city (55%), radius of 5-50 miles around the zip (45%); 5% date in two cities (alternating weeks), 4% travel to another city for one week | The zip, the scope, the max miles. Distances are shown only as buckets: under 2, 2-5, 5-10, 10-25, 25+ mi |
| Attraction | `desirability` D ~ N(0,1) plus an age curve (Bruch & Newman: falls with age for women, peaks near 40 for men); `warmth` (actor effect); `traits` (5 dims) and a unit `taste` vector over others' traits (revealed type) | `selfTraits` = traits + N(0, 0.8) noise; `wantsTraits` = stated type, correlation about 0.35 with the revealed taste (Eastwick & Finkel 2008) |
| Goal | casual 25% / long-term 45% / unsure 30% | 40% of "unsure" say long-term |
| Values and dealbreakers | smoking, drinking, has kids, wants kids, religion and its importance (0-3), politics; dealbreakers drawn from the values | Values as held; 85% of real dealbreakers are stated, and 30% add a "soft" dealbreaker they do not hold |
| Interests, date activities | 3-6 interest tags (sim taxonomy); 2-4 first-date activities tied to the interests plus coffee, drinks or walk | Same |
| Availability | Per weekly slot (Mon-Fri evening, Sat/Sun day and evening) P(free); 1-3 free weekday evenings at 0.85, others 0.15; a weekly shock (p = 0.15) makes a slot busy. Draws are keyed by (seed, member, week, slot) as in the attention harness | `usuallyFree`: slots with P(free) >= 0.5 (90%), plus 10% noise |
| Behaviour | appetite (weekly swing SD 0.15), reply probability (N(0.82, 0.12)), reply latency (log-normal, median 45 min), flakiness (log-normal, median 0.08), feedback honesty (N(0.9, 0.08)) | - |
| Richness tier | minimal 15%, light 25%, medium 30%, rich 20%, very rich 10% (as the sim). Controls what the agent knows (table below) | - |
| Adversary | `romance_scammer` 1%, `catfish` 1.5%, `harasser` 1.5%, `not_single` 3%, `age_liar` (the lying minors, about 1.6%). Scammers and catfish get +0.8 desirability (attractive fake profiles) | Scammers state "long-term". Everyone states "single" |

What the agent knows by tier (`snapshot.ts KNOWS`):

| Tier | Known |
|---|---|
| minimal | claimed age, matching gender, who they seek, zip |
| light | + age range, scope and max miles, goal, occupation; 30% of interests and free slots |
| medium | + smoking, drinking, kids; first-date activities; 50% of interests, 60% of free slots |
| rich | + religion, politics, stated dealbreakers, stated type and self-description, identity and orientation; 80% of interests, 90% of free slots |
| very rich | everything stated, plus the bio |

Safety cues (`SIGNAL_RATES`): the agent notices a cue in the onboarding chat with a probability that grows with richness. Age signal for age liars 20-80%; scam pattern 15-50%; photo mismatch 15-35%; hostile language 10-40%; relationship signal 5-25%. False positives: 1% per cue on honest members, 6% for an age signal on an honest 18-19 year old. These are observable cues, not the hidden label. No baseline uses them yet; the slop pack should.

## 2. Snapshot mapping (`snapshot.ts`, read back with `visible.ts`)

`buildSlopSnapshot(personas, state)` returns a core `WorldSnapshot` plus `interactions`, `feedback` and `safetyHolds` (types from `packages/engine/src/types.ts`) and `inboundAsks`. Dating fields go into facet tags, so no core type changes are needed except the city (below).

| Field | Where | Scope |
|---|---|---|
| Claimed age | `Member.age` | - |
| Romance on/off | `Member.prefs.romanceOptIn = canBeMatched(claimed age)`; `categoriesOptIn: ["romance"]` (minors: `["social"]`) | - |
| Home city | `Member.homeCity`, `Presence {type: "home", areas: ["zip:<zip>"]}` | - |
| Zip | fact `slop:zip:<zip>` (centroid only; never lat/lon) | agent_private |
| Matching gender, seeks, age range | preference `romance:is:<g>`, `romance:seeks:<g>` (one per gender), `romance:age:<lo>-<hi>` (absent until asked) | agent_private (same tags the engine already reads) |
| Location scope | preference `slop:scope:city` / `slop:scope:radius:<mi>` / `slop:scope:multi:<c1>,<c2>`, plus `slop:max_miles:<mi>`; multi-city: `Presence {type: "routine"}` per other city | agent_private |
| Trips | `Presence {type: "temporary", from, to}` in the week of the trip and the week before | - |
| Goal | goal `slop:goal:<casual,long_term,unsure>`; `Intent.details = "goal: <goal>"` | matchable |
| Values | fact `slop:smoking:*`, `slop:drinking:*` (matchable); `slop:has_kids:*`, `slop:wants_kids:*` (sensitive children); `slop:religion:*` + `slop:religion_importance:<0-3>` (sensitive religion); `slop:politics:*` | as listed; all non-matchable ones agent_private |
| Dealbreakers | boundary `slop:dealbreaker:<smoker, heavy_drinker, has_kids, wants_kids, no_kids_ever, religious, nonreligious, right_politics, left_politics>` | agent_private |
| Interests | interest `<tag>` | 60% shareable, else matchable |
| First-date activities | preference `slop:activity:<coffee, drinks, dinner, walk, museum, live_music, comedy, climbing, hike, cooking_class>` | matchable |
| Usually free | availability_pattern `slop:free:<mon_eve ... sun_eve>` | agent_private |
| Stated type / self-description | preference `slop:wants:<dim>=<x>`; fact `slop:self:<dim>=<x>` (dims: adventurous, intellectual, artsy, ambitious, homebody) | agent_private / matchable |
| Identity, orientation | fact `slop:identity:<id>`, `slop:orientation:<o>` | agent_private, sensitive sexuality |
| Occupation, bio | fact `slop:occupation`, `slop:bio` | shareable |
| Safety cues | fact `safety:age_signal`, `safety:scam_pattern`, `safety:photo_mismatch`, `safety:hostile_language`, `safety:relationship_signal` (provenance inferred) | agent_private |
| The date want | `Intent {category: "romance", objective: "go on dates", createdAt: last inbound ask}` | - |
| History | `interactions` (one per proposal: declined, expired, cancelled, no_show, completed, with acceptedBy / declinedBy / noResponse), `feedback` (sentiment, wouldMeetAgain, as reported), edges `met` and `blocked`, `safetyHolds` from reports, `inboundAsks` ("find me someone this week"), paused members (`Member.state = "paused"` after they start seeing someone) | - |

Minors: every facet of a member with a claimed age under 18 is agent_private; they have no romance facet and no romance intent. There is no minor flag anywhere in the snapshot.

**Proposed core change:** `City` in `packages/core/src/types.ts` is `"sf" | "nyc"`. slop adds `"la"`. The world casts at one place (`asCoreCity`). Widen `City` (and `CITY_TZ` in the sim) when LA goes live.

`visibleProfiles(snapshot)` reads the snapshot back into a typed `VisibleProfile` per member (unknown fields are `undefined`). `visibleMutualCities(a, b)` is the mutual filter on visible data: both matchable by claimed age, not paused, each in the other's `seeks` and age range, and a city both date in with the zip-centroid distance inside both limits. For a field the agent has not learned, it assumes `UNKNOWN_DEFAULTS` (age range +-7 years, 25 miles). A wrong guess is a **stated-filter violation**: the member backs out at the reveal with p = 0.9. The tests check that changing any hidden field leaves the snapshot byte-identical, and that no canary, hidden field name or adversary label is in it.

## 3. Oracle (`oracle.ts`, pure and offline)

All draws are seeded (`hash32(seed, ...)`), so the oracle is a function of (personas, seed).

- **Perceived attraction** (before meeting), logit scale: `L(a->b) = c0 + warmth_a + wD * D_b + wT * (taste_a . traits_b) - ageOut - wS * D_a`, and `attraction = sigmoid(L)`. Actor effect (warmth), partner effect (the desirability hierarchy, the same in every city), the revealed type, the age range, and selectivity (more desirable people are pickier).
- **Compatibility** `compat_a(b)` in (0, 1]: x0.2 per real dealbreaker that b violates; goals casual vs long-term x0.6, one unsure x0.85; regular smoker vs never x0.8; regular drinker vs never x0.85; religion importance differs by 2+ x0.85; left vs right x0.75; kids yes vs no (long-term) x0.7; shared interests 0 x0.88, 1 x0.95.
- **Chemistry** `chem(a,b) ~ N(0, chemSd)`, **symmetric** per pair (keyed by the sorted pair), unknowable before the date.
- **Date quality.** Each side's enjoyment is `e_a = sigmoid(L(a->b) + dateLift + chem + N(0, sideSd)) * compat_a(b) * activityFit_a`. activityFit is 0.92 if the planned activity is not one they like. An adversary across the table multiplies it by 0.2. Quality is `sqrt(e_a * e_b)`: attraction both ways x compatibility x chemistry.
- **Good date:** `min(e_a, e_b) >= 0.4`. **Second date:** both `e >= 0.5`, then logistics p = 0.85.
- **Soft labels** `softLabel(a, b, activity, K)`: `pGood`, `pSecond` and the mean quality, by Monte Carlo over K chemistry draws (default 64). This is the same method as judge v2's `pGood` (`packages/evals/src/recDataset.ts`). Pairs with a minor or an adversary get 0.
- **P(mutual like on the probe)** `pMutualProbe`: the product of each side's reply probability and `probeYesProb`. The probe is anonymous, so the yes depends on the week's appetite, receptivity (x0.6 after a date they liked in the last 2 weeks; Rios, Saban & Zheng), fatigue (x0.8 per earlier probe this week), activity fit (x0.75 if not theirs), the shareable fact (x1.1 if it matches an interest), ask priming (x1.35, capped at 0.95, if they asked for a date this week) and presence in the city (x0.05 if away). It does not depend on the other person: their desirability shows at the reveal. Scammers say yes with p = 0.95, harassers and catfish with p = 0.88.
- **P(date happens)** `pDateHappens`: both reply and say yes, x (1 - back-out) for each, where back-out = `0.12 * (1 - attraction)^2` when the plan names the person (0.9 if they are outside the member's stated filters), x show-up for each = `(1 - flakiness) * (1 if a common free slot was booked, else 0.3)`.
- **Safety harms** `harms(a, b)`. At the reveal: a scammer moves the chat off the platform (0.9), asks for money (0.6) and takes money (0.12); a harasser harasses (0.5); contact with a hidden minor is a harm (1.0). At the date: a catfish does not match their photos (0.9); a member who is not single is found out (0.3). Victims report with p = 0.25-0.9 by kind. A report puts the offender on a safety hold, and the victim blocks the offender. Both are visible in the next snapshot.

### Calibration (`calibrate.ts`)

Parameters (`ORACLE_PARAMS`): c0 -1.25, wD 0.9, wT 1.8, wS 0.4, ageOut 0.3 per year, chemSd 0.9, sideSd 0.35, dateLift 1.6, good 0.4, wantSecond 0.5, logistics 0.85, backout 0.12. The founder's targets fixed wT, dateLift and chemSd. A grid over dateLift {1.3, 1.6, 1.9} x wT {1.4, 1.8} (4 seeds each) gave these second-date rates, random vs oracle-optimal: 5.9/29.6, 5.8/31.3, 7.7/36.1, **7.9/38.6**, 9.3/41.8, 9.8/42.4. The chosen point is in the middle of both target ranges.

| Target (research) | Measured (8 seeds, or seed 1 for the pair diagnostics) |
|---|---|
| Random within filters: about 5-10% second dates | 8.2% ± 0.6 per first date in the harness; 8.6% mean pSecond over 2,010 random honest stated-mutual pairs (pGood 15.8%) |
| Perfect knowledge: about 35-45% | 36.6% ± 1.1 (oracle-optimal matcher in the harness) |
| About 21% reply to messages (Bruch & Newman 2018) | P(b likes a back given a liked b) 28.5% overall, **21.6% when b is more desirable** |
| People reach "up" (Bruch & Newman: about 25% more desirable) | 66% of likes go up; the mean gap is +15.8 desirability percentile points |
| Stated preferences predict attraction poorly (Eastwick & Finkel 2008); relationship variance about 0% predictable before meeting (Joel et al. 2017) | Stated type explains 5.2% of the pair-specific component (taste + chemistry); the hidden taste explains 81%; the chemistry part (about 20% of the latent variance) is unknowable even to the oracle |
| Known: about 80% of intros become dates; Ditto: about 20% match-to-date | Date given mutual yes: random 48.5%, oracle 72.3% (lower than Known because of back-outs, no-shows at times the member is not free, and adversaries) |

## 4. Behaviour model and harness (`behavior.ts`, `world.ts`)

Weekly rounds (4 weeks = 0.92 member-months). Every week:

1. **Inbound asks.** Each member asks the agent for a date with p = appetite x 0.35 (scammers and harassers 0.6). Asks are visible as `inboundAsks` and as `Intent.createdAt`, and they prime the probe answer.
2. The matcher reads the snapshot and returns `SlopProposal`s: `{first, partner, city, activity, options (2-3 slot indices), sharedFact?}`.
3. **Probe-first flow with the booked-plan reveal** (experience design 1.8; attention-budget iteration 4, design (c)). Probe the first member with the time options. A yes picks the offered slots they are really free for; "yes, but not those times" continues with p = 0.6. On a yes, probe the partner with the first member's picks. On both yeses, the reveal is the booked plan at a slot both picked (else the first offered slot). Silence = in; a back-out cancels. The agent planned the activity and the time.
4. **Caps:** at most `capPerWeek` = 2 initial invites per member per week (first or partner probe; decision 3), and at most one booked date per week. A proposal past a cap is dropped.
5. **Date:** both show or not, the oracle scores the date with this world's chemistry, adversary scripts run, each side gives feedback if they reply (p = 0.9 x replyProb; ghosters do not answer). The answer is truthful with p = honesty, and the rating is 1-5 from enjoyment. A second date happens if both want one (x0.85). A couple then pauses the app with p = 0.5 each.

## 5. Metrics (`metrics.ts`)

Per-member rates use **real members**: true adults who are not adversaries (about 860 per seed). Funnel: probe reply and yes rates, mutual-yes rate (both yes / first probes delivered), back-out at the reveal, date given mutual yes, attendance (dates / booked plans), dates per member-month, good-date and second-date rates, mean quality, share of booked seats at a time the member was not really free. Congestion: Gini of probes received and of proposals, share of real members with zero proposals, top-10% share. Safety: declared-minor contacts (claimed age under 18 in any proposal; **must be 0**), hidden-minor proposals and contacts (age liars reaching a reveal), adversary proposals and contacts (reveals), harm events by kind and how many were reported. Time to first date: median day of the first date, share of members with a date. Fairness: the same rates by matching gender and by matching gender x orientation, and the min/max ratio of dates per member-month over groups with n >= 15.

## 6. Baselines (`baselines.ts`)

- **random-within-filters:** each week, in random order, each unmatched member gets a uniform random partner among `visibleCandidates` (visible mutual filter, no visible dealbreaker either way, not on a safety hold, not met or proposed before). One proposal per member per week. The member who asked this week is probed first. `planDate` picks a shared activity and 3 slots that favour both members' stated free slots, and the probe's shareable fact.
- **greedy-desirability:** each member is proposed the most desirable visible candidate. Hidden desirability stands in for the popularity signal that a swipe app would observe. There is no limit on how often one person is proposed. This is the congestion failure mode.
- **oracle-optimal (upper bound):** hidden truth except chemistry. Each week it takes a greedy maximum-weight matching (1/2-approximation) over truly eligible pairs (stated mutual, true adults, no adversaries, both in the city that week). The weight is P(date happens) x P(second date | date), with pSecond from 32 chemistry draws (Laplace-smoothed). It offers truly free time options and an activity both like. Network code may not do this.

### Numbers (seeds 1-8, 300 personas per city x 3 cities, 4 weeks; mean ± SE over seeds)

| Metric | random | greedy | oracle-optimal |
|---|---:|---:|---:|
| Proposals / seed | 1469 ± 7 | 3250 ± 8 | 1230 ± 8 |
| Probes delivered / seed | 2134 ± 15 | 3622 ± 13 | 1897 ± 14 |
| Dropped at a cap / seed | 0 | 847 ± 9 | 0 |
| Probe reply rate | 82.1% ± 0.4 | 81.3% ± 0.3 | 81.3% ± 0.3 |
| Probe yes rate | 42.6% ± 0.5 | 39.9% ± 0.2 | 48.4% ± 0.4 |
| Mutual yes rate | 16.6% ± 0.5 | 6.7% ± 0.2 | 20.5% ± 0.4 |
| Back-out at reveal | 17.3% ± 0.6 | 16.9% ± 0.7 | 9.4% ± 0.8 |
| Date given mutual yes | 48.5% ± 1.7 | 51.3% ± 1.4 | 72.3% ± 1.2 |
| Attendance (dates / booked) | 58.7% ± 1.8 | 61.8% ± 1.7 | 79.8% ± 0.9 |
| Dates / seed | 119.0 ± 6.1 | 104.1 ± 4.0 | 182.9 ± 5.4 |
| Dates per member-month | 0.284 ± 0.016 | 0.244 ± 0.009 | 0.498 ± 0.015 |
| Good-date rate | 16.8% ± 1.2 | 13.5% ± 0.6 | 53.5% ± 1.4 |
| **Second-date rate (per date)** | **8.2% ± 0.6** | **7.1% ± 0.6** | **36.6% ± 1.1** |
| Second dates / seed | 9.8 ± 0.9 | 7.5 ± 0.8 | 66.9 ± 2.2 |
| Mean date quality | 0.248 ± 0.009 | 0.237 ± 0.007 | 0.471 ± 0.010 |
| Seats at a not-free time | 16.8% ± 1.0 | 14.7% ± 0.8 | 1.4% ± 0.3 |
| Stated-filter violations / seed | 122.3 ± 3.3 | 254.0 ± 10.4 | 0 |
| Gini, probes received | 0.237 ± 0.003 | 0.131 ± 0.002 | 0.289 ± 0.005 |
| Gini, proposals | 0.136 ± 0.003 | 0.433 ± 0.004 | 0.201 ± 0.005 |
| Zero-proposal share | 2.2% ± 0.2 | 1.6% ± 0.2 | 4.4% ± 0.4 |
| Top-10% share of proposals | 11.9% ± 0.1 | 41.5% ± 0.4 | 13.0% ± 0.1 |
| Members with a date (in 4 weeks) | 23.5% ± 1.1 | 19.5% ± 0.7 | 39.0% ± 0.8 |
| Median days to first date | 13.0 ± 0.2 | 14.5 ± 0.6 | 10.3 ± 0.4 |
| Declared-minor contacts (must be 0) | 0 | 0 | 0 |
| Hidden-minor contacts (age liars) / seed | 6.5 ± 0.9 | 7.3 ± 0.8 | 0 |
| Adversary proposals / seed | 197.8 ± 5.7 | 514.6 ± 22.6 | 0 |
| Adversary contacts (reveals) / seed | 55.0 ± 1.6 | 46.6 ± 1.9 | 0 |
| Harm events / seed | 38.4 ± 1.4 | 33.8 ± 1.8 | 0 |
| Fairness: min/max dates per member-month (groups n >= 15) | 0.25 ± 0.04 | 0.30 ± 0.06 | 0.34 ± 0.03 |

Dates per member-month by matching gender: random man 0.289, woman 0.290, nonbinary 0.164; greedy 0.244 / 0.242 / 0.262; oracle 0.504 / 0.504 / 0.344. The smallest groups (lesbian women, about 24 per seed; gay men, about 38) are the lowest in random (0.135 and 0.200) and in the oracle (0.304 and 0.327): small pools within a radius. Groups under 15 members are too small to compare.

How to read it:

- Over 8 seeds, a difference under about 2 SE is noise. Random vs greedy second-date rates (8.2 vs 7.1) are a tie. Greedy loses on dates (104 vs 119), on the mutual-yes rate (6.7% vs 16.6%) and on congestion.
- Random and greedy attendance is low (59-62%) mostly because of adversaries: scammers do not show 85% of the time and catfish 50% of the time, and they say yes to almost every probe. A safety-aware matcher should raise attendance by itself.
- Random and greedy make 120-250 proposals per seed outside a member's stated filters. These are minimal-tier members whose age range or distance the agent never asked about. The slop pack should ask first (engine v1.2 `romance_prefs` ask) rather than guess.
- The oracle row is not a target to reach. Chemistry caps it, and it uses hidden truth (taste, true availability, adversary labels). A good slop pack should land between random and the oracle on second dates per seed, with 0 declared-minor contacts and far fewer adversary contacts than random.

## 7. Interface for the slop pack

```ts
import { runSlopWorld, slopMetrics, BASELINES, visibleProfiles, visibleMutualCities, planDate,
         type SlopMatcher, type MatcherContext, type SlopProposal } from "packages/sim/src/apps/src/slop/index.ts";

const slopPack: SlopMatcher = {
  name: "slop-pack",
  propose(ctx: MatcherContext): SlopProposal[] {
    // ctx.snapshot: SlopSnapshot (WorldSnapshot + interactions, feedback, safetyHolds, inboundAsks)
    // ctx.profiles: Map<MemberId, VisibleProfile> (the same data, typed); ctx.rng: seeded; ctx.capPerWeek
    // Return {first, partner, city, activity, options: slot indices into SLOTS (2-3), sharedFact?}.
    // `first` is the member with the live want; the partner is probed only after the first says yes.
    return [];
  },
};
const m = slopMetrics(runSlopWorld({ seed: 1, perCity: 300, weeks: 4, matcher: slopPack }));
```

- The pack must read only `ctx.snapshot` / `ctx.profiles`. Matchers that need hidden truth get the world via a factory (`matcher: w => ...`), which is reserved for baselines.
- An engine-backed pack can map `EngineProposal` to `SlopProposal`: the participants become first and partner, `Proposal.city` becomes the city, and the time options and activity come from the planner. Compare it with `bun run packages/sim/src/apps/slop/cli.ts` after adding it to `BASELINES` or calling `runSlopWorld` directly with the same seeds.
- Acceptance bar, against the same seeds: declared-minor contacts 0; hidden-minor contacts and adversary contacts well below random's 6.5 and 55 per seed (use the `safety:*` cues, holds and blocks); second dates per seed above random's 9.8; top-10% proposal share near random's 11.9%, not greedy's 41.5%.

## 8. Limits

- Chemistry, the date-lift, the back-out and the harm probabilities are modelling assumptions calibrated to the targets above. They are not fitted to slop.date data. Recalibrate when real outcomes exist.
- The harness resolves each proposal within its week; it does not model reply latency against send windows (the attention harness does). The partner probe always goes in the same week.
- There is no conversation: onboarding is reduced to what each tier knows, and the safety cues are drawn once at join. Inbound-ask text, relay, reschedules and multi-week plans are not modelled.
- Desirability is one dimension with a homogeneous effect across cities (as Bruch & Newman found). Cultural differences between cities are not modelled.
- The oracle-optimal matcher is a 1/2-approximation of the maximum-weight matching, week by week (myopic). It is a lower bound on the true optimum and therefore a conservative upper bound for a pack.
- The zip centroids are approximate (about 0.005 degrees) and were entered by hand.

## References

- Bruch, E. E., & Newman, M. E. J. (2018). Aspirational pursuit of mates in online dating markets. *Science Advances*, 4(8).
- Eastwick, P. W., & Finkel, E. J. (2008). Sex differences in mate preferences revisited: Do people know what they initially desire in a romantic partner? *JPSP*, 94(2).
- Joel, S., Eastwick, P. W., & Finkel, E. J. (2017). Is romantic desire predictable? Machine learning applied to initial romantic attraction. *Psychological Science*, 28(10).
- Pizzato, L., Rej, T., Chung, T., Koprinska, I., & Kay, J. (2010). RECON: a reciprocal recommender for online dating. *RecSys 2010*. Reciprocal scoring raised success from 26% to 45%.
- Rios, I., Saban, D., & Zheng, F. Improving match rates in dating markets through assortment optimization. Receptivity-aware pacing: +27% matches; recently matched users like less.
- Hinge, "Most Compatible" (Gale-Shapley based): its picks were 8x more likely to lead to dates.
- Known (beta): about 80% of intros became dates. Ditto: targets about 20% match-to-date.
- Internal: `docs/design/2026-10-07-experience-design.md` 1.8, `docs/results/2026-10-07-attention-budget.md` iteration 4, `docs/results/2026-10-07-judge-v2.md` (pGood).
