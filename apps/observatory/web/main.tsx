// spec/consoleNavigation.md, "The console view follows the page"
// spec/consoleNavigation.md, "Escape closes one thing at a time"
// spec/consoleNavigation.md, "Search offers names and places from two characters and ids from three"
// spec/consoleNavigation.md, "The filter bar dims the filters that do not apply to the open tab"
// spec/staffSignIn.md, "Each sign-in phase has one view"
// spec/consoleWorkspace.md, "The propose tray sends a proposal for two to six adults with a spark left"
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Category } from "@thenetwork/core";
import { NEIGHBORHOODS } from "@thenetwork/network/geo";
import {
  Alert, AppSwitcher, BrandMark, Button, ConsoleShell, DataCell, DataTable, FilterBar, FilterBarFocus, Input, Legend, LegendItem, ModeIndicator, Popover, PopoverContent,
  PopoverTrigger, ProposeTray, SearchBox, Segments, Select, SelectItem, SignInNotice, Spinner, TableRow, Toast, Toaster, TopBar,
  type DataColumn, type FilterBarItem,
} from "@thenetwork/ui";
import { ntwrkBrand } from "../../../packages/core/src/generated/brandIdentity.ts";
import {
  backShown, canTypeQuery, type ConsoleNav, conversationSearchShown, type HitGroups, hitGroups, modeSwitchShown, searchShown, switcherShown, tabNow, viewFor,
} from "../../../packages/core/src/generated/consoleNavigation.ts";
import { canReceiveProposalAnswer, canSubmitProposal, groupProposal, initial as initialWorkspace, proposalFormShown, receiveProposalAnswer, submitProposal, trayShown, type TrayPhase } from "../../../packages/core/src/generated/consoleWorkspace.ts";
import { signInView } from "../../../packages/core/src/generated/staffSignIn.ts";
import type { EnvInfo, Mode, SearchHit } from "../src/types.ts";
import { AppPage } from "./apps.tsx";
import { Drawer } from "./drawer.tsx";
import { EDGE_STYLE, GraphView } from "./graph.ts";
import { MapView } from "./map.ts";
import { Inspector } from "./panels.tsx";
import {
  BOROUGHS, DAY, EDGE_TYPES, HOUR, MEMBER_FILTERS, originLabel, RANGES, STATE_GROUPS, store, useStore,
  type ColorLens, type Filters, type MemberFilter, type RangeKey, type StateGroup,
} from "./store.ts";
import { consoleNav, humanize, localDate, localTime, NAV_FILTER, pickMember, staffSignIn, staffView, stamp } from "./ui.tsx";

const SPEEDS: [string, number][] = [["1h/s", HOUR], ["6h/s", 6 * HOUR], ["1d/s", DAY], ["2d/s", 2 * DAY]];
const CATEGORIES: Category[] = ["social", "professional", "hobby", "help", "romance", "growth", "events"];
const TOAST_VARIANT = { info: "info", good: "ok", bad: "destructive" } as const;

export function App() {
  const s = useStore();
  const [token, setToken] = useState("");
  useEffect(() => {
    store.load();
    store.connect();
    return () => { store.disconnect(); };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const field = (e.target as Element | null)?.closest?.("input, textarea, select");
      if (e.key === "Escape") { store.escape(); if (field && !store.ui.query) (field as HTMLElement).blur(); return; }
      if (field || e.metaKey || e.ctrlKey || e.altKey) return;
      const canStep = !!store.env?.capabilities.canStep && store.canSim();
      if (e.key === "/") { e.preventDefault(); document.getElementById("obs-search")?.focus(); }
      else if (e.key === "?") store.toggleHelp();
      else if (e.key === "g") store.showStage(store.ui.view === "map" ? "graph" : "map");
      else if (e.key === " " && canStep) {
        if ((e.target as Element | null)?.closest?.("button, [role=button]")) return;
        e.preventDefault(); store.control({ type: store.clock?.playing ? "pause" : "play" });
      }
      else if (e.key === "n" && canStep) store.control({ type: "step", ms: HOUR });
      else if (e.key === "d" && canStep) store.control({ type: "step", ms: DAY });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const signIn = staffSignIn(s);
  if (signInView(signIn.phase) !== "ShowConsole") {
    return (
      <main className="flex h-full items-center justify-center bg-background p-4 font-sans text-foreground">
        <SignInNotice
          signIn={signIn} token={token} onTokenChange={setToken} brand={<ConsoleBrand />}
          onSubmitToken={t => { store.setToken(t); setToken(""); }} onSignInAgain={() => location.reload()} onRetry={() => store.load()}
        />
        <Toasts />
      </main>
    );
  }
  const nav = consoleNav(s);
  const view = viewFor(nav);
  return (
    <ConsoleShell
      view={view}
      topBar={<ConsoleTopBar nav={nav} />}
      filterBar={<ConsoleFilterBar nav={nav} />}
      stage={<Stage nav={nav} />}
      inspector={<Inspector />}
      drawer={<Drawer />}
      page={<AppPage view={view} />}
      overlay={<Toasts />}
    />
  );
}

function ConsoleBrand() {
  return <><BrandMark logo={ntwrkBrand.logo} className="size-6" /> Observatory</>;
}

/** The short banner of the app and the data, such as "SLOP · SIM · seed 1" or "NTWRK · PROD · read-only"; the full label goes on hover. */
function banner(env?: EnvInfo): { text: string; title: string } {
  if (!env) return { text: "…", title: "" };
  const app = env.app ? `${env.app.toUpperCase()} · ` : "";
  const title = [env.label, env.dataset, env.database, env.appIsolation === "rls_role" ? "app read role" : env.appIsolation === "app_filter" ? "app filter" : "", env.piiRevealed ? "PII revealed" : "", env.authRequired ? "Token required" : ""].filter(Boolean).join(" · ");
  if (env.capabilities.canStep) { const seed = /seed (\d+)/.exec(env.label)?.[1]; return { text: `${app}${seed ? `SIM · seed ${seed}` : "SIM"}`, title }; }
  const where = /^LOCAL/.test(env.label) ? "LOCAL DB" : /^PRODUCTION/.test(env.label) ? "PROD" : /not connected/i.test(env.label) ? "NOT CONNECTED" : env.label.split(" · ")[0]!;
  return { text: `${app}${where}${/not connected/i.test(env.label) ? "" : " · read-only"}${env.piiRevealed ? " · PII" : ""}`, title };
}

function ConsoleTopBar({ nav }: { nav: ConsoleNav }) {
  const s = useStore();
  const c = s.clock;
  const canStep = !!s.env?.capabilities.canStep;
  const b = s.page.kind === "app" ? banner(s.env) : { text: `ALL APPS · ${s.mode === "real" ? "real data" : "simulation"}`, title: "Every app you hold a role for" };
  const me = s.me;
  const onApp = searchShown(nav);
  const end = (
    <>
      {onApp && (
        <Segments
          aria-label="View" value={s.ui.view} onValueChange={v => store.showStage(v as "map" | "graph")}
          options={[{ value: "map", label: "Map" }, { value: "graph", label: "Graph" }]}
        />
      )}
      {onApp && <Search nav={nav} />}
      {me && (
        <span className="text-sm whitespace-nowrap text-muted-foreground" title={`${me.id} · ${me.via === "sso" ? "single sign-on" : "token"} · ${(me.grants ?? []).map(g => `${g.role}@${g.app}`).join(", ")}`}>
          {(s.rolesHere().length ? s.rolesHere() : me.roles).join(" · ")}
        </span>
      )}
      <HelpPopover nav={nav} />
    </>
  );
  return (
    <TopBar brand={<ConsoleBrand />} end={end}>
      {switcherShown(nav) && (
        <AppSwitcher page={nav.page} app={s.app} apps={s.apps().map(a => ({ id: a.id, title: a.domain }))} onSelectApp={id => store.setApp(id)} onOpenAllApps={() => store.setApp("all")} />
      )}
      {modeSwitchShown(nav) && (
        <Segments aria-label="Mode" value={s.mode} onValueChange={v => store.setMode(v as Mode)} options={[{ value: "game", label: "Game" }, { value: "real", label: "Real" }]} />
      )}
      <ModeIndicator mode={nav.viewer.mode} label={b.text} details={b.title} connected={s.connected} />
      {c && <span className="text-sm font-semibold whitespace-nowrap tabular-nums">{canStep ? `Day ${c.day} · ` : ""}{localDate(c.now)} · {localTime(c.now)}</span>}
      <Transport />
    </TopBar>
  );
}

const icon = { "aria-hidden": true, viewBox: "0 0 16 16", className: "size-4" } as const;

/** Play, step and speed in the simulated world; refresh and the shadow run on real data. */
function Transport() {
  const s = useStore();
  const c = s.clock, env = s.env;
  if (!env) return null;
  const busy = c?.busy ? <span className="animate-pulse text-sm whitespace-nowrap text-primary">{c.busy}…</span> : null;
  if (env.capabilities.canStep && c) {
    if (!s.canSim()) return busy;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon" aria-label={c.playing ? "Pause" : "Play"} title="Play or pause (space)" onClick={() => store.control({ type: c.playing ? "pause" : "play" })}>
          <svg {...icon} fill="currentColor">{c.playing ? <path d="M4 3h3v10H4zM9 3h3v10H9z" /> : <path d="M4 2.5v11L13 8z" />}</svg>
        </Button>
        <Button variant="outline" size="sm" title="Step one hour (n)" onClick={() => store.control({ type: "step", ms: HOUR })}>+1h</Button>
        <Button variant="outline" size="sm" title="Step one day (d)" onClick={() => store.control({ type: "step", ms: DAY })}>+1d</Button>
        <Select className="h-8 w-24" aria-label="Speed" value={String(c.speed)} onValueChange={v => store.control({ type: "speed", speed: Number(v) })}>
          {SPEEDS.map(([l, v]) => <SelectItem key={l} value={String(v)}>{l}</SelectItem>)}
        </Select>
        {busy}
        {c.waitingForPlayer && <span className="animate-pulse text-sm whitespace-nowrap text-warn">waiting for you</span>}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="icon" title="Refresh" aria-label="Refresh" onClick={() => store.control({ type: "refresh" })}>
        <svg {...icon} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 8a5 5 0 1 1-1.5-3.5M13 2v3h-3" /></svg>
      </Button>
      {s.can("analyst") && (
        <Button
          variant="outline" size="sm" title="Run engine-v1 on this data without sending anything"
          onClick={async () => { const r = await store.control({ type: "shadow_run" }); if (r.ok) store.toast(`Shadow run: ${(r.data as { proposals?: number } | undefined)?.proposals ?? 0} proposals (nothing sent)`, "good"); }}
        >
          Shadow run
        </Button>
      )}
      {busy}
    </div>
  );
}

type Hit = { key: string; label: string; meta: string; go(): void };
/** Best first within a group: an exact name, then a name that starts with the query, then a name that only contains it. Stable within each rank. */
function matchRank(name: string, q: string): number {
  const n = name.toLowerCase();
  return n === q ? 0 : n.startsWith(q) ? 1 : 2;
}
/** The members, neighborhoods and opportunity ids that match the query (at most 5 + 3 + 3, best first), in the groups that the generated `hitGroups` allows. */
function searchHits(query: string, groups: HitGroups): Hit[] {
  const hits: Hit[] = [];
  if (groups === "NoHits") return hits;
  const q = query.trim().toLowerCase();
  const memberRank = (m: { name: string; id: string }): number => Math.min(matchRank(m.name, q), m.id === q ? 0 : 2);
  const members = [...store.members.values()]
    .filter(m => m.name.toLowerCase().includes(q) || m.id === q)
    .sort((a, b) => memberRank(a) - memberRank(b))
    .slice(0, 5);
  for (const m of members) hits.push({ key: `m${m.id}`, label: m.name, meta: m.area ?? "", go: () => store.pickHit({ kind: "member", id: m.id }) });
  for (const n of NEIGHBORHOODS.filter(n => n.name.toLowerCase().includes(q)).sort((a, b) => matchRank(a.name, q) - matchRank(b.name, q)).slice(0, 3)) hits.push({ key: `n${n.name}`, label: n.name, meta: n.borough, go: () => store.pickHit({ kind: "neighborhood", id: n.name }) });
  if (groups === "NamesPlacesAndIds") {
    const matching = [...store.opps.values()].filter(o => o.id.toLowerCase().includes(q))
      .sort((a, b) => matchRank(a.id, q) - matchRank(b.id, q)).slice(0, 3);
    for (const o of matching) {
      hits.push({ key: `o${o.id}`, label: store.oppTitle(o), meta: o.id.slice(0, 12), go: () => store.pickHit({ kind: "opportunity", id: o.id }) });
    }
  }
  return hits;
}

/** Names, neighborhoods and ids as staff type. Safety staff can also search the conversations (the messages of the Network and system events, never what a member wrote); every such search is logged. */
function Search({ nav }: { nav: ConsoleNav }) {
  const s = useStore();
  const q = s.ui.query.trim();
  const [conv, setConv] = useState<{ q: string; hits?: SearchHit[]; error?: string } | null>(null);
  const shown = conv && conv.q === q ? conv : null;
  const groups = hitGroups(nav.queryChars);
  const canConv = conversationSearchShown(nav.viewer.safety, nav.queryChars);
  const hits = shown ? [] : searchHits(s.ui.query, groups);
  const done = () => { store.setUI({ query: "" }); setConv(null); document.getElementById("obs-search")?.blur(); };
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
  const conversation = shown && {
    query: shown.q,
    error: shown.error,
    hits: shown.hits?.map((h, i) => ({
      key: String(i), label: h.memberName, snippet: h.snippet,
      meta: `${stamp(h.t)} · ${h.kind === "message" ? `Network${h.type ? ` · ${humanize(h.type)}` : ""}` : humanize(h.type ?? "event")}`,
    })),
  };
  return (
    <SearchBox
      value={s.ui.query} onValueChange={v => { if (canTypeQuery(nav)) store.setUI({ query: v }); }} groups={groups} hits={hits}
      onPick={h => { hits.find(x => x.key === h.key)?.go(); done(); }}
      conversationSearch={canConv} onSearchConversations={runConv} conversation={conversation}
      onPickConversation={h => { const x = shown?.hits?.[Number(h.key)]; if (x) openHit(x); }} onCloseConversation={() => setConv(null)}
      hint={nav.viewer.safety ? "Members, neighborhoods, ids (/). Shift+Enter: search conversations (logged)" : "Members, neighborhoods, opportunity ids (/)"}
    />
  );
}

/** The help popover: how to play (game), the keyboard map and the symbol key. */
/** The columns of the keyboard table in the help popover. */
const HELP_COLUMNS: DataColumn[] = [{ key: "keys", label: "Keys", hideLabel: true }, { key: "action", label: "Action", hideLabel: true }];

function HelpPopover({ nav }: { nav: ConsoleNav }) {
  const s = useStore();
  const open = nav.popoverOpen && s.ui.popover === "help";
  const game = !!s.env?.capabilities.canIntervene;
  const keys: [string, string][] = [
    ["/", "Search"], ["Esc", "Close, clear search, clear picks, clear focus"], ["g", "Map or graph"], ["?", "This help"],
    ...(s.env?.capabilities.canStep && s.canSim() ? [["space", "Play or pause"], ["n", "+1 hour"], ["d", "+1 day"]] as [string, string][] : []),
    ["j / k", "Review: next, previous"], ["a", "Review: approve"], ["r 1-8", "Review: reject with a reason"], ["e", "Review: edit what each person is told"],
    ["s 1-6", "Review: re-roll (swap that person)"], ["n · x · Enter", "Review: note, score, open"],
  ];
  return (
    <Popover open={open} onOpenChange={o => store.setUI({ popover: o ? "help" : null })}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Help" title="Help (?)">?</Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label="Help" className="flex w-80 flex-col gap-2 text-sm">
        {game && (
          <ol className="flex list-decimal flex-col gap-1 pl-5">
            <li>Press play. Lines are open opportunities.</li>
            <li>Shift-click 2-6 people, then Propose.</li>
            <li>Play as a member. The world pauses for you.</li>
            <li>Yeses, meetings and enjoyment score. Unsafe intros cost 150.</li>
          </ol>
        )}
        {game && <p className="text-muted-foreground">+10 per yes · −2 per no · +100 × enjoyment per meeting · −15 per no-show · −150 per unsafe intro · −25 per peek</p>}
        <DataTable columns={HELP_COLUMNS}>
          {keys.map(([k, v]) => (
            <TableRow key={k + v}>
              <DataCell className="align-top"><kbd className="rounded-sm border border-border px-1 font-mono text-muted-foreground">{k}</kbd></DataCell>
              <DataCell>{v}</DataCell>
            </TableRow>
          ))}
        </DataTable>
        <p className="text-muted-foreground">
          {s.ui.view === "map"
            ? "● member at home · small faint dot = public venue · green circle = meetings · red = hold · amber = watch · dotted line = in review"
            : "◆ under 18 · thin ring = busy · amber ring = you · double-click to fit"}
        </p>
        <p className="text-muted-foreground">Fact border: green shareable · blue matchable · red agent private</p>
      </PopoverContent>
    </Popover>
  );
}

function ConsoleFilterBar({ nav }: { nav: ConsoleNav }) {
  const s = useStore();
  const f = s.ui.filters;
  const game = !!s.env?.capabilities.canIntervene;
  const origins = ["engine", "request", "plans", "second_encounter", "newcomer_welcome", game ? "player" : "shadow"];
  const choose = (label: string, value: string, onChange: (v: string) => void, options: [string, string][]) => (
    <Select className="h-8 w-36" aria-label={label} value={value} onValueChange={onChange}>
      {options.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
    </Select>
  );
  const items: FilterBarItem[] = [
    { filterKey: NAV_FILTER.range, control: <Segments aria-label="Range" value={f.range} onValueChange={v => store.setFilters({ range: v as RangeKey })} options={RANGES.map(([k, l]) => ({ value: k, label: l }))} /> },
    { filterKey: NAV_FILTER.borough, label: "Borough", control: choose("Borough", f.borough, v => store.setFilters({ borough: v as Filters["borough"] }), [["all", "All"], ...BOROUGHS.map(b => [b, b] as [string, string])]) },
    { filterKey: NAV_FILTER.members, label: "Members", control: choose("Members", f.members, v => store.setFilters({ members: v as MemberFilter }), MEMBER_FILTERS) },
    { filterKey: NAV_FILTER.origin, label: "Origin", control: choose("Origin", f.origin, v => store.setFilters({ origin: v }), [["all", "All"], ...origins.map(o => [o, originLabel(o)] as [string, string])]) },
    { filterKey: NAV_FILTER.stateGroup, label: "State", control: choose("State", f.stateGroup, v => store.setFilters({ stateGroup: v as "all" | StateGroup }), [["all", "All"], ...STATE_GROUPS.map(([k, l]) => [k, l] as [string, string])]) },
  ];
  const focus = s.ui.focus;
  const o = focus?.kind === "opportunity" ? s.opps.get(focus.id) : undefined;
  const label = !focus ? null : focus.kind === "member" ? s.name(focus.id) : o ? `${s.oppTitle(o)} · ${humanize(o.kind)}` : focus.id;
  return (
    <FilterBar
      drawerOpen={nav.drawerOpen} tab={tabNow(nav)} items={items}
      focus={label === null ? undefined : <FilterBarFocus label={label} backShown={backShown(nav)} onBack={() => store.back()} onClear={() => store.clearFocus()} />}
      onReset={s.filtersChanged() ? () => store.resetFilters() : undefined}
    />
  );
}

/** The map or the graph, with the layers, the member prompt, the propose tray and the load spinner over it. */
function Stage({ nav }: { nav: ConsoleNav }) {
  const s = useStore();
  return (
    <>
      {nav.stage === "MapStage" ? <MapStage /> : <GraphCanvas />}
      <ConsoleLegend />
      {s.game?.prompts.length && s.canSim() ? <Prompts /> : null}
      {trayShown(staffView(s), s.ui.picks.length) && <Tray />}
      {s.loading && <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"><Spinner label="Loading" /></div>}
    </>
  );
}

function MapStage() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const m = new MapView(ref.current!);
    store.stage = m;
    return () => { m.destroy(); if (store.stage === m) store.stage = null; };
  }, []);
  return <div ref={ref} data-map className="absolute inset-0 isolate bg-muted" aria-label="Map of members in New York" />;
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
      <canvas ref={ref} className="absolute inset-0 size-full cursor-grab touch-none" aria-label="Social graph of members" />
      {m && tip && (
        <div className="pointer-events-none absolute z-10 max-w-72 rounded-md border border-border bg-popover px-2.5 py-2 text-sm text-popover-foreground shadow-md" style={{ left: tip.x + 14, top: tip.y + 14 }}>
          <span className="font-semibold">{m.name}</span> <span className="text-muted-foreground">· {m.area}</span>
          {m.minor && <span className="text-destructive"> · Under 18</span>}
          {m.trust === "hold" && <span className="text-destructive"> · hold</span>}
        </div>
      )}
    </>
  );
}

function ConsoleLegend() {
  const s = useStore();
  return (
    <Legend className="absolute top-2.5 left-14 z-20" open={s.ui.legendOpen} onOpenChange={open => store.setUI({ legendOpen: open })}>
      <Select aria-label="Color by" value={s.ui.colorBy} onValueChange={v => store.setUI({ colorBy: v as ColorLens })}>
        <SelectItem value="community">Community</SelectItem>
        <SelectItem value="state">State</SelectItem>
        <SelectItem value="activity">Activity</SelectItem>
        {s.truth && <SelectItem value="truth">Truth</SelectItem>}
      </Select>
      {s.env?.capabilities.hiddenTruth && s.can("safety") && (
        <LegendItem
          label="Truth lens" title="Reveal hidden ground truth to you only (audited; marks your score as assisted)" checked={!!s.truth}
          onCheckedChange={async on => { if (!on && s.ui.colorBy === "truth") store.setUI({ colorBy: "community" }); if ((await store.control({ type: "lens", on })).ok) store.load(); }}
        />
      )}
      {EDGE_TYPES.map(t => (
        <LegendItem
          key={t} label={humanize(t)} tone={EDGE_STYLE[t].ink} count={s.stats?.edgesByType[t] ?? 0} checked={!!s.ui.edgeTypes[t]}
          onCheckedChange={on => store.setUI({ edgeTypes: { ...s.ui.edgeTypes, [t]: on } })}
        />
      ))}
      <LegendItem label="open opportunities" tone="primary" dashedLine checked={s.ui.showOpps} onCheckedChange={on => store.setUI({ showOpps: on })} />
    </Legend>
  );
}

interface Peek { unsafe: boolean; compatible: boolean; flags: string[]; quality: number; participants: Record<string, { acceptProb: number }> }

function Tray() {
  const s = useStore();
  const [category, setCategory] = useState<Category>("social");
  const [objective, setObjective] = useState("");
  const [why, setWhy] = useState("");
  const [peek, setPeek] = useState<Peek | null>(null);
  const [tray, setTray] = useState<TrayPhase>("TrayIdle");
  const picks = s.ui.picks;
  const busy = s.busy();
  const g = s.game;
  const minor = picks.some(id => s.members.get(id)?.minor);
  const sparks = g?.sparksLeft ?? 0;
  const over = !!g?.over;
  const w = { ...initialWorkspace, staff: staffView(s), tray };
  const submit = async () => {
    if (!canSubmitProposal(w, picks.length, minor, sparks, over)) return;
    const sending = submitProposal(w, picks.length, minor, sparks, over);
    setTray(sending.tray);
    const r = await store.control({ type: "propose", participants: picks, category, objective, why });
    if (canReceiveProposalAnswer(sending)) setTray(receiveProposalAnswer(sending, r.ok).tray);
    if (r.ok) { store.toast(`Proposed. It ${(r.data as { dispatch?: string } | undefined)?.dispatch ?? "goes out soon"}.`, "good"); store.setUI({ picks: [] }); setPeek(null); setWhy(""); setObjective(""); }
  };
  return (
    <ProposeTray
      className="absolute inset-x-4 bottom-4 z-20 mx-auto max-w-3xl"
      phase={tray}
      picks={picks.map(id => { const m = s.members.get(id); return { id, name: m?.name ?? id, minor: m?.minor, busy: busy.has(id) }; })}
      formShown={proposalFormShown(picks.length)}
      group={groupProposal(picks.length)}
      canPropose={canSubmitProposal(w, picks.length, minor, sparks, over)}
      minorPicked={minor}
      sparksLeft={sparks}
      categories={CATEGORIES}
      category={category} onCategoryChange={c => setCategory(c as Category)}
      objective={objective} onObjectiveChange={setObjective}
      why={why} onWhyChange={setWhy}
      onPropose={submit}
      onPeek={async () => { const r = await store.control({ type: "peek", participants: picks }); if (r.ok) setPeek(r.data as Peek); }}
      onClear={() => { store.setUI({ picks: [] }); setPeek(null); }}
      onRemove={id => pickMember(id)}
      peek={peek && (
        <Alert variant={peek.unsafe ? "destructive" : peek.compatible ? "ok" : "warn"}>
          Oracle: {peek.unsafe ? `unsafe (${peek.flags.join(", ")})` : peek.compatible ? "a real fit" : "not a real fit"} · quality {(peek.quality * 100).toFixed(0)}% ·{" "}
          {Object.entries(peek.participants).map(([id, p]) => `${s.firstName(id)}: ${(p.acceptProb * 100).toFixed(0)}% yes`).join(" · ")}
        </Alert>
      )}
    />
  );
}

function Prompts() {
  const s = useStore();
  const prompts = s.game?.prompts ?? [];
  const [text, setText] = useState("");
  const p = prompts[0];
  if (!p) return null;
  const m = s.members.get(p.memberId);
  const first = m?.name.split(" ")[0];
  const reply = (t?: string, auto?: boolean) => { store.control({ type: "reply", promptId: p.id, text: t, auto }); setText(""); };
  const quick = p.type === "proposal" ? ["Yes, I'm in!", "No thanks, not right now."]
    : p.type === "feedback_request" ? ["It was great, would meet again.", "It was fine.", "Not a good fit honestly."]
    : p.type === "reminder" || p.type === "scheduling" ? ["Sounds good, see you then.", "Sorry, I can't make it."]
    : ["Thanks!"];
  return (
    <div role="dialog" aria-label={`Message for ${m?.name}`} className="absolute top-4 right-4 z-20 flex w-full max-w-sm flex-col gap-2 rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg">
      <p className="text-muted-foreground"><span className="font-semibold text-foreground">As {first}</span> · paused{prompts.length > 1 ? ` · ${prompts.length} waiting` : ""}</p>
      <div className="flex flex-col gap-1 rounded-md bg-muted p-2">
        <span className="text-muted-foreground">The Network{p.type ? ` · ${humanize(p.type)}` : ""}</span>
        <span className="break-words whitespace-pre-wrap">{p.body}</span>
      </div>
      <div className="flex flex-wrap gap-2">{quick.map(q => <Button key={q} variant="outline" size="sm" onClick={() => reply(q)}>{q}</Button>)}</div>
      <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); if (text.trim()) reply(text); }}>
        <Input className="min-w-40 flex-1" autoFocus aria-label={`Reply as ${first}`} placeholder={`Reply as ${first}…`} value={text} onChange={e => setText(e.target.value)} />
        <Button type="submit">Send</Button>
        <Button variant="ghost" title="Let the persona's own policy answer" onClick={() => reply(undefined, true)}>Let them decide</Button>
      </form>
    </div>
  );
}

function Toasts() {
  const s = useStore();
  const t = s.ui.toast;
  const [, force] = useState(0);
  useEffect(() => { if (!t) return; const h = setTimeout(() => force(x => x + 1), 4200); return () => clearTimeout(h); }, [t?.at]);
  const shown = t && Date.now() - t.at <= 4000 ? t : null;
  return (
    <Toaster>
      {shown && <Toast variant={TOAST_VARIANT[shown.tone]} onDismiss={() => store.setUI({ toast: undefined })}>{shown.text}</Toast>}
    </Toaster>
  );
}

const rootElement = typeof document !== "undefined" ? document.getElementById("root") : null;
if (rootElement) createRoot(rootElement).render(<App />);
