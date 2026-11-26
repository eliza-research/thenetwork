// Web sessions (platform plan 3.3, option A): a first-party cookie per app domain. The cookie holds
// a random 32-byte token; the database holds only its keyed hash (HMAC with PLATFORM_SESSION_SECRET).
// A session belongs to one app: on localhost the dev ports share cookies, so the app is checked on
// every read.
//  - A session is rotated after a day; the old token works 60 more seconds (requests in flight).
//  - A chain of rotations ends 90 days after the login (startedAt): then the person logs in again.
//  - Delete everything needs a fresh login (within 10 minutes): a stolen old cookie cannot do it.
import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  freshSignIn, initial, sessionDeadline, sessionGraceMs, sessionMaxMs, sessionRotateMs, sessionRowLive, sessionStepUpMs, sessionTtlMs, step, type SessionFlow,
} from "../../core/src/generated/webSession.ts";
import type { AppId } from "./apps.ts";
import type { PeopleStore, Session } from "./store.ts";

export const SESSION_TTL_MS = sessionTtlMs;
export const SESSION_ROTATE_MS = sessionRotateMs;
/** A rotation chain never outlives this, counted from the OTP login. */
export const SESSION_MAX_MS = sessionMaxMs;
/** After a rotation the old token still works this long, so requests already in flight with it do not log the person out. */
export const SESSION_GRACE_MS = sessionGraceMs;
/** Delete everything needs an OTP login this recent (step-up). */
export const STEP_UP_MS = sessionStepUpMs;

export const newToken = () => randomBytes(32).toString("base64url");
/** The stored form of a token: a keyed hash, so a database copy cannot be turned into cookies. */
export const tokenHash = (token: string, secret: string) => createHmac("sha256", secret).update(`session:${token}`).digest("hex");

/** Opaque view marker for the verified app, phone and person. A marker never authenticates a session. */
export const signupAccountView = (app: AppId, phoneKey: string, personId: string | null) =>
  createHash("sha256").update(JSON.stringify(["signup-view/v2", app, phoneKey, personId])).digest("hex");

export class SessionService {
  constructor(private readonly store: PeopleStore, private readonly opts: { secret: string; phoneHash: (e164: string) => string; now?: () => number; ttlMs?: number; rotateMs?: number; maxMs?: number }) {}
  private now() { return (this.opts.now ?? Date.now)(); }
  private hash(token: string) { return tokenHash(token, this.opts.secret); }

  /** A new session. `startedAt` is the OTP login time (a rotation keeps it). */
  async create(app: AppId, e164: string, personId: string | null, rotatedFrom: string | null = null, startedAt?: number, expiresBefore?: number, delegatedCloud?: true): Promise<{ token: string; session: Session }> {
    const next = this.next(app, e164, personId, rotatedFrom, startedAt, expiresBefore, delegatedCloud);
    await this.store.putSession(next.session);
    return next;
  }

  private next(app: AppId, e164: string, personId: string | null, rotatedFrom: string | null, startedAt?: number, expiresBefore?: number, delegatedCloud?: true): { token: string; session: Session } {
    const token = `${delegatedCloud ? "cloud." : ""}${newToken()}`, at = this.now(), started = startedAt ?? at;
    const expiresAt = sessionDeadline(at, started, this.opts.ttlMs ?? SESSION_TTL_MS, this.opts.maxMs ?? SESSION_MAX_MS,
      expiresBefore !== undefined, expiresBefore ?? 0);
    return { token, session: { tokenHash: this.hash(token), app, e164, personId, createdAt: at, startedAt: started, expiresAt, rotatedFrom, revokedAt: null } };
  }

  /**
   * The live session for a token on this app. A session older than a day is rotated: the result
   * carries the new token, and the old token ends after a short grace time (not at once).
   */
  async authenticate(app: AppId, token: string | undefined, rotate = true): Promise<{ session: Session; token: string; rotated: boolean } | undefined> {
    // spec/webSession.md, "Only a live token on the requested app can authenticate"
    let flow = step(initial, { type: "readToken", tokenPresent: Boolean(token), tokenLength: token?.length ?? 0 });
    if (flow.phase !== "LookingUp" || !token) return undefined;
    const at = this.now();
    const s = await this.store.getSession(this.hash(token));
    // A ban made after sign-in ends the session at its next use.
    const banned = s?.app === app && await this.store.isBanned(this.opts.phoneHash(s.e164),
      s.personId ?? (await this.store.findPhone(s.e164))?.personId ?? null);
    flow = step(flow, { type: "readRow", sameAppRow: s?.app === app, expired: !!s && s.expiresAt <= at,
      hasRevocation: s?.revokedAt != null, revocationDue: s?.revokedAt != null && s.revokedAt <= at, banned,
      rotationRequested: rotate, oldEnough: !!s && !(at - s.createdAt < (this.opts.rotateMs ?? SESSION_ROTATE_MS)), at });
    if (!s || flow.phase === "Refused") return undefined;
    if (flow.phase === "Usable") return { session: s, token, rotated: false };
    if (flow.phase !== "RevokingOld") return undefined;
    const revoking = flow, cloud = token.startsWith("cloud.");
    let revoked: SessionFlow = revoking, next: { token: string; session: Session } | undefined;
    await this.store.rotateSession(s.tokenHash, s.e164, revoking.revokeAt, current => {
      const now = this.now();
      revoked = step(revoking, { type: "recordRevocation",
        rowLive: !!current && sessionRowLive(current.app === app, current.expiresAt, current.revokedAt !== null, current.revokedAt ?? 0, now),
        rotatedMeanwhile: current?.revokedAt != null });
      next = revoked.phase === "IssuingReplacement"
        ? this.next(app, s.e164, current?.personId ?? s.personId, s.tokenHash, s.startedAt, cloud ? s.expiresAt : undefined, cloud ? true : undefined) : undefined;
      return next?.session;
    });
    if (revoked.phase === "Usable") return { session: s, token, rotated: false };
    if (revoked.phase !== "IssuingReplacement" || !next) return undefined;
    if (step(revoked, { type: "recordReplacement" }).phase === "Rotated") return { ...next, rotated: true };
  }

  /** True when the session's OTP login is recent enough for delete everything. */
  fresh(s: Session) { return freshSignIn(this.now() - s.startedAt); }

  async revoke(token: string | undefined) {
    if (token) await this.store.revokeSession(this.hash(token), this.now());
  }
}
