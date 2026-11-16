import type { ComponentProps, ReactNode } from "react";
import { cn, focusRing } from "../../lib/cn.ts";
import { StatusMark, type StatusTone } from "./StatusMark.tsx";

/** The status of a number. */
export type KpiTone = Extract<StatusTone, "ok" | "warn" | "destructive">;

const valueTone: Record<KpiTone, string> = { ok: "text-ok", warn: "text-warn", destructive: "text-destructive" };
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
  /** Applies the filter or opens the tab that the number counts. */
  onSelect?: () => void;
};

/** One number, large, with its name under it. Put its definition in `title`. */
export function Kpi({ label, value, tone, toneLabel, onSelect, className, ...props }: KpiProps) {
  const body = (
    <>
      <span className={cn("flex items-center gap-2 text-2xl font-semibold tabular-nums", tone ? valueTone[tone] : "text-foreground")}>
        {value}
        {tone ? <StatusMark tone={tone} label={toneLabel ?? toneWord[tone]} /> : null}
      </span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </>
  );
  return (
    <div className={cn("flex min-w-0 flex-col rounded-md border border-border bg-card text-card-foreground", className)} {...props}>
      {onSelect ? (
        <button type="button" onClick={onSelect} className={cn(focusRing, "flex flex-col items-start gap-1 rounded-md p-3 text-left transition-colors duration-fast hover:bg-accent")}>
          {body}
        </button>
      ) : (
        <div className="flex flex-col gap-1 p-3">{body}</div>
      )}
    </div>
  );
}
