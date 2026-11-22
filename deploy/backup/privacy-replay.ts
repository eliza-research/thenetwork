import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { replaysErasure, replaysLeave, replaysSourceRow, replaysStop, restoredText, type RestoredTextStatus } from "../../packages/core/src/generated/databaseRestore.ts";
import { GATEWAY_WAITING, WAITING } from "../../packages/blooio/src/outbound-queue.ts";
import { resolveConsent, type ConsentState } from "../../packages/platform/src/consent.ts";

export interface RestoredTextsResult { textsTaken: number; textsEnded: number }
export interface PrivacyReplayResult extends RestoredTextsResult { consentEvents: number; bans: number; suppressions: number; erasures: number; leaves: number; stops: number }

const SOURCE_TEXT_COLUMNS = ["status", "attempts", "next_attempt_at", "updated_at", "lease_owner", "lease_until", "in_doubt", "provider_message_id",
  "provider_message_ids", "chat_id", "transport", "new_conversation", "reengagement", "person_cap", "sent_at", "delivered_at", "read_at",
  "ended_at", "last_error", "note", "history_recorded", "to_address", "body", "leak_released_by"].join(", ");

const PARKED = ["parked_leak_review"];
const IN_DOUBT = [...GATEWAY_WAITING, "failed_unknown"];
const UNSETTLED = [...WAITING, ...PARKED, ...IN_DOUBT];

function restoredTextStatus(status: string): RestoredTextStatus {
  if (WAITING.includes(status)) return "WaitingText";
  if (PARKED.includes(status)) return "ParkedText";
  if (IN_DOUBT.includes(status)) return "InDoubtText";
  return "SettledText";
}

async function settleRestoredTexts(tx: SQL, src: SQL | undefined, at: Date): Promise<RestoredTextsResult> {
  const unsettled = await tx`select id, status from platform.outbound where status = any(${UNSETTLED}::text[]) order by id` as { id: string; status: string }[];
  const ids = unsettled.map(r => r.id);
  const source = new Map((src && ids.length
    ? await src`select id, to_jsonb(o)::text as row from platform.outbound o where id = any(${ids}::text[])` as { id: string; row: string }[]
    : []).map(r => [r.id, r.row] as const));
  const ended: string[] = [];
  let textsTaken = 0;
  for (const { id, status } of unsettled) {
    const row = source.get(id);
    switch (restoredText(restoredTextStatus(status), src !== undefined, row !== undefined)) {
      case "TakeSourceText":
        await tx.unsafe(`update platform.outbound t set (${SOURCE_TEXT_COLUMNS}) =
          (select ${SOURCE_TEXT_COLUMNS} from jsonb_populate_record(null::platform.outbound, $1::jsonb)) where t.id = $2`, [row!, id]);
        textsTaken++;
        break;
      case "EndRestoredText": ended.push(id); break;
      case "KeepRestoredText": break;
    }
  }
  if (ended.length) await tx`update platform.outbound set status = 'expired', ended_at = ${at}, updated_at = ${at}, next_attempt_at = ${at},
    lease_owner = null, lease_until = null, to_address = case when member_id is null then null else to_address end,
    body = case when member_id is null then null else body end, note = 'restore: not settled in the source' where id = any(${ended}::text[])`;
  return { textsTaken, textsEnded: ended.length };
}

export async function endRestoredTexts(o: { targetUrl: string; at: Date }): Promise<RestoredTextsResult> {
  const target = new SQL({ url: o.targetUrl, max: 1, connection: { application_name: "network-restore-texts" } });
  try { return await target.begin(tx => settleRestoredTexts(tx, undefined, o.at)); }
  finally { await target.close(); }
}

type Row = Record<string, unknown>;
interface MembershipRow { person_id: string; app_id: string; member_id: string; state: string }

async function copyMissing(source: SQL, target: SQL, table: "consent_events" | "bans" | "suppression", key: "id" | "phone_hash",
  adjust: (row: Row) => Row = row => row, keep: (row: Row) => boolean = () => true): Promise<Row[]> {
  const have = new Set((await target.unsafe(`select ${key}::text as k from platform.${table}`) as { k: string }[]).map(r => r.k));
  const rows = (await source.unsafe(`select to_jsonb(t) as row from platform.${table} t order by ${key}`) as { row: Row }[])
    .map(r => r.row).filter(row => replaysSourceRow(have.has(String(row[key])))).map(adjust).filter(keep);
  if (rows.length) await target.unsafe(`insert into platform.${table} select * from jsonb_populate_recordset(null::platform.${table}, $1::jsonb)`, [rows as never]);
  return rows;
}

export async function replayPrivacy(o: { sourceUrl: string; targetUrl: string; queuedAt: Date }): Promise<PrivacyReplayResult> {
  const source = new SQL({ url: o.sourceUrl, max: 1, connection: { application_name: "network-restore-replay" } });
  const target = new SQL({ url: o.targetUrl, max: 1, connection: { application_name: "network-restore-replay" } });
  try {
    return await source.begin(async src => {
      await src`set transaction isolation level repeatable read, read only`;
      return target.begin(async tx => {
        const consent = await copyMissing(src, tx, "consent_events", "id");
        if (consent.length) await tx`select setval(pg_get_serial_sequence('platform.consent_events', 'id'), (select max(id) from platform.consent_events))`;
        const banPeople = (await src`select distinct b.person_id::text as id, p.phone_hash from platform.bans b
          join platform.people p on p.id = b.person_id` as { id: string; phone_hash: string | null }[]);
        const sourceHash = new Map(banPeople.map(r => [r.id, r.phone_hash]));
        const known = new Set((await tx`select id::text from platform.people where id = any(${banPeople.map(r => r.id)}::uuid[])` as { id: string }[]).map(r => r.id));
        const bans = await copyMissing(src, tx, "bans", "id", row => {
          const person = typeof row.person_id === "string" ? row.person_id : null;
          if (person === null || known.has(person)) return { ...row, projection_completed_at: null };
          return { ...row, projection_completed_at: null, person_id: null, phone_hash: row.phone_hash ?? sourceHash.get(person) ?? null };
        }, row => row.person_id !== null || row.phone_hash !== null);
        for (const ban of bans) {
          if (typeof ban.person_id === "string") await tx`update platform.share_grants set revoked_at = ${new Date(String(ban.at))}
            where person_id = ${ban.person_id}::uuid and revoked_at is null`;
          await tx`delete from platform.pending_texts where phone_hash = ${typeof ban.phone_hash === "string" ? ban.phone_hash : null}
            or phone_hash in (select phone_hash from platform.people where id = ${typeof ban.person_id === "string" ? ban.person_id : null}::uuid and phone_hash is not null)`;
        }
        const suppressions = await copyMissing(src, tx, "suppression", "phone_hash");

        const ledgerHere = new Set((await tx`select id::text from platform.erasure_ledger` as { id: string }[]).map(r => r.id));
        const erasedAfter = [...new Set((await src`select id::text, person_id::text from platform.erasure_ledger order by id` as { id: string; person_id: string }[])
          .filter(r => replaysSourceRow(ledgerHere.has(r.id))).map(r => r.person_id))];
        const liveHere = new Set((await tx`select id::text from platform.people where deleted_at is null and id = any(${erasedAfter}::uuid[])` as { id: string }[]).map(r => r.id));
        const erase = erasedAfter.filter(id => replaysErasure(true, !liveHere.has(id)));

        const live = await tx<MembershipRow[]>`select person_id::text, app_id, member_id, state from platform.memberships where state <> 'removed'`;
        const before = await src<MembershipRow[]>`select person_id::text, app_id, member_id, state from platform.memberships
          where person_id = any(${[...new Set(live.map(m => m.person_id))]}::uuid[])`;
        const sourceOf = new Map(before.map(m => [`${m.person_id}/${m.app_id}`, m]));
        const leave = live.filter(m => {
          const was = sourceOf.get(`${m.person_id}/${m.app_id}`);
          return replaysLeave(true, !!was, was?.state !== "removed", was?.member_id === m.member_id);
        });

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
        const texts = await settleRestoredTexts(tx, src, o.queuedAt);
        return { consentEvents: consent.length, bans: bans.length, suppressions: suppressions.length, erasures: erase.length, leaves: leave.length, stops: stop.length, ...texts };
      });
    });
  } finally {
    await Promise.all([source.close(), target.close()]);
  }
}
