// spec/consolePanels.md, "A deadline countdown turns amber under an hour and red under ten minutes"
import type { ComponentProps } from "react";
import { type CountdownMark, countdownMark, countdownText } from "../../../../core/src/generated/consolePanels.ts";
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

const toneOf: Record<CountdownMark, string> = {
  CountdownUrgent: "text-destructive",
  CountdownNear: "text-warn",
  CountdownCalm: "text-muted-foreground",
};

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
};

/**
 * The time left to a deadline. The generated `countdownMark` gives the color and `countdownText` gives the words.
 * @model spec/consolePanels.md
 */
export function Countdown({ deadline, now, prefix = "", what = "Review deadline", deadlineLabel, overdue = false, className, ...props }: CountdownProps) {
  const left = deadline - now;
  const text = countdownText(overdue, left);
  return (
    <time dateTime={new Date(deadline).toISOString()} title={deadlineLabel ? `${what} ${deadlineLabel}` : what} className={cn("text-sm font-medium whitespace-nowrap tabular-nums", toneOf[countdownMark(overdue, left)], className)} {...props}>
      {text === "CountdownOverdue" ? "overdue" : text === "CountdownDueNow" ? "Due now" : `${prefix}${formatDuration(left)}`}
    </time>
  );
}
