# @thenetwork/blooio

The Blooio (iMessage/SMS) channel layer for The Network: PRD 32.2 (channel gateway) and 36.1 (compliance and
deliverability). Used by the Network service (`packages/network/service`), the shared backend
(`deploy/backend/server.ts`) and the notifier (`packages/notify`). Research and live verification results are in
[docs/research/blooio.md](../../docs/research/blooio.md).

Nothing here sends a real message unless the backend runs with `NETWORK_CHANNEL=blooio`, `BLOOIO_ALLOW_SEND=1` and an
app's `<APP>_LIVE_APPROVED=1` (the flag matrix is in `packages/network/service/README.md`). Otherwise the backend runs
the same queue against `DryRunAdapter`, a recording fake provider.
Promoted from `prototypes/messaging-blooio` on 2026-10-08; the standalone receiver, the simulated bus, the one-off
scripts and the tests were dropped (they remain in git history).

## What is here

| File | Purpose |
|---|---|
| `src/types.ts` | Channel-agnostic `ChannelAdapter`, `ChannelEvent` (message, status, typing, reaction, safety), `ChannelSendError` with a failure class the queue acts on |
| `src/blooio/client.ts` | Typed Blooio v4 client: read-only calls (`/me`, `/me/numbers`, `/channels`, `/webhooks`, status) and `send` (always sends `Idempotency-Key`). Classifies errors: 5xx/network are retryable; `429 conversation_*` means wait for the recipient; `403 safety_*` means blocked. The API key is never logged or serialized. |
| `src/blooio/webhook.ts` | `X-Blooio-Signature` HMAC verification (raw body, 300 s window), parsing for payload versions 2026-10-01, 2026-09-01, and legacy v2 flat bodies, media host allowlist, dedupe keys |
| `src/ledger.ts` | The consent ledger (E.164-keyed; optional durable store). STOP/HELP/START are read by the platform consent ledger on the keyword table in `packages/core/src/replies.ts`. |
| `src/consent-store.ts` | `ConsentStore` interface, `InMemoryConsentStore`, and `FileConsentStore` (append-only JSONL) |
| `src/phone.ts` | `toE164` / `normalizeAddress`: international E.164 normalization. Queue, ledger, caps and line safety all key on it. |
| `src/line.ts` | `resolveSenderLine()`: reads `BLOOIO_FROM` (canonical) or `BLOOIO_FROM_NUMBER` (alias), E.164-normalized; throws if both are set and differ |
| `src/quiet-hours.ts` | Quiet hours in the recipient's IANA zone (default 21:00-09:00), next-allowed-time (DST-safe), zone validation with a city fallback |
| `src/outbound-queue.ts` | Idempotent outbound queue with pre-send enforcement (below), Blooio safety-state handling, backoff retries reusing the same provider key, hold-until-reply on conversation limits, fallback to a second adapter (e.g. Twilio SMS). Its state goes through a `QueueStore` (`InMemoryQueueStore` by default). |
| `src/pg-queue-store.ts` | `PgQueueStore`: the queue's state in Postgres (migration 0014: `network.outbound_queue`, `outbound_sends`, `outbound_contacts`, `outbound_inbound`, `line_safety`), and its alerts as `network.events` rows of type `queue_alert` |
| `src/adapters/blooio-adapter.ts` | `ChannelAdapter` over the client, plus `DryRunAdapter` |

## Pre-send enforcement (checked at dispatch, in this order)

Agent-initiated means every kind except `reply` (a direct answer to the member's own message) and `compliance`
(STOP/HELP/START confirmations). Any new kind is agent-initiated by default.

1. **Opt-out** from the consent ledger (all kinds except compliance), and recorded consent for `proactive`.
2. **Recipient eligibility**: the optional `recipientPolicy(to, { kind, agentInitiated, ... })` hook re-checks the
   member at send time (paused, blocked, safety hold, minor, opted out in the member store). It fails closed if it
   throws. The Network runtime supplies it (packages/network/service/channel.ts). For `chat:<id>` group targets it must check every participant.
3. **Quiet hours** (default 21:00-09:00 recipient local) for every agent-initiated kind, not just proactive.
   The zone is validated at enqueue, with the member's city as a fallback; an unusable zone parks that one record
   (`parked_invalid_timezone`) and alerts. It never blocks the rest of the queue.
4. **Conversation rules** (PRD 41.4): an interruption (any agent-initiated kind) goes only while at most **1**
   message is unanswered (`maxUnansweredForInterruption`); replies are exempt from that, but nothing except compliance
   goes once **3** are unanswered (Blooio's limit). Past either cap, exactly **one re-engagement** is allowed once
   **30 days** have passed since our last send. Anything else is held until the member writes back (a message or
   tapback), which resets both counters. The counters are in the store, so a restart keeps them.
5. **Line safety** from Blooio `safety.*` webhooks. An event that names no line applies to the default line
   (`BLOOIO_FROM`), or to every line (`*`) when none is configured: it fails closed. Stored, so a restart keeps it.
6. **Rate limits**: per-recipient hourly cap, and the per-line daily cap on brand-new conversations (default 20)
   for every agent-initiated kind. The line comes from `from`, else `defaultFrom` (set from `BLOOIO_FROM`).
7. **Leak guard**, immediately before the provider send: the shared `LeakGuard` from `packages/core/src/guard.ts`.
   The optional `forbiddenProvider(recipient, message) => { forbidden, facts, privateVocab, canaries, publicPhrases }`
   supplies the recipient-specific lists (other members' private facts, never the recipient's own); it may be async
   and fails closed if it throws. Without a provider, contact patterns (phone, email, address, URL, handle) and
   canary-shaped tokens are still checked. Compliance copy skips only the contact patterns; `leakAllow` lists other
   fixed copy that may carry the Network's own contact details. A hit parks the record (`parked_leak_review`), stores
   hashed reasons in `leakReasons` and history (never the text or the matched value) and alerts `leak_blocked`.
   `leakReviewQueue()` lists parked records; `resolveLeakReview(key, "approve" | "drop")` re-queues (skipping only the
   leak check) or ends them.

Every address is normalized to E.164 first, so `+1 (555) 010-0001`, `15550100001` and `+15550100001` share one
opt-out, one counter and one cap. An unexpected error while dispatching one record parks it (`parked_error`) and
alerts; the drain continues.

## State and restarts

`start()` loads the store: waiting records, records of the last 30 days (so a receipt after a restart updates its
row), the send counters of the last day, the contacts, line safety and the last inbound per address. `flush()` writes
what changed as one batch; `drain()` flushes after every record. A stored record keeps its text and address only
while it may still be sent or is parked for leak review; a final record keeps neither. Counters key on
`addressKey` (the service passes a keyed hash), never the number. `prune()` removes final records older than 30
days (never a waiting or parked one), old counters and contacts idle for 180 days, in memory and in the store.
Parked leak-review records survive a restart; the service's staff API lists and resolves them.

The queue's consent ledger is not durable. In the service, the source of truth for STOP is the platform consent
ledger (`platform.consent_events`) and the member's `opted_out` flag, both checked before every delivery
(`packages/network/service/runtime.ts`). `ConsentStore` and `FileConsentStore` (append-only JSONL) are for a
standalone ledger; the service does not use them.

## Environment

| Var | Meaning |
|---|---|
| `BLOOIO_API_KEY` | API key (never logged) |
| `BLOOIO_FROM` | The sending line, E.164 (no default; set it in the deploy environment). |
| `BLOOIO_FROM_NUMBER` | Accepted alias for `BLOOIO_FROM` (older `.env` files). If both are set they must match. |
| `BLOOIO_WEBHOOK_SECRET` | `whsec_...` for webhook verification |
| `BLOOIO_ALLOW_SEND` | `1` (with an app's `<APP>_LIVE_APPROVED=1`) to send for real; otherwise the queue dry run |
| `QUEUE_MAX_UNANSWERED` | Interruptions go while at most this many are unanswered (default 1) |
| `QUEUE_REENGAGE_AFTER_DAYS` | Days of silence before the single re-engagement (default 30) |

Validation: `packages/blooio/test/outbound-queue.test.ts` (both stores, restarts, receipts, pruning, line safety) and
`deploy/backend/queue.test.ts` (the backend's line in the queue dry run). The Network simulations (`bun run sim`) do
not use this queue.
