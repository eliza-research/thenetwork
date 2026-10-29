# Peon: exclude the hiring manager from their own posting

Date: 2026-10-30 (Asia/Tokyo). Reproduced defect under the approved Slop scope and PRD 40.6's candidate-first hiring flow.

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Fix and gate: `0f64d590e7ec5b65a6198662a0fca0efc64f171a`.
Combined compatibility commit: `d990c0f62649bc0b65fc802f7f6695e796873dd2` (local only, includes the preceding 42 contributions).

## Problem, cause and fix

A verified adult manager can also be a candidate. Posting a job creates a separate seat member for matching.
The manager's candidate profile remains eligible for their own seat. A stronger profile can win its only opening.
`seatRoute` correctly refuses the resulting self-introduction. Selection has already excluded the other candidate, so no review item reaches them.

`peonSeats` now derives an `avoid` edge between each new seat and its owner.
The core pair filter rejects that pair before scoring and selection. The edge has `explicit: false` and exists only in the returned snapshot.
It is not a member-authored block, database write or change to the manager's preferences.
The manager retains their candidate profile and can apply to other employers. The routing safeguard remains in place.

Other implementations considered:

1. Remove owners from the candidate pool. That also prevents their legitimate job search with other employers.
2. Add an owner field to job profiles and a Peon-only eligibility rule. That makes the engine consume service-routing metadata and duplicates existing pair exclusion.

The selected approach reuses the graph constraint at the boundary that already derives seats and inherited blocks.
Its diagnostic rejection reason is the existing generic `blocked`, not a separate own-posting reason.

## measurement

One new blocking simulation gate in the existing `peon-seats` workflow. Twelve isolated cases: seeds 1, 2 and 3, four cases each.
Clock starts at 2026-10-05 17:00 UTC. Adults use professional opt-in, hybrid Brooklyn roles and the real deterministic text-onboarding path.
Each hiring post has one opening, data analyst level 2, and pay $90k–$120k.

- Qualified owner: owner SQL 5, other candidate SQL 3, job requires SQL 3. Before the fix, the owner takes the sole selection slot.
- Ineligible owner control: owner SQL 1. The other candidate already receives the introduction.
- Other-employer control: the owner closes their own posting, which remains in the snapshot, then another employer posts a SQL 5 job. The owner receives it as a candidate.
- Candidate declines: the qualified-owner setup, but the selected candidate answers no. The employer receives no candidate review or introduction.

The gate follows real `ConsentNetwork` intake, `postingFacts`, `peonSeats`, `packInput`, `runEngine`, tick scheduling, human-review simulation, probes and introductions.
It restarts through JSON after posting, after the candidate probe, before the employer's consent, and after the final state.
Rows use the existing in-memory persistence adapter and recording channel; this gate is not a PostgreSQL/HTTP test.

| Result | Before | After |
|---|---:|---:|
| Correct complete cases | 6/12 | 12/12 |
| Selected own-seat pairs | 6 | 0 |
| Expected candidate selected | 6 | 12 |
| Valid staff review items | 6 | 12 |
| Both-consented introductions | 6 | 9 |
| Candidate refusals reached and respected | 0/3 | 3/3 |
| Other-employer controls | 3/3 | 3/3 |
| Ineligible-owner controls | 3/3 | 3/3 |
| Hiring blocking gates | 36/37 | 37/37 |
| PostgreSQL safety gates | 17/17 | 17/17 |

Example rows from the paired CLI JSON output, before then after (seed 1, qualified owner):

```jsonl
{"seed":1,"scenario":"qualified-owner","selectedOwn":1,"selectedExpected":0,"queued":0,"beforeReview":false,"candidateFirst":false,"managerAfterYes":false,"result":false,"restored":false}
{"seed":1,"scenario":"qualified-owner","selectedOwn":0,"selectedExpected":1,"queued":1,"beforeReview":true,"candidateFirst":true,"managerAfterYes":true,"result":true,"restored":true}
```

No self-introduction was delivered before or after; the defect loses matches before review.
All six existing control rows are identical. All nine accepted after-fix intros require both yeses and consume exactly one opening.
All three declines stop before contacting the employer. Every final opportunity survives JSON restart unchanged.

The other 37 hiring records are identical, excluding elapsed time. The pack/keyword/oracle fingerprint remains `b7736da857812394`.
Those worlds use seeds 13–16, eight weeks, 400 candidates and 80 jobs per city in NYC/SF, realism v2.
They create job seats directly and do not use this service transform; unchanged aggregate metrics are a compatibility check, not a hiring-quality improvement claim.
Hiring runs took 36.3s before and 31.8s after.

## safety_gates

All 17 safety records match before and after, including PostgreSQL cases. The initial local safety command lacked PostgreSQL and ran 11 offline gates;
it was replaced by the complete 17-gate run after starting the dedicated test cluster. No skipped-PG result is counted as complete.
No age, consent, review, block, leak, scoring or capacity threshold changed. Existing explicit blocks still propagate to every seat.
Synthetic people only, simulated staff approval, and locally recorded sends. No deployment or real member contact.

## Validation

Standalone typecheck passes all four configurations, before and after. Combined typecheck also passes.
Combined hiring simulations pass 50/50 blocking gates, and the twelve new outcome rows exactly match the standalone result.
All 50 records from the previous combined hiring run remain identical (excluding time).
Only the test insertion conflicted; both the previous gates and the new gate were retained. Production code merged cleanly.

Integration, including the security subset, on the combined branch with PostgreSQL 16.15:

```text
684 pass
8 skip
6 fail
14439 expect() calls
Ran 698 tests across 70 files. [590.50s]
```

The six failures have exactly the same names as the preceding #210 run: Windows absolute `/bin/bash`, SIGTERM exit status, and four site path-separator comparisons.
The eight skips require the separate retry-reconciliation opt-in. Draft pending hosted Linux CI; integration is not claimed green.

E2E, run afterward on the same combined branch:

```text
42 pass
1 skip
0 fail
654 expect() calls
Ran 43 tests across 3 files. [41.49s]
```

The optional browser case is skipped without `PLAYWRIGHT_MODULE`. PostgreSQL suites ran sequentially on port 54339.

## Reproduce

```powershell
bun install --frozen-lockfile
bun run sim --only peon,peon-seats --json own-posting.json
bun run typecheck
# With the repository's dev PostgreSQL configured and running:
bun run sim --only safety --json safety.json
bun run test:integration
bun run test:e2e
```

Expect 37/37 hiring gates and 12/12 workflow rows on this branch. Apply only the gate changes to the base revision to reproduce 36/37 and 6/12.
The one-full-simulation-per-agent allowance was used for #136. This work reruns affected blocks; it makes no new full-simulation claim.
Local paired artifacts are `work/own-posting-{before,after,combined,safety-before,safety-after}.json` and their logs.

## llm_evidence

Deterministic snapshot transformation; no model-backed behavior changed. Zero validation LLM calls and $0 model cost.
The real intake path uses its rules mode. Safety's existing rater fixture is not real-model evidence.

## agent_clients

No external-client acceptance run is claimed for Claude Code, Codex/ChatGPT, Hermes, OpenClaw, Muse, Grok bot, elizaOS or Cursor.
The actual matching and consent code runs directly; the service suites above are separate evidence.
Installed authoring package: Codex desktop 26.1023.6123.0 (Windows package metadata). OpenAI `gpt-6-astra`, operator-identified; client `codex`.

## Limits

This fixes newly derived service seats. It does not migrate stored history or change direct synthetic seats without ownership metadata.
The small workflow measures delivery and consent, not interviews, hires or retention. No schema, dependency, UI or member-copy change.
