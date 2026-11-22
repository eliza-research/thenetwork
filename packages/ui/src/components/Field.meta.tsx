import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { FieldProps } from "./Field.tsx";
import { Input } from "./Input.tsx";

export const meta: ComponentMeta<FieldProps> = {
  args: { label: "Email", children: <Input type="email" /> },
  examples: { Described: { description: "We send the receipt here." } },
  play: {
    Default: ({ canvasElement }: { canvasElement: HTMLElement }) => expect(within(canvasElement).getByRole("textbox", { name: "Email" }).hasAttribute("aria-invalid")).toBe(false),
    Described: ({ canvasElement }: { canvasElement: HTMLElement }) => expect(within(canvasElement).getByRole("textbox", { name: "Email", description: "We send the receipt here." })).toBeTruthy(),
    Error: ({ canvasElement }: { canvasElement: HTMLElement }) =>
      expect(within(canvasElement).getByRole("textbox", { name: "Email", description: "Something went wrong" }).getAttribute("aria-invalid")).toBe("true"),
  },
};
