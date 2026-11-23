# Operations alert dispatch

The [runtime operations model](models/runtime_ops.md) includes alert dispatch alongside retention, ticks, and recovery. The VibeLang shell reads alert history and executes the generated decisions through the backend's existing transaction and webhook adapters. The turn watch shell (`packages/network/service/turn-watch.ts`) reads the signed gateway turns and the queued deliveries of the shared line, and the alert evaluation in `deploy/backend/ops.ts` turns its counts into alerts.

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

The current alert list determines whether a key is still active. A missing key with an open episode and a prior successful post queues a resolved notice. A missing key with no successful post closes quietly. A closed key or a key still in the current list stays as it is.

```quint
type MissingPlan = KeepEpisode | CloseQuietly | SendResolution

pure def chooseMissingPlan(episodeOpen: bool, seenThisRound: bool, postedBefore: bool): MissingPlan =
  if (not(episodeOpen) or seenThisRound) KeepEpisode
  else if (postedBefore) SendResolution
  else CloseQuietly
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

## Story: Hear when a shared-line turn may have reached nobody

> As an operator, I want an alert when a signed gateway turn or a Cloud delivery stays without a confirmed result, so that a member who may have heard nothing, or a STOP confirmation that may not have gone out, gets a person's attention.

### Each unconfirmed turn condition becomes overdue after its threshold

The watch has three conditions. A handled turn whose collected replies have no receipt, or a receipt with an unknown result, is unconfirmed. A rejected receipt is unconfirmed when the turn has a STOP or other compliance reply: the gateway then knows that the confirmation did not go out, and an operator must record it. A rejected ordinary reply is a known, final failure that the send failures already show, so it leaves the watch; an accepted receipt confirms the turn. A signed turn that did not complete (it ended unresolved before it was handled, or it stays in processing) and that staff have not resolved is unresolved. A turn that was handled first and later erased (a forgotten invitee's notice) or sealed by retention is not one. A queued delivery (through Eliza Cloud or the provider) whose acceptance is unknown waits for a receipt lookup. A row with a STOP or other compliance reply is overdue after 2 minutes, and any other row after 15 minutes. An unresolved turn keeps no text, so it always counts as a possible STOP. Unconfirmed replies and unknown deliveries older than 24 hours leave the watch, because no operator step can change them then: an unknown delivery ends as failed after its own retention and shows in the send failures. An unresolved turn stays in the watch until staff resolve it, or until retention deletes its tombstone (the inbox retention plus `turnTombstoneKeepMs` after it arrived); the runbook asks staff to resolve it long before. Changed (audit SHA65): nothing watched the signed gateway turn for failure -> this watch alerts on unconfirmed replies, unresolved turns and unknown deliveries, because a lost STOP confirmation raised no alert. The service counts rows in SQL by age band. The band edges are the thresholds of this rule, so `turnWatchOverdue` is constant inside a band and is asked once for each band. The feed has counts only: no turn id, number, member or text.

```quint
type TurnWatchCondition = RepliesUnconfirmed | TurnUnresolved | DeliveryUnknown
type TurnWatchReceipt = NoReceipt | ReceiptUnknown | ReceiptRejected | ReceiptAccepted

pure def turnWatchUnconfirmed(receipt: TurnWatchReceipt, complianceReply: bool): bool =
  receipt == NoReceipt or receipt == ReceiptUnknown or (receipt == ReceiptRejected and complianceReply)

pure def lawAcceptedReceiptConfirms(complianceReply: bool): bool =
  not(turnWatchUnconfirmed(ReceiptAccepted, complianceReply))

pure def lawRejectedComplianceIsWatched(receipt: TurnWatchReceipt): bool =
  turnWatchUnconfirmed(receipt, false) implies turnWatchUnconfirmed(receipt, true)

pure val turnWatchComplianceAfterMs: int = 120000
pure val turnWatchReplyAfterMs: int = 900000
pure val turnWatchWindowMs: int = 86400000

pure def turnWatchPossibleCompliance(condition: TurnWatchCondition, complianceReply: bool): bool =
  condition == TurnUnresolved or complianceReply

pure def turnWatchAfterMs(possibleCompliance: bool): int =
  if (possibleCompliance) turnWatchComplianceAfterMs else turnWatchReplyAfterMs

pure def turnWatchOverdue(condition: TurnWatchCondition, complianceReply: bool, ageMs: int): bool =
  ageMs >= turnWatchAfterMs(turnWatchPossibleCompliance(condition, complianceReply)) and
    (condition == TurnUnresolved or ageMs < turnWatchWindowMs)

pure val ageMsValues = Set(0, turnWatchComplianceAfterMs - 1, turnWatchComplianceAfterMs, turnWatchReplyAfterMs - 1,
  turnWatchReplyAfterMs, turnWatchWindowMs - 1, turnWatchWindowMs)

pure def lawComplianceIsWatchedSooner(condition: TurnWatchCondition, ageMs: int): bool =
  turnWatchOverdue(condition, false, ageMs) implies turnWatchOverdue(condition, true, ageMs)

pure def lawFreshTurnIsNotOverdue(condition: TurnWatchCondition, complianceReply: bool, ageMs: int): bool =
  ageMs < turnWatchComplianceAfterMs implies not(turnWatchOverdue(condition, complianceReply, ageMs))

pure def lawUnresolvedTurnStaysWatched(complianceReply: bool, ageMs: int): bool =
  ageMs >= turnWatchComplianceAfterMs implies turnWatchOverdue(TurnUnresolved, complianceReply, ageMs)
```

### Each condition is one alert, and a possible STOP makes it bad and first

Each condition has one alert key for the whole line, so the existing dispatch posts it once when it starts and again only when it gets worse or reaches its repeat time. The alert counts the overdue rows and the rows among them with a possible STOP or compliance reply. It is bad when one of them may be a STOP or compliance reply, and a warning otherwise. A bad turn alert comes before every other alert of the round. The alert carries counts only, never a message body, a number or a member.

```quint
pure def turnWatchAlertKey(condition: TurnWatchCondition): str =
  if (condition == RepliesUnconfirmed) "turn_unconfirmed"
  else if (condition == TurnUnresolved) "turn_unresolved"
  else "deliver_unknown"

pure def turnWatchRaises(overdueCount: int): bool = overdueCount > 0

pure def turnWatchLevel(complianceCount: int): str =
  if (complianceCount > 0) "bad" else "warn"

pure def turnWatchLeads(complianceCount: int): bool = complianceCount > 0

pure def lawPossibleStopIsBad(complianceCount: int): bool =
  complianceCount > 0 implies (turnWatchLevel(complianceCount) == "bad" and turnWatchLeads(complianceCount))

pure def lawTurnWatchKeysDiffer(first: TurnWatchCondition, second: TurnWatchCondition): bool =
  first != second implies turnWatchAlertKey(first) != turnWatchAlertKey(second)
```

## Story: Hear when the public event catalog stops refreshing

> As an operator, I want an alert when the public event catalog has not refreshed for longer than one refresh interval and one retry, so members are not offered expired events.

### The catalog alerts when its last scan is older than a day and one retry

The shell reads the time of the last successful catalog scan. The catalog is overdue when its last scan is older than the refresh interval plus the retry interval of the [public event catalog](publicEventCatalog.md). With no successful scan, the catalog is overdue once the process has run that long. An overdue catalog is one warning alert. A catalog that the shell cannot read is a read warning. Changed (2026-11-22): a failing refresh only logged one line per attempt -> an overdue catalog raises one warning, because no alert fired until members saw an empty catalog.

```quint
import publicEventCatalog as Catalog from "./publicEventCatalog"

pure val catalogStaleAfterMs: int = Catalog::publicEventRefreshMs + Catalog::publicEventRetryMs
pure val scanAgeMsValues = Set(0, catalogStaleAfterMs, catalogStaleAfterMs + 1)
pure val uptimeMsValues = Set(0, catalogStaleAfterMs, catalogStaleAfterMs + 1)

pure def catalogScanOverdue(scanned: bool, scanAgeMs: int, uptimeMs: int): bool =
  if (scanned) scanAgeMs > catalogStaleAfterMs else uptimeMs > catalogStaleAfterMs

pure def lawRecentScanIsQuiet(scanAgeMs: int, uptimeMs: int): bool =
  scanAgeMs <= catalogStaleAfterMs implies not(catalogScanOverdue(true, scanAgeMs, uptimeMs))
pure def lawMissedDayAndRetryAlerts(uptimeMs: int): bool =
  catalogScanOverdue(true, catalogStaleAfterMs + 1, uptimeMs)
pure def lawNewProcessWaitsForFirstScan(scanAgeMs: int): bool =
  not(catalogScanOverdue(false, scanAgeMs, catalogStaleAfterMs))
```

## Story: Hear when the review judge stops working or approves too much

> As an operator, I want an alert when the review judge cannot run on many items, or approves far more than its qualified rate, so that staff see the held items and check a judge that drifts.

### The review judge alerts when it cannot run or approves above its qualified rate

More than 10 `cannot_run` results in 24 hours raise a bad alert. With at least 20 judge decisions (approved and held) in 24 hours, an approval rate more than 0.1 above the qualified `mayApproveRate` raises a warning. Without a qualification record there is no rate alert. Rates are in basis points, so the rule uses integers. Changed (owner decisions of 2026-11-22): this rule is new, because the judge approves every introduction and its failure and its drift need an alert; before, `deploy/backend/ops.ts` compared the counts in the shell.

```quint
pure val judgeCannotRunAlertAbove: int = 10
pure val judgeRateMinDecisions: int = 20
pure val judgeRateMarginBp: int = 1000
pure val cannotRunValues = Set(0, judgeCannotRunAlertAbove, judgeCannotRunAlertAbove + 1)
pure val approvedValues = Set(0, 15, 19, 20)
pure val heldValues = Set(0, 5, 10)
pure val qualifiedRateBpValues = Set(0, 5000, 9000)

pure def judgeDownRaises(cannotRun: int): bool = cannotRun > judgeCannotRunAlertAbove

pure def judgeRateRaises(approved: int, held: int, qualified: bool, qualifiedRateBp: int): bool =
  qualified and approved + held >= judgeRateMinDecisions and
    approved * 10000 > (qualifiedRateBp + judgeRateMarginBp) * (approved + held)

pure def lawFewDecisionsAreQuiet(approved: int, held: int, qualifiedRateBp: int): bool =
  approved + held < judgeRateMinDecisions implies not(judgeRateRaises(approved, held, true, qualifiedRateBp))

pure def lawNoRecordIsQuiet(approved: int, held: int, qualifiedRateBp: int): bool =
  not(judgeRateRaises(approved, held, false, qualifiedRateBp))

pure def lawTenCannotRunIsQuiet(cannotRun: int): bool =
  cannotRun <= judgeCannotRunAlertAbove implies not(judgeDownRaises(cannotRun))
```

Conformance. test/fixtures/opsAlertDispatchWorker.ts runs one alert round of AlertDispatcher for each key, each on its own database, because a round takes a database-wide advisory lock. prepareDispatch makes the given number of new alerts and recorded posts in the last hour and sets the hourly limit. The webhook holds each post until recordDelivery answers it, so PostingNotices is a round that waits on its post.
