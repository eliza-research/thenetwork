import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { ConsentViewProps } from "./ConsentView.tsx";

export const meta: ComponentMeta<ConsentViewProps> = {
  args: { app: "Peon", rid: "r_0123456789abcdefghijk", clientName: "Claude", redirectHost: "claude.ai", scopes: ["apps:read", "membership:read", "profile:write"] },
  examples: { Unnamed: { clientName: null } },
  play: {
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const page = within(canvasElement);
      const allow = page.getByRole("button", { name: "Allow" });
      await expect(allow.getAttribute("value")).toBe("approve");
      await expect(page.getByRole("button", { name: "Don't allow" }).getAttribute("value")).toBe("deny");
      await expect(allow.closest("form")?.getAttribute("action")).toBe("/oauth/authorize/consent");
      await expect(page.getAllByRole("listitem")).toHaveLength(3);
    },
    Unnamed: ({ canvasElement }: { canvasElement: HTMLElement }) => expect(within(canvasElement).getByText("An unnamed assistant")).toBeTruthy(),
    ViewConsentRetryView: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const page = within(canvasElement);
      await expect(page.getByRole("button", { name: "Try again" }).getAttribute("value")).toBe("approve");
      await expect(page.queryByRole("button", { name: "Allow" })).toBeNull();
      await expect(page.getByRole("alert")).toBeTruthy();
    },
  },
};
