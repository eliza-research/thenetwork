// Generated from packages/core/src/vibe/outboundReceiptShell.vibe. Run pnpm run spec:sync.
import type { FailureKind, ReceiptPhase } from "./generated/outboundReceipt.effect.js";
export type SendDisposition = Extract<ReceiptPhase, "AcceptanceUnknown" | "RetryScheduled" | "WaitingForReply" | "ProviderBlocked" | "ProviderFailed">;
interface ClaimedSendEffects<Receipt, Failure, Result> {
    /** @throws {never} */
    send(): Promise<Receipt>;
    /** @throws {never} */
    saveReceipt(receipt: Receipt): Promise<Result>;
    /** @throws {never} */
    classifyError(cause: unknown): {
        kind: FailureKind;
        error: Failure;
    };
    /** @throws {never} */
    unrecordedReceipt(): Failure;
    /** @throws {never} */
    saveDisposition(phase: SendDisposition, error: Failure): Promise<Result>;
}
/**
 * Run only after the queue has committed the send lease.
 * @throws {never}
 */
export declare function settleClaimedSend<Receipt, Failure, Result>(hasAttemptsLeft: boolean, effects: ClaimedSendEffects<Receipt, Failure, Result>): Promise<Result>;
export {};
