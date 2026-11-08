// quint-check: max-steps=30 max-samples=20000 verify-steps=6
//
// The signed turn, the consent ledger, its projections and the gateway's consent mirror
// (docs/research/2026-11-07-state-machines.md section 6.2, machines M-001..M-013, M-106..M-111).
//
// The model follows the code as it is now (branch base ad67275):
//   packages/network/service/inbox.ts        Inbox.signed (claim, lease, rescueCompliance), handleWaiting, purge, resolve
//   packages/network/service/service.ts      NetworkService.inbound (1006-1154), stop (1317-1350), stopHint (1156-1165),
//                                            join (1384-1465), sharedTurn (1976-2125), sharedAction signals (1950-1960)
//   packages/platform/src/consent.ts         resolveConsent, keywordEvent, leaveTarget, detectKeyword
//   packages/platform/src/accounts.ts        leave (421-429), activeMembership (319-329)
//   packages/platform/src/pg-store.ts        addConsent (idempotent per ref), hit (rate window), purge (2-day rows)
//
// Abstraction.
//   - One sender (one phone, one person). Two apps "A" and "B" (for example slop and friends). Four message ids.
//     One sender is enough for every per-sender rule: the claim, the sweep and the drain are per sender.
//   - Time is an integer tick of 30 s. LEASE, BLOCK, DAY and the purge windows are named constants.
//   - One SQL transaction is one action. Each await between two transactions is a point where the
//     worker can crash, throw, lose its lease, or another actor (the gateway retry, the drain, staff,
//     the purge) can run.
//   - Readers are oracles. The message kind is chosen when the person sends it: "Stop" is a text that
//     detectKeyword reads as STOP; "StopLikely" is a text the person means as STOP that the reader does
//     not read as STOP (SD-031: "STOP STOP"). The routing decision (service.ts:957) is an oracle too.
//   - Gateway assumptions (upstream code, not in this repository): the gateway retries a retryable answer
//     and a timed-out request with the same messageId; it stops at a final answer; it copies a handled
//     turn's `consent` into its send-time fence and resolves the fence by `at` like the ledger does
//     (the SD-037 verifier reports that the fence is not affected by a late START, which needs this);
//     it sends the collected replies only when the fence lets the app send.
//   - The Network's reply to a member is an oracle; the Network refuses replies to a member whose
//     network row is opted out (network.ts:1992, 4221), so the reply depends on the projection, not
//     on the ledger.
module turn_consent {
  // ------------------------------------------------------------------ constants
  pure val APPS: Set[str] = Set("A", "B")
  pure val MSGS: Set[int] = Set(1, 2, 3, 4)
  pure val KINDS: Set[str] = Set("Stop", "StopLikely", "Start", "Help", "Leave", "Join", "Chat")
  pure val TICK_STEPS: Set[int] = Set(1, 5, 21, 2 * DAY + 1, 8 * DAY, 31 * DAY)
  /** inbox.ts:42 PROCESSING_LEASE_MS = 2 min. */
  pure val LEASE: int = 4
  /** inbox.ts:46 UNRESOLVED_BLOCK_MS = 10 min. */
  pure val BLOCK: int = 20
  pure val DAY: int = 2880
  /** service.ts:1160 stop hint gap: 30 days. */
  pure val HINT_GAP: int = 30 * DAY
  /** service.ts:572 people.purge(now - 2 days): rate_limits rows (pg-store.ts:286). */
  pure val RATE_KEEP: int = 2 * DAY
  /** service.ts:574 inbox.purge(now - 7 days). */
  pure val INBOX_KEEP: int = 7 * DAY
  /** inbox.ts:48 TOMBSTONE_KEEP_MS = 30 days. */
  pure val TOMBSTONE_KEEP: int = 30 * DAY
  /** inbox.ts:32 MAX_ATTEMPTS. */
  pure val MAX_ATTEMPTS: int = 5

  // ------------------------------------------------------------------ types
  /** A consent event. app "" = every app (global). ref -1 = no ref. src: stop, start, leave, join, init, echo. */
  type Ev = { app: str, state: str, at: int, seq: int, ref: int, src: str }
  /** TurnResponse.consent (contract.ts). has=false: no consent field. scope "all" or "app". */
  type Consent = { has: bool, state: str, scope: str, app: str, at: int }
  /** A message the person sent. app: the routed app, or the target of Leave and Join. path: "gw" signed turn, "wh" legacy webhook. */
  type Msg = { kind: str, app: str, path: str, at: int }
  /** The answer to one /internal/turn call. kind: handled, open, err. */
  type Resp = { kind: str, err: str, retry: bool, consent: Consent, replies: Set[str], app: str, ctx: int }
  /** platform.inbound row. st: processing, done, unresolved (signed); pending, done, failed (legacy). mine: sender_hash set. lease: arrived_at. */
  type Row = { st: str, lease: int, attempts: int, resp: Resp, mine: bool }
  /** The worker of one claimed signed turn (the InboundTurn object and its async stack). */
  type Worker = { alive: bool, phase: int, todo: Set[str], consent: Consent, replies: Set[str], conf: bool, open: bool }
  /** Gateway state per message: call (must call), wait (a request is in flight), final. */
  type Gw = { st: str, ans: Resp }
  type World = {
    ledger: Set[Ev], fence: Set[Ev], seq: int,
    member: str -> str, optOut: str -> bool, pendingJoin: str,
    hintLast: str -> int, hintLog: str -> Set[int],
    signals: int -> str, staffHandled: Set[int], ctx: int
  }
  /** Ghost facts the invariants read. intents: the consent intents ordered by the person's send time (README "Consent order"). */
  type Ghost = {
    echoBad: bool, busyKw: bool, bannedReply: bool, leaveOptIn: bool, actedAfterStop: bool,
    doneErr: bool, replyAfterStop: bool, crashes: int, intents: Set[Ev]
  }

  pure val NOC: Consent = { has: false, state: "", scope: "", app: "", at: 0 }
  pure val NORESP: Resp = { kind: "none", err: "", retry: false, consent: NOC, replies: Set(), app: "", ctx: 0 }

  // ------------------------------------------------------------------ state
  var now: int
  var sent: int -> Msg
  var gw: int -> Gw
  var rows: int -> Row
  var workers: int -> Worker
  var w: World
  var g: Ghost
  /** A banned number (platform.bans). Fixed per run. */
  var banned: bool
  /** A recycled-number hold (phone_identities.hold). Fixed per run. */
  var held: bool

  // ------------------------------------------------------------------ pure helpers
  /** The last event of a set by (at, seq): consent.ts lastEvents, pg-store.ts lastConsent (order by at desc, id desc). */
  pure def lastOf(evs: Set[Ev]): Set[Ev] =
    evs.filter(e => evs.forall(f => f.at < e.at or (f.at == e.at and f.seq <= e.seq)))

  /** consent.ts:37-43 resolveConsent. "in", "out" or "none". */
  pure def resolve(evs: Set[Ev], a: str): str = {
    val la = lastOf(evs.filter(e => e.app == a))
    val lg = lastOf(evs.filter(e => e.app == ""))
    if (la.size() == 0) { if (lg.exists(e => e.state == "out")) "out" else "none" }
    else if (lg.size() == 0 or lg.exists(e => e.state == "in")) { if (la.exists(e => e.state == "in")) "in" else "out" }
    else if (la.exists(e => e.state == "in" and lg.forall(x => e.at > x.at))) "in"
    else "out"
  }
  pure def isOut(evs: Set[Ev], a: str): bool = resolve(evs, a) == "out"

  /** inbox.ts:36 isComplianceText: STOP, STOP ALL, START, HELP or "leave <app>". StopLikely is not read as one. */
  pure def isKeyword(kind: str): bool = kind == "Stop" or kind == "Start" or kind == "Help" or kind == "Leave"

  pure def live(wd: World, a: str): bool = a.in(APPS) and (wd.member.get(a) == "active" or wd.member.get(a) == "paused")

  /** pg-store.ts:131 addConsent: on conflict (e164, ref) where ref is not null do nothing. */
  pure def addConsent(wd: World, e: Ev): World =
    if (e.ref >= 0 and wd.ledger.exists(x => x.ref == e.ref and x.src == e.src)) wd
    else { ...wd, ledger: wd.ledger.union(Set({ ...e, seq: wd.seq })), seq: wd.seq + 1 }

  pure def addIntent(gh: Ghost, wd: World, e: Ev): Ghost =
    if (e.ref >= 0 and gh.intents.exists(x => x.ref == e.ref and x.src == e.src)) gh
    else { ...gh, intents: gh.intents.union(Set({ ...e, seq: wd.seq })) }

  /**
   * service.ts:1156-1165 stopHint: the routed app resolves opted_out, the number is not banned:
   * hit(stop_hint:<app>, 30 days, minGapMs 30 days) reads max(last_at) of the bucket (pg-store.ts:229-241).
   */
  pure def hint(wd: World, a: str, t: int, isBanned: bool): { wd: World, sent: bool } =
    if (not(a.in(APPS)) or resolve(wd.ledger, a) != "out" or isBanned) { wd: wd, sent: false }
    else if (wd.hintLast.get(a) >= 0 and t - wd.hintLast.get(a) < HINT_GAP) { wd: wd, sent: false }
    else { wd: { ...wd, hintLast: wd.hintLast.set(a, t), hintLog: wd.hintLog.set(a, wd.hintLog.get(a).union(Set(t))) }, sent: true }

  type StepOut = { wd: World, gh: Ghost, wk: Worker }

  /**
   * One transaction of a turn's effects (NetworkService.inbound), chosen by the message kind and the
   * worker's phase. phase 9 = effects done, the turn can complete. `t`: now. `cat`: the consent time
   * (consentAt: the gateway's receivedAt in a signed turn, now on the legacy path). `c1`, `c2`: oracle choices.
   */
  pure def phaseStep(wd: World, gh: Ghost, wk: Worker, msg: Msg, m: int, t: int, cat: int,
                     isBanned: bool, isHeld: bool, c1: bool, c2: bool): StepOut = {
    val a = msg.app
    if (msg.kind == "Stop") {
      if (wk.phase == 0) {
        // service.ts:1319-1326: keywordEvent (global on the shared line), recordConsent once per ref, turn.consent, turn.confirmation.
        val e = { app: "", state: "out", at: cat, seq: 0, ref: m, src: "stop" }
        // Under a phone hold, memberOf and personFor are undefined: the STOP reaches the ledger only (service.ts:1320-1342).
        { wd: addConsent(wd, e), gh: addIntent(gh, wd, e),
          wk: { ...wk, phase: 1, todo: if (isHeld) Set() else APPS.filter(x => live(wd, x)),
                consent: { has: true, state: "out", scope: "all", app: "", at: cat }, conf: true } }
      } else if (wk.phase == 1 and wk.todo.size() > 0) {
        // service.ts:801-818 stopped(), one unit of work per member: membership paused, member opted out.
        val x = if (wk.todo.contains("A")) "A" else "B"
        { wd: { ...wd,
                member: if (wd.member.get(x) == "active") wd.member.set(x, "paused") else wd.member,
                optOut: wd.optOut.set(x, true) },
          gh: gh, wk: { ...wk, todo: wk.todo.exclude(Set(x)) } }
      } else {
        // service.ts:1330-1332: the confirmation is collected (memberMessage or direct).
        { wd: wd, gh: gh, wk: { ...wk, phase: 9, replies: wk.replies.union(Set("compliance")) } }
      }
    } else if (msg.kind == "Start") {
      if (isHeld or isBanned) {
        // service.ts:1062-1066 (hold), 1101-1102 and 1131-1132 (ban): "held", no event.
        { wd: wd, gh: gh, wk: { ...wk, phase: 9 } }
      } else if (live(wd, a)) {
        if (wk.phase == 0) {
          // service.ts:1105 recordConsent(app, opted_in, at = receivedAt, ref).
          val e = { app: a, state: "in", at: cat, seq: 0, ref: m, src: "start" }
          { wd: addConsent(wd, e), gh: addIntent(gh, wd, e), wk: { ...wk, phase: 1 } }
        } else if (resolve(wd.ledger, a) != "in") {
          // service.ts:1107: an older START than the last STOP: handled, no consent, no reply.
          { wd: wd, gh: gh, wk: { ...wk, phase: 9 } }
        } else {
          // service.ts:1108-1110 and memberUnit START: turn.consent, membership paused -> active, member opted in, welcome back.
          // Only the routed app (SD-024).
          { wd: { ...wd, member: if (wd.member.get(a) == "paused") wd.member.set(a, "active") else wd.member, optOut: wd.optOut.set(a, false) },
            gh: gh,
            wk: { ...wk, phase: 9, consent: { has: true, state: "in", scope: "app", app: a, at: cat }, replies: wk.replies.union(Set("reply")) } }
        }
      } else {
        // service.ts:1131-1137: a non-member START: recordConsent and turn.consent with no check (SD-037), then the join ask.
        val e = { app: a, state: "in", at: cat, seq: 0, ref: m, src: "start" }
        val wd1 = addConsent(wd, e)
        { wd: wd1, gh: addIntent(gh, wd, e),
          wk: { ...wk, phase: 9, consent: { has: true, state: "in", scope: "app", app: a, at: cat }, replies: wk.replies.union(Set("reply")) } }
      }
    } else if (msg.kind == "Help") {
      { wd: wd, gh: gh, wk: { ...wk, phase: 9, replies: wk.replies.union(Set("compliance")) } }
    } else if (msg.kind == "Leave" and (wk.phase > 0 or (live(wd, a) and not(isHeld)))) {
      if (wk.phase == 0) {
        // accounts.ts:421-425 leave: addConsent(app, opted_out, at = now, no ref) (SD-105).
        val e = { app: a, state: "out", at: t, seq: 0, ref: -1, src: "leave" }
        { wd: addConsent(wd, e), gh: addIntent(gh, wd, { ...e, at: msg.at, ref: m }), wk: { ...wk, phase: 1 } }
      } else if (wk.phase == 1) {
        // accounts.ts:426-428: onForget, forgetMembership: the membership is removed.
        { wd: { ...wd, member: wd.member.set(a, "removed") }, gh: gh, wk: { ...wk, phase: 2 } }
      } else {
        // service.ts:1090-1091: turn.consent (at = now), turn.confirmation, the confirmation collected.
        { wd: wd, gh: gh, wk: { ...wk, phase: 9, conf: true,
            consent: { has: true, state: "out", scope: "app", app: a, at: t }, replies: wk.replies.union(Set("compliance")) } }
      }
    } else {
      // Join, Chat, StopLikely, and a Leave that falls through (not a member of the app: service.ts:1085 `lrt && lid`).
      val target = a
      if (isHeld) {
        // service.ts:1062-1066: a held number gets nothing.
        { wd: wd, gh: gh, wk: { ...wk, phase: 9 } }
      } else if (msg.kind == "Leave" and wd.pendingJoin != "" and APPS.forall(x => not(live(wd, x))) and not(isBanned)) {
        // SD-490: route() sends the text to the pending join (service.ts:972-973); join() reads the name "Leave",
        // takes the pending age and joins (service.ts:1437-1447): membership, opt-in event, member.
        val pj = wd.pendingJoin
        val e = { app: pj, state: "in", at: cat, seq: 0, ref: m, src: "join" }
        { wd: { ...addConsent(wd, e), member: wd.member.set(pj, "active"), optOut: wd.optOut.set(pj, false), pendingJoin: "" },
          gh: { ...addIntent(gh, wd, e), leaveOptIn: true },
          wk: { ...wk, phase: 9, replies: wk.replies.union(Set("reply")) } }
      } else if ((msg.kind == "Join" or msg.kind == "Leave") and not(live(wd, target))) {
        if (isBanned) { wd: wd, gh: gh, wk: { ...wk, phase: 9 } }
        else if (msg.kind == "Join" and c1) {
          // service.ts:1438-1449: joined: membership active, opt-in event at consentAt (no turn.consent: SD-023), member, welcome.
          val e = { app: target, state: "in", at: cat, seq: 0, ref: m, src: "join" }
          { wd: { ...addConsent(wd, e), member: wd.member.set(target, "active"), optOut: wd.optOut.set(target, false), pendingJoin: "" },
            gh: addIntent(gh, wd, e), wk: { ...wk, phase: 9, replies: wk.replies.union(Set("reply")) } }
        } else {
          // service.ts:1406-1413: the join ask; a stated age is kept in pending_texts (c2).
          val h = hint(wd, target, t, isBanned)
          { wd: { ...h.wd, pendingJoin: if (msg.kind == "Join" and c2) target else h.wd.pendingJoin },
            gh: gh, wk: { ...wk, phase: 9, replies: wk.replies.union(if (h.sent) Set("reply", "compliance") else Set("reply")) } }
        }
      } else if (live(wd, target)) {
        // service.ts:1123-1127: stopHint, then the member's unit of work. The Network answers only a member whose row is not opted out.
        val h = hint(wd, target, t, isBanned)
        val netReply = c1 and not(wd.optOut.get(target))
        { wd: h.wd,
          gh: { ...gh, bannedReply: gh.bannedReply or (isBanned and netReply) },
          wk: { ...wk, phase: 9, open: not(netReply),
                replies: wk.replies.union(if (h.sent) Set("compliance") else Set()).union(if (netReply) Set("reply") else Set()) } }
      } else if (isBanned) {
        { wd: wd, gh: gh, wk: { ...wk, phase: 9 } }
      } else {
        // A non-member's text: the join ask (service.ts:1145-1152), then stopHint.
        val h = hint(wd, target, t, isBanned)
        { wd: h.wd, gh: gh, wk: { ...wk, phase: 9, replies: wk.replies.union(if (h.sent) Set("reply", "compliance") else Set("reply")) } }
      }
    }
  }

  /** True when the next phase collects a reply into platform.inbound (Inbox.collect throws on a sealed row). */
  pure def collects(wd: World, wk: Worker, msg: Msg, isHeld: bool): bool =
    if (msg.kind == "Stop") wk.phase == 1 and wk.todo.size() == 0
    else if (msg.kind == "Leave" and (wk.phase > 0 or (live(wd, msg.app) and not(isHeld)))) wk.phase == 2
    else if (msg.kind == "Start" and live(wd, msg.app)) wk.phase == 1
    else true

  pure def newWorker: Worker = { alive: true, phase: 0, todo: Set(), consent: NOC, replies: Set(), conf: false, open: false }

  pure def mapRemove(mp: int -> Row, k: int): int -> Row = mp.keys().exclude(Set(k)).mapBy(x => mp.get(x))
  pure def wkRemove(mp: int -> Worker, k: int): int -> Worker = mp.keys().exclude(Set(k)).mapBy(x => mp.get(x))

  // ------------------------------------------------------------------ derived state
  def workerAlive(m: int): bool = workers.keys().contains(m) and workers.get(m).alive
  def isFinal(m: int): bool =
    if (sent.get(m).path == "gw") gw.get(m).st == "final"
    else rows.keys().contains(m) and rows.get(m).st != "pending"
  /** Nothing in flight: every gateway message has its final answer, no legacy row waits, no worker runs. */
  def quiescent: bool = sent.keys().forall(m => isFinal(m)) and workers.keys().forall(m => not(workers.get(m).alive))
  def onlyGateway: bool = sent.keys().forall(m => sent.get(m).path == "gw")

  // ------------------------------------------------------------------ init
  action initWith(ma: str, mb: str, isBanned: bool, isHeld: bool): bool = {
    val mem = Map("A" -> ma, "B" -> mb)
    val evs = APPS.filter(a => mem.get(a) == "active")
    // A web or text join wrote an opt-in for each live membership (accounts.ts:384, service.ts:1447).
    val ledger0 = Set({ app: "A", state: "in", at: 0, seq: 0, ref: -1, src: "init" }, { app: "B", state: "in", at: 0, seq: 1, ref: -1, src: "init" })
      .filter(e => e.app.in(evs))
    all {
      now' = 1,
      sent' = Map(),
      gw' = Map(),
      rows' = Map(),
      workers' = Map(),
      w' = { ledger: ledger0, fence: Set(), seq: 2, member: mem, optOut: Map("A" -> false, "B" -> false), pendingJoin: "",
             hintLast: Map("A" -> -1, "B" -> -1), hintLog: Map("A" -> Set(), "B" -> Set()),
             signals: Map(), staffHandled: Set(), ctx: 0 },
      g' = { echoBad: false, busyKw: false, bannedReply: false, leaveOptIn: false, actedAfterStop: false,
             doneErr: false, replyAfterStop: false, crashes: 0, intents: ledger0 },
      banned' = isBanned,
      held' = isHeld,
    }
  }

  action init = {
    nondet ma = Set("active", "none").oneOf()
    nondet mb = Set("active", "none").oneOf()
    // A banned number and a held number are each one run in four.
    nondet bn = 0.to(3).oneOf()
    nondet hd = 0.to(3).oneOf()
    initWith(ma, mb, bn == 0, hd == 0)
  }

  // ------------------------------------------------------------------ actions
  /** The person sends a text. The gateway receives it (receivedAt = now) or, on the legacy path, the webhook stores a pending row (inbox.ts:175-185). */
  action sendText(m: int, kind: str, app: str, path: str): bool = all {
    m.in(MSGS), not(sent.keys().contains(m)),
    sent' = sent.put(m, { kind: kind, app: app, path: path, at: now }),
    gw' = if (path == "gw") gw.put(m, { st: "call", ans: NORESP }) else gw,
    rows' = if (path == "wh") rows.put(m, { st: "pending", lease: now, attempts: 0, resp: NORESP, mine: true }) else rows,
    now' = now, workers' = workers, w' = w, g' = g, banned' = banned, held' = held,
  }

  /** The gateway delivers a final answer: it mirrors `consent` into its fence, then sends the replies the fence allows. */
  pure def deliverTo(wd: World, gh: Ghost, resp: Resp, m: int): { wd: World, gh: Ghost } = {
    val c = resp.consent
    val fence1 = if (resp.kind == "handled" and c.has)
      wd.fence.union(Set({ app: if (c.scope == "all") "" else c.app, state: c.state, at: c.at, seq: wd.seq, ref: m, src: "echo" }))
      else wd.fence
    val wd1 = { ...wd, fence: fence1, seq: wd.seq + 1 }
    val leaks = resp.kind == "handled" and resp.replies.contains("reply") and resp.app.in(APPS)
      and not(isOut(fence1, resp.app)) and isOut(wd.ledger, resp.app)
    { wd: wd1, gh: { ...gh, replyAfterStop: gh.replyAfterStop or leaks } }
  }

  /**
   * POST /internal/turn: the claim transaction (inbox.ts:86-99) and the answer to a refused claim (inbox.ts:100-107).
   * The sweep of stale processing rows commits in the same transaction even when nothing is inserted.
   */
  action gwCall(m: int): bool = all {
    sent.keys().contains(m), sent.get(m).path == "gw", gw.get(m).st == "call",
    val msg = sent.get(m)
    val kw = isKeyword(msg.kind)
    // inbox.ts:92-93 the sweep.
    val swept = rows.keys().mapBy(k => {
      val r = rows.get(k)
      if (r.mine and r.st == "processing" and r.lease < now - LEASE) { ...r, st: "unresolved" } else r
    })
    // inbox.ts:94-98 the insert guard.
    val blocked = swept.keys().exists(k => swept.get(k).mine and (swept.get(k).st == "processing"
      or (not(kw) and (swept.get(k).st == "pending" or (swept.get(k).st == "unresolved" and swept.get(k).lease > now - BLOCK)))))
    val insert = not(swept.keys().contains(m)) and not(blocked)
    if (insert) all {
      rows' = swept.put(m, { st: "processing", lease: now, attempts: 0, resp: NORESP, mine: true }),
      workers' = workers.put(m, newWorker),
      gw' = gw.set(m, { st: "wait", ans: NORESP }),
      w' = w, g' = g,
    } else {
      val ans: Resp =
        if (not(swept.keys().contains(m))) { ...NORESP, kind: "err", err: "turn_busy", retry: true }
        else if (swept.get(m).st == "done") swept.get(m).resp
        else if (swept.get(m).st == "processing") { ...NORESP, kind: "err", err: "turn_busy", retry: true }
        else { ...NORESP, kind: "err", err: "turn_unresolved", retry: false }
      // service.ts:2093-2099: a replayed open turn whose context changed is a final 409 (SD-313).
      val ans2: Resp = if (ans.kind == "open" and ans.ctx != w.ctx) { ...NORESP, kind: "err", err: "turn_context_changed", retry: false } else ans
      val d = deliverTo(w, g, ans2, m)
      all {
        rows' = swept, workers' = workers,
        gw' = gw.set(m, { st: if (ans2.kind == "err" and ans2.retry) "call" else "final", ans: ans2 }),
        w' = if (ans2.kind == "err") w else d.wd,
        g' = {
          ...(if (ans2.kind == "err") g else d.gh),
          // inbox.ts:19 "STOP, START and HELP are never held back" (inbox.ts:19-20, 84-85): refused only because another row of the sender holds the claim.
          busyKw: g.busyKw or (kw and not(swept.keys().contains(m))),
          doneErr: g.doneErr or (swept.keys().contains(m) and swept.get(m).st == "done" and ans2.kind == "err"),
        },
      }
    },
    now' = now, sent' = sent, banned' = banned, held' = held,
  }

  /** The gateway's request times out (8 s) while the worker may still run; it calls again with the same messageId. */
  action gwTimeout(m: int): bool = all {
    gw.keys().contains(m), gw.get(m).st == "wait",
    gw' = gw.set(m, { st: "call", ans: NORESP }),
    now' = now, sent' = sent, rows' = rows, workers' = workers, w' = w, g' = g, banned' = banned, held' = held,
  }

  /** One transaction of the turn's effects. A step that collects a reply needs the row still processing (inbox.ts:166-171). */
  action work(m: int, c1: bool, c2: bool): bool = all {
    workerAlive(m), workers.get(m).phase < 9,
    val msg = sent.get(m)
    val wk = workers.get(m)
    all {
      not(collects(w, wk, msg, held)) or (rows.keys().contains(m) and rows.get(m).st == "processing"),
      val out = phaseStep(w, g, wk, msg, m, now, msg.at, banned, held, c1, c2)
      all { w' = out.wd, g' = out.gh, workers' = workers.set(m, out.wk) },
    },
    now' = now, sent' = sent, gw' = gw, rows' = rows, banned' = banned, held' = held,
  }

  /** inbox.ts:111-114: the lease renewal (every 30 s; a failure is swallowed, so a renewal can be missed). */
  action renew(m: int): bool = all {
    workerAlive(m), rows.keys().contains(m), rows.get(m).st == "processing",
    rows' = rows.set(m, { ...rows.get(m), lease: now }),
    now' = now, sent' = sent, gw' = gw, workers' = workers, w' = w, g' = g, banned' = banned, held' = held,
  }

  /** The process stops (deploy, OOM): the worker and its in-memory turn are gone; the row stays processing. */
  action crash(m: int): bool = all {
    workerAlive(m), g.crashes < 1,
    workers' = workers.set(m, { ...workers.get(m), alive: false }),
    g' = { ...g, crashes: g.crashes + 1 },
    now' = now, sent' = sent, gw' = gw, rows' = rows, w' = w, banned' = banned, held' = held,
  }

  /** Send the worker's answer to the gateway request that waits for it, or lose it (the request timed out). */
  pure def answer(gws: int -> Gw, wd: World, gh: Ghost, m: int, resp: Resp, lost: bool): { gws: int -> Gw, wd: World, gh: Ghost } =
    if (lost or gws.get(m).st != "wait") { gws: gws, wd: wd, gh: gh }
    else {
      val d = deliverTo(wd, gh, resp, m)
      { gws: gws.set(m, { st: if (resp.kind == "err" and resp.retry) "call" else "final", ans: resp }),
        wd: if (resp.kind == "err") wd else d.wd, gh: if (resp.kind == "err") gh else d.gh }
    }

  /**
   * The turn throws (inbox.ts:121-129). A compliance turn is rescued (rescueCompliance, inbox.ts:144-163): with no consent
   * and no collected reply the claim is released (turn_failed, retryable); otherwise it ends handled with its consent and
   * confirmation. Any other turn, and a compliance turn whose row is no longer processing, is unresolved (turn_unresolved).
   */
  action throwIn(m: int, lost: bool): bool = all {
    workerAlive(m),
    val msg = sent.get(m)
    val wk = workers.get(m)
    val proc = rows.keys().contains(m) and rows.get(m).st == "processing"
    val kw = isKeyword(msg.kind)
    val release = kw and proc and not(wk.consent.has) and wk.replies.size() == 0
    val partial = kw and proc and not(release)
    val reps1 = if (wk.conf) wk.replies.union(Set("compliance")) else wk.replies
    val resp: Resp =
      if (release) { ...NORESP, kind: "err", err: "turn_failed", retry: true }
      else if (partial) { ...NORESP, kind: "handled", consent: wk.consent, replies: reps1, app: msg.app }
      else { ...NORESP, kind: "err", err: "turn_unresolved", retry: false }
    val a = answer(gw, w, g, m, resp, lost)
    all {
      rows' = if (release) mapRemove(rows, m)
              else if (partial) rows.set(m, { ...rows.get(m), st: "done", resp: resp, lease: now })
              else if (proc) rows.set(m, { ...rows.get(m), st: "unresolved" })
              else rows,
      workers' = wkRemove(workers, m),
      gw' = a.gws, w' = a.wd,
      g' = { ...a.gh, echoBad: a.gh.echoBad or (partial and wk.consent.has and not(echoOk(w.ledger, wk.consent))) },
    },
    now' = now, sent' = sent, banned' = banned, held' = held,
  }

  /** TurnResponse.consent agrees with the resolved ledger when the turn answers. */
  pure def echoOk(ledger: Set[Ev], c: Consent): bool =
    if (c.scope == "all") APPS.forall(a => resolve(ledger, a) == c.state) else resolve(ledger, c.app) == c.state

  /**
   * The turn completes (inbox.ts:116-120, service.ts:2067-2104): done where processing, with the response. An open
   * turn needs no collected reply, an active membership with an opt-in and a context (ctxOk is the oracle for
   * sharedContext: facets, names and the leak check, SD-212/215/216). A row that is no longer processing throws.
   */
  action complete(m: int, lost: bool, ctxOk: bool): bool = all {
    workerAlive(m), workers.get(m).phase == 9,
    val msg = sent.get(m)
    val wk = workers.get(m)
    val proc = rows.keys().contains(m) and rows.get(m).st == "processing"
    val a = msg.app
    val openOk = wk.open and wk.replies.size() == 0 and a.in(APPS) and w.member.get(a) == "active" and not(banned) and not(held)
      and resolve(w.ledger, a) == "in" and ctxOk
    val resp: Resp =
      if (not(proc)) { ...NORESP, kind: "err", err: "turn_unresolved", retry: false }
      else if (openOk) { ...NORESP, kind: "open", app: a, ctx: w.ctx }
      else { ...NORESP, kind: "handled", consent: wk.consent, replies: wk.replies, app: a }
    val ans = answer(gw, w, g, m, resp, lost)
    all {
      rows' = if (proc) rows.set(m, { ...rows.get(m), st: "done", resp: resp, lease: now }) else rows,
      workers' = wkRemove(workers, m),
      gw' = ans.gws, w' = ans.wd,
      g' = { ...ans.gh, echoBad: ans.gh.echoBad or (proc and wk.consent.has and not(echoOk(w.ledger, wk.consent))) },
    },
    now' = now, sent' = sent, banned' = banned, held' = held,
  }

  /**
   * The legacy webhook drain (inbox.ts:243-282): compliance first, else the oldest row; ordinary rows wait while a
   * signed turn of the sender runs or ended unresolved a short while ago. A failure counts an attempt; at 5 the row is
   * failed, a STOP too (SD-129). A handled STOP cancels the ordinary rows received before it. The effects run as one
   * step at consent time = now (service.ts:1356-1359), with no gateway and no fence.
   */
  action drain(m: int, failed: bool, c1: bool, c2: bool): bool = all {
    rows.keys().contains(m), rows.get(m).st == "pending",
    val pend = rows.keys().filter(k => rows.get(k).st == "pending")
    val comp = pend.filter(k => isKeyword(sent.get(k).kind))
    val pool = if (comp.size() > 0) comp else pend
    val first = pool.forall(k => sent.get(m).at < sent.get(k).at or (sent.get(m).at == sent.get(k).at and m <= k))
    val waitSigned = rows.keys().exists(k => rows.get(k).mine and sent.get(k).path == "gw"
      and ((rows.get(k).st == "processing" and rows.get(k).lease > now - LEASE) or (rows.get(k).st == "unresolved" and rows.get(k).lease > now - BLOCK)))
    val msg = sent.get(m)
    all {
      m.in(pool), first, comp.size() > 0 or not(waitSigned),
      if (failed) {
        val n = rows.get(m).attempts + 1
        all {
          rows' = rows.set(m, { ...rows.get(m), attempts: n, st: if (n >= MAX_ATTEMPTS) "failed" else "pending" }),
          w' = w, g' = g,
        }
      } else {
        val s1 = phaseStep(w, g, newWorker, msg, m, now, now, banned, held, c1, c2)
        val s2 = if (s1.wk.phase < 9) phaseStep(s1.wd, s1.gh, s1.wk, msg, m, now, now, banned, held, c1, c2) else s1
        val s3 = if (s2.wk.phase < 9) phaseStep(s2.wd, s2.gh, s2.wk, msg, m, now, now, banned, held, c1, c2) else s2
        val s4 = if (s3.wk.phase < 9) phaseStep(s3.wd, s3.gh, s3.wk, msg, m, now, now, banned, held, c1, c2) else s3
        val s5 = if (s4.wk.phase < 9) phaseStep(s4.wd, s4.gh, s4.wk, msg, m, now, now, banned, held, c1, c2) else s4
        val cancel = if (msg.kind == "Stop") pend.filter(k => k != m and not(isKeyword(sent.get(k).kind)) and sent.get(k).at <= msg.at) else Set()
        // inbox.ts:10-14: nothing the person wrote before a STOP is acted on after it.
        val late = not(isKeyword(msg.kind)) and sent.keys().exists(k => sent.get(k).kind == "Stop" and sent.get(k).at > msg.at
          and w.ledger.exists(e => e.ref == k and e.src == "stop"))
        all {
          rows' = rows.keys().mapBy(k =>
            if (k == m) { ...rows.get(k), st: "done", lease: now }
            else if (k.in(cancel)) { ...rows.get(k), st: "done", lease: now }
            else rows.get(k)),
          w' = s5.wd,
          g' = { ...s5.gh, actedAfterStop: s5.gh.actedAfterStop or late },
        }
      },
    },
    now' = now, sent' = sent, gw' = gw, workers' = workers, banned' = banned, held' = held,
  }

  /** Staff resolve a stuck signed turn (inbox.ts:211-215): unresolved, no longer the sender's. */
  action staffResolve(m: int): bool = all {
    rows.keys().contains(m), sent.get(m).path == "gw", rows.get(m).st.in(Set("processing", "unresolved")), rows.get(m).mine,
    rows' = rows.set(m, { ...rows.get(m), st: "unresolved", mine: false }),
    now' = now, sent' = sent, gw' = gw, workers' = workers, w' = w, g' = g, banned' = banned, held' = held,
  }

  /**
   * The tick's retention (service.ts:568-578): people.purge(now - 2 days) deletes rate_limits rows by last_at
   * (pg-store.ts:286), the stop-hint bucket included (SD-004); inbox.purge(now - 7 days) seals done signed rows, deletes
   * handled legacy rows and old tombstones (inbox.ts:197-206). It never touches a processing row (SD-087).
   */
  action purge: bool = all {
    val before = now - INBOX_KEEP
    val kept = rows.keys().filter(k => not(
      (sent.get(k).path == "wh" and rows.get(k).st.in(Set("done", "failed")) and rows.get(k).lease < before)
      or (sent.get(k).path == "gw" and rows.get(k).st == "unresolved" and rows.get(k).lease < before - TOMBSTONE_KEEP)))
    all {
      rows' = kept.mapBy(k => {
        val r = rows.get(k)
        if (sent.get(k).path == "gw" and r.st == "done" and r.lease < before) { ...r, st: "unresolved", resp: NORESP, mine: false } else r
      }),
      w' = { ...w, hintLast: APPS.mapBy(a => if (w.hintLast.get(a) >= 0 and w.hintLast.get(a) < now - RATE_KEEP) -1 else w.hintLast.get(a)) },
    },
    now' = now, sent' = sent, gw' = gw, workers' = workers, g' = g, banned' = banned, held' = held,
  }

  /** The agent records an opt_out or safety_concern signal on an open turn (service.ts:1950-1960): status proposed. */
  action proposeSignal(m: int): bool = all {
    rows.keys().contains(m), rows.get(m).st == "done", rows.get(m).resp.kind == "open", not(w.signals.keys().contains(m)),
    w' = { ...w, signals: w.signals.put(m, "proposed") },
    now' = now, sent' = sent, gw' = gw, rows' = rows, workers' = workers, g' = g, banned' = banned, held' = held,
  }

  /** Staff read GET /signals (service.ts:2276-2280) and act. No route changes the facet status (SD-036). */
  action staffHandle(m: int): bool = all {
    w.signals.keys().contains(m), w.signals.get(m) == "proposed", not(w.staffHandled.contains(m)),
    w' = { ...w, staffHandled: w.staffHandled.union(Set(m)) },
    now' = now, sent' = sent, gw' = gw, rows' = rows, workers' = workers, g' = g, banned' = banned, held' = held,
  }

  /** The member's open-turn context changes (a facet, an item, a window edge). */
  action contextChange: bool = all {
    w.ctx < 2,
    w' = { ...w, ctx: w.ctx + 1 },
    now' = now, sent' = sent, gw' = gw, rows' = rows, workers' = workers, g' = g, banned' = banned, held' = held,
  }

  action tick(d: int): bool = all {
    now' = now + d,
    sent' = sent, gw' = gw, rows' = rows, workers' = workers, w' = w, g' = g, banned' = banned, held' = held,
  }

  /** The scheduler. Sets cannot weight a choice (duplicates collapse), so weights use an integer pick. */
  action step = {
    nondet m = (if (sent.keys().size() == 0) MSGS else sent.keys()).oneOf()
    nondet kind = KINDS.oneOf()
    nondet app = APPS.oneOf()
    // The legacy webhook is one path in four (it is not live in production: the gateway owns the webhook).
    nondet r = 0.to(3).oneOf()
    nondet c1 = Set(true, false).oneOf()
    nondet c2 = Set(true, false).oneOf()
    // A lost answer (the gateway request timed out) is one in four.
    nondet q = 0.to(3).oneOf()
    nondet d = TICK_STEPS.oneOf()
    any {
      sendText(MSGS.filter(x => not(sent.keys().contains(x))).fold(0, (acc, x) => if (acc == 0 or x < acc) x else acc), kind, app,
        if (r == 0) "wh" else "gw"),
      gwCall(m),
      gwCall(m),
      gwTimeout(m),
      work(m, c1, c2),
      work(m, c1, c2),
      work(m, c1, c2),
      renew(m),
      crash(m),
      throwIn(m, q == 0),
      complete(m, q == 0, c2),
      complete(m, q == 0, c2),
      drain(m, q == 0, c1, c2),
      staffResolve(m),
      purge,
      proposeSignal(m),
      staffHandle(m),
      contextChange,
      tick(d),
    }
  }

  // ------------------------------------------------------------------ invariants
  /**
   * stopNeverLost. Rule: PRD 40.3 and founder decision 7 (STOP stops every app); inbox.ts:21-23 "A compliance turn
   * that fails is never sealed". A STOP the reader reads as STOP that has its final answer (gateway) or its final
   * row (legacy), with no worker left that could still write, has its ledger event. (SD-001, SD-129)
   */
  val stopNeverLost: bool = sent.keys().forall(m =>
    (sent.get(m).kind == "Stop" and isFinal(m) and not(workerAlive(m)))
      implies w.ledger.exists(e => e.ref == m and e.src == "stop" and e.app == "" and e.state == "out"))

  /**
   * stopPhraseHonored. Rule: AGENTS.md decision 11 (parseOptOut on the inbound path), PRD 40.3. A text the person
   * means as STOP that is final has a STOP event. The reader is an oracle; this shows what a misread reaches. (SD-031, SD-032)
   */
  val stopPhraseHonored: bool = sent.keys().forall(m =>
    (sent.get(m).kind == "StopLikely" and isFinal(m) and not(workerAlive(m)))
      implies w.ledger.exists(e => e.src == "stop" and e.at >= sent.get(m).at))

  /** stopNeverHeldBack. Rule: inbox.ts:19-20 and 84 "STOP, START and HELP are never held back". (SD-002) */
  val stopNeverHeldBack: bool = not(g.busyKw)

  /** atMostOneProcessing. Rule: inbox.ts:17 and 75 "one signed turn per sender". */
  val atMostOneProcessing: bool = rows.keys().filter(k => rows.get(k).st == "processing" and rows.get(k).mine).size() <= 1

  /**
   * stopAllApps. Rule: PRD 40.3 / founder decision 7: on the shared line STOP stops every app. When the newest
   * consent intent the person sent is a STOP and it reached the ledger, every app resolves opted_out.
   */
  val stopAllApps: bool = g.intents.forall(i =>
    (i.src == "stop" and g.intents.forall(j => j.at < i.at or (j.at == i.at and j.seq <= i.seq))
      and w.ledger.exists(e => e.ref == i.ref and e.src == "stop"))
    implies APPS.forall(a => isOut(w.ledger, a)))

  /**
   * ledgerFollowsSendOrder (olderStartNoUndo). Rule: service README "Consent order": in a turn the consent event time is
   * the gateway's receivedAt for STOP, START, leave and join opt-ins; the ledger resolves by the person's send order.
   * (SD-105, SD-104 for its ledger half)
   */
  val ledgerFollowsSendOrder: bool = APPS.forall(a => resolve(w.ledger, a) == resolve(g.intents, a))

  /**
   * echoMatchesLedger. Rule: AGENTS.md 2026-10-09 item 2 "Consent path" (the gateway copies consent into its fence; only
   * one system answers STOP) and README "Consent order" (an older START reports no consent). The consent a turn reports
   * is the resolved ledger when the turn answers. (SD-037, SD-104)
   */
  val echoMatchesLedger: bool = not(g.echoBad)

  /**
   * projectionsMatchLedger. Rule: service.ts:795-799 (an opted-out membership reads paused; START makes it active) and
   * AGENTS.md (the consent ledger is what the send path reads). When nothing is in flight, a live membership is paused,
   * and its network member is opted out, exactly when the ledger resolves opted_out. Under a phone hold staff own the
   * projections (SD-130 refuted), so the hold is left out. (SD-104, Q-turn_consent-1, Q-turn_consent-2)
   */
  val projectionsMatchLedger: bool = (quiescent and not(held)) implies APPS.forall(a =>
    live(w, a) implies ((w.member.get(a) == "paused") == isOut(w.ledger, a) and w.optOut.get(a) == isOut(w.ledger, a)))

  /**
   * fenceMatchesLedger. Rule: AGENTS.md 2026-10-09 item 2 "Consent path": the gateway's send-time fence follows every
   * carrier-consent change. When nothing is in flight on the signed path, the fence and the ledger agree on opted_out.
   * (SD-023, SD-029, Q-turn_consent-1)
   */
  val fenceMatchesLedger: bool = (quiescent and onlyGateway) implies APPS.forall(a => isOut(w.fence, a) == isOut(w.ledger, a))

  /**
   * startResumesStop. Rule: PRD 32.2/1435 "honor STOP/HELP/START" with PRD 40.3 "STOP stops every app": START after a
   * global STOP resumes what the STOP stopped. When the newest intent is a START that is newer than a global STOP, every
   * live membership resolves opted_in. (SD-024, SD-318)
   */
  val startResumesStop: bool = quiescent implies g.intents.forall(i =>
    (i.src == "start" and g.intents.forall(j => j.at < i.at or (j.at == i.at and j.seq <= i.seq))
      and g.intents.exists(s => s.src == "stop" and s.at < i.at))
    implies APPS.forall(a => live(w, a) implies resolve(w.ledger, a) == "in"))

  /** noReplyAfterStop. Rule: service.ts:1121-1122 and founder decision 2026-10-11 #22: after STOP only the hint and confirmations go out.
   *  Signed path only (the legacy path never feeds the fence). (SD-029, Q-turn_consent-1) */
  val noReplyAfterStop: bool = onlyGateway implies not(g.replyAfterStop)

  /** bannedOnlyCompliance. Rule: AGENTS.md 2026-10-09 item 3 (refused at inbound) and service.ts:707. (SD-073) */
  val bannedOnlyCompliance: bool = not(g.bannedReply)

  /** leaveNeverOptsIn. Rule: consent.ts:4 and service.ts:1080 "leave <app>" leaves that app only; it never joins. (SD-490, SD-314) */
  val leaveNeverOptsIn: bool = not(g.leaveOptIn)

  /** nothingBeforeStopActedAfter. Rule: inbox.ts:12-14. (SD-493) */
  val nothingBeforeStopActedAfter: bool = not(g.actedAfterStop)

  /** oneHintPer30Days. Rule: service.ts:1152-1155 and PRD 40.3: one stop hint in 30 days per number and app. (SD-004) */
  val oneHintPer30Days: bool = APPS.forall(a => w.hintLog.get(a).forall(x => w.hintLog.get(a).forall(y =>
    x == y or x - y >= HINT_GAP or y - x >= HINT_GAP)))

  /**
   * processingEnds. Rule: inbox.ts:17-19 "a turn still processing 2 minutes after its last renewal lost its worker and
   * reads as unresolved"; nothing is kept past the inbox retention (7 days). (SD-087)
   */
  val processingEnds: bool = rows.keys().forall(k =>
    (rows.get(k).st == "processing" and not(workerAlive(k))) implies now - rows.get(k).lease <= INBOX_KEEP)

  /** doneTurnAnswered. Rule: inbox.ts:96-97: a done turn replays its answer. A done turn never ends in a final error. (SD-313) */
  val doneTurnAnswered: bool = not(g.doneErr)

  /** signalHasExit. Rule: service.ts:1957-1958 "they wait for a person in GET /signals": a handled signal leaves the queue. (SD-036) */
  val signalHasExit: bool = w.staffHandled.forall(s => w.signals.get(s) != "proposed")

  val safety: bool = and {
    stopNeverLost,
    stopPhraseHonored,
    stopNeverHeldBack,
    atMostOneProcessing,
    stopAllApps,
    ledgerFollowsSendOrder,
    echoMatchesLedger,
    projectionsMatchLedger,
    fenceMatchesLedger,
    startResumesStop,
    noReplyAfterStop,
    bannedOnlyCompliance,
    leaveNeverOptsIn,
    nothingBeforeStopActedAfter,
    oneHintPer30Days,
    processingEnds,
    doneTurnAnswered,
    signalHasExit,
  }

  /** The invariants that the code is expected to keep (the guards that exist). */
  val guarded: bool = and { atMostOneProcessing, stopAllApps }

  // ------------------------------------------------------------------ witnesses (each must be reachable)
  /** A STOP is confirmed in one turn: the gateway holds a handled answer with scope all. */
  val witness_stopConfirmed: bool = not(sent.keys().exists(m => sent.get(m).kind == "Stop" and gw.keys().contains(m)
    and gw.get(m).st == "final" and gw.get(m).ans.kind == "handled" and gw.get(m).ans.consent.scope == "all"))
  /** A leave stops one app: the fence has an app-scope opt-out and another app is not opted out. */
  val witness_leaveOneApp: bool = not(w.fence.exists(e => e.app != "" and e.state == "out"
    and APPS.exists(a => a != e.app and not(isOut(w.ledger, a)))))
  /** START resumes the routed app: a handled START echoes opted_in. */
  val witness_startResumes: bool = not(sent.keys().exists(m => sent.get(m).kind == "Start" and gw.keys().contains(m)
    and gw.get(m).st == "final" and gw.get(m).ans.consent.has and gw.get(m).ans.consent.state == "in"))
  /** An open turn is answered to the gateway. */
  val witness_openTurn: bool = not(gw.keys().exists(m => gw.get(m).st == "final" and gw.get(m).ans.kind == "open"))
  /** A crashed worker leaves a processing row. */
  val witness_orphan: bool = not(rows.keys().exists(k => rows.get(k).st == "processing" and workers.keys().contains(k) and not(workers.get(k).alive)))
  /** A stop hint goes out. */
  val witness_hint: bool = not(APPS.exists(a => w.hintLog.get(a).size() > 0))

  // ------------------------------------------------------------------ run tests (traces from the code and its tests)
  /** eliza-takeover.integration.test.ts:170: STOP with scope all, handled; ledger and fence both opted out. */
  run stopTurnTest =
    initWith("active", "active", false, false)
      .then(sendText(1, "Stop", "A", "gw"))
      .then(gwCall(1))
      .then(work(1, false, false))
      .then(work(1, false, false))
      .then(work(1, false, false))
      .then(work(1, false, false))
      .then(complete(1, false, false))
      .expect(and {
        gw.get(1).st == "final", gw.get(1).ans.consent.scope == "all",
        APPS.forall(a => isOut(w.ledger, a) and isOut(w.fence, a)),
        w.member.get("A") == "paused", w.member.get("B") == "paused", safety,
      })

  /** inbox-order.integration.test.ts:101: a STOP turn that throws before its consent change: turn_failed, the retry succeeds. */
  run stopThrowsBeforeConsentTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Stop", "A", "gw"))
      .then(gwCall(1))
      .then(throwIn(1, false))
      .expect(gw.get(1).st == "call" and not(rows.keys().contains(1)))
      .then(gwCall(1))
      .then(work(1, false, false))
      .then(work(1, false, false))
      .then(work(1, false, false))
      .then(complete(1, false, false))
      .expect(gw.get(1).ans.kind == "handled" and isOut(w.ledger, "A") and safety)

  /** inbox-order.integration.test.ts:114: a STOP turn that throws after its consent change answers handled with the consent. */
  run stopThrowsAfterConsentTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Stop", "A", "gw"))
      .then(gwCall(1))
      .then(work(1, false, false))
      .then(throwIn(1, false))
      .expect(gw.get(1).ans.kind == "handled" and gw.get(1).ans.consent.state == "out" and gw.get(1).ans.replies.contains("compliance"))

  /** inbox-order.integration.test.ts:132: a retry of a running turn is told to retry (turn_busy). */
  run busyRetryTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Chat", "A", "gw"))
      .then(gwCall(1))
      .then(gwTimeout(1))
      .then(gwCall(1))
      .expect(gw.get(1).st == "call" and gw.get(1).ans.err == "turn_busy")

  /** eliza-takeover.integration.test.ts:170: an older START that loses reports no consent. */
  run olderStartLosesTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Start", "A", "gw"))
      .then(tick(1))
      .then(sendText(2, "Stop", "A", "gw"))
      .then(gwCall(2))
      .then(work(2, false, false)).then(work(2, false, false)).then(work(2, false, false))
      .then(complete(2, false, false))
      .then(gwCall(1))
      .then(work(1, false, false)).then(work(1, false, false))
      .then(complete(1, false, false))
      .expect(not(gw.get(1).ans.consent.has) and isOut(w.ledger, "A") and w.member.get("A") == "paused")

  /** SD-001: a claimed STOP whose worker dies is swept after the lease; the retry gets turn_unresolved and no event exists. */
  run sd001StopLostTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Stop", "A", "gw"))
      .then(gwCall(1))
      .then(crash(1))
      .then(gwTimeout(1))
      .then(tick(5))
      .then(gwCall(1))
      .expect(gw.get(1).st == "final" and gw.get(1).ans.err == "turn_unresolved" and not(stopNeverLost))

  /** SD-002: a STOP while another turn of the sender is processing is refused with turn_busy. */
  run sd002StopBusyTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Chat", "A", "gw"))
      .then(gwCall(1))
      .then(sendText(2, "Stop", "A", "gw"))
      .then(gwCall(2))
      .expect(gw.get(2).ans.err == "turn_busy" and not(stopNeverHeldBack))

  /** SD-104: an older STOP processed after a newer START echoes opted_out and pauses A while the ledger says opted_in. */
  run sd104OlderStopTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Stop", "A", "gw"))
      .then(tick(1))
      .then(sendText(2, "Start", "A", "gw"))
      .then(gwCall(2))
      .then(work(2, false, false)).then(work(2, false, false))
      .then(complete(2, false, false))
      .then(gwCall(1))
      .then(work(1, false, false)).then(work(1, false, false)).then(work(1, false, false))
      .then(complete(1, false, false))
      .expect(resolve(w.ledger, "A") == "in" and w.member.get("A") == "paused" and not(echoMatchesLedger) and not(projectionsMatchLedger))

  /** SD-037: STOP, then a late START (sent before it) from a non-member echoes opted_in while the ledger says opted_out. */
  run sd037LateStartTest =
    initWith("none", "none", false, false)
      .then(sendText(1, "Start", "A", "gw"))
      .then(tick(1))
      .then(sendText(2, "Stop", "A", "gw"))
      .then(gwCall(2))
      .then(work(2, false, false)).then(work(2, false, false))
      .then(complete(2, false, false))
      .then(gwCall(1))
      .then(work(1, false, false))
      .then(complete(1, false, false))
      .expect(gw.get(1).ans.consent.state == "in" and isOut(w.ledger, "A") and isOut(w.fence, "A") and not(echoMatchesLedger))

  /** SD-024: STOP stops A and B; START resumes only the routed app A. */
  run sd024StartOneAppTest =
    initWith("active", "active", false, false)
      .then(sendText(1, "Stop", "A", "gw"))
      .then(gwCall(1))
      .then(work(1, false, false)).then(work(1, false, false)).then(work(1, false, false)).then(work(1, false, false))
      .then(complete(1, false, false))
      .then(tick(1))
      .then(sendText(2, "Start", "A", "gw"))
      .then(gwCall(2))
      .then(work(2, false, false)).then(work(2, false, false))
      .then(complete(2, false, false))
      .expect(resolve(w.ledger, "A") == "in" and isOut(w.ledger, "B") and w.member.get("B") == "paused" and not(startResumesStop))

  /** SD-023: STOP, then a text join to app B: the ledger opts B in, the fence still has B opted out. */
  run sd023JoinFenceTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Stop", "A", "gw"))
      .then(gwCall(1))
      .then(work(1, false, false)).then(work(1, false, false)).then(work(1, false, false))
      .then(complete(1, false, false))
      .then(tick(1))
      .then(sendText(2, "Join", "B", "gw"))
      .then(gwCall(2))
      .then(work(2, true, false))
      .then(complete(2, false, false))
      .expect(resolve(w.ledger, "B") == "in" and isOut(w.fence, "B") and not(fenceMatchesLedger))

  /** SD-105: leave (sent first) is processed after a newer START; the leave's event time is now, so it wins. */
  run sd105LateLeaveTest =
    initWith("active", "active", false, false)
      .then(sendText(1, "Leave", "A", "gw"))
      .then(tick(1))
      .then(sendText(2, "Start", "A", "gw"))
      .then(gwCall(2))
      .then(work(2, false, false)).then(work(2, false, false))
      .then(complete(2, false, false))
      .then(tick(1))
      .then(gwCall(1))
      .then(work(1, false, false))
      .expect(resolve(w.ledger, "A") == "out" and resolve(g.intents, "A") == "in" and not(ledgerFollowsSendOrder))

  /** SD-004: a hint, the 2-day purge deletes the bucket, a second hint inside 30 days. */
  run sd004HintPurgeTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Stop", "A", "gw"))
      .then(gwCall(1)).then(work(1, false, false)).then(work(1, false, false)).then(work(1, false, false))
      .then(complete(1, false, false))
      .then(sendText(2, "Chat", "A", "gw"))
      .then(gwCall(2)).then(work(2, false, false)).then(complete(2, false, false))
      .then(tick(2 * DAY + 1))
      .then(purge)
      .then(sendText(3, "Chat", "A", "gw"))
      .then(gwCall(3)).then(work(3, false, false)).then(complete(3, false, false))
      .expect(w.hintLog.get("A").size() == 2 and not(oneHintPer30Days))

  /** SD-490: a pending join with an age, then "leave slop" from a non-member joins the person. */
  run sd490LeaveJoinsTest =
    initWith("none", "none", false, false)
      .then(sendText(1, "Join", "A", "gw"))
      .then(gwCall(1)).then(work(1, false, true)).then(complete(1, false, false))
      .then(sendText(2, "Leave", "A", "gw"))
      .then(gwCall(2)).then(work(2, false, false)).then(complete(2, false, false))
      .expect(w.member.get("A") == "active" and resolve(w.ledger, "A") == "in" and not(leaveNeverOptsIn))

  /** SD-036: a proposed signal that staff handled stays proposed. */
  run sd036SignalTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Chat", "A", "gw"))
      .then(gwCall(1)).then(work(1, false, false)).then(complete(1, false, true))
      .then(proposeSignal(1))
      .then(staffHandle(1))
      .expect(not(signalHasExit))

  /** SD-073: a banned member's text is handled and the Network's reply is collected. */
  run sd073BannedReplyTest =
    initWith("active", "none", true, false)
      .then(sendText(1, "Chat", "A", "gw"))
      .then(gwCall(1)).then(work(1, true, false)).then(complete(1, false, false))
      .expect(gw.get(1).ans.replies.contains("reply") and not(bannedOnlyCompliance))

  /** SD-087: a crashed turn of a sender who never writes again stays processing past the retention window. */
  run sd087OrphanTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Chat", "A", "gw"))
      .then(gwCall(1)).then(crash(1))
      .then(tick(8 * DAY)).then(purge)
      .expect(rows.get(1).st == "processing" and not(processingEnds))

  /** SD-129: a legacy STOP row that fails 5 times is failed and no event is written. */
  run sd129LegacyStopFailedTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Stop", "A", "wh"))
      .then(drain(1, true, false, false)).then(drain(1, true, false, false)).then(drain(1, true, false, false))
      .then(drain(1, true, false, false)).then(drain(1, true, false, false))
      .expect(rows.get(1).st == "failed" and not(stopNeverLost))

  /** SD-493: a signed STOP does not cancel a legacy join answer the person sent before it; the drain joins them after the STOP. */
  run sd493LegacyAfterSignedStopTest =
    initWith("none", "none", false, false)
      .then(sendText(1, "Join", "A", "wh"))
      .then(tick(1))
      .then(sendText(2, "Stop", "A", "gw"))
      .then(gwCall(2)).then(work(2, false, false)).then(work(2, false, false)).then(complete(2, false, false))
      .then(drain(1, false, true, false))
      .expect(w.member.get("A") == "active" and not(nothingBeforeStopActedAfter))

  /** SD-313: an open turn's answer is lost, the context changes, the replay is a final turn_context_changed. */
  run sd313ContextChangedTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Chat", "A", "gw"))
      .then(gwCall(1)).then(work(1, false, false)).then(complete(1, true, true))
      .then(contextChange).then(gwTimeout(1)).then(gwCall(1))
      .expect(gw.get(1).ans.err == "turn_context_changed" and not(doneTurnAnswered))

  /**
   * SD-001 (the milder form in its source report): the worker dies after the STOP ledger write. The retry sweeps the
   * row and gets turn_unresolved: no consent echo, no confirmation, no projections.
   */
  run sd001StopAfterLedgerTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Stop", "A", "gw"))
      .then(gwCall(1)).then(work(1, false, false))
      .then(crash(1)).then(gwTimeout(1)).then(tick(5)).then(gwCall(1))
      .expect(and {
        gw.get(1).ans.err == "turn_unresolved", isOut(w.ledger, "A"), not(isOut(w.fence, "A")),
        w.member.get("A") == "active", not(fenceMatchesLedger), not(projectionsMatchLedger), stopNeverLost,
      })

  /**
   * Q-turn_consent-1: the worker of a STOP is alive, but its claim is resolved by staff (POST /inbound/resolve, or a
   * sweep after missed lease renewals). The STOP commits its ledger event and its projections; at completion the row
   * is not processing, the update finds no row (inbox.ts:118-119), rescueCompliance returns undefined (inbox.ts:146),
   * and the gateway gets turn_unresolved with no consent and no confirmation. The gateway fence never stops the app;
   * the next text gets the stop hint as if the person had been told.
   */
  run q1StopSealedWhileRunningTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Stop", "A", "gw"))
      .then(gwCall(1))
      .then(staffResolve(1))
      .then(work(1, false, false)).then(work(1, false, false))
      .then(throwIn(1, false))
      .expect(and {
        gw.get(1).ans.err == "turn_unresolved", isOut(w.ledger, "A"), not(isOut(w.fence, "A")),
        w.member.get("A") == "paused", not(fenceMatchesLedger),
      })
      .then(tick(1))
      .then(sendText(2, "Chat", "A", "gw"))
      .then(gwCall(2)).then(work(2, false, false)).then(complete(2, false, false))
      .expect(gw.get(2).ans.replies.contains("compliance") and not(isOut(w.fence, "A")))

  /**
   * Q-turn_consent-2: a join answer sent before a STOP but handled after it (the gateway retries it after turn_busy
   * and sends the STOP first). The join writes its opt-in at its receivedAt, older than the STOP, so the ledger stays
   * opted_out, but the membership is active and the network member is not opted out (service.ts:1438-1449 has no
   * check like the START check at service.ts:1107). The Network treats the member as eligible (network.ts:2890).
   */
  run q2JoinAfterStopTest =
    initWith("none", "none", false, false)
      .then(sendText(1, "Join", "A", "gw"))
      .then(tick(1))
      .then(sendText(2, "Stop", "A", "gw"))
      .then(gwCall(2)).then(work(2, false, false)).then(work(2, false, false)).then(complete(2, false, false))
      .then(gwCall(1)).then(work(1, true, false)).then(complete(1, false, false))
      .expect(and {
        isOut(w.ledger, "A"), w.member.get("A") == "active", not(w.optOut.get("A")),
        not(projectionsMatchLedger), stopNeverLost, echoMatchesLedger,
      })

  /**
   * SD-029: "leave A" throws after accounts.leave wrote the opt-out and removed the membership, before turn.consent
   * was set. rescueCompliance sees no consent and releases the claim (turn_failed). The retry is a non-member text:
   * the join ask goes out, and the gateway never gets the app opt-out.
   */
  run sd029LeaveReleasedTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Leave", "A", "gw"))
      .then(gwCall(1)).then(work(1, false, false)).then(work(1, false, false))
      .then(throwIn(1, false))
      .expect(gw.get(1).ans.err == "turn_failed" and isOut(w.ledger, "A") and w.member.get("A") == "removed")
      .then(gwCall(1)).then(work(1, false, false)).then(complete(1, false, false))
      .expect(and {
        gw.get(1).st == "final", not(gw.get(1).ans.consent.has), gw.get(1).ans.replies.contains("reply"),
        isOut(w.ledger, "A"), not(isOut(w.fence, "A")), not(noReplyAfterStop), not(fenceMatchesLedger),
      })
}
