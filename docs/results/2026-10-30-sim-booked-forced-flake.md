# Scripted flakes apply to meetings already booked

Date: 2026-10-30. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Scope: PRD 34.3 scripted group flakes and the hidden-truth attendance model.

## Problem and cause

The `force_flake` action set a future decision flag but did not change a booked member's cached attendance decision.
The morning check returned early when that cached decision still said the member would attend.
A scripted no-show after booking therefore attended the meeting normally.
An action after the morning check also had no remaining check that could send its notice.

## Fix and alternatives

Bind a forced flake to the next booked meeting, invalidate its cached attendance decision, and schedule its check.
For a late action, run the check at the current simulated time.
Keep the forced mode until the meeting outcome consumes it.
A forced silent no-show cannot turn into a cancellation when a reminder arrives.
The policy agent respects the targeted proposal when reading the forced flag.

The optional memory field identifies that meeting. The World and policy agent both need it to preserve the one-shot behavior.

1. Updating only the cached attendance would miss late notices and could allow reminders to turn a no-show into a notice.
2. Clearing every pending proposal would change unrelated future commitments rather than the next meeting.

## measurement

One simulation gate uses the existing six-person group-flake scenario and seed 21.
It removes the pre-booking forced action and waits until the real baseline network has booked the dinner.
At 2026-10-06 18:00 UTC, `dinner-1` has accepted and plans to attend.
The meeting is scheduled for 2026-10-09 02:00 UTC.
Each arm runs the same World, baseline network, policy persona agent, and five-day horizon.

| Action after booking | Before | After |
|---|---|---|
| No forced action, control | Attends | Attends |
| Force cancellation with notice | Attends without the forced notice | Does not attend; gives notice |
| Force silent no-show | Attends | Does not attend; gives no notice |
| Force notice two hours before the meeting | Attends without the forced notice | Does not attend; gives notice |

The gate reads actual outcome records and verifies that the one-shot flag is cleared after the meeting.
Fixtures are hand-written; no model output is mocked.
This deterministic scenario check needs no confidence interval.

## safety_gates

The new gate runs in `bun run sim --only network`.
It fails against the base World and policy agent, and passes with this fix. `bun run typecheck` passes on this independent branch.
No production matching, scheduling, age, consent, review, or leak policy changes.
No member-facing text or dependency changes.

## llm_evidence

This scripted attendance path invokes no language model. No real-model qualification run was made.
No provider key is configured; the project's general real-model evidence requirement remains unfulfilled.
Model test calls and cost are zero. Test provider, model, and request settings: not applicable.

## agent_clients

No member-facing agent workflow changed or was tested in an external client.
Reproduction runtime: Bun 1.4.2 on macOS arm64.
Authoring: OpenAI `gpt-6.1-sol`, Codex desktop; model selection reported by the operator.
Exact authoring client version is unavailable. This is self-reported attribution.

## Reproduce and limits

Run `bun run sim --only network`. Expect all four forced-flake arms to pass.
Run `bun run typecheck`. Expect exit zero.
Actions before booking retain their existing next-opportunity behavior.
Actions after booking target the earliest upcoming meeting that contains the member.
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
