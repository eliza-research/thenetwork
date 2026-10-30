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

## Traveler recall extension

The recall denominator also used home cities instead of actual presence (PRD 34.4).
A compatible NYC resident and SF visitor were omitted, even while both could meet in NYC.
Two NYC residents visiting SF were also omitted because evaluation used their empty home city.

Enumerate each persona's currently available cities with the existing `presentIn` rule.
Evaluate shared cities until one compatible opportunity is found, then count the pair once.
Keep the pair identifier, chemistry, relationship exclusion, and adult-only policy unchanged.
Checking only home cities loses visitors. Counting each shared city would inflate the denominator.

One additional gate runs four complete two-day worlds with seed 83 and two synthetic adults.
The same fixture and command run before and after the recall change.
The original common-presence fix remains present in the before version.

| Recall arm | Before pairs | After pairs |
|---|---|---|
| NYC resident and visiting SF resident | 0 | 1 |
| Visitor returned before measurement | 0 | 0 |
| Both NYC residents visiting SF | 0 | 1 |
| Both available in NYC and SF | 1 | 1 |

Each arm checks the actual World `latent_opportunities` record against the oracle verdict.
Pair quality remains above 0.9. The returned visitor stays incompatible in NYC.
Run `bun run sim --only network` and expect both travel gates to pass.
Focused gates pass. The change uses no model calls and adds no external client qualification.
The earlier five-patch qualification above predates this extension.

## Qualification of the cooldown, locality, and recall changes

These results combine `fix/response-derived-cooldowns`, `fix/meeting-window-locality`, and the updated `fix/sim-common-presence`.
They are one combined validation run, not three separate full-suite runs.
Each independent branch also passes its focused gate and type checking.
The Network baseline is the previously recorded run of unchanged base `a0ed7bc`.
No baseline rerun or threshold adjustment was needed.

| Check | Result |
|---|---|
| Base `bun run sim --only network` | 61/61 blocking gates pass |
| Updated Network block | 65/65 blocking gates pass |
| `REQUIRE_PG=1 bun run sim` | 334/334 blocking gates pass; 14 tracked targets off target; 354.5 seconds |
| `bun run typecheck` | Pass |
| `REQUIRE_PG=1 bun run test:integration` | 681 pass, 8 skip, 0 fail |
| `REQUIRE_PG=1 bun run security` | 176 pass, 0 fail |
| `REQUIRE_PG=1 bun run test:e2e` | 42 pass, 1 skip, 0 fail |

PostgreSQL 16.10 used an isolated synthetic test cluster on localhost port 54339.
No simulation gate was skipped. Integration skips remain the existing optional cleanup-reconciliation tests.
The end-to-end skip remains the existing security-feedback SDK recovery test.
The tracked quality targets are not counted as passes.
Network invariants, minor contacts, canary leaks, and errors remain zero.

The record fingerprints change because this scope corrects history and oracle recall.
They are recorded for transparency, not asserted as a byte-identity guarantee:

| Network fingerprint | Base | Combined |
|---|---|---|
| Seed 3, ten days | `24bb81f068060b33` | `7f24b1663d905a96` |
| Consent versus push | `361f8cc2648fb9a6` | `d060a27d2d63c0d0` |

Before/after control measurements also run every assertion without stopping at the first mismatch.
The baseline exhibits the reported recipient, timestamp, locality, and visitor-recall defects.
Every corrected control passes. No safety threshold or fixture expectation was weakened.
General real-model evidence and external-client qualification remain unfulfilled, as disclosed above.
