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
5. **Engine packs** come from the engine session: `import { type AppPack, networkPack, slopPack } from "@thenetwork/engine"` (packages/engine/src/pack.ts). They have landed (networkPack, slopPack, peonPack, friendsPack).
6. **Rename: buddies.nyc is now friends.help.** AppId `friends` (never `buddies`), network ids like `friends:nyc`, join keyword "friends" or "friends.help", site folder `sites/friends.help`, engine pack `friendsPack`. Local only, no deploy. Still NYC friend-finding. Any `buddies` id, folder or string written earlier in this round must be renamed.
7. **STOP and caps (PRD 40.3).** On the shared line, STOP stops every app (STOP ALL behaviour). "leave slop.date" (or "leave <app>", or the site's leave button) stops one app only. A person-level cap of 3 proactive messages a day across all apps, checked at send time. AppPack is on main: `import { type AppPack, networkPack, validatePack, cityBucketGeo } from "@thenetwork/engine"`; the slop world is `packages/sim/src/apps/slop` (field mapping in docs/results/2026-10-08-slop-world.md).
8. **Hosting (founder, 2026-10-08, supersedes "Workers static assets").** Each site is a classic Cloudflare Pages project in the Eliza Labs Cloudflare account (its id is `CLOUDFLARE_ACCOUNT_ID` in the environment and the CI variables, never in the repo): `ntwrk-love`, `slop-date`, `peon-biz`, `friends-help` (production branch `main`, served on `<project>.pages.dev`). The /api/*, /mcp, /oauth/* and /.well-known/oauth-* forwarding to the shared backend is a Pages Function per site (`sites/<domain>/functions/` or an advanced-mode `_worker.js` built from one shared router), using the same signed proxy-header contract. Deploys use `wrangler pages deploy <dist> --project-name <name> --branch main` (never `--force` again; the projects exist). slop.date and friends.help stay in the Eliza Labs Cloudflare account for 10 days; their DNS points at the pages.dev projects.
9. **slop.date photos, rater, relay (founder, 2026-10-08).** Members upload photos; a rater (Cloudflare Workers AI model plus a jevector-style decision model, github.com/lalalune/jevector) scores face, body, overall and body type; scores feed matching and are never shown to anyone. Adults only (18+). No ID check: phone login is the identity check, so slop:nyc uses `makeSlopPack({ verification: { required: false } })`; a stated age is enough (teens lying is not a concern the founder wants handled with ID). After a match, every exchange goes through the agent: a member can ask the agent to "send them my number" or send a photo, and the agent relays it only after a per-item consent check; each side learns only the first name and what the other person chose to share.
10. **Agent-first sites (founder, 2026-10-08).** The sites are mainly a way to get into the person's own AI agent (ChatGPT, Claude, Muse, Grok, Perplexity...). Each landing page keeps as little text as possible: the name, one line, "Copy this into your agent." with the prompt `Read https://<domain>/SKILL.md and follow it to sign me up for <app>.`, a Copy button, and "Open in <agent>" deeplinks below it (chatgpt.com/?q=, claude.ai/new?q=, grok.com/?q=, perplexity.ai/search?q=; Muse link to be confirmed). No safety notice, no explanations, no compliance text on the landing pages (legal pages stay, linked in the footer). Onboarding happens in the agent: the SKILL.md tells the agent to collect the profile in conversation, then hand the person one link to confirm their own phone (the agent never sees the code), then submit the profile through the MCP server once the person has authorized it. Design canvases (Claude artifacts) per site are the source of truth for the look: ntwrk.love https://claude.ai/artifact/6dyUVv8TytUtBXhPmPfrB3, slop.date https://claude.ai/artifact/A1ZqF7TzBRDNPAj3e91R9q, peon.biz https://claude.ai/artifact/PhvnY97HotDZp1WFvhRLFk, friends.help https://claude.ai/artifact/5yUa6JgAw8wjNaN1sp36rF.
11. **Engine-session audit hand-offs (2026-10-08).** docs/audit/2026-10-08-fixes-core.md lists 37 items for packages/network, observatory, platform and sites. Use core's shared reply parser (`parseReply`, `classifyYesNo`, `parseOptOut` from `@thenetwork/core`, packages/core/src/replies.ts) instead of any local yes/no parser; only `answer: "yes"` is consent, a counter is not a yes. Use `parseOptOut` on the inbound path (STOP everywhere, per-app leave). Probes need a pause path (engine `withPausePath`); info messages go through the outreach controller; plans copy never reaches minors; pass `categoriesOptIn` in view() and the category to `eligibilityFor` at send time; capital `onFeedback` emits `confirmedBy`; stamp `app` on run-log records; the lowest stated age wherever ages meet (the unused `effectiveAge` helper was removed in the 2026-10-08 cleanup; reinstate it in core/policy.ts if a caller needs it); ORDER BY in snapshot queries; persist exposure debt; `checkThread` on send with LEAK_LABEL_KEY in production. The judge now uses PRD_BUDGETS and `requireReview: true`; its new invariants (minor contacts via plans copy, probes without a pause path, unflagged proactive info, unreviewed probes) must reach 0.
12. **slop rater wiring (engine main 87a9d2f, merged after this round).** Env `CLOUDFLARE_AI_TOKEN` (Workers AI) + `CLOUDFLARE_ACCOUNT_ID`, optional `CLEF_MODEL` (`clef` | `clef-flash`) and `CLEF_WEIGHTS_PATH`. On photo upload or change, after the 18+ check: `makeClefRaterFromEnv()` (base64 images, up to 4, max 4 MiB each, never URLs), store via `appearanceFacet` as agent_private, retry API errors; the rater itself refuses minors and unverified ages. Run `appearanceLeak` on any agent-written text about another person (relay). Admin runs `biasMonitor` weekly (alert below 0.8x outcome ratio).

## Hard rules

CONTRIBUTING.md section 3 is the full text. In one line each:

- Stay in the MVP (PRD 28.3; never 28.4). Ask a human before building anything else.
- No busywork: no style, naming, coverage or defensive-check PRs.
- Evidence or nothing: numbers before and after, same command and seed.
- Simplify first: extend or merge what exists; remove dead code.
- Validate end to end with `bun run sim` (and the observatory for UI). A bug fix adds a gate, a scenario or a corpus row that fails before the fix. No unit tests.
- Defend the design: give two other implementations.
- UI changes need videos and a how-to-test.
- Write in ASD-STE100 (CONTRIBUTING.md section 4).

## Code invariants

Do not break these. `bun run sim` checks them in every simulated run.

- Network code reads time only from `Clock` (`packages/core`). No `Date.now()`, no `new Date()` without an argument, no `Math.random()`. Randomness comes from the seeded RNG.
- Network code never reads hidden persona truth (`Persona.hidden`, the oracle, `hidden_truth.jsonl`). Only `packages/sim` and the judges that run inside the simulator can read it.
- Every proactive proposal, and every member-initiated request, must go through human review before any member is contacted (founder decision, below 1,000 members). **Status:** the ConsentNetwork (`packages/network`) enforces it: every opportunity, whatever its origin, waits in a review queue (default mode `human`; the member count never turns review off), and an item past its SLA expires unsent. Simulator runs use a simulated reviewer (`review: "auto"`); say so when you report a run. The simulator's `StubNetwork` has no review. Review state can be stored in Postgres (`PgStore`), but no production process runs the Network and there is no production reviewer API yet ([docs/network.md](docs/network.md) sections 1.1 and 11).
- Every outbound message must go through the leak check. **Status:** the ConsentNetwork send path and the Blooio outbound queue run the leak guard (`packages/core/src/guard.ts`) on every message; the MCP server withholds any inbox update that fails its output gate (`packages/mcp/src/leaks.ts`). The simulator's `StubNetwork` (the push baseline) has no leak check.
- Age policy (`packages/core/src/policy.ts`): under 13 cannot join and is declined kindly with nothing stored; members aged 13-17 can use the agent for themselves (chat, events, things to do) but are never matched or connected to other members. Use `canJoin`, `isMinor` and `canBeMatched`; do not hard-code ages.
- Canary leaks, invariant violations, and minor contacts are always 0. A change that makes any of them non-zero is wrong, whatever else it improves. One known judge issue: the single allowed 14-day re-engagement message shows as a `two_unanswered` violation in runs longer than about 14 days ([docs/network.md](docs/network.md) section 11). Any other violation is real.

## LLMs

- Use `defaultLLM()`, `judgeLLM()` or `recommenderLLM()` from `packages/core/src/llm.ts`. Every use is `gpt-6-luna` on Surplus Intelligence. OpenAI (same model IDs) is used when there is no `SURPLUS_API_KEY`, and as the fallback when Surplus returns 429 / 5xx / a timeout. Use `endpointsFor(provider)` to check whether a provider has a key. Do not add a new LLM client or provider.
- Requests time out after 60 s by default (`LLM_TIMEOUT_MS`) and retry at most 4 times (`LLM_MAX_RETRIES`). One call, retries included, stops at `LLM_DEADLINE_MS` (default 3x the timeout; 0 disables). Pass `fallback: false` to a call or client to turn off the OpenAI fallback; every fallback is logged and reported to `onFallback`.
- `bun run sim` never calls a model: it clears the provider keys before it starts.
- Judge prompts write the explanation before the verdict.
- Recommendations and judges use the same model (`gpt-6-luna`) with a different prompt or pass. Use a different judge model for audits only, and a cross-family audit needs founder approval (it sends data to another provider).

## Commands

```bash
bun install
bun run sim                  # the validation layer: evals, network, slop, peon, friends (pinned seeds; exits 1 on a blocking gate)
bun run sim --only network   # one block (evals | network | slop | peon | friends | capital); repeatable
bun run sim --quick          # fewer seeds, shorter runs; quality gates become tracked
bun run sim --with-capital   # adds the network-capital block (32 paired seeds; nightly)
bun run typecheck
bun run plugins/build.ts --check
bun run security             # the security suite pending the founder's decision (needs the dev Postgres)

# The ConsentNetwork on the NYC world (docs/runbook-simulation.md)
bun run packages/network/harness/experiment.ts --days 21 --seed 1
bun run packages/network/harness/scenarios.ts [scenario_id]

# The simulated world and its scenarios (pass^k)
bun run packages/sim/src/cli.ts --personas 150 --days 30 --mode discrete --seed 1 --network stub --engine ./packages/sim/src/engineAdapter.ts
bun run packages/sim/src/cli.ts --scenario packages/sim/scenarios/stop-keyword.json --k 4

# Per-app worlds (full tables; bun run sim runs their official gates)
bun run packages/sim/src/apps/slop/packEval.ts --seeds 13-16 --weeks 4 --arms random,slop --gates3 \
  --population '{"catfish":0.005,"bodyTypes":true}' --world '{"verification":true,"relay":true,"review":3,"widen":true,"checkin":true,"photos":1,"rater":true}'
bun run packages/sim/src/apps/peon/cli.ts --seeds 13-16
bun run packages/sim/src/apps/friends/cli.ts --seeds 5-8

# Observatory (prints http://127.0.0.1:4747/#token=...)
bun run observatory
bun run observatory --review human
bun run observatory:db       # local Postgres on :54339 with a 14-day simulated run

# The four apps on one backend (docs/runbook-platform.md): dry-run sends only
bun run db:migrate           # migrations (network and platform schemas), local hosts only
NETWORK_DATABASE_URL=postgres://$USER@localhost:54339/<your db> bun run platform:dev   # service :4848, API :8790, sites :5101-5104
bun run sites:dev            # the four sites only, /api/* proxied to :8790
```

## Environment

- Copy `.env.example` to `.env`. Never commit `.env` or anything in `runs/`.
- The local dev Postgres for the Observatory is on port **54339**. Do not touch port 54329; another tool uses it.
- `packages/observatory/db/seed.ts` refuses non-local hosts. Do not pass `--allow-remote` unless a human asks.
- Cloudflare work for ntwrk.love goes through `scripts/wrangler.sh` only. It refuses `deploy` (except `--dry-run`) and other commands that change Cloudflare resources unless `NTWRK_ALLOW_DEPLOY=1` is set. Do not set it without the founder's approval.

## Results

Write experiment results to `docs/results/YYYY-MM-DD-<topic>.md`. Include the command, the seed, the model, the request settings, the sample size, and confidence intervals or significance tests for small differences. Say what is hand-written and what is generated.
