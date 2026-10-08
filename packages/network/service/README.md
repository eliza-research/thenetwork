# The Network service (production runtime)

This folder holds the production process for the ConsentNetwork. One process runs one network per row of `platform.networks` (`ntwrk:nyc`, `slop:nyc`, `peon:nyc`, `buddies:nyc`; platform plan 6.1). It runs each network against Postgres, takes inbound messages from the channel gateway, serves the public API the four sites call, and gives staff a small API for review and safety. Nothing in this folder is deployed. Local dev for the whole platform: [docs/runbook-platform.md](../../../docs/runbook-platform.md).

**Sends are dry-run.** The default adapter stores each message in `network.messages` with status `dry_run` and sends nothing. The Blooio adapter refuses every message unless `BLOOIO_ALLOW_SEND=1`, `NTWRK_LIVE_APPROVED=1` and the app's own `<APP>_LIVE_APPROVED=1` are set (for ntwrk the last two are the same flag). Set an approval flag only with the founder's approval.

| File | What it does |
|---|---|
| `service.ts` | `NetworkService`: the networks, inbound routing (line, keyword, person, membership), keywords through the platform consent ledger, text joins, the person cap, the platform hooks, the staff API |
| `runtime.ts` | `NetworkRuntime`: one network under its own lock, its snapshot and address book, the unit of work and the save transaction |
| `snapshot.ts` | `loadSnapshot(sql, now, { app, city })`: one app's rows only, plus person-to-person blocks |
| `channel.ts` | The adapters (dry-run, Blooio) and the live flags |
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
| `PLATFORM_STOP_SCOPE` | `app` | STOP on an app's own line stops that app only; `global`: every app. On the shared line STOP stops every app. |
| `PLATFORM_HASH_KEY` | dev key | The key for phone hashes (suppression, rate limits). Required in production. |
| `OTP_PROVIDER` | dev console | `twilio` uses Twilio Verify (needs its credentials). The dev console provider refuses production. |
| `NETWORK_SERVICE_HOST`, `NETWORK_SERVICE_PORT` | `127.0.0.1`, `4848` | The bind address. Another host prints a warning. |
| `NETWORK_SERVICE_INSTANCE` | the process id | The name in `pg_stat_activity` (the lock holder in `/health`) |
| `NETWORK_CHANNEL` | dry-run | `blooio` uses the Blooio adapter (needs `BLOOIO_API_KEY`, `BLOOIO_FROM`). `--dry-run` always wins. |
| `BLOOIO_ALLOW_SEND`, `NTWRK_LIVE_APPROVED`, `<APP>_LIVE_APPROVED` | off | All `1` for the app: the Blooio adapter sends for it. **[FOUNDER]** |

## What it does

| Part | How |
|---|---|
| Tick | Every minute, each network on its own: `runTick()` with its `PgStore` under its advisory lock (`network-tick-<app>:<city>`). A second instance skips a network while its lock is held. The engine runs once a day inside the tick (09:00 New York), as in the simulator. The clock is `RealClock`. A network whose `platform.networks.matching_enabled` is false never matches, whatever its stored switch says. |
| Snapshot | `snapshot.ts` reads one app's members, facets, intents, presence, edges and recent opportunities at the start of every unit of work. Every query filters by `app_id`. A person-to-person block (`platform.person_blocks`, from any app) is a "blocked" edge when both people are members of this app. The Observatory's shadow runs use the same builder (The Network by default). |
| Inbound | `POST /webhooks/blooio/<app>` (one app's line) and `POST /webhooks/blooio` (the shared line: `platform.app_lines`, then a keyword such as "slop.date", then the member's app, then The Network). Each checks `X-Blooio-Signature` on the raw body (300 s window). The phone finds the person (`platform.phone_identities`), then the membership, then the member id; members from before the platform use `network.channel_identities`. Each message is one unit of work on that app's network. A provider retry is handled once. Someone who is not a member: on an open app, the join by text (first name and age; nothing stored until the age check passes); on The Network (invite-only), one invite-only reply a day, nothing stored. |
| Keywords | STOP, STOP ALL, START and HELP go through the platform consent ledger (`platform.consent_events`) with the app's own texts (`packages/platform/src/apps.ts`). STOP stops the app of the line (`PLATFORM_STOP_SCOPE`), STOP ALL and STOP on the shared line stop every app. "leave <app>" leaves one app (the forget path). |
| Public API | `/api/*` on `PLATFORM_API_PORT` (`createPublicApi`). A web join creates the network member for that app and queues the welcome through the normal send path. Stop, leave, delete everything and export call the network paths. |
| Person cap | At most 3 proactive messages a day for one person across all apps (PRD 40.3), checked when a send is handed to the adapter. Over the cap: `refused_person_cap`. |
| Saves | The Network state, its console rows, and what the unit produced (messages, events, blocks, engine runs, opt-outs) are written in one transaction. Then the adapter delivers. |
| Under 13 | The decline goes out. Then the member's row keeps only the id (`account_status = 'removed'`). Their messages, facets, intents, presence, edges, phone and events are deleted (every event that names them: actor, object or payload). |
| Outbound | `ChannelAdapter` (`channel.ts`). `DryRunAdapter` is the default. `BlooioAdapter` wraps the prototype's `OutboundQueue` with `blooioRecipientPolicy` and `forbiddenProvider`, and refuses without both live flags. |
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
| `POST /matching` | admin | `{ on: true \| false }`. Refused (`matching_not_allowed`) for a network the registry keeps off (slop and peon until their packs ship). |
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

1. **One owner per inbound message.** Today the service handles every inbound message it gets, and STOP, START and HELP. If Eliza Cloud also gets the same webhook (the line already has an Eliza webhook; see the warning in `prototypes/messaging-blooio/README.md`), decide which one answers keywords before any live send **[FOUNDER]**. Two systems must not both confirm a STOP.
2. **Only this service proposes or contacts members about other members.** The plugin must not send probes, introductions or booked plans. It can read what the Network knows through its own store.
3. **Joining is a membership.** The platform creates members: a web join (`POST /api/join`) or a join by text on an open app makes the person, the membership and the `network.members` row. For The Network, Cloud's invite gate still creates the `network.members` and `network.channel_identities` rows. An `invited` member is not a member here.
4. **No shared process state.** The two talk only through Postgres (the `network` schema) and the channel gateway. Nothing here imports Eliza, and the plugin does not import this service.

## Limits

- **No live send has been made.** The Blooio path is tested only with a fake provider.
- **The Blooio queue is in memory.** Its conversation counters start again after a restart. The rows in `network.messages` keep the status. A restart hands every waiting row to the queue again; the provider's idempotency key stops a second send.
- **`GET /review` saves the state.** It runs as a unit of work under the lock, so it loads the newest state. The save writes the same state again.
- **The requester's time question has no opportunity id.** The Network sends it with no `proposalId` (network.md 4.1), so its `network.messages` row has no `opportunity_id`. Probes are linked through `meta.probe.key`.
- **Invites are not built.** The Network's `ctx.invite` is not set, so an invite request logs `invite` with no new member.
- **The service imports the Observatory's modules** (`events.ts`, `engineCapture.ts`, `staff.ts`) by path, so the events, run summaries and staff auth are the same in both. The Observatory imports `snapshot.ts` from here.
- **No JWT check.** Use role tokens only, and keep the port on 127.0.0.1 or behind an access proxy.
- **A text join waits in memory.** The first name and age a person gave before both arrived, and the SHARE offer, live in the process only. After a restart the person is asked again. Two instances do not share them.
- **The person cap reads every app's message counts.** Under the `network_service` role (row-level security, one app per unit of work) that read needs a security-definer function or a platform counter. In dev the service connects as the owner.
- **One network engine for every app.** Each app's ConsentNetwork is The Network's code with that app's brand words and join age. The NYC places, time zone and copy are NYC only. slop and peon need their engine packs before their matching can be turned on.
- **Phones of platform members are in `platform.phone_identities` only.** `network.channel_identities` allows one member per address, so it cannot hold a phone that is a member of two apps. Console views that read phones from `channel_identities` do not see platform members.
