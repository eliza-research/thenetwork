import { expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import { type RadioGroupProps, RadioGroupItem } from "./RadioGroup.tsx";

export const meta: ComponentMeta<RadioGroupProps> = {
  args: {
    "aria-label": "Delivery",
    defaultValue: "standard",
    children: (
      <>
        <RadioGroupItem value="standard">Standard</RadioGroupItem>
        <RadioGroupItem value="express">Express</RadioGroupItem>
      </>
    ),
  },
  examples: { Empty: { defaultValue: undefined, children: <RadioGroupItem value="pickup">Pickup</RadioGroupItem> } },
  play: {
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const canvas = within(canvasElement);
      await userEvent.click(canvas.getByText("Express"));
      await expect(canvas.getByRole("radio", { name: "Express" }).getAttribute("aria-checked")).toBe("true");
    },
  },
};
