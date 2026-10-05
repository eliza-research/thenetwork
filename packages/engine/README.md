# @thenetwork/engine

Matching and opportunity engine v1 prototype (PRD Sections 6, 14, 15, 32.8-32.13, 33). It is a
transparent, testable pipeline. It produces a small number of high-conviction proposals,
explains each one using shareable facts only, never trades hard constraints for score, and logs
everything needed to replay the run.

```ts
import { runEngine } from "@thenetwork/engine";
const { proposals, runLog } = await runEngine(snapshot /* WorldSnapshot | EngineInput */, { seed: 7 }, { llm, embed, judgeCache });
```

- `snapshot` is the core `WorldSnapshot`, optionally extended as `EngineInput` with `events`, `safetyHolds`, `feedback`, `interactions`, `idAliases`, `reliability`, `categoryQuotas` and `exposureDebt`.
- `cfg` is a deep-partial `EngineConfig`, merged over `DEFAULT_CONFIG` in `src/config.ts`. Its hash is logged.
- `deps.llm` turns on the optional judge. `deps.embed` replaces the local hashed embedding. `deps.judgeCache` lets the judge cache persist across runs.
- Proposals are `EngineProposal`, a superset of core `Proposal` that adds `category`, `roles`, `expiresAt`, `anchor`, `via`, `safetyClass`, `threshold`, `channels`, `judged`, `selectorRank` and `selectionProbability`.

Commands:

```bash
bun test packages/engine                 # 118 offline tests + 1 live test (needs CEREBRAS_API_KEY)
bun run packages/engine/src/bench.ts     # 300-member benchmark: [members] [seed]
```

## Design overview: code to PRD map

| Module | What it does | PRD |
|---|---|---|
| `src/world.ts` | Canonical index over the input. **Every id goes through one alias resolver first**, covering edges, holds, feedback, interactions, facets, intents and presence. Builds embeddings, blocks, warm ties, cooldown maps, budget usage, profile revisions, clusters and inviter cohorts. Presence timeline: temporary presence overrides home, multi-home members, interval intersection. | 13.1, 33.2, ME-006, ME-011 |
| `src/filters.ts` | Hard filters. Member level: 18+, safety hold, state/category, romance opt-in, only-when-asked / two-unanswered, interruption budget, contribution budget, per-category quota, per-category decline cooldown, reliability holdout (one forgiven no-show). Pair level: blocked/avoid either way, negative-feedback cooldown (independent of the `processed` flag), decline/expiry pair cooldown, active-duplicate guard, romance mutual opt-in plus stated preferences, stated dealbreakers. Configuration level: high-risk exclusions, F14 home-entry rule, group size, presence/availability overlap in the window. Completed or positive history is never a filter. | 33.5, 17.4-17.5, 15.2, F14, F28, ME-001, ME-005, ME-006 |
| `src/embed.ts` | Deterministic local embedding: signed feature hashing of unigrams, bigrams and char trigrams, L2 normalised. Pluggable. | 33.5 |
| `src/retrieval.ts` | Channels: semantic top-K, tag match, graph two-hop. Union, then dedupe. Member-level filters run first (the "SQL" pass). An exposure floor reserves up to K slots for low-exposure, low-data and newcomer members. | 14.2, 33.5 |
| `src/generators.ts` | 11 generators: intent to capability, complementary intents (also the romance path), shared-intent pooling (pair or group), event anchor (pairs and small crews), warm path (two-hop, with `via`), help request (load-aware, helper-set variants, home-entry rule), group composer (shareable themes), second encounter (mutual positive plus next context), newcomer welcome (host plus friendly members), network growth (unmet intents and host-less areas, asks connectors), expansion (desires outside the member's cluster, always exploration). | 33.4, 6.1, F11-F15, F19 |
| `src/group.ts` | Beam search over 3-6 person groups. Maximises average pairwise compatibility, a min-pairwise floor (least misery), role coverage (host), 1-2 warm ties (not a clique), cluster diversity, availability intersection and anchor affinity. Returns primary plus ranked alternates. | 14.6, 33.7, F12 |
| `src/scoring.ts` | Logged `ScoreComponents`. NetValue = (Fit + MutualBenefit + WarmPath + Novelty + TimingFit - ActivationCost - InterruptionCost - Load - Repetition - SocialRisk) / sum(positive weights) x Confidence. Floors (fit, mutual benefit, confidence, social-risk ceiling, judge per-dimension floor) and the dealbreaker flag make a configuration ineligible. The threshold is the strictest of the participants' state thresholds and the category threshold. | 33.6, 14.3-14.4, ME-009 |
| `src/judge.ts` | Optional Cerebras judge for the top-K pairs and top groups. Profiles are scrubbed and pseudonymous (P1..Pn, no agent_private or opportunity_specific facets). Matchable facts are passed as "context_do_not_quote". Returns 1-5 calibrated dimensions, a separate dealbreaker flag and a per-participant "why". Schema validated, one retry. Cache key = participants' profile revisions + config + prompt version, with a TTL. Failures are never cached. The judge blends into fit, mutual benefit and timing and can only *add* risk. Load, interruption, repetition and hard filters always apply. | 33.6, 30.4, ME-008 |
| `src/explain.ts` | Explanations built only from shareable facets, event titles and "you asked about this". A leak checker rejects judge text or objectives containing vocabulary found only in non-shareable facets, and any "canary". | 17.1-17.2, ME-003 |
| `src/policy.ts` | One global selection per run under constraints: interruption and contribution budgets, no pair reused, no overlapping fixed-time commitments, per-city cap. Order: exposure-floor pass, then a seeded exploration slice (10-15%, alternating dedicated expansion picks and a novelty-weighted pool, sized by a dry run), then greedy with an in-run load penalty and an amortized exposure-debt lift. Fairness: Gini, top-10% share, Lorenz deciles, newcomer and low-exposure coverage, viable coverage, by city and inviter cluster. Blocking-pair count is a diagnostic only. | 14.5, 15.4, 33.8, ME-002, ME-012 |
| `src/engine.ts` | `runEngine` orchestration and run log. Seed, config hash, input hash, engine/embedding/judge model ids, funnel (member funnel, per-generator counts, rejections per filter, floors, thresholds, budget skips), every scored configuration's components, judge verdicts, empty states with the blocking reason, updated exposure debt. Pure: no `Date.now` and no `Math.random`. | 33.9-33.10, ME-004 |
| `src/opportunity.ts` | Opportunity state machine. An explicit `TRANSITIONS` table (from, to, trigger, actors, timer). Invalid transitions throw `InvalidTransitionError`. Transitions are permission-checked and idempotent by event id. Safety hold/release returns only to the prior state. Helpers for invites with 48h/3h expiry, independent responses (declines stay private), quorum, NEEDS_REPLACEMENT, alternates and Clock ticks. | 32.10, F11, F12, F29 |
| `src/outreach.ts` | Outreach controller. Budgets: Open 4/wk, Normal 2/wk, Quiet 1/mo, Receiving support-only, Paused 0. They reset Monday 00:00 or the 1st in member local time (DST-safe). Quiet hours in local time, with deferral to their end. The two-unanswered rule (72h or expiry, whichever is first; pending messages don't count). Defines what counts as proactive (invitations, F6 questions, unsolicited recommendations, "worth a text?"). Also: priority/bundling and a decision log. | 32.9, 12.3, F20, F28 |
| `src/tick.ts` | Per-city mutual exclusion, idempotent hour-bucketed tick ids, and an all-or-nothing commit (a crashed tick leaves nothing). | 33.3, ME-010 |
| `src/testkit.ts` | Seeded random-world generator, independent of packages/sim. Covers canary facets, alias ids, blocks stored with aliases, minors, holds, travel, multi-home members, dealbreakers, romance prefs, risky events and intents, history and recent proposals. | 34 |
| `src/bench.ts` | Benchmark through the production `runEngine` path. | ME-009 |

### Research input adopted (docs/research/matching-and-graphs.md)

1. **Reciprocal aggregation.** Pair mutual benefit is the harmonic mean of each side's benefit. Groups use average-without-misery (mean capped at 2x the least-served member), and the composer applies a min-pairwise (least-misery) floor.
2. **No Gale-Shapley.** Generators propose overlapping candidates, then one global constrained selection runs per tick: greedy with budgets, pair reuse, time conflicts and caps. The stable-matching blocking-pair count is logged as `runLog.blockingPairs`, as a diagnostic only.
3. **Congestion and exposure in the objective.** An in-run load penalty, plus an amortized per-member `exposureDebt` (carried debt + best viable relevance - proposals received). It is read from `EngineInput.exposureDebt` and returned in `runLog.exposureDebt` to persist. Gini, top-10% and Lorenz are reported.
4. **Warm-path value is an inverted U** in tie strength (`warmPathValue`, peak at 0.5).
5. **Off-policy logging.** Every proposal carries `selectorRank` and `selectionProbability` (1 for deterministic picks, the draw probability for exploration picks). Every scored configuration's components are logged.

Not adopted yet: OR-Tools / ILP selection, Adamic-Adar and Burt-constraint graph features, and community partitions. These are noted for v2.

## Requirements coverage (ME-001..ME-012)

| Req | Where enforced | Where tested |
|---|---|---|
| ME-001 hard constraints | `filters.ts` (generators pre-filter, then `candidateReason` re-checks every configuration) | `properties.test.ts` independent oracle over 24 random worlds; `filters.test.ts` |
| ME-002 budgets | `memberReason` plus `policy.ts` `canTake` (in-run usage) | oracle (rolling window); `outreach.test.ts` |
| ME-003 shareable-only explanations / canaries | `explain.ts`, judge prompt scrubbing | property test over all outputs incl. run log; judge leak test; live test |
| ME-004 reproducibility | seeded `Rng` forks, sorted iteration, config/input hashes | property: identical proposals and run log on rerun |
| ME-005 completed/positive never blocks | no filter on completed; repetition is a penalty only | `pitfalls.test.ts`, `filters.test.ts`, second-encounter generator test |
| ME-006 one id space, cooldowns persist | `World.canonical` resolves everything first; feedback cooldown ignores `processed` | alias block/hold/feedback tests, processed-flag test |
| ME-007 learned state not erased | engine is pure and never mutates input; edges, feedback and reliability are inputs | input-unchanged property; profile-update test |
| ME-008 cache expiry | `JudgeCache` TTL + revision-keyed; failures not cached | cache hit/miss/expiry tests; noisy-zero regression |
| ME-009 thresholds applied; bench = prod path | `thresholdFor`, floors, selection re-check | threshold tests; `runBench` vs `runEngine` equality |
| ME-010 tick exclusion / atomic | `tick.ts` | concurrent tick test, crash test |
| ME-011 multi-city + temporary presence | `World.location/overlap` | presence filter tests, event-traveller test, oracle |
| ME-012 fairness metrics per run | `fairnessMetrics` | property test on every run |

## Tests

`bun test packages/engine`: 118 offline tests pass in about 4-8 s. One LIVE test is gated on `CEREBRAS_API_KEY`. It judges 3 configurations with `qwen-3.8-27b` and validates the schema. It passes (about 2 s).

- `test/properties.test.ts` checks ME-001..ME-012 across 24 seeded random worlds (30-150 members) against an independent oracle.
- `test/filters.test.ts` has one test per filter.
- `test/generators.test.ts` has one test per generator, plus the inverted-U warm path.
- `test/group.test.ts` covers the beam-search composer.
- `test/scoring-judge.test.ts` covers scoring, thresholds, floors, judge schema and scrubbing, the cache, and leak rejection.
- `test/opportunity.test.ts` applies every table row with every listed actor, checks that every non-row (from, to, trigger) throws, and covers quorum, alternates and expiry.
- `test/outreach.test.ts` covers budgets per state, local-time windows (including DST), quiet hours, the two-unanswered rule and bundling.
- `test/pitfalls.test.ts` holds the Soulmates regressions:
  - a completed match does not block;
  - blocks, holds and feedback are enforced across id spaces;
  - cooldowns survive processing;
  - a cached zero expires;
  - thresholds are applied;
  - LLM scores never override safety or load;
  - dealbreakers are enforced;
  - there is no wall clock;
  - tick lock and crash safety;
  - the bench uses the production path.
- `test/judge.live.test.ts` is the live Cerebras judge test.

## Benchmark (`bun run packages/engine/src/bench.ts`, 300 members, seed 42, local embeddings, no LLM)

```
World: 300 members, 352 intents, 1384 facets, 669 edges, 24 events (seed 42)
Runtime: median 410.0 ms over 5 run(s); stages {"index":23.43,"generate":334.68,"filter":14.7,"score":6.16,"select":19.35,"finalize":10.73,"total":409.07}
Config hash 650e1fcd925d9cae, input hash 63e4a74b72027b38, run faf110ebc7329c6d

Proposals: 118 (exploration 16 = 13.6%)
Proposals by generator (candidates generated -> selected):
  intent_to_capability     530 -> 16
  complementary_intents    691 -> 16
  shared_intent_pooling    142 -> 24
  event_anchor             168 -> 11
  warm_path                294 -> 35
  help_request              54 -> 3
  group_composer            16 -> 3
  second_encounter           6 -> 1
  newcomer_welcome           6 -> 3
  network_growth            14 -> 0
  expansion                 18 -> 6
Proposals by kind: {"group":7,"intro":52,"event_coattend":11,"member_intro":35,"second_encounter":1,"newcomer_welcome":3,"help":3,"expansion":6}
Participants per proposal: {"2":108,"3":3,"4":3,"5":1,"6":3}

Exposure / fairness (ME-012):
  eligible members 266, with >=1 proposal 166 (62.4%), viable coverage 69.2%
  Gini 0.511, top-10% share 26.9%, max per member 4
  Lorenz (bottom 10%..100%): 0.00 0.00 0.00 0.02 0.13 0.23 0.33 0.53 0.73 1.00
  newcomer share 10.0%, newcomer coverage 68.0%, low-exposure coverage 64.3%
  by city {"nyc":55,"sf":63}; blocking pairs (diagnostic) 20

Filter funnel:
  members (first failing member-level filter): {"total":300,"available":193,"underage":6,"category_opt_out":36,"only_when_asked":29,"state_paused":23,"safety_hold":5,"interruption_budget":8}
  generated 1939
    - no_presence_overlap          473
    - dealbreaker                  8
    - high_risk                    7
    - only_when_asked              3
    - blocked                      1
    - active_duplicate             1
  passed hard filters 1446
    - duplicate participant sets 535
    - floors {}, dealbreakers 0
    - below threshold 356
  eligible 555
    - not selected (budgets / load / pair reuse / caps) 432
  selected 118
  empty-state intents (>= 10 days, nothing proposed): 12 {"filtered:no_presence_overlap":1,"no_candidates":4,"below_threshold":3,"budget_or_selection":3,"density_gap":1}
```

Runtime varies roughly 0.2-0.5 s per run on this machine, depending on load. Generation (embedding similarity) dominates.

How to read the numbers:
- Most of the zero-exposure share comes from members with nothing viable. Viable coverage is about 69%, so exposure among viable members is much flatter.
- Budget-limited selection is the main cut from eligible to selected. This is intentional: Normal members get at most 2 proposals a week.
- `network_growth` asks are generated, but they rarely clear the Normal threshold with the default weights. This is a tuning knob (`thresholds.byCategory.growth` only raises the bar; the max-of-state rule applies).

With a live judge (top 6 pairs + 2 groups, 120-member world) a run takes about 4 s for 8 Cerebras calls.

## Proposed core changes (packages/core)

1. Add `category`, `roles`, `expiresAt`, `anchor`, `selectionProbability` to `Proposal`. The engine needs category for cooldowns and quotas, and roles for contribution load. Today it reads them from `EngineProposal` extra fields when present, and otherwise falls back to "help non-initiators are contributors".
2. Add `events`, `safetyHolds`, `feedback`, `interactions` (with outcomes), `idAliases`, `reliability`, `categoryQuotas`, `exposureDebt` to `WorldSnapshot` (see `EngineInput` in `src/types.ts`).
3. Add structured romance preferences. Today they are encoded as `preference`/`boundary` facet tags `romance:is:x`, `romance:seeks:y`, `romance:age:lo-hi`, and dealbreakers as `dealbreaker:<tag>`.
4. Add `City -> IANA timezone` to core (used by the outreach controller).
5. Add `Intent.tags` (structured), so tag-channel retrieval does not rely on tokenising free text.
