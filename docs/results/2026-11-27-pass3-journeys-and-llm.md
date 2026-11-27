# All-Channel Journeys, MCP Hardening, Scheduling UX, and LLM Optimization (Pass 3)

Date: 2026-11-27
Branch: `feat/meetup-setup-external-matchmaking`
Design reference: [2026-11-27-pass3-journeys-simulation-and-llm-research.md](../design/2026-11-27-pass3-journeys-simulation-and-llm-research.md)

## Scope, Model Settings, and Sample Sizes

- **Offline validation runs:** Every `pnpm run sim` block clears `SURPLUS_API_KEY` and `OPENAI_API_KEY` before it runs. Offline runs use deterministic stand-in judges (`simulatedReviewJudge`) and deterministic offline actors.
- **Model and request settings (production paths and `--live` harness):**
  - Model: `gpt-6-luna` on Surplus Intelligence (`defaultLLM()`, `judgeLLM()`, `recommenderLLM()` in `packages/core/src/llm.ts`), with automatic OpenAI fallback on `429`, `5xx`, or timeout.
  - Request controls: `reasoningEffort: "low"` on extraction (`network/src/extract.ts`), venue reranking (`core/src/venues.ts`), judge screen and rubric passes (`engine/src/judgeCommon.ts`), review judge (`engine/src/reviewJudge.ts`), and `--live` journey actors (`sim/src/journeys/actors.ts`).
  - Prefix cache routing: deterministic `promptCacheKey` per prompt family (`venue_rerank_v1`, `network_understand_v1`, `${REVIEW_JUDGE_PROMPT_VERSION}:${rubric}`, judge pass keys).
  - Deadlines and caps: `deadlineMs: 30_000` in `engine/src/judgeCommon.ts`, `deadlineMs: 25_000` in `apps/marketing/src/agent-lifecycle.ts`, `AbortSignal.timeout(12_000)` per photo in `engine/src/packs/slop/clef.ts`, and `LLMBudget` (`--budget-usd` default `$1.00`, `--max-requests` default `80`) with SHA-256 JSONL fetch caching in `packages/sim/src/journeys/llmCache.ts`.
  - Judge prompt rule: explanation comes before verdict in both `modelReviewJudge` and the `--live` 5-axis rubric judge (`packages/sim/src/journeys/judge.ts`).
- **Live LLM availability (honest status):** Neither `SURPLUS_API_KEY` nor `OPENAI_API_KEY` was set in the shell or `.env` in this verification environment. No live model calls were made or fabricated. Running `env -u SURPLUS_API_KEY -u OPENAI_API_KEY pnpm run journey-eval -- --live` exited with status `0` and printed a clear missing-key notice. Operators with a configured key can run `pnpm run journey-eval -- --live --budget-usd 2 --max-requests 120 --cache runs/journeys-llm-cache.jsonl` (twice to verify `>= 95%` warm-cache replay) and `pnpm run review-eval --live`.
- **Pinned seeds and sample sizes:**
  - `journeys` sim block: seed `42`, `28` stratified personas across `6` age buckets (`<13`: 2, `13-17`: 4, `18-24`: 4, `25-39`: 8, `40-59`: 6, `60+`: 4), `11` speaking styles, `5` launch cities (`nyc`, `sf`, `la`, `chicago`, `miami`), `5` channels (`imessage_direct`, `mcp_personal_agent`, `social_dm`, `dating_matchmaker`, `external_event`), and `12` multi-turn traces. Fingerprint: `f63fab29c9e3518f`.
  - `evals` corpora: `+67` deduplicated rows (`evals/replies.jsonl` `n = 236`, `evals/network/consent-replies.jsonl` `n = 430`, `evals/network/benign-adult.txt` `n = 234`, `evals/network/teen-age.jsonl` `n = 402`, `evals/meetup/external-age-screening.jsonl` `n = 62`, `evals/guard/leaks.jsonl` `n = 274`).
  - `meetup` sim block: seeds `[13, 14, 15, 16]` over 4 weeks (`200` personas across 5 cities).
  - `five-city` sim block: seed `42`, `16` scenarios across 5 cities (`75` venues).
  - `network --quick` sim block: seed `3` (10-day invariants, 7-day exception arm) and seed `1` (teen world and stopped teen world).
  - `slop`, `peon`, `friends` sim blocks: full pinned multi-seed runs (`slop` 4 seeds × 4 weeks + `slop-live`, `peon` 4 seeds, `friends` 4 seeds).

## Generated vs. Hand-Written Artifacts

- **Generated artifacts (unchanged in Pass 3; 0 manual edits):**
  - `packages/core/src/generated/*`, `spec/lock.json`, and migrations `0098*`–`0100*` have an empty diff (`git diff --stat` is empty).
  - `pnpm run spec:check-generated` verified `281/281` generated TypeScript and VibeLang artifacts.
  - Plugin skill snapshots under `plugins/claude/skills/*` and `plugins/openai/skills/*` were rebuilt with `plugins/build.ts` from `sites/skills/*/SKILL.md` and verified with `plugins/build.ts --check`.
- **Hand-written artifacts:**
  - LLM caching, telemetry, and latency: `packages/core/src/{llm,chatJson,venues}.ts`, `packages/engine/src/{config,judgeCommon,reviewJudge}.ts`, `packages/engine/src/packs/network/judgeContext.ts`, `packages/engine/src/packs/slop/clef.ts`, `packages/platform/src/photo-screen.ts`, `packages/network/service/cost.ts`, `apps/observatory/src/ops.ts`.
  - Cross-channel lexicons, scripts, and marketing: `packages/core/src/{replies,externalEvents,externalMatchmaker,smsCopy}.ts`, `packages/engine/src/packs/slop/{extract,onboard,copy}.ts`, `packages/platform/src/apps.ts`, `apps/marketing/src/{types,agent-lifecycle,constants,video-factory,vip-engine,crowdsourcing,llm-cache}.ts`.
  - MCP hardening and notify surfaces: `packages/mcp/src/{leaks,tools,hooks,handler,apps}.ts`, `packages/mcp/README.md`, `packages/notify/src/{types,surface}.ts`, `sites/skills/{ntwrk-party,slop-date,friends-help,peon-biz}/SKILL.md`, `plugins/{claude/.claude-plugin/plugin.json,openai/plugin.json}`.
  - Network parsing, coordination, and service UX: `packages/network/src/{reports,classify,extract,copy,meetup-coord,group-late-arrival,rescheduling,venue-booking-link,network}.ts`, `packages/network/service/{relay-endpoint,service,solo-concierge,packs,member-fact-command,travel-presence,participation-controls,profile-read}.ts`.
  - Stratified simulation, evals, and tests: `packages/sim/src/journeys/{cast,channels,actors,llmCache,judge}.ts`, `scripts/sim/journeys.ts`, `scripts/journey-eval.ts`, `scripts/sim.ts`, `scripts/sim/network.ts`, `package.json`, `evals/*`, `apps/marketing/test/marketing-pass3-social.test.ts`, `packages/core/test/pass3-llm-and-scripts.test.ts`, `packages/mcp/test/mcp-pass3-hardening.test.ts`, `packages/network/test/pass3-journeys-coordination.test.ts`, `packages/network/test/shared-relay.integration.test.ts`.

## Before/After Metrics

| Metric / Gate | Before Pass 3 (`1f15ec231`) | After Pass 3 |
|---|---|---|
| 4-server MCP `toolDefs` payload (40 tools) | `70,006` bytes | `34,024` bytes (`-51.4%`, `-35,982` bytes) |
| MCP `INSTRUCTIONS` length | `1,133` chars (truncated at OpenAI 512-char cutoff) | `495` chars (`-56.3%`, fits inside 512-char limit) |
| MCP `passesOutputGate` leak & injection protection | Empty `LeakGuard({})`; missed Pass 1/2/OAuth/Notify IDs and prompt injections | Real `LeakGuard` (`e164`, private facts, `contacts`, `canaryShapes`), expanded `INTERNAL_ID` (`vv_`, `ma_`, `rsvp_`, `ep_`, `plan_`, `ntf_`, `ntwa_`, etc.), and `detectExternalPromptInjection()` (`6/6` dirty updates blocked) |
| MCP `submit_profile` red lines & dual-channel double-ping | Red lines erased on body redaction; loopback agents classified as `"web"` and double-pinged via SMS | Red-line tags persisted as `agent_private`/`ai_memory` before redaction; loopback CLI/IDE agents classified as `"local_agent"`; `0` unsolicited SMS double-pings |
| Relay Workers AI classification lock contention | `clefRun` (up to `2.5s` timeout) ran inside Postgres `rt.unitOfWork` advisory lock | `clefRun` runs outside `rt.unitOfWork` with a `512`-entry LRU cache; non-blocking `close()` verified (`shared-relay.integration.test.ts` `21/21`) |
| Live `TopOneSuggestionFlow` & backup venue red lines | Dead-wired (`0` callers); `"not feeling a bar"` triggered `handleDrop()`; backups ignored red lines | Live booked venue objection intercept -> `pivotVenueSuggestion()` (max 3 pivots, 0 repeats) + `formatSilentPartnerVenueSwap`; red-line-safe backups via `memberVenuePrefsOf()`; `venue_full` pivot without quarantine |
| Emergency panic detection (`statesImmediateDanger`) | Anchored `^...$` to canned phrases; missed panicked multi-clause texts | Unanchored multi-clause detection (`call 911`, `won't let me leave`, `hiding in the bathroom`, etc.) with `0` false positives on benign phrases |
| Marketing cross-contact LLM cache | Lookup keyed on `fencedPrompt`, write keyed on raw `prompt` (cross-contact cache leak) | Lookup and write keyed identically on canonical sorted `fencedPrompt` + contact/channel `scope`; retry/regrow tokens accumulated; `deadlineMs: 25_000` |
| `evals` simulation block | `48/48` (pre-Pass-3 corpus) | **PASS `48/48`** (`3.9s`, `+67` rows: `consent-replies` `99.1%`, `benign-adult` `100.0%`, `abuse` `100.0%`, `teen-age` `99.5%`, `external 18+` `0` minors / `100.0%` adult recall, `leak guard` `100%`) |
| `journeys` multi-channel simulation block | Did not exist (`0%` multi-channel coverage) | **PASS `17/17`** blocking gates (`0.9s`, `runtime_offline_ms: 709ms`, `<3s`); `28` personas, `6` age buckets, `11` styles, `5` cities, `5` channels; `0` safety/privacy/red-line/double-ping/budget breaches; comprehension `100.0%` (`15/15`); replay cache `100.0%` |
| `journey-eval --offline` CLI | Did not exist | **PASS `15/15`** blocking gates (`1,329ms`, `28` personas, `12` traces) |
| `network --quick` simulation block | `106/106` | **PASS `106/106`** blocking gates, `0` tracked off target (`968.5s`; all 9 teen gates = `0`, 0 canary leaks, 0 invariant violations) |
| Security suite (`pnpm run security`) | `12/12` files, `298/298` tests | **PASS `12/12`** files, **`298/298`** tests (`106.31s`) |
| Marketing test suite (`pnpm run marketing:test`) | `2/2` files, `27/27` tests | **PASS `3/3`** files, **`32/32`** tests (`2.89s`) |

## Verifier Fixes Caught During Full Validation

Full validation caught three regressions that did not appear in `--quick` runs. Each was fixed and re-verified before commit:

1. **`slop-live: probes` (`packages/network/src/network.ts`):** `o.origin === "second_encounter"` returned `copy.secondEncounter(...)` before `this.opts.hooks?.probe?.(...)`, bypassing `slop`'s pack probe format. Computing `packText` first and using `copy.secondEncounter` only when `!packText` restored `slop` to **`57/57`**.
2. **`pipeline-slop` (`packages/network/src/network.ts`):** When `platform.venues` was empty in an unseeded Postgres database, `runtime.ts` hydrated `venueRuntimeCtx.venues = []`. Checking `Boolean(this.venueRuntimeCtx.venues)` treated `[]` as truthy and returned an empty pool instead of `seedVenuesForCity(city)`, causing `slop:dealbreaker:smoker` bookings to fail closed. Checking `this.venueRuntimeCtx.venues?.length` restored `pipeline-slop` to **`14/14`**.
3. **`safety` photo rater backoff (`packages/engine/src/packs/slop/clef.ts`):** Defaulting `CLEF_PHOTO_MAX_RETRIES = 1` inside `WorkersAIClefRater` absorbed the first transient `503` before the outer photo-upload retry wrapper recorded its `[500, 1000]` backoff sleeps. Defaulting `CLEF_PHOTO_MAX_RETRIES = 0` (keeping `retries` opt-in while preserving 4-way parallel `Promise.all` and the `12_000ms` per-photo timeout) restored `safety` to **`18/18`**.

## Deferred Spec and UI Decisions (`[DECIDE-1]`–`[DECIDE-4]`)

Per `AGENTS.md`, four items that alter locked specs, OAuth contracts, or React UI surfaces remain deferred for product-owner approval:

- **`[DECIDE-1]` `prepare_signup` disconnect-reconnect flow & `finish_signup_url`:** Governed by `spec/agentPhoneHandoff.md`, `spec/mcpSignupDraft.md`, and `spec/oauthBrowserAuthorization.md`.
- **`[DECIDE-2]` `AuthSignupView.tsx` minor copy & `AuthCodeView.tsx` Resend/Wrong-Number UI:** Governed by `spec/authorizationPages.md` and `spec/phonePage.md`; requires UI before/after screenshots and recordings.
- **`[DECIDE-3]` `networkTextCanProduceInboxItem` enum expansion & new MCP write tools (`set_availability` / `set_red_lines` / `get_context`):** Governed by `spec/notificationAcknowledgement.md` and `spec/connectorTools.md`.
- **`[DECIDE-4]` Spec-governed scheduling optimizations:** Bare `"yes"` on 1-slot `friends` partner plans (`spec/friendsPlanTimeChoice.md`), parallel 1:1 probing / `openTable: true`, and `.ics` calendar links on booked reveals.

## Final Validation Commands and Results

All commands ran inside `/Users/nubs/thenetwork-eliza-meetup` with local dev Postgres on `:54339` and no provider API keys set:

```bash
# Hygiene and immutability
git diff --stat spec/lock.json packages/db/migrations/0098* packages/db/migrations/0099* packages/db/migrations/0100* packages/core/src/generated/
# PASS: empty diff
diff -u AGENTS.md CLAUDE.md
# PASS: byte-identical

# Spec, compiler, typecheck, plugins, and whole-flow Quint models
pnpm run spec:check-generated
# PASS: Checked 281 generated TypeScript and VibeLang artifacts.

pnpm run check
# PASS: 100% of model, always, replay, types, proof, and tests pass.
# Only the 6 pre-existing review items await product-owner `pnpm accept`.

pnpm run typecheck
# PASS: 0 errors across all 15 workspace projects.

node --import tsx --env-file-if-exists=.env plugins/build.ts --check
# PASS: plugin skill snapshots are up to date.

pnpm run quint:check venue_lifecycle meetup_coordination external_event_bridge external_matchmaker
# PASS: 4 models, 0 failures, 18 jobs, 81s.

# Security, marketing, and Pass 3 unit/integration suites
pnpm run security
# PASS: 12/12 test files, 298/298 tests (106.31s).

pnpm run marketing:test
# PASS: 3/3 test files, 32/32 tests (2.89s).

pnpm exec vitest run packages/core/test/pass3-llm-and-scripts.test.ts \
  packages/network/test/pass3-journeys-coordination.test.ts \
  packages/mcp/test/mcp-pass3-hardening.test.ts \
  packages/mcp/test/output-schemas.integration.test.ts \
  packages/notify/
# PASS: 6/6 test files, 57/57 tests (5.15s).

pnpm exec vitest run packages/network/test/pass3-journeys-coordination.test.ts \
  packages/network/test/second-encounter-location.integration.test.ts \
  packages/network/test/meetup-external-matchmaking.integration.test.ts \
  packages/engine/test/slop-standing.integration.test.ts
# PASS: 4/4 test files, 18/18 tests (re-verified post-fix).

# Offline simulation validation layer (17 blocks, local Postgres :54339 active)
# Combined verified pass across all 17 blocks: 564/564 blocking gates PASS:
#   evals 48/48 (3.9s), onboard 23/23 (3.1s), relay 74/74 (2.7s), slop 57/57 (370.9s),
#   peon 30/30 (81.7s), friends 67/67 (660.5s), clef 10/10 (2.5s), meetup 14/14 (0.7s),
#   five-city 29/29 (4.4s), marketing 12/12 (0.2s), journeys 17/17 (0.9s),
#   safety 18/18 (22.3s), ops 12/12 (4.9s), pipeline 15/15 (13.4s),
#   pipeline-slop 14/14 (153.6s), audit 18/18 (53.7s), network --quick 106/106 (968.5s).

pnpm run journey-eval -- --offline
# PASS: 15/15 blocking gates pass (28 personas, 12 traces, 1,329ms).

env -u SURPLUS_API_KEY -u OPENAI_API_KEY pnpm run journey-eval -- --live
# PASS: clean exit 0 with explicit missing-key notice.
```

## Post-Merge Verification (`origin/develop` `c413c2acd`)

After committing Pass 3 (`3c94348aa`), `origin/develop` (`c413c2acd`, containing Pass 2 unify-and-optimize `0f7167fac` and Pass 4 `f500f0551`) was merged cleanly with zero edits to `spec/lock.json`, migrations `0098`–`0102`, or `packages/core/src/generated/*`, unifying both `journeys` suites (`26/26` blocking gates in `1.1s`) and preserving all Pass 3 and Pass 4 fixes:

- `pnpm run typecheck`: **PASS** (`0` errors across all 15 workspace projects)
- `pnpm run spec:check-generated`: **PASS** (`282/282` generated TypeScript and VibeLang artifacts)
- `node --import tsx --env-file-if-exists=.env plugins/build.ts --check`: **PASS**
- `pnpm run marketing:test`: **PASS** (`4/4` files, `39/39` tests)
- `pnpm run security`: **PASS** (`12/12` files, `298/298` tests, `56.42s`)
- Pass 3 targeted Vitest: **PASS** (`6/6` files, `57/57` tests)
- `pnpm run journey-eval -- --offline`: **PASS** (`15/15` blocking gates, `775ms`)
- Post-merge simulation blocks: `evals` **`48/48`**, `journeys` **`26/26`** (`1.1s`), `meetup` **`14/14`**, `five-city` **`31/31`** (`7.1s`), `marketing` **`15/15`**, `safety` **`21/21`** (`16.4s`), `pipeline-slop` **`14/14`** (`84.5s`), `slop` **`57/57`** (`272.7s`, `slop-live` style violations `0/410`).
