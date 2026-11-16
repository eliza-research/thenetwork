import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { FieldErrorProps } from "./FieldError.tsx";

export const meta: ComponentMeta<FieldErrorProps> = {
  args: { children: "Enter a 10-digit US mobile number." },
  play: {
    Default: ({ canvasElement }: { canvasElement: HTMLElement }) => expect(within(canvasElement).getByRole("alert").textContent).toBe("Enter a 10-digit US mobile number."),
    Empty: ({ canvasElement }: { canvasElement: HTMLElement }) => expect(within(canvasElement).queryByRole("alert")).toBeNull(),
  },
};
