import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { AuthCodeViewProps } from "./AuthCodeView.tsx";

const formOf = (canvasElement: HTMLElement, name: string) => within(canvasElement).getByRole("button", { name }).closest("form");

export const meta: ComponentMeta<AuthCodeViewProps> = {
  args: { app: "Friends", rid: "r_0123456789abcdefghijk", last4: "0100" },
  examples: {
    "Code resent": { fieldError: "CodeResent" },
    "Resend rate limited": { fieldError: "CodeResendRateLimited" },
    "Resend failed": { fieldError: "CodeResendFailed" },
  },
  play: {
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const page = within(canvasElement);
      const field = page.getByRole("textbox", { name: "Code" });
      await expect(field.getAttribute("name")).toBe("code");
      await expect(field.getAttribute("autocomplete")).toBe("one-time-code");
      await expect(field.getAttribute("aria-invalid")).toBeNull();
      await expect(formOf(canvasElement, "Continue")?.getAttribute("action")).toBe("/oauth/authorize/code");
      await expect(formOf(canvasElement, "Resend code")?.getAttribute("action")).toBe("/oauth/authorize/resend");
      await expect(formOf(canvasElement, "Use a different number")?.getAttribute("action")).toBe("/oauth/authorize/change-phone");
      await expect(formOf(canvasElement, "Cancel")?.getAttribute("action")).toBe("/oauth/authorize/cancel");
      await expect(page.getByRole("button", { name: "Cancel" }).getAttribute("value")).toBe("deny");
      await expect(canvasElement.querySelectorAll('input[name="rid"]')).toHaveLength(4);
      await expect(page.queryByRole("status")).toBeNull();
    },
    FieldErrorCodeNotAccepted: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const page = within(canvasElement);
      await expect(page.getByRole("textbox", { name: "Code" }).getAttribute("aria-invalid")).toBe("true");
      await expect(page.getByText("That code did not work. Check the newest text and try again.")).toBeTruthy();
      await expect(page.queryByRole("status")).toBeNull();
    },
    "Code resent": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const page = within(canvasElement);
      await expect(page.getByRole("textbox", { name: "Code" }).getAttribute("aria-invalid")).toBeNull();
      await expect(page.getByRole("status").textContent).toBe("We sent a new code.");
    },
    "Resend rate limited": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const page = within(canvasElement);
      await expect(page.getByRole("textbox", { name: "Code" }).getAttribute("aria-invalid")).toBe("true");
      await expect(page.getByText("Too many codes right now. Wait a few minutes and try again.")).toBeTruthy();
      await expect(page.queryByRole("status")).toBeNull();
    },
    "Resend failed": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const page = within(canvasElement);
      await expect(page.getByRole("textbox", { name: "Code" }).getAttribute("aria-invalid")).toBe("true");
      await expect(page.getByText("We could not send a new code right now. Try again in a moment.")).toBeTruthy();
      await expect(page.queryByRole("status")).toBeNull();
    },
  },
};
