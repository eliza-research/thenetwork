# The Network service (production runtime)

This folder holds the production process for the ConsentNetwork. One process runs one network per row of `platform.networks` (`ntwrk:nyc`, `slop:nyc`, `peon:nyc`, `friends:nyc`; platform plan 6.1). It runs each network against Postgres, takes inbound messages from the channel gateway, serves the public API the four sites call, and gives staff a small API for review and safety. Nothing in this folder is deployed. Local dev for the whole platform: [docs/runbook-platform.md](../../../docs/runbook-platform.md).

**Sends are dry-run.** The shared backend (`deploy/backend`) runs the queue dry run by default: the real Blooio queue and its checks against a recording fake provider. `main.ts` and the service's own default adapter (`DryRunAdapter`) are log only: they store each message in `network.messages` with status `dry_run` and **skip the queue entirely**, so quiet hours, the caps, line safety, the reply window and the send-time leak guard never run on that path. Live sends follow the flag matrix below. Set an approval flag only with the founder's approval.

### Who may send (the flag matrix)

Every app shares one queue for the line (`shared-line.ts`). The flags are read at every send.

| Send | Live (`NETWORK_CHANNEL=blooio`) | Queue dry run (the backend default) |
|---|---|---|
| An app's own messages (everything its Network composes; join questions, invite-only and under-age replies to non-members) | `BLOOIO_ALLOW_SEND=1` and that app's `<APP>_LIVE_APPROVED=1`. No other app's flag. | The app is in `QUEUE_DRY_RUN_APPS` (default every app) |
| The line's system replies: HELP, STOP and START confirmations, the "leave <app>" confirmation, and a short "not open yet" to a keyword of an app that may not send | `BLOOIO_ALLOW_SEND=1` and at least one app's `<APP>_LIVE_APPROVED=1` | At least one app is in `QUEUE_DRY_RUN_APPS` |
| Anything else | Refused (`refused_not_approved`); the provider is never called | Recorded by the fake provider only |

The backend uses the Blooio API only when `BLOOIO_ALLOW_SEND=1` and some app is approved; otherwise it stays in the queue dry run and warns. A message that waits in the queue is checked again at dispatch, so turning a flag off stops what waits. Who answers STOP and HELP on the line is unchanged (this service; see the boundary below). A keyword of an app that may not send gets the "not open yet" reply (once a day per number), and no join starts.

| File | What it does |
|---|---|
| `service.ts` | `NetworkService`: the networks, inbound routing (line, keyword, person, membership), keywords through the platform consent ledger, text joins, the person cap, the platform hooks, the staff API |
| `runtime.ts` | `NetworkRuntime`: one network under its own lock, its snapshot and address book, the unit of work and the save transaction |
| `snapshot.ts` | `loadSnapshot(sql, now, { app, city })`: one app's rows only, plus person-to-person blocks |
| `channel.ts` | The adapters (log-only dry run, Blooio) and the live flags |
| `shared-line.ts` | `SharedLine`: one OutboundQueue per line for every app, the flag matrix, the line's system replies, queue alerts |
| `photoRating.ts` | The Clef rater as the platform's photo rater (only with its environment), the member's `appearance:*` rating facet, and the send-time checks for a photo in a slop probe (`SLOP_PROBE_PHOTO=1`, off by default) |
| `biasJob.ts` | The weekly bias monitor for slop: outcomes by rating quintile and by self-reported group, the stored report, the `bias_report` event, and the pause under 0.8x |
| `serve.ts`, `main.ts` | The HTTP servers, the tick loop, the production entry point |

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
| `PLATFORM_HASH_KEY`, `PLATFORM_SESSION_SECRET`, `PLATFORM_PROXY_SECRET` | dev keys | Phone hashes, session hashes, the site routers' signature. Required in production. `main.ts` refuses to start without them (`assertBootConfig`). |
| `OTP_PROVIDER` | dev console | `twilio` uses Twilio Verify (needs its credentials). The dev console provider refuses production. |
| `NETWORK_SERVICE_HOST`, `NETWORK_SERVICE_PORT` | `127.0.0.1`, `4848` | The bind address. Another host prints a warning. |
| `NETWORK_SERVICE_INSTANCE` | the process id | The name in `pg_stat_activity` (the lock holder in `/health`) |
| `NETWORK_CHANNEL` | dry-run | `blooio` uses the Blooio adapter (needs `BLOOIO_API_KEY`, `BLOOIO_FROM`). `--dry-run` always wins. The backend: unset is the queue dry run, `dry-run` is log only. |
| `BLOOIO_ALLOW_SEND`, `<APP>_LIVE_APPROVED` | off | `BLOOIO_ALLOW_SEND=1` and the app's flag: the app sends. The line's system replies need any one app's flag (the matrix above). **[FOUNDER]** |
| `NETWORK_LLM_READER` | off | `1`: the LLM reader (`extract.ts`, `defaultLLM()`: gpt-6-luna on Surplus, OpenAI fallback) reads member texts the rules miss. On slop it also reads the dating fields. Phones, emails, addresses and long digit runs are masked first. Off: the rules alone. |
| `NETWORK_ENGINE_JUDGE` | off | `1`: the engine's judge passes run with `defaultLLM()` (slop: the dating rubric in `packs/slop/judge.ts`). Off: no judge, and run logs say so. |
| `QUEUE_DRY_RUN_APPS` | every app | The apps the queue dry run treats as live (`ntwrk,slop`) |
| `QUEUE_MAX_UNANSWERED`, `QUEUE_REENGAGE_AFTER_DAYS` | `1`, `30` | An interruption goes only while at most this many are unanswered (PRD 41.4); the single re-engagement after this many days |

## What it does

| Part | How |
|---|---|
| Tick | Every minute, each network on its own: `runTick()` with its `PgStore` under its advisory lock (`network-tick-<app>:<city>`). A second instance skips a network while its lock is held. The engine runs once a day inside the tick (09:00 New York), as in the simulator. The clock is `RealClock`. A network whose `platform.networks.matching_enabled` is false never matches, whatever its stored switch says. |
| Member texts | Every text from an active adult gets one short reply (`src/intents.ts`): help, what the agent knows, corrections, pause and quiet hours, how often, the open asks, questions it cannot look up, and the settings page for export and delete. A pause or quiet hours set by text is written to `network.members` with the unit. What the Network learned (interests, skills, wants, the app's tags) is mirrored into `network.facets` after every unit (ids with `:chat:`; app tags stay `agent_private`). |
| Snapshot | `snapshot.ts` reads one app's members, facets, intents, presence, edges and recent opportunities at the start of every unit of work. Every query filters by `app_id`. A person-to-person block (`platform.person_blocks`, from any app) is a "blocked" edge when both people are members of this app. The Observatory's shadow runs use the same builder (The Network by default). |
| Inbound | `POST /webhooks/blooio` (the one line for every app: `platform.app_lines`, then a keyword such as "slop.date", then the member's open item, then the app that wrote last, then The Network) and `POST /webhooks/blooio/<app>` (an app's own line, if one ever has one). Each checks `X-Blooio-Signature` on the raw body (300 s window). The phone finds the person (`platform.phone_identities`), then the membership, then the member id; members from before the platform use `network.channel_identities`. Each message is one unit of work on that app's network. A provider retry is handled once. Someone who is not a member: the join by text (first name and age, 13+; nothing stored until the age check passes). With no keyword they join The Network, which asks what they are looking for and enrolls them in those apps. The waiting flows are in `platform.pending_texts`. |
| Keywords | STOP (and opt-outs in the person's own words), STOP ALL, START and HELP go through the platform consent ledger (`platform.consent_events`, one row per message) with the app's own texts (`packages/platform/src/apps.ts`). STOP stops every app. "leave <app>" leaves one app (the forget path). |
| Public API | `/api/*` on `PLATFORM_API_PORT` (`createPublicApi`). A web join creates the network member for that app and queues the welcome through the normal send path. Stop, leave, delete everything and export call the network paths. |
| Person cap | At most 3 proactive messages a day for one person across all apps (PRD 40.3), taken when a send is handed to the adapter (`platform.person_cap_take`: one lock for every app, a counter in `platform.person_sends`). Over the cap: `refused_person_cap`. |
| Row-level security | Every query on a network table runs in a transaction with `app.app_id` set (`NetworkRuntime.scoped`), so the service runs under a login with the `network_service` role (which inherits `platform_service`). |
| Ages | An age a member states in chat (the Network's `onAgeStated`) lowers the person's age on every app. Under 13 removes every membership. An attested adult's under-13 claim is held by the Network and recorded as 13 here. |
| Network capital | Every NC ledger event the Network emits is recorded in a `CapitalLedger` (packages/capital) and stored in `network.capital_events` in the unit's transaction. The levers are not read yet. |
| Restart | The state loads first, then rows that wait for delivery are delivered once. A proactive row older than 24 h, any row older than 3 days, or a row about a closed opportunity is stored as `expired`. An adapter error keeps rows waiting for the next tick; the webhook still answers 200. |
| Saves | The Network state, its console rows, and what the unit produced (messages, events, blocks, engine runs, opt-outs) are written in one transaction. Then the adapter delivers. |
| Under 13 | The decline goes out. Then the member's row keeps only the id (`account_status = 'removed'`). Their messages, facets, intents, presence, edges, phone and events are deleted (every event that names them: actor, object or payload). |
| Outbound | `ChannelAdapter` (`channel.ts`). `DryRunAdapter` (log only, no queue) is the service's default. `BlooioAdapter` is one app's view of the line's shared `OutboundQueue` (`shared-line.ts`), with that app's `blooioRecipientPolicy` and `forbiddenProvider`. One queue per line: the new-conversation cap, the unanswered streaks and the reply window are per line and address across apps. Any message from an address engages it for every app before anything answers it, so the welcome and the join questions go as replies and are not new conversations. The queue's state is in Postgres (`PgQueueStore`, migration 0014) and loads before the networks deliver what a restart left waiting. Queue alerts and Blooio safety webhooks are `network.events` rows of type `queue_alert` (`{ kind, line, address_hash, detail }`). A safety event with no line holds the configured line. |
| App packs | `packs.ts`. Each network gets its app's engine pack (`appWiring`): The Network keeps networkPack; slop runs `makeSlopPack({ verification: { required: false } })` (founder decision 9: no ID check; a stated adult age is enough) with `SLOP_ENGINE_CONFIG` on nyc; peon runs `peonPack` with `PEON_ENGINE_CONFIG`; friends runs `friendsPack` with `FRIENDS_PLANS`. Members aged 13-17, and anyone who may be a minor, never enter a pack's input (`ConsentNetwork.packInput`). Every item still waits for a human reviewer. slop adds its hooks (`apphooks.ts`): the hard-field asks in one message (each at most twice), the answers as agent_private tags, the date probe with an age band and a distance band, a public place near the midpoint (lit indoor or plaza places after dark), the booked date with the share-my-date tip, and the check-in after the date. A new slop member opts in to dating only when the person is 18 or more. |
| Reports, holds, bans | A "report X" message and slop's check-in after a date are reports (`reports.ts`): ids and a kind (harassment, lying, no_show, unsafe, scam, minor, other), never the words. An urgent check-in report keeps the member out of matching until staff decide. Hold reaches the person on every app. A ban (`platform.bans`, migration 0011) by phone or by person restricts every membership, holds every member, suppresses the numbers, and refuses every later join (web or text). Delete everything keeps it. |
| Photos | `packages/platform/src/photos.ts` on `/api/photos/*` (slop only): an adult (the person's lowest stated age is 18 or more; an unknown age fails closed), the photo consent, JPEG/PNG/WebP up to 8 MB and 6 photos, metadata stripped. Storage: `PHOTO_STORAGE=r2` (`R2_ENDPOINT` or `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`; a private bucket) or `PHOTO_STORAGE=local` (dev only, `PHOTO_DIR`). Unset: photos are off. No public URL: staff get a 5-minute signed link (`PHOTO_VIEW_BASE_URL`, default `https://<app domain>`) after an audited read. An optional rater (`photoRater`; `server.ts` passes the Clef rater only when `CLOUDFLARE_AI_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set) writes one agent_private facet per member (`<member>:appearance`, the slop pack's `appearance:*` tags) only for a verified adult. A failed or skipped rating is tried again on the tick with backoff, at most 5 times (migration 0020). Every new photo waits for staff moderation (`POST /photos/:id/moderate`); only an approved photo may ride on a probe, and only with `SLOP_PROBE_PHOTO=1`, through a signed link that works for an hour. A photo sent by text gets the upload's checks and needs the photo consent recorded first (the settings page); otherwise it is dropped unread and the member gets the settings link. Leaving the app, delete everything, or an age under 18 deletes the photos. |
| Bias monitor | `biasJob.ts`, weekly on the tick for slop (and `GET /bias`): exposure, mutual yes and dates held per member-month by rating quintile and by self-reported group, over 4 weeks. The report goes to `network.bias_reports` with a `bias_report` event `{ ratio, min_group, action }`. Under 0.85x it alerts; under 0.8x it also pauses slop matching through the matching switch (audited, reason "bias monitor"). A person turns matching back on. |
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
| `GET /safety/reports` | safety | Reports about this app's members, newest first: `{ id, kind, reporterId, subjectId, opportunityId?, at, status, source, priorReports }` (docs/admin-console.md 3.7.1) |
| `POST /safety/hold` | safety | `{ memberId, note (5+ characters), reportId? }`: the person on every app |
| `POST /safety/ban` | safety | `{ memberId, by: "phone" \| "person", note, reportId? }`; 409 `already_banned`, `no_person`, `no_phone` |
| `POST /safety/dismiss` | safety | `{ reportId, note }`; 409 `unknown_report`, `already_<status>` |
| `POST /safety/clear-person` | safety@* or admin@* | `{ memberId, note }`: clears the person's safety holds on every app (platform.person_safety, migration 0019); 409 `not_held`, `no_person`, `needs_safety_everywhere`. See docs/runbook-safety.md |
| `POST /members/:id/verify` | safety | `{ check: "age" \| "liveness", result: "pass" \| "fail", note }`: `verify:<check>:<result>` on the member (PRD 40.5), until a vendor writes it |
| `GET /members/:id/photos` | safety | `X-Network-Reason: <5+ characters>`. Verified adults only (403 `adults_only`); the audit row is written before any link |
| `GET /queue/leak-review` | admin, safety | This app's messages the leak guard parked (they survive a restart): `{ id, kind, to (masked), text, reasons, createdAt }` |
| `POST /queue/leak-review/:id` | admin, safety | `{ decision: "release" \| "drop", reason (5+ characters) }`. A release runs every other send check again; 409 `not_parked` |
| `POST /photos/:id/moderate` | safety or admin | `{ decision: "approve" \| "reject", reason }`: audited before and after. Approval needs a verified adult. A rejection drops the member's rating; it is made again from the other photos |
| `GET /bias` | admin or analyst | Runs the bias monitor now and returns the report (aggregates only). Under 0.8x it pauses matching |
| `POST /invite` | admin | `{ phone }`: an invite to this app (one text). A number on The Network's waitlist is let in at once (active, welcomed). An invite nobody answers ends after 30 days. |
| `GET /flags` | safety | Soft approval (PRD 28.3): joins a rule flagged, by member id, oldest first. A flagged member onboards but is never matched. |
| `POST /flags/:memberId` | safety | `{ decision: "clear" \| "keep" }`. `clear` lets the Network match them; `keep` keeps them out (hold or ban as well if needed). 409 `no_open_flag` |
| `POST /people/:id/phone-change` | admin@\* or support@\* | `{ newPhone }` (`:id` is a person id or a member id of this app): a code goes to the new number. 409 `number_in_use`, `not_allowed`, `rate_limited`, `no_person` |
| `POST /people/:id/phone-change/confirm` | admin@\* or support@\* | `{ code }` (the code the person read from the new number, within 30 minutes): the phone, the consent history, the age floor and the OAuth grants move to it; the old phone identity and its sessions end. 409 `invalid_code`, `no_pending_change` |
| `POST /matching` | admin | `{ on: true \| false }`. Refused (`matching_not_allowed`) for a network the registry keeps off. Migration 0011 allows slop and peon; their stored switch still starts off. |
| `/review-mode` | none | Always 404. Production review is "human" only (PRD 32.8). The service refuses any other mode at start. |

A refused action answers 409 with the Network's reason (for example `participant_minor`, `matching_paused`, `not_in_review`). A new stored state starts with matching off (runbook-real 7.4 check 8). An admin turns it on.

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

1. **One owner per inbound message.** Today the service handles every inbound message it gets, and STOP, START and HELP. If Eliza Cloud also gets the same webhook (the line already has an Eliza webhook; see the warning in `packages/blooio/README.md`), decide which one answers keywords before any live send **[FOUNDER]**. Two systems must not both confirm a STOP.
2. **Only this service proposes or contacts members about other members.** The plugin must not send probes, introductions or booked plans. It can read what the Network knows through its own store.
3. **Joining is a membership.** The platform creates members: a web join (`POST /api/join`) or a join by text on an open app makes the person, the membership and the `network.members` row. For The Network, Cloud's invite gate still creates the `network.members` and `network.channel_identities` rows. An `invited` member is not a member here.
4. **No shared process state.** The two talk only through Postgres (the `network` schema) and the channel gateway. Nothing here imports Eliza, and the plugin does not import this service.

## Limits

- **No live send has been made.** The Blooio path is tested only with a fake provider.
- **One process per line.** The queue's state is in Postgres, but dispatch is not shared: two replicas of the backend each run their own queue for the same line (the provider key still stops a double send). Run one backend replica while the line is live.
- **The queue's own STOP ledger is in memory.** STOP is enforced from the platform consent ledger and `network.members.opted_out` before delivery; a message that waits in the queue is checked again by the member policy at dispatch.
- **The requester's time question has no opportunity id.** The Network sends it with no `proposalId` (network.md 4.1), so its `network.messages` row has no `opportunity_id`. Probes are linked through `meta.probe.key`.
- **Invites are not built.** The Network's `ctx.invite` is not set, so an invite request logs `invite` with no new member.
- **The service imports the Observatory's modules** (`events.ts`, `engineCapture.ts`, `staff.ts`) by path, so the events, run summaries and staff auth are the same in both. The Observatory imports `snapshot.ts` from here.
- **No JWT check.** Use role tokens only, and keep the port on 127.0.0.1 or behind an access proxy.
- **No fencing on the save.** Two instances that both believe they hold a network's lock can overwrite each other's state (audit network-service-8).
- **One network engine for every app.** Each app's ConsentNetwork is The Network's code with that app's brand words and join age. The NYC places, time zone and copy are NYC only. The slop and peon packs are wired (`packs.ts`); their matching is off only by the stored switch (`POST /matching`).
- **Phones of platform members are in `platform.phone_identities` only.** `network.channel_identities` allows one member per address, so it cannot hold a phone that is a member of two apps. Console views that read phones from `channel_identities` do not see platform members.
