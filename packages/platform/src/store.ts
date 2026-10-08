// People, phones, memberships and the rest of the platform schema (migration 0003), behind one
// interface with two implementations: MemoryPeopleStore (tests, dev) and PgPeopleStore (pg-store.ts).
// Times are epoch milliseconds. Phone numbers are E.164.
import type { AppId } from "./apps.ts";
import type { ConsentEvent, ConsentLast } from "./consent.ts";
import { lastEvents } from "./consent.ts";

export type PhoneMethod = "otp_sms" | "otp_whatsapp" | "inbound_message" | "staff";
export type MembershipState = "invited" | "onboarding" | "active" | "paused" | "restricted" | "removed";

export interface Person { id: string; lowestAge: number | null; createdAt: number; deletedAt: number | null }
/** A text flow waiting for the person's next message (platform.pending_texts): a join that has asked for name and age, The Network's "what are you looking for?", or a SHARE offer. */
export type PendingKind = "join" | "looking_for" | "share";
export interface PendingText { phoneHash: string; kind: PendingKind; app: AppId; name: string | null; age: number | null; at: number }
export type PhoneHold = "recycled_number";
export interface PhoneIdentity {
  e164: string; personId: string; verifiedAt: number; method: PhoneMethod; lastSeenAt: number | null;
  /** Staff must look before anyone uses this number's account (it may have a new owner). */
  hold: PhoneHold | null;
}
export interface Membership {
  app: AppId;
  personId: string;
  memberId: string;
  state: MembershipState;
  /** Why staff must look before the membership is used (a phone number that may have a new owner). */
  review: "recycled_number" | null;
  firstName: string | null;
  profile: Record<string, unknown>;
  joinedAt: number | null;
  leftAt: number | null;
}
/**
 * A staff ban after a report (docs/admin-console.md 3.7.1). "phone": this number (its keyed hash) can
 * never join any app again. "person": the person, on every app, and every phone they had when banned.
 * Delete everything keeps it.
 */
export interface Ban { id: string; scope: "phone" | "person"; personId: string | null; phoneHash: string | null; reason: string; reportId: string | null; bannedBy: string; at: number }
export interface ShareGrant { personId: string; fromApp: AppId; toApp: AppId; fields: string[]; grantedAt: number; revokedAt: number | null }
export interface OtpChallenge {
  id: string; app: AppId; e164: string; provider: string;
  /** The provider's id for this verification (Twilio Verify's VerificationSid): the check is bound to it, so a code sent for one app never verifies another. */
  providerRef: string | null;
  /** Set only when this server checks the code (the dev provider). */
  codeHash: string | null;
  attempts: number; createdAt: number; expiresAt: number; consumedAt: number | null;
}
export interface Session {
  tokenHash: string; app: AppId; e164: string; personId: string | null;
  /** createdAt: this token; startedAt: the OTP login the rotation chain began with. */
  createdAt: number; startedAt: number; expiresAt: number; rotatedFrom: string | null; revokedAt: number | null;
}

/** A rate-limit rule for hit(): a hit over `limit` in the window, or within `minGapMs` of the last counted hit, is refused and not counted. */
export interface HitRule { limit?: number; minGapMs?: number }
export interface HitResult { count: number; prevAt: number | null; ok: boolean }

export interface PeopleStore {
  findPhone(e164: string): Promise<PhoneIdentity | undefined>;
  /** The phone of the live person with this keyed phone hash (people.phone_hash), if any: lets a holder of only the hash (OAuth grants) find the person. */
  findPhoneByHash(phoneHash: string): Promise<PhoneIdentity | undefined>;
  getPerson(id: string): Promise<Person | undefined>;
  /**
   * A person with their verified phone. A person who deleted everything with this phone (a tombstone
   * with the same keyed phone hash) comes back as the same person, so blocks made against them hold.
   */
  createPerson(p: { id: string; e164: string; method: PhoneMethod; at: number; lowestAge: number | null; phoneHash?: string }): Promise<Person>;
  touchPhone(e164: string, at: number): Promise<void>;
  /** Put a number on hold for staff review (or clear the hold with null). */
  setPhoneHold(e164: string, hold: PhoneHold | null, at: number): Promise<void>;
  heldPhones(): Promise<PhoneIdentity[]>;
  /** The lowest age ever stated for a keyed phone hash (no app, no person; kept after a delete of everything). */
  ageFloor(phoneHash: string): Promise<number | undefined>;
  noteAgeFloor(phoneHash: string, age: number, at: number): Promise<number>;
  clearAgeFloor(phoneHash: string): Promise<void>;
  /** Record a stated or recorded age: the person keeps the lowest one. Returns the new lowest age. */
  noteAge(personId: string, age: number): Promise<number>;

  memberships(personId: string): Promise<Membership[]>;
  getMembership(personId: string, app: AppId): Promise<Membership | undefined>;
  putMembership(m: Membership): Promise<void>;

  /** Append an event. False when an event with the same (e164, ref) is already there (a retried message). */
  addConsent(e: ConsentEvent): Promise<boolean>;
  /** The last event for (e164, app) and the last for (e164, every app). */
  lastConsent(e164: string, app: AppId): Promise<ConsentLast>;
  /** The events for this app only (export). */
  consentEvents(e164: string, app: AppId): Promise<ConsentEvent[]>;

  putShareGrant(g: ShareGrant): Promise<void>;
  shareGrants(personId: string): Promise<ShareGrant[]>;

  block(from: string, to: string, originApp: AppId, at: number): Promise<void>;
  /** True if either person blocked the other, on any app. */
  isBlocked(a: string, b: string): Promise<boolean>;

  /** Record a ban (never changed or removed by the service). */
  ban(b: Ban): Promise<void>;
  /** True when this phone hash, or this person (a person-scope ban), is banned. */
  isBanned(phoneHash: string, personId?: string | null): Promise<boolean>;
  /** The phone hashes of a person's verified phones (a person ban covers each). */
  phoneHashesOf(personId: string): Promise<string[]>;

  suppress(phoneHash: string, reason: string, at: number): Promise<void>;
  isSuppressed(phoneHash: string): Promise<boolean>;
  /** A fresh opt-in by the person (a new join) lifts the suppression. */
  unsuppress(phoneHash: string): Promise<void>;

  putChallenge(c: Omit<OtpChallenge, "id">): Promise<string>;
  latestChallenge(app: AppId, e164: string): Promise<OtpChallenge | undefined>;
  /** Take one attempt on a live challenge. False when it is used up, consumed or expired. */
  claimAttempt(id: string, max: number, at: number): Promise<boolean>;
  /** Mark the challenge used. False if it was already used (a code works once). */
  consumeChallenge(id: string, at: number): Promise<boolean>;

  putSession(s: Session): Promise<void>;
  getSession(tokenHash: string): Promise<Session | undefined>;
  revokeSession(tokenHash: string, at: number): Promise<void>;
  /** Sessions of a verified phone that had no person get the person after a join. */
  attachPerson(e164: string, personId: string): Promise<void>;

  /**
   * Count one hit in a fixed window, atomically. With a rule, a hit that would pass the limit or come
   * within the gap is refused and not counted (ok false), so refused hits never extend a lock.
   * Returns the count with this hit (or the count so far when refused) and the last counted hit before it.
   */
  hit(bucket: string, windowMs: number, at: number, rule?: HitRule): Promise<HitResult>;

  /** Run fn while holding a lock on `key` (one holder per key across processes on Postgres). */
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;

  getPending(phoneHash: string, kind: PendingKind, app?: AppId): Promise<PendingText | undefined>;
  /** Store a pending text flow. A join or looking_for replaces the phone's other one of that kind. */
  putPending(p: PendingText): Promise<void>;
  deletePending(phoneHash: string, kind?: PendingKind, app?: AppId): Promise<void>;

  /** Retention: drop expired OTP challenges, sessions, rate windows and pending flows older than `before`. Returns rows removed. */
  purge(before: number): Promise<number>;

  /** Leave one app: the membership is set to removed and its name and profile are cleared; grants that involve the app are revoked. */
  forgetMembership(personId: string, app: AppId, at: number): Promise<void>;
  /** Delete everything for a person and phone; keep a tombstone (people.deleted_at and its phone hash), the blocks and the suppression hash. */
  deleteAll(personId: string | null, e164: string, phoneHash: string, at: number): Promise<void>;
  /** Unlink a tombstone from its phone hash, so a new owner of the number is never revived as this person. */
  detachPhoneHash(personId: string): Promise<void>;
}

export class MemoryPeopleStore implements PeopleStore {
  readonly people = new Map<string, Person>();
  readonly phones = new Map<string, PhoneIdentity>();
  readonly members = new Map<string, Membership>(); // key `${app}:${personId}`
  readonly consent: ConsentEvent[] = [];
  readonly grants = new Map<string, ShareGrant>();
  readonly blocks = new Map<string, { from: string; to: string; originApp: AppId; at: number }>();
  readonly suppression = new Map<string, { reason: string; at: number }>();
  readonly ageFloors = new Map<string, { age: number; at: number }>();
  readonly challenges = new Map<string, OtpChallenge>();
  readonly sessions = new Map<string, Session>();
  readonly limits = new Map<string, { windowStart: number; count: number; lastAt: number }>();
  readonly pending = new Map<string, PendingText>();
  readonly personHash = new Map<string, string>(); // person id -> keyed phone hash
  private locks = new Map<string, Promise<unknown>>();
  private seq = 0;

  async findPhone(e164: string) { return this.phones.get(e164); }
  async findPhoneByHash(phoneHash: string) {
    for (const [id, h] of this.personHash) {
      if (h !== phoneHash || this.people.get(id)?.deletedAt !== null) continue;
      for (const ph of this.phones.values()) if (ph.personId === id) return ph;
    }
    return undefined;
  }
  async getPerson(id: string) { return this.people.get(id); }
  async createPerson(p: { id: string; e164: string; method: PhoneMethod; at: number; lowestAge: number | null; phoneHash?: string }) {
    if (this.phones.has(p.e164)) throw new Error("phone already linked");
    const back = p.phoneHash ? [...this.personHash].find(([id, h]) => h === p.phoneHash && this.people.get(id)?.deletedAt !== null)?.[0] : undefined;
    const person: Person = back
      ? Object.assign(this.people.get(back)!, { deletedAt: null, lowestAge: p.lowestAge })
      : { id: p.id, lowestAge: p.lowestAge, createdAt: p.at, deletedAt: null };
    this.people.set(person.id, person);
    if (p.phoneHash) this.personHash.set(person.id, p.phoneHash);
    p = { ...p, id: person.id };
    this.phones.set(p.e164, { e164: p.e164, personId: p.id, verifiedAt: p.at, method: p.method, lastSeenAt: p.at, hold: null });
    return person;
  }
  async touchPhone(e164: string, at: number) { const ph = this.phones.get(e164); if (ph) ph.lastSeenAt = at; }
  async setPhoneHold(e164: string, hold: PhoneHold | null) { const ph = this.phones.get(e164); if (ph) ph.hold = hold; }
  async heldPhones() { return [...this.phones.values()].filter(p => p.hold !== null).map(p => ({ ...p })); }
  async ageFloor(phoneHash: string) { return this.ageFloors.get(phoneHash)?.age; }
  async noteAgeFloor(phoneHash: string, age: number, at: number) {
    const cur = this.ageFloors.get(phoneHash);
    const lowest = cur ? Math.min(cur.age, age) : age;
    this.ageFloors.set(phoneHash, { age: lowest, at: cur && cur.age <= age ? cur.at : at });
    return lowest;
  }
  async clearAgeFloor(phoneHash: string) { this.ageFloors.delete(phoneHash); }
  async noteAge(personId: string, age: number) {
    const p = this.people.get(personId);
    if (!p) throw new Error("no person");
    p.lowestAge = p.lowestAge === null ? age : Math.min(p.lowestAge, age);
    return p.lowestAge;
  }

  async memberships(personId: string) { return [...this.members.values()].filter(m => m.personId === personId).map(m => ({ ...m })); }
  async getMembership(personId: string, app: AppId) { const m = this.members.get(`${app}:${personId}`); return m && { ...m }; }
  async putMembership(m: Membership) {
    for (const x of this.members.values()) if (x.memberId === m.memberId && (x.app !== m.app || x.personId !== m.personId)) throw new Error("member id in use");
    this.members.set(`${m.app}:${m.personId}`, { ...m, profile: { ...m.profile } });
  }

  async addConsent(e: ConsentEvent) {
    if (e.ref && this.consent.some(x => x.e164 === e.e164 && x.ref === e.ref)) return false;
    this.consent.push({ ...e });
    return true;
  }
  async lastConsent(e164: string, app: AppId) { return lastEvents(this.consent, e164, app); }
  async consentEvents(e164: string, app: AppId) { return this.consent.filter(e => e.e164 === e164 && e.app === app).map(e => ({ ...e })); }

  async putShareGrant(g: ShareGrant) { this.grants.set(`${g.personId}:${g.fromApp}:${g.toApp}`, { ...g }); }
  async shareGrants(personId: string) { return [...this.grants.values()].filter(g => g.personId === personId).map(g => ({ ...g })); }

  async block(from: string, to: string, originApp: AppId, at: number) { this.blocks.set(`${from}:${to}`, { from, to, originApp, at }); }
  async isBlocked(a: string, b: string) { return this.blocks.has(`${a}:${b}`) || this.blocks.has(`${b}:${a}`); }

  readonly bans: Ban[] = [];
  async ban(b: Ban) { if (!this.bans.some(x => x.id === b.id)) this.bans.push({ ...b }); }
  async isBanned(phoneHash: string, personId?: string | null) {
    return this.bans.some(b => (b.phoneHash !== null && b.phoneHash === phoneHash) || (b.scope === "person" && !!personId && b.personId === personId));
  }
  /** Memory store: the phone hash given at createPerson (one phone per person here). */
  async phoneHashesOf(personId: string) { const h = this.personHash.get(personId); return h ? [h] : []; }

  async suppress(phoneHash: string, reason: string, at: number) { if (!this.suppression.has(phoneHash)) this.suppression.set(phoneHash, { reason, at }); }
  async isSuppressed(phoneHash: string) { return this.suppression.has(phoneHash); }
  async unsuppress(phoneHash: string) { this.suppression.delete(phoneHash); }

  async putChallenge(c: Omit<OtpChallenge, "id">) { const id = String(++this.seq); this.challenges.set(id, { ...c, id }); return id; }
  async latestChallenge(app: AppId, e164: string) {
    let best: OtpChallenge | undefined;
    for (const c of this.challenges.values()) if (c.app === app && c.e164 === e164 && (!best || c.createdAt >= best.createdAt)) best = c;
    return best && { ...best };
  }
  async claimAttempt(id: string, max: number, at: number) {
    const c = this.challenges.get(id);
    if (!c || c.consumedAt !== null || c.expiresAt <= at || c.attempts >= max) return false;
    c.attempts++;
    return true;
  }
  async consumeChallenge(id: string, at: number) {
    const c = this.challenges.get(id);
    if (!c || c.consumedAt !== null) return false;
    c.consumedAt = at;
    return true;
  }

  async putSession(s: Session) { this.sessions.set(s.tokenHash, { ...s }); }
  async getSession(tokenHash: string) { const s = this.sessions.get(tokenHash); return s && { ...s }; }
  async revokeSession(tokenHash: string, at: number) { const s = this.sessions.get(tokenHash); if (s) s.revokedAt = s.revokedAt === null ? at : Math.min(s.revokedAt, at); }
  async attachPerson(e164: string, personId: string) { for (const s of this.sessions.values()) if (s.e164 === e164 && s.personId === null) s.personId = personId; }

  async hit(bucket: string, windowMs: number, at: number, rule: HitRule = {}) {
    const windowStart = at - (at % windowMs);
    const cur = this.limits.get(bucket);
    const prevAt = cur?.lastAt ?? null;
    const count = cur && cur.windowStart === windowStart ? cur.count : 0;
    if ((rule.limit !== undefined && count >= rule.limit) || (rule.minGapMs !== undefined && prevAt !== null && at - prevAt < rule.minGapMs)) {
      return { count: count + 1, prevAt, ok: false };
    }
    this.limits.set(bucket, { windowStart, count: count + 1, lastAt: at });
    return { count: count + 1, prevAt, ok: true };
  }

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    this.locks.set(key, tail);
    try { return await run; } finally { if (this.locks.get(key) === tail) this.locks.delete(key); }
  }

  private pendingKey(p: { phoneHash: string; kind: PendingKind; app: AppId }) { return `${p.phoneHash}|${p.kind}|${p.kind === "share" ? p.app : "*"}`; }
  async getPending(phoneHash: string, kind: PendingKind, app?: AppId) {
    const x = this.pending.get(this.pendingKey({ phoneHash, kind, app: app ?? "ntwrk" }));
    return x && (!app || x.app === app) ? { ...x } : undefined;
  }
  async putPending(p: PendingText) { this.pending.set(this.pendingKey(p), { ...p }); }
  async deletePending(phoneHash: string, kind?: PendingKind, app?: AppId) {
    for (const [k, p] of this.pending) if (p.phoneHash === phoneHash && (!kind || p.kind === kind) && (!app || p.app === app)) this.pending.delete(k);
  }

  async purge(before: number) {
    let n = 0;
    for (const [k, c] of this.challenges) if (c.expiresAt < before) { this.challenges.delete(k); n++; }
    for (const [k, s] of this.sessions) if (s.expiresAt < before || (s.revokedAt !== null && s.revokedAt < before)) { this.sessions.delete(k); n++; }
    for (const [k, l] of this.limits) if (l.lastAt < before) { this.limits.delete(k); n++; }
    for (const [k, p] of this.pending) if (p.at < before) { this.pending.delete(k); n++; }
    return n;
  }

  async forgetMembership(personId: string, app: AppId, at: number) {
    const m = this.members.get(`${app}:${personId}`);
    if (m) Object.assign(m, { state: "removed", review: null, firstName: null, profile: {}, leftAt: at });
    for (const g of this.grants.values()) if (g.personId === personId && (g.fromApp === app || g.toApp === app) && g.revokedAt === null) g.revokedAt = at;
  }

  async detachPhoneHash(personId: string) { this.personHash.delete(personId); }
  async deleteAll(personId: string | null, e164: string, phoneHash: string, at: number) {
    await this.suppress(phoneHash, "deleted", at);
    if (personId) {
      for (const [k, m] of this.members) if (m.personId === personId) this.members.delete(k);
      for (const [k, g] of this.grants) if (g.personId === personId) this.grants.delete(k);
      // Blocks stay (a safety fact): the tombstone keeps them, and a new join by this phone revives it.
      for (const [k, ph] of this.phones) if (ph.personId === personId) this.phones.delete(k);
      const p = this.people.get(personId);
      if (p) Object.assign(p, { lowestAge: null, deletedAt: at });
    }
    this.phones.delete(e164);
    for (let i = this.consent.length - 1; i >= 0; i--) if (this.consent[i]!.e164 === e164) this.consent.splice(i, 1);
    for (const [k, c] of this.challenges) if (c.e164 === e164) this.challenges.delete(k);
    for (const [k, s] of this.sessions) if (s.e164 === e164 || (personId && s.personId === personId)) this.sessions.delete(k);
    for (const [k, p] of this.pending) if (p.phoneHash === phoneHash) this.pending.delete(k);
  }
}
