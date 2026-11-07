# Wave 2: network-service

Hand-written. No LLM calls. Toolchain: lsc 0.6.6, Dafny 4.11. Proof numbers are from `lsc check`. Nothing is committed.

## Proved

File: `packages/network/service/decisions.ts` (import-free). `lsc check --backend=dafny`: **51 verified, 0 errors**. No hand proof text; `proofs/packages/network/service/decisions.dfy` equals the generated file. Listed in `LemmaScript-files.txt`.

| Function | Production call site |
|---|---|
| `sendRefusal` | `service.ts consentRefused`; also inside `numberAllowed`, `stopHintDue` |
| `numberAllowed` | `sharedTurn admission` |
| `stopHintDue` | `service.ts stopHint` |
| `collectGate` | `runtime.ts writeUnit` (every collected Network and system reply), `service.ts direct` (every collected direct text) |
| `stopScopeOf`, `startOutcome` | `service.ts inbound`, new `startKeyword` (both START branches) |
| `outboundKind` | `runtime.ts context().send` |
| `joinAgeUsable`, `recordedAge` | `fromDatabase` (start refused on a bad row), `statedAge` |
| `mayEnroll` | `enroll` |
| `joinStep`, `effectiveAge` | `service.ts join` |
| `turnDecision`, `accountEligible`, `contextWanted`, `keepsMember`, `replyKindOf`, `storedTurnAdmitted` | `sharedTurn`; `replyKindOf` also `inbox.ts rescueCompliance` |
| `receiptAction`, `receiptStatus`, `accountFreeReply` | `sharedTurn` receipt branch |
| `turnHeldBack`, `priorAnswer`, `pickWaiting`, `rescueAction` | `inbox.ts`. `turnHeldBack` replaces the `not exists` in the claim insert: the three flags are read in the same locked transaction |
| `classifyDeliver`, `refusalStatus` | `cloud-channel.ts post` |
| `liveAllowed` | `channel.ts liveSendAllowed` |
| `relayWire`, `rowAccepted`, `relayDelivered` | `relay-endpoint.ts` |
| `relayCanonical`, `pairReason` | `runtime.ts relayParties`, `relayPairAdmission` |
| `windowActive`, `effectiveState` | `snapshot.ts effectiveParticipation` |
| `isScheduled`, `stateUnchanged` | `sharedAction` set-state |
| `cleanupAction`, `reviewPath` | `profile-suggestions.ts` (all three cleanup loops, the edit branch) |
| `photoIntakeStep` | `photoIntake.ts photosIn` |
| `biasEligible` | `bias.ts biasRows` |

The old inline logic is gone at each site. `collectGate` is the proof of the collected seam for the replies this repository produces.

## What the proofs do not cover

- Every input is trusted. The proof does not show that a caller reads a fact correctly, or that reads are in one transaction. `numberFacts` runs inside the unit's transaction in `writeUnit`, and on the pool in `direct`.
- `bound` and `contextReady` rest on `Accounts.activeMembership` and `sharedContext` (platform).
- The model reply of an open turn (seam M) and the gateway fence are outside the repository.
- `pickWaiting` covers one decision, not the 50-row scan. A STOP past row 50 waits.
- `joinStep` has the proved rule for text. The web uses `joinPlan` in `packages/platform/src/decisions.ts`, which the platform agent wrote. They are two cores with matching age, ban and invite rules, not one.
- `LeakGuard` itself is regex and is not proved. `leakClean` is an input.

## Mutations (each on a copy, each rejected by `lsc check`)

| Mutation | Result |
|---|---|
| `sendRefusal` drops the suppressed check | 3 errors |
| `collectGate` ignores a ban | 1 error |
| `collectGate` collects an unchecked non-fixed text | 1 error |
| `startOutcome` ignores the ledger | 1 error |
| `recordedAge` uses `minJoinAge + 5` | 1 error |
| `joinStep` ignores the floor | 2 errors |
| `contextWanted` drops `bound` | 2 errors |
| `receiptAction` lets an unknown prior become unknown again | 1 error |
| `classifyDeliver` drops the `unknown` guard | 1 error |
| `pairReason` skips `held` | 1 error |
| `effectiveState`: a window beats STOP | 1 error |
| `mayEnroll` always true | 1 error |
| `turnHeldBack` holds compliance back | 1 error |

## Defects fixed

New test: `packages/network/test/collected-gate.integration.test.ts`, 9 cases. Before the fix: 5 of the first 7 failed, and the leave case failed when added.

| Defect | Evidence before | Fix |
|---|---|---|
| 7: join prompt after STOP in a signed turn, duplicate id | The case failed (an ask was collected with the hint). The gate-free run reproduced it | `collectGate` in `direct`. The hint takes its own id `hint:<rowId>`, which also clears the queue path conflict |
| 8: banned member gets collected replies | `"I couldn't match that name..."` collected for a banned member | `collectGate` in `writeUnit`. The reply is stored `refused_opted_out`, not collected, not queued |
| 9: stale START from a non-member reports `opted_in` | `consent: {state: "opted_in", ...}` | Both branches call `startOutcome`. A stale START returns handled with no join |
| Opted-out member: Network reply collected | Failed with the reply collected | `collectGate` |
| `network.members.opted_out` with no ledger event | Failed with the reply collected | `memberOptedOut` fact |
| Replay of a stored reply after a later ban | 200 with the old replies | `storedTurnAdmitted`: 409 `turn_context_changed` |
| B3 (part): leave reports `at: now` | Case failed | `turn.consent.at` is `consentAt(ev)`. The ledger half needs a platform change, below |
| B4: `Date.now()` in `profile-suggestions.ts` | Two hits | `RealClock` for the store with no fence, behavior unchanged. A case scans the service folder for `Date.now()`, `Math.random()`, `new Date()` |
| B7: hard-coded ages | `service.ts`, `bias.ts`, `packs.ts` | `isMinor`, `canBeMatched`. Comparisons left only inside `//@` specs and `joinAgeUsable` |

Also closed: with a dry-run adapter, a non-fixed collected reply had no leak check (journeys B5, the leak half). It now gets the plain `LeakGuard`. The live-flag half of B5 is not changed.

Behavior change to note: a fixed compliance text (a STOP confirmation) no longer runs the queue's leak guard and is never parked. A non-fixed compliance text (the Network's decline) still is checked.

## Founder questions: safe behavior kept, not decided

- **Join prompt to a person opting back in (journeys C1).** An opted-out or suppressed number gets no join prompt in a signed turn. Opted out: the one hint. Suppressed: nothing. A message with name and age still joins and opts them in. So a person who deleted everything and texts "hi" hears nothing.
- **Takeover notice to a number that sent STOP** still goes (fixed compliance copy). `collected-gate` case 1 states this.

## Skipped, with reason

- `parseOptOut`: not wired. `detectKeyword` already reads `optOutPhrase`, and the platform agent closed defect 6 there. core `replies.ts` says the strict reading is what the ledger acts on and `parseOptOut` is the conversational reading. Its `likely` matches `^(stop|para|basta)\b`, so "para el viernes" would stop every app for the person. Decision 11 and the audit say to use it, so this needs a maintainer answer.
- `route-authority.ts` (staging only), `capRefused` filter (trivial), `slaAlerts`, `cost.ts`, SQL, regex parsers: report section 5.
- `elizaNotice` and `turn.confirmation` collect without calling the gate. Both are fixed compliance, which `collectGate` always passes.
- Journeys B9 (leave on a held number) and report B1 observations on `held`: not listed for this wave.
- A banned member's text still reaches the Network (a block still takes effect); only the replies are refused. Founder 2026-10-09 #3 says refused at inbound; an early return would change that. Not decided here.

## Changes needed in files not owned

- `packages/platform/src/accounts.ts`: `leave(app, who, at = this.now())`, and `service.ts` passes `this.consentAt(ev)`. This completes B3.
- `proofs/trust.json`: no change. assume 0, havoc 0, extern 0, axiom 0.
- `packages/network/test/collected-gate.integration.test.ts` is a new file outside `service/**`.

## Runs

@@RUNS@@
