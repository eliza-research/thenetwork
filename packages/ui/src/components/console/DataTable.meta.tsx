import type { ComponentMeta } from "../../lib/meta.ts";
import { TableRow } from "../Table.tsx";
import { DataCell, type DataTableProps } from "./DataTable.tsx";

export const meta: ComponentMeta<DataTableProps> = {
  args: {
    columns: [
      { key: "app", label: "App" },
      { key: "members", label: "Members", numeric: true },
      { key: "backlog", label: "Review backlog", numeric: true },
    ],
    children: (
      <>
        <TableRow>
          <DataCell>slop</DataCell>
          <DataCell numeric>412</DataCell>
          <DataCell numeric>12</DataCell>
        </TableRow>
        <TableRow>
          <DataCell>friends</DataCell>
          <DataCell numeric>88</DataCell>
          <DataCell numeric>0</DataCell>
        </TableRow>
      </>
    ),
  },
  examples: { Empty: { children: undefined, empty: "Nothing logged." } },
};
