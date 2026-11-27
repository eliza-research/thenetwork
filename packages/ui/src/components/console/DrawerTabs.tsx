// spec/consoleNavigation.md, "Each drawer tab shows only where it applies"
// spec/consoleNavigation.md, "A tab choice opens the drawer, and the open tab collapses it"
import { useState, type ComponentProps, type ReactNode } from "react";
import { type ConsoleNav, type DrawerTab, factsOf, tabNow, tabVisible } from "../../../../core/src/generated/consoleNavigation.ts";
import { cn } from "../../lib/cn.ts";
import { Button } from "../Button.tsx";
import { Icon } from "../Icon.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../Tabs.tsx";
import { VisuallyHidden } from "../VisuallyHidden.tsx";
import type { StatusTone } from "./StatusMark.tsx";

/** The drawer height mode when open. */
export type DrawerSize = "compact" | "expanded" | "full";

const drawerSizeClass: Record<DrawerSize, string> = {
  compact: "relative z-20 h-80",
  expanded: "relative z-20 h-[55dvh]",
  full: "fixed inset-0 z-40",
};

const drawerSizeOptions: readonly { value: DrawerSize; short: string; label: string }[] = [
  { value: "compact", short: "Compact", label: "Compact drawer height" },
  { value: "expanded", short: "Tall", label: "Expanded drawer height" },
  { value: "full", short: "Full", label: "Full screen drawer" },
];

/** The drawer tabs in the order they show. */
export const drawerTabOrder: readonly DrawerTab[] = ["ReviewTab", "FeedTab", "PipelineTab", "RequestsTab", "EngineTab", "SafetyTab", "MetricsTab", "LabTab", "ConfigTab", "GameTab"];

/** The name of each drawer tab. */
export const drawerTabLabel: Record<DrawerTab, string> = {
  ReviewTab: "Review",
  FeedTab: "Feed",
  PipelineTab: "Pipeline",
  RequestsTab: "Requests",
  EngineTab: "Runs",
  SafetyTab: "Safety",
  MetricsTab: "Metrics",
  LabTab: "Lab",
  ConfigTab: "Config",
  GameTab: "Game",
};

/** A number beside a tab name, such as the review count or the game points. */
export type DrawerTabCount = {
  value: string | number;
  /** Colors the number, such as warn when a review is due soon. */
  tone?: Extract<StatusTone, "warn" | "destructive" | "ok">;
  /** What the number means, for assistive technology. */
  label?: string;
};

const countTone = { warn: "text-warn", destructive: "text-destructive", ok: "text-ok" } as const;

export type DrawerTabsProps = Omit<ComponentProps<"section">, "children"> & {
  /** The console navigation state. The tabs are the generated `tabVisible` tabs, and the one that shows is `tabNow(nav)`. */
  nav: ConsoleNav;
  /** A number beside some tab names. */
  counts?: Partial<Record<DrawerTab, DrawerTabCount>>;
  /** Chooses a tab: the generated `chooseTab`, which also collapses the drawer on the tab that shows. */
  onChooseTab: (tab: DrawerTab) => void;
  /** Opens or collapses the drawer: the generated `toggleDrawer`. */
  onToggleDrawer: () => void;
  /** Controlled height mode when open. */
  size?: DrawerSize;
  /** Initial height mode when uncontrolled. Defaults to `"compact"`. */
  defaultSize?: DrawerSize;
  /** Called when the user selects a height mode. */
  onSizeChange?: (size: DrawerSize) => void;
  /** Shows the compact/expanded/full height controls while the drawer is open. Defaults to `true`. */
  resizable?: boolean;
  /** The panel of the tab that shows. It renders only while the drawer is open. */
  children?: ReactNode;
  /** The accessible name of the collapse button. */
  collapseLabel?: string;
  /** The accessible name of the expand button. */
  expandLabel?: string;
};

/**
 * The drawer under the stage: a row of tabs and the panel of the tab that shows.
 * @model spec/consoleNavigation.md
 */
export function DrawerTabs({
  nav,
  counts = {},
  onChooseTab,
  onToggleDrawer,
  size,
  defaultSize = "compact",
  onSizeChange,
  resizable = true,
  collapseLabel = "Collapse",
  expandLabel = "Expand",
  "aria-label": label = "Drawer",
  className,
  children,
  ...props
}: DrawerTabsProps) {
  const [innerSize, setInnerSize] = useState<DrawerSize>(defaultSize);
  const activeSize = size ?? innerSize;
  const setSize = (next: DrawerSize) => {
    if (size === undefined) setInnerSize(next);
    onSizeChange?.(next);
  };
  const facts = factsOf(nav);
  const tabs = drawerTabOrder.filter((tab) => tabVisible(tab, facts));
  const shown = tabNow(nav);
  const open = nav.drawerOpen;
  return (
    <section
      aria-label={label}
      data-drawer-size={open ? activeSize : "closed"}
      className={cn("relative z-20 flex flex-col border-t border-border bg-background", open ? drawerSizeClass[activeSize] : "", className)}
      {...props}
    >
      <Tabs value={open ? shown : ""} activationMode="manual" className="min-h-0 flex-1 gap-0">
        <div className="flex items-center gap-2 px-2">
          <TabsList aria-label={label} className="min-w-0 flex-1 overflow-x-auto border-b-0">
            {tabs.map((tab) => {
              const count = counts[tab];
              return (
                <TabsTrigger key={tab} value={tab} onClick={() => onChooseTab(tab)}>
                  {drawerTabLabel[tab]}
                  {count ? (
                    <span className={cn("ml-1 tabular-nums", count.tone ? countTone[count.tone] : "text-muted-foreground")}>
                      {count.value}
                      {count.label ? <VisuallyHidden> {count.label}</VisuallyHidden> : null}
                    </span>
                  ) : null}
                </TabsTrigger>
              );
            })}
          </TabsList>
          {open && resizable ? (
            <div role="group" aria-label="Drawer height" className="hidden items-center gap-0.5 sm:flex">
              {drawerSizeOptions.map((option) => (
                <Button
                  key={option.value}
                  variant={activeSize === option.value ? "secondary" : "ghost"}
                  size="sm"
                  aria-label={option.label}
                  aria-pressed={activeSize === option.value}
                  onClick={() => setSize(option.value)}
                >
                  {option.short}
                </Button>
              ))}
            </div>
          ) : null}
          <Button variant="ghost" size="icon" aria-label={open ? collapseLabel : expandLabel} aria-expanded={open} onClick={onToggleDrawer}>
            <Icon name="chevronDown" className={cn("transition-transform duration-fast", open ? "" : "rotate-180")} />
          </Button>
        </div>
        {open ? (
          <TabsContent value={shown} className="min-h-0 flex-1 overflow-y-auto border-t border-border p-4">
            {children}
          </TabsContent>
        ) : null}
      </Tabs>
    </section>
  );
}
