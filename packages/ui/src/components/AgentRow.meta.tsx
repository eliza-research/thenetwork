import { expect, fn, within } from "storybook/test";
import { ntwrkBrand, slopBrand } from "../../../core/src/generated/brandIdentity.ts";
import { landingLinks } from "../brand/landing.ts";
import type { ComponentMeta } from "../lib/meta.ts";
import type { AgentRowProps } from "./AgentRow.tsx";

export const meta: ComponentMeta<AgentRowProps> = {
  args: { app: ntwrkBrand.app, links: landingLinks(ntwrkBrand.app, { skillVersion: "1.0.0", textLine: "+15555550100" }), mounted: true, device: "MacDesktop", onChoose: fn() },
  examples: {
    Phone: { device: "Phone" },
    "Without script": { mounted: false, device: "NotDetected" },
    Slop: { app: slopBrand.app, links: landingLinks(slopBrand.app, { skillVersion: "1.0.0", textLine: "+15555550100" }) },
  },
  play: {
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      await expect(within(canvasElement).getByRole("link", { name: "Open in ChatGPT" })).toBeTruthy();
    },
    Slop: async ({ args, canvasElement }: { args: AgentRowProps; canvasElement: HTMLElement }) => {
      const row = within(canvasElement);
      const chatGpt = new URL(row.getByRole("link", { name: "Open in ChatGPT" }).getAttribute("href") ?? "");
      await expect(chatGpt.origin).toBe("https://chatgpt.com");
      await expect(chatGpt.searchParams.get("q")).toBe(args.links.prompt);
      await expect(row.getByRole("link", { name: "Open in Claude" })).toBeTruthy();
    },
    Phone: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      await expect(within(canvasElement).queryByRole("link", { name: "Open in Cursor" })).toBeNull();
    },
    "Without script": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      await expect(within(canvasElement).queryByRole("button", { name: "Copy the prompt for Muse" })).toBeNull();
    },
  },
};
