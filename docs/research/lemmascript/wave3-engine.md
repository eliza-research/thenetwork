# LemmaScript wave 3: engine-w3

Date: 2026-11-08. Scope: packages/engine/src (packs included) and packages/engine/test. Hand-written. Counts come from
`lsc check --backend=dafny` (lsc 0.6.6, Dafny 4.11 release build with Z3 4.12.1, the CI toolchain). No LLM calls, no sends.

## Result

| File | Verified before | Verified now | What is new |
|---|---|---|---|
| pairKey.ts | 4 | 12 | `keyableId`; pairKey injectivity (task 2) |
| intervalCore.ts | 4 | 4 | `mergeSorted` keeps non-empty parts non-empty, so `subtractSpan`'s `requires` holds at the geo.ts call (task 1) |
| scoreCore.ts | 12 | 20 | `realZero`, `harmonic`, `interpolate` moved in and proved (task 4) |
| packs/decisions.ts | 40 | 44 | `realOne`, `ratioOf`, `distanceBandIndex` (task 4) |

All four files are already in LemmaScript-files.txt; no line was added. Trust counts for these four files: assume 0, havoc 0,
extern 0, axiom 0. No `//@ extern`. proofs/trust.json needs no change for this area.

New integration file: `packages/engine/test/proof-preconditions.integration.test.ts` (10 cases). Before the fixes: 1 pass,
9 fail (the one pass is "the defaults and the pack defaults pass"). After: 10 pass, 0 fail.

## 1. Production enforces the proved preconditions

A proof says nothing outside its `requires`. Every `requires` of a proved engine core is listed below with what makes it
hold in production. Config preconditions are now refused (throw, fail closed) where config is resolved; each test is
written so that NaN fails it too (`!(x > 0)` style).

| Core | `requires` | Source of the value | How production holds it |
|---|---|---|---|
| scoreCore `netValueOf` | `norm > 0` | `weights.fit + mutualBenefit + warmPath + novelty + timingFit` | NEW: `engineConfigErrors` in `resolveConfig`, World build, `validatePack` |
| scoreCore `debtStep` | `floor <= 2 x cap` (floor is 0) | `selection.exposureDebtCap` | NEW: `exposureDebtCap >= 0`, same three places |
| scoreCore `acceptanceEstimate` | `strength > 0`, `0 <= prior <= 1` | `acceptance` | NEW: same three places |
| scoreCore `acceptanceEstimate` | `0 <= yes <= n` | `responseHistory` counts | by construction: `bump` adds 1 to `n` on every call and to `yes` on some |
| attentionCore `capValue` | every state cap and the minors cap: `limit >= 0`, `periodDays > 0` | `AttentionConfig.caps`, `minors.cap` | NEW: `attentionConfigErrors` in `resolveAttention`, `validatePack` (pack defaults and `attention.config`), and in `capFor` itself, because the network hands `DEFAULT_ATTENTION` and `planAllowanceConfig(...)` to `composeMessage` without resolving them |
| attentionCore `stricterCap` | `st.periodDays > 0`, `allowance.periodDays > 0` | state caps; `PlansConfig.allowance` | state caps as above; NEW: `plansConfigErrors` in `resolvePlans` (which network.ts calls) and `validatePack`. The allowance becomes a state cap in `planAllowanceConfig`, so its `limit >= 0` is checked too |
| planCore `groupQuorum` | `n >= 3` | `p.participants.length` | the only caller (attention.ts `startProbeFlow`) calls it only when `group` is `length > 2` |
| intervalCore `subtractSpan` | `s < e`; every input part `s < e` | geo.ts `location` | `s < e`: the loop skips `e <= s`. Parts: `[start, end]`, `subtractSpan` output (proved non-empty) and `union` output. NEW: `mergeSorted` now proves that non-empty inputs give non-empty parts, which closes the chain. With `start >= end` every dated presence is skipped, so `subtractSpan` is never called |
| intervalCore `mergeSorted` | parts `s <= e`, sorted by `s` | `union` | `union` sorts by start; parts come from the chain above |
| selectionGuard `countIn`, `cityCount` | `n <= out.length` | proved callers only | verified inside the file |
| decisions `firstQuestion` | `needed.length === asked.length` | slop/onboard.ts | both arrays are `order.map(...)` |
| decisions `quintileOf` | `0 <= i < n` | biasMonitor `ratingQuintiles` | `i` is the map index over `xs`, `n` is `xs.length` |
| scoreCore `interpolate` (new) | every knot has 2 entries | `[number, number][]` | the TypeScript tuple type |

New functions in config.ts: `engineConfigErrors`, `attentionConfigErrors`, `plansConfigErrors`, `assertNoConfigErrors`.
`validatePack` is not called in production today (the conformance sim calls it); the resolvers and World build are.

Not in the model: `Infinity` (a cap limit may be `Infinity`; the check accepts it) and NaN inside a value that passes the
check, for example a NaN `capOverride` (`Math.floor(NaN)`).

## 2. pairKey injectivity

`keyableId(id)` is `!id.includes("|")`. World build (the constructor, so `runEngine` and `buildWorld`) refuses any member
id that is not keyable, as it already refused duplicate ids. Proved:

`keyableId(a) && keyableId(b) && pairKey(a, b) === pairKey(c, d) ==> {a, b} = {c, d}` for all `c`, `d`.

Only `a` and `b` need the rule: a key built from an id with a separator has two separators, so it is never equal to a
member pair's key. So an edge or a record with a non-member id that holds `|` cannot block or hide a member pair.
Proof: `NoSep` unfolds `StringIndexOf` to "no index holds `|`"; `Split` shows the first separator of `x + "|" + y` is at
`|x|`.

Before the rule, members "a" and "b|c" had the key of "a|b" and "c" ("a|b|c"): a block or used pair of one applied to
the other. Case: "World build refuses a member id with '|'" and "runEngine refuses it too" (failed before: no throw).

## 3. D4 and D6: dead code removed

- D4 (retrieval.ts): `channels.has("need")` was always false (nothing adds "need" to that set since 47a46c3). Removed
  the two tests and the stale comment ("kept even below minSim"). Structured satisfaction still joins the ordering.
  networkPack's declarative `retrieval.channels` list keeps "need"; nothing reads that list.
- D6 (policy.ts, engine.ts, pack.ts, packs/slop/assign.ts, types.ts): `AskPlan.exclude` was never filled. Removed
  `AskPlan.exclude`, `SelectOptions.exclude`, `AssignContext.exclude`, the three `exclude.has` tests, and the run-log
  field `funnel.askFirst` (always 0; nothing reads it).

## 4. Skipped quality functions (real literals, leading-digit union)

The exact lsc problem: a bare integer literal in a real-typed return branch is emitted as an `int`
(`Error: the two branches of an if-then-else expression must have the same type (got int and real)`). `0.0` gives the
same error (TypeScript normalises it to `0`). A `//@ type ZERO real` on a top-level `const ZERO = 0` is ignored
(`const ZERO: int := 0`), and a call `real(1)` to an identity with a real parameter is not coerced either.

Workaround that keeps outputs the same number: a verified constant function, `realZero()` returning `0.5 - 0.5` (exactly
+0) and `realOne()` returning `0.5 + 0.5` (exactly 1). Each proved file has its own copy, because a cross-file call
would emit `{:axiom}`.

| Function | Now | Proved | Call site |
|---|---|---|---|
| `harmonic` | scoreCore.ts; scoring.ts re-exports it | `>= 0`; `0` when any value is `<= 0`; `> 0` when all are `> 0` | scoring `mutualBenefit`, peon pack aggregate, slop `aggregate` (harmonic arm), complementarity.ts (its local copy is removed) |
| `interpolate` | scoreCore.ts, moved verbatim; attention.ts re-exports it | knot values in [0, 1] give a result in [0, 1] (lemma `Seg`: the segment value is a convex mix) | attention.ts `knotCalibrator` |
| `ratioOf` | decisions.ts | overall 0 gives 1; `ratio x overall = rate` when overall > 0 (so ratio < t is rate < t x overall); `>= 0` for rate `>= 0` | slop/biasMonitor.ts |
| `distanceBandIndex` | decisions.ts | 0 to 4; 0 only under 2 miles; more miles never give a nearer band | slop/zips.ts `distanceBand` maps the index to the label |

Byte-identity, by reading: `harmonic` sums left to right from +0 in a loop, as `reduce(..., 0)` did; the early return
on a value `<= 0` gives the same 0 that the `some` test gave. complementarity.ts called its copy only with two values,
where the copies agree. slop `aggregate` keeps its own length 0 and 1 branches and calls `harmonic` only where the old
inline expression ran. `ratioOf` keeps the truthiness test exactly: `overall !== 0 && overall === overall` (false for
0, -0 and NaN). `distanceBandIndex` uses the same comparisons, so NaN still gives "25+ mi". The sims below confirm it.

The leading-digit union (`DistanceBand`) stays in zips.ts; the proof works on the index, so no union is emitted.
The peon pair harmonic (`(2ab)/(a+b)`, peon/generators.ts) is a different formula and is not proved; in floating
point `2*a*b` and `2*b*a` can differ in the last bit, so "symmetric" would be a claim about reals only.

## 5. probePhotoRefs and canRatePhotos in place: still blocked

Tried on throwaway copies in the same folders (deleted afterwards, with their proof files):

- appearance.ts `canRatePhotos` (as a function with `//@ verify`): `ERROR: Failed to extract const
  'APPEARANCE_LEAK_PATTERNS' at ...:177: Unsupported expression: /\battractive(ness)?\b/i`. The file holds regex tables,
  and lsc extracts every top-level const even in opt-in mode.
- plan.ts `probePhotoRefs`: lsc emits `function {:axiom} canBeMatched(age: Unknown): bool` and
  `function {:axiom} probePhotoIds(...)` (both cross-file), then fails with `unresolved identifier: PROBE_PHOTO_MAX`,
  `unresolved identifier: isOpaquePhotoId` (a regex in relay.ts) and `incorrect argument type for function parameter
  'age' (expected Unknown, found Option<int>)`.

Moving `canBeMatched` into these files would copy the age rule (CLAUDE.md: use `canBeMatched`, do not hard-code ages),
and core/policy.ts is not in this area. Passing it as a boolean is what `photosRatable` and `probePhotoIds` already do;
the wrappers add only `s !== undefined`, the `isOpaquePhotoId` filter and the `{ id }` map. Changing the wrappers'
signatures would change callers in platform and sim. Left as is; the decisions are proved in decisions.ts.

## Force: one mutation per new rule, each rejected by lsc

Run on scratch copies with `lsc regen` (script `scratchpad/w3e/mut.sh`); the shipped files were not changed.

| File | Mutation | Result |
|---|---|---|
| pairKey | key without the separator | 1 error |
| pairKey | `keyableId` tests for `"||"` | 1 error |
| intervalCore | a new part `[s, s]` in `mergeSorted` | 1 error (invariant) |
| scoreCore | `interpolate` uses `x - x1` | 2 errors (TS and .dfy changed together: `regen` cannot merge a changed line) |
| scoreCore | `harmonic` skips only `x < 0` | 1 error |
| decisions | bands 1 and 2 swapped | 1 error |
| decisions | `ratioOf` halves the ratio | 1 error |

## Sim parity

Method: the shared worktree changes under other agents, so each comparison uses scratch copies of one tree state (same
command, pinned seeds): A = before D4/D6, B = A + D4/D6, C = B + task 4. Tasks 1 and 2 only add throws; when nothing
throws, the code path is unchanged (A and B both carry them).

Command: `heavy bun run sim --only <block>` in each copy. "Same" means the whole log is identical once timings are
removed: every gate value, every fingerprint, every tracked value.

| Block | A (before D4/D6) | B (D4/D6 removed) | C (B + task 4) | A vs B | B vs C |
|---|---|---|---|---|---|
| network | 62/62 | 62/62 | 62/62 | same (fingerprints 4a88e5a66fba47dc, c8c8ea246cc19056) | same |
| slop | 41/41, 8 tracked off target | 41/41, 8 | 41/41, 8 | same | same |
| peon | 27/27 | 27/27 | 27/27 | same | same |
| friends | 18/18, 1 tracked off target | 18/18, 1 | 18/18, 1 | same | same |
| relay | not run | 60/60, 4 tracked off target | 60/60, 4 | - | same |

The tracked values off target are the same in every copy (they come before this change).

## Tests and checks

All with the heavy lock, one at a time.

| Command | Result |
|---|---|
| `lsc check --backend=dafny` pairKey.ts, intervalCore.ts, scoreCore.ts, packs/decisions.ts | 12, 4, 20, 44 verified, 0 errors |
| `bun test packages/engine/test/proof-preconditions.integration.test.ts` | before the fixes 1 pass, 9 fail; after 10 pass, 0 fail |
| `bun test packages/engine/test/selection-guard.integration.test.ts` | 8 pass, 0 fail |
| `bunx tsc --noEmit -p .` | 1 error: scripts/sim/slop.ts(328,45) `Property 'exclude' does not exist on type 'AssignContext'` (see below). None in packages/engine |
| shared worktree, `sim --only slop` | PASS 41/41 (8 tracked off target, as before) |
| shared worktree, `sim --only peon` | PASS 27/27 |
| shared worktree, `sim --only friends` | PASS 18/18 (1 tracked off target, as before) |
| shared worktree, `sim --only relay` | PASS 60/60 (4 tracked off target, as before) |
| shared worktree, `sim --only network` | FAIL 59/62: "attention: nothing agent-started in quiet hours ..." (ny-0028, o002285), "consent vs push: meetings (pooled) > 140: 124", "plans: 0 minors in any plan role" |

The three network failures do not come from this area. Copy D = the shared worktree's packages/network (in flight in
another area: network.ts, transitions.ts) with every engine file at HEAD gives the same three failures, with the same
values. Copy C = my engine files with the packages/network of the earlier snapshot passes 62/62, and its engine source is
byte-identical to the shared worktree's. The network owner must look at them; "0 minors in any plan role" is a safety
gate.

## Changes needed in files I do not own

- scripts/sim/slop.ts:328 reads `ctx.exclude?.has(id)`. `AssignContext.exclude` is gone (D6), so `tsc` reports it.
  Replace the line with `const usable = (id: MemberId) => !w.get(id)!.inOpenOpportunity;` (the same value at run time:
  `exclude` was always undefined).
- coordinator: proofs/trust.json needs no change for this area (all counts 0).
