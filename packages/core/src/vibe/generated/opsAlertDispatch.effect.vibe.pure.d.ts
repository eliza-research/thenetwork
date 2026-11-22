// Generated from spec/opsAlertDispatch.md via Vibestack and VibeLang. Run pnpm run spec:sync.
import type { FiringEvidence, FiringPlan, MissingPlan, AlertDispatch, RoundReport, Event } from "./opsAlertDispatch.ts";
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) @throws {never} */
export declare const alertPostWindowMs: number;
/** Story: Report the result of each operations round / Collect scheduled rounds and reuse fresh metrics (spec/opsAlertDispatch.md) @throws {never} */
export declare const metricsFreshMs: number;
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) @throws {never} */
export declare const initial: AlertDispatch;
/** Every `always` rule at once. Holds initially and after every transition. @throws {never} */
export declare function inv(current: AlertDispatch): boolean;
/** Story: Receive useful operations alerts without duplicate notices / An alert sends when it starts, gets worse, or reaches its repeat time (spec/opsAlertDispatch.md) @throws {never} */
export declare function chooseFiringPlan(e: FiringEvidence): FiringPlan;
/** Story: Receive useful operations alerts without duplicate notices / An absent alert resolves after a successful notice (spec/opsAlertDispatch.md) @throws {never} */
export declare function chooseMissingPlan(episodeOpen: boolean, seenThisRound: boolean, postedBefore: boolean, sourceReadable: boolean): MissingPlan;
/** Story: Receive useful operations alerts without duplicate notices / An absent alert resolves after a successful notice (spec/opsAlertDispatch.md) @throws {never} */
export declare function lawUnreadSourceKeepsEpisode(episodeOpen: boolean, seenThisRound: boolean, postedBefore: boolean): boolean;
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) @throws {never} */
export declare function canPrepareDispatch(s: AlertDispatch): boolean;
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) @throws {never} */
export declare function prepareDispatch(s: AlertDispatch, noticeCount: number, postsLastHour: number, hourlyLimit: number): AlertDispatch;
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) @throws {never} */
export declare function canRecordDelivery(s: AlertDispatch): boolean;
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) @throws {never} */
export declare function recordDelivery(s: AlertDispatch, accepted: boolean): AlertDispatch;
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) @throws {never} */
export declare function batchWasAttempted(s: AlertDispatch): boolean;
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) @throws {never} */
export declare function batchWasAccepted(s: AlertDispatch): boolean;
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) @throws {never} */
export declare function batchWasHeld(s: AlertDispatch): boolean;
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) @throws {never} */
export declare function sometimesRejected(s: AlertDispatch): boolean;
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) @throws {never} */
export declare function stepResultFollowsAttempt(before: AlertDispatch, after: AlertDispatch): boolean;
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) @throws {never} */
export declare function sometimesHeld(s: AlertDispatch): boolean;
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) @throws {never} */
export declare function sometimesAccepted(s: AlertDispatch): boolean;
/** Story: Report the result of each operations round / Collect scheduled rounds and reuse fresh metrics (spec/opsAlertDispatch.md) @throws {never} */
export declare function opsRoundDue(elapsedMs: number, intervalMs: number): boolean;
/** Story: Report the result of each operations round / Collect scheduled rounds and reuse fresh metrics (spec/opsAlertDispatch.md) @throws {never} */
export declare function cachedOpsMetricsFresh(elapsedMs: number): boolean;
/** Story: Report the result of each operations round / A completed round reports the post separately from its heartbeat (spec/opsAlertDispatch.md) @throws {never} */
export declare function roundReport(hasNotices: boolean, postAttempted: boolean, delivered: boolean, heldNotices: boolean, heartbeatConfigured: boolean): RoundReport;
/** Do the rules allow this event in this state? @throws {never} */
export declare function enabled(current: AlertDispatch, event: Event): boolean;
/** Apply an event. An event the rules do not allow leaves the state unchanged. @throws {never} */
export declare function step(current: AlertDispatch, event: Event): AlertDispatch;
/** Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program: the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy with exactly the fields the event has, so nothing the caller keeps can change it afterwards. @throws {never} */
export declare function parseEvent(x: unknown): Event | undefined;
/** Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The result is a fresh copy, so nothing the caller keeps can change it afterwards. @throws {never} */
export declare function parseState(x: unknown): AlertDispatch | undefined;
/** A Machine never shares a state with its callers. @throws {never} */
export declare function snapshot_opsAlertDispatch<A>(value: A): A;
