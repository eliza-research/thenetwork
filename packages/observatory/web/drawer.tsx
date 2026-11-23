// spec/consoleNavigation.md, "Each drawer tab shows only where it applies"
// spec/consoleNavigation.md, "A tab choice opens the drawer, and the open tab collapses it"
// spec/consoleNavigation.md, "The filter bar dims the filters that do not apply to the open tab"
// spec/consolePanels.md, "The feed segments group the event kinds"
// spec/consolePanels.md, "The mine segment exists only in the simulated world"
// spec/consolePanels.md, "The pipeline shows the columns of the state filter, and the ladder of a consent network"
// spec/consolePanels.md, "The runs tab shows a run, asks for two runs, or shows their difference"
// spec/consolePanels.md, "Compare opens only with two runs, and a third pick drops the oldest"
// spec/consolePanels.md, "The metrics tab shows truth numbers only in the simulated world, and bias and cost only on real data"
// spec/consolePanels.md, "The proactive rate and the inviter share show their targets"
// spec/consolePanels.md, "The game tab shows the score of the simulated world"
// spec/consolePanels.md, "Only an admin resets the world, chooses a level or chooses the reviewer"
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  canChooseFeedSegment, canPickRun, canReceiveDiff, canReceiveRuns, canResetWorld, canToggleCompare, chooseFeedSegment, columnShown, compareShown, feedEmptyNote,
  feedSegmentNow, feedSegmentOffered, feedShows, gameView, initial as initialPanels, ladderView, maxProactiveHundredths, maxRunPicks, metricsSectionShown, pickRun, proactiveWarns, receiveDiff,
  receiveRuns, runsView, toggleCompare, type ConsolePanels, type EventGroup, type FeedNote, type FeedSegment,
  type PipelineColumn, type RunCompare, type StateFilter,
} from "../../core/src/generated/consolePanels.ts";
import { panelStaffOf } from "./ops.tsx";
import {
  canChooseTab, canToggleDrawer, chooseTab, filterApplies as tabFilterApplies, tabNow, toggleDrawer,
  type ConsoleNav, type DrawerTab as NavTab, type FilterKey as NavFilterKey,
} from "../../core/src/generated/consoleNavigation.ts";
import {
  Alert, Button, Checkbox, cn, DataCell, DataTable, Disclosure, drawerTabLabel, DrawerTabs, EmptyState, focusRing, Input, InspectorSection, Kpi, KpiGrid, LorenzCurve,
  MeterBars, Segments, StatusMark, TableRow, type DrawerTabCount, type MeterRow, type MeterTone, type SegmentOption,
} from "@thenetwork/ui";
import type { EngineRunSummary, ObsFeedItem } from "../src/types.ts";
import { BiasMonitor, Config, Growth, Lab, Requests, RunDiffView, SafetyCases, Scorecard } from "./admin.tsx";
import { gamePanelsOf, Levels } from "./network.tsx";
import { CostPanel } from "./ops.tsx";
import { stateLabel } from "./panels.tsx";
import { MemberName, ReviewQueue, ScoreParts } from "./review.tsx";
import {
  COLUMNS, DAY, DRAWER_TABS, OPEN, originLabel, originOf, stateGroupOf, store, useStore, type DrawerTab, type FilterKey, type Opp,
} from "./store.ts";
import { dur, humanize, num, pct, shortDate, stamp } from "./ui.tsx";

/** The generated drawer tab of each stored tab. */
const navTab: Record<DrawerTab, NavTab> = {
  review: "ReviewTab", feed: "FeedTab", pipeline: "PipelineTab", requests: "RequestsTab", engine: "EngineTab",
  safety: "SafetyTab", metrics: "MetricsTab", lab: "LabTab", config: "ConfigTab", game: "GameTab",
};
/** The stored tab of each generated drawer tab. */
const storeTab = Object.fromEntries(DRAWER_TABS.map(t => [navTab[t], t])) as Record<NavTab, DrawerTab>;
/** The generated filter key of each stored filter. */
const navFilter: Record<FilterKey, NavFilterKey> = { range: "RangeKey", borough: "BoroughKey", members: "MembersKey", origin: "OriginKey", stateGroup: "StateKey" };

/** The name of each stored drawer tab: the generated tab's name. */
export const TAB_LABEL = Object.fromEntries(DRAWER_TABS.map(t => [t, drawerTabLabel[navTab[t]]])) as Record<DrawerTab, string>;
/** True when a global filter applies to a stored drawer tab: the generated `filterApplies`. */
export const filterApplies = (tab: DrawerTab, k: FilterKey) => tabFilterApplies(navTab[tab], navFilter[k]);

/** The console navigation state that the drawer reads: the store's `nav()`, with the queue facts through the generated `receiveQueues`. */
export function navOf(s: typeof store): ConsoleNav {
  return s.nav();
}

const panels: Record<NavTab, () => ReactNode> = {
  ReviewTab: () => <ReviewQueue />, FeedTab: () => <Feed />, PipelineTab: () => <Pipeline />, RequestsTab: () => <Requests />, EngineTab: () => <Engine />,
  SafetyTab: () => <Safety />, MetricsTab: () => <Metrics />, LabTab: () => <Lab />, ConfigTab: () => <Config />, GameTab: () => <Game />,
};

/**
 * The bottom drawer: review queue, live feed, opportunity pipeline with the consent ladder, requests, matching runs and their diff, safety, metrics, the simulation lab, configuration and the game. Every list goes through the store's filter and focus predicates. The generated navigation decides which tabs show and which tab is open.
 * @model spec/consoleNavigation.md
 */
export function Drawer() {
  const s = useStore();
  const nav = navOf(s);
  const now = s.now();
  const queued = [...s.opps.values()].filter(o => o.state === "IN_REVIEW");
  const dueSoon = queued.some(o => o.review && o.review.deadline - now < 3_600_000);
  const counts: Partial<Record<NavTab, DrawerTabCount>> = {
    ReviewTab: { value: s.network?.review?.queued ?? queued.length, tone: dueSoon ? "warn" : undefined, label: "waiting" },
    ...(s.game ? { GameTab: { value: `${s.game.scores.find(x => x.source === "player")?.points ?? 0} pts` } } : {}),
  };
  const save = (next: ConsoleNav) => store.setUI({ drawer: storeTab[next.wantedTab], drawerOpen: next.drawerOpen });
  return (
    <DrawerTabs
      nav={nav}
      counts={counts}
      onChooseTab={tab => { if (canChooseTab(nav, tab)) save(chooseTab(nav, tab)); }}
      onToggleDrawer={() => { if (canToggleDrawer(nav)) save(toggleDrawer(nav)); }}
    >
      {panels[tabNow(nav)]()}
    </DrawerTabs>
  );
}

const PEOPLE = new Set(["accept", "decline", "meeting", "outcome", "feedback", "proposal", "message", "invite", "probe", "request", "growth"]);
const SAFETY = new Set(["block", "opt_out", "adversarial", "invariant", "error", "trust"]);
const SYSTEM = new Set(["engine", "skip", "scenario", "game", "review"]);
/** The event group of a feed kind. */
const groupOf = (kind: string): EventGroup =>
  kind === "join" ? "JoinGroup" : PEOPLE.has(kind) ? "PeopleGroup" : SAFETY.has(kind) ? "SafetyGroup" : SYSTEM.has(kind) ? "SystemGroup" : "OtherGroup";
const SEGMENTS: { value: FeedSegment; label: string }[] = [
  { value: "AllEvents", label: "All" }, { value: "PeopleEvents", label: "People" }, { value: "SafetyEvents", label: "Safety" },
  { value: "SystemEvents", label: "System" }, { value: "MineEvents", label: "Mine" },
];
const FEED_NOTE: Record<FeedNote, string> = { PressPlayNote: "Nothing yet. Press play.", NoEventsInRangeNote: "No events in range.", NothingMatchesNote: "" };
const severityText: Record<NonNullable<ObsFeedItem["severity"]>, string> = { info: "text-muted-foreground", good: "text-ok", warn: "text-warn", bad: "text-destructive" };

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
    return <MemberName key={i} id={id}>{p}</MemberName>;
  });
  return <>{out}</>;
}

/** One feed event: its time, its kind in the color of its severity, and its text. With `onOpen` the row opens its subject. */
function FeedLine({ x, onOpen }: { x: ObsFeedItem; onOpen?: () => void }) {
  const tone = severityText[x.severity ?? "info"];
  const body = (
    <>
      <span className="w-28 shrink-0 text-muted-foreground tabular-nums">{stamp(x.t)}</span>
      <span className={cn("w-24 shrink-0 font-medium", tone)}>{humanize(x.kind)}</span>
      <span className="min-w-0 flex-1"><Linked x={x} /></span>
    </>
  );
  const row = "flex items-baseline gap-3 rounded-sm px-2 py-1 text-sm";
  return onOpen ? (
    <div role="button" tabIndex={0} className={cn(focusRing, row, "cursor-pointer hover:bg-accent")} onClick={onOpen} onKeyDown={e => { if (e.key === "Enter") onOpen(); }}>{body}</div>
  ) : <div className={row}>{body}</div>;
}

/**
 * The live feed: the generated segments group the event kinds, and the mine segment shows only in the simulated world.
 * @model spec/consolePanels.md
 */
function Feed() {
  const s = useStore();
  const staff = panelStaffOf(s);
  const [wanted, setWanted] = useState<FeedSegment>(initialPanels.feedSegment);
  const panels: ConsolePanels = { ...initialPanels, staff };
  const seg = feedSegmentNow(wanted, staff);
  const segs: SegmentOption[] = SEGMENTS.filter(x => feedSegmentOffered(x.value, staff));
  const player = (x: ObsFeedItem) => x.kind === "game" || (!!x.opportunityId && s.opps.get(x.opportunityId)?.source === "player");
  const items = s.feed.filter(x => feedShows(groupOf(x.kind), seg, player(x), s.feed.length) && s.matchFeed(x) && s.focusFeed(x)).slice(-150).reverse();
  const note = feedEmptyNote(!s.feed.length, !!s.env?.capabilities.canStep, !!s.ui.focus);
  const open = (x: ObsFeedItem) => {
    if (x.opportunityId && s.opps.has(x.opportunityId)) store.focus({ kind: "opportunity", id: x.opportunityId });
    else if (x.members?.[0]) store.focus({ kind: "member", id: x.members[0] });
  };
  return (
    <div className="flex flex-col gap-3">
      <Segments aria-label="Feed" value={seg} onValueChange={v => { if (canChooseFeedSegment(panels, v as FeedSegment)) setWanted(chooseFeedSegment(panels, v as FeedSegment).feedSegment); }} options={segs} className="self-start" />
      <div className="flex flex-col">
        {items.map(x => <FeedLine key={x.seq} x={x} onOpen={() => open(x)} />)}
        {!items.length && <EmptyState title={note === "NothingMatchesNote" ? s.nothing() : FEED_NOTE[note]} />}
      </div>
    </div>
  );
}

function Ladder() {
  const s = useStore();
  const n = s.network;
  const ladder = ladderView(!!n, n?.kind === "stub");
  if (ladder === "NoLadder" || !n) return null;
  if (ladder === "StubLadderNote") return <EmptyState title="Stub network: no consent data." />;
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
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" aria-label="Consent ladder">
      {steps.map(([k, v, t], i) => (
        <li key={k} title={t}>
          {i > 0 && <span aria-hidden className="text-muted-foreground">→ </span>}
          {k} <b className="font-semibold tabular-nums">{num(v)}</b>
        </li>
      ))}
    </ol>
  );
}

const STATE_FILTER: Record<"all" | ReturnType<typeof stateGroupOf>, StateFilter> = { all: "AnyState", review: "ReviewStates", open: "OpenStates", met: "MetStates", closed: "ClosedStates" };
const PIPELINE_COLUMN: Record<ReturnType<typeof stateGroupOf>, PipelineColumn> = { review: "ReviewColumn", open: "OpenColumn", met: "MetColumn", closed: "ClosedColumn" };

/**
 * The opportunity pipeline: the consent ladder and the columns that the generated state filter keeps.
 * @model spec/consolePanels.md
 */
function Pipeline() {
  const s = useStore();
  const f = s.ui.focus;
  const sg = s.ui.filters.stateGroup;
  const opps = [...s.opps.values()].filter(o => s.matchOpp(o) && (f?.kind === "opportunity" || s.focusOpp(o)));
  const cols = COLUMNS.filter(c => columnShown(STATE_FILTER[sg], PIPELINE_COLUMN[stateGroupOf(c.states[0]!)]));
  const rv = s.network?.review;
  return (
    <div className="flex flex-col gap-3">
      <Ladder />
      <div className="grid gap-3 overflow-x-auto" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(150px, 1fr))` }}>
        {cols.map(c => {
          const list = opps.filter(o => c.states.includes(o.state)).sort((a, b) => b.updatedAt - a.updatedAt);
          const oldest = c.id === "met" || c.id === "closed" ? undefined : Math.min(...list.map(o => o.stateSince ?? o.updatedAt));
          const focused = f?.kind === "opportunity" ? list.find(o => o.id === f.id) : undefined;
          const shown = list.slice(0, 30);
          if (focused && !shown.includes(focused)) shown.unshift(focused);
          return (
            <section className="flex min-w-0 flex-col gap-2" key={c.id} aria-label={c.title}>
              <div className="flex items-baseline gap-2 text-sm">
                <span className="font-semibold">{c.title}</span>
                {oldest !== undefined && Number.isFinite(oldest) && <span className="text-muted-foreground" title="Longest time in this column">oldest {dur(Math.max(0, s.now() - oldest))}</span>}
                <b className="ml-auto font-semibold tabular-nums">{num(list.length)}</b>
              </div>
              {c.id === "closed" && list.length > 0 && <p className="text-sm text-muted-foreground">{Object.entries(count(list, o => o.state)).map(([k, v]) => `${humanize(k)} ${v}`).join(" · ")}</p>}
              {c.id === "review" && rv && <p className="text-sm text-muted-foreground" title="Review decisions so far">approved {rv.approved} · rejected {rv.rejected} · expired {rv.expired}</p>}
              <div className="flex flex-col gap-2">{shown.map(o => <OppCard key={o.id} o={o} focused={o.id === focused?.id} />)}</div>
            </section>
          );
        })}
      </div>
      {!opps.length && <EmptyState title={s.nothing()} />}
    </div>
  );
}

/** One opportunity in a pipeline column. The focused card scrolls into view. */
function OppCard({ o, focused }: { o: Opp; focused: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (focused) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [focused]);
  const closed = !OPEN.has(o.state);
  const inState = store.now() - (o.stateSince ?? o.updatedAt);
  return (
    <Button
      ref={ref}
      variant="outline"
      aria-pressed={focused}
      className={cn("h-auto flex-col items-start gap-1 bg-card p-2 text-left whitespace-normal text-card-foreground", focused ? "border-primary" : "border-border")}
      onClick={() => store.focus({ kind: "opportunity", id: o.id })}
    >
      <span className="font-medium">{store.oppTitle(o)}</span>
      <span className="text-muted-foreground">{originLabel(originOf(o))}{closed ? ` · ${o.reason ? humanize(o.reason) : stateLabel(o.state).toLowerCase()}` : ` · ${dur(Math.max(0, inState))}`}</span>
    </Button>
  );
}
const count = <T,>(xs: T[], f: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => { m[f(x)] = (m[f(x)] ?? 0) + 1; return m; }, {});

/** Bars from a record of counts, named with `humanize`. */
const rowsOf = (data: Record<string, number>, tone?: MeterTone, label: (k: string) => string = humanize): MeterRow[] =>
  Object.entries(data).map(([k, v]) => ({ key: k, label: label(k), value: v, title: k, tone }));

/**
 * The runs tab: one run, or two picked runs and their difference. The generated run comparison decides what shows; the shell keeps the picked run ids in pick order.
 * @model spec/consolePanels.md
 */
function Engine() {
  const s = useStore();
  const f = s.ui.focus;
  const runs = s.runs.filter(r => s.inRange(r.at) && s.focusRun(r)).reverse();
  const [sel, setSel] = useState<string>();
  const [compare, setCompare] = useState<{ model: RunCompare; ids: string[] }>({ model: initialPanels.runs, ids: [] });
  const panelsWith = (model: RunCompare): ConsolePanels => ({ ...initialPanels, runs: model });
  useEffect(() => {
    setCompare(c => {
      if (!canReceiveRuns(panelsWith(c.model), runs.length)) return c;
      const model = receiveRuns(panelsWith(c.model), runs.length).runs;
      return { model, ids: model.picked === 0 ? [] : c.ids };
    });
  }, [runs.length]);
  const model: RunCompare = { ...compare.model, runTotal: runs.length };
  const panels = panelsWith(model);
  const view = runsView(model);
  const focusRunId = f?.kind === "opportunity" ? s.opps.get(f.id)?.runId : undefined;
  const run = runs.find(r => r.id === (focusRunId ?? sel)) ?? runs.find(r => r.id === sel) ?? runs[0];
  if (view === "NoRunsView" || !run) return <EmptyState title={s.runs.length ? s.nothing() : "No runs yet."} />;
  const toggle = () => { if (canToggleCompare(panels)) setCompare({ model: toggleCompare(panels).runs, ids: [] }); };
  const pick = (id: string) => {
    const already = compare.ids.includes(id);
    if (!canPickRun(panels, already)) return;
    setCompare({ model: pickRun(panels, already).runs, ids: already ? compare.ids.filter(x => x !== id) : [...compare.ids, id].slice(-maxRunPicks) });
  };
  const answer = (loaded: boolean) => setCompare(c => (canReceiveDiff(panelsWith(c.model)) ? { ...c, model: receiveDiff(panelsWith(c.model), loaded).runs } : c));
  const pair = compare.ids.length === maxRunPicks ? compare.ids.map(id => s.runs.find(r => r.id === id)!).filter(Boolean).sort((a, b) => a.at - b.at) : [];
  const runText = (r: EngineRunSummary) => <>{stamp(r.at)} <span className="text-muted-foreground">· {r.proposals} proposals{r.shadow ? " · shadow" : ""}</span></>;
  return (
    <div className="flex gap-4">
      <div className="flex w-60 shrink-0 flex-col gap-1">
        {compareShown(panels) && (
          <Button variant={model.comparing ? "secondary" : "outline"} size="sm" aria-pressed={model.comparing} onClick={toggle} title="Pick two runs to compare">{model.comparing ? "Close compare" : "Compare two"}</Button>
        )}
        {runs.map(r => model.comparing ? (
          <label key={r.id} className={cn("flex items-center gap-2 rounded-sm px-2 py-1 text-sm", compare.ids.includes(r.id) && "bg-accent text-accent-foreground")}>
            <Checkbox checked={compare.ids.includes(r.id)} onCheckedChange={() => pick(r.id)} /> {runText(r)}
          </label>
        ) : (
          <Button key={r.id} variant="ghost" size="sm" aria-pressed={r.id === run.id} className={cn("justify-start", r.id === run.id && "bg-accent text-accent-foreground")} onClick={() => setSel(r.id)}>
            {runText(r)}
          </Button>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        {view === "RunDetailView" ? <RunDetail run={run} />
          : view === "PickTwoView" || pair.length !== 2 ? <EmptyState title="Pick two runs." />
          : <RunDiffView a={pair[0]!.id} b={pair[1]!.id} view={view} onAnswer={answer} />}
      </div>
    </div>
  );
}

function RunDetail({ run }: { run: EngineRunSummary }) {
  const s = useStore();
  const f = run.funnel;
  const funnel: MeterRow[] = [["candidates generated", f.generated], ["passed hard filters", f.passedHardFilters], ["after dedupe", f.passedHardFilters - f.deduped], ["eligible (above threshold)", f.eligible], ["selected", f.selected]]
    .map(([k, v]) => ({ key: k as string, label: k as string, value: v as number }));
  const focus = s.ui.focus;
  const focusOpp = focus?.kind === "opportunity" ? s.opps.get(focus.id) : undefined;
  const key = (ids: string[]) => [...ids].sort().join("|");
  const hl = (ps: string[]) => (focus?.kind === "member" && ps.includes(focus.id)) || (!!focusOpp && key(ps) === key(focusOpp.participants));
  const gates = s.network?.gateReasons;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <InspectorSection title={`Funnel · ${run.engineVersion} · ${run.wallMs} ms`}>
          <MeterBars aria-label="Funnel" rows={funnel} ranked={false} max={Math.max(1, f.generated)} format={num} />
          <p className="text-sm text-muted-foreground">{f.belowThreshold} below threshold · {f.budgetSkips} skipped for budget/load · {f.dealbreakers} dealbreakers · {f.exploration} exploration picks</p>
        </InspectorSection>
        <InspectorSection title="Generators: candidates → proposals">
          <DataTable columns={[{ key: "generator", label: "Generator" }, { key: "candidates", label: "Candidates", numeric: true }, { key: "proposals", label: "Proposals", numeric: true }]}>
            {Object.entries(run.byGenerator).sort((a, b) => b[1] - a[1]).map(([g, n]) => (
              <TableRow key={g}><DataCell>{humanize(g)}</DataCell><DataCell numeric muted>{num(n)}</DataCell><DataCell numeric className="font-semibold">{run.proposalsByGenerator[g] ?? 0}</DataCell></TableRow>
            ))}
          </DataTable>
        </InspectorSection>
        <InspectorSection title="Why candidates were filtered">
          <MeterBars rows={rowsOf(run.rejectedBy, "warn")} limit={10} empty={s.nothing()} />
        </InspectorSection>
        {gates && Object.keys(gates).length > 0 && (
          <InspectorSection title="Gate reasons">
            <MeterBars rows={rowsOf(gates, "warn")} limit={10} empty={s.nothing()} />
          </InspectorSection>
        )}
        <InspectorSection title="Fairness of exposure">
          <div className="flex flex-wrap items-start gap-4">
            <LorenzCurve points={run.fairness.lorenz} />
            <KpiGrid compact className="min-w-0 flex-1">
              <Kpi label="gini" value={run.fairness.gini.toFixed(2)} title="Gini of proposal exposure across eligible members" />
              <Kpi label="top 10% share" value={pct(run.fairness.top10Share)} title="Share of proposals that went to the top 10% of members" />
              <Kpi label="no proposal" value={pct(run.fairness.zeroExposureShare)} title="Eligible members with no proposal" />
              <Kpi label="newcomer coverage" value={pct(run.fairness.newcomerCoverage)} title="Newcomers who got at least one proposal" />
            </KpiGrid>
          </div>
          <p className="text-sm text-muted-foreground">{run.emptyStates} intents with nothing: {Object.entries(run.emptyStatesByReason).map(([k, v]) => `${humanize(k)} ${v}`).join(" · ") || "none"}</p>
        </InspectorSection>
      </div>
      <InspectorSection title="Top configurations">
        <div className="flex flex-col gap-1">
          {run.top.slice(0, 16).map(t => (
            <Disclosure
              key={t.key}
              className={cn("rounded-sm px-2 py-1", hl(t.participants) && "bg-accent text-accent-foreground")}
              summary={
                <span className={cn("flex flex-wrap items-center gap-3", !t.selected && "font-normal")}>
                  <span className="font-mono tabular-nums">{t.score.toFixed(3)}</span>
                  <span>{t.participants.map(p => store.firstName(p)).join(" · ")}</span>
                  <span className="text-muted-foreground">{humanize(t.generator)}</span>
                  {t.selected
                    ? <StatusMark tone="ok" label="selected" showLabel />
                    : <StatusMark tone={t.eligible ? "warn" : "neutral"} label={t.eligible ? "lost in selection" : humanize(t.reason ?? "ineligible")} showLabel />}
                </span>
              }
            >
              <span className="flex flex-wrap gap-2">{t.participants.map(p => <MemberName key={p} id={p} />)}</span>
              <ScoreParts c={t.components} />
            </Disclosure>
          ))}
        </div>
      </InspectorSection>
    </div>
  );
}

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
    <div className="flex flex-col gap-4">
      <KpiGrid className="lg:grid-cols-4">
        {abuse !== undefined && <Kpi label="abuse handled" value={num(abuse)} title="Spam, sales, money asks, contact extraction, prompt injection and pressure, refused and scored" />}
        <Kpi label="on watch" value={num(members.filter(m => m.trust === "watch").length)} tone={members.some(m => m.trust === "watch") ? "warn" : undefined} onSelect={() => store.setFilters({ members: "watch" })} />
        <Kpi label="on hold" value={num(members.filter(m => m.trust === "hold").length)} tone={members.some(m => m.trust === "hold") ? "destructive" : undefined} onSelect={() => store.setFilters({ members: "hold" })} />
        <Kpi label="blocks" value={num(st?.blocks ?? 0)} />
        <Kpi label="opt-outs" value={num(st?.optOuts ?? 0)} tone={st?.optOuts ? "warn" : undefined} />
        <Kpi label="invariant violations" value={num(violations)} tone={violations ? "destructive" : "ok"} title={j ? "Judge-derived count" : "Counted by the observatory"} />
        {j && <Kpi label="canary leaks" value={num(j.canaryLeaks)} tone={j.canaryLeaks ? "destructive" : "ok"} title="Judge-derived: planted private facts that reached another member" />}
        {j && <Kpi label="minor contacts" value={num(j.minorContacts)} tone={j.minorContacts ? "destructive" : "ok"} title="Judge-derived: members under 18 contacted about another member" />}
      </KpiGrid>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <InspectorSection title={`Watch and hold (${flagged.length})`}>
          {flagged.length ? flagged.slice(0, 50).map(m => {
            const e = last(m.id);
            return (
              <div className="flex min-w-0 items-center gap-2 text-sm" key={m.id}>
                <MemberName id={m.id} />
                {m.trust === "hold" ? <StatusMark tone="destructive" label="Hold" showLabel /> : <StatusMark tone="warn" label="Watch" showLabel />}
                <span className="min-w-0 truncate text-muted-foreground">{e ? `${shortDate(e.t)} · ${e.text}` : ""}</span>
              </div>
            );
          }) : <EmptyState title={s.nothing()} />}
        </InspectorSection>
        {j?.byRule && Object.keys(j.byRule).length > 0 && <InspectorSection title="Violations by rule"><MeterBars rows={rowsOf(j.byRule, "destructive")} empty={s.nothing()} /></InspectorSection>}
        {!s.can("safety") && <InspectorSection title="Safety events">
          <div className="flex flex-col">
            {events.map(x => <FeedLine key={x.seq} x={x} />)}
            {!events.length && <EmptyState title={s.nothing()} />}
          </div>
        </InspectorSection>}
      </div>
      {s.can("safety") && <SafetyCases />}
    </div>
  );
}

function Metrics() {
  const s = useStore();
  const st = s.stats;
  if (!st) return null;
  const weeks = Math.max(1 / 7, ((s.clock?.now ?? 0) - (s.clock?.start ?? 0)) / (7 * DAY));
  const staff = panelStaffOf(s);
  const game = metricsSectionShown("TruthSection", staff);
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
    <div className="flex flex-col gap-4">
      <KpiGrid className="lg:grid-cols-4">
        <Kpi label="messages / member / week" value={(st.messages / Math.max(1, st.joined) / weeks).toFixed(1)} />
        <Kpi label="proactive / member / week" value={proactive.toFixed(2)} tone={proactiveWarns(Math.ceil(proactive * 100)) ? "warn" : undefined} title={`Budget: normal ≤ ${maxProactiveHundredths / 100} proactive messages per member per week`} />
        <Kpi label="invite yes rate" value={pct(inviteYes)} title={n?.kind === "consent" ? "Yes answers to revealed invitations" : "Accepts per invite sent"} />
        <Kpi label={`show rate · ${st.noShows} no-shows · ${st.cancelledWithNotice} with notice`} value={pct(showDen ? st.attended / showDen : 0)} />
        <Kpi label="mean enjoyment" value={st.enjoymentN ? pct(st.enjoymentSum / st.enjoymentN) : "–"} />
        <Kpi label="members who met someone" value={num([...s.members.values()].filter(m => m.counters.meetings > 0).length)} />
        {game && <Kpi label="precision (truth)" value={pct(st.oracleJudged ? st.compatible / st.oracleJudged : 0)} title="Proposals the hidden truth says were truly compatible" />}
        {game && <Kpi label="unsafe" value={num(st.unsafe)} tone={st.unsafe ? "destructive" : "ok"} title="Proposals the hidden truth says were unsafe" />}
        <Kpi label="opt-outs" value={num(st.optOuts)} tone={st.optOuts ? "warn" : undefined} />
      </KpiGrid>
      {n?.kind === "consent" && (
        <div className="flex flex-col gap-1 text-sm">
          <p>requests {num(n.requests.total)} · fulfilled {num(n.requests.fulfilled)} · plans {num(n.requests.plans)}</p>
          {!st.growth && <p>growth asks {num(c("growthAsks"))} · invites {num(c("invitesSent"))} · joined {num(c("inviteesJoined"))}</p>}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {st.scorecard && <InspectorSection title="Scorecard (PRD 28.2)"><Scorecard rows={st.scorecard} /></InspectorSection>}
        <Growth />
        {metricsSectionShown("BiasSection", staff) && <InspectorSection title="Bias monitor (weekly)"><BiasMonitor /></InspectorSection>}
        {metricsSectionShown("CostSection", staff) && <InspectorSection title="Cost (estimated)"><CostPanel /></InspectorSection>}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <InspectorSection title="Proposals by origin"><MeterBars rows={rowsOf(byOrigin, undefined, k => k)} empty={s.nothing()} /></InspectorSection>
        <InspectorSection title="Relationships learned"><MeterBars rows={rowsOf(Object.fromEntries(learned.map(k => [k, st.edgesByType[k] ?? 0])))} empty={s.nothing()} /></InspectorSection>
        <InspectorSection title="Members by state"><MeterBars rows={rowsOf(byState)} empty={s.nothing()} /></InspectorSection>
      </div>
    </div>
  );
}

/**
 * The game tab of the simulated world: the scoreboard, the missions, the levels and the player's run. Only an admin resets the world or chooses the reviewer.
 * @model spec/consolePanels.md
 */
function Game() {
  const s = useStore();
  const g = s.game;
  const [resetSeed, setResetSeed] = useState(1);
  const panels = gamePanelsOf(s);
  const view = gameView(panels.game);
  if (view === "NoGameView" || !g) return <EmptyState title="The game runs in the simulated world only." />;
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <InspectorSection title="Scoreboard">
        <DataTable columns={[
          { key: "player", label: "Player", hideLabel: true },
          { key: "points", label: "points", numeric: true, title: "+10 per yes · −2 per no · +100 × enjoyment per meeting · −15 per no-show · −150 per unsafe intro (minor, adversarial, exes, romance mismatch) · −25 per oracle peek" },
          { key: "perProposal", label: "per proposal", numeric: true }, { key: "proposals", label: "proposals", numeric: true }, { key: "accepted", label: "said yes", numeric: true },
          { key: "meetings", label: "meetings", numeric: true }, { key: "enjoyment", label: "enjoyment", numeric: true }, { key: "precision", label: "precision", numeric: true }, { key: "unsafe", label: "unsafe", numeric: true },
        ]}>
          {g.scores.map(r => (
            <TableRow key={r.source} className={cn(r.source === "player" && "bg-accent text-accent-foreground")}>
              <DataCell><span className="flex items-center gap-2"><b className="font-semibold">{r.label}</b>{r.source === "player" && g.lensUsed ? <StatusMark tone="warn" label="assisted" showLabel /> : null}</span></DataCell>
              <DataCell numeric>{num(r.points)}</DataCell><DataCell numeric>{r.perProposal.toFixed(1)}</DataCell><DataCell numeric>{r.proposals}</DataCell><DataCell numeric>{r.accepted}</DataCell><DataCell numeric>{r.meetings}</DataCell>
              <DataCell numeric>{r.meetings ? pct(r.meanEnjoyment) : "–"}</DataCell><DataCell numeric>{r.proposals ? pct(r.precision) : "–"}</DataCell><DataCell numeric className={cn(r.unsafe && "text-destructive")}>{r.unsafe}</DataCell>
            </TableRow>
          ))}
        </DataTable>
      </InspectorSection>
      <InspectorSection title="Missions">
        <ul className="flex flex-col gap-2">
          {g.missions.map(m => (
            <li key={m.id} className={cn("flex items-start gap-2 text-sm", m.done && "text-muted-foreground")}>
              <StatusMark tone={m.done ? "ok" : "neutral"} label={m.done ? "Done" : "Not done"} className="mt-1" />
              <div><b className="font-semibold">{m.title}</b><p className="text-muted-foreground">{m.description}</p><p>{m.progress}</p></div>
            </li>
          ))}
        </ul>
      </InspectorSection>
      <Levels />
      <InspectorSection title="Your run">
        <KpiGrid compact>
          <Kpi label="sparks left today" value={`${g.sparksLeft}/${g.sparksPerDay}`} />
          <Kpi label="safety strikes" value={`${g.strikes}/${g.maxStrikes}`} tone={g.strikes ? "destructive" : "ok"} />
          <Kpi label="oracle peeks" value={g.peeks} />
        </KpiGrid>
        {view === "GameOverView" && <Alert variant="destructive">Game over: three safety strikes.</Alert>}
        {canResetWorld(panels, false) && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm">seed <Input type="number" value={resetSeed} onChange={e => setResetSeed(Number(e.target.value))} className="w-20" /></label>
            <Button variant="outline" size="sm" onClick={() => store.control({ type: "reset", seed: resetSeed, engine: "engine-v1" })}>New world vs engine-v1</Button>
            <Button variant="outline" size="sm" onClick={() => store.control({ type: "reset", seed: resetSeed, engine: "random" })}>vs random baseline</Button>
            <Button variant="outline" size="sm" onClick={() => store.control({ type: "reset", seed: resetSeed, engine: "off" })}>Solo (no engine)</Button>
          </div>
        )}
      </InspectorSection>
    </div>
  );
}
