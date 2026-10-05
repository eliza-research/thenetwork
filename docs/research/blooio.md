# Blooio for iMessage and SMS: research, verification, recommendations

Status: research complete. The API key was verified with read-only calls. No message has been sent and no
configuration was changed. Date: 2026-10-05.
PRD: 32.2 (channel gateway and messaging), 36.1 (messaging compliance and deliverability).
Prototype: [prototypes/messaging-blooio](../../prototypes/messaging-blooio/README.md).

## TL;DR

- **The key works.** `GET /v4/me` returned `valid: true`. The key belongs to the Blooio org `developer` and its label is `thenetwork`.
  It owns one active **dedicated** line, `+1 808-788-1821`. The org has two more Blooio lines that this key does not own.
- **That line is already in use,** so do not treat it as a clean Network line. It has 190 inbound and 162 outbound
  messages, with the last activity on 2026-10-04. No active webhook is scoped to this key. The org's only active
  webhook belongs to a different key and points at an Eliza host.
- **Blooio is peer-to-peer iMessage.** It sends from real Apple devices, not as A2P SMS, so it is outside 10DLC. Apple
  account safety becomes the main constraint instead. Blooio enforces hard **conversation limits**: 3 messages before a
  first reply, and only 1 re-engagement after 14 days of silence. It also applies **number protections** that slow or
  pause a line whose outreach is broad and one-way, or whose openers repeat. These limits shape the product more than price does.
- **Design the onboarding so members text the Network first** (an invite link that opens Messages). Inbound-started chats do
  not count as one-way outreach, and they unlock links and media.
- **Number strategy:** start with one dedicated Commercial line per city (SF, NYC), each with a local area code and a
  Name and Photo contact card. Add a warm spare per city once new chats exceed about 20 per day. Keep Twilio as the
  A2P SMS fallback, and start 10DLC registration now.
- **Opt-out is ours to run.** Blooio does not keep a global suppression list for us, so the Network's consent ledger
  is the source of truth for every channel.

## 1. What Blooio is

Blooio runs real Apple devices with Apple IDs and phone numbers, and exposes them as a REST API. The current API is
**v4 (beta)** at `https://api.blooio.com/v4`. It is multi-channel: Blooio iMessage lines, imported Twilio numbers,
WhatsApp Business, RCS Business, and Apple Messages for Business. Some Eliza code still calls the older **v2** API
(`https://api.blooio.com/v2/api`). A Blooio line sends over iMessage when the recipient supports it and otherwise
falls back at the device to SMS or RCS. Our lines report `protocols: imessage/sms/rcs`.

## 2. API reference summary

### Authentication
- `Authorization: Bearer <key>`. The docs show `bl_live_...` keys; our key uses the `api_...` form. OAuth app tokens
  (`blo_at_...`) are only needed for the API-key management endpoints and for acting on behalf of another org.
- Each key has its own **number pool**. A key can own Blooio lines or Twilio numbers, but never both. Lines are assigned
  to keys in the dashboard (or through the OAuth-only `/api-keys/{key}/channels`). Webhooks can be scoped to a key,
  so a Network key with its own lines and its own webhook is fully isolated from Eliza's traffic in the same org.

### Sending
- `POST /v4/messages` with `{ from?, to, text?, attachments?, ... }`. Returns **202** with a message object at the top
  level (`id: msg_...`, `chat_id`, `status: queued`, `protocol: pending`). Omit `from` and Blooio picks a line from the
  key's pool and **sticks to the same line for each contact**.
- `to` may be a single E.164 number or email, an array (on Blooio this creates **one group thread**), `{ group_id }`, or `{ contact_id }`.
- `POST /v4/chats/{chat_id}/messages` sends into an existing chat, which is how to reply in groups. `from` and `to` are inferred.
- Groups: `POST /v4/groups { channel_id, members[], name }`. The iMessage thread only exists after the first send.
  If the same people already share a group, the new group is **merged** into it, so switch to the canonical id that
  `GET /groups/{id}` returns. Inbound group messages carry `group: { group_id, name }`.
- `dry_run: true` validates and routes without sending (we did not use it).
- Rich content: `format: "markdown"` (bold, italic, underline, strike; iMessage only, and lost on SMS), `effect`,
  `reply_to`, `rich_link`, `poll`, `parts` (multipart), and `app_clip`. `POST /chats/{id}/contact-card` shares the line's Name and Photo card.
- **Idempotency:** send the `Idempotency-Key` header. Replaying the same key with the same body returns the original
  result with **200**; the same key with a different body returns **409**. The v2 docs give a 24-hour window. Purchases require the header.

### Receiving (webhooks)
- `POST /v4/webhooks { url, api_key? | integration_id?, channel_id?, api_version? }`. **Every subscription receives
  every event type**; filtering by type has been retired. The signing secret (`whsec_...`) is shown once and can be rotated (rotation is immediate).
- Envelope: `{ id: evt_..., type, api_version, created_at (ms), organization_id, data }`.
  Event types: `message.received|queued|sent|delivered|read|failed|reaction`, `typing.started|stopped`, `poll.*`,
  `group.*`, `contact.shared`, `safety.state_changed`, `safety.number_banned`, `number.purchase.*`, `number.removed`.
- **Payload versions:** `2026-10-01` (latest) removes the v2 leftovers (`event`, `timestamp`, `external_id`,
  `internal_id`, `chat_guid`) and reports public error codes. `2026-09-01` is the baseline. Existing subscriptions,
  including both Eliza webhooks on this org, stay pinned to `2026-09-01` until upgraded.
- **Signature:** `X-Blooio-Signature: t=<unix s>,v1=<hex HMAC-SHA256(secret, "${t}.${rawBody}")>`. Verify against
  the raw body and reject anything older than 5 minutes.
- **Retries:** any 2xx within **15 s** counts as success. Otherwise Blooio makes 6 attempts in total, backing off
  30 s, 1 min, 2 min, 4 min and 8 min (about 15.5 minutes), then marks the delivery failed. It can be replayed with
  `POST /webhooks/{id}/deliveries/{wdel}/replay`.
- **Dedupe:** use the envelope `id`, which stays the same across retries and replays. `X-Blooio-Delivery` stays the same
  across one delivery's retries but changes on replay, so do not dedupe on it. The prototype also dedupes on the message id,
  which catches the same message arriving through two subscriptions.
- The unified feed `GET /v4/events?type=message.*` is a polling fallback for reconciliation.

### Receipts, typing, read
- The status lifecycle is `queued → sent → delivered → read` (or `failed`, with `error.code`). `protocol` starts as
  `pending`, then resolves to `imessage`, `sms` or `rcs`, or to `unknown` if it never resolves. Read receipts depend on the recipient's iMessage settings.
- Poll status with `GET /chats/{chat}/messages/{id}/status`, or list lifecycle events with `.../events`.
- Typing: `POST /chats/{id}/typing {state}` and `DELETE /chats/{id}/typing`. Inbound typing arrives as `typing.*` events.
  `POST /chats/{id}/read` sends a read receipt. The per-line `auto_mark_read` setting does this automatically on dedicated and inbound lines.

### Media
- Outbound: `attachments: [public https URLs]`. Two or more images or videos become one carousel by default. A single audio
  file is sent as a voice memo and cannot carry a caption. Links and media are **refused until the recipient has written
  back once** (`403 conversation_content_restricted`).
- Inbound: `data.attachments[]` with `{ url, media_type, size }`. Eliza only fetches from an allowlist of Blooio hosts
  (blooio.com, api, backend, and media subdomains) to prevent SSRF; the prototype does the same.

### Number provisioning
- The **Number Purchase API** (`GET /channels/blooio/available`, `POST /channels/blooio/purchases`) requires org KYC
  (Stripe Identity), approval from Blooio staff, and a card on file. **For our org it returns
  `403 feature_not_enabled`**, so lines are bought in the dashboard for now. Purchases are asynchronous and billable,
  require an `Idempotency-Key`, are capped at 10 lines per order by default, and allow one shared line per org.
- Plan ids: `shared_nc`, `shared_com`, `dedicated_com`, `dedicated_ent`, and `inbound_basic` (reply-only: a line on
  this plan cannot start chats, and sending first returns `403 inbound_only_no_prior_inbound`).
- Area codes: in-stock codes are free. Other codes are a custom order at a **$75 one-time** fee per number.
- Contact card: `PUT /me/numbers/{n}/contact-card` sets the Name and Photo. `auto_share_contact` (dedicated lines only)
  shares the card with everyone who messages the line. This is the PRD 36.1 "contact card at onboarding" requirement, natively.

### Pricing (blooio.com/pricing, 2026-10-05)
Flat monthly pricing per line. **There are no per-message fees.**

| Plan | $/month | New conversations per day |
|---|---|---|
| Starter (shared) | 39 | 5 |
| Commercial Shared | 89 | 15 |
| Commercial Dedicated | 289 per line | Unlimited by plan; safety limits still apply |
| Inbound (reply-only) | 98 | 0 started by us |
| Enterprise Dedicated | 389 for 1 line, 195 per line at 6+ | Unlimited by plan; safety limits still apply |

### Rate limits and messaging safety (what limits proactive outbound)
Blooio does not publish a requests-per-second limit. The real limits protect each line's Apple account:

**Conversation limits** (per chat; they clear when the recipient replies or reacts):

| Chat state | Consecutive outbound allowed |
|---|---|
| New (no reply yet) | **3 plain-text messages** |
| Acknowledged (reaction only) | 3 after each response; links and media still blocked |
| Active (1+ written reply) | 4 |
| Established (3+ replies on 2+ days) | 6 |
| Trusted (10+ replies on 3+ days, thread at least 7 days old) | 8 |
| Inactive (no response for more than 14 days) | **1** re-engagement message |

These come back as `429 conversation_awaiting_reply|conversation_streak_limit|conversation_inactive_paused`
and `403 conversation_content_restricted`. **They do not clear with time.** Resume only after an inbound message or a reaction.

**Number protections** (per line; rolling windows): `queue` adds a 3-8 s gap between bursts; `slow` adds 30-60 s;
`pause_new` blocks new chats; `reply_only`; `review` pauses all sends. The triggers are:
- `one_way`: more than 10 new chats per day (3-day average) and fewer than 40% of new chats getting a written reply.
  This escalates to `pause_new` below 20%, or after 48 hours.
- `template`: in 7 days, at least 10 first touches, half of which use an opener fingerprint seen 5 or more times.
  This is measured **across the whole org**.
- `delivery`: the iMessage share drops by more than 10 points, or failures double, in the last 72 hours.
- `sibling_ban`: another line in the org was banned, so this line is `slow` for 72 hours.

These produce `403 safety_new_conversations_paused|safety_reply_only|safety_account_review` and the
`safety.state_changed` webhook. An admin can lift the limits on a dedicated line, but Blooio warns that an Apple ban
"cannot generally be reversed". Blooio's own guide suggests **about 20-50 new conversations per day per number**, sent between 8 a.m. and 8 p.m. recipient local time.

### iMessage vs SMS fallback
- A Blooio line chooses the transport at send time, and the result shows in `protocol`. iMessage-only features
  (Markdown, effects, polls, typing, read receipts) degrade or disappear when a message goes over SMS. Capability lookup
  exists at `/contacts/{id}/capabilities` (v4) and `/v2/api/contacts/{n}/capabilities`.
- **Hybrid mode** (Blooio feature): connect our Twilio account to Blooio. On one key, the first message goes out over
  Twilio SMS, and after the recipient replies the conversation moves to the Blooio iMessage line (1:1 only). The SMS leg is still A2P and needs 10DLC.
- A Blooio line's own SMS fallback is P2P SMS from an iPhone number. It is not a substitute for registered A2P traffic at volume.

### Opt-out handling
- Blooio states that it does not check our opt-in capture, does not maintain a global suppression list for us, and does
  not require carrier-style STOP footers for P2P iMessage. Its pricing and safety pages do say "recipient opt-outs" are
  still enforced, but no API or error code for that is documented. **Treat it as unreliable and run our own ledger.**
- Blooio's guidance matches PRD 36.1: send only to people who opted in, keep consent records (source, time, wording),
  honor STOP immediately, and keep sending windows reasonable.

## 3. How Eliza already uses Blooio (read-only review)

- `plugins/plugin-imessage/src/blooio-transport.ts`: sends with `POST /v4/messages` (or `/v4/chats/{id}/messages` for
  `chat_id:` targets) with `Idempotency-Key`. Verifies `t=,v1=` signatures with a 300 s tolerance. Parses the v4
  envelope (`message.received` only), filters to the configured `channel_id`, and applies the media allowlist.
- `blooio-readiness.ts`: before going live, calls `GET /v4/channels/{from}/settings` and checks the `channel_id`. This is a cheap, read-only health check.
- `service.ts`: per-message durable dispatch receipts (7-day retention, cleanup tasks), an in-flight set, and throwing
  so that Blooio retries when the dedupe store is unavailable. The prototype's dedupe store copies the claim/commit/release semantics.
- `cloud/shared/.../blooio-api.ts` (v2 base, `X-From-Number` read receipts) and `gateway-webhook/.../adapters/blooio.ts`:
  parse both v2 flat and v4 payloads; send `chat_*` to v4, `grp_*` to the legacy v2 chat API (with `from_number`), and
  everything else to `/v4/messages`. Errors are classified as 5xx uncertain, 429 retryable, other failed. Typing uses the v4 `typing` and `read` endpoints.
- **Gaps relative to the PRD that the prototype fills:** Eliza retries 429 as transient, but Blooio's 429s are mostly
  conversation limits that must wait for the recipient. Eliza has no STOP/HELP/START ledger, no quiet hours, no
  consent-at-dispatch check, does not handle `safety.state_changed`, and has no delivered/read status tracking per outbound record.

## 4. Read-only verification (2026-10-05)

Calls made, all `GET`: `/v4/me`, `/v4/me/priority`, `/v4/me/numbers`, `/v4/channels`, `/v4/channels/{n}/capabilities`,
`/v4/channels/{n}/settings`, `/v4/me/numbers/{n}/contact-card`, `/v4/webhooks`, `/v4/webhooks/versions`,
`/v4/groups?limit=1`, `/v4/chats?limit=1`, `/v4/events?type=…&limit=1`, and `/v4/channels/blooio/available`.
**No sends (not even `dry_run`), and no configuration changes.** Message contents and contact numbers seen in the
chat and event listings were not recorded.

| Check | Result |
|---|---|
| Key valid | Yes: `auth_type: api_key`, `valid: true` |
| Org | `developer` (`org_OMe-gdjjgdCpaL6WpRcOb`), US, created 2026-01-27; key label `thenetwork` |
| Lines owned by this key | **`+18087881821`**: dedicated, active, not suspended, last active 2026-10-04 |
| Usage on this key | 190 inbound / 162 outbound messages |
| Default priority | none (`data: null`), so sends use the key's implicit Blooio pool |
| All Blooio channels in the org | `+18087881821` (`ch_019fe466…`, created 2026-08-09); `+12692921765` (`ch_01a04fcc…`, 2026-08-29); `+17409790022` (`ch_01a04fc5…`, 2026-08-29). All active, with protocols imessage/sms/rcs, actions typing/read/profile, and interactive effects/polls/rich_links |
| Line settings (`+18087881821`) | `auto_mark_read: false`, `auto_share_contact: false`; both can be enabled |
| Contact card (`+18087881821`) | Not set (no name or photo; sharing disabled) |
| Webhooks | `wh_01a0500f…` **active**, scoped to a *different* key in the org, pointing to `ovh-eliza.tail4e11f5.ts.net/api/imessage/webhook/blooio`, version 2026-09-01. `wh_019ffb30…` **disabled**, org-wide, pointing to `api.eliza.app/api/eliza-app/webhook/blooio`, version 2026-09-01 |
| Webhook payload versions | `2026-10-01` (latest), `2026-09-01` |
| Number Purchase API | `403 feature_not_enabled` (needs KYC plus an access request) |
| Safety events | none (`/events?type=safety.*` is empty) |

What this means: the key works, but its only line is an existing line with real conversation history, and it currently
has **no active webhook routed to it** (the active one is scoped to another key). Before using it for the Network,
confirm who owns the line's existing conversations. Better, buy dedicated Network lines and assign them to this key.

The prototype's `bun run scripts/verify-readonly.ts` reproduces this table. `BLOOIO_LIVE_TEST=1 bun test tests/live.readonly.test.ts` passes.

## 5. Recommendations

### Number strategy (per city)
1. **Use one dedicated Commercial line per city for MVP:** SF with a 415 or 628 number, NYC with 212, 646 or 917. That is
   $289 per month each, plus $75 if the area code is a custom order. Moving to Enterprise Dedicated at 6+ lines brings the
   price to $195 per line. Do not use shared or Starter lines: their new-conversation caps are 5-15 per day, and their Apple trust is shared with other customers.
2. **Give each line a Name and Photo card** ("The Network · SF") and turn on `auto_share_contact`, so members see a
   saved contact from the first reply. This covers PRD 36.1's contact card requirement without sending a vCard by hand.
3. **Size the lines by new conversations, not message volume.** One line handles about 20 member-started onboardings a day
   comfortably. Proactive outreach to existing members is the risky part (`one_way` and `template`). Add a second line per
   city as a warm spare when a seed wave exceeds about 20 new chats per day. Keep in mind that a ban on one line slows
   every other line in the org for 72 hours (`sibling_ban`), which argues for a **separate Blooio org (or at least a
   separate key and webhook) for the Network**, apart from Eliza's lines.
4. **Keep line affinity per member.** Blooio already keeps the same line per contact. Store the line on the member record
   and always pass `from`, so a city's members keep one identity even after spares are added.
5. One national number is simpler, but it concentrates the risk of an Apple ban in one place and loses local area codes.
   Per-city lines fit the separate activation per city in PRD 25 and 36.5.

### Product and compliance design
1. **Member texts first.** Invites should carry a link (`sms:` or an iMessage deep link) that pre-fills "Hi, <inviter>
   invited me". Inbound-started chats avoid the 3-message first-contact cap and the `one_way` signal, and they make the
   chat Active right away, which unlocks links and media.
2. **Record consent at invite acceptance** (wording, source, time) in the consent ledger. Proactive sends require a recorded
   opt-in at dispatch time; the prototype enforces this. STOP, START and HELP are matched exactly after normalization.
   "YES" is never an opt-in keyword. Opt-out applies to the address, so iMessage and SMS fallback stop together.
3. **Map the PRD's outreach rules onto Blooio's limits.** PRD 32.9 allows at most 2 proactive messages per week and stops
   after two unanswered proactive messages. That sits inside Blooio's limits (3 for a New chat, 4+ for Active, 1 re-engagement
   after 14 days). Treat a member who has been silent for 14 days as having **one** re-engagement message left, and spend it well.
4. **Never send the same opener twice.** Briefs must be personalized, since Blooio fingerprints openers across the whole
   org (`template`). Add a check in the composer that rejects an opener whose normalized form was used 3 or more times in 7 days.
5. Quiet hours: 21:00-09:00 in the recipient's local time by default; member-specific overrides come from PRD 7.2. Replies
   to a member's own message are exempt.
6. **Handle `safety.state_changed`.** Page a human on `pause_new`, `reply_only` or `review`, and hold proactive sends on
   that line. Handle 429/403 conversation codes by waiting for the recipient, never with timer retries. The prototype does both.
7. **Webhooks:** create a new subscription scoped to the Network key on payload version `2026-10-01`. Ack within 15 s
   by persisting first and processing asynchronously. Dedupe on the envelope id plus the message id. Reconcile against
   `GET /events` after outages, since failed deliveries stop after about 15.5 minutes.

### Twilio fallback
1. **Start A2P 10DLC (or toll-free verification) now.** PRD 36.1 budgets several weeks for it, and it is the only
   compliant path for SMS at volume and for members without iMessage.
2. Fall back to Twilio when (a) a Blooio send ends `failed` or `blocked` (safety review, banned line, or no active device:
   503 after retries), or (b) a member's chat resolves to `sms` repeatedly and the content needs A2P (links and reminders at scale).
   The prototype's queue implements fallback on terminal failure and on a `message.failed` receipt. It reuses a derived
   idempotency key and applies the same opt-out and quiet-hours rules.
3. Consider Blooio **hybrid mode** only for re-engaging lapsed SMS-only members. For invite-only onboarding, member-first
   iMessage is better. Either way, a Twilio key in Blooio must be separate from the iMessage key.
4. STOP received on Twilio must also suppress Blooio, and the other way round. The ledger is keyed by address, not by channel.

### Open questions for Blooio
- Can we have dedicated lines and Number Purchase API access for a separate "Network" org? What is the KYC timeline?
- How exactly do they enforce "recipient opt-outs"? Is there an API, webhook or error code for it?
- What are the actual group chat limits (members per group, groups started per day), and do groups count as new chats under `one_way`?
- Can the 1-message re-engagement after 14 days be raised for members who opted in and have long threads?
- What is their SLA, and how do they fail over when a line's device goes offline? (Is the 503 "no active number" retryable, and for how long?)

## Sources
- Blooio docs index and full text: https://docs.blooio.com/llms.txt, https://docs.blooio.com/llms-full.txt (v4.0.0-beta)
- Webhooks (events, retries, dedupe, versions): https://docs.blooio.com/webhooks
- Webhook signatures: https://docs.blooio.com/guides/webhook-signatures
- Messaging safety limits: https://docs.blooio.com/guides/messaging-safety
- Message fields v4: https://docs.blooio.com/guides/message-fields-v4
- Number Purchase API: https://docs.blooio.com/guides/number-purchase-api
- Number pools: https://docs.blooio.com/guides/number-pools
- Twilio integration: https://docs.blooio.com/guides/twilio-integration
- Hybrid mode: https://docs.blooio.com/hybrid-mode
- Idempotency: https://docs.blooio.com/idempotency
- Pricing: https://blooio.com/pricing
- iMessage automation guide (consent, throughput, P2P vs A2P): https://blooio.com/guides/imessage-automation
- Eliza code (read-only): `v3/plugins/plugin-imessage/src/{blooio-transport,blooio-readiness,service}.ts`,
  `v3/packages/cloud/shared/src/lib/utils/blooio-api.ts`, `v3/packages/cloud/services/gateway-webhook/src/adapters/blooio.ts`
