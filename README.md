# The Network

Prototypes, research, and test harnesses for The Network: an invite-only, messaging-first AI that finds and activates the latent potential between people.

- **PRD (canonical):** https://docs.google.com/document/d/1lLQAZNAMSC_yHCkUBVbp1CCwvyR17PuvV7TnpfuY8Xc/edit (local snapshot: [docs/prd-snapshot.md](docs/prd-snapshot.md); MVP is Section 28)
- **Prototype plan:** [docs/prototypes.md](docs/prototypes.md)
- **Test, validation and verification plan:** [docs/test-plan.md](docs/test-plan.md)
- **Research:** [docs/research/](docs/research/)
- **Results:** [docs/results/](docs/results/)
- **Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md) (humans) and [AGENTS.md](AGENTS.md) (AI coding agents)

## Scope

This repository builds the MVP defined in PRD Section 28: one Network agent over iMessage and SMS, an asynchronous matching engine over Postgres, human review of every proactive proposal and every member request, and an admin console. Founder decision (2026-10-07): New York City is the only launch city. The PRD snapshot still says SF and NYC until it is updated. Founder decision (2026-10-08, PRD Section 40): one backend, one admin panel, one database and phone-verified login serve four apps with their own sites: The Network (ntwrk.love), slop.date (dating), peon.biz (hiring) and friends.help (NYC friends). Anyone 13 or older may join any app; matching is 18+ everywhere. One text line serves every app: STOP stops every app, "leave <app>" leaves one. A person can join one app or several. Nothing crosses apps by default. Local dev for all of it: [docs/runbook-platform.md](docs/runbook-platform.md). Anything outside PRD 28.3 and Section 40 is not built until the founders approve it and add it to the PRD. See [CONTRIBUTING.md](CONTRIBUTING.md) for what makes an acceptable issue or pull request.

## What's here

| Path | What it is |
|---|---|
| `packages/core` | Shared contract: domain types, Clock (real/sim), age policy (`policy.ts`), outbound leak guard (`guard.ts`), LLM clients (`defaultLLM()`, `judgeLLM()`, `recommenderLLM()`; 60 s timeout, bounded retries, no silent provider fallback) |
| `packages/engine` | Matching and opportunity engine v1 (PRD 33): filters, generators, retrieval, scoring, LLM judge, group composer, fairness, state machine (with an `IN_REVIEW` state; the ConsentNetwork runs its own review gate), send-time eligibility re-checks, outreach controller, minors policy ([README](packages/engine/README.md)) |
| `packages/network` | ConsentNetwork for NYC: a production-shaped Network that replaces the simulator's StubNetwork. Human review before any member contact (approve, reject, edit, re-roll; the gates run again on approval), consent-first anonymous probes, skeptical gating, request fulfilment, the matching switch, safety classification, trust levels and safety cases, the age policy, outreach rules, the leak guard on every send, and stored state in Postgres (`PgStore`, `runTick` under an advisory lock). Send path from the engine's attention v1.2 reference: one daily send slot per member, only initial invites on the cap, probes one member at a time with 2-3 time options, and a booked plan with a 48-hour opt-out. Plans v1.1 (the planner and a separate plan lane) and network capital ledger events. The `app` option runs it for one of the four apps. The production service (`packages/network/service`: one network per app and city, the tick loops, the Blooio webhooks, the public API for the sites, dry-run sends by default, and a staff API per app for review, safety and the matching switch) is built, not deployed; live Blooio sends need `BLOOIO_ALLOW_SEND=1`, `NTWRK_LIVE_APPROVED=1` and the app's `<APP>_LIVE_APPROVED=1` (founder approval). The simulation harness (experiments, scenarios) is in `packages/network/harness` ([design](docs/network.md), [results](docs/results/2026-10-07-network-consent.md), [send defaults](docs/results/2026-10-07-network-send-defaults.md), [real-side runbook](docs/runbook-real.md)) |
| `packages/sim` | Simulated world: personas with hidden ground truth, oracle, persona agents, channel, virtual-time runner, scenarios, CLI ([README](packages/sim/README.md)) |
| `packages/judge` | Style and safety rules, LLM judges, run metrics |
| `packages/evals` | Model evals: recommender and judge suites, judgment passes, error analysis |
| `packages/observatory` | Simulator, visualizer, game and the first admin console: the NYC world on a map and a graph (game mode, with a review queue, scenario levels and a simulation lab) and the `network` Postgres schema (real-world mode: a read-only database login, member text hidden; review, safety and matching-switch actions go to the Network service's staff API when `NETWORK_SERVICE_URL` is set). An app switcher for the four apps, staff roles per app (`role@app`; tokens, or Cloudflare Access with the Access JWT verified), a cross-app person view for safety only, an audit log, a per-member PII reveal, the member timeline, safety cases, requests, health alerts and the scorecard. `OBSERVATORY_REAL_ONLY=1` turns game mode off. Binds to 127.0.0.1 ([design](docs/observatory.md), [simulation runbook](docs/runbook-simulation.md), [real-side runbook](docs/runbook-real.md)) |
| `packages/platform` | The shared backend for the four apps: people, verified phones, memberships per app, the consent ledger per app (STOP, STOP ALL, START), share grants, person-to-person blocks, web phone login (OTP, sessions), and the public API (`/api/*`) the sites call. Tables in the `platform` schema (migrations 0003-0005, `bun run db:migrate`) ([README](packages/platform/README.md)) |
| `sites/` | The four app sites (ntwrk.love, slop.date, peon.biz, friends.help): agent-first landing pages (the prompt to paste into the person's own AI agent), join, settings and legal pages, one look per app, built as Cloudflare Pages projects with the router as `_worker.js` ([README](sites/README.md), [docs/deploy.md](docs/deploy.md)). The coordinator deploys. |
| `packages/plugin-network` | `@thenetwork/plugin-network`: the Network plugin for the Eliza shared agent (MEMBER_CONTEXT, SET_STATE, NETWORK_SIGNALS, structured state-change routing with deterministic authz). Eliza Cloud consumes it as a `file:` dependency |
| `eliza/` | Git submodule of the Eliza monorepo (Eliza packages are unpublished). Branch `spike/network-plugin` holds the Cloud glue (not yet pushed) |
| `prototypes/poc-*` | Validation PoCs for the technical unknowns: data layer, embeddings, agent LLM path, leak gate, event ingestion, enrichment sources, travel time, Eliza fit ([summary](docs/results/2026-10-06-poc-validation.md)) |
| `prototypes/connector-mcp` | Assistant connector MCP prototype (tools, privacy guard with fuzzy private-fact matching, confirmations). Connectors are not in the MVP (PRD 28.4). Not deployed: `scripts/wrangler.sh` refuses deploys without `NTWRK_ALLOW_DEPLOY=1`. |
| `packages/blooio` | Blooio iMessage/SMS client for the Network line +18087881821: webhooks, STOP/HELP with a durable opt-out ledger, E.164 normalization, quiet hours for every agent-started text, 3-unanswered and 14-day re-engagement limits, per-line caps, send-time eligibility hook, outbound queue |
| `data/synthetic/v1` | 500 synthetic SF/NYC members with hidden truth (generated by `scripts/synthetic`) |
| `reference/eliza-homepage` | Recovered deleted Eliza homepage (MIT), reference only |

## Latest results

- Engine v1 is about 4-5x more precise than random intros in the simulated world (32-35% vs 6-8% precision against the oracle), but the persona-judged worthwhile rate (about 50%) is still below the PRD 28.2 target of 70% ([details](docs/results/2026-10-06-engine-v1-vs-random.md)).
- On the attention v1.2 send path, the consent-first Network gets everyone to say yes on 85% of booked plans (3 seeds pooled, 95% CI 80-89%; silence on a booked plan counts as a yes), against 22% for the same Network without probes and 13% for the stub. It holds 173 meetings in 21 days over 3 seeds (push v2: 188). It does not reach 90%: under the simulator's model the ceiling for a pair is about 90%. Safety counts are 0 on every run ([details](docs/results/2026-10-07-network-consent.md) section 12, [before and after](docs/results/2026-10-07-network-send-defaults.md)).
- `gpt-6-luna` ties `gpt-6.1-sol` on recommender accuracy at about one tenth of the cost, and is the default model for every LLM use ([details](docs/results/2026-10-06-model-comparison.md)).
- The best judgment pipeline (hard gate, then pass 1, then pass 3) raises precision from 55.4% to 62.0% ([details](docs/results/2026-10-06-judge-passes.md)). About a third of its remaining errors cannot be fixed by any judge ([error analysis](docs/results/2026-10-06-luna-error-analysis.md)).

## Setup

```bash
git submodule update --init --filter=blob:none eliza   # Eliza source (large repo; blob-less clone)
(cd eliza && bun install)   # Eliza's own install; packages/plugin-network resolves @elizaos/* through it
cp .env.example .env   # add SURPLUS_API_KEY (and BLOOIO_* for messaging)
bun install
bun run test           # offline: live LLM/network tests are skipped unless LIVE_TESTS=1
bun run typecheck
LIVE_TESTS=1 bun test packages/core   # opt in to live (paid) tests
```

Simulated world, engine v1 against the oracle:

```bash
bun run packages/sim/src/cli.ts --personas 150 --days 30 --mode discrete --seed 1 --network stub --engine ./packages/sim/engines/engine-v1.ts
```

A scenario, repeated k times (pass^k):

```bash
bun run packages/sim/src/cli.ts --scenario packages/sim/scenarios/stop-keyword.json --k 4
```

Model evals (responses are cached under `runs/evals/cache/`, so reruns are free):

```bash
bun run packages/evals/src/cli.ts --suite recommender,judge
bun run packages/evals/src/cli.ts --suite passes
```

The ConsentNetwork on the NYC world (three Networks compared, then the scenarios):

```bash
bun run packages/network/harness/experiment.ts --days 21 --seed 1
bun run packages/network/harness/scenarios.ts [scenario_id]
```

Observatory (simulator, visualizer and game):

```bash
bun run observatory                       # prints http://127.0.0.1:4747/#token=... (the token stays in the fragment); game mode on the 250 NYC members
bun run observatory --review human        # you review what the Network composes
bun run observatory:db                    # local Postgres on :54339 loaded with a 14-day simulated run
NETWORK_DATABASE_URL=postgres://$USER@localhost:54339/network bun run observatory --mode real   # Real world mode
```

The four apps on one backend, locally (dry-run sends; login codes print to the log; [runbook](docs/runbook-platform.md)):

```bash
bun run db:migrate                                                                   # migrations 0001-0005 on the local dev database
NETWORK_DATABASE_URL=postgres://$USER@localhost:54339/platform_dev bun run platform:dev   # dev Postgres, the service, the API on :8790, sites on :5101-5104
bun run sites:dev                                                                    # the four sites only
bun test packages/platform sites
```

All LLM uses (recommender, judge, persona agents, synthetic data, evals) use `gpt-6-luna` on Surplus Intelligence, configured by `DEFAULT_LLM_*`, `JUDGE_*` and `RECOMMENDER_*` in `.env`. Provider names are checked case-insensitively and an unknown name is an error. OpenAI (same model IDs) is the fallback: with no `SURPLUS_API_KEY` every call goes to OpenAI, and a Surplus 429, 5xx, timeout or network error is retried on OpenAI at once. Other 4xx errors do not fall back. Each fallback logs a warning. If neither key is set, a warning is logged at startup. Every request times out after 60 s (`LLM_TIMEOUT_MS`) and retries at most 4 times with capped, jittered backoff (`LLM_MAX_RETRIES`). Cerebras is optional and legacy. OpenAI responses carry no cost, so it is computed from the list prices in `OPENAI_PRICES` (`packages/core/src/llm.ts`, taken from the OpenAI pricing page on 2026-10-06; update them when prices change).

Tests run with `--conditions eliza-source`. `packages/plugin-network` resolves `@elizaos/*` from the submodule through `tsconfig` `paths`, using Eliza's own install. The Eliza packages are deliberately not workspaces of this repo: two installs writing the same `node_modules` split `drizzle-orm` instances and break Eliza Cloud's typecheck. `bun run typecheck` also typechecks the plugin with Eliza's TypeScript 6.

To work on Eliza Cloud with the plugin, run `bun install` inside `eliza/`. Cloud depends on `@thenetwork/plugin-network` through `file:../../../../packages/plugin-network`, so re-run that install after adding files to the plugin; edits to existing files are picked up live. Eliza's turbo refuses workspace packages outside its root, which is why this is a `file:` dependency and not a workspace.
