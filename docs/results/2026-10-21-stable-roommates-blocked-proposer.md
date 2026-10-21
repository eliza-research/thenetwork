# Stable roommates: a rejected proposer never proposed again

`packages/engine/src/packs/slop/assign.ts`, function `stableRound`. Base revision `98d8ada0aa76251872751910837e6a63157ba6c4` (current `main`). **No LLM calls, $0.** Every run used API keys unset and no `LIVE_TESTS`. Validation on this tree is `bun run sim`.

## Reproduced problem

The pack header documents `assignment: "stable"` as "stable stable roommates (Irving 1985) on each member's own predicted preference order: no two members would both rather be proposed to each other than to whom they got."

The implementation did not deliver that property. On the real engine pipeline the stable assignment returned matchings that contain **blocking pairs**: two matched members who each prefer the other, on their own predicted enjoyment, to the partner they got.

Command (the new gate, seeds 1-5, 60 personas per city):

```sh
bun run sim --only slop
```

| | candidates | matched pairs | blocking pairs |
|---|---|---|---|
| base `98d8ada0` | 950 | 177 | **5** |
| this branch | 950 | 174 | **0** |

The base run also breaks on other seeds and scales: seeds 1-8 at 60 per city give 3 blocking pairs; seed 13 at 150 per city gives 12 blocking pairs across 119 matched pairs. Seeds 21-30 at 150 per city give 0 on the base, so the defect is seed-dependent, which is why the pinned launch gates never saw it.

## Cause

Phase 1 of Irving's algorithm keeps a `free` queue of members with no outstanding proposal. When a receiver `y` gets a proposal `x` that it ranks above the one it holds (`cur`), the code deletes every candidate `y` ranks below `x`, and `del(y, cur)` is what returns `cur` to `free`:

```ts
if (held.get(a) === b) { held.delete(a); free.push(b); }
```

That release depends on `held.get(y) === cur`. The base code ran `held.set(y, x)` **before** the delete loop, so by the time `del(y, cur)` ran, `held.get(y)` was already `x`. The rejection freed nobody. `cur` had its outstanding proposal withdrawn and never entered `free` again, so it never proposed to anyone else.

An instrumented run of the base phase 1 on seed 13 shows it directly:

```
base:      phase1: nyc-004 -> la-017 accepted (rejected la-009) | free=[...]
           phase1: sf-002 -> la-017 rejected (prefers nyc-004) | free=[...]      <- la-009 never returns
           phase2: no stable matching (list empty)
           ok flag: false -> greedy fallback
fixed:     phase1: nyc-004 -> la-017 accepted (rejected la-009) | free=[..., la-009]
           phase1: la-009 -> sf-011 accepted (rejected nyc-004)
```

Phase 1 ends with a list emptied by a rejection rather than by the algorithm. Phase 2 reads that as "no stable matching exists", so `stableRound` falls through to `greedyRound` on the whole edge set. The caller cannot tell: `SelectionResult` carries `selected` and `budgetSkips` only, and no log field says the fallback ran. The result is a greedy matching sold under the name `stable`.

This is why the base repository is green. `options.ts` defaults `assignment: "greedy"`, so the 38/38 slop gates and the full 304/304 gate run never call `stableRound`. The only callers are the `rejected` and `ablations` presets in `packages/sim/src/apps/slop/packEval.ts`, which report metrics but assert nothing about stability.

## Fix

Run the deletions before the assignment, so `del(y, cur)` observes the state its own contract requires:

```ts
if (cur === undefined || ry.get(x)! < ry.get(cur)!) {
  // y holds x and rejects the proposal it held (cur, if any). Delete the worse candidates
  // first: del(y, cur) then sees held.get(y) === cur and frees cur, exactly as the code
  // comment says. Setting held before the deletes would hide cur, and cur would never
  // propose again.
  for (const z of [...active.get(y)!]) if (ry.get(z)! > ry.get(x)!) del(y, z);
  held.set(y, x);
  break;
}
```

The base comment already stated the intended order ("delete them (which frees cur, if any)"). The code contradicted its own comment; this restores it. No signature, no type, no config field and no log shape changes.

## Two implementations not used

**Push `cur` back onto `free` explicitly.** Call `free.push(cur)` in the branch before the delete loop, and leave `held.set` first. This also restores the invariant, and it is the version measured first. It was not used because it adds a second, redundant route for the same event: `del` already owns "a held proposer was withdrawn", and the explicit push would have to stay correct if `del` ever changed. The chosen form keeps one owner for the release.

**Run the whole algorithm on a copy, then diff.** Keep the base ordering and re-derive the free set from `active` after each acceptance. This avoids the ordering question entirely, but it turns an O(1) release into a rescan and makes phase 1 harder to read than the specification it implements.

## Measured effect, and the cost

Seeds 13, 1-8, perCity 150, real engine, `assignment: "stable"`:

| | matched pairs | unmatched adults | total own benefit | total pair value | blocking pairs |
|---|---|---|---|---|---|
| base `98d8ada0` | 1059 | 439 / 2557 | 1515.87 | 718.10 | **163** |
| this branch | 1038 | 481 / 2557 | 1511.34 | 715.99 | **0** |

The repair costs 21 matched pairs (2.0%) and 0.3% of total own benefit. It buys the documented property.

That trade-off is inherent, not an artifact. A stable matching is not a maximum matching: pairs that would block must be given up, and members freed by the removal are left unmatched. The base "gained" its extra 21 pairs by returning 163 members to pairings they prefer not to keep. Reported here because the pack documents stability as the reason to choose this mode; a deployment that wanted maximum pair count should set `assignment: "greedy"` and say so.

## The gate

`scripts/sim/slop.ts`, one `b.run`. It calls the real engine with `makeSlopPack({ assignment: "stable" })`, captures the arguments `stableRound` saw by wrapping `pack.selection.assign`, and asserts `0` blocking pairs over seeds 1-5 at 60 per city. Per `docs/tests-policy.md` the validation layer is the simulation CLI, so this is a sim gate and not a unit test.

The blocking-pair test compares own benefit (`Candidate.benefit[member]`) strictly. An exact tie is not a block, so the assertion does not depend on the value or id tie-break inside `stableRound`, and it cannot fail on a tie-break change. The gate also asserts a matched-pair floor, so it cannot pass vacuously on an empty run.

The base fails it with `expected 5 to be 0`. This branch passes.

## Limits

- The gate covers seeds 1-5 at 60 per city. The defect is seed-dependent, so this is a floor on the rate, not a bound. Seeds 13 at 150 per city (12 blocking pairs on the base) and 1-8 at 150 per city (163) were measured with the same predicate but are not in the gate, to keep `bun run sim` fast.
- Blocking pairs are counted over eligible pairs both of whose members are matched elsewhere. A member left unmatched cannot block, and cannot be part of a blocking pair. This matches the definition in the pack header.
- The repair is in the algorithm, not the accounting. `stableRound` still returns no signal when it used the greedy fallback, so a future regression would again be invisible to any gate that does not recompute stability. Reporting that here rather than widening this change: adding a field to `SelectionResult` touches `pack.ts`, the engine and every pack, and is a separate decision.
- `stableRound` is reached only through `assignment: "stable"`, which no production preset selects. This is a correctness defect in a shipped, documented option with sim callers, not a user-visible incident.
- No real-LLM run: the defect and the repair are entirely in deterministic assignment arithmetic, so an LLM run could not exercise it. No provider, model or cost is claimed.
- The PostgreSQL-backed and e2e suites were not run for this change. It touches no database, no HTTP route and no client workflow. `bun run typecheck` and `bun run sim` are the executed evidence.

## Executed evidence

`bun run typecheck`: exit 0, including the new gate source.

`bun run sim`, base and branch on the same machine in the same environment:

| | blocking gates | tracked off target |
|---|---|---|
| base `98d8ada0` | 304/304 | 20 |
| this branch | 305/305 | 20 |

The slop block reports 39/39 with `PASS assignment stable: no matched pair blocks another on own benefit (0 blocking pairs)`. No other gate changed state.

Four cases report tracked in both runs because the local Postgres 16 build has no `psql` and no `pg_dump`: the backup drill, the pipeline, `observatory-6` and `network-service-M1`. This is a property of this machine and affects base and branch identically. `bun run test:integration`, `bun run test:e2e` and `bun run security` were not run; CI remains the executed gate for those.