import { expect, within } from "storybook/test";
import { initial, type JoinPage } from "../../../core/src/generated/browserJoin.ts";
import type { ComponentMeta } from "../lib/meta.ts";
import type { JoinViewProps } from "./JoinView.tsx";

const consentText =
  "I agree to receive recurring text messages from peon.biz at this number: questions about work or hiring, waitlist updates, introductions I agree to, and scheduling reminders. Message frequency varies. Message and data rates may apply. Reply STOP to stop and HELP for help. Consent is not a condition of any purchase.";

const page = (fields: Partial<JoinPage>): JoinPage => ({ ...initial, addressClean: true, auth: "OtpMode", ...fields });

export const meta: ComponentMeta<JoinViewProps> = {
  args: {
    page: page({ screen: "Phone" }),
    values: { firstName: "", birthdate: "", consent: false },
    phone: "",
    code: "",
    phoneShown: "(•••) •••-0123",
    firstName: "Ana",
    minJoinAge: 13,
    failure: undefined,
    checkRound: 0,
    siteKey: "",
    consentText,
    homeLabel: "Back to peon.biz",
    blockedMessages: {
      UnderAge: "You must be 13 or older to join peon.biz. We did not save your details.",
      InviteOnly: "peon.biz is not open to new members right now. Please try again later.",
    },
  },
  examples: {
    Loading: { page: page({ screen: "Loading", auth: "AuthPending" }) },
    "Invalid phone": { page: page({ screen: "Phone", formError: "InvalidPhone" }), phone: "555" },
    "Session ended": { page: page({ screen: "Phone", notice: "SessionEnded" }) },
    Cloud: { page: page({ screen: "Phone", auth: "CloudMode" }) },
    Code: { page: page({ screen: "Code" }) },
    "New code sent": { page: page({ screen: "Code", formError: "NewCodeSent" }) },
    Profile: { page: page({ screen: "Profile", account: 1, formHasValues: true, birthdayGiven: true }), values: { firstName: "Ana", birthdate: "1996-03-14", consent: false } },
    "Birthday refused": { page: page({ screen: "Profile", account: 1, formHasValues: true, consented: true, formError: "InvalidBirthdate" }), values: { firstName: "Ana", birthdate: "", consent: true } },
    "Request failed": { page: page({ screen: "Profile", account: 1, formError: "RequestFailed" }), failure: "server" },
    Member: { page: page({ screen: "Member", account: 1 }) },
    Blocked: { page: page({ screen: "Blocked", account: 1, reason: "InviteOnly" }) },
    "Done from agent": { page: page({ screen: "Done", account: 1, consented: true, viaAgent: true }) },
  },
  play: {
    "Birthday refused": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const birthday = within(canvasElement).getByLabelText<HTMLInputElement>("Birthday");
      await expect(birthday.value).toBe("");
      await expect(birthday.getAttribute("aria-invalid")).toBe("true");
      await expect(within(canvasElement).getByText("Enter your birthday. It must be a real date, not after today.")).toBeTruthy();
      await expect(canvasElement.querySelector("form [role=alert]")).toBeNull();
    },
    "Invalid phone": ({ canvasElement }: { canvasElement: HTMLElement }) => expect(within(canvasElement).getByRole("alert").textContent).toBe("Enter a 10-digit US mobile number."),
    Blocked: ({ canvasElement }: { canvasElement: HTMLElement }) => expect(within(canvasElement).getByText("peon.biz is not open to new members right now. Please try again later.")).toBeTruthy(),
    "Done from agent": ({ canvasElement }: { canvasElement: HTMLElement }) => expect(within(canvasElement).getByText("Go back to the same chat to finish setting up your profile.")).toBeTruthy(),
  },
};
