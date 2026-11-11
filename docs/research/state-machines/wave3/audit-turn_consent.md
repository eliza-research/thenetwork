# Audit: how completely quint/turn_consent.qnt covers its machines

Hand-written. Read-only audit (wave 3). Inputs: quint/turn_consent.qnt on this branch (HEAD f02196f) and on
claude/formal-main (06ad8e6, the drift-review edit), docs/research/quint-findings/turn_consent.md, plan section 6.2
of docs/research/2026-11-07-state-machines.md, the drift review docs/results/2026-11-09-quint-drift.md (formal-main),
and the code: packages/network/service/inbox.ts (all), service.ts (route, inbound, stopHint, elizaNotice,
memberMessage/memberUnit, stop, stopped, stopAt, consentAt, direct, join, enroll, sharedTurn, /signals),
runtime.ts (send, system, writeUnit), packages/platform/src/consent.ts (all), accounts.ts (seen, activeMembership,
recordConsent, optedIn, leave), pg-store.ts (addConsent, lastConsent, hitAll, withLock, pending, purge),
migration 0042, and formal-main's decisions.ts, inbox.ts and service.ts where they differ.

Line numbers are HEAD unless marked "fm" (claude/formal-main).

Note on branches: the model on HEAD lags formal-main by the drift-review fixes (STOP confirmation before
stopped(), deletePending on STOP, the held-number leave, collectGate, storedTurnAdmitted, noReplyAfterStop in
safety). Those are not repeated here. The code defects below exist on BOTH branches (checked in fm).

## Probes run (scratch copies only, nothing in the repo changed)

Scratch: wave3/probe/fm-probe.qnt (formal-main model + probes), head-probe.qnt.

```text
quint test fm-probe.qnt --main turn_consent --match probe
  ok probeHungStartBlocksStop   # a live START that renews its lease keeps a STOP at turn_busy for 60 x 21 ticks; safety holds
  ok probeHintLost              # the hint window is used by a failed ordinary turn; the next text gets no hint; safety holds
  ok probeLegacyLeaveDropped    # a legacy "leave A" that fails 5 times is 'failed'; ledger has no leave; safety holds
quint run head-probe.qnt --invariant leaveNeverLost --seed 0x5eed --max-steps 30 --max-samples 20000
  [violation]  (legacy Leave from a held number: done, no ledger event)
quint run fm-probe.qnt  --invariant leaveNeverLost (same bounds): no violation in random search; the targeted run test above fails it
```

## suspected_defect (new)

### D1 (P1) HELP from a member never gets an answer after its unit committed and its claim was lost (turn_failed loop)
Where: service.ts:1401 (memberUnit returns "duplicate" when network.messages has rowId), service.ts:1261-1281
(member HELP returns memberMessage's outcome), service.ts:2313 (outcome "duplicate" throws "Unresolved turn
effects"), inbox.ts:96-98 (sweep clears replies), inbox.ts:196-200 (release when no consent and no collected reply),
inbox.ts:105-111 (no row -> new insert). Same in fm (service.ts:1436, 2364).

Trigger:
1. Member of A sends HELP (compliance slot). Run 1: memberUnit commits (inbound message row `in:..:m1`, help reply
   collected into platform.inbound.replies).
2. The process stops before the done update (deploy), or staff resolve the stuck turn (inbox.ts:263 clears replies).
3. Gateway retry after 2 min: the claim sweep sets the row unresolved with replies='[]'; HELP is reclaimable -> run 2.
4. Run 2: memberUnit finds network.messages `in:..:m1` -> "duplicate"; no reply collected; sharedTurn throws.
5. rescueCompliance: processing, no consent, no collected reply -> delete the row -> turn_failed (retryable).
6. Retry: no row -> insert -> run 3 -> step 4 again. The loop ends only when the gateway gives up. HELP is never
   answered (PRD 40.3 "honor HELP"; inbox.ts header "a compliance turn is never final without an answer").
Fix: set `turn.confirmation = {id: sys:<rowId>, body: brand.help}` for HELP like STOP and leave, and let a keyword
turn whose memberUnit is "duplicate" return "handled" (sharedTurn then adds the confirmation). Test: an integration
case in turn-consent.integration.test.ts that runs a member HELP, stores its unit, resolves the claim (staff), and
retries: today the retries answer turn_failed for ever.
Model: add a per-message `unitDone` set to World; a rerun whose unit is done collects nothing; add a ghost that
counts releases after a committed unit, and an invariant `complianceAnswered` (a Help/Stop/Leave/Start that is final
at the gateway has a handled answer). Expected to fail before the fix.

### D2 (P1, suspected: needs a hung run) A live compliance turn that does not progress holds a STOP back until the gateway gives up
Where: inbox.ts:126-128 (renewal is a timer, not progress), inbox.ts:100-111 (a compliance claim waits for any
processing compliance row of the sender), service.ts:1302 + pg-store.ts:299-301 (non-member START enters the
process-wide withLock chain and a blocking pg_advisory_lock), runtime unitOfWork (network advisory lock held by a
tick). No deadline on a signed run.
Trigger: a non-member who sent STOP earlier texts START; the START run commits its opt-in and waits in
people.withLock (another join in the process is slow, or the advisory lock is held). The timer renews lease_at every
30 s. The person texts STOP: the claim finds the processing START in the compliance slot -> turn_busy, every retry.
If the START run hangs (an await with no timeout), the STOP is never claimed and has no ledger event when the
gateway stops retrying. The START's opt-in stays the newest event. probeHungStartBlocksStop reproduces it; the model's
stopNeverLost passes because the STOP never becomes final.
Fix choices: stop renewing after a run deadline (for example 2 x LEASE after the claim, then the sweep frees the
slot); or let a STOP take the compliance slot from a non-STOP compliance turn; or record the STOP event in the claim
transaction when the slot is busy (idempotent per ref). Test: integration case with a START whose run is blocked on a
promise, then a STOP.

### D3 (P2) The STOP hint window is used by a turn that fails; the person then gets 30 days of silence
Where: service.ts:1322-1323 (people.hit commits in its own transaction before direct collects the hint),
inbox.ts:141-142 (an ordinary turn that fails ends unresolved, replies cleared; undo runs only turn.onFail), compare
elizaNotice service.ts:1350-1360 which pushes an onFail undo. Same in fm service.ts:1337-1342.
Trigger: STOP (global). Later "hi" (ordinary signed turn): stopHint hit commits (keep_until +30 d), the hint is
collected, then memberMessage throws (or the process stops; the sweep clears replies). The gateway gets
turn_unresolved and sends nothing. Every text in the next 30 days: hit not ok, Network replies refused -> silence.
Rule: founder decision 2026-10-11 #22 "the person gets one hint instead". probeHintLost reproduces it; the model's
oneHintPer30Days counts used windows, not sent hints.
Fix: take the hit inside the collect transaction (pass the tx to hitAll), or push an onFail undo that deletes the
rate_limits row, plus a sweep-side undo (the sweep cannot run onFail: key the hit row by turn id as eliza_notices is).

### D4 (P2) A join answer older than the last STOP that stops between createMember and stopped() leaves an active, opted-in member for good
Where: service.ts:1646 (putMembership state active), 1648 (opt-in), 1654 (createMember upserts opted_out=false,
service.ts:786-789), 1656 (stopped only after). Join is an ordinary turn: inbox.ts:141 + 151 turn_unresolved, no retry.
Trigger: "Ari, 29" (join answer) sent, then STOP sent; the STOP is handled first; the join run writes the membership
active and its opt-in (older than the STOP, so optedIn=false), creates the member (not opted out), then the process
stops. The ledger reads opted out; membership active; network.members.opted_out=false; nothing reruns. The Network
proposes this person (review queue) although they opted out; sends are refused at send time only.
Fix: when the ledger does not read opted in, write the membership paused and the member opted out in the first
write (createMember with opted_out=true), not create-then-stop. A reconcile pass (Q-turn_consent-4 below) also covers it.

## model_gap

- G1 memberUnit idempotency per rowId (service.ts:1401) is not in the model: a rerun of Help/Start/Stop redoes its
  reply. Adding it breaks a new `complianceAnswered` invariant (D1); STOP and leave are safe because sharedTurn adds
  turn.confirmation (service.ts:2317-2321).
- G2 stopHint's hit and its collect are one step in the model (hint() + replies). Splitting them (hit commits, then
  collect) plus throwIn shows D3. Add a ghost `hintSent` set only when a gateway answer carries the hint, and
  invariant: a used window (hintLast) within 30 days has a sent hint.
- G3 join is one atomic step (phaseStep Join branch). Code: putMembership -> recordConsent -> turn.consent ->
  createMember -> stopped()/memberMessage (service.ts:1646-1658). With a crash point between createMember and stopped
  projectionsMatchLedger fails without cutShort (D4).
- G4 START sets turn.consent before the membership resumes (service.ts:1253-1257; fm startKeyword). Already open in the
  drift review; the model sets consent with the projections. Splitting it fails projectionsMatchLedger.
- G5 Request hash conflict: sharedTurn digest = sha256(raw body) (service.ts:2247); a retry with other bytes gets
  turn_conflict (final, inbox.ts:116) and a reclaim needs the same hash (inbox.ts:109). The model's gateway assumption
  says "same messageId"; it must be "same bytes". A STOP whose first run crashed and whose retry body differs (a
  re-minted networkAuthority envelope, re-serialised JSON) is lost. Add Msg.hash and a gateway action that changes it,
  or state the byte-identical assumption.
- G6 Gateway give-up is not an action: gwCall is just disabled after INBOX_KEEP. A STOP that never gets a final
  answer is never checked (D2). Add `gwGiveUp(m)` (final, no answer) after some hours.
- G7 Recycled-number hold is fixed per run (`held`), but accounts.seen (accounts.ts:181-189) sets it on the first
  non-STOP message after 12 months, and activeMembership also refuses a stale phone (accounts.ts:330). Model `held'`
  as a change caused by a message after a long tick. On HEAD this shows the held "leave" loss (fixed in fm).
- G8 eliza-takeover machine (plan 6.2) is absent: the notice row, its collect, onFail undo (inbox.ts:179-181) and the
  sweep delete (inbox.ts:96-98). Could check "notice at most once, and a failed turn returns the row".
- G9 Web, MCP and enroll opt-ins (no ref, backend time) and stopAt (service.ts:1531-1537) are absent (drift open).
  A rerun of a STOP recomputes stopAt, so its echo `at` can differ from the stored event's at. Adding them exercises
  SD-023 and echoMatchesLedger.
- G10 Claim is atomic in the model; code uses pg_try_advisory_xact_lock (inbox.ts:90-91, busy on failure) and the
  legacy drain holds the same key as a session lock for a whole handler call (inbox.ts:276-279), so a legacy drain
  holds every signed turn of that sender (STOP included) at turn_busy (drift open, extended).
- G11 route admission (inbox.ts:93, service.ts:2238-2245, staging only): after admitUntil a reclaimable STOP gets
  turn_busy for ever (priorAnswer busy) and a new one 403 (drift open).
- G12 STOP scope "app" (PLATFORM_STOP_SCOPE=app with a forced app, service.ts:1188-1191, consent.ts:34) and the forced
  app in route (service.ts:1070) that skips the SD-318 named-app START; the model has global STOP only.
- G13 One sender and one phone: number change during a STOP (pg-store.ts:142-152 copies the event to the new number),
  cross-sender locks, and the plan's "2 senders" bound are not covered.
- G14 openAllowed approximates activeMembership (accounts.ts:328-338): no suppression, review, join age, stale phone;
  sharedContext is the ctxOk oracle (SD-216 not reproduced there).
- G15 Legacy drain reads only the first 50 waiting rows (inbox.ts:37, 300-305): a STOP after 50 ordinary rows is not
  seen while a signed turn holds them. Legacy path is not live; low.
- G16 Signals: POST /signals "confirmed (acted on)" changes no consent (service.ts:2532-2540) and GET shows only 200
  rows (service.ts:2083). The plan's `signalNeverActs` is absent (vacuous by construction).

## open_carveout

- stopPhraseHonored / SD-032 (skipped): founder decision on the reader. Not fixable in scope.
- startResumesStop / SD-024 (skipped): founder decision (one app or every app). Not fixable in scope.
- fenceMatchesLedger opt-in half / SD-023 (partly skipped): enroll sets no turn.consent (service.ts:1699) and a failed
  text join is ordinary (turn_unresolved). Contract change upstream for enroll (several apps, one consent field). An
  in-repo option to ask a maintainer about: echo the routed app's current opt-in on every handled answer, so the fence
  converges on the person's next text (the contract allows `consent` on handled; its meaning is "changed").
- projectionsConverge / Q-turn_consent-4 (open): fixable now as a bug fix with a reconcile pass in service.purge (the
  precedent is reconcileAges, service.ts:604 and 850): pause active memberships and opt out network members whose ledger
  resolves opted_out (and the reverse for START, G4). It keeps the fence-first rescue, covers G4 and D4, and lets
  projectionsConverge return to safety as an eventual property (after a purge with nothing in flight).
- noReplyAfterStop / Q-turn_consent-5: open on this branch; closed in fm by collectGate (decisions.ts, runtime.ts
  writeUnit) and storedTurnAdmitted. Residual windows: the direct path reads and collects in two statements (model
  comment), and the admission check and the gateway send are not one step (see model_error M5).
- Not reproduced / not modelled: SD-216 (not reproduced, oracle), SD-217, SD-317, SD-433 (fixed, not modelled:
  participation window, SHARE, notify thread), SD-218, SD-434, SD-478 (skipped). Plan scope SD-012, SD-034, SD-081,
  SD-130, SD-309, SD-432, SD-437 are refuted in the register but missing from the findings table.

## model_error

- M1 stopNeverLost is vacuous for a STOP that never gets a final answer (gateway busy loop, then give-up) - D2.
- M2 stopNeverLost covers only kind Stop; a lost leave or START is never checked. leaveNeverLost fails on HEAD
  (held number) and in fm via the legacy drain dropping a leave after 5 failures (inbox.ts:324-334; only isStopText
  is kept pending). Fix: keep every consent-changing compliance row (STOP, leave, START) pending; add leaveNeverLost.
- M3 oneHintPer30Days counts used windows, not delivered hints (D3).
- M4 addConsent idempotency key is (ref, src) in the model, (e164, ref) in the code (migration 0007
  consent_events_ref). No current trace depends on it; a non-member START followed by a join in the same message
  writes one event in the code and could write two in the model if the model ever adds that path.
- M5 (fm model) admitted() and deliverTo run in one step; in the code storedTurnAdmitted reads the ledger, then the
  HTTP answer goes to the gateway, then the gateway sends. A STOP in the compliance slot that commits between them
  still lets the reply through until the STOP's own answer reaches the fence.
- M6 The `tick` comment "a run lives for minutes" is not enforced by the guard (21-tick steps are allowed while a run
  lives); the real gap is the missing give-up (M1).
