# Expansion generator pair constraints enforcement — 31 October 2026

The `expansion` generator (`packages/engine/src/packs/network/generators.ts`) proposes 1-on-1 exploration opportunities across member clusters, matching a member's outside desire against providers from other clusters.

Previously, `expansion` filtered candidates only with:
```typescript
const pool = eligibleMembers(ctx, category, "provider", "one_to_one", false, new Set([a]))
  .filter(id => w.get(id)!.cluster !== ma.cluster && w.canMeet([a, id]));
```
Unlike other 1-on-1 generators (`intentToCapability`, `complementaryIntents`, `warmPath`, `secondEncounter`), `expansion` completely omitted `pairReason(w, a, id, category)`.
Consequently, pairs with hard pair-level violations were admitted into the pool and proposed:
- Blocked members (`w.blocked.has(pairKey(a, id))`).
- Members with dealbreaker constraints (`dealbreaker`).
- Active duplicate proposals (`active_duplicate`).
- Recent pair declines or cancellations under cooldown (`pair_cooldown`).
- Recent negative feedback under cooldown (`negative_feedback_cooldown`).

## Fix

In `packages/engine/src/packs/network/generators.ts`:
- Append `&& !pairReason(w, a, id, category)` to the pool filter in `expansion`.

## Verification

- `bun test packages/network/test/expansion-pair-gates.test.ts` (3 pass, 0 fail, 9 assertions).
- `bun run sim --only network --quick` (47/47 blocking gates pass).
- `bun run typecheck` (tsc pass).
