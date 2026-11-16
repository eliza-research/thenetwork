import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { AuthMessageViewProps } from "./AuthMessageView.tsx";

export const meta: ComponentMeta<AuthMessageViewProps> = {
  args: { app: "Slop", view: "PageExpiredView", retryHref: "/oauth/authorize/cloud-return?rid=r_0123456789abcdefghijk" },
  examples: { "Sign in first": { view: "SignInFirstView" } },
  play: {
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const page = within(canvasElement);
      await expect(page.queryByRole("textbox")).toBeNull();
      await expect(page.queryByRole("link", { name: "Try again" })).toBeNull();
    },
    ViewPleaseRetryView: ({ canvasElement }: { canvasElement: HTMLElement }) =>
      expect(within(canvasElement).getByRole("link", { name: "Try again" }).getAttribute("href")).toBe("/oauth/authorize/cloud-return?rid=r_0123456789abcdefghijk"),
    "Sign in first": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const page = within(canvasElement);
      await expect(page.queryByRole("button")).toBeNull();
      await expect(page.queryByRole("link", { name: "Try again" })).toBeNull();
    },
  },
};
