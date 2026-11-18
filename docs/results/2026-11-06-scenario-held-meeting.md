# Scenario held-meeting grading — 2026-11-06

## Problem and scope

The `meeting_held` scenario check could pass after only one person attended.
The same run correctly reported zero held meetings in its metrics.
The scenario CLI then printed `PASS` and exited 0 for a meeting that never happened.

This reproduced validation defect is within the approved project scope.
PRD 34.3 defines scenario scripts; 34.4 requires outcome and reliability measurements.
The World and its metric collector both require at least two attendees for a held meeting.

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
The branch starts from current main, without other open PRs.
Runtime: Bun 1.4.2 on Windows; PostgreSQL 16.15 for service validation.

## Cause and fix

The grader counted attendance among the requested personas but never checked total attendance.
An expectation naming one person, with an implicit or explicit minimum of one, passed when that person arrived alone.

Require at least two actual attendees before checking the requested subset.
The requested minimum retains its existing meaning.
A genuine two-person meeting can still satisfy an expectation naming only one participant.
The failure diagnostic now says that no held meeting satisfied the expectation.

Other implementations considered:

1. Raise the requested minimum to two. That rejects valid checks naming one person in a larger meeting.
2. Disallow expectations naming fewer than two people. That removes a useful existing subset check.
3. Extract a shared predicate and refactor the World and metric collector. Their existing behavior is correct; this fix changes only grading.

## measurement

The regression derives a two-person dinner from the existing `group-flake-morning-of.json` scenario.
It keeps the real scenario runner, built-in `StubNetwork` arm, policy personas, channel, scheduler and outcome collector.
Random introductions are disabled, as in the original fixture.

Both scripted people prefer a pair; the proposal names those two people and describes a dinner for two.
The negative variant retains the fixture's `force_flake` action, targeting `dinner-1` with `how: no_show`.
The control removes that action.
No attendance record, persona response or network result is fabricated.

Each run checks `dinner-2` through two expectations:

```json
[
  { "check": "meeting_held", "personas": ["dinner-2"] },
  { "check": "meeting_held", "personas": ["dinner-2"], "min": 1 }
]
```

The primary seeds are 2, 9 and 15, with both variants on each seed.
Each world has two scripted personas and five simulated days.
All six worlds finish before the regression asserts their attendees, held-meeting counts, grades and scenario pass status.

| Primary variant | Worlds | Actual attendees per outcome | Held meetings per world | Scenario passes before | Scenario passes after |
|---|---:|---|---:|---:|---:|
| No-show | 3 | `dinner-2` only | 0 | 3 | 0 |
| Control | 3 | `dinner-1`, `dinner-2` | 1 | 3 | 3 |

Both expectation forms falsely pass in every primary no-show world before the fix.
Both correctly fail afterwards; both still pass in all three controls.
The unchanged integration case fails on base and passes on the fix: one assertion over six complete runs.
Its case runtime is 31.59 ms before and 31.92 ms after; both test commands report 78 ms total.

The additional corpus uses seeds 3–8, 10–14 and 16, with the same two variants and settings.
It contains 24 worlds, bringing the total to 30 worlds per revision.
No scenario parameters were tuned on these additional seeds.

| Corpus | Worlds | False scenario passes before → after | Genuine-meeting controls passing, both revisions | Already-failing cases |
|---|---:|---:|---:|---:|
| Primary | 6 | 3 → 0 | 3 | 0 |
| Additional | 24 | 11 → 0 | 12 | 1 |

The additional no-show variant on seed 12 produces no outcome record and fails at both revisions.
Across the other 14 no-show variants, 28 individual expectation grades change from false passes to failures.
All 15 genuine-meeting controls retain their passing grades and details.

Every world's metrics match exactly before and after.
SHA-256 comparisons of complete run records also match after removing only `run_end.wallMs`.
The change corrects scenario grading without changing any simulated interaction or outcome.
These are exact deterministic classifications; no improvement in member behavior or statistical estimate is claimed.

### CLI reproduction

The temporary scenario files use the same fixture transformations as the committed case, with scenario seed 2.
Run the following command at both revisions, substituting the no-show or control file:

```text
bun run --conditions eliza-source packages/sim/src/cli.ts --network stub --scenario ../scenario-held-miss.json --k 1 --no-log
```

| Input | Before | After |
|---|---|---|
| No-show scenario | `pass^1: PASS (1/1)`, exit 0 | `pass^1: FAIL (0/1)`, exit 1 |
| Control scenario | `pass^1: PASS (1/1)`, exit 0 | `pass^1: PASS (1/1)`, exit 0 |

The corrected no-show diagnostic is `no held meeting with >= 1 of them attending`.
The CLI writes no run logs in this reproduction.

## safety_gates

Run the same command on base and the fix:

```text
bun run sim --only network --json ../scenario-held-gates.json
```

Both pass 61/61 blocking gates, with two tracked records and none off target.
All 63 records match after excluding elapsed time.
The invariant-run fingerprint remains `24bb81f068060b33`.
The consent-versus-push fingerprint remains `361f8cc2648fb9a6`.
Runtime is 188.1 seconds before and 185.7 seconds after.

This block exercises the scenario corpus, the Network harness and conformance checks.
No threshold, classification, matching decision or persona behavior changes.
All safety metrics also remain identical in the 30-world comparison.
The qualification uses the repository's simulated review flows; no live messages are sent.

The full simulation was not repeated.
AGENTS.md permits one full run per agent; that allowance was used earlier on PR #355.
That earlier full run is not evidence for this revision.

## Service validation

`bun run typecheck` passed all four TypeScript configurations.

`bun run test:integration`, including the security files, reported:

```text
676 pass
8 skip
6 fail
13742 expect() calls
Ran 690 tests across 69 files. [573.01s]
```

The new scenario case passed inside that command in 18.44 ms.
All six failure names and causes match the failures previously reproduced on clean base:
missing `/bin/bash`, SIGTERM exit 143 rather than 0, and four Windows path-separator assertions in Sites.
The eight skipped cases belong to the optional completed-cleanup reconciliation suite.
No new integration failure was observed; a fully green integration suite is not claimed.

`bun run test:e2e` reported:

```text
42 pass
1 skip
0 fail
654 expect() calls
Ran 43 tests across 3 files. [70.56s]
```

The optional browser SDK case was skipped because its Playwright module was not configured.
Validation used the isolated local PostgreSQL cluster, with `REQUIRE_PG=1`.
After both commands finished, it had no other clients and was stopped.

## llm_evidence

N/A: this corrects deterministic final-state scenario grading.
The reproduction uses the built-in policy personas and makes no model calls.
Real-model calls: zero. Cost: $0. No model-backed behavior is claimed.
Live-send and deployment flags were disabled.

## agent_clients

N/A: this changes a developer validation command, with no member-facing agent flow.
Codex desktop 26.1029.7803.0 drove Bun 1.4.2.
Provider: OpenAI. The exact assistant model identifier was unavailable.
The attribution helper supports `unavailable` for disclosure.
No other agent client, browser or computer control was used.

## How to test

Use the repository's audited dependency setup.
Run this command on the fix and with the unchanged test copied to base:

```text
bun test --conditions eliza-source packages/sim/test/scenario-held-meeting.integration.test.ts
```

Expect one failing case on base: all three lone-attendee runs incorrectly pass both expectations.
Expect one passing case on the fix, covering six complete worlds and both forms of the expectation.
Run the Network qualification above and expect 61/61 blocking gates.

## Risks and limits

Scenarios that previously treated one person arriving alone as a held meeting now fail.
That aligns this check with the World and its held-meeting metric.
The requested-person minimum remains independent of the two-person requirement for an actual meeting.
The test validates the built-in simulated Network workflow; it does not claim a live member workflow.

This does not change other expectation kinds or resolve other open scenario-grading PRs.
There is no UI, dependency or production-service change.
Only repository-generated synthetic personas were used. No raw messages, run logs or credentials are committed.
