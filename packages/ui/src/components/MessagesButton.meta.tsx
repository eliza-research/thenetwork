import { expect, within } from "storybook/test";
import { friendsBrand, ntwrkBrand } from "../../../core/src/generated/brandIdentity.ts";
import { messagesEntryLabel } from "../../../core/src/generated/landingEntry.ts";
import { landingLinks } from "../brand/landing.ts";
import type { ComponentMeta } from "../lib/meta.ts";
import type { MessagesButtonProps } from "./MessagesButton.tsx";

const input = { skillVersion: "1.0.0", textLine: "+15555550100" };

const inverseEntry = async (canvasElement: HTMLElement, href: string) => {
  const link = within(canvasElement).getByRole("link", { name: messagesEntryLabel });
  await expect(link.getAttribute("href")).toBe(href);
  await expect(link.className).toContain("bg-inverse");
  await expect(link.className).toContain("text-inverse-foreground");
  if (/HappyDOM/.test(navigator.userAgent)) return;
  const style = getComputedStyle(link);
  await expect(style.getPropertyValue("--inverse").trim()).not.toBe("");
  await expect(style.backgroundColor).not.toBe(style.color);
};

export const meta: ComponentMeta<MessagesButtonProps> = {
  args: { href: landingLinks(ntwrkBrand.app, input).messagesHref },
  examples: { Friends: { href: landingLinks(friendsBrand.app, input).messagesHref } },
  play: {
    Default: ({ canvasElement }: { canvasElement: HTMLElement }) => inverseEntry(canvasElement, landingLinks(ntwrkBrand.app, input).messagesHref),
    Friends: ({ canvasElement }: { canvasElement: HTMLElement }) => inverseEntry(canvasElement, landingLinks(friendsBrand.app, input).messagesHref),
  },
};
