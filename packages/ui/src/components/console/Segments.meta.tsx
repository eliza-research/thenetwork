import type { ComponentMeta } from "../../lib/meta.ts";
import type { SegmentsProps } from "./Segments.tsx";

export const meta: ComponentMeta<SegmentsProps> = {
  args: {
    "aria-label": "Range",
    defaultValue: "7d",
    options: [
      { value: "today", label: "Today" },
      { value: "7d", label: "7d" },
      { value: "30d", label: "30d" },
      { value: "all", label: "All" },
    ],
  },
};
