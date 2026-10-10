// PeopleStore on Postgres (the platform schema, migration 0003). The login needs the
// platform_service role (or the owner). Run the migrations first (bun run db:migrate).
import { SQL } from "bun";
import type { AppId } from "./apps.ts";
import type { ConsentEvent, ConsentLast } from "./consent.ts";
import type { Ban, HitResult, HitRule, Membership, OtpChallenge, PendingKind, PendingText, PeopleStore, Person, PhoneChange, PhoneHold, PhoneIdentity, PhoneMethod, PhoneMove, PhoneMoveResult, Session, ShareGrant } from "./store.ts";

type Row = Record<string, any>;
const ms = (v: unknown): number | null => (v === null || v === undefined ? null : new Date(v as string | Date).getTime());
const ts = (v: number | null | undefined) => (v === null || v === undefined ? null : new Date(v));
const json = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : v) as T;

const person = (r: Row): Person => ({ id: r.id, lowestAge: r.lowest_age ?? null, createdAt: ms(r.created_at)!, deletedAt: ms(r.deleted_at) });
const phone = (r: Row): PhoneIdentity => ({ e164: r.e164, personId: r.person_id, verifiedAt: ms(r.verified_at)!, method: r.method, lastSeenAt: ms(r.last_seen_at), hold: r.hold ?? null });
const membership = (r: Row): Membership => ({
  app: r.app_id, personId: r.person_id, memberId: r.member_id, state: r.state, review: r.review ?? null, firstName: r.first_name ?? null,
  profile: json<Record<string, unknown>>(r.profile) ?? {}, joinedAt: ms(r.joined_at), leftAt: ms(r.left_at),
});
const consent = (r: Row): ConsentEvent => ({
  e164: r.e164, app: r.app_id ?? null, line: r.line ?? null, state: r.state, source: r.source, wording: r.wording ?? null,
  wordingVersion: r.wording_version ?? null, ref: r.ref ?? null, at: ms(r.at)!,
});
const pendingRow = (r: Row): PendingText => ({ phoneHash: r.phone_hash, kind: r.kind, app: r.app_id, name: r.name ?? null, age: r.age ?? null, at: ms(r.at)! });
const challenge = (r: Row): OtpChallenge => ({
  id: String(r.id), app: r.app_id, e164: r.e164, provider: r.provider, providerRef: r.provider_ref ?? null, codeHash: r.code_hash ?? null, attempts: r.attempts,
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
  async detachPhoneHash(personId: string) {
    await this.sql`update platform.people set phone_hash = null where id = ${personId}::uuid`;
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
  async createPerson(p: { id: string; e164: string; method: PhoneMethod; at: number; lowestAge: number | null; phoneHash?: string }) {
    return this.sql.begin(async tx => {
      // A tombstone with this phone's keyed hash: the same person again (blocks against them still hold).
      const [back] = p.phoneHash ? await tx`update platform.people set deleted_at = null, lowest_age = ${p.lowestAge}
        where id = (select id from platform.people where phone_hash = ${p.phoneHash} and deleted_at is not null order by deleted_at desc limit 1) returning *` : [];
      const [r] = back ? [back] : await tx`insert into platform.people (id, lowest_age, created_at, phone_hash) values (${p.id}, ${p.lowestAge}, ${ts(p.at)}, ${p.phoneHash ?? null}) returning *`;
      await tx`insert into platform.phone_identities (e164, person_id, verified_at, method, last_seen_at) values (${p.e164}, ${r!.id}, ${ts(p.at)}, ${p.method}, ${ts(p.at)})`;
      return person(r!);
    });
  }
  async touchPhone(e164: string, at: number) {
    await this.sql`update platform.phone_identities set last_seen_at = ${ts(at)} where e164 = ${e164}`;
  }
  async setPhoneHold(e164: string, hold: PhoneHold | null, at: number) {
    await this.sql`update platform.phone_identities set hold = ${hold}, hold_at = ${hold ? ts(at) : null} where e164 = ${e164}`;
  }
  async heldPhones() {
    return (await this.sql`select * from platform.phone_identities where hold is not null order by hold_at`).map(phone);
  }
  async ageFloor(phoneHash: string) {
    const [r] = await this.sql`select lowest_age from platform.age_floor where phone_hash = ${phoneHash}`;
    return r ? (r.lowest_age as number) : undefined;
  }
  async noteAgeFloor(phoneHash: string, age: number, at: number) {
    const [r] = await this.sql`insert into platform.age_floor (phone_hash, lowest_age, at) values (${phoneHash}, ${age}, ${ts(at)})
      on conflict (phone_hash) do update set lowest_age = least(platform.age_floor.lowest_age, excluded.lowest_age),
        at = case when excluded.lowest_age < platform.age_floor.lowest_age then excluded.at else platform.age_floor.at end
      returning lowest_age`;
    return r!.lowest_age as number;
  }
  async clearAgeFloor(phoneHash: string) {
    await this.sql`delete from platform.age_floor where phone_hash = ${phoneHash}`;
  }
  async noteAge(personId: string, age: number) {
    const [r] = await this.sql`update platform.people set lowest_age = least(coalesce(lowest_age, ${age}), ${age}) where id = ${personId} returning lowest_age`;
    if (!r) throw new Error("no person");
    return r.lowest_age as number;
  }

  async memberships(personId: string) {
    return (await this.sql`select * from platform.memberships where person_id = ${personId} order by app_id`).map(membership);
  }
  async getMembership(personId: string, app: AppId) {
    const [r] = await this.sql`select * from platform.memberships where person_id = ${personId} and app_id = ${app}`;
    return r ? membership(r) : undefined;
  }
  async putMembership(m: Membership) {
    await this.sql`insert into platform.memberships (app_id, person_id, member_id, state, review, first_name, profile, joined_at, left_at)
      values (${m.app}, ${m.personId}, ${m.memberId}, ${m.state}, ${m.review}, ${m.firstName}, ${m.profile}::jsonb, ${ts(m.joinedAt)}, ${ts(m.leftAt)})
      on conflict (app_id, person_id) do update set member_id = excluded.member_id, state = excluded.state, review = excluded.review,
        first_name = excluded.first_name, profile = excluded.profile, joined_at = excluded.joined_at, left_at = excluded.left_at`;
  }

  async addConsent(e: ConsentEvent) {
    const r = await this.sql`insert into platform.consent_events (e164, app_id, line, state, source, wording, wording_version, ref, at)
      values (${e.e164}, ${e.app}, ${e.line ?? null}, ${e.state}, ${e.source}, ${e.wording ?? null}, ${e.wordingVersion ?? null}, ${e.ref ?? null}, ${ts(e.at)})
      on conflict (e164, ref) where ref is not null do nothing returning id`;
    return r.length > 0;
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

  async ban(b: Ban) {
    await this.sql`insert into platform.bans (id, scope, person_id, phone_hash, reason, report_id, banned_by, at)
      values (${b.id}, ${b.scope}, ${b.personId}, ${b.phoneHash}, ${b.reason}, ${b.reportId}, ${b.bannedBy}, ${ts(b.at)}) on conflict (id) do nothing`;
  }
  async isBanned(phoneHash: string, personId?: string | null) {
    const [r] = await this.sql`select 1 from platform.bans where phone_hash = ${phoneHash} or (scope = 'person' and ${personId ?? null}::uuid is not null and person_id = ${personId ?? null}::uuid) limit 1`;
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
    const [r] = await this.sql`insert into platform.otp_challenges (app_id, e164, provider, provider_ref, code_hash, attempts, created_at, expires_at, consumed_at)
      values (${c.app}, ${c.e164}, ${c.provider}, ${c.providerRef}, ${c.codeHash}, ${c.attempts}, ${ts(c.createdAt)}, ${ts(c.expiresAt)}, ${ts(c.consumedAt)}) returning id`;
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

  async putSession(s: Session) {
    await this.sql`insert into platform.sessions (token_hash, app_id, e164, person_id, created_at, started_at, expires_at, rotated_from, revoked_at)
      values (${s.tokenHash}, ${s.app}, ${s.e164}, ${s.personId}, ${ts(s.createdAt)}, ${ts(s.startedAt)}, ${ts(s.expiresAt)}, ${s.rotatedFrom}, ${ts(s.revokedAt)})`;
  }
  async getSession(tokenHash: string) {
    const [r] = await this.sql`select * from platform.sessions where token_hash = ${tokenHash}`;
    return r ? session(r) : undefined;
  }
  async revokeSession(tokenHash: string, at: number) {
    await this.sql`update platform.sessions set revoked_at = least(coalesce(revoked_at, ${ts(at)}), ${ts(at)}) where token_hash = ${tokenHash}`;
  }
  async attachPerson(e164: string, personId: string) {
    await this.sql`update platform.sessions set person_id = ${personId} where e164 = ${e164} and person_id is null`;
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
      await tx`insert into platform.pending_texts (phone_hash, kind, app_id, name, age, at) values (${p.phoneHash}, ${p.kind}, ${p.app}, ${p.name}, ${p.age}, ${ts(p.at)})
        on conflict (phone_hash, kind, app_id) do update set name = excluded.name, age = excluded.age, at = excluded.at`;
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
      n += (await tx`delete from platform.rate_limits where last_at < ${b} returning 1`).length;
      n += (await tx`delete from platform.pending_texts where at < ${b} returning 1`).length;
      n += (await tx`delete from platform.phone_changes where confirmed_at is null and requested_at < ${b} returning 1`).length;
      return n;
    });
  }

  async forgetMembership(personId: string, app: AppId, at: number) {
    await this.sql.begin(async tx => {
      await tx`select id from platform.people where id = ${personId} for update`;
      await tx`update platform.memberships set state = 'removed', review = null, first_name = null, profile = '{}'::jsonb, left_at = ${ts(at)}
        where person_id = ${personId} and app_id = ${app}`;
      await tx`update platform.share_grants set revoked_at = ${ts(at)} where person_id = ${personId} and (from_app = ${app} or to_app = ${app}) and revoked_at is null`;
      await tx`select set_config('app.app_id', ${app}, true)`;
      await tx`select notify.forget_data(${personId}, ${app})`;
    });
  }

  async deleteAll(personId: string | null, e164: string, phoneHash: string, at: number) {
    await this.sql.begin(async tx => {
      if (personId) await tx`select id from platform.people where id = ${personId} for update`;
      await tx`insert into platform.suppression (phone_hash, reason, at) values (${phoneHash}, 'deleted', ${ts(at)}) on conflict do nothing`;
      await tx`update platform.inbound set status = 'unresolved', response = null, replies = '[]'::jsonb, action_receipts = '{}'::jsonb,
        receipt = null, receipt_hash = null, sender = null, event = null, sender_hash = null, member_id = null, app_id = null
        where request_hash is not null and sender_hash = ${phoneHash}`;
      await tx`delete from platform.sessions where e164 = ${e164} or (${personId}::uuid is not null and person_id = ${personId}::uuid)`;
      await tx`delete from platform.otp_challenges where e164 = ${e164}`;
      await tx`delete from platform.consent_events where e164 = ${e164}`;
      if (personId) {
        await tx`delete from platform.memberships where person_id = ${personId}`;
        await tx`delete from platform.share_grants where person_id = ${personId}`;
        // Blocks stay (a safety fact): the tombstone keeps them, and a new join by this phone revives it.
        await tx`delete from platform.phone_identities where person_id = ${personId}`;
        await tx`update platform.people set lowest_age = null, age_verified_at = null, deleted_at = ${ts(at)} where id = ${personId}`;
        await tx`select notify.forget_data(${personId}, null)`;
      }
      await tx`delete from platform.phone_identities where e164 = ${e164}`;
      await tx`delete from platform.pending_texts where phone_hash = ${phoneHash}`;
      if (personId) await tx`delete from platform.phone_changes where person_id = ${personId}::uuid`;
    });
  }

  async putPhoneChange(c: PhoneChange) {
    await this.sql.begin(async tx => {
      // One waiting change per person: a newer request replaces the older one.
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
      const [old] = await tx`select * from platform.phone_identities where e164 = ${m.oldE164} and person_id = ${m.personId}::uuid for update`;
      if (!old) return "no_phone";
      // The new number is checked again inside the transaction (a join or another change may have taken it).
      const [taken] = await tx`select 1 from platform.phone_identities where e164 = ${m.newE164}`;
      if (taken) return "number_in_use";
      await tx`insert into platform.phone_identities (e164, person_id, verified_at, method, last_seen_at) values (${m.newE164}, ${m.personId}::uuid, ${ts(m.at)}, 'otp_sms', ${ts(m.at)})`;
      await tx`delete from platform.phone_identities where e164 = ${m.oldE164}`;
      // The ledger is never updated in place: its rows are copied to the new number, then the old number's rows go.
      await tx`insert into platform.consent_events (e164, app_id, line, state, source, wording, wording_version, ref, at)
        select ${m.newE164}, app_id, line, state, source, wording, wording_version, ref, at from platform.consent_events where e164 = ${m.oldE164} order by at, id
        on conflict (e164, ref) where ref is not null do nothing`;
      await tx`delete from platform.consent_events where e164 = ${m.oldE164}`;
      await tx`update platform.people set phone_hash = ${m.newHash} where id = ${m.personId}::uuid`;
      const [floor] = await tx`delete from platform.age_floor where phone_hash = ${m.oldHash} returning lowest_age, at`;
      if (floor) {
        await tx`insert into platform.age_floor (phone_hash, lowest_age, at) values (${m.newHash}, ${floor.lowest_age}, ${floor.at})
          on conflict (phone_hash) do update set lowest_age = least(platform.age_floor.lowest_age, excluded.lowest_age)`;
      }
      await tx`delete from platform.sessions where e164 = ${m.oldE164}`;
      await tx`delete from platform.otp_challenges where e164 = ${m.oldE164}`;
      await tx`delete from platform.pending_texts where phone_hash = ${m.oldHash}`;
      // Messages still waiting for the old number never go there: it may belong to someone else next.
      await tx`update platform.outbound set status = 'suppressed_ineligible', note = 'number changed', to_address = null, ended_at = ${ts(m.at)}, updated_at = ${ts(m.at)},
          lease_owner = null, lease_until = null
        where to_address = ${m.oldE164} and status = any(${OUTBOUND_WAITING}::text[])`;
      await tx`insert into platform.eliza_notices (phone_hash, sent_at) select ${m.newHash}, sent_at from platform.eliza_notices where phone_hash = ${m.oldHash} on conflict do nothing`;
      await tx`delete from platform.eliza_notices where phone_hash = ${m.oldHash}`;
      // The person's linked agents (MCP OAuth grants) hold the keyed hash: they move with the number (PRD 11.5, F25).
      const [oauth] = await tx`select case when to_regclass('oauth.grants') is null then false
        else has_schema_privilege('oauth', 'USAGE') and has_table_privilege(to_regclass('oauth.grants'), 'UPDATE') end as ok`;
      if (oauth?.ok) await tx`update oauth.grants set phone_key = ${m.newHash} where phone_key = ${m.oldHash}`;
      const changed = await tx`update platform.phone_changes set confirmed_at = ${ts(m.at)}, new_e164 = null, old_hash = ${m.oldHash}, new_hash = ${m.newHash}
        where id = ${m.changeId}::uuid and person_id = ${m.personId}::uuid and confirmed_at is null returning id`;
      if (!changed.length) throw new Error("no waiting number change for this person");
      return "ok";
    });
  }
}
