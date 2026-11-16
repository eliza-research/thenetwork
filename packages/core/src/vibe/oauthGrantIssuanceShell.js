// Generated from packages/core/src/vibe/oauthGrantIssuanceShell.vibe. Run pnpm run spec:sync.
import { runPromise, tryPromise } from "effect/Effect";
import { $schemaErrorMatcher, TaggedError } from "vibelang-runtime/internal";
import * as Effect from "effect/Effect";
import * as runtime from "vibelang-runtime/internal";
import { Machine, machine, requestIsLive } from "./generated/oauthGrantIssuance.effect.js";
const authorityResult = {
    valid: "AuthorityValid",
    invalid: "AuthorityInvalid",
    unavailable: "AuthorityUnavailable",
};
class GrantIssuanceIOFailure extends TaggedError("GrantIssuanceIOFailure") {
    static {
        $schemaErrorMatcher(this, "GrantIssuanceIOFailure", true);
    }
}
function io(work) {
    return tryPromise({ try: async () => work(), catch: cause => new GrantIssuanceIOFailure({ cause }) });
}
/** Run a new issuance machine for each browser approval. */
export async function issueConnectorGrant(request, effects) {
    try {
        return await runPromise(Effect.gen(function* () {
            let completion_1 = runtime.$normal;
            yield* Effect.provide(Effect.fnUntraced(function* () {
                const issuance = yield* Machine;
                const at = yield* io(() => effects.now());
                const began = yield* issuance.send({ type: "beginApproval", requestLive: requestIsLive(at, request.expiresAt) });
                if (began.phase !== "AwaitingAuthority") {
                    completion_1 = { kind: "return", value: { kind: "expired" } };
                    return completion_1.value;
                }
                const grant = yield* io(() => effects.makeGrant(at));
                const authority = yield* io(() => effects.checkAuthority(grant));
                const checked = yield* issuance.send({ type: "checkGrantAuthority", authority: authorityResult[authority] });
                if (checked.phase === "RetryAuthority") {
                    completion_1 = { kind: "return", value: { kind: "retry" } };
                    return completion_1.value;
                }
                if (checked.phase !== "AwaitingConsumption") {
                    completion_1 = { kind: "return", value: { kind: "denied" } };
                    return completion_1.value;
                }
                const approvalAt = yield* io(() => effects.now());
                const approved = yield* io(() => effects.consumeApproval(approvalAt));
                const ownerMatches = !!approved?.e164 && approved.e164 === request.e164 && approved.personId === request.personId;
                const consumedRequestLive = ownerMatches && requestIsLive(yield* io(() => effects.now()), approved.expiresAt);
                const pendingGrantLive = consumedRequestLive && requestIsLive(yield* io(() => effects.now()), grant.expiresAt);
                const consumed = yield* issuance.send({ type: "checkConsumption", consumption: { ownerMatches, consumedRequestLive, pendingGrantLive } });
                if (consumed.phase !== "AwaitingPersistence") {
                    completion_1 = { kind: "return", value: { kind: "expired" } };
                    return completion_1.value;
                }
                yield* io(() => effects.putGrant(grant));
                yield* issuance.send({ type: "recordGrant" });
                const code = yield* io(() => effects.putCode(grant, at));
                yield* issuance.send({ type: "recordCode" });
                yield* io(() => effects.audit(grant, at));
                const issued = yield* issuance.send({ type: "recordIssuance" });
                {
                    completion_1 = { kind: "return", value: issued.phase === "GrantIssued" ? { kind: "issued", code } : { kind: "expired" } };
                    return completion_1.value;
                }
            })(), machine());
            if (completion_1.kind === "return")
                return completion_1.value;
        }));
    }
    catch (error) {
        if (error instanceof GrantIssuanceIOFailure)
            throw error.cause;
        throw error;
    }
}
