# Local Encounters and Plans Buddy Pair Constraints & Meet Token Cleanup

## Summary
- **Local encounters second encounter generator (`packages/network/src/network.ts:localEncounters`)**:
  - Previously, `second_encounter` only checked whether `[a, b]` existed in `this.again` and met basic individual availability criteria (`a.active && b.active && ...`). It failed to check `this.blocked(a, b)`, `this.avoid.has(pairKey(a, b))`, `this.pairHistory(a, b, 60)`, first name collision, or maximum transit travel time (`mins <= 45`).
  - Now, `second_encounter` enforces full pair-level safety and history constraints before proposing a repeat meetup: `!this.blocked(a, b)`, `!this.avoid.has(pairKey(a, b))`, `!this.pairHistory(a, b, 60)`, distinct first names (`ma.first.toLowerCase() !== mb.first.toLowerCase()`), and transit limit (`mins <= 45`).
- **Local encounters newcomer welcome generator (`packages/network/src/network.ts:localEncounters`)**:
  - Previously, `newcomer_welcome` selected any nearby active member `m` for newcomer `x` without checking mutual blocks (`this.blocked(m.id, x.id)`), avoid edges (`this.avoid.has(pairKey(m.id, x.id))`), pair history (`this.pairHistory(m.id, x.id, 60)`), first name collisions, or whether `x.invitedBy === m.id` (inviters should not be matched as welcoming strangers).
  - Now, `newcomer_welcome` strictly validates `!this.blocked(m.id, x.id)`, `!this.avoid.has(pairKey(m.id, x.id))`, `!this.pairHistory(m.id, x.id, 60)`, `x.first.toLowerCase() !== m.first.toLowerCase()`, and `x.invitedBy !== m.id`.
- **Plans buddy generator (`packages/network/src/network.ts:onPlans`)**:
  - Previously, `onPlans` matched plan buddy candidates checking only individual matchability and `!this.blocked(m.id, r.memberId)`. It omitted `this.avoid.has(pairKey(m.id, r.memberId))`, `this.pairHistory(m.id, r.memberId, 60)`, and first name collision checks.
  - Now, `onPlans` filters candidates with `!this.avoid.has(pairKey(m.id, r.memberId))`, `!this.pairHistory(m.id, r.memberId, 60)`, and `this.member(r.memberId).first.toLowerCase() !== m.first.toLowerCase()`.
- **Stale meet token invalidation (`packages/network/src/network.ts`)**:
  - When a block or avoid relationship is registered (via `blockOrReport`, post-date checkin safety reports, or negative feedback), stale tokens in `this.again` and `this.planAgain` are immediately purged (`this.again.delete(k)` and `this.planAgain.delete(k)`), preventing stale mutual interest flags from circumventing blocks or avoid edges in subsequent cycles.
- **Natural language intent classification (`packages/network/src/classify.ts:planAgainOf`)**:
  - Expanded `planAgainOf` to accurately parse common affirmations ("i'd love to", "would love to", "love that", "loved it", "had a blast", "sure thing", "sure", "totally", "of course", "100%", "💯", "sign me up", "i'm down", "im down", "down to", "anytime", "let's do it") and refusals ("pass", "hard pass", "i'll pass", "rather not", "i'd rather not", "not for me", "not my thing", "don't think so", "i don't think so", "no thanks", "decline").

## Rationale & Impact
- Under PRD 32.14, AGENTS.md, and conformance invariant "blocks win (a blocked pair is never proposed together, never warm, never a via)", blocked pairs must never be proposed together under any generator or encounter type.
- Members with negative feedback (`this.avoid`) or recent meeting history (within 60 days) must not be matched again in local encounters (`second_encounter`, `newcomer_welcome`) or plan buddies.
- First-name collisions compromise reveal privacy and create confusion prior to mutual reveals.
- Purging `this.again` and `this.planAgain` upon block or report prevents stale state from re-triggering proposals between alienated members.

## Test & Verification
- Unit tests in `packages/network/test/local-encounters-plans-pair-constraints.test.ts`:
  - `second_encounter rejects pairs that have mutual blocks, avoid entries, or recent history`
  - `second_encounter rejects pairs with first name collision`
  - `newcomer_welcome rejects candidates with blocks, avoid edges, or recent history`
  - `newcomer_welcome rejects candidates with first name collision or who invited the newcomer`
  - `onPlans plans_buddy rejects candidates with avoid edges, recent history, or first name collisions`
  - `blockOrReport purges stale again and planAgain records`
  - `negative feedback purges stale again and planAgain records`
  - `planAgainOf parses natural affirmation and refusal phrases`
  - Result: 8 pass, 0 fail (101ms).
- Sim full suite: `bun run sim` (all blocking gates pass across onboard, network, slop, relay, peon, peon-seats, friends).
- Typecheck: `bun run typecheck` (0 errors).

## Slop Contribution Receipt
```json
{
  "provider": "google",
  "model": "gemini-2.5-pro",
  "client": "antigravity"
}
```
