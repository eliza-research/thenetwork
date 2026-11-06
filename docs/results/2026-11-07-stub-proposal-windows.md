# The time-aware stub keeps meeting starts within proposal windows

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2` (`main`).
Environment: Windows, PowerShell 7.6.9, Bun 1.4.2 (`744846f84`), frozen dependencies.

## Problem, requirement, and change

`StubOptions.timeAware` promises to select a meeting time inside the proposal's
window. `pickSlot` discards that window when it yields no template candidates,
then selects from the unrestricted horizon. Its final 19:00 fallback also
ignores the window. A one-hour window on Tuesday can therefore produce a
confirmed meeting days later, after that window has ended.

This is a reproduced simulator defect under approved scope, CONTRIBUTING 3.1,
and PRD 34.3's realistic scheduling and outcome validation. The built-in
`StubNetwork` is a simulation baseline; this is not a production NetworkService
change or a new matching feature.

Candidate generation now retains the explicit window. The existing 19:00
fallback remains available when its start is inside that window, or when
there is no window. Otherwise `schedule` closes the opportunity through the
existing cancellation path with reason `no_available_slot`, before marking it
scheduled, writing a meeting, or sending a scheduling confirmation.

Clamping an unrestricted date to the window boundary would invent a new slot.
Removing every fallback would also change broad-window cases whose existing
fallback is valid. The paired controls below caught that unnecessary change
during development; the final implementation preserves those cases.

This change checks the scheduled start time represented by `MeetingReport.at`.
PR #219 separately changes the engine's `candidateSlots` end-time containment
for a slot's full duration. Its code is not copied here, and no combined
qualification with that PR is claimed. The non-time-aware stub retains its
documented fixed-time baseline behavior.

## measurement

The integration case starts with the existing `group-flake-morning-of.json`
scenario. It uses `scenarioWorldOptions` to build its six dinner personas and
background, then supplies a window on the existing scripted proposal. The
complete `runWorld` uses the built-in stub, policy personas, event scheduler,
channel, real consent replies, and final records. No reply, oracle verdict,
meeting, or result record is mocked. Logs are not written to `runs/`.

The dinner proposal is Tuesday, day 1, 09:30 SF. Five variants run on seeds
1–5 (25 worlds in one integration case):

| Variant | Input and expected behavior |
| --- | --- |
| Short | Tuesday 11:30–12:30; no template slot fits; cancel without booking or confirming. |
| Off-template | Thursday 13:00–14:00; no template slot fits; cancel without booking or confirming. |
| Wide | Proposal time +1 to +5 days; retain booking inside the window. Seed 5 exercises the 19:00 fallback. |
| Unbounded | No window; retain booking. |
| Legacy | Short window with `timeAware: false`; retain the original fixed-time baseline. |

The case checks meeting records, scheduling messages, the cancellation reason,
start-time containment, and zero runtime errors. On base source with the same
new test: **0 pass, 1 fail, 1 assertion**, 116.60 ms case / 173 ms command.
With the fix: **1 pass, 0 fail, 1 assertion**, 117.58 ms case / 165 ms command.
The ten short/off-template observations fail before the fix because they
are booked and confirmed outside their windows instead of canceled.

```text
bun install --frozen-lockfile
bun test --conditions eliza-source packages/sim/test/stub-window.integration.test.ts
bun run typecheck
```

For the before run, the test alone was temporarily copied into a separate clean
checkout of the base, run with the same command, then removed. The base checkout
was clean afterward. An initial Windows fixture-path error was corrected before
these measured regression runs; it is not counted as defect reproduction.

A larger paired measurement repeats the same five variants on seeds 1–120,
with identical fixture names, proposal IDs, population, network seeds and inputs:
600 complete worlds per revision. It also runs 40 ordinary generated worlds:
40 personas, 14 days, seeds 1–20, with time-aware mode on and off. These use the
stub's ordinary random introductions. Before runs use the clean base checkout.

| Paired worlds per revision | Meeting starts outside the window, base → fixed | Event traces changed |
| --- | ---: | ---: |
| 120 short-window, time-aware | 120 → 0 | 120 |
| 120 off-template, time-aware | 120 → 0 | 120 |
| 120 wide-window, time-aware | 0 → 0 | 0 |
| 120 unbounded, time-aware | N/A | 0 |
| 120 legacy-mode controls | 120 → 120 (mode unchanged) | 0 |
| 40 ordinary generated-world controls | 0 → 0 | 0 |

Counts are unique meeting IDs, not the repeated `meeting_scheduled` records
written when late members join the same dinner. All 240 corrected opportunities
close without a meeting. All **400 control traces and metrics are identical**.
All 640 paired populations are identical. SHA-256 trace comparisons omit only
`run_end.wallMs`; no other record field is normalized. All 640 worlds have
zero judge invariant violations and runtime errors before and after.

This corrects the world being measured; it is not a matching-quality gain.
The final scenario grades may change because an impossible booking is removed.
The original scenario's expectations were not altered to award a pass for a
cancellation. These are deterministic paired results, not confidence intervals.
Raw synthetic measurement files remain local.

## safety_gates and qualification

`bun run sim --only network --json <output>`: **61/61 blocking gates pass**, two
tracked records on target. All **63 gate records** match the base, excluding
elapsed time. The 156.0-second base result is reused from the measured `a0ed7bc`
run for the drop-notification contribution; the final head run takes 167.7
seconds. No thresholds, expected fingerprints, fixtures, or judges are changed.

All four typecheck configurations pass. With task-owned PostgreSQL 16.15 on
port 54339 and `REQUIRE_PG=1`:

- `bun run test:integration`: **676 pass, 8 skip, 6 fail**, 13,742 assertions,
  420.53 seconds. The new regression case passes in 110.11 ms. The six failure
  names and causes match the recorded clean-base failures: Windows cannot spawn
  `/bin/bash` for the Wrangler wrapper, the boot test receives SIGTERM exit 143
  instead of 0, and four site-build assertions compare native paths with a
  slash-delimited `.well-known/agent-skills/index.json`. The eight skips belong
  to the optional isolated PostgreSQL completed-cleanup reconciliation suite.
  Integration is not fully green on this Windows host.
- `bun run test:e2e`: **42 pass, 1 skip, 0 fail**, 654 assertions, 35.53 seconds.
  The optional browser SDK case requires `PLAYWRIGHT_MODULE` and is skipped.

No additional full `bun run sim` was run: AGENTS.md permits one full run per
agent, already consumed earlier. That earlier result is not attributed to this
revision. The affected Network block was run here without `--quick`.

## llm_evidence and agent_clients

Zero model calls and zero provider cost. This deterministic scheduling change
does not validate model output. The simulated policy personas and baseline stub
are explicitly part of the simulator, not a substitute for real-model evidence
about an LLM path. No production send or deployment occurred.

Authoring client: Codex Desktop 26.1029.7803.0 on Windows; provider OpenAI;
the exact authoring model identifier is unavailable. Claude Code, ChatGPT,
Hermes Agent, OpenClaw, Muse, Grok bot, elizaOS, and Cursor were not tested.
Computer use was not used, as instructed by the operator.
