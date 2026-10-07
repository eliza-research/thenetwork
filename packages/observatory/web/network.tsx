// The consent-first Network's internals: how engine candidates become meetings (the consent
// ladder), what members asked for and got, trust and safety, and growth.
import { useEffect, useState } from "react";
import { store, useStore } from "./store.ts";
import { Bars, humanize, Kpi, num, pct, Section } from "./ui.tsx";

export function NetworkPanel() {
  const s = useStore();
  const n = s.network;
  if (!n) return <div className="muted small pad">This world runs the old stub Network. Reset with the consent-first Network to see the consent ladder.</div>;
  const c = n.counters;
  const answered = c.probeYes + c.probeNo + c.probeExpired;
  const ladder: [string, number][] = [
    ["engine candidates", c.engineProposals], ["passed the skeptical gate", c.engineProposals - (c.gatedOut - (n.gateReasons.daily_cap ?? 0))],
    ["opportunities started (all sources)", c.oppsStarted], ["anonymous probes sent", c.probesSent], ["probe yes", c.probeYes],
    ["revealed (proposals)", c.oppsRevealed], ["everyone said yes", c.oppsAllYes], ["scheduled", c.scheduled], ["meetings held", s.stats?.meetingsHeld ?? 0],
  ];
  return (
    <div className="run-grid">
      <Section title="Consent ladder: candidates → meetings">
        <div className="funnel">
          {ladder.map(([k, v]) => (
            <div className="funnel-row" key={k}><div className="funnel-bar" style={{ width: `${(v / Math.max(1, ladder[0]![1], c.oppsStarted)) * 100}%` }} /><span>{k}</span><b>{num(v)}</b></div>
          ))}
        </div>
        <div className="kpis compact">
          <Kpi label="everyone-yes rate" value={pct(c.oppsRevealed ? c.oppsAllYes / c.oppsRevealed : 0)} sub="of proposals revealed" tone={c.oppsRevealed && c.oppsAllYes / c.oppsRevealed >= 0.85 ? "good" : undefined} />
          <Kpi label="invite yes rate" value={pct(c.reveals ? c.revealYes / c.reveals : 0)} />
          <Kpi label="probe yes rate" value={pct(answered ? c.probeYes / answered : 0)} sub={`${c.probeExpired} unanswered`} />
          <Kpi label="swapped in alternates" value={num(c.replacements)} />
        </div>
      </Section>
      <Section title="What members asked for">
        <div className="kpis compact">
          <Kpi label="people requests" value={num(n.requests.total)} />
          <Kpi label="fulfilled" value={num(n.requests.fulfilled)} sub={pct(n.requests.total ? n.requests.fulfilled / n.requests.total : 0)} tone="good" />
          <Kpi label="standing (still looking)" value={num(n.requests.waiting)} tone={n.requests.waiting ? "warn" : undefined} />
          <Kpi label="plans asks answered" value={num(n.requests.plans)} />
        </div>
        <div className="small muted">Requests are fulfilled with an anonymous check first, retried daily for a week, and paired with a public alternative and an invite ask when no one fits.</div>
      </Section>
      <Section title="Trust and safety">
        <div className="kpis compact">
          <Kpi label="abuse handled" value={num(c.abuse)} />
          <Kpi label="on watch" value={num(n.trust.watch)} tone={n.trust.watch ? "warn" : undefined} />
          <Kpi label="on hold" value={num(n.trust.hold)} tone={n.trust.hold ? "bad" : undefined} />
        </div>
        <div className="small muted">Spam, sales, money asks, contact extraction, prompt injection and pressure are refused and scored; reports count only when corroborated; inviters are accountable for who they bring.</div>
      </Section>
      <Section title="Growth">
        <div className="kpis compact">
          <Kpi label="growth asks" value={num(c.growthAsks)} />
          <Kpi label="invites sent" value={num(c.invitesSent)} />
          <Kpi label="friends joined" value={num(c.inviteesJoined)} tone="good" />
        </div>
      </Section>
      <Section title="Why engine candidates were not started">
        <Bars data={n.gateReasons} color="#ff8f66" />
      </Section>
    </div>
  );
}

interface Level { id: string; title: string; description: string; days: number }
export function Levels() {
  const s = useStore();
  const [levels, setLevels] = useState<Level[]>([]);
  const [result, setResult] = useState<{ pass: boolean; checks: { name: string; pass: boolean; detail: string }[] } | null>(null);
  useEffect(() => { fetch("/api/levels").then(r => r.json()).then(setLevels).catch(() => {}); }, []);
  const current = s.network?.scenario;
  return (
    <Section title="Levels: NYC scenarios" right={current ? <button className="btn" onClick={async () => { const r = await store.control({ type: "check_scenario" }); if (r.ok) setResult(r.data as any); }}>Check level</button> : undefined}>
      {current && <div className="callout small">Playing <b>{current.title}</b>: {current.description}</div>}
      {result && (
        <div className={`callout small ${result.pass ? "good" : "bad"}`}>
          {result.pass ? "Level passed." : "Not yet."} {result.checks.map(c => `${c.pass ? "✓" : "✗"} ${c.name}`).join(" · ")}
        </div>
      )}
      <div className="levels">
        {levels.map(l => (
          <button key={l.id} className={current?.id === l.id ? "level active" : "level"} onClick={() => { setResult(null); store.control({ type: "reset", scenario: l.id, network: "consent" }); }}>
            <b>{l.title}</b><span className="small muted">{l.description}</span><span className="small">{l.days} days</span>
          </button>
        ))}
        <button className="level" onClick={() => { setResult(null); store.control({ type: "reset", scenario: null, network: "consent" }); }}><b>Free play</b><span className="small muted">The 250 NYC members, no script.</span></button>
      </div>
    </Section>
  );
}

export { humanize };
