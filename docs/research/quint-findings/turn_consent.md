# Quint findings: `quint/turn_consent.qnt`

Model plan: [docs/research/2026-11-07-state-machines.md](../2026-11-07-state-machines.md) section 6.2 (P0).
Model: [quint/turn_consent.qnt](../../../quint/turn_consent.qnt). Base commit: ad67275. This file is hand-written.
The traces below are short forms of simulator traces (ITF output summarized by a script) and of the `run` tests in
the model.

## 1. What the model covers

One sender (one phone and one person), two apps `A` and `B`, four message ids, at most one process crash.
Time is a tick of 30 s. The named thresholds are the code constants: lease 2 min, unresolved block 10 min,
rate-limit purge 2 days, inbox retention 7 days, tombstones 30 days more, stop hint 30 days, 5 legacy attempts.

| Machine (catalog) | Model state and actions | Code |
|---|---|---|
| `signed-turn` (M-001), `sender-serialization` (M-002) | `rows`, `workers`; `gwCall` (claim transaction with the sweep), `work`, `renew`, `crash`, `throwIn` (rescueCompliance), `complete`, `staffResolve`, `purge` | inbox.ts:81-163, 197-215 |
| `consent-ledger` (M-003) | `w.ledger` as a set of events; `resolve` = `resolveConsent` with `lastConsent` order (at, then id) | consent.ts:37-43, pg-store.ts:131-145 |
| `gateway-consent-mirror` (M-004) | `w.fence`, written only by `deliverTo` from a handled answer's `consent` | service.ts:1090, 1108, 1136, 1325 |
| `opt-out-projection` (M-005) | `w.member` (memberships.state), `w.optOut` (network member opted out) | service.ts:801-818, 1109-1110, memberUnit |
| `optout-reader` (M-006), `routing` (M-108) | oracles: the message kind (`Stop`, `StopLikely`, `Start`, `Help`, `Leave`, `Join`, `Chat`) and the routed app | consent.ts:65-90, service.ts:957-985 |
| `stop-hint-window` (M-007) | `w.hintLast` (rate_limits row), `w.hintLog` (ghost: every hint sent) | service.ts:1156-1161, pg-store.ts:229-241, 280-290 |
| `agent-signal-review` (M-008) | `w.signals`, `w.staffHandled`; `proposeSignal`, `staffHandle` | service.ts:1833-1840, 1950-1960 |
| `recycled-hold` (M-009) | `held` (fixed per run) | service.ts:1061-1066 |
| `legacy-inbox-row` (M-107) | rows with path `wh`; `drain` (compliance first, 5 attempts, cancel before STOP) | inbox.ts:175-185, 234-282 |
| `open-turn-binding` (M-109), `agent-context-projection` (M-110) | `complete` with the `ctxOk` oracle; replay recheck in `gwCall` with `w.ctx` | service.ts:2081-2084, 2098-2104 |

Left out on purpose: `eliza-takeover` (M-011, the one-time notice is in `join_age`), `webhook-intake` (M-012,
HMAC is an oracle), `route-authority` (M-106, one authority), `participation-window` (M-111). `journey-stop-start`
(M-010) and `active-member` (M-013) are the products of the rows above.

Gateway assumptions (upstream code, not in this repository; each is a stated assumption, not a fact): the gateway
retries a retryable answer and a timed-out request with the same messageId; it stops at a final answer; it mirrors a
handled answer's `consent` into its fence and resolves the fence by `at` like the ledger; it sends the collected
replies only when its fence lets the app send. The Network refuses its own replies to a member whose network row is
opted out (network.ts:1992, 4221).

## 2. Checks

```text
$ bun run quint:check quint/turn_consent.qnt --verify      # bounds: max-steps=30 max-samples=20000 verify-steps=6
ok   quint/turn_consent.qnt typecheck
ok   quint/turn_consent.qnt test                         # 24 run tests pass
FAIL quint/turn_consent.qnt safety                       # expected: the model shows the defects below
ok   quint/turn_consent.qnt witness_stopConfirmed (must be reachable)
ok   quint/turn_consent.qnt witness_leaveOneApp (must be reachable)
ok   quint/turn_consent.qnt witness_startResumes (must be reachable)
ok   quint/turn_consent.qnt witness_openTurn (must be reachable)
ok   quint/turn_consent.qnt witness_orphan (must be reachable)
ok   quint/turn_consent.qnt witness_hint (must be reachable)
FAIL quint/turn_consent.qnt verify safety                # Apalache finds a counterexample at depth 2 in about 30 s
```

Each invariant alone (`quint run --backend rust --seed 0x5eed --max-steps 30 --max-samples 20000 --invariant X`):

| Invariant | Result | Register ids |
|---|---|---|
| `stopNeverLost` | violated | SD-001, SD-129 |
| `stopPhraseHonored` | violated (reader oracle) | SD-031, SD-032 |
| `stopNeverHeldBack` | violated | SD-002 |
| `atMostOneProcessing` | holds (20000 samples, seeds 0x5eed, 0x1-0x4) | - |
| `stopAllApps` | holds (same) | - |
| `ledgerFollowsSendOrder` | violated | SD-105 |
| `echoMatchesLedger` | violated | SD-037, SD-104 |
| `projectionsMatchLedger` | violated | SD-104, SD-001, Q-turn_consent-1, Q-turn_consent-2 |
| `fenceMatchesLedger` | violated | SD-023, SD-001, SD-029, Q-turn_consent-1 |
| `startResumesStop` | violated | SD-024, SD-318 |
| `noReplyAfterStop` | violated | SD-029, Q-turn_consent-1 |
| `bannedOnlyCompliance` | violated | SD-073 |
| `leaveNeverOptsIn` | violated | SD-490, SD-314 |
| `nothingBeforeStopActedAfter` | violated | SD-493 |
| `oneHintPer30Days` | violated | SD-004 |
| `processingEnds` | violated | SD-087 |
| `doneTurnAnswered` | violated | SD-313 |
| `signalHasExit` | violated | SD-036 |

`guarded` (`atMostOneProcessing` and `stopAllApps`) passes Apalache `verify` at depth 3. At depth 4 Apalache runs
out of heap memory (default JVM heap), so the bounded proof stops at 3 steps; the simulator covers deeper runs.

## 3. Defects the model reproduces

Notation: `mN=Kind/app/path@receivedAt`, `gwN` gateway state, `rowN` platform.inbound status and lease
(`arrived_at`), `wkN` worker phase, `*:out@t` a global opt-out event, `A:in@t` an app event.

### SD-001: a claimed STOP that loses its worker (P0) - reproduced

Run `sd001StopLostTest` (crash before the ledger write) and `sd001StopAfterLedgerTest` (the milder form: crash
after it).

```text
m1=Stop/A/gw@1  gwCall -> row1=processing/l1, wk1=p0
crash(1)  gwTimeout(1)  tick(+2.5 min)
gwCall(1) -> sweep row1=unresolved (inbox.ts:92-93); insert conflicts; prior unresolved -> 409 turn_unresolved, retryable false (inbox.ts:107)
gw1=final(err:turn_unresolved), ledger has no STOP event        -> stopNeverLost violated
after-ledger form: ledger=[*:out@1#1], fence=[], member A active, optOut A false -> fenceMatchesLedger, projectionsMatchLedger violated
```

The simulator also reaches it through staff resolve (`POST /inbound/resolve`, inbox.ts:211-215) of a STOP whose
worker then dies.

### SD-002: STOP refused with turn_busy (P0) - reproduced

Run `sd002StopBusyTest`. `m1=Chat` claims the sender; `m2=Stop` claim: the insert guard reads `status='processing'`
for every text (inbox.ts:96), no row with id m2 exists, so inbox.ts:102 answers `turn_busy`. Simulator trace: a
running `Leave` holds the sender and a STOP gets `turn_busy` (flag `busyKw`).

### SD-004: the 2-day purge cuts the 30-day hint gap (P0) - reproduced

Run `sd004HintPurgeTest`. The register lists one vote that `purge` is not wired. At ad67275 it is wired:
serve.ts:134 calls `svc.purge()` every tick, and service.ts:572 calls `people.purge(now - 2 days)`, which deletes
`platform.rate_limits` rows by `last_at` (pg-store.ts:286), the `stop_hint` bucket too.

```text
STOP handled (A opted out). m2=Chat -> hint at t (hintLast A = t)
tick(+2 days) purge -> hintLast A deleted
m3=Chat -> hit() reads no prior row, ok -> second hint at t + 2 days    -> oneHintPer30Days violated
```

### SD-023: join opt-ins do not reach the fence (P0) - reproduced

Run `sd023JoinFenceTest`: STOP (fence `*:out`), then a text join to app B writes `B:in` at receivedAt
(service.ts:1447) with no `turn.consent`. Ledger B = in, fence B = out -> `fenceMatchesLedger` violated.

### SD-024 and SD-318: START resumes only the routed app (P0, P2) - reproduced

Run `sd024StartOneAppTest`, and the simulator:

```text
init: A active, B active. m1=Stop/A/gw -> *:out, A paused, B paused, fence *:out
m2=Start/B -> B:in (keywordEvent app = routed app, consent.ts:101-102), B active; A stays paused and opted out
-> startResumesStop violated
```

The routed app is an oracle (service.ts:957-985), so the model also shows SD-318: the app that START resumes is
whatever routing picks, not the app the STOP text named.

### SD-029: leave is not atomic; the retry falls into the join flow (P0, module identity_sagas) - reproduced

Run `sd029LeaveReleasedTest`, and the simulator (`noReplyAfterStop`, seeds 0x1-0x3):

```text
init: A active. m1=Leave/A/gw. work: accounts.leave writes A:out@now (accounts.ts:425); forget removes A (accounts.ts:427-428)
throw before service.ts:1090 sets turn.consent -> rescueCompliance: no consent, no collected reply -> claim deleted, turn_failed retryable (inbox.ts:148-152)
gwCall(1) retry: A is not a member now -> leaveTarget falls through (service.ts:1085) -> join ask + stop hint
gw1=final(handled, no consent, replies reply+compliance); fence has no A opt-out   -> fenceMatchesLedger, noReplyAfterStop violated
```

### SD-031 and SD-032: STOP phrasing the reader does not read (P0) - reproduced as an oracle consequence

`StopLikely` is a text the person means as STOP that `detectKeyword` does not read as STOP. The model shows what
the misread reaches: no ledger event, an ordinary turn, a possible open turn (`stopPhraseHonored` violated at depth
2; this is also the first Apalache counterexample). The model cannot show the reading itself; corpus rows in
`evals/` test the reader.

### SD-036: proposed signals have no exit (P0) - reproduced

Run `sd036SignalTest` and the simulator: an open turn, `proposeSignal` (status `proposed`, service.ts:1954), staff
read `GET /signals` and act (`staffHandle`); no route writes the facet status, so the signal stays in every later
read (service.ts:1836) -> `signalHasExit` violated.

### SD-037: a late START from a non-member echoes opted_in (P0) - reproduced

Run `sd037LateStartTest`:

```text
m1=Start/A/gw@1 (delayed), m2=Stop/A/gw@2 handled -> *:out@2, fence *:out@2
m1 handled: non-member path writes A:in@1 and sets turn.consent opted_in with no check (service.ts:1131-1137)
gw1=final(handled:app/A/in@1); ledger A = out              -> echoMatchesLedger violated
fence resolves by at: A stays out (the verifier's note that the fence is not affected holds under that assumption)
```

### SD-073: a banned member's text is answered (P0) - reproduced

Run `sd073BannedReplyTest` and the simulator: a banned member texts; no ban check runs before `memberMessage`
(service.ts:1099-1127); the Network's reply is collected -> `bannedOnlyCompliance` violated.

### SD-087: orphan processing rows (P1) - reproduced

Run `sd087OrphanTest`: claim, crash, the sender never writes again; `purge` skips `processing` (inbox.ts:197-206);
eight days later the row is still `processing` -> `processingEnds` violated.

### SD-104: an older STOP after a newer START (P1) - reproduced

Run `sd104OlderStopTest`:

```text
init: A active. m1=Stop/A/gw@1 (delayed), m2=Start/A/gw@2 handled -> A:in@2
m1 handled: *:out@1 (no check like service.ts:1107); stopped() pauses A, sets optOut A; turn.consent opted_out scope all
ledger A = in (A:in@2 newer than *:out@1); A paused, optOut true      -> echoMatchesLedger, projectionsMatchLedger violated
```

### SD-105: leave uses processing time (P1) - reproduced

Run `sd105LateLeaveTest` and the simulator:

```text
init: A, B active. m1=Leave/A/gw@1 (delayed), m2=Start/A/gw@2 handled -> A:in@2
m1 handled at now=3: accounts.leave writes A:out@3 (accounts.ts:422, 425; no receivedAt, no ref)
ledger A = out; by send order A = in                       -> ledgerFollowsSendOrder violated
```

### SD-129: a legacy STOP fails after 5 attempts (P1) - reproduced

Run `sd129LegacyStopFailedTest`: five failed drains mark the STOP row `failed` (inbox.ts:269-273) and no event
exists -> `stopNeverLost` violated. Legacy webhook path only.

### SD-313: a context change fails the replay of an open turn (P2) - reproduced

Run `sd313ContextChangedTest` and the simulator: an open turn completes, its answer is lost, the context changes,
the gateway retries, service.ts:2103 answers `turn_context_changed`, retryable false. The row is `done` and the
person gets no reply -> `doneTurnAnswered` violated.

### SD-314 and SD-490: leave from a non-member (P2) - reproduced

Run `sd490LeaveJoinsTest` and the simulator:

```text
init: no memberships. m1=Join/A (age given, pending join A)
m2=Leave/A: leaveTarget = A, no member id (service.ts:1085) -> route() picks the pending join (service.ts:972-973) -> join reads name "Leave", age from pending -> membership A active, A:in
-> leaveNeverOptsIn violated
```

Without a pending age the same fall-through gives the join ask (SD-314).

### SD-493: a signed STOP does not cancel older legacy rows (P2) - reproduced

Run `sd493LegacyAfterSignedStopTest`: a legacy join row is pending (received at t), a signed STOP (received
t + 1) is handled, the drain then joins the person -> `nothingBeforeStopActedAfter` violated. Cutover only.

## 4. New defects (Q ids)

### Q-turn_consent-1: a STOP whose claim is sealed while its worker runs answers turn_unresolved without its consent

Rule: inbox.ts:21-23 "A compliance turn that fails is never sealed: when its consent change committed, it answers
with the consent and the confirmation"; AGENTS.md 2026-10-09 item 2 (the gateway mirrors every consent change).

Run `q1StopSealedWhileRunningTest`, and the simulator (`fenceMatchesLedger`, `projectionsMatchLedger`,
`noReplyAfterStop`):

```text
init: A active. m1=Stop/A/gw. gwCall -> row1=processing
staffResolve(1) (POST /inbound/resolve, inbox.ts:211-215), or a sweep by a later claim after missed lease renewals (inbox.ts:92-93; renewal errors are swallowed at inbox.ts:112)
the worker is alive: *:out committed (service.ts:1323), A paused
the confirmation collect finds the row not processing and throws (inbox.ts:170), or the done update finds no row (inbox.ts:117-119)
keyword -> rescueCompliance: row.status !== 'processing' -> undefined (inbox.ts:146) -> 409 turn_unresolved, retryable false (inbox.ts:128)
gw1=final(err:turn_unresolved): no consent, no confirmation; fence has no STOP; ledger A = out
```

This differs from SD-001: the worker does not die and the ledger write commits; the defect is the rescue path that
needs `status='processing'`, so its fix is different (answer the committed consent from the turn object). In the
simulator trace for `noReplyAfterStop`, the sweep also lets a second turn of the sender run while the STOP still
runs, and its join ask is sent while the ledger says opted out and the fence does not know.

Confidence: high for the code path (direct read and model run); the trigger needs staff resolve of a running STOP,
or two minutes of failed lease renewals.

### Q-turn_consent-2: a join answer handled after a newer STOP makes an active member while the ledger says opted out

Rule: README "Consent order" (an older opt-in never undoes a newer STOP; the turn reports no consent) and
AGENTS.md (the consent ledger decides; STOP is honoured). The START path has the check (service.ts:1107); the join
path (service.ts:1438-1449) does not.

Run `q2JoinAfterStopTest`, and the simulator (`projectionsMatchLedger`):

```text
init: no memberships. m1=Join/A/gw@1 ("Sam, 29"), delayed (turn_busy, then retried after the STOP)
m2=Stop/A/gw@2 handled -> *:out@2, pending join deleted (service.ts:1328)
m1 handled: parseJoinText reads name and age without a pending row (SD-080) -> join writes A:in@1, membership A active, network member optOut false
ledger A = out (A:in@1 older than *:out@2); membership active, member not opted out   -> projectionsMatchLedger violated
```

Effect: the Network treats the member as eligible (network.ts:2890 reads `optedOut`, not the ledger), so proposals
for this person reach review; the send path refuses them at send time. The welcome reply is collected but the fence
blocks it.

Confidence: plausible. The trigger needs the gateway to send the STOP before its retry of the earlier join answer;
the gateway's retry order is an assumption of the model.

## 5. Register defects of this module that the model does not reach

| Id | Why |
|---|---|
| SD-012 | Refuted in the register. The model agrees under the fence assumption: in gateway-only runs a join ask after a mirrored STOP is blocked by the fence. Replies leak only when the fence lags the ledger (SD-029, Q-turn_consent-1). |
| SD-034 | Refuted; reader detail (`replies.ts`), not on the production path. |
| SD-081 | Refuted; the model has a runtime for every app. |
| SD-130 | Refuted; projections under a phone hold are excluded from `projectionsMatchLedger`. |
| SD-212, SD-215, SD-216 | The cause is in the context builder (names and facet counts). The model has the oracle `ctxOk`; it shows only the consequence (an open turn becomes handled `context_unavailable` with no reply). |
| SD-217, SD-218, SD-434 | Participation state and windows are not in this model (`participation-window` left out). |
| SD-317 | SHARE and pending share rows are not modelled. |
| SD-433 | Notify thread replies are in `notify_capital`. |
| SD-478 | Reader meaning ("delete my info" read as STOP): an oracle choice, so the model cannot tell deletion intent from STOP. |
| SD-496 | The model keeps the lease as `arrived_at`, as the code does; the readers of `arrived_at` as an arrival time (profile suggestions) are in `profile_learning`. |
| SD-309, SD-432, SD-437 | In the plan's list but not in this task's list; not modelled. |

## 6. Reproduce

```bash
export PATH=$HOME/.local/thenetwork-tools/node_modules/.bin:$PATH
bun run quint:check quint/turn_consent.qnt            # add --verify for Apalache
node_modules/.bin/quint run quint/turn_consent.qnt --main turn_consent --backend rust --seed 0x5eed \
  --max-steps 30 --max-samples 20000 --invariant fenceMatchesLedger
node_modules/.bin/quint test quint/turn_consent.qnt --main turn_consent --match q1StopSealedWhileRunningTest
```

A fix for each id above needs an integration or e2e case that fails before the fix
(`packages/network/test/turn-consent.integration.test.ts` is the planned file name; docs/tests-policy.md).
