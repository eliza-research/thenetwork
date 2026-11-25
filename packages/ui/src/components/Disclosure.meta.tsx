import { clearAllMocks, expect, fn, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { DisclosureProps } from "./Disclosure.tsx";

type Context = { args: DisclosureProps; canvasElement: HTMLElement };

const summary = (canvasElement: HTMLElement) => within(canvasElement).getByRole("button", { name: "Shipping" });

export const meta: ComponentMeta<DisclosureProps> = {
  args: { summary: "Shipping", children: "Ships in two days.", onOpenChange: fn() },
  examples: { Open: { defaultOpen: true } },
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      const button = summary(canvasElement);
      await expect(button.getAttribute("aria-expanded")).toBe("false");
      await expect(canvas.queryByText("Ships in two days.")).toBeNull();
      await userEvent.click(button);
      await expect(button.getAttribute("aria-expanded")).toBe("true");
      await expect(canvas.getByText("Ships in two days.")).toBeTruthy();
      await expect(args.onOpenChange).toHaveBeenCalledWith(true);
      button.focus();
      await userEvent.keyboard("{Enter}");
      await expect(button.getAttribute("aria-expanded")).toBe("false");
      await expect(args.onOpenChange).toHaveBeenLastCalledWith(false);
    },
    Open: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const button = summary(canvasElement);
      await expect(button.getAttribute("aria-expanded")).toBe("true");
      await expect(within(canvasElement).getByText("Ships in two days.")).toBeTruthy();
      await userEvent.click(button);
      await expect(args.onOpenChange).toHaveBeenCalledWith(false);
    },
  },
};
