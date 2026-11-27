# Meetup Setup, External Matchmaking, and LLM/Sim Hardening (Pass 2)

Date: 2026-11-27
Branch: `feat/meetup-setup-external-matchmaking` (merged with `origin/develop` `cb0597ec9`)
Design reference: [2026-11-27-pass2-audit-and-architecture.md](../design/2026-11-27-pass2-audit-and-architecture.md)

## Scope and Model Settings

- **Deterministic simulation and eval runs:** No live LLM calls (`pnpm run sim` clears provider API keys before execution). The review judge uses the deterministic simulated stand-in judge (`simulatedReviewJudge`), and Clef relay checks use the deterministic offline classifier harness.
- **Seeds and sample sizes:**
  - `meetup` sim block: paired CRN (`baseline` vs `meetup`), 200 personas across 5 cities (`nyc`: 80, `sf`: 40, `la`: 40, `chicago`: 20, `miami`: 20), pinned seeds `[13, 14, 15, 16]` × 4 weeks (`n = 491` red-line checks, `n = 80` teen checks, `n = 57` panic-halt checks, `n = 26` no-show recovery events).
  - `five-city` sim block: pinned seed `42`, 16 end-to-end scenarios across 5 cities (`sf`, `nyc`, `la`, `chicago`, `miami`), 75 curated venues (`15/city`).
  - `evals` corpora: `evals/guard/leaks.jsonl` (`n = 264`, +25 dietary/allergen red-line rows), `evals/meetup/matchmaker-spam.jsonl` (`n = 48`), `evals/meetup/external-age-screening.jsonl` (`n = 48`), `evals/meetup/external-adversarial.jsonl` (`n = 36`), `evals/review/review-packets.jsonl` (`n = 89`, +8 external-event and matchmaker packets).
  - `network` sim block (`--quick`): seed `3` (10-day invariants, 7-day exception arm) and seed `1` (teen world + stopped teen world).

## Generated vs. Hand-Written Artifacts

- **Generated (produced by `pnpm run spec:sync`, 0 manual edits; verified by `pnpm run spec:check-generated`, 281/281 artifacts):**
  - `packages/core/src/generated/venueSelection.ts` (from `spec/venueSelection.md`, 27/27 Dafny obligations proved)
  - `packages/core/src/generated/suggestionFlow.ts` (from `spec/suggestionFlow.md`, 10/10 Dafny obligations proved)
  - `packages/core/src/generated/meetupCoordination.ts` (from `spec/meetupCoordination.md`, 12/12 Dafny obligations proved)
  - `packages/core/src/generated/externalEventBridge.ts` (from `spec/externalEventBridge.md`, 10/10 Dafny obligations proved)
  - `packages/core/src/generated/externalMatchmaker.ts` (from `spec/externalMatchmaker.md`, 12/12 Dafny obligations proved)
  - `packages/core/src/generated/staffPermissions.ts` (from `spec/staffPermissions.md`, 18/18 Dafny obligations proved)
- **Hand-written:**
  - Specs and whole-flow Quint models: `spec/{venueSelection,suggestionFlow,meetupCoordination,externalEventBridge,externalMatchmaker,staffPermissions}.md` and `spec/models/{venue_lifecycle,meetup_coordination,external_event_bridge,external_matchmaker}.md` (`spec/lock.json` kept byte-identical to `origin/develop` pending product-owner `pnpm accept`).
  - Additive idempotent migration: `packages/db/migrations/0100_meetup_pass2_hardening.sql` (`0098_meetup_venues_external_matchmaking.sql` and `0099_five_cities_venues_followups.sql` kept byte-identical to `origin/develop`).
  - Core, engine, network, service, marketing, observatory, CLI, sim, and tests: `packages/core/src/{cities,externalEvents,externalMatchmaker,guard,index,smsCopy,time,types,venues}.ts`, `packages/blooio/src/quiet-hours.ts`, `packages/engine/src/{engine,judge,judgeCommon,judgeDeep,judgeScreen,relay,relayClef,reviewJudge}.ts`, `packages/engine/src/packs/{network/{judgeContext,prompts},peon/{copy,judge},slop/{extract,judge,plan,score}}.ts`, `packages/network/src/{copy,extract,group-late-arrival,network,relay}.ts`, `packages/network/service/{meetup-store,monthly-gatherings,packs,public-events,runtime,serve,service,solo-concierge,travel-presence}.ts`, `packages/platform/src/accounts.ts`, `apps/marketing/{db/schema.sql,src/{agent-lifecycle,cities,store}.ts}`, `apps/observatory/src/staffSteps.ts`, `scripts/city-seed.ts`, `packages/sim/src/apps/meetup/*`, `scripts/sim/{meetup,evals,relay}.ts`, and new/updated test suites.

## Pass 1 vs. Pass 2 Before/After Metrics

| Metric / Gate | Pass 1 Baseline (`0a65071f4`) | Pass 2 Result (Post-Merge) |
|---|---|---|
| `0098`+`0100` Postgres production callers | `0` (test-only raw SQL) | Live `PgMeetupStore` + `runtime.ts` atomic `Unit` + `svc.purge()` + 8 HTTP/webhook routes + `scripts/city-seed.ts` |
| Red-line venue enforcement (`slop`, `friends`, `ntwrk`, `peon`) | Bypassed on `slop` & `friends`; silent unfiltered fallback | `0/491 (0.0%)` red-line breaches; fail-closed on empty pool |
| External 18+ age screening (`evals/meetup/external-age-screening.jsonl`, `n = 48`) | Accepted `"yes, 12"`, `"not 18"`, `"turning 18"`; rejected `"18+"`/`"21+"` | `0` minors accepted, `0` negated/injected accepted, `100.0%` adult recall |
| Dietary/allergen `LeakGuard` (`evals/guard/leaks.jsonl`, `n = 264`) | Missed 1-word `halal`/`kosher`/`celiac`/`allergy` leaks | `100.0%` recall, `0` false positives |
| Matchmaker anti-spam & injection screening (`n = 48` spam + `n = 36` adversarial) | Bypassed by `slop[.]date`, `the n3twork`, `bit.ly/...`, unscreened webhooks | `100.0%` recall, `0` false positives, `100.0%` fenced with `fenceUntrusted()` |
| Production `fenceUntrusted()` & strict `reasoningFirst` enforcement | `0` production callers; forgeable `<<<MESSAGE>>>`; `reasoningFirst` ignored | Enforced across engine judges, `relayClef`, extractors, `reviewJudge`, external webhooks, and `apps/marketing` |
| `relay` simulation block | FAIL (`72/73`: `"My son is a 16-year-old"` false positive) | **PASS `74/74`** blocking gates (`0.9s`, incl. arrival window + panic halt) |
| `evals` simulation block | `40/40` (0 meetup adversarial corpora) | **PASS `48/48`** blocking gates (`0.9s`, +132 meetup/guard rows + 8 review packets) |
| `meetup` 5-city simulation block (seeds `[13..16]` × 4w) | Did not exist (`0%` coverage) | **PASS `14/14`** blocking gates (`0.2s`); sparse-city lift `5.50x` (`1.03` vs `0.19/mo`, `nycExt = 0.0%`), pivot acceptance `96.0%` (`maxPivots = 2`, `0` repeats, `0` style violations), no-show recovery `100.0%` (`n = 26`), panic halt `0/57`, teen all-ages `0/80` |
| `five-city` simulation block (seed `42`, 16 scenarios) | Pre-merge drift (`23/29`, 11/16 scenarios) | **PASS `29/29`** blocking gates (`2.6s`, 16/16 scenarios, 0 canary leaks, 0 teen-gate violations) |
| Security suite (`pnpm run security`) | `11` files (Pass 1 PG test unregistered) | **PASS `12/12`** files, **`298/298`** tests (`47.8s`) |

## Final Validation Commands and Results

All commands were executed inside `/Users/nubs/thenetwork-eliza-meetup` against local dev Postgres (`:54339`) with no provider LLM keys set:

```bash
pnpm run typecheck
# PASS: 0 errors across all 15 workspace projects

pnpm run spec:check-generated
# PASS: Checked 281 generated TypeScript and VibeLang artifacts.

node --import tsx --env-file-if-exists=.env plugins/build.ts --check
# PASS: plugin skill snapshots are up to date

pnpm run check
# PASS on 100% of model, always, replay, types, proof (10+12+12+18+10+27 obligations proved on our 6 specs),
# and traces (including soloConciergeJourney). Only expected review items await product-owner `pnpm accept`.

pnpm run quint:check venue_lifecycle meetup_coordination external_event_bridge external_matchmaker
# PASS: 4 models, 0 failures, 18 jobs, 50s

pnpm run security
# PASS: 12/12 test files, 298/298 tests

pnpm exec vitest run packages/core/ packages/blooio/ packages/engine/ apps/marketing/ \
  packages/platform/test/venues-five-cities.pg.test.ts \
  packages/network/test/five-cities-venues-work-intro.test.ts \
  packages/network/test/meetup-external-matchmaking.integration.test.ts \
  packages/network/test/shared-relay.integration.test.ts \
  packages/network/test/group-late-arrival.integration.test.ts \
  packages/network/test/review-judge.integration.test.ts \
  apps/observatory/test/five-cities.integration.test.ts
# PASS: 36/36 test files, 345/345 tests (re-verified post-fix on 5 affected files: 5/5 files, 40/40 tests)

pnpm run sim --only evals,onboard,slop,relay,peon,peon-seats,friends,meetup,five-city,marketing,clef,safety,ops,pipeline,pipeline-slop,audit
# PASS: 464/464 blocking gates across all 16 blocks:
#   evals 48/48, onboard 23/23, slop 57/57, relay 74/74, peon 30/30, peon-seats 23/23,
#   friends 67/67, meetup 14/14, five-city 29/29, marketing 12/12, clef 10/10,
#   safety 18/18, ops 12/12, pipeline 15/15, pipeline-slop 14/14, audit 18/18
#   (0 teen-gate violations, 0 canary leaks, 0 invariant violations)

pnpm run sim --only network --quick
# PASS: 106/106 blocking gates, 0 tracked off target, 524.6s
```
