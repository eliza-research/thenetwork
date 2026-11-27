import type { ComponentProps, ReactNode } from "react";
import { cn, focusRing } from "../../lib/cn.ts";
import { Sparkline } from "./Sparkline.tsx";
import { StatusMark, type StatusTone } from "./StatusMark.tsx";

/** The status of a number. */
export type KpiTone = Extract<StatusTone, "ok" | "warn" | "destructive">;

/** The color tone of a `Kpi` delta readout. */
export type KpiDeltaTone = "ok" | "warn" | "destructive" | "muted";

/** A relative change shown beside a `Kpi` value. */
export type KpiDelta = {
  /** Formatted change string, such as "+14%". */
  value: string;
  /** Semantic tone of the change. */
  tone?: KpiDeltaTone;
};

const valueTone: Record<KpiTone, string> = { ok: "text-ok", warn: "text-warn", destructive: "text-destructive" };
const deltaTone: Record<KpiDeltaTone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
};
const toneWord: Record<KpiTone, string> = { ok: "Good", warn: "Warning", destructive: "Alert" };

export type KpiProps = Omit<ComponentProps<"div">, "onClick"> & {
  /** What the number counts, in a few words. */
  label: string;
  /** The number, formatted. */
  value: ReactNode;
  /** Colors the number and adds the shape of its status. */
  tone?: KpiTone;
  /** The status word of `tone`, for assistive technology. */
  toneLabel?: string;
  /** Optional relative change shown beside the number. */
  delta?: KpiDelta;
  /** Optional ordered trend samples rendered as a sparkline. */
  sparkline?: number[];
  /** Optional reference target line drawn on the sparkline. */
  target?: number;
  /** Applies the filter or opens the tab that the number counts. */
  onSelect?: () => void;
};

/** One number, large, with its name under it and optional delta and sparkline. Put its definition in `title`. */
export function Kpi({ label, value, tone, toneLabel, delta, sparkline, target, onSelect, className, ...props }: KpiProps) {
  const deltaClass = delta ? deltaTone[delta.tone ?? "muted"] : "";
  const body = (
    <>
      <span className="flex w-full items-baseline justify-between gap-2">
        <span className={cn("flex items-center gap-2 text-2xl font-semibold tabular-nums", tone ? valueTone[tone] : "text-foreground")}>
          {value}
          {tone ? <StatusMark tone={tone} label={toneLabel ?? toneWord[tone]} /> : null}
        </span>
        {delta ? <span className={cn("text-xs font-medium tabular-nums", deltaClass)}>{delta.value}</span> : null}
      </span>
      <span className="text-sm text-muted-foreground">{label}</span>
      {sparkline && sparkline.length > 0 ? (
        <Sparkline points={sparkline} target={target} tone={tone ?? "chart-1"} aria-hidden className="mt-1 h-7" />
      ) : null}
    </>
  );
  return (
    <div className={cn("flex min-w-0 flex-col rounded-md border border-border bg-card text-card-foreground", className)} {...props}>
      {onSelect ? (
        <button type="button" onClick={onSelect} className={cn(focusRing, "flex w-full flex-col items-start gap-1 rounded-md p-3 text-left transition-colors duration-fast hover:bg-accent")}>
          {body}
        </button>
      ) : (
        <div className="flex flex-col gap-1 p-3">{body}</div>
      )}
    </div>
  );
}
