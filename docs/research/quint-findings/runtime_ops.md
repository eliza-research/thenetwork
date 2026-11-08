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

Bounds: two replicas, two STOP events, one lost connection, four alert keys, time 0..14 with
DAY=2, WEEK=4, TICK_LATE=2, REPEAT=4, GRACE=2 < KILL=3, EPS=2, MAX_RETRIES=2, MAX_REGROWS=2.

Facts checked outside Quint:

- Bun 1.4.2: `server.stop(false)` does not resolve while a request is in flight. A local run with a
  handler that never answers printed `still waiting after 3 s` (script in the session scratchpad, not
  in the repo). The model's `serversStopped` is therefore disabled while an HTTP request is stuck.
- `wrangler` (yargs) reads `--no-help` and `--help=false` as `help=false`, and the last value wins.
  This is an assumption of the model (`yargsStep`); wrangler was not run.
- A Cloudflare deploy creates new Durable Object instances, so the `NetworkBackend` constructor
  runs again with the new `env` before `stop()`. This is an assumption of the model (`cfCron`).

## 2. Check output

`bun run quint:check quint/runtime_ops.qnt` (seed 0x5eed, max-steps 24, max-samples 6000):

```
ok   typecheck
ok   test                      (21 run tests passing)
FAIL safety                    (expected: the model shows the defects below)
ok   witness_stopCommitted, witness_cleanRestore, witness_tickRan, witness_alertPosted,
     witness_alertResolved, witness_biasReport, witness_cleanShutdown, witness_graceShutdown,
     witness_bootUp, witness_llmRegrowOk, witness_wranglerDryRun, witness_cfStopped  (all reachable)
```

Each invariant alone (`quint run ... --backend rust --seed 0x5eed --invariant <name>`):

| Invariant | 24 steps x 6000 | 40 steps x 100000 | Register id |
|---|---|---|---|
| `noLostWrite` | ok | **violation** | SD-110 |
| `restoreKeepsStops` | **violation** | | SD-050 |
| `restoreRolesNotOnSource` | **violation** | | SD-165 |
| `oppIdsOwned` | **violation** | | SD-111 |
| `dueHasCaller` | **violation** | | SD-003 |
| `tickLateSeen` | **violation** | | SD-368 |
| `alertResolvedOnlyOnRead` | **violation** | | SD-113 |
| `bumpPosted` | ok | **violation** | SD-161 |
| `noSilentClose` | **violation** | | SD-235 |
| `heartbeatHonest` | **violation** | | SD-360 |
| `oneReportPerWeek` | **violation** | | SD-446 |
| `skippedWeekSeen` | **violation** | | SD-233 |
| `biasReadsCommitted` | **violation** | | SD-448 |
| `closeBeforeKill` | **violation** | | SD-158 |
| `bootLoginComplete` | **violation** | | SD-163 |
| `migrationOnce` | ok | ok | holds |
| `llmAttemptBound` | ok | ok | holds |
| `guardSound` | **violation** | | SD-168 |
| `inactiveStops` | **violation** | | SD-159 |
| `staffRouted` | **violation** | | SD-169 |

`--verify` (Apalache, `quint verify --invariant safety --max-steps 5`): a counterexample in 8 s, as expected.
Apalache on the two invariants that hold: no violation at `--max-steps 6` (section 5).

## 3. Counterexamples and the code

Each trace below is a `run` test in the model, so `quint test` replays it.

### SD-110 lost lock connection, last writer wins (`lostLockTest`)

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

### SD-003 the deployed tick set has no caller for inboxTick and purge (`backendTickSetTest`)

```
inboundLeftWaiting; 4 x (advance, tickRound(ok))   tickSet = backend
=> inboxAge 4 > STALE
```

`backend.ts:388-397` calls `rt.tick()` and `notifyTick()`; `backend.ts:406` adds `opsTick()`.
`ServiceLike` (`backend.ts:263-270`) has no `purge` or `inboxTick`. `rt.tick()` (`runtime.ts:658-668`)
and `afterTick` (`service.ts:533-536`) do not call them. `serve.ts:124-135` does
(`serveTickSetTest` passes). Rows that wait forever: `platform.inbound` left by a crash
(`service.ts:561-565`), expired OTP challenges, sessions, rate windows and inbox ids (`service.ts:567-577`).

### SD-368 tick_late masked by saves (`tickLateMaskedTest`)

```
2 x tickRound(false)                rt.tick() throws; no tick stored
an inbound unit saves               network_state.saved_at = now
tickRound(false)
=> now - lastTickRan > TICK_LATE, but ops.ts:201 takes max(stored, savedAt): no tick_late alert
```

### SD-113 a read error resolves a safety alert (`readErrorResolvesTest`)

```
signalArrives; opsRound(readOk, postOk)     safety_signal fires and is sent
opsRound(readError, postOk)                 ops.ts:218-220 returns `error`; ops.ts:274 skips the network
=> ops.ts:416-421 posts "resolved" for safety_signal while 1 signal still waits
```

### SD-161 bump compares with the last sent count (`bumpAfterClearTest`)

```
3 signals; opsRound -> sent, lastSentCount 3
staffDecides(1); opsRound -> count 1, no post
2 signals; opsRound -> count 3 > 1, but ops.ts:410 compares 3 > lastSentCount 3: not due
=> no post until ALERT_REPEAT_MS; deploy.md 7.2 says "when a safety alert's count goes up"
```

### SD-235 and SD-360 an alert vanishes unsent; the heartbeat stays green (`silentCloseTest`)

```
signalArrives; opsRound(postFails)          ops.ts:429 ok=false; lastSentAt stays unset
                                            ops.ts:541 heartbeat GET runs anyway (SD-360)
staffDecides(0); opsRound(postOk)           ops.ts:419 "never posted": closed quietly
=> the on-call channel never heard of the alert
```

The same path closes a `bias_report` alert after its 24 h window (`ops.ts:246`) when the webhook
failed for that day, which is the trigger in SD-235.

### SD-446 two bias reports in one week (`twoReportsTest`)

```
A biasCheck (max(at) old), B biasCheck (same max(at))   service.ts:541 runs after the tick lock (runtime.ts:666)
A biasInsert at t; B biasInsert at t+1                  service.ts:548 primary key id includes `now`
=> two reports less than WEEK apart
```

### SD-233 a skipped week is not seen (`skippedWeekTest`)

```
biasCheck(A, memberReadFails)               service.ts:543 throws; runtime.ts:666 logs "[tick] after-tick work failed"
3 x advance                                 no report, no ops alert reads bias_reports age
=> now - last report > WEEK + DAY with no alert
```

### SD-448 the bias report reads uncommitted state (`dirtyBiasReadTest`)

```
A takeLock, load, apply(stop1)              an inbound unit changed rt.net in memory
A biasCheck, biasInsert                     service.ts:546 reads rt.net.opps outside the lock
A saveFails                                 the stage is never committed
=> the stored report used state that the database never held
```

In the code the Queue serializes units in one process, but `afterTick` runs outside it after
`runTick` returns (`runtime.ts:660-666`), so this interleaving is in one replica.

### SD-158 the grace timer starts after the HTTP drain (`stuckRequestKilledTest`)

```
stuckWork(http); sigterm                    backend.ts:428 awaits s.stop(false): Bun 1.4.2 waits for the request
3 x advance; sigkill                        backend.ts:431 grace timer never created
=> killed; svc.close (backend.ts:434) never ran; exit is not logged
```

A hung tick (not an HTTP request) is ended by the grace timer before SIGKILL (`stuckTickGraceTest`).

### SD-163 a half-made service login passes the boot check (`halfRoleTest`)

```
migrate; ensureLoginStart; bootCreate       backend.ts:457 create role (own statement)
bootCrash                                   before backend.ts:458 grant network_service
migrate; ensureLoginStart                   backend.ts:453-454 role exists: created=false
loginCheck                                  backend.ts:179-188 checks super, BYPASSRLS, owner only
=> check passes with no membership; fromDatabase fails; every restart repeats it
```

### SD-111 opportunity ids collide between two networks of one app (`idCollisionTest`)

```
twoCities (platform.networks has slop:nyc and slop:la)
mint(slop:nyc) -> slop.nw-1-1; mint(slop:la) -> slop.nw-1-1    network.ts:891, 2100; seed NETWORK_SEED (server.ts:81)
=> the second save takes the row (store.ts:290-292 on conflict (id) do update) and rewrites its participations (:278)
```

### SD-165 --roles on the source server through a second host name (`rolesOnSourceTest`)

```
restoreRoles(source-proxy-host)             restore.ts:44 sameServer compares host:port strings (lib.ts:201-204)
=> onSource false; roles.sql runs on the source server
```

### SD-168 help flag passes the deploy guard (`helpFlagTest`)

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

## 4. Register ids of this module

Reproduced by the model (the invariant fails, a run test replays it): SD-003, SD-050 (blooio channel
only), SD-110, SD-111, SD-113, SD-158, SD-159, SD-161, SD-163, SD-165, SD-168, SD-169, SD-233, SD-235,
SD-360, SD-368, SD-446, SD-448.

Not reached, with the reason:

| Id | Why the model cannot reach it |
|---|---|
| SD-096 | Latency. The model has no durations inside a turn; consent is safe (the register says so). |
| SD-162 | How `sendOutcomes` (`ops.ts:181-191`) classes `unknown_acceptance` is a table, not a state change. A test on `sendOutcomes` with that status shows it. |
| SD-164, SD-370 | Config parsing (`env.ts:57`, `backend.ts:154-167`). No state machine; a `loadConfig` case shows it. |
| SD-166 | Secret rotation spans five deploys outside the process. One secret, fail closed. |
| SD-167, SD-364, SD-366, SD-371 | CI workflow files and GitHub behaviour, outside the code the model follows. |
| SD-236 | Category gating in the matching engine (`network.ts:2050-2053`); belongs to `matching_engine.qnt`. |
| SD-237, SD-239, SD-447, SD-450, SD-451, SD-453, SD-454 | What the bias report counts (`bias.ts`, `service.ts:545`): data semantics of one report, not the cadence or the alert. A sim gate or an integration case on `biasReport` input fits them. |
| SD-324 | Dead status `fell_back`: no writer exists, so there is no transition to model. |
| SD-361, SD-363 | Flag handling and cleanup in `backup.ts` and `restore.ts` scripts; one process, no interleaving. |
| SD-362, SD-367 | Documentation text. |
| SD-369 | `pg_dump` lock against a boot migration: `migrate.ts:82` sets `lock_timeout`, and the boot fails cleanly. The model's `migrate` is atomic and `migrationOnce` holds. |

## 5. Invariants that hold

- `migrationOnce` (`migrate.ts:3-4`): the runner is one transaction under `pg_advisory_xact_lock`. No
  violation in 100000 samples of 40 steps.
- `llmAttemptBound` (`llm.ts:189-193`): one call makes at most EPS + LLM_MAX_RETRIES + MAX_REGROWS
  attempts. No violation in 100000 samples of 40 steps. This agrees with the refuted SD-119.

Apalache, one invariant at a time: `migrationOnce` and `llmAttemptBound` have no violation at
`--max-steps 6` (59 s and 88 s). At `--max-steps 8` Apalache stopped with an error before a result
(resources), so 6 is the verified bound.

## 6. New defects

None. Every violation maps to an existing register id.
