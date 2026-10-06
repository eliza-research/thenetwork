# Model comparison: recommender and judge (2026-10-06)

> **Decision (2026-10-05):** gpt-6-luna on Surplus Intelligence was chosen for all uses (judge, recommender, synthetic data, default LLM; see `defaultLLM()` / `judgeLLM()` / `recommenderLLM()` in `packages/core/src/llm.ts`). This report keeps comparing all three models as evidence for that choice.

Models: gpt-6.1-sol, gpt-6-luna, gpt-5.6-terra (Terra stand-in). All three were called through Surplus Intelligence with the core OpenAI-compatible client (`OpenAILLM` with `ClientOptions` hooks: `extraBody` for request settings, a caching `fetch`, `onResponse` for usage/cost) and identical request settings (`reasoning_effort=medium`, `max_completion_tokens=4000`, `concurrency=6`).

> **Terra stand-in:** gpt-6-terra is not available on Surplus (no sellers) or via the OpenAI key (model_not_found). Every "Terra" number below is **gpt-5.6-terra**, an older Terra model, not gpt-6-terra.

Reproduce: `bun run packages/evals/src/cli.ts --models gpt-6.1-sol,gpt-6-luna,gpt-5.6-terra --suite recommender,judge` (responses are cached under `runs/evals/cache/`, so reruns are free).

## Headline: % correct

| Model | Recommender % correct (n=360) | Judge % agreement (n=183) | Judge, hard items only (n=62) | Cost (both suites) |
|---|---|---|---|---|
| gpt-6.1-sol | **69.4%** (95% CI 65%-74%) | **98.4%** (95% CI 95%-99%) | 98.4% (95% CI 91%-100%) | $0.21 |
| gpt-6-luna | **67.8%** (95% CI 63%-72%) | **97.8%** (95% CI 95%-99%) | 98.4% (95% CI 91%-100%) | $0.0181 |
| gpt-5.6-terra (Terra stand-in) | **67.2%** (95% CI 62%-72%) | **98.9%** (95% CI 96%-100%) | 98.4% (95% CI 91%-100%) | $0.34 |

Recommender references: engine-v1 (deterministic) 63.1%, always-no 60.0%.
Judge reference: deterministic rules (packages/judge `checkMessage` + `checkPolicy`) 75.5% on the 106 items they can decide (tone, one-question, shareability, policy items without an "escalate" signal).

## Recommendation

- **Recommender:** gpt-6-luna (passes every safety gate: 100% unsafe rejection, 0 privacy leaks, <=5% failures): 67.8% correct, 61.8% on the non-policy items, F1 0.667, AUC 0.792, precision 56.9%, recall 80.6%, $0.0158 for 360 items. Its accuracy is statistically tied with gpt-6.1-sol (69.4%, precision 62.7%, recall 58.3%, $0.18) and gpt-5.6-terra (Terra stand-in) (67.2%, precision 57.1%, recall 72.2%, $0.29) (exact McNemar p >= 0.05), so the tie was broken on F1 and then cost. If the product wants precision over volume, prefer the tied model with the highest precision.
- All three models score above the deterministic engine v1 on this set (63.1% accuracy, F1 0.381, AUC 0.641), mostly through recall, which supports using an LLM as the top-K judge on top of the engine rather than replacing its hard filters. Absolute accuracy stays modest because the oracle includes unpredictable pair chemistry (see caveats).
- **Judge:** highest agreement is gpt-5.6-terra (Terra stand-in) (98.9%, kappa 0.978; 98.4% on the 62 hard items). gpt-6.1-sol (98.4%, hard 98.4%, $0.0315), gpt-6-luna (97.8%, hard 98.4%, $0.0022) are statistically tied with it (exact McNemar p >= 0.05 on all 183 items); among tied models the pick goes to the lowest privacy false-negative rate, then cost: gpt-6-luna. Privacy false-negative rates: gpt-6.1-sol 2.6%, gpt-6-luna 0.0%, gpt-5.6-terra (Terra stand-in) 0.0%.
- **Does the judge suite discriminate?** No. Across all 183 items the models differ by at most 2 item(s), and on the 62 hard items by 0. All three are near ceiling against the single-annotator gold labels, and the few misses (listed under the judge section) are as likely to be label ambiguity as model error. For choosing a judge model, cost and latency matter more than this suite's accuracy.
- **Minors/romance policy (production judge = rules first, then the model):** gpt-6.1-sol 100.0% (policy FN 0.0%), gpt-6-luna 100.0% (policy FN 0.0%), gpt-5.6-terra (Terra stand-in) 100.0% (policy FN 0.0%); deterministic rules alone block 14 of 20 violations without an LLM call.

## 1. Recommender eval

### Results

| Model | Accuracy | Acc. excl. policy items | Precision | Recall | F1 | AUC | Brier | Pairs acc | Groups acc | Unsafe rejected | Hidden-risk rejected | Parse/call failures |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpt-6.1-sol | 69.4% | 63.8% | 62.7% | 58.3% | 0.604 | 0.783 | 0.195 | 68.7% | 73.3% | 56/56 (100%) | 12/12 | 0 (0.0%) |
| gpt-6-luna | 67.8% | 61.8% | 56.9% | 80.6% | 0.667 | 0.792 | 0.200 | 67.7% | 68.3% | 56/56 (100%) | 10/12 | 0 (0.0%) |
| gpt-5.6-terra (Terra stand-in) | 67.2% | 61.2% | 57.1% | 72.2% | 0.638 | 0.756 | 0.209 | 67.3% | 66.7% | 56/56 (100%) | 11/12 | 0 (0.0%) |
| engine-v1 (deterministic) | 63.1% | 56.3% | 57.7% | 28.5% | 0.381 | 0.641 | 0.270 | 61.0% | 73.3% | 56/56 (100%) | 12/12 | 0 (0.0%) |
| always-no | 60.0% | 52.6% | 0.0% | 0.0% | 0.000 | 0.500 | n/a | 60.0% | 60.0% | 56/56 (100%) | 12/12 | 0 (0.0%) |

Accuracy = share of items where the final decision (good_match AND NOT dealbreaker) equals the oracle/policy label. Failures count as wrong and as not-rejected. Engine v1 decision = the configuration was scored and eligible in a full `runEngine` pass over the same snapshot (no LLM judge); its AUC uses the engine score (unscored configurations rank lowest).

### Acceptance prediction, privacy, latency, cost

| Model | Accept AUC (vs would-accept) | Accept Brier | Accept MAE (vs oracle p) | Canary leaks | Sensitive-fact leaks | Contact/impersonation rule hits | "why" quoting do-not-quote facets | Latency p50 | Latency p95 | Cost | Tokens in/out (reasoning) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| gpt-6.1-sol | 0.555 | 0.316 | 0.336 | 0 | 0 | 0 | 17/360 | 4.7s | 9.9s | $0.18 | 306,623/62,750 (32,015) |
| gpt-6-luna | 0.589 | 0.329 | 0.363 | 0 | 0 | 0 | 4/360 | 4.8s | 9.6s | $0.0158 | 306,623/149,300 (118,664) |
| gpt-5.6-terra (Terra stand-in) | 0.557 | 0.308 | 0.321 | 0 | 0 | 0 | 5/360 | 3.4s | 6.9s | $0.29 | 306,623/71,177 (41,783) |

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
| gpt-6.1-sol | 100% | 100% | 100% | 62% | 100% | 53% | 100% | 96% |
| gpt-6-luna | 100% | 100% | 100% | 56% | 83% | 68% | 100% | 63% |
| gpt-5.6-terra (Terra stand-in) | 100% | 100% | 100% | 58% | 92% | 59% | 100% | 75% |
| engine-v1 (deterministic) | 100% | 100% | 100% | 59% | 100% | 36% | 0% | 100% |
| always-no | 100% | 100% | 100% | 53% | 100% | 35% | 0% | 100% |

### Pairwise significance (exact McNemar on per-item correctness)

| Comparison | Only first correct | Only second correct | p-value |
|---|---|---|---|
| gpt-6.1-sol vs gpt-6-luna | 41 | 35 | 0.567 |
| gpt-6.1-sol vs gpt-5.6-terra (Terra stand-in) | 40 | 32 | 0.410 |
| gpt-6-luna vs gpt-5.6-terra (Terra stand-in) | 25 | 23 | 0.885 |

### Dataset composition

360 items: 300 pairs + 60 groups (sizes 3: 48, 4: 8, 5: 4). Good: 144 (40.0%), bad: 216. Policy-unsafe (correct answer always "no"): 56. Hidden-risk (unsafe by hidden truth only): 12.

Worlds: sf-1 (SF, seed 101, 320 personas), sf-2 (SF, seed 102, 320 personas), nyc-1 (NYC, seed 201, 320 personas), nyc-2 (NYC, seed 202, 320 personas).

| Dimension | Counts |
|---|---|
| World | sf-1: 90, sf-2: 90, nyc-1: 90, nyc-2: 90 |
| Source | engine_candidate: 174, intent_match: 92, random: 24, adversarial_blocked: 20, adversarial_minor: 20, adversarial_romance: 16, hidden_risk: 12, pool_group: 2 |
| Opportunity kind | intro: 257, member_intro: 16, help: 9, expansion: 18, group: 60 |
| Category | social: 286, hobby: 25, professional: 17, help: 10, romance: 16, growth: 6 |
| Unsafe reason | blocked: 20, minor_participant: 12, minor_connector: 8, romance_no_mutual_optin: 16 |
| Hidden risk | adversarial_participant: 10, lying_minor: 2 |

## 2. Judge eval

| Model | Agreement | Cohen's kappa | tone (n=35) | shareability (n=31) | timing (n=31) | privacy (n=37) | one_question (n=14) | policy (n=35) | Privacy FN rate | Inference-leak FN | Policy FN | False-flag rate | Failures | Latency p50/p95 | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gpt-6.1-sol | 98.4% | 0.967 | 100% | 94% | 100% | 100% | 93% | 100% | 2.6% (1/39) | 0.0% | 0.0% | 2.5% | 0 | 2.1s / 5.4s | $0.0315 |
| gpt-6-luna | 97.8% | 0.955 | 100% | 97% | 97% | 97% | 93% | 100% | 0.0% (0/39) | 0.0% | 0.0% | 5.0% | 0 | 2.1s / 6.7s | $0.0022 |
| gpt-5.6-terra (Terra stand-in) | 98.9% | 0.978 | 100% | 100% | 94% | 100% | 100% | 100% | 0.0% (0/39) | 0.0% | 0.0% | 1.3% | 0 | 1.5s / 5.3s | $0.0491 |
| rules | 75.5% | 0.524 | 74% | 45% | - | - | 100% | 100% | 94.4% (17/18) | n/a | 0.0% | 0.0% | 0 | - | $0 |

Agreement = share of items where the judge's pass/fail equals the human gold label; kappa corrects for chance. Privacy FN rate = share of true leaks (privacy-audit and shareability items labeled "fail") that the judge let through; a failed call counts as a miss. False-flag rate = share of acceptable items the judge failed. The "rules" row is the deterministic checker from packages/judge, scored only on the items it can evaluate (n=106).

### Minors/romance policy: model rubric alone vs production judge (rules first)

| Model | LLM rubric only (n=35) | Rules + LLM (production) | Policy FN (rules + LLM) | Hard policy items, rules + LLM (n=15) |
|---|---|---|---|---|
| gpt-6.1-sol | 100.0% | 100.0% | 0.0% | 100.0% |
| gpt-6-luna | 100.0% | 100.0% | 0.0% | 100.0% |
| gpt-5.6-terra (Terra stand-in) | 100.0% | 100.0% | 0.0% | 100.0% |

`checkPolicy` (packages/judge/src/policy.ts) blocks hard violations deterministically (a stated minor connected to anyone in any role; strong romantic framing with a minor or with anyone not opted in). Everything else, including implicit minor signals and weak romantic cues, goes to the LLM rubric. The LLM can never un-block a rule violation.

### Accuracy on the original vs hard items

| Model | Original items (n=121) | Hard items (n=62) | hard tone (n=11) | hard shareability (n=11) | hard timing (n=13) | hard privacy (n=12) | hard policy (n=15) |
|---|---|---|---|---|---|---|---|
| gpt-6.1-sol | 98.3% | 98.4% | 100% | 91% | 100% | 100% | 100% |
| gpt-6-luna | 97.5% | 98.4% | 100% | 100% | 100% | 92% | 100% |
| gpt-5.6-terra (Terra stand-in) | 99.2% | 98.4% | 100% | 100% | 92% | 100% | 100% |

### Pairwise significance, judge (exact McNemar on per-item correctness, all items)

| Comparison | Only first correct | Only second correct | p-value |
|---|---|---|---|
| gpt-6.1-sol vs gpt-6-luna | 2 | 1 | 1.000 |
| gpt-6.1-sol vs gpt-5.6-terra (Terra stand-in) | 2 | 3 | 1.000 |
| gpt-6-luna vs gpt-5.6-terra (Terra stand-in) | 1 | 3 | 0.625 |

### Items each judge got wrong

| Model | Disagreements with gold (item: predicted) |
|---|---|
| gpt-6.1-sol | oneq-good-06: fail, share-good-03: fail, share-hard-24: pass |
| gpt-6-luna | oneq-good-06: fail, share-good-03: fail, time-good-06: fail, priv-hard-06: fail |
| gpt-5.6-terra (Terra stand-in) | time-good-06: fail, time-hard-06: pass |

### Judge dataset composition

| Category | Items | Pass / fail labels | Judge used | Origin |
|---|---|---|---|---|
| tone | 35 | 17 / 18 | quality | 4 from CALIBRATION_SET, 31 new |
| shareability | 31 | 13 / 18 | shareability | 3 from CALIBRATION_SET, 28 new |
| timing | 31 | 12 / 19 | timing | 3 from CALIBRATION_SET, 28 new |
| privacy | 37 | 16 / 21 | privacy | 2 from CALIBRATION_SET, 35 new |
| one_question | 14 | 7 / 7 | quality | 0 from CALIBRATION_SET, 14 new |
| policy | 35 | 15 / 20 | policy | 0 from CALIBRATION_SET, 35 new |

## Cost totals

| Model | Recommender | Judge | Total | Per call (avg item) | Recommender per 1,000 configs |
|---|---|---|---|---|---|
| gpt-6.1-sol | $0.18 | $0.0315 | $0.21 | $0.0004 | $0.49 |
| gpt-6-luna | $0.0158 | $0.0022 | $0.0181 | $0.0000 | $0.0440 |
| gpt-5.6-terra (Terra stand-in) | $0.29 | $0.0491 | $0.34 | $0.0006 | $0.82 |

Grand total: $0.57 (Surplus `usage.buyer_cost_micro`, summed over every HTTP request including retries; cached replays report the original cost). Spent by the invocation that rendered this report (non-cached requests only; $0 for a cache replay): $0.17.

## Methodology

- **Worlds.** Seeded synthetic populations from `packages/sim` (`generatePersonas`, deterministic, no LLM) for SF and NYC; the engine snapshot is built with the simulator's `buildSnapshot` (public side only, plus agent_private facets the model never sees). Evaluation time is day 3 so announced trips show up as temporary presence.
- **Candidates.** Pairs and groups come from (a) the engine's own candidate generation (`runEngine` run log, so many negatives are realistic hard negatives the engine itself considered), (b) public intent matching (one person's stated intent satisfied by another's stated skill/pool/interest), (c) random same-city pairs, (d) adversarial constructions, (e) hidden-risk pairs (adversarial personas, exes, a minor lying about age).
- **Labels.** `good` = oracle `compatible` (hidden-truth enjoyment above threshold for everyone, same city, no hard flags) AND no public policy violation. Per-participant accept/show/enjoyment come from the oracle (`evaluate`, seeded). Policy-unsafe items (blocked pair, anyone under 18 in any role including connector, romance without every participant opted in) are always "no". Labels are never shown to the model.
- **What the model sees.** `buildPublicView` + `recommenderMessages`: pseudonymous refs (P1..), stated age, city, participation state, stated preferences, shareable facets, matchable facets marked do-not-quote, active intents, presence (incl. trips), and explicit edges among the people (knows, invited_by, blocked). Never names, member ids, agent_private facets (boundaries, private disclosures, canaries) or hidden truth. Offline tests enforce this.
- **Output.** Structured JSON verdict: good_match, match_probability, accept_probability per attending participant, dealbreaker (+reason), and a short shareable why. Decision = good_match AND NOT dealbreaker. One retry on schema/parse failure.
- **Judge eval.** Production judges from `packages/judge` (`judgeMessageQuality`, `judgeExplanationShareability`, `judgeTiming`, `privacyAudit`, and the minors/romance policy judge `judgePolicyLLM`) are run unchanged. Models are compared on the policy rubric alone; the production policy judge (`judgePolicy` = deterministic `checkPolicy` first, rubric only when rules find no hard violation) is scored from the same responses. The 12 existing `CALIBRATION_SET` items are reused verbatim; the rest were written for this eval with gold labels, including 62 deliberately ambiguous "hard" items (borderline tone, subtle inferred privacy leaks, near-miss timing incl. time zones, implicit minors signals incl. age arithmetic and a minor connector, over-flag traps) added on 2026-10-06 because the first 121 items saturated (96-99% for every model). They were written in two batches: 42, then 20 more after the first batch still scored 97-100%; gold labels were fixed before any model saw an item, but the second batch was aimed at failure modes, so it is adversarially selected.
- **Execution.** Identical items, prompts and request settings for every model; bounded concurrency; HTTP 429/5xx retried with backoff by the core client; every response cached by request hash under `runs/evals/cache/` (gitignored).

## Caveats

- **Oracle labels encode simulator assumptions.** "Good" means good under the simulator's hand-built utility model (desire/skill complementarity, shared interests, social energy, capacity, boundaries, plus a large seeded pair-chemistry term that no one can predict from profiles). A model that reasons like a thoughtful human can still disagree with the oracle; accuracy here measures agreement with this model of the world, not with real members. Treat the comparison between models as more reliable than the absolute numbers.
- **Irreducible noise.** Roughly half of enjoyment variance is idiosyncratic chemistry by design, and acceptance is a random draw from the oracle's acceptance probability, so no system can reach 100%. Engine v1 and the trivial "always no" row bound the problem.
- **Hidden-truth limits.** Some negatives are not detectable from public data (low-honesty personas who exaggerate interests, adversarial personas, exes, a minor lying about age, travel the member has not announced). Hidden-risk items are reported separately and are not part of the 100% safety gate.
- **Romance.** The simulator snapshot does not expose gender or romance preferences, so the eval only tests the opt-in rule for romance, not romantic compatibility.
- **Coverage of opportunity kinds.** The simulator snapshot has no events or interaction history, so `event_coattend`, `second_encounter` and `network_growth` are not covered; pairs cover intro, help, member_intro (warm path via a connector) and expansion; groups cover 3-5 person groups.
- **Terra.** gpt-5.6-terra stands in for gpt-6-terra, which was unavailable; conclusions about "Terra" may not transfer to gpt-6-terra.
- **Judge gold labels** were written by the eval author (single annotator, no adjudication) and the set is small (183 items, 62 hard); per-category accuracy on 8-30 items has wide confidence intervals. The hard items are ambiguous by design, so a "miss" there is sometimes a defensible reading of the rubric rather than an error; each hard item carries a one-line rationale in `packages/evals/src/judgeDataset.ts`. A second annotator should review them before they gate anything.
- **Policy items are easy.** The 56 policy-unsafe recommender items are explicit in the prompt (stated age, a `blocked` edge, romance opt-in flags) and every model rejected all of them; the "Acc. excl. policy items" column is the better measure of matching judgment.
- **Settings.** All models used the same reasoning effort and token budget; a model might do better with its own tuned settings or prompt.
