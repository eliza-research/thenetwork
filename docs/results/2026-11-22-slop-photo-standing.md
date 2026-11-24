# slop.date: honest private photo standing

Hand-written. Every number is copied from a saved output file. The saved outputs are not in the repository; they are in the run directory `<run dir>/w1-clef/` (the base run is `<run dir>/base/sim-slop.txt`). Each table and list names its file.

## What changed

- The production Clef rater (`WorkersAIClefRater.rate`) did not report its photo count. Every rated member had the uncertainty of one photo (18) whatever the number of photos or their agreement. The rater now reports the photo count and, from two or more photos, the spread of the per-photo overall ratings. The stored facet carries both.
- spec/memberStanding.md: the Date standing is the midrank percentile among the rated adults of the same market and dating pool (`standingPercentile`, `standingPoolReady` at twenty rated adults). One rated adult who joins or leaves a pool moves another member by at most the weekly step of five points (`lawStandingPercentileStableWhenOneJoins`). The uncertainty narrows with rated photos and widens with their disagreement (`ratingUncertainty`, with `lawRatingUncertaintyBounded`, `lawRatingUncertaintyShrinksWithPhotos` and `lawRatingUncertaintyGrowsWithSpread`).
- spec/weeklyBias.md: the validity monitor (`standingGapPredicts`, `standingOutcomePositive`, `standingOutcomeNegative`, with `lawStandingOutcomeHasOneSide`, `lawStandingKeptWhileOutcomesAreFew`, `lawStandingOffWhenGapOrdersNoBetterThanChance` and `lawStandingKeptWhenGapOrdersEveryPair`). With at least thirty positive and thirty negative outcomes, the Date lane keeps the standing only while the chance that a positive outcome has a smaller gap than a negative one is at least 0.55. Otherwise every Date member has the middle standing and the widest uncertainty.
- `packages/engine/src/packs/slop/standing.ts` (`DateStandings`) is the one implementation. The weekly bias report carries the monitor's counts and decision (`AppWiring.dateStanding`, `NetworkRuntime.dateStanding`, `biasReport`), and the weekly run writes an alert line while the lane does not use the standing.
- The three Clef rating questions ask how physically attractive the person in the photo is, not how attractive most dating-app users would find them. The question bank asks nothing about identity.
- The relay rule for money requests now matches "I'm short" and "we're short". Before, it needed a space after "i", so the simulator template "I'm short $500 for the bill" passed on content alone, and the slop relay gate depended on which pairs the matcher made.

## Command and settings

- Slop block: `corepack pnpm@10.24.0 run sim --only slop` (pinned seeds 13 to 16, 4 weeks, the slop world with catfish, body types, verification, relay, review, widen, check-in, photos and the rater). No LLM calls; the reviewer is simulated.
- Base: commit d483de38 (`base/sim-slop.txt`). Branch: this change (`w1-clef/sim-slop-fix1.txt`). The later edits on the branch change spec prose, test text and comments only.
- Standing always on: a scratch harness forces the monitor's decision to keep (`w1-clef/counterfactual.mts`, `MODE=on`, output `w1-clef/cf-on.txt`). With `MODE=monitor` (`w1-clef/cf-monitor.txt`) it reproduces the block run of that code exactly. Both ran on earlier code, before the monitor read the production outcomes, so compare the always-on column with the monitor column of the same code, not with the branch column.
- Seeds 13 to 24: a scratch harness prints the monitor per week and the lowest quintile per seed (`w1-clef/week-pattern.mts`, outputs `w1-clef/week-pattern-13-24.txt` and the repeat `w1-clef/week-pattern-13-24b.txt`). The same harness on the base code gives `w1-clef/q1-base-13-24.txt`.

## Results of the slop block

| Gate | Base (`base/sim-slop.txt`) | Branch (`sim-slop-fix1.txt`) | Monitor, earlier code (`cf-monitor.txt`) | Standing always on, earlier code (`cf-on.txt`) |
|---|---|---|---|---|
| Blocking gates of the slop block | 45/45 | 45/45 | not run as a block | not run as a block |
| Lowest rating quintile dates vs overall (blocking, >= 0.85x) | 0.928 | 0.875 | 0.909 | 0.855 |
| Top-10% share of proposals (blocking, <= 20%) | 0.161 | 0.162 | 0.160 | 0.167 |
| Harm events cut (blocking, >= 90%) | 93.9% | 93.9% | 93.9% | 92.9% |
| Dates per member-month vs random (tracked, >= 0.9x) | 0.834 | 0.866 | 0.851 | 0.827 |
| Second-date rate vs random (tracked, >= 2.5x) | 1.923 | 2.242 | 2.422 | 1.895 |
| Second dates per seed vs random (tracked, >= 2x) | 1.541 | 1.892 | 2.000 | 1.514 |
| Lowest group vs overall (tracked, >= 0.7x) | 0.324 (woman:lesbian) | 0.432 (man:gay) | 0.345 (man:gay) | 0.420 (man:gay) |
| Same, feasible members (tracked, >= 0.7x) | 0.352 | 0.501 | 0.392 | 0.524 |
| Minor contacts (age liars) cut (tracked, >= 90%) | 70.6% | 88.2% | 76.5% | 82.4% |
| Adversary contacts cut (tracked, >= 90%) | 48.5% | 58.8% | 58.8% | 63.9% |
| Back-outs at reveal (tracked, < 10%) | 0.130 | 0.135 | 0.131 | 0.131 |

Declared-minor contacts and scam harm stay at their gates in both block runs. The relay gate "scam and harassment items held or blocked" is 100.0% in thread and on content alone (n 35) on the branch.

The new tracked measure (`sim-slop-fix1.txt`): the monitor kept the photo standing in 8 of 16 weekly snapshots. Last-week outcomes per seed (positive/negative) were 118/598, 108/606, 111/579 and 117/615. 1400 of 6639 placed members (21.1%) had an uncertainty narrower than the widest.

## The monitor per week and the lowest quintile over twelve seeds

From `week-pattern-13-24.txt` (48 weekly views):

- Every seed keeps the standing in week 0, where there are no outcomes yet. Each seed leaves keep at most once and does not come back. Seed 24 keeps it every week (0.615, 0.580, 0.571). Seed 13 keeps it through week 2 (0.558, 0.581) and turns it off in week 3 at 0.543, under the 0.55 margin.
- Every counted negative is a decline or a no-answer expiry; 0 are partner-cap drops and 0 are other expiries. On seeds 13 to 16 in the last week: declined 414, 383, 401 and 432; no answer 184, 223, 178 and 183.

Lowest quintile, base (`q1-base-13-24.txt`) and branch (`week-pattern-13-24b.txt`):

| Seeds | Base | Branch |
|---|---|---|
| 13 to 16 (the block's seeds) | 0.928 | 0.875 |
| 17 to 20 | 0.943 | 0.945 |
| 21 to 24 | 0.879 | 0.967 |
| All 12 | 0.917 | 0.970 |

The 12-seed bootstrap of the branch gives a 95% interval of 0.886 to 0.979. A 4-seed run drawn from the 12 seeds gives 0.832 to 0.969, and 5.3% of the draws fall below 0.85. The fall on seeds 13 to 16 is within seed noise, but the blocking gate on four pinned seeds can fail by chance about once in twenty runs.

## Integration cases

- `packages/network/test/slop-standing-monitor.integration.test.ts`: 60 rated adults join slop by text on a real ConsentNetwork. 30 dates with large percentile gaps are checked in, 30 introductions with gap 0 get a probe no, and 4 introductions replace a no with an alternate. The monitor must count 34 positive and 30 negative outcomes and turn the standing off, and the report must carry the alert line and no member id or rating. Before the monitor fix it failed with 0 positive outcomes (`test-monitor-old.txt`); after it, it passed (`test-monitor-fix2.txt`). Before the fix, production had no outcomes at all: a check-in record is "completed" or "no_show" with no `acceptedBy`, and a probe no closes as "expired" with no `declinedBy`.
- `packages/engine/test/slop-standing.integration.test.ts`: the production rater answers through a stand-in at the Workers AI HTTP boundary, and the photo count and spread reach the Date profile. It also checks the percentile, the small pool, the monitor in both directions and the identity topics of the question bank.
- `packages/network/test/bias-date-window.integration.test.ts`: staff see the monitor's counts and decision on `/bias`, and no member id or rating.
- The relay block gate "relay: every scam and harassment template of the slop world stops on its content alone" (`scripts/sim/relay.ts`): every scam and harassment template of the simulator stops on its content alone.

## Decisions made

- Penalty forgiveness inside the uncertainties is not adopted. A penalty on `max(0, gap - freeGap - uncertaintyA - uncertaintyB)` breaks `lawSmallerGapNeverWorse` in spec/pairValue.md. With the Date row of spec/matchLane.md (free gap 10, 10 per point, band 15), a nearer partner at gap 15 with uncertainty 0 costs 50, and a farther partner at gap 20 with uncertainty 10 is admissible and costs 0. The least penalty of spec/candidateSearch.md would also have to subtract the member's uncertainty plus the uncertainty ceiling. It also rewards unrated members.
- No hysteresis: no seed went from off back to keep (`week-pattern-13-24.txt`). spec/weeklyBias.md states the asymmetry of the switch.
- The monitor counts only the final pair of each introduction, as the production network records it. The simulator writes one record per proposed pair, so the slop block measures a larger sample of negatives than production gives.
- The monitor is kept as it is: a restriction-aware variant that reads only pairs placed while the standing was off also decided off. Pairs placed with the standing off had the full range of gaps (sd 23.6) and an AUC of 0.481 (`measure-1.txt`). In the simulator oracle, attraction depends mainly on the level of the other person and only weakly on the gap.

## Limits of this evidence

- The simulated rater reports 1 to 4 photos and a spread from its own per-photo noise, but the photo count does not change the error of its rating. The slop block exercises the uncertainty rule and cannot show that it makes matching better.
- The simulator passes no standing history, so the weekly step never runs there.
- The age-slip relay gate passed with 0 slips of 0 on the branch (`sim-slop-fix1.txt`); the base run had 1. That gate tested nothing in this run.
- One block run per state, seeds 13 to 16. The block's run time (837.5 s on the branch, 310.6 s on the base) came at different machine loads and cannot be compared.

## Open decisions for the owners

1. The network owner: write one record for each replaced no and for each probe that a budget or an absence replaces, so that production counts every declined pair. This also changes the response history and slop responsiveness of every app.
2. The network owner: carry a close reason on the interaction record, so that blocks, holds and opt-outs stop counting as negatives.
3. The simulator owner: derive the simulated rating error from the per-photo draws. This moves every slop number.
4. The product owner: pin more seeds for the lowest-quintile gate, or accept a chance failure of about 5% on four seeds.
5. The product owner: keep the photo standing in the Date lane at all. In the simulator the gap gives no predictive value. Always on, against the monitor on the same code, the standing costs second dates (2.000 to 1.514 per seed against random, under the tracked 2x target) and dates per member-month (0.851 to 0.827), brings the lowest quintile to 0.855, near its 0.85 gate, and gains on the lowest group (0.345 to 0.420) and on the minor-contact cut (76.5% to 82.4%).
6. The tools owner: `tools/clef-label/index.html` still asks which person "most dating-app users" would find more attractive, and the fitted weights learn from those labels.
