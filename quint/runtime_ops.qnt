// -*- mode: Bluespec; -*-
// quint-check: max-steps=24 max-samples=6000 verify-steps=5
//
// Runtime and operations machines (docs/research/2026-11-07-state-machines.md section 6.14):
//   M-088 store-unit-of-work     packages/network/src/store.ts:53-79, 306-333
//   M-089 pg-restore-recovery    docs/runbook-real.md 8.3, deploy/backup/restore.ts, deploy/backup/lib.ts
//   M-140 retention-loop         packages/network/service/service.ts:568-577
//   M-141 backend-tick-loop      deploy/backend/backend.ts:385-416 (tickSet "backend"), serve.ts:124-136 ("serve")
//   M-142 backend-process-lifecycle deploy/backend/backend.ts:424-437, server.ts:131-139
//   M-143 backend-boot           deploy/backend/server.ts:37-64, backend.ts:447-461
//   M-144 migration-runner       packages/observatory/db/migrate.ts:74-108
//   M-147 cf-backend-cutover     deploy/cloudflare/worker.ts
//   M-149 wrangler-deploy-guard  scripts/wrangler.sh:57-101
//   M-150 alert-dispatcher       deploy/backend/ops.ts:193-221, 270-315, 381-442, 528-543
//   M-151 bias-report-cadence    packages/network/service/service.ts:533-552
//   M-152 bias-alert-lifecycle   ops.ts:246 (24 h window), ops.ts:288, ops.ts:415-421
//   M-153 llm-call               packages/core/src/llm.ts:236-342
//
// One state variable `s` holds one record per machine, so that each action changes only its own part.
// Time is an integer tick. The named thresholds keep the order of the real values, not their size.
// Oracles (a read error, a webhook result, a rate limit, an LLM reply, an operator choice) are nondet.
//
// Expected `safety` failures and their register ids: SD-003, SD-050, SD-110, SD-111, SD-113, SD-158,
// SD-159, SD-161, SD-163, SD-165, SD-168, SD-169, SD-233, SD-235, SD-360, SD-368, SD-446, SD-448.
module runtime_ops {

  // ------------------------------------------------------------------ constants

  pure val REPLICAS = Set("A", "B")
  /** Units of work that each record one STOP (an inbound unit under the network lock). */
  pure val EVENTS = Set("stop1", "stop2")
  pure val NETWORKS = Set("slop:nyc", "slop:la")
  pure val MAX_T = 14
  /** 24 h: the window of the 24 h counts (ops.ts:232-246). */
  pure val DAY = 2
  /** BIAS_EVERY_MS, 7 days (bias.ts:14). */
  pure val WEEK = 4
  /** ALERT_TICK_LATE_MS (ops.ts:86). */
  pure val TICK_LATE = 2
  /** ALERT_REPEAT_MS, 6 h (ops.ts:91): longer than one round. */
  pure val REPEAT = 4
  /** Rounds a due row (waiting inbound, expired retention row) may wait for its caller. */
  pure val STALE = 2
  /** SHUTDOWN_GRACE_MS 25 s (backend.ts:165) is shorter than Railway's SIGKILL at 30 s. */
  pure val GRACE = 2
  pure val KILL = 3
  /** llm.ts: two endpoints (Surplus, then OpenAI), LLM_MAX_RETRIES (bounded here to 2), MAX_REGROWS = 2. */
  pure val EPS = 2
  pure val MAX_RETRIES = 2
  pure val MAX_REGROWS = 2
  pure val MAX_SIG = 3
  /** The tokens the wrangler guard model gives after "deploy". */
  pure val WR_TOKENS = Set("--dry-run", "--no-dry-run", "--dry-run=false", "--help", "--no-help", "--help=false")
  pure val ALERT_KEYS = Set("sig", "tick", "bias", "read")

  // ------------------------------------------------------------------ types

  type Unit = { phase: str, ev: str }

  /** M-088, M-089: the network_state row, the advisory lock, two replicas, backup and restore. */
  type Store = {
    committed: Set[str],
    lockHolder: str,
    lostConn: bool,
    unit: str -> Unit,
    mem: str -> Set[str],
    used: Set[str],
    acked: Set[str],
    channel: str,
    backup: Set[str],
    backupTaken: bool,
    restored: bool,
    rolledBack: Set[str],
    rolesOnSource: bool,
    twoCities: bool,
    oppSeq: str -> int,
    oppRows: int -> str,
    minted: Set[(str, int)],
  }

  /** M-140, M-141: one tick loop. Ages are -1 when no row waits. */
  type Ticks = {
    tickSet: str,
    inboxAge: int,
    expiredAge: int,
    lastTickRan: int,
    lastSave: int,
    lastRoundAt: int,
  }

  type AState = { open: bool, count: int, sent: bool, lastSentAt: int, lastSentCount: int, failedWhileOpen: bool }
  type Cur = { on: bool, count: int, bump: bool }

  /** M-150: network.ops_alerts by key, the world it reads, and ghosts for the rules. */
  type Alerts = {
    st: str -> AState,
    sigWaiting: int,
    lastOpsAt: int,
    posts: int,
    badResolve: bool,
    bumpMissed: bool,
    silentClose: bool,
    heartbeatLie: bool,
  }

  /** M-151, M-152: network.bias_reports and the per-replica afterTick step. */
  type Bias = {
    phase: str -> str,
    reports: Set[(int, int, str)],
    failedSinceReport: bool,
    dirtyRead: bool,
  }

  /** M-142. */
  type Proc = { phase: str, stuck: str, sigtermAt: int, graceAt: int, clean: bool }

  /** M-143, M-144. */
  type Boot = { roleExists: bool, member: bool, connect: bool, step: str, checkPassedIncomplete: bool, ledger: bool, applied: int }

  /** M-153. */
  type Llm = { e: int, retries: int, regrows: int, attempts: int, done: str }

  /** M-149. */
  type Wr = { args: List[str], ran: bool, allowed: bool, deploys: bool }

  /** M-147. */
  type Cf = { target: str, enabled: bool, buildIdOk: bool, containerRunning: bool, cronSinceInactive: bool }

  type S = { now: int, st: Store, tk: Ticks, al: Alerts, bi: Bias, pr: Proc, bt: Boot, ll: Llm, wr: Wr, cf: Cf }

  var s: S

  // ------------------------------------------------------------------ helpers

  pure val CLOSED: AState = { open: false, count: 0, sent: false, lastSentAt: -100, lastSentCount: 0, failedWhileOpen: false }
  pure val OFF: Cur = { on: false, count: 0, bump: false }

  pure def maxOf(xs: Set[int], dflt: int): int = xs.fold(dflt, (acc, x) => if (x > acc) x else acc)
  pure def abs(x: int): int = if (x < 0) -x else x

  /** ops.ts:201: the newer of the stored tick and the row's saved_at. */
  pure def lastSeen(tk: Ticks): int = if (tk.lastTickRan > tk.lastSave) tk.lastTickRan else tk.lastSave

  /** ops.ts:246: sum(alerts) of bias reports written after now - 24 h. */
  pure def biasAlerts24h(bi: Bias, now: int): int =
    bi.reports.filter(r => r._1 > now - DAY).fold(0, (acc, r) => acc + r._2)

  pure def lastReportAt(bi: Bias): int = maxOf(bi.reports.map(r => r._1), -WEEK)

  /** evaluate() (ops.ts:270-297) for one network. A read error gives only ops_read (ops.ts:274). */
  pure def current(x: S, readOk: bool): str -> Cur =
    if (not(readOk))
      ALERT_KEYS.mapBy(k => if (k == "read") { on: true, count: 1, bump: false } else OFF)
    else
      ALERT_KEYS.mapBy(k =>
        if (k == "sig") { on: x.al.sigWaiting > 0, count: x.al.sigWaiting, bump: true }
        else if (k == "tick") { on: x.now - lastSeen(x.tk) > TICK_LATE, count: 1, bump: false }
        else if (k == "bias") { on: biasAlerts24h(x.bi, x.now) > 0, count: biasAlerts24h(x.bi, x.now), bump: true }
        else OFF)

  /** ops.ts:405-407. */
  pure def nextA(prev: AState, c: Cur): AState =
    if (prev.open) { ...prev, count: c.count } else { ...CLOSED, open: true, count: c.count }

  /** ops.ts:408-411 (one level per key here, so the level clause is left out). */
  pure def isDue(a: AState, c: Cur, now: int): bool =
    or { not(a.sent), and { c.bump, c.count > a.lastSentCount }, now - a.lastSentAt >= REPEAT }

  /** wrangler.sh decide(): one token. Classes follow the case arms at :64-75 for the tokens in WR_TOKENS. */
  type D = { dry: bool, help: bool, skip: bool, words: List[str] }
  pure def decideStep(mode: str, d: D, a: str): D =
    if (d.skip) { ...d, skip: false }
    else if (a == "--dry-run") { ...d, dry: true }
    else if (a == "--no-dry-run" or a == "--dry-run=false") { ...d, dry: false }
    else if (a == "--help") { ...d, help: true }
    else if (a == "--help=false") d
    else if (a == "--no-help") (if (mode == "value") { ...d, skip: true } else d)
    else { ...d, words: d.words.append(a) }
  pure def decide(mode: str, args: List[str]): bool =
    val d = args.foldl({ dry: false, help: false, skip: false, words: List() }, (acc, a) => decideStep(mode, acc, a))
    or { d.words.length() == 0, and { d.words[0] == "deploy", d.dry }, d.help }
  /** What wrangler (yargs) does: the last value of a switch wins; "--no-x" and "--x=false" set it false. Assumption, not run. */
  type Y = { dry: bool, help: bool }
  pure def yargsStep(y: Y, a: str): Y =
    if (a == "--dry-run") { ...y, dry: true }
    else if (a == "--no-dry-run" or a == "--dry-run=false") { ...y, dry: false }
    else if (a == "--help") { ...y, help: true }
    else if (a == "--no-help" or a == "--help=false") { ...y, help: false }
    else y
  pure def wranglerDeploys(args: List[str]): bool =
    val y = args.foldl({ dry: false, help: false }, (acc, a) => yargsStep(acc, a))
    and { args[0] == "deploy", not(y.dry), not(y.help) }

  /** deploy/cloudflare/worker.ts:70: every request goes to the public port. The staff port (backend.ts:14-15) has no route. */
  pure def staffRouteExists(target: str): bool = target == "railway"

  // ------------------------------------------------------------------ init

  action initWith(tickSet: str, channel: str, twoCities: bool, args: List[str]): bool = s' = {
    now: 0,
    st: {
      committed: Set(), lockHolder: "", lostConn: false,
      unit: REPLICAS.mapBy(_ => { phase: "idle", ev: "" }),
      mem: REPLICAS.mapBy(_ => Set()),
      used: Set(), acked: Set(), channel: channel,
      backup: Set(), backupTaken: false, restored: false, rolledBack: Set(), rolesOnSource: false,
      twoCities: twoCities, oppSeq: NETWORKS.mapBy(_ => 0), oppRows: Map(), minted: Set(),
    },
    tk: { tickSet: tickSet, inboxAge: -1, expiredAge: -1, lastTickRan: 0, lastSave: 0, lastRoundAt: -1 },
    al: { st: ALERT_KEYS.mapBy(_ => CLOSED), sigWaiting: 0, lastOpsAt: -1, posts: 0,
          badResolve: false, bumpMissed: false, silentClose: false, heartbeatLie: false },
    bi: { phase: REPLICAS.mapBy(_ => "idle"), reports: Set(), failedSinceReport: false, dirtyRead: false },
    pr: { phase: "running", stuck: "none", sigtermAt: -1, graceAt: -1, clean: false },
    bt: { roleExists: false, member: false, connect: false, step: "start", checkPassedIncomplete: false, ledger: false, applied: 0 },
    ll: { e: 0, retries: 0, regrows: 0, attempts: 0, done: "" },
    wr: { args: args, ran: false, allowed: false, deploys: false },
    cf: { target: "railway", enabled: false, buildIdOk: false, containerRunning: false, cronSinceInactive: false },
  }

  action init = {
    nondet tickSet = oneOf(Set("backend", "serve"))
    nondet channel = oneOf(Set("eliza_cloud", "blooio"))
    nondet two = oneOf(Set(true, false))
    nondet a1 = oneOf(WR_TOKENS)
    nondet a2 = oneOf(WR_TOKENS)
    initWith(tickSet, channel, two, List("deploy", a1, a2))
  }

  // ------------------------------------------------------------------ time

  /** A timer that is due fires before time passes: s.stop(false) with nothing in flight, and the grace timer. */
  def urgent(x: S): bool = or {
    and { x.pr.phase == "stopping", x.pr.stuck != "http" },
    and { x.pr.phase == "waiting", x.pr.stuck == "none" },
    and { x.pr.phase == "waiting", x.now >= x.pr.graceAt + GRACE },
  }

  action advance = all { s.now < MAX_T, not(urgent(s)), s' = { ...s, now: s.now + 1 } }

  // ------------------------------------------------------------------ M-088 store unit of work

  /** store.ts:320-329: pg_advisory_lock on one reserved connection (the in-process queue serializes one replica). */
  action takeLock(r: str, e: str): bool = all {
    s.st.unit.get(r).phase == "idle", s.st.lockHolder == "", not(s.st.used.contains(e)),
    s' = { ...s, st: { ...s.st, lockHolder: r, used: s.st.used.union(Set(e)), unit: s.st.unit.set(r, { phase: "locked", ev: e }) } },
  }
  /** store.ts:54-55, PgStore.load (:249-256) on a pool connection: importState of the newest row. */
  action load(r: str): bool = all {
    s.st.unit.get(r).phase == "locked",
    s' = { ...s, st: { ...s.st, mem: s.st.mem.set(r, s.st.committed), unit: s.st.unit.set(r, { ...s.st.unit.get(r), phase: "applied" }) } },
  }
  /** fn(net) changes memory before the save: the STOP is in this replica's memory, not yet committed. */
  action apply(r: str): bool = all {
    s.st.unit.get(r).phase == "applied", not(s.st.mem.get(r).contains(s.st.unit.get(r).ev)),
    s' = { ...s, st: { ...s.st, mem: s.st.mem.set(r, s.st.mem.get(r).union(Set(s.st.unit.get(r).ev))) } },
  }
  /** store.ts:288-289: upsert of the whole state with no version compare; then the unlock (:329) and release. */
  action save(r: str): bool = all {
    s.st.unit.get(r).phase == "applied", s.st.mem.get(r).contains(s.st.unit.get(r).ev),
    s' = { ...s, now: s.now, st: { ...s.st,
      committed: s.st.mem.get(r),
      acked: s.st.acked.union(Set(s.st.unit.get(r).ev)),
      lockHolder: if (s.st.lockHolder == r) "" else s.st.lockHolder,
      unit: s.st.unit.set(r, { phase: "idle", ev: "" }) },
      tk: { ...s.tk, lastSave: s.now } },
  }
  /** The save transaction throws: nothing is committed, the lock is released, memory keeps the change (SD-448). */
  action saveFails(r: str): bool = all {
    s.st.unit.get(r).phase == "applied", s.st.mem.get(r).contains(s.st.unit.get(r).ev),
    s' = { ...s, st: { ...s.st,
      lockHolder: if (s.st.lockHolder == r) "" else s.st.lockHolder,
      unit: s.st.unit.set(r, { phase: "idle", ev: "" }) } },
  }
  /** The reserved connection dies while fn runs: Postgres frees the session lock; fn goes on (store.ts:320-333, SD-110). */
  action loseConnection(r: str): bool = all {
    s.st.lockHolder == r, not(s.st.lostConn),
    s' = { ...s, st: { ...s.st, lockHolder: "", lostConn: true } },
  }

  /** SD-111: an opportunity id is `slop.nw-<seed>-<oppSeq>` (network.ts:891, 2100); every network has seed NETWORK_SEED (server.ts:81). */
  action mint(n: str): bool = all {
    s.st.twoCities or n == "slop:nyc", s.st.oppSeq.get(n) < 2,
    val id = s.st.oppSeq.get(n) + 1
    s' = { ...s, st: { ...s.st, oppSeq: s.st.oppSeq.set(n, id), oppRows: s.st.oppRows.put(id, n), minted: s.st.minted.union(Set((n, id))) } },
  }

  // ------------------------------------------------------------------ M-089 backup and restore

  /** deploy/backup/backup.ts: a consistent dump of the committed state (pg_dump snapshot). */
  action backupRun: bool = all {
    s' = { ...s, st: { ...s.st, backup: s.st.committed, backupTaken: true } },
  }
  /** runbook-real.md 8.3: replicas to 0, restore the dump, point the service at it. No step replays consent. */
  action restore: bool = all {
    s.st.backupTaken, not(s.st.restored), s.st.lockHolder == "",
    REPLICAS.forall(r => s.st.unit.get(r).phase == "idle"),
    s' = { ...s, st: { ...s.st, committed: s.st.backup, restored: true,
      rolledBack: s.st.acked.filter(e => not(s.st.backup.contains(e))) } },
  }
  /**
   * restore.ts:44-46 with lib.ts:201-204 sameServer: --roles is refused only when the target host:port string equals the source one.
   * The documented setup reaches one server as postgres.railway.internal and through the TCP proxy.
   */
  action restoreRoles(target: str): bool = all {
    val onSourceString = target == "source-internal-host"
    val reallySource = target != "new-server"
    s' = { ...s, st: { ...s.st, rolesOnSource: s.st.rolesOnSource or (not(onSourceString) and reallySource) } },
  }

  // ------------------------------------------------------------------ M-140, M-141 tick loop

  /** A crash or an error leaves a platform.inbound row waiting (service.ts:561-565 drains them). */
  action inboundLeftWaiting: bool = all {
    s.tk.inboxAge == -1,
    s' = { ...s, tk: { ...s.tk, inboxAge: 0 } },
  }
  /** An OTP challenge or a session passes its retention time (service.ts:567-577 purges them). */
  action rowExpires: bool = all {
    s.tk.expiredAge == -1,
    s' = { ...s, tk: { ...s.tk, expiredAge: 0 } },
  }
  pure def older(age: int): int = if (age < 0) -1 else age + 1

  /**
   * One round of the tick loop. "backend": backend.ts:388-416 runs rt.tick() then notifyTick, beside opsTick.
   * "serve": serve.ts:122-136 runs inboxTick, every rt.tick(), purge, notifyTick. tickOk: rt.tick() did not throw.
   */
  action tickRound(tickOk: bool): bool = all {
    s.tk.lastRoundAt < s.now, s.pr.phase == "running",
    val serve = s.tk.tickSet == "serve"
    s' = { ...s, tk: { ...s.tk,
      inboxAge: if (serve) -1 else older(s.tk.inboxAge),
      expiredAge: if (serve) -1 else older(s.tk.expiredAge),
      lastTickRan: if (tickOk) s.now else s.tk.lastTickRan,
      lastSave: if (tickOk) s.now else s.tk.lastSave,
      lastRoundAt: s.now } },
  }

  // ------------------------------------------------------------------ M-150 alert dispatcher

  /** POST /internal/signals records a safety_concern signal that waits for staff. */
  action signalArrives: bool = all {
    s.al.sigWaiting < MAX_SIG,
    s' = { ...s, al: { ...s.al, sigWaiting: s.al.sigWaiting + 1 } },
  }
  /** Staff decide some waiting signals (GET /signals): the count falls. */
  action staffDecides(left: int): bool = all {
    left < s.al.sigWaiting, left >= 0,
    s' = { ...s, al: { ...s.al, sigWaiting: left } },
  }

  /**
   * One ops round: createOps().tick (ops.ts:528-543): collect, evaluate, dispatch under the advisory lock
   * (ops.ts:395-442), then the heartbeat GET. readOk: collectNetwork did not throw (ops.ts:218-220).
   * postOk: the webhook answered 2xx. limited: postsLastHour >= ALERT_MAX_PER_HOUR.
   */
  action opsRound(readOk: bool, postOk: bool, limited: bool): bool = all {
    s.al.lastOpsAt < s.now, s.pr.phase == "running",
    val cur = current(s, readOk)
    val truth = current(s, true)
    val prev = s.al.st
    val firing = ALERT_KEYS.filter(k => and { cur.get(k).on, isDue(nextA(prev.get(k), cur.get(k)), cur.get(k), s.now) })
    val resolving = ALERT_KEYS.filter(k => and { not(cur.get(k).on), prev.get(k).open, prev.get(k).sent })
    val quiet = ALERT_KEYS.filter(k => and { not(cur.get(k).on), prev.get(k).open, not(prev.get(k).sent) })
    val posted = and { firing.union(resolving).size() > 0, not(limited) }
    val ok = and { posted, postOk }
    val nextSt = ALERT_KEYS.mapBy(k =>
      if (cur.get(k).on)
        val a = nextA(prev.get(k), cur.get(k))
        if (ok and firing.contains(k)) { ...a, sent: true, lastSentAt: s.now, lastSentCount: a.count }
        else if (posted and firing.contains(k)) { ...a, failedWhileOpen: true }
        else a
      else if (quiet.contains(k)) { ...prev.get(k), open: false }
      else if (ok and resolving.contains(k)) { ...prev.get(k), open: false }
      else if (posted and resolving.contains(k)) { ...prev.get(k), failedWhileOpen: true }
      else prev.get(k))
    s' = { ...s, al: { ...s.al,
      st: nextSt, lastOpsAt: s.now, posts: if (posted) s.al.posts + 1 else s.al.posts,
      badResolve: s.al.badResolve or (ok and resolving.exists(k => truth.get(k).on)),
      bumpMissed: s.al.bumpMissed or ALERT_KEYS.exists(k => and {
        cur.get(k).on, cur.get(k).bump, prev.get(k).open, cur.get(k).count > prev.get(k).count, not(firing.contains(k)) }),
      silentClose: s.al.silentClose or quiet.exists(k => prev.get(k).failedWhileOpen),
      heartbeatLie: s.al.heartbeatLie or (posted and not(ok)) } },
  }

  // ------------------------------------------------------------------ M-151, M-152 weekly bias

  /**
   * service.ts:539-542 inside afterTick (runtime.ts:666, after the tick lock is released): read max(at).
   * memberReadOk false: the member query throws; runtime.ts:666 logs "[tick] after-tick work failed" (no [alert]).
   */
  action biasCheck(r: str, memberReadOk: bool): bool = all {
    s.bi.phase.get(r) == "idle", s.now - lastReportAt(s.bi) >= WEEK,
    if (memberReadOk) s' = { ...s, bi: { ...s.bi, phase: s.bi.phase.set(r, "read") } }
    else s' = { ...s, bi: { ...s.bi, failedSinceReport: true } },
  }
  /** service.ts:546-549: biasReport on rt.net.opps (process memory, outside the lock), then the insert. */
  action biasInsert(r: str, alerts: int): bool = all {
    s.bi.phase.get(r) == "read",
    s' = { ...s, bi: { ...s.bi,
      phase: s.bi.phase.set(r, "idle"),
      reports: s.bi.reports.union(Set((s.now, alerts, r))),
      failedSinceReport: false,
      dirtyRead: s.bi.dirtyRead or s.st.mem.get(r).exists(e => not(s.st.committed.contains(e)) and not(s.st.rolledBack.contains(e))) } },
  }

  // ------------------------------------------------------------------ M-142 process lifecycle

  /** A request that never finishes (a stuck /internal/turn or MCP call), or a tick that hangs. */
  action stuckWork(kind: str): bool = all {
    s.pr.phase == "running", s.pr.stuck == "none",
    s' = { ...s, pr: { ...s.pr, stuck: kind } },
  }
  /** backend.ts:426-428: draining, clear the timer, then await s.stop(false) for each server. */
  action sigterm: bool = all {
    s.pr.phase == "running",
    s' = { ...s, pr: { ...s.pr, phase: "stopping", sigtermAt: s.now } },
  }
  /** Bun 1.4.2: server.stop(false) resolves only when the in-flight requests end (checked by a local run). */
  action serversStopped: bool = all {
    s.pr.phase == "stopping", s.pr.stuck != "http",
    s' = { ...s, pr: { ...s.pr, phase: "waiting", graceAt: s.now } },
  }
  /** backend.ts:430-435: every tracked promise settled before the grace timer: svc.close, clean. */
  action drained: bool = all {
    s.pr.phase == "waiting", s.pr.stuck == "none",
    s' = { ...s, pr: { ...s.pr, phase: "closed", clean: true } },
  }
  /** backend.ts:431-434: the grace timer wins the race: svc.close anyway, not clean. */
  action graceFires: bool = all {
    s.pr.phase == "waiting", s.now >= s.pr.graceAt + GRACE,
    s' = { ...s, pr: { ...s.pr, phase: "closed", clean: false } },
  }
  /** Railway sends SIGKILL 30 s after SIGTERM. */
  action sigkill: bool = all {
    s.pr.phase == "stopping" or s.pr.phase == "waiting", s.now >= s.pr.sigtermAt + KILL,
    s' = { ...s, pr: { ...s.pr, phase: "killed" } },
  }

  // ------------------------------------------------------------------ M-143, M-144 boot

  /** migrate.ts:80-103: one transaction under pg_advisory_xact_lock: all pending migrations and the ledger, or nothing. */
  action migrate: bool = all {
    s.bt.step == "start",
    s' = { ...s, bt: { ...s.bt, applied: if (s.bt.ledger) s.bt.applied else s.bt.applied + 1, ledger: true, step: "migrated" } },
  }
  /** server.ts:51 ensureServiceLogin, backend.ts:453-454: an existing role is left as it is. */
  action ensureLoginStart: bool = all {
    s.bt.step == "migrated",
    s' = { ...s, bt: { ...s.bt, step: if (s.bt.roleExists) "check" else "create" } },
  }
  /** backend.ts:457, :458, :459: three statements, each its own transaction. */
  action bootCreate: bool = all { s.bt.step == "create", s' = { ...s, bt: { ...s.bt, roleExists: true, step: "grant" } } }
  action bootGrant: bool = all { s.bt.step == "grant", s' = { ...s, bt: { ...s.bt, member: true, step: "connect" } } }
  action bootConnect: bool = all { s.bt.step == "connect", s' = { ...s, bt: { ...s.bt, connect: true, step: "check" } } }
  /** server.ts:58-63 serviceLoginProblem (backend.ts:179-188) checks superuser, BYPASSRLS and ownership only. */
  action loginCheck: bool = all {
    s.bt.step == "check",
    s' = { ...s, bt: { ...s.bt, step: if (s.bt.member) "up" else "failed",
      checkPassedIncomplete: s.bt.checkPassedIncomplete or not(s.bt.member and s.bt.connect) } },
  }
  /** The process exits (crash, "start failed") at any boot step; the host restarts it. */
  action bootCrash: bool = all {
    s.bt.step != "start", s.bt.step != "up",
    s' = { ...s, bt: { ...s.bt, step: "start" } },
  }

  // ------------------------------------------------------------------ M-153 one LLM call

  /** llm.ts:258-341: one loop iteration. */
  action llmAttempt(outcome: str): bool = all {
    s.ll.done == "",
    val l = { ...s.ll, attempts: s.ll.attempts + 1 }
    val nl =
      if (outcome == "ok") { ...l, done: "ok" }
      else if (outcome == "empty") (if (l.regrows < MAX_REGROWS) { ...l, regrows: l.regrows + 1 } else { ...l, done: "error" })
      else if (outcome == "retryable") (
        if (l.e < EPS - 1) { ...l, e: l.e + 1 }
        else if (l.retries >= MAX_RETRIES) { ...l, done: "error" }
        else { ...l, retries: l.retries + 1 })
      else { ...l, done: "error" }
    s' = { ...s, ll: nl },
  }

  // ------------------------------------------------------------------ M-149 wrangler guard

  /** wrangler.sh:100-116: run only when both decide modes say read-only (no NTWRK_ALLOW_DEPLOY). */
  action runWrangler: bool = all {
    not(s.wr.ran),
    val allowed = decide("switch", s.wr.args) and decide("value", s.wr.args)
    s' = { ...s, wr: { ...s.wr, ran: true, allowed: allowed, deploys: allowed and wranglerDeploys(s.wr.args) } },
  }

  // ------------------------------------------------------------------ M-147 Cloudflare cutover

  /** A deploy with BACKEND_ENABLED=true and BUILD_ID: the container runs the backend (worker.ts:61-71). */
  action cfActivate: bool = all {
    not(s.cf.enabled),
    s' = { ...s, cf: { target: "cf", enabled: true, buildIdOk: true, containerRunning: true, cronSinceInactive: false } },
  }
  /** The rollback deploy without BACKEND_ENABLED; the operator may leave out --var BUILD_ID (SD-159). */
  action cfDeactivate(withBuildId: bool): bool = all {
    s.cf.enabled,
    s' = { ...s, cf: { ...s.cf, target: "railway", enabled: false, buildIdOk: withBuildId, cronSinceInactive: false } },
  }
  /**
   * worker.ts:72-76 scheduled() on an inactive deploy: getContainer(...).stop(). The Durable Object's
   * constructor runs on the new deploy and throws when BUILD_ID is not 40 hex (worker.ts:36), so stop() never sends SIGTERM.
   */
  action cfCron: bool = all {
    not(s.cf.enabled),
    s' = { ...s, cf: { ...s.cf, cronSinceInactive: true, containerRunning: s.cf.containerRunning and not(s.cf.buildIdOk) } },
  }

  // ------------------------------------------------------------------ step

  action step = any {
    advance,
    nondet r = oneOf(REPLICAS)
    nondet e = oneOf(EVENTS)
    any { takeLock(r, e), load(r), apply(r), save(r), saveFails(r), loseConnection(r) },
    nondet n = oneOf(NETWORKS) mint(n),
    backupRun,
    restore,
    nondet t = oneOf(Set("source-internal-host", "source-proxy-host", "new-server")) restoreRoles(t),
    inboundLeftWaiting,
    rowExpires,
    nondet ok = oneOf(Set(true, false)) tickRound(ok),
    signalArrives,
    nondet left = oneOf(0.to(MAX_SIG - 1)) staffDecides(left),
    nondet readOk = oneOf(Set(true, false))
    nondet postOk = oneOf(Set(true, false))
    nondet limited = oneOf(Set(true, false))
    opsRound(readOk, postOk, limited),
    nondet r = oneOf(REPLICAS)
    nondet ok = oneOf(Set(true, false))
    nondet alerts = oneOf(Set(0, 1))
    any { biasCheck(r, ok), biasInsert(r, alerts) },
    nondet kind = oneOf(Set("http", "tick")) stuckWork(kind),
    sigterm, serversStopped, drained, graceFires, sigkill,
    migrate, ensureLoginStart, bootCreate, bootGrant, bootConnect, loginCheck, bootCrash,
    nondet outcome = oneOf(Set("ok", "empty", "retryable", "fatal")) llmAttempt(outcome),
    runWrangler,
    cfActivate,
    nondet b = oneOf(Set(true, false)) cfDeactivate(b),
    cfCron,
  }

  // ------------------------------------------------------------------ invariants

  /**
   * Network code header (store.ts:5-6): "two processes never overwrite each other's saves". AGENTS.md
   * (STOP and caps): a STOP the service acknowledged stays in force. Excludes the restore (restoreKeepsStops).
   * SD-110: a lost lock connection lets a stale save overwrite a newer commit.
   */
  val noLostWrite = s.st.acked.forall(e => s.st.committed.contains(e) or s.st.rolledBack.contains(e))

  /**
   * AGENTS.md hard rule "keep every safety guard: ... consent, STOP"; PRD 40.3 STOP stops every app.
   * A recovery must not undo an acknowledged STOP. On the eliza_cloud channel the gateway's send-time
   * fence (AGENTS.md consent path, upstream assumption) still holds the opt-out; the direct blooio
   * channel has no copy outside the database. SD-050.
   */
  val restoreKeepsStops = s.st.channel == "eliza_cloud" or s.st.rolledBack.forall(e => s.st.committed.contains(e))

  /** runbook-real.md 8.3 step 2: "the script refuses it [--roles] on the source server". SD-165. */
  val restoreRolesNotOnSource = not(s.st.rolesOnSource)

  /**
   * schema.sql: network.opportunities id is the primary key shared by every network; each network owns
   * the rows it writes (store.ts:267-278 deletes only "rows this store wrote"). SD-111.
   */
  val oppIdsOwned = s.st.minted.forall(m => s.st.oppRows.get(m._2) == m._1)

  /**
   * dueHasCaller: every row with a due rule has a caller in the production tick set. service.ts:561
   * ("Inbound messages a crash or an error left waiting: handled once") and service.ts:567 (retention,
   * audit platform-18). SD-003.
   */
  val dueHasCaller = s.tk.inboxAge <= STALE and s.tk.expiredAge <= STALE

  /**
   * docs/deploy.md 7.2: tick_late fires when "No tick stored for the network for ALERT_TICK_LATE_MS".
   * Evaluated on the code's own condition (ops.ts:201, :275). SD-368.
   */
  val tickLateSeen = (s.now - s.tk.lastTickRan > TICK_LATE) implies (s.now - lastSeen(s.tk) > TICK_LATE)

  /** docs/deploy.md 7.2: "When it ends, one resolved notice is posted": only when the read shows it ended. SD-113. */
  val alertResolvedOnlyOnRead = not(s.al.badResolve)

  /** docs/deploy.md 7.2: posted again "when a safety alert's count goes up". SD-161. */
  val bumpPosted = not(s.al.bumpMissed)

  /**
   * ops.ts:418 comment: an alert closes quietly only when "it started and ended between rate-limited
   * rounds". One that a failed webhook never delivered must not vanish. SD-235.
   */
  val noSilentClose = not(s.al.silentClose)

  /** docs/deploy.md 7.1.2: "A missing heartbeat means ... its alert dispatcher stopped." SD-360. */
  val heartbeatHonest = not(s.al.heartbeatLie)

  /** AGENTS.md item 12: "Admin runs biasMonitor weekly": one report per network per week. SD-446. */
  val oneReportPerWeek = s.bi.reports.forall(a => s.bi.reports.forall(b => a == b or abs(a._1 - b._1) >= WEEK))

  /**
   * AGENTS.md item 12 (weekly bias monitor, alert below 0.8x): a weekly run that failed and was not
   * followed by a report is visible as an alert within a day. The code has no such alert. SD-233.
   */
  val skippedWeekSeen = not(s.bi.failedSinceReport and s.now - lastReportAt(s.bi) > WEEK + DAY)

  /** AGENTS.md: the weekly bias report is computed from committed network state (the store is the truth). SD-448. */
  val biasReadsCommitted = not(s.bi.dirtyRead)

  /** backend.ts:418-423: "After shutdownGraceMs the pool closes anyway" (GRACE < KILL). SD-158. */
  val closeBeforeKill = s.pr.phase != "killed"

  /** backend.ts:442-446: the service login is created as LOGIN, member of network_service, CONNECT. The boot check must see a half-made role. SD-163. */
  val bootLoginComplete = not(s.bt.checkPassedIncomplete)

  /** migrate.ts:3-4: "two processes never apply the same migration twice". */
  val migrationOnce = s.bt.applied <= 1

  /** llm.ts:189-193 and AGENTS.md LLMs: retries at most LLM_MAX_RETRIES, plus one fallback and two regrows. */
  val llmAttemptBound = s.ll.attempts <= EPS + MAX_RETRIES + MAX_REGROWS

  /** AGENTS.md Environment: wrangler.sh "refuses deploy (except --dry-run) ... unless NTWRK_ALLOW_DEPLOY=1". SD-168. */
  val guardSound = not(s.wr.deploys)

  /** README rollback: an inactive Worker stops the container (worker.ts:56-58 comment: SIGTERM). SD-159. */
  val inactiveStops = (not(s.cf.enabled) and s.cf.cronSinceInactive) implies not(s.cf.containerRunning)

  /** AGENTS.md: every proactive proposal waits for human review; the console must reach the staff API. SD-169. */
  val staffRouted = staffRouteExists(s.cf.target)

  val safety = and {
    noLostWrite, restoreKeepsStops, restoreRolesNotOnSource, oppIdsOwned, dueHasCaller, tickLateSeen,
    alertResolvedOnlyOnRead, bumpPosted, noSilentClose, heartbeatHonest, oneReportPerWeek, skippedWeekSeen,
    biasReadsCommitted, closeBeforeKill, bootLoginComplete, migrationOnce, llmAttemptBound, guardSound,
    inactiveStops, staffRouted,
  }

  // ------------------------------------------------------------------ witnesses (must be reachable)

  val witness_stopCommitted = not(s.st.acked.size() > 0 and s.st.acked.forall(e => s.st.committed.contains(e)))
  val witness_cleanRestore = not(s.st.restored and s.st.acked.size() > 0 and s.st.rolledBack.size() == 0)
  val witness_tickRan = not(s.tk.lastTickRan > 0)
  val witness_alertPosted = not(ALERT_KEYS.exists(k => s.al.st.get(k).sent))
  val witness_alertResolved = not(s.al.posts > 1 and ALERT_KEYS.forall(k => not(s.al.st.get(k).open)))
  val witness_biasReport = not(s.bi.reports.size() > 0)
  val witness_cleanShutdown = not(s.pr.phase == "closed" and s.pr.clean)
  val witness_graceShutdown = not(s.pr.phase == "closed" and not(s.pr.clean))
  val witness_bootUp = not(s.bt.step == "up")
  val witness_llmRegrowOk = not(s.ll.done == "ok" and s.ll.regrows > 0 and s.ll.e > 0)
  val witness_wranglerDryRun = not(s.wr.ran and s.wr.allowed)
  val witness_cfStopped = not(s.cf.cronSinceInactive and not(s.cf.containerRunning) and s.cf.buildIdOk)

  // ------------------------------------------------------------------ run tests (concrete traces)

  action initProd = initWith("backend", "blooio", false, List("deploy", "--dry-run", "--dry-run"))
  action initServe = initWith("serve", "blooio", false, List("deploy", "--dry-run", "--dry-run"))

  /** SD-110: A loads, loses its lock connection, B commits stop2, A saves its old copy plus stop1. */
  run lostLockTest = initProd
    .then(takeLock("A", "stop1")).then(load("A")).then(loseConnection("A"))
    .then(takeLock("B", "stop2")).then(load("B")).then(apply("B")).then(save("B"))
    .then(apply("A")).then(save("A"))
    .expect(not(noLostWrite) and s.st.committed == Set("stop1"))

  /** With the lock held the whole time, the same two units keep both STOPs. */
  run lockedUnitsTest = initProd
    .then(takeLock("A", "stop1")).then(load("A")).then(apply("A")).then(save("A"))
    .then(takeLock("B", "stop2")).then(load("B")).then(apply("B")).then(save("B"))
    .expect(noLostWrite and s.st.committed == Set("stop1", "stop2"))

  /** SD-050: backup, STOP acknowledged, restore: the member reads as opted in again. */
  run restoreRollsBackStopTest = initProd
    .then(backupRun)
    .then(takeLock("A", "stop1")).then(load("A")).then(apply("A")).then(save("A"))
    .then(restore)
    .expect(not(restoreKeepsStops) and noLostWrite)

  /** SD-003: the deployed tick set never drains a waiting inbound row; serve.ts does. */
  run backendTickSetTest = initProd
    .then(inboundLeftWaiting)
    .then(advance).then(tickRound(true)).then(advance).then(tickRound(true))
    .then(advance).then(tickRound(true)).then(advance).then(tickRound(true))
    .expect(not(dueHasCaller))
  run serveTickSetTest = initServe
    .then(inboundLeftWaiting).then(rowExpires)
    .then(advance).then(tickRound(true)).then(advance).then(tickRound(true))
    .then(advance).then(tickRound(true)).then(advance).then(tickRound(true))
    .expect(dueHasCaller and s.tk.inboxAge == -1)

  /** SD-161: sent at 3, staff clear to 1, two new signals: count 3 is not above 3, so no post. */
  run bumpAfterClearTest = initProd
    .then(signalArrives).then(signalArrives).then(signalArrives)
    .then(advance).then(opsRound(true, true, false))
    .then(staffDecides(1))
    .then(advance).then(opsRound(true, true, false))
    .then(signalArrives).then(signalArrives)
    .then(advance).then(opsRound(true, true, false))
    .expect(not(bumpPosted))

  /** SD-113: an open, posted safety alert, then one failed read: a "resolved" notice is posted. */
  run readErrorResolvesTest = initProd
    .then(signalArrives)
    .then(advance).then(opsRound(true, true, false))
    .then(advance).then(opsRound(false, true, false))
    .expect(not(alertResolvedOnlyOnRead))

  /** SD-235 and SD-360: the webhook fails while the alert lasts; the alert then closes with no notice, and the heartbeat was green. */
  run silentCloseTest = initProd
    .then(signalArrives)
    .then(advance).then(opsRound(true, false, false))
    .then(staffDecides(0))
    .then(advance).then(opsRound(true, true, false))
    .expect(not(noSilentClose) and not(heartbeatHonest))

  /** SD-368: ticks throw each round, an inbound save refreshes saved_at, tick_late stays silent. */
  run tickLateMaskedTest = initProd
    .then(advance).then(tickRound(false)).then(advance).then(tickRound(false))
    .then(takeLock("A", "stop1")).then(load("A")).then(apply("A")).then(save("A"))
    .then(advance).then(tickRound(false))
    .expect(not(tickLateSeen))

  /** SD-446: both replicas read the old max(at) before either inserts. */
  run twoReportsTest = initProd
    .then(biasCheck("A", true)).then(biasCheck("B", true))
    .then(biasInsert("A", 0)).then(advance).then(biasInsert("B", 0))
    .expect(not(oneReportPerWeek))

  /** SD-158: a stuck HTTP request holds s.stop(false); the grace timer never starts; SIGKILL. */
  run stuckRequestKilledTest = initProd
    .then(stuckWork("http")).then(sigterm)
    .then(advance).then(advance).then(advance).then(sigkill)
    .expect(not(closeBeforeKill))
  /** A hung tick (not an HTTP request) is ended by the grace timer before SIGKILL. */
  run stuckTickGraceTest = initProd
    .then(stuckWork("tick")).then(sigterm).then(serversStopped)
    .then(advance).then(advance).then(graceFires)
    .expect(closeBeforeKill and s.pr.phase == "closed")

  /** SD-163: crash after create role; the next boot skips creation and the check passes. */
  run halfRoleTest = initProd
    .then(migrate).then(ensureLoginStart).then(bootCreate).then(bootCrash)
    .then(migrate).then(ensureLoginStart).then(loginCheck)
    .expect(not(bootLoginComplete) and s.bt.step == "failed" and migrationOnce)

  /** SD-168: "deploy --help --no-help" passes the guard, and wrangler deploys. */
  run helpFlagTest = initWith("backend", "blooio", false, List("deploy", "--help", "--no-help"))
    .then(runWrangler)
    .expect(not(guardSound))
  run dryRunTest = initWith("backend", "blooio", false, List("deploy", "--dry-run", "--help=false"))
    .then(runWrangler)
    .expect(guardSound and s.wr.allowed)

  /** SD-159: rollback without BUILD_ID: the cron cannot stop the container. */
  run cfNoBuildIdTest = initProd
    .then(cfActivate).then(cfDeactivate(false)).then(cfCron)
    .expect(not(inactiveStops))

  /** SD-111: slop:nyc and slop:la both mint slop.nw-1-1; the second save takes the first one's row. */
  run idCollisionTest = initWith("backend", "blooio", true, List("deploy", "--dry-run", "--dry-run"))
    .then(mint("slop:nyc")).then(mint("slop:la"))
    .expect(not(oppIdsOwned))

  /** SD-448: an inbound unit has changed memory; the bias report reads it before the save fails. */
  run dirtyBiasReadTest = initProd
    .then(takeLock("A", "stop1")).then(load("A")).then(apply("A"))
    .then(biasCheck("A", true)).then(biasInsert("A", 0))
    .then(saveFails("A"))
    .expect(not(biasReadsCommitted))

  /** SD-165: --roles with the TCP proxy URL of the same server runs roles.sql on the source. */
  run rolesOnSourceTest = initProd
    .then(restoreRoles("source-proxy-host"))
    .expect(not(restoreRolesNotOnSource))

  /** SD-233: the member query fails at the weekly run; a week and a day later nothing has alerted. */
  run skippedWeekTest = initProd
    .then(biasCheck("A", false))
    .then(advance).then(advance).then(advance)
    .expect(not(skippedWeekSeen))

  /** The LLM bound: fallback, two retries, two regrows, then ok: 6 attempts, the bound. */
  run llmBoundTest = initProd
    .then(llmAttempt("retryable")).then(llmAttempt("retryable")).then(llmAttempt("retryable"))
    .then(llmAttempt("empty")).then(llmAttempt("empty")).then(llmAttempt("ok"))
    .expect(llmAttemptBound and s.ll.done == "ok" and s.ll.attempts == 6)
}
