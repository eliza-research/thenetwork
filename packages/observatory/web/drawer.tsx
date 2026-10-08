// Bottom drawer: review queue, live feed, opportunity pipeline (with the consent ladder), requests,
// matching runs (and run diff), safety, metrics, the simulation lab, configuration and the game. Every
// list goes through the store's filter and focus predicates. Tabs and controls follow the staff role.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { EngineRunSummary, ObsFeedItem } from "../src/types.ts";
import { EDGE_STYLE } from "./graph.ts";
import { Config, Growth, Lab, Requests, RunDiffView, SafetyCases, Scorecard } from "./admin.tsx";
import { Levels } from "./network.tsx";
import { stateLabel } from "./panels.tsx";
import { ReviewQueue } from "./review.tsx";
import {
  COLUMNS, DAY, DRAWER_TABS, OPEN, originLabel, originOf, stateGroupOf, store, useStore, type DrawerTab, type FilterKey, type Opp,
} from "./store.ts";
import { Badge, Bars, Components, dur, humanize, Kpi, Lorenz, MemberLink, num, pct, Section, shortDate, stamp } from "./ui.tsx";

export const TAB_LABEL: Record<DrawerTab, string> = {
  review: "Review", feed: "Feed", pipeline: "Pipeline", requests: "Requests", engine: "Runs", safety: "Safety", metrics: "Metrics", lab: "Lab", config: "Config", game: "Game",
};
/** Which global filters apply to each drawer tab (the filter bar dims the others). */
const APPLIES: Record<DrawerTab, FilterKey[]> = {
  review: ["borough", "members", "origin"],
  feed: ["range", "borough", "members", "origin"],
  pipeline: ["range", "borough", "members", "origin", "stateGroup"],
  engine: ["range"],
  safety: ["range", "borough", "members"],
  metrics: ["range", "borough", "origin"],
  requests: ["range", "borough", "members"],
  lab: [],
  config: [],
  game: [],
};
export const filterApplies = (tab: DrawerTab, k: FilterKey) => APPLIES[tab].includes(k);

export function Drawer() {
  const s = useStore();
  const game = !!s.env?.capabilities.canIntervene;
  const showReview = s.showReviewTab();
  const show: Partial<Record<DrawerTab, boolean>> = {
    review: showReview, game, requests: s.requests.length > 0 || s.network?.kind === "consent",
    lab: s.can("analyst") && !s.realOnly(), config: s.can("analyst"),
  };
  const tabs = DRAWER_TABS.filter(t => show[t] ?? true);
  const tab = tabs.includes(s.ui.drawer) ? s.ui.drawer : "feed";
  const now = s.now();
  const queued = [...s.opps.values()].filter(o => o.state === "IN_REVIEW");
  const dueSoon = queued.some(o => o.review && o.review.deadline - now < 3_600_000);
  return (
    <div className={`drawer ${s.ui.drawerOpen ? "open" : ""}`}>
      <div className="drawer-tabs">
        {tabs.map(t => (
          <button key={t} className={tab === t && s.ui.drawerOpen ? "tab active" : "tab"} onClick={() => store.setUI({ drawer: t, drawerOpen: tab !== t || !s.ui.drawerOpen })}>
            {TAB_LABEL[t]}
            {t === "review" && <span className={`count ${dueSoon ? "warn" : ""}`}> {s.network?.review?.queued ?? queued.length}</span>}
            {t === "game" && s.game ? ` · ${s.game.scores.find(x => x.source === "player")?.points ?? 0} pts` : ""}
          </button>
        ))}
        <span className="spacer" />
        <button className="tab" aria-label={s.ui.drawerOpen ? "Collapse" : "Expand"} onClick={() => store.setUI({ drawerOpen: !s.ui.drawerOpen })}>{s.ui.drawerOpen ? "▾" : "▴"}</button>
      </div>
      {s.ui.drawerOpen && (
        <div className="drawer-body">
          {tab === "review" && <ReviewQueue />}
          {tab === "feed" && <Feed />}
          {tab === "pipeline" && <Pipeline />}
          {tab === "requests" && <Requests />}
          {tab === "lab" && <Lab />}
          {tab === "config" && <Config />}
          {tab === "engine" && <Engine />}
          {tab === "safety" && <Safety />}
          {tab === "metrics" && <Metrics />}
          {tab === "game" && <Game />}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- feed
type Seg = "all" | "people" | "safety" | "system" | "mine";
const PEOPLE = new Set(["accept", "decline", "meeting", "outcome", "feedback", "proposal", "message", "join", "invite", "probe", "request", "growth"]);
const SAFETY = new Set(["block", "opt_out", "adversarial", "invariant", "error", "trust"]);
const SYSTEM = new Set(["engine", "skip", "scenario", "game", "review"]);

/** Feed text with the members' names as focus links. */
function Linked({ x }: { x: ObsFeedItem }) {
  const ids = (x.members ?? []).filter(id => store.members.has(id)).slice(0, 8);
  if (!ids.length) return <>{x.text}</>;
  const byName = new Map<string, string>();
  for (const id of ids) { const n = store.members.get(id)!.name; byName.set(n, id); if (!byName.has(n.split(" ")[0]!)) byName.set(n.split(" ")[0]!, id); }
  const re = new RegExp(`(${[...byName.keys()].sort((a, b) => b.length - a.length).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  const parts = x.text.split(re);
  const out: ReactNode[] = parts.map((p, i) => {
    const id = byName.get(p);
    if (!id || i % 2 === 0) return p;
    return <MemberLink key={i} id={id}>{p}</MemberLink>;
  });
  return <>{out}</>;
}

function Feed() {
  const s = useStore();
  const [seg, setSeg] = useState<Seg>("all");
  const game = !!s.env?.capabilities.canIntervene;
  const segs: [Seg, string][] = [["all", "All"], ["people", "People"], ["safety", "Safety"], ["system", "System"], ...(game ? [["mine", "Mine"]] as [Seg, string][] : [])];
  const inSeg = (x: ObsFeedItem) => seg === "all" ? x.kind !== "join" || s.feed.length < 60
    : seg === "people" ? PEOPLE.has(x.kind)
    : seg === "safety" ? SAFETY.has(x.kind)
    : seg === "system" ? SYSTEM.has(x.kind as string)
    : x.kind === "game" || (!!x.opportunityId && s.opps.get(x.opportunityId)?.source === "player");
  const items = s.feed.filter(x => inSeg(x) && s.matchFeed(x) && s.focusFeed(x)).slice(-150).reverse();
  const open = (x: ObsFeedItem) => {
    if (x.opportunityId && s.opps.has(x.opportunityId)) store.focus({ kind: "opportunity", id: x.opportunityId });
    else if (x.members?.[0]) store.focus({ kind: "member", id: x.members[0] });
  };
  return (
    <div className="feed">
      <div className="filters">
        <div className="seg" role="radiogroup" aria-label="Feed">{segs.map(([k, l]) => <button key={k} className={seg === k ? "active" : ""} onClick={() => setSeg(k)}>{l}</button>)}</div>
      </div>
      <div className="feed-list">
        {items.map(x => (
          <div key={x.seq} role="button" tabIndex={0} className={`feed-item sev-${x.severity ?? "info"}`} onClick={() => open(x)} onKeyDown={e => { if (e.key === "Enter") open(x); }}>
            <span className="feed-time">{stamp(x.t)}</span>
            <span className="feed-kind">{humanize(x.kind)}</span>
            <span className="feed-text"><Linked x={x} /></span>
          </div>
        ))}
        {!items.length && <div className="muted small pad">{!s.feed.length ? (s.env?.capabilities.canStep ? "Nothing yet. Press play." : "No events in range.") : s.ui.focus ? s.nothing() : s.env?.capabilities.canStep ? s.nothing() : "No events in range."}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- pipeline
function Ladder() {
  const s = useStore();
  const n = s.network;
  if (!n) return null;
  if (n.kind === "stub") return <div className="muted small">Stub network: no consent data.</div>;
  const c = (k: string) => n.counters[k] ?? 0;
  const rate = (a: number, b: number) => (b ? pct(a / b) : "–");
  const candidates = c("engineProposals"), passed = candidates - (c("gatedOut") - (n.gateReasons.daily_cap ?? 0));
  const answered = c("probeYes") + c("probeNo") + c("probeExpired");
  const rv = n.review;
  const steps: [string, number, string][] = [
    ["candidates", candidates, "Engine candidates"],
    ["passed gate", passed, `${rate(passed, candidates)} passed the skeptical gate`],
    ...(rv ? [
      ["in review", rv.queued, "Waiting for a reviewer now"],
      ["approved", rv.approved, `${rv.rejected} rejected · ${rv.expired} expired unsent`],
    ] as [string, number, string][] : []),
    ["probed", c("probesSent"), "Anonymous availability checks sent"],
    ["probe yes", c("probeYes"), `Probe yes rate ${rate(c("probeYes"), answered)} · ${c("probeExpired")} unanswered`],
    ["revealed", c("oppsRevealed"), `Invite yes rate ${rate(c("revealYes"), c("reveals"))} · ${c("replacements")} alternates swapped in`],
    ["everyone yes", c("oppsAllYes"), `Everyone-yes rate ${rate(c("oppsAllYes"), c("oppsRevealed"))}`],
    ["scheduled", c("scheduled"), `${rate(c("scheduled"), c("oppsAllYes"))} of everyone-yes`],
    ["met", s.stats?.meetingsHeld ?? 0, `${rate(s.stats?.meetingsHeld ?? 0, c("scheduled"))} of scheduled`],
  ];
  return (
    <div className="ladder" aria-label="Consent ladder">
      {steps.map(([k, v, t], i) => <span key={k} title={t}>{i > 0 && <span className="muted"> → </span>}{k} <b>{num(v)}</b></span>)}
    </div>
  );
}

function Pipeline() {
  const s = useStore();
  const f = s.ui.focus;
  const sg = s.ui.filters.stateGroup;
  const opps = [...s.opps.values()].filter(o => s.matchOpp(o) && (f?.kind === "opportunity" || s.focusOpp(o)));
  const cols = COLUMNS.filter(c => sg === "all" || stateGroupOf(c.states[0]!) === sg);
  const rv = s.network?.review;
  return (
    <div className="pipeline">
      <Ladder />
      <div className="kanban" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(150px, 1fr))` }}>
        {cols.map(c => {
          const list = opps.filter(o => c.states.includes(o.state)).sort((a, b) => b.updatedAt - a.updatedAt);
          const oldest = c.id === "met" || c.id === "closed" ? undefined : Math.min(...list.map(o => o.stateSince ?? o.updatedAt));
          const focused = f?.kind === "opportunity" ? list.find(o => o.id === f.id) : undefined;
          const shown = list.slice(0, 30);
          if (focused && !shown.includes(focused)) shown.unshift(focused);
          return (
            <div className="kcol" key={c.id}>
              <div className="kcol-head"><span>{c.title}</span>{oldest !== undefined && Number.isFinite(oldest) && <span className="muted small" title="Longest time in this column">oldest {dur(Math.max(0, s.now() - oldest))}</span>}<b>{num(list.length)}</b></div>
              {c.id === "closed" && list.length > 0 && <div className="small muted">{Object.entries(count(list, o => o.state)).map(([k, v]) => `${humanize(k)} ${v}`).join(" · ")}</div>}
              {c.id === "review" && rv && <div className="small muted" title="Review decisions so far">approved {rv.approved} · rejected {rv.rejected} · expired {rv.expired}</div>}
              <div className="kcards">{shown.map(o => <OppCard key={o.id} o={o} focused={o.id === focused?.id} />)}</div>
            </div>
          );
        })}
      </div>
      {!opps.length && <div className="muted small pad">{s.nothing()}</div>}
    </div>
  );
}
function OppCard({ o, focused }: { o: Opp; focused: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (focused) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [focused]);
  const closed = !OPEN.has(o.state);
  const inState = store.now() - (o.stateSince ?? o.updatedAt);
  return (
    <button ref={ref} className={`kcard src-${o.source} ${focused ? "focused" : ""}`} onClick={() => store.focus({ kind: "opportunity", id: o.id })}>
      <div className="kcard-title">{store.oppTitle(o)}</div>
      <div className="kcard-meta">{originLabel(originOf(o))}{closed ? ` · ${o.reason ? humanize(o.reason) : stateLabel(o.state).toLowerCase()}` : ` · ${dur(Math.max(0, inState))}`}</div>
    </button>
  );
}
const count = <T,>(xs: T[], f: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => { m[f(x)] = (m[f(x)] ?? 0) + 1; return m; }, {});

// ---------------------------------------------------------------- runs
function Engine() {
  const s = useStore();
  const f = s.ui.focus;
  const runs = s.runs.filter(r => s.inRange(r.at) && s.focusRun(r)).reverse();
  const [sel, setSel] = useState<string>();
  /** Compare mode: up to two runs picked for a diff. */
  const [cmp, setCmp] = useState<string[] | null>(null);
  const focusRunId = f?.kind === "opportunity" ? s.opps.get(f.id)?.runId : undefined;
  const run = runs.find(r => r.id === (focusRunId ?? sel)) ?? runs.find(r => r.id === sel) ?? runs[0];
  if (!run) return <div className="muted small pad">{s.runs.length ? s.nothing() : "No runs yet."}</div>;
  const pick = (id: string) => setCmp(c => (c ?? []).includes(id) ? c!.filter(x => x !== id) : [...(c ?? []), id].slice(-2));
  const pair = cmp?.length === 2 ? cmp.map(id => s.runs.find(r => r.id === id)!).filter(Boolean).sort((a, b) => a.at - b.at) : [];
  return (
    <div className="engine">
      <div className="run-list">
        {runs.length > 1 && (
          <button className={cmp ? "btn active" : "btn"} onClick={() => setCmp(cmp ? null : [])} title="Pick two runs to compare">{cmp ? "Close compare" : "Compare two"}</button>
        )}
        {runs.map(r => cmp ? (
          <label key={r.id} className={cmp.includes(r.id) ? "run active" : "run"}>
            <input type="checkbox" checked={cmp.includes(r.id)} onChange={() => pick(r.id)} /> {stamp(r.at)} <span className="muted">· {r.proposals} proposals{r.shadow ? " · shadow" : ""}</span>
          </label>
        ) : (
          <button key={r.id} className={r.id === run.id ? "run active" : "run"} onClick={() => setSel(r.id)}>
            {stamp(r.at)} <span className="muted">· {r.proposals} proposals{r.shadow ? " · shadow" : ""}</span>
          </button>
        ))}
      </div>
      {pair.length === 2 ? <RunDiffView a={pair[0]!.id} b={pair[1]!.id} /> : cmp ? <div className="muted small pad">Pick two runs.</div> : <RunDetail run={run} />}
    </div>
  );
}
function RunDetail({ run }: { run: EngineRunSummary }) {
  const s = useStore();
  const f = run.funnel;
  const funnel: [string, number][] = [["candidates generated", f.generated], ["passed hard filters", f.passedHardFilters], ["after dedupe", f.passedHardFilters - f.deduped], ["eligible (above threshold)", f.eligible], ["selected", f.selected]];
  const focus = s.ui.focus;
  const focusOpp = focus?.kind === "opportunity" ? s.opps.get(focus.id) : undefined;
  const key = (ids: string[]) => [...ids].sort().join("|");
  const hl = (ps: string[]) => (focus?.kind === "member" && ps.includes(focus.id)) || (!!focusOpp && key(ps) === key(focusOpp.participants));
  const gates = s.network?.gateReasons;
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
        {gates && Object.keys(gates).length > 0 && (
          <Section title="Gate reasons">
            <Bars data={gates} color="#ff8f66" limit={10} />
          </Section>
        )}
        <Section title="Fairness of exposure">
          <div className="fair">
            <Lorenz points={run.fairness.lorenz} />
            <div className="kpis compact">
              <Kpi label="gini" value={run.fairness.gini.toFixed(2)} title="Gini of proposal exposure across eligible members" />
              <Kpi label="top 10% share" value={pct(run.fairness.top10Share)} title="Share of proposals that went to the top 10% of members" />
              <Kpi label="no proposal" value={pct(run.fairness.zeroExposureShare)} title="Eligible members with no proposal" />
              <Kpi label="newcomer coverage" value={pct(run.fairness.newcomerCoverage)} title="Newcomers who got at least one proposal" />
            </div>
          </div>
          <div className="small muted">{run.emptyStates} intents with nothing: {Object.entries(run.emptyStatesByReason).map(([k, v]) => `${humanize(k)} ${v}`).join(" · ") || "none"}</div>
        </Section>
      </div>
      <Section title="Top configurations">
        <div className="top-table">
          {run.top.slice(0, 16).map(t => (
            <details key={t.key} className={`top-row ${t.selected ? "selected" : ""} ${hl(t.participants) ? "hl" : ""}`}>
              <summary>
                <span className="top-score">{t.score.toFixed(3)}</span>
                <span>{t.participants.map((p, i) => <span key={p}>{i > 0 && " · "}<MemberLink id={p} first /></span>)}</span>
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

// ---------------------------------------------------------------- safety
const SAFETY_FEED = new Set(["block", "opt_out", "adversarial", "invariant", "trust"]);
function Safety() {
  const s = useStore();
  const st = s.stats;
  const j = s.judge();
  const members = [...s.members.values()].filter(m => s.matchMember(m));
  const flagged = members.filter(m => m.trust === "watch" || m.trust === "hold")
    .filter(m => !s.ui.focus || s.ui.focus.kind !== "member" || m.id === s.ui.focus.id)
    .filter(m => s.ui.focus?.kind !== "neighborhood" || m.area === s.ui.focus.id);
  const events = s.feed.filter(x => SAFETY_FEED.has(x.kind) && s.matchFeed(x) && s.focusFeed(x)).slice(-100).reverse();
  const last = (id: string) => [...s.feed].reverse().find(x => (SAFETY_FEED.has(x.kind) || x.kind === "error") && x.members?.includes(id));
  const violations = j?.invariants ?? st?.invariantViolations ?? 0;
  const abuse = s.network?.counters.abuse;
  return (
    <div className="safety">
      <div className="kpis">
        {abuse !== undefined && <Kpi label="abuse handled" value={num(abuse)} title="Spam, sales, money asks, contact extraction, prompt injection and pressure, refused and scored" />}
        <Kpi label="on watch" value={num(members.filter(m => m.trust === "watch").length)} tone={members.some(m => m.trust === "watch") ? "warn" : undefined} onClick={() => store.setFilters({ members: "watch" })} />
        <Kpi label="on hold" value={num(members.filter(m => m.trust === "hold").length)} tone={members.some(m => m.trust === "hold") ? "bad" : undefined} onClick={() => store.setFilters({ members: "hold" })} />
        <Kpi label="blocks" value={num(st?.blocks ?? 0)} />
        <Kpi label="opt-outs" value={num(st?.optOuts ?? 0)} tone={st?.optOuts ? "warn" : undefined} />
        <Kpi label="invariant violations" value={num(violations)} tone={violations ? "bad" : "good"} title={j ? "Judge-derived count" : "Counted by the observatory"} />
        {j && <Kpi label="canary leaks" value={num(j.canaryLeaks)} tone={j.canaryLeaks ? "bad" : "good"} title="Judge-derived: planted private facts that reached another member" />}
        {j && <Kpi label="minor contacts" value={num(j.minorContacts)} tone={j.minorContacts ? "bad" : "good"} title="Judge-derived: members under 18 contacted about another member" />}
      </div>
      <div className="run-grid">
        <Section title={`Watch and hold (${flagged.length})`}>
          {flagged.length ? flagged.slice(0, 50).map(m => {
            const e = last(m.id);
            return (
              <div className="attn" key={m.id}>
                <MemberLink id={m.id} />{m.trust === "hold" ? <Badge tone="bad">Hold</Badge> : <Badge tone="warn">Watch</Badge>}
                <span className="muted small ellipsis">{e ? `${shortDate(e.t)} · ${e.text}` : ""}</span>
              </div>
            );
          }) : <div className="muted small">{s.nothing()}</div>}
        </Section>
        {j?.byRule && Object.keys(j.byRule).length > 0 && <Section title="Violations by rule"><Bars data={j.byRule} color="#ff5468" /></Section>}
        {!s.can("safety") && <Section title="Safety events">
          <div className="feed-list">
            {events.map(x => (
              <div key={x.seq} className={`feed-item sev-${x.severity ?? "info"}`}>
                <span className="feed-time">{stamp(x.t)}</span><span className="feed-kind">{humanize(x.kind)}</span><span className="feed-text"><Linked x={x} /></span>
              </div>
            ))}
            {!events.length && <div className="muted small">{s.nothing()}</div>}
          </div>
        </Section>}
      </div>
      {s.can("safety") && <SafetyCases />}
    </div>
  );
}

// ---------------------------------------------------------------- metrics
function Metrics() {
  const s = useStore();
  const st = s.stats;
  if (!st) return null;
  const weeks = Math.max(1 / 7, ((s.clock?.now ?? 0) - (s.clock?.start ?? 0)) / (7 * DAY));
  const game = !!s.env?.capabilities.hiddenTruth;
  const n = s.network;
  const learned = ["introduced", "met", "enjoyed", "would_interact_again", "avoid", "blocked"];
  const proactive = st.proactive / Math.max(1, st.joined) / weeks;
  const showDen = st.attended + st.noShows + st.cancelledWithNotice;
  const c = (k: string) => n?.counters[k] ?? 0;
  const inviteYes = n?.kind === "consent" ? (c("reveals") ? c("revealYes") / c("reveals") : 0) : st.invites ? st.accepts / st.invites : 0;
  const byOrigin: Record<string, number> = {};
  for (const o of s.opps.values()) if (o.source !== "shadow" && s.inRange(o.createdAt) && s.matchOpp(o, { range: true, members: true, stateGroup: true })) { const k = originLabel(originOf(o)); byOrigin[k] = (byOrigin[k] ?? 0) + 1; }
  const byState: Record<string, number> = {};
  for (const m of s.members.values()) if (s.inBorough(m)) byState[m.state] = (byState[m.state] ?? 0) + 1;
  return (
    <div className="metrics">
      <div className="kpis">
        <Kpi label="messages / member / week" value={(st.messages / Math.max(1, st.joined) / weeks).toFixed(1)} />
        <Kpi label="proactive / member / week" value={proactive.toFixed(2)} tone={proactive > 2 ? "warn" : undefined} title="Budget: normal ≤ 2 proactive messages per member per week" />
        <Kpi label="invite yes rate" value={pct(inviteYes)} title={n?.kind === "consent" ? "Yes answers to revealed invitations" : "Accepts per invite sent"} />
        <Kpi label={`show rate · ${st.noShows} no-shows · ${st.cancelledWithNotice} with notice`} value={pct(showDen ? st.attended / showDen : 0)} />
        <Kpi label="mean enjoyment" value={st.enjoymentN ? pct(st.enjoymentSum / st.enjoymentN) : "–"} />
        <Kpi label="members who met someone" value={num([...s.members.values()].filter(m => m.counters.meetings > 0).length)} />
        {game && <Kpi label="precision (truth)" value={pct(st.oracleJudged ? st.compatible / st.oracleJudged : 0)} title="Proposals the hidden truth says were truly compatible" />}
        {game && <Kpi label="unsafe" value={num(st.unsafe)} tone={st.unsafe ? "bad" : "good"} title="Proposals the hidden truth says were unsafe" />}
        <Kpi label="opt-outs" value={num(st.optOuts)} tone={st.optOuts ? "warn" : undefined} />
      </div>
      {n?.kind === "consent" && (
        <div className="small metric-lines">
          <div>requests {num(n.requests.total)} · fulfilled {num(n.requests.fulfilled)} · plans {num(n.requests.plans)}</div>
          {!st.growth && <div>growth asks {num(c("growthAsks"))} · invites {num(c("invitesSent"))} · joined {num(c("inviteesJoined"))}</div>}
        </div>
      )}
      <div className="run-grid">
        {st.scorecard && <Section title="Scorecard (PRD 28.2)"><Scorecard rows={st.scorecard} /></Section>}
        <Growth />
      </div>
      <div className="run-grid">
        <Section title="Proposals by origin"><Bars data={byOrigin} label={k => k} /></Section>
        <Section title="Relationships learned"><Bars data={Object.fromEntries(learned.map(k => [k, st.edgesByType[k] ?? 0]))} color={k => EDGE_STYLE[k]?.color ?? "#888"} /></Section>
        <Section title="Members by state"><Bars data={byState} /></Section>
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
  const mode = s.reviewMode();
  return (
    <div className="game">
      <div className="run-grid">
        <Section title="Scoreboard">
          <table className="score-table">
            <thead><tr><th /><th title="+10 per yes · −2 per no · +100 × enjoyment per meeting · −15 per no-show · −150 per unsafe intro (minor, adversarial, exes, romance mismatch) · −25 per oracle peek">points</th><th>per proposal</th><th>proposals</th><th>said yes</th><th>meetings</th><th>enjoyment</th><th>precision</th><th>unsafe</th></tr></thead>
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
          </div>
          {g.over && <div className="callout bad">Game over: three safety strikes.</div>}
          {mode && s.isAdmin() && (
            <div className="actions">
              <div className="seg" role="radiogroup" aria-label="Reviewer" title="Who approves network-composed opportunities before anyone is contacted. You: they queue in the Review tab.">
                <span className="muted small">Reviewer</span>
                <button className={mode === "auto" ? "active" : ""} onClick={() => store.control({ type: "review_mode", mode: "auto" })}>Sim</button>
                <button className={mode === "human" ? "active" : ""} onClick={() => store.control({ type: "review_mode", mode: "human" })}>You</button>
              </div>
            </div>
          )}
          {s.isAdmin() && <div className="actions">
            <label className="small">seed <input type="number" value={resetSeed} onChange={e => setResetSeed(Number(e.target.value))} className="input tiny" /></label>
            <button className="btn" onClick={() => store.control({ type: "reset", seed: resetSeed, engine: "engine-v1" })}>New world vs engine-v1</button>
            <button className="btn" onClick={() => store.control({ type: "reset", seed: resetSeed, engine: "random" })}>vs random baseline</button>
            <button className="btn" onClick={() => store.control({ type: "reset", seed: resetSeed, engine: "off" })}>Solo (no engine)</button>
          </div>}
        </Section>
      </div>
    </div>
  );
}
