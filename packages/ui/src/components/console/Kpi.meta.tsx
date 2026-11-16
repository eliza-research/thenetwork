import type { ComponentMeta } from "../../lib/meta.ts";
import type { KpiProps } from "./Kpi.tsx";

export const meta: ComponentMeta<KpiProps> = {
  args: { label: "In review", value: "12", title: "Waiting for a human reviewer before anyone is contacted" },
  examples: { Clickable: { onSelect: () => undefined } },
};
