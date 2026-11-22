import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

export type FactLineProps = Omit<ComponentProps<"p">, "children"> & {
  /** The facts, in order. Empty parts (null, false, "") do not show. */
  parts: ReactNode[];
};

/** One quiet line of short facts about a subject, separated by space. Each fact keeps the key of its place in `parts`, so a fact that shows or hides does not remount the others. */
export function FactLine({ parts, className, ...props }: FactLineProps) {
  const shown = parts.flatMap((part, place) => (part === null || part === undefined || part === false || part === "" ? [] : [{ part, place }]));
  if (!shown.length) return null;
  return (
    <p className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground", className)} {...props}>
      {shown.map(({ part, place }) => (
        <span key={place}>{part}</span>
      ))}
    </p>
  );
}
