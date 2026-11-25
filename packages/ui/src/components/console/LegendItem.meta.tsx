import { clearAllMocks, expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { LegendItemProps } from "./Legend.tsx";

type Context = { args: LegendItemProps; canvasElement: HTMLElement };

const box = (canvasElement: HTMLElement) => within(canvasElement).getByRole("checkbox", { name: /met/ });

export const meta: ComponentMeta<LegendItemProps> = {
  args: { label: "met", checked: true, tone: "ok", count: 31 },
  examples: {
    Hidden: { checked: false },
    "Dashed line": { label: "met later", tone: "warn", dashedLine: true, count: undefined },
    "No swatch": { tone: undefined },
  },
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      await expect(within(canvasElement).getByText("31")).toBeTruthy();
      await expect(box(canvasElement).getAttribute("aria-checked")).toBe("true");
      await userEvent.click(box(canvasElement));
      await expect(args.onCheckedChange).toHaveBeenCalledWith(false);
    },
    Hidden: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      await userEvent.click(box(canvasElement));
      await expect(args.onCheckedChange).toHaveBeenCalledWith(true);
    },
    "Dashed line": async ({ canvasElement }: Context) => {
      await expect(within(canvasElement).queryByText("31")).toBeNull();
    },
  },
};
