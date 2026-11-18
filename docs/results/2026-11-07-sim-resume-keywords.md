# Let supported resume keywords reach the simulated channel

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2` (`main`).
Environment: Windows, PowerShell 7.6.9, Bun 1.4.2 (`744846f84`), frozen dependencies.

## Problem, requirement, and change

After a simulated member sends STOP, `World.personaSend` admits only text whose
trimmed, upper-case value is exactly `START`. The channel already uses core's
shared keyword table and normalizer, which also accept `UNSTOP`, `SUBSCRIBE`,
`RESUME`, and normalized forms such as `start.` and full-width `ＳＴＡＲＴ`.
The world drops these supported inputs before the channel can read them. The
member stays stopped and their later messages disappear from the simulation.

This is a reproduced simulator defect under approved scope, CONTRIBUTING 3.1,
and PRD 34.2–34.3's channel gateway and persona simulation. Core's `KEYWORDS`
contract explicitly makes the shared table authoritative and excludes `YES`
from opt-in keywords. This PR does not alter that table or production consent.

The world now uses the channel's existing `detectKeyword` function before
admitting a stopped member's message. Only an actual START keyword may pass;
a tapback is not treated as a keyword. The channel remains responsible for
interpreting the message and updating its state. World memory and the Network
then follow the same existing path as ordinary `START`.

Removing the guard would admit ordinary messages from stopped personas. Copying
the alias list into the world would leave two tables and would still duplicate
normalization. Reusing the detector keeps the pre-send check and channel aligned.

## measurement

The integration case starts with the existing `stop-keyword.json` fixture:
the scripted member and 12 background personas, using real policy decisions,
the built-in stub, event scheduler, and simulated channel. The original STOP
occurs on day 2 at 11:00 SF. Each world then supplies a candidate resume input
on day 3, a normal follow-up on day 4, and a second STOP on day 5, all at 11:00.
The no-resume control omits the day-3 message.

Seeds 1, 61, and 83 each run these ten cases, for 30 complete worlds:

| Input | Expected behavior |
| --- | --- |
| `START` | Existing resume behavior; normal follow-up reaches the Network. |
| `UNSTOP`, `SUBSCRIBE`, `RESUME` | Same behavior as `START`, using core's existing aliases. |
| `start.`, `ＳＴＡＲＴ` | Same behavior after the channel's existing normalization. |
| `YES`, `restart`, `start later`, no resume input | Remain stopped; normal follow-up is suppressed. |

The case checks inbound START and STOP records, the actual follow-up message,
final world-memory and channel opt-out state, and that no non-system message
is delivered after the final STOP. It also checks zero `send_after_stop`
violations and runtime errors for these three seeds. No messages, decisions,
records, or outcomes are mocked.

Fifteen supported rejoin attempts fail on the base: the three aliases and two
normalized forms on each seed. The before/after command results are:

- Base source with the new integration test only: **0 pass, 1 fail, 1 assertion**,
  273.04 ms case / 322 ms command.
- Fixed source: **1 pass, 0 fail, 1 assertion**, 213.40 ms case / 262 ms command.

```text
bun install --frozen-lockfile
bun test --conditions eliza-source packages/sim/test/resume-keywords.integration.test.ts
bun run typecheck
```

Expected result: one passing integration case with the fix, one failing case
against the unchanged base. These runs exercise `runWorld` with the fixture's
personas and actions. They do not claim that the original stop-only scenario's
absolute `no_messages_after_stop` expectation describes a later resubscription;
that expectation and the fixture file are unchanged.

A wider paired measurement repeats the same ten cases on seeds 1–120:
1,200 worlds per revision. Before measurements use a separate clean checkout
of the base with frozen dependencies. The other eight existing scenarios each
run on their fixture seed and the following two seeds, adding 24 control worlds.
All 1,224 pairs use identical inputs, IDs, populations, and network seeds.

| Worlds per revision | Successful rejoins, base → fixed | Traces changed |
| --- | ---: | ---: |
| 600 previously blocked alias/normalized inputs | 0 → 600 | 600 |
| 120 ordinary `START` controls | 120 → 120 | 0 |
| 480 ordinary-text/no-resume controls | 0 → 0 | 0 |
| 24 other-scenario controls | N/A | 0 |

All **624 control traces and metric objects are identical**. All 1,224 paired
populations are identical. Every affected run now has the same metrics as its
same-seed `START` control. Their event traces also match when only the entered
resume text is normalized to `START` in its scenario-action and inbound-message
records. All trace comparisons omit `run_end.wallMs`; the before/after control
comparisons do not normalize message text. No other fields are normalized.

The scripted member in each keyword-control world is stopped again after the
final STOP, with zero delivered non-system messages afterward. Other-scenario
grades are unchanged. These are
deterministic comparisons, not confidence intervals or a matching-quality gain.
Raw synthetic conversations are not published.

## safety_gates and qualification

All four typecheck configurations pass. Across the 1,224 paired worlds,
runtime errors, minor contacts, and canary leaks are zero on both revisions.
All 720 supported-keyword runs have zero invariant findings after the fix and
match the existing `START` behavior. The negative controls retain 48 baseline
`send_after_stop` findings for suppressed attempts; their traces and metrics
are unchanged. Total findings are 108 before and 48 after. This is not a claim
that the change repairs those remaining baseline attempts.

`bun run sim --only network --json <output>`: **61/61 blocking gates pass**, two
tracked records on target. All **63 gate records** match the base, excluding
elapsed time. The 156.0-second base result is reused from the measured `a0ed7bc`
run for the drop-notification contribution; this head takes 188.3 seconds.
No thresholds, expected fingerprints, fixtures, or judges are changed.

With task-owned PostgreSQL 16.15 on port 54339 and `REQUIRE_PG=1`:

- `bun run test:integration`: **676 pass, 8 skip, 6 fail**, 13,742 assertions,
  402.18 seconds. The new regression case passes in 193.04 ms. The failure
  names and causes match the recorded clean base: Windows cannot spawn
  `/bin/bash` for the Wrangler wrapper, the boot test receives SIGTERM exit 143
  instead of 0, and four site-build assertions compare native paths with a
  slash-delimited `.well-known/agent-skills/index.json`. The eight skips belong
  to optional isolated PostgreSQL completed-cleanup reconciliation checks.
  Integration is not fully green on this Windows host.
- `bun run test:e2e`: **42 pass, 1 skip, 0 fail**, 654 assertions, 35.76 seconds.
  The optional browser SDK case requires `PLAYWRIGHT_MODULE` and is skipped.

No additional full `bun run sim` was run: AGENTS.md permits one full run per
agent, already consumed earlier. That earlier result is not attributed to this
revision. The affected Network block is qualified without `--quick`.

## llm_evidence and agent_clients

Zero model calls and zero provider cost. Keyword routing is deterministic; this
does not validate model output. The policy personas and baseline stub are existing
simulator components, not real-model evidence. No production sends or deployment
occurred, and no external client acceptance is claimed.

Authoring client: Codex Desktop 26.1029.7803.0 on Windows; provider OpenAI;
the exact authoring model identifier is unavailable. Claude Code, ChatGPT,
Hermes Agent, OpenClaw, Muse, Grok bot, elizaOS, and Cursor were not tested.
Computer use was not used, as instructed by the operator.
