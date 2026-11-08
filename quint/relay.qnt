// quint-check: max-steps=25 max-samples=10000 verify-steps=7
//
// Relay between two matched members (PRD 40.5; AGENTS.md founder decision 9 and "Relay (#7)").
// Module plan: docs/research/2026-11-07-state-machines.md section 6.8. Findings: docs/research/quint-findings/relay.md.
//
// Machines in this model:
//   relay-item            packages/network/src/relay.ts (RelayDesk.request, apply, deliver, release, reject, forget)
//   relay-swap            packages/network/src/relay.ts:269-312 (swap, cancelSwaps)
//   relay-match-view      packages/network/src/network.ts:4895-4903 (relayMatchOf), modelled as `matchOpen`
//   photo-relay-item      packages/platform/src/photo-relay.ts (select, review, revoke, claimForAction, issueDelivery, delivery)
//   action-receipt        packages/network/service/relay-endpoint.ts:175-261
//   relay-classifier-hook packages/engine/src/relay.ts:430-445 (relayItemAsync), an oracle
//
// Rules for the model (quint/README.md):
//   * One SQL transaction is one action. A unit of work (runtime.ts unitOfWork: load, desk decision, save with
//     completeAction) is one action. The claim transaction, the post-commit deliver(), the tick and the outbound
//     queue admission are separate actions.
//   * The engine relay policy, the Clef hook, the leak guard and the conversation streak are oracles: the step
//     picks their output with `nondet`, within what the code makes them return for the current parties.
//   * Other actors (STOP, block, close, a safety hold, a minor flag, erasure, quiet hours, time) are actions.
//   * Bounds: two members A and B, one match, four member requests (a1, a2 from A; b1, b2 from B), one photo item.
//
// The time unit is one minute. The consent TTL (engine RELAY_LIMITS.consentTtlMs) is 15 minutes.
module relay {

  // ------------------------------------------------------------------------------------------ constants
  pure val MEMBERS = Set("A", "B")
  pure val REQS = Set("a1", "a2", "b1", "b2")
  pure val TTL = 15
  // RELAY_LOG_MAX is 5000 in the code (network/src/relay.ts:43). The model scales it down to 3 so that the
  // log cap is reachable in a short trace (SD-387). Everything else that reads the log reads the same cap.
  pure val LOG_MAX = 3
  // A held item with no staff decision after this long breaks the review promise (SD-133). Not in the code.
  pure val HELD_SLA = 60
  // The selected-photo path stays off in production (no PhotoRelayPolicy, service.ts:396). The model keeps it
  // on as a regression guard.
  pure val PHOTO_RELAY = true
  pure val PHOTO_TTL = 15
  pure val FETCH_TTL = 1
  pure val PHOTO_ITEM = "pri"

  pure def owner(k: str): str = if (k == "a1" or k == "a2") "A" else "B"
  pure def other(m: str): str = if (m == "A") "B" else "A"
  // The outbound id of the swap ask: "relay:<item>:ask" (relay.ts:281).
  pure def askKey(k: str): str = if (k == "a1") "a1:ask" else if (k == "a2") "a2:ask" else if (k == "b1") "b1:ask" else "b2:ask"

  // ------------------------------------------------------------------------------------------ types
  type World = {
    now: int,
    matchOpen: bool,          // relayMatchOf: stage scheduled or done, both said yes
    blocked: bool,            // a block edge in either direction
    optedOut: str -> bool,    // STOP, leave, removed membership
    trustHold: str -> bool,   // a safety hold (trust level hold, account status)
    minor: str -> bool,       // age in doubt: minor, minor signal, unknown age (relayMemberOf)
    erased: str -> bool,      // the member deleted everything (forget path)
    quiet: str -> bool,       // the recipient is in quiet hours now
  }
  // One relay log row (engine RelayRecord), keyed by item id.
  type LogRec = { kind: str, src: str, dst: str, decision: str, contactShared: bool, ageSignal: bool, staff: str }
  // One held item (network/src/relay.ts RelayHeld). `minorRead`: ghost, a rule or Clef read the text as a minor's.
  type Held = { kind: str, src: str, dst: str, at: int, status: str, hasText: bool, minorRead: bool }
  type Swap = { iid: str, src: str, at: int }
  // One send through Network.send (kind "relay"): `number` is true when the text carries `src`'s number.
  type Send = { key: str, iid: str, src: str, dst: str, number: bool, ask: bool, at: int }
  // One platform.outbound row. `body` is false after the forget path nulls it.
  type Row = { send: Send, status: str, body: bool }
  // One network.relay_records row (the persisted copy of the log that the queue admission reads).
  type TRec = { decision: str, dst: str, contactShared: bool, review: str }
  type Desk = {
    log: str -> LogRec, order: List[str], held: str -> Held, swaps: Set[Swap], deferred: Set[Send], thread: Set[str],
  }
  type Queue = { rows: str -> Row, records: str -> TRec }
  type Endpoint = {
    receipt: str -> str,   // absent | processing | completed | unresolved
    phase: str -> str,     // idle | claimed | committed | answered | failed | dead
    kind: str -> str,      // text | share | withdraw
    commits: str -> int,   // ghost: committed unit effects for the key
    response: str -> str,  // ghost: "" | ok | 409
  }
  type Consent = { asked: bool, live: bool, at: int }
  // A row that the queue admitted and sent, as seen at that moment.
  type Ev = {
    key: str, ask: bool, number: bool, src: str, live: bool, peerAsked: bool, fresh: bool, recPass: bool, pairOk: bool, late: bool,
  }
  type Photo = {
    state: str, claimed: bool, intent: bool, exp: int, dexp: int, served: bool, servedOk: bool,
  }
  type Ghost = {
    consent: str -> Consent,
    events: Set[Ev],
    lost: Set[str],          // send keys that ended without delivery
    askRefused: Set[str],    // swap items whose one ask to the other member was refused at send time
    toldHeldNoRow: Set[str], // items answered "held" with no held row (rate-only hold)
    flushed: Set[str],       // send keys that waited in Network.deferred and were queued by a tick
  }

  // ------------------------------------------------------------------------------------------ state
  var w: World
  var desk: Desk
  var queue: Queue
  var ep: Endpoint
  var photo: Photo
  var g: Ghost

  // ------------------------------------------------------------------------------------------ helpers
  pure def mapRemove(m: str -> a, k: str): str -> a = m.keys().exclude(Set(k)).mapBy(x => m.get(x))

  // The parties as the engine sees them (engine relay.ts:306-316; the canonical view only tightens).
  pure def partiesBlock(x: World, src: str, dst: str): bool =
    not(x.matchOpen) or x.blocked or x.minor.get(src) or x.minor.get(dst) or x.optedOut.get(src) or x.optedOut.get(dst)
      or x.erased.get(src) or x.erased.get(dst)
  pure def partiesHold(x: World, src: str, dst: str): bool = x.trustHold.get(src) or x.trustHold.get(dst)

  // Network.checkRecipient for a relay send (network.ts:4215-4244): opted out, account, hold, minor, block.
  pure def recipientRefuses(x: World, src: str, dst: str): bool =
    x.optedOut.get(dst) or x.erased.get(dst) or x.trustHold.get(dst) or x.blocked or x.minor.get(dst)
      or x.minor.get(src) or x.trustHold.get(src) or x.erased.get(src)

  // The queue admission pair check (runtime.ts relayPairAdmission, relayDispatchCheck, relayParties).
  pure def pairOk(x: World, src: str, dst: str): bool =
    x.matchOpen and not(x.blocked) and not(x.minor.get(src)) and not(x.minor.get(dst)) and not(x.optedOut.get(src))
      and not(x.optedOut.get(dst)) and not(x.trustHold.get(src)) and not(x.trustHold.get(dst))
      and not(x.erased.get(src)) and not(x.erased.get(dst))

  // RelayDesk.log (relay.ts:326-330): replace or append, then drop the oldest past the cap.
  pure def logPut(d: Desk, iid: str, r: LogRec): Desk = {
    val known = d.log.keys().contains(iid)
    val order1 = if (known) d.order else d.order.append(iid)
    val log1 = d.log.put(iid, r)
    if (order1.length() > LOG_MAX) {
      val drop = order1[0]
      d.with("log", mapRemove(log1, drop)).with("order", order1.slice(1, order1.length()))
    } else d.with("log", log1).with("order", order1)
  }

  // A contact share by `src` was already delivered in this match (engine relay.ts:377).
  pure def alreadyShared(d: Desk, src: str): bool =
    d.log.keys().exists(i => d.log.get(i).kind == "share" and d.log.get(i).src == src and d.log.get(i).contactShared)

  // RelayHost.send (network.ts:4771-4781) into Network.send (network.ts:3858-3891): refused, deferred or a queued row.
  type SendOut = { d: Desk, q: Queue, res: str }
  pure def hostSend(x: World, d: Desk, q: Queue, s: Send, refuse: bool): SendOut =
    if (recipientRefuses(x, s.src, s.dst) or refuse) { d: d, q: q, res: "refused" }
    else if (x.quiet.get(s.dst)) { d: d.with("deferred", d.deferred.union(Set(s))), q: q, res: "deferred" }
    else { d: d, q: q.with("rows", q.rows.put(s.key, { send: s, status: "queued", body: true })), res: "sent" }

  // RelayDesk.deliver (relay.ts:256-266): the thread gets the wording on "sent" and on "deferred".
  pure def deliver(x: World, d: Desk, q: Queue, s: Send, refuse: bool): SendOut = {
    val o = hostSend(x, d, q, s, refuse)
    if (o.res == "refused") o else o.with("d", o.d.with("thread", o.d.thread.union(Set(s.iid))))
  }

  // The save writes network.relay_records from the log (store.ts relayRows, writeRelayRows): an upsert per
  // log entry, with the review status of its held entry. A row whose log entry is gone is not touched.
  pure def persist(d: Desk, q: Queue): Queue =
    q.with("records", d.log.keys().fold(q.records, (acc, i) => {
      val r = d.log.get(i)
      val review = if (d.held.keys().contains(i)) d.held.get(i).status else ""
      acc.put(i, { decision: r.decision, dst: r.dst, contactShared: r.contactShared, review: review })
    }))

  // ------------------------------------------------------------------------------------------ engine oracle
  // Text outcomes the oracle may give when the parties pass: the classifier and the rules.
  pure val TEXT_OUTCOMES = Set("pass", "hold", "block", "rate", "minorRules", "minorClef")
  type Decision = { decision: str, row: bool, ageSignal: bool, minorRead: bool }

  // relayItemAsync for a text (engine relay.ts:300-445). Clef runs only on an item the rules pass (line 433).
  pure def textDecision(x: World, src: str, dst: str, tc: str): Decision =
    if (partiesBlock(x, src, dst) or tc == "block" or tc == "minorRules")
      { decision: "block", row: false, ageSignal: tc == "minorRules", minorRead: tc == "minorRules" }
    else if (partiesHold(x, src, dst)) { decision: "hold", row: true, ageSignal: false, minorRead: false }
    else if (tc == "rate") { decision: "hold", row: false, ageSignal: false, minorRead: false }
    else if (tc == "hold") { decision: "hold", row: true, ageSignal: false, minorRead: false }
    // Clef minor_signal: a hold with flag clef:minor_signal; ageSignal stays the rules' (relay.ts:444).
    else if (tc == "minorClef") { decision: "hold", row: true, ageSignal: false, minorRead: true }
    else { decision: "pass", row: false, ageSignal: false, minorRead: false }

  // relayItem for a contact share (engine relay.ts:329-335, 377): parties, fresh consent, one share per sender.
  pure def shareDecision(x: World, d: Desk, src: str, dst: str, consentAt: int, rate: bool): Decision =
    if (partiesBlock(x, src, dst) or consentAt > x.now or x.now - consentAt > TTL or alreadyShared(d, src))
      { decision: "block", row: false, ageSignal: false, minorRead: false }
    else if (partiesHold(x, src, dst)) { decision: "hold", row: true, ageSignal: false, minorRead: false }
    else if (rate) { decision: "hold", row: false, ageSignal: false, minorRead: false }
    else { decision: "pass", row: false, ageSignal: false, minorRead: false }

  // The record RelayDesk.undelivered writes for a share that did not go (relay.ts:252-254, 296, 303).
  pure def shareBlock(src: str, dst: str): LogRec =
    { kind: "share", src: src, dst: dst, decision: "block", contactShared: false, ageSignal: false, staff: "" }

  // RelayDesk.apply (relay.ts:232-249) for one decided item.
  type Applied = { d: Desk, q: Queue, gh: Ghost, told: str }
  pure def apply(x: World, d: Desk, q: Queue, gh: Ghost, iid: str, kind: str, src: str, dst: str, dec: Decision,
                 number: bool, refuse: bool): Applied = {
    val rec = { kind: kind, src: src, dst: dst, decision: dec.decision, contactShared: dec.decision == "pass" and kind == "share",
                ageSignal: dec.ageSignal, staff: "" }
    val d1 = logPut(d, iid, rec)
    if (dec.decision == "block") { d: d1, q: q, gh: gh, told: "refused" }
    else if (dec.decision == "hold" and not(dec.row)) { d: d1, q: q, gh: gh.with("toldHeldNoRow", gh.toldHeldNoRow.union(Set(iid))), told: "held" }
    else if (dec.decision == "hold") {
      val h = { kind: kind, src: src, dst: dst, at: x.now, status: "held", hasText: kind == "text" and not(dec.ageSignal), minorRead: dec.minorRead }
      { d: d1.with("held", d1.held.put(iid, h)), q: q, gh: gh, told: "held" }
    } else {
      val s = { key: iid, iid: iid, src: src, dst: dst, number: number, ask: false, at: x.now }
      val o = deliver(x, d1, q, s, refuse)
      if (o.res == "refused")
        // RelayDesk.undelivered (relay.ts:252-254): the log says block, no number shared.
        { d: logPut(o.d, iid, rec.with("decision", "block").with("contactShared", false)), q: o.q, gh: gh, told: "refused" }
      else { d: o.d, q: o.q, gh: gh, told: "sent" }
    }
  }

  // ------------------------------------------------------------------------------------------ init
  action init = all {
    w' = { now: 0, matchOpen: true, blocked: false,
           optedOut: MEMBERS.mapBy(_ => false), trustHold: MEMBERS.mapBy(_ => false), minor: MEMBERS.mapBy(_ => false),
           erased: MEMBERS.mapBy(_ => false), quiet: MEMBERS.mapBy(_ => false) },
    desk' = { log: Map(), order: List(), held: Map(), swaps: Set(), deferred: Set(), thread: Set() },
    queue' = { rows: Map(), records: Map() },
    ep' = { receipt: REQS.mapBy(_ => "absent"), phase: REQS.mapBy(_ => "idle"), kind: REQS.mapBy(_ => ""),
            commits: REQS.mapBy(_ => 0), response: REQS.mapBy(_ => "") },
    photo' = { state: "none", claimed: false, intent: false, exp: 0, dexp: 0, served: false, servedOk: true },
    g' = { consent: MEMBERS.mapBy(_ => { asked: false, live: false, at: 0 }), events: Set(), lost: Set(), askRefused: Set(), toldHeldNoRow: Set(), flushed: Set() },
  }

  // ------------------------------------------------------------------------------------------ endpoint (action receipt)
  // relay-endpoint.ts:192-204: the claim transaction. The turn authority is the member's current membership.
  action claim(k: str, kind: str): bool = all {
    ep.receipt.get(k) == "absent",
    ep.phase.get(k) == "idle",
    not(w.erased.get(owner(k))),
    ep' = ep.with("receipt", ep.receipt.set(k, "processing")).with("phase", ep.phase.set(k, "claimed")).with("kind", ep.kind.set(k, kind)),
    w' = w, desk' = desk, queue' = queue, photo' = photo, g' = g,
  }

  // The unit commits its effects and the receipt in one transaction (runtime.ts writeUnit, completeAction last).
  pure def committed(e: Endpoint, k: str): Endpoint =
    e.with("receipt", e.receipt.set(k, "completed")).with("phase", e.phase.set(k, "committed"))
     .with("commits", e.commits.set(k, e.commits.get(k) + 1))

  // A text request (relay-endpoint.ts:225-254; RelayDesk.request relay.ts:178-195).
  action commitText(k: str, tc: str, refuse: bool): bool = {
    val src = owner(k)
    val dst = other(src)
    all {
      ep.phase.get(k) == "claimed", ep.kind.get(k) == "text",
      not(w.erased.get(src)),
      if (not(w.matchOpen)) all {
        // matchFor finds no open match: refused, nothing logged (relay.ts:181-182).
        desk' = desk, queue' = queue, g' = g,
      } else {
        val a = apply(w, desk, queue, g, k, "text", src, dst, textDecision(w, src, dst, tc), false, refuse)
        all { desk' = a.d, queue' = persist(a.d, a.q), g' = a.gh }
      },
      ep' = committed(ep, k),
      w' = w, photo' = photo,
    }
  }

  // "Send them my number" (relay-endpoint.ts:225-254; RelayDesk.swap relay.ts:269-305).
  action commitShare(k: str, rateTheirs: bool, rateMine: bool, refuseAsk: bool, refuseTheirs: bool, refuseMine: bool): bool = {
    val src = owner(k)
    val dst = other(src)
    val now = w.now
    // The member asked: ghost consent for their own number, at their own request.
    val g1 = g.with("consent", g.consent.set(src, { asked: true, live: true, at: now }))
    val swaps0 = desk.swaps.filter(s => now - s.at <= TTL and s.at <= now)
    val d0 = desk.with("swaps", swaps0)
    val theirs = swaps0.filter(s => s.src == dst)
    all {
      ep.phase.get(k) == "claimed", ep.kind.get(k) == "share",
      not(w.erased.get(src)),
      if (not(w.matchOpen)) all { desk' = desk, queue' = queue, g' = g1 }
      else if (theirs.size() == 0) {
        if (swaps0.exists(s => s.src == src)) all {
          // "I already asked them" (relay.ts:275).
          desk' = d0, queue' = queue, g' = g1,
        } else {
          val probe = shareDecision(w, d0, src, dst, now, rateMine)
          if (probe.decision != "pass") {
            val a = apply(w, d0, queue, g1, k, "share", src, dst, probe, true, refuseMine)
            all { desk' = a.d, queue' = persist(a.d, a.q), g' = a.gh }
          } else {
            // The swap waits; the other member is asked once. The send result is ignored (relay.ts:281).
            val d1 = d0.with("swaps", swaps0.union(Set({ iid: k, src: src, at: now })))
            val s = { key: askKey(k), iid: k, src: src, dst: dst, number: false, ask: true, at: now }
            val o = hostSend(w, d1, queue, s, refuseAsk)
            val g2 = if (o.res == "refused") g1.with("askRefused", g1.askRefused.union(Set(k))) else g1
            all { desk' = o.d, queue' = persist(o.d, o.q), g' = g2 }
          }
        }
      } else {
        nondet t = theirs.oneOf()
        val d1 = d0.with("swaps", swaps0.exclude(Set(t)))
        // Both asked: each share through the engine with its own consent (relay.ts:284-304).
        val theirRes = shareDecision(w, d1, dst, src, t.at, rateTheirs)
        val myRes = shareDecision(w, d1, src, dst, now, rateMine)
        if (theirRes.decision == "pass" and myRes.decision == "pass") {
          val first = apply(w, d1, queue, g1, t.iid, "share", dst, src, theirRes, true, refuseTheirs)
          if (first.told != "sent") {
            // The first share was refused: the second never goes (relay.ts:294-298).
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
      w' = w, photo' = photo,
    }
  }

  // "Don't send my number" (relay-endpoint.ts:212-220; RelayDesk.cancelSwaps relay.ts:308-312). The same
  // withdrawal runs on the /internal/turn path (network.ts:617). The answer is always "Okay, I won't share your number."
  action commitWithdraw(k: str): bool = {
    val src = owner(k)
    val d1 = desk.with("swaps", desk.swaps.filter(s => s.src != src))
    all {
      ep.phase.get(k) == "claimed", ep.kind.get(k) == "withdraw",
      not(w.erased.get(src)),
      desk' = d1, queue' = persist(d1, queue),
      g' = g.with("consent", g.consent.set(src, g.consent.get(src).with("live", false))),
      ep' = committed(ep, k),
      w' = w, photo' = photo,
    }
  }

  // Any throw before or inside the save (lock: authority changed, a unit error): nothing commits; the catch
  // marks the key unresolved and answers 409 (relay-endpoint.ts:257-260).
  action unitThrow(k: str): bool = all {
    ep.phase.get(k) == "claimed",
    ep' = ep.with("receipt", ep.receipt.set(k, "unresolved")).with("phase", ep.phase.set(k, "failed")).with("response", ep.response.set(k, "409")),
    w' = w, desk' = desk, queue' = queue, photo' = photo, g' = g,
  }

  // rt.unitOfWork calls deliver() after the commit (runtime.ts:681-685). An error there reaches the same catch:
  // the receipt is no longer processing, so nothing is written, and the answer is 409 action_unresolved (SD-137).
  action postCommitThrow(k: str): bool = all {
    ep.phase.get(k) == "committed",
    ep' = ep.with("phase", ep.phase.set(k, "failed")).with("response", ep.response.set(k, "409")),
    w' = w, desk' = desk, queue' = queue, photo' = photo, g' = g,
  }

  action answer(k: str): bool = all {
    ep.phase.get(k) == "committed",
    ep' = ep.with("phase", ep.phase.set(k, "answered")).with("response", ep.response.set(k, "ok")),
    w' = w, desk' = desk, queue' = queue, photo' = photo, g' = g,
  }

  // The process stops between two awaits.
  action crash(k: str): bool = all {
    ep.phase.get(k) == "claimed" or ep.phase.get(k) == "committed",
    ep' = ep.with("phase", ep.phase.set(k, "dead")),
    w' = w, desk' = desk, queue' = queue, photo' = photo, g' = g,
  }

  // Cloud times out and sends the same signed request again (relay-endpoint.ts:194-207).
  action replay(k: str): bool = all {
    ep.phase.get(k) == "dead",
    ep' = ep.with("response", ep.response.set(k, if (ep.receipt.get(k) == "completed") "ok" else "409"))
            .with("phase", ep.phase.set(k, if (ep.receipt.get(k) == "completed") "answered" else "dead")),
    w' = w, desk' = desk, queue' = queue, photo' = photo, g' = g,
  }

  // ------------------------------------------------------------------------------------------ tick and queue
  // Network.tick flushes deferred sends (network.ts:3269-3276): each runs every send-time check again.
  action tickFlush(refused: Set[Send]): bool = {
    val due = desk.deferred.filter(s => not(w.quiet.get(s.dst)))
    val dropped = due.filter(s => recipientRefuses(w, s.src, s.dst) or refused.contains(s))
    val queued = due.exclude(dropped)
    val rows1 = queued.fold(queue.rows, (acc, s) => acc.put(s.key, { send: s, status: "queued", body: true }))
    all {
      due.size() > 0,
      refused.subseteq(due),
      desk' = desk.with("deferred", desk.deferred.exclude(due)),
      queue' = queue.with("rows", rows1),
      g' = g.with("lost", g.lost.union(dropped.map(s => s.key))).with("flushed", g.flushed.union(queued.map(s => s.key))),
      w' = w, ep' = ep, photo' = photo,
    }
  }

  // The outbound queue's final admission and send (runtime.ts relayAdmission, lines 238-269).
  action queueSend(key: str): bool = {
    val r = queue.rows.get(key)
    val s = r.send
    val recOk = s.ask or (queue.records.keys().contains(s.iid) and queue.records.get(s.iid).decision == "pass"
      and queue.records.get(s.iid).dst == s.dst and queue.records.get(s.iid).review != "rejected")
    val ok = recOk and pairOk(w, s.src, s.dst)
    val c = g.consent.get(s.src)
    val ev = { key: key, ask: s.ask, number: s.number, src: s.src, live: c.live, peerAsked: g.consent.get(s.dst).asked,
               fresh: w.now - c.at <= TTL, recPass: recOk, pairOk: pairOk(w, s.src, s.dst), late: s.ask and w.now - s.at > TTL }
    all {
      queue.rows.keys().contains(key),
      r.status == "queued",
      queue' = queue.with("rows", queue.rows.set(key, r.with("status", if (ok) "sent" else "ended"))),
      g' = if (ok) g.with("events", g.events.union(Set(ev))) else g.with("lost", g.lost.union(Set(key))),
      w' = w, desk' = desk, ep' = ep, photo' = photo,
    }
  }

  // A queued row ends unsent for a reason outside the relay: the unanswered rule expires it, the queue's leak
  // guard parks it, or the provider fails it for good (outbound-queue.ts).
  action queueFail(key: str): bool = all {
    queue.rows.keys().contains(key),
    queue.rows.get(key).status == "queued",
    queue' = queue.with("rows", queue.rows.set(key, queue.rows.get(key).with("status", "ended"))),
    g' = g.with("lost", g.lost.union(Set(key))),
    w' = w, desk' = desk, ep' = ep, photo' = photo,
  }

  // ------------------------------------------------------------------------------------------ staff
  // RelayDesk.release (relay.ts:347-366), a unit of work (service.ts:2461).
  action staffRelease(iid: str, refuse: bool): bool = {
    val h = desk.held.get(iid)
    val decided = desk.with("held", desk.held.set(iid, h.with("status", "released").with("hasText", false)))
    val canGo = h.kind == "text" and h.hasText and not(partiesBlock(w, h.src, h.dst))
    val s = { key: iid, iid: iid, src: h.src, dst: h.dst, number: false, ask: false, at: w.now }
    val o = deliver(w, decided, queue, s, refuse)
    val rec = { kind: h.kind, src: h.src, dst: h.dst, decision: "pass", contactShared: false, ageSignal: false, staff: "released" }
    val d2 = if (canGo and o.res != "refused") logPut(o.d, iid, rec) else if (canGo) o.d else decided
    val q2 = if (canGo) o.q else queue
    all {
      iid != PHOTO_ITEM,
      desk.held.keys().contains(iid), h.status == "held",
      desk' = d2, queue' = persist(d2, q2),
      w' = w, ep' = ep, photo' = photo, g' = g,
    }
  }

  // RelayDesk.reject (relay.ts:369-376). The log row gets staff:rejected only while it is still in the log.
  action staffReject(iid: str): bool = {
    val h = desk.held.get(iid)
    val d1 = desk.with("held", desk.held.set(iid, h.with("status", "rejected").with("hasText", false)))
    val d2 = if (d1.log.keys().contains(iid)) d1.with("log", d1.log.set(iid, d1.log.get(iid).with("staff", "rejected"))) else d1
    all {
      iid != PHOTO_ITEM,
      desk.held.keys().contains(iid), h.status == "held",
      desk' = d2, queue' = persist(d2, queue),
      w' = w, ep' = ep, photo' = photo, g' = g,
    }
  }

  // ------------------------------------------------------------------------------------------ other actors
  action stop(m: str): bool = all {
    not(w.optedOut.get(m)),
    w' = w.with("optedOut", w.optedOut.set(m, true)),
    desk' = desk, queue' = queue, ep' = ep, photo' = photo, g' = g,
  }
  action blockPair: bool = all {
    not(w.blocked),
    w' = w.with("blocked", true),
    desk' = desk, queue' = queue, ep' = ep, photo' = photo, g' = g,
  }
  action closeMatch: bool = all {
    w.matchOpen,
    w' = w.with("matchOpen", false),
    desk' = desk, queue' = queue, ep' = ep, photo' = photo, g' = g,
  }
  action safetyHold(m: str): bool = all {
    not(w.trustHold.get(m)),
    w' = w.with("trustHold", w.trustHold.set(m, true)),
    desk' = desk, queue' = queue, ep' = ep, photo' = photo, g' = g,
  }
  action minorFlag(m: str): bool = all {
    not(w.minor.get(m)),
    w' = w.with("minor", w.minor.set(m, true)),
    desk' = desk, queue' = queue, ep' = ep, photo' = photo, g' = g,
  }
  action setQuiet(m: str, b: bool): bool = all {
    w.quiet.get(m) != b,
    w' = w.with("quiet", w.quiet.set(m, b)),
    desk' = desk, queue' = queue, ep' = ep, photo' = photo, g' = g,
  }
  action timePass(dt: int): bool = all {
    w' = w.with("now", w.now + dt),
    desk' = desk, queue' = queue, ep' = ep, photo' = photo, g' = g,
  }

  // The forget path for `m` (network.ts forget -> RelayDesk.forget relay.ts:398-402; runtime.ts writeUnit 525-552):
  // held items of theirs rejected, their swaps gone, the thread emptied, deferred sends to them or about them
  // dropped, and outbound rows with member_id = m nulled. Rows to the other member are not touched.
  action erase(m: str): bool = {
    val held1 = desk.held.keys().mapBy(i => {
      val h = desk.held.get(i)
      if ((h.src == m or h.dst == m) and h.status == "held") h.with("status", "rejected").with("hasText", false) else h
    })
    val gone = desk.deferred.filter(s => s.dst == m or s.src == m)
    val d1 = desk.with("held", held1).with("swaps", desk.swaps.filter(s => s.src != m))
                 .with("thread", Set()).with("deferred", desk.deferred.exclude(gone))
    val ended = queue.rows.keys().filter(key => queue.rows.get(key).send.dst == m and queue.rows.get(key).status == "queued")
    val rows1 = queue.rows.keys().mapBy(key => {
      val r = queue.rows.get(key)
      if (r.send.dst == m) r.with("body", false).with("status", if (r.status == "queued") "ended" else r.status) else r
    })
    all {
      not(w.erased.get(m)),
      w' = w.with("erased", w.erased.set(m, true)),
      desk' = d1, queue' = persist(d1, queue.with("rows", rows1)),
      g' = g.with("lost", g.lost.union(gone.map(s => s.key)).union(ended))
            .with("consent", g.consent.set(m, g.consent.get(m).with("live", false))),
      ep' = ep, photo' = photo,
    }
  }

  // ------------------------------------------------------------------------------------------ selected photo
  // PhotoRelayService.select (photo-relay.ts:111-135): A selects a photo for the current thread.
  action selectPhoto: bool = all {
    PHOTO_RELAY, photo.state == "none", pairOk(w, "A", "B"),
    photo' = photo.with("state", "pending").with("exp", w.now + PHOTO_TTL),
    w' = w, desk' = desk, queue' = queue, ep' = ep, g' = g,
  }
  // review (photo-relay.ts:143-153): only before expiry; safe needs the item current.
  action reviewPhoto(safe: bool): bool = all {
    photo.state == "pending" or photo.state == "approved",
    w.now < photo.exp,
    if (safe) all { photo.state == "pending", pairOk(w, "A", "B"), photo' = photo.with("state", "approved") }
    else photo' = photo.with("state", if (photo.state == "approved") "revoked" else "rejected"),
    w' = w, desk' = desk, queue' = queue, ep' = ep, g' = g,
  }
  // revoke by the sender (photo-relay.ts:136-141).
  action revokePhoto: bool = all {
    photo.state != "none",
    photo' = photo.with("state", "revoked"),
    w' = w, desk' = desk, queue' = queue, ep' = ep, g' = g,
  }
  // The photo request on /internal/relay (relay-endpoint.ts:231-252): only the one approved, unclaimed, current
  // item; the desk decides with id pri_...; a pass claims the item in the save transaction.
  action photoRequest(rate: bool, refuse: bool): bool = {
    val current = photo.state == "approved" and not(photo.claimed) and w.now < photo.exp and pairOk(w, "A", "B")
    val dec = if (partiesBlock(w, "A", "B")) { decision: "block", row: false, ageSignal: false, minorRead: false }
              else if (partiesHold(w, "A", "B")) { decision: "hold", row: true, ageSignal: false, minorRead: false }
              else if (rate) { decision: "hold", row: false, ageSignal: false, minorRead: false }
              else { decision: "pass", row: false, ageSignal: false, minorRead: false }
    val a = apply(w, desk, queue, g, PHOTO_ITEM, "photo", "A", "B", dec, false, refuse)
    all {
      PHOTO_RELAY, current,
      // RelayDesk.prior: a logged item replays its decision; nothing new happens.
      not(desk.log.keys().contains(PHOTO_ITEM)),
      desk' = a.d, queue' = persist(a.d, a.q), g' = a.gh,
      photo' = if (a.told == "sent") photo.with("claimed", true) else photo,
      w' = w, ep' = ep,
    }
  }
  // The staff route for a pri_ id goes to the selected-photo branch (service.ts:2430-2462). Reject reviews it
  // unsafe; the desk's own held row is never touched (SD-320).
  action staffPhotoReject: bool = all {
    desk.held.keys().contains(PHOTO_ITEM),
    photo.state == "pending" or photo.state == "approved",
    w.now < photo.exp,
    photo' = photo.with("state", if (photo.state == "approved") "revoked" else "rejected"),
    w' = w, desk' = desk, queue' = queue, ep' = ep, g' = g,
  }
  // issueDelivery (photo-relay.ts:196-213): Cloud resolves the queued row; the first resolve fixes the deadline.
  action resolvePhoto: bool = {
    val exp = if (photo.intent) photo.dexp else if (photo.exp < w.now + FETCH_TTL) photo.exp else w.now + FETCH_TTL
    all {
      queue.rows.keys().contains(PHOTO_ITEM), queue.rows.get(PHOTO_ITEM).status == "sent",
      photo.claimed, photo.state == "approved", w.now < photo.exp, pairOk(w, "A", "B"), exp > w.now,
      photo' = photo.with("intent", true).with("dexp", exp),
      w' = w, desk' = desk, queue' = queue, ep' = ep, g' = g,
    }
  }
  // delivery (photo-relay.ts:215-224): the provider fetches the bytes with the signed capability.
  action fetchBytes: bool = {
    val ok = photo.state == "approved" and photo.claimed and photo.intent and w.now < photo.dexp and photo.dexp <= photo.exp
             and w.now < photo.exp and pairOk(w, "A", "B")
    all {
      photo.intent,
      photo.state == "approved", photo.claimed, w.now < photo.dexp, photo.dexp <= photo.exp, pairOk(w, "A", "B"),
      photo' = photo.with("served", true).with("servedOk", photo.servedOk and ok),
      w' = w, desk' = desk, queue' = queue, ep' = ep, g' = g,
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
    else commitWithdraw(k)

  action step = any {
    nondet k = REQS.oneOf()
    nondet kind = Set("text", "share", "withdraw").oneOf()
    claim(k, kind),
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
      any { unitThrow(k), postCommitThrow(k), answer(k), crash(k), replay(k) },
    },
    nondet refused = desk.deferred.powerset().oneOf()
    tickFlush(refused),
    all {
      queue.rows.keys().exists(key => queue.rows.get(key).status == "queued"),
      nondet key = queue.rows.keys().filter(key => queue.rows.get(key).status == "queued").oneOf()
      any { queueSend(key), queueFail(key) },
    },
    all {
      desk.held.keys().exists(i => desk.held.get(i).status == "held"),
      nondet iid = desk.held.keys().filter(i => desk.held.get(i).status == "held").oneOf()
      nondet refuse = Set(false, true).oneOf()
      any { staffRelease(iid, refuse), staffReject(iid) },
    },
    // Other actors share one branch, so the random simulation does not end most traces early.
    nondet m = MEMBERS.oneOf()
    any { stop(m), safetyHold(m), minorFlag(m), erase(m), blockPair, closeMatch },
    nondet m = MEMBERS.oneOf()
    nondet b = Set(false, true).oneOf()
    nondet dt = Set(5, 20).oneOf()
    any { setQuiet(m, b), timePass(dt) },
    // The photo item: the forward path in one branch (one of its actions is enabled at a time), faults in another.
    any { selectPhoto, reviewPhoto(true), photoRequest(false, false), resolvePhoto, fetchBytes },
    nondet b = Set(false, true).oneOf()
    nondet f = Set(false, true).oneOf()
    any { reviewPhoto(false), revokePhoto, photoRequest(b, f), staffPhotoReject },
  }

  // ------------------------------------------------------------------------------------------ derived
  pure def numberRows(q: Queue, src: str): Set[Row] =
    q.rows.keys().map(key => q.rows.get(key)).filter(r => r.send.number and r.send.src == src)
  def numberSent(src: str): bool = numberRows(queue, src).exists(r => r.status == "sent")
  def numberPending(src: str): bool =
    numberRows(queue, src).exists(r => r.status == "queued") or desk.deferred.exists(s => s.number and s.src == src)

  // ------------------------------------------------------------------------------------------ invariants
  // "Nobody's number goes one way" (network/src/relay.ts:285-286; founder decision 9: a number moves only in a
  // swap both asked for). Once A's number reached B, B's number reached A or is still on its way.
  val noOneWayNumber = MEMBERS.forall(m => numberSent(m) implies (numberSent(other(m)) or numberPending(other(m))))

  // Founder decision 9 and relay.ts:15-17: a number goes out only after both members asked.
  val numberMovesOnlyIfBothConsented = g.events.forall(e => e.number implies e.peerAsked)

  // Per-item consent (founder decision 9; engine relay.ts:15-17): after "don't send my number" the endpoint
  // answers "Okay, I won't share your number" (relay-endpoint.ts:59). No number of that member goes out after it.
  val withdrawnNotSent = g.events.forall(e => e.number implies e.live)

  // AGENTS.md "Relay (#7)": only what the relay passed goes out, and only inside an open match of two eligible
  // adults with no block, at final dispatch (runtime.ts:226-235 comment).
  val rowSentImpliesPass = g.events.forall(e => e.recPass and e.pairOk)

  // network/src/relay.ts:93 and engine relay.ts:495-500: the thread keeps the delivered wording only.
  val threadOnlyDelivered = desk.thread.forall(i => not(g.lost.contains(i)))

  // network/src/relay.ts:241 and :339 ("never a minor's words"): no text that a rule or the classifier read as a
  // minor's is kept for staff.
  val minorTextNeverKept = desk.held.keys().forall(i => desk.held.get(i).hasText implies not(desk.held.get(i).minorRead))

  // engine relay.ts:125 ("contactShared: A contact share was delivered"): a log row says a number was shared
  // only while that number reached the member or is still on its way.
  val contactSharedImpliesDelivered = desk.log.keys().forall(i => {
    val r = desk.log.get(i)
    (r.kind == "share" and r.contactShared) implies not(g.lost.contains(i))
  })

  // runtime.ts:525 ("keep only the id. Nothing that names the member stays"): after the forget path no stored
  // outbound body holds the erased member's number.
  val erasedNumberGone = queue.rows.keys().forall(key => {
    val r = queue.rows.get(key)
    (r.body and r.send.number) implies not(w.erased.get(r.send.src))
  })

  // relay.ts:15 ("the other member is asked once"): a waiting swap rests on an ask that was not refused, and
  // the ask arrives inside the 15 minutes it names (relay.ts:154).
  val waitingSwapAsked = desk.swaps.forall(s => not(g.askRefused.contains(s.iid)))
  val askInsideWindow = g.events.forall(e => e.ask implies not(e.late))

  // relay-endpoint.ts:8-9 (idempotent on the key): one effect per key.
  val effectAtMostOncePerKey = REQS.forall(k => ep.commits.get(k) <= 1)
  // relay-endpoint.ts:26-27: the receipt, the log, the messages and the rows commit together.
  val completedIffCommitted = REQS.forall(k => (ep.receipt.get(k) == "completed") iff (ep.commits.get(k) == 1))
  // The Cloud wire (contract.ts RelaySendResponse; relay-endpoint.ts:260 retryable:false): a failure answer
  // means nothing was done, so Cloud tells the member it did not go.
  val failureMeansNoEffect = REQS.forall(k => ep.response.get(k) == "409" implies ep.commits.get(k) == 0)

  // photo-relay.ts:215-224 and AGENTS.md decision 9: bytes reach a provider only for an approved, claimed,
  // bound item inside its deadline, between current parties.
  val bytesServedImpliesApprovedBound = photo.servedOk

  // service.ts:2430-2462 and relay.ts:20 ("A held item waits for staff ... release or reject"): a desk-held
  // photo item can be decided: once its selected row is final, the desk row is not left held.
  val photoHeldDecidable = (photo.state == "revoked" or photo.state == "rejected") implies
    not(desk.held.keys().contains(PHOTO_ITEM) and desk.held.get(PHOTO_ITEM).status == "held")

  // relay.ts:236 ("A hold that is only the rate limit ... is answered, not queued: the member can try again"):
  // the selected photo has one fixed id (pri_...), so a rate-only hold must not leave a log row that RelayDesk.prior
  // (relay.ts:319-321) replays as "held" for every later try and every staff release (SD-320).
  val photoRetryAfterRateHold = not(desk.log.keys().contains(PHOTO_ITEM) and desk.log.get(PHOTO_ITEM).decision == "hold"
    and not(desk.held.keys().contains(PHOTO_ITEM)) and photo.state == "approved" and not(photo.claimed))

  // store.ts:143-144: network.relay_records carries the staff review status of each held item.
  val recordReviewMatches = desk.held.keys().forall(i =>
    (desk.held.get(i).status != "held" and queue.records.keys().contains(i)) implies queue.records.get(i).review == desk.held.get(i).status)

  val safety = and {
    noOneWayNumber,
    numberMovesOnlyIfBothConsented,
    withdrawnNotSent,
    rowSentImpliesPass,
    threadOnlyDelivered,
    minorTextNeverKept,
    contactSharedImpliesDelivered,
    erasedNumberGone,
    waitingSwapAsked,
    askInsideWindow,
    effectAtMostOncePerKey,
    completedIffCommitted,
    failureMeansNoEffect,
    bytesServedImpliesApprovedBound,
    photoHeldDecidable,
    photoRetryAfterRateHold,
    recordReviewMatches,
  }

  // ---- Properties outside `safety` (checked one by one; see the findings file).
  // The engine checks consent freshness at decision time only; delivery after quiet hours is by design
  // ("I'll pass that on when it's a reasonable hour", relay.ts:152). Not a stated rule at delivery time.
  val consentFreshAtDelivery = g.events.forall(e => e.number implies e.fresh)
  // SD-133: a held item is decided inside an SLA. No rule in the code sets one.
  val heldDecidedInTime = desk.held.keys().forall(i => desk.held.get(i).status == "held" implies w.now - desk.held.get(i).at <= HELD_SLA)
  // SD-093: a claimed key does not stay processing with no worker. Liveness, not safety.
  val noStuckKey = REQS.forall(k => not(ep.receipt.get(k) == "processing" and ep.phase.get(k) == "dead"))
  // SD-426: an answer "held" has a held row (relay.ts:236-238 answers a rate-only hold with no row by design).
  val heldAnswerHasRow = g.toldHeldNoRow.size() == 0

  // ------------------------------------------------------------------------------------------ witnesses
  // Both members asked inside 15 minutes and both numbers went.
  val witness_bothNumbersGo = not(numberSent("A") and numberSent("B"))
  // A held text was released by staff and reached the other member.
  val witness_heldReleased = not(desk.held.keys().exists(i => desk.held.get(i).status == "released" and desk.held.get(i).kind == "text"
    and queue.rows.keys().contains(i) and queue.rows.get(i).status == "sent"))
  // A deferred relay row went out after quiet hours.
  val witness_deferredFlushed = not(g.events.exists(e => g.flushed.contains(e.key)))
  // A withdrawal committed.
  val witness_withdrawn = not(REQS.exists(k => ep.kind.get(k) == "withdraw" and ep.receipt.get(k) == "completed"))
  // The provider fetched the photo bytes.
  val witness_photoServed = not(photo.served)

  // ------------------------------------------------------------------------------------------ run tests
  // shared-relay.integration.test.ts:102-115: A asks, B is asked once, B asks back, both numbers go.
  run swapBothAskTest =
    init
      .then(claim("a1", "share")).then(commitShare("a1", false, false, false, false, false)).then(answer("a1"))
      .expect(desk.swaps.size() == 1 and queue.rows.keys().contains("a1:ask"))
      .then(queueSend("a1:ask"))
      .then(timePass(5))
      .then(claim("b1", "share")).then(commitShare("b1", false, false, false, false, false)).then(answer("b1"))
      .then(queueSend("a1")).then(queueSend("b1"))
      .expect(numberSent("A") and numberSent("B") and safety)

  // SD-039 (outbound D1): both shares pass at quiet hours and wait in Network.deferred; A says "don't send my
  // number"; the endpoint answers "won't share"; in the morning A's number goes.
  run withdrawAfterSwapTest =
    init
      .then(claim("a1", "share")).then(commitShare("a1", false, false, false, false, false)).then(answer("a1"))
      .then(setQuiet("B", true))
      .then(setQuiet("A", true))
      .then(claim("b1", "share")).then(commitShare("b1", false, false, false, false, false)).then(answer("b1"))
      .expect(desk.deferred.size() == 2)
      .then(claim("a2", "withdraw")).then(commitWithdraw("a2")).then(answer("a2"))
      .then(setQuiet("A", false)).then(setQuiet("B", false))
      .then(tickFlush(Set()))
      .then(queueSend("a1")).then(queueSend("b1"))
      .expect(not(withdrawnNotSent))

  // SD-137 (outbound D24): the unit commits, deliver() throws after the commit, Cloud gets 409 retryable:false.
  run postCommitThrowTest =
    init
      .then(claim("a1", "text")).then(commitText("a1", "pass", false)).then(postCommitThrow("a1"))
      .expect(queue.rows.keys().contains("a1") and not(failureMeansNoEffect))

  // SD-064 (engine D12): Clef reads a minor's words, holds the item, and the text is kept for staff.
  run clefMinorKeptTest =
    init
      .then(claim("a1", "text")).then(commitText("a1", "minorClef", false)).then(answer("a1"))
      .expect(not(minorTextNeverKept))

  // A closed match before admission: the queued row never goes (shared-relay.integration.test.ts:174-212).
  run closeBeforeAdmissionTest =
    init
      .then(claim("a1", "text")).then(commitText("a1", "pass", false)).then(answer("a1"))
      .then(closeMatch).then(queueSend("a1"))
      .expect(queue.rows.get("a1").status == "ended" and g.events.size() == 0 and rowSentImpliesPass)

  // SD-007 (outbound D2, network-core D3): the swap goes one way. A's share to B is queued at once; B's share
  // to A waits in Network.deferred (A is in quiet hours); B blocks A; the tick refuses the deferred share.
  run oneWayDeferredTest =
    init
      .then(claim("a1", "share")).then(commitShare("a1", false, false, false, false, false)).then(answer("a1"))
      .then(setQuiet("A", true))
      .then(claim("b1", "share")).then(commitShare("b1", false, false, false, false, false)).then(answer("b1"))
      .then(queueSend("a1"))
      .then(blockPair).then(setQuiet("A", false)).then(tickFlush(Set()))
      .expect(numberSent("A") and not(numberSent("B")) and not(numberPending("B")) and not(noOneWayNumber))

  // SD-007 by the queue path: both rows are queued; A's row goes; B's row ends unsent (unanswered rule).
  run oneWayQueueTest =
    init
      .then(claim("a1", "share")).then(commitShare("a1", false, false, false, false, false)).then(answer("a1"))
      .then(claim("b1", "share")).then(commitShare("b1", false, false, false, false, false)).then(answer("b1"))
      .then(queueSend("b1")).then(queueFail("a1"))
      .expect(not(noOneWayNumber) and not(contactSharedImpliesDelivered))

  // SD-007 inside one unit: the first share is queued, Network.send refuses the second (conversation streak).
  // B now holds A's number; A is told "I can't swap numbers right now".
  run oneWayInUnitTest =
    init
      .then(claim("a1", "share")).then(commitShare("a1", false, false, false, false, false)).then(answer("a1"))
      .then(claim("b1", "share")).then(commitShare("b1", false, false, false, false, true)).then(answer("b1"))
      .then(queueSend("a1"))
      .expect(numberSent("A") and not(numberPending("B")) and not(noOneWayNumber))

  // SD-040 (outbound D16): the swap completes, then A deletes everything. B's row keeps A's number.
  run erasedNumberStaysTest =
    init
      .then(claim("a1", "share")).then(commitShare("a1", false, false, false, false, false)).then(answer("a1"))
      .then(claim("b1", "share")).then(commitShare("b1", false, false, false, false, false)).then(answer("b1"))
      .then(queueSend("a1")).then(queueSend("b1"))
      .then(erase("A"))
      .expect(not(erasedNumberGone))

  // SD-138 (outbound D27): the ask is refused at send time, the swap still waits and A hears "I'll share your
  // number as soon as they say"; and an ask that waits in the queue arrives after its 15 minutes.
  run askRefusedTest =
    init
      .then(claim("a1", "share")).then(commitShare("a1", false, false, true, false, false)).then(answer("a1"))
      .expect(desk.swaps.size() == 1 and not(waitingSwapAsked))
  run askLateTest =
    init
      .then(claim("a1", "share")).then(commitShare("a1", false, false, false, false, false)).then(answer("a1"))
      .then(timePass(20)).then(queueSend("a1:ask"))
      .expect(not(askInsideWindow))

  // SD-387 (scaled: LOG_MAX = 3 for 5000): a held item's log row is pushed out by newer rows; the staff
  // reject then writes no relay_records row, and the stored review stays "held".
  run logCapTest =
    init
      .then(claim("a1", "text")).then(commitText("a1", "hold", false)).then(answer("a1"))
      .then(claim("a2", "text")).then(commitText("a2", "block", false)).then(answer("a2"))
      .then(claim("b1", "text")).then(commitText("b1", "block", false)).then(answer("b1"))
      .then(claim("b2", "text")).then(commitText("b2", "block", false)).then(answer("b2"))
      .then(staffReject("a1"))
      .expect(queue.records.get("a1").review == "held" and not(recordReviewMatches))

  // SD-320 (outbound D26), the part the model reaches: a rate-only hold on the fixed photo id pri_... makes
  // every later try and every staff release replay "held".
  run photoRateHoldTest =
    init
      .then(selectPhoto).then(reviewPhoto(true)).then(photoRequest(true, false))
      .expect(not(photoRetryAfterRateHold))

  // Q-relay-1: a passed text is queued and its wording enters the relay thread; the match closes before the
  // queue admission, the row ends unsent, and the thread keeps wording the other member never got.
  run threadKeepsUndeliveredTest =
    init
      .then(claim("a1", "text")).then(commitText("a1", "pass", false)).then(answer("a1"))
      .then(closeMatch).then(queueSend("a1"))
      .expect(desk.thread.contains("a1") and not(threadOnlyDelivered))

  // Regression guard for the selected photo: the bytes go only on the bound, approved, unexpired item.
  run photoServedTest =
    init
      .then(selectPhoto).then(reviewPhoto(true)).then(photoRequest(false, false))
      .then(queueSend(PHOTO_ITEM)).then(resolvePhoto).then(fetchBytes)
      .expect(photo.served and bytesServedImpliesApprovedBound)
}
