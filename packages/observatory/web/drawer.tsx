// Bottom drawer: live feed, opportunity pipeline, matching-run inspector, metrics and the game.
import { useMemo, useState } from "react";
import type { EngineRunSummary, ObsOpportunity } from "../src/types.ts";
import { EDGE_STYLE, OPP_COLOR } from "./graph.ts";
import { store, useStore, type UIState } from "./store.ts";
import { Levels, NetworkPanel } from "./network.tsx";
import { Badge, Bars, Components, humanize, Kpi, Lorenz, num, pct, Section, stamp } from "./ui.tsx";

const TABS: { id: UIState["drawer"]; label: string; game?: boolean }[] = [
  { id: "feed", label: "Live feed" }, { id: "pipeline", label: "Pipeline" }, { id: "engine", label: "Matching runs" },
  { id: "network", label: "Consent & safety", game: true }, { id: "metrics", label: "Metrics" }, { id: "game", label: "Score, missions & levels", game: true },
];

export function Drawer() {
  const s = useStore();
  const game = !!s.env?.capabilities.canIntervene;
  const tab = !game && (s.ui.drawer === "game" || s.ui.drawer === "network") ? "feed" : s.ui.drawer;
  return (
    <div className={`drawer ${s.ui.drawerOpen ? "open" : ""}`}>
      <div className="drawer-tabs">
        {TABS.filter(t => !t.game || game).map(t => (
          <button key={t.id} className={tab === t.id && s.ui.drawerOpen ? "tab active" : "tab"} onClick={() => store.setUI({ drawer: t.id, drawerOpen: tab !== t.id || !s.ui.drawerOpen })}>
            {t.label}{t.id === "game" && s.game ? ` · ${s.game.scores.find(x => x.source === "player")?.points ?? 0} pts` : ""}
          </button>
        ))}
        <span className="spacer" />
        <button className="tab" onClick={() => store.setUI({ drawerOpen: !s.ui.drawerOpen })}>{s.ui.drawerOpen ? "▾" : "▴"}</button>
      </div>
      {s.ui.drawerOpen && (
        <div className="drawer-body">
          {tab === "feed" && <Feed />}
          {tab === "pipeline" && <Pipeline />}
          {tab === "engine" && <Engine />}
          {tab === "network" && <NetworkPanel />}
          {tab === "metrics" && <Metrics />}
          {tab === "game" && <Game />}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- feed
const KIND_FILTERS = ["all", "people", "engine", "safety", "game"] as const;
function Feed() {
  const s = useStore();
  const [f, setF] = useState<(typeof KIND_FILTERS)[number]>("all");
  const items = s.feed.filter(x => f === "all" ? x.kind !== "join" || s.feed.length < 60
    : f === "people" ? ["accept", "decline", "meeting", "outcome", "feedback", "proposal"].includes(x.kind)
    : f === "engine" ? x.kind === "engine" || x.kind === "skip"
    : f === "safety" ? ["block", "opt_out", "adversarial", "invariant", "error"].includes(x.kind)
    : x.kind === "game" || x.kind === "proposal").slice(-150).reverse();
  return (
    <div className="feed">
      <div className="filters">{KIND_FILTERS.map(k => <button key={k} className={f === k ? "chip active" : "chip"} onClick={() => setF(k)}>{k}</button>)}</div>
      <div className="feed-list">
        {items.map(x => (
          <button key={x.seq} className={`feed-item sev-${x.severity ?? "info"}`} onClick={() => x.opportunityId && s.opps.has(x.opportunityId) ? store.select({ kind: "opportunity", id: x.opportunityId }) : x.members?.[0] ? store.select({ kind: "member", id: x.members[0] }) : undefined}>
            <span className="feed-time">{stamp(x.t)}</span>
            <span className={`feed-kind k-${x.kind}`}>{humanize(x.kind)}</span>
            <span className="feed-text">{x.text}</span>
          </button>
        ))}
        {!items.length && <div className="muted small pad">Nothing yet. Press play.</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- pipeline
const COLUMNS: { title: string; states: string[] }[] = [
  { title: "Proposed", states: ["PROPOSED"] },
  { title: "Inviting", states: ["INVITING", "PARTIALLY_ACCEPTED"] },
  { title: "Accepted", states: ["MUTUALLY_ACCEPTED", "QUORUM_MET"] },
  { title: "Scheduled", states: ["SCHEDULED"] },
  { title: "Met", states: ["COMPLETED", "FEEDBACK_COLLECTED"] },
  { title: "Closed", states: ["DECLINED", "EXPIRED", "CANCELLED", "SKIPPED", "ABANDONED", "QUORUM_FAILED"] },
];
function Pipeline() {
  const s = useStore();
  const [src, setSrc] = useState("all");
  const sources = useMemo(() => ["all", ...new Set([...s.opps.values()].map(o => o.source))], [s.opps.size]);
  const opps = [...s.opps.values()].filter(o => (src === "all" || o.source === src) && (s.ui.city === "all" || o.city === s.ui.city));
  const total = opps.length || 1;
  return (
    <div className="pipeline">
      <div className="filters">{sources.map(k => <button key={k} className={src === k ? "chip active" : "chip"} onClick={() => setSrc(k)}>{k}</button>)}<span className="muted small">{num(opps.length)} opportunities</span></div>
      <div className="kanban">
        {COLUMNS.map(c => {
          const list = opps.filter(o => c.states.includes(o.state)).sort((a, b) => b.updatedAt - a.updatedAt);
          return (
            <div className="kcol" key={c.title}>
              <div className="kcol-head"><span>{c.title}</span><b>{num(list.length)}</b></div>
              <div className="kcol-bar"><div style={{ width: `${(list.length / total) * 100}%`, background: OPP_COLOR[c.states[0]!] ?? "#7c8799" }} /></div>
              {c.title === "Closed" && list.length > 0 && <div className="small muted">{Object.entries(count(list, o => o.state)).map(([k, v]) => `${humanize(k)} ${v}`).join(" · ")}</div>}
              <div className="kcards">{list.slice(0, 30).map(o => <OppCard key={o.id} o={o} />)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function OppCard({ o }: { o: ObsOpportunity }) {
  const s = useStore();
  return (
    <button className={`kcard src-${o.source}`} onClick={() => store.select({ kind: "opportunity", id: o.id })}>
      <div className="kcard-title">{o.participants.map(x => s.members.get(x)?.name.split(" ")[0] ?? x).join(" · ")}</div>
      <div className="kcard-meta">{o.source === "engine" ? humanize(o.generator) : o.source} · {o.city.toUpperCase()}{o.reason ? ` · ${o.reason}` : ""}</div>
    </button>
  );
}
const count = <T,>(xs: T[], f: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => { m[f(x)] = (m[f(x)] ?? 0) + 1; return m; }, {});

// ---------------------------------------------------------------- engine
function Engine() {
  const s = useStore();
  const runs = [...s.runs].reverse();
  const [sel, setSel] = useState<string>();
  const run = runs.find(r => r.id === sel) ?? runs[0];
  if (!run) return <div className="muted small pad">{s.env?.capabilities.canStep ? "The engine runs nightly per city. Step forward a few hours." : "No matching runs recorded. Use “Shadow run” to run engine-v1 on this data without sending anything."}</div>;
  return (
    <div className="engine">
      <div className="run-list">
        {runs.map(r => (
          <button key={r.id} className={r.id === run.id ? "run active" : "run"} onClick={() => setSel(r.id)}>
            <b>{r.city?.toUpperCase() ?? "ALL"}</b> {stamp(r.at)} <span className="muted">· {r.proposals} proposals{r.shadow ? " · shadow" : ""}</span>
          </button>
        ))}
      </div>
      <RunDetail run={run} />
    </div>
  );
}
function RunDetail({ run }: { run: EngineRunSummary }) {
  const s = useStore();
  const f = run.funnel;
  const funnel: [string, number][] = [["candidates generated", f.generated], ["passed hard filters", f.passedHardFilters], ["after dedupe", f.passedHardFilters - f.deduped], ["eligible (above threshold)", f.eligible], ["selected", f.selected]];
  const name = (x: string) => s.members.get(x)?.name.split(" ")[0] ?? x;
  return (
    <div className="run-detail">
      <div className="run-grid">
        <Section title={`Funnel · ${run.engineVersion} · ${run.wallMs} ms`}>
          <div className="funnel">
            {funnel.map(([k, v]) => (
              <div className="funnel-row" key={k}><div className="funnel-bar" style={{ width: `${(v / Math.max(1, f.generated)) * 100}%` }} /><span>{k}</span><b>{num(v)}</b></div>
            ))}
          </div>
          <div className="small muted">{f.belowThreshold} below threshold · {f.budgetSkips} skipped for budget/load · {f.dealbreakers} dealbreakers · {f.exploration} exploration picks</div>
        </Section>
        <Section title="Generators: candidates → proposals">
          <div className="gen-table">
            {Object.entries(run.byGenerator).sort((a, b) => b[1] - a[1]).map(([g, n]) => (
              <div className="gen-row" key={g}><span>{humanize(g)}</span><span className="muted">{num(n)}</span><b>{run.proposalsByGenerator[g] ?? 0}</b></div>
            ))}
          </div>
        </Section>
        <Section title="Why candidates were filtered">
          <Bars data={run.rejectedBy} color="#ff8f66" limit={10} />
        </Section>
        <Section title="Fairness of exposure">
          <div className="fair">
            <Lorenz points={run.fairness.lorenz} />
            <div className="kpis compact">
              <Kpi label="gini" value={run.fairness.gini.toFixed(2)} />
              <Kpi label="top 10% share" value={pct(run.fairness.top10Share)} />
              <Kpi label="no proposal" value={pct(run.fairness.zeroExposureShare)} />
              <Kpi label="newcomer coverage" value={pct(run.fairness.newcomerCoverage)} />
            </div>
          </div>
          <div className="small muted">{run.emptyStates} intents with nothing: {Object.entries(run.emptyStatesByReason).map(([k, v]) => `${humanize(k)} ${v}`).join(" · ") || "none"}</div>
        </Section>
      </div>
      <Section title="Top configurations and why the alternatives lost">
        <div className="top-table">
          {run.top.slice(0, 16).map(t => (
            <details key={t.key} className={t.selected ? "top-row selected" : "top-row"}>
              <summary>
                <span className="top-score">{t.score.toFixed(3)}</span>
                <span>{t.participants.map(name).join(" · ")}</span>
                <span className="muted small">{humanize(t.generator)}</span>
                {t.selected ? <Badge tone="good">selected</Badge> : <Badge tone={t.eligible ? "warn" : "neutral"}>{t.eligible ? "lost in selection" : humanize(t.reason ?? "ineligible")}</Badge>}
              </summary>
              <Components c={t.components} />
            </details>
          ))}
        </div>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- metrics
function Metrics() {
  const s = useStore();
  const st = s.stats;
  if (!st) return null;
  const weeks = Math.max(1 / 7, ((s.clock?.now ?? 0) - (s.clock?.start ?? 0)) / (7 * 86_400_000));
  const game = !!s.env?.capabilities.hiddenTruth;
  const learned = ["introduced", "met", "enjoyed", "would_interact_again", "avoid", "blocked"];
  return (
    <div className="metrics">
      <div className="kpis">
        <Kpi label="messages / member / week" value={(st.messages / Math.max(1, st.joined) / weeks).toFixed(1)} />
        <Kpi label="proactive / member / week" value={(st.proactive / Math.max(1, st.joined) / weeks).toFixed(2)} sub="budget: normal ≤ 2" />
        <Kpi label="invite accept rate" value={pct(st.invites ? st.accepts / st.invites : 0)} />
        <Kpi label="show rate" value={pct(st.attended + st.noShows + st.cancelledWithNotice ? st.attended / (st.attended + st.noShows + st.cancelledWithNotice) : 0)} sub={`${st.noShows} no-shows · ${st.cancelledWithNotice} with notice`} />
        <Kpi label="mean enjoyment" value={st.enjoymentN ? pct(st.enjoymentSum / st.enjoymentN) : "–"} />
        <Kpi label="members who met someone" value={num([...s.members.values()].filter(m => m.counters.meetings > 0).length)} />
        {game && <Kpi label="precision (truth)" value={pct(st.oracleJudged ? st.compatible / st.oracleJudged : 0)} />}
        {game && <Kpi label="unsafe proposals" value={num(st.unsafe)} tone={st.unsafe ? "bad" : "good"} />}
        <Kpi label="opt-outs" value={num(st.optOuts)} tone={st.optOuts ? "warn" : undefined} />
        <Kpi label="invariant violations" value={num(st.invariantViolations)} tone={st.invariantViolations ? "bad" : "good"} />
      </div>
      <div className="run-grid">
        <Section title="Proposals by source"><Bars data={st.proposalsBySource} /></Section>
        <Section title="Opportunities by state"><Bars data={st.oppsByState} color={k => OPP_COLOR[k] ?? "#7c8799"} /></Section>
        <Section title="Relationships learned"><Bars data={Object.fromEntries(learned.map(k => [k, st.edgesByType[k] ?? 0]))} color={k => EDGE_STYLE[k]?.color ?? "#888"} /></Section>
        <Section title="Members by state"><Bars data={st.byState} /></Section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- game
function Game() {
  const s = useStore();
  const g = s.game;
  const [resetSeed, setResetSeed] = useState(1);
  if (!g) return null;
  return (
    <div className="game">
      <div className="run-grid">
        <Section title="Scoreboard · same rules for everyone">
          <table className="score-table">
            <thead><tr><th /><th>points</th><th>per proposal</th><th>proposals</th><th>said yes</th><th>meetings</th><th>enjoyment</th><th>precision</th><th>unsafe</th></tr></thead>
            <tbody>
              {g.scores.map(r => (
                <tr key={r.source} className={r.source === "player" ? "me" : ""}>
                  <td><b>{r.label}</b>{r.source === "player" && g.lensUsed ? <Badge tone="warn">assisted</Badge> : null}</td>
                  <td>{num(r.points)}</td><td>{r.perProposal.toFixed(1)}</td><td>{r.proposals}</td><td>{r.accepted}</td><td>{r.meetings}</td>
                  <td>{r.meetings ? pct(r.meanEnjoyment) : "–"}</td><td>{r.proposals ? pct(r.precision) : "–"}</td><td className={r.unsafe ? "bad" : ""}>{r.unsafe}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="small muted">+10 per yes · −2 per no · +100 × enjoyment per meeting · −15 per no-show · −150 per unsafe intro (minor, adversarial, exes, romance mismatch) · −25 per oracle peek.</div>
        </Section>
        <Section title="Missions">
          <div className="missions">
            {g.missions.map(m => (
              <div key={m.id} className={m.done ? "mission done" : "mission"}>
                <span className="check">{m.done ? "✓" : "○"}</span>
                <div><b>{m.title}</b><div className="small muted">{m.description}</div><div className="small">{m.progress}</div></div>
              </div>
            ))}
          </div>
        </Section>
        <Levels />
        <Section title="Your run">
          <div className="kpis compact">
            <Kpi label="sparks left today" value={`${g.sparksLeft}/${g.sparksPerDay}`} />
            <Kpi label="safety strikes" value={`${g.strikes}/${g.maxStrikes}`} tone={g.strikes ? "bad" : "good"} />
            <Kpi label="oracle peeks" value={g.peeks} />
            <Kpi label="opponent" value={g.engine} />
          </div>
          {g.over && <div className="callout bad">Game over: three safety strikes.</div>}
          <div className="actions">
            <label className="small">seed <input type="number" value={resetSeed} onChange={e => setResetSeed(Number(e.target.value))} className="input tiny" /></label>
            <button className="btn" onClick={() => store.control({ type: "reset", seed: resetSeed, engine: "engine-v1" })}>New world vs engine-v1</button>
            <button className="btn" onClick={() => store.control({ type: "reset", seed: resetSeed, engine: "random" })}>vs random baseline</button>
            <button className="btn" onClick={() => store.control({ type: "reset", seed: resetSeed, engine: "off" })}>Solo (no engine)</button>
          </div>
        </Section>
      </div>
    </div>
  );
}
