import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { ModeIndicatorProps } from "./ModeIndicator.tsx";

type Context = { canvasElement: HTMLElement };

export const meta: ComponentMeta<ModeIndicatorProps> = {
  args: { mode: "SimulatedMode", label: "SLOP · SIM · seed 1", details: "Simulated world, seed 1, day 14" },
  examples: {
    Real: { mode: "RealMode", label: "SLOP · PROD · read-only", details: "Production database, read-only" },
    Reconnecting: { connected: false },
  },
  play: {
    Default: async ({ canvasElement }: Context) => {
      const canvas = within(canvasElement);
      await expect(canvas.getByRole("img", { name: "Simulated world" })).toBeTruthy();
      await expect(canvas.queryByRole("img", { name: "Real data" })).toBeNull();
      await expect(canvas.queryByRole("img", { name: "Reconnecting" })).toBeNull();
    },
    Real: async ({ canvasElement }: Context) => {
      const canvas = within(canvasElement);
      await expect(canvas.getByRole("img", { name: "Real data" })).toBeTruthy();
      await expect(canvas.queryByRole("img", { name: "Simulated world" })).toBeNull();
    },
    Reconnecting: async ({ canvasElement }: Context) => {
      const canvas = within(canvasElement);
      await expect(canvas.getByRole("img", { name: "Reconnecting" })).toBeTruthy();
      await expect(canvas.getByRole("img", { name: "Simulated world" })).toBeTruthy();
    },
  },
};
