import type { ComponentProps, ReactNode } from "react";
import { cn, focusRing } from "../../lib/cn.ts";

/** The color of one bar. */
export type MeterTone = "primary" | "ok" | "warn" | "destructive" | "muted";

/** One bar: a name and a number. */
export type MeterRow = {
  key: string;
  label: string;
  value: number;
  tone?: MeterTone;
  /** The full name or the definition, shown on hover. */
  title?: string;
};

const fill: Record<MeterTone, string> = { primary: "bg-primary", ok: "bg-ok", warn: "bg-warn", destructive: "bg-destructive", muted: "bg-muted-foreground" };
const defaultTone: MeterTone = "primary";

export type MeterBarsProps = Omit<ComponentProps<"ul">, "children"> & {
  /** The bars. */
  rows: MeterRow[];
  /** The number of a full bar; the largest absolute value when left out. */
  max?: number;
  /** Writes a number. */
  format?: (value: number) => string;
  /** Drops the bars at zero or less, puts the largest first and keeps the first `limit`. Turn it off for a fixed order, such as score parts. */
  ranked?: boolean;
  /** How many bars show when `ranked`. */
  limit?: number;
  /** Makes each bar a button, such as one that applies a filter. */
  onSelect?: (key: string) => void;
  /** What shows when no bar is left. */
  empty?: ReactNode;
};

const plain = (value: number) => value.toLocaleString("en-US");

/** Horizontal bars for a small breakdown: each name, its bar and its number. The number is the text; the bar only draws it. */
export function MeterBars({ rows, max, format = plain, ranked = true, limit = 12, onSelect, empty = "Nothing to show.", className, ...props }: MeterBarsProps) {
  const shown = ranked ? rows.filter((row) => row.value > 0).sort((a, b) => b.value - a.value).slice(0, limit) : rows;
  if (!shown.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const full = max ?? Math.max(1, ...shown.map((row) => Math.abs(row.value)));
  return (
    <ul className={cn("flex flex-col gap-1", className)} {...props}>
      {shown.map((row) => {
        const share = Math.min(1, Math.abs(row.value) / full);
        const content = (
          <>
            <span className="w-40 shrink-0 truncate text-left">{row.label}</span>
            <span aria-hidden className="h-2 min-w-8 flex-1 overflow-hidden rounded-sm bg-muted">
              <span className={cn("block size-full origin-left", fill[row.tone ?? defaultTone])} style={{ transform: `scaleX(${share})` }} />
            </span>
            <span className="w-14 shrink-0 text-right tabular-nums">{format(row.value)}</span>
          </>
        );
        return (
          <li key={row.key} title={row.title ?? row.label} className="text-sm">
            {onSelect ? (
              <button type="button" onClick={() => onSelect(row.key)} className={cn(focusRing, "flex w-full items-center gap-2 rounded-sm hover:bg-accent")}>
                {content}
              </button>
            ) : (
              <span className="flex items-center gap-2">{content}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
