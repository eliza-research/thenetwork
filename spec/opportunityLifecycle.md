# Opportunity lifecycle

The [whole-flow model](models/opportunity.md) follows participant replies, retries, delivery and eligibility changes. This module owns the stage of a proposal or group plan. The Network reads the roster and the clock, and persists the resulting stage with the existing review and attendance records.

## Story: Review a proposal before contacting anyone

> As a member, I want a person to review a proposal before the Network can ask me about it.

### An opportunity starts in review

Every proposal starts in review. An approval can start probing only after the review is recorded and the eligibility recheck has passed. A reviewer can reroll a proposal in review. A replacement starts a fresh review revision and deadline, and needs a new approval. A reroll with no replacement closes the proposal.

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

For a regular opportunity, everyone must agree. A group plan supplies the result of its plan quorum and fallback rules after availability, blocks, and timing are checked. A scheduled plan can be updated when someone joins or leaves. A booked group can continue only with at least three attending. With fewer, the booking closes. The remaining people agreed to a group, so a one-to-one meeting needs a new proposal with fresh consent.

```quint
pure def canBook(proposal: OpportunityLifecycle, hasConsent: bool): bool =
  proposal.phase == Probing and proposal.approved and hasConsent

pure def book(proposal: OpportunityLifecycle, hasConsent: bool): OpportunityLifecycle =
  { ...proposal, phase: Scheduled }

pure def groupCanContinue(remaining: int): bool = remaining >= 3

pure def lawAGroupNeedsAtLeastThree(remaining: int): bool =
  (remaining < 3) implies not(groupCanContinue(remaining))

pure def lawPairLeftFromGroupNeedsFreshConsent(proposal: OpportunityLifecycle, remaining: int): bool =
  (proposal.phase == Scheduled and not(groupCanContinue(remaining)))
    implies (canClose(proposal) and not(canBook(close(proposal), true)))
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

### A new minor signal closes an opportunity involving that person

Close an opportunity still in review or probing when a person involved becomes known to be a minor. This applies to current members, alternates, and someone who received a probe and was already replaced. A booked opportunity always closes when the minor is on its roster or was asked about it, whatever the size of the group: the adults do not go on to meet at a time and place that a minor was told. A minor who is going leaves through the ordinary drop path, and that path closes the booking even when three or more adults remain. The adults hear that the plan is off, with no reason, and each of them can be matched again in the ordinary way. A booked opportunity also closes when the minor received a probe for it and was replaced before the booking: a minor who was asked stays on its roster, so a reminder or feedback request about it describes them. A member of a recurring crew counts as asked about each session of that crew, because the crew meets at one time and place. A booking that closes for a minor records the minors policy as its reason. It is not the minor's decision, so it does not count as a declined reveal. The adults hear that it is off only while it is still in the future; after the start they get nothing more about it. When an opportunity in probing closes for a minor, each other member who received a probe and said yes hears that it did not come together; the minor and the requester, whom the request path tells, do not. A stated age under the join age, which declines the person and deletes what the Network holds about them, is a minor signal too. The Network applies this rule first, while it still knows what the person was asked about, and deletes after. Decision 2026-11-17 (NYC world, seed 3): a member who stated 20 declined a probe, was replaced, and was found to be 16 the next day; the two adults then got 4 messages about the booked plan. Decision 2026-11-17 (orchestrator, mini NYC world): in a booked group of four, a member found to be 16 at 14:00 left and the three adults continued; they then got 3 reminders and feedback requests about a plan whose roster included the minor. Review 2026-11-17 (mini NYC world): a member with no record age who stated 30 and later wrote "I am 12 years old" was declined and deleted with the reason of an ordinary leave. The three adults of a booked group of four heard that the rest of them were still on, and a booked pair whose replaced member was the child stayed on with 4 reminders.

The cancellation that a minor signal causes is part of the safety action. The Network sends it at once, before it records the signal, and does not keep it in its own deferred queue. The delivery queue still holds it through the recipient's quiet hours, because it is not a reply. The text gives no reason and names nobody. At the same signal the Network removes from its deferred queue every send about an opportunity that the minor was on, was an alternate for, or received a probe for, whatever its stage. A queued cancellation that is still valid goes at once in the same way, so a member who was owed one is still told. No other queued send about that opportunity, such as a booked plan, a reminder, or a feedback request, ever goes. A message that the Network builds after the signal about such an opportunity is about a plan with a minor on it. Decision 2026-11-17 (mini NYC world, packages/network/test/minor-replaced-booked.integration.test.ts): the replaced member was found to be 16 at 23:00 New York, in the adults' quiet hours. The two cancellations waited in the deferred queue until 09:00, and the judge counted 2 minor contacts. The same timing gave 1 minor contact for a booked pair and 2 for a booked group of 3 when the minor was on the booked roster. After the change, all three cases give 0.

```quint
pure def closesForMinor(proposal: OpportunityLifecycle, minorSignal: bool, participant: bool, alternate: bool, contacted: bool): bool =
  minorSignal and (
    ((proposal.phase == InReview or proposal.phase == Probing) and (participant or alternate or contacted))
    or (proposal.phase == Scheduled and (participant or contacted)))

pure def bookedGroupCanContinue(remaining: int, minorSignal: bool): bool =
  not(minorSignal) and groupCanContinue(remaining)

pure def lawAskedMinorClosesABookedOpportunity(proposal: OpportunityLifecycle): bool =
  proposal.phase == Scheduled implies closesForMinor(proposal, true, false, false, true)

pure def lawMinorOnTheRosterClosesABookedOpportunity(proposal: OpportunityLifecycle): bool =
  proposal.phase == Scheduled implies closesForMinor(proposal, true, true, false, false)

pure def lawAMinorNeverLeavesABookedGroupRunning(remaining: int): bool =
  not(bookedGroupCanContinue(remaining, true))

pure def lawOtherDropsKeepTheGroupRule(remaining: int): bool =
  bookedGroupCanContinue(remaining, false) == groupCanContinue(remaining)

pure def lawMinorContactClosesAnUnbookedOpportunity(proposal: OpportunityLifecycle): bool =
  (proposal.phase == InReview or proposal.phase == Probing) implies closesForMinor(proposal, true, false, false, true)

pure def minorCloseTellsAcceptor(before: OpportunityLifecycle, contacted: bool, accepted: bool, minor: bool, requester: bool): bool =
  before.phase == Probing and contacted and accepted and not(minor) and not(requester)

pure def lawMinorCloseNeverTellsTheMinor(before: OpportunityLifecycle, contacted: bool, accepted: bool, requester: bool): bool =
  not(minorCloseTellsAcceptor(before, contacted, accepted, true, requester))
```

### A minor signal ends the recurring plans that the minor knows

A recurring crew meets at one time and place, and a repeat of a table uses the time and place of the plan it copies. A crew offer forms, and a crew gets a new session, only while no crew member is a known minor. A table is repeated only while no member who was asked about the plan it copies is a known minor, and only if no member who was asked about it ever had a minor signal. The check runs at the moment the Network offers, forms, or schedules. At a minor signal, which includes a decline for an age under the join age, the Network also ends every crew and open crew offer that the minor is in, and marks every opportunity that the minor was asked about. The crew stays ended, and the mark stays, after the Network deletes the minor's id; the mark names nobody. The minor hears nothing more about them. Decision 2026-11-17 (orchestrator): adults do not go on to meet at a time and place that a minor was told. Review 2026-11-17: a member who stated 30 and later wrote "I am 12 years old" was deleted from the crew, so no known minor stayed in it and its sessions went on. The whole-flow model [plan crew](models/plan_crew.md) checks the invariant noSessionAMinorKnows.

```quint
pure def recurrenceAllowed(roster: List[str], knownMinors: List[str], minorWasTold: bool): bool =
  not(minorWasTold) and roster.every(id => not(knownMinors.includes(id)))

pure def lawNoRecurrenceThatAMinorKnows(roster: List[str], knownMinors: List[str], minorWasTold: bool, member: str): bool =
  (minorWasTold or (roster.includes(member) and knownMinors.includes(member)))
    implies not(recurrenceAllowed(roster, knownMinors, minorWasTold))
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
