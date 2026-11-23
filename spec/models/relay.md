# Relay between matched members

## Story: Relay between matched members

A matched member needs to control which text or contact details The Network shares.

### Safety rules and reachability

Check per-item consent and withdrawal, relay decisions, age restrictions, and erasure. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

Production calls the generated [relay verdict, request and consent rules](../relayDecision.md) and [item lifecycle](../relayLifecycle.md). Text parsing stays in the engine and network boundaries. Phone swaps and durable queue acceptance remain separate.

The text outcome `minorClef` is a block for a classifier `minor_signal` flag. The engine (`relayItemAsync`) records a classifier `minor_signal` flag, as a flag or a severe flag, as the age signal of the item record, and the relay desk (`RelayDesk.apply`) reads only that record: the blocked item keeps no text and the sender gets the minors policy. Changed (owner decision 2026-11-22): the desk read the flag again from the reason codes, and a caller of the engine other than the desk lost the signal. Changed: before this, a minor signal that only the classifier found kept the text and left the sender matchable, and the model disagreed with the code.

Changed (owner decision 2026-11-22): a relay thread of a friends.help teen friendship pair carries moderated text only ([friend introductions with a minor](../friendIntroAge.md), `relayKindAllowed`). The world has the stored stop `teenStopped` and `teenPair` (the network's `teenFriendPair` context: the pair passes `teenFriendAgeRule` now while teen introductions are not stopped). A number swap, a swap question and a selected photo never go from or to a minor. A teen-pair text that the rules or the classifier do not pass cleanly (`passFlagged`, a `teen:*` code, an off-platform move after a meeting) is blocked (`teenRelayHeld` names the text that did not pass cleanly). When staff stop teen introductions or the rule stops holding, the thread closes. Before this change the pair checks (now `pairOkKind` and `partiesBlockKind`) refused every minor, and no invariant stated it; `teenFriendAgeRule` and `teenSwitchOffNoMinor` now state the rule as invariants (`teenSwitchOffNoMinor` is the earlier refusal for the stopped case).

Changed (owner decision 2026-11-22, answers A2 to A5): teen introductions are on from the start, so the world has the stored stop `teenStopped` (false at the start) in place of the default-off switch `teenIntros`; `teenStop` and `teenResume` replace `teenSwitchOff`. The teen pair can be a friends.help pair or an ntwrk `Friend`-lane pair; the relay rules are the same. Q20: a teen's own words about age in a teen-pair text were held, not blocked (the engine reason `teen:age_talk`). The text outcome `teenAgeTalk` is an age that agrees with the record, and `minorRules` from a known minor in a teen pair is an age younger than the record: only the younger age opens a minor signal (`minorSignalOpens`), which ends the teen pair. A minor signal from an adult sender is blocked as before. Changed (owner decision 2026-11-22, D18): both outcomes are now blocked, as every text that does not pass cleanly is, and the younger age still opens the minor signal.

Changed (owner decision 2026-11-22, D18, "Automate relay holds too"): the relay classifier and the rules decide alone, and every reason blocks the item ([relay decision](../relayDecision.md), [item lifecycle](../relayLifecycle.md)). The model therefore has no held item (`Held`, `desk.held`, `TRec.review`, `LogRec.staff`, `LogRec.rateOnly`), no staff actions (`staffRelease`, `staffReject`), no review deadline or SLA check (`HELD_SLA`, `HOLD_WINDOW`, `expiredDesk`, `slaTick`), no hold invariants (`minorTextNeverKept`, `recordReviewMatches`, `heldSlaAlerted`, `expiredStaysUnsent`), no hold properties (`releaseReadsDelivered`, `heldDecidedInTime`, `heldAnswerHasRow`), no hold witnesses and no hold runs. The text outcome `hold` is now `flag` (a rule or classifier flag), and the new outcome `unavailable` is a classifier that could not run; both block. `teenUncleanHeld` is now `teenUncleanNeverPasses`, and the new invariants `noRelayHold` (every decided item is a pass or a block) and `uncheckedNeverSent` (a text that the classifier could not read never has an outbound row) state the decision. A rate limit or a safety hold on a member blocks the item as well; the sender asks again later.

Changed (owner decision 2026-11-22): photos no longer pass the relay desk. A photo goes through the photo offer, its receiver's yes, a safety review and a one-phone view link ([photo relay item](photo_relay_item.md)); the RELAY action answers a photo request before the desk. The model therefore has no `photo` variable, no selected-photo actions (`selectPhoto`, `reviewPhoto`, `revokePhoto`, `photoRequest`, `staffPhotoReject`, `resolvePhoto`, `fetchBytes`), no photo invariants (`bytesServedImpliesApprovedBound`, `photoHeldDecidable`, `photoRetryAfterRateHold`), no `witness_photoServed` and no photo runs. Before this change the model kept the desk photo item as a regression guard for a path that the code removed. `textSend` and `teenFriendAgeRule` lose their photo-id condition, which no send can meet now, so the teen rules do not change; `teenPhotoTest` is removed because no photo action exists to try.

Imported from `quint/relay.qnt` at `30d950e`. See [model index](README.md) for scope and commands.

Comparison 2026-11-22 (owner decision of 2026-11-22, carry-over of the relay review). The model was compared with `RelayDesk` (`packages/network/src/relay.ts`), the relay host of `ConsentNetwork` (`relayHost`), `relayItemAsync` (`packages/engine/src/relay.ts`), `relayAdmission` (`packages/network/service/runtime.ts`) and the relay endpoint after the relay fixes. These parts agree with the model:

- The age signal. `relayItemAsync` sets `ageSignal` for the rules' `minor:signal` and for a classifier `minor_signal` flag, as a flag or a severe flag. `RelayDesk.apply` asks the generated `relayStartsMinorPolicy` and calls the host's `minorSignal`, which marks the sender, writes the person minor signal (`onMinorSignal`) and closes the sender's open opportunities. `commitText` sets `minor` and closes `matchOpen` in the same way. A classifier block with `minor_signal` is the model's `minorRules` outcome (a block with the age signal). The person minor signal on the member's other apps is outside this model, which has one app ([safety_trust](safety_trust.md) checks it).
- The severe block. `RelayDesk.apply` asks the generated `relaySevereBlockCaseEvent` and calls the host's `severeBlock`, which writes the 0-point `relay_block` case event. It changes no relay state, so it stays outside this model.
- The verdict. `stepRelay` of the generated [item lifecycle](../relayLifecycle.md) gives `Blocked` or `ReadyToSend`, as `apply` does (owner decision 2026-11-22, D18).
- The classifier (owner decision 2026-11-22, D18). `relayItemAsync` asks the generated `relayClassifierReads` (the model's `classifierReads`) and `relayClassifierReading`; an error, a timeout, an answer that does not parse or a Clef cache miss gives `classifier:unavailable`, the model's `unavailable`, and blocks the text. A teen-pair text that no classifier read gets `teen:unclassified` and is blocked; the model has a classifier in every run, as the service has in every environment: Clef with the Workers AI credentials, else a classifier that cannot run (the model's `unavailable`), or the simulated one that `platform:dev`, the simulator and the tests inject (relay-endpoint.ts relayClassifierFromEnv; owner decision 2026-11-22, D18, refix). A desk call without a classifier still blocks a teen-pair text (`teen:unclassified`), because RelayDesk.decide always calls `relayItemAsync`.
- The number swap. See the note at the top of the module.
- The staff rejection. `relayAdmission` (`packages/network/service/runtime.ts`) still gives `relayRecordMayDispatch` the value `rec.review === "rejected"`, because the `review` column stays (migration 0086) and a record written before the owner decision of 2026-11-22 (D18) can carry it. No new record gets a review, so `queueSend` gives `false`: the model abstracts the legacy rejected rows away.

Known drift (code defects; the model keeps the rule and this change does not fix the code, which another area owns):

- SD-138, the swap question. `waitingSwapAsked` and `askInsideWindow` state that a swap waits only on a question that was not refused and that the question goes only inside its 15 minutes. `RelayDesk.swap` records the waiting swap before it sends the question and does not read the result of `host.send`, so a refused question still leaves a waiting swap and the member hears that the Network asked. In quiet hours the question is deferred, not refused. `askRefusedTest` and `askQuietTest` replay the rule, not this code. Fixed by the merge of the default branch (2026-11-23): `relayAdmission` now finds the live waiting swap of the question and refuses it after the consent window (`relayConsentStale`, `relay:ask_expired`), as `askInsideWindow` and `askLateTest` state, and `cancelSwaps` marks the passed shares of both directions `consent:withdrawn`, which the admission refuses through the generated `relayRecordMayDispatch` (`withdrawSwaps`, `withdrawAfterSwapTest`).
- The direct self-age (merge of the default branch, 2026-11-23; [member age](../memberAge.md)). `RelayDesk.request` asks the host's `observeSenderAge` before the desk decides: a text in which the sender states their own age under 18 directly commits that age, starts the minors policy and is refused with no relay record and no case event of the desk. In a teen pair the desk asks it only when the stated age is younger than the record (`saysYounger`), and refuses only when the sender now has the minor signal (`minorSignalOpens`); an age that agrees with the record keeps the engine path (`teen:age_talk`, blocked with a record). The model's `minorRules` outcome stands for it, but the model logs a block record with the age signal, which the code does not write on this path.
- Code locations. Many comments in the module body still give line numbers of the source revision. The functions they name are on this branch, but the numbers are stale ([model index](README.md)).

```quint
// quint-check: max-steps=25 max-samples=10000 verify-steps=3
//
// Relay between two matched members (PRD 40.5; AGENTS.md founder decision 9 and "Relay (#7)").
// Module plan: docs/research/2026-11-07-state-machines.md section 6.8. Findings: docs/research/quint-findings/relay.md.
// The model follows the code after the relay fixes on branch wave2/relay (SD-039, SD-040, SD-064, SD-133, SD-137,
// SD-138, SD-252, SD-320, SD-387, Q-relay-1).
//
// Compared with the code of this branch on 2026-11-22 (see "Comparison 2026-11-22" above the module). The
// 2026-11-09 note that the code makes a number swap all or nothing was wrong for this branch: it has no swapPlan
// and no flushSwapShares. RelayDesk.swap decides both shares, applies the other member's share first and the
// member's own share only when the first one was not refused, and the queue admission (runtime.ts
// relayAdmission) has no partner-share check. commitShare, tickFlush and queueSend follow that code, so
// noOneWayNumber and the SD-007 run tests describe this branch.
// A withdrawal now marks prepared shares in both directions. A swap question uses the live request's
// window at final admission. The current code can still defer the initial question before it is queued.
//
// Machines in this model:
//   relay-item            packages/network/src/relay.ts (RelayDesk.request, apply, deliver, forget)
//   relay-swap            packages/network/src/relay.ts (RelayDesk.swap, cancelSwaps)
//   relay-match-view      packages/network/src/network.ts (relayMatchOf), modelled as `matchOpen`
//
// Outside the bounds: the model has one match. A member with two or more live matches must name one by an
// active item of the open context, or the desk decides nothing, keeps no unnamed item and asks the member to
// send the message again with the match named (RelayDesk.matchFor, spec/relayDecision.md "A relay names its
// match when the member has more than one live match", audit SHA38). Offered summaries are distinct
// (spec/sharedContext.md "Active item summaries are distinct"). shared-relay.integration.test.ts covers both.
// Also outside: photos. A photo never passes the desk; spec/models/photo_relay_item.md models its offer, review and view.
// Also outside: the 0-point relay_block event in the sender's safety case after a block for severe words
// (spec/relayDecision.md, "A block for the sender's severe words reaches the sender's safety case"). It changes no
// relay state; shared-relay.integration.test.ts covers it.
//   action-receipt        packages/network/service/relay-endpoint.ts relayEndpoint (action_receipts)
//   relay-classifier-hook packages/engine/src/relay.ts relayItemAsync, an oracle
//
// Rules for the model (quint/README.md):
//   * One SQL transaction is one action. A unit of work (runtime.ts unitOfWork: load, desk decision, save with
//     completeAction) is one action. The claim transaction, the post-commit deliver(), the tick and the outbound
//     queue admission are separate actions.
//   * The engine relay policy, the Clef hook, the leak guard and the conversation streak are oracles: the step
//     picks their output with `nondet`, within what the code makes them return for the current parties.
//   * Other actors (STOP, block, close, a safety hold, a minor flag, erasure, quiet hours, time) are actions.
//   * Bounds: two members A and B, one match, four member requests (a1, a2 from A; b1, b2 from B).
//
// The time unit is one minute. The consent TTL (engine RELAY_LIMITS.consentTtlMs) is 15 minutes.
module relay {

  // ------------------------------------------------------------------------------------------ constants
  pure val MEMBERS = Set("A", "B")
  pure val REQS = Set("a1", "a2", "b1", "b2")
  pure val TTL = 15
  // RELAY_LOG_MAX is 5000 in the code (network/src/relay.ts RELAY_LOG_MAX). The model scales it down to 3 so that the
  // log cap is reachable in a short trace (SD-387). Everything else that reads the log reads the same cap.
  pure val LOG_MAX = 3

  pure def owner(k: str): str = if (k == "a1" or k == "a2") "A" else "B"
  pure def other(m: str): str = if (m == "A") "B" else "A"
  // The outbound id of the swap ask: "relay:<item>:ask" (RelayDesk.swap).
  pure def askKey(k: str): str = if (k == "a1") "a1:ask" else if (k == "a2") "a2:ask" else if (k == "b1") "b1:ask" else "b2:ask"

  // ------------------------------------------------------------------------------------------ types
  type World = {
    now: int,
    matchOpen: bool,          // relayMatchOf: stage scheduled or done, both said yes, no negative feedback (relayThreadOpen)
    blocked: bool,            // a block edge in either direction
    optedOut: str -> bool,    // STOP, leave, removed membership
    trustHold: str -> bool,   // a safety hold (trust level hold, account status)
    minor: str -> bool,       // age in doubt: minor, minor signal, unknown age (relayMemberOf)
    erased: str -> bool,      // the member deleted everything (forget path)
    quiet: str -> bool,       // the recipient is in quiet hours now
    teenStopped: bool,        // the stored staff stop (spec/teenIntroSwitch.md), default false
    teenPair: bool,           // RelayContext.teenFriendPair: the pair passes teenFriendAgeRule now, not stopped
  }
  // One relay log row (engine RelayRecord), keyed by item id: the decision is "pass" or "block".
  // `withdrawn`: the reason consent:withdrawn (SD-039).
  type LogRec = { kind: str, src: str, dst: str, decision: str, contactShared: bool, ageSignal: bool, withdrawn: bool }
  type Swap = { iid: str, src: str, at: int }
  // One send through Network.send (kind "relay"): `number` is true when the text carries `src`'s number.
  type Send = { key: str, iid: str, src: str, dst: str, number: bool, ask: bool, at: int }
  // One platform.outbound row. `body` is false after the forget path nulls it.
  type Row = { send: Send, status: str, body: bool }
  // One network.relay_records row (the persisted copy of the log that the queue admission reads).
  type TRec = { decision: str, dst: str, contactShared: bool, withdrawn: bool }
  // `verdict`: ghost, the desk's last decision for every item it ever decided, with no log cap (the ground truth that
  // rowSentImpliesPass compares the queue admission with; the admission reads network.relay_records).
  type Desk = {
    log: str -> LogRec, order: List[str], swaps: Set[Swap], deferred: Set[Send], thread: Set[str],
    verdict: str -> LogRec,
  }
  type Queue = { rows: str -> Row, records: str -> TRec }
  type Endpoint = {
    receipt: str -> str,   // absent | processing | completed | unresolved
    phase: str -> str,     // idle | claimed | committed | answered | failed | dead
    kind: str -> str,      // text | share | withdraw | none
    commits: str -> int,   // ghost: committed unit effects for the key
    response: str -> str,  // ghost: "" | ok | 409
  }
  type Consent = { asked: bool, live: bool, at: int }
  // A row that the queue admitted and sent, as seen at that moment.
  type Ev = {
    key: str, ask: bool, number: bool, src: str, live: bool, peerAsked: bool, fresh: bool, recPass: bool, pairOk: bool, late: bool,
    // The parties at the send: a minor on either side, a text row of a teen pair, whether teen introductions are on.
    minorParty: bool, teenText: bool, switchOn: bool,
  }
  type Ghost = {
    consent: str -> Consent,
    events: Set[Ev],
    lost: Set[str],          // send keys that ended without delivery
    askRefused: Set[str],    // swap items whose one ask to the other member was refused at send time
    flushed: Set[str],       // send keys that waited in Network.deferred and were queued by a tick
    staleRead: Set[str],     // items that an endpoint decision read as delivered (thread, contactShared) though they were lost
    teenUnclean: Set[str],   // teen-pair texts that the rules or the classifier did not pass cleanly
    unchecked: Set[str],     // texts that the classifier could not read (classifier:unavailable)
  }

  // ------------------------------------------------------------------------------------------ state
  var w: World
  var desk: Desk
  var queue: Queue
  var ep: Endpoint
  var g: Ghost

  // ------------------------------------------------------------------------------------------ helpers
  pure def mapRemove(m: str -> a, k: str): str -> a = m.keys().exclude(Set(k)).mapBy(x => m.get(x))

  // spec/friendIntroAge.md relayKindAllowed: two adults, or a text of a teen pair (owner decision 2026-11-22).
  pure def bothAdults(x: World, src: str, dst: str): bool = not(x.minor.get(src)) and not(x.minor.get(dst))
  pure def kindAllowed(x: World, src: str, dst: str, text: bool): bool = bothAdults(x, src, dst) or (text and x.teenPair)
  // A text row: no number, not the swap question.
  pure def textSend(s: Send): bool = not(s.number) and not(s.ask)

  // The parties as the engine sees them (RelayDesk.context party; the canonical view only tightens).
  pure def partiesBlockKind(x: World, src: str, dst: str, text: bool): bool =
    not(x.matchOpen) or x.blocked or not(kindAllowed(x, src, dst, text)) or x.optedOut.get(src) or x.optedOut.get(dst)
      or x.erased.get(src) or x.erased.get(dst)
  pure def partiesBlock(x: World, src: str, dst: str): bool = partiesBlockKind(x, src, dst, false)
  pure def partiesHold(x: World, src: str, dst: str): bool = x.trustHold.get(src) or x.trustHold.get(dst)

  // Network.checkRecipient for a relay send (recipientVerdict, spec/recipientEligibility.md): opted out, account, hold, minor, block.
  // Here minor stands for the code's notAdult fact: a minor, a minor signal or report, or an unknown or conflicting age.
  pure def recipientRefuses(x: World, src: str, dst: str, text: bool): bool =
    x.optedOut.get(dst) or x.erased.get(dst) or x.trustHold.get(dst) or x.blocked or not(kindAllowed(x, src, dst, text))
      or x.trustHold.get(src) or x.erased.get(src)

  // The queue admission pair check (runtime.ts relayPairAdmission, relayDispatchCheck, relayParties).
  pure def pairOkKind(x: World, src: str, dst: str, text: bool): bool =
    x.matchOpen and not(x.blocked) and kindAllowed(x, src, dst, text) and not(x.optedOut.get(src))
      and not(x.optedOut.get(dst)) and not(x.trustHold.get(src)) and not(x.trustHold.get(dst))
      and not(x.erased.get(src)) and not(x.erased.get(dst))

  // RelayDesk.log: replace or append, then drop the oldest past the cap. No item waits for staff, so no row is kept
  // past the cap (owner decision 2026-11-22, D18; SD-387 kept the row of a held item).
  pure def logPut(d: Desk, iid: str, r: LogRec): Desk = {
    val known = d.log.keys().contains(iid)
    val order1 = if (known) d.order else d.order.append(iid)
    val log1 = d.log.put(iid, r)
    val d0 = d.with("verdict", d.verdict.put(iid, r))
    if (order1.length() > LOG_MAX) {
      val drop = order1[0]
      d0.with("log", mapRemove(log1, drop)).with("order", order1.select(x => x != drop))
    } else d0.with("log", log1).with("order", order1)
  }

  // RelayDesk.unsent (relay.ts:278-283, network.ts:5229): passed items that did not go are logged as not delivered (no number
  // shared) and leave the thread.
  pure def unsentDesk(d: Desk, items: Set[str]): Desk = {
    val d1 = items.fold(d, (acc, i) =>
      if (acc.log.keys().contains(i) and acc.log.get(i).decision == "pass")
        logPut(acc, i, acc.log.get(i).with("decision", "block").with("contactShared", false))
      else acc)
    d1.with("thread", d1.thread.exclude(items))
  }

  // relay-endpoint.ts:231-232 with runtime.ts relayUnsent: before each decision in an open match, the passed items
  // whose outbound row ended unsent (NOT_SENT) go through RelayDesk.unsent. The swap question has no item row.
  pure def syncUnsent(d: Desk, q: Queue): Desk = {
    val items = q.rows.keys().filter(key => {
      val r = q.rows.get(key)
      not(r.send.ask) and r.status == "ended" and q.records.keys().contains(r.send.iid) and q.records.get(r.send.iid).decision == "pass"
    }).map(key => q.rows.get(key).send.iid)
    unsentDesk(d, items)
  }

  // Ghost: what a decision reads as delivered (the thread and contactShared rows) but did not go.
  pure def staleItems(d: Desk, gh: Ghost): Set[str] =
    d.thread.filter(i => gh.lost.contains(i)).union(
      d.log.keys().filter(i => d.log.get(i).kind == "share" and d.log.get(i).contactShared and gh.lost.contains(i)))

  // A contact share by `src` was already delivered in this match (engine relay.ts relayItem, alreadyShared).
  pure def alreadyShared(d: Desk, src: str): bool =
    d.log.keys().exists(i => d.log.get(i).kind == "share" and d.log.get(i).src == src and d.log.get(i).contactShared)

  // RelayHost.send (network.ts:5159-5168) into Network.send (network.ts:4162-4263): refused, deferred or a queued row.
  type SendOut = { d: Desk, q: Queue, res: str }
  pure def hostSend(x: World, d: Desk, q: Queue, s: Send, refuse: bool): SendOut =
    if (recipientRefuses(x, s.src, s.dst, textSend(s)) or refuse) { d: d, q: q, res: "refused" }
    else if (x.quiet.get(s.dst)) { d: d.with("deferred", d.deferred.union(Set(s))), q: q, res: "deferred" }
    else { d: d, q: q.with("rows", q.rows.put(s.key, { send: s, status: "queued", body: true })), res: "sent" }

  // RelayDesk.deliver: the thread gets the wording on "sent" and on "deferred".
  pure def deliver(x: World, d: Desk, q: Queue, s: Send, refuse: bool): SendOut = {
    val o = hostSend(x, d, q, s, refuse)
    if (o.res == "refused") o else o.with("d", o.d.with("thread", o.d.thread.union(Set(s.iid))))
  }

  // The save writes network.relay_records from the log (store.ts relayRows, writeRelayRows): an upsert per
  // log entry. A row whose log entry is gone is not touched. The code writes only entries of the last 2 days
  // (RELAY_ROW_WINDOW_MS); every trace here is shorter than that, so the model writes every entry.
  pure def persist(d: Desk, q: Queue): Queue =
    q.with("records", d.log.keys().fold(q.records, (acc, i) => {
      val r = d.log.get(i)
      acc.put(i, { decision: r.decision, dst: r.dst, contactShared: r.contactShared, withdrawn: r.withdrawn })
    }))

  // ------------------------------------------------------------------------------------------ engine oracle
  // Text outcomes the oracle may give when the parties pass: the classifier and the rules.
  // `passFlagged`: the rules pass with a soft flag (a teen:* code, an off-platform move after a meeting). It is a
  // pass for two adults and a block for a teen pair (teenRelayHeld names it).
  // `flag`: a rule or classifier flag. `unavailable`: the classifier could not run (classifier:unavailable).
  // `teenAgeTalk`: the rules read the sender's own age, and it agrees with the record (Q20); `minorRules` from a
  // known minor in a teen pair is an age younger than the record.
  pure val TEXT_OUTCOMES = Set("pass", "passFlagged", "flag", "block", "rate", "minorRules", "minorClef", "teenAgeTalk", "unavailable")
  type Decision = { decision: str, ageSignal: bool }

  // spec/relayDecision.md relayClassifierReads: the classifier reads a text with no final reason, and with no other
  // reason unless the pair is a teen pair. A safety hold on a member is a reason that is not final.
  pure def classifierReads(x: World, src: str, dst: str): bool =
    not(partiesBlockKind(x, src, dst, true)) and (not(partiesHold(x, src, dst)) or x.teenPair)

  // relayItemAsync for a text (engine relay.ts). Every reason blocks (spec/relayDecision.md, "Any reason from the
  // relay checks blocks the item"). The rules read the sender's own age on every path; the classifier's age
  // signal counts only when it reads the text.
  pure def textDecision(x: World, src: str, dst: str, tc: str): Decision = {
    val ageSignal = tc == "minorRules" or (tc == "minorClef" and classifierReads(x, src, dst))
    val clean = tc == "pass" or (tc == "passFlagged" and bothAdults(x, src, dst))
    if (clean and not(partiesBlockKind(x, src, dst, true)) and not(partiesHold(x, src, dst))) { decision: "pass", ageSignal: false }
    else { decision: "block", ageSignal: ageSignal }
  }

  // relayItem for a contact share (engine relay.ts): parties, fresh consent, one share per sender, holds and rates.
  pure def shareDecision(x: World, d: Desk, src: str, dst: str, consentAt: int, rate: bool): Decision =
    if (partiesBlock(x, src, dst) or consentAt > x.now or x.now - consentAt > TTL or alreadyShared(d, src)
        or partiesHold(x, src, dst) or rate)
      { decision: "block", ageSignal: false }
    else { decision: "pass", ageSignal: false }

  // The record RelayDesk.undelivered writes for a share that did not go.
  pure def shareBlock(src: str, dst: str): LogRec =
    { kind: "share", src: src, dst: dst, decision: "block", contactShared: false, ageSignal: false, withdrawn: false }

  // RelayDesk.apply for one decided item.
  type Applied = { d: Desk, q: Queue, gh: Ghost, told: str }
  pure def apply(x: World, d: Desk, q: Queue, gh: Ghost, iid: str, kind: str, src: str, dst: str, dec: Decision,
                 number: bool, refuse: bool): Applied = {
    val rec = { kind: kind, src: src, dst: dst, decision: dec.decision, contactShared: dec.decision == "pass" and kind == "share",
                ageSignal: dec.ageSignal, withdrawn: false }
    val d1 = logPut(d, iid, rec)
    if (dec.decision == "block") { d: d1, q: q, gh: gh, told: "refused" }
    else {
      val s = { key: iid, iid: iid, src: src, dst: dst, number: number, ask: false, at: x.now }
      val o = deliver(x, d1, q, s, refuse)
      if (o.res == "refused")
        // RelayDesk.undelivered: the log says block, no number shared.
        { d: logPut(o.d, iid, rec.with("decision", "block").with("contactShared", false)), q: o.q, gh: gh, told: "refused" }
      else { d: o.d, q: o.q, gh: gh, told: "sent" }
    }
  }

  // ------------------------------------------------------------------------------------------ init
  action init = all {
    w' = { now: 0, matchOpen: true, blocked: false,
           optedOut: MEMBERS.mapBy(_ => false), trustHold: MEMBERS.mapBy(_ => false), minor: MEMBERS.mapBy(_ => false),
           erased: MEMBERS.mapBy(_ => false), quiet: MEMBERS.mapBy(_ => false), teenStopped: false, teenPair: false },
    desk' = { log: Map(), order: List(), swaps: Set(), deferred: Set(), thread: Set(), verdict: Map() },
    queue' = { rows: Map(), records: Map() },
    ep' = { receipt: REQS.mapBy(_ => "absent"), phase: REQS.mapBy(_ => "idle"), kind: REQS.mapBy(_ => ""),
            commits: REQS.mapBy(_ => 0), response: REQS.mapBy(_ => "") },
    g' = { consent: MEMBERS.mapBy(_ => { asked: false, live: false, at: 0 }), events: Set(), lost: Set(), askRefused: Set(),
           flushed: Set(), staleRead: Set(), teenUnclean: Set(), unchecked: Set() },
  }

  // ------------------------------------------------------------------------------------------ endpoint (action receipt)
  // relay-endpoint.ts relayEndpoint, the claim transaction. The turn authority is the member's current membership.
  action claim(k: str, kind: str): bool = all {
    ep.receipt.get(k) == "absent",
    ep.phase.get(k) == "idle",
    not(w.erased.get(owner(k))),
    ep' = ep.with("receipt", ep.receipt.set(k, "processing")).with("phase", ep.phase.set(k, "claimed")).with("kind", ep.kind.set(k, kind)),
    w' = w, desk' = desk, queue' = queue, g' = g,
  }

  // The model combines the receipt claim and parsing. The shell reads the refusal and uncertainty
  // signals after claiming the receipt. Only a private request the reader has identified as explicit gets here.
  pure def privateRelayRequestAllowed(refused: bool, uncertain: bool): bool =
    not(refused) and not(uncertain)

  action claimPrivateContact(k: str, refused: bool, uncertain: bool, withdraws: bool): bool =
    claim(k, if (privateRelayRequestAllowed(refused, uncertain)) "share" else if (withdraws) "withdraw" else "none")

  // The unit commits its effects and the receipt in one transaction (runtime.ts writeUnit, completeAction last).
  pure def committed(e: Endpoint, k: str): Endpoint =
    e.with("receipt", e.receipt.set(k, "completed")).with("phase", e.phase.set(k, "committed"))
     .with("commits", e.commits.set(k, e.commits.get(k) + 1))

  action commitNone(k: str): bool = all {
    ep.phase.get(k) == "claimed", ep.kind.get(k) == "none",
    ep' = committed(ep, k),
    w' = w, desk' = desk, queue' = queue, g' = g,
  }

  // The endpoint unit before the desk decides (relay-endpoint.ts:231-232): sync the unsent items, and record in the
  // ghost what a decision that can deliver still reads as delivered (Q-relay-1, SD-252).
  pure def readGhost(x: World, d: Desk, gh: Ghost, src: str, dst: str, text: bool): Ghost =
    if (partiesBlockKind(x, src, dst, text)) gh else gh.with("staleRead", gh.staleRead.union(staleItems(d, gh)))

  // A text request (relay-endpoint.ts relayEndpoint; RelayDesk.request and RelayDesk.decide).
  action commitText(k: str, tc: str, refuse: bool): bool = {
    val src = owner(k)
    val dst = other(src)
    val d0 = syncUnsent(desk, queue)
    all {
      ep.phase.get(k) == "claimed", ep.kind.get(k) == "text",
      not(w.erased.get(src)),
      if (not(w.matchOpen)) all {
        // matchFor finds no live match: refused, nothing logged (relay.ts request).
        desk' = desk, queue' = queue, g' = g, w' = w,
      } else {
        val dec = textDecision(w, src, dst, tc)
        val a = apply(w, d0, queue, readGhost(w, d0, g, src, dst, true), k, "text", src, dst, dec, false, refuse)
        val unclean = not(bothAdults(w, src, dst)) and tc != "pass"
        val g1 = if (unclean) a.gh.with("teenUnclean", a.gh.teenUnclean.union(Set(k))) else a.gh
        all {
          desk' = a.d, queue' = persist(a.d, a.q),
          g' = if (tc == "unavailable" and classifierReads(w, src, dst)) g1.with("unchecked", g1.unchecked.union(Set(k))) else g1,
          // spec/relayDecision.md, "A relay text that says the sender is under 18 starts the minors policy": RelayDesk.apply
          // calls the host's minorSignal, which marks the sender and closes the sender's open opportunities (dropMember).
          // `minor` stands for the code's minor signal here; a sender already marked gets no second step.
          w' = if (dec.ageSignal and not(w.minor.get(src))) w.with("minor", w.minor.set(src, true)).with("matchOpen", false).with("teenPair", false)
               else if (dec.ageSignal and w.teenPair) w.with("matchOpen", false).with("teenPair", false)
               else w,
        }
      },
      ep' = committed(ep, k),
    }
  }

  // "Send them my number" (relay-endpoint.ts relayEndpoint; RelayDesk.swap).
  action commitShare(k: str, rateTheirs: bool, rateMine: bool, refuseAsk: bool, refuseTheirs: bool, refuseMine: bool): bool = {
    val src = owner(k)
    val dst = other(src)
    val now = w.now
    // The member asked: ghost consent for their own number, at their own request.
    val g0 = g.with("consent", g.consent.set(src, { asked: true, live: true, at: now }))
    val synced = syncUnsent(desk, queue)
    val g1 = readGhost(w, synced, g0, src, dst, false)
    val swaps0 = synced.swaps.filter(s => now - s.at <= TTL and s.at <= now)
    val d0 = synced.with("swaps", swaps0)
    val theirs = swaps0.filter(s => s.src == dst)
    all {
      ep.phase.get(k) == "claimed", ep.kind.get(k) == "share",
      not(w.erased.get(src)),
      if (not(w.matchOpen)) all { desk' = desk, queue' = queue, g' = g0 }
      else if (theirs.size() == 0) {
        if (swaps0.exists(s => s.src == src)) all {
          // "I already asked them" (RelayDesk.swap, NOTICE.swapAlready).
          desk' = d0, queue' = queue, g' = g1,
        } else {
          val probe = shareDecision(w, d0, src, dst, now, rateMine)
          if (probe.decision != "pass") {
            val a = apply(w, d0, queue, g1, k, "share", src, dst, probe, true, refuseMine)
            all { desk' = a.d, queue' = persist(a.d, a.q), g' = a.gh }
          } else {
            // The other member is asked once, now or not at all (noDefer: quiet hours refuse it), and only an
            // asked swap waits (RelayDesk.swap, SD-138). A refused ask logs nothing and answers "refused".
            val s = { key: askKey(k), iid: k, src: src, dst: dst, number: false, ask: true, at: now }
            if (recipientRefuses(w, src, dst, false) or refuseAsk or w.quiet.get(dst)) all {
              desk' = d0, queue' = persist(d0, queue), g' = g1.with("askRefused", g1.askRefused.union(Set(k))),
            } else {
              val d1 = d0.with("swaps", swaps0.union(Set({ iid: k, src: src, at: now })))
              val q1 = queue.with("rows", queue.rows.put(s.key, { send: s, status: "queued", body: true }))
              all { desk' = d1, queue' = persist(d1, q1), g' = g1 }
            }
          }
        }
      } else {
        nondet t = theirs.oneOf()
        val d1 = d0.with("swaps", swaps0.exclude(Set(t)))
        // Both asked: each share through the engine with its own consent (RelayDesk.swap).
        val theirRes = shareDecision(w, d1, dst, src, t.at, rateTheirs)
        val myRes = shareDecision(w, d1, src, dst, now, rateMine)
        if (theirRes.decision == "pass" and myRes.decision == "pass") {
          val first = apply(w, d1, queue, g1, t.iid, "share", dst, src, theirRes, true, refuseTheirs)
          if (first.told != "sent") {
            // The first share was refused: the second never goes (RelayDesk.swap).
            val d2 = logPut(first.d, k, shareBlock(src, dst))
            all { desk' = d2, queue' = persist(d2, first.q), g' = first.gh }
          } else {
            val second = apply(w, first.d, first.q, first.gh, k, "share", src, dst, myRes, true, refuseMine)
            all { desk' = second.d, queue' = persist(second.d, second.q), g' = second.gh }
          }
        } else {
          val a1 = if (theirRes.decision != "pass") apply(w, d1, queue, g1, t.iid, "share", dst, src, theirRes, true, false)
                   else { d: d1, q: queue, gh: g1, told: "" }
          val a2 = if (myRes.decision != "pass") apply(w, a1.d, a1.q, a1.gh, k, "share", src, dst, myRes, true, false)
                   else { d: logPut(a1.d, k, shareBlock(src, dst)), q: a1.q, gh: a1.gh, told: "refused" }
          all { desk' = a2.d, queue' = persist(a2.d, a2.q), g' = a2.gh }
        }
      },
      ep' = committed(ep, k),
      w' = w,
    }
  }

  // A member's own message can revoke consent before any signed relay action is made.
  pure def pendingSwapWithdrawn(namesOwnContact: bool, withholdsContact: bool, declinesPendingSend: bool): bool =
    declinesPendingSend or (namesOwnContact and withholdsContact)

  pure def markWithdrawn(r: LogRec, member: str): LogRec =
    if (r.kind == "share" and r.decision == "pass" and (r.src == member or r.dst == member)) r.with("withdrawn", true) else r

  pure def withdrawSwaps(d: Desk, member: str): Desk = d
    .with("swaps", d.swaps.filter(s => s.src != member))
    .with("log", d.log.keys().mapBy(k => markWithdrawn(d.log.get(k), member)))
    .with("verdict", d.verdict.keys().mapBy(k => markWithdrawn(d.verdict.get(k), member)))

  action readPendingSwapReply(src: str, namesOwnContact: bool, withholdsContact: bool, declinesPendingSend: bool): bool = {
    val withdraws = pendingSwapWithdrawn(namesOwnContact, withholdsContact, declinesPendingSend)
    val nextDesk = if (withdraws) withdrawSwaps(desk, src) else desk
    all {
      MEMBERS.contains(src),
      desk' = nextDesk,
      g' = if (withdraws) g.with("consent", g.consent.set(src, g.consent.get(src).with("live", false))) else g,
      queue' = if (withdraws) persist(nextDesk, queue) else queue,
      w' = w, ep' = ep,
    }
  }

  // The signed relay action responds "Okay, I won't share your number" for a recognized withdrawal.
  // The pending request goes, and both directions of a prepared swap lose consent at admission (SD-039).
  action commitWithdraw(k: str): bool = {
    val src = owner(k)
    val d1 = withdrawSwaps(desk, src)
    all {
      ep.phase.get(k) == "claimed", ep.kind.get(k) == "withdraw",
      not(w.erased.get(src)),
      desk' = d1, queue' = persist(d1, queue),
      g' = g.with("consent", g.consent.set(src, g.consent.get(src).with("live", false))),
      ep' = committed(ep, k),
      w' = w,
    }
  }

  // Any throw before or inside the save (lock: authority changed, a unit error): nothing commits; the catch
  // marks the key unresolved and answers 409 (relay-endpoint.ts relayEndpoint, action_unresolved).
  action unitThrow(k: str): bool = all {
    ep.phase.get(k) == "claimed",
    ep' = ep.with("receipt", ep.receipt.set(k, "unresolved")).with("phase", ep.phase.set(k, "failed")).with("response", ep.response.set(k, "409")),
    w' = w, desk' = desk, queue' = queue, g' = g,
  }

  // rt.unitOfWork calls deliver() after the commit (runtime.ts:778-782). An error there is logged and the unit's
  // result is returned, so the endpoint answers the committed decision (SD-137).
  action postCommitDeliverError(k: str): bool = all {
    ep.phase.get(k) == "committed",
    ep' = ep.with("phase", ep.phase.set(k, "answered")).with("response", ep.response.set(k, "ok")),
    w' = w, desk' = desk, queue' = queue, g' = g,
  }

  action answer(k: str): bool = all {
    ep.phase.get(k) == "committed",
    ep' = ep.with("phase", ep.phase.set(k, "answered")).with("response", ep.response.set(k, "ok")),
    w' = w, desk' = desk, queue' = queue, g' = g,
  }

  // The process stops between two awaits.
  action crash(k: str): bool = all {
    ep.phase.get(k) == "claimed" or ep.phase.get(k) == "committed",
    ep' = ep.with("phase", ep.phase.set(k, "dead")),
    w' = w, desk' = desk, queue' = queue, g' = g,
  }

  // Cloud times out and sends the same signed request again (relay-endpoint.ts relayEndpoint, the receipt replay).
  action replay(k: str): bool = all {
    ep.phase.get(k) == "dead",
    ep' = ep.with("response", ep.response.set(k, if (ep.receipt.get(k) == "completed") "ok" else "409"))
            .with("phase", ep.phase.set(k, if (ep.receipt.get(k) == "completed") "answered" else "dead")),
    w' = w, desk' = desk, queue' = queue, g' = g,
  }

  // ------------------------------------------------------------------------------------------ tick and queue
  // Network.tick flushes deferred sends (network.ts:3529-3542): each runs every send-time check again. A relayed
  // item refused now goes through RelayDesk.unsent (SD-252, Q-relay-1).
  action tickFlush(refused: Set[Send]): bool = {
    val due = desk.deferred.filter(s => not(w.quiet.get(s.dst)))
    val dropped = due.filter(s => recipientRefuses(w, s.src, s.dst, textSend(s)) or refused.contains(s))
    val queued = due.exclude(dropped)
    val rows1 = queued.fold(queue.rows, (acc, s) => acc.put(s.key, { send: s, status: "queued", body: true }))
    val d1 = unsentDesk(desk.with("deferred", desk.deferred.exclude(due)), dropped.filter(s => not(s.ask)).map(s => s.iid))
    all {
      due.size() > 0,
      refused.subseteq(due),
      desk' = d1,
      queue' = persist(d1, queue.with("rows", rows1)),
      g' = g.with("lost", g.lost.union(dropped.map(s => s.key))).with("flushed", g.flushed.union(queued.map(s => s.key))),
      w' = w, ep' = ep,
    }
  }

  pure def relayRecordMayDispatch(passed: bool, rejected: bool, withdrawn: bool): bool =
    passed and not(rejected) and not(withdrawn)

  // The outbound queue's final admission and send (runtime.ts relayAdmission).
  action queueSend(key: str): bool = {
    val r = queue.rows.get(key)
    val s = r.send
    // The swap question goes only while its swap still waits inside its 15 minutes (runtime.ts:268-272, SD-138);
    // an item row needs a passed record for this recipient, not withdrawn (runtime.ts:274-276, SD-039).
    val recOk = if (s.ask) desk.swaps.exists(sw => sw.iid == s.iid and sw.src == s.src and sw.at <= w.now and w.now - sw.at <= TTL)
      else (queue.records.keys().contains(s.iid) and queue.records.get(s.iid).dst == s.dst
        and relayRecordMayDispatch(queue.records.get(s.iid).decision == "pass", false, queue.records.get(s.iid).withdrawn))
    val ok = recOk and pairOkKind(w, s.src, s.dst, textSend(s))
    val c = g.consent.get(s.src)
    // Ground truth, apart from what the admission read: the desk's own last decision for the item (no log cap, no
    // persisted copy), or for the swap question its swap still waiting in the desk.
    val truth = if (s.ask) desk.swaps.exists(sw => sw.iid == s.iid and sw.src == s.src)
      else (desk.verdict.keys().contains(s.iid) and desk.verdict.get(s.iid).decision == "pass" and desk.verdict.get(s.iid).dst == s.dst
        and not(desk.verdict.get(s.iid).withdrawn))
    val ev = { key: key, ask: s.ask, number: s.number, src: s.src, live: c.live, peerAsked: g.consent.get(s.dst).asked,
               fresh: w.now - c.at <= TTL, recPass: truth, pairOk: pairOkKind(w, s.src, s.dst, textSend(s)), late: s.ask and w.now - s.at > TTL,
               minorParty: not(bothAdults(w, s.src, s.dst)), teenText: textSend(s) and w.teenPair, switchOn: not(w.teenStopped) }
    all {
      queue.rows.keys().contains(key),
      r.status == "queued",
      queue' = queue.with("rows", queue.rows.set(key, r.with("status", if (ok) "sent" else "ended"))),
      g' = if (ok) g.with("events", g.events.union(Set(ev))) else g.with("lost", g.lost.union(Set(key))),
      w' = w, desk' = desk, ep' = ep,
    }
  }

  // A queued row ends unsent for a reason outside the relay: the unanswered rule expires it, the queue's leak
  // guard parks it, or the provider fails it for good (outbound-queue.ts).
  action queueFail(key: str): bool = all {
    queue.rows.keys().contains(key),
    queue.rows.get(key).status == "queued",
    queue' = queue.with("rows", queue.rows.set(key, queue.rows.get(key).with("status", "ended"))),
    g' = g.with("lost", g.lost.union(Set(key))),
    w' = w, desk' = desk, ep' = ep,
  }

  // ------------------------------------------------------------------------------------------ other actors
  action stop(m: str): bool = all {
    not(w.optedOut.get(m)),
    w' = w.with("optedOut", w.optedOut.set(m, true)),
    desk' = desk, queue' = queue, ep' = ep, g' = g,
  }
  action blockPair: bool = all {
    not(w.blocked),
    w' = w.with("blocked", true),
    desk' = desk, queue' = queue, ep' = ep, g' = g,
  }
  // A closed match, or negative feedback after the meeting (the avoid edge; spec/relayDecision.md, "Negative feedback after a meeting ends the relay thread").
  action closeMatch: bool = all {
    w.matchOpen,
    w' = w.with("matchOpen", false),
    desk' = desk, queue' = queue, ep' = ep, g' = g,
  }
  action safetyHold(m: str): bool = all {
    not(w.trustHold.get(m)),
    w' = w.with("trustHold", w.trustHold.set(m, true)),
    desk' = desk, queue' = queue, ep' = ep, g' = g,
  }
  // A new minor signal, report or unknown age: the member is not teen ready, so a teen pair ends too.
  action minorFlag(m: str): bool = all {
    not(w.minor.get(m)),
    w' = w.with("minor", w.minor.set(m, true)).with("teenPair", false),
    desk' = desk, queue' = queue, ep' = ep, g' = g,
  }
  // Owner decision 2026-11-22. The match is a teen friendship pair from its start (friends.help or the ntwrk
  // Friend lane): A is a teen-ready minor, B is teen ready and within 2 years, and teen introductions are not
  // stopped. Abstraction: the model starts the teen thread before any relay item, so the items of an adult thread
  // do not mix with it.
  action teenPairOpen: bool = all {
    w.matchOpen, not(w.blocked), not(w.teenPair), not(w.teenStopped), MEMBERS.forall(m => not(w.minor.get(m))),
    desk.log.keys().size() == 0, queue.rows.keys().size() == 0,
    w' = w.with("minor", w.minor.set("A", true)).with("teenPair", true),
    desk' = desk, queue' = queue, ep' = ep, g' = g,
  }
  // The teen sweep (network.ts teenSweep): a birthday that makes a member 19, a report, a conflict or a bar ends
  // the pair rule; the relay thread with a minor closes.
  action teenPairEnds: bool = all {
    w.teenPair,
    w' = w.with("teenPair", false).with("matchOpen", false),
    desk' = desk, queue' = queue, ep' = ep, g' = g,
  }
  // Staff stop teen introductions: every relay thread with a minor closes (teen_intros_off).
  action teenStop: bool = all {
    not(w.teenStopped),
    w' = w.with("teenStopped", true).with("teenPair", false)
          .with("matchOpen", if (bothAdults(w, "A", "B")) w.matchOpen else false),
    desk' = desk, queue' = queue, ep' = ep, g' = g,
  }
  // One admin turns them on again; a thread that the stop closed stays closed.
  action teenResume: bool = all {
    w.teenStopped,
    w' = w.with("teenStopped", false),
    desk' = desk, queue' = queue, ep' = ep, g' = g,
  }
  action setQuiet(m: str, b: bool): bool = all {
    w.quiet.get(m) != b,
    w' = w.with("quiet", w.quiet.set(m, b)),
    desk' = desk, queue' = queue, ep' = ep, g' = g,
  }
  action timePass(dt: int): bool = all {
    w' = w.with("now", w.now + dt),
    desk' = desk, queue' = queue, ep' = ep, g' = g,
  }

  // The forget path for `m` (network.ts forget -> RelayDesk.forget; runtime.ts writeUnit):
  // swaps with them gone, the thread emptied, deferred sends to them or about them
  // dropped, outbound rows with member_id = m nulled, and the rows of items relayed FROM m (by their relay_records
  // row, `relay:<item>` and `relay:<item>:ask`) nulled too; what of these still waits ends unsent (SD-040).
  pure def erasedRow(q: Queue, m: str, key: str): bool = {
    val r = q.rows.get(key)
    r.send.dst == m or (r.send.src == m and q.records.keys().contains(r.send.iid))
  }
  action erase(m: str): bool = {
    val gone = desk.deferred.filter(s => s.dst == m or s.src == m)
    val d1 = desk.with("swaps", desk.swaps.filter(s => s.src != m and other(s.src) != m))
                 .with("thread", Set()).with("deferred", desk.deferred.exclude(gone))
    val ended = queue.rows.keys().filter(key => erasedRow(queue, m, key) and queue.rows.get(key).status == "queued")
    val rows1 = queue.rows.keys().mapBy(key => {
      val r = queue.rows.get(key)
      if (erasedRow(queue, m, key)) r.with("body", false).with("status", if (r.status == "queued") "ended" else r.status) else r
    })
    all {
      not(w.erased.get(m)),
      w' = w.with("erased", w.erased.set(m, true)),
      desk' = d1, queue' = persist(d1, queue.with("rows", rows1)),
      g' = g.with("lost", g.lost.union(gone.map(s => s.key)).union(ended))
            .with("consent", g.consent.set(m, g.consent.get(m).with("live", false))),
      ep' = ep,
    }
  }

  // One fault at most per committed request keeps the random simulation on long, interesting traces; faults
  // still combine across requests. "rateTheirs"/"rateMine": the engine's rate limit; "refuseAsk",
  // "refuseTheirs", "refuseMine": Network.send refuses (the conversation streak or the leak guard).
  pure val FAULTS = Set("none", "rateTheirs", "rateMine", "refuseAsk", "refuseTheirs", "refuseMine")
  action commit(k: str, tc: str, fault: str): bool =
    if (ep.kind.get(k) == "text") commitText(k, tc, fault == "refuseMine")
    else if (ep.kind.get(k) == "share")
      commitShare(k, fault == "rateTheirs", fault == "rateMine", fault == "refuseAsk", fault == "refuseTheirs", fault == "refuseMine")
    else if (ep.kind.get(k) == "withdraw") commitWithdraw(k)
    else commitNone(k)

  action step = any {
    nondet k = REQS.oneOf()
    nondet kind = Set("text", "share", "withdraw").oneOf()
    if (kind == "share") claimPrivateContact(k, false, false, false) else claim(k, kind),
    all {
      REQS.exists(k => ep.phase.get(k) == "claimed"),
      nondet k = REQS.filter(k => ep.phase.get(k) == "claimed").oneOf()
      nondet tc = TEXT_OUTCOMES.oneOf()
      nondet fault = FAULTS.oneOf()
      commit(k, tc, fault),
    },
    all {
      REQS.exists(k => ep.phase.get(k) != "idle"),
      nondet k = REQS.filter(k => ep.phase.get(k) != "idle").oneOf()
      any { unitThrow(k), postCommitDeliverError(k), answer(k), crash(k), replay(k) },
    },
    nondet refused = desk.deferred.powerset().oneOf()
    tickFlush(refused),
    all {
      queue.rows.keys().exists(key => queue.rows.get(key).status == "queued"),
      nondet key = queue.rows.keys().filter(key => queue.rows.get(key).status == "queued").oneOf()
      any { queueSend(key), queueFail(key) },
    },
    // Other actors share one branch, so the random simulation does not end most traces early.
    nondet m = MEMBERS.oneOf()
    any { stop(m), safetyHold(m), minorFlag(m), erase(m), blockPair, closeMatch },
    nondet m = MEMBERS.oneOf()
    nondet b = Set(false, true).oneOf()
    nondet dt = Set(5, 20).oneOf()
    any { setQuiet(m, b), timePass(dt) },
    // The teen friendship pair: it opens before the first item, and the sweep or the stop ends it.
    any { teenPairOpen, teenPairEnds, teenStop, teenResume },
  }

  // ------------------------------------------------------------------------------------------ derived
  pure def numberRows(q: Queue, src: str): Set[Row] =
    q.rows.keys().map(key => q.rows.get(key)).filter(r => r.send.number and r.send.src == src)
  def numberSent(src: str): bool = numberRows(queue, src).exists(r => r.status == "sent")
  def numberPending(src: str): bool =
    numberRows(queue, src).exists(r => r.status == "queued") or desk.deferred.exists(s => s.number and s.src == src)

  // ------------------------------------------------------------------------------------------ invariants
  // Founder decision 9 and relay.ts:15-17: a number goes out only after both members asked.
  val numberMovesOnlyIfBothConsented = g.events.forall(e => e.number implies e.peerAsked)

  // Per-item consent (founder decision 9; engine relay.ts:15-17): after "don't send my number" the endpoint
  // answers "Okay, I won't share your number" (relay-endpoint.ts NOTICE.withdrawn). No number of that member goes out after it (SD-039).
  val withdrawnNotSent = g.events.forall(e => e.number implies e.live)

  // AGENTS.md "Relay (#7)": only what the relay passed goes out, and only inside an open match of two eligible
  // adults with no block, at final dispatch (runtime.ts:247-256 comment).
  val rowSentImpliesPass = g.events.forall(e => e.recPass and e.pairOk)

  // network/src/relay.ts:105-106 and engine relay.ts:493-496 (the thread keeps the delivered wording only), and engine
  // relay.ts:127 ("contactShared: A contact share was delivered"; alreadyShared reads it). The desk corrects its
  // state lazily (RelayDesk.unsent before each endpoint decision and in the tick), so the rule is checked where it
  // matters: no endpoint decision that can deliver reads a lost item as delivered (Q-relay-1, SD-252).
  val decisionsReadDelivered = g.staleRead.size() == 0

  // Owner decision 2026-11-22, D18 (spec/relayLifecycle.md): every item the desk decided is a pass or a block; nothing
  // waits for staff, so the desk keeps no member's words (SD-064 is met by construction).
  val noRelayHold = desk.verdict.keys().forall(i => desk.verdict.get(i).decision == "pass" or desk.verdict.get(i).decision == "block")

  // spec/relayDecision.md, "A classifier that cannot run blocks the text": a text that the classifier could not read
  // never has an outbound row.
  val uncheckedNeverSent = g.unchecked.forall(i => not(queue.rows.keys().contains(i)))

  // runtime.ts:587 ("keep only the id. Nothing that names the member stays") and runtime.ts:624-631: after the
  // forget path no stored outbound body holds the erased member's number (SD-040).
  val erasedNumberGone = queue.rows.keys().forall(key => {
    val r = queue.rows.get(key)
    (r.body and r.send.number) implies not(w.erased.get(r.send.src))
  })

  // relay.ts:15 ("the other member is asked once"): a waiting swap rests on an ask that was not refused, and
  // the ask arrives inside the 15 minutes it names (relay.ts:166) (SD-138).
  val waitingSwapAsked = desk.swaps.forall(s => not(g.askRefused.contains(s.iid)))
  val askInsideWindow = g.events.forall(e => e.ask implies not(e.late))

  // relay-endpoint.ts relayEndpoint (idempotent on the key): one effect per key.
  val effectAtMostOncePerKey = REQS.forall(k => ep.commits.get(k) <= 1)
  // relay-endpoint.ts relayEndpoint (unitOfWork completeAction): the receipt, the log, the messages and the rows commit together.
  val completedIffCommitted = REQS.forall(k => (ep.receipt.get(k) == "completed") iff (ep.commits.get(k) == 1))
  // The Cloud wire (contract.ts RelaySendResponse; relay-endpoint.ts relayEndpoint retryable:false): a failure answer
  // means nothing was done, so Cloud tells the member it did not go (SD-137).
  val failureMeansNoEffect = REQS.forall(k => ep.response.get(k) == "409" implies ep.commits.get(k) == 0)

  // spec/relayDecision.md, "A relay text that says the sender is under 18 starts the minors policy": every item
  // that carried an age signal left its sender marked as a minor (audit ST-D2).
  val ageSignalStartsMinorsPolicy = desk.verdict.keys().forall(i => desk.verdict.get(i).ageSignal implies w.minor.get(desk.verdict.get(i).src))

  // Owner decision 2026-11-22 (spec/friendIntroAge.md teenFriendAgeRule, relayKindAllowed): a row sent with a minor
  // on either side is a text of a teen pair that passed the rule at that moment; never a number or a swap question.
  val teenFriendAgeRule = g.events.forall(e => e.minorParty implies (e.teenText and not(e.number) and not(e.ask)))
  // While teen introductions are stopped no row goes to or from a minor (the rule before the owner decision).
  val teenSwitchOffNoMinor = g.events.forall(e => e.minorParty implies e.switchOn) and (w.teenPair implies not(w.teenStopped))
  // spec/teenIntroSwitch.md teenRelayHeld: a teen-pair text without a clean pass is never passed (owner decision
  // 2026-11-22, D18: it is blocked, and no staff release exists).
  val teenUncleanNeverPasses = g.teenUnclean.forall(i =>
    desk.verdict.keys().contains(i) implies desk.verdict.get(i).decision != "pass")

  val safety = and {
    numberMovesOnlyIfBothConsented,
    withdrawnNotSent,
    rowSentImpliesPass,
    decisionsReadDelivered,
    noRelayHold,
    uncheckedNeverSent,
    erasedNumberGone,
    waitingSwapAsked,
    askInsideWindow,
    effectAtMostOncePerKey,
    completedIffCommitted,
    failureMeansNoEffect,
    ageSignalStartsMinorsPolicy,
    teenFriendAgeRule,
    teenSwitchOffNoMinor,
    teenUncleanNeverPasses,
  }

  // ---- Properties outside `safety` (checked one by one; see the findings file).
  // SD-007 (not in this fix batch; the register verdict is "refuted" and the findings ask to open it again): "nobody's
  // number goes one way" (network/src/relay.ts RelayDesk.swap). Still violated: a deferred share refused by the tick, a
  // queued row that ends unsent, a refusal of the second share in one unit, and (new with the SD-039 fix) a
  // withdrawal that stops only the withdrawer's share. A fix needs a design decision on an all-or-nothing swap.
  val noOneWayNumber = MEMBERS.forall(m => numberSent(m) implies (numberSent(other(m)) or numberPending(other(m))))
  // The state forms of decisionsReadDelivered. They fail between the loss of a row and the next endpoint
  // decision (the sync is lazy by design), and for ever when no later endpoint decision comes (a closed match,
  // an erased member). No decision reads the stale state then.
  val threadOnlyDelivered = desk.thread.forall(i => not(g.lost.contains(i)))
  val contactSharedImpliesDelivered = desk.log.keys().forall(i => {
    val r = desk.log.get(i)
    (r.kind == "share" and r.contactShared) implies not(g.lost.contains(i))
  })
  // The engine checks consent freshness at decision time only; delivery after quiet hours is by design
  // ("I'll pass that on when it's a reasonable hour", RelayDesk NOTICE.late). Not a stated rule at delivery time.
  val consentFreshAtDelivery = g.events.forall(e => e.number implies e.fresh)
  // SD-093: a claimed key does not stay processing with no worker. Liveness, not safety.
  val noStuckKey = REQS.forall(k => not(ep.receipt.get(k) == "processing" and ep.phase.get(k) == "dead"))

  // ------------------------------------------------------------------------------------------ witnesses
  // Both members asked inside 15 minutes and both numbers went.
  val witness_bothNumbersGo = not(numberSent("A") and numberSent("B"))
  // A text was blocked, and the sender was told at once (owner decision 2026-11-22, D18).
  val witness_textBlocked = not(desk.verdict.keys().exists(i => desk.verdict.get(i).kind == "text" and desk.verdict.get(i).decision == "block"))
  // A deferred relay row went out after quiet hours.
  val witness_deferredFlushed = not(g.events.exists(e => g.flushed.contains(e.key)))
  // A withdrawal committed.
  val witness_withdrawn = not(REQS.exists(k => ep.kind.get(k) == "withdraw" and ep.receipt.get(k) == "completed"))
  // A text that the classifier could not read was blocked.
  val witness_uncheckedBlocked = g.unchecked.size() == 0
  // A lost passed item was taken back by RelayDesk.unsent (the log says block with send:refused semantics).
  val witness_unsentSynced = not(desk.log.keys().exists(i => desk.log.get(i).decision == "block" and g.lost.contains(i)
    and queue.records.keys().contains(i) and queue.records.get(i).decision == "block"))
  // A text of a teen friendship pair reached the other member.
  val witness_teenTextSent = not(g.events.exists(e => e.minorParty))

  // ------------------------------------------------------------------------------------------ run tests
  // shared-relay.integration.test.ts:102-115: A asks, B is asked once, B asks back, both numbers go.
  run swapBothAskTest =
    init
      .then(claim("a1", "share")).then(commitShare("a1", false, false, false, false, false)).then(answer("a1"))
      .expect(desk.swaps.size() == 1 and queue.rows.keys().contains("a1:ask"))
      .then(queueSend("a1:ask"))
      .then(timePass(5))
      .then(readPendingSwapReply("A", true, false, false))
      .then(claimPrivateContact("a2", false, true, false)).then(commitNone("a2")).then(answer("a2"))
      .then(claimPrivateContact("b1", true, false, true)).then(commitWithdraw("b1")).then(answer("b1"))
      .expect(desk.swaps.exists(sw => sw.src == "A") and not(numberPending("A")) and not(numberPending("B")))
      .then(claimPrivateContact("b2", false, false, false)).then(commitShare("b2", false, false, false, false, false)).then(answer("b2"))
      .then(queueSend("a1")).then(queueSend("b2"))
      .expect(numberSent("A") and numberSent("B") and safety)

  run pendingSwapPronounWithdrawalTest =
    init
      .then(claim("a1", "share")).then(commitShare("a1", false, false, false, false, false)).then(answer("a1"))
      .then(readPendingSwapReply("A", false, false, true))
      .then(claim("b1", "share")).then(commitShare("b1", false, false, false, false, false)).then(answer("b1"))
      .expect(desk.swaps.exists(sw => sw.src == "B") and not(numberPending("A")) and not(numberPending("B")) and safety)

  // A withdrawal recorded while both shares are queued stops both directions at final admission.
  run withdrawAfterSwapTest =
    init
      .then(claim("a1", "share")).then(commitShare("a1", false, false, false, false, false)).then(answer("a1"))
      .then(claim("b1", "share")).then(commitShare("b1", false, false, false, false, false)).then(answer("b1"))
      .expect(numberPending("A") and numberPending("B"))
      .then(readPendingSwapReply("A", false, false, true))
      .expect(queue.records.get("a1").withdrawn and queue.records.get("b1").withdrawn)
      .then(queueSend("a1")).then(queueSend("b1"))
      .expect(queue.rows.get("a1").status == "ended" and queue.rows.get("b1").status == "ended" and safety)

  run withdrawBeforeSwapQuestionTest =
    init
      .then(claim("a1", "share")).then(commitShare("a1", false, false, false, false, false)).then(answer("a1"))
      .then(readPendingSwapReply("A", false, false, true)).then(queueSend("a1:ask"))
      .expect(queue.rows.get("a1:ask").status == "ended" and safety)

  // SD-137 (fixed): the unit commits, deliver() throws after the commit; the endpoint still answers the decision.
  run postCommitDeliverErrorTest =
    init
      .then(claim("a1", "text")).then(commitText("a1", "pass", false)).then(postCommitDeliverError("a1"))
      .expect(queue.rows.keys().contains("a1") and ep.response.get("a1") == "ok" and failureMeansNoEffect)

  // SD-064 (fixed, flag half): Clef reads a minor's words; the item is blocked and the minors policy starts.
  run clefMinorNotKeptTest =
    init
      .then(claim("a1", "text")).then(commitText("a1", "minorClef", false)).then(answer("a1"))
      .expect(desk.log.get("a1").decision == "block" and desk.log.get("a1").ageSignal and queue.rows.keys().size() == 0
        and noRelayHold and w.minor.get("A") and not(w.matchOpen) and ageSignalStartsMinorsPolicy)

  // Owner decision 2026-11-22, D18: a flagged text is blocked at once and nothing reaches B; a clean text then passes.
  run flagBlocksTest =
    init
      .then(claim("a1", "text")).then(commitText("a1", "flag", false)).then(answer("a1"))
      .expect(desk.log.get("a1").decision == "block" and queue.rows.keys().size() == 0 and noRelayHold)
      .then(claim("a2", "text")).then(commitText("a2", "pass", false)).then(answer("a2"))
      .then(queueSend("a2"))
      .expect(g.events.exists(e => e.key == "a2") and not(g.events.exists(e => e.key == "a1")) and safety)

  // Owner decision 2026-11-22, D18: the classifier could not run; the text is blocked and never queued.
  run unavailableBlocksTest =
    init
      .then(claim("a1", "text")).then(commitText("a1", "unavailable", false)).then(answer("a1"))
      .expect(desk.log.get("a1").decision == "block" and g.unchecked.contains("a1") and queue.rows.keys().size() == 0
        and uncheckedNeverSent and safety)

  // A closed match before admission: the queued row never goes (shared-relay.integration.test.ts:174-212).
  run closeBeforeAdmissionTest =
    init
      .then(claim("a1", "text")).then(commitText("a1", "pass", false)).then(answer("a1"))
      .then(closeMatch).then(queueSend("a1"))
      .expect(queue.rows.get("a1").status == "ended" and g.events.size() == 0 and rowSentImpliesPass)

  // SD-007 (open): the swap goes one way. A's share to B is queued at once; B's share to A waits in
  // Network.deferred (A is in quiet hours); B blocks A; the tick refuses the deferred share. The tick also takes
  // the deferred share back (SD-252): its log row no longer says contactShared.
  run oneWayDeferredTest =
    init
      .then(claim("a1", "share")).then(commitShare("a1", false, false, false, false, false)).then(answer("a1"))
      .then(setQuiet("A", true))
      .then(claim("b1", "share")).then(commitShare("b1", false, false, false, false, false)).then(answer("b1"))
      .then(queueSend("a1"))
      .then(blockPair).then(setQuiet("A", false)).then(tickFlush(Set()))
      .expect(numberSent("A") and not(numberSent("B")) and not(numberPending("B")) and not(noOneWayNumber)
        and not(desk.log.get("b1").contactShared) and contactSharedImpliesDelivered)

  // SD-007 (open) by the queue path: both rows are queued; B's row goes; A's row ends unsent. Until the next
  // endpoint decision, the log still says A's number was shared.
  run oneWayQueueTest =
    init
      .then(claim("a1", "share")).then(commitShare("a1", false, false, false, false, false)).then(answer("a1"))
      .then(claim("b1", "share")).then(commitShare("b1", false, false, false, false, false)).then(answer("b1"))
      .then(queueSend("b1")).then(queueFail("a1"))
      .expect(not(noOneWayNumber) and not(contactSharedImpliesDelivered))

  // SD-252 (fixed): A's number share ends unsent at the provider. A asks again: the endpoint first takes the lost
  // share back, so alreadyShared does not block the new share, and B is asked again.
  run unsentShareResetTest =
    init
      .then(claim("a1", "share")).then(commitShare("a1", false, false, false, false, false)).then(answer("a1"))
      .then(claim("b1", "share")).then(commitShare("b1", false, false, false, false, false)).then(answer("b1"))
      .then(queueSend("b1")).then(queueFail("a1"))
      .then(timePass(20))
      .then(claim("a2", "share")).then(commitShare("a2", false, false, false, false, false)).then(answer("a2"))
      .expect(desk.log.get("a1").decision == "block" and not(desk.log.get("a1").contactShared)
        and desk.swaps.exists(s => s.iid == "a2") and queue.rows.keys().contains("a2:ask") and contactSharedImpliesDelivered and safety)

  // SD-252 (fixed), deferral: B's share to A waits for A's quiet hours; the morning send refuses it (the tick's
  // own checks); RelayDesk.unsent writes the record as not shared.
  run deferredShareRefusedTest =
    init
      .then(claim("a1", "share")).then(commitShare("a1", false, false, false, false, false)).then(answer("a1"))
      .then(setQuiet("A", true))
      .then(claim("b1", "share")).then(commitShare("b1", false, false, false, false, false)).then(answer("b1"))
      .expect(desk.log.get("b1").contactShared and queue.records.get("b1").contactShared)
      .then(setQuiet("A", false)).then(tickFlush(desk.deferred))
      .expect(not(queue.records.get("b1").contactShared) and queue.records.get("b1").decision == "block" and contactSharedImpliesDelivered)

  // SD-040 (fixed): the swap completes, then A deletes everything. B's row no longer holds A's number.
  run erasedNumberGoneTest =
    init
      .then(claim("a1", "share")).then(commitShare("a1", false, false, false, false, false)).then(answer("a1"))
      .then(claim("b1", "share")).then(commitShare("b1", false, false, false, false, false)).then(answer("b1"))
      .then(queueSend("a1")).then(queueSend("b1"))
      .then(erase("A"))
      .expect(not(queue.rows.get("a1").body) and erasedNumberGone and safety)

  // SD-040 (fixed): A's share to B still waits in the queue when A deletes everything; it ends unsent with no body.
  run erasedQueuedShareTest =
    init
      .then(claim("a1", "share")).then(commitShare("a1", false, false, false, false, false)).then(answer("a1"))
      .then(claim("b1", "share")).then(commitShare("b1", false, false, false, false, false)).then(answer("b1"))
      .then(erase("A"))
      .expect(queue.rows.get("a1").status == "ended" and not(queue.rows.get("a1").body) and erasedNumberGone)

  // SD-138 (fixed): the ask is refused at send time: nothing waits and A is told it did not go. In quiet hours the
  // ask is not deferred either. An ask that waits in the queue past the swap window never goes.
  run askRefusedTest =
    init
      .then(claim("a1", "share")).then(commitShare("a1", false, false, true, false, false)).then(answer("a1"))
      .expect(desk.swaps.size() == 0 and not(queue.rows.keys().contains("a1:ask")) and waitingSwapAsked)
  run askQuietTest =
    init
      .then(setQuiet("B", true))
      .then(claim("a1", "share")).then(commitShare("a1", false, false, false, false, false)).then(answer("a1"))
      .expect(desk.swaps.size() == 0 and desk.deferred.size() == 0 and not(queue.rows.keys().contains("a1:ask")))
  run askLateTest =
    init
      .then(claim("a1", "share")).then(commitShare("a1", false, false, false, false, false)).then(answer("a1"))
      .then(timePass(20)).then(queueSend("a1:ask"))
      .expect(queue.rows.get("a1:ask").status == "ended" and g.events.size() == 0 and askInsideWindow)

  // SD-387 (scaled: LOG_MAX = 3 for 5000): the log cap drops the oldest row; no row waits for staff now (owner
  // decision 2026-11-22, D18).
  run logCapTest =
    init
      .then(claim("a1", "text")).then(commitText("a1", "flag", false)).then(answer("a1"))
      .then(claim("a2", "text")).then(commitText("a2", "block", false)).then(answer("a2"))
      .then(claim("b1", "text")).then(commitText("b1", "block", false)).then(answer("b1"))
      .then(claim("b2", "text")).then(commitText("b2", "block", false)).then(answer("b2"))
      .expect(desk.log.keys() == Set("a2", "b1", "b2") and queue.records.get("a1").decision == "block" and safety)

  // Q-relay-1 (fixed): a passed text is queued and its wording enters the relay thread; the provider refuses the
  // row; B's next request first takes the wording out of the thread, so B's decision reads only what went.
  run threadDropsUndeliveredTest =
    init
      .then(claim("a1", "text")).then(commitText("a1", "pass", false)).then(answer("a1"))
      .then(queueFail("a1"))
      .expect(desk.thread.contains("a1") and not(threadOnlyDelivered))
      .then(claim("b1", "text")).then(commitText("b1", "pass", false)).then(answer("b1"))
      .expect(not(desk.thread.contains("a1")) and desk.thread.contains("b1") and threadOnlyDelivered and decisionsReadDelivered)

  // Owner decision 2026-11-22. A teen friendship pair: a clean text from A (a minor) reaches B.
  run teenTextTest =
    init
      .then(teenPairOpen)
      .then(claim("a1", "text")).then(commitText("a1", "pass", false)).then(answer("a1"))
      .then(queueSend("a1"))
      .expect(g.events.exists(e => e.minorParty and e.teenText) and safety)

  // A teen pair: "send them my number" is refused and nothing is queued.
  run teenShareTest =
    init
      .then(teenPairOpen)
      .then(claim("a1", "share")).then(commitShare("a1", false, false, false, false, false))
      .expect(queue.rows.keys().size() == 0 and safety)

  // A teen pair: a text that the rules pass only with a flag is blocked, not sent (owner decision 2026-11-22, D18).
  run teenFlaggedTest =
    init
      .then(teenPairOpen)
      .then(claim("a1", "text")).then(commitText("a1", "passFlagged", false))
      .expect(desk.log.get("a1").decision == "block" and queue.rows.keys().size() == 0 and teenUncleanNeverPasses and safety)

  // Staff stop teen introductions: the thread closes and a later text is refused.
  run teenSwitchOffTest =
    init
      .then(teenPairOpen).then(teenStop)
      .then(claim("a1", "text")).then(commitText("a1", "pass", false))
      .expect(queue.rows.keys().size() == 0 and not(w.matchOpen) and safety)

  // The same flagged text between two adults passes (the adult relay is unchanged).
  run adultFlaggedTest =
    init
      .then(claim("a1", "text")).then(commitText("a1", "passFlagged", false)).then(answer("a1"))
      .then(queueSend("a1"))
      .expect(g.events.exists(e => e.key == "a1" and not(e.minorParty)) and safety)

  // Q20 and D18: A (a known minor) says an age that agrees with the record: blocked, no minor signal, and A stays
  // in the teen pair.
  run teenAgeTalkTest =
    init
      .then(teenPairOpen)
      .then(claim("a1", "text")).then(commitText("a1", "teenAgeTalk", false))
      .expect(desk.log.get("a1").decision == "block" and not(desk.log.get("a1").ageSignal)
              and w.teenPair and queue.rows.keys().size() == 0 and safety)
  // Q20 and D18: A says an age younger than the record: blocked; the minor signal opens and ends the teen pair.
  run teenYoungerAgeTest =
    init
      .then(teenPairOpen)
      .then(claim("a1", "text")).then(commitText("a1", "minorRules", false))
      .expect(desk.log.get("a1").decision == "block" and desk.log.get("a1").ageSignal and not(w.teenPair)
              and not(w.matchOpen) and safety)
}
```
