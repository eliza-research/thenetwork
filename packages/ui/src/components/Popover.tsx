import type { ComponentProps } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "../lib/cn.ts";

export type PopoverProps = ComponentProps<typeof PopoverPrimitive.Root>;
export type PopoverContentProps = ComponentProps<typeof PopoverPrimitive.Content>;

/** A panel of controls beside the element that opens it: holds a `PopoverTrigger` and a `PopoverContent`. For a task that must be finished or cancelled, use `Dialog`. */
export function Popover(props: PopoverProps) {
  return <PopoverPrimitive.Root {...props} />;
}

/** Opens and closes the popover; pass `asChild` to use a `Button`. */
export const PopoverTrigger = PopoverPrimitive.Trigger;

/** Closes the popover; pass `asChild` to use a `Button`. */
export const PopoverClose = PopoverPrimitive.Close;

/** The panel. Name it with `aria-label` or `aria-labelledby`; Escape and a click outside close it, and focus goes back to the trigger. */
export function PopoverContent({ align = "center", sideOffset = 4, className, ...props }: PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn("z-50 flex w-72 flex-col gap-4 rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-lg outline-none", className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
