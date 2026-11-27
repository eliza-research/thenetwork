import { type ComponentProps, type ReactNode, useState } from "react";
import { cn, focusRing } from "../../lib/cn.ts";
import { Segments } from "./Segments.tsx";

/** One selectable metric layer rendered in a 7x24 `HeatmapGrid`. */
export type HeatmapMetric = {
  key: string;
  label: string;
  /** Seven rows (days) by 24 columns (hours 0..23). */
  values: number[][];
  format?: (value: number) => string;
};

export type HeatmapGridProps = Omit<ComponentProps<"div">, "children"> & {
  /** One or more 7x24 metric matrices. Shows a metric switcher when more than one is provided. */
  metrics: HeatmapMetric[];
  /** Seven day labels matching the rows of `values`. */
  dayLabels?: string[];
  /** Controlled active metric key. */
  activeMetric?: string;
  /** Called when the user switches metrics. */
  onMetricChange?: (key: string) => void;
  /** Called when the user clicks a day/hour cell. */
  onSelectCell?: (dayIndex: number, hourIndex: number, value: number, metricKey: string) => void;
  /** Accessible label for the heatmap grid. */
  label?: string;
  /** Shown when `metrics` is empty. */
  empty?: ReactNode;
};

const defaultDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hours = Array.from({ length: 24 }, (_, hour) => hour);
const defaultFormat = (value: number) => value.toLocaleString("en-US");

const cellTone = (ratio: number): string => {
  if (ratio <= 0) return "bg-muted";
  if (ratio < 0.25) return "bg-chart-1/20";
  if (ratio < 0.5) return "bg-chart-1/40";
  if (ratio < 0.75) return "bg-chart-1/70";
  return "bg-chart-1";
};

const padHour = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/** 7x24 Day-by-Hour activity heatmap with metric switcher and live hover/focus cell inspector. */
export function HeatmapGrid({
  metrics,
  dayLabels = defaultDays,
  activeMetric,
  onMetricChange,
  onSelectCell,
  label = "Day by hour activity heatmap",
  empty = "No heatmap data.",
  className,
  ...props
}: HeatmapGridProps) {
  const [selectedKey, setSelectedKey] = useState(metrics[0]?.key ?? "");
  const [inspected, setInspected] = useState<{ day: number; hour: number } | null>(null);

  if (!metrics.length) {
    return (
      <div className={cn("rounded-md border border-border bg-card p-4 text-sm text-muted-foreground", className)} {...props}>
        {empty}
      </div>
    );
  }

  const metricKey = activeMetric ?? (metrics.some((m) => m.key === selectedKey) ? selectedKey : metrics[0].key);
  const metric = metrics.find((m) => m.key === metricKey) ?? metrics[0];
  const format = metric.format ?? defaultFormat;

  let maxVal = 0;
  let peak = { day: 0, hour: 0, value: 0 };
  for (let d = 0; d < dayLabels.length; d++) {
    const row = metric.values[d] ?? [];
    for (let h = 0; h < 24; h++) {
      const val = row[h] ?? 0;
      if (val > maxVal) {
        maxVal = val;
        peak = { day: d, hour: h, value: val };
      }
    }
  }

  const handleMetric = (nextKey: string) => {
    setSelectedKey(nextKey);
    onMetricChange?.(nextKey);
  };

  const activeCell = inspected
    ? {
        day: inspected.day,
        hour: inspected.hour,
        value: metric.values[inspected.day]?.[inspected.hour] ?? 0,
      }
    : peak;

  return (
    <div className={cn("flex flex-col gap-3 rounded-md border border-border bg-card p-4 text-card-foreground", className)} {...props}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {metrics.length > 1 ? (
          <Segments
            aria-label="Heatmap metric"
            value={metric.key}
            onValueChange={handleMetric}
            options={metrics.map((item) => ({ value: item.key, label: item.label }))}
          />
        ) : (
          <span className="text-sm font-medium text-foreground">{metric.label}</span>
        )}
        <div aria-live="polite" className="flex items-center gap-2 rounded-sm bg-muted/60 px-2.5 py-1 text-xs tabular-nums">
          <span className="text-muted-foreground">{inspected ? "Cell" : "Peak"}</span>
          <span className="font-medium text-foreground">
            {dayLabels[activeCell.day] ?? ""} {padHour(activeCell.hour)}
          </span>
          <span className="font-semibold text-chart-1">{format(activeCell.value)}</span>
        </div>
      </div>

      <div role="grid" aria-label={label} className="flex flex-col gap-1 overflow-x-auto" onMouseLeave={() => setInspected(null)}>
        <div className="grid grid-cols-[2.5rem_repeat(24,minmax(0.75rem,1fr))] items-center gap-0.5 text-xs text-muted-foreground tabular-nums">
          <span />
          {hours.map((hour) => (
            <span key={hour} className="text-center">
              {hour % 4 === 0 ? String(hour).padStart(2, "0") : ""}
            </span>
          ))}
        </div>

        {dayLabels.map((day, dayIndex) => {
          const row = metric.values[dayIndex] ?? [];
          return (
            <div key={day} role="row" className="grid grid-cols-[2.5rem_repeat(24,minmax(0.75rem,1fr))] items-center gap-0.5">
              <span role="rowheader" className="pr-1 text-right text-xs font-medium text-muted-foreground">
                {day}
              </span>
              {hours.map((hourIndex) => {
                const value = row[hourIndex] ?? 0;
                const ratio = maxVal > 0 ? value / maxVal : 0;
                const isActive = inspected?.day === dayIndex && inspected?.hour === hourIndex;
                return (
                  <button
                    key={hourIndex}
                    type="button"
                    role="gridcell"
                    aria-label={`${day} ${padHour(hourIndex)}: ${format(value)}`}
                    onMouseEnter={() => setInspected({ day: dayIndex, hour: hourIndex })}
                    onFocus={() => setInspected({ day: dayIndex, hour: hourIndex })}
                    onClick={() => onSelectCell?.(dayIndex, hourIndex, value, metric.key)}
                    className={cn(
                      focusRing,
                      "h-5 w-full rounded-sm transition-transform duration-fast",
                      cellTone(ratio),
                      isActive && "ring-1 ring-foreground",
                    )}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
        <span>Low</span>
        <span aria-hidden className="size-3 rounded-sm bg-muted" />
        <span aria-hidden className="size-3 rounded-sm bg-chart-1/20" />
        <span aria-hidden className="size-3 rounded-sm bg-chart-1/40" />
        <span aria-hidden className="size-3 rounded-sm bg-chart-1/70" />
        <span aria-hidden className="size-3 rounded-sm bg-chart-1" />
        <span>High</span>
      </div>
    </div>
  );
}
