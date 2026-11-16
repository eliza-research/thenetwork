import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { AuthPhoneViewProps } from "./AuthPhoneView.tsx";

const formOf = (canvasElement: HTMLElement, name: string) => within(canvasElement).getByRole("button", { name }).closest("form");

export const meta: ComponentMeta<AuthPhoneViewProps> = {
  args: { app: "Ntwrk", rid: "r_0123456789abcdefghijk" },
  examples: { "Security check": { turnstileSiteKey: "1x00000000000000000000AA" } },
  play: {
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const field = within(canvasElement).getByRole("textbox", { name: "Your phone number" });
      await expect(field.getAttribute("name")).toBe("phone");
      await expect(formOf(canvasElement, "Text me a code")?.getAttribute("action")).toBe("/oauth/authorize/phone");
      await expect(formOf(canvasElement, "Cancel")?.getAttribute("action")).toBe("/oauth/authorize/cancel");
      await expect(canvasElement.querySelectorAll('input[name="rid"]')).toHaveLength(2);
      await expect(canvasElement.querySelector(".cf-turnstile")).toBeNull();
    },
    "Security check": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      await expect(canvasElement.querySelector(".cf-turnstile")).not.toBeNull();
    },
    FieldErrorPhoneNotValid: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      await expect(within(canvasElement).getByRole("textbox", { name: "Your phone number" }).getAttribute("aria-invalid")).toBe("true");
    },
  },
};
