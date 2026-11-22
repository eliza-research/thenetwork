import type { ComponentProps, ReactNode } from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { cn, focusRing } from "../lib/cn.ts";
import { Label } from "./Label.tsx";

export type RadioGroupProps = ComponentProps<typeof RadioGroupPrimitive.Root> & {
  /** Marks the choice as refused, visibly and through `aria-invalid`. */
  invalid?: boolean;
};
export type RadioGroupItemProps = Omit<ComponentProps<typeof RadioGroupPrimitive.Item>, "children"> & {
  /** The name of the option, shown beside its circle. */
  children: ReactNode;
};

/** A choice of one option from a few, all shown at once. Name the group with a `Field` or `aria-label`; the arrow keys move between its `RadioGroupItem`s. */
export function RadioGroup({ invalid = false, className, ...props }: RadioGroupProps) {
  return (
    <RadioGroupPrimitive.Root
      aria-invalid={invalid || undefined}
      className={cn("group flex flex-col gap-2 aria-[orientation=horizontal]:flex-row aria-[orientation=horizontal]:gap-4", className)}
      {...props}
      onClick={props.disabled ? undefined : props.onClick}
    />
  );
}

/** One option of a `RadioGroup`, with its name as a label. */
export function RadioGroupItem({ className, children, ...props }: RadioGroupItemProps) {
  return (
    <Label className="font-normal">
      <RadioGroupPrimitive.Item
        className={cn(
          focusRing,
          "inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-input bg-background group-aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary",
          className,
        )}
        {...props}
      >
        <RadioGroupPrimitive.Indicator className="size-2 rounded-full bg-primary" />
      </RadioGroupPrimitive.Item>
      {children}
    </Label>
  );
}
