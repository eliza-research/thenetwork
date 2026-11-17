// Generated from packages/core/src/vibe/webhookInboxShell.vibe. Run pnpm run spec:sync.
import { runPromise, tryPromise } from "effect/Effect";
import { $catchExpression, $schemaErrorMatcher, TaggedError } from "vibelang-runtime/internal";
import * as Effect from "effect/Effect";
import * as runtime from "vibelang-runtime/internal";
import { apply, chooseWebhook, earlierWebhookCancellable, initial } from "./generated/webhookInbox.effect.js";
class WebhookDrainIO extends TaggedError("WebhookDrainIO") {
    static {
        $schemaErrorMatcher(this, "WebhookDrainIO", true);
    }
}
function io(work) {
    return tryPromise({ try: work, catch: cause => new WebhookDrainIO({ cause }) });
}
/** A sender's advisory lock is held until the whole drain returns. */
export async function drainWebhookSender(effects) {
    try {
        return await runPromise(Effect.gen(function* () {
            let handled = 0;
            for (;;) {
                const window = yield* io(() => effects.readWindow());
                const oldest = window[0];
                const compliance = window.find(row => row.compliance);
                const blocked = oldest !== undefined && compliance === undefined
                    ? yield* io(() => effects.hasBlockingTurn()) : false;
                const selection = chooseWebhook(oldest !== undefined, compliance !== undefined, blocked);
                const row = selection === "RunCompliance" ? compliance : selection === "RunOldest" ? oldest : undefined;
                if (row === undefined)
                    return handled;
                let attempt = initial;
                const result = yield* runtime.$catch(yield* (() => { return Effect.sync(() => { return Effect.gen(function* () {
                    const outcome = yield* io(() => effects.handle(row));
                    attempt = yield* apply(attempt, { type: "recordHandled", stopCommand: row.stopCommand });
                    const cancelIds = attempt.phase === "CancelEarlier"
                        ? window.filter(item => earlierWebhookCancellable(item.id === row.id, item.compliance)).map(item => item.id)
                        : [];
                    const cancelled = yield* io(() => effects.complete(row, outcome, cancelIds));
                    return { kind: "completed", cancelled };
                }); }); })(), failure => Effect.sync(() => { return { kind: "failed", failure }; }));
                if (result.kind === "completed") {
                    yield* apply(attempt, { type: "recordCompletion" });
                    handled += 1 + result.cancelled;
                    continue;
                }
                const { failure } = result;
                if (!(failure instanceof WebhookDrainIO))
                    return yield* Effect.fail(failure);
                const attempts = row.attempts + 1;
                const failed = yield* apply(attempt, { type: "recordFailure", attempts, stopCommand: row.stopCommand });
                const drop = failed.phase === "DropWebhook";
                yield* io(() => effects.fail(row, attempts, drop, failure.cause));
                if (!drop)
                    return handled;
            }
        }));
    }
    catch (error) {
        if (error instanceof WebhookDrainIO)
            throw error.cause;
        throw error;
    }
}
