# Validation performance, 2026-11-22

Baseline code is `f662eda0` on `vibestack`. The hosted reference is [CI run 45053614501](https://github.com/eliza-research/thenetwork/actions/runs/45053614501) on PR #572, which used the same matching workloads. The run took 26m 38s from start to completion and 70m 14s across jobs. The jobs used pinned seeds and offline model settings.

| Hosted job | Duration |
| --- | ---: |
| Slop matching | 26m 32s |
| Friends matching | 15m 42s |
| Offline core | 14m 36s |
| Integration and end to end | 6m 18s |
| Peon matching | 5m 22s |
| Network matching | 1m 00s |
| UI | 42s |

The Slop 100,000-member case took 25m 28s on its own. Candidate search accounted for 688.738s of that case. The profile builder examined every presence row for every member. A one-pass index now groups eligible trip cities by canonical member. The generated travel window checks still set the start and end bounds. The profile omits the home city and records each other city once.

## Paired local measurements

Node 26.13.0 on arm64 macOS. The machine ran multiple concurrent validation sessions, so the matching microbenchmarks report process CPU. The timing samples are small and indicate the size of the effect on these fixtures.

| Command or workload | Baseline | After | Sample |
| --- | ---: | ---: | --- |
| Slop profile build, planted Date seed `matching-1`, 2,000 members | 259 ms CPU | 123 ms CPU | Median of 3 runs per implementation |
| Slop profile build, same seed, 10,000 members | 2,336 ms CPU | 384 ms CPU | Median of 3 runs per implementation |
| Friends pair value, planted Friend seed `matching-1`, 38,809 ordered pairs | 32.7 ms CPU | 20.6 ms CPU | Median of 6 runs per implementation |
| Slop pair value, planted Date seed `matching-1`, 38,809 ordered pairs | 71.1 ms CPU | 68.6 ms CPU | Median of 6 runs per implementation |
| Network matching input, seed 1, 250 members and 3,000 stored facets | 7.69 ms CPU | 1.21 ms CPU | Median of 5 runs per implementation |
| Network matching input, seed 1, 1,000 members and 12,000 stored facets | 53.85 ms CPU | 2.40 ms CPU | Median of 5 runs per implementation |
| Network engine run and fingerprints, seed 1, 1,000 members | 125.50 ms CPU | 90.61 ms CPU | Median of 5 runs per implementation |
| NYC simulator snapshot, 10,000 generated members | 538.11 ms CPU | 133.88 ms CPU | Median of 5 runs per implementation |
| Root TypeScript check, empty incremental state then warm | 21.10s CPU | 5.51s CPU | One run per cache state |
| `pnpm run spec:check-generated`, empty snapshot cache then warm cache | 83.45s elapsed | 22.39s elapsed | One run per cache state |

The profile benchmark adds a duplicate trip, an aliased trip, a home-city trip, and trips at both window boundaries to each planted fixture. Each of the original and indexed implementations returns the same member-to-visit digest. The pair benchmark compares every ordered pair value and every complete candidate search result in each 200-member world. All compared values, ranked results, checks, touches and certificates agree. A second comparison held the untouched bound until the posting walk changed it. At 10,000 members and 197 sampled searches per pack, medians moved by less than 2% and all results agreed. The snapshot benchmark repeats the seeded NYC persona fixture with distinct group IDs and a repeated member ID. Entire serialized snapshots agree.

The generated check compares 232 current artifacts in both cache states. On GitHub, the generation job took 70s cold and 23s warm. The warm run restored a 3.34 MB archive and spent about 3s on the comparison itself. The combined Pages build took 29s. The reference typecheck and build took 49s across two runner jobs. [Generation run](https://github.com/eliza-research/thenetwork/actions/runs/45062887805), [Pages baseline](https://github.com/eliza-research/thenetwork/actions/runs/45062123655), [combined Pages job](https://github.com/eliza-research/thenetwork/actions/runs/45062887803).

## Validation and workflow changes

- Use indexed and memoized segment ranges in block order. The matching simulation independently compares this lookup with the original ordered scan. Standing cutoffs, visit order, and search caps still apply.
- Calculate shared affinity hits and trait closeness once per pair. For packs without a custom value, reuse the resulting score at the check and apply the same pair gate. For packs with a custom value, compute the full score at the check.
- Index stored facet tags by member before combining them with learned tags. Compute the input and configuration fingerprints once per match run. The input, proposals, and complete run log apart from timing fields match the original in the paired runs.
- Use the simulator snapshot's member index for both membership tests and romance preference reads. The snapshot still uses the first matching row when the same ID occurs twice.
- Save the root and sites TypeScript incremental state by runner, Node version, lockfile, project settings and revision. The full `pnpm run typecheck` passed. A warm run found a type error in a changed file and passed again once the error was removed.
- Share the immutable result of one six-day Observatory simulation between its consent and Postgres parity tests. The hosted reference spent 15.2s and 14.4s on the tests that each ran this fixture.
- Run the NYC simulation alongside the other offline blocks on one runner. Both commands must succeed. The existing Postgres skip check reads the core report.
- Reuse only content-keyed generation inputs across GitHub runs. The generator and VibeLang compiler still compare outputs against the current checkout. Obsolete PR runs of the Vibestack workflow are canceled.
- Share one unprivileged checkout and package install between Pages typecheck and build. The production job keeps its branch, environment, and deploy conditions. Bombadil uses the full Chromium build and the browser job omits the separate headless-shell binary.

The matching changes preserve the decisions in [candidate search](../../spec/candidateSearch.md), [pair value](../../spec/pairValue.md), [travel presence](../../spec/travelPresence.md) and [dating radius](../../spec/datingRadius.md). The [candidate pool model](../../spec/models/candidate_pool.md) consumes the same ordered candidates. The existing generated decisions stay in the serving path.

## Other implementations evaluated

- Reducing the size or count of the planted seeds would save runner time by reducing the validation workload. The exactness, budget, and certificate checks use the existing seeds and sizes.
- A global pair-score cache would retain entries across match runs. Pair eligibility reads run-specific state, and invalidation would need to cover all of that state. The cache and score reuse here apply only within the indexed world and within a search.
- Hosted root workspace package installs took 3–6s in the sample. A compressed pnpm store adds transfer and unpack time, so measure it separately before adding it across all validation jobs.

Source timing data, shell output and benchmark inputs are generated. The summary and analysis are hand-written.
