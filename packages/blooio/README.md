# @thenetwork/blooio

The Blooio (iMessage/SMS) channel layer for The Network: PRD 32.2 (channel gateway) and 36.1 (compliance and
deliverability). Used by the Network service (`packages/network/service`), the shared backend
(`deploy/backend/server.ts`) and the notifier (`packages/notify`). Research and live verification results are in
[docs/research/blooio.md](../../docs/research/blooio.md).

Nothing here sends a real message unless the backend runs with `BLOOIO_ALLOW_SEND=1` and the founder's approval flags (otherwise `DryRunAdapter`).
Promoted from `prototypes/messaging-blooio` on 2026-10-08; the standalone receiver, the simulated bus, the one-off
scripts and the tests were dropped (they remain in git history).

## What is here

| File | Purpose |
|---|---|
| `src/types.ts` | Channel-agnostic `ChannelAdapter`, `ChannelEvent` (message, status, typing, reaction, safety), `ChannelSendError` with a failure class the queue acts on |
| `src/blooio/client.ts` | Typed Blooio v4 client: read-only calls (`/me`, `/me/numbers`, `/channels`, `/webhooks`, status) and `send` (always sends `Idempotency-Key`; `mediaUrls` go as `attachments`). Classifies errors: 5xx/network are retryable; `429 conversation_*` means wait for the recipient; `403 safety_*` means blocked. The API key is never logged or serialized. |
| `src/blooio/webhook.ts` | `X-Blooio-Signature` HMAC verification (raw body, 300 s window), parsing for payload versions 2026-10-01, 2026-09-01, and legacy v2 flat bodies, media host allowlist, dedupe keys |
| `src/phone.ts` | `toE164` / `normalizeAddress`: international E.164 normalization. The queue and the line counters key on it. |
| `src/line.ts` | `resolveSenderLine()`: reads `BLOOIO_FROM` (canonical) or `BLOOIO_FROM_NUMBER` (alias), E.164-normalized; throws if both are set and differ |
| `src/quiet-hours.ts` | Quiet hours in the recipient's IANA zone (default 21:00-09:00), next-allowed-time (DST-safe), zone validation with a city fallback |
| `src/outbound-queue.ts` | The persisted outbound queue (`platform.outbound`, migration 0015) with the send-time checks below, Blooio safety-state handling, backoff retries reusing the same provider key, leases and crash recovery, hold-until-reply on conversation limits, delivery receipts |
| `src/adapters/blooio-adapter.ts` | `ChannelAdapter` over the client, plus `DryRunAdapter` |

## The queue (platform.outbound)

The Network service writes each message into the queue in the same transaction as the Network state
(the unit of work). The queue delivers after the commit. One queue object serves one app; every app on
the shared line uses the same tables and one advisory lock per line, so the line's counters hold for all
apps together.

- **Idempotency.** The row id is the key. Every provider attempt sends `Idempotency-Key: tn:<id>`, so a retry after a lost response, or a resend after a crash, cannot text the person twice (Blooio replays the original). The same id with other content is an error.
- **Leases and crash recovery.** A row is `sending` with a lease while the provider call runs. After a restart, `recover()` returns rows whose lease ran out to the queue; they go through every check again and are sent with the same key (`in_doubt` is set on them).
- **Retries.** Retryable errors back off (30 s, doubling, at most 30 min) and fail after 6 attempts. Blooio conversation limits hold the row until the person writes. Number-level blocks end it (`blocked`).
- **Receipts.** `message.delivered`, `message.read` and `message.failed` webhooks move a row to `delivered`, `read` or `failed`. A status never goes back.
- **Non-members.** A row to someone who is not a member (a join question, a decline) keeps the address and the text only until it ends.

## Send-time checks (at dispatch, in this order)

Agent-initiated means every kind except `reply` (a direct answer to the member's own message) and `compliance`
(STOP/HELP/START confirmations, a decline). Any new kind is agent-initiated by default. Each check reads the
database at send time, so a STOP that arrives while a message waits wins. Every app hook fails closed.

1. **Too old or stale**: a proactive row after 24 h, any row after 3 days, or a row about an opportunity that closed: `expired`.
2. **The live flags** (`refused_not_approved`).
3. **Consent** (not compliance): the platform consent ledger, bans and the member's own opt-out (`refused_opted_out`).
4. **The recipient at send time** (not compliance): paused, blocked, on safety hold, a minor for content about others (`suppressed_ineligible`). The Network runtime supplies it.
5. **A reply** must answer an inbound message from the same person within the last hour.
6. **Quiet hours** (default 21:00-09:00 recipient local) for every agent-initiated kind: deferred, never dropped. An unusable zone parks the row (`parked_invalid_timezone`).
7. **Apple line safety**: at most **3 unanswered** messages per conversation (line and address, across apps). After that, exactly **one re-engagement** once **14 days** have passed since our last send. Anything else waits until the person writes back (a message or a tapback), which resets both counters (`platform.line_conversations`).
8. **Blooio's safety state** of the line (`platform.line_safety`, from `safety.*` webhooks): `review` holds everything, `reply_only` holds agent-initiated and new conversations, `pause_new` holds new conversations.
9. **Caps**: per recipient per hour (10), agent-initiated messages per line per day (200, `BLOOIO_LINE_DAILY_CAP`), new conversations per line per day (20, `BLOOIO_LINE_NEW_CHATS_PER_DAY`). Prototype P3 sets the real numbers.
10. **The person cap** (proactive only): 3 a day across all apps (`refused_person_cap`); a send that does not go out gives its slot back.
11. **Leak guard**, immediately before the provider send: the shared `LeakGuard` from `packages/core/src/guard.ts` with the Network's lists for this recipient. Contact patterns are skipped only for compliance copy; the apps' own domains are allowed. A hit parks the row (`parked_leak_review`) with hashed reasons only.

## Environment

| Var | Meaning |
|---|---|
| `BLOOIO_API_KEY` | API key (never logged) |
| `BLOOIO_FROM` | The sending line, E.164 (no default; set it in the deploy environment). |
| `BLOOIO_FROM_NUMBER` | Accepted alias for `BLOOIO_FROM` (older `.env` files). If both are set they must match. |
| `BLOOIO_WEBHOOK_SECRET` | `whsec_...` for webhook verification |
| `BLOOIO_ALLOW_SEND` | `1` to send for real (with the founder's `NTWRK_LIVE_APPROVED=1` and `<APP>_LIVE_APPROVED=1`); otherwise dry-run |
| `BLOOIO_LINE_DAILY_CAP`, `BLOOIO_LINE_NEW_CHATS_PER_DAY` | The line's daily caps (defaults 200 and 20) |

Validation: `bun run sim --only pipeline` drives the queue end to end (signed webhook in, Postgres, the queue,
a fake provider out) with crash, outage, STOP and line-safety scenarios.
