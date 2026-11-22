# Monthly gathering invitation review

## Story: Approve invitations to an upcoming monthly gathering

> As a Network administrator, I want to approve the recommended invitees for the exact gathering and leave out people I chose not to invite.

### A fresh review records only the current ordered eligible selection

The current Network administrator reviews the exact approved future New York gathering. A selection can omit any recommendations, but must preserve the order of the IDs that remain. Each selected person must be in the current eligible recommendation. The selection cannot exceed the approved gathering capacity. An empty selection records the decision to invite nobody. The review writes a durable batch, its ordered invitees and a staff audit event in one transaction. No provider message, invitation queue entry, RSVP or grouping consent is created by this decision.

```quint
pure val selectedCountValues = Set(0, 1, 3, 150, 151)
pure val capacityValues = Set(0, 1, 3, 150)
pure val recommendedValues = Set(List(), List("a", "b", "c"), List("a"), List("b", "a"))
pure val selectedValues = Set(List(), List("a"), List("a", "c"), List("b", "a"), List("a", "a"), List("d"))

pure def gatheringSelectionInOrder(recommended: List[str], selected: List[str]): bool =
  selected == recommended.select(id => selected.includes(id))

pure def gatheringInvitationReviewAllowed(currentGathering: bool, ordered: bool, selectedCount: int, capacity: int): bool =
  currentGathering and ordered and 0 <= selectedCount and selectedCount <= capacity

pure def lawGatheringInvitationReviewUsesCapacity(currentGathering: bool, ordered: bool, selectedCount: int, capacity: int): bool =
  gatheringInvitationReviewAllowed(currentGathering, ordered, selectedCount, capacity) implies selectedCount <= capacity
```

### The first decision fixes the exact selection for that revision

For a recorded gathering revision, reusing the exact ordered selection returns its existing aggregate receipt. Reordering, adding or removing a selection after the decision conflicts. A retry does not authorize anyone again. Membership erasure removes the invitee record while preserving the aggregated staff decision. Every actual send requires a separate current admission.

```quint
type GatheringSelectionReplay = FirstGatheringReview | ExactGatheringReview | ConflictingGatheringReview

pure def gatheringSelectionReplay(recorded: bool, sameSelection: bool): GatheringSelectionReplay =
  if (not(recorded)) FirstGatheringReview
  else if (sameSelection) ExactGatheringReview
  else ConflictingGatheringReview

pure def lawGatheringCannotReplaceDecision(sameSelection: bool): bool =
  gatheringSelectionReplay(true, sameSelection) != FirstGatheringReview
```
