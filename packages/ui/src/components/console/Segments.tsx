import type { ComponentProps, ReactNode } from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { cn, focusRing } from "../../lib/cn.ts";

/** One choice of a `Segments` row. */
export type SegmentOption = {
  value: string;
  label: ReactNode;
  /** A longer name, shown on hover. */
  title?: string;
  disabled?: boolean;
};

export type SegmentsProps = Omit<ComponentProps<typeof RadioGroupPrimitive.Root>, "children" | "orientation"> & {
  /** The choices, in the order they show. */
  options: SegmentOption[];
};

/** A choice of one option from a few, shown as one row of buttons. Name it with `aria-label`; the arrow keys move between the options. */
export function Segments({ options, className, ...props }: SegmentsProps) {
  return (
    <RadioGroupPrimitive.Root orientation="horizontal" className={cn("inline-flex items-center gap-1 rounded-md border border-input bg-background p-0.5", className)} {...props} onClick={props.disabled ? undefined : props.onClick}>
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          title={option.title}
          disabled={option.disabled}
          className={cn(
            focusRing,
            "rounded-sm px-2 py-1 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors duration-fast ease-standard hover:text-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground",
          )}
        >
          {option.label}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}
