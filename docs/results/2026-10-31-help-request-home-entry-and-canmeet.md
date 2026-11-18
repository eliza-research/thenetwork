# Enforce Home Entry Safety (F14), Presence Overlap, and Format Gates in Help Request Generator

## Summary
- **Home Entry Physical Safety Rule (F14) (`packages/engine/src/packs/network/generators.ts:helpRequest`)**:
  - Under Section 33.1, PRD F14, and `rules.ts:home_entry_rule`, help requests involving entry into private homes ("moving furniture", "apartment", "boxes", "plumbing") require either 2+ helpers or that every helper has previously met the requester (`acquainted`). Sending a lone stranger to a member's private home is strictly prohibited.
  - Previously, `helpRequest` only checked `if (home && need === 1 && !ranked[0]?.acquainted) need = 2;`. If `ranked[0]` was acquainted with the seeker, `need` remained 1. When generating alternative helper-set variants (`v = 1` or `v = 2`), if `ranked.slice(v)` started with an unacquainted helper, `need` was still 1, proposing a lone stranger to enter the requester's home alone.
  - Now, for home-entry tasks (`home === true`), `targetNeed` is evaluated per variant: if the starting helper is not acquainted, `targetNeed` is enforced to at least 2 (`Math.max(need, 2)`). Furthermore, an explicit safety gate rejects any proposed home-entry candidate that has fewer than 2 helpers unless every helper is acquainted. If no acquainted helper exists and fewer than 2 helpers are available in the pool, no candidate is created and the intent is marked as unmatched, preventing lone strangers from being dispatched into private residences.
- **Mutual Presence Overlap (`w.canMeet`) Across Helpers (`packages/engine/src/packs/network/generators.ts:helpRequest`)**:
  - When assembling multi-helper requests (`need >= 2`), `helpRequest` previously checked pairwise compatibility `pairReason(w, h.id, r.id, "help")`, but never verified mutual availability overlap among all helpers and the seeker: `w.canMeet([a, ...helpers.map(h => h.id), r.id])`.
  - Helpers with non-overlapping availability (e.g., Helper 1 in SF Monday-Wednesday, Helper 2 in SF Friday-Sunday) were combined into the same candidate, resulting in candidates that failed the downstream core geo gate (`w.overlap` returning `no_presence_overlap`) and starving the seeker of assistance.
  - Now, `helpRequest` checks `if (!w.canMeet([a, ...helpers.map(h => h.id), r.id])) continue;`, ensuring all co-helpers and the seeker share valid overlapping availability before forming the candidate.
- **Format Eligibility & Reliability Holdout Gates (`packages/engine/src/packs/network/generators.ts:helpRequest`)**:
  - When `targetNeed > 1`, the candidate is formed as `format: "small_group"`.
  - The generator now validates that the seeker and all selected helpers satisfy `memberReason` for `format: "small_group"`. Helpers with reliability holdouts (`noShows >= 2 && completedSinceLastNoShow === 0`) are excluded from multi-helper requests.
- **Alternates Presence Overlap and Solo Home Entry Safeguards (`packages/engine/src/packs/network/generators.ts:helpRequest`)**:
  - Alternates for `helpRequest` are now checked for mutual presence overlap with the seeker (`w.canMeet([a, r.id])`) and format eligibility (`format === "small_group"`).
  - For solo home-entry tasks, any alternate backfill candidate must also be acquainted with the seeker (`r.acquainted`), ensuring a backfill never converts an acquainted solo task into an unsafe lone-stranger home visit.

## Rationale & Impact
- Physical safety is non-negotiable under the Network charter (PRD Section 33.1 and 33.5). The F14 home-entry rule guarantees that members inviting assistance into their living quarters are never placed in a vulnerable position with an unvetted stranger alone.
- Filtering multi-helper candidates with `w.canMeet` prevents dead candidates with disjoint availability from consuming the generator's variant budget.
- Respecting format and reliability constraints ensures candidates adhere to participant preferences and trust guidelines.

## Test & Verification
- Dedicated unit test suite added in `packages/network/test/help-request-home-entry-canmeet.test.ts`:
  1. `home entry with unacquainted helpers enforces at least 2 helpers (F14 safety rule)`
  2. `home entry with only 1 stranger available fails safe without dispatching lone stranger`
  3. `home entry allows solo helper if acquainted, but variant with unacquainted helper recruits 2 helpers`
  4. `canMeet enforces mutual availability across all helpers and seeker`
  5. `reliability holdout: members with 2+ unrecovered no-shows are excluded from multi-helper requests`
  6. `alternates enforce presence overlap and solo home entry acquainted constraints`
  - Result: 6 pass, 0 fail (28 assertions).
- Typecheck: `bun run typecheck` (0 errors across all 4 packages).
- Simulation gates: `bun run sim --only network,friends,evals`.

## Slop Contribution Receipt
```json
{
  "provider": "google",
  "model": "gemini-2.5-pro",
  "client": "antigravity"
}
```
