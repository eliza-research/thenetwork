# Outbound queue and delivery receipts

## Story: Outbound queue and delivery receipts

A member needs their current consent and safety status checked before a message is sent.

### Safety rules and reachability

Check queue claims, caps, leak checks, receipt reconciliation, and uncertain delivery outcomes. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

The [participation budgets](../participationBudgets.md) supply the engine and Network's default state and lane caps. This queue model starts after the attention controller has applied those caps and models its own person-level and provider limits.

Production uses the generated [provider receipt lifecycle](../outboundReceipt.md) to decide retry, receipt recovery and status updates.

Imported from `quint/outbound_queue.qnt` at `30d950e`. See [model index](README.md) for scope and commands.

```quint
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
//  - Workers are replicas (or one replica's runtimes). A drain is: recover (oq:277), reconcileUnknown
//    (oq:676, no line lock), then the line lock (oq:260) and one dispatch per due row. One dispatch is two
//    steps: `decide` reads every gate at once (gates 0-10: oq:426-482 reads the facts, gate.ts preCapGate/finalGate decide) and takes the cap slot; `applyDecision`
//    writes the wait or end, or runs the admission transaction (oq:527-563). Time does not advance between
//    the two steps (they are milliseconds apart in the code).
//  - The leak guard, the quiet-hours clock, the stale hook's errors, Cloud and the gateway are oracles:
//    the actions take their answers as parameters and `step` chooses them nondeterministically.
//  - The recipient policy and the stale hook read the runtime's in-memory Network (ch:185-191). Each worker
//    has its own view and the version of the stored state it last loaded or saved (PgStore.seen, the row's
//    xmin); `refresh` copies the database into it (a unit of work on that replica). A runtime drain starts only
//    when its view is current (rt drainQueue, stateCurrent), and the admission transaction leaves a row as it is
//    when the stored version is newer than the view (lockAdmission, SD-020 fix 6cc9d1b).
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

  // Statuses (oq:191-198).
  pure val WAITING = Set("pending", "retry_scheduled", "deferred_quiet_hours", "held_awaiting_reply", "sending", "unknown_acceptance")
  pure val DUE = Set("pending", "retry_scheduled", "deferred_quiet_hours")
  pure val IN_FLIGHT = Set("accepted", "sent")
  // NOT_SENT = /^(refused|suppressed|blocked|parked|failed(?!_unknown)|expired|dropped)/ (oq NOT_SENT), over the
  // statuses that occur. failed_unknown may have gone out: it keeps its person-cap slot (SD-090 fix a8e4b55).
  pure val NOT_SENT = Set("refused_not_approved", "refused_opted_out", "refused_person_cap", "refused_gateway",
    "suppressed_ineligible", "blocked", "parked_leak_review", "parked_error", "failed",
    "expired", "dropped_forgotten", "dropped_leak_review")
  // network.messages statuses that still wait (ch WAITING_STATUSES = ["queued", ...WAITING]).
  pure val WAITING_MSG = WAITING.union(Set("queued"))
  pure val PROVIDER = Set("accepted", "sent", "delivered", "read")

  pure def rank(st: str): int =
    if (st == "accepted") 1 else if (st == "sent") 2 else if (st == "delivered") 3 else if (st == "read") 4
    else if (WAITING.contains(st) or st == "none" or st == "collected" or st == "send_unknown") 0 else 5
  // PROVIDER_RANK (oq:196): rows that did not go out have none.
  pure def providerRank(st: str): int =
    if (st == "accepted") 1 else if (st == "sent") 2 else if (st == "delivered") 3 else if (st == "read") 4 else -1

  pure def isAgent(kind: str): bool = kind != "reply" and kind != "compliance"   // gate.ts:14-17 isAgentInitiated

  // ------------------------------------------------------------------ types
  type Row = {
    status: str, kind: str, member: bool, net: str, created: int, attempts: int,
    lease: bool, leaseUntil: int, nextAt: int, personCap: bool, hasBody: bool,
    leakBad: bool,        // what the leak guard says about this text (oracle, fixed per text)
    leakReleased: bool,   // leak_released_by (migration 0032)
    guardFailed: bool,    // a collected reply that failed the leak guard and went to the queue (rt:538-543)
    sentAt: bool, cause: str, turnLive: bool, lastWait: str,
    doubt: bool,          // in_doubt under a receipt provider: no definite answer since the last provider call
    acctFree: bool        // a collected reply of a turn the service gave no Cloud account (accountEligible false)
  }
  type Work = {
    phase: str,           // idle, reconcile, ttl, looked, locked, decided, calling, responded, flush
    row: str, dec: str, readStatus: str, readSeq: int, isNew: bool, reeng: bool, resp: str,
    direct: bool,         // BlooioAdapter.direct: no stateCurrent check before it and no status repair after it
    net: str, seen: Set[str], pend: List[(str, str)],
    swept: bool           // reconcileUnknown has ended the collected replies past the TTL (SD-100 fix b6ea5e1)
  }
  type Ghost = {
    maxRank: int, bad: Set[str], foreign: bool, receiptRefused: bool, projected: bool,
    heldSeq: int, deliveryFailed: bool, wasDeferred: bool, wasParked: bool,
    lost: bool,           // a crash discarded this row's status change before storeStatuses; no runtime drain since
    resent: bool          // recover() put the row back to retry_scheduled (no receipt provider): the queue cannot know
                          // whether the provider took the earlier call (in_doubt = true)
  }
  type Conv = { exists: bool, unanswered: int, reUsed: bool, lastIn: int, lastOut: int }
  type Env = {
    now: int, mode: str, live: bool, held: bool, closed: bool, erased: bool,
    ledger: List[Consent], // platform.consent_events of the recipient's number, oldest first (svc consentRefused reads it)
    lineSafety: str, lineHolder: str, inSeq: int, turn: str, engagePending: bool,
    trueUnans: int, reengSent: bool, crashes: int,
    twoNets: bool,        // a second network of the app (slop:sf next to slop:nyc) has its own runtime and queue
    engSeq: int,          // how many times queue.inbound (engaged) ran: it releases the held rows. It stands for the
                          // conversation's last_inbound_at: two inbound messages have different times (ms clock).
    ver: int,             // the version of the stored Network state (network.network_state xmin)
    turnAcct: bool,       // the open turn is account-eligible (svc accountEligible)
    lastSweep: int        // the time of the last sweep of collected replies
  }
  type Hook = { phase: str, row: str, st: str, readStatus: str }
  // One row of platform.consent_events for the recipient's number. scope: "all" (app null: STOP, START on the
  // shared line), "app" (this queue's app: leave, START on its line, a new join) or "other" (another app on the line).
  // The list order is the order of `at` (the turn_consent model covers how `at` is chosen, fix 3e472ee).
  type Consent = { scope: str, state: str }
  type View = { held: bool, closed: bool, ver: int }

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
    sentAt: false, cause: "", turnLive: false, lastWait: "", doubt: false, acctFree: false
  }
  pure val IDLE: Work = { phase: "idle", row: "", dec: "", readStatus: "", readSeq: 0, isNew: false, reeng: false,
    resp: "", direct: false, net: "nyc", seen: Set(), pend: List(), swept: false }
  pure val NO_GHOST: Ghost = { maxRank: 0, bad: Set(), foreign: false, receiptRefused: false, projected: false,
    heldSeq: 0, deliveryFailed: false, wasDeferred: false, wasParked: false, lost: false, resent: false }

  // ------------------------------------------------------------------ helpers on rows
  // end() (oq:374-388) as the gates call it: no status guard (the send error paths pass `from`, see respond); a non-member row loses its text and address unless parked for leak review.
  pure def endRow(row: Row, st: str, cause: str): Row =
    { ...row, status: st, lease: false, cause: cause,
      hasBody: if (not(row.member) and st != "parked_leak_review") false else row.hasBody }
  // wait() (oq:390-396) as the gates call it: no status guard.
  pure def waitRow(row: Row, st: str, at: int, why: str): Row =
    { ...row, status: st, nextAt: at, lease: false, lastWait: why }
  // The cap slot goes back when the end status is NOT_SENT (oq:387).
  pure def releaseSlot(s: Set[str], r: str, row: Row, st: str): Set[str] =
    if (row.personCap and NOT_SENT.contains(st)) s.exclude(Set(r)) else s
  pure def bump(g: str -> Ghost, r: str, st: str): str -> Ghost =
    g.setBy(r, x => { ...x, maxRank: if (rank(st) > x.maxRank) rank(st) else x.maxRank })
  pure def push(w: Work, r: str, member: bool, st: str): List[(str, str)] =
    if (member) w.pend.append((r, st)) else w.pend

  // acceptReceipt's commit (oq:620-659): only a row still sending or unknown_acceptance with its text.
  pure def acceptOk(row: Row): bool = (row.status == "sending" or row.status == "unknown_acceptance") and row.hasBody
  // The accept commit. A receipt owner (Cloud) sends no delivery receipts: a row to a non-member ends at acceptance
  // and keeps no address and no text (SD-091 fix 0a787a8).
  pure def acceptedRow(row: Row, mode: str): Row =
    { ...row, status: "accepted", sentAt: true, lease: false, hasBody: if (mode == "cloud" and not(row.member)) false else row.hasBody }
  pure def convAfterAccept(c: Conv, row: Row, reeng: bool, now: int): Conv =
    { exists: true,
      unanswered: if (c.exists and c.lastIn > now) c.unanswered else c.unanswered + (if (row.kind == "compliance") 0 else 1),
      reUsed: c.reUsed or reeng,
      lastIn: c.lastIn,
      lastOut: if (c.exists and c.lastOut > now) c.lastOut else now }

  // ------------------------------------------------------------------ consent (the code and the rule)
  pure val MAX_CONSENT = 3
  // platform/src/consent.ts lastEvents: the last event of one scope ("ties go to the later entry"); index -1: none.
  pure def lastOf(ledger: List[Consent], scope: str): int =
    ledger.indices().fold(-1, (acc, i) => if (ledger[i].scope == scope and i > acc) i else acc)
  // The code's input and guard: svc consentRefused = resolveConsent(lastConsent(e164, app)) == "opted_out"
  // (platform/src/consent.ts:39-45), as the queue's optedOut hook calls it (rt optedOut, oq:437 and oq:552).
  pure def codeOptedOut(ledger: List[Consent]): bool =
    val a = lastOf(ledger, "app")
    val g = lastOf(ledger, "all")
    if (a < 0) g >= 0 and ledger[g].state == "opted_out"
    else if (g < 0 or ledger[g].state == "opted_in") ledger[a].state == "opted_out"
    else not(ledger[a].state == "opted_in" and a > g)
  // The rule, written over the whole ledger and not from the guard (AGENTS platform decision 7 and PRD 40.3: STOP
  // stops every app, "leave <app>" stops that app; START opts in again): the person is stopped for this app when an
  // opt-out that covers it (scope all or app) has no later opt-in that answers it. An opt-in for this app answers
  // every earlier opt-out that covers the app (START on its line, a new join); a STOP-wide opt-in answers only
  // STOP-wide opt-outs (a global START does not undo a leave of this app). Another app's events cover nothing here.
  pure def stoppedByRule(ledger: List[Consent]): bool =
    ledger.indices().exists(i => and {
      ledger[i].state == "opted_out", ledger[i].scope != "other",
      not(ledger.indices().exists(j => and {
        j > i, ledger[j].state == "opted_in",
        ledger[j].scope == "app" or (ledger[j].scope == "all" and ledger[i].scope == "all"),
      })),
    })

  // ------------------------------------------------------------------ init
  action initWith(mode: str, live: bool, twoNets: bool): bool = all {
    rows' = ROWS.mapBy(_ => NO_ROW),
    work' = WORKERS.mapBy(_ => IDLE),
    ghost' = ROWS.mapBy(_ => NO_GHOST),
    env' = { now: 0, mode: mode, live: live, ledger: List(), held: false, closed: false, erased: false,
      lineSafety: "none", lineHolder: "", inSeq: 0, turn: "none", engagePending: false, trueUnans: 0,
      reengSent: false, crashes: 0, twoNets: twoNets, engSeq: 0, ver: 0, turnAcct: true, lastSweep: 0 },
    conv' = { exists: false, unanswered: 0, reUsed: false, lastIn: -1, lastOut: -1 },
    views' = WORKERS.mapBy(_ => { held: false, closed: false, ver: 0 }),
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
  // oq:226-256 via ch:219-240, rt:638-640. A refused enqueue (live flags off, ch:221-225) writes no row.
  // network.messages gets "queued" for a member row (rt:548-556).
  action enqueue(r: str, kind: str, member: bool, net: str, leakBad: bool): bool = all {
    rows.get(r).status == "none",
    env.live,
    not(member) implies kind != "proactive",          // a direct text is never proactive (ch:88 DirectKind)
    member implies not(env.erased),
    rows' = rows.set(r, { ...NO_ROW, status: "pending", kind: kind, member: member, net: net, created: env.now,
      nextAt: env.now, hasBody: true, leakBad: leakBad }),
    mirror' = mirror.set(r, if (member) "queued" else "none"),
    work' = work, ghost' = ghost, env' = env, conv' = conv, views' = views, slots' = slots, admitted' = admitted, hooks' = hooks,
  }

  // ------------------------------------------------------------------ drain: recover and reconcileUnknown (no line lock)
  // drain() (oq:287-336): recover() first. A sending row whose lease ran out goes to unknown_acceptance under a
  // receipt provider (Cloud), else to retry_scheduled (oq:277-285). The runtime's drainQueue starts only when the
  // stored Network state is the one this replica loaded (stateCurrent, SD-020 fix); direct() drains at once.
  action drainStart(w: str, net: str, direct: bool): bool = {
    val recovered = ROWS.filter(r => rows.get(r).status == "sending" and rows.get(r).leaseUntil < env.now)
    val target = if (env.mode == "cloud") "unknown_acceptance" else "retry_scheduled"
    all {
      work.get(w).phase == "idle",
      direct or views.get(w).ver == env.ver,
      rows' = rows.keys().mapBy(r => if (recovered.contains(r))
        { ...rows.get(r), status: target, lease: false, nextAt: env.now, doubt: env.mode == "cloud" } else rows.get(r)),
      work' = work.set(w, { ...IDLE, phase: "reconcile", net: net, direct: direct }),
      ghost' = ghost.keys().mapBy(r => if (recovered.contains(r) and env.mode == "blooio") { ...ghost.get(r), resent: true } else ghost.get(r)),
      env' = env, conv' = conv, views' = views, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
    }
  }

  // reconcileUnknown, part 1: rows still unknown 6 h after their acceptance became unknown (next_attempt_at, set by
  // wait() and recover(), left by a lookup; SD-090 fix a8e4b55) are selected...
  action ttlSelect(w: str, r: str): bool = all {
    work.get(w).phase == "reconcile",
    not(work.get(w).swept),
    rows.get(r).status == "unknown_acceptance",
    rows.get(r).nextAt < env.now - UNKNOWN_TTL,
    work' = work.setBy(w, x => { ...x, phase: "ttl", row: r }),
    rows' = rows, ghost' = ghost, env' = env, conv' = conv, views' = views, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
  }
  // ...then each one ends failed_unknown with end() (no status guard). failed_unknown keeps its cap slot.
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

  // reconcileUnknown, part 2 (SD-100 fix b6ea5e1, every transport): one update ends every collected or send_unknown
  // reply created more than the TTL ago failed_unknown (the gateway may have sent it).
  action sweepCollected(w: str): bool = {
    val wk = work.get(w)
    val expired = ROWS.filter(r => (rows.get(r).status == "collected" or rows.get(r).status == "send_unknown")
      and rows.get(r).created < env.now - UNKNOWN_TTL)
    all {
      wk.phase == "reconcile",
      not(wk.swept),
      rows' = rows.keys().mapBy(r => if (expired.contains(r)) { ...rows.get(r), status: "failed_unknown" } else rows.get(r)),
      ghost' = rows.keys().mapBy(r => if (expired.contains(r)) bump(ghost, r, "failed_unknown").get(r) else ghost.get(r)),
      work' = work.set(w, { ...wk, swept: true,
        pend: ROWS.fold(wk.pend, (l, r) => if (expired.contains(r) and rows.get(r).member) l.append((r, "failed_unknown")) else l) }),
      env' = { ...env, lastSweep: env.now },
      conv' = conv, views' = views, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
    }
  }

  // reconcileUnknown, part 3 (Cloud only): a receipt lookup, never a send (cc:57-61).
  // The answer: "ok" only when Cloud admitted the id; "notfound" only when it did not; "ambiguous" always possible.
  action lookupCall(w: str, r: str, answer: str): bool = all {
    env.mode == "cloud",
    work.get(w).phase == "reconcile",
    work.get(w).swept,
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
      // acceptReceipt: commit when the row is still unknown; otherwise report the stored status (SD-334 fix 255a42d).
      val ok = acceptOk(row)
      val st = if (ok) "accepted" else row.status
      all {
        wk.phase == "looked",
        rows' = if (ok) rows.set(r, acceptedRow(row, env.mode)) else rows,
        conv' = if (ok) convAfterAccept(conv, row, false, env.now) else conv,
        ghost' = if (ok) bump(ghost, r, "accepted") else ghost,
        work' = work.set(w, { ...wk, phase: "reconcile", pend: push(wk, r, row.member, st) }),
        env' = env, views' = views, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
      }
    } else if (wk.resp == "notfound") {
      // Never admitted: back to the queue with the same key, guarded on unknown_acceptance (oq:702-706).
      val moved = row.status == "unknown_acceptance"
      all {
        wk.phase == "looked",
        rows' = if (moved) rows.set(r, { ...row, status: "retry_scheduled", nextAt: env.now, doubt: false }) else rows,
        work' = work.set(w, { ...wk, phase: "reconcile", pend: if (moved) push(wk, r, row.member, "retry_scheduled") else push(wk, r, row.member, "unknown_acceptance") }),
        ghost' = ghost, conv' = conv, env' = env, views' = views, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
      }
    } else all {
      // Ambiguous: the row stays held; its status is mirrored (oq:708-709).
      wk.phase == "looked",
      work' = work.set(w, { ...wk, phase: "reconcile", pend: push(wk, r, row.member, "unknown_acceptance") }),
      rows' = rows, ghost' = ghost, conv' = conv, env' = env, views' = views, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
    }
  }

  // ------------------------------------------------------------------ drain: the line lock and dispatch
  // tooOld (oq:365-368): older than the TTL, or a proactive row older than its own TTL.
  pure def tooOldAt(row: Row, now: int): bool =
    now - row.created > TTL_ANY or (row.kind == "proactive" and now - row.created > TTL_PROACTIVE)

  // The line lock (oq:260-273), then expireHeld (oq:353-363): a held row past its time ends expired with end()
  // (no status guard), since it is not due and dispatch never reads it.
  action lockLine(w: str): bool = {
    val wk = work.get(w)
    val old = ROWS.filter(r => rows.get(r).status == "held_awaiting_reply" and tooOldAt(rows.get(r), env.now))
    all {
      wk.phase == "reconcile",
      wk.swept,
      env.lineHolder == "",
      rows' = rows.keys().mapBy(r => if (old.contains(r)) endRow(rows.get(r), "expired", "held") else rows.get(r)),
      slots' = slots.filter(r => not(old.contains(r) and rows.get(r).personCap)),
      ghost' = rows.keys().mapBy(r => if (old.contains(r)) bump(ghost, r, "expired").get(r) else ghost.get(r)),
      work' = work.set(w, { ...wk, phase: "locked", seen: Set(),
        pend: ROWS.fold(wk.pend, (l, r) => if (old.contains(r) and rows.get(r).member) l.append((r, "expired")) else l) }),
      env' = { ...env, lineHolder: w },
      conv' = conv, views' = views, admitted' = admitted, mirror' = mirror, hooks' = hooks,
    }
  }

  // dispatch gates 0-10, read at one instant. The cap slot is taken here (gate 9, its own transaction,
  // 0007:168-189). Oracles: staleErr (the stale hook throws: the error goes to drain()'s catch, SD-299 fix 8495b7a),
  // quiet (quiet hours in the recipient's zone). The drain selects only the rows of its own network (SD-132 fix 5a6cf8e).
  action decide(w: str, r: str, staleErr: bool, quiet: bool): bool = {
    val wk = work.get(w)
    val row = rows.get(r)
    val view = views.get(w)
    val agent = isAgent(row.kind)
    val compliance = row.kind == "compliance"
    val age = env.now - row.created
    val tooOld = age > TTL_ANY or (row.kind == "proactive" and age > TTL_PROACTIVE)
    // stale (ch:185-187): an item row whose opportunity the worker's in-memory Network has as closed.
    val hasItem = row.member and agent
    val stale = hasItem and view.closed
    // recipient (ch:190-191): a non-member direct text passes; a member row asks the in-memory policy.
    // A row of another network of the app: memberOf misses, unknown_recipient (network.ts:4848).
    val recipientOk = if (not(row.member)) true else not(agent and view.held)
    val replyLate = row.kind == "reply" and (conv.lastIn < 0 or env.now - conv.lastIn > REPLY_WINDOW)
    val capped = not(compliance) and conv.exists and conv.unanswered >= MAX_UNANSWERED
    val reengOk = agent and not(conv.reUsed) and env.now - conv.lastOut >= REENGAGE
    val isNew = not(conv.exists)
    // Gate 7: compliance texts (STOP, HELP) skip the line safety state (SD-094 fix 9e763d7).
    val safetyHold = not(compliance) and (env.lineSafety == "review" or (env.lineSafety == "reply_only" and (agent or isNew))
      or (env.lineSafety == "pause_new" and isNew))
    val capNeeded = row.kind == "proactive" and row.member
    val capOk = slots.contains(r) or slots.size() < CAP
    val dec =
      if (tooOld) "expired"
      else if (hasItem and staleErr) "dispatch_error"
      else if (stale) "expired"
      else if (not(env.live)) "refused_not_approved"
      else if (not(compliance) and codeOptedOut(env.ledger)) "refused_opted_out"
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
      row.net == wk.net,
      DUE.contains(row.status),
      row.nextAt <= env.now,
      work' = work.set(w, { ...wk, phase: "decided", row: r, dec: dec, readStatus: row.status, readSeq: env.engSeq,
        isNew: isNew, reeng: capped and reengOk, seen: wk.seen.union(Set(r)) }),
      rows' = if (takes) rows.set(r, { ...row, personCap: true }) else rows,
      slots' = if (takes) slots.union(Set(r)) else slots,
      ghost' = if (row.net != wk.net) ghost.setBy(r, x => { ...x, foreign: true }) else ghost,
      env' = env, conv' = conv, views' = views, admitted' = admitted, mirror' = mirror, hooks' = hooks,
    }
  }

  // The worker's row ends (end(), oq:374-388) or waits (wait(), oq:390-396); the change joins the drain's list.
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
  // hold() (SD-147 fix dde38c4): the row waits for the person, unless the person wrote after dispatch read the
  // conversation (inbound() may have run before this write and found nothing to release): then it is due at once.
  action holdAct(w: str, why: str, doubt: bool, seq: int): bool =
    if (env.engSeq != seq) waitAct(w, "pending", env.now, why, doubt, seq)
    else waitAct(w, "held_awaiting_reply", env.now, why, doubt, seq)
  // drain()'s catch (SD-117 fix 2d901dd, SD-299 fix 8495b7a): attempts + 1; the row waits with a backoff, and is
  // parked for a person only when the attempts are used up. Every write is guarded on the status that dispatch read
  // or a status the send owns (oq drain: from = [row.status, ...OWNED], fix 8ca695b): a row that left them while the
  // dispatch ran (erasure, a receipt lookup) is not written, and the drain records no change for it.
  action dispatchErr(w: str): bool = {
    val wk = work.get(w)
    val r = wk.row
    val row = rows.get(r)
    val tries = row.attempts + 1
    val row1 = { ...row, attempts: tries }
    val guardOk = row.status == wk.readStatus or row.status == "sending" or row.status == "unknown_acceptance"
    all {
      if (not(guardOk)) all {
        work' = work.set(w, { ...wk, phase: "locked" }),
        rows' = rows, slots' = slots, ghost' = ghost,
      } else if (tries >= MAX_ATTEMPTS) all {
        rows' = rows.set(r, endRow(row1, "parked_error", "dispatch_error")),
        slots' = releaseSlot(slots, r, row, "parked_error"),
        ghost' = bump(ghost, r, "parked_error"),
        work' = work.set(w, { ...wk, phase: "locked", pend: push(wk, r, row.member, "parked_error") }),
      } else all {
        rows' = rows.set(r, { ...waitRow(row1, "retry_scheduled", env.now + 1, "dispatch_error"), doubt: row.doubt }),
        slots' = slots,
        ghost' = bump(ghost, r, "retry_scheduled"),
        work' = work.set(w, { ...wk, phase: "locked", pend: push(wk, r, row.member, "retry_scheduled") }),
      },
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

  // The write of the decision. A wait or an end (no status guard), or the admission transaction.
  // dbErr: the admission transaction throws (deadlock, reset): drain()'s catch lets the row wait (SD-117 fix).
  action applyDecision(w: str, dbErr: bool): bool = {
    val wk = work.get(w)
    val r = wk.row
    val row = rows.get(r)
    val compliance = row.kind == "compliance"
    val agent = isAgent(row.kind)
    // Admission: the state fence (lockAdmission: the stored Network state is the one this worker read, SD-020 fix),
    // the member and its binding, the consent ledger for every non-compliance row (Q-outbound_queue-1 fix 1f86525),
    // then the CAS claim.
    val adm =
      if (dbErr) "dispatch_error"
      else if (views.get(w).ver != env.ver) "stale_view"
      else if (row.member and env.erased) "dropped_forgotten"
      else if (not(compliance) and codeOptedOut(env.ledger)) "refused_opted_out"
      else if (row.status == wk.readStatus and not(row.lease) and row.hasBody) "admitted"
      else if (row.status != wk.readStatus or row.lease) "busy"
      else "dropped_forgotten"
    // Ghost: what the claim admitted against the database at this instant. "afterStop" is the rule over the
    // ledger (stoppedByRule), not the guard above (codeOptedOut).
    val bad = Set(
      if (not(compliance) and stoppedByRule(env.ledger)) "afterStop" else "",
      if (row.member and agent and env.held) "whileHeld" else "",
      if (row.member and agent and env.closed) "whenClosed" else "",
      if (row.doubt) "inDoubt" else "",
      if (row.leakBad and not(row.leakReleased)) "leak" else "").exclude(Set(""))
    all {
      wk.phase == "decided",
      if (wk.dec == "dispatch_error") dispatchErr(w)
      else if (wk.dec == "expired") endAct(w, "expired", "")
      else if (wk.dec == "refused_not_approved") endAct(w, "refused_not_approved", "")
      else if (wk.dec == "refused_opted_out") endAct(w, "refused_opted_out", "")
      else if (wk.dec == "suppressed_recipient") endAct(w, "suppressed_ineligible", "recipient")
      else if (wk.dec == "suppressed_reply") endAct(w, "suppressed_ineligible", "reply_window")
      else if (wk.dec == "deferred") waitAct(w, "deferred_quiet_hours", env.now + QUIET_DEFER, "quiet", row.doubt, wk.readSeq)
      else if (wk.dec == "held") holdAct(w, "unanswered", row.doubt, wk.readSeq)
      else if (wk.dec == "safety_wait") waitAct(w, "retry_scheduled", env.now + 12, "line_safety", row.doubt, wk.readSeq)
      else if (wk.dec == "refused_person_cap") endAct(w, "refused_person_cap", "")
      else if (wk.dec == "parked_leak_review") endAct(w, "parked_leak_review", "leak")
      else if (adm == "dispatch_error") dispatchErr(w)
      else if (adm == "stale_view") all {
        // The row is left as it is for a later drain (send() returns no change).
        work' = work.set(w, { ...wk, phase: "locked" }),
        rows' = rows, ghost' = ghost, slots' = slots, conv' = conv, env' = env, views' = views, admitted' = admitted, mirror' = mirror, hooks' = hooks,
      }
      else if (adm == "admitted") all {
        rows' = rows.set(r, { ...row, status: "sending", attempts: row.attempts + 1, lease: true, leaseUntil: env.now + LEASE }),
        ghost' = bump(ghost, r, "sending").setBy(r, x => { ...x, bad: x.bad.union(bad) }),
        work' = work.set(w, { ...wk, phase: "calling" }),
        slots' = slots, conv' = conv, env' = env, views' = views, admitted' = admitted, mirror' = mirror, hooks' = hooks,
      }
      else if (adm == "busy") all {
        // Another worker claimed or ended it: report its status, write nothing (oq:558-561).
        work' = work.set(w, { ...wk, phase: "locked", pend: push(wk, r, row.member, row.status) }),
        rows' = rows, ghost' = ghost, slots' = slots, conv' = conv, env' = env, views' = views, admitted' = admitted, mirror' = mirror, hooks' = hooks,
      }
      else endAct(w, adm, "admission")
    }
  }

  // The provider call (oq:583; Cloud: cc:25-68). Cloud is idempotent on the id: an admitted id is replayed.
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

  // The answer is written. dbErr: the accept transaction throws. send() now awaits acceptReceipt and maps the error
  // to failure "unknown" (Q-outbound_queue-2 fix 1e3585b): the row waits as unknown_acceptance and keeps its cap slot;
  // the receipt lookup (or the TTL) resolves it.
  // Every write after a failed call is guarded on the statuses the send owns (oq send: OWNED = sending,
  // unknown_acceptance; fix 8ca695b): while the call ran, recover() and a receipt lookup may have recorded the
  // acceptance, or erasure ended the row. Such a row keeps its recorded outcome, and the drain records no change.
  action respond(w: str, dbErr: bool): bool = {
    val wk = work.get(w)
    val r = wk.row
    val row = rows.get(r)
    val retryable = wk.resp == "rejected"
    val owned = row.status == "sending" or row.status == "unknown_acceptance"
    val failure = (wk.resp == "ok" and dbErr) or (wk.resp != "ok" and wk.resp != "failedReceipt")
    all {
      wk.phase == "responded",
      wk.resp == "ok" or not(dbErr),
      if (failure and not(owned)) all {
        work' = work.set(w, { ...wk, phase: "locked" }),
        rows' = rows, ghost' = ghost, slots' = slots, conv' = conv, env' = env, views' = views, admitted' = admitted, mirror' = mirror, hooks' = hooks,
      }
      else if (wk.resp == "ok" and dbErr) waitAct(w, "unknown_acceptance", env.now, "unknown", env.mode == "cloud", wk.readSeq)
      else if (retryable) {
        if (row.attempts >= MAX_ATTEMPTS) endAct(w, "failed", "provider") else waitAct(w, "retry_scheduled", env.now + 1, "retry", false, env.engSeq)
      }
      else if (wk.resp == "ok") {
        val ok = acceptOk(row)
        all {
          rows' = if (ok) rows.set(r, acceptedRow(row, env.mode)) else rows,
          conv' = if (ok) convAfterAccept(conv, row, wk.reeng, env.now) else conv,
          ghost' = if (ok) bump(ghost, r, "accepted") else ghost,
          work' = work.set(w, { ...wk, phase: "locked", pend: push(wk, r, row.member, if (ok) "accepted" else row.status) }),
          slots' = slots, env' = env, views' = views, admitted' = admitted, mirror' = mirror, hooks' = hooks,
        }
      }
      else if (wk.resp == "failedReceipt") {
        // The receipt carries status failed: the commit writes no sent_at (SD-337 fix aba939e), then end(failed).
        val ok = acceptOk(row)
        all {
          rows' = if (ok) rows.set(r, endRow(row, "failed", "provider")) else rows,
          slots' = if (ok) releaseSlot(slots, r, row, "failed") else slots,
          ghost' = if (ok) bump(ghost, r, "failed") else ghost,
          work' = work.set(w, { ...wk, phase: "locked", pend: push(wk, r, row.member, if (ok) "failed" else row.status) }),
          conv' = conv, env' = env, views' = views, admitted' = admitted, mirror' = mirror, hooks' = hooks,
        }
      }
      else if (wk.resp == "lost" or wk.resp == "netfail")
        waitAct(w, "unknown_acceptance", env.now, "unknown", env.mode == "cloud", env.engSeq)
      else if (wk.resp == "await") holdAct(w, "await_recipient", false, wk.readSeq)
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

  // storeStatuses: the changes of member rows go to network.messages in order. A message of a forgotten member was
  // deleted: nothing to update. direct() stores them too (SD-136 fix eb5a589). After a runtime drain, a message that
  // still shows a waiting status takes the status of its queue row once that row left the waiting statuses
  // (SD-336 fix efb98a0: a drain that stopped after the queue commit lost its changes in memory).
  action flush(w: str): bool = {
    val wk = work.get(w)
    // storeStatuses writes the queue row's status at the time of the write, not the drain's change (Q-outbound_queue-3
    // fix: the update reads platform.outbound in the same statement).
    val stored = wk.pend.foldl(mirror, (m, c) => if (env.erased or m.get(c._1) == "none") m else m.set(c._1, rows.get(c._1).status))
    val repaired = stored.keys().mapBy(r => {
      val st = rows.get(r).status
      if (WAITING_MSG.contains(stored.get(r)) and not(WAITING.contains(st)) and st != "none") st else stored.get(r)
    })
    all {
      wk.phase == "flush",
      mirror' = if (wk.direct) stored else repaired,
      ghost' = if (wk.direct) ghost else ghost.keys().mapBy(r => { ...ghost.get(r), lost: false }),
      work' = work.set(w, IDLE),
      rows' = rows, env' = env, conv' = conv, views' = views, slots' = slots, admitted' = admitted, hooks' = hooks,
    }
  }

  // A process stops (crash, deploy). Its in-memory changes are lost; leases stay; the advisory lock goes.
  action crash(w: str): bool = all {
    work.get(w).phase != "idle",
    env.crashes < MAX_CRASHES,
    work' = work.set(w, IDLE),
    env' = { ...env, lineHolder: if (env.lineHolder == w) "" else env.lineHolder, crashes: env.crashes + 1 },
    ghost' = work.get(w).pend.foldl(ghost, (g, c) => g.setBy(c._1, x => { ...x, lost: true })),
    rows' = rows, conv' = conv, views' = views, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
  }

  // ------------------------------------------------------------------ the notify projection (rt:718-745)
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
  // A signed turn starts (svc:2264-2386). In a signed turn `engaged` runs only after inbound() returns
  // (svc:1178, svc:2378); the Network's unit (and its drain) runs inside inbound().
  // acct: the turn is account-eligible (svc accountEligible: policy allowed, a known age that can join).
  action turnStart(acct: bool): bool = all {
    env.turn != "open",
    env.inSeq < MAX_TURNS,
    env' = { ...env, turn: "open", inSeq: env.inSeq + 1, trueUnans: 0, reengSent: false, engagePending: true, turnAcct: acct },
    rows' = rows, work' = work, ghost' = ghost, conv' = conv, views' = views, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
  }

  // queue.inbound (oq:748-755): the streak resets and held rows of the address go back to pending.
  action engaged: bool = all {
    env.engagePending,
    conv' = { ...conv, exists: true, unanswered: 0, reUsed: false, lastIn: env.now },
    rows' = rows.keys().mapBy(r => if (rows.get(r).status == "held_awaiting_reply")
      { ...rows.get(r), status: "pending", nextAt: env.now } else rows.get(r)),
    env' = { ...env, engagePending: false, engSeq: env.engSeq + 1 },
    work' = work, ghost' = ghost, views' = views, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
  }

  // A reply in a signed turn: the queue's leak guard runs first; a pass is collected (Cloud sends it), a fail goes
  // into the queue parked for staff at once (SD-101 fix ca25f43: no send-time gate may end it first).
  // collectGate (rt writeUnit, oq-free): a non-compliance reply to an opted-out number is refused at collection: it is
  // stored in network.messages as refused and gets no queue row. Here that reply is not collected.
  action collect(r: str, kind: str, leakBad: bool): bool = all {
    env.turn == "open",
    rows.get(r).status == "none",
    not(env.erased),
    kind == "reply" or kind == "compliance",
    // numberFacts consent (svc:785) is resolveConsent(lastConsent(e164, app)), the same guard as the admission.
    kind == "compliance" or not(codeOptedOut(env.ledger)),
    rows' = rows.set(r, if (leakBad)
        { ...NO_ROW, status: "parked_leak_review", kind: kind, member: true, net: "nyc", created: env.now, nextAt: env.now,
          hasBody: true, leakBad: true, guardFailed: true, cause: "leak" }
      else
        { ...NO_ROW, status: "collected", kind: kind, member: true, net: "nyc", created: env.now, nextAt: env.now,
          hasBody: true, turnLive: true, acctFree: not(env.turnAcct) }),
    mirror' = mirror.set(r, if (leakBad) "parked_leak_review" else "collected"),
    ghost' = if (leakBad) ghost.setBy(r, x => { ...x, maxRank: 5, wasParked: true }) else ghost,
    work' = work, env' = env, conv' = conv, views' = views, slots' = slots, admitted' = admitted, hooks' = hooks,
  }

  // The turn ends: handled (the gateway gets the replies) or unresolved (a throw: svc:2360; the gateway never
  // gets them, and every later receipt answers turn_unavailable, svc:2313).
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

  // POST /internal/turn-receipt. Accepted without history is refused (400) unless the turn is account-free
  // (accountEligible false, SD-131 fix bdd0698). The gateway reports accepted only for what it sent, and Cloud keeps
  // no history for a turn without an account. An accepted reply counts in the line's streak and moves
  // last_outbound_at (countSend, SD-148 fix cdd106f).
  action gatewayReceipt(r: str, outcome: str, history: bool): bool = {
    val row = rows.get(r)
    val refused = (outcome == "accepted" and not(history) and not(row.acctFree)) or (outcome != "accepted" and history)
    val st = if (outcome == "accepted") "sent" else if (outcome == "unknown") "send_unknown" else "refused_gateway"
    all {
      row.status == "collected" or row.status == "send_unknown",
      row.turnLive,
      env.turn == "handled",
      outcome == "accepted" implies admitted.contains(r),
      outcome == "rejected" implies not(admitted.contains(r)),
      row.acctFree implies not(history),
      if (refused) all {
        ghost' = ghost.setBy(r, x => { ...x, receiptRefused: true }),
        rows' = rows, mirror' = mirror, conv' = conv,
      } else all {
        rows' = rows.set(r, { ...row, status: st, sentAt: row.sentAt or outcome == "accepted" }),
        mirror' = mirror.set(r, st),
        ghost' = bump(ghost, r, st),
        conv' = if (outcome == "accepted") convAfterAccept(conv, row, false, env.now) else conv,
      },
      work' = work, env' = env, views' = views, slots' = slots, admitted' = admitted, hooks' = hooks,
    }
  }

  // A consent event committed in the ledger (another turn, another replica, the web): STOP, START, leave, a join.
  action consentEvent(scope: str, state: str): bool = all {
    env.ledger.length() < MAX_CONSENT,
    env' = { ...env, ledger: env.ledger.append({ scope: scope, state: state }) },
    rows' = rows, work' = work, ghost' = ghost, conv' = conv, views' = views, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
  }
  // STOP on the shared line (scope all).
  action stop: bool = consentEvent("all", "opted_out")

  // A trust hold or pause (staff, the Network) commits on worker w's replica: the unit loads the newest state, saves
  // a new version, and w's view is fresh; others are not.
  action holdToggle(w: str): bool = all {
    work.get(w).phase == "idle",
    env' = { ...env, held: not(env.held), ver: env.ver + 1 },
    views' = views.set(w, { held: not(env.held), closed: env.closed, ver: env.ver + 1 }),
    rows' = rows, work' = work, ghost' = ghost, conv' = conv, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
  }
  // The opportunity the agent-initiated rows are about closes (a unit on worker w's replica).
  action closeItem(w: str): bool = all {
    not(env.closed),
    work.get(w).phase == "idle",
    env' = { ...env, closed: true, ver: env.ver + 1 },
    views' = views.set(w, { held: env.held, closed: true, ver: env.ver + 1 }),
    rows' = rows, work' = work, ghost' = ghost, conv' = conv, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
  }
  // A unit of work on worker w's replica loads the newest state (rt:358-363).
  action refresh(w: str): bool = all {
    work.get(w).phase == "idle",
    views' = views.set(w, { held: env.held, closed: env.closed, ver: env.ver }),
    rows' = rows, work' = work, ghost' = ghost, env' = env, conv' = conv, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
  }

  // The member is forgotten (leave, delete all): rt:615-635. Waiting rows end dropped_forgotten, text and address
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

  // Blooio's safety state of the line (safety.* webhooks, blooio mode only: svc:1166-1169, oq:758-762).
  action setSafety(a: str): bool = all {
    env.mode == "blooio",
    env' = { ...env, lineSafety: a },
    rows' = rows, work' = work, ghost' = ghost, conv' = conv, views' = views, slots' = slots, admitted' = admitted, mirror' = mirror, hooks' = hooks,
  }

  // Staff decide a parked text (oq:838-850, svc:2619-2650). Release: back to pending, the leak guard does not
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

  // Blooio delivery receipts (blooio mode; applyStatus): one read, then one write conditional on the status read.
  // A write that misses reads again and decides on the current status (SD-300 fix 66f1601).
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
      if (row.status != hk.readStatus) all {
        hooks' = hooks.set(h, { ...hk, readStatus: row.status }),
        rows' = rows, slots' = slots, ghost' = ghost, mirror' = mirror,
      } else all {
        hooks' = hooks.set(h, { phase: "idle", row: "", st: "", readStatus: "" }),
        if (failedOk or rankOk) all {
          rows' = rows.set(r, if (failedOk) endRow(row, "failed", "receipt")
            else { ...row, status: hk.st, hasBody: if (final and not(row.member)) false else row.hasBody }),
          slots' = if (failedOk) releaseSlot(slots, r, row, "failed") else slots,
          ghost' = bump(ghost, r, st).setBy(r, x => { ...x, deliveryFailed: x.deliveryFailed or failedOk }),
          mirror' = if (row.member and not(env.erased)) mirror.set(r, st) else mirror,
        } else all { rows' = rows, slots' = slots, ghost' = ghost, mirror' = mirror },
      },
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
    { nondet ws = oneOf(WORKERS.filter(x => work.get(x).phase == "reconcile" and not(work.get(x).swept))) sweepCollected(ws) },
    lookupCall(w, r, answer),
    { nondet wl = oneOf(WORKERS.filter(x => work.get(x).phase == "looked")) lookupApply(wl) },
    { nondet wr = oneOf(WORKERS.filter(x => work.get(x).phase == "reconcile")) lockLine(wr) },
    { nondet wk = oneOf(WORKERS.filter(x => work.get(x).phase == "locked"))
      nondet rd = oneOf(ROWS.filter(x => DUE.contains(rows.get(x).status) and rows.get(x).nextAt <= env.now and not(work.get(wk).seen.contains(x))
        and rows.get(x).net == work.get(wk).net))
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
    enqueue(r, kind, b1, net, b2),
    { nondet wi = oneOf(WORKERS.filter(x => work.get(x).phase == "idle")) drainStart(wi, net, b3 and b1) },
    crash(w),
    project(r),
    turnStart(b2),
    engaged,
    collect(r, if (b1) "reply" else "compliance", b2),
    turnFinish(b3),
    gatewaySend(r),
    gatewayReceipt(r, outcome, b1),
    // A consent event comes in a quarter of the draws (weights only), as the one STOP did before the ledger.
    all { b1 and b3, nondet cs = oneOf(Set("all", "app", "other")) consentEvent(cs, if (b2) "opted_out" else "opted_in") },
    all { b1 and b2 and b3, holdToggle(w) },
    all { b1 and b2 and b3, closeItem(w) },
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
    // error, a database error and a direct() drain each come in a quarter of the draws; a hold toggle and a closed item
    // (each one makes the other replica's view old until it refreshes) come in an eighth.
    val out = if (b1) "ok" else bad
    if (focus and WORKERS.exists(x => work.get(x).phase != "idle")) drainSteps(w, r, b1, b2, b3, out, answer)
    else if (focus) any {
      // With no drain in progress, half of the steps start one, add a row or let time pass (also in worldSteps).
      enqueue(r, kind, b1, net, b2),
      { nondet wi = oneOf(WORKERS.filter(x => work.get(x).phase == "idle")) drainStart(wi, net, b3 and b1) },
      tick(d),
    }
    else any {
      drainSteps(w, r, b1, b2, b3, out, answer),
      worldSteps(w, r, h, b1, b2, b3, kind, net, outcome, st, a, d),
    }
  }

  // ------------------------------------------------------------------ invariants
  pure def memberGone(row: Row, erased: bool): bool = row.member and erased
  val quiescent = WORKERS.forall(w => work.get(w).phase == "idle") and HANDLERS.forall(h => hooks.get(h).phase == "idle")

  // I1 / AGENTS "Keep every safety guard ... STOP": a non-compliance row is claimed only while the person has
  // not opted out (oq:14-16 "a STOP that arrives while a message waits wins").
  // The ghost reads the rule (stoppedByRule over the whole ledger); the admission reads the code's guard
  // (codeOptedOut: lastEvents and resolveConsent). So the invariant fails when the guard misses a case: with the
  // recheck only for member rows (the Q-outbound_queue-1 defect) or without the STOP-wide event, it fails
  // (findings file section 0.6).
  // Failed before fix 1f86525: Q-outbound_queue-1 (admission rechecked consent only for member rows).
  val noClaimAfterStop = ROWS.forall(r => not(ghost.get(r).bad.contains("afterStop")))
  // I1 / oq:113 "The recipient at send time: paused, blocked, held"; oq:14 "each reads the database".
  // Failed before fix 6cc9d1b: SD-020 (the recipient gate reads the replica's in-memory Network; the claim now
  // needs the stored state version to be the one the replica read).
  val noClaimWhileHeld = ROWS.forall(r => not(ghost.get(r).bad.contains("whileHeld")))
  // oq:15 "too old or about a closed item (expired)" and oq:105 "Every hook fails closed when it throws".
  // Failed before fixes 6cc9d1b and 8495b7a: SD-020 (stale in-memory view) and SD-299 (the stale hook failed open).
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
  // oq:197 "Statuses that did not go out": a NOT_SENT row was not taken by the provider (or its delivery failed).
  // Erasure ends an in-flight row of a forgotten member without a send check; those rows are left out. So are rows that
  // recover() put back to retry_scheduled in webhook mode (no receipt provider, so no lookup exists): the queue
  // marks them in_doubt and cannot know whether the stopped call went out; a later gate may end them unsent.
  // Production delivery (Cloud) has the lookup and is checked in full.
  // Failed before fixes a8e4b55 and 1e3585b: SD-090 (failed_unknown counted from created_at, in NOT_SENT) and
  // Q-outbound_queue-2 (parked_error after the provider accepted).
  val notSentMeansNotOut = ROWS.forall(r => {
    val row = rows.get(r)
    (NOT_SENT.contains(row.status) and not(memberGone(row, env.erased)) and not(ghost.get(r).resent)) implies
      (not(admitted.contains(r)) or ghost.get(r).deliveryFailed)
  })
  // ch:49 "A message's delivery status now": a NOT_SENT message status is not stored for a text that went out.
  // Failed before fixes 255a42d and 1e3585b: SD-334 (a lost race reported dropped_forgotten) and Q-outbound_queue-2.
  // NOT IN `safety`: Q-outbound_queue-3 (open, below) also breaks it. A drain parks a text; staff release it
  // (svc /queue/leak-review: network.messages "pending"); the drain's storeStatuses then writes its older
  // "parked_leak_review"; a later drain sends the released text. Until that drain's own store runs (or for ever, when
  // it stops before the store: the SD-336 repair reads only waiting statuses), the message shows a NOT_SENT status for
  // a text that went out. The simulator finds it at sample seed 0x94d19f (max-steps 40), on the model before and after
  // the 8ca695b changes; the fixed seed 0x5eed did not reach it before.
  val mirrorNotSentMeansNotOut = ROWS.forall(r =>
    NOT_SENT.contains(mirror.get(r)) implies (not(admitted.contains(r)) or ghost.get(r).deliveryFailed))
  // PRD 40.3 / AGENTS item 7: at most CAP proactive texts to the person a day, counting every text the provider
  // took (sent or maybe sent). The model's runs check the first day.
  // Failed before fixes a8e4b55 and 1e3585b: SD-090 and Q-outbound_queue-2 (the slot of a text that went out went back).
  val capAtMost = env.now < DAY implies
    ROWS.filter(r => rows.get(r).kind == "proactive" and rows.get(r).member and admitted.contains(r)
      and not(ghost.get(r).deliveryFailed)).size() <= CAP
  // 0012 header: a slot is held only by a send that may still go out or went out.
  // Holds in every run.
  val slotOnlyForLiveRow = slots.forall(r => not(NOT_SENT.contains(rows.get(r).status)) or memberGone(rows.get(r), env.erased))
  // oq:31 "Statuses never go back" (a staff release of a parked text is the one exit).
  // NOT IN `safety`: SD-099 still makes it fail. wait() and end() have no status guard: erasure ends a row of the
  // forgotten member between dispatch's read and its wait(), and wait() writes a waiting status over
  // dropped_forgotten (sd099WaitOverErasureTest). The register verdict for SD-099 is "refuted" (only the status
  // field changes: the text and address stay cleared, and the next dispatch ends the row again at admission), so
  // no code fix was made. `noStatusRegressLive` below is the same rule for every other row and is in `safety`.
  val noStatusRegress = ROWS.forall(r => rank(rows.get(r).status) >= ghost.get(r).maxRank)
  // The same rule for every row that is not a row of a forgotten member (SD-099 above).
  // Failed before fix 66f1601: SD-300 (applyStatus read then wrote with no condition).
  val noStatusRegressLive = ROWS.forall(r => memberGone(rows.get(r), env.erased) or rank(rows.get(r).status) >= ghost.get(r).maxRank)
  // oq:23 "Compliance texts ... skip ... the caps"; ops.ts:303 "STOP and HELP still go".
  // Failed before fix 9e763d7: SD-094 (gate 7 had no compliance exemption).
  val complianceAlwaysGoes = ROWS.forall(r => not(rows.get(r).kind == "compliance"
    and rows.get(r).status == "retry_scheduled" and rows.get(r).lastWait == "line_safety"))
  // oq:32 "A row to someone who is not a member keeps the address and the text only until it ends". Under Cloud no
  // receipt reaches the service (AGENTS: the gateway owns the Blooio webhook), so accepted is where the row ends.
  // Failed before fix 0a787a8: SD-091 (accepted never ended under Cloud).
  val nonMemberBodyClearedAtEnd = ROWS.forall(r => {
    val row = rows.get(r)
    (not(row.member) and row.hasBody) implies
      (WAITING.contains(row.status) or row.status == "parked_leak_review" or row.status == "none"
        or (env.mode == "blooio" and IN_FLIGHT.contains(row.status)))
  })
  // rt:526-543: a collected reply that fails the guard "goes into the queue ..., where the same guard parks it for
  // staff". Staff see it before any other end (they release it or drop it).
  // Failed before fix ca25f43: SD-101 (the row was pending; the unit drains before engaged and gate 4 ended it).
  val guardFailedReachesStaff = ROWS.forall(r => rows.get(r).guardFailed implies
    (rows.get(r).status == "parked_leak_review" or rows.get(r).leakReleased or rows.get(r).status == "dropped_leak_review"
      or memberGone(rows.get(r), env.erased)))
  // reconcileUnknown "so nothing waits forever unseen": no collected or send_unknown reply is older than the TTL at the
  // last sweep (a reply whose receipt cannot come, or comes as unknown, ends failed_unknown).
  // Failed before fix b6ea5e1: SD-100 (no sweeper read collected).
  val collectedResolvable = ROWS.forall(r => {
    val row = rows.get(r)
    (row.status == "collected" or row.status == "send_unknown") implies row.created >= env.lastSweep - UNKNOWN_TTL
  })
  // svc turn-receipt: Cloud's accepted receipt for a reply of a turn with no Cloud account (no history to record)
  // is recorded, not refused.
  // Failed before fix bdd0698: SD-131 (only compliance and onboarding replies were account-free).
  val noHistoryReceiptRecorded = ROWS.forall(r => not(ghost.get(r).receiptRefused and rows.get(r).acctFree))
  // oq:18-19 "held until the person writes": a row is not held for an answer the person already gave.
  // Failed before fix dde38c4: SD-147 (lost wakeup: held written after queue.inbound released).
  val heldOnlyWhileUnanswered = ROWS.forall(r =>
    rows.get(r).status == "held_awaiting_reply" implies ghost.get(r).heldSeq >= env.engSeq)
  // oq:18-19 "at most 3 unanswered messages per conversation, then one re-engagement" (scaled to 1). Counts every
  // non-compliance text the person got since their last message, queue or collected.
  // Failed before fix cdd106f: SD-148 (collectedReceipt did not count in line_conversations).
  // NOT IN `safety` (Q-outbound_queue-5, open, not fixed: needs a maintainer decision). The simulator found two
  // traces after the consent ledger changed the random walk; neither has an opt-out in it, so both were in the
  // state space before and the earlier passes were sampling luck:
  //  - q5LateTurnReplyTest: the gateway sends a collected reply of an earlier turn after the person wrote again,
  //    and a queue reply of the newer turn also went out (collected replies pass no queue gate).
  //  - q5UnknownNotCountedTest: a text whose acceptance is unknown (unknown_acceptance) does not count in the line
  //    conversation (countSend runs only at acceptance), so the next text to the same address passes the cap gate.
  // What counts as "unanswered" for a late answer, and whether an unknown acceptance must hold a streak slot, is
  // not written down; the model keeps the strict count.
  val unansweredAtMost = env.trueUnans <= MAX_UNANSWERED + (if (env.reengSent) 1 else 0)
  // oq:2 "One queue object serves one app"; runtime.ts:1-5: a network's checks are for its own members.
  // Failed before fix 5a6cf8e: SD-132 (the drain selected by app and line; memberOf missed, network.ts:4848).
  val ownNetworkDecides = ROWS.forall(r => not(ghost.get(r).foreign))
  // ch:49 and rt drainQueue (rt:694-708): once nobody holds unsaved changes, a settled row's message status equals the queue's,
  // or the notify projection can still repair it, or a crash lost the change and no runtime drain ran since (the
  // next one copies it: sd336CrashLosesStatusTest).
  // Failed before fixes eb5a589, efb98a0, 255a42d: SD-136 (direct() dropped the changes), SD-336 (a crash before
  // storeStatuses was never repaired), SD-334.
  // NOT IN `safety`: one new defect that this model found on the fixed code still makes it fail (findings file):
  //  - Q-outbound_queue-3 (fixed): storeStatuses wrote a drain's change with no condition, so a staff leak-review
  //    decision or a receipt that came after the queue commit was overwritten. It now writes the queue row's status
  //    (q3StaleStoreTest, q3ReleaseSentTest; packages/network/test/cloud-outbound.integration.test.ts).
  //  - Q-outbound_queue-4: the SD-336 repair copies only to messages in a waiting status. A collected reply that
  //    the sweep ends failed_unknown keeps the message status "collected" when the process stops before
  //    storeStatuses (q4SweepLostTest).
  // `mirrorNotStuckWaiting` below (in `safety`) is the part that the SD-136 and SD-336 fixes give.
  val mirrorSettles = quiescent implies ROWS.forall(r => {
    val row = rows.get(r)
    val settled = not(WAITING.contains(row.status)) and row.status != "none" and row.status != "collected" and row.status != "send_unknown"
    val repairable = PROVIDER.contains(row.status) and row.sentAt and row.hasBody and not(ghost.get(r).projected)
    val lostLag = ghost.get(r).lost and WAITING_MSG.contains(mirror.get(r))
    (row.member and not(env.erased) and settled) implies (mirror.get(r) == row.status or repairable or lostLag)
  })
  // The SD-136 / SD-336 rule: once nobody holds unsaved changes, no settled member row's message shows a waiting
  // status, unless the projection can still repair it or a crash lost the change and no runtime drain ran since.
  val mirrorNotStuckWaiting = quiescent implies ROWS.forall(r => {
    val row = rows.get(r)
    val settled = not(WAITING.contains(row.status)) and row.status != "none" and row.status != "collected" and row.status != "send_unknown"
    val repairable = PROVIDER.contains(row.status) and row.sentAt and row.hasBody and not(ghost.get(r).projected)
    (row.member and not(env.erased) and settled and WAITING_MSG.contains(mirror.get(r))) implies (repairable or ghost.get(r).lost)
  })
  // Caps and thread history count sent_at (oq:444-448, oq:530-533): sent_at only for a text the provider took.
  // Failed before fix aba939e: SD-337 (a send receipt with status failed wrote sent_at).
  val sentAtOnlyIfOut = ROWS.forall(r => rows.get(r).sentAt implies admitted.contains(r))

  val safety = and {
    noClaimAfterStop, noClaimWhileHeld, noClaimWhenClosed, leakGate, unknownNeverResends,
    notSentMeansNotOut, capAtMost, slotOnlyForLiveRow, noStatusRegressLive,
    complianceAlwaysGoes, nonMemberBodyClearedAtEnd, guardFailedReachesStaff, collectedResolvable, noHistoryReceiptRecorded,
    heldOnlyWhileUnanswered, ownNetworkDecides, mirrorNotStuckWaiting, sentAtOnlyIfOut,
  }

  // ------------------------------------------------------------------ run tests (concrete traces)
  // Each drain in a trace is: drainStart, (ttlSelect, ttlEnd,) sweepCollected, (lookups,) lockLine, dispatches,
  // unlockLine, flush. The SD-NNN and Q-outbound_queue-N traces are the traces of the findings, replayed on the
  // fixed code: each one now ends in the state the fix gives (the name of the integration test is in the comment).

  // A proactive text to a member: enqueue, drain, admission, Cloud accepts (cloud-outbound.integration.test.ts).
  run proactiveHappyTest =
    initWith("cloud", true, false)
      .then(enqueue("r1", "proactive", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1"))
      .then(lockLine("w1"))
      .then(decide("w1", "r1", false, false))
      .then(applyDecision("w1", false))
      .then(providerCall("w1", "ok"))
      .then(respond("w1", false))
      .then(unlockLine("w1"))
      .then(flush("w1"))
      .expect(rows.get("r1").status == "accepted" and mirror.get("r1") == "accepted" and slots == Set("r1") and safety)

  // A transactional text in quiet hours waits, then goes after the window.
  run quietHoursTest =
    initWith("cloud", true, false)
      .then(enqueue("r1", "transactional", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, true)).then(applyDecision("w1", false))
      .then(unlockLine("w1")).then(flush("w1"))
      .expect(rows.get("r1").status == "deferred_quiet_hours")
      .then(tick(1))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .then(providerCall("w1", "ok")).then(respond("w1", false))
      .then(unlockLine("w1")).then(flush("w1"))
      .expect(rows.get("r1").status == "accepted" and not(witness_deferredThenSent) and safety)

  // SD-090 (fix a8e4b55; "SD-090: an unknown acceptance gets its receipt lookups for the whole TTL, counted from when
  // it became unknown; failed_unknown keeps the person-cap slot"). A proactive row waits through quiet hours (more
  // than 6 h after created_at), then the deliver call loses its answer. The next drain does not end it: the TTL
  // counts from when acceptance became unknown, and the lookup finds the text accepted.
  run sd090UnknownTtlTest =
    initWith("cloud", true, false)
      .then(enqueue("r1", "proactive", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, true)).then(applyDecision("w1", false))
      .then(unlockLine("w1")).then(flush("w1"))
      .then(tick(72)).then(tick(1))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .then(providerCall("w1", "lost")).then(respond("w1", false))
      .then(unlockLine("w1")).then(flush("w1"))
      .expect(rows.get("r1").status == "unknown_acceptance" and slots == Set("r1")
        and rows.get("r1").created < env.now - UNKNOWN_TTL and not(rows.get("r1").nextAt < env.now - UNKNOWN_TTL))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1"))
      .then(lookupCall("w1", "r1", "ok")).then(lookupApply("w1"))
      .then(lockLine("w1")).then(unlockLine("w1")).then(flush("w1"))
      .expect(rows.get("r1").status == "accepted" and mirror.get("r1") == "accepted" and slots == Set("r1") and safety)

  // SD-090, the TTL end: a row still unknown 6 h after its acceptance became unknown ends failed_unknown and keeps
  // its person-cap slot, so a second proactive text the same day is refused.
  run sd090TtlKeepsSlotTest =
    initWith("cloud", true, false)
      .then(enqueue("r1", "proactive", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .then(providerCall("w1", "lost")).then(respond("w1", false))
      .then(unlockLine("w1")).then(flush("w1"))
      .then(tick(72)).then(tick(1))
      .then(drainStart("w1", "nyc", false)).then(ttlSelect("w1", "r1")).then(ttlEnd("w1"))
      .expect(rows.get("r1").status == "failed_unknown" and slots == Set("r1") and safety)
      .then(enqueue("r2", "proactive", true, "nyc", false))
      .then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r2", false, false)).then(applyDecision("w1", false))
      .expect(rows.get("r2").status == "refused_person_cap" and capAtMost and safety)

  // Q-outbound_queue-1 (fix 1f86525; "a STOP that commits while a direct text to a non-member is in dispatch stops
  // the text"). The text passes the consent gate, a STOP commits, and the admission transaction reads the ledger
  // again for every non-compliance row: the row ends refused_opted_out and Cloud never gets it.
  run q1NonMemberStopTest =
    initWith("cloud", true, false)
      .then(turnStart(true)).then(engaged)
      .then(enqueue("r1", "reply", false, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false))
      .expect(work.get("w1").dec == "send")
      .then(stop)
      .then(applyDecision("w1", false))
      .expect(rows.get("r1").status == "refused_opted_out" and not(rows.get("r1").hasBody)
        and not(admitted.contains("r1")) and noClaimAfterStop and safety)

  // The guard and the rule agree on every ledger of up to MAX_CONSENT events (each scope, each state): the code
  // refuses exactly when the rule says the person is stopped. A per-app leave, then a STOP-wide START: still stopped
  // for this app; a STOP-wide STOP, then START on this app's line: not stopped; another app's leave: not stopped.
  pure val CONSENT_EVENTS = tuples(Set("all", "app", "other"), Set("opted_out", "opted_in")).map(t => { scope: t._1, state: t._2 })
  pure val LEDGERS: Set[List[Consent]] = Set(List())
    .union(CONSENT_EVENTS.map(e => List(e)))
    .union(tuples(CONSENT_EVENTS, CONSENT_EVENTS).map(t => List(t._1, t._2)))
    .union(tuples(CONSENT_EVENTS, CONSENT_EVENTS, CONSENT_EVENTS).map(t => List(t._1, t._2, t._3)))
  run consentGuardMatchesRuleTest =
    initWith("cloud", true, false)
      .expect(LEDGERS.forall(l => codeOptedOut(l) == stoppedByRule(l)) and LEDGERS.size() == 259
        and codeOptedOut(List({ scope: "app", state: "opted_out" }, { scope: "all", state: "opted_in" }))
        and not(codeOptedOut(List({ scope: "all", state: "opted_out" }, { scope: "app", state: "opted_in" })))
        and not(codeOptedOut(List({ scope: "other", state: "opted_out" }))))

  // A leave of this app (not a STOP) while a direct text to a non-member is in dispatch: the admission refuses it.
  run leaveDuringDispatchTest =
    initWith("cloud", true, false)
      .then(turnStart(true)).then(engaged)
      .then(enqueue("r1", "reply", false, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false))
      .expect(work.get("w1").dec == "send")
      .then(consentEvent("app", "opted_out"))
      .then(applyDecision("w1", false))
      .expect(rows.get("r1").status == "refused_opted_out" and not(admitted.contains("r1")) and noClaimAfterStop and safety)

  // Q-outbound_queue-2 (fix 1e3585b; "when the commit of a send Cloud took fails, the row waits for the receipt
  // lookup; it never ends unsent and keeps its person-cap slot"). Cloud accepts, the accept transaction throws: the row
  // is unknown_acceptance with its slot; the lookup records it accepted; the person writes (the unanswered cap does
  // not hold the next text); a second proactive text is refused by the person cap.
  run q2AcceptDbErrorTest =
    initWith("cloud", true, false)
      .then(enqueue("r1", "proactive", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .then(providerCall("w1", "ok")).then(respond("w1", true))
      .then(unlockLine("w1")).then(flush("w1"))
      .expect(rows.get("r1").status == "unknown_acceptance" and admitted.contains("r1") and slots == Set("r1") and safety)
      .then(enqueue("r2", "proactive", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1"))
      .then(lookupCall("w1", "r1", "ok")).then(lookupApply("w1"))
      .then(turnStart(true)).then(engaged)
      .then(lockLine("w1"))
      .then(decide("w1", "r2", false, false)).then(applyDecision("w1", false))
      .then(unlockLine("w1")).then(flush("w1"))
      .expect(rows.get("r1").status == "accepted" and mirror.get("r1") == "accepted"
        and rows.get("r2").status == "refused_person_cap" and capAtMost and safety)

  // SD-020 (fix 6cc9d1b; "a replica whose Network state is older than the stored one never claims a row; it leaves
  // the row until it loads the new state"). A hold commits on replica w2. Replica w1's runtime drain does not start
  // (stateCurrent); a direct() drain on w1 decides "send" on its old view, and the admission fence leaves the row.
  // After w1 loads the new state, its drain suppresses the row for the held member.
  run sd020StaleReplicaTest =
    initWith("cloud", true, false)
      .then(enqueue("r1", "transactional", true, "nyc", false))
      .then(holdToggle("w2"))
      .expect(views.get("w1").ver != env.ver)
      .then(drainStart("w1", "nyc", true)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false))
      .expect(work.get("w1").dec == "send")
      .then(applyDecision("w1", false))
      .expect(rows.get("r1").status == "pending" and noClaimWhileHeld and safety)
      .then(unlockLine("w1")).then(flush("w1"))
      .then(refresh("w1"))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .expect(rows.get("r1").status == "suppressed_ineligible" and safety)

  // SD-020, the race inside one dispatch: w1's view is current when it decides; a hold commits on w2 before w1's
  // admission transaction; the fence sees the newer stored version and leaves the row.
  run sd020HoldDuringDispatchTest =
    initWith("cloud", true, false)
      .then(enqueue("r1", "transactional", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false))
      .then(holdToggle("w2"))
      .then(applyDecision("w1", false))
      .expect(rows.get("r1").status == "pending" and env.held and noClaimWhileHeld and safety)

  // SD-299 (fix 8495b7a; "when the stale check of a notification throws, the row is not sent; it waits and goes once
  // the check reads it as current"). Here the item closed: the throw lets the row wait; the next drain expires it.
  run sd299StaleFailsOpenTest =
    initWith("cloud", true, false)
      .then(enqueue("r1", "proactive", true, "nyc", false))
      .then(closeItem("w1"))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", true, false)).then(applyDecision("w1", false))
      .expect(rows.get("r1").status == "retry_scheduled" and rows.get("r1").attempts == 1 and noClaimWhenClosed and safety)
      .then(unlockLine("w1")).then(flush("w1")).then(tick(1))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .expect(rows.get("r1").status == "expired" and safety)

  // SD-091 (fix 0a787a8; "under Cloud a text to a non-member ends at acceptance and keeps no address and no text").
  run sd091NonMemberBodyTest =
    initWith("cloud", true, false)
      .then(enqueue("r1", "compliance", false, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .then(providerCall("w1", "ok")).then(respond("w1", false))
      .expect(rows.get("r1").status == "accepted" and not(rows.get("r1").hasBody) and nonMemberBodyClearedAtEnd and safety)

  // SD-094 (fix 9e763d7; "under a Blooio line safety action compliance texts still go; other texts wait").
  run sd094ComplianceHeldTest =
    initWith("blooio", true, false)
      .then(setSafety("review"))
      .then(enqueue("r1", "compliance", true, "nyc", false))
      .then(enqueue("r2", "transactional", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .expect(rows.get("r1").status == "sending" and complianceAlwaysGoes)
      .then(providerCall("w1", "ok")).then(respond("w1", false))
      .then(decide("w1", "r2", false, false)).then(applyDecision("w1", false))
      .expect(rows.get("r1").status == "accepted" and rows.get("r2").status == "retry_scheduled"
        and rows.get("r2").lastWait == "line_safety" and safety)

  // SD-100 (fix b6ea5e1; "a collected reply whose gateway receipt never comes, or comes as unknown, ends failed_unknown
  // after the TTL"). The turn throws after its unit committed a collected reply; the gateway never gets it.
  run sd100CollectedStuckTest =
    initWith("cloud", true, false)
      .then(turnStart(true)).then(collect("r1", "reply", false)).then(turnFinish(false))
      .expect(rows.get("r1").status == "collected" and safety)
      .then(tick(72)).then(tick(1))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1"))
      .then(lockLine("w1")).then(unlockLine("w1")).then(flush("w1"))
      .expect(rows.get("r1").status == "failed_unknown" and mirror.get("r1") == "failed_unknown" and safety)

  // SD-100, the unknown receipt: the gateway reports unknown, nothing more comes, and the sweep ends the reply.
  run sd100SendUnknownTest =
    initWith("cloud", true, false)
      .then(turnStart(true)).then(collect("r1", "reply", false)).then(turnFinish(true))
      .then(gatewaySend("r1")).then(gatewayReceipt("r1", "unknown", false))
      .expect(rows.get("r1").status == "send_unknown")
      .then(tick(72)).then(tick(1))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1"))
      .expect(rows.get("r1").status == "failed_unknown" and notSentMeansNotOut and safety)

  // SD-131 (fix bdd0698; "Cloud's accepted receipt with no history is recorded for a reply to a number the service gave
  // no account"). The turn is not account-eligible; Cloud sends the reply and reports history false: the receipt is
  // recorded (sent).
  run sd131NoHistoryReceiptTest =
    initWith("cloud", true, false)
      .then(turnStart(false)).then(collect("r1", "reply", false)).then(turnFinish(true))
      .then(gatewaySend("r1")).then(gatewayReceipt("r1", "accepted", false))
      .expect(rows.get("r1").status == "sent" and mirror.get("r1") == "sent" and noHistoryReceiptRecorded and safety)

  // SD-101 (fix ca25f43; "a reply that fails the leak guard in a signed turn is parked for staff, also when the
  // member's last message is hours old"). The reply is written parked; no drain can end it; staff release it.
  run sd101GuardFailedReplyTest =
    initWith("cloud", true, false)
      .then(turnStart(true)).then(collect("r1", "reply", true))
      .expect(rows.get("r1").status == "parked_leak_review" and mirror.get("r1") == "parked_leak_review" and safety)
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(unlockLine("w1")).then(flush("w1"))
      .expect(rows.get("r1").status == "parked_leak_review" and guardFailedReachesStaff and safety)
      .then(staffRelease("r1"))
      .expect(rows.get("r1").status == "pending" and rows.get("r1").leakReleased and safety)

  // SD-147 (fix dde38c4; "a row the unanswered cap holds while the person writes back is not left held"). Dispatch
  // reads unanswered at the cap; the person writes and engaged finds nothing held; the hold write sees the new
  // inbound and leaves the row due; the next drain sends it.
  run sd147LostWakeupTest =
    initWith("blooio", true, false)
      .then(enqueue("r1", "transactional", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .then(providerCall("w1", "ok")).then(respond("w1", false))
      .then(unlockLine("w1")).then(flush("w1"))
      .then(enqueue("r2", "transactional", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r2", false, false))
      .expect(work.get("w1").dec == "held")
      .then(turnStart(true)).then(engaged)
      .then(applyDecision("w1", false))
      .expect(rows.get("r2").status == "pending" and conv.unanswered == 0 and heldOnlyWhileUnanswered and safety)
      .then(unlockLine("w1")).then(flush("w1"))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r2", false, false)).then(applyDecision("w1", false))
      .then(providerCall("w1", "ok")).then(respond("w1", false))
      .expect(rows.get("r2").status == "accepted" and safety)

  // SD-148 (fix cdd106f; "a collected reply that Cloud accepted counts in the line's unanswered streak and moves
  // last_outbound_at"). A proactive text after it meets the unanswered cap and is held.
  run sd148CollectedNotCountedTest =
    initWith("cloud", true, false)
      .then(turnStart(true)).then(engaged).then(collect("r1", "reply", false)).then(turnFinish(true))
      .then(gatewaySend("r1")).then(gatewayReceipt("r1", "accepted", true))
      .expect(conv.unanswered == 1 and conv.lastOut == env.now)
      .then(enqueue("r2", "proactive", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r2", false, false)).then(applyDecision("w1", false))
      .expect(rows.get("r2").status == "held_awaiting_reply" and env.trueUnans == 1 and unansweredAtMost and safety)

  // SD-132 (fix 5a6cf8e; "a second network of the same app on the same line never drains the first network's rows").
  // The sf drain does not select the nyc row; the nyc drain sends it.
  run sd132ForeignNetworkTest =
    initWith("cloud", true, true)
      .then(enqueue("r1", "transactional", true, "nyc", false))
      .then(drainStart("w2", "sf", false)).then(sweepCollected("w2")).then(lockLine("w2"))
      .then(unlockLine("w2")).then(flush("w2"))
      .expect(rows.get("r1").status == "pending" and ownNetworkDecides)
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .then(providerCall("w1", "ok")).then(respond("w1", false))
      .expect(rows.get("r1").status == "accepted" and ownNetworkDecides and safety)

  // SD-136 (fix eb5a589; "a direct text's drain writes the statuses it changed to network.messages").
  run sd136DirectDropsTest =
    initWith("cloud", true, false)
      .then(enqueue("r1", "transactional", true, "nyc", false))
      .then(stop)
      .then(drainStart("w1", "nyc", true)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .then(unlockLine("w1")).then(flush("w1"))
      .expect(rows.get("r1").status == "refused_opted_out" and mirror.get("r1") == "refused_opted_out" and mirrorSettles and safety)

  // SD-336 (fix efb98a0; "a status change that a drain did not store (the process stopped after the queue commit)
  // reaches network.messages on the next drain").
  run sd336CrashLosesStatusTest =
    initWith("cloud", true, false)
      .then(enqueue("r1", "transactional", true, "nyc", false))
      .then(stop)
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .then(crash("w1"))
      .expect(rows.get("r1").status == "refused_opted_out" and mirror.get("r1") == "queued" and ghost.get("r1").lost and safety)
      .then(drainStart("w2", "nyc", false)).then(sweepCollected("w2")).then(lockLine("w2"))
      .then(unlockLine("w2")).then(flush("w2"))
      .expect(mirror.get("r1") == "refused_opted_out" and not(ghost.get("r1").lost) and safety)

  // SD-334 (fix 255a42d; "two drains that look up one unknown acceptance never store dropped_forgotten for a text
  // that went out"). The second lookup's commit misses and reports the stored status, accepted.
  run sd334LostRaceTest =
    initWith("cloud", true, false)
      .then(enqueue("r1", "transactional", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .then(providerCall("w1", "lost")).then(respond("w1", false))
      .then(unlockLine("w1")).then(flush("w1"))
      .then(drainStart("w1", "nyc", false)).then(drainStart("w2", "nyc", false))
      .then(sweepCollected("w1")).then(sweepCollected("w2"))
      .then(lookupCall("w1", "r1", "ok")).then(lookupCall("w2", "r1", "ok"))
      .then(lookupApply("w1")).then(lookupApply("w2"))
      .then(lockLine("w1")).then(unlockLine("w1")).then(flush("w1"))
      .then(project("r1"))
      .then(lockLine("w2")).then(unlockLine("w2")).then(flush("w2"))
      .expect(rows.get("r1").status == "accepted" and mirror.get("r1") == "accepted"
        and mirrorNotSentMeansNotOut and mirrorSettles and safety)

  // SD-300 (fix 66f1601; "two delivery receipts for one row that read the same status never move the status back").
  // Both receipts read accepted; delivered writes first; the sent write misses, reads delivered and stops.
  run sd300ReceiptRegressTest =
    initWith("blooio", true, false)
      .then(enqueue("r1", "transactional", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .then(providerCall("w1", "ok")).then(respond("w1", false))
      .then(hookRead("h1", "r1", "delivered")).then(hookRead("h2", "r1", "sent"))
      .then(hookWrite("h1")).then(hookWrite("h2"))
      .expect(hooks.get("h2").readStatus == "delivered")
      .then(hookWrite("h2"))
      .expect(rows.get("r1").status == "delivered" and noStatusRegress and safety)

  // SD-337 (fix aba939e; "a send that Blooio answers with status failed gets no sent_at").
  run sd337FailedSetsSentAtTest =
    initWith("blooio", true, false)
      .then(enqueue("r1", "transactional", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .then(providerCall("w1", "failedReceipt")).then(respond("w1", false))
      .expect(rows.get("r1").status == "failed" and not(rows.get("r1").sentAt) and sentAtOnlyIfOut and safety)

  // SD-099 (not fixed; register verdict "refuted"): erasure ends a row between dispatch's read and its wait(); wait()
  // has no status guard. Only the status changes; `noStatusRegress` fails, `noStatusRegressLive` (in safety) holds.
  run sd099WaitOverErasureTest =
    initWith("cloud", true, false)
      .then(enqueue("r1", "transactional", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, true))
      .then(erase)
      .then(applyDecision("w1", false))
      .expect(rows.get("r1").status == "deferred_quiet_hours" and not(rows.get("r1").hasBody)
        and not(noStatusRegress) and safety)

  // SD-117 (fix 2d901dd; "a database error in the admission transaction does not end the row; it waits and goes on
  // the next drain").
  run sd117TransientParksTest =
    initWith("cloud", true, false)
      .then(turnStart(true)).then(engaged)
      .then(enqueue("r1", "reply", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", true))
      .expect(rows.get("r1").status == "retry_scheduled" and rows.get("r1").attempts == 1 and safety)
      .then(unlockLine("w1")).then(flush("w1")).then(tick(1))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .then(providerCall("w1", "ok")).then(respond("w1", false))
      .expect(rows.get("r1").status == "accepted" and safety)

  // SD-117, the attempts used up: a database error that repeats parks the row for a person.
  run sd117RepeatedErrorParksTest =
    initWith("cloud", true, false)
      .then(turnStart(true)).then(engaged)
      .then(enqueue("r1", "reply", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", true))
      .then(unlockLine("w1")).then(flush("w1")).then(tick(1))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", true))
      .expect(rows.get("r1").status == "parked_error" and rows.get("r1").attempts == MAX_ATTEMPTS and safety)

  // Q-outbound_queue-3 (new, not fixed): a drain parks a text, staff drop it before the drain's storeStatuses, and the
  // drain then writes its older status: network.messages keeps parked_leak_review for a row that ended
  // dropped_leak_review. No later drain repairs it (the repair reads only waiting statuses).
  run q3StaleStoreTest =
    initWith("cloud", true, false)
      .then(enqueue("r1", "transactional", true, "nyc", true))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .then(unlockLine("w1"))
      .then(staffDrop("r1"))
      .expect(mirror.get("r1") == "dropped_leak_review")
      .then(flush("w1"))
      .expect(rows.get("r1").status == "dropped_leak_review" and mirror.get("r1") == "dropped_leak_review"
        and mirrorSettles and safety)

  // Q-outbound_queue-3 with a release (found by the simulator after the consent ledger changed the random walk; no
  // consent event is in the trace): a drain parks r1; staff release it; another drain sends it; then the first
  // drain stores its change. Before the fix the message said parked_leak_review for a text Cloud took
  // (mirrorNotSentMeansNotOut failed). Now the store writes the row's status.
  run q3ReleaseSentTest =
    initWith("cloud", true, false)
      .then(turnStart(true)).then(engaged)
      .then(enqueue("r1", "reply", true, "nyc", true))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false)).then(unlockLine("w1"))
      .expect(rows.get("r1").status == "parked_leak_review" and work.get("w1").phase == "flush")
      .then(staffRelease("r1"))
      .then(drainStart("w2", "nyc", false)).then(sweepCollected("w2")).then(lockLine("w2"))
      .then(decide("w2", "r1", false, false)).then(applyDecision("w2", false))
      .then(providerCall("w2", "ok")).then(respond("w2", false)).then(unlockLine("w2")).then(flush("w2"))
      .expect(admitted.contains("r1") and mirror.get("r1") == "accepted")
      .then(flush("w1"))
      .expect(mirror.get("r1") == "accepted" and mirrorNotSentMeansNotOut and safety)

  // Q-outbound_queue-4 (new, not fixed): the sweep ends a collected reply failed_unknown and the process stops before
  // storeStatuses. The message stays "collected"; the SD-336 repair reads only waiting statuses, so the next drain
  // does not copy it.
  // Q-outbound_queue-5 (open): turn 1 collects a reply and is handled; the gateway has not sent it when the person
  // writes again (turn 2); the queue sends a reply in turn 2; then the gateway sends turn 1's reply.
  run q5LateTurnReplyTest =
    initWith("cloud", true, false)
      .then(turnStart(true)).then(engaged).then(collect("r2", "reply", false)).then(turnFinish(true))
      .then(turnStart(true)).then(engaged)
      .then(enqueue("r3", "reply", false, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r3", false, false)).then(applyDecision("w1", false))
      .then(providerCall("w1", "ok")).then(respond("w1", false)).then(unlockLine("w1")).then(flush("w1"))
      .then(turnFinish(true)).then(gatewaySend("r2"))
      .expect(env.trueUnans == 2 and not(unansweredAtMost) and safety)

  // Q-outbound_queue-5 (open): r2 is claimed; the person writes; Cloud's answer to r2 is lost (unknown_acceptance,
  // not counted); a second text to the same address passes the cap gate and goes out.
  run q5UnknownNotCountedTest =
    initWith("cloud", true, false)
      .then(enqueue("r2", "transactional", false, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r2", false, false)).then(applyDecision("w1", false))
      .then(turnStart(true))
      .then(providerCall("w1", "lost")).then(respond("w1", false)).then(unlockLine("w1")).then(flush("w1"))
      .expect(rows.get("r2").status == "unknown_acceptance" and admitted.contains("r2"))
      .then(enqueue("r1", "transactional", false, "nyc", false))
      .then(drainStart("w2", "nyc", false)).then(sweepCollected("w2")).then(lockLine("w2"))
      .then(decide("w2", "r1", false, false)).then(applyDecision("w2", false)).then(providerCall("w2", "ok"))
      .expect(env.trueUnans == 2 and not(unansweredAtMost) and safety)

  run q4SweepLostTest =
    initWith("cloud", true, false)
      .then(turnStart(true)).then(collect("r1", "reply", false)).then(turnFinish(false))
      .then(tick(72)).then(tick(1))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1"))
      .then(crash("w1"))
      .expect(rows.get("r1").status == "failed_unknown" and mirror.get("r1") == "collected" and not(mirrorSettles) and safety)
      .then(drainStart("w2", "nyc", false)).then(sweepCollected("w2")).then(lockLine("w2"))
      .then(unlockLine("w2")).then(flush("w2"))
      .expect(mirror.get("r1") == "collected" and not(mirrorSettles))

  // Fix 8ca695b ("keep a recorded row outcome when a send fails after it"): the deliver answer is lost and the lease
  // runs out; another replica recovers the row and its receipt lookup records the acceptance. The first worker's late
  // write of unknown_acceptance is guarded on OWNED and leaves accepted.
  run ownedGuardKeepsAcceptanceTest =
    initWith("cloud", true, false)
      .then(enqueue("r1", "transactional", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .then(providerCall("w1", "lost"))
      .then(tick(12))
      .then(drainStart("w2", "nyc", false)).then(sweepCollected("w2"))
      .then(lookupCall("w2", "r1", "ok")).then(lookupApply("w2"))
      .expect(rows.get("r1").status == "accepted")
      .then(respond("w1", false))
      .expect(rows.get("r1").status == "accepted" and noStatusRegress and safety)

  // expireHeld (oq:353-363): a held proactive row past its TTL ends expired when the next drain takes the line lock.
  run expireHeldTest =
    initWith("cloud", true, false)
      .then(turnStart(true)).then(engaged)
      .then(enqueue("r1", "transactional", true, "nyc", false))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .then(decide("w1", "r1", false, false)).then(applyDecision("w1", false))
      .then(providerCall("w1", "ok")).then(respond("w1", false))
      .then(enqueue("r2", "proactive", true, "nyc", false))
      .then(decide("w1", "r2", false, false)).then(applyDecision("w1", false))
      .expect(rows.get("r2").status == "held_awaiting_reply")
      .then(unlockLine("w1")).then(flush("w1"))
      .then(tick(72)).then(tick(72)).then(tick(72)).then(tick(72)).then(tick(1))
      .then(drainStart("w1", "nyc", false)).then(sweepCollected("w1")).then(lockLine("w1"))
      .expect(rows.get("r2").status == "expired" and not(slots.contains("r2")) and safety)

  // ------------------------------------------------------------------ witnesses (each must be violated)
  val witness_proactiveAccepted = not(ROWS.exists(r => rows.get(r).kind == "proactive" and rows.get(r).status == "accepted"))
  val witness_deferredThenSent = not(ROWS.exists(r => ghost.get(r).wasDeferred and rows.get(r).status == "accepted"))
  val witness_parkedReleased = not(ROWS.exists(r => ghost.get(r).wasParked and rows.get(r).leakReleased))
  // A leave of this app (no STOP-wide opt-out in the ledger) refuses a row: the consent input is more than one STOP.
  val witness_leaveRefuses = not(ROWS.exists(r => rows.get(r).status == "refused_opted_out")
    and not(env.ledger.indices().exists(i => env.ledger[i].scope == "all" and env.ledger[i].state == "opted_out")))
  val witness_collectedSent = not(ROWS.exists(r => rows.get(r).status == "sent" and rows.get(r).sentAt))
  val witness_stopRefuses = not(ROWS.exists(r => rows.get(r).status == "refused_opted_out"))
  val witness_unknownLookedUp = not(ROWS.exists(r => rows.get(r).status == "accepted" and rows.get(r).doubt))
}
```
