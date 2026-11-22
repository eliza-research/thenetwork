import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { AuthShellProps } from "./AuthShell.tsx";

export const meta: ComponentMeta<AuthShellProps> = {
  args: { app: "Slop", title: "Enter your code", children: <p>Sent to ••• 0100.</p> },
  play: {
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const page = within(canvasElement);
      await expect(page.getAllByRole("heading")).toHaveLength(1);
      await expect(page.getByRole("link", { name: "slop.date" }).getAttribute("href")).toBe("/");
      await expect(page.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy");
      await expect(page.getByRole("link", { name: "Terms" }).getAttribute("href")).toBe("/terms");
    },
  },
};
