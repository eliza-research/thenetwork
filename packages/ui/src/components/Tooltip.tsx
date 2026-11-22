import type { ComponentProps, ReactElement, ReactNode } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "../lib/cn.ts";

export type TooltipProps = Omit<ComponentProps<typeof TooltipPrimitive.Root>, "children"> &
  Pick<ComponentProps<typeof TooltipPrimitive.Content>, "side" | "align" | "className"> & {
    /** What the tooltip says, in a few words. Never the only place of information a person needs. */
    content: ReactNode;
    /** The one element that shows the tooltip on hover and keyboard focus, usually a `Button`. */
    children: ReactElement;
  };

/** A short hint for a control, shown on hover and keyboard focus and given to the control as its description. */
export function Tooltip({ content, side = "top", align, className, children, ...props }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider>
      <TooltipPrimitive.Root {...props}>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            align={align}
            sideOffset={4}
            className={cn("z-50 max-w-xs rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-sm", className)}
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
