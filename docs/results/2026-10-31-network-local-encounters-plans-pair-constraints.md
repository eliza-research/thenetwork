# Local Encounters and Plans Buddy Pair Constraints & Meet Token Cleanup

## Summary
- **Local encounters second encounter generator (`packages/network/src/network.ts:localEncounters`)**:
  - Previously, `second_encounter` only checked whether `[a, b]` existed in `this.again` and met basic individual availability criteria (`a.active && b.active && ...`). It failed to check `this.blocked(a, b)`, `this.avoid.has(pairKey(a, b))`, first name collision, or maximum transit travel time (`mins <= 45`).
  - Furthermore, using `this.pairHistory(a, b, 60)` erroneously purged 100% of genuine repeat pairs because `pairHistory` checked `this.metRecently(a, b, 60)` which was always true right after a completed meeting.
  - Now, `second_encounter` enforces full pair safety without purging genuine pairs: `!this.blocked(a, b)`, `!this.avoid.has(pairKey(a, b))`, `(this.declined.get(pairKey(a, b)) ?? -Infinity) <= now - 60 * DAY`, checking that no active unclosed opportunity already exists between them, distinct first names (`ma.first.toLowerCase() !== mb.first.toLowerCase()`), and transit limit (`mins <= 45`).
- **Local encounters newcomer welcome generator (`packages/network/src/network.ts:localEncounters`)**:
  - Previously, `newcomer_welcome` selected any nearby active member `m` for newcomer `x` without checking mutual blocks (`this.blocked(m.id, x.id)`), avoid edges (`this.avoid.has(pairKey(m.id, x.id))`), pair history (`this.pairHistory(m.id, x.id, 60)`), first name collisions, or whether `x.invitedBy === m.id` (inviters should not be matched as welcoming strangers).
  - Now, `newcomer_welcome` strictly validates `!this.blocked(m.id, x.id)`, `!this.avoid.has(pairKey(m.id, x.id))`, `!this.pairHistory(m.id, x.id, 60)`, `x.first.toLowerCase() !== m.first.toLowerCase()`, and `x.invitedBy !== m.id`.
- **Plans buddy generator (`packages/network/src/network.ts:onPlans`)**:
  - Previously, `onPlans` matched plan buddy candidates checking only individual matchability and `!this.blocked(m.id, r.memberId)`. It omitted `this.avoid.has(pairKey(m.id, r.memberId))`, `this.pairHistory(m.id, r.memberId, 60)`, and first name collision checks.
  - Now, `onPlans` filters candidates with `!this.avoid.has(pairKey(m.id, r.memberId))`, `!this.pairHistory(m.id, r.memberId, 60)`, and `this.member(r.memberId).first.toLowerCase() !== m.first.toLowerCase()`.
- **Stale meet token invalidation (`packages/network/src/network.ts`)**:
  - When a block or avoid relationship is registered (via `blockOrReport`, post-date checkin safety reports, or negative feedback), stale tokens in `this.again` and `this.planAgain` are immediately purged (`this.again.delete(k)` and `this.planAgain.delete(k)`), preventing stale mutual interest flags from circumventing blocks or avoid edges in subsequent cycles.
- **Natural language intent classification (`packages/network/src/classify.ts:planAgainOf`)**:
  - Expanded `planAgainOf` to accurately parse common affirmations and refusals with strict negation guards (`not sure`, `unsure`, `not down`, `felt let down`, `didn't love that`) so that hedged and negative feedback is never misclassified as `"yes"`.

## Rationale & Impact
- Under PRD 32.14, AGENTS.md, and conformance invariant "blocks win (a blocked pair is never proposed together, never warm, never a via)", blocked pairs must never be proposed together under any generator or encounter type.
- Members with negative feedback (`this.avoid`) or recent declines (within 60 days) must not be matched again in local encounters (`second_encounter`, `newcomer_welcome`) or plan buddies.
- First-name collisions compromise reveal privacy and create confusion prior to mutual reveals.
- Purging `this.again` and `this.planAgain` upon block or report prevents stale state from re-triggering proposals between alienated members.

## Test & Verification
- Unit tests in `packages/network/test/local-encounters-plans-pair-constraints.test.ts`:
  - `planAgainOf > recognizes natural positive affirmations`
  - `planAgainOf > recognizes polite and colloquial refusals`
  - `planAgainOf > keeps attendance statements as unclear`
  - `planAgainOf > rejects negated or hedged affirmative words without false positives`
  - `stale again and planAgain invalidation on block and avoid > clears again and planAgain when a block is recorded`
  - `stale again and planAgain invalidation on block and avoid > clears again and planAgain when avoid is recorded via negative feedback`
  - `plans buddy pair constraints > does not pair members who have an avoid edge, recent decline, or identical first name`
  - `localEncounters constraints > does not create second_encounter if members block each other, avoid each other, or share first name`
  - `localEncounters constraints > does not select newcomer_welcome host who is blocked, avoided, shares first name, or was invited by newcomer`
  - `localEncounters constraints > allows second_encounter for genuine recent meetups when both say again, while checking decline and open opps`
  - Result: 10 pass, 0 fail (48 expect() calls).
- Sim full suite: `bun run sim --only network,friends,evals`.
- Typecheck: `bun run typecheck` (0 errors).

## Slop Contribution Receipt
```json
{
  "provider": "google",
  "model": "gemini-2.5-pro",
  "client": "antigravity"
}
```
