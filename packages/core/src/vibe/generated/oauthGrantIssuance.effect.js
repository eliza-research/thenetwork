// Generated from spec/oauthGrantIssuance.md via Vibestack and VibeLang. Run pnpm run spec:sync.
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { orDie } from "effect/Effect";
import { $schemaErrorMatcher, TaggedError } from "vibelang-runtime/internal";
import * as Effect_1 from "effect/Effect";
import * as runtime from "vibelang-runtime/internal";
import { initial, eligibleApproval, inv, requestIsLive, canBeginApproval, beginApproval, lawDeadlineExcludesExpiry, canCheckGrantAuthority, checkGrantAuthority, canCheckLockedApproval, checkLockedApproval, canRecordCommit, recordCommit, canRecordStorageFailure, recordStorageFailure, stepIssuanceFollowsCommit, sometimesRetriesIssuance, alwaysIssuanceRequiresCurrentApproval, sometimesIssuesGrant, sometimesRetriesAuthority, sometimesDeniesAuthority, sometimesExpiresApproval, enabled, step, parseEvent, parseState, snapshot_oauthGrantIssuance, snapshot_in_oauthGrantIssuance } from "./oauthGrantIssuance.effect.vibe.pure.js";
export { initial, eligibleApproval, inv, requestIsLive, canBeginApproval, beginApproval, lawDeadlineExcludesExpiry, canCheckGrantAuthority, checkGrantAuthority, canCheckLockedApproval, checkLockedApproval, canRecordCommit, recordCommit, canRecordStorageFailure, recordStorageFailure, stepIssuanceFollowsCommit, sometimesRetriesIssuance, alwaysIssuanceRequiresCurrentApproval, sometimesIssuesGrant, sometimesRetriesAuthority, sometimesDeniesAuthority, sometimesExpiresApproval, enabled, step, parseEvent, parseState };
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import { PreventSchedulerYield } from "effect/References";
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
        return snapshot_oauthGrantIssuance(event);
    });
}
/** `parseState`, failing where it returns undefined. */
export function decodeState(input) {
    return Effect_1.gen(function* decodeState() {
        const parsed = parseState(input);
        if (parsed === undefined)
            return yield* Effect_1.fail(new NotAState({ input }));
        return snapshot_oauthGrantIssuance(parsed);
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
export class Machine extends runtime.$service("thenetwork/spec/oauthGrantIssuance.md#Machine") {
}
/**
 * A Machine over a state kept elsewhere: `load` reads it and `keep` writes it. Each event is applied to what `load`
 * reads when it is sent, so that a state another writer kept since is stepped from, never written over, and the state
 * it leads to goes to `keep` before `send` returns. It fails as the first `load` does; where a later `load` fails
 * or `keep` dies, `send` dies and the state stays as it was. It never shares a state with its callers.
 */
export function machineOver(load, keep) {
    return Effect_1.gen(function* machineOver() {
        const shown = yield* SubscriptionRef.make(snapshot_in_oauthGrantIssuance(yield* load()));
        function send(event, isCurrent) {
            return Effect_1.gen(function* send() {
                const input = snapshot_in_oauthGrantIssuance({ event });
                let completion_1 = runtime.$normal;
                yield* runtime.uninterruptible(Effect_1.fnUntraced(function* send$uninterruptible() {
                    {
                        completion_1 = { kind: "return", value: yield* SubscriptionRef.modifyEffect(shown, () => {
                                return Effect_1.gen(function* () {
                                    const current = snapshot_in_oauthGrantIssuance(yield* orDie(load()));
                                    const next = snapshot_oauthGrantIssuance(yield* apply(current, input.event));
                                    const nextState = next;
                                    const save = Effect_1.gen(function* save() {
                                        if (isCurrent && !isCurrent(current))
                                            return yield* Effect_1.fail(new Rejected({ ...input, state: current }));
                                        yield* keep(nextState);
                                    });
                                    yield* (isCurrent ? Effect.provideService(save, PreventSchedulerYield, true) : save);
                                    return [next, nextState];
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
            changes: SubscriptionRef.changes(shown),
            get() {
                return Effect_1.gen({ *"get"() { return snapshot_in_oauthGrantIssuance(yield* orDie(load())); } }["get"]);
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
    return Layer.effect(Machine, Effect_1.gen(function* () {
        const kept = yield* Ref.make(start === initial ? snapshot_oauthGrantIssuance(start) : snapshot_in_oauthGrantIssuance(start));
        return yield* machineOver(() => Ref.get(kept), (next) => Ref.set(kept, next));
    }));
}
const snapshot_cache_oauthGrantIssuance = new WeakMap();
/**
 * A Machine kept in the KeyValueStore under `key`, as JSON: each event is applied to what is stored there when it
 * is sent, read through `decodeState`, or to `start` where nothing is, so that a state another page or program
 * stored since is stepped from, never written over. What is stored and is not a state fails the layer with NotAState,
 * and a later `send` dies on it, so that it is never written over either. Each state an event leads to is stored
 * before `send` returns: where the store does not take it, `send` dies and the state stays as it was.
 */
export function stored(key, start = initial) {
    return Layer.effect(Machine, Effect_1.gen(function* () {
        const store = yield* KeyValueStore.KeyValueStore;
        const fallback = start === initial ? snapshot_oauthGrantIssuance(start) : snapshot_in_oauthGrantIssuance(start);
        let entries = snapshot_cache_oauthGrantIssuance.get(store);
        if (entries === undefined) {
            entries = new Map();
            snapshot_cache_oauthGrantIssuance.set(store, entries);
        }
        const cache = entries;
        function load() {
            return Effect_1.gen(function* load() {
                const found = yield* store.get(key);
                if (found === undefined) {
                    cache.delete(key);
                    return fallback;
                }
                const cached = cache.get(key);
                if (cached !== undefined && cached.raw === found)
                    return cached.state;
                const decoded = yield* decodeState(yield* Effect.try({ try: () => JSON.parse(found), catch: () => new NotAState({ input: found }) }));
                cache.set(key, { raw: found, state: decoded });
                return decoded;
            });
        }
        function keep(next) {
            return Effect_1.gen(function* keep() {
                const cached = cache.get(key);
                if (cached !== undefined && Object.is(cached.state, next))
                    return;
                const raw = JSON.stringify(next);
                if (cached !== undefined && cached.raw === raw) {
                    cache.set(key, { raw, state: next });
                    return;
                }
                yield* orDie(store.set(key, raw));
                cache.set(key, { raw, state: next });
            });
        }
        return yield* machineOver(load, keep);
    }));
}
