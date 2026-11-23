import type { SQL } from "../../core/src/runtime/postgres.ts";
import type { QueueRow, RecipientCheck } from "../../blooio/src/outbound-queue.ts";
import { queuedProbeCurrent } from "../../core/src/generated/probeDispatch.ts";

export async function queuedProbeRosterAdmission(tx: SQL, row: QueueRow, runtimeId: string): Promise<RecipientCheck> {
  if (!row.memberId || !row.oppId) return { ok: true };
  const [opp] = await tx<{ roster: number | null; delivery: string | null; awaited: string | null }[]>`select opp.roster,
      opp."probeDelivery"->>${row.memberId}::text as delivery,
      case when member.awaiting->>'kind'='probe' and member.awaiting->>'oppId'=opp.id then member.awaiting->>'probeReceiptId' end as awaited
    from network.messages msg
    join network.network_state saved on saved.app_id=msg.app_id and saved.id=${runtimeId}
    join lateral jsonb_to_recordset(saved.state->'opps') as opp(id text,roster int,"probeDelivery" jsonb) on opp.id=${row.oppId}
    left join lateral jsonb_to_recordset(saved.state->'members') as member(id text,awaiting jsonb) on member.id=${row.memberId}
    where msg.app_id=${row.app} and msg.id=${row.id} and msg.member_id=${row.memberId} and msg.direction='outbound'
      and msg.type in ('probe','scheduling')`;
  if (!opp) return { ok: true };
  const currentTurn = opp.delivery === row.id || opp.awaited === row.id;
  return queuedProbeCurrent((opp.roster ?? 0) !== 0, currentTurn) ? { ok: true } : { ok: false, reason: "probe_roster_changed" };
}
