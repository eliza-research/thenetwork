// Web sessions (platform plan 3.3, option A): a first-party cookie per app domain. The cookie holds
// a random 32-byte token; the database holds only its keyed hash (HMAC with PLATFORM_SESSION_SECRET).
// A session belongs to one app: on localhost the dev ports share cookies, so the app is checked on
// every read.
//  - A session is rotated after a day; the old token works 60 more seconds (requests in flight).
//  - A chain of rotations ends 90 days after the login (startedAt): then the person logs in again.
//  - Delete everything needs a fresh login (within 10 minutes): a stolen old cookie cannot do it.
import { createHmac, randomBytes } from "node:crypto";
import type { AppId } from "./apps.ts";
import type { PeopleStore, Session } from "./store.ts";

export const SESSION_TTL_MS = 30 * 24 * 3_600_000;
export const SESSION_ROTATE_MS = 24 * 3_600_000;
/** A rotation chain never outlives this, counted from the OTP login. */
export const SESSION_MAX_MS = 90 * 24 * 3_600_000;
/** After a rotation the old token still works this long, so requests already in flight with it do not log the person out. */
export const SESSION_GRACE_MS = 60_000;
/** Delete everything needs an OTP login this recent (step-up). */
export const STEP_UP_MS = 10 * 60_000;

export const newToken = () => randomBytes(32).toString("base64url");
/** The stored form of a token: a keyed hash, so a database copy cannot be turned into cookies. */
export const tokenHash = (token: string, secret: string) => createHmac("sha256", secret).update(`session:${token}`).digest("hex");

export class SessionService {
  constructor(private readonly store: PeopleStore, private readonly opts: { secret: string; now?: () => number; ttlMs?: number; rotateMs?: number; maxMs?: number }) {}
  private now() { return (this.opts.now ?? Date.now)(); }
  private hash(token: string) { return tokenHash(token, this.opts.secret); }

  /** A new session. `startedAt` is the OTP login time (a rotation keeps it). */
  async create(app: AppId, e164: string, personId: string | null, rotatedFrom: string | null = null, startedAt?: number, expiresBefore?: number, delegatedCloud?: true): Promise<{ token: string; session: Session }> {
    const token = `${delegatedCloud ? "cloud." : ""}${newToken()}`, at = this.now(), started = startedAt ?? at;
    const expiresAt = Math.min(at + (this.opts.ttlMs ?? SESSION_TTL_MS), started + (this.opts.maxMs ?? SESSION_MAX_MS), expiresBefore ?? Infinity);
    const session: Session = { tokenHash: this.hash(token), app, e164, personId, createdAt: at, startedAt: started, expiresAt, rotatedFrom, revokedAt: null };
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
    const s = await this.store.getSession(this.hash(token));
    if (!s || s.app !== app || (s.revokedAt !== null && s.revokedAt <= at) || s.expiresAt <= at) return undefined;
    // Already rotated (in its grace time), young, or at the end of its chain: use it as it is.
    if (s.revokedAt !== null || at - s.createdAt < (this.opts.rotateMs ?? SESSION_ROTATE_MS)) return { session: s, token, rotated: false };
    await this.store.revokeSession(s.tokenHash, at + SESSION_GRACE_MS);
    const cloud = token.startsWith("cloud.");
    const next = await this.create(app, s.e164, s.personId, s.tokenHash, s.startedAt, cloud ? s.expiresAt : undefined, cloud ? true : undefined);
    return { session: next.session, token: next.token, rotated: true };
  }

  /** True when the session's OTP login is recent enough for delete everything. */
  fresh(s: Session) { return this.now() - s.startedAt <= STEP_UP_MS; }

  async revoke(token: string | undefined) {
    if (token) await this.store.revokeSession(this.hash(token), this.now());
  }
}
