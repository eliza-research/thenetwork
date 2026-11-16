# Operations timing

## Story: See which work needs attention

> As an operator, I want to see when a review is due, a case is overdue, or the matcher has missed a run.

### Open reviews are due at the deadline and near during the previous hour

A review is overdue when its deadline arrives. It is near the deadline while the deadline remains ahead and is no more than one hour away. The console also reports items waiting longer than their app's SLA.

```quint
import reviewDeadline.* from "./reviewDeadline"

pure val millisPerHour: int = 3600000

pure def nearReviewDeadline(asOf: int, deadline: int): bool =
  asOf < deadline and deadline - asOf <= millisPerHour

pure def waitExceedsSla(asOf: int, queuedAt: int, allowedMillis: int): bool =
  asOf - queuedAt > allowedMillis

pure def lawDueReviewIsNoLongerNear(asOf: int, deadline: int): bool =
  reviewLate(asOf, deadline) implies not(nearReviewDeadline(asOf, deadline))
```

### An urgent safety report is due in one hour

An urgent safety report or case is due one hour after it opens. Other reports and cases are due in one day. An open report or open or held case is overdue after its due time.

```quint
pure def safetyDueAt(openedAt: int, urgent: bool): int =
  openedAt + (if (urgent) millisPerHour else millisPerHour * 24)

pure def safetyOverdue(asOf: int, dueAt: int, outstanding: bool): bool =
  outstanding and asOf > dueAt
```

### A matcher run is late after twenty-six hours

When matching is enabled, start measuring from the last known run. If there has been no run, measure from the start of the data. Allow up to twenty-six hours before reporting a missed heartbeat.

```quint
pure val matcherHeartbeatMillis: int = 26 * millisPerHour

pure def missedMatcherHeartbeat(asOf: int, lastRunOrStart: int): bool =
  asOf - lastRunOrStart > matcherHeartbeatMillis
```
