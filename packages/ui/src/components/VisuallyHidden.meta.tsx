import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { VisuallyHiddenProps } from "./VisuallyHidden.tsx";

export const meta: ComponentMeta<VisuallyHiddenProps> = {
  args: { children: "Opens in a new tab" },
  play: {
    Default: ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const text = within(canvasElement).getByText("Opens in a new tab");
      return expect(text.classList.contains("sr-only")).toBe(true);
    },
  },
};
