# Technical uncertainty validation: PoC results (2026-10-06)

The PRD (v0.2) and the prototype plan ([prototypes.md](../prototypes.md)) left a set of technical unknowns outside the engine and simulator, which already had extensive coverage. Each one below got a runnable proof of concept with measured results, then a fix pass for what the PoC found. Every folder has a `RESULTS.md` with method, raw numbers and caveats.

Model for all LLM work: `gpt-6-luna` on Surplus. Test data and audits used other model families (claude-sonnet-4.5, gemini-2.5-pro, deepseek-v4-pro) to avoid self-grading. Total LLM and embedding spend: about $15.

## Verdicts

| # | Uncertainty (PRD / plan ref) | PoC | Verdict | Key evidence |
|---|---|---|---|---|
| 1 | One Postgres + pgvector + a jobs table with leases is enough; PGlite can stand in locally (22.1, 31.4, P02) | [poc-data-layer](../../prototypes/poc-data-layer/) | **Yes, with required settings** | Exactly-once over 10k jobs × 8 workers with crashes (1.7k jobs/s); duplicate-opportunity index 500/500 races; city advisory lock 200/200; projections rebuild from events exactly; erasure leaves 0 bytes on disk after the purge job. 37 tests. |
| 2 | Real embeddings are needed for retrieval (22.1 pgvector, 33.5) | [poc-embeddings](../../prototypes/poc-embeddings/) | **No, not now** | OpenAI 3-small/3-large recall@50 is about 49%, the same as hashing and BM25. The losses were ranking and intent expiry; the engine session fixed both in 6d7e6ca (precision 4.1× → 5.1× random, worthwhile 48% → 59%). |
| 3 | The agent LLM path is accurate, safe against injection, fast and affordable (P03, P10, P12) | [poc-agent-llm](../../prototypes/poc-agent-llm/) | **Yes** | Gating extraction P/R 0.995/0.991, 0 false romance opt-ins; action routing 96-100%; 0 injected effects in 300 trials; 0 wrong-thread executions after the attribution rule; p50 about 2 s; about $3/month for 300 members at Surplus prices. 106 offline tests. |
| 4 | An outbound leak gate reaches ≥99.5% recall with ≤2% false positives (R6, P21) | [poc-leak-gate](../../prototypes/poc-leak-gate/) | **Partly** | 98.9% recall on all seeded leaks and 99.87% on leaks an independent audit judged clear. Subtle inference leaks are the gap: human-labelled data is needed. 2.8% of clean messages go to review (reviewer load). The send API only accepts gate-minted messages (compile-time). 57 tests. |
| 5 | We can legitimately ingest ≥200 future events a week per city (32.6, P14) | [poc-event-ingestion](../../prototypes/poc-event-ingestion/) | **Raw count yes, relevance no** | Allowed sources: Cerebral Valley, Luma calendar ICS feeds, NYC Open Data, SFPL, SF Rec & Park. Eventbrite, Meetup and Partiful forbid scraping, so they need partnerships. Normal-week adult events: about 200 SF, 280 NYC, mostly civic. Dedupe P 1.00 / R 0.975 on 79 pairs. |
| 6 | Enrichment can fetch a member's LinkedIn/X URL (32.5, P13) | [poc-enrichment-sources](../../prototypes/poc-enrichment-sources/) | **No: paste-first** | LinkedIn's robots.txt and terms prohibit automated access; X shows only the bio without its paid API. |
| 7 | Travel time can be estimated from coarse H3 cells (16.2, SEC-004, P15) | [poc-travel-time](../../prototypes/poc-travel-time/) | **Yes for walk/bike; car partly; transit unknown** | Within 25% of OSRM: walk 95-100%, bike 85-95%, car NYC 95%, car SF 60% (78% for trips over 10 minutes). Transit not validated. |
| 8 | The Eliza shared agent + Network plugin fits the platform (30, 31, P39) | [poc-eliza-fit](../../prototypes/poc-eliza-fit/) | **Plugin yes; Cloud needs changes; planner routing is a risk** | See below. |
| 9 | Blooio line works for iMessage/SMS (36.1, P40) | existing [messaging-blooio](../../prototypes/messaging-blooio/) | **Account and line live; no real send yet** | Read-only check: key valid; 3 active channels (iMessage/SMS/RCS). The test line's webhook points at an Eliza host. |

## Fixes applied after the PoCs

- **Data layer:**
  - `nearestMembers()` sets `hnsw.ef_search` and `iterative_scan` per transaction, avoids the prepared-plan trap, and falls back to an exact scan if fewer than k rows come back.
  - Per-city partial HNSW indexes (recall 0.99, p50 1.7 ms at 50k).
  - Jobs carry `member_ids`, and a daily physical-purge job rewrites the affected tables and `pg_statistic`.
  - Projections rebuild from triggers on the event log; profile data and engine-learned state live in separate tables.
  - Outbound idempotency keys.
  - The sim uses `ON CONFLICT DO NOTHING` (PGlite dies after about 1.5-3k caught errors; upstream issue drafted in `repro/`).
- **Agent LLM path:**
  - Deterministic thread attribution (wrong-thread executions 28/300 → 0).
  - Nothing is silently dropped: actions confirm, ask or go to a safety hold.
  - Name resolution uses the member's full history.
  - Keyword confirmations (a bare "yes" never shares a number).
  - A deterministic safety-signal check (21/21 recall, 0 false positives on the eval sets).
  - Tighter extraction rules.
- **Leak gate:**
  - Contact details are scrubbed from the LLM prompt, and facts are labelled by owner relative to the recipient.
  - Production `decide()` returns SEND / HOLD_REVIEW / BLOCK.
  - Prompt v3 is the default.
  - Cross-message pattern tracker.
  - Timeouts: 15 s for async outreach; live replies get 8 s with a hedged second request.
- **Engine** (engine session, 6d7e6ca): intent liveness anchored to the snapshot time, plus a reciprocal needs↔offers complementarity term.
- **Eliza Cloud** (branch `spike/network-plugin` in a worktree of the Eliza monorepo, not merged; patch in `poc-eliza-fit/v3-upstream.patch`). Everything is gated to the `network` project:
  - project-scoped agent identity (separate Durable Object and history);
  - invite gate before account creation;
  - STOP/HELP/START at the gateway, with Redis plus a durable Postgres consent ledger;
  - a Twilio proactive delivery path and an inbound reply fence;
  - capability-wall flags for relay, scheduling and concierge;
  - `network` schema migration;
  - Postgres member store wired into the turn;
  - invite acceptance;
  - proactive sends appended to history;
  - an existing `/internal/deliver` receipt-replay 500 fixed for all projects.

## Eliza: real-model turn behaviour

**Platform fit:**
- A Network plugin (MEMBER_CONTEXT provider, SET_STATE action, NETWORK_SIGNALS evaluator) runs inside the real shared-agent turn in Workerd with no framework monkey patches.
- Bundle cost is about 1.4 KiB gzip. Runtime construction overhead is within noise (about 3 ms).

**The real-model problem:** with gpt-6-luna, Eliza's multi-step planner routed availability messages to a general context. SET_STATE committed in only 1 of 20 turns, with up to 7 model calls per turn. Deterministic tests had hidden this, because the fake model always picked the right context.

**Two fixes, compared on 30 messages × 2 runs** (data in [routing-eval.jsonl](../../prototypes/poc-eliza-fit/routing-eval.jsonl)):

| | A: planner + must-call SET_STATE | **B: one structured Stage-1 field (default)** |
|---|---|---|
| Commit rate on state messages | 36/40 | **38/40** |
| False commits on controls | 1/20 | 1/20 |
| Model calls per state turn | 3.5 (max 6) | **1.0 (max 1)** |
| Estimated clean p95 per state turn | 8.5-11.5 s | **4.5-6.9 s** (target < 8 s) |

The network was degraded during the run, so latency is estimated as calls × the clean per-call latency measured in poc-agent-llm.

**Design B fixes, made after the eval** (in `packages/plugin-network`, tests in `test/eval-fixes.test.ts`):
- A proposed `paused` becomes `busy` when the member's own words are busy cues without an explicit stop. This covers all 6 mislabels.
- The member always sees a past-tense confirmation built from what executed, instead of the model's "I'll pause…" text.
- A no-op state change writes no event. This is enforced in the in-memory store and in Cloud's Postgres store, inside the same atomic statement.

**Repository layout** (founder decision 2026-10-07; settles PRD 36.10 and eliza-integration open question 1):
- `plugin-network` lives in this repo as `packages/plugin-network` (`@thenetwork/plugin-network`).
- Eliza is a git submodule at `eliza/`, pinned to a commit, because Eliza's packages are not published. This repo's workspaces include the submodule's `core`, `testing`, `plugin-sql`, `plugin-sqlite` and `plugin-assistant`, and tests run with `--conditions eliza-source`.
- In the other direction, Eliza's workspaces include `../packages/plugin-*`, and Cloud depends on `@thenetwork/plugin-network: workspace:*`. That glob matches nothing in a standalone Eliza checkout, so it is harmless there.
- Cloud keeps only the integration glue: identity scoping, the invite gate, STOP/HELP, the Twilio path, capability-wall flags, `network` migrations, the Postgres store, and per-turn wiring.
- The submodule currently points at the local branch `spike/network-plugin`, which has not been pushed. Others can't check out this superproject commit until that branch is pushed to GitHub.

## What is still unproven, and what each needs

| Item | Why it can't be closed here | Next step |
|---|---|---|
| Real iMessage/SMS round trip, proactive-send reliability, throughput | Needs a dedicated Network line and a human phone (the current line is in use by Eliza) | Get a dedicated Blooio line, run `first-send.ts` to your own phone, capture real webhook fixtures |
| Twilio A2P 10DLC / toll-free verification, voice onboarding | No Twilio account here; approval is a multi-week external process | File the brand and campaign now (launch gate 28.5) |
| Subtle inference leaks (R6) | Labels are model-generated | 200+ human-written inference and timing leaks; pick the prompt on human labels |
| Transit travel time | No free transit router | Google Routes or OpenTripPlanner with GTFS on about 200 pairs per city |
| Relevant-event supply | Allowed sources are mostly civic | Partnerships: Cerebral Valley (lift the feed cap), Luma, Meetup Pro, Eventbrite |
| Workers + Hyperdrive + Railway latency on staging | No staging deploy from this session | Deploy the spike branch to `eliza-cloud-api-staging`; measure provider latency per turn |
| LLM cost at list price | Surplus prices look about 100× below list | Confirm Surplus pricing stability; budget both cases (about $3 vs about $260 a month for 300 members) |
| Sim-to-real gap (R3) | Synthetic people | Shadow mode (P38) and pilot calibration (P43) |
