import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { BrandMarkProps } from "./BrandMark.tsx";

export const meta: ComponentMeta<BrandMarkProps> = {
  args: { logo: "GraphMark", className: "size-16" },
  examples: { Named: { logo: "HeartMark", "aria-label": "slop.date" } },
  play: {
    Named: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      await expect(within(canvasElement).getByRole("img", { name: "slop.date" })).toBeTruthy();
    },
  },
};
