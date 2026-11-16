import { expect, fn, within } from "storybook/test";
import { ntwrkBrand } from "../../../core/src/generated/brandIdentity.ts";
import { landingLinks } from "../brand/landing.ts";
import type { ComponentMeta } from "../lib/meta.ts";
import type { AgentRowProps } from "./AgentRow.tsx";

export const meta: ComponentMeta<AgentRowProps> = {
  args: { links: landingLinks(ntwrkBrand.app, { skillVersion: "1.0.0", textLine: "+15555550100" }), mounted: true, device: "MacDesktop", onChoose: fn() },
  examples: { Phone: { device: "Phone" }, "Without script": { mounted: false, device: "NotDetected" } },
  play: {
    Phone: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      await expect(within(canvasElement).queryByRole("link", { name: "Open in Cursor" })).toBeNull();
    },
    "Without script": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      await expect(within(canvasElement).queryByRole("button", { name: "Copy the prompt for Muse" })).toBeNull();
    },
  },
};
