# Plan Fallback Partner Consent, Avoid Seating Constraints, and Alternate Deduplication

## Summary
- **Plan fallback 1:1 partner consent (`packages/network/src/network.ts:planFallback`)**:
  - Previously, when a group plan (3+ members) failed quorum because only 2 members said yes, `plans.planFallback` returned `{ fallback: { kind: "smaller", members: yes, partnerPlan: ... } }`. In `network.ts`, line 3131 directly called `this.bookPlan(o, fallback.members, true)`, prematurely booking the pair as a meeting and revealing their identities.
  - This violated core consent invariants (`engine-attention-plans-10`): the members agreed to a group plan of several people, never to an unannounced 1-on-1 meetup with a stranger.
  - Now, when `fallback.partnerPlan` is returned, the original group plan `o` is closed with `"plan did not come together"`. The pair is checked for safety constraints: `!this.blocked(a, b)`, `!this.avoid.has(pairKey(a, b))`, and distinct first names. If safe, `fallback.partnerPlan` is submitted via `this.submitPlan`, enforcing sequential one-to-one probing and double opt-in consent before any booking or reveal can occur.
- **Seating avoid check and quorum enforcement in booking (`packages/network/src/network.ts:bookPlan`)**:
  - In `bookPlan`, seated members are now verified against `this.avoid`: `if (seated.some(s => this.avoid.has(pairKey(s, id)))) { this.refuse(id, "reveal", "pair_history"); o.status.set(id, "unavailable"); if (o.planRun) o.planRun.answers[id] = "no"; continue; }`. Members who recorded negative feedback about one another are never seated together.
  - When members are dropped due to scheduling conflicts (`bookedNear`), streak caps, or avoid edges, their `o.planRun.answers[id]` is synchronized to `"no"`, allowing subsequent `planFallback` to accurately derive remaining yes-sayers and route to `partnerPlan` if exactly two remain.
  - Quorum check is strictly enforced: `const enough = plan.partner ? keep.length >= 2 : keep.length >= plan.quorum;`. A group plan that dropped below quorum at booking time due to conflicts is not forced into an unauthorized 2-person booking, but correctly routes to `planFallback`.
- **Late join avoid enforcement (`packages/network/src/network.ts:planJoin`)**:
  - Late joins are now checked against `this.avoid` for all already-seated members (`seated.some(s => this.avoid.has(pairKey(s, id)))`), preventing avoided pairs from being seated together through late answers.
- **Deduplication of alternates across candidate plans (`packages/engine/src/plans.ts:planProposals`)**:
  - In `planProposals`, alternates are deduplicated across selected plans without starving candidate plans during the selection loop: `p.alternates = p.alternates.filter(id => !used.has(id) && !seenAlts.has(id))`.
- **Avoid enforcement in distinctAlternates (`packages/network/src/network.ts:distinctAlternates`)**:
  - Filters out potential alternates who have an avoid relationship (`this.avoid.has(pairKey(p, a))`) with any seated participant or other alternate.

## Rationale & Impact
- Under PRD 32.14, AGENTS.md, and `engine-attention-plans-10`: members who say yes to a group plan with "several others" must never be booked 1-on-1 without fresh 1:1 consent. Converting a 2-person group fallback into a structured activity partner plan ensures both members are asked individually whether they want a 1:1 meetup with someone before their identities are disclosed.
- Negative feedback avoid edges (`this.avoid`) represent explicit disinterest in meeting someone again; checking this during plan seating, late joins, and alternate backfills prevents alienated members from being seated together at the same venue.
- Deduplicating alternates across plans prevents the same member from being simultaneously queued for multiple plan backfills in the same run.

## Test & Verification
- Unit tests in `packages/network/test/plan-fallback-partner-consent.test.ts`:
  - `a group plan that falls back to 2 yes-sayers submits a partner plan instead of booking directly`
  - `planFallback does not submit partnerPlan if the 2 yes-sayers have an avoid or block relationship`
  - `bookPlan refuses seating members who have an avoid relationship`
  - `planProposals deduplicates alternates across candidate plans and excludes already invited members`
  - `distinctAlternates filters out alternates who have an avoid edge or recent history with participants`
  - `planJoin refuses late join if candidate has avoid edge with already seated member`
  - `bookPlan updates planRun answers on drop so fallback derives partnerPlan`
  - Result: 7 pass, 0 fail (18 assertions).
- Typecheck: `bun run typecheck` (0 errors across all 4 tsconfigs).
- Sim verification: `bun run sim --only network,friends,evals`.

## Slop Contribution Receipt
```json
{
  "provider": "google",
  "model": "gemini-2.5-pro",
  "client": "antigravity"
}
```
