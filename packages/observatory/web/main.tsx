// The Network Observatory web app.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Category } from "@thenetwork/core";
import { Drawer } from "./drawer.tsx";
import { EDGE_STYLE, GraphView, OPP_COLOR } from "./graph.ts";
import { MapView } from "./map.ts";
import { Inspector } from "./panels.tsx";
import { EDGE_TYPES, store, useStore, type ColorLens } from "./store.ts";
import { Badge, humanize, localDate, localTime } from "./ui.tsx";

const HOUR = 3_600_000, DAY = 24 * HOUR;
const SPEEDS: [string, number][] = [["1h/s", HOUR], ["6h/s", 6 * HOUR], ["1d/s", DAY], ["2d/s", 2 * DAY]];
const CATEGORIES: Category[] = ["social", "professional", "hobby", "help", "romance", "growth", "events"];

function App() {
  const s = useStore();
  useEffect(() => { store.load(); store.connect(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (e.key === " " && store.env?.capabilities.canStep) { e.preventDefault(); store.control({ type: store.clock?.playing ? "pause" : "play" }); }
      if (e.key === "Escape") store.setUI({ selection: null, picks: [] });
      if (e.key === "n" && store.env?.capabilities.canStep) store.control({ type: "step", ms: HOUR });
      if (e.key === "d" && store.env?.capabilities.canStep) store.control({ type: "step", ms: DAY });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className={`app mode-${s.mode}`}>
      <TopBar />
      <div className="main">
        <div className="stage">
          <GraphStage />
          <Legend />
          {s.game?.prompts.length ? <Prompts /> : null}
          {s.ui.picks.length > 0 && s.env?.capabilities.canIntervene && <ProposeTray />}
          {s.loading && <div className="loading">Loading the Network…</div>}
        </div>
        <Inspector />
      </div>
      <Drawer />
      <Toast />
    </div>
  );
}

// ---------------------------------------------------------------- top bar
function TopBar() {
  const s = useStore();
  const c = s.clock, env = s.env;
  const canStep = !!env?.capabilities.canStep;
  return (
    <header className="topbar">
      <div className="brand"><span className="logo">◎</span> The Network <span className="muted">Observatory</span></div>
      <div className="mode-switch" role="tablist" aria-label="Mode">
        <button role="tab" aria-selected={s.mode === "game"} className={s.mode === "game" ? "active" : ""} onClick={() => store.setMode("game")}>Game</button>
        <button role="tab" aria-selected={s.mode === "real"} className={s.mode === "real" ? "active" : ""} onClick={() => store.setMode("real")}>Real world</button>
      </div>
      <div className={`env-banner ${s.mode}`} title={env?.database ?? env?.dataset}>{env?.label ?? "…"}{!s.connected && " · reconnecting"}</div>
      {c && (
        <div className="clock">
          <div className="clock-day">{canStep ? `Day ${c.day}` : "Now"} · {localDate(c.now)}</div>
          <div className="clock-times">SF {localTime(c.now, "sf")} · NYC {localTime(c.now, "nyc")}</div>
        </div>
      )}
      {canStep && c ? (
        <div className="transport">
          <button className="btn icon play" aria-label={c.playing ? "Pause" : "Play"} onClick={() => store.control({ type: c.playing ? "pause" : "play" })}>{c.playing ? "❚❚" : "▶"}</button>
          <button className="btn" onClick={() => store.control({ type: "step", ms: HOUR })} title="Step one hour (n)">+1h</button>
          <button className="btn" onClick={() => store.control({ type: "step", ms: DAY })} title="Step one day (d)">+1d</button>
          <select className="input" value={c.speed} onChange={e => store.control({ type: "speed", speed: Number(e.target.value) })} aria-label="Speed">
            {SPEEDS.map(([l, v]) => <option key={l} value={v}>{l}</option>)}
          </select>
          {c.busy && <span className="busy">{c.busy}…</span>}
          {c.waitingForPlayer && <span className="busy gold">waiting for you</span>}
        </div>
      ) : (
        <div className="transport">
          <button className="btn" onClick={() => store.control({ type: "refresh" })}>Refresh</button>
          <button className="btn" onClick={async () => { const r = await store.control({ type: "shadow_run" }); if (r.ok) store.toast(`Shadow run: ${(r.data as any)?.proposals ?? 0} proposals (nothing sent)`, "good"); }}>Shadow run engine</button>
          {c?.busy && <span className="busy">{c.busy}…</span>}
        </div>
      )}
      <div className="lenses">
        <div className="mode-switch small-switch" role="tablist" aria-label="View">
          <button role="tab" aria-selected={s.ui.view === "map"} className={s.ui.view === "map" ? "active" : ""} onClick={() => store.setUI({ view: "map" })}>Map</button>
          <button role="tab" aria-selected={s.ui.view === "graph"} className={s.ui.view === "graph" ? "active" : ""} onClick={() => store.setUI({ view: "graph" })}>Graph</button>
        </div>
        <select className="input" value={s.ui.city} onChange={e => store.setUI({ city: e.target.value as any })} aria-label="City">
          <option value="all">SF + NYC</option><option value="sf">San Francisco</option><option value="nyc">New York</option>
        </select>
        <select className="input" value={s.ui.colorBy} onChange={e => store.setUI({ colorBy: e.target.value as ColorLens })} aria-label="Color by">
          <option value="community">Color: community</option><option value="state">Color: state</option><option value="city">Color: city</option>
          <option value="activity">Color: activity</option>{s.truth && <option value="truth">Color: hidden truth</option>}
        </select>
        {env?.capabilities.hiddenTruth && (
          <label className="toggle" title="Reveal hidden ground truth (marks your score as assisted)">
            <input type="checkbox" checked={!!s.truth} onChange={e => { store.control({ type: "lens", on: e.target.checked }); if (!e.target.checked && s.ui.colorBy === "truth") store.setUI({ colorBy: "community" }); }} /> Truth lens
          </label>
        )}
        <Search />
      </div>
    </header>
  );
}

function Search() {
  const s = useStore();
  const [q, setQ] = useState("");
  const hits = q.length >= 2 ? [...s.members.values()].filter(m => m.name.toLowerCase().includes(q.toLowerCase()) || m.id === q).slice(0, 8) : [];
  return (
    <div className="search">
      <input className="input" placeholder="Find a member…" value={q} onChange={e => setQ(e.target.value)} aria-label="Find a member" />
      {hits.length > 0 && (
        <div className="search-pop">
          {hits.map(m => <button key={m.id} onClick={() => { store.select({ kind: "member", id: m.id }); graphRef.current?.focus(m.id); setQ(""); }}>{m.name} <span className="muted">{m.city.toUpperCase()} · {m.area}</span></button>)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- stage: NYC map or social graph
const graphRef: { current: { focus(id: string): void } | null } = { current: null };
function GraphStage() {
  const s = useStore();
  return s.ui.view === "map" ? <MapStage /> : <GraphCanvas />;
}

function MapStage() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const m = new MapView(ref.current!);
    graphRef.current = m;
    return () => { m.destroy(); graphRef.current = null; };
  }, []);
  return <div ref={ref} className="nyc-map" aria-label="Map of members in New York" />;
}

function GraphCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  useEffect(() => {
    const g = new GraphView(ref.current!);
    graphRef.current = g;
    g.onHover = (id, x, y) => setTip(id ? { id, x, y } : null);
    return () => { g.destroy(); graphRef.current = null; };
  }, []);
  const s = useStore();
  const m = tip ? s.members.get(tip.id) : undefined;
  return (
    <>
      <canvas ref={ref} className="graph" aria-label="Social graph of members" />
      {m && tip && (
        <div className="tooltip" style={{ left: tip.x + 14, top: tip.y + 14 }}>
          <b>{m.name}</b> <span className="muted">{m.city.toUpperCase()} · {m.area}</span>
          <div className="small">{humanize(m.state)} · {m.counters.proposals} proposals · {m.counters.meetings} meetings{m.minor ? " · under 18" : ""}</div>
          <div className="small muted">click to inspect · shift-click to pick</div>
        </div>
      )}
    </>
  );
}

function Legend() {
  const s = useStore();
  const [open, setOpen] = useState(true);
  return (
    <div className={`legend ${open ? "" : "closed"}`}>
      <button className="legend-head" onClick={() => setOpen(!open)}>Layers {open ? "▾" : "▸"}</button>
      {open && (
        <>
          {EDGE_TYPES.map(t => (
            <label key={t} className="legend-item">
              <input type="checkbox" checked={!!s.ui.edgeTypes[t]} onChange={e => store.setUI({ edgeTypes: { ...s.ui.edgeTypes, [t]: e.target.checked } })} />
              <span className="swatch" style={{ background: EDGE_STYLE[t]?.color }} />{humanize(t)} <span className="muted">{s.stats?.edgesByType[t] ?? 0}</span>
            </label>
          ))}
          <label className="legend-item">
            <input type="checkbox" checked={s.ui.showOpps} onChange={e => store.setUI({ showOpps: e.target.checked })} />
            <span className="swatch dashed" style={{ borderColor: OPP_COLOR.INVITING }} />open opportunities
          </label>
          <div className="legend-note small muted">{s.ui.view === "map" ? "● members at home · ◌ gold = public venues · green = meetings · red = held" : "◆ under 18 · ○ white ring = busy · gold ring = you · double-click to fit"}</div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- play
function ProposeTray() {
  const s = useStore();
  const [category, setCategory] = useState<Category>("social");
  const [objective, setObjective] = useState("");
  const [why, setWhy] = useState("");
  const [peek, setPeek] = useState<any>(null);
  const picks = s.ui.picks;
  const busy = s.busy();
  const group = picks.length > 2;
  const g = s.game;
  const submit = async () => {
    const r = await store.control({ type: "propose", participants: picks, category, objective, why });
    if (r.ok) { store.toast(`Proposed. It ${(r.data as any)?.dispatch ?? "goes out soon"}.`, "good"); store.setUI({ picks: [] }); setPeek(null); setWhy(""); setObjective(""); }
  };
  return (
    <div className="tray">
      <div className="tray-people">
        {picks.map(id => (
          <span key={id} className={`pick ${busy.has(id) ? "busy" : ""}`}>
            {s.members.get(id)?.name ?? id}{busy.has(id) ? " · busy" : ""}{s.members.get(id)?.minor ? " · under 18" : ""}
            <button aria-label="Remove" onClick={() => store.togglePick(id)}>×</button>
          </span>
        ))}
        {picks.length < 2 && <span className="muted small">Shift-click one more person (or 3-6 for a group).</span>}
      </div>
      {picks.length >= 2 && (
        <div className="tray-form">
          <select className="input" value={category} onChange={e => setCategory(e.target.value as Category)} aria-label="Category">{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>
          <input className="input grow" placeholder={group ? "What's the plan? (e.g. dinner in the Mission)" : "What's the intro for? (e.g. coffee about climbing)"} value={objective} onChange={e => setObjective(e.target.value)} />
          <input className="input grow" placeholder="Why these people? (shared with them)" value={why} onChange={e => setWhy(e.target.value)} />
          <button className="btn primary" disabled={!g || g.sparksLeft <= 0 || g.over} onClick={submit}>Propose {group ? "group" : "intro"} · {g?.sparksLeft ?? 0} sparks</button>
          <button className="btn" onClick={async () => { const r = await store.control({ type: "peek", participants: picks }); if (r.ok) setPeek(r.data); }} title="Ask the oracle (−25 points)">Peek −25</button>
          <button className="btn ghost" onClick={() => { store.setUI({ picks: [] }); setPeek(null); }}>Clear</button>
        </div>
      )}
      {peek && (
        <div className={`callout small ${peek.unsafe ? "bad" : peek.compatible ? "good" : "warn"}`}>
          Oracle: {peek.unsafe ? `unsafe (${peek.flags.join(", ")})` : peek.compatible ? "a real fit" : "not a real fit"} · quality {(peek.quality * 100).toFixed(0)}% ·{" "}
          {Object.entries(peek.participants as Record<string, any>).map(([id, p]) => `${s.members.get(id)?.name.split(" ")[0]}: ${(p.acceptProb * 100).toFixed(0)}% yes`).join(" · ")}
        </div>
      )}
    </div>
  );
}

function Prompts() {
  const s = useStore();
  const prompts = s.game?.prompts ?? [];
  const [text, setText] = useState("");
  const p = prompts[0];
  if (!p) return null;
  const m = s.members.get(p.memberId);
  const reply = (t?: string, auto?: boolean) => { store.control({ type: "reply", promptId: p.id, text: t, auto }); setText(""); };
  const quick = p.type === "proposal" ? ["Yes, I'm in!", "No thanks, not right now."]
    : p.type === "feedback_request" ? ["It was great, would meet again.", "It was fine.", "Not a good fit honestly."]
    : p.type === "reminder" || p.type === "scheduling" ? ["Sounds good, see you then.", "Sorry, I can't make it."]
    : ["Thanks!"];
  return (
    <div className="prompt-card" role="dialog" aria-label={`Message for ${m?.name}`}>
      <div className="eyebrow">You are {m?.name} · the world is paused{prompts.length > 1 ? ` · ${prompts.length} waiting` : ""}</div>
      <div className="msg outbound"><div className="msg-meta">The Network{p.type ? ` · ${humanize(p.type)}` : ""}</div><div className="msg-body">{p.body}</div></div>
      <div className="quick">{quick.map(q => <button key={q} className="chip" onClick={() => reply(q)}>{q}</button>)}</div>
      <form className="reply" onSubmit={e => { e.preventDefault(); if (text.trim()) reply(text); }}>
        <input className="input grow" autoFocus placeholder={`Reply as ${m?.name.split(" ")[0]}…`} value={text} onChange={e => setText(e.target.value)} />
        <button className="btn primary" type="submit">Send</button>
        <button className="btn ghost" type="button" onClick={() => reply(undefined, true)} title="Let the persona's own policy answer">Let them decide</button>
      </form>
    </div>
  );
}

function Toast() {
  const s = useStore();
  const t = s.ui.toast;
  const [, force] = useState(0);
  useEffect(() => { if (!t) return; const h = setTimeout(() => force(x => x + 1), 4200); return () => clearTimeout(h); }, [t?.at]);
  if (!t || Date.now() - t.at > 4000) return null;
  return <div className={`toast ${t.tone}`} role="status">{t.text}</div>;
}

export { Badge };
createRoot(document.getElementById("root")!).render(<App />);
