import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { AuthCodeViewProps } from "./AuthCodeView.tsx";

export const meta: ComponentMeta<AuthCodeViewProps> = {
  args: { app: "Friends", rid: "r_0123456789abcdefghijk", last4: "0100" },
  play: {
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const field = within(canvasElement).getByRole("textbox", { name: "Code" });
      await expect(field.getAttribute("name")).toBe("code");
      await expect(field.getAttribute("autocomplete")).toBe("one-time-code");
      await expect(within(canvasElement).getByRole("button", { name: "Continue" }).closest("form")?.getAttribute("action")).toBe("/oauth/authorize/code");
    },
    FieldErrorCodeNotAccepted: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      await expect(within(canvasElement).getByRole("textbox", { name: "Code" }).getAttribute("aria-invalid")).toBe("true");
    },
  },
};
