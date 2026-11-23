import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { OneStepPageProps } from "./OneStepPage.tsx";
import { StepFrame } from "./StepFrame.tsx";

const stepBody = (
  <StepFrame title="Your new number">
    <p className="text-foreground">We text a code to the new number.</p>
  </StepFrame>
);

export const meta: ComponentMeta<OneStepPageProps> = {
  args: { stepKey: "PhoneNewNumber", notice: "NoStepNotice", children: stepBody },
  examples: {
    Waiting: { stepKey: "PhoneLoading", waiting: true },
    Unreachable: { notice: "StepUnreachable" },
    "Session ended": { stepKey: "PhoneSignIn", notice: "StepSessionEnded" },
    "Sign in again": { stepKey: "PhoneSignIn", notice: "StepSignInAgain" },
    "Cloud sign-in expired": { stepKey: "PhoneSignIn", notice: "StepSignInExpired" },
    "Cloud sign-in refused": { stepKey: "PhoneSignIn", notice: "StepSignInRefused" },
    "Cloud sign-in unavailable": { stepKey: "PhoneSignIn", notice: "StepSignInUnavailable" },
    Step: {},
  },
  play: {
    Waiting: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const canvas = within(canvasElement);
      await expect(canvas.getByRole("status", { name: "Loading" })).toBeTruthy();
      await expect(canvas.queryByRole("heading", { level: 1 })).toBeNull();
    },
    Unreachable: ({ canvasElement }: { canvasElement: HTMLElement }) =>
      expect(within(canvasElement).getByRole("alert").textContent).toBe("We can't reach our server right now. Nothing was sent. Please try again in a minute."),
    "Session ended": ({ canvasElement }: { canvasElement: HTMLElement }) =>
      expect(within(canvasElement).getByRole("alert").textContent).toBe("Your session ended. Please log in again."),
    "Sign in again": ({ canvasElement }: { canvasElement: HTMLElement }) =>
      expect(within(canvasElement).getByRole("alert").textContent).toBe("For your safety, sign in again with your current number."),
    "Cloud sign-in expired": ({ canvasElement }: { canvasElement: HTMLElement }) =>
      expect(within(canvasElement).getByRole("alert").textContent).toBe("Your sign-in took too long. Sign in again."),
    "Cloud sign-in refused": ({ canvasElement }: { canvasElement: HTMLElement }) =>
      expect(within(canvasElement).getByRole("alert").textContent).toBe("We could not sign you in. For help, email help@ntwrk.party."),
    "Cloud sign-in unavailable": ({ canvasElement }: { canvasElement: HTMLElement }) =>
      expect(within(canvasElement).getByRole("alert").textContent).toBe("Sign-in is not available right now. Try again in a few minutes."),
    Step: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const canvas = within(canvasElement);
      await expect(canvas.queryByRole("alert")).toBeNull();
      await expect(canvas.getByRole("heading", { level: 1, name: "Your new number" })).toBeTruthy();
    },
  },
};
