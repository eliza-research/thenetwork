# Results summary

This is the one-page index of results that have been folded out of the repository. Each section keeps the headline numbers and the decision. The full original documents are in git history at commit `16cde70`. Read one with `git show 16cde70:<path>`, for example `git show 16cde70:docs/results/2026-10-06-judge-passes.md`.

Original paths folded here:

- `docs/results/2026-10-06-engine-v1-vs-random.md`
- `docs/results/2026-10-06-liveness-complementarity.md`
- `docs/results/2026-10-06-model-comparison.md`
- `docs/results/2026-10-06-judge-passes.md`
- `docs/results/2026-10-06-luna-error-analysis.md`
- `docs/results/2026-10-06-poc-validation.md`
- `docs/results/2026-10-07-stub-baseline-history.md`
- `docs/results/2026-10-07-network-send-defaults.md`
- `docs/results/2026-10-08-network-capital-plans.md`
- `docs/research/2026-10-07-prompt-optimization.md`
- `docs/research/2026-10-07-match-failures-and-diversity.md`
- `prototypes/<name>/RESULTS.md` (8 files; see "Prototypes")

The latest per-topic reports stay in `docs/results/`:

- [2026-10-07-engine-v1.2.md](2026-10-07-engine-v1.2.md)
- [2026-10-07-judge-v2.md](2026-10-07-judge-v2.md)
- [2026-10-07-network-consent.md](2026-10-07-network-consent.md)
- [2026-10-08-network-hardening.md](2026-10-08-network-hardening.md)
- [2026-10-08-network-capital.md](2026-10-08-network-capital.md)
- [2026-10-08-app-packs-core.md](2026-10-08-app-packs-core.md)
- [2026-10-07-attention-budget.md](2026-10-07-attention-budget.md)
- [2026-10-08-plans.md](2026-10-08-plans.md)
- [2026-10-08-slop-world.md](2026-10-08-slop-world.md)
- [2026-10-08-slop-pack.md](2026-10-08-slop-pack.md)
- [2026-10-08-peon-pack.md](2026-10-08-peon-pack.md)
- [2026-10-08-friends-pack.md](2026-10-08-friends-pack.md)

**How to validate today.** Validation is now `bun run sim` (`scripts/sim.ts`). The commands quoted in the old documents (`bun run packages/evals/src/cli.ts ...`, `bun packages/engine/experiments/*.ts`, `bun run prototypes/...`, the old sim CLI flags) ran code that has since been deleted (`packages/evals`, `packages/engine/experiments`, `prototypes`). They do not run on this tree. The numbers below are historical: they describe the code at the time, not the current tree.

## Engine v1 vs random (2026-10-06)

Setup: 150 synthetic SF/NYC personas, 30 simulated days, discrete time, policy personas (no LLM), seeds 1-3, stub network.

- First run: engine v1 precision vs oracle 32.0% / 34.7% / 32.0% against 8.2% / 6.8% / 6.0% for random intros. Persona-judged worthwhile 49.8-54.3% against 16.8-20.1%. Canary leaks 0. Seed 1: pair recall 11.1% of 479 latent good pairs, 13.5% of members got no proposal.
- With the minors policy (8 of 150 members aged 13-17, never connected): engine precision 32.3-38.6%, random 5.2-8.6%. `minorContacts` 0 in all runs. Matching quality unchanged within seed noise. A warm-path bug (intros routed through a minor as the intermediary) was found and fixed.
- Engine v1.1.0 (all four fixes below), means over 3 seeds: precision 38.9% vs 7.7% random (5.1x, up from 4.1x), worthwhile 58.6% vs 17.1%. Members with no proposal rose from 8.0% to 18.8%.
- Still below the PRD 28.2 target (worthwhile 70% or more).

Superseded by [2026-10-07-engine-v1.2.md](2026-10-07-engine-v1.2.md).

## Intent liveness, complementarity and two label fixes (2026-10-06)

Four fixes, measured alone and together: (1) intents anchored to `now` with re-confirmation and lapse, (2) a structured needs-to-offers complementarity term in engine scoring (weight 0.5), (3) a dating desire implies the romance opt-in, (4) the oracle checks presence over the proposal window.

- Complementarity is the big lever. 30-day sim: precision 30.1% to 38.0%, worthwhile 48.4% to 56.8%. Synthetic snapshot: precision 20.5% to 32.8%. Cost: members with no proposal 8% to 19-20%.
- Liveness matters where intents age. 90-day sim: adults with no live intent at day 90 went from 426/426 (100%) to 7/426 (1.6%); proposals 646 to 902. Synthetic snapshot: adults with no live intent 252/450 to 144/450.
- The dating fix lifts both arms slightly (engine precision 30.1% to 32.4%). The presence fix is a no-op in the 30-day sim.
- All four: 30-day sim precision 38.9%, worthwhile 58.6%, pair recall 15.9%; synthetic precision 34.6% (from 20.5%).
- Weight sweep: 0.5 chosen as default; 0.35 gives up about 1 point of sim precision and cuts the no-proposal share from 19% to 14%. The `need` retrieval channel is off by default (neutral in the sim).
- Decision: shipped as `engine-v1.1.0`.

Superseded by [2026-10-07-engine-v1.2.md](2026-10-07-engine-v1.2.md).

## Model comparison: recommender and judge (2026-10-06)

Models: gpt-6.1-sol, gpt-6-luna, gpt-5.6-terra (stand-in for gpt-6-terra, which was unavailable), all on Surplus with identical settings.

| Model | Recommender correct (n=360) | Judge agreement (n=183) | Cost (both suites) |
|---|---|---|---|
| gpt-6.1-sol | 69.4% | 98.4% | $0.21 |
| gpt-6-luna | 67.8% | 97.8% | $0.0181 |
| gpt-5.6-terra | 67.2% | 98.9% | $0.34 |

- References: engine v1 63.1%, always-no 60.0%. Deterministic judge rules 75.5% on the 106 items they can decide.
- The three models are statistically tied (exact McNemar p >= 0.05) on both suites. Every model rejected 56/56 policy-unsafe items with 0 canary or sensitive-fact leaks.
- The judge suite is saturated: models differ by at most 2 of 183 items.
- Decision (2026-10-05): gpt-6-luna for all uses (judge, recommender, synthetic data, default LLM). Ties were broken on F1, privacy false negatives (luna 0.0%) and cost.

Superseded in part by [2026-10-07-judge-v2.md](2026-10-07-judge-v2.md) for the judge pipeline. The model decision stands.

## Judgment passes 1-3 (2026-10-06)

Model: gpt-6-luna. 362 recommender items with profile richness tiers. Pass 1 = explanation-first screen; pass 2 = engine rubric judge; pass 3 = new deep review with an "insufficient information" option.

| Row | Accuracy | Precision | Recall | ECE |
|---|---|---|---|---|
| Previous single pass | 66.0% | 55.4% | 75.0% | 0.140 |
| Pass 1 | 68.5% | 58.5% | 71.5% | 0.073 |
| Pass 2 + hard gate | 58.0% | 47.4% | 51.4% | 0.152 |
| Gate > pass 1 > pass 3 | 69.6% | 62.0% | 61.1% | 0.065 |
| Gate > pass 1 > pass 2 > pass 3 | 65.5% | 60.7% | 37.5% | 0.111 |

- Pass 1 is a small, not significant gain (+2.5 pp, p = 0.28) with clearly better calibration.
- Gate > 1 > 3 is the only configuration with a significant precision gain (+6.6 pp, 95% CI +1.4 to +11.8, p = 0.009).
- Pass 2 is the weak link (AUC 0.52 alone): its input is too thin. Chaining it cuts recall to 37.5%.
- Hard filters always win: 56/56 policy-unsafe items rejected on every gated row. 0 canary or sensitive-fact leaks in member-facing text after the gate.
- Spend about $0.42.
- Decision: pass 1 as the first look, pass 3 on survivors when precision matters. Passes 1 and 3 ship disabled by default until checked against reviewer labels.

Superseded by [2026-10-07-judge-v2.md](2026-10-07-judge-v2.md).

## Luna error analysis (2026-10-06)

No model calls; per-item records read against simulator hidden truth. Scope: gate > 1 > 3 (110 wrong of 362) and pass 1 (114 wrong).

- Pipeline error causes: chemistry noise (D) 34%, information gap (A) 28%, data or pipeline bugs (F) 15%, prompt or rubric (E) 14%, missed evidence (B) 9%, bad source facts (C) 0.
- 57 of 144 "good" items were good only because of a lucky chemistry draw. Even an omniscient judge tops out at 81.8% (80.4% behind the gate).
- Ceiling estimates: 70.4% with the oracle formula on what the Network sees today; 78.2% on a fully onboarded profile; 73-74% expected with prompt fixes; about 77% with onboarding fixes as well.
- Bugs found: the generator gave a dating desire to hidden romance opt-outs (264 of 505 dating adults); the hard gate and the oracle disagreed on category opt-ins (9 false negatives); the oracle checked presence only at the window start.
- Decision: fix labels and data first (soft labels, systematic selection), then prompts, then onboarding questions (desire strength, the specific want behind a vague one, all intents, dating preferences, group comfort).

Superseded by [2026-10-07-judge-v2.md](2026-10-07-judge-v2.md), which implemented the label fixes and found the prompt fixes did not survive the held-out test split.

## Prompt optimization and GEPA pilot (2026-10-07)

- Inventory: 15 LLM prompts. Only the three judgment passes and the old recommender baseline had version tags and a discriminating eval.
- GEPA recommendation: not now. Most errors are labels, data and missing information, which an optimizer would fit, not fix. Revisit when there are better labels, at least about 500 dev items, a stalled manual loop, a model change, or member-facing writer prompts with a calibrated judge.
- Pilot (GEPA-lite on pass 1, $0.12 of luna): the best child improved soft-label expected accuracy on test by +0.077 (95% CI +0.028 to +0.128), but only by saying "yes" on 30% of items instead of 54%. AUC fell from 0.802 to 0.766, and it stayed below always-no (0.712) on the same metric.
- Run-to-run noise: re-running the same prompt flipped about 1 in 5 verdicts (-5.0 pp accuracy, not significant).
- Decision: score judge prompts with threshold-free, class-balanced metrics (soft Brier or log-loss, AUC), set the yes-threshold in code, always add a noise arm, and grow the eval rather than the prompt.

Superseded by [2026-10-07-judge-v2.md](2026-10-07-judge-v2.md) for the label and prompt results.

## Match failures and diversity (2026-10-07)

Offline engine, simulator and oracle analysis on `engine-v1.1.0`. No LLM calls.

- The biggest losses are after selection: only 12.6% of proposals end with everyone accepting, 8.6% meet, 5.8% meet with both enjoying it. 28% of selected proposals were never sent but still counted against members' budgets.
- Before selection, interruption budgets are the biggest loss: 53% of oracle-good pairs are never generated.
- Five of 11 generators never fired in the simulator. A category bug skipped personal-growth wants.
- The 38.9% baseline precision was inflated by re-asking declined pairs. With history fed, the realistic baseline over 8 seeds is precision 39.1%, worthwhile 58.7%, recall 19.9%, no proposal 19.6%, met + worthwhile 14.3 per seed.
- Best combinations (8 seeds): COMBO D met + worthwhile 19.6 per seed (+37%); COMBO F 22.0 (+54%), recall 26.0%, no proposal 4.0%, at a cost of 2.5 points of precision.
- Diversity is limited by structure, not ranking: re-rankers barely move the Gini (+-0.01); events and theme groups cut the no-proposal share from 19.6% to 5.7% / 14.6%.
- Decision: eight ranked recommendations (dispatch-aware budgets, feed history, route growth wants, events and theme groups, per-category thresholds, an acceptance model, ask before proposing to low-data members, budget 3 per week).

Superseded by [2026-10-07-engine-v1.2.md](2026-10-07-engine-v1.2.md), which measured these recommendations and turned the winners on by default.

## StubNetwork baseline with history (2026-10-07)

The sim snapshot now carries the Network's own records (interactions, feedback, open opportunities, unsent proposals).

- 30 days, 3 seeds pooled: meetings held 96 to 114 (+19%), invites +17%. Precision 40.6% to 37.5% (p = 0.15) and worthwhile 58.6% to 57.0% (p = 0.46): no significant change.
- 14 days: meetings held 29 to 46; precision 37.0% to 36.9%.
- Exposure less even: the Gini rose on every seed.
- Canary leaks, invariant violations and minor contacts 0 in every run.
- Decision: on by default. StubNetwork-with-engine numbers measured before this change are superseded.

Superseded by [2026-10-07-engine-v1.2.md](2026-10-07-engine-v1.2.md).

## ConsentNetwork send defaults, attention v1.2 (2026-10-07)

NYC world, 21 days, seeds 1-3, simulated reviewer, no LLM calls.

- Meetings held: 129 to 173 (+34%) with the default persona policy; 52 to 95 (+83%) with the time-aware simulator.
- Initial invites per member-week: 0.93 to 0.50.
- Everyone-yes: 0.818 to 0.853 pooled (z = 1.05, not significant).
- Booked plans cancelled ("can't"): 54 of 251 (default policy), 120 of 235 (time-aware).
- After the review fixes (close with `no_common_time` instead of guessing a time): 178 meetings (default), 111 (time-aware).
- Canary leaks, invariant violations, minor contacts and false flags 0 in all runs.
- PRD scorecard proxy (after): worthwhile interruptions 26-32% (target 70%), opt-in 37-40% (target 40%).

Superseded by [2026-10-07-network-consent.md](2026-10-07-network-consent.md), [2026-10-07-attention-budget.md](2026-10-07-attention-budget.md) and [2026-10-08-network-hardening.md](2026-10-08-network-hardening.md).

## Network capital events and plans v1.1 in the ConsentNetwork (2026-10-08)

NYC world, no LLM calls.

- Safety gates held in every run: canary leaks 0, invariant violations 0, minor contacts 0; 0 minors in any plan role, 0 names in a plan probe, 0 reveals before quorum.
- Every NC ledger event is emitted through one typed emitter; 0 events rejected by a real `CapitalLedger` in 4 runs.
- Plans run end to end but book few plans. 21 days, 3 seeds: 99 plans proposed, 226 probes, 54 yes (24%), 8 booked, 7 held. No crew formed.
- Meetings held did not change measurably: 172 with plans, 161 with plans off, 163 before.
- Fix: counting only second encounters as member-started took ring-detection flags on honest groups from 58 to 0 (60 days, seed 1).
- Open at the time: the engine leak gate dropped about a quarter of plan probes on the word "free".

Superseded by [2026-10-08-network-capital.md](2026-10-08-network-capital.md) and [2026-10-08-plans.md](2026-10-08-plans.md).

## PoC validation of technical uncertainties (2026-10-06)

Each technical unknown outside the engine and simulator got a proof of concept. Model for all LLM work: gpt-6-luna on Surplus. Total spend about $15. Per-prototype verdicts are in the next section.

- Fixes applied after the PoCs: per-transaction pgvector settings and per-city partial HNSW indexes; deterministic thread attribution in the agent path; contact scrubbing, `decide()` and prompt v3 in the leak gate; intent liveness and complementarity in the engine; project-scoped identity, an invite gate and STOP/HELP handling in the Eliza Cloud spike.
- Repository layout (founder decision 2026-10-07): `plugin-network` lives in this repo as `packages/plugin-network`; Eliza is a git submodule at `eliza/`.
- LLM cost: gpt-6-luna lists at $0.10 per million input and $0.50 per million output tokens. Budget about $3/month billed, about $27/month worst case at list (300 members).
- Still unproven at the time: a real iMessage/SMS round trip, Twilio A2P registration, subtle inference leaks on human labels, transit travel time, relevant-event supply, staging latency, and the sim-to-real gap.

No superseding doc.

## Prototypes

The `prototypes/` directory was deleted in this branch. Each `RESULTS.md` is at `git show 16cde70:prototypes/<name>/RESULTS.md`.

- **poc-agent-llm:** pass. Gating extraction P 0.991 / R 0.991 (0.995 / 0.991 after v3), 0 false romance opt-ins, action routing 100% standard and 96.0% hard, 0 injected effects in 300 trials, wrong-thread executions 28/300 to 0 after the attribution fix, about $2.60-$3.50/month for 300 members.
- **poc-data-layer:** yes, with required settings. Exactly-once over 10k jobs with 8 workers and crashes (1,736 jobs/s); 500/500 duplicate-index races and 200/200 advisory-lock rounds correct; erasure leaves 0 rows and 0 embeddings. pgvector defaults silently return about 20 of 50 rows; PGlite fails permanently after 2,978 SQL errors and cannot test concurrency.
- **poc-eliza-fit:** viable. The Network plugin runs in the real shared-agent turn with no monkey patches (19 + 9 lines changed). Eliza's planner failed with luna (1/20 commits); one structured Stage-1 call got 58/60 commits with exact dates, 0/30 false commits, p95 6.7 s. The blockers were in Cloud identity, account creation and outbound compliance.
- **poc-embeddings:** not needed now. Recall@50 about 48% for OpenAI 3-small, 3-large, hashing and BM25 alike (random 22%). A structured scorer reached 58.5%; reranking with it raised top-N precision from 24% to 46%. The bottleneck is ranking, not embedding quality.
- **poc-enrichment-sources:** do not fetch LinkedIn (robots.txt and terms forbid it); X shows only the bio without its paid API. Paste-first is the main path.
- **poc-event-ingestion:** raw count yes, relevance no. NYC 460 unique events in 7 days (about 66 tech or social); SF about 200 adult events in a normal week, mostly library programs. Eventbrite, Meetup and Partiful forbid scraping. Dedupe P 1.00 / R 0.975 on 79 pairs.
- **poc-leak-gate:** partly. 98.97% recall with 1.85% false positives on 972 + 972 held-out messages; 99.87% recall on leaks an independent audit judged clear. All misses were subtle inference leaks. After the fixes (prompt v3, `decide()`): fresh test3 recall 98.00%, 100% on clear leaks, clean HOLD_REVIEW 3.25%.
- **poc-travel-time:** yes for walk and bike (85-100% of pairs within 25% of OSRM from H3 res-8 cells); car NYC 95%, car SF 60% (78% for trips over 10 minutes); transit not validated.

Other prototype folders (`messaging-blooio`, `connector-mcp`, `prompt-opt`) had no `RESULTS.md`. The `prompt-opt` pilot is summarized under "Prompt optimization and GEPA pilot" above.
