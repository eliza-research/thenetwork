# Friends planner alternate deduplication across plan types

## Problem and root cause

In `@network/engine` (`packages/engine/src/packs/friends/planner.ts`), the weekly planner (`planFriendsWeek`) schedules meetups across five distinct plan types:
1. `out.sessions`: ongoing crew sessions (`crew_session`);
2. `out.offers`: initial sessions offered with new crews (`crew_offer`);
3. `out.repeats`: same-table meetups for pairs/groups from previous weeks (`repeat`);
4. `out.plans`: newly formed activity/universal tables and single-slot plans (`new`);
5. `out.partners`: 1-on-1 activity partner pairings (`partner`).

Per design invariant documented at `packages/engine/src/packs/friends/planner.ts:477`:
`// Alternates are never invited elsewhere this run.`
Alternates must never be members who have already been invited to any plan during the run.

However, the previous implementation only filtered alternates within `out.plans` against `out.plans`:
```typescript
for (const p of out.plans) p.alternates = p.alternates.filter(id => !p.invited.includes(id) && !out.plans.some(q => q !== p && q.invited.includes(id)));
```

This suffered from three distinct defects:
1. **Omission of other plan types**:
   Members already invited to a crew session (`out.sessions`), an initial crew offer (`out.offers`), a repeat meetup (`out.repeats`), or a partner intro (`out.partners`) were still retained as alternates in `out.plans`. If backfilled, they faced schedule collisions or exceeded attention limits.
2. **Unfiltered `out.repeats` alternates**:
   Alternates on `out.repeats` (populated at line 298: `alternates: o.attended.filter(...)`) were never filtered against invited lists or other plans.
3. **Alternate collisions across plans**:
   The check `!out.plans.some(q => q !== p && q.invited.includes(id))` only verified that an alternate was not *invited* in another plan. It did not prevent the same member from being simultaneously designated as an alternate on multiple distinct plans (`q.alternates.includes(id)`).

## Fix

In `packages/engine/src/packs/friends/planner.ts`:
1. Aggregate all invited members across all five plan categories:
   ```typescript
   const allInvited = new Set<MemberId>([
     ...out.sessions.flatMap(p => p.invited),
     ...out.offers.flatMap(o => o.first.invited),
     ...out.repeats.flatMap(p => p.invited),
     ...out.plans.flatMap(p => p.invited),
     ...out.partners.flatMap(p => p.invited),
   ]);
   ```
2. Deduplicate alternates across both `out.repeats` and `out.plans`, ensuring each alternate is neither invited elsewhere nor assigned to more than one plan:
   ```typescript
   const seenAlternates = new Set<MemberId>();
   for (const p of [...out.repeats, ...out.plans]) {
     p.alternates = p.alternates.filter(id => !allInvited.has(id) && !seenAlternates.has(id));
     for (const id of p.alternates) seenAlternates.add(id);
   }
   ```
3. Added simulation assertion in `scripts/sim/friends.ts` verifying that across all seeds and weekly plans, no alternate appears in any plan's invited list or is duplicated across plans.
4. Added dedicated unit test suite in `packages/network/test/friends-planner-alternates.test.ts`.

## Verification

```sh
bun test packages/network/test/friends-planner-alternates.test.ts
bun run sim --only friends --quick
bun run typecheck
```

Results:
- `packages/network/test/friends-planner-alternates.test.ts`: 2 pass, 0 fail, 62 assertions (2.7s).
- `bun run sim --only friends --quick`: 12/12 blocking gates pass (9.6s).
- `bun run typecheck`: exit 0.

Deterministic engine logic. Zero model calls. No UI or copy files changed.
