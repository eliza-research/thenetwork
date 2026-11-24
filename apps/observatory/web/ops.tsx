// spec/consolePanels.md, "A new viewer or mode starts every analysis panel again"
// spec/consolePanels.md, "A cost budget turns amber at 80 percent and red at 100 percent"
import { useEffect, useState } from "react";
import { DataCell, DataTable, Kpi, KpiGrid, StatusRow, TableRow, type DataColumn, type KpiTone } from "@thenetwork/ui";
import { budgetMark, canReceiveViewer, costKindShown, costView, initial as initialPanels, receiveViewer, type BudgetMark, type PanelMode, type PanelStaff } from "../../../packages/core/src/generated/consolePanels.ts";
import type { PanelAnswer } from "../../../packages/core/src/generated/consoleWorkspace.ts";
import type { CostSummary } from "../src/ops.ts";
import { store, useStore } from "./store.ts";
import { num, pct } from "./ui.tsx";

/**
 * The analysis-panel viewer from the store, through the generated `receiveViewer`: the mode of the panels and the roles.
 * A simulated mode that the generated `canReceiveViewer` refuses (a real-only server) falls back to read-only real data.
 */
export function panelStaffOf(s: typeof store): PanelStaff {
  const wanted: PanelMode = s.mode === "game" || s.env?.capabilities.hiddenTruth ? "SimulatedPanels" : s.canAct() ? "RealActing" : "RealReadOnly";
  const mode: PanelMode = canReceiveViewer(initialPanels, wanted, s.realOnly()) ? wanted : "RealReadOnly";
  return receiveViewer(initialPanels, mode, s.can("analyst"), s.isAdmin(), s.canSim(), s.realOnly()).staff;
}

const KINDS: [string, string][] = [["otp_verify", "Login codes"], ["photo_rating", "Photo ratings"], ["llm", "LLM"], ["sms_fallback", "SMS fallback"], ["blooio_line", "Line (shared)"], ["other", "Other"]];
const usd = (x: number) => (x >= 100 ? `$${x.toFixed(0)}` : x >= 1 ? `$${x.toFixed(2)}` : `$${x.toFixed(3)}`);
const BUDGET_TONE: Record<BudgetMark, KpiTone> = { BudgetOk: "ok", BudgetNear: "warn", BudgetOver: "destructive" };

/**
 * The cost panel of the Metrics tab on real data: the estimated cost of the app per day and kind (network.cost_ledger), and the use of each daily budget today.
 * @model spec/consolePanels.md
 */
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
  const answer: PanelAnswer = !r ? "NotAnswered" : r.status === 403 ? "AnswerForbidden" : c?.ok ? "AnswerRows" : "AnswerFailed";
  const view = costView(answer);
  if (view !== "PanelRows" || !c) return <StatusRow view={view} error={r?.error ?? "No cost data."} />;
  const kinds = KINDS.filter(([k]) => costKindShown(c.days.filter(d => d.byKind[k]).length));
  const columns: DataColumn[] = [{ key: "day", label: "Day" }, ...kinds.map(([k, l]) => ({ key: k, label: l, numeric: true })), { key: "total", label: "Total", numeric: true }];
  return (
    <div className="flex flex-col gap-3 text-sm">
      <KpiGrid compact>
        <Kpi label={`today · ${c.app}`} value={usd(c.today.app)} />
        <Kpi label="today · shared line" value={usd(c.today.shared)} />
        {c.budgets.map(b => (
          <Kpi key={b.scope} label={`budget · ${b.scope === "total" ? "every app" : b.scope}`} value={`${pct(b.share)} of ${usd(b.budgetUsd)}`} tone={BUDGET_TONE[budgetMark(Math.floor(b.share * 100))]} title={`${usd(b.usedUsd)} used today (UTC day)`} />
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
