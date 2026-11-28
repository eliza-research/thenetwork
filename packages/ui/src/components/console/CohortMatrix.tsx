import type { ComponentProps, ReactNode } from "react";
import { cn, focusRing } from "../../lib/cn.ts";

/** One cohort row in a `CohortMatrix`. */
export type CohortRow = {
  key: string;
  label: string;
  /** Number of members in the cohort. Cohorts below `minCohortSize` are masked. */
  size: number;
  /** Retention fraction (0 to 1) per column, or `null` when the period has not elapsed yet. */
  retention: (number | null)[];
};

/** One retention lift driver shown beside a `CohortMatrix`. */
export type CohortDriver = {
  key: string;
  label: string;
  /** Retention lift in percentage points (positive or negative). */
  liftPct: number;
  sampleSize?: number;
  title?: string;
};

export type CohortMatrixProps = Omit<ComponentProps<"div">, "children"> & {
  /** Period column headers, such as `["D1", "D3", "D7", "D14", "D30"]`. */
  columns: string[];
  /** Cohort rows ordered chronologically. */
  rows: CohortRow[];
  /** Minimum cohort size required before displaying retention values (k-anonymity threshold). */
  minCohortSize?: number;
  /** Optional list of retention driver lift bars. */
  drivers?: CohortDriver[];
  /** Heading for the drivers panel when `drivers` is provided. */
  driversTitle?: string;
  /** Called when a user selects an unmasked retention cell. */
  onSelectCell?: (row: CohortRow, columnIndex: number) => void;
  /** Shown when `rows` is empty. */
  empty?: ReactNode;
};

const heatClass = (value: number): string => {
  if (value >= 0.65) return "bg-chart-1/35 text-foreground font-semibold";
  if (value >= 0.45) return "bg-chart-1/25 text-foreground font-medium";
  if (value >= 0.25) return "bg-chart-1/15 text-foreground";
  if (value > 0) return "bg-chart-1/10 text-foreground";
  return "bg-muted/50 text-muted-foreground";
};

const formatPct = (value: number) => `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;

/** Triangular retention heatmap table with k-anonymity masking and optional retention drivers lift bars. */
export function CohortMatrix({
  columns,
  rows,
  minCohortSize = 5,
  drivers,
  driversTitle = "Retention drivers",
  onSelectCell,
  empty = "No cohorts yet.",
  className,
  ...props
}: CohortMatrixProps) {
  if (!rows.length || !columns.length) {
    return (
      <div className={cn("rounded-md border border-border bg-card p-4 text-sm text-muted-foreground", className)} {...props}>
        {empty}
      </div>
    );
  }

  const maxLift = drivers?.length ? Math.max(1, ...drivers.map((item) => Math.abs(item.liftPct))) : 1;

  return (
    <div className={cn("flex flex-col gap-4 rounded-md border border-border bg-card p-4 text-card-foreground lg:flex-row", className)} {...props}>
      <div className="min-w-0 flex-1 overflow-x-auto">
        <table className="w-full border-separate border-spacing-1 text-left text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th scope="col" className="px-2 py-1 font-medium">
                Cohort
              </th>
              <th scope="col" className="px-2 py-1 text-right font-medium">
                n
              </th>
              {columns.map((column) => (
                <th key={column} scope="col" className="px-2 py-1 text-center font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const masked = row.size < minCohortSize;
              return (
                <tr key={row.key}>
                  <th scope="row" className="px-2 py-1.5 font-medium whitespace-nowrap text-foreground">
                    {row.label}
                  </th>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                    {masked ? `<${minCohortSize}` : row.size.toLocaleString("en-US")}
                  </td>
                  {columns.map((column, colIndex) => {
                    const value = row.retention[colIndex] ?? null;
                    if (value === null) {
                      return <td key={column} aria-label={`${row.label} ${column} not yet elapsed`} className="rounded-sm bg-transparent px-2 py-1.5" />;
                    }
                    if (masked) {
                      return (
                        <td
                          key={column}
                          aria-label={`${row.label} ${column} masked under ${minCohortSize} members`}
                          className="rounded-sm bg-muted px-2 py-1.5 text-center tabular-nums text-muted-foreground"
                        >
                          {`<${minCohortSize}`}
                        </td>
                      );
                    }
                    const text = formatPct(value);
                    return (
                      <td key={column} className="p-0">
                        {onSelectCell ? (
                          <button
                            type="button"
                            onClick={() => onSelectCell(row, colIndex)}
                            aria-label={`${row.label} ${column} ${text}`}
                            className={cn(
                              focusRing,
                              "block w-full rounded-sm px-2 py-1.5 text-center tabular-nums transition-opacity duration-fast hover:opacity-80",
                              heatClass(value),
                            )}
                          >
                            {text}
                          </button>
                        ) : (
                          <span className={cn("block rounded-sm px-2 py-1.5 text-center tabular-nums", heatClass(value))}>
                            {text}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {drivers && drivers.length > 0 ? (
        <div className="flex w-full shrink-0 flex-col gap-2 border-t border-border pt-3 lg:w-64 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-4">
          <div className="text-xs font-medium text-muted-foreground">{driversTitle}</div>
          <ul className="flex flex-col gap-2">
            {drivers.map((driver) => {
              const positive = driver.liftPct >= 0;
              const width = Math.min(1, Math.abs(driver.liftPct) / maxLift);
              const signed = `${positive ? "+" : ""}${Math.round(driver.liftPct * 10) / 10}pp`;
              return (
                <li key={driver.key} title={driver.title ?? driver.label} className="flex flex-col gap-1 text-xs">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-medium text-foreground">{driver.label}</span>
                    <span className={cn("shrink-0 font-semibold tabular-nums", positive ? "text-ok" : "text-destructive")}>
                      {signed}
                    </span>
                  </div>
                  <span aria-hidden className="block h-1.5 w-full overflow-hidden rounded-sm bg-muted">
                    <span
                      className={cn("block size-full origin-left", positive ? "bg-ok" : "bg-destructive")}
                      style={{ transform: `scaleX(${width})` }}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
