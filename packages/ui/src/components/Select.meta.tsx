import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import { type SelectProps, SelectItem } from "./Select.tsx";

export const meta: ComponentMeta<SelectProps> = {
  args: {
    "aria-label": "Size",
    placeholder: "Choose a size",
    children: (
      <>
        <SelectItem value="small">Small</SelectItem>
        <SelectItem value="medium">Medium</SelectItem>
        <SelectItem value="large">Large</SelectItem>
      </>
    ),
  },
  examples: { Chosen: { defaultValue: "medium" } },
  play: {
    Chosen: ({ canvasElement }: { canvasElement: HTMLElement }) => expect(within(canvasElement).getByRole("combobox", { name: "Size" }).textContent).toBe("Medium"),
    Error: ({ canvasElement }: { canvasElement: HTMLElement }) => expect(within(canvasElement).getByRole("combobox", { name: "Size" }).getAttribute("aria-invalid")).toBe("true"),
  },
};
