// The privacy replay of a restore (docs/runbook-privacy.md section 3): carry the erasures, STOPs, leaves and bans
// that the source database recorded after the backup into the restored database, before the backend serves it.
// spec/databaseRestore.md, "Story: Carry privacy changes made after the backup into the restored database"
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { replaysErasure, replaysLeave, replaysSourceRow, replaysStop } from "../../packages/core/src/generated/databaseRestore.ts";
import { resolveConsent, type ConsentState } from "../../packages/platform/src/consent.ts";

export interface PrivacyReplayResult { consentEvents: number; bans: number; suppressions: number; erasures: number; leaves: number; stops: number }

type Row = Record<string, unknown>;
interface MembershipRow { person_id: string; app_id: string; member_id: string; state: string }

/** Copy the rows of `table` whose `key` the restored database lacks, every column as the source has it. */
async function copyMissing(source: SQL, target: SQL, table: "consent_events" | "bans" | "suppression", key: "id" | "phone_hash",
  adjust: (row: Row) => Row = row => row, keep: (row: Row) => boolean = () => true): Promise<Row[]> {
  const have = new Set((await target.unsafe(`select ${key}::text as k from platform.${table}`) as { k: string }[]).map(r => r.k));
  const rows = (await source.unsafe(`select to_jsonb(t) as row from platform.${table} t order by ${key}`) as { row: Row }[])
    // spec/databaseRestore.md, "A source row that the restored database lacks is replayed"
    .map(r => r.row).filter(row => replaysSourceRow(have.has(String(row[key])))).map(adjust).filter(keep);
  if (rows.length) await target.unsafe(`insert into platform.${table} select * from jsonb_populate_recordset(null::platform.${table}, $1::jsonb)`, [rows as never]);
  return rows;
}

/**
 * Read the source database and write the restored one in one transaction. Consent events, bans and suppressions
 * are copied at once (the send path, joins and sign-in read them); a copied ban also removes the number's queued
 * texts and revokes the person's live shares, as the live ban write does. Erasures, leaves, STOPs and the
 * projection of a copied ban are queued in platform.privacy_replay, which the backend runs when it starts.
 */
export async function replayPrivacy(o: { sourceUrl: string; targetUrl: string; queuedAt: Date }): Promise<PrivacyReplayResult> {
  const source = new SQL({ url: o.sourceUrl, max: 1, connection: { application_name: "network-restore-replay" } });
  const target = new SQL({ url: o.targetUrl, max: 1, connection: { application_name: "network-restore-replay" } });
  try {
    return await source.begin(async src => {
      await src`set transaction isolation level repeatable read, read only`;
      return target.begin(async tx => {
        const consent = await copyMissing(src, tx, "consent_events", "id");
        if (consent.length) await tx`select setval(pg_get_serial_sequence('platform.consent_events', 'id'), (select max(id) from platform.consent_events))`;
        // A copied ban has no projection receipt here: the replay route resumes its projection. A person who
        // joined after the backup is not in this database: the ban keeps its phone hash, which refuses that number.
        const banPeople = (await src`select distinct person_id::text as id from platform.bans where person_id is not null` as { id: string }[]).map(r => r.id);
        const known = new Set((await tx`select id::text from platform.people where id = any(${banPeople}::uuid[])` as { id: string }[]).map(r => r.id));
        const bans = await copyMissing(src, tx, "bans", "id", row => ({ ...row, projection_completed_at: null,
          person_id: typeof row.person_id === "string" && known.has(row.person_id) ? row.person_id : null }), row => row.person_id !== null || row.phone_hash !== null);
        for (const ban of bans) {
          if (typeof ban.person_id === "string") await tx`update platform.share_grants set revoked_at = ${new Date(String(ban.at))}
            where person_id = ${ban.person_id}::uuid and revoked_at is null`;
          await tx`delete from platform.pending_texts where phone_hash = ${typeof ban.phone_hash === "string" ? ban.phone_hash : null}
            or phone_hash in (select phone_hash from platform.people where id = ${typeof ban.person_id === "string" ? ban.person_id : null}::uuid and phone_hash is not null)`;
        }
        const suppressions = await copyMissing(src, tx, "suppression", "phone_hash");

        const erasedInSource = (await src`select id::text from platform.people where deleted_at is not null` as { id: string }[]).map(r => r.id);
        const liveHere = new Set((await tx`select id::text from platform.people where deleted_at is null and id = any(${erasedInSource}::uuid[])` as { id: string }[]).map(r => r.id));
        // spec/databaseRestore.md, "An erasure after the backup is replayed"
        const erase = erasedInSource.filter(id => replaysErasure(true, !liveHere.has(id)));

        const live = await tx<MembershipRow[]>`select person_id::text, app_id, member_id, state from platform.memberships where state <> 'removed'`;
        const before = await src<MembershipRow[]>`select person_id::text, app_id, member_id, state from platform.memberships
          where person_id = any(${[...new Set(live.map(m => m.person_id))]}::uuid[])`;
        const sourceOf = new Map(before.map(m => [`${m.person_id}/${m.app_id}`, m]));
        // spec/databaseRestore.md, "A leave after the backup is replayed"
        const leave = live.filter(m => {
          const was = sourceOf.get(`${m.person_id}/${m.app_id}`);
          return replaysLeave(true, !!was, was?.state !== "removed", was?.member_id === m.member_id);
        });

        // spec/databaseRestore.md, "A STOP after the backup is replayed on each membership it still covers"
        const stop: MembershipRow[] = [];
        for (const e164 of new Set(consent.filter(e => e.state === "opted_out").map(e => String(e.e164)))) {
          const scopes = new Set(consent.filter(e => e.state === "opted_out" && e.e164 === e164).map(e => (e.app_id ?? null) as string | null));
          const members = await tx<MembershipRow[]>`select m.person_id::text, m.app_id, m.member_id, m.state from platform.phone_identities p
            join platform.people person on person.id = p.person_id and person.deleted_at is null
            join platform.memberships m on m.person_id = p.person_id where p.e164 = ${e164} order by m.app_id`;
          for (const m of members) {
            const last = await tx<{ app_id: string | null; state: ConsentState; at: Date }[]>`
              (select app_id, state, at from platform.consent_events where e164 = ${e164} and app_id = ${m.app_id} order by at desc, id desc limit 1)
              union all
              (select app_id, state, at from platform.consent_events where e164 = ${e164} and app_id is null order by at desc, id desc limit 1)`;
            const event = (r: { state: ConsentState; at: Date }) => ({ e164, app: null, state: r.state, source: "restore", at: new Date(r.at).getTime() });
            const app = last.find(r => r.app_id !== null), global = last.find(r => r.app_id === null);
            const stillOptedOut = resolveConsent({ ...(app ? { app: event(app) } : {}), ...(global ? { global: event(global) } : {}) }) === "opted_out";
            if (replaysStop(true, scopes.has(null) || scopes.has(m.app_id), m.state !== "removed" && m.state !== "invited", stillOptedOut)) stop.push(m);
          }
        }

        const banned = new Set<string>();
        for (const ban of bans) {
          if (typeof ban.person_id === "string") { banned.add(ban.person_id); continue; }
          for (const p of await tx`select id::text from platform.people where phone_hash = ${String(ban.phone_hash)} and deleted_at is null` as { id: string }[]) banned.add(p.id);
        }
        const queue = [
          ...erase.map(person => ({ kind: "erase", person_id: person, app_id: null, member_id: null })),
          ...leave.map(m => ({ kind: "leave", person_id: m.person_id, app_id: m.app_id, member_id: m.member_id })),
          ...stop.map(m => ({ kind: "stop", person_id: m.person_id, app_id: m.app_id, member_id: m.member_id })),
          ...[...banned].map(person => ({ kind: "ban", person_id: person, app_id: null, member_id: null })),
        ];
        for (const q of queue) await tx`insert into platform.privacy_replay (kind, person_id, app_id, member_id, queued_at)
          values (${q.kind}, ${q.person_id}::uuid, ${q.app_id}, ${q.member_id}, ${o.queuedAt}) on conflict do nothing`;
        return { consentEvents: consent.length, bans: bans.length, suppressions: suppressions.length, erasures: erase.length, leaves: leave.length, stops: stop.length };
      });
    });
  } finally {
    await Promise.all([source.close(), target.close()]);
  }
}
