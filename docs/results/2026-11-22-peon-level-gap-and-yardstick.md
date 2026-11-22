# peon.biz Hire lane: the role-level gap, an offline optimum and congestion (2026-11-22)

This report is hand-written. Each number is copied by hand from the output of the commands below. No run called an LLM (the sim clears the provider keys). The peon world uses a simulated reviewer (`review: "auto"`).

## Commands and runs

- Peon block: `corepack pnpm@10.24.0 run sim --only peon`: pinned seeds 13 to 16, 8 weeks, the pack, keyword and oracle arms.
- Quick matching block: `corepack pnpm@10.24.0 run sim --only matching --quick`: 3 seeds.
- Three states of the code, each with the new measures of this change:
  - **before**: the base engine (Hire band 15, a posting with the uncertainty of one reviewed fact, 18).
  - **A**: a posting at the floor uncertainty 3, band 15.
  - **B (shipped)**: a posting at the floor uncertainty 3, band 22.

The decisions and their reasons are in spec/memberStanding.md ("A standing that staff reviewed as a property of the offer has the floor uncertainty") and in the Hire prose of spec/matchLane.md ("Hire level gap: a posting's level is exact" and "Hire band 22: one level for every candidate").

## Cause of the two-level gap

The parity check admits a pair when the standing gap is at most the band plus both uncertainties. One role level is 25 standing points. Before, a staff-reviewed posting level counted as one reviewed fact (uncertainty 18), so 15 + 18 + 18 = 51 admitted two levels (50) against a candidate with one reviewed fact or none. A posting's level is a reviewed property of the seat, not an estimate, so it now has the floor uncertainty 3. With band 15 and the floor, a candidate with seven or more reviewed facts (uncertainty 6 or less) got no role one level away (15 + 3 + 6 = 24). Band 22 gives limits from 28 to 45: one level for every candidate, two levels for none.

## Peon block: before, A, B

| Measure | before | A | B |
|---|---|---|---|
| Blocking gates | 27/27 | 27/27 | 27/27 |
| Backed pairs with a role-level gap above 1 | 142 of 4,767 | 0 of 4,624 | 0 of 4,625 |
| Hires | 179 | 179 | 179 |
| Hires against keyword / oracle | 1.03x / 0.90x | 1.03x / 0.90x | 1.03x / 0.90x |
| Interviews (per hire against keyword, gate 0.75x or less) | 714 (0.75x) | 698 (0.73x) | 698 (0.73x) |
| Intros | 7,056 | 6,775 | 6,776 |
| Openings filled | 20.7% | 20.7% | 20.7% |
| 90-day retention against keyword | +1.7 pt | +1.7 pt | +1.7 pt |
| Under-applied hires against keyword | 1.04x | 1.04x | 1.04x |
| Impact ratio, pooled (worst seed) | 0.94 (0.85) | 0.95 (0.85) | 0.95 (0.85) |
| Safety gates (minors, unverified employers, no pay range, scam reach) | 0 | 0 | 0 |
| Matchable candidate-weeks | 10,964 | 10,589 | 10,591 |
| Matchable seat-weeks | 1,853 | 1,808 | 1,808 |

The step removes only pairs two levels apart. Hires and every blocking gate do not change. It costs 373 matchable candidate-weeks and 45 matchable seat-weeks (before against B): those weeks had only two-level pairs.

Quick matching block, base against B: Hire proposals 533 to 531, matched standing correlation 0.877 to 0.876, standing gap past band plus both uncertainties 0 faults in both.

## Greedy selection against the capacity-feasible optimum (B)

The optimum is `optimumSelection` in `packages/sim/src/apps/peon/yardstick.ts` (an exact maximum-weight b-matching as a min-cost flow over the pairs the engine scored, offline only).

- Greedy value against the optimum: 99.0% (3,508,533 of 3,545,349). Before: 99.0% (3,560,749 of 3,597,310).
- The optimum also serves 21 seat-weeks and 62 candidate-weeks that greedy leaves without a proposal. Before: 23 and 72.

## Congestion (B)

- Member-weeks with more proposals than room (every proposal, all lanes): 0. Harness cap drops: 0. No path was found that skips a cap.
- Proposals per matchable candidate-week (0/1/2/3/4 or more, weekly capacity 3): 5,843 / 3,252 / 964 / 532 / 0 of 10,591. At capacity 5.0%. Matchable without a proposal 55.2%.
- Matchable seat-weeks at their slate cap: 52.4%. Without a proposal: 56 of 1,808 (3.1%). Before: 52.9% and 66 of 1,853 (3.6%).
- The most-wanted tenth of seats, share of proposals against share of slate room, per seed: 15.5% vs 8.3%, 19.2% vs 9.4%, 15.0% vs 7.6%, 16.6% vs 7.9%.

Two tracked measures are off their targets, and the targets do not block. Seat-weeks without a proposal are 56, not 0; the optimum serves 21 of them, so a better selector could close part of the gap. The most-wanted tenth of seats gets 1.87x, 2.04x, 1.97x and 2.10x its share of room on seeds 13 to 16, so it is above the 2x target on seeds 14 and 16. Popular seats cannot pass their slate cap (0 member-weeks over room), so this is concentration inside the caps, not a broken cap. This change does not change the selector.

## Not measured

Only bands 15 and 22 were measured. The simulated job families have six skills, so almost no simulated candidate has seven reviewed facts; the engine case `packages/engine/test/peon-standing.integration.test.ts` holds candidates at seven and ten reviewed facts. The full sim, the integration suite and the e2e suite did not run for this report.
