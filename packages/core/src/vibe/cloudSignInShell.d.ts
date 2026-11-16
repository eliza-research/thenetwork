// Generated from packages/core/src/vibe/cloudSignInShell.vibe. Run pnpm run spec:sync.
import type { HandoffFacts } from "./generated/cloudSignIn.effect.js";
interface CloudHandoff {
    verifier: string;
    code: string;
    returnPath: string;
}
type CloudExchange = {
    accepted: false;
} | {
    accepted: true;
    claims: unknown;
};
interface CloudSignInEffects<Identity, Session> {
    /** @throws {never} */
    exchange(handoff: CloudHandoff): Promise<CloudExchange>;
    /** @throws {never} */
    parseIdentity(claims: unknown): Identity | undefined;
    /** @throws {never} */
    phoneAllowed(e164: string): Promise<boolean>;
    /** @throws {never} */
    endPreviousSession(): Promise<void>;
    /** @throws {never} */
    recordPhoneSeen(e164: string): Promise<unknown>;
    /** @throws {never} */
    findPersonId(e164: string): Promise<string | null>;
    /** @throws {never} */
    createSession(identity: Identity, personId: string | null): Promise<Session>;
}
type CloudSignInResult<Identity, Session> = {
    status: 400 | 403 | 503;
} | {
    status: 303;
    returnPath: string;
    identity: Identity;
    session: Session;
};
/**
 * Use one machine for each callback. The app supplies its Cloud and session operations.
 * @throws {never}
 */
export declare function completeCloudSignIn<Identity extends {
    e164: string;
}, Session>(facts: HandoffFacts, handoff: CloudHandoff | undefined, effects: CloudSignInEffects<Identity, Session>): Promise<CloudSignInResult<Identity, Session>>;
export {};
