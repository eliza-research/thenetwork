import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

export type TopBarProps = ComponentProps<"header"> & {
  /** The mark and the name of the console, at the start. */
  brand: ReactNode;
  /** The controls at the end: the search box, the viewer and help. */
  end?: ReactNode;
};

/** The one bar at the top of the staff console. Its children (the app switcher, the mode and the clock) sit between the brand and the end controls. */
export function TopBar({ brand, end, className, children, ...props }: TopBarProps) {
  return (
    <header className={cn("flex flex-wrap items-center gap-3 border-b border-border bg-background px-4 py-2", className)} {...props}>
      <div className="flex items-center gap-2 text-sm font-semibold">{brand}</div>
      {children}
      {end ? <div className="ml-auto flex flex-wrap items-center gap-2">{end}</div> : null}
    </header>
  );
}
