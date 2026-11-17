import { initial } from "../../../../core/src/generated/consoleWorkspace.ts";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { ReportCardProps } from "./ReportCard.tsx";

const report = { ...initial.report, present: true };

export const meta: ComponentMeta<ReportCardProps> = {
  args: {
    report,
    expanded: true,
    kind: { tone: "destructive", label: "harassment" },
    name: "Jon Park",
    urgent: true,
    meta: "open · Nov 14, 3:20 PM",
    detail: <p>Reported Jon Park · by Maya Chen</p>,
    note: "",
    steps: [
      { step: "HoldPersonStep", enabled: false },
      { step: "BanPhoneStep", enabled: false },
      { step: "BanPersonStep", enabled: false },
      { step: "DismissStep", enabled: false },
    ],
  },
  examples: {
    "Note ready": {
      note: "Two reports, same pattern",
      steps: [
        { step: "HoldPersonStep", enabled: true },
        { step: "BanPhoneStep", enabled: true },
        { step: "BanPersonStep", enabled: true },
        { step: "DismissStep", enabled: true },
      ],
    },
    "Minor report": { report: { ...report, minorReport: true }, kind: { tone: "warn", label: "minor" }, steps: [{ step: "ClearMinorStep", enabled: false }] },
  },
};
