# Exact candidate search: settled close, pair memo, pack hooks (2026-11-22)

This report is hand-written from saved command output. Every number names its file. The files are in the scratch directory `/Users/nubs/tn-work/w1-core/` (abbreviated `w1/`) and the baseline directory `/Users/nubs/tn-work/base/` (abbreviated `base/`). The worlds are the planted worlds of `packages/sim/src/planted.ts`, seed 1. No model is called and no real member data is read. The runs are deterministic for a seed, so no confidence interval is given.

## What changed

- **Settled budgeted close** ([candidateSearch](../../spec/candidateSearch.md), "A search that spends its budget or its posting walk before it is exact reports the value it may have missed"). A search whose posting walk is spent closes as soon as no touched candidate can still enter the kept list (`canCloseBudgeted` takes `touchedBound` in place of `touchedLeft`). Before, it checked every touched candidate until the check budget was spent. The kept list does not change.
- **Pair memo.** One `MatchRun` keeps each checked pair value, or its refusal, until the other member's search starts, and that search reuses it. A reuse still counts as one check. Pack pair rules must be symmetric.
- **Hooks for the next wave.** `PackVectors.packBound` (an upper bound on the pack value for a touched candidate, `lawPackBoundSound`) and `PackVectors.masks` (mutual acceptance bitsets, `maskPairAllowed`, tested at the touch and in the one pair gate; `maskRefusesAdmitted` is the monitor). No pack supplies them yet.
- **Friend.** Without a pack value the touched bound is the pair arithmetic, and the check adds only the pair gate (the value is computed once, not twice).
- **Counters.** `SearchTally` gains `bounds`, `checksAfterSettled`, `boundViolations`, `packBoundViolations`, `touchClosed`, `checkClosed`, `memoHits` and `refusals`.

## Method

| Item | Value |
|---|---|
| Baseline code | `d483de38`; for the bench, a copy with only `search.ts` instrumented (`w1/old`) |
| Micro-benchmark | `APPS=<pack> TAGS=base node --import tsx --conditions eliza-source w1/bench.mts <root> <tag>` (throwaway, not in the repository); every candidate search of the world, kept lists written per profile |
| Simulation | `corepack pnpm@10.24.0 run sim --only matching --quick` |
| Model | None |

## Results

Friends Friend, micro-benchmark, same tags function on both sides (`w1/bench-oldbase-4.txt` -> `w1/bench-newbase-4.txt`):

| N | exact share | checks per profile | bounds per profile | touches per profile | checksAfterSettled | boundViolations | memoHits |
|---|---|---|---|---|---|---|---|
| 5,000 | 0.9998 -> 0.9998 | 12.3 -> 12.1 | 535.5 -> 535.5 | 1348.9 -> 1348.9 | 588 -> 0 | 0 -> 0 | - -> 21635 |
| 20,000 | 0.5597 -> 0.5597 | 271.0 -> 12.2 | 1662.7 -> 1662.7 | 3230.9 -> 3230.9 | 5073424 -> 0 | 0 -> 0 | - -> 87092 |

Kept lists: 4902 of 4902 and 19602 of 19602 identical (`w1/keptcmp-base-fix1.txt`).

Slop Date, micro-benchmark (`w1/bench-old-slop.txt` -> `w1/bench-new-3.txt`):

| N | exact share | checks per profile | bounds per profile | touches per profile | checksAfterSettled | boundViolations | memoHits |
|---|---|---|---|---|---|---|---|
| 5,000 | 0.9971 -> 0.9971 | 90.6 -> 90.5 | 270.1 -> 270.1 | 997.2 -> 997.2 | 328 -> 0 | 0 -> 0 | - -> 71210 |
| 20,000 | 0.7729 -> 0.7729 | 211.5 -> 130.7 | 864.2 -> 864.2 | 2590.5 -> 2590.5 | 1584149 -> 0 | 0 -> 0 | - -> 357021 |

Kept lists identical: `w1/kept-old-slop-5000.txt` and `w1/kept-new-slop-5000.txt` are byte-identical, and so are the two N 20,000 files.

Quick matching block (`base/sim-matching-quick.txt` -> `w1/sim-matching-5.txt`): 32/32 -> 32/32 blocking gates; exact != brute force 0 for all four packs. Friends Friend N 1,000: exact 100% -> 100%, checks 12.0 -> 12.0, touches 330.7 -> 330.7; N 10,000: exact 84.5% -> 84.5%, checks 103.5 -> 12.2, touches 2312.0 -> 2312.0. Slop Date N 1,000: exact 100% -> 100%, checks 41.7 -> 41.7, touches 218.9 -> 218.9; N 10,000: exact 93.9% -> 93.9%, checks 129.7 -> 112.9, touches 1698.1 -> 1698.1. Circles: friends ARI 0.712 -> 0.712.

The saved outputs above come from the code before the two deletions below. In every planted world, bounds and touches were identical with and without the deleted parts, so the deletions should not change these numbers. The commands in "To verify" re-measure the final code.

## Decisions

1. **The per-segment closeness cap and the one-segment-at-a-time walk are deleted.** In every saved planted-world run they did not change bounds or touches: friends with the shipped tags (`w1/bench-oldbase-4.txt` vs `w1/bench-newbase-4.txt`) and with the lane and side tags removed (`w1/bench-oldls-4.txt` vs `w1/bench-new-4.txt`). A version that walked a near segment before a longer tag range raised the friends N 20,000 exact share from 0.6127 to 0.7842 but made 2892 of 19602 kept lists worse (`w1/keptcmp-interleaved-fix1.txt`), so it fails the identical-list rule. Code without a measured effect is not kept. `rangeDistance` and `lawRangeClosenessSound` leave the spec with it.
2. **The friends structural tag filter is dropped.** It changes only the planted world, and there it lowered circle quality: with `lane:`, `side:` and `level:` removed, ARI 0.712 -> 0.676 (`w1/sim-matching-3.txt`); with `lane:` and `side:` removed, ARI 0.712 -> 0.698, purity 0.773 -> 0.762, pair precision 0.621 -> 0.607 (`w1/sim-matching-4.txt`). `level:N` is on both desires and offers, so it is a real standing match.
3. **`lawPartnerListCapsThePair` is not stated.** The search machine does not record which ordinals another search checked and dropped, and with which values, so its rules cannot prove the cap.

## Not verified

- The integration suite has no clean run in this worktree: 751 passed, 9 failed (`w1/integration-4.txt`). Eight failures need asset builds that the worktree does not have; `peon-candidate-search` fails the same way on the baseline code (`w1/peon-search-5.txt`, `w1/peon-search-old-5.txt`).
- No pack supplies `packBound` or `masks` yet. The monitor `maskRefusesAdmitted` is not counted by any gate.

## To verify

```bash
corepack pnpm@10.24.0 run spec:check-generated
node_modules/.bin/tsc --noEmit -p .
node node_modules/vitest/vitest.mjs run --project integration packages/engine/test
corepack pnpm@10.24.0 run sim --only matching --quick
```
