// spec/consoleWorkspace.md, "The request segments group the outcomes"
import type { ComponentProps, ReactNode } from "react";
import type { RequestOutcome, RequestSegment } from "../../../../core/src/generated/consoleWorkspace.ts";
import { TableRow } from "../Table.tsx";
import { DataCell, type DataColumn } from "./DataTable.tsx";
import type { SegmentOption } from "./Segments.tsx";
import { StatusMark, type StatusTone } from "./StatusMark.tsx";

/** The request segments for a `Segments` row, in order; filter the rows with the generated `requestShown(outcome, segment)`. */
export const requestSegmentOptions: (SegmentOption & { value: RequestSegment })[] = [
  { value: "OpenSegment", label: "Open" },
  { value: "FulfilledSegment", label: "Fulfilled" },
  { value: "NoneSegment", label: "None" },
  { value: "AnsweredSegment", label: "Answered" },
  { value: "AllSegment", label: "All" },
];

/** The columns of a request table, for `DataTable`. */
export const requestColumns: DataColumn[] = [
  { key: "opened", label: "Opened" },
  { key: "member", label: "Member" },
  { key: "asked", label: "Asked for" },
  { key: "outcome", label: "Outcome" },
  { key: "tries", label: "Tries", numeric: true },
  { key: "age", label: "Age", numeric: true },
  { key: "open", label: "Opportunity", hideLabel: true },
];

const outcomeTone: Record<RequestOutcome, StatusTone> = {
  ProbingOutcome: "neutral",
  OpenOutcome: "warn",
  FulfilledOutcome: "ok",
  BookedOutcome: "ok",
  NoneOutcome: "neutral",
  AnsweredOutcome: "ok",
};

export type RequestRowProps = Omit<ComponentProps<"tr">, "children"> & {
  /** When the request opened. */
  opened: string;
  /** The member, as a `MemberLink`. */
  member: ReactNode;
  /** What the member asked for, never their own words. */
  label: string;
  /** The category, and "plans" for a plans request. */
  detail?: string;
  /** The outcome. Its shape and color show it; `outcomeLabel` is its name. */
  outcome: RequestOutcome;
  /** The outcome word, such as "fulfilled". */
  outcomeLabel: string;
  tries: number;
  /** The age, or the hours to fulfil. */
  age: string;
  /** What `age` measures, shown on hover. */
  ageTitle?: string;
  /** The opportunity of the request, as an `OpportunityLink`. */
  open?: ReactNode;
};

/**
 * One member request in a `DataTable` with `requestColumns`.
 * @model spec/consoleWorkspace.md
 */
export function RequestRow({ opened, member, label, detail, outcome, outcomeLabel, tries, age, ageTitle, open, ...props }: RequestRowProps) {
  return (
    <TableRow {...props}>
      <DataCell muted>{opened}</DataCell>
      <DataCell>{member}</DataCell>
      <DataCell>
        {label}
        {detail ? <span className="text-muted-foreground"> · {detail}</span> : null}
      </DataCell>
      <DataCell>
        <StatusMark tone={outcomeTone[outcome]} label={outcomeLabel} showLabel />
      </DataCell>
      <DataCell numeric>{tries}</DataCell>
      <DataCell numeric title={ageTitle}>
        {age}
      </DataCell>
      <DataCell>{open}</DataCell>
    </TableRow>
  );
}
