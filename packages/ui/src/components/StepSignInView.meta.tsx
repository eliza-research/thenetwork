import { clearAllMocks, expect, userEvent, within } from "storybook/test";
import { signInStart, type StepSignIn } from "../../../core/src/generated/oneStepPage.ts";
import type { ComponentMeta } from "../lib/meta.ts";
import type { StepSignInViewProps } from "./StepSignInView.tsx";

const signIn = (fields: Partial<StepSignIn>): StepSignIn => ({ ...signInStart, auth: "SignInOtp", ...fields });

export const meta: ComponentMeta<StepSignInViewProps> = {
  args: {
    signIn: signIn({}),
    siteKey: "",
    title: "Confirm your current number",
    lead: "To change your number, first confirm the number you use now.",
    phone: "",
    code: "",
    phoneShown: "(•••) •••-0123",
    retryMinutes: undefined,
    checkRound: 0,
  },
  examples: {
    "Mode pending": { signIn: signInStart },
    Number: { phone: "(212) 555-0123" },
    "Invalid phone": { signIn: signIn({ error: "SignInInvalidPhone" }), phone: "555" },
    "Rate limited with time": { signIn: signIn({ error: "SignInRateLimited", retryKnown: true }), retryMinutes: 5 },
    "Rate limited": { signIn: signIn({ error: "SignInRateLimited" }) },
    Cloud: { signIn: signIn({ auth: "SignInCloud" }) },
    Code: { signIn: signIn({ stage: "SignInCode" }), code: "246810" },
    "Wrong code": { signIn: signIn({ stage: "SignInCode", error: "SignInWrongCode" }), code: "111111" },
    "New code sent": { signIn: signIn({ stage: "SignInCode", error: "SignInNewCodeSent" }) },
    "Left for Cloud": { signIn: signIn({ auth: "SignInCloud", stage: "SignInLeftForCloud" }) },
    "With note": { note: "No longer have that number? Email help@ntwrk.party." },
  },
  play: {
    "Mode pending": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const canvas = within(canvasElement);
      await expect(canvas.getByRole("status", { name: "Loading" })).toBeTruthy();
      await expect(canvas.queryByRole("textbox")).toBeNull();
    },
    Number: async ({ args, canvasElement }: { args: StepSignInViewProps; canvasElement: HTMLElement }) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await expect(canvas.getByRole("heading", { level: 1, name: "Confirm your current number" })).toBeTruthy();
      await userEvent.click(canvas.getByRole("button", { name: "Text me a code" }));
      await expect(args.onSubmitPhone).toHaveBeenCalled();
      await expect(args.onContinueWithPhone).not.toHaveBeenCalled();
    },
    "Invalid phone": ({ canvasElement }: { canvasElement: HTMLElement }) =>
      expect(within(canvasElement).getByRole("alert").textContent).toBe("Enter a 10-digit US mobile number."),
    "Rate limited with time": ({ canvasElement }: { canvasElement: HTMLElement }) =>
      expect(within(canvasElement).getByRole("alert").textContent).toBe("Too many tries. Try again in 5 minutes."),
    "Rate limited": ({ canvasElement }: { canvasElement: HTMLElement }) =>
      expect(within(canvasElement).getByRole("alert").textContent).toBe("Too many tries for now. Please wait an hour, then try again."),
    Cloud: async ({ args, canvasElement }: { args: StepSignInViewProps; canvasElement: HTMLElement }) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await expect(canvas.queryByRole("textbox")).toBeNull();
      await userEvent.click(canvas.getByRole("button", { name: "Continue with your phone" }));
      await expect(args.onContinueWithPhone).toHaveBeenCalled();
      await expect(args.onSubmitPhone).not.toHaveBeenCalled();
    },
    Code: async ({ args, canvasElement }: { args: StepSignInViewProps; canvasElement: HTMLElement }) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await expect(canvas.getByText("(•••) •••-0123")).toBeTruthy();
      await userEvent.click(canvas.getByRole("button", { name: "Continue" }));
      await expect(args.onSubmitCode).toHaveBeenCalled();
    },
    "Wrong code": ({ canvasElement }: { canvasElement: HTMLElement }) =>
      expect(within(canvasElement).getByRole("alert").textContent).toBe("That code is not right, or it has expired. Check the text and try again."),
    "New code sent": ({ canvasElement }: { canvasElement: HTMLElement }) =>
      expect(within(canvasElement).getByText("We sent a new code.")).toBeTruthy(),
    "Left for Cloud": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const canvas = within(canvasElement);
      await expect(canvas.getByRole("status", { name: "Loading" })).toBeTruthy();
      await expect(canvas.queryByRole("button")).toBeNull();
    },
    "With note": ({ canvasElement }: { canvasElement: HTMLElement }) =>
      expect(within(canvasElement).getByText("No longer have that number? Email help@ntwrk.party.")).toBeTruthy(),
  },
};
