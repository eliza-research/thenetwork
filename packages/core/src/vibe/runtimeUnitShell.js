// Generated from packages/core/src/vibe/runtimeUnitShell.vibe. Run pnpm run spec:sync.
import * as Effect from "effect/Effect";
import { runPromise, tryPromise } from "effect/Effect";
import { $schemaErrorMatcher, TaggedError } from "vibelang-runtime/internal";
import * as Effect_1 from "effect/Effect";
import { apply, initial } from "./generated/runtimeUnit.effect.js";
class UnexpectedUnitPhase extends TaggedError("UnexpectedUnitPhase") {
    static {
        $schemaErrorMatcher(this, "UnexpectedUnitPhase", true);
    }
}
class StoredUnitIOFailure extends TaggedError("StoredUnitIOFailure") {
    static {
        $schemaErrorMatcher(this, "StoredUnitIOFailure", true);
    }
    ;
}
function io(operation, work) {
    return tryPromise({
        try: async () => work(),
        catch: cause => new StoredUnitIOFailure({ operation, cause }),
    });
}
/** Sequence the effects under the lock held by the caller. */
export async function runStoredNetworkUnit(effects) {
    try {
        return await runPromise(Effect_1.gen(function* () {
            const state = yield* io("load", () => effects.load());
            let unit = yield* apply(initial, { type: "recordLoad", snapshotFound: state !== undefined });
            if (unit.phase === "RestoringSnapshot" && state !== undefined) {
                yield* Effect.try({
                    try: () => effects.restore(state),
                    catch: cause => new StoredUnitIOFailure({ operation: "restore", cause }),
                });
                unit = yield* apply(unit, { type: "recordRestore" });
            }
            if (unit.phase !== "RunningAction")
                return yield* Effect_1.fail(new UnexpectedUnitPhase({ phase: unit.phase }));
            const out = yield* io("run", () => effects.run());
            const saving = yield* apply(unit, { type: "recordAction" });
            if (saving.phase !== "SavingState")
                return yield* Effect_1.fail(new UnexpectedUnitPhase({ phase: saving.phase }));
            yield* io("save", () => effects.save());
            const saved = yield* apply(saving, { type: "recordSave" });
            if (saved.phase !== "StateSaved")
                return yield* Effect_1.fail(new UnexpectedUnitPhase({ phase: saved.phase }));
            return out;
        }));
    }
    catch (error) {
        // The store and HTTP callers inspect the original rejection, including database error codes.
        if (error instanceof StoredUnitIOFailure)
            throw error.cause;
        throw error;
    }
}
