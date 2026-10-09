// Person-level safety holds (platform.person_safety, migration 0019; docs/runbook-safety.md). A hold
// names the person and their phone's keyed hash, so it follows the person to every app, and through
// "leave", "delete everything" and a new join with the same number. Only staff clear it. The service
// writes and clears rows here; each app's snapshot reads platform.held_people (ids only).
import { randomUUID } from "node:crypto";
import type { SQL } from "bun";

export type PersonHoldReason = "urgent_report" | "minor_report" | "staff_hold";
export interface PersonHold {
  id: string; personId: string | null; phoneHash: string | null; reason: PersonHoldReason; originApp: string | null; caseId: string | null;
  priorAge: number | null; openedAt: number; clearedAt: number | null; clearedBy: string | null;
}

const row = (r: any): PersonHold => ({
  id: r.id, personId: r.person_id ?? null, phoneHash: r.phone_hash ?? null, reason: r.reason, originApp: r.origin_app ?? null, caseId: r.case_id ?? null,
  priorAge: r.prior_age ?? null, openedAt: new Date(r.opened_at).getTime(), clearedAt: r.cleared_at ? new Date(r.cleared_at).getTime() : null, clearedBy: r.cleared_by ?? null,
});

/** The open holds on this person (by id, or by the phone hash they have now). */
export async function openHolds(sql: SQL, personId: string): Promise<PersonHold[]> {
  const rows = await sql`select s.* from platform.person_safety s, platform.people p where p.id = ${personId}::uuid and s.hold and s.cleared_at is null
    and (s.person_id = p.id or (s.phone_hash is not null and s.phone_hash = p.phone_hash)) order by s.opened_at, s.id`;
  return (rows as any[]).map(row);
}

/**
 * Hold a person on every app. One open row per person and reason: a second urgent report adds
 * nothing here (the network keeps every report). Returns the hold and whether it is new.
 */
export async function holdPerson(sql: SQL, h: { personId: string; reason: PersonHoldReason; originApp?: string; caseId?: string; priorAge?: number | null; at: number }): Promise<{ hold: PersonHold; created: boolean }> {
  const open = (await openHolds(sql, h.personId)).find(x => x.reason === h.reason);
  if (open) return { hold: open, created: false };
  const [p] = await sql`select phone_hash, lowest_age from platform.people where id = ${h.personId}::uuid`;
  const [r] = await sql`insert into platform.person_safety (id, person_id, phone_hash, hold, reason, origin_app, case_id, prior_age, opened_at)
    values (${`ps_${randomUUID()}`}, ${h.personId}::uuid, ${p?.phone_hash ?? null}, true, ${h.reason}, ${h.originApp ?? null}, ${h.caseId ?? null},
      ${h.priorAge !== undefined ? h.priorAge : (p?.lowest_age ?? null)}, ${new Date(h.at)}) returning *`;
  return { hold: row(r), created: true };
}

/** Staff clear every open hold on the person (audited by the caller). Returns the holds cleared. */
export async function clearPerson(sql: SQL, personId: string, by: string, at: number): Promise<PersonHold[]> {
  const open = await openHolds(sql, personId);
  if (!open.length) return [];
  await sql`update platform.person_safety set hold = false, cleared_at = ${new Date(at)}, cleared_by = ${by} where id in ${sql(open.map(x => x.id))}`;
  return open;
}

/** The held people among these (platform.held_people). */
export async function heldPeople(sql: SQL, personIds: string[]): Promise<Set<string>> {
  if (!personIds.length) return new Set();
  const rows = await sql`select held_people as id from platform.held_people(${sql.array(personIds, "UUID")})`;
  return new Set((rows as any[]).map(r => String(r.id)));
}
