// Generated from packages/core/src/vibe/runtimeUnitShell.vibe. Run pnpm run spec:sync.
interface StoredUnitEffects<State, Result> {
    /** @throws {never} */
    load(): Promise<State | undefined>;
    /** @throws {never} */
    restore(state: State): void;
    /** @throws {never} */
    run(): Promise<Result> | Result;
    /** @throws {never} */
    save(): Promise<void>;
}
/**
 * Sequence the effects under the lock held by the caller.
 * @throws {never}
 */
export declare function runStoredNetworkUnit<State extends object, Result>(effects: StoredUnitEffects<State, Result>): Promise<Result>;
export {};
