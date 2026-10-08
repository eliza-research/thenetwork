# Cleanup report (2026-10-08)

Branch `chore/cleanup`, from `origin/main` at `16cde70`. The spec was the cleanup plan (inventory worktree, `CLEANUP-PLAN.md`) plus the founder decisions given with the task. Nothing was pushed. No LLM call was made: every simulation ran with the provider keys cleared. Git history was not rewritten.

## Before and after

| | Before (16cde70) | After |
|---|---|---|
| Tracked files | 1,304 | 538 |
| Text files / lines | 1,239 / 511,763 | 535 / 108,769 |
| `git diff --shortstat 16cde70 HEAD` | | 1,032 files changed, 3,876 insertions, 406,870 deletions |
| Test-type files | 242 outside reference/ (plus 57 in reference/) | 7 (the pending security suite and its helpers) |
| Packages | core, engine, judge, sim, worlds, evals, capital, network, notify, mcp, platform, observatory, plugin-network, and 11 prototypes | core, engine, sim, capital, network, notify, mcp, platform, observatory, plugin-network, blooio |
| docs/ files | 127 | 63 (with this report) |

## Validation: `bun run sim`

`scripts/sim.ts` (root script `bun run sim`) is the single validation command. Blocks: `evals`, `network`, `slop`, `peon`, `friends`, and `capital` (only with `--with-capital`, `--nightly` or `--only capital`). Flags: `--only <block>` (repeatable or comma-separated), `--quick` (fewer seeds and shorter runs; quality gates become tracked), `--json <file>`. It clears the provider keys, needs no Postgres, and exits 1 on any blocking gate failure.

**Final run on HEAD:** `PASS: 152/152 blocking gates, 7 tracked off target`, **355 s wall** (236 s CPU): evals 0.6 s, network 225 s, slop 20 s, peon 49 s, friends 60 s. The machine was heavily loaded by other processes during every run (load average 30-70); the same run took 431 s to 1,168 s at other times. On a quiet machine expect a few minutes, dominated by the network block.

Pinned seeds (documented in each block's header in `scripts/sim/`):

| Block | Pinned | Blocking | Tracked (printed, never fail) |
|---|---|---|---|
| evals | the corpora in `evals/` | every corpus gate (24) | none |
| network | invariants: seed 3, 10 days; consent vs push: seeds 1-3, 21 days; every NYC scenario; `sim/scenarios/*.json` at pass^3 | 61 gates, incl. the networkPack conformance rules and the attention and plans invariants on the consent arms | 2 run fingerprints |
| slop | seeds 13-16, 4 weeks, 300 per city; population {catfish 0.005, body types}; world {verification, relay, 3-day review, widen, check-in, photo in probe sd 1, rater} | declared-minor contacts = 0, stated-filter violations = 0, scammer median reach <= 1, scam-harm cut, repeat harassment, second-date rate and count vs random, top-10% share, back-outs, rating-quintile floor; the world invariants; slop conformance incl. stated filters and never-shared ratings | dates/member-month >= 0.9x random (0.823), age-liar contact cut >= 90% (82.4%), adversary-contact cut >= 90% (47.4%), smallest gender/orientation group >= 0.7x (0.329; feasible 0.357), and harm-event cut >= 90% (86.9%) |
| peon | seeds 13-16, 8 weeks, 400 candidates / 80 jobs per city | the official gate set (10), positive controls, sealed-attribute invariance, the four-fifths negative control, conformance on two kinds of peon world | 1 fingerprint |
| friends | seeds 5-8, 8 weeks, 400 personas | the official gate set (8), harness caps, conformance incl. no romance, no minors in plans, adversaries held | trackedMetrics (undetected-adversary harm 1.67x vs target 0.5x), 1 fingerprint |

**Slop policy note.** "Harm events cut (not counting 'not single')" was not in the founder's tracked list, but it fails on the pinned seeds (86.9%, as I5.4 of the slop report predicts for seeds 13-16 at 4 weeks), so under "the quality gates that currently pass on pinned seeds are blocking" it is tracked.

**Conformance ported before deletion.** `scripts/sim/conformance.ts` runs the core rules for every pack on its own simulated worlds: minors never in any role (generators, proposals, alternates, via, asks, scored log, debt, attention items, probes), blocks win, consent before reveal under random answer orders (and anonymous probes), the member-facing leak gate (canaries and other members' private facts), and the judge cannot undo a hard filter (always-yes fake model). Slop adds its stated filters both ways with an orientation-rule negative control, and the never-shared rating checks; friends adds no-romance at every layer, no minors in plans, and held adversaries; peon adds sealed-attribute invariance and the four-fifths negative control. Determinism, attention-unit and geo-contract checks from the old suite were not ported (the sims are deterministic and their fingerprints are compared).

**Behaviour checks for the refactors.** Each block prints a run fingerprint (a digest of the arms' metrics, and of the network invariant run's records without wall-clock fields and engine run ids). `bun run sim --json` on archived snapshots of the commits gave identical gates, values and fingerprints: dead-code commit = keyword merge = core consolidation = taxonomy, worlds and judge moves = HEAD. The dead-code commit itself was compared against the fingerprint commit with a record-level diff: the only differences were the engine config hash (the config shape changed) and wall-clock fields.

## CI

- `ci.yml` job `offline`: install, typecheck (`-p .` and `-p sites/tsconfig.json`), `bun run sim`, `bun run plugins/build.ts --check`, the production sites build. No Postgres.
- New job `security (pending)`: the Postgres service, `require-pg.ts`, and `bun run security` (the six pending files).
- `plugin-network` job: typecheck only.
- `deploy-sites.yml`: the test step is gone; typecheck, build, deploy and the post-deploy `deploy/smoke.ts` stay. `CLOUDFLARE_ACCOUNT_ID` must be set as a CI variable (no default).

## Deleted

- **Prototypes:** connector-mcp (its output leak pipeline was ported first, below), poc-leak-gate, poc-agent-llm, poc-data-layer, poc-embeddings, poc-event-ingestion, poc-travel-time, poc-eliza-fit, poc-enrichment-sources, prompt-opt. `prototypes/` is gone (workspaces, tsconfig, Dockerfile, dockerignore, railway.toml updated).
- **reference/** (eliza-homepage, 12 MB, with real phone numbers), **packages/evals**, **packages/judge** (merged, below), **packages/worlds** (merged, below).
- **Tests:** every unit, smoke, live, conformance and golden test and helper (150 files plus the engine goldens), `tests/e2e`, `sites/test`, the deploy router and smoke tests, the scripts supply-chain, wrangler and synthetic tests, and every package `test` script and the root `test` / `test:e2e`.
- **Dead code:** `packages/engine/experiments` (15 files), `sim/experiments/primed-sweep.ts`, the world one-offs (`peon/{tune,diag}`, `friends/{calibrate,sweep}`, `slop/{calibrate,prose}`) and index barrels, engine `opportunity.ts`, `tick.ts`, `outreach.ts`, `bench.ts`, the shims (`generators`, `taxonomy`, `activities`, `judgeContext`), `packs/slop/fitClef.ts`, `sim/src/pack.ts`, `SimPack` / `SimPackRef` / `AppPack.sim`, `LEGACY_SNAPSHOT_FEATURES` / `legacyLinks`, the Cerebras provider, `liveTestsEnabled`, notify `connectorInbox` / `surfaceForHost`, and the unused exports the plan listed. Engine config flags removed: `PRESETS`, `categoryOverride` / `useCategoryOverride`, `acceptance.exponent` / `signals`, the `ask` block (`enabled`, `minFacets`, `holdNoWant`, `cooldownDays`; pack asks such as slop's and the romance-preferences ask are unchanged, so `ConsentNetwork.onAskAnswer` still has callers), `complementarity.retrievalChannel` / `channelMin`.
- **Blooio:** the simulated bus (`sim-adapter.ts`), the standalone receiver (`main.ts`, `server.ts`, `gateway.ts`, `dedupe.ts`), the scripts (`first-send`, `verify-readonly`, `env`) with `first-send-guard.ts`, the now-uncalled keyword handling, and the tests with their fixtures (which held real Blooio ids).
- **Docs:** the 14 listed docs (test-plan, prototypes, the three GTM docs, event-sources-outreach, research-compendium, results/2026-10-06-observatory with its 12 JPGs and 2 JSON, research audit, consolidation, connectors-and-loveofyourlife, mcp-server-design, connectors/other-assistants), the 25 superseded results JSON, and the 11 docs folded into SUMMARY.

## Merged and moved

- **messaging-blooio -> `packages/blooio` (@thenetwork/blooio)**, imports updated in deploy/backend, network (service) and notify.
- **packages/worlds -> `packages/sim/src/apps/{slop,peon,friends}`**; the Network world stays the main sim. `sim/engines/engine-v1.ts` -> `sim/src/engineAdapter.ts`. friends `ARMS` moved to `friends/arms.ts` so `cli.ts` no longer runs on import; the peon, friends, slop packEval, capital and network scenarios CLIs exit 1 when an official gate fails.
- **Keywords:** one STOP / HELP / START table, the keyword normalization, the carrier copy and the strict free-text opt-out reading (`optOutPhrase`, moved verbatim from the platform) live in `core/replies.ts` beside `parseOptOut`. The platform consent ledger and the simulated channel read it; blooio's keyword code had no caller left. The platform opt-out corpus scores the same; the sim channel now also knows REVOKE, OPTOUT, OPT OUT, STOP ALL, SUBSCRIBE and RESUME (no simulated member says them, so the sims are byte-identical).
- **RNG:** `core/rng.ts` holds the simulator's forkable `Rng` (with `hash32`, `clamp01`), `fnv1a`, and the engine's stream as `EngineRng`. `sha256` / `stableStringify` stay in the engine as `engine/src/hash.ts`.
- **Time:** `core/time.ts` (`CITY_TZ`, `localParts`, `fromLocal`, `inQuietHours`); sim time reads it; `DAY` / `HOUR` / `MINUTE` and `Clock` come from `core/clock.ts` in blooio, capital, judge, platform otp and the observatory web store.
- **chatJson:** the simulator's retry loop is replaced by core `chatJson` (same 1.5x growth up to 8,000 tokens).
- **Leak guard:** core `LeakGuard` is the one gate; engine `explain.ts` calls `leaksMemberFacing` directly (alias removed).
- **Budgets and the judge:** `network/src/outreach.ts` is the single source (OUTREACH plus `PRD_BUDGETS`, `LANE_BUDGETS` and `CONNECTION`, moved verbatim). The run-log schema moved to `core/runlog.ts`; the grader (`rules`, `metrics` / `computeMetrics`, the LLM graders) moved to `packages/sim/src/judge`; the unused LLM policy judge and calibration set were deleted. Production (`network/src`, `network/service`) no longer imports `@thenetwork/judge` or `@thenetwork/sim`: a bundle of `deploy/backend/server.ts` contains no module from either.
- **Out of sim, for production:** the Network-environment contract and channel message types -> `core/network.ts`; `STOP_CONFIRMATION` / `HELP_TEXT` -> `core/replies.ts`; the member vocabulary (INTERESTS, SKILLS, DESIRES, NEIGHBORHOODS, `skillFirstPerson`) -> `engine/src/packs/network/vocabulary.ts`.
- **Corpora -> `evals/`:** the network fixtures, the core replies corpus (184 rows, extracted from the test), the core opt-out cases, the platform opt-out corpus, and the guard evasion, homoglyph and fuzzy rows (132).
- **MCP:** connector-mcp's output pipeline (phone, email, internal-id and ISO-timestamp checks on top of core LeakGuard) is `packages/mcp/src/leaks.ts`; `get_updates` withholds any summary that fails it; `bun run sim` checks it (evals block).

## Docs

New `docs/results/SUMMARY.md` (one section per folded topic plus one line per prototype verdict) and `docs/prd-pending-edits.md` (unapplied PRD edits only). `data/synthetic/README.md` absorbed `data-model-sources.md`. Iteration logs trimmed: slop-pack 1,740 -> 607 lines, peon-pack 1,078 -> 213, attention-budget 482 -> 116, network-consent 374 -> 135, plans 262 -> 104. README, AGENTS (Commands; Hard rules as pointers; factual updates to Platform decisions 5, 7, 8 and 11), CONTRIBUTING and the package READMEs describe `bun run sim`. Stale names fixed (buddies -> friends in observatory.md and the apps README; "superseded" headers on research docs using buddies.nyc / ntwrk.club). Code comments that cited folded docs or deleted tests were repointed. The platform owner's docs were edited in place only (links, commands, private data).

## Private data

- Blooio org, channel and webhook ids, the other two Blooio-org numbers and the internal Tailscale hostname are redacted in `docs/research/blooio.md` (the fixtures that held real ids were deleted).
- The Cloudflare account id is gone from the tree: `CLOUDFLARE_ACCOUNT_ID` is required from the environment (`scripts/wrangler.sh` stops without it) and from the CI variable; `.env.example` leaves it blank; the wrangler.toml files never set `account_id`.
- `developer@elizalabs.ai` is replaced by "the Eliza Labs Cloudflare account". The Pages projects' account is called "the ntwrk.love Cloudflare account" so the two accounts stay distinct.
- The remaining emails in docs are public role addresses (mcp-review@ and directory@anthropic.com, vendor-incident@meta.com, api@letterboxd.com); the named-person emails were in the deleted docs.
- Absolute `/Users/...` paths in docs are repo-relative.
- Kept: the public 808 Network line. No history rewrite.

## Decisions still open

1. **The security suite** (6 files, CI "security (pending)"): keep or delete. The RLS cases that lived in delete-class files (`network/test/service-apps.test.ts:378`, `observatory/test/apps.test.ts:259`, `observatory/test/staff-apps.test.ts:110`) were deleted with them and not extracted, because the six kept files were to stay untouched; they are in history at 16cde70 if the suite is kept.
2. **Slop gates:** the five tracked gates above (and their targets) and whether the pinned seeds 13-16 at 4 weeks stay the CI set.
3. **Receiving budget:** `PRD_BUDGETS.receiving` is 0 / 7 days for unsolicited sends while `OUTREACH.budget.receiving` is 2 / 7 days for initial invites (support-only). Values were moved unchanged.
4. **Engine-side budgets:** `engine/config.ts budgets` and `DEFAULT_ATTENTION.caps` still carry their own numbers (the engine cannot import the network package); the plan suggests moving shared values into core.
5. **`effectiveAge`** was removed as unused, but AGENTS Platform decision 11 asks for the lowest stated age "wherever ages meet"; reinstate it in `core/policy.ts` when a caller needs it.
6. **History rewrite** for the 808 number or the Blooio ids (now only in history): founder call, last, with a coordinated force-push.
7. **PRD Google Doc sharing:** check it is not "anyone with the link" (its id is in README, AGENTS, CONTRIBUTING and the snapshot).
8. **Housekeeping not done** (out of scope for this branch: other worktrees were not to be touched): the merged remote and local branches, the stale worktrees, `runs/evals` and old `runs/run-*` locally (never `runs/pg`).

## Deliberately skipped

- **Phone normalization** was not merged: `platform/phone.ts` (strict +1, SMS-pumping area codes), `blooio/phone.ts` (international E.164 plus email and chat ids, the key of the queue and ledger) and the sites' browser pre-check do different jobs; one function would change who can sign up or how the queue keys addresses.
- **One RNG class:** the engine keeps its own stream (`EngineRng`) in `core/rng.ts`; switching it to the simulator's would re-draw every engine run.
- **Judge rules vs core LeakGuard:** the grader's contact and style rules (`sim/src/judge/rules.ts`) and the scenario fact check stay separate from the gate: they grade outputs, and swapping their patterns would change the grades.
- **`judge.screen.enabled` and `judge.pass2Context` ("compact")** stay: they are part of the judge-pack contract and of the judge cache key, and the conformance sim exercises the screen pass.
- **blooio `CITY_TZ`** (a lowercase-city fallback without "la") was left as is.
- **`scripts/synthetic/{generate,validate,names}.ts`** stay (the plan marks their deletion as medium and optional). The dataset manifest's `simGeneratorSourceSha256` no longer matches `sim/src/generator.ts` (the `legacyLinks` option was removed; the generated data is unchanged), so `validate.ts` may report the mismatch.
- **The ~300 exports used only inside their own file** were not made private (low priority in the plan).
- **The observatory's game mode and takeover** still import `@thenetwork/sim`: they are the simulator, loaded lazily.
- **Historical docs** (research, audit, results kept for the record) still mention `prototypes/connector-mcp` and quote commands for deleted code; SUMMARY.md says so.
- **The security suite was not run here:** it needs the dev Postgres on :54339, which belongs to the primary checkout. It typechecks.

## Final checks

- `bunx tsc --noEmit -p .` and `bunx tsc --noEmit -p sites/tsconfig.json`: clean.
- `bun run sim`: 152/152 blocking gates, 355 s (above).
- `DEPLOY_TARGET=production bun run sites/sites.ts`: builds the four sites (warnings only for the missing `TURNSTILE_SITE_KEY`, as in CI).
- `bun run plugins/build.ts --check`: plugin skill snapshots are up to date.

## Commits

```
26eda78 mcp: output leak gate on get_updates summaries (ported from connector-mcp)
4274a8b sim: bun run sim, the single validation command; corpora move to evals/
b151e25 ci: run bun run sim instead of the test suites; security (pending) job
bc84f6e sim: run fingerprints (tracked) so refactors can be compared byte for byte
ee1e2ae Delete the prototypes (except messaging-blooio), reference/ and packages/evals
cf7ab5f Promote messaging-blooio to packages/blooio (@thenetwork/blooio)
9f68475 Delete the unit, smoke, conformance and golden tests (simulations only)
47a46c3 Delete dead code: experiments, shims, unused exports and config flags
4d2789c sim: leave wall-clock fields and engine run ids out of the network fingerprint
d14a96c core: one STOP/HELP/START keyword table and opt-out reader in replies.ts
99b34a2 core: one rng, one set of time helpers, one chatJson, one leak gate path
ec5e430 Production stops importing the simulator: contract types to core, vocabulary to networkPack
c1fefb3 Merge packages/worlds into packages/sim/src/apps/{slop,peon,friends}
deebe62 Budgets in network/src/outreach.ts; the judge moves into the sim; packages/judge is gone
cc0046b docs: README, AGENTS, CONTRIBUTING and package READMEs for bun run sim
242fc9c Cloudflare account id from the environment, no hardcoded defaults
0c92cf3 docs: fold, trim and delete per the cleanup plan; redact private data in docs
1142bbe Name the Cloudflare accounts: Pages projects in the ntwrk.love account, slop/friends zones in Eliza Labs
```

Plus the commit that adds this report.
