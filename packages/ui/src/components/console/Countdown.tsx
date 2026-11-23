import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.ts";

/** A compact duration: "45m", "4h 12m", "2d 3h". */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days >= 1) return `${days}d${hours % 24 ? ` ${hours % 24}h` : ""}`;
  if (hours >= 1) return `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
  return `${minutes}m`;
}

export type CountdownProps = Omit<ComponentProps<"time">, "children"> & {
  /** When the time ends, in milliseconds since 1970. */
  deadline: number;
  /** The time now on the console clock: simulated time in the simulated world, wall time on real data. The owner ticks it. */
  now: number;
  /** Text before the time left, such as "Due in ". */
  prefix?: string;
  /** What ends, shown on hover before `deadlineLabel`. */
  what?: string;
  /** The deadline as the console writes a date, shown on hover. */
  deadlineLabel?: string;
  /** Shows "overdue" in place of the time left, when the server says so. */
  overdue?: boolean;
  /** Under this time left the countdown is amber. */
  warnWithinMs?: number;
  /** Under this time left the countdown is red. */
  urgentWithinMs?: number;
};

/** The time left to a deadline. It turns amber under an hour and red under ten minutes. */
export function Countdown({
  deadline,
  now,
  prefix = "",
  what = "Review deadline",
  deadlineLabel,
  overdue = false,
  warnWithinMs = 3_600_000,
  urgentWithinMs = 600_000,
  className,
  ...props
}: CountdownProps) {
  const left = deadline - now;
  const tone = overdue || left < urgentWithinMs ? "text-destructive" : left < warnWithinMs ? "text-warn" : "text-muted-foreground";
  return (
    <time dateTime={new Date(deadline).toISOString()} title={deadlineLabel ? `${what} ${deadlineLabel}` : what} className={cn("text-sm font-medium whitespace-nowrap tabular-nums", tone, className)} {...props}>
      {overdue ? "overdue" : left <= 0 ? "Due now" : `${prefix}${formatDuration(left)}`}
    </time>
  );
}
