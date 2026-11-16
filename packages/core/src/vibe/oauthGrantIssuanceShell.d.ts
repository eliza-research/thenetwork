// Generated from packages/core/src/vibe/oauthGrantIssuanceShell.vibe. Run pnpm run spec:sync.
interface PendingApproval {
    e164: string | null;
    personId: string | null;
    expiresAt: number;
}
type AuthorityStatus = "valid" | "invalid" | "unavailable";
interface GrantIssuanceEffects<Grant> {
    /** @throws {never} */
    now(): number;
    /** @throws {never} */
    makeGrant(at: number): Grant;
    /** @throws {never} */
    checkAuthority(grant: Grant): Promise<AuthorityStatus>;
    /** @throws {never} */
    consumeApproval(at: number): Promise<PendingApproval | undefined>;
    /** @throws {never} */
    putGrant(grant: Grant): Promise<void>;
    /** @throws {never} */
    putCode(grant: Grant, at: number): Promise<string>;
    /** @throws {never} */
    audit(grant: Grant, at: number): Promise<void>;
}
type GrantIssuanceResult = {
    kind: "expired";
} | {
    kind: "retry";
} | {
    kind: "denied";
} | {
    kind: "issued";
    code: string;
};
/**
 * Run a new issuance machine for each browser approval.
 * @throws {never}
 */
export declare function issueConnectorGrant<Grant extends {
    expiresAt: number;
}>(request: PendingApproval & {
    e164: string;
}, effects: GrantIssuanceEffects<Grant>): Promise<GrantIssuanceResult>;
export {};
