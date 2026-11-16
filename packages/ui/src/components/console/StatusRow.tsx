// spec/consoleWorkspace.md, "Each panel shows a loading, refused, unavailable, failed, empty or full view"
import type { ComponentProps, ReactNode } from "react";
import type { PanelView } from "../../../../core/src/generated/consoleWorkspace.ts";
import { cn } from "../../lib/cn.ts";
import { Spinner } from "../Spinner.tsx";

export type StatusRowProps = Omit<ComponentProps<"div">, "children"> & {
  /** The view of the panel: the generated `panelView(panel, answer, rowCount)`. */
  view: PanelView;
  /** Why the read failed. */
  error?: string;
  /** What shows when the answer has no rows. */
  empty?: ReactNode;
  /** What shows when the feature is not on this server. */
  unavailable?: ReactNode;
  /** The rows, shown only in the `PanelRows` view. */
  children?: ReactNode;
};

/**
 * The rows of a panel, or the one line that shows in their place while they load, when the role cannot see them, when the feature is not here, when the read fails or when there are none. Rows never show with a refusal.
 * @model spec/consoleWorkspace.md
 */
export function StatusRow({ view, error, empty = "Nothing to show.", unavailable = "Not available here.", className, children, ...props }: StatusRowProps) {
  if (view === "PanelRows") return <>{children}</>;
  const line =
    view === "PanelLoading" ? (
      <span className="flex items-center gap-2">
        <Spinner size="sm" label="Loading" />
        Loading…
      </span>
    ) : view === "PanelForbidden" ? (
      "Your role cannot see this."
    ) : view === "PanelUnavailable" ? (
      unavailable
    ) : view === "PanelFailed" ? (
      (error ?? "The read failed.")
    ) : (
      empty
    );
  return (
    <div role={view === "PanelFailed" ? "alert" : undefined} className={cn("py-2 text-sm", view === "PanelFailed" ? "text-destructive" : "text-muted-foreground", className)} {...props}>
      {line}
    </div>
  );
}
