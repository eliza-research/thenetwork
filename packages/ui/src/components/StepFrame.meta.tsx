import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { StepFrameProps } from "./StepFrame.tsx";

export const meta: ComponentMeta<StepFrameProps> = {
  args: { title: "Enter the code", children: <p className="text-foreground">Sent to (•••) •••-0123.</p> },
  play: {
    Default: ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const heading = within(canvasElement).getByRole("heading", { level: 1, name: "Enter the code" });
      heading.focus();
      return expect(document.activeElement).toBe(heading);
    },
  },
};
