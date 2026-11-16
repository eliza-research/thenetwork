// spec/brandIdentity.md, "Each accent has one color for light mode and one for dark mode"
import type { ComponentProps } from "react";
import { cn } from "../lib/cn.ts";

export type HeadlineProps = Omit<ComponentProps<"h1">, "children"> & {
  /** The text before the highlighted word. */
  lead: string;
  /** The highlighted word, filled with the brand color. */
  mark: string;
  /** The text after the highlighted word. */
  tail: string;
};

/** The one heading of a landing page: a short line with one word highlighted in the brand color. */
export function Headline({ lead, mark, tail, className, ...props }: HeadlineProps) {
  return (
    <h1 className={cn("max-w-4xl text-5xl leading-none font-semibold tracking-tighter text-balance text-foreground sm:text-7xl lg:text-8xl", className)} {...props}>
      {lead}
      <mark className="rounded-md bg-primary px-2 text-primary-foreground box-decoration-clone">{mark}</mark>
      {tail}
    </h1>
  );
}
