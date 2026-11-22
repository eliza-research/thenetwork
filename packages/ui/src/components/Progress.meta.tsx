import type { ComponentMeta } from "../lib/meta.ts";
import type { ProgressProps } from "./Progress.tsx";

export const meta: ComponentMeta<ProgressProps> = {
  args: { value: 60, "aria-label": "Upload" },
  examples: { Empty: { value: 0 }, Done: { value: 100 }, Unknown: { value: null } },
};
