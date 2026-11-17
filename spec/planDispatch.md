# Dispatch group plan invitations

The [whole plan model](models/plan_run.md) follows plan quorum, fallback, and late joins. This module controls dispatch for an already approved group plan. The Network reads member and calendar facts, checks the outreach allowance, and sends the rendered invitation through the existing safety and privacy checks.

## Story: Ask me about one group plan during my send window

> As a member, I want a plan invitation to arrive only when I am eligible, have room, and can answer without an earlier question getting in the way.

### Only an open plan can invite a pending member

An approved probing plan may invite before its probe deadline. A booked plan may invite another member through the late-join cutoff. Ask only members whose turn is pending and who have not been contacted about this plan. A queued invitation still needs an approved open lane and its exact pending seat when the provider claim runs.

```quint
pure def planLaneOpen(probing: bool, booked: bool, lateJoinOpen: bool): bool =
  probing or (booked and lateJoinOpen)

pure def planInvitationOpen(probing: bool, booked: bool, now: int, probeDeadline: int, lateJoinAt: int): bool =
  planLaneOpen(probing and now < probeDeadline, booked, now <= lateJoinAt)

pure def queuedPlanProbeAllowed(approvalCurrent: bool, pendingSeat: bool, laneOpen: bool): bool =
  approvalCurrent and pendingSeat and laneOpen

pure def planTurnDue(pending: bool, contacted: bool): bool = pending and not(contacted)

pure def lawBookedLaneRespectsLateJoinCutoff(booked: bool): bool =
  not(planLaneOpen(false, booked, false))

pure def lawProbingLaneClosesAtDeadline(deadline: int, lateJoinAt: int): bool =
  not(planInvitationOpen(true, false, deadline, deadline, lateJoinAt))
```

### A missing seat or an absence rules out the invitation

Check the member's current eligibility for the seat. A Friends replacement also needs current pair values with the other members still in the plan. A Friends partner invitation checks both partners under the [one-to-one rules](planDecision.md#both-friends-activity-partners-need-prior-group-attendance). If the seat is ineligible or the recipient will be away during the plan interval, the quorum runner treats this seat as unavailable. Eligible and present members proceed to the contact window checks.

```quint
type InvitePhase = CheckingSeat | CheckingPresence | CheckingAvailability | CheckingWindow | CheckingAllowance | RenderingInvite |
  SendingInvite | InviteSent | DeliveryNotConfirmed | Deferred | Unavailable
type PlanDispatch = { phase: InvitePhase, reason: str }

pure val initial: PlanDispatch = { phase: CheckingSeat, reason: "" }

pure def canCheckSeat(invite: PlanDispatch): bool = invite.phase == CheckingSeat
pure def checkSeat(invite: PlanDispatch, eligible: bool): PlanDispatch =
  if (eligible) { ...invite, phase: CheckingPresence } else { phase: Unavailable, reason: "seat" }

pure def canCheckPresence(invite: PlanDispatch): bool = invite.phase == CheckingPresence
pure def checkPresence(invite: PlanDispatch, present: bool): PlanDispatch =
  if (present) { ...invite, phase: CheckingAvailability } else { phase: Unavailable, reason: "away" }
```

### Recheck the member's current availability before contacting them

Apply the [same check-in rule as formation](planFormation.md#the-members-latest-weekly-answer-takes-precedence). A current calendar conflict also makes the seat unavailable. An unavailable seat can open a reviewed alternate without recording a member refusal. Recheck the recipient's stated window again on a persisted provider claim. This rule controls new invitations. A later explicit yes to a delivered invitation is still consent for its exact slot.

```quint
pure def canCheckAvailability(invite: PlanDispatch): bool = invite.phase == CheckingAvailability

pure def checkAvailability(invite: PlanDispatch, statedAllows: bool, calendarAllows: bool): PlanDispatch =
  if (statedAllows and calendarAllows) { ...invite, phase: CheckingWindow }
  else { phase: Unavailable, reason: "plan_availability_changed" }
```

### Wait for the send window, earlier questions, and the right allowance

If the member is busy with another opportunity, wait. Then check the send window, any outstanding question, and whether this member already got a plan invite that day. An unanswered onboarding question holds plan invites for the same period as [regular probes](probeDispatch.md#wait-for-the-members-send-window-and-current-availability). The first such result determines why the invite waits. Members who qualify for the separate allowance use it. Other members use the introduction allowance. An exhausted allowance defers the invite.

```quint
pure def canCheckWindow(invite: PlanDispatch): bool = invite.phase == CheckingWindow
pure def checkWindow(invite: PlanDispatch, busy: bool, windowOpen: bool, awaitingAnswer: bool, sentToday: bool): PlanDispatch =
  if (busy) { phase: Deferred, reason: "busy" }
  else if (not(windowOpen)) { phase: Deferred, reason: "send_window" }
  else if (awaitingAnswer) { phase: Deferred, reason: "one_question" }
  else if (sentToday) { phase: Deferred, reason: "one_a_day" }
  else { ...invite, phase: CheckingAllowance }

pure def canCheckAllowance(invite: PlanDispatch): bool = invite.phase == CheckingAllowance
pure def checkAllowance(invite: PlanDispatch, admitted: bool): PlanDispatch =
  if (admitted) { ...invite, phase: RenderingInvite } else { phase: Deferred, reason: "cap" }
```

### A usable message must be sent before the daily record changes

Render the invitation using the current roster, including promoted replacements. After booking, use the booked members and the pending recipient. If no usable anonymous message can be rendered for the member, the seat becomes unavailable. A rendered invitation goes through the normal send checks against that roster. Its outbound record keeps the approved opportunity ID so the queue can recheck its category and current state. Only a send confirmed by that path uses the daily slot and updates the selected allowance's counters.

```quint
pure def canRenderInvite(invite: PlanDispatch): bool = invite.phase == RenderingInvite
pure def renderInvite(invite: PlanDispatch, usable: bool): PlanDispatch =
  if (usable) { ...invite, phase: SendingInvite } else { phase: Unavailable, reason: "plan_copy" }

pure def canRecordSend(invite: PlanDispatch): bool = invite.phase == SendingInvite
pure def recordSend(invite: PlanDispatch, sent: bool): PlanDispatch =
  { ...invite, phase: if (sent) InviteSent else DeliveryNotConfirmed }

pure def stepAnInviteNeedsAConfirmedSend(before: PlanDispatch, via: str, after: PlanDispatch): bool =
  after.phase == InviteSent implies (via == "recordSend" and before.phase == SendingInvite)

pure def sometimesCanSendPlanInvite(invite: PlanDispatch): bool = invite.phase == InviteSent
```

### A reply requires acceptance of the exact plan invitation

Save the outbound message ID in the member's pending question. An answer can change the plan only after the provider has accepted that exact invitation for the member and plan. A reply received before acceptance stays ineligible when it arrives late. An older pending question without an ID can use a unique stored outbound invitation for the same member, plan and opening time.

```quint
pure def planProbeReplyCurrent(memberReply: bool, accepted: bool, receivedAt: int, acceptedAt: int, now: int): bool =
  memberReply and accepted and receivedAt >= acceptedAt and receivedAt <= now

pure def lawPlanReplyNeedsAcceptance(memberReply: bool, receivedAt: int, acceptedAt: int, now: int): bool =
  not(planProbeReplyCurrent(memberReply, false, receivedAt, acceptedAt, now))
```

### A terminal unsent invitation releases the exact pending seat

When the exact persisted invitation is known never to have gone out, clear its pending reply and apply the normal unavailable-seat rule. It can open a reviewed alternate before the deadline. Do not count it as a decline or unanswered invitation. A retry, a review hold or uncertain acceptance keeps the seat pending until the normal deadline.

```quint
type PendingPlanInviteDecision = WaitForPlanAnswer | PlanInviteUnsent | PlanAnswerExpired

pure def pendingPlanInviteDecision(staged: bool, knownUnsent: bool, responseExpired: bool): PendingPlanInviteDecision =
  if (not(staged)) WaitForPlanAnswer
  else if (knownUnsent) PlanInviteUnsent
  else if (responseExpired) PlanAnswerExpired
  else WaitForPlanAnswer

pure def lawUnsentIsDifferentFromAnExpiredReply(responseExpired: bool): bool =
  pendingPlanInviteDecision(true, true, responseExpired) == PlanInviteUnsent
```
