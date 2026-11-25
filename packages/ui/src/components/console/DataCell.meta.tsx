import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import { TableRow } from "../Table.tsx";
import { type DataCellProps, DataTable } from "./DataTable.tsx";

type Context = { args: DataCellProps; canvasElement: HTMLElement };

const shows = (text: string) => async ({ canvasElement }: Context) => {
  await expect(within(canvasElement).getByRole("cell").textContent).toBe(text);
};

export const meta: ComponentMeta<DataCellProps> = {
  args: { children: "slop" },
  examples: { Numeric: { numeric: true, children: "412" }, "Secondary value": { muted: true, children: "Nov 14, 3:20 PM" } },
  decorator: (story) => (
    <DataTable columns={[{ key: "value", label: "Value" }]}>
      <TableRow>{story()}</TableRow>
    </DataTable>
  ),
  play: {
    Default: shows("slop"),
    Numeric: shows("412"),
    "Secondary value": shows("Nov 14, 3:20 PM"),
  },
};
