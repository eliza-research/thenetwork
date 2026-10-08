// The Network Observatory web app: top bar, filter bar, stage (NYC map or social graph) with the
// inspector, and the drawer. One focus (member, opportunity or neighborhood) and one set of
// filters drive every panel (store.ts).
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Category } from "@thenetwork/core";
import { NEIGHBORHOODS } from "@thenetwork/network/geo";
import type { EnvInfo, SearchHit } from "../src/types.ts";
import { AppPage, AppSwitcher } from "./apps.tsx";
import { Drawer, filterApplies, TAB_LABEL } from "./drawer.tsx";
import { EDGE_STYLE, GraphView, OPP_COLOR } from "./graph.ts";
import { MapView } from "./map.ts";
import { Inspector } from "./panels.tsx";
import {
  BOROUGHS, DAY, EDGE_TYPES, HOUR, MEMBER_FILTERS, originLabel, RANGES, STATE_GROUPS, store, useStore,
  type ColorLens, type FilterKey, type Filters, type MemberFilter, type StateGroup,
} from "./store.ts";
import { humanize, localDate, localTime, stamp, useOutsideClose } from "./ui.tsx";

const SPEEDS: [string, number][] = [["1h/s", HOUR], ["6h/s", 6 * HOUR], ["1d/s", DAY], ["2d/s", 2 * DAY]];
const CATEGORIES: Category[] = ["social", "professional", "hobby", "help", "romance", "growth", "events"];

/** Esc does one step: close a popover or menu, clear the search, clear the picks, clear the focus. */
function escape() {
  const ui = store.ui;
  if (ui.popover) store.setUI({ popover: null });
  else if (ui.query) store.setUI({ query: "" });
  else if (ui.picks.length) store.setUI({ picks: [] });
  else if (ui.focus) store.clearFocus();
}

function App() {
  const s = useStore();
  useEffect(() => { store.load(); store.connect(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const field = (e.target as Element | null)?.closest?.("input, textarea, select");
      if (e.key === "Escape") { escape(); if (field && !store.ui.query) (field as HTMLElement).blur(); return; }
      if (field || e.metaKey || e.ctrlKey || e.altKey) return;
      const canStep = !!store.env?.capabilities.canStep && store.canSim();
      if (e.key === "/") { e.preventDefault(); document.getElementById("obs-search")?.focus(); }
      else if (e.key === "?") store.setUI({ popover: store.ui.popover === "help" ? null : "help" });
      else if (e.key === "g") store.setUI({ view: store.ui.view === "map" ? "graph" : "map" });
      else if (e.key === " " && canStep) { e.preventDefault(); store.control({ type: store.clock?.playing ? "pause" : "play" }); }
      else if (e.key === "n" && canStep) store.control({ type: "step", ms: HOUR });
      else if (e.key === "d" && canStep) store.control({ type: "step", ms: DAY });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className={`app mode-${s.mode}`}>
      <TopBar />
      {s.page.kind === "app" && <FilterBar />}
      {s.page.kind !== "app" || (s.me && !s.apps().length) ? <AppPage /> : null}
      <div className="main" hidden={s.page.kind !== "app" || (!!s.me && !s.apps().length)}>
        <div className="stage">
          <GraphStage />
          <Legend />
          {s.game?.prompts.length && s.canSim() ? <Prompts /> : null}
          {s.ui.picks.length > 0 && s.env?.capabilities.canIntervene && s.canSim() && <ProposeTray />}
          {s.loading && !s.authNeeded && <div className="loading">Loading…</div>}
        </div>
        <Inspector />
      </div>
      {s.page.kind === "app" && <Drawer />}
      {s.authNeeded && <AuthPrompt />}
      <Toast />
    </div>
  );
}

// ---------------------------------------------------------------- top bar
/**
 * Short banner with the app: "SLOP · SIM · seed 1", "SLOP · LOCAL DB · read-only" or "NTWRK · PROD · read-only".
 * The full label goes in the title.
 */
function banner(env?: EnvInfo): { text: string; title: string } {
  if (!env) return { text: "…", title: "" };
  const app = env.app ? `${env.app.toUpperCase()} · ` : "";
  const title = [env.label, env.dataset, env.database, env.appIsolation === "rls_role" ? "app read role" : env.appIsolation === "app_filter" ? "app filter" : "", env.piiRevealed ? "PII revealed" : "", env.authRequired ? "Token required" : ""].filter(Boolean).join(" · ");
  if (env.capabilities.canStep) { const seed = /seed (\d+)/.exec(env.label)?.[1]; return { text: `${app}${seed ? `SIM · seed ${seed}` : "SIM"}`, title }; }
  // Say which database it is: the server labels local and named (OBSERVATORY_ENV_LABEL) environments.
  const where = /^LOCAL/.test(env.label) ? "LOCAL DB" : /^PRODUCTION/.test(env.label) ? "PROD" : /not connected/i.test(env.label) ? "NOT CONNECTED" : env.label.split(" · ")[0]!;
  return { text: `${app}${where}${/not connected/i.test(env.label) ? "" : " · read-only"}${env.piiRevealed ? " · PII" : ""}`, title };
}

function TopBar() {
  const s = useStore();
  const c = s.clock, env = s.env;
  const canStep = !!env?.capabilities.canStep;
  const b = s.page.kind === "app" ? banner(env) : { text: `ALL APPS · ${s.mode === "real" ? "real data" : "simulation"}`, title: "Every app you hold a role for" };
  const me = s.me;
  return (
    <header className="topbar">
      <div className="brand"><span className="logo">◎</span> Observatory</div>
      <AppSwitcher />
      {s.isAdmin() && !s.realOnly() && (
        <div className="mode-switch" role="tablist" aria-label="Mode">
          <button role="tab" aria-selected={s.mode === "game"} className={s.mode === "game" ? "active" : ""} onClick={() => store.setMode("game")}>Game</button>
          <button role="tab" aria-selected={s.mode === "real"} className={s.mode === "real" ? "active" : ""} onClick={() => store.setMode("real")}>Real</button>
        </div>
      )}
      <div className={`env-banner ${s.mode}`} title={b.title}>{b.text}</div>
      {!s.connected && <span className="dot live-off" title="Reconnecting" aria-label="Reconnecting" />}
      {c && <div className="clock">{canStep ? `Day ${c.day} · ` : ""}{localDate(c.now)} · {localTime(c.now)}</div>}
      {!env ? null : canStep && c ? (s.canSim() ? (
        <div className="transport">
          <button className="btn icon play" aria-label={c.playing ? "Pause" : "Play"} title="Play or pause (space)" onClick={() => store.control({ type: c.playing ? "pause" : "play" })}>{c.playing ? "❚❚" : "▶"}</button>
          <button className="btn" onClick={() => store.control({ type: "step", ms: HOUR })} title="Step one hour (n)">+1h</button>
          <button className="btn" onClick={() => store.control({ type: "step", ms: DAY })} title="Step one day (d)">+1d</button>
          <select className="input" value={c.speed} onChange={e => store.control({ type: "speed", speed: Number(e.target.value) })} aria-label="Speed">
            {SPEEDS.map(([l, v]) => <option key={l} value={v}>{l}</option>)}
          </select>
          {c.busy && <span className="busy">{c.busy}…</span>}
          {c.waitingForPlayer && <span className="busy gold">waiting for you</span>}
        </div>
      ) : c.busy ? <span className="busy">{c.busy}…</span> : null) : (
        <div className="transport">
          <button className="btn icon" title="Refresh" aria-label="Refresh" onClick={() => store.control({ type: "refresh" })}>↻</button>
          {s.can("analyst") && <button className="btn" title="Run engine-v1 on this data without sending anything" onClick={async () => { const r = await store.control({ type: "shadow_run" }); if (r.ok) store.toast(`Shadow run: ${(r.data as { proposals?: number } | undefined)?.proposals ?? 0} proposals (nothing sent)`, "good"); }}>Shadow run</button>}
          {c?.busy && <span className="busy">{c.busy}…</span>}
        </div>
      )}
      <div className="lenses">
        <div className="mode-switch small-switch" role="tablist" aria-label="View">
          <button role="tab" aria-selected={s.ui.view === "map"} className={s.ui.view === "map" ? "active" : ""} onClick={() => store.setUI({ view: "map" })}>Map</button>
          <button role="tab" aria-selected={s.ui.view === "graph"} className={s.ui.view === "graph" ? "active" : ""} onClick={() => store.setUI({ view: "graph" })}>Graph</button>
        </div>
        <Search />
        {me && <span className="who" title={`${me.id} · ${me.via === "sso" ? "single sign-on" : "token"} · ${(me.grants ?? []).map(g => `${g.role}@${g.app}`).join(", ")}`}>{(s.rolesHere().length ? s.rolesHere() : me.roles).join(" · ")}</span>}
        <HelpPopover />
      </div>
    </header>
  );
}

type Hit = { key: string; label: string; meta: string; go(): void };
/** Members, neighborhoods and opportunity ids that match the query (at most 5 + 3 + 3). */
function searchHits(query: string): Hit[] {
  const q = query.trim().toLowerCase();
  const hits: Hit[] = [];
  if (q.length < 2) return hits;
  for (const m of store.members.values()) {
    if (hits.length >= 5) break;
    if (m.name.toLowerCase().includes(q) || m.id === q) hits.push({ key: `m${m.id}`, label: m.name, meta: m.area ?? "", go: () => store.focus({ kind: "member", id: m.id }) });
  }
  for (const n of NEIGHBORHOODS.filter(n => n.name.toLowerCase().includes(q)).slice(0, 3)) hits.push({ key: `n${n.name}`, label: n.name, meta: n.borough, go: () => store.focus({ kind: "neighborhood", id: n.name }) });
  if (q.length >= 3) {
    let k = 0;
    for (const o of store.opps.values()) {
      if (k >= 3) break;
      if (o.id.toLowerCase().includes(q)) { k++; hits.push({ key: `o${o.id}`, label: store.oppTitle(o), meta: o.id.slice(0, 12), go: () => store.focus({ kind: "opportunity", id: o.id }) }); }
    }
  }
  return hits;
}

/**
 * Names, neighborhoods and ids as you type. Safety and admin can also search conversations (the
 * Network's own messages and system events; never what a member wrote): the last row, or Shift+Enter.
 * Every conversation search is logged.
 */
function Search() {
  const s = useStore();
  const q = s.ui.query.trim();
  const [conv, setConv] = useState<{ q: string; hits?: SearchHit[]; error?: string } | null>(null);
  useEffect(() => { if (conv && conv.q !== q) setConv(null); }, [q]);
  const canConv = s.can("safety") && q.length >= 2;
  const hits = conv ? [] : searchHits(s.ui.query);
  const done = () => { store.setUI({ query: "" }); setConv(null); (document.getElementById("obs-search") as HTMLInputElement | null)?.blur(); };
  const pickHit = (h: Hit) => { h.go(); done(); };
  const runConv = async () => {
    if (!canConv) return;
    setConv({ q });
    const r = await store.search(q);
    setConv({ q, hits: r.data, error: r.data ? undefined : r.error });
  };
  const openHit = (h: SearchHit) => {
    if (h.opportunityId && store.opps.has(h.opportunityId)) store.focus({ kind: "opportunity", id: h.opportunityId });
    else store.focus({ kind: "member", id: h.memberId });
    done();
  };
  return (
    <div className="search">
      <input
        id="obs-search" className="input" placeholder="Search" value={s.ui.query} aria-label="Search members, neighborhoods and opportunity ids"
        title={s.can("safety") ? "Members, neighborhoods, ids (/). Shift+Enter: search conversations (logged)" : "Members, neighborhoods, opportunity ids (/)"}
        onChange={e => store.setUI({ query: e.target.value })}
        onKeyDown={e => {
          if (e.key !== "Enter") return;
          if (e.shiftKey || (conv && !conv.hits)) { runConv(); return; }
          if (conv?.hits?.[0]) { openHit(conv.hits[0]); return; }
          const h = searchHits(store.ui.query)[0];
          if (h) pickHit(h); else runConv();
        }}
      />
      {(hits.length > 0 || canConv || conv) && q.length >= 2 && (
        <div className="search-pop">
          {conv ? (
            <>
              <div className="search-head muted small">Conversations · “{conv.q}”{conv.hits ? ` · ${conv.hits.length}` : ""} <button className="link small" onClick={() => setConv(null)}>back</button></div>
              {conv.error && <div className="pad bad small">{conv.error}</div>}
              {!conv.hits && !conv.error && <div className="pad muted small">Searching…</div>}
              {conv.hits?.length === 0 && <div className="pad muted small">No matches.</div>}
              <div className="search-results">
                {conv.hits?.map((h, i) => (
                  <button key={i} onClick={() => openHit(h)}>
                    <span>{h.memberName}</span> <span className="muted small">· {stamp(h.t)} · {h.kind === "message" ? `Network${h.type ? ` · ${humanize(h.type)}` : ""}` : humanize(h.type ?? "event")}</span>
                    <div className="small snippet">{h.snippet}</div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              {hits.map(h => <button key={h.key} onClick={() => pickHit(h)}>{h.label} <span className="muted">· {h.meta}</span></button>)}
              {canConv && <button className="search-conv" onClick={runConv} title="The Network's messages and system events. Logged.">Search conversations for “{q}” <kbd>⇧↵</kbd></button>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The "?" popover: how to play (game), the keyboard map and the symbol key. */
function HelpPopover() {
  const s = useStore();
  const open = s.ui.popover === "help";
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(ref, open);
  const game = !!s.env?.capabilities.canIntervene;
  const keys: [string, string][] = [
    ["/", "Search"], ["Esc", "Close, clear search, clear picks, clear focus"], ["g", "Map or graph"], ["?", "This help"],
    ...(s.env?.capabilities.canStep && s.canSim() ? [["space", "Play or pause"], ["n", "+1 hour"], ["d", "+1 day"]] as [string, string][] : []),
    ["j / k", "Review: next, previous"], ["a", "Review: approve"], ["r 1-8", "Review: reject with a reason"], ["e", "Review: edit what each person is told"],
    ["s 1-6", "Review: re-roll (swap that person)"], ["n · x · Enter", "Review: note, score, open"],
  ];
  return (
    <div className="menu" ref={ref}>
      <button className="btn icon" aria-label="Help" title="Help (?)" onClick={() => store.setUI({ popover: open ? null : "help" })}>?</button>
      {open && (
        <div className="menu-pop help-pop" role="dialog" aria-label="Help">
          {game && (
            <ol className="help-list">
              <li>Press play. Lines are open opportunities.</li>
              <li>Shift-click 2-6 people, then Propose.</li>
              <li>Play as a member. The world pauses for you.</li>
              <li>Yeses, meetings and enjoyment score. Unsafe intros cost 150.</li>
            </ol>
          )}
          {game && <div className="small muted">+10 per yes · −2 per no · +100 × enjoyment per meeting · −15 per no-show · −150 per unsafe intro · −25 per peek</div>}
          <table className="keys"><tbody>{keys.map(([k, v]) => <tr key={k + v}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}</tbody></table>
          <div className="small muted">
            {s.ui.view === "map"
              ? "● member at home · gold dot = public venue · green circle = meetings · red = hold · orange = watch · dotted line = in review"
              : "◆ under 18 · white ring = busy · gold ring = you · double-click to fit"}
          </div>
          <div className="small muted">Fact border: green shareable · blue matchable · red agent private</div>
        </div>
      )}
    </div>
  );
}


// ---------------------------------------------------------------- filter bar
function FilterBar() {
  const s = useStore();
  const f = s.ui.filters;
  const game = !!s.env?.capabilities.canIntervene;
  const tab = s.ui.drawer;
  const dim = (k: FilterKey) => (s.ui.drawerOpen && !filterApplies(tab, k) ? { className: "fb-item na", title: `Does not apply to ${TAB_LABEL[tab]}` } : { className: "fb-item" });
  const origins = ["engine", "request", "plans", "second_encounter", "newcomer_welcome", game ? "player" : "shadow"];
  return (
    <div className="filterbar">
      <FocusChip />
      <div {...dim("range")}>
        <div className="seg" role="radiogroup" aria-label="Range">
          {RANGES.map(([k, l]) => <button key={k} className={f.range === k ? "active" : ""} onClick={() => store.setFilters({ range: k })}>{l}</button>)}
        </div>
      </div>
      <label {...dim("borough")}><span>Borough</span>
        <select className="input" value={f.borough} onChange={e => store.setFilters({ borough: e.target.value as Filters["borough"] })}>
          <option value="all">All</option>{BOROUGHS.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </label>
      <label {...dim("members")}><span>Members</span>
        <select className="input" value={f.members} onChange={e => store.setFilters({ members: e.target.value as MemberFilter })}>
          {MEMBER_FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      <label {...dim("origin")}><span>Origin</span>
        <select className="input" value={f.origin} onChange={e => store.setFilters({ origin: e.target.value })}>
          <option value="all">All</option>{origins.map(o => <option key={o} value={o}>{originLabel(o)}</option>)}
        </select>
      </label>
      <label {...dim("stateGroup")}><span>State</span>
        <select className="input" value={f.stateGroup} onChange={e => store.setFilters({ stateGroup: e.target.value as "all" | StateGroup })}>
          <option value="all">All</option>{STATE_GROUPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      {s.filtersChanged() && <button className="link small" onClick={() => store.resetFilters()}>Reset</button>}
    </div>
  );
}

function FocusChip() {
  const s = useStore();
  const f = s.ui.focus;
  if (!f) return null;
  const o = f.kind === "opportunity" ? s.opps.get(f.id) : undefined;
  const label = f.kind === "member" ? s.name(f.id) : o ? `${s.oppTitle(o)} · ${humanize(o.kind)}` : f.id;
  return (
    <span className="focus-chip">
      {s.focusHistory.length > 0 && <button aria-label="Back" title="Back to the last focus" onClick={() => store.back()}>←</button>}
      <span className="focus-label">{label}</span>
      <button aria-label="Clear focus" title="Clear focus (Esc)" onClick={() => store.clearFocus()}>×</button>
    </span>
  );
}

// ---------------------------------------------------------------- stage: NYC map or social graph
function GraphStage() {
  const s = useStore();
  return s.ui.view === "map" ? <MapStage /> : <GraphCanvas />;
}

function MapStage() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const m = new MapView(ref.current!);
    store.stage = m;
    return () => { m.destroy(); if (store.stage === m) store.stage = null; };
  }, []);
  return <div ref={ref} className="nyc-map" aria-label="Map of members in New York" />;
}

function GraphCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  useEffect(() => {
    const g = new GraphView(ref.current!);
    store.stage = g;
    g.onHover = (id, x, y) => setTip(id ? { id, x, y } : null);
    return () => { g.destroy(); if (store.stage === g) store.stage = null; };
  }, []);
  const s = useStore();
  const m = tip ? s.members.get(tip.id) : undefined;
  return (
    <>
      <canvas ref={ref} className="graph" aria-label="Social graph of members" />
      {m && tip && (
        <div className="tooltip" style={{ left: tip.x + 14, top: tip.y + 14 }}>
          <b>{m.name}</b> <span className="muted">· {m.area}</span>
          {m.minor && <span className="bad"> · Under 18</span>}
          {m.trust === "hold" && <span className="bad"> · hold</span>}
        </div>
      )}
    </>
  );
}

function Legend() {
  const s = useStore();
  const open = s.ui.legendOpen;
  const env = s.env;
  return (
    <div className={`legend ${open ? "" : "closed"}`}>
      <button className="legend-head" onClick={() => store.setUI({ legendOpen: !open })}>Layers {open ? "▾" : "▸"}</button>
      {open && (
        <>
          <select className="input" value={s.ui.colorBy} onChange={e => store.setUI({ colorBy: e.target.value as ColorLens })} aria-label="Color by">
            <option value="community">Community</option><option value="state">State</option><option value="activity">Activity</option>
            {s.truth && <option value="truth">Truth</option>}
          </select>
          {env?.capabilities.hiddenTruth && s.can("safety") && (
            <label className="legend-item" title="Reveal hidden ground truth to you only (audited; marks your score as assisted)">
              <input type="checkbox" checked={!!s.truth} onChange={async e => { const on = e.target.checked; if (!on && s.ui.colorBy === "truth") store.setUI({ colorBy: "community" }); if ((await store.control({ type: "lens", on })).ok) store.load(); }} /> Truth lens
            </label>
          )}
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
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- play
interface Peek { unsafe: boolean; compatible: boolean; flags: string[]; quality: number; participants: Record<string, { acceptProb: number }> }
function ProposeTray() {
  const s = useStore();
  const [category, setCategory] = useState<Category>("social");
  const [objective, setObjective] = useState("");
  const [why, setWhy] = useState("");
  const [peek, setPeek] = useState<Peek | null>(null);
  const picks = s.ui.picks;
  const busy = s.busy();
  const group = picks.length > 2;
  const g = s.game;
  const minor = picks.some(id => s.members.get(id)?.minor);
  const submit = async () => {
    const r = await store.control({ type: "propose", participants: picks, category, objective, why });
    if (r.ok) { store.toast(`Proposed. It ${(r.data as { dispatch?: string } | undefined)?.dispatch ?? "goes out soon"}.`, "good"); store.setUI({ picks: [] }); setPeek(null); setWhy(""); setObjective(""); }
  };
  return (
    <div className="tray">
      <div className="tray-people">
        {picks.map(id => {
          const m = s.members.get(id);
          return (
            <span key={id} className={`pick ${m?.minor ? "minor" : busy.has(id) ? "busy" : ""}`}>
              {m?.name ?? id}{busy.has(id) ? " · busy" : ""}{m?.minor ? " · under 18" : ""}
              <button aria-label="Remove" onClick={() => store.togglePick(id)}>×</button>
            </span>
          );
        })}
        {picks.length < 2 && <span className="muted small">Shift-click 1-5 more</span>}
      </div>
      {picks.length >= 2 && (
        <div className="tray-form">
          <select className="input" value={category} onChange={e => setCategory(e.target.value as Category)} aria-label="Category">{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>
          <input className="input grow" placeholder={group ? "Plan" : "Intro for"} value={objective} onChange={e => setObjective(e.target.value)} />
          <input className="input grow" placeholder="Why (shown to them)" value={why} onChange={e => setWhy(e.target.value)} />
          <button className="btn primary" disabled={!g || g.sparksLeft <= 0 || g.over || minor} title={minor ? "Members under 18 are never introduced" : undefined} onClick={submit}>Propose {group ? "group" : "intro"} · {g?.sparksLeft ?? 0} sparks</button>
          <button className="btn" onClick={async () => { const r = await store.control({ type: "peek", participants: picks }); if (r.ok) setPeek(r.data as Peek); }} title="Ask the oracle (−25 points)">Peek −25</button>
          <button className="btn ghost" onClick={() => { store.setUI({ picks: [] }); setPeek(null); }}>Clear</button>
        </div>
      )}
      {peek && (
        <div className={`callout small ${peek.unsafe ? "bad" : peek.compatible ? "good" : "warn"}`}>
          Oracle: {peek.unsafe ? `unsafe (${peek.flags.join(", ")})` : peek.compatible ? "a real fit" : "not a real fit"} · quality {(peek.quality * 100).toFixed(0)}% ·{" "}
          {Object.entries(peek.participants).map(([id, p]) => `${s.firstName(id)}: ${(p.acceptProb * 100).toFixed(0)}% yes`).join(" · ")}
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
      <div className="prompt-head"><b>As {m?.name.split(" ")[0]}</b> · paused{prompts.length > 1 ? ` · ${prompts.length} waiting` : ""}</div>
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

/** Shown when the API answers 401: paste the observatory token (kept for this tab only). */
function AuthPrompt() {
  const [t, setT] = useState("");
  return (
    <form className="auth-prompt" onSubmit={e => { e.preventDefault(); if (t.trim()) store.setToken(t); }}>
      <span>Token required</span>
      <input className="input" type="password" autoFocus placeholder="Paste token" aria-label="Observatory token" value={t} onChange={e => setT(e.target.value)} />
      <button className="btn primary" type="submit" disabled={!t.trim()}>Use</button>
    </form>
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

createRoot(document.getElementById("root")!).render(<App />);
