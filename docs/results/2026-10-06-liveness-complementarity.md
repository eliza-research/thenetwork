# Intent liveness, complementarity ranking, and two label fixes (2026-10-06)

**Question.** The PoC validation (`thenetwork-poc/prototypes/poc-embeddings/RESULTS.md`) found two problems:

1. The synthetic snapshot silently expired most intents.
2. The engine's score barely ranked good pairs above bad ones inside its own candidate set.

The Luna error analysis (`2026-10-06-luna-error-analysis.md`) then added two label bugs:

3. Dating desire was not tied to the romance opt-in.
4. The oracle checked presence only at the start of the window.

What does each fix change, separately and combined?

**Answer.**

- **Ranking (fix 2) is the big lever.**
  - In the 30-day sim, engine precision goes from 30.1% to 38.0% and the worthwhile rate from 48.4% to 56.8%. Pair recall rises slightly, from 14.3% to 16.4%.
  - On the synthetic snapshot, precision goes from 20.5% to 32.8%, and top-N precision inside the scored set from 22.6% to 32.4%.
  - **The cost is fairness.** The share of members with no proposal goes from 8% to 19-20% in the sim.
- **Liveness (fix 1) matters where intents are old.** On the synthetic snapshot, adults with no live intent drop from 252/450 (56%) to 144/450 (32%), and pair recall goes from 1.19% to 1.72%. In a 90-day sim, every intent had expired by day 90 before the fix, against 1.6% after; that is +40% proposals and pair recall from 22.8% to 25.1%. In the standard 30-day sim it changes nothing, by construction.
- **The dating fix (3)** corrects labels and lifts both networks. Engine precision in the sim goes from 30.1% to 32.4%.
- **The presence fix (4)** is a no-op in the sim, because no proposal there had a city mismatch. On the synthetic snapshot it removes 4 false `city_mismatch` labels (precision 20.5% to 21.2%).
- **All four combined:**
  - 30-day sim: precision 38.9%, worthwhile 58.6%, pair recall 15.9%. That is 5.1x the random baseline's precision, up from 4.1x.
  - Synthetic snapshot: precision 34.6%, against 20.5% before.
- **Invariants:** `minorContacts` = 0 and canary leaks = 0 in every run. Invariant violations are 0 in every final run.

## What changed

### 1. Intent liveness: records anchored to `now`

**The bug.** Records were stamped `createdAt` = join time (sim) or join + 0-20 days (synthetic), with `horizonDays` 60 and no re-confirmation. The engine drops a record at `createdAt + horizon`, while the oracle counted every hidden want forever. Counts:

- Synthetic 1.2.0: 304 of 582 active records (52%) were expired, and 252 of 450 adults had no live intent.
- The PoC measured the same on 1.1.0: 347 of 843 records, and 223 of 450 adults.

**The model** (`packages/sim/src/persona.ts`):

- **Check-ins.** The agent re-asks every `INTENT_RECONFIRM_DAYS` = 30 days. Each check-in is answered with probability `1 - responsiveness.ignoreProb`, drawn deterministically per (persona, intent, check-in).
  - An answer re-confirms a want the member still holds: `createdAt` moves to that check-in.
  - An answer about a want that has lapsed withdraws it: `status: "closed"`.
  - An unanswered check-in leaves the record alone, so it ages out.
  - Members currently at 2 or more unanswered messages count no check-ins. Otherwise a fresh re-confirmation reads as a new ask from an "only when I ask" member: the first version tripped the `two_unanswered` invariant 4 times in 90-day runs.
- **Hidden lapse.** Each hidden want has `Desire.lapsesAt`: an exponential lifetime from when it was stated, with mean 45 days for help, 240 for romance and 365 for everything else (synthetic generator). The sim generator has an opt-in `intentLapse` option, off by default so existing worlds are unchanged.
- **Horizon.** `intentHorizonDays` is 90 for romance and 60 otherwise. The sim now matches the synthetic data.

**The oracle decision** (the one narrow edit in `Oracle.evaluate`):

- The oracle judges on the wants each persona still holds at the window start (`withLiveDesires`).
- A lapsed want never counts, even while a stale record still looks live to the engine. The engine pays for that staleness.
- A held want counts **whether or not the Network's record is live**. That is how untold wants under the richness tiers are already treated: the oracle measures true compatibility, and the engine is fairly penalized for missing information.
- Liveness depends on hidden truth only, so nothing hidden reaches the engine. The engine's view (the record) and the label (hidden liveness) disagree only through two realistic lags:
  - a lapsed want whose next answered check-in hasn't happened yet;
  - a held want whose member stopped answering.

On the regenerated synthetic data, 541 of the 595 non-paused records match hidden truth exactly. Another 9 are wants that an exaggerating persona states but does not hold:

| Record \ hidden want | held | lapsed | not a hidden want (exaggerating persona) |
|---|---:|---:|---:|
| active, live | 399 | 27 | 9 |
| active, expired | 12 | 6 | 0 |
| closed | 0 | 142 | 0 |
| paused | 61 | 2 | 1 |

### 2. Structured complementarity in engine scoring

New files: `packages/engine/src/taxonomy.ts` and `packages/engine/src/complementarity.ts`.

- **Inputs are engine-visible only:**
  - live intents (World already drops inactive or expired records), mapped to the objective taxonomy by objective text, with the agent's `tags:` in `details` as a fallback;
  - goal and desire facets, at weight 0.8;
  - interest tags (the primary tag) and skill, offer and resource tags;
  - the romance preference tags the filters already read.
- **Side benefit.** `side(a <- b) = 0.35 * interest overlap + 0.55 * sat(a's wants by b) + 0.10 * sat(b's wants by a)`.
  - `sat` scores 1 when b has a needed skill or offer, 0.85 for a shared pool, 0.9 for mutual romance preferences, and 0.45 for a companion interest.
- **Reciprocity.** The pair value is the harmonic mean of the two sides (the mean over pairs for groups), matching `mutualBenefit`'s harmonic rule. A pair that only serves one side scores low.
- **Blend.** `fit' = (1 - w) * fit + w * pair` and `benefit_i' = (1 - w) * benefit_i + w * side_i`, applied before the harmonic or without-misery aggregation and before the judge blend.
  - If any participant has no structured profile at all, the term is not applied: unknown is neutral, not a penalty.
  - Floors apply to the blended values.
- **Config (`complementarity`):** `weight` 0.5, `overlap` 0.35, `need` 0.55, `give` 0.1, `retrievalChannel` false, `channelMin` 0.85.
  - Weight 0.5 gives structured evidence the same say as semantic evidence instead of replacing it. Semantic fit still carries free-text wants that fall outside the taxonomy.
  - The sweep below shows 0.5 is not on a cliff.
- **Retrieval channel.** A `need` channel admits members whose skills, offers or pool meet an intent even below `minSim`, and adds `w * satisfaction` to the retrieval order. It is implemented and tested, but **off by default**. In the sim it was neutral to slightly negative (precision 38.3% vs 38.9%, recall 15.3% vs 15.9%). On the synthetic snapshot it gained 0.16 points of recall for 2.2 points of precision.
- **Unchanged:** the hashing embedding.
- **Logging and version.** `runLog.scored[].complementarity` logs the pair value. The engine version is now `engine-v1.1.0`.

### 3. Dating desire implies romance opt-in (`packages/sim/src/generator.ts`)

The generator sampled `dating` independently of the hidden opt-in: 77 of 158 dating adults in sim seeds 1-3 were hidden opt-outs, and 264 of 505 in the evals worlds. Now `romanceOptIn ||= has dating desire`. The RNG draws are unchanged.

`scripts/synthetic/generate.ts` `calibrateRomance` no longer drops the opt-in of a member who holds an unstated dating want. Two synthetic members changed. The remaining 3 dating opt-outs are the age-lying minors, which is correct.

`packages/evals/src/recDataset.ts` `makeConfig` no longer relabels a dating anchor as `social`. This file is outside my ownership; the coordinator asked for the change. The evals suite is green (45/45).

### 4. Oracle presence over the window (`Oracle.evaluate`)

A participant counts as present if they are in the city on any day of the proposal window, capped at 7 days, rather than only at the window start. Point-in-time windows, such as latent pairs and meetings, behave exactly as before.

`evaluatePrimed` (in the other session's block) still checks the window start.

## Results

### Share of adult members with no live intent

| World | Before | After |
|---|---:|---:|
| Synthetic snapshot (1.2.0 -> 1.2.1) | 252 / 450 (56.0%) | **144 / 450 (32.0%)**: 23 never stated an intent; the rest hold only closed, paused or expired records |
| Synthetic 1.1.0 (PoC count) | 223 / 450 | n/a |
| Sim, 150 personas x seeds 1-3, day 30 / 60 | 0% / 0% | 0% / 0% |
| Sim, day 90 | **426 / 426 (100%)** | **7 / 426 (1.6%)** |

### Simulator: engine vs random, 30 days

Method and CLI as in `2026-10-06-engine-v1-vs-random.md`: 150 personas, 30 days, discrete, seeds 1-3, stub network, no LLM.

- Each fix is applied alone on top of the baseline, using an ablation copy of the working tree with env toggles. "All" is the working tree as committed.
- Precision is the mean of the 3 seeds, with per-seed values in parentheses.
- The baseline reproduces the current-tree run exactly. It differs from the October 5 doc because the engine and sim changed since then.

| Variant | Engine precision | Engine worthwhile | Engine pair recall | Engine proposals | Members with no proposal | Random precision / worthwhile / recall | Latent pairs |
|---|---|---:|---:|---:|---:|---|---:|
| baseline | 30.1% (26.2/33.7/30.4) | 48.4% | 14.3% | 317 | 8.0% | 7.4% / 16.3% / 5.1% | 413 |
| + liveness only | identical (no-op at 30 days) | | | | | identical | 413 |
| + dating fix only | 32.4% (31.1/35.6/30.4) | 50.7% | 15.0% | 320 | 8.3% | 8.0% / 17.5% / 5.1% | 438 |
| + presence only | identical (no `city_mismatch` in any sim proposal) | | | | | identical | 413 |
| + complementarity only | 38.0% (40.2/38.2/35.5) | 56.8% | 16.4% | 281 | 20.0% | 7.4% / 16.3% / 5.1% | 413 |
| **all four** | **38.9% (40.5/41.9/34.4)** | **58.6%** | **15.9%** | 283 | 18.8% | 7.7% / 17.1% / 5.0% | 438 |

Across all six variants: `minorContacts` 0, canary leaks 0, invariant violations 0.

### Simulator, 90 days (where intents age)

Same setup with `--days 90`.

| Variant | Engine precision | Worthwhile | Pair recall | Proposals | Proactive / member / week | No proposal |
|---|---|---:|---:|---:|---:|---:|
| baseline | 33.5% (31.3/37.0/32.1) | 53.5% | 22.8% | 646 | 0.33 | 7.5% |
| + liveness only | 34.4% (32.6/36.8/33.8) | 53.7% | **25.1%** | **902** | 0.46 | 7.0% |
| dating + presence + complementarity (old timing) | 41.2% (43.7/43.7/36.1) | 61.3% | 21.0% | 536 | 0.32 | 17.8% |
| **all four** | **42.1% (44.9/44.4/37.0)** | **61.9%** | **22.4%** | **734** | 0.45 | 17.8% |

Random baseline at 90 days: 7.4% precision, 17.2% worthwhile and 17.4% recall; with the dating fix, 9.1%, 20.2% and 19.3%.

Before the liveness fix, the engine went quiet after about day 60, because every intent had expired. The fix restores the volume at equal or better precision.

All 90-day runs: `minorContacts` 0 and canary leaks 0. The final runs have 0 invariant violations.

The oracle-gap ratio is omitted at 90 days: it compares 90 days of proposals with a one-shot latent welfare, so it exceeds 100%.

### Synthetic snapshot, one engine tick (`load.ts --engine`, seed 1, no judge)

Columns:

- "Top-N by score" is the PoC's ranking diagnostic: the precision of the top N scored pairs by engine score, where N is the number of proposed pairs, inside the engine's own scored pair set.
- The base rate is the latent pairs over about 49K same-city candidate pairs: 8.5% before liveness and 6.5% after, because lapsed wants are no longer good pairs. The liveness rows are therefore scored against different labels.

| Variant | Proposals | Precision | Mean quality | Latent pairs | Pair recall | Top-N by score (N) | Scored-set precision | Adults with any proposal | No live intent |
|---|---:|---:|---:|---:|---:|---|---:|---:|---:|
| baseline (1.2.0 data) | 151 | 20.5% | 0.440 | 4,192 | 1.19% | 22.6% (243) | 16.9% | 51.1% | 252 |
| + liveness only (1.2.1 timing) | 216 | 25.5% | 0.458 | 3,191 | 1.72% | 24.4% (246) | 15.4% | 60.4% | 144 |
| + dating fix only | 153 | 20.9% | 0.454 | 4,192 | 1.17% | 22.4% (245) | 16.9% | 51.1% | 252 |
| + presence only | 151 | 21.2% | 0.440 | 4,192 | 1.19% | 22.6% (243) | 16.9% | 51.1% | 252 |
| + complementarity only | 128 | 32.8% | 0.518 | 4,192 | 1.12% | 32.4% (176) | 17.4% | 41.6% | 252 |
| all but complementarity | 213 | 25.4% | 0.450 | 3,191 | 1.63% | 24.7% (243) | 15.4% | 60.0% | 144 |
| **all four (committed data)** | **208** | **34.6%** | **0.500** | 3,191 | **2.10%** | **35.8% (229)** | 16.4% | 54.9% | 144 |

Every row: 0 minors in any proposal and 0 canary leaks.

**By richness tier.** Each cell is the share of adults with a proposal / oracle precision of the proposals touching the tier / latent-pair recall.

| Tier (adults) | Baseline | Liveness only | Complementarity only | All four |
|---|---|---|---|---|
| minimal (63) | 21% / 30% (n=10) / 0.30% | 24% / 9% / 0.09% | 21% / 18% / 0.23% | 25% / 23% (n=13) / 0.28% |
| light (115) | 41% / 17% / 0.70% | 41% / 23% / 0.68% | 37% / 33% / 0.70% | 40% / 35% / 0.87% |
| medium (131) | 50% / 18% / 1.14% | 73% / 26% / 2.01% | 41% / 31% / 0.99% | 64% / 34% / 2.34% |
| rich (94) | 71% / 18% / 1.80% | 81% / 26% / 3.36% | 59% / 31% / 1.80% | 72% / 35% / 3.87% |
| very_rich (47) | 79% / 19% / 3.34% | 81% / 19% / 2.85% | 49% / 32% / 2.38% | 70% / 33% / 4.17% |

Complementarity raises precision in every tier with any data. Minimal-tier numbers rest on 10-13 proposals.

### Complementarity weight sweep (all other fixes on)

| Weight | Sim precision | Sim worthwhile | Sim pair recall | Sim no proposal | Synthetic precision | Synthetic recall | Synthetic top-N |
|---|---:|---:|---:|---:|---:|---:|---:|
| 0 | 32.4% | 50.7% | 15.0% | 8.3% | 25.4% | 1.63% | 24.7% |
| 0.25 | 35.7% | 54.1% | 15.8% | 11.8% | 26.3% | 1.69% | 30.4% |
| 0.35 | 37.7% | 58.4% | 16.4% | 14.3% | 29.7% | 1.82% | 34.7% |
| **0.5 (default)** | **38.9%** | **58.6%** | 15.9% | 18.8% | **34.6%** | 2.10% | 35.8% |
| 0.75 | 41.6% | 58.1% | 16.6% | 20.3% | 33.0% | 2.23% | 40.6% |
| 0.5 + `need` retrieval channel | 38.3% | 58.7% | 15.3% | 19.3% | 32.4% | 2.26% | 36.9% |

The sim weight-0 row is the "dating fix only" row: the liveness and presence fixes are no-ops in the 30-day sim.

How the default was picked:

- The worthwhile rate plateaus from 0.35. Precision keeps rising, but the no-proposal share also rises.
- 0.5 is the point where both datasets are near their best on precision without going to 0.75, where the structured term dominates.
- If reach matters more than precision, **0.35** gives up about 1 point of sim precision (5 on synthetic) and cuts the no-proposal share from 19% to 14%.

## Caveats

- **The taxonomy is shared with the oracle.** `taxonomy.ts` mirrors `packages/sim/src/taxonomy.ts` `DESIRES` (a test pins them together), and the side-benefit form resembles the oracle's pair terms. Part of the gain is built in.
  - The transferable claim is that complementarity structure (needs to offers, shared pools) predicts good pairs and text similarity does not.
  - On real members, the structure has to come from LLM extraction into the taxonomy at profile-update time, and the keyword mapper here is only a stand-in. The PoC's offline structured re-rank reached 46-47%. The blend here reaches 32-36% top-N on synthetic data, because it is a 50/50 blend and goes through floors, budgets and selection.
- **Fairness cost.** Complementarity concentrates proposals on members with something to match on.
  - Sim members with no proposal go from 8% to 19%, and the Gini from 0.39 to 0.44.
  - On the synthetic snapshot, the 38 adults who lost all proposals have fewer latent good partners (11.5 on average, against 14.2 for all adults and 21.6 for the 18 who gained), so many of those were low-precision filler intros.
  - The exposure floor and exposure debt still apply. Watch this in the observatory before a pilot.
- **Liveness changes the labels.** Lapsed wants (205 of 855 hidden wants on the synthetic snapshot, 24%) are no longer good pairs, so the latent pairs fall from 4,192 to 3,191. The before/after precision on synthetic data compares different label sets. The lapse rates (45/240/365-day mean lifetimes) are assumptions, not data.
- **Two lag cases remain by design.** 27 live-but-lapsed records cost precision, and 12 expired-but-held records cost recall.
- **Not liveness-aware.** In the other session's code, `desireMet`, `categoryWant`, `probe` and `evaluatePrimed` still read every hidden want, and `evaluatePrimed` still checks presence at the window start. The LLM persona agent also still sees every hidden want (`llmAgent.ts`).
- **The 30-day sim cannot show fix 1 or fix 4.** No intent is older than 36 days, and no engine or random proposal had a city mismatch. Use the 90-day runs and the synthetic snapshot for those.
- **Single seed** for the synthetic run: its per-tier numbers rest on 10-112 proposals. The sim uses 3 seeds.
- **No LLM spend.** The synthetic data was regenerated from the prose cache (0 calls, $0). The judge was off throughout. The evals passes were not re-run on the fixed dataset.

## Reproduce

```bash
bun scripts/synthetic/generate.ts --max-fresh 0     # generator 1.2.1, 0 LLM calls
bun scripts/synthetic/validate.ts                   # 20/20, incl. intent_liveness_anchored
bun scripts/synthetic/load.ts --engine              # all fixes; writes v1/engine_v1_run.json (incl. "oracle")
bun scripts/synthetic/load.ts --engine --no-write --config='{"complementarity":{"weight":0}}'
bun run packages/sim/src/cli.ts --personas 150 --days 30 --mode discrete --seed 1 --network stub --engine ./packages/sim/engines/engine-v1.ts --json
```

The per-fix ablations ran in a scratch copy of the working tree with env toggles that revert one fix each: old intent timing (`createdAt` = join, horizon 60, no lapses), no dating opt-in coupling, and a point-in-time presence check. Complementarity was toggled through config (`complementarity.weight` 0). The toggles were not committed.
