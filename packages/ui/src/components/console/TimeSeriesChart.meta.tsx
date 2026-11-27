import { expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { TimeSeriesChartProps } from "./TimeSeriesChart.tsx";

type Context = { canvasElement: HTMLElement };

export const meta: ComponentMeta<TimeSeriesChartProps> = {
  args: {
    label: "Daily signups and matches",
    labels: ["D1", "D2", "D3", "D4", "D5", "D6", "D7"],
    series: [
      { id: "signups", label: "Signups", values: [24, 31, 28, 42, 51, 49, 63] },
      { id: "matches", label: "Matches", values: [9, 12, 15, 19, 24, 27, 34] },
      { id: "replies", label: "Replies", values: [6, 8, 11, 14, 18, 21, 26] },
    ],
  },
  examples: {
    Area: { variant: "area" },
    Bar: { variant: "bar" },
    Empty: { labels: [], series: [] },
  },
  play: {
    Default: async ({ canvasElement }: Context) => {
      const canvas = within(canvasElement);
      const toggle = canvas.getByRole("button", { name: "Signups" });
      await expect(toggle.getAttribute("aria-pressed")).toBe("true");
      await userEvent.click(toggle);
      await expect(toggle.getAttribute("aria-pressed")).toBe("false");
    },
    Empty: async ({ canvasElement }: Context) => {
      await expect(within(canvasElement).getByText("No series data.")).toBeTruthy();
    },
  },
};
