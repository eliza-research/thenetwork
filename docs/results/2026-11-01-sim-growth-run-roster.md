# Growth-run results retain invited friends

Date: 2026-11-01. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Scope: PRD 34.3 persona generation and replayable run logs; 34.4 growth and member-experience measurement.

## Problem and cause

The World adds invited friends to its live persona map and logs their joins.
Its returned result and `personas.json` still used the initial constructor array.
A growth run could report two joined members but return and save only one persona.
Analysis and replay tools could not recover the roster from the documented persona artifact.

## Fix and alternatives

Build the returned and persisted persona rosters from the World's current persona map.
Keep the caller's initial array unchanged.

1. Mutating the caller's array would introduce an unrelated external side effect.
2. Repairing each analysis tool separately would leave the run artifact inconsistent.

## measurement

One simulation gate completes a one-day world on seed 83.
It starts with one adult NYC member, then spawns an invited friend one hour later through the public World growth API.
The gate reads the actual saved `personas.json` from a temporary run directory.
It checks the result roster, artifact roster, join count, and persona records against each other.
Fixtures are hand-written; the baseline network and policy persona agent run normally.

| Roster or count | Before | After |
|---|---|---|
| Joined members | 2 | 2 |
| Logged personas | 2 | 2 |
| Personas in returned result | 1 | 2 |
| Personas in saved artifact | 1 | 2 |
| Caller-owned initial array length | 1 | 1 |

Both runs use the same seed, spawn time, network, and one-day horizon.
This deterministic artifact check needs no confidence interval.

## safety_gates

The gate runs in `bun run sim --only network` and deletes its temporary artifacts afterward.
It fails against the base World and passes with the fix. `bun run typecheck` passes on this independent branch.
No matching, consent, age, review, or leak threshold changes.
No dependency or member-facing text changes.

## llm_evidence

No model participates in roster serialization. No real-model qualification run was made.
No provider key is configured; the project's general real-model evidence requirement remains unfulfilled.
No model output is mocked. Model test calls and cost are zero.
Test provider, model, and request settings: not applicable.

## agent_clients

No member-facing agent workflow changed or was tested in an external client.
Reproduction runtime: Bun 1.4.2 on macOS arm64.
Authoring: OpenAI `gpt-6.1-sol`, Codex desktop; model selection reported by the operator.
Exact authoring client version is unavailable. This is self-reported attribution.

## Reproduce and limits

Run `bun run sim --only network`. Expect both the original member and invited friend in the growth-record gate's result and artifact.
Run `bun run typecheck`. Expect exit zero.
The initial run configuration still describes the initial cohort; the completed artifact describes the full roster.
No live messages, deployment, production data, usage collection, or private trace upload were involved.

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
