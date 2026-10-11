# Contributing to The Network

Read this document before you open an issue or a pull request (PR). Maintainers close issues and PRs that do not obey these rules. AI coding agents must also read [AGENTS.md](AGENTS.md).

## 0. The Slop bounty

This repository is a Slop bounty repository with a monthly pool of 1,000 USDC. [Slop](https://slop.cash) scores accepted merges.

- GitHub is the authority. Maintainers accept or reject each outcome in this repository.
- Slop scores merged work only. Opened issues, comments and closed PRs get no score.
- Slop pays the pool in USDC after maintainer review of the monthly allocation. Nothing is guaranteed. Nothing is held in escrow.

## 1. First step: star and fork

**Do this first. It is required for project tracking (approved by counsel).**

1. Star this repository with your own GitHub account.
2. Fork this repository to your own GitHub account.
3. Do all work on a branch in your fork. Open your PR from the fork into `main`.

You can use the GitHub web page, browser automation, computer use or the GitHub CLI:

```bash
gh api -X PUT user/starred/eliza-research/thenetwork
gh repo fork eliza-research/thenetwork --clone
```

## 2. Scope: the PRD and the MVP plan are binding

Two documents define the minimum viable product (MVP). Work only inside them.

| Document | Where |
|---|---|
| PRD (product requirements document), canonical | [Google Doc](https://docs.google.com/document/d/1lLQAZNAMSC_yHCkUBVbp1CCwvyR17PuvV7TnpfuY8Xc/edit). Section 28 is the MVP. Section 29 lists the MVP flows. Section 37 is the build plan. Section 40 is the four-app platform. |
| PRD local copy | [docs/prd-snapshot.md](docs/prd-snapshot.md). If it disagrees with the Google Doc, the Google Doc is correct. |
| PRD edits not yet applied | [docs/prd-pending-edits.md](docs/prd-pending-edits.md) |
| MVP plan | [docs/mvp-plan.md](docs/mvp-plan.md), with the status detail in [docs/mvp-gaps.md](docs/mvp-gaps.md) |
| Founder decisions after the snapshot | [AGENTS.md](AGENTS.md), "Platform decisions" and "Founder decisions" |

Rules:

- If a capability is not in PRD Section 28.3 or Section 40, it is not in the MVP. PRD Section 28.4 lists capabilities that are not in the MVP. Do not build them.
- If the documents do not clearly cover your change, ask a maintainer in the issue. Start work only after a maintainer confirms the scope in writing.
- **New features need human approval first.** Maintainers discuss a new feature with the founders. If they agree, they add it to the PRD and the MVP plan. Only then can a contributor build it. An issue or a PR cannot add a feature by itself.

## 3. What is accepted and what is not

### 3.1 Accepted

| Kind of work | What it must show |
|---|---|
| **A real bug fix** | You reproduced the bug first. The PR shows it broken before the change and correct after the change. |
| **Validation of the matching algorithm** | A measured result from the simulations or the real LLM path (section 7). The same seeds and command before and after. |
| **Measured quality improvement (hill-climbing)** | A score from section 10 goes up, and no safety gate gets worse (section 7.3). |
| **Validation of simulations and core algorithms** | Proof that a simulation, a gate, the oracle (the simulator's hidden answer key) or a judge measures the wrong thing, and the fix. |
| **Security** | A reproduced weakness and its fix, with a security-suite case that fails before the fix. |
| **Tests that prove real behavior** | A sim gate, a scenario, a corpus row in `evals/`, or an integration or e2e case that fails before the fix and passes after it. |
| **A missing MVP capability** | The PRD or MVP plan requires it, and the code does not have it. Give the section number. |

### 3.2 Not accepted

Maintainers close these. They can penalize the contributor under the project contribution policy.

- UI, visual, style or copy changes (section 9).
- Refactors for preference, renames, file moves and comment edits with no bug and no measured result.
- Speculative features, and new features without approved PRD and MVP-plan updates.
- Busywork tests: unit tests, smoke tests, coverage-only tests, tests that repeat the implementation. See [docs/tests-policy.md](docs/tests-policy.md).
- Proof that uses only mocked LLM output.
- Defensive code, extra validation, null checks or truncation for conditions that cannot occur.
- Placeholder code, TODOs, stubs and dead controls.
- Claims with no evidence. Vague issues ("improve matching").
- Duplicates of an open issue or PR. Search first.
- Secrets, `.env` files, `runs/` output or real member data in a commit.

## 4. Setup

You need [Bun](https://bun.sh) 1.4.2 (the version in `package.json`) and PostgreSQL 16 server and client programs on your PATH (`initdb`, `pg_ctl`, `psql`). On macOS: `brew install postgresql@16`.

```bash
cp .env.example .env                                   # never commit .env
bun install --frozen-lockfile
bun run packages/observatory/db/dev-pg.ts up           # the dev Postgres on localhost:54339
bun run sim                                            # must pass before you start
```

Caution: do not use port 54329. Another tool uses it.

## 5. Environment variables

Put your values in `.env` only. `.env` is in `.gitignore`. [.env.example](.env.example) has every name with no secret values. This table comes from a search of the code for `process.env`, `Bun.env` and every `env.<NAME>` read. It lists the variables you need to test and validate. The deploy-only variables are in section 5.2.

### 5.1 Variables for testing and validation

| Name | Purpose | Required for | Where to get it |
|---|---|---|---|
| `SURPLUS_API_KEY` | Key for the default LLM provider, Surplus Intelligence (`gpt-6-luna`). Read by `packages/core/src/llm.ts`. | Every real-LLM run (section 7.2). You need this key or `OPENAI_API_KEY`. | surplusintelligence.ai account |
| `SURPLUS_BASE_URL` | Surplus API base URL. Default `https://api.surplusintelligence.ai/v1`. | Optional | Leave the default |
| `OPENAI_API_KEY` | OpenAI key. Used alone when `SURPLUS_API_KEY` is empty. Also the fallback when Surplus answers 408, 429, 5xx or times out. | Real-LLM runs, if you have no Surplus key | platform.openai.com |
| `OPENAI_BASE_URL` | OpenAI API base URL. Default `https://api.openai.com/v1`. | Optional | Leave the default |
| `DEFAULT_LLM_PROVIDER`, `DEFAULT_LLM_MODEL` | Provider (`surplus` or `openai`) and model for `defaultLLM()`: LLM persona agents, LLM persona bios, the onboarding LLM arm. Default `surplus`, `gpt-6-luna`. | Optional | Leave the defaults |
| `JUDGE_PROVIDER`, `JUDGE_MODEL` | Provider and model for `judgeLLM()`: the sim's message-quality and privacy judges (`--judge N`). | Optional | Leave the defaults |
| `RECOMMENDER_PROVIDER`, `RECOMMENDER_MODEL` | Provider and model for `recommenderLLM()`: the engine's judge passes. | Optional | Leave the defaults |
| `LLM_TIMEOUT_MS` | Timeout of one LLM request. Default 60000. 0 turns it off. | Optional | |
| `LLM_MAX_RETRIES` | Retries per LLM call. Default 4. | Optional | |
| `LLM_DEADLINE_MS` | Limit for one call with all its retries. Default 3 times the timeout. 0 turns it off. | Optional | |
| `CLOUDFLARE_AI_TOKEN` | Cloudflare Workers AI token for Clef: the slop.date photo rater and the relay scam classifier. | `bun run relay-eval --live`, `bun run clef features --live`, live photo rating | Cloudflare dashboard, API token with Workers AI permission |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account of the Workers AI token. `scripts/wrangler.sh` also needs it. | With `CLOUDFLARE_AI_TOKEN` | Cloudflare dashboard |
| `CLEF_MODEL` | Photo rater model: `clef` (default) or `clef-flash`. | Optional | |
| `RELAY_CLEF_MODEL` | Relay classifier model: `clef-flash` (default) or `clef`. | Optional | |
| `CLEF_RATINGS` | Photo ratings. Unset or `on` means on. `off` turns them off. | Optional | |
| `CLEF_WEIGHTS_PATH` | A fitted Clef weights file. Unset uses the placeholder weights. A file with no version and provenance is refused. | Optional | `bun run clef fit` output |
| `OBSERVATORY_PG_PORT`, `OBSERVATORY_PG_DIR` | Port (default 54339) and data folder (default `runs/pg`) of the dev Postgres. The integration and e2e tests use it. | Optional | |
| `PG_BIN_DIR` | Folder of the Postgres client programs, if they are not on PATH. | Optional | |
| `REQUIRE_PG` | `1` makes a Postgres test or sim block fail instead of skip when there is no Postgres. CI sets it. | Optional. Set it to prove that no Postgres case skipped. | |
| `NETWORK_DATABASE_URL` | The Postgres database of the service. `bun run platform:dev` and `bun run db:migrate` need a local one. | Platform dev (section 8) | `postgres://$USER@localhost:54339/<your db>` |
| `DATABASE_URL` | Fallback database URL for the Observatory and the backend. | Optional | |
| `PLATFORM_ENV` | `dev`, `staging` or `production`. `platform:dev` sets `dev`. Never set `production` locally. | Set by the dev scripts | |
| `NETWORK_SERVICE_TOKENS` | Staff tokens (`role@app:token`, comma-separated). `platform:dev` prints dev tokens when it is unset. | Optional | Make your own |
| `OBSERVATORY_TOKEN` | Admin token of the local Observatory. A random one is printed when it is unset. | Optional | |
| `PIPELINE_DEBUG` | Any value prints the steps of the `pipeline` sim block. | Optional | |

`bun run sim` deletes `SURPLUS_API_KEY`, `OPENAI_API_KEY` and `CLOUDFLARE_AI_TOKEN` from its own process before it starts (except the onboarding arm with `--llm`). So the offline gates never call a model, even when your `.env` has keys.

### 5.2 Variables you must not set locally

- **Live sends.** `BLOOIO_ALLOW_SEND`, `NTWRK_LIVE_APPROVED`, `<APP>_LIVE_APPROVED` (for example `SLOP_LIVE_APPROVED`) and `NETWORK_CHANNEL`. Without them every send is dry-run. Real texts go to real people. Only the founder approves live sends.
- **Deploys.** `NTWRK_ALLOW_DEPLOY`. `scripts/wrangler.sh` refuses a deploy without it. Only the founder approves deploys.
- **Production secrets and operations.** `BLOOIO_API_KEY`, `BLOOIO_WEBHOOK_SECRET`, `TWILIO_*`, `TURNSTILE_*`, `PLATFORM_HASH_KEY`, `LEAK_LABEL_KEY`, `PLATFORM_PROXY_SECRET`, `PLATFORM_SESSION_SECRET`, `SERVICE_TURN_SECRET`, `MIGRATION_DATABASE_URL`, `R2_*`, `ALERT_*`, `OPS_*`, `COST_*`, `BACKUP_*`, `OBSERVATORY_CF_ACCESS_*` and the other names in [docs/deploy.md](docs/deploy.md) sections 2.3, 7 and 8. The dev scripts make safe local values where they need one.

## 6. The validation layer

The validation layer is the simulations plus the integration and e2e tests ([docs/tests-policy.md](docs/tests-policy.md)). There are no unit tests and no smoke tests. Do not add any.

| Command | What it does | Needs |
|---|---|---|
| `bun run sim` | Every simulation block on pinned seeds: the `evals/` corpora, onboarding, the Network, slop, relay, peon, friends, Clef, safety, ops, pipeline and audit. Exits 1 when a blocking gate fails. Offline. No LLM. | Dev Postgres for the safety, ops, pipeline and audit blocks (they skip without it) |
| `bun run sim --only <block>` | One block. You can repeat `--only`. Use it while you work. | |
| `bun run sim --quick` | Fewer seeds and shorter runs. Quality gates become tracked. | |
| `bun run sim --with-capital` | Adds the slow network-capital block. | |
| `bun run typecheck` | TypeScript for the packages, deploy, tests, scripts and sites. | |
| `bun run test:integration` | Real Postgres, real HTTP servers, the full service. Includes the security suite. | Dev Postgres |
| `bun run security` | The security suite alone (the file list is in AGENTS.md). | Dev Postgres |
| `bun run test:e2e` | `tests/e2e`: the platform and notify through the running service. | Dev Postgres |
| `bun run plugins/build.ts --check` | The plugin snapshots match `sites/skills`. | |
| `bun run sites:build` | The production build of the four sites. | |

CI (`.github/workflows/ci.yml`) runs all of these with no secrets. CI never calls an LLM. So your PR must also show a real-LLM run (section 7.2).

## 7. Validate the matching algorithm

### 7.1 How matching works

The engine is in `packages/engine` ([README](packages/engine/README.md)). For each app, a pack (`src/packs/<app>/`) supplies the rules, generators and scoring hooks. One engine run does these steps:

1. Hard filters (`filters.ts`). Minors are never in any role. Blocks, holds, budgets and opt-ins are applied.
2. Retrieval (`retrieval.ts`). Semantic, tag and two-hop graph channels, with an exposure floor for new and low-exposure members.
3. Generators. They propose pairs and groups (`group.ts` for 3-6 people).
4. Scoring (`scoring.ts`). NetValue, floors and thresholds.
5. Optional LLM judge passes (`judgeScreen.ts`, `judge.ts`, `judgeDeep.ts`) on `recommenderLLM()`. A judge can only remove a candidate or add risk. It cannot undo a hard filter.
6. One global selection (`policy.ts`) under budgets, with a seeded exploration slice and fairness reports.

The ConsentNetwork (`packages/network`) calls the engine once a day. A person reviews every proposal before any member is contacted.

### 7.2 Runs with real LLM calls

Real LLM calls are required for evidence. Mocked LLM output is not proof. Set `SURPLUS_API_KEY` (or `OPENAI_API_KEY`) in `.env` first. Each run costs money. Start small.

| What it measures | Command |
|---|---|
| The simulated world with LLM persona agents (the members' words come from the LLM) | `bun run packages/sim/src/cli.ts --personas 6 --days 3 --seed 2 --llm` |
| The same, with LLM persona bios too | add `--llm-personas` |
| LLM judges of sent proactive messages (quality and privacy audit) | add `--judge 20` |
| slop.date onboarding with the LLM reader arm | `bun run sim --only onboard --llm` |
| The relay scam classifier on Clef (Workers AI) | `bun run relay-eval --live --budget-usd 1` |
| Clef photo features (consented photos only) | `bun run clef features --photos <dir> --manifest consent.jsonl --out features.jsonl --budget-usd 5 --live` |

Note: no checked-in command runs the engine's LLM judge passes today. The service and the sim adapter (`packages/sim/src/engineAdapter.ts`) do not wire `engineLLM`, so the run log reports the judge as off. If your change touches `judge*.ts`, agree the measurement method with a maintainer in the issue before you start.

In the PR, give the provider, the exact model ID, the request settings, the number of calls and the cost.

### 7.3 Measure before and after (hill-climbing)

Use this method for every quality change:

1. Pick one score from section 10. Record the baseline on `main` with a fixed command and fixed seeds.
2. Make one change.
3. Run the same command with the same seeds. Record the result.
4. Keep the change only if the score improves and every safety gate stays at its value. Canary leaks, invariant violations and minor contacts are always 0.
5. Repeat from step 2. Report every attempt, also the attempts that failed.
6. Before the PR, confirm the result on seeds and corpora that you did not tune on. Example: `evals/relay/relay-heldout-2.jsonl` is never used to tune.
7. Give the sample size. For a small difference, give a confidence interval or a significance test.

Commands to measure matching:

```bash
# The ConsentNetwork on the NYC world: arms and scenarios
bun run packages/network/harness/experiment.ts --days 21 --seed 1
bun run packages/network/harness/scenarios.ts [scenario_id]

# The simulated world, and one scenario with pass^k
bun run packages/sim/src/cli.ts --personas 150 --days 30 --mode discrete --seed 1 --network stub --engine ./packages/sim/src/engineAdapter.ts
bun run packages/sim/src/cli.ts --scenario packages/sim/scenarios/stop-keyword.json --k 4

# Per-app worlds (bun run sim runs their official gates)
bun run packages/sim/src/apps/slop/packEval.ts --seeds 13-16 --weeks 4 --arms random,slop --gates3 \
  --population '{"catfish":0.005,"bodyTypes":true}' --world '{"verification":true,"relay":true,"review":3,"widen":true,"checkin":true,"photos":1,"rater":true}'
bun run packages/sim/src/apps/peon/cli.ts --seeds 13-16
bun run packages/sim/src/apps/friends/cli.ts --seeds 5-8
```

[docs/runbook-simulation.md](docs/runbook-simulation.md) explains the simulation. [docs/results/](docs/results/) shows the standard for a report.

## 8. Test in real agent clients

Members reach The Network through their own AI agent. So you must test a changed flow in several agent clients. Record each one.

The integration points:

| Entry | Where |
|---|---|
| Site skill | `sites/skills/<app>/SKILL.md`, served at `/SKILL.md` on each site |
| MCP server (OAuth) | `packages/mcp`. Locally `http://127.0.0.1:5101/mcp` (ntwrk), `5102` (slop), `5103` (peon), `5104` (friends) |
| Plugins | `plugins/claude` (Claude Code marketplace) and `plugins/openai` (ChatGPT and Codex) |
| elizaOS | `@elizaos/plugin-network` upstream in elizaOS/eliza, through the signed contract in `packages/core/src/svc/` |

Start the local platform. It sends nothing. The login codes are printed in the service log.

```bash
NETWORK_DATABASE_URL=postgres://$USER@localhost:54339/platform_dev bun run platform:dev
```

Open the sites at `127.0.0.1`, not `localhost`. The MCP pages check the origin. A web client (ChatGPT, Grok, Muse) cannot reach `127.0.0.1`. Test web clients against a staging URL that a maintainer gives you. Do not deploy anything yourself.

Clients to test (test as many as apply to the changed flow):

| Client | How to install | How to connect |
|---|---|---|
| Claude Code | `npm install -g @anthropic-ai/claude-code` | `claude mcp add --transport http slop http://127.0.0.1:5102/mcp`, or the plugin in `plugins/claude` |
| OpenAI Codex CLI | `npm install -g @openai/codex` | Add the local MCP URL to the Codex config, or the plugin in `plugins/openai` |
| ChatGPT (web or app) | chatgpt.com | Paste "Read https://<site>/SKILL.md and follow it to sign me up for <app>." |
| Claude (web or app) | claude.ai | The same prompt, or a custom connector to the MCP URL |
| Hermes Agent (Nous Research) | Its install guide on GitHub (NousResearch) | Its MCP settings, or the skill prompt |
| OpenClaw | Its install guide on GitHub | Its MCP settings, or the skill prompt |
| Muse | Its app | The skill prompt |
| Grok bot | grok.com or X | The skill prompt |
| elizaOS agent | elizaOS/eliza with `@elizaos/plugin-network` | The signed `/internal/*` contract |
| Cursor | cursor.com | Its MCP settings with the local MCP URL |
| Others (Perplexity, Gemini and more) | | The skill prompt or MCP |

Drive each client through the real flow. Use computer use or browser automation when the client has no command line. Record a video of each run when the flow has more than one step.

For each run, report: the client name and version, the provider, the exact model, the date, what you did, what happened and the result (pass or fail).

Caution: use only fictional 555-01xx phone numbers locally. Never give an agent a real phone number or a real login code.

## 9. No UI changes

Do not change the UI, the visual design, styles or copy. This includes the sites, the Observatory, the admin console, `SKILL.md` text and any message text that a member sees.

The only exception: a change that fixes a broken user flow. That PR must include:

- A video of the flow before the fix (broken) and after the fix (working).
- Detailed test steps from a clean checkout: commands, URL and what to click, with the expected result of each step.

## 10. Scores that matter

These numbers measure real progress. A change to line coverage or test count is not evidence.

| Score | Where it comes from | Target |
|---|---|---|
| Precision against the oracle | Simulated world run | Higher is better |
| Worthwhile-interruption rate | Simulated world run (persona-judged); pilot | 70% or more (PRD 28.2) |
| Opt-in and completion rates | Simulated world run; pilot | 40% opt-in, 70% completion (PRD 28.2) |
| Members with a first outcome in 14 days | Simulated world run; pilot | 60% or more (PRD 28.2) |
| Pair recall and member recall | Simulated world run | Higher is better |
| Exposure fairness (Gini, members with no proposal) | Simulated world run | Lower is better |
| Gate values per app (second dates, hires, repeat meetups) | `bun run sim` | Blocking gates pass. Tracked gates move toward the target. |
| Relay recall and false-hold rate | `bun run relay-eval` on heldout-2 | Higher recall, lower false holds |
| Canary leaks, invariant violations, minor contacts | Every simulated run | Always 0 |

Safety scores are gates. A PR that makes a canary leak, an invariant violation or a minor contact non-zero is not accepted, even if other scores improve.

## 11. Issues

An issue must be one of these:

1. **A bug.** You reproduced it. Give the steps and the incorrect result.
2. **An MVP gap.** The PRD or the MVP plan requires something, and the code does not do it. Give the section number.
3. **A measured problem.** A score in section 10 is below its target, and you know a probable cause.

Template:

```markdown
## Type
Bug | MVP gap | Measured problem

## Summary
One or two sentences. Say what is incorrect. Say who it affects.

## PRD reference
Section number(s). Example: PRD 32.9.

## Steps to see the problem
1. Do this.
2. Look at this result.

## Actual result
Command output, score or log.

## Expected result
The PRD text or a target number.

## Evidence
Command, seed, provider and model. A maintainer must be able to do it again.
```

## 12. Pull requests

### 12.1 Rules

- Link a reproduced issue or an approved requirement (PRD or MVP-plan section).
- Use the code that exists. Remove dead code and merge duplicates. Add a new type, file, package or dependency only when it is necessary, and say why.
- Explain the cause. Describe at least two other implementations and why yours is better.
- A bug fix adds one sim gate, scenario, corpus row, or integration or e2e case that fails before the fix. That is enough. Do not add more.
- Write results to `docs/results/YYYY-MM-DD-<topic>.md` with the date, command, seed, provider, model, request settings and sample size.

### 12.2 Evidence checklist

Every PR must include each item. Write `N/A: <reason>` only when an item does not apply.

- [ ] The repository is starred and the PR comes from your fork.
- [ ] Linked issue or approved requirement (PRD or MVP-plan section).
- [ ] The root cause, in plain words.
- [ ] The fix, and two other implementations you did not use.
- [ ] The before and after results, with the same command, seeds and data.
- [ ] Real-LLM evidence: commands and output, provider and exact model ID, number of calls and cost.
- [ ] Agent clients tested (section 8): client and version, provider, model, result.
- [ ] Logs or video when a flow is involved.
- [ ] `bun run sim`, `bun run typecheck`, `bun run test:integration` and `bun run test:e2e` pass. Paste the summary lines.
- [ ] Test steps and the expected result of each step.
- [ ] Risks and trade-offs.
- [ ] No UI change, or the broken-flow exception with before and after video (section 9).
- [ ] No secrets, `.env`, `runs/` or member data in the diff.

### 12.3 Template

```markdown
## Summary
One or two sentences. What changes and why.

## Type
Bug fix | Measured improvement | Security | MVP capability

## Linked issue or requirement
#<issue>, PRD <section>

## Problem and root cause

## Fix

## Other implementations considered
1. Option A. Why not.
2. Option B. Why not.

## Evidence
| Metric | Before | After | Command and seeds |
|---|---|---|---|

Real LLM: provider, model, calls, cost.
Validation: sim, typecheck, integration and e2e summary lines.

## Agent clients tested
| Client and version | Provider | Model | Result |
|---|---|---|---|

## How to test
1. Step. Expected result.

## Risks and trade-offs
```

## 13. Write in ASD-STE100 Simplified Technical English

Write every issue and PR so that a person who is not technical can understand it.

- Use short sentences: at most 20 words in an instruction, 25 words in a description.
- Write one instruction in one sentence.
- Use the active voice and the imperative for steps.
- Use simple tenses.
- Use one word for one meaning. Use the PRD terms.
- Explain a technical word the first time you use it.
- Put a warning before the step it applies to.
- Use lists and tables for steps, options and numbers.

> Bad: "It was observed that a significant fraction of proposals end up getting dropped at dispatch time owing to double-booking conflicts."
>
> Good: "The engine makes too many proposals for the same member. The dispatcher then skips 39% of them, because the member is already booked."

## 14. Development rules

- Network code reads time only from `Clock`. Do not use `Date.now()`, `new Date()` with no argument, or `Math.random()` in Network code (PRD 31.1).
- Network code never reads hidden persona truth. Only the simulator, the oracle and the judges can read it.
- Every outbound message goes through the leak guard (`packages/core/src/guard.ts`). Every proactive proposal and member request goes through human review (PRD 28.5, 32.8). Simulator runs use a simulated reviewer (`review: "auto"`). Say so when you report a run.
- Members under 18 are never matched or connected to other members.
- Use `defaultLLM()`, `judgeLLM()` and `recommenderLLM()` in `packages/core/src/llm.ts`. Do not add a new LLM client or provider.
- Do not commit `.env`, `runs/` or real member data.
