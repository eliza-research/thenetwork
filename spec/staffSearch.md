# Search the newest visible staff history

## Story: Find recent eligible conversation and system evidence

> As an authorized staff member, I want the newest results I can view when I search the app's history.

### Apply the result limit after checking visibility and rendered text

Read outbound agent messages and permitted system events in the current app.
Skip held delivery text. The search phrase must occur in the displayed result
after scrubbing content. Read bounded pages of stored candidates in descending
time and ID order until the visible page is full or the source is exhausted.
Merge the message and event results before applying the total limit.

```quint
pure def staffSearchHitVisible(canReadSource: bool, matchesRendered: bool): bool =
  canReadSource and matchesRendered

pure def lawHiddenSourceCannotMatch(matchesRendered: bool): bool =
  not(staffSearchHitVisible(false, matchesRendered))
```
