// -*- mode: Bluespec; -*-
// quint-check: max-steps=40 max-samples=8000 verify-steps=3
//
// The persisted outbound queue of the shared Blooio line (platform.outbound) and the Cloud deliver path.
// Plan: docs/research/2026-11-07-state-machines.md section 6.5. Source reports:
// docs/research/state-machines/network-service-outbound.md sections 1-3 and blooio-notify.md.
// Findings: docs/research/quint-findings/outbound_queue.md.
//
// Machines in this model: outbound-queue-row, line-drain-lease, cloud-deliver-handshake, collected-reply,
// leak-review, leak-gate (oracle), person-cap-slot, quiet-hours (oracle), live-send-gate, turn-receipt,
// delivery-receipts, line-conversation, line-safety, message-status-mirror.
//
// Code abbreviations: oq = packages/blooio/src/outbound-queue.ts, ch = packages/network/service/channel.ts,
// cc = packages/network/service/cloud-channel.ts, rt = packages/network/service/runtime.ts,
// svc = packages/network/service/service.ts, 0007/0012 = packages/observatory/db/migrations.
//
// Abstractions (each one is a choice of the model, not a fact of the code):
//  - One recipient (one person, one address on the line). A row is to a member of that person's app, or it
//    is a direct text to a non-member (member = false). Three row ids.
//  - Time is an integer; one unit is 5 minutes. LEASE = 5 min, REPLY_WINDOW = 1 h, UNKNOWN_TTL = 6 h,
//    TTL_PROACTIVE = 24 h, TTL_ANY = 3 days, as in the code. The person cap (3 a day) and the unanswered cap
//    (3) are scaled to 1, and maxAttempts (6) to 2, so that 3 rows can reach them.
//  - Workers are replicas (or one replica's runtimes). A drain is: recover (oq:272), reconcileUnknown
//    (oq:581, no line lock), then the line lock (oq:255) and one dispatch per due row. One dispatch is two
//    steps: `decide` reads every gate at once (gates 0-10, oq:364-435) and takes the cap slot; `applyDecision`
//    writes the wait or end, or runs the admission transaction (oq:467-501). Time does not advance between
//    the two steps (they are milliseconds apart in the code).
//  - The leak guard, the quiet-hours clock, the stale hook's errors, Cloud and the gateway are oracles:
//    the actions take their answers as parameters and `step` chooses them nondeterministically.
//  - The recipient policy and the stale hook read the runtime's in-memory Network (ch:180-186). Each worker
//    has its own view; `refresh` copies the database into it (a unit of work on that replica).
//  - The per-recipient hourly cap, the line caps and invalid time zones are left out (3 rows cannot reach
//    them). The live flags are fixed for a run (they are process env).
module outbound_queue {

  // ------------------------------------------------------------------ constants
  pure val ROWS = Set("r1", "r2", "r3")
  pure val WORKERS = Set("w1", "w2")
  pure val HANDLERS = Set("h1", "h2")
  pure val NETS = Set("nyc", "sf")
  pure val KINDS = Set("reply", "compliance", "proactive", "transactional")
  pure val LEASE = 1
  pure val REPLY_WINDOW = 12
  pure val UNKNOWN_TTL = 72
  pure val TTL_PROACTIVE = 288
  pure val TTL_ANY = 864
  pure val DAY = 288
  pure val REENGAGE = 4032
  pure val MAX_UNANSWERED = 1
  pure val CAP = 1
  pure val MAX_ATTEMPTS = 2
  pure val QUIET_DEFER = 1     // nextAllowedAt is abstract: "a later time"
  pure val TICKS = Set(1, 12, 72)
  pure val MAX_CRASHES = 1
  pure val MAX_TURNS = 2

  // Statuses (oq:188-195).
  pure val WAITING = Set("pending", "retry_scheduled", "deferred_quiet_hours", "held_awaiting_reply", "sending", "unknown_acceptance")
  pure val DUE = Set("pending", "retry_scheduled", "deferred_quiet_hours")
  pure val IN_FLIGHT = Set("accepted", "sent")
  // NOT_SENT = /^(refused|suppressed|blocked|parked|failed|expired|dropped)/ (oq:195), over the statuses that occur.
  pure val NOT_SENT = Set("refused_not_approved", "refused_opted_out", "refused_person_cap", "refused_gateway",
    "suppressed_ineligible", "blocked", "parked_leak_review", "parked_error", "failed", "failed_unknown",
    "expired", "dropped_forgotten", "dropped_leak_review")
  pure val PROVIDER = Set("accepted", "sent", "delivered", "read")

  pure def rank(st: str): int =
    if (st == "accepted") 1 else if (st == "sent") 2 else if (st == "delivered") 3 else if (st == "read") 4
    else if (WAITING.contains(st) or st == "none" or st == "collected" or st == "send_unknown") 0 else 5
  // PROVIDER_RANK (oq:193): rows that did not go out have none.
  pure def providerRank(st: str): int =
    if (st == "accepted") 1 else if (st == "sent") 2 else if (st == "delivered") 3 else if (st == "read") 4 else -1

  pure def isAgent(kind: str): bool = kind != "reply" and kind != "compliance"   // oq:49-51

  // ------------------------------------------------------------------ types
  type Row = {
    status: str, kind: str, member: bool, net: str, created: int, attempts: int,
    lease: bool, leaseUntil: int, nextAt: int, personCap: bool, hasBody: bool,
    leakBad: bool,        // what the leak guard says about this text (oracle, fixed per text)
    leakReleased: bool,   // leak_released_by (migration 0032)
    guardFailed: bool,    // a collected reply that failed the leak guard and went to the queue (rt:473-477)
    sentAt: bool, cause: str, turnLive: bool, lastWait: str,
    doubt: bool           // in_doubt under a receipt provider: no definite answer since the last provider call
  }
  type Work = {
    phase: str,           // idle, reconcile, ttl, looked, locked, decided, calling, responded, flush
    row: str, dec: str, readStatus: str, readSeq: int, isNew: bool, reeng: bool, resp: str,
    direct: bool,         // BlooioAdapter.direct: the drain's changes are discarded (ch:240-241)
    net: str, seen: Set[str], pend: List[(str, str)]
  }
  type Ghost = {
    maxRank: int, bad: Set[str], foreign: bool, receiptRefused: bool, projected: bool,
    heldSeq: int, deliveryFailed: bool, wasDeferred: bool, wasParked: bool
  }
  type Conv = { exists: bool, unanswered: int, reUsed: bool, lastIn: int, lastOut: int }
  type Env = {
    now: int, mode: str, live: bool, optedOut: bool, held: bool, closed: bool, erased: bool,
    lineSafety: str, lineHolder: str, inSeq: int, turn: str, engagePending: bool,
    trueUnans: int, reengSent: bool, crashes: int,
    twoNets: bool,        // a second network of the app (slop:sf next to slop:nyc) has its own runtime and queue
    engSeq: int           // how many times queue.inbound (engaged) ran: it releases the held rows
  }
  type Hook = { phase: str, row: str, st: str, readStatus: str }
  type View = { held: bool, closed: bool }

  // ------------------------------------------------------------------ state
  var rows: str -> Row
  var work: str -> Work
  var ghost: str -> Ghost
  var env: Env
  var conv: Conv
  var views: str -> View
  var slots: Set[str]          // platform.person_sends of the person (0007:168-189)
  var admitted: Set[str]       // ids the provider (Cloud or Blooio) took: the person gets (or got) the text
  var mirror: str -> str       // network.messages.status of member rows ("none": no message row)
  var hooks: str -> Hook       // Blooio status webhooks in progress (blooio mode)

  pure val NO_ROW: Row = {
    status: "none", kind: "reply", member: false, net: "nyc", created: 0, attempts: 0, lease: false, leaseUntil: 0,
    nextAt: 0, personCap: false, hasBody: false, leakBad: false, leakReleased: false, guardFailed: false,
    sentAt: false, cause: "", turnLive: false, lastWait: "", doubt: false
  }
  pure val IDLE: Work = { phase: "idle", row: "", dec: "", readStatus: "", readSeq: 0, isNew: false, reeng: false,
    resp: "", direct: false, net: "nyc", seen: Set(), pend: List() }
  pure val NO_GHOST: Ghost = { maxRank: 0, bad: Set(), foreign: false, receiptRefused: false, projected: false,
    heldSeq: 0, deliveryFailed: false, wasDeferred: false, wasParked: false }

  // ------------------------------------------------------------------ helpers on rows
  // end() (oq:337-347): no status guard; a non-member row loses its text and address unless parked for leak review.
  pure def endRow(row: Row, st: str, cause: str): Row =
    { ...row, status: st, lease: false, cause: cause,
      hasBody: if (not(row.member) and st != "parked_leak_review") false else row.hasBody }
  // wait() (oq:350-353): no status guard.
  pure def waitRow(row: Row, st: str, at: int, why: str): Row =
    { ...row, status: st, nextAt: at, lease: false, lastWait: why }
  // The cap slot goes back when the end status is NOT_SENT (oq:345).
  pure def releaseSlot(s: Set[str], r: str, row: Row, st: str): Set[str] =
    if (row.personCap and NOT_SENT.contains(st)) s.exclude(Set(r)) else s
  pure def bump(g: str -> Ghost, r: str, st: str): str -> Ghost =
    g.setBy(r, x => { ...x, maxRank: if (rank(st) > x.maxRank) rank(st) else x.maxRank })
  pure def push(w: Work, r: str, member: bool, st: str): List[(str, str)] =
    if (member) w.pend.append((r, st)) else w.pend

  // acceptReceipt's commit (oq:543-568): only a row still sending or unknown_acceptance with its text.
  pure def acceptOk(row: Row): bool = (row.status == "sending" or row.status == "unknown_acceptance") and row.hasBody
  pure def convAfterAccept(c: Conv, row: Row, reeng: bool, now: int): Conv =
    { exists: true,
      unanswered: if (c.exists and c.lastIn > now) c.unanswered else c.unanswered + (if (row.kind == "compliance") 0 else 1),
      reUsed: c.reUsed or reeng,
      lastIn: c.lastIn,
      lastOut: if (c.exists and c.lastOut > now) c.lastOut else now }

  // ------------------------------------------------------------------ init
  action initWith(mode: str, live: bool, twoNets: bool): bool = all {
    rows' = ROWS.mapBy(_ => NO_ROW),
    work' = WORKERS.mapBy(_ => IDLE),
    ghost' = ROWS.mapBy(_ => NO_GHOST),
    env' = { now: 0, mode: mode, live: live, optedOut: false, held: false, closed: false, erased: false,
      lineSafety: "none", lineHolder: "", inSeq: 0, turn: "none", engagePending: false, trueUnans: 0,
      reengSent: false, crashes: 0, twoNets: twoNets, engSeq: 0 },
    conv' = { exists: false, unanswered: 0, reUsed: false, lastIn: -1, lastOut: -1 },
    views' = WORKERS.mapBy(_ => { held: false, closed: false }),
    slots' = Set(),
    admitted' = Set(),
    mirror' = ROWS.mapBy(_ => "none"),
    hooks' = HANDLERS.mapBy(_ => { phase: "idle", row: "", st: "", readStatus: "" }),
  }
  action init = {
    nondet mode = oneOf(Set("cloud", "blooio"))
    nondet two = oneOf(Set(true, false))
    initWith(mode, true, two)
  }

  // ------------------------------------------------------------------ enqueue (in the unit's save transaction)
  // oq:223-251 via ch:215-231, rt:555-559. A refused enqueue (live flags off, ch:217-221) writes no row.
  // network.messages gets "queued" for a member row (rt:483-486).
  action enqueue(r: str, kind: str, member: bool, net: str, leakBad: bool): bool = all {
    rows.get(r).status == "none",
    env.live,
    not(member) implies kind != "proactive",          // a direct text is never proactive (ch:85)
    member implies not(env.erased),
    rows' = rows.set(r, { ...NO_ROW, status: "pending", kind: kind, member: member, net: net, created: env.now,
      nextAt: env.now, hasBody: true, leakBad: leakBad }),
    mirror' = mirror.set(r, if (member) "queued" else "none"),
    work' = work, ghost' = ghost, env' = env, conv' = conv, views' = views, slots' = slots, admitted' = admitted, hooks' = hooks,
  }

  // ------------------------------------------------------------------ drain: recover and reconcileUnknown (no line lock)
  // drain() (oq:282-304): recover() first. A sending row whose lease ran out goes to unknown_acceptance under a
  // receipt provider (Cloud), else to retry_scheduled (oq:272-279).
  action drainStart(w: str, net: str, direct: bool): bool = {
    val recovered = ROWS.filter(r => rows.get(r).status == "sending" and rows.get(r).leaseUntil < env.now)
    val target = if (env.mode == "cloud") "unknown_acceptance" else "retry_scheduled"
    all {
      work.get(w).phase == "idle",
      rows' = rows.keys().mapBy(r => if (recovered.contains(r))
        { ...rows.get(r), status: target, lease: false, nextAt: env.now, doubt: env.mode == "cloud" } else rows.get(r)),
      work' = work.set(w, { ...IDLE, phase: "reconcile", net: net, direct: direct }),
      ghost' = ghost, env' = env, conv' = conv, views' = views, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
    }
  }

  // reconcileUnknown, part 1 (oq:584-589): rows still unknown and created more than 6 h ago are selected...
  action ttlSelect(w: str, r: str): bool = all {
    work.get(w).phase == "reconcile",
    rows.get(r).status == "unknown_acceptance",
    rows.get(r).created < env.now - UNKNOWN_TTL,
    work' = work.setBy(w, x => { ...x, phase: "ttl", row: r }),
    rows' = rows, ghost' = ghost, env' = env, conv' = conv, views' = views, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
  }
  // ...then each one ends failed_unknown with end() (no status guard) and gives its cap slot back.
  action ttlEnd(w: str): bool = {
    val wk = work.get(w)
    val row = rows.get(wk.row)
    all {
      wk.phase == "ttl",
      rows' = rows.set(wk.row, endRow(row, "failed_unknown", "unknown_ttl")),
      slots' = releaseSlot(slots, wk.row, row, "failed_unknown"),
      ghost' = bump(ghost, wk.row, "failed_unknown"),
      work' = work.set(w, { ...wk, phase: "reconcile", pend: push(wk, wk.row, row.member, "failed_unknown") }),
      env' = env, conv' = conv, views' = views, admitted' = admitted, mirror' = mirror, hooks' = hooks,
    }
  }

  // reconcileUnknown, part 2 (oq:590-608, Cloud only): a receipt lookup, never a send (cc:57-61).
  // The answer: "ok" only when Cloud admitted the id; "notfound" only when it did not; "ambiguous" always possible.
  action lookupCall(w: str, r: str, answer: str): bool = all {
    env.mode == "cloud",
    work.get(w).phase == "reconcile",
    rows.get(r).status == "unknown_acceptance",
    rows.get(r).hasBody,
    if (admitted.contains(r)) answer != "notfound" else answer != "ok",
    work' = work.setBy(w, x => { ...x, phase: "looked", row: r, resp: answer }),
    rows' = rows, ghost' = ghost, env' = env, conv' = conv, views' = views, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
  }
  action lookupApply(w: str): bool = {
    val wk = work.get(w)
    val r = wk.row
    val row = rows.get(r)
    if (wk.resp == "ok") {
      // acceptReceipt (oq:538-573): commit when the row is still unknown; otherwise report dropped_forgotten.
      val ok = acceptOk(row)
      val st = if (ok) "accepted" else "dropped_forgotten"
      all {
        wk.phase == "looked",
        rows' = if (ok) rows.set(r, { ...row, status: "accepted", sentAt: true, lease: false }) else rows,
        conv' = if (ok) convAfterAccept(conv, row, false, env.now) else conv,
        ghost' = if (ok) bump(ghost, r, "accepted") else ghost,
        work' = work.set(w, { ...wk, phase: "reconcile", pend: push(wk, r, row.member, st) }),
        env' = env, views' = views, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
      }
    } else if (wk.resp == "notfound") {
      // Never admitted: back to the queue with the same key, guarded on unknown_acceptance (oq:598-603).
      val moved = row.status == "unknown_acceptance"
      all {
        wk.phase == "looked",
        rows' = if (moved) rows.set(r, { ...row, status: "retry_scheduled", nextAt: env.now, doubt: false }) else rows,
        work' = work.set(w, { ...wk, phase: "reconcile", pend: if (moved) push(wk, r, row.member, "retry_scheduled") else push(wk, r, row.member, "unknown_acceptance") }),
        ghost' = ghost, conv' = conv, env' = env, views' = views, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
      }
    } else all {
      // Ambiguous: the row stays held; its status is mirrored (oq:604-605).
      wk.phase == "looked",
      work' = work.set(w, { ...wk, phase: "reconcile", pend: push(wk, r, row.member, "unknown_acceptance") }),
      rows' = rows, ghost' = ghost, conv' = conv, env' = env, views' = views, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
    }
  }

  // ------------------------------------------------------------------ drain: the line lock and dispatch
  action lockLine(w: str): bool = all {
    work.get(w).phase == "reconcile",
    env.lineHolder == "",
    work' = work.setBy(w, x => { ...x, phase: "locked", seen: Set() }),
    env' = { ...env, lineHolder: w },
    rows' = rows, ghost' = ghost, conv' = conv, views' = views, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
  }

  // dispatch gates 0-10 (oq:364-435), read at one instant. The cap slot is taken here (gate 9, its own
  // transaction, 0007:168-189). Oracles: staleErr (the stale hook throws: guarded(..., false) at oq:371),
  // quiet (quiet hours in the recipient's zone).
  action decide(w: str, r: str, staleErr: bool, quiet: bool): bool = {
    val wk = work.get(w)
    val row = rows.get(r)
    val view = views.get(w)
    val agent = isAgent(row.kind)
    val compliance = row.kind == "compliance"
    val foreign = row.net != wk.net
    val age = env.now - row.created
    val tooOld = age > TTL_ANY or (row.kind == "proactive" and age > TTL_PROACTIVE)
    // stale (ch:180-181): an item row whose opportunity the worker's in-memory Network has as closed.
    val hasItem = row.member and agent
    val stale = hasItem and not(foreign) and view.closed and not(staleErr)
    // recipient (ch:185-186): a non-member direct text passes; a member row asks the in-memory policy.
    // A row of another network of the app: memberOf misses, unknown_recipient (network.ts:4848).
    val recipientOk = if (not(row.member)) true else if (foreign) false else not(agent and view.held)
    val replyLate = row.kind == "reply" and (conv.lastIn < 0 or env.now - conv.lastIn > REPLY_WINDOW)
    val capped = not(compliance) and conv.exists and conv.unanswered >= MAX_UNANSWERED
    val reengOk = agent and not(conv.reUsed) and env.now - conv.lastOut >= REENGAGE
    val isNew = not(conv.exists)
    val safetyHold = env.lineSafety == "review" or (env.lineSafety == "reply_only" and (agent or isNew))
      or (env.lineSafety == "pause_new" and isNew)
    val capNeeded = row.kind == "proactive" and row.member
    val capOk = slots.contains(r) or slots.size() < CAP
    val dec =
      if (tooOld or stale) "expired"
      else if (not(env.live)) "refused_not_approved"
      else if (not(compliance) and env.optedOut) "refused_opted_out"
      else if (not(compliance) and not(recipientOk)) "suppressed_recipient"
      else if (row.kind == "reply" and replyLate) "suppressed_reply"
      else if (agent and quiet) "deferred"
      else if (capped and not(reengOk)) "held"
      else if (safetyHold) "safety_wait"
      else if (capNeeded and not(capOk)) "refused_person_cap"
      else if (row.leakBad and not(row.leakReleased)) "parked_leak_review"
      else "send"
    val takes = capNeeded and (dec == "parked_leak_review" or dec == "send")
    all {
      wk.phase == "locked",
      not(wk.seen.contains(r)),
      DUE.contains(row.status),
      row.nextAt <= env.now,
      work' = work.set(w, { ...wk, phase: "decided", row: r, dec: dec, readStatus: row.status, readSeq: env.engSeq,
        isNew: isNew, reeng: capped and reengOk, seen: wk.seen.union(Set(r)) }),
      rows' = if (takes) rows.set(r, { ...row, personCap: true }) else rows,
      slots' = if (takes) slots.union(Set(r)) else slots,
      ghost' = if (foreign) ghost.setBy(r, x => { ...x, foreign: true }) else ghost,
      env' = env, conv' = conv, views' = views, admitted' = admitted, mirror' = mirror, hooks' = hooks,
    }
  }

  // The worker's row ends (end(), oq:337-347) or waits (wait(), oq:350-353); the change joins the drain's list.
  action endAct(w: str, st: str, cause: str): bool = {
    val wk = work.get(w)
    val r = wk.row
    val row = rows.get(r)
    all {
      rows' = rows.set(r, endRow(row, st, cause)),
      slots' = releaseSlot(slots, r, row, st),
      ghost' = bump(ghost, r, st).setBy(r, x => { ...x, wasParked: x.wasParked or st == "parked_leak_review" }),
      work' = work.set(w, { ...wk, phase: "locked", pend: push(wk, r, row.member, st) }),
      conv' = conv, env' = env, views' = views, admitted' = admitted, mirror' = mirror, hooks' = hooks,
    }
  }
  action waitAct(w: str, st: str, at: int, why: str, doubt: bool, seq: int): bool = {
    val wk = work.get(w)
    val r = wk.row
    val row = rows.get(r)
    all {
      rows' = rows.set(r, { ...waitRow(row, st, at, why), doubt: doubt }),
      ghost' = bump(ghost, r, st).setBy(r, x => { ...x, heldSeq: seq, wasDeferred: x.wasDeferred or st == "deferred_quiet_hours" }),
      work' = work.set(w, { ...wk, phase: "locked", pend: push(wk, r, row.member, st) }),
      slots' = slots, conv' = conv, env' = env, views' = views, admitted' = admitted, mirror' = mirror, hooks' = hooks,
    }
  }

  // The write of the decision. A wait or an end (no status guard), or the admission transaction (oq:467-501).
  // dbErr: the admission transaction throws (deadlock, reset): the drain's catch parks the row (oq:295-299).
  action applyDecision(w: str, dbErr: bool): bool = {
    val wk = work.get(w)
    val r = wk.row
    val row = rows.get(r)
    val compliance = row.kind == "compliance"
    val agent = isAgent(row.kind)
    // Admission (oq:470-500): the member and its binding, the member's opt-out (members only), then the CAS claim.
    val adm =
      if (dbErr) "parked_error"
      else if (row.member and env.erased) "dropped_forgotten"
      else if (row.member and not(compliance) and env.optedOut) "refused_opted_out"
      else if (row.status == wk.readStatus and not(row.lease) and row.hasBody) "admitted"
      else if (row.status != wk.readStatus or row.lease) "busy"
      else "dropped_forgotten"
    // Ghost: what the claim admitted against the database at this instant.
    val bad = Set(
      if (not(compliance) and env.optedOut) "afterStop" else "",
      if (row.member and agent and env.held) "whileHeld" else "",
      if (row.member and agent and env.closed) "whenClosed" else "",
      if (row.doubt) "inDoubt" else "",
      if (row.leakBad and not(row.leakReleased)) "leak" else "").exclude(Set(""))
    all {
      wk.phase == "decided",
      if (wk.dec == "expired") endAct(w, "expired", "")
      else if (wk.dec == "refused_not_approved") endAct(w, "refused_not_approved", "")
      else if (wk.dec == "refused_opted_out") endAct(w, "refused_opted_out", "")
      else if (wk.dec == "suppressed_recipient") endAct(w, "suppressed_ineligible", "recipient")
      else if (wk.dec == "suppressed_reply") endAct(w, "suppressed_ineligible", "reply_window")
      else if (wk.dec == "deferred") waitAct(w, "deferred_quiet_hours", env.now + QUIET_DEFER, "quiet", row.doubt, wk.readSeq)
      else if (wk.dec == "held") waitAct(w, "held_awaiting_reply", env.now, "unanswered", row.doubt, wk.readSeq)
      else if (wk.dec == "safety_wait") waitAct(w, "retry_scheduled", env.now + 12, "line_safety", row.doubt, wk.readSeq)
      else if (wk.dec == "refused_person_cap") endAct(w, "refused_person_cap", "")
      else if (wk.dec == "parked_leak_review") endAct(w, "parked_leak_review", "leak")
      else if (adm == "admitted") all {
        rows' = rows.set(r, { ...row, status: "sending", attempts: row.attempts + 1, lease: true, leaseUntil: env.now + LEASE }),
        ghost' = bump(ghost, r, "sending").setBy(r, x => { ...x, bad: x.bad.union(bad) }),
        work' = work.set(w, { ...wk, phase: "calling" }),
        slots' = slots, conv' = conv, env' = env, views' = views, admitted' = admitted, mirror' = mirror, hooks' = hooks,
      }
      else if (adm == "busy") all {
        // Another worker claimed or ended it: report its status, write nothing (oq:497-502).
        work' = work.set(w, { ...wk, phase: "locked", pend: push(wk, r, row.member, row.status) }),
        rows' = rows, ghost' = ghost, slots' = slots, conv' = conv, env' = env, views' = views, admitted' = admitted, mirror' = mirror, hooks' = hooks,
      }
      else endAct(w, adm, "admission")
    }
  }

  // The provider call (oq:506; Cloud: cc:24-68). Cloud is idempotent on the id: an admitted id is replayed.
  // Outcomes: ok (admitted, answer seen), lost (admitted, answer lost: unknown), netfail (not admitted, unknown),
  // rejected (refused before dispatch: retryable), optout (Cloud's fence: blocked), invalid (failed),
  // await (Blooio conversation limit), failedReceipt (Blooio answers with status failed).
  action providerCall(w: str, out: str): bool = {
    val wk = work.get(w)
    val r = wk.row
    val row = rows.get(r)
    val takes = out == "ok" or out == "lost"
    val fresh = takes and not(admitted.contains(r))
    all {
      wk.phase == "calling",
      admitted.contains(r) implies takes,
      env.mode == "cloud" implies (out != "await" and out != "failedReceipt"),
      admitted' = if (takes) admitted.union(Set(r)) else admitted,
      env' = { ...env,
        trueUnans: env.trueUnans + (if (fresh and row.kind != "compliance") 1 else 0),
        reengSent: env.reengSent or (fresh and wk.reeng) },
      work' = work.set(w, { ...wk, phase: "responded", resp: out }),
      rows' = rows, ghost' = ghost, conv' = conv, views' = views, slots' = slots, mirror' = mirror, hooks' = hooks,
    }
  }

  // The answer is written (oq:505-529). dbErr: the accept transaction throws. send() returns acceptReceipt(...)
  // without await (oq:507), so the rejection skips send's catch and reaches the drain's catch (oq:295-299), which
  // ends the row parked_error with end() and gives its cap slot back. The same path takes the "Invalid acceptance
  // receipt" error of oq:541.
  action respond(w: str, dbErr: bool): bool = {
    val wk = work.get(w)
    val r = wk.row
    val row = rows.get(r)
    val retryable = wk.resp == "rejected"
    all {
      wk.phase == "responded",
      wk.resp == "ok" or not(dbErr),
      if (wk.resp == "ok" and dbErr) endAct(w, "parked_error", "dispatch_error")
      else if (retryable) {
        if (row.attempts >= MAX_ATTEMPTS) endAct(w, "failed", "provider") else waitAct(w, "retry_scheduled", env.now + 1, "retry", false, env.engSeq)
      }
      else if (wk.resp == "ok") {
        val ok = acceptOk(row)
        all {
          rows' = if (ok) rows.set(r, { ...row, status: "accepted", sentAt: true, lease: false }) else rows,
          conv' = if (ok) convAfterAccept(conv, row, wk.reeng, env.now) else conv,
          ghost' = if (ok) bump(ghost, r, "accepted") else ghost,
          work' = work.set(w, { ...wk, phase: "locked", pend: push(wk, r, row.member, if (ok) "accepted" else "dropped_forgotten") }),
          slots' = slots, env' = env, views' = views, admitted' = admitted, mirror' = mirror, hooks' = hooks,
        }
      }
      else if (wk.resp == "failedReceipt") {
        // The receipt carries status failed: the commit writes sent_at, then end(failed) (oq:547-570).
        val ok = acceptOk(row)
        all {
          rows' = if (ok) rows.set(r, endRow({ ...row, sentAt: true }, "failed", "provider")) else rows,
          slots' = if (ok) releaseSlot(slots, r, row, "failed") else slots,
          ghost' = if (ok) bump(ghost, r, "failed") else ghost,
          work' = work.set(w, { ...wk, phase: "locked", pend: push(wk, r, row.member, if (ok) "failed" else "dropped_forgotten") }),
          conv' = conv, env' = env, views' = views, admitted' = admitted, mirror' = mirror, hooks' = hooks,
        }
      }
      else if (wk.resp == "lost" or wk.resp == "netfail")
        waitAct(w, "unknown_acceptance", env.now, "unknown", env.mode == "cloud", env.engSeq)
      else if (wk.resp == "await") waitAct(w, "held_awaiting_reply", env.now, "await_recipient", false, env.engSeq)
      else if (wk.resp == "optout") endAct(w, "blocked", "provider")
      else endAct(w, "failed", "provider")
    }
  }

  action unlockLine(w: str): bool = all {
    work.get(w).phase == "locked",
    work' = work.setBy(w, x => { ...x, phase: "flush" }),
    env' = { ...env, lineHolder: "" },
    rows' = rows, ghost' = ghost, conv' = conv, views' = views, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
  }

  // drainQueue -> storeStatuses (rt:612-617): the changes of member rows go to network.messages in order.
  // A message of a forgotten member was deleted (rt:529): nothing to update. direct() discards them (ch:241).
  action flush(w: str): bool = {
    val wk = work.get(w)
    all {
      wk.phase == "flush",
      mirror' = if (wk.direct) mirror else wk.pend.foldl(mirror, (m, c) =>
        if (env.erased or m.get(c._1) == "none") m else m.set(c._1, c._2)),
      work' = work.set(w, IDLE),
      rows' = rows, ghost' = ghost, env' = env, conv' = conv, views' = views, slots' = slots, admitted' = admitted, hooks' = hooks,
    }
  }

  // A process stops (crash, deploy). Its in-memory changes are lost; leases stay; the advisory lock goes.
  action crash(w: str): bool = all {
    work.get(w).phase != "idle",
    env.crashes < MAX_CRASHES,
    work' = work.set(w, IDLE),
    env' = { ...env, lineHolder: if (env.lineHolder == w) "" else env.lineHolder, crashes: env.crashes + 1 },
    rows' = rows, ghost' = ghost, conv' = conv, views' = views, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
  }

  // ------------------------------------------------------------------ the notify projection (rt:621-647)
  // Repairs the message status of a row the provider took, once (notification_recorded_at).
  action project(r: str): bool = {
    val row = rows.get(r)
    all {
      row.member, not(env.erased), PROVIDER.contains(row.status), row.sentAt, row.hasBody,
      not(ghost.get(r).projected),
      mirror' = mirror.set(r, row.status),
      ghost' = ghost.setBy(r, x => { ...x, projected: true }),
      rows' = rows, work' = work, env' = env, conv' = conv, views' = views, slots' = slots, admitted' = admitted, hooks' = hooks,
    }
  }

  // ------------------------------------------------------------------ the person and the Network
  // A signed turn starts (svc:2051-2088). In a signed turn `engaged` runs only after inbound() returns
  // (svc:1027, svc:2088); the Network's unit (and its drain) runs inside inbound().
  action turnStart: bool = all {
    env.turn != "open",
    env.inSeq < MAX_TURNS,
    env' = { ...env, turn: "open", inSeq: env.inSeq + 1, trueUnans: 0, reengSent: false, engagePending: true },
    rows' = rows, work' = work, ghost' = ghost, conv' = conv, views' = views, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
  }

  // queue.inbound (oq:638-645): the streak resets and held rows of the address go back to pending.
  action engaged: bool = all {
    env.engagePending,
    conv' = { ...conv, exists: true, unanswered: 0, reUsed: false, lastIn: env.now },
    rows' = rows.keys().mapBy(r => if (rows.get(r).status == "held_awaiting_reply")
      { ...rows.get(r), status: "pending", nextAt: env.now } else rows.get(r)),
    env' = { ...env, engagePending: false, engSeq: env.engSeq + 1 },
    work' = work, ghost' = ghost, views' = views, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
  }

  // A reply in a signed turn (rt:421-424, rt:473-490): the queue's leak guard runs first; a pass is collected
  // (Cloud sends it), a fail goes into the queue like any send (rt:470-477).
  action collect(r: str, kind: str, leakBad: bool): bool = all {
    env.turn == "open",
    rows.get(r).status == "none",
    not(env.erased),
    kind == "reply" or kind == "compliance",
    rows' = rows.set(r, if (leakBad)
        { ...NO_ROW, status: "pending", kind: kind, member: true, net: "nyc", created: env.now, nextAt: env.now,
          hasBody: true, leakBad: true, guardFailed: true }
      else
        { ...NO_ROW, status: "collected", kind: kind, member: true, net: "nyc", created: env.now, nextAt: env.now,
          hasBody: true, turnLive: true }),
    mirror' = mirror.set(r, if (leakBad) "queued" else "collected"),
    work' = work, ghost' = ghost, env' = env, conv' = conv, views' = views, slots' = slots, admitted' = admitted, hooks' = hooks,
  }

  // The turn ends: handled (the gateway gets the replies) or unresolved (a throw: svc:2058; the gateway never
  // gets them, and every later receipt answers turn_unavailable, svc:2011).
  action turnFinish(handled: bool): bool = all {
    env.turn == "open",
    env' = { ...env, turn: if (handled) "handled" else "unresolved" },
    rows' = if (handled) rows else rows.keys().mapBy(r => if (rows.get(r).turnLive) { ...rows.get(r), turnLive: false } else rows.get(r)),
    work' = work, ghost' = ghost, conv' = conv, views' = views, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
  }

  // The gateway sends a collected reply (an assumption: it sends only replies of a handled turn).
  action gatewaySend(r: str): bool = all {
    env.turn == "handled",
    rows.get(r).status == "collected",
    rows.get(r).turnLive,
    not(admitted.contains(r)),
    admitted' = admitted.union(Set(r)),
    env' = { ...env, trueUnans: env.trueUnans + (if (rows.get(r).kind == "compliance") 0 else 1) },
    rows' = rows, work' = work, ghost' = ghost, conv' = conv, views' = views, slots' = slots, mirror' = mirror, hooks' = hooks,
  }

  // POST /internal/turn-receipt (svc:2003-2043, oq:696-703). Accepted without history is refused (400) unless
  // the reply is account-free (compliance, svc:2028-2033). The gateway reports accepted only for what it sent.
  action gatewayReceipt(r: str, outcome: str, history: bool): bool = {
    val row = rows.get(r)
    val refused = outcome == "accepted" and not(history) and row.kind != "compliance"
    val st = if (outcome == "accepted") "sent" else if (outcome == "unknown") "send_unknown" else "refused_gateway"
    all {
      row.status == "collected" or row.status == "send_unknown",
      row.turnLive,
      env.turn == "handled",
      outcome == "accepted" implies admitted.contains(r),
      outcome == "rejected" implies not(admitted.contains(r)),
      if (refused) all {
        ghost' = ghost.setBy(r, x => { ...x, receiptRefused: true }),
        rows' = rows, mirror' = mirror,
      } else all {
        rows' = rows.set(r, { ...row, status: st, sentAt: row.sentAt or outcome == "accepted" }),
        mirror' = mirror.set(r, st),
        ghost' = bump(ghost, r, st),
      },
      work' = work, env' = env, conv' = conv, views' = views, slots' = slots, admitted' = admitted, hooks' = hooks,
    }
  }

  // STOP recorded in the consent ledger (another turn, another replica).
  action stop: bool = all {
    not(env.optedOut),
    env' = { ...env, optedOut: true },
    rows' = rows, work' = work, ghost' = ghost, conv' = conv, views' = views, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
  }

  // A trust hold or pause (staff, the Network) commits on worker w's replica: w's view is fresh, others are not.
  action holdToggle(w: str): bool = all {
    work.get(w).phase == "idle",
    env' = { ...env, held: not(env.held) },
    views' = views.setBy(w, v => { ...v, held: not(env.held) }),
    rows' = rows, work' = work, ghost' = ghost, conv' = conv, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
  }
  // The opportunity the agent-initiated rows are about closes (a unit on worker w's replica).
  action closeItem(w: str): bool = all {
    not(env.closed),
    work.get(w).phase == "idle",
    env' = { ...env, closed: true },
    views' = views.setBy(w, v => { ...v, closed: true }),
    rows' = rows, work' = work, ghost' = ghost, conv' = conv, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
  }
  // A unit of work on worker w's replica loads the newest state (rt:356-363).
  action refresh(w: str): bool = all {
    work.get(w).phase == "idle",
    views' = views.set(w, { held: env.held, closed: env.closed }),
    rows' = rows, work' = work, ghost' = ghost, env' = env, conv' = conv, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
  }

  // The member is forgotten (leave, delete all): rt:521-551. Waiting rows end dropped_forgotten, text and address
  // go, the messages are deleted. No cap slot is released.
  action erase: bool = all {
    not(env.erased),
    env' = { ...env, erased: true },
    rows' = rows.keys().mapBy(r => { val x = rows.get(r)
      if (not(x.member)) x
      else { ...x, hasBody: false, status: if (WAITING.contains(x.status) or x.status == "none") (if (x.status == "none") "none" else "dropped_forgotten") else x.status } }),
    mirror' = rows.keys().mapBy(r => if (rows.get(r).member) "none" else mirror.get(r)),
    ghost' = rows.keys().mapBy(r => if (rows.get(r).member and WAITING.contains(rows.get(r).status))
      { ...ghost.get(r), maxRank: 5 } else ghost.get(r)),
    work' = work, conv' = conv, views' = views, slots' = slots, admitted' = admitted, hooks' = hooks,
  }

  // Blooio's safety state of the line (safety.* webhooks, blooio mode only: svc:1016-1018, oq:648-652).
  action setSafety(a: str): bool = all {
    env.mode == "blooio",
    env' = { ...env, lineSafety: a },
    rows' = rows, work' = work, ghost' = ghost, conv' = conv, views' = views, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
  }

  // Staff decide a parked text (oq:720-731, svc:2336-2342). Release: back to pending, the leak guard does not
  // park it again. Drop: end dropped_leak_review.
  action staffRelease(r: str): bool = {
    val row = rows.get(r)
    all {
      row.status == "parked_leak_review", row.hasBody,
      rows' = rows.set(r, { ...row, status: "pending", nextAt: env.now, leakReleased: true }),
      ghost' = ghost.setBy(r, x => { ...x, maxRank: 0 }),
      mirror' = if (row.member and not(env.erased)) mirror.set(r, "pending") else mirror,
      work' = work, env' = env, conv' = conv, views' = views, slots' = slots, admitted' = admitted, hooks' = hooks,
    }
  }
  action staffDrop(r: str): bool = {
    val row = rows.get(r)
    all {
      row.status == "parked_leak_review",
      rows' = rows.set(r, endRow(row, "dropped_leak_review", "staff")),
      slots' = releaseSlot(slots, r, row, "dropped_leak_review"),
      ghost' = bump(ghost, r, "dropped_leak_review"),
      mirror' = if (row.member and not(env.erased)) mirror.set(r, "dropped_leak_review") else mirror,
      work' = work, env' = env, conv' = conv, views' = views, admitted' = admitted, hooks' = hooks,
    }
  }

  // Blooio delivery receipts (blooio mode; applyStatus oq:612-632): one read, then one write with no guard.
  action hookRead(h: str, r: str, st: str): bool = all {
    env.mode == "blooio",
    hooks.get(h).phase == "idle",
    admitted.contains(r),
    hooks' = hooks.set(h, { phase: "read", row: r, st: st, readStatus: rows.get(r).status }),
    rows' = rows, work' = work, ghost' = ghost, env' = env, conv' = conv, views' = views, slots' = slots, admitted' = admitted, mirror' = mirror,
  }
  action hookWrite(h: str): bool = {
    val hk = hooks.get(h)
    val r = hk.row
    val row = rows.get(r)
    val final = hk.st == "delivered" or hk.st == "read"
    val failedOk = hk.st == "failed" and IN_FLIGHT.contains(hk.readStatus)
    val rankOk = hk.st != "failed" and providerRank(hk.readStatus) >= 0 and providerRank(hk.st) > providerRank(hk.readStatus)
    val st = if (failedOk) "failed" else hk.st
    all {
      hk.phase == "read",
      hooks' = hooks.set(h, { phase: "idle", row: "", st: "", readStatus: "" }),
      if (failedOk or rankOk) all {
        rows' = rows.set(r, if (failedOk) endRow(row, "failed", "receipt")
          else { ...row, status: hk.st, hasBody: if (final and not(row.member)) false else row.hasBody }),
        slots' = if (failedOk) releaseSlot(slots, r, row, "failed") else slots,
        ghost' = bump(ghost, r, st).setBy(r, x => { ...x, deliveryFailed: x.deliveryFailed or failedOk }),
        mirror' = if (row.member and not(env.erased)) mirror.set(r, st) else mirror,
      } else all { rows' = rows, slots' = slots, ghost' = ghost, mirror' = mirror },
      work' = work, env' = env, conv' = conv, views' = views, admitted' = admitted,
    }
  }

  // Time. A dispatch's read and its write, and the TTL select and its end, are milliseconds apart.
  action tick(d: int): bool = all {
    WORKERS.forall(w => work.get(w).phase != "decided" and work.get(w).phase != "ttl"),
    env' = { ...env, now: env.now + d },
    rows' = rows, work' = work, ghost' = ghost, conv' = conv, views' = views, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
  }

  // The steps of drains that are in progress (oracle answers are parameters).
  action drainSteps(w: str, r: str, b1: bool, b2: bool, b3: bool, out: str, answer: str): bool = any {
    ttlSelect(w, r),
    { nondet wt = oneOf(WORKERS.filter(x => work.get(x).phase == "ttl")) ttlEnd(wt) },
    lookupCall(w, r, answer),
    { nondet wl = oneOf(WORKERS.filter(x => work.get(x).phase == "looked")) lookupApply(wl) },
    { nondet wr = oneOf(WORKERS.filter(x => work.get(x).phase == "reconcile")) lockLine(wr) },
    { nondet wk = oneOf(WORKERS.filter(x => work.get(x).phase == "locked"))
      nondet rd = oneOf(ROWS.filter(x => DUE.contains(rows.get(x).status) and rows.get(x).nextAt <= env.now and not(work.get(wk).seen.contains(x))))
      decide(wk, rd, b1 and b3, b2) },
    { nondet wd = oneOf(WORKERS.filter(x => work.get(x).phase == "decided")) applyDecision(wd, b3 and b2) },
    { nondet wc = oneOf(WORKERS.filter(x => work.get(x).phase == "calling")) providerCall(wc, out) },
    { nondet wp = oneOf(WORKERS.filter(x => work.get(x).phase == "responded")) respond(wp, b2 and b3) },
    { nondet wu = oneOf(WORKERS.filter(x => work.get(x).phase == "locked")) unlockLine(wu) },
    { nondet wf = oneOf(WORKERS.filter(x => work.get(x).phase == "flush")) flush(wf) },
  }

  // Everything else: new rows, other actors, crashes, time.
  action worldSteps(w: str, r: str, h: str, b1: bool, b2: bool, b3: bool, kind: str, net: str,
                    outcome: str, st: str, a: str, d: int): bool = any {
    enqueue(r, kind, b1, "nyc", b2),
    { nondet wi = oneOf(WORKERS.filter(x => work.get(x).phase == "idle")) drainStart(wi, net, b3 and b1) },
    crash(w),
    project(r),
    turnStart,
    engaged,
    collect(r, if (b1) "reply" else "compliance", b2),
    turnFinish(b3),
    gatewaySend(r),
    gatewayReceipt(r, outcome, b1),
    stop,
    holdToggle(w),
    closeItem(w),
    refresh(w),
    erase,
    setSafety(a),
    staffRelease(r),
    staffDrop(r),
    hookRead(h, r, st),
    hookWrite(h),
    tick(d),
  }

  action step = {
    nondet w = oneOf(WORKERS)
    nondet r = oneOf(ROWS)
    nondet h = oneOf(HANDLERS)
    nondet b1 = oneOf(Set(true, false))
    nondet b2 = oneOf(Set(true, false))
    nondet b3 = oneOf(Set(true, false))
    nondet focus = oneOf(Set(true, false))
    nondet kind = oneOf(KINDS)
    nondet net = oneOf(if (env.twoNets) NETS else Set("nyc"))
    nondet bad = oneOf(Set("lost", "netfail", "rejected", "optout", "invalid", "await", "failedReceipt"))
    nondet answer = oneOf(Set("ok", "notfound", "ambiguous"))
    nondet outcome = oneOf(Set("accepted", "unknown", "rejected"))
    nondet st = oneOf(Set("sent", "delivered", "read", "failed"))
    nondet a = oneOf(Set("none", "review", "reply_only", "pause_new"))
    nondet d = oneOf(TICKS)
    // Weights for the random walk only (the reachable states do not change): half of the steps continue a drain
    // in progress; half of the provider calls succeed and half of the agent texts meet quiet hours; a stale-hook
    // error, a database error and a direct() drain each come in a quarter of the draws.
    val out = if (b1) "ok" else bad
    if (focus and WORKERS.exists(x => work.get(x).phase != "idle")) drainSteps(w, r, b1, b2, b3, out, answer)
    else any {
      drainSteps(w, r, b1, b2, b3, out, answer),
      worldSteps(w, r, h, b1, b2, b3, kind, net, outcome, st, a, d),
    }
  }

  // ------------------------------------------------------------------ invariants
  pure def memberGone(row: Row, erased: bool): bool = row.member and erased
  val quiescent = WORKERS.forall(w => work.get(w).phase == "idle") and HANDLERS.forall(h => hooks.get(h).phase == "idle")

  // I1 / AGENTS "Keep every safety guard ... STOP": a non-compliance row is claimed only while the person has
  // not opted out (oq:14-16 "a STOP that arrives while a message waits wins"; oq:375-376, oq:488).
  // Fails: Q-outbound_queue-1 (a direct text to a non-member: admission rechecks consent only for members, oq:470-488).
  val noClaimAfterStop = ROWS.forall(r => not(ghost.get(r).bad.contains("afterStop")))
  // I1 / oq:119 "The recipient at send time: paused, blocked, held"; oq:14 "each reads the database".
  // Fails: SD-020 (the recipient gate reads the replica's in-memory Network, ch:185-186).
  val noClaimWhileHeld = ROWS.forall(r => not(ghost.get(r).bad.contains("whileHeld")))
  // oq:15 "too old or about a closed item (expired)" and oq:111 "Every hook fails closed when it throws".
  // Fails: SD-020 (stale in-memory view, ch:180-181) and SD-299 (the stale hook fails open, oq:371).
  val noClaimWhenClosed = ROWS.forall(r => not(ghost.get(r).bad.contains("whenClosed")))
  // AGENTS "Every outbound message must go through the leak check": what the provider took passed the guard,
  // or staff released it.
  // Holds in every run.
  val leakGate = ROWS.forall(r => admitted.contains(r) implies (not(rows.get(r).leakBad) or rows.get(r).leakReleased))
    and ROWS.forall(r => not(ghost.get(r).bad.contains("leak")))
  // rt:345-347, cc:57-61, service README "More than one replica" 3: under a receipt provider an ambiguous answer is
  // resolved by receipt lookup only, never by a second send.
  // Holds in every run.
  val unknownNeverResends = ROWS.forall(r => not(ghost.get(r).bad.contains("inDoubt")))
  // oq:194 "Statuses that did not go out": a NOT_SENT row was not taken by the provider (or its delivery failed).
  // Erasure ends an in-flight row of a forgotten member without a send check; those rows are left out.
  // Fails: SD-090 (failed_unknown from created_at with no lookup, oq:584-589) and Q-outbound_queue-2 (parked_error after
  // the provider accepted, oq:507 and oq:295-299).
  val notSentMeansNotOut = ROWS.forall(r => {
    val row = rows.get(r)
    (NOT_SENT.contains(row.status) and not(memberGone(row, env.erased))) implies
      (not(admitted.contains(r)) or ghost.get(r).deliveryFailed)
  })
  // ch:46 "A message's delivery status now": a NOT_SENT message status is not stored for a text that went out.
  // Fails: SD-334 (a lost race reports dropped_forgotten, oq:569) and Q-outbound_queue-2.
  val mirrorNotSentMeansNotOut = ROWS.forall(r =>
    NOT_SENT.contains(mirror.get(r)) implies (not(admitted.contains(r)) or ghost.get(r).deliveryFailed))
  // PRD 40.3 / AGENTS item 7: at most CAP proactive texts to the person a day, counting every text the provider
  // took (sent or maybe sent). The model's runs check the first day.
  // Fails: SD-090 and Q-outbound_queue-2 (the slot of a text that went out goes back, oq:345).
  val capAtMost = env.now < DAY implies
    ROWS.filter(r => rows.get(r).kind == "proactive" and rows.get(r).member and admitted.contains(r)
      and not(ghost.get(r).deliveryFailed)).size() <= CAP
  // 0012 header: a slot is held only by a send that may still go out or went out.
  // Holds in every run.
  val slotOnlyForLiveRow = slots.forall(r => not(NOT_SENT.contains(rows.get(r).status)) or memberGone(rows.get(r), env.erased))
  // oq:31 "Statuses never go back" (a staff release of a parked text is the one exit, oq:716).
  // Fails: SD-099 (wait()/end() have no status guard, oq:350-353) and SD-300 (applyStatus read then write, oq:613-631).
  val noStatusRegress = ROWS.forall(r => rank(rows.get(r).status) >= ghost.get(r).maxRank)
  // oq:23 "Compliance texts ... skip ... the caps"; ops.ts:303 "STOP and HELP still go".
  // Fails: SD-094 (gate 7 has no compliance exemption, oq:405-410).
  val complianceAlwaysGoes = ROWS.forall(r => not(rows.get(r).kind == "compliance"
    and rows.get(r).status == "retry_scheduled" and rows.get(r).lastWait == "line_safety"))
  // oq:32 "A row to someone who is not a member keeps the address and the text only until it ends". Under Cloud no
  // receipt reaches the service (AGENTS: the gateway owns the Blooio webhook), so accepted is where the row ends.
  // Fails: SD-091 (accepted never ends under Cloud, oq:336-345, cc:54).
  val nonMemberBodyClearedAtEnd = ROWS.forall(r => {
    val row = rows.get(r)
    (not(row.member) and row.hasBody) implies
      (WAITING.contains(row.status) or row.status == "parked_leak_review" or row.status == "none"
        or (env.mode == "blooio" and IN_FLIGHT.contains(row.status)))
  })
  // rt:470-472: a collected reply that fails the guard "goes into the queue ..., where the same guard parks it for
  // staff". It must not end on the reply-window gate before the guard runs.
  // Fails: SD-101 (the unit drains before engaged, svc:2088; gate 4 at oq:383-389).
  val guardFailedReachesStaff = ROWS.forall(r => not(rows.get(r).guardFailed
    and rows.get(r).status == "suppressed_ineligible" and rows.get(r).cause == "reply_window"))
  // oq:578-579 "so nothing waits forever unseen": a collected or send_unknown reply can still get its receipt.
  // Fails: SD-100 (no sweeper for collected, oq:696-703) and SD-131 (accepted without history is refused, svc:2028-2033).
  val collectedResolvable = ROWS.forall(r => {
    val row = rows.get(r)
    (row.status == "collected" or row.status == "send_unknown") implies (row.turnLive and not(ghost.get(r).receiptRefused))
  })
  // oq:18-19 "held until the person writes": a row is not held for an answer the person already gave.
  // Fails: SD-147 (lost wakeup: conv read at oq:381, held written at oq:401 after queue.inbound released, oq:642).
  val heldOnlyWhileUnanswered = ROWS.forall(r =>
    rows.get(r).status == "held_awaiting_reply" implies ghost.get(r).heldSeq >= env.engSeq)
  // oq:18-19 "at most 3 unanswered messages per conversation, then one re-engagement" (scaled to 1). Counts every
  // non-compliance text the person got since their last message, queue or collected.
  // Fails: SD-148 (collectedReceipt does not count in line_conversations, oq:696-703).
  val unansweredAtMost = env.trueUnans <= MAX_UNANSWERED + (if (env.reengSent) 1 else 0)
  // oq:2 "One queue object serves one app"; runtime.ts:1-5: a network's checks are for its own members.
  // Fails: SD-132 (the drain selects by app and line, oq:288-289; memberOf misses, network.ts:4848).
  val ownNetworkDecides = ROWS.forall(r => not(ghost.get(r).foreign))
  // ch:46 and rt:607-617: once nobody holds unsaved changes, a settled row's message status equals the queue's,
  // or the notify projection can still repair it.
  // Fails: SD-136 (direct() drops the changes, ch:240-241), SD-336 (a crash before storeStatuses, rt:612-617), SD-334.
  val mirrorSettles = quiescent implies ROWS.forall(r => {
    val row = rows.get(r)
    val settled = not(WAITING.contains(row.status)) and row.status != "none" and row.status != "collected" and row.status != "send_unknown"
    val repairable = PROVIDER.contains(row.status) and row.sentAt and row.hasBody and not(ghost.get(r).projected)
    (row.member and not(env.erased) and settled) implies (mirror.get(r) == row.status or repairable)
  })
  // Caps and thread history count sent_at (oq:413-417, oq:457-458): sent_at only for a text the provider took.
  // Fails: SD-337 (a send receipt with status failed writes sent_at, oq:547-551).
  val sentAtOnlyIfOut = ROWS.forall(r => rows.get(r).sentAt implies admitted.contains(r))

  val safety = and {
    noClaimAfterStop, noClaimWhileHeld, noClaimWhenClosed, leakGate, unknownNeverResends,
    notSentMeansNotOut, mirrorNotSentMeansNotOut, capAtMost, slotOnlyForLiveRow, noStatusRegress,
    complianceAlwaysGoes, nonMemberBodyClearedAtEnd, guardFailedReachesStaff, collectedResolvable,
    heldOnlyWhileUnanswered, unansweredAtMost, ownNetworkDecides, mirrorSettles, sentAtOnlyIfOut,
  }

  // ------------------------------------------------------------------ run tests (concrete traces)
  // A proactive text to a member: enqueue, drain, admission, Cloud accepts (cloud-outbound.integration.test.ts).
  run proactiveHappyTest =
    initWith("cloud", true, false)
      .then(enqueue("r1", "proactive", true, "nyc", false))
      .then(drainStart("w1", "nyc", false))
      .then(lockLine("w1"))
      .then(decide("w1", "r1", false, false))
      .then(applyDecision("w1", false))
      .then(providerCall("w1", "ok"))
      .then(respond("w1", false))
      .then(unlockLine("w1"))
      .then(flush("w1"))
      .expect(rows.get("r1").status == "accepted" and mirror.get("r1") == "accepted" and slots == Set("r1") and safety)

  // A transactional text in quiet hours waits, then goes after the window (oq:390-395).
  run quietHoursTest =
    initWith("cloud", true, false)
      .then(enqueue("r1", "transactional", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(lockLine("w1"))
      .then(decide("w1", "r1", false, true)).then(applyDecision("w1", false))
      .then(unlockLine("w1")).then(flush("w1"))
      .expect(rows.get("r1").status == "deferred_quiet_hours")
      .then(tick(1))
      .then(drainStart("w1", "nyc", false)).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .then(providerCall("w1", "ok")).then(respond("w1", false))
      .then(unlockLine("w1")).then(flush("w1"))
      .expect(rows.get("r1").status == "accepted" and not(witness_deferredThenSent) and safety)

  // SD-090: a proactive row waits through quiet hours, the deliver call loses its answer, and the next drain
  // ends it failed_unknown from created_at alone, with no receipt lookup; the slot goes back and a second
  // proactive text goes out the same day (oq:584-589, oq:345).
  run sd090UnknownTtlTest =
    initWith("cloud", true, false)
      .then(enqueue("r1", "proactive", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(lockLine("w1"))
      .then(decide("w1", "r1", false, true)).then(applyDecision("w1", false))
      .then(unlockLine("w1")).then(flush("w1"))
      .then(tick(72)).then(tick(1))
      .then(drainStart("w1", "nyc", false)).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .then(providerCall("w1", "lost")).then(respond("w1", false))
      .then(unlockLine("w1")).then(flush("w1"))
      .expect(rows.get("r1").status == "unknown_acceptance" and slots == Set("r1"))
      .then(drainStart("w1", "nyc", false)).then(ttlSelect("w1", "r1")).then(ttlEnd("w1"))
      .expect(rows.get("r1").status == "failed_unknown" and slots == Set() and not(notSentMeansNotOut))
      .then(enqueue("r2", "proactive", true, "nyc", false))
      .then(lockLine("w1"))
      .then(decide("w1", "r2", false, false)).then(applyDecision("w1", false))
      .then(providerCall("w1", "ok")).then(respond("w1", false))
      .expect(rows.get("r2").status == "accepted" and not(capAtMost))

  // Q-outbound_queue-1: a direct text to a non-member passes the consent gate, a STOP commits, and the
  // admission transaction claims it without a consent check (oq:470 checks consent for member rows only).
  run q1NonMemberStopTest =
    initWith("cloud", true, false)
      .then(turnStart).then(engaged)
      .then(enqueue("r1", "reply", false, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false))
      .then(stop)
      .then(applyDecision("w1", false))
      .expect(rows.get("r1").status == "sending" and not(noClaimAfterStop))
      .then(providerCall("w1", "ok"))
      .expect(admitted.contains("r1") and env.optedOut)

  // Q-outbound_queue-2: Cloud accepts, then the accept transaction throws. The rejection escapes send()'s catch
  // (return without await, oq:507) and the drain parks the row parked_error (oq:295-299): a NOT_SENT status for a
  // text that went out, and its cap slot goes back, so a second proactive text goes out the same day.
  run q2AcceptDbErrorTest =
    initWith("cloud", true, false)
      .then(enqueue("r1", "proactive", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .then(providerCall("w1", "ok")).then(respond("w1", true))
      .then(unlockLine("w1")).then(flush("w1"))
      .expect(rows.get("r1").status == "parked_error" and admitted.contains("r1") and slots == Set()
        and not(notSentMeansNotOut) and not(mirrorNotSentMeansNotOut))
      .then(enqueue("r2", "proactive", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(lockLine("w1"))
      .then(decide("w1", "r2", false, false)).then(applyDecision("w1", false))
      .then(providerCall("w1", "ok"))
      .expect(not(capAtMost))

  // SD-020: a hold commits on replica w2; replica w1 reads its older in-memory Network and sends (ch:180-186).
  run sd020StaleReplicaTest =
    initWith("cloud", true, false)
      .then(enqueue("r1", "transactional", true, "nyc", false))
      .then(holdToggle("w2"))
      .then(drainStart("w1", "nyc", false)).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .expect(rows.get("r1").status == "sending" and not(noClaimWhileHeld))

  // SD-299: the item closed and this replica knows it, but the stale hook throws; guarded(..., false) fails open
  // (oq:371 against oq:111).
  run sd299StaleFailsOpenTest =
    initWith("cloud", true, false)
      .then(enqueue("r1", "proactive", true, "nyc", false))
      .then(closeItem("w1"))
      .then(drainStart("w1", "nyc", false)).then(lockLine("w1"))
      .then(decide("w1", "r1", true, false)).then(applyDecision("w1", false))
      .expect(rows.get("r1").status == "sending" and not(noClaimWhenClosed))

  // SD-091: a direct compliance text to a non-member is accepted by Cloud and keeps its text and address: under
  // Cloud no receipt moves accepted on (oq:32, oq:336-345).
  run sd091NonMemberBodyTest =
    initWith("cloud", true, false)
      .then(enqueue("r1", "compliance", false, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .then(providerCall("w1", "ok")).then(respond("w1", false))
      .expect(rows.get("r1").status == "accepted" and rows.get("r1").hasBody and not(nonMemberBodyClearedAtEnd))

  // SD-094: line safety "review" (a banned-number event, svc:1017) holds a STOP confirmation like any text (oq:407).
  run sd094ComplianceHeldTest =
    initWith("blooio", true, false)
      .then(setSafety("review"))
      .then(enqueue("r1", "compliance", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .expect(rows.get("r1").status == "retry_scheduled" and not(complianceAlwaysGoes))

  // SD-100: the turn throws after its unit committed a collected reply; the gateway never gets it and every receipt
  // answers turn_unavailable. The row stays collected with no sweeper.
  run sd100CollectedStuckTest =
    initWith("cloud", true, false)
      .then(turnStart).then(collect("r1", "reply", false)).then(turnFinish(false))
      .expect(rows.get("r1").status == "collected" and not(collectedResolvable))

  // SD-131: Cloud sends a collected member reply and reports history false (no Eliza account yet); the receipt is
  // refused 400 (svc:2028-2033) and the reply stays collected though it went out.
  run sd131NoHistoryReceiptTest =
    initWith("cloud", true, false)
      .then(turnStart).then(collect("r1", "reply", false)).then(turnFinish(true))
      .then(gatewaySend("r1")).then(gatewayReceipt("r1", "accepted", false))
      .expect(rows.get("r1").status == "collected" and admitted.contains("r1") and not(collectedResolvable))

  // SD-101: a reply fails the leak guard in the turn and goes to the queue; the unit's drain runs before engaged, the
  // last inbound is old, and gate 4 ends it suppressed_ineligible: staff never see it (rt:473-477, oq:383-389).
  run sd101GuardFailedReplyTest =
    initWith("cloud", true, false)
      .then(turnStart).then(collect("r1", "reply", true))
      .then(drainStart("w1", "nyc", false)).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .expect(rows.get("r1").status == "suppressed_ineligible" and not(guardFailedReachesStaff))

  // SD-147: dispatch reads unanswered at the cap; the person writes and engaged releases held rows (this row is still
  // pending); dispatch then writes held_awaiting_reply. Nothing wakes it.
  run sd147LostWakeupTest =
    initWith("blooio", true, false)
      .then(enqueue("r1", "transactional", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .then(providerCall("w1", "ok")).then(respond("w1", false))
      .then(unlockLine("w1")).then(flush("w1"))
      .then(enqueue("r2", "transactional", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(lockLine("w1"))
      .then(decide("w1", "r2", false, false))
      .then(turnStart).then(engaged)
      .then(applyDecision("w1", false))
      .expect(rows.get("r2").status == "held_awaiting_reply" and conv.unanswered == 0 and not(heldOnlyWhileUnanswered))

  // SD-148: a collected reply goes out (Cloud) and does not count in line_conversations; a proactive text then passes
  // the unanswered cap: the person has two unanswered texts against a cap of one (3+1 against 3 unscaled).
  run sd148CollectedNotCountedTest =
    initWith("cloud", true, false)
      .then(turnStart).then(engaged).then(collect("r1", "reply", false)).then(turnFinish(true))
      .then(gatewaySend("r1")).then(gatewayReceipt("r1", "accepted", true))
      .then(enqueue("r2", "proactive", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(lockLine("w1"))
      .then(decide("w1", "r2", false, false)).then(applyDecision("w1", false))
      .then(providerCall("w1", "ok"))
      .expect(env.trueUnans == 2 and not(unansweredAtMost))

  // SD-132: a second network of the app (slop:sf) drains the nyc runtime's row: memberOf misses, unknown_recipient.
  run sd132ForeignNetworkTest =
    initWith("cloud", true, true)
      .then(enqueue("r1", "transactional", true, "nyc", false))
      .then(drainStart("w2", "sf", false)).then(lockLine("w2"))
      .then(decide("w2", "r1", false, false)).then(applyDecision("w2", false))
      .expect(rows.get("r1").status == "suppressed_ineligible" and not(ownNetworkDecides))

  // SD-136: BlooioAdapter.direct drains the queue and drops the results: another member's row ends refused, and its
  // network.messages status stays queued (ch:240-241).
  run sd136DirectDropsTest =
    initWith("cloud", true, false)
      .then(enqueue("r1", "transactional", true, "nyc", false))
      .then(stop)
      .then(drainStart("w1", "nyc", true)).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .then(unlockLine("w1")).then(flush("w1"))
      .expect(rows.get("r1").status == "refused_opted_out" and mirror.get("r1") == "queued" and not(mirrorSettles))

  // SD-336: the queue commits an end, then the process stops before storeStatuses; only accepted rows are repaired.
  run sd336CrashLosesStatusTest =
    initWith("cloud", true, false)
      .then(enqueue("r1", "transactional", true, "nyc", false))
      .then(stop)
      .then(drainStart("w1", "nyc", false)).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .then(crash("w1"))
      .expect(rows.get("r1").status == "refused_opted_out" and mirror.get("r1") == "queued" and not(mirrorSettles))

  // SD-334: two replicas look up one unknown row; the first commits accepted, the second's CAS misses and reports
  // dropped_forgotten, which is stored after the projection (oq:569, rt:613-617).
  run sd334LostRaceTest =
    initWith("cloud", true, false)
      .then(enqueue("r1", "transactional", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .then(providerCall("w1", "lost")).then(respond("w1", false))
      .then(unlockLine("w1")).then(flush("w1"))
      .then(drainStart("w1", "nyc", false)).then(drainStart("w2", "nyc", false))
      .then(lookupCall("w1", "r1", "ok")).then(lookupCall("w2", "r1", "ok"))
      .then(lookupApply("w1")).then(lookupApply("w2"))
      .then(lockLine("w1")).then(unlockLine("w1")).then(flush("w1"))
      .then(project("r1"))
      .then(lockLine("w2")).then(unlockLine("w2")).then(flush("w2"))
      .expect(rows.get("r1").status == "accepted" and mirror.get("r1") == "dropped_forgotten"
        and not(mirrorNotSentMeansNotOut) and not(mirrorSettles))

  // SD-300: two Blooio receipts for one message read "accepted"; delivered writes first, then sent writes over it.
  run sd300ReceiptRegressTest =
    initWith("blooio", true, false)
      .then(enqueue("r1", "transactional", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .then(providerCall("w1", "ok")).then(respond("w1", false))
      .then(hookRead("h1", "r1", "delivered")).then(hookRead("h2", "r1", "sent"))
      .then(hookWrite("h1")).then(hookWrite("h2"))
      .expect(rows.get("r1").status == "sent" and not(noStatusRegress))

  // SD-337: Blooio answers the send with status failed: sent_at is written, then the row ends failed (oq:547-570).
  run sd337FailedSetsSentAtTest =
    initWith("blooio", true, false)
      .then(enqueue("r1", "transactional", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .then(providerCall("w1", "failedReceipt")).then(respond("w1", false))
      .expect(rows.get("r1").status == "failed" and rows.get("r1").sentAt and not(sentAtOnlyIfOut))

  // SD-099: erasure ends a row between dispatch's read and its wait(); wait() has no status guard and the row is due again.
  run sd099WaitOverErasureTest =
    initWith("cloud", true, false)
      .then(enqueue("r1", "transactional", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(lockLine("w1"))
      .then(decide("w1", "r1", false, true))
      .then(erase)
      .then(applyDecision("w1", false))
      .expect(rows.get("r1").status == "deferred_quiet_hours" and not(noStatusRegress))

  // SD-117: the admission transaction throws once (a deadlock or a reset connection); the drain parks the reply for good.
  run sd117TransientParksTest =
    initWith("cloud", true, false)
      .then(turnStart).then(engaged)
      .then(enqueue("r1", "reply", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", true))
      .expect(rows.get("r1").status == "parked_error" and safety)

  // ------------------------------------------------------------------ witnesses (each must be violated)
  val witness_proactiveAccepted = not(ROWS.exists(r => rows.get(r).kind == "proactive" and rows.get(r).status == "accepted"))
  val witness_deferredThenSent = not(ROWS.exists(r => ghost.get(r).wasDeferred and rows.get(r).status == "accepted"))
  val witness_parkedReleased = not(ROWS.exists(r => ghost.get(r).wasParked and rows.get(r).leakReleased))
  val witness_collectedSent = not(ROWS.exists(r => rows.get(r).status == "sent" and rows.get(r).sentAt))
  val witness_stopRefuses = not(ROWS.exists(r => rows.get(r).status == "refused_opted_out"))
  val witness_unknownLookedUp = not(ROWS.exists(r => rows.get(r).status == "accepted" and rows.get(r).doubt))
}
