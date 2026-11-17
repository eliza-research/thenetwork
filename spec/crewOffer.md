# Recurring crew offers

This flow covers the offer after an existing plan, the time check for a recurring session, and the handoff. The Network owns the member records, finds the qualifying plan, and sends messages. The offer keeps its existing stored fields. The [standalone crew model](models/plan_crew.md) also covers eligibility changes and session booking.

## Story: Opt in to a recurring crew

> As a member who enjoyed a plan, I want to decide whether to join the same people again.

### An open offer records who was invited

An offer opens with the invited members and no replies. A late positive answer about the original plan can add a member while the offer is open. A member already invited does not get a second invitation.

```quint
type CrewOfferPhase = Unopened | Open | Resolved
type CrewOfferState = { phase: CrewOfferPhase, offered: List[str], yes: List[str], no: List[str] }

pure val initial: CrewOfferState = { phase: Unopened, offered: List(), yes: List(), no: List() }

pure def canOpenOffer(offer: CrewOfferState): bool = offer.phase == Unopened
pure def openOffer(offer: CrewOfferState, invitees: List[str]): CrewOfferState =
  { phase: Open, offered: invitees, yes: List(), no: List() }

pure def canExtendOffer(offer: CrewOfferState, memberId: str, enjoyedPlan: bool): bool =
  offer.phase == Open and enjoyedPlan and not(offer.offered.includes(memberId))

pure def extendOffer(offer: CrewOfferState, memberId: str, enjoyedPlan: bool): CrewOfferState =
  { ...offer, offered: offer.offered.append(memberId) }
```

### Each invited member can reply once

A yes or a no records the invited member's answer. A closed offer, an uninvited member, and a repeat answer leave the offer unchanged.

```quint
pure def canRecordCrewAnswer(offer: CrewOfferState, memberId: str): bool =
  offer.phase == Open and offer.offered.includes(memberId) and
    not(offer.yes.includes(memberId)) and not(offer.no.includes(memberId))

pure def recordCrewAnswer(offer: CrewOfferState, memberId: str, accepted: bool): CrewOfferState =
  if (accepted) { ...offer, yes: offer.yes.append(memberId) }
  else { ...offer, no: offer.no.append(memberId) }

pure def alwaysAnswersComeFromInvitees(offer: CrewOfferState): bool =
  offer.yes.every(id => offer.offered.includes(id)) and offer.no.every(id => offer.offered.includes(id))
```

### A crew reply follows acceptance of its exact offer

The member's pending question names the outbound crew offer. A direct member reply can count while the offer is open and within its three-day window. Require the provider acceptance of that exact offer for that member and app. Compare the signed receipt time of the inbound reply with the outbound acceptance time. A queued offer, a different offer, or a reply received before acceptance cannot add anyone to a crew.

```quint
pure def crewOfferReplyCurrent(memberReply: bool, accepted: bool, openedAt: int,
  stagedAt: int, acceptedAt: int, receivedAt: int, now: int): bool =
  memberReply and accepted and openedAt <= stagedAt and stagedAt <= acceptedAt and
    acceptedAt <= receivedAt and receivedAt <= now and now - openedAt <= crewOfferWindowMs

pure def lawCrewReplyNeedsExactAcceptance(memberReply: bool, openedAt: int,
  stagedAt: int, acceptedAt: int, receivedAt: int, now: int): bool =
  not(crewOfferReplyCurrent(memberReply, false, openedAt, stagedAt, acceptedAt, receivedAt, now))
```

### An offer resolves after every reply or once more than three days pass

After recording a reply, resolve the offer when every invited member has answered. The tick resolves an open offer after more than three days even if someone has not answered. The shell determines whether the recorded acceptances are enough to form a crew.

```quint
pure val crewOfferWindowMs: int = 259200000
pure val elapsedMsValues = Set(0, crewOfferWindowMs - 1, crewOfferWindowMs, crewOfferWindowMs + 1)

pure def canFinishCrewAnswers(offer: CrewOfferState): bool =
  offer.phase == Open and offer.yes.length() + offer.no.length() >= offer.offered.length()

pure def finishCrewAnswers(offer: CrewOfferState): CrewOfferState = { ...offer, phase: Resolved }

pure def canExpireCrewOffer(offer: CrewOfferState, elapsedMs: int): bool =
  offer.phase == Open and elapsedMs > crewOfferWindowMs

pure def expireCrewOffer(offer: CrewOfferState, elapsedMs: int): CrewOfferState = { ...offer, phase: Resolved }

pure def stepResolvedOfferStaysClosed(before: CrewOfferState, after: CrewOfferState): bool =
  before.phase == Resolved implies after.phase == Resolved

pure def sometimesResolvedWithAllAnswers(offer: CrewOfferState): bool =
  offer.phase == Resolved and offer.offered.length() > 0 and
    offer.yes.length() + offer.no.length() == offer.offered.length()

pure def sometimesCrewOfferClosesWithRepliesMissing(offer: CrewOfferState): bool =
  offer.phase == Resolved and offer.yes.length() + offer.no.length() < offer.offered.length()
```

### Erasing a member removes their invitation and answer

Remove the member from the invitation list and both answer lists, including after resolution. Erasure leaves the offer phase as it was. The shell also removes the person from the crew candidate.

```quint
pure def canForgetCrewInvitee(offer: CrewOfferState): bool = offer.phase != Unopened
pure def forgetCrewInvitee(offer: CrewOfferState, memberId: str): CrewOfferState =
  { ...offer,
    offered: offer.offered.select(id => id != memberId),
    yes: offer.yes.select(id => id != memberId),
    no: offer.no.select(id => id != memberId) }
```

## Story: Meet in a new recurring session

> As a crew member, I want the next session to respect my current availability.

### A new recurring session needs a currently usable time

Before putting a new occurrence into review, check the retained crew against the proposed time. An announced absence, a nearby booking, or an active stated window that excludes the time prevents that proposal. Leave the occurrence uncounted and try again on the next planning pass. Check additional seats against the same rule. Unknown availability still allows a proposal. Each session requires its own review and replies.

```quint
pure def crewMemberWindowAvailable(present: bool, noNearbyBooking: bool, statedAllows: bool): bool =
  present and noNearbyBooking and statedAllows
```

### A new recurring session uses a current public venue

Resolve the crew's recorded venue in its city for the same activity before review. The venue must still be public and open for the full activity window. A missing venue or a closing time during the session prevents the proposal. Leave the occurrence uncounted and keep the crew available for a later planning pass. Existing pair, review and consent checks still apply.

```quint
pure def crewSessionVenueAllowed(isPublic: bool, sameCity: bool, supportsActivity: bool, fullWindowOpen: bool): bool =
  isPublic and sameCity and supportsActivity and fullWindowOpen

pure def lawCrewCannotUseAClosingVenue(isPublic: bool, sameCity: bool, supportsActivity: bool): bool =
  not(crewSessionVenueAllowed(isPublic, sameCity, supportsActivity, false))
```

## Story: Take over the recurring crew

> As a crew member, I want the Network to organize the first sessions before the crew takes over.

### Handoff counts booked sessions that reached feedback

When the crew has no open session, hand it off after the configured number of booked sessions reach the feedback step. A proposed session and a session that closes before feedback do not count. Keep the weekly slot history so a rejection does not queue another proposal for the same slot.

```quint
pure def crewHandoffDue(openSession: bool, completedCount: int, requiredCount: int): bool =
  not(openSession) and completedCount >= requiredCount
```
