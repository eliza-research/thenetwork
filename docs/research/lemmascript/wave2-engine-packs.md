# LemmaScript wave 2: engine-packs

Hand-written, 2026-11-07. lsc 0.6.6, Dafny 4.11. No model calls and no sends. All numbers below come from commands run in this session.

## Result

`packages/engine/src/packs/decisions.ts` is one import-free module with 24 proved decisions. `lsc check`: 40 verified, 0 errors. It is in LemmaScript-files.txt. Every function has a shipping caller, and the old inline logic is gone. Trust counts for this file: assume 0, havoc 0, extern 0, axiom 0.

## Functions proved

| Function | Production call site | What the proof says | Mutation (lsc result) |
|---|---|---|---|
| `romanceItemAllowed` | slop/index.ts and network/index.ts `itemGate` (one function for both) | allowed implies adult; no list is never allowed; else exactly adult and lane in the list | missing list returns `adult`: 1 error |
| `photosRatable` | slop/appearance.ts `canRatePhotos` | exactly adult and age not known unverified | drop the age check: 1 error |
| `photoPasses` | slop/clef.ts `rate`, clef-fit/fit.ts | a missing answer never passes | missing passes: 1 error |
| `probePhotoIds` | slop/plan.ts `probePhotoRefs` | at most `PROBE_PHOTO_MAX`; a photo implies both adults, consent, no hold | drop the hold check: 1 error |
| `slopProbeMessage` | re-exported by slop/copy.ts | at most 1 photo; empty list leaves the text unchanged | `slice(0, 2)`: 1 error |
| `confirmedAfter` | slop/onboard.ts `applyCorrection` | exactly yes, no change, not minor, not declined | ignore `yes`: 1 error |
| `matchableOf` | slop/extract.ts `finalize` | exactly not minor, not declined, adult, all hard fields, confirmed | drop `adult`: 1 error |
| `minorOf` | slop/extract.ts `finalize` | sticky; under the adult age sets it; nothing else sets it | not sticky: 2 errors |
| `lowerAge` | slop/extract.ts `mergeReading`, `mergeLlm` | a reading replaces the age only when lower | `<=`: 1 error |
| `firstQuestion` | slop/onboard.ts `nextQuestion` | blocked gives none; the result is needed and under the cap; every earlier entry is not askable; none means none is askable | `<=` on the cap: 1 error |
| `reviewReason` | moved from slop/rules.ts, re-exported there | confirmed always holds; failed check holds unless cleared; required but unverified holds even when cleared; safety cue holds unless cleared | cleared skips unverified: 1 error |
| `greedyPick` | slop/assign.ts `greedyRound` | indices in range; no member twice in a round | do not mark `e.b`: 1 error |
| `mutualSeek` | slop/rules.ts, judge.ts (2), index.ts (4 copies removed) | symmetric; unknown gender never matches | drop one side: 1 error |
| `agesMutual` | slop/rules.ts `age_range` | symmetric; names all four bounds | drop one bound: 1 error |
| `reprobeReason` | slop/rules.ts `already_introduced` | met or any revealed record always blocks; zero cooldown blocks any record | drop `!preReveal`: 1 error |
| `dealbreakerHit` | slop/score.ts `statedDealbreaker` | an unknown value is never a hit, for all 9 dealbreakers | smoker unknown gives false: 1 error |
| `isAlert` | slop/biasMonitor.ts | exactly `n >= minN` and ratio under threshold | drop `n`: 1 error |
| `quintileOf` | slop/biasMonitor.ts | 1 to 5 | `6 * i`: 1 error |
| `seatLeft` | peon/seats.ts `peonSeatCapacity` | never negative, at most posted, left plus filled covers posted | no floor: 1 error |
| `slateCapOf` | peon/selection.ts `slateCap` | at most the seat cap, the probation cap and the base | ignore probation: 1 error |
| `workAuthAllowed` | peon/rules.ts `workAuthOk` | not refused; sponsorship offered if needed | drop the sponsor check: 1 error |
| `placeAllowed` | peon/rules.ts `locationOk` | mode known and wanted; same market unless remote | drop the market: 1 error |
| `groupSizeOk` | friends/rules.ts `group_size` | group 3 to 6; intro exactly 2 | cap 7: 1 error |
| `beyondTolerance` | friends/index.ts `pairReason` | symmetric | `ta + ta`: 1 error |

24 of 24 mutations gave an lsc error. Each ran on a copy, so the shipping file was never changed. Script: `scratchpad/ep/mut.py`, log `scratchpad/ep/mut.log`.

## What the proofs do not cover

- `adult`, `minor`, `changed`, `yes` and every other boolean input are trusted. `adult` is `canBeMatched(age)` at each call site, read by eye and by the sims. A cross-file call to core `canBeMatched` would emit `{:axiom}` and would grow the trust count, so these stay booleans.
- `hasField`, `order` in `nextQuestion`, and the regex readers are not proved. `firstQuestion` proves only what it does with the table it gets.
- `probePhotoIds` gets ids already filtered by `isOpaquePhotoId` (a regex). Opacity rests on that one call in `probePhotoRefs`.
- `seatLeft`, `quintileOf` and `greedyPick` assume ideal numbers. NaN and rounding are out. `quintileOf` has a `requires` that TypeScript does not check; the only caller passes `i` from a map over the same list.
- `stableRound` (used when `o.assignment === "stable"`) is not proved. The "each member once" proof covers `greedyRound` only.

## Defects fixed

Each was seen failing first, with the case below, before the fix.

| Defect | Fix | Case | Before | After |
|---|---|---|---|---|
| 10, onboard.ts:93 | Local words match only as the whole message (trailing "thanks" allowed); `confirmedAfter` decides | 13 rows in evals/slop-onboarding/corrections.jsonl | `FAIL corrections and confirmations: 91.5%`, confirmed on "right now i'm not sure about that" and 4 more | PASS (see the residual below) |
| 11, clef.ts:96,220 and fit.ts:366 | `clefFeatureRow` keeps a missing `gate.*` answer absent; `photoPasses` drops the row | gate in scripts/sim/clef.ts | `FAIL clef gate`: rated, overall 0.618 | PASS |
| extract.ts:1069 | LLM age under 13 marks a minor; the `declined` rule stays strict | gate in scripts/sim/onboard.ts | `FAIL ... an LLM age under 13 must mark a minor` | PASS |
| slop/index.ts:153 | Missing opt-in list is no consent | gate in scripts/sim/slop.ts | `FAIL ... expected null to be "romance_not_allowed"` | PASS |
| peon/seats.ts:65 | `canBeMatched(owner.age)` | gate in scripts/sim/peon-seats.ts | `FAIL age: ... expected 1 to be 0` | PASS |
| appearance.ts:178 (bug 6, low) | `plus[-_ ]size` | same gate in scripts/sim/slop.ts | not run alone: the gate stopped at the earlier opt-in line | PASS |

Residual for defect 10: "perfect would be someone else entirely" still confirms, because core `classifyYesNo` itself reads it as yes. That is packages/core/src/replies.ts, which I do not own (defect 12 family). The row stays in the corpus as a known miss; the gate passes at 98.3%.

Small changes beside the fixes, all stricter:
- `applyCorrection` passes `next.minor` and `next.declined`, not the state before the message. "yep, I'm a minor" no longer sets `confirmed`.
- `itemGate` uses `canBeMatched`: an age above 120 now fails. The hard-coded 18 is gone.
- A missing `gate.body_visible` answer now reads as not visible (was 0.5, which passed `>= 0.5`), so no body type is set from it.
- A seat for a non-integer adult age is now allowed (`canBeMatched` has no integer check). Age is an integer on every path I read.

## Skipped, with reasons

- `seatAllowed`: a function equal to `canBeMatched` proves nothing. The call site uses `canBeMatched` directly.
- `ageRangeOf`: `[lo, hi]` tuples model as sequences, and the file does not fit in place. Low value.
- `ratioOf`, `aggregate`, `harmonic`: the LS real-literal gap (engine-packs.md section 2).
- `distanceBand`: a literal with a leading digit emits invalid Dafny.
- `mutualMarkets` predicate, `planExtraction`, `romanceCompatible`: optional in the report, low value, and each needs a new wrapper around one comparison.
- In-place proof of `probePhotoRefs` and `canRatePhotos`: blocked because the cross-file calls emit `{:axiom}`.

## Changes outside packs/

Needed for the failing-first cases, in files no other area owns: scripts/sim/clef.ts, onboard.ts, peon-seats.ts, slop.ts and evals/slop-onboarding/corrections.jsonl (append only).

## Tests and sims

All with the heavy lock, one at a time, in the shared worktree after the fixes:

| Command | Result |
|---|---|
| `lsc check --backend=dafny packages/engine/src/packs/decisions.ts` | 40 verified, 0 errors |
| `bun run sim --only onboard` | PASS 19/19 (corrections 98.3%, n 61) |
| `bun run sim --only clef` | PASS 11/11 |
| `bun run sim --only peon` | PASS 27/27 |
| `bun run sim --only peon-seats` | PASS 10/10 |
| `bun run sim --only friends` | PASS 18/18 |
| `bun run sim --only relay` | PASS 60/60 |
| `bun run sim --only slop` | PASS 40/40, 8 tracked off target (the same as the baseline) |
| `bunx tsc --noEmit -p .` | no errors in packs/ or in the sim files I changed (errors remain in other areas' files) |
| integration: peon-seats, slop-date-path, shared-relay, cost (packages/network/test), photos (packages/platform/test) | 1, 3, 10, 2, 17 pass; 0 fail |

During one run the shared slop block failed 3 gates that came from other areas' in-flight files (engine selectionGuard.ts, sim judge/metrics.ts). To isolate my change, I ran the slop block on a clean HEAD copy plus only my files: 40/40. Its output differs from the pre-fix baseline only in the fixed gate, so the digests and tracked values are the same. A later run in the shared tree passed 40/40.

Trust counts (decisions.ts): assume 0, havoc 0, extern 0, axiom 0.
