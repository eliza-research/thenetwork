import { expect, within } from "storybook/test";
import type { AuthSignupViewProps } from "./AuthSignupView.tsx";
import type { ComponentMeta } from "../lib/meta.ts";

export const meta: ComponentMeta<AuthSignupViewProps> = {
  args: {
    app: "Friends",
    rid: "r_0123456789abcdefghijk",
    consent: { text: "I agree to receive recurring text messages from friends.help. Reply STOP to stop and HELP for help.", version: "example" },
    requiresInvitation: false,
    signupView: "example-signup-view",
  },
  examples: {
    "Invitation required": { app: "Ntwrk", requiresInvitation: true },
    "Signup error": { error: "Check your details and try again." },
    "Birthday refused": { birthdateError: "Enter your birthday. It must be a real date, not after today.", prefill: { firstName: "Ari", homeCity: "sf" } },
    "Prefilled from the agent": { prefill: { firstName: "Ari", homeCity: "sf" } },
    "Rendered by ntwrk.party": { siteOrigin: "https://friends.help" },
    "Refused with a draft": { error: "Check your details and try again.", prefill: { firstName: "Ari", homeCity: "nyc" } },
  },
  play: {
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const page = within(canvasElement);
      const sms = page.getByRole("checkbox");
      await expect(sms.tagName).toBe("INPUT");
      await expect(sms.getAttribute("name")).toBe("smsConsent");
      await expect(sms.getAttribute("value")).toBe("yes");
      await expect((sms as HTMLInputElement).required).toBe(true);
      await expect((sms as HTMLInputElement).checked).toBe(false);
      await expect(canvasElement.querySelector("input[name=phone], input[name=code]")).toBeNull();
      await expect((canvasElement.querySelector("input[name=invitation]") as HTMLInputElement).required).toBe(false);
      await expect(canvasElement.querySelector("input[name=consentVersion]")?.getAttribute("value")).toBe("example");
      const birthday = page.getByLabelText<HTMLInputElement>("Birthday");
      await expect(birthday.getAttribute("name")).toBe("birthdate");
      await expect(birthday.type).toBe("date");
      await expect(birthday.required).toBe(true);
      await expect(birthday.value).toBe("");
      await expect(canvasElement.querySelector("input[name=age]")).toBeNull();
      await expect(page.getByText(/never match you for dates or for work/)).toBeTruthy();
      await expect(page.getByText(/friends\.help and the ntwrk Friend lane/)).toBeTruthy();
      await expect(page.getByText(/within 2 years/)).toBeTruthy();
      await expect(page.queryByText(/will introduce|we introduce you/i)).toBeNull();
      const hrefs = [...canvasElement.querySelectorAll("a")].map(a => a.getAttribute("href"));
      await expect(hrefs).toEqual(["/", "/terms#sms", "/terms", "/privacy", "/privacy", "/terms"]);
      const buttons = page.getAllByRole("button").map(button => button.textContent);
      await expect(buttons).toEqual(["Finish signup", "Back to connection"]);
      await expect(page.queryByText("Check the details from your agent, add your birthday and finish.")).toBeNull();
    },
    "Refused with a draft": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const page = within(canvasElement);
      await expect(page.queryByText("Check the details from your agent, add your birthday and finish.")).toBeNull();
      await expect(canvasElement.querySelector("#signup-error")?.textContent).toBe("Check your details and try again.");
      await expect((canvasElement.querySelector("input[name=firstName]") as HTMLInputElement).value).toBe("Ari");
      await expect(page.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
      await expect(page.getByRole("button", { name: "Back to connection" }).getAttribute("value")).toBe("skip");
    },
    "Rendered by ntwrk.party": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const hrefs = [...canvasElement.querySelectorAll("a")].map(a => a.getAttribute("href"));
      await expect(hrefs).toEqual(["https://friends.help/", "https://friends.help/terms#sms", "https://friends.help/terms", "https://friends.help/privacy", "https://friends.help/privacy", "https://friends.help/terms"]);
    },
    "Prefilled from the agent": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const page = within(canvasElement);
      const name = canvasElement.querySelector("input[name=firstName]") as HTMLInputElement;
      await expect(name.value).toBe("Ari");
      await expect(name.readOnly).toBe(false);
      await expect((canvasElement.querySelector("select[name=homeCity]") as HTMLSelectElement).value).toBe("sf");
      await expect((canvasElement.querySelector("input[name=birthdate]") as HTMLInputElement).value).toBe("");
      await expect(page.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
      await expect(page.getByText("Check the details from your agent, add your birthday and finish.")).toBeTruthy();
      await expect(page.getByRole("button", { name: "Finish signup" })).toBeTruthy();
      await expect(canvasElement.querySelector("input[name=phone], input[name=code]")).toBeNull();
    },
    "Birthday refused": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const page = within(canvasElement);
      const birthday = page.getByLabelText<HTMLInputElement>("Birthday");
      await expect(birthday.value).toBe("");
      await expect(birthday.getAttribute("aria-invalid")).toBe("true");
      await expect(birthday.getAttribute("aria-describedby")).toContain("signup-birthdate-error");
      await expect(canvasElement.querySelector("#signup-birthdate-error")?.textContent).toBe("Enter your birthday. It must be a real date, not after today.");
      await expect(page.queryByText("Check the details from your agent, add your birthday and finish.")).toBeNull();
      await expect((canvasElement.querySelector("input[name=firstName]") as HTMLInputElement).value).toBe("Ari");
    },
    "Invitation required": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      await expect((canvasElement.querySelector("input[name=invitation]") as HTMLInputElement).required).toBe(true);
      await expect(within(canvasElement).getByText("Invitation link")).toBeTruthy();
    },
  },
};
