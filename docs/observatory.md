# The Network Observatory: simulator, visualizer and game

Status: v1 built and verified 2026-10-06 (results: `docs/results/2026-10-06-observatory.md`, in git history at 16cde70). Updated 2026-10-07: NYC map, the consent-first Network, the review queue, hidden member text in real mode, and a new UI. Updated again the same day: staff roles, Cloudflare Access sign-in, the audit log, review edit and re-roll, the member timeline, safety cases, requests, health alerts, the scorecard, the simulation lab, run compare, search and a real-only server (section 9). Updated a third time the same day: real-mode staff actions through the Network service, Cloudflare Access JWT verification, and the attention v1.2 send path (offered times and picks, booked plans, deferrals, gate reasons). Updated 2026-10-08: one console for four apps (ntwrk, slop, peon, buddies): the app switcher, roles per app, a world per app, per-app rows in real mode, and the cross-app person view ([admin-console.md](admin-console.md) 4.6). How to run it: [runbook-simulation.md](runbook-simulation.md) (game mode) and [runbook-real.md](runbook-real.md) (real-world mode). Code: `packages/observatory`. PRD anchors: 34.3 (World Simulator), 34.4 (what the simulator measures), 35 (admin console: social graph explorer, member 360, member perspective timeline, opportunity pipeline, matching run inspector, fairness, simulation lab), 32.1-32.19 (data model).

## 1. What it is

One app that shows everything happening between members of The Network: every person, every connection, every message, every proposal the matching and synchronicity engine makes and why, and every meeting and how it went. It runs in two modes that share one view model and one UI:

| | Game mode (synthetic, "mock") | Real-world mode (production) |
|---|---|---|
| Members | The 250 synthetic NYC members of `data/synthetic/v1` (`--city all` adds the 250 SF members), or a generated world of any size | `network.members` in Postgres |
| Time | Simulated (SimClock): play, pause, step an hour or a day, speed 1 min/s to 2 days/s | Wall clock; polls the database |
| Behaviour | Persona agents decide from hidden truth; the oracle decides how meetings really go | What actually happened (rows in the database) |
| Network | The consent-first Network (`packages/network`, [design](network.md)) by default, or the simple `StubNetwork` (`--network stub`) | What actually happened (rows in the database) |
| Engine | engine-v1 runs once a day for NYC inside the Network; every run log is captured | Shadow mode: run engine-v1 on the current snapshot and show proposals as ghosts; nothing is written |
| Review (PRD 32.8) | Every opportunity the Network composes waits for review. A simulated reviewer approves it (`--review auto`, the default), or staff are the reviewer (`--review human`): approve, reject, edit or re-roll. | `network.review_items` is shown. Decisions go to the Network service's staff API when it is set (`NETWORK_SERVICE_URL`, section 5); the Observatory never writes the table. |
| Staff actions | Review, the matching switch, and safety lift and close act on the simulated Network | The same actions, sent to the Network service's staff API (`NETWORK_SERVICE_URL` and `NETWORK_SERVICE_TOKEN`). Without the service, none: real mode is read-only. |
| Apps | One simulated world per app (ntwrk, slop, peon, friends), started when the app is first opened. Personas below the app's join age do not join. slop and peon run with matching off. | Each app's rows only: the app's read login (`OBSERVATORY_DATABASE_URL_<APP>`, row-level security), or the shared login with an `app_id` filter |
| Hidden truth | Available behind a "truth lens" (desires, romance prefs, flakiness, private disclosures, adversarial flags) | Does not exist |
| Writes | The player acts on the simulated world | None through the database. The connection is read-only (`default_transaction_read_only=on`), PII is scrubbed by default. Staff actions go through the service, which writes. |

The game is the simulator made playable. You can play the Network (matchmaker), play the reviewer (approve or reject what the Network composed), play a member (take over a persona and answer the agent's texts yourself), or play god (inject scenario events). Your play is scored against the engine on the same ground truth.

## 2. Architecture

```
            ┌──────────────── packages/observatory ────────────────┐
 data/      │  sources/game.ts  ── World (packages/sim) ── engine-v1 │
 synthetic ─┤      │   onRecord ─┐                                    │
            │      ▼             ▼                                    │
            │  projector.ts  (RunRecord -> ObsState: members, edges,  │
            │                 opportunities, meetings, feed, stats)   │
            │      ▲                                                  │
 Postgres ──┤  sources/real.ts (network.* rows -> ObsState; shadow    │
 network.*  │                   engine runs; read-only, PII scrubbed) │
            │      │                                                  │
            │  server.ts  Bun.serve: REST + WebSocket deltas + client │
            │      │                                                  │
            │  web/  React: NYC map (Leaflet) + force graph (d3-force)│
            └──────────────────────────────────────────────────────────┘
```

- **One view model (`ObsState`)** for both modes, so every panel works in both. Game mode builds it event-sourced from the simulator's run records (the same JSONL schema the simulator already writes, `packages/core/src/runlog.ts`). Real mode builds it from `network.*` tables.
- **DataSource interface**: `state()`, `member(id, { reveal })`, `timeline(id)`, `opportunity(id)`, `subscribe(listener)`, `control(cmd, actor)`, `inOpenReview(id)`, `safety()`, `safetyAction()`, `config()`, `search(q)`, and `capabilities` (`canStep`, `canIntervene`, `hiddenTruth`, `readOnly`, `staffActions`). Real mode is `readOnly` and has `staffActions` only when the service is set. The server holds one source per mode and switches at runtime.
- **World stepping**: `packages/sim` World gains an additive API: `begin()`, `advanceTo(t)`, `finish()`, `act(action)`, `snapshot()` and an `onRecord` listener. `run()` is unchanged (`begin` + `advanceTo(end)` + `finish`).
- **Engine capture**: game mode wraps engine-v1 so every nightly run's `MatchingRunLog` (funnel, generator counts, rejection reasons, fairness, Lorenz curve, timings, empty states) is kept and shown in the run inspector.
- **Transport**: `GET /api/state` (full), `WS /ws` (batched deltas about 4 times a second: clock, new feed events, changed members, opportunities and edges, stats, and requests and the Network panel when they change), and `GET /api/member/:id`, `/api/member/:id/timeline` and `/api/opportunity/:id` for detail views (loaded only on demand; each load writes an audit row). The full route list is in section 9.

## 3. View model

- `ObsMember`: id, display name, city, area, state, joined, age band, cohort/community, invitedBy, degree, activity counters (messages in/out, proposals, meetings, mean enjoyment), flags (minor, adversarial, opted out, controlled by player), and the availability opt-ins (`calendar`, `weekly`). Game-only: archetype and hidden truth (only in member detail, only when the truth lens is on).
- `ObsEdge`: from, to, type (`knows`, `invited_by`, `vouched_for`, `blocked`, plus the edges the Network learns: `introduced`, `met`, `enjoyed`, `would_interact_again`, `avoid`), strength, createdAt, origin (`graph` or `learned`).
- `ObsOpportunity`: the proposal (kind, generator, category, city, objective, score, 11 score components, explanations), source (`engine`, `player`, `network`, `scenario`, `shadow`), state on the PRD 32.10 state machine (PROPOSED, IN_REVIEW, INVITING, PARTIALLY_ACCEPTED, MUTUALLY_ACCEPTED/QUORUM_MET, SCHEDULED, COMPLETED, FEEDBACK_COLLECTED, DECLINED, EXPIRED, CANCELLED, SKIPPED), per-participant status (pending, invited, accepted, declined, ignored, confirmed, attended, no_show, cancelled_with_notice), meeting time and attendance, the times offered to each member and the keys they picked (`times`; real mode has the keys but not the labels), the booked plan (`booked`: time, 48-hour opt-out, when it reached each member, who called it off), and (game) the oracle verdict: compatible, unsafe, quality, flags. `ObsMessage` carries `timeOptions` and `booked` for probes and booked plans.
- `ObsFeedItem`: time, kind, text, refs (members, opportunity), severity.
- `ObsStats`: members by state and city, messages, proposals by source and state, meetings held, show rate, mean enjoyment, accept rate, precision against the oracle (game), and invariant violations. Game mode also has `stats.judge`: the judge scorer (`computeMetrics` from `packages/sim/src/judge`) runs over the run records at most once per sim hour and gives invariant violations by rule, canary leaks and minor contacts. Real mode has no judge run. Its health alerts count `invariant_violation` events, canary leaks (those events with a leak or canary rule) and minor contacts (messages about an opportunity while the recipient or anyone in it was treated as under 18 by the Network's age state at that moment). Gini and the top-10% share of exposure are in each engine run summary.

Learned edges follow PRD 32.13: delivered invitations to both sides give `introduced`; both showing up gives `met`; mutual enjoyment of at least 0.6 gives `enjoyed`; at least 0.75 gives `would_interact_again`; a showed-up meeting below 0.2 gives `avoid`; blocks give `blocked`.

## 4. Game design

**Roles**

1. *Matchmaker* (you are the Network). Click a member, then "Introduce to…" another (or shift-click 3-6 people for a group), pick a category and write the reason. Your proposal goes through the same Network pipeline as the engine's: the minors policy, blocks, double-booking checks, quiet hours, double opt-in invitations, scheduling, reminders, flakes and feedback. With the consent-first Network your intro joins the review queue with the next morning batch, like every other opportunity (PRD 32.8). With the simulated reviewer it is approved at once; with "You" as the reviewer, approve it in the Review tab. Then it goes through the anonymous probes and every send-time check. A proposal that names a known minor, or a member declined at join, is refused before any spark is used. You get 6 sparks per sim day.
2. *Member* (take over a persona). The world pauses whenever the Network texts your persona and waits for your reply (or let the persona's own policy answer). Your yes or no is what the world acts on, and your attendance commitment counts.
3. *Reviewer* (`--review human`, or switch the reviewer to **You** in the Review tab or in Game → Your run). Every opportunity the Network composes waits in the Review tab. Approve it, or reject it with one of the 8 PRD 32.8 reason codes and a note. Nobody is contacted before you approve. An item past its SLA (12 hours, 1 hour for same-day) expires unsent. Approve is blocked when a participant is under 18 or has an unknown age, and while matching is off. A decision sent while the world steps waits for the step to end.
4. *God*. You can make someone go silent, force a flake, make them say something, opt them out, toggle the engine on or off, or swap it for the random baseline.

**Levels.** The Game tab lists the NYC scenarios (`packages/network/harness/scenarios.ts`) as levels: spam, scams, prompt injection, harassment, block abuse, age signals, an under-13 join, requests, plans, growth and travel. A level restarts the world with its cast and script and shows its checks as it plays. Start one directly with `--level <id>`.

**Fog of war.** By default you see what the Network sees (stated interests, intents, presence and edges). The truth lens reveals hidden ground truth; using it marks your score "assisted". The lens needs the safety or admin role, is on for one staff member only (the others never get the hidden truth, and it is never in the WebSocket deltas), and each switch writes an audit row. An oracle peek on one pair costs 25 points.

**Scoring** (one function, applied to both you and the engine):
- +10 when a participant accepts; −2 when one declines.
- For each completed meeting: + round(100 × mean enjoyment of those who showed); −15 per no-show.
- An unsafe proposal (the oracle says it involves a minor, an adversarial persona, exes or a romance mismatch): −150 and a safety strike. Three strikes ends the run.
- The scoreboard compares you with the engine on total points, points per proposal, precision, accept rate, show rate and mean enjoyment.

**Missions:** First Spark (an intro gets accepted); Good Chemistry (a meeting with mean enjoyment of at least 0.7); Bridge Builder (a meeting across two communities, both enjoying it); Welcome Wagon (a newcomer's first meeting); Dinner Party (a group of 3 or more completes); Do No Harm (7 sim days, no unsafe proposals); Beat the Engine (more points per proposal than engine-v1 after 7 days, with at least 5 proposals).

## 5. Real-world mode

- Connection: `NETWORK_DATABASE_URL` (falls back to `DATABASE_URL`). The schema is `packages/observatory/db/schema.sql`. It is the proposed canonical `network` schema from PRD 32.1, 32.2, 32.4, 32.10, 32.11, 32.13 and 32.19: members, facets, intents, presence, edges, opportunities, participations, messages, feedback, events and matching_runs. Production does not exist yet, so this file is the contract the Eliza Cloud Network module should implement, or map to with views.
- Safety: every session sets `default_transaction_read_only = on`; the adapter only issues SELECT; `channel_identities` (phone, email) is never read. Unless `OBSERVATORY_REVEAL_PII=1` (local use only): names are shown as "First L."; what a member wrote (inbound messages, feedback text) never leaves the database, and the UI shows "[member message hidden]" with its length and time; the agent's texts have phones, emails and canary references masked; agent-private facets are withheld.
- Review: `network.review_items` holds the human-review record of each opportunity (PRD 32.8): queued time, deadline, decision (approve, reject, expired), reason, note, reviewer, origin, seconds spent, edits, re-rolls and why an approval was invalidated. Real mode shows it and never writes it.
- Network state: when `network.network_state` exists (written by `PgStore`, [network.md](network.md) section 1.1), real mode reads the view `network.network_state_console`, never the table: the trust levels, counters, gate reasons, safety cases, the matching switch, the pending deferred sends (kind and type only), how the Network treats each member's age, and the calendar and weekly opt-ins. "Under 18" follows the Network (a stated age, a minor signal, an age conflict, an unknown age), with the record age as a fallback, and so do minor contacts. It also reads `network.requests` and `network.participations`.
- Staff actions: with `NETWORK_SERVICE_URL` and `NETWORK_SERVICE_TOKEN`, review decisions, safety actions and the matching switch go to the Network service's staff API ([runbook-real.md](runbook-real.md) 4.4), and its health shows in the alerts strip. The database login never writes. Without them, real mode is read-only.
- Per-member PII reveal: a safety or admin user can reveal one member for up to 15 minutes, with a reason (section 9). The global `OBSERVATORY_REVEAL_PII=1` is refused when the database is not local.
- Shadow engine: the "Run engine (shadow)" button builds a `WorldSnapshot` from the database and runs engine-v1 with the same code. The proposals appear as ghost arcs and in the run inspector. Nothing is written (PRD 34.6).
- Dev and staging: `db/seed.ts` loads a database from the synthetic dataset, or from a full simulated run (members, edges, every message, opportunity, participation, meeting outcome, feedback and engine run). It refuses non-local hosts unless `--allow-remote`. This makes the parity test possible: play a world in game mode, record it into Postgres, open it in real-world mode, and get the same graph and counts.

## 6. Proof plan (what is verified, and how)

| Claim | Proof |
|---|---|
| World stepping does not change simulator behaviour | test: `run()` and `begin` + stepped `advanceTo` + `finish` produce identical records for the same seed |
| Game mode is deterministic | test: two GameSources with the same seed advanced 3 days produce identical state hashes |
| Projection is correct | tests over hand-built records: opportunity state machine, participant statuses, learned edges, stats |
| Engine runs are captured | test: after a sim day there is a run log for each city in the world, with funnel and fairness, and engine proposals appear as opportunities |
| Player proposals flow through the real pipeline and get scored | test: a player intro is dispatched, invitations go out, and outcomes produce score events; a proposal with a known minor (or a member declined at join) is refused before anything is sent |
| Human review comes first (PRD 32.8) | test: with review "human", Network opportunities wait as IN_REVIEW and nobody is contacted; approve starts probes; reject and SLA expiry send nothing |
| Private facets need the truth lens | test: game-mode member detail shows agent-private facets as "[private]" until the lens is on; over HTTP the lens is safety or admin only, per staff member and audited, and an analyst never gets a member's words from an opportunity |
| Member takeover works | test: a controlled persona's invitation pauses for input, and the player's "yes" becomes an accept |
| Real mode reads Postgres correctly | integration test against a local Postgres: seed from the synthetic dataset; counts and edges match the files |
| Game → DB → real parity | integration test: record a simulated run into Postgres; real-world state equals game state (members, edges by type, opportunities by state, meetings) |
| Real mode is read-only | test: a write through the adapter's connection fails with read-only transaction errors |
| PII is scrubbed | test: no phone, email or canary strings in real-mode API responses; inbound message bodies are not in the API response |
| Server API works in both modes | tests: `/api/state`, `/api/member/:id`, `/api/control`, `/api/mode`, WebSocket deltas |
| Only the local user can use the API | tests: 401 without the token (API and WebSocket); 403 for a foreign Origin or a Host that is not localhost |
| Roles are checked on the server | `staff.test.ts`: 403 per route and per command; analyst is read-only; a reviewer opens only members in an open review item; SSO header rules; `OBSERVATORY_REAL_ONLY` refusals |
| Audit comes first | `staff.test.ts`: the audit row is written before data is returned; tokens are never written; `real-console.test.ts`: `staff_audit` is append-only and the real-mode login cannot write it |
| Review edit and re-roll work through the server | `console.test.ts`: edit leak check, `not_a_participant`, re-roll, seconds summed, reviewer = staff id, the matching switch refuses approve |
| A re-roll is not counted as an approval | `projector.test.ts` regression test |
| Game and real mode agree on the new data | `real-console.test.ts` (Postgres): review items, requests, Network counters and trust, scorecard, timeline, opportunity history, safety cases |
| Real-mode actions go through the Network service | `real-service.test.ts` (Postgres): a reject, a case close and the matching switch reach the real service and are read back; a second decision answers `not_in_review`; the read-only login cannot update; with the service stopped, `service_down` and `service_unavailable`; without the service, `read_only` |
| Cloudflare Access JWT is verified | `staff.test.ts`: a locally signed RS256 token is accepted; a wrong audience or issuer, an expired or future token, no email, a forged signature or a mismatched email header gets 401; keys are cached |
| The send path shows in the console | `console.test.ts` (time-aware world): offered times and picks, the booked plan with its 48-hour opt-out, a cancellation, `send_deferred` and `gate_reason` on the timeline; `real-console.test.ts`: the booked plan and picks match game mode |
| The lab reports the safety counts | `staff.test.ts`: a 1-day consent lab run over HTTP gives judge invariants, canary leaks and minor contacts all 0; at most 2 child processes |
| UI renders and plays | browser check: graph renders, playing advances the clock, the inspector opens, an intro can be proposed, the mode switch works (screenshots in the results doc) |

## 7. The UI

All times are New York time. Controls follow the staff role (section 9): a control the role cannot use is hidden.

| Part | What it does |
|---|---|
| Top bar | Environment banner (`SIM · seed N` or `PROD · read-only`; the full label is in the tooltip), connection dot, clock and play controls (game only; reviewer or safety), search, help (`?`), the role label (tooltip: staff id and sign-in method) and the mode switch (admin only, hidden on a real-only server) |
| Filter bar | Range, borough, members, origin and state group, with Reset. Filters persist per mode in the browser. A filter that does not apply to the open tab is dimmed and its tooltip says so. |
| Map and graph | `g` switches them. The map (Leaflet, OpenStreetMap tiles) shows members at their home neighborhoods, relationships, open opportunities as dashed lines, opportunities in review as dotted purple lines, and meetings at their venues. The graph is a force layout of the same data. |
| Overview alerts | The health alerts, worst first. Each links to its tab. Shown only when there are alerts. |
| Focus | One member, opportunity or neighborhood at a time. It is in the URL (`#m=`, `#o=`, `#n=`), so browser Back works. The focus chip has back and clear. Every name and opportunity id is a link. |
| Inspector | Overview, Member, Opportunity and Neighborhood views. Sections remember open or closed. The Opportunity view has a Times section (the times offered to each member and the ones they picked) and a Booked plan section (the time, and each member's opt-out countdown: 48 hours or until the meeting, and who called it off). The Member view shows Weekly check-in and Calendar consent badges. A member that the role cannot open shows "Your role cannot open this member." |
| Member timeline | Messages and system events in time order, with a mark per event kind. Each outbound message shows "✓ leak check" or "leak check: generic sent". A hidden inbound message shows its length. Sends waiting for the send window or quiet hours are listed below. The send path shows as events: `send_deferred` (what waited and until when), `gate_reason` (an engine proposal the gates stopped, on each member it names), probes with the number of time options and the picks, the booked plan, `booked_cancelled`, the calendar and weekly opt-ins, and the weekly check-in. Admin and safety see "Staff who opened". Detail loads only when the member changes, at most every 3 seconds, because each load is audited. |
| PII reveal | Real mode, safety or admin: type a reason, pick 5, 10 or 15 minutes. A badge counts down while the reveal is on. |
| Drawer tabs | Review (when you are the reviewer and items wait), Feed, Pipeline (with the consent ladder and time in state), Requests, Runs (engine run inspector, gate reasons, "Compare two"), Safety, Metrics (scorecard and growth), Lab (analyst; not on a real-only server), Config (analyst), Game |
| Review tab | Approve, Edit, Re-roll and Reject. `j`/`k` move, `a` approves, `e` edits (one box per participant and one for the plan), `s` then `1`-`6` re-rolls (swaps out that participant), `r` then `1`-`8` rejects with a reason code, `n` adds a note, `x` shows the score, Enter opens the opportunity, Esc steps back. A refusal shows its code under the card. Time spent on a card is sent with the decision (at most 30 minutes). Approve is blocked while matching is off. Pending and Decided views; decided rows show edited, re-rolled N times, time spent, and "stopped on re-check (reason)". Read-only sources cannot decide. |
| Safety tab | Aggregate counts for every role. Safety and admin also see cases (urgent first, due time or "overdue", evidence events), Lift hold and Close case with a note (game mode, and real mode through the service), and the minor-safety view. |
| Requests tab | Requests by outcome, with category, tries, age or hours to fulfil, and a link to the opportunity. Never the member's words. |
| Lab tab | Pick arms, seeds and days, then start a background run. Results show everyone-yes, accept, meetings, judge invariants, canary leaks and minor contacts (red above 0). |
| Config tab | The matching switch (admin; a second click confirms; game mode, and real mode through the service), the review mode, the change history, Network options and outreach numbers (read-only). Admin also sees the audit log. |
| Search | `/` searches members, neighborhoods and ids. Safety and admin can also search conversations (Shift+Enter): the Network's own messages and system events, never member text. Each search is audited. |
| Minors | "Pick for intro" is disabled on a member under 18, and Propose is disabled while one is picked. |
| Token | The page reads `#token=` (the URL fragment, never sent to a server) once, keeps it for the browser session and removes it from the address bar. `?token=` is refused. The WebSocket uses a one-use 30 s ticket (`POST /api/ws-ticket`). Without a valid token it shows "Token required". Behind Cloudflare Access no token is needed. |

## 8. Running it

```bash
bun install
bun run observatory                                        # prints http://127.0.0.1:4747/#token=... (game mode)
bun run observatory --review human                         # you are the reviewer (default: a simulated reviewer)
bun run observatory --level under_13_join                  # play a scenario as a level
bun run observatory --time-aware                           # personas answer offered times from a hidden week (runbook-simulation 6.1.2)
# Real-world mode against a local dev Postgres seeded from a simulated run:
bun run packages/observatory/db/dev-pg.ts up               # local cluster on :54339 + schema
bun run packages/observatory/db/seed.ts --from-sim --days 14
NETWORK_DATABASE_URL=postgres://$USER@localhost:54339/network bun run observatory --mode real
# Real-mode staff actions: also set NETWORK_SERVICE_URL and NETWORK_SERVICE_TOKEN (runbook-real 4.4).
# Production: point NETWORK_DATABASE_URL at a read-only login (role network_observatory) on the
# database that has the network schema, and set OBSERVATORY_REAL_ONLY=1 (section 9.7);
# OBSERVATORY_ENV_LABEL=STAGING names a non-prod environment.
# Four apps: open http://127.0.0.1:4747/#a=slop (or use the app switcher). Per-app tokens:
OBSERVATORY_TOKENS="admin@*:<t>,reviewer@slop:<t>,engineer@*:<t>" bun run observatory
# Real mode per app: OBSERVATORY_DATABASE_URL_SLOP=<a login in network_observatory_slop>;
# the cross-app person view: OBSERVATORY_PLATFORM_DATABASE_URL=<a login in network_observatory_cross_app>.
bun run packages/observatory/src/report.ts --days 14       # headless findings (JSON)
```

Access: the server listens on 127.0.0.1 only (`OBSERVATORY_HOST` changes it). Every `/api/*` route and the `/ws` WebSocket need a staff identity (section 9). With no settings, the server makes a random admin token and prints it at startup. Send a token as `Authorization: Bearer <token>` only (`?token=` is refused; tokens need 32 or more characters). The page `/` is public. The server refuses a `Host` other than localhost and an `Origin` other than its own, unless `OBSERVATORY_ALLOWED_ORIGINS` (comma-separated) lists it.

Controls: space plays or pauses; `n` steps an hour, `d` a day; `/` searches; `?` shows help; `g` switches map and graph; Esc steps back one level (popover, search, picks, focus). Shift-click picks people; double-click fits the graph.

All server options and environment variables: [runbook-simulation.md](runbook-simulation.md) section 2 and [runbook-real.md](runbook-real.md) section 4.

Results and screenshots: `docs/results/2026-10-06-observatory.md` and `docs/results/observatory/`, in git history (16cde70).

## 9. Staff access, audit and the real-only server

Design and gap status: [admin-console.md](admin-console.md) section 4. Code: `src/staff.ts` and `src/server.ts`.

### 9.1 Roles

The roles are `admin`, `reviewer`, `safety`, `analyst`, `engineer` and `cross_app_safety`. Each role is held for one app (`reviewer@slop`) or for every app (`reviewer@*`; a role with no app is `@*`). Admin for an app passes every check for that app. A person can hold more than one role. Four apps, the app switcher and the cross-app person view: [admin-console.md](admin-console.md) section 4.6.

| Role | Can do |
|---|---|
| reviewer | Review decisions. Open members in an open review item. The simulation lab controls. |
| safety | Open any member and its timeline. PII reveal. Safety cases, lift and close (game mode, and real mode through the service). Conversation search. The simulation lab controls. |
| analyst | Read-only. Config tab, Lab tab, shadow runs. Cannot open a member. |
| engineer | Simulated worlds only: the simulation lab controls and the Lab tab. Nothing in real mode. |
| cross_app_safety | The cross-app person view only (`@*` only). No app view. |
| admin | Everything for its app. Review mode, matching switch, reset, audit log. The mode switch needs `admin@*`. |

The full route and command list is in admin-console.md section 4.1.

### 9.2 Sign-in

| Way | Settings | Staff id |
|---|---|---|
| Role tokens | `OBSERVATORY_TOKENS="admin:<t>,reviewer:<t>,safety:<t>,analyst:<t>"`, or per app `reviewer@slop:<t>` (also `<t>:reviewer@slop`). A role with no app is `@*`. A token listed twice holds both roles. An unknown role or app stops the server. | `token:<role>#<8 hex>` (a hash, never the token) |
| Admin token | `OBSERVATORY_TOKEN=<t>` (kept for old setups) | as above |
| Random admin token | Neither setting and no SSO: printed at startup | as above |
| Cloudflare Access (SSO) | `OBSERVATORY_TRUST_CF_ACCESS=1`, `OBSERVATORY_CF_ACCESS_TEAM`, `OBSERVATORY_CF_ACCESS_AUD` and `OBSERVATORY_ROLES="email:role@app,..."` (`email:role` means `@*`; real mode also reads `platform.staff_roles` every minute). The server verifies `Cf-Access-Jwt-Assertion` (RS256 against the team's certs, cached; audience; issuer; `exp`, `nbf`, `iat`) and takes the email from it. A bad or missing token gets 401; an email with no role gets 403. | the email |

`GET /api/me` returns the caller's id, roles, grants (role and app), sign-in way, `realOnly`, the apps the caller holds a role for, and each app's facts (name, join age, matching lock, review reasons, SLA).

### 9.3 Audit

The server writes an audit row before it returns data or acts. If the row cannot be written, it refuses the request (503).

- Audited: member, timeline and opportunity reads; PII reveals; searches; lab runs; safety lift and close; the mode switch; audit reads; every command except clock and view controls (two rows: requested, then the result).
- Sink: the append-only table `network.staff_audit` when `OBSERVATORY_AUDIT_DATABASE_URL` is set. Use a login in role `network_observatory_audit` (insert and select only; triggers refuse update, delete and truncate). Otherwise a JSONL file, `runs/audit/audit.jsonl` (`OBSERVATORY_AUDIT_DIR` changes the folder).
- `GET /api/audit?limit&actor&targetType&targetId` (admin) returns the rows, newest first.

### 9.4 PII reveal

- `POST /api/reveal {memberId, reason, minutes}` (safety). The reason needs 5 or more characters. `minutes` is 1-15 (default 15).
- The reveal is for that staff member and that member only. It covers the member detail and timeline.
- Reveals live in server memory. A restart ends them.
- In game mode a reveal changes nothing (simulated data is not scrubbed), but it is audited.

### 9.5 Other new routes

| Route | Role | What it returns |
|---|---|---|
| Every `/api` route and `/ws` | as listed, for the request's app | `?app=ntwrk\|slop\|peon\|friends` (default ntwrk). An unknown app gets 400 `unknown_app`; no role for the app gets 403. |
| `GET /api/apps/health` | any | One line per app the caller holds: members, review backlog, SLA misses, send failures, matching state |
| `GET /api/person/lookup?app=&member=`, `GET /api/person/:id`, `POST /api/person/:id/open {app, reason}` | `cross_app_safety@*` or `admin@*` | The cross-app person view: memberships, states, holds and blocks; no phone or name. Opening one app's panel needs a reason of 5 or more characters, and the audit row is written first. Real mode only. |
| `GET /api/member/:id/timeline` | safety, or reviewer for a member in open review | Messages and system events in time order, and pending sends |
| `GET`, `POST /api/safety` | safety | Cases, watch, hold, the minor-safety view; `{action: "lift", memberId}` or `{action: "close", caseId}` (game mode; real mode sends it to the service, and returns `read_only` without one) |
| `GET /api/config` | analyst | Matching switch, review mode, Network options, outreach numbers, change history |
| `GET /api/search?q=` | safety | Hits in the Network's messages and system events (2-200 characters) |
| `GET /api/runs/diff?a=&b=` | any | The difference between two engine runs |
| `GET /api/lab`, `POST /api/lab/run` | analyst or engineer | Lab runs of the app; start one with `{arms, seeds, days, app?}` (arms of `push_baseline`, `push_v2`, `consent`; 1-5 seeds; 1-60 days) |
| `POST /api/control` `{type: "review", oppId, decision, reason?, note?, secondsSpent?, explanations?, objective?, swapOut?}` | reviewer | A refusal returns `code`, for example `edit_leak`, `matching_paused`, `busy_elsewhere` |
| `POST /api/control` `{type: "matching", on}` | admin | Turns proactive matching on or off (game mode; real mode through the service's `POST /matching`) |

### 9.6 Simulation lab

The Lab tab and `POST /api/lab/run` start child processes of `packages/network/harness/experiment.ts`, one per seed, at most 2 at a time. Each run records its app; the list shows the app's runs only. Every app runs The Network's NYC world; slop and peon runs get `--max-new 0` (matching off). The rest wait in a queue. Each run is saved to `runs/lab/<id>.json` (written to a temporary file, then renamed) and loaded again at startup. The experiment reports the judge counts per arm. You can run one seed alone:

```bash
bun run packages/network/harness/experiment.ts --only consent --days 1 --seed 1
```

### 9.7 Real-only server

`OBSERVATORY_REAL_ONLY=1` makes a production server:

- It starts in real mode. `POST /api/mode` to game returns `real_only`.
- It refuses the game commands and the lab, and lists no levels.
- The UI hides the mode switch, the game controls and the Lab tab.

The game code is still in the client bundle. The flag turns it off; it does not compile it out.

```bash
OBSERVATORY_REAL_ONLY=1 OBSERVATORY_TOKENS="admin:<t>,reviewer:<t>,safety:<t>,analyst:<t>" \
  NETWORK_DATABASE_URL=postgres://$USER@localhost:54339/network bun run observatory
```

Checked on 2026-10-07 against the local database: `/api/me` returned the reviewer role for the reviewer token; no token gave 401; `POST /api/mode` to game gave `real_only`; `/api/lab` said `enabled: false`; an analyst got 403 on a member; a safety reveal was written to the audit file after the member read.

