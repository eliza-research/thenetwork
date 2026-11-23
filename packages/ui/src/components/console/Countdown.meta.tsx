import { expect } from "storybook/test";
import { countdownNearWithinMs, countdownUrgentWithinMs } from "../../../../core/src/generated/consolePanels.ts";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { CountdownProps } from "./Countdown.tsx";

const now = Date.UTC(2026, 10, 15, 15, 0);
const shown = (canvasElement: HTMLElement) => canvasElement.querySelector("time") as HTMLTimeElement;

export const meta: ComponentMeta<CountdownProps> = {
  args: { now, deadline: now + 4 * 3_600_000, prefix: "Due in " },
  examples: {
    "Under an hour": { deadline: now + 40 * 60_000 },
    "Under ten minutes": { deadline: now + 6 * 60_000 },
    "At one hour": { deadline: now + countdownNearWithinMs },
    "At ten minutes": { deadline: now + countdownUrgentWithinMs },
    "Due now": { deadline: now - 60_000 },
    Overdue: { overdue: true },
  },
  play: {
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const time = shown(canvasElement);
      await expect(time.textContent).toBe("Due in 4h");
      await expect(time.className).toContain("text-muted-foreground");
      await expect(time.getAttribute("datetime")).toBe(new Date(now + 4 * 3_600_000).toISOString());
    },
    "Under an hour": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const time = shown(canvasElement);
      await expect(time.textContent).toBe("Due in 40m");
      await expect(time.className).toContain("text-warn");
    },
    "Under ten minutes": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const time = shown(canvasElement);
      await expect(time.textContent).toBe("Due in 6m");
      await expect(time.className).toContain("text-destructive");
    },
    "At one hour": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const time = shown(canvasElement);
      await expect(time.textContent).toBe("Due in 1h");
      await expect(time.className).toContain("text-muted-foreground");
    },
    "At ten minutes": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const time = shown(canvasElement);
      await expect(time.textContent).toBe("Due in 10m");
      await expect(time.className).toContain("text-warn");
    },
    "Due now": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const time = shown(canvasElement);
      await expect(time.textContent).toBe("Due now");
      await expect(time.className).toContain("text-destructive");
    },
    Overdue: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const time = shown(canvasElement);
      await expect(time.textContent).toBe("overdue");
      await expect(time.className).toContain("text-destructive");
    },
  },
};
