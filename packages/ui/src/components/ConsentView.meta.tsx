import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { ConsentViewProps } from "./ConsentView.tsx";

const submits = (canvasElement: HTMLElement) => [...canvasElement.querySelectorAll<HTMLButtonElement>("button[type=submit]")];

export const meta: ComponentMeta<ConsentViewProps> = {
  args: { app: "Peon", rid: "r_0123456789abcdefghijk", clientName: "Claude", redirectHost: "claude.ai", scopes: ["apps:read", "membership:read", "profile:write"] },
  examples: {
    Unnamed: { clientName: null },
    NewPerson: { app: "Friends", canSignup: true },
    SignupConfirmed: { app: "Friends", signupSaved: true, signupApproval: "example-approval" },
  },
  play: {
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const page = within(canvasElement);
      const allow = page.getByRole("button", { name: "Allow" });
      await expect(allow.getAttribute("value")).toBe("approve");
      await expect(page.getByRole("button", { name: "Don't allow" }).getAttribute("value")).toBe("deny");
      await expect(allow.closest("form")?.getAttribute("action")).toBe("/oauth/authorize/consent");
      await expect(page.getAllByRole("listitem")).toHaveLength(3);
      await expect(page.queryByRole("button", { name: "Finish signup" })).toBeNull();
      await expect(submits(canvasElement).map(b => b.textContent)).toEqual(["Allow", "Don't allow"]);
      await expect(allow.className).not.toBe(page.getByRole("button", { name: "Don't allow" }).className);
    },
    Unnamed: ({ canvasElement }: { canvasElement: HTMLElement }) => expect(within(canvasElement).getByText("An unnamed assistant")).toBeTruthy(),
    NewPerson: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const page = within(canvasElement);
      await expect(submits(canvasElement).map(b => b.textContent)).toEqual(["Finish signup", "Allow", "Don't allow"]);
      const finish = page.getByRole("button", { name: "Finish signup" });
      const allow = page.getByRole("button", { name: "Allow" });
      const deny = page.getByRole("button", { name: "Don't allow" });
      await expect(finish.getAttribute("value")).toBe("open");
      await expect(finish.closest("form")?.getAttribute("action")).toBe("/oauth/authorize/signup");
      await expect(allow.closest("form")?.getAttribute("action")).toBe("/oauth/authorize/consent");
      await expect(allow.className).toBe(deny.className);
      await expect(finish.className).not.toBe(allow.className);
    },
    SignupConfirmed: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const page = within(canvasElement);
      await expect(page.getByText("Signup confirmed.")).toBeTruthy();
      await expect(page.queryByRole("button", { name: "Finish signup" })).toBeNull();
      const allow = page.getByRole("button", { name: "Allow" });
      await expect(allow.closest("form")?.querySelector("input[name=signupApproval]")?.getAttribute("value")).toBe("example-approval");
      await expect(allow.className).not.toBe(page.getByRole("button", { name: "Don't allow" }).className);
    },
    ViewConsentRetryView: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const page = within(canvasElement);
      await expect(page.getByRole("button", { name: "Try again" }).getAttribute("value")).toBe("approve");
      await expect(page.queryByRole("button", { name: "Allow" })).toBeNull();
      await expect(page.getByRole("alert")).toBeTruthy();
    },
  },
};
