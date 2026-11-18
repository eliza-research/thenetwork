# Scripted joins use the generated persona's city

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2` (`main`).
Environment: Windows, PowerShell 7.6.9, Bun 1.4.2 (`744846f84`), frozen dependencies.

## Problem and requirement

`ScenarioPersonaSpec.city` is optional. The persona generator supplies SF or NYC
when it is omitted. `scenarioWorldOptions` nevertheless resolves a scripted join
against `spec.city ?? "sf"`, while later actions use the generated home city.
With seed 1 and persona ref `member`, the generated persona lives in NYC. A join
at day 0, 09:30 happens at 12:30 NYC; a following `say` at 10:00 happens before
the join. The same issue appears with the default join hour of 9.

This is a reproduced simulator defect under approved scope, CONTRIBUTING 3.1,
and PRD 34.3's scripted situations and virtual time. The existing simulator
README describes joins at local time. No new scenario format is introduced.

The fix uses the existing `cityOf(spec.ref)` lookup for joins, as for the other
persona actions. An explicit `join.city` still overrides the home city through
`resolveAt`. Forcing every omitted persona city to SF would instead change the
generated population. Requiring an explicit city would remove a supported input.

## measurement

The new integration case runs 12 complete worlds through `runScenario`, the
built-in `StubNetwork`, scheduler, simulated message channel, and policy personas.
It checks the resulting join records, local calendar time, ordering before the
scripted message, and runtime errors. It does not mock a clock, generator,
network reply, or final record. This is a deterministic simulated-world result;
`StubNetwork` is the repository's baseline, not the production service or an LLM.

For seeds 1 and 2, it runs six variants: generated city, explicit SF, explicit NYC,
generated city with `join.city=sf`, generated city with `join.city=nyc`, and
generated city with the join hour omitted. The persona is `member`, age 30;
the join is on day `seed - 1` at 09:30, followed by `say` at 10:00 on the same
clock. Runs last three days, disable random intros, and write no run files.
Calendar expectations use `Intl.DateTimeFormat` rather than the scheduling helper.

```text
bun install --frozen-lockfile
bun test --conditions eliza-source packages/sim/test/scenario-join.integration.test.ts
bun run typecheck
```

On the base source with the new test: **0 pass, 1 fail, 1 assertion**, 25.54 ms
for the case (76 ms command). With the fix: **1 pass, 0 fail, 1 assertion**,
23.69 ms for the case (72 ms command). Two of the 12 observations differ before
the fix: seed 1's generated-city and default-hour arms join at 12:30 after the
10:00 action. Both join at 09:30 before that action after the fix.

The concrete seed-1 input can also be used as a scenario JSON file:

```json
{
  "name": "join-city-probe", "description": "Join before the local morning message",
  "seed": 1, "days": 1,
  "personas": [{ "ref": "member", "age": 30, "join": { "day": 0, "hour": 9, "minute": 30 } }],
  "actions": [{ "at": { "day": 0, "hour": 10 }, "do": "say", "persona": "member", "text": "Hello from my home city." }],
  "expectations": []
}
```

Inspect `runScenario(...).world.records` for its `join` and `scenario/say`
timestamps. This probe has no declarative expectations; its pass/fail grade is
not evidence. The integration assertion above checks the observed behavior.

A wider paired measurement used seeds 1–120, the same six variants, three-day
runs, and join day `seed % 2`: **720 worlds per revision**. Both revisions used
identical scenario names (`join-clock-<variant>`), inputs, and network seeds.
The before run used a separate clean checkout of the base. SHA-256 comparisons
covered all event records except `run_end.wallMs`, all personas, and all metrics.
Raw synthetic logs remain local; no member data is used.

| Observation | Base | Fixed |
| --- | ---: | ---: |
| Joins at the wrong local time, after the 10:00 action | 108 | 0 |
| Other worlds with correct joins | 612 | 612 |
| Invariant violations across all 720 worlds | 0 | 0 |
| Runtime errors across all 720 worlds | 0 | 0 |

The 108 affected worlds are the two generated-home-city arms on 54 NYC seeds.
All 612 control event traces and metrics are identical. Persona contents are
identical in all 720 pairs. All 108 corrected worlds have changed metrics,
reflecting the actual new event timing; this is not a matching-quality gain.
These are paired deterministic results, not a statistical confidence interval.

## safety_gates and qualification

`bun run sim --only network --json <output>`: **61/61 blocking gates pass**, two
tracked records on target. All **63 gate records** are identical before and
after, excluding elapsed time. The base's 156.0-second result is reused from
the measured `a0ed7bc` run for the drop-notification contribution; the new head
run takes 184.6 seconds. No fixture, expected fingerprint, threshold, or judge
is changed. The existing JSON fixtures explicitly supply their persona cities.

All four `bun run typecheck` configurations pass. Qualification used PostgreSQL
16.15 on the dedicated local port 54339, with `REQUIRE_PG=1` and provider,
live-send, and deployment flags cleared:

- `bun run test:integration`, including the security suite: **676 pass, 8 skip,
  6 fail**, 13,742 assertions, 453.90 seconds. The six failures exactly match
  the recorded base names and causes: Wrangler's `/bin/bash` lookup on Windows,
  the boot test's SIGTERM exit 143 versus expected 0, and four native-path
  comparisons for `.well-known/agent-skills/index.json` in the site-build tests.
  This suite is not claimed green. The eight optional reconciliation cases
  skipped as in the base. No PostgreSQL case was silently accepted without PG.
- `bun run test:e2e`: **42 pass, 1 skip, 0 fail**, 654 assertions, 35.86 seconds.
  The optional browser/SDK recovery case is skipped; it is not a qualified
  browser-client result.

The task-owned PostgreSQL cluster had zero other client connections after the
suites and was stopped. These are local results; hosted CI remains a separate
qualification. No standalone second security-suite run is claimed: its files
ran in the full integration command, and no security path was edited.

No additional full `bun run sim` was run: AGENTS.md permits one full run per
agent, already consumed earlier. That earlier run is not attributed to this
revision. The affected Network block was run here without `--quick`.

## llm_evidence and agent_clients

Zero model calls and zero provider cost. This change chooses the timezone for
an event before any persona response; it makes no claim about model quality.
The qualification uses policy personas and simulated reviewers. No real-LLM
or external agent-client acceptance result is claimed.

Authoring client: Codex Desktop 26.1029.7803.0 on Windows; provider OpenAI;
the exact authoring model identifier is unavailable. Claude Code, ChatGPT,
Hermes Agent, OpenClaw, Muse, Grok bot, elizaOS, and Cursor were not tested.
Computer use was not used, as instructed by the operator.
