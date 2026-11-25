import { clearAllMocks, expect, fn, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { DisclosureCardProps } from "./DisclosureCard.tsx";

type Context = { args: DisclosureCardProps; canvasElement: HTMLElement };

const body = "Both like early climbing sessions in Long Island City.";

const head = (canvasElement: HTMLElement) => within(canvasElement).getByRole("button", { name: "Maya + Jon" });

export const meta: ComponentMeta<DisclosureCardProps> = {
  args: { summary: "Maya + Jon", children: body, onOpenChange: fn() },
  examples: { Open: { defaultOpen: true } },
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      await expect(within(canvasElement).queryByText(body)).toBeNull();
      await userEvent.click(head(canvasElement));
      await expect(head(canvasElement).getAttribute("aria-expanded")).toBe("true");
      await expect(within(canvasElement).getByText(body)).toBeTruthy();
      await expect(args.onOpenChange).toHaveBeenCalledWith(true);
    },
    Open: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      await expect(within(canvasElement).getByText(body)).toBeTruthy();
      await userEvent.click(head(canvasElement));
      await expect(args.onOpenChange).toHaveBeenCalledWith(false);
    },
  },
};
