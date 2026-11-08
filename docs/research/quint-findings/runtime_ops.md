# Quint findings: `quint/runtime_ops.qnt`

Module plan: [section 6.14 of the state-machine report](../2026-11-07-state-machines.md). Model: [quint/runtime_ops.qnt](../../../quint/runtime_ops.qnt).
This file is hand-written. The check output below is copied from the commands named with it.

## 1. What the model covers

One state variable `s` holds one record for each machine. Each action is one SQL transaction or one
`await` step. Oracles (a read error, the webhook result, the rate limit, an LLM reply, an operator choice)
are nondeterministic.

| Machine | Code | Actions |
|---|---|---|
| M-088 store-unit-of-work | `packages/network/src/store.ts:53-79, 249-333` | `takeLock`, `load`, `apply`, `save`, `saveFails`, `loseConnection`, `mint` |
| M-089 pg-restore-recovery | `docs/runbook-real.md` 8.3, `deploy/backup/restore.ts:44-46`, `deploy/backup/lib.ts:201-204` | `backupRun`, `restore`, `restoreRoles` |
| M-140, M-141 retention and tick loop | `deploy/backend/backend.ts:385-416` (tickSet `backend`), `packages/network/service/serve.ts:122-136` (tickSet `serve`), `service.ts:561-577` | `inboundLeftWaiting`, `rowExpires`, `tickRound` |
| M-142 process lifecycle | `deploy/backend/backend.ts:424-437`, `server.ts:131-139` | `stuckWork`, `sigterm`, `serversStopped`, `drained`, `graceFires`, `sigkill` |
| M-143, M-144 boot and migrations | `deploy/backend/server.ts:37-64`, `backend.ts:179-188, 447-461`, `packages/observatory/db/migrate.ts:74-108` | `migrate`, `ensureLoginStart`, `bootCreate`, `bootGrant`, `bootConnect`, `loginCheck`, `bootCrash` |
| M-147 Cloudflare cutover | `deploy/cloudflare/worker.ts` | `cfActivate`, `cfDeactivate`, `cfCron` |
| M-149 wrangler guard | `scripts/wrangler.sh:57-101` | `runWrangler` |
| M-150 alert dispatcher | `deploy/backend/ops.ts:193-221, 270-315, 381-442, 528-543` | `signalArrives`, `staffDecides`, `opsRound` |
| M-151, M-152 bias cadence and alert | `packages/network/service/service.ts:533-552`, `runtime.ts:658-668`, `ops.ts:246, 288` | `biasCheck`, `biasInsert` |
| M-153 LLM call | `packages/core/src/llm.ts:236-342` | `llmAttempt` |

Left out of the model (no state machine to check, or a fact outside the code): M-145 backup-run
flags, M-146 Railway rollout overlap (the model gives two replicas at all times instead), M-148 the
sites deploy workflow, M-184 in-process registries.

Bounds: two replicas, two STOP events, one lost connection, five alert keys (wave 2 adds `late`, bias_late), time 0..14 with
DAY=2, WEEK=4, TICK_LATE=2, REPEAT=4, GRACE=2 < KILL=3, EPS=2, MAX_RETRIES=2, MAX_REGROWS=2.

Facts checked outside Quint:

- Bun 1.4.2: `server.stop(false)` does not resolve while a request is in flight. A local run with a
  handler that never answers printed `still waiting after 3 s` (script in the session scratchpad, not
  in the repo). The model's `serversStopped` is therefore disabled while an HTTP request is stuck.
- `wrangler` (yargs) reads `--no-help` and `--help=false` as `help=false`, and the last value wins.
  This is an assumption of the model (`yargsStep`); wrangler was not run.
- A Cloudflare deploy creates new Durable Object instances, so the `NetworkBackend` constructor
  runs again with the new `env` before `stop()`. This is an assumption of the model (`cfCron`).

## 2. Final state (wave 2, branch `wave2/runtime_ops`)

The model now follows the code after the fixes on this branch (commits `ad67275..HEAD`). `safety` holds.
Three defects stay open. Their invariants are out of `safety` and are joined in the named value
`openDefects`, which fails; a run test replays each one.

What changed in the model, by action:

| Action or helper | Change | Fix |
|---|---|---|
| `save` | enabled only while `lockHolder == r`: the save runs on the lock connection; after `loseConnection` only `saveFails` is enabled | SD-110, 7240e5b |
| `mint`, `oppId` | the id of a network outside nyc carries the city, so two networks mint two rows | SD-111, d351405 |
| `tickRound` | both tick sets drain waiting inbound rows and purge expired rows | SD-003, b862c95 |
| `lastSeen` | only the stored tick; `saved_at` of a unit no longer counts | SD-368, dc7e3d0 |
| `opsRound` (`known`) | after a failed read, the network's keys neither resolve nor close quietly | SD-113, 7717e2b |
| `nextA` | a count under `lastSentCount` lowers that baseline | SD-161, 3b29163 |
| `opsRound` (`resolving`, `quiet`) | an alert with a failed post (`failedWhileOpen` = `lastFailedAt`) is resolved with a notice, never closed quietly; the failed resolve no longer sets the flag (the code sets `lastFailedAt` on firing alerts only) | SD-235, 0f6ca0f |
| `opsRound` (`pinged`) | no heartbeat after a round whose post failed | SD-360, 6a25b4c |
| `current`, `biasLate`, key `late` | bias_late is on when the newest report is older than WEEK + DAY, or there is none and uptime is past that | SD-233, e8a3171 |
| `biasCheck`, `biasInsert` | the run keeps the `now` it took at the start; the insert reads the stored state under the Network lock (`rt.readState`: waits for this replica's unit and the advisory lock, and loads `committed` into memory), then checks `max(at)` again under `pg_advisory_xact_lock` and skips when a report is newer than a week | SD-448 b75d5b2, SD-446 ba5ec1b |
| `sigterm`, `serversStopped`, `graceFires`, `urgent` | the grace timer starts at SIGTERM and also ends a drain that a hung HTTP request holds | SD-158, 9f40c5e |
| `bootCreate`, `loginCheck`, init `handMade` | create role, grant and connect are one transaction (one action); the check refuses a login outside `network_service`; init can start with a login made by hand without membership | SD-163, 2a3408b |
| `restoreRoles` | `--roles` is refused when the server's system identifier is the source's, whatever host name reaches it | SD-165, cadd3c3 |
| `decide`, `yargsStep`, tokens `true`, `false` | the last `--help` / `--no-help` / `--help=false` wins, and a `true` or `false` word after `--help` or `--dry-run` is its value, in the guard and in the yargs assumption | SD-168, 0706658 |

Invariant changes:

- `skippedWeekSeen` (SD-233) is now `not(lateUnseen)`: every ops round that reads the network while a failed
  weekly run is more than WEEK + DAY late has bias_late on. The first form, `not(failedSinceReport and late)`,
  asked that no week is ever late. No alert can give that (an alert writes no report, and the oracle can fail
  every run), so the first form described the defect loosely, not the rule. The new form is the rule as
  AGENTS.md item 12 and docs/deploy.md 7.2 state it (the failure is seen). No other invariant was changed.
- `restoreKeepsStops` (SD-050), `inactiveStops` (SD-159) and `staffRouted` (SD-169) moved out of `safety`
  into `openDefects`, each with a comment that gives the reason.

## 3. Check output

The bounds line is now `max-steps=30 max-samples=50000 verify-steps=5` (it was 24 x 6000). With 24 x 6000
the random simulation did not reach `witness_biasLateAlert`: the bias_late alert needs about seven `advance`
steps and an ops round before any SIGTERM. The full check takes about 37 s.

`bun run quint:check quint/runtime_ops.qnt` (seed 0x5eed, max-steps 30, max-samples 50000):

```
ok   typecheck
ok   test                      (26 run tests passing)
ok   safety
ok   witness_stopCommitted, witness_cleanRestore, witness_tickRan, witness_alertPosted,
     witness_alertResolved, witness_biasReport, witness_cleanShutdown, witness_graceShutdown,
     witness_bootUp, witness_llmRegrowOk, witness_wranglerDryRun, witness_cfStopped,
     witness_biasLateAlert, witness_lockLostSaveFails, witness_handMadeLoginRefused  (all reachable)
```

Larger run, one invariant at a time (`quint run ... --backend rust --seed 0x5eed --max-steps 40 --max-samples 100000`):

| Invariant | Result |
|---|---|
| `safety` | no violation (33 s) |
| `openDefects` | violation (expected: SD-050, SD-159, SD-169) |
| `restoreKeepsStops` | violation (SD-050) |
| `inactiveStops` | violation (SD-159) |
| `staffRouted` | violation (SD-169) |

`bun run quint:check --verify quint/runtime_ops.qnt` (Apalache 0.62.4, `quint verify --invariant safety
--max-steps 5`): all steps ok, `1 models, 0 failures`. Apalache alone took about 270 s for 5 steps
(`[ok] No violation found`), so verify-steps stays 5. On this shared machine two earlier tries of the same
command stopped with `error: Connection dropped` from the Apalache server before a result; this was not a
counterexample, and the next try passed.

## 4. Run tests

Each fixed trace from the first wave is now a run test that shows the fixed behavior:

| Test | What it shows |
|---|---|
| `lostLockTest` | A loses its lock connection, B commits stop2; A's `save` is disabled, `saveFails` runs; stop2 stays committed |
| `backendTickSetTest` | one deployed round drains the waiting inbound row and the expired row |
| `bumpAfterClearTest` | sent at 3, cleared to 1, rise to 3: posted in the same round |
| `readErrorResolvesTest` | a failed read keeps safety_signal open; no resolved notice |
| `silentCloseTest` | a failed post, then the end: a resolved notice is posted; no heartbeat in the failed round |
| `tickLateMaskedTest` | ticks fail, a unit saves; tick_late fires and is sent |
| `twoReportsTest` | two replicas: one report |
| `stuckRequestGraceTest` | a hung HTTP request: the grace timer is due before SIGKILL; the shutdown closes, not clean |
| `halfRoleTest`, `handMadeLoginTest` | a crash before the one-transaction create, then a complete login; a hand-made login without membership is refused |
| `helpFlagTest`, `helpFalseTest`, `dryRunTest`, `dryRunTrueTest` | `--help --no-help` and `--help false` are refused; `--dry-run --help=false` and `--dry-run true` pass |
| `idCollisionTest` | slop:nyc and slop:la mint two rows |
| `dirtyBiasReadTest` | the report waits for the unit; after the failed save it reads the stored state |
| `rolesOnSourceTest` | `--roles` through either source host name is refused |
| `skippedWeekTest`, `biasLateEndsTest` | a failed week raises bias_late once it is a day late; a new report resolves it |
| `restoreRollsBackStopTest`, `cfNoBuildIdTest`, `cfStaffRouteTest` | the open defects SD-050, SD-159, SD-169 (and `safety` holds on each trace) |

## 5. Register ids of this module

| Id | Status | Model | Why / test |
|---|---|---|---|
| SD-003 | fixed (b862c95) | `tickRound`; `dueHasCaller` holds | deploy/backend/backend-ticks.integration.test.ts |
| SD-110 | fixed (7240e5b) | `save`; `noLostWrite` holds | packages/network/test/store-unit-of-work.integration.test.ts |
| SD-111 | fixed (d351405) | `mint`; `oppIdsOwned` holds | packages/network/test/network-ids.integration.test.ts |
| SD-113 | fixed (7717e2b) | `opsRound`; `alertResolvedOnlyOnRead` holds | deploy/backend/ops-alerts.integration.test.ts |
| SD-158 | fixed (9f40c5e, test type fix 38b6901) | `sigterm`, `graceFires`; `closeBeforeKill` holds | deploy/backend/backend-shutdown.integration.test.ts |
| SD-161 | fixed (3b29163) | `nextA`; `bumpPosted` holds | deploy/backend/ops-alert-bump.integration.test.ts |
| SD-162 | fixed (433183a) | not modeled (a status table, not a state change) | deploy/backend/ops-send-outcomes.integration.test.ts |
| SD-163 | fixed (2a3408b) | `bootCreate`, `loginCheck`; `bootLoginComplete` holds | deploy/backend/service-login.integration.test.ts |
| SD-164 | fixed (1282420) | not modeled (config parsing) | deploy/backend/boot-secrets.integration.test.ts |
| SD-165 | fixed (cadd3c3) | `restoreRoles`; `restoreRolesNotOnSource` holds | deploy/backup/restore-source.integration.test.ts |
| SD-166 | fixed (749ede3) | not modeled (secret rotation across deploys) | deploy/backend/proxy-rotation.integration.test.ts |
| SD-167 | fixed (107be19) | not modeled (CI path filter) | deploy/deploy-sites-paths.integration.test.ts |
| SD-168 | fixed (0706658) | `decide`, `yargsStep`; `guardSound` holds | deploy/wrangler-help.integration.test.ts |
| SD-233 | fixed (e8a3171) | key `late`; `skippedWeekSeen` holds | deploy/backend/ops-bias-late.integration.test.ts |
| SD-235 | fixed (0f6ca0f) | `opsRound`; `noSilentClose` holds | deploy/backend/ops-alert-delivery.integration.test.ts |
| SD-360 | fixed (6a25b4c) | `opsRound`; `heartbeatHonest` holds | deploy/backend/ops-alert-delivery.integration.test.ts |
| SD-236 | fixed (d329af0) | not modeled (matching category; matching_engine) | packages/network/test/slop-second-date.integration.test.ts |
| SD-237 | fixed (7f58576) | not modeled (report content; the model has no group data) | deploy/backend/ops-bias-blind.integration.test.ts |
| SD-361 | fixed (5ec4275) | not modeled (one-process script flags) | deploy/backup/backup-cli.integration.test.ts |
| SD-362 | fixed (f3d2e5f) | not modeled (documentation command) | deploy/backup/backup-cli.integration.test.ts |
| SD-363 | fixed (818df9d) | not modeled (script cleanup) | deploy/backup/restore-failure.integration.test.ts |
| SD-367 | fixed (d35a04c) | not modeled (documentation text) | no test: a doc-text check is not accepted by the test policy |
| SD-368 | fixed (dc7e3d0) | `lastSeen`; `tickLateSeen` holds | deploy/backend/ops-tick-late.integration.test.ts |
| SD-370 | fixed (240c932) | not modeled (config parsing) | deploy/backend/backend-timing-config.integration.test.ts |
| SD-446 | fixed (ba5ec1b) | `biasInsert`; `oneReportPerWeek` holds | packages/network/test/bias-report-cadence.integration.test.ts |
| SD-447 | fixed (8a0bb3a) | not modeled (report content) | packages/network/test/bias-report-scope.integration.test.ts |
| SD-448 | fixed (b75d5b2) | `biasInsert`; `biasReadsCommitted` holds | packages/network/test/bias-report-read.integration.test.ts |
| SD-450, SD-451, SD-454 | fixed (5826f19, 66be84a, 678f942) | not modeled (report content) | packages/network/test/bias-report-outcomes.integration.test.ts |
| SD-369 | not reproduced | `migrate` is atomic; `migrationOnce` holds | `migrate.ts` sets lock_timeout: a migration behind the pg_dump locks fails cleanly and Railway restarts the backend. No wrong state. |
| SD-050 | skipped (founder decision) | `restoreKeepsStops` fails, out of `safety` | the restore procedure must replay consent from a record outside the restored database (blooio channel); which record, and whether sends stay dry-run after a restore, is a founder or ops decision |
| SD-159 | skipped (no Workers runtime) | `inactiveStops` fails, out of `safety` | the fix needs a test in workerd with Durable Objects and Containers; no such runtime is in the repository, and a Bun stub is mock-only proof |
| SD-169 | skipped (founder decision) | `staffRouted` fails, out of `safety` | the console path to the staff API after the Cloudflare cutover changes the staff API's security boundary; review items expire unsent meanwhile |
| SD-096 | skipped (design decision) | not modeled (latency) | three separate waits in a turn; consent is not affected |
| SD-239 | skipped (founder decision) | not modeled | the monitor needs a consented demographic attribute |
| SD-324 | skipped (needs upstream contract change) | not modeled | DeliverResponse has no transport field |
| SD-364 | skipped (founder or operator decision) | not modeled | the BACKEND_LIVE gate of the push smoke check |
| SD-366 | skipped (cannot reproduce here) | not modeled | needs the GitHub API |
| SD-371 | skipped (founder or operator decision) | not modeled | GitHub Actions concurrency of deploy-sites.yml |
| SD-453 | skipped (founder decision) | not modeled | erasure against the bias metric |

## 6. Invariants that hold

All invariants in `safety`: `noLostWrite`, `restoreRolesNotOnSource`, `oppIdsOwned`, `dueHasCaller`,
`tickLateSeen`, `alertResolvedOnlyOnRead`, `bumpPosted`, `noSilentClose`, `heartbeatHonest`,
`oneReportPerWeek`, `skippedWeekSeen`, `biasReadsCommitted`, `closeBeforeKill`, `bootLoginComplete`,
`migrationOnce`, `llmAttemptBound`, `guardSound`.

## 7. New defects

None.

## Appendix: the first-wave counterexamples (before the fixes)

The traces below are kept as the record of what the model found against `ad67275`. The run tests of the
same names now show the fixed behavior (section 4), except SD-050, SD-159 and SD-169, which are still open.

Each trace below is a `run` test in the model, so `quint test` replays it.

### (before the fix) SD-110 lost lock connection, last writer wins (`lostLockTest`)

```
A takeLock(stop1), A load {}        store.ts:322-324 lock on reserved conn; :54 load on a pool conn
A loseConnection                    the server frees the session lock; fn goes on (store.ts:329 never ran)
B takeLock(stop2), load {}, apply, save -> committed {stop2}, acked stop2
A apply, save {stop1}               store.ts:288-289 upsert with no version compare
=> committed {stop1}; stop2 was acknowledged and is lost
```

### SD-050 restore undoes an acknowledged STOP (`restoreRollsBackStopTest`)

```
backupRun (committed {})            backup.ts dump at 07:15
A unit records stop1, save          STOP acknowledged
restore                             runbook-real.md 8.3 steps 1-5: no step replays consent after the backup time
=> committed {}; channel blooio: nothing outside the database holds the opt-out
```

On `eliza_cloud` the model assumes that the gateway's send-time fence keeps the opt-out (AGENTS.md
consent path; upstream, not in this repository). The invariant fails only for the direct `blooio`
channel. This agrees with the disputed vote in the register.

### (before the fix) SD-003 the deployed tick set has no caller for inboxTick and purge (`backendTickSetTest`)

```
inboundLeftWaiting; 4 x (advance, tickRound(ok))   tickSet = backend
=> inboxAge 4 > STALE
```

`backend.ts:388-397` calls `rt.tick()` and `notifyTick()`; `backend.ts:406` adds `opsTick()`.
`ServiceLike` (`backend.ts:263-270`) has no `purge` or `inboxTick`. `rt.tick()` (`runtime.ts:658-668`)
and `afterTick` (`service.ts:533-536`) do not call them. `serve.ts:124-135` does
(`serveTickSetTest` passes). Rows that wait forever: `platform.inbound` left by a crash
(`service.ts:561-565`), expired OTP challenges, sessions, rate windows and inbox ids (`service.ts:567-577`).

### (before the fix) SD-368 tick_late masked by saves (`tickLateMaskedTest`)

```
2 x tickRound(false)                rt.tick() throws; no tick stored
an inbound unit saves               network_state.saved_at = now
tickRound(false)
=> now - lastTickRan > TICK_LATE, but ops.ts:201 takes max(stored, savedAt): no tick_late alert
```

### (before the fix) SD-113 a read error resolves a safety alert (`readErrorResolvesTest`)

```
signalArrives; opsRound(readOk, postOk)     safety_signal fires and is sent
opsRound(readError, postOk)                 ops.ts:218-220 returns `error`; ops.ts:274 skips the network
=> ops.ts:416-421 posts "resolved" for safety_signal while 1 signal still waits
```

### (before the fix) SD-161 bump compares with the last sent count (`bumpAfterClearTest`)

```
3 signals; opsRound -> sent, lastSentCount 3
staffDecides(1); opsRound -> count 1, no post
2 signals; opsRound -> count 3 > 1, but ops.ts:410 compares 3 > lastSentCount 3: not due
=> no post until ALERT_REPEAT_MS; deploy.md 7.2 says "when a safety alert's count goes up"
```

### (before the fix) SD-235 and SD-360 an alert vanishes unsent; the heartbeat stays green (`silentCloseTest`)

```
signalArrives; opsRound(postFails)          ops.ts:429 ok=false; lastSentAt stays unset
                                            ops.ts:541 heartbeat GET runs anyway (SD-360)
staffDecides(0); opsRound(postOk)           ops.ts:419 "never posted": closed quietly
=> the on-call channel never heard of the alert
```

The same path closes a `bias_report` alert after its 24 h window (`ops.ts:246`) when the webhook
failed for that day, which is the trigger in SD-235.

### (before the fix) SD-446 two bias reports in one week (`twoReportsTest`)

```
A biasCheck (max(at) old), B biasCheck (same max(at))   service.ts:541 runs after the tick lock (runtime.ts:666)
A biasInsert at t; B biasInsert at t+1                  service.ts:548 primary key id includes `now`
=> two reports less than WEEK apart
```

### (before the fix) SD-233 a skipped week is not seen (`skippedWeekTest`)

```
biasCheck(A, memberReadFails)               service.ts:543 throws; runtime.ts:666 logs "[tick] after-tick work failed"
3 x advance                                 no report, no ops alert reads bias_reports age
=> now - last report > WEEK + DAY with no alert
```

### (before the fix) SD-448 the bias report reads uncommitted state (`dirtyBiasReadTest`)

```
A takeLock, load, apply(stop1)              an inbound unit changed rt.net in memory
A biasCheck, biasInsert                     service.ts:546 reads rt.net.opps outside the lock
A saveFails                                 the stage is never committed
=> the stored report used state that the database never held
```

In the code the Queue serializes units in one process, but `afterTick` runs outside it after
`runTick` returns (`runtime.ts:660-666`), so this interleaving is in one replica.

### (before the fix) SD-158 the grace timer starts after the HTTP drain (now `stuckRequestGraceTest`)

```
stuckWork(http); sigterm                    backend.ts:428 awaits s.stop(false): Bun 1.4.2 waits for the request
3 x advance; sigkill                        backend.ts:431 grace timer never created
=> killed; svc.close (backend.ts:434) never ran; exit is not logged
```

A hung tick (not an HTTP request) is ended by the grace timer before SIGKILL (`stuckTickGraceTest`).

### (before the fix) SD-163 a half-made service login passes the boot check (`halfRoleTest`)

```
migrate; ensureLoginStart; bootCreate       backend.ts:457 create role (own statement)
bootCrash                                   before backend.ts:458 grant network_service
migrate; ensureLoginStart                   backend.ts:453-454 role exists: created=false
loginCheck                                  backend.ts:179-188 checks super, BYPASSRLS, owner only
=> check passes with no membership; fromDatabase fails; every restart repeats it
```

### (before the fix) SD-111 opportunity ids collide between two networks of one app (`idCollisionTest`)

```
twoCities (platform.networks has slop:nyc and slop:la)
mint(slop:nyc) -> slop.nw-1-1; mint(slop:la) -> slop.nw-1-1    network.ts:891, 2100; seed NETWORK_SEED (server.ts:81)
=> the second save takes the row (store.ts:290-292 on conflict (id) do update) and rewrites its participations (:278)
```

### (before the fix) SD-165 --roles on the source server through a second host name (`rolesOnSourceTest`)

```
restoreRoles(source-proxy-host)             restore.ts:44 sameServer compares host:port strings (lib.ts:201-204)
=> onSource false; roles.sql runs on the source server
```

### (before the fix) SD-168 help flag passes the deploy guard (`helpFlagTest`)

```
args: deploy --help --no-help
decide(switch) and decide(value): wrangler.sh:69 sets help=1; nothing resets it; :96 ok=1
wrangler (assumed yargs): help=false, dry-run=false => a real deploy without NTWRK_ALLOW_DEPLOY
```

### SD-159 inactive Worker cannot stop the container without BUILD_ID (`cfNoBuildIdTest`)

```
cfActivate; cfDeactivate(no BUILD_ID); cfCron
worker.ts:58 getContainer().stop() -> the constructor throws at worker.ts:36 => no SIGTERM
=> inactive, cron ran, container still running
```

### SD-169 no staff route after the Cloudflare cutover

```
cfActivate                                  worker.ts:70 forwards every request to the public port 8790
=> staffRouteExists(cf) is false: the console cannot reach /review, /safety/*, /matching
```

