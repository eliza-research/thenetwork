# Warm path and two-hop: enforce safety holds, pause state, and blocking constraints on intermediaries

`packages/engine/src/retrieval.ts:twoHop` and `packages/engine/src/packs/network/generators.ts:warmPath`.
Base revision: `origin/main`.

## Slop contribution receipt
- provider: google
- model: gemini-2.5-pro
- client: antigravity

## Problem

Under Core Invariant #2 (`packages/engine/src/pack.ts:16`):
> "Blocks win: a blocked or avoided pair is never a warm tie, never paired, never a via."

And Section 33.5 & filters (`packages/engine/src/filters.ts:174`):
> "The warm-path intermediary is named to both sides and asked to vouch: never someone on a safety hold, paused, or blocked by either participant."

The engine previously violated these invariants in candidate retrieval and generation:

1. **`retrieval.ts:twoHop(w, a)` graph traversal omission**:
   - `twoHop` traversed direct positive ties from seeker `a` through intermediary `x` to neighbour `b`.
   - It only checked `if (w.holds.has(x) || w.get(x)?.m.state === "paused") continue;`.
   - It **never checked** whether `a` and `x` were blocked (`w.blocked.has(pairKey(a, x))`), whether `x` and `b` were blocked (`w.blocked.has(pairKey(x, b))`), or whether `a` and `b` were directly blocked (`w.blocked.has(pairKey(a, b))`).
   - It also did not check whether target `b` was on safety hold or paused.
   - When candidate `b` had multiple two-hop paths (e.g. intermediary `x1` with strength 0.9 who was blocked with `b`, and intermediary `x2` with strength 0.7 who was completely clean and friendly), `twoHop` picked `x1` because of its higher strength, ignoring `x2`.
   - Downstream in `retrieveForIntent`, `hop.has(id)` also erroneously granted the `"graph"` retrieval channel to blocked or held members.

2. **`generators.ts:warmPath` slot starvation before ranking**:
   - In `warmPath`, candidates are formed with `via: path.via`.
   - The generator checked `pairReason(w, a, b, intent.category)` and `isMinor(w, path.via)`.
   - However, it did not check whether `path.via` was unknown, on a safety hold (`w.holds.has(path.via)`), paused (`mv.m.state === "paused"`), or blocked by either participant (`w.blocked.has(pairKey(a, path.via)) || w.blocked.has(pairKey(b, path.via))`).
   - Consequently, candidates with invalid or blocked intermediaries were pushed into `found`, ranked, and took up candidate slots (`found.slice(0, w.cfg.maxPerIntent)`).
   - Only later during proposal filtering in `candidateReason` or `hardGate` were these candidates rejected with `"blocked"`, `"safety_hold"`, or `"state_paused"`, starving the seeker of legitimate alternative warm-path introductions.

## Fix

1. **In `packages/engine/src/retrieval.ts:twoHop`**:
   - Filter out intermediary `x` if unknown, on safety hold, paused, or blocked with `a`:
     ```ts
     const mx = w.get(x);
     if (!mx || w.holds.has(x) || mx.m.state === "paused" || w.blocked.has(pairKey(a, x))) continue;
     ```
   - Filter out candidate `b` if unknown, on safety hold, paused, blocked with `x`, or blocked with `a`:
     ```ts
     const mb = w.get(b);
     if (!mb || w.holds.has(b) || mb.m.state === "paused") continue;
     if (w.blocked.has(pairKey(x, b)) || w.blocked.has(pairKey(a, b))) continue;
     ```
   - This ensures `twoHop` chooses the strongest **valid, unblocked** intermediary (such as `x2` above) instead of poisoned paths.

2. **In `packages/engine/src/packs/network/generators.ts:warmPath`**:
   - Pre-filter `path.via` before candidate ranking:
     ```ts
     const mv = w.get(path.via);
     if (!mv || w.holds.has(path.via) || mv.m.state === "paused") continue;
     if (w.blocked.has(pairKey(a, path.via)) || w.blocked.has(pairKey(b, path.via))) continue;
     ```
   - Prevents invalid candidates from displacing valid warm path candidates from `found.slice(0, w.cfg.maxPerIntent)`.

## Verification

1. **Unit tests (`packages/network/test/warm-path-blocked-via-safety.test.ts`)**:
   - `twoHop excludes intermediary blocked with seeker`: PASS
   - `twoHop excludes candidate blocked with intermediary`: PASS
   - `twoHop excludes candidate directly blocked with seeker`: PASS
   - `twoHop chooses unblocked alternative intermediary when higher strength intermediary is blocked`: PASS
   - `twoHop excludes intermediary or candidate on safety hold or paused`: PASS
   - `warmPath generator excludes blocked intermediary and proposes valid candidate`: PASS
   - `warmPath excludes intermediary on safety hold or paused state`: PASS
   - `warmPath excludes candidate when recipient blocked the intermediary`: PASS
   - Result: **8 pass, 0 fail (16 assertions)**.

2. **Typecheck**:
   - `bun run typecheck`: **PASSED (0 errors)**.

3. **Simulation Gates**:
   - `bun run sim --only network,friends,evals`: All blocking gates PASS.
