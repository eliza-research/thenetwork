import { clearAllMocks, expect, userEvent, within } from "storybook/test";
import { signInStart, type StepSignIn } from "../../../core/src/generated/oneStepPage.ts";
import { initial, type PhonePage } from "../../../core/src/generated/phonePage.ts";
import type { ComponentMeta } from "../lib/meta.ts";
import type { PhonePageViewProps } from "./PhonePageView.tsx";

const otp: StepSignIn = { ...signInStart, auth: "SignInOtp" };
const cloud: StepSignIn = { ...signInStart, auth: "SignInCloud" };

const page = (fields: Partial<PhonePage>): PhonePage => ({ ...initial, signIn: otp, ...fields });
const onCode = (fields: Partial<PhonePage>): PhonePage => page({ screen: "PhoneCode", changeStarted: true, ...fields });

export const meta: ComponentMeta<PhonePageViewProps> = {
  args: {
    page: page({ screen: "PhoneNewNumber" }),
    siteKey: "",
    newNumber: "",
    changeCode: "",
    newNumberShown: "(•••) •••-1234",
    phone: "",
    code: "",
    phoneShown: "(•••) •••-0123",
    retryMinutes: undefined,
    checkRound: 0,
  },
  examples: {
    Loading: { page: page({ screen: "PhoneLoading", signIn: signInStart }) },
    "Sign in": { page: page({ screen: "PhoneSignIn" }) },
    "Sign in again": { page: page({ screen: "PhoneSignIn", notice: "StepSignInAgain" }) },
    "New number": { newNumber: "(646) 555-1234" },
    "Mode pending": { page: page({ screen: "PhoneNewNumber", signIn: signInStart }) },
    "Same number": { page: page({ screen: "PhoneNewNumber", error: "PhoneSameNumber" }), newNumber: "(212) 555-0123" },
    "Invalid number": { page: page({ screen: "PhoneNewNumber", error: "PhoneInvalidNumber" }), newNumber: "555" },
    "Rate limited": { page: page({ screen: "PhoneNewNumber", error: "PhoneRateLimited" }) },
    Sending: { page: page({ screen: "PhoneNewNumber", pending: "PhoneStarting" }), newNumber: "(646) 555-1234" },
    Code: { page: onCode({}), changeCode: "246810" },
    "Wrong code": { page: onCode({ error: "PhoneWrongCode" }), changeCode: "111111" },
    "Code format": { page: onCode({ error: "PhoneCodeFormat" }), changeCode: "12" },
    "New code sent": { page: onCode({ error: "PhoneNewCodeSent" }) },
    "Start again": { page: page({ screen: "PhoneNewNumber", error: "PhoneStartAgain" }) },
    "Number in use": { page: page({ screen: "PhoneNewNumber", error: "PhoneNumberInUse" }) },
    Done: { page: page({ screen: "PhoneDone", moved: true }) },
    "Done on Cloud": { page: page({ screen: "PhoneDone", moved: true, doneSignedOut: true, signIn: cloud }) },
    Held: { page: page({ screen: "PhoneHeld" }) },
    Unreachable: { page: page({ screen: "PhoneNewNumber", notice: "StepUnreachable" }) },
  },
  play: {
    Loading: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const canvas = within(canvasElement);
      await expect(canvas.getByRole("status", { name: "Loading" })).toBeTruthy();
      await expect(canvas.queryByRole("heading", { level: 1 })).toBeNull();
    },
    "Sign in": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const canvas = within(canvasElement);
      await expect(canvas.getByRole("heading", { level: 1, name: "Confirm your current number" })).toBeTruthy();
      await expect(canvas.getByRole("link", { name: "help@ntwrk.party" }).getAttribute("href")).toBe("mailto:help@ntwrk.party");
    },
    "Sign in again": ({ canvasElement }: { canvasElement: HTMLElement }) =>
      expect(within(canvasElement).getByRole("alert").textContent).toBe("For your safety, sign in again with your current number."),
    "New number": async ({ args, canvasElement }: { args: PhonePageViewProps; canvasElement: HTMLElement }) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await expect(canvas.getByText("We text a code to the new number.")).toBeTruthy();
      await userEvent.click(canvas.getByRole("button", { name: "Send code" }));
      await expect(args.onSubmitNewNumber).toHaveBeenCalled();
    },
    "Mode pending": async ({ args, canvasElement }: { args: PhonePageViewProps; canvasElement: HTMLElement }) => {
      clearAllMocks();
      const button = within(canvasElement).getByRole("button", { name: "Loading…" });
      await expect(button.hasAttribute("disabled")).toBe(true);
      await expect(args.onSubmitNewNumber).not.toHaveBeenCalled();
    },
    "Same number": ({ canvasElement }: { canvasElement: HTMLElement }) =>
      expect(within(canvasElement).getByRole("alert").textContent).toBe("This is the number you use now. Enter your new number."),
    "Invalid number": ({ canvasElement }: { canvasElement: HTMLElement }) =>
      expect(within(canvasElement).getByRole("alert").textContent).toBe("Enter a 10-digit US mobile number."),
    "Rate limited": ({ canvasElement }: { canvasElement: HTMLElement }) =>
      expect(within(canvasElement).getByRole("alert").textContent).toBe("Too many tries. Try later."),
    Sending: async ({ args, canvasElement }: { args: PhonePageViewProps; canvasElement: HTMLElement }) => {
      clearAllMocks();
      const button = within(canvasElement).getByRole("button", { name: "Sending…" });
      button.focus();
      await userEvent.keyboard("{Enter} ");
      await expect(args.onSubmitNewNumber).not.toHaveBeenCalled();
      await expect(button.getAttribute("aria-disabled")).toBe("true");
    },
    Code: async ({ args, canvasElement }: { args: PhonePageViewProps; canvasElement: HTMLElement }) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await expect(canvas.getByText("(•••) •••-1234")).toBeTruthy();
      await expect(canvas.getByRole("textbox", { name: "Code" }).getAttribute("maxlength")).toBe("10");
      await userEvent.click(canvas.getByRole("button", { name: "Change number" }));
      await expect(args.onSubmitChangeCode).toHaveBeenCalled();
      await userEvent.click(canvas.getByRole("button", { name: "Send a new code" }));
      await expect(args.onResendChangeCode).toHaveBeenCalled();
      await userEvent.click(canvas.getByRole("button", { name: "Use a different number" }));
      await expect(args.onChangeNewNumber).toHaveBeenCalled();
    },
    "Wrong code": ({ canvasElement }: { canvasElement: HTMLElement }) =>
      expect(within(canvasElement).getByRole("alert").textContent).toBe("That code is not right, or it has expired. Check the text and try again."),
    "Code format": ({ canvasElement }: { canvasElement: HTMLElement }) =>
      expect(within(canvasElement).getByRole("alert").textContent).toBe("Enter the code from the text we sent."),
    "New code sent": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const canvas = within(canvasElement);
      await expect(canvas.getByText("We sent a new code.")).toBeTruthy();
      await expect(canvas.queryByRole("alert")).toBeNull();
    },
    "Start again": ({ canvasElement }: { canvasElement: HTMLElement }) =>
      expect(within(canvasElement).getByRole("alert").textContent).toBe("That code has expired. Send a new code to start again."),
    "Number in use": ({ canvasElement }: { canvasElement: HTMLElement }) =>
      expect(within(canvasElement).getByRole("alert").textContent).toBe("You cannot use that number. Enter a different number."),
    Done: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const canvas = within(canvasElement);
      await expect(canvas.getByRole("heading", { level: 1, name: "Your number is changed" })).toBeTruthy();
      await expect(canvas.queryByText("Use your new number the next time you sign in.")).toBeNull();
    },
    "Done on Cloud": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const canvas = within(canvasElement);
      await expect(canvas.getByText("Use your new number the next time you sign in.")).toBeTruthy();
      await expect(canvas.queryByRole("button")).toBeNull();
      await expect(canvas.queryByRole("link", { name: /sign in/i })).toBeNull();
    },
    Held: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const canvas = within(canvasElement);
      await expect(canvas.getByRole("heading", { level: 1, name: "We need to check this number" })).toBeTruthy();
      await expect(canvas.getByRole("link", { name: "help@ntwrk.party" }).getAttribute("href")).toBe("mailto:help@ntwrk.party");
      await expect(canvas.queryByRole("textbox")).toBeNull();
    },
    Unreachable: ({ canvasElement }: { canvasElement: HTMLElement }) =>
      expect(within(canvasElement).getByRole("alert").textContent).toBe("We can't reach our server right now. Nothing was sent. Please try again in a minute."),
  },
};
