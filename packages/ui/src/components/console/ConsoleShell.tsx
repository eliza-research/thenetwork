// spec/consoleNavigation.md, "The console view follows the page"
import type { ComponentProps, ReactNode } from "react";
import type { ConsoleView } from "../../../../core/src/generated/consoleNavigation.ts";
import { cn } from "../../lib/cn.ts";
import { Spinner } from "../Spinner.tsx";

export type ConsoleShellProps = Omit<ComponentProps<"div">, "children"> & {
  /** The view of the console: the generated `viewFor(nav)`. */
  view: ConsoleView;
  /** The top bar; it shows in every view. */
  topBar: ReactNode;
  /** The filter bar; it shows only in the workspace view. */
  filterBar?: ReactNode;
  /** The map or the graph, with what floats over it. It stays mounted in every view, so the renderer keeps its state, and shows only in the workspace view. */
  stage?: ReactNode;
  /** The inspector beside the stage. */
  inspector?: ReactNode;
  /** The drawer under the stage; it shows only in the workspace view. */
  drawer?: ReactNode;
  /** The page that covers the stage in the all-apps, person and no-role views. */
  page?: ReactNode;
  /** What shows while the viewer is not known. */
  loading?: ReactNode;
  /** What floats over every view, such as the toaster or a sign-in prompt. */
  overlay?: ReactNode;
};

/**
 * The frame of the staff console: one top bar, then the filter bar, the stage, the inspector and the drawer on the app page, or one page that covers them.
 * @model spec/consoleNavigation.md
 */
export function ConsoleShell({ view, topBar, filterBar, stage, inspector, drawer, page, loading, overlay, className, ...props }: ConsoleShellProps) {
  const workspace = view === "WorkspaceView";
  return (
    <div className={cn("flex h-dvh flex-col bg-background font-sans text-foreground", className)} {...props}>
      {topBar}
      {workspace ? filterBar : null}
      <main className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="relative min-h-64 min-w-0 flex-1" hidden={!workspace}>
          {stage}
        </div>
        {workspace ? <aside className="flex max-h-full flex-col gap-4 overflow-y-auto border-t border-border p-4 md:w-96 md:shrink-0 md:border-t-0 md:border-l">{inspector}</aside> : null}
        {view === "LoadingView" ? (
          <div className="flex flex-1 items-center justify-center">{loading ?? <Spinner label="Loading" />}</div>
        ) : null}
        {!workspace && view !== "LoadingView" ? <div className="min-h-0 flex-1 overflow-y-auto p-4">{page}</div> : null}
      </main>
      {workspace ? drawer : null}
      {overlay}
    </div>
  );
}
