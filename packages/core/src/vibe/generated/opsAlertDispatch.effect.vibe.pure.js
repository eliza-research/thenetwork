// Generated from spec/opsAlertDispatch.md via Vibestack and VibeLang. Run pnpm run spec:sync.
import * as M from "./opsAlertDispatch.js";
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) @throws {never} */
export const alertPostWindowMs = M.alertPostWindowMs;
/** Story: Report the result of each operations round / Collect scheduled rounds and reuse fresh metrics (spec/opsAlertDispatch.md) @throws {never} */
export const metricsFreshMs = M.metricsFreshMs;
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) @throws {never} */
export const initial = M.initial;
/** Every `always` rule at once. Holds initially and after every transition. @throws {never} */
export function inv(current) { return M.inv(current); }
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
