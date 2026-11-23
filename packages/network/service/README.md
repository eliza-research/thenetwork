# The Network service (production runtime)

This folder holds the production process for the ConsentNetwork. One process runs one network per row of `platform.networks` (`ntwrk:nyc`, `slop:nyc`, `peon:nyc`, `friends:nyc`; platform plan 6.1). It runs each network against Postgres, takes inbound messages from the channel gateway, serves the public API the four sites call, and gives staff a small API for review and safety. The production entry point is `deploy/backend/server.ts`, which wraps this folder ([docs/deploy.md](../../../docs/deploy.md)). `main.ts` is the standalone entry point for local runs. Local dev for the whole platform: [docs/runbook-platform.md](../../../docs/runbook-platform.md).

**Sends are dry-run.** The default adapter stores each message in `network.messages` with status `dry_run` and sends nothing. The configured channel alone makes sends real, for every app (`NETWORK_CHANNEL=blooio` or `eliza_cloud` with its credentials; spec/bootPolicy.md, owner decision 2026-11-22). Set it only with the founder's approval.

| File | What it does |
|---|---|
| `service.ts` | `NetworkService`: the networks, inbound routing (line, keyword, person, membership), keywords through the platform consent ledger, text joins, the person cap, the platform hooks, the staff API |
| `runtime.ts` | `NetworkRuntime`: one network under its own lock, its snapshot and address book, the unit of work and the save transaction |
| `snapshot.ts` | `loadSnapshot(sql, now, { app, city })`: one app's rows only, plus person-to-person blocks |
| `channel.ts` | The adapters (dry-run, Blooio) |
| `inbox.ts` | The inbound inbox (`platform.inbound`): one row per provider message, handled once and in order per sender |
| `serve.ts`, `main.ts` | The HTTP servers, the tick loop, the standalone local entry point |

## Signed Shared-agent turns

`POST /internal/turn` and `POST /internal/turn-receipt` use the import-free contract in `packages/core/src/svc`. Set `SERVICE_TURN_SECRET` to the same secret (at least 32 characters) as Cloud. Without it these routes return 503. Sign the full path and raw body; query parameters are refused. Responses use `Cache-Control: no-store`.

A turn commits its claim in `platform.inbound` before it calls the existing inbound handler. The channel and provider message ID identify the claim. The same body replays the stored result; a different body conflicts. An interrupted turn stays unresolved and is not rerun by the inbox tick. Replies from this turn alone are stored as `collected`, outside `platform.outbound`; collection does not mean provider acceptance. A signed receipt binds the exact ordered reply IDs. An unknown receipt can advance to accepted or rejected; accepted receipts are immutable.

Open context rechecks the canonical phone and app membership. It includes confirmed shareable facts after the leak gate, and refuses context that exceeds the deployed plugin bounds. Unavailable active-item summaries are `null`. Replays recheck current admission and context, so STOP, a hold, a ban or changed context cannot reuse an old open grant. App leave seals prior signed payloads for that app. The existing seven-day purge strips completed signed payloads and retains a minimal replay tombstone; tombstones are deleted 30 days after that.

A member can say `I will be in San Francisco from YYYY-MM-DD until YYYY-MM-DD` in the signed conversation. New York City and Los Angeles also work. Use the destination's calendar dates. The end date is the first day outside the trip. The current app saves the statement and names itself in the confirmation. A trip does not change the person's home or open a new matching market.

For a booked meeting, `calendar invite` returns a private download link in the signed conversation. A member can select the meeting with `calendar invite on YYYY-MM-DD at HH:MM`. The link is valid for up to 15 minutes and contains the current time and public venue when imported. Use New York local time in text commands.

`RESCHEDULE YYYY-MM-DD HH:MM TO YYYY-MM-DD HH:MM` asks the current booked roster to approve an exact new time at a venue with known hours. The original time stays booked until each participant accepts their own offer. `RUNNING LATE` sends a neutral update to the eligible participants in one current booked group around the meeting start.

For a solo recommendation, a member can ask `Anything fun this weekend?` or `Show me public events tomorrow.` The current app checks the member's saved interests, availability, location and age against the [published NYC Parks catalog](../../../spec/publicEventCatalog.md). The reply includes up to three eligible listings with a venue, New York time and source link. Minors can receive only explicitly all-ages listings. The request creates no opportunity or booking. The catalog refresh runs separately from the request.

A turn still processing after 2 minutes lost its worker and becomes unresolved. An unresolved turn is never rerun, and it holds the sender's later messages back for 10 minutes at most. STOP, START and HELP are never held back. Staff with `admin@*` can release a stuck turn with `POST /inbound/resolve {"id":"msg:<channel>:<messageId>"}`; the turn stays unresolved and a replay is still refused.

A handled turn with no replies (a quiet acknowledgement, an under-13 decline) takes a receipt with empty `replyIds` and `providerMessageIds`. `accountEligible` is false for an unknown age, so Cloud eligibility never runs ahead of the join age check. An accepted receipt may carry `historyRecorded: false` (no Eliza account yet).

Agent signals go to the decision that owns them ([rule](../../../spec/staffSafetyService.md)). A `safety_concern` opens or joins the member's safety case with the reason code `agent_safety_concern` (no evidence text), waits as a private facet, logs an alert line, and is listed for reviewer or safety staff at `GET /signals` until safety staff decide it. An `opt_out` pauses matching in that app only, with the setting that "pause matching" writes. It does not change carrier consent: STOP and "leave <app>" in the member's own words stay the only consent changes. When the opt-out changes the setting, the member gets one confirmation that names ‘resume matching’ ([rule](../../../spec/staffSafetyService.md)): a reply text (`type` `agent_pause_confirmation`, id `agent-pause:<action id>`, kind `reply`, so it is not on the daily cap of proactive messages), or, when the consent ledger of the number or the member row reads opted out, an inbox update with the same event type that the connector and the shared-line updates read show. The inbox update is a requested item, so the notify digest can text it after START when no agent read it first; its words stay true after START and after resume. A repeated signal that changes nothing and a retry of the same signal give no second confirmation. Every signal batch runs in one runtime unit, so the pause, the confirmation and the action receipt commit together. A `travel` signal stays private context.

**Contract.** The wire contract matches elizaOS/eliza `plugins/plugin-network/src/backend/contract.ts` on `develop` byte for byte. The signing implementation matches the same upstream directory after its runtime-specific introductory comment. `packages/core/test/contract-mirror.test.ts` pins both hashes and `pnpm run check:mirror` compares them with upstream through `gh`. A wire change lands upstream before the local mirror and pins are updated.

Two paths the service uses are not in the mirror:
- `DELIVER_RECEIPT_PATH = "/api/internal/network/deliver/receipt"` is a local constant in `cloud-channel.ts`. Eliza Cloud serves it (develop: `packages/cloud/api/internal/network/deliver/receipt/route.ts`, the deliver handler in reconcile-only mode): the same signed body and id as the deliver, and it never sends. The service calls it only to learn whether an unknown acceptance was accepted; it never retries an unknown acceptance with a new id. **Proposal for upstream:** add `DELIVER_RECEIPT_PATH` to `contract.ts`, so both sides name it from the contract.
- The queued Cloud adapter requires owned history and distinct provider IDs. It keeps the original timestamp when it is within the queue interval and the existing signing clock tolerance. A legacy response can omit the timestamp and use the queue clock. [Cloud receipt rules](../../../spec/cloudDeliveryReceipt.md)

The Cloud dispatch adapter can retry an explicit temporary refusal with the same key. `unavailable` and `delivery_pending` during receipt lookup leave acceptance unknown. The separate gateway path handles first-contact replies.

Signed state, signal and update actions bind the exact completed open turn, channel, app and member. State windows extend the canonical member row; private hypotheses use the existing facet owner. Cloud outbound uses `NETWORK_CHANNEL=eliza_cloud`, `NETWORK_CLOUD_DELIVERY_ORIGIN`, `SERVICE_TURN_SECRET` and the configured `BLOOIO_FROM`, with the same live approval flags as Blooio. The default and `--dry-run` send nothing.

Cloud transport reuses `platform.outbound` and all its policy checks. Unknown acceptance is held outside the dispatch queue. Restart and a bounded receipt poll never resend it. A verified receipt commits under the canonical person fence, preserves its original acceptance time, and updates line counters once. Notify projection repair uses the existing idempotent record owner and one marker on `network.messages`, for queued sends and positively acknowledged handled replies. Handled replies retain their original message time as event chronology; their ACK does not attest a provider acceptance timestamp. Canonical deletion seals late receipt commits. Dispatch admission rechecks the canonical member and immutable outbox row after the asynchronous gates, under short database locks released before remote I/O. An admitted request can remain in flight during deletion; a later receipt cannot restore erased data. Signed first contact and policy declines create no service line counter; engagement follows canonical join-age and membership admission. These tests control the Cloud HTTP transport boundary; actual Cloud history and hosted qualification remain separate gates. No deployment or live flag is enabled by this change.

## The Eliza seam (eliza.app takeover)

The Eliza gateway owns the Blooio webhook of the shared line and calls `POST /internal/turn` for every direct message (docs/design/eliza-conversation-layer.md). The contract is the mirror in `packages/core/src/svc/` and must not be edited here.

**Consent has one path: the turn.** STOP, STOP ALL, START, HELP and "leave <app>" are parsed by this service inside the turn. A handled turn that changed consent carries `consent {state, scope, app, at}`: STOP is `opted_out` with scope `all` and app `null`; leave is `opted_out` with scope `app`; START is `opted_in` with scope `app`. The gateway mirrors it into its send-time fence. The old `STOP_HELP_OWNER=gateway` mode and `POST /consent/gateway` are removed: the upstream gateway (elizaOS/eliza `spike/network-plugin`, `gateway-webhook/src/network-service.ts`) never called that route, it mirrors the turn's `consent` instead.

**Consent order.** In a turn, the consent event time is the gateway's `receivedAt` (never later than now), for STOP, START, leave and the opt-ins of a text join. The ledger resolves by event time, so a START the person sent before a STOP, delivered late by a gateway retry, is recorded but does not opt the number back in, and the turn reports no `consent`. A STOP always stops the members when it arrives. On the legacy webhook the time is the arrival time, as before (that path handles one sender in order).

**START checks.** Before START opts a number back in, the recycled-number hold (a number not seen for 12 months waits for staff) and the ban check (by phone or person) apply. A held number gets `reason: "held"`; a banned number gets `held` and no reply.

**Startup and body size.** The service refuses to start when the turn path is on and `SERVICE_TURN_SECRET` is shorter than 32 characters, or when it equals `NETWORK_SERVICE_CONSOLE_TOKEN` or any `NETWORK_SERVICE_TOKENS` token (Cloud's secret is never a staff bearer). Every signed route reads at most 256 KiB before it verifies or parses anything; the backend refuses a declared larger body on `/internal/*` before the service sees it.

**The one-time notice.** A person who writes on the line through a signed turn and is not a member of any Network app gets, as the first reply of that handled turn, a notice that Eliza is now The Network's agent, what it means, and how to opt out (`ELIZA_NOTICE` in `packages/network/src/copy.ts`). The normal join flow follows in the same turn. Rules:
- The wording is **approved** by the founder (2026-10-11, `ELIZA_NOTICE_STATUS`). A change to it needs a new approval.
- Once per number. `platform.eliza_notices` (migration 0025) keeps a keyed hash of the number (`PLATFORM_HASH_KEY`, its own domain) and the time sent, never the number. The row and the collected reply commit in one transaction.
- It enrolls nobody. Joining still needs the age check and the opt-in; minors follow the age policy (13-17 join; never matched, except a teen friendship introduction on friends.help or in the ntwrk `Friend` lane while staff have not stopped teen introductions, docs/network.md 6.3).
- A banned number gets no notice. An age under 13 (stated in the message, pending, or on the phone's age floor) gets only the existing kind decline, and the notice row of that number is deleted in the same turn.
- Open turns are returned only for members of a Network app.

**Proposal for upstream (not built).** The TurnRequest has no "known eliza.app user" flag, so the notice goes to every non-member first contact. An optional `elizaUser?: boolean` field on TurnRequest, set by the gateway for a sender with Eliza history, would let the service send the notice only to existing eliza.app users and give a plain welcome to everyone else. That is a contract change: it goes into elizaOS/eliza `plugins/plugin-network/src/backend` first, then into the byte-for-byte mirror here, with new pins in both `contract-mirror.test.ts` files.

**Tests.** `packages/network/test/eliza-takeover.integration.test.ts` mirrors the upstream gateway test against the real service, HTTP and Postgres: handled STOP (scope all), leave (scope app), START, an older START that loses, HELP, the join keyword, the onboarding answer, the open turn with strict context, a RELAY request in the upstream shape (no match, an unknown item, no request: nothing sent), ignored, replay by messageId, a bad signature, an over-size body, a minor (single-player, no introductions), the notice once, an under-13 decline, and START refused for a banned or held number. Sends are dry-run; a fake Cloud deliver endpoint must receive nothing.

## Relay between matched members

`POST /internal/relay` (relay-endpoint.ts) serves Cloud's RELAY action on its own wire, `RelaySendRequest` → `RelaySendResponse` in the contract mirror (`{channel, messageId, app, memberId, itemId: string|null, text}` → `{decision: pass|hold|block|none, senderNotice, delivered, replayed}`). It is signed with `SERVICE_TURN_SECRET` like the other `/internal/*` actions, size-checked (16 KiB) before it is parsed, idempotent on `x-ntwrk-svc-id`, which must be `<messageId>:relay` as Cloud's client signs it (one relay per turn), and bound to the original completed open turn and the member's current membership. The app and the member come from that turn. `text` must be that turn's own inbound message (trimmed), never model wording, and the service reads the request from it (`parseRelayRequest`: a text, "send them my number", a photo, or `none`). `itemId` may only name an active item the turn's context offered; the recipient is always the member's current match, chosen by the service.

The ConsentNetwork's relay desk (`packages/network/src/relay.ts`) is the one owner of every decision and asks the engine relay policy (`relayItemAsync` in `packages/engine/src/relay.ts`). With `CLOUDFLARE_AI_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set it adds the Clef classifier (`clefRelayClassifierFromEnv`, clef-flash unless `RELAY_CLEF_MODEL=clef`); without them the classifier cannot run in any environment: the service logs `relay classifier: Workers AI not configured; every relayed text is blocked` at start and blocks every relayed text with the notice to try again. Production refuses to start without both (spec/bootPolicy.md `workersAiSetupMissing`). `platform:dev`, the simulator and the tests give the service `simulatedRelayClassifier` (option `relayClassifier`), which clears every text the rules pass and is named as simulated. The rules and the classifier decide alone (owner decision 2026-11-22, D18): any reason blocks the text, and the sender gets the notice of spec/relayDecision.md at once. A classifier that cannot run (an error, a timeout, an answer that does not parse, a cache miss) blocks the text with "try again in a few minutes" and never sends it unchecked. Each Clef call is a cost row for the app (`cost.ts`). The canonical owners' word on both members (consent ledger and STOP, bans, phone holds, membership, the lowest age, the member row; `runtime.ts relayParties`) can only tighten the desk's view. Only the engine's `rendered` text goes to the other member, through the Network's send path and the outbound queue with the id `relay:<item>`, which the Cloud channel delivers with `kind: "relay"`. A number goes out only after both members asked to swap within the engine's consent TTL (15 minutes; nothing is backdated; the first ask answers `hold`), and never one way: when the first share is refused at send time the second is not sent. A member takes a pending request back with "don't send my number" (the relay answers `none` with a confirmation). The relay thread keeps "<name> shared their number.", never the number, and the Clef prompt is PII-masked. The queue's leak guard lets exactly that number through for that row, and lets a relayed text carry its sender's own facts (as the Network's guard does). Relay rows carry their network (`network_id`, migration 0031), and the endpoint runs on the network that holds the member. Photos never pass the relay desk. The photo flow (`photoRelayFlow.ts`, spec/photoRelayItem.md, owner decision 2026-11-22) runs in `/internal/turn` before "leave <app>", in `/internal/relay` before the desk, and behind the connector tools `my_photos` and `photo_request`. A deterministic reader (`photoReference.ts`, no model) turns the member's own words ("the beach one", "the one from Saturday", "photo 3", "the one Maya has") into the member's own photos, and the generated `photoPickFor` proposes, asks which, or refuses; it never chooses between two photos. Each proposal names the photos by number, name and day and carries a link to `/photos/check`. Consent is only YES to the newest proposal on the line (`photoDraftReplyFor`) or "Send" on that page; a connected agent never consents (`photo_request` texts the proposal to the phone). An offer then asks the receiver first (`photo-ask:<offer request key>`, the draft id and revision that made the offer, a relay message, not on the daily cap). The ask and the offer commit in one unit of work: the ask is queued in the receiver's unit and the offer is written in that unit's save transaction, so a failed save sends no ask and makes no offer, and the member can say YES again. When the receiver's send rules refuse the ask (STOP, a block, an age in doubt), the offer is written without an ask and lapses like a decline, so the sender learns nothing about the receiver. A quiet-hours ask waits and counts as sent. After the receiver's yes the automatic check (`packages/platform/src/photo-screen.ts`: Workers AI `@cf/cloudflare/clef-flash` on the photo rater's `CLOUDFLARE_AI_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, base64 images, each call a cost row with `detail.purpose = "photo_screen"`; the generated `photoScreenVerdictFor` and `photoScreenOutcomeFor`) screens each photo at once and at each tick. A clean photo is released at once; a flagged photo, a photo the model cannot take and a photo the check could not screen in five tries (after 1, 5, 15 and 60 minutes) wait for a `safety` reviewer (`POST /staff/relay/:itemId/release`) until the item deadline, 12 hours after the yes; nothing is released unchecked. The receiver gets a `/photos/view` link (`photo-ready:<offer>`) as soon as one photo is released. The link binds to the first browser that opens it and has no time limit: it stops when the sender takes the photo back, the receiver reports it, or the pair ends; a deleted photo drops out of the view and the others stay. STOP, leave, a block, a ban, a hold, a restriction, erasure (triggers of migration 0088) and an age under 18 (`PhotoRelayService.endFor`) write an end fact on every open offer of that person in the same transaction, so a later START or a released hold never opens it again. A ready offer does not hold the pair: the sender can offer the same match another photo. The view cookie lives 400 days and each open renews it. PHOTO LINK by text gives the receiver a new link and the old one stops. The sender learns only "on its way", "didn't take it", "not approved" or "not checked in time" (`senderNoticeFor`), sent by the tick (`photo-notice:<offer>`); a decline shows no earlier than a lapse. "take back photo 2" or "unsend it" revokes an open offer and stops the view. A take-back that names photos and no match takes those photos back from every open offer of the sender; one that names neither, while two or more matches have an offer, asks which match and takes nothing back. "MY PHOTOS" lists each photo and who has it; a member who may not have photos (under 18, an unknown age, banned) gets "I can't send photos here." and no upload invitation. "NO MORE PHOTOS" and "PHOTOS OK" set the receiver's choice. "REPORT" after a view link, or the page report, closes the photo and files a harassment report about the sender, in one unit of work. When no report can be filed (a member row is gone), the photo still closes, the member hears only "I closed the photo." and the service logs an `[alert]` line. The tick of the app's first network (`PhotoRelayFlow.tick`) expires unreviewed items, settles offers (the answer deadline, asking and reviewing offers whose parties fail, and ready offers with an end fact), sends due sender notices, and deletes drafts 15 minutes after they were shown (`photoDraftTtlMs`), page links a day after they expire, and final offers after 90 days. Tests: `packages/network/test/shared-relay.integration.test.ts` and `packages/network/test/photo-relay.integration.test.ts`. Minors are never relayed, scores are never shown, and the log (`network.relay_records`, migration 0026) keeps ids, the decision and reason codes, never a body or a contact value. No relayed text waits for staff: a text that the rules or the classifier do not clear is blocked at once (migration 0086 closed the held items stored before).

Final dispatch reads everything again inside the queue's admission transaction, after every asynchronous gate (`runtime.ts relayAdmission`): the item must be one the desk passed for exactly this recipient, the stored state (read `FOR SHARE`) must still hold the open two-person match of these members with both eligible, there is no block either way, and both members pass the canonical checks. A close, a STOP, a hold, a block or a minor's age that lands while the row waits (quiet hours included) ends it suppressed. The action receipt, the relay log, the messages and the queued rows commit in one transaction (the unit's save) or not at all; a fault leaves the receipt `unresolved` and nothing queued. `delivered` is true only for a pass whose outbound row Cloud accepted with provider ids and recorded history; an unknown acceptance stays `false` until the queue's receipt-only lookup recovers it, and a replay or a restart never sends it again. STOP and leaving revoke the turn's authority (403); canonical erasure seals the member's signed turns and their action receipts.

The desk also reaches the safety record (spec/relayDecision.md). A relayed text in which the sender says they are under 18 (the engine's age signal, or a `minor_signal` flag of the relay classifier) starts the minors policy before the answer: the sender gets the minor signal on the person (platform.person_minor_signals, so every app of the person stops matching them), a `relay_age_signal` event in their safety case and, on an 18+ app, an `age_review` event, the adults they met get their case events, and every open opportunity of the sender closes, the match included. A block for the sender's own severe words (a threat or slur rule, or a classifier block flag) writes a 0-point `relay_block` event in the sender's case, with no text. The swap withdrawal reader (`withdrawsSwap`) errs toward a withdrawal: only a few fixed phrases ("don't mind", "no rush") are not a no. A blocked item keeps no text, and no relayed text waits for staff.

On the Eliza side the RELAY action exists only when `NETWORK_RELAY_ENABLED=1` (upstream #34661); it is off until this endpoint is deployed and the founder sets the flag.

Errors follow the other actions: 400 `invalid_request` or `invalid_relay`, 401 on a bad signature, 403 `turn_scope_invalid`, `membership_unavailable` or `relay_source_invalid`, 409 `action_conflict` or `action_unresolved`, 413 `payload_too_large`, 429 `action_limit`.

## Costs

`cost.ts` writes `network.cost_ledger` rows (codes and counts only): Twilio Verify codes, Clef photo ratings, relay Clef classifier calls (kind `other`, provider `workers_ai`, `detail.purpose = "relay_classifier"`; `COST_CLEF_RELAY_USD` per call, else the engine's list price per input token), photo relay checks (kind `other`, provider `workers_ai`, `detail.purpose = "photo_screen"`, `COST_CLEF_PHOTO_USD` per call), LLM attempts, SMS fallbacks and the line. The engine judge records `engine_judge` costs per app; the review judge records `review_judge`. The member conversation remains in Eliza, and slop onboarding uses the rules reader. A dedicated `workers_ai_call` kind needs a migration (migration 0020 constrains the kinds). Test: `packages/network/test/cost.integration.test.ts`.

## Review judge and engine judge

Owner decisions D15 to D17 of 2026-11-22 ([automated review](../../../spec/automatedReview.md)): human review is removed. Two model judges are always on in staging and production. Both use `gpt-6-luna` through the existing clients; neither adds a provider.

- **The review judge** (`review-judge.ts`, `ReviewJudgeWorker`) decides every opportunity before any member is contacted. It reads the packet of `ConsentNetwork.judgePackets` (what a staff reviewer saw, as data: refs and first names, ages, roles, reasons, probe, reveal and fallback texts, place and time; no phone, member id or last name), with the strict rubric when the roster has a minor. Client: `judgeLLM(ledger.llmHooks(app, "review_judge"))` (`JUDGE_MODEL`, else the default model). The prompt writes the explanation before the verdict. The reply is parsed strictly; anything else is `undecided`/`unparseable`. An approval is recorded with `approver: "judge"`; a flag, an unsure reply or a judge that cannot run holds the item for staff (an exception), and the item expires unsent at its review deadline. A code check holds text that speaks to a reviewer or a model (`packet_suspect`) and a pair that a judge or staff flagged in the last 90 days (`prior_flag`) without a model call.
- **The engine judge** ranks candidates before an opportunity exists (`recommenderLLM({ ...ledger.llmHooks(app, "engine_judge"), budget })`). It fails open to heuristics, which is safe because every proposal then passes the review judge.

The worker runs under its own backend tick key, `review_judge` (`Service.reviewJudgeTick()`: serve.ts `round`, backend.ts `tickAll`), after the network runtimes and not inside the network tick. One run starts at most 4 calls per runtime, in parallel, each with a 120 s deadline. `Service.close()` aborts the calls in flight; an aborted call writes nothing and its lease (180 s) expires. Each packet has one row in `network.review_judgments` (migration 0089, keyed by app, network, opportunity, revision and packet hash; each decided row names the judge that wrote it, and a row from another judge is not applied), claimed at most twice across replicas (`judgeClaimDecision`), with one staff audit row (`review_judgment`, no explanation) for each decided row. An item that waits for a judgment for 30 minutes is held as `judge_overdue` by the network tick. Rows are kept 90 days, longer while a roster member has an open safety case, and are deleted at the member's erasure. `network.review_judge_requests` counts the calls per app and UTC day across replicas. A call takes its slot in that counter atomically before it starts (an increment only while the count is below the limit), so the request limit does not overshoot.

| Variable | Meaning | Default |
|---|---|---|
| `NETWORK_REVIEW_JUDGE_BUDGET_USD` | Review judge spend per app per UTC ledger day (`network.cost_ledger`, purpose `review_judge`) | 5 |
| `NETWORK_REVIEW_JUDGE_MAX_REQUESTS` | Review judge calls per app per UTC day, all replicas | 400 |
| `NETWORK_ENGINE_JUDGE_BUDGET_USD` | Engine judge spend per app per UTC day (purpose `engine_judge`) | 2 |
| `NETWORK_ENGINE_JUDGE_MAX_REQUESTS` | Engine judge HTTP attempts per app per UTC day, per process | 200 |

A value that is not a positive number, or a budget below 0.000001 US dollars, refuses the start in every environment. At a limit the review decision is `cannot_run` (`budget_reached`, `request_limit_reached`: the item is held for staff) and the engine falls back to heuristics. Overshoot bound: for the review judge spend, replicas × 4 × the largest call cost per run (its request limit does not overshoot); for the engine judge, replicas × `NETWORK_ENGINE_JUDGE_MAX_REQUESTS` requests per day and one tick of spend after a refresh. A deployed start needs an API key for `JUDGE_PROVIDER` and `RECOMMENDER_PROVIDER` (`SURPLUS_API_KEY` or `OPENAI_API_KEY`).

In `PLATFORM_ENV=dev` a test injects the judges (`ServiceOptions.reviewJudge`, `engineJudge`); without them no model is called, every item is held for staff (`no_provider`) and the engine uses heuristics. A deployed Service refuses an injected judge. The simulator uses the deterministic stand-in `simulatedReviewJudge` (no model call; it does not read text).

Inspect `network.matching_runs.summary.matchingJudge` for engine judge calls, failures, valid verdicts and selected coverage. A failed engine judge can leave heuristic candidates eligible. Friends has no engine judge pack and makes no engine judge calls. Staff see held items in `GET /review` and decided judgments in `GET /review/judged`.

Live qualification of the review judge (fictional packets, a cache keyed by packet hash and prompt version; writes `evals/review/qualified.json`, which the backend image copies and health shows as `reviewJudge.qualified`). The report gives the recall on `must_flag` rows for all rows and for the rows that reach the model only (`modelMustFlag`: code holds a row with a suspect word before the model reads it), and the rows that code holds (`codeHeld`, with the share of `may_approve` rows that code holds, which is the availability cost of the word table). Each answer keeps its cost in `evals/review/judge-answers.jsonl` and the run total goes into the record; this operator run uses fictional packets and no app database, so it writes no `network.cost_ledger` row. Until a record exists for the running model and prompt version, health shows `qualified: null`; the first deploy needs the owner's approval of the live run below:

```bash
pnpm run review-eval --live --budget-usd 1 --max-requests 90
NETWORK_REVIEW_JUDGE_BUDGET_USD=0.5 NETWORK_REVIEW_JUDGE_MAX_REQUESTS=20 \
  pnpm exec vitest run --testTimeout 300000 \
  packages/network/test/slop-date-path.integration.test.ts --test-name-pattern 'join, onboard'
```

These use the configured provider and send no member texts. They do not prove a deployed staging release or a real-person introduction.

## Run it

```bash
# Once: one tick, then exit.
PLATFORM_ENV=dev NETWORK_DATABASE_URL=postgres://$USER@localhost:54339/<db> node --import tsx --env-file-if-exists=.env packages/network/service/main.ts --once --dry-run

# As a service: each network ticks every minute on its own; staff and webhooks on 127.0.0.1:4848, the public API on 127.0.0.1:8790.
PLATFORM_ENV=dev NETWORK_DATABASE_URL=... NETWORK_SERVICE_TOKENS="admin:<t>,reviewer:<t>,safety:<t>,analyst:<t>" \
  BLOOIO_WEBHOOK_SECRET=whsec_... node --import tsx --env-file-if-exists=.env packages/network/service/main.ts
```

The database must have the `network` and `platform` schemas (`pnpm run db:migrate`; runbook-real 1.1). The service checks the tables at start and does not migrate. It reads the networks and the app policy (`platform.networks`, `platform.apps`) at start.

| Variable | Default | What it does |
|---|---|---|
| `NETWORK_DATABASE_URL` | `DATABASE_URL` | Postgres with the `network` schema. A login that can read and write it. |
| `NETWORK_SERVICE_TOKENS` | none | Staff role tokens, the Observatory's scheme. Without them, every staff route answers 401. |
| `NETWORK_SERVICE_AUDIT_DATABASE_URL` | the database URL | The login that writes `network.staff_audit` |
| `BLOOIO_WEBHOOK_SECRET` | none | Verifies the shared line's webhook (`/webhooks/blooio`). Without it, that webhook answers 503. |
| `<APP>_BLOOIO_WEBHOOK_SECRET` | none | Verifies one app's line (`/webhooks/blooio/<app>`). Without it, that path answers 503. |
| `PLATFORM_API_PORT` | `8790` | The public API (`/api/*`) the sites call |
| `SERVICE_TURN_SECRET` | none | Signs the Eliza seam (`/internal/*` and Cloud deliver). The turn path is on when it is set or `NETWORK_CHANNEL=eliza_cloud`; then a secret shorter than 32 characters, or one equal to a staff or console token, stops the start. Without it the signed routes answer 503. |
| `NETWORK_ROUTE_AUTHORITY_POLICY` with `NETWORK_CLOUD_DELIVERY_ORIGIN` and `SERVICE_TURN_SECRET` | unset | Profile review: the private review owner/source callbacks are registered exactly when the isolated staging route, the trusted Cloud delivery origin and the service key are all set (owner decision 2026-11-22 removed `NETWORK_PROFILE_REVIEW_ENABLED`). An isolated route without the Cloud delivery origin is not a partial set: it is a complete isolated realm that does not review profiles (the signed-turn and profile-suggestion disconnect and withdrawal tests boot that way), so the service starts and registers no review callbacks. Missing explicit Network-learning consent denies saving. Review/reject/delete and revoke cleanup remain independent of collection permission. No extraction or Google calls are enabled. Source/local qualification: [purpose factory](../../../docs/results/2026-10-17-profile-review-purpose-factory.md). |
| `STOP_HELP_OWNER`, `STOP_HELP_GATEWAY_SECRET` | retired | Ignored, with a log line. STOP, START and HELP are answered inside the signed turn (below). |
| `PLATFORM_HASH_KEY`, `PLATFORM_SESSION_SECRET`, `PLATFORM_PROXY_SECRET` | dev keys | Phone hashes, session hashes, the site routers' signature. Required in production. `main.ts` refuses to start without them (`assertBootConfig`). |
| `OTP_PROVIDER` | dev console | `twilio` uses Twilio Verify (needs its credentials). The dev console provider refuses production. |
| `NETWORK_SERVICE_HOST`, `NETWORK_SERVICE_PORT` | `127.0.0.1`, `4848` | The bind address. Another host prints a warning. |
| `NETWORK_SERVICE_INSTANCE` | the process id | The name in `pg_stat_activity` (the lock holder in `/health`) |
| `NETWORK_CHANNEL` | dry-run | `blooio` uses the Blooio adapter (needs `BLOOIO_API_KEY`, `BLOOIO_FROM`). `--dry-run` always wins. |
| `NETWORK_CHANNEL` | unset | `blooio` or `eliza_cloud` with its credentials: every app's queued sends are real; a missing credential refuses the start. **[FOUNDER]** |
| `BLOOIO_LINE_DAILY_CAP`, `BLOOIO_LINE_NEW_CHATS_PER_DAY` | 200, 20 | The shared line's daily caps in the queue (agent-started messages, new conversations). Prototype P3 sets them. |

## What it does

| Part | How |
|---|---|
| Tick | Every minute, each network on its own: `runTick()` with its `PgStore` under its advisory lock (`network-tick-<app>:<city>`). A second instance skips a network while its lock is held. The engine runs once a day inside the tick (09:00 New York), as in the simulator. The engine run (with the model judge) computes on a snapshot without the lock; a second, short locked unit loads the newest state, drops the result's items for members whose evidence changed, applies every tick gate again and saves (spec/runtimeUnit.md), so signed turns do not wait for the run. The clock is `RealClock`. A network whose `platform.networks.matching_enabled` is false never matches, whatever its stored switch says. |
| Snapshot | `snapshot.ts` reads one app's members, facets, intents, presence, edges and recent opportunities at the start of every unit of work. Every query filters by `app_id`. A person-to-person block (`platform.person_blocks`, from any app) is a "blocked" edge when both people are members of this app. The Observatory's shadow runs use the same builder (The Network by default). |
| Inbound | `POST /webhooks/blooio` (the one line for every app: `platform.app_lines`, then a keyword such as "slop.date", then the member's open item, then the app that wrote last, then The Network) and `POST /webhooks/blooio/<app>` (an app's own line, if one ever has one). Each checks `X-Blooio-Signature` on the raw body (300 s window). The phone finds the person (`platform.phone_identities`), then the membership, then the member id; members from before the platform use `network.channel_identities`. A message goes into the inbox first (`platform.inbound`, `inbox.ts`): one row per provider message id, so a provider retry, a replay or a second subscription is a duplicate; the webhook answers 200 once the row is stored, and a handler error leaves the row for the next tick (5 tries, then an alert). The messages of one sender are handled one at a time (an advisory lock per sender), oldest first. Each message is one unit of work on that app's network. Every message and tapback on the line resets that conversation's unanswered streak. Someone who is not a member: the join by text (first name and birthday, 13+; nothing stored until the age check passes). With no keyword they join The Network, which asks what they are looking for and enrolls them in those apps. The waiting flows are in `platform.pending_texts`. |
| Keywords | STOP (and opt-outs in the person's own words), STOP ALL, START and HELP go through the platform consent ledger (`platform.consent_events`, one row per message) with the app's own texts (`packages/platform/src/apps.ts`). STOP stops every app. "leave <app>" leaves one app (the forget path). One owner answers keywords: this service (founder decision: one system only), inside the signed turn in production (the section "The Eliza seam"). |
| Public API | `/api/*` on `PLATFORM_API_PORT` (`createPublicApi`). A web join creates the network member for that app and queues the welcome through the normal send path. Stop, leave, delete everything and export call the network paths. |
| Person cap | At most 3 proactive messages a day for one person across all apps (PRD 40.3), taken when a send is handed to the adapter (`platform.person_cap_take`: one lock for every app, a counter in `platform.person_sends`). Over the cap: `refused_person_cap`. |
| Row-level security | Every query on a network table runs in a transaction with `app.app_id` set (`NetworkRuntime.scoped`), so the service runs under a login with the `network_service` role (which inherits `platform_service`). |
| Ages | An age a member states in chat (the Network's `onAgeStated`) lowers the person's age on every app. Under 13 removes every membership. An attested adult's under-13 claim is held by the Network and recorded as 13 here. A minor report or a minor signal (the Network's `onMinorSignal`) writes `platform.person_minor_signals` in the same save; every app's snapshot reads it (`matching_ages.minor_signal_at`) and treats the person as a minor until staff clear the member. `clearMinor` deletes the row when it cleared every membership of the person. |
| Network capital | Every NC ledger event the Network emits is recorded in a `CapitalLedger` (packages/capital) and stored in `network.capital_events` in the unit's transaction. The levers are not read yet. |
| Restart | Rows a stopped worker held during a provider call (`sending`, lease run out) go back to the queue and are sent again with the same provider key. Then the state loads, then the queue delivers what waits. A proactive row older than 24 h, any row older than 3 days, or a row about a closed opportunity is stored as `expired`. Inbound rows a crash left waiting are handled on the next tick. |
| Saves | The Network state, its console rows, and what the unit produced (messages, events, blocks, engine runs, opt-outs, and with Blooio the queue rows in `platform.outbound`) are written in one transaction. Then the queue delivers. |
| Under 13 | The decline goes out. Then the member's row keeps only the id (`account_status = 'removed'`). Their messages, facets, intents, presence, edges, phone and events are deleted (every event that names them: actor, object or payload). |
| Outbound | `ChannelAdapter` (`channel.ts`). `DryRunAdapter` is the default. `BlooioAdapter` is the persisted queue (`packages/blooio` `OutboundQueue`, `platform.outbound`, migration 0015) with the Network's send-time checks: the consent ledger and bans, the member's opt-out, `blooioRecipientPolicy`, the person cap, `forbiddenProvider`. Statuses (and Blooio receipts) are copied to `network.messages`. Attachments (photo links) go as `mediaUrls`. |
| App packs | `packs.ts`. Each network gets its app's engine pack (`appWiring`): The Network keeps networkPack; slop runs `makeSlopPack({ verification: { required: false } })` (founder decision 9: no ID check; a stated adult age is enough) with `SLOP_ENGINE_CONFIG` on nyc; peon runs `peonPack` with `PEON_ENGINE_CONFIG`; friends runs `friendsPack` with `FRIENDS_PLANS`. Members aged 13-17, and anyone who may be a minor, never enter a pack's input (`ConsentNetwork.packInput`). Every item waits for the review judge, or for staff when the judge holds it. slop adds its hooks (`apphooks.ts`): the engine's onboarding loop (`AppHooks.onboarding`: after the welcome answer, each message goes through `extractSlopProfile`, or `applyCorrection` after a read-back, then `slopOnboardTags`; the next message is the read-back once every hard field is set, else `nextQuestion`, one question at a time and each at most twice; the state is kept on the member as `onboarding`, values only, never the member's words). Orientation follows PRD 40.5: "bi", "pan", "queer", "both" and "a mix" leave who they seek unset and the agent asks again; the founder may still choose to read them as a seeking set instead (listed as a founder decision). The pack's own asks use the loop's next question too. Then the date probe with an age band and a distance band, a public place near the midpoint (lit indoor or plaza places after dark), the booked date with the share-my-date tip, and the check-in after the date. A new slop member opts in to dating only when the person is 18 or more. Whatever the engine did, the ConsentNetwork checks a romance proposal again before it starts (`romanceGate`, also for a repeat): exactly two people, each opted in on the record, each a verified adult on the record, each stated who they seek, and `mutuallyOpen` (spec/mutualOpenness.md) on their stated gender, trans status, trans answer and shown-to choice. The trans question follows the read-back for every member; a nonbinary member is also asked whether to appear to people who seek women or men. |
| Reports, holds, bans | A "report X" message and slop's check-in after a date are reports (`reports.ts`): ids and a kind (harassment, lying, no_show, unsafe, scam, minor, other), never the words. An urgent report (harassment, unsafe, scam, minor) by someone who met them, at the check-in or in a "report X" text, keeps the member out of matching until staff decide. Hold reaches the person on every app. A ban (`platform.bans`, migration 0011) by phone or by person restricts every membership, holds every member, suppresses the numbers, and refuses every later join (web or text). Delete everything keeps it. |
| Photos | `packages/platform/src/photos.ts` on `/api/photos/*` (slop only; member photo intake uses the authorized conversation): an adult (the person's lowest stated age is 18 or more; an unknown age fails closed), not banned, the photo consent, JPEG/PNG/WebP up to 8 MB and 6 photos, metadata stripped. Photos by text (`photoIntake.ts`): a slop member's attachment is fetched only after the adult and ban checks pass and the photo consent was given by text (asked once; only an explicit "YES PHOTOS" on a message routed to slop counts, so a bare yes to a probe or on another app is never taken as photo consent); a minor's photo is dropped unfetched. The attachment fetch is https only, with no redirects, a 15 s timeout and the byte cap. A member under 18 or of unknown age gets one plain answer a day; a banned person gets none. ADD PHOTOS (or YES PHOTOS to the consent ask) gets one app-bound, single-use upload link (spec/photoUploadLink.md). DELETE PHOTOS by text erases every photo of the person on every app, their bytes and the rating made from them; a banned sender's command is not taken (the photos stay for the safety team). Storage: `PHOTO_STORAGE=r2` (`R2_ENDPOINT` or `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`; a private bucket) or `PHOTO_STORAGE=local` (dev only, `PHOTO_DIR`). Unset: photos are off. No public URL: staff get a 5-minute signed link (`PHOTO_VIEW_BASE_URL`, default `https://<app domain>`) after an audited read. The rater (`photoRater`; `server.ts` calls the platform's `photoRaterFromEnv`: on whenever the Workers AI token and account are set; the engine's `makeClefRaterFromEnv` from `CLOUDFLARE_AI_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLEF_MODEL`, with the placeholder Clef weights unless `CLEF_WEIGHTS_PATH` names a fitted file with version and provenance (a file without them is refused), with 3 tries on API errors, each try a cost row) rates the member from up to 4 photos after each upload or delete and stores the engine's `appearanceFacet` (agent_private; never in the console). The score is written only while the person and the exact selected photos remain eligible. The write pins the person and photo rows. A late change clears only the version written by that attempt. Without the token or the account id, ratings are off. Leaving the app, delete everything, or an age under 18 deletes the photos and the rating; a ban deletes the rating. |
| Bias monitor | `bias.ts`: once a week per slop network, after a tick, the engine's `biasMonitor` over the last 28 days (proposals, dates, second dates) by photo-rating quintile; stored in `network.bias_reports` (migration 0014), `[alert] bias ...` log lines under 0.8x, shown in the console. |
| Review SLA alerts | After each tick: one `[alert] review SLA ...` log line per item waiting longer than its app's SLA (slop 6 h, peon 24 h, others 12 h; observatory `DEFAULT_SLA_HOURS`). |
| Staff API | Below. Every action writes `network.staff_audit` (a "requested" row before the action, a "result" row after) and the Network's own logs (`review_decision`, `safety_action`, `matching_switch` in `network.events`). |

### Staff API

Send `Authorization: Bearer <token>`. Tokens are per app: `reviewer@slop:<t>` is a reviewer of slop only; a role with no app (`reviewer:<t>`) is for every app. Admin for an app passes every check for it. Name the network with `?app=<app>` (and `&city=`) or `/apps/<app>/<route>`; without it, the route is The Network's. Every action writes the app in `network.staff_audit`.

| Route | Role | Body |
|---|---|---|
| `GET /health` | any role for the app | Last tick, lock holder, backlog (review, overdue, deferred, waiting sends), refusals; with several networks, a `networks` summary |
| `GET /review` | reviewer, safety | The items the review judge held for staff (exceptions: `exception` with verdict, reason, rubric and explanation) and fraud items, oldest first, with the current `revision` for each item |
| `GET /review/judged?since=` | reviewer, safety | Decided judgments since `since` (default and minimum: 7 days ago), newest first, at most 200, without the explanation. Audited as `read_review_judged` |
| `GET /review/judged/:oppId/:revision` | reviewer, safety | Every decided judgment of that revision with its explanation and packet. Audited as `read_review_judgment` |
| `POST /review/:oppId/stop` | reviewer, safety | `{ revision }`: stop an approved item before its reveal (`not_stoppable` after it). Audited as `review_stop` |
| `GET /review/:oppId/probes?revision=` | reviewer, safety | The words each participant would get for that revision: the first probe, its leak-guard fallback and the introduction, and in `replacements` the same for each reviewed alternate and each participant it can replace. Writes the audit row `read_review_probes` first. A changed revision or a passed deadline returns `preview_unavailable` (404). [Probe dispatch](../../../spec/probeDispatch.md), "A reviewer can read each first probe of the open revision" |
| `POST /review/:oppId` | reviewer | `{ decision: "approve" \| "reject" \| "edit" \| "reroll", revision, reason?, note?, secondsSpent?, explanations?, objective?, swapOut? }`. Send the revision the reviewer saw. A changed revision returns `review_stale`. Approve, edit and re-roll only an item the judge held (409 `not_held_for_staff` otherwise); reject any open item. A re-roll sends the new revision to the judge. The token identifies the reviewer; the judge's own names are refused (`reviewer_reserved`). |
| `POST /safety/lift` | safety | `{ memberId, note? }` |
| `POST /safety/close` | safety | `{ caseId, note? }` |
| `GET /signals` | reviewer, safety | Agent signals waiting for a person: `{ id, memberId, kind, evidence, at, caseId }`, newest first (`caseId`: the member's open safety case, or null) |
| `POST /signals/:id` | safety | `{ decision: "reviewed" \| "dismissed", reason }` (reason 5+ characters). Audited before the decision; a decided signal answers 409 `already_decided`, an unknown one 404. The safety case stays open until `/safety/hold`, `/safety/lift` or `/safety/close` |
| `GET /staff/relay/held` | reviewer, safety | Selected photos that the automatic check flagged or could not check, which wait for a safety reviewer until `deadline` (the console's HeldText shape; `memberId` is the sender). No relayed text waits for staff (owner decision 2026-11-22, D18), so no row is a text |
| `POST /staff/relay/:itemId/release` | safety | `{ note }` (or `reason`), 5+ characters, else 409 `reason_required`; it goes in the audit row. A selected photo only (`pri_` ids); any other id answers `not_held` |
| `POST /staff/relay/:itemId/reject` | safety | `{ note }` (or `reason`), 5+ characters. A selected photo only; any other id answers `not_held` |
| `GET /queue/leak-review` | safety | Texts the outbound queue's leak guard parked (`parked_leak_review`; a relayed text `relay:<item>` and an expected-member invitation are dropped instead, owner decision 2026-11-22, D18), oldest first: `{ id, kind, memberId?, to (masked), reasons, createdAt, text? or minor: true }`. 404 without a reason when the network has no queue (dry run) |
| `POST /queue/leak-review/:id` | safety | `{ decision: "release" or "drop", reason }` (5+ characters). Release: back to the queue, every other send check runs again, the leak guard does not park it again (`leak_released_by`, migration 0032); refused (`minor`) when the member's age is in doubt. Drop: ends `dropped_leak_review`. 409 `not_parked`. Audited (`leak_release`, `leak_drop`) |
| `POST /inbound/resolve` | admin@* | Release a sender held back by a signed turn that did not finish: `{ id }` |
| `GET /safety/reports` | safety | Reports about this app's members, newest first: `{ id, kind, reporterId, subjectId, opportunityId?, at, status, source, priorReports }` (docs/admin-console.md 3.7.1) |
| `POST /safety/hold` | safety | `{ memberId, note (5+ characters), reportId? }`: the person on every app |
| `POST /safety/ban` | safety | `{ memberId, by: "phone" \| "person", note, reportId? }`; 409 `already_banned`, `no_person`, `no_phone` |
| `POST /safety/dismiss` | safety | `{ reportId, note }`; 409 `unknown_report`, `already_<status>` |
| `POST /members/:id/verify` | safety | `{ check: "age" \| "liveness", result: "pass" \| "fail", note }`: `verify:<check>:<result>` on the member (PRD 40.5), until a vendor writes it |
| `GET /members/:id/photos` | safety | `X-Network-Reason: <5+ characters>`. Only with an open safety report (open or held) or an open safety case about the member, as the photo consent promises (403 `no_report`, audited as refused); the report or case id goes in the audit row. Verified adults only (403 `adults_only`); the audit row is written before any link |
| `GET /bias` | admin, analyst | The newest weekly bias monitor reports of the network (aggregates only) |
| `POST /matching` | admin | `{ on: true \| false }`. Refused (`matching_not_allowed`) for a network the registry keeps off. Migration 0011 allows slop and peon; their stored switch still starts off. |
| `GET /postings?managerId=` | admin, reviewer | peon only (404 elsewhere). The job postings of one hiring manager, or all (`postings.ts`). Audited as `read_postings`. |
| `POST /postings` | admin | peon only. Create, update or reopen a posting `{ managerId, id?, title, payMin, payMax, openings?, mode?, area?, must?, nice?, sponsors? }` through the same checks as a text post (an adult, active, opted-in manager). Audited as `save_posting`. |
| `POST /postings/:id/close` | admin | peon only. `{ reason: "closed" \| "filled" }`; open seat items that are not booked end at once. Audited as `close_posting`. |
| `POST /employers/:memberId/verify` | admin | peon only. `{ company, note }` (note 5+ characters): the company fact and `peon:verified` on the manager. peonPack proposes no job of an unverified employer. Audited as `verify_employer`. |
| `/review-mode` | none | Always 404. There is no review mode: the review judge decides every item, and staff decide held items (owner decisions D15 to D17 of 2026-11-22). |

A refused action answers 409 with the Network's reason (for example `participant_minor`, `matching_paused`, `not_in_review`). A new stored state starts with matching off (runbook-real 7.4 check 8). An admin turns it on.

## The outbound queue

The Blooio and Cloud adapters deliver through the persisted queue in `packages/blooio/src/outbound-queue.ts` (`platform.outbound`). Its file header lists every check at send time. This section covers the parts the service decides.

The Network composes every message; a channel adapter (`channel.ts`) only delivers what the Network already decided to send. The dry-run adapter is the default: nothing leaves the machine, the service stores each send in `network.messages` with status `dry_run`, and the adapter logs one line with no message text. The Blooio and Cloud adapters write each send into the queue in the same transaction as the Network state, and the queue delivers after the commit with the send-time checks (consent, the recipient, the person cap, the leak lists). The configured channel alone selects the adapter (spec/bootPolicy.md, owner decision 2026-11-22); no per-app approval gates the queue.

`BlooioAdapterOptions`: `provider` is the provider adapter (`packages/blooio` over a Blooio client; the simulations pass a recording fake). `from` is the sending line (`BLOOIO_FROM`) and is required, because the queue counts per line. `city` gives the quiet-hours fallback zone (default `nyc`). `limits` are the queue limits; the per-line caps also read `BLOOIO_LINE_DAILY_CAP` and `BLOOIO_LINE_NEW_CHATS_PER_DAY`, with the defaults in `outbound-queue.ts`. `net` and `memberOf` are accepted from older callers and ignored: the runtime supplies the Network and the address book when it attaches the adapter. A direct text drains the line, so the drain also sends the other due rows of the line, and their status changes go to `network.messages` as the changes of a runtime drain do.

### Kinds

A row's kind decides which checks it skips. Only `compliance` skips the opt-out, the recipient check, quiet hours and the caps. `reply` skips quiet hours, but it must answer a message the person sent in the last hour. `transactional` and `proactive` get every check.

### Direct texts

`NetworkService.direct()` sends one fixed text to a person who is not a member here, or before the member exists. Each caller passes its own kind:

| Caller | Text | Kind |
|---|---|---|
| `inbound`, a number on hold | HELP answer | `compliance` |
| `inbound`, "leave <app>" | the leave confirmation | `compliance` |
| `inbound`, not a member | HELP answer | `compliance` |
| `stop`, not a member | the STOP or STOP ALL confirmation | `compliance` |
| `join`, invite-only app | the invite-only answer | `reply` |
| `join`, no age yet | the join question (name and age) | `reply` |
| `join`, under the join age | the under-age decline (a refusal of service that must reach the person; the Cloud contract reports it as `compliance`) | `compliance` |
| `join`, no name yet | the name question | `reply` |
| `PhotoIntake` (`photoIntake.ts`) | the photo consent question and photo answers | `reply` |
| `invite` (staff) | the invitation | `transactional` |

A direct text in a signed turn goes back to Cloud as a collected reply, with kind `compliance` or `reply`. A direct text with no member on the row, to an address that is not a member of the app, skips the member policy (`blooioRecipientPolicy`), because there is no member to check. It still gets the consent ledger, bans, suppression, quiet hours, caps and the leak guard. The consent check (`NetworkRuntime.optedOut`) reads `platform.consent_events` by address for these rows too. A person who sent STOP therefore gets no join question until they opt in again. A text join message with both their name and age opts them in (the join records a new consent event), and so does a web join.

### STOP and the inbox

A STOP, STOP ALL, "leave <app>", START or HELP that waits in the inbox is handled ahead of the sender's earlier rows (`inbox.ts`). An earlier row that keeps failing therefore never holds back a consent change or its confirmation. A handled STOP or STOP ALL ends the sender's ordinary rows that came before it, with outcome `cancelled_by_stop`. The Network never acts on them after the STOP; a join answer handled late would opt the person back in. Messages that come after the STOP are handled as usual. Signed turns already let these keywords through, and "leave <app>" now counts too. Integration case: `packages/network/test/inbox-order.integration.test.ts`.

### The consent ledger at dispatch

The queue keeps no STOP ledger of its own. Every row except a compliance text reads consent from Postgres at dispatch: `platform.consent_events`, bans and suppression (`NetworkService.consentRefused`), and `network.members.opted_out`. The member check runs again inside the claim transaction. So a STOP that comes in while a row waits wins on every replica. Persisting a separate ledger in the queue's tables was the other option. It was not taken because it would be a second copy of `platform.consent_events`, and the two could disagree after a STOP through the web or the gateway. A row that waits is not cancelled at STOP; dispatch ends it as `refused_opted_out`.

### More than one replica

Every replica may drain the queue. There are three guards, and the provider key stays `tn:<row id>` on every attempt:

1. One drain at a time per line, across processes, through a Postgres advisory lock (`blooio-line:<line>`). Receipt lookups for rows in `unknown_acceptance` run before the lock, so canonical erasure never waits on remote I/O. Their commit is conditional on the row's status, so a receipt is committed once.
2. A conditional claim before the provider call. The update to `sending` happens only if the row still has the status the drain read and no lease, and it sets a lease (`leaseMs`, 5 minutes). A worker whose claim fails leaves the row to the worker that claimed it and does not end it.
3. `recover()` hands a `sending` row whose lease ran out back to the queue. The worker stopped. With a receipt lookup the row goes to `unknown_acceptance` and is never sent again. Without one it is sent again with the same key, so the provider replays the first result.

Integration case: `packages/blooio/test/outbound-queue.test.ts` runs two workers with their own pools on one database, and each row reaches the provider once.

### The leak guard and the thread

Before a send, the leak guard checks the new text. It also checks the new text together with the texts sent to the same address on the line in the last 24 hours (up to 4 of them; `LeakGuard.checkThread`, core-14). This catches another member's value split across messages. The generic contact patterns run on the new text alone, because two ordinary messages joined can look like a phone number. A thread hit holds the row as `parked_leak_review` with labels prefixed `thread:`. A compliance text is checked on its own text only. Labels are keyed with `LEAK_LABEL_KEY` in staging and production (core-6). `deploy/backend` `loadConfig` refuses to start without it, and `server.ts` calls `setLeakLabelKey`. Dev and the simulations stay unkeyed, so their labels are reproducible.

## The boundary with `packages/plugin-network`

Two parts of the product talk to members. They have different jobs.

| | This service (`packages/network/service`) | `packages/plugin-network` (the Eliza agent side) |
|---|---|---|
| What it is | The Network: matching, review, consent, probes, booked plans, reminders, feedback, safety, outreach limits | An Eliza plugin: the member-context provider, the `SET_STATE` action, the network-signals evaluator and their routing |
| Who runs it | A Node 26 process (Railway worker, runbook-real 7.2) | Eliza Cloud, on each agent turn, with Cloud's stores and turn authority |
| State | `network.network_state` and the console tables, under the advisory lock | The `NetworkStore` that Cloud injects (availability state, member context) |
| Messages | Every Network message (probes, booked plans, reminders) goes through its send path, the leak guard and the adapter | Agent replies in a conversation the member started |
| Review | Every opportunity waits for a person here | Never composes an opportunity |

Rules for the boundary:

1. **One owner per inbound message.** The service handles every inbound message it gets. This service answers STOP, START and HELP, inside the signed turn; the gateway only mirrors the reported `consent`. The legacy Blooio webhook must not point at the service while the gateway owns the line, or two systems would confirm a STOP.
2. **Only this service proposes or contacts members about other members.** The plugin must not send probes, introductions or booked plans. It can read what the Network knows through its own store.
3. **Joining is a membership.** The platform creates members after a verified join (`POST /api/join`) or a join by text on an open app. A new membership through a forwarding link commits with consent, the Network member, and the app-scoped attribution. An `invited` member still has to complete signup.
4. **No shared process state.** The two talk only through Postgres (the `network` schema) and the channel gateway. Nothing here imports Eliza, and the plugin does not import this service.

## Founding-cohort invitations

An app admin can issue one batch through `POST /apps/<app>/invite/seed` with a
UUID `batchId` and `invitations` containing up to 100 rows. Each row supplies
`phone`, `city` (`nyc` or `sf`) and a private `vouch` of at most 500 UTF-8 bytes.
Forward the returned links to their intended recipients. An exact replay by
the same issuer returns the same links until expiry. Changing the rows under
the same batch ID returns a conflict.

The verified recipient decides whether to join through the existing age and
consent checks. The first join records the issuer and cohort city separately
from the member's own profile. Private vouches leave the invitation on
redemption, signed decline, or expiry. [Seed invitation rules](../../../spec/seedInvitation.md)

## Expected member invitation

A member can take an issued forwarding link and send a private signed turn
`SEND INVITE <link> TO <phone>`. The service returns a short-lived reference.
The member replies `CONFIRM EXPECTED INVITE <reference>` only if the recipient
expects the text. The confirmation reply is the same when the recipient is
unavailable. The normal vouch review and invitation allowance already apply to
the link.

The service-send path needs a carrier adapter that admits first contact.
Eliza Cloud currently requires a Cloud account before it admits a proactive
delivery. On that adapter or while delivery is disabled, the service returns
the forwarding option without saving a draft or asking for a confirmation.

The existing outbound queue applies consent, quiet hours, line limits and the
leak check. A sent invitation names the inviter and gives the recipient
`DECLINE INVITE` and `STOP`. The queue uses the original key for any provider
receipt lookup. Once queued, the link requires verification of the exact
recipient phone, along with the existing age and consent checks. [Expected
invitation rules](../../../spec/expectedMemberInvitation.md)

## Review saved profile facts

In a signed member conversation, send `SHOW MY FACTS` or `WHAT DO YOU KNOW ABOUT ME?` to list the current app's saved facts with their source and privacy scope. Follow the page prompt to see more. `SHOW MY <APP> PROFILE` still reads back the saved signup profile.

Use a reference from the list with `CORRECT FACT <ref> TO <text>`, `REMOVE FACT <ref>`, or `SET FACT SCOPE <ref> TO <scope>`. The service sends an exact edit code that lasts 15 minutes. Reply with `CONFIRM FACT EDIT <code>` to apply it or `CANCEL FACT EDIT <code>` to discard it.

## Connected-source profile suggestions

`profile-suggestions.ts` keeps private Gmail and Calendar suggestions until the member accepts, edits, rejects or deletes them. Only an accepted value enters `network.facets`. The owner (Cloud user, organization, person, app and chat) always comes from the signed server context, never from the assistant. A disconnect, delete or withdrawal selects rows with `cleanupCoversGrant` from the [source rule](../../../spec/profileSuggestionSource.md). The SQL does not compare the times, so the rule stays the one decision: the cleanup locks every suggestion row of the connection in a batch that it already holds with `FOR UPDATE`, and then keeps only the covered rows, so the wider row lock adds no new wait. The collection commit check reads every disconnect, delete and withdrawal receipt of the connection and asks the same rule; these receipts are few for one owner and connection. The connection cleanup receipts are append-only: the runtime role has only SELECT and INSERT on them, so the cleanup reads them without `FOR UPDATE`, and the person and member row locks serialize the retries of one owner. A receipt insert that conflicts with the nonce of another owner rolls the whole cleanup back. The disconnect and withdrawal endpoints need both the signed Cloud proof resolver and the storage adapter; without one of them they fail closed. A cleanup reply carries only counts: no connection details, source text, profile text or proof goes back, and a database error answers `review_unavailable` with no detail. The learning consent context signs nothing while profile review is off, takes the person, member and turn locks in that order, and reads the STOP ledger of the one phone identity of the person, never the newest of several. The profile text that a member's agent sends through `submit_profile` is learned and then kept only as a placeholder row of type `agent_profile` ([submission rule](../../../spec/mcpProfileSubmission.md)).

## Private home-help review

An eligible adult who asks for home entry receives a private intake prompt. The
signed reply records the confirmed moving task, NYC neighborhood, time window,
effort and outcome of considering a service. The owner can revise or close the
plan by ID and revision. Members can express or withdraw willingness with
`OFFER HOME HELP` and `WITHDRAW HOME HELP OFFER`.

Safety staff on the app use `GET /apps/<app>/safety/home-help` for the queue.
`POST /apps/<app>/safety/home-help/<id>` takes `nominate`, `approve` or `close`
as the action, with the current revision and the exact helper IDs for nomination
and approval. Nomination creates a new revision. Approval rereads age, consent,
holds, blocks, offers, availability and capacity. A singleton also needs recorded
prior contact at a shared public plan or a confirmed meeting edge. Approval, the
exact consent roster and its staff audit commit together. The outbound queue
sends the requester a coarse plan card, then asks the approved helpers after the
requester's explicit yes. Each signed response names the plan code and revision
and requires a send receipt for that member's card.

A participant sends `HOME HELP ADDRESS <plan code> <revision>` in the signed
conversation. The reply to a recorded yes names this command. The answer
carries a link to the private page `https://<domain>/home-help#<plan code>-<revision>`
and never the address: the requester gets it after the whole approved roster
agrees, a helper only after the requester saved the address. Every other case
gets one closed answer. A verified app session on that page can use
`POST /api/home-help/venue`. Send `action` (`submit`, `reveal` or `revoke`),
`id` (the plan code) and `revision`. Add `address` for `submit`. Only the
requester can submit or revoke it. Only current, consenting helpers can retrieve
it, after everyone on the approved roster agrees. The response is private and
uncached. Keep the address out of SMS, agent chat and tool logs.

[Review rules](../../../spec/boundedHelp.md) ·
[Consent rules](../../../spec/homeHelpConsent.md) ·
[Private address rules](../../../spec/privateHomeHelpVenue.md)

## Monthly NYC gathering

Network admins use `GET /apps/ntwrk/gatherings` to list gatherings, or `POST`
to create a draft with `month`, `venue`, `startsAt`, `endsAt` and `capacity`.
Use `YYYY-MM` for the NYC calendar month, Unix milliseconds for the times,
and a `venue` with `kind` (`curated` or `listing`) and its `id`. Submit the
draft's `revision` and `decision` (`approve` or `reject`) to
`POST /apps/ntwrk/gatherings/<id>/review`. Approval records the authenticated
staff actor and rechecks the selected public venue and time.

Before the gathering starts, `GET /apps/ntwrk/gatherings/<id>/priority?revision=<revision>`
returns eligible member IDs in suggested invitation order. The order uses
newcomer, recent participation and pending second encounter evidence.
Submit `revision` and an ordered `memberIds` selection to
`POST /apps/ntwrk/gatherings/<id>/invitations/review`. You can omit members
and preserve the order of the members you select. The first decision fixes
that revision's list. An identical request returns the saved review.

During the NYC rollout, ordinary service ticks pass each reviewed invitation
through the proactive outreach and outbound queue checks. A current public
venue, an available RSVP place and the recipient's current event preference
are required. The invitation includes a reply command for that gathering.

Eligible adults use the signed text conversation to send
`RSVP GATHERING <id> <revision> YES`. They can add `WITH GROUPING` to let
staff consider them for a small group. A later plain `YES` removes that
permission and keeps the reservation. `WITHDRAW GATHERING <id> <revision>`
withdraws the RSVP. An admin can read the current roster at
`GET /apps/ntwrk/gatherings/<id>/roster?revision=<revision>`. The roster uses
member IDs and the current grouping choice.

Use `GET /apps/ntwrk/gatherings/<id>/grouping?revision=<revision>` to preview
groups of three to five members with current grouping consent. Approve the
current `fingerprint` and `revision` with
`POST /apps/ntwrk/gatherings/<id>/grouping/review`. A change to the current
grouping requires a fresh review.

Members with an active reservation can receive a day-before reminder, a
near-start reminder, and a private attendance question through the usual
outbound controls. Members have seven days after the gathering ends to send
`GATHERING ATTENDED <id> <revision> YES` or `NO`. From the start of the
gathering, members in an approved group can send `GATHERING REFERENCE <id>
<revision>` for their own shareable reference. After confirming attendance,
use `GATHERING FOLLOW-UP <id> <revision> <peer-reference> YES` to make a
private choice, or `NO` to withdraw it.

Two current mutual choices can create one second-encounter review for that
gathering and pair. Staff approve the exact pair. Each member then answers
their own anonymous probe before either receives the initial meeting details.
The queue rechecks the exact gathering choices and both members' adult
eligibility before initial contact or disclosure. A booked meeting uses the
ordinary logistics and consent rules.

The caller of the grouping, priority, roster and match-authority reads holds
the app's runtime lock. A delivery or notice claim takes its locks in the
Network save order: the state and catalog fences, then the event, then each
person (the peer too), then the RSVP and member fences. The last app check
runs inside the persisted outbound claim, after the shared send gates. Staff
review never creates an outbound row; only the live NYC runtime stages one.
RSVP, attendance and follow-up commands run only inside the signed direct
member turn that stores the private reply atomically. A retry returns only the
still-current acknowledgement for that turn. A malformed private command does
not reach the ordinary conversation. Outreach spells an event ID without
phone-shaped digits. Grouping finds compatible groups of three first, so a
fourth or fifth member cannot crowd out a new group. Follow-up choices are
internal evidence: pair policy and a fresh review still govern any contact.
The repeat-source read uses only the current two-choice epoch, and no member
text, address or reply ID goes out of that module. The invitee read is a
staff read of an approved gathering, which cannot change, and it never sends.
The invitation review rechecks the ordered engine shortlist against current
app membership and RSVP records, and the engine recommendation stays current
through the write. Each attendee check uses the same canonical scope as the
RSVP and roster reads. A notice claim rechecks the RSVP and the exact, still
timely payload under the existing row fences of the queue. A venue is current
only when it is the current published listing with its exact public name and
time window. A provider claim needs that exact reviewed listing and eligible
active participants.
The public-event importer is a separate job that never runs during a request
or a tick. It takes the catalog lock exclusively before it replaces the
source. The catalog read is public and city-scoped and reads no app record.

[Staff review rules](../../../spec/monthlyGathering.md) ·
[Invitation approval](../../../spec/monthlyGatheringInvitationReview.md) ·
[Invitation delivery](../../../spec/monthlyGatheringDelivery.md) ·
[RSVP and privacy rules](../../../spec/monthlyGatheringRsvp.md) ·
[Grouping review](../../../spec/monthlyGatheringGrouping.md) ·
[Reminders and attendance prompt](../../../spec/monthlyGatheringNotices.md) ·
[Attendance and follow-up](../../../spec/monthlyGatheringFollowup.md) ·
[Reviewed second encounter](../../../spec/gatheringRepeat.md) ·
[Second-encounter delivery checks](../../../spec/gatheringRepeatDelivery.md)

## Teen friend introductions

The owner decision of 2026-11-22 (answers A1 to A5) lets friends.help and the ntwrk `Friend` lane introduce a person aged 13 to 17 for friendship to a teen-ready person aged 13 to 18 born at most 2 years apart, and lets friends.help seat a minor in a small group of at most 6 at an all-ages public place (spec/friendIntroAge.md, spec/teenIntroSwitch.md). Teen introductions are on from the start. The stop is stored network state: the key `teenStop` (`{ by, at }`) is present while they are stopped, in any shape (the service reads a present key as stopped). `POST /teen-intros` with `{ "on": false }` from one `admin` or `safety` staff member stops them on every network whose app offers them (friends and ntwrk) and closes every open teen item and relay thread; `{ "on": true }` from one `admin` deletes the key. A body without a boolean `on` is 400 `on_required`. Each call writes one `config` audit row `teen_intros_<network>` for each network, and health lists the state of each network.

There is no staff confirm step: a member with an exact birth date, aged 13 to 17, with no bar, no open minor signal or report and no age conflict is teen ready. The review judge decides each teen introduction with the strict rubric; staff approve only a teen item the judge holds (owner decisions D15 to D17 of 2026-11-22). `POST /apps/<app>/safety/older-than-stated` records that a member is older than stated: it closes their teen items, bars the phone from the teen pool, places the report hold and opens a case for each minor who shared a roster with them. An open report, report hold or trust hold on one app writes `platform.teen_pool_holds` and makes the member unready in every teen pool while it lasts. A teen pair that reaches a probe, a decline, a rejection or a report on one app writes `platform.teen_pair_avoid`, and the pair is not proposed on the other app.

A member with a stored minor signal, a minor report or an age conflict is out of every teen pool until a `safety` or `admin` staff member runs the teen doubt clear (`POST /safety/clear-minor`, `teenDoubtClearResult` in spec/safetyCase.md). This includes every member who was a minor before this change, because the old age block stored a minor signal for each one. The doubt clear never clears a bar or an `older_than_stated` or `lying` report. This query counts, for each network, the minors with a stored doubt:

```sql
select saved.id as network, count(*) as minors_with_stored_doubt
from network.network_state saved
join lateral jsonb_to_recordset(saved.state->'members')
  as m(id text, minor boolean, "minorSignal" boolean, "minorReported" boolean, "ageConflict" boolean) on true
left join network.members nm on nm.app_id = saved.app_id and nm.id = m.id
left join platform.person_minor_signals s on s.person_id = nm.person_id
where saved.app_id in ('friends', 'ntwrk') and coalesce(m.minor, false)
  and (coalesce(m."minorSignal", false) or coalesce(m."minorReported", false)
    or coalesce(m."ageConflict", false) or s.person_id is not null)
group by saved.id
order by saved.id;
```

Residual risk that the owner accepted: the only age evidence is a typed birth date. An adult who types a teen birth date and keeps it consistent can reach minors after a model approval only (owner decision D16 of 2026-11-22: no staff reviewer reads an approved teen introduction). A second phone number starts clean. The bars, reports, minor signals, age conflicts, relay holds, tag-only probes, daytime public places and the tick sweep reduce this risk; they do not remove it. Reports to the owner: upstream Eliza must know that a teen on friends.help or ntwrk.party can have friendship items and a RELAY path (until then Eliza can tell such a teen that it makes no introductions); the legal review (COPPA actual knowledge, the New York Child Data Protection Act consent for 13 to 17, assistant app rules); and the simulation's truth-based poser counts (`h_teen`) with 95% confidence intervals.

Deploy note. The network reads ages from the reading columns of `platform.matching_ages` (migrations 0081 and 0082). A row that has an integer `lowest_age` but no reading columns is not read when the other row of the person has readings. After 0081 runs, no writer from before this change may run: if one ran (a rolling deploy), run the 0081 back-fill again before teen introductions serve live members.

## Limits

- **No live send has been made.** The Blooio path is tested only with a fake provider.
- **The queue's caps are placeholders.** 200 agent-started messages and 20 new conversations a day per line until prototype P3 measures the line.
- Parked leak reviews have staff routes (`/queue/leak-review`, above). Collected replies in signed turns get the same leak guard before they are returned to Cloud; one that fails goes to the queue instead, where it is parked for that review.
- **The requester's time question has no opportunity id.** The Network sends it with no `proposalId` (network.md 4.1), so its `network.messages` row has no `opportunity_id`. Probes are linked through `meta.probe.key`.
- A direct signed request asks for the relationship, duration and depth. The member confirms the readback before a link is issued. Eligible adults can forward the app-bound, single-use link. It expires 30 days after the request. Reviewers can list and decide unusual vouches through `/apps/<app>/review/member-invitations`. After approval, the inviter asks for the link with `Check invite <code>`. Signup checks the invitee's verified phone, age and consent. The invitee's city owns the welcome, and the inviter's city owns the join notice. [Invitation rules](../../../spec/memberInvitation.md) · [Join projection](../../../spec/invitationJoinProjection.md)
- **The service imports the Observatory's modules** (`events.ts`, `engineCapture.ts`, `staff.ts`) by path, so the events, run summaries and staff auth are the same in both. The Observatory imports `snapshot.ts` from here.
- **No JWT check.** Use role tokens only, and keep the port on 127.0.0.1 or behind an access proxy.
- **No fencing on the save.** Two instances that both believe they hold a network's lock can overwrite each other's state (audit network-service-8).
- **One network engine for every app.** Each app's ConsentNetwork is The Network's code with that app's brand words and join age. The NYC places, time zone and copy are NYC only. The slop and peon packs are wired (`packs.ts`); their matching is off only by the stored switch (`POST /matching`).
- **Phones of platform members are in `platform.phone_identities` only.** `network.channel_identities` allows one member per address, so it cannot hold a phone that is a member of two apps. Console views that read phones from `channel_identities` do not see platform members.


### Public event catalog

The NYC matcher reads upcoming public listings from the catalog after a successful import. This can recheck a standing intent on the next matching tick. A changed listing requires another approval before anyone is contacted about it. Matching ticks and member turns read Postgres only. [NYC Parks public events dataset](https://data.cityofnewyork.us/City-Government/NYC-Parks-Public-Events-Upcoming-14-Days/w3wp-dpdi)

Migration `0042` creates the catalog and its restricted ingest role. Give the feed runner a separate login with `network_public_event_ingest` and set `NETWORK_PUBLIC_EVENTS_DATABASE_URL` for that runner. Run one refresh explicitly with Node 26.

```sh
node --import tsx packages/network/service/import-public-events.ts
```

The command fetches the city dataset once and publishes the normalized scan in one transaction. The daily source expires from matching after two days without a successful refresh. The backend starts with an empty catalog on a new database. [Catalog rules](../../../spec/publicEventCatalog.md)

The deployed backend refreshes the catalog itself: each tick round runs `deploy/backend/public-events.ts` as the ingest login when the last successful scan is a day old, under a database lock, and retries an hour after a failure. Staging and production do not start without `NETWORK_PUBLIC_EVENTS_DATABASE_URL` (docs/deploy.md 2.3). No separate cron service is needed; use the command above for a first import or a manual refresh.

### Isolated signed-route receiver

`NETWORK_ROUTE_AUTHORITY_POLICY` is optional server-only JSON, accepted only with
`PLATFORM_ENV=staging`. Its exact shape is `{authority: {version: 1, routeId,
generation, audience, realmId}, admitUntil, drainUntil}`; deadlines are integer
server epoch milliseconds with `0 < admitUntil <= drainUntil`.
A distinct realm uses its own `SERVICE_TURN_SECRET`. No URL, key or sender clock
is carried in the signed authority envelope. Absent policy keeps legacy requests
without an authority unchanged and refuses requests that carry one.

New turns require the exact configured tuple before `admitUntil`; the inbox claim
stores that tuple atomically in `platform.inbound.network_authority` (migration
0036). Until `drainUntil`, only an existing matching turn may replay or accept its
normal receipt/actions. Original signed raw-body hashes and member/app ownership
checks remain mandatory. Relay and unbound outbound Cloud sends are refused in
an isolated realm. Handled replies still use the gateway's original signed turn
and receipt path. No production route or credential is changed by setting up this
receiver code; isolated runtime configuration requires its separate deployment.
