// Generated from packages/core/src/vibe/outboundReceiptShell.vibe. Run pnpm run spec:sync.
import * as Effect from "effect/Effect";
import { runPromise, tryPromise } from "effect/Effect";
import { $catchExpression, $schemaErrorMatcher, TaggedError } from "vibelang-runtime/internal";
import * as Effect_1 from "effect/Effect";
import * as runtime from "vibelang-runtime/internal";
import { apply, initial } from "./generated/outboundReceipt.effect.js";
class SendIOFailure extends TaggedError("SendIOFailure") {
    static {
        $schemaErrorMatcher(this, "SendIOFailure", true);
    }
}
class UnexpectedSendPhase extends TaggedError("UnexpectedSendPhase") {
    static {
        $schemaErrorMatcher(this, "UnexpectedSendPhase", true);
    }
}
function io(work) {
    return tryPromise({ try: work, catch: cause => new SendIOFailure({ cause }) });
}
/** Run only after the queue has committed the send lease. */
export async function settleClaimedSend(hasAttemptsLeft, effects) {
    try {
        return await runPromise(Effect_1.gen(function* () {
            const received = yield* runtime.$catch(yield* (() => { return Effect_1.sync(() => { return Effect_1.gen(function* () {
                const receipt = yield* io(() => effects.send());
                return { kind: "receipt", receipt };
            }); }); })(), failure => Effect_1.sync(() => { return { kind: "providerError", cause: failure.cause }; }));
            if (received.kind === "receipt") {
                const saved = yield* runtime.$catch(yield* (() => { return Effect_1.sync(() => { return Effect_1.gen(function* () {
                    const result = yield* io(() => effects.saveReceipt(received.receipt));
                    return { kind: "saved", result };
                }); }); })(), () => Effect_1.sync(() => { return { kind: "unrecorded" }; }));
                if (saved.kind === "saved")
                    return saved.result;
                const held = yield* apply(initial, { type: "holdUnrecordedReceipt" });
                if (held.phase !== "AcceptanceUnknown")
                    return yield* Effect_1.fail(new UnexpectedSendPhase({ phase: held.phase }));
                return yield* io(() => effects.saveDisposition("AcceptanceUnknown", effects.unrecordedReceipt()));
            }
            const failure = yield* Effect.try({ try: () => effects.classifyError(received.cause), catch: cause => new SendIOFailure({ cause }) });
            const { phase } = yield* apply(initial, { type: "recordProviderError", failure: failure.kind, hasAttemptsLeft });
            switch (phase) {
                case "AcceptanceUnknown":
                case "RetryScheduled":
                case "WaitingForReply":
                case "ProviderBlocked":
                case "ProviderFailed":
                    return yield* io(() => effects.saveDisposition(phase, failure.error));
                default:
                    return yield* Effect_1.fail(new UnexpectedSendPhase({ phase }));
            }
        }));
    }
    catch (error) {
        if (error instanceof SendIOFailure)
            throw error.cause;
        throw error;
    }
}
