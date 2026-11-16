# Outreach policy

## Story: Limit unsolicited messages across apps

> As a member of several apps, I want a single daily limit on unsolicited messages.

### The default daily proactive limit is three across all apps

The Network uses one default limit per person across apps. The send path takes a slot under a database lock before it hands the message to the channel. Replies and other non-proactive messages do not use proactive slots.

```quint
pure val personDailyCap: int = 3
```

## Story: Keep minors out of introductions and recruiting

> As a member under 18, I want help for myself without being asked to meet or recruit other people.

### Recruiting is an adult-only message at the time it is sent

An introduction, a meeting message, a relay, or a request to invite other people requires an adult recipient. Check the current age when sending, including a message held for a later send window.

```quint
pure def outreachRequiresAdult(kind: str): bool =
  kind == "probe" or kind == "reveal" or kind == "nudge" or kind == "scheduling" or
  kind == "reminder" or kind == "feedback" or kind == "relay" or kind == "growth" or kind == "invite_notice"

pure def lawRecruitingRequiresAdult(kind: str): bool =
  kind == "growth" implies outreachRequiresAdult(kind)
```

## Story: Hear when someone I invited joins

> As an inviter, I want to hear when my invitation was accepted and the person joined.

### An eligible join receipt can ride on a current reply

Tell the inviter when a person joins through their attributed invitation. Share the first name and join status only. The account, consent, age and block checks still apply when the notice goes out. If the notice cannot go out by itself, carry it on an existing reply to a direct member message. A provider, an assistant submitting a profile, or the passage of time does not create a reply. Clear stale receipts after 30 days.

```quint
pure val inviteJoinNoticeLifetimeMs: int = 2592000000

pure def inviteJoinNoticeCurrent(attributed: bool, inviteeConsents: bool, bothEligible: bool, ageMs: int): bool =
  attributed and inviteeConsents and bothEligible and ageMs >= 0 and ageMs < inviteJoinNoticeLifetimeMs

pure def inviteJoinNoticeMayRideReply(directMemberTurn: bool, reply: bool, carriesMemberText: bool): bool =
  directMemberTurn and reply and not(carriesMemberText)

pure def lawInviteJoinNoticeNeedsAttribution(inviteeConsents: bool, bothEligible: bool, ageMs: int): bool =
  not(inviteJoinNoticeCurrent(false, inviteeConsents, bothEligible, ageMs))

pure def lawInviteJoinNoticeRequiresMemberTurn(reply: bool, carriesMemberText: bool): bool =
  not(inviteJoinNoticeMayRideReply(false, reply, carriesMemberText))
```
