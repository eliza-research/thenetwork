# Traveler availability uses the meeting city's local time

Date: 2026-11-01. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Scope: PRD 34.3 realistic persona routines and travel; 34.4 scheduling and attendance measurement.

## Problem and cause

The availability model checked presence in the meeting city, then read the member's routine in their home city's time zone.
A San Francisco member visiting NYC treated a 7pm NYC invitation as a 4pm work-hour invitation.
This discarded valid time options and could create artificial scheduling conflicts and no-shows.

## Fix and alternatives

Interpret the routine in the meeting city's local date and hour.
Keep the existing home-city default for direct callers of `hiddenFree`.
Presence still runs before the routine check.

1. Shifting timestamps by a fixed offset would fail across daylight-saving changes.
2. Changing the member's home city would corrupt their home location and public profile.

## measurement

One gate completes a one-day world on seed 83, then runs the persona model's actual offered-time selector.
The adult traveler lives in SF, visits NYC, works 9am-5pm, and is free on weekday evenings.
Options are Monday 2026-10-05 at 7pm NYC and Tuesday at 3am NYC.
The positive control keeps the same persona home in SF.

| Choice model result | Before | After |
|---|---|---|
| NYC visitor's chosen options | None | NYC evening |
| NYC sleeping-hours option | Rejected | Rejected |
| SF resident during work/sleep hours | None | None |

The same fixture, seed, options, and selector run before and after.
The new simulation gate fails against the base availability code and passes with the fix.
No statistical estimate or confidence interval applies to this deterministic check.

## safety_gates

`bun run typecheck` passes on this independent branch.
The gate runs in `bun run sim --only network`.
The change preserves the same presence guard, random draws, sleep bounds, and routine rules.
No member-facing text, matching threshold, safety-gate value, or dependency changes.

## llm_evidence

The hidden availability model invokes no language model. No real-model qualification run was made.
No provider key is configured; the project's general real-model evidence requirement remains unfulfilled.
No model output is mocked. Model test calls and cost are zero.
Test provider, model, and request settings: not applicable.

## agent_clients

No member-facing agent workflow changed or was tested in an external client.
Reproduction runtime: Bun 1.4.2 on macOS arm64.
Authoring: OpenAI `gpt-6.1-sol`, Codex desktop; model selection reported by the operator.
Exact authoring client version is unavailable. This is self-reported attribution.

## Reproduce and limits

Run `bun run sim --only network` and expect the traveler-availability gate to pass.
Run `bun run typecheck` and expect exit zero.
The model applies the member's existing wall-clock routine locally while traveling.
It does not infer a different work schedule for a particular trip.
No live messages, deployment, production data, usage collection, or private trace upload were involved.

## Current relevance review

Reproduced again on 2026-11-01 against current main `a0ed7bc`.
The upstream source remains unchanged. The live queue has no replacement for this defect.
The earlier PR URL is unavailable, so its review history could not be inspected.
This branch recreates the fix with fresh contributor metadata and no old contribution commits.
