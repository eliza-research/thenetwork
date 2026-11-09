# Deploy and ops state machines

Scope: `deploy/`, `.github/workflows`, `.github/runtime-*`, `scripts/wrangler.sh`, `docs/deploy.md`,
`docs/go-live-handoff.md`, `sites/` build and proxy, `plugins/`.
Goal: list every state machine here, so that each can be modelled in Quint.
Nothing in this report was fixed. No external service was called.

Two local checks were run:

- A Bun script in the scratchpad tested `server.stop(false)` with a hung request (local Bun 1.3.14).
  The repository pins Bun 1.4.2, so repeat this check on 1.4.2.
- `scripts/wrangler.sh` ran with a stub `bunx` on PATH. Real wrangler was not run.

Line references are `file:line` at commit a0ed7bc.

## 1. Summary of machines

| # | id | Kind | Priority | Model |
|---|---|---|---|---|
| M1 | `live-send-gate` | implicit | P0 | Alone, then merge with `outbound-queue` of the network report |
| M2 | `edge-trust` | implicit | P0 | Alone |
| M3 | `eliza-takeover` | implicit (cross-service) | P0 | Merge with STOP and consent machines |
| M4 | `pg-restore-recovery` | implicit | P0 | Merge with consent and outbound |
| M5 | `backend-boot` | implicit, ordered steps | P1 | Merge with M6, M7 |
| M6 | `db-env-and-service-login` | explicit value and implicit role | P1 | Inside M5 |
| M7 | `migration-runner` | implicit ledger | P1 | Inside M5 |
| M8 | `backend-process-lifecycle` | implicit | P1 | Alone, with M9 |
| M9 | `backend-tick-loop` | implicit | P1 | Alone, with M8 |
| M10 | `railway-rollout` | implicit | P1 | Merge with M8, M11 |
| M11 | `cf-backend-cutover` | explicit flag and implicit steps | P1 | Merge with M12, M10 |
| M12 | `cf-container-lifecycle` | implicit | P1 | Inside M11 |
| M13 | `alert-dispatcher` | explicit (open, level) | P1 | Alone |
| M14 | `ops-round-heartbeat` | implicit | P2 | Merge with M13 |
| M15 | `backup-run` | implicit | P1 | Alone |
| M16 | `sites-deploy-workflow` | explicit (operation) and implicit | P1 | Alone, with M17 |
| M17 | `proxy-secret-rotation` | implicit (cross-service) | P1 | Merge with M2, M16 |
| M18 | `wrangler-deploy-guard` | implicit | P1 | Small; a table check is enough |
| M19 | `image-qualification` | explicit receipts | P2 | Optional |
| M20 | `web-join-client` | explicit steps | P2 | Optional |
| M21 | `agent-skill-signup` | implicit, prompt driven | P1 | Merge with platform join and consent |
| M22 | `plugin-snapshot` | implicit | P2 | Do not model |

The most important results:

- **D1.** The deployed tick loop never calls `svc.inboxTick()` or `svc.purge()`. Failed inbound rows
  are not retried by a tick, and retention never runs in production.
- **D2.** Graceful shutdown waits for HTTP requests before the grace timer starts.
- **D3.** A deactivated Cloudflare backend cannot stop its container when `BUILD_ID` is absent.
- **D5.** A monitoring read error marks open safety alerts as resolved.
- **D13.** The real restore procedure loses STOP events after the backup and has no dry-run step.

## 2. Machines

### M1 `live-send-gate`

Kind: implicit. State lives in process environment, read at two levels.

Evidence:

- Process level: `deploy/backend/backend.ts:141-149` computes `channel`.
- Per app and per send: `packages/network/service/channel.ts:94-96` (`liveSendAllowed`), `:283` (`live`),
  `:336-340` (enqueue), `:358` (direct), `packages/blooio/src/outbound-queue.ts:373` (drain).
- `deploy/backend/server.ts:84-88` builds the adapter. `:97` logs each network's mode.

State per process:

- `Dry`: `channel = dry-run`. `adapter` is undefined, so the service uses `DryRunAdapter`. Rows are `dry_run`.
- `Adapter(blooio | eliza_cloud)`: adapter exists for every runtime.

State per app inside `Adapter`:

- `Live`: all flags are `"1"`.
- `Refusing`: the adapter exists, and the app flag is not `"1"`. Rows end as `refused_not_approved`.

Other inputs: `--dry-run` argv, `NETWORK_ROUTE_AUTHORITY_POLICY` (isolated route).

| From | Event | Guard | Effect | To | Who |
|---|---|---|---|---|---|
| any | boot | not (asked and `BLOOIO_ALLOW_SEND=1` and `NTWRK_LIVE_APPROVED=1` and no isolated route) | warning if asked | Dry | operator |
| any | boot | asked, global flags on, secrets present | adapter per runtime | Adapter | operator |
| any | boot | channel chosen, secret missing | throw `Cloud sends need ...` (`backend.ts:148-149`) | not started | operator |
| Adapter | enqueue or drain | `liveSendAllowed(env, app)` false | `refused_not_approved` | Refusing (terminal row) | code |
| Live | env change | Railway variable change | new deployment; old one keeps its env until drained | Dry or Adapter | operator |

Flags live in `process.env`. A flag change needs a new process, although the docs say the adapter
"reads the flags on every delivery". The old process keeps sending during overlap and drain:
`overlapSeconds = 10`, `drainingSeconds = 30` (`deploy/backend/railway.toml:19,21`).

Invariants:

- INV: `send(app) => env.BLOOIO_ALLOW_SEND=1 and env.NTWRK_LIVE_APPROVED=1 and env[<APP>_LIVE_APPROVED]=1 and channel != dry-run`.
  AGENTS.md "Environment"; server.ts header.
- INV: an isolated staging route never sends (`backend.ts:145`, test `backend.test.ts:23`).
- Safety: in Dry, nothing reaches a provider.

Interactions:

- `platform.outbound` rows stay in the table when a process moves from Adapter to Dry. No drain runs.
  If Adapter returns later, rows drain unless `tooOld` (24 h proactive, 3 days other; `outbound-queue.ts:172,371`).
- **Coverage limit.** Replies inside a signed turn do not pass this gate. `service.ts:1367-1372`
  (`direct`) calls `inbox.collect`, and `runtime.ts:484` stores status `collected`. The gateway sends
  them. Handoff section 7 step 2 relies on this. But `docs/deploy.md:391` says the table holds "only
  `dry_run` (and `refused_*`) rows". That check fails after takeover (D23).

Failure analysis: flags are read at start and per send, from the same immutable env. There is no flag
transition inside one process. The race to model is two processes with different env during overlap.

Quint notes: `flags: str -> bool`, `procs: Set[{env, draining}]`, `rows`. Actions: `boot`,
`envChange`, `enqueue`, `drain`, `collectReply`. Check the INV for each proc. Two message classes:
`queued` and `collected`.

### M2 `edge-trust`

Kind: implicit. State lives on the wire, in headers `x-network-proxy-{ip,host,ts,sig}`.

Evidence: `deploy/router.ts:88-127`, `deploy/pages-worker.ts:21-27`, `packages/platform/src/proxy.ts:73-82`,
`deploy/backend/backend.ts:236-255`, `:350-363`, inner check `packages/platform/src/api.ts:306-307`.

Request states: `ClientRaw -> Stripped -> Signed -> BodyRead -> Forwarded -> (Verified | Unverified) -> (Served | Refused421 | Refused404)`.

| From | Event | Guard | Effect | To |
|---|---|---|---|---|
| ClientRaw | router | path is retired | 302, 404 or 405 no-store (`router.ts:44-52`) | Done |
| ClientRaw | router | not a backend path | `env.ASSETS.fetch` | Done |
| ClientRaw | router | missing secret, origin, app or host | 503 `proxy_not_configured` (`:94`) | Done |
| ClientRaw | router | else | drop client proxy, forward and `cf-*` headers (`:96-100`) | Stripped |
| Stripped | sign | `now()` | set four headers (`:104`) | Signed |
| Signed | read body | over 9 MB | 413 (`:109-110`) | Done |
| BodyRead | fetch | throws | 502 `api_unreachable` | Done |
| Forwarded | backend verify | signature good, skew <= 60 s, host in hostMap | Host set to signed host | Verified |
| Forwarded | backend verify | else | every proxy header removed | Unverified |
| Unverified | `/api`, `/mcp` | deployed | 421 `edge_required` | Done |
| Verified | ip not IP shaped | `"unknown"` | ip header removed (`backend.ts:247`) | Verified, socket IP |

Invariants:

- Only a holder of `PLATFORM_PROXY_SECRET` can name a site. Deployed, no unsigned request reaches
  the public API or the MCP server.
- Staff paths never answer on the public port (`backend.ts:364-366`, test `:290`).
- The signature covers method, path, query, host, IP, ts. It does not cover the body. A captured
  request can be replayed for 60 s. There is no nonce.

Interactions:

- `/internal/*` and `/webhooks/*` do not use this edge; they have their own signatures.
- After `headers.delete(ip)` at `backend.ts:247`, the inner check in `api.ts:306` fails, and the
  inner host falls back to the rewritten Host header, which is correct. Rate limit IP is the socket.

Failure analysis: clock skew over 60 s between Worker and backend makes all site traffic 421.
The timestamp is taken before the body read (D19).

Quint notes: `sig(m, p, h, ip, ts)` as an opaque record. Attacker action: send any headers. Check that
`served(app)` implies a matching `routerSent`. Bound the clock to a few values around the 60 s window.

### M3 `eliza-takeover`

Kind: implicit and cross-service. State: gateway env `NETWORK_TAKEOVER`, `NETWORK_TAKEOVER_ALLOWLIST`;
Cloud API `NETWORK_RELAY_ENABLED`; Blooio webhook target; backend live flags. Code is upstream.
Evidence here: `docs/go-live-handoff.md:162-184`, `AGENTS.md` founder decisions 2.

States: `Legacy -> StagingTest -> Shadow(allowlist) -> TakeoverAll -> LiveSends(app)`, and `Rollback -> Legacy`.

| From | Event | Guard | To | Who |
|---|---|---|---|---|
| Legacy | set flags on staging, run script | prerequisites 1 to 8 | StagingTest | operator |
| StagingTest | founder approves, set allowlist | checklist | Shadow | founder |
| Shadow | founder approves, remove allowlist | one STOP owner | TakeoverAll | founder |
| TakeoverAll | founder approves live | mvp-plan 13 | LiveSends(slop) | founder |
| any | `NETWORK_TAKEOVER=0` | none | Legacy (the gateway handles STOP) | operator |

Invariants:

- Exactly one system answers STOP for one sender (AGENTS.md).
- STOP in either mode stops sends in both modes (PRD 40.3).
- Blooio webhook targets only the gateway.

Open risk, not verified in this repo: consent flows one way. A handled turn copies consent to the
gateway fence (`AGENTS.md` consent path). During `Legacy` after a rollback, the gateway handles STOP
itself, and nothing here tells the service. After a new takeover, the service view is stale. The
gateway fence should still block with `opted_out` (`cloud-channel.ts:63`). Model both copies.

Quint notes: two consent stores `svcConsent`, `fence`. Actions `stop(mode)`, `toggle`, `send`.
Invariant: no send after a STOP that has not been reversed by START. Include a rollback and a re-takeover in the trace.

### M4 `pg-restore-recovery`

Kind: implicit. State: target database existence, `manifest`, operator steps.

Evidence: `deploy/backup/restore.ts`, `deploy/backup/lib.ts:200-204`, `docs/deploy.md:506-523`, `docs/runbook-real.md:493-526`.

States: `Requested -> (Downloaded) -> Decrypted -> Guarded -> DbCreated -> RolesApplied? -> Restored -> Compared -> (Pass | Mismatch | Failed)`.
Recovery adds: `BackendStopped -> Restored -> Repointed -> BackendStarted`.

| From | Event | Guard | Effect | To |
|---|---|---|---|---|
| Requested | `--r2 latest` | newest prefix with manifest | list pages, max 100 (`restore.ts:75-88`) | Downloaded |
| Downloaded | manifest encrypted | key present and key id matches | `decryptFile`; `.enc` removed | Decrypted |
| Decrypted | guards | safe name, not live name, not own db on source, `--roles` only off source | | Guarded |
| Guarded | database exists | | throw | Failed |
| Guarded | create | | `create database` (`:52`) | DbCreated |
| DbCreated | `--roles` | | psql with `ON_ERROR_STOP=0` | RolesApplied |
| DbCreated | pg_restore | `--exit-on-error` | throw leaves the database | Failed |
| Restored | counts | | `compareCounts` | Pass or Mismatch |

Invariants:

- A restore never writes into an existing database (test `backup.test.ts:167`, sim ops).
- A restore never changes a role on the source server. D12 shows a hole.
- A restored database has the row counts of its manifest.
- Recovery: a STOP, a ban, a deletion or a lowest age recorded before the failure stays in force after recovery. **This does not hold** (D13).

Concurrency: restore is one operator process. Two runs with one name: the second fails at `create database`.

Quint notes: model the database as a log; `restore(t)` truncates to `t`. Actions: `stop`, `delete`,
`ban`, `backup`, `restore`, `boot`, `send`. Check the consent invariant. Also add the gateway fence as a store outside the rollback.

### M5 `backend-boot`

Kind: implicit, ordered steps with crash windows. Evidence: `deploy/backend/server.ts:30-142`.

States, in order:
`ConfigChecked -> Migrated -> DbEnvInit -> LoginCheck -> RaterLoaded -> ServiceBuilt -> ServiceStarted -> McpBuilt -> Listening -> SignalsArmed -> Ticking`.

| Step | Line | Failure effect |
|---|---|---|
| loadConfig | 31 | throw, exit 1, restart policy ON_FAILURE up to 5 |
| migrate | 37-40 | one transaction; on failure nothing applied |
| db environment init | 44-54 | only with `PLATFORM_DB_ENVIRONMENT_INIT=1` |
| login check | 57-63 | refuses superuser, BYPASSRLS, owner |
| rater | 70 | never fatal |
| `fromDatabase` | 74 | throws if service login lacks grants |
| `svc.start` | 90 | schema check, environment match, each runtime `start` (recover, one unit) |
| MCP | 103 | `undefined` turns MCP off |
| listen | 123-130 | `/healthz` is 200 after this |
| signals | 139-140 | before this line SIGTERM uses the default action |
| ticks | 141 | sets `ticksFrom` |

Invariants:

- No request is served before the login check and `svc.start` pass.
- Deployed process never runs as superuser, BYPASSRLS or owner (audit, `backend.ts:179`).
- Database `environment` equals `PLATFORM_ENV` (`service.ts:513`).
- A deployed process has `LEAK_LABEL_KEY` (`backend.ts:106-107`), and it is set before any guard runs (`server.ts:33`).

`svc.start` runs before listen, and `rt.start` runs a unit that drains the queue. With live flags on,
a boot can send before `/healthz` is 200. During overlap the old process also drains. Queue claims are
conditional (`outbound-queue.ts:492-494`), so one row goes once.

Config divergence: `packages/network/service/main.ts:31` calls `assertBootConfig`. `server.ts` does
not (D10). `NETWORK_REVIEW_MODE` and `PLATFORM_DEV_*` have no consumer outside `env.ts`, so the
review gate does not depend on that check.

Quint notes: one `pc` variable with crash at each step; restart resets `pc`, keeps DB. Merge M6 and M7. Check that a restart always reaches `Ticking` or a named refusal.

### M6 `db-env-and-service-login`

Kind: explicit value `platform.settings.environment` (`dev -> staging|production`) and implicit role rows.
Evidence: `server.ts:41-63`, `backend.ts:179-188`, `:447-461`, `docs/deploy.md:157-165`.

| From | Event | Guard | Effect | To | Who |
|---|---|---|---|---|---|
| env=dev | boot, deployed, flag=1 | `value='dev'` | update to `PLATFORM_ENV` | env=target | process |
| env=target | boot, flag=1 | no match | none, logs unchanged | env=target | process |
| NoRole | boot, flag=1 | valid name, password 24+ | `create role` | RoleOnly | process |
| RoleOnly | same run | | `grant network_service` | RoleGranted | process |
| RoleGranted | same run | | `grant connect` | RoleReady | process |
| any role | boot, flag=1 | exists | no change | same | process |

Each `query` in `ensureServiceLogin` runs alone (`server.ts:51`, `sql.unsafe`, no transaction). D9.

Invariants: environment moves only from `dev`, once. An existing role is never changed.
A restored production database keeps `production`.

Stuck states: `RoleOnly` and `RoleGranted` (D9).

### M7 `migration-runner`

Kind: implicit. Ledger `public.__migrations`. Evidence: `packages/observatory/db/migrate.ts:74-108`.

Per migration: `Pending -> Applied`; repeatable also `Applied(sum1) -> Applied(sum2)`; numbered with a
changed checksum logs a warning and stays `Applied`.

One transaction, one `pg_advisory_xact_lock`, `lock_timeout` 60 s at boot (`server.ts:38`).
`lock_timeout` applies to the advisory lock wait and to table locks.

Invariants:

- Applied set grows only (`--reset` is local only: the CLI refuses non-local URLs, `migrate.ts:117`).
- Two runners never apply one migration twice.
- Additive rule: the previous image runs on the newer schema (`docs/deploy.md:245`). This is a human rule. No code checks it.

Crash: rollback of the whole batch. Second replica waits, then skips. If the wait passes 60 s it fails, exits 1 and retries.

Interaction: `pg_dump` holds ACCESS SHARE on each table while it runs (D27).

### M8 `backend-process-lifecycle`

Kind: implicit. State: `draining`, `stopping`, `inFlight`, `timer`, `tickDone`. Evidence: `backend.ts:307-440`, `server.ts:132-140`.

States: `Serving -> Draining -> (StopWaitHttp) -> WaitInFlight -> ForceStop -> Closed -> Exited(0|1)`.

| From | Event | Guard | Effect | To | Who |
|---|---|---|---|---|---|
| Serving | SIGTERM, SIGINT | first | `draining=true`, clear timer | Draining | platform |
| Serving | second signal | | `stopping` memoized; both call `process.exit` | same | platform |
| Draining | `await s.stop(false)` | waits for in-flight HTTP | | WaitInFlight | code |
| WaitInFlight | all settled | before grace | clean | ForceStop | code |
| WaitInFlight | grace | `SHUTDOWN_GRACE_MS` | clean=false | ForceStop | clock |
| ForceStop | stop(true), `svc.close` | | | Closed | code |
| Closed | pools closed | | exit 0 or 1 | Exited | code |

While draining: `/healthz` 503 `draining`, `/ops/metrics` still served with a token (`:341`),
everything else 503 `shutting_down`, ticks do not start.

Invariants:

- No new tick after `draining`.
- A tick in flight finishes or its session ends, which releases its advisory lock.
- Shutdown ends within `SHUTDOWN_GRACE_MS` plus small work. **This does not hold** (D2).
- `SHUTDOWN_GRACE_MS < drainingSeconds`. It is a doc rule, not checked (`docs/deploy.md:138`).

Concurrency: a request past the `draining` check at line 348 can still reach `track` later. Because
`stop(false)` waits for it, the snapshot at line 430 includes later tracked work only if it was added
before that line. Work tracked after the snapshot is not waited for. Ticks cannot start, and accepted
requests end before `stop(false)` resolves, so the set is safe unless `stop(false)` returns early.

An unclean exit is `exit 1`. Under `ON_FAILURE` a host that restarts on failure restarts it. Railway removes the old deployment. Docker `--restart on-failure` does not.

Quint notes: model `http`, `ticks`, `draining`, a time counter. Check `eventually Exited` within a bound with a hung request.

### M9 `backend-tick-loop`

Kind: implicit. State: `busy` set, `timer`, `tickDone`, `ticksFrom`, stored `lastTick`. Evidence: `backend.ts:385-416`.

Each interval, `tickAll` runs two parallel branches:

1. For each runtime: skip if draining or busy; `rt.tick()`; on return set `tickDone`; then `notifyTick`.
2. `opsTick`.

Per network: `Idle -> Busy -> (Done | Skipped | Failed) -> Idle`. A hung tick stays `Busy` forever.

| Case | `tickDone` set? | `/healthz` |
|---|---|---|
| ran | yes | ok |
| skipped, lock held elsewhere | yes | ok; ops `tick_late` covers it |
| threw | no | 503 `tick_late` after `TICK_LATE_MS` |
| hung | no | 503 after `TICK_LATE_MS`; no timeout, no restart |

Invariants:

- At most one local tick per network; at most one global by `pg_try_advisory_lock` (`packages/network/src/store.ts:324-329`).
- PRD and inbox header: a pending inbound row is retried on the next tick. **Does not hold in this loop** (D1).
- Retention runs each tick (`service.ts:522-524`, `serve.ts:126,134`). **Does not hold here** (D1).

Liveness: a hung tick has no exit path. It needs a person. `/healthz` 503 does not restart the process, because Railway uses the health check only at deploy.

Quint notes: model both tick loops (`serve.ts` and `backend.ts`) as one action list. The check is that the deployed list includes `inboxTick` and `purge`. This is better as a test than a model.

### M10 `railway-rollout`

Kind: implicit. Evidence: `deploy/backend/railway.toml`, `docs/deploy.md:244-250`, `docs/go-live-handoff.md:41,77`.

States: `OldOnly -> NewBooting -> NewHealthy -> Overlap(10 s) -> OldDraining(30 s) -> NewOnly`; failure: `NewFailed -> OldOnly`.
Rollback: `NewOnly -> Redeploy(old image) -> ...`.

Invariants:

- During overlap, the advisory locks keep ticks single.
- The old image runs on the new schema.
- `x-network-build` names the running image. **Not guaranteed**: `BUILD_ID` is a runtime variable set by hand (D23).

The doc has two deploy paths: GitHub with Wait for CI (`deploy.md:63-73`) and `railway up` from a `git archive` with no GitHub link (`go-live-handoff.md:41`).

### M11 `cf-backend-cutover` and M12 `cf-container-lifecycle`

Kind: explicit flag `BACKEND_ENABLED`, implicit steps. Evidence: `deploy/cloudflare/worker.ts`, `wrangler.toml`, `README.md`, `scripts/inspect-network-backend.py`, `.github/workflows/inspect-network-backend.yml`, `deploy-sites.yml` repair modes.

Cutover steps (`README.md:13-28`):
`Verified -> DbReachable -> ConfigStored -> OldStopped -> NewActive -> Checked -> OriginSwitched -> RailwayRetired`.
Rollback: `Deactivate -> ContainerStopped(manual check) -> OldRestarted -> OriginRestored`.

Worker dispatch:

| Enabled | Config secret | Event | Effect |
|---|---|---|---|
| not `true` | absent | fetch or cron | return (503 on fetch); no DO call |
| not `true` | present | fetch or cron | `getContainer().stop()` then 503 |
| `true` | any | fetch | forward to container |
| `true` | any | cron | fetch `/healthz`; throw on not ok |

Container states: `NoInstance -> Constructed(config ok) -> Starting -> Running -> Signalled -> Stopped`. Constructor failure: `ConstructFailed`, no method runs.

The constructor (`worker.ts:16-50`) requires: JSON object; string values; `PLATFORM_ENV` match; 40 hex `BUILD_ID`; external Postgres URLs.

`@cloudflare/containers` 0.3.7: `stop()` signals only `if (this.container.running)`. `sleepAfter = "30m"`
expiry signals SIGTERM. The minute cron renews activity through `fetch`.

Invariants:

- At most one job owner. Old Railway backend and new container are never both active with uncoordinated ownership (README:34).
- The Pages origin switches only after checks.
- Worker inactive means no container running.
- Service login is not the migration owner.

Interactions:

- `NETWORK_SERVICE_INSTANCE` is set per DO construction.
- Staff port is not routed (`README.md:4`). D25.
- `workers_dev = true` adds a second public origin for the backend. It still needs the signed edge.
- Postgres locks protect ticks and queue claims across both hosts, if both connect to one database.

Concurrency and failure:

- Step 3 sets the secret while `BUILD_ID` is unset. Every cron then throws until step 4 (D3).
- Between `OldStopped` and `OriginSwitched`, the Pages origin still points at the old address unless `api.ntwrk.party` moves. The order is a planned outage.
- Nothing enforces the order. A person performs it.

Quint notes: variables `railwayUp`, `cfEnabled`, `cfConfig`, `cfBuildId`, `containerRunning`, `originAt`. Actions match README steps and rollback, and operators may run a step early. Invariant: not (`railwayUp` and `containerRunning`) unless marked as `uncoordinated`. Check that rollback reaches `containerRunning=false` with the documented command set.

### M13 `alert-dispatcher`

Kind: explicit. State: `network.ops_alerts(key, level, count, open, first_at, last_at, last_sent_at, last_sent_level, last_sent_count)`, `network.ops_alert_posts`.
Evidence: `deploy/backend/ops.ts:381-451`, `:348-374`, tests `scripts/sim/ops.ts:117-182`.

Per key: `Closed -> OpenUnsent -> OpenSent -> ResolvePending -> Closed`.

| From | Event | Guard | Effect | To |
|---|---|---|---|---|
| Closed | alert in round | | new state | OpenUnsent; notice |
| OpenUnsent | post ok | | set last sent | OpenSent |
| OpenUnsent | post failed or held | | none | OpenUnsent; retry next round |
| OpenUnsent | alert gone | never posted | `open=false` | Closed |
| OpenSent | alert in round | level up, or bump and count > last sent, or repeat due | notice | OpenSent |
| OpenSent | alert gone | | resolved notice | ResolvePending |
| ResolvePending | post ok | | `open=false` | Closed |
| ResolvePending | alert back in round | | `seen` includes it, due rules apply | OpenSent |

Round: `pg_try_advisory_xact_lock`; load; compute; `postsSince(1h)`; post inside the transaction; `recordPost`; `save`.

Invariants:

- At most `maxPostsPerHour` posts in one hour, failed posts included.
- A safety alert with new events is posted in the next unlimited round (doc 7.2). **Not always** (D6).
- `resolved` is posted only when the condition ended. **Does not hold** (D5).
- No member data in text (`ops.ts` header, sim gate).

Failure: crash after POST and before commit repeats the post (at least once). Webhook timeout 5 s holds the transaction and the lock.

Quint notes: one key, abstract count 0..5, level, hour bucket. Adversary: read error. Check D5 and D6.

### M14 `ops-round-heartbeat`

Kind: implicit. State: `lastRound`, `last`, `lastAlerts`, `startedAt`. Evidence: `ops.ts:479-545`.

`Idle -> Collect(accrue) -> Evaluate -> Dispatch -> Heartbeat -> Idle`. Runs at most every `OPS_EVERY_MS`.

`/ops/metrics` caches 15 s and does not accrue.

Cost accrual: rows have a fixed id per day (`blooio_line:<day>`, `sms_fallback:<app>:<day>`), so a repeat replaces the row. It runs outside the alert lock. Sim checks replace (`scripts/sim/ops.ts:230-238`).

Defects: D7, D8, D26.

### M15 `backup-run`

Kind: implicit. Evidence: `deploy/backup/backup.ts`, `lib.ts`, `railway.toml`, `docs/deploy.md:483-504`.

`Scheduled -> KeyChecked -> SnapshotOpen -> Counted -> Dumped -> SnapshotClosed -> RolesDumped? -> ManifestWritten -> PrivacyProbed -> Encrypted -> Uploaded(files) -> ManifestUploaded -> Heartbeat -> Cleaned`.

| Step | Guard | Failure |
|---|---|---|
| KeyChecked | key, or `PLATFORM_ENV=dev` | exit 1 before the dump |
| SnapshotOpen | repeatable read, read only | exit 1 |
| Dumped | `pg_dump --snapshot`, transaction stays open | exit 1 |
| RolesDumped | needs superuser | warning only |
| PrivacyProbed | only 401, 403, 404 pass | throw; nothing uploaded |
| Uploaded | file by file | prefix stays without manifest |
| ManifestUploaded | last | complete backup |
| Heartbeat | https | failure logged, exit stays 0 |

Invariants:

- A prefix with `manifest.json` is complete (`backup.ts:87`).
- No plaintext dump is uploaded outside dev.
- Counts and dump use one snapshot.
- Probe object removed (best effort; `finally`).
- Local plaintext is removed after upload unless `--out`.

Failure: restart policy NEVER. A failed run waits for the next day. Crash during upload leaves a partial prefix, which `latest` ignores, and the 35-day rule removes it. There is no size or hash check after upload; AES-GCM catches a change on restore.

Limit: on R2 the S3 endpoint always asks for credentials, so the probe detects public access only with `BACKUP_PUBLIC_PROBE_URLS` (`docs/deploy.md:502`).

Quint notes: not very useful alone. Check `latest` never picks an incomplete prefix.

### M16 `sites-deploy-workflow`

Kind: explicit input `pages_operation`, implicit steps. Evidence: `.github/workflows/deploy-sites.yml`, `deploy/smoke.ts`, `sites/sites.ts`.

Run: `test -> build -> production(matrix: slop, ntwrk, peon, friends; one at a time; fail-fast false)`.

Per project: `WaitApproval -> Inspect -> (Patch?) -> Build -> Deploy -> Smoke -> Done | Failed`.

Inspect refuses when: branch not main; custom domain missing; proxy secret absent (except rotate); `APP_ID`, `SITE_HOST` differ; origin binding invalid; Turnstile widget known and does not cover the domain.

| Operation | Patch | Build, deploy, smoke |
|---|---|---|
| `deploy` (push) | never; throw if binding differs from declared origin | yes |
| `inspect` | never | no |
| `repair-and-deploy` | `BACKEND_ORIGIN` if it differs | yes, smoke has `--api` |
| `repair-proxy-and-deploy` | origin and secret | yes, smoke has `--api` |

Invariants:

- Only `main`, behind environment `production`, gets the token.
- A push never changes bindings.
- After a PATCH, a readback shows all other bindings unchanged.
- PR code never runs next to a token.

Failure: no automatic rollback. `fail-fast: false`, so a failed site does not stop the next one. Sites can run different builds. Pages rollback does not restore project bindings (`docs/deploy.md:248`).

Concurrency: workflow-level group `deploy-sites-<ref>`, no cancel on push. GitHub keeps one pending run, and a newer run replaces it (D29).

Defects: D17, D18, D29.

### M17 `proxy-secret-rotation`

Kind: implicit, cross-service. State: backend secret; per project stored secret; per project running secret. Evidence: `proxy.ts:73-82`, `backend.ts:90,103`, `deploy-sites.yml:116,126-132,164-171`.

Per site: `Match(old) -> BackendRotated -> Mismatch -> ProjectPatched -> Mismatch -> Deployed -> Match(new)`.

The backend holds one secret. There is no accept-both window. All four sites return 421 between the backend change and each site's deploy (D16). A Pages variable applies from the next deployment. The workflow does not touch the backend.

Quint notes: merge with M2. Invariant to test: availability, not safety. Safety holds: a mismatch fails closed.

### M18 `wrangler-deploy-guard`

Kind: implicit. Evidence: `scripts/wrangler.sh:57-114`, test `deploy/wrangler.integration.test.ts`.

Input argv gives `Allowed`, `Refused(exit 3)`, or `ApprovedRun` when `NTWRK_ALLOW_DEPLOY=1`. Both readings of unknown flags must allow.

Invariant: only read-only commands run without approval. A local stub run shows that `deploy --help --no-help` and `deploy --help --help=false` reach `bunx` without approval (D20).

### M19 `image-qualification`

Kind: explicit receipts. Evidence: `.github/workflows/backend-candidate-artifact.yml`, `retained-eb4f-runtime.yml`, `network-retained-eb4f-mcpon-v2.yml`, `.github/runtime-eb4f*/`.

`CANDIDATE_ARTIFACT_ONLY -> PinsVerified -> ArtifactFetched -> Converted -> Loaded -> PgReady -> SetupDone -> AppProbed -> AppTerminated -> PgStopped -> PASS | HOLD_NO_RETRY`.

The v2 path adds a closed grant: `ROOT-GRANT.json` has `executionApproved: false`, `expiresAt: 0`, so `qualify.py` asserts before any Docker work. Pin hashes were recomputed here and all match.

"Once" is not enforced. A new dispatch runs again on a new runner. D21: the fixed artifact had 7-day retention.

### M20 `web-join-client`

Kind: explicit. `root.dataset.current`. Evidence: `sites/shared/join.ts`, `auth.ts`, `turnstile.ts`, `ui.ts`.

Steps: `loading, invite, phone, code, profile, member, blocked, done`. Turnstile: `pending, ready, failed`. Generation counter guards stale responses.

Only `peon.biz` has a `join.html`. `router.ts:44-49` retires `/join` for the other three. So the draft path in `join.ts:57-87` is unreachable in the built sites (D22).

### M21 `agent-skill-signup`

Kind: implicit, written as prompt text. Evidence: `sites/skills/*/SKILL.md`, `plugins/*/skills/*`.

Steps: `AppRead -> Draft -> ConsentAsked -> SessionChecked -> OtpStarted -> OtpVerified -> MeChecked -> Joined -> Verified -> ProfileSaved`.

Rules: POST once; timeout after a write means check state first; consent before Join; a Join does not overwrite a membership.

Conflict with the record:

- AGENTS decision 10 says the agent never sees the code and hands one link.
- `sites/skills/slop-date/SKILL.md:108-111` has the agent post the code.
- `plugins/claude/.claude-plugin/plugin.json:4` says "Never handles phone numbers or verification codes".

This belongs to the platform review, since `packages/platform/src/api.ts` decides what is accepted. Model it with the join API, not alone.

### M22 `plugin-snapshot`

Kind: implicit. Evidence: `plugins/build.ts`. `Source -> Snapshot(fresh|stale)`, `--check` in CI. `plugin.json` version is hand edited (Claude 1.0.5, OpenAI 1.0.4), and ChatGPT import does not refetch. No Quint value.

## 3. Suspected defects

Confidence: HIGH means the code path was read end to end. MEDIUM means the path is verified, and one external behavior is not. LOW means a reasoned risk.

### D1. Deployed tick loop omits inbox drain and retention. P0 (consent, privacy). HIGH.

- `deploy/backend/backend.ts:388-397,406`: `tickAll` runs `rt.tick()`, `notifyTick`, `opsTick`.
- `packages/network/service/serve.ts:126,134` and `scripts/sim/pipeline/harness.ts:135,137` also run `svc.inboxTick()` and `svc.purge()`.
- `grep`: outside tests, the only callers are `serve.ts`, `main.ts`, `service.ts tick()`. `server.ts` uses none of them. `ServiceLike` has neither method.

Trigger 1: a Blooio webhook reaches `/webhooks/blooio`. The row is stored. The handler throws. Inbox
docs say "the next tick handles it again" (`inbox.ts:4-5`). In the deployed loop no tick does. A STOP in that row waits until the same sender writes again.

Trigger 2: any run. `people.purge`, `inbox.purge`, `expirePending` and the line purge never run.
So `platform.inbound` keeps `sender`, `replies` and `response` on `done` signed turns (sealing is at `inbox.ts:198-200`), OTP and session rows stay, and expired profile suggestions keep `value`.

The tests and the sim use the other loop, so they do not catch it. In production the signed turn path does not use `drain`, so Trigger 1 applies to the webhook path only. Trigger 2 applies to all.

### D2. Grace timer starts after HTTP drain. P1. MEDIUM.

`backend.ts:428` awaits `s.stop(false)`. `:431` then starts the timer. Local Bun 1.3.14: `stop(false)` stayed pending for a hung request (1500 ms test, it resolved only after release).

Trigger: a stuck `/internal/turn` or MCP request at SIGTERM. Shutdown never reaches line 431. Railway sends SIGKILL after 30 s. The `clean` log never appears, and `svc.close` is not called. The tests use a fake `stop`. Recheck on 1.4.2.

### D3. Inactive Cloudflare Worker cannot stop the container without `BUILD_ID`. P1. HIGH on the code path, MEDIUM on the effect.

`wrangler.toml` has no `BUILD_ID`. README says only active deploys pass it. `worker.ts:36` throws in the constructor. `worker.ts:58` needs the object to call `stop()`.

Trigger: rollback deploy with `BACKEND_ENABLED=false`, no `--var BUILD_ID`. Secret still present. Each fetch and cron throws, so SIGTERM is not sent, and the fetch is an error, not 503. README rollback relies on this signal. The manual container check in README catches it, if run. Whether Cloudflare stops the instance on a new version was not verified.

The same throw happens at README step 3 (secret stored, inactive). The local check (`docs/results/2026-10-21-cloudflare-backend.md:19`) ran with no secret.

### D4. Removing the runtime secret stops the drain. P1. MEDIUM.

`worker.ts:55` returns early when `BACKEND_RUNTIME_CONFIG` is empty. Comment: "no process to drain". Trigger: operator deletes the secret and sets inactive while a container runs. Nothing signals it, and the cron no longer renews activity. It stops at `sleepAfter` (30 m) at the earliest, if the alarm runs. In that time it can tick and send. Effect depends on Cloudflare.

### D5. A read error reports open safety alerts as resolved. P1. HIGH.

`ops.ts:274` adds `ops_read` and `continue`s, so that network's other alerts are absent. `ops.ts:416-422` treats an open key not in `seen` as resolved. Same for `line_read` and `cost_read`.

Trigger: `safety_minor:slop:nyc` open and posted. One failed read in `collectNetwork`. The channel gets "resolved: ... minor signal(s) after contact". After recovery a new alert fires, with a cleared state.

### D6. A safety alert bump compares with the last sent count, which never falls. P1. HIGH.

`ops.ts:410`, `:433`. Counts are rolling or queue depth.

Trigger: `safety_signal` sent at count 5. Staff clear 4; count 1. Two new signals: count 3. `3 > 5` is false. No post until `repeatMs` (6 h). Doc 7.2 says it is posted when the count goes up.

### D7. `unknown_acceptance` counts as attempted, not waiting. P1. HIGH.

`ops.ts:179` does not list it. `outbound-queue.ts:189` does. `:605` reports it to `network.messages`. So `sendOutcomes` goes to the `else` at `:188`.

Trigger: Cloud outage. Sends time out and stay unknown for up to 6 h. `failed` stays 0, and the rate falls. `send_failures` is silent until rows end as `failed_unknown`. `queue_outbound` still counts them. `collected` also counts as attempted.

### D8. Heartbeat stays green when alerts cannot go out. P2. HIGH.

`ops.ts:541` pings without looking at `r.ok`, `r.held` or `error` rows. `docs/deploy.md:420` says a missing heartbeat covers a stopped dispatcher. Trigger: webhook 500 for a day. Heartbeat green. Only a log line shows it.

### D9. `ensureServiceLogin` is not atomic; the login check ignores membership. P1. HIGH.

`backend.ts:457-459` runs three statements with no transaction. `:453-454` returns early if the role exists. `serviceLoginProblem` (`:179-188`) does not check `network_service` membership.

Trigger: crash after `create role`. Next boot: `created:false`, check passes, `fromDatabase` fails with permission denied, and each retry fails the same way. It stays stuck until a person grants. A crash loop, safe but stuck. The check also only covers `platform` and `network`, not `notify` or `oauth`.

### D10. Deployed entry does not require `PLATFORM_SESSION_SECRET`. P1. HIGH.

`env.ts:57` requires it, but only `main.ts:31` calls `assertBootConfig`. `backend.ts:91-95` does not check it. `packages/platform/src/api.ts:134` falls back to the hash key. `docs/deploy.md` section 2.3 does not list the variable. Trigger: deploy without it. Session hashes use `PLATFORM_HASH_KEY`, so one key serves two uses. Length rule also skipped.

### D11. `backup.ts --local` without `--out` deletes the dump. P2. HIGH.

`backup.ts:106,122,127`. Log says `backup kept locally`, then `rm`. `--out` without `--local` is the opposite: uploads and keeps plaintext.

### D12. Restore source check depends on the host string. P1. MEDIUM.

`lib.ts:201-204` compares strings. `backup.ts:55` records the host of `BACKUP_DATABASE_URL`, for example the private Railway name. A drill through the TCP proxy (`runbook-real.md:500`) has another host.

Trigger: `--roles` with the proxy URL. `onSource` is false, and `roles.sql` runs on the source server. `LIVE_NAMES` still protects the live database name. The roles file has no passwords, but it resets attributes.

### D13. Recovery rolls back consent, and sends can restart at once. P0. MEDIUM.

`runbook-real.md:519-526`. Step 6 lists lost messages only. No step replays STOP, leave, ban, delete, or lowest age from after the backup. No step sets dry-run before step 5.

Trigger: backup 07:15. STOP 09:00. Failure 10:00. After restore the member reads as opted in, and live flags still apply. Gateway fence may block on the cloud path. It does not cover the direct `blooio` channel. Restored `platform.outbound` rows also go out again. A deletion after the backup is undone too.

### D14. The deploy doc restore command misses `BACKUP_PREFIX`. P2. HIGH.

`docs/deploy.md:518` sets no prefix. `restore.ts:76` then reads `postgres/dev/` (or `PLATFORM_ENV`). `--r2 latest` fails with no complete backup. `runbook-real.md` has it right.

### D15. A failed restore leaves a database with member data. P2. HIGH.

`restore.ts:52,61`, no cleanup. Same for a mismatch exit. A rerun needs a new name. The runbook covers drop only on success path (step 6).

### D16. Proxy secret rotation has no overlap. P1. HIGH.

One secret (`backend.ts:103`, `proxy.ts:73`). Four sequential deploys. The workflow does not rotate the backend. Trigger: rotate. All sites return 421 until each deploy ends. One failed deploy keeps that site down. It fails closed.

### D17. Deploy path filter misses router inputs. P1. HIGH.

`deploy-sites.yml:26,28` lists `deploy/router.ts`, `proxy.ts`, `apps.ts`. Missing: `deploy/pages-worker.ts` and `packages/platform/src/body.ts` (`router.ts:28`). Trigger: a fix in `readCapped` merges, and no site rebuilds. The running Worker keeps the old code.

### D18. Push deploys do not smoke the API by default. P2. MEDIUM.

`deploy-sites.yml:203` needs `BACKEND_LIVE`. Handoff line 102 lists repo variables without it. Trigger: bad secret or origin. Smoke passes with static checks.

### D19. Router signs before it reads the body. P2. HIGH.

`router.ts:104` signs. `:109` reads. Skew window 60 s. Trigger: 8 MB photo at under about 1 Mbit/s. `ts` is old on arrival, and the backend answers 421. The MCP and API routes share it.

### D20. Help flag can pass the deploy guard. P1. MEDIUM.

`wrangler.sh:69,96`. `help` is sticky; there is no reset for `--no-help` or `--help=false`, unlike `--no-dry-run` at `:65`. Stub run: `deploy --help --no-help` reached `bunx`, exit 0, no approval. The file's own comment says wrangler takes the last value. Real wrangler behavior was not run.

### D21. Retained qualification workflows point at an expired artifact. P2. MEDIUM.

Both fetch run 39497416295. Artifact `retention-days: 7` (`backend-candidate-artifact.yml:142`). Workflows date from 2026-10-20. Today is 2026-11-07. The v2 grant is also closed. GitHub was not called to confirm.

### D22. Signup draft path in `join.ts` is unreachable. P2. HIGH.

`join.ts:58` allows friends and ntwrk. Their `/join` redirects (`router.ts:46`), and only peon has `join.html` (`sites/test/sites.test.ts:47`). `sites/README.md:118-120` still describes it.

### D23. Doc drift that changes operator actions. P2. HIGH.

- `go-live-handoff.md:17` says unset `CLEF_RATINGS` is off. Code and AGENTS say on (`photos.ts:65-67`).
- `deploy.md:159` says the first boot stops at the login check. Code creates the login (`server.ts:51`).
- `deploy.md:134` says leave `BUILD_ID` unset. With `railway up` there is no `RAILWAY_GIT_COMMIT_SHA`, so build is `dev` (`backend.ts:153`). Handoff sets it by hand, so it can differ from the image.
- `deploy.md:367` says the proxy secret is never a GitHub secret. `deploy-sites.yml:116` reads one.
- `deploy.md:363` says the token is read only in the deploy step. The inspect step reads it.
- `deploy.md:391` is false after takeover (`collected` rows).
- `runbook-real.md:349` names `BUDDIES_LIVE_APPROVED`. The flag is `FRIENDS_LIVE_APPROVED` (`channel.ts:88`). It fails closed.
- `deploy.md:82` lists `prototypes/`; the Dockerfile has no such input, and it adds `evals/relay/...`, which is not in `watchPatterns`.

### D24. Replies pass outside the live gate. P1. Design question. HIGH on the code.

`service.ts:1369-1371`. With takeover on and flags off, handled replies still reach members through the gateway. Handoff expects this. AGENTS says "Without them every send is dry-run". Confirm the wording, then keep the two classes in the model.

### D25. After Cloudflare cutover the staff API has no route. P1. MEDIUM.

`worker.ts:70` forwards to port 8790 only. `deploy.md:222` points the console at `backend.railway.internal:4848`. README step 6 retires Railway compute. No replacement path exists. Trigger: finish cutover. The console cannot approve review items, safety actions or the matching switch. Items expire unsent, so it fails safe, but the review queue stalls.

### D26. `tick_late` is masked by state saves. P2. HIGH.

`ops.ts:201` uses the max of `lastTick.stored` and `savedAt`. `savedAt` moves on any unit. Trigger: ticks throw each minute, inbound units still save. The alert stays silent. `/healthz` on the same process does catch it.

### D27. Backup can fail a boot migration. P2. LOW.

`pg_dump` holds ACCESS SHARE on tables. A migration needing ACCESS EXCLUSIVE waits up to 60 s, then `start failed`. While it waits, later readers queue behind it. Only near 07:15 UTC with a large dump.

### D28. Tick and grace numbers are not validated. P2. HIGH.

`backend.ts:154,165,167`. `TICK_MS=""` gives 0, and `abc` gives NaN. `opsConfigFromEnv` checks its numbers, and these do not.

### D29. A pending manual repair can be replaced. P2. LOW.

Workflow concurrency keeps one pending run. A rotate waiting behind a running deploy is cancelled by a newer push. GitHub behavior, not tested here.

## 4. Verified as safe

These were checked and are not defects:

- `loadConfig` and the per-send check agree. An app flag is read per send, and a missing flag refuses.
- `normalizeEdge` removes client headers before it trusts anything.
- `NETWORK_REVIEW_MODE` has no consumer. Review mode is fixed at `"human"` in the service path.
- `latest` restore ignores prefixes without a manifest.
- `decryptFile` removes output on a tag failure.
- Migration runner takes the lock before reading the ledger.
- Alert lock is transaction scoped, so a crash releases it.
- `--no-dry-run` and repeated `--dry-run` handling in `wrangler.sh` is correct (stub test).
- Pin hashes for both `runtime-eb4f*` folders match.

## 5. Modelling order

1. **M1 with outbound**: flags, two processes, queued and collected classes.
2. **M2 plus M17**: edge trust with an attacker and a secret change.
3. **M3 plus M4**: consent stores across rollback, takeover and restore. This is the most valuable model.
4. **M5 to M7**: crash at each boot step. Finds D9 style stuck states.
5. **M8 plus M9**: bounded time, hung request, hung tick. Finds D2.
6. **M11 plus M12**: operator steps in any order. Finds D3, D4.
7. **M13**: small and cheap. Finds D5, D6.

Abstractions: time as discrete ticks. One app, or two to show flag separation. One sender, one row
per class. A database as a log for restore. Environment values as booleans. Bounds: 2 processes,
3 crashes, 4 sites where site count matters. M19, M20, M22 need no model. D1, D10, D17 are better as a test or a lint than a model.
