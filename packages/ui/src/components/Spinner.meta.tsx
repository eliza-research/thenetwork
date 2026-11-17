import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { SpinnerProps } from "./Spinner.tsx";

export const meta: ComponentMeta<SpinnerProps> = {
  examples: { Labelled: { label: "Saving your profile" } },
  play: {
    Default: ({ canvasElement }: { canvasElement: HTMLElement }) => expect(within(canvasElement).getByRole("status", { name: "Loading" })).toBeTruthy(),
    Labelled: ({ canvasElement }: { canvasElement: HTMLElement }) => expect(within(canvasElement).getByRole("status", { name: "Saving your profile" })).toBeTruthy(),
  },
};
