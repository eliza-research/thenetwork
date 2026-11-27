import { clearAllMocks, expect, fn, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { CohortMatrixProps } from "./CohortMatrix.tsx";

type Context = { args: CohortMatrixProps; canvasElement: HTMLElement };

export const meta: ComponentMeta<CohortMatrixProps> = {
  args: {
    columns: ["D1", "D3", "D7", "D14", "D30"],
    rows: [
      { key: "w1", label: "Nov 01", size: 84, retention: [0.74, 0.58, 0.44, 0.36, 0.28] },
      { key: "w2", label: "Nov 08", size: 112, retention: [0.78, 0.62, 0.49, 0.39, null] },
      { key: "w3", label: "Nov 15", size: 96, retention: [0.71, 0.55, 0.41, null, null] },
      { key: "w4", label: "Nov 22", size: 3, retention: [0.67, 0.33, null, null, null] },
    ],
    drivers: [
      { key: "first-intro", label: "Intro within 24h", liftPct: 24.5, sampleSize: 180 },
      { key: "group-join", label: "Joined Friend circle", liftPct: 14.2, sampleSize: 94 },
      { key: "unanswered", label: "No reply in 48h", liftPct: -18.0, sampleSize: 62 },
    ],
    onSelectCell: fn(),
  },
  examples: {
    "Matrix only": { drivers: undefined, onSelectCell: undefined },
    Empty: { rows: [] },
  },
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await expect(canvas.getAllByText("<5").length).toBeGreaterThanOrEqual(3);
      const cell = canvas.getByRole("button", { name: "Nov 01 D1 74%" });
      await userEvent.click(cell);
      await expect(args.onSelectCell).toHaveBeenCalledTimes(1);
    },
    Empty: async ({ canvasElement }: Context) => {
      await expect(within(canvasElement).getByText("No cohorts yet.")).toBeTruthy();
    },
  },
};
