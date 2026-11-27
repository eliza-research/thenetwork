import { clearAllMocks, expect, userEvent, within } from "storybook/test";
import { initial } from "../../../../core/src/generated/consoleNavigation.ts";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { DrawerTabsProps } from "./DrawerTabs.tsx";

type Context = { args: DrawerTabsProps; canvasElement: HTMLElement };

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
    Expanded: { nav: { ...initial, viewer, queues, wantedTab: "MetricsTab" }, defaultSize: "expanded" },
  },
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      const review = canvas.getByRole("tab", { name: /^Review/ });
      await expect(review.textContent).toContain("due soon");
      await expect(canvas.getByText("Review queue")).toBeTruthy();
      await userEvent.click(review);
      await expect(args.onChooseTab).toHaveBeenCalledWith("ReviewTab");
      const tall = canvas.getByRole("button", { name: "Expanded drawer height" });
      await userEvent.click(tall);
      await expect(args.onSizeChange).toHaveBeenCalledWith("expanded");
      const collapse = canvas.getByRole("button", { name: "Collapse" });
      await expect(collapse.getAttribute("aria-expanded")).toBe("true");
      await userEvent.click(collapse);
      await expect(args.onToggleDrawer).toHaveBeenCalledTimes(1);
    },
    Collapsed: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await expect(canvas.queryByText("Review queue")).toBeNull();
      const expand = canvas.getByRole("button", { name: "Expand" });
      await expect(expand.getAttribute("aria-expanded")).toBe("false");
      await userEvent.click(expand);
      await expect(args.onToggleDrawer).toHaveBeenCalledTimes(1);
    },
    "Real data": async ({ canvasElement }: Context) => {
      await expect(within(canvasElement).queryByRole("tab", { name: /^Game/ })).toBeNull();
    },
    Expanded: async ({ canvasElement }: Context) => {
      const canvas = within(canvasElement);
      const tall = canvas.getByRole("button", { name: "Expanded drawer height" });
      await expect(tall.getAttribute("aria-pressed")).toBe("true");
    },
  },
};
