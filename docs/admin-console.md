# Admin console: MVP requirements and gaps

Status: gap analysis, 2026-10-07. Updated the same day three times: after the review gate, the server auth and the real-mode PII rules were built; after the server gaps in section 6 were closed in `packages/network` and `packages/observatory`; and after the Observatory's real mode started to act through the Network service, verify the Cloudflare Access JWT and show the attention v1.2 send path. Updated 2026-10-08 for the four apps on one backend (ntwrk, slop, peon, friends): the app switcher, roles per app, per-app review reasons and SLAs, and the cross-app person view (section 4.6). Updated again on 2026-10-08 for the audit fixes in the console (docs/audit/2026-10-08-weaknesses.md), the per-app Member 360 panels (3.3.1) and the post-date report queue (3.7.1). Hand-written by a Claude agent from code reading. Each status was checked against the code and, where it says so, against a running server.

Sources: PRD sections 28, 31.5, 32.8, 32.9, 32.14, 32.19, 32.20, 34.6, 35, 36 and 37 ([prd-snapshot.md](prd-snapshot.md)); the 2026-10-07 audit (`docs/research/2026-10-07-audit.md`, in git history at 16cde70); [observatory.md](observatory.md); `packages/observatory` and `packages/network/src/network.ts`.

The admin console is the backend dashboard that the team uses to run the Network. The Observatory (`packages/observatory`) is its first implementation. This document says what the console must do before launch, what exists today, and what is missing.

## 1. Summary

- The Observatory has the graph, the NYC map, member detail, the pipeline, the matching run inspector, metrics, shadow engine runs and a read-only Postgres mode.
- These parts of the launch gates are built:
  1. The review gate. `ConsentNetwork` holds every opportunity in a review queue before any member is contacted. The default mode is `"human"`. An item past its SLA expires unsent. Approve runs the gates again. Reviewers can approve, reject, edit and re-roll, and the time spent is recorded.
  2. Stored Network state. `PgStore` saves the whole Network state and the console rows to Postgres. Every tick, inbound message and staff action runs under one advisory lock and loads the newest state first (`runTick`, `runStored`).
  3. Staff access. Role tokens, Cloudflare Access sign-in (SSO), role checks on the server, a per-member PII reveal with a reason and a 15-minute limit, and an append-only audit log of reveals, staff reads and staff actions.
  4. PII by default. Real mode shows `[member message hidden]` for inbound text. The global reveal works only on a local database.
  5. The member timeline: messages and system events in one list, with the leak-check result per outbound message.
  6. The safety console: cases, watch and hold lists, lift and close actions, and the minor-safety view.
  7. Real-mode actions. With `NETWORK_SERVICE_URL` and `NETWORK_SERVICE_TOKEN`, the Observatory sends review decisions, safety actions and the matching switch to the Network service's staff API ([runbook-real.md](runbook-real.md) 6.5). Its own database login stays read-only. The service's health is in the alerts strip.
  8. Cloudflare Access sign-in verifies the Access JWT (signature, audience, issuer, expiry) before it trusts the email.
  9. Four apps in one console (PRD 40.3): an app switcher (ntwrk, slop, peon, friends, all), roles per app (`role@app`), a world per app in game mode, per-app rows and read logins in real mode, review reasons and SLAs per app, and a cross-app person view for `cross_app_safety` and `admin@*` only, with a typed reason and an audit row first (section 4.6).
- These launch gates are not met:
  1. The service is built, not deployed. It records its own token, not the person, as the reviewer of record. The Observatory's audit row names the person (section 3.2).
  2. A PII reveal needs no fresh sign-in. A session ends when the Access token expires (the Access application's session length), not after a console limit.
  3. Health alerts have no LLM cost line.
  4. Production deployment (read replica, Access policy, real-only server, per-app read logins) is not done.
  5. The rename of buddies to friends (PRD 40.2) is in the console: the switcher, the roles and the per-app views say `friends` (migration 0007 renames the rows, the role and its policies; migration 0010 makes the console views for every row of `platform.apps`).

## 2. Terms

| Term | Meaning |
|---|---|
| MUST | A launch gate. The pilot does not start without it (PRD 28.5). |
| SHOULD | Needed in the first weeks of the pilot. Launch can start without it. |
| LATER | After the pilot, or above 1,000 members. |
| Built | It works in the Observatory today. Actions (review, safety, the matching switch) work in game mode, and in real mode through the Network service's staff API (`NETWORK_SERVICE_URL`). Without the service, real mode is read-only. |
| Partial | Some of it works, or only the data view works in real mode. |
| Missing | No code. |
| Game mode | The Observatory runs the simulated world (synthetic personas, simulated clock). |
| Real mode | The Observatory reads the `network` Postgres schema, read-only. |
| Probe | The consent-first anonymous check ("up for X this week near Y?"). It goes out before a member learns who the other people are. |
| Reveal | (1) In the Network: the step that tells members who the other people are. (2) In the console: showing raw PII to a staff member. This document says "PII reveal" for (2). |

## 3. Modules

### 3.1 Overview

| # | Module | PRD | MVP level | Status |
|---|---|---|---|---|
| 1 | Review queue | 32.8, 33.9, 35.2 | MUST | Partial (built in both modes; real mode decides through the service API, which records its token as the reviewer) |
| 2 | Member 360 | 35.2 | MUST | Partial (no facet history or reliability evidence) |
| 3 | Member perspective timeline | 28.5, 35.2, 35.3 | MUST | Built |
| 4 | Opportunity pipeline | 35.2 | MUST | Built |
| 5 | Matching run inspector | 32.20, 35.2 | MUST | Built |
| 6 | Safety console | 32.14, 36.3, 35.2 | MUST | Partial (actions in both modes; no evidence view) |
| 7 | Requests and demand | 35.2 (intents and demand) | SHOULD | Built (no suggested growth asks) |
| 8 | Growth | 32.15 | SHOULD | Partial (no invite trees) |
| 9 | Metrics and health | 28.2, 35.2, 36.4 | MUST (health, safety counters); SHOULD (scorecard) | Partial (no LLM cost; worthwhile interruption is a proxy) |
| 10 | Configuration | 35.2 | SHOULD | Partial (matching switch in both modes, and its history; other settings read-only) |
| 11 | Audit log | 35.1, 35.2 | MUST | Built |
| 12 | Simulation lab | 34.3, 35.2 | MUST | Built |

Other PRD 35.2 modules: the social graph explorer is built (graph and NYC map). The conversation explorer is partial: text search over the Network's own messages and system events (safety role, audited), with no agent trajectory. Fairness is built inside the run inspector. Events is missing. Data and notebooks is LATER.

### 3.2 Review queue

The founders decided that a person reviews every proactive proposal while the Network has fewer than 1,000 members (PRD 32.8). Member-initiated requests also pass review at launch.

- **MUST**
  - Hold every opportunity in review before the first member contact. The first contact includes the anonymous probe.
  - Show one card per proposal: participants (scrubbed), origin (engine, request, plans, second encounter, newcomer welcome), score components, explanation per participant, the probe text and the reveal text each member will get, alternates, and past interactions between these people.
  - Actions: approve, reject with a reason code (PRD 32.8 list), edit the text, re-roll with a note.
  - Show the SLA countdown. Standard proposals expire after 12 hours, same-day proposals after 1 hour. An expired proposal is never sent late.
  - Re-check eligibility on approve. A member who became a minor, paused, blocked or held since the proposal is not contacted (audit P1-5).
  - Record who decided, when, the reason, and the time spent. Store each decision as a training label.
  - Keep review on for the whole MVP. A member count never turns it off. Above 1,000 members, only a category that held the precision gate for 4 weeks may move to sampled review, and only with founder approval.
- **SHOULD**: keyboard shortcuts; reviewer metrics (throughput, agreement, time per item); double-review sampling (PRD 34.6); swap a participant.
- **LATER**: sampled review per category after the precision gate.
- **Data**: a `review_items` table (proposal, priority, queued at, deadline, assignee, decision, reason, note, edits, time spent); opportunity rows; past edges and interactions for the pair; `network.events` rows with `actor_type = 'reviewer'`.
- **Status: partial.**
  - Built in the Network: every opportunity waits in review (all origins). The default mode is `"human"`; `"auto"` is for the simulator only. The 12-hour and 1-hour SLAs work. `decide()` takes approve, reject, edit and re-roll, and refuses approve for a minor, a member declined at join, a member with an unknown age, and while matching is off. Reason "other" needs a note. Approve runs the gates again; a failure logs `review_invalidated` and contacts nobody. Edits are leak-checked. `secondsSpent` is added up per item ([network.md](network.md) section 2).
  - Built in the store: `PgStore` writes `network.review_items` with `origin`, `seconds_spent`, `edits`, `rerolls` and `invalidated`, and `network.participations` (participants with their status, and alternates). A re-roll or an under-13 decline rewrites the participations on the next save, so real mode shows who is in each item, and a reviewer can open the members of an open item.
  - Built in the Observatory (game mode): the Review tab with Approve, Edit, Re-roll and Reject, the time spent per card, keys `e` and `s` then 1-6, and the server `review` command. The reviewer of record is the signed-in staff id. Refusals return a `code` (for example `edit_leak`, `matching_paused`, `busy_elsewhere`).
  - Built in the judge: the invariant `unreviewed_contact` (no probe or proposal before an approve `review_decision`).
  - Built in the service (`packages/network/service`): `GET /review` and `POST /review/:oppId` with role tokens (`NETWORK_SERVICE_TOKENS`, the same scheme as the Observatory). The reviewer of record is the token's staff id. Each decision writes `network.staff_audit` and the Network's `review_decision` log. The service refuses any review mode but "human" and does not expose the mode.
  - Built in the Observatory's real mode (`src/sources/service.ts`): with `NETWORK_SERVICE_URL` and `NETWORK_SERVICE_TOKEN`, the Review tab sends approve, edit, re-roll and reject to `POST /review/:oppId`, with the seconds spent. The Observatory checks the staff member's role and writes its own audit rows first. A refusal comes back with the Network's code (for example `not_in_review`, `matching_paused`). Then real mode reads the database again. Its own login never writes.
  - Fixed: a review sent while a game-mode step runs waits for the step and acts on the state the step left. Before, it landed in the middle of a Network tick, so the answer did not match what the console showed after the step. An item that expired in the step now says so. The browser sends one decision per item at a time, and a full-state load no longer hides newer deltas (an item could stay "in review" on screen after the server moved it on).
  - The reviewer of record: the Observatory sends the signed-in person in `X-Network-Staff-Id`, and the service records that person when the request carries the console's own token (`NETWORK_SERVICE_CONSOLE_TOKEN`); it ignores the header from any other token. Missing: double-review sampling and a reviewer agreement metric.

### 3.3 Member 360

- **MUST**: profile facets with source, confidence and privacy scope; intents; presence; edges; who invited them; opportunities and outcomes; trust level (ok, watch, hold) and its history; age band and the minor flag; opt-out and STOP state; a list of staff who opened this member.
- **SHOULD**: facet history (what changed and when); reliability evidence by context; connected sources; budget state.
- **LATER**: none.
- **Data**: `members`, `facets`, `intents`, `presence`, `edges`, `participations`, `opportunities`, `events`. Never `channel_identities`.
- **Status: partial.** The member panel shows profile, facets, edges, opportunities, messages and trust. Agent-private facets show as `[private]` unless the truth lens is on (game mode) or are withheld (real mode). Admin and safety see "Staff who opened" (`staffAccess`). Trust changes show in the timeline. It has no facet history and no reliability evidence. Who may open a member: admin and safety, any member; a reviewer, only members in an open review item; an analyst, none.
- Members aged 13-17 may join every app (AGENTS.md decision 1). Each app's views show them with the "Under 18" flag. They are never in a matching view: the server refuses to propose them, the review gate refuses to approve them, and the minor-safety view proves that no open multi-person opportunity names one.

#### 3.3.1 Per-app Member 360 panels

Status: built on 2026-10-08 (`src/appProfile.ts`, `GET /api/member/:id/app`, the "Dating (slop)" and "Hiring (peon)" sections of the member panel). The app packs keep app data in facet tags (`packages/engine/src/packs/slop/profile.ts`, `packs/peon/schema.ts`). The console reads the same tags.

- **slop (dating).**
  - Dating preferences (`romance:*`, `slop:*`, `verify:*`, `safety:*` tags) are hidden by default, in the member detail and in the panel. The panel says how many there are. They show only while a safety or admin reveal for that member is active (`POST /api/reveal`, a typed reason, audited).
  - A score or rating of a person (attractiveness, desirability, any rating) never leaves the server, in any app, with or without a reveal. Scores are agent_private.
  - Photos: never for a member under 18 or with an unknown age. For an adult only (the lowest stated age is 18 or more; there is no ID check, founder decision 9), to admin or safety, with a typed reason of 5 or more characters: `POST /api/member/:id/photos?app=slop {reason}`. The audit row (`read_photos`, with the reason) is written before the read, and refusals are audited too. The photos come from the Network service (3.7.1). Only `https:` links are shown.
- **peon (hiring).** The role a job seat hires for (title, family, seniority, pay range, work mode, market, openings, employer verified) or a candidate's role families and work modes, and the member's introductions (applications) with their state. Proxy tags (`peon:proxy:*`: zip, graduation year, gaps) are never shown.
- Each panel read writes a `read_member_app` audit row.

### 3.4 Member perspective timeline

PRD 28.5 says: "Admin console can show any member's full experience (their messages, what the engine considered for them, and why) within two clicks."

- **MUST**
  - Show every message in and out, in order.
  - Between the messages, show what the system did: proposals considered for this member, why each was gated or dropped, review decisions, probes, reveals, budget and quiet-hours deferrals, trust changes.
  - Show the leak-check result for each outbound message.
  - Hide message bodies that may hold a private disclosure until a PII reveal (audit P1-2).
- **SHOULD**: "replay this week" for real members and simulated personas.
- **LATER**: the agent trajectory for each turn (context, tool calls, model, latency, cost).
- **Data**: `messages`, `events` (keyed by member and time), `matching_runs` (per-member funnel and rejection reasons), review decisions, leak-check results.
- **Status: built, with gaps.** `GET /api/member/:id/timeline` returns messages and system events in time order, in both modes (`src/events.ts`). Events include review decisions, probes, reveals, requests, trust changes and safety actions. Each outbound message shows the leak-check result (passed, or the generic fallback was sent). Sends that wait for the sending window are listed while they wait. Real mode hides inbound bodies until a per-member PII reveal. Every timeline read writes an audit row.
  - The timeline shows the attention v1.2 send path ([network.md](network.md) 3, 4 and 6.4): `send_deferred` (what waited, for the send window or quiet hours, until when), `gate_reason` (an engine proposal the gates stopped, on each named member's timeline), probes with the times they offered and the keys picked (`probe_answer`, `time_answer`), the booked plan with its time and opt-out, `booked_cancelled`, the calendar and weekly check-in offer and opt-ins, `checkin_sent` and `availability_stated`. The opportunity panel adds a Times section and a Booked plan section with each member's opt-out countdown (48 hours or until the meeting). Real mode has the picked keys but not the offered labels, which are only in the message text.

### 3.5 Opportunity pipeline

- **MUST**: board and list by state, source, category; drill into one opportunity with its messages and the run that made it; show the review state as a column.
- **SHOULD**: ageing (time in each state); drop-off funnel (proposed, reviewed, probed, revealed, accepted, scheduled, completed, positive); full event history per opportunity.
- **LATER**: none.
- **Data**: `opportunities`, `participations`, `messages`, `events`.
- **Status: built.** The Pipeline tab has a board with source filters and a review column. Cards show time in state, and open columns show the oldest age (`ageHours`, `stateSince`). The opportunity panel shows messages, the run and the full event history (`OpportunityDetail.events`).

### 3.6 Matching run inspector

- **MUST**: for each run, the funnel after each filter, generator counts, rejection reasons, fairness (Gini, top-10% share, Lorenz curve), the top alternatives and why they lost, timings. Shadow runs on real data (PRD 34.6).
- **SHOULD**: the skeptical-gate reasons from `ConsentNetwork` (why an engine proposal did not start); judge outputs per proposal.
- **LATER**: diff two runs, or two engine versions on one snapshot.
- **Data**: `matching_runs.summary`; the network gate reasons.
- **Status: built.** Run detail, fairness, top alternatives and shadow runs work. Gate reason counts show in game mode, and in real mode when `network.network_state` exists. "Compare two" in the Runs tab diffs two runs (`GET /api/runs/diff`): funnel, fairness, generators, filtered reasons and the top configurations only in A or only in B. Judge outputs per proposal are not shown.

### 3.7 Safety console

- **MUST**
  - A queue of reports and safety flags, urgent first. Urgent reports have a 1-hour target, others 24 hours (PRD 36.3).
  - Members on watch and on hold, with the events that put them there.
  - Actions: confirm or lift a hold, close a case with a decision. Each action writes an event.
  - Evidence: the messages around each flag, kept even after member deletion.
  - Minor-safety view: members aged 13-17, and proof that none is in a multi-person opportunity.
- **SHOULD**: repeat-offender and repeat-target views; block patterns; inviter accountability (who invited held members).
- **LATER**: appeals workflow; relay moderation holds (relay is not built yet).
- **Data**: a safety case store (case, reporter, target, evidence refs, status, decision); trust events from `trust.ts`; `events` rows `member_blocked`, `safety_flag`.
- **Status: built (2026-10-08).** The report queue and hold and ban by phone or person are built in the console (3.7.1). The Network service answers every route in 3.7.1 (`packages/network/service/service.ts`; tested with the console's own `ServiceClient` in `packages/network/test/service-safety.test.ts`). It also has `POST /members/:id/verify` for staff to record the PRD 40.5 checks until a vendor does.
  - Built: the Network keeps safety cases (open, held, lifted, closed) from trust events, with no message text ([network.md](network.md) section 6.2.1). `GET /api/safety` (safety role) returns the cases (urgent first, with a due time and "overdue"), the watch and hold lists, and the minor-safety view (members treated as under 18, members with no valid age listed apart, and proof that none of them is in an open multi-person opportunity). In real mode, "under 18" comes from the Network's own age state (`network.network_state_console` and the `age_unknown`, `age_resolved`, `minor_signal` and `age_conflict` events), not only from the record age. The Safety tab shows them. Lift hold and Close case work in game mode, and in real mode through the service's `POST /safety/lift` and `POST /safety/close`. Each writes `safety_action` and an audit row.
  - Missing: an evidence view of the messages around each flag. Repeat-offender and inviter views.

#### 3.7.1 Post-date reports, hold and ban (the contract with the Network service)

The Safety tab shows "Reports after a date": what a member reported about someone they met (harassment, lying, a no-show, an unsafe date, a scam, a minor), urgent first. Harassment, unsafe, scam and minor reports are urgent (1-hour target); others have 24 hours (PRD 36.3). Each row shows the kind, who reported whom, the date it is about, earlier reports about the same person, and the due time. Safety and admin act with a decision note of 5 or more characters: **Hold** (the person, on every app, until a review), **Ban phone** (this number can never join again), **Ban person** (every phone of the person, on every app; PRD 40.5 "ban by person, not by account") or **Dismiss**. The console writes a "requested" audit row before it sends the action and a "result" row after.

The console calls the Network service's staff API. Every call carries `Authorization: Bearer <NETWORK_SERVICE_TOKEN>`, `X-Network-Staff-Id: <the signed-in person>`, `?app=<app>` and `X-Network-App: <app>` (4.6).

| Call | Body or headers | Answer |
|---|---|---|
| `GET /safety/reports?app=` | | `200 {ok: true, reports: [{id, kind, reporterId, subjectId, opportunityId?, at (ms), status, priorReports?}]}`. `kind` is one of `harassment`, `lying`, `no_show`, `unsafe`, `scam`, `minor`, `other`. `status` is `open`, `held`, `banned` or `dismissed`. Member ids are this app's. Never the reporter's words. |
| `POST /safety/hold?app=` | `{memberId, note, reportId?}` | `200 {ok: true}`, or `409 {reason}`. Staff with `safety` on this app only hold on this app; `safety@*` (or `admin@*`) holds the person on every app. The audit row says `scope: this_app` or `every_app`, never how many apps the person uses. |
| `POST /safety/ban?app=` | `{memberId, by: "phone" or "person", note, reportId?}` | `200 {ok: true}`, or `409 {reason}` (for example `already_banned`, or `needs_safety_everywhere`: a ban stops the number on every app, so it needs `safety@*` or `admin@*`) |
| `POST /safety/dismiss?app=` | `{reportId, note}` | `200 {ok: true}`, or `409 {reason}` (`unknown_report`) |
| `POST /safety/clear-minor?app=` | `{memberId, note}` | `200 {ok: true, apps: [{app, result}]}`, or `409 {reason, apps}` (`no_signal`, `age_unknown`, `record_minor`, `stated_minor`). For each app of the person, the Network runs `clearMinorSignal` and dismisses that member's open `minor` reports. `safety@*` (or `admin@*`) clears every app; `safety` on one app clears that app only. Audited (`safety: clear_minor`, `scope: this_app` or `every_app`). |
| `GET /members/<id>/photos?app=slop` | `X-Network-Reason: <the typed reason>` | `200 {ok: true, photos: [{id, url (https), expiresAt?}]}`. The service checks the role and the age again (`403 {reason: "adults_only"}`) and writes its own audit row. |

**Clearing a wrong minor signal.** A member report ("he's only 15") or a misread message can mark an adult as a minor on one app. First correct the person's age record (the lowest age must be 18 or more), then open the `minor` report in the Safety tab and press **Clear minor signal (every app)** with a note that says why the record says adult. This is one action for every app; before, staff cleared each app by hand. The Network refuses it while the member's record age or any age the member stated is under 18. In game mode it clears the simulated world's one network.

A 404 without a `reason` means that the service has no such route yet: the console says so (`service_missing`). Without the service (game mode, or real mode without `NETWORK_SERVICE_URL`), the queue is built from the Network's safety cases (a `report_received` event between two members who had a date), and hold and ban are refused (`service_only`).

#### 3.7.2 Held texts: leak review and held relay

The Safety tab starts with "Held texts", per app, in two queues: **Leak review** (texts the send-time leak guard parked, `parked_leak_review`) and **Held relay** (relay items held for a check). Safety and admin only. Each row shows the kind, the member (or the masked number), the reasons and the time. The text is shown so staff can judge it, except when the item is about a member under 18 or with an unknown age (the service's `minor: true`, or the console's own member state): then the text is hidden and only **Reject** is possible. No score or rating ever reaches the page: the console passes only the fields listed here. **Release** (every other send check runs again) and **Reject** need a reason of 5 or more characters. Each read writes `read_held_texts`, and each decision writes a "requested" and a "result" row (`held_release` or `held_reject`).

| Call | Body | Answer |
|---|---|---|
| `GET /queue/leak-review?app=` | | `200 {ok, items: [{id, kind, to (masked), text, reasons, createdAt, memberId?, minor?}]}` |
| `POST /queue/leak-review/<id>?app=` | `{decision: "release" or "drop", reason}` | `200 {ok: true}` or `409 {reason}` (`not_parked`) |
| `GET /staff/relay/held?app=` | | `200 {ok, items: [{itemId, app, kind, from, to, reasons, createdAt, text?}]}` (`from` and `to` are member ids; the console reads `itemId` as the row id and `from` as the member) |
| `POST /staff/relay/<id>/release?app=` and `.../reject` | `{reason, note}` (the service reads `note`; the console sends the reason as both) | `200 {ok: true, delivered?}` or `409 {reason}` |

**Status (2026-10-09, adversarial review):** the console side is built (`/api/held`, `web/admin.tsx` HeldTexts; `packages/observatory/test/held.test.ts`). **Held relay** works against the service's `GET /staff/relay/held` and `POST /staff/relay/<id>/release|reject` (packages/network/service/service.ts). Before the review fix the console read only `id`, so the service's rows (`itemId`) were all dropped and the queue looked empty; and it sent the reason only as `reason`, so the service's audit row had none. **Leak review** still shows "Not available": the service has no `/queue/leak-review` route yet (parked rows stay `parked_leak_review` in `platform.outbound`; written up for the service owner). Game mode has no held texts.

How to test locally: run `bun run observatory:db`, then the console in real mode with a service (`NETWORK_DATABASE_URL=postgres://$USER@localhost:54339/network NETWORK_SERVICE_URL=http://127.0.0.1:4848 NETWORK_SERVICE_TOKEN=<an admin token of the service> PLATFORM_ENV=dev bun run observatory --mode real`). Open the printed URL, pick slop, open Safety. Both queues say "Not available" until the service has the routes. To see rows without the service routes, point `NETWORK_SERVICE_URL` at a local fake that answers the calls above (as `held.test.ts` does). In a minor report, **Clear minor signal (every app)** needs a note and then dismisses the report.

### 3.8 Requests and demand

- **SHOULD**: open member requests by category and age; outcome (probing, fulfilled, still looking, none); retries; why unfulfilled (density gap, requester busy, trust); supply and demand per category; suggested growth asks.
- **MUST** part: each member request is in the review queue before any probe goes out (founder decision).
- **Data**: `network.requests` (member, kind, category, want id, outcome, tries, opportunity, opened, fulfilled). It never holds the member's words.
- **Status: built.** The Requests tab lists requests in both modes: opened, member, the labelled want, category, outcome, tries, and age or hours to fulfil, with a link to the opportunity. A line shows open and fulfilled per category. Every member request waits in review before any probe. Suggested growth asks are not built.

### 3.9 Growth

- **SHOULD**: invites sent and accepted per member; invite trees; invitee activation compared with seed members (PRD 28.2: at least 30% invite someone); growth asks sent; inviters who lost invites after an invitee went on hold.
- **Data**: `members.invited_by`, `edges` of type `invited_by` and `vouched_for`, growth-ask events.
- **Status: partial.** The Metrics tab has a Growth section in both modes: invites sent, invitees joined, growth asks, the share of members who invited someone, and the activation of seed members compared with invitees. The graph shows `invited_by` edges. No invite trees and no list of inviters who lost invites. On a database seeded from the dataset only, almost every member has `invited_by`, so almost everyone counts as an invitee.

### 3.10 Metrics and health

- **MUST**
  - Health: review queue depth and SLA misses; job backlog; send failures; matcher heartbeat; invariant violations.
  - Safety counters that must stay 0: canary leaks, minor contacts, invariant violations.
  - Daily LLM spend against the cost alert (PRD 36.4).
- **SHOULD**: the PRD 28.2 scorecard: worthwhile-interruption rate, opt-in rate, completion rate, time to first outcome, second interactions, invite rate, reviewer minutes per sent proposal, mute and complaint rate.
- **LATER**: segment by cohort, generator, exploration.
- **Data**: `events`, `messages`, `opportunities`, `feedback`, job table, LLM usage records.
- **Status: partial.**
  - Built: health alerts (`stats.alerts`, worst first) on the Overview: review SLA misses, items near or past the SLA, queue depth, deferred backlog, send refusals by reason, leak-guard blocks, matching off or no matcher heartbeat, and judge violations (invariants, canary leaks, minor contacts). Each alert links to its tab.
  - Built: in real mode with the Network service, its `/health`: unreachable (bad), the last tick late (warn after 5 minutes, bad after 15), messages refused or held by the channel, messages waiting to be delivered, and one line when all is well (last tick, channel, lock holder).
  - Built: real-mode minor contacts count messages about an opportunity while the recipient or anyone in it was treated as under 18, by the record age or by the Network's age state at that moment (before: the recipient's record age only).
  - Built: the PRD 28.2 scorecard (`stats.scorecard`) in the Metrics tab, with the value, target, met or not, and the sample size.
  - Built (2026-10-09): shadow precision in the scorecard (`shadow_precision`, PRD 32.8 and 34.6): engine proposals, shadow runs included, that a person approved without an edit, over those a person approved or rejected (the simulated reviewer and expired items left out); target 80%. The backend's ops metrics carry the same number over 7 days (`precision7d`) and alert `precision:<network>` under 80% once there are 20 person decisions (deploy/backend/ops.ts; runbook-real.md 8.4).
  - Missing: daily LLM spend (there are no usage records). The worthwhile-interruption line is a proxy (a proactive message answered within 72 hours with no STOP); the "Was that worth a text?" question is not built.

### 3.11 Configuration

- **SHOULD**: engine thresholds and weights, budgets, quiet-hours defaults, category settings, sampled review per category (founder approval, after the precision gate), feature flags (proactive matching on or off for NYC). Every change has who, when, old value, new value.
- **MUST** part: one switch, "proactive matching on in NYC", that only an admin can change, logged.
- **Data**: a config table with versions; `events` rows with `actor_type = 'admin'`.
- **Status: partial.** The admin-only `matching` command turns proactive matching on or off in game mode ([network.md](network.md) section 2.4). The Config tab (analyst and admin) shows the matching switch, the review mode, the Network options and the outreach numbers, and a versioned history of the matching switch and review-mode changes (who, when, from, to). Only the matching switch can change: in game mode directly, in real mode through the service's `POST /matching`. Other settings come from code and command-line flags. Real mode builds the history from events. `setReviewMode(mode, actor)` logs the actor (`review_mode { mode, actor }`), and the game-mode command passes the staff id.

### 3.12 Audit log

- **MUST**: every staff action (review decision, safety action, config change), every PII reveal, and every staff read of a member's 360 or timeline. Append-only. Readable by admin only.
- **Data**: `network.staff_audit`, an append-only table (triggers refuse update, delete and truncate), written through its own login (`network_observatory_audit`). Local default: a JSONL file under `runs/audit`.
- **Status: built.** The server writes an audit row before it returns data or acts: member, timeline and opportunity reads, audit-log reads, PII reveals, searches, lab runs, mode switches, safety actions and every command except the clock controls (play, pause, speed, step, refresh). The truth lens is audited. If that row cannot be written, the request is refused (503) and nothing runs. Two kinds of row are best effort: the "result" row after an action (the action already ran, and its "requested" row is written), and the row for a refused (forbidden) command (nothing ran). A failed best-effort row is logged on the server console. Tokens are never written. A search row keeps only the length of the query (`qLength`), never its text: staff search for names, phones and phrases, and the audit table cannot be changed. The detail panels reload a member as it changes, so repeated reads of one member by one staff member within 60 seconds keep only the first row (`read_member` and `read_timeline` each; a PII reveal starts a new one). `GET /api/audit` and the audit log in the Config tab are admin only. The "own actions" view for the safety role is not built.

### 3.13 Simulation lab

- **MUST**: run the same console on a simulated world, with a clear banner; pick seed, size, days, engine; run scenarios; show canary leaks, minor contacts and invariant violations; open any persona in the perspective timeline. Simulated reviewers ("auto" review mode) are allowed only here.
- **SHOULD**: start long runs in the background and watch progress; compare two runs side by side; show judge results.
- **LATER**: 2,000-persona load runs from the console.
- **Data**: the simulator (`packages/sim`), run logs (`packages/core/src/runlog.ts`), `report.ts` output.
- **Status: built.** Game mode does the MUST list: seeds, sizes, engine choice, scenario levels, the truth lens (safety or admin, per staff member, audited: section 4.1), take over a persona, scoring against the oracle, and the judge counts in the Safety tab. The Lab tab (analyst) starts background runs of the experiment arms (`push_baseline`, `push_v2`, `consent`; 1-5 seeds; 1-60 days), at most 2 child processes of `packages/network/harness/experiment.ts` at a time. It shows everyone-yes, accept, meetings, judge invariants, canary leaks and minor contacts per arm and seed. Results are saved under `runs/lab`. The Runs tab compares two runs. 2,000-persona runs are LATER.

## 4. Roles and access

### 4.1 Roles

| Module | Admin | Reviewer | Safety | Analyst | Engineer |
|---|---|---|---|---|---|
| Review queue | Act | Act | View | View (aggregates) | View |
| Member 360 and timeline | View | Members in their open review items only | View | No | Simulated worlds only, or with a logged ticket |
| Pipeline, run inspector | View | View | View | View | View |
| Safety console | Act | No | Act | Aggregates | No |
| Requests, growth, metrics | View | No | View | View | View |
| Configuration | Act | No | No | View | Propose (admin approves) |
| Audit log | View | No | Own actions | No | No |
| Simulation lab: game controls (play, step, propose, take over, peek) | Act | Act (training) | Act | No | Act |
| Simulation lab: truth lens (hidden persona truth, private disclosures) | Yes, logged | Never | Yes, logged | Never | Never |
| Simulation lab: lab runs (background experiment arms) | Act | No | No | Act | Act |
| PII reveal | Yes, logged | Never | Yes, logged | Never | Never |

A person can hold more than one role. Each action checks the role on the server, not only in the browser.

What the server enforces today (`packages/observatory/src/server.ts`, `src/staff.ts`). Every check is for the request's app (`?app=`): a role holds for one app (`reviewer@slop`) or for every app (`reviewer@*`). Admin for an app passes every check for that app. The Engineer role is built for simulated worlds only (game controls and the lab); in real mode it has no access. `cross_app_safety` has no app view, only the cross-app person view (4.6).

| Route or command | Roles |
|---|---|
| `GET /api/state`, `/api/me`, `/api/opportunity/:id`, `/api/runs/diff`, the WebSocket | Any staff member, shaped per role (`src/shape.ts`). An analyst gets no name, age, minor flag, trust level or occupation, no opportunity texts, no messages, and feed lines without names. The oracle's verdict on an opportunity is stripped until it is resolved, unless the caller's truth lens is on. Hidden truth is only in `/api/state` and member detail for the staff member whose truth lens is on. In `/api/opportunity/:id`, what a member wrote is shown only to staff who may open that member (the Member 360 rule); others see `[member message hidden]` and its length. |
| `GET /api/member/:id` and `/timeline` | Safety (any member); reviewer (members in an open review item only). Analyst: 403. |
| `POST` and `DELETE /api/reveal`, `/api/safety` (lift, close, hold, ban, dismiss), `/api/search`, `POST /api/member/:id/photos` | Safety |
| `GET /api/member/:id/app` | As `GET /api/member/:id` |
| `/api/config`, `/api/lab` | Analyst |
| `/api/audit`, `POST /api/mode` | Admin |
| Commands `review` | Reviewer |
| Commands `play`, `pause`, `speed`, `step`, `propose`, `takeover`, `reply`, `say`, `god`, `peek`, `check_scenario` (the simulation lab) | Reviewer or safety |
| Command `lens` (the truth lens, per staff member, audited) | Safety |
| Commands `review_mode`, `matching`, `reset` | Admin |
| Commands `refresh`; `shadow_run` | Reviewer, safety or analyst; analyst |

Differences from the table above: `/api/state` sends request and growth totals to every role, and the Safety tab shows aggregate safety counts to every role.

### 4.2 Authentication

- Staff sign in with single sign-on (one company login) and a second factor. There are no shared accounts.
- The API and the WebSocket reject any request without a staff identity (401). A known identity without the role gets 403 with `code: "forbidden"`.
- **Built:** role tokens (`OBSERVATORY_TOKENS="admin:<t>,reviewer:<t>,safety:<t>,analyst:<t>"`, or per app: `reviewer@slop:<t>` or `<t>:reviewer@slop`; a role with no app is `@*`). `OBSERVATORY_TOKEN` still works and is an admin token. Without either, and without SSO, the server makes a random admin token at startup and prints the page URL with the token in the `#fragment` (a browser never sends it to a server or in a Referer). A token goes only in `Authorization: Bearer`; `?token=` is refused. A token shorter than 32 characters stops the server. With SSO on, tokens are refused: each person signs in as themselves.
- **Built:** the WebSocket. A browser cannot send a header on a WebSocket, so the page asks `POST /api/ws-ticket` for a one-use ticket (30 seconds) and opens `/ws?app=<app>&ticket=<ticket>`. Each socket keeps who opened it. Deltas are shaped for that person's roles. The server checks every socket again every 15 seconds and after a mode switch: it closes the socket with 4401 when the Access token expired, and with 4403 when the person has no role for the app any more (a role taken out of `platform.staff_roles`, or an engineer after a switch to real mode).
- **Built:** a change sent from a page that shows the other mode (header `X-Observatory-Mode`) is refused with 409 `mode_changed`.
- **Built:** every API answer has security headers (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, a `default-src 'none'; frame-ancestors 'none'` policy). The page sets its own policy in `index.html`: scripts from the console only, no inline script, no Referer. In development mode Bun's hot-reload helper is an inline script, which this policy blocks; the page still works. Map tooltips are built as text nodes (`web/safe.ts`), never as HTML.
- **Built:** Cloudflare Access sign-in. With `OBSERVATORY_TRUST_CF_ACCESS=1`, the server verifies `Cf-Access-Jwt-Assertion` first: RS256 with a key from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` (cached for an hour, fetched again for an unknown key id), audience `OBSERVATORY_CF_ACCESS_AUD`, issuer, `exp`, `nbf` and `iat` (60 seconds of clock skew). Then it takes the email from the token and the roles from `OBSERVATORY_ROLES="email:role,..."`. A token without an email (an Access service token) is refused. An email header that differs from the token is refused. Without `OBSERVATORY_CF_ACCESS_TEAM` and `OBSERVATORY_CF_ACCESS_AUD` the server refuses to start.
- **Missing:** a fresh sign-in for a PII reveal. A session lasts as long as the Access token (set the Access application's session length to 12 hours or less).
- The server checks `Host` and `Origin`. This blocks DNS rebinding (a trick that lets a web page reach a local server) and cross-site WebSocket use. This is built.
- Local development binds to `127.0.0.1` only. A static token is acceptable there. This is built.
- Sessions expire after 12 hours. A PII reveal needs a fresh sign-in if the session is older than 1 hour. (Requirement. Not built: see the Missing line above.)

### 4.3 PII scrubbed by default

- Names show as "First L." Phones and emails in free text are masked. Agent-private and sensitive facets show as "[private · agent only]". This exists in `scrub.ts`.
- Real mode shows inbound message bodies as `[member message hidden]` (only their length) unless `OBSERVATORY_REVEAL_PII=1`. Regex masking does not catch a private disclosure, so the text stays in the database. This is built.
- The console never reads `channel_identities`. The read-only role has `select` revoked on that table.

### 4.4 Logged PII reveal

- A reveal is per member and per field group (names, message text, private facets). It is never global.
- The staff member types a reason. The reveal lasts 15 minutes.
- The server writes an audit row before it returns the data: who, which member, which fields, the reason, the time.
- `OBSERVATORY_REVEAL_PII=1` stays for local databases and simulated worlds only. The server refuses it when the database is not local.
- **Status: built, per member.** `POST /api/reveal {memberId, reason, minutes}` (safety role; a reason of 5 or more characters; 1-15 minutes) writes the audit row first. A reveal for a member that does not exist is refused (404) and audited too. The reveal covers that member's detail, timeline and app panel for that staff member, in the mode it was made in. `DELETE /api/reveal?memberId=` ends it early (audited). It is not split by field group. Reveals live in server memory, so a restart ends them. The global `OBSERVATORY_REVEAL_PII=1` is refused for a database that is not local or not marked `environment = dev` in `platform.settings`, and the banner says so.

### 4.5 Audit of staff reads

- Every open of a member 360, a timeline or an opportunity with messages writes a read row: who, what, when.
- Member 360 shows "staff who opened this member" to admin and safety roles.
- Admins review the reveal log weekly.
- **Status: built.** The audit sink is `network.staff_audit` (with `OBSERVATORY_AUDIT_DATABASE_URL`) or a JSONL file. The weekly review is a process, not code.

### 4.6 Four apps (platform plan section 5)

Status: built in the Observatory, 2026-10-08. The service takes the reviewer of record from the console (`NETWORK_SERVICE_CONSOLE_TOKEN`).

- **App switcher.** The top bar shows ntwrk, slop, peon, friends and "all". The app is in the URL hash (`#a=slop&m=<member>`). The banner names the app and the environment, for example "SLOP · LOCAL DB · read-only". "all" shows one line per app: members, review backlog, SLA misses, send failures and the matching state.
- **Every route takes the app.** The browser sends `?app=` on every `/api` request and on `/ws`. No `app` means ntwrk. An unknown app gets 400.
- **Roles per app.** `OBSERVATORY_ROLES="email:role@app"` or `email:role@*`. The old `email:role` means `role@*`. `OBSERVATORY_TOKENS` takes `role@app:token` or `token:role@app`. In real mode with SSO, the server also reads `platform.staff_roles` every minute. Every route checks the role for the request's app. Admin for an app passes every check for that app. Switching the mode needs `admin@*`.
- **New roles.** `engineer`: game controls and the lab in simulated worlds; nothing in real mode. `cross_app_safety`: the cross-app person view only, and only as `cross_app_safety@*`.
- **Real mode per app.** With `OBSERVATORY_DATABASE_URL_<APP>` (a login in `network_observatory_<app>`), row-level security keeps the connection to the app. Without it, the shared login reads with an `app_id` filter on every query. Migration 0005 adds one console view of the Network state per app (`network.network_state_console_<app>`) and `staff_audit.app_id`. Migration 0010 closes `network.network_state_console` (the view of every app) to every console role: the shared `network_observatory` login reads ntwrk's view only. An app's role reads person-to-person blocks only through `platform.person_blocks_<app>` (blocks between two members of that app); the console's shadow run under that login reads that view. The cross-app role reads trust levels and cases through `network.network_state_console_cross_app`, and only the columns of members, messages and participations that its counts need (never a name, a bio, an age or a message text). At start the console checks its login: read-only, a member of the app's role for an app login, and not a superuser or a role that bypasses row-level security for a database that is not local. Otherwise it refuses to read. Each app's state merges every city of the app (`ntwrk:nyc` and `ntwrk:sf`).
- **Review reasons and SLA per app.** slop adds `preference_mismatch` and `safety_concern`; peon adds `not_qualified` and `role_closed`; ntwrk and friends keep the PRD 32.8 list. An app code goes to the Network as its PRD code, with `[code]` at the start of the note. SLA: slop 6 h, peon 24 h, others 12 h (`OBSERVATORY_REVIEW_SLA_HOURS`). An item past the app's SLA is a health alert.
- **Game mode per app.** Each app has its own world. Personas under the app's join age never join it (13 on every app since migration 0007; members aged 13-17 show with the minor flag and are never matched). slop and peon run with matching off ("matching off until pack"); joins, onboarding and safety still run. The matching switch cannot turn it on. Lab runs for slop and peon use `--max-new 0`.
- **Cross-app person view.** `GET /api/person/lookup?app=&member=`, `GET /api/person/:id`, `POST /api/person/:id/open {app, reason}`. Only `cross_app_safety@*` and `admin@*`. It shows memberships, per-app states, holds (a hold on any app holds the person everywhere) and person blocks. No phone and no name. A slop (dating) membership is never in the summary (PRD 40.3): a hold there shows as "account restricted" on an app not named, and a block made there shows without its app. Every summary has the same closed slop row (`privateApps`), so the summary does not tell whether the person uses slop. Only a typed reason opens that panel (audited); its answer (a panel, or "no membership") is the first place the membership shows. Each app panel is closed. Opening one needs a reason of 5 or more characters, and the audit row (with the app) is written before anything is read. It needs real mode and the platform schema (`OBSERVATORY_PLATFORM_DATABASE_URL`, a login in `network_observatory_cross_app`).
- **Names and ages.** The console takes the app list, names, join ages and the matching lock from `packages/platform/src/apps.ts` (and `PACK_READY` in `src/apps.ts`). `APP_ORDER` in `web/store.ts` is only the switcher order before `/api/me` answers.
- **Checked on 2026-10-08** (game mode, `OBSERVATORY_TOKENS="admin@*:<t>,reviewer@slop:<t>,engineer@*:<t>"`): `/api/me?app=slop` for the slop reviewer listed `apps: ["slop"]` and slop's reasons and 6-hour SLA; `/api/state?app=ntwrk` with that token gave 403 `no role for ntwrk`; `?app=foo` gave 400 `unknown_app`; `/api/apps/health` as admin listed the four apps; `{"type":"matching","on":true}` on slop gave 409 `matching_locked`; a 1-day lab run for slop as engineer finished with 0 judge invariants, canary leaks and minor contacts; `/api/person/lookup` in game mode gave 409 `real_only`. In real mode on a migrated scratch database, `/api/state?app=slop` showed `"app":"slop"` and "LOCAL DATABASE · read-only · PII scrubbed".
- **Not built:** a "hold from another app" marker in each app's own views; the `cross_app_leak` count in the lab; LLM spend and line-safety webhooks in health; a view for fraud review items (they show as kind `fraud`, [network.md](network.md) 2.5).
- **Reviewer of record (header contract).** On every staff action the console sends:
  - `Authorization: Bearer <the console's service token>`;
  - `X-Network-Staff-Id: <the signed-in staff id>` (an SSO email, or `token:<role>#<hash>`), after the console checked that person's role for the app;
  - `?app=<app>` and `X-Network-App: <app>`.
  The service takes `X-Network-Staff-Id` as the reviewer of record only from a request with the console's own token (`NETWORK_SERVICE_CONSOLE_TOKEN`), and ignores it from any other token (`packages/network/test/service-apps.test.ts`).

## 5. Where it runs and how it reads data

| | Local | Staging | Production |
|---|---|---|---|
| Purpose | Development, simulation, game | Reviewer training, full sim runs, release checks | The live Network |
| Data | Game mode, or local Postgres on port 54339 seeded from a sim run | Staging Postgres seeded from synthetic data and sim runs; test phone numbers | Read replica of the production `network` schema |
| Database login | Local user | Read-only role `network_observatory_<app>` per app (`OBSERVATORY_DATABASE_URL_<APP>`); `network_observatory_cross_app` for the person view | The same per-app read roles on the replica. Do not use the shared `network_observatory` login: it can still read the shared state view for every app. |
| Writes | Game mode acts on the simulated world | Review and safety actions through the staging Network API | Review, safety and config actions through the Network admin API only |
| Game controls | On | On | Off: `OBSERVATORY_REAL_ONLY=1`. The server refuses game mode, game commands and the lab. The game code is still in the bundle; it is turned off, not compiled out. |
| Auth | Bind to 127.0.0.1; optional token | SSO and roles | SSO, second factor, roles, IP allow-list or an access proxy |
| Banner | "SIMULATION" or "LOCAL DATABASE" | "STAGING" | "PRODUCTION · read-only · PII scrubbed" |

The start guard (`deployGuard` in `src/server.ts`) fails closed. A console with real data (`OBSERVATORY_REAL_ONLY=1`, or any database URL whose host is not this machine) refuses to start without `PLATFORM_ENV`. Under `staging` and `production` it needs Cloudflare Access. Staff tokens work only with `PLATFORM_ENV=dev` and local databases. A console WebSocket opened with an Access JWT closes with code 4401 when the JWT expires (`packages/observatory/test/staff.test.ts`, OBS-05).

How it reads data:

- Every database session sets `default_transaction_read_only = on` and a 20-second statement timeout. This exists in `sources/real.ts`.
- The console reads from a read replica, never from the primary (PRD 31.4, 35.3). Heavy analytics read the nightly Parquet export.
- The console never writes to the database directly. Review decisions, safety actions and config changes go through the Network admin API. The API checks the role, writes the event, and runs the same policy checks as the Network. This keeps the console database login read-only.
- Shadow engine runs build a snapshot from the replica and run the engine in memory. Nothing is written (PRD 34.6).
- Real mode polls every 10 seconds. That is enough for the pilot (under 300 members).

## 6. Gaps, ranked

Owner areas: **network** = `packages/network`; **obs** = `packages/observatory`; **schema** = `packages/observatory/db/schema.sql` and `packages/network/db/network-state.sql`; **core** = `packages/core`; **ops** = deployment and infrastructure; **docs** = PRD and docs.

Status: **Built** (done in code, with tests), **Partial** (some of it is done; the rest is in the last column), **Missing**.

| Rank | Gap | Module | Owner | Level | Status | What is left |
|---|---|---|---|---|---|---|
| 1 | Store review items, requests and opportunities in Postgres. A reviewer API on the production Network. A judge invariant: no probe without a prior approval. | Review queue | network, schema | MUST | Partial | `PgStore`, the `unreviewed_contact` invariant, the production service and its staff API are built ([runbook-real.md](runbook-real.md) 6.5), and the Observatory's real mode calls the API. Not deployed. The service records its token, not the person, as the reviewer. |
| 2 | Reviewer edit and re-roll. Time spent per item. Server checks: approve refused under 18; reason "other" needs a note. | Review queue | obs, network | MUST | Built | Works in game mode, and in real mode through the service's `POST /review/:oppId` (rank 1). |
| 3 | Staff sign-in (SSO) in place of the static token. | All | obs, ops | MUST | Partial | Cloudflare Access with JWT verification, and role tokens, are built. The session length comes from the Access application. The Access policy is not set up (rank 11). |
| 4 | Inbound text hidden in real mode; agent-private facets only under the truth lens. | Member 360, timeline | obs | MUST | Built | - |
| 5 | Staff roles on the server. Per-member PII reveal with a reason and expiry. Audit rows for reveals and staff reads. Audit log screen. | Access, audit log | obs, schema | MUST | Built | A reveal covers the whole member, not a field group. A fresh sign-in before a reveal is missing. |
| 6 | Events between messages in the timeline. | Timeline | obs, network | MUST | Built | Both modes, with deferrals, gate reasons, time options and picks, booked plans and cancellations. |
| 7 | Safety case store, queue, hold and lift actions, evidence view, minor-safety view. | Safety console | network, obs, schema | MUST | Partial | Cases, queue, actions (game mode, and real mode through the service API) and the minor-safety view are built. The evidence view is missing. |
| 8 | The leak-check result per outbound message. | Timeline | core, network, obs | MUST | Built | For ConsentNetwork sends. The service's Blooio adapter gives the queue `forbiddenProvider(net)`; it is tested with a fake provider only. |
| 9 | Health alerts: review SLA, job backlog, send failures, matcher heartbeat, invariant violations, daily LLM spend. | Metrics and health | obs, ops | MUST | Partial | LLM spend is missing (no usage records). |
| 10 | Admin-only "proactive matching on in NYC" switch, logged. | Configuration | network, obs | MUST | Built | In the Network, in game mode, and in real mode through the service API (`POST /matching`, admin). |
| 11 | Production deployment: SSO proxy, read replica, read-only login, game controls off. | All | ops | MUST | Partial | `OBSERVATORY_REAL_ONLY=1` turns game mode off. Nothing is deployed ([runbook-real.md](runbook-real.md) section 7). |
| 12 | Simulation lab: background runs, run comparison, judge and canary results in the UI. | Simulation lab | obs | SHOULD | Built | The lab runs `packages/network/harness/experiment.ts`, which reports the judge counts. |
| 13 | `requests` table and a per-request list in both modes. | Requests and demand | schema, network, obs | SHOULD | Built | - |
| 14 | PRD 28.2 scorecard from the event log. | Metrics | obs | SHOULD | Partial | The worthwhile-interruption line is a proxy. |
| 15 | Pipeline ageing, review column, per-opportunity event history. | Pipeline | obs | SHOULD | Built | - |
| 16 | Growth view in real mode; invitee activation compared with seed members. | Growth | obs | SHOULD | Built | Invite trees are not built. |
| 17 | Configuration with versions and history. | Configuration | network, obs, schema | SHOULD | Partial | History of the matching switch and review mode only. Other settings are read-only. No config table. |
| 18 | Conversation explorer: text search, agent trajectories. | Conversation explorer | obs | LATER | Partial | Search covers the Network's messages and system events only, never member text. No trajectories. |
| 19 | Run diff on one snapshot. | Run inspector | obs | LATER | Partial | Two finished runs can be compared. Two engine versions on one snapshot cannot. |
| 20 | Four apps: app switcher, `role@app`, per-app worlds, rows, review reasons and SLAs; cross-app person view (PRD 40.3). | All | obs, schema | MUST (for a second app) | Built | Per-app read logins created in staging and production (ops). The reviewer of record is honored by the service with `NETWORK_SERVICE_CONSOLE_TOKEN` (checked in `real-service.test.ts`). |
| 21 | App-specific Member 360 panels (peon roles and applications, slop dating preferences hidden by default). | Member 360 | obs | SHOULD | Built (3.3.1) | The service's photo route is built (3.7.1); photos are off until `PHOTO_STORAGE` is set. |
| 22 | A "hold from another app" marker in each app's views (platform plan 2.4 rule 5). | Safety console | obs | SHOULD | Missing | The cross-app view shows holds; app views do not. |
| 23 | `cross_app_leak` count in the lab and the health alerts. | Simulation lab | obs, judge | MUST (for a second app) | Missing | Needs the judge invariant from the engine session. |
| 24 | A review view for NC fraud items. | Review queue | obs | SHOULD | Missing | Fraud items show as kind `fraud` in the queue. |

The engine session's reference (attention v1.2) is in the Network: the send timing, cap counting, probe content and availability capture ([network.md](network.md) sections 4 and 6.4). The console shows them: deferral times, gate reasons, booked plans and cancels, time options and picks, and the availability opt-ins (section 3.4).

New member-facing copy and the new console UI (the Times and Booked plan sections, real-mode actions, the service alerts) need the videos in CONTRIBUTING.md section 3.5. Nobody has recorded them yet.

## 7. Launch-gate check (PRD 28.5)

| Gate | Console part | Today |
|---|---|---|
| Every proactive path goes through review and the leak check, in code | Review queue, leak-check display | Met in `ConsentNetwork`, with stored state and the judge invariant. The production service and its reviewer API are built, not deployed, and the Observatory's real mode calls it (rank 1). The Blooio queue's leak lists are wired in the service and tested with a fake provider only. |
| Any member's full experience within two clicks | Member 360 and timeline | Met in both modes (rank 6) |
| STOP, block and report on every channel; safety runbook rehearsed | Safety console | Partly met: cases and actions in both modes (real mode through the service, rank 7). The runbook is not rehearsed. |
| 30 simulated days, 0 canary leaks, 0 invariant violations | Simulation lab | Met in simulation on the current send path: 0 invariant violations, 0 canary leaks and 0 minor contacts in the 21-day runs (seeds 1-3, with and without the time-aware simulator) and the 42-day run (seed 1) ([results](results/2026-10-07-network-consent.md) section 12). The one known judge issue (the allowed re-engagement counts as `two_unanswered`, [network.md](network.md) section 11) did not fire. The Lab tab shows the counts per run (rank 12). |
| Reviewers trained and calibrated | Review queue on staging, simulation lab | Possible in game mode (Review tab with edit, re-roll and time spent), and on staging once the service runs there (rank 1). |
| Cost alerts live | Health | Not met: no LLM spend data (rank 9) |
| Staff access is role-based, scrubbed and audited (proposed new gate) | Access, audit log | Mostly met: roles, Access sign-in with JWT verification, per-member reveal and the audit log are built. A fresh sign-in for a reveal and the deployment are not (ranks 3, 11). |
