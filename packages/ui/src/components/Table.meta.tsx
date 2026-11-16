import type { ComponentMeta } from "../lib/meta.ts";
import { TableBody, TableCaption, TableCell, TableHead, TableHeader, type TableProps, TableRow } from "./Table.tsx";

export const meta: ComponentMeta<TableProps> = {
  args: {
    children: (
      <>
        <TableCaption>Orders</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Order</TableHead>
            <TableHead>Items</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>1042</TableCell>
            <TableCell>3</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>1043</TableCell>
            <TableCell>1</TableCell>
          </TableRow>
        </TableBody>
      </>
    ),
  },
};
