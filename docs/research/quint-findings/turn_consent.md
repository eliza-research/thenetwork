# Quint findings: `quint/turn_consent.qnt`

Model plan: [docs/research/2026-11-07-state-machines.md](../2026-11-07-state-machines.md) section 6.2 (P0).
Model: [quint/turn_consent.qnt](../../../quint/turn_consent.qnt). This file is hand-written. The traces below are
short forms of simulator traces (ITF output with `--mbt`, summarized by a script) and of the `run` tests in the model.

## 1. Final state

The model follows the code on branch `wave2/turn_consent`: base ad67275 and the fixes for 26 defect ids (section 3),
plus the fix for Q-turn_consent-3 in this change (`packages/network/service/inbox.ts`). `bun run quint:check` passes:
typecheck, 30 run tests, the `safety` simulation and 8 reachable witnesses. Apalache `verify` of `safety` passes at
the bound in section 2.

Five invariants are not in `safety`. Each one is a named value with a comment that gives the defect id and the reason,
and each one still fails in the simulator or in a run test:

| Value | Why it is outside `safety` | Ids |
|---|---|---|
| `stopPhraseHonored` | Reader oracle. SD-031 is fixed in the reader (corpus rows); which reader the inbound path uses needs a founder decision. | SD-032 (skipped) |
| `startResumesStop` | START after a global STOP resumes one app by design (consent.ts). One app or every app needs a founder decision. | SD-024 (skipped) |
| `fenceMatchesLedger` | Its opt-in half: an opt-in written outside a handled turn answer (a failed text join, enroll, web join) cannot reach the fence without a contract change. The safety half `fenceHoldsEveryOptOut` is in `safety`. | SD-023 (partly skipped) |
| `projectionsConverge` | A STOP turn rescued after its ledger write and before all its projections never writes the rest. `projectionsMatchLedger` (in `safety`) checks every other run. | Q-turn_consent-4 (open) |
| `noReplyAfterStop` | The backend collects a join ask or a lagging Network reply for an app the run read as opted out and relies on the fence; the fence lags while the opt-out's own turn is in flight. | Q-turn_consent-5 (open) |

## 2. Checks

```text
$ bun run quint:check --verify quint/turn_consent.qnt   # bounds: max-steps=30 max-samples=20000 verify-steps=3, seed 0x5eed
ok   quint/turn_consent.qnt typecheck
ok   quint/turn_consent.qnt test                        # 30 run tests pass
ok   quint/turn_consent.qnt safety
ok   quint/turn_consent.qnt witness_stopConfirmed (must be reachable)
ok   quint/turn_consent.qnt witness_leaveOneApp (must be reachable)
ok   quint/turn_consent.qnt witness_startResumes (must be reachable)
ok   quint/turn_consent.qnt witness_openTurn (must be reachable)
ok   quint/turn_consent.qnt witness_orphan (must be reachable)
ok   quint/turn_consent.qnt witness_hint (must be reachable)
ok   quint/turn_consent.qnt witness_reclaim (must be reachable)      # new: a second run of a compliance turn (SD-001 fix)
ok   quint/turn_consent.qnt witness_twoSlots (must be reachable)     # new: an ordinary and a compliance turn at once (SD-002 fix)
ok   quint/turn_consent.qnt verify safety                # Apalache, depth 3, about 5 min
1 models, 0 failures
```

- `safety` with the Rust simulator, `--max-steps 30 --max-samples 20000`: no violation for seeds 0x5eed and 0x1-0x6
  (7 x 20000 traces, about 15 s each), and for seed 0x7 at `--max-steps 40`.
- Apalache `verify --invariant safety`: passes at depth 2 (39 s) and depth 3 (4 min 55 s). Depth 4 did not finish in
  25 CPU minutes (stopped), so `verify-steps=3`; the simulator covers deeper runs. Other agents on this machine run
  Apalache servers; a separate run used a private server (`--server-endpoint localhost:8893`) with the same result.
- The values outside `safety` (section 1), seed 0x5eed: `stopPhraseHonored`, `startResumesStop`, `projectionsConverge`
  and `noReplyAfterStop` are violated; `fenceMatchesLedger` is violated with seed 0x4 and in the run test
  `sd023FailedJoinTest`.
- Integration tests (dev Postgres :54339): `packages/network/test/turn-consent.integration.test.ts`,
  `inbox-order.integration.test.ts`, `shared-agent.integration.test.ts`, `eliza-takeover.integration.test.ts`:
  59 pass. The two new Q-turn_consent-3 cases fail on the code before the fix (`turn_unresolved`, `retryable: false`).
  `bun run typecheck` passes.

## 3. Defects and their state

| Id | State | What changed in the model | Run test |
|---|---|---|---|
| SD-001 | fixed (479b71d) | `gwCall` claims an unresolved, unanswered compliance row again (`reclaim`, a new run `m + 10k`); runs are separate actors | `sd001StopReclaimedTest`, `sd001StopAfterLedgerTest` |
| SD-002 | fixed (e6a337b) | rows carry `comp`; a compliance turn waits only for another compliance turn; `oneTurnPerSlot` replaces `atMostOneProcessing` | `sd002StopBesideChatTest` |
| SD-004 | fixed (e73bed7) | `purge` keeps a stop-hint row until `last_at + 30 days` (`keep_until`) | `sd004HintPurgeTest` |
| SD-023 | fixed for the text join (8eb7c39); enroll and web join skipped (upstream contract) | `join` echoes its opt-in when the ledger reads opted in; `fenceMatchesLedger` left out of `safety` | `sd023JoinFenceTest`, `sd023FailedJoinTest` |
| SD-024 | skipped (founder decision) | none; `startResumesStop` left out of `safety` | `sd024StartOneAppTest` |
| SD-029 | fixed by the SD-314 fix (module identity_sagas) | the retry of a released leave is a leave again | `sd029LeaveRetriedTest` |
| SD-031 | fixed (459e235, reader corpus) | none (reader oracle); see SD-032 | - |
| SD-032 | skipped (founder decision) | `stopPhraseHonored` left out of `safety` | - |
| SD-036 | fixed (cce18aa) | `staffHandle` sets the signal `decided` (POST /signals) | `sd036SignalTest` |
| SD-037 | fixed (df2d6a9) | a non-member START that the ledger does not opt in reports nothing and sends no join ask | `sd037LateStartTest` |
| SD-073 | fixed (a0bf8f2) | a banned member's text gets no hint and no reply | `sd073BannedTest` |
| SD-087 | fixed (da8087d) | `purge` seals processing rows whose lease ended before the window | `sd087OrphanTest` |
| SD-104 | fixed (75de9f9) | STOP skips an app whose ledger reads opted in | `sd104OlderStopTest` |
| SD-105 | fixed (fbe59e2) | leave writes at `consentAt` with its ref; no forget under a newer opt-in | `sd105LateLeaveTest` |
| SD-129 | fixed (af0e9e3) | a failing legacy STOP stays pending after 5 attempts | `sd129LegacyStopRetriedTest` |
| SD-212, SD-215 | fixed (ca54cbd) | none: the `ctxOk` oracle stands for sharedContext | - |
| SD-216 | not reproduced (no code change) | none | - |
| SD-217 | fixed (07c8e60) | not modelled (participation window) | - |
| SD-218, SD-434 | skipped (founder decision, upstream contract) | not modelled | - |
| SD-313 | fixed (5d71dd6) | the replay of an open turn answers with the current context while an open turn is allowed | `sd313ContextChangedTest` |
| SD-314, SD-490 | fixed (d0f1a29, 0546d09) | "leave <app>" always leaves, for a non-member too, and ends a pending join of that app | `sd314StrangerLeaveTest`, `sd490LeaveEndsJoinTest` |
| SD-317 | fixed (4f96d13) | not modelled (SHARE) | - |
| SD-318 | fixed (1fbd4ca) | a global STOP keeps its named app; START after it routes there (`routeApp`); new invariant `startResumesNamedApp` | `sd318StartNamedAppTest` |
| SD-433 | fixed (92bde89) | not modelled (notify thread) | - |
| SD-478 | skipped (founder decision) | not modelled (reader meaning) | - |
| SD-493 | fixed (d5fe16f) | a signed STOP's claim cancels older ordinary legacy rows | `sd493LegacyCancelledTest` |
| SD-496 | fixed (14333a0) | rows keep `arr` (arrived_at) apart from the lease; tombstones purge by `arr` | - |
| Q-turn_consent-1 | fixed (73f8c12) | `failOut` rescues a sealed, unanswered claim that has a consent; `complete` on a sealed row goes through `failOut` | `q1StopSealedWhileRunningTest` |
| Q-turn_consent-2 | fixed (894924b) | an older join answer than the last STOP is paused and opted out, no welcome | `q2JoinAfterStopTest` |
| Q-turn_consent-3 | fixed in this change | section 4 | `q3ReclaimWaitsTest`, `q3SealedBeforeConsentTest` |
| Q-turn_consent-4 | open | section 4; `projectionsConverge` outside `safety` | `stopThrowsAfterConsentTest` |
| Q-turn_consent-5 | open | section 4; `noReplyAfterStop` outside `safety` | `q5ReplyBeforeFenceTest` |

## 4. Defects found in the fixed code

### Q-turn_consent-3: a compliance turn that can be claimed again answers a final turn_unresolved (fixed)

Rule: PRD 40.3 and inbox.ts "STOP, START and HELP are never held back"; `stopNeverLost`.

The SD-001 fix lets a compliance retry claim an unresolved, unanswered row again. Two paths still answered the final
`turn_unresolved` (`retryable: false`) while the row stayed claimable, so the gateway stopped and the STOP was lost:

```text
m1=Stop/A/gw claimed, crash; 2.5 min; m2=Leave/B/gw claimed (sweeps m1 to unresolved), runs in the compliance slot
gwCall(m1): reclaim blocked by m2 -> prior unresolved -> 409 turn_unresolved, retryable false   -> stopNeverLost violated

m1=Leave/A/gw claimed; staff resolve m1; the run throws before turn.consent
rescueCompliance: not processing, not sealed (no consent) -> 409 turn_unresolved, retryable false; ledger has A:out, fence never
```

The simulator found a third form: two runs of one STOP (a reclaim after a missed lease while the old run lives); the
old run releases (deletes) the claim, the new run then fails with no row.

Fix (`inbox.ts`): a compliance turn is never final without an answer. A refused claim whose row is still reclaimable
answers `turn_busy` (retryable). A compliance run that cannot be rescued replays the answer of another run of the same
request, or answers `turn_failed` (retryable) when its row is reclaimable or gone. Tests:
`turn-consent.integration.test.ts` "Q-turn_consent-3: a STOP that lost its worker waits for a running HELP of the
sender, then runs again" and "... fails before its consent change, is retried" (both fail before the fix).

### Q-turn_consent-4: a STOP rescued before its projections never writes them (open, needs a design decision)

Rule: service.ts `stopped` (an opted-out membership reads paused) and the liveness goal "projections converge to the
ledger" (plan section 6.2).

```text
init: A, B active. m1=Stop/B/gw: *:out committed, turn.consent set (phase 0)
a later step throws (memberMessage or stopped) -> rescueCompliance: consent set -> handled with consent and confirmation
the row is done; no retry runs stopped() again: A and B stay active, network members not opted out; ledger out
```

The send path reads the ledger, so nothing is sent; the Network still treats the person as eligible (as in
Q-turn_consent-2 before its fix). The research note `state-machines/network-harness.md` already says "the member row
and membership may lag". Fix choices, each against the fence-first design of `rescueCompliance`: release the claim so
that the retry writes the projections (the fence learns the STOP later), a reconcile pass on the tick, or a repair when
the member writes next. The model keeps `projectionsMatchLedger` in `safety` for every run without this case (ghost
`cutShort`) and the strict `projectionsConverge` outside it.

### Q-turn_consent-5: a reply decided after the ledger reads opted out goes out before the fence learns it (open)

Rule: service.ts stopHint and founder decision 2026-10-11 #22 (after STOP only the hint and confirmations go out).

```text
init: A active. m1=Leave/A/gw: A:out committed, A removed; the run throws -> claim released, turn_failed (retryable)
m2=Chat/A/gw (sent at the same time) claims: not a member now -> join ask (+ hint); answered handled
the gateway delivers m2's join ask; its fence does not have A:out yet (m1 still retries)   -> noReplyAfterStop violated
```

The same happens when a STOP runs in the compliance slot beside an ordinary turn (the SD-002 fix lets them run at
once) and the ordinary turn's answer reaches the gateway first. The backend collects these replies on purpose and
leaves the refusal to the fence ("refused at send time"). Closing the window means filtering them in the backend by
the ledger the run read. That changes where the rule is enforced, so it needs a maintainer decision. The fence half of
SD-029 and Q-turn_consent-1 (the fence never learns the opt-out) is fixed and checked by `fenceHoldsEveryOptOut`.

## 5. What changed in the model, apart from the fixes

- **Runs.** A message can have more than one run (a reclaim after a sweep or staff resolve). The gateway waits for the
  answer of its latest request (`Gw.rid`); an answer from an older run is lost, as in the code.
- **Gateway assumption added.** The gateway retries one message within the inbox retention (7 days). Without it, the
  simulator retried a message 31 days later, after the purge had sealed its answer.
- **Process assumption added.** A run lives for minutes: a time jump longer than 10.5 min happens only when no run is
  alive. Shorter jumps still let a live run miss its lease.
- **Judging an answer by what the run read.** `echoMatchesLedger` and the reply-leak ghost compare the answer with the
  ledger events the run had read when it set its consent or its reply (`cseq`, `rseq`), not with events another turn
  committed later. A later event makes an answer stale, not wrong; `fenceHoldsEveryOptOut` checks the result at the
  gateway. A STOP or leave echo is its own event; an app with a newer (or equal-time) opt-in resolves opted in at the
  gateway too, which resolves its fence by `at`.
- **`processingEnds`** is checked against the last retention purge (the tick runs it every minute), not against the
  clock alone.
- **`leaveNeverOptsIn`** is set by any opt-in event that a leave writes (it was a flag on one code branch).
- **`doneTurnAnswered`**: a replayed open turn may end in `turn_context_changed` only when an open turn is no longer
  allowed (the member left, opted out, was banned or held).

## 6. Reproduce

```bash
export PATH=$HOME/.local/thenetwork-tools/node_modules/.bin:$PATH
bun run quint:check quint/turn_consent.qnt            # add --verify for Apalache (default port 8822)
node_modules/.bin/quint run quint/turn_consent.qnt --main turn_consent --backend rust --seed 0x4 \
  --max-steps 30 --max-samples 20000 --invariant fenceMatchesLedger
node_modules/.bin/quint test quint/turn_consent.qnt --main turn_consent --match q3ReclaimWaitsTest
bun test --conditions eliza-source --timeout 120000 packages/network/test/turn-consent.integration.test.ts
```
