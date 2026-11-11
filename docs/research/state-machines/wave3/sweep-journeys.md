# Wave 3 sweep: member and staff journeys across models

Hand-written, 2026-11-09. Read-only research on branch `claude/quint-state-machines` (code at HEAD f02196f),
with the drift review on `claude/formal-main` (docs/results/2026-11-09-quint-drift.md, quint/drift.json) as input.
No file in the repository was changed. No quint run was needed: each finding below is a missing state or a
missing action, found by reading the code and grepping the 18 models on this branch (and the 29 on formal-main).

Coverage note. This sweep traced the 11 member journeys and 4 staff journeys of the task through
`packages/network/service/service.ts`, `inbox.ts`, `cloud-channel.ts`, `channel.ts`, `runtime.ts`,
`packages/blooio/src/outbound-queue.ts`, `packages/platform/src/{api,accounts,pg-store}.ts`,
`packages/observatory/src/server.ts`, `packages/core/src/svc/contract.ts` and `sites/skills/*/SKILL.md`. Most
journey steps are already covered by a model (section 4 of the synthesis lists them; the drift review confirmed
the models against the code). The items below are the hand-offs that I could not find in any model. Items that
are already known (SD-023, SD-024, SD-058, SD-109, SD-255, SD-489, SD-492, and the two defects that formal-main
fixed: the session rotation race and the under-13 invite_only exit) are not reported as new.

## Journey trace summary

| Journey | Models that cover the steps | Uncovered hand-off (item below) |
|---|---|---|
| Join by keyword (text, SKILL, MCP) | join_age, turn_consent, auth_edge, oauth_mcp, join_flow (formal-main) | SKILL client protocol (I-8) |
| Network join, no keyword, looking-for | join_age (lookingFor, enroll) | none found |
| Minor journey | join_age, opportunity, relay, photos_rating, safety_trust | none new |
| Match to meeting to feedback | opportunity, matching_engine, safety_trust, notify_capital | agent safety concern to safety (I-4) |
| Relay of number and photo | relay, photo_relay_item (formal-main) | none new (relay swap drift is open on formal-main) |
| Leave one app, STOP ALL, START | turn_consent, outbound_queue | Cloud fence opt-out never reaches the backend (I-1); START order (I-6) |
| Number change | identity_sagas, oauth_mcp | Cloud mode refuses it (I-7, cross-ref SD-489); Cloud store not told (I-2) |
| Delete everything | identity_sagas, oauth_mcp, photos_rating | Cloud history kept (I-2); notice row kept (I-3) |
| Ban | identity_sagas, safety_trust, auth_edge | Cloud not told (I-2) |
| eliza.app takeover notice | join_age (noticeRow) | recycled number never gets the notice (I-3) |
| Staff review / hold | opportunity, review_desk (formal-main), staff_console | SLA alert dedupe (I-5) |
| Staff ban | staff_console, identity_sagas | none new |
| Staff export / delete by e-mail | none | SD-255 (known, skipped) |

---

## I-1. A Cloud fence opt-out never reaches the backend (model_gap + suspected_defect, P1)

**Where.** packages/network/service/cloud-channel.ts:62-63 (Cloud answers `{ok:false, error:"opted_out"}` and the
adapter throws `ChannelSendError(..., "blocked", ..., "opted_out")`); packages/blooio/src/outbound-queue.ts:591-593
(the row ends `blocked`, `onAlert`); packages/network/service/channel.ts:214 (`onAlert` only writes a log line);
packages/network/service/runtime.ts:215-227 and :299 (party eligibility reads `network.members.opted_out` only);
packages/network/service/service.ts:766 and :2307 (the ledger is the only other opt-out source).

**What the models have.** outbound_queue.qnt:527 and :587 end the row `blocked` on Cloud's `optout` answer.
turn_consent.qnt:388-394 feeds the fence only from the backend's own `consent` echo (backend to Cloud). No model has
the other direction: a fence state that the ledger does not have.

**Machine (implicit).** Per (phone, app): `agree_in` (ledger in, fence in), `fence_only_out` (ledger in, fence out),
`agree_out`. The only transition out of `fence_only_out` is a later backend echo of `opted_in` (a text join or a
member START). Nothing moves `fence_only_out` to `agree_out`.

**Trigger (all steps are in code today).**
1. A number has an older STOP in the gateway fence (any of: the web join path, which does not echo its opt-in,
   SD-023 "skipped" half; a recycled number whose old owner sent STOP, then staff choose `new_owner` and
   pg-store.ts:364-373 deletes the old owner's ledger rows, while the fence keeps its row; a STOP that the gateway
   answered itself after a `turn_unresolved`).
2. The backend ledger resolves `opted_in`; `network.members.opted_out` is false.
3. The tick selects the member; a reviewer approves the probe; the queue admits the row (both consent checks pass,
   outbound-queue.ts:437, :549-552).
4. Cloud answers `opted_out`. The row ends `blocked`. A log line is written. The Network's belief (`onSent`,
   SD-006 family) says the probe went out; the counterpart's item waits until it expires.
5. Steps 3-4 repeat on every cycle: the member is matched, reviewed and counted against the counterpart, but is
   never reachable. Reviewer time and the counterpart's attention budget are spent on each cycle.

**Rules.** AGENTS.md 2026-10-09 item 2 "Only one system answers STOP" and "the gateway copies it into its send-time
fence"; turn_consent `fenceMatchesLedger` (its comment says the stores must converge). Matching a person whom the
transport refuses breaks the intent of PRD 40.3 (no texts after STOP) only on the backend side, so it is a
waste and a counterpart harm, not a send to an opted-out person.

**Proposal.** Extend `turn_consent`: add a Cloud-originated action `fenceOptOut(app)` (the gateway's own STOP or
carrier opt-out) and a `deliverRefused(app)` action that reads it. Add `knownOpen` invariant
`noMatchAgainstFence`: when quiescent, a member whose fence is out for app a has no new probe in review for a.
Quint can express it with value: 2 apps, 2 stores, 3 actions; the counterexample is 4 steps. The code fix is
small (fold a `blocked/opted_out` row into the ledger as `opted_out` with source `cloud_fence`, or mark the member
paused), but it needs a founder decision: AGENTS.md says only STOP and leave in the member's words change consent.

## I-2. Cloud-side per-phone state is outside every identity saga (new_machine, P1)

**Where.** packages/core/src/svc/contract.ts:20-26, :180 (the whole wire contract: turn, turn-receipt, deliver,
set-state, signals, updates, relay, relay-photo resolve; no erase, ban, move or new-owner message);
packages/network/service/service.ts:2251-2276 (an accepted turn reply must carry `historyRecorded:true` unless the
turn is account-free, so Cloud keeps the Network's replies in Eliza's history); cloud-channel.ts:52-55 (deliver
receipts carry `history`); packages/platform/src/pg-store.ts:354-396 (`deleteAll`, which scrubs only
`platform.inbound` and local rows); accounts.ts:199-214 (`clearHold new_owner`); api.ts:595-626 (number change).

**Machine.** Eliza Cloud holds, per phone: (a) the consent fence, (b) the Eliza conversation history with every
Network reply, proactive text and relayed text that it delivered with `history:true`, (c) the user's Eliza memory.
States per phone on the Cloud side: `none`, `history`, `history+fence_out`. Backend identity events (delete
everything, leave app, ban, `new_owner`, number move) change the backend side only. No contract message carries
them to Cloud.

**Rules.** PRD 28.3 privacy and the runbook-platform "Delete everything" row ("every membership, the phone,
grants, own blocks, sessions"); AGENTS.md relay section ("each side learns only the first name and what the other
person chose to share": relayed texts stay in the recipient's and the sender's Eliza history after the sender
deletes everything); runbook-platform "new_owner ... starts the number clean" (the new holder's Eliza history
still holds the old owner's Network texts if Cloud keys history by phone).

**Trigger.** Member A is matched to B on slop; B sends a relayed text; Cloud delivers it to A with
`history:true`. B texts "delete everything" path (or staff run it after an e-mail to help@ntwrk.party, SD-255): the
backend scrubs B. Cloud still holds B's relayed words in A's Eliza history and B's own Network conversation in B's
history. On the recycled path, staff choose `new_owner` for A's old number; the new holder's first open turn runs
with A's prior Network history in Eliza's context (if Cloud keys by phone).

**Proposal.** New module `cloud_mirror` (or an extension of `identity_sagas` with an abstract Cloud store per
phone): actions `deliverWithHistory`, `deleteAll`, `ban`, `newOwner`, `movePhone`; invariant
`eraseReachesCloud` in `knownOpen` until the contract has an erase message. Quint can express it with value
(small state, clear counterexamples); the fix is an upstream contract change first (AGENTS.md "A wire change lands
upstream first"), so it is a founder and upstream decision. The model would also be the place to state which
Cloud store is the truth for history after a number move.

## I-3. The one-time Eliza notice row survives a new owner and delete everything (suspected_defect, P2)

**Where.** packages/network/service/service.ts:1337-1359 (`elizaNotice`: `insert ... on conflict (phone_hash) do
nothing`, keyed by `noticeHash(e164)`, accounts.ts:143-144); packages/platform/src/pg-store.ts:388-395 (the
`new_owner` branch deletes `suppression` and `age_floor` for the hash, not `platform.eliza_notices`);
pg-store.ts:354-387 (`deleteAll` does not delete it either); pg-store.ts:446-447 (only `movePhone` moves it).
The same is true of the 30-day STOP-hint bucket `stop_hint:<app>:<phoneKey>` in `platform.rate_limits`
(service.ts:1322), which `deleteAll(..., newOwner=true)` keeps.

**Trigger.** Old owner A texts the eliza.app line once (not a member): the notice goes out and the row is written.
A's number is idle for 12 months; the carrier gives it to C. C texts; the number goes on hold; staff decide
`new_owner` (accounts.ts:199-214). C texts again: not a member of any app, so `elizaNotice` runs; the insert
conflicts on A's row; C never gets the notice that says Eliza is now The Network's agent and how to opt out
(AGENTS.md "eliza.app users and deliver path": the first message after the takeover gets the notice). If A had
sent STOP and got the STOP hint, C's own later STOP-then-text inside 30 days also gets no hint.

**Models.** join_age.qnt:54-55 has `noticeRow` as one boolean with no number-owner dimension; identity_sagas has no
notice row. The hand-off (identity_sagas `newOwner` then join_age `noticeStep`) is in no model.

**Proposal.** Extend `join_age` with an `ownerChange` action that keeps or clears `noticeRow` as the code does, and
an invariant `noticePerHolder` (each holder of a number who is not a member gets the notice once). It fails on
today's code in 3 steps. Fix: delete the notice row (and the phone's rate buckets) in the `new_owner` branch.
Whether delete everything should also delete it (it is a keyed hash and a time, like the suppression hash) is a
founder call; today no document lists it among the rows that delete everything keeps.

## I-4. An agent "safety_concern" signal has no path into the safety machines (model_gap, P1)

**Where.** packages/network/service/service.ts:2197-2206 (`/internal/signals`: a `safety_concern` or `opt_out`
signal becomes a `proposed` facet `signal:<kind>` on the speaker's member, plus a log line);
service.ts:2526-2541 (staff `GET /signals` and `POST /signals`: `confirmed` or `rejected` only, "it changes no
consent"); packages/observatory/src/server.ts:453-813 (the console has no route for agent signals: staff must call
the service API directly). contract.ts:390 (`kind: "opt_out" | "travel" | "safety_concern"`).

**Models.** turn_consent.qnt:693-703 has `proposeSignal` and the staff decision, and `decided` is terminal.
safety_trust has reports, cases, pair relations and holds, but no input from an agent signal. No model has a
liveness or SLA for a proposed signal.

**Journey.** After a date, the member tells Eliza in an open turn "he scared me, I don't want to see him again".
Eliza's LLM records `safety_concern`. Staff confirm it. Nothing else happens: no safety report, no case, no pair
block or `avoid` edge, no hold on the subject (the signal does not even name the subject; `pending-safety-who`
M-128 exists for the text report path only). The pair stays matchable (matching_engine pair cooldown is the only
brake), and `opt_out` signals confirmed by staff leave the member opted in.

**Rules.** AGENTS.md keeps "every existing safety guard (... blocks ...)"; PRD 40.5 safety reports; the code
comment at service.ts:2203 "they wait for a person" implies that a person then acts, but there is no action.

**Proposal.** Extend `safety_trust` with `signalIntake` (signal to a report in `pending_who`, then to a case) and
a `knownOpen` invariant `confirmedConcernActs`: a confirmed safety concern that names a counterpart leads to a
report or a pair block. Add a liveness witness in `turn_consent` that a proposed signal reaches a decision (the
synthesis section 6.2 lists this liveness, but the model has only the safety half). Founder decision needed for
what "confirmed" must do.

## I-5. Review SLA alert dedupe is an in-memory machine with no model (new_machine, P2)

**Where.** packages/network/service/service.ts:321 (`slaAlerted = new Set<string>()`), :538-542 (`afterTick`),
:2817-2828 (`slaAlerts`). Relay held items join the same set with no expiry (:540).

**Machine.** Per (network, item): `waiting_under_sla` -> `alerted` (key added, one `[alert]` log line) ->
`left_queue` (key deleted on the next tick). The set lives in one process: a restart or a rollout overlap
(M-146) moves every waiting item back to `waiting_under_sla`, so it alerts again; a second replica that wins the
tick lock alerts again. The alert is a log line; the dispatcher (M-150) sees it only through the host's log
alerts (docs/deploy.md), not through `platform.ops_alerts`.

**Models.** runtime_ops.qnt models the bias alert lifecycle and the dispatcher, not this set (grep "sla" finds only
the bias "late" state). opportunity.qnt:58, :612 models the SLA expiry itself.

**Proposal.** Extend `runtime_ops` (alert-dispatcher part) with the set and a `restart` action; invariant
`slaAlertOncePerItemPerProcess` and a witness that a restart re-alerts. Value is low to medium: it shows the
duplicate and the missing alert for relay held items that never expire; the fix (store `alerted_at` on the item)
is small.

## I-6. START writes consent and the fence echo before the membership resumes (model_gap, P2; from formal-main drift)

**Where.** packages/network/service/service.ts:1249-1257: `recordConsent(opted_in)`, then `turn.consent = opted_in`,
then `people.updateMembership(person, app, ["paused"], {state: "active"})`, then `endPause`.

**Gap.** turn_consent applies START as one step. In code a throw after the ledger write and before
`updateMembership` fails the turn (no echo goes out, since the handled response is not returned), and the gateway
retries; on the retry `optedIn` is true and the membership resumes. So the window heals only if the gateway
retries the same message. If the retry budget ends (section 8 question: how many retries follow `turn_busy`), the
ledger says opted in and the membership stays paused: the member gets no matches and no one tells them.
Proposal: split the START step in turn_consent into `startLedger` and `startMembership` with a crash point, and a
liveness or quiescence invariant `startResumesMembership`. This is the open drift item on formal-main; I
checked the code order here.

## I-7. Number change exists only outside Cloud auth (model_gap, P2; cross-ref SD-489)

**Where.** packages/platform/src/api.ts:595 and :614 (`if (cloud) return 409 cloud_auth_required` on both
`/api/me/phone/start` and `/api/me/phone/confirm`); api.ts:152-154 (`productionCloud`). No text, MCP or staff path
calls `startNumberChange` (accounts.ts:229, :251).

**Gap.** identity_sagas models `movePhone` as reachable in every mode. In production (Cloud auth) the only way a
person "changes number" is to text from the new number: a new person with no age floor, no blocks and no bans of
the old number (bans are by phone, founder 2026-10-09 item 3). SD-489 records the missing caller; the extra fact
here is that the API itself refuses in Cloud mode, so a site page would not fix it. Proposal: add an `authMode`
constant to identity_sagas and guard `startChange` with it, so the `movePhone` witnesses state the mode they need.

## I-8. The SKILL.md agent protocol has no model (new_machine, P2)

**Where.** sites/skills/{slop-date,ntwrk-party,peon-biz,friends-help}/SKILL.md (steps 1-10 of "Join in this
conversation", e.g. slop-date lines 97-148); oauth_mcp.qnt:17 says "Not in this model: ... skill-signup (agent
text)". join_flow.qnt on formal-main models the site's own client (sites/shared/join-core.ts), not this one.

**Machine.** A client protocol run by the person's agent against the same API: `start` -> `app_read` (GET
/api/app, keeps consent text and version) -> `mode_checked` (stop unless `otp`) -> `code_requested` (one OTP start)
-> `verified` (one verify, private cookie jar) -> `me_read` -> `joined` (one POST /api/join, never over an existing
membership) -> `readback` (GET /api/me + /api/me/export, compare fields). Resume: a stored jar, GET /api/me first;
401 sends it back to `code_requested` only with the person's approval.

**Rules (from the file).** Join at most once; never join when a membership exists; consent text and version from
the same /api/app read; no code is resent automatically; stop when mode is not `otp`; a timeout after a write is
"ambiguous: check existing state before attempting it again".

**Why model it.** It is the main signup path (founder decision 10), and its correctness depends on API answers
that other models own (session rotation in auth_edge, 409 on an existing membership in join_age, 403 `review` on
export for a held number, consent wording check). A Quint client module (`skill_client`) that composes these
answers as oracles can check that no step sequence posts Join twice or posts it with a consent version that the
API has since changed, and it can show the dead end in Cloud mode (step 4 stops; SD-058). Value: medium. The
agent's own behaviour is not code, so the module checks the protocol as written, not an LLM.

## Inputs from the formal-main drift review (not new, listed for the next wave)

- identity_sagas: the reverted patch (scratchpad identity_sagas-drift.patch) moves the leave saga to the
  `onForget` order (forget unit, photos, OAuth listeners; a failed listener stops the leave) and adds
  `forgetPhone` to the under-13 decline. It failed safety on a stopped-leave-plus-ban state; the agent's
  `bannedNotMatchable` exemption was not re-run. This is a model_gap of identity_sagas against the delete and
  leave journeys.
- review_desk: approve has no item version (G6); a stale approve can land after a re-roll (staff review journey).
- oauth_mcp: ban and movePhone revoke grants with no `oauth.audit` row.
- photos_rating: a banned person keeps photos after leave or delete everything (may be a founder decision).
