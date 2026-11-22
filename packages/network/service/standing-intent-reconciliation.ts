import { JOB_INTENT } from "@thenetwork/engine/src/packs/peon/schema.ts";
import { reconcileLegacyIntent, type IntentControl } from "../../core/src/generated/standingIntentManagement.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import { standingIntentDeadline } from "../../core/src/standing-intent.ts";
import type { NetworkState } from "../src/network.ts";

interface IntentRow {
  id: string;
  member_id: string;
  status: string;
  details: string | null;
  created_at: Date;
  horizon_days: number;
  had_row_at_save: boolean;
}

/** Promote the owned relational rows using only controls from the prior saved state. */
export async function reconcileLegacyIntentRows(tx: SQL, app: string, homes: readonly string[], state: NetworkState, now: number, inactive: ReadonlySet<string>): Promise<void> {
  if (!Number.isSafeInteger(state.savedAt) || state.savedAt > now || !Number.isFinite(new Date(state.savedAt).getTime())) return;
  const byMember = new Map<string, Map<string, IntentControl>>();
  const ids = new Set<string>();
  for (const member of state.members) {
    if (inactive.has(member.id)) continue;
    const controls = new Map<string, IntentControl>();
    for (const [key, control] of Object.entries(member.intentControls ?? {})) {
      if (!key.startsWith("stored:") || key.length === "stored:".length || (control !== "PauseControl" && control !== "CloseControl")) continue;
      const id = key.slice("stored:".length);
      controls.set(id, control);
      ids.add(id);
    }
    if (controls.size) byMember.set(member.id, controls);
  }
  if (!ids.size || !homes.length) return;

  const rows = await tx<IntentRow[]>`select i.id, i.member_id, i.status, i.details, i.created_at, i.horizon_days,
      i.created_at <= ${new Date(state.savedAt)} as had_row_at_save
    from network.intents i
    join network.members m on m.app_id = i.app_id and m.id = i.member_id
    join platform.memberships pm on pm.app_id = m.app_id and pm.member_id = m.id and pm.person_id = m.person_id
    join platform.people p on p.id = pm.person_id
    where i.app_id = ${app} and i.id = any(${tx.array([...ids], "TEXT")})
      and m.home_city = any(${tx.array(homes, "TEXT")}) and m.account_status = 'active' and not m.opted_out
      and pm.state = 'active' and pm.review is null and p.deleted_at is null
    order by p.id, i.id for update of i, m, pm, p`;
  const updates: { id: string; member_id: string; status: "paused" | "closed" }[] = [];
  for (const row of rows) {
    const control = byMember.get(row.member_id)?.get(row.id);
    if (!control) continue;
    const deadline = standingIntentDeadline({ createdAt: new Date(row.created_at).getTime(), horizonDays: row.horizon_days });
    const decision = reconcileLegacyIntent(row.status, control, true, row.had_row_at_save, deadline > now, row.details?.startsWith(JOB_INTENT) ?? false);
    if (decision === "KeepIntentStatus") continue;
    updates.push({ id: row.id, member_id: row.member_id, status: decision === "ReconcilePause" ? "paused" : "closed" });
  }
  if (!updates.length) return;
  await tx`update network.intents i set status = patch.status
    from jsonb_to_recordset(${{ items: updates }}::jsonb -> 'items') as patch(id text, member_id text, status text)
    where i.app_id = ${app} and i.member_id = patch.member_id and i.id = patch.id`;
}
