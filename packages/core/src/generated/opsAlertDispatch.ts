// GENERATED from spec/opsAlertDispatch.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { publicEventHorizonDays as publicEventCatalog_publicEventHorizonDays, publicEventRefreshMs as publicEventCatalog_publicEventRefreshMs, publicEventRetryMs as publicEventCatalog_publicEventRetryMs, publicEventFreshDays as publicEventCatalog_publicEventFreshDays, publicEventScanMaxBytes as publicEventCatalog_publicEventScanMaxBytes, publicEventScanRowLimit as publicEventCatalog_publicEventScanRowLimit, publicEventScanResponseAllowed as publicEventCatalog_publicEventScanResponseAllowed, publicEventScanComplete as publicEventCatalog_publicEventScanComplete, publicEventPublicationNewer as publicEventCatalog_publicEventPublicationNewer, publicEventCatalogFresh as publicEventCatalog_publicEventCatalogFresh, publicEventDuplicateAllowed as publicEventCatalog_publicEventDuplicateAllowed, publicEventRevisionMatches as publicEventCatalog_publicEventRevisionMatches, publicEventMemberAllowsMatch as publicEventCatalog_publicEventMemberAllowsMatch, publicEventWindowUsable as publicEventCatalog_publicEventWindowUsable, publicEventClaimAllowed as publicEventCatalog_publicEventClaimAllowed, closedPublicEventIsUnsent as publicEventCatalog_closedPublicEventIsUnsent, publicBookedEventLinkAllowed as publicEventCatalog_publicBookedEventLinkAllowed, publicEventRefreshDue as publicEventCatalog_publicEventRefreshDue, lawPartialEventScanCannotPublish as publicEventCatalog_lawPartialEventScanCannotPublish, lawCatalogExpiresAtLimit as publicEventCatalog_lawCatalogExpiresAtLimit, lawConflictingPublicEventRowsCannotPublish as publicEventCatalog_lawConflictingPublicEventRowsCannotPublish, lawEventMinimumAgeAppliesToAdults as publicEventCatalog_lawEventMinimumAgeAppliesToAdults, lawMovedPublicEventCannotAuthorizeClaim as publicEventCatalog_lawMovedPublicEventCannotAuthorizeClaim, lawRefreshDueBeforeCatalogExpires as publicEventCatalog_lawRefreshDueBeforeCatalogExpires, lawRecentAttemptWaits as publicEventCatalog_lawRecentAttemptWaits, publicEventAllowed as publicEventCatalog_publicEventAllowed } from "./publicEventCatalog.ts";

/** Story: Receive useful operations alerts without duplicate notices / An alert sends when it starts, gets worse, or reaches its repeat time (spec/opsAlertDispatch.md) */
export interface FiringEvidence { episodeOpen: boolean; postedBefore: boolean; latestLevel: string; sentLevel: string; bumpOnCount: boolean; latestCount: number; sentCount: number; elapsedMs: number; repeatMs: number }
/** Story: Receive useful operations alerts without duplicate notices / An alert sends when it starts, gets worse, or reaches its repeat time (spec/opsAlertDispatch.md) */
export type FiringPlan = "StartAlert" | "SendAgain" | "UpdateOnly";
/** Story: Receive useful operations alerts without duplicate notices / An absent alert resolves after a successful notice (spec/opsAlertDispatch.md) */
export type MissingPlan = "KeepEpisode" | "CloseQuietly" | "SendResolution";
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
export type DispatchPhase = "AwaitingNotices" | "NoNotices" | "HeldByLimit" | "PostingNotices" | "NoticesAccepted" | "PostRejected";
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
export interface AlertDispatch { phase: DispatchPhase }
/** Story: Report the result of each operations round / A completed round reports the post separately from its heartbeat (spec/opsAlertDispatch.md) */
export interface RoundReport { logSummary: boolean; logFailure: boolean; logLimit: boolean; pingHeartbeat: boolean }
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) */
export type TurnWatchCondition = "RepliesUnconfirmed" | "TurnUnresolved" | "DeliveryUnknown";
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) */
export type TurnWatchReceipt = "NoReceipt" | "ReceiptUnknown" | "ReceiptRejected" | "ReceiptAccepted";

/** One variant per transition in the spec. */
export type Event =
  | { type: "prepareDispatch"; noticeCount: number; postsLastHour: number; hourlyLimit: number }
  | { type: "recordDelivery"; accepted: boolean };

/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
export const alertPostWindowMs: number = 3600000;
/** Story: Report the result of each operations round / Collect scheduled rounds and reuse fresh metrics (spec/opsAlertDispatch.md) */
export const metricsFreshMs: number = 15000;
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) */
export const turnWatchComplianceAfterMs: number = 120000;
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) */
export const turnWatchReplyAfterMs: number = 900000;
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) */
export const turnWatchWindowMs: number = 86400000;
/** Story: Hear when the review judge stops working or approves too much / The review judge alerts when it cannot run or approves above its qualified rate (spec/opsAlertDispatch.md) */
export const judgeCannotRunAlertAbove: number = 10;
/** Story: Hear when the review judge stops working or approves too much / The review judge alerts when it cannot run or approves above its qualified rate (spec/opsAlertDispatch.md) */
export const judgeRateMinDecisions: number = 20;
/** Story: Hear when the review judge stops working or approves too much / The review judge alerts when it cannot run or approves above its qualified rate (spec/opsAlertDispatch.md) */
export const judgeRateMarginBp: number = 1000;
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
export const initial: AlertDispatch = { phase: "AwaitingNotices" };
/** Story: Hear when the public event catalog stops refreshing / The catalog alerts when its last scan is older than a day and one retry (spec/opsAlertDispatch.md) */
export const catalogStaleAfterMs: number = exact_opsAlertDispatch(publicEventCatalog_publicEventRefreshMs + publicEventCatalog_publicEventRetryMs);

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: AlertDispatch): boolean {
  return true;
}

/** Story: Receive useful operations alerts without duplicate notices / An alert sends when it starts, gets worse, or reaches its repeat time (spec/opsAlertDispatch.md) */
//@ pure
export function chooseFiringPlan(e: FiringEvidence): FiringPlan {
  return !e.episodeOpen ? "StartAlert" : (!e.postedBefore || (e.latestLevel === "bad" && e.sentLevel === "warn") || (e.bumpOnCount && e.latestCount > e.sentCount) || e.elapsedMs >= e.repeatMs ? "SendAgain" : "UpdateOnly");
}

/** Story: Receive useful operations alerts without duplicate notices / An absent alert resolves after a successful notice (spec/opsAlertDispatch.md) */
//@ pure
export function chooseMissingPlan(episodeOpen: boolean, seenThisRound: boolean, postedBefore: boolean): MissingPlan {
  return !episodeOpen || seenThisRound ? "KeepEpisode" : (postedBefore ? "SendResolution" : "CloseQuietly");
}

/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
//@ pure
export function canPrepareDispatch(s: AlertDispatch): boolean {
  return s.phase === "AwaitingNotices";
}

/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
//@ pure
export function prepareDispatch(s: AlertDispatch, noticeCount: number, postsLastHour: number, hourlyLimit: number): AlertDispatch {
  //@ ensures (inv(s) && canPrepareDispatch(s)) ==> stepResultFollowsAttempt(s, \result)
  return { phase: noticeCount === 0 ? "NoNotices" : (postsLastHour >= hourlyLimit ? "HeldByLimit" : "PostingNotices") };
}

/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
//@ pure
export function canRecordDelivery(s: AlertDispatch): boolean {
  return s.phase === "PostingNotices";
}

/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
//@ pure
export function recordDelivery(s: AlertDispatch, accepted: boolean): AlertDispatch {
  //@ ensures (inv(s) && canRecordDelivery(s)) ==> stepResultFollowsAttempt(s, \result)
  return { phase: accepted ? "NoticesAccepted" : "PostRejected" };
}

/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
//@ pure
export function batchWasAttempted(s: AlertDispatch): boolean {
  return s.phase === "NoticesAccepted" || s.phase === "PostRejected";
}

/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
//@ pure
export function batchWasAccepted(s: AlertDispatch): boolean {
  return s.phase === "NoticesAccepted";
}

/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
//@ pure
export function batchWasHeld(s: AlertDispatch): boolean {
  return s.phase === "HeldByLimit";
}

/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
//@ pure
export function sometimesRejected(s: AlertDispatch): boolean {
  return s.phase === "PostRejected";
}

/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
//@ pure
export function stepResultFollowsAttempt(before: AlertDispatch, after: AlertDispatch): boolean {
  return !(batchWasAttempted(after) && !batchWasAttempted(before)) || before.phase === "PostingNotices";
}

/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
//@ pure
export function sometimesHeld(s: AlertDispatch): boolean {
  return batchWasHeld(s);
}

/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
//@ pure
export function sometimesAccepted(s: AlertDispatch): boolean {
  return batchWasAccepted(s);
}

/** Story: Report the result of each operations round / Collect scheduled rounds and reuse fresh metrics (spec/opsAlertDispatch.md) */
//@ pure
export function opsRoundDue(elapsedMs: number, intervalMs: number): boolean {
  return !(elapsedMs < intervalMs);
}

/** Story: Report the result of each operations round / Collect scheduled rounds and reuse fresh metrics (spec/opsAlertDispatch.md) */
//@ pure
export function cachedOpsMetricsFresh(elapsedMs: number): boolean {
  return elapsedMs < metricsFreshMs;
}

/** Story: Report the result of each operations round / A completed round reports the post separately from its heartbeat (spec/opsAlertDispatch.md) */
//@ pure
export function roundReport(hasNotices: boolean, postAttempted: boolean, delivered: boolean, heldNotices: boolean, heartbeatConfigured: boolean): RoundReport {
  return { logSummary: hasNotices, logFailure: postAttempted && !delivered, logLimit: heldNotices, pingHeartbeat: heartbeatConfigured };
}

/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) */
//@ pure
export function turnWatchAfterMs(possibleCompliance: boolean): number {
  return possibleCompliance ? turnWatchComplianceAfterMs : turnWatchReplyAfterMs;
}

/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) */
//@ pure
export function turnWatchUnconfirmed(receipt: TurnWatchReceipt, complianceReply: boolean): boolean {
  return receipt === "NoReceipt" || receipt === "ReceiptUnknown" || (receipt === "ReceiptRejected" && complianceReply);
}

/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) */
//@ pure
export function turnWatchPossibleCompliance(condition: TurnWatchCondition, complianceReply: boolean): boolean {
  return condition === "TurnUnresolved" || complianceReply;
}

/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) */
//@ pure
export function lawAcceptedReceiptConfirms(complianceReply: boolean): boolean {
  //@ ensures \result === true
  return !turnWatchUnconfirmed("ReceiptAccepted", complianceReply);
}

/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) */
//@ pure
export function lawRejectedComplianceIsWatched(receipt: TurnWatchReceipt): boolean {
  //@ ensures \result === true
  return !turnWatchUnconfirmed(receipt, false) || turnWatchUnconfirmed(receipt, true);
}

/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) */
//@ pure
export function turnWatchOverdue(condition: TurnWatchCondition, complianceReply: boolean, ageMs: number): boolean {
  return ageMs >= turnWatchAfterMs(turnWatchPossibleCompliance(condition, complianceReply)) && (condition === "TurnUnresolved" || ageMs < turnWatchWindowMs);
}

/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) */
//@ pure
export function lawComplianceIsWatchedSooner(condition: TurnWatchCondition, ageMs: number): boolean {
  //@ ensures \result === true
  return !turnWatchOverdue(condition, false, ageMs) || turnWatchOverdue(condition, true, ageMs);
}

/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) */
//@ pure
export function lawFreshTurnIsNotOverdue(condition: TurnWatchCondition, complianceReply: boolean, ageMs: number): boolean {
  //@ ensures \result === true
  return !(ageMs < turnWatchComplianceAfterMs) || !turnWatchOverdue(condition, complianceReply, ageMs);
}

/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) */
//@ pure
export function lawUnresolvedTurnStaysWatched(complianceReply: boolean, ageMs: number): boolean {
  //@ ensures \result === true
  return !(ageMs >= turnWatchComplianceAfterMs) || turnWatchOverdue("TurnUnresolved", complianceReply, ageMs);
}

/** Story: Hear when a shared-line turn may have reached nobody / Each condition is one alert, and a possible STOP makes it bad and first (spec/opsAlertDispatch.md) */
//@ pure
export function turnWatchRaises(overdueCount: number): boolean {
  return overdueCount > 0;
}

/** Story: Hear when a shared-line turn may have reached nobody / Each condition is one alert, and a possible STOP makes it bad and first (spec/opsAlertDispatch.md) */
//@ pure
export function turnWatchLevel(complianceCount: number): string {
  return complianceCount > 0 ? "bad" : "warn";
}

/** Story: Hear when a shared-line turn may have reached nobody / Each condition is one alert, and a possible STOP makes it bad and first (spec/opsAlertDispatch.md) */
//@ pure
export function turnWatchLeads(complianceCount: number): boolean {
  return complianceCount > 0;
}

/** Story: Hear when a shared-line turn may have reached nobody / Each condition is one alert, and a possible STOP makes it bad and first (spec/opsAlertDispatch.md) */
//@ pure
export function turnWatchAlertKey(condition: TurnWatchCondition): string {
  return condition === "RepliesUnconfirmed" ? "turn_unconfirmed" : (condition === "TurnUnresolved" ? "turn_unresolved" : "deliver_unknown");
}

/** Story: Hear when a shared-line turn may have reached nobody / Each condition is one alert, and a possible STOP makes it bad and first (spec/opsAlertDispatch.md) */
//@ pure
export function lawPossibleStopIsBad(complianceCount: number): boolean {
  //@ ensures \result === true
  return !(complianceCount > 0) || (turnWatchLevel(complianceCount) === "bad" && turnWatchLeads(complianceCount));
}

/** Story: Hear when a shared-line turn may have reached nobody / Each condition is one alert, and a possible STOP makes it bad and first (spec/opsAlertDispatch.md) */
//@ pure
export function lawTurnWatchKeysDiffer(first: TurnWatchCondition, second: TurnWatchCondition): boolean {
  //@ ensures \result === true
  return !(first !== second) || turnWatchAlertKey(first) !== turnWatchAlertKey(second);
}

/** Story: Hear when the public event catalog stops refreshing / The catalog alerts when its last scan is older than a day and one retry (spec/opsAlertDispatch.md) */
//@ pure
export function catalogScanOverdue(scanned: boolean, scanAgeMs: number, uptimeMs: number): boolean {
  return scanned ? scanAgeMs > catalogStaleAfterMs : uptimeMs > catalogStaleAfterMs;
}

/** Story: Hear when the public event catalog stops refreshing / The catalog alerts when its last scan is older than a day and one retry (spec/opsAlertDispatch.md) */
//@ pure
export function lawRecentScanIsQuiet(scanAgeMs: number, uptimeMs: number): boolean {
  //@ ensures \result === true
  return !(scanAgeMs <= catalogStaleAfterMs) || !catalogScanOverdue(true, scanAgeMs, uptimeMs);
}

/** Story: Hear when the public event catalog stops refreshing / The catalog alerts when its last scan is older than a day and one retry (spec/opsAlertDispatch.md) */
//@ pure
export function lawMissedDayAndRetryAlerts(uptimeMs: number): boolean {
  //@ ensures \result === true
  return catalogScanOverdue(true, exact_opsAlertDispatch(catalogStaleAfterMs + 1), uptimeMs);
}

/** Story: Hear when the public event catalog stops refreshing / The catalog alerts when its last scan is older than a day and one retry (spec/opsAlertDispatch.md) */
//@ pure
export function lawNewProcessWaitsForFirstScan(scanAgeMs: number): boolean {
  //@ ensures \result === true
  return !catalogScanOverdue(false, scanAgeMs, catalogStaleAfterMs);
}

/** Story: Hear when the review judge stops working or approves too much / The review judge alerts when it cannot run or approves above its qualified rate (spec/opsAlertDispatch.md) */
//@ pure
export function judgeDownRaises(cannotRun: number): boolean {
  return cannotRun > judgeCannotRunAlertAbove;
}

/** Story: Hear when the review judge stops working or approves too much / The review judge alerts when it cannot run or approves above its qualified rate (spec/opsAlertDispatch.md) */
//@ pure
export function judgeRateRaises(approved: number, held: number, qualified: boolean, qualifiedRateBp: number): boolean {
  return qualified && exact_opsAlertDispatch(approved + held) >= judgeRateMinDecisions && exact_opsAlertDispatch(approved * 10000) > exact_opsAlertDispatch(exact_opsAlertDispatch(qualifiedRateBp + judgeRateMarginBp) * exact_opsAlertDispatch(approved + held));
}

/** Story: Hear when the review judge stops working or approves too much / The review judge alerts when it cannot run or approves above its qualified rate (spec/opsAlertDispatch.md) */
//@ pure
export function lawFewDecisionsAreQuiet(approved: number, held: number, qualifiedRateBp: number): boolean {
  //@ ensures \result === true
  return !(exact_opsAlertDispatch(approved + held) < judgeRateMinDecisions) || !judgeRateRaises(approved, held, true, qualifiedRateBp);
}

/** Story: Hear when the review judge stops working or approves too much / The review judge alerts when it cannot run or approves above its qualified rate (spec/opsAlertDispatch.md) */
//@ pure
export function lawNoRecordIsQuiet(approved: number, held: number, qualifiedRateBp: number): boolean {
  //@ ensures \result === true
  return !judgeRateRaises(approved, held, false, qualifiedRateBp);
}

/** Story: Hear when the review judge stops working or approves too much / The review judge alerts when it cannot run or approves above its qualified rate (spec/opsAlertDispatch.md) */
//@ pure
export function lawTenCannotRunIsQuiet(cannotRun: number): boolean {
  //@ ensures \result === true
  return !(cannotRun <= judgeCannotRunAlertAbove) || !judgeDownRaises(cannotRun);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: AlertDispatch, event: Event): boolean {
  if (event.type === "prepareDispatch") return canPrepareDispatch(current);
  if (event.type === "recordDelivery") return canRecordDelivery(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: AlertDispatch, event: Event): AlertDispatch {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "prepareDispatch") return canPrepareDispatch(current) ? prepareDispatch(current, event.noticeCount, event.postsLastHour, event.hourlyLimit) : current;
  if (event.type === "recordDelivery") return canRecordDelivery(current) ? recordDelivery(current, event.accepted) : current;
  return current;
}

/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseEvent(x: unknown): Event | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "prepareDispatch" && Number.isSafeInteger(raw.noticeCount) && Number.isSafeInteger(raw.postsLastHour) && Number.isSafeInteger(raw.hourlyLimit)) return { type: "prepareDispatch", noticeCount: raw.noticeCount, postsLastHour: raw.postsLastHour, hourlyLimit: raw.hourlyLimit };
  if (raw.type === "recordDelivery" && typeof raw.accepted === "boolean") return { type: "recordDelivery", accepted: raw.accepted };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): AlertDispatch | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "AwaitingNotices" || raw.phase === "NoNotices" || raw.phase === "HeldByLimit" || raw.phase === "PostingNotices" || raw.phase === "NoticesAccepted" || raw.phase === "PostRejected") && Object.keys(raw).length === 1)) return undefined;
  const parsed: AlertDispatch = ({ phase: raw.phase });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): AlertDispatch {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_opsAlertDispatch(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
