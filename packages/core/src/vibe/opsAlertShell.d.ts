// Generated from packages/core/src/vibe/opsAlertShell.vibe. Run pnpm run spec:sync.
export type AlertLevel = "warn" | "bad";
export interface Alert {
    key: string;
    level: AlertLevel;
    count: number;
    text: string;
    /** A higher count can send another notice at the same level. */
    bump?: boolean;
}
export interface AlertState {
    key: string;
    level: AlertLevel;
    count: number;
    text: string;
    open: boolean;
    firstAt: number;
    lastAt: number;
    lastSentAt?: number;
    lastSentLevel?: AlertLevel;
    lastSentCount?: number;
}
export interface AlertTx {
    /** @throws {never} */
    load(): Promise<AlertState[]>;
    /** @throws {never} */
    save(states: AlertState[]): Promise<void>;
    /** @throws {never} */
    postsSince(since: number): Promise<number>;
    /** @throws {never} */
    recordPost(at: number, alerts: number, accepted: boolean): Promise<void>;
}
export interface Notice {
    key: string;
    level: AlertLevel;
    count: number;
    text: string;
    state: "firing" | "resolved";
}
export interface DispatchResult {
    notices: Notice[];
    posted: boolean;
    ok: boolean;
    held: number;
    open: {
        key: string;
        level: AlertLevel;
        count: number;
    }[];
    postsLastHour: number;
}
interface DispatchOptions {
    now: number;
    repeatMs: number;
    maxPostsPerHour: number;
    /** @throws {never} */
    post(notices: Notice[]): Promise<boolean>;
}
/**
 * Run inside the adapter's existing exclusive store transaction.
 * @throws {never}
 */
export declare function dispatchOperationsAlerts(alerts: Alert[], tx: AlertTx, options: DispatchOptions): Promise<DispatchResult>;
export {};
