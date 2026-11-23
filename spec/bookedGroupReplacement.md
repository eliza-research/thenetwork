# Replace a cancelled group booking

[Story F18](product/stories.md#story-f18--keep-a-meeting-on-track) permits an eligible reviewed alternate after a participant withdraws. [Plan decisions](planDecision.md) still govern anonymous invitations and the new group's consent. The service tries the original slot first, when the current group can meet there with the normal planning lead time, and then each later template slot in order. Replacement probes spend the ordinary introduction allowance and respect the daily plan invite limit; the outreach path enforces both.

## Story: Get a fresh invitation after an underfilled booking closes

> As a member of a cancelled group, I want a new invitation if the group can meet with a reviewed alternate.

### An accepted withdrawal can start recovery after the old booking closes

An ordinary, approved three-person quorum plan can try recovery after a booked participant explicitly withdraws before the start and the other two booked members remain. The original booking closes and gives the members who remain a neutral cancellation. A plan created as a replacement gets one chance to book. Silence, a blocked pair, STOP, a safety hold, a refused reveal, or a pending invitee leaving does not start recovery. Crew plans, plans with a host, partner plans and plans at published events keep their existing closure rules.

```quint
type RecoverySource = {
  ownWithdrawal: bool, future: bool, originalOrdinaryPlan: bool, approved: bool,
  acceptedAndTold: bool, remainingBooked: int, quorum: int,
}

pure val eligibleSource: RecoverySource = { ownWithdrawal: true, future: true, originalOrdinaryPlan: true,
  approved: true, acceptedAndTold: true, remainingBooked: 2, quorum: 3 }

pure val sourceValues = Set(eligibleSource, { ...eligibleSource, ownWithdrawal: false },
  { ...eligibleSource, future: false }, { ...eligibleSource, originalOrdinaryPlan: false },
  { ...eligibleSource, approved: false }, { ...eligibleSource, acceptedAndTold: false },
  { ...eligibleSource, remainingBooked: 1 }, { ...eligibleSource, quorum: 4 })

pure def canTryGroupReplacement(source: RecoverySource): bool =
  source.ownWithdrawal and source.future and source.originalOrdinaryPlan and source.approved
    and source.acceptedAndTold and source.remainingBooked == 2 and source.quorum == 3

pure def lawRecoveryRequiresAPreStartWithdrawal(source: RecoverySource): bool =
  canTryGroupReplacement(source) implies (source.ownWithdrawal and source.future and source.acceptedAndTold)
```

### A replacement uses a current reviewed alternate and a viable slot

Use the original review's remaining bench in order. The alternate must still be on the bench, must never have been invited or contacted for the old booking, and must be distinct from its former participants. Each participant needs a current eligible group seat, compatible peers, and current availability to meet at the public venue. A viable slot is not earlier than the original slot, starts no earlier than the planning lead time and no later than the planning horizon, and the current group can meet at the venue then. The new plan enters review with a new identifier. The opportunity keeps an internal reference to the cancelled booking and the new plan starts without any earlier acceptances. A booked teen item, whose roster holds a minor, gets no replacement: it closes as a whole, and every seat of a replacement is an adult. Changed (owner decision 2026-11-22, answers A2 to A5): the owner allowed small teen groups on friends.help; a replacement would change who a minor meets after the probe told them the place, so a teen group never recovers this way.

```quint
pure def mayOfferReviewedAlternate(reviewed: bool, onCurrentBench: bool, onCurrentAlternates: bool, previouslyInvolved: bool): bool =
  reviewed and onCurrentBench and onCurrentAlternates and not(previouslyInvolved)

pure def viableReplacementSlot(start: int, originalStart: int, earliestStart: int, latestStart: int, currentVenueAndRoster: bool): bool =
  start >= originalStart and start >= earliestStart and start <= latestStart and currentVenueAndRoster

pure def lawAnEarlierSlotCannotReplaceTheBooking(start: int, originalStart: int, earliestStart: int, latestStart: int, currentVenueAndRoster: bool): bool =
  viableReplacementSlot(start, originalStart, earliestStart, latestStart, currentVenueAndRoster) implies start >= originalStart
```

### The next plan needs fresh review and all three separate acceptances

Recheck that the old booking closed and the current group and slot, before the probe deadline, at approval, before sending anonymous probes and before booking. An answer must come from the member after the provider accepts delivery of their exact replacement probe. The replacement only books when all three new invitees independently accept and remain eligible. If the group cannot meet, close the replacement without admitting an old invitee or turning the replacement into a pair.

```quint
pure def recoveryPlanCanProceed(sourceClosed: bool, currentRosterAndSlot: bool, beforeDeadline: bool): bool =
  sourceClosed and currentRosterAndSlot and beforeDeadline

pure def replacementAnswerAllowed(ownAnswer: bool, probeDelivered: bool, answerAt: int, sentAt: int): bool =
  ownAnswer and probeDelivered and answerAt >= sentAt

pure def lawAnswerNeedsItsDeliveredReplacement(ownAnswer: bool, answerAt: int, sentAt: int): bool =
  not(replacementAnswerAllowed(ownAnswer, false, answerAt, sentAt))

pure def bookReplacementPlan(approved: bool, freshAcceptances: int, seated: int): bool =
  approved and freshAcceptances == 3 and seated == 3

pure def lawReplacementNeedsFreshReviewAndQuorum(approved: bool, freshAcceptances: int, seated: int): bool =
  bookReplacementPlan(approved, freshAcceptances, seated) implies (approved and freshAcceptances == 3 and seated == 3)
```
