import { type ComponentProps, type ReactNode, useState } from "react";
import { cn, focusRing } from "../../lib/cn.ts";

/** One of the six categorical chart color tokens. */
export type ChartColorToken = "chart-1" | "chart-2" | "chart-3" | "chart-4" | "chart-5" | "chart-6";

/** Visual geometry used by `TimeSeriesChart`. */
export type TimeSeriesVariant = "line" | "area" | "bar";

/** One plotted data series in a `TimeSeriesChart`. */
export type TimeSeriesSeries = {
  id: string;
  label: string;
  values: (number | null)[];
  color?: ChartColorToken;
  format?: (value: number) => string;
};

export type TimeSeriesChartProps = Omit<ComponentProps<"div">, "children"> & {
  /** Ordered X-axis bucket labels matching each series' `values` array. */
  labels: string[];
  /** One or more data series plotted against `labels`. */
  series: TimeSeriesSeries[];
  /** Chart rendering style: lines, filled areas, or grouped bars. */
  variant?: TimeSeriesVariant;
  /** Accessible description of the chart. */
  label?: string;
  /** Formats Y-axis tick labels and default tooltip values. */
  yFormat?: (value: number) => string;
  /** Shown when there are no labels or series. */
  empty?: ReactNode;
};

const palette: ChartColorToken[] = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "chart-6"];

const strokeClass: Record<ChartColorToken, string> = {
  "chart-1": "stroke-chart-1",
  "chart-2": "stroke-chart-2",
  "chart-3": "stroke-chart-3",
  "chart-4": "stroke-chart-4",
  "chart-5": "stroke-chart-5",
  "chart-6": "stroke-chart-6",
};

const fillClass: Record<ChartColorToken, string> = {
  "chart-1": "fill-chart-1",
  "chart-2": "fill-chart-2",
  "chart-3": "fill-chart-3",
  "chart-4": "fill-chart-4",
  "chart-5": "fill-chart-5",
  "chart-6": "fill-chart-6",
};

const areaClass: Record<ChartColorToken, string> = {
  "chart-1": "fill-chart-1/15",
  "chart-2": "fill-chart-2/15",
  "chart-3": "fill-chart-3/15",
  "chart-4": "fill-chart-4/15",
  "chart-5": "fill-chart-5/15",
  "chart-6": "fill-chart-6/15",
};

const swatchClass: Record<ChartColorToken, string> = {
  "chart-1": "bg-chart-1",
  "chart-2": "bg-chart-2",
  "chart-3": "bg-chart-3",
  "chart-4": "bg-chart-4",
  "chart-5": "bg-chart-5",
  "chart-6": "bg-chart-6",
};

const defaultFormat = (value: number) =>
  Math.abs(value) >= 1000 ? value.toLocaleString("en-US", { maximumFractionDigits: 1 }) : String(Math.round(value * 100) / 100);

/** Multi-series SVG line, area, or bar chart with axis ticks, interactive hover crosshair, and toggleable legend. */
export function TimeSeriesChart({
  labels,
  series,
  variant = "line",
  label = "Time series chart",
  yFormat = defaultFormat,
  empty = "No series data.",
  className,
  ...props
}: TimeSeriesChartProps) {
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (!labels.length || !series.length) {
    return (
      <div className={cn("rounded-md border border-border bg-card p-4 text-sm text-muted-foreground", className)} {...props}>
        {empty}
      </div>
    );
  }

  const resolved = series.map((item, index) => ({
    ...item,
    token: item.color ?? palette[index % palette.length],
    visible: !hiddenIds.includes(item.id),
  }));

  const buckets = labels.map((text, index) => ({
    text,
    index,
    key: `${text}#${labels.slice(0, index).filter((prev) => prev === text).length}`,
  }));

  const visibleSeries = resolved.filter((item) => item.visible);
  const allValues = visibleSeries.flatMap((item) => item.values.filter((v): v is number => v !== null && Number.isFinite(v)));
  const rawMax = allValues.length ? Math.max(...allValues) : 1;
  const rawMin = allValues.length ? Math.min(0, ...allValues) : 0;
  const maxVal = rawMax <= rawMin ? rawMin + 1 : rawMax;
  const minVal = rawMin;
  const span = maxVal - minVal || 1;

  const width = 640;
  const height = 220;
  const padLeft = 48;
  const padRight = 16;
  const padTop = 12;
  const padBottom = 28;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const yOf = (value: number) => padTop + plotH - ((value - minVal) / span) * plotH;
  const zeroY = yOf(0);
  const xOf = (index: number) =>
    variant === "bar"
      ? padLeft + ((index + 0.5) / labels.length) * plotW
      : labels.length === 1
        ? padLeft + plotW / 2
        : padLeft + (index / (labels.length - 1)) * plotW;

  const yTicks = [0, 1 / 3, 2 / 3, 1].map((ratio) => {
    const value = minVal + ratio * span;
    return { value, y: yOf(value) };
  });

  const xStep = Math.max(1, Math.ceil(labels.length / 7));
  const toggleSeries = (id: string) => {
    setHiddenIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const activeIndex = hoverIndex !== null && hoverIndex < labels.length ? hoverIndex : null;
  const slotWidth = plotW / labels.length;

  return (
    <div className={cn("flex flex-col gap-3 rounded-md border border-border bg-card p-3 text-card-foreground", className)} {...props}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Series legend" className="flex flex-wrap items-center gap-1.5">
          {resolved.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={item.visible}
              onClick={() => toggleSeries(item.id)}
              className={cn(
                focusRing,
                "inline-flex items-center gap-1.5 rounded-sm border border-border px-2 py-1 text-xs font-medium transition-colors duration-fast hover:bg-accent",
                item.visible ? "bg-background text-foreground" : "bg-muted/50 text-muted-foreground opacity-60",
              )}
            >
              <span aria-hidden className={cn("size-2 rounded-sm", swatchClass[item.token])} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        {activeIndex !== null ? (
          <div className="flex flex-wrap items-center gap-3 rounded-sm bg-muted/60 px-2.5 py-1 text-xs tabular-nums">
            <span className="font-medium text-foreground">{labels[activeIndex]}</span>
            {visibleSeries.map((item) => {
              const val = item.values[activeIndex];
              return (
                <span key={item.id} className="inline-flex items-center gap-1 text-muted-foreground">
                  <span aria-hidden className={cn("size-1.5 rounded-sm", swatchClass[item.token])} />
                  <span>{item.label}:</span>
                  <span className="font-medium text-foreground">{val == null ? "—" : (item.format ?? yFormat)(val)}</span>
                </span>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="relative w-full" onMouseLeave={() => setHoverIndex(null)}>
        <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${height}`} className="h-56 w-full overflow-visible">
          {yTicks.map((tick) => (
            <g key={tick.y}>
              <line x1={padLeft} y1={tick.y} x2={width - padRight} y2={tick.y} className="stroke-border" strokeWidth="1" />
              <text x={padLeft - 8} y={tick.y + 3.5} textAnchor="end" className="fill-muted-foreground text-xs tabular-nums">
                {yFormat(tick.value)}
              </text>
            </g>
          ))}

          {buckets.map((bucket) =>
            bucket.index % xStep === 0 || bucket.index === buckets.length - 1 ? (
              <text key={bucket.key} x={xOf(bucket.index)} y={height - 6} textAnchor="middle" className="fill-muted-foreground text-xs tabular-nums">
                {bucket.text}
              </text>
            ) : null,
          )}

          {variant === "bar"
            ? visibleSeries.map((item, sIndex) => {
                const count = Math.max(1, visibleSeries.length);
                const groupW = Math.min(slotWidth * 0.76, 48);
                const barW = Math.max(2, (groupW - (count - 1) * 2) / count);
                return (
                  <g key={item.id}>
                    {buckets.map((bucket) => {
                      const val = item.values[bucket.index];
                      if (val == null) return null;
                      const cx = xOf(bucket.index) - groupW / 2 + sIndex * (barW + 2);
                      const y = yOf(Math.max(val, 0));
                      const barH = Math.max(1, Math.abs(zeroY - yOf(val)));
                      return (
                        <rect
                          key={`${item.id}-${bucket.key}`}
                          x={cx}
                          y={val >= 0 ? y : zeroY}
                          width={barW}
                          height={barH}
                          rx="1.5"
                          className={cn(fillClass[item.token], activeIndex !== null && activeIndex !== bucket.index && "opacity-60")}
                        />
                      );
                    })}
                  </g>
                );
              })
            : visibleSeries.map((item) => {
                const pts = item.values
                  .map((val, idx) => (val == null ? null : { x: xOf(idx), y: yOf(val), idx }))
                  .filter((pt): pt is { x: number; y: number; idx: number } => pt !== null);
                if (!pts.length) return null;
                const line = pts.map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ");
                const first = pts[0];
                const last = pts[pts.length - 1];
                const area = `${first.x.toFixed(1)},${zeroY.toFixed(1)} ${line} ${last.x.toFixed(1)},${zeroY.toFixed(1)}`;
                return (
                  <g key={item.id}>
                    {variant === "area" ? <polygon points={area} className={areaClass[item.token]} /> : null}
                    <polyline points={line} className={cn("fill-none", strokeClass[item.token])} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </g>
                );
              })}

          {activeIndex !== null ? (
            <g>
              <line
                x1={xOf(activeIndex)}
                y1={padTop}
                x2={xOf(activeIndex)}
                y2={padTop + plotH}
                className="stroke-muted-foreground"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              {variant !== "bar"
                ? visibleSeries.map((item) => {
                    const val = item.values[activeIndex];
                    if (val == null) return null;
                    return <circle key={item.id} cx={xOf(activeIndex)} cy={yOf(val)} r="3.5" className={cn(fillClass[item.token], "stroke-card")} strokeWidth="1.5" />;
                  })
                : null}
            </g>
          ) : null}

          {buckets.map((bucket) => (
            <rect
              key={`hit-${bucket.key}`}
              x={padLeft + bucket.index * slotWidth}
              y={padTop}
              width={slotWidth}
              height={plotH}
              className="fill-transparent"
              onMouseEnter={() => setHoverIndex(bucket.index)}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
