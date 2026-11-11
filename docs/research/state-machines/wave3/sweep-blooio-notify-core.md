# Wave 3 sweep: packages/blooio, packages/notify, packages/core

Research only. No file in the repository was changed. Hand-written from a read of the code, the models
(`quint/outbound_queue.qnt`, `quint/notify_capital.qnt`, `quint/runtime_ops.qnt`, `quint/auth_edge.qnt`,
`quint/turn_consent.qnt`), the first-wave reports (`docs/research/state-machines/blooio-notify.md`,
`core.md`), the findings files and `quint/drift.json`.

One probe was run: a copy of `quint/outbound_queue.qnt` in this scratchpad (`wave3/probe/oq_probe.qnt`) with one
line changed (item 1 below) and one added run test. `quint test --match probeBlooioLostThenStop` passed, so the
trace is reachable. Tool: quint 0.33.1.

Already covered and not repeated here: the outbound row lifecycle, lease, unknown acceptance, collected replies,
leak review, person cap, quiet hours oracle, line conversation, delivery receipt CAS (outbound_queue); notify
item, dispatch, weekly cap, surface streak, projection, erasure (notify_capital); llm-call counters (runtime_ops
M-153); chatjson loop (chatjson_loop); svc-auth skew and replay (auth_edge); age policy (join_age); reply and
opt-out readers as oracles (opportunity, turn_consent). The known defects BL-1..BL-20, NT-1..NT-10 and D1..D15
are not repeated unless this sweep adds something.

## 1. Suspected defect (P1 for Blooio mode): a sent text can end NOT_SENT, and resend after 24 h

Where: `packages/blooio/src/blooio/client.ts:219-222` (transport error -> `retryable`), `:231-241` (2xx with no
JSON, no id, or an unknown status -> `retryable`), `packages/blooio/src/outbound-queue.ts:588-600` (retryable ->
`retry_scheduled`, `in_doubt` not set), `packages/blooio/src/adapters/blooio-adapter.ts` (no `receipt`, so no
lookup), `docs/research/blooio.md:56-57` (idempotency window 24 h).

In Blooio mode (`NETWORK_CHANNEL=blooio`, `deploy/backend/server.ts:87`, `packages/network/service/main.ts:53`) an
answer that is lost after Blooio took the text, and a 2xx whose body does not parse, are classed `retryable`.
The row goes back to `retry_scheduled` with no doubt mark. Every gate runs again before the next call, so:

Trigger A (consent): r1 transactional, dispatched; Blooio accepts; the 30 s client timeout (or a socket reset)
fires -> `retry_scheduled`. The person sends STOP. The next drain ends r1 `refused_opted_out`. The person got the
text; the row, the message mirror and (for a proactive row) the person cap say it did not go out, and the cap
slot goes back (`end` -> `capRelease`, outbound-queue.ts:383). Same with `expired` (TTL), `suppressed_ineligible`,
`dropped_forgotten`, and `failed` after 6 attempts.

Trigger B (double send): as A, but the next drain holds r1 (line safety `review`: retry every hour for up to 3
days; or `held_awaiting_reply`). When it goes more than 24 h after the first call, Blooio no longer replays
`tn:r1` and sends the text a second time.

Probe: in `oq_probe.qnt`, `respond` treats `lost` in blooio mode as `rejected` (the code's mapping). Run test
`probeBlooioLostThenStop` (enqueue transactional, drain, `providerCall("lost")`, `respond`, `stop`, `tick(1)`,
drain, `decide`, `applyDecision`) ends with `status == "refused_opted_out"`, `admitted.contains("r1")` and
`not(notSentMeansNotOut)`. The shipped model cannot show this (item 2).

Fix direction: a transport error or a 2xx without a usable receipt is `unknown`, not `retryable`; or set
`in_doubt` and never let a NOT_SENT end follow a doubtful call. Production uses Eliza Cloud, which has a receipt
lookup, so the exposure is the Blooio channel only.

## 2. Model error: outbound_queue maps a lost Blooio answer to unknown_acceptance

Where: `quint/outbound_queue.qnt` `respond` (`wk.resp == "lost" or "netfail"` -> `unknown_acceptance` in both
modes) and `providerCall` (`admitted.contains(r) implies takes`: a key is replayed for ever) versus client.ts:221
and :236-241 (retryable) and the 24 h window. The ghost `resent` exempts only `recover()`. Proposal: in blooio mode
map `lost` to the retry path; add `IDEM_WINDOW = 288` and the first admission time per row, and let `providerCall`
take a fresh send after the window. Then `notSentMeansNotOut` and a new `atMostOnceToPerson` fail on item 1.

## 3. New machine: line lock session (withLine)

Where: `packages/blooio/src/outbound-queue.ts:189` (`lineChains`), `:261-275` (`withLine`), no `lock_timeout` or
`statement_timeout` anywhere in packages/blooio, packages/network/service, deploy/backend.

States per line and process: free; queued (a promise in `lineChains`); waiting (`pg_advisory_lock`, no timeout);
held (session lock on a reserved connection); released; leaked (the unlock query throws while the session lives,
then `conn.release()` returns a pooled connection that still holds the session-level lock).

Rules: the lock is eventually free when no drain runs; a drain that waits eventually holds it; the in-process
chain holds at most one waiting drain per line.

Suspected defect (P2, medium/low): a leaked session lock blocks every later drain on that line, in every replica,
until that pooled connection closes; nothing times out. A drain that hangs inside `fn` (a SQL statement that waits
on a row lock with no timeout) has the same effect, and each tick appends one more drain to the chain.
Model: extend `outbound_queue` `lockLine`/`unlockLine` with a `leak` outcome and a liveness check, or a 40-line
module `line_lock`. Value: liveness only; Quint shows it in a few steps. Fix direction: `pg_advisory_xact_lock`
inside a transaction, or close the connection when unlock fails, plus a `lock_timeout`.

## 4. Model gap: runtime_ops M-153 llm-call is counters only

Where: `packages/core/src/llm.ts:247-261, 272-276, 278-299, 306` and `quint/runtime_ops.qnt:566-580`.
The model has no deadline, no abort, no `LLMBudget`, no `fallback:false`, no non-retryable 4xx on the first
endpoint, no regrow at the cap. Not checkable today: D7 (401/402 at Surplus never falls back, llm.ts:306), D8
(deadline at or below the timeout prevents fallback, llm.ts:278, 298), `LLM_TIMEOUT_MS=0` also removing the
deadline (llm.ts:215), and the shared budget.

New machine inside it: llm-budget (`LLMBudget`, llm.ts:96-115): Open -> Exhausted, no way back; `take` per HTTP
attempt (regrows and fallbacks included), `charge` on a 200 only. One instance spans every app's engine judge
(`packages/network/service/service.ts:374-385`). Rules: `requests <= maxRequests` under any interleaving;
`spentMicro <= maxCostMicro + inflight * maxCostPerCall`; no HTTP attempt after Exhausted.

Proposal: extend M-153 with `left` (deadline), `aborted`, `fallbackOn`, an outcome `auth`, and two concurrent
calls that share `budget`. Value: moderate (attempt and wall-time bounds, D8 witness).

## 5. Model gap and new machine: notify task tokens and time

Where: `packages/notify/src/scheduler.ts:146-157, 181-183, 221-229, 236-248, 277-280`, `pg-store.ts:153-158,
165-170, 172-190`, `tokens.ts:13`. `quint/notify_capital.qnt:170` says plan "writes nothing but tokens (not
modelled)"; Part A has no time.

notify-token states: issued (plan or the rebuild in dispatch), orphaned (the plan's token when dispatch rebuilds a
smaller set, or when `recordDelivery` refuses), redeemed (first surface kept), expired (7 days), trimmed (erasure
trigger). Rules: a caller gets only the owner's items; a token redeemed through an app-bound grant has no effect on
another app's items or deliveries; an orphan token cannot close a delivery.

Suspected defect (P2, high for the path, low effect): `updatesFor(personId, app, surface, token)`
(`packages/network/service/service.ts:678`, MCP `get_updates`) calls `readUpdates` with both `token` and `app`.
`redeem` (scheduler.ts:222-229) runs before the app filter applies to the token's items: a slop-bound grant that
passes a token of an ntwrk text marks the token redeemed on that surface and closes the ntwrk delivery `acted`,
and `recordOutcome` resets that surface's streak. It returns no items, so nothing leaks. Effect: surface signals
and token state are wrong. Also `actOnDelivery` ignores `_on` (pg-store.ts:153), so a token redeemed on another
assistant credits that assistant, and the delivery's target gets neither acted nor ignored.

Time not modelled in Part A: digest and urgent due times, quiet-hours hold, the 7-day cap window, the 72 h outcome
window, item expiry (`stillNeeded` cancels a queued digest when one item expired, scheduler.ts:213), token TTL.
`sweep` is two steps (`expireDeliveries` commits, then one `recordOutcome` per delivery, scheduler.ts:277-280); a
crash between them loses the ignored counts (the model's `sweepOne` is atomic).
Proposal: extend notify_capital Part A with `now`, a token map, and a split sweep. Value: low to moderate (no
production producer calls `Notifier.add`; tokens are references, not credentials).

## 6. Model gap: line signals (safety events, receipts) under reordering

Where: `packages/network/service/service.ts:1159-1170` (safety event: `ev.line` ignored, no event time),
`packages/blooio/src/outbound-queue.ts:758-762` (`setLineSafety`: no version, undefined action clears),
`:719-745` (`applyStatus`: a receipt before the `acceptReceipt` commit finds no row and is dropped for good,
the webhook answers 200), `packages/blooio/src/blooio/webhook.ts:163-170`.
`outbound_queue.setSafety` is a free action with no provider truth; `hookRead` drops early receipts with no
invariant about it. The first-wave plan's Module 2 `LineSignals` (blooio-notify.md section 24) was never built.
Rules: provider `review` implies local `review` at quiescence (fails by design, BL-12); an accepted row to a
non-member eventually ends and loses address and text (fails, BL-5 and BL-11); a safety event for another line
changes nothing (the org has three lines, docs/research/blooio.md:189). Proposal: new module `line_signals`
with a bag of provider events (duplicates, reordering) and a `gatewayForwards` flag (BL-4). Value: moderate;
the production path (Cloud) receives none of these events, so it documents the gap more than it finds bugs.

## 7. New machine: shared-action receipts (svc-auth usage)

Where: `packages/network/service/service.ts:2171-2263` (`action_receipts` in `platform.inbound`: key =
sha256(turnId, path, key); none -> processing -> completed | unresolved; another body -> 409 `action_conflict`;
16 per turn -> 429; error -> `unresolved`, 409 not retryable; a crash after the claim leaves `processing`,
which also answers 409 for ever). turn_consent models `platform.inbound` turns but not `action_receipts`;
auth_edge only assumes that "each signed endpoint records its id and its effect in one transaction".
Rules: at most one effect per action key; a completed replay returns the stored response; `unresolved` or a
stuck `processing` implies no effect committed. The non-Pg notify path (service.ts:2219-2221) marks items seen
before it records completion, so that rule fails there (dev store only).
Proposal: extend turn_consent with an `action` sub-machine (2 keys, crash, error). Value: moderate; it turns the
auth_edge assumption into a checked fact.

## 8. Suspected defect (P2, cross-reference): Blooio OTP with an unknown acceptance

Where: `packages/platform/src/otp.ts:94-99, 190-198`. A transport timeout after Blooio took the OTP text throws;
`start` logs it, stores no challenge, and returns `{ ok: true }`. The person gets a code that never verifies, and
one of 3 hourly slots is used. A fresh key per call (`otp:<uuid>`) means no replay. Liveness only. Target model:
auth_edge otp-challenge (provider outcome oracle with `lost`).

## 9. Open carve-outs that stay

- outbound_queue leaves out the per-recipient hourly cap, the line daily caps and the new-conversation cap
  (outbound-queue.ts gate 8), `parked_invalid_timezone` at enqueue (BL-13), and kind `safety` (drift.json).
- Core readers (`replies.ts`, `guard.ts`, `pii.ts`) are oracles: D1-D5 and D13 need corpus rows, not Quint.
- `RealClock` is not monotonic (`clock.ts`); every model ticks forward only. notify_capital has `cClockBack` for
  capital only. A forward or backward step affects leases (5 min), TTLs and quiet hours in outbound_queue;
  adding a `clockStep` action would show which invariants depend on it. Low value.
- `packages/blooio/src/adapters/blooio-adapter.ts` DryRunAdapter: ids `dry_<n>` restart at 1 per process while
  `provider_message_id` is unique (migration 0015:42). It has no production or test caller (the service has its
  own DryRunAdapter in channel.ts), so it is dead code, not a machine.
