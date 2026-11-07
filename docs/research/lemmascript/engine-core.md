# LemmaScript research: engine-core (packages/engine/src, top-level files)

Scope: the 29 files directly in `packages/engine/src`. `packs/` is out of scope. Date: 2026-11-07.
Trial files are in `/private/tmp/claude-501/-Users-nubs-thenetwork/71ebb7fb-9e02-4dbf-b300-9c31fec118b5/scratchpad/research/engine-core/` (t2 to t8, repro/). They are copies, not shipping code. Every result below came from `lsc check --backend=dafny` (lsc 0.6.6, dafny 4.11) or from `bun run repro/repro.ts`, unless a line says "not tried".

## Key result

1. No selection, scoring or filter function can be verified byte-identical. They read `World` (a class), call pack hooks and use closures, `sort`, `Map` iteration and regex. The realistic path is small pure cores that the shipping code calls.
2. Those cores verify easily. Discrete safety logic took 0 to 2 helper lemmas per trial. Float arithmetic is the weak area (see "Blockers").
3. The best single target is a new proved guard at `engine.ts:240`. It checks the output of ANY selection, including a pack's `assign` hook, which bypasses every check in `policy.ts selectOnce`. It verified with 6 VCs.
4. A proof attempt led to a real defect: `plans.ts:375-387` lets one member be an alternate in two plans of one run. Reproduced. The fixed form verifies with no hand proof.
5. Much of `attention.ts` and all of `sendTimeReason` / `eligibilityFor` have no production caller. Do not spend proofs there until they are wired or deleted (section 3, D5).

## Blockers found by trial (apply to every candidate)

| Blocker | Evidence | Workaround |
|---|---|---|
| `number` is `int` unless each name has `//@ type x real`, `//@ type \result real` | t1: "Function body type mismatch (expected int, got real)" | Annotate each parameter and the result. Record fields need the same. |
| `Math.max` / `Math.min` are int only | t2: "incorrect argument type ... (expected int, found real)" | Helpers `fmax` / `fmin` written with `?:`. So `clamp` (scoring.ts:20) cannot be proved in place. Better: fix in lsc. |
| An integer literal does not coerce to real in a real position; `0.0` is the same as `0` in the TS AST | t2: "the two branches of an if-then-else expression must have the same type (got int and real)" on `return 0` | Trial used `0 * a`. That is a body change. Better: fix in lsc. |
| `Record<ParticipationState, T>` indexes to `Option` | t3: "member 'limit' does not exist in datatype 'Option'" | A named-field interface (`StateCaps`). It is structurally the same type, and lsc lowers `rec[k]` to a `match`. |
| Computed key in a spread, string enums in it (`{...answers, [member]: x}`) | t6a verbatim `recordPlanAnswer`: gen passes, dafny gives 6 resolution errors | Use an array of slots, or extract a decision over counts. |
| Exported `const f = (...) => ...` is not available to other verified code | t8: "unresolved identifier: pairKey" | Rewrite as `function`. Applies to `pairKey`, `isMinor`, `canSendLogistics`, `yesOf`. |
| `.filter(...).length` counts need a stdlib lemma | t7: invariant not maintained; `Std.Collections.Seq.Filter` unfolding failed in my attempts | A recursive counter with a one-line snoc lemma verified. |
| `unknown` age: `typeof`, `Number.isFinite` | Also in core.md | Pass the boolean `matchable` into the core. `canBeMatched` stays trusted. |
| Enum member named `none` clashes with `Option.None` | t6: "member 'None' does not exist in datatype 'Action'" | Rename in the extracted core. `PlanAction` kinds are object tags and need a separate check. |
| Aliased mutation: `last[1] = ...` (interval.ts:9) | By reading: arrays model as values, so the update to `out` would be lost or rejected. Not run. | Rewrite `union` before any proof. Do not annotate it as is. |

Float caveat: LS models floats as exact reals. The proofs do not cover NaN, Infinity or rounding. Real-number bounds can fail by one ulp in TS. Impact is low here: scores are compared with thresholds and a NaN compare fails closed (`score >= thr` is false, `relayClefDecide` holds on NaN p because `p < h.hold` is false). `Math.ceil(n * 0.66)` was checked by hand for n = 3..6 in bun (2, 3, 4, 4), and the float and real results agree. Ages and timestamps model as unbounded ints.

## 1. Files reviewed

Production use below means `runEngine`, `packages/network`, `packages/platform` or the relay service, from a repo grep.

| File | Verdict | Why |
|---|---|---|
| attention.ts | EXTRACT core then prove | Pure, but only part is live: `composeMessage` (plan-allowance path only, network.ts:2981), `withPausePath`, time helpers. Prove the cap and item gates. `addToHold`, `revalidateHold`, `itemsForProposal`, `partnerItem`, `reengagement`, `applyLearnedCadence`, `warmMention` have no caller at all (D5). `recordProbeAnswer` is sim only. Time functions use `Date`, `localParts`: out of fragment. |
| complementarity.ts | MODEL ONLY | Reads World and regexes through the ontology. `romanceMutual` is symmetric by `one(A,B) && one(B,A)`; a proof adds nothing. |
| config.ts | NOT APPLICABLE | Data, deep merge, hashing. `resolveConfig` does not check weights (section 4). |
| embed.ts | NOT APPLICABLE | Regex tokenizer, typed arrays, sqrt. `cosine` needs Cauchy-Schwarz over floats and has no safety role. |
| engine.ts | EXTRACT core then prove | Async orchestrator. Extract the guard at :240 (candidate 1) and the "judge only removes" rule at :191. |
| explain.ts | NOT APPLICABLE | Text assembly and regex. The leak checks are the proof-relevant part and live in core guard. |
| filters.ts | EXTRACT core then prove | `memberReason`, `pairReason`, `candidateReason`: core prefix extracts cleanly. Regex risk rules cannot be proved. `sendTimeReason` has no caller. |
| genkit.ts | NOT APPLICABLE | `warmPathValue` and `benefitForProvider` are simple bounds, but nothing depends on them. |
| geo.ts | MODEL ONLY | Maps and class access. It relies on interval.ts. |
| group.ts | MODEL ONLY | Beam search with closures. Distinct members and no minors come from `pool.filter` and `st.ids.includes` and are simple by reading. The guard (candidate 1) covers its output. |
| hash.ts | NOT APPLICABLE | `node:crypto`, `unknown` walk. |
| index.ts | NOT APPLICABLE | Exports only. |
| interval.ts | PROVE in place (with small edits) | `subtract` verified after replacing the tuple destructuring. `union` needs a rewrite (aliased mutation). `sort` with a comparator is not modeled. |
| judge.ts | PROVE in place | `pass2Accepts`, `pipelineDecision` are pure, but evals only. Low value. `parseVerdict` takes `unknown`. |
| judgeCommon.ts | NOT APPLICABLE | Cache, async, parser of `unknown`, regex. `prob` could be split into a numeric core, low value. |
| judgeConstants.ts | NOT APPLICABLE | Constants. |
| judgeDeep.ts | MODEL ONLY | `hardGate` reads World and "never fires after the filters". `deepDecision` is one comparison. |
| judgeScreen.ts | NOT APPLICABLE | Parser and I/O; `screenDecision` is one line. |
| pack.ts | EXTRACT core then prove | Types plus `validatePack`. Only `scripts/sim/conformance.ts` calls it. The floor check is one line; the core filter enforces 18 anyway. Low value. |
| plans.ts | EXTRACT core then prove | Live in production. Bug D1 is here. Booking and fallback cores verified. Planner search itself is out of fragment. |
| policy.ts | EXTRACT core then prove | `selectOnce` is closures, Maps, seeded RNG. Do not prove it. Prove a guard over its output. Debt step verified (real arithmetic). |
| relay.ts | EXTRACT core then prove | Highest value live file. Parties, state, consent and decision verified. Rules are regex and stay out. |
| relayClef.ts | EXTRACT core then prove (low) | `relayClefDecide` hold/block branch is pure. `Math.exp`, HTTP stay out. Not tried. |
| relayClefFit.ts | NOT APPLICABLE | Offline numeric fitter (Newton, matrix solve). |
| retrieval.ts | MODEL ONLY | World, Maps, sort. D4 is a stale channel. |
| scoring.ts | EXTRACT core then prove | Components read World. Pure arithmetic parts verified with real helpers: `harmonic` pair arm, `netValue` monotonic in the positive sum. |
| testkit.ts | NOT APPLICABLE | Test data generator. |
| types.ts | NOT APPLICABLE | Types and one constant. |
| world.ts | EXTRACT core then prove | Constructor is an index builder. `pairKey`, `acceptanceOf`, `provenanceWeight` are pure. D2 and D3 are here. |

## 2. Candidates, ranked by value

Effort: S under a day, M a few days, L more.

### C1. Proved selection guard (new core, replaces the filter at engine.ts:240)
- Function: `enforceSelection(picks, allow, cityCap)` with `involvesMinorIn` / `finalMinorGuard`.
- Property: in the output, each member is within budget, each city is within its cap, no pair repeats across two picks, and no pick touches a minor in any role. This holds whatever `selectOnce` or a pack `assign` hook did. `pack.ts:222` says `assign` "must only choose among eligible ones"; only the minors guard checks its output today. `slopAssign` (packs/slop/assign.ts:60) has no check of `recentProactive`, `extraProactive` or `maxProposalsPerCity`; it relies on the member rules before it and on `perMemberPerTick`, and it ignores `ctx.extraProactive`, so a member's asks and proposals in one run are not added up.
- Protects: minors never matched; budgets; "no repeated pairs"; pack contract (core owns invariants).
- Sketch: `//@ ensures forall(i, forall(id, i < \result.length && \result[i].participants.includes(id) ==> countIn(\result, id) <= allow(id)))`, the same for `cityCount`, `!repeatsPair`, and `!involvesMinorIn`.
- Blockers: needs arrays of plain records and an `allow` function; the caller maps `Selected` to and from them. Recursive `countIn`.
- Decision first: `allow` must equal `limit - recentProactive - extraProactive`. For networkPack the guard must never fire, so its firing should fail a sim gate. Slop may need its own limit if its cap differs from `cfg.budgets`. Check before wiring.
- Effort M. Trial t7: **6 verified, 0 errors**, with 2 hand lemmas and 2 `forall` calls in `.dfy`. With `.filter` counters: 2 invariant errors. `finalMinorGuard` in t3 verified with no hand proof.

### C2. Plan disjointness (fix of D1 plus proof, plans.ts:375-387)
- Property: across plans of one run, no member appears twice in any role; at most `maxPlans` plans.
- Protects: "each member in at most one plan per run (participants and alternates)", the code comment; no double booking.
- Sketch: `//@ ensures forall(i, forall(j, forall(m, i < j && j < \result.length ==> !(inPlan(\result[i], m) && inPlan(\result[j], m)))))`.
- Blockers: `used` Set replaced by `taken(out, id)`. Plans per run are at most 6, so cost is nil.
- Effort S. Trial t4: shipped form **fails** ("a postcondition could not be proved", with no loop invariant, so the failure alone is not proof of the bug; the bun repro is). Fixed form **2 verified, 0 errors**, no additions.

### C3. Relay decision core (relay.ts:307-325, 384, 439-444)
- Functions: `partyReasons`, `freshConsent`, `decisionOf`, `hookNeverLowers`.
- Property: no reasons means both sides are the two participants, both matchable, not blocked, no opt-out, no hold, status mutual, all accepted. A contact or photo needs consent by the sender for this item, fresh, same kind. "pass" iff no reasons. A hook only adds reasons, so severity never falls.
- Protects: minors, blocks, STOP at relay, consent per item, Clef "can only add".
- Sketch: `//@ ensures \result.length === 0 ==> s.matchable && r.matchable && !blocked && !r.optedOut && ...`; `//@ ensures (\result === "pass") === (reasons.length === 0)`.
- Blockers: `Set` of reasons becomes an array; `state:${op.status}` needs an enum-to-string map; `canBeMatched` stays trusted (`matchable` field); `fam` uses `split` in shipping code, `indexOf` in the trial.
- Also add: `rendered` is "" unless pass. Keep the `finish` wording out of the core and prove the branch only.
- Effort S. Trial t5: **10 verified, 0 errors**, no additions.

### C4. Core filter prefix (filters.ts:56-58, 69-72)
- Functions: `corePrefix`, `pairCore`.
- Property: null means matchable, age at or above both floors, not held, not paused. `pairCore` is symmetric and null means distinct, adults, not blocked.
- Protects: minors never matched (first line), blocks, holds, pause. It also removes a copy of the same prefix if `sendTimeReason` stays.
- Blockers: boolean `matchable`. Pack rules stay outside. They can only add reasons because the prefix runs first and returns; a proof of `memberReason` itself would need an extern for rules.
- Effort S. Trial t3: verified (13 VCs in the whole file, 0 errors).
- Note: `age >= ageMin` with an `undefined` or NaN age is false in TS and `!(...)` fails closed, which is why the shipped form is negated. An int model cannot see this; keep the `!(a >= b)` form.

### C5. Plan booking step (plans.ts:568-591, 645-647)
- Functions: `step` and `smallerKind`; `groupQuorum` (attention.ts:787).
- Property: "book" implies yes count at or above quorum; a booking needs a yes from a pending member; closed runs do not change; a no never unbooks; two yes-sayers are never booked directly; quorum is in 3..n.
- Protects: consent before reveal in the live plan path.
- Blockers: verbatim `recordPlanAnswer` fails (see Blockers). The trial used an array of slots, a shape change. Shipping form: keep `Record` and extract a decision over `(stage, isPending, yes, yesCountAfter, quorum, partner, isFirst, hasBench, beforeDeadline)` returning an action, so production really runs it. The trial is not yet that decision function, and its partner and bench branches are not covered.
- Effort M. Trial t6: **11 verified, 0 errors** (file also holds `subtract`, `budgetAllows`), no additions.

### C6. Cap rules (attention.ts:109-118, 497)
- Functions: `capFor`, `capBlocks`.
- Property: limit at least 0; paused or only-when-asked gives 0; an adult's limit never exceeds the state cap; an invite passes only when used is below limit.
- Protects: attention cap for plan invites only. It does NOT cover intros or the 3-a-day cap; those are in `packages/network/src/outreach.ts`.
- Blockers: `Record` key, real division (trial cross-multiplies; `limit/period` with floats and ints agree for these small values), `Math.floor(capOverride)` dropped because `int`.
- Effort S. Trial t3: verified.

### C7. Item gate (attention.ts:432-439)
- Function: `itemHardGate`.
- Property: null means right member, not expired, member items approved, and minors get only solo allowed kinds.
- Caveat: the only live caller passes `reviewState: "approved"` itself (network.ts:2980). So this proof does NOT prove human review before contact. It is useful for the minors half. The real review gate is in network.ts (see network-service.md).
- Effort S. Trial t3: verified.

### C8. Interval subtract (interval.ts:21-29)
- Property: output intervals are non-empty and do not overlap the removed span. Presence overlap (ME-011) rests on it.
- Blockers: tuple destructuring in the parameter and in for-of; the trial used `{s, e}` records and a `while`. Real tuples with `[0]`/`[1]` access may work; not tried.
- Add later: output is inside the input (needs a coverage predicate). `union` needs a rewrite.
- Effort S. Trial t6: verified.

### C9. Pair key symmetry (world.ts:15)
- Property: `pairKey(a,b) === pairKey(b,a)`. All blocks and cooldowns use this key, so a broken key would lose a block.
- Blockers: `const` arrow must be a `function`. Needs totality and asymmetry of `JSStringLt`, an induction of 2 short lemmas. Injectivity is false if an id holds `|` (world.ts:124 splits on it); add a guard or a precondition.
- Effort S. Trial t8: first run 1 error, then **10 verified, 0 errors** with 2 lemmas. File also holds `harmonic2` symmetry and `monoInPos`.

### C10. Score arithmetic (scoring.ts:23-39, 177-183; policy.ts:277-279; world.ts:403-406; attention.ts:179-187)
- Properties: pair harmonic is symmetric (verified, t8); `netValue` does not fall when the positive sum rises at confidence at least 0 (verified, t8, no lemma); debt at most 2 x cap (verified, t2); `acceptanceOf` in [0,1] (verified, t2, 1 lemma and 4 asserts); interpolation between knots stays in [y0,y1] (t2: **2 errors**, needs a product lemma).
- Blockers: all of the float blockers above. Body changes were needed (`0 * a`, `fmax`). `harmonic` over arrays and `reduce` not tried.
- Value: low. These are quality, not safety. `bun run sim` already gates them. Do after lsc gets real `Math.min/max` and literal coercion.
- Effort M now, S after those lsc fixes.

### Not tried
`planAllowanceConfig.stricter` (rate at most min of state and allowance; S), `relayClefDecide` head branch (S), `pipelineDecision` / `pass2Accepts` (S, evals only), `recordProbeAnswer` (S, sim only), `validatePack` floor (S, sim only).

## 3. Bugs

Repro for D1 to D3: `bun run <scratchpad>/research/engine-core/repro/repro.ts`. It needs no keys and makes no sends.

**D1. One member can be an alternate in two plans of one run. Severity: medium.** plans.ts:375-387. `used` collects `invited` only, and the alternates filters check `invited` only, so the comment "each member in at most one plan per run (participants and alternates)" is false. Repro: 13 adults, 6 free Saturday, 6 free Sunday, 1 free both days at lower confidence. Output: both plans list `alternates p12`. If both plans backfill, p12 gets two probes and can be double-committed, including at the same slot when two activities share one. Fix: C2.

**D2. A closed or expired intent opts a member in to a lane. Severity: medium (consent).** world.ts:205-206. `relabelIntent` runs before the liveness check at :207. Repro: member with `categoriesOptIn: ["social"]`, one 90-day-old closed intent "learn to sail" category growth. Result: lanes `["social", "hobby"]`, live intents 0. The member stays opted in to hobby, with no live want, for as long as the row is in the snapshot. Fix: move the `growthAsHobby` lines under `if (!live) continue`. Add an integration case. Check first that the sim does not depend on it.

**D3. `acceptedBy` and `noResponse` are not canonicalised. Severity: low.** world.ts:149-151 maps `participants`, `declinedBy`, `contributors` only, against ME-006. Repro: 5 yes answers recorded under `phone:a`: acceptance 0.45 instead of 0.843. Effect: wrong send-order estimate, not a safety issue.

**D4. Stale "need" channel. Severity: low (docs, dead branch).** retrieval.ts:65-66, 78, 85 and packs/network/index.ts:52 describe a channel that keeps members below `minSim`. Commit 47a46c3 removed the only `channels.add("need")` with its off-by-default flag, so `channels.has("need")` is always false here. Behaviour did not change. Remove the branches and comment, or restore it on evidence.

**D5. Safety code with no caller. Severity: review needed.** `sendTimeReason`, `eligibilityFor` (filters.ts:229-251), `revalidateHold`, `addToHold`, `reengagement`, `itemsForProposal`, `partnerItem`, `warmMention`, `applyLearnedCadence` appear in no package, script or test outside their own files. CLAUDE.md platform decision 11 says to pass the category to `eligibilityFor` at send time. Either the network has its own recheck (see network-service.md) and these should go, or a guard is missing. This report did not audit the network send path.

**D6. `planAsks` exclude is never filled. Severity: low (dead code).** policy.ts:41 creates `exclude`; `add` (:51) fills only `asks` and `extraProactive`, and no pack hook receives it. So `f.askFirst` is always 0 and `SelectOptions.exclude` is dead. The comment at policy.ts:37 ("needs the same availability and budget") is left to each pack; networkPack checks via `memberReason`, slopPack does not check the budget. Slop's `add` runs once per missing field and counts each as a proactive message, though one message carries them. See the packs report.

**D7. Clef `minor_signal` does not set `ageSignal`. Severity: low to medium.** relayItemAsync (relay.ts:444) passes `first.record.ageSignal`. A minor disclosure that only Clef catches is a hold (`clef:minor_signal`), not a block; the platform age re-check does not fire; and network/relay.ts:242 keeps the text in the review row, which the rules path does not do. Staff still see it, so nothing is delivered. Fix option: treat `minor_signal` as an age signal.

Not defects, but spec notes:
- `c.via ? ...` (filters.ts:43) treats `via: ""` as absent. t3 showed this when the postcondition failed. Harmless, because `""` is not a member. `candidateReason:176` has the same form.
- `maxShare` (policy.ts:74) is applied to the count before filtering, so the final share can exceed it by rounding: n = 7, 2 exploration picks gives 1 of 6, 16.7% against 15%. Arithmetic only; not reproduced in a run.
- `crewSessionPlan` loops forever if `cadenceDays` is 0; `resolvePlans` does not reject it (plans.ts:730). Default is 7.
- `thresholdFor`: the doc comment says category overrides can lower the bar; code only raises it, and a generator override skips the category floor. The second is documented in config.ts:47.
- Confirmed sound by reading: no `Date.now`, `Math.random` or no-argument `new Date` in these files; `performance.now` is only timing and the injected Clef latency clock; `process.env` in engine.ts:90 only names the model. Default knots are monotone (checked in bun).

## 4. Runtime guards

| Place | Guard | Exercised by |
|---|---|---|
| engine.ts:240 | `enforceSelection` plus `finalMinorGuard` in place of the filter. Count drops in `rejectedAfterSelection` and make any non-zero value a sim failure. | `bun run sim --only network`, `--only slop`, `--only audit`; `scripts/sim/conformance.ts` |
| plans.ts:375-387 | Replace the greedy step with proved `pickPlans`. | No test names `planProposals`. Add a `tests/e2e` or integration case from repro R3, plus a sim gate on shared alternates. |
| relay.ts:307-316, 384 | Shipping `relayItem` calls `partyReasons` and `decisionOf`. | `bun run sim --only relay`, `scripts/relay-eval.ts`, `packages/network/test/shared-relay.integration.test.ts` |
| filters.ts:56, :69 | `memberReason`, `pairReason` call `corePrefix`, `pairCore`. | `bun run sim --only safety`, conformance |
| plans.ts:578 | Booking decision core, shipping code calls it. | `--only network` (plan flows through ConsentNetwork) |
| world.ts:15 | `pairKey` as a function. Reject or escape `|` in ids at World build. | `--only safety` |
| config.ts:412 | `resolveConfig`: reject negative weights or a zero norm. `netValue` monotonic proof needs norm > 0; today a zero norm gives NaN, which fails closed but silently. | any sim block |
| attention.ts:435 | Use `it.involvesMember || it.others.length > 0`, so a hand-built item with others cannot skip the gate. Both constructors are consistent today. | plan path in `--only network` |

Per the repo test policy a bug fix adds a gate or an integration or e2e case, not a unit test. The LS proof does not replace that.

## 5. What not to verify, and why

- `selectOnce`, `planProposals` search, `composeGroup`, `beam`: closures, Maps, seeded RNG, sort. Proof cost is high and C1 and C2 give the safety result on the output.
- Exploration, exposure-debt lift, `gini`, `lorenz`, fairness: statistical quality. The sim measures these; a proof says nothing useful.
- `computeComponents`, `complementarity`, `availabilityProb`, `annoyance`: long float pipelines with `Math.pow` over World data. Bounds end in a final clamp, so a proof states the obvious.
- Determinism: a whole-pipeline property. LS proves functions are functions, not that `sort` comparators, RNG forks and Map order are stable. `bun run sim` fingerprints already check it.
- `riskTerms`, `isHomeEntry`, `RELAY_RULES`, `parseRelayRequest`, `MINOR_SIGNAL`, `explain`, leak text: regex and natural language. Use corpora.
- `tokenize`, `localEmbed`, `cosine`, `centroid`, `relayClefFit`: numeric or Unicode, no invariant depends on them.
- Dead code in D5: delete or wire first.
- Timezone and calendar functions (`inMemberQuietHours`, `nextDigestSlot`, `candidateSlots`): `Date` and Intl. Only the `hourInQuiet` arithmetic is in fragment. It is covered in spirit by core time work.
- Monotonicity of the full score: false as a claim on `confidence` when `pos - neg` is negative, because more confidence lowers a negative score. Prove monotonic in the positive sum only (t8).
