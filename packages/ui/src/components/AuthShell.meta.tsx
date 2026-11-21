import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { AuthShellProps } from "./AuthShell.tsx";

export const meta: ComponentMeta<AuthShellProps> = {
  args: { app: "Slop", title: "Enter your code", children: <p>Sent to ••• 0100.</p> },
  examples: { "Rendered by ntwrk.party": { siteOrigin: "https://slop.date" } },
  play: {
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const page = within(canvasElement);
      await expect(page.getAllByRole("heading")).toHaveLength(1);
      await expect(page.getByRole("link", { name: "slop.date" }).getAttribute("href")).toBe("/");
      await expect(page.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy");
      await expect(page.getByRole("link", { name: "Terms" }).getAttribute("href")).toBe("/terms");
    },
    "Rendered by ntwrk.party": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      // ntwrk.party renders the page for slop.date: the brand mark and the legal links open slop.date's own pages.
      const page = within(canvasElement);
      await expect(page.getByRole("link", { name: "slop.date" }).getAttribute("href")).toBe("https://slop.date/");
      await expect(page.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("https://slop.date/privacy");
      await expect(page.getByRole("link", { name: "Terms" }).getAttribute("href")).toBe("https://slop.date/terms");
    },
  },
};
