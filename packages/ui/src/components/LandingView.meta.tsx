import { expect, fn, within } from "storybook/test";
import { slopBrand } from "../../../core/src/generated/brandIdentity.ts";
import { initial, mount } from "../../../core/src/generated/landingEntry.ts";
import { landingLinks } from "../brand/landing.ts";
import type { ComponentMeta } from "../lib/meta.ts";
import type { LandingViewProps } from "./LandingView.tsx";

export const meta: ComponentMeta<LandingViewProps> = {
  args: {
    brand: slopBrand,
    links: landingLinks(slopBrand.app, { skillVersion: "1.0.0", textLine: "+15555550100" }),
    state: initial,
    onCopy: fn(),
    onChooseAgent: fn(),
    onChooseMessages: fn(),
  },
  examples: { Mounted: { state: mount(initial, "MacDesktop") } },
  play: {
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      await expect(within(canvasElement).queryByRole("button", { name: "Copy" })).toBeNull();
    },
    Mounted: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const view = within(canvasElement);
      await expect(view.getAllByRole("heading")).toHaveLength(1);
      await expect(view.getByRole("button", { name: "Copy" })).toBeTruthy();
      await expect(view.getByRole("link", { name: "Open in ChatGPT" })).toBeTruthy();
      await expect(view.getByRole("link", { name: "Open in Claude" })).toBeTruthy();
    },
  },
};
