# Grade scenario silence from its executed cutoff

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2` (`main`).
Environment: Windows, PowerShell 7.6.9, Bun 1.4.2 (`744846f84`), frozen dependencies.

## Problem, requirement, and change

The existing `member-goes-silent` scenario tells its member to stop replying at
noon on day 1. Its `silent_after` expectation instead counts every inbound
message after 01:00 that day. A legitimate morning reply therefore fails the
scenario even when the member sends nothing after the actual silence action.
On seeds 1–120, the unchanged scenario produces nine such false failures.

This is a reproduced simulation-grading defect under approved scope,
CONTRIBUTING 3.1, and PRD 34.3's scenario scripts and final-state validation.
The fix changes the grader, not the member's behavior or matching algorithm.

For a `silent_after` expectation, the grader now finds the first executed
`go_silent` event for that member within the requested simulation day. It
counts inbound messages following that event in log order. A message before
the action at the same timestamp is allowed; a message after it is not. When
that day has no matching action, the existing day-only cutoff remains intact.

Moving the cutoff to the end of the day would hide real afternoon replies.
Adding a grace hour to the actual silence action would also hide replies after
silence began. Using the recorded event handles the action's resolved city and
timestamp and preserves the scheduler's ordering of simultaneous actions.

PR #380 separately stops queued automatic replies and flake notices after
silence. This branch does not contain that fix. Genuine late messages on the
base continue to fail the expectation; no combined qualification is claimed.

## measurement

One integration case runs 15 complete worlds: the existing silence fixture on
seeds 21, 27, and 29, each with five variants. It uses the real scenario builder,
built-in stub, policy personas, scheduler, simulated channel, final records,
and expectation evaluator. No messages, decisions, records, or verdicts are
mocked. These personas and conversations are synthetic.

| Variant | Expected result |
| --- | --- |
| Original fixture | Pass: morning replies precede the noon silence event. |
| Explicit reply at 13:00 | Fail: an actual inbound message follows silence. |
| Reply at noon, scheduled before silence | Pass: it occurs before the cutoff in event order. |
| Reply at noon, scheduled after silence | Fail: the same timestamp does not excuse a later event. |
| No silence action | Retain the existing day-only failure. |

The case also checks the actual number of messages following the event and
zero runtime errors. Six expectation statuses are wrong on the base; the nine
negative controls retain their failures. The test itself reports:

- Base source with the same test: **0 pass, 1 fail, 1 assertion**, 230.45 ms
  case / 286 ms command.
- Fixed source: **1 pass, 0 fail, 1 assertion**, 235.29 ms case / 283 ms command.

```text
bun install --frozen-lockfile
bun test --conditions eliza-source packages/sim/test/silence-cutoff.integration.test.ts
bun run typecheck
```

For the before run, the final test alone was copied into a separate clean
checkout of the base and removed afterward. The base checkout stayed clean.
The expected result of the test command is one passing integration case with
the fix and one failing case against unchanged base source.

A wider paired measurement runs nine silence variants on seeds 1–120:
1,080 complete worlds per revision. It includes the five variants above, an
additional 10:00 reply, an expectation for day 0 while silence occurs on day 1,
a NYC member, and a NYC action-city override for the SF member. The other eight
existing scenario files each run on their fixture seed and the following two
seeds, adding 24 worlds. All 1,104 pairs use identical inputs and run IDs.

| Silence variant (120 seeds each) | False failures, base → fixed | Genuine late-message failures, base → fixed |
| --- | ---: | ---: |
| Original | 9 → 0 | 25 → 25 |
| Additional 10:00 reply | 98 → 0 | 22 → 22 |
| Additional 13:00 reply | 0 → 0 | 120 → 120 |
| Noon reply before silence | 95 → 0 | 25 → 25 |
| Noon reply after silence | 0 → 0 | 120 → 120 |
| NYC member | 21 → 0 | 18 → 18 |
| NYC action-city override | 0 → 0 | 0 → 0 |

There are **223 false failures before and zero after**. All **330 genuine
late-message failures remain failures**, with no false passes. This count
concerns the silence expectation, not an assertion that every complete scenario
now passes. Some failure details correctly count fewer messages because they
no longer include replies preceding the cutoff.

The no-action and other-day variants retain their day-only results. Every
other expectation result is identical, including the 24 runs of the eight
other scenarios. All **1,104 event traces, populations, and metric objects are
identical** before and after. SHA-256 trace comparisons omit only
`run_end.wallMs`; no other record field is normalized. Raw synthetic traces
remain local. These deterministic paired results are not a matching-quality
gain or a statistical estimate.

## safety_gates and qualification

All four typecheck configurations pass. The paired worlds have zero runtime
errors, minor contacts, and canary leaks on both revisions. They retain 24
baseline invariant findings: 13 `decliner_exposed`, four `proactive_mislabeled`,
four `pause_path_missing`, and three `over_budget`. Their counts and examples
are unchanged; this change does not claim to repair those baseline findings.

`bun run sim --only network --json <output>`: **61/61 blocking gates pass**, two
tracked records on target. All **63 gate records** match the base, excluding
elapsed time. The 156.0-second base result is reused from the measured `a0ed7bc`
run for the drop-notification contribution; the final head run takes 167.9
seconds. No thresholds, expected fingerprints, fixtures, or judges are changed
outside this one scenario expectation.

With task-owned PostgreSQL 16.15 on port 54339 and `REQUIRE_PG=1`:

- `bun run test:integration`: **676 pass, 8 skip, 6 fail**, 13,742 assertions,
  415.53 seconds. The new regression case passes in 246.63 ms. The failure
  names and causes match the recorded clean base: Windows cannot spawn
  `/bin/bash` for the Wrangler wrapper, the boot test receives SIGTERM exit 143
  instead of 0, and four site-build assertions compare native paths with a
  slash-delimited `.well-known/agent-skills/index.json`. The eight skips belong
  to optional isolated PostgreSQL completed-cleanup reconciliation checks.
  Integration is not fully green on this Windows host.
- `bun run test:e2e`: **42 pass, 1 skip, 0 fail**, 654 assertions, 36.28 seconds.
  The optional browser SDK case requires `PLAYWRIGHT_MODULE` and is skipped.

No additional full `bun run sim` was run: AGENTS.md permits one full run per
agent, already consumed earlier. That earlier result is not attributed to this
revision. The affected Network block is qualified without `--quick`.

## llm_evidence and agent_clients

Zero model calls and zero provider cost. This deterministic grading path does
not validate model output. Policy personas and the baseline stub are simulator
components, not real-model evidence. No production sends or deployment occurred.

Authoring client: Codex Desktop 26.1029.7803.0 on Windows; provider OpenAI;
the exact authoring model identifier is unavailable. Claude Code, ChatGPT,
Hermes Agent, OpenClaw, Muse, Grok bot, elizaOS, and Cursor were not tested.
Computer use was not used, as instructed by the operator.
