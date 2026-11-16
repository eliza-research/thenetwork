import { clearAllMocks, expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { CodeStepProps } from "./CodeStep.tsx";

export const meta: ComponentMeta<CodeStepProps> = {
  args: { phoneShown: "(•••) •••-0123", code: "" },
  examples: { Typed: { code: "246810" } },
  play: {
    Typed: async ({ args, canvasElement }: { args: CodeStepProps; canvasElement: HTMLElement }) => {
      const canvas = within(canvasElement);
      await expect(canvas.getByRole("textbox", { name: "Code" }).getAttribute("autocomplete")).toBe("one-time-code");
      await userEvent.click(canvas.getByRole("button", { name: "Continue" }));
      await expect(args.onSubmitCode).toHaveBeenCalled();
      await userEvent.click(canvas.getByRole("button", { name: "Resend code" }));
      await expect(args.onResend).toHaveBeenCalled();
      await userEvent.click(canvas.getByRole("button", { name: "Change number" }));
      await expect(args.onChangeNumber).toHaveBeenCalled();
    },
    Loading: async ({ args, canvasElement }: { args: CodeStepProps; canvasElement: HTMLElement }) => {
      clearAllMocks();
      const resend = within(canvasElement).getByRole("button", { name: "Resend code" });
      resend.focus();
      await userEvent.keyboard("{Enter} ");
      await expect(args.onResend).not.toHaveBeenCalled();
      await expect(args.onSubmitCode).not.toHaveBeenCalled();
      await expect(resend.getAttribute("aria-disabled")).toBe("true");
      await expect(document.activeElement).toBe(resend);
    },
  },
};
