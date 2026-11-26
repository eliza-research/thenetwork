import { expect, within } from "storybook/test";
import { type HomeHelpPage, initial } from "../../../core/src/generated/homeHelpPage.ts";
import { signInStart } from "../../../core/src/generated/oneStepPage.ts";
import type { ComponentMeta } from "../lib/meta.ts";
import type { HomeHelpPageViewProps } from "./HomeHelpPageView.tsx";

const page = (fields: Partial<HomeHelpPage>): HomeHelpPage => ({ ...initial, screen: "HelpChoose", ...fields });
const signedIn = { ...signInStart, auth: "SignInOtp" as const, stage: "SignInVerified" as const };
const address = "15 Fictional Street Apt 2, Brooklyn NY 11222";

type Context = { canvasElement: HTMLElement };
const view = ({ canvasElement }: Context) => within(canvasElement);
const heading = (context: Context, name: string) => expect(view(context).getByRole("heading", { level: 1, name })).toBeTruthy();

export const meta: ComponentMeta<HomeHelpPageViewProps> = {
  args: {
    page: page({ signIn: signedIn }),
    address: "",
    revealedAddress: "",
    siteKey: "",
    phone: "",
    code: "",
    phoneShown: "(•••) •••-0123",
    retryMinutes: undefined,
    checkRound: 0,
  },
  examples: {
    Loading: { page: page({ screen: "HelpLoading" }) },
    "Bad link": { page: page({ screen: "HelpBadLink" }) },
    "Sign in": { page: page({ screen: "HelpSignIn", signIn: { ...signInStart, auth: "SignInOtp" } }) },
    "Session ended": { page: page({ screen: "HelpSignIn", signIn: { ...signInStart, auth: "SignInOtp" }, notice: "StepSessionEnded" }) },
    Choose: { page: page({ signIn: signedIn }) },
    "Choose as requester": { page: page({ signIn: signedIn, role: "HelpRoleRequester" }) },
    "Choose as helper": { page: page({ signIn: signedIn, role: "HelpRoleHelper" }) },
    Address: { page: page({ screen: "HelpAddress", signIn: signedIn }), address },
    "Address too long": { page: page({ screen: "HelpAddress", signIn: signedIn, error: "HelpAddressTooLong" }), address: "A".repeat(300) },
    "Address empty": { page: page({ screen: "HelpAddress", signIn: signedIn, error: "HelpAddressEmpty" }) },
    "Address bad characters": { page: page({ screen: "HelpAddress", signIn: signedIn, error: "HelpAddressBadChars" }), address: "15 Fictional Street\nApt 2" },
  },
  play: {
    Loading: (context: Context) => expect(view(context).queryByRole("heading", { level: 1 })).toBeNull(),
    "Bad link": async (context: Context) => {
      await heading(context, "This link does not work");
      await expect(view(context).getByText("Text HOME HELP ADDRESS again for a new link.")).toBeTruthy();
      await expect(view(context).queryByRole("button")).toBeNull();
    },
    "Sign in": (context: Context) => heading(context, "Confirm your number"),
    "Session ended": async (context: Context) => {
      await heading(context, "Confirm your number");
      await expect(view(context).getByRole("alert")).toBeTruthy();
    },
    Choose: async (context: Context) => {
      await heading(context, "Home-help address");
      for (const name of ["Add my address", "Show the address", "Remove my address"]) await expect(view(context).getByRole("button", { name })).toBeTruthy();
    },
    "Choose as requester": async (context: Context) => {
      await expect(view(context).getByRole("button", { name: "Add my address" })).toBeTruthy();
      await expect(view(context).getByRole("button", { name: "Remove my address" })).toBeTruthy();
      await expect(view(context).queryByRole("button", { name: "Show the address" })).toBeNull();
    },
    "Choose as helper": async (context: Context) => {
      await expect(view(context).getByRole("button", { name: "Show the address" })).toBeTruthy();
      await expect(view(context).queryByRole("button", { name: "Add my address" })).toBeNull();
      await expect(view(context).queryByRole("button", { name: "Remove my address" })).toBeNull();
    },
    Address: async (context: Context) => {
      await heading(context, "Your address");
      await expect(view(context).getByRole("textbox", { name: "Address" }).getAttribute("maxlength")).toBe("300");
    },
    "Address too long": async (context: Context) => {
      await expect(view(context).getByText("This address is too long. Use 300 characters or fewer.")).toBeTruthy();
      await expect(view(context).getByRole("textbox", { name: "Address" }).getAttribute("aria-invalid")).toBe("true");
    },
    "Address empty": (context: Context) => expect(view(context).getByText("Enter your address.")).toBeTruthy(),
    "Address bad characters": (context: Context) => expect(view(context).getByText("Write the address on one line, with no special characters.")).toBeTruthy(),
  },
};

export const moreExamples: Readonly<Record<string, Partial<HomeHelpPageViewProps>>> = {
  Saving: { page: page({ screen: "HelpAddress", signIn: signedIn, pending: "HelpSubmitting" }), address },
  Saved: { page: page({ screen: "HelpSaved", signIn: signedIn }) },
  "Saved from the status": { page: page({ screen: "HelpSaved", signIn: signedIn, role: "HelpRoleRequester" }) },
  "Address from the status": { page: page({ screen: "HelpAddress", signIn: signedIn, role: "HelpRoleRequester" }) },
  "Cloud sign-in expired": { page: page({ screen: "HelpSignIn", signIn: { ...signInStart, auth: "SignInCloud" }, notice: "StepSignInExpired" }) },
  Revealed: { page: page({ screen: "HelpRevealed", signIn: signedIn, addressHeld: true }), revealedAddress: address },
  Removed: { page: page({ screen: "HelpRemoved", signIn: signedIn }) },
  Closed: { page: page({ screen: "HelpClosed", signIn: signedIn }) },
  Unavailable: { page: page({ screen: "HelpUnavailable", signIn: signedIn }) },
  "Try later": { page: page({ signIn: signedIn, error: "HelpTryLater" }) },
  "Request failed": { page: page({ screen: "HelpSaved", signIn: signedIn, error: "HelpRequestFailed" }) },
  Unreachable: { page: page({ signIn: signedIn, notice: "StepUnreachable" }) },
};

export const morePlay = {
  Saving: (context: Context) => expect(view(context).getByRole("button", { name: "Saving…" }).getAttribute("aria-busy")).toBe("true"),
  "Saved from the status": async (context: Context) => {
    await heading(context, "Your address is saved");
    await expect(view(context).getByRole("button", { name: "Remove my address" })).toBeTruthy();
    await expect(view(context).queryByRole("button", { name: "Show the address" })).toBeNull();
  },
  "Address from the status": async (context: Context) => {
    await expect(view(context).queryByRole("button", { name: "Show the address" })).toBeNull();
    await expect(view(context).queryByText(/15 /)).toBeNull();
  },
  "Cloud sign-in expired": async (context: Context) => {
    await heading(context, "Confirm your number");
    await expect(view(context).getAllByRole("alert")[0].textContent).toBe("Your sign-in took too long. Sign in again.");
  },
  Saved: async (context: Context) => {
    await heading(context, "Your address is saved");
    await expect(view(context).getByRole("button", { name: "Remove my address" })).toBeTruthy();
  },
  Revealed: async (context: Context) => {
    await heading(context, "The address");
    await expect(view(context).getByText(address)).toBeTruthy();
  },
  Removed: async (context: Context) => {
    await heading(context, "Your address is removed");
    await expect(view(context).queryByRole("button")).toBeNull();
  },
  Closed: async (context: Context) => {
    await heading(context, "This step is closed");
    await expect(view(context).queryByRole("button")).toBeNull();
  },
  Unavailable: (context: Context) => heading(context, "Not available"),
  "Try later": (context: Context) => expect(view(context).getByRole("alert").textContent).toBe("Something went wrong on our side. Please try again in a minute."),
  "Request failed": (context: Context) => expect(view(context).getByRole("alert").textContent).toBe("Something went wrong. Nothing was changed. Please try again."),
  Unreachable: async (context: Context) => {
    await expect(view(context).getByRole("alert").textContent).toBe("We can't reach our server right now. Nothing was sent. Please try again in a minute.");
    await expect(view(context).queryByText(address)).toBeNull();
  },
};
