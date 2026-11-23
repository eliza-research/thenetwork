import { expect, screen, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import { Button } from "./Button.tsx";
import type { TooltipProps } from "./Tooltip.tsx";

export const meta: ComponentMeta<TooltipProps> = {
  args: { content: "Copies the prompt", delayDuration: 0, children: <Button variant="outline">Copy</Button> },
  play: {
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      within(canvasElement).getByRole("button", { name: "Copy" }).focus();
      await expect((await screen.findByRole("tooltip")).textContent).toBe("Copies the prompt");
    },
  },
};
