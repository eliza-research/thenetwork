import type { ComponentMeta } from "../../lib/meta.ts";
import type { LorenzCurveProps } from "./LorenzCurve.tsx";

export const meta: ComponentMeta<LorenzCurveProps> = {
  args: { points: [0.02, 0.05, 0.1, 0.16, 0.24, 0.33, 0.45, 0.59, 0.76, 1] },
};
