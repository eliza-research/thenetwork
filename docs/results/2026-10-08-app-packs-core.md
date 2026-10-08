# App packs, core: the AppPack contract and networkPack

Date: 2026-10-08. Branch `engine/packs` (worktree `/Users/shawwalters/thenetwork-packs`), based on `origin/main` @ `976a39e`. No LLM calls; tests ran with API keys unset and no `LIVE_TESTS`.

**Goal.** One engine with app packs powers four apps:

| App id | App | Pack |
|---|---|---|
| `ntwrk` | The Network | `networkPack` (this work) |
| `slop` | slop.date (dating, first priority) | `slopPack` (next) |
| `peon` | peon.biz (hiring) | `peonPack` |
| `friends` | friends.help (NYC friends; formerly buddies.nyc) | `friendsPack` |

**Spec.** `docs/research/2026-10-08-engine-generalization.md` and `docs/research/2026-10-08-platform-architecture.md` §6.

**Result.**
- The contract is defined, and The Network runs behind it.
- Every golden is byte-identical, both the fast tier and the full tier.
- The conformance suite passes for `networkPack` (11 checks). Its mutation checks fail when a core rule is removed, as they should.

## 1. The interface

Import path: `import { type AppPack, networkPack, validatePack, cityBucketGeo } from "@thenetwork/engine"`. The source is `packages/engine/src/pack.ts`.

### 1.1 Core invariants

The core owns these invariants, and a pack cannot loosen them:

1. **Minors.** Members aged 13-17, and members with a missing or invalid age, may join but are never matched in any role.
   - A pack can raise `eligibility.minMatchAge` but never lower it below 18; `validatePack` rejects a lower value.
   - The rule is enforced in the world index, the member, pair and configuration filters, the final guard, the attention gates, probes and plans.
2. **Blocks win.**
3. **Hard filters first.** Hard filters run before scoring and before every judge pass. The judge can only remove candidates; the core hard gate runs before the pack's gate.
4. **LeakGuard.** Every member-facing string goes through LeakGuard.
5. **Determinism.**
6. **Consent before reveal.**

### 1.2 What a pack provides

| Slot | What it holds | networkPack |
|---|---|---|
| `ontology` | Lanes (`LaneDef`: opt-in mode, `adultOnly: true`, `shipsAlone`, `neverInPlans`), roles and contributor roles, kinds, warm edges, the funnel probe lane and role, objectives, `objectivesFor`, `mutualPreferenceMatch`, `relabelIntent`, `constraints(boundaryFacets)` → `{dealbreakers, romance}`, `isHost` | 7 lanes, 10 roles, 9 kinds, the taxonomy, romance tag parsing, growth relabelled as hobby |
| `eligibility` | `minMatchAge`, `accountTiers` (never matchable), and ordered rule lists (see below) | 18; a 13-17 personal-agent tier; today's rules in today's order |
| `geo` | `GeoModel`: `markets`, `tz`, `location`, `overlap` (the core geo filter), `sharesArea`, plus optional `pairReason` (radius) and `displayDistance` | `cityBucketGeo`; ids stay `sf`/`nyc` |
| `generators` | Ordered `GeneratorSpec[]`; the order is part of the contract | The 11 generators |
| `retrieval` | Channels and directions | Members for intents |
| `scoring` | `aggregate` (default: harmonic for pairs, average-without-misery for groups), plus `novelty` and `socialRisk` hooks applied at the same arithmetic point as before | `mutualBenefit`; expansion and second-encounter novelty; romance +0.1 |
| `selection` | Optional `adjust` hook on the greedy key, `askQuestions`, `extraAsks` | No `adjust`; the romance-preferences ask |
| `consent` | `ConsentFlow`: `probe_first`, `double_opt_in`, `application` or `group_rsvp`, per kind | Probe first, wanter first, opt-out reveal; `group_rsvp` for groups |
| `attention` | Config, calibrator knots, `shipsAloneLane`, `noWarmMentionLanes`, `itemGate`, `probeAllowed`, `laneActivity`, `probeText` | `DEFAULT_ATTENTION`, the fitted knots, romance alone, the probe copy |
| `judge` | Screen, rubric (compact / matchable) and deep passes as `{version, system}`; `buildContext`; `hardGate` | Prompts moved verbatim; `buildPassContext`; romance and category opt-ins |
| `explain` | `laneLabel`, `facetPhrase`, `leadBits`, `kindBits`, `safeFallback` | `CATEGORY_LABEL`, `KIND_PHRASE`, sentences for growth, newcomer and second encounter |
| `plans` | Config, lane, activities | `social`, `ACTIVITIES` |
| `capital` | Earn and lose categories; `minorsExcluded: true` | The ledger categories |
| `sim` | A `SimPackRef`. The `SimPack<P,S,O>` interface (personas, snapshot, oracle, metrics and gates, adversarial kinds) is implemented in `packages/sim` | `packages/sim/src/pack.ts` `networkSimPack` |
| `metrics` | Primary metrics, blocking gates, unsafe classes | unsafe = 0, leaks = 0, invariants = 0 |
| `defaults` | Engine, attention and plans configs (the shared types, so hashes are unchanged) | The pre-refactor defaults |

**Eligibility ordering.** Pack rules run in addition to the core rules, and their order sets which funnel reason is recorded:
- **Member rules** run after the core prefix: `unknown_member`, `underage`, `safety_hold`, `state_paused`.
- **Pair rules** run after the core prefix: `duplicate_participant`, `underage`, `blocked`. The optional `geo.pairReason` runs last.
- **Configuration rules:**
  1. the core duplicate check;
  2. the pack's `candidatePreRules`;
  3. the core minors / `via` / member / pair checks;
  4. the pack's `candidatePostRules`;
  5. the core geo overlap.

**Threading.** `deps.pack` is a new optional field on `runEngine`; it defaults to `networkPack`. The engine passes it to `new World(input, cfg, embed, pack)`. Every module that has a World reads `w.pack`.
- **Attention** functions without a World take an optional trailing `pack` argument: `itemGate`, and `ComposeInput.pack` for `composeMessage`. `buildProbe` and `warmMention` read `w.pack`.
- **Plans** read `w.pack.plans` through `plansOf(w)`. `crewSessionPlan` takes `pack`.
- **New helper:** `startProbeFlowFor(proposal, pack)` maps the pack's consent flow onto the probe flow.

## 2. What moved

Every old module path still exports the same names, so no call site changed.

| From | To |
|---|---|
| `taxonomy.ts`, `activities.ts`, `judgeContext.ts` | `packs/network/` (moved whole; the old paths are re-export shims) |
| `generators.ts`: 11 generators and `GENERATORS` | `packs/network/generators.ts` (`NETWORK_GENERATORS`) |
| `generators.ts`: `makeCandidate`, `label`, `bestShareable`, `intentFormat`, `benefitForProvider`, `warmPathValue`, `eventRiskText`, `GenCtx` | `genkit.ts` (core) |
| `CATEGORY_LABEL`, `KIND_PHRASE`, explain sentences, `ASK_QUESTIONS`, `GENERIC_ACTIVITY`, probe frames | `packs/network/copy.ts` |
| Judge system prompts and versions (screen, v2.1, v3, deep), `JUDGING_NOTES(_V3)`, `CODE_ENFORCED_V3` | `packs/network/prompts.ts` (verbatim) |
| `STALE_DAYS`, `HYPOTHESIS_CONFIDENCE`, `CITATION_RULES` | `judgeConstants.ts` (core leaf module) |
| `filters.ts` Network rules: receiving-contributor, category and romance opt-ins, only-when-asked, budgets, quota, cooldowns, reliability, pair cooldowns, active duplicate, `romanceCompatible`, dealbreakers, group size, high risk, home entry | `packs/network/rules.ts` |
| `judgeDeep.hardGate` opt-in part | `rules.ts` `networkHardGate` (the core part stays in `hardGate`) |
| `world.ts` warm edges, romance and dealbreaker tag parsing, host tag, growth→hobby | `packs/network/ontology.ts` |
| `world.ts` `location` / `overlap` and `scoring.ts` shared-area cost | `geo.ts` `cityBucketGeo` (core; reused by friendsPack); interval helpers moved to `interval.ts` |
| `scoring.ts` novelty and romance-risk literals | `networkPack.scoring` hooks |
| `policy.ts` romance-preferences ask | `networkPack.selection.extraAsks` |
| `attention.ts` calibrator knots | `packs/network/calibrator.ts` |
| `attention.ts` romance gate, romance-alone, warm-mention lane, probe copy | `networkPack.attention` |

**Not moved, and why:**
- `EngineConfig` keeps `cities`, `timezones`, `romance.requireStatedPrefs`, `highRiskTerms` and the `GENERATOR_NAMES` flags. Moving any of them would change the config hash (rule 1).
- `outreach.ts` `CITY_TZ` and `tick.ts` are unchanged.
- The core type unions (`City`, `Category`, `OpportunityKind`, `Role`) stay closed. P1 of the spec opens them.

## 3. Goldens (P0)

**Fast tier** (`packages/engine/test/golden.test.ts`, about 11 s, runs on every `bun test`). Captured on the unchanged code at commit `7291764`; stored in `packages/engine/test/goldens/fast.json`.

| Artifact | Contents |
|---|---|
| `runEngine`, synthetic snapshot | Seeds 1-3: config hash, run id, funnel, proposal ids, and SHA-256 hashes of proposals, asks and run log |
| `runEngine` in the simulator | Seeds 1-3, 80 personas, 10 days: every nightly per-city call (20 per seed) and a metrics hash |
| `runEngine`, judged | All three passes on, a deterministic fake model (screen 36 calls, rubric 13, deep 1); hash of every prompt and context message |
| Attention v1.2 | `HQ-c` and A, seed 1 |
| Plans v1.1 | B and P, seed 1, 21 days |
| Capital | 1 seed × 30 days |
| Sim CLI `--json` | Seeds 1-3, with and without the `engine-v1` adapter |

Hashes use insertion-ordered JSON, so a reordered funnel key fails too. A mismatch prints the first differing path.

**Full tier** (`GOLDEN_FULL=1`, about 160 s; `goldens/full.json`):
- engine, synthetic: seeds 1-8;
- engine in the simulator: seeds 1-8, 150 personas, 30 days;
- judged: seeds 1-3;
- attention: seeds 1-8;
- plans: seeds 1-8, 30 days;
- capital: 8 seeds × 90 days.

**Judge goldens already in the evals.** `packages/evals/test/judgeReplay.test.ts` and `datasetV2.test.ts` pass unchanged.

**Results after the refactor:**
- **Fast tier:** identical.
- **Full tier:** identical.
- **Prompt bytes:** unchanged. The judged golden hashes every message sent to the model.

Reference values from the fast tier, unchanged after the refactor:

| Golden | Value |
|---|---|
| Synthetic seed 1 | `configHash 7d8069ca2fc7febf`, `runId c2a9ca12258e409b`, 218 proposals from 3,500 candidates |
| Judged seed 1 | `configHash 4a499b2326669958`, 217 proposals, 50 model calls, 0 failures |
| Simulator seeds 1-3 | 64 / 72 / 69 proposals; precision 0.281 / 0.292 / 0.319 |

## 4. Conformance

`packages/engine/test/conformance.ts` exports `runConformance(pack, {world?, seeds?, cfg?})`; `test/network-conformance.test.ts` runs it for `networkPack`.

**Worlds.** The default worlds are 4 testkit random worlds of 90 members with 15% minors aged 13-17, plus blocks, holds, canaries and aliases. A positive control checks that every world yields proposals and contains minors.

| Check | networkPack |
|---|---|
| Registration: `validatePack`, match age ≥ 18, tiers not matchable, unique generator / rule / lane ids; a pack with `minMatchAge` 16 is rejected | pass |
| 1. Minors: raw generator candidates with a minor fail `candidateReason`; no minor in proposals, alternates, `via`, asks, the scored log or exposure debt; the final guard never fires; `memberReason`, `pairReason` and `hardGate` return `underage`; minors have no warm edges | pass |
| 1b. Minors in attention: `itemGate` blocks member-involving items for a minor; `buildProbe` returns null either way | pass |
| 2. Blocks: blocking every pair proposed in an unblocked run removes them all; they are not warm; `pairReason` returns `blocked` | pass |
| 3. Consent before reveal: under random answer orders, `revealFor` is null until the flow is revealed, only "yes" names are revealed, and a pair with any "no" is never revealed; probes contain no name tokens of the others | pass |
| 4. Leak gate: no canary anywhere in proposals, asks or the run log; explanations and probes pass `checkMemberFacing` | pass |
| 5. Determinism: a rerun gives identical bytes; shuffled members, facets, intents, presence and edges give identical proposals | pass |
| 6. Judge cannot undo filters: with an always-yes, top-score fake model on all three passes, the hard-filter survivors and `rejectedBy` are identical, and every proposal is a survivor | pass |
| 7. Attention: at most 3 items per message, member-involving items within `maxMemberItems`, the cap blocks invites, paused and quiet hours send nothing, the ships-alone lane is sent alone | pass |
| 8. Geo: every proposal's market is in the run's markets; every participant is present for the window; `overlap` does not depend on id order; `geo.pairReason` is symmetric | pass |

**Mutation checks.** Each mutation was applied by hand and then reverted:

| Mutation | Check that failed |
|---|---|
| The core minors checks removed | 1 |
| The core block check removed | 2 |
| The `canReveal` gate in `revealFor` removed | 3 |

## 5. Full test run

- `bunx tsc --noEmit -p .` is clean.
- `bun test --conditions eliza-source ./packages`: 696 pass, 4 fail. All 4 failures also fail on clean `origin/main` (`976a39e`), before any change in this branch:
  - `packages/plugin-network` (2 files): `@elizaos/core` and `@elizaos/testing` cannot be resolved because the `eliza` submodule is not initialised. Skipped as instructed.
  - `packages/network/test/network.test.ts` (2 tests):
    - "meetings happen at real public NYC venues" fails because a venue name ("NYPL Stephen A. Schwarzman Building") does not match the test's regex.
    - "consent-first beats push" fails because the all-yes rate is 0.711, below the expected 0.75.

    Same values before and after; this package does not read the engine changes.

## 6. Extension points slopPack needs

| Need | Extension point |
|---|---|
| **Radius geo** (within X miles of a zip or point; multiple cities) | Implement `GeoModel` with `kind: "radius"`. `location` / `overlap` work on cells (store H3 cells in `Presence.areas`; markets stay for locking, caps and time zones). Add `pairReason` for the mutual radius (d ≤ min(rA, rB), symmetric, checked last in `pairReason`), `displayDistance` for bucketed copy, and `sharesArea` for activation cost. Conformance check 8 already covers order-independence and symmetry. |
| **Mutual gender / orientation filter** | `ontology.constraints(boundaryFacets)` returns typed `MemberConstraints.romance` (`is`, `seeks`, `ageMin`, `ageMax`). Add a pair rule on the dating lane (reuse `romanceCompatible` from `packs/network/rules.ts`) and a lane with `optIn: "explicit_mutual"`. `ontology.mutualPreferenceMatch` feeds complementarity. |
| **Double opt-in** | `consent.default = { kind: "double_opt_in", blind: true, revealOn: "mutual_yes", expiresHours }`. `startProbeFlowFor` turns it into blind parallel probes that reveal only when everyone says yes; conformance check 3 tests it. Dating copy goes in `attention.probeText`; `attention.shipsAloneLane` keeps dates out of digests. |
| **Exposure fairness** (popularity skew) | `selection.adjust(w, c, value, timesSelectedInRun)` lifts or penalises the greedy key. It is absent for networkPack, so that arithmetic is unchanged. It stacks with the existing exposure-debt knobs (`selection.exposureDebtWeight` / `Cap`, exposure floor). Gates such as the Gini of likes received go in `metrics.gates`. |

Other things slopPack will hit:
- a dating judge rubric (`judge`, with its own versions and context builder);
- `eligibility.accountTiers: []`, since slop is 18+ with no minor tier;
- a `SimPack` with daters (desirability skew, asymmetric attraction).

## 7. Seams

Nothing had to be left non-identical: every golden matches. These seams remain for later phases.
1. **Closed core types.** `City`, `Category`, `OpportunityKind` and `Role` are still Network unions. slopPack can use the `romance` lane and the `sf` / `nyc` markets as they are; a new market id or lane needs P1, which opens the types.
2. **Functions without a World default to network data:**
   - `attention.ts` `itemKindFor` / `effortFor` (contributor roles), `defaultCadence` (`romanceInDigest`) and `knotCalibrator` defaults;
   - `plans.ts` `planToProposal` / `planItem` (`activityById`);
   - `outreach.ts` `CITY_TZ`.

   Pack-aware callers pass `pack` or `w`.
3. **Config fields kept for hash stability.** `EngineConfig` still carries the Network's risk lexicon, `cities` / `timezones` and `romance.requireStatedPrefs`. `resolveConfig` still enforces groups of 3-6, and `resolvePlans` enforces partner = 2.
4. **`tracedEngine` duplicates the pipeline.** `experiments/lib.ts` still iterates `GENERATORS` (the same array as `networkPack.generators`) and builds `World` with the default pack (R2).
5. **Generator gate.** `runEngine` skips a generator only when `cfg.generators` names it as false. Unknown names from other packs run. For networkPack this is identical.
6. **Module cycles.** `networkPack` sits in the import cycle `world` → pack → generators / rules → `world`. To keep it safe, `generators` and `eligibility` are getters and function values are wrapped. Every engine module was checked as an entry point.

## Commits (`engine/packs`, not pushed)

| Commit | What |
|---|---|
| `7291764` | Fast-tier goldens (+ the `bun.lock` capital workspace entry that `bun install` adds on `origin/main`) |
| `78ffe90` | Full-tier goldens |
| `ae7e0cc` | AppPack contract and networkPack |
| `194cd25` | Conformance suite |
| (this doc) | Results |
