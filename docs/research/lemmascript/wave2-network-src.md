# Wave 2: network-src

File proved: `packages/network/src/transitions.ts` (import-free). `lsc check --backend=dafny`: 49 verified, 0 errors (47 from the TS, 2 hand lemmas in `proofs/packages/network/src/transitions.dfy` for the cap on the shipped append order). No assume, havoc, extern or axiom.

## Functions and call sites

| Function | Production call site |
|---|---|
| `readingWhy`, `readingOf` | `consentOf` tail, classify.ts |
| `probeRoute`, `routeIsYes` | `parseProbeReply` tail, classify.ts |
| `llmReading` | `mergeConsent` extract.ts, `yesNoOf` network.ts |
| `afterBareAck` | `handleInbound` probe branch |
| `statusAfter` | `advanceProbes` (primed), `onProbeAnswer` (yes, no), `advance` (silence), `times` hook (refused send), `planAnswer` (yes) |
| `afterReview`, `reviewLate`, `afterSla` | `decide`, `reviewBlock`, `advance` |
| `allAvailable`, `afterAnswers` | `maybeReveal`, `reveal` (the stage write) |
| `mayProbe` | `advanceProbes` |
| `quorumMet` | `bookPlan` |
| `seatOk` | `eligible`, `planSeatOk` |
| `approvalVerdict` | `approvalCheck` |
| `mustDecline`, `minorClears`, `minorRises` | `handleInbound`, same order as before: the decline, then the clear, then the raise with `dropMember` |
| `signalClearVerdict` | `clearMinorSignal` |
| `recipientVerdict`, `otherVerdict` | `checkRecipient` (so `recipientPolicy`, `blooioRecipientPolicy`, every `send`) |
| `windowCount`, `mayPush`, `withSend` | `overBudget`, `unsolicitedRefusal`, `send` |
| `unsolVerdict` | `unsolicitedRefusal` |
| `inHourWindow` | `allowedAt`, outreach.ts |
| `nextLevel`, `decayedScore`, `reportCounts`, `reportPoints` | trust.ts `relevel`, `decay`, `report` |
| `abusePoints`, `staffHoldPoints` | `handleAbuse`, `holdMember`, `markBanned` |
| `relayStatusOf` | `relayMatchOf` |
| `relayPartyVerdict`, `relayDispatchVerdict` | `relayDispatchCheck` |
| `swapPlan` | `RelayDesk.swap` |
| `heldAfter`, `keepsHeldText` | `RelayDesk.release`, `reject`, `forget` |
| `postingAction`, `payRangeOk` | jobs.ts `postingFromDraft`, `parsePosting`, `postingProblem` |

`otherVerdict`, `readingOf` and the other helpers are called through the functions above. `startProbes` with `probes: false` (simulator only, never set in production) still sets every member available without a probe: it is the one `available` write that does not go through `statusAfter`.

## Spec force: one mutation per decision

Each mutation was applied to a scratch copy of transitions.ts and checked with `lsc check --backend=dafny` (script: `/private/tmp/claude-501/-Users-nubs-thenetwork/71ebb7fb-9e02-4dbf-b300-9c31fec118b5/scratchpad/research/network-src/mut/run.py`). All 16 are caught.

| Mutation | Result |
|---|---|
| a counter is a yes (the shipped rule, defect 2) | 2 errors |
| a bare "neither" is a yes (shipped) | 2 errors |
| silence makes a yes (`advance` 3378, `times` hook 4073 as shipped) | 1 error |
| no deadline in `afterReview` (defect 14) | 1 error |
| recipient: a minor recipient passes | 1 error |
| recipient: a minor in `about` passes | 2 errors |
| swap: the first share goes alone (defect 5) | 1 error |
| relay dispatch: the age is ignored | 3 errors |
| `minorRises` ignores the new signal | 1 error |
| hold is not sticky | 1 error |
| sequential probes skipped | 1 error |
| two unanswered dropped | 1 error |
| `seatOk` ignores an open report | 1 error |
| wrapped quiet window computed as plain | 1 error |
| held text kept after the decision | 1 error |
| a job saved without a pay range | 1 error |

## What the proof does not cover

The inputs are trusted: the regexes that find a refusal, a counter or a picked time (classify.ts), the Map reads and `syncRecord` that fill the fact records, `validAge`/`isMinor` (proved in core), `ABOUT_OTHERS` and `ASK_KINDS` membership, `relayWouldSend` (a side-effect-free copy of the checks in `send`, kept in step by hand), the engine's relay decision, and the clock. The proof covers one step. "No probe before approval on every trace" is a temporal property: `begin` has one caller, which now goes through `afterReview`. Numbers are ideal in the proof (NaN and Infinity are outside it).

## Defects fixed

Each one has a case in `packages/network/test/consent-transitions.integration.test.ts` (the real Network, the real engine, `Mini`). Before-evidence: the same test file run on a `git archive HEAD` copy with the same node_modules: 11 fail, 3 pass (the 3 are the regression cases: a yes to other times books, "yes, but none of those" keeps the yes, a two-way swap). After: 14 pass, 0 fail.

| Defect | Fix | Cases that failed before |
|---|---|---|
| 2 (high): "rain check", "how about next week", "neither" read as a yes to a probe | `probeRoute`: a counter or a bare "neither" is not a yes. With time options it is `ask_times`: other times are offered once (`offerOtherTimes`) and nothing is recorded; with none it is unclear (clarify once). The silent paths (`advance` 3378, the `times` hook 4073) now need a recorded yes (`primed`) through `statusAfter`. | 5 counter phrasings then silence (reveal and meeting before), the job seat with no options (the manager was probed) |
| 5 (high): a number swap can go one way | `swapPlan` with a preflight of both shares (`RelayHost.canSend`, `relayWouldSend`): both must be sendable now, or neither goes. A share that would be deferred counts as not sendable. | streak limit (B got A's number), quiet hours (one share deferred) |
| 14 (medium): `decide()` has no deadline check | `reviewBlock` returns `review_expired` for approve, edit and reroll at or past the deadline (`reviewLate`); `decide` checks `afterReview` before `begin`. A reject stays allowed. | approve, edit, reroll past the deadline with no tick |
| report bug 4: crew offers skip the about-others checks | Crew offers are sent as `scheduling` (in ABOUT_OTHERS, same timing as `info` and `reply` for this send); `crewCheck` and `resolveCrew` keep only members who may take a seat (`planSeatOk`, busy allowed). The member's thanks still goes if the offer is refused. | a member found to be 16 after the plan got the offer |
| report bug 5: an open urgent report does not stop crew plans | `reportHeld` is in `seatOk` (so `planSeatOk` and `eligible`) and in `approvalVerdict` (reason `report_held`). | `planSeatOk` and `approvalCheck` passed a reported member |

The probe flow keeps "other times" for a real "yes, but none of those". The ACK rule, the LLM merge and the refusal-first order are unchanged.

## Tests and sims run

| Command | Result |
|---|---|
| `lsc check --backend=dafny packages/network/src/transitions.ts` | 49 verified, 0 errors |
| `bun test packages/network/test/consent-transitions.integration.test.ts` | 14 pass |
| `bun run sim --only network` | 60/61 blocking gates. The one failure is in the gate, not the code: `trust: no honest member is flagged` reads `run.personas`, a map built before the run, so a friend spawned during the run (`nyc-g2-0001`, a scammer, `hidden.adversarial = "scammer"` per `w.personaList()` after the run) reads as honest. The fixed seeds take a different path now, and this friend acts. The regression floors (all-yes 0.73, meetings 140) pass. |
| `bun run sim --only relay` | 60/60 |
| `bun run sim --only peon-seats` | 10/10 |
| `bun run sim --only safety` | 17/17 |
| network tests: report-booked, block-target-plan, store, relay, shared-relay, shared-agent, shared-actions, peon-seats, peon-postings, service-apps | all pass (1, 2, 8, 5, 10, 14, 4, 1, 1, 17) |
| `service-safety.test.ts` | 8 pass, 1 fail: line 94, `/api/auth/otp/verify` returns 400 for a banned phone after the ban. That is the platform's site OTP ban check (defect 3, another area's change), not this area. |
| `bunx tsc --noEmit -p .` | no error in packages/network (errors remain in packages/engine and packages/mcp/test from other areas' work in progress) |

## Trust counts

assume 0, havoc 0, extern 0, axiom 0. Two hand lemmas in the .dfy (`windowCount_append`, `cap_holds_after_send`): the cap stays at or under the budget after a send in the shipped append order.

## Changes needed in files this area does not own

- `scripts/sim/network.ts` line 186: read the persona from `run.w.personaList()` after the run (or a map rebuilt after `complete()`), not `run.personas`, so spawned friends are judged by their own hidden truth.
- `packages/network/service/service.ts`: the person-level cap (service.ts:117) can use `windowCount` and `mayPush` from transitions.ts.
- Docs: docs/network.md could say that a counter or "neither" gets other times once and is never a yes on its own.

## Skipped, with the reason

- Report bug 6 (two pending candidates share one manager `awaiting`): the fix is a product choice (one review at a time, or name the candidate).
- Report bug 7 (the LLM can raise an unknown age): `understand` is not wired in the service, so the path is dead today; the fix is one line when it is wired.
- Report bug 8 (a relayed number stays in `lastSent.body`): needs a change to the duplicate check and the stored state; low.
- `harness/experiment.ts:138` counts a persona's counter intent as a yes in the summary metrics. It measures what the persona wanted, not what the Network recorded, and the floors depend on it, so it stays.
- `store.ts` `oppState`/`partStatus`, plans, geo, copy, reports: low value or out of the fragment (report section 1).
- `replaceOrClose` probing an alternate with no new review: founder question (already listed).
