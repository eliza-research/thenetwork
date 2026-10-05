# The Network

Prototypes, research, and test harnesses for The Network: an invite-only, messaging-first AI that finds and activates the latent potential between people.

- **PRD (canonical):** https://docs.google.com/document/d/1lLQAZNAMSC_yHCkUBVbp1CCwvyR17PuvV7TnpfuY8Xc/edit
- **Prototype plan:** [docs/prototypes.md](docs/prototypes.md)
- **Test, validation and verification plan:** [docs/test-plan.md](docs/test-plan.md)
- **Research:** [docs/research/](docs/research/)

## What's here

| Path | What it is | Status |
|---|---|---|
| `packages/core` | Shared contract: domain types, Clock (real/sim), Cerebras LLM client | Done |
| `packages/engine` | Matching and opportunity engine v1 (PRD 33): filters, 11 generators, scoring, LLM judge, group composer, fairness, state machine, outreach controller | 119 tests |
| `packages/sim` | Simulated world: personas with hidden ground truth, oracle, persona agents, channel, virtual-time runner, scenarios, CLI | Tests green |
| `packages/judge` | Style/safety rules, LLM judges, run metrics | Tests green |
| `prototypes/connector-mcp` | Assistant connector MCP prototype (tools, privacy guard, confirmations) | 24 tests |
| `prototypes/messaging-blooio` | Blooio iMessage/SMS client, webhooks, STOP/HELP, quiet hours, outbound queue | 93 tests |
| `docs/prototypes.md` | All prototypes P01-P43 with exit criteria and build order | |
| `docs/test-plan.md` | Scenarios, personas, invariants, judges, CI, traceability | |
| `docs/research/` | Matching/graphs, Eliza integration, MCP server design, connectors (ChatGPT, Claude, Grok, Muse, others), Blooio, loveofyourlife review | |
| `docs/results/` | Simulation results | |
| `reference/eliza-homepage` | Recovered deleted Eliza homepage (MIT), reference only | |

Latest result: engine v1 is ~4-5x more precise than random intros in the simulated world ([details](docs/results/2026-10-06-engine-v1-vs-random.md)).

## Setup

```bash
cp .env.example .env   # add CEREBRAS_API_KEY
bun install
bun run test                      # all packages and prototypes
bun run packages/sim/src/cli.ts --personas 150 --days 30 --mode discrete --seed 1 --network stub --engine ./packages/sim/engines/engine-v1.ts
```

Testing and validation use Cerebras `qwen-3.8-27b` for now (configured in `.env`); the model will be swapped later.
