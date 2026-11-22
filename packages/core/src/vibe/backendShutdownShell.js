// Generated from packages/core/src/vibe/backendShutdownShell.vibe. Run pnpm run spec:sync.
import * as Duration from "effect/Duration";
import * as Option from "effect/Option";
import { promise, runPromise, timeoutOption } from "effect/Effect";
import * as Effect from "effect/Effect";
import { shutdownWasClean } from "./generated/backendLifecycle.effect.js";
export function finishBackendShutdown(graceMs, effects) {
    return runPromise(Effect.gen(function* () {
        const drained = yield* timeoutOption(Effect.gen(function* () {
            yield* promise(() => effects.stopListeners(false));
            yield* Effect.sync(() => effects.record({ type: "recordListenerDrain" }));
            yield* promise(() => effects.waitForWork());
        }), Duration.millis(graceMs));
        const outcome = yield* Effect.sync(() => effects.record({ type: "settleWorkDrain", timedOut: Option.isNone(drained) }));
        const clean = shutdownWasClean(outcome);
        if (!clean)
            yield* Effect.sync(() => effects.reportTimeout());
        yield* promise(() => effects.stopListeners(true));
        yield* promise(() => effects.closeService(!clean));
        yield* Effect.sync(() => effects.record({ type: "recordBackendClose" }));
        return clean;
    }));
}
