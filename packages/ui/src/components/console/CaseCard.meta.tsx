import { initial } from "../../../../core/src/generated/consoleWorkspace.ts";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { CaseCardProps } from "./CaseCard.tsx";

const row = { ...initial.caseRow, status: "CaseRowOpen" as const, onHold: true, expanded: true };

export const meta: ComponentMeta<CaseCardProps> = {
  args: {
    row,
    name: "Jon Park",
    level: { tone: "destructive", label: "hold" },
    urgent: true,
    meta: "open · opened Nov 14, 3:20 PM · 2 events",
    events: <p>Nov 14, 3:20 PM contact extraction · +40 pts</p>,
    actionsShown: true,
    note: "",
    canLift: true,
    canClose: true,
  },
  examples: {
    Collapsed: { row: { ...row, expanded: false } },
    Closed: { row: { ...row, status: "CaseRowClosed", onHold: false } },
  },
};
