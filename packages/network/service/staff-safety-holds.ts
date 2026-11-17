import type { AppId } from "../../platform/src/apps.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import { carriedTrustHoldRecordAllowed, durableStaffHoldCoversApp, durableStaffHoldLiftAllowed } from "../../core/src/generated/staffSafetyService.ts";

export class StaffHoldStateChanged extends Error {}

export interface StaffHoldDecision {
  local: string | null;
  global: string | null;
}

export async function currentStaffHold(tx: SQL, app: AppId, personId: string): Promise<StaffHoldDecision> {
  const rows = await tx<{ app_id: string | null; decision_id: string; released: boolean }[]>`select
      app_id,decision_id,(${app}=any(released_apps)) as released from platform.staff_safety_holds
    where person_id=${personId}::uuid and (app_id=${app} or app_id is null)`;
  const global = rows.find(row => row.app_id === null);
  return {
    local: rows.find(row => row.app_id === app)?.decision_id ?? null,
    global: global && durableStaffHoldCoversApp(false, true, global.released) ? global.decision_id : null,
  };
}

/** The runtime state row is already locked. Dispatch locks the same person before making a peer claim. */
async function lockStaffHoldOwner(tx: SQL, app: AppId, memberId: string, personId: string): Promise<boolean> {
  const [live] = await tx`select person.id from platform.people person
    join network.members member on member.person_id=person.id and member.app_id=${app} and member.id=${memberId}
    join platform.memberships membership on membership.person_id=person.id and membership.app_id=${app} and membership.member_id=member.id
    where person.id=${personId}::uuid and person.deleted_at is null
      and membership.state not in ('invited','removed') and member.account_status not in ('invited','removed')
    for update of person`;
  return !!live;
}

export async function recordStaffHold(tx: SQL, app: AppId, memberId: string, personId: string,
  scope: string, decisionId: string, at: number): Promise<void> {
  if (!await lockStaffHoldOwner(tx, app, memberId, personId)) throw new StaffHoldStateChanged();
  await tx`insert into platform.staff_safety_holds (person_id, app_id, decision_id, held_at)
    values (${personId}::uuid, ${scope === "*" ? null : scope}, ${decisionId}::uuid, ${new Date(at)})
    on conflict (person_id, app_id) do update set decision_id=excluded.decision_id, held_at=excluded.held_at, released_apps='{}', origin='staff'`;
}

/** The current Network unit already established a hard hold. Retain only the app restriction. */
export async function recordCarriedTrustHold(tx: SQL, app: AppId, memberId: string, personId: string, at: number): Promise<void> {
  if (!await lockStaffHoldOwner(tx, app, memberId, personId)) return;
  const [authority] = await tx<{ banned: boolean; staff_held: boolean }[]>`select banned,staff_held from platform.matching_ages
    where app_id=${app} and member_id=${memberId}`;
  if (!carriedTrustHoldRecordAllowed(!!authority, authority?.banned === true, authority?.staff_held === true)) return;
  await tx`insert into platform.staff_safety_holds (person_id,app_id,decision_id,held_at,origin)
    values (${personId}::uuid,${app},gen_random_uuid(),${new Date(at)},'automatic_carryover') on conflict (person_id,app_id) do nothing`;
}

/** A late related-runtime write must still belong to the global decision that requested it. */
export async function checkStaffHoldProjection(tx: SQL, app: AppId, memberId: string, personId: string, decisionId: string): Promise<void> {
  if (!await lockStaffHoldOwner(tx, app, memberId, personId)) throw new StaffHoldStateChanged();
  if ((await currentStaffHold(tx, app, personId)).global !== decisionId) throw new StaffHoldStateChanged();
}

export async function liftStaffHold(tx: SQL, app: AppId, memberId: string, personId: string,
  expected: StaffHoldDecision, allAppsAuthority: boolean): Promise<void> {
  if (!await lockStaffHoldOwner(tx, app, memberId, personId)) throw new StaffHoldStateChanged();
  const current = await currentStaffHold(tx, app, personId);
  if (current.local !== expected.local || current.global !== expected.global
    || !durableStaffHoldLiftAllowed(current.global !== null, allAppsAuthority)) throw new StaffHoldStateChanged();
  if (current.local !== null) await tx`delete from platform.staff_safety_holds where person_id=${personId}::uuid and app_id=${app}`;
  if (current.global !== null) await tx`update platform.staff_safety_holds set released_apps=array_append(released_apps,${app})
    where person_id=${personId}::uuid and app_id is null`;
}
