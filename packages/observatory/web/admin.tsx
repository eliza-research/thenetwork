// Admin-console panels that call their own endpoints: safety cases and the minor-safety view,
// member requests, the PRD 28.2 scorecard and growth, the configuration (matching switch, history,
// audit log), the simulation lab and run diff. Each one checks the role before it shows a control;
// the server checks it again.
import { useEffect, useState, type ReactNode } from "react";
import type { AuditEntry, ConfigInfo, DiffNum, EngineRunSummary, LabArm, LabRun, ObsRequest, ObsSafetyCase, RunDiff, SafetyAction, SafetyInfo, SafetyReport, ScoreMetric } from "../src/types.ts";
import { store, useStore } from "./store.ts";
import { Badge, Countdown, dur, humanize, Kpi, MemberLink, num, OppLink, pct, Section, stamp } from "./ui.tsx";

/** Load from an endpoint on mount, when `key` changes, and every `everyMs` (0: never). */
function useFetch<T>(load: () => Promise<{ data?: T; status: number; error?: string }>, key: unknown, everyMs = 0) {
  const [d, setD] = useState<{ data?: T; status: number; error?: string }>();
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    const run = () => load().then(x => { if (live) setD(x); });
    run();
    const h = everyMs ? setInterval(run, everyMs) : undefined;
    return () => { live = false; if (h) clearInterval(h); };
  }, [key, n, everyMs]);
  return { ...d, reload: () => setN(x => x + 1) };
}
const Err = ({ status, error }: { status?: number; error?: string }) =>
  status === undefined ? <div className="muted small">Loading…</div> : <div className="muted small">{status === 403 ? "Your role cannot see this." : error}</div>;

// ---------------------------------------------------------------- safety console (gap 7)
/** Cases (urgent first), evidence events and lift/close actions; the minor-safety view. Safety and admin only. */
export function SafetyCases() {
  const s = useStore();
  const r = useFetch<SafetyInfo>(() => store.safety(), `${s.mode}|${s.network?.trust.hold}|${s.network?.trust.watch}|${s.stats?.blocks}`, 10_000);
  const [show, setShow] = useState<"open" | "all">("open");
  const info = r.data;
  if (!info) return <Err {...r} />;
  const f = s.ui.focus;
  const cases = info.cases
    .filter(c => show === "all" || c.status !== "closed")
    .filter(c => f?.kind !== "member" || c.memberId === f.id)
    .filter(c => { const m = s.members.get(c.memberId); return !m || s.inBorough(m); });
  const minors = info.minors;
  const reports = (info.reports ?? []).filter(x => show === "all" || x.status === "open").filter(x => f?.kind !== "member" || x.subjectId === f.id || x.reporterId === f.id);
  return (
    <div className="run-grid">
      {info.reports && (
        <Section title={`Reports after a date (${reports.length})`}>
          {reports.length ? reports.slice(0, 80).map(x => <ReportRow key={x.id} r={x} canBan={!!info.canBan} onDone={r.reload} />) : <div className="muted small">{s.nothing()}</div>}
          {!info.canBan && <div className="muted small">Hold and ban by phone or person go to the Network service (real mode with NETWORK_SERVICE_URL).</div>}
        </Section>
      )}
      <Section title={`Cases (${cases.length})`} right={
        <div className="seg" role="radiogroup" aria-label="Cases">
          <button className={show === "open" ? "active" : ""} onClick={() => setShow("open")}>Open</button>
          <button className={show === "all" ? "active" : ""} onClick={() => setShow("all")}>All</button>
        </div>
      }>
        {cases.length ? cases.slice(0, 80).map(c => <CaseRow key={c.id} c={c} canAct={info.canAct} onDone={r.reload} />) : <div className="muted small">{s.nothing()}</div>}
        {!info.canAct && <div className="muted small">Read-only here: real mode acts through the Network service (set NETWORK_SERVICE_URL and NETWORK_SERVICE_TOKEN).</div>}
      </Section>
      <Section title="Minor safety">
        <div className="small">{num(minors.members.length)} members under 18 · {num(minors.unknownAge.length)} with no valid age (treated as under 18) · never matched</div>
        {minors.inOpportunities.length
          ? minors.inOpportunities.map(x => (
            <div className="attn bad" key={`${x.opportunityId}${x.memberId}`}><MemberLink id={x.memberId} /> in {s.opps.has(x.opportunityId) ? <OppLink o={s.opps.get(x.opportunityId)!} /> : x.opportunityId} <span className="muted small">· {humanize(x.state)}</span></div>
          ))
          : <div className="small good-text">None in any open multi-person opportunity.</div>}
        {minors.members.length > 0 && <div className="people">{minors.members.slice(0, 40).map(id => <MemberLink key={id} id={id} />)}</div>}
        {minors.unknownAge.length > 0 && <div className="people"><span className="muted small">Age unknown:</span> {minors.unknownAge.slice(0, 40).map(id => <MemberLink key={id} id={id} />)}</div>}
      </Section>
    </div>
  );
}

function CaseRow({ c, canAct, onDone }: { c: ObsSafetyCase; canAct: boolean; onDone(): void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (a: "lift" | "close") => {
    setBusy(true);
    const r = await store.safetyAction(a === "lift" ? { action: "lift", memberId: c.memberId, note: note.trim() || undefined } : { action: "close", caseId: c.id, note: note.trim() || undefined });
    setBusy(false);
    const res = r.data;
    if (res?.ok) { store.toast(a === "lift" ? `Hold lifted · ${c.memberName}` : `Case closed · ${c.memberName}`, "good"); setNote(""); onDone(); }
    else store.toast(res?.error ?? r.error ?? "refused", "bad");
  };
  const closed = c.status === "closed";
  return (
    <div className={`case ${open ? "open" : ""}`}>
      <button type="button" className="case-head" onClick={() => setOpen(!open)}>
        {c.urgent && !closed && <Badge tone="bad" title="Harassment, scams, contact extraction or a hold: 1-hour target">urgent</Badge>}
        <span className="case-name">{c.memberName}</span>
        <Badge tone={c.level === "hold" ? "bad" : c.level === "watch" ? "warn" : "neutral"}>{c.level}</Badge>
        <span className="muted small">{c.status} · opened {stamp(c.opened)} · {c.events.length} event{c.events.length === 1 ? "" : "s"}</span>
        <span className="spacer" />
        {!closed && (c.overdue ? <span className="countdown bad">overdue</span> : <Countdown deadline={c.dueAt} prefix="due in " />)}
        {closed && c.closedAt && <span className="muted small">closed {stamp(c.closedAt)}{c.closedBy ? ` by ${c.closedBy.replace(/^token:/, "")}` : ""}</span>}
      </button>
      {open && (
        <div className="case-body">
          {c.events.map((e, i) => (
            <div className="small" key={i}>
              <span className="muted">{stamp(e.at)}</span> {humanize(e.kind)} <span className="muted">· {e.points > 0 ? "+" : ""}{e.points} pts</span>
              {e.by && <> · by <MemberLink id={e.by} /></>}
            </div>
          ))}
          <div className="review-actions">
            <MemberLink id={c.memberId}>Open timeline →</MemberLink>
            {canAct && store.can("safety") && !closed && (
              <>
                <input className="input grow" placeholder="Decision note" value={note} onChange={e => setNote(e.target.value)} />
                {(c.level === "hold" || c.status === "held") && <button className="btn" disabled={busy} onClick={() => act("lift")}>Lift hold</button>}
                <button className="btn" disabled={busy} onClick={() => act("close")}>Close case</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** One post-date report: what kind, who reported whom, after which date; hold or ban the person (by phone or by person), or dismiss. */
function ReportRow({ r, canBan, onDone }: { r: SafetyReport; canBan: boolean; onDone(): void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const s = useStore();
  const act = async (a: SafetyAction, done: string) => {
    setBusy(true);
    const res = await store.safetyAction(a);
    setBusy(false);
    if (res.data?.ok) { store.toast(done, "good"); setNote(""); onDone(); } else store.toast(res.data?.error ?? res.error ?? "refused", "bad");
  };
  const n = note.trim(), ok = n.length >= 5 && !busy;
  return (
    <div className={`case ${open ? "open" : ""}`}>
      <button type="button" className="case-head" onClick={() => setOpen(!open)}>
        {r.urgent && r.status === "open" && <Badge tone="bad" title="Harassment, unsafe, scam or a minor: 1-hour target">urgent</Badge>}
        <Badge tone={r.kind === "harassment" || r.kind === "unsafe" ? "bad" : "warn"}>{humanize(r.kind)}</Badge>
        <span className="case-name">{s.members.get(r.subjectId)?.name ?? r.subjectId}</span>
        <span className="muted small">{r.status} · {stamp(r.at)}{r.priorReports ? ` · ${r.priorReports} earlier report${r.priorReports > 1 ? "s" : ""}` : ""}</span>
        <span className="spacer" />
        {r.status === "open" && (r.overdue ? <span className="countdown bad">overdue</span> : <Countdown deadline={r.dueAt} prefix="due in " />)}
      </button>
      {open && (
        <div className="case-body">
          <div className="small">Reported <MemberLink id={r.subjectId} /> · by <MemberLink id={r.reporterId} />{r.opportunityId && <> · after {s.opps.has(r.opportunityId) ? <OppLink o={s.opps.get(r.opportunityId)!} /> : r.opportunityId}</>}</div>
          {canBan && store.can("safety") && r.status === "open" && (
            <div className="review-actions">
              <input className="input grow" placeholder="Decision note (logged, at least 5 characters)" value={note} onChange={e => setNote(e.target.value)} />
              <button className="btn" disabled={!ok} title="Hold the person on every app until a review" onClick={() => act({ action: "hold", memberId: r.subjectId, note: n, reportId: r.id }, "Person held on every app")}>Hold</button>
              <button className="btn" disabled={!ok} title="This phone number can never join again" onClick={() => act({ action: "ban", memberId: r.subjectId, by: "phone", note: n, reportId: r.id }, "Banned by phone")}>Ban phone</button>
              <button className="btn" disabled={!ok} title="Every phone of this person, on every app" onClick={() => act({ action: "ban", memberId: r.subjectId, by: "person", note: n, reportId: r.id }, "Banned by person")}>Ban person</button>
              <button className="btn ghost" disabled={!ok} onClick={() => act({ action: "dismiss", reportId: r.id, note: n }, "Report dismissed")}>Dismiss</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- requests (gap 13)
type ReqSeg = "all" | "open" | "fulfilled" | "none" | "answered";
const OUTCOME_TONE: Record<ObsRequest["outcome"], string> = { probing: "info", open: "warn", fulfilled: "good", booked: "good", none: "neutral", answered: "good" };
/** Member requests: what was asked for (never the member's words), the outcome, tries and age. */
export function Requests() {
  const s = useStore();
  const [seg, setSeg] = useState<ReqSeg>("open");
  const f = s.ui.focus;
  const isOpen = (r: ObsRequest) => r.outcome === "probing" || r.outcome === "open";
  const scoped = s.requests.filter(r => {
    const m = s.members.get(r.memberId);
    if (m && !s.matchMember(m)) return false;
    if (!isOpen(r) && !s.inRange(r.openedAt)) return false;
    if (f?.kind === "member" && r.memberId !== f.id) return false;
    if (f?.kind === "opportunity" && r.opportunityId !== f.id) return false;
    if (f?.kind === "neighborhood" && m?.area !== f.id) return false;
    return true;
  });
  const rows = scoped.filter(r => seg === "all" || (seg === "open" ? isOpen(r) : r.outcome === seg));
  const byCat = new Map<string, { open: number; fulfilled: number; total: number }>();
  for (const r of scoped) {
    const c = byCat.get(r.category) ?? { open: 0, fulfilled: 0, total: 0 };
    c.total++; if (isOpen(r)) c.open++; if (r.outcome === "fulfilled") c.fulfilled++;
    byCat.set(r.category, c);
  }
  const segs: [ReqSeg, string][] = [["open", "Open"], ["fulfilled", "Fulfilled"], ["none", "None"], ["answered", "Answered"], ["all", "All"]];
  return (
    <div className="requests">
      <div className="filters">
        <div className="seg" role="radiogroup" aria-label="Outcome">{segs.map(([k, l]) => <button key={k} className={seg === k ? "active" : ""} onClick={() => setSeg(k)}>{l}</button>)}</div>
        <span className="muted small">{[...byCat].sort((a, b) => b[1].total - a[1].total).map(([k, c]) => `${k} ${c.open} open / ${c.fulfilled} fulfilled`).join(" · ")}</span>
      </div>
      {rows.length ? (
        <table className="table">
          <thead><tr><th>Opened</th><th>Member</th><th>Asked for</th><th>Outcome</th><th className="r">Tries</th><th className="r">Age</th><th /></tr></thead>
          <tbody>
            {rows.slice(0, 200).map(r => (
              <tr key={r.id}>
                <td className="muted">{stamp(r.openedAt)}</td>
                <td><MemberLink id={r.memberId} /></td>
                <td>{r.label} <span className="muted">· {r.category}{r.kind === "plans" ? " · plans" : ""}</span></td>
                <td><Badge tone={OUTCOME_TONE[r.outcome]}>{r.outcome}</Badge></td>
                <td className="r">{r.tries}</td>
                <td className="r" title={r.hoursToFulfil !== undefined ? "Hours to fulfil" : "Age"}>{r.hoursToFulfil !== undefined ? `${r.hoursToFulfil}h` : dur(r.ageHours * 3_600_000)}</td>
                <td>{r.opportunityId && s.opps.has(r.opportunityId) ? <OppLink o={s.opps.get(r.opportunityId)!}>open</OppLink> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="muted small pad">{s.requests.length ? s.nothing() : "No requests yet."}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- scorecard and growth (gaps 14, 16)
function fmtMetric(unit: ScoreMetric["unit"], v: number): string {
  return unit === "share" ? pct(v, v > 0 && v < 0.1 ? 1 : 0) : unit === "per_member_week" ? v.toFixed(2) : unit === "minutes" ? `${v.toFixed(1)} min` : num(v);
}
/** PRD 28.2 scorecard: value, target, met. The definition is in each row's tooltip. */
export function Scorecard({ rows }: { rows: ScoreMetric[] }) {
  return (
    <table className="table score">
      <thead><tr><th>Measure</th><th className="r">Value</th><th className="r">Target</th><th className="r">n</th></tr></thead>
      <tbody>
        {rows.map(m => (
          <tr key={m.key} title={m.how}>
            <td>{m.label}</td>
            <td className={`r ${m.met === true ? "good-text" : m.met === false ? "bad" : ""}`}>{m.value === null ? "–" : fmtMetric(m.unit, m.value)}{m.met === true ? " ✓" : m.met === false ? " ✗" : ""}</td>
            <td className="r muted">{m.target ? `${m.target.op} ${fmtMetric(m.unit, m.target.value)}` : ""}</td>
            <td className="r muted">{num(m.n)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Growth() {
  const s = useStore();
  const g = s.stats?.growth;
  if (!g) return null;
  const row = (label: string, c: typeof g.seed) => <tr><td>{label}</td><td className="r">{num(c.members)}</td><td className="r">{num(c.joined)}</td><td className="r">{num(c.activated)}</td><td className="r">{c.rate === null ? "–" : pct(c.rate)}</td></tr>;
  return (
    <Section title="Growth">
      <div className="kpis compact">
        <Kpi label="invites sent" value={num(g.invitesSent)} />
        <Kpi label="invitees joined" value={num(g.inviteesJoined)} />
        <Kpi label="growth asks" value={num(g.growthAsks)} />
        <Kpi label="invited someone" value={g.inviterShare === null ? "–" : pct(g.inviterShare)} tone={g.inviterShare !== null && g.inviterShare >= 0.3 ? "good" : undefined} title="Joined members who invited someone. PRD 28.2 target: at least 30%." />
      </div>
      <table className="table" title="Activated: joined and had a first outcome (attended a meeting, or a request was fulfilled or answered)">
        <thead><tr><th>Cohort</th><th className="r">Members</th><th className="r">Joined</th><th className="r">Activated</th><th className="r">Rate</th></tr></thead>
        <tbody>{row("Seed", g.seed)}{row("Invitees", g.invitees)}</tbody>
      </table>
    </Section>
  );
}

// ---------------------------------------------------------------- configuration and audit (gaps 10, 17, 5)
export function Config() {
  const s = useStore();
  const r = useFetch<ConfigInfo>(() => store.config(), `${s.mode}|${s.network?.matchingEnabled}|${s.network?.review.mode}`);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { if (!confirm) return; const h = setTimeout(() => setConfirm(false), 4000); return () => clearTimeout(h); }, [confirm]);
  const c = r.data;
  if (!c) return <Err {...r} />;
  const locked = !!s.env?.matchingLocked && !c.matchingEnabled;
  const canSwitch = c.canChange && s.isAdmin() && !locked;
  const flip = async () => {
    if (!confirm) { setConfirm(true); return; }
    setConfirm(false);
    const x = await store.control({ type: "matching", on: !c.matchingEnabled });
    if (x.ok) { store.toast(`Proactive matching ${c.matchingEnabled ? "off" : "on"}`, c.matchingEnabled ? "info" : "good"); r.reload(); }
  };
  return (
    <div className="config">
      <div className="run-grid">
        <Section title={`Proactive matching · ${s.app} · NYC`}>
          <div className="review-actions">
            <Badge tone={c.matchingEnabled ? "good" : "warn"}>{c.matchingEnabled ? "on" : "off"}</Badge>
            {canSwitch
              ? <button className={confirm ? "btn active" : "btn"} onClick={flip}>{confirm ? `Confirm: turn ${c.matchingEnabled ? "off" : "on"}` : `Turn ${c.matchingEnabled ? "off" : "on"}`}</button>
              : <span className="muted small">{locked ? "Off until the app's pack ships" : c.canChange ? "Admin only" : "Read-only here"}</span>}
            <span className="muted small">Review: {c.reviewMode ?? "–"}</span>
          </div>
          <table className="table">
            <thead><tr><th>v</th><th>When</th><th>Who</th><th>Setting</th><th>Change</th></tr></thead>
            <tbody>
              {[...c.history].reverse().map(h => (
                <tr key={h.version}><td className="muted">{h.version}</td><td className="muted">{stamp(h.at)}</td><td>{h.actor.replace(/^token:/, "")}</td><td>{humanize(h.key)}</td><td>{String(h.from ?? "–")} → {String(h.to)}</td></tr>
              ))}
              {!c.history.length && <tr><td colSpan={5} className="muted">No changes yet.</td></tr>}
            </tbody>
          </table>
        </Section>
        <Section title="Settings in force">
          <details className="disclosure"><summary>Network options ({Object.keys(c.network).length})</summary>
            <div className="kv">{Object.entries(c.network).map(([k, v]) => <div key={k}><span className="muted">{k}</span> {String(v)}</div>)}</div>
          </details>
          <details className="disclosure"><summary>Outreach numbers</summary><pre className="pre">{JSON.stringify(c.outreach, null, 1)}</pre></details>
        </Section>
      </div>
      {s.isAdmin() && <AuditLog />}
    </div>
  );
}

/** Every staff read and action (admin only). Each load is itself logged. */
function AuditLog() {
  const [actor, setActor] = useState("");
  const [target, setTarget] = useState("");
  const [q, setQ] = useState({ actor: "", target: "" });
  const r = useFetch<{ sink: string; entries: AuditEntry[] }>(() => store.audit({ limit: 200, actor: q.actor || undefined, targetId: q.target || undefined }), `${q.actor}|${q.target}`);
  return (
    <Section title={`Audit log${r.data ? ` · ${r.data.sink}` : ""}`} right={
      <form className="review-actions" onSubmit={e => { e.preventDefault(); if (q.actor === actor.trim() && q.target === target.trim()) r.reload(); else setQ({ actor: actor.trim(), target: target.trim() }); }}>
        <input className="input" placeholder="Actor" value={actor} onChange={e => setActor(e.target.value)} />
        <input className="input" placeholder="Target id" value={target} onChange={e => setTarget(e.target.value)} />
        <button className="btn" type="submit">Load</button>
      </form>
    }>
      {r.data ? (
        <table className="table">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Result</th></tr></thead>
          <tbody>
            {r.data.entries.map((e, i) => (
              <tr key={e.id ?? i} className={e.ok ? "" : "bad"}>
                <td className="muted">{stamp(e.at)}</td>
                <td title={e.roles.join(", ")}>{e.actor.replace(/^token:/, "")}</td>
                <td>{humanize(e.action)}</td>
                <td>{e.targetType ? `${e.targetType} ` : ""}{e.targetType === "member" && e.targetId && store.members.has(e.targetId) ? <MemberLink id={e.targetId} /> : <span className="muted">{e.targetId ?? ""}</span>}</td>
                <td className="muted" title={e.detail ? JSON.stringify(e.detail) : undefined}>{e.ok ? "ok" : "refused"}{e.reason ? ` · ${e.reason}` : ""}{auditCode(e)}</td>
              </tr>
            ))}
            {!r.data.entries.length && <tr><td colSpan={5} className="muted">Nothing logged.</td></tr>}
          </tbody>
        </table>
      ) : <Err {...r} />}
    </Section>
  );
}
const auditCode = (e: AuditEntry) => {
  const d = e.detail as { phase?: string; code?: string; refused?: string } | undefined;
  return [d?.phase, d?.code ?? d?.refused].filter(Boolean).map(x => ` · ${x}`).join("");
};

// ---------------------------------------------------------------- simulation lab (gap 12)
const ARMS: [LabArm, string][] = [["push_baseline", "Push baseline"], ["push_v2", "Push v2"], ["consent", "Consent"]];
export function Lab() {
  const [poll, setPoll] = useState(0);
  const r = useFetch<{ enabled: boolean; running: number; runs: LabRun[] }>(() => store.lab(), "lab", poll);
  const [arms, setArms] = useState<LabArm[]>(["consent"]);
  const [seeds, setSeeds] = useState("1");
  const [days, setDays] = useState(7);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<string>();
  const lab = r.data;
  const active = !!lab?.runs.some(x => x.status === "queued" || x.status === "running");
  useEffect(() => { setPoll(active ? 3000 : 0); }, [active]);
  if (!lab) return <Err {...r} />;
  if (!lab.enabled) return <div className="muted small pad">The lab is off on this server.</div>;
  const start = async () => {
    setErr("");
    const list = seeds.split(/[\s,]+/).filter(Boolean).map(Number);
    const x = await store.labRun({ arms, seeds: list, days });
    if (!x.data?.ok) { setErr(x.error ?? "refused"); return; }
    setSel(x.data.run.id); setPoll(3000); r.reload();
  };
  const runs = [...lab.runs].sort((a, b) => b.createdAt - a.createdAt);
  const shown = runs.find(x => x.id === sel) ?? runs[0];
  return (
    <div className="lab">
      <form className="filters" onSubmit={e => { e.preventDefault(); start(); }}>
        {ARMS.map(([k, l]) => (
          <label key={k} className="legend-item"><input type="checkbox" checked={arms.includes(k)} onChange={e => setArms(e.target.checked ? [...arms, k] : arms.filter(a => a !== k))} />{l}</label>
        ))}
        <span className="spacer-s" />
        <label className="small">seeds <input className="input" style={{ width: 90 }} value={seeds} onChange={e => setSeeds(e.target.value)} title="1-5 seeds, comma-separated" /></label>
        <label className="small">days <input className="input tiny" type="number" min={1} max={60} value={days} onChange={e => setDays(Number(e.target.value))} /></label>
        <button className="btn primary" type="submit" disabled={!arms.length}>Start run</button>
        <span className="muted small">{lab.running} running</span>
        {err && <span className="bad small">{err}</span>}
      </form>
      {runs.length ? (
        <div className="engine">
          <div className="run-list">
            {runs.map(x => (
              <button key={x.id} className={x.id === shown?.id ? "run active" : "run"} onClick={() => setSel(x.id)}>
                {stamp(x.createdAt)} <span className={x.status === "failed" ? "bad" : "muted"}>· {x.status}{x.status === "running" || x.status === "queued" ? ` ${x.progress.done}/${x.progress.total}` : ""}</span>
                <div className="muted small">{x.request.arms.join(", ")} · seeds {x.request.seeds.join(",")} · {x.request.days}d</div>
              </button>
            ))}
          </div>
          {shown && <LabResults run={shown} />}
        </div>
      ) : <div className="muted small pad">No lab runs yet.</div>}
    </div>
  );
}

const secs = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : dur(ms));
function LabResults({ run }: { run: LabRun }) {
  const zero = (v: number | null) => <td className={`r ${v ? "bad" : v === 0 ? "good-text" : "muted"}`}>{v === null ? "–" : num(v)}</td>;
  return (
    <div className="run-detail">
      <div className="small muted" title={run.file}>{run.id} · by {run.requestedBy.replace(/^token:/, "")}{run.finishedAt && run.startedAt ? ` · ${secs(run.finishedAt - run.startedAt)}` : ""} · {run.file.split("/").pop()}</div>
      {run.error && <div className="callout bad small">{run.error}</div>}
      <table className="table">
        <thead><tr><th>Arm</th><th className="r">Seed</th><th className="r">Everyone-yes</th><th className="r">Accept</th><th className="r">Meetings</th><th className="r">Invariants</th><th className="r">Canary leaks</th><th className="r">Minor contacts</th></tr></thead>
        <tbody>
          {run.results.map((x, i) => (
            <tr key={i}>
              <td>{humanize(x.arm)}</td><td className="r">{x.seed}</td>
              <td className="r">{x.everyoneYes === null ? "–" : pct(x.everyoneYes)}</td><td className="r">{x.accept === null ? "–" : pct(x.accept)}</td>
              <td className="r">{x.meetings === null ? "–" : num(x.meetings)}</td>
              {zero(x.judgeInvariants)}{zero(x.canaryLeaks)}{zero(x.minorContacts)}
            </tr>
          ))}
          {!run.results.length && <tr><td colSpan={8} className="muted">{run.status === "failed" ? "No results." : "Waiting for results…"}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- run diff (gap 19)
const fmtN = (x: number) => (Number.isInteger(x) ? num(x) : x.toFixed(3));
function DiffTable({ title, rows }: { title: string; rows: Record<string, DiffNum> }) {
  const xs = Object.entries(rows).filter(([, v]) => v.a || v.b);
  if (!xs.length) return null;
  return (
    <Section title={title}>
      <table className="table">
        <thead><tr><th /><th className="r">A</th><th className="r">B</th><th className="r">B − A</th></tr></thead>
        <tbody>
          {xs.map(([k, v]) => (
            <tr key={k}><td>{humanize(k.replace(/([a-z])([A-Z])/g, "$1_$2"))}</td><td className="r muted">{fmtN(v.a)}</td><td className="r">{fmtN(v.b)}</td><td className={`r ${v.delta ? "" : "muted"}`}>{v.delta > 0 ? "+" : ""}{fmtN(v.delta)}</td></tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}
function TopList({ items }: { items: EngineRunSummary["top"] }) {
  if (!items.length) return <div className="muted small">None.</div>;
  return <>{items.slice(0, 12).map(t => <div className="small" key={t.key}><span className="top-score">{t.score.toFixed(3)}</span> {t.participants.map((p, i) => <span key={p}>{i > 0 && " · "}<MemberLink id={p} first /></span>)} <span className="muted">· {humanize(t.generator)}{t.selected ? " · selected" : ""}</span></div>)}</>;
}
/** Two engine runs side by side: A is the older one. */
export function RunDiffView({ a, b }: { a: string; b: string }) {
  const r = useFetch<RunDiff>(() => store.runDiff(a, b), `${a}|${b}`);
  const d = r.data;
  if (!d) return <Err {...r} />;
  const head = (x: RunDiff["a"]): ReactNode => <>{stamp(x.at)} · {x.engineVersion} · {x.proposals} proposals{x.city ? ` · ${x.city}` : ""}</>;
  return (
    <div className="run-detail">
      <div className="small">A: {head(d.a)} <span className="muted">→</span> B: {head(d.b)}</div>
      <div className="run-grid">
        <DiffTable title="Funnel" rows={d.funnel} />
        <DiffTable title="Fairness" rows={d.fairness} />
        <DiffTable title="Candidates by generator" rows={d.byGenerator} />
        <DiffTable title="Proposals by generator" rows={d.proposalsByGenerator} />
        <DiffTable title="Why candidates were filtered" rows={d.rejectedBy} />
      </div>
      <div className="run-grid">
        <Section title={`Top configurations only in B (${d.top.added.length})`}><TopList items={d.top.added} /></Section>
        <Section title={`Only in A (${d.top.removed.length}) · in both: ${d.top.kept}`}><TopList items={d.top.removed} /></Section>
      </div>
    </div>
  );
}
