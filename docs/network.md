# The consent-first Network (ConsentNetwork)

Status: built and tested in the simulator, 2026-10-07. Updated 2026-10-08: network capital (NC) ledger events (section 7.1), plans v1.1 and the plan lane (section 5.3), and the `app` option for the four apps (section 1.3). Not deployed. Code: `packages/network`. PRD anchors: 28.3, 28.5, 32.8 (review), 32.9 (outreach), 32.10 (consent workflow), 32.13 (feedback), 32.14 (safety), 33 (engine), 34.3 (simulator).

This document describes how the Network turns engine output and member requests into meetings. It also lists the rules the code enforces, the encounter types, the simulator assumptions behind the results, and a review of the prompts.

Results: [results/2026-10-07-network-consent.md](results/2026-10-07-network-consent.md); the attention v1.2 send defaults: [results/SUMMARY.md](results/SUMMARY.md) ("ConsentNetwork send defaults"); NC events and plans v1.1: [results/SUMMARY.md](results/SUMMARY.md) ("Network capital events and plans v1.1"). Runbooks: [runbook-simulation.md](runbook-simulation.md), [runbook-real.md](runbook-real.md) and [runbook-platform.md](runbook-platform.md) (the four apps in local dev).

## 1. What it is

`ConsentNetwork` (`packages/network/src/network.ts`) is the Network side of the product. It reads member messages, decides what to say, asks the engine for proposals, gates them, sends them for human review, asks members first, and schedules meetings. It implements the `NetworkUnderTest` interface, so the simulator runs it in place of the `StubNetwork`. It is written to run behind the real channel later.

| File | What it does |
|---|---|
| `src/network.ts` | The Network: inbound handling, review gate, gates, consent flow, requests, growth, the one send path |
| `src/classify.ts` | Deterministic classifier for every inbound message: request type, abuse signals, age signals, stated age |
| `src/trust.ts` | Risk score and trust levels (ok, watch, hold), corroborated reports, block abuse, inviter accountability |
| `src/outreach.ts` | The one definition of the cap, the send timing and the unanswered rules (`OUTREACH`); the timing functions come from the engine (`attention.*`) |
| `src/copy.ts` | Every member-facing text, and the copy style rules as code (`styleViolations`) |
| `src/geo.ts` | NYC neighborhoods, travel times and public venues (`VENUES`, `meetingSpot`, `nearbyVenues`) |
| `src/store.ts` | Stored state: `NetworkStore`, `MemoryStore`, `PgStore`, `runTick()`, `consoleRows()` and `splitNetworkId()` (section 1.1) |
| `src/capital.ts` | Network capital wiring: the `CapitalReader` interface, `ledgerReader()` and `capitalWiring()` (section 7.1) |
| `src/plans.ts` | Plans v1.1 glue to the engine planner: `PLAN_VENUES`, `statedWindows()`, `activityHints()`, `planLedger()`, `BOOKING_GAP` (section 5.3) |
| `db/network-state.sql` | The Postgres tables `PgStore` writes. Idempotent. |
| `harness/` | Simulation only: experiment arms, NYC scenarios, the friend factory for invites. It reads hidden truth, so it is not production code. |
| `service/` | The production runtime: one network per row of `platform.networks`, the tick loops, the inbound webhooks, the public API for the sites, the channel adapters (dry-run by default) and the staff API, on Postgres ([service/README.md](../packages/network/service/README.md); section 1.2) |

Scope: New York City only. The Network runs the engine with `cities: ["nyc"]` and ignores members whose home city is not NYC. One `ConsentNetwork` serves one app in one city (section 1.3).

### 1.1 Stored state

The Network can save all of its state and load it in a new process. The production service (section 1.2) calls this code. Nothing is deployed yet.

- `exportState()` returns the whole state as plain JSON (`NetworkState`, version 1). It holds members (with what they told the Network and their full name), opportunities with their review records, requests, queued proposals, deferred sends, pair history, trust records, safety cases, counters and sequence numbers.
- `importState(state)` replaces the Network's state with a stored one. It refuses any other version. `runTick()` and `runStored()` call it before every unit of work.
- The review mode is never stored. It always comes from the options, so stored state cannot turn the simulated reviewer on.
- A deferred send is stored as data (a "hook"), not as a function, so it survives a restart. The hook changes how a deferred send is stored, not when it is sent.

| Part | What it does |
|---|---|
| `NetworkStore` | The interface: `load()`, `save(state)`, `withTickLock(fn)` (skips when the lock is held), `withLock(fn)` (waits for the lock) |
| `MemoryStore` | Keeps a JSON copy in memory. For tests and the simulator. |
| `PgStore(url, id = "ntwrk:nyc")` | Postgres. The id is the network id `<app>:<city>` (a legacy id with no app, such as `"nyc"`, belongs to ntwrk; `splitNetworkId`). `migrate()` applies `db/network-state.sql`. Every save sets `app.app_id` for its transaction, so under the `network_service` role it writes only that app's rows (migration 0004). `save()` writes the JSON to `network.network_state` and upserts `network.opportunities`, `network.participations` (participants with their status, and alternates), `network.review_items` and `network.requests`. It rewrites the participations of every opportunity it holds (a re-roll changes them) and deletes rows that the state no longer holds (for example after an under-13 decline). With the console schema, a participation is written only for a member in `network.members` (foreign key). |
| The lock (Postgres) | One advisory lock per network, `hashtext('network-tick-<id>')` (for example `network-tick-ntwrk:nyc`), on one connection, released in `finally`. `withTickLock` uses `pg_try_advisory_lock`: a second holder gets nothing and the tick is skipped. `withLock` uses `pg_advisory_lock`: it waits. Inside one process, callers queue, so waiters never use up the connection pool. |
| `runTick(net, store, now)` | Under the lock: load the newest stored state, run `tick(now)`, save. Returns false when another holder has the lock or waits for it. |
| `runStored(net, store, fn)` | Under the same lock, and it waits: load the newest stored state, run `fn(net)`, save. Use it for every inbound message (`n => n.onInbound(msg)`) and every staff action (`n => n.decide(...)`). |
| `consoleRows(state)` | The console rows for a state. They never hold a member's words. |

Every unit of work loads the stored state first, so two processes on one store never overwrite each other's saves. A store test runs two Networks on one store: a STOP that one handles survives the other's next tick.

Limits:

- A call to `onInbound()`, `tick()` or a staff action outside `runTick()` or `runStored()` is not saved, and the next stored unit of work loads over it.
- `network.network_state` holds members' full names and other private state. Treat it as member data (runbook-real section 2). The Observatory reads only the view `network.network_state_console`, which names each JSON path it passes on (runbook-real section 2).

The store tests check that a Network restarted from JSON gives the same messages, logs, meetings, counters and final state as a run with no restart. One test does this on the NYC world (seed 3, 5 days plus 5 days).

`PgStore.save(state, also)` runs `also(tx)` in the same transaction. The service writes what a unit of work sent and logged there, so the state and its messages are committed together.

### 1.2 The production service

`packages/network/service/` runs one Network for each row of `platform.networks` (`ntwrk:nyc`, `slop:nyc`, `peon:nyc`, `friends:nyc`) against Postgres. Details and the boundary with `packages/plugin-network` are in its [README](../packages/network/service/README.md). How to run it, its variables, the live-send flags and the staff API: [runbook-real.md](runbook-real.md) section 6.5. The four apps in local dev: [runbook-platform.md](runbook-platform.md). It is not deployed.

```bash
NETWORK_DATABASE_URL=... bun run packages/network/service/main.ts [--once] [--dry-run]
```

| Part | What it does |
|---|---|
| Tick | Every minute, each network on its own: `runTick()` with its `PgStore` under its own advisory lock (`network-tick-<app>:<city>`). A second instance skips a network while its lock is held. `RealClock`. |
| Snapshot | `service/snapshot.ts` `loadSnapshot(sql, now, { app, city })` reads one app's members, facets, intents, presence, edges and recent opportunities at the start of each unit of work. Every query filters by `app_id`. Person-to-person blocks (`platform.person_blocks`, from any app) become "blocked" edges when both people are members of this app. The Observatory's shadow runs use the same builder. A member with no age on the record stays "unknown" (6.3). Each member carries `accountStatus` (6.6). |
| Inbound | `POST /webhooks/blooio/<app>` (one app's line, secret `<APP>_BLOOIO_WEBHOOK_SECRET`) and `POST /webhooks/blooio` (the shared line). The shared line routes by `platform.app_lines`, then a keyword ("slop", "slop.date"), then the member's app, then The Network. The phone finds the person, then the membership, then the member id. One unit of work per message; a provider retry is handled once. |
| Public API | `/api/*` for the four sites (`packages/platform/src/api.ts`), on `PLATFORM_API_PORT` (default 8790). A web join creates the network member and sends the welcome through the normal send path (`welcomeJoined`). Stop, leave, delete everything and export call the Network (`forgetMember` for a leave). |
| Outbound | `ChannelAdapter`. `DryRunAdapter` (default) stores each send with status `dry_run`. `BlooioAdapter` wraps the prototype's `OutboundQueue` with `blooioRecipientPolicy` and `forbiddenProvider`. It refuses every send unless `BLOOIO_ALLOW_SEND=1`, `NTWRK_LIVE_APPROVED=1` and the app's own `<APP>_LIVE_APPROVED=1` are set. A person cap of 3 proactive messages a day across all apps is checked when a send goes to the adapter (`refused_person_cap`). |
| Staff API | Role tokens (`NETWORK_SERVICE_TOKENS`, `role@app:<t>` or `role:<t>` for every app), bound to 127.0.0.1. Name the network with `?app=` or `/apps/<app>/...`. `GET /review`, `POST /review/:oppId`, `POST /safety/lift`, `POST /safety/close`, `POST /matching`, `GET /health`. Each action writes `network.staff_audit` (with the app) and the Network's logs. The review mode is not exposed, and the service refuses any mode but "human". `POST /matching` answers 409 `matching_not_allowed` for a network that `platform.networks` keeps off (slop and peon). |
| Under 13 | After the decline, the member row keeps only the id. Their messages, profile, phone and events are deleted. "Events" means every `network.events` row that names them: as the actor or the object, or in the payload (`memberId`, `from`, `newMemberId`, `out`, `in`, `participants`, `members`, `attendance`, the keys the writer reads with `membersOf`). |
| Reply kind | A send is a Blooio "reply" (sent at once, past quiet hours and the queue's caps) only when the Network says so (`NetworkContext.send` option `reply`). A proactive send, a growth ask, a re-engagement or a weekly check-in made while the service handles that member's message is not a reply. |

Tests (local Postgres, a database per test process):

- `test/service.test.ts`: dry-run replies to signed webhooks, retries and strangers, STOP and HELP, an under-13 decline, review through the API after a restart and the next tick's probe, two instances that never tick at once, and no Blooio send without the live flags.
- `test/service-apps.test.ts`: per-app copy, joins by text, under-age and invite-only answers, keyword routing and `platform.app_lines`, the link notice and SHARE, STOP, STOP ALL and START, leave, the person cap, the per-app live flags, staff roles per app, and the public API (join two apps, stop, export, leave, delete everything).
- `test/crossapp.test.ts`: a two-app world (ntwrk and friends) with shared people and planted canaries. No canary or member id of one app reaches the other app's messages, review queue, opportunities, events, snapshot or health. A block made on ntwrk keeps the pair apart on buddies.

### 1.3 Apps (the `app` option)

One `ConsentNetwork` serves one app (`NetworkOptions.app`, default `"ntwrk"`). The app list, names and join ages come from `packages/platform/src/apps.ts` (`APPS`). The four app ids are `ntwrk`, `slop`, `peon` and `friends` (friends.help; migration 0007 renamed `buddies`); the network id is `<app>:<city>` (`ntwrk:nyc`).

| What the app changes | How |
|---|---|
| Member-facing words | `copyFor(brandOf(app))` (`src/copy.ts`). The six texts that named "the Network" use the app's name and agent name. `copy` is still The Network's copy, word for word. |
| The join age | The app's `minJoinAge` (13 for every app since 2026-10-08). A stated or record age under it gets the app's kind decline, and the Network forgets the member. Matching stays 18+ in every app. |
| Ids | Opportunity, request and run ids of the other apps carry the app as a prefix (`friends.nw-1-4`). The `network.opportunities`, `requests`, `review_items` and `matching_runs` tables key on `id` alone, so two apps could otherwise write the same id. |
| Blocks | `blocked()` also reads "blocked" edges from the snapshot, so a person-to-person block from another app keeps the pair apart. |

New methods for the service:

- `welcomeJoined(id)` sends the welcome to a member who joined on the web or by text (the platform already holds the age and the consent).
- `forgetMember(id)` runs the forget path for a member who leaves the app. It deletes what the Network holds about them, as for an under-13 decline.

New texts for joins by text: `joinAsk`, `joinNeedName`, `linkNotice`, `shareDone` and `leftApp`. A new style rule, `asks_cancel`, flags any text that asks a member to reply "cancel" (a bare "cancel" is a STOP keyword). A test runs every app's texts through the style rules.

Proof that ntwrk did not change: a 21-day, seed-1 NYC run hashed every run record before and after the change (same hash, 17,598 records, 62 meetings held). The same run with `app: "buddies"` (now `friends`) sent 0 texts that name the Network and declined 25 people under 18, with 0 judge invariants, canary leaks and minor contacts.

Limits:

- Every app runs The Network's NYC engine, places and time zone with its own brand words and join age. slop and peon matching stays off until an admin turns it on (`platform.networks.matching_enabled = false`). peon job seats: 1.4.
- slop and peon review reasons exist only in the Observatory. The Network's `decide()` accepts the PRD 32.8 codes, so the console sends an app code as its PRD code with `[code]` at the start of the note ([admin-console.md](admin-console.md) 4.6).

### 1.4 peon job seats (#9)

A hiring manager is a peon member who owns job postings. The engine matches job seats, and the Network routes each seat to its manager. Code: `src/jobs.ts` (model, intake, copy), `src/network.ts` (routing), `service/packs.ts` (`peonHooks`), `service/postings.ts` (rows and the staff API).

**The posting.** A `JobPosting` has a title, openings (1-50), a pay range (required), the work model, an area, must-haves, nice-to-haves and a status (`active` or `closed`). It is stored as rows that the engine reads already: an intent `Hire: <title>` (details `peon:job`) and facets tagged `peon:posting:<id>` on the manager (`postingFacts`). There is no new table and no migration. The rows are in `network.intents` and `network.facets`, under the same row-level security, and the forget path deletes them with the member. The snapshot makes each posting a seat `job:<id>` (engine `peonSeats`), and `seatOwnerOf(seat)` gives the manager.

**Who may post.** `managerProblem(id)`: a peon member with a record age of 18 or more and no minor signal, report or age conflict; not paused, restricted, opted out, held or banned; opted in to work matching (`professional`). A minor gets "Job posts are for adults (18+) only." Closing a posting always works.

**Intake by text.** The intake runs in a handled turn (`AppHooks.postings`, peon only), with rules only. It never reads an open-turn LLM output. A posting command ("We're hiring a data analyst, 2 openings, $90k-$120k, hybrid in Brooklyn, must have SQL") starts a draft. The Network asks for a missing title or pay range (at most two questions), then reads the post back. The manager's yes saves it (`applyPosting`, then `NetworkOptions.onPosting`). The service writes the rows in the same transaction as the state (`runtime.ts` `writeUnit`). Other details correct the draft, and a no drops it. "Update my data analyst post: 3 openings" and "Close my data analyst post" work the same way. The draft is in `MemberState.posting`, so it survives a restart.

**Staff API** (`jobPostingRoutes`, peon only, admin for writes): `GET /postings?managerId=`, `POST /postings`, `POST /postings/:id/close` (`reason: closed | filled`), `POST /employers/:memberId/verify` (`company`, `note`; peonPack proposes no job of an unverified employer). Each write goes through `applyPosting` in a unit of work, with the same checks as a text, and writes `network.staff_audit`.

**Routing.** The engine proposes a pair `[candidate, job:<id>]`. `seatRoute` puts the manager in place of the seat and keeps `Opp.seat = { id, manager }`. A seat without a manager on the record is never proposed (gate `seat_without_manager`). Every item goes to the review queue first, like every other item. Then the normal consent flow runs:

1. The candidate first (`firstOf`): the job title, pay range and place. No manager name.
2. After the candidate's yes, the manager gets a blind summary: must-have checkmarks and the start time. No name, score or rank. For the manager this is not an initial invite (they asked for candidates), so it waits only for quiet hours.
3. After both yeses, the intro gives each side the other's name. They write through the agent, or ask it to share a number (relay). There is no reminder. The check-in asks if they talked.

A no from the manager closes the item (an alternate candidate never stands in for the manager). The manager's seat items never make the manager "busy" for other seat items. Minors, held, banned and opted-out candidates are never in an item (the pack input leaves out minors; `eligible` refuses the rest).

**Capacity.** In the engine's input (`seatView`), the manager is the seat again in recent proposals, interactions and open items. An item that both sides said yes to holds an opening (`accepted`) until it closes or its check-in is answered. The engine hook `peonSeatCapacity` then caps each seat at its openings left.

**Close and fill.** At every tick, `checkSeats` ends a seat's items in review or in probes when the posting is closed or gone, or when intros that both sides accepted take all its openings. A candidate who already said yes gets "That job is no longer open...". Intros that are already done stay.

**Validation.** `bun run sim --only peon-seats` (blocking: intake, routing, double opt-in, exclusions, restart, close; review "human", approved by the gate). `packages/network/test/peon-postings.integration.test.ts` (text intake, the yes, restart, the staff API, on Postgres). `packages/network/test/peon-seats.integration.test.ts` (seats and capacity from rows).

**Not built.** The service does not register `jobPostingRoutes` yet (one line in `service.ts`). There is no web intake page. Interview, offer and hire stages after the intro are not tracked. The pack's own stages go further (PRD 40.6).

## 2. The review gate (PRD 32.8)

Every opportunity waits in a review queue before any member hears about it. This includes engine proposals, member requests, plans buddies, second encounters, newcomer welcomes, intros that staff compose in the Observatory, and scenario proposals. No origin skips the queue.

| Setting | Value | Where |
|---|---|---|
| Default mode | `"human"`, always. The member count never changes the mode. | `reviewMode()` |
| Simulator mode | `"auto"`: a simulated reviewer (`sim_auto_reviewer`) approves each queued item. Experiments, scenarios and tests ask for it explicitly. It is never the default. Production must refuse it (runbook-real 7.1). | `NetworkOptions.review` |
| No review | There is no "off" mode. PRD 32.8 keeps review on for the whole MVP. Above 1,000 members, only a category that held the precision gate for 4 weeks may move to sampled review. Sampled review needs a founder-approved option. It is not built. | - |
| SLA | 12 hours; 1 hour for a same-day opportunity | `reviewSlaHours` |
| Missed SLA | The item expires (`review_expired`). Nobody is contacted. It is never sent late. | `advance()` |
| Reject | The opportunity closes. Nobody it names is contacted. The pair is not proposed again for 30 days (requests) or 60 days (engine). | `review()` |

What the reviewer sees and does:

- `reviewQueue()` lists the waiting items, oldest first, with the proposal, the origin, the deadline and the number of re-rolls.
- `decide(oppId, decision, opts)` records the decision and returns `{ ok: true }` or `{ ok: false, reason }`. `review()` takes the same arguments and returns only true or false.
- The decisions are `"approve"`, `"reject"`, `"edit"` and `"reroll"`. Any other decision is refused (`unknown_decision`).
- `opts` (`ReviewOptions`): `reason`, `note`, `reviewer`, `secondsSpent`, `explanations`, `objective`, `swapOut`.
- `secondsSpent` is added up per item and logged. It is a training label (PRD 32.8).
- `setReviewMode(mode, actor)` changes the mode and logs `review_mode { mode, actor }`. A switch to `"auto"` (simulator only) lets the simulated reviewer approve what waits.
- Logs: `review_queued`, `review_decision`, `review_refused`, `review_invalidated`, `review_expired`, `review_mode`. `probe_started` names the origin, the reviewer who approved the opportunity, and the member probed first (`first`). `probe_sent` names the member, the number of time options, and whether it was an initial invite. Every message about an opportunity carries `meta.proposalId` (the judge's `unreviewed_contact` check reads these).

A member who asked for something still hears "On it" at once. The opportunity itself waits for review.

### 2.1 Checks before a decision

`decide()` refuses a decision, logs `review_refused`, and changes nothing when:

| Check | Decisions | Reason code |
|---|---|---|
| The item is not waiting for review | all | `not_in_review` |
| Reason "other" without a note | all | `note_required` |
| A participant was declined at join | approve, edit | `participant_declined` |
| A participant is a minor, has an unknown age, or is not a known member | approve, edit | `participant_minor` |
| Proactive matching is off (2.4) | approve, edit | `matching_paused` |

### 2.2 The gates run again on approval

An item can wait up to 12 hours. On approve (and on an edit, which approves), the Network runs `approvalCheck()`. Every participant must:

- not be declined at join, and be a known member;
- not be opted out;
- have trust "ok";
- not be a minor;
- not be busy with another open opportunity.

No block can stand between any two participants. An engine proposal also passes `gateReason()` (section 3) again.

When a check fails, nobody is contacted. The Network logs `review_decision` (approve), then `review_invalidated { oppId, reason }`, and closes the item unsent. `decide()` returns the reason: `participant_declined`, `unknown_member`, `opted_out`, `held`, `on_watch`, `participant_minor`, `busy_elsewhere`, `blocked_pair`, or a gate reason from section 3.

The send-time recipient checks (section 6.5) still run on every probe and every reveal after approval.

### 2.3 Edit and re-roll

**Edit.** `decide(id, "edit", { explanations, objective })` changes the text, then approves.

- `explanations` is a new explanation per participant. `objective` is a new objective.
- The leak guard checks each explanation for its recipient, and the objective for every participant.
- A leak or contact details give `edit_leak`. An explanation for someone outside the opportunity gives `not_a_participant`. No text gives `nothing_to_edit`.
- The log is `review_decision` with decision `"approve"` and `edited: [...]` (the fields, never the text).
- An edited objective does not change the probe text. An edited explanation for a requester reaches that requester's confirm-probe (section 4.1). The leak guard checks it.

**Re-roll.** `decide(id, "reroll", { swapOut })` swaps one participant for the best eligible alternate.

- With no `swapOut`, the Network swaps the only participant who is not the requester. A requester cannot be swapped out (`cannot_swap`).
- The item stays in the queue with a new deadline. The log is `review_decision` with decision `"reroll"`, `out`, `in` and `next: "review"`.
- With no eligible alternate, the item closes (`next: "engine"`). The swapped pairs go to pair history, so the engine composes a different configuration at its next run.

### 2.4 The matching switch

The admin switch "proactive matching on in NYC" (admin-console 3.11). Option `matchingEnabled` (default true). `setMatchingEnabled(on, actor)` changes it and logs `matching_switch { on, actor }`. `matchingEnabled()` reads it.

| While matching is off | What happens |
|---|---|
| Daily engine run and request retries | Do not run |
| Second encounters, newcomer welcomes, plans buddies | Not composed |
| A new member request | The member gets `copy.requestWaiting`. The request stays open (`request_result` reason `matching_paused`) and is retried when matching is back on. |
| Approve and edit in review | Refused (`matching_paused`). Reject and re-roll are allowed. Items that wait can expire at their SLA. |
| What a reviewer approved before the switch | Continues |
| Growth asks, re-engagement, replies, venue ideas | Continue |

### 2.5 Fraud review items

With a capital reader that returns gaming flags (`CapitalReader.flags`, section 7.1), the Network queues each flag once a day as a review item of kind `"fraud"` (origin `"fraud"`). The item names the flag kind (rings, staged meetups, help farming), the members and the evidence.

- Approve records `fraud_confirmed` in the NC ledger. Reject dismisses the flag. Edit and re-roll are refused.
- Nobody is messaged about a fraud item.
- The same kind and members are not queued again within 14 days. An item nobody decides expires after 14 days.
- The simulated reviewer never decides fraud items, in any mode.
- `reviewQueue()` lists them with the other items. The Observatory shows them as kind `fraud`; it has no special view for them yet.

## 3. Skeptical gating rules

The engine proposes more than the Network starts. Each engine proposal goes through `gateReason()`. The first rule that fails stops it. The reason is counted in `gateReasons` and logged per proposal: `gate_reason { proposalKey, reason, members }` (`proposalKey` is the engine's `attention.opportunityKey`, the sorted member ids).

| Rule | What it requires | Reason code |
|---|---|---|
| Eligible | Every participant: an adult, not opted out, onboarded, trust "ok", not on "only when I ask", room on the Blooio streak (at most 1 message unanswered, `attention.canInterrupt`; a requester needs only room for logistics), in NYC for the next 6 days, not busy with another open opportunity, under their initial-invite cap (6.4) | `participant_unavailable` |
| Daily cap | At most 20 new engine opportunities a day (`maxNewPerDay`) | `daily_cap` |
| Known profile | At least 2 known interest or skill facts per participant, or one active intent (`minKnowledge`) | `thin_profile` |
| Engine confidence | The engine's `confidence` component is 0.35 or more | `low_confidence` |
| A want for every participant | For each participant, the Network can name a want that the others meet, with a fit of 0.8 or more (`minWantMet`), judged only from what it knows | `want_not_named` |
| Responsive | Each participant answers at least 60% of what the Network asks (`minResponsiveness`). The rate starts at 2 of 2, so new members pass. | `unresponsive` |
| Not speculative | A proposal with no intent or event anchor needs a warm path of 0.3 or more, or a fit of 0.45 or more | `speculative` |
| Pair history | No block, no "avoid" edge (a bad meeting) and no decline between any two participants in the last 60 days | `pair_history` |

How "a want for every participant" works (`knownWantMet`):

| Known evidence | Fit |
|---|---|
| A stated want answered by a corroborated skill of another participant | 1.0 |
| The same want on both sides (for example, both want a climbing partner) | 0.85 |
| A stated want answered by an uncorroborated skill | 0.6 |
| A stated want that matches an interest of another participant | 0.45 |
| Social and events: 0.3 for each shared known interest | at most 0.8 |
| Romance | Not judged here. The engine owns the romance opt-in checks. |

Evidence rules (`knownProfiles()`):

- **No unconfirmed inferences.** A fact that was inferred (for example, a skill guessed from a job title) and not confirmed by the member is ignored.
- **Corroborated skills.** A skill is strong evidence only with two independent sources (said in chat and seen on a connected profile), or after a requester enjoyed meeting the member for that skill. People overclaim.
- **Agent-private facts never count** for matching, and the leak guard keeps them out of every message.
- **Wants expire.** A want that a member told the Network stays live for 60 days. A want the member withdrew at a check-in is confirmed with them before it is used again.
- **Travel.** A member with an announced trip out of NYC in the next 6 days is not eligible. Member-request candidates must be within 45 minutes of the requester; plans buddies within 35 minutes.

## 4. The consent flow

The flow follows the engine session's reference, attention v1.2 ([results/2026-10-07-attention-budget.md](results/2026-10-07-attention-budget.md), iterations 3 and 4). The engine helpers come from `@thenetwork/engine` (`attention.*`).

```
engine proposal / member request / plans / second encounter / newcomer welcome
  -> gates -> REVIEW (human, or the simulated reviewer)
  -> probe the first member (anonymous, 2-3 time options)
  -> on their yes: probe the partner with only the times the first member picked
  -> both yes: the booked plan (names, time, place; "Reply if you can't make it")
  -> silence for 48 hours = confirmed; "can't" cancels -> reminder -> feedback
```

### 4.1 Probes, one member after the other

- **Who is first.** A requester, else the engine's `attention.firstToProbe` (the member with the live want: seeker, initiator or newcomer), else the first participant. The others are probed only after the first member says yes. A group probes the first member, then everyone else at once.
- **What a probe says.** The activity, the area, 2-3 time options, and at most one fact about the other person (the reason, built only from what the Network knows, `probeReason`). It never gives a name, a photo or an employer. A probe that would carry another participant's name or an employer-like value falls back to the generic text. The activity is never a fact: an engine theme ("Intro: rock_music", "Small group: climate tech") is left out and the category's generic activity is used; an event keeps its title ("going to Jazz Night"). A request probe gives only the want: "Someone nearby wants to find a regular climbing partner. Would you be up for it?" It never says where the requester lives. `styleViolations` refuses raw taxonomy tags ("climate_tech") and broken built phrases ("they works", "asked me for meet"); the 10-day world test runs it over every probe. Example: "Quick check, no names yet: would you be up for a climbing session near Greenpoint (someone who also wants to find a regular climbing partner)? I could do Thursday 7pm or Saturday 10am. Tell me which works, or no is completely fine."
- **Time options** (founder decision 4). `attention.chooseTimeOptions` picks 2-3 slots from 24 hours to 7 days ahead that are most likely to work for everyone. The evidence is what the Network knows: stated availability (onboarding answers, weekly check-ins, `availability_pattern` facets, read by `attention.standingFromFacets`), times the member picked or turned down before, announced trips, and quiet hours. An event with its own time window gets that time only. The probe carries `SimMeta.timeOptions` (`{ key, start, end, label }`, keys "a", "b", "c").
- **Answers** (`parseProbeReply`, `classify.ts`). Free text: "Thursday", "Thursday 7pm works", "the first", "either", "a or b", "neither", "none of those work", "yes", "no thanks". A plain yes picks every time except the ones the member rules out ("yes, not Sunday though" picks the other two). "Neither" is a yes with no time.
  - A refusal wins. A reply that opens with no, nope, not or can't, or that `parseYesNo` reads as no, is a no unless it names a time it does not refuse ("no plans Thursday, so Thursday works" is a yes to Thursday). "No, I can't make any of them", "no, either is bad", "no sorry, none of those" and "not this week, any time next week?" are a no. "No problem" and "no worries" are not refusals.
  - A time the member refuses is never picked: a negation earlier in the same clause ("can't do Thursday or Saturday", "yes but not Thursday", "busy Thursday") or a refusal right after it ("Thursday doesn't work", "Sunday is out"). A reply that only refuses times ("Thursday doesn't work") is not read; the probe stays open.
  - Short day names ("sun", "sat", "wed", "mon") count only in a day context ("sat 11am", "sun or mon"), so "if the sun's out" picks no day.
- **The partner** is offered only the times the first member picked, at least 12 hours ahead, and never a time any member turned down. When the first member said "neither" twice (no picks), the partner gets new times for everyone, never one a member turned down.
- **No time in common.** When the others named times and none of them can still work (each is less than 12 hours away, or this member turned it down), the opportunity closes quietly: `no_common_time { oppId, memberId }` and the counter `noCommonTime`. The partner is then not probed at all, and a partner who says "neither" to the picked times gets "No problem." instead of a retry.
- **"Neither" gets one more try.** A member who says yes but picks no time gets other times once, as a direct reply (a `scheduling` message with `timeOptions`). The retry never repeats a time anyone turned down. A second "neither" keeps the yes; the plan is then set at the time that suits them best from the other member's picks (never one they turned down).
- **A requester with a strong fit** is not asked yes or no (they asked). They get one question first: which of the times works for them. Their picks are what the other person is offered. A requester with a partial fit gets a confirm-probe with the times.
- A probe expires 26 hours after it went out. A probe that cannot go out (the member's send window never opens, section 6.4) expires after 2 days unsent. Before a probe goes out, the Network checks again that the member is in New York this week.
- When a participant says no, does not answer, or cannot be contacted, an alternate takes their place (at most 3 swaps). A group of 3 or more continues without them. Otherwise the opportunity closes quietly. No member learns who said no.

### 4.2 The booked plan (the reveal with an opt-out)

When every participant said yes, the Network books the plan and tells each member once:

> You're both in: meet Sam K., Thursday 7pm at McCarren Park (Williamsburg). You both want to find a regular climbing partner. Reply if you can't make it.

- **The time.** The earliest time every member who answered with times picked (at least 6 hours out, never a time anyone turned down). If someone picked none, the time from the others' picks that the evidence says suits them best. When members named times and none is left in common, nothing is booked: the opportunity closes (`no_common_time`). Only when nobody named a time: the best joint time from `chooseTimeOptions` (never a turned-down time), else the old default (a weekend late morning for activities, a weeknight at 19:00). The `venue` log says which (`time: picked | partly_picked | estimated | default`).
- **The place.** A public venue that keeps the longest trip short (`meetingSpot`), or the fixed venue of a plans buddy.
- **The message** carries `type: "proposal"`, `proposalId`, `meetingAt` and `SimMeta.booked { proposalId, at, optOutHours: 48 }`. It is logistics: it never counts on the cap, and it goes only while the member has at most 2 messages unanswered. The meeting is recorded at booking. There is no separate "you're all set" message.
- **Opt-out.** Silence for 48 hours (or until the meeting) counts as confirmed. A "no" ("can't", "no", "not anymore") or a cancel phrase ("can't make it", "need to cancel", "something came up") cancels the plan (`booked_cancelled`). A "yes" or an acknowledgement gets `copy.bookedThanks`. The other member hears that it is off (a pair) or still on (a group of 3 or more), never why. Only members the plan reached hear about a change.
- **Caution: a bare "CANCEL" is a STOP keyword.** The simulator channel and the service treat the one word "cancel" (any case) as STOP, so it opts the member out of all messages; it does not only cancel the plan (section 11).
- **Calendar and weekly check-in** (founder decisions 4c and 4d). A member's first booked plan ends with one offer: "Next time I can skip the time question: reply CALENDAR to share your calendar's free/busy, or WEEKLY for a short weekly check-in." CALENDAR records consent to free/busy only (`calendar_consent`); no calendar source is connected yet (section 11). WEEKLY turns on "What's your week like?" once a week, on Sunday (`availability.weeklyCheckIn.day`) in the member's send window. It is a profiling ask: never on the cap, one question at a time, never for members aged 13-17. The answer becomes stated availability for 7 days. "CALENDAR OFF" and "WEEKLY OFF" stop them.

### 4.3 Meeting and after

- A reminder goes at T-4h, or at the last allowed time before the meeting.
- A participant who cancels is dropped. The others hear that the meeting is off (pairs) or still on (groups of 3 or more).
- A feedback question goes 3 hours after the meeting. Feedback becomes engine input: negative sentiment adds an "avoid" pair, "would meet again" from both sides makes a second-encounter candidate, and no-shows lower reliability. A good meeting also counts as an attended time in the member's availability history.

## 5. Member requests and fulfillment

`classify()` sorts each inbound message. Two kinds start work: a people request ("anyone around who'd want to start a rock band?") and a plans request ("anything fun near Astoria this weekend?").

### 5.1 People requests

1. `searchFor()` scores every eligible member on their known profile only:

   | Evidence | Score |
   |---|---|
   | A corroborated skill that the want needs | 1.0 |
   | The same want (same pool) | 0.85 |
   | A stated skill that the want needs | 0.6 |
   | Matching interests | 0.4 + 0.1 per interest |
   | No specific want: shared tags | 0.35 + 0.15 per tag |

   A candidate needs 0.45 or more and a trip of 45 minutes or less. Closer candidates score a little higher. Romance requests are not searched here.
2. If someone fits, the member hears "On it" at once. The best candidate becomes an opportunity with up to 3 alternates. It goes to review.
3. After approval, the candidate gets a probe that says someone nearby asked for this. The requester is probed only for a partial fit or a withdrawn want (section 4.1).

Standing requests:

- If nobody fits, the member hears once that nobody fits yet. The message suggests a public venue for the activity and offers an invite for a friend.
- The Network retries open requests once a day for 7 days, as people free up or join. A retried match goes to review like any other; the member hears "I may have found someone" only after approval. If it is rejected, expires or falls through, they hear once that nothing came of it this time.
- The engine can also return questions for members it knows little about (`EngineResult.asks`). The Network sends at most one per member per 7 days, through the same send path, never to members aged 13-17, and passes the answers back as `recentAsks`.
- A repeat ask within 3 days ("still hoping to...") is the same request. It does not open a new one.
- A member who already has an open opportunity hears "let's see how that goes first".

### 5.2 Plans and plans buddies

1. The member gets 3 nearby public venues that fit their interests.
2. If another member asked for plans in the last 3 days and lives within 35 minutes, the Network composes a plans buddy: both go to the first venue together.
3. Asking for plans is not consent to meet a stranger. Both members get a probe first, and the opportunity goes to review.

Members aged 13-17 get the venue list only. A people request from a minor is answered as a plans request.

### 5.3 Plans v1.1: the planner and the plan lane

The engine's planner (`plans`, `DEFAULT_PLANS`, plans-v1.1.0 in `packages/engine`) proposes group plans at public places. The Network runs it, reviews each plan, probes members on a separate lane, and books a plan when enough people say yes. Option `plans` (default true) turns it on; `plansConfig` overrides the engine defaults. Measured in [results/SUMMARY.md](results/SUMMARY.md) ("Network capital events and plans v1.1").

| Step | What happens |
|---|---|
| Availability | The answer to the weekly check-in ("What's your week like?") becomes this week's stated windows (`statedWindows`) and activity hints (`activityHints`). Availability given during onboarding is kept as standing availability; it no longer expires after 7 days. |
| Planner | Monday and Thursday from 09:00 New York. It plans for members with a stated window who are not in an open opportunity. |
| Review | Each plan is one review item (origin `planner`). No plan reaches a member before approval. |
| Probe | An anonymous plan probe (`meta.type` `"plan_probe"`): the activity, the area, the time options. No names. A probe the engine cannot build without a leak (`buildPlanProbe` returns null) is not sent and counts as a no. |
| Plan lane | At most one plan invite a day for a member, in the send window. Members on the plan allowance get at most 1 plan invite per 7 days (`planLedger`, a plan-only ledger). Plan invites count for the two-unanswered pause and the Blooio streak. They never count on the intro cap (6.4). |
| Answers | Silence for 26 hours after a probe counts as a no. Alternates from the reviewed list fill in. |
| Booking | The plan books at quorum. Anyone booked elsewhere within 4 hours (`BOOKING_GAP`) is dropped first. Names appear only after quorum, in the booked plan: the people, the time, the public place, and "everyone pays their own way". A late yes can join until 6 hours before. Booked plans count as away when the Network picks a time for an intro. |
| Falls short | `planFallback`: a smaller plan, a public event, or next week. "That plan didn't come together this time." goes into the member's next message. Nobody learns who declined. |
| After | "How was X, and would you do it again with this group?" Members who both say yes get a `would_interact_again` link. Crew detection uses those links. A crew is offered once, and members opt in. Weekly crew sessions are reviewed like any plan and handed off after 3. |
| Places | `PLAN_VENUES`: public places from `geo.ts` (parks, libraries, markets, courts, museums), price tier 0. No homes, no money. |

Members aged 13-17 are never in a plan role. The plan counters are in `plansCounters` (plans proposed, probes, yes, booked, fallbacks, crews).

Result (21 days, seeds 1-3 pooled, simulated reviewer, plan-aware personas): 99 plans proposed, 226 plan probes, 24% yes, 8 plans booked, 7 plan meetings held, no crew. Meetings held overall did not change measurably (172 with plans, 161 without, within seed noise). Every plan safety check was 0.

## 6. Trust and safety

### 6.1 Classification

`classify()` runs on every inbound message before anything else, the first message included. It is deterministic. An LLM classifier can be added on top later; these rules are the floor.

| Signal | Examples | What happens |
|---|---|---|
| Sales and spam | "20% off for Network members", "send my link to all members" | Polite boundary, risk points |
| Scam | "send me $200 for the deposit", "guaranteed returns" | Boundary, risk points |
| Contact extraction | "give me Sam's number", "home address" | "I can't share other members' contact details" |
| Prompt injection | "ignore previous instructions", "admin debug mode" | "I can't help with that", risk points |
| Harassment | "they owe me", "make them answer" | "Please give them space" |
| Age | "I'm 15", "10th grade", "my mom says", "after school" | Age policy (6.3) |
| Block, report | "block Sam K.", "report Sam K." | Block the pair; a report also flags the target (6.2) |

### 6.2 Trust levels

| Level | Score | Effect |
|---|---|---|
| ok | below 3 | Normal |
| watch | 3 or more | Never put in a new opportunity. Can still get replies and venue ideas. |
| hold | 6 or more | Everything paused. Open opportunities with them close. They hear that a person will look. Only a person lifts a hold. |

- The score drops by 1 point for each 14 days with no new signal. Holds do not decay.
- **Corroborated reports.** A report adds points only when two different members report the same person, or the target already has a risk score. The reporter must be credible (trust "ok", fewer than 3 blocks in 14 days). One person cannot get someone removed.
- **Block abuse.** A member who blocks 3 people in 14 days gets 2 risk points.
- **Inviter accountability.** When an invitee reaches hold, the inviter loses invites for 30 days and gets 1 risk point.
- **Forget.** When a member is declined at join, `Trust.forget()` deletes their record and removes them from the reports they made about other members.

### 6.2.1 Safety cases (PRD 32.14)

Every trust event about a member goes into that member's open safety case, or opens a new one. A case holds the time, kind, points and reporter of each event. It never holds message text.

| Status | When |
|---|---|
| open | The first trust event about the member, or a new event after a lift |
| held | The member reached hold |
| lifted | Staff lifted the hold |
| closed | Staff closed the case. A new event after this opens a new case. |

Staff actions (each logs `safety_action { action, caseId, memberId, actor, note }`):

- `safetyCases()` returns every case, with each member's trust level now.
- `liftHold(memberId, actor, note)` lifts a hold. The score goes to 0 with a `hold_lifted` event, and the level goes to "ok". It refuses a member who is not on hold (`not_on_hold`). The Network sends the member no message; a person contacts them. The case stays "lifted" until staff close it.
- `closeCase(caseId, actor, note)` closes a case with a decision. A member who is still on hold stays on hold (a confirmed hold).
- Both need an actor (`actor_required`).

### 6.3 Age policy

The policy comes from `packages/core/src/policy.ts` (`MIN_MEMBER_AGE = 13`, `ADULT_AGE = 18`, `canJoin`, `isMinor`).

- The Network reads an age from a message only when the member says it about themselves and the clause reads like an age ("I'm 15.", "I'm 15 years old", "I'm in 7th grade"). "I'm 4 years sober", "I'm 12 years into my career", "I'm 3 and 0 this season" and "12 yo whisky" are not ages. A bare "and", "now" or "too" after a number ends an age only for 13 and up.
- **Under 13:** the member gets one kind decline (`UNDER_MIN_AGE_DECLINE`). Then the Network deletes everything it holds about them. It keeps only the id, so it never messages them again. The log `join_declined` holds only the reason. The Network declines only when the age on the member record is under 13, or when the member states an explicit age under 13 ("I am 12 years old", or "12" as the answer to the age question). The Observatory's Postgres writer (`db/writer.ts`) does the same: the member row keeps only the id and `account_status = 'removed'`, with no name, age, profile, contact, facets, messages or edges.
- **Conflict:** a looser statement under 13 ("I'm in 7th grade", "I'm 5, maybe 10 minutes away") never declines, with or without a record age. The Network treats the member as a minor (fail closed), deletes nothing and logs `age_conflict` for staff to check. With no record age, the log has no `attestedAge`.
- **Minor:** the Network uses the lowest age it knows (the record or any age the member states). Under 18 is a minor. The record is read again on every unit of work and at every send-time check (6.6): a record age under 18 makes the member a minor at once (`minor_record`), takes them out of every open opportunity, and stays (a later adult record age does not undo it).
- **Found to be a minor after a booked plan:** when a member becomes a minor (a signal, a stated age or the record) after the Network revealed adults to them in a booked plan, the Network opens or adds to that member's safety case with one `minor_after_contact` event per adult (ids only) and logs `minor_after_contact`. Staff decide what to do about those adults. In the 21-day NYC runs this happened once in three seeds: a 16-year-old whose record said 20 and who gave no sign of age until after the meeting. Nothing before the meeting could have caught it; only age verification at onboarding would.
- **13 to 17:** the member can use the agent for themselves (chat, events, places). They are never probed, matched, revealed to anyone or told about anyone. Growth asks and invites are off for them.
- **No valid age:** the member is not declined, because a decline deletes data. The Network treats them as a minor (never matched) and logs `age_unknown`. The welcome asks the age once (`copy.welcomeAskAge`).
  - `ageAnswer()` in `classify.ts` reads a bare answer ("34", "fifteen", "I'm 34") as an explicit age. A longer reply with a number in it ("I'm 5, maybe 10 minutes away") is not a bare answer: under 13, it is a looser statement (see Conflict).
  - Under 13: declined, nothing kept.
  - 13 to 17: stays a minor and gets `copy.minorNotice`.
  - 18 or more: becomes an adult, gets `copy.welcomeAfterAge`, then onboarding. The engine gets the age they stated.
  - The log `age_resolved { memberId, minor }` follows an answer.
  - A reply with no age is not asked again. The member stays single-player (treated as a minor).
  - Review refuses approve for a member with an unknown age (`participant_minor`, section 2.1).
- "I'm in middle school" maps to age 13 (a minor, not declined), because a decline deletes data. A member with a valid attested age of 13 or more is declined only by an explicit "I am N years old" under 13.

### 6.4 Outreach control (PRD 32.9)

`OUTREACH` in `src/outreach.ts` is the one definition of the numbers. The send-time functions come from the engine (`attention.learnSendProfile`, `inSendWindow`, `inMemberQuietHours`, `canInterrupt`, `canSendLogistics`), so the Network and the engine's reference apply the same rules. Founder decisions 1-3 of 2026-10-07 (attention v1.2) replaced the 09:00-20:00 window and the old cap counting.

| Rule | Value |
|---|---|
| Send time | A rolling daily slot at 12:00 New York time, plus a stable spread of up to 2 hours per member, open for 6 hours. Interruptions (initial invites, asks, the weekly check-in, the re-engagement) wait for it. |
| Learned send time | `attention.learnSendProfile` over the member's own replies (not keywords): at least 5 replies per profile, weekday and weekend separately, recency-weighted (half-life 28 days). The slot moves (morning 09:00, lunch 12:00, afternoon 15:00, evening 17:00) only with clear evidence. |
| Quiet hours | Always win. Nothing agent-started goes out in the member's quiet hours (plus 20:00-08:00 on school nights for members aged 13-17). Logistics (the booked plan, reminders, feedback asks, cancellation notices, the requester's time question) wait only for quiet hours. Direct replies and safety notices go at once. |
| Deferral log | A send that waits is logged once: `send_deferred { memberId, kind, until }` (`oppId` for a probe). |
| Cap (initial invites) | Only a member's initial invite to a new opportunity counts: their first probe, once per member and opportunity. The partner's first probe counts on the partner's cap; it needs no break-in and goes in the partner's send window as soon as the first member says yes. Open 4 per 7 days, Normal 2 per 7 days, Quiet 1 per 30 days, Receiving 2 per 7 days (support only), Paused 0. Counted at send time over what was sent. |
| Never on the cap | The booked plan, reminders, cancellation notices, feedback asks, acknowledgements, a requester's own confirm-probe or time question, profiling asks (engine questions), growth asks and the weekly check-in. `meta.proactive` is true only for initial invites (and the one re-engagement), so the judge counts the same thing. |
| One question at a time | Asks (profiling, growth, the weekly check-in) are not budgeted, but an ask with no reply blocks the next ask for 72 hours. |
| Unanswered | An initial invite is unanswered after 72 hours. Two unanswered initial invites move the member to "only when I ask". |
| Blooio streak | Every outbound message counts since the member's last inbound message. An interruption needs at most 1 unanswered (`canInterrupt`); logistics at most 2 (`canSendLogistics`). A fourth message in a row is never sent. Replies and safety notices are exempt. |
| Re-engagement | Founder default D6: one message, only after 30 days of silence, and only when an engine run in the last week held a top-quartile item for the member. Members aged 13-17 get none. Only an inbound message resets these rules. |
| Acknowledgements | "Thanks, noted" and similar are never sent alone. They ride in front of the next message the Network starts within 24 hours, or are dropped when the Network is answering something new the member said. |
| Outside-world items | Places and events go out only as an answer to the member's own ask, never alone. |
| Plan invites (5.3) | A separate lane: at most one a day per member, in the send window; at most 1 per 7 days on the plan allowance. They count for the unanswered rules and the Blooio streak, never for the intro cap. `meta.planInvite` marks them. |
| Person cap (service) | At most 3 proactive messages a day for one person across all apps, checked by the service when a send goes to the adapter ([runbook-platform.md](runbook-platform.md) section 4). The Network itself does not see other apps. |

### 6.5 The send path

`send()` is the only way a message leaves the Network. In order:

1. **Recipient checks** (`checkRecipient`). Every send: not declined at join, not opted out. Agent-started sends: not on hold. Initial invites and agent-started asks: not on "only when I ask". Anything about another member (probe, booked plan, reminder, feedback): the recipient is not a minor and not on watch; every other person is a known adult not on watch; no block stands between them.
2. **Cap and asks** (6.4): the cap for initial invites, the one-question rule for asks.
3. **Blooio streak** (6.4).
4. **Timing** (6.4). A deferred send runs every check again when it can go out. A probe is not queued: it is composed again (with fresh time options) when the member's window opens.
5. **Leak guard** (`LeakGuard` in `packages/core/src/guard.ts`). It checks the text against other members' agent-private facts (whole, or any run of 4 or more of their words), every canary, and contact patterns (phones, emails, addresses, URLs, handles). The Network's own place and interest names are removed from the private facts first, so "near Hell's Kitchen" does not block messages. On a hit, the Network sends a generic fallback text, or nothing, and logs `guard_blocked` without the text.

Adapters for the Blooio outbound queue (`packages/blooio/src/outbound-queue.ts`):

- `blooioRecipientPolicy(net, memberOf)` applies the recipient checks through the queue's `recipientPolicy` hook.
- `forbiddenProvider(net, memberOf?)` supplies the queue's leak lists (`LeakSources`) through its `forbiddenProvider` hook. For one recipient: every other member's agent-private values (multi-word values also as facts, matched fuzzily) and every canary except the recipient's own. For a group chat ("chat:<opportunity id>", or `memberOf` returning several ids) or an unknown address: everyone's, so every participant is covered. The Network's own place and interest names are public phrases. A test plugs it into the queue: another member's fact or canary parks the message for leak review; the recipient's own fact and ordinary Network text go out.

### 6.6 The member record is read again

The member record can change after the Network first sees the member: a staff age correction, a paused or restricted account, new quiet hours, a new participation state. The Network reads these fields from the snapshot again at the start of every unit of work (an inbound message, a tick) and in every send-time check (`eligible`, `checkRecipient`, `overBudget`, `timingOk`):

| Field | Effect |
|---|---|
| `prefs.quietHours` | The new quiet hours apply to the next send. |
| `state` (participation) | The cap for the new state (a paused member gets 0 initial invites). An opted-out member reads as "paused". |
| `age` | Under 18 makes the member a minor (sticky). Under 13 declines at the next message (6.3). |
| `accountStatus` "paused" or "restricted" | Not matchable, and not reachable except for replies and safety notices (`send_refused` reason `account_paused` or `account_restricted`). Others in an opportunity with them get `other_not_matchable`. |
| `invitedBy` | Updated. |

A member the record now keeps out of matching (a minor, or a paused or restricted account) is dropped from every open opportunity at the start of the next unit, as for an opt-out. The production snapshot (`service/snapshot.ts`) carries `accountStatus`; the simulator's snapshot has none (every account is active).

## 7. Growth

Growth asks are asks, not initial invites (founder decision 3): they do not use the cap. They wait for the send window, follow the one-question rule and the Blooio streak, and never go to members on "only when I ask".

| Task | When | Limits |
|---|---|---|
| Ask after a good meeting | Positive feedback | Once a month per member |
| Gap ask | A request went unmet this week. Ask a nearby member (30 minutes or less) who shares the interest: "A few people near Astoria are looking for a climbing partner. Know anyone?" | 8 asks a day across the Network; one per member per 21 days |
| Plain ask | Engaged members (10 or more days in, 4 or more messages) who were never asked | Same limits |
| Invite | The member replies with a friend's first name. The Network sends an invite link to pass on. | 3 invites per member per 30 days. Never for minors or members not "ok". |
| Newcomer welcome | An invited member who joined 1-7 days ago and finished onboarding. The host is a reliable member (no no-shows, here 7 days or more) within 30 minutes who shares an interest. | Reviewed like any other opportunity |

The inviter hears when the invitee joins.

### 7.1 Network capital (NC) events

The Network reports what members do for each other to the NC ledger (`packages/capital`, PRD 39.2). It also reads the NC levers back. Both are optional: without them the Network behaves as before. Design: `docs/results/2026-10-08-network-capital-plans.md` section 2.1, in git history (16cde70); summary in [results/SUMMARY.md](results/SUMMARY.md).

**Events.** `NetworkOptions.onLedger(e)` gets every ledger event, in time order, with a stable id (`<type>:<key>`, so a replay after a restart is idempotent) and the Clock time. `capitalWiring()` connects a `CapitalLedger` and counts events the ledger refuses.

| Event | When |
|---|---|
| `member_joined`, `member_activated` | At the welcome (with the lowest valid age and the voucher; a member treated as a minor is sent with no age), and when onboarding ends |
| `plan_accepted`, `plan_confirmed`, `plan_cancelled` | The booked plan reaches the member; the member says yes or stays silent for 48 hours (or until the start); the member can't make it or opts out |
| `plan_attended`, `plan_no_show`, `plan_ghosted`, `feedback_given` | After the meeting. Present: said they came, or a counterpart who came reported nobody missing, or the host checked them in. Ghosted: reported missing in a pair and no word after the booked plan. Nothing known: nothing is sent. |
| `value_received`, `help_given`, `help_confirmed`, `need_answered` | Positive answers after a meeting; the requester's answer on a skill request; a retried standing request the requester found good |
| `organized` | A hosted plan whose host came, with the host's check-in list |
| `safety_flag`, `abuse_confirmed`, `member_removed` | A trust change to watch or hold; staff close a case with the member still on hold |
| `review_completed`, `fraud_confirmed` | A review decision by a reviewer who is a member; a reviewer approves a fraud item (2.5) |

Plan origin: only a second encounter counts as member-started (both asked for it). A crew session counts as organizer-led. Everything else (engine, requests, the planner, staff) counts as engine. The first wiring counted requests and plans buddies as member-started, and ring detection then flagged 58 honest groups in 60 days; with this rule it flags 0 on the same run.

**Levers.** `NetworkOptions.capital` is a `CapitalReader`; `ledgerReader(ledger)` builds one. Every function reads one member's own entries.

| Lever | Where the Network reads it | Floor without a reader |
|---|---|---|
| `vouchCapacity` | At invite time, in place of `invitesPerMonth` | 3 invites per 30 days |
| `effort` | The re-search interval of a standing request, the research depth for a request, and the plan options for a plans ask | Every 3 days, depth 3, 3 options |
| `organizingReach` | Crew sessions: the crew's own seats first (at most 8); every seat above 8 goes to members with the least recent participation who fit the activity. They get the plain plan probe. | 8 |
| `flags` | Once a day, as fraud review items (2.5) | No fraud items |

## 8. Encounters catalog

### 8.1 Implemented

| Encounter | Origin | Source | Notes |
|---|---|---|---|
| 1:1 intro | engine | generators `intent_to_capability`, `complementary_intents`, `shared_intent_pooling`, `warm_path` | Gated (section 3) |
| Small group (3-6) | engine | `shared_intent_pooling`, `group_composer` | Needs 3 yeses |
| Event co-attendance | engine | `event_anchor` | Needs event data (world knowledge) |
| Help request | engine | `help_request` | "a quick favor" |
| Member-initiated intro | request | `searchFor` | Section 5.1 |
| Plans buddy | plans | `plans_buddy` | Section 5.2 |
| Second encounter | Network | both said "would meet again" | Reviewed |
| Newcomer welcome | Network | section 7 | Reviewed |
| Network-growth ask | Network | section 7 | A message, not a meeting |

### 8.2 Proposed (not built)

These are design notes only. PRD 28.3 lists the MVP opportunity types: 1:1 intro, small group, event co-attendance, help request, member-initiated introduction, newcomer welcome, network-growth ask, and the monthly gathering (32.16). Each row says which type it fits. A row marked "founder approval" needs a PRD change before anyone builds it (CONTRIBUTING.md section 1).

| Encounter | Mechanics | MVP type | Status |
|---|---|---|---|
| Skill swap | Two members each have a stated skill the other wants ("teach me to belay; I'll fix your bike"). The probe names both sides of the trade. Both wants must be named (section 3), so it is two-sided by design. | 1:1 intro | Fits |
| Plus-one or spare ticket | A member says they have a spare ticket. The Network probes members with a live want in that event's category who are free that evening. The first yes gets the reveal. Short TTL (hours, not a day), so it needs the 1-hour same-day review SLA. | Event co-attendance | Fits; needs same-day review staffing |
| Walk-and-talk | A low-cost first meeting: a 30-45 minute walk on a public route (a park loop) instead of a café. A format option on a 1:1 intro for members who prefer short first meetings. | 1:1 intro (format) | Fits |
| Standing weekly group | A group that met and all said "would meet again" gets a fixed weekly slot. The Network sends one reminder a week and replaces a member who leaves (an anonymous probe to a candidate). Each reminder counts against budgets unless the member opted in to the series. | Small group plus recurrence | Founder approval (recurring series are not in 28.3) |
| Supper-club table | A table of 4-6 at a restaurant, composed around a shared want (`dinner_club`). One member with the `hosting` skill anchors it. The reveal gives first names only. Everyone pays for themselves (no payments in MVP). | Small group | Fits |
| Co-working session | 2-4 members with flexible days work side by side at a public library or café for a morning. Low social pressure; good for newcomers. | Small group | Fits |
| Office hours | A member with a corroborated professional skill offers a 1-hour slot. Up to 3 requesters book 20-minute turns. Helper load must be capped (PRD 35.2 fairness). | Help request | Fits; needs a helper-load cap |
| Volunteer crew | 3-6 members join a public volunteer shift (a park cleanup, a food bank) from an event feed. | Event co-attendance | Fits; needs event ingestion (32.6) |
| Parent playdate | Parents with a `parent_friends` want meet at a public playground with their children. Children are never members and are never named. No home visits. | Small group | Founder approval (PRD 28.4 excludes childcare; needs a safety review) |
| Language exchange | Two members, each fluent in the language the other is learning, alternate 30 minutes in each. A special case of skill swap. | 1:1 intro | Fits; needs a language facet in the taxonomy |
| Monthly gathering tables | At the monthly all-member gathering, the Network suggests tables of 4-6 from known wants and interests. Members confirm by RSVP; nobody is told who declined. | Events (32.16) | In MVP scope; not built |

## 9. Simulator modeling assumptions

The results depend on how the simulated members decide. These are **assumptions** in `packages/sim/src/oracle.ts` and `packages/sim/src/agent/policy.ts`. They are not measured on real people. Real pilot data must replace them.

| Assumption | Value | What it means |
|---|---|---|
| The probe decides the content | A specific probe (with participants) uses the full acceptance model for that opportunity (`Oracle.probe`), with this week's capacity in place of the monthly baseline | A member says yes to the activity, place, time and reason, not to a person |
| `weekCapacity` | `capacity + N(0, 0.18)`, stable for each member and week | Spare time changes from week to week |
| Identity residual (`PRIMED_MODEL.identity`) | 0.95 | A member who said yes to the probe accepts the reveal with probability 0.95, whoever the others are |
| Ask-primed, want met (`PRIMED_MODEL.met`) | 0.96 | A member who asked for this kind of thing in the last week accepts when the others meet one of their wants (fit 0.8 or more) |
| Ask-primed, partial fit (`PRIMED_MODEL.partial`) | 0.82 | Fit from 0.45 to 0.8 |
| Ask-primed, poor fit | the unprimed fit curve x 0.9 | Fit below 0.45 |
| Exes | 0.05 | Exes almost never accept |
| Enjoyment and show-up | unchanged by priming | Chemistry stays honest: a yes does not make the meeting better |
| Lapsed wants | Off by default: personas can ask for a want that has lapsed in hidden truth. `liveAsksOnly` (`--live-asks`) turns this off. | A requester can decline the match they asked for |
| Time awareness | Off by default. `PolicyOptions.timeAware` and `WorldOptions.timeAware` turn it on ([runbook-simulation.md](runbook-simulation.md) section 6.1.2; `harness/experiment.ts --time-aware`) | With it off, a persona ignores `SimMeta.timeOptions` and `SimMeta.booked`, and the meeting time never changes attendance. With it on, a persona picks the offered times it is free for (hidden weekly availability), treats a booked-plan reveal as opt-out (silence = in; "can't make it" when it would decline or the time clashes), and a participant booked at a clashing time does not come with p = 0.7 |

Consequences:

- **The identity veto sets a ceiling.** With 0.95 per person, a pair where both were probed reaches all-yes with probability 0.95 x 0.95 = 0.9025. A group of 3 reaches 0.857. No Network can do better on those opportunities under this model.
- **Silence counts as a yes on a booked plan.** A persona that ignores the booked plan keeps its own decision: it comes if it decided yes, and stays away if it decided no. The everyone-yes rate counts that decision.
- `PRIMED_MODEL` is mutable for sensitivity runs (`--primed-identity`, `--primed-met`, `--primed-partial`). The results doc reports them.

## 10. Prompt review

This section reviews the prompts that matter for the Network. It gives recommendations only. The engine and simulator prompts belong to other owners; change them with an eval run (`packages/evals`) and a results doc.

### 10.1 Engine judges (`packages/engine/src`)

Today: pass 2 (`judge.ts`) runs with the deep context and the v3 prompt (`JUDGE_SYSTEM_V3`, `pass2Context: "deep"`). Passes 1 (`SCREEN_SYSTEM`) and 3 (`DEEP_SYSTEM`) are off by default and keep their v2 prompts. The judges run only when the engine gets an LLM. The ConsentNetwork calls the engine without one, so no simulator result in [the results doc](results/2026-10-07-network-consent.md) uses a judge.

| # | Finding | Recommendation |
|---|---|---|
| 1 | The compact pass-2 input (`JUDGE_SYSTEM`, used when `pass2Context` is `"compact"`) has no capacity, availability or presence data. It still asks for `capacity_realism` and `timing` scores, so the model guesses. The deep input (the default) has presence, schedule overlap, budgets and recent asks, so this applies to the compact input only. | Give every pass the same logistics block: participation state, budget left this week, presence and trips in the window, schedule overlap. Or drop the two dimensions from the compact prompt. |
| 2 | The shared v3 notes (`JUDGING_NOTES_V3`, used by passes 2 and 3) say acceptance is "reported separately (accept_probability)". Only the pass-1 schema has that field. The pass-2 v3 schema does not, and nothing in the engine reads the pass-1 value. | Add `accept_probability` per person to the pass-2 schema, after the verdict. Use it for ordering (score x mutual accept), never for the verdict. Log it next to the probe outcome so it can be calibrated. |
| 3 | v3 asks the model to name, for each person, which of their own intents the intro serves, but only inside free-text `reasoning`. | Add a required structured field before the verdict: `wants: {"P1": {"intent_ref": "intents[0]", "basis": "stated" | "confirmed" | "inferred"}}`. Reject the verdict when a person has no entry. This matches the Network's `want_not_named` gate, so the judge and the gate agree. |
| 4 | Evidence basis is shown on each fact, but the verdict does not have to state it. | In `cited_facts`, require `basis` for each fact. Make a verdict "yes" invalid when every cited fact for one person is inferred or a hypothesis. |
| 5 | The v2 prompts (`SCREEN_SYSTEM_V2`, `DEEP_SYSTEM_V2`) say "most candidates are NOT good" and add opt-in and age rules that code already enforces. The v1 error analysis found that this made them reject good intros. | When passes 1 and 3 are turned on, use the v3 wording for the shared notes even if the rubric stays v2. |
| 6 | `member_why` and `why` are member-facing text. The Network never uses engine text in a probe, because it can name people. It uses the engine explanation only in the reveal, after it removes every member name (`stripNames`). | Make the member-facing field a named-slot template ("you both want to {intent}") that the Network can fill without stripping. Or drop it from the judges and let the Network build the reveal reason from known facts, as it does for probes. |
| 7 | The prompts say "introduces adults" and list hard policy. That is correct, but minors never reach the judge (code removes them). | Keep the line. Do not add more policy text; it costs tokens and pushes the model toward "no". |

### 10.2 Persona prompt (`packages/sim/src/agent/llmAgent.ts`)

The LLM persona writes the words. The deterministic policy decides accept, decline, ignore and flake. That split is correct (LLM users over-accept).

| # | Finding | Recommendation |
|---|---|---|
| 1 | `personaCard` hardcodes two cities: `homeCity === "sf" ? "San Francisco" : "New York"`. The policy text does the same (`"SF" : "NYC"`). NYC is the only launch city. | Take the city name from one map in `packages/sim` (city id to display name). Do not hardcode SF in new text. |
| 2 | The card lists every hidden desire as "What you actually want", including lapsed ones. The oracle judges only live wants (`withLiveDesires`). The persona can ask for a want it no longer holds. | Build the card from `withLiveDesires(p, now)`. Make `liveAsksOnly` the default after the sim owner re-baselines. |
| 3 | The card says "spare time this month" from `capacity`. The probe model uses `weekCapacity`. | Show this week's capacity, so the text matches the decision. |
| 4 | Done (2026-10-07): the prompt has probe yes and no situations, a time-answer situation that names the offered times that fit, and a "can't make it" situation for booked plans. Menu answers and tapbacks use the template text with no model call. | None. |
| 5 | `worthwhile` is a judgment in the same call that writes the reply, with no explanation first. AGENTS.md says judge prompts write the explanation before the verdict. | Ask for `why_worthwhile` (one sentence) before `worthwhile`, or compute worthwhile in the policy and drop it from the prompt. |

### 10.3 Member-facing copy (`packages/network/src/copy.ts`)

The copy follows PRD 12.4: short, one question, an easy no, opt-out on first contact. `styleViolations()` checks every template in the tests.

| # | Finding | Recommendation |
|---|---|---|
| 1 | `welcome` says the agent will "suggest a person or plan". It does not say that a person reviews suggestions first. | Add "a person on our team checks every suggestion first" while review is on. It sets expectations for the delay. |
| 2 | `requestAck` promises "within a day". With a 12-hour review SLA and a 26-hour probe, a fulfilled request takes a median of 21-30 hours in the simulator. | Say "in the next day or two". |
| 3 | `probe` puts the reason in parentheses at the end. The reason is the strongest part of the ask. | Lead with it: "Someone near Greenpoint also wants a climbing partner. Up for a session this weekend? Yes or no is all I need." Test the change with a probe-yes A/B in the pilot, not in the simulator (the simulator ignores wording). |
| 4 | `booked` (the booked plan, which replaced `reveal`) gives "First L.", the time, the place and the reason, but no way to see more. | Add "Reply WHO to hear a bit more about them" once the member web profile exists (32.17). Not before. |
| 7 | `booked` ends with "Reply if you can't make it." A member who answers with the one word "cancel" is opted out of everything (STOP keyword), not only out of the plan. | Keep the wording away from "cancel". Decide with the STOP/HELP owner (section 11) whether a bare "cancel" inside an open booked plan should cancel the plan instead. |
| 5 | `minorNotice` and `welcomeMinor` say "Since you're under 18". That is clear and correct. | Keep. |
| 6 | `declinedQuiet` does not say who declined (correct, F11, F29). | Keep. |

Copy changes are UI changes. A PR that changes `copy.ts` needs the videos in CONTRIBUTING.md section 3.5.

## 11. Known gaps

- **Production service built, not deployed** (section 1.2). It runs the tick, the inbound webhook and the staff API on Postgres. The Observatory's real mode calls the staff API (runbook-real 4.4). The service records its token, not the signed-in person, as the reviewer of record; the Observatory sends the person in `X-Network-Staff-Id`, which the service does not read yet (admin-console gap 1).
- **The judge and the re-engagement.** `packages/sim/src/judge/metrics.ts` counts a re-engagement as a `two_unanswered` violation. With D6 (30 days plus a held top-quartile item) it cannot fire in runs shorter than 30 days. The message carries `meta.reengagement: true`; the judge should exempt one per silence.
- **Blooio queue wired, never live.** The service's `BlooioAdapter` gives the queue `forbiddenProvider` and `blooioRecipientPolicy` (6.5). It is tested with a fake provider only. No live send has been made.
- **Fixed 2026-10-07: a missing age read as 0.** The Observatory's snapshot builder (now `service/snapshot.ts`) turned a missing age into 0. The age 0 is valid and under 13, so the Network would decline that member and delete their data at their first message. It now stays unknown (6.3). The service test checks it.
- **No calendar source.** CALENDAR records consent to free/busy only (4.2). `AvailabilityEvidence.calendar` stays empty until a free/busy integration exists.
- **Employer rule copied.** The probe check for employer-like values (4.1) copies two regular expressions from the engine's `buildProbe`, because the engine does not export them. The engine owner should export them.
- **Booked plans are often cancelled in the time-aware simulator** (120 of 235, about half; [results/SUMMARY.md](results/SUMMARY.md)). Pilot data must say how often real members cancel.
- **A bare "CANCEL" is STOP.** The simulator channel and the service (`detectKeyword`) treat it as an opt-out from all messages. The booked-plan text invites a reply about cancelling (4.2). The founder must decide the STOP, START and HELP owner before any live send (service README, rule 1).
- **Weekly opt-ins in the simulator depend on an assumption.** With the simulator's plans option on (the default in `harness/experiment.ts` since 2026-10-08), personas answer the WEEKLY offer at the plans harness rate (0.25 + 0.35 x social energy): 55 of about 270 members opted in over 21 days (seed 1). Window priming (a stated window raises the probe yes rate) is also a harness assumption, not a measurement. No persona replies CALENDAR.
- **Opt-out hours not exported.** `OPT_OUT_HOURS` (48) is private to `network.ts`. The Observatory's real mode copies the value (`BOOKED_OPT_OUT_HOURS`); game mode reads it from `SimMeta.booked`.
- **New log kinds in Postgres.** The service writes only the log kinds in the Observatory's `NETWORK_EVENT_KINDS`. That list now includes `send_deferred`, `gate_reason`, `time_answer`, `booked_cancelled`, `availability_stated`, `availability_offer`, `calendar_consent`, `weekly_checkin_consent`, `checkin_sent`, `no_common_time`, `minor_record` and `minor_after_contact`. `gate_reason` adds one row per gated engine proposal per daily run, so `network.events` may need a retention rule.
- **Fixed 2026-10-07 (attention v1.2):** the send timing, cap counting, sequential probes with time options, the booked plan and the logs follow the engine session's reference (sections 4 and 6.4). Deferrals (`send_deferred`), per-proposal gate reasons (`gate_reason`) and the review-mode actor are logged. An edited explanation for a requester reaches their confirm-probe or time question; the leak guard checks it.
- **Fixed 2026-10-07 (probe answers and times):** a refusal with time words ("no, I can't make any of them") was read as a yes to every time, and the partner was booked and both names revealed. A ruled-out time ("yes, not Sunday", "Thursday doesn't work") was picked. The "neither" retry offered the time the member had just turned down, and a plan with no time in common was booked at an "estimated" time nobody picked. All four are fixed (4.1, 4.2); `test/units.test.ts` and `test/flows.test.ts` hold the regressions.
- **Fixed 2026-10-07 (the member record):** the Network read the record once, at first contact. A later staff age correction to under 18, a paused or restricted account, or new quiet hours did not apply. It now reads the record again (6.6).
- **Fixed 2026-10-07 (probe copy):** probes named an interest plus a different want (two facts), raw tags reached members ("climate_tech"), the request probe gave the requester's neighborhood and a broken phrase ("asked me for meet people working in climate"), and skill reasons were broken ("they ha a truck", "they works in climate policy"). The changed texts (`probeForRequest`, the generic hobby activity, the request reasons) need the CONTRIBUTING.md 3.5 videos.
- **A staff-removed account stays in the Network's state.** `loadSnapshot` leaves out `removed` (and `invited`) rows, and the Network keeps the member state it had. Only a paused or restricted status is read (6.6). Removal outside the under-13 decline has no flow yet.
- **New copy needs videos.** `welcomeAskAge`, `welcomeAfterAge`, `requestWaiting`, and the attention v1.2 texts (probes with times, `requestTimes`, `timesRetry`, `booked`, `bookedThanks`, the calendar and weekly texts) are new member-facing text (CONTRIBUTING.md 3.5).
- **Fixed 2026-10-07:** unknown age no longer declines (6.3); approval runs the gates again (2.2); reviewer edit and re-roll are built (2.3); state can be stored (1.1).
- **Engine: plan probes dropped by the leak gate.** `buildPlanProbe` returned null for about a third of plan probe attempts (40 of about 120 in one 21-day run). In every case checked, the only blocked word was "free" from the cost line "Free.", which matched another invitee's private words. A null probe is not sent and counts as a no. The engine owner should exempt the cost words, as the activity and place words already are.
- **Engine copy: crew probes.** Crew session probes read "Your an easy group run crew is on again" (the activity label already has an article). Engine owner.
- **Fixed 2026-10-08: check-in answers were over-read.** `availabilityTags` crossed every named day with every named daypart, so "Tuesday evening and Saturday afternoon" also gave Tuesday afternoon and Saturday evening, and the planner could book them. A part of the day now goes with its own days only (`test/units.test.ts`). The plans results summarized in docs/results/SUMMARY.md ("Network capital events and plans v1.1") were measured before this fix.
- **Plans book few plans in the simulator** (8 booked in 3 seeds x 21 days, no crews). A cold plan probe gets a yes about 1 time in 4, and a plan needs 3 yes. The weekly check-in is offered only once, in a member's first booked plan. Founder decision: also offer it at onboarding.
- **Fraud detection precision is not measured.** The NYC world has no adversarial rings. Only `test/flows.test.ts` exercises fraud items.
- **NC organizing reach applies to crew sessions only.** Planner plans invite at most 6 members, so the "seats above 8" rule never applies to them. The NC owner should confirm this reading.
- **`NetworkState` is still version 1.** The new fields (plans, fraud items) are optional. An older stored state loads with them empty.
- **Apps: the rename and the ages are done** (2026-10-08): `friends` everywhere, 13+ may join every app, matching stays 18+ (`packages/platform/src/apps.ts`, migration 0007).
- **Apps: one NYC engine for all.** Every app runs The Network's engine, NYC places and copy structure (1.3). The slop, peon and friends engine packs come from the engine session.
- **Fixed 2026-10-07:** `feedbackOf()` now checks negations first ("not great" is negative), and duplicate replies are gone (feedback is taken only for a meeting that happened; the same text never goes to one member twice within 10 minutes; venue suggestions rotate). The judge finds 0 `duplicate_send` on seeds 1-3.
