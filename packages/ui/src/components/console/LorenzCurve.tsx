import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.ts";

export type LorenzCurveProps = Omit<ComponentProps<"svg">, "children" | "points"> & {
  /** The share that the lowest 10%, 20% and further hold, from 0 to 1, in order. */
  points: number[];
  /** What the curve shows, for assistive technology. */
  label?: string;
};

/** A Lorenz curve: the diagonal is an equal share, and the curve under it shows how uneven the share is. */
export function LorenzCurve({ points, label = "Lorenz curve of proposal exposure", className, ...props }: LorenzCurveProps) {
  const all = [0, ...points];
  const steps = Math.max(1, all.length - 1);
  const line = all.map((value, index) => `${(index / steps) * 100},${100 - Math.min(1, Math.max(0, value)) * 100}`).join(" ");
  return (
    <svg role="img" aria-label={label} viewBox="-4 -4 108 108" className={cn("size-32 shrink-0", className)} {...props}>
      <rect x="0" y="0" width="100" height="100" className="fill-none stroke-border" strokeWidth="1" />
      <line x1="0" y1="100" x2="100" y2="0" className="stroke-muted-foreground" strokeWidth="1" strokeDasharray="3 3" />
      <polyline points={line} className="fill-none stroke-primary" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
