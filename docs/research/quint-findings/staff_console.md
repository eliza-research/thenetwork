# Quint findings: staff_console

Model: [quint/staff_console.qnt](../../../quint/staff_console.qnt). Plan: section 6.15 of
[2026-11-07-state-machines.md](../2026-11-07-state-machines.md). Source reports:
[observatory.md](../state-machines/observatory.md) and [gap-console-client.md](../state-machines/gap-console-client.md).

Hand-written: this file and the model. Generated: the check output and the traces (Quint 0.33.1, Rust
simulator, seed 0x5eed; Apalache 0.62.4 through `quint verify`).

## 1. What the model holds

One state record `s` with 16 small machines: staff-grants, pii-reveal, ws-ticket and ws-socket, staff-audit and
staff-action-relay (console and service), real-source, console-age-view and the slop photo panel,
console-fetch-scope and case rows, report hold scope, console-mode, network-matching-gate and
matching-switch-confirm, auth-prompt, held photo preview, opp-projection (game mode), real-source store
retention (forget), and client-sync (snapshot and deltas).

Bounds: 2 staff (S1 = `safety@slop` + `reviewer@slop`; S2 = `admin@*`), 2 apps (slop, peon), one member per app
(x, y; one person owns both), case id `sc1` in each app, 3 tickets, 3 deltas, 2 token changes. Time is an
integer tick.

Oracles and other actors are nondeterministic inputs: the audit sink (up or down), each database read, the
service (commit, refuse, crash), the 15 s timeout, the Network (age signals, review items, leave), the game world
(outcome records), the service clock skew (0 or 1 tick), the login fitness, real-only or not, and the peon
registry row (`platform.networks.matching_enabled`).

## 2. Check results

```
bun run quint:check quint/staff_console.qnt --verify
ok   typecheck
ok   test                      (27 run tests pass)
FAIL safety                    (expected: the model shows register defects)
ok   witness_reviewThroughConsole, witness_revealWithAuditRow, witness_revealedRead, witness_socketOpen,
     witness_sourceServes, witness_photosShown, witness_photoReleased, witness_caseClosed,
     witness_commandRan, witness_matchingRan, witness_projectionDone   (11 of 11 reachable)
FAIL verify safety             (Apalache, 6 steps: counterexample in 7 s)
```

Each invariant alone (simulator, 20000 samples, 14 steps; Apalache where noted):

| Invariant | Result | Register |
|-----------|--------|----------|
| `inv_revokedNoData` | violated (Apalache, 5 steps; simulator does not find it) | SD-084 |
| `inv_revealAudited` | holds | - |
| `inv_revealBound` | holds | - |
| `inv_revealShownTruly` | violated, 9 steps | SD-247 |
| `inv_socketAuthorized` | holds | - |
| `inv_auditFirst` | violated, 9 steps | SD-135 |
| `inv_consoleAuditFirst` | holds | - |
| `inv_consoleSaysServiceDoes` | violated, 10 steps | SD-288 |
| `inv_servedOnlyCheckedLogin` | violated, 8 steps | SD-083 |
| `inv_ageFailClosed` | violated, 11 steps | SD-082 |
| `inv_photosOnlyAdults` | violated, 14 steps | SD-071 |
| `inv_actionTargetsSelectedPerson` | violated, 14 steps | SD-068 |
| `inv_failedPollKeepsInput` | violated, 7 steps | SD-466 |
| `inv_successTextMatchesScope` | violated, 3 steps | SD-070 |
| `inv_modeHasRunningSource` | violated, 12 steps | SD-285 |
| `inv_commandRunsInSeenMode` | violated, 9 steps | SD-286 |
| `inv_consoleShowsGate` | violated, 3 steps | SD-122 |
| `inv_tickRunImpliesAllowedAndStored` | violated, 10 steps | SD-088 (see 3.13) |
| `inv_confirmMatchesApp` | violated, 13 steps | SD-246 |
| `inv_promptOnlyForBadToken` | violated, 14 steps | SD-470 |
| `inv_previewRefusalTrue` | violated, 14 steps | SD-287 |
| `inv_releaseBySameStaff` | holds | - |
| `inv_projectionRefines` | violated, 8 steps | SD-279 |
| `inv_terminalAbsorbing` | holds | SD-499 not reached |
| `inv_forgetClosure` | violated, 13 steps | SD-281 |
| `inv_declinedMeansDeclined` | violated, 13 steps | SD-282 |
| `inv_feedExact` | violated, 9 steps | SD-505 |
| `holds` (the six that hold) | no violation: simulator, and Apalache 6 steps (214 s) | - |

No violation is a model error: I mapped each counterexample to the code below.

## 3. Counterexamples (short form) and the code

The run tests in the model replay each trace. The simulator traces are longer versions of the same paths.

### 3.1 SD-084: a PII reveal survives a role change (`revealSurvivesRoleChangeTest`; Apalache 5 steps)

```
revealPost(S1, slop, audit up)        reveal x until now+15 min
revokeGrant(S1, safety, slop)         admin removes the grant
reloadRoles(ok)                       copy = S1 reviewer@slop only
networkReview(x, open)                x is in an open review item
readMember(S1, slop)                  revealed = true, safetyNow = false
```

Code: `revealFor` checks only the key and the time (packages/observatory/src/server.ts:406-410); `/api/member/:id`
passes `reveal: !!grant` (server.ts:482-486); `canSeeMember` lets a reviewer see x (server.ts:415-420). The same
holds for `/timeline` (server.ts:499) and `/app` (server.ts:510).

### 3.2 SD-247: "End" hides a reveal that the server keeps (`endRevealFailsTest`)

```
revealPost(S1, slop) ; revokeGrant(S1, safety, slop) ; reloadRoles(ok)
unreveal(S1, slop, reached)           DELETE answers 403; client drops the grant
```

The simulator also finds it with `reached = false` (a network error). Code: web/store.ts:547-551 (`unreveal` ignores
the answer and always filters `this.reveals`, line 549); server DELETE needs safety (server.ts:581-588).

### 3.3 SD-135: service staff actions that act before their audit row (`relayTextAuditAfterTest`)

```
consoleSend(relayText, console row ok)
serviceApply(commit, service audit down)   effect {kind relayText, rowBefore false}
```

The simulator finds the same for `leak`. Code: relay text decision runs at packages/network/service/service.ts:2461
and writes its only row at 2466-2467; the leak decision runs `decideLeak` and `deliver` at service.ts:2336-2340 and
writes its row at 2341-2342. Compare `staffAction` and `audited` (service.ts:1519-1526, 1765-1773): row first, and
a failed write stops the action (`holdNeedsServiceRowTest` shows this path holds). The console's own row
(server.ts:180) is first, so `inv_consoleAuditFirst` holds; a call to the service that does not come through the
console has no row before the action.

### 3.4 SD-288: a timeout after commit reads as failure (`timeoutAfterCommitTest`)

```
consoleSend(hold) ; serviceApply(commit) ; consoleTimeout   console "fail", service "committed"
```

The simulator also finds the order `consoleTimeout ; serviceApply(commit)`: the service commits after the console
gave up. Code: sources/service.ts:83 (`AbortSignal.timeout(15 s)`), 95-97 (`service_unavailable`); server.ts:633 and
683 write `ok:false` in the result row; real.ts:803 `afterAction` does not reload.

### 3.5 SD-083: the login check fails open (`loginCheckFailsOpenTest`; simulator 8 steps)

```
init(loginFit = false)
sourceInit(check throws, load ok)     served = true, loginChecked = false
sourcePoll(ok)                        env error cleared
```

Code: packages/observatory/src/sources/real.ts:200-207 (the catch only sets an env error), 214-220 (load and
timers), 232 (a good poll clears the error). `unfitLoginRefusedTest` shows that a check that answers refuses.

### 3.6 SD-082: a read error makes a minor an adult in the console (`ageReadErrorTest`; simulator 11 steps)

```
netMinorSignal(viaEvent = false)      minor_reported: stored flag only
agePoll(row ok, events ok)            consoleMinor = true
agePoll(row FAILS, events ok)         consoleMinor = false, netAtPoll = true
```

Code: `stateRow` catches both queries and returns `[]` (real.ts:267-269); `ageInfo` then has no `latest` entry
(real.ts:439-447); `this.ages = ages` replaces the good copy (real.ts:320); `ageView(adult, undefined)` gives
`minor: false` (real.ts:79-82). The model shows a second path the register row does not name: with an age event,
a failed events query (`.catch(() => [])`, real.ts:424) together with the row failure has the same effect.

### 3.7 SD-071: photos stay on screen after the age gate closes (`photosStayAfterMinorTest`)

```
agePoll(ok) ; loadPhotos(S1)          adult x, photos shown
netMinorSignal ; agePoll(ok)          consoleMinor = true, photosShown = true
```

Code: packages/observatory/web/panels.tsx:579 (`photos` state), 592 (the gate controls only the form), 599-601 (the
list renders whatever `photos` holds).

### 3.8 SD-068: a case row closes another person's case in another app (`crossAppCloseTest`)

```
switchApp(peon)                       SafetyCases still holds slop's data
pressClose(S2)                        intended x (slop sc1), actual y (peon sc1)
```

Code: web/admin.tsx:60 (key without the app), 14-20 (old data stays), 68 (unknown members pass), 189 and 221
(`caseId: c.id`); web/store.ts:282 (`withApp` reads the app at send time); packages/network/src/network.ts:1211
(`sc${++this.caseSeq}`, no app prefix).

### 3.9 SD-466: one failed poll destroys staff input (`failedPollTest`)

```
typeNote ; pollSafety(fail)           note lost
```

Code: web/admin.tsx:16 (`setD(x)` replaces the data with the error), 62-63 (`<Err>` unmounts the rows).

### 3.10 SD-070: "held on every app" for a hold on one app (`holdScopeTextTest`)

```
pressHold(S1)                         heldIn = {slop}, toast "Person held on every app"
```

Code: web/admin.tsx:260 (fixed text); packages/network/service/service.ts:1679 (`crossAppSafety(user) ? all : this
app`). `holdEveryAppTest` shows the S2 (`admin@*`) path, where the text is true.

### 3.11 SD-285 and SD-286: console mode (`modeSwitchPoisonTest`, `modeHeaderRaceTest`)

```
init(realOnly = false, mode real)
modeSwitch(game, start fails)         mode = game, source poisoned
```

```
init(realOnly = false, mode game)
controlCheck(game) ; modeSwitch(real, ok) ; controlRun     ran in real, sent from game
```

Code: server.ts:246-247 (`mode = m` before `await source`), 228-238 (the rejected promise stays in `starting`);
server.ts:370 (header check), 591 and 611 (awaits), 612 (reads `mode` again). Both need a server that is not
real-only. The register votes dispute them for that reason; the model confirms the sequence on such a server.

### 3.12 SD-122: the overview says "locked" while the service matches (`peonGateTest`; simulator 3 steps)

```
init(peon registry row true)
directServiceSwitch(peon, on)         stored[peon] = true
serviceTick(peon)                     matching ran for peon; overview says "locked"
```

Code: packages/observatory/src/health.ts:334 (`!matchingAllowed(app) ? "locked"` before the stored switch);
packages/network/service/service.ts:1809-1817 (the service checks only the registry row). `consoleRefusesPeonTest`
shows the console's own refusal (real.ts:864).

### 3.13 SD-088: peon matching runs on the service (`inv_tickRunImpliesAllowedAndStored`)

The same trace as 3.12. The register refutes SD-088 because production keeps peon local-only by other means
(deployment). The model takes the peon registry row as an input; with the row false the invariant holds. I
record it as reproduced only under that input; it is not a new finding.

### 3.14 SD-246: the armed switch carries to another app (`armedSwitchCarriesTest`)

```
pressSwitch(S2)                       armed on slop
switchApp(peon)
pressSwitch(S2)                       sends to peon, armed for slop, value from slop's data
```

Code: web/admin.tsx:380 (key without the app), 381-382 (`confirm` survives the app change), 387-390 (`on:
!c.matchingEnabled` from the panel data).

### 3.15 SD-470: a late 401 reopens the prompt (`late401Test`)

```
clientSend (token 0) ; tokenExpires ; setToken (token 1, good) ; clientAnswer(0) -> 401   authNeeded over a good token
```

Code: web/store.ts:283-292 (no check that the answer belongs to the current token; line 290), 308-316.

### 3.16 SD-287: a service clock ahead of the console breaks photo review (`previewSkewTest`)

```
init(skew = 1 tick)
loadPreview(S1)                       until = now + 6 > now + 5: "This photo preview expired"
```

Code: packages/network/service/service.ts:2305 (`until = min(expiresAt, serviceNow + 5 min)`);
packages/observatory/src/server.ts:647 (refuses `until > consoleNow + 5 min`). `previewReleaseTest` shows the path
with no skew, and `inv_releaseBySameStaff` holds.

### 3.17 SD-279: a closed booked plan stays SCHEDULED in game mode (`closedStaysScheduledTest`)

```
netPropose ; netBook                  SCHEDULED
netClose                              Network: closed; projection: SCHEDULED
worldOutcome(held)                    projection: COMPLETED
```

Code: packages/observatory/src/projector.ts:251 (skips `opportunity_closed` for SCHEDULED), 105 (the
`/calling this one off/` test that `copy.dropNotice` does not match), 198 (outcome sets COMPLETED).

### 3.18 SD-281 and SD-282: forget (`forgetTest`)

```
forgetPoll ; forgetMember ; forgetPoll   edge stays in the console; z shows as an under-13 decline
```

Code: real.ts:351-356 (`load` only adds edges); real.ts:334-336 (`removed` with a null name reads as declined);
packages/network/service/runtime.ts:520-545 (the forget path writes that same row).

### 3.19 SD-505: a delta at the snapshot version is applied again (`deltaTwiceTest`)

```
dvStartLoad ; dvEmit (v1, buffered) ; dvSnapshot (state v1)   feed = 2, server = 1
```

Code: web/store.ts:337 (`d.version >= state.version`).

## 4. Register defects of this module that the model does not reach

| Id | Why not |
|----|---------|
| SD-244 | A missing button for a state (clear minor without a minor report). The model has no per-status button table; this is a liveness gap of the UI, not a reachable bad state. |
| SD-245 | The panels that do not read `authEpoch` hold data of the previous staff member. The model has one token history and no panel identity. |
| SD-283 | The console needs `verify:age:pass`. The model takes the tag as passed; the defect is a liveness failure (photos refused), not a reachable bad state. |
| SD-284 | Dead ends for held reports: a liveness gap of the button table (as SD-244). |
| SD-290, SD-293 | Start-time configuration (`createAudit` fallback, `deployGuard` inputs). No transition; a static check of the environment fits better. |
| SD-291 | A SQL row policy on the budget query. No state machine. |
| SD-301 | Unreachable enum values: a static fact about types. |
| SD-322 | The SLA constants belong to the review machine (quint/opportunity.qnt). |
| SD-467 | Header byte encoding of the reason: a reader property; the model treats the reason as given. |
| SD-468 | Ban buttons for a per-app role: the service refuses (`needs_safety_everywhere`); fails closed, no bad state. |
| SD-469 | Lift without a note. The rule is disputed (one vote calls it deliberate); I did not write an invariant without a rule. |
| SD-471, SD-472, SD-473 | Client search form, game-only forms and banner text: display only. |
| SD-499 | Not reached: `inv_terminalAbsorbing` holds when the projector gets records in the order the Network writes them. The model does not feed other orders, because the register gives no trigger for one. |
| SD-500, SD-501 | Column mappings (`updated_at`, attendance), not transitions. |
| SD-510 | A 10 s display lag after a refused approval: no safety property. |

## 5. New findings

None. Every violation maps to an existing register id. One extension: SD-082 also has a second trigger (the age
events query fails together with the state view), recorded in 3.6 under the same id.
