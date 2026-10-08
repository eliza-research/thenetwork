// Web sessions (platform plan 3.3, option A): a first-party cookie per app domain. The cookie holds
// a random 32-byte token; the database holds only its sha256. A session belongs to one app: on
// localhost the dev ports share cookies, so the app is checked on every read.
import { createHash, randomBytes } from "node:crypto";
import type { AppId } from "./apps.ts";
import type { PeopleStore, Session } from "./store.ts";

export const SESSION_TTL_MS = 30 * 24 * 3_600_000;
export const SESSION_ROTATE_MS = 24 * 3_600_000;
/** After a rotation the old token still works this long, so requests already in flight with it do not log the person out. */
export const SESSION_GRACE_MS = 60_000;

export const newToken = () => randomBytes(32).toString("base64url");
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export class SessionService {
  constructor(private readonly store: PeopleStore, private readonly opts: { now?: () => number; ttlMs?: number; rotateMs?: number } = {}) {}
  private now() { return (this.opts.now ?? Date.now)(); }

  async create(app: AppId, e164: string, personId: string | null, rotatedFrom: string | null = null): Promise<{ token: string; session: Session }> {
    const token = newToken(), at = this.now();
    const session: Session = { tokenHash: tokenHash(token), app, e164, personId, createdAt: at, expiresAt: at + (this.opts.ttlMs ?? SESSION_TTL_MS), rotatedFrom, revokedAt: null };
    await this.store.putSession(session);
    return { token, session };
  }

  /**
   * The live session for a token on this app. A session older than a day is rotated: the result
   * carries the new token, and the old token ends after a short grace time (not at once).
   */
  async authenticate(app: AppId, token: string | undefined): Promise<{ session: Session; token: string; rotated: boolean } | undefined> {
    if (!token || token.length > 128) return undefined;
    const at = this.now();
    const s = await this.store.getSession(tokenHash(token));
    if (!s || s.app !== app || (s.revokedAt !== null && s.revokedAt <= at) || s.expiresAt <= at) return undefined;
    // Already rotated (in its grace time), or young: use it as it is.
    if (s.revokedAt !== null || at - s.createdAt < (this.opts.rotateMs ?? SESSION_ROTATE_MS)) return { session: s, token, rotated: false };
    await this.store.revokeSession(s.tokenHash, at + SESSION_GRACE_MS);
    const next = await this.create(app, s.e164, s.personId, s.tokenHash);
    return { session: next.session, token: next.token, rotated: true };
  }

  async revoke(token: string | undefined) {
    if (token) await this.store.revokeSession(tokenHash(token), this.now());
  }
}
