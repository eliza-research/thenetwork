# The Network on elizaOS v3: integration research

Status: research draft, 2026-10-05. Sources: elizaOS monorepo at `/Users/shawwalters/v3` (branch `shaw/mega-refactor`, HEAD `6c6fddb6f65e`, working tree read as-is), the recovered homepage at `reference/eliza-homepage/` (see its `RECOVERED.md`), and PRD sections 22, 30, 31, 32 and 35 (`docs/prd-snapshot.md`).

Path convention: paths starting `cloud/` mean `/Users/shawwalters/v3/packages/cloud/`. Other monorepo paths are given from the repo root (`packages/...`, `plugins/...`).

---

## 0. Summary

- **The shared agent has one hard-coded per-turn plugin list.** It is in `cloud/shared/src/lib/services/shared-runtime/shared-eliza-runtime.ts:300-308`. There is no plugin registry and no env var that selects a character. Every personal (phone, Telegram or Discord) user gets the same default Eliza persona from `personalSharedAgent()`. The Network needs code changes in three places:
  - the plugin list;
  - the character projection;
  - the agent and room identity, so that a member's Network conversation does not share a Durable Object with their Eliza conversation.
- **Inbound iMessage/SMS needs no new adapter.** The flow is: Blooio or Twilio, then the Railway `gateway-webhook`, then `POST /api/internal/eliza-app/personal-shared/messages`, then the `SharedRuntimeConversation` Durable Object.
  - The gateway is already multi-project. `/webhook/:project/:platform`, together with `getProjectEnv(project, key)`, reads env vars named `<PROJECT>_<KEY>`.
  - The `project` value is passed through to the Cloud route. A `network` project with its own Blooio/Twilio numbers can therefore reuse the whole path, branching on `project === "network"`.
- **Proactive outbound exists only for Blooio and Telegram.** It goes through `POST /internal/deliver` on the gateway, which has Redis idempotency.
  - There is no Twilio proactive path.
  - There is no STOP/HELP handling anywhere.
  - Proactive sends are not written into the conversation history.
  - All three gaps must be built for PRD 32.2 and 32.9.
- **API routes are file-based, with a codegen step.** Cron is a fan-out table. Both are straightforward to extend:
  - Add `cloud/api/network/**/route.ts`, then run `codegen`.
  - Add a path to `CRON_FANOUT["* * * * *"]`.
  - Admin uses `requireAdmin` (`super_admin | moderator | viewer`), which is platform-wide. Network staff roles (PRD 35.1) need their own table.
- **DB:** no Drizzle `pgSchema` is used anywhere yet. The migration runner is hard-wired to one folder and one ledger. A `network` schema needs:
  - its own drizzle config;
  - its own migrations folder;
  - its own ledger and runner (small).
- **The core `jobs` table does not fit Network jobs.** It requires `organization_id NOT NULL`, which is why `network.jobs` (PRD 32.18) is a separate table.
- **The recovered homepage is mainly useful for UX patterns, not code.** In particular:
  - the phone-number input;
  - the "text this number" onboarding;
  - the continuation-link flow for platform-originated users;
  - the Bearer-token API client.

  The live auth surface (Steward phone OTP, email magic link, passkey) and `AdminGate` now live in `packages/ui/src/cloud/**`. They are what The Network's member pages and admin console should build on.

---

## 1. Recovered homepage (`reference/eliza-homepage/`)

Source: `packages/homepage` at commit `79a3b55c2d56` (2026-09-23). This is the newest commit in any ref that touches the package. It was deleted on mainline in `fa9d46be538d` ("refactor bigtime"). It was already an embedded source module of `packages/app`, which is the single Cloudflare Pages artifact `eliza-app` serving `eliza.app` and `cloud.eliza.app`. MIT license.

On GitHub, the `elizaOS` org also has older standalone repos: `website` (last updated 2026-05-03), `eliza-app` (2026-05-03), `eliza-website-v2` (2026-02) and `home` (2024). All of them are older than the monorepo package, so they were not used.

### 1.1 Authentication
- **Session:** an opaque eliza-app session token is kept in `localStorage["eliza_app_session"]` and sent as `Authorization: Bearer`.
  - Code: `src/lib/api/client.ts` (`elizacloudFetch`, `elizacloudAuthFetch`, 15 s timeout).
  - Server side: `cloud/shared/src/lib/services/eliza-app/session-service.ts`. This is a separate JWT from Steward.
- **Login methods** (`src/lib/context/auth-context.tsx`, `src/pages/get-started.tsx`):
  - Telegram login widget: `POST /api/eliza-app/auth/telegram`, which also carries `phone_number` and an optional `onboarding_session`.
  - Discord OAuth code: `POST /api/eliza-app/auth/discord`.
  - WhatsApp: `POST /api/eliza-app/auth/whatsapp`.
  - Sign-In-With-Solana: `GET /api/auth/siws/nonce`, then `POST /api/auth/siws/verify`, in `src/lib/api/siws.ts`.
- **What the homepage does not have:** web SMS OTP and magic links. iMessage/SMS users never sign in on the web. The `IMESSAGE_DIRECT` step just says "text this number" (`sms:` deep link via `src/lib/contact.ts`). On the server, the first inbound message counts as proof of possession of the phone.
- **Phone linking:**
  - `POST /api/eliza-app/user/phone` (the "Almost there! Enter your phone number to enable iMessage" step). The server stores it as verified **without an OTP**. See §3f; this is a risk.
  - `src/components/login/phone-number-input.tsx` is a reusable E.164 input with a country picker (libphonenumber-js).
- **Today's real web login:** `packages/ui/src/cloud/public-pages/pages/login/steward-login-section.tsx`. It offers:
  - Steward **phone OTP**, shown when Steward advertises `sms`;
  - **email magic link**;
  - passkey, OAuth, Telegram and wallets.

  Server side, `POST /api/auth/steward-session` with a `verifiedPhone` hint calls `syncUserFromSteward`. This is the closest existing primitive to PRD 32.17's "magic-link login via SMS".

### 1.2 APIs called (all on `api.eliza.app`)
| Route | Purpose | Server file (still present) |
|---|---|---|
| `GET /api/eliza-app/user/me` | user + organization | `cloud/api/eliza-app/user/me/route.ts` |
| `POST /api/eliza-app/user/phone` | link phone | `cloud/api/eliza-app/user/phone/route.ts` |
| `POST /api/eliza-app/auth/{telegram,discord,whatsapp}` | login/link | `cloud/api/eliza-app/auth/*` |
| `GET/POST /api/eliza-app/onboarding/chat` | continuation preview, confirm link, onboarding chat turns and polling | `cloud/api/eliza-app/onboarding/chat/route.ts` |
| `GET /api/eliza-app/provisioning-agent`, `POST .../chat` | legacy dedicated-agent provisioning chat | `cloud/api/eliza-app/provisioning-agent/**` |
| `/api/auth/siws/*` | Solana sign-in | `cloud/api/auth/siws/*` |

### 1.3 Embedded chat
- No live agent chat widget is embedded.
- The landing page plays a scripted demo (`src/lib/landing-demo.ts`, `src/components/landing-demo-card.tsx`, attachment cards for place, itinerary, task list and handoff).
- The only real chat is the **onboarding/provisioning chat**, `src/lib/hooks/use-eliza-app-provisioning-chat.ts`:
  - It POSTs turns to `/api/eliza-app/onboarding/chat` with a `sessionId`.
  - It polls the same route for provisioning status.
  - It hands off to a dedicated agent `bridgeUrl` when that is running.

### 1.4 Onboarding and continuation
- `/get-started?onboardingSession=<id>`: a user who started in a messaging app (Discord, Telegram, or an SMS link) lands on the web with a continuation id.
- `src/lib/onboarding-continuation.ts` (pure function) and the `ContinuationLinkStep` in `get-started.tsx` then run:
  1. a read-only preview;
  2. explicit confirmation (`confirmPlatformLink: true`);
  3. a "go back to your chat" terminal state.
- Phone-originated sessions fail the preview with 403/404 and fall back to chat.

**For the Network:** this is the right pattern for "the agent texts you a link to see your profile". The difference is that the link should log the member in (a signed, single-use token bound to the phone), not ask them to link accounts.

### 1.5 Waitlist and invites
- The homepage has neither.
- Cloud has org invites: `packages/ui/src/cloud/public-pages/pages/invite/invite-accept-page.tsx` and `cloud/api/invites/*`. These are org-membership invites, not member invite tokens.
- The Network's invitation allowances and vouch capture (PRD 32.15) are new.

### 1.6 Deployment
- No deploy step of its own. `packages/app` imports `embedded-home` and `embedded-downloads`.
- `.github/workflows/cloud-cf-deploy.yml` deploys the single artifact to the Pages project `eliza-app`.
- `wrangler-aasa.toml` and `edge/` hold an exact-path Worker for Apple's `apple-app-site-association`.
- Domains are listed in `@elizaos/shared/brand` `EXTERNAL_URLS`.

### 1.7 Design system
- Tailwind v4. `src/index.css` imports `packages/ui/src/styles/{base,tailwind-theme,shadcn-utilities}.css`.
- Geist font and an orange brand accent.
- shadcn-style primitives from `@elizaos/ui/*`: button, input, card, dropdown-menu, native-dialog, native-select, textarea.
- `lucide-react` icons, a `cn()` util, i18n JSON in eight locales.
- Lazy WebGL `ShaderBackground` (react-three/fiber).
- Biome; Playwright visual regression.

### 1.8 Reuse for The Network
| Network need | Reuse | Source |
|---|---|---|
| Member web pages (PRD 32.17), mobile-first | Phone input, glass card layout, i18n, the `elizacloudAuthFetch`-style client, the continuation-link pattern | `reference/eliza-homepage/src/components/login/*`, `src/lib/api/client.ts`, `src/lib/onboarding-continuation.ts` |
| SMS login | Steward phone OTP and email magic-link UI | `packages/ui/src/cloud/public-pages/pages/login/steward-login-section.tsx`, `cloud/api/auth/steward-session/route.ts` |
| "Text the Network" CTA | `sms:` href builder, plus copy-number fallback on desktop | `reference/eliza-homepage/src/lib/contact.ts` |
| Admin console (PRD 35) | `AdminGate` + `useAdminGate` (HEAD probe reading `X-Is-Admin`/`X-Admin-Role`), admin page chrome, cloud route registry with the `"admin"` gate group | `packages/ui/src/cloud/admin/AdminGate.tsx`, `admin/data/use-admin-gate.ts`, `packages/ui/src/cloud/shell/cloud-route-registry.ts` |
| Demo and marketing | Scripted chat demo cards (illustrative only) | `src/lib/landing-demo.ts`, `src/components/landing-demo-card.tsx` |

Recommendation: mount the member pages and the admin console as routes in `packages/app` / `packages/ui/src/cloud`, for example `/network/*` and `/cloud/admin/network/*`. That way they get Steward auth, `AdminGate` and the Pages deploy for free. Do not revive `packages/homepage` as a standalone app.

---

## 2. How the shared agent works today

Turn path for an inbound phone message:

```
Blooio/Twilio webhook
  -> cloud/api/eliza-app/webhook/{blooio,twilio}/route.ts   (thin forwarder, _forward.ts, stamps forwarder secret)
  -> Railway gateway-webhook  POST /webhook/:project/:platform   (cloud/services/gateway-webhook/src/index.ts)
       verify signature (adapters/blooio.ts:343 HMAC-SHA256; adapters/twilio.ts:193 HMAC-SHA1)
       Redis dedupe, immediate ACK, processMessage (webhook-handler.ts:807)
       LINK-XXXXXXXX code? -> identity-link confirm
       sendPersonalSharedReply -> POST {ELIZA_CLOUD_URL}/api/internal/eliza-app/personal-shared/messages
            body {platform, project, connectorAccountId, phoneNumber, messageId, message, mediaUrls?}
  -> cloud/api/internal/eliza-app/personal-shared/messages/route.ts
       requireInternalAuth (api/internal/_auth.ts)
       resolvePersonalDeliveryProjection -> elizaAppUserService.resolvePersonalDelivery / findOrCreateByPhone
       personalSharedAgent({userId, organizationId})  -> id "personal:<uuidv5(org:user)>"
       sharedRestMessageSend -> coordinateSharedBridge -> SharedRuntimeConversation DO ("<agentId>:<room>")
  -> DO: load history, admitTurn (credits), runSharedAgentTurn
       shared-eliza-runtime.ts executeMeasuredSharedElizaRuntimeTurn():
         in-memory SQLite adapter, new AgentRuntime({character, plugins:[...]}), replay history,
         messageService.handleMessage, stop/close
       mergeHistory -> mirror to Postgres shared_runtime_history (alarm retries)
  -> reply returned to gateway -> adapter.sendReplyWithReceipt (Blooio /v4/messages with Idempotency-Key; Twilio Messages.json, no idempotency)
```

Key files:
- **Runtime:** `cloud/shared/src/lib/services/shared-runtime/shared-eliza-runtime.ts`
  - `createRuntime` 257-311
  - plugin list 300-308
  - action-registration check 851-898; system turns must register zero actions
- **Turn input and system prompt:** `run-shared-agent-turn.ts`
  - `RunSharedAgentTurnInput.execution` around line 175
  - `buildSharedRuntimeSystem` 346
- **Execution authority:** `shared-runtime-chat.ts`
  - `sharedElizaRuntimeExecution` 578
  - `characterFor` 892; reads from the DO cache only, returns a retryable 503 on a cold cache when `character_id` is set
  - `bridge` 1320
- **Character:**
  - `personal-shared-agent.ts:133`, which always uses `getDefaultElizaCharacterData()`
  - `shared-agent-character.ts:89` (`projectSharedAgentCharacter`)
  - `cloud/shared/src/lib/utils/cloud-eliza-persona.ts`
- **Agent id:** `personal-shared-identity.ts:15`: `personal:` + `uuidv5(org:user)`
- **Durable Object:** `cloud/api/src/shared-runtime-conversation.ts`
  - binding `SHARED_RUNTIME_CONVERSATIONS` in `cloud/api/wrangler.toml`
- **Capability catalog and wall:**
  - `shared-capability-catalog.ts:15` (`SharedCapabilityFlags`)
  - `shared-capability-wall.ts`, which can pre-block intents such as "message someone" before the model runs. **This matters for RELAY_MESSAGE.**

`packages/agent` (`@elizaos/agent`) is the standalone agent host and HTTP server used for dedicated/local agents. The shared Cloud agent does **not** run through it; it composes `@elizaos/core` + plugins directly inside the Worker. Network code should therefore target the edge-safe plugin shape, not `packages/agent` APIs.

---

## 3. Integration points

### (a) Adding a Network plugin to the shared agent
1. Create `plugins/plugin-network/`, modelled on `plugins/plugin-form` and `plugins/plugin-todos`. It exports `createNetworkEdgePlugin(deps)`, which returns a `Plugin` containing:
   - **Providers:** `MEMBER_CONTEXT`, `ACTIVE_ITEMS`, `CITY_CONTEXT`.
   - **Actions:** `UPDATE_PROFILE`, `MANAGE_INTENT`, `RESPOND_TO_OPPORTUNITY`, `RELAY_MESSAGE`, `SCHEDULE`, `SET_STATE`, `BLOCK_OR_REPORT`, `GIVE_FEEDBACK`, `CONCIERGE_SEARCH`, and so on.
   - **Evaluators:** extraction and safety signals.
2. Respect the Worker constraints:
   - The runtime DB is in-memory and thrown away each turn, with `skipMigrations: true`, so the plugin must keep **no state of its own**.
   - All reads and writes go through an injected `NetworkClient`. This is either an HTTP client to `/api/network/*` or a direct service object, because the code already runs inside the Cloud Worker.
   - Follow the injected-store pattern of `createSharedTodoStore` and `createSharedScheduledTaskRunner`.
3. Wire it into `cloud/shared/src/lib/services/shared-runtime/shared-eliza-runtime.ts`:
   - Add an `options.networkPlugin` field.
   - Add `...(options.actionsEnabled && options.networkPlugin ? [options.networkPlugin] : [])` to the list.
   - Update the expected-action check at lines 851-898.
4. Thread the authority through to the runtime:
   - Add `execution.network` (`memberId`, `city`, `project`) to `RunSharedAgentTurnInput.execution` (`run-shared-agent-turn.ts`).
   - Set it in `sharedElizaRuntimeExecution` (`shared-runtime-chat.ts:578`) only when the turn's project is `network`.
5. Make the capabilities visible to the model:
   - Add Network capability flags to `shared-capability-catalog.ts` and `buildSharedRuntimeSystem`.
   - Allow-list Network relay intents in `shared-capability-wall.ts`.
6. Choose the character:
   - In `personal-shared-agent.ts`, add `networkSharedAgent(identity)`, returning `agent_config: { character: networkCharacter }` **inline**. Do not use `character_id`; that avoids the cold-cache 503.
   - Give it a **distinct id namespace**, for example `network:<uuidv5(org:user)>` with its own namespace UUID in `personal-shared-identity.ts`, so the Network has its own DO room and history. Also check every `isPersonalSharedAgentId` call site; there are prefix assumptions.
7. Add the dependency to `cloud/shared/package.json`. Optionally add the plugin to `prewarmSharedElizaRuntime` (line 319).

### (b) `/api/network/*` and admin routes
- **Routing:**
  - Drop `route.ts` files under `cloud/api/network/...` and `cloud/api/network/admin/...`. Each one is `new Hono<AppEnv>()` + `export default app` and must import from `"hono"`, or codegen fails.
  - Run `bun run --cwd packages/cloud/api codegen`. This regenerates `api/src/_router.generated.ts` and `_router-shard-keys.generated.ts`; `network` becomes its own shard automatically.
  - `typecheck` runs the router-contract check and a worker-bundle check.
- **Auth:** helpers in `cloud/shared/src/lib/auth/workers-hono-auth.ts`:
  - `requireUser` (304)
  - `requireUserWithOrg` (311)
  - `requireUserOrApiKeyWithOrg` (644)
  - `requireAdmin` (700), which returns `{user, role}`; roles come from `cloud/shared/src/lib/services/admin.ts` (verified `@elizalabs.ai` email means super_admin, otherwise the `admin_users` wallet table)
  - `requireCronSecret` (732)
  - The global gate is `cloud/api/src/middleware/auth.ts`; `publicPathPrefixes` is at line 30. Do not add `/api/network` to it.
- **Validation and errors:** Zod `safeParse` by hand, plus `failureResponse` and `ApiError`/`ForbiddenError` from `cloud/shared/src/lib/api/cloud-worker-errors`. Reference route: `cloud/api/v1/approval-requests/route.ts`.
- **Rate limiting:** `rateLimit(RateLimitPresets.STANDARD)` from `cloud/shared/src/lib/middleware/rate-limit-hono-cloudflare.ts`.
- **Network roles (new):** add `network.staff_roles` (`user_id`, `role` in admin/reviewer/safety/analyst/engineer, `granted_by`) and a `requireNetworkRole(c, ...roles)` helper. The helper should:
  - call `requireUser`;
  - look up the role, with `requireAdmin` super_admin as a fallback;
  - write an audit event.

  Put it in `cloud/shared/src/lib/network/auth.ts`.
- **Frontend gate:** add a `HEAD /api/network/admin/whoami` that returns `X-Network-Role`, and a `NetworkAdminGate` cloned from `packages/ui/src/cloud/admin/AdminGate.tsx`.
- **Agent-to-API calls:** the Network plugin runs inside the same Worker. Call the domain services directly, which avoids an HTTP hop and an auth token. Expose HTTP only for web, admin and the matcher.

### (c) Cron fan-out and a Railway worker
- **Cron:**
  - Add `cloud/api/cron/network-tick/route.ts`. It handles `app.post("/", ...)`, calls `requireCronSecret`, and does bounded work: claim due `network.jobs` with `FOR UPDATE SKIP LOCKED` plus a lease, run them, and stop at a time budget.
  - Register it in `CRON_FANOUT["* * * * *"]` in `cloud/shared/src/lib/cron/cloudflare-cron.ts` (list starts at line 79). Optionally add it to `FAILURE_REPORTED_CRON_PATHS` (line 146). No `wrangler.toml` change is needed, because the every-minute schedule already exists.
  - Routes must accept POST.
  - Locally, trigger it with `curl -XPOST localhost:8787/api/cron/network-tick -H "x-cron-secret: $CRON_SECRET"`, taking the secret from `api/.dev.vars`.
- **Lease pattern to copy:**
  - `cloud/shared/src/db/repositories/jobs.ts`: `claimPendingJobs` 810, `renewExecutionLease` 968, `assertExecutionLease` 1019.
  - The schema is `cloud/shared/src/db/schemas/jobs.ts`, but it requires `organization_id`, so use `network.jobs` instead.
  - The Redis queue (`cloud/shared/src/lib/queue/redis-queue.ts`, with a DLQ) is optional.
  - DO alarms are an option for per-opportunity timers, but `due_at` rows fit the SimClock requirement (PRD 32.18) better.
- **Railway worker `network-matcher`:**
  - New folder `cloud/services/network-matcher/`; the workspace glob already picks it up.
  - `package.json` depends on `@elizaos/cloud-shared` (workspace) and imports `dbWrite` from `@elizaos/cloud-shared/db/client`, which reads `DATABASE_URL` outside Workers.
  - Run a `Bun.serve` `/health` endpoint plus a tick loop with `pg_try_advisory_lock`.
  - The template for a DB-backed Bun service is `cloud/services/container-control-plane`.
  - Copy the Dockerfile and `railway.toml` from `cloud/services/gateway-webhook/`, but use the multi-package source-copy approach of `cloud/services/agent-server/Dockerfile`, because cloud-shared pulls in many workspaces.
  - Clone the deploy workflow from `.github/workflows/deploy-gateway-webhook.yml`.
  - **Note:** no existing Railway service reads the cloud DB today, so this is new ground (Docker image size, connection limits).

### (d) Inbound messages and proactive outbound
**Inbound, with dedicated Network numbers:**
- Point the Network Blooio/Twilio webhooks straight at `https://<gateway>/webhook/network/{blooio,twilio}`.
- Configure gateway env with the `NETWORK_` prefix, read by `cloud/services/gateway-webhook/src/project-config.ts:120` (`getProjectEnv`): `NETWORK_BLOOIO_API_KEY`, `NETWORK_BLOOIO_PHONE_NUMBER`, `NETWORK_BLOOIO_WEBHOOK_SECRET`, `NETWORK_TWILIO_*`.
- Confirm in `webhook-handler.ts:840-919` that the personal-transport branch runs for non-`eliza-app` projects. The Telegram branch and the forwarder-secret gate are tied to `ELIZA_APP_WEBHOOK_PROJECT`; check `isPersonalElizaTransport` too.
- In `cloud/api/internal/eliza-app/personal-shared/messages/route.ts`, branch on `parsed.data.project === "network"`. The agent is built around line 1357.
  - Resolve the member (`network.channel_identities` → `members.cloud_user_id`).
  - Reject non-members with a canned invite-only reply, before spending a model turn.
  - Use `networkSharedAgent(...)` and set `execution.network`.
  - Skip the Dedicated-agent bridge (line 1697) for Network turns.
- A cleaner long-term option is a sibling route, `cloud/api/internal/network/messages/route.ts`, that reuses the same helpers.

**Proactive outbound:**
- **What exists:** gateway `POST /internal/deliver` (`cloud/services/gateway-webhook/src/internal-delivery.ts:164`).
  - Header `X-Internal-Secret: GATEWAY_INTERNAL_SECRET`.
  - Body `{platform:"blooio", project:"network", phoneNumber, text<=2000, idempotencyKey}`.
  - Redis three-state idempotency with a 14-day TTL. A 202 response with `acceptance:"unknown"` means indeterminate.
  - The caller to copy is `sharedReminderDispatcher` in `cloud/shared/src/lib/services/shared-runtime/shared-reminder-cron.ts:181` (POST at 263-283; response mapping to ok/rate_limited/auth_expired/transport_error).
- **To build (Network outbound service, `cloud/shared/src/lib/network/outbound.ts`):**
  1. Twilio in `/internal/deliver`: a branch in `parseDelivery` (89-162), adapter selection (319-320), an idempotency/dedupe key, and typed error classification.
  2. A `network.outbound_messages` row written **before** the send. The idempotency key is derived from `(opportunity, member, template, attempt)`. Provider id and status are stored, and delivery-receipt webhooks update it.
  3. **History append:** proactive sends are not written into the DO history today. Without that, the agent will not know what it just sent when the member replies "yes". Add a `push-message`-style operation to `SharedRuntimeConversation`, or reuse `coordinateSharedLifecycleEvent` (`conversation-coordinator.ts:179`, used by voice), so the invitation becomes an assistant turn in the member's Network room.
  4. STOP/HELP/START handling. Nothing exists today. Handle it in the gateway, before the agent, for the `network` project, and record opt-out in `network.preferences`.
- `core` `sendMessageToTarget` (`packages/core/src/runtime.ts:5766`) does **not** work in the shared runtime, because no connector send handlers are registered there.

### (e) Drizzle schema and migrations in a `network` Postgres schema
1. `cloud/shared/src/db/network/schema.ts`:
   - `export const network = pgSchema("network")`, then `network.table(...)` for members, channel_identities, staff_roles, facets, intents, presence, preferences, edges, opportunities, participations, threads, thread_messages, outbound_messages, review_items, jobs, events, audit.
   - Columns: `vector(...)` with HNSW indexes (`index().using("hnsw", t.embedding.op("vector_cosine_ops"))`), and H3 cells as `text` or `bigint`.
2. `cloud/shared/drizzle.network.config.ts`: `schema: ./src/db/network/schema.ts`, `out: ./src/db/network-migrations`, `schemaFilter: ["network"]`.
   - Add `schemaFilter: ["public"]` to the existing `cloud/shared/drizzle.config.ts`, or keep the network schema out of `schemas/index.ts`.
   - Script: `db:network:generate`.
3. **Runner.** The existing one (`scripts/admin/migrate-with-diagnostics.ts` + `canonical-migration-ledger.ts`) is fixed to one folder and the `drizzle.__drizzle_migrations` ledger. Add `scripts/admin/migrate-network.ts` using drizzle-orm `migrate(db, {migrationsFolder, migrationsTable:"__network_migrations", migrationsSchema:"network"})` behind an advisory lock.
   - Call it after `db:cloud:migrate` in `.github/workflows/cloud-cf-release.yml` (around 835) and `cloud-deploy-backend.yml` (around 113).
   - Call it from `scripts/admin/dev/cloud-api-dev.ts` so local PGlite gets it too.
   - The first migration is `CREATE SCHEMA IF NOT EXISTS network;`. The `vector` extension already exists in public.
4. **Access:**
   - Plain query builder: `dbWrite.select().from(network.members)`.
   - Or a dedicated `drizzle(conn, {schema: networkSchema})` for relational queries.
   - Workers go through Hyperdrive automatically (`cloud/shared/src/db/client.ts`, around 249-275).
5. **Separate DB roles (PRD 31.4)** are not used anywhere today. Hyperdrive uses one role, so a `network_rw` role would need its own Hyperdrive config. Defer this to after the spike.

### (f) Identity
- **Tables:**
  - `user_identities` (`cloud/shared/src/db/schemas/user-identities.ts`): unique `phone_number`, `phone_verified`, `telegram_id`, `discord_id`, `whatsapp_id`, `steward_user_id`.
  - `users`: also phone columns, encrypted phone, `phone_blind_index`.
  - `identity_link_codes`: `LINK-XXXXXXXX`, 10-minute TTL.
  - `identity_links`.
- **Phone → Cloud user:** `elizaAppUserService.resolvePersonalDelivery` (`cloud/shared/src/lib/services/eliza-app/user-service.ts:224`) → `findOrCreateByPhone` (542) → `usersRepository.findOrCreatePhonePersonalAccount` (`cloud/shared/src/db/repositories/users.ts:1730`). The first inbound message **creates a user and a $0 org**, marked phone-verified.
- **Verification flows:**
  - Steward SMS OTP: `POST /api/auth/steward-session` with `verifiedPhone` (`cloud/api/auth/steward-session/route.ts`); `verifyStewardBearerPhone` in `cloud/shared/src/lib/services/steward-client.ts:131`.
  - Messaging possession: inbound message.
  - Identity-link codes: `/api/eliza-app/identity-link/{start,confirm}`, plus gateway `tryConfirmIdentityLink`.
  - `POST /api/eliza-app/user/phone` stores the phone as verified **without OTP**.
- **Network mapping:** `network.members.cloud_user_id` → `users.id`, and `network.channel_identities(channel, address, verified_at)`.
  - Create a member only from a valid invite token, or from an inbound number on an allowlist or pending invite. Do not trust `findOrCreateByPhone` alone; it creates a Cloud user for any texter.
  - Member web login: the Steward phone OTP. Also add a Network "magic link via SMS": the agent sends a signed single-use URL (the `/get-started?onboardingSession=` continuation pattern), and redeeming it mints a Steward or eliza-app session for that `cloud_user_id`.
- The identity-cluster merge engine (`plugins/plugin-sql/src/services/sql-principal.ts`) is **not active** in shared turns (in-memory SQLite), so do not rely on it.

### (g) Local dev and staging
- **API:** `bun run --cwd packages/cloud/api dev` (`scripts/admin/dev/cloud-api-dev.ts`). It:
  - starts a PGlite TCP bridge on `127.0.0.1:55432` when `DATABASE_URL` is unset;
  - runs migrations;
  - writes `api/.dev.vars` (from `cloud/shared/.env.example`, with generated secrets including `CRON_SECRET`);
  - starts `wrangler dev --local --port 8787`.
- **Other entry points:**
  - `bun run dev:cloud` (API + app).
  - `bun run cloud:mock` (`packages/scripts/cloud/mock-stack-up.ts`, with MOCK_REDIS + PGlite).
  - `scripts/admin/dev/cloud-api-hono-dev.ts` (Bun, no wrangler).
- **Mocks:** `cloud/test-mocks/` (steward, stripe, hetzner, control-plane, provider-contract, synthetic-environment; Mockoon JSON).
- **Gateway:** run `cloud/services/gateway-webhook` locally with `ELIZA_CLOUD_URL=http://127.0.0.1:8787` and test signing secrets. Alternatively, skip it and POST straight to the internal personal-shared route with `INTERNAL_SECRET`.
- **Model:** the shared turn uses a Cerebras handler. Setting `ELIZAOS_CLOUD_SMALL_MODEL` and the Cerebras key in `.dev.vars` lines up with this repo's Cerebras setup.
- **Tests:**
  - `bun run --cwd packages/cloud/api test`. Suffixes: `*.pglite.test.ts`, `*.miniflare.test.ts`, `*.integration.test.ts`.
  - E2E batches in `cloud/api/test/e2e`.
  - `bun run --cwd packages/cloud/shared test`.
- **Staging:** `[env.staging]` in `cloud/api/wrangler.toml` (Worker `eliza-cloud-api-staging`, `api-staging.eliza.app`, Hyperdrive at lines 764-766). Every binding is repeated per environment. Railway has staging environments for the gateway.

### (h) MCP server with OAuth
- **What exists:**
  - `/api/mcp` (`cloud/api/mcp/route.ts`, streamable HTTP, tools in `cloud/shared/src/lib/mcp/platform-cloud-tools.ts`).
  - Per-integration `/api/mcps/<name>/[transport]`.
  - Auth is API key or Steward JWT, checked per tool. API keys have no scopes and no audience.
  - An OIDC provider: `cloud/api/oidc/{authorize,token,userinfo}`, `/.well-known/openid-configuration`, `cloud/shared/src/lib/oidc/*`. It supports confidential clients only, from the `OIDC_CLIENTS` secret, with PKCE. It has no DCR, no refresh, no consent and no public clients.
- **What OAuth 2.1 for MCP clients (ChatGPT/Claude connectors) needs:**
  1. `/.well-known/oauth-protected-resource` for `/api/network/mcp`.
  2. `/.well-known/oauth-authorization-server` metadata, mounted in `cloud/api/src/bootstrap-app.ts` around 450-459 and allow-listed in `isFrontendAliasBackendPath` (`cloud/api/src/index.ts` around 882-895).
  3. Dynamic client registration (RFC 7591) with a new `oauth_clients` table; public clients and loopback redirects.
  4. `/authorize` and `/token` support for public clients, the `resource` parameter (RFC 8707) as `aud`, refresh tokens with rotation (new table), and a **consent screen** that shows Network scopes.
  5. A Network MCP route that validates OIDC access tokens (`verifyOidcAccessToken` in `cloud/shared/src/lib/oidc/tokens.ts`), checks `aud` and scopes, and returns 401 with `WWW-Authenticate: Bearer resource_metadata=...`.
  6. The four connector tools (PRD 11.2) implemented on the same Network domain services, enforcing SEC-003.
- This is post-MVP (PRD 28.4), but the domain services should be designed so that MCP is just another caller.

---

## 4. Recommended integration plan (files to add or modify in the eliza repo)

**Add:**
| Path | What |
|---|---|
| `plugins/plugin-network/` | Edge-safe plugin: providers, actions, evaluators; `createNetworkEdgePlugin({client, clock})` |
| `packages/network/` (or `packages/cloud/shared/src/lib/network/`) | Domain services (members, profile, intents, opportunities with transition table, consent, relay, outreach, review, events), Clock (port `@thenetwork/core` clock), leak checker, network character JSON |
| `packages/cloud/shared/src/db/network/schema.ts` + `drizzle.network.config.ts` + `src/db/network-migrations/` | `network` pgSchema |
| `scripts/admin/migrate-network.ts` | Separate ledger and runner |
| `packages/cloud/api/network/**/route.ts` | Member API (`me`, `facets`, `intents`, `preferences`, `invites`, `history`, `export`, `delete`) |
| `packages/cloud/api/network/admin/**/route.ts` | Review queue, member 360, timeline, pipeline, metrics, config, audit (role-checked) |
| `packages/cloud/api/cron/network-tick/route.ts` | Job runner: due jobs, outreach, expiries |
| `packages/cloud/api/internal/network/messages/route.ts` (or a branch in the personal-shared route) | Inbound Network turns |
| `packages/cloud/services/network-matcher/` | Railway Bun worker (matcher, enrichment, simulation) |
| `packages/ui/src/cloud/network/**` + route registrations | Member pages (`/network/*`) and admin console (`/cloud/admin/network/*`) |

**Modify:**
| Path | Change |
|---|---|
| `cloud/shared/src/lib/services/shared-runtime/shared-eliza-runtime.ts` | `networkPlugin` option in the plugin list and the expected-action check |
| `.../run-shared-agent-turn.ts`, `.../shared-runtime-chat.ts` | `execution.network`; system-prompt section |
| `.../personal-shared-agent.ts`, `.../personal-shared-identity.ts` | `networkSharedAgent`, `network:` id namespace |
| `.../shared-capability-catalog.ts`, `.../shared-capability-wall.ts` | Network capabilities; allow relay intents |
| `cloud/shared/src/lib/cron/cloudflare-cron.ts` | Add `/api/cron/network-tick` to `* * * * *` |
| `cloud/services/gateway-webhook/src/internal-delivery.ts`, `adapters/twilio.ts`, `webhook-handler.ts` | Twilio proactive sends; STOP/HELP for `network`; project routing |
| `cloud/api/src/shared-runtime-conversation.ts` + `conversation-coordinator.ts` | Append proactive outbound to history |
| `cloud/shared/drizzle.config.ts` | `schemaFilter: ["public"]` |
| `.github/workflows/cloud-cf-release.yml`, `cloud-deploy-backend.yml`, `scripts/admin/dev/cloud-api-dev.ts` | Run network migrations |

---

## 5. Spike: "hello Network" locally

**Goal:** a text to a (simulated) Network number gets an answer from the Network character through the real shared runtime. The answer uses a `MEMBER_CONTEXT` from a stub Network API and can call one action (`UPDATE_PROFILE`) that writes to the stub. Everything runs locally, with PGlite and no real providers.

Do the work on a branch in a separate git worktree of the eliza repo. The `/Users/shawwalters/v3` checkout has uncommitted changes and is read-only for this research.

1. **Stub Network API** (in this repo: `prototypes/network-stub/`, Bun + Hono, port 8790):
   - `GET /members/by-phone/:e164` returns `{memberId, name, city, facets[], activeItems[]}` from a JSON fixture.
   - `POST /members/:id/facets` appends and returns the new facet.
   - `GET /health`.
   - It reads time from the `@thenetwork/core` `SimClock`/`RealClock`.
2. **Plugin skeleton** (`plugins/plugin-network/src/index.ts`, about 150 LOC):
   - `createNetworkEdgePlugin({ baseUrl, memberId })`.
   - Provider `MEMBER_CONTEXT`: fetches the member and renders a short shareable summary.
   - Action `UPDATE_PROFILE`: validates with Zod, POSTs the facet, and returns a brief for the LLM to phrase.
   - Unit test with a fake runtime.
3. **Character:** `network-character.ts`, with name "The Network", a short system prompt following the PRD 12.4 voice rules, and 3-5 message examples.
4. **Runtime wiring** (smallest diff):
   - In `shared-eliza-runtime.ts`, add the optional `networkPlugin` to the plugin list and allow its actions in the expected-action check.
   - In `personal-shared/messages/route.ts`, when `project === "network"` (or env `NETWORK_SPIKE=1`):
     - use `networkSharedAgent()` (inline character, `network:` id);
     - build `createNetworkEdgePlugin({ baseUrl: env.NETWORK_STUB_URL, memberId })`;
     - pass both through `execution`.
5. **Run:**
   - `bun run --cwd packages/cloud/api dev` (PGlite, wrangler on :8787). Put the Cerebras key, `NETWORK_STUB_URL=http://127.0.0.1:8790` and the model in `api/.dev.vars`.
   - Start the stub.
   - Drive a turn without the gateway:
     ```
     curl -XPOST localhost:8787/api/internal/eliza-app/personal-shared/messages \
       -H "Authorization: Bearer $INTERNAL_SECRET" -H 'content-type: application/json' \
       -d '{"platform":"blooio","project":"network","connectorAccountId":"spike","phoneNumber":"+15555550101","messageId":"blooio:network:1","message":"hey, I just moved to the Mission and want a climbing partner"}'
     ```
     `cloud/api/internal/_auth.ts` reads `Authorization: Bearer <INTERNAL_SECRET>`, so that header is correct.
   - **Expected:** a reply in the Network voice, a new facet in the stub, and a history row in `shared_runtime_history` for a `network:*` agent id. A second message should show the replayed history.
6. **Optional stretch:**
   - Run `gateway-webhook` locally with `NETWORK_BLOOIO_WEBHOOK_SECRET`, and POST a signed fake Blooio webhook to `/webhook/network/blooio`.
   - Add a `/api/cron/network-tick` that calls gateway `/internal/deliver` with a mocked Blooio API, to prove the proactive path and idempotency.
7. **Exit criteria:**
   - It answers in character.
   - Tool calls hit the stub.
   - It does not affect `eliza-app` personal turns (run the existing `shared-runtime` tests).
   - Turn latency and cost are recorded.

Rough size: 1-2 days for steps 1-5.

---

## 6. Risks

1. **Shared conversation identity.** `personalSharedAgentId` is per (org, user). Without a separate `network:` namespace, a member's Network and Eliza chats share one DO and one history. The `personal:` prefix is regex-checked (`isPersonalSharedAgentId`) in several places, so a new namespace may break assumptions in the personal route, push and delivery-projection code.
2. **Auto-account creation.** Any inbound text creates a Cloud user and a $0 org (`findOrCreatePhonePersonalAccount`). The invite-only gate must run before this, or the Network will pollute Cloud user tables and credit admission.
3. **Credits and billing.** `admitTurn` charges the user's org credits, and Network members have $0 orgs. The Network needs its own funding org, or a billing bypass for `project === "network"`.
4. **Unverified phone linking.** `POST /api/eliza-app/user/phone` marks a phone verified without OTP. Never use it for Network identity.
5. **Gaps in proactive messaging:**
   - no Twilio proactive path;
   - no STOP/HELP;
   - no history append;
   - Twilio replies have no idempotency.

   These are compliance-critical (10DLC) and correctness-critical (the agent misreads "yes").
6. **Hot-path coupling.**
   - The plugin runs inside a Durable Object with per-turn construction. Network providers that do slow DB queries add latency to every turn, so budget for it.
   - The DO cache-only character loading also returns 503s on a cold cache if `character_id` is used.
7. **Monorepo churn.** The repo is mid-"mega-refactor": the homepage was deleted on 2026-09-23 and the wrangler and code comments reference stale paths. Paths here may move. Pin a base commit for Network work and rebase often.
8. **Migrations.** There is a single-ledger runner, no pgSchema precedent, and hand-written SQL migrations. A second ledger adds deploy-order risk; network migrations must run after core migrations.
9. **No DB-backed Railway service exists.** The matcher image build and connection pooling are unproven. Prisma-style connection exhaustion on Railway Postgres is a risk at scale.
10. **Admin roles.** `requireAdmin` is platform-wide (elizalabs.ai email or wallet). Network reviewers must not get Cloud super_admin. The dev bypass makes every authed user an admin in `import.meta.env.DEV`.
11. **Capability wall.** The shared capability wall pre-blocks "message someone"-type intents. RELAY_MESSAGE needs an explicit exception, or it will silently never reach the model.
12. **Gateway project routing assumptions.** Several branches are keyed to `ELIZA_APP_WEBHOOK_PROJECT` (Telegram, the forwarder-secret gate). Verify the Blooio and Twilio personal branch for a second project end to end before committing to the shared gateway.

---

## 7. Open questions

1. **Repo location (PRD 36.10).** Should Network code live in the eliza monorepo (`plugins/plugin-network`, `packages/network`), or in this repo as packages consumed by Cloud? The shared runtime imports plugins at build time, so at minimum the plugin must be a dependency of `@elizaos/cloud-shared`.
2. **Agent identity.** Is a Network member's agent conversation fully separate from their Eliza conversation (recommended: `network:` namespace), or do members use one Eliza that has Network capabilities?
3. **Inbound route.** Should inbound use a separate internal route (`/api/internal/network/messages`), or a branch in the personal-shared route? Separate is cleaner, but it duplicates about 2k lines of delivery and credit logic.
4. **Funding.** Who pays for Network turns? Options are a Network org with pooled credits, a billing bypass, or per-member orgs.
5. **Senders.** Which numbers send? Blooio iMessage vs Twilio SMS per city, and whether Blooio can host a second project and number (PRD 32.2 decision).
6. **Web session for member pages.** Steward session (phone OTP) or eliza-app session JWT? `/api/network/*` must accept whichever one the member pages use. Steward is preferred for the admin console, which already uses it.
7. **Matcher in the DB.** Is a Railway service reading the primary DB acceptable, or should the matcher read a replica and write only through `/api/network/*`?
8. **Proactive message history.** Should proactive messages be appended into the agent history as assistant turns (recommended), or should the agent learn about them only from the `ACTIVE_ITEMS` provider?
9. **STOP/HELP placement.** Handle it at the gateway (all projects) or only for `network`? Should the Eliza product adopt it too?
10. **Simulation and turns.** Does the simulator (PRD 34.3) drive real shared-runtime turns through the internal route (realistic, slower, costly), or call the plugin with a fake runtime?
11. **Staff identity.** Do Network staff use Steward accounts with an `@elizalabs.ai` email, or separate staff identities?
