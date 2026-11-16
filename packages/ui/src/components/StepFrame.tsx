// spec/browserJoin.md, "The page shows the step that the current session allows"
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn.ts";

export type StepFrameProps = Omit<ComponentProps<"section">, "title"> & {
  /** The one heading of the step. It takes focus when the step shows and has no field to focus. */
  title: ReactNode;
  /** The body of the step below the heading. */
  children?: ReactNode;
  /** A request runs: the frame does not call the `onClick` it was given. */
  loading?: boolean;
};

/** The frame of one step of a flow: one heading and the body below it. The heading is the focus target when the step changes. */
export function StepFrame({ title, className, children, loading = false, onClick, ...props }: StepFrameProps) {
  return (
    <section className={cn("flex flex-col gap-4", className)} onClick={loading ? undefined : onClick} {...props}>
      <h1 tabIndex={-1} className="text-2xl font-semibold text-foreground outline-none">
        {title}
      </h1>
      {children}
    </section>
  );
}
