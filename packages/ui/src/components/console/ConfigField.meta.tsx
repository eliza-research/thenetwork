import type { ComponentMeta } from "../../lib/meta.ts";
import type { ConfigFieldProps } from "./ConfigField.tsx";

export const meta: ComponentMeta<ConfigFieldProps> = {
  args: { control: "SwitchControl", phase: "ConfigShown", matchingOn: true, canPress: true, review: "human" },
  examples: {
    Confirming: { phase: "ConfigConfirming", canPress: false, canConfirm: true },
    Locked: { control: "LockedNote", matchingOn: false },
    "Admin only": { control: "AdminOnlyNote" },
    Refused: { phase: "ConfigFailed", error: "refused" },
  },
};
