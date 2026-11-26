# Integer Date pack value with proved upper bounds

Hand-written report. Every number comes from a generated output file of a run on the worktree of this change (branch `wave1/pack`) or on the unchanged tree (`d483de38`). The output files were saved outside the repository; each section names its file. No run called a model: the simulator clears the provider keys, and the integration case and the measurement scripts make no model call.

## What changed

- [spec/datePackValue.md](../../spec/datePackValue.md) (new library spec, proof `spec/datePackValue.proof.dfy`, generated `packages/core/src/generated/datePackValue.ts`): the slop Date lane's directed pack value as an integer product of permille factors, the pair bound `datePackPairBound` and the class cap `datePackClassCap`. Laws: `lawDatePackProductBounded`, `lawDatePackProductMonotone`, `lawDatePackValueBounded`, `lawDatePackPairBound`, `lawDatePackClassCap`.
- `packages/engine/src/packs/slop/score.ts`: the floating-point value (`compatEstimate`, `likelyDealbreakers`, `directional`, `learnedFactor`, `logistics`, `bodyTypeFactor`) is deleted; `datePackValue` calls the generated function.
- `packages/engine/src/packs/slop/packBound.ts` (new): `datePackBound`, `datePackClassKey`, `datePackClassCap`, `DATE_PACK_CLASSES`.
- `packages/engine/src/packs/slop/options.ts`: the `compat` and `logistics` tables, `learned.taste`, `statedWeight` and `revealedWeight` are removed. `packages/sim/src/apps/slop/packEval.ts`: the two presets that set them are removed.
- `packages/engine/test/date-pack-bound.integration.test.ts` (new integration case).

## Proof

`datePackValue.ts: total 5, unproved 0, errors 0` (prove helper on this worktree; `review3/prove.txt`, `prove-fix1.txt`).

## Bounds on seeded profiles

Command: `node node_modules/vitest/vitest.mjs run --project integration packages/engine/test/date-pack-bound.integration.test.ts`, seed 20261118, 3,000 synthetic profiles, 199,935 sampled directed pairs (`bound-test.txt`).

| Measure | Value |
|---|---|
| Pairs with pair bound below the value, class cap below the value, class cap below the pair bound, untouched cap below the pair bound | 0, 0, 0, 0 |
| Pair bound minus value: mean, quartiles, maximum | 58.4; 0, 0, 106; 463 |
| Largest pack value at which a partner with no shared tag misses the Date floor | 933 |
| Share of pairs at or below 933: value, pair bound, class cap, untouched class cap (94,376 untouched pairs) | 0.991, 0.953, 0.404, 0.771 |

The test now asserts only the violation counts and the 933 floor. The slack and the shares are from the run of 2026-11-22.

The floor arithmetic: with the Date weights complement 3, affinity 2, pack 3 and no closeness for slop, an untagged partner has the utility `3 x pack / 8`, and `3 x 933 / 8 = 349 < 350` while `3 x 934 / 8 = 350`. The old bound counted the pack term at 1000, which gives 375.

On slop world profiles (seed 13, 879 adults, `world-share.txt`): 0 violations of each bound in week 0 and in week 3. In week 0 the untouched class cap is at or below 933 for 0.940 of untouched pairs and for every untouched class of 84.0% of seekers; in week 3, when 84 members have post-date ratings, the shares are 0.837 and 76.5%. The class cap without the untouched condition is at or below 933 for 0.618 (week 0) and 0.400 (week 3) of pairs. These are shares of pairs, not a measured speedup: the match core does not call the bounds yet.

## Value against the replaced float value

200,000 seeded pairs (`bench.txt`, `bench2-after.txt`): 82.8% of values are equal; the difference has median 0, 99th percentile 1, maximum 2. The 17.2% of pairs that differ are spread over all factors, 14% to 21% in each factor group, and 68% of them move up (`attrib.txt`), so no single table entry causes the difference. On slop world profiles the mean difference (new minus old) is +0.05 to +0.10 permille for all seekers and +0.03 to +0.08 for woman:lesbian seekers (`world-share.txt`).

CPU time per 200,000 values, median of 9 runs on a loaded shared machine: old 209 ms, new 242 ms (`bench2-after.txt`); old 184 ms, new 239 ms (`bench2-before.txt`). The new value is 16% to 30% slower; the generated core takes 74 to 75 ms of it.

## Slop block

Command: `corepack pnpm@10.24.0 run sim --only slop` (pinned seeds 13 to 16, 4 weeks, 300 per city; simulated reviewer). Before: the unchanged tree (`base/sim-slop.txt`). After: this change (`after-slop-2.txt`, `after-slop-3.txt`, equal except wall time). Control: the unchanged float code with a deterministic change of 1 permille on 17.2% of directed pairs, the same share that the integer value changes, with two salts (`ctrl-slop-jitter1.txt`, `ctrl-slop-jitter2.txt`; the control code was a scratch copy and is not in the repository).

Blocking gates: 45 of 45 pass in all four runs; 9 tracked measures are off target in all four. The slop-live fingerprint is equal before and after (`4ca5cb6f3c81a82d`). Tracked measures:

| Measure | Before | After | Control 1 | Control 2 |
|---|---|---|---|---|
| Minor contacts (age liars) cut vs random | 70.6% | 88.2% | 88.2% | 88.2% |
| Adversary contacts cut | 48.5% | 56.7% | 53.6% | 59.8% |
| Harm events cut | 93.9% | 94.9% | 94.9% | 98.0% |
| Second-date rate vs random | 1.923 | 2.020 | 1.935 | 2.027 |
| Second dates per seed vs random | 1.541 | 1.568 | 1.649 | 1.541 |
| Top-10% share of proposals | 0.161 | 0.162 | 0.163 | 0.162 |
| Lowest group vs overall | 0.324 (woman:lesbian) | 0.244 (woman:lesbian) | 0.274 (man:gay) | 0.341 (man:gay) |
| Same, feasible members | 0.352 (woman:lesbian) | 0.264 (woman:lesbian) | 0.341 (man:gay) | 0.424 (man:gay) |
| Back-outs at reveal | 0.130 | 0.134 | 0.110 | 0.121 |
| Dates per member-month vs random | 0.834 | 0.794 | 0.880 | 0.785 |
| Lowest rating quintile dates vs overall | 0.928 (q1) | 0.875 (q2) | 0.887 (q1) | 0.901 (q1) |

A 1-permille change on the same share of pairs moves every measure as far as the integer value does. The one exception is the lowest group, 0.244, which is 0.03 below the lowest of the three float-code runs (0.274); the lowest group also changes between runs. With 4 pinned seeds this is within what the control shows for a small group, but it is not proven.

Quick matching block (`corepack pnpm@10.24.0 run sim --only matching --quick`): 32 of 32 blocking gates pass and 2 tracked are off target, the same as the unchanged tree (`after-matching-quick-3.txt` against `base/sim-matching-quick.txt`); only timing lines differ.

## Decisions

- The lowest-group move: accepted as within seed noise, on the control above. The lowest-group measure is tracked, not blocking; a report of it over more seeds is a separate change to the slop block.
- The removed presets `x typeWeight 0.3` and `- no compat model`: not restored. An option that changes a proved table would be a second path; a new ablation is a change to the spec.
- The 16% to 30% slower value: accepted. The bounds exist to remove most full value computations once the search uses them.

## Not done

The match core has no pack-bound hook. The wiring needs, in `packages/engine/src/match/profile.ts` `PackVectors`, two optional hooks next to `packValue`: a pair bound and a class cap with the partner's class key; in `packages/engine/src/match/search.ts`, the touched-candidate bound uses the pair bound in place of `pairValueScale` for each direction, and the untouched bound uses, for the searcher's direction, the largest class cap over the classes in the window (with `untouched` true only after every interest posting and every `free:<slot>` posting is walked); and in `packages/engine/src/packs/slop/generators.ts` `slopVectors`, the two hooks return `datePackBound(pa, pb, o)` and `datePackClassCap(pa, classKey, untouched, o)`, with `datePackClassKey(pb)` in the partner's segment or block entry. `spec/candidateSearch.md` must then state the new bound in its soundness rule.
