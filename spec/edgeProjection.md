# Refresh the staff relationship graph

## Story: Read current stored relationships

> As an authorized staff member, I want the relationship graph to agree
> with the current data when an edge changes or is removed.

### Apply authorized database snapshots to the stored graph view

Keep directed edges separate. If two rows represent one symmetric edge,
use the stronger row. Prefer the later row at equal strength. Replace the
previous representation if any field changed, including when strength falls
or reaches zero. Remove a relationship that disappeared from the complete
snapshot. Publish a reset so the consumer reloads the remaining edges.

```quint
type EdgeProjectionChange = KeepEdge | ReplaceEdge | RemoveEdge

pure def edgeProjectionChange(presentInSnapshot: bool, matchesStored: bool): EdgeProjectionChange =
  if (not(presentInSnapshot)) RemoveEdge
  else if (matchesStored) KeepEdge
  else ReplaceEdge

pure def lawAbsentStoredEdgesAreRemoved(matchesStored: bool): bool =
  edgeProjectionChange(false, matchesStored) == RemoveEdge
```
