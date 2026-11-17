import { type ComponentProps, type ReactNode, useId } from "react";
import { cn } from "../../lib/cn.ts";

export type InspectorSectionProps = Omit<ComponentProps<"section">, "title"> & {
  /** The name of the section. */
  title: ReactNode;
  /** One control at the end of the title row, such as a `Segments` row or a `Button`. */
  action?: ReactNode;
};

/** One named group of facts in the inspector or in a drawer panel. */
export function InspectorSection({ title, action, className, children, ...props }: InspectorSectionProps) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn("flex min-w-0 flex-col gap-2", className)} {...props}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={id} className="text-sm font-semibold text-foreground">
          {title}
        </h3>
        {action ? <div className="ml-auto flex items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}
