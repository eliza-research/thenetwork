# Scale ladder and the no-n² gates (2026-11-21)

This report gives the first run of the scale ladder of the matching block (plan item 1 of
[R12-ranked-plan.md](../research/2026-11-17-matching-optimization/R12-ranked-plan.md)). It is hand-written from saved
command output. The table rows are copied from that output. The numbers come from the simulator with pinned seeds and
no model calls. No real member data and no LLM call is in this report.

Every number below comes from one of these saved output files (outside the repository, on the build machine):

| File | What it holds |
|---|---|
| `/Users/nubs/tn-work/base/sim-matching-quick.txt` | the baseline quick matching block (before) |
| `/Users/nubs/tn-work/w1-bench/sim-matching-quick-4-slop.txt` | the quick matching block, slop (after) |
| `/Users/nubs/tn-work/w1-bench/sim-matching-quick-4-friends.txt` | the quick matching block, friends (after) |
| `/Users/nubs/tn-work/w1-bench/sim-matching-quick-4-peon.txt` | the quick matching block, peon (after) |
| `/Users/nubs/tn-work/w1-bench/sim-matching-quick-4-ntwrk.txt` | the quick matching block, ntwrk (after) |
| `/Users/nubs/tn-work/w1-bench/hard-worlds-1.txt` | the harder worlds to N 20,000 (by hand) |
| `/Users/nubs/tn-work/w1-bench/digest-base.txt`, `digest-bench.txt` | the default-world digests before and after |

## What the ladder measures

`scripts/sim/scale.ts` builds the profiles, the index and every search (no engine run) of a planted world, for each
pack and each lane that the pack offers, at each size. Per profile it records the checks and touches of the search,
the exact share, the budgeted share by cause (check budget spent, or posting walk spent), the honest gap (reported
bound minus the last kept value) of each budgeted search with a full kept list, and the core's `SearchTally` counters
(`bounds`, `checksAfterSettled`, `boundViolations`, `memoHits`, `refusals`). The core of this commit does not fill
those counters, so their columns show "-".

On 200 sampled profiles per lane and size it also records:

- the standing window (partners in reached segments and in the standing window), its feasible share, and the
  refusals in the window by pair-gate reason;
- the **uncapped work to exactness**: the touches, bounds and checks that the shipped search needs with no budget.
  The match core has no budget parameter, so the bench counts this work from the window. Let θ be the
  kept-list threshold: the limit-th best value in the window, or 0 when fewer partners are feasible. The search with
  no budget walks its tag ranges, rarest first, until the bound of the untouched partners is below θ (or it walks the
  whole window). It checks exactly the touched partners whose bound is at least θ (spec/candidateSearch.md, "An
  exact search stops only when no unseen candidate can enter the kept list"). A tracked gate checks that this count
  equals the search's own checks and touches on every sampled exact search (0 faults in every run below). On a
  budgeted search the count is what the same search needs with no budget; the tables set it beside the checks that
  the budgeted search spent;
- the brute-force oracle (up to N 20,000): recall at k and value regret, for exact and budgeted searches;
- the monitors: no pair value above its bound, no budgeted search that omits a partner above its reported bound,
  no segment refusal and no acceptance-mask refusal of a pair the pack rules admit. The mask monitor reads the pair
  gate's reason `mask_refused`. The core of this commit has no masks, so the monitor checked 0 pairs in every run
  ("0 mask refusals checked"). The core package adds masks and that reason to `eligiblePair`; after that merge the
  monitor checks every sampled mask refusal against the pack rules.

The slope is the least-squares slope of log(1 + uncapped work per profile) against log N, with the root-mean-square
residual of the fit. The bench adds 1 so that a lane with no checks at one size still gives a finite point. The
tracked targets are: checks below 0.3 and touches below 0.6.

## Method

| Item | Value |
|---|---|
| Code | branch `wave1/bench` (cut from `d483de38`), the worktree of 2026-11-21; later edits removed code comments only |
| Baseline ("before") | `908aec03` (code-identical to `d483de38`), `pnpm run sim --only matching --quick` |
| Command | `corepack pnpm@10.24.0 run sim --only matching --quick --matching-pack <pack>`, once for each pack |
| Seeds | exactness and engine gates: seeds 1-3; ladder: planted seed `matching-1`; the sample order is seeded by world, app, lane and N |
| Sizes | every lane at N 1,000, 2,000, 5,000, 10,000, 20,000; harder worlds zipf, dense, graded to 5,000; worst cases at 1,000 and 2,000 (friends and slop) |
| Model | None. The simulator clears the provider keys. |
| Variance | The runs are deterministic for a seed. One planted seed per size. No confidence interval is given. |
| Times | The machine had a load average of 130 to 290 during the runs. Times are not gates and are not compared here. |

Full mode (`corepack pnpm@10.24.0 run sim --only matching`) adds N 50,000 and 100,000 for each pack's primary lane.
A run to 300,000 by hand (hours):
`node --import tsx --conditions eliza-source scripts/sim/scale.ts --packs friends --lanes Friend --sizes 300000`.
The harder worlds to 20,000:
`node --import tsx --conditions eliza-source scripts/sim/scale.ts --packs friends,slop --worlds zipf,dense,graded --sizes 1000,2000,5000,10000,20000`.

## Gates

| Pack | Blocking before | Blocking after |
|---|---|---|
| ntwrk | 8/8 | 12/12 |
| slop | 8/8 | 36/36 |
| peon | 8/8 | 12/12 |
| friends | 8/8 | 36/36 |
| block | 32/32 | 96/96 |

Every existing gate keeps its threshold. The new blocking gates are the ladder monitors (oracle, bound, segment,
mask): four for each pack and world. They have 0 faults in every run.

One tracked gate changed its result because it now reads more sizes: "friends: Friend pair checks as a share of all
pairs fall with N". The baseline read N 1,000 and 10,000 (2.43e-2, 2.11e-2) and was on target. The ladder reads five
sizes: 2.43e-2, 1.23e-2, 5.00e-3, 2.11e-2, 2.77e-2. The share rises after N 5,000 because the check budget fills
(finding 2). The threshold did not change.

## Search cost on the default planted world

Per profile. "Uncapped" is the work to exactness with no budget, on the sample. At N 1,000 and 10,000 every ladder
number of checks, touches and exact share is equal to the baseline number (the baseline measured only those sizes,
and N 10,000 only for each pack's primary lane).

| Pack lane | N | Exact | Checks | Touches | Uncapped touches / bounds / checks | Budgeted checks / uncapped need | Gap p50 / p90 / max |
|---|---|---|---|---|---|---|---|
| friends Friend | 1,000 | 100.0% | 12.0 | 330.7 | 318.9 / 107.7 / 12.0 | - | - |
| friends Friend | 5,000 | 100.0% | 12.3 | 1348.9 | 1301.1 / 521.2 / 12.1 | - | 27 / 27 / 27 |
| friends Friend | 10,000 | 84.5% | 103.5 | 2312.0 | 2191.0 / 889.1 / 12.1 | 600.0 / 12.3 | 102 / 184 / 284 |
| friends Friend | 20,000 | 56.0% | 271.0 | 3230.9 | 4733.5 / 2021.6 / 12.2 | 600.0 / 12.2 | 214 / 312 / 376 |
| slop Date | 1,000 | 100.0% | 41.7 | 218.9 | 212.9 / 52.9 / 40.2 | - | - |
| slop Date | 5,000 | 99.7% | 90.6 | 997.2 | 968.7 / 259.8 / 84.1 | - | 56 / 203 / 203 |
| slop Date | 10,000 | 93.9% | 129.7 | 1698.1 | 1806.8 / 512.6 / 116.3 | 600.0 / 327.7 | 46 / 96 / 251 |
| slop Date | 20,000 | 77.3% | 211.5 | 2590.5 | 3146.1 / 1000.9 / 131.4 | 600.0 / 284.1 | 47 / 96 / 335 |
| peon Hire | 1,000 | 100.0% | 17.0 | 75.1 | 77.4 / 37.3 / 16.9 | - | - |
| peon Hire | 10,000 | 100.0% | 52.8 | 527.4 | 541.0 / 289.8 / 52.6 | - | - |
| peon Hire | 20,000 | 100.0% | 63.1 | 917.4 | 949.5 / 537.3 / 63.5 | - | 106 / 106 / 106 |
| peon Cofounder | 20,000 | 100.0% | 0.8 | 12.4 | 12.6 / 10.8 / 0.8 | - | - |
| ntwrk Friend | 20,000 | 100.0% | 17.1 | 68.9 | 67.3 / 54.5 / 16.9 | - | - |
| ntwrk Intro | 20,000 | 100.0% | 0.9 | 12.5 | 12.3 / 10.6 / 0.9 | - | - |

The other ntwrk lanes (Cofounder, Mentor, Invest) stay at 100.0% exact, under 1 check and under 12 touches per
profile at every size. Recall and value regret against brute force: 100.0% and 0.0 for every exact search. For
budgeted searches: 100.0% and 0.0, except slop Date at N 20,000 (99.6% recall, regret 2.0 per sampled budgeted
search).

## Slopes (uncapped work per profile, N 1,000 to 20,000)

| Pack lane | Touches (resid.) | Bounds (resid.) | Checks (resid.) | Target |
|---|---|---|---|---|
| friends Friend | 0.89 (0.05) | 0.96 (0.05) | 0.00 (0.00) | fail (touches) |
| slop Date | 0.89 (0.04) | 0.97 (0.03) | 0.38 (0.08) | fail |
| peon Hire | 0.85 (0.04) | 0.90 (0.03) | 0.44 (0.05) | fail |
| peon Cofounder | 0.01 (0.01) | 0.01 (0.01) | 0.01 (0.02) | pass |
| ntwrk Friend | -0.00 (0.02) | 0.00 (0.02) | -0.00 (0.01) | pass |
| ntwrk Cofounder | -0.00 (0.02) | -0.00 (0.02) | 0.00 (0.03) | pass |
| ntwrk Intro | 0.02 (0.05) | 0.02 (0.05) | -0.01 (0.01) | pass |
| ntwrk Mentor | 0.00 (0.02) | 0.01 (0.02) | -0.01 (0.04) | pass |
| ntwrk Invest | 0.04 (0.04) | 0.03 (0.04) | 0.01 (0.02) | pass |

The ntwrk Friend lane passes because the ntwrk planted world gives each member few, rare tags; the friends world uses
the friends app's 42 activity tags.

## Harder worlds (N 1,000 to 5,000; worst cases at 1,000 and 2,000)

The worlds are opt-in variants in `packages/sim/src/planted.ts`. The section "Planted worlds and the matching block"
of `packages/sim/README.md` describes them, and says why the default world is easy and partly circular with the
engine's own terms. The default world is unchanged: a digest of
`plantedEngineInput` for 12 app, lane and size cases is byte-identical before and after.

| Pack world | Exact at largest N | Uncapped touches / checks at largest N | Slope touches / checks |
|---|---|---|---|
| friends zipf | 99.1% (5,000) | 1531.7 / 12.2 | 0.99 / 0.01 |
| friends dense | 84.8% (5,000) | 2400.1 / 12.2 | 0.97 / 0.02 |
| friends graded | 100.0% (5,000) | 1444.7 / 12.2 | 1.04 / 0.02 |
| friends one-segment | 100.0% (2,000) | 3318.7 / 12.8 | 0.96 / 0.02 |
| friends one-tag | 100.0% (2,000) | 598.1 / 12.1 | 0.94 / 0.02 |
| friends ties | 100.0% (2,000) | 2757.6 / 394.3 | 0.99 / 0.97 |
| slop zipf | 99.4% (5,000) | 891.2 / 74.8 | 0.77 / 0.45 |
| slop dense | 99.7% (5,000) | 836.6 / 84.5 | 0.90 / 0.47 |
| slop graded | 99.5% (5,000) | 979.0 / 108.9 | 0.94 / 0.51 |
| slop one-segment | 100.0% (2,000) | 2532.5 / 48.0 | 1.07 / 0.65 |
| slop one-tag | 100.0% (2,000) | 385.7 / 54.8 | 0.84 / 0.45 |
| slop ties | 0.0% (2,000) | 1967.0 / 1966.0 | 0.99 / 0.99 |

In the slop ties world every search is budgeted by checks (600 checks; the uncapped search needs 1,966) and the gap
is 55. The four monitors have 0 faults in every harder world.

### Harder worlds to N 20,000 (by hand)

Command: `node --import tsx --conditions eliza-source scripts/sim/scale.ts --packs friends,slop --worlds zipf,dense,graded --sizes 1000,2000,5000,10000,20000`
(24/24 blocking monitors pass). Rows at N 20,000, slopes over the five sizes.

| Pack world | Exact | Checks | Touches | Uncapped touches / checks | Budgeted checks / uncapped need | Recall / regret (budgeted) | Slope touches / bounds / checks |
|---|---|---|---|---|---|---|---|
| friends zipf | 54.8% | 278.0 | 3309.5 | 5252.1 / 12.2 | 600.0 / 12.2 | 99.2% / 0.6 | 0.85 / 0.96 / 0.01 |
| friends dense | 36.9% | 382.9 | 3777.2 | 8817.1 / 12.2 | 600.0 / 12.2 | 98.2% / 4.2 | 0.93 / 0.98 / 0.01 |
| friends graded | 55.9% | 271.7 | 3208.7 | 5112.0 / 12.2 | 600.0 / 12.2 | 99.4% / 0.5 | 0.95 / 1.00 / 0.01 |
| slop zipf | 84.6% | 177.1 | 2121.2 | 2885.6 / 160.8 | 600.0 / 352.5 | 100.0% / 0.0 | 0.79 / 0.94 / 0.48 |
| slop dense | 91.4% | 138.2 | 1795.4 | 2045.0 / 124.0 | 600.0 / 386.8 | 99.5% / 4.5 | 0.80 / 0.92 / 0.38 |
| slop graded | 74.5% | 244.0 | 2676.8 | 3305.9 / 171.0 | 600.0 / 309.8 | 99.8% / 0.2 | 0.91 / 0.95 / 0.42 |

The dense friends world (42 tags at 19% each, as in the friends app world) is the hardest: 36.9% exact at N 20,000.
Every exact search equals brute force (recall 100.0%, regret 0.0) in every world.

## Findings

1. **Touches grow almost linearly with N** in friends Friend, slop Date and peon Hire (slope 0.85 to 0.89); bounds
   grow a little faster (0.90 to 0.97). The posting walk reads most of the standing window. Before the ladder, the
   check budget hid this growth as lost exactness.
2. **A budgeted Friend search wastes its check budget.** At N 10,000 and 20,000 a budgeted Friend search spends all
   600 checks, but the uncapped exact search of the same profile needs about 12. The search keeps checking touched
   candidates that can no longer enter the kept list: every budgeted Friend search closed on the check budget
   (15.5% and 44.0% of profiles by checks, 0.0% by walk). The core's `checksAfterSettled` counter (shared contract)
   will show this directly; this bench shows it as "budgeted checks / uncapped need".
3. **Date and Hire need more checks as N grows** (slope 0.38 and 0.44): more feasible partners are above the
   kept-list threshold when the window grows.
4. **Ties are a true worst case.** When every value ties, no bound stops the walk, and the uncapped search checks the
   whole window (slope 0.97 to 0.99).
5. **Exactness holds.** No exact search differs from brute force, and no bound is below a real value, in any world.

## Decisions

- **The quick ladder keeps N 20,000.** The task asks for N 1,000 to 20,000 in quick mode. The quick block ran 6,209.4
  s in all (slop 3,913.6, friends 1,276.5, peon 409.5, ntwrk 609.8) against 1,131.5 s for the baseline, on a machine
  with a load average of 130 to 290, so these times are not a measurement of cost. The core's own searches over all
  ladder rungs (the sum of the "search ms" column) take 996.1 s in slop, 816.8 s in friends, 108.1 s in peon and
  37.1 s in ntwrk; the largest rungs are slop Date at N 20,000 (460,895 ms) and friends Friend at N 20,000 (456,838
  ms). The rest is the exactness and engine gates (also in the baseline) and the 200-profile sample. A CPU-time
  profile of one rung (friends Friend, N 5,000, `/Users/nubs/tn-work/w1-bench/review/phases-friends-5000.txt`) gives
  4 s for the searches and 4.5 s for the sample (1.5 s pair values, 1.4 s pair-gate reasons for segment refusals,
  1.5 s brute force, 0.1 s other refusals). The core package removes the wasted checks of finding 2 (friends Friend
  checks per profile at N 20,000 fall from 271.0 to 12.2, with the same exact share 55.97% and the same 3,230.9
  touches, in `/Users/nubs/tn-work/w1-core/bench-oldbase-4.txt` and `bench-newbase-4.txt`). Capping the ladder at
  10,000 would hide the sizes where exactness falls. Measure the block time again on an idle machine after the core
  merge.
- **The slope gates stay tracked.** They fail today in friends Friend, slop Date and peon Hire, as the task expects.
  A change to blocking is a product-owner decision after the core work passes them.

## What is not in this report

- The core counters (`bounds`, `checksAfterSettled`, `boundViolations`, `memoHits`, `refusals`) show "-": the core
  package fills them on its own branch. Run the block again after the merge.
- The full ladder (N 50,000 and 100,000) and the 300,000 run were not run.
- One planted seed per size; the slopes have no interval other than the fit residual.
