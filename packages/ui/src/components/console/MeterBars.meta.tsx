import { clearAllMocks, expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { MeterBarsProps } from "./MeterBars.tsx";

type Context = { args: MeterBarsProps; canvasElement: HTMLElement };

const rowTexts = (canvasElement: HTMLElement) => within(canvasElement).getAllByRole("listitem").map((item) => item.textContent);

const nothing = async ({ canvasElement }: Context) => {
  await expect(within(canvasElement).queryByRole("list")).toBeNull();
  await expect(within(canvasElement).getByText("Nothing to show.")).toBeTruthy();
};

export const meta: ComponentMeta<MeterBarsProps> = {
  args: {
    "aria-label": "Why candidates were filtered",
    format: (value: number) => value.toLocaleString("en-US"),
    rows: [
      { key: "blocked", label: "blocked", value: 3, tone: "warn" },
      { key: "distance", label: "distance", value: 42, tone: "warn" },
      { key: "age_range", label: "age range", value: 17, tone: "warn" },
      { key: "none", label: "none", value: 0 },
    ],
  },
  examples: {
    "Score parts": {
      ranked: false,
      max: 1,
      format: (value: number) => value.toFixed(2),
      rows: [
        { key: "fit", label: "fit", value: 0.82, tone: "ok" },
        { key: "novelty", label: "novelty", value: 0.4, tone: "ok" },
        { key: "load", label: "load", value: 0.25, tone: "destructive" },
      ],
    },
    Static: { onSelect: undefined },
    "All at zero": { rows: [{ key: "none", label: "none", value: 0 }] },
  },
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      await expect(rowTexts(canvasElement)).toEqual(["distance42", "age range17", "blocked3"]);
      await userEvent.click(within(canvasElement).getByRole("button", { name: /distance/ }));
      await expect(args.onSelect).toHaveBeenCalledWith("distance");
    },
    "Score parts": async ({ canvasElement }: Context) => {
      await expect(rowTexts(canvasElement)).toEqual(["fit0.82", "novelty0.40", "load0.25"]);
    },
    Static: async ({ canvasElement }: Context) => {
      await expect(within(canvasElement).queryByRole("button")).toBeNull();
      await expect(rowTexts(canvasElement)).toHaveLength(3);
    },
    "All at zero": nothing,
    Empty: nothing,
  },
};
