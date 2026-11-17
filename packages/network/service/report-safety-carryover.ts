import type { SQL } from "../../core/src/runtime/postgres.ts";
import type { AppId } from "../../platform/src/apps.ts";
import { lockStaffHoldOwner, StaffHoldStateChanged, writeStaffHold } from "./staff-safety-holds.ts";

interface ReportOrigin { app: AppId; runtime: string }

export async function carryReportRestrictions(tx: SQL, origin: ReportOrigin, memberId: string, personId: string,
  reportIds: readonly string[]): Promise<void> {
  if (!await lockStaffHoldOwner(tx, origin.app, memberId, personId)) return;
  await tx`insert into platform.report_safety_carryovers (app_id,origin_runtime_id,report_id,person_id)
    select ${origin.app},${origin.runtime},report_id,${personId}::uuid from unnest(${tx.array([...reportIds], "TEXT")}::text[]) as report_id
    on conflict (app_id,origin_runtime_id,report_id) do nothing`;
}

export async function archivedReportSubject(tx: SQL, origin: ReportOrigin, reportId: string): Promise<string | undefined> {
  const [row] = await tx<{ person_id: string }[]>`select person_id::text from platform.report_safety_carryovers
    where app_id=${origin.app} and origin_runtime_id=${origin.runtime} and report_id=${reportId}`;
  return row?.person_id;
}

async function lockArchivedReportSubject(tx: SQL, origin: ReportOrigin, reportId: string, personId: string): Promise<boolean> {
  const [person] = await tx`select id from platform.people where id=${personId}::uuid and deleted_at is null for update`;
  return !!person && await archivedReportSubject(tx, origin, reportId) === personId;
}

async function removeReportRestriction(tx: SQL, origin: ReportOrigin, reportId: string, personId: string): Promise<void> {
  await tx`delete from platform.report_safety_carryovers where app_id=${origin.app} and origin_runtime_id=${origin.runtime}
    and report_id=${reportId} and person_id=${personId}::uuid`;
}

/** Called after the originating runtime locks and dismisses the exact report. */
export async function dismissReportRestriction(tx: SQL, origin: ReportOrigin, reportId: string): Promise<void> {
  const personId = await archivedReportSubject(tx, origin, reportId);
  if (personId && await lockArchivedReportSubject(tx, origin, reportId, personId)) {
    await removeReportRestriction(tx, origin, reportId, personId);
  }
}

/** Move authority to an authenticated staff decision without leaving a claim window. */
export async function holdFromArchivedReport(tx: SQL, origin: ReportOrigin, reportId: string, personId: string,
  scope: string, decisionId: string, at: number): Promise<void> {
  if (!await lockArchivedReportSubject(tx, origin, reportId, personId)) throw new StaffHoldStateChanged();
  await writeStaffHold(tx, personId, scope, decisionId, at);
  await removeReportRestriction(tx, origin, reportId, personId);
}
