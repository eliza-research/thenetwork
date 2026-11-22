import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { InputProps } from "./Input.tsx";

export const meta: ComponentMeta<InputProps> = {
  args: { "aria-label": "Email" },
  play: {
    Error: ({ canvasElement }: { canvasElement: HTMLElement }) => expect(within(canvasElement).getByRole("textbox", { name: "Email" }).getAttribute("aria-invalid")).toBe("true"),
  },
};
