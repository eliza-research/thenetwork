# Prompt optimization: inventory, evaluation method, GEPA, and a pilot (2026-10-07)

Scope: every LLM prompt in the repo, how each one is tested today, how to test prompt changes properly, and whether the project needs an automatic prompt optimizer (GEPA or a similar one). It ends with a small GEPA-style pilot on the pass-1 screen prompt.

> This document is hand-written. The pilot tables were produced by `prototypes/prompt-opt/src/test.ts` and pasted in. The literature facts come from a web search on 2026-10-06; the sources are linked.
>
> **State of the tree.** Another agent is rewriting the judge prompts and the eval dataset ("judge v2": soft labels, systematic selection, opt-in consistency, and a dev/test split with six fresh test worlds). Those changes are uncommitted. This document refers to **committed** code (`git show HEAD:…`) unless it says "working tree". The pilot uses only the committed dataset (`runs/evals/results/passes-gpt-6-luna.items.jsonl`, rec-v1 labels) and the committed prompt `pass1-screen-v2`.
>
> The local DSPy research tool named in `~/.claude/CLAUDE.md` (`/Users/shawwalters/shape-rotator-field-kit`, `rotate research`) is **not installed** on this machine: the folder does not exist, and `rotate` and `dspy` are not importable. The research below used plain web search instead.

## TL;DR

TLDR_PLACEHOLDER

## 1. Prompt inventory

Line numbers are at `HEAD` (commit 9219c89). "Eval today" names what measures the prompt now.

| # | Prompt | File:line (HEAD) | Purpose | Version tag | Eval today |
|---|---|---|---|---|---|
| 1 | `SCREEN_SYSTEM` (pass 1) | `packages/engine/src/judgeScreen.ts:114` (working tree: v2 at :143, v3 at :168) | First look at a candidate: yes/no, `match_probability`, `accept_probability`, `member_why` | `pass1-screen-v2` (v3 in progress) | Passes suite, 362 items, paired McNemar + bootstrap vs the baseline, ECE, per tier. Engine flag `judge.screen.enabled` is off. |
| 2 | `JUDGE_SYSTEM` (pass 2, engine rubric judge) | `packages/engine/src/judge.ts:38` | Top-K judge: six 1-5 dimensions, verdict, `why` per person | `judge-v2.1` (working tree adds `judge-v3`) | Passes suite. It is the only pass that is on in the engine. Live test `packages/engine/test/judge.live.test.ts` checks schema only. |
| 3 | `DEEP_SYSTEM` (pass 3) | `packages/engine/src/judgeDeep.ts:264` | Final review: evidence review, steelmen, 9-item rubric, `insufficient_information` + question | `pass3-deep-v2` (working tree `-v3`) | Passes suite. Off by default. |
| 4 | Shared fragments `CITATION_RULES`, `JUDGING_NOTES` | `packages/engine/src/judgeCommon.ts:105`, `:111` | Text inlined into passes 1-3 | Covered by the pass tags (a change to a fragment must bump every tag that includes it; nothing enforces this) | Indirectly |
| 5 | `RECOMMENDER_SYSTEM` | `packages/evals/src/publicView.ts:19` | The old single-pass recommender, kept as the baseline | `rec-eval-v1` | Recommender suite (model comparison) and as the baseline row of the passes suite |
| 6 | `RUBRICS.messageQuality` + JSON suffix | `packages/judge/src/llmJudges.ts:16`, `:60` | Tone/quality of outbound agent texts | none | `CALIBRATION_SET` (12 items, live test needs >= 80%), judge suite (183 items, 62 "hard") |
| 7 | `RUBRICS.shareability` | `llmJudges.ts:22`, `:67` | Does an explanation reveal a non-shareable fact | none | Same |
| 8 | `RUBRICS.timing` | `llmJudges.ts:27`, `:73` | Is a send time appropriate | none | Same |
| 9 | `RUBRICS.privacyAudit` | `llmJudges.ts:32`, `:79` | Find direct and inference leaks across outputs | none | Same |
| 10 | `POLICY_RUBRIC` | `packages/judge/src/policy.ts:87`, `:118` | Minors and romance policy after deterministic rules | none | Judge suite policy items (rubric alone and rules + rubric) |
| 11 | Persona agent: `personaCard` + reply system + situation user message | `packages/sim/src/agent/llmAgent.ts:25`, `:98`, `:105` | Words for simulated members (decisions stay deterministic) | none | `packages/sim/test/live.test.ts` (2-persona smoke). No quality metric. |
| 12 | Persona initiative rewrite | `llmAgent.ts:141` | Rephrase a scripted ask in the persona's voice | none | None |
| 13 | `enrichPersona` | `packages/sim/src/llmGenerator.ts:13` | Bio and voice sample for sim personas | none | Live test checks the bio contains the first name |
| 14 | Synthetic profile `buildPrompt` | `scripts/synthetic/generate.ts:503` | Occupation, bio, voice samples, routine, offers, intent details, boundaries for the 1,000-member synthetic set | `GENERATOR_VERSION` ("synthetic-gen 1.2.1"); the cache is keyed on a hash of the prompt | `scripts/synthetic/validate.ts`: structural, privacy and distribution checks. No check that the text is realistic or faithful. |
| 15 | Member-facing "why" | The last field of #1 (`member_why`), #2 (`why`), #3 (`member_why`) | Text a member may see | Inherits the pass tag | Deterministic `checkMemberFacing` gate (`judgeCommon.ts:80`); the passes report counts leaks and rejections. **No quality or faithfulness judge.** |

Outreach copy (invitations, reminders, check-ins) is template text today (`packages/sim/src/agent/policy.ts` `templateText`, the engine's `explain.ts`). No LLM writes it. The `messageQuality` and `timing` judges are the only quality checks that would apply to it.

### 1.1 Weaknesses and improvements, prompt by prompt

The error analysis (`docs/results/2026-10-06-luna-error-analysis.md`) gives the measured failure modes for passes 1 and 3. Category E (prompt or rubric) is 14% of pipeline errors, and B (missed evidence) is 9%. Category D (chemistry noise, 34%) and F (data bugs, 15%) are not prompt problems, and prompt work must not try to fit them.

**Pass 1 (`pass1-screen-v2`).**
- *Wrong target.* The prompt asks "would plausibly accept". The label measures enjoyment if they meet. `match_probability` is defined as "genuinely good, mutually wanted". Make the verdict and the probability measure the label's quantity: "every attending person would enjoy and benefit". Keep `accept_probability` as a separate output that does not decide the verdict. The working-tree v3 does this.
- *Prior baked in.* "Most candidates are NOT good" pushes toward "no". The right prior depends on where pass 1 sits: in the engine it sees the deterministic top-K, which has a higher base rate than the eval mix. Calibration instructions should not state a base rate that depends on the pipeline. Use a neutral line ("protect members' attention; do not withhold an intro that clearly serves both sides"), and calibrate the threshold in code (see 2.4).
- *Missing rules that the error analysis measured.* A shared stated intent is enough; each person's gain must map to their own intent; judge groups as a whole; unknown schedules are normal; never anchor on one inferred fact. These belong in a short "Judging notes" block.
- *Few-shot exemplars.* There are none. Two or three short contrastive exemplars from the error analysis would anchor the two most common E/B patterns. Use them as compact paired cases, not full JSON inputs: (a) both state "make a few new friends", no shared hobby: yes (nyc-2:p009, base rate 65% good); (b) a shared cooking interest, but neither person's intent mentions it: no (sf-2:p046). Exemplars must come from dev worlds only, and must be re-paraphrased so they are not verbatim eval items.
- *Rubric anchoring.* Pass 1 has none. A one-line anchor for `match_probability` helps calibration: "0.8 = both state a matching live intent and nothing argues against; 0.5 = a plausible but one-sided or vague fit; 0.2 = only a shared interest, no matching intent".
- *Output schema.* The order is right (explanation first). `cited_facts` (max 6) and `accept_probability` are rarely used downstream, but each costs output tokens. In the engine, drop `cited_facts` from pass 1 or cap it at 3. Keep `member_why` only when pass 1 is the last pass.
- *Context ordering and cost.* The system prompt is about 650 tokens of the roughly 1,200 input tokens per call. It is static, so put it first (already done), which lets provider prefix caching apply. Output dominates cost: about 1,030 completion tokens per call, of which about 640 are reasoning. `reasoning_effort` is the main cost lever. Measure `low` against `medium` on the dev split before shipping pass 1 to every candidate.
- *Eval-prod skew.* Evals use `max_completion_tokens` 4000. The engine uses 2500 (`packages/engine/src/config.ts:136-138`). A prompt that makes luna think longer can be truncated in production and not in evals. Evaluate with the production setting.

**Pass 2 (`judge-v2.1`).**
- Its input is the thinnest (no ages, presence, edges, opt-ins; only 6 do-not-quote facts), so it has AUC 0.52. That is an input problem, not a wording problem. No prompt edit fixes it. Either give it pass 3's context (the working tree adds `pass2Context: "deep"`) or drop it.
- The `red_flags` dimension has the opposite polarity (1 = none, 5 = serious) to every other dimension (5 = good). The code handles it correctly (`scoring.ts:149` treats it as risk), but mixed polarity in one rubric invites the model to mis-score it. Make every dimension "higher is better", as pass 3 does.
- `temperature: 0.2` is passed in `judge.ts:133`, but `OpenAILLM` never sends temperature. The setting is dead and misleading.
- Its JSON demands six integers plus `certainty` plus `match_probability`: three confidence-like outputs. Keep one.

**Pass 3 (`pass3-deep-v2`).**
- `risk_safety: 1` includes "a violated boundary", and "yes" requires nothing at 1. So a soft private boundary acts as a veto (error analysis example nyc-2:p013). Limit 1 to explicit prohibitions, and score format boundaries under `values_energy`.
- "Before claiming someone has no intent, re-read their intents list" (nyc-1:p010).
- The abstention rule ("never for format") is violated in 12 of 32 abstentions. Enforce it in code (reject a format question), not only in the prompt.
- It is the most expensive pass ($0.275 per 1,000 configurations, about 3,200 input tokens). Its output order has five long free-text fields before the verdict. Test a shorter variant: cap `evidence_review` and the steelmen at about 2 sentences each and measure the cost and quality trade-off.
- Its calibration sentence ("of the ones you give 0.7, about 7 in 10 should go well") is good. Copy it to passes 1 and 2.

**`rec-eval-v1`.** It is frozen as a baseline. Do not edit it. Keep it byte-identical so old cache entries stay valid.

**Shared fragments.** `JUDGING_NOTES` and `CITATION_RULES` are inlined into several prompts. Today a fragment edit silently changes three prompts without a tag bump. Compute each prompt's version as its human tag plus a short hash of its final text (see 2.1), so that a fragment edit always shows as a new version.

**`packages/judge` rubrics (tone, shareability, timing, privacy, policy).**
- *Verdict before explanation.* Their JSON schemas put `score`/`pass`/`shareable`/`compliant` first and `reasoning` last ("one sentence"). That breaks the repo rule "judge prompts write the explanation before the verdict" (AGENTS.md). Reorder to `{"reasoning", …, "verdict"}`, and check key order the way the passes do (`keyOrderOk`).
- *No version tags.* Add them.
- *Saturated eval.* The judge suite scores 97.8-98.9% for every model, so it cannot detect a prompt regression or improvement. It needs harder, real-distribution items: actual `member_why` outputs from the passes runs, labelled for leaks and quality (see 2.6).
- *`messageQuality` mixes two decisions.* `pass` is recomputed in code as `score >= 4`, so the model's own `pass` is ignored. Drop it from the schema.
- *Privacy audit* returns only leaks. Ask for a per-message verdict too, so a per-item false-negative rate can be computed.
- *Policy.* The design is right (rules first, the LLM only for implicit signals). Add few-shot negatives for adults who work with teens, which is the known over-flag trap.

**Persona agent (`llmAgent.ts`).**
- The persona card contains hidden truth by design, but the reply prompt has no test of fidelity: does the text match the deterministic decision, does it stay in style, does it leak the canary only when told? Add an offline judge-of-judge check (2.6) on a sample of sim transcripts.
- The JSON asks for `decision` even when `llmDecides` is false, so output tokens are wasted. Drop the field in that mode.
- `temperature: 0.8` has no effect with the default Surplus/OpenAI client (`OpenAILLM` never sends temperature). Persona diversity therefore comes only from the card. Use `reasoning_effort: "minimal"` or `"low"` for persona text. It is cheap texture, not judgment.

**Synthetic profile prompt (`generate.ts:503`).**
- It is versioned only through `GENERATOR_VERSION` and a prompt-hash cache, which is good. Its weakness is evaluation: `validate.ts` checks structure and privacy, not whether `intentDetails` and `boundaries` faithfully restate the hidden wants in order. A cheap judge-of-judge pass on 50 members (2.6) would catch drift. That matters because the richness-tier views and the error analysis depend on these texts.
- The analysis found a data bug next to this prompt (the dating desire without the romance opt-in). It is fixed in `generator.ts`, not the prompt, but the prompt still says "Wants (in order)" without the opt-in, so the LLM text can still describe dating for opted-out people. Pass the opt-in into the prompt.

**`enrichPersona` (`llmGenerator.ts:13`).** It overlaps with #14 (two prompts writing bios for the same kind of persona). Merge them into one prompt and one validation path, or delete the older one if only the sim CLI uses it.

## 2. How to test prompt changes

### 2.1 What exists today and what is missing

| Need | Exists | Missing |
|---|---|---|
| Versioned prompts | Human tags on passes 1-3 and rec-eval-v1; the cache key is the exact request body, so any text change is a new key | Tags on `packages/judge` and sim prompts. A content hash next to each tag. A record of tag + hash in every result file. A check that a changed prompt changed its tag. |
| Fixed splits | Working tree only: `V2_DEV_WORLDS` (the 4 analysed worlds) and `V2_TEST_WORLDS` (sf-3..5, nyc-3..5) in `packages/evals/src/worlds.ts` | A third **holdout** split with fresh seeds, drawn per release and never read. A written rule for who may look at test items. |
| Paired comparison | `mcnemar`, `pairedBootstrap`, `precisionOn`, `f1On` in `packages/evals/src/metrics.ts`; used against the baseline in `passScore.ts` | Bootstrap on soft metrics. Comparing two arbitrary arms (not only vs the baseline). Correction for many comparisons (Holm) when several arms are tested. |
| Soft labels | Working tree: `truth.pGood` by Monte Carlo over oracle seeds (`recDataset.ts` version 2) | Brier and log-loss against `pGood`, and "expected accuracy" (accuracy averaged over chemistry draws). The pilot has these (`prototypes/prompt-opt/src/evaluate.ts`, `test.ts`). |
| Per-tier and per-slice reports | `passScore.ts` tier and proxy-bucket tables | Regression **gates**: per-slice thresholds with a minimum n, checked automatically. |
| Cost and latency | Per-row cost, tokens, p50/p95 latency in the passes report | A budget per prompt (cost per 1,000 configurations, p95 latency) that fails a run. |
| Run-to-run noise | None. Every row is one sample. | A re-run arm (same prompt, a new cache key) so that "the difference" can be compared with "the noise". The pilot measures it (section 4). |
| Judge-of-judge for member-facing text | Only the deterministic leak gate | A different-model LLM judge for faithfulness, warmth and leak-by-inference on `member_why`, calibrated on a small human-labelled set. |
| CI | Offline unit tests; live tests need keys and only check schemas; `--offline` cache replay exists in the CLI | A CI job that replays the cached eval for every prompt that did not change (free), fails if replay differs, and runs a live canary set only for prompts whose hash changed. |
| Oracle overfitting guard | The error analysis (by hand) | A list of known oracle quirks, a "quirk slice" report, and a rule that prompts may not mention oracle internals. |

### 2.2 Versioned prompts

- Keep every prompt as a named constant with a human tag (`pass1-screen-v3`) **and** a computed `sha256(finalText).slice(0, 8)`. Write both into every result file, cache manifest and report header.
- Keep the previous version in code while it is the comparison baseline (the working tree does this with `SCREEN_PROMPTS = { v2, v3 }`). Delete it after the new version ships.
- A unit test fails when a prompt's hash changes and its tag does not. That is one small test per prompt registry. It is the one test worth adding.
- A prompt version includes its request settings (`reasoning_effort`, `max_completion_tokens`) and its input-view version (pass 1's v3 view adds evidence tags; the same system text on a different view is a different system).

### 2.3 Splits

- **Dev**: the four analysed worlds (sf-1, sf-2, nyc-1, nyc-2). Anything may be read and tuned here.
- **Test**: six fresh worlds (sf-3..5, nyc-3..5), as in the working tree. Run each candidate that reaches "ready to ship" on test **once**, and report it whatever the result. If test is used to choose between more than two or three finalists, it has become dev. Record each test read in the results file.
- **Holdout**: new oracle and generator seeds drawn at release time (for example `seed = 300 + release number`), and built only by the release job. This protects against slow leakage of the test worlds through many "one-time" reads and through the error analysis (which read the dev worlds and informed v3).
- Split by **world**, never by item. Items in one world share personas, so an item-level split leaks people between dev and test.
- Size: with about 90 items per world, a 6-world test gives about 540 items. At that n, a paired McNemar test detects about a 4-5 pp accuracy difference when the arms disagree on about 15% of items. Smaller effects need the holdout added or more worlds. Worlds are cheap to build (no LLM calls).

### 2.4 Metrics and statistics

- **Primary: expected accuracy against the soft label** (yes scores `pGood`, no scores `1 - pGood`) and **Brier and log-loss against `pGood`**. They average out the chemistry draw, so a prompt is not rewarded for agreeing with one lucky draw. Keep accuracy, precision and recall against the drawn label as secondary, for continuity with earlier reports.
- **Paired tests.** Every comparison runs both arms on the same items. Report (a) exact McNemar on per-item correctness (drawn and systematic label), and (b) a paired bootstrap (2,000 resamples, world-clustered when there are 6+ worlds) for expected accuracy, precision, Brier and F1 differences, with the 95% interval. Holm-correct when more than one candidate is compared against the incumbent.
- **Noise floor.** Also run the incumbent a second time with a new cache key. A difference smaller than the incumbent-vs-itself difference is not a finding.
- **Decision threshold.** Pick the yes-threshold on `match_probability` in code on dev, rather than in the prompt. Then precision-at-recall targets are code settings, not prompt edits.
- **Calibration.** ECE and a reliability table against the drawn label. Brier against `pGood` is the proper score.
- **Abstention.** For pass 3, score `insufficient_information` separately (coverage, precision on answered items, and how often the question is about intent, which is the behaviour we want).

### 2.5 Gates (a prompt change ships only if all hold on test)

- Expected accuracy (soft) does not drop: the lower bound of the 95% bootstrap interval of (new - incumbent) is above -1 pp. A precision-oriented pass also needs precision's lower bound above -1 pp.
- No tier with n >= 30 loses more than 5 pp of expected accuracy. Smaller tiers are shown but do not gate.
- Pairs and groups gated separately (groups are 17% of items and fail differently).
- Hard-safety slices: policy-unsafe rejected stays 100% after the hard gate; canary leaks, sensitive-fact leaks and minor contacts stay 0 (AGENTS.md invariants).
- Member-facing text: leak-gate rejection rate does not rise by more than 5 pp (a higher rejection rate means more template fallbacks).
- Explanation-first rate stays at 100% (`keyOrderOk`).
- Budgets per pass: cost per 1,000 configurations no more than +25% over the incumbent unless the gain is significant; p95 latency under 40 s for pass 1 and under 60 s for pass 3; parse failures under 1%.

### 2.6 Judge-of-judge for member-facing text

- Sample about 150 `member_why` texts that passed the leak gate from the passes runs, plus 50 that it rejected.
- Use a **different model** from the writer (AGENTS.md: "Do not use the same model to audit its own recommendations"), for example gpt-6.1-sol, with an explanation-first rubric: faithfulness to the shareable facts, no inference leak, warmth and specificity (1-5 each), and an overall pass.
- Calibrate that judge on about 40 human-labelled texts (the founders or reviewers). Require at least 80% agreement and report kappa, as `CALIBRATION_SET` does. Grow the set from reviewer decisions, as PRD 34.1 says.
- Use the same pattern for persona replies (fidelity to the deterministic decision and style) and for synthetic profile text (faithful restatement of wants and boundaries).

### 2.7 CI integration

- **Offline replay on every PR (free).** `bun run packages/evals/src/cli.ts --suite passes --offline` replays every cached response. If no prompt hash changed, replay must reproduce the committed summary exactly. That catches scorer and dataset regressions. If a prompt hash changed, the offline run fails fast with cache misses, which is the signal to run live.
- **Live canary (small, on prompt-hash change).** About 60 fixed dev items stratified by tier, pair/group and label (cost about $0.01 for pass 1 at the current price), plus the 12-item judge calibration set. It checks the schema, explanation-first and gross regressions only. It cannot prove an improvement.
- **Full test run (manual, before a prompt ships).** The full test split with the gates above, written to `docs/results/`.
- Cache the canary responses under `runs/evals/cache/` as today, so a re-run of the same PR is free.

### 2.8 Guarding against overfitting to the oracle

- The oracle is a hand-built utility function with known quirks: it ignores schedules and opt-ins, checks presence at one instant, gives "dating" zero value without the hidden opt-in, and scores "good" as enjoyment, not acceptance. A prompt tuned on its labels can learn those quirks (for example, "ignore travel" would raise accuracy here and be wrong for members).
- Rules:
  - Prompts may describe the product's intent ("enjoy and benefit"), never oracle internals (weights, thresholds, the chemistry term).
  - Report a **quirk slice**: items whose label is decided by a known quirk (point-in-time presence, gate/oracle opt-in mismatch). A change that gains mainly on that slice is suspect.
  - Fix data and label bugs in the simulator, not in the prompt.
  - Hand-review every automatically proposed rule before it ships (section 3): can a human reviewer defend it to a member?
  - Validate the final choice on a second label source when one exists: reviewer decisions from MVP review (PRD 28) and member feedback. Until then the oracle is the only label, and the absolute numbers mean little. Only paired differences count.

## 3. Do we need GEPA or something like it?

### 3.1 The methods (facts checked on 2026-10-06)

| Method | Core idea | Data and budget reported | Implementations | Fit notes |
|---|---|---|---|---|
| **GEPA** (Agrawal et al., [arXiv 2507.19457](https://arxiv.org/abs/2507.19457), ICLR 2026 oral) | Keep a pool of prompts. Pick a parent from the **Pareto front of per-instance scores** (any prompt that is best on some validation item can be chosen, in proportion to how many it wins). Run it on a minibatch, let an LLM **reflect on the traces plus textual feedback**, and rewrite the instruction. Keep the child only if it beats the parent on that minibatch, then score it on the full validation set. Optional "merge" of lineages. | Train/val of 150/300 (HotpotQA, HoVer, IFBench) and 111/111 (PUPA). Budgets matched to MIPROv2: 2,270-6,926 rollouts, most of them spent on validation. Aggregate test score with GPT-4.1-mini: 52.7 baseline, 59.7 MIPROv2, 67.0 GEPA, 68.7 with merge. Prompts up to 9.2x shorter than MIPROv2's. Merge sometimes hurts (Qwen3-8B IFBench 38.6 to 28.2). | Python `gepa` (MIT, [gepa-ai/gepa](https://github.com/gepa-ai/gepa)), incl. `optimize_anything` and a `ConfidenceAdapter` for classifiers with probabilities. `dspy.GEPA` ([docs](https://dspy.ai/current/api/optimizers/GEPA/overview/)): `auto="light"/"medium"/"heavy"` or `max_metric_calls`, a required `reflection_lm`, `reflection_minibatch_size=3` default, a metric that returns `dspy.Prediction(score=…, feedback=…)`. TypeScript: `AxGEPA` in [`@ax-llm/ax`](https://axllm.dev/typescript/skills/ax-gepa/) (Apache-2.0; per its docs the metric is numeric, without a feedback string; not verified in source). Small ports (`gepa-ts`, archived 2026-04). | The best fit of the family: instruction-only, sample-efficient, readable output. Its strength (textual feedback) needs per-item explanations and a reason for the label, which we have (explanation-first outputs, plus the error-analysis decomposition). |
| **MIPROv2** (Opsahl-Ong et al., [arXiv 2406.11695](https://arxiv.org/abs/2406.11695)) | Bootstrap few-shot demos, propose instructions from a data summary, then search instruction x demo combinations with Bayesian optimization (TPE) on minibatches. | Up to +13% on 5 of 7 programs (Llama-3-8B). The DSPy docs give no data-size guidance. | DSPy (Python) | Its demos are model-written traces. With noisy labels, bootstrapped demos are selected because they matched a noisy label, which is a direct path to overfitting. Prompts get long (demos), so cost per call rises for every judged candidate. |
| **TextGrad** (Yuksekgonul et al., [arXiv 2406.07496](https://arxiv.org/abs/2406.07496), Nature 2025) | "Backpropagate" LLM-written critiques through a graph of LLM calls. | GPQA 51% to 55% (zero-shot GPT-4o, test-time). | `textgrad` (Python) | General but heavier. Per-step textual gradients without a population and Pareto front are greedy, so one noisy batch can push the prompt the wrong way. |
| **OPRO** ([arXiv 2309.03409](https://arxiv.org/abs/2309.03409)) | Show the optimizer LLM past prompts with their scores; ask for a better one. | Up to +8% GSM8K, up to +50% BBH vs human prompts. | Reference code | Uses only scalar scores, so it ignores our richest signal (the judge's own explanation of why it said no). Many full evaluations. |
| **APE** ([arXiv 2211.01910](https://arxiv.org/abs/2211.01910)), **ProTeGi/APO** ([arXiv 2305.03495](https://arxiv.org/abs/2305.03495)) | APE: generate many instructions, score, select. ProTeGi: minibatch error critiques as "gradients", edit, beam search with bandit selection. | APE: human-level on 19/24 tasks. ProTeGi: up to +31% over the start prompt. | Reference code | ProTeGi is essentially GEPA without the Pareto pool. A recent study applying ProTeGi against an LLM judge found "judge-specific overfitting" and case memorization, reduced by a larger validation set ([arXiv 2604.20726](https://arxiv.org/html/2604.20726)). |
| **Manual iteration** | A person reads errors and edits the prompt (what produced v2 and v3 here). | One revision cycle, about 2 hours of analysis. The v1 to v2 change for passes 2-3 was large (pass 3 recall 26% to 76%). | None needed | Best when error causes are few and nameable. It is the method that found the label and data bugs, which no prompt optimizer would have found: an optimizer would have fitted them. |

Other evidence on overfitting: larger candidate populations widened the validation-to-test gap from 0.08 to 0.22 in GAAPO ([arXiv 2504.07157](https://arxiv.org/html/2504.07157v1)), and long prompts full of narrow rules generalize worse ([arXiv 2606.11045](https://arxiv.org/html/2606.11045)). I found no study of GEPA or MIPROv2 under label noise. GEPA's paper reports smaller generalization gaps for instruction-only prompts than for few-shot methods (its Appendix D).

### 3.2 Fit for this project

- **Dataset size.** About 180 dev items (and about 540 test items once the v2 test worlds are built). That is the size GEPA was shown on, but our labels are much noisier than HotpotQA's. With 70 validation items, the standard error of expected accuracy is about 0.05, so the optimizer cannot tell apart two prompts that differ by 3-5 pp. More worlds are free to build, so the validation set can be made larger. That is the cheapest overfitting control.
- **Noisy oracle labels.** 18% of drawn labels are decided by chemistry, and only 81.5% of drawn labels agree with the systematic label (pilot data). An optimizer scored on drawn labels will chase noise. Score on the soft label (`pGood`) and tell the reflector which items are near a coin flip. The pilot does both.
- **Multi-pass pipeline.** GEPA optimizes modules of a compound system, but the credit-assignment problem is real here: pass 3 only sees pass-1 survivors, and the pipeline's precision depends on both. Optimize one pass at a time, with the other passes frozen, and evaluate the pipeline only at the end. Pass 2's problem is its input, which no prompt optimizer fixes.
- **TypeScript stack.** Options:
  1. *Bridge to Python* (`dspy.GEPA` or `gepa.optimize_anything`): call the pass prompt through DSPy's `dspy.LM("openai/gpt-6-luna", api_base=SURPLUS_BASE_URL, …)` (OpenAI-compatible base URLs are supported) or through a small HTTP shim that runs our TypeScript evaluator. Pros: the maintained, full algorithm (merge, adapters). Cons: a second language and toolchain; our view builders, parsers, leak gate and scorers live in TypeScript, so the metric must call back into TS or be ported; DSPy's reasoning-model handling and `reasoning_effort` passthrough via LiteLLM were not verified.
  2. *A small TS GEPA-lite* (about 300 lines, `prototypes/prompt-opt/`): reuses `defaultLLM()`, the eval cache, the exact pass inputs and the stats in `packages/evals/src/metrics.ts`. Pros: no new language, every number comparable with the passes report. Cons: no merge, no adapters, our own maintenance.
  3. *Ax* (`@ax-llm/ax`): a pure-TS GEPA, but it brings its own signature/program abstraction and (per its docs) no textual feedback, which removes GEPA's main advantage. A new dependency would also need a justification under AGENTS.md.

  Recommendation: option 2 if and when we optimize. It is small, and option 1's extra power (merge, multi-module) does not matter for single-pass judge prompts.
- **Cost per optimization run with luna.** A pass-1 call costs about $0.00013 and takes 9 s at p50 (passes report). The pilot's measured numbers are in section 4. A full run with a 70-item validation set and 16 iterations is about 1,000-1,500 judge calls plus 16 reflection calls: **well under $1** of tokens. The real cost is wall-clock time (about 1-2 hours at concurrency 16 because luna reasons for about 9-40 s per call) and human review time. Pass 3 is about 2x the cost per call; still cheap.
- **Overfitting risk.** High, for three reasons: noisy labels, a small validation set that is reused at every iteration, and an oracle with learnable quirks. The pilot shows the minibatch acceptance rule letting through children that are worse on validation (section 4).
- **Interpretability.** GEPA's output is a readable prompt, and the reflector writes a diagnosis for each child. That is much better than MIPROv2's demo sets. Every proposed rule can be reviewed by a person, and every rule should be (2.8).

### 3.3 Recommendation

**Not now.** Do not adopt GEPA (or MIPROv2, TextGrad, OPRO) for the judge prompts yet. Keep manual, error-analysis-driven iteration, but run it inside the evaluation method of section 2. Reasons:

1. The largest error buckets are labels and data (D 34%, F 15%) and missing information (A 28%). Prompt optimization cannot fix them and would fit them. The prompt bucket (E 14%, B 9%) is small, its causes are already named, and the working-tree v3 prompts address them directly.
2. On the current labels, the measurable headroom is a few points, close to the noise of a 70-180-item validation set (section 4 measures the run-to-run noise).
3. Manual iteration found the real bugs. An optimizer would have hidden them.

**When it becomes worth it** (any two of these):
- Labels from a second source exist (reviewer decisions from MVP review, member feedback), or the v2 soft labels are in place, so the target is not a single noisy draw.
- The dev pool is at least about 500 items (about 6 worlds) and the test and holdout splits of section 2.3 exist, so selection noise is below the effects we care about (about 3 pp).
- The manual loop stalls: two consecutive hand revisions without a significant paired gain on test, while the error analysis still shows prompt-type errors (B/E) above about 10% of errors.
- Many prompts need routine tuning at the same time, for example a model change (luna to another model) that requires re-tuning every pass and judge. That is GEPA's best use case: cheap, repeatable re-fitting of known-good prompts to a new model.
- The member-facing text judges (2.6) exist. GEPA is a good fit for **writer** prompts (`member_why`, outreach copy), whose metric is a calibrated judge score with written feedback and no chemistry noise.

When it is adopted: use the TS GEPA-lite with the soft-label score, a validation set of at least 150 items from at least 3 worlds, a prompt-length cap, frozen output contract and policy lines, human review of every accepted rule, and one final test read per run.

## 4. Pilot: GEPA-lite in TypeScript on pass 1

PILOT_PLACEHOLDER

## 5. Top recommendations

RECS_PLACEHOLDER
