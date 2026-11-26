import { clearAllMocks, expect, fireEvent, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { ProfileStepProps } from "./ProfileStep.tsx";

const consentText =
  "I agree to receive recurring text messages from peon.biz at this number: questions about work or hiring, waitlist updates, introductions I agree to, and scheduling reminders. Message frequency varies. Message and data rates may apply. Reply STOP to stop and HELP for help. Consent is not a condition of any purchase.";

export const meta: ComponentMeta<ProfileStepProps> = {
  args: { values: { firstName: "", birthdate: "", consent: false }, minJoinAge: 13, consentText },
  examples: {
    Prefilled: { values: { firstName: "Ana", birthdate: "", consent: false } },
    "Birthday refused": { values: { firstName: "Ana", birthdate: "", consent: true }, birthdateError: "Enter your birthday. It must be a real date, not after today." },
  },
  play: {
    Prefilled: async ({ args, canvasElement }: { args: ProfileStepProps; canvasElement: HTMLElement }) => {
      const canvas = within(canvasElement);
      await expect(canvas.getByRole<HTMLInputElement>("textbox", { name: "First name" }).value).toBe("Ana");
      const birthday = canvas.getByLabelText<HTMLInputElement>("Birthday");
      await expect(birthday.getAttribute("type")).toBe("date");
      await expect(birthday.getAttribute("name")).toBe("birthdate");
      await expect(birthday.value).toBe("");
      await expect(canvasElement.querySelector("input[name=age]")).toBeNull();
      await fireEvent.change(birthday, { target: { value: "1996-03-14" } });
      await expect(args.onValuesChange).toHaveBeenCalledWith({ birthdate: "1996-03-14" });
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
    "Birthday refused": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const birthday = within(canvasElement).getByLabelText<HTMLInputElement>("Birthday");
      await expect(birthday.value).toBe("");
      await expect(birthday.getAttribute("aria-invalid")).toBe("true");
      const errorId = birthday.getAttribute("aria-describedby")?.split(" ").find((id) => id.endsWith("-error"));
      await expect(errorId && canvasElement.querySelector(`[id="${errorId}"]`)?.textContent).toBe("Enter your birthday. It must be a real date, not after today.");
    },
    Error: ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const form = canvasElement.querySelector("form");
      const error = within(canvasElement).getByRole("alert");
      return expect(form?.getAttribute("aria-describedby")).toBe(error.id);
    },
  },
};
