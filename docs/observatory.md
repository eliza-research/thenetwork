# The Network Observatory: simulator, visualizer and game

Status: v1 built and verified 2026-10-06 ([results](results/2026-10-06-observatory.md)). Code: `packages/observatory`. PRD anchors: 34.3 (World Simulator), 34.4 (what the simulator measures), 35 (admin console: social graph explorer, member 360, member perspective timeline, opportunity pipeline, matching run inspector, fairness, simulation lab), 32.1-32.19 (data model).

## 1. What it is

One app that shows everything happening between members of The Network: every person, every connection, every message, every proposal the matching and synchronicity engine makes and why, and every meeting and how it went. It runs in two modes that share one view model and one UI:

| | Game mode (synthetic, "mock") | Real-world mode (production) |
|---|---|---|
| Members | 500 synthetic SF/NYC personas (`data/synthetic/v1`), or a generated world of any size | `network.members` in Postgres |
| Time | Simulated (SimClock): play, pause, step an hour or a day, speed 1 min/s to 2 days/s | Wall clock; polls the database |
| Behaviour | Persona agents decide from hidden truth; the oracle decides how meetings really go | What actually happened (rows in the database) |
| Engine | engine-v1 runs nightly per city on the live snapshot; every run log is captured | Shadow mode: run engine-v1 on the current snapshot and show proposals as ghosts; nothing is written |
| Hidden truth | Available behind a "truth lens" (desires, romance prefs, flakiness, private disclosures, adversarial flags) | Does not exist |
| Writes | The player acts on the simulated world | None. The connection is read-only (`default_transaction_read_only=on`), PII is scrubbed by default |

The game is the simulator made playable. You can play the Network (matchmaker), play a member (take over a persona and answer the agent's texts yourself), or play god (inject scenario events). Your play is scored against the engine on the same ground truth.

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
            │  web/  React + Canvas2D force graph (d3-force)          │
            └──────────────────────────────────────────────────────────┘
```

- **One view model (`ObsState`)** for both modes, so every panel works in both. Game mode builds it event-sourced from the simulator's run records (the same JSONL schema the simulator already writes, `packages/judge/src/runlog.ts`). Real mode builds it from `network.*` tables.
- **DataSource interface**: `state()`, `member(id)`, `opportunity(id)`, `subscribe(listener)`, `control(cmd)`, and `capabilities` (`canStep`, `canIntervene`, `hiddenTruth`, `readOnly`). The server holds one source per mode and switches at runtime.
- **World stepping**: `packages/sim` World gains an additive API: `begin()`, `advanceTo(t)`, `finish()`, `act(action)`, `snapshot()` and an `onRecord` listener. `run()` is unchanged (`begin` + `advanceTo(end)` + `finish`).
- **Engine capture**: game mode wraps engine-v1 so every nightly run's `MatchingRunLog` (funnel, generator counts, rejection reasons, fairness, Lorenz curve, timings, empty states) is kept and shown in the run inspector.
- **Transport**: `GET /api/state` (full), `WS /ws` (batched deltas about 4 times a second: clock, new feed events, changed members, opportunities and edges, and stats), and `GET /api/member/:id` / `GET /api/opportunity/:id` for detail views (messages are loaded only on demand).

## 3. View model

- `ObsMember`: id, display name, city, area, state, joined, age band, cohort/community, invitedBy, degree, activity counters (messages in/out, proposals, meetings, mean enjoyment), flags (minor, adversarial, opted out, controlled by player). Game-only: archetype and hidden truth (only in member detail, only when the truth lens is on).
- `ObsEdge`: from, to, type (`knows`, `invited_by`, `vouched_for`, `blocked`, plus the edges the Network learns: `introduced`, `met`, `enjoyed`, `would_interact_again`, `avoid`), strength, createdAt, origin (`graph` or `learned`).
- `ObsOpportunity`: the proposal (kind, generator, category, city, objective, score, 11 score components, explanations), source (`engine`, `player`, `network`, `scenario`, `shadow`), state on the PRD 32.10 state machine (PROPOSED, INVITING, PARTIALLY_ACCEPTED, MUTUALLY_ACCEPTED/QUORUM_MET, SCHEDULED, COMPLETED, FEEDBACK_COLLECTED, DECLINED, EXPIRED, CANCELLED, SKIPPED), per-participant status (pending, invited, accepted, declined, ignored, confirmed, attended, no_show, cancelled_with_notice), meeting time and attendance, and (game) the oracle verdict: compatible, unsafe, quality, flags.
- `ObsFeedItem`: time, kind, text, refs (members, opportunity), severity.
- `ObsStats`: members by state and city, messages, proposals by source and state, meetings held, show rate, mean enjoyment, accept rate, precision against the oracle (game), canary leaks, minor contacts, invariant violations, Gini and top-10% share of exposure.

Learned edges follow PRD 32.13: delivered invitations to both sides give `introduced`; both showing up gives `met`; mutual enjoyment of at least 0.6 gives `enjoyed`; at least 0.75 gives `would_interact_again`; a showed-up meeting below 0.2 gives `avoid`; blocks give `blocked`.

## 4. Game design

**Roles**

1. *Matchmaker* (you are the Network). Click a member, then "Introduce to…" another (or shift-click 3-6 people for a group), pick a category and write the reason. Your proposal goes through the same Network pipeline as the engine's: the minors policy, blocks, double-booking checks, quiet hours, double opt-in invitations, scheduling, reminders, flakes and feedback. You get 6 sparks per sim day.
2. *Member* (take over a persona). The world pauses whenever the Network texts your persona and waits for your reply (or let the persona's own policy answer). Your yes or no is what the world acts on, and your attendance commitment counts.
3. *God*. You can make someone go silent, force a flake, make them say something, opt them out, toggle the engine on or off, or swap it for the random baseline.

**Fog of war.** By default you see what the Network sees (stated interests, intents, presence and edges). The truth lens reveals hidden ground truth; using it marks your score "assisted". An oracle peek on one pair costs 25 points.

**Scoring** (one function, applied to both you and the engine):
- +10 when a participant accepts; −2 when one declines.
- For each completed meeting: + round(100 × mean enjoyment of those who showed); −15 per no-show.
- An unsafe proposal (the oracle says it involves a minor, an adversarial persona, exes or a romance mismatch): −150 and a safety strike. Three strikes ends the run.
- The scoreboard compares you with the engine on total points, points per proposal, precision, accept rate, show rate and mean enjoyment.

**Missions:** First Spark (an intro gets accepted); Good Chemistry (a meeting with mean enjoyment of at least 0.7); Bridge Builder (a meeting across two communities, both enjoying it); Welcome Wagon (a newcomer's first meeting); Dinner Party (a group of 3 or more completes); Do No Harm (7 sim days, no unsafe proposals); Beat the Engine (more points per proposal than engine-v1 after 7 days, with at least 5 proposals).

## 5. Real-world mode

- Connection: `NETWORK_DATABASE_URL` (falls back to `DATABASE_URL`). The schema is `packages/observatory/db/schema.sql`. It is the proposed canonical `network` schema from PRD 32.1, 32.2, 32.4, 32.10, 32.11, 32.13 and 32.19: members, facets, intents, presence, edges, opportunities, participations, messages, feedback, events and matching_runs. Production does not exist yet, so this file is the contract the Eliza Cloud Network module should implement, or map to with views.
- Safety: every session sets `default_transaction_read_only = on`; the adapter only issues SELECT; `channel_identities` (phone, email) is never read; names are shown as "First L." and message bodies have phones and emails masked unless `OBSERVATORY_REVEAL_PII=1`.
- Shadow engine: the "Run engine (shadow)" button builds a `WorldSnapshot` from the database and runs engine-v1 with the same code. The proposals appear as ghost arcs and in the run inspector. Nothing is written (PRD 34.6).
- Dev and staging: `db/seed.ts` loads a database from the synthetic dataset, or from a full simulated run (members, edges, every message, opportunity, participation, meeting outcome, feedback and engine run). It refuses non-local hosts unless `--allow-remote`. This makes the parity test possible: play a world in game mode, record it into Postgres, open it in real-world mode, and get the same graph and counts.

## 6. Proof plan (what is verified, and how)

| Claim | Proof |
|---|---|
| World stepping does not change simulator behaviour | test: `run()` and `begin` + stepped `advanceTo` + `finish` produce identical records for the same seed |
| Game mode is deterministic | test: two GameSources with the same seed advanced 3 days produce identical state hashes |
| Projection is correct | tests over hand-built records: opportunity state machine, participant statuses, learned edges, stats |
| Engine runs are captured | test: after a sim day there is a run log per city with funnel and fairness, and engine proposals appear as opportunities |
| Player proposals flow through the real pipeline and get scored | test: a player intro is dispatched, invitations go out, and outcomes produce score events; an unsafe player proposal (minor) is refused and gets a strike |
| Member takeover works | test: a controlled persona's invitation pauses for input, and the player's "yes" becomes an accept |
| Real mode reads Postgres correctly | integration test against a local Postgres: seed from the synthetic dataset; counts and edges match the files |
| Game → DB → real parity | integration test: record a simulated run into Postgres; real-world state equals game state (members, edges by type, opportunities by state, meetings) |
| Real mode is read-only | test: a write through the adapter's connection fails with read-only transaction errors |
| PII is scrubbed | test: no phone, email or canary strings in real-mode API responses |
| Server API works in both modes | tests: `/api/state`, `/api/member/:id`, `/api/control`, `/api/mode`, WebSocket deltas |
| UI renders and plays | browser check: graph renders, playing advances the clock, the inspector opens, an intro can be proposed, the mode switch works (screenshots in the results doc) |

## 7. Running it

```bash
bun install
bun run packages/observatory/src/server.ts                 # http://localhost:4747 (game mode)
# Real-world mode against a local dev Postgres seeded from a simulated run:
bun run packages/observatory/db/dev-pg.ts up               # local cluster on :54339 + schema
bun run packages/observatory/db/seed.ts --from-sim --days 14
NETWORK_DATABASE_URL=postgres://$USER@localhost:54339/network bun run packages/observatory/src/server.ts
# Production: point NETWORK_DATABASE_URL at a read-only login (role network_observatory) on the
# database that has the network schema; OBSERVATORY_ENV_LABEL=STAGING names a non-prod environment.
bun run packages/observatory/src/report.ts --days 14       # headless findings (JSON)
cd packages/observatory && bun test                        # 24 tests (Postgres tests need a local postgres install)
```

Controls: space plays or pauses; `n` steps an hour, `d` a day; Esc clears the selection. Shift-click picks people; double-click fits the graph.

Results and screenshots: [docs/results/2026-10-06-observatory.md](results/2026-10-06-observatory.md).
