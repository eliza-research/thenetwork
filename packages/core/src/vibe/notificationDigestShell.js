// Generated from packages/core/src/vibe/notificationDigestShell.vibe. Run pnpm run spec:sync.
import { runPromise, tryPromise } from "effect/Effect";
import { $schemaErrorMatcher, TaggedError } from "vibelang-runtime/internal";
import * as Effect from "effect/Effect";
import { apply, inboxItemAllowedForRecipient, inboxItemExpired, inboxItemStillPending, initial, } from "./generated/notificationDispatch.effect.js";
class DigestIOFailure extends TaggedError("DigestIOFailure") {
    static {
        $schemaErrorMatcher(this, "DigestIOFailure", true);
    }
    ;
}
function io(message, work) {
    return tryPromise({ try: work, catch: cause => new DigestIOFailure({ message, cause }) });
}
/** Re-read before the first write and enqueue only after recording succeeds. */
export function dispatchInboxDigest(planned, now, effects) {
    return runPromise(Effect.gen(function* () {
        const items = yield* io("Could not read the planned inbox items", () => effects.readItems(planned.itemIds));
        const pending = items.filter(item => inboxItemStillPending(item.seenAt !== undefined, item.notifiedAt !== undefined)
            && !inboxItemExpired(item.expiresAt !== undefined, item.expiresAt ?? 0, now));
        const recipient = pending.length > 0
            ? yield* io("Could not refresh the digest recipient", () => effects.readRecipient(planned.personId)) : undefined;
        const fresh = recipient === undefined ? [] : pending.filter(item => inboxItemAllowedForRecipient(item.urgency === "requested", recipient.proactiveAllowed));
        const changed = recipient !== undefined && (planned.to !== recipient.to || planned.channel !== recipient.prefs.channel || planned.timeZone !== recipient.timeZone);
        const refreshed = yield* apply(initial, { type: "rereadItems", plannedCount: planned.itemIds.length,
            remainingCount: fresh.length, recipientAvailable: recipient !== undefined, destinationChanged: changed });
        if (!recipient || refreshed.phase === "DigestCancelled")
            return { kind: "cancelled", deliveryId: planned.deliveryId };
        const final = refreshed.phase === "ReusingDigest" ? planned
            : yield* io("Could not rebuild the inbox digest", () => effects.rebuild(recipient, fresh));
        const recorded = yield* io("Could not record the inbox digest", () => effects.record(final));
        const ready = yield* apply(refreshed, { type: "recordDigest", recorded });
        if (ready.phase !== "EnqueueingDigest")
            return { kind: "cancelled", deliveryId: final.deliveryId };
        yield* io("Could not enqueue the inbox digest", () => effects.enqueue(final));
        yield* apply(ready, { type: "enqueueDigest" });
        return { kind: "queued", plan: final };
    }));
}
/** A queued body is immutable. Revalidate its complete item set at send time. */
export function queuedInboxDigestCurrent(deliveryId, now, effects) {
    return runPromise(Effect.gen(function* () {
        const record = yield* io("Could not read the queued digest", () => effects.readDelivery(deliveryId));
        const queued = yield* apply(initial, { type: "readQueuedDigest", sameDigest: record !== undefined && effects.idFor(record.personId, record.itemIds) === deliveryId });
        if (!record || queued.phase !== "ReadingQueuedItems")
            return false;
        const items = yield* io("Could not revalidate the queued digest items", () => effects.readItems(record.itemIds));
        const current = yield* apply(queued, {
            type: "revalidateQueuedItems",
            allPresent: items.length === record.itemIds.length,
            anyExpired: items.some(item => inboxItemExpired(item.expiresAt !== undefined, item.expiresAt ?? 0, now)),
            anyUnseen: items.some(item => item.seenAt === undefined),
        });
        return current.phase === "QueuedDigestNeeded";
    }));
}
