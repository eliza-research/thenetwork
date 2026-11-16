import type { ComponentProps, ReactNode } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { cn, focusRing } from "../lib/cn.ts";

type TriggerProps = Pick<ComponentProps<typeof SelectPrimitive.Trigger>, "id" | "className" | "aria-label" | "aria-labelledby" | "aria-describedby" | "aria-invalid">;

export type SelectProps = Omit<ComponentProps<typeof SelectPrimitive.Root>, "children" | "open" | "defaultOpen" | "onOpenChange" | "dir"> &
  TriggerProps & {
    /** Shown while no option is chosen. */
    placeholder?: string;
    /** Marks the choice as refused, visibly and through `aria-invalid`. */
    invalid?: boolean;
    /** The options, each a `SelectItem`. */
    children: ReactNode;
  };
export type SelectItemProps = ComponentProps<typeof SelectPrimitive.Item>;

/** A choice of one option from a list that opens on demand. Name it with a `Field`, a `Label` or `aria-label`. */
export function Select({
  placeholder,
  invalid = false,
  id,
  className,
  "aria-label": label,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
  "aria-invalid": refused,
  children,
  ...props
}: SelectProps) {
  return (
    <SelectPrimitive.Root {...props}>
      <SelectPrimitive.Trigger
        id={id}
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-invalid={invalid || refused || undefined}
        className={cn(
          focusRing,
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive data-placeholder:text-muted-foreground",
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <svg aria-hidden viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0 text-muted-foreground">
            <path d="m4 6 4 4 4-4" />
          </svg>
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
        >
          <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

/** One option of a `Select`. */
export function SelectItem({ className, children, ...props }: SelectItemProps) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex cursor-default items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2 inline-flex items-center">
        <svg aria-hidden viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
          <path d="m3 8.5 3.5 3.5 6.5-8" />
        </svg>
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}
