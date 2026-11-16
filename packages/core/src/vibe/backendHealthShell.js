// Generated from packages/core/src/vibe/backendHealthShell.vibe. Run bun run spec:sync.
import { promise, runPromise } from "effect/Effect";
import { $schemaErrorMatcher, TaggedError } from "vibelang-runtime/internal";
import * as Effect from "effect/Effect";
import { apply, initial } from "./generated/backendHealth.effect.js";
class MissingHealthReport extends TaggedError("MissingHealthReport") {
    static {
        $schemaErrorMatcher(this, "MissingHealthReport", true);
    }
}
export function checkBackendHealth(serving, effects) {
    return runPromise(Effect.gen(function* () {
        const admission = yield* apply(initial, { type: "checkAdmission", serving });
        if (admission.tag === "Reported")
            return admission.status;
        const reachable = yield* promise(() => effects.ping().catch(() => false));
        const database = yield* apply(admission, { type: "checkDatabase", reachable });
        if (database.tag === "Reported")
            return database.status;
        const late = yield* Effect.sync(() => effects.hasLateTick());
        const report = yield* apply(database, { type: "checkTicks", late });
        if (report.tag !== "Reported")
            return yield* Effect.fail(new MissingHealthReport());
        return report.status;
    }));
}
