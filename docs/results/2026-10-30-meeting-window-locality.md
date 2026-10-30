# Shared-area scoring follows the proposed meeting window

Date: 2026-10-30. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
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
