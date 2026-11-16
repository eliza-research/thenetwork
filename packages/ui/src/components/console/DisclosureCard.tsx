import { cn } from "../../lib/cn.ts";
import { Disclosure, type DisclosureProps } from "../Disclosure.tsx";

export type DisclosureCardProps = Omit<DisclosureProps, "summaryClassName" | "contentClassName">;

/** A queue card whose head opens its body: the shared part of the case, report and review cards. Space, not a line, separates the head from the body. */
export function DisclosureCard({ className, ...props }: DisclosureCardProps) {
  return (
    <Disclosure
      className={cn("rounded-md border border-border bg-card text-sm text-card-foreground", className)}
      summaryClassName="flex-wrap gap-y-1 rounded-md px-3 py-2 font-normal"
      contentClassName="flex flex-col gap-3 px-3 pt-1 pb-3"
      {...props}
    />
  );
}
