# Response cooldowns follow the recipient and reply time

Date: 2026-10-30. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Requirement: PRD 33.5 member cooldowns and 34.3 reproducible simulation history.

## Problem and cause

An expired interaction applied a category cooldown to every proposed participant.
With sequential invitations, the second member could receive a penalty without ever receiving an invitation.
The simulator also dated a declined interaction at proposal creation, rather than the member's reply.
A late refusal therefore lost part of its seven-day cooldown immediately.

## Fix and alternatives

For expired records with known response history, apply the cooldown only to `noResponse` members.
An explicit empty list means nobody failed to reply. Preserve the old fallback for legacy records without that field.
The simulator emits an explicit list on expired interactions and records the latest recognized decline time.
The seven-day limit, pair rules, and other eligibility checks are unchanged.

1. Removing expiry cooldowns entirely would allow repeated contact with genuinely unresponsive members.
2. Using the current snapshot time would restart cooldowns on every snapshot and hold members indefinitely.

This complements PR #255's delivery-status fix; it does not duplicate that change.

## measurement

One regression gate uses two five-day worlds, seed 83, and two adult NYC members.
The baseline network sends the first invitation only. Both members stop automatic replies at noon on day zero.
One arm stays silent; the other sends a real scripted refusal on day two.
The test feeds actual run records through history reconstruction and the engine's member eligibility checks.

| Check | Before | After |
|---|---|---|
| Cooldown for uncontacted member | Applied | None |
| Cooldown for contacted, silent member | Applied | Applied |
| Decline timestamp | Proposal creation | Actual refusal |
| Decliner six days after refusal | Cooldown already ended | Still held by the unchanged seven-day rule |
| Explicit empty nonresponder list | Penalizes everyone | Penalizes nobody |
| Legacy record without recipient history | Existing fallback | Same fallback |

The gate fails on the base implementation and passes with the fix.
Both runs use the same scenarios, seed, commands, and data. No statistical confidence interval applies.

## safety_gates

Run `bun run sim --only network` for the regression and existing safety gates.
The focused gate and `bun run typecheck` pass on this independent branch.
No age, consent, review, blocking, leak, or budget limit changes.
The pending delivery-status PR remains independently scoped.

## llm_evidence

No model participates in these calculations. No real-model qualification run was made.
No provider key is configured; the project's general real-model evidence requirement remains unfulfilled.
No model output is mocked. Test model calls and cost: zero; provider and request settings: not applicable.

## agent_clients

No agent-client interface or member-facing copy changed. No external agent client was qualified.
The reproduction uses Bun 1.4.2 on macOS arm64 and the actual baseline network, simulated channel, and policy persona agent.
Authoring: OpenAI `gpt-6.1-sol`, Codex desktop; model selection is operator-reported.
The exact client version is unavailable. Attribution is self-reported.

## Reproduce and limits

Run `bun run sim --only network` and expect the response-cooldown gate to pass all its controls.
Run `bun run typecheck` and expect exit zero.
Legacy histories without recipient metadata retain their conservative fallback.
No live sends, production data, deployment, usage collection, or private trace upload were involved.
