import type { ComponentProps } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn, focusRing } from "../lib/cn.ts";

export type TabsProps = ComponentProps<typeof TabsPrimitive.Root>;
export type TabsListProps = ComponentProps<typeof TabsPrimitive.List>;
export type TabsTriggerProps = ComponentProps<typeof TabsPrimitive.Trigger>;
export type TabsContentProps = ComponentProps<typeof TabsPrimitive.Content>;

/** Views of one thing, one at a time: holds a `TabsList` of `TabsTrigger`s and one `TabsContent` for each. The arrow keys move between the triggers. */
export function Tabs({ className, ...props }: TabsProps) {
  return <TabsPrimitive.Root className={cn("flex flex-col gap-4", className)} {...props} />;
}

/** The row of `TabsTrigger`s. Name it with `aria-label` when the page has more than one. */
export function TabsList({ className, ...props }: TabsListProps) {
  return <TabsPrimitive.List className={cn("flex items-center gap-1 border-b border-border", className)} {...props} />;
}

/** Shows the `TabsContent` of the same `value`. */
export function TabsTrigger({ className, ...props }: TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        focusRing,
        "-mb-px rounded-t-md border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border-primary data-[state=active]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** The view of one `TabsTrigger`. */
export function TabsContent({ className, ...props }: TabsContentProps) {
  return <TabsPrimitive.Content className={cn(focusRing, "rounded-md", className)} {...props} />;
}
