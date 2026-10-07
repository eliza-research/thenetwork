# messaging-blooio (prototype)

Blooio (iMessage/SMS) channel layer for The Network: PRD 32.2 (channel gateway) and 36.1 (compliance and deliverability).
Research, live verification results, and recommendations are in [docs/research/blooio.md](../../docs/research/blooio.md).

Nothing in this directory sends a real message unless a human runs `scripts/first-send.ts` with both required flags,
or starts the receiver with `BLOOIO_ALLOW_SEND=1`.

## What is here

| File | Purpose |
|---|---|
| `src/types.ts` | Channel-agnostic `ChannelAdapter`, `ChannelEvent` (message, status, typing, reaction, safety), `ChannelSendError` with a failure class the queue acts on |
| `src/blooio/client.ts` | Typed Blooio v4 client: read-only calls (`/me`, `/me/numbers`, `/channels`, `/webhooks`, status) and `send` (always sends `Idempotency-Key`). Classifies errors: 5xx/network are retryable; `429 conversation_*` means wait for the recipient; `403 safety_*` means blocked. The API key is never logged or serialized. |
| `src/blooio/webhook.ts` | `X-Blooio-Signature` HMAC verification (raw body, 300 s window), parsing for payload versions 2026-10-01, 2026-09-01, and legacy v2 flat bodies, media host allowlist, dedupe keys |
| `src/dedupe.ts` | Claim/commit/release dedupe store (envelope id + message id; 7-day TTL) |
| `src/keywords.ts` | STOP/HELP/START detection (exact match after normalization) and the consent ledger (E.164-keyed; optional durable store) |
| `src/consent-store.ts` | `ConsentStore` interface, `InMemoryConsentStore`, and `FileConsentStore` (append-only JSONL) so opt-outs survive restarts. Production: Postgres. |
| `src/phone.ts` | `toE164` / `normalizeAddress`: the one place addresses are normalized. Queue, ledger, caps and line safety all key on it. |
| `src/line.ts` | `resolveSenderLine()`: reads `BLOOIO_FROM` (canonical) or `BLOOIO_FROM_NUMBER` (alias), E.164-normalized; throws if both are set and differ |
| `src/quiet-hours.ts` | Quiet hours in the recipient's IANA zone (default 21:00-09:00), next-allowed-time (DST-safe), zone validation with a city fallback |
| `src/outbound-queue.ts` | Idempotent outbound queue with pre-send enforcement (below), Blooio safety-state handling, backoff retries reusing the same provider key, hold-until-reply on conversation limits, fallback to a second adapter (e.g. Twilio SMS) |
| `src/gateway.ts` | One entry point for events from any adapter: dedupe, then release held sends, then keywords, then the agent |
| `src/server.ts`, `src/main.ts` | Local webhook receiver (`POST /webhooks/blooio`, `GET /healthz`); dry-run sends by default |
| `src/adapters/blooio-adapter.ts` | `ChannelAdapter` over the client, plus `DryRunAdapter` |
| `src/adapters/sim-adapter.ts` | `SimBus`: an in-memory channel with the same adapter and event shapes, for simulated personas and tests |
| `scripts/verify-readonly.ts` | Read-only check of the key: account, lines, channels, webhooks. Prints no secrets. |
| `scripts/first-send.ts` | The one script that sends a real message. Refuses to run without `--to` and `--confirm`. |

## Pre-send enforcement (checked at dispatch, in this order)

Agent-initiated means every kind except `reply` (a direct answer to the member's own message) and `compliance`
(STOP/HELP/START confirmations). Any new kind is agent-initiated by default.

1. **Opt-out** from the consent ledger (all kinds except compliance), and recorded consent for `proactive`.
2. **Recipient eligibility**: the optional `recipientPolicy(to, { kind, agentInitiated, ... })` hook re-checks the
   member at send time (paused, blocked, safety hold, minor, opted out in the member store). It fails closed if it
   throws. The prototype receiver has no member store, so the Network runtime **must** supply one before live
   agent-initiated sends. For `chat:<id>` group targets it must check every participant.
3. **Quiet hours** (default 21:00-09:00 recipient local) for every agent-initiated kind, not just proactive.
   The zone is validated at enqueue, with the member's city as a fallback; an unusable zone parks that one record
   (`parked_invalid_timezone`) and alerts. It never blocks the rest of the queue.
4. **Conversation rules**: at most **3 unanswered** messages per conversation. After that, exactly **one
   re-engagement** is allowed once **14 days** have passed since our last send. Anything else is held until the
   member writes back (a message or tapback), which resets both counters. Counters are in memory in this prototype.
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

Opt-outs persist: `src/main.ts` uses `FileConsentStore` at `runs/blooio/consent.jsonl` (gitignored), or
`BLOOIO_CONSENT_FILE`.

## Environment

| Var | Meaning |
|---|---|
| `BLOOIO_API_KEY` | API key (never logged) |
| `BLOOIO_FROM` | The sending line, E.164. For the Network: `+18087881821`. |
| `BLOOIO_FROM_NUMBER` | Accepted alias for `BLOOIO_FROM` (older `.env` files). If both are set they must match. |
| `BLOOIO_WEBHOOK_SECRET` | `whsec_...` for the receiver |
| `BLOOIO_ALLOW_SEND` | `1` to send for real; otherwise dry-run |
| `BLOOIO_CONSENT_FILE` | Optional path for the durable consent ledger |
| `BLOOIO_LIVE_TEST` | `1` to run the read-only live test |

## Tests

```bash
cd prototypes/messaging-blooio
bun test                                   # offline: recorded-shape fixtures + mocked fetch + SimBus
BLOOIO_LIVE_TEST=1 bun test tests/live.readonly.test.ts   # live, read-only: GET /v4/me and /v4/me/numbers
bun run scripts/verify-readonly.ts         # live, read-only summary
```

The live test is gated on `BLOOIO_API_KEY` **and** `BLOOIO_LIVE_TEST=1`. Bun auto-loads the repo-root `.env`, which
holds the key, so gating on the key alone would make a plain `bun test` from the repo root call the network.

The fixtures in `tests/fixtures/` are reconstructed from the Blooio docs and the schemas Eliza parses in production.
They were not captured from live webhooks. After the first real send, capture real payloads and add them (see step 6 below).

Coverage maps to the PRD 21 channel-gateway rows: signature checks and dedupe (including retries and a second
subscription), outbound idempotency (same key delivers once, including a retry after a lost response), STOP/HELP/START,
quiet hours across zones and DST, fallback on terminal failure and on a `message.failed` receipt, retry backoff,
per-recipient and per-line rate limits, Blooio conversation limits, and line safety states. The same gateway runs
on the simulated bus.

## First real send (a human does this; it has not been run)

Do this only to **your own phone**. The first message to a new contact uses that line's first-contact allowance
(3 messages before a reply) and counts toward Blooio's one-way-outreach signals.

1. **The line.** `+18087881821` is the founder's Network line, owned by the key in `.env`. Set
   `BLOOIO_FROM=+18087881821` in `.env` (`BLOOIO_FROM_NUMBER` also works), or pass `--from`.

   > **Warning: double STOP/HELP handling.** The Blooio org already has a webhook on this line that points at an
   > Eliza host (`ovh-eliza`). If you also point a webhook at this receiver, **both** systems will see every inbound
   > message, and both may answer STOP/HELP/START, so a member could get two confirmations and two consent
   > ledgers could disagree. Decide which system owns keyword replies before setting `BLOOIO_ALLOW_SEND=1`.
   > Do not change or repoint the existing webhook from this repo; that is an account change for the owner.
2. **Run the read-only check:** `bun run scripts/verify-readonly.ts`. Confirm the line is `active` and not `suspended`.
3. **Send one message:**
   ```bash
   bun run scripts/first-send.ts --to +1YOURCELL --confirm --from +18087881821
   ```
   The script refuses to run unless both `--to` (E.164) and `--confirm` are given. It uses an idempotency key derived from
   the recipient and the UTC date, so running it twice on the same day does not send twice. It then polls
   `GET /chats/{chat}/messages/{id}/status` for 30 seconds and prints `status` and `protocol`.
   You should see `queued`, then `sent`, then `delivered`, with `protocol` resolving from `pending` to `imessage` or `sms`.
4. **Check on the phone.** A blue bubble means iMessage. Reply with anything: this unlocks links and media in that chat
   and raises the conversation allowance.
5. **Test inbound (optional).** This needs a webhook, which is a change to the Blooio account, so it needs its owner's
   approval. Do not repoint the existing `ovh-eliza` webhook.
   - `bunx ngrok http 8787` (or any tunnel)
   - Create a **new** webhook in the dashboard (or `POST /v4/webhooks`) pointing at `https://<tunnel>/webhooks/blooio`,
     scoped to the Network key, with `api_version` `2026-10-01`. Save the `whsec_...` secret; Blooio shows it only once.
   - `BLOOIO_WEBHOOK_SECRET=whsec_... bun run src/main.ts`. Sends stay dry-run unless `BLOOIO_ALLOW_SEND=1`.
   - Reply `HELP`, then `STOP`, then `START` from your phone. Watch the receiver log the keyword outcomes. With
     `BLOOIO_ALLOW_SEND=1`, the confirmations are actually sent.
6. **Capture fixtures.** Save the raw bodies of the received, delivered, read, and typing events into `tests/fixtures/`
   (replace your number with a 555 number) and point the tests at them.
7. **Clean up.** Disable or delete the test webhook when you are done.
