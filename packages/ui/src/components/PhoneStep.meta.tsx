import { clearAllMocks, expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { PhoneStepProps } from "./PhoneStep.tsx";

export const meta: ComponentMeta<PhoneStepProps> = {
  args: { numberForm: true, phone: "" },
  examples: {
    Typed: { phone: "(212) 555-0123" },
    Cloud: { numberForm: false, cloudButton: true },
    Waiting: { numberForm: false, formWaiting: true },
    "Cloud opening": { numberForm: false, cloudButton: true, loading: true },
    "With check": { check: <p>Security check</p> },
    "Cloud with check": { numberForm: false, cloudButton: true, check: <p>Security check</p> },
  },
  play: {
    Typed: async ({ args, canvasElement }: { args: PhoneStepProps; canvasElement: HTMLElement }) => {
      clearAllMocks();
      await userEvent.click(within(canvasElement).getByRole("button", { name: "Text me a code" }));
      await expect(args.onSubmitPhone).toHaveBeenCalled();
      await expect(args.onContinueWithPhone).not.toHaveBeenCalled();
    },
    Cloud: async ({ args, canvasElement }: { args: PhoneStepProps; canvasElement: HTMLElement }) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await expect(canvas.queryByRole("textbox")).toBeNull();
      await userEvent.click(canvas.getByRole("button", { name: "Continue with your phone" }));
      await expect(args.onContinueWithPhone).toHaveBeenCalled();
      await expect(args.onSubmitPhone).not.toHaveBeenCalled();
    },
    Loading: async ({ args, canvasElement }: { args: PhoneStepProps; canvasElement: HTMLElement }) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      canvas.getByRole("textbox", { name: "Mobile number" }).focus();
      await userEvent.keyboard("{Enter}");
      const button = canvas.getByRole("button", { name: "Sending…" });
      button.focus();
      await userEvent.keyboard("{Enter} ");
      await expect(args.onSubmitPhone).not.toHaveBeenCalled();
      await expect(button.getAttribute("aria-disabled")).toBe("true");
      await expect(document.activeElement).toBe(button);
    },
    "Cloud opening": async ({ args, canvasElement }: { args: PhoneStepProps; canvasElement: HTMLElement }) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await expect(canvas.queryByRole("textbox")).toBeNull();
      const button = canvas.getByRole("button", { name: "Opening…" });
      button.focus();
      await userEvent.keyboard("{Enter} ");
      await expect(args.onContinueWithPhone).not.toHaveBeenCalled();
      await expect(args.onSubmitPhone).not.toHaveBeenCalled();
    },
    "With check": async ({ args, canvasElement }: { args: PhoneStepProps; canvasElement: HTMLElement }) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await expect(canvas.getByText("Security check")).toBeTruthy();
      await expect(canvas.getByRole("textbox", { name: "Mobile number" })).toBeTruthy();
      await userEvent.click(canvas.getByRole("button", { name: "Text me a code" }));
      await expect(args.onSubmitPhone).toHaveBeenCalledTimes(1);
    },
    "Cloud with check": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const canvas = within(canvasElement);
      await expect(canvas.queryByText("Security check")).toBeNull();
      await expect(canvas.queryByRole("textbox")).toBeNull();
      await expect(canvas.getByRole("button", { name: "Continue with your phone" })).toBeTruthy();
    },
    Waiting: ({ canvasElement }: { canvasElement: HTMLElement }) => expect(within(canvasElement).getByRole("button", { name: "Loading sign-in…" }).hasAttribute("disabled")).toBe(true),
  },
};
