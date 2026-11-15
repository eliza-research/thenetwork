# Runtime work, retention, and alerts

## Story: Runtime work, retention, and alerts

An operator needs the backend to complete scheduled work, report failures, and recover from restarts.

### Safety rules and reachability

Check stored writes, retention, ticks, alerts, backup recovery, and shutdown. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

Imported from `quint/runtime_ops.qnt` at `30d950e`. See [model index](README.md) for scope and commands.

```quint
// -*- mode: Bluespec; -*-
// quint-check: max-steps=30 max-samples=50000 verify-steps=5
//
// Runtime and operations machines (docs/research/2026-11-07-state-machines.md section 6.14):
//   M-088 store-unit-of-work     packages/network/src/store.ts:53-79, 325-354
//   M-089 pg-restore-recovery    docs/runbook-real.md 8.3, deploy/backup/restore.ts, deploy/backup/lib.ts
//   M-140 retention-loop         packages/network/service/service.ts:590-608
//   M-141 backend-tick-loop      deploy/backend/backend.ts:423-457 (tickSet "backend"), serve.ts:131-149 ("serve")
//   M-142 backend-process-lifecycle deploy/backend/backend.ts:459-481, server.ts:132-140
//   M-143 backend-boot           deploy/backend/server.ts:37-63, backend.ts:486-513
//   M-144 migration-runner       packages/observatory/db/migrate.ts:78-112
//   M-147 cf-backend-cutover     deploy/cloudflare/worker.ts
//   M-149 wrangler-deploy-guard  scripts/wrangler.sh:56-129
//   M-150 alert-dispatcher       deploy/backend/ops.ts:200-232, 285-320, 438-489, 574-592
//   M-151 bias-report-cadence    packages/network/service/service.ts:541-583
//   M-152 bias-alert-lifecycle   ops.ts:256-257 (24 h window), ops.ts:305-309, ops.ts:460-467
//   M-153 llm-call               packages/core/src/llm.ts:238-338
//
// One state variable `s` holds one record per machine, so that each action changes only its own part.
// Time is an integer tick. The named thresholds keep the order of the real values, not their size.
// Oracles (a read error, a webhook result, a rate limit, an LLM reply, an operator choice) are nondet.
//
// Wave 2: the model follows the code (line numbers compared on claude/formal-main) after the fixes of SD-003, SD-110, SD-111,
// SD-113, SD-158, SD-161, SD-163, SD-165, SD-168, SD-233, SD-235, SD-360, SD-368, SD-446 and SD-448, and
// `safety` holds. Three defects stay open (skipped, see the invariants section): SD-050 (founder decision),
// SD-159 (no Workers runtime to test the fix), SD-169 (founder decision). Their invariants are named values
// outside `safety`, and a run test replays each counterexample.
module runtime_ops {

  // ------------------------------------------------------------------ constants

  pure val REPLICAS = Set("A", "B")
  /** Units of work that each record one STOP (an inbound unit under the network lock). */
  pure val EVENTS = Set("stop1", "stop2")
  pure val NETWORKS = Set("slop:nyc", "slop:la")
  pure val MAX_T = 14
  /** 24 h: the window of the 24 h counts (ops.ts:256-257). */
  pure val DAY = 2
  /** BIAS_EVERY_MS, 7 days (bias.ts:15). */
  pure val WEEK = 4
  /** ALERT_TICK_LATE_MS (ops.ts:89). */
  pure val TICK_LATE = 2
  /** ALERT_REPEAT_MS, 6 h (ops.ts:94): longer than one round. */
  pure val REPEAT = 4
  /** Rounds a due row (waiting inbound, expired retention row) may wait for its caller. */
  pure val STALE = 2
  /** SHUTDOWN_GRACE_MS 25 s (backend.ts:178) is shorter than Railway's SIGKILL at 30 s. */
  pure val GRACE = 2
  pure val KILL = 3
  /** llm.ts: two endpoints (Surplus, then OpenAI), LLM_MAX_RETRIES (bounded here to 2), MAX_REGROWS = 2. */
  pure val EPS = 2
  pure val MAX_RETRIES = 2
  pure val MAX_REGROWS = 2
  pure val MAX_SIG = 3
  /**
   * The tokens of a wrangler command in the guard model (any order, three tokens): the deploy command, a read-only
   * command, the switches the guard reads, their values, a value flag (--config) and a flag on neither list.
   */
  pure val WR_TOKENS = Set("deploy", "whoami", "--dry-run", "--dry-run=true", "--no-dry-run", "--dry-run=false",
    "--help", "--no-help", "--help=false", "true", "false", "--config", "--new-flag")
  /** "late" is bias_late (ops.ts evaluate, SD-233). */
  pure val ALERT_KEYS = Set("sig", "tick", "bias", "late", "read")

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
    oppRows: (str, int) -> str,
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
    lateUnseen: bool,
  }

  /** M-151, M-152: network.bias_reports and the per-replica afterTick step. */
  type Bias = {
    phase: str -> str,
    startedAt: str -> int,
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
  type Wr = { args: List[str], ran: bool, allowed: bool, deploys: bool, unk: bool }

  /** M-147. */
  type Cf = { target: str, enabled: bool, buildIdOk: bool, configSet: bool, containerRunning: bool, cronSinceInactive: bool }

  type S = { now: int, st: Store, tk: Ticks, al: Alerts, bi: Bias, pr: Proc, bt: Boot, ll: Llm, wr: Wr, cf: Cf }

  var s: S

  // ------------------------------------------------------------------ helpers

  pure val CLOSED: AState = { open: false, count: 0, sent: false, lastSentAt: -100, lastSentCount: 0, failedWhileOpen: false }
  pure val OFF: Cur = { on: false, count: 0, bump: false }

  pure def maxOf(xs: Set[int], dflt: int): int = xs.fold(dflt, (acc, x) => if (x > acc) x else acc)
  pure def abs(x: int): int = if (x < 0) -x else x

  /** ops.ts collectNetwork: only the stored tick (SD-368 fix, dc7e3d0); a unit's saved_at no longer counts. */
  pure def lastSeen(tk: Ticks): int = tk.lastTickRan

  /** ops.ts:256: sum(alerts) of bias reports written after now - 24 h. */
  pure def biasAlerts24h(bi: Bias, now: int): int =
    bi.reports.filter(r => r._1 > now - DAY).fold(0, (acc, r) => acc + r._2)

  pure def lastReportAt(bi: Bias): int = maxOf(bi.reports.map(r => r._1), -WEEK)

  /**
   * ops.ts evaluate bias_late (SD-233 fix, e8a3171): the newest report is older than BIAS_EVERY_MS + 24 h, or
   * there is none and the process has run longer than that (uptime; the process starts at time 0 here).
   */
  pure def biasLate(bi: Bias, now: int): bool =
    if (bi.reports.size() == 0) now > WEEK + DAY else now - lastReportAt(bi) > WEEK + DAY
  /** evaluate() (ops.ts:285-320) for one network. A read error gives only ops_read (ops.ts:289). */
  pure def current(x: S, readOk: bool): str -> Cur =
    if (not(readOk))
      ALERT_KEYS.mapBy(k => if (k == "read") { on: true, count: 1, bump: false } else OFF)
    else
      ALERT_KEYS.mapBy(k =>
        if (k == "sig") { on: x.al.sigWaiting > 0, count: x.al.sigWaiting, bump: true }
        else if (k == "tick") { on: x.now - lastSeen(x.tk) > TICK_LATE, count: 1, bump: false }
        else if (k == "bias") { on: biasAlerts24h(x.bi, x.now) > 0, count: biasAlerts24h(x.bi, x.now), bump: true }
        else if (k == "late") { on: biasLate(x.bi, x.now), count: 1, bump: false }
        else OFF)

  /**
   * ops.ts dispatch: the open state takes the new count. A count under the last sent count lowers that
   * baseline, so the next rise is posted (SD-161 fix, 3b29163).
   */
  pure def nextA(prev: AState, c: Cur): AState =
    if (prev.open)
      { ...prev, count: c.count, lastSentCount: if (prev.sent and c.count < prev.lastSentCount) c.count else prev.lastSentCount }
    else { ...CLOSED, open: true, count: c.count }

  /** ops.ts:451-456 (one level per key here, so the level clause is left out). */
  pure def isDue(a: AState, c: Cur, now: int): bool =
    or { not(a.sent), and { c.bump, c.count > a.lastSentCount }, now - a.lastSentAt >= REPEAT }

  /**
   * wrangler.sh decide() after the SD-168 fix (0706658), token by token as the script reads them (wrangler.sh:56-113):
   * a word after a value flag is skipped; a flag on neither list skips the next word in mode "value" only; the last
   * value of --dry-run / --help wins, and a "true" or "false" word right after one of them is its value; every other
   * word is a command word. The command is read-only when the first word is empty, "whoami" (one of the read-only
   * commands), "deploy" with dry_run=1, or when help=1. The guard runs only when both modes say read-only.
   */
  type D = { dry: bool, help: bool, last: str, skip: bool, words: List[str] }
  /** The tokens that do not start with "-" (Quint strings have no prefix test, so the model lists them). */
  pure val WR_WORDS = Set("deploy", "whoami", "true", "false")
  pure def isFlag(a: str): bool = not(WR_WORDS.contains(a))
  /** wrangler.sh value_flag (one of the list) and switch_flag (one of the list); every other "-" token is unknown. */
  pure val WR_VALUE_FLAGS = Set("--config")
  pure val WR_SWITCH_FLAGS = Set("--dry-run", "--help")
  pure def decideStep(mode: str, d: D, a: str): D =
    if (d.skip) { ...d, skip: false }
    else if (d.last != "" and (a == "true" or a == "false"))
      (if (d.last == "dry") { ...d, dry: a == "true", last: "" } else { ...d, help: a == "true", last: "" })
    else if (a == "--dry-run") { ...d, dry: true, last: "dry" }
    else if (a == "--dry-run=true") { ...d, dry: true, last: "" }
    else if (a == "--no-dry-run" or a == "--dry-run=false") { ...d, dry: false, last: "" }
    else if (a == "--help") { ...d, help: true, last: "help" }
    else if (a == "--no-help" or a == "--help=false") { ...d, help: false, last: "" }
    else if (isFlag(a)) {
      if (WR_VALUE_FLAGS.contains(a)) { ...d, skip: true, last: "" }
      else if (WR_SWITCH_FLAGS.contains(a)) { ...d, last: "" }
      else { ...d, skip: mode == "value", last: "" }
    }
    else { ...d, words: d.words.append(a), last: "" }
  pure def decide(mode: str, args: List[str]): bool =
    val d = args.foldl({ dry: false, help: false, last: "", skip: false, words: List() }, (acc, a) => decideStep(mode, acc, a))
    or {
      d.words.length() == 0,
      and { d.words.length() > 0, d.words[0] == "whoami" },
      and { d.words.length() > 0, d.words[0] == "deploy", d.dry },
      d.help,
    }
  /** wrangler.sh:115-116: the command runs without NTWRK_ALLOW_DEPLOY only when both modes say read-only. */
  pure def guardAllows(args: List[str]): bool = decide("switch", args) and decide("value", args)
  /**
   * The oracle: what wrangler (yargs-parser) runs. Written from wrangler's declared options, not from the guard:
   * "dry-run" and "help" are booleans (an explicit "true" / "false" next word is their value; "--no-x" and
   * "--x=false" set false; the last value wins), "config" is a string option (it takes the next word unless that
   * word is a flag). A flag wrangler does not declare is the uncertain case: yargs may read it as a switch or let
   * it take the next word. `unkTakesValue` chooses; the guard must be sound for both readings. The first positional
   * is the command. Assumption, not run (wrangler is not called by the model or its checks).
   */
  type Y = { dry: bool, help: bool, pending: str, pos: List[str] }
  pure def yargsStep(unkTakesValue: bool, y: Y, a: str): Y =
    // A pending option takes this word as its value when it can.
    if (y.pending == "dry" and (a == "true" or a == "false")) { ...y, dry: a == "true", pending: "" }
    else if (y.pending == "help" and (a == "true" or a == "false")) { ...y, help: a == "true", pending: "" }
    else if (y.pending == "value" and not(isFlag(a))) { ...y, pending: "" }
    else {
      val y0 = { ...y, pending: "" }
      if (not(isFlag(a))) { ...y0, pos: y0.pos.append(a) }
      else if (a == "--dry-run" or a == "--dry-run=true") { ...y0, dry: true, pending: if (a == "--dry-run") "dry" else "" }
      else if (a == "--no-dry-run" or a == "--dry-run=false") { ...y0, dry: false }
      else if (a == "--help") { ...y0, help: true, pending: "help" }
      else if (a == "--no-help" or a == "--help=false") { ...y0, help: false }
      else if (a == "--config") { ...y0, pending: "value" }
      else { ...y0, pending: if (unkTakesValue) "value" else "" }
    }
  pure def wranglerDeploys(unkTakesValue: bool, args: List[str]): bool =
    val y = args.foldl({ dry: false, help: false, pending: "", pos: List() }, (acc, a) => yargsStep(unkTakesValue, acc, a))
    and { y.pos.length() > 0, y.pos[0] == "deploy", not(y.dry), not(y.help) }
  /** Every 3-token command over WR_TOKENS, for the exhaustive check (wrangler.sh takes any order of words and flags). */
  pure val WR_COMMANDS: Set[List[str]] =
    tuples(WR_TOKENS, WR_TOKENS, WR_TOKENS).map(t => List(t._1, t._2, t._3))

  /** deploy/cloudflare/worker.ts:70: every request goes to the public port. The staff port (backend.ts:14-15) has no route. */
  pure def staffRouteExists(target: str): bool = target == "railway"

  // ------------------------------------------------------------------ init

  /** handMade: an operator made the service login by hand, without network_service (the second SD-163 test). */
  action initWith(tickSet: str, channel: str, twoCities: bool, args: List[str], handMade: bool): bool = s' = {
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
          badResolve: false, bumpMissed: false, silentClose: false, heartbeatLie: false, lateUnseen: false },
    bi: { phase: REPLICAS.mapBy(_ => "idle"), startedAt: REPLICAS.mapBy(_ => 0), reports: Set(), failedSinceReport: false, dirtyRead: false },
    pr: { phase: "running", stuck: "none", sigtermAt: -1, graceAt: -1, clean: false },
    bt: { roleExists: handMade, member: false, connect: handMade, step: "start", checkPassedIncomplete: false, ledger: false, applied: 0 },
    ll: { e: 0, retries: 0, regrows: 0, attempts: 0, done: "" },
    wr: { args: args, ran: false, allowed: false, deploys: false, unk: false },
    cf: { target: "railway", enabled: false, buildIdOk: false, configSet: false, containerRunning: false, cronSinceInactive: false },
  }

  action init = {
    nondet tickSet = oneOf(Set("backend", "serve"))
    nondet channel = oneOf(Set("eliza_cloud", "blooio"))
    nondet two = oneOf(Set(true, false))
    nondet a0 = oneOf(WR_TOKENS)
    nondet a1 = oneOf(WR_TOKENS)
    nondet a2 = oneOf(WR_TOKENS)
    nondet handMade = oneOf(Set(true, false))
    initWith(tickSet, channel, two, List(a0, a1, a2), handMade)
  }

  // ------------------------------------------------------------------ time

  /** A timer that is due fires before time passes: s.stop(false) with nothing in flight, and the grace timer. */
  def urgent(x: S): bool = or {
    and { x.pr.phase == "stopping", x.pr.stuck != "http" },
    and { x.pr.phase == "stopping", x.now >= x.pr.graceAt + GRACE },
    and { x.pr.phase == "waiting", x.pr.stuck == "none" },
    and { x.pr.phase == "waiting", x.now >= x.pr.graceAt + GRACE },
  }

  action advance = all { s.now < MAX_T, not(urgent(s)), s' = { ...s, now: s.now + 1 } }

  // ------------------------------------------------------------------ M-088 store unit of work

  /** store.ts:341-354: pg_advisory_lock on one reserved connection (the in-process queue serializes one replica). */
  action takeLock(r: str, e: str): bool = all {
    s.st.unit.get(r).phase == "idle", s.st.lockHolder == "", not(s.st.used.contains(e)),
    s' = { ...s, st: { ...s.st, lockHolder: r, used: s.st.used.union(Set(e)), unit: s.st.unit.set(r, { phase: "locked", ev: e }) } },
  }
  /** store.ts:53-55, PgStore.load (:260-268) on a pool connection: importState of the newest row. */
  action load(r: str): bool = all {
    s.st.unit.get(r).phase == "locked",
    s' = { ...s, st: { ...s.st, mem: s.st.mem.set(r, s.st.committed), unit: s.st.unit.set(r, { ...s.st.unit.get(r), phase: "applied" }) } },
  }
  /** fn(net) changes memory before the save: the STOP is in this replica's memory, not yet committed. */
  action apply(r: str): bool = all {
    s.st.unit.get(r).phase == "applied", not(s.st.mem.get(r).contains(s.st.unit.get(r).ev)),
    s' = { ...s, st: { ...s.st, mem: s.st.mem.set(r, s.st.mem.get(r).union(Set(s.st.unit.get(r).ev))) } },
  }
  /**
   * store.ts PgStore.save: the upsert runs on the reserved connection that holds the lock (SD-110 fix, 7240e5b);
   * then the unlock and release. When that connection was lost, the save cannot commit (only saveFails is enabled).
   */
  action save(r: str): bool = all {
    s.st.unit.get(r).phase == "applied", s.st.mem.get(r).contains(s.st.unit.get(r).ev), s.st.lockHolder == r,
    s' = { ...s, now: s.now, st: { ...s.st,
      committed: s.st.mem.get(r),
      acked: s.st.acked.union(Set(s.st.unit.get(r).ev)),
      lockHolder: if (s.st.lockHolder == r) "" else s.st.lockHolder,
      unit: s.st.unit.set(r, { phase: "idle", ev: "" }) },
      tk: { ...s.tk, lastSave: s.now } },
  }
  /** The save transaction throws (or its lock connection is gone): nothing is committed, the lock is released, memory keeps the change. */
  action saveFails(r: str): bool = all {
    s.st.unit.get(r).phase == "applied", s.st.mem.get(r).contains(s.st.unit.get(r).ev),
    s' = { ...s, st: { ...s.st,
      lockHolder: if (s.st.lockHolder == r) "" else s.st.lockHolder,
      unit: s.st.unit.set(r, { phase: "idle", ev: "" }) } },
  }
  /** The reserved connection dies while fn runs: Postgres frees the session lock; fn goes on (store.ts:341-354, SD-110). */
  action loseConnection(r: str): bool = all {
    s.st.lockHolder == r, not(s.st.lostConn),
    s' = { ...s, st: { ...s.st, lockHolder: "", lostConn: true } },
  }

  /**
   * network.ts sid(): an opportunity id is `slop.nw-<seed>-<oppSeq>` in slop:nyc and `slop.<city>.nw-<seed>-<oppSeq>`
   * in any other city (SD-111 fix, d351405). Every network still has seed NETWORK_SEED (server.ts:80).
   */
  pure def oppId(n: str, seq: int): (str, int) = (if (n == "slop:nyc") "slop" else n, seq)
  action mint(n: str): bool = all {
    s.st.twoCities or n == "slop:nyc", s.st.oppSeq.get(n) < 2,
    val seq = s.st.oppSeq.get(n) + 1
    s' = { ...s, st: { ...s.st, oppSeq: s.st.oppSeq.set(n, seq), oppRows: s.st.oppRows.put(oppId(n, seq), n), minted: s.st.minted.union(Set((n, seq))) } },
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
   * restore.ts: --roles is refused when the target host:port string equals the source one, or when the target
   * server's pg_control_system() system identifier equals the one the manifest recorded (SD-165 fix, cadd3c3).
   * The documented setup reaches one server as postgres.railway.internal and through the TCP proxy: one system id.
   * This assumes a manifest that records source.systemId (backup.ts records it); an older manifest has only
   * host and port, and backup_restore.qnt (rolesViaProxyOldManifestTest) covers that case.
   */
  action restoreRoles(target: str): bool = all {
    val reallySource = target != "new-server"
    val onSource = target == "source-internal-host" or reallySource
    s' = { ...s, st: { ...s.st, rolesOnSource: s.st.rolesOnSource or (not(onSource) and reallySource) } },
  }

  // ------------------------------------------------------------------ M-140, M-141 tick loop

  /** A crash or an error leaves a platform.inbound row waiting (service.ts:590-594 drains them). */
  action inboundLeftWaiting: bool = all {
    s.tk.inboxAge == -1,
    s' = { ...s, tk: { ...s.tk, inboxAge: 0 } },
  }
  /** An OTP challenge or a session passes its retention time (service.ts:597-608 purges them). */
  action rowExpires: bool = all {
    s.tk.expiredAge == -1,
    s' = { ...s, tk: { ...s.tk, expiredAge: 0 } },
  }
  pure def older(age: int): int = if (age < 0) -1 else age + 1

  /**
   * One round of the tick loop. "serve": serve.ts:131-149 runs inboxTick, every rt.tick(), purge, notifyTick.
   * "backend": backend.ts createBackend tickAll now runs the same steps (SD-003 fix, b862c95): inboxTick, the
   * network ticks, purge, notifyTick, beside opsTick. tickOk: rt.tick() did not throw.
   */
  action tickRound(tickOk: bool): bool = all {
    s.tk.lastRoundAt < s.now, s.pr.phase == "running",
    s' = { ...s, tk: { ...s.tk,
      inboxAge: -1,
      expiredAge: -1,
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
   * One ops round: createOps().tick (ops.ts:574-592): collect, evaluate, dispatch under the advisory lock
   * (ops.ts:438-489), then the heartbeat GET. readOk: collectNetwork did not throw (ops.ts:228-230).
   * postOk: the webhook answered 2xx. limited: postsLastHour >= ALERT_MAX_PER_HOUR.
   */
  action opsRound(readOk: bool, postOk: bool, limited: bool): bool = all {
    s.al.lastOpsAt < s.now, s.pr.phase == "running",
    val cur = current(s, readOk)
    val truth = current(s, true)
    val prev = s.al.st
    // ops.ts unread(): a failed read of the network leaves its keys unknown; they neither resolve nor close (SD-113 fix, 7717e2b).
    val known = ALERT_KEYS.filter(k => readOk or k == "read")
    val firing = ALERT_KEYS.filter(k => and { cur.get(k).on, isDue(nextA(prev.get(k), cur.get(k)), cur.get(k), s.now) })
    // failedWhileOpen is lastFailedAt: an alert whose post failed is resolved with a notice, never closed quietly (SD-235 fix, 0f6ca0f).
    val resolving = known.filter(k => and { not(cur.get(k).on), prev.get(k).open, prev.get(k).sent or prev.get(k).failedWhileOpen })
    val quiet = known.filter(k => and { not(cur.get(k).on), prev.get(k).open, not(prev.get(k).sent), not(prev.get(k).failedWhileOpen) })
    val posted = and { firing.union(resolving).size() > 0, not(limited) }
    val ok = and { posted, postOk }
    // createOps().tick: no heartbeat after a round whose alert post failed (SD-360 fix, 6a25b4c).
    val pinged = not(posted and not(ok))
    val nextSt = ALERT_KEYS.mapBy(k =>
      if (cur.get(k).on)
        val a = nextA(prev.get(k), cur.get(k))
        if (ok and firing.contains(k)) { ...a, sent: true, lastSentAt: s.now, lastSentCount: a.count }
        else if (posted and firing.contains(k)) { ...a, failedWhileOpen: true }
        else a
      else if (quiet.contains(k)) { ...prev.get(k), open: false }
      else if (ok and resolving.contains(k)) { ...prev.get(k), open: false }
      else prev.get(k))
    s' = { ...s, al: { ...s.al,
      st: nextSt, lastOpsAt: s.now, posts: if (posted) s.al.posts + 1 else s.al.posts,
      badResolve: s.al.badResolve or (ok and resolving.exists(k => truth.get(k).on)),
      bumpMissed: s.al.bumpMissed or ALERT_KEYS.exists(k => and {
        cur.get(k).on, cur.get(k).bump, prev.get(k).open, cur.get(k).count > prev.get(k).count, not(firing.contains(k)) }),
      silentClose: s.al.silentClose or quiet.exists(k => prev.get(k).failedWhileOpen),
      heartbeatLie: s.al.heartbeatLie or (pinged and posted and not(ok)),
      lateUnseen: s.al.lateUnseen or and { readOk, s.bi.failedSinceReport, biasLate(s.bi, s.now), not(cur.get("late").on) } } },
  }

  // ------------------------------------------------------------------ M-151, M-152 weekly bias

  /**
   * service.ts:553-556 inside afterTick (runtime.ts:763, after the tick lock is released): read max(at).
   * memberReadOk false: the member query throws; runtime.ts:763 logs "[tick] after-tick work failed" (no [alert]).
   */
  action biasCheck(r: str, memberReadOk: bool): bool = all {
    s.bi.phase.get(r) == "idle", s.now - lastReportAt(s.bi) >= WEEK,
    if (memberReadOk) s' = { ...s, bi: { ...s.bi, phase: s.bi.phase.set(r, "read"), startedAt: s.bi.startedAt.set(r, s.now) } }
    else s' = { ...s, bi: { ...s.bi, failedSinceReport: true } },
  }
  /**
   * service.ts weeklyBias after the fixes:
   * - rt.readState (SD-448 fix, b75d5b2): under the Network lock (it waits for this process's unit and for the
   *   advisory lock), load the newest stored state into rt.net and report on its opps.
   * - the insert under pg_advisory_xact_lock("bias-report-<id>") checks max(at) again with the `now` the run
   *   took at its start, and skips when a report is newer than a week (SD-446 fix, ba5ec1b).
   */
  action biasInsert(r: str, alerts: int): bool = all {
    s.bi.phase.get(r) == "read", s.st.lockHolder == "", s.st.unit.get(r).phase == "idle",
    val at = s.bi.startedAt.get(r)
    val view = s.st.committed
    val fresh = at - lastReportAt(s.bi) >= WEEK
    s' = { ...s,
      st: { ...s.st, mem: s.st.mem.set(r, view) },
      bi: { ...s.bi,
        phase: s.bi.phase.set(r, "idle"),
        reports: if (fresh) s.bi.reports.union(Set((at, alerts, r))) else s.bi.reports,
        failedSinceReport: if (fresh) false else s.bi.failedSinceReport,
        dirtyRead: s.bi.dirtyRead or view.exists(e => not(s.st.committed.contains(e)) and not(s.st.rolledBack.contains(e))) } },
  }

  // ------------------------------------------------------------------ M-142 process lifecycle

  /** A request that never finishes (a stuck /internal/turn or MCP call), or a tick that hangs. */
  action stuckWork(kind: str): bool = all {
    s.pr.phase == "running", s.pr.stuck == "none",
    s' = { ...s, pr: { ...s.pr, stuck: kind } },
  }
  /** backend.ts shutdown: draining, clear the timer, start the grace timer (SD-158 fix, 9f40c5e), then await s.stop(false) for each server. */
  action sigterm: bool = all {
    s.pr.phase == "running",
    s' = { ...s, pr: { ...s.pr, phase: "stopping", sigtermAt: s.now, graceAt: s.now } },
  }
  /** Bun 1.4.2: server.stop(false) resolves only when the in-flight requests end (checked by a local run). */
  action serversStopped: bool = all {
    s.pr.phase == "stopping", s.pr.stuck != "http",
    s' = { ...s, pr: { ...s.pr, phase: "waiting" } },
  }
  /** backend.ts:471-475: every tracked promise settled before the grace timer: svc.close, clean. */
  action drained: bool = all {
    s.pr.phase == "waiting", s.pr.stuck == "none",
    s' = { ...s, pr: { ...s.pr, phase: "closed", clean: true } },
  }
  /** backend.ts shutdown: the grace timer wins the race against the HTTP drain and the tracked work: stop(true), svc.close anyway, not clean. */
  action graceFires: bool = all {
    s.pr.phase == "stopping" or s.pr.phase == "waiting", s.now >= s.pr.graceAt + GRACE,
    s' = { ...s, pr: { ...s.pr, phase: "closed", clean: false } },
  }
  /** Railway sends SIGKILL 30 s after SIGTERM. */
  action sigkill: bool = all {
    s.pr.phase == "stopping" or s.pr.phase == "waiting", s.now >= s.pr.sigtermAt + KILL,
    s' = { ...s, pr: { ...s.pr, phase: "killed" } },
  }

  // ------------------------------------------------------------------ M-143, M-144 boot

  /** migrate.ts:84-107: one transaction under pg_advisory_xact_lock: all pending migrations and the ledger, or nothing. */
  action migrate: bool = all {
    s.bt.step == "start",
    s' = { ...s, bt: { ...s.bt, applied: if (s.bt.ledger) s.bt.applied else s.bt.applied + 1, ledger: true, step: "migrated" } },
  }
  /** server.ts:51 ensureServiceLogin, backend.ts:497-498: an existing role is left as it is. */
  action ensureLoginStart: bool = all {
    s.bt.step == "migrated",
    s' = { ...s, bt: { ...s.bt, step: if (s.bt.roleExists) "check" else "create" } },
  }
  /** backend.ts ensureServiceLogin: create role, grant network_service and grant connect in one transaction (SD-163 fix, 2a3408b). */
  action bootCreate: bool = all { s.bt.step == "create", s' = { ...s, bt: { ...s.bt, roleExists: true, member: true, connect: true, step: "check" } } }
  /** server.ts serviceLoginProblem: also refuses a login that is not a member of network_service (SD-163 fix). */
  action loginCheck: bool = all {
    s.bt.step == "check",
    s' = { ...s, bt: { ...s.bt, step: if (s.bt.member) "up" else "failed",
      checkPassedIncomplete: s.bt.checkPassedIncomplete or (s.bt.member and not(s.bt.connect)) } },
  }
  /** The process exits (crash, "start failed") at any boot step; the host restarts it. */
  action bootCrash: bool = all {
    s.bt.step != "start", s.bt.step != "up",
    s' = { ...s, bt: { ...s.bt, step: "start" } },
  }

  // ------------------------------------------------------------------ M-153 one LLM call

  /** llm.ts:256-338: one loop iteration. */
  action llmAttempt(outcome: str): bool = all {
    s.ll.done == "",
    val l = { ...s.ll, attempts: s.ll.attempts + 1 }
    val nl =
      if (outcome == "ok") { ...l, done: "ok" }
      // llm.ts:327-336: an empty or length-truncated reply doubles the budget up to MAX_REGROWS times. After
      // that, a truncated reply throws, and an empty one that was not truncated is returned as "".
      else if (outcome == "empty") (if (l.regrows < MAX_REGROWS) { ...l, regrows: l.regrows + 1 } else { ...l, done: "ok" })
      else if (outcome == "truncated") (if (l.regrows < MAX_REGROWS) { ...l, regrows: l.regrows + 1 } else { ...l, done: "error" })
      else if (outcome == "retryable") (
        if (l.e < EPS - 1) { ...l, e: l.e + 1 }
        else if (l.retries >= MAX_RETRIES) { ...l, done: "error" }
        else { ...l, retries: l.retries + 1 })
      else { ...l, done: "error" }
    s' = { ...s, ll: nl },
  }

  // ------------------------------------------------------------------ M-149 wrangler guard

  /**
   * wrangler.sh:115-129: run only when both decide modes say read-only (no NTWRK_ALLOW_DEPLOY). unkTakesValue: how
   * wrangler reads a flag it does not declare (the oracle's open choice).
   */
  action runWrangler(unkTakesValue: bool): bool = all {
    not(s.wr.ran),
    val allowed = guardAllows(s.wr.args)
    s' = { ...s, wr: { ...s.wr, ran: true, allowed: allowed, unk: unkTakesValue,
                      deploys: allowed and wranglerDeploys(unkTakesValue, s.wr.args) } },
  }

  // ------------------------------------------------------------------ M-147 Cloudflare cutover

  /** A deploy with BACKEND_ENABLED=true and BUILD_ID: the container runs the backend (worker.ts:61-71). */
  action cfActivate: bool = all {
    not(s.cf.enabled),
    s' = { ...s, cf: { target: "cf", enabled: true, buildIdOk: true, configSet: true, containerRunning: true, cronSinceInactive: false } },
  }
  /**
   * The rollback deploy without BACKEND_ENABLED; the operator may leave out --var BUILD_ID (SD-159), or
   * the BACKEND_RUNTIME_CONFIG secret (worker.ts:55 then returns before stop()).
   */
  action cfDeactivate(withBuildId: bool, withConfig: bool): bool = all {
    s.cf.enabled,
    s' = { ...s, cf: { ...s.cf, target: "railway", enabled: false, buildIdOk: withBuildId, configSet: withConfig, cronSinceInactive: false } },
  }
  /**
   * worker.ts:72-76 scheduled() on an inactive deploy, and worker.ts:64-66 fetch() on an inactive deploy (one
   * action here): stopInactiveBackend (worker.ts:53-59). Without BACKEND_RUNTIME_CONFIG it returns at once
   * (worker.ts:55). Else getContainer(...).stop(): the Durable Object's constructor runs on the new deploy and
   * throws when BUILD_ID is not 40 hex (worker.ts:36), so stop() never sends SIGTERM.
   */
  action cfCron: bool = all {
    not(s.cf.enabled),
    s' = { ...s, cf: { ...s.cf, cronSinceInactive: true, containerRunning: s.cf.containerRunning and not(s.cf.buildIdOk and s.cf.configSet) } },
  }

  // ------------------------------------------------------------------ step

  // Weights for the random walk only: in one step of 8 the clock moves on when it can; otherwise every action
  // (advance included) is a branch of the `any` below, so the reachable states do not change. Without this, the
  // 7 ticks that bias_late needs (witness_biasLateAlert) come in about one trace of 40000, and a change elsewhere
  // in `step` (one more nondet choice) can move them past max-samples.
  action step = {
    nondet clock = oneOf(1.to(8))
    if (clock == 1 and s.now < MAX_T and not(urgent(s))) advance else stepAny
  }
  action stepAny = any {
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
    migrate, ensureLoginStart, bootCreate, loginCheck, bootCrash,
    nondet outcome = oneOf(Set("ok", "empty", "truncated", "retryable", "fatal")) llmAttempt(outcome),
    nondet unk = oneOf(Set(true, false)) runWrangler(unk),
    cfActivate,
    nondet b = oneOf(Set(true, false))
    nondet cfg = oneOf(Set(true, false))
    cfDeactivate(b, cfg),
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
   * NOT IN `safety`: SD-050 is open, skipped for a founder decision (which consent record outside the
   * restored database to replay, and whether sends stay dry-run after a restore). restoreRollsBackStopTest replays it.
   */
  val restoreKeepsStops = s.st.channel == "eliza_cloud" or s.st.rolledBack.forall(e => s.st.committed.contains(e))

  /** runbook-real.md 8.3 step 2: "the script refuses it [--roles] on the source server". SD-165. */
  val restoreRolesNotOnSource = not(s.st.rolesOnSource)

  /**
   * schema.sql: network.opportunities id is the primary key shared by every network; each network owns
   * the rows it writes (store.ts:281-287 deletes only "rows this store wrote"). SD-111.
   */
  val oppIdsOwned = s.st.minted.forall(m => s.st.oppRows.get(oppId(m._1, m._2)) == m._1)

  /**
   * dueHasCaller: every row with a due rule has a caller in the production tick set. service.ts:590
   * ("Inbound messages a crash or an error left waiting: handled once") and service.ts:597 (retention,
   * audit platform-18). SD-003.
   */
  val dueHasCaller = s.tk.inboxAge <= STALE and s.tk.expiredAge <= STALE

  /**
   * docs/deploy.md 7.2: tick_late fires when "No tick stored for the network for ALERT_TICK_LATE_MS".
   * Evaluated on the code's own condition (ops.ts collectNetwork and evaluate). SD-368.
   */
  val tickLateSeen = (s.now - s.tk.lastTickRan > TICK_LATE) implies (s.now - lastSeen(s.tk) > TICK_LATE)

  /** docs/deploy.md 7.2: "When it ends, one resolved notice is posted": only when the read shows it ended. SD-113. */
  val alertResolvedOnlyOnRead = not(s.al.badResolve)

  /** docs/deploy.md 7.2: posted again "when a safety alert's count goes up". SD-161. */
  val bumpPosted = not(s.al.bumpMissed)

  /**
   * ops.ts:464-465 comment: an alert closes quietly only when "it started and ended between rate-limited
   * rounds". One that a failed webhook never delivered must not vanish. SD-235.
   */
  val noSilentClose = not(s.al.silentClose)

  /** docs/deploy.md 7.1.2: "A missing heartbeat means ... its alert dispatcher stopped." SD-360. */
  val heartbeatHonest = not(s.al.heartbeatLie)

  /** AGENTS.md item 12: "Admin runs biasMonitor weekly": one report per network per week. SD-446. */
  val oneReportPerWeek = s.bi.reports.forall(a => s.bi.reports.forall(b => a == b or abs(a._1 - b._1) >= WEEK))

  /**
   * AGENTS.md item 12 (weekly bias monitor, alert below 0.8x): a weekly run that failed and was not
   * followed by a report is visible as an alert once it is a day late. SD-233.
   * Wave 2: the first form, not(failedSinceReport and late), asked that no week is ever late, which no
   * alert can give (an alert does not write a report, and the oracle can fail every run). The rule is about
   * being seen: every ops round that reads the network while a failed week is late must have the alert on.
   */
  val skippedWeekSeen = not(s.al.lateUnseen)

  /** AGENTS.md: the weekly bias report is computed from committed network state (the store is the truth). SD-448. */
  val biasReadsCommitted = not(s.bi.dirtyRead)

  /** backend.ts:459-464: "After shutdownGraceMs the pool closes anyway" (GRACE < KILL). SD-158. */
  val closeBeforeKill = s.pr.phase != "killed"

  /** backend.ts:486-490: the service login is created as LOGIN, member of network_service, CONNECT. The boot check must see a half-made role. SD-163. */
  val bootLoginComplete = not(s.bt.checkPassedIncomplete)

  /** migrate.ts:3-4: "two processes never apply the same migration twice". */
  val migrationOnce = s.bt.applied <= 1

  /** llm.ts:189-192 and AGENTS.md LLMs: retries at most LLM_MAX_RETRIES, plus one fallback and two regrows. */
  val llmAttemptBound = s.ll.attempts <= EPS + MAX_RETRIES + MAX_REGROWS

  /**
   * AGENTS.md Environment: wrangler.sh "refuses deploy (except --dry-run) ... unless NTWRK_ALLOW_DEPLOY=1". SD-168.
   * The guard (decide in both modes, as the script reads the tokens) is checked against the yargs oracle, which is
   * written from wrangler's declared options and leaves the reading of an undeclared flag open. The check can fail:
   * with one mode only, "--new-flag whoami deploy" passes the guard and wrangler (undeclared flag takes a value)
   * deploys; without the "true"/"false" value rule, "deploy --help false" passes and deploys (findings file 2.1).
   */
  val guardSound = not(s.wr.deploys)

  /**
   * README rollback: an inactive Worker stops the container (worker.ts:56-58 comment: SIGTERM). SD-159; a
   * rollback without BACKEND_RUNTIME_CONFIG also leaves it running (worker.ts:55, cfNoConfigTest).
   * NOT IN `safety`: SD-159 is open, skipped because the fix needs a test in workerd (Durable Objects and
   * Containers), and no Workers runtime is in the repository; a Bun stub would be mock-only proof. cfNoBuildIdTest replays it.
   */
  val inactiveStops = (not(s.cf.enabled) and s.cf.cronSinceInactive) implies not(s.cf.containerRunning)

  /**
   * AGENTS.md: every proactive proposal waits for human review; the console must reach the staff API. SD-169.
   * NOT IN `safety`: SD-169 is open, skipped for a founder decision (how the console reaches the staff API
   * after the Cloudflare cutover changes the staff API's security boundary). Fails closed: review items expire unsent.
   */
  val staffRouted = staffRouteExists(s.cf.target)

  val safety = and {
    noLostWrite, restoreRolesNotOnSource, oppIdsOwned, dueHasCaller, tickLateSeen,
    alertResolvedOnlyOnRead, bumpPosted, noSilentClose, heartbeatHonest, oneReportPerWeek, skippedWeekSeen,
    biasReadsCommitted, closeBeforeKill, bootLoginComplete, migrationOnce, llmAttemptBound, guardSound,
  }

  /** The invariants of the open defects (SD-050, SD-159, SD-169). Each fails; see its comment. */
  val openDefects = and { restoreKeepsStops, inactiveStops, staffRouted }

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
  val witness_cfStopped = not(s.cf.cronSinceInactive and not(s.cf.containerRunning) and s.cf.buildIdOk and s.cf.configSet)
  val witness_biasLateAlert = not(s.al.st.get("late").open and s.al.st.get("late").sent)
  val witness_lockLostSaveFails = not(s.st.lostConn and s.st.acked.size() == 1)
  val witness_handMadeLoginRefused = not(s.bt.roleExists and not(s.bt.member) and s.bt.step == "failed")

  // ------------------------------------------------------------------ run tests (concrete traces)

  action initProd = initWith("backend", "blooio", false, List("deploy", "--dry-run", "--dry-run"), false)
  action initServe = initWith("serve", "blooio", false, List("deploy", "--dry-run", "--dry-run"), false)

  /**
   * SD-110 fixed: A loads, loses its lock connection, B commits stop2. A's save runs on the lost lock
   * connection and cannot commit: only saveFails is enabled, and stop2 stays committed.
   * (Before the fix: A's save committed {stop1} and lost the acknowledged stop2.)
   */
  run lostLockTest = initProd
    .then(takeLock("A", "stop1")).then(load("A")).then(loseConnection("A"))
    .then(takeLock("B", "stop2")).then(load("B")).then(apply("B")).then(save("B"))
    .then(apply("A")).expect(s.st.lockHolder != "A")
    .then(saveFails("A"))
    .expect(noLostWrite and s.st.committed == Set("stop2") and s.st.acked == Set("stop2"))

  /** With the lock held the whole time, the same two units keep both STOPs. */
  run lockedUnitsTest = initProd
    .then(takeLock("A", "stop1")).then(load("A")).then(apply("A")).then(save("A"))
    .then(takeLock("B", "stop2")).then(load("B")).then(apply("B")).then(save("B"))
    .expect(noLostWrite and s.st.committed == Set("stop1", "stop2"))

  /** SD-050 (open, founder decision): backup, STOP acknowledged, restore: the member reads as opted in again on blooio. */
  run restoreRollsBackStopTest = initProd
    .then(backupRun)
    .then(takeLock("A", "stop1")).then(load("A")).then(apply("A")).then(save("A"))
    .then(restore)
    .expect(not(restoreKeepsStops) and noLostWrite and safety)

  /** SD-003 fixed: the deployed tick set drains a waiting inbound row and purges expired rows, as serve.ts does. */
  run backendTickSetTest = initProd
    .then(inboundLeftWaiting).then(rowExpires)
    .then(advance).then(tickRound(true))
    .expect(dueHasCaller and s.tk.inboxAge == -1 and s.tk.expiredAge == -1)
  run serveTickSetTest = initServe
    .then(inboundLeftWaiting).then(rowExpires)
    .then(advance).then(tickRound(true)).then(advance).then(tickRound(true))
    .then(advance).then(tickRound(true)).then(advance).then(tickRound(true))
    .expect(dueHasCaller and s.tk.inboxAge == -1)

  /** SD-161 fixed: sent at 3, staff clear to 1 (the baseline falls to 1), two new signals: the rise to 3 is posted at once. */
  run bumpAfterClearTest = initProd
    .then(signalArrives).then(signalArrives).then(signalArrives)
    .then(advance).then(opsRound(true, true, false))
    .then(staffDecides(1))
    .then(advance).then(opsRound(true, true, false))
    .then(signalArrives).then(signalArrives)
    .then(advance).then(opsRound(true, true, false))
    .expect(bumpPosted and s.al.posts == 2 and s.al.st.get("sig").lastSentCount == 3 and s.al.st.get("sig").lastSentAt == 3)

  /** SD-113 fixed: an open, posted safety alert, then one failed read: the alert stays open and no "resolved" is posted. */
  run readErrorResolvesTest = initProd
    .then(signalArrives)
    .then(advance).then(opsRound(true, true, false))
    .then(advance).then(opsRound(false, true, false))
    .expect(alertResolvedOnlyOnRead and s.al.st.get("sig").open and s.al.st.get("read").open)

  /**
   * SD-235 and SD-360 fixed: the webhook fails while the alert lasts (no heartbeat that round); when the
   * signal is decided, the end of the alert is posted, not closed quietly.
   */
  run silentCloseTest = initProd
    .then(signalArrives)
    .then(advance).then(opsRound(true, false, false))
    .then(staffDecides(0))
    .then(advance).then(opsRound(true, true, false))
    .expect(noSilentClose and heartbeatHonest and s.al.posts == 2 and not(s.al.st.get("sig").open))

  /** SD-368 fixed: ticks throw each round and an inbound save refreshes saved_at; tick_late still fires on the stored tick. */
  run tickLateMaskedTest = initProd
    .then(advance).then(tickRound(false)).then(advance).then(tickRound(false))
    .then(takeLock("A", "stop1")).then(load("A")).then(apply("A")).then(save("A"))
    .then(advance).then(tickRound(false))
    .then(opsRound(true, true, false))
    .expect(tickLateSeen and s.al.st.get("tick").open and s.al.st.get("tick").sent)

  /** SD-446 fixed: both replicas read the old max(at); the second insert checks again under the lock and skips. */
  run twoReportsTest = initProd
    .then(biasCheck("A", true)).then(biasCheck("B", true))
    .then(biasInsert("A", 0)).then(advance).then(biasInsert("B", 0))
    .expect(oneReportPerWeek and s.bi.reports.size() == 1)

  /** SD-158 fixed: a stuck HTTP request holds s.stop(false), but the grace timer started at SIGTERM ends the shutdown before SIGKILL. */
  run stuckRequestGraceTest = initProd
    .then(stuckWork("http")).then(sigterm)
    .then(advance).then(advance).expect(urgent(s) and s.now < s.pr.sigtermAt + KILL)
    .then(graceFires)
    .expect(closeBeforeKill and s.pr.phase == "closed" and not(s.pr.clean))
  /** A hung tick (not an HTTP request) is ended by the grace timer before SIGKILL. */
  run stuckTickGraceTest = initProd
    .then(stuckWork("tick")).then(sigterm).then(serversStopped)
    .then(advance).then(advance).then(graceFires)
    .expect(closeBeforeKill and s.pr.phase == "closed")

  /** SD-163 fixed: a crash before the one-transaction create leaves no role; the next boot makes a complete login. */
  run halfRoleTest = initProd
    .then(migrate).then(ensureLoginStart).then(bootCrash)
    .then(migrate).then(ensureLoginStart).then(bootCreate).then(loginCheck)
    .expect(bootLoginComplete and s.bt.step == "up" and s.bt.member and s.bt.connect and migrationOnce)
  /** SD-163 fixed: a login made by hand without network_service is refused by the boot check. */
  run handMadeLoginTest = initWith("backend", "blooio", false, List("deploy", "--dry-run", "--dry-run"), true)
    .then(migrate).then(ensureLoginStart).then(loginCheck)
    .expect(bootLoginComplete and s.bt.step == "failed")

  /** SD-168 fixed: "deploy --help --no-help" and "deploy --help false" are refused by the guard. */
  run helpFlagTest = initWith("backend", "blooio", false, List("deploy", "--help", "--no-help"), false)
    .then(runWrangler(true))
    .expect(guardSound and not(s.wr.allowed))
  run helpFalseTest = initWith("backend", "blooio", false, List("deploy", "--help", "false"), false)
    .then(runWrangler(true))
    .expect(guardSound and not(s.wr.allowed))
  run dryRunTest = initWith("backend", "blooio", false, List("deploy", "--dry-run", "--help=false"), false)
    .then(runWrangler(true))
    .expect(guardSound and s.wr.allowed)
  run dryRunTrueTest = initWith("backend", "blooio", false, List("deploy", "--dry-run", "true"), false)
    .then(runWrangler(true))
    .expect(guardSound and s.wr.allowed)
  /**
   * The dual-mode path (wrangler.sh:33-35): "--new-flag whoami deploy" reads "whoami" as the command in mode
   * "switch" and "deploy" in mode "value". The guard refuses it; wrangler would deploy if the flag takes a value.
   */
  run unknownFlagTest = initWith("backend", "blooio", false, List("--new-flag", "whoami", "deploy"), false)
    .then(runWrangler(true))
    .expect(guardSound and not(s.wr.allowed) and decide("switch", s.wr.args) and not(decide("value", s.wr.args))
            and wranglerDeploys(true, s.wr.args) and not(wranglerDeploys(false, s.wr.args)))
  /** A value flag: "--config deploy whoami" is "whoami" for the guard and for wrangler (it runs). */
  run valueFlagTest = initWith("backend", "blooio", false, List("--config", "deploy", "whoami"), false)
    .then(runWrangler(false))
    .expect(guardSound and s.wr.allowed and not(wranglerDeploys(true, s.wr.args)))
  /** Every 3-token command over WR_TOKENS and both readings of the undeclared flag: the guard never lets a deploy run. */
  run guardExhaustiveTest = initProd
    .expect(WR_COMMANDS.forall(c => Set(true, false).forall(u => not(guardAllows(c) and wranglerDeploys(u, c))))
            and WR_COMMANDS.exists(c => guardAllows(c) and c[0] == "deploy")
            and WR_COMMANDS.exists(c => wranglerDeploys(true, c) and not(guardAllows(c))))

  /** SD-159 (open, no Workers runtime to test the fix): rollback without BUILD_ID: the cron cannot stop the container. */
  run cfNoBuildIdTest = initProd
    .then(cfActivate).then(cfDeactivate(false, true)).then(cfCron)
    .expect(not(inactiveStops) and safety)

  /** The same open invariant (SD-159 family): a rollback without BACKEND_RUNTIME_CONFIG returns before stop(). */
  run cfNoConfigTest = initProd
    .then(cfActivate).then(cfDeactivate(true, false)).then(cfCron)
    .expect(not(inactiveStops) and safety)
  /** A rollback with BUILD_ID and the runtime config: the inactive deploy stops the container. */
  run cfRollbackStopsTest = initProd
    .then(cfActivate).then(cfDeactivate(true, true)).then(cfCron)
    .expect(inactiveStops and safety)

  /** SD-169 (open, founder decision): after the cutover no route reaches the staff API. */
  run cfStaffRouteTest = initProd
    .then(cfActivate)
    .expect(not(staffRouted) and safety)

  /** SD-111 fixed: slop:nyc mints slop.nw-1-1 and slop:la mints slop.slop:la.nw-1-1: two rows. */
  run idCollisionTest = initWith("backend", "blooio", true, List("deploy", "--dry-run", "--dry-run"), false)
    .then(mint("slop:nyc")).then(mint("slop:la"))
    .expect(oppIdsOwned and s.st.oppRows.keys().size() == 2)

  /**
   * SD-448 fixed: an inbound unit has changed memory; the bias report waits for the unit (readState takes the
   * Network lock), the save fails, and the report reads the stored state.
   */
  run dirtyBiasReadTest = initProd
    .then(takeLock("A", "stop1")).then(load("A")).then(apply("A"))
    .then(biasCheck("A", true)).expect(s.st.unit.get("A").phase != "idle")
    .then(saveFails("A")).then(biasInsert("A", 0))
    .expect(biasReadsCommitted and s.bi.reports.size() == 1 and s.st.mem.get("A") == Set())

  /** SD-165 fixed: --roles through the TCP proxy name of the source server is refused (same system identifier). */
  run rolesOnSourceTest = initProd
    .then(restoreRoles("source-proxy-host")).then(restoreRoles("source-internal-host")).then(restoreRoles("new-server"))
    .expect(restoreRolesNotOnSource)

  /** SD-233 fixed: the member query fails at the weekly run; once a week and a day pass, the ops round raises bias_late. */
  run skippedWeekTest = initProd
    .then(biasCheck("A", false))
    .then(advance).then(advance).then(advance).then(advance).then(advance).then(advance).then(advance)
    .then(opsRound(true, true, false))
    .expect(skippedWeekSeen and s.al.st.get("late").open and s.al.st.get("late").sent)
  /** A new report ends bias_late with one resolved notice. */
  run biasLateEndsTest = initProd
    .then(advance).then(advance).then(advance).then(advance).then(advance).then(advance).then(advance)
    .then(opsRound(true, true, false))
    .then(biasCheck("A", true)).then(biasInsert("A", 0))
    .then(advance).then(opsRound(true, true, false))
    .expect(skippedWeekSeen and not(s.al.st.get("late").open) and s.al.posts == 2)

  /** The LLM bound: fallback, two retries, two regrows, then ok: 6 attempts, the bound. */
  run llmBoundTest = initProd
    .then(llmAttempt("retryable")).then(llmAttempt("retryable")).then(llmAttempt("retryable"))
    .then(llmAttempt("empty")).then(llmAttempt("empty")).then(llmAttempt("ok"))
    .expect(llmAttemptBound and s.ll.done == "ok" and s.ll.attempts == 6)
}
```
