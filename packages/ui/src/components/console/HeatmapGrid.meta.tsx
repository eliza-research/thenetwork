import { clearAllMocks, expect, fn, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { HeatmapGridProps } from "./HeatmapGrid.tsx";

type Context = { args: HeatmapGridProps; canvasElement: HTMLElement };

const makeGrid = (shift: number) =>
  Array.from({ length: 7 }, (_, day) =>
    Array.from({ length: 24 }, (_, hour) => {
      const evening = hour >= 17 && hour <= 22 ? 3 : 1;
      const weekend = day >= 4 ? 2 : 1;
      return ((day * 7 + hour * 3 + shift) % 11) * evening * weekend;
    }),
  );

export const meta: ComponentMeta<HeatmapGridProps> = {
  args: {
    metrics: [
      { key: "messages", label: "Messages", values: makeGrid(1) },
      { key: "intros", label: "Intros", values: makeGrid(5) },
      { key: "clicks", label: "Clicks", values: makeGrid(9) },
    ],
    onSelectCell: fn(),
  },
  examples: {
    "Single metric": {
      metrics: [{ key: "messages", label: "Messages", values: makeGrid(2) }],
    },
    Empty: { metrics: [] },
  },
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await userEvent.click(canvas.getByRole("radio", { name: "Intros" }));
      const cells = canvas.getAllByRole("gridcell");
      await expect(cells.length).toBe(168);
      await userEvent.click(cells[0]);
      await expect(args.onSelectCell).toHaveBeenCalledTimes(1);
    },
    Empty: async ({ canvasElement }: Context) => {
      await expect(within(canvasElement).getByText("No heatmap data.")).toBeTruthy();
    },
  },
};
