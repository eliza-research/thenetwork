# Opportunity lifecycle

The [whole-flow model](models/opportunity.md) follows participant replies, retries, delivery and eligibility changes. This module owns the stage of a proposal or group plan. The Network reads the roster and the clock, and persists the resulting stage with the existing review and attendance records.

## Story: Review a proposal before contacting anyone

> As a member, I want a person to review a proposal before the Network can ask me about it.

### An opportunity starts in review

Every proposal starts in review. An approval can start probing only after the review is recorded and the eligibility recheck has passed. A reroll that finds a replacement remains in review with a fresh deadline.

```quint
type OpportunityPhase = InReview | Probing | Scheduled | Done | Closed
type OpportunityLifecycle = { phase: OpportunityPhase, approved: bool }

pure val initial: OpportunityLifecycle = { phase: InReview, approved: false }

pure def canStartProbing(proposal: OpportunityLifecycle, approvalRecorded: bool, eligible: bool): bool =
  proposal.phase == InReview and approvalRecorded and eligible

pure def startProbing(proposal: OpportunityLifecycle, approvalRecorded: bool, eligible: bool): OpportunityLifecycle =
  { phase: Probing, approved: true }

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

### A closed booking releases its pending replies

When a booked opportunity closes after a participant drops, clear each pending reply for that opportunity. Keep each reply slot for another opportunity. A booked reply can change or confirm a plan only while its opportunity is scheduled and the member still accepts it. Discard a stale booked reply slot before routing the member's message.

```quint
pure def bookedReplyCurrent(proposal: OpportunityLifecycle, accepted: bool): bool =
  proposal.phase == Scheduled and proposal.approved and accepted

pure def lawBookedReplyRequiresCurrentConsent(proposal: OpportunityLifecycle, accepted: bool): bool =
  bookedReplyCurrent(proposal, accepted) implies (proposal.phase == Scheduled and accepted)
```

### A new minor signal closes an unbooked opportunity involving that person

Close an opportunity still in review or probing when a person involved becomes known to be a minor. This applies to current members, alternates, and someone who received a probe and was already replaced. A booked opportunity uses the existing cancellation path if the minor is on the booked roster.

```quint
pure def closesForMinor(proposal: OpportunityLifecycle, minorSignal: bool, participant: bool, alternate: bool, contacted: bool): bool =
  (proposal.phase == InReview or proposal.phase == Probing) and minorSignal and (participant or alternate or contacted)

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
