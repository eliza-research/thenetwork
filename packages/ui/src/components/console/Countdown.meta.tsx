import type { ComponentMeta } from "../../lib/meta.ts";
import type { CountdownProps } from "./Countdown.tsx";

const now = Date.UTC(2026, 10, 15, 15, 0);

export const meta: ComponentMeta<CountdownProps> = {
  args: { now, deadline: now + 4 * 3_600_000, prefix: "Due in " },
  examples: {
    "Under an hour": { deadline: now + 40 * 60_000 },
    "Under ten minutes": { deadline: now + 6 * 60_000 },
    "Due now": { deadline: now - 60_000 },
    Overdue: { overdue: true },
  },
};
