# P39 spike: Eliza shared agent + Network plugin fit

> **Update 2026-10-07:** the spike now lives in this repo's `eliza/` submodule (branch `spike/network-plugin`). The plugin moved to `packages/plugin-network` (`@thenetwork/plugin-network`); Cloud consumes it as a `file:` dependency. Paths below that mention `~/v3-network-spike` or `plugins/plugin-network` refer to the earlier layout. `v3-upstream.patch` is the full diff against base `6c6fddb6f65e`, without the plugin, which now lives here.


Date: 2026-10-06. Base: elizaOS monorepo `/Users/shawwalters/v3` at HEAD `6c6fddb6f65e` (`shaw/mega-refactor`).

The spike ran in a git worktree, `/Users/shawwalters/v3-network-spike`, on branch `spike/network-plugin`. Nothing in `/Users/shawwalters/v3` was modified, and nothing was committed. The worktree changes are uncommitted and are also saved here as `v3-spike.patch`.

Path convention: `cloud/` means `packages/cloud/`. Line numbers refer to HEAD unless marked "spike".

## Verdict

**Viable as planned.** The "Eliza shared agent + Network plugin" plan holds up:

- **Plugin API:** a Network plugin written against the current `@elizaos/core` Plugin API loads into the real per-turn shared runtime.
- **Real turn:** it runs a full turn inside Workerd (Stage 1 → `SET_STATE` → grounded reply → post-turn evaluator), and its provider text reaches the model prompt.
- **No monkey patches:** the integration needed **19 lines in `shared-eliza-runtime.ts` and 9 in `run-shared-agent-turn.ts`**, plus a dependency line.
- **Cost:** about +1.4 KiB gzip of bundle and no measurable construction cost.

The blockers are not in the plugin or runtime layer. They are in identity, inbound gating, and outbound compliance, and they are all in Cloud route and gateway code:

1. **Identity collision.** Network turns use the same `personal:` agent id, Durable Object and history as the member's Eliza chat.
2. **Account creation.** Any texter to a `network` number gets an auto-created Cloud account before any project check runs.
3. **Outbound gaps.** There is no Twilio proactive path, no STOP/HELP handling, and no idempotency on Twilio replies.

None of these is hard. All of them must land before the pilot.

## How the spike was run

- **Worktree:** `git worktree add /Users/shawwalters/v3-network-spike -b spike/network-plugin`.
- **Install:** `bun install --ignore-scripts` took 17 s from the bun cache. The main checkout's `node_modules` is stale and is missing `miniflare`, so it could not be reused.
- **Build:** `bun packages/scripts/run-turbo.ts run build --filter="@elizaos/cloud-shared^..."` was fully cached (18/18) and took 1.6 s.
- **Lockfile:** `bun.lock` changed in the worktree only, because of the install and the new workspace dependency.

## Q1. Minimal `plugin-network` against the current Plugin API — yes, built and tested

Source: `plugin-network/` in this folder. The same files are at `/Users/shawwalters/v3-network-spike/plugins/plugin-network/`. The plugin is modelled on `plugins/plugin-todos/src/edge.ts` (injected-store edge factory) and `plugins/plugin-form/src/evaluators/extractor.ts` (evaluator with processors).

**Plugin contents:**
- `createNetworkEdgePlugin({ store, authority: { memberId }, actionsEnabled })` returns a `Plugin` that keeps no state of its own. All I/O goes through an injected `NetworkStore` (`getMemberContext`, `setState`, `recordSignals`). An `InMemoryNetworkStore` is included for tests and the simulator.
- **Provider `MEMBER_CONTEXT`:** always on, with no `contextGate`, so Stage 1 sees it too. It renders the name, city, state, shareable facets and active items.
- **Action `SET_STATE`:**
  - Takes `state=open|busy|traveling|paused`, plus optional `until` (ISO) and `note`.
  - Member identity comes only from host authority. A `memberId` parameter from the model is ignored, and a test proves it.
  - It is idempotent per (message id, ordinal).
  - It returns an `EffectReceipt`: `applied`, or `noop` on replay. That makes it work with the shared runtime's reply-grounding review.
  - Tags: `effect:idempotent` and `effect:receipt-required`.
- **Evaluator `NETWORK_SIGNALS`:**
  - Has `inputScope: "current_message"` and a deterministic `resolveOutput`, so it makes no model call.
  - Detects opt-out wording, travel and safety-concern signals, and a processor writes them to the store.
  - The PRD's LLM extraction evaluators would use `prompt` + `schema` instead.
- Type assignability: `Evaluator<Output, Prepared>` assigns to `RegisteredEvaluator` without a cast.

**Tests** (vitest, using the repo harness: `createMockRuntime` from `@elizaos/testing`, `packages/testing/src/mock-runtime.ts:34`, and the shared `packages/scripts/vitest/default.config`):

| Command | Result |
|---|---|
| `npx vitest run test/network-plugin.test.ts` | **10/10 pass**: plugin shape; zero actions on lifecycle turns; provider render; unknown member; applied receipt + event; idempotent replay → `noop`; authority binding; invalid params; evaluator detect/record; negative case |
| `npx vitest run test/runtime-construction.test.ts` | **2/2 pass**: a real `AgentRuntime` built the same way as the Cloud `createRuntime` (in-memory portable SQLite, assistant plugin with actions stripped, `skipMigrations`) registers `SET_STATE`, `MEMBER_CONTEXT` and `NETWORK_SIGNALS`, and `runtime.composeState(msg, ["MEMBER_CONTEXT"])` contains the member summary |
| `tsc --noEmit` (tsgo 7.0.2) | clean |

**End to end inside Workerd.** This is the strongest evidence. The spike wired the plugin into the production shared runtime and added a test to the existing `cloud/api/__tests__/shared-eliza-runtime.miniflare.test.ts`. That test bundles the real Worker with wrangler, runs it in Miniflare, and uses a deterministic OpenAI-compatible model server.

A `/network-turn` turn ("swamped at work and I will be in Austin next week, pause my network intros until oct 20") produced:

```
NETWORK_WORKERD_TURN {"roundTripMs":77,"workerWallMs":76,"modelCalls":3,
 "reply":"Done, intros are paused until Oct 20. Good luck with the crunch.","degraded":false,
 "member":{"state":"paused","stateUntil":"2026-10-20T00:00:00.000Z",...},"events":1,
 "signals":[{"signal":{"kind":"travel","evidence":"will be in Austin next week"}}],
 "memberContextInPrompt":true,"setStateToolOffered":true}
```

What this shows:
- The custom context `"network"` from Stage 1 routed to the `SET_STATE` tool. Custom contexts are allowed: `AgentContext = FirstPartyAgentContext | (string & {})`, `packages/core/src/types/contexts.ts:59`.
- The receipt-bound reply passed grounding.
- The post-turn evaluator ran inside the shared runtime.

The whole file passes, **9 pass / 0 fail**: the 7 existing tests plus 2 spike tests. `shared-runtime-cutover-reminder.miniflare.test.ts` passes 2/2, `cloud/shared` `tsc --noEmit` is clean, and `shared-todos.test.ts` passes. The eliza-app paths did not regress.

## Q2. How the shared agent builds its per-turn runtime, and what adding the plugin takes

**Path:** route → `SharedRuntimeConversation` DO → `shared-runtime-chat.ts` → `run-shared-agent-turn.ts` → `shared-eliza-runtime.ts`.

1. **Execution authority.** `sharedElizaRuntimeExecution` (`cloud/shared/src/lib/services/shared-runtime/shared-runtime-chat.ts:578-627`) builds server-owned `execution` from the resolved agent row. This is where `todos.store = createSharedTodoStore()`, reminders and media are attached. `authenticatedPersonalSharedUser` is granted only when `isCanonicalPersonalSharedAgent(agent)` (`:588`).
2. **Turn assembly.** `runSharedAgentTurn` (`run-shared-agent-turn.ts:1100` onward):
   - resolves the capability wall and the system prompt;
   - then calls `await import("./shared-eliza-runtime")` (`:1210`; stream variant `:1450`). The runtime module is lazily loaded, which keeps it off the Worker startup CPU path.
3. **Runtime construction and turn.** `executeMeasuredSharedElizaRuntimeTurn` in `shared-eliza-runtime.ts`:
   - creates `SQLiteDatabaseAdapter.create(":memory:")` (`:599`);
   - builds the per-turn plugin instances (`todoPlugin` `:781`, reminders, media);
   - runs `createRuntime` (`:257-311`); **the plugin list is hard-coded at `:300-308`**;
   - calls `initialize({ skipMigrations: true })` (`:829`);
   - checks the expected actions (`:851-898`; for example `:890` throws if TODO is missing);
   - replays history into the in-memory DB, runs `messageService.handleMessage` (`:984`), then `runtime.stop()` (`:1078`).
4. **Prewarm.** `prewarmSharedElizaRuntime` (`:319-360`) prewarms a kernel runtime. It does not need the Network plugin.

**What adding the plugin took** (spike diff, `v3-spike.patch`; no monkey patches):

| File | Change |
|---|---|
| `cloud/shared/package.json` | add `"@elizaos/plugin-network": "workspace:*"` |
| `run-shared-agent-turn.ts` (execution type at `:175-200`) | add `execution.network?: { memberId; store: NetworkStore }` (+9 lines) |
| `shared-eliza-runtime.ts` | `networkPlugin?` option; `...(options.networkPlugin ? [options.networkPlugin] : [])` in the list; build it from `input.execution.network` with `actionsEnabled` (so lifecycle turns still register zero actions, satisfying the `:851-857` assertion); assert `SET_STATE` when `execution.network` is set (+19 lines) |
| **Still needed for production** | `shared-runtime-chat.ts:578` must set `execution.network` when the agent is a Network agent: resolve `network.members` by `agent.user_id` and create a Hyperdrive-backed `NetworkStore` the same way `createSharedTodoStore()` does. `SharedRuntimeAgent` has no project field today, so Network-ness must be encoded in the agent identity (see risk 1). Also add Network capability flags to `buildSharedRuntimeSystem` / `shared-capability-catalog.ts`. |

**Bundle size.** Measured with `wrangler deploy --env production --dry-run`, the same command as `check:worker-bundle`:

| | Total upload | gzip |
|---|---|---|
| Without the plugin (HEAD) | 27,813.57 KiB | 6,862.72 KiB |
| With the plugin | 27,819.99 KiB | 6,864.08 KiB |
| **Delta** | **+6.4 KiB** | **+1.4 KiB** |

The full plugin, with all 12 actions, should stay well under 100 KiB gzip as long as it imports no heavy dependencies (for example, embeddings or H3 in the Worker). The Worker is already at about 6.9 MiB gzip. The Cloudflare paid compressed limit is 10 MiB, which is external knowledge and not stated in the repo. Headroom is therefore about 3 MiB for all of Cloud, so keep the matcher, H3 and vector code out of the Worker.

**CPU limits.** `cloud/api/wrangler.toml` has **no `[limits] cpu_ms`** in any env (searched the whole file; `main = "src/index.ts"` `:11`, `compatibility_flags = ["nodejs_compat"]` `:13`), so the platform default applies. The only CPU limit referenced in the repo is the **startup** limit: `cloud/api/src/bootstrap-app.ts:1-10` ("error 10021: Script startup exceeded CPU time limit"). It is the reason routes are lazily imported and sharded (about 677 route modules).

Implications:
- Network route files must stay lightweight at import time.
- The plugin must be imported only from the lazily loaded `shared-eliza-runtime.ts`, as it is in the spike, not from route top-levels.

## Q3. Risks from integration doc §6, checked against HEAD

| # | Risk | Still true? | Evidence (HEAD) | Smallest change |
|---|---|---|---|---|
| 1 | `personal:` namespace / shared identity | **Yes**, and worse than the doc says: a `network` turn today lands in the *same* DO/history as the member's Eliza chat | `personalSharedAgentId` = `personal:` + uuidv5(`org:user`) (`personal-shared-identity.ts:15-20`); regex `^personal:<uuidv5>$` (`:23-27`); `isCanonicalPersonalSharedAgent` (`:30-41`). Prefix checks across about 20 sites: `resolve-shared-agent.ts:297`; DO `cloud/api/src/shared-runtime-conversation.ts:1354-1359` (decides funding `:1894` and history store), `:1104`, `:2141`, `:1365`, `:1419-1421`, `:1522`, `:1573`; `shared-runtime-chat.ts:588`; `shared-reminder-cron.ts:412`; `api/v1/cron/shared-agent-keepwarm/route.ts:48`; `api/v1/eliza/agents/[agentId]/route.ts:144,295,478`; `upgrade-tier/route.ts:161`; voice `api/v1/voice/session/route.ts:48,141`; wallet `[...path]/route.ts:221,415`; **core** `packages/core/src/capability-catalog.ts:194` (`/^(?:personal:)?[A-Za-z0-9_-]+$/`); UI `packages/ui/src/utils/cloud-agent-base.ts:82` | **Do not add a `network:` prefix** (a new prefix falls into dedicated-agent paths at about 20 sites and is billed as `organization-credits` at DO `:1894`). Keep `personal:` and put the project into the uuidv5 key: `uuidv5(project==="eliza-app" ? "org:user" : "network:org:user")`. Pass `project` to `personalSharedAgentId` and to `isCanonicalPersonalSharedAgent` (one extra field on `SharedRuntimeAgent`, or a project-aware variant). About 2 files. |
| 2 | Auto-account creation on inbound text | **Yes** (opening balance `"0.00"`) | `users.ts:1730` `findOrCreatePhonePersonalAccount` inserts org (`:1845-1851`, `signup-credits.ts:10`), user `phone_verified:true, role:"owner"` (`:1857-1868`), identity (`:1872-1878`). Chain: `user-service.ts:224 → :313 → :542 → :578`; edge wrapper `api/src/personal-delivery-projection.ts:193`. In `cloud/api/internal/eliza-app/personal-shared/messages/route.ts`, `stage="account_resolution"` is at `:752`, the phone branch at `:1340-1356`, and the agent is derived at `:1357`. **No `project` check before any of it.** The gateway forwards any project (`webhook-handler.ts:850`; `isPersonalElizaTransport` `:1132-1137`). | An invite gate at `route.ts` between `:751` and `:752`: `if (project==="network" && !(await isInvitedOrMember(phone))) return canned invite-only reply`. Block network groups at `:766`. About 15 lines plus a `network.members` / `invites` lookup. |
| 3 | Credits / `admitTurn` charges $0 orgs | **Partly: no longer a blocker** | `admitTurn` is at `shared-runtime-chat.ts:1003`, not in the DO. The personal route passes `funding:"platform"` (`route.ts:1885` group, `:1898` DM → `shared-rest-adapter.ts:620` → `conversation-coordinator.ts:330` → DO `:1355/:1894`). `shared-runtime-chat.ts:1090-1092`: `if (funding === "platform") return null;`, so there is **no org charge**. The org rate limit still applies (`:1061`). | None for the pilot if Network keeps the `personal:` path (risk 1 fix). For a Network budget, add an optional `fundingOrganizationId` to `admitTurn` (about 10 lines). |
| 4 | Unverified phone linking | **Yes** | `cloud/api/eliza-app/user/phone/route.ts:133` calls `linkPhoneToUser` after only a session check (`:126`); `users.ts:2598` `linkVerifiedPhone` sets `phone_verified:true` (`:2606`) and overwrites unverified rows (`:2615`). | Never call it for Network. Upstream: require an OTP before `:133`, or store `phone_verified:false`. Network identity comes only from inbound possession or Steward OTP. |
| 5 | No Twilio proactive path | **Yes** | `cloud/services/gateway-webhook/src/internal-delivery.ts`: `parseDelivery` (`:89`) accepts `telegram` (`:103-126`) and `blooio` (`:127-161`) only; adapter selection is the two-way ternary at `:319-320`. `twilioAdapter.sendReplyWithReceipt` already exists (`adapters/twilio.ts:330`). | Add a `platform:"twilio"` case to `parseDelivery`, a three-way adapter map at `:319`, and a twilio `trustedDelivery` case in `route.ts:~1864`. About 30 lines. |
| 5b | Twilio reply idempotency | **Yes** | `adapters/twilio.ts:110-187` POSTs `Messages.json` with no key; `sendReplyWithRequiredReceipt` (`webhook-handler.ts:~211-240`) has no Redis fence. The only fence is in `/internal/deliver` (`internal-delivery.ts:225-333`). | Reuse the Redis `SET NX` tombstone keyed by `reply:twilio:${project}:${messageId}`. |
| 5c | Proactive sends not in history | **Yes** (unchanged; not re-traced in depth) | — | Add a DO "append assistant turn" op, or reuse `coordinateSharedLifecycleEvent` (`conversation-coordinator.ts:179`). |
| 6 | STOP/HELP/START | **Yes, nothing exists** | Case-insensitive grep of gateway-webhook, `api/internal/eliza-app`, `api/v1/twilio`, `api/webhooks` for STOP / optout / opt_out / unsubscribe found only unrelated hits (voice-stream `stop`, Blooio stop-typing, `cloud-bootstrap-message-service/service.ts:369` "STOP" non-response action) | Exact-keyword check in `processMessage` (`webhook-handler.ts`) before `:850` for `project==="network"`. Store opt-out per `(project, phone)` and check it in `internal-delivery.ts` before `:319`. About 40 lines. Note that the spike's `NETWORK_SIGNALS` evaluator only *records* soft opt-out wording; carrier keywords must be handled at the gateway. |
| 7 | Capability wall blocks RELAY_MESSAGE | **Partly.** It never short-circuits the model; it **instructs the model that sending is impossible** | `shared-capability-wall.ts:89-96` `communications` rule matches clause-initial `(email\|call\|text\|message\|dm)\s+` or `send … (text\|message)`. `isEnabled` only allows `reminders`/`todos` (`:170-178`), so everything else is `blocked-primary`. The wall is injected into the system prompt (`run-shared-agent-turn.ts:364-370`, "each unavailable action did not happen") and adds a dedicated-upgrade handoff (`shared-runtime-chat.ts:280`). "text Sam I'm in" hits the wall; "tell Sam I'm in" does not. **Also:** the `calendar` rule (`:74-80`) will catch SCHEDULE phrasing ("reschedule our meeting"), and `bookings` (`:82-88`) will catch CONCIERGE_SEARCH ("book a table"). | Add `relay?`, `scheduling?` and `concierge?` flags to the capabilities object; in `isEnabled` return true for `communications`/`calendar`/`bookings` when set; set them from `execution.network` at `run-shared-agent-turn.ts:1104-1107` (and the stream twin `:1352-1355`). About 15 lines. |
| 8 | Migrations runner / pgSchema | **Yes, but the precedent is better than the doc says** | No `pgSchema(` in `packages/cloud`. `db:cloud:migrate` (root `package.json:99`) and `db:migrate` (`cloud/shared/package.json:42`) both run `cloud/scripts/admin/migrate-with-diagnostics.ts`: a single folder (`canonical-migration-ledger.ts:11-16`, `cloud/shared/src/db/migrations` + `meta/_journal.json`) and a single `__drizzle_migrations` ledger and advisory lock (`migrate-with-diagnostics.ts:54-55`). **Plugin schemas already ride this ledger with hand-written SQL:** `0206_shared_todos.sql:4`, `0207_todo_mutation_ledger.sql:4` (`CREATE SCHEMA IF NOT EXISTS "todos"`), `0202_shared_scheduled_tasks.sql:5` (`"app_scheduling"`). | **Do not build a second runner.** Add `04xx_network_*.sql` files with `CREATE SCHEMA IF NOT EXISTS "network"` plus journal entries, exactly like `todos`. Define the Drizzle `pgSchema("network")` tables in the plugin or in `cloud-shared` for typed queries only. This removes integration-doc §3(e) steps 2-3 and the deploy-order risk. |
| 12 | Gateway project routing | **Works** | `webhook-handler.ts:850` routes any project's twilio/blooio/telegram to `sendPersonalSharedReply`; `ELIZA_APP_WEBHOOK_PROJECT` only gates the Telegram fast path (`:590-595`); credentials come from `NETWORK_*` (`project-config.ts:120-124`); `project` is forwarded (`:1268`). | None in the gateway beyond STOP/HELP; branch on `project` in the route (risks 1 and 2). |

## Q4. Local turn measurements

**Node, real `AgentRuntime`** (`test/runtime-construction.test.ts`, 15 iterations after warmup; construction + `initialize({skipMigrations:true})`, same plugin set as the shared runtime minus web-search, reminders and todos):

```
NETWORK_SPIKE_TIMING {"withoutPluginMs":{"median":3.06,"p95":6.11},"withPluginMs":{"median":2.96,"p95":5.78},"deltaMedianMs":-0.1}
```

**Workerd** (Miniflare, production shared-runtime bundle, local deterministic model; 12 alternating "say hello" turns, first 2 discarded):

```
NETWORK_WORKERD_BENCH {"withoutMedianMs":12.7,"withMedianMs":12.7,"withoutInitMs":[4,3,2,...],"withInitMs":[4,3,3,...]}
```

Workerd freezes timers during pure CPU, so `runtimeInitializeDurationMs` (about 3 ms) is a lower bound.

**Full Network `SET_STATE` turn** (3 model calls: Stage 1, planner tool call, grounded reply):
- 72-77 ms worker wall time when warm, against a local fake model;
- 199 ms on a cold isolate.

**Conclusion:** the plugin's construction cost is nil. Turn latency will be dominated by the 3-4 sequential model calls, plus one grounding-review call when a receipt-bound reply is recovered, plus the provider's store read (Hyperdrive). The p95 < 8 s exit criterion was not measured with a real Cerebras model and is still open; run the same test with `SHARED_ELIZA_LIVE_MODEL_URL` / `SHARED_ELIZA_LIVE_MODEL_ID` set.

## Top blockers (ordered)

1. **Identity collision** (risk 1). Without a project-scoped agent id, a Network member's chat merges into their Eliza DO and history.
2. **No inbound invite gate** (risk 2). Any texter to the Network number gets a Cloud account and a free platform-funded turn.
3. **Compliance**: STOP/HELP, the Twilio proactive path, and Twilio reply idempotency (risks 5, 5b, 6).
4. **Capability wall wording** (risk 7). Relay, scheduling and concierge intents get a "this can't be done" constraint in the system prompt unless the wall is told about Network capabilities.
5. **Execution authority wiring.** `shared-runtime-chat.ts:578` must resolve the member and build a Hyperdrive `NetworkStore`; `SharedRuntimeAgent` has no project field to key on.

## Smallest set of upstream changes

All of these are in the eliza monorepo, at roughly 250-350 lines total:

1. `plugins/plugin-network/` (new; the spike shape) plus the `cloud-shared` dependency.
2. `shared-eliza-runtime.ts` + `run-shared-agent-turn.ts`: `execution.network` and `networkPlugin` in the list and in the action assertion (done in the spike, 28 lines).
3. `personal-shared-identity.ts`: project-scoped uuidv5 key under the existing `personal:` prefix, with `isCanonicalPersonalSharedAgent` taking a project. Add `project` to `SharedRuntimeAgent`, or to the coordinator RPC, so `shared-runtime-chat.ts:578` can attach `execution.network` and the Network capabilities.
4. `cloud/api/internal/eliza-app/personal-shared/messages/route.ts`: when `project==="network"`, run the invite gate before `:752`, block group messages at `:766`, and derive the agent with the project at `:1357`.
5. `shared-capability-wall.ts` + `run-shared-agent-turn.ts:1104/1352`: relay, scheduling and concierge flags.
6. `gateway-webhook`: STOP/HELP/START for `network` in `processMessage` before `:850`; Twilio in `/internal/deliver` (`:89`, `:319`); Twilio reply fence.
7. `cloud/shared/src/db/migrations/04xx_network_*.sql` + journal entries (the `todos` precedent, no new runner).
8. DO history append for proactive sends (`conversation-coordinator.ts:179` pattern).

Monkey patches required: **0**.

## Files

- `plugin-network/`: plugin source and tests (copy of the worktree package).
- `v3-spike.patch`: the `packages/cloud` diff (runtime wiring, Workerd fixture route, two Workerd tests).
- Worktree: `/Users/shawwalters/v3-network-spike` (branch `spike/network-plugin`, uncommitted). To rerun:
  - `cd plugins/plugin-network && npx vitest run`
  - `cd packages/cloud/api && bun test __tests__/shared-eliza-runtime.miniflare.test.ts`

## Upstream changes implemented

Date: 2026-10-06. Worktree `/Users/shawwalters/v3-network-spike`, branch `spike/network-plugin`, on top of base `6c6fddb6f65e`. `/Users/shawwalters/v3` itself was not modified and nothing was pushed. The full diff against the base (the earlier spike plus everything below) is `v3-upstream.patch` in this folder: 44 files, +4,336 / −25. The upstream changes alone are about +1,270 lines of production code and SQL; the rest is tests.

Every change is gated on `project === "network"`, or on a server-resolved `execution.network`. Eliza traffic takes none of the new branches, and the tests exercise `eliza-app` side by side to prove it. The one exception is a pre-existing gateway bug fix, flagged under item 4.

### Commits on `spike/network-plugin`

| Commit | Summary |
|---|---|
| `8c939a6` | The earlier P39 spike, committed as-is: `plugin-network`, runtime wiring, and the Workerd fixtures. |
| `e2ae9c1` | Migration `0474_network_core.sql`, its journal entry, and the typed `pgSchema("network")` tables. |
| `809c841` | Project-scoped personal Shared identity. |
| `97ad79e` | Invite gate in the personal-shared inbound route. |
| `0416bd7` | **Bug fix, affects all projects:** `/internal/deliver` crashed on replay of a completed receipt. |
| `f83aa68` | Gateway: STOP/HELP/START handling, consent ledger, Twilio `/internal/deliver`, and the Twilio reply fence. |
| `e4cd2c5` | Capability-wall flags for relay, scheduling and concierge, plus the Workerd RELAY test. |
| `b58d33a` | Proactive sends appended to the Network Durable Object history. |
| `e4bc44c` | Import sorting only (biome). |

### 1. Project-scoped agent identity

- **Derivation.** `personal-shared-identity.ts`: `personalSharedAgentId({userId, organizationId, project?})` keeps the `personal:` prefix. When the project is `network`, the uuidv5 key becomes `network:org:user`.
  - Every other project value, including `eliza-app`, `undefined`, unknown names and casing variants, yields the original `org:user` id byte for byte. A test pins this against an independently computed uuidv5.
- **Carrying the project.**
  - `SharedRuntimeAgent` gains an optional, server-resolved `project`.
  - `personalSharedAgent()` sets it only for scoped projects, so Eliza agent objects are unchanged.
  - `isCanonicalPersonalSharedAgent` binds the project into its check: a Network id without its project, or an Eliza id that claims `network`, gets no USER authority.
- **Route.** `personal-shared/messages/route.ts` derives the agent with `parsed.data.project`. The project then rides the agent object, which is JSON-serialized into the Durable Object, so `shared-runtime-chat.ts:588` still grants `authenticatedPersonalSharedUser`.
- **Prefix call sites.** All of them were audited:
  - **Prefix or regex checks** (DO `:1104/:1359/:1365/:1419/:1522/:1573/:2141`, `shared-reminder-cron.ts:412`, keepwarm, voice/Twilio token regexes, `core/capability-catalog.ts:194`, `ui/cloud-agent-base.ts:82`): these still see a Network id as personal. That means platform funding, the personal history store and the rowless path. A test covers this.
  - **Sites that recompute the expected Eliza id from (org, user)** (`resolve-shared-agent.ts:297` web/API, `agents/[agentId]` GET/PATCH/DELETE, upgrade-tier and adopt-existing, cutover, wallet, voice session, identity resolve, admin adoption, `steward-sync.ts` convergence, `user-service.ts` Dedicated lookup): these do not match a Network id, so Network rooms are not reachable from those surfaces.
    - That is intended for the pilot.
    - Consequence: a Steward account merge does not carry the Network history.
- **Separate histories.** A new Workerd Durable Object test runs one account through the production `SharedRuntimeConversation` DO:
  - its Eliza turn and its Network turn land in different objects with separate histories;
  - both are funded as `platform`.

### 2. Invite gate

- **Gate logic.** `cloud-shared/lib/network/inbound-gate.ts` holds `evaluateNetworkInboundGate(message, lookup)` and the `NetworkInviteLookup` interface.
  - `InMemoryNetworkInviteStore` is the stub store.
  - `invite-lookup.ts` is the Postgres lookup: an accepted invite, or a member who is not removed. It imports the database client lazily.
- **Route placement.** The route runs the gate right after validation. That is before the worker context and before `stage="account_resolution"`, so `findOrCreatePhonePersonalAccount` is never reached for an uninvited phone.
- **Outcomes:**
  - **Uninvited phone:** HTTP 200 `{code:"network_invite_required", reply:<canned>}`.
  - **Network group message:** `{code:"network_group_unsupported", reply:""}`. The gateway sends nothing for an empty reply, so nothing is ever posted into a group.
  - **Network Telegram DM:** refused; there is no phone to check.
- **Admitted Network turns** also skip the Dedicated bridge (`dedicated = null`) and the DM group-claim and group-join commands.
- **Test** (`route.network-gate.test.ts`): runs the real route with the account projection mocked as a recorder.
  - An uninvited phone gets the canned reply and zero account resolutions.
  - An invited phone reaches account resolution.
  - Groups are dropped with no lookup.
  - `eliza-app` bypasses the gate with no invite lookup.

### 3. STOP / HELP / START at the gateway

- **Module.** `gateway-webhook/src/network-compliance.ts` ports the prototype `keywords.ts`: exact keyword matching after normalization (`stop by later` and `yes` are not keywords), plus the canned copy.
- **Consent ledger.** `NetworkConsentLedger`, Redis-backed, injectable through `HandlerDeps.networkConsentLedger`.
  - It keeps a current-state key with no TTL and an append-only log list.
  - Postgres `network.consent_ledger` is the durable audit table.
- **Where it runs.** `processMessage` runs it first for `network`, before identity linking and before the existing `:850` personal branch.
  - **STOP or START:** the ledger is written, then the confirmation is sent.
  - **HELP:** always answered, even after STOP.
  - **Any other text from an opted-out number:** no turn and no reply.
  - **Ledger outage:** a pre-egress error that reopens the webhook for a provider retry.
- **"Halts sends within one message":**
  - the inbound reply path re-reads the ledger just before egress, so a STOP that arrives while a turn is running suppresses that turn's reply;
  - `/internal/deliver` refuses opted-out Network recipients (`422 recipient_opted_out`) before any claim or provider call.

### 4. Twilio

- **Proactive sends.** `internal-delivery.ts`:
  - `parseDelivery` accepts `platform:"twilio"` with a `phoneNumber`, **for the `network` project only**; `eliza-app` still gets 400.
  - The adapter is chosen by a three-way map. It reuses `twilioAdapter.sendReplyWithReceipt` under the existing three-state Redis tombstone.
  - An explicit Twilio 4xx (`PlatformDeliveryError` `failed`) releases the claim.
- **Inbound reply fence.**
  - Network Twilio replies, including keyword confirmations, go through `sendWithTwilioReplyFence`.
  - It does `SET NX reply:twilio:<project>:<messageId>` = `indeterminate`, then writes `complete` with the provider ids after the receipt. It releases the fence only on an explicit rejection.
  - A test reopens the outer webhook claim and replays the same `MessageSid`: the turn runs twice but the SMS is sent once.
- **Pre-existing bug found and fixed (commit `0416bd7`, all projects).**
  - **Cause:** `parseReceipt` assumed a string, but `GatewayRedis.get` (native and mock) JSON-parses, and so does Upstash by default.
  - **Effect:** every replay of a *completed* `/internal/deliver` receipt threw `value.startsWith is not a function` and returned 500. This was reproduced on the base code with a Blooio `eliza-app` reminder.
  - **Fix:** accept the parsed object as well as the string. It changes only a path that currently crashes.
  - **If upstream wants strict non-interference, review this commit separately.** The Network Twilio replay test depends on it.
- **Not done:** a Twilio `trustedDelivery` case in the route at about `:1864`, which only Twilio-delivered *reminders* would need.

### 5. Capability wall

- **Wall.** `shared-capability-wall.ts`:
  - `SharedCapabilityWallFlags` adds `relay`, `scheduling` and `concierge`.
  - `isEnabled` admits `communications`, `calendar` and `bookings` respectively.
  - `NETWORK_CAPABILITY_WALL_FLAGS` is exported.
- **Turn.** `run-shared-agent-turn.ts` (buffered and stream twins) sets the flags only when `execution.network` is present and actions are enabled.
- **Prompt catalog.** `shared-capability-catalog.ts` takes `flags.network`. It then describes those three as *available* Network actions instead of "needs workspace", and no "each unavailable action did not happen" block is injected.
- **Tests:**
  - Unit tests: Eliza still blocks all three; Network allows them; unrelated walls such as purchases still apply, including as a blocked secondary clause.
  - **Workerd test** in the existing `shared-eliza-runtime.miniflare.test.ts`: the same "text Sam I'm in" turn is run with and without `execution.network`.
    - **Network:** the phrasing reaches the model; "Relay a message to another Network member (communications); availability: available" is in the prompt; there is no wall and no `capabilityWall` on the result.
    - **Eliza:** keeps the `communications` wall and the "Unavailable actions…Calls and messages" constraint.

### 6. Migrations

- **File.** `0474_network_core.sql` sits on the existing journal (idx 457, `when` strictly increasing) and passes `check-migration-prefix-order`. It contains `CREATE SCHEMA IF NOT EXISTS "network"` and:
  - **`members`:** E.164 phone, unique; optional Cloud account pair with an all-or-nothing check; state check.
  - **`invites`:** token hash only; `accepted_at` is set exactly when the status is `accepted`.
  - **`consent_ledger`:** append-only through a trigger; unique `(channel, provider_message_id)` for idempotent keyword replays.
- **Typed tables.** The typed `pgSchema("network")` tables are in `cloud-shared/src/db/network/schema.ts`. They are deliberately left out of the drizzle-kit barrel, following the `todos` precedent.
- **Test.** PGlite: registration, idempotent re-application, every constraint, and the append-only trigger.

### 7. Proactive sends in the Durable Object history

- **New DO operation `project-proactive-turn`** in `shared-runtime-conversation.ts`. It records an assistant turn, but only when:
  - the project is a scoped one;
  - `agentId` re-derives from (project, org, user);
  - `roomId === agentId`.

  Eliza rooms and forged ids get 400 `invalid_project_proactive_turn`.
- **Coordinator.** `coordinateSharedProjectProactiveTurn` in `conversation-coordinator.ts` addresses it.
- **Send flow.** `cloud-shared/lib/network/proactive-send.ts` provides `sendNetworkProactiveMessage`:
  - it delivers through the gateway's `/internal/deliver` first;
  - it appends only on provider acceptance;
  - the turn id is `network-proactive:<idempotencyKey>`, so a replay merges onto one entry;
  - unknown, refused or opted-out deliveries never touch history.
- **Tests:**
  - **Unit:** the send flow above.
  - **Workerd DO test:** the turn appears once in the Network history, a later member reply follows it, and the Eliza history is unchanged.

### Tests and typecheck, before and after

"Before" is the spike commit `8c939a6`, which equals the earlier uncommitted spike. "After" is `e4bc44c`.

| Suite | Before | After |
|---|---|---|
| `gateway-webhook` `bun test` | 30 pass / 0 fail (2 files) | **42 pass / 0 fail** (4 files: +11 `network-compliance`, +1 `internal-delivery-replay`) |
| `gateway-webhook` `tsc --noEmit` | clean | clean |
| `cloud/shared` `tsc --noEmit` | clean | clean |
| `cloud/shared`: `shared-todos` + `shared-todos-migration` | 2 / 0 | 2 / 0 |
| `cloud/shared`: 6 journal-sensitive migration tests (inference-accounting, twilio-*, phone-jsonb, secure-remote-relay, ai-billing) | 18 pass, 1 skip, 0 fail | 18 pass, 1 skip, 0 fail |
| `cloud/shared`: new Network tests (identity, wall, gate+lookup, proactive-send, 0474 migration) | n/a | **18 pass / 0 fail** (5 files) |
| `check-migration-prefix-order` | ok | ok |
| `cloud/api` `tsc --noEmit` | clean | clean |
| `cloud/api` `check:router-contract` | not run | ok (766 routes) |
| `cloud/api` `check:worker-bundle` | 27,819.99 KiB / 6,864.08 KiB gzip | 27,825.17 KiB / 6,865.46 KiB gzip (+1.4 KiB gzip) |
| `cloud/api` Workerd: `shared-eliza-runtime` + `shared-runtime-cutover-reminder` | 11 pass, 1 skip, 0 fail | **12 pass, 1 skip, 0 fail** (+ relay test) |
| `cloud/api` Workerd: new `shared-runtime-network-identity.miniflare.test.ts` | n/a | **2 pass / 0 fail** |
| `cloud/api` `route.network-gate.test.ts` (and `run-unit-isolated` for the `internal/` and `twilio` filters) | n/a | 5 / 0; isolated runs all pass |
| `plugins/plugin-network` vitest | 12 / 12 | 12 / 12 |

### Not done, or still open

1. **Production `execution.network` wiring** (`shared-runtime-chat.ts:578`) is still missing. It needs a Hyperdrive-backed `NetworkStore` that resolves the member from `agent.project === "network"` + `user_id`. Until it exists:
   - the capability flags and the plugin activate only where `execution.network` is supplied, which today means the tests and the Workerd fixture;
   - the route already passes `project` on the agent, so this is the only missing link.
   - The 0474 tables are too thin for the full `NetworkStore` (facets, active items and signals), so this was left for the schema PR.
2. **Consent is enforced from Redis.** Nothing writes `network.consent_ledger` yet, because the gateway has no database access. A Cloud-side writer or sync, for example a gateway → `/api/internal/network/consent` call, is a follow-up.
3. **Invite acceptance is not built.** Neither creating members or invites nor linking `cloud_user_id` exists yet; the gate only reads.
4. **Twilio reminder `trustedDelivery`** (route `:1864`) is not added.
5. **Group lifecycle events are not blocked for `network`.** Only group messages are blocked. Bindings cannot be created, because the DM claim and join commands are disabled for `network`.
6. **The p95 < 8 s latency target with a real model is still unmeasured**, as noted in Q4 above.

## Open items closed (second pass)

Same branch, gating and commit style. `v3-upstream.patch` has been regenerated against base `6c6fddb6f65e`: 58 files, +5,969 / −33. This pass added about 770 lines of production code and SQL. It closes items 1–5 of the "Not done, or still open" list above and measures item 6. Item 6 found a real routing problem.

| Commit | Summary |
|---|---|
| `c716abe` | Postgres member store and the production `execution.network` wiring. |
| `3b30e28` | Invite acceptance, the Network group lifecycle block, and Twilio reminders. |
| `29d4a94` | Durable consent ledger behind the Redis fast path. |
| `5fb01d8` | Opt-in real-model latency run. |

### 1. Production `execution.network`

- **Schema.** Migration `0474` was extended in place, since it has never been deployed:
  - `members.state_until` is renamed to **`paused_until`**, and **`facets text[]`** is added;
  - **`network.member_events`** is the idempotent SET_STATE ledger. Its bigserial id becomes the receipt commit id (`evt-<id>`).
  - **`network.member_signals`** is unique per (member, message, kind).

  `state` and `city` already existed. If you prefer append-only migrations even for unreleased files, move these changes into a `0475`.
- **Store.** `cloud-shared/lib/network/member-store.ts`, `createPostgresNetworkStore`:
  - every operation is one atomic statement, so it works on Hyperdrive without an interactive transaction;
  - SET_STATE is a single CTE that locks the member, inserts the event `ON CONFLICT DO NOTHING`, and updates only when the event is new; a replay returns the stored event.
  - **Authority key:** the server-resolved Cloud user id (`agent.user_id`) maps to `members.cloud_user_id`. Building `execution.network` therefore needs no extra round trip before the turn, and the model can never pick the member.
- **Wiring.** `shared-runtime-chat.ts` `sharedElizaRuntimeExecution` now calls `sharedNetworkExecution(agent, personalShared, isGroupRoom)`. It returns `{memberId, store}` only when all of these hold:
  - the identity is a canonical personal identity;
  - its project is `network`;
  - the room is a DM.

  The store is built per turn, like the todo store. Eliza and Dedicated agents and group rooms get nothing.
- **Workerd end-to-end test** (in `shared-eliza-runtime.miniflare.test.ts`): the full SET_STATE turn goes through that builder and the Postgres store.
  - The SQL runs on a **real PGlite** in the test process. The Worker reaches it over `drizzle-orm/pg-proxy`, because PGlite cannot run inside Workerd itself.
  - `MEMBER_CONTEXT` is read from Postgres; the member row becomes `paused` with `paused_until` 2026-10-20; exactly one `member_events` row is written; the `travel` signal is recorded.
  - The turn took 3 model calls and 68 ms against the deterministic model.
  - The same account's Eliza identity gets no member store.
- **Unit tests** (PGlite): replay without state regression, unknown member, and signal deduplication.

### 2. Invite acceptance

- **Gate.** It now admits a phone with a live (pending, unexpired) or accepted invite, or a member who is not removed. Expired invites are refused.
- **Linking.** On the first admitted Network phone message, after account resolution, the route calls `networkMembership.linkInvitedPhone`. It is a single idempotent statement that:
  - upserts the member for the phone;
  - links it to the Cloud account that was just resolved;
  - accepts the live invites.

  It never relinks a phone that is already linked to a different account (`account_mismatch`, canned reply). An invite revoked between the gate and the link gets the canned reply.
- **Admin helpers.** `createInvite` stores only a token hash. `upsertMember` is idempotent on phone.
- **Tests:** PGlite covers creation, replay, admin-created members, mismatch and expiry. Route tests cover the link call, the revoked-invite race, and that `eliza-app` never links.

### 3. Durable consent

- **Cloud.** New `POST /api/internal/network/consent`:
  - internal auth (`webhook-gateway` or shared secret);
  - a zod schema that accepts only the `network` project and requires a provider message id;
  - appends to `network.consent_ledger` with `ON CONFLICT (channel, provider_message_id) DO NOTHING`.

  The router was regenerated (767 routes).
- **Gateway.** The Redis ledger is still the enforcement fast path and is written first. STOP and START entries are then POSTed to that route. A failed durable write never blocks the confirmation:
  - the entry goes into a Redis outbox (`GatewayRedis` gains `rpop`);
  - the outbox drains on the next successful write and every 60 s from `index.ts`.

  Because the sink is idempotent per message id, at-least-once delivery is safe.
- **Tests:** route auth and validation; PGlite idempotency; gateway STOP/START durability, including a 503 that is queued and drained later.

### 4. Twilio reminders

- **Route.** Network Twilio DMs now carry `trustedDelivery {platform:"twilio", project:"network", phoneNumber}`.
- **Scheduling plugin.** `plugin-scheduling` `parseSharedReminderDelivery` accepts `twilio` only for project `network`. Reminders fire through the gateway's network-only Twilio `/internal/deliver`, and the reminder cron's target mapping handles `twilio`.
- **Tests:** a parser test covers network-accepted and eliza-app-rejected destinations. The `plugin-scheduling` suite passes 684/684.

### 5. Network group lifecycle events

For project `network`, the route refuses membership, delivery-authorization, commit and receipt events before touching any group binding:

- authorization returns `authorized:false`;
- commit returns `committed:false`;
- membership returns `network_group_unsupported` with an empty reply.

The route test covers all three.

### 6. Real-model latency (gpt-6-luna on Surplus)

- **Harness.** A new opt-in test in `shared-eliza-runtime.miniflare.test.ts`, skipped unless `NETWORK_LIVE_MODEL_URL`, `NETWORK_LIVE_MODEL_ID` and `NETWORK_LIVE_MODEL_KEY` are set.
  - It runs 20 availability messages through the production `execution.network` wiring and Postgres store inside Workerd.
  - Only those turns' model calls are forwarded to `https://api.surplusintelligence.ai/v1`, with the key from `thenetwork-poc/.env`. The key is never logged; a grep of the run log found 0 occurrences.
  - Each turn records wall time, model calls, which tool each call returned, and whether SET_STATE actually committed (a `member_events` row).
- **Runs.** Two runs of 20 turns, measured as worker wall time per turn:

| Run | p50 | p95 | max | Model calls per turn (p50 / mean / max) | Turns that committed SET_STATE |
|---|---|---|---|---|---|
| 1 | 2.02 s | 7.59 s | 19.0 s | 1 / 1.3 / 7 | 1 of 20 (19.0 s, 7 calls) |
| 2 | 2.25 s | 12.33 s | 14.9 s | 1 / 1.6 / 7 | 1 of 20 (8.9 s, 4 calls) |

- **Verdict against p95 < 8 s:** not met reliably (7.6 s in one run, 12.3 s in the other), and the numbers mostly do not measure SET_STATE.
- **Why it isn't SET_STATE:** in 18–19 of 20 turns, luna's Stage 1 picked the `simple` or `general` context and answered directly, in 1 model call of about 1.5–3 s. Many of those replies claim an effect that never happened, for example "Got it—I'll hold off on new intros this week" with no state change. Some turns looped through `DISCOVER_ACTIONS` five times and then said it couldn't change availability.
  - The deterministic harness passes because its fake Stage 1 returns `contexts:["network"]`.
- **The actual SET_STATE path** (`HANDLE_RESPONSE` → `DISCOVER_ACTIONS` → `SET_STATE` → reply) is 4 sequential calls at about 1.5–3 s each, roughly **9 s**. That already exceeds the 8 s target on its own.
- **This is a routing problem, not an infrastructure one.** Two upstream fixes are needed before this latency number means anything:
  1. Make the `network` context, and SET_STATE under it, visible to Stage 1 for Network turns. For example, the Network agent's character or catalog lists the context, or SET_STATE also declares `general`.
  2. Add a SET_STATE "current-turn execution requirement", the same pattern `run-shared-agent-turn` already uses for REMINDERS and TODO. This also blocks the ungrounded "I'll hold off" replies and cuts out the `DISCOVER_ACTIONS` hop.

  After that, re-run with the same env vars. Expect a p95 near 9–10 s unless a call is removed: the reply step could stream, or `DISCOVER_ACTIONS` could be skipped when the action is required.
- **To reproduce:** from `packages/cloud/api`, source `thenetwork-poc/.env`, then run `NETWORK_LIVE_MODEL_URL=$SURPLUS_BASE_URL NETWORK_LIVE_MODEL_ID=gpt-6-luna NETWORK_LIVE_MODEL_KEY=$SURPLUS_API_KEY bun test __tests__/shared-eliza-runtime.miniflare.test.ts -t LIVE`.

### Tests after the second pass

Everything was rerun at commit `5fb01d8`.

| Suite | Result |
|---|---|
| `gateway-webhook` | 44 pass / 0 fail (4 files); `tsc` clean |
| `cloud/shared` `tsc` | clean |
| `cloud/shared` todos + migration | 2 / 0 |
| `cloud/shared` 6 journal-sensitive migration tests | 18 pass, 1 skip, 0 fail (unchanged) |
| `cloud/shared` Network tests | 27 pass / 0 fail (7 files) |
| Migration prefix-order check | ok |
| `cloud/api` `tsc` | clean |
| `cloud/api` router contract | ok (767 routes) |
| `cloud/api` worker bundle | 27,837.05 KiB / 6,869.19 KiB gzip (about +5 KiB gzip over HEAD in total) |
| `cloud/api` Workerd (3 files) | 15 pass, 2 skip (the existing live test and the new live test), 0 fail |
| `cloud/api` route gate test | 9 / 0 |
| `cloud/api` consent route test | 2 / 0 |
| `cloud/api` isolated `twilio` filter | 2 files pass |
| `plugins/plugin-network` | 12 / 12 |
| `plugins/plugin-scheduling` | 684 / 684 (41 files); `tsc` clean. The modified reminders file had 52/52 before the change as well. |

### Still open

1. **Stage 1 routing for Network intents** (see item 6). This blocks the latency target and is a grounding risk.
2. **Active items in `MEMBER_CONTEXT`** (invitations, threads) return `[]` until the opportunities schema lands.
3. **Invite acceptance is phone-only.** The invite token is stored but not yet redeemed through a web link; acceptance happens on the first SMS.
4. **Account merges don't carry Network history.** Steward account merging still only covers Eliza ids, as noted in section 1 of "Upstream changes implemented".

## Routing design comparison

Same branch (`spike/network-plugin`). This pass addresses "Still open" item 1, Stage 1 routing for Network intents. Two designs were built behind one flag, `execution.network.routing`, and measured against gpt-6-luna on Surplus. `v3-upstream.patch` has been regenerated against base `6c6fddb6f65e`: 64 files, +6,907 / −40.

| Commit | Summary |
|---|---|
| `fc8f7d8` | **Design B** (`structured`): a `networkAction` field on the Stage-1 call, then deterministic authz and execution. |
| `4bd33d8` | **Design A** (`planner`): the `network` context is visible to Stage 1, and SET_STATE becomes a must-call. |
| `025e2ba` | Harness fix: stop wrangler once the dry-run bundle is written. It lingered for minutes on this network and timed out the suite's setup. |
| `0d5b40d` | **Default set to `structured`**. `NETWORK_DEFAULT_ROUTING` now lives in Cloud wiring (`run-shared-agent-turn.ts`). |
| `80ae1aa` | The LIVE eval can resume a run that stopped part-way (`NETWORK_LIVE_SKIP_CASES`). |

### The two designs

- **Shared by both.** The edge plugin registers the `network` `ContextDefinition` through `runtime.contexts.tryRegister` in its `init`. Stage 1 only lists contexts that are registered and backed by an authorized action or provider. Before this change, luna never saw `network` and routed availability messages to `simple` or `general`.
- **Design A (`planner`).**
  - Stage 1 can route to `network`, and the planner then calls SET_STATE.
  - `run-shared-agent-turn` adds a SET_STATE current-turn execution requirement whenever `network/state-intent.ts` detects an availability change. This is the same mechanism REMINDERS and TODO use: the system prompt says to call SET_STATE before any terminal answer, and a turn that ends without a SET_STATE result fails.
  - The trigger ignores quoted text, third parties and common near-misses.
- **Design B (`structured`).**
  - The plugin adds a `networkAction` `ResponseHandlerFieldEvaluator`. This is the runtime's own extension point for typed fields on the Stage-1 `HANDLE_RESPONSE` call, so no monkey patching is involved.
  - The model proposes `{action, state, until, evidence}`. The prompt is ported from the hardened prototype prompts.
  - Deterministic code decides whether the proposal is applied. It uses `authorizeSetState`, ported from `poc-agent-llm/src/authz.ts`: sanitization, verbatim evidence from the member's own unquoted words, a valid state, and a future `until`.
  - If authorized, it executes `store.setState` with the same idempotency key as the SET_STATE action, then preempts the planner with a direct reply. A refused proposal gets a fixed clarification. `NONE` leaves routing untouched.
  - The "structured state-intent call" is therefore the Stage-1 call that already happens, not an extra call.
- **Gating (both designs).** Only `execution.network` turns build the plugin: a canonical personal identity, project `network`, in a DM. The field evaluator is registered only for `structured` with actions enabled.

### Eval

- **Messages.** 30 in total:
  - 20 state messages: 5 pause, 5 travel, 5 busy/quiet, 5 resume, phrased in different ways;
  - 10 controls, including near-misses: a paused gym membership, "back from the gym", a quoted "pause all your intros", a third party who is traveling, and an intro request.
- **Setup.** Two runs per design, through the production `execution.network` wiring and the Postgres store inside Workerd. Before each turn the member is reset: `paused` for resume messages, `open` otherwise.
- **Retries and failures.** A model call gets one retry on a transient error: transport reset, timeout, 429 or 5xx. If the retry also fails, the turn counts as failed, and a failed turn counts as not committed.
- **What counts as committed:** a new `member_events` row.
- **Raw data:** `routing-eval.jsonl` (120 turns).

**The network was badly degraded during these runs.** Surplus calls frequently took 5–60 s, and there were 502s and ECONNRESETs. One A run hit the 1 h test timeout after 23 turns; its last 7 cases (all controls) were resumed with `NETWORK_LIVE_SKIP_CASES=23` once the network recovered. **The raw wall-clock columns therefore measure the network, not the designs.** The clean estimate multiplies each design's sequential model calls by the clean per-call luna latency measured earlier: p50 about 1.7–2.3 s, p95 about 4.5–6.9 s.

| | **A: planner + must-call** | **B: structured Stage-1** |
|---|---|---|
| Commit rate on state messages (run 1 / run 2) | 36/40 (20/20, 16/20) | **38/40** (18/20, 20/20) |
| Committed with the expected state | 35/40 | 32/40 |
| False commits on controls | 1/20 | 1/20 |
| Failed turns (model error after one retry, or timeout) | 10/60 | 3/60 |
| Sequential model calls per turn, all turns (mean / max) | 3.0 / 6 | **1.23** / 5 |
| Sequential model calls per turn, state turns (mean / p95 / max) | 3.5 / 5 / 6 | **1.0 / 1 / 1** |
| Raw wall clock, all turns (p50 / p95), **degraded network** | 46.3 s / 286 s | 15.9 s / 138 s |
| Clean estimate, state turn p50 (calls × per-call p50) | 5.1–6.9 s | **1.7–2.3 s** |
| Clean estimate, state turn p95 | 8.5–11.5 s (5 calls at per-call p50); up to 22–35 s | **4.5–6.9 s** (1 call at per-call p95) |
| Meets p95 < 8 s for state turns | **No** | **Yes** |

What the numbers show:

- **Both designs fix routing.** The previous baseline committed 1/20. In every state turn that did not fail, luna's Stage 1 picked `network` under both designs. A's 4 misses are all failed turns: A committed 32/32 of the state turns that did not fail. B's 2 misses were genuine: the model chose `NONE` and asked for a date ("until december", "from next monday until the 15th").
- **B is 1 call per state change. A is 3 calls, and sometimes 5–6.** A's calls are `HANDLE_RESPONSE` → `SET_STATE` → reply, plus a `REPLY` re-plan or a `DISCOVER_ACTIONS` hop. The reply step after an action is inherent to the planner path. That is why A cannot meet p95 < 8 s even when the network is clean.
- **B is less accurate on the state value.** 6 of its 8 wrong-state commits were "busy" messages stored as `paused` ("hold off on new intros", "go easy on the intros"). A got 1 such case wrong. The fix is a prompt change: busy = keep membership and hold new intros; paused = stop all outreach. It can also be handled by treating `busy` and `paused` the same for intro gating.
- **Same false commit in both designs.** On `my friend said "pause all your intros" but I'm good, keep them coming`, both designs ran SET_STATE `open` on a member who was already `open`. Nothing changed, but an event row was written. B's authz correctly accepted this, because "keep them coming" is the member's own words. Making a SET_STATE that leaves the state unchanged write no event would remove it.
- **B's replies need grounding work.** B uses the model's Stage-1 `replyText` after a successful commit. These replies are sometimes in the future tense ("I'll pause…") or ask a follow-up question even though the change was already applied ("how long would you like me to pause introductions for?"). Two options: always use the deterministic confirmation built from the execution result, or use the model text only when it does not ask a question.
- **Controls under B cost the same as before.** Non-state turns route as they did without the plugin, mostly 1 call. Planner-bound controls, such as the relay to Sam or the climbing-partner search, take 3–5 calls under both designs.

### Recommendation: design B, now the default

`NETWORK_DEFAULT_ROUTING = "structured"` in `run-shared-agent-turn.ts`.

- It is the only design whose state-change path fits the p95 < 8 s target, because a state change is one model call.
- It has a commit rate equal to or better than A's.
- Deterministic, ported authz decides every write; the model only proposes.

Design A stays selectable per turn (`execution.network.routing = "planner"`) for comparison.

Follow-ups before production. These are plugin-side; the plugin is moving to the thenetwork repo, so they were not made here:

1. Separate busy from paused in the `networkAction` prompt.
2. Use the deterministic confirmation, or reject a model reply that is phrased as a question, after an applied change.
3. Make a SET_STATE that leaves the state unchanged write no event.
4. Re-run this eval on a clean network to replace the estimated latency with a measured one.

**To reproduce.** From `packages/cloud/api`, source `thenetwork-poc/.env`, then run:

```
NETWORK_LIVE_MODEL_URL=$SURPLUS_BASE_URL NETWORK_LIVE_MODEL_ID=gpt-6-luna NETWORK_LIVE_MODEL_KEY=$SURPLUS_API_KEY \
NETWORK_LIVE_DESIGNS=structured NETWORK_LIVE_RUNS=1 NETWORK_LIVE_FIRST_RUN=1 NETWORK_LIVE_OUT=/tmp/eval.jsonl \
bun test __tests__/shared-eliza-runtime.miniflare.test.ts -t LIVE
```

Use `NETWORK_LIVE_DESIGNS=planner` for design A. The key is never logged.

### Tests after this pass (HEAD `80ae1aa`)

| Suite | Result |
|---|---|
| `plugins/plugin-network` (vitest) | 18 / 18; `tsc` clean |
| `cloud/shared` network and shared-runtime tests | 27 pass / 0 fail (8 files), including the design A trigger tests |
| `cloud/shared` `tsc` | clean |
| `cloud/api` `typecheck` (`tsc`, router contract with 767 routes, worker bundle 27,845.77 KiB / 6,873.58 KiB gzip) | clean |
| `cloud/api` Workerd `shared-eliza-runtime.miniflare` | 12 pass, 2 skip (live), 0 fail. Includes the design B path (1 model call; the planner is skipped) and the design A must-call and `network` context assertions. |

## Design B re-run on a clean network, after the plugin fixes (2026-10-07)

Re-ran the live eval for design B only (`NETWORK_LIVE_DESIGNS=structured`, 2 runs × 30 messages, gpt-6-luna on Surplus). Surplus latency had recovered to 1-3.6 s per trivial call. The plugin now lives in `packages/plugin-network` with the eval fixes (busy vs paused correction, executed-confirmation replies, no-op state changes). Per-turn rows: [routing-eval-clean.jsonl](routing-eval-clean.jsonl).

| | Degraded run, before fixes | Clean run, after fixes |
|---|---|---|
| Commit rate on state messages | 38/40 | **39/40** |
| Correct state stored | 32/40 | **39/40** |
| False commits on controls | 1/20 | **0/20** |
| Failed turns | 3/60 | **0/60** |
| Model calls per state turn (mean / max) | 1.0 / 1 | 1.0 / 1 |
| State-turn latency p50 / p95, measured | (degraded) | **2.0 s / 6.4 s**, so the p95 < 8 s target is met |
| All-turn latency p50 / p95 | (degraded) | 2.5 s / 7.1 s |

- Every committed reply is now the deterministic past-tense confirmation, for example "Done: your Network intros are paused until Oct 20."
- **Remaining miss: future travel.** "I'll be in London from next monday until the 15th" got a clarifying question instead of a commit, in one run. The state model has an end date (`until`) but no start date, so travel that starts later can't be represented. Follow-up: add a start date to SET_STATE (`from`) and to the store, so presence becomes a window (PRD 16.1-16.3, ME-011).

## Final live eval: presence windows, deterministic dates, date guards (2026-10-07)

Design B, 3 runs × 30 messages, gpt-6-luna on Surplus ([routing-eval-final.jsonl](routing-eval-final.jsonl)). Plugin changes since the previous run:
- **Presence windows:** SET_STATE carries a start date (`from`), so future travel is stored.
- **Dates resolved in code:** dates the member states are resolved by `packages/plugin-network/src/routing/dates.ts` and override the model's. An intermediate run showed luna often leaves `until` empty, even for "until November 3".
- **Date guards:** a non-open state is never written without the end date the member stated, or with dates that contradict their words. The agent asks a specific question instead.

| | First live run (Eliza planner, before this work) | Final |
|---|---|---|
| State changes committed | 1/20 | **58/60** |
| Committed with the correct state and correct dates | n/a | **58/60** |
| False commits on control messages | n/a | **0/30** |
| Model calls per state change | up to 7 | **1** |
| State-turn latency p50 / p95 | n/a | **2.4 s / 6.7 s** (target p95 < 8 s) |

- Every date the members stated was stored exactly. For example, "until after new years" was stored as Jan 2, "back on the 12th" as Oct 12, and "all next week" as Oct 12-18.
- **The two misses were turns where the model did not propose a state change** ("until december" got a question about which day; "only ping me if it's really good" got an acknowledgement). Code cannot act on a change the model never proposed, so these need a better prompt or examples from pilot transcripts.
- **All-turn p95 is 13.5 s.** That figure is driven by non-Network control messages going through Eliza's general planner (up to 6 calls). It is Eliza's ordinary chat latency, not the Network state path.

Intermediate runs, kept for reference:
- [routing-eval-windows.jsonl](routing-eval-windows.jsonl): presence windows only, 36/40.
- [routing-eval-dates.jsonl](routing-eval-dates.jsonl): plus the prompt's date rules, 38/40, but some commits dropped the end date the member gave.
