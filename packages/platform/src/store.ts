// People, phones, memberships and the rest of the platform schema (migration 0003), behind one
// interface with two implementations: MemoryPeopleStore (tests, dev) and PgPeopleStore (pg-store.ts).
// Times are epoch milliseconds. Phone numbers are E.164.
import type { AppId } from "./apps.ts";
import type { ConsentEvent, ConsentLast } from "./consent.ts";
import { lastEvents } from "./consent.ts";

export type PhoneMethod = "otp_sms" | "otp_whatsapp" | "inbound_message" | "staff";
export type MembershipState = "invited" | "onboarding" | "active" | "paused" | "restricted" | "removed";

export interface Person { id: string; lowestAge: number | null; createdAt: number; deletedAt: number | null }
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
export interface ShareGrant { personId: string; fromApp: AppId; toApp: AppId; fields: string[]; grantedAt: number; revokedAt: number | null }
export interface OtpChallenge {
  id: string; app: AppId; e164: string; provider: string;
  /** Set only when this server checks the code (the dev provider). */
  codeHash: string | null;
  attempts: number; createdAt: number; expiresAt: number; consumedAt: number | null;
}
export interface Session {
  tokenHash: string; app: AppId; e164: string; personId: string | null;
  createdAt: number; expiresAt: number; rotatedFrom: string | null; revokedAt: number | null;
}

export interface PeopleStore {
  findPhone(e164: string): Promise<PhoneIdentity | undefined>;
  getPerson(id: string): Promise<Person | undefined>;
  /** A new person with their verified phone. */
  createPerson(p: { id: string; e164: string; method: PhoneMethod; at: number; lowestAge: number | null }): Promise<Person>;
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

  addConsent(e: ConsentEvent): Promise<void>;
  /** The last event for (e164, app) and the last for (e164, every app). */
  lastConsent(e164: string, app: AppId): Promise<ConsentLast>;
  /** The events for this app only (export). */
  consentEvents(e164: string, app: AppId): Promise<ConsentEvent[]>;

  putShareGrant(g: ShareGrant): Promise<void>;
  shareGrants(personId: string): Promise<ShareGrant[]>;

  block(from: string, to: string, originApp: AppId, at: number): Promise<void>;
  /** True if either person blocked the other, on any app. */
  isBlocked(a: string, b: string): Promise<boolean>;

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

  /** Count one hit in a fixed window. Returns the count with this hit and the time of the hit before it. */
  hit(bucket: string, windowMs: number, at: number): Promise<{ count: number; prevAt: number | null }>;

  /** Leave one app: the membership is set to removed and its name and profile are cleared; grants that involve the app are revoked. */
  forgetMembership(personId: string, app: AppId, at: number): Promise<void>;
  /** Delete everything for a person and phone; keep a tombstone (people.deleted_at) and the suppression hash. */
  deleteAll(personId: string | null, e164: string, phoneHash: string, at: number): Promise<void>;
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
  private seq = 0;

  async findPhone(e164: string) { return this.phones.get(e164); }
  async getPerson(id: string) { return this.people.get(id); }
  async createPerson(p: { id: string; e164: string; method: PhoneMethod; at: number; lowestAge: number | null }) {
    if (this.phones.has(p.e164)) throw new Error("phone already linked");
    const person: Person = { id: p.id, lowestAge: p.lowestAge, createdAt: p.at, deletedAt: null };
    this.people.set(p.id, person);
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

  async addConsent(e: ConsentEvent) { this.consent.push({ ...e }); }
  async lastConsent(e164: string, app: AppId) { return lastEvents(this.consent, e164, app); }
  async consentEvents(e164: string, app: AppId) { return this.consent.filter(e => e.e164 === e164 && e.app === app).map(e => ({ ...e })); }

  async putShareGrant(g: ShareGrant) { this.grants.set(`${g.personId}:${g.fromApp}:${g.toApp}`, { ...g }); }
  async shareGrants(personId: string) { return [...this.grants.values()].filter(g => g.personId === personId).map(g => ({ ...g })); }

  async block(from: string, to: string, originApp: AppId, at: number) { this.blocks.set(`${from}:${to}`, { from, to, originApp, at }); }
  async isBlocked(a: string, b: string) { return this.blocks.has(`${a}:${b}`) || this.blocks.has(`${b}:${a}`); }

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

  async hit(bucket: string, windowMs: number, at: number) {
    const windowStart = at - (at % windowMs);
    const cur = this.limits.get(bucket);
    if (!cur || cur.windowStart !== windowStart) {
      this.limits.set(bucket, { windowStart, count: 1, lastAt: at });
      return { count: 1, prevAt: cur?.lastAt ?? null };
    }
    const prevAt = cur.lastAt;
    cur.count++;
    cur.lastAt = at;
    return { count: cur.count, prevAt };
  }

  async forgetMembership(personId: string, app: AppId, at: number) {
    const m = this.members.get(`${app}:${personId}`);
    if (m) Object.assign(m, { state: "removed", review: null, firstName: null, profile: {}, leftAt: at });
    for (const g of this.grants.values()) if (g.personId === personId && (g.fromApp === app || g.toApp === app) && g.revokedAt === null) g.revokedAt = at;
  }

  async deleteAll(personId: string | null, e164: string, phoneHash: string, at: number) {
    await this.suppress(phoneHash, "deleted", at);
    if (personId) {
      for (const [k, m] of this.members) if (m.personId === personId) this.members.delete(k);
      for (const [k, g] of this.grants) if (g.personId === personId) this.grants.delete(k);
      for (const [k, b] of this.blocks) if (b.from === personId) this.blocks.delete(k);
      for (const [k, ph] of this.phones) if (ph.personId === personId) this.phones.delete(k);
      const p = this.people.get(personId);
      if (p) Object.assign(p, { lowestAge: null, deletedAt: at });
    }
    this.phones.delete(e164);
    for (let i = this.consent.length - 1; i >= 0; i--) if (this.consent[i]!.e164 === e164) this.consent.splice(i, 1);
    for (const [k, c] of this.challenges) if (c.e164 === e164) this.challenges.delete(k);
    for (const [k, s] of this.sessions) if (s.e164 === e164 || (personId && s.personId === personId)) this.sessions.delete(k);
  }
}
