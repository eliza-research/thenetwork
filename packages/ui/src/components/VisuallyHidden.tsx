import type { ComponentProps } from "react";
import { cn } from "../lib/cn.ts";

export type VisuallyHiddenProps = ComponentProps<"span">;

/** Text that a screen reader reads and the screen does not show, such as the name of a visual. */
export function VisuallyHidden({ className, ...props }: VisuallyHiddenProps) {
  return <span className={cn("sr-only", className)} {...props} />;
}
