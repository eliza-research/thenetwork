import { useEffect, useState } from "react";
import { DataCell, DataTable, Kpi, KpiGrid, StatusRow, TableRow, type DataColumn, type KpiTone } from "@thenetwork/ui";
import type { PanelView } from "../../core/src/generated/consoleWorkspace.ts";
import type { CostSummary } from "../src/ops.ts";
import { store, useStore } from "./store.ts";
import { num, pct } from "./ui.tsx";

const KINDS: [string, string][] = [["otp_verify", "Login codes"], ["photo_rating", "Photo ratings"], ["llm", "LLM"], ["sms_fallback", "SMS fallback"], ["blooio_line", "Line (shared)"], ["other", "Other"]];
const usd = (x: number) => (x >= 100 ? `$${x.toFixed(0)}` : x >= 1 ? `$${x.toFixed(2)}` : `$${x.toFixed(3)}`);
const budgetTone = (share: number): KpiTone => (share >= 1 ? "destructive" : share >= 0.8 ? "warn" : "ok");

/** The cost panel of the Metrics tab on real data: the estimated cost of the app per day and kind (network.cost_ledger), and the use of each daily budget today. */
export function CostPanel() {
  const s = useStore();
  const [r, setR] = useState<{ data?: CostSummary & { ok: boolean }; status: number; error?: string }>();
  useEffect(() => {
    let live = true;
    const load = () => store.cost().then(x => { if (live) setR(x); });
    load();
    const h = setInterval(load, 60_000);
    return () => { live = false; clearInterval(h); };
  }, [s.app, s.mode]);
  const c = r?.data;
  const view: PanelView = !r ? "PanelLoading" : r.status === 403 ? "PanelForbidden" : c?.ok ? "PanelRows" : "PanelFailed";
  if (!c?.ok) return <StatusRow view={view} error={r?.error ?? "No cost data."} />;
  const kinds = KINDS.filter(([k]) => c.days.some(d => d.byKind[k]));
  const columns: DataColumn[] = [{ key: "day", label: "Day" }, ...kinds.map(([k, l]) => ({ key: k, label: l, numeric: true })), { key: "total", label: "Total", numeric: true }];
  return (
    <div className="flex flex-col gap-3 text-sm">
      <KpiGrid compact>
        <Kpi label={`today · ${c.app}`} value={usd(c.today.app)} />
        <Kpi label="today · shared line" value={usd(c.today.shared)} />
        {c.budgets.map(b => (
          <Kpi key={b.scope} label={`budget · ${b.scope === "total" ? "every app" : b.scope}`} value={`${pct(b.share)} of ${usd(b.budgetUsd)}`} tone={budgetTone(b.share)} title={`${usd(b.usedUsd)} used today (UTC day)`} />
        ))}
      </KpiGrid>
      <p className="text-muted-foreground">Estimates: {pct(c.estimatedShare)} of the period comes from fixed rates, not a provider's own price. Days are UTC.</p>
      <DataTable columns={columns} empty={c.days.length ? undefined : "No costs recorded yet."}>
        {c.days.map(d => (
          <TableRow key={d.day}>
            <DataCell>{d.day}</DataCell>
            {kinds.map(([k]) => <DataCell key={k} numeric>{d.byKind[k] ? usd(d.byKind[k]) : "–"}</DataCell>)}
            <DataCell numeric>{usd(d.total)}</DataCell>
          </TableRow>
        ))}
      </DataTable>
      {kinds.length > 0 && <p className="text-muted-foreground">{kinds.map(([k, l]) => `${l}: ${num(Math.round(c.quantities[k] ?? 0))}`).join(" · ")}</p>}
    </div>
  );
}
