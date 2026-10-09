// The cost panel (Metrics tab, real mode): the app's estimated cost per day and kind from
// network.cost_ledger, and today's use of each daily budget (src/ops.ts; docs/deploy.md section 7.3).
import { useEffect, useState } from "react";
import type { CostSummary } from "../src/ops.ts";
import { store, useStore } from "./store.ts";
import { Kpi, num, pct } from "./ui.tsx";

const KINDS: [string, string][] = [["otp_verify", "Login codes"], ["photo_rating", "Photo ratings"], ["llm", "LLM"], ["sms_fallback", "SMS fallback"], ["blooio_line", "Line (shared)"], ["other", "Other"]];
const usd = (x: number) => (x >= 100 ? `$${x.toFixed(0)}` : x >= 1 ? `$${x.toFixed(2)}` : `$${x.toFixed(3)}`);

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
  if (!r) return <div className="muted small">Loading…</div>;
  const c = r.data;
  if (!c?.ok) return <div className="muted small">{r.status === 403 ? "Your role cannot see this." : r.error ?? "No cost data."}</div>;
  const kinds = KINDS.filter(([k]) => c.days.some(d => d.byKind[k]));
  return (
    <div className="small">
      <div className="kpis compact">
        <Kpi label={`today · ${c.app}`} value={usd(c.today.app)} />
        <Kpi label="today · shared line" value={usd(c.today.shared)} />
        {c.budgets.map(b => (
          <Kpi key={b.scope} label={`budget · ${b.scope === "total" ? "every app" : b.scope}`} value={`${pct(b.share)} of ${usd(b.budgetUsd)}`} tone={b.share >= 1 ? "bad" : b.share >= 0.8 ? "warn" : "good"} title={`${usd(b.usedUsd)} used today (UTC day)`} />
        ))}
      </div>
      <div className="muted">Estimates: {pct(c.estimatedShare)} of the period comes from fixed rates, not a provider's own price. Days are UTC.</div>
      <table className="table">
        <thead><tr><th>Day</th>{kinds.map(([k, l]) => <th key={k} className="r">{l}</th>)}<th className="r">Total</th></tr></thead>
        <tbody>
          {c.days.map(d => (
            <tr key={d.day}><td>{d.day}</td>{kinds.map(([k]) => <td key={k} className="r">{d.byKind[k] ? usd(d.byKind[k]) : "–"}</td>)}<td className="r">{usd(d.total)}</td></tr>
          ))}
          {!c.days.length && <tr><td colSpan={kinds.length + 2} className="muted">No costs recorded yet.</td></tr>}
        </tbody>
      </table>
      {kinds.length > 0 && <div className="muted">{kinds.map(([k, l]) => `${l}: ${num(Math.round(c.quantities[k] ?? 0))}`).join(" · ")}</div>}
    </div>
  );
}
