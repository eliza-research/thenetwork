import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn, focusRing } from "../lib/cn.ts";

const toastVariants = cva("relative flex w-full items-start gap-2 rounded-md border-l-4 bg-popover py-3 pr-10 pl-4 text-sm text-popover-foreground shadow-lg", {
  variants: { variant: { info: "border-border", ok: "border-ok", warn: "border-warn", destructive: "border-destructive" } },
  defaultVariants: { variant: "info" },
});

export type ToasterProps = ComponentProps<"div">;
export type ToastProps = ComponentProps<"div"> &
  VariantProps<typeof toastVariants> & {
    /** Removes the toast; when given, the toast shows a close button. */
    onDismiss?: () => void;
    /** The accessible name of the close button. */
    closeLabel?: string;
  };

/** The one place where toasts appear, near the root of an interface. It stays in the page as a `status` live region, so a screen reader reads each `Toast` added to it. */
export function Toaster({ className, ...props }: ToasterProps) {
  return <div role="status" className={cn("pointer-events-none fixed right-0 bottom-0 z-50 flex w-full max-w-sm flex-col gap-2 p-4 *:pointer-events-auto", className)} {...props} />;
}

/** A short message about what just happened, inside a `Toaster`. Its owner removes it. For a message that must interrupt a screen reader, use `Alert`. */
export function Toast({ variant, onDismiss, closeLabel = "Close", className, children, ...props }: ToastProps) {
  return (
    <div className={cn(toastVariants({ variant }), className)} {...props}>
      {children}
      {onDismiss ? (
        <button type="button" aria-label={closeLabel} onClick={onDismiss} className={cn(focusRing, "absolute top-3 right-3 rounded-sm text-muted-foreground hover:text-foreground")}>
          <svg aria-hidden viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4">
            <path d="m3 3 10 10M13 3 3 13" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
