# Current pair restrictions

## Story: A blocked or avoided pair stays apart

> As a member, I want current block and avoid decisions to apply whenever the Network chooses, reviews, or contacts a matching pair.

### Use current app and saved pair restrictions throughout the flow

Read both local decisions and the current app snapshot. Apply an edge
in either direction. Check a proposed welcome host before ranking so
another eligible host can be selected. Check every added member against
the earlier seats. Recheck at staff approval and when opening contact
for a new match. A block or negative encounter invalidates saved repeat
interest for the pair. The relay checks explicit blocks and its own
consent rules. Apply the existing pair history and shared availability
rules to proposed matches.

```quint
pure def currentPairAllowed(blocked: bool, avoided: bool): bool =
  not(blocked or avoided)

pure def lawRestrictedPairCannotProceed(blocked: bool, avoided: bool): bool =
  (blocked or avoided) implies not(currentPairAllowed(blocked, avoided))

pure def welcomePairMayRank(compatible: bool, sharesTime: bool): bool =
  compatible and sharesTime

pure def lawWelcomeRankingRequiresCommonTime(compatible: bool): bool =
  not(welcomePairMayRank(compatible, false))
```
