# Incremental candidate cache: a recorded option, not wired (2026-11-22)

This report is hand-written. The measured numbers come from the saved output of the incr wave, `/Users/nubs/tn-work/w1-incr/fix1/test-repo.txt` (abbreviated `incr/`). No new run was made for this report. No model was called and no member data was read.

## Decision

The incremental candidate cache is removed from this tree. These files are removed: `packages/engine/src/match/cache.ts`, `packages/engine/test/candidate-cache.integration.test.ts`, `spec/candidateCache.md` (16 proved laws), `spec/models/candidate_cache.md` and the generated `packages/core/src/generated/candidateCache.ts`. No production path called the cache, and the repository does not keep dead code. No production caller remains, so the spec and the model are removed too. The spec, the model and the code stay in git history at `c0b46f33` and can be restored from there.

The cache cannot be made exact against a full recompute of the production search by a change of reviewable size. The reasons follow.

## Why the cache is not exact for the production path

The cache spec makes one assumption: a pair value changes only when one of the two profiles changes (a join, a leave or a new profile version). Then a removal never makes another candidate better, and the cover bounds every partner that is not stored. The production pair value does not obey this assumption.

1. **Time changes eligibility.** `pairReason` (`packages/engine/src/filters.ts`) runs the pack pair rules. The network rules (`packages/engine/src/packs/network/rules.ts`) refuse a pair during `pair_cooldown`, `negative_feedback_cooldown` and `category_cooldown`, and each one compares a stored time with `w.now`. When a cooldown ends, a pair that was refused gets a value. Neither profile changed, so the cache cannot see it. The cover does not hold that partner, so a cached kept list can miss a better partner that a cold run keeps.
2. **World state outside the two profiles changes pair values.** `active_duplicate` reads `w.activePairs` (open items), the core prefix reads `w.blocked` and `w.holds`, warm paths read graph edges, and a pack value (`PackVectors.packValue(w, a, b)`) can read any part of the World. A closed item or a lifted hold adds a pair value without a profile event. To be exact, every pack rule must declare its inputs, and the shell must turn each input change into versions. That is a change to every pack and to the pack interface.
3. **Standing moves with time.** `observeStanding` (`spec/memberStanding.md`) moves a standing toward its target once per week. Standing places the profile in the search window and enters the pair arithmetic. At each week boundary every member whose standing is not at its target changes version. This makes a large share of the population churn at one time.
4. **Budgeted searches are not reproducible.** The spec's equivalence holds for exact lists only. A budgeted search keeps what it touched first within `searchBudget`, so its kept list depends on the layout of the whole index. After one join the cold budgeted list can differ from the repaired list. In the scale ladder (`docs/results/2026-11-17-scale-ladder.md`) every slop ties search is budgeted, and on the default planted world 6 to 44% of the Friend and Date searches at 10,000 to 20,000 members are budgeted. Each one must search again at each run, and these are the expensive searches.
5. **No stable keys and no store.** Profiles use positional ordinals that change when members join or leave. The service rebuilds the World from Postgres at each tick (`packages/network/service/runtime.ts`, `buildWorld(this.net.packInput(now))`), and more than one instance can hold the tick lock. A cache that lives across ticks needs stable entity keys, three new tables (kept lists, a reverse index, group summaries; about 430 MB at 100,000 members by the incr estimate), and a per-tick difference of the World input to find the events.

Items 1 to 3 break the equivalence law itself. A cache that searched again for every member that a time or World event touched would search again for most members at most ticks.

## Measured saving (recorded for a later decision)

The incr test measured pair checks on a synthetic population with its own pair function (N 300, limit 5, reserve 3, seeds 11 to 13, 5 batches each, 15 batches). The baseline is a group-ordered search for every member in the same test, not the production `searchCandidates`.

| Churn per batch | Incremental checks / full recompute, mean | max |
|---|---|---|
| 1% | 0.0177 | 0.03 |
| 10% | 0.1917 | 0.2808 |

Source: `incr/test-repo.txt`, line 10. The test did not measure against the production search, which already settles in under 1 check per profile on the ntwrk lanes and in 17 to 212 checks a profile on the Date and Hire lanes (scale ladder, N 1,000 to 20,000). So the saving against the production path is not known.

## What a later attempt needs

- A pack interface where each pair rule and each pack value declares the World inputs it reads, and a shell that maps a change of each input (a time boundary included) to profile versions.
- Each cooldown end as a scheduled event, and each weekly standing step as a version change.
- Stable entity keys in the search order (value, then key), in place of ordinals.
- Persisted kept lists, the reverse index and group summaries, and a rebuild from nothing after a restart.
- A boundary case that compares a run after churn with a cold run, on exact and budgeted lanes.
