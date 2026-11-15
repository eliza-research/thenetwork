# Friends planner: enforce pair blocked constraints on repeat alternates and backfill

## Problem and root cause

In `@network/engine` (`packages/engine/src/packs/friends/planner.ts`), the weekly planner (`planFriendsWeek`) schedules "same table again" repeat meetups (`out.repeats`) for participants of previous successful plans who rated the experience positively.

While the primary invited roster checks pairwise blocks at line 293:
```typescript
const ids = pos.slice(0, 6).sort();
if (ids.some((x, i) => ids.slice(i + 1).some(y => w.blocked.has(x < y ? `${x}|${y}` : `${y}|${x}`)))) continue;
```
alternates were populated at line 303 directly from previous attendees (`o.attended`) without checking if any alternate was blocked by, or had blocked, any of the primary invitees:
```typescript
alternates: o.attended.filter(id => !ids.includes(id) && eligible(id) && !taken.has(id)).slice(0, partner ? 0 : 2)
```

Furthermore, in the `finish()` plan completion helper (line 215), when invited members are dropped due to transit tolerance (`!fits(id)`), the seat backfill loop unconditionally shifted candidates from `alternates` into `invited`:
```typescript
while (!p.partner && invited.length < p.invited.length && alternates.length) invited.push(alternates.shift()!);
```

This caused two critical safety violations:
1. **Blocked members assigned as alternates on repeat plans**:
   A member who attended a prior meetup with another member and subsequently blocked them (or was blocked by them) could be selected as an alternate for that exact member's repeat meetup.
2. **Blocked members promoted to invited via seat backfill**:
   When an invited member failed transit tolerance, `finish()` immediately backfilled the seat with the blocked alternate, directly pairing a member with someone who had blocked them or whom they had blocked.

## Fix

1. **Helper Definition**:
   Defined `isPairBlocked = (a: MemberId, b: MemberId) => w.blocked.has(a < b ? `${a}|${b}` : `${b}|${a}`):` within `planFriendsWeek`.

2. **Repeat Alternates Gate**:
   When constructing `alternates` for `out.repeats`, filter candidates to ensure they are not blocked with any primary invitee in `ids` and are not mutually blocked with any previously selected alternate in `altPool`:
   ```typescript
   const altPool: MemberId[] = [];
   if (!partner) {
     for (const id of o.attended) {
       if (ids.includes(id) || !eligible(id) || taken.has(id)) continue;
       if (ids.some(x => isPairBlocked(id, x)) || altPool.some(x => isPairBlocked(id, x))) continue;
       altPool.push(id);
       if (altPool.length >= 2) break;
     }
   }
   ```

3. **Finish Backfill Gate and Alternates Cleanup**:
   In `finish()`, guard the alternate promotion so that a candidate is only added to `invited` if they are not blocked by any current member of `invited`:
   ```typescript
   while (!p.partner && invited.length < p.invited.length && alternates.length) {
     const cand = alternates.shift()!;
     if (!invited.some(x => isPairBlocked(cand, x))) invited.push(cand);
   }
   alternates = alternates.filter(alt => !invited.some(x => isPairBlocked(alt, x)));
   ```

4. **Simulation Conformance and Unit Tests**:
   - Added a conformance rule in `scripts/sim/friends.ts` asserting that across all plans (sessions, offers, repeats, plans, partners) and all simulation seeds, no pair in `invited` is blocked, and no member in `alternates` is blocked with any member in `invited`.
   - Added dedicated unit tests in `packages/network/test/friends-repeat-blocked-alternates.test.ts` covering repeat alternate filtering, seat-drop backfill blocking gates, and full world simulation invariant verification.

## Verification

```sh
bun test packages/network/test/friends-repeat-blocked-alternates.test.ts
bun run sim --only friends --quick
bun run typecheck
```

Results:
- `packages/network/test/friends-repeat-blocked-alternates.test.ts`: 3 pass, 0 fail, 383 assertions (3.8s).
- `bun run sim --only friends --quick`: 13/13 blocking gates pass (9.9s).
- `bun run typecheck`: exit 0.

Deterministic engine logic. Zero model calls. No UI or copy files changed.
