// Generated from spec/opsAlertDispatch.md via Vibestack and VibeLang. Run pnpm run spec:sync.
// GENERATED from spec/opsAlertDispatch.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
export const alertPostWindowMs = 3600000;
/** Story: Report the result of each operations round / Collect scheduled rounds and reuse fresh metrics (spec/opsAlertDispatch.md) */
export const metricsFreshMs = 15000;
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
export const initial = { phase: "AwaitingNotices" };
/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current) {
    return true;
}
/** Story: Receive useful operations alerts without duplicate notices / An alert sends when it starts, gets worse, or reaches its repeat time (spec/opsAlertDispatch.md) */
//@ pure
export function chooseFiringPlan(e) {
    return !e.episodeOpen ? "StartAlert" : (!e.postedBefore || (e.latestLevel === "bad" && e.sentLevel === "warn") || (e.bumpOnCount && e.latestCount > e.sentCount) || e.elapsedMs >= e.repeatMs ? "SendAgain" : "UpdateOnly");
}
/** Story: Receive useful operations alerts without duplicate notices / An absent alert resolves after a successful notice (spec/opsAlertDispatch.md) */
//@ pure
export function chooseMissingPlan(episodeOpen, seenThisRound, postedBefore, sourceReadable) {
    return !episodeOpen || seenThisRound || !sourceReadable ? "KeepEpisode" : (postedBefore ? "SendResolution" : "CloseQuietly");
}
/** Story: Receive useful operations alerts without duplicate notices / An absent alert resolves after a successful notice (spec/opsAlertDispatch.md) */
//@ pure
export function lawUnreadSourceKeepsEpisode(episodeOpen, seenThisRound, postedBefore) {
    //@ ensures \result === true
    return chooseMissingPlan(episodeOpen, seenThisRound, postedBefore, false) === "KeepEpisode";
}
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
//@ pure
export function canPrepareDispatch(s) {
    return s.phase === "AwaitingNotices";
}
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
//@ pure
export function prepareDispatch(s, noticeCount, postsLastHour, hourlyLimit) {
    //@ ensures (inv(s) && canPrepareDispatch(s)) ==> stepResultFollowsAttempt(s, \result)
    return { phase: noticeCount === 0 ? "NoNotices" : (postsLastHour >= hourlyLimit ? "HeldByLimit" : "PostingNotices") };
}
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
//@ pure
export function canRecordDelivery(s) {
    return s.phase === "PostingNotices";
}
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
//@ pure
export function recordDelivery(s, accepted) {
    //@ ensures (inv(s) && canRecordDelivery(s)) ==> stepResultFollowsAttempt(s, \result)
    return { phase: accepted ? "NoticesAccepted" : "PostRejected" };
}
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
//@ pure
export function batchWasAttempted(s) {
    return s.phase === "NoticesAccepted" || s.phase === "PostRejected";
}
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
//@ pure
export function batchWasAccepted(s) {
    return s.phase === "NoticesAccepted";
}
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
//@ pure
export function batchWasHeld(s) {
    return s.phase === "HeldByLimit";
}
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
//@ pure
export function sometimesRejected(s) {
    return s.phase === "PostRejected";
}
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
//@ pure
export function stepResultFollowsAttempt(before, after) {
    return !(batchWasAttempted(after) && !batchWasAttempted(before)) || before.phase === "PostingNotices";
}
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
//@ pure
export function sometimesHeld(s) {
    return batchWasHeld(s);
}
/** Story: Receive useful operations alerts without duplicate notices / One batch consumes one attempt in the rolling hour (spec/opsAlertDispatch.md) */
//@ pure
export function sometimesAccepted(s) {
    return batchWasAccepted(s);
}
/** Story: Report the result of each operations round / Collect scheduled rounds and reuse fresh metrics (spec/opsAlertDispatch.md) */
//@ pure
export function opsRoundDue(elapsedMs, intervalMs) {
    return !(elapsedMs < intervalMs);
}
/** Story: Report the result of each operations round / Collect scheduled rounds and reuse fresh metrics (spec/opsAlertDispatch.md) */
//@ pure
export function cachedOpsMetricsFresh(elapsedMs) {
    return elapsedMs < metricsFreshMs;
}
/** Story: Report the result of each operations round / A completed round reports the post separately from its heartbeat (spec/opsAlertDispatch.md) */
//@ pure
export function roundReport(hasNotices, postAttempted, delivered, heldNotices, heartbeatConfigured) {
    return { logSummary: hasNotices, logFailure: postAttempted && !delivered, logLimit: heldNotices, pingHeartbeat: heartbeatConfigured };
}
/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current, event) {
    if (event.type === "prepareDispatch")
        return canPrepareDispatch(current);
    if (event.type === "recordDelivery")
        return canRecordDelivery(current);
    return false;
}
/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current, event) {
    //@ requires inv(current)
    //@ ensures inv(\result)
    if (event.type === "prepareDispatch")
        return canPrepareDispatch(current) ? prepareDispatch(current, event.noticeCount, event.postsLastHour, event.hourlyLimit) : current;
    if (event.type === "recordDelivery")
        return canRecordDelivery(current) ? recordDelivery(current, event.accepted) : current;
    return current;
}
/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseEvent(x) {
    let raw;
    try {
        raw = JSON.parse(JSON.stringify(x));
    }
    catch {
        return undefined;
    }
    if (typeof raw !== "object" || raw === null)
        return undefined;
    if (raw.type === "prepareDispatch" && Number.isSafeInteger(raw.noticeCount) && Number.isSafeInteger(raw.postsLastHour) && Number.isSafeInteger(raw.hourlyLimit))
        return { type: "prepareDispatch", noticeCount: raw.noticeCount, postsLastHour: raw.postsLastHour, hourlyLimit: raw.hourlyLimit };
    if (raw.type === "recordDelivery" && typeof raw.accepted === "boolean")
        return { type: "recordDelivery", accepted: raw.accepted };
    return undefined;
}
/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x) {
    let raw;
    try {
        raw = JSON.parse(JSON.stringify(x));
    }
    catch {
        return undefined;
    }
    if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "AwaitingNotices" || raw.phase === "NoNotices" || raw.phase === "HeldByLimit" || raw.phase === "PostingNotices" || raw.phase === "NoticesAccepted" || raw.phase === "PostRejected") && Object.keys(raw).length === 1))
        return undefined;
    const parsed = ({ phase: raw.phase });
    return inv(parsed) ? parsed : undefined;
}
/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds() {
    //@ ensures inv(\result)
    return initial;
}
