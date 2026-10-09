# Test policy

**Founder decision:** "delete any unit tests and smoke tests, e2e and integration are fine and good". This replaces the 2026-10-08 "simulations only" policy (cleanup merged at b2bb4d6, base 16cde70), which deleted every test except the six-file security suite.

The validation layer is now:

| Layer | Command | What it is |
|---|---|---|
| Simulations | `bun run sim` | Every simulation block with its gates on pinned seeds (offline, no Postgres). |
| Integration | `bun run test:integration` | Tests against real Postgres, real HTTP servers, several packages together or the full service. Includes the security suite (`bun run security` runs that subset alone). |
| E2E | `bun run test:e2e` | `tests/e2e`: the platform and notify driven from the outside through the running service. |

The integration and e2e suites need the dev Postgres (`bun run packages/observatory/db/dev-pg.ts up`, port 54339; `OBSERVATORY_PG_PORT` and `OBSERVATORY_PG_DIR` select another cluster). Each test process uses databases of its own (`network_test_<pid>`, `platform_test_<pid>_*`, `mcp_test_<pid>`) and drops them afterwards. Sends are dry-run and OTP providers are fakes. CI runs both suites in the `integration` job with a Postgres service and `REQUIRE_PG=1`, so no Postgres suite can skip silently.

**No unit tests and no smoke tests.** A unit test checks one function with fakes. A smoke test checks that something starts or answers, or calls a live provider. Do not add either. A bug fix adds a sim gate, a scenario, a corpus row in `evals/`, or an integration or e2e case that fails before the fix.

`deploy/smoke.ts` is the post-deploy check that `deploy-sites.yml` runs against the deployed sites. It is a deploy step, not a test file, and it stays.

## Classification of the tests deleted between 16cde70 and main

### E2E: restored

| File | Result |
|---|---|
| `tests/e2e/harness.ts` | Helper. Blooio import moved to `packages/blooio`. |
| `tests/e2e/platform.e2e.test.ts` | 25 pass |
| `tests/e2e/notify.e2e.test.ts` | 2 pass |

### Integration: restored

| File | Why integration | Result |
|---|---|---|
| `deploy/router.test.ts` | The site router with the platform's proxy signature, and the built Pages `_worker.js` | 31 pass |
| `packages/mcp/test/mcp.test.ts` | The MCP server over Streamable HTTP on the real platform | 12 pass |
| `packages/mcp/test/pg.test.ts` | The OAuth flow on Postgres | 2 pass |
| `packages/mcp/test/updates.test.ts` | `get_updates` and the assistant signals through the server | 5 pass |
| `packages/network/test/service.test.ts` | The production service on Postgres | 5 pass |
| `packages/network/test/service-apps.test.ts` | The service with several apps, the public API mounted on it | 14 pass |
| `packages/network/test/service-platform.test.ts` | The service as the platform's channel and backend (RLS role, consent ledger, boot checks) | 15 pass |
| `packages/network/test/service-safety.test.ts` | Reports, holds, bans and private photos through the service | 6 pass |
| `packages/network/test/crossapp.test.ts` | Two apps on one service and one database (cross-app leak, blocks) | 2 pass |
| `packages/network/test/store.test.ts` | State persistence: restart from stored state in the NYC world, `PgStore`, the tick lock | 8 pass |
| `packages/notify/test/store-contract.test.ts` | The notify store contract on memory and Postgres | 10 pass |
| `packages/notify/test/wiring.test.ts` | The Notifier on the real blooio outbound queue | 3 pass |
| `packages/observatory/test/apps.test.ts` | The console for four apps on a running server and Postgres (RLS read login) | 14 pass |
| `packages/observatory/test/consent.test.ts` | Game mode with Postgres parity | 9 pass |
| `packages/observatory/test/migrations.test.ts` | The console roles on a real database | 5 pass |
| `packages/observatory/test/real.test.ts` | Real mode against Postgres | 6 pass |
| `packages/observatory/test/real-console.test.ts` | Admin-console data read back from Postgres | 8 pass |
| `packages/observatory/test/real-fixes.test.ts` | Real mode read paths on Postgres, with a running server | 8 pass |
| `packages/observatory/test/real-service.test.ts` | Real mode acting through the network service's staff API | 4 pass |
| `packages/observatory/test/server.test.ts` | HTTP and WebSocket API in both modes | 6 pass |
| `packages/observatory/test/staff.test.ts` | Staff access on the server, Postgres audit | 17 pass |
| `packages/observatory/test/staff-apps.test.ts` | Per-role, per-app access on a running server | 9 pass |
| `packages/platform/test/api.test.ts` | The public API end to end, on memory and Postgres | 38 pass |
| `packages/platform/test/photos.test.ts` | Private photos through the public API | 10 pass |
| `packages/platform/test/proxy.test.ts` | Router signing, a local Bun server and the public API | 4 pass |
| `sites/test/contract.test.ts` | The sites' API client against the real platform API | 9 pass |
| `sites/test/sites.test.ts` | The four built sites against the platform registry, plus the dev proxy server | 70 pass |
| `packages/network/test/mini.ts` | Helper (`START`, the small world) | |

The security suite, kept on main and now part of the integration suite: `packages/platform/test/db.test.ts`, `packages/platform/test/api-security.test.ts`, `packages/mcp/test/oauth.test.ts`, `deploy/backend/backend.test.ts`, and the helpers `packages/platform/test/pg.ts`, `packages/mcp/test/harness.ts`. `packages/observatory/test/pg.ts` is also a helper.

Run on 2026-10-08 against a private Postgres 16 cluster: `bun run test:integration` 413 pass, 0 fail, 0 skip across 31 files (about 5.5 minutes); `bun run test:e2e` 27 pass, 0 fail.

#### Fixes against current main

- `prototypes/messaging-blooio` is now `packages/blooio`: `signBlooioPayload` and `SendRequest` are imported from `packages/blooio/src` (service tests, crossapp, the e2e harness).
- `packages/judge` is gone: `store.test.ts` takes `RunRecord` from `@thenetwork/core` (`core/runlog.ts`) and `computeMetrics` from `@thenetwork/sim` (`sim/src/judge`).
- `notify/test/wiring.test.ts`: the prototype's `SimBus`, gateway and keyword ledger were deleted, so the test builds the real `OutboundQueue` and `ConsentLedger` with a recording `sim` adapter.
- `tests/**/*.ts` is added to the root `tsconfig.json`, so the e2e files are typechecked.
- Nothing restored needed `packages/sim/src/apps` (formerly `packages/worlds`) or the keyword table in `core/replies.ts` directly.

### Dropped from restored files (covers removed functionality)

- `notify/test/wiring.test.ts`, the "connector bridge" case: `connectorInbox` was removed from notify in the cleanup.

### Not restored: simulation-shaped (in-process world runs, covered by `bun run sim`)

- `packages/network/test/network.test.ts` (ConsentNetwork arms and scenarios on the NYC world: the sim's `network` block), `packages/network/test/packs.test.ts` (the slop, peon and friends packs behind the ConsentNetwork: the `slop`, `peon`, `friends` blocks), `packages/network/test/flows.test.ts` and `staff.test.ts` (flows on the hand-built mini world with fakes).
- `packages/observatory/test/console.test.ts`, `game.test.ts`, `projector.test.ts`, `world-stepping.test.ts` (game mode in process).
- `packages/engine/test/*-conformance.test.ts`, `conformance.ts`, `attention-sim.test.ts`, `plans-sim.test.ts`, `slop-golden.test.ts` and the goldens (ported to `scripts/sim/conformance.ts` and the sim blocks).
- `packages/sim/test/*`, `packages/worlds/test/*` (the world, scheduler, oracle and app worlds: the sim blocks).

### Not restored: unit tests (one function or module with fakes)

- `packages/capital/test/{gates,ledger,store}.test.ts`
- `packages/core/src/{chatJson,llm,policy}.test.ts`, `packages/core/test/{clock,guard,guard-evasion,guard-fuzzy,replies}.test.ts` (the guard and replies corpora live in `evals/` and run in the sim's `evals` block)
- `packages/engine/test/*` (attention, audit-2026-10-08, complementarity, explain-leaks, filters, generators, group, judge-passes, minor-alternates, minors, opportunity, outreach, peon-pack, pitfalls, plans, properties, review-regressions, scoring-judge, send-time, slop-iteration2, slop-rater, slop-zips, v12, helpers, slopkit)
- `packages/evals/test/*`, `packages/judge/test/*` (both packages were removed or merged)
- `packages/network/test/{classify.golden,extract,units}.test.ts`, `slopworld.ts`
- `packages/notify/test/notify.test.ts`
- `packages/observatory/test/{scoring,scrub,web-escape,web-sinks}.test.ts`
- `packages/platform/test/{apps,body,consent,env,otp,phone,safety,sessions,turnstile}.test.ts` (in-memory, `createPublicApi` with fakes; the Postgres and HTTP paths are in `api.test.ts`, `db.test.ts` and `api-security.test.ts`), `fixtures/opt-out.jsonl` (now in `evals/`)
- `packages/plugin-network/test/*` (mock runtime). `runtime-construction.test.ts` builds a real Eliza `AgentRuntime` and would count as integration, but it needs the `eliza` submodule's own install, which the integration job does not have, and the plugin's imports do not resolve in CI yet (the `plugin-network` job is non-blocking). Restore it when that job is blocking.
- `packages/mcp/test/plugins.test.ts` (the plugin snapshots equal a fresh build: `bun run plugins/build.ts --check` in CI does this)
- `scripts/supply-chain.test.ts`, `scripts/wrangler.test.ts`, `scripts/synthetic/synthetic.test.ts` (static file checks)
- `sites/test/skill.test.ts`

### Not restored: smoke and live tests

- `deploy/smoke.test.ts`; `packages/core/src/{llm,openai,surplus}.smoke.test.ts`; `packages/engine/test/judge.live.test.ts`; `packages/judge/test/live.test.ts`; `packages/sim/test/live.test.ts`.

### Not restored: removed functionality

- `prototypes/messaging-blooio/tests/*`: the standalone receiver (`gateway`, `server`, `dedupe`), the simulated bus, the keyword handling and `first-send-guard` were deleted when blooio became `packages/blooio`; `live.readonly` and `live-fixtures` are live smoke tests whose fixtures held real Blooio ids. The queue and enforcement cases were unit tests of the queue with fakes; the queue is exercised through the service and notify integration tests.
- `prototypes/{connector-mcp,poc-agent-llm,poc-data-layer,poc-event-ingestion,poc-leak-gate}/**` and `reference/eliza-homepage/**`: the code is deleted.
