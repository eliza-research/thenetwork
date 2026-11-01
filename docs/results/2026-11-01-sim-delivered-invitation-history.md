# Failed invitations do not count as ignored invitations

Date: 2026-11-01. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Scope: PRD 34.3 simulator channel and outcome model; CONTRIBUTING.md 3.1 simulation correctness.

## Problem and cause

The simulated channel records delivery failures correctly.
The snapshot history nevertheless treated each failed proposal message as an invitation received by its member.
After 48 hours, it marked that member as unresponsive.
The engine consumes these records when estimating future response probabilities.
This penalized members for messages they never received.

## Fix and alternatives

Add an invitation to response history only when its delivery status is `delivered`.
Keep failed attempts in the run log for delivery analysis.

1. Removing failed messages from the log would hide channel reliability evidence.
2. Suppressing every expired invitation would discard genuine member silence.

## measurement

One simulation gate runs two complete five-day worlds using seed 83 and two adult NYC personas.
Both personas stop replying at noon on day zero. The baseline network receives a scripted coffee proposal.
The arms differ only in channel failure rate: one or zero.
Fixtures are hand-written. No model output is mocked.

| Result | Before | After |
|---|---|---|
| Failed invitation attempts | 1 | 1 |
| Unresponsive members after failed delivery | 1 | 0 |
| Delivered invitation attempts, positive control | 1 | 1 |
| Unresponsive members after delivered invitation | 1 | 1 |

The same scenario, seed, five-day horizon, and channel arms were used before and after.
This deterministic check needs no confidence interval.

## safety_gates

`bun run typecheck` passes on this independent branch.
The added gate is part of `bun run sim --only network`.
No policy threshold, gate value, member-facing text, or dependency changes.
An isolated PostgreSQL 16.10 server was used for the qualification below.

## llm_evidence

The changed history reconstruction invokes no model. No real-model qualification run was made.
No provider key is configured; the project's general real-model evidence requirement remains unfulfilled.
Model test calls and cost: zero. Provider, model, and request settings for those calls: not applicable.

## agent_clients

No member-facing agent workflow changed or was tested in an external client.
Reproduction runtime: Bun 1.4.2 on macOS arm64.
Authoring: OpenAI `gpt-6.1-sol`, Codex desktop; model selection reported by the operator.
Exact authoring client version is unavailable. This is self-reported attribution.

## Reproduce and limits

Run `bun run sim --only network` and expect the delivery-history gate to pass both arms.
Run `bun run typecheck` and expect exit zero.
The baseline network still records its own attempted sends; this change corrects the engine snapshot's response history.
No live messages, deployment, production data, usage collection, or private trace upload were involved.

## Current relevance review

Reproduced again on 2026-11-01 against current main `a0ed7bc`.
The upstream source remains unchanged. The live queue has no replacement for this defect.
The earlier PR URL is unavailable, so its review history could not be inspected.
This branch recreates the fix with fresh contributor metadata and no old contribution commits.
