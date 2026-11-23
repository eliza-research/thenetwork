import { initial } from "../../../../core/src/generated/staffSignIn.ts";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { SignInNoticeProps } from "./SignInNotice.tsx";

export const meta: ComponentMeta<SignInNoticeProps> = {
  args: { signIn: { ...initial, phase: "AskingToken", tokenInAddress: false }, token: "" },
  examples: {
    Loading: { signIn: { ...initial, phase: "Checking", tokenInAddress: false } },
    "Single sign-on": { signIn: { ...initial, phase: "AskingAccess", tokenInAddress: false } },
    "No role with a token": { signIn: { ...initial, phase: "NoStaffRole", method: "TokenCredential", tokenInAddress: false } },
    "No role with single sign-on": { signIn: { ...initial, phase: "NoStaffRole", method: "AccessCredential", tokenInAddress: false } },
    "Second factor": { signIn: { ...initial, phase: "NeedsSecondFactor", method: "AccessCredential", tokenInAddress: false } },
    "Site refused": { signIn: { ...initial, phase: "SiteRefused", tokenInAddress: false } },
    Retry: { signIn: { ...initial, phase: "CheckFailed", tokenInAddress: false } },
  },
};
