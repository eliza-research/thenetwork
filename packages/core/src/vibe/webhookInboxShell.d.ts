// Generated from packages/core/src/vibe/webhookInboxShell.vibe. Run pnpm run spec:sync.
interface PendingWebhook {
    id: string;
    attempts: number;
    compliance: boolean;
    stopCommand: boolean;
}
interface DrainEffects<Row> {
    /** @throws {never} */
    readWindow(): Promise<readonly Row[]>;
    /** @throws {never} */
    hasBlockingTurn(): Promise<boolean>;
    /** @throws {never} */
    handle(row: Row): Promise<string>;
    /** @throws {never} */
    complete(row: Row, outcome: string, cancelIds: string[]): Promise<number>;
    /** @throws {never} */
    fail(row: Row, attempts: number, drop: boolean, cause: unknown): Promise<void>;
}
/**
 * A sender's advisory lock is held until the whole drain returns.
 * @throws {never}
 */
export declare function drainWebhookSender<Row extends PendingWebhook>(effects: DrainEffects<Row>): Promise<number>;
export {};
