# Recurring crew offers

This flow covers the offer after an existing plan. The Network owns the member records, finds the qualifying plan, and sends messages. The offer keeps its existing stored fields. The [standalone crew model](models/plan_crew.md) also covers eligibility changes, session booking, and handoff.

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
