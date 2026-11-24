# Deliver a gathering second encounter

## Story: Receive a reviewed second-encounter proposal safely

> As a member who opted into private gathering follow-up, I want a new connection to depend on current mutual choices, current safety checks and fresh consent.

### A probe or initial reveal must match the reviewed opportunity and current source

Apply the usual outbound checks. The stored message must belong to this exact opportunity and recipient. The approved pair (approved by the review judge, or by staff for an item that the judge held) must still have the exact mutual source that created the proposal. Check current membership, adulthood, consent and blocks for both people. Serialize claim against source edits and authorize signed collected replies against the same source. Keep the identity and initial booking details private until both people answer the new opportunity. After booking, ordinary logistics use the ordinary booking rules. Changed (owner decision 2026-11-22, D15 to D17): only a named staff member approved the pair; now the review judge or, for an exception, staff approve it.

```quint
pure def gatheringRepeatContactAllowed(matchingOn: bool, exactPair: bool, approved: bool,
    expectedLifecycle: bool, exactMessage: bool, sourceCurrent: bool): bool =
  matchingOn and exactPair and approved and expectedLifecycle and exactMessage and sourceCurrent

pure def lawGatheringRepeatContactNeedsReview(matchingOn: bool, exactPair: bool, expectedLifecycle: bool,
    exactMessage: bool, sourceCurrent: bool): bool =
  not(gatheringRepeatContactAllowed(matchingOn, exactPair, false, expectedLifecycle, exactMessage, sourceCurrent))

pure def lawGatheringRepeatContactNeedsCurrentSource(matchingOn: bool, exactPair: bool, approved: bool,
    expectedLifecycle: bool, exactMessage: bool): bool =
  not(gatheringRepeatContactAllowed(matchingOn, exactPair, approved, expectedLifecycle, exactMessage, false))
```
