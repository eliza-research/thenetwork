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
    "Prefilled from the agent": { prefill: { firstName: "Ari", homeCity: "sf" } },
    "Rendered by ntwrk.party": { siteOrigin: "https://friends.help" },
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
      const hrefs = [...canvasElement.querySelectorAll("a")].map(a => a.getAttribute("href"));
      await expect(hrefs).toEqual(["/", "/terms#sms", "/terms", "/privacy", "/privacy", "/terms"]);
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
      await expect((canvasElement.querySelector("input[name=age]") as HTMLInputElement).value).toBe("");
      await expect(page.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
      await expect(page.getByText("Check the details from your agent, add your age and finish.")).toBeTruthy();
      await expect(page.getByRole("button", { name: "Finish signup" })).toBeTruthy();
      await expect(canvasElement.querySelector("input[name=phone], input[name=code]")).toBeNull();
    },
    "Invitation required": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      await expect((canvasElement.querySelector("input[name=invitation]") as HTMLInputElement).required).toBe(true);
      await expect(within(canvasElement).getByText("Invitation link")).toBeTruthy();
    },
  },
};
