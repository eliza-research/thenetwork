# Admit a bounded request for help

[Story F14](product/stories.md#story-f14--ask-for-bounded-help) uses the same
home-entry and high-risk facts for direct requests and the engine's helper
search. The service keeps request text out of matching and safety case records.

## Story: Ask for manageable help without unexpected contact

> As a member, I want the Network to check the safety of my help request
> before it asks another person.

### A direct home-entry request goes to staff before contacting helpers

Classify the request before creating a matching request. Refuse an out-of-scope
high-risk task. Keep a home-entry task in the staff safety queue while the
service has no approved private venue to offer. A repeat request uses the open
case. The case has a reason code and no address, message text or trust penalty.
Recheck a saved request that identifies a home task before it retries or
contacts a helper. Ordinary bounded help uses the reviewed member request flow.

```quint
type BoundedHelpRoute = SearchPublicHelp | ReviewHomeEntryHelp | RefuseHighRiskHelp

pure def boundedHelpRoute(highRisk: bool, homeEntry: bool): BoundedHelpRoute =
  if (highRisk) RefuseHighRiskHelp
  else if (homeEntry) ReviewHomeEntryHelp
  else SearchPublicHelp

pure def openHomeHelpCase(adult: bool, hasOpenCase: bool): bool = adult and not(hasOpenCase)

pure def lawHomeHelpNeverUsesPublicSearch(highRisk: bool): bool =
  boundedHelpRoute(highRisk, true) != SearchPublicHelp

pure def lawHighRiskHelpTakesPrecedence(homeEntry: bool): bool =
  boundedHelpRoute(true, homeEntry) == RefuseHighRiskHelp
```

### An unfamiliar helper cannot be the only helper for home entry

A home-entry configuration needs at least two helpers, or one helper already
known to the requester. When an unfamiliar singleton needs a second helper,
use the small-group format and apply that format's opt-in before ranking any
helper in the group. A qualified configuration is medium risk and still
requires review and each participant's consent.

```quint
pure def homeHelperSetAllowed(helperCount: int, knownSingleton: bool): bool =
  helperCount >= 2 or (helperCount == 1 and knownSingleton)

pure def needsSecondHomeHelper(homeEntry: bool, requestedHelpers: int, knownSingleton: bool): bool =
  homeEntry and requestedHelpers == 1 and not(knownSingleton)

pure def lawUnfamiliarHomeSingletonIsDisallowed(helperCount: int): bool =
  helperCount < 2 implies not(homeHelperSetAllowed(helperCount, false))
```
