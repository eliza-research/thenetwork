# Pair Constraints and Avoid Enforcement in Plans, Crews, and Organizing Reach

## Summary
- **Organizing Reach candidate selection & alternate filtering (`packages/network/src/network.ts:withReach`)**:
  - Previously, `withReach` selected extra low-exposure candidates using `.slice(0, extra)` after checking candidates against the existing `invited` list only. If multiple added candidates had a mutual block or avoid relationship (`this.blocked(a, b)` or `this.avoid.has(pairKey(a, b))`), both were added together to the plan.
  - Furthermore, candidate selection did not check `!plan.alternates.includes(m.id)`, and `plan.alternates` was left unfiltered against newly added reach seats, allowing blocked or avoided pairs to enter the roster upon backfill.
  - Now, `withReach` excludes members already listed in `plan.alternates`, validates pairwise unblocked/unavoided status across all added members, and filters returned alternates to remove any that conflict with the newly added members or are promoted to invited.
- **Snapshot avoid edge awareness (`packages/network/src/network.ts:avoided`)**:
  - Added helper `this.avoided(a, b)` and cached index `snapshotAvoid()` over snapshot edges `{ type: "avoid" }`.
  - Avoid checks across `approvalCheck`, `crewSessions`, and `withReach` now verify both in-memory `this.avoid` and snapshot avoid edges, ensuring avoidance constraints persist across restarts.
- **Crew sessions scheduling (`packages/network/src/network.ts:crewSessions`)**:
  - `crewSessions` ensures only mutually unblocked and un-avoided members are included in the session plan, prioritizing host retention from `crew.hostRotation`.
- **Review approval gate (`packages/network/src/network.ts:approvalCheck`)**:
  - `approvalCheck` validates both blocked pairs (`blocked_pair`) and avoid pairs (`pair_history`) across all opportunity origins using `this.blocked` and `this.avoided`.
- **Friends pack crew formation (`packages/engine/src/packs/friends/planner.ts`)**:
  - Enforces mutual unblocked status and `w.canMeet([x, id])` compatibility on active crew members before session offer creation.

## Rationale & Impact
- Under PRD 32.14, AGENTS.md, and conformance invariant "blocks win (a blocked pair is never proposed together, never warm, never a via)", blocked pairs must never be placed in the same opportunity or meeting.
- Members who left negative feedback about one another (`this.avoid` or snapshot avoid edges) must never be paired in repeat sessions or organizing reach expansions (including backfill alternates).

## Test & Verification
- Unit tests in `packages/network/test/plans-crew-reach-pair-constraints.test.ts` (5 pass, 0 fail, 13 expect assertions):
  - `crewSessions filters out blocked and avoided members so no blocked pair is invited together`
  - `withReach does not add mutually blocked or avoided candidates together`
  - `approvalCheck invalidates planner opportunities containing an avoid pair`
  - `withReach filters alternates conflicting with newly added reach members and excludes alternates from candidates`
  - `snapshot avoid edges are enforced in approvalCheck and avoided helper`
- Simulation suites: `bun run sim --only network,friends,evals`.
- Typecheck: `bun run typecheck` (0 errors across all 4 tsconfigs).

## Slop Contribution Receipt
```json
{
  "provider": "google",
  "model": "gemini-2.5-pro",
  "client": "antigravity"
}
```
