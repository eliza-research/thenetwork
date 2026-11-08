# Newcomer welcome: enforce pair constraints, schedule overlap, and avoid edges in pool and host selection

`packages/engine/src/packs/network/generators.ts:newcomerWelcome` and `packages/network/src/network.ts` (`localEncounters:newcomer_welcome`, `distinctAlternates`, `checkRecipient`).
Base revision: `origin/main`.

## Slop contribution receipt
- provider: google
- model: gemini-2.5-pro
- client: antigravity

## Problem

Under Core Invariant #2 (`packages/engine/src/pack.ts:16`):
> "Blocks win: a blocked or avoided pair is never a warm tie, never paired, never a via."

And Section 33.4 ("Newcomer welcome: a new member with few edges joins a low-stakes group with a host"):
Newcomers must be welcomed into compatible, safe small groups where every participant can actually meet and has no blocking or avoid relationships.

The engine and network runtime previously had three critical safety and candidate starvation issues:

1. **`generators.ts:newcomerWelcome` - Unfiltered pool and host starvation**:
   - `pool` was populated using `eligibleMembers(ctx, "social", "guest", "small_group", false, new Set([n]))` and filtered only by `mi.m.homeCity === city` and open/normal participation state.
   - It **never checked** pair-level compatibility with the newcomer: `!pairReason(w, n, id, "social")`. Blocked members, avoided members, and members with dealbreakers were admitted into `pool`.
   - It **never checked** schedule/presence overlap: `w.canMeet([n, id])`.
   - Critically, `hostOk` was computed without checking if the host was blocked by newcomer `n`. Because `hostOk` grants a `+0.4` affinity boost, a host blocked by `n` was boosted straight to the top of `pool.slice(0, w.cfg.group.poolSize)`.
   - When `composeGroup` ran with `forced: [n]` and `needHost: true`, `evaluateGroup` evaluated `compat(n, host) === -Infinity` and rejected any group with the blocked host. If that blocked host had displaced the only clean hosts in the limited pool slice, `composeGroup` returned `null`, resulting in complete candidate starvation for the newcomer.

2. **`network.ts:3829` (local newcomer welcome) - Missing pair safety constraints**:
   - In `localEncounters`, the local newcomer welcome coffee creator selected a nearby host sharing an interest.
   - It **did not check** `!this.blocked(m.id, x.id)`, `!this.avoid.has(pairKey(m.id, x.id))`, or `!this.pairHistory(m.id, x.id, 60)`.
   - Consequently, a newcomer was proposed a 1:1 welcome coffee with a member they had explicitly blocked, had an avoid edge with, or had already met in the past 60 days.

3. **`network.ts:distinctAlternates` and `checkRecipient` - Missing avoid edge checks**:
   - `distinctAlternates` (line 3970) checked `this.blocked(p, a)` but omitted avoid edges (`this.avoid.has(pairKey(p, a))`).
   - `checkRecipient` (line 4230) checked `this.blocked(id, x)` for messages about other members, but omitted `this.avoid.has(pairKey(id, x))`.

## Fix

1. **In `packages/engine/src/packs/network/generators.ts:newcomerWelcome`**:
   - Filter `pool` to ensure all candidates are pair-compatible with the newcomer and have schedule overlap:
     ```ts
     const pool = eligibleMembers(ctx, "social", "guest", "small_group", false, new Set([n]))
       .filter(id => {
         const mi = w.get(id)!;
         return !mi.newcomer && (mi.m.homeCity === city) && (mi.m.state === "open" || mi.m.state === "normal")
           && !pairReason(w, n, id, "social") && w.canMeet([n, id]);
       })
     ```
   - This ensures blocked or disjoint members never enter the newcomer pool or receive a `hostOk` boost, allowing clean hosts to form welcoming groups.

2. **In `packages/network/src/network.ts` (`localEncounters`)**:
   - Added `!this.blocked(m.id, x.id) && !this.avoid.has(pairKey(m.id, x.id)) && !this.pairHistory(m.id, x.id, 60)` to the local host filter.

3. **In `packages/network/src/network.ts` (`distinctAlternates` & `checkRecipient`)**:
   - Added avoid relationship checks `!this.avoid.has(pairKey(p, a))` to `distinctAlternates` and `this.avoid.has(pairKey(id, x))` to `checkRecipient`.

## Verification

1. **Unit tests (`packages/network/test/newcomer-welcome-pair-constraints.test.ts`)**:
   - `excludes blocked host and selects clean host for newcomer welcome group`: PASS
   - `excludes members with disjoint schedule from newcomer welcome pool`: PASS
   - `network local newcomer welcome respects blocked, avoid, and pair history constraints`: PASS
   - `distinctAlternates excludes alternates with avoid relationships`: PASS
   - `checkRecipient rejects messages about others when recipient has avoid relationship with subject`: PASS
   - Result: **5 pass, 0 fail (25 assertions)**.

2. **Typecheck**:
   - `bun run typecheck`: **PASSED (0 errors)**.

3. **Simulation Gates**:
   - `bun run sim --only network,friends,evals`: All blocking gates PASS.
