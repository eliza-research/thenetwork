import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { AlertProps } from "./Alert.tsx";

export const meta: ComponentMeta<AlertProps> = {
  args: { children: "Your profile is saved." },
  play: {
    Default: ({ canvasElement }: { canvasElement: HTMLElement }) => expect(within(canvasElement).getByRole("status").textContent).toBe("Your profile is saved."),
    VariantWarn: ({ canvasElement }: { canvasElement: HTMLElement }) => expect(within(canvasElement).getByRole("alert").textContent).toBe("Your profile is saved."),
    VariantDestructive: ({ canvasElement }: { canvasElement: HTMLElement }) => expect(within(canvasElement).getByRole("alert").textContent).toBe("Your profile is saved."),
  },
};
