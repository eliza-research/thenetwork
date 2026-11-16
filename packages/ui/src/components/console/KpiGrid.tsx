import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.ts";

export type KpiGridProps = ComponentProps<"div"> & {
  /** Two narrow columns, for a section beside others. */
  compact?: boolean;
};

/** A grid of `Kpi` numbers. */
export function KpiGrid({ compact = false, className, ...props }: KpiGridProps) {
  return <div className={cn("grid gap-3", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3", className)} {...props} />;
}
