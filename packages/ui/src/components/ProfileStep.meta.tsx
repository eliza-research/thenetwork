import { clearAllMocks, expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { ProfileStepProps } from "./ProfileStep.tsx";

const consentText =
  "I agree to receive recurring text messages from peon.biz at this number: questions about work or hiring, waitlist updates, introductions I agree to, and scheduling reminders. Message frequency varies. Message and data rates may apply. Reply STOP to stop and HELP for help. Consent is not a condition of any purchase.";

export const meta: ComponentMeta<ProfileStepProps> = {
  args: { values: { firstName: "", age: "", consent: false }, minJoinAge: 13, consentText },
  examples: { Prefilled: { values: { firstName: "Ana", age: "30", consent: false } } },
  play: {
    Prefilled: async ({ args, canvasElement }: { args: ProfileStepProps; canvasElement: HTMLElement }) => {
      const canvas = within(canvasElement);
      await expect(canvas.getByRole<HTMLInputElement>("textbox", { name: "First name" }).value).toBe("Ana");
      await userEvent.click(canvas.getByRole("checkbox"));
      await expect(args.onValuesChange).toHaveBeenCalledWith({ consent: true });
      await userEvent.click(canvas.getByRole("button", { name: "Join" }));
      await expect(args.onSubmitProfile).toHaveBeenCalled();
    },
    Loading: async ({ args, canvasElement }: { args: ProfileStepProps; canvasElement: HTMLElement }) => {
      clearAllMocks();
      const consent = within(canvasElement).getByRole("checkbox");
      await userEvent.click(consent);
      await userEvent.keyboard(" ");
      await expect(args.onValuesChange).not.toHaveBeenCalled();
      await expect(consent.getAttribute("aria-disabled")).toBe("true");
      await expect(document.activeElement).toBe(consent);
    },
    Error: ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const form = canvasElement.querySelector("form");
      const error = within(canvasElement).getByRole("alert");
      return expect(form?.getAttribute("aria-describedby")).toBe(error.id);
    },
  },
};
