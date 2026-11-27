import { expect } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { SparklineProps } from "./Sparkline.tsx";

type Context = { canvasElement: HTMLElement };

export const meta: ComponentMeta<SparklineProps> = {
  args: {
    points: [18, 22, 20, 29, 34, 31, 42, 47],
    label: "Daily introductions trend",
  },
  examples: {
    "With target": { target: 35, tone: "ok" },
    "Line only": { showArea: false, tone: "chart-2" },
    Empty: { points: [] },
  },
  play: {
    Default: async ({ canvasElement }: Context) => {
      await expect(canvasElement.querySelector('svg[aria-label="Daily introductions trend"]')).not.toBeNull();
      await expect(canvasElement.querySelector("polyline")).not.toBeNull();
    },
    "With target": async ({ canvasElement }: Context) => {
      await expect(canvasElement.querySelector("line")).not.toBeNull();
    },
  },
};
