# @thenetwork/notify

The single inbox and the notification scheduler from `docs/research/2026-10-08-entry-flows.md`, sections 4 and 5. Pure logic with in-memory stores, the same pattern as `prototypes/messaging-blooio`.

**The flow:**
- Every event becomes one inbox item.
- Every surface reads the same inbox.
- Each person gets at most one message per send, across all apps.
- That message points at the surface the member actually uses.

| Module | What it does |
|---|---|
| `inbox.ts` | One item per (person, app, event type, subject). Seen on any surface means seen everywhere |
| `scheduler.ts` | `Notifier`: due rules (requested now, urgent after 5 min, normal after 4 h), quiet hours, a weekly cap of 2, a re-check before enqueue, `stillNeeded` for the queue, and `readUpdates` for assistants |
| `surface.ts` | `resolveDelivery`: explicit choice, then score, then thread. Links unused twice fall back to the thread |
| `signals.ts` | Acted and ignored counts per surface, which feed `resolveDelivery` |
| `links.ts` | Fill-only assistant links (`chatgpt.com/?prompt=`, `claude.ai/new?q=`, `grok.com/?q=`), the `ntwrk.love/t/<token>` button page, and URL checks (https, allowed hosts, no shorteners, max 160 characters) |
| `tokens.ts` | Task tokens `T-XXXXXX`. They are references, not credentials. They are bound to a person, expire after 7 days, and return a generic miss for anyone else |
| `compose.ts` | Message text. Links never carry the item summary or an app brand |

## Wiring it into the platform (not done here)

1. **Outbound.** Pass the `prototypes/messaging-blooio` `OutboundQueue` as the `OutboundSink`. `briefId` is the delivery id. In the queue's `recipientPolicy`, return `{ ok: false, reason: "seen_elsewhere" }` when `notifier.stillNeeded(ctx.briefId)` is false.
2. **Assistants.** `get_network_updates` calls `notifier.readUpdates(personIdFromGrant, surface, now, text, findToken(text))`. The person id must come from the OAuth grant or agent key, never from tool arguments.
3. **Thread.** An inbound message from the member calls `notifier.threadReply(...)`. "updates" in the thread is `readUpdates(..., "imessage")`.
4. **Grants.** `signals.setActive(person, "chatgpt" | "claude" | "grok", true/false)` on grant issue and revoke.
5. **Producers.** The engine, plans and reminders call `inbox.add`. Each gives a member-safe `summary` that has already been through the leak guard.
6. **Storage.** Postgres tables `notify.inbox_items` (unique `dedupe_key`), `notify.task_tokens`, `notify.surface_signals` and `notify.deliveries`. The interfaces here are the contract.
7. **Button page.** `ntwrk.love/t/<token>` renders `buttonPageButtons`. It needs no login and shows nothing personal.

## Device test

Run `bun run scripts/link-test-page.ts` and follow `docs/runbook-deeplink-test.md`.
