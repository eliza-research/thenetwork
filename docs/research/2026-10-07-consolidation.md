# Consolidation and simplification review (2026-10-07)

Read-only review of the whole repository: `packages/{core,engine,sim,judge,evals,network,observatory}`, `prototypes/{connector-mcp,messaging-blooio,prompt-opt}`, `scripts/`, `docs/`. Hand-written by a Claude agent on 2026-10-06/07 from code reading, grep scans, `tsc`, `ts-prune`, and timed test runs. No code was changed.

Evidence is `file:line` against the working tree at the time of review (HEAD `9219c89` plus uncommitted work). Line numbers in files that other sessions are editing will drift.

## 0. Snapshot of the tree and who is editing what

At review time there were 45 uncommitted paths. Mark these before you change anything:

| Owner | Paths (uncommitted or untracked) |
|---|---|
| Other session (named in the brief) | `packages/network/**`, `packages/observatory/**`, `packages/sim/src/{agent/policy.ts,agent/types.ts,channel.ts,world.ts,network.ts}`, `packages/judge/src/runlog.ts`, `bun.lock`, root `package.json`, `docs/observatory.md`, `docs/results/{network,observatory}/**` |
| In-flight judge-v2 work (a further session; not named in the brief) | `packages/engine/src/{judge,judgeCommon,judgeDeep,judgeScreen,config}.ts`, `packages/engine/experiments/**` (new), `packages/evals/src/{cli,metrics,passScore,publicView,recDataset,runPasses,transport,types,worlds}.ts`, `packages/evals/src/judgeV2.ts` (new), `packages/evals/src/analysis/labelAttribution.ts` (new), `packages/evals/test/datasetV2.test.ts` (new), `packages/core/src/llm.ts`, `llm.test.ts`, the three `live.test.ts` files |
| Docs refresh in progress | `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `packages/{engine,sim}/README.md`, `.env.example` |
| New prototype (in flux) | `prototypes/prompt-opt/**`. It has no `package.json` but sits under the `prototypes/*` workspace glob and inside the root `tsconfig.json` include. |

Health at review time:

- `bunx tsc --noEmit -p .` passes: 0 errors in 1.7 s. `-p packages/observatory` and `-p prototypes/connector-mcp` also pass. The root tsconfig covers only 2 of the 6 files in `scripts/synthetic` (only the files that something imports) and none of the observatory `.tsx`.
- `bun test packages prototypes` from the repo root: 650 pass, 1 skip, 2 fail, **215 s** (63 files). The 2 failures are in `packages/network/test/network.test.ts` ("meetings happen at real public NYC venues", "consent-first beats push"), which is the other session's work in progress.
- Per-package runs from each package directory: core 1 s, engine 3 s, judge 0 s, sim 3 s, evals 52 s, network 53 s, connector-mcp 0.5 s, messaging-blooio 0.05 s, scripts/synthetic 1.4 s.

---

## 1. What can be consolidated

### 1.1 Duplicate and colliding type definitions

`engine/src/types.ts` does not duplicate `core/src/types.ts`. It extends it (`EngineInput extends WorldSnapshot`, `EngineProposal extends Proposal`, `types.ts:29,85`). The engine README already proposes to move these into core (`packages/engine/README.md:197-203`: Proposal fields, snapshot extensions, structured romance prefs, City-to-timezone, `Intent.tags`). That is the right direction and unlocks items 1.2, 1.5 and 1.8 below.

There are real problems with the same names used for different things. These are a hazard for anyone who merges code or relies on auto-import:

| Name | Definitions | Problem |
|---|---|---|
| `Rng` | `engine/src/rng.ts:28`, `sim/src/rng.ts:19` | Same algorithm (mulberry32) but a different API: engine `int(n)` returns `[0,n)`; sim `int(min, maxInclusive)`. Seeds and forks also hash differently (`fnv1a` vs `hash32` with separator). |
| `LocalParts` / `localParts` | `engine/src/outreach.ts:37-48`, `sim/src/time.ts:20-29` | Same shape, **different weekday convention**: engine Monday=0, sim Sunday=0. |
| `CITY_TZ` | `engine/src/outreach.ts:35`, `sim/src/time.ts:5`, `prototypes/messaging-blooio/src/quiet-hours.ts:53`; also `EngineConfig.timezones` `engine/src/config.ts:24,88` | Four copies. `cfg.timezones` is never read (0 uses outside `config.ts`). |
| `Intent` | `core/src/types.ts:40` (member intent), `sim/src/agent/types.ts:15` (persona reply intent) | Same name, unrelated meaning. |
| `Category` | `core/src/types.ts:10`, `prototypes/connector-mcp/src/profiles.ts:10` | Two different category vocabularies. |
| `World` | `engine/src/world.ts:46` (indexed snapshot), `sim/src/world.ts:75` (simulation runner) | Same name, unrelated. |
| `Clock` | `core/src/clock.ts:2`, `prototypes/messaging-blooio/src/types.ts:5` | blooio re-declares it but imports `SimClock` from core by relative path in its tests. |
| `InboundMessage`, `ChannelKind`, `DeliveryStatus`, `MessageKind`, `Decision` | sim vs blooio vs engine | Same names, different members (`sim/src/channel.ts:8,10` vs `blooio/src/types.ts:7,32`). |
| `ADULT_AGE` | `engine/src/filters.ts:31`, `connector-mcp/src/profiles.ts:80` | Policy constant in two places. |
| `D3` / `Decision3` | `evals/src/runPasses.ts:219`, `evals/src/metrics.ts:118` | Identical union, two names. |

### 1.2 Parallel taxonomies

- `engine/src/taxonomy.ts:27-48` (`OBJECTIVES`: id, regex, needs, pool, interests) restates `sim/src/taxonomy.ts:79-103` (`DESIRES`: id, needsSkills, pool, needsInterests). A drift test pins them together (`engine/test/complementarity.test.ts:8,33-42`). That test is the only place where the engine imports the simulator.
- `packages/network` (production-shaped code) imports `DESIRES`, `INTERESTS`, `SKILLS`, `desireById` from `@thenetwork/sim` (`network/src/network.ts:21`, `network/src/classify.ts:7`). Production code depends on the simulator for its product vocabulary.
- `NEIGHBORHOODS` exists three times with three shapes: `scripts/synthetic/common.ts:30` (with boroughs), `sim/src/taxonomy.ts:107` (strings), `network/src/geo.ts:17` (geo points).
- The intent tag protocol is a string: `generate.ts:799-800` writes `"(format: X; tags: a,b)"` into `Intent.details`, and `engine/src/taxonomy.ts:51-55` parses it back with a regex. The engine README item 5 (`Intent.tags`) replaces this.

Consolidation: move the vocabulary (tags, labels, desire needs/pool/interests, neighborhoods) into `packages/core/src/taxonomy.ts`. Keep the engine's regex patterns and the sim's persona text/format as local extensions keyed by the same ids. Then delete the drift test, because it is no longer needed. Risk: none at runtime if the ids and arrays stay byte-identical. The engine is already as "circular" on synthetic data as the code comment admits (`engine/src/taxonomy.ts:7-11`).

### 1.3 LLM clients, transports and caches

There is one real client, `chatCompletions` in `core/src/llm.ts:74-126`. These wrap or copy it:

| What | Where | Duplicates |
|---|---|---|
| `CerebrasLLM` + `"cerebras"` provider | `core/src/llm.ts:129-142,171,185-186,194`; `core/src/llm.smoke.test.ts` | Not used by any runtime path since the founder chose `gpt-6-luna` for everything. Only tests use it. |
| Eval transport | `evals/src/transport.ts:94-105` | Re-implements endpoint selection with a hard-coded Surplus URL (`:95-98`) instead of `endpointsFor`. |
| Disk cache #1 | `evals/src/transport.ts:42-81` (`sha`, `stable`, `cacheKey`, `cachingFetch`) | |
| Disk cache #2 | `prototypes/prompt-opt/src/llm.ts:14-20` | Copy-paste of #1 (same key format), plus `Budget`, which copies `SpendGuard` (`evals/src/runPasses.ts:31`). |
| Disk cache #3 | `scripts/synthetic/generate.ts:606` (`runs/synthetic-cache`) | Has its own retry with `sleep(3000*2^attempt)` (`:644-658`) on top of the core client's retries. |
| In-memory cache | `engine/src/judge.ts:25-38` (`JudgeCache`) | Legitimate (TTL plus revisions). Keep it. |
| Lazy singleton | `judge/src/llmJudges.ts:11-13` (`defaultJudgeLLM`) | Fine. |

Consolidation: (a) delete Cerebras (`CerebrasLLM`, provider branch, smoke test, `.env.example:1-3`). (b) Move `cachingFetch` plus `recordOf` into core as an optional `ClientOptions.fetch` factory (`diskCache({dir, attempt, offline})`). Use it in evals, prompt-opt and the synthetic generator. (c) Make `instrumentedLLM` call `llmFor("surplus", model, hooks)`.

**Cache-key compatibility risk:** evals `stable()` (`transport.ts:44-48`) and engine `stableStringify()` (`engine/src/rng.ts:19-25`) differ: the engine version drops `undefined` keys. Keep the evals algorithm, unchanged, for the cache key. Otherwise every paid response in `runs/evals/cache` misses.

### 1.4 "Chat, parse JSON, validate, retry" loops

The same loop is written 9 times, with different budgets and growth rules:

`engine/src/judge.ts:182-192`, `engine/src/judgeScreen.ts:255-266`, `engine/src/judgeDeep.ts:424-435`, `judge/src/llmJudges.ts:46-57` (`ask`), `judge/src/policy.ts:112-131`, `sim/src/llmGenerator.ts:56-64` (`chatJson`), `evals/src/runRec.ts:74-86`, `evals/src/runPasses.ts:111-127` (`call`), `scripts/synthetic/generate.ts:644-658`.

The core client already doubles the budget on empty or `length`-truncated content (`core/src/llm.ts:119-123`), so several of these double the budget twice.

Consolidation: add `chatJson<T>(llm, messages, parse, { attempts, maxTokens, grow, temperature })` to core, next to `parseJson` (`core/src/llm.ts:145`). The evals variant also needs per-attempt cache scopes. Give it an `onAttempt(attempt)` hook, or keep `withScope` around the shared helper. Effort S-M. Risk: low if each call site keeps its attempts and budget (pass them explicitly).

### 1.5 Leak and privacy guards (several overlapping implementations)

| Guard | Where | What it checks |
|---|---|---|
| `leaks()` | `engine/src/explain.ts:28-31` | Literal word "canary", plus private-only vocabulary |
| `checkMemberFacing()` | `engine/src/judgeCommon.ts:80-88` | Superset of the above: canary-shaped token, private vocabulary, forbidden phrases, email/phone, length. `CANARY_TOKEN` is declared at `:53` and re-inlined at `:82`. |
| `redactPrivate()` | `engine/src/judgeCommon.ts:53-62` | **Production engine code knows the simulator's canary format** (`[A-Z]{2}-\d{4}-[A-Z]{3,}`, made by `sim/src/generator.ts:154-158`). |
| `checkMessage()` / `findCanaries()` | `judge/src/rules.ts:19-22,51-75` | Phone, email, street address, apartment, canary list, style rules |
| `styleViolations()` | `network/src/copy.ts:76-84` | Its own phone/email regex and opt-out check. **Only tests call it.** |
| `findLeaks()` + `looks*()` | `connector-mcp/src/policy.ts:96-200` | The most robust: NFKC/Unicode folding, punctuation squashing, spelled-out emails, URLs, handles, internal ids, ISO timestamps |
| Canary checks after the fact | `sim/src/scenario.ts:200-205`, `network/src/scenarios.ts:110-134`, `judge/src/metrics.ts:319`, `evals/src/runRec.ts:42-66`, `evals/src/runPasses.ts`, `scripts/synthetic/load.ts:126-139` | |

**Correctness gap found along the way:** `ConsentNetwork` sends member-facing text without any runtime leak or contact gate (no `checkMessage`, `leaks`, `checkMemberFacing` or `styleViolations` call in `network/src/*.ts`). AGENTS.md says "Every outbound message goes through the leak check". Today the guarantee comes only from template construction and from scenario checks after the fact.

Consolidation: one `packages/core/src/guard.ts` (or `judge/src/guard.ts`) with:

- `fold(text)`, taken from connector `plainVariants` and `textVariants`;
- `contactPatterns` (phone, email, spelled-out email, street address, URL, handle);
- `findLeaks(text, { forbidden, privateVocab, canaries })`.

Use it in `explain.ts`, `judgeCommon.ts`, `judge/rules.ts`, `network/copy.ts`, and **in the `ConsentNetwork` send path**. Remove the canary-format regex from the engine. Pass the actual canary strings or the private vocabulary instead. Effort M. Risk: a stricter guard rejects more LLM "why" text, so template fallbacks rise. Re-run `sim` seed 1-3 and `evals --suite passes --offline` and compare the leak and rejection counts.

### 1.6 Word-list and regex risk filters

| Topic | Copies |
|---|---|
| Romance / dating language | `judge/src/policy.ts:40-42` (`ROMANCE_STRONG`/`WEAK`), `connector-mcp/src/profiles.ts:36-41` (`ROMANCE_WORDS`, `TEEN_BLOCK`), `connector-mcp/src/policy.ts:165-166` (`looksRomantic`), `network/src/classify.ts:50`, `engine/src/taxonomy.ts:41` |
| Minor signals | `judge/src/policy.ts:48` (`MINOR_SIGNAL`), `network/src/classify.ts:38` (`RX.minor`) |
| Alcohol / nightlife | `connector-mcp/src/profiles.ts:39-40`, `connector-mcp/src/policy.ts:167-168` |
| Sensitive categories | `connector-mcp/src/policy.ts:154-155` (`looksSensitive`), judge `RUBRICS.shareability` prose (`llmJudges.ts:22-25`), `core` `SensitiveCategory` (`types.ts:22`) |
| High-risk asks | `engine/src/config.ts:149-161` (`highRiskTerms`, `highRiskPatterns`), `engine/src/filters.ts:106-133` |
| STOP / HELP / START keywords | `sim/src/channel.ts:54-66` vs `messaging-blooio/src/keywords.ts:13-35`. The sets differ: sim lacks `REVOKE`, `OPTOUT`, `OPT OUT`, `STOP ALL`, `SUBSCRIBE`, `RESUME`, and has `YES START`. Normalization also differs. **The simulator tests a different opt-out policy than the production channel adapter.** |
| Yes/no reply parsing | `sim/src/agent/policy.ts:34` (`parseYesNo`) is imported by production-shaped code (`network/src/network.ts:21`, `observatory/src/takeover.ts:5`). The Network is graded by personas whose replies the same regex reads. |

Consolidation: a `core/src/lexicon.ts` (or the guard module) that owns these patterns, with named exports per topic. The sim channel imports the blooio keyword module, or both import from core. Effort S-M per topic. Risk: changing a list changes behavior. Merge to the union only when a test or scenario shows that the union is correct, and record which call sites tighten.

### 1.7 Time, clock, RNG, hash, JSON and small helpers

| Helper | Copies |
|---|---|
| Local time / quiet hours | `engine/src/outreach.ts:37-80`, `sim/src/time.ts:7-70`, `blooio/src/quiet-hours.ts:14-53`, `judge/src/metrics.ts:54-58`, `network/src/network.ts:93-106` (NY-only `nyParts`), `network/src/copy.ts:72` |
| Time constants re-declared | `blooio/src/outbound-queue.ts:91`, `judge/src/metrics.ts:48`, `observatory/web/main.tsx:12`; literal `86_400_000` / `3_600_000` in `engine/src/engine.ts:204,230`, `engine/src/judge.ts:129`, `engine/src/judgeCommon.ts:144`, `engine/src/tick.ts:43` |
| FNV / seeded RNG | `engine/src/rng.ts:5-55`, `sim/src/rng.ts:5-71` (network uses the sim one: `network/src/growth.ts:6`) |
| sha256 | `engine/src/rng.ts:14`, `scripts/synthetic/common.ts:165`, `evals/src/transport.ts:42`, `prompt-opt/src/llm.ts:14` |
| Stable stringify | `engine/src/rng.ts:19`, `evals/src/transport.ts:44`, `prompt-opt/src/llm.ts:15` (see the cache-key risk in 1.3) |
| Bounded-concurrency map | `evals/src/transport.ts:119` (`pmap`), `sim/src/llmGenerator.ts:43` (`mapLimit`), `engine/src/judge.ts:205-222`, `judge/src/calibration.ts:76` |
| JSONL read | `judge/src/runlog.ts:52-55`, `scripts/synthetic/common.ts:163`, `evals/src/analysis/lunaErrors.ts:138` |
| mean / wilson / pct / gini / clamp | `evals/src/metrics.ts:62-84` vs `engine/experiments/lib.ts:261-264`; `engine/src/policy.ts:138` vs `judge/src/metrics.ts:65` (gini); 7 `pct` lambdas; `clamp01` in `sim/src/rng.ts:73` and `evals/src/analysis/lunaErrors.ts:19` |
| CLI `arg()` | `evals/src/cli.ts:39-44`, `evals/src/judgeV2.ts:21-26`, `prompt-opt/src/gepa.ts:26`. The other 12 CLIs already use `node:util` `parseArgs`. |
| `.env` loader | `messaging-blooio/scripts/env.ts:5-14`. Bun loads `.env` from the cwd, so this exists only for runs from the prototype directory. |

Consolidation: `core/src/time.ts` (CITY_TZ, `localParts` with **one** weekday convention, `inHourWindow`, `quietHoursEnd`), `core/src/hash.ts` (`fnv1a`, `sha256`, `stableStringify`), `core/src/async.ts` (`mapLimit`), and `evals/metrics` as the one stats module. **Do not change either `Rng` algorithm.** Seeded worlds and the synthetic dataset depend on them. If you unify them, keep both draw sequences byte-identical (for example, `sim.Rng.int(a,b)` = `a + engineRng.int(b-a+1)` only if the outputs match on a seed sweep). The safer choice is to keep both classes and rename one.

### 1.8 Snapshot builders (persona to `WorldSnapshot`)

There are two independent mappings from personas to core records, and they already diverge:

- `sim/src/snapshot.ts:26-50` (`memberOf`) plus `:54-144`, used by the sim `World` (`sim/src/world.ts:150`) and by evals (`evals/src/worlds.ts:79`).
- `scripts/synthetic/generate.ts:790-830` writes `members/facets/intents.jsonl` with its own rules. Example: `onlyWhenAsked: minor || x.unanswered >= 2` (`:819`) versus `unanswered >= 2` in the sim (`snapshot.ts:41`). Example: categories and romance opt-in are derived separately.
- `scripts/synthetic/load.ts:48-60` (`toSnapshot`) reads the JSONL back. `loadPersonas` (`:70-96`) rebuilds sim personas so that the sim builder runs again (`observatory/src/sources/game.ts:100`, `network/src/experiment.ts:30`).
- `evals/src/recDataset.ts` builds configurations on top of `buildEvalWorld` (`evals/src/worlds.ts:61`). It uses the sim builder, which is good.
- `packages/network` does not build snapshots. It uses `ctx.snapshot()` from the sim world. The "network package snapshot builder" in the brief does not exist as a separate copy.

Consolidation: make `generate.ts` produce its JSONL by calling `buildSnapshot()` / `memberOf()` (plus dataset-only extras such as `profile` and `segment`). Then one function defines what the Network "knows". Effort L. Risk: changes the synthetic dataset. Ship it as synthetic v1.3, and re-run `docs/results` baselines (engine v1 vs random, liveness, judge passes) with the same seeds.

### 1.9 Two "network" modules, three engine adapters

- `sim/src/network.ts` is the **interface** (`NetworkUnderTest`, `NetworkContext`, `Engine`, `InboundMessage`). `sim/src/stubNetwork.ts` is the random baseline. `packages/network` (`ConsentNetwork`) implements the same interface. They are not two stubs. The problem is that the contract lives in the simulator, so `packages/network` must depend on `@thenetwork/sim`.
- `ConsentNetwork` started as a fork of `StubNetwork`: the member-state struct is field-for-field the same (`stubNetwork.ts:31-35` vs `network/src/network.ts:62-64`). STOP, quiet hours, the weekly budget and the two-unanswered rule are implemented again in both.
- Engine adapters: `sim/engines/engine-v1.ts` (imports `../../engine/src/index.ts` although sim does not depend on engine), `observatory/src/engineCapture.ts:51-62` (`CapturingEngine`, the same logic plus a summary), and `network/src/network.ts:781` (calls `runEngine` directly).
- `packages/network` mixes production logic (`network.ts`, `classify.ts`, `trust.ts`, `copy.ts`, `geo.ts`) with harness code that generates personas (`growth.ts:6`, `experiment.ts`, `scenarios.ts`).

Consolidation: move `NetworkUnderTest`, `NetworkContext`, `Engine` and `InboundMessage` into core. Export one `engineV1(): Engine` from `@thenetwork/engine` (with an optional `onRun` hook for the observatory). Move the harness files of `packages/network` next to the sim, or into `packages/network/harness/`. Effort M. **All of these files belong to the other session.**

---

## 2. What can be deduplicated or simplified

### 2.1 Dead and test-only code

No references anywhere (grep over all `.ts`/`.tsx`, tests included):

`engine/src/generators.ts:681` `_internal`, `engine/src/outreach.ts:193` `_time`, `evals/src/runRec.ts:199` `_test`, `engine/src/judgeCommon.ts:91` `isYes`, `engine/src/opportunity.ts:18` `TERMINAL_STATES`, `judge/src/runlog.ts:46` `RunRecordType`, `judge/src/runlog.ts:55` `readRunLog` (**other session's file**), `sim/src/time.ts:37` `isWeekend`, `sim/src/time.ts:61` `deferOutOf`, `evals/src/report.ts:9` `MODEL_NOTES`, `evals/src/recDataset.ts:43` `REC_DATASET_V1`, `evals/src/publicView.ts:21` `PROMPT_VERSION`, `messaging-blooio/src/blooio/webhook.ts:21` `DELIVERY_HEADER`, `engine/src/config.ts:24,88` `timezones`.

Whole modules that only tests use (no runtime caller in sim, network, observatory or evals):

- `engine/src/opportunity.ts` (246 lines: `transition`, `dispatchInvites`, `inviteAlternates`, `visibleTo`, `createOpportunity`).
- `engine/src/outreach.ts` (193 lines: `OutreachController`, budgets, quiet hours).
- `engine/src/tick.ts` (59 lines: `MatcherScheduler`, `MemoryProposalStore`).

These are the PRD 33 state machine and outreach controller. Both Networks re-implement simpler versions inline. Two choices:

1. **Adopt**: `ConsentNetwork` uses `outreach.decide()` and `opportunity.transition()`. This is the right long-term choice: one tested implementation of F20 and F28, which production needs anyway.
2. **Delete** about 500 lines plus their tests.

Do not keep both. Effort: delete S, adopt L.

The grep-based unused-export scan is in the scratchpad (`usage.txt`, 1,096 exports, 351 not used by any non-test source). Most of these are fine: package-internal helpers that tests exercise. `ts-prune` reported 317 entries, mostly `export *` false positives. Neither tool's raw list is worth acting on wholesale.

### 2.2 Over-abstraction and parallel paths

- **Judge passes (engine).** `judge.ts` (234 lines) + `judgeScreen.ts` (266) + `judgeDeep.ts` (436) + `judgeCommon.ts` (199) = 1,135 lines. They contain three context builders (compact pass-2 view `judge.ts:111-135`, public view `judgeScreen.ts:78-140`, deep context `judgeDeep.ts:116-245`), six system prompts (v2/v2.1 and v3 for each pass), three parsers that share about 70% (`parseVerdict` `judge.ts:146-180`, `parseScreenVerdict` `judgeScreen.ts:218-241`, `parseDeepVerdict` `judgeDeep.ts:350-382`), and three identical run-one loops (see 1.4). Pass 2 v3 already reuses pass 3's context (`judge.ts:94-107`), which shows that one builder with a visibility level (public, matchable, private-redacted) is enough. `hardGate` (`judgeDeep.ts:392-405`) re-states checks from `filters.ts` (`involvesMinor`, holds, blocks, opt-ins).
  Plan: one `buildPassContext(w, c, { visibility, version })`, one `runPass({ messages, parse, maxTokens })`, one base parser plus per-pass fields, and `hardGate` = `candidateReason` restricted to the safety reasons. After the judge-v2 comparison (`evals/src/judgeV2.ts`, `docs/results/2026-10-07-judge-v2.md`, not yet written) picks a winner, delete the losing prompt versions (`SCREEN_SYSTEM_V2`, `DEEP_SYSTEM_V2`, `JUDGE_SYSTEM`/`JUDGE_SYSTEM_V3`, `JUDGING_NOTES` vs `JUDGING_NOTES_V3`) and the `pass2Context` flag. Effort M. **Coordinate with the in-flight judge-v2 work. Do not start before it commits.**
- **Pipeline semantics in two places.** `evals/src/runPasses.ts:230-262` (`pass2Yes` "mirrors the engine", `pipeline`) re-implements the decision logic of `engine/src/engine.ts:122-176`. Export `pass2Accepts(v, cfg)` and `pipelineDecision(...)` from the engine, and use them in both places, so that evals measure exactly what ships.
- **Evals entry points.** `evals/src/cli.ts` (three suites), `judgeV2.ts` (new suite runner), `analysis/lunaErrors.ts` and `analysis/labelAttribution.ts` (positional args). The three `run*` files share one shape: `pmap` over items, `withScope` per attempt, collect `HttpRecord`s, score. Once 1.4 exists, `runRec`, `runJudge` and `runPasses` become thin. Fold `judgeV2.ts` into `cli.ts --suite judge-v2` and use `parseArgs`. Effort M. In flight.
- `evals/src/publicView.ts` is a v2 wrapper over the engine view (`:14-19`). Keep it until the v2 prompts are retired, then delete it.
- **Default output paths overwrite dated results.** `evals/src/cli.ts:13,55` defaults `--out` to `docs/results/2026-10-06-model-comparison.md`, so a rerun silently rewrites a historical result. Default to `runs/evals/results/`.

### 2.3 Duplicate tests

The duplication is modest. Most overlap is deliberate (unit vs end-to-end). Worth merging:

- The evals tests rebuild the same recommender dataset at least 6 times: `dataset.test.ts:9` and `:22-26` (twice), `privacy.test.ts:10`, `passes.test.ts:16`, `datasetV2.test.ts:18`. Each build is 4-7 s (measured: 7.1 s plain, 4.1 s richness). This is most of the 52 s evals run. A memoized fixture (`test/fixtures.ts` with `once(() => buildRecDataset(...))`) cuts it to about 15 s.
- The prompt-hygiene checks "no canaries / names / ids / labels in any prompt" exist in both `evals/test/privacy.test.ts:20-62` (rec view) and `evals/test/passes.test.ts:28-70` (pass prompts), with the same banned-word regex written twice. Use one parameterized test over all prompt builders.
- Minors are covered at 3 levels (engine `minors.test.ts`, sim `minors.test.ts`, connector `minors.test.ts`). Keep all three. They test different layers.

### 2.4 Stale docs and comments

- **Model.** The committed `README.md` (HEAD) still says Cerebras `qwen-3.8-27b`. The working-tree README is already fixed but not committed. Still stale: `.env.example:1-3` (Cerebras first); `packages/engine/README.md:21,114,135,195` ("139 offline tests + 1 live test (needs CEREBRAS_API_KEY)". The actual count is 212 offline and the gate is `DEFAULT_LLM_PROVIDER`.); `packages/sim/README.md:174,212,225,251`; `docs/prototypes.md:11,16,20,42,115-121,149`; `docs/test-plan.md:828-835,993-1047` (Cerebras cost model); `scripts/synthetic/generate.ts:476`; the `core/src/llm.ts:1` header.
- **Policy.** `docs/prototypes.md` §0.2 still frames minors as an open `agePolicy` question. The founder decision (2026-10-05) is that minors may join but are never connected (`engine/src/filters.ts:26-31`). Add a dated "superseded" banner. Do not rewrite the planning docs.
- **Broken references.** `docs/network.md` (cited by `network/src/network.ts:1` and `sim/src/oracle.ts`) does not exist. `docs/results/2026-10-07-judge-v2.md` is cited by `engine/src/config.ts:68`, `engine/src/judgeCommon.ts:116`, `evals/src/judgeV2.ts:2` and `labelAttribution.ts`, but is not written yet (in flight). `docs/connector-changelog.md` (from `mcp-server-design.md`) is missing.
- **Stale comments.** `engine/src/types.ts:1-2` ("proposed for promotion into core"; still true but no owner); `sim/src/network.ts:1-3` ("later the real Eliza agent"); `core/src/llm.ts:158`: the `OpenAILLM` default model reads `JUDGE_MODEL`, a leftover from when OpenAI was only the judge.

---

## 3. Test infrastructure

### 3.1 Why "bun test packages prototypes" could take more than 30 minutes

**Not reproduced today.** The exact command took 215 s (650 pass, 2 fail). Without the observatory it took 220 s. A sibling agent's logs in the shared scratchpad show 78 s with no keys and 221 s with keys.

The mechanisms below explain how the same suite can take 30+ minutes without hanging:

1. **Bun loads `.env` from the cwd.** Verified: `process.env.SURPLUS_API_KEY` is set in the repo root and unset in `packages/core`. From the root, all LLM keys are set, so every live test runs. Per-package runs (`cd packages/x && bun test`) skip them. This is why per-package runs feel fast. The live tests are about 140 s of the 215 s.
2. **The live tests are gated on "a key exists", not on an opt-in.** `core/src/llm.smoke.test.ts:3`, `openai.smoke.test.ts:3`, `surplus.smoke.test.ts:3`, `engine/test/judge.live.test.ts:10`, `sim/test/live.test.ts:7`, `judge/test/live.test.ts:11`. Only `messaging-blooio/tests/live.readonly.test.ts:10-11` uses a real opt-in (`BLOOIO_LIVE_TEST=1`).
3. **The core client has no default request timeout and retries with backoff.** `timeoutMs` defaults to none (`core/src/llm.ts:45-46,99`). `maxRetries` defaults to 4 with `1+2+4+8 s` backoff (`:79,87-90`), after the Surplus-to-OpenAI fallback. A slow or rate-limited provider (for example while other agents run `judgeV2.ts --max-spend`, as one was during this review) makes each live test run until its own timeout. The live timeouts sum to 1,050 s (17.5 min): 3×60 + 180 + 90 + 180 + 300 + 120.
4. **The CPU-heavy tests have very large budgets.** The explicit timeouts in the suite sum to about **7,570 s (2.1 h)**. The large ones: observatory `T` = 120-300 s on 18 tests, network `T` = 300 s on 4 tests, evals `beforeAll` 120-300 s on 4 files, `datasetV2` 300+180 s. These tests are single-threaded simulation work (network 21-day worlds 8-16 s each, the evals dataset 4-7 s per build). When several agents run simulations, evals and the observatory server on the same machine (all three were running during this review), these tests slow down in proportion but stay inside their budgets. The suite stays green and takes much longer.
5. **Bun cannot stop synchronous work.** A test that times out is marked failed, but its promise chain keeps running in the same process and competes with the following files. This is how one slow world step cascades.

What it is **not**:

- **Open handles.** Checked: Bun exits after the last test even with a pending `setInterval`, a listening `Bun.serve`, and a hung `fetch` (scratchpad experiment `consol/handles/a.test.ts`: done in 2 s).
- **Unrelated test files.** `reference/eliza-homepage` tests do not match the `packages`/`prototypes` path filters.

**Server left running.** The observatory tests start a real Postgres (`observatory/test/pg.ts:11-12` → `db/dev-pg.ts:39-43`, `pg_ctl start`) on :54339 and never stop it. That is harmless for speed. But `testDb()` runs `drop schema ... cascade` on the shared `network_test` database with no `lock_timeout` (`dev-pg.ts:54`). Two sessions that run the observatory tests at the same time can block each other until the 120-300 s budgets expire.

**Coverage gap.** `bun run test` (`bun test packages prototypes`) never runs `scripts/synthetic/synthetic.test.ts`, and the root tsconfig checks only the 2 imported files in `scripts/synthetic`.

### 3.2 Tests that make network or LLM calls

| Test | Calls | Gate today |
|---|---|---|
| `core/src/llm.smoke.test.ts` | 1 Cerebras call | `CEREBRAS_API_KEY` set |
| `core/src/openai.smoke.test.ts` | 1 OpenAI call | `OPENAI_API_KEY` set |
| `core/src/surplus.smoke.test.ts` | 1 Surplus call (`judgeLLM`) | `SURPLUS_API_KEY` set |
| `engine/test/judge.live.test.ts` | 3 judge calls (+ retries) | provider key via `endpointsFor` |
| `sim/test/live.test.ts` | 3 persona enrichments + an LLM persona agent over 3 sim days (many calls) | provider key |
| `judge/test/live.test.ts` | 12 calibration items (concurrency 4) + 1 | provider key |
| `messaging-blooio/tests/live.readonly.test.ts` | Blooio read-only API | `BLOOIO_LIVE_TEST=1` and key |
| `observatory/test/{server,real,consent}.test.ts` | Local Postgres (starts it) | `pg_ctl` installed |
| `messaging-blooio/tests/first-send-guard.test.ts` | Spawns `bun run first-send.ts` 3 times with an empty key; exits before any network use | none needed |

All other tests are offline (fake `fetch`, in-memory channels, `port: 0` servers stopped in `afterAll`).

### 3.3 Fixes

1. Gate every live test on `LIVE=1` (keep the key check as a second condition). Add `"test:live": "LIVE=1 bun test packages prototypes"`.
2. Make the root `test` script run each package from its own directory (`bun run --filter './packages/*' --filter './prototypes/*' test`, plus `scripts/synthetic`). This also removes cross-file interference and runs packages in parallel. Alternatively add a `bunfig.toml` with `[test] preload` that clears the keys unless `LIVE=1`.
3. Set a default `timeoutMs` (for example 120 s) in `chatCompletions`, and `maxRetries: 1` in live tests.
4. Add a memoized evals dataset fixture (saves about 35 s), and lower the 300 s `T` budgets to about 3× the measured time so that a regression fails quickly.
5. Give `testDb()` a per-process database name (`network_test_${process.pid}`) or `SET lock_timeout`.

Effort S in total. Risk low.

---

## 4. Dependency hygiene

- **Workspace dependencies are declared but not used.** `packages/evals` declares `@thenetwork/{core,engine,judge,sim}` (`evals/package.json`) but has 0 `@thenetwork/*` imports and 69 relative imports into other packages' `src/` (for example `evals/src/runPasses.ts:8-20`, `evals/src/recDataset.ts:5-11`, `evals/src/analysis/lunaErrors.ts:11-14`).
- **Imports with no declared dependency:**
  - `sim/engines/engine-v1.ts:2` and `sim/test/sources.test.ts:6` import the engine; sim does not depend on engine.
  - `engine/test/complementarity.test.ts:8` imports sim (reverse direction).
  - `messaging-blooio` imports core by relative path (`src/main.ts:6`, three tests) and has no `dependencies`.
  - `prompt-opt` imports `../../../packages/core/src/llm.ts` and has no `package.json`.
  - `observatory/src/server.ts:9` and `observatory/web/map.ts:6` reach into `../../network/src/...` instead of `@thenetwork/network`.
- **`scripts/synthetic` is a library without a package.** `network/src/{experiment,scenarios}.ts`, `network/test/network.test.ts`, `observatory/src/sources/game.ts:10-11`, `observatory/db/writer.ts:7`, `observatory/test/*`, and `engine/experiments/*` all import `scripts/synthetic/{load,common}.ts` by deep relative paths. Move `load.ts` and `common.ts` into `packages/sim/src/dataset.ts` (the sim already owns `Persona`), or make `scripts/synthetic` a workspace package. Keep `generate.ts` and `validate.ts` as scripts.
- **Production code depends on the simulator.** `packages/network` depends on `@thenetwork/sim` for vocabulary, `parseYesNo`, the Network interface, `Rng`, and `generatePersonas` (see 1.2, 1.6, 1.9).
- **Version pins.**
  - `@types/bun: "latest"` (root). Pin it to the Bun in use (1.4.2).
  - `typescript ^5.6.0` resolves to 5.9.3. That is fine.
  - `@modelcontextprotocol/sdk` is pinned exactly at 1.32.1, which is good for a protocol SDK. `zod ^4.1.0` resolves to 4.6.5.
  - Observatory: `react`/`react-dom ^19.1.0` resolve to 19.3.0, `leaflet ^1.9.4`, `d3-force ^3.0.0`. Caret ranges are acceptable for a dev tool.
- **`bun.lock`.** The uncommitted diff adds only the `packages/network` and `packages/observatory` workspaces and their 12 transitive packages (react, leaflet, d3-*, @types/*). It matches the package.json files. Commit it together with those two packages, not separately. `bunx ts-prune` during this review did not touch it (mtime unchanged).
- **Install layout.** Bun uses isolated installs (per-package `node_modules/@thenetwork/*` symlinks, no root `@thenetwork` links), so a missing dependency declaration fails at runtime only for bare `@thenetwork/x` imports. The relative imports above hide the missing declarations. Converting them to bare imports surfaces the gaps.

---

## 5. Prioritized plan

Ownership key: **[OS]** = touches files of the other session named in the brief. **[JV2]** = touches the in-flight judge-v2 files. **[free]** = no current owner.

| # | Change | Files | Risk | Effort | Unlocks | Owner |
|---|---|---|---|---|---|---|
| 1 | Test infra: `LIVE=1` opt-in for the 6 live tests; per-package root `test` script that includes `scripts/synthetic`; core default `timeoutMs`; memoized evals dataset fixture; per-pid test database | root `package.json`, the 6 live test files, `core/src/llm.ts`, `evals/test/*`, `observatory/test/pg.ts` | Low | S | A full suite in about 1 min offline; reliable CI; no surprise spend | **[OS]** root `package.json` and `pg.ts`; **[JV2]** `llm.ts` and live tests |
| 2 | Remove the Cerebras provider and refresh stale model and policy docs (banners on `prototypes.md` and `test-plan.md`) | `core/src/llm.ts:129-142,171,185-194`, `llm.smoke.test.ts`, `.env.example`, engine and sim READMEs, `docs/*` | Low | S | One provider path; docs match the founder decisions | **[JV2]** `llm.ts`; READMEs are being edited |
| 3 | Core `chatJson` helper; replace the 9 retry loops | core, `engine/judge*.ts`, `judge/{llmJudges,policy}.ts`, `sim/llmGenerator.ts`, `evals/run*.ts`, `generate.ts` | Low-Med (keep each site's budgets) | S-M | Item 7; consistent retry and spend behavior | **[JV2]** |
| 4 | One leak/PII guard (connector folding + contact patterns + canary list) used by engine, judge, network; **wire it into `ConsentNetwork` send**; remove the sim canary format from engine code | new `core/src/guard.ts`, `engine/{explain,judgeCommon}.ts`, `judge/rules.ts`, `network/{copy,network}.ts`, `connector-mcp/src/policy.ts` | Med (stricter: more fallbacks; re-run sim and evals) | M | Closes the AGENTS.md invariant gap; one place to harden | **[OS]** network; **[JV2]** judgeCommon |
| 5 | Product vocabulary and contracts into core: taxonomy ids, neighborhoods, CITY_TZ + `localParts` (one weekday convention), STOP/HELP/START, reply parsing, `NetworkUnderTest`/`Engine` interfaces | `core/src/{taxonomy,time,lexicon,network}.ts`, `engine/{taxonomy,outreach,config}.ts`, `sim/src/{taxonomy,time,channel,network,agent/policy}.ts`, `blooio/{keywords,quiet-hours}.ts`, network | Med (keyword union changes opt-out behavior; decide on purpose) | M | Removes network→sim and engine-test→sim dependencies; sim tests the real keyword policy | **[OS]** sim channel, network, agent/policy |
| 6 | Workspace hygiene: bare `@thenetwork/*` imports, declare missing deps, move synthetic `load`/`common` into a package, `package.json` for prompt-opt, pin `@types/bun` | `evals/src/**`, `sim/engines`, `blooio`, `observatory`, `network`, `scripts/synthetic` | Low (mechanical; `tsc` and tests catch it) | S-M | Correct dependency graph; typecheck and tests cover scripts | evals **[JV2]**; observatory/network **[OS]**; blooio and sim/engines **[free]** |
| 7 | Judge passes: one context builder with visibility levels, one runner, shared parser base; `hardGate` from `filters.ts`; engine exports `pass2Accepts` and `pipelineDecision` for evals; delete the losing prompt versions after judge-v2 concludes | `engine/src/judge*.ts`, `engine/engine.ts`, `evals/runPasses.ts`, `evals/publicView.ts` | Med (prompt bytes must not change for the kept versions; check with `--offline` replay) | M | About 400 fewer lines; evals measure exactly what ships | **[JV2]** |
| 8 | Dead code: remove the 14 unused exports and `cfg.timezones`; decide adopt-or-delete for `engine/opportunity.ts`, `outreach.ts`, `tick.ts` (recommend adopt in ConsentNetwork) | see 2.1 | Low (delete) / Med (adopt) | S / L | Less surface; one F20/F28 implementation | `runlog.ts` **[OS]**; adoption **[OS]**; the rest **[free]** |
| 9 | One persona→snapshot mapping: `generate.ts` calls sim `buildSnapshot`/`memberOf`; add `Intent.tags` to core and drop the `"(format; tags)"` string protocol | `scripts/synthetic/generate.ts`, `sim/src/snapshot.ts`, `core/types.ts`, `engine/taxonomy.ts` | Med-High (new dataset version; all baselines re-run) | L | One definition of "what the Network knows"; removes the divergence (`onlyWhenAsked`) | **[free]** (but re-runs touch everyone's results) |
| 10 | Small utilities: `core/{hash,async}.ts` (fnv1a, sha256, stable stringify with the evals cache-key algorithm, `mapLimit`), one stats module, one JSONL reader, `parseArgs` everywhere; rename one `Rng` (do not merge the algorithms) | see 1.7 | Low (high only if the RNG or cache-key algorithms change: forbidden) | S | Removes about 20 small copies | mixed |

Also worth doing, outside the top 10:

- Split the harness out of `packages/network` (`experiment.ts`, `scenarios.ts`, `growth.ts`) **[OS]**.
- Extract the shared `StubNetwork`/`ConsentNetwork` member-state base **[OS]**.
- Default the evals `--out` to `runs/` instead of dated result docs **[JV2]**.
- Rename `sim/agent/types.ts` `Intent` to `ReplyIntent` **[OS]**.

### 5.1 Safe order of operations

1. **Now, no conflicts.** Item 1 (root `package.json` only after the other session commits its own `package.json` edits; the live-test gating can land in a separate commit); the free parts of item 6 (blooio, `sim/engines`, `@types/bun` pin); the free parts of item 8; item 2 for `docs/prototypes.md` and `docs/test-plan.md` banners.
   - Check: `bun test` per package with unchanged counts; `tsc` clean.
2. **After the judge-v2 work commits** (it owns `llm.ts`, `judge*.ts`, evals): item 3, then item 7, then the evals part of item 6, then the Cerebras removal from item 2.
   - Check: `bun run packages/evals/src/cli.ts --suite passes --offline` gives identical scores (proves that the prompts and cache keys are unchanged); sim seed 1-3 metrics identical.
3. **After the other session commits** `packages/network`, `packages/observatory` and its sim edits: item 5 (contracts and vocabulary first, behavior-neutral; then keywords as a separate, measured behavior change), then item 4 (guard plus `ConsentNetwork` wiring), then the network and observatory parts of item 6.
   - Check: sim scenarios pass^k, network experiment arms seeds 1-3, canary leaks, minor contacts and invariant violations all 0, observatory tests.
4. **Last, as its own release**: item 9 (synthetic v1.3) and the adopt-or-delete decision in item 8, each with before/after numbers on the same seeds, as AGENTS.md requires.

Each step is one PR that the founders can review on its own. Pure refactors must show identical simulator and offline-eval numbers before and after. Behavior changes (keyword union, stricter guard, dataset v1.3) must show the measured difference.
