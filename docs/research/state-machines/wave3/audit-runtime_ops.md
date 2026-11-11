# Audit: quint/runtime_ops.qnt coverage (wave 3)

Branch read: claude/quint-state-machines (working tree). Drift inputs: claude/formal-main docs/results/2026-11-09-quint-drift.md and quint/drift.json.
`bun run quint:check quint/runtime_ops.qnt` on this branch: typecheck, 26 run tests, safety, 15 witnesses ok (1 models, 0 failures).
Probes run (scratchpad only, no repo change): Bun 1.4.2 `SQL.close()` with a held reserved connection (local dev Postgres :54339); yargs-parser 21.1.1 (the version yargs 17.7.2 / wrangler 4 uses) against `scripts/wrangler.sh decide`.

## Suspected defects (new)

### D1 (P1) svc.close() never returns while a reserved lock connection is held: the SD-158 fix does not reach a clean exit
- Where: packages/network/service/service.ts:2791-2794 (`this.sql.close()` with no timeout); deploy/backend/backend.ts:465-467 (after the grace race, `await svc.close()`); packages/network/src/store.ts:341-355 (lock on `sql.reserve()`); packages/network/service/inbox.ts:275-278; packages/platform/src/pg-store.ts:306-310; packages/blooio/src/outbound-queue.ts:276.
- Probe: Bun 1.4.2, pool max 2, `reserve()` + `pg_advisory_lock`, then `await sql.close()`: still waiting after 6 s. `sql.close({ timeout: 1 })` returns in 1003 ms. A pending query also holds `close()` until it ends.
- Trigger: replica R1 has a unit in `PgStore.locked` whose `fn` hangs (stuck tick, or a turn waiting in `pg_advisory_lock` while the new replica R2 holds the network lock during the Railway overlap). SIGTERM -> grace (25 s) fires -> `stop(true)` -> `svc.close()` waits for the reserved connection -> Railway SIGKILL at 30 s. "shutdown complete" is never logged, the exit is not 0/1 from the process. Not a consent break (saves are atomic, Postgres frees the lock), but `closeBeforeKill` is false in code.
- Test gap: deploy/backend/backend-shutdown.integration.test.ts:11-17 uses a fake `close()`.
- Fix: close with a timeout after the grace race (`svc.close({ timeoutS })` -> `sql.close({ timeout })`), plus a Postgres-backed integration case that holds the lock in a unit that never ends and expects exit before 30 s.

### D2 (P1) Deploy guard bypass by yargs camel-case and `--h=` forms (this branch)
- Where: scripts/wrangler.sh:70-89 (`--*=*) ;;` and `-*)` read `--dryRun=false`, `--no-dryRun`, `--dryRun`, `--h=false` as unknown flags).
- Verified: `decide switch` and `decide value` both print 1 for `deploy --dry-run --dryRun=false`, `deploy --dry-run --no-dryRun`, `deploy --dry-run --dryRun false`, `deploy -h --h=false`. yargs-parser 21.1.1 with `boolean: [dry-run, help]` gives `dry-run=false` / `help=false` for each. So wrangler runs a real deploy without NTWRK_ALLOW_DEPLOY.
- Status: claude/formal-main fixes it in d83c5b7 (flag normalised with `tr -d '_-'`, `nodryrun`, `noh`), not merged here. The model cannot see it (M3).

### D3 (P1) bias_late (and tick_late) for a network with no stored row use per-process uptime; restarts reset it
- Where: deploy/backend/ops.ts:307 (`biasReportAgoMs === null ? uptimeMs > BIAS_EVERY_MS + DAY`), ops.ts:290 (tick_late), ops.ts:536 (`startedAt = d.now()` per process), ops.ts:561.
- Trigger: a new photo-app network (or a fresh database) where `weeklyBias` throws on every tick (service.ts:550-579: member query, `readState`, or insert fails; runtime.ts:701 logs "[tick] after-tick work failed"). railway.toml `watchPatterns = packages/**` redeploys on most merges, so no process lives 8 days. bias_late never fires; the weekly 0.8x monitor never runs and nothing alerts. This is SD-233 again for the "no report yet" branch.
- Fix: measure the no-report case from a stored time (the first stored tick or the oldest `network.members.joined_at`, or `ops_alerts`), not process uptime. Integration case: no bias report, uptime 1 h, stored first tick 9 days ago -> bias_late.

## Model errors

- M1 `graceFires` sets `closed` and `closeBeforeKill` holds, but code then awaits `svc.close()` (backend.ts:467), which waits for reserved connections (D1). `stuckTickGraceTest` (qnt:869-872) shows a behaviour the code does not have. Add a `closing` phase that needs no held lock connection (or a close timeout) before `closed`.
- M2 `bootLoginComplete` is vacuous: `member` becomes true only in `bootCreate`, which also sets `connect` (qnt:548); init never has member without connect (qnt:282). `checkPassedIncomplete` is unreachable. The code check (backend.ts:191-202) does not test CONNECT either (harmless: no CONNECT fails the connection).
- M3 `guardSound` oracle (`yargsStep`, qnt:239-253) has no camel-case expansion and no `--h=` / `-h=` / short-group forms; WR_TOKENS (qnt:59-60) has none of them. The model passes on a guard that D2 bypasses. Add `--dryRun=false`, `--no-dryRun`, `--h=false` tokens and camel/`no-` aliasing to the oracle.
- M4 `biasLate` (qnt:164-165) treats `now` as uptime and never restarts; hides D3. Add a `processStart` reset on `sigterm`/restart.
- M5 `tickLateSeen` (qnt:685) is `p implies p` since `lastSeen(tk) = tk.lastTickRan` (qnt:152). It no longer checks that an ops round raises tick_late. Rewrite as a ghost like `lateUnseen` (round reads ok and stored tick late, but tick alert off), and add the no-stored-tick uptime path.
- M6 `migrationOnce` (qnt:724) cannot fail: one `bt` record, `applied` increments only when `ledger` is false, `migrate` is atomic. No two-replica boot, no crash inside the transaction. It checks the model's own `if`.
- M7 `restoreRolesNotOnSource` is a tautology: `onSource = ... or reallySource` (qnt:385). The code compares systemId only when the manifest has it (restore.ts:50); a manifest with `source` but no `systemId` falls back to host strings. Already open drift on formal-main ("SD-165 residual"); not fixed here.
- M8 `llmAttempt("empty")` at MAX_REGROWS ends "error" (qnt:569); code returns `""` unless `finish_reason === "length"` (llm.ts:327-336). Fixed on formal-main model only.
- M9 `skippedWeekSeen` is conditioned on `failedSinceReport` (qnt:467). The rule (deploy.md 7.2, AGENTS item 12) is that a late weekly report is seen whatever the cause; `biasCheck` is also enabled with no tick, while code runs weeklyBias only from `afterTick` after a tick that ran (runtime.ts:701). Drop the `failedSinceReport` guard and gate `biasCheck` on a ran tick.
- M10 GRACE=2 < KILL=3 is a constant; code accepts any `SHUTDOWN_GRACE_MS >= 0` (backend.ts:177) while railway.toml drainingSeconds is 30. GRACE >= KILL is reachable by config. Make GRACE nondet or refuse >= 30000 when deployed.

## Model gaps

- G1 Inbound and purge steps can fail or hang: `tickRound` clears both ages always (qnt:408-416). Code swallows errors (service.ts:588-606); a hung `handleSender` (`pg_advisory_lock` on `inbox-sender:*`, inbox.ts:275-278, or a unit waiting for the network lock) keeps `busy("inbound")`, and `step` then skips every later inbound drain (backend.ts:416-417). `dueHasCaller` could fail. Add nondet drain outcome and a stuck inbound step.
- G2 In-process Queue: `withTickLock` returns undefined when this process's queue is busy (store.ts:328-330), reported as "another instance holds the lock" (backend.ts:428) and stamped in `tickDone`. Under steady inbound load ticks starve. tick_late still fires (stored tick), so no invariant break; the model has no skip.
- G3 afterTick SLA alerts read `rt.net` outside the lock (service.ts:540-541): the SD-448 dirty-memory class; only the bias read was moved under `readState`. Log lines only.
- G4 Ops is one network and one replica's snapshot. Code: probes fixed at boot (service.ts:387, server.ts:110); every replica collects, then one wins `pg_try_advisory_xact_lock` (ops.ts:375, 575-581). A stale snapshot can reopen an alert the other replica resolved; a network one replica lacks is "resolved" by it (not in `current`, not `unread`, ops.ts:462-468). Low (one replica in railway.toml, 10 s overlap).
- G5 Railway rollout (M-146) left out: old code on a new schema during overlap; restartPolicyMaxRetries=5 (railway.toml) ends `bootCrash` loops; healthcheckTimeout 120 s on first boot. No safety invariant at risk (saves atomic).
- G6 SIGTERM before handlers exist (server.ts:139-140 run after `svc.start()`, whose `rt.start()` takes the lock and delivers, runtime.ts start) kills at once. Safe by atomic save and queue recovery.
- G7 Restore precondition: model requires every unit idle (qnt:373-374); runbook 8.3 step 1 sets Railway replicas to 0 but does not stop an active Cloudflare container (M-147). With the CF cutover active, a container keeps working on the old database during the restore.
- G8 LLM deadline, abort, `budget.take`, Retry-After (llm.ts:262-283) are absent; they only shorten the loop, so `llmAttemptBound` is not at risk.
- G9 M-145 backup run and the SD-369 lock queue (pg_dump ACCESS SHARE -> migration waits up to 60 s with readers queued) are not modelled.

## Open carve-outs

- SD-050 `restoreKeepsStops` (founder). No consent record outside the restored database on the blooio channel; the audit table is in the same database. Not fixable in scope without the founder choosing the record and the post-restore dry-run rule.
- SD-159 `inactiveStops` (no workerd test). Fixable in code now (validate BUILD_ID/config only on the active path, so `stop()` on an inactive deploy builds no checked env; or require `--var BUILD_ID` on rollback in the README), but a test needs workerd with Containers, so the test policy blocks it. formal-main adds the missing-BACKEND_RUNTIME_CONFIG branch (worker.ts:55) as open drift.
- SD-169 `staffRouted` (founder): CF routes only port 8790 (worker.ts:70).
- SD-369 not reproduced: can be reproduced now with a Postgres integration case (RR transaction holding ACCESS SHARE, boot migrate with an ALTER, measure a concurrent turn). Fix candidate: a short boot lock_timeout with retry.
- SD-324 skipped as "needs upstream contract change", but the register says nothing writes `fell_back`: the `smsFallback` paths (ops.ts:195, 251-252, cost sms rows) are dead code; removing them is in scope ("remove dead code").
- SD-096, SD-239, SD-364, SD-366, SD-371, SD-453 skipped (design/founder/GitHub); no change.
- Bookkeeping: plan 6.14 lists SD-119, SD-160, SD-234, SD-238, SD-261, SD-280, SD-305, SD-306, SD-323, SD-365, SD-449, SD-452; section 5 of the findings file does not list them (all refuted in the register).
