# Outreach policy

## Story: Limit unsolicited messages across apps

> As a member of several apps, I want a single daily limit on unsolicited messages.

### The default daily proactive limit is three across all apps

The Network uses one default limit per person across apps. The send path takes a slot under a database lock before it hands the message to the channel. Replies and other non-proactive messages do not use proactive slots.

```quint
pure val personDailyCap: int = 3
```

### An initial invitation fits the member's participation state budget

Each participation state has a budget of initial invitations: at most a limit of invitations inside a rolling window of days. An invitation that was sent less than the window before now counts against the budget. When the count reaches the limit, the send path refuses the next proactive invitation, and the eligibility path does not offer the member for a new opportunity. A plan invitation uses its own lane and is outside this budget. Changed (audit routing-r16-5): the send path and the eligibility path computed this decision by hand after the generated recipient verdict; they now call these generated predicates.

```quint
pure val inviteBudgetDayMs: int = 86400000

pure def initialInviteInBudgetWindow(sentAt: int, now: int, budgetWindowDays: int): bool =
  now - sentAt < budgetWindowDays * inviteBudgetDayMs

pure def initialInviteBudgetSpent(sentInBudgetWindow: int, budgetLimit: int): bool =
  sentInBudgetWindow >= budgetLimit

pure val sentInBudgetWindowValues = Set(0, 1, 2, 3, 4, 5)
pure val budgetLimitValues = Set(0, 1, 2, 4)
pure val budgetWindowDaysValues = Set(0, 1, 7, 30)

pure def lawZeroBudgetIsAlwaysSpent(sentInBudgetWindow: int): bool =
  sentInBudgetWindow >= 0 implies initialInviteBudgetSpent(sentInBudgetWindow, 0)

pure def lawBudgetBelowLimitIsOpen(sentInBudgetWindow: int, budgetLimit: int): bool =
  sentInBudgetWindow < budgetLimit implies not(initialInviteBudgetSpent(sentInBudgetWindow, budgetLimit))

pure def lawInvitationAtWindowEdgeLeavesTheWindow(sentAt: int, budgetWindowDays: int): bool =
  not(initialInviteInBudgetWindow(sentAt, sentAt + budgetWindowDays * inviteBudgetDayMs, budgetWindowDays))

pure def lawInvitationJustSentCounts(sentAt: int, budgetWindowDays: int): bool =
  budgetWindowDays > 0 implies initialInviteInBudgetWindow(sentAt, sentAt, budgetWindowDays)
```

## Story: Pause new offers after two unanswered invitations

> As a member, I want the agent to stop inviting me when I leave two invitations unanswered.

### Count a sent invitation at terminal expiry or after 72 hours

Keep one entry for the initial invitation to a member for an opportunity. A follow-up question, an unsent probe or a dispatch that the channel has yet to confirm does not count. A channel acceptance starts the clock. A terminal probe or plan deadline can mature the same entry earlier. A current message from the member's thread clears their unanswered entries, resets the thread counters, and updates the last engagement time. An assistant's profile submission can teach the profile or complete interview intake. It leaves the outreach pause, unanswered entries, thread counters, and response windows in place. The source test is the one inbound source predicate of the [job posting policy](postingPolicy.md), "Only the member's own text in the thread issues a command". Changed (audit POST-inbound-source): this module had its own copy of that predicate, and the inbound path called both copies on the same source; the copy is deleted. A stored entry from before delivery tracking uses its original recorded time.

```quint
pure val unansweredInviteWaitMs: int = 72 * 3600000
pure val unansweredInviteLimit: int = 2

pure def unansweredInviteCounts(accepted: bool, acceptedAt: int, expired: bool, expiredAt: int, now: int): bool =
  accepted and acceptedAt <= now and
    ((expired and acceptedAt <= expiredAt and expiredAt <= now) or now - acceptedAt >= unansweredInviteWaitMs)

pure def unansweredInvitePause(count: int): bool = count >= unansweredInviteLimit

pure def lawUnacceptedInvitationDoesNotCount(acceptedAt: int, expired: bool, expiredAt: int, now: int): bool =
  not(unansweredInviteCounts(false, acceptedAt, expired, expiredAt, now))

pure def lawInvitationCountsAtTerminalExpiry(acceptedAt: int, expiredAt: int): bool =
  acceptedAt <= expiredAt implies unansweredInviteCounts(true, acceptedAt, true, expiredAt, expiredAt)

pure def lawInvitationCountsAtWait(acceptedAt: int): bool =
  unansweredInviteCounts(true, acceptedAt, false, 0, acceptedAt + unansweredInviteWaitMs)

pure def lawTooFewInvitationsDoNotPause(count: int): bool =
  count < unansweredInviteLimit implies not(unansweredInvitePause(count))

pure def unansweredInviteCountAfterInbound(count: int, inbound: bool): int =
  if (inbound) 0 else count

import postingPolicy as Posting from "./postingPolicy"

pure def lawInboundMessageEndsThePause(count: int): bool =
  not(unansweredInvitePause(unansweredInviteCountAfterInbound(count, Posting::inboundMayCommand("thread"))))

pure def lawAssistantProfileKeepsUnanswered(count: int): bool =
  unansweredInviteCountAfterInbound(count, Posting::inboundMayCommand("mcp")) == count
```

### Re-engagement requires current evidence of silence

An adult who is in only-when-asked mode can receive one re-engagement after at least thirty days since their last inbound or outgoing ask. Require a held top-quartile opportunity from the last seven days. Check again when the send window opens. At dispatch, use the saved send and member state to check that the same pause and recent evidence still exist, that the last ask is the staged send, and that no new inbound has reset the silence. Ordinary consent and send checks still apply.

```quint
pure val reengagementSilenceMs: int = 30 * 86400000
pure val reengagementHighValueMs: int = 7 * 86400000
pure val reengagementDeliveryPrefix: str = "reengagement:"

pure def reengagementEvidenceCurrent(onlyWhenAsked: bool, heldHighAt: int, now: int): bool =
  onlyWhenAsked and heldHighAt > 0 and heldHighAt <= now and now - heldHighAt <= reengagementHighValueMs

pure def reengagementMayStage(onlyWhenAsked: bool, lastInbound: int, lastAsk: int, heldHighAt: int, now: int): bool =
  reengagementEvidenceCurrent(onlyWhenAsked, heldHighAt, now) and now - lastInbound >= reengagementSilenceMs and now - lastAsk >= reengagementSilenceMs

pure def reengagementMayDispatch(onlyWhenAsked: bool, used: bool, lastInbound: int, lastAsk: int, heldHighAt: int, stagedAt: int, now: int): bool =
  reengagementEvidenceCurrent(onlyWhenAsked, heldHighAt, now) and used and stagedAt <= now and lastAsk == stagedAt and stagedAt - lastInbound >= reengagementSilenceMs

pure def lawReplyStopsPendingReengagement(onlyWhenAsked: bool, used: bool, lastInbound: int, lastAsk: int, heldHighAt: int, stagedAt: int, now: int): bool =
  lastInbound >= stagedAt implies not(reengagementMayDispatch(onlyWhenAsked, used, lastInbound, lastAsk, heldHighAt, stagedAt, now))
```

## Story: Keep minors out of introductions and recruiting

> As a member under 18, I want help for myself without being asked to meet or recruit other people.

### Recruiting is an adult-only message at the time it is sent

An introduction, a meeting message, a feedback request, a relay, a reviewed home-help consent card, a "worthwhile" prompt, a re-engagement offer, a request to invite other people, or a notice to an inviter that their invitee joined requires an adult recipient. Check the current age when sending, including a message held for a later send window.

```quint
pure def outreachRequiresAdult(kind: str): bool =
  kind == "probe" or kind == "reveal" or kind == "nudge" or kind == "scheduling" or
  kind == "reminder" or kind == "feedback" or kind == "relay" or kind == "growth" or kind == "invite_notice" or kind == "home_help_consent" or kind == "worthwhile" or kind == "reengage"

pure def lawRecruitingRequiresAdult(kind: str): bool =
  kind == "growth" implies outreachRequiresAdult(kind)
```

## Story: Hear when someone I invited joins

> As an inviter, I want to hear when my invitation was accepted and the person joined.

### An eligible join receipt can ride on a current reply

Tell the inviter when a person joins through their attributed invitation. Share the first name and join status only. The account, consent, age and block checks still apply when the notice goes out. If the notice cannot go out by itself, carry it on an existing reply to a direct member message. A relay or a safety message is not such a reply and cannot carry the notice. A notice never rides a reply about an opportunity in which the invitee has a role (a participant or an alternate): it would name the invitee there before every yes, so it waits. A provider, an assistant submitting a profile, or the passage of time does not create a reply. Clear stale receipts after 30 days.

```quint
pure val inviteJoinNoticeLifetimeMs: int = 2592000000

pure def inviteJoinNoticeCurrent(attributed: bool, inviteeConsents: bool, bothEligible: bool, ageMs: int): bool =
  attributed and inviteeConsents and bothEligible and ageMs >= 0 and ageMs < inviteJoinNoticeLifetimeMs

pure def inviteJoinNoticeMayRideReply(directMemberTurn: bool, reply: bool, carriesMemberText: bool, inviteeHasRole: bool): bool =
  directMemberTurn and reply and not(carriesMemberText) and not(inviteeHasRole)

pure def lawInviteJoinNoticeNeedsAttribution(inviteeConsents: bool, bothEligible: bool, ageMs: int): bool =
  not(inviteJoinNoticeCurrent(false, inviteeConsents, bothEligible, ageMs))

pure def lawInviteJoinNoticeRequiresMemberTurn(reply: bool, carriesMemberText: bool, inviteeHasRole: bool): bool =
  not(inviteJoinNoticeMayRideReply(false, reply, carriesMemberText, inviteeHasRole))

pure def lawInviteJoinNoticeNeverNamesARole(directMemberTurn: bool, reply: bool, carriesMemberText: bool): bool =
  not(inviteJoinNoticeMayRideReply(directMemberTurn, reply, carriesMemberText, true))
```
