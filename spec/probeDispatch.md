# Deliver and settle an anonymous probe

The [whole opportunity model](models/opportunity.md) follows the review, scheduling, nudge, provider, and attendance actions. The Network uses these transitions for each participant in a regular probe. Plan probes share its response deadline. Calendar evidence, roster storage, message rendering, and the final send checks stay in the Network.

## Story: Hear about one reviewed opportunity at a time

> As a member, I want the Network to wait for my earlier question, contact me at an appropriate time, and honor my answer.

### The first participant opens the later turns

The first participant's turn can open immediately. Other turns can open after the first participant is available. A prior request for exactly this opportunity counts as interest before contact. A prior request still needs its time question when times are available and remain to be picked. Record when a queued turn first opens.

```quint
type ProbePhase = Queued | AwaitingReply | Available | Unavailable | OutsideProbe
type ParticipantProbe = { phase: ProbePhase }

pure val initial: ParticipantProbe = { phase: Queued }

pure def probePending(participant: ParticipantProbe): bool = participant.phase == Queued or participant.phase == AwaitingReply

pure def mayUsePriorIntent(participant: ParticipantProbe, primed: bool, contacted: bool): bool =
  probePending(participant) and primed and not(contacted)

pure def canUsePriorIntent(participant: ParticipantProbe, primed: bool, contacted: bool, needsTimes: bool): bool =
  mayUsePriorIntent(participant, primed, contacted) and not(needsTimes)

pure def usePriorIntent(participant: ParticipantProbe, primed: bool, contacted: bool, needsTimes: bool): ParticipantProbe =
  { phase: Available }

pure def turnReached(participant: ParticipantProbe, first: bool, firstAvailable: bool): bool =
  probePending(participant) and (first or firstAvailable)

pure def canOpenTurn(participant: ParticipantProbe, first: bool, firstAvailable: bool): bool =
  participant.phase == Queued and turnReached(participant, first, firstAvailable)

pure def openTurn(participant: ParticipantProbe, first: bool, firstAvailable: bool): ParticipantProbe =
  { phase: AwaitingReply }

pure def lawLaterTurnRequiresFirst(participant: ParticipantProbe): bool = not(turnReached(participant, false, false))
```

### Wait for the member's send window and current availability

A pending turn needs only one probe. A requester's own confirmation and a hiring manager's review use the logistics window. Other participants use their proactive send window. An outstanding question defers both regular and plan probes before contact, including an onboarding question sent as a direct reply. The question holds the probe until the member answers or for up to 24 hours. After timing allows contact, a participant away from the city is unavailable. When everyone else's proposed times are gone and there is no fixed time or venue, close without probing. The existing send path still checks consent, eligibility, and private facts.

```quint
type ProbeTiming = WaitForQuestion | WaitForWindow | CheckAvailability
type ProbeAvailability = ReadyToSend | ParticipantAway | NoCommonTime

pure def needsProbeSend(participant: ParticipantProbe, contacted: bool): bool =
  participant.phase == AwaitingReply and not(contacted)

pure def probeIsInvite(requester: bool, hiringManager: bool): bool = not(requester or hiringManager)

pure val questionHoldMs: int = 24 * 3600000

pure def probeQuestionHoldUntil(askedAt: int): int = askedAt + questionHoldMs

pure def probeTiming(questionOpen: bool, windowOpen: bool): ProbeTiming =
  if (questionOpen) WaitForQuestion else if (not(windowOpen)) WaitForWindow else CheckAvailability

pure def lawProbeWaitsForOpenQuestion(windowOpen: bool): bool =
  probeTiming(true, windowOpen) == WaitForQuestion

pure def probeAvailability(present: bool, commonTimeGone: bool): ProbeAvailability =
  if (not(present)) ParticipantAway else if (commonTimeGone) NoCommonTime else ReadyToSend

pure def canMarkUnavailable(participant: ParticipantProbe): bool = participant.phase == AwaitingReply
pure def markUnavailable(participant: ParticipantProbe): ParticipantProbe = { phase: Unavailable }
```

### A reply or an expired deadline settles the probe

Treat a yes as availability and a no as unavailability when the participant's probe is open. A yes without any acceptable offered time can get one replacement set. If that time question goes unanswered, keep the yes. Other unanswered turns become unavailable at the response deadline, or at the send deadline if still unsent. Use the sent timestamp for the response deadline and the turn timestamp for the send deadline. A legacy unsent turn without its own timestamp uses its opportunity creation time. The sent window is 26 hours for both regular and plan probes.

```quint
pure val probeResponseMs: int = 26 * 3600000

pure def canRecordReply(participant: ParticipantProbe): bool = participant.phase == AwaitingReply
pure def recordReply(participant: ParticipantProbe, agreed: bool): ParticipantProbe =
  { phase: if (agreed) Available else Unavailable }

pure def needsOtherTimes(offeredTimes: bool, pickedTimes: bool): bool = offeredTimes and not(pickedTimes)
pure def shouldLookForOtherTimes(offeredTimes: bool, pickedTimes: bool, offeredAgain: bool): bool =
  needsOtherTimes(offeredTimes, pickedTimes) and not(offeredAgain)

pure def canOfferOtherTimes(participant: ParticipantProbe, hasFreshTimes: bool): bool =
  participant.phase == Available and hasFreshTimes

pure def offerOtherTimes(participant: ParticipantProbe, hasFreshTimes: bool): ParticipantProbe = { phase: AwaitingReply }

pure def probeExpiryDeadline(sent: bool, responseDeadline: int, sendDeadline: int): int =
  if (sent) responseDeadline else sendDeadline

pure def probeExpired(asOf: int, deadline: int): bool = asOf >= deadline

pure def canExpireProbe(participant: ParticipantProbe, expired: bool): bool = participant.phase == AwaitingReply and expired
pure def expireProbe(participant: ParticipantProbe, expired: bool, timeQuestion: bool): ParticipantProbe =
  { phase: if (timeQuestion) Available else Unavailable }

pure def stepUnavailableNeverReopens(before: ParticipantProbe, after: ParticipantProbe): bool =
  before.phase == Unavailable implies after.phase == Unavailable

pure def sometimesAgreed(participant: ParticipantProbe): bool = participant.phase == Available
pure def sometimesSettledNo(participant: ParticipantProbe): bool = participant.phase == Unavailable
```

### A replacement keeps the requester or hiring manager and all eligible group members

If a requester or hiring manager becomes unavailable, close the opportunity. Otherwise try up to three replacements over the life of the opportunity. An alternate must be eligible and have neither a conflicting first name nor a block, avoid rule, or disqualifying prior pair with anyone staying. Try alternates in order. If no alternate is accepted, a group can continue after removing the unavailable member when at least three members remain available to participate. Close all other opportunities.

```quint
type ReplacementRoute = IgnoreReplacement | CloseRequester | CloseManager | FindAlternate

pure def replacementRoute(probing: bool, requesterOut: bool, managerOut: bool): ReplacementRoute =
  if (not(probing)) IgnoreReplacement
  else if (requesterOut) CloseRequester
  else if (managerOut) CloseManager
  else FindAlternate

pure def mayTryAlternate(alternatesRemain: bool, replaced: int): bool = alternatesRemain and replaced < 3

pure def alternateAllowed(eligible: bool, sameFirstName: bool, conflict: bool): bool =
  eligible and not(sameFirstName) and not(conflict)

pure def lawRequiredParticipantCannotBeReplaced(probing: bool, requesterOut: bool, managerOut: bool): bool =
  (requesterOut or managerOut) implies replacementRoute(probing, requesterOut, managerOut) != FindAlternate
```
