import type { ComponentProps } from "react";
import { cn } from "../lib/cn.ts";

export type ProseProps = ComponentProps<"div">;

/** Sets long text, such as a legal page, at a readable width with spaced headings, paragraphs and lists. */
export function Prose({ className, ...props }: ProseProps) {
  return (
    <div
      className={cn(
        "max-w-2xl font-sans text-base leading-7 text-foreground",
        "[&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:tracking-tight",
        "[&_h2]:mt-10 [&_h2]:scroll-mt-8 [&_h2]:text-xl [&_h2]:font-semibold",
        "[&_p]:mt-4 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_strong]:font-semibold",
        className,
      )}
      {...props}
    />
  );
}
