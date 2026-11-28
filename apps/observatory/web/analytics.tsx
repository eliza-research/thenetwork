import { useEffect, useMemo, useState } from "react";
import {
  Alert, Button, CohortMatrix, DataCell, DataTable, EmptyState, FactLine, FunnelChart, HeatmapGrid, Input, InspectorSection, Kpi, KpiGrid, MeterBars, Segments, Select, SelectItem,
  SliceExplorer, StatusMark, TableRow, TimeSeriesChart, TraceWaterfall,
  type CohortDriver, type CohortRow as UiCohortRow, type DataColumn, type FunnelStep as UiFunnelStep, type HeatmapMetric, type MeterRow, type SliceOption, type SliceQuery as UiSliceQuery,
  type SliceTableRow, type TimeSeriesSeries, type TraceSpan,
} from "@thenetwork/ui";
import type {
  CohortMatrix as CoreCohortMatrix, FunnelResult, OutreachHeatmap, SliceDimension, SliceGranularity, SliceMetric, SliceResult,
} from "../../../packages/core/src/analytics/types.ts";
import { ladderView, maxProactiveHundredths, metricsSectionShown, proactiveWarns } from "../../../packages/core/src/generated/consolePanels.ts";
import { BiasMonitor, Growth, Scorecard } from "./admin.tsx";
import { CostPanel, panelStaffOf } from "./ops.tsx";
import {
  DAY, originLabel, originOf, store, useStore,
  type AnalyticsAnomaliesResponse, type AnalyticsTimeseriesResponse, type MockChaosRule, type MockTrafficResponse, type TrajectoriesListResponse, type TrajectoryDetailResponse,
} from "./store.ts";
import { downloadTextFile, dur, humanize, num, pct, stamp } from "./ui.tsx";

type AnalyticsSubTab = "overview" | "cohorts" | "heatmap" | "trajectories" | "explorer";

function rowsOf(data: Record<string, number>, label: (k: string) => string = humanize): MeterRow[] {
  return Object.entries(data).map(([k, v]) => ({ key: k, label: label(k), value: v, title: k }));
}

function deltaOf(values: number[]): { value: string; tone: "ok" | "warn" | "destructive" | "muted" } | undefined {
  if (values.length < 2) return undefined;
  const last = values.at(-1) ?? 0;
  const prev = values.at(-2) ?? 0;
  if (prev === 0) return last === 0 ? { value: "0%", tone: "muted" } : { value: `+${num(last)}`, tone: "ok" };
  const change = (last - prev) / Math.abs(prev);
  const sign = change >= 0 ? "+" : "";
  return { value: `${sign}${(change * 100).toFixed(0)}%`, tone: change > 0.02 ? "ok" : change < -0.05 ? "warn" : "muted" };
}

export function PipelineFunnel() {
  const s = useStore();
  const n = s.network;
  const ladder = ladderView(!!n, n?.kind === "stub");
  const [funnel, setFunnel] = useState<FunnelResult | null>(null);
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const city = s.selectedCity === "all" ? undefined : s.selectedCity;
  useEffect(() => {
    let live = true;
    void store.analyticsFunnel({ city, fromMs: Number.isFinite(s.rangeStart()) ? s.rangeStart() : undefined }).then(r => {
      if (live && r.data) setFunnel(r.data);
    });
    return () => { live = false; };
  }, [s.app, s.mode, city, s.ui.filters.range, s.version]);

  const fallbackSteps: UiFunnelStep[] = useMemo(() => {
    if (!n) return [];
    const c = (k: string) => n.counters[k] ?? 0;
    const candidates = c("engineProposals");
    const passed = Math.max(0, candidates - (c("gatedOut") - (n.gateReasons.daily_cap ?? 0)));
    const rv = n.review;
    return [
      { key: "candidates", label: "Candidates", count: candidates, title: "Engine candidates generated" },
      { key: "passed_gate", label: "Passed gate", count: passed, title: "Passed skeptical gate" },
      ...(rv ? [
        { key: "in_review", label: "In review", count: rv.queued + rv.approved + rv.rejected + rv.expired, title: `${rv.queued} open · ${rv.rejected} rejected · ${rv.expired} expired` },
        { key: "approved", label: "Approved", count: rv.approved, title: "Approved by judge or staff" },
      ] : []),
      { key: "probed", label: "Probed", count: c("probesSent"), title: "Availability probes sent" },
      { key: "probe_yes", label: "Probe yes", count: c("probeYes"), title: `${c("probeExpired")} unanswered` },
      { key: "revealed", label: "Revealed", count: c("oppsRevealed"), title: `${c("replacements")} alternates swapped in` },
      { key: "all_yes", label: "Everyone yes", count: c("oppsAllYes"), title: "All participants accepted" },
      { key: "scheduled", label: "Scheduled", count: c("scheduled"), title: "Booked meetings" },
      { key: "met", label: "Met", count: s.stats?.meetingsHeld ?? 0, title: "Completed IRL meetings" },
    ];
  }, [n, s.stats?.meetingsHeld]);

  if (ladder === "StubLadderNote") return <EmptyState title="Stub network: no consent data." />;

  const apiHasCounts = !!funnel && funnel.steps.some(st => st.count > 0);
  const steps: UiFunnelStep[] = apiHasCounts
    ? funnel!.steps.map(st => ({
      key: st.stage,
      label: humanize(st.stage),
      count: st.suppressed ? 0 : st.count,
      medianLatency: st.medianTimeFromPrevMs !== null ? dur(st.medianTimeFromPrevMs) : undefined,
      title: st.suppressed ? `Suppressed (<${funnel!.kFloor})` : `${pct(st.conversionFromStart)} from start`,
    }))
    : fallbackSteps;

  if (!steps.length) return null;

  const dropOffRows: MeterRow[] = (funnel?.dropOffReasons ?? [])
    .filter(d => !d.suppressed && d.count > 0)
    .map(d => ({ key: d.reason, label: humanize(d.reason), value: d.count, tone: "warn", title: `${pct(d.share)} of drop-offs` }));

  return (
    <div className="flex flex-col gap-2">
      <FunnelChart
        steps={steps}
        onSelectStep={step => setSelectedStep(prev => (prev === step.key ? null : step.key))}
        onInspectDropOff={step => setSelectedStep(step.key)}
      />
      {selectedStep && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="font-medium">Drop-off & gate breakdown · {humanize(selectedStep)}</span>
            <Button variant="ghost" size="sm" onClick={() => setSelectedStep(null)}>Close</Button>
          </div>
          {dropOffRows.length > 0 ? (
            <MeterBars aria-label="Drop-off reasons" rows={dropOffRows} limit={8} format={num} />
          ) : n && Object.keys(n.gateReasons).length > 0 ? (
            <MeterBars aria-label="Gate reasons" rows={rowsOf(n.gateReasons)} limit={8} format={num} />
          ) : (
            <p className="text-sm text-muted-foreground">No drop-off reasons recorded for this stage yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function AnalyticsWorkspace() {
  const s = useStore();
  const [sub, setSub] = useState<AnalyticsSubTab>("overview");
  if (!s.stats) return null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segments
          aria-label="Analytics view"
          value={sub}
          onValueChange={v => setSub(v as AnalyticsSubTab)}
          options={[
            { value: "overview", label: "Overview & Trends" },
            { value: "cohorts", label: "Cohorts" },
            { value: "heatmap", label: "Demand & Heatmap" },
            { value: "trajectories", label: "Trajectories" },
            { value: "explorer", label: "Explorer" },
          ]}
        />
      </div>
      {sub === "overview" && <OverviewTrends />}
      {sub === "cohorts" && <CohortsView />}
      {sub === "heatmap" && <DemandHeatmapView />}
      {sub === "trajectories" && <TrajectoriesView />}
      {sub === "explorer" && <ExplorerView />}
    </div>
  );
}

function OverviewTrends() {
  const s = useStore();
  const st = s.stats!;
  const [granularity, setGranularity] = useState<"hour" | "day" | "week">("day");
  const [variant, setVariant] = useState<"line" | "area" | "bar">("area");
  const [ts, setTs] = useState<AnalyticsTimeseriesResponse | null>(null);
  const [anomalies, setAnomalies] = useState<AnalyticsAnomaliesResponse | null>(null);
  const city = s.selectedCity === "all" ? undefined : s.selectedCity;

  useEffect(() => {
    let live = true;
    void store.analyticsTimeseries(granularity, { city }).then(r => { if (live && r.data) setTs(r.data); });
    void store.analyticsAnomalies().then(r => { if (live && r.data) setAnomalies(r.data); });
    return () => { live = false; };
  }, [s.app, s.mode, city, granularity, s.version]);

  const weeks = Math.max(1 / 7, ((s.clock?.now ?? 0) - (s.clock?.start ?? 0)) / (7 * DAY));
  const staff = panelStaffOf(s);
  const game = metricsSectionShown("TruthSection", staff);
  const n = s.network;
  const learned = ["introduced", "met", "enjoyed", "would_interact_again", "avoid", "blocked"];
  const proactiveRate = st.scorecard?.find(m => m.key === "attention_burden")?.value;
  const proactiveHundredths = proactiveRate != null && Number.isFinite(proactiveRate)
    ? Math.ceil(Math.round(proactiveRate * 1000) / 10)
    : null;
  const showDen = st.attended + st.noShows + st.cancelledWithNotice;
  const c = (k: string) => n?.counters[k] ?? 0;
  const inviteYes = n?.kind === "consent" ? (c("reveals") ? c("revealYes") / c("reveals") : 0) : st.invites ? st.accepts / st.invites : 0;
  const byOrigin: Record<string, number> = {};
  for (const o of s.opps.values()) if (o.source !== "shadow" && s.inRange(o.createdAt) && s.matchOpp(o, { range: true, members: true, stateGroup: true })) { const k = originLabel(originOf(o)); byOrigin[k] = (byOrigin[k] ?? 0) + 1; }
  const byState: Record<string, number> = {};
  let metSomeone = 0;
  for (const m of s.members.values()) {
    if (!s.inBorough(m) || !s.matchMemberDomain(m)) continue;
    byState[m.state] = (byState[m.state] ?? 0) + 1;
    if (m.counters.meetings > 0) metSomeone++;
  }

  const pointsOf = (key: string) => (ts?.series?.[key] ?? []).map(p => p.value);
  const labels = ts?.labels ?? [];
  const allSeries: TimeSeriesSeries[] = [
    { id: "signups", label: "Signups", values: pointsOf("signups"), color: "chart-1", format: num },
    { id: "visits", label: "Visits", values: pointsOf("visits"), color: "chart-2", format: num },
    { id: "proposals", label: "Proposals", values: pointsOf("proposals"), color: "chart-3", format: num },
    { id: "meetings", label: "Meetings", values: pointsOf("meetings"), color: "chart-4", format: num },
    { id: "messages", label: "Messages", values: pointsOf("messages"), color: "chart-5", format: num },
    { id: "stops", label: "STOPs", values: pointsOf("stops"), color: "chart-6", format: num },
  ];
  const chartSeries = allSeries.filter(sr => sr.values.length > 0);

  return (
    <div className="flex flex-col gap-4">
      {anomalies && anomalies.alerts.length > 0 && (
        <div className="flex flex-col gap-2">
          {anomalies.alerts.slice(0, 4).map(a => (
            <Alert key={a.id} variant={a.severity === "critical" ? "destructive" : a.severity === "warn" ? "warn" : "info"}>
              <span className="font-medium">{humanize(a.metric)}:</span> {a.message} (observed {a.observed.toFixed(2)} vs expected {a.expected.toFixed(2)})
            </Alert>
          ))}
        </div>
      )}
      <KpiGrid className="lg:grid-cols-4">
        <Kpi label="messages / member / week" value={(st.messages / Math.max(1, st.joined) / weeks).toFixed(1)} sparkline={pointsOf("messages")} delta={deltaOf(pointsOf("messages"))} />
        <Kpi
          label="proactive / member / week"
          value={proactiveHundredths === null ? "–" : (proactiveHundredths / 100).toFixed(2)}
          tone={proactiveHundredths !== null && proactiveWarns(proactiveHundredths) ? "warn" : undefined}
          target={maxProactiveHundredths / 100}
          title={proactiveHundredths !== null ? "Observed membership time from PRD 28.2 scorecard" : `Budget: normal <= ${maxProactiveHundredths / 100} proactive messages per member per week`}
        />
        <Kpi label="invite yes rate" value={pct(inviteYes)} sparkline={pointsOf("proposals")} delta={deltaOf(pointsOf("proposals"))} title={n?.kind === "consent" ? "Yes answers to revealed invitations" : "Accepts per invite sent"} />
        <Kpi label={`show rate · ${st.noShows} no-shows · ${st.cancelledWithNotice} with notice`} value={pct(showDen ? st.attended / showDen : 0)} sparkline={pointsOf("meetings")} delta={deltaOf(pointsOf("meetings"))} />
        <Kpi label="mean enjoyment" value={st.enjoymentN ? pct(st.enjoymentSum / st.enjoymentN) : "–"} />
        <Kpi label="members who met someone" value={num(metSomeone)} sparkline={pointsOf("signups")} delta={deltaOf(pointsOf("signups"))} title="Members in the selected area with at least one held meeting, all time" />
        {game && <Kpi label="precision (truth)" value={pct(st.oracleJudged ? st.compatible / st.oracleJudged : 0)} title="Proposals the hidden truth says were truly compatible" />}
        {game && <Kpi label="unsafe" value={num(st.unsafe)} tone={st.unsafe ? "destructive" : "ok"} title="Proposals the hidden truth says were unsafe" />}
        <Kpi label="opt-outs" value={num(st.optOuts)} tone={st.optOuts ? "warn" : undefined} sparkline={pointsOf("stops")} />
      </KpiGrid>

      <InspectorSection
        title="Activity & outcome trends"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Segments aria-label="Granularity" value={granularity} onValueChange={v => setGranularity(v as "hour" | "day" | "week")} options={[{ value: "hour", label: "Hourly" }, { value: "day", label: "Daily" }, { value: "week", label: "Weekly" }]} />
            <Segments aria-label="Chart type" value={variant} onValueChange={v => setVariant(v as "line" | "area" | "bar")} options={[{ value: "area", label: "Area" }, { value: "line", label: "Line" }, { value: "bar", label: "Bar" }]} />
          </div>
        }
      >
        <TimeSeriesChart labels={labels} series={chartSeries} variant={variant} empty="Run the simulation or widen the range to populate trend series." />
      </InspectorSection>

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
        <InspectorSection title="Proposals by origin"><MeterBars rows={rowsOf(byOrigin, k => k)} empty={s.nothing()} /></InspectorSection>
        <InspectorSection title="Relationships learned"><MeterBars rows={rowsOf(Object.fromEntries(learned.map(k => [k, st.edgesByType[k] ?? 0])))} empty={s.nothing()} /></InspectorSection>
        <InspectorSection title="Members by state"><MeterBars rows={rowsOf(byState)} empty={s.nothing()} /></InspectorSection>
      </div>
    </div>
  );
}

function CohortsView() {
  const s = useStore();
  const [data, setData] = useState<CoreCohortMatrix | null>(null);
  const [error, setError] = useState("");
  const city = s.selectedCity === "all" ? undefined : s.selectedCity;
  useEffect(() => {
    let live = true;
    void store.analyticsCohorts({ city }).then(r => {
      if (!live) return;
      if (r.data) { setData(r.data); setError(""); }
      else setError(r.error ?? "Could not load cohort matrix");
    });
    return () => { live = false; };
  }, [s.app, s.mode, city, s.version]);

  if (error) return <Alert variant="destructive">{error}</Alert>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading cohorts…</p>;

  const columns = data.horizons.map(h => `D${h}`);
  const rows: UiCohortRow[] = data.rows.map(r => ({
    key: r.cohortWeek,
    label: r.cohortWeek,
    size: r.cohortSize,
    retention: data.horizons.map(h => (r.suppressed ? null : r.retention[h] ?? null)),
  }));
  const drivers: CohortDriver[] = data.drivers
    .filter(d => !d.suppressed)
    .map(d => ({
      key: d.driverId,
      label: d.label,
      liftPct: Math.round(d.lift * 100),
      sampleSize: d.exposedCount,
      title: `Exposed D30: ${pct(d.exposedD30Rate)} vs baseline ${pct(d.baselineD30Rate)}`,
    }));

  return (
    <InspectorSection title="Retention cohorts & drivers">
      <CohortMatrix columns={columns} rows={rows} minCohortSize={data.kFloor} drivers={drivers} />
    </InspectorSection>
  );
}

const templateColumns: DataColumn[] = [
  { key: "template", label: "Template" },
  { key: "channel", label: "Channel" },
  { key: "sent", label: "Sent", numeric: true },
  { key: "reply", label: "Reply", numeric: true },
  { key: "conv", label: "Convert", numeric: true },
  { key: "stop", label: "STOP", numeric: true },
];

const demandColumns: DataColumn[] = [
  { key: "lane", label: "Desire lane" },
  { key: "open", label: "Open 7d", numeric: true },
  { key: "fulfilled", label: "Fulfilled 7d", numeric: true },
  { key: "unfulfilled", label: "Unfulfilled", numeric: true },
];

function DemandHeatmapView() {
  const s = useStore();
  const [heatmap, setHeatmap] = useState<OutreachHeatmap | null>(null);
  const [anomalies, setAnomalies] = useState<AnalyticsAnomaliesResponse | null>(null);
  const [error, setError] = useState("");
  const city = s.selectedCity === "all" ? undefined : s.selectedCity;

  useEffect(() => {
    let live = true;
    void store.analyticsHeatmap({ city }).then(r => {
      if (!live) return;
      if (r.data) { setHeatmap(r.data); setError(""); }
      else setError(r.error ?? "Could not load heatmap");
    });
    void store.analyticsAnomalies().then(r => { if (live && r.data) setAnomalies(r.data); });
    return () => { live = false; };
  }, [s.app, s.mode, city, s.version]);

  if (error) return <Alert variant="destructive">{error}</Alert>;
  if (!heatmap) return <p className="text-sm text-muted-foreground">Loading heatmap…</p>;

  const gridOf = (pick: (cell: OutreachHeatmap["cells"][number]) => number) => {
    const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    for (const cell of heatmap.cells) {
      if (cell.dayOfWeek >= 0 && cell.dayOfWeek < 7 && cell.hour >= 0 && cell.hour < 24) {
        grid[cell.dayOfWeek]![cell.hour] = pick(cell);
      }
    }
    return grid;
  };

  const metrics: HeatmapMetric[] = [
    { key: "sent", label: "Activity / Sent", values: gridOf(c => c.sent), format: num },
    { key: "reply", label: "Reply rate", values: gridOf(c => c.replyRate), format: v => pct(v, 1) },
    { key: "conversion", label: "Conversion", values: gridOf(c => c.conversionRate), format: v => pct(v, 1) },
    { key: "stop", label: "STOP rate", values: gridOf(c => c.stopRate), format: v => pct(v, 1) },
    { key: "rate429", label: "429 rate", values: gridOf(c => c.rateLimit429Rate), format: v => pct(v, 1) },
  ];

  const intentDemand = anomalies?.intentDemand ?? [];

  return (
    <div className="flex flex-col gap-6">
      <InspectorSection title={`7×24 activity, response & STOP heatmap (${num(heatmap.totalSent)} sends)`}>
        <HeatmapGrid metrics={metrics} />
      </InspectorSection>
      <div className="grid gap-6 lg:grid-cols-2">
        <InspectorSection title="Demand vs supply by desire lane">
          {intentDemand.length > 0 ? (
            <DataTable columns={demandColumns}>
              {intentDemand.map((d, idx) => {
                const laneName = typeof d.desireLane === "string" && d.desireLane ? d.desireLane : "unknown";
                const open = Number.isFinite(d.openRequests7d) ? d.openRequests7d : 0;
                const fulfilled = Number.isFinite(d.fulfilledProposals7d) ? d.fulfilledProposals7d : 0;
                const unfulfilled = Number.isFinite(d.unfulfilledDemandRatio) ? d.unfulfilledDemandRatio : (open > 0 ? Math.max(0, 1 - fulfilled / open) : 0);
                return (
                  <TableRow key={`${d.appId ?? ""}:${d.city ?? ""}:${laneName}:${idx}`}>
                    <DataCell>{humanize(laneName)}{d.city ? <span className="ml-1.5 text-xs text-muted-foreground">{d.city.toUpperCase()}</span> : null}</DataCell>
                    <DataCell numeric>{num(open)}</DataCell>
                    <DataCell numeric>{num(fulfilled)}</DataCell>
                    <DataCell numeric className={unfulfilled > 0.5 ? "text-warn" : "text-ok"}>{pct(unfulfilled)}</DataCell>
                  </TableRow>
                );
              })}
            </DataTable>
          ) : (
            <EmptyState title="No desire-lane demand signals yet." />
          )}
        </InspectorSection>
        <InspectorSection title="Outreach template lift">
          <DataTable columns={templateColumns} empty="No template lift rows yet.">
            {heatmap.templateLift.slice(0, 20).map(t => (
              <TableRow key={`${t.templateId}:${t.channel}`}>
                <DataCell>{t.templateId}</DataCell>
                <DataCell muted>{t.channel}</DataCell>
                <DataCell numeric>{num(t.sent)}</DataCell>
                <DataCell numeric>{pct(t.replyRate, 1)}</DataCell>
                <DataCell numeric>{pct(t.conversionRate, 1)}</DataCell>
                <DataCell numeric className={t.stopGuardrailBreached ? "text-destructive" : undefined}>{pct(t.stopRate, 1)}</DataCell>
              </TableRow>
            ))}
          </DataTable>
        </InspectorSection>
      </div>
    </div>
  );
}

const TRACE_STATUS_MAP: Record<string, TraceSpan["status"]> = {
  ok: "ok",
  fallback: "fallback",
  leak_blocked: "leak_blocked",
  flagged: "flagged",
  error: "error",
  budget_blocked: "flagged",
};

function TrajectoriesView() {
  const s = useStore();
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [entityId, setEntityId] = useState("");
  const [list, setList] = useState<TrajectoriesListResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TrajectoryDetailResponse | null>(null);
  const [error, setError] = useState("");

  const load = () => {
    void store.trajectories({ kind, status, entityId: entityId.trim() || undefined, limit: 80 }).then(r => {
      if (r.data) {
        setList(r.data);
        setError("");
        setSelectedId(prev => prev && r.data!.traces.some(t => t.traceId === prev) ? prev : (r.data!.traces[0]?.traceId ?? null));
      } else {
        setError(r.error ?? "Could not load trajectories");
      }
    });
  };
  useEffect(() => { load(); }, [s.app, s.mode, kind, status]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let live = true;
    void store.trajectoryDetail(selectedId).then(r => {
      if (live) setDetail(r.data ?? null);
    });
    return () => { live = false; };
  }, [selectedId, s.app, s.mode]);

  const spans: TraceSpan[] = useMemo(() => {
    const raw = detail?.spans ?? [];
    if (!raw.length) return [];
    const base = Math.min(...raw.map(x => x.startedAt));
    return raw.map(sp => {
      const payloadSummary = sp.payloadState === "shredded"
        ? "[crypto-shredded]"
        : sp.payloadState === "redacted"
          ? "[redacted for role]"
          : sp.payload
            ? JSON.stringify(sp.payload, null, 2)
            : undefined;
      return {
        id: sp.spanId,
        parentId: sp.parentSpanId,
        name: sp.name,
        service: sp.kind,
        startMs: Math.max(0, sp.startedAt - base),
        durationMs: Math.max(1, sp.durationMs),
        status: TRACE_STATUS_MAP[sp.status] ?? "ok",
        tokens: sp.metrics ? (sp.metrics.inputTokens ?? 0) + (sp.metrics.outputTokens ?? 0) : undefined,
        costUsd: sp.metrics?.costMicros ? sp.metrics.costMicros / 1_000_000 : undefined,
        model: sp.metrics?.model,
        output: payloadSummary,
        attributes: sp.tags,
      };
    });
  }, [detail]);

  return (
    <div className="flex flex-col gap-3">
      <form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); load(); }}>
        <Select className="h-8 w-36" aria-label="Trajectory kind" value={kind} onValueChange={setKind}>
          <SelectItem value="all">All kinds</SelectItem>
          <SelectItem value="turn">Turn</SelectItem>
          <SelectItem value="llm">LLM</SelectItem>
          <SelectItem value="match_run">Match run</SelectItem>
          <SelectItem value="review_judge">Review judge</SelectItem>
          <SelectItem value="outreach">Outreach</SelectItem>
          <SelectItem value="funnel">Funnel</SelectItem>
          <SelectItem value="safety">Safety</SelectItem>
        </Select>
        <Select className="h-8 w-36" aria-label="Trajectory status" value={status} onValueChange={setStatus}>
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="ok">OK</SelectItem>
          <SelectItem value="fallback">Fallback</SelectItem>
          <SelectItem value="flagged">Flagged</SelectItem>
          <SelectItem value="leak_blocked">Leak blocked</SelectItem>
          <SelectItem value="error">Error</SelectItem>
        </Select>
        <Input className="h-8 w-44" aria-label="Filter by entity id" placeholder="Member / opp id…" value={entityId} onChange={e => setEntityId(e.target.value)} />
        <Button variant="outline" size="sm" type="submit">Refresh</Button>
        {list && <span className="ml-auto text-xs text-muted-foreground">driver: {list.driver} · {list.traces.length} traces</span>}
      </form>
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex max-h-96 flex-col gap-1 overflow-y-auto rounded-md border border-border p-2">
          {(list?.traces ?? []).map(t => (
            <Button
              key={t.traceId}
              variant={selectedId === t.traceId ? "secondary" : "ghost"}
              size="sm"
              className="h-auto flex-col items-start gap-0.5 py-2 text-left font-normal"
              onClick={() => setSelectedId(t.traceId)}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="font-mono text-xs">{t.traceId.slice(0, 12)}</span>
                <StatusMark tone={t.status === "ok" ? "ok" : t.status === "error" || t.status === "leak_blocked" ? "destructive" : "warn"} label={humanize(t.status)} showLabel />
              </div>
              <FactLine parts={[humanize(t.kind), `${t.spanCount} spans`, `${t.durationMs}ms`, t.costMicros > 0 ? `$${(t.costMicros / 1_000_000).toFixed(4)}` : undefined]} />
            </Button>
          ))}
          {!list && !error && <p className="p-2 text-sm text-muted-foreground">Loading trajectories…</p>}
          {list && !list.traces.length && <EmptyState title="No trajectories recorded yet." />}
        </div>
        <div className="min-w-0 lg:col-span-2">
          {selectedId ? (
            <TraceWaterfall spans={spans} />
          ) : (
            <EmptyState title="Select a trajectory to inspect its span waterfall." />
          )}
        </div>
      </div>
    </div>
  );
}

const SLICE_METRICS: SliceOption[] = [
  { value: "verified_signups", label: "Verified signups" },
  { value: "site_visits", label: "Site visits" },
  { value: "proposals", label: "Proposals" },
  { value: "irl_meetings", label: "IRL meetings" },
  { value: "retained_d30", label: "Retained D30" },
  { value: "outreach_sent", label: "Outreach sent" },
  { value: "spend_cents", label: "Spend (cents)" },
  { value: "stop_rate", label: "STOP rate" },
];

const SLICE_DIMENSIONS: SliceOption[] = [
  { value: "none", label: "No breakdown" },
  { value: "appId", label: "App" },
  { value: "city", label: "City" },
  { value: "desireLane", label: "Desire lane" },
  { value: "channel", label: "Channel" },
  { value: "campaignId", label: "Campaign" },
  { value: "ageBand", label: "Age band" },
  { value: "entrySurface", label: "Entry surface" },
];

const GRAN_TO_API: Record<UiSliceQuery["granularity"], SliceGranularity> = { "1h": "hour", "1d": "day", "1w": "week" };

function ExplorerView() {
  const s = useStore();
  const [query, setQuery] = useState<UiSliceQuery>({ metric: "verified_signups", groupBy: "city", granularity: "1d", chartType: "bar" });
  const [result, setResult] = useState<SliceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [sqlError, setSqlError] = useState<string | undefined>();
  const [sqlColumns, setSqlColumns] = useState<string[]>([]);
  const [sqlRows, setSqlRows] = useState<Record<string, string | number | null>[]>([]);

  const apiQuery = useMemo(() => ({
    metric: query.metric as SliceMetric,
    groupBy: query.groupBy === "none" ? [] : [query.groupBy as SliceDimension],
    granularity: GRAN_TO_API[query.granularity],
    filter: s.selectedCity === "all" ? undefined : { city: s.selectedCity },
  }), [query, s.selectedCity]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    void store.analyticsSlice(apiQuery).then(r => {
      if (!live) return;
      setLoading(false);
      if (r.data && Array.isArray(r.data.rows)) setResult(r.data);
    });
    return () => { live = false; };
  }, [apiQuery, s.app, s.mode, s.version]);

  const { labels, series, rows } = useMemo(() => {
    const rawRows = result?.rows ?? [];
    const buckets = [...new Set(rawRows.map(r => r.bucket))].sort();
    const groups = [...new Set(rawRows.map(r => Object.values(r.dimensions).join(" / ") || "Total"))];
    const palette = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "chart-6"] as const;
    const seriesOut: TimeSeriesSeries[] = groups.slice(0, 6).map((g, i) => ({
      id: g,
      label: g,
      color: palette[i % palette.length],
      values: buckets.map(b => {
        const hit = rawRows.find(r => r.bucket === b && (Object.values(r.dimensions).join(" / ") || "Total") === g);
        return !hit || hit.suppressed ? null : hit.value;
      }),
    }));
    const tableRows: SliceTableRow[] = rawRows.map((r, i) => ({
      key: `${r.bucket}-${i}`,
      bucket: r.bucket,
      group: Object.values(r.dimensions).join(" / ") || "Total",
      value: r.suppressed ? 0 : r.value,
      formattedValue: r.suppressed ? `<${result?.kFloor ?? 5}` : num(r.value),
    }));
    return { labels: buckets, series: seriesOut, rows: tableRows };
  }, [result]);

  const handleExport = async (format: "csv" | "json") => {
    if (format === "json") {
      downloadTextFile(`observatory-slice-${query.metric}.json`, JSON.stringify(result ?? {}, null, 2), "application/json");
      return;
    }
    const r = await store.analyticsSliceCsv(apiQuery);
    if (r.csv !== undefined) downloadTextFile(`observatory-slice-${query.metric}.csv`, r.csv, "text/csv");
    else store.toast(r.error ?? "Export failed", "bad");
  };

  const handleRunSql = async (sql: string) => {
    setSqlError(undefined);
    const r = await store.analyticsSlice({ sql });
    if (r.data && Array.isArray(r.data.columns)) {
      setSqlColumns(r.data.columns);
      setSqlRows((r.data.rows ?? []).map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "boolean" ? String(v) : v]))));
    } else {
      setSqlError(r.error ?? r.data?.error ?? "SQL query refused");
    }
  };

  const canSql = s.can("analyst") || s.can("engineer");

  return (
    <SliceExplorer
      metrics={SLICE_METRICS}
      dimensions={SLICE_DIMENSIONS}
      query={query}
      onQueryChange={setQuery}
      labels={labels}
      series={series}
      rows={rows}
      loading={loading}
      onExport={fmt => void handleExport(fmt)}
      enableSql={canSql}
      initialSql="SELECT day, app_id, stage, SUM(unique_actors) AS actors FROM analytics.funnel_daily GROUP BY 1, 2, 3 ORDER BY 1 DESC LIMIT 50"
      onRunSql={sql => void handleRunSql(sql)}
      sqlError={sqlError}
      sqlColumns={sqlColumns}
      sqlRows={sqlRows}
    />
  );
}

const trafficColumns: DataColumn[] = [
  { key: "at", label: "Time" },
  { key: "service", label: "Service" },
  { key: "req", label: "Request" },
  { key: "status", label: "Status", numeric: true },
  { key: "latency", label: "Latency", numeric: true },
];

export function MockTrafficPanel() {
  const s = useStore();
  const [service, setService] = useState("all");
  const [traffic, setTraffic] = useState<MockTrafficResponse | null>(null);
  const [rules, setRules] = useState<MockChaosRule[]>([]);
  const [error, setError] = useState("");

  const load = () => {
    void store.mockTraffic({ service, limit: 60 }).then(r => {
      if (r.data) { setTraffic(r.data); setError(""); }
      else setError(r.error ?? "");
    });
    void store.mockChaos().then(r => { if (r.data?.rules) setRules(r.data.rules); });
  };

  useEffect(() => {
    load();
    const h = setInterval(load, 2500);
    return () => clearInterval(h);
  }, [s.app, service]);

  const removeRule = async (id: string) => {
    const r = await store.deleteMockChaos(id);
    if (r.data?.rules) setRules(r.data.rules);
    else load();
  };

  const entries = traffic?.entries ?? [];
  const total = traffic?.stats?.total ?? entries.length;
  const count429 = traffic?.stats?.byStatus?.["429"] ?? entries.filter(e => e.status === 429).length;
  const count5xx = Object.entries(traffic?.stats?.byStatus ?? {}).reduce((sum, [code, n]) => sum + (Number(code) >= 500 ? n : 0), 0);

  return (
    <InspectorSection
      title="Mock HTTP traffic & chaos"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Select className="h-8 w-36" aria-label="Mock service filter" value={service} onValueChange={setService}>
            <SelectItem value="all">All services</SelectItem>
            <SelectItem value="blooio">Blooio</SelectItem>
            <SelectItem value="email">Email</SelectItem>
            <SelectItem value="social">Social</SelectItem>
            <SelectItem value="ads">Ads</SelectItem>
            <SelectItem value="turnstile">Turnstile</SelectItem>
            <SelectItem value="llm">LLM</SelectItem>
          </Select>
          {rules.length > 0 && <Button variant="outline" size="sm" onClick={() => void removeRule("all")}>Clear chaos</Button>}
        </div>
      }
    >
      {error && <Alert variant="warn">{error}</Alert>}
      <KpiGrid compact>
        <Kpi label="mock requests" value={num(total)} />
        <Kpi label="429 rate-limited" value={num(count429)} tone={count429 > 0 ? "warn" : "ok"} />
        <Kpi label="5xx errors" value={num(count5xx)} tone={count5xx > 0 ? "destructive" : "ok"} />
        <Kpi label="active chaos rules" value={num(rules.filter(r => r.enabled).length)} tone={rules.some(r => r.enabled) ? "warn" : "ok"} />
      </KpiGrid>
      {rules.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {rules.map(rule => (
            <span key={rule.id} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1">
              <StatusMark tone={rule.enabled ? "warn" : "neutral"} label={rule.service} showLabel />
              <span>{String(rule.fault.kind ?? rule.id)}</span>
              <Button variant="ghost" size="sm" className="h-5 px-1" aria-label={`Remove ${rule.id}`} onClick={() => void removeRule(rule.id)}>×</Button>
            </span>
          ))}
        </div>
      )}
      <DataTable columns={trafficColumns} empty="No mock HTTP traffic recorded yet.">
        {entries.slice(0, 40).map((e, i) => (
          <TableRow key={e.id ?? `${e.ts}-${i}`}>
            <DataCell muted>{stamp(e.ts)}</DataCell>
            <DataCell>{e.service}{e.webhook ? " · hook" : ""}</DataCell>
            <DataCell className="font-mono text-xs">{e.method} {e.path}</DataCell>
            <DataCell numeric className={e.status >= 500 ? "text-destructive" : e.status === 429 ? "text-warn" : "text-ok"}>{e.status}</DataCell>
            <DataCell numeric muted>{e.latencyMs}ms</DataCell>
          </TableRow>
        ))}
      </DataTable>
    </InspectorSection>
  );
}
