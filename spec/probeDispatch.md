# Deliver and settle an anonymous probe

The [whole opportunity model](models/opportunity.md) follows the review, scheduling, nudge, provider, and attendance actions. The Network uses these transitions for each participant in a regular probe. Plan probes share its response deadline. Calendar evidence, roster storage, message rendering, and the final send checks stay in the Network.

## Story: Hear about one reviewed opportunity at a time

> As a member, I want the Network to wait for my earlier question, contact me at an appropriate time, and honor my answer.

### The first participant opens the later turns

The first participant's turn can open immediately. Other turns can open after the first participant is available. A prior request for exactly this opportunity counts as interest before contact. A prior request still needs its time question when times are available and remain to be picked. Record when a queued turn first opens. Each participant's probe state also keeps the opportunity's roster revision, the revision that their open turn or their yes is about, and whether a probe of that turn reached them. An opened turn and a used prior request are about the current revision, and no probe of the new turn has gone out yet. A prior request can stand in for a probe only while no probe of the current turn reached the member, because a member who read a probe answers that probe and not their earlier request. Changed (audit OPP18): the probe state had no roster revision and no sent probe -> it carries both, so that a yes counts only for the roster that its probe described.

```quint
type ProbePhase = Queued | AwaitingReply | Available | Unavailable | OutsideProbe
type ParticipantProbe = { phase: ProbePhase, roster: int, about: int, told: bool }

pure val initial: ParticipantProbe = { phase: Queued, roster: 0, about: 0, told: false }

pure def probePending(participant: ParticipantProbe): bool = participant.phase == Queued or participant.phase == AwaitingReply

pure def mayUsePriorIntent(participant: ParticipantProbe, primed: bool, contacted: bool): bool =
  probePending(participant) and not(participant.told) and primed and not(contacted)

pure def canUsePriorIntent(participant: ParticipantProbe, primed: bool, contacted: bool, needsTimes: bool): bool =
  mayUsePriorIntent(participant, primed, contacted) and not(needsTimes)

pure def usePriorIntent(participant: ParticipantProbe, primed: bool, contacted: bool, needsTimes: bool): ParticipantProbe =
  { ...participant, phase: Available, about: participant.roster, told: false }

pure def turnReached(participant: ParticipantProbe, first: bool, firstAvailable: bool): bool =
  probePending(participant) and (first or firstAvailable)

pure def canOpenTurn(participant: ParticipantProbe, first: bool, firstAvailable: bool): bool =
  participant.phase == Queued and turnReached(participant, first, firstAvailable)

pure def openTurn(participant: ParticipantProbe, first: bool, firstAvailable: bool): ParticipantProbe =
  { ...participant, phase: AwaitingReply, about: participant.roster, told: false }

pure def lawLaterTurnRequiresFirst(participant: ParticipantProbe): bool = not(turnReached(participant, false, false))
```

### Wait for the member's send window and current availability

A pending turn needs only one probe: after its probe goes out, the turn is marked as told. A requester's own confirmation and a hiring manager's review use the logistics window. Other participants use their proactive send window. An outstanding question defers both regular and plan probes before contact, including an onboarding question sent as a direct reply. The question holds the probe until the member answers or for up to 24 hours. After timing allows contact, a participant away from the city is unavailable. When everyone else's proposed times are gone and there is no fixed time or venue, close without probing. The existing send path still checks consent, eligibility, and private facts. Changed (audit OPP18): a turn needed a probe only while the member was never contacted in the opportunity -> it needs one while no probe of that turn reached the member, because a member asked again after a replacement got no new probe.

```quint
type ProbeTiming = WaitForQuestion | WaitForWindow | CheckAvailability
type ProbeAvailability = ReadyToSend | ParticipantAway | NoCommonTime

pure def needsProbeSend(participant: ParticipantProbe): bool =
  participant.phase == AwaitingReply and not(participant.told)

pure def canRecordProbeSent(participant: ParticipantProbe): bool = needsProbeSend(participant)
pure def recordProbeSent(participant: ParticipantProbe): ParticipantProbe = { ...participant, told: true }

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
pure def markUnavailable(participant: ParticipantProbe): ParticipantProbe = { ...participant, phase: Unavailable }
```

### A reply or an expired deadline settles the probe

Treat a yes as availability and a no as unavailability when the participant's probe is open. A yes without any acceptable offered time can get one replacement set. If that time question goes unanswered, keep the yes. Other unanswered turns become unavailable at the response deadline, or at the send deadline if still unsent. Use the sent timestamp for the response deadline and the turn timestamp for the send deadline. A legacy unsent turn without its own timestamp uses its opportunity creation time. A Slop probe and a time question each have a sent window of 24 hours; every other regular or plan probe has a sent window of 48 hours. A sent probe is open for its whole window and expires when the window ends. Changed (audit OPP57): every probe had a 26-hour window -> a Slop probe and a time question have 24 hours and other probes 48 hours, because the approved story F11 says so.

```quint
pure val genericProbeResponseMs: int = 48 * 3600000
pure val shortProbeResponseMs: int = 24 * 3600000

pure def probeResponseMs(slop: bool, timeQuestion: bool): int =
  if (slop or timeQuestion) shortProbeResponseMs else genericProbeResponseMs

pure def lawASentProbeIsOpenForItsWholeWindow(slop: bool, timeQuestion: bool, sentAt: int, asOf: int, sendDeadline: int): bool =
  (asOf < sentAt + probeResponseMs(slop, timeQuestion))
    implies not(probeExpired(asOf, probeExpiryDeadline(true, sentAt + probeResponseMs(slop, timeQuestion), sendDeadline)))

pure def lawAGenericProbeIsStillOpenAfterOneDay(sentAt: int, sendDeadline: int): bool =
  not(probeExpired(sentAt + 24 * 3600000, probeExpiryDeadline(true, sentAt + probeResponseMs(false, false), sendDeadline)))
    and probeExpired(sentAt + 48 * 3600000, probeExpiryDeadline(true, sentAt + probeResponseMs(false, false), sendDeadline))

pure def lawASlopProbeOrTimeQuestionEndsAfterOneDay(slop: bool, timeQuestion: bool, sentAt: int, sendDeadline: int): bool =
  (slop or timeQuestion)
    implies probeExpired(sentAt + 24 * 3600000, probeExpiryDeadline(true, sentAt + probeResponseMs(slop, timeQuestion), sendDeadline))

pure def canRecordReply(participant: ParticipantProbe): bool = participant.phase == AwaitingReply
pure def recordReply(participant: ParticipantProbe, agreed: bool): ParticipantProbe =
  { ...participant, phase: if (agreed) Available else Unavailable }

pure def needsOtherTimes(offeredTimes: bool, pickedTimes: bool): bool = offeredTimes and not(pickedTimes)
pure def shouldLookForOtherTimes(offeredTimes: bool, pickedTimes: bool, offeredAgain: bool): bool =
  needsOtherTimes(offeredTimes, pickedTimes) and not(offeredAgain)

pure def canOfferOtherTimes(participant: ParticipantProbe, hasFreshTimes: bool): bool =
  participant.phase == Available and hasFreshTimes

pure def offerOtherTimes(participant: ParticipantProbe, hasFreshTimes: bool): ParticipantProbe = { ...participant, phase: AwaitingReply }

pure def probeExpiryDeadline(sent: bool, responseDeadline: int, sendDeadline: int): int =
  if (sent) responseDeadline else sendDeadline

pure def probeExpired(asOf: int, deadline: int): bool = asOf >= deadline

pure def canExpireProbe(participant: ParticipantProbe, expired: bool): bool = participant.phase == AwaitingReply and expired
pure def expireProbe(participant: ParticipantProbe, expired: bool, timeQuestion: bool): ParticipantProbe =
  { ...participant, phase: if (timeQuestion) Available else Unavailable }

pure def stepUnavailableNeverReopens(before: ParticipantProbe, after: ParticipantProbe): bool =
  before.phase == Unavailable implies after.phase == Unavailable

pure def sometimesAgreed(participant: ParticipantProbe): bool = participant.phase == Available
pure def sometimesSettledNo(participant: ParticipantProbe): bool = participant.phase == Unavailable
```

### A Slop answer follows acceptance of the exact question

A reviewed Slop probe or its replacement time question can receive an answer only after the transport accepted that exact app, opportunity, and recipient's question. A pending queue row and an unresolved collected reply grant no authority to accept an answer. A direct response received before acceptance cannot settle the probe if it reaches the service later. The local simulator may record its own accepted delivery.

```quint
pure def slopProbeReplyCurrent(direct: bool, transportAccepted: bool, receivedAt: int, acceptedAt: int): bool =
  direct and transportAccepted and receivedAt >= acceptedAt

pure def lawSlopProbeNeedsAcceptance(direct: bool, receivedAt: int, acceptedAt: int): bool =
  not(slopProbeReplyCurrent(direct, false, receivedAt, acceptedAt))
```

### A replacement keeps the requester or hiring manager and all eligible group members

If a requester or hiring manager becomes unavailable, close the opportunity. Otherwise try up to three replacements over the life of the opportunity. An alternate must be eligible and have neither a conflicting first name nor a block, avoid rule, or disqualifying prior pair with anyone staying. Try alternates in order. If no alternate is accepted, a group can continue after removing the unavailable member when at least three members remain available to participate. Close all other opportunities. A replacement roster that the approval did not cover closes the item (`replacement_not_judged`): the approval covers the reviewed roster and each roster with one listed swap, and nothing else. A planned activity is different: its bench members are in the reviewed roster as alternates, and the judge read the probe of each bench member, so a bench member who fills a seat or joins late is covered; a plan fills its seats from the bench and does not swap one member for another. Changed (owner decision 2026-11-22, D15 to D17): a replacement went out without a new review -> the judge approves only the rosters that its packet lists and a second swap closes the item, because nobody read that roster.

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

import opportunityLifecycle as Opportunity from "./opportunityLifecycle"

pure def groupMayRemainWithoutAlternate(group: bool, remaining: int): bool =
  group and Opportunity::groupCanContinue(remaining)

pure def lawOneToOneClosesWithoutAlternate(remaining: int): bool =
  not(groupMayRemainWithoutAlternate(false, remaining))

pure def lawRequiredParticipantCannotBeReplaced(probing: bool, requesterOut: bool, managerOut: bool): bool =
  (requesterOut or managerOut) implies replacementRoute(probing, requesterOut, managerOut) != FindAlternate

type NoAlternateRoute = ContinueGroup | CloseWithoutAlternate

pure def noAlternateRoute(group: bool, remaining: int): NoAlternateRoute =
  if (group and remaining >= 3) ContinueGroup else CloseWithoutAlternate

pure def lawPairClosesWithoutAlternate(remaining: int): bool =
  noAlternateRoute(false, remaining) == CloseWithoutAlternate

pure def lawGroupBelowThreeCloses(remaining: int): bool =
  (remaining < 3) implies noAlternateRoute(true, remaining) == CloseWithoutAlternate

pure def replacementJudged(rosterListed: bool): bool = rosterListed

pure def lawUnjudgedRosterNeverProbes(rosterListed: bool): bool =
  not(rosterListed) implies not(replacementJudged(rosterListed))

pure val rosterListedValues = Set(false, true)
```

### A replacement asks again every member who heard about the earlier roster

A probe and a yes answer one arrangement: the roster revision that the probe described. When an alternate joins an introduction or an activity-partner plan, the roster revision goes up by one. Each member who stays and got a probe of the earlier roster goes back to the queue, whether they said yes or have not answered yet: their earlier answer no longer counts, and they get a new probe in their turn. A turn that opened but whose probe has not gone out also goes back to the queue, so that its probe is written again for the new roster. When the first participant is asked again or was the one replaced, the first turn goes to a member who is asked again, so the alternate gets a probe only after that member agreed again. A prior request that the Network used without a probe moves to the new revision, because no probe described the other person. An unavailable member stays unavailable. When a group continues without an alternate, the roster revision does not change, because nobody joins whom a member was not asked about. A group plan probe describes no single person and says that the Network shares who is coming when enough people say yes, so a backfill there keeps the yeses, with an alternate who leaves the words of each probe unchanged (the rule below). The alternate joins with a queued turn about the new roster revision. After the change, no member who heard about the earlier roster has a yes to the new one. The alternate's join is a transition of the probe state, and the law over the roster change says what the reveal relies on. Changed (audit OPP18): a yes, a waiting probe and an unsent probe carried over to the replacement, and the Network cleared an unprobed prior request -> each is voided or moved as above, because the replacement learned the member's first name and a requester got the wrong question.

```quint
pure def canChangeRoster(participant: ParticipantProbe): bool = true
pure def changeRoster(participant: ParticipantProbe): ParticipantProbe =
  val newRoster = participant.roster + 1
  if (participant.phase == Unavailable or participant.phase == OutsideProbe) { ...participant, roster: newRoster }
  else if (participant.told or participant.phase == AwaitingReply) { phase: Queued, roster: newRoster, about: newRoster, told: false }
  else { ...participant, roster: newRoster, about: newRoster }

pure def stepARosterChangeVoidsEveryEarlierProbe(before: ParticipantProbe, via: str, after: ParticipantProbe): bool =
  (via == "changeRoster" and (before.phase == AwaitingReply or (before.phase == Available and before.told)))
    implies (after.phase == Queued and not(after.told))

pure def stepOnlyARosterChangeMovesTheRoster(before: ParticipantProbe, via: str, after: ParticipantProbe): bool =
  ((via != "changeRoster" and via != "joinRoster") implies after.roster == before.roster) and
  (via == "changeRoster" implies after.roster == before.roster + 1)

pure def lawNoMemberWhoHeardTheEarlierRosterHasAgreedToTheNewOne(participant: ParticipantProbe): bool =
  (participant.told or participant.phase == AwaitingReply)
    implies not(agreedToRoster(changeRoster(participant), participant.roster + 1))

pure def canJoinRoster(participant: ParticipantProbe, roster: int): bool =
  participant.phase == Queued and not(participant.told) and participant.roster == 0 and participant.about == 0 and roster >= 0
pure def joinRoster(participant: ParticipantProbe, roster: int): ParticipantProbe =
  { phase: Queued, roster: roster, about: roster, told: false }

pure def stepAnAlternateJoinsQueuedForTheCurrentRoster(before: ParticipantProbe, via: str, after: ParticipantProbe): bool =
  via == "joinRoster" implies (after.phase == Queued and not(after.told) and after.about == after.roster)

pure def sometimesAgreedAgainAfterARosterChange(participant: ParticipantProbe): bool =
  participant.phase == Available and participant.told and participant.roster > 0
```

### Nobody is introduced without a yes to the current roster

An introduction goes ahead only when every current participant is available and their yes is about the current roster revision of the opportunity. A yes about an earlier revision never counts. An open turn and a yes are always about the participant's current roster revision, a queued turn has no probe that went out, and the revision a participant answered is never ahead of the roster. Changed (audit OPP18): the reveal read a separate list of members asked again -> it checks the roster revision of each yes, because a yes about an earlier roster counted.

```quint
pure def agreedToRoster(participant: ParticipantProbe, roster: int): bool =
  participant.phase == Available and participant.roster == roster and participant.about == roster

pure def lawAYesAboutAnEarlierRosterDoesNotCount(participant: ParticipantProbe, roster: int): bool =
  participant.about != roster implies not(agreedToRoster(participant, roster))

pure def alwaysAnOpenTurnIsAboutTheCurrentRoster(participant: ParticipantProbe): bool =
  (participant.phase == Queued or participant.phase == AwaitingReply or participant.phase == Available)
    implies participant.about == participant.roster

pure def alwaysAQueuedTurnHasNoProbe(participant: ParticipantProbe): bool =
  participant.phase == Queued implies not(participant.told)

pure def alwaysTheAnswerIsNotAheadOfTheRoster(participant: ParticipantProbe): bool =
  participant.about <= participant.roster
```

### A queued probe goes out only for the roster that it describes

A probe can wait in the delivery queue after the Network wrote it. While the roster of the opportunity has never changed, a queued probe is current. After a change, a queued probe goes out only when it is the probe that the Network sent for the member's current turn, or the time question that the member's current turn waits on; a probe written for an earlier roster is refused. The rule holds for every probe and time question of a one-to-one opportunity, an invite or not: a requester's own confirmation and time question also describe the other person. Changed (audit OPP18): a probe written for the earlier roster, or a requester's confirmation or time question, still went out after a replacement -> the queue refuses every probe that is not for the current turn, because it described the earlier roster.

```quint
pure def queuedProbeCurrent(rosterChanged: bool, currentTurnProbe: bool): bool =
  not(rosterChanged) or currentTurnProbe

pure def lawAnEarlierRosterProbeIsRefused(rosterChanged: bool): bool =
  rosterChanged implies not(queuedProbeCurrent(rosterChanged, false))
```

### A group plan backfill keeps the words that each member heard

A group plan probe names the activity, the place, the time and the number of others, and it can say what all the others are into. A backfill keeps the earlier yeses and waiting probes only when every member who got the probe would get the same words about the new group. An alternate who changes those words for any such member is skipped, and the next alternate on the bench is tried; when nobody got the probe yet, any alternate can join. Changed (audit OPP18): a backfill could bring in someone who did not share the interest that the probe named -> such an alternate is skipped, because a yes counted for a group that the probe described differently.

```quint
pure def groupBackfillKeepsYeses(heard: int, describedAlike: int): bool =
  heard <= describedAlike

pure def lawAnAlternateWhoChangesTheWordsIsSkipped(heard: int, describedAlike: int): bool =
  describedAlike < heard implies not(groupBackfillKeepsYeses(heard, describedAlike))

pure def lawAnyAlternateCanJoinBeforeAProbe(describedAlike: int): bool =
  describedAlike >= 0 implies groupBackfillKeepsYeses(0, describedAlike)
```

### An activity-partner plan asks the member who agreed again before its alternate

When the partner of an activity-partner plan declines and an alternate is next, the roster changes as for an introduction. When a member who stays is asked again, their plan answer goes back to pending, the alternate waits at the front of the bench, and the alternate gets a probe only after that member says yes again. When nobody is asked again, the alternate is asked at once. A new probe to a member asked again uses the daily cap, not the weekly plan allowance that the first probe used. Changed (audit OPP18): the shell decided the order of the bench -> this rule decides it, because the shell must not compute a decision.

```quint
type PartnerBackfill = { bench: List[str], askAlternate: bool }

pure def partnerPlanBackfill(bench: List[str], alternate: str, askedAgain: int): PartnerBackfill =
  if (askedAgain > 0) { bench: List(alternate).concat(bench), askAlternate: false }
  else { bench: bench, askAlternate: true }

pure def lawTheAlternateWaitsForTheMemberAskedAgain(bench: List[str], alternate: str, askedAgain: int): bool =
  askedAgain > 0 implies (not(partnerPlanBackfill(bench, alternate, askedAgain).askAlternate)
    and partnerPlanBackfill(bench, alternate, askedAgain).bench.length() == bench.length() + 1
    and partnerPlanBackfill(bench, alternate, askedAgain).bench.head() == alternate)
```

### A reviewer can read each first probe of the open revision

Staff who can read the review queue can read, for one review revision, the words of the first probe that each participant would get if their turn opened at that time, and the generic text that the leak guard sends instead when the first text fails it. The Network chooses time options when the probe goes out, so the offered times can change; in a plan, a later member gets only the times that the earlier members picked. The same read also gives, for each participant, the words of the introduction that the participant would get if everyone said yes, with the same reason and names. The place and the time of an introduction are chosen at booking, so the read shows placeholders for them; a plan names its place and time, and shows a placeholder for the members who say yes. Approval also covers the reviewed alternates, and a replacement during probing goes out without a new review. So the read also gives, for each reviewed alternate and each participant whom that alternate can replace, the probe and introduction words that the alternate and every member who stays would get after that replacement, with the reasons written again for the new roster. A requester and a hiring manager are never replaced, and a job introduction closes instead of a replacement, so they have no such entry. The read is refused after the revision changes or at the review deadline. The review judge's packet carries the same texts, with each member's name written as a first name only. Changed (audits OPP20 and CRI13, owner decision 2026-11-22, D15 to D17): a reviewer approved the reasons and plan details without the words that members get, and staff read every item -> the read and the judge's packet carry the probe, introduction and replacement words, and staff read them only for a held item, because those words can quote facts about the others.

```quint
import reviewDeadline as ReviewWindow from "./reviewDeadline"

pure def reviewProbePreviewCurrent(pending: bool, seenRevision: int, currentRevision: int, currentTime: int, deadline: int): bool =
  pending and ReviewWindow::reviewRevisionCurrent(seenRevision, currentRevision) and not(ReviewWindow::reviewLate(currentTime, deadline))

pure def lawProbePreviewRefusesAnOlderRevision(currentTime: int, deadline: int, revision: int): bool =
  not(reviewProbePreviewCurrent(true, revision, revision + 1, currentTime, deadline))

pure def lawProbePreviewClosesAtTheDeadline(revision: int, deadline: int): bool =
  not(reviewProbePreviewCurrent(true, revision, revision, deadline, deadline))
```
