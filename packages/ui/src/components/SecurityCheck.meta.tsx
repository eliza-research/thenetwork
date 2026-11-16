import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { SecurityCheckProps } from "./SecurityCheck.tsx";

export const meta: ComponentMeta<SecurityCheckProps> = {
  args: { siteKey: "", check: "CheckRunning" },
  play: {
    "Check CheckPassed": ({ canvasElement }: { canvasElement: HTMLElement }) => expect(within(canvasElement).getByRole("img", { name: "Security check passed" })).toBeTruthy(),
    "Check CheckBroken": ({ canvasElement }: { canvasElement: HTMLElement }) => expect(within(canvasElement).getByRole("img", { name: "Security check failed" })).toBeTruthy(),
  },
};
