import { clearAllMocks, expect, fn, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { CheckboxProps } from "./Checkbox.tsx";

type Context = { args: CheckboxProps; canvasElement: HTMLElement };

const box = (canvasElement: HTMLElement) => within(canvasElement).getByRole("checkbox", { name: "Gift wrap" });

export const meta: ComponentMeta<CheckboxProps> = {
  args: { "aria-label": "Gift wrap", onCheckedChange: fn() },
  examples: { Checked: { defaultChecked: true } },
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const checkbox = box(canvasElement);
      await expect(checkbox.getAttribute("aria-checked")).toBe("false");
      await userEvent.click(checkbox);
      await expect(checkbox.getAttribute("aria-checked")).toBe("true");
      await userEvent.keyboard(" ");
      await expect(checkbox.getAttribute("aria-checked")).toBe("false");
      await expect(args.onCheckedChange).toHaveBeenNthCalledWith(1, true);
      await expect(args.onCheckedChange).toHaveBeenNthCalledWith(2, false);
    },
    Checked: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const checkbox = box(canvasElement);
      await expect(checkbox.getAttribute("aria-checked")).toBe("true");
      await userEvent.click(checkbox);
      await expect(args.onCheckedChange).toHaveBeenCalledWith(false);
    },
    Error: async ({ canvasElement }: Context) => {
      await expect(box(canvasElement).getAttribute("aria-invalid")).toBe("true");
    },
  },
};
