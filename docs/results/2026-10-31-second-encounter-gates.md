# Second encounter pair and event gating — 31 October 2026

The `secondEncounter` generator (`packages/engine/src/packs/network/generators.ts`) creates follow-up opportunities for pairs with completed meetings and mutual positive feedback.

Previously, `secondEncounter` suffered from two critical gating and alignment defects:
1. **Missing pairReason and canMeet checks**:
   Unlike all other generators (`intentToCapability`, `complementaryIntents`, `romanceIntros`, `warmPath`, `sharedIntentPooling`), `secondEncounter` never checked `w.canMeet([a, b])` or `pairReason(w, a, b, category)`.
   If a member blocked the counterpart after the meeting, or if one member moved away resulting in no presence overlap, or if an active proposal already existed, `secondEncounter` still proposed the pair again.
2. **Premature category and format gating before event similarity threshold**:
   When an event was found within the window (`bestEv`), `category` and `format` were set according to `bestEv` even when its similarity `bs` fell below `minSim * 0.8`.
   Consequently:
   - `memberReason` checked the member against `format: "event"` and `bestEv.category`. Members opting in only to `"one_to_one"` or subject to `reliability_holdout` were wrongly dropped despite the candidate falling back to `one_to_one`.
   - When the pair passed, the candidate was assigned `format: "one_to_one"` but retained `bestEv.category` (e.g. `hobby`, `growth`) instead of `social`.

## Fix

In `packages/engine/src/packs/network/generators.ts`:
- Determine `useEvent = Boolean(bestEv && bs >= w.cfg.retrieval.minSim * 0.8)`.
- Derive `category = useEvent ? (bestEv!.category ?? "social") : "social"` and `format = useEvent ? "event" : "one_to_one"`.
- Enforce `if (!w.canMeet([a, b]) || pairReason(w, a, b, category)) continue;` before creating proposals.
- Pass the actual candidate `format` and `category` to `memberReason`.

## Verification

- `bun test packages/network/test/second-encounter-gates.test.ts` (4 pass, 0 fail, 12 assertions).
- `bun run sim --only network --quick` (47/47 blocking gates pass).
- `bun run typecheck` (tsc pass).
