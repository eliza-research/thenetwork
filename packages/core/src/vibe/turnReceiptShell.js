// Generated from packages/core/src/vibe/turnReceiptShell.vibe. Run pnpm run spec:sync.
import * as Effect from "effect/Effect";
import { runPromise, tryPromise } from "effect/Effect";
import { $schemaErrorMatcher, TaggedError } from "vibelang-runtime/internal";
import * as Effect_1 from "effect/Effect";
import { apply, initial, noHistoryAllowed, receiptAccepted, receiptFinal, receiptMessageStatus, receiptReplyIdsMatch } from "./generated/turnReceipt.effect.js";
class ReceiptIOFailure extends TaggedError("ReceiptIOFailure") {
    static {
        $schemaErrorMatcher(this, "ReceiptIOFailure", true);
    }
}
class UnexpectedReceiptPhase extends TaggedError("UnexpectedReceiptPhase") {
    static {
        $schemaErrorMatcher(this, "UnexpectedReceiptPhase", true);
    }
}
function io(work) {
    return tryPromise({ try: work, catch: cause => new ReceiptIOFailure({ cause }) });
}
function inspect(work) {
    return Effect.try({ try: work, catch: cause => new ReceiptIOFailure({ cause }) });
}
/** Called inside the transaction that holds the stored turn's row lock. */
export async function recordSignedTurnReceipt(input, effects) {
    try {
        return await runPromise(Effect_1.gen(function* () {
            const claim = yield* io(() => effects.readTurn());
            const turn = yield* apply(initial, { type: "checkTurn", handled: claim !== undefined });
            if (turn.phase === "TurnUnavailable")
                return turn.phase;
            if (claim === undefined)
                return yield* Effect_1.fail(new UnexpectedReceiptPhase({ phase: turn.phase }));
            const validAuthority = yield* inspect(() => effects.authorityIsCurrent(claim));
            const authority = yield* apply(turn, { type: "checkAuthority", validAuthority });
            if (authority.phase === "AuthorityInvalid")
                return authority.phase;
            const alreadyStored = Boolean(claim.receipt_hash);
            // The two signed senders can encode identical receipt values with different object key order.
            const identical = claim.receipt_hash === input.digest
                || (alreadyStored && (yield* inspect(() => effects.receiptValuesMatch(claim))));
            const previous = yield* apply(authority, {
                type: "readPrevious", identical, alreadyStored,
                previouslyUnknown: claim.receipt?.outcome === "unknown", finalDelivery: receiptFinal(input.delivery),
            });
            if (previous.phase === "Replayed" || previous.phase === "Conflict")
                return previous.phase;
            const orderedIdsMatch = receiptReplyIdsMatch(claim.replies.map(reply => reply.id), input.replyIds);
            let ready = yield* apply(previous, {
                type: "checkScope", collectedReplies: claim.replies.length > 0, orderedIdsMatch,
                providerIds: input.providerIds, history: input.history,
            });
            if (ready.phase === "ScopeInvalid")
                return ready.phase;
            if (ready.phase === "CheckingDelivery") {
                const response = claim.response;
                ready = yield* apply(ready, {
                    type: "checkDelivery", accepted: receiptAccepted(input.delivery), providerIds: input.providerIds,
                    history: input.history, accountFree: noHistoryAllowed(response.accountEligible === false, response.replyKind, response.reason, response.memberId === null, claim.knownApp),
                });
                if (ready.phase === "DeliveryInvalid")
                    return ready.phase;
            }
            if (ready.phase === "AwaitingReplyWrite") {
                const status = receiptMessageStatus(input.delivery);
                yield* io(() => effects.writeReplies(claim, status));
            }
            else if (ready.phase !== "AwaitingEmptyWrite")
                return yield* Effect_1.fail(new UnexpectedReceiptPhase({ phase: ready.phase }));
            yield* io(() => effects.writeReceipt());
            const stored = yield* apply(ready, { type: "recordReceipt" });
            if (stored.phase !== "Stored")
                return yield* Effect_1.fail(new UnexpectedReceiptPhase({ phase: stored.phase }));
            return stored.phase;
        }));
    }
    catch (error) {
        if (error instanceof ReceiptIOFailure)
            throw error.cause;
        throw error;
    }
}
