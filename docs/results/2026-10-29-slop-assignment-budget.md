# Slop assignment respects each member's remaining proposal budget

Date: 2026-10-29. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Code and regression commit: `d895f03436a6a56ee11300ca188c60ce150276d8`.
Scope: PRD 28.3 (outreach control), 32.9 and 40.4.

## Problem and cause

Slop replaces the shared selector with its own assignment algorithm.
That algorithm limits proposals per tick, but does not check the member's rolling budget.
It also ignores the capacity reserved for questions in the same engine run.
Both greedy and stable assignment can therefore return proposals that the shared selector would refuse.
Backup rounds have the same problem.

This is an engine-output defect. These measurements do not establish that a live member received an excess message.
The later outreach controller still applies its send-time limits.

## Fix

Before each assignment round, check both members' remaining budgets.
Count recent proposals, questions reserved by the engine, and proposals already selected in this run.
Use each member's participation state to select the budget.
The existing greedy and stable algorithms then operate on the remaining eligible pairs.

Two other implementations were considered:

1. Use the shared selector for slop. This would also change slop's assignment, congestion and stable-matching behavior.
2. Remove excess proposals after assignment. This would discard selected partners without giving their other candidates a chance.

Checking eligibility before each round preserves those assignment rules and avoids both problems.

## measurement

The comparison uses the real `runEngine` pipeline and seeded slop personas.
It uses seeds 1, 2 and 3, with 60 personas per city across SF, NYC and LA.
That is three worlds of 180 personas each.
The proposal limit is one per seven days. Two assignment rounds are enabled.
Profile questions are disabled in this comparison to isolate proposal assignment.
The same data, configuration and command run against the base and the fix.

| Assignment | Seed | Proposals before | Proposals after | Members over budget before | Members over budget after |
|---|---|---:|---:|---:|---:|
| greedy | 1 | 100 | 52 | 78 | 0 |
| greedy | 2 | 87 | 44 | 67 | 0 |
| greedy | 3 | 83 | 43 | 63 | 0 |
| stable | 1 | 95 | 52 | 74 | 0 |
| stable | 2 | 85 | 43 | 68 | 0 |
| stable | 3 | 81 | 41 | 62 | 0 |

The maximum proposals per member falls from two to one in all six runs.
Fewer proposals are expected when the configured budget is enforced.
This is a correctness result, not a matching-quality improvement claim.

## Regression gate and reproduction

The new gate in `scripts/sim/slop.ts` runs both assignment algorithms, ordinary second rounds, and backup rounds.
It tests fresh members with a one-proposal budget and members with a recent proposal under the default two-proposal budget.
Historical proposals come from a preceding real engine run.
The gate requires nonempty output and new partners for members with history.
It cannot pass by excluding every member.

Run from the repository root with Bun 1.4.2:

```sh
bun install --frozen-lockfile
bun run sim --only slop
bun run typecheck
```

The new gate fails against the base implementation with `expected 2 to be <= 1`.
It passes with this fix.
For the base check, keep the new gate and restore only `assign.ts` from the base commit.

The table above uses the same engine inputs as the gate's fresh-member cases.
Count returned proposals per participant before checking the configured limit.
Requests: zero. LLM calls: zero. Model and request settings: N/A. Provider cost: zero.
No statistical significance claim is needed for this deterministic limit violation.

## safety_gates

The base `bun run sim --only slop` passed 39/39 blocking gates, with eight tracked gates off target.
The fix passes 40/40, with eight tracked gates off target.
No gate threshold, population seed, safety rule or member-facing text is changed.
The zero-contact, zero-leak and consent gates continue to pass.

Enforcing budgets changes who reaches later simulated steps.
The pinned slop world uses seeds 13-16, four weeks and 300 personas per city.
The slop-live world uses its unchanged seeds 21-22 and 30-day protocol with a simulated reviewer.

| Existing metric | Base | Fix |
|---|---:|---:|
| Pinned dates per member-month versus random | 1.005x | 0.810x |
| Pinned reduction in age-liar contacts versus random | 76.5% | 100.0% |
| Pinned reduction in adversary contacts versus random | 45.4% | 64.9% |
| Relay scam/harassment recall on content alone | 100.0% (43 items) | 96.7% (30 items) |
| Slop-live probes | 342 | 296 |
| Slop-live dates booked | 42 | 29 |
| Slop-live dates held | 32 | 20 |
| Slop-live adults booked at least once | 39.1% | 32.1% |

The dates-per-member target becomes off target; the age-liar target becomes on target.
Both were already classified as tracked. Their classifications are unchanged.
Relay recall remains above its unchanged 90% blocking threshold, but its sample and value change.
The lower booking volume is a material trade-off for maintainer review, not an improvement claim.

## Executed validation

Environment: Windows, Bun 1.4.2 (`744846f84`), Node 24.14.0, locked dependencies.
The global Bun 1.3.11 cannot read this lockfile and was excluded from the final commands' PATH.

| Check | Result |
|---|---|
| New gate on base assignment | FAIL: `expected 2 to be <= 1` |
| New gate on fixed assignment | PASS |
| `bun run sim --only slop` | Base 39/39; fix 40/40 blocking gates; eight tracked off target in each |
| `bun run typecheck` | PASS, exit 0 |
| `bun run sim` | Incomplete: stopped in the network block without a final summary or JSON; no full-suite pass claimed |
| `bun run test:integration` | Could not complete: Windows-specific build/shell failures and missing local Postgres |
| `bun run test:e2e` | 0 pass, 47 skipped, 0 fail; Postgres unavailable |
| `bun run security` | 110 pass, 41 skipped, 6 fail, 1 error; exit 1 |

Integration failures include an unavailable `/bin/bash` and database setup failures.
Security failures include a failed site build, router HTTP checks, and a refused local database connection.
The site build also fails in this CRLF checkout; open PR #177 addresses that separate Windows issue.
`pg_ctl`, `initdb` and `psql` are absent.
Skipped database cases are not passing database evidence.

## llm_evidence

N/A: this change fixes deterministic selection arithmetic after scoring.
It does not change model prompts, responses, clients or provider code.
No provider credentials are configured and no real-model run was made.
The evidence uses real engine execution, not mocked model responses.

## agent_clients

N/A: no signup, MCP, OAuth, gateway or other client workflow changes.
The local engine and simulation were exercised through Codex terminal tools.
No end-to-end client signup was tested, and no client compatibility claim is made.
Provider: OpenAI. Model identifier supplied by the operator: `gpt-6.1-sol`.
Client: Codex desktop `26.1023.6123.0`, verified from the installed Windows package.
The initial disclosure used `unavailable`; the operator supplied the model identifier afterward.

## Limits

The new gate covers three seeds and two budget histories.
It does not prove a live messaging outcome or a change in human match quality.
Real-model and multi-client evidence are not supplied for this deterministic engine change.
Database-backed checks still need a supported Postgres environment.
All data is synthetic. No deployment or live send was performed.
