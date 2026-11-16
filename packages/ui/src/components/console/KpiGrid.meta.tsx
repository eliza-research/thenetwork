import type { ComponentMeta } from "../../lib/meta.ts";
import { Kpi } from "./Kpi.tsx";
import type { KpiGridProps } from "./KpiGrid.tsx";

export const meta: ComponentMeta<KpiGridProps> = {
  args: {
    children: (
      <>
        <Kpi label="Active members" value="412" />
        <Kpi label="In review" value="12" tone="warn" />
        <Kpi label="Everyone-yes" value="88%" tone="ok" />
        <Kpi label="Safety holds" value="2" tone="destructive" />
      </>
    ),
  },
};
