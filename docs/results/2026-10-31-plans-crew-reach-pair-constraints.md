# Pair Constraints and Avoid Enforcement in Plans, Crews, and Organizing Reach

## Summary
- **Organizing Reach candidate selection (`packages/network/src/network.ts:withReach`)**:
  - Previously, `withReach` selected extra low-exposure candidates using `.slice(0, extra)` after checking candidates against the existing `invited` list only. If multiple added candidates had a mutual block or avoid relationship (`this.blocked(a, b)` or `this.avoid.has(pairKey(a, b))`), both were added together to the plan.
  - Now, each candidate selected for `add` is verified against both `invited` and all previously added candidates in `add`: `add.every(x => !this.blocked(x, m.id) && !this.avoid.has(pairKey(x, m.id)))`.
- **Crew sessions scheduling (`packages/network/src/network.ts:crewSessions`)**:
  - Previously, `crewSessions` filtered active members solely on individual eligibility (`planSeatOk(m)`). If any crew members blocked each other or had recorded negative feedback avoidance (`this.avoid`), all of them were passed to `crewSessionPlan`, causing either whole-session review invalidation or scheduling of blocked/avoided members together.
  - Now, `crewSessions` ensures only mutually unblocked and un-avoided members are included in the session plan, prioritizing host retention from `crew.hostRotation`.
- **Review approval gate (`packages/network/src/network.ts:approvalCheck`)**:
  - `approvalCheck` now validates both blocked pairs (`blocked_pair`) and avoid pairs (`pair_history`) across all opportunity origins (including planner and crew plans), preventing any negative feedback pair from being approved or contacted.
- **Friends pack crew formation (`packages/engine/src/packs/friends/planner.ts`)**:
  - Enforces mutual unblocked status and `w.canMeet([x, id])` compatibility on active crew members before session offer creation.

## Rationale & Impact
- Under PRD 32.14, AGENTS.md, and conformance invariant "blocks win (a blocked pair is never proposed together, never warm, never a via)", blocked pairs must never be placed in the same opportunity or meeting.
- Furthermore, members who left negative feedback about one another (`this.avoid`) must never be paired in repeat sessions or organizing reach expansions. Enforcing pairwise mutual compatibility at candidate selection, crew scheduling, and review approval guarantees that safety and feedback constraints are never bypassed by group or crew planning flows.

## Test & Verification
- Unit tests added in `packages/network/test/plans-crew-reach-pair-constraints.test.ts` (3 pass, 0 fail, 7 expect assertions):
  - `crewSessions filters out blocked and avoided members so no blocked pair is invited together`
  - `withReach does not add mutually blocked or avoided candidates together`
  - `approvalCheck invalidates planner opportunities containing an avoid pair`
- Friends simulation: `bun run sim --only friends` (18/18 blocking gates pass, 104.7s).
- Evals simulation: `bun run sim --only evals` (25/25 blocking gates pass, 0.3s).
- Typecheck: `bun run typecheck` (0 errors).

## Slop Contribution Receipt
```json
{
  "provider": "google",
  "model": "gemini-2.5-pro",
  "client": "antigravity"
}
```
