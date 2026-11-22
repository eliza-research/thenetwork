// spec/browserJoin.md, "A person can join, find they are in, be blocked, leave for cloud sign-in or see each error"
import type { ComponentProps } from "react";
import { cn } from "../lib/cn.ts";

export type FieldErrorProps = ComponentProps<"p">;

/** Why a form or a field was refused, announced when it shows. Give it an `id` and point the form or the control at it with `aria-describedby`. Shows nothing without children. */
export function FieldError({ className, children, ...props }: FieldErrorProps) {
  if (children === undefined || children === null || children === "" || children === false) return null;
  return (
    <p role="alert" className={cn("text-sm text-destructive", className)} {...props}>
      {children}
    </p>
  );
}
