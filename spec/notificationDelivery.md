# Notification delivery

The [inbox flow model](models/notify_capital.md) covers planning, checking, recording and dispatch. The scheduler reads the clock and database, then uses these rules to compute due times and apply caps. The surface picker ranks the connected assistants using the same generated policy.

## Story: Get a requested update when it is due

> As a member, I want my requested updates when they are due, even when I have reached the cap on unsolicited messages.

### Requested updates are due at once

A requested update is due when it is created. Urgent updates use the urgent delay and other updates use the digest delay. The send path still checks quiet hours and the recipient's current eligibility.

```quint
pure def inboxDueAt(createdAt: int, urgency: str, urgentDelay: int, digestDelay: int): int =
  if (urgency == "requested") createdAt
  else if (urgency == "urgent") createdAt + urgentDelay
  else createdAt + digestDelay

pure def lawRequestedIsDueAtCreation(createdAt: int, urgentDelay: int, digestDelay: int): bool =
  inboxDueAt(createdAt, "requested", urgentDelay, digestDelay) == createdAt
```

### At the weekly cap only requested updates can go out

When a digest includes a proactive item and the member has reached the cap, remove proactive items. If that leaves nothing to send, hold the digest until a slot opens. A requested-only digest uses no proactive slot.

```quint
pure def removeProactiveItems(recentSends: int, weeklyCap: int, containsProactive: bool): bool =
  recentSends >= weeklyCap and containsProactive
```

## Story: Receive updates on a surface I use

> As a member, I want updates to point to a connected assistant only when I choose it or its recent use makes it a clear choice.

### Ignore inactive assistants and assistants whose links went unused twice

The automatic picker excludes an inactive assistant or one whose links went unused twice in a row. The explicit picker also falls back to the thread for those cases.

```quint
pure val maxIgnoredStreak: int = 2

pure def surfaceIsUsable(active: bool, ignoredStreak: int): bool =
  active and ignoredStreak < maxIgnoredStreak
```

### A useful assistant must lead the other surfaces

Use three points per acted-on delivery. Add two for use within fourteen days and one for an active connection. Subtract two per ignored delivery. An automatic choice needs at least three points and a lead of at least two over the runner-up, including the channel itself.

```quint
pure val surfaceRecentMs: int = 1209600000

pure def deliverySurfaceScore(acted: int, ignored: int, recentUse: bool, active: bool): int =
  acted * 3 + (if (recentUse) 2 else 0) + (if (active) 1 else 0) - ignored * 2

pure def surfaceHasClearLead(bestScore: int, otherScore: int): bool =
  bestScore >= 3 and bestScore - otherScore >= 2
```
