# Shared-area scoring follows the proposed meeting window

Date: 2026-11-01. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Requirement: PRD 13.1 time-bounded presence and 33.6 geographic activation cost.

## Problem and cause

The shared-area score collected every neighborhood ever listed for a member.
It ignored the dates on visits and whether both members could be there together.
A visit next week lowered tomorrow's activation-cost penalty from 0.3 to 0.1.
This term is a unitless ranking penalty, not a monetary or measured transit cost.

## Fix and alternatives

Pass the candidate's meeting window into the geography hook.
Build neighborhood availability intervals using the same dated-presence override model as city presence.
Apply the shared-area discount only when all members' intervals overlap in one neighborhood.
Friends delegates the window to the shared city model. Callers without a window use the current instant.
Radius-based packs keep their existing coarse-cell policy.

1. Filtering at the current time would still reject legitimate visits during a future meeting window.
2. Keeping any visit overlapping the window would admit disjoint visits where the members never share the neighborhood together.

The hook argument is optional. No score weight or eligibility threshold changes.

## measurement

One simulation gate scores the same two-member candidate with the Network and Friends packs.
It uses the existing random-world generator, seed 83, local embeddings, and the real scoring pipeline.
The members' home neighborhoods differ. The meeting is tomorrow and lasts two hours.
Only the dated presence records change between arms.

| Added presence | Before penalty | After penalty |
|---|---|---|
| No shared area | 0.3 | 0.3 |
| Shared-area visit after the meeting | 0.1 | 0.3 |
| Shared-area visit ending at the meeting start | 0.1 | 0.3 |
| Shared-area visit covering the meeting | 0.1 | 0.1 |
| Shared neighborhood only during disjoint intervals | 0.1 | 0.3 |

Every other score component remains identical to the corresponding baseline.
The gate fails on the base scoring path and passes with the fix.
Fixtures and candidate are hand-written around generated profiles. No model output is mocked.
This deterministic check uses the same seed and data before and after; confidence intervals do not apply.

## safety_gates

Run `bun run sim --only network` for this gate and the existing safety checks.
The focused gate and `bun run typecheck` pass on this independent branch.
The hard presence-overlap filter remains separate and unchanged.
No age, block, consent, review, leak, budget, or minimum overlap limit changes.

## llm_evidence

The changed geography calculation invokes no model. No real-model qualification run was made.
No provider key is configured; the project's general real-model evidence requirement remains unfulfilled.
Model test calls and cost are zero. Test provider, model, and request settings: not applicable.

## agent_clients

No member-facing agent interface changed. No external agent client was qualified.
Reproduction runtime: Bun 1.4.2 on macOS arm64.
Authoring: OpenAI `gpt-6.1-sol`, Codex desktop; model selection is operator-reported.
The exact client version is unavailable. Attribution is self-reported.

## Reproduce and limits

Run `bun run sim --only network` and expect both packs to pass the meeting-locality gate.
Run `bun run typecheck` and expect exit zero.
Neighborhood presence remains coarse and permission-based. No travel-time precision is claimed.
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
