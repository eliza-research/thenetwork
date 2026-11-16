// Generated from packages/core/src/vibe/backendShutdownShell.vibe. Run pnpm run spec:sync.
import type { BackendLifecycle, Event } from "./generated/backendLifecycle.effect.js";
interface ShutdownEffects {
    /** @throws {never} */
    record(event: Event): BackendLifecycle;
    /** @throws {never} */
    stopListeners(force: boolean): Promise<void>;
    /** @throws {never} */
    waitForWork(): Promise<void>;
    /** @throws {never} */
    reportTimeout(): void;
    /** @throws {never} */
    closeService(force: boolean): Promise<void>;
}
/** @throws {never} */
export declare function finishBackendShutdown(graceMs: number, effects: ShutdownEffects): Promise<boolean>;
export {};
