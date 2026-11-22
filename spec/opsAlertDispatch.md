# Operations alert dispatch

The [runtime operations model](models/runtime_ops.md) includes alert dispatch alongside retention, ticks, and recovery. The VibeLang shell reads alert history and executes the generated decisions through the backend's existing transaction and webhook adapters.

## Story: Receive useful operations alerts without duplicate notices

> As an operator, I want one batch of new, worse, repeated, or resolved notices in each eligible operations round.

### An alert sends when it starts, gets worse, or reaches its repeat time

A closed or new key starts a fresh episode. While an episode is open, update the current level, count, and detail. Prepare a notice if it has never posted, if its latest level rose from warn to bad, if a bump-enabled count exceeds the last posted count, or if the repeat time has passed. Keep the last successful post as the comparison baseline.

```quint
type FiringPlan = StartAlert | SendAgain | UpdateOnly
type FiringEvidence = {
  episodeOpen: bool, postedBefore: bool, latestLevel: str, sentLevel: str,
  bumpOnCount: bool, latestCount: int, sentCount: int, elapsedMs: int, repeatMs: int,
}

pure def chooseFiringPlan(e: FiringEvidence): FiringPlan =
  if (not(e.episodeOpen)) StartAlert
  else if (not(e.postedBefore) or (e.latestLevel == "bad" and e.sentLevel == "warn") or
    (e.bumpOnCount and e.latestCount > e.sentCount) or e.elapsedMs >= e.repeatMs) SendAgain
  else UpdateOnly
```

### An absent alert resolves after a successful notice

An absent key leaves its episode as it is when its source read fails. A completed read of another source can resolve that source's own alerts in the same round. An absent key with a readable source and a prior successful post queues a resolved notice. An absent key with a readable source and no successful post closes quietly. Closed keys and keys still in the current list stay as they are during this step.

```quint
type MissingPlan = KeepEpisode | CloseQuietly | SendResolution

pure def chooseMissingPlan(episodeOpen: bool, seenThisRound: bool, postedBefore: bool, sourceReadable: bool): MissingPlan =
  if (not(episodeOpen) or seenThisRound or not(sourceReadable)) KeepEpisode
  else if (postedBefore) SendResolution
  else CloseQuietly

pure def lawUnreadSourceKeepsEpisode(episodeOpen: bool, seenThisRound: bool, postedBefore: bool): bool =
  chooseMissingPlan(episodeOpen, seenThisRound, postedBefore, false) == KeepEpisode
```

### One batch consumes one attempt in the rolling hour

Send one body with all the pending notices when the rolling post count is below its limit. At the limit, hold all notices. Count both a successful and a failed attempt. Record the attempt and save episode changes in the same store transaction. Mark firing notices as sent and close resolved episodes after a successful delivery. An episode with a failed delivery can be eligible again next round.

```quint
pure val alertPostWindowMs = 3600000

type DispatchPhase = AwaitingNotices | NoNotices | HeldByLimit | PostingNotices | NoticesAccepted | PostRejected
type AlertDispatch = { phase: DispatchPhase }

pure val initial: AlertDispatch = { phase: AwaitingNotices }

pure def canPrepareDispatch(s: AlertDispatch): bool = s.phase == AwaitingNotices
pure def prepareDispatch(s: AlertDispatch, noticeCount: int, postsLastHour: int, hourlyLimit: int): AlertDispatch =
  { phase: if (noticeCount == 0) NoNotices else if (postsLastHour >= hourlyLimit) HeldByLimit else PostingNotices }

pure def canRecordDelivery(s: AlertDispatch): bool = s.phase == PostingNotices
pure def recordDelivery(s: AlertDispatch, accepted: bool): AlertDispatch =
  { phase: if (accepted) NoticesAccepted else PostRejected }

pure def batchWasAttempted(s: AlertDispatch): bool = s.phase == NoticesAccepted or s.phase == PostRejected
pure def batchWasAccepted(s: AlertDispatch): bool = s.phase == NoticesAccepted
pure def batchWasHeld(s: AlertDispatch): bool = s.phase == HeldByLimit

pure val noticeCountValues = Set(0, 1, 3)
pure val postsLastHourValues = Set(0, 1, 2)
pure val hourlyLimitValues = Set(1, 2)

pure def stepResultFollowsAttempt(before: AlertDispatch, after: AlertDispatch): bool =
  (batchWasAttempted(after) and not(batchWasAttempted(before))) implies before.phase == PostingNotices

pure def sometimesHeld(s: AlertDispatch): bool = batchWasHeld(s)
pure def sometimesAccepted(s: AlertDispatch): bool = batchWasAccepted(s)
pure def sometimesRejected(s: AlertDispatch): bool = s.phase == PostRejected
```

## Story: Report the result of each operations round

> As an operator, I want useful diagnostics and a heartbeat from a completed operations round.

### Collect scheduled rounds and reuse fresh metrics

A new operations round starts when its configured interval has passed. A read request may use the latest metrics for less than 15 seconds after collection.

```quint
pure val metricsFreshMs = 15000

pure def opsRoundDue(elapsedMs: int, intervalMs: int): bool = not(elapsedMs < intervalMs)
pure def cachedOpsMetricsFresh(elapsedMs: int): bool = elapsedMs < metricsFreshMs
```

### A completed round reports the post separately from its heartbeat

Log a summary when the round prepared a notice, an error when a post attempt failed, and a warning when any notices were held. After the dispatch call returns, send the configured heartbeat. The scheduled heartbeat still runs if the webhook returns failure or another replica handled dispatch.

```quint
type RoundReport = { logSummary: bool, logFailure: bool, logLimit: bool, pingHeartbeat: bool }

pure def roundReport(hasNotices: bool, postAttempted: bool, delivered: bool, heldNotices: bool, heartbeatConfigured: bool): RoundReport =
  { logSummary: hasNotices, logFailure: postAttempted and not(delivered), logLimit: heldNotices,
    pingHeartbeat: heartbeatConfigured }
```
