# The Network service (production runtime)

This folder holds the production process for the ConsentNetwork. One process runs one network per row of `platform.networks` (`ntwrk:nyc`, `slop:nyc`, `peon:nyc`, `friends:nyc`; platform plan 6.1). It runs each network against Postgres, takes inbound messages from the channel gateway, serves the public API the four sites call, and gives staff a small API for review and safety. Nothing in this folder is deployed. Local dev for the whole platform: [docs/runbook-platform.md](../../../docs/runbook-platform.md).

**Sends are dry-run.** The default adapter stores each message in `network.messages` with status `dry_run` and sends nothing. The Blooio adapter refuses every message unless `BLOOIO_ALLOW_SEND=1`, `NTWRK_LIVE_APPROVED=1` and the app's own `<APP>_LIVE_APPROVED=1` are set (for ntwrk the last two are the same flag). Set an approval flag only with the founder's approval.

| File | What it does |
|---|---|
| `service.ts` | `NetworkService`: the networks, inbound routing (line, keyword, person, membership), keywords through the platform consent ledger, text joins, the person cap, the platform hooks, the staff API |
| `runtime.ts` | `NetworkRuntime`: one network under its own lock, its snapshot and address book, the unit of work and the save transaction |
| `snapshot.ts` | `loadSnapshot(sql, now, { app, city })`: one app's rows only, plus person-to-person blocks |
| `channel.ts` | The adapters (dry-run, Blooio) and the live flags |
| `inbox.ts` | The inbound inbox (`platform.inbound`): one row per provider message, handled once and in order per sender |
| `serve.ts`, `main.ts` | The HTTP servers, the tick loop, the production entry point |

## Signed Shared-agent turns

`POST /internal/turn` and `POST /internal/turn-receipt` use the import-free contract in `packages/core/src/svc`. Set `SERVICE_TURN_SECRET` to the same secret (at least 32 characters) as Cloud. Without it these routes return 503. Sign the full path and raw body; query parameters are refused. Responses use `Cache-Control: no-store`.

A turn commits its claim in `platform.inbound` before it calls the existing inbound handler. The channel and provider message ID identify the claim. The same body replays the stored result; a different body conflicts. An interrupted turn stays unresolved and is not rerun by the inbox tick. Replies from this turn alone are stored as `collected`, outside `platform.outbound`; collection does not mean provider acceptance. A signed receipt binds the exact ordered reply IDs. An unknown receipt can advance to accepted or rejected; accepted receipts are immutable.

Open context rechecks the canonical phone and app membership. It includes confirmed shareable facts after the leak gate, and refuses context that exceeds the deployed plugin bounds. Unavailable active-item summaries are `null`. Replays recheck current admission and context, so STOP, a hold, a ban or changed context cannot reuse an old open grant. App leave seals prior signed payloads for that app. The existing seven-day purge strips completed signed payloads and retains a minimal replay tombstone; tombstones are deleted 30 days after that.

A turn still processing after 2 minutes lost its worker and becomes unresolved. An unresolved turn is never rerun, and it holds the sender's later messages back for 10 minutes at most. STOP, START and HELP are never held back. Staff with `admin@*` can release a stuck turn with `POST /inbound/resolve {"id":"msg:<channel>:<messageId>"}`; the turn stays unresolved and a replay is still refused.

A handled turn with no replies (a quiet acknowledgement, an under-13 decline) takes a receipt with empty `replyIds` and `providerMessageIds`. `accountEligible` is false for an unknown age, so Cloud eligibility never runs ahead of the join age check. An accepted receipt may carry `historyRecorded: false` (no Eliza account yet).

Agent signals never act on their own. `opt_out` and `safety_concern` are stored as proposed private facets, logged as an alert line, and listed for reviewer or safety staff at `GET /signals`. STOP and "leave <app>" in the member's own words stay the only automatic consent changes.

**Contract.** `packages/core/src/svc/contract.ts` and `svc-auth.ts` are byte-identical to elizaos/eliza `plugins/plugin-network/src/backend/{contract,svc-auth}.ts` on `develop` (upstream #34657 and #34661). There is no contract version constant: `packages/core/test/contract-mirror.test.ts` pins the SHA-256 of both files, the same pins as upstream's `contract-mirror.test.ts`, and `bun run check:mirror` compares the files with upstream through `gh` (read-only, never in a test suite). A wire change lands upstream first, then both files are copied here unchanged and the pins are updated.

Two paths the service uses are not in the mirror:
- `DELIVER_RECEIPT_PATH = "/api/internal/network/deliver/receipt"` is a local constant in `cloud-channel.ts`. Eliza Cloud serves it (develop: `packages/cloud/api/internal/network/deliver/receipt/route.ts`, the deliver handler in reconcile-only mode): the same signed body and id as the deliver, and it never sends. The service calls it only to learn whether an unknown acceptance was accepted; it never retries an unknown acceptance with a new id. **Proposal for upstream:** add `DELIVER_RECEIPT_PATH` to `contract.ts`, so both sides name it from the contract.
- `acceptedAt` is required in the upstream DeliverResponse; `cloud-channel.ts` still accepts a receipt without it (the queue then uses its own clock) and does not trust a malformed one.

Signed state, signal and update actions bind the exact completed open turn, channel, app and member. State windows extend the canonical member row; private hypotheses use the existing facet owner. Cloud outbound uses `NETWORK_CHANNEL=eliza_cloud`, `NETWORK_CLOUD_DELIVERY_ORIGIN`, `SERVICE_TURN_SECRET` and the configured `BLOOIO_FROM`, with the same live approval flags as Blooio. The default and `--dry-run` send nothing.

Cloud transport reuses `platform.outbound` and all its policy checks. Unknown acceptance is held outside the dispatch queue. Restart and a bounded receipt poll never resend it. A verified receipt commits under the canonical person fence, preserves its original acceptance time, and updates line counters once. Notify projection repair uses the existing idempotent record owner and one marker on `network.messages`, for queued sends and positively acknowledged handled replies. Handled replies retain their original message time as event chronology; their ACK does not attest a provider acceptance timestamp. Canonical deletion seals late receipt commits. Dispatch admission rechecks the canonical member and immutable outbox row after the asynchronous gates, under short database locks released before remote I/O. An admitted request can remain in flight during deletion; a later receipt cannot restore erased data. Signed first contact and policy declines create no service line counter; engagement follows canonical join-age and membership admission. These tests control the Cloud HTTP transport boundary; actual Cloud history and hosted qualification remain separate gates. No deployment or live flag is enabled by this change.

## The Eliza seam (eliza.app takeover)

The Eliza gateway owns the Blooio webhook of the shared line and calls `POST /internal/turn` for every direct message (docs/design/eliza-conversation-layer.md). The contract is the mirror in `packages/core/src/svc/` and must not be edited here.

**Consent has one path: the turn.** STOP, STOP ALL, START, HELP and "leave <app>" are parsed by this service inside the turn. A handled turn that changed consent carries `consent {state, scope, app, at}`: STOP is `opted_out` with scope `all` and app `null`; leave is `opted_out` with scope `app`; START is `opted_in` with scope `app`. The gateway mirrors it into its send-time fence. The old `STOP_HELP_OWNER=gateway` mode and `POST /consent/gateway` are removed: the upstream gateway (elizaOS/eliza `spike/network-plugin`, `gateway-webhook/src/network-service.ts`) never called that route, it mirrors the turn's `consent` instead.

**Consent order.** In a turn, the consent event time is the gateway's `receivedAt` (never later than now), for STOP, START, leave and the opt-ins of a text join. The ledger resolves by event time, so a START the person sent before a STOP, delivered late by a gateway retry, is recorded but does not opt the number back in, and the turn reports no `consent`. A STOP always stops the members when it arrives. On the legacy webhook the time is the arrival time, as before (that path handles one sender in order).

**START checks.** Before START opts a number back in, the recycled-number hold (a number not seen for 12 months waits for staff) and the ban check (by phone or person) apply. A held number gets `reason: "held"`; a banned number gets `held` and no reply.

**Startup and body size.** The service refuses to start when the turn path is on and `SERVICE_TURN_SECRET` is shorter than 32 characters, or when it equals `NETWORK_SERVICE_CONSOLE_TOKEN` or any `NETWORK_SERVICE_TOKENS` token (Cloud's secret is never a staff bearer). Every signed route reads at most 256 KiB before it verifies or parses anything; the backend refuses a declared larger body on `/internal/*` before the service sees it.

**The one-time notice.** A person who writes on the line through a signed turn and is not a member of any Network app gets, as the first reply of that handled turn, a notice that Eliza is now The Network's agent, what it means, and how to opt out (`ELIZA_NOTICE` in `packages/network/src/copy.ts`). The normal join flow follows in the same turn. Rules:
- The wording is a **DRAFT** (`ELIZA_NOTICE_STATUS`). The founder must approve it before go-live.
- Once per number. `platform.eliza_notices` (migration 0025) keeps a keyed hash of the number (`PLATFORM_HASH_KEY`, its own domain) and the time sent, never the number. The row and the collected reply commit in one transaction.
- It enrolls nobody. Joining still needs the age check and the opt-in; minors follow the age policy (13-17 join, never matched).
- A banned number gets no notice. An age under 13 (stated in the message, pending, or on the phone's age floor) gets only the existing kind decline, and the notice row of that number is deleted in the same turn.
- Open turns are returned only for members of a Network app.

**Proposal for upstream (not built).** The TurnRequest has no "known eliza.app user" flag, so the notice goes to every non-member first contact. An optional `elizaUser?: boolean` field on TurnRequest, set by the gateway for a sender with Eliza history, would let the service send the notice only to existing eliza.app users and give a plain welcome to everyone else. That is a contract change: it goes into elizaOS/eliza `plugins/plugin-network/src/backend` first, then into the byte-for-byte mirror here, with new pins in both `contract-mirror.test.ts` files.

**Tests.** `packages/network/test/eliza-takeover.integration.test.ts` mirrors the upstream gateway test against the real service, HTTP and Postgres: handled STOP (scope all), leave (scope app), START, an older START that loses, HELP, the join keyword, the onboarding answer, the open turn with strict context, a RELAY request in the upstream shape (no match, an unknown item, no request: nothing sent), ignored, replay by messageId, a bad signature, an over-size body, a minor (single-player, no introductions), the notice once, an under-13 decline, and START refused for a banned or held number. Sends are dry-run; a fake Cloud deliver endpoint must receive nothing.

## Relay between matched members

`POST /internal/relay` (relay-endpoint.ts) serves Cloud's RELAY action on its own wire, `RelaySendRequest` → `RelaySendResponse` in the contract mirror (`{channel, messageId, app, memberId, itemId: string|null, text}` → `{decision: pass|hold|block|none, senderNotice, delivered, replayed}`). It is signed with `SERVICE_TURN_SECRET` like the other `/internal/*` actions, size-checked (16 KiB) before it is parsed, idempotent on `x-ntwrk-svc-id`, which must be `<messageId>:relay` as Cloud's client signs it (one relay per turn), and bound to the original completed open turn and the member's current membership. The app and the member come from that turn. `text` must be that turn's own inbound message (trimmed), never model wording, and the service reads the request from it (`parseRelayRequest`: a text, "send them my number", a photo, or `none`). `itemId` may only name an active item the turn's context offered; the recipient is always the member's current match, chosen by the service.

The ConsentNetwork's relay desk (`packages/network/src/relay.ts`) is the one owner of every decision and asks the engine relay policy (`relayItemAsync` in `packages/engine/src/relay.ts`). With `CLOUDFLARE_AI_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set it adds the Clef classifier (`clefRelayClassifierFromEnv`, clef-flash unless `RELAY_CLEF_MODEL=clef`); without them it uses the rules alone and logs `relay classifier: rules only` at start, except in production, where a missing classifier fails closed (every text the rules pass is held for staff). A classifier error holds the item, and each Clef call is a cost row for the app (`cost.ts`). The canonical owners' word on both members (consent ledger and STOP, bans, phone holds, membership, the lowest age, the member row; `runtime.ts relayParties`) can only tighten the desk's view. Only the engine's `rendered` text goes to the other member, through the Network's send path and the outbound queue with the id `relay:<item>`, which the Cloud channel delivers with `kind: "relay"`. A number goes out only after both members asked to swap within the engine's consent TTL (15 minutes; nothing is backdated; the first ask answers `hold`), and never one way: when the first share is refused at send time the second is not sent. A member takes a pending request back with "don't send my number" (the relay answers `none` with a confirmation). The relay thread keeps "<name> shared their number.", never the number, and the Clef prompt is PII-masked. The queue's leak guard lets exactly that number through for that row, and lets a relayed text carry its sender's own facts (as the Network's guard does). Relay rows carry their network (`network_id`, migration 0031), and the endpoint runs on the network that holds the member. Photos are not on this wire (Cloud's `DeliverRequest` has no attachment), so a photo request answers `block`. Minors are never relayed, scores are never shown, and the log (`network.relay_records`, migration 0026) keeps ids, the decision and reason codes, never a body or a contact value. A held text waits for staff and is dropped when they decide.

Final dispatch reads everything again inside the queue's admission transaction, after every asynchronous gate (`runtime.ts relayAdmission`): the item must be one the desk passed for exactly this recipient and not rejected since, the stored state (read `FOR SHARE`) must still hold the open two-person match of these members with both eligible, there is no block either way, and both members pass the canonical checks. A close, a STOP, a hold, a block or a minor's age that lands while the row waits (quiet hours included) ends it suppressed. The action receipt, the relay log, the messages and the queued rows commit in one transaction (the unit's save) or not at all; a fault leaves the receipt `unresolved` and nothing queued. `delivered` is true only for a pass whose outbound row Cloud accepted with provider ids and recorded history; an unknown acceptance stays `false` until the queue's receipt-only lookup recovers it, and a replay or a restart never sends it again. STOP and leaving revoke the turn's authority (403); canonical erasure seals the member's signed turns and their action receipts.

On the Eliza side the RELAY action exists only when `NETWORK_RELAY_ENABLED=1` (upstream #34661); it is off until this endpoint is deployed and the founder sets the flag.

Errors follow the other actions: 400 `invalid_request` or `invalid_relay`, 401 on a bad signature, 403 `turn_scope_invalid`, `membership_unavailable` or `relay_source_invalid`, 409 `action_conflict` or `action_unresolved`, 413 `payload_too_large`, 429 `action_limit`.

## Costs

`cost.ts` writes `network.cost_ledger` rows (codes and counts only): Twilio Verify codes, Clef photo ratings, relay Clef classifier calls (kind `other`, provider `workers_ai`, `detail.purpose = "relay_classifier"`; `COST_CLEF_RELAY_USD` per call, else the engine's list price per input token), LLM attempts, SMS fallbacks and the line. The service has no production LLM client today: it never builds `defaultLLM()` or `llmUnderstand`, and slop onboarding uses the engine's rule reader. A client added later passes `cost.llmHooks(app, purpose)` with the real app and purpose. A dedicated `workers_ai_call` kind needs a migration (migration 0020 constrains the kinds). Test: `packages/network/test/cost.integration.test.ts`.

## Run it

```bash
# Once: one tick, then exit.
PLATFORM_ENV=dev NETWORK_DATABASE_URL=postgres://$USER@localhost:54339/<db> bun run packages/network/service/main.ts --once --dry-run

# As a service: each network ticks every minute on its own; staff and webhooks on 127.0.0.1:4848, the public API on 127.0.0.1:8790.
PLATFORM_ENV=dev NETWORK_DATABASE_URL=... NETWORK_SERVICE_TOKENS="admin:<t>,reviewer:<t>,safety:<t>,analyst:<t>" \
  BLOOIO_WEBHOOK_SECRET=whsec_... bun run packages/network/service/main.ts
```

The database must have the `network` and `platform` schemas (`bun run db:migrate`; runbook-real 1.1). The service checks the tables at start and does not migrate. It reads the networks and the app policy (`platform.networks`, `platform.apps`) at start.

| Variable | Default | What it does |
|---|---|---|
| `NETWORK_DATABASE_URL` | `DATABASE_URL` | Postgres with the `network` schema. A login that can read and write it. |
| `NETWORK_SERVICE_TOKENS` | none | Staff role tokens, the Observatory's scheme. Without them, every staff route answers 401. |
| `NETWORK_SERVICE_AUDIT_DATABASE_URL` | the database URL | The login that writes `network.staff_audit` |
| `BLOOIO_WEBHOOK_SECRET` | none | Verifies the shared line's webhook (`/webhooks/blooio`). Without it, that webhook answers 503. |
| `<APP>_BLOOIO_WEBHOOK_SECRET` | none | Verifies one app's line (`/webhooks/blooio/<app>`). Without it, that path answers 503. |
| `PLATFORM_API_PORT` | `8790` | The public API (`/api/*`) the sites call |
| `PLATFORM_STOP_SCOPE` | every app | STOP stops every app. `app`: STOP on an app's own line stops that app only. |
| `SERVICE_TURN_SECRET` | none | Signs the Eliza seam (`/internal/*` and Cloud deliver). The turn path is on when it is set or `NETWORK_CHANNEL=eliza_cloud`; then a secret shorter than 32 characters, or one equal to a staff or console token, stops the start. Without it the signed routes answer 503. |
| `STOP_HELP_OWNER`, `STOP_HELP_GATEWAY_SECRET` | retired | Ignored, with a log line. STOP, START and HELP are answered inside the signed turn (below). |
| `PLATFORM_HASH_KEY`, `PLATFORM_SESSION_SECRET`, `PLATFORM_PROXY_SECRET` | dev keys | Phone hashes, session hashes, the site routers' signature. Required in production. `main.ts` refuses to start without them (`assertBootConfig`). |
| `OTP_PROVIDER` | dev console | `twilio` uses Twilio Verify (needs its credentials). The dev console provider refuses production. |
| `NETWORK_SERVICE_HOST`, `NETWORK_SERVICE_PORT` | `127.0.0.1`, `4848` | The bind address. Another host prints a warning. |
| `NETWORK_SERVICE_INSTANCE` | the process id | The name in `pg_stat_activity` (the lock holder in `/health`) |
| `NETWORK_CHANNEL` | dry-run | `blooio` uses the Blooio adapter (needs `BLOOIO_API_KEY`, `BLOOIO_FROM`). `--dry-run` always wins. |
| `BLOOIO_ALLOW_SEND`, `NTWRK_LIVE_APPROVED`, `<APP>_LIVE_APPROVED` | off | All `1` for the app: the Blooio adapter sends for it. **[FOUNDER]** |
| `BLOOIO_LINE_DAILY_CAP`, `BLOOIO_LINE_NEW_CHATS_PER_DAY` | 200, 20 | The shared line's daily caps in the queue (agent-started messages, new conversations). Prototype P3 sets them. |

## What it does

| Part | How |
|---|---|
| Tick | Every minute, each network on its own: `runTick()` with its `PgStore` under its advisory lock (`network-tick-<app>:<city>`). A second instance skips a network while its lock is held. The engine runs once a day inside the tick (09:00 New York), as in the simulator. The clock is `RealClock`. A network whose `platform.networks.matching_enabled` is false never matches, whatever its stored switch says. |
| Snapshot | `snapshot.ts` reads one app's members, facets, intents, presence, edges and recent opportunities at the start of every unit of work. Every query filters by `app_id`. A person-to-person block (`platform.person_blocks`, from any app) is a "blocked" edge when both people are members of this app. The Observatory's shadow runs use the same builder (The Network by default). |
| Inbound | `POST /webhooks/blooio` (the one line for every app: `platform.app_lines`, then a keyword such as "slop.date", then the member's open item, then the app that wrote last, then The Network) and `POST /webhooks/blooio/<app>` (an app's own line, if one ever has one). Each checks `X-Blooio-Signature` on the raw body (300 s window). The phone finds the person (`platform.phone_identities`), then the membership, then the member id; members from before the platform use `network.channel_identities`. A message goes into the inbox first (`platform.inbound`, `inbox.ts`): one row per provider message id, so a provider retry, a replay or a second subscription is a duplicate; the webhook answers 200 once the row is stored, and a handler error leaves the row for the next tick (5 tries, then an alert). The messages of one sender are handled one at a time (an advisory lock per sender), oldest first. Each message is one unit of work on that app's network. Every message and tapback on the line resets that conversation's unanswered streak. Someone who is not a member: the join by text (first name and age, 13+; nothing stored until the age check passes). With no keyword they join The Network, which asks what they are looking for and enrolls them in those apps. The waiting flows are in `platform.pending_texts`. |
| Keywords | STOP (and opt-outs in the person's own words), STOP ALL, START and HELP go through the platform consent ledger (`platform.consent_events`, one row per message) with the app's own texts (`packages/platform/src/apps.ts`). STOP stops every app. "leave <app>" leaves one app (the forget path). One owner answers keywords: this service (founder decision: one system only), inside the signed turn in production (the section "The Eliza seam"). |
| Public API | `/api/*` on `PLATFORM_API_PORT` (`createPublicApi`). A web join creates the network member for that app and queues the welcome through the normal send path. Stop, leave, delete everything and export call the network paths. |
| Person cap | At most 3 proactive messages a day for one person across all apps (PRD 40.3), taken when a send is handed to the adapter (`platform.person_cap_take`: one lock for every app, a counter in `platform.person_sends`). Over the cap: `refused_person_cap`. |
| Row-level security | Every query on a network table runs in a transaction with `app.app_id` set (`NetworkRuntime.scoped`), so the service runs under a login with the `network_service` role (which inherits `platform_service`). |
| Ages | An age a member states in chat (the Network's `onAgeStated`) lowers the person's age on every app. Under 13 removes every membership. An attested adult's under-13 claim is held by the Network and recorded as 13 here. |
| Network capital | Every NC ledger event the Network emits is recorded in a `CapitalLedger` (packages/capital) and stored in `network.capital_events` in the unit's transaction. The levers are not read yet. |
| Restart | Rows a stopped worker held during a provider call (`sending`, lease run out) go back to the queue and are sent again with the same provider key. Then the state loads, then the queue delivers what waits. A proactive row older than 24 h, any row older than 3 days, or a row about a closed opportunity is stored as `expired`. Inbound rows a crash left waiting are handled on the next tick. |
| Saves | The Network state, its console rows, and what the unit produced (messages, events, blocks, engine runs, opt-outs, and with Blooio the queue rows in `platform.outbound`) are written in one transaction. Then the queue delivers. |
| Under 13 | The decline goes out. Then the member's row keeps only the id (`account_status = 'removed'`). Their messages, facets, intents, presence, edges, phone and events are deleted (every event that names them: actor, object or payload). |
| Outbound | `ChannelAdapter` (`channel.ts`). `DryRunAdapter` is the default. `BlooioAdapter` is the persisted queue (`packages/blooio` `OutboundQueue`, `platform.outbound`, migration 0015) with the Network's send-time checks: the consent ledger and bans, the member's opt-out, `blooioRecipientPolicy`, the person cap, `forbiddenProvider`. It refuses without the live flags. Statuses (and Blooio receipts) are copied to `network.messages`. Attachments (photo links) go as `mediaUrls`. |
| App packs | `packs.ts`. Each network gets its app's engine pack (`appWiring`): The Network keeps networkPack; slop runs `makeSlopPack({ verification: { required: false } })` (founder decision 9: no ID check; a stated adult age is enough) with `SLOP_ENGINE_CONFIG` on nyc; peon runs `peonPack` with `PEON_ENGINE_CONFIG`; friends runs `friendsPack` with `FRIENDS_PLANS`. Members aged 13-17, and anyone who may be a minor, never enter a pack's input (`ConsentNetwork.packInput`). Every item still waits for a human reviewer. slop adds its hooks (`apphooks.ts`): the engine's onboarding loop (`AppHooks.onboarding`: after the welcome answer, each message goes through `extractSlopProfile`, or `applyCorrection` after a read-back, then `slopOnboardTags`; the next message is the read-back once every hard field is set, else `nextQuestion`, one question at a time and each at most twice; the state is kept on the member as `onboarding`, values only, never the member's words). Orientation follows PRD 40.5: "bi", "pan", "queer", "both" and "a mix" leave who they seek unset and the agent asks again; the founder may still choose to read them as a seeking set instead (listed as a founder decision). The pack's own asks use the loop's next question too. Then the date probe with an age band and a distance band, a public place near the midpoint (lit indoor or plaza places after dark), the booked date with the share-my-date tip, and the check-in after the date. A new slop member opts in to dating only when the person is 18 or more. |
| Reports, holds, bans | A "report X" message and slop's check-in after a date are reports (`reports.ts`): ids and a kind (harassment, lying, no_show, unsafe, scam, minor, other), never the words. An urgent check-in report keeps the member out of matching until staff decide. Hold reaches the person on every app. A ban (`platform.bans`, migration 0011) by phone or by person restricts every membership, holds every member, suppresses the numbers, and refuses every later join (web or text). Delete everything keeps it. |
| Photos | `packages/platform/src/photos.ts` on `/api/photos/*` (slop only; the upload form is on `slop.date/settings`): an adult (the person's lowest stated age is 18 or more; an unknown age fails closed), not banned, the photo consent, JPEG/PNG/WebP up to 8 MB and 6 photos, metadata stripped. Photos by text (`photoIntake.ts`): a slop member's attachment is fetched only after the adult and ban checks pass and the photo consent was given by text (asked once; only an explicit "YES PHOTOS" on a message routed to slop counts, so a bare yes to a probe or on another app is never taken as photo consent); a minor's photo is dropped unfetched. Storage: `PHOTO_STORAGE=r2` (`R2_ENDPOINT` or `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`; a private bucket) or `PHOTO_STORAGE=local` (dev only, `PHOTO_DIR`). Unset: photos are off. No public URL: staff get a 5-minute signed link (`PHOTO_VIEW_BASE_URL`, default `https://<app domain>`) after an audited read. The rater (`photoRater`; `server.ts` calls the platform's `photoRaterFromEnv`: on by default, `CLEF_RATINGS=off` turns it off; the engine's `makeClefRaterFromEnv` from `CLOUDFLARE_AI_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLEF_MODEL`, with the placeholder Clef weights unless `CLEF_WEIGHTS_PATH` names a fitted file with version and provenance (a file without them is refused), with 3 tries on API errors, each try a cost row) rates the member from up to 4 photos after each upload or delete and stores the engine's `appearanceFacet` (agent_private; never in the console). The score is discarded if the person stopped being a rateable adult member, was banned or lost a rated photo while the rater ran. Without the token or the account id, ratings are off. Leaving the app, delete everything, or an age under 18 deletes the photos and the rating; a ban deletes the rating. |
| Bias monitor | `bias.ts`: once a week per slop network, after a tick, the engine's `biasMonitor` over the last 28 days (proposals, dates, second dates) by photo-rating quintile; stored in `network.bias_reports` (migration 0014), `[alert] bias ...` log lines under 0.8x, shown in the console. |
| Review SLA alerts | After each tick: one `[alert] review SLA ...` log line per item waiting longer than its app's SLA (slop 6 h, peon 24 h, others 12 h; observatory `DEFAULT_SLA_HOURS`). |
| Staff API | Below. Every action writes `network.staff_audit` (a "requested" row before the action, a "result" row after) and the Network's own logs (`review_decision`, `safety_action`, `matching_switch` in `network.events`). |

### Staff API

Send `Authorization: Bearer <token>`. Tokens are per app: `reviewer@slop:<t>` is a reviewer of slop only; a role with no app (`reviewer:<t>`) is for every app. Admin for an app passes every check for it. Name the network with `?app=<app>` (and `&city=`) or `/apps/<app>/<route>`; without it, the route is The Network's. Every action writes the app in `network.staff_audit`.

| Route | Role | Body |
|---|---|---|
| `GET /health` | any role for the app | Last tick, lock holder, backlog (review, overdue, deferred, waiting sends), refusals; with several networks, a `networks` summary |
| `GET /review` | reviewer, safety | The review queue, oldest first |
| `POST /review/:oppId` | reviewer | `{ decision: "approve" \| "reject" \| "edit" \| "reroll", reason?, note?, secondsSpent?, explanations?, objective?, swapOut? }`. The reviewer of record is the token's staff id, never a field in the body. |
| `POST /safety/lift` | safety | `{ memberId, note? }` |
| `POST /safety/close` | safety | `{ caseId, note? }` |
| `GET /signals` | reviewer, safety | Agent `opt_out` and `safety_concern` signals waiting for a person: `{ id, memberId, kind, evidence, at }`, newest first |
| `GET /staff/relay/held` | reviewer, safety | Relayed items held for a person, oldest first: `{ id, itemId, app, kind, memberId, from, reasons, createdAt, text? or minor: true }` (the console's HeldText shape; `memberId` is the sender). `text` only while the sender is an adult with no age doubt now (re-checked on every read); never a minor's words, never a score |
| `POST /staff/relay/:itemId/release` | safety | `{ note }` (or `reason`), 5+ characters, else 409 `reason_required`; it goes in the audit row. The engine checks the item again; anything that would now block stays undelivered (`delivered: false`) |
| `POST /staff/relay/:itemId/reject` | safety | `{ note }` (or `reason`), 5+ characters. Never delivered; the held text is dropped |
| `GET /queue/leak-review` | safety | Texts the outbound queue's leak guard parked (`parked_leak_review`), oldest first: `{ id, kind, memberId?, to (masked), reasons, createdAt, text? or minor: true }`. 404 without a reason when the network has no queue (dry run) |
| `POST /queue/leak-review/:id` | safety | `{ decision: "release" or "drop", reason }` (5+ characters). Release: back to the queue, every other send check runs again, the leak guard does not park it again (`leak_released_by`, migration 0032); refused (`minor`) when the member's age is in doubt. Drop: ends `dropped_leak_review`. 409 `not_parked`. Audited (`leak_release`, `leak_drop`) |
| `POST /inbound/resolve` | admin@* | Release a sender held back by a signed turn that did not finish: `{ id }` |
| `GET /safety/reports` | safety | Reports about this app's members, newest first: `{ id, kind, reporterId, subjectId, opportunityId?, at, status, source, priorReports }` (docs/admin-console.md 3.7.1) |
| `POST /safety/hold` | safety | `{ memberId, note (5+ characters), reportId? }`: the person on every app |
| `POST /safety/ban` | safety | `{ memberId, by: "phone" \| "person", note, reportId? }`; 409 `already_banned`, `no_person`, `no_phone` |
| `POST /safety/dismiss` | safety | `{ reportId, note }`; 409 `unknown_report`, `already_<status>` |
| `POST /members/:id/verify` | safety | `{ check: "age" \| "liveness", result: "pass" \| "fail", note }`: `verify:<check>:<result>` on the member (PRD 40.5), until a vendor writes it |
| `GET /members/:id/photos` | safety | `X-Network-Reason: <5+ characters>`. Only with an open safety report (open or held) or an open safety case about the member, as the photo consent promises (403 `no_report`, audited as refused); the report or case id goes in the audit row. Verified adults only (403 `adults_only`); the audit row is written before any link |
| `GET /bias` | admin, analyst | The newest weekly bias monitor reports of the network (aggregates only) |
| `POST /matching` | admin | `{ on: true \| false }`. Refused (`matching_not_allowed`) for a network the registry keeps off. Migration 0011 allows slop and peon; their stored switch still starts off. |
| `/review-mode` | none | Always 404. Production review is "human" only (PRD 32.8). The service refuses any other mode at start. |

A refused action answers 409 with the Network's reason (for example `participant_minor`, `matching_paused`, `not_in_review`). A new stored state starts with matching off (runbook-real 7.4 check 8). An admin turns it on.

## The outbound queue

The Blooio and Cloud adapters deliver through the persisted queue in `packages/blooio/src/outbound-queue.ts` (`platform.outbound`). Its file header lists every check at send time. This section covers the parts the service decides.

### Kinds

A row's kind decides which checks it skips. Only `compliance` skips the opt-out, the recipient check, quiet hours and the caps. `reply` skips quiet hours, but it must answer a message the person sent in the last hour. `transactional` and `proactive` get every check.

### Direct texts

`NetworkService.direct()` sends one fixed text to a person who is not a member here, or before the member exists. Each caller passes its own kind:

| Caller | Text | Kind |
|---|---|---|
| `inbound`, a number on hold | HELP answer | `compliance` |
| `inbound`, "leave <app>" | the leave confirmation | `compliance` |
| `inbound`, not a member | HELP answer | `compliance` |
| `stop`, not a member | the STOP or STOP ALL confirmation | `compliance` |
| `join`, invite-only app | the invite-only answer | `reply` |
| `join`, no age yet | the join question (name and age) | `reply` |
| `join`, under the join age | the under-age decline (a refusal of service that must reach the person; the Cloud contract reports it as `compliance`) | `compliance` |
| `join`, no name yet | the name question | `reply` |
| `PhotoIntake` (`photoIntake.ts`) | the photo consent question and photo answers | `reply` |
| `invite` (staff) | the invitation | `transactional` |

A direct text in a signed turn goes back to Cloud as a collected reply, with kind `compliance` or `reply`. A direct text with no member on the row, to an address that is not a member of the app, skips the member policy (`blooioRecipientPolicy`), because there is no member to check. It still gets the consent ledger, bans, suppression, quiet hours, caps and the leak guard. The consent check (`NetworkRuntime.optedOut`) reads `platform.consent_events` by address for these rows too. A person who sent STOP therefore gets no join question until they opt in again. A text join message with both their name and age opts them in (the join records a new consent event), and so does a web join.

### STOP and the inbox

A STOP, STOP ALL, "leave <app>", START or HELP that waits in the inbox is handled ahead of the sender's earlier rows (`inbox.ts`). An earlier row that keeps failing therefore never holds back a consent change or its confirmation. A handled STOP or STOP ALL ends the sender's ordinary rows that came before it, with outcome `cancelled_by_stop`. The Network never acts on them after the STOP; a join answer handled late would opt the person back in. Messages that come after the STOP are handled as usual. Signed turns already let these keywords through, and "leave <app>" now counts too. Integration case: `packages/network/test/inbox-order.integration.test.ts`.

### The consent ledger at dispatch

The queue keeps no STOP ledger of its own. Every row except a compliance text reads consent from Postgres at dispatch: `platform.consent_events`, bans and suppression (`NetworkService.consentRefused`), and `network.members.opted_out`. The member check runs again inside the claim transaction. So a STOP that comes in while a row waits wins on every replica. Persisting a separate ledger in the queue's tables was the other option. It was not taken because it would be a second copy of `platform.consent_events`, and the two could disagree after a STOP through the web or the gateway. A row that waits is not cancelled at STOP; dispatch ends it as `refused_opted_out`.

### More than one replica

Every replica may drain the queue. There are three guards, and the provider key stays `tn:<row id>` on every attempt:

1. One drain at a time per line, across processes, through a Postgres advisory lock (`blooio-line:<line>`). Receipt lookups for rows in `unknown_acceptance` run before the lock, so canonical erasure never waits on remote I/O. Their commit is conditional on the row's status, so a receipt is committed once.
2. A conditional claim before the provider call. The update to `sending` happens only if the row still has the status the drain read and no lease, and it sets a lease (`leaseMs`, 5 minutes). A worker whose claim fails leaves the row to the worker that claimed it and does not end it.
3. `recover()` hands a `sending` row whose lease ran out back to the queue. The worker stopped. With a receipt lookup the row goes to `unknown_acceptance` and is never sent again. Without one it is sent again with the same key, so the provider replays the first result.

Integration case: `packages/blooio/test/outbound-queue.test.ts` runs two workers with their own pools on one database, and each row reaches the provider once.

### The leak guard and the thread

Before a send, the leak guard checks the new text. It also checks the new text together with the texts sent to the same address on the line in the last 24 hours (up to 4 of them; `LeakGuard.checkThread`, core-14). This catches another member's value split across messages. The generic contact patterns run on the new text alone, because two ordinary messages joined can look like a phone number. A thread hit holds the row as `parked_leak_review` with labels prefixed `thread:`. A compliance text is checked on its own text only. Labels are keyed with `LEAK_LABEL_KEY` in staging and production (core-6). `deploy/backend` `loadConfig` refuses to start without it, and `server.ts` calls `setLeakLabelKey`. Dev and the simulations stay unkeyed, so their labels are reproducible.

## The boundary with `packages/plugin-network`

Two parts of the product talk to members. They have different jobs.

| | This service (`packages/network/service`) | `packages/plugin-network` (the Eliza agent side) |
|---|---|---|
| What it is | The Network: matching, review, consent, probes, booked plans, reminders, feedback, safety, outreach limits | An Eliza plugin: the member-context provider, the `SET_STATE` action, the network-signals evaluator and their routing |
| Who runs it | A Bun process on its own (Railway worker, runbook-real 7.2) | Eliza Cloud, on each agent turn, with Cloud's stores and turn authority |
| State | `network.network_state` and the console tables, under the advisory lock | The `NetworkStore` that Cloud injects (availability state, member context) |
| Messages | Every Network message (probes, booked plans, reminders) goes through its send path, the leak guard and the adapter | Agent replies in a conversation the member started |
| Review | Every opportunity waits for a person here | Never composes an opportunity |

Rules for the boundary:

1. **One owner per inbound message.** The service handles every inbound message it gets. This service answers STOP, START and HELP, inside the signed turn; the gateway only mirrors the reported `consent`. The legacy Blooio webhook must not point at the service while the gateway owns the line, or two systems would confirm a STOP.
2. **Only this service proposes or contacts members about other members.** The plugin must not send probes, introductions or booked plans. It can read what the Network knows through its own store.
3. **Joining is a membership.** The platform creates members: a web join (`POST /api/join`) or a join by text on an open app makes the person, the membership and the `network.members` row. For The Network, Cloud's invite gate still creates the `network.members` and `network.channel_identities` rows. An `invited` member is not a member here.
4. **No shared process state.** The two talk only through Postgres (the `network` schema) and the channel gateway. Nothing here imports Eliza, and the plugin does not import this service.

## Limits

- **No live send has been made.** The Blooio path is tested only with a fake provider.
- **The queue's caps are placeholders.** 200 agent-started messages and 20 new conversations a day per line until prototype P3 measures the line.
- Parked leak reviews have staff routes (`/queue/leak-review`, above). Collected replies in signed turns get the same leak guard before they are returned to Cloud; one that fails goes to the queue instead, where it is parked for that review.
- **The requester's time question has no opportunity id.** The Network sends it with no `proposalId` (network.md 4.1), so its `network.messages` row has no `opportunity_id`. Probes are linked through `meta.probe.key`.
- **Invites are not built.** The Network's `ctx.invite` is not set, so an invite request logs `invite` with no new member.
- **The service imports the Observatory's modules** (`events.ts`, `engineCapture.ts`, `staff.ts`) by path, so the events, run summaries and staff auth are the same in both. The Observatory imports `snapshot.ts` from here.
- **No JWT check.** Use role tokens only, and keep the port on 127.0.0.1 or behind an access proxy.
- **No fencing on the save.** Two instances that both believe they hold a network's lock can overwrite each other's state (audit network-service-8).
- **One network engine for every app.** Each app's ConsentNetwork is The Network's code with that app's brand words and join age. The NYC places, time zone and copy are NYC only. The slop and peon packs are wired (`packs.ts`); their matching is off only by the stored switch (`POST /matching`).
- **Phones of platform members are in `platform.phone_identities` only.** `network.channel_identities` allows one member per address, so it cannot hold a phone that is a member of two apps. Console views that read phones from `channel_identities` do not see platform members.
