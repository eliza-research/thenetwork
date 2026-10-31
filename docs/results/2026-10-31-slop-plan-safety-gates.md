# Slop Date Planning Safety Holds, Blocked Edges, and Minor Protection Gates

## Summary
- Enforces essential safety gates in `packages/engine/src/packs/slop/plan.ts`:
  - In `planFromInput`: verifies that the participant pair is not blocked in `input.edges` (`e.type === "blocked"` in either direction) and neither participant has an active safety hold in `input.safetyHolds` (`h.to === undefined || h.to > input.now`).
  - In `planFirstDate` & `planFromInput`: prevents self-dating (`first === partner` / `first.id === partner.id`).
  - In `planFirstDate`: rejects non-adults / minors (`!first.adult || !partner.adult || !canBeMatched(first.age) || !canBeMatched(partner.age)`), paused members (`first.paused || partner.paused`), and opted-out members (`!first.optedIn || !partner.optedIn`).

## Requirement & Rationale
Under PRD 32.10, 33, and 40.5, "blocks win" (a blocked pair is never proposed or planned together) and declared minors are never matched or booked for dates. Previously, `planFromInput` bypassed checks for active safety holds and blocked edges, and `planFirstDate` lacked self-date prevention, minor protection, and participation state checks.

## Test & Verification
- Unit test added: `packages/network/test/slop-plan-safety-gates.test.ts` (6 tests pass, 0 fail, 17 expect calls).
- Simulation gate: `bun run sim --only slop` (39/39 blocking gates pass).
- Typecheck: `bun run typecheck` (pass 100%).

## Slop Contribution Receipt
```json
{
  "provider": "google",
  "model": "gemini-2.5-pro",
  "client": "antigravity"
}
```
