# The oracle requires members to be in the city together

Date: 2026-10-30. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Scope: PRD 34.3 hidden-truth outcome model and 34.4 matching precision against the oracle.

## Problem and cause

The oracle checked whether each member could visit the proposal city sometime in its window.
Those visits did not have to overlap.
It rated an otherwise ideal NYC pair compatible when one member left as the other returned.
Such proposals could inflate measured matching precision even though the people could never meet.

## Fix and alternatives

Require at least one instant when every participant is present in the proposal city.
Check the window start and trip boundaries, where this model's presence changes.
Keep the existing seven-day lookahead and point-in-time proposal support.

1. Checking only the window start would reject valid meetings after a traveler returns.
2. Sampling hourly would add unnecessary work and could miss shorter intervals.

## measurement

One gate runs two complete four-day worlds with seed 83 and two adult NYC personas.
They have matching interests and wants. Their oracle quality is 1.0 in both arms.
One member visits SF on days 2-3. In the negative arm, the other visits SF on days 0-1.
They are each in NYC during the proposal window, but never together.
The positive control shortens the second trip to day zero, leaving one common NYC day.

| Arm | Before | After |
|---|---|---|
| Disjoint NYC presence | Compatible; no city mismatch | Incompatible; city mismatch |
| One common NYC day | Compatible | Compatible |
| Underlying pair quality | 1.0 | 1.0 |

The World records the scripted proposal and the oracle verdict in its actual run log.
Fixtures are hand-written. Both arms use the same seed, command, and time horizon before and after.
This is deterministic correctness evidence; confidence intervals do not apply.

## safety_gates

The new gate runs in `bun run sim --only network`.
It fails against the base oracle and passes with this fix. `bun run typecheck` passes on this independent branch.
No age, consent, review, blocking, or leak threshold changes.
No dependency or member-facing text changes.
Database-backed checks need a local PostgreSQL server.

## llm_evidence

The oracle calculation calls no model. No real-model qualification run was made.
No provider key is configured; the project's general real-model evidence requirement remains unfulfilled.
No model output is mocked. Model test calls and cost are zero.
Test provider, model, and request settings: not applicable.

## agent_clients

No member-facing agent workflow changed or was tested in an external client.
Reproduction runtime: Bun 1.4.2 on macOS arm64.
Authoring: OpenAI `gpt-6.1-sol`, Codex desktop; model selection reported by the operator.
Exact authoring client version is unavailable. This is self-reported attribution.

## Reproduce and limits

Run `bun run sim --only network`. Expect the oracle-travel gate to pass its negative and positive arms.
Run `bun run typecheck`. Expect exit zero.
Trips retain their existing day-based precision. Individual utility and probability formulas are unchanged.
No live messages, deployment, production data, usage collection, or private trace upload were involved.

## Combined qualification

Each new regression gate fails against the base implementation and passes on its independent fix branch.
Each independent branch passes type checking.
The broader suites below ran with all five independent simulation patches combined.
They are combined validation, not five separate full-suite runs.

PostgreSQL 16.10 ran in an isolated temporary directory on localhost port 54339.
No system PostgreSQL installation or production database was changed.

| Check | Result |
|---|---|
| Base `bun run sim --only network` | 61/61 blocking gates pass |
| Combined network block | 66/66 blocking gates pass |
| `REQUIRE_PG=1 bun run sim` | 335/335 blocking gates pass; 14 tracked targets off target; 563.2 seconds |
| `bun run typecheck` | Pass |
| `REQUIRE_PG=1 bun run test:integration` | 681 pass, 8 skip, 0 fail |
| `REQUIRE_PG=1 bun run security` | 176 pass, 0 fail |
| `REQUIRE_PG=1 bun run test:e2e` | 42 pass, 1 skip, 0 fail |

No simulation gate was skipped. The integration skips are existing opt-in cleanup reconciliation tests.
The end-to-end skip is the existing security-feedback SDK recovery test.
Tracked quality targets are not counted as passes or weakened.
Network invariant violations, canary leaks, and minor contacts remain zero.
Both network fingerprints are identical before and after:
`24bb81f068060b33` for the ten-day seed-3 run and `361f8cc2648fb9a6` for consent versus push.
