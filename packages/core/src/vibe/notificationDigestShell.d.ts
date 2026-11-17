// Generated from packages/core/src/vibe/notificationDigestShell.vibe. Run pnpm run spec:sync.
interface DigestRecord {
    personId: string;
    itemIds: string[];
}
interface DigestPlan extends DigestRecord {
    deliveryId: string;
    to: string;
    channel: string;
    timeZone: string;
}
interface DigestItem {
    seenAt?: number;
    notifiedAt?: number;
    expiresAt?: number;
    urgency: string;
}
interface DigestRecipient {
    to: string;
    timeZone: string;
    prefs: {
        channel: string;
    };
    proactiveAllowed: boolean;
}
interface DispatchEffects<P extends DigestPlan, I extends DigestItem, R extends DigestRecipient> {
    /** @throws {never} */
    readItems(ids: string[]): Promise<I[]>;
    /** @throws {never} */
    readRecipient(personId: string): Promise<R | undefined>;
    /** @throws {never} */
    linkCurrent(plan: P, items: I[]): Promise<boolean>;
    /** @throws {never} */
    rebuild(recipient: R, items: I[]): Promise<P>;
    /** @throws {never} */
    record(plan: P): Promise<boolean>;
    /** @throws {never} */
    enqueue(plan: P): Promise<unknown>;
}
interface RevalidationEffects {
    /** @throws {never} */
    readDelivery(deliveryId: string): Promise<DigestRecord | undefined>;
    /** @throws {never} */
    idFor(personId: string, itemIds: string[]): string;
    /** @throws {never} */
    readItems(ids: string[]): Promise<DigestItem[]>;
}
type DispatchResult<P> = {
    kind: "queued";
    plan: P;
} | {
    kind: "cancelled";
    deliveryId: string;
};
/**
 * Re-read before the first write and enqueue only after recording succeeds.
 * @throws {never}
 */
export declare function dispatchInboxDigest<P extends DigestPlan, I extends DigestItem, R extends DigestRecipient>(planned: P, now: number, effects: DispatchEffects<P, I, R>): Promise<DispatchResult<P>>;
/**
 * A queued body is immutable. Revalidate its complete item set at send time.
 * @throws {never}
 */
export declare function queuedInboxDigestCurrent(deliveryId: string, now: number, effects: RevalidationEffects): Promise<boolean>;
export {};
