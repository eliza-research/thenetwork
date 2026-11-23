import type { ComponentMeta } from "../../lib/meta.ts";
import type { MeterBarsProps } from "./MeterBars.tsx";

export const meta: ComponentMeta<MeterBarsProps> = {
  args: {
    "aria-label": "Why candidates were filtered",
    rows: [
      { key: "distance", label: "distance", value: 42, tone: "warn" },
      { key: "age_range", label: "age range", value: 17, tone: "warn" },
      { key: "blocked", label: "blocked", value: 3, tone: "warn" },
    ],
  },
  examples: {
    "Score parts": {
      ranked: false,
      max: 1,
      format: (value: number) => value.toFixed(2),
      rows: [
        { key: "fit", label: "fit", value: 0.82, tone: "ok" },
        { key: "novelty", label: "novelty", value: 0.4, tone: "ok" },
        { key: "load", label: "load", value: 0.25, tone: "destructive" },
      ],
    },
  },
};
