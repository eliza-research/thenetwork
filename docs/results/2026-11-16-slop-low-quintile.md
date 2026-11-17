# slop.date: lowest rating quintile after the match core migration

Hand-written. The numbers are copied from the output of the slop block of the simulation.

## Command and settings

- Command: `corepack pnpm@10.24.0 run sim --only slop` (pinned seeds 13 to 16, 4 weeks, the slop world with catfish, body types, verification, relay, review, widen, check-in, photos and the rater).
- No LLM calls (the simulation clears the provider keys). The reviewer is simulated (`review: 3`).
- Baseline: commit e4c06faa. After-1: commit 09e01dba (the match core migration). Floor only: after-1 plus the exposure floor in `slopAssign`, Date free gap 5. Now: the floor plus Date free gap 10 (spec/matchLane.md, "Parity band and free gap").
- The floor-only run used a copy of this tree with the generated Date free gap set back to 5. It is the "before" value of the named decision in spec/matchLane.md.

## Results

| Gate | Baseline | After-1 | Floor only | Now |
|---|---|---|---|---|
| Lowest rating quintile dates vs overall (blocking, >= 0.85x) | 0.927 (q2) | 0.808 (q1) | 0.839 (q1) | 0.928 (q1) |
| Dates per member-month vs random (tracked, >= 0.9x) | 1.005 | 0.770 | 0.822 | 0.834 |
| Second-date rate vs random (tracked, >= 2.5x) | 1.733 | 2.326 | 2.248 | 1.923 |
| Second dates per seed vs random (tracked, >= 2x) | 1.676 | 1.730 | 1.811 | 1.541 |
| Back-outs at reveal (tracked, < 10%) | 0.122 | 0.151 | 0.128 | 0.130 |
| Top-10% share of proposals (blocking, <= 20%) | 0.132 | 0.165 | 0.161 | 0.161 |
| Lowest group vs overall (tracked, >= 0.7x) | 0.506 | 0.352 | 0.293 | 0.324 |
| Same, feasible members (tracked, >= 0.7x) | 0.603 | 0.373 | 0.350 | 0.352 |
| Minor contacts (age liars) cut vs random (tracked, >= 90%) | 76.5% | 76.5% | 70.6% | 70.6% |
| Adversary contacts cut (tracked, >= 90%) | 45.4% | 53.6% | 51.5% | 48.5% |
| Blocking gates of the slop block | 42/42 | 43/44 | 43/44 | 44/44 |

The declared-minor contacts, stated-filter violations, scam harm and leak gates stay at 0 in every run.

## Limits of this evidence

- The simulated weekly snapshot has no proposals from earlier runs, so `recentExposure30` is 0 for every member and every member qualifies for the exposure floor (`policy.ts` `exposureFloor`). In the simulation the floor is a draw of up to its cap, ordered by carried exposure debt, not a floor for members with low recent exposure. In production `recentExposure30` is not 0, so this run does not show how the floor behaves there.
- Alone, the floor moved the lowest quintile from 0.808 to 0.839 and lowered the lowest group (0.352 to 0.293) and the age-liar contact cut (76.5% to 70.6%). Most of the gain on the blocking gate came from the free gap.
- The free gap of 10 lowers second dates: per seed vs random from 1.811 to 1.541 (below the 1.676 baseline), and the second-date rate vs random from 2.248 to 1.923. This is a trade-off between the lowest quintile and second dates. It needs a founder decision; the alternative is to keep the free gap at 5 and leave the quintile gate failing.
