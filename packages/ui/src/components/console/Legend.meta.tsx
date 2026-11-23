import { clearAllMocks, expect, fn, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import { LegendItem, type LegendProps } from "./Legend.tsx";

type Context = { args: LegendProps; canvasElement: HTMLElement };

const toggled = fn();

const head = (canvasElement: HTMLElement) => within(canvasElement).getByRole("button", { name: "Layers" });

export const meta: ComponentMeta<LegendProps> = {
  args: {
    open: true,
    children: (
      <>
        <LegendItem label="met" checked onCheckedChange={toggled} tone="ok" count={31} />
        <LegendItem label="blocked" checked={false} onCheckedChange={toggled} tone="destructive" count={2} />
        <LegendItem label="open opportunities" checked onCheckedChange={toggled} tone="warn" dashedLine />
      </>
    ),
  },
  examples: { Closed: { open: false } },
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await expect(head(canvasElement).getAttribute("aria-expanded")).toBe("true");
      await userEvent.click(canvas.getByRole("checkbox", { name: /blocked/ }));
      await expect(toggled).toHaveBeenCalledWith(true);
      await userEvent.click(head(canvasElement));
      await expect(args.onOpenChange).toHaveBeenCalledWith(false);
    },
    Closed: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      await expect(within(canvasElement).queryByRole("checkbox")).toBeNull();
      await userEvent.click(head(canvasElement));
      await expect(args.onOpenChange).toHaveBeenCalledWith(true);
    },
  },
};
