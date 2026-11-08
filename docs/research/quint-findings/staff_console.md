# Quint findings: staff_console

Model: [quint/staff_console.qnt](../../../quint/staff_console.qnt). Plan: section 6.15 of
[2026-11-07-state-machines.md](../2026-11-07-state-machines.md). Source reports:
[observatory.md](../state-machines/observatory.md) and [gap-console-client.md](../state-machines/gap-console-client.md).

Hand-written: this file and the model. Generated: the check output and the traces (Quint 0.33.1, Rust
simulator, seed 0x5eed; Apalache through `quint verify`, OpenJDK 21).

## 1. Final state

The model follows the code on branch `wave2/staff_console` after the wave 2 fixes. `safety` holds in the
simulator and in Apalache. Every witness is reachable. Two invariants stay out of `safety`, each as its own
named value with a comment that gives the defect id and the reason:

| Value (not in `safety`) | Register | Why it stays out |
|-------------------------|----------|------------------|
| `inv_declinedMeansDeclined` | SD-282 | Skipped: needs a privacy and data-retention decision (see section 4). The simulator still finds the violation (10 steps); `forgetTest` replays it. |
| `inv_tickRunImpliesAllowedAndStored` | SD-088 | Refuted in the register: production keeps peon local-only by deployment, outside this model. The model breaks it only when the peon registry row is an input `true` (6 steps); `peonGateTest` replays it and `peonRegistryOffTest` shows that it holds with the row false. |

In place of the second one, `safety` has `inv_tickRunImpliesRegistry`: the service runs matching only for an app
whose registry row allows it (service.ts:1809-1817). That is what the service promises.

The first model had one invariant `holds` (the six that held then). It is gone: `safety` is now the regression
check.

## 2. Checks run

```
bun run quint:check quint/staff_console.qnt            # max-steps=14 max-samples=20000
ok   typecheck
ok   test                      (35 run tests pass)
ok   safety                    (simulator: 20000 samples, 14 steps, no violation)
ok   witness_reviewThroughConsole, witness_revealWithAuditRow, witness_revealedRead, witness_socketOpen,
     witness_sourceServes, witness_photosShown, witness_photoReleased, witness_caseClosed,
     witness_commandRan, witness_matchingRan, witness_projectionDone, witness_outcomeUnknown,
     witness_holdThisApp       (13 of 13 reachable)

bun run quint:check --verify quint/staff_console.qnt   # verify-steps=6
ok   verify safety             (Apalache, 6 steps, no violation, about 315 s)
```

I kept `verify-steps=6`: Apalache takes about 5 minutes at 6 steps on this machine, so a higher bound is not
fast. One run of `--verify` stopped with "Connection dropped" while another Apalache server ran on the machine;
the run after it passed. The two values out of `safety` were checked alone with the simulator (same seed and
bounds): both are violated, as section 1 says.

New witnesses: `witness_outcomeUnknown` (a timeout reads as "unknown", SD-288) and `witness_holdThisApp` (a
one-app hold says "this app", SD-070) show that the fixed paths are reachable.

## 3. Defects and what changed in the model

### 3.1 Fixed and modeled

Each row names the action that changed, the run test that replays the old trace with the fixed result, and the
code test of the fix.

| Id | Fix | Model change | Run tests | Code test |
|----|-----|--------------|-----------|-----------|
| SD-084 | cd612bc | `readMember`: `revealFor` asks for safety now and drops the grant when the role is gone. | `revealEndsOnRoleChangeTest` | packages/observatory/test/reveal-role.test.ts |
| SD-247 | e662d5f | `unreveal`: the client drops its grant only when the server has none after the call (200 or 404). | `endRevealRefusedKeepsItTest`, `endRevealUnreachedTest`, `endRevealTest` | packages/observatory/test/reveal-end-ui.test.tsx |
| SD-135 | 88d4d88 | `serviceApply`: every kind (review, hold, leak, relay text) writes its "requested" row first; a failed write stops the action. | `relayTextNeedsServiceRowTest`, `leakNeedsServiceRowTest` | packages/network/test/staff-audit-first.integration.test.ts |
| SD-288 | 084f060 | `consoleTimeout`: result "unknown" (code `service_timeout`), not "fail". `inv_consoleSaysServiceDoes` lets "unknown" pass. | `timeoutAfterCommitTest` | packages/observatory/test/service-timeout.test.ts |
| SD-083 | bedc81f | `sourceInit` and `sourcePoll` share `checkThenLoad`: a check that throws leaves the source "unchecked" and reads nothing; the next poll checks again. | `loginCheckFailsClosedTest`, `loginCheckRetryServesTest` | packages/observatory/test/real-login-check.test.ts |
| SD-082 | 546743b | `agePoll`: a failed state view or events read fails the load, and the last good age view stays. `netAtPoll` changes only on a good read. | `ageReadErrorTest`, `ageEventsErrorTest` | packages/observatory/test/real-age-view.test.ts |
| SD-071 | d8fa61c | `agePoll` and `reloadRoles` close the photo panel when the console age view says minor or the staff member loses safety (new field `photosBy`). | `photosLeaveAfterMinorTest`, `photosLeaveAfterRoleLossTest` | packages/observatory/test/member-photo-gate-ui.test.tsx |
| SD-068 | d8b34a1 | `switchApp` remounts SafetyCases: the rows and a typed note go, and Close waits for the new app's data. | `crossAppCloseTest` | packages/observatory/test/safety-case-scope-ui.test.tsx |
| SD-466 | 2bf14c3 | `pollSafety`: a failed read (network error or 5xx) keeps the last good data and the note. | `failedPollTest` | packages/observatory/test/safety-poll-failure-ui.test.tsx |
| SD-070 | 85083c4 | `pressHold`: the text says "every app" only for safety@* or admin@*, the same rule as the service. | `holdScopeTextTest`, `holdEveryAppTest` | packages/observatory/test/safety-hold-scope-ui.test.tsx |
| SD-285 | ab37c2a | `modeSwitch`: the new mode's source starts first; a failed start leaves the mode and the source cache as they were. `inv_modeHasRunningSource` is now the stronger "the mode's source is ready". | `modeSwitchFailKeepsModeTest` | packages/observatory/test/mode-switch.test.ts |
| SD-286 | 4d794bc | `controlRun` runs in the mode that the checks saw (`seen`). | `modeHeaderRaceTest` | packages/observatory/test/mode-header-race.test.ts |
| SD-122 | 83990e2 | New `overviewMatching`: the stored switch first. `inv_consoleShowsGate` is now "the overview says on exactly when the stored switch is on" (the old form spoke about the service state, not the overview). | `peonGateTest`, `peonRegistryOffTest` | packages/observatory/test/matching-gate-status.test.ts |
| SD-246 | e6daa04 | `switchApp` remounts Config: the armed switch and the data go; `pressSwitch` needs data. | `armedSwitchCarriesTest` | packages/observatory/test/config-app-switch-ui.test.tsx |
| SD-470 | 0f9fc3d | `clientAnswer`: a 401 opens the prompt only for the token in use. | `late401Test`, `current401Test` | packages/observatory/test/late-401-token-ui.test.tsx |
| SD-287 | 3e7d55f | `loadPreview`: refused only when `until <= now`; the console keeps `min(until, now + 5 min)`. | `previewSkewTest` | packages/observatory/test/held-photo-skew.test.ts |
| SD-279 | a26ec66 | `netClose` gives CANCELLED for a booked plan; `worldOutcome` does not change a terminal state. | `closedBookedPlanCancelledTest` | packages/observatory/test/booked-plan-close.test.ts |
| SD-281 | 7e51cf3 | `forgetPoll` sets exactly the database's edges. | `forgetTest` | packages/observatory/test/real-forget.test.ts |
| SD-505 | 5afecd3 | `dvSnapshot` applies only deltas with a version above the state's. | `deltaOnceTest` | packages/observatory/test/delta-at-snapshot-version-ui.test.ts |
| SD-283 | 93a99b8 | No transition change: the model had no age check facet and already let a stated adult through (`loadPhotos`). The comment now says that this is the code. | - | packages/observatory/test/slop-photo-gate.test.ts |

### 3.2 Fixed, outside the model

These fixes are in the code with their tests. The model has no state for them (the first model's section 4 gave
the reasons), so no action changed.

| Id | Fix | Why the model has no state for it |
|----|-----|-----------------------------------|
| SD-245 | b33a19c | Member views per credential: the model has one token history and no panel identity. |
| SD-290 | 7890129 | Start-time configuration (audit log kind in staging and production). |
| SD-293 | 074f60d | Start-time configuration (local databases with a remote service). |
| SD-291 | ac1b0b3 | A read through the cross-app login for the cost total: no transition. |
| SD-467 | 6b51db7 | Header byte encoding of a reason: the model treats the reason as given. |
| SD-468 | 87f50b2 | Ban buttons by role: the service already refused, so no bad state existed. |
| SD-471 | 532bd3a | Client search form: display only. |
| SD-472 | e9055fe | Game-only forms: display only. |
| SD-500 | fdfa55a | `updated_at` column mapping, not a transition of this model. |
| SD-501 | 92b156c | Attendance column mapping, not a transition of this model. |
| SD-510 | be92e57 | The console reads the state again after a refused action: a display lag, no safety property. |

### 3.3 Not reproduced

| Id | Why |
|----|-----|
| SD-301 | A static fact about types (state values that nothing writes in COLUMNS and STATE_GROUPS). No flow goes wrong; the model leaves it out. |
| SD-499 | Not found in game mode (seeds 1-6, 28 days, about 500 opportunities per seed). `inv_terminalAbsorbing` holds in `safety`; after the SD-279 fix the one real trigger (an outcome after a close) leaves the state terminal, and `closedBookedPlanCancelledTest` checks it. |

### 3.4 Skipped

| Id | Reason | In the model |
|----|--------|--------------|
| SD-282 | Needs a privacy and data-retention decision: the forget path stores a member who left and an under-13 decline the same way (id only, name null, `removed`), so the console cannot tell them apart without a new kept fact (docs/network.md 6.3). | `inv_declinedMeansDeclined`, out of `safety`; `forgetTest` shows the violation. |
| SD-244 | A new console control ("Clear minor signal" without an open report) is a UI addition that touches minor safety; the founder or a maintainer must decide. Fails on the safe side. | Not modeled (a missing button, not a reachable bad state). |
| SD-284 | New buttons for held reports and cases without a report (UI addition) and a report status after a lift that does not exist yet. | Not modeled (missing buttons). |
| SD-322 | Founder decision: per-app review expiry or a different alert threshold. | Not modeled here (the review machine, quint/opportunity.qnt). |
| SD-469 | Founder decision: no written rule needs a note to lift a hold. | No invariant (no rule). |
| SD-473 | Copy change of the env banner; the rules forbid copy changes. | Not modeled (display only). |

## 4. Not in `safety`, with the reason

- **SD-282** (`inv_declinedMeansDeclined`): the code is still wrong for the rule in the real.ts comment, and the
  fix waits for a privacy and data-retention decision. The counterexample is real: `forgetMember` writes the
  same row as an under-13 decline (runtime.ts:520-545), and `forgetPoll` reads it as declined (real.ts:334-336).
- **SD-088** (`inv_tickRunImpliesAllowedAndStored`): the register refutes it. The service checks only its own
  registry row, and the console's pack list is not the service's gate. Production keeps peon local-only by
  deployment, which the model does not hold.

## 5. New findings

None.
