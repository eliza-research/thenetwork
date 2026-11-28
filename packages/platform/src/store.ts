// People, phones, memberships and the rest of the platform schema (migration 0003), behind one
// interface with two implementations: MemoryPeopleStore (tests, dev) and PgPeopleStore (pg-store.ts).
// Times are epoch milliseconds. Phone numbers are E.164.
import type { City } from "../../core/src/types.ts";
import { type BirthReadings, confirmedUnderage, keepLaterEligibilityDate, lowerAge } from "../../core/src/generated/memberAge.ts";
import { browserSignupMemberAllowed } from "../../core/src/generated/oauthBrowserAuthorization.ts";
import { phoneChangePastRetention, rateCounterCutoff, rowBeforeCutoff, sessionPastRetention, stopHintWindowMs } from "../../core/src/generated/platformRetention.ts";
import { lockedPhoneMoveAllowed, pendingWindowOpen } from "../../core/src/generated/phoneChange.ts";
import { appLeaveBindingCurrent, appLeaveMemberCurrent, hasAgeToPreserve, phoneErasureAllowed } from "../../core/src/generated/accountPrivacy.ts";
import { includeLockedBanPhone, staffBanEnrollmentAllowed } from "../../core/src/generated/staffSafetyService.ts";
import { unboundSessionEnds, unboundSessionTakesNewPerson } from "../../core/src/generated/webSession.ts";
import { APP_TO_DOMAIN, DOMAIN_IDS, DOMAIN_TO_APP, type AppId, type DomainId } from "./apps.ts";
import type { ConsentEvent, ConsentLast } from "./consent.ts";
import { lastEvents } from "./consent.ts";
import { type AgeReading, type AgeStanding, ageWrite, createdFirstExact, createdReadings, effectiveAgeAt, floorAfterErasure, mergedFloors, movedPersonAge, verifiedBrowserBirthWrite, type TeenBarReason } from "./age.ts";

export type PhoneMethod = "otp_sms" | "otp_whatsapp" | "inbound_message" | "staff";
export type MembershipState = "invited" | "onboarding" | "active" | "paused" | "restricted" | "removed";

export interface BirthRecord { readings: BirthReadings; birthDate: number | null; firstExact: boolean | null }
export interface Person { id: string; lowestAge: number | null; createdAt: number; deletedAt: number | null; birth: BirthRecord | null }
export interface AgeFloorRecord { age: number; at: number; readings: BirthReadings | null; firstExact: boolean | null }
export interface TeenAgeFactsRow { firstExact: boolean | null; lineType: string | null; createdAt: number; apps: AppId[] }
/** A text flow waiting for the person's next message (platform.pending_texts): a join that has asked for name and age, The Network's "what are you looking for?", a SHARE offer, or the photo consent asked after a photo by text. */
export type PendingKind = "join" | "looking_for" | "share" | "photo_consent";
export interface PendingText { phoneHash: string; kind: PendingKind; app: AppId; name: string | null; age: number | null; birthDate?: number | null; homeCity?: City; at: number }
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
export interface MemberDomainRecord {
  domain: DomainId;
  enabled: boolean;
  originBrand: AppId;
  source: string;
  enabledAt: number;
  disabledAt?: number;
}
export interface SetMemberDomainInput {
  personId: string;
  domain: DomainId;
  enabled: boolean;
  originBrand?: AppId;
  source?: string;
  at?: number;
}
export interface AppLeaveInput {
  app: AppId; e164: string; personId: string | null; expectedMemberId?: string;
  at: number; line?: string | null; ref?: string;
}
export type AppLeaveAdmission = { ok: true; membership?: Membership } | { ok: false };
/**
 * A staff ban after a report (docs/admin-console.md 3.7.1). "phone": this number (its keyed hash) can
 * never join any app again. "person": the person, on every app, and every phone they had when banned.
 * Delete everything keeps it.
 */
export interface Ban { id: string; scope: "phone" | "person"; personId: string | null; phoneHash: string | null; reason: string; reportId: string | null; bannedBy: string; at: number }
export interface StaffBanProjection extends Ban { projectedAt: number | null }
export interface ShareGrant { personId: string; fromApp: AppId; toApp: AppId; fields: string[]; grantedAt: number; revokedAt: number | null }
export interface OtpChallenge {
  id: string; app: AppId; e164: string; provider: string;
  /** The provider's id for this verification (Twilio Verify's VerificationSid): the check is bound to it, so a code sent for one app never verifies another. */
  providerRef: string | null;
  /** Private routing metadata for a Blooio status-only lookup. Legacy challenges have none. */
  providerChatId?: string | null;
  /** Set only when this server checks the code (Blooio or the dev provider). */
  codeHash: string | null;
  attempts: number; createdAt: number; expiresAt: number; consumedAt: number | null;
}
export interface Session {
  tokenHash: string; app: AppId; e164: string; personId: string | null;
  /** createdAt: this token; startedAt: the OTP login the rotation chain began with. */
  createdAt: number; startedAt: number; expiresAt: number; rotatedFrom: string | null; revokedAt: number | null;
}

/**
 * A member's own number change (PRD F25; migration 0033). While it waits, newE164 is the number the code
 * went to; once confirmed it keeps only the keyed hashes of the old and the new number (the audit record).
 */
export interface PhoneChange {
  id: string; personId: string; app: AppId; newE164: string | null; requestedBy: string; requestedAt: number; confirmedAt: number | null;
  oldHash?: string | null; newHash?: string | null;
}
/** What movePhone moves: the person's phone from one number to another, and everything keyed to the number. */
export interface PhoneMove {
  personId: string; changeId: string; oldE164: string; newE164: string; oldHash: string; newHash: string; now: () => number;
  /** The keys of the one-time Eliza notice row (platform.eliza_notices) of the old and the new number (Accounts.noticeHash). */
  oldNoticeHash?: string; newNoticeHash?: string;
}
export type PhoneMoveResult = "ok" | "number_in_use" | "no_phone" | "stale_request" | "banned";

/**
 * Rate counters that look back further than the retention purge (2 days): the bucket kind (the text
 * before the first ":") and its window. purge() keeps these rows until the window has passed, so a
 * rule such as "at most once in 30 days" (service.ts stopHint) still holds after a purge.
 */
export const LONG_RATE_WINDOWS: Readonly<Record<string, number>> = { stop_hint: stopHintWindowMs };
const rateKind = (bucket: string) => bucket.split(":", 1)[0]!;

/** A rate-limit rule for hit(): a hit over `limit` in the window, or within `minGapMs` of the last counted hit, is refused and not counted. */
export interface HitRule { limit?: number; minGapMs?: number }
export interface HitResult { count: number; prevAt: number | null; ok: boolean }
export interface RateBucket { key: string; windowMs: number }
export interface RateBucketRead { used: number; prevAt: number | null }
export interface RecordedMemberAge { personId: string | null; phoneHash: string }
export interface SignupAge { initialMinorAge: number; eligibleAt: number }
export interface SignupBirth { birthKey: number; eligibility?: SignupAge }

export interface PeopleStore {
  findPhone(e164: string): Promise<PhoneIdentity | undefined>;
  /** The phone of the live person with this keyed phone hash (people.phone_hash), if any: lets a holder of only the hash (OAuth grants) find the person. */
  findPhoneByHash(phoneHash: string): Promise<PhoneIdentity | undefined>;
  getPerson(id: string): Promise<Person | undefined>;
  /**
   * A person with their verified phone. A person who deleted everything with this phone (a tombstone
   * with the same keyed phone hash) comes back as the same person, so blocks made against them hold.
   */
  createPerson(p: { id: string; e164: string; method: PhoneMethod; at: number; lowestAge: number | null; phoneHash?: string; joiningSession?: string | null }): Promise<Person>;
  touchPhone(e164: string, at: number): Promise<void>;
  /** Put a number on hold for staff review, or clear the hold with null (the number is then also seen at `at`). */
  setPhoneHold(e164: string, hold: PhoneHold | null, at: number): Promise<void>;
  heldPhones(): Promise<PhoneIdentity[]>;
  ageFloorRecord(phoneHash: string): Promise<AgeFloorRecord | undefined>;
  recordAgeReading(personId: string | null, phoneHash: string, stated: AgeReading, at: number): Promise<number | undefined>;
  ageStanding(personId: string | null, phoneHash: string | null): Promise<AgeStanding>;
  teenBarred(phoneHash: string): Promise<boolean>;
  barTeenPool(phoneHash: string, reason: TeenBarReason, at: number): Promise<void>;
  teenAgeFacts(personId: string): Promise<TeenAgeFactsRow | undefined>;
  minorSignalOpen(personId: string): Promise<boolean>;
  saveSignupAge(member: Membership, e164: string, phoneHash: string, age: SignupAge, at: number): Promise<boolean>;
  saveSignupBirth(member: Membership, e164: string, phoneHash: string, birth: SignupBirth, at: number): Promise<boolean>;

  memberships(personId: string): Promise<Membership[]>;
  getMembership(personId: string, app: AppId): Promise<Membership | undefined>;
  putMembership(m: Membership): Promise<void>;
  /** Commit the exact member, opt-in and session binding if current ownership and bans allow enrollment. */
  admitMembership(m: Membership, consent: ConsentEvent, phoneHash: string, joiningSession?: string | null): Promise<boolean>;
  restrictBannedMemberships(personId: string): Promise<void>;

  listMemberDomains(personId: string): Promise<MemberDomainRecord[]>;
  setMemberDomain(input: SetMemberDomainInput): Promise<MemberDomainRecord>;
  disableMemberDomains(personId: string, domains: readonly DomainId[], source: string, at?: number): Promise<void>;

  /**
   * Append an event. False when an event with the same (e164, ref) is already there (a retried message).
   * `personId`: the person the number belonged to when the message came in. When that person's number
   * changed before this write (movePhone copied the ledger without this event), the event is also written
   * on the person's current number.
   */
  addConsent(e: ConsentEvent, personId?: string): Promise<boolean>;
  /** Check ownership and append an app opt-out before returning the membership selected for cleanup. */
  beginAppLeave(input: AppLeaveInput): Promise<AppLeaveAdmission>;
  /** The last event for (e164, app) and the last for (e164, every app). */
  lastConsent(e164: string, app: AppId): Promise<ConsentLast>;
  /** The events for this app only (export). */
  consentEvents(e164: string, app: AppId): Promise<ConsentEvent[]>;

  putShareGrant(g: ShareGrant): Promise<void>;
  shareGrants(personId: string): Promise<ShareGrant[]>;

  block(from: string, to: string, originApp: AppId, at: number): Promise<void>;
  /** True if either person blocked the other, on any app. */
  isBlocked(a: string, b: string): Promise<boolean>;

  /** Record a ban (never changed or removed by the service), revoke the person's profile-share grants and delete the phone's pending text flows, in one transaction. */
  ban(b: Ban, options?: { deduplicateScope?: boolean }): Promise<void>;
  staffBans(personId: string, scope: Ban["scope"], phoneHashes: readonly string[]): Promise<StaffBanProjection[]>;
  completeStaffBans(ids: readonly string[], at: number): Promise<void>;
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
  /**
   * Rotate in one step: `decide` reads the current row of `tokenHash` (undefined when it is gone or belongs to
   * another number) and returns the next session, or undefined for none. Only with a next session is the old
   * row ended at `revokeAt` and the next one stored, with the person that the old row has at that moment
   * (Quint auth_edge, SD-054: a join's attachPerson may have ended or bound it after the caller read it).
   */
  rotateSession(tokenHash: string, e164: string, revokeAt: number, decide: (current: Session | undefined) => Session | undefined): Promise<void>;
  /**
   * The number has a person now. Of its sessions with no person, `joiningSession` (the web join's own)
   * gets the person, and every other one ends at `at`: it may belong to an earlier holder of the number.
   */
  attachPerson(e164: string, personId: string, joiningSession: string | null, at: number): Promise<void>;
  /** An under-13 decline: the number's sessions with no person end and its pending rows are deleted. */
  endUnboundAccess(e164: string, phoneHash: string, at: number): Promise<void>;
  /** Delete the sessions of a number that has no person (an under-13 join: nothing stays with the number). */
  forgetPersonlessSessions(e164: string): Promise<void>;

  hit(bucket: string, windowMs: number, at: number, rule?: HitRule): Promise<HitResult>;
  /**
   * Several buckets as one request, atomically: `decide` reads every bucket's count in its window and its
   * last counted hit, and the hit is counted in all of them (count true) or in none.
   */
  hitAll<T>(buckets: readonly RateBucket[], at: number, decide: (seen: RateBucketRead[]) => { count: boolean; value: T }): Promise<T>;

  /** Run fn while holding a lock on `key` (one holder per key across processes on Postgres). */
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;

  getPending(phoneHash: string, kind: PendingKind, app?: AppId): Promise<PendingText | undefined>;
  /** Store a pending text flow. A join or looking_for replaces the phone's other one of that kind. */
  putPending(p: PendingText): Promise<void>;
  deletePending(phoneHash: string, kind?: PendingKind, app?: AppId): Promise<void>;

  /** Retention: drop expired OTP challenges, sessions, rate windows (LONG_RATE_WINDOWS kinds once their window has passed too) and pending flows older than `before`. Returns rows removed. */
  purge(before: number): Promise<number>;

  /** Leave one app: the membership is set to removed and its name and profile are cleared; grants that involve the app are revoked. */
  forgetMembership(personId: string, app: AppId, at: number, expectedMemberId?: string): Promise<void>;
  /** Erase the verified person and their current phone, or an unbound phone. Release an exact held binding for reuse. */
  deleteAll(personId: string | null, e164: string, phoneHash: string, at: number, releaseHeldPhone?: boolean): Promise<boolean>;

  /** Store a number change the person started (a newer one replaces any change still waiting). */
  putPhoneChange(c: PhoneChange): Promise<void>;
  /** The person's newest number change that is not confirmed yet. */
  pendingPhoneChange(personId: string): Promise<PhoneChange | undefined>;
  /**
   * Move the person to a new verified number, in one transaction: the phone identity (verified now), the
   * consent history (copied, then the old number's rows go), the keyed phone hash on the person, the age
   * floor (the lowest of both numbers' floors stays, on the new hash), the person's live native MCP grants,
   * the one-time Eliza notice. The old number's sessions, codes and pending text flows end, and messages
   * still waiting in the outbound queue for the old number are ended unsent. The change row is confirmed
   * and keeps only the two hashes. "number_in_use": the new number already belongs to someone (nothing moved).
   */
  movePhone(m: PhoneMove): Promise<PhoneMoveResult>;
}

export class MemoryPeopleStore implements PeopleStore {
  readonly people = new Map<string, Person>();
  readonly phones = new Map<string, PhoneIdentity>();
  readonly members = new Map<string, Membership>(); // key `${app}:${personId}`
  readonly memberDomains = new Map<string, MemberDomainRecord>(); // key `${personId}:${domain}`
  readonly consent: ConsentEvent[] = [];
  readonly grants = new Map<string, ShareGrant>();
  readonly blocks = new Map<string, { from: string; to: string; originApp: AppId; at: number }>();
  readonly suppression = new Map<string, { reason: string; at: number }>();
  readonly ageFloors = new Map<string, AgeFloorRecord>();
  readonly teenBars = new Map<string, { reason: TeenBarReason; at: number }>();
  private readonly signupAges = new Map<string, SignupAge>();
  readonly challenges = new Map<string, OtpChallenge>();
  readonly sessions = new Map<string, Session>();
  readonly limits = new Map<string, { windowStart: number; count: number; lastAt: number }>();
  readonly pending = new Map<string, PendingText>();
  readonly personHash = new Map<string, string>(); // person id -> keyed phone hash
  readonly phoneChanges = new Map<string, PhoneChange>();
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
  async createPerson(p: { id: string; e164: string; method: PhoneMethod; at: number; lowestAge: number | null; phoneHash?: string; joiningSession?: string | null }) {
    if (this.phones.has(p.e164)) throw new Error("phone already linked");
    const back = p.phoneHash ? [...this.personHash].find(([id, h]) => h === p.phoneHash && this.people.get(id)?.deletedAt !== null)?.[0] : undefined;
    const floor = p.phoneHash ? this.ageFloors.get(p.phoneHash) : undefined;
    const readings = createdReadings(floor, p.lowestAge, p.at);
    const birth = readings ? { readings, birthDate: null, firstExact: createdFirstExact(floor) } : null;
    const person: Person = back
      ? Object.assign(this.people.get(back)!, { deletedAt: null, lowestAge: p.lowestAge, birth })
      : { id: p.id, lowestAge: p.lowestAge, createdAt: p.at, deletedAt: null, birth };
    this.people.set(person.id, person);
    if (p.phoneHash) this.personHash.set(person.id, p.phoneHash);
    p = { ...p, id: person.id };
    this.phones.set(p.e164, { e164: p.e164, personId: p.id, verifiedAt: p.at, method: p.method, lastSeenAt: p.at, hold: null });
    await this.attachPerson(p.e164, p.id, p.joiningSession ?? null, p.at);
    return person;
  }
  async touchPhone(e164: string, at: number) { const ph = this.phones.get(e164); if (ph) ph.lastSeenAt = at; }
  async setPhoneHold(e164: string, hold: PhoneHold | null, at?: number) {
    const ph = this.phones.get(e164);
    if (ph) { ph.hold = hold; if (hold === null && at !== undefined) ph.lastSeenAt = at; }
  }
  async heldPhones() { return [...this.phones.values()].filter(p => p.hold !== null).map(p => ({ ...p })); }
  async ageFloorRecord(phoneHash: string) { const f = this.ageFloors.get(phoneHash); return f && { ...f }; }
  async recordAgeReading(personId: string | null, phoneHash: string, stated: AgeReading, at: number) {
    const person = personId ? this.people.get(personId) : undefined;
    if (personId && !person) throw new Error("no person");
    this.writeAgeReading(person, phoneHash, stated, at);
    return effectiveAgeAt(await this.ageStanding(personId, phoneHash), at);
  }
  async saveSignupAge(member: Membership, e164: string, phoneHash: string, age: SignupAge, at: number) {
    return this.withLock(`person-phone-binding:${member.personId}`, async () => {
      if (!await this.signupMemberAllowed(member, e164, phoneHash, at)) return false;
      this.writeSignupAge(member.personId, age);
      return true;
    });
  }
  async saveSignupBirth(member: Membership, e164: string, phoneHash: string, birth: SignupBirth, at: number) {
    return this.withLock(`person-phone-binding:${member.personId}`, async () => {
      if (!await this.signupMemberAllowed(member, e164, phoneHash, at)) return false;
      const change = verifiedBrowserBirthWrite(await this.ageStanding(member.personId, phoneHash), birth.birthKey, at);
      const person = this.people.get(member.personId);
      if (!change || !person) return false;
      person.birth = { readings: change.readings, birthDate: change.birthDate, firstExact: change.firstExact };
      if (birth.eligibility) this.writeSignupAge(member.personId, birth.eligibility);
      if (change.bar) this.barTeenPoolNow(phoneHash, "conflict", at);
      return true;
    });
  }
  private async signupMemberAllowed(member: Membership, e164: string, phoneHash: string, at: number): Promise<boolean> {
    const current = this.members.get(`${member.app}:${member.personId}`);
    return browserSignupMemberAllowed(member.state) && current?.memberId === member.memberId && current.state === member.state
      && current.review === null && await this.enrollmentOwnerAllowed(member.personId, e164, phoneHash, at);
  }
  private writeSignupAge(personId: string, age: SignupAge) {
    const previous = this.signupAges.get(personId);
    this.signupAges.set(personId, previous ? {
      initialMinorAge: lowerAge(previous.initialMinorAge, age.initialMinorAge),
      eligibleAt: keepLaterEligibilityDate(previous.eligibleAt, age.eligibleAt),
    } : { ...age });
  }
  private writeAgeReading(person: Person | undefined, phoneHash: string, stated: AgeReading, at: number) {
    const w = ageWrite({ person, floor: this.ageFloors.get(phoneHash) }, stated, at);
    if (!w) return;
    if (person && w.person) Object.assign(person, { lowestAge: w.person.lowestAge, birth: { readings: w.person.readings, birthDate: w.person.birthDate, firstExact: w.person.firstExact } });
    this.ageFloors.set(phoneHash, w.floor);
    if (w.bar) this.barTeenPoolNow(phoneHash, "conflict", at);
  }
  private barTeenPoolNow(phoneHash: string, reason: TeenBarReason, at: number) {
    if (!this.teenBars.has(phoneHash)) this.teenBars.set(phoneHash, { reason, at });
  }
  async ageStanding(personId: string | null, phoneHash: string | null): Promise<AgeStanding> {
    const person = personId ? this.people.get(personId) : undefined;
    const hash = phoneHash ?? (personId ? this.personHash.get(personId) : undefined);
    const floor = hash ? this.ageFloors.get(hash) : undefined;
    return { person: person && { ...person }, floor: floor && { ...floor }, signup: personId ? this.signupAges.get(personId) : undefined };
  }
  async teenBarred(phoneHash: string) { return this.teenBars.has(phoneHash); }
  async barTeenPool(phoneHash: string, reason: TeenBarReason, at: number) { this.barTeenPoolNow(phoneHash, reason, at); }
  async minorSignalOpen(_personId: string) { return false; }
  async teenAgeFacts(personId: string) {
    const p = this.people.get(personId);
    if (!p || p.deletedAt !== null) return undefined;
    const apps = [...this.members.values()].filter(m => m.personId === personId && m.state !== "removed").map(m => m.app).sort();
    return { firstExact: p.birth?.firstExact ?? null, lineType: null, createdAt: p.createdAt, apps };
  }

  async memberships(personId: string) { return [...this.members.values()].filter(m => m.personId === personId).map(m => ({ ...m })); }
  async getMembership(personId: string, app: AppId) { const m = this.members.get(`${app}:${personId}`); return m && { ...m }; }
  async putMembership(m: Membership) {
    for (const x of this.members.values()) if (x.memberId === m.memberId && (x.app !== m.app || x.personId !== m.personId)) throw new Error("member id in use");
    this.members.set(`${m.app}:${m.personId}`, { ...m, profile: { ...m.profile } });
  }
  private async enrollmentOwnerAllowed(personId: string, e164: string, phoneHash: string, at: number): Promise<boolean> {
    const owner = this.people.get(personId);
    const phone = this.phones.get(e164);
    const owned = phone?.personId === personId && phone.hold === null;
    const age = effectiveAgeAt(await this.ageStanding(personId, phoneHash), at);
    return !confirmedUnderage(age ?? -1)
      && staffBanEnrollmentAllowed(!!owner && owner.deletedAt === null, owned, await this.isBanned(phoneHash, personId));
  }
  async admitMembership(m: Membership, consent: ConsentEvent, phoneHash: string, joiningSession: string | null = null): Promise<boolean> {
    return this.withLock(`person-phone-binding:${m.personId}`, async () => {
      if (!await this.enrollmentOwnerAllowed(m.personId, consent.e164, phoneHash, consent.at)) return false;
      await this.unsuppress(phoneHash);
      await this.putMembership(m);
      await this.addConsent(consent);
      await this.attachPerson(consent.e164, m.personId, joiningSession, consent.at);
      return true;
    });
  }
  async restrictBannedMemberships(personId: string): Promise<void> {
    for (const m of this.members.values()) if (m.personId === personId && m.state !== "invited" && m.state !== "removed") m.state = "restricted";
  }

  async listMemberDomains(personId: string): Promise<MemberDomainRecord[]> {
    const stored: MemberDomainRecord[] = [];
    for (const domain of DOMAIN_IDS) {
      const rec = this.memberDomains.get(`${personId}:${domain}`);
      if (rec) stored.push({ ...rec });
    }
    if (stored.length) return stored;
    const derived = new Map<DomainId, MemberDomainRecord>();
    let ntwrkMembership: Membership | undefined;
    for (const m of this.members.values()) {
      if (m.personId !== personId || (m.state !== "active" && m.state !== "onboarding" && m.state !== "paused")) continue;
      if (m.app === "ntwrk") { ntwrkMembership = m; continue; }
      const domain = APP_TO_DOMAIN[m.app];
      if (!domain) continue;
      const enabled = m.state !== "paused";
      const enabledAt = m.joinedAt ?? 0;
      derived.set(domain, {
        domain, enabled, originBrand: m.app, source: "membership_fallback", enabledAt,
        ...(enabled ? {} : { disabledAt: enabledAt }),
      });
    }
    if (!derived.size && ntwrkMembership) {
      const enabled = ntwrkMembership.state !== "paused";
      const enabledAt = ntwrkMembership.joinedAt ?? 0;
      derived.set("friendship", {
        domain: "friendship", enabled, originBrand: "ntwrk", source: "membership_fallback", enabledAt,
        ...(enabled ? {} : { disabledAt: enabledAt }),
      });
    }
    return DOMAIN_IDS.flatMap(d => { const r = derived.get(d); return r ? [r] : []; });
  }

  async setMemberDomain(input: SetMemberDomainInput): Promise<MemberDomainRecord> {
    const key = `${input.personId}:${input.domain}`;
    const existing = this.memberDomains.get(key);
    const at = input.at ?? Date.now();
    const record: MemberDomainRecord = {
      domain: input.domain,
      enabled: input.enabled,
      originBrand: input.originBrand ?? existing?.originBrand ?? "ntwrk",
      source: input.source ?? existing?.source ?? "onboarding",
      enabledAt: input.enabled ? (existing?.enabled ? existing.enabledAt : at) : (existing?.enabledAt ?? at),
      ...(input.enabled ? {} : { disabledAt: at }),
    };
    this.memberDomains.set(key, record);
    return { ...record };
  }

  async disableMemberDomains(personId: string, domains: readonly DomainId[], source: string, at = Date.now()): Promise<void> {
    for (const domain of new Set(domains)) {
      const key = `${personId}:${domain}`;
      const existing = this.memberDomains.get(key);
      if (existing) {
        if (existing.enabled) {
          this.memberDomains.set(key, { ...existing, enabled: false, source, disabledAt: at });
        }
        continue;
      }
      const backing = this.members.get(`${DOMAIN_TO_APP[domain]}:${personId}`);
      if (backing && (backing.state === "active" || backing.state === "onboarding" || backing.state === "paused")) {
        this.memberDomains.set(key, {
          domain, enabled: false, originBrand: backing.app, source, enabledAt: backing.joinedAt ?? at, disabledAt: at,
        });
      }
    }
  }

  async addConsent(e: ConsentEvent, personId?: string) {
    if (e.ref && this.consent.some(x => x.e164 === e.e164 && x.ref === e.ref)) return false;
    this.consent.push({ ...e });
    if (personId && this.phones.get(e.e164)?.personId !== personId) {
      for (const ph of this.phones.values()) {
        if (ph.personId === personId && (!e.ref || !this.consent.some(x => x.e164 === ph.e164 && x.ref === e.ref))) {
          this.consent.push({ ...e, e164: ph.e164 });
        }
      }
    }
    return true;
  }
  async beginAppLeave(input: AppLeaveInput): Promise<AppLeaveAdmission> {
    const { app, e164, personId, expectedMemberId, at, line, ref } = input;
    const phone = this.phones.get(e164);
    if (!appLeaveBindingCurrent(personId ?? "", phone?.personId ?? "", phone?.hold != null, phone?.verifiedAt ?? 0, at)) return { ok: false };
    if (personId && this.people.get(personId)?.deletedAt !== null) return { ok: false };
    const m = personId ? this.members.get(`${app}:${personId}`) : undefined;
    if (!appLeaveMemberCurrent(expectedMemberId ?? "", m?.memberId ?? "", m?.joinedAt ?? 0, at)) return { ok: false };
    const membership = m && { ...m };
    await this.addConsent({ app, e164, at, line, ref, state: "opted_out", source: "leave" });
    return { ok: true, membership };
  }
  async lastConsent(e164: string, app: AppId) { return lastEvents(this.consent, e164, app); }
  async consentEvents(e164: string, app: AppId) { return this.consent.filter(e => e.e164 === e164 && e.app === app).map(e => ({ ...e })); }

  async putShareGrant(g: ShareGrant) { this.grants.set(`${g.personId}:${g.fromApp}:${g.toApp}`, { ...g }); }
  async shareGrants(personId: string) { return [...this.grants.values()].filter(g => g.personId === personId).map(g => ({ ...g })); }

  async block(from: string, to: string, originApp: AppId, at: number) { this.blocks.set(`${from}:${to}`, { from, to, originApp, at }); }
  async isBlocked(a: string, b: string) { return this.blocks.has(`${a}:${b}`) || this.blocks.has(`${b}:${a}`); }

  readonly bans: Ban[] = [];
  private readonly banProjectionAt = new Map<string, number>();
  async ban(b: Ban, options?: { deduplicateScope?: boolean }) {
    const recordBan = async () => {
      if (options?.deduplicateScope && b.personId && (await this.staffBans(b.personId, b.scope, b.phoneHash ? [b.phoneHash] : [])).length) return;
      const currentHash = b.personId && this.people.get(b.personId)?.deletedAt === null ? this.personHash.get(b.personId) ?? "" : "";
      const rows = includeLockedBanPhone(b.phoneHash ?? "", currentHash)
        ? [b, { ...b, id: `${b.id}:moved`, phoneHash: currentHash }] : [b];
      for (const row of rows) if (!this.bans.some(x => x.id === row.id)) this.bans.push({ ...row });
      for (const h of new Set([b.phoneHash, currentHash])) if (h) await this.barTeenPool(h, "ban", b.at);
      for (const g of this.grants.values()) if (b.personId && g.personId === b.personId && g.revokedAt === null) g.revokedAt = b.at;
      const hashes = [...(b.phoneHash ? [b.phoneHash] : []), ...(b.personId ? await this.phoneHashesOf(b.personId) : [])];
      for (const h of hashes) await this.deletePending(h);
    };
    if (b.personId) await this.withLock(`profile-share:${b.personId}`, () => this.withLock(`person-phone-binding:${b.personId}`, recordBan));
    else await recordBan();
  }
  async staffBans(personId: string, scope: Ban["scope"], phoneHashes: readonly string[]): Promise<StaffBanProjection[]> {
    const decisionId = (b: Ban) => b.id.replace(/:moved$/, "");
    const matching = this.bans.filter(b => scope === "person" ? b.scope === "person" && b.personId === personId : b.phoneHash !== null && phoneHashes.includes(b.phoneHash));
    const decisions = new Set(matching.map(decisionId));
    return this.bans.filter(b => decisions.has(decisionId(b)))
      .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).map(b => ({ ...b, projectedAt: this.banProjectionAt.get(b.id) ?? null }));
  }
  async completeStaffBans(ids: readonly string[], at: number): Promise<void> {
    for (const id of ids) if (!this.banProjectionAt.has(id)) this.banProjectionAt.set(id, at);
  }
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

  async putSession(s: Session) {
    const phone = s.personId === null ? this.phones.get(s.e164) : undefined;
    this.sessions.set(s.tokenHash, unboundSessionTakesNewPerson(phone !== undefined, true) && phone ? { ...s, personId: phone.personId } : { ...s });
  }
  async getSession(tokenHash: string) { const s = this.sessions.get(tokenHash); return s && { ...s }; }
  async revokeSession(tokenHash: string, at: number) { const s = this.sessions.get(tokenHash); if (s) s.revokedAt = s.revokedAt === null ? at : Math.min(s.revokedAt, at); }
  async rotateSession(tokenHash: string, e164: string, revokeAt: number, decide: (current: Session | undefined) => Session | undefined) {
    const current = this.sessions.get(tokenHash);
    const next = decide(current && current.e164 === e164 ? { ...current } : undefined);
    if (!next) return;
    await this.revokeSession(tokenHash, revokeAt);
    this.sessions.set(next.tokenHash, { ...next });
  }
  async attachPerson(e164: string, personId: string, joiningSession: string | null, at: number) {
    const numberHasPerson = this.phones.get(e164)?.personId === personId;
    for (const s of this.sessions.values()) {
      if (s.e164 !== e164 || s.personId !== null) continue;
      if (unboundSessionTakesNewPerson(numberHasPerson, s.tokenHash === joiningSession)) s.personId = personId;
      else if (unboundSessionEnds(numberHasPerson, s.tokenHash === joiningSession)) await this.revokeSession(s.tokenHash, at);
    }
  }
  async endUnboundAccess(e164: string, phoneHash: string, at: number) {
    for (const s of this.sessions.values()) if (s.e164 === e164 && s.personId === null) await this.revokeSession(s.tokenHash, at);
    await this.deletePending(phoneHash);
  }
  async forgetPersonlessSessions(e164: string) {
    for (const [k, s] of this.sessions) if (s.e164 === e164 && s.personId === null) this.sessions.delete(k);
  }

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

  async hitAll<T>(buckets: readonly RateBucket[], at: number, decide: (seen: RateBucketRead[]) => { count: boolean; value: T }): Promise<T> {
    const seen = buckets.map(b => {
      const cur = this.limits.get(b.key), windowStart = at - (at % b.windowMs);
      return { used: cur && cur.windowStart === windowStart ? cur.count : 0, prevAt: cur?.lastAt ?? null };
    });
    const d = decide(seen);
    if (d.count) buckets.forEach((b, i) => this.limits.set(b.key, { windowStart: at - (at % b.windowMs), count: seen[i]!.used + 1, lastAt: at }));
    return d.value;
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
    for (const [k, c] of this.challenges) if (rowBeforeCutoff(c.expiresAt, before)) { this.challenges.delete(k); n++; }
    for (const [k, s] of this.sessions) if (sessionPastRetention(s.expiresAt, s.revokedAt !== null, s.revokedAt ?? before, before)) { this.sessions.delete(k); n++; }
    for (const [k, l] of this.limits) {
      const cutoff = rateCounterCutoff(before, LONG_RATE_WINDOWS[rateKind(k)] ?? 0);
      if (rowBeforeCutoff(l.lastAt, cutoff)) { this.limits.delete(k); n++; }
    }
    for (const [k, p] of this.pending) if (rowBeforeCutoff(p.at, before)) { this.pending.delete(k); n++; }
    for (const [k, c] of this.phoneChanges) if (phoneChangePastRetention(c.confirmedAt !== null, c.requestedAt, before)) { this.phoneChanges.delete(k); n++; }
    return n;
  }

  async putPhoneChange(c: PhoneChange) {
    for (const [k, x] of this.phoneChanges) if (x.personId === c.personId && x.confirmedAt === null && x.id !== c.id) this.phoneChanges.delete(k);
    this.phoneChanges.set(c.id, { ...c });
  }
  async pendingPhoneChange(personId: string) {
    let best: PhoneChange | undefined;
    for (const c of this.phoneChanges.values()) if (c.personId === personId && c.confirmedAt === null && (!best || c.requestedAt >= best.requestedAt)) best = c;
    return best && { ...best };
  }
  async movePhone(m: PhoneMove): Promise<PhoneMoveResult> {
    return this.withLock(`person-phone-binding:${m.personId}`, async () => {
      const old = this.phones.get(m.oldE164);
      if (!old || old.personId !== m.personId || old.hold !== null) return "no_phone";
      const change = this.phoneChanges.get(m.changeId);
      const at = m.now();
      if (!change || change.confirmedAt !== null || change.personId !== m.personId || change.newE164 !== m.newE164
        || !pendingWindowOpen(at - change.requestedAt)) return "stale_request";
      if (!lockedPhoneMoveAllowed(await this.isBanned(m.oldHash, m.personId), await this.isBanned(m.newHash))) return "banned";
      if (this.phones.has(m.newE164)) return "number_in_use";
      this.phones.delete(m.oldE164);
      this.phones.set(m.newE164, { e164: m.newE164, personId: m.personId, verifiedAt: at, method: "otp_sms", lastSeenAt: at, hold: null });
      await this.attachPerson(m.newE164, m.personId, null, at);
      for (let i = this.consent.length - 1; i >= 0; i--) if (this.consent[i]!.e164 === m.newE164 && this.consent[i]!.state === "opted_in") this.consent.splice(i, 1);
      for (const e of this.consent) if (e.e164 === m.oldE164) e.e164 = m.newE164;
      this.personHash.set(m.personId, m.newHash);
      this.suppression.delete(m.newHash);
      const floor = this.ageFloors.get(m.oldHash);
      if (floor) { this.ageFloors.delete(m.oldHash); this.ageFloors.set(m.newHash, mergedFloors(floor, this.ageFloors.get(m.newHash))); }
      const bar = this.teenBars.get(m.oldHash);
      if (bar) await this.barTeenPool(m.newHash, bar.reason, bar.at);
      const mover = this.people.get(m.personId);
      const moved = movedPersonAge({ person: mover, floor: this.ageFloors.get(m.newHash) }, at);
      if (mover && moved) {
        Object.assign(mover, { lowestAge: moved.person.lowestAge, birth: { readings: moved.person.readings, birthDate: moved.person.birthDate, firstExact: moved.person.firstExact } });
        if (moved.bar) this.barTeenPoolNow(m.newHash, "conflict", at);
      }
      for (const [k, s] of this.sessions) if (s.e164 === m.oldE164) this.sessions.delete(k);
      for (const [k, c] of this.challenges) if (c.e164 === m.oldE164) this.challenges.delete(k);
      for (const [k, p] of this.pending) if (p.phoneHash === m.oldHash) this.pending.delete(k);
      Object.assign(change, { confirmedAt: at, newE164: null, oldHash: m.oldHash, newHash: m.newHash });
      return "ok";
    });
  }

  async forgetMembership(personId: string, app: AppId, at: number, expectedMemberId?: string) {
    const m = this.members.get(`${app}:${personId}`);
    if (expectedMemberId !== undefined && m?.memberId !== expectedMemberId) return;
    if (m) Object.assign(m, { state: "removed", review: null, firstName: null, profile: {}, leftAt: at });
    for (const g of this.grants.values()) if (g.personId === personId && (g.fromApp === app || g.toApp === app) && g.revokedAt === null) g.revokedAt = at;
  }

  async deleteAll(personId: string | null, e164: string, phoneHash: string, at: number, releaseHeldPhone = false) {
    const person = personId ? this.people.get(personId) : undefined;
    if (personId && (!person || person.deletedAt !== null)) return false;
    const binding = personId ? [...this.phones.values()].find(phone => phone.personId === personId) : this.phones.get(e164);
    const exactHeld = binding?.e164 === e164 && binding.hold !== null;
    if ((!personId || releaseHeldPhone) && !phoneErasureAllowed(!!personId, !!binding, releaseHeldPhone, exactHeld)) return false;
    const target = binding?.e164 ?? (personId ? undefined : e164);
    const keepAfter = releaseHeldPhone && target ? this.phones.get(target)?.lastSeenAt ?? null : null;
    const hash = (personId ? this.personHash.get(personId) : undefined) ?? (target === e164 ? phoneHash : undefined);
    if (target && hash) {
      if (releaseHeldPhone && personId) {
        this.personHash.delete(personId);
        this.ageFloors.delete(hash);
        this.suppression.delete(hash);
      } else {
        if (!this.suppression.has(hash)) this.suppression.set(hash, { reason: "deleted", at });
        const before = this.ageFloors.get(hash);
        const erased = person ? floorAfterErasure({ person, floor: before, signup: this.signupAges.get(person.id) }, at) : undefined;
        if (hasAgeToPreserve(!!person, erased !== undefined) && erased) this.ageFloors.set(hash, erased);
      }
      for (const [k, p] of this.pending) if (p.phoneHash === hash) this.pending.delete(k);
    }
    if (target) {
      for (let i = this.consent.length - 1; i >= 0; i--) {
        if (this.consent[i]!.e164 === target && (keepAfter === null || this.consent[i]!.at <= keepAfter)) this.consent.splice(i, 1);
      }
      for (const [k, c] of this.challenges) if (c.e164 === target) this.challenges.delete(k);
    }
    for (const [k, s] of this.sessions) if (s.e164 === target || (personId && s.personId === personId)) this.sessions.delete(k);
    if (personId) {
      for (const [k, m] of this.members) if (m.personId === personId) this.members.delete(k);
      for (const domain of DOMAIN_IDS) this.memberDomains.delete(`${personId}:${domain}`);
      for (const [k, g] of this.grants) if (g.personId === personId) this.grants.delete(k);
      // Blocks stay (a safety fact): the tombstone keeps them, and a new join by this phone revives it.
      for (const [k, ph] of this.phones) if (ph.personId === personId) this.phones.delete(k);
      this.signupAges.delete(personId);
      if (person) Object.assign(person, { lowestAge: null, deletedAt: at, birth: null });
      for (const [k, c] of this.phoneChanges) if (c.personId === personId) this.phoneChanges.delete(k);
    }
    return true;
  }
}
