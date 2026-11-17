# Opportunity lifecycle

The [whole-flow model](models/opportunity.md) follows participant replies, retries, delivery and eligibility changes. This module owns the stage of a proposal or group plan. The Network reads the roster and the clock, and persists the resulting stage with the existing review and attendance records.

## Story: Review a proposal before contacting anyone

> As a member, I want a person to review a proposal before the Network can ask me about it.

### An opportunity starts in review

Every proposal starts in review. An approval can start probing only after the review is recorded and the eligibility recheck has passed. A reviewer can reroll a proposal in review. A replacement starts a fresh review revision and deadline. A reroll with no replacement closes the proposal.

```quint
type OpportunityPhase = InReview | Probing | Scheduled | Done | Closed
type OpportunityLifecycle = { phase: OpportunityPhase, approved: bool }

pure val initial: OpportunityLifecycle = { phase: InReview, approved: false }

pure def canStartProbing(proposal: OpportunityLifecycle, approvalRecorded: bool, eligible: bool): bool =
  proposal.phase == InReview and approvalRecorded and eligible

pure def startProbing(proposal: OpportunityLifecycle, approvalRecorded: bool, eligible: bool): OpportunityLifecycle =
  { phase: Probing, approved: true }

pure def canReroll(proposal: OpportunityLifecycle): bool = proposal.phase == InReview

pure def reroll(proposal: OpportunityLifecycle, replacementFound: bool): OpportunityLifecycle =
  { phase: if (replacementFound) InReview else Closed, approved: false }

pure def stepRerollRequiresNewApproval(before: OpportunityLifecycle, via: str, after: OpportunityLifecycle): bool =
  (via == "reroll") implies (before.phase == InReview and not(after.approved))

pure def alwaysContactStagesRequireApproval(proposal: OpportunityLifecycle): bool =
  (proposal.phase == Probing or proposal.phase == Scheduled or proposal.phase == Done) implies proposal.approved
```

## Story: Book and conclude a proposal that comes together

> As a member, I want the Network to book only after it has enough consent and to close a proposal that can no longer happen.

### Only an approved proposal with enough consent can book

For a regular opportunity, everyone must agree. A group plan supplies the result of its plan quorum and fallback rules after availability, blocks, and timing are checked. A scheduled plan can be updated when someone joins or leaves. A booked group can continue only with at least three attending. The remaining people agreed to a group and need fresh consent for a one-to-one meeting.

```quint
pure def canBook(proposal: OpportunityLifecycle, hasConsent: bool): bool =
  proposal.phase == Probing and proposal.approved and hasConsent

pure def book(proposal: OpportunityLifecycle, hasConsent: bool): OpportunityLifecycle =
  { ...proposal, phase: Scheduled }

pure def groupCanContinue(remaining: int): bool = remaining >= 3

pure def lawAGroupNeedsAtLeastThree(remaining: int): bool =
  groupCanContinue(remaining) implies remaining >= 3
```

### A member can withdraw probe consent before the reveal

A direct refusal after acceptance can withdraw consent while the proposal still probes. The last message to the member must be that proposal's probe. Any other open question keeps its reply path. Match exactly one current accepted seat. Close the proposal, release the waiting seats with neutral copy and keep the withdrawing member's identity private. A new proposal needs its own review and consent.

```quint
pure def acceptedProbeCanWithdraw(proposal: OpportunityLifecycle, accepted: bool, contacted: bool, lastProbe: bool): bool =
  proposal.phase == Probing and proposal.approved and accepted and contacted and lastProbe

pure def acceptedProbeWithdrawalAllowed(ownText: bool, directRefusal: bool, otherReplyOpen: bool, matches: int): bool =
  ownText and directRefusal and not(otherReplyOpen) and matches == 1

pure def lawAcceptedProbeWithdrawalNeedsExactMatch(ownText: bool, directRefusal: bool, otherReplyOpen: bool, matches: int): bool =
  acceptedProbeWithdrawalAllowed(ownText, directRefusal, otherReplyOpen, matches) implies (matches == 1 and not(otherReplyOpen))
```

### A closed booking releases its pending replies

When a booked opportunity closes after a participant drops, clear each pending reply for that opportunity. Keep each reply slot for another opportunity. A booked reply can change or confirm a plan only while its opportunity is scheduled and the member still accepts it. Discard a stale booked reply slot before routing the member's message.

```quint
pure def bookedReplyCurrent(proposal: OpportunityLifecycle, accepted: bool): bool =
  proposal.phase == Scheduled and proposal.approved and accepted

pure def lawBookedReplyRequiresCurrentConsent(proposal: OpportunityLifecycle, accepted: bool): bool =
  bookedReplyCurrent(proposal, accepted) implies (proposal.phase == Scheduled and accepted)
```

### An explicit cancellation selects the named upcoming meeting

Read the member's own explicit cancellation in the current app. A request with an exact date and time in New York local time selects that start before interpreting a reply to another booking or probe. Keep that other reply slot open. Consider only accepted bookings on the member's current roster with a known start later than now. One matching booking follows the ordinary cancellation path. With several matches, ask which meeting. With no match, report that none matched. Both outcomes leave all bookings unchanged. A cancellation without a date keeps the normal routing for an active booked reply slot and for a probe answer.

```quint
type UnlinkedCancellation = NoCancellation | NoMatchingBooking | AskWhichBooking | CancelMatchingBooking

pure def upcomingCancellationEligible(proposal: OpportunityLifecycle, onRoster: bool, accepted: bool,
    startKnown: bool, startAt: int, now: int): bool =
  onRoster and bookedReplyCurrent(proposal, accepted) and startKnown and startAt > now

pure def unlinkedCancellation(ownText: bool, explicit: bool, activeBookedSlot: bool, namedStart: bool, matching: int): UnlinkedCancellation =
  if (not(ownText) or not(explicit) or (activeBookedSlot and not(namedStart))) NoCancellation
  else if (matching == 1) CancelMatchingBooking
  else if (matching > 1) AskWhichBooking
  else NoMatchingBooking

pure def lawUnlinkedCancellationNeedsOneMatch(ownText: bool, explicit: bool, activeBookedSlot: bool, namedStart: bool, matching: int): bool =
  unlinkedCancellation(ownText, explicit, activeBookedSlot, namedStart, matching) == CancelMatchingBooking
    implies (ownText and explicit and (namedStart or not(activeBookedSlot)) and matching == 1)

pure def lawNamedCancellationCanSelectWithPendingReply(activeBookedSlot: bool): bool =
  unlinkedCancellation(true, true, activeBookedSlot, true, 1) == CancelMatchingBooking

pure def lawStartedBookingCannotBeSelected(proposal: OpportunityLifecycle, onRoster: bool, accepted: bool,
    startKnown: bool, startAt: int, now: int): bool =
  startAt <= now implies not(upcomingCancellationEligible(proposal, onRoster, accepted, startKnown, startAt, now))
```

### A new minor signal closes an unbooked opportunity involving that person

Close an opportunity still in review or probing when a person involved becomes known to be a minor. This applies to current members, alternates, and someone who received a probe and was already replaced. A booked opportunity uses the existing cancellation path if the minor is on the booked roster. A booked opportunity also closes when the minor received a probe for it and was replaced before the booking: a minor who was asked stays on its roster, so a reminder or feedback request about it describes them. Decision 2026-11-17 (NYC world, seed 3): a member who stated 20 declined a probe, was replaced, and was found to be 16 the next day; the two adults then got 4 messages about the booked plan.

```quint
pure def closesForMinor(proposal: OpportunityLifecycle, minorSignal: bool, participant: bool, alternate: bool, contacted: bool): bool =
  minorSignal and (
    ((proposal.phase == InReview or proposal.phase == Probing) and (participant or alternate or contacted))
    or (proposal.phase == Scheduled and contacted and not(participant)))

pure def lawAskedMinorClosesABookedOpportunity(proposal: OpportunityLifecycle): bool =
  proposal.phase == Scheduled implies closesForMinor(proposal, true, false, false, true)

pure def lawMinorContactClosesAnUnbookedOpportunity(proposal: OpportunityLifecycle): bool =
  (proposal.phase == InReview or proposal.phase == Probing) implies closesForMinor(proposal, true, false, false, true)
```

### A scheduled opportunity is done when feedback becomes due

Once the feedback time arrives, the Network marks the scheduled opportunity done and records the feedback request. A refusal, cancellation, or expiry can close any open stage. Done and closed are terminal.

```quint
pure def canComplete(proposal: OpportunityLifecycle, feedbackDue: bool): bool =
  proposal.phase == Scheduled and feedbackDue

pure def complete(proposal: OpportunityLifecycle, feedbackDue: bool): OpportunityLifecycle =
  { ...proposal, phase: Done }

pure def canClose(proposal: OpportunityLifecycle): bool =
  proposal.phase == InReview or proposal.phase == Probing or proposal.phase == Scheduled

pure def close(proposal: OpportunityLifecycle): OpportunityLifecycle =
  { ...proposal, phase: Closed }

pure def stepTerminalOpportunityCannotReopen(before: OpportunityLifecycle, after: OpportunityLifecycle): bool =
  (before.phase == Closed or before.phase == Done) implies before.phase == after.phase

pure def sometimesCanBook(proposal: OpportunityLifecycle): bool = proposal.phase == Scheduled
pure def sometimesCanComplete(proposal: OpportunityLifecycle): bool = proposal.phase == Done
pure def sometimesCanCloseBeforeContact(proposal: OpportunityLifecycle): bool = proposal.phase == Closed and not(proposal.approved)
```

### Closing an underfilled proposal releases the members who accepted

If a system proposal expires or cannot book enough members at a common time, send one neutral closing notice to each member who received its invitation and still accepts it. Use the ordinary safety and timing checks for cancellation messages. Do not disclose the other members or anyone's response. Member requests and group plans keep their own closing paths.

```quint
pure def releasesPartialAcceptance(before: OpportunityLifecycle, unresolved: bool, systemProposal: bool,
    contacted: bool, accepted: bool): bool =
  before.phase == Probing and before.approved and unresolved and systemProposal and contacted and accepted

pure def lawReleaseNeedsAContactedAcceptor(before: OpportunityLifecycle, unresolved: bool, systemProposal: bool,
    contacted: bool, accepted: bool): bool =
  releasesPartialAcceptance(before, unresolved, systemProposal, contacted, accepted) implies (contacted and accepted)
```
