import type { ComponentProps } from "react";
import { cn, focusRing } from "../lib/cn.ts";

export type SkipLinkProps = ComponentProps<"a"> & {
  /** The id of the main content, after `#`. */
  href?: string;
};

/** The first element of a page in the tab order. It stays hidden until it has keyboard focus, then moves focus past the header to the main content. */
export function SkipLink({ href = "#main", className, ...props }: SkipLinkProps) {
  return (
    <a
      href={href}
      className={cn(
        focusRing,
        "sr-only rounded-md bg-background px-4 py-2 text-sm font-medium text-foreground shadow-lg focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50",
        className,
      )}
      {...props}
    />
  );
}
