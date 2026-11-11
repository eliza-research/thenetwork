# Audit: quint/outbound_queue.qnt against the code (wave 3)

Branch audited: claude/quint-state-machines (HEAD f02196f). Read-only. Hand-written.
Inputs: quint/outbound_queue.qnt, docs/research/quint-findings/outbound_queue.md, plan 6.5 of
docs/research/2026-11-07-state-machines.md, drift review on claude/formal-main
(docs/results/2026-11-09-quint-drift.md section outbound_queue, quint/drift.json).
Code read in full: packages/blooio/src/outbound-queue.ts (oq), packages/network/service/channel.ts (ch),
packages/network/service/cloud-channel.ts (cc); the queue parts of runtime.ts (rt), store.ts (PgStore fence),
service.ts (turn receipt 2249-2295, signed turn 2296-2340, direct 1554-1561, leak review 2570-2607, inbound status/safety 1143-1155),
serve.ts tick loop.

Probes (scratch copy of the model plus run tests; not in the repo):
scratchpad/wave3/oqprobe/probe.qnt and probe2.qnt. All four probe runs pass:

| Probe | What it shows |
|---|---|
| probeLeaseRaceTest | `safety` (notSentMeansNotOut, then mirrorNotSentMeansNotOut) is violated by a 21-step trace of the unmodified model actions. The 8000-sample simulation missed it. |
| probeSameReplicaHoldTest | With a hold that commits on the drain's own replica (an action the model forbids by `phase == "idle"`), `noClaimWhileHeld` fails. |
| probeRespondOverwriteTest | The model's `respond` writes `unknown_acceptance` over a lookup's `accepted`; the code (8ca695b, OWNED guard) does not. False alarm path. |
| probeTtlOverLookupTest | The TTL end overwrites a concurrent lookup's `accepted` with `failed_unknown` (code does the same: oq:670, end() without `from`). No invariant sees it. |

## 1. Suspected code defects (new)

### D1 (P1) The SD-020 state fence compares the replica's current version, not the version the drain read
- Where: ch:203 (`lockAdmission: rt.stateCurrent(tx)`), rt:683-687 (`r.v === this.pg.seen`), store.ts:265 and :304
  (every load with fence and every save move `seen`), rt:348, rt:666-679 (drainQueue takes no store lock), rt:750-753
  (unitOfWork: unit under lock, then deliver outside it), rt:758-775 (reviewQueue / readState load the state), serve.ts:131-149.
- The gates read the in-memory Network (ch:184-191 stale and recipient, ch:194 leaks) at one instant; the admission
  fence later asks only "is the stored version the one this replica holds NOW". Any load or save on the same replica
  between the gate and the admission moves `seen` to the new version and the fence passes, although the gate decided
  on the old state.
- Trigger A (one replica): tick drain of r1 (transactional to member M) passes gate 3 (M not held); staff POST hold M
  on the same replica (unitOfWork, saves, `seen` = new xmin); the drain's admission: stateCurrent(tx) true, member row
  has no hold column, admit() only for relay rows -> claim -> Cloud sends to a held member.
- Trigger B (two replicas, SD-020 reopened): B commits the hold; A's drain is between gate 3 and admission; A runs any
  load (an inbound turn of another member, GET /queue/leak-review -> readState, the next tick's runTick) -> `seen`
  moves -> A's fence passes.
- Same for a closed item (gate 0 stale) and for leak sources of a member who joined.
- Model: `noClaimWhileHeld` / `noClaimWhenClosed` fail once `holdToggle`/`closeItem`/`refresh` may run while the
  worker is not idle (probeSameReplicaHoldTest).
- Fix directions: (1) capture `seen` at drain start (or per dispatch, before gate 0) and compare the stored xmin with
  that captured value in lockAdmission; (2) hold the store lock from gate 0 to the admission commit (not across the
  provider call); (3) re-run the hold/paused/closed part of the recipient policy from the stored state inside the
  admission transaction. Test: integration case in cloud-outbound.integration.test.ts that commits a hold from a
  queue hook (recipient or leaks) on the same runtime, expect the row not claimed.

### D2 (P1) The core-14 thread check never sees texts that may have gone out
- Where: oq:516-521 threadOf reads only rows with `sent_at is not null`; sent_at is written only by acceptReceipt
  (oq:622) and collectedReceipt (oq:801). Rows that may have gone out have no sent_at: `collected` (until the gateway
  receipt), `send_unknown`, `unknown_acceptance`, `failed_unknown` (both TTL ends, oq:670 and oq:674).
- Trigger: a signed turn collects reply r1 to member M (status collected, rt:529); the same unit queues r2 (a
  transactional text to M's address); the unit's drain runs inside inbound() before the turn returns; r2's threadOf
  excludes r1; both texts reach M. A value split across r1 and r2 (the case core-14 exists for) passes. Same with a
  Cloud deliver whose answer was lost (`unknown_acceptance`, Cloud sent it) followed by the next text.
- Model: the leak guard is a per-text oracle (`leakBad` fixed per text), so `leakGate` cannot see thread misses.
- Fix direction: threadOf reads rows with sent_at, or status in (collected, send_unknown, unknown_acceptance,
  failed_unknown, sending) with a body, ordered by coalesce(sent_at, updated_at). Corpus row or integration case.

### D3 (P2) A lease that expires before the provider call lets a lookup requeue an id that the first call then admits
- Where: oq:525 (`start` read before the admission transaction), oq:556 (lease_until = start + 5 min, never renewed,
  no check before the call), oq:288-292 (recover on every drain, outside the line lock, compares with the other
  replica's clock), oq:681-693 (lookup "never admitted" -> retry_scheduled), cc:41 (10 s abort; Cloud may still admit
  after the client gave up), cc:60-61 (lookup `rejected retryable` -> not_found). No lock_timeout or statement_timeout
  anywhere, so the admission transaction can wait on `for update of person` or `for share` of network_state, or on
  a free pool connection after a database outage.
- Trigger (probeLeaseRaceTest): w1 claims r1 with lease T+5m but its call starts after T+5m (admission waited on a
  lock or the pool, or the process stalled); w2's drain: recover -> unknown_acceptance -> lookup -> Cloud has not
  admitted -> retry_scheduled; w1's call is admitted (text sent), its acceptReceipt misses (row is retry_scheduled);
  a STOP commits; w2 dispatches r1 -> refused_opted_out (NOT_SENT, cap slot released, mirror says refused) for a text
  the person got. Without the STOP the resend is replayed by Cloud (no double text).
- Fix directions: refuse the provider call when the lease is past (or renew it with a conditional update owned by
  this worker just before the call); compute the lease from the database clock; or let the lookup report
  "ambiguous" for an id Cloud has in flight.

### D4 (P2) An error after the claim falls into drain()'s catch and puts a maybe-sent row back to retry_scheduled
- Where: oq:313-330 (`from = [row.status, ...OWNED]`), oq:569-597. If the send's catch throws (oq:580 `update
  last_error`, oq:583 wait to unknown_acceptance), the exception reaches drain()'s catch, whose `from` includes
  `sending`; the row goes to retry_scheduled (no in_doubt, no lookup) or, with the attempts used up, to parked_error
  (NOT_SENT, slot released).
- Trigger: Cloud answers ok; acceptReceipt fails (deadlock with erasure on the person lock, 40P01) -> unknown; the
  next two statements fail on a broken pooled connection; the drain's catch update succeeds on a new connection ->
  retry_scheduled; a STOP or a second database error then ends it NOT_SENT for a text Cloud took.
- Model gap: `dispatchErr` exists only before the claim, `respond(dbErr)` only for acceptReceipt.
- Fix direction: in drain()'s catch, a row found in OWNED under a receipt provider goes to unknown_acceptance
  (in_doubt), never to retry_scheduled or parked_error.

### D5 (P2) The TTL end overwrites a concurrent lookup's accepted
- Where: oq:666-671 (select, then end(row, failed_unknown) with no `from`); the lookup on another replica runs
  outside the line lock (oq:681-697).
- Trigger (probeTtlOverLookupTest): w1 selects r1 (unknown_acceptance past the TTL); w2's lookup commits accepted
  (countSend, history); w1's end writes failed_unknown. network.messages ends failed_unknown for a sent text, the
  notify projection (rt:690-716 needs accepted..read) never runs for it, applyStatus ignores it (no PROVIDER_RANK).
- Fix: pass `from: ["unknown_acceptance"]` (the same guard fixes SD-099 if used at every gate write, see C1).

### D6 (P2) A late accepted gateway receipt after the sweep records nothing
- Where: oq:674-679 sweep (created_at + 6 h), service.ts:2262 (a receipt after an `unknown` one is accepted),
  service.ts:2280 (messages update guarded on the message status), oq:800-804 (collectedReceipt guarded on
  collected/send_unknown, countSend only for moved rows).
- Trigger: gateway reports `unknown`, then `accepted` more than 6 h after collection (or the first receipt itself
  comes after 6 h): the outbound row is failed_unknown, so no sent_at, no countSend; if the sweep's drain crashed
  before storeStatuses (Q-outbound_queue-4) network.messages becomes `sent` while the row says failed_unknown.
  The streak and the core-14 thread history miss a text that went out.
- Fix direction: collectedReceipt `accepted` also moves a failed_unknown row whose note is the sweep's.

## 2. Model gaps (code paths the model leaves out)

| # | Code | Left out | Could it break an invariant? |
|---|---|---|---|
| G1 | oq:531-554 | Admission branches: account_status removed/invited -> dropped_forgotten; proactive to a non-active member -> suppressed_ineligible; Cloud binding (phone hold, membership state, review for proactive) -> dropped_forgotten; member.opted_out; checks.admit (relay, approved photos). Model has only `erased`. | Only ends rows; adds NOT_SENT ends for non-erased members (mirror says dropped_forgotten). No safety break expected. |
| G2 | oq:46, 428, 452, 459, 480; network.ts:5146 | Kind `safety` (hold notice): skips quiet hours, streak, line caps; may go to a held member. | Yes: `noClaimWhileHeld` ghost flags it; `unansweredAtMost` must count it. Needs ghost exemptions. |
| G3 | oq:350-360 | expireHeld (held_awaiting_reply past the TTL ends expired, end() without `from`). Held rows never end in the model. | No safety; liveness. Fixed in the formal-main model. |
| G4 | oq:252, oq:453 | parked_invalid_timezone (enqueue and gate 5). | No. |
| G5 | oq:473-482 | Gate 8: per-recipient hourly cap (applies to replies too), line daily cap, new-chat cap. | Liveness: a reply that waits 5 min can then fail the 1 h reply window. |
| G6 | oq:313-330 with oq:569-597 | Exceptions after the claim reach drain()'s catch (D4). | Yes: notSentMeansNotOut, capAtMost. |
| G7 | oq:525, 556, 288-292 | Lease taken from `start` before the admission wait; per-replica clocks in recover. Model's tick during `calling` reaches it (D3). | Yes (probeLeaseRaceTest). |
| G8 | oq:823-832 | decideLeak reads parked, then end(drop) with no `from`; staffDrop is atomic in the model. A release+claim by another staff member between the read and the end would be overwritten (sending -> dropped_leak_review). Narrow window. | notSentMeansNotOut if the claim's call is admitted. |
| G9 | service.ts:1554-1558 | Collected replies to non-members (direct() inside a turn) have no queue row: no queue leak guard (fixed copy only), no thread history, no countSend. Model's `collect` is member-only. | unansweredAtMost (already out of safety). |
| G10 | rt:504-529 (this branch) | No consent check on non-compliance collected replies (formal-main has collectGate). | noClaimAfterStop does not cover collected replies at all. |
| G11 | service.ts:2331 | queue.inbound (engaged) runs only for an account-eligible turn with an active binding; the model's `engaged` is unconditional. | heldOnlyWhileUnanswered: a non-eligible person's held rows stay held (by design?). |
| G12 | oq:735-742, oq:756-762 | inbound() releases held rows of every app on the line; purge(); line_conversations shared across apps; one app in the model. | Cross-app streak; not checked. |
| G13 | service.ts:621-631 | Person cap: rolling 24 h window across apps (person_cap_take). Model: one app, slots never expire, capAtMost only on day 1. | No. |
| G14 | oq:437, 439, 485; oq:552 | Hook failures that END rows: recipient throw -> suppressed_ineligible, capTake throw -> refused_person_cap, optedOut throw -> refused_opted_out. | Fail closed; liveness only. |
| G15 | rt:690-716 | Projection hook failure and retry, the inbound-receipt branch for collected rows. | mirrorSettles. |
| G16 | oq:306-307 | network_id backfill for pre-0045 rows. | No. |
| G17 | rt:321 | drainQueue: a drain that throws skips storeStatuses and the repair. | mirrorSettles only. |

## 3. Carve-outs and open items

| Item | State | Fix now in scope? |
|---|---|---|
| noStatusRegress (SD-099) | out of safety; register "refuted" | Yes, small: pass `from: [row.status]` to every gate write in dispatch (oq:432-493: end, wait, hold) and to oq:670 and oq:357; the same guard closes D5 and G8. Needs a maintainer to accept a "refuted" item; integration test can erase from a queue hook. |
| mirrorSettles (Q-outbound_queue-4) | out of safety, open | Yes: rt:676-678 repair must also take messages in `collected`/`send_unknown` and copy a row status outside WAITING plus those two. Integration test: crash between sweep commit and storeStatuses (call reconcile through drain with a throwing storeStatuses). |
| unansweredAtMost (Q-outbound_queue-5) | out of safety | Needs a maintainer decision (does a late answer count; does unknown_acceptance hold a streak slot). Code options: countSend at claim for receipt providers, or countSend in the unknown wait. |
| notSentMeansNotOut carve-outs | memberGone (rt:593-595 drops sending/unknown_acceptance rows of a forgotten member) and `resent` (webhook mode) | Acceptable as written; but the invariant is violated anyway by probeLeaseRaceTest (D3). |
| SD-257, SD-304 | skipped (founder / maintainer) | No. |
| SD-117 | liveness only | Fixed; the post-claim variant is D4. |
| SD-120 | oracle | Corpus row only. |
| Q-outbound_queue-3 | fixed on this branch (rt:718-730) | Note: formal-main still has the old storeStatuses; merge order matters. |
| Formal-main drift items | respond/dispatchErr guards, expireHeld, collectGate, `safety` kind, admission branches | Model fixes exist only on claude/formal-main; this branch's model is stale for 8ca695b. |

## 4. Model errors

- E1 (P1) `safety` is not established: probeLeaseRaceTest is a reachable violation of the committed model (21 steps).
  The simulation (8000 x 40, seed 0x5eed) missed it, and Apalache runs only 3 steps (a send needs 7). The findings
  file's "no violation" is sampling luck, as section 0.6 already found twice. Add the probe as a run test, and add
  targeted short scenarios or a reduced config (one row, no hooks) that Apalache can verify to depth about 12.
- E2 (P1) `holdToggle`, `closeItem` and `refresh` require `work.get(w).phase == "idle"` (lines 742-761). In the code a
  unit, a readState or a tick load runs on a replica while its drain is in progress. The guard hides D1.
- E3 (P2) `respond` (waitAct/endAct) and `dispatchErr` write without the code's guards (oq:580-597 OWNED since
  8ca695b; oq:321-327 `from`). probeRespondOverwriteTest: a false violation of noStatusRegressLive is reachable.
- E4 (P2) One `env.turn`: `turnFinish(false)` clears `turnLive` of every row, also rows of an earlier handled turn
  (line 688); `gatewayReceipt` needs `env.turn == "handled"`, so a receipt of turn 1 cannot arrive while turn 2 is
  open. The code keys receipts by inbound id (service.ts:2256). Too strong; hides receipt-after-next-inbound traces.
- E5 (P2) `gatewayReceipt` updates the mirror only when the row is collected/send_unknown; the code guards the
  message update on the message status (service.ts:2280) separately from the row (oq:803). Hides D6.
- E6 (P2) `rank("failed_unknown") = 5`, so accepted -> failed_unknown (D5) is not a regress in the model, and no
  invariant says "a row the provider accepted keeps a provider status".
- E7 (P2) The Cloud oracle: `netfail` means never admitted and `lookup notfound` is final; the code aborts after 10 s
  (cc:41) while Cloud may still admit. Make "netfail" sometimes admit later.
- E8 (P2) `lookupApply` calls convAfterAccept with reeng = false; the code passes the stored `reengagement`
  (oq:686 -> acceptReceipt -> countSend). The model may allow a second re-engagement the code refuses.
- E9 (P2) `engaged` is unconditional (code: service.ts:2331).
- E10 (P2) `leakGate` checks only per-text verdicts; the rule (core-14 thread check) is not represented (D2).
- E11 (P2) Stale comments: many oq:/rt:/svc: line references are old (the drift review lists them; e.g. recover is
  oq:288, reconcileUnknown oq:663, admission oq:528-564, acceptReceipt oq:607-640).
