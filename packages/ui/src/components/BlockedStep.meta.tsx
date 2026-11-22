import type { ComponentMeta } from "../lib/meta.ts";
import type { BlockedStepProps } from "./BlockedStep.tsx";

export const meta: ComponentMeta<BlockedStepProps> = {
  args: { reason: "UnderAge", homeLabel: "Back to peon.biz" },
  examples: {
    "Site text": { reason: "InviteOnly", messages: { InviteOnly: "peon.biz is not open to new members right now. Please try again later." } },
  },
};
