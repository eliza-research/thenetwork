# Restore reviewed second encounters after check-ins

## Problem and requirement

PRD F19 requires mutual positive outcomes to become second-encounter candidates. In the real Network flow, two people say the meeting was great, but no engine follow-up reaches review. Explicit mutual "meet again" requests already work through `localEncounters`.

Two handoffs fail. Check-ins create interactions like `player-15:fb:a`, while feedback names `player-15`. The generator compares those IDs directly. Once that is fixed, the host still rejects the proposal as `pair_history` because the people already met.

This is a reproduced defect in the approved scope. Other PR #217 changes the repetition score; it does not repair either handoff here. Earlier #187 repairs the separate Friends repeat generator.

## Change and alternatives

Resolve the existing reply suffix when the generator looks up meeting feedback. Preserve the interaction ID used as the proposal anchor. At the host, allow completed-meeting history only for the two-person Network `second_encounter` kind and generator with an interaction or event anchor. Prior declines, no-shows, blocks and avoid edges still apply. Every other score, profile, eligibility, review and consent check stays in place. An explicit mutual "meet again" keeps the existing member-request path.

`pairHistory` gains an optional repeat flag, false at all other existing call sites. Remove the now-unused `metRecently` helper. No schema, copy, deployment, dependency or LLM change.

Requiring explicit repeat keywords leaves normal positive feedback disconnected from F19. Removing the completed-pair exclusion for every proposal permits unwanted repeats. Keeping the exception with the named repeat generator preserves the other callers' behavior.

## Revisions and method

- Base `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`; code `a40c773a937fb8382c54151cbe19b2b9c5af6e58`.
- Combined local code `1778ed24ee17dfc9d2cddb1afd28ae33a5d92b68`, never pushed.
- Native Windows, Bun 1.4.2, local PostgreSQL 16.15 on 54339.
- Same `bun run sim --only network --json <output>` method and pinned seeds before and after.
- One new gate: seeds 1, 2, 3 by 11 scenarios, 33 fresh worlds. Real ConsentNetwork, normal networkPack, nightly engine and recording channel. Synthetic adult members; manual simulated staff review. Ordinary existing world gates use their documented simulated reviewer.
- Onboarding → first reviewed meeting → both consent → check-ins → JSON restart → nightly follow-up → second review → fresh consent. No engine proposal, positive feedback or booking result is injected into the regression.

## Measurement

Correct scenarios: **21/33 → 33/33**. All 21 control rows are identical. Each seed gives the following follow-up review items / second bookings:

| Scenario | Before | After |
| --- | --- | --- |
| mutual | 0 / 0 | 1 / 1 |
| one-sided | 0 / 0 | 0 / 0 |
| negative | 0 / 0 | 0 / 0 |
| no-feedback | 0 / 0 | 0 / 0 |
| blocked | 0 / 0 | 0 / 0 |
| prior-rejection | 0 / 0 | 0 / 0 |
| no-show | 0 / 0 | 0 / 0 |
| blocked-before-approval | 0 / 0 | 1 / 0 |
| review-rejected | 0 / 0 | 1 / 0 |
| fresh-no | 0 / 0 | 1 / 0 |
| explicit-again | 1 / 1 | 1 / 1 |

The three ordinary mutual-positive cases gain a second booking. All nine cases with a reviewer rejection, new refusal or block before approval remain unbooked despite gaining a review item. No follow-up message or second booking occurs before review. Explicit mutual repeat requests retain their original origin and outcome. These deterministic cases prove the flow; they are not a statistical claim about overall matching quality.

```text
FAIL: 61/62 blocking gates, 0 tracked off target, 229.3s (network 229.3s)
PASS: 62/62 blocking gates, 0 tracked off target, 250.5s (network 250.5s)
PASS: 70/70 blocking gates, 0 tracked off target, 287.1s (network 287.1s)
```

Standalone prior records: 62/63 identical, excluding runtime. Changed records:

All pre-existing blocking gates and their recorded metrics are identical. The whole-arm fingerprint changes; this report does not claim an aggregate matching-quality improvement.

| Existing record | Before | After |
| --- | --- | --- |
| fingerprint: consent vs push arms | 361f8cc2648fb9a6 | 4a8f1bfff5e97077 |

Combined prior records: 70/71 identical. Comparison uses the previously passing Network block from `booking-history-combined.json`; that older artifact's separate Slop failure is not a Network result. The 33 new combined rows exactly match standalone.

| Existing record | Before | After |
| --- | --- | --- |
| fingerprint: consent vs push arms | cb4a73ef9dae60f2 | 3eafe30f421ad398 |

## Safety and service validation

PostgreSQL safety: **17/17 before and after**, every gate record identical apart from runtime. All four typecheck configurations pass before, after and combined. No production send or deploy flag was set.

Integration, including security:

```text
675 pass
8 skip
6 fail
13741 expect() calls
Ran 689 tests across 68 files. [485.74s]
```

The six existing Windows failures are `/bin/bash` launch, backend SIGTERM exit 143 instead of 0, and four site artifact path comparisons. Separate drafts #234 and #223 fix the launcher and site comparisons. They are not included in this independent standalone branch. Eight skips are existing opt-in cleanup and hooks. Full integration is not green.

E2E:

```text
42 pass
1 skip
0 fail
654 expect() calls
Ran 43 tests across 3 files. [51.15s]
```

The one skip requires the optional browser module. PostgreSQL suites ran sequentially. No new full simulation run: the repository's one-full-run allowance was used earlier; this change reruns the affected Network block and safety block.

## Iterations and compatibility

The first 24-case reproduction was 15/24 correct. Fixing the generator alone remained 15/24 in the workflow because the host rejected the generated proposal. After fixing both handoffs, add the prior-rejection, no-show and late-block cases, restore production to exact main, and rerun the final 33-case baseline before validation.

The combined cherry-pick reconciles the shared `pairHistory` helper with #187 and retains its Friends behavior. An initial local test insertion accidentally copied the existing world initialization twice; simulation startup and typecheck rejected the duplicate declarations. Remove only that duplicate setup, then rerun the combined Network block and typecheck. No old assertion was changed. The standalone branch never contained the duplicate.

## Reproduce and limits

```powershell
bun run sim --only network --json ../second-encounter.json
bun run typecheck
```

Expect 62/62 blocking gates on this branch, including the new 33-case gate. To reproduce the failure, retain the gate and restore only `packages/engine/src/packs/network/generators.ts` and `packages/network/src/network.ts` from base: expect 61/62, with 21/33 new cases correct.

With the repository's local PostgreSQL configured on 54339, `REQUIRE_PG=1`, `PG_BIN_DIR`, `OBSERVATORY_PG_DIR`, and `OBSERVATORY_PG_PORT` set:

```powershell
bun run sim --only safety --json ../second-encounter-safety.json
bun run test:integration
bun run test:e2e
```

Real-LLM evidence: N/A, deterministic matching and host workflow; 0 validation model calls, $0. Agent clients: N/A, no external agent-client flow changes or acceptance claim. Authoring: OpenAI `gpt-6-astra`, Codex; installed app package 26.1023.6621.0. Linux/macOS were not run locally. Hosted CI and maintainer review remain required.
