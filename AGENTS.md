# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, Eliza sub-agents, and others) that work in this repository. Human contributors: read [CONTRIBUTING.md](CONTRIBUTING.md). Its rules apply to agents too. This file adds what an agent needs to know.

## Before you start

1. Read [CONTRIBUTING.md](CONTRIBUTING.md). It defines what an acceptable issue and PR is.
2. Read PRD Section 28 (MVP definition) in [docs/prd-snapshot.md](docs/prd-snapshot.md). The canonical PRD is the [Google Doc](https://docs.google.com/document/d/1lLQAZNAMSC_yHCkUBVbp1CCwvyR17PuvV7TnpfuY8Xc/edit). If the two disagree, the Google Doc is correct.
3. Read the README of the package you change (`packages/engine/README.md`, `packages/sim/README.md`) and the newest report for it in [docs/results/](docs/results/).

## Hard rules

- **Stay in the MVP.** Do not build anything that is not in PRD Section 28.3. Never build anything in PRD Section 28.4. If you think the MVP needs a feature, stop and ask a human. A feature becomes in scope only after the founders approve it and add it to the PRD.
- **No busywork.** Do not open issues or PRs for style, naming, comments, extra unit tests, coverage, defensive checks, extra validation, truncation, or refactors with no measured result. Maintainers close them and penalize the contributor.
- **Evidence or nothing.** Every PR shows a fix for something that was definitely broken, a measured score improvement, or an MVP capability that was missing. Show the numbers before and after, with the same command and seed.
- **Simplify first.** Search for an existing type or function before you write one (`rg "<name>" packages`). Extend it or merge it. Remove dead code. Add a new type, file, package, or dependency only when nothing existing can do the job, and say why in the PR.
- **End-to-end validation, not unit-test larp.** Validate with the simulator, the scenarios, the evals, or the Observatory (commands below). A bug fix gets one regression test or scenario that fails before the fix. Do not write tests that only check mocks, repeat the implementation, or test constants.
- **Defend the design.** In the PR, give at least two other implementations and say why yours is better.
- **UI changes need videos.** A PR that changes the Observatory, admin, member web, or member-facing message copy needs a walkthrough video, before/after video evidence, and a step-by-step how-to-test. If you cannot record video, say so and ask a human to record it. Do not mark the PR ready without it.
- **Write in ASD-STE100.** Issues and PRs use Simplified Technical English (CONTRIBUTING.md section 4): short sentences, active voice, one instruction per sentence, PRD terms used the same way every time. A non-technical reader must understand them.

## Code invariants

Do not break these. They are checked in tests and in every simulated run.

- Network code reads time only from `Clock` (`packages/core`). No `Date.now()`, no `new Date()` without an argument, no `Math.random()`. Randomness comes from the seeded RNG.
- Network code never reads hidden persona truth (`Persona.hidden`, the oracle, `hidden_truth.jsonl`). Only `packages/sim` and the judges that run inside the simulator can read it.
- Every proactive proposal must go through human review before any member is contacted (founder decision, below about 1,000 members). **Status:** the engine state machine has the `IN_REVIEW` → `approve` states, but `packages/network` does not use them yet: its proposals go straight to member probes (audit 2026-10-07 P0-1). Do not claim review happens in a run until that is wired.
- Every outbound message must go through the leak check. **Status:** the connector prototype checks every output; the ConsentNetwork and Blooio send paths do not run an inline leak check yet.
- Age policy (`packages/core/src/policy.ts`): under 13 cannot join and is declined kindly with nothing stored; members aged 13-17 can use the agent for themselves (chat, events, things to do) but are never matched or connected to other members. Use `canJoin`, `isMinor` and `canBeMatched`; do not hard-code ages.
- Canary leaks, invariant violations, and minor contacts are always 0. A change that makes any of them non-zero is wrong, whatever else it improves.

## LLMs

- Use `defaultLLM()`, `judgeLLM()` or `recommenderLLM()` from `packages/core/src/llm.ts`. Every use is `gpt-6-luna` on Surplus Intelligence. There is no automatic fallback to OpenAI; `LLM_ALLOW_OPENAI_FALLBACK=1` is an explicit opt-in that logs a warning. Cerebras is optional and legacy. Use `endpointsFor(provider)` to check whether a provider has a key. Do not add a new LLM client or provider.
- Requests time out after 60 s by default (`LLM_TIMEOUT_MS`) and retry at most 4 times (`LLM_MAX_RETRIES`).
- Live (paid, networked) tests run only with `LIVE_TESTS=1`. A key in `.env` is not enough. Gate any new live test with `liveTestsEnabled()` from `packages/core`.
- Judge prompts write the explanation before the verdict.
- Recommendations and judges use the same model (`gpt-6-luna`) with a different prompt or pass. Use a different judge model for audits only, and a cross-family audit needs founder approval (it sends data to another provider).
- Eval responses are cached in `runs/evals/cache/`. Reruns of the same items are free. Use `--limit N` for smoke runs and `--max-spend USD` for the passes suite.

## Commands

```bash
bun install
bun run test                 # all packages and prototypes, offline (live tests need LIVE_TESTS=1)
bun run typecheck

# Simulated world (end-to-end engine check)
bun run packages/sim/src/cli.ts --personas 150 --days 30 --mode discrete --seed 1 --network stub --engine ./packages/sim/engines/engine-v1.ts

# Scenario with pass^k
bun run packages/sim/src/cli.ts --scenario packages/sim/scenarios/stop-keyword.json --k 4

# Model evals
bun run packages/evals/src/cli.ts --suite recommender,judge
bun run packages/evals/src/cli.ts --suite passes

# Observatory (http://localhost:4747)
bun run observatory
bun run observatory:db       # local Postgres on :54339 with a 14-day simulated run
```

## Environment

- Copy `.env.example` to `.env`. Never commit `.env` or anything in `runs/`.
- The local dev Postgres for the Observatory is on port **54339**. Do not touch port 54329; another tool uses it.
- `packages/observatory/db/seed.ts` refuses non-local hosts. Do not pass `--allow-remote` unless a human asks.
- Cloudflare work for ntwrk.love goes through `scripts/wrangler.sh` only. It refuses `deploy` (except `--dry-run`) and other commands that change Cloudflare resources unless `NTWRK_ALLOW_DEPLOY=1` is set. Do not set it without the founder's approval.

## Results

Write experiment results to `docs/results/YYYY-MM-DD-<topic>.md`. Include the command, the seed, the model, the request settings, the sample size, and confidence intervals or significance tests for small differences. Say what is hand-written and what is generated.
