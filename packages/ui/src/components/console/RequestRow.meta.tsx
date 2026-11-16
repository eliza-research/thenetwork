import type { ComponentMeta } from "../../lib/meta.ts";
import { DataTable } from "./DataTable.tsx";
import { requestColumns, type RequestRowProps } from "./RequestRow.tsx";

export const meta: ComponentMeta<RequestRowProps> = {
  args: { opened: "Nov 14, 3:20 PM", member: "Maya Chen", label: "a climbing partner", detail: "hobby", outcome: "OpenOutcome", outcomeLabel: "open", tries: 2, age: "6h" },
  examples: { Fulfilled: { outcome: "FulfilledOutcome", outcomeLabel: "fulfilled", age: "18h", ageTitle: "Hours to fulfil" } },
  decorator: (story) => <DataTable columns={requestColumns}>{story()}</DataTable>,
};
