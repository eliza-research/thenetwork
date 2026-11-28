import { clearAllMocks, expect, fn, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { FunnelChartProps } from "./FunnelChart.tsx";

type Context = { args: FunnelChartProps; canvasElement: HTMLElement };

export const meta: ComponentMeta<FunnelChartProps> = {
  args: {
    steps: [
      { key: "visit", label: "Site visit", count: 1200, comparisonCount: 1000 },
      { key: "phone", label: "Phone verified", count: 480, comparisonCount: 380, medianLatency: "2m" },
      { key: "profile", label: "Profile ready", count: 312, comparisonCount: 240, medianLatency: "6m" },
      { key: "intro", label: "First intro", count: 186, comparisonCount: 128, medianLatency: "18h" },
    ],
    onInspectDropOff: fn(),
    onSelectStep: fn(),
  },
  examples: {
    Static: { onInspectDropOff: undefined, onSelectStep: undefined },
    "Zero first step": {
      steps: [
        { key: "outreach", label: "Outreach sent", count: 0 },
        { key: "visit", label: "Site visit", count: 250 },
        { key: "verified", label: "Phone verified", count: 100 },
      ],
    },
    Empty: { steps: [] },
  },
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      const dropButtons = canvas.getAllByRole("button", { name: "Inspect drop-off" });
      await expect(dropButtons.length).toBe(3);
      await userEvent.click(dropButtons[0]);
      await expect(args.onInspectDropOff).toHaveBeenCalledTimes(1);
    },
    "Zero first step": async ({ canvasElement }: Context) => {
      const canvas = within(canvasElement);
      await expect(canvas.getByText("100%")).toBeTruthy();
      await expect(canvas.getByText("40%")).toBeTruthy();
    },
    Empty: async ({ canvasElement }: Context) => {
      await expect(within(canvasElement).getByText("No funnel stages.")).toBeTruthy();
    },
  },
};
