import { clearAllMocks, expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { FilterBarFocusProps } from "./FilterBar.tsx";

type Context = { args: FilterBarFocusProps; canvasElement: HTMLElement };

export const meta: ComponentMeta<FilterBarFocusProps> = {
  args: { label: "Maya + Jon", backShown: true },
  examples: { "First focus": { backShown: false } },
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await expect(canvas.getByText("Maya + Jon")).toBeTruthy();
      await userEvent.click(canvas.getByRole("button", { name: "Back" }));
      await expect(args.onBack).toHaveBeenCalledTimes(1);
      await userEvent.click(canvas.getByRole("button", { name: "Clear focus" }));
      await expect(args.onClear).toHaveBeenCalledTimes(1);
    },
    "First focus": async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await expect(canvas.queryByRole("button", { name: "Back" })).toBeNull();
      await userEvent.click(canvas.getByRole("button", { name: "Clear focus" }));
      await expect(args.onClear).toHaveBeenCalledTimes(1);
      await expect(args.onBack).not.toHaveBeenCalled();
    },
  },
};
