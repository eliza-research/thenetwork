// Generated from spec/opsAlertDispatch.md via Vibestack and VibeLang. Run pnpm run spec:sync.
import * as M from "./opsAlertDispatch.js";
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) @throws {never} */
export const alertPostWindowMs = M.alertPostWindowMs;
/** Story: Report the result of each operations round / Collect scheduled rounds and reuse fresh metrics (spec/opsAlertDispatch.md) @throws {never} */
export const metricsFreshMs = M.metricsFreshMs;
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) @throws {never} */
export const turnWatchComplianceAfterMs = M.turnWatchComplianceAfterMs;
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) @throws {never} */
export const turnWatchReplyAfterMs = M.turnWatchReplyAfterMs;
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) @throws {never} */
export const turnWatchWindowMs = M.turnWatchWindowMs;
/** Story: Hear when the review judge stops working or approves too much / The review judge alerts when it cannot run or approves above its qualified rate (spec/opsAlertDispatch.md) @throws {never} */
export const judgeCannotRunAlertAbove = M.judgeCannotRunAlertAbove;
/** Story: Hear when the review judge stops working or approves too much / The review judge alerts when it cannot run or approves above its qualified rate (spec/opsAlertDispatch.md) @throws {never} */
export const judgeRateMinDecisions = M.judgeRateMinDecisions;
/** Story: Hear when the review judge stops working or approves too much / The review judge alerts when it cannot run or approves above its qualified rate (spec/opsAlertDispatch.md) @throws {never} */
export const judgeRateMarginBp = M.judgeRateMarginBp;
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) @throws {never} */
export const initial = M.initial;
/** Story: Hear when the public event catalog stops refreshing / The catalog alerts when its last scan is older than a day and one retry (spec/opsAlertDispatch.md) @throws {never} */
export const catalogStaleAfterMs = M.catalogStaleAfterMs;
/** Every `always` rule at once. Holds initially and after every transition. @throws {never} */
export function inv(current) { return M.inv(current); }
/** Story: Receive useful operations alerts without duplicate notices / Pending delivery does not affect the failure rate (spec/opsAlertDispatch.md) @throws {never} */
export function reportedSmsTotal(exactTotalAvailable, exactTotal, legacyTotal) { return M.reportedSmsTotal(exactTotalAvailable, exactTotal, legacyTotal); }
/** Story: Receive useful operations alerts without duplicate notices / Pending delivery does not affect the failure rate (spec/opsAlertDispatch.md) @throws {never} */
export function countSendOutcome(waiting) { return M.countSendOutcome(waiting); }
/** Story: Receive useful operations alerts without duplicate notices / Pending delivery does not affect the failure rate (spec/opsAlertDispatch.md) @throws {never} */
export function lawPendingDeliveryHasNoOutcome(waiting) { return M.lawPendingDeliveryHasNoOutcome(waiting); }
/** Story: Receive useful operations alerts without duplicate notices / Pending delivery does not affect the failure rate (spec/opsAlertDispatch.md) @throws {never} */
export function lawAnExactSmsZeroReplacesTheLegacyTotal(legacyTotal) { return M.lawAnExactSmsZeroReplacesTheLegacyTotal(legacyTotal); }
/** Story: Receive useful operations alerts without duplicate notices / An alert sends when it starts, gets worse, or reaches its repeat time (spec/opsAlertDispatch.md) @throws {never} */
export function chooseFiringPlan(e) { return M.chooseFiringPlan(e); }
/** Story: Receive useful operations alerts without duplicate notices / An absent alert resolves after a successful notice (spec/opsAlertDispatch.md) @throws {never} */
export function chooseMissingPlan(episodeOpen, seenThisRound, postedBefore, sourceReadable) { return M.chooseMissingPlan(episodeOpen, seenThisRound, postedBefore, sourceReadable); }
/** Story: Receive useful operations alerts without duplicate notices / An absent alert resolves after a successful notice (spec/opsAlertDispatch.md) @throws {never} */
export function lawUnreadSourceKeepsEpisode(episodeOpen, seenThisRound, postedBefore) { return M.lawUnreadSourceKeepsEpisode(episodeOpen, seenThisRound, postedBefore); }
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) @throws {never} */
export function canPrepareDispatch(s) { return M.canPrepareDispatch(s); }
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) @throws {never} */
export function prepareDispatch(s, noticeCount, postsLastHour, hourlyLimit) { return M.prepareDispatch(s, noticeCount, postsLastHour, hourlyLimit); }
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) @throws {never} */
export function canRecordDelivery(s) { return M.canRecordDelivery(s); }
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) @throws {never} */
export function recordDelivery(s, accepted) { return M.recordDelivery(s, accepted); }
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) @throws {never} */
export function batchWasAttempted(s) { return M.batchWasAttempted(s); }
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) @throws {never} */
export function batchWasAccepted(s) { return M.batchWasAccepted(s); }
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) @throws {never} */
export function batchWasHeld(s) { return M.batchWasHeld(s); }
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) @throws {never} */
export function sometimesRejected(s) { return M.sometimesRejected(s); }
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) @throws {never} */
export function stepResultFollowsAttempt(before, after) { return M.stepResultFollowsAttempt(before, after); }
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) @throws {never} */
export function sometimesHeld(s) { return M.sometimesHeld(s); }
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) @throws {never} */
export function sometimesAccepted(s) { return M.sometimesAccepted(s); }
/** Story: Report the result of each operations round / Collect scheduled rounds and reuse fresh metrics (spec/opsAlertDispatch.md) @throws {never} */
export function opsRoundDue(elapsedMs, intervalMs) { return M.opsRoundDue(elapsedMs, intervalMs); }
/** Story: Report the result of each operations round / Collect scheduled rounds and reuse fresh metrics (spec/opsAlertDispatch.md) @throws {never} */
export function cachedOpsMetricsFresh(elapsedMs) { return M.cachedOpsMetricsFresh(elapsedMs); }
/** Story: Report the result of each operations round / A completed round reports the post separately from its heartbeat (spec/opsAlertDispatch.md) @throws {never} */
export function roundReport(hasNotices, postAttempted, delivered, heldNotices, heartbeatConfigured) { return M.roundReport(hasNotices, postAttempted, delivered, heldNotices, heartbeatConfigured); }
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) @throws {never} */
export function turnWatchAfterMs(possibleCompliance) { return M.turnWatchAfterMs(possibleCompliance); }
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) @throws {never} */
export function turnWatchUnconfirmed(receipt, complianceReply) { return M.turnWatchUnconfirmed(receipt, complianceReply); }
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) @throws {never} */
export function turnWatchPossibleCompliance(condition, complianceReply) { return M.turnWatchPossibleCompliance(condition, complianceReply); }
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) @throws {never} */
export function lawAcceptedReceiptConfirms(complianceReply) { return M.lawAcceptedReceiptConfirms(complianceReply); }
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) @throws {never} */
export function lawRejectedComplianceIsWatched(receipt) { return M.lawRejectedComplianceIsWatched(receipt); }
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) @throws {never} */
export function turnWatchOverdue(condition, complianceReply, ageMs) { return M.turnWatchOverdue(condition, complianceReply, ageMs); }
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) @throws {never} */
export function lawComplianceIsWatchedSooner(condition, ageMs) { return M.lawComplianceIsWatchedSooner(condition, ageMs); }
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) @throws {never} */
export function lawFreshTurnIsNotOverdue(condition, complianceReply, ageMs) { return M.lawFreshTurnIsNotOverdue(condition, complianceReply, ageMs); }
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) @throws {never} */
export function lawUnresolvedTurnStaysWatched(complianceReply, ageMs) { return M.lawUnresolvedTurnStaysWatched(complianceReply, ageMs); }
/** Story: Hear when a shared-line turn may have reached nobody / Each condition is one alert, and a possible STOP makes it bad and first (spec/opsAlertDispatch.md) @throws {never} */
export function turnWatchRaises(overdueCount) { return M.turnWatchRaises(overdueCount); }
/** Story: Hear when a shared-line turn may have reached nobody / Each condition is one alert, and a possible STOP makes it bad and first (spec/opsAlertDispatch.md) @throws {never} */
export function turnWatchLevel(complianceCount) { return M.turnWatchLevel(complianceCount); }
/** Story: Hear when a shared-line turn may have reached nobody / Each condition is one alert, and a possible STOP makes it bad and first (spec/opsAlertDispatch.md) @throws {never} */
export function turnWatchLeads(complianceCount) { return M.turnWatchLeads(complianceCount); }
/** Story: Hear when a shared-line turn may have reached nobody / Each condition is one alert, and a possible STOP makes it bad and first (spec/opsAlertDispatch.md) @throws {never} */
export function turnWatchAlertKey(condition) { return M.turnWatchAlertKey(condition); }
/** Story: Hear when a shared-line turn may have reached nobody / Each condition is one alert, and a possible STOP makes it bad and first (spec/opsAlertDispatch.md) @throws {never} */
export function lawPossibleStopIsBad(complianceCount) { return M.lawPossibleStopIsBad(complianceCount); }
/** Story: Hear when a shared-line turn may have reached nobody / Each condition is one alert, and a possible STOP makes it bad and first (spec/opsAlertDispatch.md) @throws {never} */
export function lawTurnWatchKeysDiffer(first, second) { return M.lawTurnWatchKeysDiffer(first, second); }
/** Story: Hear when the public event catalog stops refreshing / The catalog alerts when its last scan is older than a day and one retry (spec/opsAlertDispatch.md) @throws {never} */
export function catalogScanOverdue(scanned, scanAgeMs, uptimeMs) { return M.catalogScanOverdue(scanned, scanAgeMs, uptimeMs); }
/** Story: Hear when the public event catalog stops refreshing / The catalog alerts when its last scan is older than a day and one retry (spec/opsAlertDispatch.md) @throws {never} */
export function lawRecentScanIsQuiet(scanAgeMs, uptimeMs) { return M.lawRecentScanIsQuiet(scanAgeMs, uptimeMs); }
/** Story: Hear when the public event catalog stops refreshing / The catalog alerts when its last scan is older than a day and one retry (spec/opsAlertDispatch.md) @throws {never} */
export function lawMissedDayAndRetryAlerts(uptimeMs) { return M.lawMissedDayAndRetryAlerts(uptimeMs); }
/** Story: Hear when the public event catalog stops refreshing / The catalog alerts when its last scan is older than a day and one retry (spec/opsAlertDispatch.md) @throws {never} */
export function lawNewProcessWaitsForFirstScan(scanAgeMs) { return M.lawNewProcessWaitsForFirstScan(scanAgeMs); }
/** Story: Hear when the review judge stops working or approves too much / The review judge alerts when it cannot run or approves above its qualified rate (spec/opsAlertDispatch.md) @throws {never} */
export function judgeDownRaises(cannotRun) { return M.judgeDownRaises(cannotRun); }
/** Story: Hear when the review judge stops working or approves too much / The review judge alerts when it cannot run or approves above its qualified rate (spec/opsAlertDispatch.md) @throws {never} */
export function judgeRateRaises(approved, held, qualified, qualifiedRateBp) { return M.judgeRateRaises(approved, held, qualified, qualifiedRateBp); }
/** Story: Hear when the review judge stops working or approves too much / The review judge alerts when it cannot run or approves above its qualified rate (spec/opsAlertDispatch.md) @throws {never} */
export function lawFewDecisionsAreQuiet(approved, held, qualifiedRateBp) { return M.lawFewDecisionsAreQuiet(approved, held, qualifiedRateBp); }
/** Story: Hear when the review judge stops working or approves too much / The review judge alerts when it cannot run or approves above its qualified rate (spec/opsAlertDispatch.md) @throws {never} */
export function lawNoRecordIsQuiet(approved, held, qualifiedRateBp) { return M.lawNoRecordIsQuiet(approved, held, qualifiedRateBp); }
/** Story: Hear when the review judge stops working or approves too much / The review judge alerts when it cannot run or approves above its qualified rate (spec/opsAlertDispatch.md) @throws {never} */
export function lawTenCannotRunIsQuiet(cannotRun) { return M.lawTenCannotRunIsQuiet(cannotRun); }
/** Do the rules allow this event in this state? @throws {never} */
export function enabled(current, event) { return M.enabled(current, event); }
/** Apply an event. An event the rules do not allow leaves the state unchanged. @throws {never} */
export function step(current, event) { return M.step(current, event); }
/** Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program: the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy with exactly the fields the event has, so nothing the caller keeps can change it afterwards. @throws {never} */
export function parseEvent(x) { return M.parseEvent(x); }
/** Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The result is a fresh copy, so nothing the caller keeps can change it afterwards. @throws {never} */
export function parseState(x) { return M.parseState(x); }
/** A Machine never shares a state with its callers. @throws {never} */
export function snapshot_opsAlertDispatch(value) { return structuredClone(value); }
