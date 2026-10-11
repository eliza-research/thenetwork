# The Network

The code, simulations and research for The Network: a messaging-first AI that finds and activates the latent potential between people. Its agent is Eliza.

## Slop bounty

This repository is a [Slop](https://slop.cash) bounty repository with a monthly pool of 1,000 USDC. Maintainers accept outcomes on GitHub. Slop scores accepted merges and pays the pool in USDC after maintainer review. Nothing is guaranteed or held in escrow.

Before you start, read [CONTRIBUTING.md](CONTRIBUTING.md). In short:

1. **First step: star and fork this repository** with your own GitHub account (required for project tracking). Work from your fork.
2. The PRD and the MVP plan are binding. Work only inside them.
3. Accepted: reproduced bug fixes, validation of the matching algorithm and the simulations, measured quality improvements (hill-climbing), security fixes, and tests that prove real behavior.
4. Not accepted: UI, style or copy changes, preference refactors, speculative features, busywork tests, mock-only proof, placeholders and unverified claims.
5. Evidence must use real LLM calls and real agent clients (Claude Code, Codex or ChatGPT, Hermes Agent, OpenClaw, Muse, Grok, elizaOS, Cursor and others).

AI coding agents: read [AGENTS.md](AGENTS.md).

## Scope

| Document | Where |
|---|---|
| PRD (canonical) | [Google Doc](https://docs.google.com/document/d/1lLQAZNAMSC_yHCkUBVbp1CCwvyR17PuvV7TnpfuY8Xc/edit). MVP is Section 28. The platform is Section 40. |
| PRD local copy and pending edits | [docs/prd-snapshot.md](docs/prd-snapshot.md), [docs/prd-pending-edits.md](docs/prd-pending-edits.md) |
| MVP plan | [docs/mvp-plan.md](docs/mvp-plan.md), status detail in [docs/mvp-gaps.md](docs/mvp-gaps.md) |
| Founder decisions after the snapshot | [AGENTS.md](AGENTS.md) |
| Results | [docs/results/SUMMARY.md](docs/results/SUMMARY.md) |
| Research | [docs/research/](docs/research/) |

The MVP is one backend, one admin console, one Postgres database and one phone-verified login for four apps: The Network (ntwrk.party), slop.date (dating), peon.biz (hiring) and friends.help (NYC friends). New York City is the only launch city. People aged 13 or more may join. Matching is 18+ everywhere. One text line serves every app. A person reviews every proactive proposal and every member request. Anything outside PRD 28.3 and Section 40 is not built until the founders approve it and add it to the PRD.

## What's here

| Path | What it is |
|---|---|
| `packages/core` | Shared contract: domain types, `Clock`, seeded RNG, the age policy (`policy.ts`), the outbound leak guard (`guard.ts`), the reply and opt-out parsers (`replies.ts`), the run-log schema, and the LLM clients (`llm.ts`) |
| `packages/engine` | The matching and opportunity engine (PRD 33) with one pack per app: filters, retrieval, generators, scoring, LLM judge passes, group composer, fairness, attention budget ([README](packages/engine/README.md)) |
| `packages/network` | The ConsentNetwork: human review before any member contact, consent-first probes, request fulfilment, safety and trust, the leak guard on every send, Postgres state. `service/` is the production service. `harness/` holds its simulations ([design](docs/network.md)) |
| `packages/sim` | The simulator: personas with hidden truth, the oracle, persona agents, the per-app worlds (`src/apps`) and the judge ([README](packages/sim/README.md)) |
| `packages/capital` | The network-capital ledger and its simulation |
| `packages/blooio` | The Blooio iMessage and SMS channel and its outbound queue ([README](packages/blooio/README.md)) |
| `packages/notify` | The single inbox and the delivery scheduler ([README](packages/notify/README.md)) |
| `packages/platform` | The shared backend for the four apps: people, phones, memberships, consent, blocks, login and the public API ([README](packages/platform/README.md)) |
| `packages/mcp` | The remote MCP server and its OAuth for agent-first sign-up ([README](packages/mcp/README.md)) |
| `packages/observatory` | The admin console, the simulator visualizer, the dev Postgres and the migrations ([design](docs/observatory.md)) |
| `packages/core/src/svc` | Byte-identical mirror of the Eliza service contract. The Eliza side is `@elizaos/plugin-network` in elizaOS/eliza |
| `sites/` | The four app sites and their `SKILL.md` files ([README](sites/README.md)) |
| `plugins/` | The Claude and OpenAI agent plugins, generated from `sites/` ([README](plugins/README.md)) |
| `deploy/` | The backend image, the Pages router, the backup job and the post-deploy check ([docs/deploy.md](docs/deploy.md)) |
| `evals/` | Hand-written corpora, scored by `bun run sim` |
| `scripts/` | `sim.ts` (the validation command), `relay-eval.ts`, `clef-fit.ts`, the dev servers and the synthetic-data scripts |
| `data/synthetic/v1` | 500 synthetic members with hidden truth ([README](data/synthetic/README.md)) |

## Setup and validation

You need Bun 1.4.2 and PostgreSQL 16. [CONTRIBUTING.md](CONTRIBUTING.md) section 5 lists every environment variable.

```bash
cp .env.example .env                                  # never commit .env
bun install --frozen-lockfile
bun run packages/observatory/db/dev-pg.ts up          # dev Postgres on localhost:54339
bun run sim                                           # every simulation, offline, no LLM; exits 1 on a blocking gate
bun run typecheck
bun run test:integration                              # real Postgres and HTTP; includes the security suite
bun run test:e2e                                      # tests/e2e
```

There are no unit or smoke tests ([docs/tests-policy.md](docs/tests-policy.md)). Runs with real LLM calls and the matching-algorithm measurements are in [CONTRIBUTING.md](CONTRIBUTING.md) section 7. [AGENTS.md](AGENTS.md) has every other command.

## The Eliza seam

The member conversation runs in Eliza, upstream in elizaOS/eliza (`plugins/plugin-network`). This repository has no plugin package and no eliza submodule. It talks to Eliza only over the signed contract mirrored in `packages/core/src/svc/contract.ts` and `svc-auth.ts`: `/internal/turn`, `/internal/turn-receipt`, `/internal/set-state`, `/internal/signals`, `/internal/updates` and `/internal/relay` on this backend, and `/api/internal/network/deliver` on Eliza Cloud.

## License

This repository has no license file. Ask a maintainer about license terms.
