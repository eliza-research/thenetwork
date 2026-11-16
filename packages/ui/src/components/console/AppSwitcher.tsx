// spec/consoleNavigation.md, "The app switcher opens one app or the all-apps page"
import type { ComponentProps } from "react";
import type { ConsolePage } from "../../../../core/src/generated/consoleNavigation.ts";
import { cn, focusRing } from "../../lib/cn.ts";

/** One app that the viewer holds a role for. */
export type ConsoleAppChoice = {
  id: string;
  /** The domain of the app, shown on hover. */
  title?: string;
};

export type AppSwitcherProps = Omit<ComponentProps<"nav">, "children"> & {
  /** The page that shows. */
  page: ConsolePage;
  /** The app that the app page shows. */
  app: string;
  /** Only the apps that the viewer holds a role for. */
  apps: ConsoleAppChoice[];
  /** Opens an app; `sameApp` is true for the app that shows, which keeps the subject and the picks. */
  onSelectApp: (id: string, sameApp: boolean) => void;
  /** Opens the all-apps page. */
  onOpenAllApps: () => void;
  /** The name of the "all" choice. */
  allLabel?: string;
};

const item = cn(
  focusRing,
  "rounded-sm px-2 py-1 text-sm font-medium text-muted-foreground transition-colors duration-fast ease-standard hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground",
);

/**
 * The apps and the all-apps page. Render it only where the generated `switcherShown(nav)` is true.
 * @model spec/consoleNavigation.md
 */
export function AppSwitcher({ page, app, apps, onSelectApp, onOpenAllApps, allLabel = "all", "aria-label": label = "App", className, ...props }: AppSwitcherProps) {
  const onApp = page === "AppPage";
  return (
    <nav aria-label={label} className={cn("inline-flex items-center gap-1 rounded-md border border-input bg-background p-0.5", className)} {...props}>
      {apps.map((choice) => (
        <button key={choice.id} type="button" title={choice.title} aria-current={onApp && choice.id === app ? "page" : undefined} className={item} onClick={() => onSelectApp(choice.id, choice.id === app)}>
          {choice.id}
        </button>
      ))}
      <button type="button" aria-current={onApp ? undefined : "page"} className={item} onClick={onOpenAllApps}>
        {allLabel}
      </button>
    </nav>
  );
}
