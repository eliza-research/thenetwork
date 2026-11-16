import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Checkbox } from "../Checkbox.tsx";
import { Disclosure } from "../Disclosure.tsx";

/** The color of a legend swatch. The map and graph renderers must draw with the same tokens. */
export type LegendTone = "primary" | "ok" | "warn" | "destructive" | "muted" | "accent";

const solid: Record<LegendTone, string> = { primary: "bg-primary", ok: "bg-ok", warn: "bg-warn", destructive: "bg-destructive", muted: "bg-muted-foreground", accent: "bg-accent-foreground" };
const dashed: Record<LegendTone, string> = {
  primary: "border-primary",
  ok: "border-ok",
  warn: "border-warn",
  destructive: "border-destructive",
  muted: "border-muted-foreground",
  accent: "border-accent-foreground",
};

export type LegendProps = Omit<ComponentProps<"div">, "title" | "dir"> & {
  /** True while the layers show. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The name of the legend. */
  title?: string;
  /** The color lens `Select` and the `LegendItem`s. */
  children: ReactNode;
};

/** The layers of the map or graph, in a corner of the stage. It opens and closes on its title, as a `Disclosure`. */
export function Legend({ open, onOpenChange, title = "Layers", className, children, ...props }: LegendProps) {
  return (
    <Disclosure
      open={open}
      onOpenChange={onOpenChange}
      summary={title}
      className={cn("w-56 rounded-md border border-border bg-popover p-2 text-sm text-popover-foreground shadow-md", className)}
      summaryClassName="px-1"
      contentClassName="flex flex-col gap-2 pl-0"
      {...props}
    >
      {children}
    </Disclosure>
  );
}

export type LegendItemProps = Omit<ComponentProps<"label">, "children"> & {
  /** The name of the layer. */
  label: string;
  /** True while the layer shows. */
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** The color of the swatch; no swatch when left out. */
  tone?: LegendTone;
  /** A dashed swatch, for a line that is not yet real, such as an open opportunity. */
  dashedLine?: boolean;
  /** How many the layer holds. */
  count?: number;
};

/** One layer of a `Legend`: a check box, its swatch, its name and its count. */
export function LegendItem({ label, checked, onCheckedChange, tone, dashedLine = false, count, className, ...props }: LegendItemProps) {
  return (
    <label className={cn("flex items-center gap-2", className)} {...props}>
      <Checkbox checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} />
      {tone ? <span aria-hidden className={cn("h-0 w-4 shrink-0", dashedLine ? cn("border-t-2 border-dashed", dashed[tone]) : cn("h-1 rounded-sm", solid[tone]))} /> : null}
      <span className="flex-1">{label}</span>
      {count === undefined ? null : <span className="text-muted-foreground tabular-nums">{count}</span>}
    </label>
  );
}
