// Generated from packages/core/src/vibe/turnReceiptShell.vibe. Run pnpm run spec:sync.
interface CompletedTurn {
    receipt_hash: string | null;
    receipt: {
        outcome: string;
    } | null;
    replies: readonly {
        id: string;
    }[];
    response: {
        accountEligible: boolean;
        replyKind: "reply" | "compliance";
        reason: string;
        memberId: string | null;
    };
    knownApp: boolean;
}
interface ReceiptInput {
    digest: string;
    delivery: "accepted" | "unknown" | "rejected";
    replyIds: string[];
    providerIds: boolean;
    history: boolean;
}
interface ReceiptEffects<Turn> {
    /** @throws {never} */
    readTurn(): Promise<Turn | undefined>;
    /** @throws {never} */
    authorityIsCurrent(turn: Turn): boolean;
    /** @throws {never} */
    receiptValuesMatch(turn: Turn): boolean;
    /** @throws {never} */
    writeReplies(turn: Turn, status: string): Promise<void>;
    /** @throws {never} */
    writeReceipt(): Promise<void>;
}
/**
 * Called inside the transaction that holds the stored turn's row lock.
 * @throws {never}
 */
export declare function recordSignedTurnReceipt<Turn extends CompletedTurn>(input: ReceiptInput, effects: ReceiptEffects<Turn>): Promise<"AuthorityInvalid" | "Conflict" | "DeliveryInvalid" | "Replayed" | "ScopeInvalid" | "Stored" | "TurnUnavailable">;
export {};
