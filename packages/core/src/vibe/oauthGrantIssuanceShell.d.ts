// Generated from packages/core/src/vibe/oauthGrantIssuanceShell.vibe. Run pnpm run spec:sync.
interface PendingApproval {
    e164: string | null;
    personId: string | null;
    expiresAt: number;
}
type AuthorityStatus = "valid" | "invalid" | "unavailable";
interface ConfirmApproval {
    /** @throws {never} */
    (approval: PendingApproval): Promise<boolean>;
}
interface PreparedIssuance {
    code: string;
    /** @throws {never} */
    commit(at: number, confirm: ConfirmApproval): Promise<boolean>;
}
interface GrantIssuanceEffects<Grant> {
    /** @throws {never} */
    now(): number;
    /** @throws {never} */
    makeGrant(at: number): Grant;
    /** @throws {never} */
    checkAuthority(grant: Grant): Promise<AuthorityStatus>;
    /** @throws {never} */
    prepareIssuance(grant: Grant, at: number): PreparedIssuance;
}
type GrantIssuanceResult<Grant> = {
    kind: "expired";
} | {
    kind: "retry";
} | {
    kind: "denied";
} | {
    kind: "issued";
    grant: Grant;
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
}, effects: GrantIssuanceEffects<Grant>): Promise<GrantIssuanceResult<Grant>>;
export {};
