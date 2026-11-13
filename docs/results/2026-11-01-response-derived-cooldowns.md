# Response cooldowns follow the recipient and reply time

Date: 2026-11-01. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
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

This complements the separate delivery-status fix; it does not duplicate that change.

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

## Current relevance review

Reproduced again on 2026-11-01 against current main `a0ed7bc`.
The upstream source remains unchanged. The live queue has no replacement for this defect.
The earlier PR URL is unavailable, so its review history could not be inspected.
This branch recreates the fix with fresh contributor metadata and no old contribution commits.

## Fresh combined qualification on 2026-11-01

All seven independent fixes were tested together. Each separate branch also passes its focused regression and type checking.
Every new regression fails against unchanged main `a0ed7bc` and passes after its fix, with the same fixtures and seeds.
The base Network result below reuses the recorded run of that identical main revision.

| Check | Result |
|---|---|
| Base Network block | 61/61 blocking gates pass |
| Combined Network block | 69/69 blocking gates pass |
| `REQUIRE_PG=1 bun run sim` | 338/338 blocking gates pass; 14 tracked targets off target; 300 seconds |
| `bun run typecheck` | Pass on each branch and combined |
| `REQUIRE_PG=1 bun run test:integration` | 681 pass, 8 skip, 0 fail |
| `REQUIRE_PG=1 bun run security` | 176 pass, 0 skip, 0 fail |
| `REQUIRE_PG=1 bun run test:e2e` | 42 pass, 1 skip, 0 fail |

No simulation gate was skipped. PostgreSQL 16.10 ran in an isolated synthetic test cluster on localhost port 54339.
Integration skips are the existing optional cleanup-reconciliation tests.
The end-to-end skip is the existing security-feedback SDK recovery test.
Network invariant violations, minor contacts, canary leaks, and errors remain zero.
No safety threshold was changed. Tracked targets are not counted as passes.

The combined scope corrects history and recall, so record fingerprints can change.
The ten-day seed-3 fingerprint is `7f24b1663d905a96`; consent-versus-push is `d060a27d2d63c0d0`.
Base fingerprints are `24bb81f068060b33` and `361f8cc2648fb9a6`, respectively.
No byte-identity guarantee is claimed for the combined changes.

Real-model evidence and external agent-client qualification remain unfulfilled.
The changed calculations invoke no model. No production service, live send, or deployment was used.
