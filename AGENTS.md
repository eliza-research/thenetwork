# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, Eliza sub-agents, and others) that work in this repository. Human contributors: read [CONTRIBUTING.md](CONTRIBUTING.md). Its rules apply to agents too. This file adds what an agent needs to know.

## Before you start

1. Read [CONTRIBUTING.md](CONTRIBUTING.md). It defines what an acceptable issue and PR is.
2. Read PRD Section 28 (MVP definition) in [docs/prd-snapshot.md](docs/prd-snapshot.md). The canonical PRD is the [Google Doc](https://docs.google.com/document/d/1lLQAZNAMSC_yHCkUBVbp1CCwvyR17PuvV7TnpfuY8Xc/edit). If the two disagree, the Google Doc is correct.
3. Read the README or design doc of the package you change (`packages/engine/README.md`, `packages/sim/README.md`, [docs/network.md](docs/network.md), [docs/observatory.md](docs/observatory.md)) and the newest report for it in [docs/results/](docs/results/).

## Platform decisions (founder, 2026-10-08)

These replace any earlier defaults in task prompts or in docs/research/2026-10-08-platform-architecture.md:

1. **Age.** People aged 13+ may join every app (ntwrk, slop, peon, friends). Minors (13-17) are never matched or connected to anyone, in any app. Matching is 18+ everywhere. Age is a person-level fact (the lowest age ever stated or recorded wins).
2. **One line.** One Blooio line serves every app. The first message routes by keyword: "slop" or "slop.date" joins slop; "peon" or "peon.biz" joins peon; "friends" or "friends.help" joins friends. With no keyword, the person joins The Network as a whole: the same onboarding, and the agent asks what they are looking for (friends, dating, work) and enrolls them in the matching app memberships. Copy says: "All of these apps are powered by The Network." Per-line routing tables may stay as data, but the default is one line for all apps.
3. **Compliance is not a launch blocker for now.** Do not build compliance gating (no bias-audit gate, no dating-notice gate). Keep every existing safety guard (minors, leak guard, review gate, consent, blocks, STOP).
4. **Order.** slop.date first. ntwrk.love is the home page for the whole concept and links to the apps. peon.biz and friends.help run locally only (no deploys).
5. **Engine packs** come from the engine session: `import { type AppPack, networkPack, slopPack } from "@thenetwork/engine"` (packages/engine/src/pack.ts). Until they land, leave `deps.pack` unset and keep slop and peon matching off.
6. **Rename: buddies.nyc is now friends.help.** AppId `friends` (never `buddies`), network ids like `friends:nyc`, join keyword "friends" or "friends.help", site folder `sites/friends.help`, engine pack `friendsPack`. Local only, no deploy. Still NYC friend-finding. Any `buddies` id, folder or string written earlier in this round must be renamed.
7. **STOP and caps (PRD 40.3).** On the shared line, STOP stops every app (STOP ALL behaviour). "leave slop.date" (or "leave <app>", or the site's leave button) stops one app only. A person-level cap of 3 proactive messages a day across all apps, checked at send time. AppPack is on origin/main (fb9431c+): `import { type AppPack, networkPack, validatePack, cityBucketGeo } from "@thenetwork/engine"`; the slop world is `@thenetwork/worlds` (src/slop; field mapping in docs/results/2026-10-08-slop-world.md). The worktree merges main after this round's workflow, so do not depend on them yet.
8. **Hosting (founder, 2026-10-08, supersedes "Workers static assets").** Each site is a classic Cloudflare Pages project in account 50ad2052bbc6ca528d6993a689b419a4: `ntwrk-love`, `slop-date`, `peon-biz`, `friends-help` (production branch `main`, served on `<project>.pages.dev`). The /api/*, /mcp, /oauth/* and /.well-known/oauth-* forwarding to the shared backend is a Pages Function per site (`sites/<domain>/functions/` or an advanced-mode `_worker.js` built from one shared router), using the same signed proxy-header contract. Deploys use `wrangler pages deploy <dist> --project-name <name> --branch main` (never `--force` again; the projects exist). slop.date and friends.help stay in the developer@elizalabs.ai Cloudflare account for 10 days; their DNS points at the pages.dev projects.
9. **slop.date photos, rater, relay (founder, 2026-10-08).** Members upload photos; a rater (Cloudflare Workers AI model plus a jevector-style decision model, github.com/lalalune/jevector) scores face, body, overall and body type; scores feed matching and are never shown to anyone. Adults only (18+). No ID check: phone login is the identity check, so slop:nyc uses `makeSlopPack({ verification: { required: false } })`; a stated age is enough (teens lying is not a concern the founder wants handled with ID). After a match, every exchange goes through the agent: a member can ask the agent to "send them my number" or send a photo, and the agent relays it only after a per-item consent check; each side learns only the first name and what the other person chose to share.
10. **Agent-first sites (founder, 2026-10-08).** The sites are mainly a way to get into the person's own AI agent (ChatGPT, Claude, Muse, Grok, Perplexity...). Each landing page keeps as little text as possible: the name, one line, "Copy this into your agent." with the prompt `Read https://<domain>/SKILL.md and follow it to sign me up for <app>.`, a Copy button, and "Open in <agent>" deeplinks below it (chatgpt.com/?q=, claude.ai/new?q=, grok.com/?q=, perplexity.ai/search?q=; Muse link to be confirmed). No safety notice, no explanations, no compliance text on the landing pages (legal pages stay, linked in the footer). Onboarding happens in the agent: the SKILL.md tells the agent to collect the profile in conversation, then hand the person one link to confirm their own phone (the agent never sees the code), then submit the profile through the MCP server once the person has authorized it. Design canvases (Claude artifacts) per site are the source of truth for the look: ntwrk.love https://claude.ai/artifact/6dyUVv8TytUtBXhPmPfrB3, slop.date https://claude.ai/artifact/A1ZqF7TzBRDNPAj3e91R9q, peon.biz https://claude.ai/artifact/PhvnY97HotDZp1WFvhRLFk, friends.help https://claude.ai/artifact/5yUa6JgAw8wjNaN1sp36rF.

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
- Every proactive proposal, and every member-initiated request, must go through human review before any member is contacted (founder decision, below 1,000 members). **Status:** the ConsentNetwork (`packages/network`) enforces it: every opportunity, whatever its origin, waits in a review queue (default mode `human`; the member count never turns review off), and an item past its SLA expires unsent. Simulator runs use a simulated reviewer (`review: "auto"`); say so when you report a run. The simulator's `StubNetwork` has no review. Review state can be stored in Postgres (`PgStore`), but no production process runs the Network and there is no production reviewer API yet ([docs/network.md](docs/network.md) sections 1.1 and 11).
- Every outbound message must go through the leak check. **Status:** the ConsentNetwork send path runs the leak guard (`packages/core/src/guard.ts`) on every message, and the connector prototype checks every output. The Blooio outbound queue and the simulator's `StubNetwork` have no leak check.
- Age policy (`packages/core/src/policy.ts`): under 13 cannot join and is declined kindly with nothing stored; members aged 13-17 can use the agent for themselves (chat, events, things to do) but are never matched or connected to other members. Use `canJoin`, `isMinor` and `canBeMatched`; do not hard-code ages.
- Canary leaks, invariant violations, and minor contacts are always 0. A change that makes any of them non-zero is wrong, whatever else it improves. One known judge issue: the single allowed 14-day re-engagement message shows as a `two_unanswered` violation in runs longer than about 14 days ([docs/network.md](docs/network.md) section 11). Any other violation is real.

## LLMs

- Use `defaultLLM()`, `judgeLLM()` or `recommenderLLM()` from `packages/core/src/llm.ts`. Every use is `gpt-6-luna` on Surplus Intelligence. OpenAI (same model IDs) is used when there is no `SURPLUS_API_KEY`, and as the fallback when Surplus returns 429 / 5xx / a timeout. Cerebras is optional and legacy. Use `endpointsFor(provider)` to check whether a provider has a key. Do not add a new LLM client or provider.
- Requests time out after 60 s by default (`LLM_TIMEOUT_MS`) and retry at most 4 times (`LLM_MAX_RETRIES`). One call, retries included, stops at `LLM_DEADLINE_MS` (default 3x the timeout; 0 disables). Pass `fallback: false` to a call or client to turn off the OpenAI fallback; every fallback is logged and reported to `onFallback`.
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

# ConsentNetwork on the NYC world (docs/runbook-simulation.md)
bun run packages/network/harness/experiment.ts --days 21 --seed 1
bun run packages/network/harness/scenarios.ts [scenario_id]

# Observatory (prints http://127.0.0.1:4747/?token=...)
bun run observatory
bun run observatory --review human
bun run observatory:db       # local Postgres on :54339 with a 14-day simulated run

# The four apps on one backend (docs/runbook-platform.md): dry-run sends only
bun run db:migrate           # migrations 0001-0005 (network and platform schemas), local hosts only
NETWORK_DATABASE_URL=postgres://$USER@localhost:54339/<your db> bun run platform:dev   # service :4848, API :8790, sites :5101-5104
bun run sites:dev            # the four sites only, /api/* proxied to :8790
bun test packages/platform sites   # `bun run test` covers packages/platform but not sites/
```

## Environment

- Copy `.env.example` to `.env`. Never commit `.env` or anything in `runs/`.
- The local dev Postgres for the Observatory is on port **54339**. Do not touch port 54329; another tool uses it.
- `packages/observatory/db/seed.ts` refuses non-local hosts. Do not pass `--allow-remote` unless a human asks.
- Cloudflare work for ntwrk.love goes through `scripts/wrangler.sh` only. It refuses `deploy` (except `--dry-run`) and other commands that change Cloudflare resources unless `NTWRK_ALLOW_DEPLOY=1` is set. Do not set it without the founder's approval.

## Results

Write experiment results to `docs/results/YYYY-MM-DD-<topic>.md`. Include the command, the seed, the model, the request settings, the sample size, and confidence intervals or significance tests for small differences. Say what is hand-written and what is generated.
