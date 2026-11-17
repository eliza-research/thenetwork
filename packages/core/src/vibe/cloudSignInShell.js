// Generated from packages/core/src/vibe/cloudSignInShell.vibe. Run pnpm run spec:sync.
import { runPromise, tryPromise } from "effect/Effect";
import { $schemaErrorMatcher, TaggedError } from "vibelang-runtime/internal";
import * as Effect from "effect/Effect";
import * as runtime from "vibelang-runtime/internal";
import { Machine, machine } from "./generated/cloudSignIn.effect.js";
class CloudCallbackEffectFailed extends TaggedError("CloudCallbackEffectFailed") {
    static {
        $schemaErrorMatcher(this, "CloudCallbackEffectFailed", true);
    }
}
function io(run) {
    return tryPromise({ try: async () => run(), catch: cause => new CloudCallbackEffectFailed({ cause }) });
}
/** Use one machine for each callback. The app supplies its Cloud and session operations. */
export function completeCloudSignIn(facts, handoff, effects) {
    return runPromise(Effect.gen(function* () {
        let completion_1 = runtime.$normal;
        yield* Effect.provide(Effect.fnUntraced(function* () {
            const callback = yield* Machine;
            const bound = yield* callback.send({ type: "checkHandoff", handoffFacts: facts });
            if (!handoff || bound.phase !== "AwaitingExchange") {
                completion_1 = { kind: "return", value: { status: 400 } };
                return completion_1.value;
            }
            const exchange = yield* io(() => effects.exchange(handoff));
            const exchanged = yield* callback.send({ type: "recordExchange", exchangeAccepted: exchange.accepted });
            if (exchanged.phase !== "AwaitingIdentity" || !exchange.accepted) {
                completion_1 = { kind: "return", value: { status: 403 } };
                return completion_1.value;
            }
            const identityAvailable = exchange.claims !== null && exchange.claims !== undefined;
            const identity = identityAvailable ? yield* io(() => effects.parseIdentity(exchange.claims)) : undefined;
            const checked = yield* callback.send({ type: "checkIdentity", identityAvailable, identityValid: identity !== undefined });
            if (checked.phase === "CloudUnavailable") {
                completion_1 = { kind: "return", value: { status: 503 } };
                return completion_1.value;
            }
            if (checked.phase !== "AwaitingPhone" || !identity) {
                completion_1 = { kind: "return", value: { status: 403 } };
                return completion_1.value;
            }
            const phoneAllowed = yield* io(() => effects.phoneAllowed(identity.e164));
            const eligible = yield* callback.send({ type: "checkPhone", phoneAllowed });
            if (eligible.phase !== "AwaitingSession") {
                completion_1 = { kind: "return", value: { status: 403 } };
                return completion_1.value;
            }
            yield* io(() => effects.endPreviousSession());
            yield* io(() => effects.recordPhoneSeen(identity.e164));
            const personId = yield* io(() => effects.findPersonId(identity.e164));
            const session = yield* io(() => effects.createSession(identity, personId));
            const issued = yield* callback.send({ type: "recordSession" });
            if (issued.phase !== "SignedIn") {
                completion_1 = { kind: "return", value: { status: 503 } };
                return completion_1.value;
            }
            {
                completion_1 = { kind: "return", value: { status: 303, returnPath: handoff.returnPath, identity, session } };
                return completion_1.value;
            }
        })(), machine());
        if (completion_1.kind === "return")
            return completion_1.value;
    }));
}
