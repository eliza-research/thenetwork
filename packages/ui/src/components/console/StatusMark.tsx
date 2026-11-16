import type { ComponentProps } from "react";
import { cva } from "class-variance-authority";
import { cn } from "../../lib/cn.ts";

/** The status a mark shows: each one has its own color and shape. */
export type StatusTone = "neutral" | "ok" | "warn" | "destructive" | "primary";

const markVariants = cva("inline-flex shrink-0 items-center gap-1 text-sm font-medium", {
  variants: {
    tone: {
      neutral: "text-muted-foreground",
      ok: "text-ok",
      warn: "text-warn",
      destructive: "text-destructive",
      primary: "text-primary",
    },
  },
  defaultVariants: { tone: "neutral" },
});

const shapes: Record<StatusTone, string> = {
  neutral: "M8 3a5 5 0 1 1 0 10A5 5 0 0 1 8 3Z",
  ok: "M8 2a6 6 0 1 1 0 12A6 6 0 0 1 8 2Z",
  warn: "M8 2 14.5 13.5h-13Z",
  destructive: "M3 3h10v10H3Z",
  primary: "M8 1.5 14.5 8 8 14.5 1.5 8Z",
};

export type StatusMarkProps = Omit<ComponentProps<"span">, "children"> & {
  /** The status: ok is a circle, warn a triangle, destructive a square, primary a diamond, neutral a ring. */
  tone?: StatusTone;
  /** The status word. It is the accessible name of the shape, and it shows beside the shape with `showLabel`. */
  label: string;
  /** Shows the status word beside the shape. */
  showLabel?: boolean;
};

/** A status as a colored shape, with the status word as its accessible name. Use it in place of a badge. */
export function StatusMark({ tone = "neutral", label, showLabel = false, className, ...props }: StatusMarkProps) {
  const ring = tone === "neutral";
  return (
    <span className={cn(markVariants({ tone }), className)} {...props}>
      <svg role="img" aria-label={showLabel ? undefined : label} aria-hidden={showLabel || undefined} viewBox="0 0 16 16" className="size-3">
        <path d={shapes[tone]} fill={ring ? "none" : "currentColor"} stroke="currentColor" strokeWidth={ring ? 2 : 0} />
      </svg>
      {showLabel ? <span>{label}</span> : null}
    </span>
  );
}
