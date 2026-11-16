// Generated from packages/core/src/vibe/oauthGrantIssuanceShell.vibe. Run pnpm run spec:sync.
import { runPromise, tryPromise } from "effect/Effect";
import { $catchExpression, $schemaErrorMatcher, TaggedError } from "vibelang-runtime/internal";
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
                if (checked.phase !== "AwaitingApproval") {
                    completion_1 = { kind: "return", value: { kind: "denied" } };
                    return completion_1.value;
                }
                const prepared = yield* io(() => effects.prepareIssuance(grant, at));
                const approvalAt = yield* io(() => effects.now());
                const committed = yield* runtime.$catch(yield* (() => { return Effect.sync(() => { return io(() => prepared.commit(approvalAt, approval => runPromise(Effect.gen(function* () {
                    const checkedAt = yield* io(() => effects.now());
                    const state = yield* issuance.send({ type: "checkLockedApproval", approval: {
                            ownerMatches: approval.e164 === request.e164 && approval.personId === request.personId,
                            lockedRequestLive: requestIsLive(checkedAt, approval.expiresAt),
                            pendingGrantLive: requestIsLive(checkedAt, grant.expiresAt),
                        } });
                    return state.phase === "AwaitingCommit";
                })))); }); })(), () => Effect.sync(() => { return undefined; }));
                if (committed === undefined) {
                    yield* issuance.send({ type: "recordStorageFailure" });
                    {
                        completion_1 = { kind: "return", value: { kind: "retry" } };
                        return completion_1.value;
                    }
                }
                const issued = yield* issuance.send({ type: "recordCommit", committed });
                {
                    completion_1 = { kind: "return", value: issued.phase === "GrantIssued" ? { kind: "issued", grant, code: prepared.code } : { kind: "expired" } };
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
