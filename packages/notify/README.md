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
| `links.ts` | Fill-only assistant links (`chatgpt.com/?prompt=`, `claude.ai/new?q=`, `grok.com/?q=`), the `ntwrk.love/t/<token>` button page, and URL checks |
| `tokens.ts` | Task tokens `T-XXXXXX`. They are references, not credentials |
| `compose.ts` | Message text. Links never carry the item summary or an app brand |
| `wiring.ts` | Adapters: `queueSink` and `queuePolicy` for the outbound queue, `connectorInbox` for the MCP connector, `threadHooks` for the text agent and the plugin |

## Where it is wired

| Target | How | Test |
|---|---|---|
| `prototypes/messaging-blooio` OutboundQueue | `queueSink(queue, providerFor)` as the sink. `recipientPolicy: queuePolicy(notifier, existingPolicy)` suppresses a queued message whose items were seen elsewhere (`seen_elsewhere`) | `test/wiring.test.ts` |
| `prototypes/connector-mcp` `get_network_updates` | `new FakeNetwork(clock, { inbox: connectorInbox(notifier, now) })`. The new optional `update_token` input limits the result to that text's items. Items shown are marked seen. Foreign or unknown codes return an empty list | `prototypes/connector-mcp/tests/notify-bridge.test.ts` |
| `packages/plugin-network` | `NetworkStore.readUpdates = threadHooks(notifier, now).readUpdates` registers the `GET_UPDATES` action ("updates", "what's new") | `packages/plugin-network/test/get-updates.test.ts` |
| Postgres | `db/schema.sql` (schema `notify`). Same contract as the memory store | `test/store-contract.test.ts` (runs on the dev cluster at :54339, skipped without Postgres) |

## Left for the platform owner

1. **Migration.** Add `db/schema.sql` as the next migration after `0006_platform_safety.sql` on `obs/network-console`, and grant the platform service role.
2. **Text gateway.** On every inbound member message, call `threadHooks(...).inbound(personId, channel)`.
3. **Cron.** Run `notifier.dispatch(now, sink)` and `notifier.sweep(now)` every minute or so.
4. **Grants.** On OAuth grant issue and revoke, call `notifier.setActive(person, "chatgpt" | "claude" | "grok", true/false)`.
5. **Producers.** The engine, plans and reminders call `notifier.add(...)` with a member-safe `summary` that has already been through the leak guard.
6. **Button page.** `ntwrk.love/t/<token>` renders `buttonPageButtons`. It needs no login and shows nothing personal.

## Device test

Run `bun run scripts/link-test-page.ts` and follow `docs/runbook-deeplink-test.md`.
