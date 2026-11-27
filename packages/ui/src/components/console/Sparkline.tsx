import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.ts";

/** The stroke and area color token of a `Sparkline`. */
export type SparklineTone = "chart-1" | "chart-2" | "chart-3" | "primary" | "ok" | "warn" | "destructive";

const strokeTone: Record<SparklineTone, string> = {
  "chart-1": "stroke-chart-1",
  "chart-2": "stroke-chart-2",
  "chart-3": "stroke-chart-3",
  primary: "stroke-primary",
  ok: "stroke-ok",
  warn: "stroke-warn",
  destructive: "stroke-destructive",
};

const fillTone: Record<SparklineTone, string> = {
  "chart-1": "fill-chart-1/15",
  "chart-2": "fill-chart-2/15",
  "chart-3": "fill-chart-3/15",
  primary: "fill-primary/15",
  ok: "fill-ok/15",
  warn: "fill-warn/15",
  destructive: "fill-destructive/15",
};

const dotTone: Record<SparklineTone, string> = {
  "chart-1": "fill-chart-1",
  "chart-2": "fill-chart-2",
  "chart-3": "fill-chart-3",
  primary: "fill-primary",
  ok: "fill-ok",
  warn: "fill-warn",
  destructive: "fill-destructive",
};

export type SparklineProps = Omit<ComponentProps<"svg">, "children" | "points" | "target"> & {
  /** Ordered numeric samples from oldest to newest. */
  points: number[];
  /** Optional horizontal reference target drawn as a dashed rule. */
  target?: number;
  /** Token color used for the trend line and area fill. */
  tone?: SparklineTone;
  /** Fills the region beneath the line. */
  showArea?: boolean;
  /** Accessible name describing the series. */
  label?: string;
};

/** Compact responsive SVG trend line with optional area fill and target reference line. */
export function Sparkline({ points, target, tone = "chart-1", showArea = true, label = "Trend sparkline", className, ...props }: SparklineProps) {
  const width = 120;
  const height = 32;
  const padY = 4;
  const values = target !== undefined ? [...points, target] : points;
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const span = max - min || 1;
  const yOf = (value: number) => height - padY - ((value - min) / span) * (height - padY * 2);

  const coords =
    points.length === 0
      ? []
      : points.length === 1
        ? [{ x: 0, y: yOf(points[0]) }, { x: width, y: yOf(points[0]) }]
        : points.map((value, index) => ({
            x: (index / (points.length - 1)) * width,
            y: yOf(value),
          }));

  const polyline = coords.map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ");
  const area = coords.length
    ? `0,${height} ${polyline} ${width},${height}`
    : "";
  const last = coords[coords.length - 1];
  const targetY = target !== undefined ? yOf(target) : undefined;
  const decorative = props["aria-hidden"] === true || props["aria-hidden"] === "true";

  return (
    <svg
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("h-8 w-full overflow-visible", className)}
      {...props}
    >
      {targetY !== undefined ? (
        <line
          x1={0}
          y1={targetY}
          x2={width}
          y2={targetY}
          className="stroke-muted-foreground/60"
          strokeWidth="1"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {showArea && area ? <polygon points={area} className={fillTone[tone]} /> : null}
      {polyline ? (
        <polyline
          points={polyline}
          className={cn("fill-none", strokeTone[tone])}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ) : (
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} className="stroke-border" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      )}
      {last ? <circle cx={last.x} cy={last.y} r="2.25" className={dotTone[tone]} /> : null}
    </svg>
  );
}
