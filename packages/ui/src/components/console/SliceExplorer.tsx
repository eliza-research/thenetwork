import { type ComponentProps, type ReactNode, useState } from "react";
import { cn } from "../../lib/cn.ts";
import { Button } from "../Button.tsx";
import { Select, SelectItem } from "../Select.tsx";
import { TableRow } from "../Table.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../Tabs.tsx";
import { Textarea } from "../Textarea.tsx";
import { DataCell, DataTable } from "./DataTable.tsx";
import { Segments } from "./Segments.tsx";
import { TimeSeriesChart, type TimeSeriesSeries } from "./TimeSeriesChart.tsx";

/** Supported visualization modes inside `SliceExplorer`. */
export type SliceChartType = "line" | "area" | "bar" | "table";

/** Supported time aggregation granularities. */
export type SliceGranularity = "1h" | "1d" | "1w";

/** Selectable metric or grouping dimension. */
export type SliceOption = {
  value: string;
  label: string;
};

/** Structured slice-and-dice query state. */
export type SliceQuery = {
  metric: string;
  groupBy: string;
  granularity: SliceGranularity;
  chartType: SliceChartType;
};

/** Tabular result record rendered by `SliceExplorer` table and SQL views. */
export type SliceTableRow = Record<string, string | number | boolean | null>;

export type SliceExplorerProps = Omit<ComponentProps<"div">, "children"> & {
  /** Selectable metrics. */
  metrics: SliceOption[];
  /** Selectable grouping dimensions. */
  dimensions: SliceOption[];
  /** Current structured query parameters. */
  query: SliceQuery;
  /** Called when any builder control changes. */
  onQueryChange: (next: SliceQuery) => void;
  /** X-axis labels for the built-in chart view. */
  labels?: string[];
  /** Series plotted in the built-in chart view. */
  series?: TimeSeriesSeries[];
  /** Table rows rendered when `query.chartType === "table"`. */
  rows?: SliceTableRow[];
  /** Scrubbed export trigger for CSV or JSON output. */
  onExport?: (format: "csv" | "json") => void;
  /** Enables the optional guarded read-only SQL tab. */
  enableSql?: boolean;
  /** Initial SQL text shown in the read-only SQL tab. */
  initialSql?: string;
  /** Called with validated read-only SQL when the user runs a query. */
  onRunSql?: (sql: string) => void;
  /** Optional server-side SQL execution error. */
  sqlError?: string;
  /** Column keys for SQL query results. */
  sqlColumns?: string[];
  /** Result rows from the read-only SQL tab. */
  sqlRows?: SliceTableRow[];
  /** Marks query execution as in progress. */
  loading?: boolean;
  /** Optional custom visualization overriding the built-in chart or table. */
  preview?: ReactNode;
};

const granularityOptions: { value: SliceGranularity; label: string }[] = [
  { value: "1h", label: "1h" },
  { value: "1d", label: "1d" },
  { value: "1w", label: "1w" },
];

const chartTypeOptions: { value: SliceChartType; label: string }[] = [
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "bar", label: "Bar" },
  { value: "table", label: "Table" },
];

const forbiddenSql = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|execute|attach|pragma|merge|replace|call|set)\b/i;

function validateReadOnlySql(raw: string): string | null {
  const trimmed = raw.trim().replace(/;+\s*$/, "");
  if (!trimmed) return "Enter a read-only SELECT query.";
  if (trimmed.includes(";")) return "Only a single read-only statement is allowed.";
  if (!/^(select|with)\b/i.test(trimmed)) return "Query must start with SELECT or WITH.";
  if (forbiddenSql.test(trimmed)) return "Write statements are blocked in read-only SQL mode.";
  return null;
}

function ResultTable({ rows, columnKeys, empty }: { rows: SliceTableRow[]; columnKeys?: string[]; empty: string }) {
  const keys = columnKeys && columnKeys.length > 0 ? columnKeys : rows[0] ? Object.keys(rows[0]) : [];
  if (!keys.length) {
    return <p className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">{empty}</p>;
  }
  const columns = keys.map((key) => ({
    key,
    label: key,
    numeric: rows.some((row) => typeof row[key] === "number"),
  }));
  const keyedRows = rows.map((row, pos) => ({
    row,
    rowKey: `${columns.map((column) => String(row[column.key] ?? "")).join("|")}#${pos}`,
  }));
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <DataTable columns={columns} empty={rows.length === 0 ? empty : undefined}>
        {keyedRows.map(({ row, rowKey }) => (
          <TableRow key={rowKey}>
            {columns.map((column) => {
              const value = row[column.key];
              return (
                <DataCell key={column.key} numeric={column.numeric}>
                  {value === null || value === undefined ? "—" : String(value)}
                </DataCell>
              );
            })}
          </TableRow>
        ))}
      </DataTable>
    </div>
  );
}

/** Structured visual slice-and-dice analytics builder with scrubbed CSV/JSON export and optional guarded read-only SQL tab. */
export function SliceExplorer({
  metrics,
  dimensions,
  query,
  onQueryChange,
  labels = [],
  series = [],
  rows = [],
  onExport,
  enableSql = false,
  initialSql = "SELECT day, lane, count(*) AS events FROM analytics_events GROUP BY 1, 2 LIMIT 50",
  onRunSql,
  sqlError,
  sqlColumns,
  sqlRows = [],
  loading = false,
  preview,
  onClick,
  className,
  ...props
}: SliceExplorerProps) {
  const [sqlText, setSqlText] = useState(initialSql);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleRunSql = () => {
    if (loading) return;
    const issue = validateReadOnlySql(sqlText);
    setValidationError(issue);
    if (!issue) {
      onRunSql?.(sqlText.trim());
    }
  };

  const builderPanel = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-3">
        <div className="w-44">
          <Select
            aria-label="Metric"
            value={query.metric}
            disabled={loading}
            onValueChange={(metric) => onQueryChange({ ...query, metric })}
            className="h-8 text-xs"
          >
            {metrics.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </Select>
        </div>

        <div className="w-40">
          <Select
            aria-label="Group by"
            value={query.groupBy}
            disabled={loading}
            onValueChange={(groupBy) => onQueryChange({ ...query, groupBy })}
            className="h-8 text-xs"
          >
            {dimensions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </Select>
        </div>

        <Segments
          aria-label="Granularity"
          value={query.granularity}
          disabled={loading}
          onValueChange={(granularity) => onQueryChange({ ...query, granularity: granularity as SliceGranularity })}
          options={granularityOptions}
        />

        <Segments
          aria-label="Chart type"
          value={query.chartType}
          disabled={loading}
          onValueChange={(chartType) => onQueryChange({ ...query, chartType: chartType as SliceChartType })}
          options={chartTypeOptions}
        />

        {onExport ? (
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="outline" size="sm" disabled={loading} onClick={() => onExport("csv")}>
              Export CSV
            </Button>
            <Button variant="outline" size="sm" disabled={loading} onClick={() => onExport("json")}>
              Export JSON
            </Button>
          </div>
        ) : null}
      </div>

      {preview ??
        (query.chartType === "table" ? (
          <ResultTable rows={rows} empty="No rows match this slice." />
        ) : (
          <TimeSeriesChart labels={labels} series={series} variant={query.chartType} />
        ))}
    </div>
  );

  if (!enableSql) {
    return (
      <div className={cn("flex flex-col gap-3", className)} onClick={loading ? undefined : onClick} {...props}>
        {builderPanel}
      </div>
    );
  }

  const activeSqlError = validationError ?? sqlError;

  return (
    <div className={cn("flex flex-col gap-3", className)} onClick={loading ? undefined : onClick} {...props}>
      <Tabs defaultValue="builder">
        <TabsList aria-label="Explorer mode">
          <TabsTrigger value="builder" disabled={loading}>
            Visual slice
          </TabsTrigger>
          <TabsTrigger value="sql" disabled={loading}>
            Read-only SQL
          </TabsTrigger>
        </TabsList>

        <TabsContent value="builder">{builderPanel}</TabsContent>

        <TabsContent value="sql" className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
            <Textarea
              aria-label="Read-only SQL query"
              value={sqlText}
              disabled={loading}
              onChange={(event) => {
                setSqlText(event.target.value);
                if (validationError) setValidationError(null);
              }}
              invalid={Boolean(activeSqlError)}
              className="min-h-24 font-mono text-xs"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              {activeSqlError ? (
                <p role="alert" className="text-xs font-medium text-destructive">
                  {activeSqlError}
                </p>
              ) : (
                <span className="text-xs text-muted-foreground">Read-only SELECT / WITH only</span>
              )}
              <div className="flex items-center gap-1.5">
                {onExport ? (
                  <>
                    <Button variant="outline" size="sm" disabled={loading} onClick={() => onExport("csv")}>
                      Export CSV
                    </Button>
                    <Button variant="outline" size="sm" disabled={loading} onClick={() => onExport("json")}>
                      Export JSON
                    </Button>
                  </>
                ) : null}
                <Button variant="primary" size="sm" loading={loading} onClick={handleRunSql}>
                  Run query
                </Button>
              </div>
            </div>
          </div>

          <ResultTable rows={sqlRows} columnKeys={sqlColumns} empty="Run a read-only query to inspect rows." />
        </TabsContent>
      </Tabs>
    </div>
  );
}
