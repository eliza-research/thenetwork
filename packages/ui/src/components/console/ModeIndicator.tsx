// spec/consoleNavigation.md, "A mode change clears the subject and the picks"
import type { ComponentProps } from "react";
import type { ConsoleMode } from "../../../../core/src/generated/consoleNavigation.ts";
import { cn } from "../../lib/cn.ts";
import { StatusMark } from "./StatusMark.tsx";

export type ModeIndicatorProps = Omit<ComponentProps<"div">, "children"> & {
  /** The world that the console shows. */
  mode: ConsoleMode;
  /** The short name of the app and the data, such as "SLOP · SIM · seed 1". */
  label: string;
  /** The full description of the data source, shown on hover. */
  details?: string;
  /** False while the live connection is lost. */
  connected?: boolean;
  /** The accessible name of the simulated-world shape. */
  simulatedLabel?: string;
  /** The accessible name of the real-data shape. */
  realLabel?: string;
  /** The accessible name of the lost-connection mark. */
  reconnectingLabel?: string;
};

/**
 * Which world the console shows: a dashed ring for the simulated world, a solid square for real data.
 * @model spec/consoleNavigation.md
 */
export function ModeIndicator({
  mode,
  label,
  details,
  connected = true,
  simulatedLabel = "Simulated world",
  realLabel = "Real data",
  reconnectingLabel = "Reconnecting",
  className,
  ...props
}: ModeIndicatorProps) {
  const real = mode === "RealMode";
  return (
    <div title={details} className={cn("inline-flex items-center gap-2 text-sm font-medium", real ? "text-warn" : "text-primary", className)} {...props}>
      <svg role="img" aria-label={real ? realLabel : simulatedLabel} viewBox="0 0 16 16" className="size-4">
        {real ? <path d="M3 3h10v10H3Z" fill="currentColor" /> : <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2" />}
      </svg>
      <span className="text-foreground">{label}</span>
      {connected ? null : <StatusMark tone="warn" label={reconnectingLabel} />}
    </div>
  );
}
