// Generated from spec/notificationDispatch.md via Vibestack and VibeLang. Run pnpm run spec:sync.
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { orDie } from "effect/Effect";
import { $schemaErrorMatcher, TaggedError } from "vibelang-runtime/internal";
import * as Effect_1 from "effect/Effect";
import * as runtime from "vibelang-runtime/internal";
import { initial, inv, inboxItemStillPending, inboxItemAllowedForRecipient, rereadItems, canRereadItems, lawMissingRecipientCancels, digestItemSetCanBeRecorded, canRecordDigest, recordDigest, canEnqueueDigest, enqueueDigest, stepQueueRequiresRecordedDigest, sometimesQueuesDigest, sometimesCancelsDigest, inboxItemExpired, canReadQueuedDigest, readQueuedDigest, canRevalidateQueuedItems, revalidateQueuedItems, sometimesKeepsQueuedDigest, sometimesSuppressesQueuedDigest, enabled, step, parseEvent, parseState, snapshot_notificationDispatch } from "./notificationDispatch.effect.vibe.pure.js";
export { initial, inv, inboxItemStillPending, inboxItemAllowedForRecipient, rereadItems, canRereadItems, lawMissingRecipientCancels, digestItemSetCanBeRecorded, canRecordDigest, recordDigest, canEnqueueDigest, enqueueDigest, stepQueueRequiresRecordedDigest, sometimesQueuesDigest, sometimesCancelsDigest, inboxItemExpired, canReadQueuedDigest, readQueuedDigest, canRevalidateQueuedItems, revalidateQueuedItems, sometimesKeepsQueuedDigest, sometimesSuppressesQueuedDigest, enabled, step, parseEvent, parseState };
import * as KeyValueStore from "effect/persistence/KeyValueStore";
/** The rules do not allow this event in this state. */
export class Rejected extends TaggedError("Rejected") {
    static {
        $schemaErrorMatcher(this, "Rejected", true);
    }
}
/** An untrusted value that is not an event. */
export class NotAnEvent extends TaggedError("NotAnEvent") {
    static {
        $schemaErrorMatcher(this, "NotAnEvent", true);
    }
}
/** An untrusted value that is not a state satisfying every `always` rule. */
export class NotAState extends TaggedError("NotAState") {
    static {
        $schemaErrorMatcher(this, "NotAState", true);
    }
}
/** `parseEvent`, failing where it returns undefined. */
export function decodeEvent(input) {
    return Effect_1.gen(function* decodeEvent() {
        const event = parseEvent(input);
        if (event === undefined)
            return yield* Effect_1.fail(new NotAnEvent({ input }));
        return event;
    });
}
/** `parseState`, failing where it returns undefined. */
export function decodeState(input) {
    return Effect_1.gen(function* decodeState() {
        const parsed = parseState(input);
        if (parsed === undefined)
            return yield* Effect_1.fail(new NotAState({ input }));
        return parsed;
    });
}
/** `step`, failing where `enabled` refuses the event instead of leaving the state unchanged. */
export function apply(current, event) {
    return Effect_1.gen(function* apply() {
        if (!enabled(current, event))
            return yield* Effect_1.fail(new Rejected({ event, state: current }));
        return step(current, event);
    });
}
/** The state, and the one way to change it: an event the rules allow, applied before the next is looked at. */
export class Machine extends runtime.$service("thenetwork/spec/notificationDispatch.md#Machine") {
}
/**
 * A Machine from `start` that gives each state an event leads to to `keep` before it is the current one: where `keep`
 * dies, `send` dies and the state stays as it was. It never shares the state it holds with its callers.
 */
export function machineOver(start, keep) {
    return Effect_1.gen(function* machineOver() {
        const held = yield* SubscriptionRef.make(snapshot_notificationDispatch(start));
        function send(event) {
            return Effect_1.gen(function* send() {
                const input = snapshot_notificationDispatch({ event });
                let completion_1 = runtime.$normal;
                yield* runtime.uninterruptible(Effect_1.fnUntraced(function* send$uninterruptible() {
                    {
                        completion_1 = { kind: "return", value: yield* SubscriptionRef.modifyEffect(held, (current) => {
                                return Effect_1.gen(function* () {
                                    const next = yield* apply(snapshot_notificationDispatch(current), input.event);
                                    yield* keep(snapshot_notificationDispatch(next));
                                    return [snapshot_notificationDispatch(next), next];
                                });
                            }) };
                        return completion_1.value;
                    }
                })());
                if (completion_1.kind === "return")
                    return completion_1.value;
            });
        }
        return {
            changes: Stream.map(SubscriptionRef.changes(held), snapshot_notificationDispatch),
            get() {
                return Effect_1.gen({ *"get"() { return snapshot_notificationDispatch(yield* SubscriptionRef.get(held)); } }["get"]);
            },
            send,
            receive(input) {
                return Effect_1.gen(function* receive() { return yield* send(yield* decodeEvent(input)); });
            }
        };
    });
}
/** A Machine in memory, from `initial` or a state `decodeState` returned. */
export function machine(start = initial) {
    return Layer.effect(Machine, machineOver(start, () => Effect.void));
}
/**
 * A Machine kept in the KeyValueStore under `key`, as JSON. It starts from what is stored there, read through
 * `decodeState`, or from `start` where nothing is; what is stored and is not a state fails the layer with NotAState,
 * so that it is never written over. Each state an event leads to is stored before it is the current one: where the
 * store does not take it, `send` dies and the state stays as it was.
 */
export function stored(key, start = initial) {
    return Layer.effect(Machine, Effect_1.gen(function* () {
        const store = yield* KeyValueStore.KeyValueStore;
        const found = yield* store.get(key);
        const first = found === undefined ? start
            : yield* decodeState(yield* Effect.try({ try: () => JSON.parse(found), catch: () => new NotAState({ input: found }) }));
        return yield* machineOver(first, (next) => orDie(store.set(key, JSON.stringify(next))));
    }));
}
