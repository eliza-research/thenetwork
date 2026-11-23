import { initial } from "../../../../core/src/generated/consoleNavigation.ts";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { DrawerTabsProps } from "./DrawerTabs.tsx";

const viewer = { ...initial.viewer, known: true, appsHeld: 1, analyst: true, simRole: true };
const queues = { humanReview: true, reviewItems: true, requestsKnown: true };

export const meta: ComponentMeta<DrawerTabsProps> = {
  args: {
    nav: { ...initial, viewer, queues, wantedTab: "ReviewTab" },
    counts: { ReviewTab: { value: 4, tone: "warn", label: "due soon" }, GameTab: { value: "120 pts" } },
    children: <p className="text-sm">Review queue</p>,
  },
  examples: {
    Collapsed: { nav: { ...initial, viewer, queues, drawerOpen: false } },
    "Real data": { nav: { ...initial, viewer: { ...viewer, mode: "RealMode", simRole: false }, queues: { ...queues, reviewItems: false } } },
  },
};
