import type { ComponentProps, ReactNode } from "react";
import { cn, focusRing } from "../../lib/cn.ts";

/** One stage in a conversion funnel. */
export type FunnelStep = {
  key: string;
  label: string;
  count: number;
  /** Optional baseline or comparison cohort count for side-by-side bars. */
  comparisonCount?: number;
  /** Median transition latency from the prior stage, such as "4m" or "2.1h". */
  medianLatency?: string;
  /** Definition shown on hover. */
  title?: string;
};

export type FunnelChartProps = Omit<ComponentProps<"div">, "children"> & {
  /** Ordered funnel stages from entry to completion. */
  steps: FunnelStep[];
  /** Label for the primary series when comparison counts are shown. */
  primaryLabel?: string;
  /** Label for the optional comparison series. */
  comparisonLabel?: string;
  /** Formats step counts. */
  formatCount?: (count: number) => string;
  /** Called when a user clicks a funnel step. */
  onSelectStep?: (step: FunnelStep, index: number) => void;
  /** Called when a user clicks the drop-off gap between two consecutive steps. */
  onInspectDropOff?: (from: FunnelStep, to: FunnelStep, index: number) => void;
  /** Shown when `steps` is empty. */
  empty?: ReactNode;
};

const formatPlain = (value: number) => value.toLocaleString("en-US");
const formatPct = (numerator: number, denominator: number) => (denominator > 0 ? `${Math.round((numerator / denominator) * 1000) / 10}%` : "0%");

/** Interactive horizontal stepped conversion funnel with proportional bars, step-to-step %, cumulative %, latency pills, comparison series, and drop-off inspection. */
export function FunnelChart({
  steps,
  primaryLabel = "Current",
  comparisonLabel = "Baseline",
  formatCount = formatPlain,
  onSelectStep,
  onInspectDropOff,
  empty = "No funnel stages.",
  className,
  ...props
}: FunnelChartProps) {
  if (!steps.length) {
    return (
      <div className={cn("rounded-md border border-border bg-card p-4 text-sm text-muted-foreground", className)} {...props}>
        {empty}
      </div>
    );
  }

  const peakCount = Math.max(1, ...steps.map((step) => step.count));
  const baseCount = steps[0].count > 0 ? steps[0].count : peakCount;
  const hasComparison = steps.some((step) => step.comparisonCount !== undefined);
  const compPeak = hasComparison ? Math.max(1, ...steps.map((step) => step.comparisonCount ?? 0)) : 1;
  const compBase = hasComparison
    ? (steps[0].comparisonCount ?? 0) > 0
      ? (steps[0].comparisonCount ?? baseCount)
      : compPeak
    : 1;

  return (
    <div className={cn("flex flex-col gap-2 rounded-md border border-border bg-card p-4 text-card-foreground", className)} {...props}>
      {hasComparison ? (
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-sm bg-chart-1" />
            <span>{primaryLabel}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-sm bg-chart-2" />
            <span>{comparisonLabel}</span>
          </span>
        </div>
      ) : null}

      <ol className="flex flex-col gap-1">
        {steps.map((step, index) => {
          const prev = index > 0 ? steps[index - 1] : undefined;
          const share = Math.min(1, Math.max(0, step.count / baseCount));
          const compShare =
            step.comparisonCount !== undefined ? Math.min(1, Math.max(0, step.comparisonCount / compBase)) : undefined;
          const dropCount = prev ? Math.max(0, prev.count - step.count) : 0;

          const rowInner = (
            <>
              <div className="flex w-44 shrink-0 items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-foreground">{step.label}</span>
                {step.medianLatency ? (
                  <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                    {step.medianLatency}
                  </span>
                ) : null}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span aria-hidden className="block h-5 w-full overflow-hidden rounded-sm bg-muted">
                  <span className="block size-full origin-left bg-chart-1 transition-transform duration-base ease-standard" style={{ transform: `scaleX(${share})` }} />
                </span>
                {compShare !== undefined ? (
                  <span aria-hidden className="block h-2 w-full overflow-hidden rounded-sm bg-muted">
                    <span className="block size-full origin-left bg-chart-2 transition-transform duration-base ease-standard" style={{ transform: `scaleX(${compShare})` }} />
                  </span>
                ) : null}
              </div>
              <div className="flex w-32 shrink-0 items-baseline justify-end gap-2 text-right tabular-nums">
                <span className="text-sm font-semibold text-foreground">{formatCount(step.count)}</span>
                <span className="w-12 text-xs text-muted-foreground">{formatPct(step.count, baseCount)}</span>
              </div>
            </>
          );

          return (
            <li key={step.key} className="flex flex-col gap-1">
              {prev ? (
                <div className="flex items-center gap-2 pl-44 text-xs tabular-nums text-muted-foreground">
                  <span>{formatPct(step.count, prev.count)} step</span>
                  <span>−{formatCount(dropCount)} dropped</span>
                  {onInspectDropOff && dropCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => onInspectDropOff(prev, step, index - 1)}
                      className={cn(
                        focusRing,
                        "rounded-sm px-1.5 py-0.5 text-xs font-medium text-primary transition-colors duration-fast hover:bg-accent hover:text-accent-foreground",
                      )}
                    >
                      Inspect drop-off
                    </button>
                  ) : null}
                </div>
              ) : null}
              {onSelectStep ? (
                <button
                  type="button"
                  title={step.title ?? step.label}
                  onClick={() => onSelectStep(step, index)}
                  className={cn(focusRing, "flex w-full items-center gap-3 rounded-sm p-1.5 text-left transition-colors duration-fast hover:bg-accent")}
                >
                  {rowInner}
                </button>
              ) : (
                <div title={step.title ?? step.label} className="flex items-center gap-3 rounded-sm p-1.5">
                  {rowInner}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
