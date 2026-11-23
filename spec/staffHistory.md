# Read staff history from the latest evidence

## Story: Inspect a member or opportunity after a long history

> As authorized staff, I want to see recent evidence first and open earlier evidence when I need it.

### Keep history reads bounded and preserve their order

Start with the newest stored messages and events for the requested app
and subject. Return each selected page in chronological order. Keep the
same masking and access checks on every page. When earlier messages or
events exist, return separate cursors for those sources. A cursor refers
to the timestamp and record ID of the oldest item on that source's page.
A cursor never selects an app, member, or opportunity.

```quint
pure def staffHistoryPageSize(memberEvents: bool): int =
  if (memberEvents) 5000 else 2000

pure def staffHistoryHasEarlier(rowCount: int, memberEvents: bool): bool =
  rowCount > staffHistoryPageSize(memberEvents)

pure def lawStaffHistoryMayUseOneLookahead(memberEvents: bool): bool =
  staffHistoryHasEarlier(staffHistoryPageSize(memberEvents) + 1, memberEvents)
```
