// Four apps in one console (platform plan section 5): the app switcher, the health of every app
// ("All"), and the cross-app person view (cross_app_safety or admin only; each app's panel opens
// with a typed reason, and the server writes the audit row before it reads).
import { useEffect, useState } from "react";
import type { AppHealth, PersonAppPanel, PersonSummary } from "../src/types.ts";
import { store, useStore } from "./store.ts";
import { ago, Badge, humanize, localDate } from "./ui.tsx";

/** ntwrk / slop / peon / friends / All. "All" shows only when the person holds roles for more than one app. */
export function AppSwitcher() {
  const s = useStore();
  const apps = s.apps();
  if (apps.length <= 1 && !s.me?.crossApp) return null;
  const page = s.page.kind;
  return (
    <div className="mode-switch app-switch" role="tablist" aria-label="App">
      {apps.map(a => (
        <button key={a.id} role="tab" aria-selected={page === "app" && s.app === a.id} className={page === "app" && s.app === a.id ? "active" : ""} title={a.domain} onClick={() => store.setApp(a.id)}>{a.id}</button>
      ))}
      {(apps.length > 1 || s.me?.crossApp) && <button role="tab" aria-selected={page !== "app"} className={page !== "app" ? "active" : ""} onClick={() => store.setApp("all")}>all</button>}
    </div>
  );
}

/** A full-width page over the stage: the health of every app, or one person across apps. */
export function AppPage() {
  const s = useStore();
  if (s.page.kind === "app") return null;
  return (
    <div className="app-page">
      {s.page.kind === "all" ? <AllApps /> : <PersonView id={s.page.id} />}
    </div>
  );
}

const MATCHING_TEXT: Record<AppHealth["matching"], string> = { on: "on", off: "off", locked: "off until pack" };

function AllApps() {
  const s = useStore();
  const [rows, setRows] = useState<AppHealth[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => store.appsHealth().then(r => { if (!live) return; if (r.data) { setRows(r.data.apps); setError(null); } else setError(r.error); });
    load();
    const t = setInterval(load, 10_000);
    return () => { live = false; clearInterval(t); };
  }, [s.mode]);
  return (
    <div className="panel">
      {!!s.apps().length && (
        <table className="score-table apps-table">
          <thead><tr><th>App</th><th>Members</th><th>Review backlog</th><th>SLA misses</th><th>Send failures</th><th>Matching</th></tr></thead>
          <tbody>
            {(rows ?? []).map(r => (
              <tr key={r.app} className="click" onClick={() => store.setApp(r.app)} title={r.error ?? `Open ${r.app}`}>
                <td><span className={`dot level-${r.worst ?? "none"}`} />{r.app}</td>
                {r.available ? (
                  <>
                    <td>{r.members}</td>
                    <td>{r.reviewBacklog}</td>
                    <td className={r.slaMisses ? "bad" : ""}>{r.slaMisses} <span className="muted small">/ {r.slaHours} h</span></td>
                    <td className={r.sendFailures ? "warn-text" : ""}>{r.sendFailures}</td>
                    <td>{MATCHING_TEXT[r.matching]}</td>
                  </>
                ) : <td colSpan={5} className="muted">{r.error ?? "unavailable"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {error && <div className="callout bad small" role="alert">{error}</div>}
      {s.me?.crossApp && <PersonLookup />}
    </div>
  );
}

/** Find a person by a member id in one app, or open a person id. */
function PersonLookup() {
  const s = useStore();
  const [app, setApp] = useState(s.app);
  const [member, setMember] = useState("");
  const [error, setError] = useState<string | null>(null);
  const find = async () => {
    const q = member.trim();
    if (!q) return;
    if (/^[0-9a-f-]{36}$/i.test(q)) { store.openPerson(q); return; }
    const r = await store.findPerson(q, app);
    if (r.data) store.openPerson(r.data.personId); else setError(r.error);
  };
  return (
    <form className="person-lookup" onSubmit={e => { e.preventDefault(); find(); }}>
      <span className="muted">Cross-app view</span>
      <select className="input" value={app} onChange={e => setApp(e.target.value)} aria-label="App of the member">
        {(s.me?.appInfo ?? []).map(a => <option key={a.id} value={a.id}>{a.id}</option>)}
      </select>
      <input className="input grow" placeholder="Member id or person id" value={member} onChange={e => { setMember(e.target.value); setError(null); }} aria-label="Member id or person id" />
      <button className="btn" type="submit">Open</button>
      {error && <span className="bad small" role="alert">{error}</span>}
    </form>
  );
}

/** One person across apps. Each app's panel is closed until a reason is typed (audited first). */
function PersonView({ id }: { id: string }) {
  const [p, setP] = useState<PersonSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setP(null); setError(null);
    store.person(id).then(r => { if (r.data) setP(r.data); else setError(r.status === 403 ? "Your role cannot open the cross-app view." : r.error); });
  }, [id]);
  return (
    <div className="panel person">
      <div className="section-head">
        <h3>Person {id.slice(0, 8)}</h3>
        <button className="btn" onClick={() => store.setApp("all")}>Close</button>
      </div>
      {error && <div className="callout bad small" role="alert">{error}</div>}
      {!p && !error && <div className="muted">Loading…</div>}
      {p && (
        <>
          <div className="muted small">
            Lowest age {p.lowestAge ?? "unknown"} · since {localDate(p.createdAt)}{p.deletedAt ? ` · deleted ${localDate(p.deletedAt)}` : ""}
          </div>
          {p.holds.length > 0 && (
            <div className="callout bad small">
              Hold on every app: {p.holds.map(h => (h.app === "*" ? "account restricted (on an app not shown)" : `${humanize(h.level)} (${h.app})`)).join(", ")}
            </div>
          )}
          <div className="small">
            Blocks made {p.blocks.made.length} · received {p.blocks.received.length}
            {p.blocks.made.concat(p.blocks.received).length > 0 && (
              <span className="muted"> · {[...p.blocks.made.map(b => `→ ${b.person.slice(0, 8)}${b.originApp === "*" ? "" : ` (${b.originApp})`}`), ...p.blocks.received.map(b => `← ${b.person.slice(0, 8)}${b.originApp === "*" ? "" : ` (${b.originApp})`}`)].join(", ")}</span>
            )}
          </div>
          {p.memberships.map(m => <AppPanel key={m.app} personId={p.personId} m={m} />)}
          {!p.memberships.length && <div className="muted">No memberships shown.</div>}
          {/* Dating (slop) is never listed: the same closed row for every person, opened only with a reason (PRD 40.3). */}
          {(p.privateApps ?? []).map(app => <AppPanel key={app} personId={p.personId} m={{ app, state: "", hold: false }} hidden />)}
        </>
      )}
    </div>
  );
}

function AppPanel({ personId, m, hidden }: { personId: string; m: PersonSummary["memberships"][number]; hidden?: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [panel, setPanel] = useState<PersonAppPanel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const read = async () => {
    const r = await store.openPersonApp(personId, m.app, reason.trim());
    if (r.data) { setPanel(r.data); setError(null); } else setError(r.error);
  };
  return (
    <div className="person-app">
      <button className="person-app-head" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <b>{m.app}</b>
        {hidden
          ? <span className="muted">private app: membership not shown · open with a reason</span>
          : <span className="muted">{humanize(m.state)}{m.joinedAt ? ` · joined ${localDate(m.joinedAt)}` : ""}{m.leftAt ? ` · left ${localDate(m.leftAt)}` : ""}</span>}
        {m.hold && <Badge tone="bad">hold</Badge>}
        {m.review && <Badge tone="warn">{humanize(m.review)}</Badge>}
      </button>
      {open && !panel && (
        <form className="person-reason" onSubmit={e => { e.preventDefault(); read(); }}>
          <input className="input grow" autoFocus placeholder="Reason (logged)" value={reason} onChange={e => setReason(e.target.value)} aria-label={`Reason to open ${m.app}`} />
          <button className="btn" type="submit" disabled={reason.trim().length < 5}>Open</button>
          {error && <span className="bad small" role="alert">{error}</span>}
        </form>
      )}
      {open && panel && (
        <div className="person-panel small">
          <div>Member {panel.memberId} · {humanize(panel.state)} · trust {panel.trust}</div>
          <div className="muted">Messages in {panel.messages.in} · out {panel.messages.out}{panel.messages.last ? ` · last ${ago(panel.messages.last, Date.now())}` : ""} · opportunities {panel.opportunities}</div>
          {panel.cases.map(c => <div key={c.id}>Case {c.id} · {c.level} · {c.status} · opened {localDate(c.opened)}</div>)}
        </div>
      )}
    </div>
  );
}

/** In a member's panel: open the person across apps (cross_app_safety or admin, real mode). */
export function CrossAppButton({ memberId }: { memberId: string }) {
  const s = useStore();
  const [error, setError] = useState<string | null>(null);
  if (!s.me?.crossApp || s.mode !== "real") return null;
  return (
    <>
      <button className="btn" onClick={async () => { const r = await store.findPerson(memberId); if (r.data) store.openPerson(r.data.personId); else setError(r.error); }}>Cross-app view</button>
      {error && <span className="muted small">{error}</span>}
    </>
  );
}
