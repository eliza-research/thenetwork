// quint-check: max-steps=30 max-samples=20000 verify-steps=3
//
// The signed turn, the consent ledger, its projections and the gateway's consent mirror
// (docs/research/2026-11-07-state-machines.md section 6.2, machines M-001..M-013, M-106..M-111).
//
// The model follows the code as it is now (branch wave2/turn_consent: base ad67275 and the fixes of
// docs/research/quint-findings/turn_consent.md):
//   packages/network/service/inbox.ts        Inbox.signed (claim with two slots, reclaim, stopCancels, lease_at),
//                                            rescueCompliance (also a sealed claim), handleWaiting, purge (orphans), resolve
//   packages/network/service/service.ts      NetworkService.inbound (ban check, leave of any app), route (START after a
//                                            global STOP), stop (resumed apps skipped), stopped, stopHint, join (opt-in echo,
//                                            older join paused), sharedTurn replay (current context), POST /signals
//   packages/platform/src/consent.ts         resolveConsent, keywordEvent (namedApp), leaveTarget, detectKeyword
//   packages/platform/src/accounts.ts        leave (consentAt and ref; no forget under a newer opt-in), activeMembership
//   packages/platform/src/pg-store.ts        addConsent (idempotent per ref), hit (rate window, keep_until), purge
//
// Abstraction.
//   - One sender (one phone, one person). Two apps "A" and "B" (for example slop and friends). Four message ids.
//     One sender is enough for every per-sender rule: the claim, the sweep and the drain are per sender.
//   - Time is an integer tick of 30 s. LEASE, BLOCK, DAY and the purge windows are named constants.
//   - One SQL transaction is one action. Each await between two transactions is a point where the
//     worker can crash, throw, lose its lease, or another actor (the gateway retry, the drain, staff,
//     the purge) can run.
//   - A run is one execution of a claimed turn (Inbox.signed and its InboundTurn). A reclaim of a compliance turn
//     (SD-001 fix) starts a new run of the same message; the old run can still be alive (staff resolved its claim
//     while it ran). Run ids: message m, run k -> m + 10 * k. The gateway waits for the answer of its latest request.
//   - Readers are oracles. The message kind is chosen when the person sends it: "Stop" is a text that
//     detectKeyword reads as STOP; "StopLikely" is a text the person means as STOP that the reader does
//     not read as STOP (SD-032: "STOP!! I said stop"). The routing decision (service.ts:964-1010) is an oracle,
//     except START after a global STOP, which goes to the app the STOP named (SD-318 fix).
//   - Gateway assumptions (upstream code, not in this repository): the gateway retries a retryable answer
//     and a timed-out request with the same messageId; it stops at a final answer; it copies a handled
//     turn's `consent` into its send-time fence and resolves the fence by `at` like the ledger does
//     (the SD-037 verifier reports that the fence is not affected by a late START, which needs this);
//     it sends the collected replies only when the fence lets the app send. It retries one message for hours, never
//     past the inbox retention of 7 days ("a provider retries for hours, not weeks", inbox.ts purge).
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
  /** service.ts stopHint gap: 30 days. */
  pure val HINT_GAP: int = 30 * DAY
  /** service.ts people.purge(now - 2 days): rate_limits rows (pg-store.ts purge). */
  pure val RATE_KEEP: int = 2 * DAY
  /** service.ts inbox.purge(now - 7 days). */
  pure val INBOX_KEEP: int = 7 * DAY
  /** inbox.ts TOMBSTONE_KEEP_MS = 30 days. */
  pure val TOMBSTONE_KEEP: int = 30 * DAY
  /** inbox.ts MAX_ATTEMPTS. */
  pure val MAX_ATTEMPTS: int = 5

  // ------------------------------------------------------------------ types
  /** A consent event. app "" = every app (global). ref -1 = no ref. src: stop, start, leave, join, init, echo. */
  type Ev = { app: str, state: str, at: int, seq: int, ref: int, src: str }
  /** TurnResponse.consent (contract.ts). has=false: no consent field. scope "all" or "app". */
  type Consent = { has: bool, state: str, scope: str, app: str, at: int }
  /** A message the person sent. app: the routed app, or the target of Leave and Join. path: "gw" signed turn, "wh" legacy webhook. */
  type Msg = { kind: str, app: str, path: str, at: int }
  /** The answer to one /internal/turn call. kind: handled, open, err. */
  type Resp = { kind: str, err: str, retry: bool, consent: Consent, replies: Set[str], app: str, ctx: int,
                /** Ghost: the ledger seq when the run decided its non-compliance reply (the events it had read are below it). */
                rseq: int }
  /**
   * platform.inbound row. st: processing, done, unresolved (signed); pending, done, failed (legacy). mine: sender_hash set.
   * lease: lease_at (coalesce(lease_at, arrived_at)), or handled_at once done. arr: arrived_at (SD-496: never renewed).
   * comp: the compliance claim slot (migration 0042, SD-002). handled: handled_at is set.
   */
  type Row = { st: str, lease: int, arr: int, attempts: int, resp: Resp, mine: bool, comp: bool, handled: bool }
  /** One run of a claimed signed turn (the InboundTurn object and its async stack). msg: the message id. app: the routed app. */
  type Worker = { msg: int, app: str, alive: bool, phase: int, todo: Set[str], consent: Consent, replies: Set[str], conf: bool, open: bool,
                  /** The ledger seq when the run set its consent: the events it had read are those with a lower seq. */
                  cseq: int,
                  /** The ledger seq when the run decided its non-compliance reply. */
                  rseq: int }
  /** Gateway state per message: call (must call), wait (a request is in flight for run `rid`), final. */
  type Gw = { st: str, ans: Resp, rid: int }
  type World = {
    ledger: Set[Ev], fence: Set[Ev], seq: int,
    member: str -> str, optOut: str -> bool, pendingJoin: str,
    hintLast: str -> int, hintLog: str -> Set[int],
    signals: int -> str, staffHandled: Set[int], ctx: int,
    /** consent_events.named_app of a global STOP, by its ref (migration 0042, SD-318). */
    named: int -> str
  }
  /** Ghost facts the invariants read. intents: the consent intents ordered by the person's send time (README "Consent order"). */
  type Ghost = {
    echoBad: bool, busyKw: bool, bannedReply: bool, leaveOptIn: bool, actedAfterStop: bool,
    doneErr: bool, replyAfterStop: bool, crashes: int, intents: Set[Ev], runs: int -> int,
    /** The time of the last retention purge (the tick runs it every minute in production). */
    lastPurge: int,
    /** A STOP turn was rescued (handled with its consent) before its projections were all written (Q-turn_consent-4). */
    cutShort: bool
  }

  pure val NOC: Consent = { has: false, state: "", scope: "", app: "", at: 0 }
  pure val NORESP: Resp = { kind: "none", err: "", retry: false, consent: NOC, replies: Set(), app: "", ctx: 0, rseq: 0 }

  // ------------------------------------------------------------------ state
  var now: int
  var sent: int -> Msg
  var gw: int -> Gw
  var rows: int -> Row
  /** Runs by run id (m + 10 * k). */
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

  /** consent.ts resolveConsent. "in", "out" or "none". */
  pure def resolve(evs: Set[Ev], a: str): str = {
    val la = lastOf(evs.filter(e => e.app == a))
    val lg = lastOf(evs.filter(e => e.app == ""))
    if (la.size() == 0) { if (lg.exists(e => e.state == "out")) "out" else "none" }
    else if (lg.size() == 0 or lg.exists(e => e.state == "in")) { if (la.exists(e => e.state == "in")) "in" else "out" }
    else if (la.exists(e => e.state == "in" and lg.forall(x => e.at > x.at))) "in"
    else "out"
  }
  pure def isOut(evs: Set[Ev], a: str): bool = resolve(evs, a) == "out"

  /** inbox.ts isComplianceText: STOP, STOP ALL, START, HELP or "leave <app>". StopLikely is not read as one. */
  pure def isKeyword(kind: str): bool = kind == "Stop" or kind == "Start" or kind == "Help" or kind == "Leave"

  pure def live(wd: World, a: str): bool = a.in(APPS) and (wd.member.get(a) == "active" or wd.member.get(a) == "paused")

  pure def runsOf(mp: int -> int, m: int): int = if (mp.keys().contains(m)) mp.get(m) else 0

  /** inbox.ts reclaimable: unresolved, handled_at not set, no response stored. */
  pure def reclaimable(r: Row): bool = r.st == "unresolved" and not(r.handled) and r.resp.kind == "none"

  /** pg-store.ts addConsent: on conflict (e164, ref) where ref is not null do nothing. */
  pure def addConsent(wd: World, e: Ev): World =
    if (e.ref >= 0 and wd.ledger.exists(x => x.ref == e.ref and x.src == e.src)) wd
    else { ...wd, ledger: wd.ledger.union(Set({ ...e, seq: wd.seq })), seq: wd.seq + 1 }

  pure def addIntent(gh: Ghost, wd: World, e: Ev): Ghost =
    if (e.ref >= 0 and gh.intents.exists(x => x.ref == e.ref and x.src == e.src)) gh
    else { ...gh, intents: gh.intents.union(Set({ ...e, seq: wd.seq })) }

  /**
   * service.ts route, step 2b (SD-318 fix): START when the last global consent row is an opt-out with a named app
   * goes to that app. Otherwise the routed app is the oracle `msg.app`.
   */
  pure def routeApp(wd: World, msg: Msg): str = {
    val lg = lastOf(wd.ledger.filter(e => e.app == ""))
    val ns = lg.filter(e => e.state == "out" and wd.named.keys().contains(e.ref)).map(e => wd.named.get(e.ref))
    if (msg.kind == "Start" and ns.size() > 0) ns.fold("", (acc, x) => x) else msg.app
  }

  /**
   * service.ts stopHint: the routed app resolves opted_out, the number is not banned:
   * hit(stop_hint:<app>, 30 days, minGapMs 30 days) reads max(last_at) of the bucket (pg-store.ts hit).
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
    val a = if (wk.phase == 0) routeApp(wd, msg) else wk.app
    if (msg.kind == "Stop") {
      if (wk.phase == 0) {
        // service.ts stop: keywordEvent (global on the shared line, namedApp = the routed app), recordConsent once per ref,
        // turn.consent, turn.confirmation.
        val e = { app: "", state: "out", at: cat, seq: 0, ref: m, src: "stop" }
        val wd1 = addConsent(wd, e)
        // Under a phone hold, memberOf and personFor are undefined: the STOP reaches the ledger only.
        { wd: { ...wd1, named: if (wd1.seq > wd.seq) wd1.named.put(m, a) else wd1.named }, gh: addIntent(gh, wd, e),
          wk: { ...wk, app: a, phase: 1, todo: if (isHeld) Set() else APPS.filter(x => live(wd, x)),
                consent: { has: true, state: "out", scope: "all", app: "", at: cat }, conf: true } }
      } else if (wk.phase == 1 and wk.todo.size() > 0) {
        // service.ts stopped() and the routed member's unit, one unit of work per member: membership paused, member
        // opted out. SD-104 fix: an app whose ledger reads opted in (an older STOP that arrived late) stays as it is.
        val x = if (wk.todo.contains("A")) "A" else "B"
        if (resolve(wd.ledger, x) == "in") { wd: wd, gh: gh, wk: { ...wk, todo: wk.todo.exclude(Set(x)) } }
        else {
          { wd: { ...wd,
                  member: if (wd.member.get(x) == "active") wd.member.set(x, "paused") else wd.member,
                  optOut: wd.optOut.set(x, true) },
            gh: gh, wk: { ...wk, todo: wk.todo.exclude(Set(x)) } }
        }
      } else {
        // service.ts stop: the confirmation is collected (memberMessage or direct).
        { wd: wd, gh: gh, wk: { ...wk, phase: 9, replies: wk.replies.union(Set("compliance")) } }
      }
    } else if (msg.kind == "Start") {
      if (isHeld or isBanned) {
        // service.ts inbound: the hold check and the ban check: "held", no event.
        { wd: wd, gh: gh, wk: { ...wk, app: a, phase: 9 } }
      } else if (live(wd, a)) {
        if (wk.phase == 0) {
          // recordConsent(app, opted_in, at = receivedAt, ref).
          val e = { app: a, state: "in", at: cat, seq: 0, ref: m, src: "start" }
          { wd: addConsent(wd, e), gh: addIntent(gh, wd, e), wk: { ...wk, app: a, phase: 1 } }
        } else if (resolve(wd.ledger, a) != "in") {
          // An older START than the last STOP: handled, no consent, no reply.
          { wd: wd, gh: gh, wk: { ...wk, phase: 9 } }
        } else {
          // turn.consent, membership paused -> active, member opted in (memberUnit START), endPause, welcome back.
          // Only the routed app (SD-024, skipped: founder decision).
          { wd: { ...wd, member: if (wd.member.get(a) == "paused") wd.member.set(a, "active") else wd.member, optOut: wd.optOut.set(a, false) },
            gh: gh,
            wk: { ...wk, phase: 9, consent: { has: true, state: "in", scope: "app", app: a, at: cat }, replies: wk.replies.union(Set("reply")) } }
        }
      } else {
        // A non-member START: recordConsent; SD-037 fix: an older START than the last STOP reports nothing and stops
        // there; otherwise turn.consent and the join ask.
        val e = { app: a, state: "in", at: cat, seq: 0, ref: m, src: "start" }
        val wd1 = addConsent(wd, e)
        if (resolve(wd1.ledger, a) != "in") { wd: wd1, gh: addIntent(gh, wd, e), wk: { ...wk, app: a, phase: 9 } }
        else {
          { wd: wd1, gh: addIntent(gh, wd, e),
            wk: { ...wk, app: a, phase: 9, consent: { has: true, state: "in", scope: "app", app: a, at: cat }, replies: wk.replies.union(Set("reply")) } }
        }
      }
    } else if (msg.kind == "Help") {
      { wd: wd, gh: gh, wk: { ...wk, app: a, phase: 9, replies: wk.replies.union(Set("compliance")) } }
    } else if (msg.kind == "Leave" and not(isHeld)) {
      // SD-314 fix: "leave <app>" leaves that app for a member and for a non-member alike; never a join. A ban does not
      // stop it (the ban check comes after the leave).
      if (wk.phase == 0) {
        // SD-105 fix: accounts.leave / recordConsent(app, opted_out, at = consentAt, ref).
        val e = { app: a, state: "out", at: cat, seq: 0, ref: m, src: "leave" }
        { wd: addConsent(wd, e), gh: addIntent(gh, wd, e), wk: { ...wk, app: a, phase: 1 } }
      } else if (wk.phase == 1) {
        // accounts.leave: onForget and forgetMembership only when the ledger does not read opted in (SD-105);
        // SD-490 fix: deletePending(join, app).
        val forget = live(wd, a) and resolve(wd.ledger, a) != "in"
        { wd: { ...wd, member: if (forget) wd.member.set(a, "removed") else wd.member,
                pendingJoin: if (wd.pendingJoin == a) "" else wd.pendingJoin },
          gh: gh, wk: { ...wk, phase: 2 } }
      } else {
        // turn.consent (at = consentAt), turn.confirmation, the confirmation collected.
        { wd: wd, gh: gh, wk: { ...wk, phase: 9, conf: true,
            consent: { has: true, state: "out", scope: "app", app: a, at: cat }, replies: wk.replies.union(Set("compliance")) } }
      }
    } else {
      // Join, Chat, StopLikely (and a Leave from a held number).
      val target = a
      if (isHeld) {
        // A held number gets nothing.
        { wd: wd, gh: gh, wk: { ...wk, app: a, phase: 9 } }
      } else if (msg.kind == "Join" and not(live(wd, target))) {
        if (isBanned) { wd: wd, gh: gh, wk: { ...wk, app: a, phase: 9 } }
        else if (c1) {
          // service.ts join: membership, opt-in event at consentAt, member. SD-023 fix: turn.consent when the ledger now
          // reads opted in. Q-turn_consent-2 fix: an older join answer than the last STOP is paused and opted out, no welcome.
          val e = { app: target, state: "in", at: cat, seq: 0, ref: m, src: "join" }
          val wd1 = addConsent(wd, e)
          val ok = resolve(wd1.ledger, target) == "in"
          { wd: { ...wd1, member: wd1.member.set(target, if (ok) "active" else "paused"), optOut: wd1.optOut.set(target, not(ok)), pendingJoin: "" },
            gh: addIntent(gh, wd, e),
            wk: { ...wk, app: a, phase: 9,
                  consent: if (ok) { has: true, state: "in", scope: "app", app: target, at: cat } else wk.consent,
                  replies: if (ok) wk.replies.union(Set("reply")) else wk.replies } }
        } else {
          // The join ask; a stated age is kept in pending_texts (c2).
          val h = hint(wd, target, t, isBanned)
          { wd: { ...h.wd, pendingJoin: if (c2) target else h.wd.pendingJoin },
            gh: gh, wk: { ...wk, app: a, phase: 9, replies: wk.replies.union(if (h.sent) Set("reply", "compliance") else Set("reply")) } }
        }
      } else if (live(wd, target)) {
        if (isBanned) {
          // SD-073 fix: a banned member's text is not stored, handled or answered.
          { wd: wd, gh: gh, wk: { ...wk, app: a, phase: 9 } }
        } else {
          // stopHint, then the member's unit of work. The Network answers only a member whose row is not opted out.
          val h = hint(wd, target, t, isBanned)
          val netReply = c1 and not(wd.optOut.get(target))
          { wd: h.wd,
            gh: { ...gh, bannedReply: gh.bannedReply or (isBanned and netReply) },
            wk: { ...wk, app: a, phase: 9, open: not(netReply),
                  replies: wk.replies.union(if (h.sent) Set("compliance") else Set()).union(if (netReply) Set("reply") else Set()) } }
        }
      } else if (isBanned) {
        { wd: wd, gh: gh, wk: { ...wk, app: a, phase: 9 } }
      } else {
        // A non-member's text: the join ask, then stopHint.
        val h = hint(wd, target, t, isBanned)
        { wd: h.wd, gh: gh, wk: { ...wk, app: a, phase: 9, replies: wk.replies.union(if (h.sent) Set("reply", "compliance") else Set("reply")) } }
      }
    }
  }

  /** phaseStep, the ghost flag for a leave that wrote an opt-in (leaveNeverOptsIn), and the run's cseq and rseq. */
  pure def stepFlag(wd: World, gh: Ghost, wk: Worker, msg: Msg, m: int, t: int, cat: int,
                    isBanned: bool, isHeld: bool, c1: bool, c2: bool): StepOut = {
    val out = phaseStep(wd, gh, wk, msg, m, t, cat, isBanned, isHeld, c1, c2)
    val optIn = out.wd.ledger.exclude(wd.ledger).exists(e => e.state == "in")
    { ...out, gh: { ...out.gh, leaveOptIn: out.gh.leaveOptIn or (msg.kind == "Leave" and optIn) },
      wk: { ...out.wk, cseq: if (out.wk.consent != wk.consent) out.wd.seq else wk.cseq,
            rseq: if (out.wk.replies.contains("reply") and not(wk.replies.contains("reply"))) out.wd.seq else wk.rseq } }
  }

  /** True when the next phase collects a reply into platform.inbound (Inbox.collect throws on a sealed row). */
  pure def collects(wd: World, wk: Worker, msg: Msg, isHeld: bool): bool = {
    val a = if (wk.phase == 0) routeApp(wd, msg) else wk.app
    if (msg.kind == "Stop") wk.phase == 1 and wk.todo.size() == 0
    else if (msg.kind == "Leave" and not(isHeld)) wk.phase == 2
    else if (msg.kind == "Start" and live(wd, a)) wk.phase == 1
    else true
  }

  pure def newWorker(m: int, a: str): Worker =
    { msg: m, app: a, alive: true, phase: 0, todo: Set(), consent: NOC, replies: Set(), conf: false, open: false, cseq: 0, rseq: 0 }

  pure def mapRemove(mp: int -> Row, k: int): int -> Row = mp.keys().exclude(Set(k)).mapBy(x => mp.get(x))
  pure def wkRemove(mp: int -> Worker, k: int): int -> Worker = mp.keys().exclude(Set(k)).mapBy(x => mp.get(x))

  // ------------------------------------------------------------------ derived state
  def workerAlive(r: int): bool = workers.keys().contains(r) and workers.get(r).alive
  /** Some run of message m is alive. */
  def msgAlive(m: int): bool = workers.keys().exists(r => workers.get(r).msg == m and workers.get(r).alive)
  def isFinal(m: int): bool =
    if (sent.get(m).path == "gw") gw.get(m).st == "final"
    else rows.keys().contains(m) and rows.get(m).st != "pending"
  /** Nothing in flight: every gateway message has its final answer, no legacy row waits, no worker runs. */
  def quiescent: bool = sent.keys().forall(m => isFinal(m)) and workers.keys().forall(r => not(workers.get(r).alive))
  def onlyGateway: bool = sent.keys().forall(m => sent.get(m).path == "gw")

  // ------------------------------------------------------------------ init
  action initWith(ma: str, mb: str, isBanned: bool, isHeld: bool): bool = {
    val mem = Map("A" -> ma, "B" -> mb)
    val evs = APPS.filter(a => mem.get(a) == "active")
    // A web or text join wrote an opt-in for each live membership (accounts.ts, service.ts join).
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
             signals: Map(), staffHandled: Set(), ctx: 0, named: Map() },
      g' = { echoBad: false, busyKw: false, bannedReply: false, leaveOptIn: false, actedAfterStop: false,
             doneErr: false, replyAfterStop: false, crashes: 0, intents: ledger0, runs: Map(), lastPurge: 0, cutShort: false },
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
  /** The person sends a text. The gateway receives it (receivedAt = now) or, on the legacy path, the webhook stores a pending row. */
  action sendText(m: int, kind: str, app: str, path: str): bool = all {
    m.in(MSGS), not(sent.keys().contains(m)),
    sent' = sent.put(m, { kind: kind, app: app, path: path, at: now }),
    gw' = if (path == "gw") gw.put(m, { st: "call", ans: NORESP, rid: 0 }) else gw,
    rows' = if (path == "wh") rows.put(m, { st: "pending", lease: now, arr: now, attempts: 0, resp: NORESP, mine: true, comp: false, handled: false }) else rows,
    now' = now, workers' = workers, w' = w, g' = g, banned' = banned, held' = held,
  }

  /** The gateway delivers a final answer: it mirrors `consent` into its fence, then sends the replies the fence allows. */
  pure def deliverTo(wd: World, gh: Ghost, resp: Resp, m: int): { wd: World, gh: Ghost } = {
    val c = resp.consent
    val fence1 = if (resp.kind == "handled" and c.has)
      wd.fence.union(Set({ app: if (c.scope == "all") "" else c.app, state: c.state, at: c.at, seq: wd.seq, ref: m, src: "echo" }))
      else wd.fence
    val wd1 = { ...wd, fence: fence1, seq: wd.seq + 1 }
    // A reply leaks when the run decided it after it had read an opted-out ledger and the fence lets it through. A reply
    // decided before a concurrent STOP committed is a stale answer (the gateway's fence learns the STOP from its own answer).
    val leaks = resp.kind == "handled" and resp.replies.contains("reply") and resp.app.in(APPS)
      and not(isOut(fence1, resp.app)) and isOut(wd.ledger.filter(e => e.seq < resp.rseq), resp.app)
    { wd: wd1, gh: { ...gh, replyAfterStop: gh.replyAfterStop or leaks } }
  }

  /** An open turn is allowed now (accounts.activeMembership: active membership, opted in, not banned, no hold). */
  def openAllowed(a: str): bool = a.in(APPS) and w.member.get(a) == "active" and resolve(w.ledger, a) == "in" and not(banned) and not(held)

  /**
   * POST /internal/turn: the claim transaction (inbox.ts signed) and the answer to a refused claim.
   * The sweep of stale processing rows commits in the same transaction even when nothing is inserted.
   * SD-002 fix: a compliance turn waits only for another compliance turn (its own slot). SD-001 fix: a compliance
   * turn whose claim is unresolved with no answer and no handled_at is claimed again (a new run). SD-493 fix: a
   * claimed STOP cancels the sender's ordinary legacy rows received before it.
   */
  action gwCall(m: int): bool = all {
    sent.keys().contains(m), sent.get(m).path == "gw", gw.get(m).st == "call", now - sent.get(m).at <= INBOX_KEEP,
    val msg = sent.get(m)
    val kw = isKeyword(msg.kind)
    // The sweep by coalesce(lease_at, arrived_at).
    val swept = rows.keys().mapBy(k => {
      val r = rows.get(k)
      if (r.mine and r.st == "processing" and r.lease < now - LEASE) { ...r, st: "unresolved" } else r
    })
    // The insert guard.
    val blocked = swept.keys().exists(k => swept.get(k).mine and ((swept.get(k).st == "processing" and (not(kw) or swept.get(k).comp))
      or (not(kw) and (swept.get(k).st == "pending" or (swept.get(k).st == "unresolved" and swept.get(k).lease > now - BLOCK)))))
    val insert = not(swept.keys().contains(m)) and not(blocked)
    val compBusy = swept.keys().exists(k => k != m and swept.get(k).mine and swept.get(k).st == "processing" and swept.get(k).comp)
    val reclaim = kw and swept.keys().contains(m) and reclaimable(swept.get(m)) and not(compBusy)
    if (insert or reclaim) {
      val k = runsOf(g.runs, m)
      val r = m + 10 * k
      // stopCancels: pending ordinary legacy rows received at or before the STOP's receivedAt end cancelled.
      val cancel = if (msg.kind == "Stop") swept.keys().filter(x => sent.get(x).path == "wh" and swept.get(x).st == "pending"
        and not(isKeyword(sent.get(x).kind)) and sent.get(x).at <= msg.at) else Set()
      val claimed = if (insert) swept.put(m, { st: "processing", lease: now, arr: now, attempts: 0, resp: NORESP, mine: true, comp: kw, handled: false })
        else swept.set(m, { ...swept.get(m), st: "processing", lease: now, mine: true, comp: true })
      all {
        rows' = claimed.keys().mapBy(x => if (x.in(cancel)) { ...claimed.get(x), st: "done", lease: now, handled: true } else claimed.get(x)),
        workers' = workers.put(r, newWorker(m, msg.app)),
        gw' = gw.set(m, { st: "wait", ans: NORESP, rid: r }),
        w' = w, g' = { ...g, runs: g.runs.put(m, k + 1) },
      }
    } else {
      val ans: Resp =
        if (not(swept.keys().contains(m))) { ...NORESP, kind: "err", err: "turn_busy", retry: true }
        else if (swept.get(m).st == "done") swept.get(m).resp
        else if (swept.get(m).st == "processing") { ...NORESP, kind: "err", err: "turn_busy", retry: true }
        // Q-turn_consent-3 fix: a reclaimable compliance turn blocked by another compliance turn is told to retry.
        else if (kw and reclaimable(swept.get(m))) { ...NORESP, kind: "err", err: "turn_busy", retry: true }
        else { ...NORESP, kind: "err", err: "turn_unresolved", retry: false }
      // sharedTurn replay of an open turn (SD-313 fix): the current context when an open turn is still allowed
      // (sharedContext is taken as available on a replay); turn_context_changed only when it is not.
      val ans2: Resp = if (ans.kind != "open") ans
        else if (openAllowed(ans.app)) { ...ans, ctx: w.ctx }
        else { ...NORESP, kind: "err", err: "turn_context_changed", retry: false }
      val d = deliverTo(w, g, ans2, m)
      all {
        rows' = swept, workers' = workers,
        gw' = gw.set(m, { ...gw.get(m), st: if (ans2.kind == "err" and ans2.retry) "call" else "final", ans: ans2 }),
        w' = if (ans2.kind == "err") w else d.wd,
        g' = {
          ...(if (ans2.kind == "err") g else d.gh),
          // inbox.ts "STOP, START and HELP are never held back" by an ordinary turn: a compliance turn waits only for
          // another compliance turn of the sender (its own claim slot, migration 0042).
          busyKw: g.busyKw or (kw and ans2.err == "turn_busy" and not(swept.keys().contains(m)) and not(compBusy)),
          // A done turn ends in a final error only when an open turn is no longer allowed.
          doneErr: g.doneErr or (swept.keys().contains(m) and swept.get(m).st == "done" and ans2.kind == "err" and openAllowed(ans.app)),
        },
      }
    },
    now' = now, sent' = sent, banned' = banned, held' = held,
  }

  /** The gateway's request times out (8 s) while the worker may still run; it calls again with the same messageId. */
  action gwTimeout(m: int): bool = all {
    gw.keys().contains(m), gw.get(m).st == "wait",
    gw' = gw.set(m, { ...gw.get(m), st: "call", ans: NORESP }),
    now' = now, sent' = sent, rows' = rows, workers' = workers, w' = w, g' = g, banned' = banned, held' = held,
  }

  /** One transaction of a run's effects. A step that collects a reply needs the row still processing (Inbox.collect). */
  action work(r: int, c1: bool, c2: bool): bool = all {
    workerAlive(r), workers.get(r).phase < 9,
    val wk = workers.get(r)
    val m = wk.msg
    val msg = sent.get(m)
    all {
      not(collects(w, wk, msg, held)) or (rows.keys().contains(m) and rows.get(m).st == "processing"),
      val out = stepFlag(w, g, wk, msg, m, now, msg.at, banned, held, c1, c2)
      all { w' = out.wd, g' = out.gh, workers' = workers.set(r, out.wk) },
    },
    now' = now, sent' = sent, gw' = gw, rows' = rows, banned' = banned, held' = held,
  }

  /** The lease renewal in lease_at (every 30 s; a failure is swallowed, so a renewal can be missed). */
  action renew(r: int): bool = all {
    workerAlive(r),
    val m = workers.get(r).msg
    all {
      rows.keys().contains(m), rows.get(m).st == "processing",
      rows' = rows.set(m, { ...rows.get(m), lease: now }),
    },
    now' = now, sent' = sent, gw' = gw, workers' = workers, w' = w, g' = g, banned' = banned, held' = held,
  }

  /** The process stops (deploy, OOM): the run and its in-memory turn are gone; the row stays processing. */
  action crash(r: int): bool = all {
    workerAlive(r), g.crashes < 1,
    workers' = workers.set(r, { ...workers.get(r), alive: false }),
    g' = { ...g, crashes: g.crashes + 1 },
    now' = now, sent' = sent, gw' = gw, rows' = rows, w' = w, banned' = banned, held' = held,
  }

  /** Send a run's answer to the gateway request that waits for that run, or lose it (the request timed out). */
  pure def answer(gws: int -> Gw, wd: World, gh: Ghost, m: int, r: int, resp: Resp, lost: bool): { gws: int -> Gw, wd: World, gh: Ghost } =
    if (lost or gws.get(m).st != "wait" or gws.get(m).rid != r) { gws: gws, wd: wd, gh: gh }
    else {
      val d = deliverTo(wd, gh, resp, m)
      { gws: gws.set(m, { ...gws.get(m), st: if (resp.kind == "err" and resp.retry) "call" else "final", ans: resp }),
        wd: if (resp.kind == "err") wd else d.wd, gh: if (resp.kind == "err") gh else d.gh }
    }

  /** The ledger as the run read it when it set its consent. */
  pure def readBy(wd: World, wk: Worker): Set[Ev] = wd.ledger.filter(e => e.seq < wk.cseq)

  /** TurnResponse.consent agrees with the ledger the run read. */
  pure def echoOk(ledger: Set[Ev], c: Consent): bool = {
    val apps = if (c.scope == "all") APPS else Set(c.app)
    if (c.state == "in") apps.forall(a => resolve(ledger, a) == "in")
    // A STOP or a leave echoes its own event. An app with a newer opt-in than that event (SD-104, SD-105: an older STOP
    // or leave that arrived late) resolves opted in; the gateway resolves its fence by `at` (stated assumption) and
    // reaches the same result. An opt-in with the same `at` is a tie the ledger breaks by event id, which the gateway
    // cannot see; the echo of the event itself is then not wrong.
    else apps.forall(a => resolve(ledger, a) == "out" or ledger.exists(e => e.app == a and e.state == "in" and e.at >= c.at))
  }

  /**
   * The run throws, or its done update finds no processing row (inbox.ts signed: "Turn ownership changed before
   * completion"). A compliance turn is rescued (rescueCompliance): with no consent and no collected reply the claim
   * is released (turn_failed, retryable); otherwise it ends handled with its consent and confirmation, also when its
   * claim was sealed while it ran and has no answer yet (Q-turn_consent-1 fix). A compliance turn that cannot be
   * rescued replays another run's answer or asks for a retry (Q-turn_consent-3 fix). Any other turn is unresolved
   * (turn_unresolved).
   */
  pure def failOut(rs: int -> Row, gws: int -> Gw, wd: World, gh: Ghost, wk: Worker, msg: Msg, m: int, r: int, t: int, lost: bool):
      { rows: int -> Row, gws: int -> Gw, wd: World, gh: Ghost } = {
    val has = rs.keys().contains(m)
    val proc = has and rs.get(m).st == "processing"
    val sealed = has and rs.get(m).st == "unresolved" and rs.get(m).resp.kind == "none" and wk.consent.has
    val kw = isKeyword(msg.kind)
    val release = kw and proc and not(wk.consent.has) and wk.replies.size() == 0
    val partial = kw and (proc or sealed) and not(release)
    val reps1 = if (wk.conf) wk.replies.union(Set("compliance")) else wk.replies
    val rows1 = if (release) mapRemove(rs, m)
            else if (partial) rs.set(m, { ...rs.get(m), st: "done", resp: { ...NORESP, kind: "handled", consent: wk.consent, replies: reps1, app: wk.app, rseq: wk.rseq }, lease: t, handled: true })
            else if (proc) rs.set(m, { ...rs.get(m), st: "unresolved" })
            else rs
    // Q-turn_consent-3 fix: a compliance turn that cannot be rescued replays the answer of another run of the same
    // request, or, while its claim is reclaimable or was released by another run, asks the gateway to retry (turn_failed).
    val other = kw and not(release) and not(partial) and rows1.keys().contains(m) and rows1.get(m).st == "done" and rows1.get(m).resp.kind != "none"
    val again = kw and not(release) and not(partial) and (not(rows1.keys().contains(m)) or reclaimable(rows1.get(m)))
    val resp: Resp =
      if (release) { ...NORESP, kind: "err", err: "turn_failed", retry: true }
      else if (partial) rows1.get(m).resp
      else if (other) rows1.get(m).resp
      else if (again) { ...NORESP, kind: "err", err: "turn_failed", retry: true }
      else { ...NORESP, kind: "err", err: "turn_unresolved", retry: false }
    val a = answer(gws, wd, gh, m, r, resp, lost)
    { rows: rows1,
      gws: a.gws, wd: a.wd,
      gh: { ...a.gh, echoBad: a.gh.echoBad or (partial and wk.consent.has and not(echoOk(readBy(wd, wk), wk.consent))),
            cutShort: a.gh.cutShort or (partial and msg.kind == "Stop" and wk.phase == 1 and wk.todo.size() > 0) } }
  }

  action throwIn(r: int, lost: bool): bool = all {
    workerAlive(r),
    val wk = workers.get(r)
    val f = failOut(rows, gw, w, g, wk, sent.get(wk.msg), wk.msg, r, now, lost)
    all { rows' = f.rows, workers' = wkRemove(workers, r), gw' = f.gws, w' = f.wd, g' = f.gh },
    now' = now, sent' = sent, banned' = banned, held' = held,
  }

  /**
   * The run completes (inbox.ts signed, service.ts sharedTurn): done where processing, with the response. An open
   * turn needs no collected reply, an active membership with an opt-in and a context (ctxOk is the oracle for
   * sharedContext: facets and the leak check; SD-212/215 fixed in the oracle's code, SD-216 not reproduced). A row
   * that is no longer processing makes the done update throw: failOut.
   */
  action complete(r: int, lost: bool, ctxOk: bool): bool = all {
    workerAlive(r), workers.get(r).phase == 9,
    val wk = workers.get(r)
    val m = wk.msg
    val msg = sent.get(m)
    val proc = rows.keys().contains(m) and rows.get(m).st == "processing"
    val a = wk.app
    val openOk = wk.open and wk.replies.size() == 0 and openAllowed(a) and ctxOk
    val resp: Resp =
      if (openOk) { ...NORESP, kind: "open", app: a, ctx: w.ctx }
      else { ...NORESP, kind: "handled", consent: wk.consent, replies: wk.replies, app: a, rseq: wk.rseq }
    if (proc) {
      val ans = answer(gw, w, g, m, r, resp, lost)
      all {
        rows' = rows.set(m, { ...rows.get(m), st: "done", resp: resp, lease: now, handled: true }),
        workers' = wkRemove(workers, r),
        gw' = ans.gws, w' = ans.wd,
        g' = { ...ans.gh, echoBad: ans.gh.echoBad or (wk.consent.has and not(echoOk(readBy(w, wk), wk.consent))) },
      }
    } else {
      val f = failOut(rows, gw, w, g, wk, msg, m, r, now, lost)
      all { rows' = f.rows, workers' = wkRemove(workers, r), gw' = f.gws, w' = f.wd, g' = f.gh }
    },
    now' = now, sent' = sent, banned' = banned, held' = held,
  }

  /**
   * The legacy webhook drain (inbox.ts handleWaiting): compliance first, else the oldest row; ordinary rows wait while a
   * signed turn of the sender runs or ended unresolved a short while ago. A failure counts an attempt; at 5 the row is
   * failed, except a STOP, which stays pending (SD-129 fix). A handled STOP cancels the ordinary rows received before it.
   * The effects run as one step at consent time = now, with no gateway and no fence.
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
          rows' = rows.set(m, { ...rows.get(m), attempts: n,
            st: if (n >= MAX_ATTEMPTS and msg.kind != "Stop") "failed" else "pending",
            handled: n >= MAX_ATTEMPTS and msg.kind != "Stop" }),
          w' = w, g' = g,
        }
      } else {
        val s1 = stepFlag(w, g, newWorker(m, msg.app), msg, m, now, now, banned, held, c1, c2)
        val s2 = if (s1.wk.phase < 9) stepFlag(s1.wd, s1.gh, s1.wk, msg, m, now, now, banned, held, c1, c2) else s1
        val s3 = if (s2.wk.phase < 9) stepFlag(s2.wd, s2.gh, s2.wk, msg, m, now, now, banned, held, c1, c2) else s2
        val s4 = if (s3.wk.phase < 9) stepFlag(s3.wd, s3.gh, s3.wk, msg, m, now, now, banned, held, c1, c2) else s3
        val s5 = if (s4.wk.phase < 9) stepFlag(s4.wd, s4.gh, s4.wk, msg, m, now, now, banned, held, c1, c2) else s4
        val cancel = if (msg.kind == "Stop") pend.filter(k => k != m and not(isKeyword(sent.get(k).kind)) and sent.get(k).at <= msg.at) else Set()
        // inbox.ts: nothing the person wrote before a STOP is acted on after it.
        val late = not(isKeyword(msg.kind)) and sent.keys().exists(k => sent.get(k).kind == "Stop" and sent.get(k).at > msg.at
          and w.ledger.exists(e => e.ref == k and e.src == "stop"))
        all {
          rows' = rows.keys().mapBy(k =>
            if (k == m) { ...rows.get(k), st: "done", lease: now, handled: true }
            else if (k.in(cancel)) { ...rows.get(k), st: "done", lease: now, handled: true }
            else rows.get(k)),
          w' = s5.wd,
          g' = { ...s5.gh, actedAfterStop: s5.gh.actedAfterStop or late },
        }
      },
    },
    now' = now, sent' = sent, gw' = gw, workers' = workers, banned' = banned, held' = held,
  }

  /** Staff resolve a stuck signed turn (inbox.ts resolve): unresolved, no longer the sender's, handled_at not set. */
  action staffResolve(m: int): bool = all {
    rows.keys().contains(m), sent.get(m).path == "gw", rows.get(m).st.in(Set("processing", "unresolved")), rows.get(m).mine,
    rows' = rows.set(m, { ...rows.get(m), st: "unresolved", mine: false }),
    now' = now, sent' = sent, gw' = gw, workers' = workers, w' = w, g' = g, banned' = banned, held' = held,
  }

  /**
   * The tick's retention (service.ts purge): people.purge(now - 2 days) deletes rate_limits rows by last_at, but a
   * row with a minimum gap stays until keep_until = last_at + gap (SD-004 fix); inbox.purge(now - 7 days) seals done
   * signed rows, seals processing signed rows whose lease ended before the window (SD-087 fix), deletes handled legacy
   * rows and old tombstones (by arrived_at).
   */
  action purge: bool = all {
    val before = now - INBOX_KEEP
    val kept = rows.keys().filter(k => not(
      (sent.get(k).path == "wh" and rows.get(k).st.in(Set("done", "failed")) and rows.get(k).arr < before)
      or (sent.get(k).path == "gw" and rows.get(k).st == "unresolved" and rows.get(k).arr < before - TOMBSTONE_KEEP)))
    all {
      rows' = kept.mapBy(k => {
        val r = rows.get(k)
        if (sent.get(k).path == "gw" and r.st == "done" and r.lease < before) { ...r, st: "unresolved", resp: NORESP, mine: false }
        else if (sent.get(k).path == "gw" and r.st == "processing" and r.lease < before) { ...r, st: "unresolved", mine: false }
        else r
      }),
      w' = { ...w, hintLast: APPS.mapBy(a => if (w.hintLast.get(a) >= 0 and w.hintLast.get(a) < now - RATE_KEEP
        and w.hintLast.get(a) + HINT_GAP < now - RATE_KEEP) -1 else w.hintLast.get(a)) },
    },
    g' = { ...g, lastPurge: now },
    now' = now, sent' = sent, gw' = gw, workers' = workers, banned' = banned, held' = held,
  }

  /** The agent records an opt_out or safety_concern signal on an open turn (service.ts sharedAction signals): status proposed. */
  action proposeSignal(m: int): bool = all {
    rows.keys().contains(m), rows.get(m).st == "done", rows.get(m).resp.kind == "open", not(w.signals.keys().contains(m)),
    w' = { ...w, signals: w.signals.put(m, "proposed") },
    now' = now, sent' = sent, gw' = gw, rows' = rows, workers' = workers, g' = g, banned' = banned, held' = held,
  }

  /** Staff read GET /signals and decide with POST /signals (SD-036 fix): the facet status is confirmed or rejected. */
  action staffHandle(m: int): bool = all {
    w.signals.keys().contains(m), w.signals.get(m) == "proposed", not(w.staffHandled.contains(m)),
    w' = { ...w, staffHandled: w.staffHandled.union(Set(m)), signals: w.signals.set(m, "decided") },
    now' = now, sent' = sent, gw' = gw, rows' = rows, workers' = workers, g' = g, banned' = banned, held' = held,
  }

  /** The member's open-turn context changes (a facet, an item, a window edge). */
  action contextChange: bool = all {
    w.ctx < 2,
    w' = { ...w, ctx: w.ctx + 1 },
    now' = now, sent' = sent, gw' = gw, rows' = rows, workers' = workers, g' = g, banned' = banned, held' = held,
  }

  /**
   * Time passes. A run lives for minutes at most: it ends, throws, or its process stops (a deploy restarts it). So a
   * jump of more than BLOCK + 1 ticks (10.5 min) happens only when no run is alive; shorter jumps let a live run miss
   * its lease renewals.
   */
  action tick(d: int): bool = all {
    d <= BLOCK + 1 or workers.keys().forall(r => not(workers.get(r).alive)),
    now' = now + d,
    sent' = sent, gw' = gw, rows' = rows, workers' = workers, w' = w, g' = g, banned' = banned, held' = held,
  }

  /** The scheduler. Sets cannot weight a choice (duplicates collapse), so weights use an integer pick. */
  action step = {
    nondet m = (if (sent.keys().size() == 0) MSGS else sent.keys()).oneOf()
    nondet r = (if (workers.keys().size() == 0) Set(0) else workers.keys()).oneOf()
    nondet kind = KINDS.oneOf()
    nondet app = APPS.oneOf()
    // The legacy webhook is one path in four (it is not live in production: the gateway owns the webhook).
    nondet p = 0.to(3).oneOf()
    nondet c1 = Set(true, false).oneOf()
    nondet c2 = Set(true, false).oneOf()
    // A lost answer (the gateway request timed out) is one in four.
    nondet q = 0.to(3).oneOf()
    nondet d = TICK_STEPS.oneOf()
    any {
      sendText(MSGS.filter(x => not(sent.keys().contains(x))).fold(0, (acc, x) => if (acc == 0 or x < acc) x else acc), kind, app,
        if (p == 0) "wh" else "gw"),
      gwCall(m),
      gwCall(m),
      gwTimeout(m),
      work(r, c1, c2),
      work(r, c1, c2),
      work(r, c1, c2),
      renew(r),
      crash(r),
      throwIn(r, q == 0),
      complete(r, q == 0, c2),
      complete(r, q == 0, c2),
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
   * stopNeverLost. Rule: PRD 40.3 and founder decision 7 (STOP stops every app); inbox.ts "A compliance turn
   * that fails is never sealed". A STOP the reader reads as STOP that has its final answer (gateway) or its final
   * row (legacy), with no run left that could still write, has its ledger event. (SD-001, SD-129: fixed)
   */
  val stopNeverLost: bool = sent.keys().forall(m =>
    (sent.get(m).kind == "Stop" and isFinal(m) and not(msgAlive(m)))
      implies w.ledger.exists(e => e.ref == m and e.src == "stop" and e.app == "" and e.state == "out"))

  /**
   * stopPhraseHonored. Rule: AGENTS.md decision 11 (parseOptOut on the inbound path), PRD 40.3. A text the person
   * means as STOP that is final has a STOP event. The reader is an oracle; this shows what a misread reaches.
   * NOT in `safety`: SD-031 is fixed in the reader (evals/opt-out.jsonl), but the oracle `StopLikely` still stands for
   * the texts no reader reads as STOP ("STOP!! I said stop"). Which reader the inbound path uses is SD-032, skipped:
   * it needs a founder decision (parseOptOut reads "stop slop" as STOP of every app, which breaks the per-app leave).
   */
  val stopPhraseHonored: bool = sent.keys().forall(m =>
    (sent.get(m).kind == "StopLikely" and isFinal(m) and not(msgAlive(m)))
      implies w.ledger.exists(e => e.src == "stop" and e.at >= sent.get(m).at))

  /**
   * stopNeverHeldBack. Rule: inbox.ts "STOP, START and HELP are never held back" (an ordinary turn of the sender never
   * holds back a compliance turn; a compliance turn waits only for another compliance turn, migration 0042). (SD-002: fixed)
   */
  val stopNeverHeldBack: bool = not(g.busyKw)

  /** oneTurnPerSlot. Rule: inbox.ts "one ordinary and one compliance signed turn per sender" (unique index 0042). */
  val oneTurnPerSlot: bool = Set(true, false).forall(c =>
    rows.keys().filter(k => rows.get(k).st == "processing" and rows.get(k).mine and rows.get(k).comp == c).size() <= 1)

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
   * (SD-105: fixed)
   */
  val ledgerFollowsSendOrder: bool = APPS.forall(a => resolve(w.ledger, a) == resolve(g.intents, a))

  /**
   * echoMatchesLedger. Rule: AGENTS.md 2026-10-09 item 2 "Consent path" (the gateway copies consent into its fence; only
   * one system answers STOP) and README "Consent order" (an older START reports no consent). The consent a turn reports
   * agrees with the ledger the turn read when it set that consent (see echoOk; the events with seq below the worker's
   * cseq). A consent event that another turn commits later (a concurrent turn after a sweep, the legacy drain) makes an
   * answer stale, not wrong: the gateway resolves its fence by `at`, and fenceMatchesLedger checks the result.
   * (SD-037, SD-104: fixed)
   */
  val echoMatchesLedger: bool = not(g.echoBad)

  /**
   * projectionsConverge. Rule: service.ts stopped (an opted-out membership reads paused; START makes it active) and
   * AGENTS.md (the consent ledger is what the send path reads). When nothing is in flight, a live membership is paused,
   * and its network member is opted out, exactly when the ledger resolves opted_out. Under a phone hold staff own the
   * projections (SD-130 refuted), so the hold is left out.
   * NOT in `safety`: Q-turn_consent-4 (open, needs a maintainer design decision). A STOP turn that throws after its
   * ledger write and before stopped() has run for every membership is rescued as handled with its consent
   * (rescueCompliance, so the gateway fence learns the STOP at once). Nothing runs the rest of stopped() later: the
   * membership stays active and the network member is not opted out. The send path still reads the ledger. The fix
   * choices (release the claim so the retry runs the projections, which delays the fence; a reconcile pass on the tick;
   * a repair on the member's next text) change the fence-first design of inbox.ts.
   */
  val projectionsConverge: bool = (quiescent and not(held)) implies APPS.forall(a =>
    live(w, a) implies ((w.member.get(a) == "paused") == isOut(w.ledger, a) and w.optOut.get(a) == isOut(w.ledger, a)))

  /**
   * projectionsMatchLedger. projectionsConverge in every run where no STOP turn was rescued before its projections
   * (ghost cutShort, Q-turn_consent-4). (SD-104, SD-105, Q-turn_consent-1, Q-turn_consent-2: fixed)
   */
  val projectionsMatchLedger: bool = not(g.cutShort) implies projectionsConverge

  /**
   * fenceMatchesLedger. Rule: AGENTS.md 2026-10-09 item 2 "Consent path": the gateway's send-time fence follows every
   * carrier-consent change. When nothing is in flight on the signed path, the fence and the ledger agree on opted_out.
   * NOT in `safety`: the opt-in half is SD-023, partly skipped (needs upstream contract change). The fence learns a
   * consent change only from a handled turn's answer. A text join whose turn fails after it wrote its opt-in answers
   * turn_unresolved, so the fence keeps an older opt-out of that app (the member is blocked, never messaged against a
   * STOP). The same holds for the enroll and web join paths of SD-023 (not in the model). Telling the gateway about an
   * opt-in outside a turn answer needs a consent field in DeliverRequest or a new contract path, upstream first.
   */
  val fenceMatchesLedger: bool = (quiescent and onlyGateway) implies APPS.forall(a => isOut(w.fence, a) == isOut(w.ledger, a))

  /**
   * fenceHoldsEveryOptOut. The safety half of fenceMatchesLedger: when nothing is in flight on the signed path, every
   * app the ledger resolves opted_out is opted out in the gateway's fence. (SD-001, SD-029, Q-turn_consent-1,
   * Q-turn_consent-3: fixed)
   */
  val fenceHoldsEveryOptOut: bool = (quiescent and onlyGateway) implies APPS.forall(a => isOut(w.ledger, a) implies isOut(w.fence, a))

  /**
   * startResumesStop. Rule: PRD 32.2/1435 "honor STOP/HELP/START" with PRD 40.3 "STOP stops every app": START after a
   * global STOP resumes what the STOP stopped. When the newest intent is a START that is newer than a global STOP, every
   * live membership resolves opted_in.
   * NOT in `safety`: SD-024 is skipped (founder decision: the PRD does not say whether START resumes one app or every
   * app; consent.ts documents "START opts in to one app"). The code keeps the one-app design; the model shows it.
   */
  val startResumesStop: bool = quiescent implies g.intents.forall(i =>
    (i.src == "start" and g.intents.forall(j => j.at < i.at or (j.at == i.at and j.seq <= i.seq))
      and g.intents.exists(s => s.src == "stop" and s.at < i.at))
    implies APPS.forall(a => live(w, a) implies resolve(w.ledger, a) == "in"))

  /**
   * startResumesNamedApp. Rule: the STOP confirmation "Reply START to resume <app>" (consent.ts keywordEvent namedApp,
   * migration 0042). When the newest intent is a START that was sent after and handled after the newest global STOP of the
   * ledger, the app that STOP named resolves opted_in. (SD-318: fixed)
   */
  val startResumesNamedApp: bool = g.intents.forall(i =>
    (i.src == "start" and g.intents.forall(j => j.at < i.at or (j.at == i.at and j.seq <= i.seq)))
    implies lastOf(w.ledger.filter(e => e.app == "")).forall(s =>
      (s.at < i.at and s.seq < i.seq and w.named.keys().contains(s.ref)) implies resolve(w.ledger, w.named.get(s.ref)) == "in"))

  /**
   * noReplyAfterStop. Rule: service.ts stopHint and founder decision 2026-10-11 #22: after STOP only the hint and
   * confirmations go out. A non-compliance reply that a run decided after it had read an opted-out ledger is never
   * delivered past the fence. Signed path only (the legacy path never feeds the fence).
   * NOT in `safety`: Q-turn_consent-5 (open, needs a maintainer design decision). The backend collects the join ask
   * (service.ts inbound: "refused at send time"), and the Network's reply where the projection lags, for an app whose
   * ledger the run read as opted out; it relies on the gateway fence. While the opt-out's own turn has not answered yet
   * (it runs concurrently in the compliance slot, or it failed and the gateway retries it), the fence does not know the
   * opt-out and the reply goes out. Closing it means filtering such replies in the backend instead of at the fence.
   * The fence half of SD-029 and Q-turn_consent-1 (the fence never learns the opt-out) is fixed and checked by
   * fenceMatchesLedger.
   */
  val noReplyAfterStop: bool = onlyGateway implies not(g.replyAfterStop)

  /** bannedOnlyCompliance. Rule: AGENTS.md 2026-10-09 item 3 (refused at inbound) and service.ts inbound ban check. (SD-073: fixed) */
  val bannedOnlyCompliance: bool = not(g.bannedReply)

  /** leaveNeverOptsIn. Rule: consent.ts and service.ts "leave <app>" leaves that app only; it never joins. (SD-490, SD-314: fixed) */
  val leaveNeverOptsIn: bool = not(g.leaveOptIn)

  /** nothingBeforeStopActedAfter. Rule: inbox.ts header (a waiting row is never acted on after a STOP). (SD-493: fixed) */
  val nothingBeforeStopActedAfter: bool = not(g.actedAfterStop)

  /** oneHintPer30Days. Rule: service.ts stopHint and PRD 40.3: one stop hint in 30 days per number and app. (SD-004: fixed) */
  val oneHintPer30Days: bool = APPS.forall(a => w.hintLog.get(a).forall(x => w.hintLog.get(a).forall(y =>
    x == y or x - y >= HINT_GAP or y - x >= HINT_GAP)))

  /**
   * processingEnds. Rule: inbox.ts "a turn still processing 2 minutes after its last renewal lost its worker and
   * reads as unresolved"; nothing is kept past the inbox retention (7 days): after a retention purge, no processing row
   * without a live run has a lease older than that purge's window. (SD-087: fixed)
   */
  val processingEnds: bool = rows.keys().forall(k =>
    (rows.get(k).st == "processing" and not(msgAlive(k))) implies rows.get(k).lease >= g.lastPurge - INBOX_KEEP)

  /** doneTurnAnswered. Rule: inbox.ts: a done turn replays its answer; an open turn replays while it is allowed. (SD-313: fixed) */
  val doneTurnAnswered: bool = not(g.doneErr)

  /** signalHasExit. Rule: service.ts "they wait for a person in GET /signals": a handled signal leaves the queue. (SD-036: fixed) */
  val signalHasExit: bool = w.staffHandled.forall(s => w.signals.get(s) != "proposed")

  val safety: bool = and {
    stopNeverLost,
    stopNeverHeldBack,
    oneTurnPerSlot,
    stopAllApps,
    ledgerFollowsSendOrder,
    echoMatchesLedger,
    projectionsMatchLedger,
    fenceHoldsEveryOptOut,
    startResumesNamedApp,
    bannedOnlyCompliance,
    leaveNeverOptsIn,
    nothingBeforeStopActedAfter,
    oneHintPer30Days,
    processingEnds,
    doneTurnAnswered,
    signalHasExit,
  }

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
  /** A crashed run leaves a processing row. */
  val witness_orphan: bool = not(rows.keys().exists(k => rows.get(k).st == "processing"
    and workers.keys().exists(r => workers.get(r).msg == k and not(workers.get(r).alive))))
  /** A stop hint goes out. */
  val witness_hint: bool = not(APPS.exists(a => w.hintLog.get(a).size() > 0))
  /** A compliance turn is claimed again after its claim was swept or resolved (SD-001 fix): a second run of a message. */
  val witness_reclaim: bool = not(MSGS.exists(m => runsOf(g.runs, m) >= 2))
  /** A STOP runs while an ordinary turn of the sender holds its claim (SD-002 fix). */
  val witness_twoSlots: bool = not(Set(true, false).forall(c =>
    rows.keys().exists(k => rows.get(k).st == "processing" and rows.get(k).mine and rows.get(k).comp == c)))

  // ------------------------------------------------------------------ run tests (traces from the code and its tests)
  // Run ids: the first run of message m is m, the second is m + 10 (a reclaim, SD-001 fix).

  /** eliza-takeover.integration.test.ts: STOP with scope all, handled; ledger and fence both opted out. */
  run stopTurnTest =
    initWith("active", "active", false, false)
      .then(sendText(1, "Stop", "A", "gw"))
      .then(gwCall(1))
      .then(work(1, false, false)).then(work(1, false, false)).then(work(1, false, false)).then(work(1, false, false))
      .then(complete(1, false, false))
      .expect(and {
        gw.get(1).st == "final", gw.get(1).ans.consent.scope == "all",
        APPS.forall(a => isOut(w.ledger, a) and isOut(w.fence, a)),
        w.member.get("A") == "paused", w.member.get("B") == "paused", safety,
      })

  /** inbox-order.integration.test.ts: a STOP turn that throws before its consent change: turn_failed, the retry succeeds. */
  run stopThrowsBeforeConsentTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Stop", "A", "gw"))
      .then(gwCall(1))
      .then(throwIn(1, false))
      .expect(gw.get(1).st == "call" and not(rows.keys().contains(1)))
      .then(gwCall(1))
      .then(work(11, false, false)).then(work(11, false, false)).then(work(11, false, false))
      .then(complete(11, false, false))
      .expect(gw.get(1).ans.kind == "handled" and isOut(w.ledger, "A") and safety)

  /** inbox-order.integration.test.ts: a STOP turn that throws after its consent change answers handled with the consent. */
  run stopThrowsAfterConsentTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Stop", "A", "gw"))
      .then(gwCall(1))
      .then(work(1, false, false))
      .then(throwIn(1, false))
      .expect(gw.get(1).ans.kind == "handled" and gw.get(1).ans.consent.state == "out" and gw.get(1).ans.replies.contains("compliance")
        and g.cutShort and not(projectionsConverge) and safety)

  /** inbox-order.integration.test.ts: a retry of a running turn is told to retry (turn_busy). */
  run busyRetryTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Chat", "A", "gw"))
      .then(gwCall(1))
      .then(gwTimeout(1))
      .then(gwCall(1))
      .expect(gw.get(1).st == "call" and gw.get(1).ans.err == "turn_busy")

  /** eliza-takeover.integration.test.ts: an older START that loses reports no consent. */
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
      .expect(not(gw.get(1).ans.consent.has) and isOut(w.ledger, "A") and w.member.get("A") == "paused" and safety)

  /** SD-001 (fixed): a claimed STOP whose worker died is claimed again on the retry after the lease and runs to the end. */
  run sd001StopReclaimedTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Stop", "A", "gw"))
      .then(gwCall(1))
      .then(crash(1))
      .then(gwTimeout(1))
      .then(gwCall(1))
      .expect(gw.get(1).ans.err == "turn_busy" and gw.get(1).st == "call")
      .then(tick(5))
      .then(gwCall(1))
      .then(work(11, false, false)).then(work(11, false, false)).then(work(11, false, false))
      .then(complete(11, false, false))
      .expect(and {
        gw.get(1).st == "final", gw.get(1).ans.kind == "handled", gw.get(1).ans.consent.scope == "all",
        isOut(w.ledger, "A"), isOut(w.fence, "A"), w.member.get("A") == "paused", stopNeverLost, safety,
      })

  /** SD-001 (fixed), the milder form: the worker dies after the ledger write; the rerun writes no second event and ends the projections. */
  run sd001StopAfterLedgerTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Stop", "A", "gw"))
      .then(gwCall(1)).then(work(1, false, false))
      .then(crash(1)).then(gwTimeout(1)).then(tick(5)).then(gwCall(1))
      .then(work(11, false, false)).then(work(11, false, false)).then(work(11, false, false))
      .then(complete(11, false, false))
      .expect(and {
        w.ledger.filter(e => e.src == "stop").size() == 1, isOut(w.fence, "A"),
        w.member.get("A") == "paused", w.optOut.get("A"), fenceMatchesLedger, projectionsConverge, safety,
      })

  /** SD-002 (fixed): a STOP while an ordinary turn of the sender is processing runs in the compliance slot. */
  run sd002StopBesideChatTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Chat", "A", "gw"))
      .then(gwCall(1))
      .then(sendText(2, "Stop", "A", "gw"))
      .then(gwCall(2))
      .then(work(2, false, false)).then(work(2, false, false)).then(work(2, false, false))
      .then(complete(2, false, false))
      .expect(gw.get(2).ans.kind == "handled" and gw.get(2).ans.consent.scope == "all" and stopNeverHeldBack and oneTurnPerSlot)
      .then(sendText(3, "Chat", "A", "gw"))
      .then(gwCall(3))
      .expect(gw.get(3).ans.err == "turn_busy" and gw.get(3).st == "call")

  /** SD-104 (fixed): an older STOP handled after a newer START leaves A active and opted in, as the ledger reads. */
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
      .expect(and {
        resolve(w.ledger, "A") == "in", w.member.get("A") == "active", not(w.optOut.get("A")), not(isOut(w.fence, "A")),
        gw.get(1).ans.replies.contains("compliance"), echoMatchesLedger, projectionsMatchLedger, safety,
      })

  /** SD-037 (fixed): STOP, then a late START (sent before it) from a non-member reports no consent and no join ask. */
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
      .expect(and {
        not(gw.get(1).ans.consent.has), gw.get(1).ans.replies == Set(), isOut(w.ledger, "A"), isOut(w.fence, "A"),
        echoMatchesLedger, safety,
      })

  /** SD-024 (skipped, founder decision): STOP stops A and B; START resumes only the app the STOP named (A). */
  run sd024StartOneAppTest =
    initWith("active", "active", false, false)
      .then(sendText(1, "Stop", "A", "gw"))
      .then(gwCall(1))
      .then(work(1, false, false)).then(work(1, false, false)).then(work(1, false, false)).then(work(1, false, false))
      .then(complete(1, false, false))
      .then(tick(1))
      .then(sendText(2, "Start", "B", "gw"))
      .then(gwCall(2))
      .then(work(2, false, false)).then(work(2, false, false))
      .then(complete(2, false, false))
      .expect(and {
        resolve(w.ledger, "A") == "in", isOut(w.ledger, "B"), w.member.get("B") == "paused",
        not(startResumesStop), startResumesNamedApp, safety,
      })

  /** SD-318 (fixed): STOP routed to B names B; a START that routing would give to A resumes B. */
  run sd318StartNamedAppTest =
    initWith("active", "active", false, false)
      .then(sendText(1, "Stop", "B", "gw"))
      .then(gwCall(1))
      .then(work(1, false, false)).then(work(1, false, false)).then(work(1, false, false)).then(work(1, false, false))
      .then(complete(1, false, false))
      .then(tick(1))
      .then(sendText(2, "Start", "A", "gw"))
      .then(gwCall(2))
      .then(work(2, false, false)).then(work(2, false, false))
      .then(complete(2, false, false))
      .expect(and {
        gw.get(2).ans.consent.app == "B", resolve(w.ledger, "B") == "in", isOut(w.ledger, "A"),
        w.member.get("B") == "active", w.member.get("A") == "paused", startResumesNamedApp, safety,
      })

  /** SD-023 (fixed for the text join): STOP, then a text join to app B reports its opt-in; the fence opts B in. */
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
      .expect(and {
        gw.get(2).ans.consent.state == "in", resolve(w.ledger, "B") == "in", not(isOut(w.fence, "B")),
        fenceMatchesLedger, safety,
      })

  /** SD-023 (skipped part): a text join that fails after its opt-in answers turn_unresolved; the fence keeps B opted out. */
  run sd023FailedJoinTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Stop", "A", "gw"))
      .then(gwCall(1))
      .then(work(1, false, false)).then(work(1, false, false)).then(work(1, false, false))
      .then(complete(1, false, false))
      .then(tick(1))
      .then(sendText(2, "Join", "B", "gw"))
      .then(gwCall(2))
      .then(work(2, true, false))
      .then(throwIn(2, false))
      .expect(and {
        gw.get(2).ans.err == "turn_unresolved", resolve(w.ledger, "B") == "in", isOut(w.fence, "B"),
        not(fenceMatchesLedger), fenceHoldsEveryOptOut, safety,
      })

  /** SD-105 (fixed): a leave sent first and handled after a newer START is ordered by its own time: A stays a member, opted in. */
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
      .then(work(1, false, false)).then(work(1, false, false)).then(work(1, false, false))
      .then(complete(1, false, false))
      .expect(and {
        resolve(w.ledger, "A") == "in", resolve(g.intents, "A") == "in", w.member.get("A") == "active",
        not(isOut(w.fence, "A")), ledgerFollowsSendOrder, echoMatchesLedger, safety,
      })

  /** SD-004 (fixed): a hint, then the 2-day purge keeps the stop-hint row; no second hint inside 30 days. */
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
      .expect(w.hintLog.get("A").size() == 1 and not(gw.get(3).ans.replies.contains("compliance")) and oneHintPer30Days and safety)

  /** SD-490 (fixed): "leave A" during a pending join of A ends that join; the person does not join. */
  run sd490LeaveEndsJoinTest =
    initWith("none", "none", false, false)
      .then(sendText(1, "Join", "A", "gw"))
      .then(gwCall(1)).then(work(1, false, true)).then(complete(1, false, false))
      .expect(w.pendingJoin == "A")
      .then(sendText(2, "Leave", "A", "gw"))
      .then(gwCall(2)).then(work(2, false, false)).then(work(2, false, false)).then(work(2, false, false))
      .then(complete(2, false, false))
      .expect(and {
        w.pendingJoin == "", w.member.get("A") == "none", isOut(w.ledger, "A"), leaveNeverOptsIn, safety,
      })

  /** SD-314 (fixed): "leave A" from a stranger leaves A (an app opt-out and the confirmation) and starts no join. */
  run sd314StrangerLeaveTest =
    initWith("none", "none", false, false)
      .then(sendText(1, "Leave", "A", "gw"))
      .then(gwCall(1)).then(work(1, false, false)).then(work(1, false, false)).then(work(1, false, false))
      .then(complete(1, false, false))
      .expect(and {
        gw.get(1).ans.replies == Set("compliance"), gw.get(1).ans.consent.scope == "app", isOut(w.fence, "A"),
        isOut(w.ledger, "A"), w.member.get("A") == "none", safety,
      })

  /** SD-036 (fixed): staff decide a proposed signal; it leaves the queue. */
  run sd036SignalTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Chat", "A", "gw"))
      .then(gwCall(1)).then(work(1, false, false)).then(complete(1, false, true))
      .then(proposeSignal(1))
      .then(staffHandle(1))
      .expect(w.signals.get(1) == "decided" and signalHasExit and safety)

  /** SD-073 (fixed): a banned member's text is not handled or answered. */
  run sd073BannedTest =
    initWith("active", "none", true, false)
      .then(sendText(1, "Chat", "A", "gw"))
      .then(gwCall(1)).then(work(1, true, false)).then(complete(1, false, false))
      .expect(gw.get(1).ans.kind == "handled" and gw.get(1).ans.replies == Set() and bannedOnlyCompliance and safety)

  /** SD-087 (fixed): a crashed turn of a sender who never writes again ends unresolved at the retention purge. */
  run sd087OrphanTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Chat", "A", "gw"))
      .then(gwCall(1)).then(crash(1))
      .then(tick(8 * DAY)).then(purge)
      .expect(rows.get(1).st == "unresolved" and not(rows.get(1).mine) and processingEnds and safety)

  /** SD-129 (fixed): a legacy STOP row that fails 5 times stays pending; the next drain records the STOP. */
  run sd129LegacyStopRetriedTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Stop", "A", "wh"))
      .then(drain(1, true, false, false)).then(drain(1, true, false, false)).then(drain(1, true, false, false))
      .then(drain(1, true, false, false)).then(drain(1, true, false, false))
      .expect(rows.get(1).st == "pending" and rows.get(1).attempts == 5)
      .then(drain(1, false, false, false))
      .expect(rows.get(1).st == "done" and isOut(w.ledger, "A") and stopNeverLost and safety)

  /** SD-493 (fixed): a signed STOP's claim cancels a legacy join answer the person sent before it. */
  run sd493LegacyCancelledTest =
    initWith("none", "none", false, false)
      .then(sendText(1, "Join", "A", "wh"))
      .then(tick(1))
      .then(sendText(2, "Stop", "A", "gw"))
      .then(gwCall(2))
      .expect(rows.get(1).st == "done")
      .then(work(2, false, false)).then(work(2, false, false)).then(complete(2, false, false))
      .expect(w.member.get("A") == "none" and nothingBeforeStopActedAfter and safety)

  /** SD-313 (fixed): an open turn's answer is lost, the context changes; the replay answers open with the current context. */
  run sd313ContextChangedTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Chat", "A", "gw"))
      .then(gwCall(1)).then(work(1, false, false)).then(complete(1, true, true))
      .then(contextChange).then(gwTimeout(1)).then(gwCall(1))
      .expect(gw.get(1).st == "final" and gw.get(1).ans.kind == "open" and gw.get(1).ans.ctx == 1 and doneTurnAnswered and safety)

  /**
   * Q-turn_consent-1 (fixed): staff resolve a STOP's claim while its worker runs. The worker commits the STOP and its
   * projections, the confirmation collect fails, and rescueCompliance still answers the committed consent.
   */
  run q1StopSealedWhileRunningTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Stop", "A", "gw"))
      .then(gwCall(1))
      .then(staffResolve(1))
      .then(work(1, false, false)).then(work(1, false, false))
      .then(throwIn(1, false))
      .expect(and {
        gw.get(1).ans.kind == "handled", gw.get(1).ans.consent.scope == "all", gw.get(1).ans.replies.contains("compliance"),
        isOut(w.ledger, "A"), isOut(w.fence, "A"), w.member.get("A") == "paused", fenceMatchesLedger, safety,
      })

  /** Q-turn_consent-2 (fixed): a join answer handled after a newer STOP leaves the member paused and opted out, with no welcome. */
  run q2JoinAfterStopTest =
    initWith("none", "none", false, false)
      .then(sendText(1, "Join", "A", "gw"))
      .then(tick(1))
      .then(sendText(2, "Stop", "A", "gw"))
      .then(gwCall(2)).then(work(2, false, false)).then(work(2, false, false)).then(complete(2, false, false))
      .then(gwCall(1)).then(work(1, true, false)).then(complete(1, false, false))
      .expect(and {
        isOut(w.ledger, "A"), w.member.get("A") == "paused", w.optOut.get("A"), not(gw.get(1).ans.consent.has),
        gw.get(1).ans.replies == Set(), projectionsMatchLedger, safety,
      })

  /**
   * SD-029 (fixed here by the SD-314 fix): "leave A" throws after the leave wrote the opt-out and removed the
   * membership. The claim is released; the retry is a leave again (never a join ask) and reports the app opt-out.
   */
  run sd029LeaveRetriedTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Leave", "A", "gw"))
      .then(gwCall(1)).then(work(1, false, false)).then(work(1, false, false))
      .then(throwIn(1, false))
      .expect(gw.get(1).ans.err == "turn_failed" and isOut(w.ledger, "A") and w.member.get("A") == "removed")
      .then(gwCall(1)).then(work(11, false, false)).then(work(11, false, false)).then(work(11, false, false))
      .then(complete(11, false, false))
      .expect(and {
        gw.get(1).st == "final", gw.get(1).ans.consent.state == "out", gw.get(1).ans.replies == Set("compliance"),
        w.ledger.filter(e => e.src == "leave").size() == 1, isOut(w.fence, "A"), fenceMatchesLedger, noReplyAfterStop, safety,
      })

  /**
   * Q-turn_consent-3 (fixed): a STOP whose worker died is swept by a leave's claim. While the leave runs in the
   * compliance slot, the STOP's retry cannot claim again; it is told to retry (turn_busy), not refused for ever.
   */
  run q3ReclaimWaitsTest =
    initWith("active", "active", false, false)
      .then(sendText(1, "Stop", "A", "gw"))
      .then(gwCall(1)).then(crash(1)).then(gwTimeout(1))
      .then(tick(5))
      .then(sendText(2, "Leave", "B", "gw"))
      .then(gwCall(2))
      .expect(rows.get(1).st == "unresolved" and rows.get(2).st == "processing")
      .then(gwCall(1))
      .expect(gw.get(1).st == "call" and gw.get(1).ans.err == "turn_busy")
      .then(work(2, false, false)).then(work(2, false, false)).then(work(2, false, false)).then(complete(2, false, false))
      .then(gwCall(1))
      .then(work(11, false, false)).then(work(11, false, false)).then(work(11, false, false))
      .then(complete(11, false, false))
      .expect(gw.get(1).ans.kind == "handled" and isOut(w.ledger, "A") and isOut(w.fence, "A") and stopNeverLost and safety)

  /**
   * Q-turn_consent-3 (fixed): staff resolve a leave's claim while it runs; it throws before it set its consent. Its
   * claim is still reclaimable, so it answers turn_failed (retryable) and the retry reports the opt-out.
   */
  run q3SealedBeforeConsentTest =
    initWith("active", "active", false, false)
      .then(sendText(1, "Leave", "A", "gw"))
      .then(gwCall(1)).then(staffResolve(1)).then(work(1, false, false))
      .then(throwIn(1, false))
      .expect(gw.get(1).st == "call" and gw.get(1).ans.err == "turn_failed")
      .then(gwCall(1))
      .then(work(11, false, false)).then(work(11, false, false)).then(work(11, false, false))
      .then(complete(11, false, false))
      .expect(gw.get(1).ans.consent.state == "out" and isOut(w.fence, "A") and fenceMatchesLedger and safety)

  /**
   * Q-turn_consent-5 (open): a leave of A runs in the compliance slot beside a chat to A. The leave commits; the chat
   * of the non-member now gets the join ask, which reaches the gateway before the leave's answer: the fence lets it go.
   */
  run q5ReplyBeforeFenceTest =
    initWith("active", "none", false, false)
      .then(sendText(1, "Leave", "A", "gw"))
      .then(gwCall(1)).then(work(1, false, false)).then(work(1, false, false))
      .then(sendText(2, "Chat", "A", "gw"))
      .then(throwIn(1, false))
      .then(gwCall(2)).then(work(2, false, false)).then(complete(2, false, false))
      .expect(gw.get(2).ans.replies.contains("reply") and isOut(w.ledger, "A") and not(isOut(w.fence, "A")) and not(noReplyAfterStop) and safety)
}
