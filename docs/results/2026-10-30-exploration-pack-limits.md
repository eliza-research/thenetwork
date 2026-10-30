# Keep pack limits during exploration

The exploration pass can select two candidates for a job with one opening left.
The floor and greedy passes apply the pack's selection hook. The exploration
pass checks only the shared budgets and uses the raw score. Thus it misses the
Peon hook which caps each job slate at its remaining openings.

This fixes a reproduced matching defect under the approved project scope, PRD
28.3, 33.8 (exploration stays within capacity) and 40.6 (Peon hiring). Exploration
is off in the default Peon config. The defect occurs when a caller enables the
existing, supported exploration setting; it does not affect that default run.

Apply the existing adjusted-score check in the exploration pass, at that pass's
existing lower threshold. Recompute it for each draw, since earlier draws use
capacity. Packs without a selection hook retain their prior path. Two other
options were considered: duplicate Peon's cap in core selection, which would
couple core to one pack; or discard surplus proposals after selection, which
would waste budget and obscure the draw probabilities. Neither is needed.

## measurement

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Native Windows, Bun 1.4.2,
locked dependencies. Run the same command on the base with only the added gate,
then with the production fix:

```sh
bun run sim --only peon --json result.json
```

The new gate uses the actual `runEngine`, Peon generators, scoring and selection.
Its hand-written synthetic snapshot contains 40 distinct verified employers and
24 adult qualified candidates in NYC. Each job has one remaining seat, as
represented by the existing `peon:seat_cap` input. It runs seeds 1–8 at rates 0
and 0.125, with maxShare 0.15. No scorer, selector or model response is mocked.

| Result | Before | After |
|---|---:|---:|
| Blocking gates | 27/28 | 28/28 |
| Seed 3, exploration 0.125: maximum candidates per one-seat job | 2 | 1 |
| Seed 3, exploration 0.125: total proposals | 41 | 40 |
| Rate 0, every seed: total proposals | 40 | 40 |
| Rate 0, every seed: maximum candidates per job | 1 | 1 |

All 16 cases pass after the fix. The exploratory cases still select exploration
proposals. This is a deterministic capacity assertion, not an estimated effect
on hiring quality; no confidence interval or statistical claim is made.

The pinned hiring world is unchanged: seeds 13–16, eight weeks, 400 candidates
and 80 jobs per city. All 28 prior gate records, apart from elapsed times, are
identical. The pack/keyword/oracle fingerprint stays `b7736da857812394`.
Hires/keyword stays 1.05x, hires/oracle 0.91x, and intros/keyword 0.10x.
Focused runtimes were 52.4s before and 57.2s after; these are not a speed result.

## safety_gates

Minor matches, unverified-employer intros and jobs without pay ranges all stay
zero. Scam reach stays median 1, maximum 1. Sealed-group impact stays 0.96
(worst seed 0.84). The existing canary, blocks, consent, minor-role and judge
conformance gates all pass. No threshold, budget, safety rule or gate was relaxed.

All four TypeScript configurations pass locally with the same TypeScript
compiler under Bun's runtime. Native Node `tsc` ran out of host memory, so that
attempt is not a pass. Hosted Linux CI will run the repository's standard
typecheck, full simulation, integration including security, and e2e commands.
Its result will be linked in the PR. No new local full simulation is claimed.

## llm_evidence

Zero validation model calls and US$0. The operator declined paid model tests.
These deterministic results do not satisfy the repository's required real-model
qualification. Keep this PR in draft and disclose that gap.

## agent_clients

Authoring: Codex desktop, OpenAI `gpt-6.1-sol`; installed Windows app package
26.1027.3384.0. This is a package inventory, not a claim about other clients.
Claude Code, Hermes Agent, OpenClaw, Muse, Grok bot, elizaOS and Cursor acceptance
runs were not performed. The engine harness runs locally with synthetic data;
it sends no live messages and makes no deployment.
