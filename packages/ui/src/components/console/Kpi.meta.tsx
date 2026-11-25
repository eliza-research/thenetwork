import { clearAllMocks, expect, fn, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { KpiProps } from "./Kpi.tsx";

type Context = { args: KpiProps; canvasElement: HTMLElement };

const selects = async ({ args, canvasElement }: Context) => {
  clearAllMocks();
  const button = within(canvasElement).getByRole("button", { name: /In review/ });
  await expect(button.textContent).toContain("12");
  await userEvent.click(button);
  await expect(args.onSelect).toHaveBeenCalledTimes(1);
};

const marked = (word: string) => async ({ canvasElement }: Context) => {
  await expect(canvasElement.querySelector(`svg[aria-label="${word}"]`)).not.toBeNull();
};

export const meta: ComponentMeta<KpiProps> = {
  args: { label: "In review", value: "12", title: "Waiting for a human reviewer before anyone is contacted" },
  examples: {
    Clickable: { onSelect: fn() },
    Static: { onSelect: undefined },
    "Own tone word": { tone: "warn", toneLabel: "Due soon" },
  },
  play: {
    Default: selects,
    Clickable: selects,
    Static: async ({ canvasElement }: Context) => {
      const canvas = within(canvasElement);
      await expect(canvas.queryByRole("button")).toBeNull();
      await expect(canvas.getByText("In review")).toBeTruthy();
    },
    "Own tone word": marked("Due soon"),
    "tone ok": marked("Good"),
    "tone warn": marked("Warning"),
    "tone destructive": marked("Alert"),
  },
};
