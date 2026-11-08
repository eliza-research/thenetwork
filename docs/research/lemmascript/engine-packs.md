# LemmaScript research: engine-packs (packages/engine/src/packs)

Hand-written by the research agent, 2026-11-07. Trial sources: `scratchpad/research/engine-packs/t1_gates.ts` to `t7_negative.ts`, bug reproductions in `repro2.ts` (session scratchpad). lsc 0.6.6, Dafny 4.11, throttled shim. No model, no sends, no sim run. Nothing in the repo changed except this file.

Result in one line: every top candidate verified (55 verification conditions, 0 errors, trials t1-t6). All 5 negative controls that copy the shipping logic failed as intended (t7). Six real defects were found, plus one design note.

Trial caveat: t1-t6 are copies, not the shipped files. Bodies match the shipped code except for the token edits listed in each row. Types are narrowed to the fields the function reads. `canBeMatched` is a stand-in (the real one takes `unknown`; see core.md). So a trial shows feasibility and the property's shape. It is not yet a proof of the shipped function.

## 1. Files reviewed

### slop
| File | Verdict | Why |
|---|---|---|
| slop/appearance.ts | PROVE in place (`canRatePhotos`); rest NOT APPLICABLE | One-line gate is in the fragment. Raters are async I/O, leak list is regex. `appearanceFacet` throws (LS models throw as unreachable), so use the gate. |
| slop/assign.ts | EXTRACT core then prove (`greedyRound` as index picker); rest NOT APPLICABLE | `Edge.s` drags in Scored and generics fail (section 2, #6). `stableRound` is closures on nested mutable Maps. `slopAdjust`, `ratingFloorLift` are World-bound float tuning. |
| slop/biasMonitor.ts | EXTRACT core then prove (alert predicate, quintile index) | `Iterable`, `Object.fromEntries`, sort are out. Pure arithmetic cores are in. |
| slop/clef.ts | EXTRACT core then prove (photo gate) | HTTP and Buffer are out; the gate decision is a pure predicate. Bug 3 is here. |
| slop/clefWeights.ts | NOT APPLICABLE | Data plus validator on untyped JSON. `Bun.file`. |
| slop/copy.ts | PROVE in place (`slopProbeMessage`); rest NOT APPLICABLE | Message builder verified. Other strings are templates; regex in `slopProbeText`. |
| slop/extract.ts | EXTRACT core then prove (`finalize` decisions, lowest age); rest NOT APPLICABLE | 1000 lines of regex readers. `finalize` mutates its argument; `structuredClone`, `JSON.stringify`. |
| slop/generators.ts | NOT APPLICABLE | World-bound generator. `firstOf` is ordering only. |
| slop/geo.ts | EXTRACT core then prove (mutual radius predicate) | `mutualMarkets` sorts and calls trig `cellMiles`; the predicate `d + m <= min(la, lb)` is pure. |
| slop/index.ts | EXTRACT core then prove (`itemGate`) | Inline closure in the pack object. Bug 4 is here. Rest is config data. |
| slop/judge.ts | EXTRACT core (`mutualSeek`, shared with rules) ; rest NOT APPLICABLE | Prompt and context builder. |
| slop/learn.ts | NOT APPLICABLE | Off by default, floats, exp and log. |
| slop/onboard.ts | EXTRACT core then prove (`nextQuestion` scan, `confirmedAfter`); `readBack` NOT APPLICABLE | Tuple tables and closures need a small rewrite. Bug 1 is here. |
| slop/options.ts | NOT APPLICABLE | Data and an `any` merge. |
| slop/plan.ts | PROVE in place (`probePhotoRefs`); `planFirstDate` NOT APPLICABLE | The photo gate verified. Planner sorts floats; `public: true` is a type-level fact. |
| slop/profile.ts | NOT APPLICABLE | Tag parser over Maps, WeakMap cache. Its output types are what the proved predicates read. |
| slop/rules.ts | PROVE in place (`reviewReason`, `ageRangeOf`); EXTRACT (`agesMutual`) ; rule closures NOT APPLICABLE | Pure over a profile record. Rule wrappers take a World. |
| slop/score.ts | PROVE in place (`dealbreakerHit`); `aggregate` MODEL ONLY until the LS real-literal gap closes; rest NOT APPLICABLE | Scoring is exp and pow on floats, tuned empirically. |
| slop/zips.ts | NOT APPLICABLE (`distanceBand` blocked) | Table plus trig. `DistanceBand` literals start with a digit and LS emits an invalid Dafny enum. |
| slop/clef-fit/features.ts | EXTRACT core optional (`planExtraction` skip decision) | Adult and consent gate before a photo is read; operator tool, low value. |
| slop/clef-fit/fit.ts | NOT APPLICABLE | Newton solver on Float64Array. A proof says nothing useful. |
| slop/clef-fit/audit.ts | NOT APPLICABLE | Statistics report; reuses biasMonitor. |
| slop/clef-fit/index.ts | NOT APPLICABLE | Re-exports. |

### peon
| File | Verdict | Why |
|---|---|---|
| peon/schema.ts | NOT APPLICABLE | Constants. |
| peon/match.ts | NOT APPLICABLE | `**1.5`, float scoring. `effectiveLevel` could be proved but the value is low. |
| peon/selection.ts | EXTRACT core then prove (`capOf` from `slateCap`) | World-bound; the final cap is arithmetic. Protects "a seat is never over-filled". |
| peon/seats.ts | EXTRACT core then prove (`seatLeft`, age check) | Snapshot rewrite is out; the capacity and age decisions are pure. Bug 5 is here. |
| peon/rules.ts | PROVE in place (`workAuthOk`, `locationOk`); rule closures NOT APPLICABLE | Sets model well. `locationOk` needs a token edit for narrowing. |
| peon/profile.ts | NOT APPLICABLE | Parser and the firewall. The firewall is a read boundary; a sim invariance test is the right tool. |
| peon/generators.ts | NOT APPLICABLE | World-bound; `harmonic` blocked as in slop aggregate. |
| peon/judge.ts | NOT APPLICABLE | Prompt and context. |
| peon/copy.ts | NOT APPLICABLE | Copy with leak checks. |
| peon/testkit.ts | NOT APPLICABLE | Test data. |
| peon/index.ts | NOT APPLICABLE | Config. |

### friends
| File | Verdict | Why |
|---|---|---|
| friends/rules.ts | EXTRACT core then prove (`groupSizeOk`) | Closures on World. Romance exclusion is a one-line equality. |
| friends/index.ts | EXTRACT core then prove (`beyondTolerance`) | Symmetry of the pair reason. Rest is config. |
| friends/info.ts | NOT APPLICABLE | Tag reader; note on first-tag read in section 3. |
| friends/geo.ts | NOT APPLICABLE | Table, trig. `displayMinutes` is trivial. |
| friends/planner.ts | NOT APPLICABLE | Large closure-heavy planner over `plans.ts`, async-free but mutable and World-bound. `eligible` calls `isMinor`; keep the sim's minor gate. |
| friends/generators.ts | NOT APPLICABLE | World-bound. |
| friends/copy.ts | NOT APPLICABLE | Copy; `ROMANCE_FRAMING` is regex. |

### network
| File | Verdict | Why |
|---|---|---|
| network/rules.ts | EXTRACT core optional (`romanceCompatible` age window, opt-in checks) | Closures on World. `romanceCompatible` in place needs MemberIndex. |
| network/index.ts | EXTRACT core then prove (`itemGate`, shared with slop) | Same predicate as slop should be one function. |
| network/ontology.ts | NOT APPLICABLE | `networkConstraints` has regex; fail-closed age parse is covered by sims. |
| network/generators.ts | NOT APPLICABLE | 11 World-bound generators. Reviewed the minor guards (`isMinor` at warmPath, groupComposer, networkGrowth); core filters are the real gate. |
| network/judgeContext.ts | NOT APPLICABLE | Pseudonymous JSON builder with byte-identity rules. |
| network/prompts.ts | NOT APPLICABLE | Prompt strings. |
| network/copy.ts, calibrator.ts, taxonomy.ts, activities.ts, vocabulary.ts | NOT APPLICABLE | Copy, data, regex. |

## 2. Candidates ranked by value

Effort: S under an hour, M a few hours, L a day or more. "Edit" means the change needed to shipping code.

| # | Where | Function | Property | Protects | Blockers, edit | Effort | Trial |
|---|---|---|---|---|---|---|---|
| 1 | slop/plan.ts:83 | `probePhotoRefs` | at most 1 photo; any photo implies consent, not held, subject and recipient both pass `canBeMatched`, id is opaque | minors, scores and photos, per-item consent | inline `{age}` param needs a named type; `subject.held` truthy to `=== true`; `//@ option safe-slice true`; `isOpaquePhotoId` extern (regex) | S | t1: 7 verified, 0 errors |
| 2 | slop/appearance.ts:44 | `canRatePhotos` | false for undefined; true only if `canBeMatched(age)` and age not known-unverified | adults only in the rater | `!!s && x` does not narrow in a return; use a ternary | S | t1 |
| 3 | slop/onboard.ts:89 | new `confirmedAfter(changed, yes, minor, declined)` | confirmed implies yes, no change, not minor, not declined | consent only on yes; Bug 1 | extract; JSON.stringify and regex stay outside | S | t4: 9 verified; shipping logic fails (t7) |
| 4 | slop/extract.ts:847,865 | new `matchableOf`, `minorOf`, `lowestAge` | matchable implies adult, 5 hard fields, confirmed, not minor, not declined; minor is sticky; age under 18 sets minor; lowest age wins | minors never matched | `finalize` mutates its input, so extract; `\result!` not allowed in specs | S | t4 |
| 5 | slop/onboard.ts:122 | `nextQuestion` as `pick` scan plus guard | minor or declined gets no question; a returned reason has room under the 2-ask cap and comes from the table | no dating question to a minor; re-ask cap | replace tuple array and closures with two arrays and a `canAsk` function; `Field<T>.value` collides with `Option.value` unless narrowed by ternary | M | t4 |
| 6 | slop/assign.ts:116 | `greedyRound` as `greedyPick` (indices) | no member appears twice in a round | congestion cap, one thread at a time | real `Edge` has `s: Scored`; `<E extends PairEdge>` failed (abstract type, no members). Index picker works; `greedyRound` maps indices back | S | t3: 2 verified in place on a reduced Edge; t6 index form verified; generic form: "member 'a' does not exist in abstract type 'E'" |
| 7 | slop/rules.ts:46 | `reviewReason` | confirmed review always holds; failed check holds unless cleared; required-but-unverified always holds, even cleared; safety cue holds unless cleared | human review gate, safety holds | the real SlopProfile must translate (Map, Cell); `.some(lambda)` is fine in code, specs use `exists` | S | t2: 6 verified, 0 errors |
| 8 | slop/index.ts:153, network/index.ts:89 | new shared `romanceItemAllowed` | allowed implies `canBeMatched`, opt-in list present and has the lane | minors; Bug 4 | extract one function for both packs; removes a hard-coded 18 | S | t5: 15 verified; shipping logic fails (t7) |
| 9 | peon/seats.ts:65,120, selection.ts:95 | `seatAllowed`, `seatLeft`, `capOf` | a seat exists only for `canBeMatched`; `0 <= left <= posted`; run slate at most `seatCap`; probation cap holds | minors; seat never over-filled; Bug 5 | `//@ type room real` | S | t5 |
| 10 | slop/clef.ts:220 | new `photoPasses(oneAdult, gate)` | a missing gate answer never passes | adults only; Bug 3 | `clefFeatureRow` must keep "missing" visible for gate questions | S | t6: 16 verified; shipping logic fails (t7) |
| 11 | slop/rules.ts:92,105,117 | `reprobeReason`, `mutualSeek`, `agesMutual` | revealed pairs are never re-proposed; both filters are symmetric and name each bound | stated preferences are filters, both ways | the same `seeks.includes` test is copied at rules.ts:108, judge.ts:61,78, index.ts:85; share one. `[lo, hi]` tuples model as seq, so pass flat numbers | S | t2, t6 |
| 12 | slop/score.ts:16 | `dealbreakerHit` | unknown values never count as a hit | "unknown never counts" | `SlopProfile["values"]` needs a named `Values` type | S | t2 |
| 13 | slop/copy.ts:55 | `slopProbeMessage` | at most 1 photo; empty list leaves the text unchanged | probe rules | `readonly {id}[]` needs a named type | S | t6 |
| 14 | slop/biasMonitor.ts:49,57 | `isAlert`, `quintileOf` | alert implies `n >= minN` and ratio under threshold; quintile is 1..5 | bias monitor | `ratioOf` blocked (see below) | S | t5 |
| 15 | friends/rules.ts, friends/index.ts, peon/rules.ts:35,41 | `groupSizeOk`, `beyondTolerance`, `workAuthOk`, `locationOk` | group 3-6, pair exactly 2, symmetric transit reason, authorization and mode filters | hard filters | peon is local only; `j.area` check needs a `=== undefined` edit | S | t5, t6 |

Sample annotation (candidate 1, verified):
```ts
//@ verify
//@ ensures \result.length <= 1
//@ ensures \result.length > 0 ==> subject.photoConsent && subject.held !== true && canBeMatched(subject.age) && canBeMatched(recipient.age)
//@ ensures forall(i, 0 <= i && i < \result.length ==> isOpaquePhotoId(\result[i].id))
```

### Trial results
| File | Output |
|---|---|
| t1_gates.ts | `Dafny program verifier finished with 7 verified, 0 errors` (after 3 failed tries; the failures are the blockers above) |
| t2_holds.ts | `6 verified, 0 errors` |
| t3_assign.ts | `2 verified, 0 errors` (invariants must sit inside the loop body; placed before the `for` they are dropped with no warning) |
| t4_onboard.ts | `9 verified, 0 errors` |
| t5_caps.ts | `15 verified, 0 errors` (`ratioOf`, `harmonic` removed; see below) |
| t6_misc.ts | `16 verified, 0 errors` |
| t7_negative.ts | `1 verified, 5 errors`: 5 of 5 shipping-logic copies fail their specs, as intended |

### LS gaps met (for the implementation wave)
- Return `a !== undefined && a.x` does not narrow; only `if` and `?:` do.
- Specs: no lambdas (use `exists`), no `\result!`, and an extern's lifted contract does not narrow its premise. Give the predicate a body instead.
- Inline object types as parameters emit invalid Dafny. Use named interfaces.
- String-literal unions with a leading digit emit invalid Dafny (`DistanceBand`).
- Real numbers: `//@ type x real` works per parameter, but an integer literal in a real-typed branch fails ("got int and real"), including `0.0`. So `ratioOf` and `harmonic` fail to resolve. `Math.min` has no real overload in specs.
- Generic bound `E extends T` gives an abstract type with no fields here. This conflicts with SUBSET.md, so test it again after any lsc upgrade.
- `number` is an ideal integer or real. NaN, Infinity and rounding are out of the model, so `Number.isFinite` guards and NaN-from-tags behaviour stay with sims.

## 3. Bugs

Reproduce all with `bun run scratchpad/research/engine-packs/repro2.ts`.

1. **Read-back confirmed by a non-yes (medium, live path).** packages/engine/src/packs/slop/onboard.ts:93. A local regex beside `classifyYesNo` matches only the start of the message. Core reads these as `unsure`. Outcome with every hard field set: "right now i'm not sure about that", "right, no wait that is wrong", "perfect would be someone else entirely", "correct me if I'm wrong but that isn't it" and "100 percent not" all give `confirmed: true, matchable: true`. The live path is packages/network/service/packs.ts:123. This also breaks repo rule 11 (no local yes/no parser). Fix: bare-word match only, anchored at the end of the message, or add the words to core's parser. Add onboarding corpus rows.
2. **LLM age under 13 dropped (low, not wired).** extract.ts:1069 has `a < 18 && a >= MIN_MEMBER_AGE`. `selfAge: 12` sets nothing: age undefined, minor false. `selfAge: 15` sets minor. The doc says an LLM age "only marks a minor", so 12 must mark one too. `extractSlopProfileLLM` is used only by scripts/sim/onboard.ts today. Fix: remove the lower bound on the minor mark. The `declined` rule stays strict.
3. **Clef adult gate fails open (medium).** clef.ts:96 reads a missing `noul` as 0.5, clef.ts:220 compares `>= gate.oneAdult`, and the placeholder gate is 0.5. A Clef response with no `gate.one_adult` answer was rated: `overall 1.67, confidence 0.45`. The `?? 0` at clef.ts:220 is dead code, which shows the intent was fail closed. clef-fit/fit.ts:366 has the same pattern with `?? 1`. The subject's stated age still has to be 18+, so this removes the photo-side check only. Fix: a gate question with no answer gives no row.
4. **slop itemGate treats a missing opt-in list as consent (low to medium).** slop/index.ts:153 has `m.categoriesOptIn ?? [SLOP_LANE]`. Repro: `{age: 30}` gives null (allowed). networkPack fails closed on purpose (network/index.ts:87 comment, engine-attention-plans-7). The other slop checks still need `optedIn`, so this is a second-layer gap. I did not check whether any live view omits the list. Fix: `?? []`.
5. **peonSeats accepts invalid ages (low, peon is local).** seats.ts:65 uses a local check, so age 150 gets a seat stamped `age: 18`, which hides the bad value from every later gate. Core policy says invalid ages fail closed. It is also a hard-coded age, against the code invariants. Fix: `canBeMatched(owner.age)`.
6. **appearanceLeak misses two body-type labels (low).** appearance.ts:178. The raw enum `plus_size` passes (the pattern has `[- ]` only), and `average` passes (probably on purpose, as a common word). Used on relay text at packages/network/src/relay.ts:227. Fix: allow `_` in the pattern. Leave `average` to `rating:*` rules and record that choice.

Design note, not a defect: biasMonitor compares each group with the overall rate, while the classic four-fifths rule compares with the best group. Rates 1.0 and 0.7 with equal members give 0.82 against overall (no alert) and 0.70 against the best group. The founder's rule says "0.8x outcome ratio", so this is a decision to confirm.

Checked and not a bug:
- A held manager's seat has no `safetyHolds` row, but `seatRoute` and `eligibleIn` route to `managerProblem` (network.ts:4468, 4500).
- `validateClefWeights` accepts a file with no provenance, but platform/src/photos.ts:75 refuses it first.
- `slopOnboardTags` returns no `replaces` for a minor, but the service clears `romance:` and `slop:` itself (packs.ts).
- friends `verified` reads the first tag only, but the service has one facet per check (`${memberId}:verify:${check}`). Latent, safe today.

Open question: `finalize` keeps `age` on a declined under-13 and the service stores that state (words stripped). Core says nothing is stored. Not traced to the join path.

## 4. Runtime guards

| Proved predicate | Replaces or backs up | Exercised by |
|---|---|---|
| `canBeMatched` via `seatAllowed` | seats.ts:65 local check | `bun run sim --only peon` (scripts/sim/peon-seats.ts) |
| `romanceItemAllowed` | both `itemGate` closures | `bun run sim --only slop`, `--only network`, scripts/sim/conformance.ts |
| `confirmedAfter` | onboard.ts:93 | `bun run sim --only onboard` (add non-yes corpus rows; they fail before the fix) |
| `photoPasses` | clef.ts:220 and fit.ts:366 | `bun run sim --only clef` (add a fake fetch with no gate answer) |
| `probePhotoRefs` (in place) | already the runtime check | `bun run sim --only slop`, relay integration tests |
| `reviewReason` (in place) | already the runtime check | `bun run sim --only slop`, safety block |
| `greedyPick` | `greedyRound`; also assert it on `stableRound` output (not provable) | `bun run sim --only slop` congestion gate |
| `mutualSeek` | four copies of the seeks test | conformance "no race filters" and orientation gates |
| `seatLeft`, `capOf` | seats.ts:120, selection.ts:95 | scripts/sim/peon-seats.ts |

Add a runtime assert only on `stableRound`, because that one cannot be proved: each member at most once per round.

## 5. What not to verify

- Regex readers in extract.ts, `appearanceLeak`, `RELAY_RULES`: regex is out of the fragment, and the risk is linguistic. Use corpus rows and sims.
- Scoring (`directional`, `compatEstimate`, `pairScore`, `learnedFactor`, `slopAdjust`): tuned floats; the claims are statistical. An ideal-real proof says nothing about NaN or quality.
- `stableRound`: closures on nested mutable Maps, and the property that matters (stability) needs a large spec. Runtime assert plus sim.
- Clef fitting and audit: numerics and statistics.
- Raters and `clefRun`: I/O. Only the gate decisions are worth lifting out.
- `parseAppearance`, `profile.ts`, `peon/profile.ts`: string tag parsers; the firewall is checked by sim invariance tests.
- Planner and generators: World-bound; the guarantees live in core filters, covered by the engine-core area.
- `relayItem` (packages/engine/src/relay.ts): out of this scope. Reviewed for its interface only; it belongs to engine-core.md. `relayItem` has the same shape as candidate 3, so its `finish` decision (block over hold over pass, `rendered` empty unless pass) is a good extraction there.
