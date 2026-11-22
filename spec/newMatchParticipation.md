# Participation in new matches

## Story: Match only where I have agreed to take part

> As a member, I want my current participation and category choices to apply before a new match reaches me.

### Recheck the member and category before a new contact

A new match needs an active account and unpaused matching. Every
participant in a new proposal needs to allow its category. Romance
needs separate opt-in and the mutual preferences required by the app.
Check these settings when searching for a requested match, before
approving a proposal, and when trying an alternate. Apply the same
participation check when an initial probe would contact a member.
A request for public venues still returns personal suggestions without
an events opt-in. Only offer a plan buddy when the requester allows
event matches. Skip earlier requests from members who do not allow
event matches before attaching either request to a proposal.
An accepted booking's logistics and a consensual relay use their
existing consent and safety checks.

```quint
pure def newMatchParticipationAllowed(paused: bool, activeAccount: bool): bool =
  not(paused) and activeAccount

pure def newMatchCategoryAllowed(categoryEnabled: bool, romance: bool, romanceOptIn: bool): bool =
  categoryEnabled and (not(romance) or romanceOptIn)

pure def lawPausedMatchingStopsNewContact(activeAccount: bool): bool =
  not(newMatchParticipationAllowed(true, activeAccount))

pure def lawNewRomanceNeedsSeparateOptIn(categoryEnabled: bool): bool =
  not(newMatchCategoryAllowed(categoryEnabled, true, false))
```

### Keep the seat's role when another member takes it

A member who is receiving support cannot take a contributor role.
Recheck the current participation state before choosing a replacement.
When a member takes the seat, carry the seat's role into the next
review or probe and remove it from the old roster entry.

```quint
pure def replacementCanTakeRole(receiving: bool, contributes: bool): bool =
  not(receiving and contributes)

pure def lawReceivingReplacementCannotContribute(contributes: bool): bool =
  replacementCanTakeRole(true, contributes) == not(contributes)
```

### A refused draft does not consume a matching slot

Check each participant's category before sending an engine proposal
to review. Recheck the category at approval and before contact.
An opportunity that enters review or starts probing uses a slot in
the current run. A draft that closes immediately after an admission
refusal leaves room to consider the next proposal. An open review
still keeps its duplicate lock. If it closes before any contact, the
matching engine does not charge it as a sent proposal.

```quint
pure def draftUsesMatchingSlot(created: bool, closed: bool): bool =
  created and not(closed)

pure def lawClosedDraftLeavesMatchingSlot(created: bool): bool =
  not(draftUsesMatchingSlot(created, true))

pure def reviewDraftWasUnsent(closedFromReview: bool, contacted: bool): bool =
  closedFromReview and not(contacted)

pure def lawOpenReviewKeepsItsDuplicateLock(contacted: bool): bool =
  not(reviewDraftWasUnsent(false, contacted))
```
