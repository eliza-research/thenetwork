// spec/opsAlertDispatch.md, "Story: Hear when a shared-line turn may have reached nobody"
// The operations feed for the signed gateway turn: handled turns whose replies have no confirmed receipt,
// signed turns that did not complete, and queued deliveries whose acceptance is unknown. It reads the
// shared platform tables (platform.inbound, platform.outbound) and returns counts only: never a turn id,
// a number, a member or a text.
import type { SQL } from "../../core/src/runtime/postgres.ts";
import {
  turnWatchComplianceAfterMs, turnWatchOverdue, turnWatchPossibleCompliance, turnWatchReplyAfterMs, turnWatchUnconfirmed, turnWatchWindowMs,
  type TurnWatchCondition, type TurnWatchReceipt,
} from "../../core/src/generated/opsAlertDispatch.ts";

export interface TurnWatchCount {
  condition: TurnWatchCondition;
  /** Rows past their threshold. */
  overdue: number;
  /** The overdue rows that are, or may be, a STOP or other compliance reply. */
  compliance: number;
}
export interface TurnWatchMetrics { conditions: TurnWatchCount[] }

/** One group of candidate rows: same compliance flag and receipt, ages in one band, counted in SQL. */
interface Group { compliance: boolean; receipt: string | null; band: number; n: number }

const RECEIPTS: Record<string, TurnWatchReceipt> = { unknown: "ReceiptUnknown", rejected: "ReceiptRejected", accepted: "ReceiptAccepted" };
function receiptOf(outcome: string | null): TurnWatchReceipt {
  if (outcome === null) return "NoReceipt";
  const receipt = RECEIPTS[outcome];
  if (!receipt) throw new Error(`turn watch: unexpected receipt outcome ${JSON.stringify(outcome)}`);
  return receipt;
}

export async function turnWatchMetrics(sql: SQL, now: number): Promise<TurnWatchMetrics> {
  // The SQL counts rows by age band and never decides one: the band edges are the spec's own thresholds, so
  // turnWatchOverdue is constant inside a band and is asked once per band at the band's youngest age.
  const [e0, e1, e2] = [turnWatchComplianceAfterMs, turnWatchReplyAfterMs, turnWatchWindowMs].sort((a, b) => a - b) as [number, number, number];
  const cut = (ms: number) => new Date(now - ms);
  const band = (column: string) =>
    sql`case when ${sql(column)} > ${cut(e1)} then ${e0}::bigint when ${sql(column)} > ${cut(e2)} then ${e1}::bigint else ${e2}::bigint end`;
  const youngest = cut(e0);
  const unconfirmed = (await sql`select compliance, receipt, ${band("handled_at")} as band, count(*)::int as n from (
      select exists(select 1 from jsonb_array_elements(replies) r where r->>'kind' = 'compliance') as compliance,
        case when receipt_hash is null then null else receipt->>'outcome' end as receipt, handled_at
      from platform.inbound where request_hash is not null and status = 'done' and response->>'outcome' = 'handled'
        and jsonb_array_length(replies) > 0 and handled_at <= ${youngest}) t
    group by 1, 2, 3`) as Group[];
  // A turn that completed (handled_at set) and was later erased or sealed is not unresolved; a turn that staff
  // resolved, or that retention sealed, has no sender hash. The rows kept no text.
  const unresolved = (await sql`select false as compliance, null as receipt, ${band("arrived_at")} as band, count(*)::int as n
    from platform.inbound where request_hash is not null and sender_hash is not null and handled_at is null
      and status in ('unresolved', 'processing') and arrived_at <= ${youngest} group by 1, 2, 3`) as Group[];
  // The unknown clock starts at the failed call (next_attempt_at), as in the outbound queue's own expiry.
  const unknown = (await sql`select kind = 'compliance' as compliance, null as receipt, ${band("next_attempt_at")} as band, count(*)::int as n
    from platform.outbound where status = 'unknown_acceptance' and next_attempt_at <= ${youngest} group by 1, 2, 3`) as Group[];
  const count = (condition: TurnWatchCondition, groups: Group[]): TurnWatchCount => {
    let overdue = 0, compliance = 0;
    for (const g of groups) {
      const c = g.compliance === true;
      if (condition === "RepliesUnconfirmed" && !turnWatchUnconfirmed(receiptOf(g.receipt), c)) continue;
      if (!turnWatchOverdue(condition, c, Number(g.band))) continue;
      overdue += g.n;
      if (turnWatchPossibleCompliance(condition, c)) compliance += g.n;
    }
    return { condition, overdue, compliance };
  };
  return { conditions: [count("RepliesUnconfirmed", unconfirmed), count("TurnUnresolved", unresolved), count("DeliveryUnknown", unknown)] };
}
