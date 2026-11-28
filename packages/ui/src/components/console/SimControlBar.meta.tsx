import { clearAllMocks, expect, fn, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { SimControlBarProps } from "./SimControlBar.tsx";

type Context = { args: SimControlBarProps; canvasElement: HTMLElement };

export const meta: ComponentMeta<SimControlBarProps> = {
  args: {
    running: false,
    onToggleRun: fn(),
    onStep: fn(),
    speed: "60x",
    onSpeedChange: fn(),
    scenarios: [
      { id: "nyc-launch", label: "NYC launch" },
      { id: "viral-spike", label: "Viral spike" },
      { id: "safety-stress", label: "Safety stress" },
    ],
    scenarioId: "nyc-launch",
    onScenarioChange: fn(),
    responseMode: "hybrid",
    onResponseModeChange: fn(),
    budgetSpentUsd: 0.64,
    budgetLimitUsd: 5.0,
    chaosOptions: [
      { id: "social-429", label: "Social 429 rate limit", active: false },
      { id: "llm-timeout", label: "LLM timeout fallback", active: true },
      { id: "shadowban", label: "Shadowban outreach", active: false },
    ],
    onTriggerChaos: fn(),
    score: 86,
    safetyViolations: 0,
    simTimeLabel: "Day 4 · 14:30",
  },
  examples: {
    Running: { running: true, speed: "turbo", responseMode: "llm", budgetSpentUsd: 4.3 },
    "Safety alert": { safetyViolations: 2, score: 41 },
  },
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await userEvent.click(canvas.getByRole("button", { name: "Play" }));
      await expect(args.onToggleRun).toHaveBeenCalledTimes(1);
      await userEvent.click(canvas.getByRole("button", { name: "+1h" }));
      await expect(args.onStep).toHaveBeenCalledWith("1h");
      await userEvent.click(canvas.getByRole("radio", { name: "Turbo" }));
      await expect(args.onSpeedChange).toHaveBeenCalledWith("turbo");
    },
    "Safety alert": async ({ canvasElement }: Context) => {
      await expect(within(canvasElement).getByText("2 violations")).toBeTruthy();
    },
  },
};
