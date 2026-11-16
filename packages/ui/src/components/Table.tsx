import type { ComponentProps } from "react";
import { cn, focusRing } from "../lib/cn.ts";

export type TableProps = ComponentProps<"table">;
export type TableSectionProps = ComponentProps<"tbody">;
export type TableRowProps = ComponentProps<"tr">;
export type TableHeadProps = ComponentProps<"th">;
export type TableCellProps = ComponentProps<"td">;
export type TableCaptionProps = ComponentProps<"caption">;

/** Records that share their fields, one per `TableRow`. Name it with a `TableCaption`; it scrolls sideways when it is wider than its place, and its frame takes keyboard focus so that the arrow keys scroll it. */
export function Table({ className, ...props }: TableProps) {
  return (
    <div tabIndex={0} className={cn(focusRing, "w-full overflow-x-auto rounded-sm")}>
      <table className={cn("w-full caption-top border-collapse text-sm", className)} {...props} />
    </div>
  );
}

/** The name of a `Table`. */
export function TableCaption({ className, ...props }: TableCaptionProps) {
  return <caption className={cn("pb-2 text-left font-medium text-foreground", className)} {...props} />;
}

/** The row of column names of a `Table`. */
export function TableHeader({ className, ...props }: TableSectionProps) {
  return <thead className={cn("border-b border-border", className)} {...props} />;
}

/** The records of a `Table`. */
export function TableBody({ className, ...props }: TableSectionProps) {
  return <tbody className={cn("[&>tr:last-child]:border-0", className)} {...props} />;
}

/** One record of a `Table`. */
export function TableRow({ className, ...props }: TableRowProps) {
  return <tr className={cn("border-b border-border", className)} {...props} />;
}

/** The name of a column, or of a row with `scope="row"`. */
export function TableHead({ scope = "col", className, ...props }: TableHeadProps) {
  return <th scope={scope} className={cn("h-10 px-3 text-left align-middle font-medium text-muted-foreground", className)} {...props} />;
}

/** One value of a record. */
export function TableCell({ className, ...props }: TableCellProps) {
  return <td className={cn("px-3 py-2 align-middle", className)} {...props} />;
}
