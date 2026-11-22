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
