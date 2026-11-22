// spec/consoleNavigation.md, "The filter bar dims the filters that do not apply to the open tab"
import type { ComponentProps, ReactNode } from "react";
import { type DrawerTab, type FilterKey, filterDimmed } from "../../../../core/src/generated/consoleNavigation.ts";
import { cn } from "../../lib/cn.ts";
import { Button } from "../Button.tsx";
import { Icon } from "../Icon.tsx";
import { Link } from "../Link.tsx";
import { drawerTabLabel } from "./DrawerTabs.tsx";

/** One filter of the bar: its key, its name and its control. */
export type FilterBarItem = {
  filterKey: FilterKey;
  /** The visible name and the name of the group; leave it out when the control names itself, as a `Segments` row does. Name the control too, with `aria-label`. */
  label?: string;
  control: ReactNode;
};

export type FilterBarProps = Omit<ComponentProps<"div">, "children"> & {
  /** True while the drawer is open. */
  drawerOpen: boolean;
  /** The drawer tab that shows: the generated `tabNow(nav)`. */
  tab: DrawerTab;
  /** The filters, in the order they show. */
  items: FilterBarItem[];
  /** The subject at the start of the bar, as a `FilterBarFocus`. */
  focus?: ReactNode;
  /** Puts every filter back to its default; the Reset control shows only when it is given. */
  onReset?: () => void;
  resetLabel?: string;
};

/**
 * The bar of global filters on the app page. A filter that the open tab does not use is dimmed (the generated `filterDimmed`).
 * @model spec/consoleNavigation.md
 */
export function FilterBar({ drawerOpen, tab, items, focus, onReset, resetLabel = "Reset", className, ...props }: FilterBarProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-4 border-b border-border bg-background px-4 py-2 text-sm", className)} {...props}>
      {focus}
      {items.map((item) => {
        const dimmed = filterDimmed(drawerOpen, tab, item.filterKey);
        return (
          <div
            key={item.filterKey}
            role="group"
            aria-label={item.label}
            data-dimmed={dimmed || undefined}
            title={dimmed ? `Does not apply to ${drawerTabLabel[tab]}` : undefined}
            className={cn("flex items-center gap-2", dimmed && "text-muted-foreground **:text-muted-foreground")}
          >
            {item.label ? (
              <span aria-hidden className="text-muted-foreground">
                {item.label}
              </span>
            ) : null}
            {item.control}
          </div>
        );
      })}
      {onReset ? (
        <Link asChild>
          <button type="button" onClick={onReset}>
            {resetLabel}
          </button>
        </Link>
      ) : null}
    </div>
  );
}

export type FilterBarFocusProps = Omit<ComponentProps<"span">, "children"> & {
  /** The name of the subject that shows. */
  label: ReactNode;
  /** Shows Back: the generated `backShown(nav)`. */
  backShown: boolean;
  /** Returns to the last subject: the generated `goBack`. */
  onBack: () => void;
  /** Returns to the overview: the generated `clearFocus`. */
  onClear: () => void;
};

const iconButton = "size-6 rounded-sm text-muted-foreground";

/** The subject in the filter bar, with Back and Clear. */
export function FilterBarFocus({ label, backShown, onBack, onClear, className, ...props }: FilterBarFocusProps) {
  return (
    <span className={cn("flex items-center gap-1 font-medium", className)} {...props}>
      {backShown ? (
        <Button variant="ghost" size="icon" aria-label="Back" title="Back to the last focus" className={iconButton} onClick={onBack}>
          <Icon name="back" />
        </Button>
      ) : null}
      <span className="max-w-48 truncate">{label}</span>
      <Button variant="ghost" size="icon" aria-label="Clear focus" title="Clear focus (Esc)" className={iconButton} onClick={onClear}>
        <Icon name="close" />
      </Button>
    </span>
  );
}
