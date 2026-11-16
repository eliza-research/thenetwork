import type { ComponentProps, ReactNode } from "react";
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import { cn, focusRing } from "../lib/cn.ts";
import { Icon } from "./Icon.tsx";

export type DisclosureProps = Omit<ComponentProps<typeof CollapsiblePrimitive.Root>, "children"> & {
  /** The line that stays in view and opens or closes the rest. */
  summary: ReactNode;
  /** Classes of the summary button, such as padding for a card. */
  summaryClassName?: string;
  /** Classes of the content, such as padding for a card. */
  contentClassName?: string;
  /** The content that shows while the disclosure is open. */
  children?: ReactNode;
};

/** Content a person opens only when they need it, under a line that names it. Built on the Radix Collapsible: the summary is a button with `aria-expanded`, and `open` with `onOpenChange` controls it. */
export function Disclosure({ summary, summaryClassName, contentClassName, className, children, ...props }: DisclosureProps) {
  return (
    <CollapsiblePrimitive.Root className={className} {...props}>
      <CollapsiblePrimitive.Trigger className={cn(focusRing, "flex w-full cursor-pointer items-center gap-2 rounded-sm text-left text-sm font-medium text-foreground", summaryClassName)}>
        <Icon name="chevronRight" className="text-muted-foreground transition-transform duration-fast [[data-state=open]>&]:rotate-90" />
        {summary}
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Content className={cn("pt-2 pl-6 text-sm text-foreground", contentClassName)}>{children}</CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  );
}
