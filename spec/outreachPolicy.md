# Outreach policy

## Story: Limit unsolicited messages across apps

> As a member of several apps, I want a single daily limit on unsolicited messages.

### The default daily proactive limit is three across all apps

The Network uses one default limit per person across apps. The send path takes a slot under a database lock before it hands the message to the channel. Replies and other non-proactive messages do not use proactive slots.

```quint
pure val personDailyCap: int = 3
```

## Story: Pause new offers after two unanswered invitations

> As a member, I want the agent to stop inviting me when I leave two invitations unanswered.

### Count a sent invitation at terminal expiry or after 72 hours

Keep one entry for the initial invitation to a member for an opportunity. A follow-up question, an unsent probe or a dispatch that the channel has yet to confirm does not count. A channel acceptance starts the clock. A terminal probe or plan deadline can mature the same entry earlier. A current inbound message clears the member's unanswered entries. The existing one-time re-engagement retains its ordinary time limit. A stored entry from before delivery tracking uses its original recorded time.

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
```

## Story: Keep minors out of introductions and recruiting

> As a member under 18, I want help for myself without being asked to meet or recruit other people.

### Recruiting is an adult-only message at the time it is sent

An introduction, a meeting message, a relay, a reviewed home-help consent card, or a request to invite other people requires an adult recipient. Check the current age when sending, including a message held for a later send window.

```quint
pure def outreachRequiresAdult(kind: str): bool =
  kind == "probe" or kind == "reveal" or kind == "nudge" or kind == "scheduling" or
  kind == "reminder" or kind == "feedback" or kind == "relay" or kind == "growth" or kind == "invite_notice" or kind == "home_help_consent" or kind == "worthwhile"

pure def lawRecruitingRequiresAdult(kind: str): bool =
  kind == "growth" implies outreachRequiresAdult(kind)
```

## Story: Hear when someone I invited joins

> As an inviter, I want to hear when my invitation was accepted and the person joined.

### An eligible join receipt can ride on a current reply

Tell the inviter when a person joins through their attributed invitation. Share the first name and join status only. The account, consent, age and block checks still apply when the notice goes out. If the notice cannot go out by itself, carry it on an existing reply to a direct member message. A notice never rides a reply about an opportunity in which the invitee has a role (a participant or an alternate): it would name the invitee there before every yes, so it waits. A provider, an assistant submitting a profile, or the passage of time does not create a reply. Clear stale receipts after 30 days.

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
