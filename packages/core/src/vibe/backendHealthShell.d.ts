// Generated from packages/core/src/vibe/backendHealthShell.vibe. Run bun run spec:sync.
import type { HealthStatus } from "./generated/backendHealth.effect.js";
interface HealthEffects {
    /** @throws {never} */
    ping(): Promise<boolean>;
    /** @throws {never} */
    hasLateTick(): boolean;
}
/** @throws {never} */
export declare function checkBackendHealth(serving: boolean, effects: HealthEffects): Promise<HealthStatus>;
export {};
