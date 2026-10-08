# @thenetwork/blooio

The Blooio (iMessage/SMS) channel layer for The Network: PRD 32.2 (channel gateway) and 36.1 (compliance and
deliverability). Used by the Network service (`packages/network/service`), the shared backend
(`deploy/backend/server.ts`) and the notifier (`packages/notify`). Research and live verification results are in
[docs/research/blooio.md](../../docs/research/blooio.md).

Nothing here sends a real message unless the backend runs with `BLOOIO_ALLOW_SEND=1` (otherwise `DryRunAdapter`).
Promoted from `prototypes/messaging-blooio` on 2026-10-08; the standalone receiver, the simulated bus, the one-off
scripts and the tests were dropped (they remain in git history).

## What is here

| File | Purpose |
|---|---|
| `src/types.ts` | Channel-agnostic `ChannelAdapter`, `ChannelEvent` (message, status, typing, reaction, safety), `ChannelSendError` with a failure class the queue acts on |
| `src/blooio/client.ts` | Typed Blooio v4 client: read-only calls (`/me`, `/me/numbers`, `/channels`, `/webhooks`, status) and `send` (always sends `Idempotency-Key`). Classifies errors: 5xx/network are retryable; `429 conversation_*` means wait for the recipient; `403 safety_*` means blocked. The API key is never logged or serialized. |
| `src/blooio/webhook.ts` | `X-Blooio-Signature` HMAC verification (raw body, 300 s window), parsing for payload versions 2026-10-01, 2026-09-01, and legacy v2 flat bodies, media host allowlist, dedupe keys |
| `src/keywords.ts` | The consent ledger (E.164-keyed; optional durable store) and STOP/HELP/START handling on the keyword table in `packages/core/src/replies.ts` |
| `src/consent-store.ts` | `ConsentStore` interface, `InMemoryConsentStore`, and `FileConsentStore` (append-only JSONL) |
| `src/phone.ts` | `toE164` / `normalizeAddress`: international E.164 normalization. Queue, ledger, caps and line safety all key on it. |
| `src/line.ts` | `resolveSenderLine()`: reads `BLOOIO_FROM` (canonical) or `BLOOIO_FROM_NUMBER` (alias), E.164-normalized; throws if both are set and differ |
| `src/quiet-hours.ts` | Quiet hours in the recipient's IANA zone (default 21:00-09:00), next-allowed-time (DST-safe), zone validation with a city fallback |
| `src/outbound-queue.ts` | Idempotent outbound queue with pre-send enforcement (below), Blooio safety-state handling, backoff retries reusing the same provider key, hold-until-reply on conversation limits, fallback to a second adapter (e.g. Twilio SMS) |
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
4. **Conversation rules**: at most **3 unanswered** messages per conversation. After that, exactly **one
   re-engagement** is allowed once **14 days** have passed since our last send. Anything else is held until the
   member writes back (a message or tapback), which resets both counters. Counters are in memory.
5. **Line safety** from Blooio `safety.*` webhooks.
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

Opt-outs persist through a `ConsentStore` (the service uses Postgres; `FileConsentStore` writes append-only JSONL).

## Environment

| Var | Meaning |
|---|---|
| `BLOOIO_API_KEY` | API key (never logged) |
| `BLOOIO_FROM` | The sending line, E.164 (no default; set it in the deploy environment). |
| `BLOOIO_FROM_NUMBER` | Accepted alias for `BLOOIO_FROM` (older `.env` files). If both are set they must match. |
| `BLOOIO_WEBHOOK_SECRET` | `whsec_...` for webhook verification |
| `BLOOIO_ALLOW_SEND` | `1` to send for real; otherwise dry-run |

Validation: the channel rules are exercised end to end by the Network simulations (`bun run sim`).
