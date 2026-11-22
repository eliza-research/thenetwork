// Generated from packages/core/src/vibe/opsAlertShell.vibe. Run pnpm run spec:sync.
import { promise, runPromise, tryPromise } from "effect/Effect";
import { $schemaErrorMatcher, TaggedError } from "vibelang-runtime/internal";
import * as Effect from "effect/Effect";
import { alertPostWindowMs, apply, batchWasAccepted, batchWasAttempted, batchWasHeld, chooseFiringPlan, chooseMissingPlan, initial, } from "./generated/opsAlertDispatch.effect.js";
class AlertStoreFailure extends TaggedError("AlertStoreFailure") {
    static {
        $schemaErrorMatcher(this, "AlertStoreFailure", true);
    }
    ;
}
function prepareAlerts(alerts, stored, options) {
    const { now, repeatMs, sourceReadable } = options;
    const states = new Map(stored.map(state => [state.key, state]));
    const notices = [];
    const firing = [];
    const resolved = [];
    const seen = new Set();
    for (const alert of alerts) {
        seen.add(alert.key);
        const previous = states.get(alert.key);
        const decision = chooseFiringPlan({
            episodeOpen: !!previous?.open, postedBefore: previous?.lastSentAt !== undefined,
            latestLevel: alert.level, sentLevel: previous?.lastSentLevel ?? "warn", bumpOnCount: !!alert.bump,
            latestCount: alert.count, sentCount: previous?.lastSentCount ?? 0,
            elapsedMs: now - (previous?.lastSentAt ?? 0), repeatMs,
        });
        const state = decision !== "StartAlert" && previous
            ? { ...previous, level: alert.level, count: alert.count, text: alert.text, lastAt: now }
            : { key: alert.key, level: alert.level, count: alert.count, text: alert.text, open: true, firstAt: now, lastAt: now };
        states.set(state.key, state);
        if (decision !== "UpdateOnly") {
            notices.push({ key: state.key, level: state.level, count: state.count, text: state.text, state: "firing" });
            firing.push(state);
        }
    }
    for (const state of states.values()) {
        const decision = chooseMissingPlan(state.open, seen.has(state.key), state.lastSentAt !== undefined, sourceReadable(state.key));
        if (decision === "CloseQuietly")
            state.open = false;
        else if (decision === "SendResolution") {
            resolved.push(state);
            notices.push({ key: state.key, level: state.level, count: state.count, text: state.text, state: "resolved" });
        }
    }
    return { episodes: [...states.values()], notices, firing, resolved };
}
/** Run inside the adapter's existing exclusive store transaction. */
export function dispatchOperationsAlerts(alerts, tx, options) {
    return runPromise(Effect.gen(function* () {
        const { now, maxPostsPerHour } = options;
        const history = yield* tryPromise({
            try: () => tx.load(), catch: cause => new AlertStoreFailure({ message: "Could not load alert episodes", cause }),
        });
        const { episodes, notices, firing, resolved } = prepareAlerts(alerts, history, options);
        let postsLastHour = yield* tryPromise({
            try: () => tx.postsSince(now - alertPostWindowMs), catch: cause => new AlertStoreFailure({ message: "Could not count recent alert posts", cause }),
        });
        let batch = yield* apply(initial, { type: "prepareDispatch", noticeCount: notices.length, postsLastHour, hourlyLimit: maxPostsPerHour });
        if (batch.phase === "PostingNotices") {
            const accepted = yield* promise(() => options.post(notices).catch(() => false));
            yield* tryPromise({
                try: () => tx.recordPost(now, notices.length, accepted), catch: cause => new AlertStoreFailure({ message: "Could not record the alert post", cause }),
            });
            postsLastHour++;
            batch = yield* apply(batch, { type: "recordDelivery", accepted });
        }
        const ok = batchWasAccepted(batch);
        if (ok) {
            for (const state of firing) {
                state.lastSentAt = now;
                state.lastSentLevel = state.level;
                state.lastSentCount = state.count;
            }
            for (const state of resolved)
                state.open = false;
        }
        yield* tryPromise({
            try: () => tx.save(episodes), catch: cause => new AlertStoreFailure({ message: "Could not save alert episodes", cause }),
        });
        const open = episodes.filter(state => state.open).map(state => ({ key: state.key, level: state.level, count: state.count }));
        return { notices, posted: batchWasAttempted(batch), ok, held: batchWasHeld(batch) ? notices.length : 0, open, postsLastHour };
    }));
}
