# @thenetwork/notify

The single inbox and the notification scheduler from `docs/research/2026-10-08-entry-flows.md`, sections 4 and 5.

**The flow:**
- Every event becomes one inbox item.
- Every surface reads the same inbox.
- Each person gets at most one message per send, across all apps.
- That message points at the surface the member actually uses.

| Module | What it does |
|---|---|
| `store.ts` | The `NotifyStore` interface (inbox, deliveries, task tokens, surface signals) and `MemoryNotifyStore` |
| `pg-store.ts` | `PgNotifyStore` on Postgres with Bun's SQL client, schema in `db/schema.sql`. Import it directly: it is not exported from `index.ts`, so the connector's Workers build never pulls in `bun` |
| `scheduler.ts` | `Notifier`: due rules (requested at once, urgent after 5 min, normal after 4 h), quiet hours, a weekly cap of 2, a re-check before enqueue, `stillNeeded`, `readUpdates`, `redeemSubjects`, `shownSubjects`, `threadReply` and `sweep` (unanswered links become "ignored") |
| `surface.ts` | `resolveDelivery`: explicit choice, then score, then thread. Links unused twice fall back to the thread |
| `links.ts` | Fill-only assistant links (`chatgpt.com/?prompt=`, `claude.ai/new?q=`, `grok.com/?q=`), the `ntwrk.party/t/<token>` button page, and URL checks |
| `tokens.ts` | Task tokens `T-XXXXXX`. They are references, not credentials |
| `compose.ts` | Message text. Links never carry the item summary or an app brand |
| `wiring.ts` | Adapters: `queueSink` and `queuePolicy` for the outbound queue, `threadHooks` for the text agent and the plugin |

## Where it is wired

**Production:**
- **Service.** `packages/network/service/service.ts` builds `NetworkService.notify` with `PgNotifyStore` on the service database by default. `notify: false` turns it off.
  - **`delivered` hook.** After the adapter takes them (`runtime.ts` `RuntimeHost.delivered`), every member-facing Network send (probe, plan_probe, proposal, reminder, feedback_request, cancellation, scheduling) is recorded with `recordSent`. It is stored as already delivered, so nothing texts it again.
  - **Thread.** Every member text from the thread calls `threadReply`. An assistant's `submit_profile` does not, and neither does STOP.
  - **`notifyTick`.** Runs the outcome sweep, then `dispatch`. The inbox's own sends go out as a unit of work on the member's network (`runtime.system(..., type "notify")`), so the platform consent ledger, the member's opt-out and the person cap apply, as for every other send.
- **MCP.** `packages/mcp` has the tool `get_updates` (scope `membership:read`, the grant's own app only, optional `update_token`). Its hooks `updates` and `assistantLinked` are wired in `serve.ts`. The assistant is identified by the client's redirect hosts (`assistantOf`). Consent marks the assistant active, and every revocation path marks it inactive.
- **Ticks.** `deploy/backend/backend.ts` runs `svc.notifyTick()` once per round, after the networks. The standalone `serve.ts` does the same. Replicas may overlap safely: a delivery id is recorded once.
- **Migrations.** `packages/observatory/db/migrate.ts` applies `db/schema.sql` as the repeatable `9002_notify_schema`, then `db/retention.sql` once as `9003_notify_retention`. Only `network_service` writes the inbox.
- **Retention.** The existing Network forget transaction seals the member record, then calls `notify.forget_data` for that app. Full account deletion clears the person's remaining inbox, delivery, task-token and surface-signal data in the existing platform deletion transaction. Mixed-app references keep their surviving item IDs. Shared surface signals stay while another live or pending membership remains; last leave and full deletion clear them. Canonical person/member and item-row locks fence late inserts without a second deletion ledger. The privileged cleanup requires an already removed member/membership in the current app scope, or a deleted person for full erasure; it cannot erase a live scope merely because the caller holds the service role. STOP, suppression and service person-cap data are untouched by this cleanup.

**Prototypes and the plugin:**
- **Outbound queue** (`packages/blooio`). Use `queueSink(queue, providerFor)` and `recipientPolicy: queuePolicy(notifier, existing)`.
- **`packages/plugin-network`.** Set `NetworkStore.readUpdates = threadHooks(notifier, now).readUpdates` to register `GET_UPDATES`.

**Validation:** `bun --no-env-file --conditions=eliza-source test deploy/backend/backend.test.ts -t 'Notify '` uses isolated Postgres and the real leave/delete/projection owners. It covers mixed-app references, other-person isolation, STOP/suppression, concurrent last leave, a held accepted projection, late writes and restart. The older notifier unit/e2e tests were removed on 2026-10-08 (history at `16cde70`).

## Not yet

- **Producers that don't already text.** Today every update is texted by the Network itself and only recorded here. Moving a member to "updates by link in my assistant" means having the engine add the item to the inbox instead of texting it, then letting `dispatch` choose the surface.
- **Member settings.** There is no setting for a preferred surface yet ("send my updates to Claude"). `Recipient.prefs.explicit` is ready for one.
- **Button page.** The `ntwrk.party/t/<token>` page is not built yet.

## Device test

Run `bun run scripts/link-test-page.ts` and follow `docs/runbook-deeplink-test.md`.
