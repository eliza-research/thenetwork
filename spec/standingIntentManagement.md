# Manage your standing intents

[Story F9](product/stories.md#story-f9--keep-a-standing-intent) lets a member list, pause, resume, keep and close the things the Network looks for, and undo a change for one day. A standing thing is a learned want, a stored intent (a cofounder goal included), a people request with no learned want, or a peon job posting. Availability and preferences that matching reads filter work but do not start it: a newer statement replaces an older one, an omission changes nothing, and removal is the REMOVE FACT draft and confirm. The [freshness rules](standingIntent.md) supply the active deadline. The shell binds the command to the canonical member of the current app, lists only the member's rows, and stores controls in that network's persisted member state. The row write checks the stored status and the member and app scope it read: if the stored status changes or the row leaves that scope before the write, the whole transaction fails.

## Story: See and manage the things the Network is looking for

> As a member, I want to list, pause, resume, keep and close the things the Network looks for, and undo a change for one day.

### Only the canonical member can list or manage the app's own intents

Use a member turn with current membership and consent. A refused command never creates a membership. A matching replay requires that the same member still owns the app binding. A list shows only the member's own live and paused standing things in this app (learned wants, intents, requests and job posts), each with a stable letter-only reference, a list number and its current status. The reference alphabet keeps generated references from matching the phone-number check. A job posting is on the list, but its close uses the posting read-back and it cannot be paused. An UNDO asks for the newest open change and goes to the reply rule below. A refused command takes no reply. A refused bare CLOSE or KEEP (no reference and no number) and a refused UNDO go on to the ordinary turn, because the same words are ordinary text, and a member who is not active yet (for example still onboarding) must still be heard. A refused list, reference or number command, and every refused pause or resume, stays handled with no reply. For a sender who is not a member, the same bare words are not an account command, so the join flow answers them. Changed (owner decision 2026-11-22, D5): the commands only listed, paused and closed learned wants and intents -> they also resume, keep and undo, and the list also shows requests and job posts, because a member could not see, turn back on or end a request or a post from the thread.

```quint
type IntentCommand = ListIntents | PauseIntent | CloseIntent | ResumeIntent | KeepIntent | UndoIntent
type IntentCommandPhase = AwaitingMember | ShowIntents | SelectIntent | MemberRefused |
  UnknownIntent | AmbiguousIntent | IntentUnchanged | PauseSelected | CloseSelected |
  ResumeSelected | KeepSelected | UndoRequested
type IntentManagement = { phase: IntentCommandPhase, command: IntentCommand }

pure val initial: IntentManagement = { phase: AwaitingMember, command: ListIntents }

pure def intentManagementAllowed(canonicalMembership: bool, ownNetworkMember: bool, optedOut: bool): bool =
  canonicalMembership and ownNetworkMember and not(optedOut)

pure def canAuthorizeIntentCommand(s: IntentManagement): bool = s.phase == AwaitingMember
pure def authorizeIntentCommand(s: IntentManagement, allowed: bool, command: IntentCommand): IntentManagement =
  { command: command, phase: if (not(allowed)) MemberRefused else if (command == ListIntents) ShowIntents
    else if (command == UndoIntent) UndoRequested else SelectIntent }

pure def standingIntentReplayAllowed(canonicalMember: bool): bool = canonicalMember

pure def refusedCommandPasses(command: IntentCommand, bareReply: bool): bool =
  command == UndoIntent or (bareReply and (command == CloseIntent or command == KeepIntent))

pure def lawRefusedListPauseAndResumeStayHandled(bareReply: bool): bool =
  not(refusedCommandPasses(ListIntents, bareReply)) and not(refusedCommandPasses(PauseIntent, bareReply))
    and not(refusedCommandPasses(ResumeIntent, bareReply))

pure def lawRefusedReferenceCommandStaysHandled(command: IntentCommand): bool =
  command != UndoIntent implies not(refusedCommandPasses(command, false))

pure def lawRefusedUndoPasses(bareReply: bool): bool = refusedCommandPasses(UndoIntent, bareReply)
```

### Change only the single thing the member named

The member names a thing by its reference, by a number of the current list, or by a bare reply to the open question. The old hexadecimal reference and the current letter-only reference resolve to the same owned thing, in the thread and from the member's agent. Pause a live thing. Resume a paused thing. Close or keep a live or paused thing. A missing or ambiguous name leaves every thing unchanged. A bare reply names the whole group of things in the open question as one selection, because the text it answers named them together; the shell then counts one match when any thing of the group is still on the list. An already paused, closed, or expired intent stays as it is when the requested action has already taken effect. Store the selected change before acknowledging it. A stored close takes priority over a pause, so a closed thing cannot be resumed. Changed (owner decision 2026-11-22): resume and keep are new selections, because before a member could not turn a paused thing back on or renew a want before its deadline.

```quint
pure def canChooseOwnedIntent(s: IntentManagement): bool = s.phase == SelectIntent
pure def chooseOwnedIntent(s: IntentManagement, matches: int, live: bool, paused: bool): IntentManagement =
  { ...s, phase: if (matches == 0) UnknownIntent
    else if (matches != 1) AmbiguousIntent
    else if (s.command == PauseIntent and live) PauseSelected
    else if (s.command == CloseIntent and (live or paused)) CloseSelected
    else if (s.command == ResumeIntent and paused) ResumeSelected
    else if (s.command == KeepIntent and (live or paused)) KeepSelected
    else IntentUnchanged }

pure val matchesValues = Set(0, 1, 2)

type IntentControl = PauseControl | CloseControl

pure def effectiveStandingControl(storedStatus: str, control: IntentControl): IntentControl =
  if (storedStatus == "closed" or control == CloseControl) CloseControl else PauseControl

pure def stepChangeRequiresSelection(before: IntentManagement, after: IntentManagement): bool =
  (before.phase != after.phase and (after.phase == PauseSelected or after.phase == CloseSelected
    or after.phase == ResumeSelected or after.phase == KeepSelected)) implies before.phase == SelectIntent

pure def sometimesPausesAnIntent(s: IntentManagement): bool = s.phase == PauseSelected
pure def sometimesClosesAnIntent(s: IntentManagement): bool = s.phase == CloseSelected
pure def sometimesResumesAnIntent(s: IntentManagement): bool = s.phase == ResumeSelected
```

### Commit a stored intent change with its acknowledgment

A selected stored intent writes to the same member's row in the current app in the transaction that saves the control and acknowledgment, but only when a pause, a close or a resume is selected, or a keep of a paused row. A resume and a keep write the status active. A learned want, a request and their controls stay in member state. Controls saved before row updates began still apply. Changed (owner decision 2026-11-22): a resume and a keep of a paused row now write the row back to active, because a paused row must come back on with the member's word.

```quint
pure def writesStandingIntentRow(s: IntentManagement, stored: bool, paused: bool): bool =
  stored and (s.phase == PauseSelected or s.phase == CloseSelected or s.phase == ResumeSelected
    or (s.phase == KeepSelected and paused))
```

### Only the member's own words close a standing thing

A standing change has a source. The member's own text in the thread, also inside a gateway turn, is MemberThread. A connector call of pause_looking_for or resume_looking_for by the member's own authorized assistant is MemberAgent. Profile text that an assistant sent with submit_profile or with the join about text is AssistantProfile. The member's own words add, pause, resume and close at once. A close asks first when an introduction for the thing is in progress: someone other than the member got a probe for a linked opportunity that is still probing. The answer to that question is a confirmed close. The member's agent may only pause or resume, at most three applied changes for one member in 24 hours across all grants. Profile text may only add, and not a thing that the member closed in the last 30 days. A negation in profile text becomes a check_with_person hint to the agent, and changes nothing. Saying less never ends anything: the service does not compare a new text with an older one, so a missing want, a truncated text, a paraphrase and a replay end nothing. Staff and time are outside this rule; the audited posting close, safety holds and the existing deadlines apply as before. Changed (owner decision 2026-11-22): before this rule, assistant profile text that stated a want next to a negation withdrew the want and closed its opportunity, and the member was not told; now profile text only adds, because a rewrite or a paraphrase is not the member's decision.

```quint
type StandingSource = MemberThread | MemberAgent | AssistantProfile
type StandingChange = AddStanding | PauseStanding | ResumeStanding | CloseStanding
type StandingOutcome = ApplyNow | ConfirmFirst | RefuseChange

pure val agentDailyChangeLimit: int = 3
pure val recentCloseDays: int = 30

pure def standingChangeOutcome(source: StandingSource, change: StandingChange, inProgress: bool, confirmed: bool,
    agentChangesToday: int, closedDaysAgo: int): StandingOutcome =
  if (source == MemberThread)
    (if (change == CloseStanding and inProgress and not(confirmed)) ConfirmFirst else ApplyNow)
  else if (source == MemberAgent)
    (if ((change == PauseStanding or change == ResumeStanding) and agentChangesToday < agentDailyChangeLimit) ApplyNow else RefuseChange)
  else
    (if (change == AddStanding and (closedDaysAgo < 0 or closedDaysAgo >= recentCloseDays)) ApplyNow else RefuseChange)

pure val agentChangesTodayValues = Set(0, 2, 3, 4)
pure val closedDaysAgoValues = Set(-1, 0, 29, 30, 31)

pure def lawAssistantProfileOnlyAdds(change: StandingChange, inProgress: bool, confirmed: bool, agentChangesToday: int, closedDaysAgo: int): bool =
  change != AddStanding implies standingChangeOutcome(AssistantProfile, change, inProgress, confirmed, agentChangesToday, closedDaysAgo) == RefuseChange

pure def lawRecentCloseBlocksProfileAdd(inProgress: bool, confirmed: bool, agentChangesToday: int, closedDaysAgo: int): bool =
  (closedDaysAgo >= 0 and closedDaysAgo < recentCloseDays) implies
    standingChangeOutcome(AssistantProfile, AddStanding, inProgress, confirmed, agentChangesToday, closedDaysAgo) == RefuseChange

pure def lawAgentNeverAddsOrCloses(change: StandingChange, inProgress: bool, confirmed: bool, agentChangesToday: int, closedDaysAgo: int): bool =
  (change == AddStanding or change == CloseStanding) implies
    standingChangeOutcome(MemberAgent, change, inProgress, confirmed, agentChangesToday, closedDaysAgo) == RefuseChange

pure def lawAgentChangesAreBounded(change: StandingChange, inProgress: bool, confirmed: bool, agentChangesToday: int, closedDaysAgo: int): bool =
  agentChangesToday >= agentDailyChangeLimit implies
    standingChangeOutcome(MemberAgent, change, inProgress, confirmed, agentChangesToday, closedDaysAgo) == RefuseChange

pure def lawInProgressCloseAsksFirst(agentChangesToday: int, closedDaysAgo: int): bool =
  standingChangeOutcome(MemberThread, CloseStanding, true, false, agentChangesToday, closedDaysAgo) == ConfirmFirst

pure def lawOnlyAnsweredMemberWordsCloseInProgress(source: StandingSource, confirmed: bool, agentChangesToday: int, closedDaysAgo: int): bool =
  standingChangeOutcome(source, CloseStanding, true, confirmed, agentChangesToday, closedDaysAgo) == ApplyNow
    implies (source == MemberThread and confirmed)
```

### Saying a want again changes nothing that the member paused or closed

An add names every standing thing of the member that is the same want: a thing with a desire is the same want as a new ask with the same desire; a request with no desire is the same want as a new ask with no desire in the same category that shares a tag with it, or when neither has a tag. A paused or recently closed request with no desire is found by this identity, although the new ask would get a new request id. An add that the standing change rule refuses changes nothing; profile text then gives the agent a check_with_person hint when a recent close refused it. A paused thing stays paused for every source: profile text changes nothing, and the member's own ask gets an answer that it is paused and how to turn it back on, with no new request and no new statement time. A closed thing reopens only from a request in the member's own words or, after 30 days, a request in profile text, and that request gets the normal request answer; a mention of a closed want in a message that is not a request reopens nothing. Changed (owner decision 2026-11-22): before this rule, a profile text or a thread ask of a paused want opened a new search beside the pause, a closed request with no desire came back at once as a new request, and a mere mention of a closed want reopened it with no word to the member; now only an explicit resume ends a pause and only an explicit request ends a close.

```quint
type StandingAddRoute = AddOpens | AddReopens | AddKeepsPause | AddKeepsClose | AddRefused

pure def sameStandingWant(desireNamed: bool, sameDesire: bool, sameCategory: bool, sharedTags: int, untagged: bool): bool =
  if (desireNamed) sameDesire else (sameCategory and (sharedTags > 0 or untagged))

pure def standingAddRoute(source: StandingSource, request: bool, paused: bool, closed: bool, closedDaysAgo: int): StandingAddRoute =
  if (standingChangeOutcome(source, AddStanding, false, false, 0, closedDaysAgo) != ApplyNow) AddRefused
  else if (closed) (if (request) AddReopens else AddKeepsClose)
  else if (paused) AddKeepsPause
  else AddOpens

pure val sharedTagsValues = Set(0, 1, 2)

pure def lawDifferentCategoryIsAnotherWant(sharedTags: int, untagged: bool): bool =
  not(sameStandingWant(false, true, false, sharedTags, untagged))

pure def lawNamedDesireDecidesTheWant(sameDesire: bool, sameCategory: bool, sharedTags: int, untagged: bool): bool =
  sameStandingWant(true, sameDesire, sameCategory, sharedTags, untagged) == sameDesire

pure def lawAddNeverEndsAPause(source: StandingSource, request: bool, closedDaysAgo: int): bool =
  standingAddRoute(source, request, true, false, closedDaysAgo) != AddOpens
    and standingAddRoute(source, request, true, false, closedDaysAgo) != AddReopens

pure def lawMentionNeverReopens(source: StandingSource, paused: bool, closedDaysAgo: int): bool =
  standingAddRoute(source, false, paused, true, closedDaysAgo) != AddReopens
    and standingAddRoute(source, false, paused, true, closedDaysAgo) != AddOpens

pure def lawRecentCloseRefusesProfileAdd(request: bool, paused: bool, closed: bool, closedDaysAgo: int): bool =
  (closedDaysAgo >= 0 and closedDaysAgo < recentCloseDays) implies
    standingAddRoute(AssistantProfile, request, paused, closed, closedDaysAgo) == AddRefused

pure def lawAgentNeverAdds(request: bool, paused: bool, closed: bool, closedDaysAgo: int): bool =
  standingAddRoute(MemberAgent, request, paused, closed, closedDaysAgo) == AddRefused
```

### Reconcile older saved controls during the first normal save

Older controls may exist only in the previous saved member state. The first normal save reconciles them with the currently owned rows in the same app and home runtime. A row must belong to the same active member and have existed when that state was saved. A job posting, expired row, unknown owner, or newer row keeps its stored status. Apply only a change from active to paused or closed, or from paused to closed. Keep the original creation time and deadline. Save the completion marker and any row changes in one transaction. Historical or learned controls remain in member state.

```quint
type LegacyIntentChange = KeepIntentStatus | ReconcilePause | ReconcileClose

pure def legacyIntentReconciliationDue(savedState: bool, completed: bool): bool =
  savedState and not(completed)

pure def reconcileLegacyIntent(storedStatus: str, control: IntentControl, ownerActive: bool, hadRowAtSave: bool, withinHorizon: bool, job: bool): LegacyIntentChange =
  if (not(ownerActive and hadRowAtSave and withinHorizon) or job) KeepIntentStatus
  else if (storedStatus == "active" and control == PauseControl) ReconcilePause
  else if ((storedStatus == "active" or storedStatus == "paused") and control == CloseControl) ReconcileClose
  else KeepIntentStatus

pure val storedStatusValues = Set("active", "paused", "closed", "retired")

pure def lawLegacyReconciliationNeverUncloses(control: IntentControl, ownerActive: bool, hadRowAtSave: bool, withinHorizon: bool, job: bool): bool =
  reconcileLegacyIntent("closed", control, ownerActive, hadRowAtSave, withinHorizon, job) == KeepIntentStatus

pure def lawLegacyReconciliationKeepsIneligible(storedStatus: str, control: IntentControl, ownerActive: bool, hadRowAtSave: bool, withinHorizon: bool, job: bool): bool =
  (not(ownerActive and hadRowAtSave and withinHorizon) or job) implies
    reconcileLegacyIntent(storedStatus, control, ownerActive, hadRowAtSave, withinHorizon, job) == KeepIntentStatus
```

### A pause or close stops only the work linked to that thing

A linked opportunity of a want is the opportunity of each request of the member for that want that is not withdrawn, and each opportunity anchored to the matching stored intent. A linked opportunity of a stored intent is anchored to it, and of a request it is the request's own. A pause by the member or the agent and a close retire a linked opportunity in review: nobody else knew of it. Only a close by the member's own words retires a linked opportunity in probing. Each other person who got a probe for it and said yes hears one short note that names nobody, and a late reply to a probe that ended gets the existing quiet answer. A pause keeps an opportunity in probing, so a pause can be undone without anyone else being affected. Profile text retires nothing. A scheduled or completed meeting and a relay after an introduction stay in their own consent and cancellation flow. Stop searches for the same named desire when it has no other live record. Preserve transport send holds and outstanding replies. Changed (owner decision 2026-11-22): before, a pause also retired an opportunity in probing; now a pause retires only work in review, so a pause can be undone without anyone else being affected.

```quint
pure def retireStandingOpportunity(linked: bool, source: StandingSource, control: IntentControl, stage: str): bool =
  linked and source != AssistantProfile and
    (stage == "review" or (stage == "probing" and control == CloseControl and source == MemberThread))

pure val stageValues = Set("review", "probing", "scheduled", "closed")

pure def lawPauseNeverRetiresAContact(linked: bool, source: StandingSource, stage: str): bool =
  stage != "review" implies not(retireStandingOpportunity(linked, source, PauseControl, stage))

pure def lawBookedWorkStays(linked: bool, source: StandingSource, control: IntentControl): bool =
  not(retireStandingOpportunity(linked, source, control, "scheduled"))

pure def lawAgentNeverRetiresAContact(linked: bool, control: IntentControl): bool =
  not(retireStandingOpportunity(linked, MemberAgent, control, "probing"))

pure def retireIntentSearch(recognizedDesire: bool, stillLive: bool): bool = recognizedDesire and not(stillLive)
```

### A bare reply answers only the newest open standing question

The member's state keeps one open standing record: the newest change or question replaces the older one. UNDO applies for 24 hours to a close by the member, a pause by the member or the agent, and a resume by the agent. CLOSE applies for 72 hours to a pause and to an asked question. It is a confirmed close only when the text it answers named the introduction in progress: the ask before a close, or a pause text that said an introduction continues. A CLOSE to the renewal question or to a pause text that named no introduction is not a confirmation, so an introduction in progress then gets the ask first. KEEP applies for 72 hours to an asked question. A reply that applies clears the record. A reply that applies to nothing is not a standing command: a bare CLOSE or KEEP goes on to the normal turn, and a bare UNDO says that there is nothing to undo. An opportunity that a change retired stays closed after an UNDO. Changed (owner decision 2026-11-22): this rule is new, because a member needs a short way to take back a change that a misread or the agent made. A CLOSE now confirms only an answer to a text that named the introduction, because the renewal question never names one and a member must not close an introduction that no text told them about.

```quint
type StandingPendingKind = NoStandingPending | ClosedByMember | PausedByMember | PausedByAgent | ResumedByAgent | CloseAsked | RenewalAsked
type StandingReply = UndoReply | CloseReply | KeepReply

pure val standingUndoWindowMs: int = 86400000
pure val standingAskLifetimeMs: int = 259200000

pure def standingReplyApplies(pending: StandingPendingKind, reply: StandingReply, ageMs: int): bool =
  if (ageMs < 0) false
  else if (reply == UndoReply)
    (pending == ClosedByMember or pending == PausedByMember or pending == PausedByAgent or pending == ResumedByAgent) and ageMs < standingUndoWindowMs
  else if (reply == CloseReply)
    (pending == PausedByMember or pending == PausedByAgent or pending == CloseAsked or pending == RenewalAsked) and ageMs < standingAskLifetimeMs
  else (pending == CloseAsked or pending == RenewalAsked) and ageMs < standingAskLifetimeMs

pure val ageMsValues = Set(-1, 0, 86399999, 86400000, 259199999, 259200000)

pure def lawNothingPendingTakesNoReply(reply: StandingReply, ageMs: int): bool =
  not(standingReplyApplies(NoStandingPending, reply, ageMs))

pure def lawUndoLastsOneDay(pending: StandingPendingKind): bool =
  not(standingReplyApplies(pending, UndoReply, standingUndoWindowMs))

pure def lawQuestionsLapse(pending: StandingPendingKind, reply: StandingReply): bool =
  not(standingReplyApplies(pending, reply, standingAskLifetimeMs))

pure def lawClosedIsNotClosedAgain(ageMs: int): bool =
  not(standingReplyApplies(ClosedByMember, CloseReply, ageMs))

pure def standingCloseConfirmed(pending: StandingPendingKind, introNamed: bool): bool =
  pending == CloseAsked or ((pending == PausedByMember or pending == PausedByAgent) and introNamed)

pure def lawRenewalAnswerIsNotAConfirmation(introNamed: bool): bool =
  not(standingCloseConfirmed(RenewalAsked, introNamed))

pure def lawSilentPauseIsNotAConfirmation(pending: StandingPendingKind): bool =
  pending != CloseAsked implies not(standingCloseConfirmed(pending, false))
```

### A list number names a thing for one day

The list keeps the keys it showed, in order, on all pages. A number names the thing at that position for 24 hours after the list was shown, and only inside the list. A later list replaces the numbers. An older number gets the out-of-date answer and changes nothing. Changed (owner decision 2026-11-22): this rule is new, because the list now gives numbers that a member can reply with.

```quint
pure val standingListLifetimeMs: int = 86400000

pure def standingListNumberCurrent(shownAgoMs: int, position: int, count: int): bool =
  shownAgoMs >= 0 and shownAgoMs < standingListLifetimeMs and position >= 1 and position <= count

pure val shownAgoMsValues = Set(-1, 0, 86399999, 86400000)
pure val positionValues = Set(0, 1, 2, 3)
pure val countValues = Set(0, 1, 2, 3)

pure def lawStaleListNumberRefused(position: int, count: int): bool =
  not(standingListNumberCurrent(standingListLifetimeMs, position, count))

pure def lawNumberInsideList(shownAgoMs: int, position: int, count: int): bool =
  standingListNumberCurrent(shownAgoMs, position, count) implies (position >= 1 and position <= count)
```
