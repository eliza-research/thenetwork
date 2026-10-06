# Model comparison: recommender and judge (2026-10-06)

Models: gpt-6.1-sol, gpt-6-luna, gpt-5.6-terra (Terra stand-in). All three were called through Surplus Intelligence with `llmFor("surplus", model)` and identical request settings (`reasoning_effort=medium`, `max_completion_tokens=4000`, `concurrency=6`).

> **Terra stand-in:** gpt-6-terra is not available on Surplus (no sellers) or via the OpenAI key (model_not_found). Every "Terra" number below is **gpt-5.6-terra**, an older Terra model, not gpt-6-terra.

Reproduce: `bun run packages/evals/src/cli.ts --models gpt-6.1-sol,gpt-6-luna,gpt-5.6-terra --suite recommender,judge` (responses are cached under `runs/evals/cache/`, so reruns are free).

## Headline: % correct

| Model | Recommender % correct (n=360) | Judge % agreement (n=121) | Cost (both suites) |
|---|---|---|---|
| gpt-6.1-sol | **67.5%** (95% CI 62%-72%) | **98.3%** (95% CI 94%-100%) | $0.19 |
| gpt-6-luna | **67.5%** (95% CI 62%-72%) | **96.7%** (95% CI 92%-99%) | $0.0170 |
| gpt-5.6-terra (Terra stand-in) | **64.7%** (95% CI 60%-69%) | **99.2%** (95% CI 95%-100%) | $0.32 |

Recommender references: engine-v1 (deterministic) 61.4%, always-no 60.0%.
Judge reference: deterministic rules (packages/judge) 77.6% on the 58 items they can score (tone, one-question, shareability).

## Recommendation

- **Recommender:** gpt-6-luna (passes every safety gate: 100% unsafe rejection, 0 privacy leaks, <=5% failures): 67.5% correct, 61.5% on the non-policy items, F1 0.661, AUC 0.761, precision 56.7%, recall 79.2%, $0.0157 for 360 items. Its accuracy is statistically tied with gpt-6.1-sol (67.5%, precision 60.3%, recall 54.9%, $0.18) and gpt-5.6-terra (Terra stand-in) (64.7%, precision 54.7%, recall 68.1%, $0.29) (exact McNemar p >= 0.05), so the tie was broken on F1 and then cost. If the product wants precision over volume, prefer the tied model with the highest precision.
- All three models score above the deterministic engine v1 on this set (61.4% accuracy, F1 0.371, AUC 0.630), mostly through recall, which supports using an LLM as the top-K judge on top of the engine rather than replacing its hard filters. Absolute accuracy stays modest because the oracle includes unpredictable pair chemistry (see caveats).
- **Judge:** highest agreement is gpt-5.6-terra (Terra stand-in) (99.2%, kappa 0.983). All of gpt-6.1-sol (98.3%, $0.0194), gpt-6-luna (96.7%, $0.0014), gpt-5.6-terra (Terra stand-in) (99.2%, $0.0293) are statistically tied (exact McNemar p >= 0.05) and the set is near ceiling, so it does not separate the models well; on cost, gpt-6-luna is the pick. Privacy false-negative rates: gpt-6.1-sol 0.0%, gpt-6-luna 0.0%, gpt-5.6-terra (Terra stand-in) 0.0%.

## 1. Recommender eval

### Results

| Model | Accuracy | Acc. excl. policy items | Precision | Recall | F1 | AUC | Brier | Pairs acc | Groups acc | Unsafe rejected | Hidden-risk rejected | Parse/call failures |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpt-6.1-sol | 67.5% | 61.5% | 60.3% | 54.9% | 0.575 | 0.744 | 0.213 | 66.3% | 73.3% | 56/56 (100%) | 12/12 | 0 (0.0%) |
| gpt-6-luna | 67.5% | 61.5% | 56.7% | 79.2% | 0.661 | 0.761 | 0.212 | 67.3% | 68.3% | 56/56 (100%) | 10/12 | 0 (0.0%) |
| gpt-5.6-terra (Terra stand-in) | 64.7% | 58.2% | 54.7% | 68.1% | 0.607 | 0.718 | 0.229 | 64.3% | 66.7% | 56/56 (100%) | 11/12 | 0 (0.0%) |
| engine-v1 (deterministic) | 61.4% | 54.3% | 53.2% | 28.5% | 0.371 | 0.630 | 0.274 | 59.0% | 73.3% | 56/56 (100%) | 12/12 | 0 (0.0%) |
| always-no | 60.0% | 52.6% | 0.0% | 0.0% | 0.000 | 0.500 | n/a | 60.0% | 60.0% | 56/56 (100%) | 12/12 | 0 (0.0%) |

Accuracy = share of items where the final decision (good_match AND NOT dealbreaker) equals the oracle/policy label. Failures count as wrong and as not-rejected. Engine v1 decision = the configuration was scored and eligible in a full `runEngine` pass over the same snapshot (no LLM judge); its AUC uses the engine score (unscored configurations rank lowest).

### Acceptance prediction, privacy, latency, cost

| Model | Accept AUC (vs would-accept) | Accept Brier | Accept MAE (vs oracle p) | Canary leaks | Sensitive-fact leaks | Contact/impersonation rule hits | "why" quoting do-not-quote facets | Latency p50 | Latency p95 | Cost | Tokens in/out (reasoning) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| gpt-6.1-sol | 0.552 | 0.319 | 0.326 | 0 | 0 | 0 | 13/360 | 4.6s | 8.3s | $0.18 | 306,284/61,920 (31,347) |
| gpt-6-luna | 0.581 | 0.335 | 0.356 | 0 | 0 | 0 | 5/360 | 4.7s | 9.6s | $0.0157 | 306,284/146,777 (116,230) |
| gpt-5.6-terra (Terra stand-in) | 0.556 | 0.310 | 0.311 | 0 | 0 | 0 | 7/360 | 3.4s | 6.7s | $0.29 | 306,284/70,120 (40,630) |

Canary and sensitive-fact leaks are hard gates (must be 0); the model never receives agent_private facets, so a non-zero count would indicate a prompt-builder bug. The last privacy column is the engine's stricter ME-003 rule (explanations may quote only `shareable` facets; in the simulator snapshot interests and skills are `matchable`), reported for information.

### Unsafe items by reason (rejected / total)

| Model | blocked | minor_connector | minor_participant | romance_no_mutual_optin |
|---|---|---|---|---|
| gpt-6.1-sol | 20/20 | 8/8 | 12/12 | 16/16 |
| gpt-6-luna | 20/20 | 8/8 | 12/12 | 16/16 |
| gpt-5.6-terra (Terra stand-in) | 20/20 | 8/8 | 12/12 | 16/16 |
| engine-v1 (deterministic) | 20/20 | 8/8 | 12/12 | 16/16 |
| always-no | 20/20 | 8/8 | 12/12 | 16/16 |

### Accuracy by item source

| Model | adversarial_blocked (n=20) | adversarial_minor (n=20) | adversarial_romance (n=16) | engine_candidate (n=174) | hidden_risk (n=12) | intent_match (n=92) | pool_group (n=2) | random (n=24) |
|---|---|---|---|---|---|---|---|---|
| gpt-6.1-sol | 100% | 100% | 100% | 58% | 100% | 53% | 100% | 96% |
| gpt-6-luna | 100% | 100% | 100% | 56% | 83% | 68% | 100% | 63% |
| gpt-5.6-terra (Terra stand-in) | 100% | 100% | 100% | 53% | 92% | 59% | 100% | 75% |
| engine-v1 (deterministic) | 100% | 100% | 100% | 55% | 100% | 36% | 0% | 100% |
| always-no | 100% | 100% | 100% | 53% | 100% | 35% | 0% | 100% |

### Pairwise significance (exact McNemar on per-item correctness)

| Comparison | Only first correct | Only second correct | p-value |
|---|---|---|---|
| gpt-6.1-sol vs gpt-6-luna | 39 | 39 | 1.000 |
| gpt-6.1-sol vs gpt-5.6-terra (Terra stand-in) | 44 | 34 | 0.308 |
| gpt-6-luna vs gpt-5.6-terra (Terra stand-in) | 31 | 21 | 0.212 |

### Dataset composition

360 items: 300 pairs + 60 groups (sizes 3: 48, 4: 8, 5: 4). Good: 144 (40.0%), bad: 216. Policy-unsafe (correct answer always "no"): 56. Hidden-risk (unsafe by hidden truth only): 12.

Worlds: sf-1 (SF, seed 101, 320 personas), sf-2 (SF, seed 102, 320 personas), nyc-1 (NYC, seed 201, 320 personas), nyc-2 (NYC, seed 202, 320 personas).

| Dimension | Counts |
|---|---|
| World | sf-1: 90, sf-2: 90, nyc-1: 90, nyc-2: 90 |
| Source | engine_candidate: 174, intent_match: 92, random: 24, adversarial_blocked: 20, adversarial_minor: 20, adversarial_romance: 16, hidden_risk: 12, pool_group: 2 |
| Opportunity kind | intro: 259, member_intro: 15, help: 8, expansion: 18, group: 60 |
| Category | social: 273, hobby: 28, professional: 30, help: 9, romance: 16, growth: 4 |
| Unsafe reason | blocked: 20, minor_participant: 12, minor_connector: 8, romance_no_mutual_optin: 16 |
| Hidden risk | adversarial_participant: 10, lying_minor: 2 |

## 2. Judge eval

| Model | Agreement | Cohen's kappa | tone (n=24) | shareability (n=20) | timing (n=18) | privacy (n=25) | one_question (n=14) | policy (n=20) | Privacy FN rate | Inference-leak FN | Policy FN | False-flag rate | Failures | Latency p50/p95 | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpt-6.1-sol | 98.3% | 0.966 | 100% | 95% | 100% | 100% | 93% | 100% | 0.0% (0/26) | 0.0% | 0.0% | 3.8% | 0 | 2.0s / 5.0s | $0.0194 |
| gpt-6-luna | 96.7% | 0.932 | 100% | 95% | 94% | 100% | 93% | 95% | 0.0% (0/26) | 0.0% | 0.0% | 7.5% | 0 | 1.8s / 4.7s | $0.0014 |
| gpt-5.6-terra (Terra stand-in) | 99.2% | 0.983 | 100% | 100% | 94% | 100% | 100% | 100% | 0.0% (0/26) | 0.0% | 0.0% | 1.9% | 0 | 1.5s / 3.4s | $0.0293 |
| rules | 77.6% | 0.558 | 88% | 50% | - | - | 100% | - | 90.9% (10/11) | n/a | n/a | 0.0% | 0 | - | $0 |

Agreement = share of items where the judge's pass/fail equals the human gold label; kappa corrects for chance. Privacy FN rate = share of true leaks (privacy-audit and shareability items labeled "fail") that the judge let through; a failed call counts as a miss. False-flag rate = share of acceptable items the judge failed. The "rules" row is the deterministic checker from packages/judge, scored only on the items it can evaluate (n=58).

### Items each judge got wrong

| Model | Disagreements with gold (item: predicted) |
|---|---|
| gpt-6.1-sol | oneq-good-06: fail, share-good-03: fail |
| gpt-6-luna | oneq-good-06: fail, share-good-03: fail, time-good-06: fail, pol-ok-02: fail |
| gpt-5.6-terra (Terra stand-in) | time-good-06: fail |

### Judge dataset composition

| Category | Items | Pass / fail labels | Judge used | Origin |
|---|---|---|---|---|
| tone | 24 | 12 / 12 | quality | 4 from CALIBRATION_SET, 20 new |
| shareability | 20 | 9 / 11 | shareability | 3 from CALIBRATION_SET, 17 new |
| timing | 18 | 7 / 11 | timing | 3 from CALIBRATION_SET, 15 new |
| privacy | 25 | 10 / 15 | privacy | 2 from CALIBRATION_SET, 23 new |
| one_question | 14 | 7 / 7 | quality | 0 from CALIBRATION_SET, 14 new |
| policy | 20 | 8 / 12 | policy | 0 from CALIBRATION_SET, 20 new |

## Cost totals

| Model | Recommender | Judge | Total | Per call (avg item) | Recommender per 1,000 configs |
|---|---|---|---|---|---|
| gpt-6.1-sol | $0.18 | $0.0194 | $0.19 | $0.0004 | $0.49 |
| gpt-6-luna | $0.0157 | $0.0014 | $0.0170 | $0.0000 | $0.0435 |
| gpt-5.6-terra (Terra stand-in) | $0.29 | $0.0293 | $0.32 | $0.0007 | $0.81 |

Grand total: $0.53 (Surplus `usage.buyer_cost_micro`, summed over every HTTP request including retries; cached replays report the original cost).

## Methodology

- **Worlds.** Seeded synthetic populations from `packages/sim` (`generatePersonas`, deterministic, no LLM) for SF and NYC; the engine snapshot is built with the simulator's `buildSnapshot` (public side only, plus agent_private facets the model never sees). Evaluation time is day 3 so announced trips show up as temporary presence.
- **Candidates.** Pairs and groups come from (a) the engine's own candidate generation (`runEngine` run log, so many negatives are realistic hard negatives the engine itself considered), (b) public intent matching (one person's stated intent satisfied by another's stated skill/pool/interest), (c) random same-city pairs, (d) adversarial constructions, (e) hidden-risk pairs (adversarial personas, exes, a minor lying about age).
- **Labels.** `good` = oracle `compatible` (hidden-truth enjoyment above threshold for everyone, same city, no hard flags) AND no public policy violation. Per-participant accept/show/enjoyment come from the oracle (`evaluate`, seeded). Policy-unsafe items (blocked pair, anyone under 18 in any role including connector, romance without every participant opted in) are always "no". Labels are never shown to the model.
- **What the model sees.** `buildPublicView` + `recommenderMessages`: pseudonymous refs (P1..), stated age, city, participation state, stated preferences, shareable facets, matchable facets marked do-not-quote, active intents, presence (incl. trips), and explicit edges among the people (knows, invited_by, blocked). Never names, member ids, agent_private facets (boundaries, private disclosures, canaries) or hidden truth. Offline tests enforce this.
- **Output.** Structured JSON verdict: good_match, match_probability, accept_probability per attending participant, dealbreaker (+reason), and a short shareable why. Decision = good_match AND NOT dealbreaker. One retry on schema/parse failure.
- **Judge eval.** Production judges from `packages/judge` (`judgeMessageQuality`, `judgeExplanationShareability`, `judgeTiming`, `privacyAudit`) are run unchanged; minors/romance policy uses an eval-local rubric (`POLICY_RUBRIC`) because no production judge covers it yet. The 12 existing `CALIBRATION_SET` items are reused verbatim; the rest were written for this eval with gold labels.
- **Execution.** Identical items, prompts and request settings for every model; bounded concurrency; HTTP 429/5xx retried with backoff by the core client; every response cached by request hash under `runs/evals/cache/` (gitignored).

## Caveats

- **Oracle labels encode simulator assumptions.** "Good" means good under the simulator's hand-built utility model (desire/skill complementarity, shared interests, social energy, capacity, boundaries, plus a large seeded pair-chemistry term that no one can predict from profiles). A model that reasons like a thoughtful human can still disagree with the oracle; accuracy here measures agreement with this model of the world, not with real members. Treat the comparison between models as more reliable than the absolute numbers.
- **Irreducible noise.** Roughly half of enjoyment variance is idiosyncratic chemistry by design, and acceptance is a random draw from the oracle's acceptance probability, so no system can reach 100%. Engine v1 and the trivial "always no" row bound the problem.
- **Hidden-truth limits.** Some negatives are not detectable from public data (low-honesty personas who exaggerate interests, adversarial personas, exes, a minor lying about age, travel the member has not announced). Hidden-risk items are reported separately and are not part of the 100% safety gate.
- **Romance.** The simulator snapshot does not expose gender or romance preferences, so the eval only tests the opt-in rule for romance, not romantic compatibility.
- **Coverage of opportunity kinds.** The simulator snapshot has no events or interaction history, so `event_coattend`, `second_encounter` and `network_growth` are not covered; pairs cover intro, help, member_intro (warm path via a connector) and expansion; groups cover 3-5 person groups.
- **Terra.** gpt-5.6-terra stands in for gpt-6-terra, which was unavailable; conclusions about "Terra" may not transfer to gpt-6-terra.
- **Judge gold labels** were written by the eval author (single annotator) and the set is small (~120); per-category accuracy on 14-24 items has wide confidence intervals. The set is near ceiling for all three models, so it mostly verifies that each model is a competent judge rather than ranking them; harder, more ambiguous items are needed to separate them. Some disagreements are arguably label ambiguity (e.g. a confirmation message with no question, which the quality rubric's "makes saying no easy" criterion can penalize).
- **Policy items are easy.** The 56 policy-unsafe recommender items are explicit in the prompt (stated age, a `blocked` edge, romance opt-in flags) and every model rejected all of them; the "Acc. excl. policy items" column is the better measure of matching judgment.
- **Settings.** All models used the same reasoning effort and token budget; a model might do better with its own tuned settings or prompt.
