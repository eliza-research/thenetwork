# Deliver a gathering second encounter

## Story: Receive a reviewed second-encounter proposal safely

> As a member who opted into private gathering follow-up, I want a new connection to depend on current mutual choices, current safety checks and fresh consent.

### A probe or initial reveal must match the reviewed opportunity and current source

Apply the usual outbound checks. The stored message must belong to this exact opportunity and recipient. The human-approved pair must still have the exact mutual source that created the proposal. Check current membership, adulthood, consent and blocks for both people. Serialize claim against source edits and authorize signed collected replies against the same source. Keep the identity and initial booking details private until both people answer the new opportunity. After booking, ordinary logistics use the ordinary booking rules.

```quint
pure def gatheringRepeatContactAllowed(rollout: bool, exactPair: bool, humanApproved: bool,
    expectedLifecycle: bool, exactMessage: bool, sourceCurrent: bool): bool =
  rollout and exactPair and humanApproved and expectedLifecycle and exactMessage and sourceCurrent

pure def lawGatheringRepeatContactNeedsReview(rollout: bool, exactPair: bool, expectedLifecycle: bool,
    exactMessage: bool, sourceCurrent: bool): bool =
  not(gatheringRepeatContactAllowed(rollout, exactPair, false, expectedLifecycle, exactMessage, sourceCurrent))

pure def lawGatheringRepeatContactNeedsCurrentSource(rollout: bool, exactPair: bool, humanApproved: bool,
    expectedLifecycle: bool, exactMessage: bool): bool =
  not(gatheringRepeatContactAllowed(rollout, exactPair, humanApproved, expectedLifecycle, exactMessage, false))
```
