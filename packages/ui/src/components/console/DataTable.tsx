import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "../Table.tsx";
import { VisuallyHidden } from "../VisuallyHidden.tsx";

/** One column of a `DataTable`. */
export type DataColumn = {
  key: string;
  /** The column name; a column of links can have a hidden one. */
  label: string;
  /** Hides the name from the screen and keeps it for assistive technology. */
  hideLabel?: boolean;
  /** Aligns a column of numbers at the end. */
  numeric?: boolean;
  /** The definition of the column, shown on hover. */
  title?: string;
};

export type DataTableProps = ComponentProps<"table"> & {
  /** The columns, in order. */
  columns: DataColumn[];
  /** The name of the table. */
  caption?: ReactNode;
  /** One row that fills the table when it has no rows, such as "Nothing logged." */
  empty?: ReactNode;
  /** The rows, as `TableRow`s of `DataCell`s, or as `RequestRow`s and `AuditRow`s. */
  children?: ReactNode;
};

/** Records that share their fields, under one row of column names. */
export function DataTable({ columns, caption, empty, className, children, ...props }: DataTableProps) {
  return (
    <Table className={className} {...props}>
      {caption ? <TableCaption>{caption}</TableCaption> : null}
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column.key} title={column.title} className={cn(column.numeric && "text-right")}>
              {column.hideLabel ? <VisuallyHidden>{column.label}</VisuallyHidden> : column.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {children}
        {empty ? (
          <TableRow>
            <TableCell colSpan={columns.length} className="text-muted-foreground">
              {empty}
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}

export type DataCellProps = ComponentProps<"td"> & {
  /** A number, aligned at the end. */
  numeric?: boolean;
  /** A secondary value, such as a time. */
  muted?: boolean;
};

/** One value of a `DataTable` row. */
export function DataCell({ numeric = false, muted = false, className, ...props }: DataCellProps) {
  return <TableCell className={cn(numeric && "text-right tabular-nums", muted && "text-muted-foreground", className)} {...props} />;
}
