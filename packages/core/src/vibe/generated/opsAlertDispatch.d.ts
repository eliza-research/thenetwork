// Generated from spec/opsAlertDispatch.md via Vibestack and VibeLang. Run pnpm run spec:sync.
/** Story: Receive useful operations alerts without duplicate notices / An alert sends when it starts, gets worse, or reaches its repeat time (spec/opsAlertDispatch.md) */
export interface FiringEvidence {
    episodeOpen: boolean;
    postedBefore: boolean;
    latestLevel: string;
    sentLevel: string;
    bumpOnCount: boolean;
    latestCount: number;
    sentCount: number;
    elapsedMs: number;
    repeatMs: number;
}
/** Story: Receive useful operations alerts without duplicate notices / An alert sends when it starts, gets worse, or reaches its repeat time (spec/opsAlertDispatch.md) */
export type FiringPlan = "StartAlert" | "SendAgain" | "UpdateOnly";
/** Story: Receive useful operations alerts without duplicate notices / An absent alert resolves after a successful notice (spec/opsAlertDispatch.md) */
export type MissingPlan = "KeepEpisode" | "CloseQuietly" | "SendResolution";
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
export type DispatchPhase = "AwaitingNotices" | "NoNotices" | "HeldByLimit" | "PostingNotices" | "NoticesAccepted" | "PostRejected";
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
export interface AlertDispatch {
    phase: DispatchPhase;
}
/** Story: Report the result of each operations round / A completed round reports the post separately from its heartbeat (spec/opsAlertDispatch.md) */
export interface RoundReport {
    logSummary: boolean;
    logFailure: boolean;
    logLimit: boolean;
    pingHeartbeat: boolean;
}
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) */
export type TurnWatchCondition = "RepliesUnconfirmed" | "TurnUnresolved" | "DeliveryUnknown";
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) */
export type TurnWatchReceipt = "NoReceipt" | "ReceiptUnknown" | "ReceiptRejected" | "ReceiptAccepted";
/** One variant per transition in the spec. */
export type Event = {
    type: "prepareDispatch";
    noticeCount: number;
    postsLastHour: number;
    hourlyLimit: number;
} | {
    type: "recordDelivery";
    accepted: boolean;
};
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
export declare const alertPostWindowMs: number;
/** Story: Report the result of each operations round / Collect scheduled rounds and reuse fresh metrics (spec/opsAlertDispatch.md) */
export declare const metricsFreshMs: number;
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) */
export declare const turnWatchComplianceAfterMs: number;
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) */
export declare const turnWatchReplyAfterMs: number;
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) */
export declare const turnWatchWindowMs: number;
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
export declare const initial: AlertDispatch;
/** Story: Hear when the public event catalog stops refreshing / The catalog alerts when its last scan is older than a day and one retry (spec/opsAlertDispatch.md) */
export declare const catalogStaleAfterMs: number;
/** Every `always` rule at once. Holds initially and after every transition. */
export declare function inv(current: AlertDispatch): boolean;
/** Story: Receive useful operations alerts without duplicate notices / An alert sends when it starts, gets worse, or reaches its repeat time (spec/opsAlertDispatch.md) */
export declare function chooseFiringPlan(e: FiringEvidence): FiringPlan;
/** Story: Receive useful operations alerts without duplicate notices / An absent alert resolves after a successful notice (spec/opsAlertDispatch.md) */
export declare function chooseMissingPlan(episodeOpen: boolean, seenThisRound: boolean, postedBefore: boolean): MissingPlan;
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
export declare function canPrepareDispatch(s: AlertDispatch): boolean;
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
export declare function prepareDispatch(s: AlertDispatch, noticeCount: number, postsLastHour: number, hourlyLimit: number): AlertDispatch;
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
export declare function canRecordDelivery(s: AlertDispatch): boolean;
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
export declare function recordDelivery(s: AlertDispatch, accepted: boolean): AlertDispatch;
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
export declare function batchWasAttempted(s: AlertDispatch): boolean;
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
export declare function batchWasAccepted(s: AlertDispatch): boolean;
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
export declare function batchWasHeld(s: AlertDispatch): boolean;
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
export declare function sometimesRejected(s: AlertDispatch): boolean;
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
export declare function stepResultFollowsAttempt(before: AlertDispatch, after: AlertDispatch): boolean;
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
export declare function sometimesHeld(s: AlertDispatch): boolean;
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
export declare function sometimesAccepted(s: AlertDispatch): boolean;
/** Story: Report the result of each operations round / Collect scheduled rounds and reuse fresh metrics (spec/opsAlertDispatch.md) */
export declare function opsRoundDue(elapsedMs: number, intervalMs: number): boolean;
/** Story: Report the result of each operations round / Collect scheduled rounds and reuse fresh metrics (spec/opsAlertDispatch.md) */
export declare function cachedOpsMetricsFresh(elapsedMs: number): boolean;
/** Story: Report the result of each operations round / A completed round reports the post separately from its heartbeat (spec/opsAlertDispatch.md) */
export declare function roundReport(hasNotices: boolean, postAttempted: boolean, delivered: boolean, heldNotices: boolean, heartbeatConfigured: boolean): RoundReport;
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) */
export declare function turnWatchAfterMs(possibleCompliance: boolean): number;
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) */
export declare function turnWatchUnconfirmed(receipt: TurnWatchReceipt, complianceReply: boolean): boolean;
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) */
export declare function turnWatchPossibleCompliance(condition: TurnWatchCondition, complianceReply: boolean): boolean;
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) */
export declare function lawAcceptedReceiptConfirms(complianceReply: boolean): boolean;
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) */
export declare function lawRejectedComplianceIsWatched(receipt: TurnWatchReceipt): boolean;
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) */
export declare function turnWatchOverdue(condition: TurnWatchCondition, complianceReply: boolean, ageMs: number): boolean;
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) */
export declare function lawComplianceIsWatchedSooner(condition: TurnWatchCondition, ageMs: number): boolean;
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) */
export declare function lawFreshTurnIsNotOverdue(condition: TurnWatchCondition, complianceReply: boolean, ageMs: number): boolean;
/** Story: Hear when a shared-line turn may have reached nobody / Each unconfirmed turn condition becomes overdue after its threshold (spec/opsAlertDispatch.md) */
export declare function lawUnresolvedTurnStaysWatched(complianceReply: boolean, ageMs: number): boolean;
/** Story: Hear when a shared-line turn may have reached nobody / Each condition is one alert, and a possible STOP makes it bad and first (spec/opsAlertDispatch.md) */
export declare function turnWatchRaises(overdueCount: number): boolean;
/** Story: Hear when a shared-line turn may have reached nobody / Each condition is one alert, and a possible STOP makes it bad and first (spec/opsAlertDispatch.md) */
export declare function turnWatchLevel(complianceCount: number): string;
/** Story: Hear when a shared-line turn may have reached nobody / Each condition is one alert, and a possible STOP makes it bad and first (spec/opsAlertDispatch.md) */
export declare function turnWatchLeads(complianceCount: number): boolean;
/** Story: Hear when a shared-line turn may have reached nobody / Each condition is one alert, and a possible STOP makes it bad and first (spec/opsAlertDispatch.md) */
export declare function turnWatchAlertKey(condition: TurnWatchCondition): string;
/** Story: Hear when a shared-line turn may have reached nobody / Each condition is one alert, and a possible STOP makes it bad and first (spec/opsAlertDispatch.md) */
export declare function lawPossibleStopIsBad(complianceCount: number): boolean;
/** Story: Hear when a shared-line turn may have reached nobody / Each condition is one alert, and a possible STOP makes it bad and first (spec/opsAlertDispatch.md) */
export declare function lawTurnWatchKeysDiffer(first: TurnWatchCondition, second: TurnWatchCondition): boolean;
/** Story: Hear when the public event catalog stops refreshing / The catalog alerts when its last scan is older than a day and one retry (spec/opsAlertDispatch.md) */
export declare function catalogScanOverdue(scanned: boolean, scanAgeMs: number, uptimeMs: number): boolean;
/** Story: Hear when the public event catalog stops refreshing / The catalog alerts when its last scan is older than a day and one retry (spec/opsAlertDispatch.md) */
export declare function lawRecentScanIsQuiet(scanAgeMs: number, uptimeMs: number): boolean;
/** Story: Hear when the public event catalog stops refreshing / The catalog alerts when its last scan is older than a day and one retry (spec/opsAlertDispatch.md) */
export declare function lawMissedDayAndRetryAlerts(uptimeMs: number): boolean;
/** Story: Hear when the public event catalog stops refreshing / The catalog alerts when its last scan is older than a day and one retry (spec/opsAlertDispatch.md) */
export declare function lawNewProcessWaitsForFirstScan(scanAgeMs: number): boolean;
/** Do the rules allow this event in this state? */
export declare function enabled(current: AlertDispatch, event: Event): boolean;
/** Apply an event. An event the rules do not allow leaves the state unchanged. */
export declare function step(current: AlertDispatch, event: Event): AlertDispatch;
/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
export declare function parseEvent(x: unknown): Event | undefined;
/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
export declare function parseState(x: unknown): AlertDispatch | undefined;
/** Proof obligation: the initial state satisfies every `always` rule. */
export declare function initialHolds(): AlertDispatch;
/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export declare function exact_opsAlertDispatch(n: number): number;
