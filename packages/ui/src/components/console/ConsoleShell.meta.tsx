import type { ComponentMeta } from "../../lib/meta.ts";
import type { ConsoleShellProps } from "./ConsoleShell.tsx";

export const meta: ComponentMeta<ConsoleShellProps> = {
  args: {
    view: "WorkspaceView",
    topBar: <header className="border-b border-border px-4 py-2 text-sm font-semibold">Observatory</header>,
    filterBar: <div className="border-b border-border px-4 py-2 text-sm text-muted-foreground">Filters</div>,
    stage: <div className="size-full bg-muted" />,
    inspector: <p className="text-sm">Overview</p>,
    drawer: <div className="h-40 border-t border-border p-4 text-sm">Feed</div>,
    page: <p className="text-sm">All apps</p>,
  },
};
