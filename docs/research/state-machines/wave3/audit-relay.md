# Audit: how completely quint/relay.qnt covers its machines

Hand-written. Branch claude/quint-state-machines (model and code). Where the integration branch claude/formal-main differs, it is said. Read: quint/relay.qnt (all), docs/research/quint-findings/relay.md, research doc section 6.8, the drift entry for `relay` in claude/formal-main:docs/results/2026-11-09-quint-drift.md, and the code in full: packages/network/src/relay.ts, packages/network/service/relay-endpoint.ts, packages/network/service/runtime.ts, the relay parts of packages/network/src/network.ts (inbound 625-643, swapAsk 1225-1243, forget 965-1000, tick flush 3487-3497, send 4116-4210, checkRecipient 4471-4494, relayHost 5037-5110, relayMatchOf/relayDispatchCheck 5210-5260), packages/network/src/store.ts (runStored, relayRows), packages/engine/src/relay.ts (relayItem, finish, relayItemAsync, parseRelayRequest), packages/network/service/channel.ts:176-210, packages/network/service/service.ts (afterTick 538-543, staff relay route 2683-2734, slaAlerts 2817-2830), packages/blooio/src/outbound-queue.ts (NOT_SENT, end/wait/hold, line safety, decideLeak), packages/platform/src/photo-relay.ts.

Probe: a copy of the model at scratchpad/wave3/relayprobe/relay.qnt with one added action `replayInFlight` (a retry while the first request is still claimed) and a run `claim(a1,text) -> replayInFlight(a1) -> commitText(a1,pass)`: `quint test --match inFlightReplayTest` fails `failureMeansNoEffect` (section 4, D4). A probe script scratchpad/wave3/probe-parse.ts confirms the parser split in D2.

## 1. New suspected code defects

### D1 (P1). The relay always goes to the member's newest match: a reply to one match reaches another
- Code: packages/network/src/relay.ts:178-181 (`matchFor` picks the newest mutual match by `at`); network.ts:2679-2680 (`close()` returns at once for stage `done`, so a done date stays a "mutual" relay match for ever; opps are never pruned except on forget, network.ts:961); network.ts:5220-5225 (`at = meetingAt ?? createdAt`); runtime.ts:816 (`activeItems: null` in every open context), so relay-endpoint.ts:171-172 refuses any non-null `itemId` and the Cloud wire can never narrow the match.
- Trigger: A and C have a date (opp1, meetingAt day 5, then `done`). A and B are scheduled (opp2, meetingAt day 12). Day 9: C relays "had fun, dinner again?"; A gets `C says: ...`. A answers "tell them I'd love to". Eliza calls RELAY with itemId null; `matchFor(A)` sorts opp2 (at = day 12) before opp1 (day 5); B gets `A says: "I'd love to"`, and A is told "Sent." The same for "send them my number" in answer to C's swap question: the swap starts with B, B is asked, and if B says yes, A's number goes to B, not to C.
- Model: `relay-match-view` is one boolean (`w.matchOpen`); with one match the routing cannot be wrong, so no invariant can see it.
- Fix in scope: when the member has more than one open relay match and the request names none, refuse ("Which match do you mean?") instead of choosing; or offer the matches as `activeItems` so the turn names one. Add a second match to the model with an invariant "a relayed item goes to the match the member's request named or to the only open match".

### D2 (P1). A message that both asks and withdraws is a share request on the endpoint, after the turn path already ran the withdrawal
- Code: engine relay.ts:452 (NEG has no "cancel", "nvm", "never mind", "scratch", "changed my mind"), 455, 468; network/src/relay.ts:108-112 (`withdrawsSwap` has them); network.ts:640 (turn path: `cancelSwaps` when `withdrawsSwap`); relay-endpoint.ts:210-212 (the withdraw branch runs only when `parseRelayRequest` says `none`).
- Confirmed with bun: "send them my number. actually cancel that" and "send them my number, nvm" give `contact_share` and `withdrawsSwap = true`.
- Trigger: B asks to swap at 20:00. At 20:05 A writes "send them my number, nvm". /internal/turn: `withdrawsSwap` is true, `cancelSwaps(A)` finds nothing. The turn is open; Eliza calls RELAY with the same text; the endpoint parses `contact_share`; B's swap waits, so both shares pass and both numbers go. A took it back in the same message.
- Model: `commitWithdraw` and `commitShare` are separate request kinds; the turn-path withdrawal and the endpoint parse are not modelled.
- Fix in scope: one shared parser; a text that `withdrawsSwap` matches is never a share (the endpoint checks `withdrawsSwap` first). A sim/integration case with the phrases above.

### D3 (P1). A change to a relay log row older than 2 days is never written to network.relay_records; the queue admission reads the stale row
- Code: store.ts:147, 159-162 (`relayRows` writes only rows with `at >= savedAt - 2 days` or with a held row); network/src/relay.ts:338-347 (`cancelSwaps` marks `consent:withdrawn` in memory only); runtime.ts:267-269 (admission reads `reasons` from relay_records); outbound-queue.ts:459-470 (line safety `review`/`reply_only` makes a row wait hourly, `retry_scheduled`, without an attempt count) and :364 (rows expire only after 3 days); channel.ts:197 (the leak allow for the number comes from the in-memory log, still `contactShared`).
- Trigger: B and A swap at day 0 20:00; both share rows are queued. The line goes into Blooio safety `review` for 2.5 days; the rows wait (`retry_scheduled`). At day 2 + 1 h A writes "don't send my number" and is told "Okay, I won't share your number." `cancelSwaps` marks the row in memory; the save skips it (at = day 0). Day 2.5: the line clears; admission reads relay_records: `pass`, no `consent:withdrawn`; A's number goes. On claude/formal-main the SD-007 partner check (runtime.ts:277-287 there) reads the same table, so a withdrawal of the partner share after 2 days also does not stop the pair.
- Same window: `RelayDesk.unsent` on a pass older than 2 days changes only memory; relay_records keeps `pass` and `contact_shared = true`; a staff leak-review release (outbound-queue.ts:822-833, back to `pending`) of that parked row is then admitted and sent although the desk says not delivered, and A may share again (`alreadyShared` false in memory).
- Model: `persist` (relay.qnt:199-204) writes every log row on every save. The drift review on formal-main kept this as an abstraction ("every model trace is shorter than 2 days"); it hides this defect.
- Fix in scope: write every log row that this unit changed (a dirty set in RelayDesk: `log()`, `cancelSwaps`, `unsent`, `reject`), not only recent ones; or have `cancelSwaps` and `unsent` update relay_records by item id in the unit's transaction. Model: add `at` to LogRec and a scaled window to `persist`.

### D4 (P2). A Cloud retry while the first request is still running gets a non-retryable failure, then the first commits and sends
- Code: relay-endpoint.ts:193-199 (a prior receipt in `processing` answers 409 `action_unresolved`, `retryable:false`), 209-258 (the first request still runs: it waits for the network's advisory lock, which a tick or matching run can hold, and for Clef), runtime.ts:750-753.
- Trigger: A's text request waits behind a long tick; Cloud times out and sends the same signed request; it gets 409 `retryable:false`, so A is told it did not go; then the first unit commits and the text is sent. A sends again: B gets it twice.
- Model: `replay` is enabled only from phase `dead`. A probe action `replayInFlight` from phase `claimed` breaks `failureMeansNoEffect` (scratchpad/wave3/relayprobe/relay.qnt, run `inFlightReplayTest`).
- Fix in scope: answer an in-flight `processing` receipt with a retryable error (needs the upstream plugin to honour it: check plugin-network's RELAY action first, contract mirror rule), and add a claim lease (see SD-093 in section 2).

### D5 (P2). Erasing a member keeps the swap question that names them when the swap never completed
- Code: runtime.ts:596-604 (the forget path finds relayed rows only through relay_records `from_member`); network/src/relay.ts:300-307 (a passed probe is not logged: the swap question `relay:<item>:ask`, text "<first name> would like to swap numbers with you...", has no relay_records row unless the swap completes).
- Trigger: A says "send them my number"; the question goes to B; B does not answer; the swap expires. A deletes everything. B's network.messages row and platform.outbound row `relay:r_x:ask` keep A's first name. runtime.ts:559 and :596 ("their words, their number, the swap question") say it must go.
- Model: `erasedNumberGone` checks only rows with `number`; the ask row (`number: false`) is out of the rule, though `erasedRow` models the same lookup.
- Fix in scope: log a record for the passed probe (kind contact_share, decision pass, contactShared false, a reason such as `swap:asked`), or in forget also null `relay:%:ask` rows whose opportunity has A as the other participant. Model: extend the invariant to every row whose body names the erased member.

### D6 (P2). A swap waits on a question that never arrived
- Code: network/src/relay.ts:304-307 (the swap is pushed when `host.send` returns "sent", that is queued); the queue can then end the `:ask` row unsent (consent ledger, unanswered-cap hold to expiry, provider failure, leak park). Nothing removes the swap; A was told "I'll share your number as soon as they say".
- Model: `queueFail(askKey)` leaves the swap; `waitingSwapAsked` (relay.qnt:777) checks only `askRefused` (refusal inside the unit). Low harm (B must still ask), but the SD-138 rule is "only an asked swap waits".
- Fix: low priority; the endpoint sync could also drop swaps whose ask row is NOT_SENT. Model: make `waitingSwapAsked` read the ask row status.

## 2. Open carve-outs (kept out of `safety`, skipped, not reproduced, Q- residuals)

| Item | Status | Fix now in scope? |
|---|---|---|
| `noOneWayNumber` (SD-007) | Open on this branch. Fixed in code on claude/formal-main (07c5567: swapPlan preflight, flushSwapShares, admission partner check); the model is stale there (drift entry). A concrete trigger on this branch for the in-unit refusal: B asks (resets B's streak), A relays 3 texts to B, A says "send them my number": B's number to A is queued, A's number to B is refused by `conversation_streak` (network.ts:4139, engine config.ts:349 logisticsMaxOutstanding 2). Residual even on formal-main: the partner check runs only before a row is sent; if the first row is sent and the second then fails at the provider (failed, parked, expired after admission), the number has gone one way. Also D3 breaks the partner check after 2 days. | Port the model to formal-main (commitShare with preflight, paired deferral, partner check in queueSend). The provider-failure residual cannot be closed; record it as accepted or add an alert. |
| `threadOnlyDelivered`, `contactSharedImpliesDelivered` (lazy sync) | By design; stale for ever when no later decision comes (closed match, erasure). relay_records.contact_shared stays true. | Yes: run `relayUnsent` for matches with NOT_SENT relay rows in the tick (or after drainQueue stores statuses), and in the forget path. |
| `releaseReadsDelivered` (Q-relay-1 residual) | Open. service.ts:2726 calls `releaseRelay(itemId, user.id)` with no `relayUnsent` and no `canonical`. | Yes: inside that unit call `net.relayUnsent(await rt.relayUnsent(matchId))` and pass `canonical: await rt.relayParties(...)`, as the endpoint does. Also the selected-photo release (service.ts:2711-2723) runs no sync. |
| `consentFreshAtDelivery` | By design (freshness at decision). | No change. |
| `heldDecidedInTime` (SD-133) | By design; alert fixed. Note: `slaAlerted` is an in-memory set (service.ts:541), so a restart repeats alerts; harmless. | No. |
| `noStuckKey` (SD-093) | Open. claim -> crash -> every replay 409 for ever. | Yes, as a bug fix: store `claimedAt` with `processing`; a replay after a lease (longer than the worst unit) re-claims. Safe: the item id comes from the receipt, so `RelayDesk.prior` replays a committed decision, and `complete()` needs `state='processing'`, so a second commit throws. Together with D4. |
| `heldAnswerHasRow` (SD-426) | Skipped (copy). | No (copy change or founder decision). |
| SD-064 age half | Open: a Clef `minor_signal` holds without text but does not lower the member's age. | Needs a founder decision (may a model guess mark a minor?). The rules' self-disclosure normally reaches the turn path first (the relay text is the turn's own message), but that is not checked by any test. |
| SD-320 safety half | Not reproduced (relayPairAdmission refuses a held party first). | No. |
| SD-137 residual | Open: relay-endpoint.ts:258 `answer()` is inside the try; a read error after commit answers 409 (the catch writes nothing because the state is `completed`). | Yes: wrap `answer()` in its own try and answer `pass` with `delivered:false` and the "unconfirmed" notice. Model: add an `answerReadError` action from `committed`. |
| Withdrawal and the log cap | Open (unreachable in bounds). | Yes, with the D3 fix (write the change by item id), or never drop a passed contact_share row while its outbound row waits. |
| SD-319, SD-321, SD-332, SD-374, SD-375, SD-445 | Not reproduced / refuted; agreed. | - |

## 3. Model gaps (left out of the model)

| Gap | Code | Could it break an invariant? |
|---|---|---|
| Second match; newest-match routing | relay.ts:178-181, network.ts:2680, runtime.ts:816 | Yes, a routing invariant (D1). |
| Turn-path withdrawal (separate unit, before the endpoint) and the parser split | network.ts:640, relay-endpoint.ts:212, engine relay.ts:452-468 | Yes, `withdrawnNotSent` with a mixed message (D2). |
| relay_records write window | store.ts:147-162 | Yes, `withdrawnNotSent`, `rowSentImpliesPass` truth (D3). |
| Replay while in flight | relay-endpoint.ts:196-197 | Yes, `failureMeansNoEffect` (D4, probe-confirmed). |
| Parked leak-review row released back to `pending` (NOT_SENT is not terminal) | outbound-queue.ts:822-833, 209 | With D3, yes (a stale `pass` is admitted after an unsent sync). Without D3, no: admission needs `pass`. The ghost `lost` would also need to allow a later send. |
| Queue-level waits: line safety, unanswered-cap hold, queue quiet hours (`deferred_quiet_hours`), retries | outbound-queue.ts:455-480, 585-587 | Only through time (D3); the model's queue has queued/sent/ended. |
| Swap question ended in the queue | relay.ts:304-307 | `waitingSwapAsked` is too weak to see it (D6). |
| Desk view and canonical view are one `World`; staff release passes no canonical | relay.ts:209-219, service.ts:2726 | No: admission re-reads canonical (runtime.ts:297-301). |
| Trust level `watch`: Network.send refuses (`on_watch`, `other_on_watch`, network.ts:4483-4490) but the engine passes | network.ts:4481-4491 | No; it is inside the `refuse` oracle, but it is a symmetric refusal that makes swaps fail as a pair. |
| Duplicate-text rule (10 min) refuses a relayed text | network.ts:4183-4187 | No (oracle). |
| `severeBlock` opens a staff case (SD-254 fix fa81646) | relay.ts:241-245, network.ts:5058 | Not modelled; an invariant "a severe block opens a case" could be added. |
| Request kinds `none` and "photo with no approved item" (block without the desk) | relay-endpoint.ts:221-238 | No. |
| `contactOf` missing (phone on hold): refused, the other member's swap stays | relay.ts:294-295, 312-313 | No. |
| Swap rate/hold asymmetry: their share passes, mine is held, their swap is consumed with no log row | relay.ts:326-329 | No safety effect; B's request is silently dropped. |
| Unit save failure leaves the in-memory Network mutated until the next load (stateCurrent still true) | store.ts:53-58, runtime.ts:385-391, 666-669 | The queue's in-memory checks (`relaySenderOf`, `contactShareFrom`, `stale`) read it, but admission reads the database. No invariant found broken. |
| Held prune after 30 days, `prior`/`swaps` replays | relay.ts:446-448, 355-360 | No. |
| Photo: several selected items (approvedForParty needs exactly one), policy version change, photo deleted | photo-relay.ts:104-111, 186-190 | Fail closed; covered by quint/photo_relay_item.qnt. |
| `action_limit` (16 receipts per turn), `action_conflict` (same key, other body) | relay-endpoint.ts:196, 200 | No. |

## 4. Model errors

1. `persist` writes every log row (relay.qnt:199-204); the code writes only rows of the last 2 days or with a held row. Too strong; it hides D3.
2. `replay` only from `dead` (relay.qnt:432-437): assumes Cloud retries only after the process died. Too strong; it hides D4.
3. `relay-match-view` is a single boolean: routing is vacuous (D1).
4. `erasedNumberGone` checks numbers only; the rule (runtime.ts:559, 596) is "nothing that names the member" (D5).
5. `waitingSwapAsked` checks only a refusal inside the unit, not an ask row that ended (D6).
6. `numberMovesOnlyIfBothConsented` reads `g.consent.get(dst).asked`, which is true for ever after any earlier request; the rule is consent for this swap inside the TTL. Weaker than the rule; it would not catch a share resting on an expired swap.
7. `commitShare` and `tickFlush` follow the pre-fix swap; on claude/formal-main the code is all-or-nothing (drift entry). `noOneWayNumber`, `withdrawAfterSwapTest`, `oneWayDeferredTest`, `deferredShareRefusedTest` describe old code there.
8. `staffRelease` models only the text path; the selected-photo release (service.ts:2700-2723) goes through `relayRequest` with no unsent sync and no Clef hook; the model has only `staffPhotoReject`.
