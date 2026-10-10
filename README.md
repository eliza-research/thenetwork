# The Network

The code, simulations and research for The Network: an invite-only, messaging-first AI that finds and activates the latent potential between people.

- **PRD (canonical):** https://docs.google.com/document/d/1lLQAZNAMSC_yHCkUBVbp1CCwvyR17PuvV7TnpfuY8Xc/edit (local snapshot: [docs/prd-snapshot.md](docs/prd-snapshot.md); MVP is Section 28; edits not yet applied: [docs/prd-pending-edits.md](docs/prd-pending-edits.md))
- **MVP plan:** [docs/mvp-plan.md](docs/mvp-plan.md)
- **Results:** [docs/results/SUMMARY.md](docs/results/SUMMARY.md) (one page; the latest report per topic is linked from it)
- **Research:** [docs/research/](docs/research/)
- **Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md) (humans) and [AGENTS.md](AGENTS.md) (AI coding agents; it has every command)

## Scope

This repository builds the MVP defined in PRD Section 28: one Network agent over iMessage and SMS, an asynchronous matching engine over Postgres, human review of every proactive proposal and every member request, and an admin console. Founder decision (2026-10-07): New York City is the only launch city. The PRD snapshot still says SF and NYC until it is updated. Founder decision (2026-10-08, PRD Section 40): one backend, one admin panel, one database and phone-verified login serve four apps with their own sites: The Network (ntwrk.party), slop.date (dating), peon.biz (hiring) and friends.help (NYC friends). Anyone 13 or older may join any app; matching is 18+ everywhere. One text line serves every app: STOP stops every app, "leave <app>" leaves one. A person can join one app or several. Nothing crosses apps by default. Local dev for all of it: [docs/runbook-platform.md](docs/runbook-platform.md). Anything outside PRD 28.3 and Section 40 is not built until the founders approve it and add it to the PRD. See [CONTRIBUTING.md](CONTRIBUTING.md) for what makes an acceptable issue or pull request.

## What's here

| Path | What it is |
|---|---|
| `packages/core` | Shared contract: domain types, Clock, local time, seeded RNG, the age policy (`policy.ts`), the outbound leak guard (`guard.ts`), the reply and opt-out parsers with the one STOP / HELP / START keyword table (`replies.ts`), the Network-environment contract and run-log schema (`network.ts`, `runlog.ts`), and the LLM clients (`defaultLLM()`, `judgeLLM()`, `recommenderLLM()`) |
| `packages/engine` | Matching and opportunity engine (PRD 33) with app packs for The Network, slop.date, peon.biz and friends.help: filters, generators, retrieval, scoring, LLM judge passes, group composer, fairness, attention budget, planner ([README](packages/engine/README.md)) |
| `packages/network` | ConsentNetwork: human review before any member contact, consent-first anonymous probes, request fulfilment, safety and trust, the age policy, the outreach rules (`src/outreach.ts`, the one source of the budgets), the leak guard on every send, Postgres state. `service/` is the production service (one network per app and city, Blooio webhooks, the public API, a staff API); it sends dry-run unless `BLOOIO_ALLOW_SEND=1` and the founder's live approvals are set. `harness/` holds its simulations ([design](docs/network.md), [real-side runbook](docs/runbook-real.md)) |
| `packages/sim` | The simulator: the Network world (personas with hidden truth, oracle, persona agents, channel, virtual-time runner, scenarios), the per-app worlds in `src/apps/{slop,peon,friends}`, and the judge that grades runs (`src/judge`) ([README](packages/sim/README.md)) |
| `packages/capital` | Network-capital ledger and its simulation (`experiments/run.ts`) |
| `packages/blooio` | Blooio iMessage/SMS channel: client, signed webhooks, the consent ledger, E.164 normalization, quiet hours, conversation and line limits, the outbound queue with the send-time eligibility hook and the leak guard. The Network line is +18087881821 ([README](packages/blooio/README.md)) |
| `packages/notify` | The single inbox and the delivery scheduler ([README](packages/notify/README.md)) |
| `packages/platform` | The shared backend for the four apps: people, verified phones, memberships, the consent ledger per app, blocks, phone login, and the public API the sites call ([README](packages/platform/README.md)) |
| `packages/mcp` | The remote MCP server and its OAuth for the sites' agent-first sign-up |
| `packages/observatory` | Admin console, simulator visualizer and game, the dev Postgres and the migrations ([design](docs/observatory.md), [admin console](docs/admin-console.md), [simulation runbook](docs/runbook-simulation.md)) |
| `sites/` | The four app sites (ntwrk.party, slop.date, peon.biz, friends.help), built as Cloudflare Pages projects with the router as `_worker.js` ([README](sites/README.md), [deploy](docs/deploy.md)) |
| `plugins/` | The agent plugins (OpenAI and Claude manifests, SKILL.md), generated from `sites/` and checked by `bun run plugins/build.ts --check` |
| `packages/core/src/svc` | Mirror of the Eliza service contract (`contract.ts`, `svc-auth.ts`). The Eliza side lives upstream as `@elizaos/plugin-network` in elizaOS/eliza (`plugins/plugin-network`); keep both copies byte-identical and bump `CONTRACT_VERSION` together |
| `deploy/` | The shared backend image (Railway), the Pages router and the post-deploy smoke ([docs/deploy.md](docs/deploy.md)) |
| `evals/` | Hand-written corpora (consent replies, abuse, teen ages, wants, areas, opt-outs, leak evasions), scored by `bun run sim` |
| `scripts/` | `sim.ts` (the validation command), dev servers, the wrangler wrapper, the synthetic-data scripts |
| `data/synthetic/v1` | 500 synthetic SF/NYC members with hidden truth (generated by `scripts/synthetic`; [README](data/synthetic/README.md)) |

## Validation

The validation layer is the simulations plus integration and e2e tests; there are no unit or smoke tests ([docs/tests-policy.md](docs/tests-policy.md)). `bun run sim` runs every simulation, offline and deterministic (no LLM, no Postgres), and exits non-zero on any blocking gate failure. The integration and e2e suites need the dev Postgres (`bun run packages/observatory/db/dev-pg.ts up`, port 54339):

```bash
bun install
bun run sim                  # evals, network, slop, peon, friends on pinned seeds
bun run sim --only slop      # one block; --quick for a short local run; --with-capital adds the slow capital block
bun run typecheck
bun run test:integration     # real Postgres, real HTTP servers, the full service; includes the security suite
bun run test:e2e             # tests/e2e: the platform and notify end to end
```

See [AGENTS.md](AGENTS.md) for every other command (the observatory, the four apps locally, the world CLIs) and the LLM settings.

## Setup

```bash
cp .env.example .env        # add SURPLUS_API_KEY (and BLOOIO_* for messaging)
bun install
bun run sim
```

The simulations run with `--conditions eliza-source`.

The Eliza side of The Network (gateway takeover, Cloud plumbing, `@elizaos/plugin-network`) is developed in elizaOS/eliza, branch `spike/network-plugin`. This repo talks to it only over the signed `/internal/*` contract in `packages/core/src/svc/`.
