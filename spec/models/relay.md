# Relay between matched members

## Story: Relay between matched members

A matched member needs to control which text or contact details The Network shares.

### Safety rules and reachability

Check per-item consent and withdrawal, relay decisions, age restrictions, and erasure. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

Production calls the generated [relay verdict, request and consent rules](../relayDecision.md) and [item lifecycle](../relayLifecycle.md). Text parsing stays in the engine and network boundaries. An operative condition before or after the request can supply uncertainty to the private request rule. A prior condition can still apply when a separate clause follows it or it names a private item that must come first. Reports, quotations, instructions to proceed and unrelated remarks supply no such evidence. A clear statement about the same named actor, action, specified item, and explicit repeat or manner can settle a prior request to wait. The reader keeps those details when it compares the condition with the completion. An ordinary statement of purpose does not identify a transfer recipient. If the condition explicitly names the transfer recipient, the reader also compares that recipient with the request. A question leaves the condition open. The reader can recognize a complete quoted body as an explicit text relay. The body follows the ordinary text path and privacy checks. The reader checks a complete recipient against the selected match, including a recipient after a dash or the words “over to.” An unresolved destination after a question, in a quotation, or in a separate directive leaves the private request unapproved. An ordinary courtesy or an independent scheduling statement can follow a complete request. Phone swaps and durable queue acceptance remain separate.

The [member age rules](../memberAge.md#a-near-birthday-gives-an-estimate-for-the-present-age) distinguish direct age evidence from moderation. The engine can block a message when the sender gives a near-birthday or current school-year cue. The shell checks the cue's speaker and excludes another person's quoted or reported words, a hypothetical and a complete adult school role. A teacher's attribution can explain the speaker's own grade. Only a direct age disclosure can lower the durable relay age. The signed relay and standalone corpus exercise the reader. The model takes the evidence category as input.

### Story: Keep an estimate in the relay item

A member's own estimate makes the message unsafe to relay. The estimate does not lower the durable age, but it is an age signal of the item, so the desk starts the minors policy and closes the sender's open matches, as for any other age signal ([relay decision](../relayDecision.md)). The signed turn can independently record an age and close an unsafe match before the relay action. A member can report what another person said without that report becoming their own age. Changed (merge of develop, 2026-11-23): develop kept the match open after an estimate -> the estimate starts the minors policy, because the age signal rule of the relay decision (audit ST-D2) has no exception for an estimate.

The rules and the relay classifier decide alone: every decided item is a pass or a block (`noRelayHold`), and the sender is told at once. The text outcome `flag` is a rule or classifier flag, and `unavailable` is a classifier that could not run (an error, a timeout, an answer that does not parse or a Clef cache miss gives `classifier:unavailable`); both block, and a text that the classifier could not read never gets an outbound row (`uncheckedNeverSent`). A rate limit or a safety hold on a member blocks the item as well; the sender asks again later. The model has a classifier in every run, as the service has in every environment: Clef with the Workers AI credentials, else a classifier that cannot run, or the simulated one that `platform:dev`, the simulator and the tests inject (`relayClassifierFromEnv`). Changed (owner decision 2026-11-22, D18, "Automate relay holds too"): a text that the rules or the classifier do not clear is blocked, because no relayed text waits for staff. A passed item can still wait in `Network.deferred` while the recipient is in quiet hours (a relay send has the timing `logistics` in `Network.timingOf`); that is a delay of a decided pass, not a hold, and the tick runs every send-time check again before it queues the item (`deferredFlushTest`, `witness_deferredFlushed`).

The text outcome `minorClef` is a block for a classifier `minor_signal` flag. `relayItemAsync` records a classifier `minor_signal` flag, as a flag or a severe flag, and the rules' `minor:signal` as the age signal of the item record. `RelayDesk.apply` asks the generated `relayStartsMinorPolicy` with the sender's stated age, the rules' sign about the sender (`relaySenderMinorSign`) and the classifier flag; the host's `minorSignal` marks the sender, writes the person minor signal (`onMinorSignal`) and closes the sender's open opportunities. The outcome `minorOther` is a rules `minor:signal` for an age that a possessive word gives to another person ("my 15 year old will be with me"): the item is blocked with the age signal on its record, keeps no text, and the sender is not marked (`ageSignalStartsMinorsPolicy`, `ageSignalBlocks`, the upstream control of commit 9de643b5). The blocked item keeps no text. The person minor signal on the member's other apps is outside this model, which has one app ([safety_trust](safety_trust.md) checks it). A severe block also writes the 0-point `relay_block` case event (`relaySevereBlockCaseEvent`); it changes no relay state, so it stays outside this model.

A relay thread of a teen friendship pair, on friends.help or in the ntwrk `Friend` lane, carries moderated text only ([friend introductions with a minor](../friendIntroAge.md), `relayKindAllowed`). The world has the stored stop `teenStopped` (false at the start) and `teenPair` (the network's `teenFriendPair` context: the pair passes `teenFriendAgeRule` now while teen introductions are not stopped). A number swap, a swap question and a selected photo never go from or to a minor. A teen-pair text that the rules or the classifier do not pass cleanly (`passFlagged`, a `teen:*` code, an off-platform move after a meeting) is blocked (`relayVerdict` of [relay decision](../relayDecision.md), `teenUncleanNeverPasses`); a text that no classifier could read is blocked for every pair (`classifier:unavailable`). A teen's own words about age are blocked: the outcome `teenAgeTalk` is an age that agrees with the record, and `minorRules` from a known minor in a teen pair is an age younger than the record; only the younger age opens a minor signal (`minorSignalOpens`, Q20), which ends the teen pair. When staff stop teen introductions or the rule stops holding, the thread closes. `teenFriendAgeRule` and `teenSwitchOffNoMinor` state the pair rule and the stopped case. Changed (owner decision 2026-11-22, answers A2 to A5): a teen friendship pair may relay moderated text, because the owner allowed teen friendship introductions.

Photos do not pass the relay desk. A photo goes through the photo offer, its receiver's yes, an automatic check and a bound view link ([photo relay item](photo_relay_item.md)); the RELAY action answers a photo request before the desk. Changed (owner decision D14 of 2026-11-22): the desk has no photo item, because photo relay has its own flow.

For an unselected name, the shell checks whether another live match has a different counterpart with that name. The model takes that check as an input. A refusal completes the request without changing the swap or delivery state. Several matches with the same named counterpart count as one. The photo model checks refusal before creating or updating a draft.

Imported from `quint/relay.qnt` at `30d950e`. See [model index](README.md) for scope and commands.

The model agrees with `RelayDesk` (`packages/network/src/relay.ts`), the relay host of `ConsentNetwork` (`relayHost`), `relayItemAsync` (`packages/engine/src/relay.ts`), `relayAdmission` (`packages/network/service/runtime.ts`) and the relay endpoint. `stepRelay` of the generated item lifecycle gives `Blocked` or `ReadyToSend`, as `apply` does. The number swap: `RelayDesk.swap` decides both shares, applies the other member's share first and the member's own share only when the first one was not refused; `relayAdmission` refuses a swap question after its consent window (`relayConsentStale`, `relay:ask_expired`; `askInsideWindow`, `askLateTest`), and `cancelSwaps` marks the passed shares of both directions `consent:withdrawn`, which `relayRecordMayDispatch` refuses (`withdrawSwaps`, `withdrawAfterSwapTest`).

Known drift (the model keeps the rule; another area owns the code):

- The review column. `relayAdmission` gives `relayRecordMayDispatch` the value `rec.review === "rejected"` from the `review` column of `network.relay_records` (migration 0086). No record gets a review now, so `queueSend` takes it as false. The read and the column must go with a migration that settles the old rows.

```quint
// quint-check: max-steps=25 max-samples=10000 verify-steps=3
// quint-witness: witness_bothNumbersGo swapBothAskTest
// quint-witness: witness_deferredFlushed deferredTextFlushedTest
//
// Relay between two matched members (PRD 40.5; AGENTS.md founder decision 9 and "Relay (#7)").
// Module plan: docs/research/2026-11-07-state-machines.md section 6.8. Findings: docs/research/quint-findings/relay.md.
// The model follows the code after the relay fixes on branch wave2/relay (SD-039, SD-040, SD-064, SD-133, SD-137,
// SD-138, SD-252, SD-320, SD-387, Q-relay-1).
//
// RelayDesk.swap decides both shares, applies the other member's share first and the member's own share only
// when the first one was not refused, and the queue admission (runtime.ts relayAdmission) has no partner-share
// check. commitShare, tickFlush and queueSend follow that code, so noOneWayNumber and the SD-007 run tests
// describe this branch.
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
    otherAge: Set[str],      // texts whose only age signal is the age of another person (minorOther)
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

  // RelayDesk.unsent (relay.ts, network.ts): passed items that did not go are logged as not delivered (no number
  // shared) and leave the thread.
  pure def unsentDesk(d: Desk, items: Set[str]): Desk = {
    val d1 = items.fold(d, (acc, i) =>
      if (acc.log.keys().contains(i) and acc.log.get(i).decision == "pass")
        logPut(acc, i, acc.log.get(i).with("decision", "block").with("contactShared", false))
      else acc)
    d1.with("thread", d1.thread.exclude(items))
  }

  // relay-endpoint.ts with runtime.ts relayUnsent: before each decision in an open match, the passed items
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

  // RelayHost.send (network.ts) into Network.send (network.ts): refused, deferred or a queued row.
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
  // pass for two adults and a block for a teen pair (relayVerdict of spec/relayDecision.md).
  // `flag`: a rule or classifier flag. `unavailable`: the classifier could not run (classifier:unavailable).
  // `teenAgeTalk`: the rules read the sender's own age, and it agrees with the record (Q20); `minorRules` from a
  // known minor in a teen pair is an age younger than the record. `minorOther`: the rules' minor:signal for an age
  // that a possessive word gives to another person ("my 15 year old"); relaySenderMinorSign is false for it.
  pure val TEXT_OUTCOMES = Set("pass", "passFlagged", "flag", "block", "rate", "minorRules", "minorClef", "minorOther", "teenAgeTalk", "unavailable")
  // `startsMinor`: relayStartsMinorPolicy has a stated age, a sign about the sender or a classifier minor_signal flag.
  type Decision = { decision: str, ageSignal: bool, startsMinor: bool }

  // spec/relayDecision.md relayClassifierReads: the classifier reads a text with no final reason, and with no other
  // reason unless the pair is a teen pair. A safety hold on a member is a reason that is not final.
  pure def classifierReads(x: World, src: str, dst: str): bool =
    not(partiesBlockKind(x, src, dst, true)) and (not(partiesHold(x, src, dst)) or x.teenPair)

  // relayItemAsync for a text (engine relay.ts). Every reason blocks (spec/relayDecision.md, "Any reason from the
  // relay checks blocks the item"). The rules read the sender's own age on every path; the classifier's age
  // signal counts only when it reads the text.
  pure def textDecision(x: World, src: str, dst: str, tc: str): Decision = {
    val startsMinor = tc == "minorRules" or (tc == "minorClef" and classifierReads(x, src, dst))
    val clean = tc == "pass" or (tc == "passFlagged" and bothAdults(x, src, dst))
    if (clean and not(partiesBlockKind(x, src, dst, true)) and not(partiesHold(x, src, dst))) { decision: "pass", ageSignal: false, startsMinor: false }
    else { decision: "block", ageSignal: startsMinor or tc == "minorOther", startsMinor: startsMinor }
  }

  // relayItem for a contact share (engine relay.ts): parties, fresh consent, one share per sender, holds and rates.
  pure def shareDecision(x: World, d: Desk, src: str, dst: str, consentAt: int, rate: bool): Decision =
    if (partiesBlock(x, src, dst) or consentAt > x.now or x.now - consentAt > TTL or alreadyShared(d, src)
        or partiesHold(x, src, dst) or rate)
      { decision: "block", ageSignal: false, startsMinor: false }
    else { decision: "pass", ageSignal: false, startsMinor: false }

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
           flushed: Set(), staleRead: Set(), teenUnclean: Set(), unchecked: Set(), otherAge: Set() },
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
  // signals after claiming the receipt. An operative unmet condition can supply uncertainty before
  // the private request. The reader checks authorship, scope and any stated completion.
  // Only a direct transfer clause supplies a private request. A transfer attributed to someone else
  // supplies none. A later independent directive can supply one, whether it follows a sentence
  // boundary or a comma after a tell/ask/let clause with no condition or refusal word, and an
  // ordinary text envelope still follows the text path. Signed tests cover this reader boundary.
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

  // The shell reads the name. RelayDesk applies the existing relayRequestAddress.md guard before swapping.
  pure def relayTextRecipientAllowed(named: bool, counterpartMatches: bool): bool =
    not(named) or counterpartMatches

  action commitPrivateRecipientMismatch(k: str, named: bool, counterpartMatches: bool): bool = all {
    ep.phase.get(k) == "claimed", ep.kind.get(k) == "share", not(w.erased.get(owner(k))),
    not(relayTextRecipientAllowed(named, counterpartMatches)),
    ep' = committed(ep, k),
    w' = w, desk' = desk, queue' = queue, g' = g,
  }

  pure def relayNameCollisionRefuses(selectedItem: bool, otherCounterpartMatches: bool): bool =
    not(selectedItem) and otherCounterpartMatches

  action commitAmbiguousName(k: str, selectedItem: bool, otherCounterpartMatches: bool): bool = all {
    ep.phase.get(k) == "claimed", Set("share", "text").contains(ep.kind.get(k)),
    not(w.erased.get(owner(k))),
    relayNameCollisionRefuses(selectedItem, otherCounterpartMatches),
    ep' = committed(ep, k),
    w' = w, desk' = desk, queue' = queue, g' = g,
  }

  // The endpoint unit before the desk decides (relay-endpoint.ts): sync the unsent items, and record in the
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
        val g0 = if (unclean) a.gh.with("teenUnclean", a.gh.teenUnclean.union(Set(k))) else a.gh
        val g1 = if (dec.ageSignal and not(dec.startsMinor)) g0.with("otherAge", g0.otherAge.union(Set(k))) else g0
        all {
          desk' = a.d, queue' = persist(a.d, a.q),
          g' = if (tc == "unavailable" and classifierReads(w, src, dst)) g1.with("unchecked", g1.unchecked.union(Set(k))) else g1,
          // spec/relayDecision.md, "A relay text that says the sender is under 18 starts the minors policy": RelayDesk.apply
          // calls the host's minorSignal, which marks the sender and closes the sender's open opportunities (dropMember).
          // `minor` stands for the code's minor signal here; a sender already marked gets no second step. An age of
          // another person (minorOther) blocks the text and starts nothing.
          w' = if (dec.startsMinor and not(w.minor.get(src))) w.with("minor", w.minor.set(src, true)).with("matchOpen", false).with("teenPair", false)
               else if (dec.startsMinor and w.teenPair) w.with("matchOpen", false).with("teenPair", false)
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
            // refuseAsk stands for every other send refusal: the conversation streak cap, and the same
            // question to that member less than 10 minutes before (a re-ask after a cancel).
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

  // rt.unitOfWork calls deliver after the commit (runtime.ts). An error there is logged and the unit's
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
  // Network.tick flushes deferred sends (network.ts): each runs every send-time check again. A relayed
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
    // The swap question goes only while its swap still waits inside its 15 minutes (runtime.ts, SD-138);
    // an item row needs a passed record for this recipient, not withdrawn (runtime.ts, SD-039).
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
  // still combine across requests. "wrongRecipient" supplies the shell's mismatched-name result.
  // "rateTheirs"/"rateMine": the engine's rate limit; "refuseAsk",
  // "refuseTheirs", "refuseMine": Network.send refuses (the conversation streak or the leak guard).
  pure val FAULTS = Set("none", "wrongRecipient", "ambiguousName", "rateTheirs", "rateMine", "refuseAsk", "refuseTheirs", "refuseMine")
  action commit(k: str, tc: str, fault: str): bool =
    if (Set("text", "share").contains(ep.kind.get(k)) and fault == "ambiguousName") commitAmbiguousName(k, false, true)
    else if (ep.kind.get(k) == "text") commitText(k, tc, fault == "refuseMine")
    else if (ep.kind.get(k) == "share" and fault == "wrongRecipient") commitPrivateRecipientMismatch(k, true, false)
    else if (ep.kind.get(k) == "share")
      commitShare(k, fault == "rateTheirs", fault == "rateMine", fault == "refuseAsk", fault == "refuseTheirs", fault == "refuseMine")
    else if (ep.kind.get(k) == "withdraw") commitWithdraw(k)
    else commitNone(k)

  // The branch weights (weights only: the reachable states do not change). A weight is the number of `pick`
  // values that enable a branch, so that Apalache still sees each action once. Every other-actor event and every
  // end of the teen pair is permanent in a trace (no unstop, unblock or reopen), so they come in 1 draw of 20 each;
  // otherwise most traces end the match before two shares or a quiet-hours flush complete. The simulator gives the
  // draws of a disabled branch to the next enabled branch in this order (measured with the pinned Quint CLI, Rust
  // backend), so the permanent events come first and the clock branch, which is always enabled, comes last. In the
  // commit and tick branches, half of the draws are the clean outcome (a passed text, no fault, no refusal at the
  // tick) and half draw any outcome, fault and refusal, so every outcome stays reachable.
  action step = {
    nondet pick = 0.to(19).oneOf()
    nondet clean = Set(false, true).oneOf()
    any {
      // Other actors share one branch, so the random simulation does not end most traces early.
      all { pick == 0,
        nondet m = MEMBERS.oneOf()
        any { stop(m), safetyHold(m), minorFlag(m), erase(m), blockPair, closeMatch } },
      // The teen friendship pair: it opens before the first item, and the sweep or the stop ends it.
      all { pick == 1, any { teenPairOpen, teenPairEnds, teenStop, teenResume } },
      all { pick >= 2, pick <= 4,
        nondet k = REQS.oneOf()
        nondet kind = Set("text", "share", "withdraw").oneOf()
        if (kind == "share") claimPrivateContact(k, false, false, false) else claim(k, kind) },
      all { pick >= 5, pick <= 7,
        REQS.exists(k => ep.phase.get(k) == "claimed"),
        nondet k = REQS.filter(k => ep.phase.get(k) == "claimed").oneOf()
        nondet tc = TEXT_OUTCOMES.oneOf()
        nondet fault = FAULTS.oneOf()
        commit(k, if (clean) "pass" else tc, if (clean) "none" else fault) },
      all { pick >= 8, pick <= 9,
        REQS.exists(k => ep.phase.get(k) != "idle"),
        nondet k = REQS.filter(k => ep.phase.get(k) != "idle").oneOf()
        any { unitThrow(k), postCommitDeliverError(k), answer(k), crash(k), replay(k) } },
      all { pick >= 10, pick <= 11,
        nondet refused = desk.deferred.powerset().oneOf()
        tickFlush(if (clean) Set() else refused) },
      all { pick >= 12, pick <= 15,
        queue.rows.keys().exists(key => queue.rows.get(key).status == "queued"),
        nondet key = queue.rows.keys().filter(key => queue.rows.get(key).status == "queued").oneOf()
        any { queueSend(key), queueFail(key) } },
      all { pick >= 16,
        nondet m = MEMBERS.oneOf()
        nondet b = Set(false, true).oneOf()
        nondet dt = Set(5, 20).oneOf()
        any { setQuiet(m, b), timePass(dt) } },
    }
  }

  // ------------------------------------------------------------------------------------------ derived
  pure def numberRows(q: Queue, src: str): Set[Row] =
    q.rows.keys().map(key => q.rows.get(key)).filter(r => r.send.number and r.send.src == src)
  def numberSent(src: str): bool = numberRows(queue, src).exists(r => r.status == "sent")
  def numberPending(src: str): bool =
    numberRows(queue, src).exists(r => r.status == "queued") or desk.deferred.exists(s => s.number and s.src == src)

  // ------------------------------------------------------------------------------------------ invariants
  // Founder decision 9 and relay.ts: a number goes out only after both members asked.
  val numberMovesOnlyIfBothConsented = g.events.forall(e => e.number implies e.peerAsked)

  // Per-item consent (founder decision 9; engine relay.ts): after "don't send my number" the endpoint
  // answers "Okay, I won't share your number" (relay-endpoint.ts NOTICE.withdrawn). No number of that member goes out after it (SD-039).
  val withdrawnNotSent = g.events.forall(e => e.number implies e.live)

  // AGENTS.md "Relay (#7)": only what the relay passed goes out, and only inside an open match of two eligible
  // adults with no block, at final dispatch (runtime.ts comment).
  val rowSentImpliesPass = g.events.forall(e => e.recPass and e.pairOk)

  // network/src/relay.ts and engine relay.ts (the thread keeps the delivered wording only), and engine
  // relay.ts ("contactShared: A contact share was delivered"; alreadyShared reads it). The desk corrects its
  // state lazily (RelayDesk.unsent before each endpoint decision and in the tick), so the rule is checked where it
  // matters: no endpoint decision that can deliver reads a lost item as delivered (Q-relay-1, SD-252).
  val decisionsReadDelivered = g.staleRead.size() == 0

  // Owner decision 2026-11-22, D18 (spec/relayLifecycle.md): every item the desk decided is a pass or a block; nothing
  // waits for staff, so the desk keeps no member's words (SD-064 is met by construction).
  val noRelayHold = desk.verdict.keys().forall(i => desk.verdict.get(i).decision == "pass" or desk.verdict.get(i).decision == "block")

  // spec/relayDecision.md, "A classifier that cannot run blocks the text": a text that the classifier could not read
  // never has an outbound row.
  val uncheckedNeverSent = g.unchecked.forall(i => not(queue.rows.keys().contains(i)))

  // runtime.ts ("keep only the id. Nothing that names the member stays") and runtime.ts: after the
  // forget path no stored outbound body holds the erased member's number (SD-040).
  val erasedNumberGone = queue.rows.keys().forall(key => {
    val r = queue.rows.get(key)
    (r.body and r.send.number) implies not(w.erased.get(r.send.src))
  })

  // relay.ts ("the other member is asked once"): a waiting swap rests on an ask that was not refused, and
  // the ask arrives inside the 15 minutes it names (relay.ts) (SD-138).
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
  // that carried an age signal about its sender left its sender marked as a minor (audit ST-D2); an age of another
  // person only blocks the item.
  val ageSignalStartsMinorsPolicy = desk.verdict.keys().forall(i =>
    (desk.verdict.get(i).ageSignal and not(g.otherAge.contains(i))) implies w.minor.get(desk.verdict.get(i).src))
  val ageSignalBlocks = desk.verdict.keys().forall(i => desk.verdict.get(i).ageSignal implies desk.verdict.get(i).decision == "block")

  // Owner decision 2026-11-22 (spec/friendIntroAge.md teenFriendAgeRule, relayKindAllowed): a row sent with a minor
  // on either side is a text of a teen pair that passed the rule at that moment; never a number or a swap question.
  val teenFriendAgeRule = g.events.forall(e => e.minorParty implies (e.teenText and not(e.number) and not(e.ask)))
  // While teen introductions are stopped no row goes to or from a minor (the rule before the owner decision).
  val teenSwitchOffNoMinor = g.events.forall(e => e.minorParty implies e.switchOn) and (w.teenPair implies not(w.teenStopped))
  // spec/relayDecision.md relayVerdict: a teen-pair text without a clean pass is never passed (owner decision
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
    ageSignalBlocks,
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
  // shared-relay.integration.test.ts: A asks, B is asked once, B asks back, both numbers go.
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
      .expect(safety)
      .expect(not(witness_bothNumbersGo))

  run deferredTextFlushedTest =
    init
      .then(setQuiet("B", true))
      .then(claim("a1", "text")).then(commitText("a1", "pass", false)).then(answer("a1"))
      .expect(desk.deferred.exists(s => s.key == "a1"))
      .then(setQuiet("B", false)).then(tickFlush(Set())).then(queueSend("a1"))
      .expect(safety)
      .expect(not(witness_deferredFlushed))

  // The reader found a qualified contact request and separately an explicit text relay. The
  // text's privacy verdict is a model input. scripts/sim/relay.ts checks both reader outcomes.
  run qualifiedRequestAndQuotedTextTest =
    init
      .then(claimPrivateContact("a1", false, true, false)).then(commitNone("a1")).then(answer("a1"))
      .then(claim("a2", "text")).then(commitText("a2", "block", false)).then(answer("a2"))
      .expect(desk.swaps.size() == 0 and desk.log.get("a2").decision == "block" and queue.rows.keys().size() == 0 and safety)

  // The first reply contains an operative prior condition. The second records its specific
  // completion and gives a fresh direct request. The model takes the reader's uncertainty as input.
  run priorAssentBeforeSwapTest =
    init
      .then(claim("a1", "share")).then(commitShare("a1", false, false, false, false, false)).then(answer("a1"))
      .then(claimPrivateContact("b1", false, true, false)).then(commitNone("b1")).then(answer("b1"))
      .expect(desk.swaps.exists(sw => sw.src == "A") and not(numberPending("A")) and not(numberPending("B")))
      .then(claimPrivateContact("b2", false, false, false)).then(commitShare("b2", false, false, false, false, false)).then(answer("b2"))
      .expect(numberPending("A") and numberPending("B") and safety)

  run delegatedShareKeepsSwapPendingTest =
    init
      .then(claim("a1", "share")).then(commitShare("a1", false, false, false, false, false)).then(answer("a1"))
      .then(claim("b1", "none")).then(commitNone("b1")).then(answer("b1"))
      .expect(desk.swaps.exists(sw => sw.src == "A") and not(numberPending("A")) and not(numberPending("B")))
      .then(claim("b2", "share")).then(commitShare("b2", false, false, false, false, false)).then(answer("b2"))
      .expect(numberPending("A") and numberPending("B") and safety)

  run namedPrivateRecipientMismatchKeepsSwapPendingTest =
    init
      .then(claim("a1", "share")).then(commitShare("a1", false, false, false, false, false)).then(answer("a1"))
      .then(claim("b1", "share")).then(commit("b1", "pass", "wrongRecipient")).then(answer("b1"))
      .expect(ep.receipt.get("b1") == "completed" and desk.swaps.exists(sw => sw.src == "A")
        and not(numberPending("A")) and not(numberPending("B")) and safety)
      .then(claim("b2", "share")).then(commitShare("b2", false, false, false, false, false)).then(answer("b2"))
      .expect(numberPending("A") and numberPending("B") and safety)

  run unselectedNamedCollisionKeepsSwapPendingTest =
    init
      .then(claim("a1", "share")).then(commitShare("a1", false, false, false, false, false)).then(answer("a1"))
      .then(claim("b1", "share")).then(commit("b1", "pass", "ambiguousName")).then(answer("b1"))
      .expect(ep.receipt.get("b1") == "completed" and desk.swaps.exists(sw => sw.src == "A")
        and not(numberPending("A")) and not(numberPending("B")) and safety)
      .then(claim("b2", "share")).then(commitShare("b2", false, false, false, false, false)).then(answer("b2"))
      .expect(numberPending("A") and numberPending("B") and safety)

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

  // A member's own age estimate in a relay text is an age signal of the item: the item is blocked and the minors policy starts.
  run estimatedMinorStartsMinorsPolicyTest =
    init
      .then(claim("a1", "text")).then(commitText("a1", "minorRules", false)).then(answer("a1"))
      .expect(desk.log.get("a1").decision == "block" and desk.log.get("a1").ageSignal
        and not(queue.rows.keys().contains("a1")) and w.minor.get("A") and not(w.matchOpen) and ageSignalStartsMinorsPolicy and safety)

  // Upstream control (9de643b5): an adult's text about another person's age ("my 15 year old will be with me") is
  // blocked, the sender stays unmarked and the match stays open; a clean text then passes.
  run otherPersonAgeBlocksOnlyTest =
    init
      .then(claim("a1", "text")).then(commitText("a1", "minorOther", false)).then(answer("a1"))
      .expect(desk.log.get("a1").decision == "block" and desk.log.get("a1").ageSignal and queue.rows.keys().size() == 0
        and not(w.minor.get("A")) and w.matchOpen and ageSignalStartsMinorsPolicy and ageSignalBlocks)
      .then(claim("a2", "text")).then(commitText("a2", "pass", false)).then(answer("a2"))
      .then(queueSend("a2"))
      .expect(g.events.exists(e => e.key == "a2") and not(w.minor.get("A")) and safety)

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

  // A closed match before admission: the queued row never goes (shared-relay.integration.test.ts).
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

  // Network.send defers a relayed text while the recipient is in quiet hours (timing "logistics", network.ts
  // timingOf and timingOk); the tick sends it once the hours end, and the queue admission lets it go.
  run deferredFlushTest =
    init
      .then(setQuiet("B", true))
      .then(claim("a1", "text")).then(commitText("a1", "pass", false)).then(answer("a1"))
      .expect(desk.deferred.size() == 1 and desk.thread.contains("a1") and not(queue.rows.keys().contains("a1")))
      .then(setQuiet("B", false)).then(tickFlush(Set()))
      .then(queueSend("a1"))
      .expect(g.flushed.contains("a1") and g.events.exists(e => e.key == "a1") and safety)

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

  // A safety hold on the recipient blocks a clean text: nothing is queued and nothing waits for staff.
  run partyHoldBlocksTest =
    init
      .then(safetyHold("B"))
      .then(claim("a1", "text")).then(commitText("a1", "pass", false)).then(answer("a1"))
      .expect(desk.log.get("a1").decision == "block" and not(queue.rows.keys().contains("a1")) and noRelayHold and safety)

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
