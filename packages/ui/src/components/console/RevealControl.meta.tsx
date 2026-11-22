import { initial } from "../../../../core/src/generated/consoleWorkspace.ts";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { RevealControlProps } from "./RevealControl.tsx";

export const meta: ComponentMeta<RevealControlProps> = {
  args: { reveal: initial.reveal, canStart: true, reason: "" },
  examples: {
    Drafting: { reveal: { ...initial.reveal, phase: "RevealDrafting" } },
    "Reason ready": { reveal: { ...initial.reveal, phase: "RevealDrafting", reasonReady: true }, reason: "Case 41 evidence", canSubmit: true },
    Granted: { reveal: { ...initial.reveal, phase: "RevealGranted", reasonReady: true }, minutesLeft: 12, grantedReason: "Case 41 evidence" },
  },
};
