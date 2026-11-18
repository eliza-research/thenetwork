import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { StatusMarkProps } from "./StatusMark.tsx";

type Context = { canvasElement: HTMLElement };

export const meta: ComponentMeta<StatusMarkProps> = {
  args: { label: "Pending" },
  examples: { Refused: { tone: "destructive", label: "refused", showLabel: true } },
  play: {
    // Without `showLabel`, the status word is the accessible name of the shape and no text shows.
    Default: async ({ canvasElement }: Context) => {
      const canvas = within(canvasElement);
      await expect(canvas.getByRole("img", { name: "Pending" })).toBeTruthy();
      await expect(canvas.queryByText("Pending")).toBeNull();
    },
    // With `showLabel`, the word shows once and the shape is hidden, so a screen reader does not read the status twice.
    Refused: async ({ canvasElement }: Context) => {
      const canvas = within(canvasElement);
      await expect(canvas.getByText("refused")).toBeTruthy();
      await expect(canvas.queryByRole("img")).toBeNull();
      await expect(canvasElement.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    },
  },
};
