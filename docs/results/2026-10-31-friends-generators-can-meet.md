# Friends Generators canMeet Availability and Participant Consistency Gates

## Summary
- Enforces availability and presence overlap (`w.canMeet`) in `packages/engine/src/packs/friends/generators.ts`:
  - In `sameTableAgain`: ensures the entire group / pair `parts = ok.slice(0, 6)` can actually meet (`w.canMeet(parts)`). Prevents proposing groups where an attendee has relocated, traveled, or lacks availability overlap in the opportunity window.
  - In `sameTableAgain`: ensures `participants`, `roles`, `evidence`, `benefit`, and deduplication keys `k` strictly reference `parts = ok.slice(0, 6)`, avoiding dictionary key leakage when group candidate size exceeds 6.
  - In `sameTableAgain`: re-verifies `memberReason(..., format: "one_to_one")` if filtering drops a candidate group to exactly 2 members, ensuring 1:1 hard filters (such as `group_first`) are strictly honored.
  - In `activityPartner`: enforces `w.canMeet([a, b])` before choosing the nearest activity partner by transit, avoiding wasteful ranking of pairs that cannot co-locate or meet.

## Test & Verification
- Unit test added: `packages/network/test/friends-generators-can-meet.test.ts` (3 tests pass, 0 fail, 13 expect assertions).
- Simulation gate: `bun run sim --only friends` (18/18 blocking gates pass).
- Typecheck: `bun run typecheck` (pass 100%).

## Slop Contribution Receipt
```json
{
  "provider": "google",
  "model": "gemini-2.5-pro",
  "client": "antigravity"
}
```
