import { useState } from "react";
import {
  CohortMatrix,
  DataCell,
  DataTable,
  HeatmapGrid,
  Segments,
  SliceExplorer,
  StatusMark,
  TableRow,
  TimeSeriesChart,
  type CohortDriver,
  type CohortRow,
  type HeatmapMetric,
  type SliceQuery,
  type TimeSeriesSeries,
  type TimeSeriesVariant,
} from "@thenetwork/ui";
import { formatPct, formatUsdCents, humanize, triggerDownload } from "../format.ts";
import { marketingStore, useMarketingStore } from "../store.ts";
import type { AttributionModel } from "../types.ts";

const attributionModes: { value: AttributionModel; label: string }[] = [
  { value: "first_touch", label: "First touch" },
  { value: "last_touch", label: "Last touch" },
  { value: "linear", label: "Linear" },
];

const chartVariants: { value: TimeSeriesVariant; label: string }[] = [
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "bar", label: "Bar" },
];

const sliceMetrics = [
  { value: "verified_signups", label: "Verified 18+ Signups" },
  { value: "site_visits", label: "Site Visits" },
  { value: "irl_meetings", label: "First IRL Meetings" },
  { value: "spend_cents", label: "Spend" },
  { value: "outreach_sent", label: "Outreach Sent" },
  { value: "stop_rate", label: "STOP Rate" },
];

const sliceDimensions = [
  { value: "channel", label: "Channel" },
  { value: "city", label: "City" },
  { value: "desireLane", label: "Desire Lane" },
  { value: "appId", label: "App" },
];

function airGapClass(group?: string): string {
  if (group === "social_general") return "bg-chart-1";
  if (group === "extensible_ready") return "bg-chart-4";
  if (group === "romantic_isolated") return "bg-chart-3";
  if (group === "work_isolated") return "bg-chart-2";
  return "bg-chart-6";
}

function buildHeatmapGrid(cells: Array<{ dayOfWeek: number; hour: number; value: number }>): number[][] {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const cell of cells) {
    if (cell.dayOfWeek >= 0 && cell.dayOfWeek < 7 && cell.hour >= 0 && cell.hour < 24) {
      grid[cell.dayOfWeek][cell.hour] = cell.value;
    }
  }
  return grid;
}

export function GrowthAnalyticsWorkspace() {
  const s = useMarketingStore();
  const [tsVariant, setTsVariant] = useState<TimeSeriesVariant>("line");
  const [sliceQuery, setSliceQuery] = useState<SliceQuery>({
    metric: "verified_signups",
    groupBy: "channel",
    granularity: "1d",
    chartType: "bar",
  });

  const tsData = s.timeseries?.series;
  const tsPoints = tsData?.visits ?? tsData?.signups ?? [];
  const tsLabels = tsPoints.map((pt) => pt.label);
  const tsSeries: TimeSeriesSeries[] = [];
  if (tsData?.visits?.length) tsSeries.push({ id: "visits", label: "Site Visits", values: tsData.visits.map((p) => p.value), color: "chart-1" });
  if (tsData?.signups?.length) tsSeries.push({ id: "signups", label: "Verified 18+", values: tsData.signups.map((p) => p.value), color: "chart-2" });
  if (tsData?.spendCents?.length) {
    tsSeries.push({
      id: "spend",
      label: "Spend ($)",
      values: tsData.spendCents.map((p) => Math.round(p.value / 100)),
      color: "chart-3",
      format: (v) => `$${v}`,
    });
  }
  if (tsData?.cpaCents?.length) {
    tsSeries.push({
      id: "cpa",
      label: "CPA ($)",
      values: tsData.cpaCents.map((p) => Math.round(p.value / 100)),
      color: "chart-4",
      format: (v) => `$${v}`,
    });
  }

  const heatmapCells = s.heatmap?.cells ?? [];
  const heatmapMetrics: HeatmapMetric[] = heatmapCells.length
    ? [
        {
          key: "reply",
          label: "Reply %",
          values: buildHeatmapGrid(heatmapCells.map((c) => ({ dayOfWeek: c.dayOfWeek, hour: c.hour, value: Math.round(c.replyRate * 1000) / 10 }))),
          format: (v) => `${v}%`,
        },
        {
          key: "click",
          label: "Click %",
          values: buildHeatmapGrid(heatmapCells.map((c) => ({ dayOfWeek: c.dayOfWeek, hour: c.hour, value: Math.round(c.clickRate * 1000) / 10 }))),
          format: (v) => `${v}%`,
        },
        {
          key: "stop",
          label: "STOP %",
          values: buildHeatmapGrid(heatmapCells.map((c) => ({ dayOfWeek: c.dayOfWeek, hour: c.hour, value: Math.round(c.stopRate * 1000) / 10 }))),
          format: (v) => `${v}%`,
        },
        {
          key: "sent",
          label: "Sent",
          values: buildHeatmapGrid(heatmapCells.map((c) => ({ dayOfWeek: c.dayOfWeek, hour: c.hour, value: c.sent }))),
        },
      ]
    : [];

  const cohortColumns = (s.cohorts?.horizons ?? [1, 3, 7, 14, 30]).map((day) => `D${day}`);
  const cohortRows: CohortRow[] = (s.cohorts?.rows ?? []).map((row) => ({
    key: row.cohortWeek,
    label: row.cohortWeek,
    size: row.cohortSize,
    retention: (s.cohorts?.horizons ?? [1, 3, 7, 14, 30]).map((day) => row.retention[day] ?? null),
  }));
  const cohortDrivers: CohortDriver[] = (s.cohorts?.drivers ?? []).map((driver) => ({
    key: driver.driverId,
    label: driver.label,
    liftPct: Math.round(driver.lift * 1000) / 10,
    sampleSize: driver.exposedCount,
  }));

  const lanes = s.summary?.desireLanes.lanes ?? [];
  const laneMetrics = s.summary?.desireLanes.metrics ?? {};

  const sliceResultRows = s.sliceResult?.rows ?? [];
  const sliceLabels = sliceResultRows.map((row) => row.bucket);
  const sliceSeries: TimeSeriesSeries[] = sliceResultRows.length
    ? [
        {
          id: sliceQuery.metric,
          label: humanize(sliceQuery.metric),
          values: sliceResultRows.map((row) => (row.suppressed ? null : row.value)),
          color: "chart-1",
        },
      ]
    : [];
  const sliceRows = sliceResultRows.map((row) => ({
    bucket: row.bucket,
    group: Object.values(row.dimensions).join(" · ") || "all",
    value: row.suppressed ? "<5" : row.value,
    count: row.suppressed ? "<5" : row.sampleCount,
  }));

  const handleSliceChange = (next: SliceQuery) => {
    setSliceQuery(next);
    const gran = next.granularity === "1h" ? "hour" : next.granularity === "1w" ? "week" : "day";
    void marketingStore.runSlice({ metric: next.metric, groupBy: [next.groupBy], granularity: gran });
  };

  const handleExport = async (format: "csv" | "json") => {
    try {
      const gran = sliceQuery.granularity === "1h" ? "hour" : sliceQuery.granularity === "1w" ? "week" : "day";
      const content = await marketingStore.api.exportSlice({
        metric: sliceQuery.metric,
        groupBy: [sliceQuery.groupBy],
        granularity: gran,
        format,
      });
      triggerDownload(
        `marketing-${sliceQuery.metric}.${format}`,
        content,
        format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8",
      );
      marketingStore.pushToast("ok", `Exported scrubbed ${format.toUpperCase()}`);
    } catch (err) {
      marketingStore.pushToast("destructive", err instanceof Error ? err.message : "Export failed");
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Growth Velocity & Spend</h2>
          <Segments aria-label="Chart geometry" value={tsVariant} onValueChange={(v) => setTsVariant(v as TimeSeriesVariant)} options={chartVariants} />
        </div>
        <TimeSeriesChart labels={tsLabels} series={tsSeries} variant={tsVariant} empty="No timeseries points recorded yet." />
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Channel Attribution & ROI</h2>
          <Segments
            aria-label="Attribution model"
            value={s.attributionModel}
            onValueChange={(m) => marketingStore.setAttributionModel(m as AttributionModel)}
            options={attributionModes}
          />
        </div>
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <DataTable
            columns={[
              { key: "channel", label: "Channel" },
              { key: "lane", label: "Desire Lane" },
              { key: "visits", label: "Visits", numeric: true },
              { key: "signups", label: "Verified 18+", numeric: true },
              { key: "meetings", label: "Meetings", numeric: true },
              { key: "spend", label: "Spend", numeric: true },
              { key: "cac", label: "CAC", numeric: true },
              { key: "conv", label: "Visit → 18+", numeric: true },
            ]}
            empty={(s.attribution?.rows.length ?? 0) === 0 ? "No attributed conversions yet." : undefined}
          >
            {(s.attribution?.rows ?? []).map((row) => (
              <TableRow key={`${row.channel}-${row.campaignId}-${row.desireLane}`}>
                <DataCell>{humanize(row.channel)}</DataCell>
                <DataCell muted>{humanize(row.desireLane)}</DataCell>
                <DataCell numeric>{row.visits.toLocaleString("en-US")}</DataCell>
                <DataCell numeric>{row.verifiedAdultSignups.toLocaleString("en-US")}</DataCell>
                <DataCell numeric>{row.firstMeetings.toLocaleString("en-US")}</DataCell>
                <DataCell numeric>{formatUsdCents(row.spendCents)}</DataCell>
                <DataCell numeric>{row.cacCents !== null ? formatUsdCents(row.cacCents) : "—"}</DataCell>
                <DataCell numeric>{formatPct(row.visitToAdultSignupRate)}</DataCell>
              </TableRow>
            ))}
          </DataTable>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-foreground">7×24 Outreach Timing Heatmap</h2>
          <HeatmapGrid metrics={heatmapMetrics} empty="No outreach timing data yet." />
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-foreground">Desire-Lane Supply vs Demand</h2>
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <DataTable
              columns={[
                { key: "lane", label: "Lane" },
                { key: "airgap", label: "Air-Gap" },
                { key: "outcomes", label: "Verified", numeric: true },
                { key: "deals", label: "Venues", numeric: true },
                { key: "vips", label: "VIPs", numeric: true },
                { key: "videos", label: "Videos", numeric: true },
              ]}
              empty={lanes.length === 0 ? "No desire lanes loaded." : undefined}
            >
              {lanes.map((lane) => {
                const m = laneMetrics[lane.id];
                const group = lane.airGapGroup ?? "social_general";
                return (
                  <TableRow key={lane.id}>
                    <DataCell>{lane.label}</DataCell>
                    <DataCell>
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span aria-hidden className={`size-2 rounded-sm ${airGapClass(group)}`} />
                        <span>{humanize(group)}</span>
                      </span>
                    </DataCell>
                    <DataCell numeric>{m?.verifiedOutcomes ?? 0}</DataCell>
                    <DataCell numeric>{m?.bdDeals ?? 0}</DataCell>
                    <DataCell numeric>{m?.vipProspects ?? 0}</DataCell>
                    <DataCell numeric>{m?.videos ?? 0}</DataCell>
                  </TableRow>
                );
              })}
            </DataTable>
          </div>
        </section>
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Cohort Retention & Drivers</h2>
          <StatusMark tone="primary" label={`k-anonymity ≥ ${s.cohorts?.kFloor ?? 5}`} showLabel />
        </div>
        <CohortMatrix columns={cohortColumns} rows={cohortRows} minCohortSize={s.cohorts?.kFloor ?? 5} drivers={cohortDrivers} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-foreground">Slice & Dice Explorer</h2>
        <SliceExplorer
          metrics={sliceMetrics}
          dimensions={sliceDimensions}
          query={sliceQuery}
          onQueryChange={handleSliceChange}
          labels={sliceLabels}
          series={sliceSeries}
          rows={sliceRows}
          onExport={(fmt) => void handleExport(fmt)}
        />
      </section>
    </div>
  );
}
