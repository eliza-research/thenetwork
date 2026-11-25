// PeopleStore on Postgres (the platform schema, migration 0003). The login needs the
// platform_service role (or the owner). Run the migrations first (pnpm run db:migrate).
import { SQL } from "../../core/src/runtime/postgres.ts";
import { type BirthReadings, confirmedUnderage, minMemberAge, textUseAllowedAtAge, underageCleanupRequired } from "../../core/src/generated/memberAge.ts";
import { browserSignupMemberAllowed } from "../../core/src/generated/oauthBrowserAuthorization.ts";
import { lockedPhoneMoveAllowed, pendingWindowOpen } from "../../core/src/generated/phoneChange.ts";
import { rateCounterCutoff } from "../../core/src/generated/platformRetention.ts";
import { appLeaveBindingCurrent, appLeaveMemberCurrent, hasAgeToPreserve, phoneErasureAllowed } from "../../core/src/generated/accountPrivacy.ts";
import { erasureKeepsStaffHold, includeLockedBanPhone, staffBanEnrollmentAllowed } from "../../core/src/generated/staffSafetyService.ts";
import { personMinorSignalOpen } from "../../core/src/generated/safetyCase.ts";
import { unboundSessionEnds, unboundSessionTakesNewPerson } from "../../core/src/generated/webSession.ts";
import type { AppId } from "./apps.ts";
import { resolveConsent, type ConsentEvent, type ConsentLast } from "./consent.ts";
import { LONG_RATE_WINDOWS } from "./store.ts";
import type { AgeFloorRecord, AppLeaveAdmission, AppLeaveInput, Ban, BirthRecord, HitResult, HitRule, Membership, OtpChallenge, PendingKind, PendingText, PeopleStore, Person, PhoneChange, PhoneHold, PhoneIdentity, PhoneMethod, PhoneMove, PhoneMoveResult, RateBucket, RateBucketRead, RecordedMemberAge, Session, ShareGrant, SignupAge, SignupBirth, StaffBanProjection, TeenAgeFactsRow } from "./store.ts";
import { type AgeReading, type AgeStanding, ageWrite, createdFirstExact, createdReadings, effectiveAgeAt, floorAfterErasure, mergedFloors, movedPersonAge, verifiedBrowserBirthWrite, type TeenBarReason } from "./age.ts";

type Row = Record<string, any>;
const ms = (v: unknown): number | null => (v === null || v === undefined ? null : new Date(v as string | Date).getTime());
const ts = (v: number | null | undefined) => (v === null || v === undefined ? null : new Date(v));
const json = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : v) as T;

async function lockPhoneBinding(tx: SQL, e164: string): Promise<void> {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`phone-binding:${e164}`}, 0))`;
}

async function lockPersonPhone(tx: SQL, personId: string): Promise<void> {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`person-phone-binding:${personId}`}, 0))`;
}

async function lockAgeFloor(tx: SQL, phoneHash: string): Promise<void> {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`age-floor:${phoneHash}`}, 0))`;
}

async function putAgeFloor(tx: SQL, phoneHash: string, floor: AgeFloorRecord): Promise<void> {
  const r = floor.readings;
  await tx`insert into platform.age_floor (phone_hash, lowest_age, at, birth_lower, birth_upper, birth_youngest, birth_first_exact)
    values (${phoneHash}, ${floor.age}, ${ts(floor.at)}, ${r?.lower ?? null}, ${r?.upper ?? null}, ${r?.youngest ?? null}, ${floor.firstExact})
    on conflict (phone_hash) do update set lowest_age=excluded.lowest_age, at=excluded.at,
      birth_lower=excluded.birth_lower, birth_upper=excluded.birth_upper, birth_youngest=excluded.birth_youngest, birth_first_exact=excluded.birth_first_exact`;
}

async function barTeenPoolIn(tx: SQL, phoneHash: string, reason: TeenBarReason, at: number): Promise<void> {
  await tx`insert into platform.teen_pool_bars (phone_hash, reason, at) values (${phoneHash}, ${reason}, ${ts(at)}) on conflict (phone_hash) do nothing`;
}

async function putPersonAge(tx: SQL, personId: string, w: Pick<Person, "lowestAge"> & { readings: BirthReadings; birthDate: number | null; firstExact: boolean | null }): Promise<void> {
  const r = w.readings;
  await tx`update platform.people set lowest_age=${w.lowestAge}, birth_lower=${r.lower}, birth_upper=${r.upper}, birth_youngest=${r.youngest},
    birth_date=${w.birthDate}, birth_first_exact=${w.firstExact} where id=${personId}::uuid`;
}

async function attachPersonIn(tx: SQL, e164: string, personId: string, joiningSession: string | null, at: number): Promise<void> {
  const [phone] = await tx<{ person_id: string }[]>`select person_id from platform.phone_identities where e164 = ${e164}`;
  const numberHasPerson = phone?.person_id === personId;
  const unbound = await tx<{ token_hash: string }[]>`select token_hash from platform.sessions where e164 = ${e164} and person_id is null for update`;
  for (const { token_hash } of unbound) {
    if (unboundSessionTakesNewPerson(numberHasPerson, token_hash === joiningSession)) await tx`update platform.sessions set person_id = ${personId}::uuid where token_hash = ${token_hash}`;
    else if (unboundSessionEnds(numberHasPerson, token_hash === joiningSession)) {
      await tx`update platform.sessions set revoked_at = least(coalesce(revoked_at, ${ts(at)}), ${ts(at)}) where token_hash = ${token_hash}`;
    }
  }
}

export const ageFloorColumns = (db: SQL) => db`f.lowest_age as floor_lowest_age, f.at as floor_at, f.birth_lower as floor_birth_lower,
  f.birth_upper as floor_birth_upper, f.birth_youngest as floor_birth_youngest`;

const readingsOf = (lower: unknown, upper: unknown, youngest: unknown): BirthReadings | null =>
  upper === null || upper === undefined ? null : { lower: Number(lower), upper: Number(upper), youngest: Number(youngest) };

const birthOf = (r: Row): BirthRecord | null => {
  const readings = readingsOf(r.birth_lower, r.birth_upper, r.birth_youngest);
  return readings && { readings, birthDate: r.birth_date === null || r.birth_date === undefined ? null : Number(r.birth_date), firstExact: r.birth_first_exact ?? null };
};

const person = (r: Row): Person => ({ id: r.id, lowestAge: r.lowest_age ?? null, createdAt: ms(r.created_at)!, deletedAt: ms(r.deleted_at), birth: birthOf(r) });

const ageFloorOf = (r: Row): AgeFloorRecord => ({ age: r.lowest_age, at: ms(r.at)!, readings: readingsOf(r.birth_lower, r.birth_upper, r.birth_youngest), firstExact: r.birth_first_exact ?? null });

async function readSignupAge(tx: SQL, personId: string): Promise<SignupAge | undefined> {
  const [row] = await tx<{ initial_minor_age: number; eligible_at: Date }[]>`select initial_minor_age, eligible_at
    from platform.signup_eligibility where person_id = ${personId}::uuid`;
  return row && { initialMinorAge: row.initial_minor_age, eligibleAt: row.eligible_at.getTime() };
}

export function ageStandingOf(r: Row): AgeStanding {
  const floor = r.floor_lowest_age === null || r.floor_lowest_age === undefined ? undefined
    : ageFloorOf({ lowest_age: r.floor_lowest_age, at: r.floor_at, birth_lower: r.floor_birth_lower, birth_upper: r.floor_birth_upper, birth_youngest: r.floor_birth_youngest });
  return { person: r.id === null || r.id === undefined ? undefined : person(r), floor };
}

async function readAgeStanding(tx: SQL, personId: string | null, phoneHash: string | null, lock: boolean): Promise<AgeStanding> {
  const [p] = personId ? (lock ? await tx`select * from platform.people where id=${personId}::uuid for update`
    : await tx`select * from platform.people where id=${personId}::uuid`) : [];
  const hash = phoneHash ?? (p?.phone_hash as string | null | undefined) ?? null;
  if (hash && lock) await lockAgeFloor(tx, hash);
  const [f] = hash ? await tx`select * from platform.age_floor where phone_hash=${hash}` : [];
  return { person: p ? person(p) : undefined, floor: f ? ageFloorOf(f) : undefined, signup: p ? await readSignupAge(tx, p.id) : undefined };
}

async function writeAgeReading(tx: SQL, personId: string | null, phoneHash: string, stated: AgeReading, at: number): Promise<AgeStanding> {
  const before = await readAgeStanding(tx, personId, phoneHash, true);
  if (personId && !before.person) throw new Error("no person");
  const w = ageWrite(before, stated, at);
  if (!w) return before;
  if (personId && w.person) await putPersonAge(tx, personId, w.person);
  await putAgeFloor(tx, phoneHash, w.floor);
  if (w.bar) await barTeenPoolIn(tx, phoneHash, "conflict", at);
  return readAgeStanding(tx, personId, phoneHash, false);
}
const phone = (r: Row): PhoneIdentity => ({ e164: r.e164, personId: r.person_id, verifiedAt: ms(r.verified_at)!, method: r.method, lastSeenAt: ms(r.last_seen_at), hold: r.hold ?? null });
const membership = (r: Row): Membership => ({
  app: r.app_id, personId: r.person_id, memberId: r.member_id, state: r.state, review: r.review ?? null, firstName: r.first_name ?? null,
  profile: json<Record<string, unknown>>(r.profile) ?? {}, joinedAt: ms(r.joined_at), leftAt: ms(r.left_at),
});
const consent = (r: Row): ConsentEvent => ({
  e164: r.e164, app: r.app_id ?? null, line: r.line ?? null, state: r.state, source: r.source, wording: r.wording ?? null,
  wordingVersion: r.wording_version ?? null, namedApp: r.named_app ?? null, ref: r.ref ?? null, at: ms(r.at)!,
});
const pendingRow = (r: Row): PendingText => ({ phoneHash: r.phone_hash, kind: r.kind, app: r.app_id, name: r.name ?? null, age: r.age ?? null, ...(r.birth_date === null || r.birth_date === undefined ? {} : { birthDate: Number(r.birth_date) }), ...(r.home_city ? { homeCity: r.home_city } : {}), at: ms(r.at)! });
const challenge = (r: Row): OtpChallenge => ({
  id: String(r.id), app: r.app_id, e164: r.e164, provider: r.provider, providerRef: r.provider_ref ?? null, providerChatId: r.provider_chat_id ?? null, codeHash: r.code_hash ?? null, attempts: r.attempts,
  createdAt: ms(r.created_at)!, expiresAt: ms(r.expires_at)!, consumedAt: ms(r.consumed_at),
});
const phoneChange = (r: Row): PhoneChange => ({
  id: r.id, personId: r.person_id, app: r.app_id, newE164: r.new_e164 ?? null, requestedBy: r.requested_by, requestedAt: ms(r.requested_at)!,
  confirmedAt: ms(r.confirmed_at), oldHash: r.old_hash ?? null, newHash: r.new_hash ?? null,
});
/** Outbound rows that still wait for the worker (packages/blooio outbound-queue.ts); a row being sent or in doubt is left alone. */
const OUTBOUND_WAITING = "{pending,retry_scheduled,deferred_quiet_hours,held_awaiting_reply}";
const session = (r: Row): Session => ({
  tokenHash: r.token_hash, app: r.app_id, e164: r.e164, personId: r.person_id ?? null, createdAt: ms(r.created_at)!, startedAt: ms(r.started_at ?? r.created_at)!, expiresAt: ms(r.expires_at)!,
  rotatedFrom: r.rotated_from ?? null, revokedAt: ms(r.revoked_at),
});

export class PgPeopleStore implements PeopleStore {
  readonly sql: SQL;
  private readonly owned: boolean;
  constructor(db: string | SQL) {
    this.owned = typeof db === "string";
    this.sql = typeof db === "string" ? new SQL({ url: db, max: 4 }) : db;
  }
  async close() { if (this.owned) await this.sql.close(); }

  async findPhone(e164: string) {
    const [r] = await this.sql`select * from platform.phone_identities where e164 = ${e164}`;
    return r ? phone(r) : undefined;
  }
  async findPhoneByHash(phoneHash: string) {
    const [r] = await this.sql`select ph.* from platform.people p join platform.phone_identities ph on ph.person_id = p.id
      where p.phone_hash = ${phoneHash} and p.deleted_at is null order by ph.verified_at desc limit 1`;
    return r ? phone(r) : undefined;
  }
  async getPerson(id: string) {
    const [r] = await this.sql`select * from platform.people where id = ${id}`;
    return r ? person(r) : undefined;
  }
  async createPerson(p: { id: string; e164: string; method: PhoneMethod; at: number; lowestAge: number | null; phoneHash?: string; joiningSession?: string | null }) {
    return this.sql.begin(async tx => {
      await lockPhoneBinding(tx, p.e164);
      if (p.phoneHash) await lockAgeFloor(tx, p.phoneHash);
      const [floorRow] = p.phoneHash ? await tx`select * from platform.age_floor where phone_hash = ${p.phoneHash}` : [];
      const floor = floorRow ? ageFloorOf(floorRow) : undefined;
      const readings = createdReadings(floor, p.lowestAge, p.at);
      const [lower, upper, youngest] = readings ? [readings.lower, readings.upper, readings.youngest] : [null, null, null];
      const firstExact = readings ? createdFirstExact(floor) : null;
      // A tombstone with this phone's keyed hash: the same person again (blocks against them still hold).
      const [back] = p.phoneHash ? await tx`update platform.people set deleted_at = null, lowest_age = ${p.lowestAge},
          birth_lower = ${lower}, birth_upper = ${upper}, birth_youngest = ${youngest}, birth_date = null, birth_first_exact = ${firstExact}
        where id = (select id from platform.people where phone_hash = ${p.phoneHash} and deleted_at is not null order by deleted_at desc limit 1) returning *` : [];
      const [r] = back ? [back] : await tx`insert into platform.people (id, lowest_age, created_at, phone_hash, birth_lower, birth_upper, birth_youngest, birth_first_exact)
        values (${p.id}, ${p.lowestAge}, ${ts(p.at)}, ${p.phoneHash ?? null}, ${lower}, ${upper}, ${youngest}, ${firstExact}) returning *`;
      await tx`insert into platform.phone_identities (e164, person_id, verified_at, method, last_seen_at) values (${p.e164}, ${r!.id}, ${ts(p.at)}, ${p.method}, ${ts(p.at)})`;
      await attachPersonIn(tx, p.e164, r!.id as string, p.joiningSession ?? null, p.at);
      return person(r!);
    });
  }
  async touchPhone(e164: string, at: number) {
    await this.sql`update platform.phone_identities set last_seen_at = ${ts(at)} where e164 = ${e164}`;
  }
  async setPhoneHold(e164: string, hold: PhoneHold | null, at: number) {
    // Lifting a hold also marks the number seen, in the same statement: a text read in between never finds it unheld and stale.
    if (hold === null) await this.sql`update platform.phone_identities set hold = null, hold_at = null, last_seen_at = ${ts(at)} where e164 = ${e164}`;
    else await this.sql`update platform.phone_identities set hold = ${hold}, hold_at = ${ts(at)} where e164 = ${e164}`;
  }
  async heldPhones() {
    return (await this.sql`select * from platform.phone_identities where hold is not null order by hold_at`).map(phone);
  }
  async ageFloorRecord(phoneHash: string) {
    const [r] = await this.sql`select * from platform.age_floor where phone_hash = ${phoneHash}`;
    return r ? ageFloorOf(r) : undefined;
  }
  async recordAgeReading(personId: string | null, phoneHash: string, stated: AgeReading, at: number) {
    return effectiveAgeAt(await this.sql.begin(tx => writeAgeReading(tx, personId, phoneHash, stated, at)), at);
  }
  async saveSignupAge(member: Membership, e164: string, phoneHash: string, age: SignupAge, at: number, transaction?: SQL): Promise<boolean> {
    const save = async (tx: SQL) => {
      if (!await this.signupMemberAllowed(tx, member, e164, phoneHash, at)) return false;
      await this.writeSignupAge(tx, member.personId, age);
      return true;
    };
    return transaction ? save(transaction) : this.sql.begin(save);
  }
  async saveSignupBirth(member: Membership, e164: string, phoneHash: string, birth: SignupBirth, at: number, transaction?: SQL): Promise<boolean> {
    const save = async (tx: SQL) => {
      if (!await this.signupMemberAllowed(tx, member, e164, phoneHash, at)) return false;
      const change = verifiedBrowserBirthWrite(await readAgeStanding(tx, member.personId, phoneHash, true), birth.birthKey, at);
      if (!change) return false;
      await putPersonAge(tx, member.personId, change);
      if (birth.eligibility) await this.writeSignupAge(tx, member.personId, birth.eligibility);
      if (change.bar) await barTeenPoolIn(tx, phoneHash, "conflict", at);
      return true;
    };
    return transaction ? save(transaction) : this.sql.begin(save);
  }
  private async signupMemberAllowed(tx: SQL, member: Membership, e164: string, phoneHash: string, at: number): Promise<boolean> {
    if (!browserSignupMemberAllowed(member.state) || !await this.enrollmentOwnerAllowed(tx, member.personId, e164, phoneHash, at)) return false;
    const [current] = await tx`select member_id from platform.memberships where person_id = ${member.personId}::uuid
      and app_id = ${member.app} and member_id = ${member.memberId} and state = ${member.state} and review is null for update`;
    return !!current;
  }
  private async writeSignupAge(tx: SQL, personId: string, age: SignupAge): Promise<void> {
    await tx`insert into platform.signup_eligibility (person_id, initial_minor_age, eligible_at)
      values (${personId}::uuid, ${age.initialMinorAge}, ${ts(age.eligibleAt)})
      on conflict (person_id) do update set
        initial_minor_age = least(platform.signup_eligibility.initial_minor_age, excluded.initial_minor_age),
        eligible_at = greatest(platform.signup_eligibility.eligible_at, excluded.eligible_at)`;
  }
  async ageStanding(personId: string | null, phoneHash: string | null) {
    return readAgeStanding(this.sql, personId, phoneHash, false);
  }
  async teenBarred(phoneHash: string) {
    const [r] = await this.sql`select 1 from platform.teen_pool_bars where phone_hash = ${phoneHash}`;
    return !!r;
  }
  async barTeenPool(phoneHash: string, reason: TeenBarReason, at: number) {
    await barTeenPoolIn(this.sql, phoneHash, reason, at);
  }
  async minorSignalOpen(personId: string) {
    const [r] = await this.sql<{ at: Date }[]>`select at from platform.person_minor_signals where person_id = ${personId}::uuid`;
    return !!r && personMinorSignalOpen(true, r.at.getTime(), false, 0);
  }
  async teenAgeFacts(personId: string): Promise<TeenAgeFactsRow | undefined> {
    const [r] = await this.sql`select p.birth_first_exact, p.created_at,
        (select ph.line_type from platform.phone_identities ph where ph.person_id = p.id and ph.hold is null order by ph.verified_at desc, ph.e164 limit 1) as line_type,
        array(select m.app_id from platform.memberships m where m.person_id = p.id and m.state <> 'removed' order by m.app_id) as apps
      from platform.people p where p.id = ${personId}::uuid and p.deleted_at is null`;
    return r ? { firstExact: r.birth_first_exact ?? null, lineType: r.line_type ?? null, createdAt: ms(r.created_at)!, apps: r.apps as AppId[] } : undefined;
  }

  /** Persist the observation inside the app unit that read it, before its member row can be erased. */
  async recordMemberAge(app: AppId, memberId: string, e164: string, phoneHash: string, age: number, at: number): Promise<RecordedMemberAge | undefined> {
    const tx = this.sql;
    const [member] = await tx<{ person_id: string | null }[]>`select person_id from network.members
      where app_id=${app} and id=${memberId} and account_status<>'removed'`;
    if (!member) return;
    if (member.person_id) {
      await lockPersonPhone(tx, member.person_id);
      const [bound] = await tx`select 1 from platform.people p, platform.phone_identities ph, network.members m
        where p.id=${member.person_id}::uuid and p.deleted_at is null and ph.person_id=p.id and ph.e164=${e164} and ph.hold is null
          and m.app_id=${app} and m.id=${memberId} and m.person_id=p.id and m.account_status<>'removed'`;
      if (!bound) return;
      await writeAgeReading(tx, member.person_id, phoneHash, { kind: "age", age }, at);
    } else {
      await lockPhoneBinding(tx, e164);
      const [legacy] = await tx`select 1 from network.members m join network.channel_identities c on c.app_id=m.app_id and c.member_id=m.id
        where m.app_id=${app} and m.id=${memberId} and m.person_id is null and m.account_status<>'removed'
          and c.address=${e164} and c.channel in ('imessage','sms')
          and not exists (select 1 from platform.phone_identities where e164=${e164})`;
      if (!legacy) return;
      await writeAgeReading(tx, null, phoneHash, { kind: "age", age }, at);
    }
    return { personId: member.person_id, phoneHash };
  }

  async pendingUnderageCleanup(limit: number): Promise<string[]> {
    const rows = await this.sql<{ id: string }[]>`select p.id::text as id from platform.people p
      where p.lowest_age<${minMemberAge} and p.deleted_at is null
        and exists (select 1 from platform.memberships m where m.person_id=p.id and m.state<>'removed')
      order by p.id limit ${limit}`;
    return rows.map(row => row.id);
  }

  /** Record consent on the exact current binding. Live memberships remain the durable cleanup work. */
  async beginUnderageCleanup(personId: string, at: number): Promise<Membership[]> {
    return this.sql.begin(async tx => {
      await lockPersonPhone(tx, personId);
      const [owner] = await tx<{ lowest_age: number | null; phone_hash: string | null; e164: string | null }[]>`select p.lowest_age,p.phone_hash,phone.e164
        from platform.people p left join lateral (select e164 from platform.phone_identities
          where person_id=p.id and hold is null order by verified_at desc,e164 limit 1) phone on true
        where p.id=${personId}::uuid and p.deleted_at is null`;
      const age = owner?.lowest_age ?? -1;
      if (!owner || !confirmedUnderage(age)) return [];
      const store = new PgPeopleStore(tx);
      const live = (await store.memberships(personId)).filter(member => underageCleanupRequired(age, member.state !== "removed"));
      if (owner.phone_hash) await store.deletePending(owner.phone_hash);
      await tx`delete from platform.signup_eligibility where person_id = ${personId}::uuid`;
      const e164 = owner.e164;
      if (e164) for (const member of live) await store.addConsent({ app: member.app, e164, state: "opted_out", source: "join_declined", at,
        ref: `underage:${personId}:${member.app}` });
      return live;
    });
  }

  async memberships(personId: string) {
    return (await this.sql`select * from platform.memberships where person_id = ${personId} order by app_id`).map(membership);
  }
  async getMembership(personId: string, app: AppId) {
    const [r] = await this.sql`select * from platform.memberships where person_id = ${personId} and app_id = ${app}`;
    return r ? membership(r) : undefined;
  }
  async putMembership(m: Membership, db = this.sql) {
    await db`insert into platform.memberships (app_id, person_id, member_id, state, review, first_name, profile, joined_at, left_at)
      values (${m.app}, ${m.personId}, ${m.memberId}, ${m.state}, ${m.review}, ${m.firstName}, ${m.profile}::jsonb, ${ts(m.joinedAt)}, ${ts(m.leftAt)})
      on conflict (app_id, person_id) do update set member_id = excluded.member_id, state = excluded.state, review = excluded.review,
        first_name = excluded.first_name, profile = excluded.profile, joined_at = excluded.joined_at, left_at = excluded.left_at`;
  }

  async restrictBannedMemberships(personId: string): Promise<void> {
    await this.sql`update platform.memberships set state='restricted' where person_id=${personId}::uuid and state not in ('removed','invited')`;
  }

  async enrollmentOwnerAllowed(tx: SQL, personId: string, e164: string | undefined, phoneHash: string | undefined, at: number): Promise<boolean> {
    await lockPersonPhone(tx, personId);
    const [owner] = await tx<Row[]>`select p.*, ${ageFloorColumns(tx)},
        exists (select 1 from platform.phone_identities ph where ph.person_id=p.id and ph.hold is null
          ${e164 === undefined ? tx`` : tx`and ph.e164=${e164}`}) as verified
      from platform.people p left join platform.age_floor f on f.phone_hash=p.phone_hash
      where p.id=${personId}::uuid and p.deleted_at is null for update of p`;
    const banned = !!owner && await this.isBanned(phoneHash ?? owner.phone_hash ?? "", personId, tx);
    const age = owner ? effectiveAgeAt({ ...ageStandingOf(owner), signup: await readSignupAge(tx, personId) }, at) : undefined;
    return staffBanEnrollmentAllowed(!!owner, owner?.verified === true, banned) && !confirmedUnderage(age ?? -1);
  }

  async admitMembership(m: Membership, consent: ConsentEvent, phoneHash: string, joiningSession: string | null = null, transaction?: SQL): Promise<boolean> {
    const admit = async (tx: SQL) => {
      if (!await this.enrollmentOwnerAllowed(tx, m.personId, consent.e164, phoneHash, consent.at)) return false;
      await tx`delete from platform.suppression where phone_hash=${phoneHash}`;
      await this.putMembership(m, tx);
      await this.insertConsent(consent, tx);
      await attachPersonIn(tx, consent.e164, m.personId, joiningSession, consent.at);
      return true;
    };
    return transaction ? admit(transaction) : this.sql.begin(admit);
  }

  private async insertConsent(e: ConsentEvent, db: SQL = this.sql) {
    const r = await db`insert into platform.consent_events (e164, app_id, line, state, source, wording, wording_version, ref, named_app, at)
      values (${e.e164}, ${e.app}, ${e.line ?? null}, ${e.state}, ${e.source}, ${e.wording ?? null}, ${e.wordingVersion ?? null}, ${e.ref ?? null}, ${e.namedApp ?? null}, ${ts(e.at)})
      on conflict (e164, ref) where ref is not null do nothing returning id`;
    return r.length > 0;
  }

  async addConsent(e: ConsentEvent, personId?: string) {
    if (!personId) return this.insertConsent(e, this.sql);
    return this.sql.begin(async tx => {
      // A number change of this number that runs now finishes first (movePhone locks the phone row). One that
      // starts later waits for this lock, then copies this event to the new number.
      const [ph] = await tx`select person_id from platform.phone_identities where e164 = ${e.e164} for share`;
      const inserted = await this.insertConsent(e, tx);
      // The number moved before this write: the event follows the person to the number they have now.
      if (ph?.person_id !== personId) {
        await tx`insert into platform.consent_events (e164, app_id, line, state, source, wording, wording_version, ref, named_app, at)
          select ph.e164, ${e.app}, ${e.line ?? null}, ${e.state}, ${e.source}, ${e.wording ?? null}, ${e.wordingVersion ?? null}, ${e.ref ?? null}, ${e.namedApp ?? null}, ${ts(e.at)}
          from platform.phone_identities ph where ph.person_id = ${personId}::uuid and ph.e164 <> ${e.e164}
          on conflict (e164, ref) where ref is not null do nothing`;
      }
      return inserted;
    });
  }

  /** The age and the owner that authorize START must still hold when its consent event commits. */
  async recordCarrierStart(e: ConsentEvent & { app: AppId }, phoneHash: string): Promise<"recorded" | "under_age" | "held" | "superseded"> {
    return this.sql.begin(async tx => {
      const store = new PgPeopleStore(tx);
      const before = await store.findPhone(e.e164);
      if (before?.personId) await lockPersonPhone(tx, before.personId);
      else await lockPhoneBinding(tx, e.e164);
      const phone = await store.findPhone(e.e164);
      if (before?.personId !== phone?.personId || phone?.hold != null) return "held";
      const person = phone && await store.getPerson(phone.personId);
      if (phone && (!person || person.deletedAt !== null)) return "held";
      if (await store.isBanned(phoneHash, person?.id)) return "held";
      const age = effectiveAgeAt(await store.ageStanding(person?.id ?? null, phoneHash), e.at);
      if (!textUseAllowedAtAge(age ?? -1, false)) return "under_age";
      await store.addConsent(e);
      if (resolveConsent(await store.lastConsent(e.e164, e.app)) !== "opted_in") return "superseded";
      if (person) await tx`update platform.memberships set state='active'
        where person_id=${person.id}::uuid and app_id=${e.app} and state='paused'`;
      return "recorded";
    });
  }
  async beginAppLeave(input: AppLeaveInput): Promise<AppLeaveAdmission> {
    const { app, e164, personId, expectedMemberId, at, line, ref } = input;
    return this.sql.begin(async tx => {
      if (personId) {
        // Dispatch holds person and membership row locks and rechecks consent before sending.
        // The identity lock keeps a phone move from racing the opt-out without waiting for dispatch.
        await lockPersonPhone(tx, personId);
        const [owner] = await tx`select id from platform.people where id=${personId}::uuid and deleted_at is null`;
        if (!owner) return { ok: false };
      } else await lockPhoneBinding(tx, e164);
      const [phone] = await tx<{ person_id: string; hold: PhoneHold | null; verified_at: Date }[]>`select person_id, hold, verified_at
        from platform.phone_identities where e164=${e164}`;
      if (!appLeaveBindingCurrent(personId ?? "", phone?.person_id ?? "", phone?.hold != null, phone?.verified_at.getTime() ?? 0, at)) return { ok: false };
      const [row] = personId ? await tx`select * from platform.memberships where person_id=${personId}::uuid and app_id=${app}` : [];
      const current = row && membership(row);
      if (!appLeaveMemberCurrent(expectedMemberId ?? "", current?.memberId ?? "", current?.joinedAt ?? 0, at)) return { ok: false };
      await this.insertConsent({ app, e164, at, line, ref, state: "opted_out", source: "leave" }, tx);
      return { ok: true, membership: current };
    });
  }
  async lastConsent(e164: string, app: AppId): Promise<ConsentLast> {
    const rows = await this.sql`
      (select * from platform.consent_events where e164 = ${e164} and app_id = ${app} order by at desc, id desc limit 1)
      union all
      (select * from platform.consent_events where e164 = ${e164} and app_id is null order by at desc, id desc limit 1)`;
    const out: ConsentLast = {};
    for (const r of rows) r.app_id === null ? (out.global = consent(r)) : (out.app = consent(r));
    return out;
  }
  async consentEvents(e164: string, app: AppId) {
    return (await this.sql`select * from platform.consent_events where e164 = ${e164} and app_id = ${app} order by at, id`).map(consent);
  }

  async putShareGrant(g: ShareGrant) {
    await this.sql`insert into platform.share_grants (person_id, from_app, to_app, fields, granted_at, revoked_at)
      values (${g.personId}, ${g.fromApp}, ${g.toApp}, ${this.sql.array(g.fields, "TEXT")}, ${ts(g.grantedAt)}, ${ts(g.revokedAt)})
      on conflict (person_id, from_app, to_app) do update set fields = excluded.fields, granted_at = excluded.granted_at, revoked_at = excluded.revoked_at`;
  }
  async shareGrants(personId: string) {
    return (await this.sql`select * from platform.share_grants where person_id = ${personId}`).map((r: Row): ShareGrant => ({
      personId: r.person_id, fromApp: r.from_app, toApp: r.to_app, fields: r.fields, grantedAt: ms(r.granted_at)!, revokedAt: ms(r.revoked_at),
    }));
  }

  async block(from: string, to: string, originApp: AppId, at: number) {
    await this.sql`insert into platform.person_blocks (from_person, to_person, origin_app, at) values (${from}, ${to}, ${originApp}, ${ts(at)}) on conflict do nothing`;
  }
  async isBlocked(a: string, b: string) {
    const [r] = await this.sql`select exists (select 1 from platform.person_blocks where (from_person = ${a} and to_person = ${b}) or (from_person = ${b} and to_person = ${a})) as x`;
    return !!r?.x;
  }

  async ban(b: Ban, options?: { deduplicateScope?: boolean }) {
    // spec/safetyCase.md, "A ban allows only carrier commands and app leave"
    await this.sql.begin(async tx => {
      // The same key as Accounts.share's withLock: a share in flight finishes first or sees the ban.
      if (b.personId) {
        await tx`select pg_advisory_xact_lock(hashtext(${`platform:profile-share:${b.personId}`}))`;
        await lockPersonPhone(tx, b.personId);
      }
      if (options?.deduplicateScope && b.personId && (await this.staffBans(b.personId, b.scope, b.phoneHash ? [b.phoneHash] : [], tx)).length) return;
      const [owner] = b.personId ? await tx<{ phone_hash: string | null }[]>`select phone_hash from platform.people
        where id=${b.personId}::uuid and deleted_at is null` : [];
      const currentHash = owner?.phone_hash ?? "";
      const rows = includeLockedBanPhone(b.phoneHash ?? "", currentHash)
        ? [b, { ...b, id: `${b.id}:moved`, phoneHash: currentHash }] : [b];
      for (const row of rows) await tx`insert into platform.bans (id, scope, person_id, phone_hash, reason, report_id, banned_by, at)
        values (${row.id}, ${row.scope}, ${row.personId}, ${row.phoneHash}, ${row.reason}, ${row.reportId}, ${row.bannedBy}, ${ts(row.at)}) on conflict (id) do nothing`;
      for (const hash of new Set([b.phoneHash, currentHash])) if (hash) await barTeenPoolIn(tx, hash, "ban", b.at);
      if (b.personId) await tx`update platform.share_grants set revoked_at = ${ts(b.at)} where person_id = ${b.personId} and revoked_at is null`;
      await tx`delete from platform.pending_texts where phone_hash = ${b.phoneHash}
        or phone_hash in (select phone_hash from platform.people where id = ${b.personId}::uuid and phone_hash is not null)`;
    });
  }
  async staffBans(personId: string, scope: Ban["scope"], phoneHashes: readonly string[], db = this.sql): Promise<StaffBanProjection[]> {
    const filter = scope === "person" ? db`scope='person' and person_id=${personId}::uuid` : db`phone_hash=any(${phoneHashes}::text[])`;
    // Either recorded phone can identify the same interrupted staff decision.
    const rows = await db`with decisions as (select regexp_replace(id, ':moved$', '') as id from platform.bans where ${filter})
      select id,scope,person_id,phone_hash,reason,report_id,banned_by,at,projection_completed_at from platform.bans
      where id in (select id from decisions union all select id || ':moved' from decisions) order by at,id`;
    return rows.map(r => ({ id: r.id, scope: r.scope, personId: r.person_id, phoneHash: r.phone_hash, reason: r.reason,
      reportId: r.report_id, bannedBy: r.banned_by, at: ms(r.at)!, projectedAt: ms(r.projection_completed_at) }));
  }
  async completeStaffBans(ids: readonly string[], at: number): Promise<void> {
    if (ids.length) await this.sql`update platform.bans set projection_completed_at=${ts(at)}
      where id=any(${ids}::text[]) and projection_completed_at is null`;
  }
  async isBanned(phoneHash: string, personId?: string | null, db = this.sql) {
    const [r] = await db`select 1 from platform.bans where phone_hash = ${phoneHash} or (scope = 'person' and ${personId ?? null}::uuid is not null and person_id = ${personId ?? null}::uuid) limit 1`;
    return !!r;
  }
  async phoneHashesOf(personId: string) {
    // The person's keyed phone hash (people.phone_hash, set at createPerson). One verified phone per person today.
    const rows = await this.sql`select phone_hash from platform.people where id = ${personId}::uuid and phone_hash is not null`;
    return (rows as Row[]).map(r => r.phone_hash as string);
  }

  async suppress(phoneHash: string, reason: string, at: number) {
    await this.sql`insert into platform.suppression (phone_hash, reason, at) values (${phoneHash}, ${reason}, ${ts(at)}) on conflict do nothing`;
  }
  async isSuppressed(phoneHash: string) {
    const [r] = await this.sql`select 1 from platform.suppression where phone_hash = ${phoneHash}`;
    return !!r;
  }

  async unsuppress(phoneHash: string) {
    await this.sql`delete from platform.suppression where phone_hash = ${phoneHash}`;
  }

  async putChallenge(c: Omit<OtpChallenge, "id">) {
    const [r] = await this.sql`insert into platform.otp_challenges (app_id, e164, provider, provider_ref, provider_chat_id, code_hash, attempts, created_at, expires_at, consumed_at)
      values (${c.app}, ${c.e164}, ${c.provider}, ${c.providerRef}, ${c.providerChatId ?? null}, ${c.codeHash}, ${c.attempts}, ${ts(c.createdAt)}, ${ts(c.expiresAt)}, ${ts(c.consumedAt)}) returning id`;
    return String(r!.id);
  }
  async latestChallenge(app: AppId, e164: string) {
    const [r] = await this.sql`select * from platform.otp_challenges where app_id = ${app} and e164 = ${e164} order by created_at desc, id desc limit 1`;
    return r ? challenge(r) : undefined;
  }
  async claimAttempt(id: string, max: number, at: number) {
    const r = await this.sql`update platform.otp_challenges set attempts = attempts + 1
      where id = ${id} and consumed_at is null and expires_at > ${ts(at)} and attempts < ${max} returning id`;
    return r.length > 0;
  }
  async consumeChallenge(id: string, at: number) {
    const r = await this.sql`update platform.otp_challenges set consumed_at = ${ts(at)} where id = ${id} and consumed_at is null returning id`;
    return r.length > 0;
  }

  async putSession(s: Session, db?: SQL) {
    if (db) return this.insertSession(s, db);
    if (s.personId !== null) return this.insertSession(s, this.sql);
    await this.sql.begin(async tx => {
      await lockPhoneBinding(tx, s.e164);
      const [phone] = await tx<{ person_id: string }[]>`select person_id from platform.phone_identities where e164 = ${s.e164}`;
      await this.insertSession(unboundSessionTakesNewPerson(phone !== undefined, true) && phone ? { ...s, personId: phone.person_id } : s, tx);
    });
  }
  private async insertSession(s: Session, db: SQL) {
    await db`insert into platform.sessions (token_hash, app_id, e164, person_id, created_at, started_at, expires_at, rotated_from, revoked_at)
      values (${s.tokenHash}, ${s.app}, ${s.e164}, ${s.personId}, ${ts(s.createdAt)}, ${ts(s.startedAt)}, ${ts(s.expiresAt)}, ${s.rotatedFrom}, ${ts(s.revokedAt)})`;
  }
  async getSession(tokenHash: string) {
    const [r] = await this.sql`select * from platform.sessions where token_hash = ${tokenHash}`;
    return r ? session(r) : undefined;
  }
  async revokeSession(tokenHash: string, at: number) {
    await this.sql`update platform.sessions set revoked_at = least(coalesce(revoked_at, ${ts(at)}), ${ts(at)}) where token_hash = ${tokenHash}`;
  }
  async rotateSession(tokenHash: string, e164: string, revokeAt: number, decide: (current: Session | undefined) => Session | undefined) {
    await this.sql.begin(async tx => {
      const [phone] = await tx<{ person_id: string }[]>`select person_id from platform.phone_identities where e164 = ${e164}`;
      if (phone) await lockPersonPhone(tx, phone.person_id);
      await lockPhoneBinding(tx, e164);
      const [r] = await tx`select * from platform.sessions where token_hash = ${tokenHash} and e164 = ${e164} for update`;
      const next = decide(r ? session(r) : undefined);
      if (!next) return;
      await tx`update platform.sessions set revoked_at = least(coalesce(revoked_at, ${ts(revokeAt)}), ${ts(revokeAt)}) where token_hash = ${tokenHash}`;
      await this.putSession(next, tx);
    });
  }
  async attachPerson(e164: string, personId: string, joiningSession: string | null, at: number) {
    await attachPersonIn(this.sql, e164, personId, joiningSession, at);
  }
  async endUnboundAccess(e164: string, phoneHash: string, at: number) {
    await this.sql.begin(async tx => {
      await lockPhoneBinding(tx, e164);
      await tx`update platform.sessions set revoked_at = least(coalesce(revoked_at, ${ts(at)}), ${ts(at)}) where e164 = ${e164} and person_id is null`;
      await tx`delete from platform.pending_texts where phone_hash = ${phoneHash}`;
    });
  }
  async forgetPersonlessSessions(e164: string) {
    await this.sql`delete from platform.sessions where e164 = ${e164} and person_id is null`;
  }

  async hit(bucket: string, windowMs: number, at: number, rule: HitRule = {}): Promise<HitResult> {
    const start = new Date(at - (at % windowMs));
    return this.sql.begin(async tx => {
      // One writer per bucket at a time: parallel requests see each other's hits (one SMS for 20 parallel starts).
      await tx`select pg_advisory_xact_lock(hashtext(${`rate:${bucket}`}))`;
      const [prev] = await tx`select max(last_at) as last_at, coalesce(sum(count) filter (where window_start = ${start}), 0)::int as n from platform.rate_limits where bucket = ${bucket}`;
      const prevAt = ms(prev?.last_at), n = (prev?.n as number) ?? 0;
      if ((rule.limit !== undefined && n >= rule.limit) || (rule.minGapMs !== undefined && prevAt !== null && at - prevAt < rule.minGapMs)) return { count: n + 1, prevAt, ok: false };
      const [r] = await tx`insert into platform.rate_limits (bucket, window_start, count, last_at) values (${bucket}, ${start}, 1, ${ts(at)})
        on conflict (bucket, window_start) do update set count = platform.rate_limits.count + 1, last_at = excluded.last_at returning count`;
      // Old windows are not needed after the next one starts.
      await tx`delete from platform.rate_limits where bucket = ${bucket} and window_start < ${new Date(start.getTime() - windowMs)}`;
      return { count: r!.count as number, prevAt, ok: true };
    });
  }

  async hitAll<T>(buckets: readonly RateBucket[], at: number, decide: (seen: RateBucketRead[]) => { count: boolean; value: T }): Promise<T> {
    return this.sql.begin(async tx => {
      for (const key of [...new Set(buckets.map(b => b.key))].sort()) await tx`select pg_advisory_xact_lock(hashtext(${`rate:${key}`}))`;
      const seen: RateBucketRead[] = [];
      for (const b of buckets) {
        const [r] = await tx`select max(last_at) as last_at, coalesce(sum(count) filter (where window_start = ${new Date(at - (at % b.windowMs))}), 0)::int as n from platform.rate_limits where bucket = ${b.key}`;
        seen.push({ used: (r?.n as number) ?? 0, prevAt: ms(r?.last_at) });
      }
      const d = decide(seen);
      if (d.count) for (const b of buckets) {
        const start = new Date(at - (at % b.windowMs));
        await tx`insert into platform.rate_limits (bucket, window_start, count, last_at) values (${b.key}, ${start}, 1, ${ts(at)})
          on conflict (bucket, window_start) do update set count = platform.rate_limits.count + 1, last_at = excluded.last_at`;
        await tx`delete from platform.rate_limits where bucket = ${b.key} and window_start < ${new Date(start.getTime() - b.windowMs)}`;
      }
      return d.value;
    });
  }

  /**
   * One holder at a time in this process (so a waiter never holds a pooled connection that the holder
   * needs), and a session advisory lock on `key` across processes.
   */
  private lockTail: Promise<unknown> = Promise.resolve();
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const run = this.lockTail.then(() => this.advisory(key, fn), () => this.advisory(key, fn));
    this.lockTail = run.catch(() => {});
    return run;
  }
  private async advisory<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const conn = await this.sql.reserve();
    try {
      await conn`select pg_advisory_lock(hashtext(${`platform:${key}`}))`;
      try { return await fn(); } finally { await conn`select pg_advisory_unlock(hashtext(${`platform:${key}`}))`; }
    } finally { conn.release(); }
  }

  async getPending(phoneHash: string, kind: PendingKind, app?: AppId) {
    const [r] = app
      ? await this.sql`select * from platform.pending_texts where phone_hash = ${phoneHash} and kind = ${kind} and app_id = ${app} order by at desc limit 1`
      : await this.sql`select * from platform.pending_texts where phone_hash = ${phoneHash} and kind = ${kind} order by at desc limit 1`;
    return r ? pendingRow(r) : undefined;
  }
  async putPending(p: PendingText) {
    await this.sql.begin(async tx => {
      if (p.kind !== "share") await tx`delete from platform.pending_texts where phone_hash = ${p.phoneHash} and kind = ${p.kind}`;
      await tx`insert into platform.pending_texts (phone_hash, kind, app_id, name, age, birth_date, home_city, at)
        values (${p.phoneHash}, ${p.kind}, ${p.app}, ${p.name}, ${p.age}, ${p.birthDate ?? null}, ${p.homeCity ?? null}, ${ts(p.at)})
        on conflict (phone_hash, kind, app_id) do update set name = excluded.name, age = excluded.age, birth_date = excluded.birth_date,
          home_city = excluded.home_city, at = excluded.at`;
    });
  }
  async deletePending(phoneHash: string, kind?: PendingKind, app?: AppId) {
    await this.sql`delete from platform.pending_texts where phone_hash = ${phoneHash} and (${kind ?? null}::text is null or kind = ${kind ?? null}) and (${app ?? null}::text is null or app_id = ${app ?? null})`;
  }

  async purge(before: number) {
    const b = ts(before);
    return this.sql.begin(async tx => {
      let n = 0;
      n += (await tx`delete from platform.otp_challenges where expires_at < ${b} returning 1`).length;
      n += (await tx`delete from platform.sessions where expires_at < ${b} or revoked_at < ${b} returning 1`).length;
      const long = Object.keys(LONG_RATE_WINDOWS);
      const ordinaryRateCutoff = ts(rateCounterCutoff(before, 0));
      n += (await tx`delete from platform.rate_limits where last_at < ${ordinaryRateCutoff} and not (split_part(bucket, ':', 1) = any(${this.sql.array(long, "TEXT")})) returning 1`).length;
      for (const kind of long) {
        const cutoff = ts(rateCounterCutoff(before, LONG_RATE_WINDOWS[kind]!));
        n += (await tx`delete from platform.rate_limits where split_part(bucket, ':', 1) = ${kind} and last_at < ${cutoff} returning 1`).length;
      }
      n += (await tx`delete from platform.pending_texts where at < ${b} returning 1`).length;
      n += (await tx`delete from platform.phone_changes where confirmed_at is null and requested_at < ${b} returning 1`).length;
      return n;
    });
  }

  async forgetMembership(personId: string, app: AppId, at: number, expectedMemberId?: string) {
    await this.sql.begin(async tx => {
      await tx`select id from platform.people where id = ${personId} for update`;
      const removed = await tx`update platform.memberships set state = 'removed', review = null, first_name = null, profile = '{}'::jsonb, left_at = ${ts(at)}
        where person_id = ${personId} and app_id = ${app} ${expectedMemberId === undefined ? tx`` : tx`and member_id = ${expectedMemberId}`} returning member_id`;
      if (expectedMemberId !== undefined && removed.length === 0) return;
      await tx`update platform.share_grants set revoked_at = ${ts(at)} where person_id = ${personId} and (from_app = ${app} or to_app = ${app}) and revoked_at is null`;
      await tx`select set_config('app.app_id', ${app}, true)`;
      await tx`select notify.forget_data(${personId}, ${app})`;
    });
  }

  async deleteAll(personId: string | null, e164: string, phoneHash: string, at: number, releaseHeldPhone = false) {
    return this.sql.begin(async tx => {
      if (personId) await lockPersonPhone(tx, personId);
      else await lockPhoneBinding(tx, e164);
      const [owner] = personId ? await tx<Row[]>`select * from platform.people where id = ${personId}::uuid and deleted_at is null for update` : [];
      if (personId && !owner) return false;
      const [binding] = personId
        ? await tx<{ e164: string; hold: PhoneHold | null }[]>`select e164, hold from platform.phone_identities
            where person_id = ${personId}::uuid order by verified_at desc, e164 limit 1 for update`
        : await tx<{ e164: string; hold: PhoneHold | null }[]>`select e164, hold from platform.phone_identities where e164 = ${e164} for update`;
      const exactHeld = binding?.e164 === e164 && binding.hold !== null;
      if ((!owner || releaseHeldPhone) && !phoneErasureAllowed(!!owner, !!binding, releaseHeldPhone, exactHeld)) return false;
      const target = binding?.e164 ?? (owner ? null : e164);
      const hash = owner?.phone_hash ?? (target === e164 ? phoneHash : null);
      if (target && hash) {
        if (releaseHeldPhone) {
          await tx`delete from platform.suppression where phone_hash = ${hash}`;
          await tx`delete from platform.age_floor where phone_hash = ${hash}`;
        } else {
          await tx`insert into platform.suppression (phone_hash, reason, at) values (${hash}, 'deleted', ${ts(at)}) on conflict do nothing`;
          await lockAgeFloor(tx, hash);
          const [floorRow] = await tx`select * from platform.age_floor where phone_hash = ${hash}`;
          const before = floorRow ? ageFloorOf(floorRow) : undefined;
          const erased = owner ? floorAfterErasure({ person: person(owner), floor: before, signup: await readSignupAge(tx, personId!) }, at) : undefined;
          if (hasAgeToPreserve(!!owner, erased !== undefined) && erased) await putAgeFloor(tx, hash, erased);
        }
        await tx`update platform.inbound set status = 'unresolved', response = null, replies = '[]'::jsonb, action_receipts = '{}'::jsonb,
          receipt = null, receipt_hash = null, sender = null, event = null, sender_hash = null, member_id = null, app_id = null
          where request_hash is not null and sender_hash = ${hash}`;
        await tx`delete from platform.pending_texts where phone_hash = ${hash}`;
        await tx`delete from platform.teen_pool_holds where phone_hash = ${hash}`;
        await tx`delete from platform.teen_pair_avoid where phone_hash_a = ${hash} or phone_hash_b = ${hash}`;
      }
      const [seen] = releaseHeldPhone && target ? await tx`select last_seen_at from platform.phone_identities where e164 = ${target}` : [];
      const keepAfter = (seen?.last_seen_at as Date | null | undefined) ?? null;
      await tx`delete from platform.sessions where e164 = ${target} or (${personId}::uuid is not null and person_id = ${personId}::uuid)`;
      if (target) {
        await tx`delete from platform.otp_challenges where e164 = ${target}`;
        await tx`delete from platform.consent_events where e164 = ${target} and (${keepAfter}::timestamptz is null or at <= ${keepAfter})`;
        // The line's conversation counters hold the number in plain form (retention keeps unanswered rows).
        // A new owner's counters are theirs: their own text resets them.
        if (!releaseHeldPhone) await tx`delete from platform.line_conversations where address = ${target}`;
      }
      if (personId) {
        await tx`delete from platform.memberships where person_id = ${personId}`;
        await tx`delete from platform.signup_eligibility where person_id = ${personId}::uuid`;
        if (!erasureKeepsStaffHold(releaseHeldPhone)) await tx`delete from platform.staff_safety_holds where person_id = ${personId}::uuid`;
        await tx`delete from platform.report_safety_carryovers where person_id = ${personId}::uuid`;
        await tx`delete from platform.share_grants where person_id = ${personId}`;
        // Blocks stay (a safety fact): the tombstone keeps them, and a new join by this phone revives it.
        await tx`delete from platform.phone_identities where person_id = ${personId}`;
        await tx`update platform.people set lowest_age = null, age_verified_at = null, deleted_at = ${ts(at)},
          birth_date = null, birth_lower = null, birth_upper = null, birth_youngest = null, birth_first_exact = null,
          phone_hash = case when ${releaseHeldPhone} then null else phone_hash end where id = ${personId}`;
        await tx`select notify.forget_data(${personId}, null)`;
        await tx`delete from platform.phone_changes where person_id = ${personId}::uuid`;
      }
      return true;
    });
  }

  async putPhoneChange(c: PhoneChange) {
    await this.sql.begin(async tx => {
      // One waiting change per person: a newer request replaces the older one.
      await tx`select id from platform.people where id=${c.personId}::uuid for update`;
      await tx`delete from platform.phone_changes where person_id = ${c.personId}::uuid and confirmed_at is null and id <> ${c.id}::uuid`;
      await tx`insert into platform.phone_changes (id, person_id, app_id, new_e164, requested_by, requested_at, confirmed_at, old_hash, new_hash)
        values (${c.id}, ${c.personId}, ${c.app}, ${c.newE164}, ${c.requestedBy}, ${ts(c.requestedAt)}, ${ts(c.confirmedAt)}, ${c.oldHash ?? null}, ${c.newHash ?? null})
        on conflict (id) do update set new_e164 = excluded.new_e164, confirmed_at = excluded.confirmed_at, old_hash = excluded.old_hash, new_hash = excluded.new_hash`;
    });
  }
  async pendingPhoneChange(personId: string) {
    const [r] = await this.sql`select * from platform.phone_changes where person_id = ${personId}::uuid and confirmed_at is null order by requested_at desc limit 1`;
    return r ? phoneChange(r) : undefined;
  }
  async movePhone(m: PhoneMove): Promise<PhoneMoveResult> {
    return this.sql.begin(async tx => {
      await lockPhoneBinding(tx, m.newE164);
      await lockPersonPhone(tx, m.personId);
      const [person] = await tx`select id from platform.people where id=${m.personId}::uuid and deleted_at is null for update`;
      if (!person) return "no_phone";
      const [old] = await tx`select hold from platform.phone_identities where e164 = ${m.oldE164} and person_id = ${m.personId}::uuid for update`;
      if (!old || old.hold !== null) return "no_phone";
      const [pending] = await tx<{ requested_at: Date }[]>`select requested_at from platform.phone_changes
        where id=${m.changeId}::uuid and person_id=${m.personId}::uuid and new_e164=${m.newE164} and confirmed_at is null for update`;
      const at = m.now();
      if (!pending || !pendingWindowOpen(at - pending.requested_at.getTime())) return "stale_request";
      if (!lockedPhoneMoveAllowed(await this.isBanned(m.oldHash, m.personId, tx), await this.isBanned(m.newHash, null, tx))) return "banned";
      // The new number is checked again inside the transaction (a join or another change may have taken it).
      const [taken] = await tx`select 1 from platform.phone_identities where e164 = ${m.newE164}`;
      if (taken) return "number_in_use";
      await tx`insert into platform.phone_identities (e164, person_id, verified_at, method, last_seen_at) values (${m.newE164}, ${m.personId}::uuid, ${ts(at)}, 'otp_sms', ${ts(at)})`;
      await tx`delete from platform.phone_identities where e164 = ${m.oldE164}`;
      await attachPersonIn(tx, m.newE164, m.personId, null, at);
      // The ledger is never updated in place: its rows are copied to the new number, then the old number's rows go.
      await tx`insert into platform.consent_events (e164, app_id, line, state, source, wording, wording_version, ref, named_app, at)
        select ${m.newE164}, app_id, line, state, source, wording, wording_version, ref, named_app, at from platform.consent_events where e164 = ${m.oldE164} order by at, id
        on conflict (e164, ref) where ref is not null do nothing`;
      await tx`delete from platform.consent_events where e164 = ${m.oldE164}`;
      await tx`update platform.people set phone_hash = ${m.newHash} where id = ${m.personId}::uuid`;
      for (const hash of [m.oldHash, m.newHash].sort()) await lockAgeFloor(tx, hash);
      const [floor] = await tx`delete from platform.age_floor where phone_hash = ${m.oldHash} returning *`;
      if (floor) {
        const [existing] = await tx`select * from platform.age_floor where phone_hash = ${m.newHash}`;
        await putAgeFloor(tx, m.newHash, mergedFloors(ageFloorOf(floor), existing ? ageFloorOf(existing) : undefined));
      }
      await tx`insert into platform.teen_pool_bars (phone_hash, reason, at) select ${m.newHash}, reason, at from platform.teen_pool_bars
        where phone_hash = ${m.oldHash} on conflict (phone_hash) do nothing`;
      await tx`insert into platform.teen_pair_avoid (phone_hash_a, phone_hash_b, at)
        select least(${m.newHash}::text, o.other), greatest(${m.newHash}::text, o.other), o.at from (
          select case when phone_hash_a = ${m.oldHash} then phone_hash_b else phone_hash_a end as other, at
          from platform.teen_pair_avoid where phone_hash_a = ${m.oldHash} or phone_hash_b = ${m.oldHash}) o
        where o.other <> ${m.newHash}
        on conflict (phone_hash_a, phone_hash_b) do nothing`;
      await tx`delete from platform.teen_pair_avoid where phone_hash_a = ${m.oldHash} or phone_hash_b = ${m.oldHash}`;
      const moved = movedPersonAge(await readAgeStanding(tx, m.personId, m.newHash, false), at);
      if (moved) {
        await putPersonAge(tx, m.personId, moved.person);
        if (moved.bar) await barTeenPoolIn(tx, m.newHash, "conflict", at);
      }
      await tx`delete from platform.sessions where e164 = ${m.oldE164}`;
      await tx`delete from platform.otp_challenges where e164 = ${m.oldE164}`;
      await tx`delete from platform.pending_texts where phone_hash = ${m.oldHash}`;
      // Messages still waiting for the old number never go there: it may belong to someone else next.
      await tx`update platform.outbound set status = 'suppressed_ineligible', note = 'number changed', to_address = null, ended_at = ${ts(at)}, updated_at = ${ts(at)},
          lease_owner = null, lease_until = null
        where to_address = ${m.oldE164} and status = any(${OUTBOUND_WAITING}::text[])`;
      const oldNoticeHash = m.oldNoticeHash ?? m.oldHash, newNoticeHash = m.newNoticeHash ?? m.newHash;
      await tx`insert into platform.eliza_notices (phone_hash, sent_at) select ${newNoticeHash}, sent_at from platform.eliza_notices where phone_hash = ${oldNoticeHash} on conflict do nothing`;
      await tx`delete from platform.eliza_notices where phone_hash = ${oldNoticeHash}`;
      await this.movePhoneGrants(tx, m, new Date(at));
      await tx`delete from platform.suppression where phone_hash = ${m.newHash}`;
      await tx`update platform.phone_changes set confirmed_at = ${ts(at)}, new_e164 = null, old_hash = ${m.oldHash}, new_hash = ${m.newHash}
        where id = ${m.changeId}::uuid`;
      return "ok";
    });
  }

  private async movePhoneGrants(tx: SQL, move: PhoneMove, at: Date): Promise<void> {
    const [oauth] = await tx`select case when to_regclass('oauth.grants') is null then false
      else has_schema_privilege('oauth', 'USAGE') and has_table_privilege(to_regclass('oauth.grants'), 'UPDATE') end as ok,
      to_regclass('oauth.signup_drafts') is not null as has_drafts`;
    if (!oauth?.ok) return;
    // Cloud's grant trigger forbids moving its sealed phone authority. Unbound grants also cannot prove this person owns the grant.
    const cloudBound = tx`(id like 'grant_cloud_%' or cloud_authority is not null)`;
    await tx`with ended as (
        update oauth.grants set revoked_at=${at}
        where phone_key=${move.oldHash} and revoked_at is null and expires_at>${at}
          and (${cloudBound} or person_id is distinct from ${move.personId})
        returning id,client_id,app_id
      ), tokens as (
        update oauth.tokens set revoked_at=${at} where grant_id in (select id from ended) and revoked_at is null
      ) insert into oauth.audit (at,kind,client_id,grant_id,app_id,detail)
        select ${at},'consent_revoked',client_id,id,app_id,'phone changed' from ended`;
    await tx`update oauth.grants set phone_key=${move.newHash}
        where person_id=${move.personId} and phone_key=${move.oldHash} and revoked_at is null and expires_at>${at} and not ${cloudBound}`;
    if (oauth.has_drafts) await tx`delete from oauth.signup_drafts where phone_key=${move.oldHash}`;
  }
}
