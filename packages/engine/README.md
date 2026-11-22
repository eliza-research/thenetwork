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
pnpm run sim                  # every pack's conformance rules and its world gates, plus the Network sims (scripts/sim.ts)
pnpm run sim --only slop      # one pack (network | slop | peon | friends)
```

## App packs

`runEngine(input, cfg, { pack })` runs one app's matching. A pack (`src/pack.ts` `AppPack`) supplies the ontology (lanes, objectives), eligibility rules, generators, geo, scoring and selection hooks, consent, attention settings, the judge prompts, explanation copy, optional plans and the match vectors (lane memberships, tags, standing); core invariants (minors in no role, blocks, consent before reveal, the leak gate, the judge cannot undo a hard filter) cannot be loosened by a pack. `pnpm run sim` checks them for every pack (scripts/sim/conformance.ts).

| Pack | App | Code | Report |
|---|---|---|---|
| `networkPack` | The Network | `src/packs/network/` (also holds the member vocabulary, `vocabulary.ts`) | [app packs core](../../docs/results/2026-10-08-app-packs-core.md) |
| `slopPack` | slop.date | `src/packs/slop/` | [slop pack](../../docs/results/2026-10-08-slop-pack.md) |
| `peonPack` | peon.biz | `src/packs/peon/` | [peon pack](../../docs/results/2026-10-08-peon-pack.md) |
| `friendsPack` | friends.help | `src/packs/friends/` | [friends pack](../../docs/results/2026-10-08-friends-pack.md) |

slop.date onboarding has one implementation: `src/packs/slop/extract.ts` (`extractSlopProfile`, `slopOnboardTags`) and `src/packs/slop/onboard.ts` (`applyCorrection`, `readBack`, `nextQuestion`). The service runs it as the slop app's onboarding loop (`packages/network/service/packs.ts`, `AppHooks.onboarding`), and `pnpm run sim --only onboard` gates it on `evals/slop-onboarding/`. Orientation policy (PRD 40.5): "bi", "pan", "queer", "both" and "a mix" leave who the member seeks unset, and the agent asks who they hope to meet. The founder may still pick the other policy (read those words as a seeking set); it is listed as a founder decision.

The slop.date Date lane's pack value is [spec/datePackValue.md](../../spec/datePackValue.md). `src/packs/slop/score.ts` reads a profile into the spec's answers and pair inputs and calls the generated `datePackValue`. `src/packs/slop/packBound.ts` gives the two upper bounds of that spec for the candidate search: `datePackBound(a, b, o)` from the cheap pair inputs, and `datePackClassCap(a, classKey, untouched, o)` for the partner class `datePackClassKey(b)` (keys `0` to `DATE_PACK_CLASSES - 1`). The match core does not call the bounds yet. Appearance ratings count in matching and are never shared (founder decision 2026-10-08): the overall rating is the member's private Date-lane standing, and a rating below `appearance.minConfidence` counts as no rating. `appearance.bodyType` selects the partners with a confident rated body type (`minConfidence`) and the shrink of the revealed body-type preference (`revealedShrink`); `learned.enabled` turns the revealed-taste factor on or off.

## Design overview: code to PRD map

| Module | What it does | PRD |
|---|---|---|
| `src/world.ts` | Canonical index over the input. **Every id goes through one alias resolver first**, covering edges, holds, feedback, interactions, facets, intents and presence. Builds embeddings, blocks, warm ties, cooldown maps, budget usage, profile revisions, clusters and inviter cohorts. Presence timeline: temporary presence overrides home, multi-home members, interval intersection. | 13.1, 33.2, ME-006, ME-011 |
| `src/filters.ts` | Hard filters. Minors policy (see below): nobody under 18 in any role, including alternates and `via`. Member level: 18+, safety hold, state/category, romance opt-in, only-when-asked / two-unanswered, interruption budget, contribution budget, per-category quota, per-category decline cooldown, reliability holdout (one forgiven no-show). Pair level: blocked/avoid either way, negative-feedback cooldown (independent of the `processed` flag), decline/expiry pair cooldown, active-duplicate guard, romance mutual opt-in plus stated preferences, stated dealbreakers. Lane level (Pairs phase): a candidate with two or more participants names a lane (`no_lane`), and every pair the lane requires has a pair value through `World.match.value` (`no_pair_value`); an alternate without a pair value with every primary it pairs with is dropped. Configuration level: high-risk exclusions, F14 home-entry rule, group size, presence/availability overlap in the window. Completed or positive history is never a filter. | 33.5, 17.4-17.5, 15.2, F14, F28, ME-001, ME-005, ME-006 |
| `src/embed.ts` | Deterministic local embedding: signed feature hashing of unigrams, bigrams and char trigrams, L2 normalised. Pluggable. | 33.5 |
| `src/match/` | The generic match core (below): profiles per lane membership, the candidate index, bounded search, the one pair gate, circles. Every candidate path reads pairs from `World.match`. | 14.2, 33.5, 14.6 |
| `src/genkit.ts` | Generator building blocks: `searchFor` (the bounded search), `pairCandidate` and `circleCandidate` (lane, entities, fit and per-side benefit from the pair values), `eventMembers` (exact event tags against the member tag postings, built once per run; unlike the old embedding retrieval it reads no desire facets or embeddings, so event recall can change), the member funnel count (`countExclusion`), labels, warm-path value. | 33.4, 33.5 |
| `src/packs/network/generators.ts` | networkPack's 11 generators: intent to capability, complementary intents (also the romance path), shared-intent pooling (pair or group), event anchor (pairs and small crews), warm path (two-hop, with `via`), help request (load-aware, helper-set variants, home-entry rule), group composer (shareable themes), second encounter (mutual positive plus next context), newcomer welcome (host plus friendly members), network growth (unmet intents and host-less areas, asks connectors), expansion (desires outside the member's cluster, always exploration). | 33.4, 6.1, F11-F15, F19 |
| `src/group.ts` | Group composer over 3-6 person circles: the one circle builder (`match/circles.ts`) forms coherent circles from the lane's bounded search edges (every pair at or above the lane's circle pair floor, the standing spread inside the band plus the uncertainties); circles rank by least misery (lowest member utility, then mean), need a common availability window, and pass the generated `groupFormation` machine (host when required, alternates in the primary's city). Returns primary plus ranked alternates and counts warm ties. | 14.6, 33.7, F12 |
| `src/scoring.ts` | Logged `ScoreComponents`. With two or more participants, fit is the lowest required pair value / 1000 and mutual benefit the mean; a single participant keeps the generator's fit. NetValue = (Fit + MutualBenefit + WarmPath + Novelty + TimingFit - ActivationCost - InterruptionCost - Load - Repetition - SocialRisk) / sum(positive weights) x Confidence. Floors (fit, mutual benefit, confidence, social-risk ceiling, judge per-dimension floor) and the dealbreaker flag make a configuration ineligible. The threshold is the strictest of the participants' state thresholds and the category threshold. | 33.6, 14.3-14.4, ME-009 |
| `src/judge.ts` | **Pass 2 (rubric judge, `judge-v2`)** on the top-K pairs and top groups (default model: Surplus gpt-6-luna via `recommenderLLM()`). Profiles are scrubbed and pseudonymous (P1..Pn, no agent_private or opportunity_specific facets). Matchable facts are passed as "context_do_not_quote". Output order: internal fact-citing `reasoning` and `cited_facts` first, then 1-5 calibrated dimensions, a separate dealbreaker flag, the `verdict` (yes/no; "no" => `judge_reject` when `judge.verdictGates`), the confidence (`match_probability`, `certainty`), and last a per-participant member-facing "why". Schema validated, one retry. Cache key = participants' profile revisions + config + prompt version, with a TTL. Failures are never cached. The judge blends into fit, mutual benefit and timing and can only *add* risk; the score after its verdict is the lower of the two, so pass 2 can only lower or remove. Load, interruption, repetition and hard filters always apply. | 33.6, 30.4, ME-008 |
| `src/judgeScreen.ts` | **Pass 1 (screen, `pass1-screen-v2`, off by default: `judge.screen.enabled`).** Same public view the evals use (`buildPublicView`): reasoning first, then dealbreaker, verdict, `match_probability`, per-person accept probability, and a shareable-only `member_why` last. "no" => `screen_reject`; pass 2 then sees only survivors. | 33.6 |
| `src/judgeDeep.ts` | **Pass 3 (deep review, `pass3-deep-v1`, off by default: `judge.deep.enabled`)** on the best survivors of passes 1-2. Richer context (every visible fact with basis stated/confirmed/observed/inferred, source, confidence and age; connected-source summaries; schedule overlap; edges, mutual contacts, warm path; recent proposals, declines, feedback; budgets and preferences; agent_private context with canaries redacted, for internal judgment only). Explicit rubric (mutual benefit, reciprocity, intent/timing, logistics, stage fit, values/energy, novelty, evidence quality, risk/safety, "would each person thank us"), steelman for and against before the verdict, a `yes` / `no` / `insufficient_information` verdict with the one question to ask, calibrated `match_probability`. It can only remove candidates (`deep_reject`, `deep_insufficient`); `hardGate` re-checks minors, blocks, holds and opt-ins after the model; member-facing text passes `checkMemberFacing` (leak gate) before use. | 33.6, 17.2, ME-003 |
| `src/judgeCommon.ts` | Shared parsing (probabilities, verdicts, cited facts, key-order check that reasoning came before the verdict), canary redaction, and the member-facing leak gate. | ME-003 |
| `src/explain.ts` | Explanations built only from shareable facets, event titles and "you asked about this". A leak checker rejects judge text or objectives containing vocabulary found only in non-shareable facets, and any "canary". | 17.1-17.2, ME-003 |
| `src/policy.ts` | One global selection per run under constraints: interruption and contribution budgets, no pair reused, no overlapping fixed-time commitments, per-city cap. Order: exposure-floor pass, then a seeded exploration slice (10-15%, alternating dedicated expansion picks and a novelty-weighted pool, sized by a dry run), then greedy with an in-run load penalty and an amortized exposure-debt lift. Fairness: Gini, top-10% share, Lorenz deciles, newcomer and low-exposure coverage, viable coverage, by city and inviter cluster. Blocking-pair count is a diagnostic only. | 14.5, 15.4, 33.8, ME-002, ME-012 |
| `src/engine.ts` | `runEngine` orchestration and run log. Seed, config hash, input hash, engine/embedding/judge model ids, funnel (member funnel, per-generator counts, rejections per filter, floors, thresholds, budget skips), every scored configuration's components, judge verdicts, empty states with the blocking reason, updated exposure debt, and `search` (the bounded-search totals from `World.match.tally()`). Pure: no `Date.now` and no `Math.random`. | 33.9-33.10, ME-004 |
| `src/testkit.ts` | Seeded random-world generator for the conformance sim (scripts/sim/conformance.ts), independent of packages/sim. Covers canary facets, alias ids, blocks stored with aliases, minors, holds, travel, multi-home members, dealbreakers, romance prefs, risky events and intents, history and recent proposals. | 34 |

### Research input adopted (docs/research/matching-and-graphs.md)

1. **Reciprocal value and parity.** A pair value is the integer harmonic mean of the two directed utilities minus a standing-gap penalty, and exists only when both utilities reach the lane floor and the private standing gap is inside the lane band (spec/pairValue.md, spec/matchLane.md). Groups use the lowest and the mean of their pair values.
2. **No Gale-Shapley.** Generators propose overlapping candidates, then one global constrained selection runs per tick: greedy with budgets, pair reuse, time conflicts and caps. The stable-matching blocking-pair count is logged as `runLog.blockingPairs`, as a diagnostic only.
3. **Congestion and exposure in the objective.** An in-run load penalty, plus an amortized per-member `exposureDebt` (carried debt + best viable relevance - proposals received). It is read from `EngineInput.exposureDebt` and returned in `runLog.exposureDebt` to persist. Gini, top-10% and Lorenz are reported.
4. **Warm-path value is an inverted U** in tie strength (`warmPathValue`, peak at 0.5).
5. **Off-policy logging.** Every proposal carries `selectorRank` and `selectionProbability` (1 for deterministic picks, the draw probability for exploration picks). Every scored configuration's components are logged.

Not adopted yet: OR-Tools / ILP selection, Adamic-Adar and Burt-constraint graph features, and community partitions. These are noted for v2.

## Pipeline and complexity

1. **Index.** `World` canonicalises the input. `World.match` builds profiles once per run from eligible lane memberships. It sorts each lane, side, and market block by standing and ordinal, then indexes offers, seeks, and interests in that order. Building the index takes O(N log N + T) time for N profiles and T tag occurrences.
2. **Generate.** Generators ask `searchFor(ctx, profile)`. Each search locates the standing window by binary search and visits its shortest tag postings first. If an untagged pair can reach the utility floor, the search can walk the rest of the window. It checks at most the lane's `searchBudget` pairs and visits at most eight times that many entries. The result is Exact when no unchecked candidate can enter the kept list. A Budgeted result gives an `unseenBound` for any candidate it may have missed. Circles use the search edges (`World.match.circles(lane)`). [Candidate search spec](../../spec/candidateSearch.md)
3. **Screen.** The generated candidateScreening order over every generator candidate (exploration, warm paths, groups, events). In the Pairs phase a candidate with two or more participants must name a lane (`no_lane`) and every pair the lane requires must have a pair value from the one pair gate (`no_pair_value`); an alternate without a pair value with each primary it pairs with is dropped (`screenCandidate` returns the kept alternates). The generic activity planner (`plans.ts`) uses the same pair gate on each pair in its bounded availability pool before making circles or partner plans.
4. **Score.** Pair values for fit and mutual benefit plus the cost terms (timing, activation, interruption, load, repetition, social risk) and confidence.
5. **Judge, select, emit.** The judge can only lower scores or remove candidates. `runLog.search` reports searches, pair checks, index entries visited, exact, budgeted and empty results, and the largest unseen bound.

## Minors policy (PRD 17.4, as amended by the founder decision of 2026-10-05)

PRD 17.4 originally said "adults only (18+)". The amended policy: **members under 18 can join, but
are never connected to other people.** Minors get single-player value only (concierge answers,
public event and place recommendations, their own profile and preferences), which lives outside
this engine. Adults are never shown or told about minors. Romance stays adult-only. In the
engine this is a hard filter, enforced in layers, and never traded for score:

| Layer | What it does | Where |
|---|---|---|
| Policy constant | `ADULT_AGE = 18`. `cfg.ageMin` can raise the bar but never lower it; a missing or non-numeric age is treated as a minor (fail closed). | `filters.ts` `isMinorAge`, `isMinor` |
| Index | `World.minors`. Minors' edges never enter the warm graph, so a minor can't be a warm tie, a two-hop target, a warm-path intermediary (`via`), or add to anyone's degree ("friendliness" for newcomer welcomes, connector ranking for growth asks). Inviter-cohort chains stop before a minor, so a minor's id never becomes a fairness cohort key. | `world.ts` |
| Member filter | `memberReason` returns `underage`, and the match core builds no profile for a minor, so no search or retrieval offers a minor to any generator in any role: seeker, provider, peer, helper, host, guest, newcomer, attendee, connector. | `filters.ts` |
| Pair filter | `pairReason` returns `underage` for any pair with a minor. This also makes minors incompatible (`-Infinity`) in the group composer. | `filters.ts` |
| Generators | Warm path re-checks the target and `via`. Group composer themes don't count minors (so 3 adults + 2 minors is not a theme). Network growth never turns a minor's unmet intent into an ask, and never counts minors toward a host-less area. | `generators.ts` |
| Group composer | Drops minors from the pool and returns no group if a minor is forced, so a minor is never a member, host or alternate. | `group.ts` `composeGroup` |
| Configuration filter | `candidateReason` rejects any configuration where a participant, alternate or `via` is a minor (`underage`, counted in `funnel.rejectedBy`). | `filters.ts` `involvesMinor` |
| Final guard | After selection, anything touching a minor is withheld (fail closed) and counted in `funnel.rejectedAfterSelection`. This should never fire; the property test asserts it doesn't. | `engine.ts` |
| Run log | Minors appear only as an aggregate count (`funnel.memberFunnel.underage`, `memberExclusions.underage`). They have no exposure debt, no empty states, no scored or judged configurations, and no cohort keys. | `engine.ts`, `policy.ts` |

Covered by opportunity kinds: intros, groups, event co-attendance, help requests (requester, helpers
and alternates), member-initiated/warm-path intros (target and `via`), second encounters, newcomer
welcomes (newcomer and host), network-growth asks (target and gap source), expansion, and
group-composer seating (used for the monthly gathering). The PRD 17.5 high-risk terms (childcare,
"minor", "kids" and similar) still block adult-to-adult configurations about minors.

Tests: `test/minors.test.ts`. Unit tests per generator use a positive control: the all-adult world
yields a candidate that includes the person, and the same world with that person under 18 yields
none. The property tests run 18 random worlds (40-170 members, 10-20% minors aged 13-17). Minors
there get the same facets, intents, host tags, romance opt-ins, warm ties, invites and history as
adults. The tests assert that zero proposals, and zero raw generator candidates, involve a minor in
any role. They also assert that no proposal, explanation, objective, anchor or run-log field
contains a minor's id, alias or name, and that the final guard never fires. A mutation check
(policy disabled) fails 18 of 21 of these tests.

## Requirements coverage (ME-001..ME-012)

| Req | Where enforced | Where tested (before 2026-10-08; now `pnpm run sim`) |
|---|---|---|
| ME-001 hard constraints | `filters.ts` (generators pre-filter, then `candidateReason` re-checks every configuration) | `properties.test.ts` independent oracle over 24 random worlds; `filters.test.ts` |
| Minors policy (17.4) | `isMinor` in the index, member, pair and configuration filters, the composer, and a final guard | `minors.test.ts`: per-generator unit tests and property tests over 18 worlds with 10-20% minors |
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

## Validation

The unit and property tests named in the table above were deleted on 2026-10-08 and stay deleted (no unit tests: [docs/tests-policy.md](../../docs/tests-policy.md)); they are in git history at 16cde70. `pnpm run sim` now checks the engine through the packs: the conformance rules on random and per-app worlds (minors, blocks, consent before reveal, leaks, filters and the judge), and the world gates.

## Benchmark

`src/bench.ts` was removed with the tests on 2026-10-08. Its last result (300 members, seed 42, local embeddings, no LLM: median 208.5 ms per run) and the full section are in git history at 16cde70.

## Proposed core changes (packages/core)

1. Add `category`, `roles`, `expiresAt`, `anchor`, `selectionProbability` to `Proposal`. The engine needs category for cooldowns and quotas, and roles for contribution load. Today it reads them from `EngineProposal` extra fields when present, and otherwise falls back to "help non-initiators are contributors".
2. Add `events`, `safetyHolds`, `feedback`, `interactions` (with outcomes), `idAliases`, `reliability`, `categoryQuotas`, `exposureDebt` to `WorldSnapshot` (see `EngineInput` in `src/types.ts`).
3. Add structured romance preferences. Today they are encoded as `preference`/`boundary` facet tags `romance:is:x`, `romance:seeks:y`, `romance:age:lo-hi`, and dealbreakers as `dealbreaker:<tag>`.
4. Done: `CITY_TZ`, `localParts`, `fromLocal` and `inQuietHours` are in `packages/core/src/time.ts`.
5. Add `Intent.tags` (structured), so tag-channel retrieval does not rely on tokenising free text.
