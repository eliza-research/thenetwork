import { expect, screen, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import { Button } from "./Button.tsx";
import type { TooltipProps } from "./Tooltip.tsx";

const shows = async (canvasElement: HTMLElement, name: string, text: string) => {
  within(canvasElement).getByRole("button", { name }).focus();
  const tooltip = await screen.findByRole("tooltip");
  await expect(tooltip.textContent).toBe(text);
  const surface = tooltip.closest(".bg-inverse");
  if (!(surface instanceof HTMLElement)) throw new Error("The tooltip is not on the inverse surface.");
  await expect(surface.className).toContain("text-inverse-foreground");
  if (/HappyDOM/.test(navigator.userAgent)) return;
  const style = getComputedStyle(surface);
  await expect(style.backgroundColor).not.toBe(style.color);
};

export const meta: ComponentMeta<TooltipProps> = {
  args: { content: "Copies the prompt", delayDuration: 0, children: <Button variant="outline">Copy</Button> },
  examples: { Bottom: { side: "bottom", content: "Opens Messages", children: <Button variant="outline">Text</Button> } },
  play: {
    Default: ({ canvasElement }: { canvasElement: HTMLElement }) => shows(canvasElement, "Copy", "Copies the prompt"),
    Bottom: ({ canvasElement }: { canvasElement: HTMLElement }) => shows(canvasElement, "Text", "Opens Messages"),
  },
};
